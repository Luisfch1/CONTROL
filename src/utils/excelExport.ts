import { utils, writeFile } from 'xlsx';
import type { Project } from '../types/projectTypes';

/**
 * Exporta un array de objetos a un archivo Excel (.xlsx) con soporte para formato
 * especial del Informe Ejecutivo de Estado de Obra si se requiere.
 * @param data Array de objetos con la data a exportar
 * @param fileName Nombre del archivo (sin extensión)
 * @param sheetName Nombre de la hoja de cálculo
 * @param project Datos opcionales del proyecto activo para AIU y cálculos adicionales
 */
export const exportToExcel = (data: any[], fileName: string, sheetName: string = 'Datos', project?: Project) => {
  try {
    const isExecutive = fileName.toLowerCase().includes('ejecutivo') || fileName.toLowerCase().includes('estado de obra');

    if (isExecutive && project) {
      // 1. Crear libro de Excel
      const wb = utils.book_new();
      const ws_data: any[][] = [];

      // Encabezados del informe
      ws_data.push([fileName.toUpperCase()]);
      ws_data.push([`PROYECTO: ${project.name.toUpperCase()}`]);
      ws_data.push([`CONTRATISTA: LCH INGENIERÍA`]);
      ws_data.push([`FECHA DE CORTE: ${new Date().toLocaleDateString('es-CO')}`]);
      ws_data.push([]); // Fila vacía de separación

      // Categorías de Secciones
      ws_data.push([
        'CONDICIONES CONTRACTUALES', '', '', '', '', '', // A-F (6 columnas)
        '', // G (separador delgado)
        'AVANCE ACUMULADO', '', '' // H-J (3 columnas)
      ]);

      // Nombres de Columnas
      ws_data.push([
        'ÍTEM', 'DESCRIPCIÓN', 'UNIDAD', 'CANTIDAD', 'VALOR UNITARIO', 'VALOR TOTAL',
        '', // Separador
        'CANTIDAD', 'VALOR', '% AVANCE'
      ]);

      const startRowIndex = ws_data.length + 1; // 1-based index del primer ítem

      // Insertar filas de datos
      data.forEach((row) => {
        const qContractual = Number(row.quantity) || 0;
        const uPrice = Number(row.unitPrice) || 0;
        const tPrice = Number(row.totalPrice) || (qContractual * uPrice);
        const qExecuted = Number(row.executedQuantity) || 0;

        ws_data.push([
          row.itemCode || '',
          row.description || '',
          row.unit || '',
          qContractual,
          uPrice,
          tPrice,
          '', // Separador
          qExecuted,
          qExecuted * uPrice,
          tPrice > 0 ? (qExecuted * uPrice) / tPrice : 0
        ]);
      });

      const endRowIndex = ws_data.length; // Fila de finalización de datos

      // Fila vacía antes de totales
      ws_data.push([]);

      const subtotalRowIndex = ws_data.length + 1;

      // Subtotal de Costo Directo
      ws_data.push([
        'SUBTOTAL COSTO DIRECTO', '', '', '', '',
        { f: `SUM(F${startRowIndex}:F${endRowIndex})` }, // F (Total Contractual)
        '', // G (Separador)
        '', // H
        { f: `SUM(I${startRowIndex}:I${endRowIndex})` }, // I (Total Ejecutado)
        { f: `IF(F${subtotalRowIndex}>0,I${subtotalRowIndex}/F${subtotalRowIndex},0)` } // J (% Avance)
      ]);

      // Recuperar porcentajes de AIU reales del proyecto (o usar por defecto A=15%, I=1%, U=4%)
      const adminPerc = Number(project.aiu?.administracion) ?? 15;
      const imprevPerc = Number(project.aiu?.imprevistos) ?? 1;
      const utilPerc = Number(project.aiu?.utilidad) ?? 4;

      const adminRowIndex = subtotalRowIndex + 1;
      ws_data.push([
        `ADMINISTRACIÓN (${adminPerc}%)`, '', '', '', '',
        { f: `F${subtotalRowIndex}*${adminPerc / 100}` },
        '',
        '',
        { f: `I${subtotalRowIndex}*${adminPerc / 100}` },
        ''
      ]);

      const imprevRowIndex = adminRowIndex + 1;
      ws_data.push([
        `IMPREVISTOS (${imprevPerc}%)`, '', '', '', '',
        { f: `F${subtotalRowIndex}*${imprevPerc / 100}` },
        '',
        '',
        { f: `I${subtotalRowIndex}*${imprevPerc / 100}` },
        ''
      ]);

      const utilRowIndex = imprevRowIndex + 1;
      ws_data.push([
        `UTILIDAD (${utilPerc}%)`, '', '', '', '',
        { f: `F${subtotalRowIndex}*${utilPerc / 100}` },
        '',
        '',
        { f: `I${subtotalRowIndex}*${utilPerc / 100}` },
        ''
      ]);

      const totalRowIndex = utilRowIndex + 1;
      // Total General
      ws_data.push([
        'TOTAL GENERAL', '', '', '', '',
        { f: `F${subtotalRowIndex}+F${adminRowIndex}+F${imprevRowIndex}+F${utilRowIndex}` },
        '',
        '',
        { f: `I${subtotalRowIndex}+I${adminRowIndex}+I${imprevRowIndex}+I${utilRowIndex}` },
        { f: `IF(F${totalRowIndex}>0,I${totalRowIndex}/F${totalRowIndex},0)` }
      ]);

      // Tabla de Seguimiento a la Programación (Actividades Atrasadas)
      ws_data.push([]); // Espacio
      ws_data.push([]); // Espacio
      ws_data.push(['SEGUIMIENTO A LA PROGRAMACIÓN (ACTIVIDADES ATRASADAS)']);
      ws_data.push(['ÍTEM', 'DESCRIPCIÓN', 'UNIDAD', 'CANTIDAD PROGRAMADA', 'CANTIDAD EJECUTADA', 'PORCENTAJE DE ATRASO']);

      const delayedStartRowIndex = ws_data.length + 1;
      let hasDelayed = false;

      // Obtener presupuesto activo actual
      const activeItems = project.budgetVersions?.find(v => v.id === project.activeBudgetVersionId)?.items || project.budgetItems || [];
      const executableItems = activeItems.filter(i => i.type === 'item');

      executableItems.forEach((item) => {
        // Encontrar datos de avance
        const rowData = data.find((r) => r.itemCode === item.item);
        const executedQty = rowData ? (Number(rowData.executedQuantity) || 0) : 0;

        // Calcular cantidad programada teórica a la fecha de corte
        let progQty = 0;
        if (item.startDate && item.endDate) {
          const start = new Date(item.startDate + 'T00:00:00').getTime();
          const end = new Date(item.endDate + 'T23:59:59').getTime();
          const now = new Date().getTime();

          if (now >= end) {
            progQty = item.cantidad || 0;
          } else if (now >= start) {
            progQty = (item.cantidad || 0) * ((now - start) / Math.max(1, end - start));
          }
        }

        // Si ejecutó menos de lo programado, registrar retraso
        if (executedQty < progQty - 0.001) {
          hasDelayed = true;
          const delayPerc = progQty > 0 ? (progQty - executedQty) / progQty : 0;
          ws_data.push([
            item.item,
            item.descripcion,
            item.unidad,
            progQty,
            executedQty,
            delayPerc
          ]);
        }
      });

      if (!hasDelayed) {
        ws_data.push(['No se encuentran actividades atrasadas.', '', '', '', '', '']);
      }

      // Convertir a worksheet de SheetJS
      const ws = utils.aoa_to_sheet(ws_data);

      // Configurar anchos de columnas
      ws['!cols'] = [
        { wch: 10 }, // A (Ítem)
        { wch: 45 }, // B (Descripción)
        { wch: 8 },  // C (Unidad)
        { wch: 12 }, // D (Cantidad Contractual)
        { wch: 16 }, // E (Vlr Unitario)
        { wch: 18 }, // F (Vlr Total Contractual)
        { wch: 3 },  // G (Separador delgado)
        { wch: 12 }, // H (Cantidad Ejecutada)
        { wch: 18 }, // I (Vlr Ejecutado)
        { wch: 12 }  // J (% Ejec)
      ];

      // Formatear celdas (formatos numéricos)
      const range = utils.decode_range(ws['!ref'] || 'A1');
      for (let r = range.s.r; r <= range.e.r; r++) {
        for (let c = range.s.c; c <= range.e.c; c++) {
          const cellRef = utils.encode_cell({ r, c });
          const cell = ws[cellRef];
          if (!cell) continue;

          if (r >= 6 && r < subtotalRowIndex - 1) {
            // Filas de datos
            if (c === 3 || c === 7) {
              cell.z = '#,##0.00';
            } else if (c === 4 || c === 5 || c === 8) {
              cell.z = '"$"#,##0.00';
            } else if (c === 9) {
              cell.z = '0.00%';
            }
          } else if (r >= subtotalRowIndex - 1 && r <= totalRowIndex - 1) {
            // Fila de totales
            if (c === 5 || c === 8) {
              cell.z = '"$"#,##0.00';
            } else if (c === 9) {
              cell.z = '0.00%';
            }
          } else if (r >= delayedStartRowIndex - 1) {
            // Actividades atrasadas
            if (c === 3 || c === 4) {
              cell.z = '#,##0.00';
            } else if (c === 5) {
              cell.z = '0.00%';
            }
          }
        }
      }

      // Configurar combinaciones de celdas (merges)
      const merges = [
        { s: { r: 0, c: 0 }, e: { r: 0, c: 9 } }, // Título
        { s: { r: 1, c: 0 }, e: { r: 1, c: 9 } }, // Proyecto
        { s: { r: 2, c: 0 }, e: { r: 2, c: 9 } }, // Contratista
        { s: { r: 3, c: 0 }, e: { r: 3, c: 9 } }, // Fecha
        { s: { r: 5, c: 0 }, e: { r: 5, c: 5 } }, // CONDICIONES CONTRACTUALES header
        { s: { r: 5, c: 7 }, e: { r: 5, c: 9 } }  // AVANCE ACUMULADO header
      ];

      // Combinaciones para las etiquetas de totales de la A a la E
      merges.push({ s: { r: subtotalRowIndex - 1, c: 0 }, e: { r: subtotalRowIndex - 1, c: 4 } });
      merges.push({ s: { r: adminRowIndex - 1, c: 0 }, e: { r: adminRowIndex - 1, c: 4 } });
      merges.push({ s: { r: imprevRowIndex - 1, c: 0 }, e: { r: imprevRowIndex - 1, c: 4 } });
      merges.push({ s: { r: utilRowIndex - 1, c: 0 }, e: { r: utilRowIndex - 1, c: 4 } });
      merges.push({ s: { r: totalRowIndex - 1, c: 0 }, e: { r: totalRowIndex - 1, c: 4 } });

      // Combinaciones para la sección de seguimiento a la programación
      merges.push({ s: { r: totalRowIndex + 2, c: 0 }, e: { r: totalRowIndex + 2, c: 5 } });
      if (!hasDelayed) {
        merges.push({ s: { r: totalRowIndex + 4, c: 0 }, e: { r: totalRowIndex + 4, c: 5 } });
      }

      ws['!merges'] = merges;

      utils.book_append_sheet(wb, ws, sheetName);
      writeFile(wb, `${fileName}.xlsx`);
    } else {
      // Exportación estándar tabular fallback
      const ws = utils.json_to_sheet(data);
      const wb = utils.book_new();
      utils.book_append_sheet(wb, ws, sheetName);
      
      const range = utils.decode_range(ws['!ref'] || 'A1');
      const cols = [];
      for (let i = range.s.c; i <= range.e.c; i++) {
        cols.push({ wch: 20 });
      }
      ws['!cols'] = cols;

      writeFile(wb, `${fileName}.xlsx`);
    }
  } catch (error) {
    console.error('Error al exportar Excel:', error);
    alert('Error al generar el archivo Excel.');
  }
};
