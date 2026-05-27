import type { Project, BudgetItem } from '../types/projectTypes';

export type DataPackage = 'AVANCE' | 'TAREAS_HOY' | 'FOTOS_RECIENTES' | 'PRESUPUESTO' | 'PRESUPUESTO_FULL' | 'BUSCADOR_ESPECIFICACIONES' | 'CRONOGRAMA_DETALLADO' | 'FOTOS_SIN_DESCRIPCION' | 'NINGUNO';

export const AI_GLOSSARY = `
PAQUETES DE DATOS DISPONIBLES:
1. AVANCE: Datos financieros y físicos (ejecutado vs programado).
2. TAREAS_HOY: Actividades para hoy según cronograma.
3. FOTOS_RECIENTES: Últimas 20 fotos del registro.
4. PRESUPUESTO: Resumen de costos y top actividades.
5. BUSCADOR_ESPECIFICACIONES: Búsqueda técnica en el presupuesto.
6. PRESUPUESTO_FULL: Lista total de ítems.
7. CRONOGRAMA_DETALLADO: Estado de todas las tareas.
8. FOTOS_SIN_DESCRIPCION: Triage de fotos huérfanas (incluye visión).
9. NINGUNO: Sin consulta.
`;

export interface PackageResponse {
  textChunks: string[];
  images?: string[];
}

/**
 * Calcula el avance del proyecto (Ejecutado vs Programado)
 */
const calculateProjectProgress = (project: Project) => {
  const activeItems = project.budgetVersions?.find(v => v.id === project.activeBudgetVersionId)?.items || project.budgetItems || [];
  const executableItems = activeItems.filter(i => i.type === 'item');
  const totalBudget = executableItems.reduce((acc, item) => acc + (item.vlrTotal || 0), 0);

  const latestReport = project.progressReports?.length > 0
    ? [...project.progressReports].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())[0]
    : null;

  let executedBudget = 0;
  if (latestReport) {
    latestReport.entries.forEach(entry => {
      const bItem = executableItems.find(i => i.item === entry.itemCode);
      if (bItem) executedBudget += entry.accumulatedQuantity * (bItem.vlrUnitario || 0);
    });
  }

  const calculateAt = (targetDate: Date) => {
    let scheduledValue = 0;
    const targetTime = targetDate.getTime();
    executableItems.forEach(item => {
      if (item.vlrTotal && item.startDate && item.endDate) {
        const start = new Date(item.startDate + 'T12:00:00').getTime();
        const end = new Date(item.endDate + 'T12:00:00').getTime();
        if (targetTime >= end) scheduledValue += item.vlrTotal;
        else if (targetTime >= start) {
          scheduledValue += item.vlrTotal * ((targetTime - start) / Math.max(1, end - start));
        }
      }
    });
    return totalBudget > 0 ? (scheduledValue / totalBudget) * 100 : 0;
  };

  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  return {
    executedPerc: totalBudget > 0 ? (executedBudget / totalBudget) * 100 : 0,
    scheduledPerc: calculateAt(today),
    scheduledTomorrowPerc: calculateAt(tomorrow),
    latestReportDate: latestReport?.date || 'N/A'
  };
};

