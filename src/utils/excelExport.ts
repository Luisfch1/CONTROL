import { utils, writeFile } from 'xlsx';

/**
 * Exporta un array de objetos a un archivo Excel (.xlsx)
 * @param data Array de objetos con la data a exportar
 * @param fileName Nombre del archivo (sin extensión)
 * @param sheetName Nombre de la hoja de cálculo
 */
export const exportToExcel = (data: any[], fileName: string, sheetName: string = 'Datos') => {
  try {
    const ws = utils.json_to_sheet(data);
    const wb = utils.book_new();
    utils.book_append_sheet(wb, ws, sheetName);
    
    // Auto-ajustar ancho de columnas básico
    const range = utils.decode_range(ws['!ref'] || 'A1');
    const cols = [];
    for (let i = range.s.c; i <= range.e.c; i++) {
      cols.push({ wch: 20 }); // Ancho por defecto
    }
    ws['!cols'] = cols;

    writeFile(wb, `${fileName}.xlsx`);
  } catch (error) {
    console.error('Error al exportar Excel:', error);
    alert('Error al generar el archivo Excel.');
  }
};
