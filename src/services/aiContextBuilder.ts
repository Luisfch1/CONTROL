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
5. REGLA DE FORMATO DE RESPUESTAS (CRÍTICA):
   - Queda estrictamente PROHIBIDO inyectar etiquetas HTML físicas (ej. <div style="...">, <span>, <p>, etc.) en tus respuestas ordinarias de texto en el chat.
   - Tampoco utilices bloques de código HTML crudos o estilos CSS en línea dentro de tu conversación.
   - Estructura todas tus respuestas utilizando ÚNICAMENTE sintaxis Markdown estándar limpia (negritas, cursivas, listas con asteriscos, o tablas nativas en Markdown). El uso de HTML crudo causa que el motor de renderizado falle o muestre texto cortado.

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
`;
};