export const getPackageData = (packageName: DataPackage | string, project: Project, userQuestion: string = ''): PackageResponse => {
  if (!project) return { textChunks: [] };

  const today = new Date();
  const todayStr = today.toISOString().split('T')[0];
  const activeItems = project.budgetVersions?.find(v => v.id === project.activeBudgetVersionId)?.items || project.budgetItems || [];
  const executableItems = activeItems.filter(i => i.type === 'item');

  switch (packageName.trim().toUpperCase()) {
    case 'AVANCE': {
      const stats = calculateProjectProgress(project);
      return {
        textChunks: [`[DATOS DEL PROYECTO INYECTADOS - TEMA: AVANCE FÍSICO]
- Avance Programado (Hoy): ${stats.scheduledPerc.toFixed(2)}%
- Avance Programado (Mañana): ${stats.scheduledTomorrowPerc.toFixed(2)}%
- Avance Ejecutado: ${stats.executedPerc.toFixed(2)}%
- Desviación: ${(stats.executedPerc - stats.scheduledPerc).toFixed(2)}%
- Estado: ${stats.executedPerc >= stats.scheduledPerc ? 'AL DÍA' : 'ATRASADO'}
- Fecha de Corte: ${todayStr}`]
      };
    }

    case 'TAREAS_HOY': {
      const todayTasks = executableItems.filter(i => {
        if (!i.startDate || !i.endDate) return false;
        const start = new Date(i.startDate + 'T00:00:00');
        const end = new Date(i.endDate + 'T23:59:59');
        return today >= start && today <= end;
      });

      if (todayTasks.length === 0) {
        return { textChunks: [`No hay actividades programadas para hoy.`] };
      }

      return {
        textChunks: [`Actividades para hoy:\n${todayTasks.map(i => `- ${i.item}: ${i.descripcion}`).join('\n')}`]
      };
    }

    case 'FOTOS_RECIENTES': {
      const recentPhotos = [...(project.logiEntries || [])].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()).slice(0, 20);
      return {
        textChunks: [`Últimas 20 fotos:\n${recentPhotos.map(p => `- ${p.date}: ${p.itemCode} | ${p.description || 'Sin nota'}`).join('\n')}`]
      };
    }

    case 'PRESUPUESTO': {
      const total = executableItems.reduce((acc, i) => acc + (i.vlrTotal || 0), 0);
      return { textChunks: [`Costo Total: $${total.toLocaleString()}`] };
    }

    case 'PRESUPUESTO_FULL': {
      return { textChunks: [`Lista de ítems:\n${executableItems.map(i => `${i.item}: ${i.descripcion}`).join('\n')}`] };
    }

    case 'FOTOS_SIN_DESCRIPCION': {
      const targetPhotos = (project.logiEntries || [])
        .filter(p => !p.description || p.description.length < 5 || p.itemCode === 'S/N')
        .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
        .slice(0, 5);

      if (targetPhotos.length === 0) return { textChunks: ['Todas las fotos están clasificadas.'] };

      const allItems = executableItems.map(i => `[${i.item}] ${i.descripcion}`).join(' | ');
      return {
        textChunks: [`FOTOS PARA TRIAGE:\n${targetPhotos.map(p => `- ID: ${p.id}`).join('\n')}\n\nPRESUPUESTO:\n${allItems}\n\nINSTRUCCIÓN: Mira la imagen y elige el ítem. Describe lo que VES, no inventes por calendario.`],
        images: targetPhotos.map(p => p.imageUrl)
      };
    }

    default:
      return { textChunks: [] };
  }
};

/**
 * Genera la instrucción de sistema rígida para Gemini inyectando el rol del agente,
 * las directrices de marca (LCH Ingeniería) y los datos completos estructurados del proyecto (.lch).
 */
