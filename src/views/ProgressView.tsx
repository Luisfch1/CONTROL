import { useState, useRef, useMemo } from 'react';
import { useProjects } from '../context/ProjectsContext';
import { ChevronLeft, Plus, Calendar, Trash2, Download, Upload, X } from 'lucide-react';
import { format } from 'date-fns';
import { exportToExcel } from '../utils/excelExport';
import { parseRobustNumber } from '../utils/mathUtils';

const normalizeHeader = (val: any): string => {
  if (val === null || val === undefined) return '';
  return String(val).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
};

export default function ProgressView() {
  const { 
    getActiveProject, 
    addProgressReport, 
    updateProgressEntry, 
    importProgressEntries,
    removeProgressReport,
    columnWidths,
    updateColumnWidth,
    collapsedColumns,
    toggleColumnCollapse,
    closeProject
  } = useProjects();
  const project = getActiveProject();

  const budgetItems = useMemo(() => {
    if (!project) return [];
    const activeVersion = project.budgetVersions?.find(v => v.id === project.activeBudgetVersionId);
    return activeVersion?.items || project.budgetItems || [];
  }, [project]);
  
  const [selectedReportId, setSelectedReportId] = useState<string | null>(null);
  const [isCreatingReport, setIsCreatingReport] = useState(false);
  const [newReportDate, setNewReportDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [newReportName, setNewReportName] = useState('');
  const [pendingExcelImportData, setPendingExcelImportData] = useState<{ entries: { itemCode: string; accumulatedQuantity: number }[] } | null>(null);
  const newReportExcelInputRef = useRef<HTMLInputElement>(null);

  const colWidths = columnWidths.progress;
  const getColWidth = (key: string) => {
    if (collapsedColumns.progress.includes(key)) return 30;
    const width = colWidths[key] || 100;
    if (key === 'exec') {
      return Math.max(width, 180);
    }
    return width;
  };
  const isCollapsed = (key: string) => collapsedColumns.progress.includes(key);

  // --- COLUMN RESIZING LOGIC (NOW PERSISTENT) ---

  const resizingCol = useRef<string | null>(null);
  const startX = useRef<number>(0);
  const startWidth = useRef<number>(0);

  const onMouseDown = (colKey: string, e: React.MouseEvent) => {
    resizingCol.current = colKey;
    startX.current = e.pageX;
    startWidth.current = colWidths[colKey];
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };

  const onMouseMove = (e: MouseEvent) => {
    if (!resizingCol.current) return;
    const diff = e.pageX - startX.current;
    const newWidth = Math.max(40, startWidth.current + diff);
    updateColumnWidth('progress', resizingCol.current, newWidth);
  };

  const onMouseUp = () => {
    resizingCol.current = null;
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
    document.body.style.cursor = 'default';
    document.body.style.userSelect = 'auto';
  };

  const onDoubleClick = (colKey: string) => {
    if (!project) return;
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) return;
    context.font = '11px Space Grotesk'; // Match technical font
    
    let maxWidth = 40;
    
    budgetItems.forEach(item => {
      let text = '';
      if (colKey === 'item') text = String(item.item);
      if (colKey === 'descripcion') text = String(item.descripcion);
      // For progress view, calculations are needed for some columns
      const metrics = context.measureText(text);
      if (metrics.width + 20 > maxWidth) maxWidth = metrics.width + 20;
    });
    
    updateColumnWidth('progress', colKey, Math.min(600, maxWidth));
  };

  const totalTableWidth = Object.keys(colWidths).reduce((acc, key) => {
    return acc + getColWidth(key);
  }, 0);

  if (!project) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'hsl(var(--text-muted))' }}>
        Por favor, abra un proyecto activo.
      </div>
    );
  }

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(value);
  };

  const handleCreateReport = () => {
    if (!newReportName) {
      alert("Por favor, ingrese un nombre para el reporte.");
      return;
    }
    const reportId = crypto.randomUUID();
    addProgressReport(project.id, newReportDate, newReportName, reportId);

    if (pendingExcelImportData) {
      importProgressEntries(project.id, reportId, pendingExcelImportData.entries);
      setPendingExcelImportData(null);
    }

    setIsCreatingReport(false);
    setNewReportName('');

    setTimeout(() => {
      const updated = getActiveProject();
      if (updated && (window as any).electronAPI?.saveProject) {
        (window as any).electronAPI.saveProject(updated).catch(console.error);
      }
    }, 150);
  };

  const handleDownloadProgressTemplate = () => {
    if (!project) return;
    const lastReport = reports.length > 0 ? reports[reports.length - 1] : null;

    const templateData = budgetItems.map(item => {
      const prevEntry = lastReport?.entries.find(e => e.itemCode === item.item);
      const previousQty = prevEntry?.accumulatedQuantity || 0;

      return {
        'Ítem': item.item,
        'Descripción': item.descripcion,
        'Cant. Presupuesto': item.type === 'item' ? item.cantidad : '',
        'Vr. Unitario': item.type === 'item' ? item.vlrUnitario : '',
        'Vr. Total': item.type === 'item' ? item.vlrTotal : '',
        'Cant. Anterior': item.type === 'item' ? previousQty : '',
        'Cant. Actual (Llenar aquí)': '',
        'Cant. Acumulada (Opcional)': ''
      };
    });

    exportToExcel(templateData, `Plantilla_Avance_${project.name.replace(/\s+/g, '_')}`, 'Avance_Plantilla');
  };

  const handleNewReportExcelImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !project) return;

    try {
      const { read, utils } = await import('xlsx');
      const data = await file.arrayBuffer();
      const workbook = read(data);

      const sheetName = workbook.SheetNames.includes('Avance') ? 'Avance' : workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      const rows = utils.sheet_to_json<any[]>(worksheet, { header: 1 });

      let headerRowIdx = -1;
      for (let i = 0; i < Math.min(20, rows.length); i++) {
        const row = rows[i];
        if (row && row.some(cell => normalizeHeader(cell).includes('ITEM'))) {
          headerRowIdx = i;
          break;
        }
      }

      if (headerRowIdx === -1) {
        alert("No se pudo encontrar la fila de encabezados en el archivo Excel. Asegúrate de tener una columna llamada 'Ítem'.");
        if (newReportExcelInputRef.current) newReportExcelInputRef.current.value = '';
        return;
      }

      const headerRow = rows[headerRowIdx];
      let itemColIdx = -1;
      let acumColIdx = -1;
      let actColIdx = -1;

      for (let j = 0; j < headerRow.length; j++) {
        const cellNormalized = normalizeHeader(headerRow[j]);
        if (cellNormalized === 'ITEM' || cellNormalized === 'ITEM') {
          itemColIdx = j;
        } else if (cellNormalized.includes('ITEM') && itemColIdx === -1) {
          itemColIdx = j;
        } else if (cellNormalized.includes('ACUMULADA') || cellNormalized.includes('ACUMULADO') || cellNormalized === 'ACUM' || cellNormalized === 'ACUM.') {
          acumColIdx = j;
        } else if (cellNormalized.includes('ACTUAL') || cellNormalized === 'ACT' || cellNormalized === 'ACT.') {
          actColIdx = j;
        }
      }

      if (itemColIdx === -1) {
        alert("No se encontró la columna de código de 'Ítem' en el archivo Excel.");
        if (newReportExcelInputRef.current) newReportExcelInputRef.current.value = '';
        return;
      }

      if (acumColIdx === -1 && actColIdx === -1) {
        alert("No se encontró la columna de 'Cant. Acumulada' o 'Cant. Actual' en el archivo Excel.");
        if (newReportExcelInputRef.current) newReportExcelInputRef.current.value = '';
        return;
      }

      const budgetItemCodes = new Set(budgetItems.filter(i => i.type === 'item').map(i => String(i.item).trim()));
      const mismatchedItems: string[] = [];
      const parsedEntries: { itemCode: string; accumulatedQuantity: number }[] = [];
      
      const lastReport = reports.length > 0 ? reports[reports.length - 1] : null;

      for (let i = headerRowIdx + 1; i < rows.length; i++) {
        const row = rows[i];
        if (!row || row.length === 0) continue;

        const itemCode = String(row[itemColIdx] || '').trim();
        if (!itemCode || itemCode === '0' || itemCode === '#N/A') continue;

        if (!budgetItemCodes.has(itemCode)) {
          const isBudgetTitle = budgetItems.some(bi => bi.item === itemCode && bi.type !== 'item');
          if (!isBudgetTitle) {
            mismatchedItems.push(itemCode);
          }
          continue;
        }

        let newQty = 0;
        if (acumColIdx !== -1) {
          newQty = parseRobustNumber(row[acumColIdx]);
        } else if (actColIdx !== -1) {
          const prevEntry = lastReport?.entries.find(e => e.itemCode === itemCode);
          const previousQty = prevEntry?.accumulatedQuantity || 0;
          const actualQty = parseRobustNumber(row[actColIdx]);
          newQty = previousQty + actualQty;
        }

        parsedEntries.push({
          itemCode,
          accumulatedQuantity: newQty
        });
      }

      if (mismatchedItems.length > 0) {
        const confirmMsg = `Los siguientes ítems del archivo Excel no existen en el presupuesto activo de la obra:\n\n${mismatchedItems.join(', ')}\n\n¿Desea omitir estos ítems y continuar con la importación del avance, o cancelar?`;
        const proceed = window.confirm(confirmMsg);
        if (!proceed) {
          if (newReportExcelInputRef.current) newReportExcelInputRef.current.value = '';
          return;
        }
      }

      setPendingExcelImportData({ entries: parsedEntries });
      
      const fileNameClean = file.name.replace(/\.[^/.]+$/, "").replace(/Avance_/g, "").replace(/_/g, " ");
      setNewReportName(fileNameClean);
      setIsCreatingReport(true);

    } catch (err) {
      console.error("Error al importar Excel de avance nuevo:", err);
      alert("Hubo un error al procesar el archivo Excel. Asegúrate de que tenga un formato válido.");
    }

    if (newReportExcelInputRef.current) {
      newReportExcelInputRef.current.value = '';
    }
  };

  const reports = project.progressReports || [];
  const selectedReport = reports.find(r => r.id === selectedReportId);

  // Get previous report if exists
  const getPreviousReport = (reportId: string) => {
    const idx = reports.findIndex(r => r.id === reportId);
    if (idx > 0) return reports[idx - 1];
    return null;
  };

  const previousReport = selectedReport ? getPreviousReport(selectedReport.id) : null;

  // Calculate project totals for percentages
  const directCostTotal = budgetItems.reduce((acc, item) => item.type === 'item' ? acc + item.vlrTotal : acc, 0);
  const aiuPercentage = (project.aiu?.administracion || 0) + (project.aiu?.imprevistos || 0) + (project.aiu?.utilidad || 0);
  const contractTotal = directCostTotal * (1 + aiuPercentage / 100);

  const handleExportExcel = () => {
    if (!selectedReport) return;

    const dataToExport = budgetItems.map(item => {
      const entry = selectedReport.entries.find(e => e.itemCode === item.item);
      const accumulated = entry?.accumulatedQuantity || 0;
      const prevEntry = previousReport?.entries.find(e => e.itemCode === item.item);
      const previous = prevEntry?.accumulatedQuantity || 0;
      const actual = accumulated - previous;
      const balance = item.cantidad - accumulated;
      const executedValue = accumulated * item.vlrUnitario;
      const percActivity = item.cantidad > 0 ? (accumulated / item.cantidad) * 100 : 0;

      return {
        'Ítem': item.item,
        'Descripción': item.descripcion,
        'Cant. Presupuesto': item.type === 'item' ? item.cantidad : '',
        'Vr. Unitario': item.type === 'item' ? item.vlrUnitario : '',
        'Vr. Total Presupuesto': item.type === 'item' ? item.vlrTotal : '',
        'Cant. Anterior': item.type === 'item' ? previous : '',
        'Cant. Actual': item.type === 'item' ? actual : '',
        'Cant. Acumulada': item.type === 'item' ? accumulated : '',
        'Saldo': item.type === 'item' ? balance : '',
        '% Avance': item.type === 'item' ? `${percActivity.toFixed(1)}%` : '',
        'Valor Ejecutado': item.type === 'item' ? executedValue : '',
        'Tipo': item.type.toUpperCase()
      };
    });

    exportToExcel(dataToExport, `Avance_${selectedReport.name.replace(/\s+/g, '_')}`, 'Avance');
  };

  const progressExcelInputRef = useRef<HTMLInputElement>(null);

  const handleImportProgressExcel = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !project || !selectedReport) return;

    try {
      const { read, utils } = await import('xlsx');
      const data = await file.arrayBuffer();
      const workbook = read(data);

      const sheetName = workbook.SheetNames.includes('Avance') ? 'Avance' : workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      const rows = utils.sheet_to_json<any[]>(worksheet, { header: 1 });

      let headerRowIdx = -1;
      for (let i = 0; i < Math.min(20, rows.length); i++) {
        const row = rows[i];
        if (row && row.some(cell => normalizeHeader(cell).includes('ITEM'))) {
          headerRowIdx = i;
          break;
        }
      }

      if (headerRowIdx === -1) {
        alert("No se pudo encontrar la fila de encabezados en el archivo Excel. Asegúrate de tener una columna llamada 'Ítem'.");
        if (progressExcelInputRef.current) progressExcelInputRef.current.value = '';
        return;
      }

      const headerRow = rows[headerRowIdx];
      let itemColIdx = -1;
      let acumColIdx = -1;
      let actColIdx = -1;

      for (let j = 0; j < headerRow.length; j++) {
        const cellNormalized = normalizeHeader(headerRow[j]);
        if (cellNormalized === 'ITEM' || cellNormalized === 'ITEM') {
          itemColIdx = j;
        } else if (cellNormalized.includes('ITEM') && itemColIdx === -1) {
          itemColIdx = j;
        } else if (cellNormalized.includes('ACUMULADA') || cellNormalized.includes('ACUMULADO') || cellNormalized === 'ACUM' || cellNormalized === 'ACUM.') {
          acumColIdx = j;
        } else if (cellNormalized.includes('ACTUAL') || cellNormalized === 'ACT' || cellNormalized === 'ACT.') {
          actColIdx = j;
        }
      }

      if (itemColIdx === -1) {
        alert("No se encontró la columna de código de 'Ítem' en el archivo Excel.");
        if (progressExcelInputRef.current) progressExcelInputRef.current.value = '';
        return;
      }

      if (acumColIdx === -1 && actColIdx === -1) {
        alert("No se encontró la columna de 'Cant. Acumulada' o 'Cant. Actual' en el archivo Excel.");
        if (progressExcelInputRef.current) progressExcelInputRef.current.value = '';
        return;
      }

      const budgetItemCodes = new Set(budgetItems.filter(i => i.type === 'item').map(i => String(i.item).trim()));
      const mismatchedItems: string[] = [];
      const parsedEntries: { itemCode: string; accumulatedQuantity: number }[] = [];

      for (let i = headerRowIdx + 1; i < rows.length; i++) {
        const row = rows[i];
        if (!row || row.length === 0) continue;

        const itemCode = String(row[itemColIdx] || '').trim();
        if (!itemCode || itemCode === '0' || itemCode === '#N/A') continue;

        // Comprobar si el ítem existe en el presupuesto
        if (!budgetItemCodes.has(itemCode)) {
          const isBudgetTitle = budgetItems.some(bi => bi.item === itemCode && bi.type !== 'item');
          if (!isBudgetTitle) {
            mismatchedItems.push(itemCode);
          }
          continue;
        }

        let newQty = 0;
        if (acumColIdx !== -1) {
          newQty = parseRobustNumber(row[acumColIdx]);
        } else if (actColIdx !== -1) {
          const prevEntry = previousReport?.entries.find(e => e.itemCode === itemCode);
          const previousQty = prevEntry?.accumulatedQuantity || 0;
          const actualQty = parseRobustNumber(row[actColIdx]);
          newQty = previousQty + actualQty;
        }

        parsedEntries.push({
          itemCode,
          accumulatedQuantity: newQty
        });
      }

      if (mismatchedItems.length > 0) {
        const confirmMsg = `Los siguientes ítems del archivo Excel no existen en el presupuesto activo de la obra:\n\n${mismatchedItems.join(', ')}\n\n¿Desea omitir estos ítems y continuar con la importación del avance, o cancelar?`;
        const proceed = window.confirm(confirmMsg);
        if (!proceed) {
          if (progressExcelInputRef.current) progressExcelInputRef.current.value = '';
          return;
        }
      }

      importProgressEntries(project.id, selectedReport.id, parsedEntries);

      setTimeout(() => {
        const updatedProject = getActiveProject();
        if (updatedProject && (window as any).electronAPI?.saveProject) {
          (window as any).electronAPI.saveProject(updatedProject)
            .then(() => console.log("[Excel Progress Import] Guardado físico automático exitoso."))
            .catch(console.error);
        }
      }, 100);

      alert(`Se importó el avance de obra correctamente. Se actualizaron ${parsedEntries.length} ítems.`);

    } catch (err) {
      console.error("Error al importar Excel de avance:", err);
      alert("Hubo un error al procesar el archivo Excel de avance. Asegúrate de que tenga un formato válido.");
    }

    if (progressExcelInputRef.current) {
      progressExcelInputRef.current.value = '';
    }
  };

  if (!selectedReport && !isCreatingReport) {
    return (
      <div>
        <div className="page-header">
          <h2 className="page-title">Avance de Obra</h2>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <input
              type="file"
              accept=".xlsx,.xls,.csv"
              style={{ display: 'none' }}
              ref={newReportExcelInputRef}
              onChange={handleNewReportExcelImport}
            />
            <button className="btn btn-secondary" onClick={handleDownloadProgressTemplate} style={{ display: 'flex', alignItems: 'center', gap: '8px' }} title="Descargar plantilla de avance con ítems activos">
              <Download size={16} /> Plantilla Excel
            </button>
            <button className="btn btn-secondary" onClick={() => newReportExcelInputRef.current?.click()} style={{ display: 'flex', alignItems: 'center', gap: '8px' }} title="Subir reporte de avance nuevo desde Excel">
              <Upload size={16} /> Importar Excel
            </button>
            <button className="btn btn-primary btn-pulse" onClick={() => {
              setPendingExcelImportData(null);
              setIsCreatingReport(true);
            }}>
              <Plus size={16} /> Registrar Avance
            </button>
            <div style={{ width: '1px', height: '24px', background: 'var(--border-color)', margin: '0 8px', opacity: 0.3 }}></div>
            <button 
              className="btn btn-ghost" 
              onClick={closeProject}
              title="Cerrar Proyecto"
              style={{ color: 'hsl(var(--text-muted))', padding: '8px', borderRadius: '50%' }}
              onMouseEnter={(e) => { e.currentTarget.style.color = 'hsl(var(--text-primary))'; e.currentTarget.style.background = 'hsla(var(--text-primary), 0.1)' }}
              onMouseLeave={(e) => { e.currentTarget.style.color = 'hsl(var(--text-muted))'; e.currentTarget.style.background = 'none' }}
            >
              <X size={20} />
            </button>
          </div>
        </div>
        
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 'var(--spacing-md)', marginTop: 'var(--spacing-lg)' }}>
          {reports.length === 0 ? (
            <div style={{ gridColumn: '1/-1', textAlign: 'center', padding: 'var(--spacing-xl)', color: 'hsl(var(--text-muted))', border: '2px dashed hsl(var(--border-color))', borderRadius: 'var(--radius-lg)' }}>
              No hay reportes de avance registrados. Haga clic en "Registrar Avance" para comenzar.
            </div>
          ) : (
            reports.map(report => (
              <div 
                key={report.id} 
                onClick={() => setSelectedReportId(report.id)}
                className="glass-card"
                style={{ 
                  cursor: 'pointer',
                  borderLeft: '4px solid hsl(var(--accent-primary))',
                  position: 'relative',
                  padding: 'var(--spacing-lg)'
                }}
                onMouseOver={(e) => e.currentTarget.style.transform = 'translateY(-4px)'}
                onMouseOut={(e) => e.currentTarget.style.transform = 'translateY(0)'}
              >
                <button 
                  onClick={(e) => {
                    e.stopPropagation();
                    if (window.confirm(`¿Estás seguro de que deseas eliminar el reporte "${report.name}"?`)) {
                      removeProgressReport(project.id, report.id);
                    }
                  }}
                  style={{
                    position: 'absolute',
                    top: '12px',
                    right: '12px',
                    background: 'none',
                    border: 'none',
                    color: 'hsl(var(--destructive))',
                    cursor: 'pointer',
                    padding: '4px',
                    borderRadius: '50%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    zIndex: 2
                  }}
                  title="Eliminar reporte"
                >
                  <Trash2 size={16} />
                </button>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 'var(--spacing-sm)' }}>
                  <span style={{ fontSize: '0.8rem', color: 'hsl(var(--text-muted))', display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <Calendar size={14} /> {report.date}
                  </span>
                </div>
                <h3 style={{ fontSize: '1.1rem', fontWeight: 'bold', color: 'hsl(var(--text-primary))' }}>{report.name}</h3>
                <div style={{ marginTop: 'var(--spacing-md)', fontSize: '0.85rem', color: 'hsl(var(--text-secondary))' }}>
                  {report.entries.filter(e => e.accumulatedQuantity > 0).length} ítems reportados
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    );
  }

  if (isCreatingReport) {
    return (
      <div>
        <div className="page-header">
          <button className="btn btn-secondary" onClick={() => setIsCreatingReport(false)}>
            <ChevronLeft size={16} /> Volver
          </button>
          <h2 className="page-title">Nuevo Reporte de Avance</h2>
        </div>
        
        <div className="glass-panel" style={{ maxWidth: '500px', margin: 'var(--spacing-xl) auto', padding: 'var(--spacing-xl)' }}>
          <div style={{ marginBottom: 'var(--spacing-lg)' }}>
            <label style={{ display: 'block', marginBottom: 'var(--spacing-xs)', fontSize: '0.9rem', color: 'hsl(var(--text-secondary))' }}>Nombre del Reporte / Corte</label>
            <input 
              type="text" 
              className="input" 
              placeholder="Ej: Corte No. 1 - Marzo 2026" 
              value={newReportName}
              onChange={e => setNewReportName(e.target.value)}
              autoFocus
            />
          </div>
          <div style={{ marginBottom: 'var(--spacing-xl)' }}>
            <label style={{ display: 'block', marginBottom: 'var(--spacing-xs)', fontSize: '0.9rem', color: 'hsl(var(--text-secondary))' }}>Fecha de Corte</label>
            <input 
              type="date" 
              className="input" 
              value={newReportDate}
              onChange={e => setNewReportDate(e.target.value)}
            />
          </div>
          <button className="btn btn-primary" style={{ width: '100%' }} onClick={handleCreateReport}>
            Crear Reporte de Avance
          </button>
        </div>
      </div>
    );
  }

  // --- REPORT VIEW MODE ---
  
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', width: '100%' }}>
      <style>{`
        .col-header-container {
          position: relative;
          display: flex;
          align-items: center;
          justify-content: center;
          height: 100%;
          text-align: center;
        }
        .collapse-btn {
          position: absolute;
          top: 4px;
          right: 4px;
          width: 6px;
          height: 6px;
          background: hsl(var(--primary-neon-hsl));
          border: none;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          opacity: 0;
          transition: all 0.2s ease;
          padding: 0;
          z-index: 10;
          box-shadow: 0 0 8px hsl(var(--primary-neon-hsl) / 0.5);
        }
        .col-header-container:hover .collapse-btn {
          opacity: 1;
        }
        .collapsed-dot {
          display: flex;
          justify-content: center;
          align-items: center;
          width: 100%;
          color: hsl(var(--accent-primary));
          font-weight: bold;
          height: 100%;
        }

        /* Línea de enfoque técnica en hover */
        .progress-row {
          position: relative;
          transition: all 0.2s ease;
        }
        .progress-row::after {
          content: '';
          position: absolute;
          bottom: 0;
          left: 0;
          width: 100%;
          height: 1px;
          background: hsl(var(--primary-neon));
          opacity: 0;
          transition: opacity 0.2s ease;
          pointer-events: none;
          z-index: 10;
          transform: scaleY(0.5);
          transform-origin: bottom;
        }
        .progress-row:hover::after {
          opacity: 1;
        }

        /* Barra de desplazamiento personalizada, delgada y minimalista */
        .floating-scroll::-webkit-scrollbar {
          height: 6px; 
          width: 6px;
        }
        .floating-scroll::-webkit-scrollbar-track {
          background: transparent;
        }
        .floating-scroll::-webkit-scrollbar-thumb {
          background: hsl(var(--primary-neon-hsl) / 0.5);
          border-radius: 10px;
          transition: background 0.3s;
        }
        .floating-scroll::-webkit-scrollbar-thumb:hover {
          background: hsl(var(--primary-neon-hsl));
        }
      `}</style>
      <div className="page-header" style={{ flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-md)' }}>
          <button className="btn btn-secondary" style={{ padding: '8px' }} onClick={() => setSelectedReportId(null)}>
            <ChevronLeft size={20} />
          </button>
          <div>
            <h2 className="page-title" style={{ margin: 0 }}>{selectedReport?.name}</h2>
            <span style={{ fontSize: '0.8rem', color: 'hsl(var(--text-muted))' }}>Fecha de corte: {selectedReport?.date}</span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 'var(--spacing-sm)' }}>
          <input
            type="file"
            accept=".xlsx,.xls,.csv"
            style={{ display: 'none' }}
            ref={progressExcelInputRef}
            onChange={handleImportProgressExcel}
          />
          <button className="btn btn-secondary" onClick={() => progressExcelInputRef.current?.click()} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Upload size={16} /> Importar Excel
          </button>
          <button className="btn btn-secondary" onClick={handleExportExcel} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Download size={16} /> Exportar Excel
          </button>
        </div>
      </div>

      <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, overflow: 'hidden', padding: 0 }}>
        {/* Contenedor Principal (Desplazamiento Horizontal Sincronizado) */}
        <div className="progress-scroll-container floating-scroll" style={{ flex: 1, overflowX: 'auto', overflowY: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <div style={{ width: '100%', minWidth: `${totalTableWidth + 32}px`, display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
            {/* Cabezal de Doble Nivel (ADN Programación) */}
            <div style={{ flexShrink: 0 }}>
              {/* Nivel 1: Grupos */}
              <div style={{ 
                display: 'flex', height: '35px', alignItems: 'center', padding: '0 16px',
                borderBottom: '1px solid hsl(var(--border-color) / 0.3)', fontWeight: 'bold', fontSize: '0.65rem',
                color: 'hsl(var(--text-muted))', backgroundColor: 'hsla(var(--bg-tertiary), 0.4)',
                backdropFilter: 'blur(10px)', width: '100%',
                textTransform: 'uppercase', letterSpacing: '0.1em'
              }}>
                <div style={{ width: getColWidth('item') + getColWidth('descripcion') }}></div>
                <div style={{ width: getColWidth('cant_p') + getColWidth('vr_unit') + getColWidth('vr_total'), textAlign: 'center', borderLeft: '1px solid hsl(var(--border-color) / 0.3)' }}>Presupuesto</div>
                <div style={{ width: getColWidth('ant') + getColWidth('act') + getColWidth('acum') + getColWidth('saldo'), textAlign: 'center', borderLeft: '1px solid hsl(var(--border-color) / 0.3)' }}>Cantidades</div>
                <div style={{ width: getColWidth('p_act') + getColWidth('p_cap') + getColWidth('p_cont') + getColWidth('p_total'), textAlign: 'center', borderLeft: '1px solid hsl(var(--border-color) / 0.3)' }}>Porcentajes de Avance</div>
                <div style={{ width: getColWidth('exec'), borderLeft: '1px solid hsl(var(--border-color) / 0.3)' }}></div>
              </div>
              
              {/* Nivel 2: Columnas Detalle */}
              <div style={{ 
                display: 'flex', height: '44px', alignItems: 'center', padding: '0 16px',
                borderBottom: '1px solid hsl(var(--border-color))', fontWeight: 'bold', fontSize: '0.7rem',
                color: 'hsl(var(--text-secondary))', backgroundColor: 'hsla(var(--bg-tertiary), 0.4)',
                backdropFilter: 'blur(10px)', width: '100%',
                textTransform: 'uppercase'
              }}>
                {[
                  { key: 'item', label: 'Ítem' },
                  { key: 'descripcion', label: 'Descripción' },
                  { key: 'cant_p', label: 'Cant.', align: 'center' },
                  { key: 'vr_unit', label: 'Vr. Unit', align: 'right' },
                  { key: 'vr_total', label: 'Vr. Total', align: 'right' },
                  { key: 'ant', label: 'Ant.', align: 'center' },
                  { key: 'act', label: 'Act.', align: 'center' },
                  { key: 'acum', label: 'Acum.', align: 'center' },
                  { key: 'saldo', label: 'Saldo', align: 'center' },
                  { key: 'p_act', label: '% Act.', align: 'center' },
                  { key: 'p_cap', label: '% Cap.', align: 'center' },
                  { key: 'p_cont', label: '% Cont.', align: 'center' },
                  { key: 'p_total', label: '% Total.', align: 'center' },
                  { key: 'exec', label: 'Vr. Ejecutado', align: 'right' }
                ].map(col => {
                  const collapsed = isCollapsed(col.key);
                  const width = getColWidth(col.key);
                  return (
                    <div key={col.key} className="col-header-container" style={{ width: `${width}px`, textAlign: (col.align as any) || 'left' }}>
                      {collapsed ? (
                        <div className="collapsed-dot" onClick={() => toggleColumnCollapse('progress', col.key)} style={{ cursor: 'pointer' }}>•</div>
                      ) : (
                        <>
                          {col.label}
                          <button className="collapse-btn" onClick={() => toggleColumnCollapse('progress', col.key)} title="Colapsar columna" />
                          <div className="col-resizer" onMouseDown={(e) => onMouseDown(col.key, e)} onDoubleClick={() => onDoubleClick(col.key)} />
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Zona de Scroll (Vertical) */}
            <div className="floating-scroll" style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden' }}>
              <div style={{ width: '100%' }}>
            {(() => {
              const rows: any[] = [];
              let currentChapterPrefix = '';
              let chapterBudgetTotal = 0;
              let chapterExecutedTotal = 0;
              let grandExecutedTotal = 0;

              const chapterTotalsMap: { [key: string]: number } = {};
              budgetItems.forEach(item => {
                if (item.type === 'item') {
                  const prefix = item.item.split(/[\.\s]/)[0];
                  chapterTotalsMap[prefix] = (chapterTotalsMap[prefix] || 0) + item.vlrTotal;
                }
              });

              for (let i = 0; i < budgetItems.length; i++) {
                const item = budgetItems[i];
                const mainChapter = item.item.split(/[\.\s]/)[0];

                if (currentChapterPrefix !== '' && mainChapter !== '' && currentChapterPrefix !== mainChapter) {
                  const chapterProgress = (chapterExecutedTotal / chapterBudgetTotal) * 100;
                  rows.push(
                    <div key={`subtotal-${currentChapterPrefix}`} style={{ 
                      display: 'flex', alignItems: 'center', height: '35px', padding: '0 16px',
                      backgroundColor: 'hsla(var(--primary-neon), 0.05)', borderBottom: '1px solid hsl(var(--border-color))',
                      fontWeight: '800', fontSize: '0.75rem', color: 'hsl(var(--primary-neon))'
                    }}>
                      <div style={{ width: getColWidth('item'), flexShrink: 0 }}></div>
                      <div style={{ width: getColWidth('descripcion') + getColWidth('cant_p') + getColWidth('vr_unit'), textAlign: 'right', paddingRight: '12px', flexShrink: 0 }}>SUBTOTAL {currentChapterPrefix}</div>
                      <div style={{ width: getColWidth('vr_total'), textAlign: 'right', paddingRight: '4px', flexShrink: 0 }}>{formatCurrency(chapterBudgetTotal)}</div>
                      <div style={{ width: getColWidth('ant') + getColWidth('act') + getColWidth('acum') + getColWidth('saldo') + getColWidth('p_act') + getColWidth('p_cap') + getColWidth('p_cont') + getColWidth('p_total'), flexShrink: 0 }}></div>
                      <div style={{ width: getColWidth('exec'), textAlign: 'right', paddingRight: '4px', flexShrink: 0, color: 'hsl(var(--primary-neon))', whiteSpace: 'nowrap' }}>
                        {formatCurrency(chapterExecutedTotal)} <span style={{ fontSize: '0.6rem', opacity: 0.8 }}>({chapterProgress.toFixed(1)}%)</span>
                      </div>
                    </div>
                  );
                  chapterBudgetTotal = 0;
                  chapterExecutedTotal = 0;
                }

                currentChapterPrefix = mainChapter;
                const isHeader = item.type === 'title' || item.type === 'subtitle';

                const entry = selectedReport?.entries.find(e => e.itemCode === item.item);
                const accumulated = entry?.accumulatedQuantity || 0;
                const prevEntry = previousReport?.entries.find(e => e.itemCode === item.item);
                const previous = prevEntry?.accumulatedQuantity || 0;
                const actual = accumulated - previous;
                const balance = item.cantidad - accumulated;
                const executedValue = accumulated * item.vlrUnitario;
                
                if (item.type === 'item') {
                  chapterBudgetTotal += item.vlrTotal;
                  chapterExecutedTotal += executedValue;
                  grandExecutedTotal += executedValue;
                }

                const percActivity = item.cantidad > 0 ? (accumulated / item.cantidad) * 100 : 0;
                const chapterTotalVal = chapterTotalsMap[mainChapter] || 1;
                const percChapter = (executedValue / chapterTotalVal) * 100;
                const percContract = (executedValue / contractTotal) * 100;

                rows.push(
                  <div key={item.item + i} className="progress-row" style={{ 
                    display: 'flex', alignItems: 'flex-start', minHeight: '35px', padding: '0 16px',
                    backgroundColor: isHeader ? 'hsla(var(--bg-tertiary), 0.3)' : 'transparent',
                    borderBottom: '1px solid hsl(var(--border-color))',
                    fontSize: '0.75rem', fontWeight: isHeader ? 'bold' : 'normal',
                    position: 'relative'
                  }}>
                    {[
                      { key: 'item', content: item.item, color: isHeader ? 'hsl(var(--primary-neon))' : 'inherit' },
                      { key: 'descripcion', content: item.descripcion, className: 'expandable-description' },
                      { key: 'cant_p', content: isHeader ? '' : item.cantidad.toLocaleString(undefined, { minimumFractionDigits: 2 }), align: 'center', color: 'hsl(var(--text-muted))' },
                      { key: 'vr_unit', content: isHeader ? '' : formatCurrency(item.vlrUnitario), align: 'right', color: 'hsl(var(--text-muted))' },
                      { key: 'vr_total', content: isHeader ? '' : formatCurrency(item.vlrTotal), align: 'right', fontWeight: '600' },
                      { key: 'ant', content: isHeader ? '' : previous.toLocaleString(undefined, { minimumFractionDigits: 2 }), align: 'center', backgroundColor: 'hsla(var(--bg-tertiary), 0.1)' },
                      { key: 'act', content: isHeader ? '' : actual.toLocaleString(undefined, { minimumFractionDigits: 2 }), align: 'center', backgroundColor: 'hsla(var(--bg-tertiary), 0.1)', color: actual > 0 ? 'hsl(var(--success))' : 'inherit' },
                      { key: 'acum', content: isHeader ? '' : (
                        <input 
                          type="number" 
                          step="0.01"
                          value={accumulated || ''} 
                          onChange={(e) => updateProgressEntry(project.id, selectedReport!.id, item.item, parseFloat(e.target.value) || 0)}
                          style={{ width: '90%', background: 'transparent', border: 'none', borderBottom: '1px dashed hsl(var(--primary-neon))', color: 'hsl(var(--primary-neon))', textAlign: 'center', fontSize: '0.75rem' }}
                        />
                      ), align: 'center', backgroundColor: 'hsla(var(--primary-neon), 0.05)' },
                      { key: 'saldo', content: isHeader ? '' : balance.toLocaleString(undefined, { minimumFractionDigits: 2 }), align: 'center', color: balance < 0 ? 'hsl(var(--destructive))' : 'hsl(var(--text-muted))' },
                      { key: 'p_act', content: isHeader ? '' : `${percActivity.toFixed(1)}%`, align: 'center' },
                      { key: 'p_cap', content: isHeader ? '' : `${percChapter.toFixed(2)}%`, align: 'center', color: 'hsl(var(--text-muted))' },
                      { key: 'p_cont', content: isHeader ? '' : `${percContract.toFixed(2)}%`, align: 'center', color: 'hsl(var(--text-muted))' },
                      { key: 'p_total', content: isHeader ? '' : `${percActivity.toFixed(1)}%`, align: 'center', fontWeight: 'bold' },
                      { key: 'exec', content: isHeader ? '' : formatCurrency(executedValue), align: 'right', fontWeight: 'bold', color: 'hsl(var(--primary-neon))' },
                    ].map(col => {
                      const collapsed = isCollapsed(col.key);
                      const width = getColWidth(col.key);
                      return (
                        <div key={col.key} style={{ 
                          width: `${width}px`, 
                          flexShrink: 0, 
                          paddingTop: '8px',
                          paddingBottom: '8px',
                          textAlign: (col.align as any) || 'left',
                          color: col.color || 'inherit',
                          backgroundColor: col.backgroundColor || 'transparent',
                          overflow: 'hidden',
                          fontWeight: col.fontWeight || 'inherit',
                          paddingRight: col.align === 'right' ? '4px' : '0'
                        }}>
                          {collapsed ? '' : (
                            <div className={col.className}>{col.content}</div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              }

              if (currentChapterPrefix !== '') {
                const chapterProgress = (chapterExecutedTotal / chapterBudgetTotal) * 100;
                rows.push(
                  <div key={`subtotal-last`} style={{ 
                    display: 'flex', alignItems: 'center', height: '35px', padding: '0 16px',
                    backgroundColor: 'hsla(var(--primary-neon), 0.05)', borderBottom: '1px solid hsl(var(--border-color))',
                    fontWeight: '800', fontSize: '0.75rem', color: 'hsl(var(--primary-neon))'
                  }}>
                    <div style={{ width: getColWidth('item'), flexShrink: 0 }}></div>
                    <div style={{ width: getColWidth('descripcion') + getColWidth('cant_p') + getColWidth('vr_unit'), textAlign: 'right', paddingRight: '12px', flexShrink: 0 }}>SUBTOTAL {currentChapterPrefix}</div>
                    <div style={{ width: getColWidth('vr_total'), textAlign: 'right', paddingRight: '4px', flexShrink: 0 }}>{formatCurrency(chapterBudgetTotal)}</div>
                    <div style={{ width: getColWidth('ant') + getColWidth('act') + getColWidth('acum') + getColWidth('saldo') + getColWidth('p_act') + getColWidth('p_cap') + getColWidth('p_cont') + getColWidth('p_total'), flexShrink: 0 }}></div>
                    <div style={{ width: getColWidth('exec'), textAlign: 'right', paddingRight: '4px', flexShrink: 0, color: 'hsl(var(--primary-neon))', whiteSpace: 'nowrap' }}>
                      {formatCurrency(chapterExecutedTotal)} <span style={{ fontSize: '0.6rem', opacity: 0.8 }}>({chapterProgress.toFixed(1)}%)</span>
                    </div>
                  </div>
                );
              }

              const totalContractExec = grandExecutedTotal * (1 + aiuPercentage / 100);
              const totalProgressPercentage = (grandExecutedTotal / directCostTotal) * 100;

              rows.push(
                <div key="final-totals" style={{ display: 'flex', alignItems: 'center', height: '35px', padding: '0 16px', backgroundColor: 'hsla(var(--bg-tertiary), 0.4)', borderBottom: '1px solid hsl(var(--border-color))', fontWeight: 'bold', fontSize: '0.8rem', width: '100%', minWidth: 'max-content' }}>
                  <div style={{ width: getColWidth('item') + getColWidth('descripcion') + getColWidth('cant_p') + getColWidth('vr_unit'), textAlign: 'right', paddingRight: '12px', color: 'hsl(var(--text-muted))', flexShrink: 0 }}>TOTAL COSTO DIRECTO</div>
                  <div style={{ width: getColWidth('vr_total'), textAlign: 'right', paddingRight: '4px', flexShrink: 0 }}>{formatCurrency(directCostTotal)}</div>
                  <div style={{ width: getColWidth('ant') + getColWidth('act') + getColWidth('acum') + getColWidth('saldo') + getColWidth('p_act') + getColWidth('p_cap') + getColWidth('p_cont') + getColWidth('p_total'), flexShrink: 0 }}></div>
                  <div style={{ width: getColWidth('exec'), textAlign: 'right', paddingRight: '4px', color: 'hsl(var(--success))', whiteSpace: 'nowrap', flexShrink: 0 }}>
                    {formatCurrency(grandExecutedTotal)} <span style={{ fontSize: '0.65rem', opacity: 0.8 }}>({totalProgressPercentage.toFixed(2)}%)</span>
                  </div>
                </div>
              );

              rows.push(
                <div key="final-aiu" style={{ display: 'flex', alignItems: 'center', height: '35px', padding: '0 16px', backgroundColor: 'hsla(var(--bg-tertiary), 0.2)', borderBottom: '1px solid hsl(var(--border-color))', fontWeight: 'bold', fontSize: '0.8rem', width: '100%', minWidth: 'max-content' }}>
                  <div style={{ width: getColWidth('item') + getColWidth('descripcion') + getColWidth('cant_p') + getColWidth('vr_unit'), textAlign: 'right', paddingRight: '12px', flexShrink: 0 }}>A.I.U. ({aiuPercentage}%)</div>
                  <div style={{ width: getColWidth('vr_total'), textAlign: 'right', paddingRight: '4px', flexShrink: 0 }}>{formatCurrency(directCostTotal * (aiuPercentage/100))}</div>
                  <div style={{ width: getColWidth('ant') + getColWidth('act') + getColWidth('acum') + getColWidth('saldo') + getColWidth('p_act') + getColWidth('p_cap') + getColWidth('p_cont') + getColWidth('p_total'), flexShrink: 0 }}></div>
                  <div style={{ width: getColWidth('exec'), textAlign: 'right', paddingRight: '4px', flexShrink: 0 }}>{formatCurrency(grandExecutedTotal * (aiuPercentage/100))}</div>
                </div>
              );

              rows.push(
                <div key="final-contract" style={{ display: 'flex', alignItems: 'center', height: '35px', padding: '0 16px', backgroundColor: 'hsl(var(--primary-neon))', color: '#000', fontWeight: '900', fontSize: '0.9rem', width: '100%', minWidth: 'max-content' }}>
                  <div style={{ width: getColWidth('item') + getColWidth('descripcion') + getColWidth('cant_p') + getColWidth('vr_unit'), textAlign: 'right', paddingRight: '12px', flexShrink: 0 }}>TOTAL CONTRATO</div>
                  <div style={{ width: getColWidth('vr_total'), textAlign: 'right', paddingRight: '4px', flexShrink: 0 }}>{formatCurrency(contractTotal)}</div>
                  <div style={{ width: getColWidth('ant') + getColWidth('act') + getColWidth('acum') + getColWidth('saldo') + getColWidth('p_act') + getColWidth('p_cap') + getColWidth('p_cont') + getColWidth('p_total'), flexShrink: 0 }}></div>
                  <div style={{ width: getColWidth('exec'), textAlign: 'right', paddingRight: '4px', whiteSpace: 'nowrap', flexShrink: 0 }}>
                    {formatCurrency(totalContractExec)} <span style={{ fontSize: '0.7rem', fontWeight: 'bold', opacity: 0.7 }}>({totalProgressPercentage.toFixed(2)}%)</span>
                  </div>
                </div>
              );

              return rows;
            })()}
          </div>
        </div>
      </div>
    </div>
  </div>
</div>
  );
}