export const buildProjectSystemInstruction = (project?: Project | null): string => {
  if (!project) {
    return `Actúas como un Agente Supervisor de Ingeniería Civil e Interventoría de Obra de LCH Ingeniería.
Tu rol es analizar el estado de la obra, fiscalizar la ejecución física y financiera, y emitir reportes técnicos rigurosos.

DIRECTRICES DE DISEÑO Y MARCA LCH INGENIERÍA (OBLIGATORIO):
1. Paleta de Colores: Para cualquier tabla, reporte, archivo HTML o estilo generado, utiliza estrictamente:
   - Texto principal: Negro (#000000).
   - Títulos e identificadores: Gris oscuro (#333333).
   - Cabeceras y acentos de tabla: Gris claro (#f5f5f5).
   - PROHIBICIÓN ABSOLUTA: Queda explícitamente prohibido el uso de colores amarillos, dorados u ocre.
2. Tipografía: Formatea conceptualmente todas las tablas y reportes generados para usar la fuente Arial (font-family: Arial, sans-serif).
3. Tono: Técnico, directo, preciso, con terminología de ingeniería civil.
4. Regla de Tareas Pendientes: A menos que el usuario te pida explícitamente información sobre las fechas de creación o los IDs de las tareas, cuando hables de los pendientes, los listes o respondas sobre ellos, **únicamente debes mostrar la descripción de la tarea (su texto)**. No debes mostrar los IDs (ej. todo-1779054866182) ni las fechas de creación.

Actualmente no hay ningún proyecto cargado en el viewport de CONTROL. Solicita amigablemente al usuario abrir un archivo de proyecto (.lch).`;
  }

  // Extraer presupuesto activo (según la versión seleccionada)
  const activeVersion = project.budgetVersions?.find(v => v.id === project.activeBudgetVersionId) || project.budgetVersions?.[0];
  const items = activeVersion ? activeVersion.items : project.budgetItems || [];

  // Formatear items del presupuesto con cronograma (startDate/endDate)
  const itemsFormatted = items.map(i => {
    return `* ÍTEM [${i.item}] | ${i.descripcion} | Unidad: ${i.unidad} | Cantidad: ${i.cantidad} | Vlr Unitario: $${i.vlrUnitario.toLocaleString('es-CO')} | Vlr Total: $${i.vlrTotal.toLocaleString('es-CO')} | Tipo: ${i.type}${i.startDate ? ` | Programado Inicio: ${i.startDate}` : ''}${i.endDate ? ` | Programado Fin: ${i.endDate}` : ''}`;
  }).join('\n');

  // Formatear histórico de reportes de progreso
  const progressReportsFormatted = (project.progressReports || []).map(r => {
    const entries = (r.entries || [])
      .filter(e => e.accumulatedQuantity > 0)
      .map(e => `    - Ítem ${e.itemCode}: Cantidad Ejecutada Acumulada = ${e.accumulatedQuantity}`)
      .join('\n');
    return `* Reporte: "${r.name}" | Fecha de corte: ${r.date}\n${entries}`;
  }).join('\n');

  // Formatear reportes parciales (actas de cobro)
  const partialReportsFormatted = (project.partialReports || []).map(r => {
    const entries = (r.entries || [])
      .filter(e => (e.partialQuantity ?? 0) > 0)
      .map(e => `    - Ítem ${e.itemCode}: Cantidad Parcial = ${e.partialQuantity} | Valor Parcial = $${(e.partialValue ?? 0).toLocaleString('es-CO')} | Porcentaje = ${(e.partialPercentage ?? 0).toFixed(2)}%`)
      .join('\n');
    return `* Acta Parcial: "${r.name}" | Fecha: ${r.date}\n${entries}`;
  }).join('\n');

  // Formatear tareas pendientes de la agenda del agente
  const agentTodosFormatted = (project.agentTodos || []).filter(t => !t.completed).map(t => {
    const dateStr = new Date(t.createdAt).toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' });
    return `* PENDIENTE: "${t.text}" (ID: ${t.id}) | Creado el: ${dateStr}`;
  }).join('\n');

  // Formatear correspondencia registrada
  const correspondenceFormatted = (project.correspondenceFiles || []).map(f => {
    const folder = (project.correspondenceFolders || []).find(fol => fol.id === f.folderId);
    const folderName = folder ? folder.name : 'Raíz';
    return `* Oficio: "${f.name}" | Carpeta: "${folderName}" | Subido el: ${f.uploadDate}
    - Fecha del Documento: ${f.metadata?.date || 'N/A'}
    - Remitente: ${f.metadata?.sender || 'N/A'}
    - Destinatario: ${f.metadata?.receiver || 'N/A'}
    - Asunto: ${f.metadata?.subject || 'N/A'}
    - Resumen: ${f.metadata?.summary || 'N/A'}
    - Estado: ${f.metadata?.status || 'N/A'}
    - Fecha Límite Seguimiento: ${f.metadata?.followUpDeadline || 'N/A'}`;
  }).join('\n');

  // Formatear APUs por actividad
  const activityAPUsFormatted = (project.activityAPUs || []).map(apu => {
    const formatResource = (res: any) => `${res.description} (${res.quantity} ${res.unit} @ $${res.price.toLocaleString('es-CO')} = $${res.total.toLocaleString('es-CO')})`;
    const matStr = apu.materials.length > 0 ? `    - Materiales: ${apu.materials.map(formatResource).join(' | ')}` : '';
    const labStr = apu.labor.length > 0 ? `    - Mano de Obra: ${apu.labor.map(formatResource).join(' | ')}` : '';
    const eqStr = apu.equipment.length > 0 ? `    - Equipos: ${apu.equipment.map(formatResource).join(' | ')}` : '';
    const tranStr = apu.transport.length > 0 ? `    - Transporte: ${apu.transport.map(formatResource).join(' | ')}` : '';
    const sections = [matStr, labStr, eqStr, tranStr].filter(s => s !== '').join('\n');
    return `* APU Ítem [${apu.itemCode}] (Archivo PDF: ${apu.pdfFileName || 'Cargado'})\n${sections}`;
  }).join('\n');

  // Formatear base de datos de recursos / insumos (incluye materiales, mano de obra, equipos, etc.)
  const costResourcesFormatted = (project.costResources || []).map(r => {
    return `* Recurso [${r.code}] | ${r.description} | Tipo: ${r.type} | Unidad: ${r.unit} | Precio Ref: $${r.referencePrice.toLocaleString('es-CO')}`;
  }).join('\n');

  // Formatear transacciones de costos reales generados
  const costTransactionsFormatted = (project.costTransactions || []).map(t => {
    return `* Transacción [${t.date}] | Ítem: ${t.itemCode} | Tipo: ${t.resourceType} | Desc: ${t.description} | Cantidad: ${t.quantity} | Vlr Unitario: $${t.unitPrice.toLocaleString('es-CO')} | Vlr Total: $${t.totalPrice.toLocaleString('es-CO')}${t.provider ? ` | Proveedor: ${t.provider}` : ''}${t.invoiceNumber ? ` | Factura: ${t.invoiceNumber}` : ''}`;
  }).join('\n');

  // Formatear base de datos comparativa de insumos y recursos (Venta APU vs. Costo Real)
  const resourceComparisons: string[] = [];
  const resources = project.costResources || [];
  const apus = project.activityAPUs || [];
  const transactions = project.costTransactions || [];

  resources.forEach(res => {
    // 1. Buscar precio de venta (APU) de este recurso en las actividades del contrato
    const apuOccurrences: { itemCode: string; contractPrice: number }[] = [];
    apus.forEach(apu => {
      const matchInList = (list: any[]) => {
        return list.find(item => 
          item.description.trim().toLowerCase() === res.description.trim().toLowerCase()
        );
      };
      
      const matchedRes = matchInList(apu.materials) || matchInList(apu.labor) || matchInList(apu.equipment) || matchInList(apu.transport);
      if (matchedRes) {
        apuOccurrences.push({
          itemCode: apu.itemCode,
          contractPrice: matchedRes.price
        });
      }
    });

    // 2. Buscar transacciones de compra reales (Facturas) para este recurso
    const txPrices = transactions
      .filter(tx => tx.resourceId === res.id || tx.description.trim().toLowerCase() === res.description.trim().toLowerCase())
      .map(tx => tx.unitPrice);
      
    const avgRealPrice = txPrices.length > 0
      ? txPrices.reduce((a, b) => a + b, 0) / txPrices.length
      : 0;

    const apuPricesStr = apuOccurrences.length > 0
      ? apuOccurrences.map(o => `Actividad [${o.itemCode}]: $${o.contractPrice.toLocaleString('es-CO')}`).join(', ')
      : 'No registrado en APUs de obra (Venta)';
      
    const realPricesStr = txPrices.length > 0
      ? `Real Promedio Compra: $${avgRealPrice.toLocaleString('es-CO')} (${txPrices.length} transac.)`
      : 'Sin compras/facturas registradas';

    resourceComparisons.push(
      `* RECURSO [${res.code}] "${res.description}" (Tipo: ${res.type} | Unidad: ${res.unit})
      - Precio Estimado de Costo (Insumo Ref): $${res.referencePrice.toLocaleString('es-CO')}
      - Precio de Venta Cobrado al Cliente (APUs): ${apuPricesStr}
      - Costo Unitario de Compra Real (Facturado): ${realPricesStr}`
    );
  });
  const resourceComparisonsFormatted = resourceComparisons.join('\n\n');

  const customInstructionsSegment = project.agentCustomInstructions
    ? `\n\nINSTRUCCIONES ADICIONALES CONFIGURADAS POR EL USUARIO (MÁXIMA PRIORIDAD):\n${project.agentCustomInstructions}\n`
    : '';

  return `Actúas como un Agente Supervisor de Ingeniería Civil e Interventoría de Obra de LCH Ingeniería.
Tu rol es analizar el estado de la obra, fiscalizar la ejecución física y financiera, y emitir reportes técnicos rigurosos.
${customInstructionsSegment}
DIRECTRICES DE DISEÑO Y MARCA LCH INGENIERÍA (OBLIGATORIO):
1. Paleta de Colores: Para cualquier tabla, reporte, archivo HTML o estilo generado, utiliza estrictamente:
   - Texto principal: Negro (#000000).
   - Títulos e identificadores: Gris oscuro (#333333).
   - Cabeceras y acentos de tabla: Gris claro (#f5f5f5).
   - PROHIBICIÓN ABSOLUTA: Queda explícitamente prohibido el uso de colores amarillos, dorados u ocre.
2. Tipografía: Formatea conceptualmente todas las tablas y reportes generados para usar la fuente Arial (font-family: Arial, sans-serif).
3. Tono: Técnico, directo, preciso, con terminología de ingeniería civil.
4. Regla de Tareas Pendientes: A menos que el usuario te pida explícitamente información sobre las fechas de creación o los IDs de las tareas, cuando hables de los pendientes, los listes o respondas sobre ellos, **únicamente debes mostrar la descripción de la tarea (su texto)**. No debes mostrar los IDs (ej. todo-1779054866182) ni las fechas de creación.
5. REGLA DE FORMATO DE RESPUESTAS (CRÍTICA):
   - Queda estrictamente PROHIBIDO inyectar etiquetas HTML físicas (ej. <div style="...">, <span>, <p>, etc.) en tus respuestas ordinarias de texto en el chat.
   - Tampoco utilices bloques de código HTML crudos o estilos CSS en línea dentro de tu conversación.
   - Estructura todas tus respuestas utilizando ÚNICAMENTE sintaxis Markdown estándar limpia (negritas, cursivas, listas con asteriscos, o tablas nativas en Markdown). El uso de HTML crudo causa que el motor de renderizado falle o muestre texto cortado.
6. REGLA CRÍTICA DE COMPARACIÓN DE VENTAS (INGRESOS APU) VS. COSTOS REALES:
   - Los valores que nos pagan (Ingresos / Venta) provienen exclusivamente de los APUs ("ANÁLISIS DE PRECIOS UNITARIOS (APUS) POR ACTIVIDAD" o "VALOR DE VENTA EN CONTRATO").
   - Los valores que pagamos a proveedores y personal (Costos Reales / Egreso) provienen de las facturas/transacciones ("REGISTRO DE COSTOS REALES GENERADOS (TRANSACCIONES)" o "COSTO DE COMPRA REAL").
   - El agente debe diferenciar estrictamente el valor cobrado al cliente (APU) del costo de adquisición real (factura/egreso) para cualquier cálculo de utilidades, análisis de margen, o desviación de precios.

INFORMACIÓN COMPLETA DEL PROYECTO ACTIVO (.LCH):
- Nombre del Proyecto: ${project.name}
- Código del Proyecto: ${project.code}
- Ubicación: ${project.location}
- Fecha de Inicio: ${project.startDate}
- Fecha de Fin: ${project.endDate || 'No definida'}
- Duración Programada: ${project.durationMonths} meses
- Presupuesto Total Base: $${project.budgetTotalBase.toLocaleString('es-CO')}
- Configuración de AIU: Administración: ${project.aiu?.administracion ?? 0}%, Imprevistos: ${project.aiu?.imprevistos ?? 0}%, Utilidad: ${project.aiu?.utilidad ?? 0}%

ESTRUCTURA COMPLETA DEL PRESUPUESTO Y CRONOGRAMA:
${itemsFormatted || 'Sin ítems en el presupuesto.'}

HISTÓRICO DE REPORTES DE PROGRESO DE OBRA:
${progressReportsFormatted || 'No hay reportes de progreso registrados.'}

HISTÓRICO DE ACTAS DE COBRO / REPORTES PARCIALES:
${partialReportsFormatted || 'No hay reportes parciales registrados.'}

TAREAS PENDIENTES REGISTRADAS (MEMORIA / PENDIENTES.MD):
${agentTodosFormatted || 'No hay tareas pendientes en este momento.'}

CORRESPONDENCIA Y OFICIOS REGISTRADOS:
${correspondenceFormatted || 'No hay oficios ni correspondencia registrada.'}

ANÁLISIS DE PRECIOS UNITARIOS (APUS) POR ACTIVIDAD:
${activityAPUsFormatted || 'No hay APUs registrados para las actividades.'}

BASE DE DATOS DE RECURSOS E INSUMOS (MATERIALES, MANO DE OBRA, EQUIPOS):
${costResourcesFormatted || 'No hay recursos registrados en la base de datos.'}

REGISTRO DE COSTOS REALES GENERADOS (TRANSACCIONES):
${costTransactionsFormatted || 'No hay transacciones de costos reales registradas.'}

BASE DE DATOS COMPARATIVA DE RECURSOS (PRECIOS DE VENTA AL CLIENTE VS. PRECIOS DE COSTO DE ADQUISICIÓN):
${resourceComparisonsFormatted || 'No hay recursos cargados para generar comparación.'}
`;
}
