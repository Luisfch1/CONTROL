import { useState, useRef, useMemo } from 'react';
import { useProjects } from '../context/ProjectsContext';
import { ChevronLeft, Plus, Calendar, Trash2, Download, X, Receipt } from 'lucide-react';
import { format } from 'date-fns';
import { exportToExcel } from '../utils/excelExport';

export default function ParcialesView() {
  const { 
    getActiveProject, 
    addPartialReport, 
    updatePartialEntry, 
    removePartialReport,
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

  const colWidths = columnWidths.parciales;
  const getColWidth = (key: string) => collapsedColumns.parciales.includes(key) ? 30 : colWidths[key];
  const isCollapsed = (key: string) => collapsedColumns.parciales.includes(key);

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
    updateColumnWidth('parciales', resizingCol.current, newWidth);
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
    context.font = '11px Space Grotesk';
    
    let maxWidth = 40;
    
    budgetItems.forEach(item => {
      let text = '';
      if (colKey === 'item') text = String(item.item);
      if (colKey === 'descripcion') text = String(item.descripcion);
      const metrics = context.measureText(text);
      if (metrics.width + 20 > maxWidth) maxWidth = metrics.width + 20;
    });
    
    updateColumnWidth('parciales', colKey, Math.min(600, maxWidth));
  };

  const totalTableWidth = Object.keys(colWidths).reduce((acc, key) => {
    return acc + (isCollapsed(key) ? 30 : colWidths[key]);
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
      alert("Por favor, ingrese un nombre para el acta.");
      return;
    }
    addPartialReport(project.id, newReportDate, newReportName);
    setIsCreatingReport(false);
    setNewReportName('');
  };

  const reports = project.partialReports || [];
  const selectedReport = reports.find(r => r.id === selectedReportId);

  // Helper to fetch physical accumulated up to the actas date
  const getPhysicalAccumulatedForDate = (itemCode: string, reportDate: string) => {
    const progressReports = project.progressReports || [];
    const reportsBeforeOrEqual = progressReports.filter(r => r.date <= reportDate);
    if (reportsBeforeOrEqual.length === 0) return 0;
    const sorted = [...reportsBeforeOrEqual].sort((a, b) => a.date.localeCompare(b.date));
    const latestReport = sorted[sorted.length - 1];
    const entry = latestReport.entries.find(e => e.itemCode === itemCode);
    return entry?.accumulatedQuantity || 0;
  };

  // Calculate project totals for percentages
  const directCostTotal = budgetItems.reduce((acc, item) => item.type === 'item' ? acc + item.vlrTotal : acc, 0);
  const aiuPercentage = (project.aiu?.administracion || 0) + (project.aiu?.imprevistos || 0) + (project.aiu?.utilidad || 0);
  const contractTotal = directCostTotal * (1 + aiuPercentage / 100);

  const handleExportExcel = () => {
    if (!selectedReport) return;

    const dataToExport = budgetItems.map(item => {
      const entry = selectedReport.entries?.find(e => e.itemCode === item.item);
      const partialQty = entry?.partialQuantity || 0;
      const partialVal = entry?.partialValue || 0;
      const partialPerc = entry?.partialPercentage || 0;
      const physicalAccum = getPhysicalAccumulatedForDate(item.item, selectedReport.date);

      return {
        'Ítem': item.item,
        'Descripción': item.descripcion,
        'Unidad': item.type === 'item' ? item.unidad : '',
        'Vr. Unitario': item.type === 'item' ? item.vlrUnitario : '',
        'Cant. Contratada': item.type === 'item' ? item.cantidad : '',
        'Vr. Total Contratado': item.type === 'item' ? item.vlrTotal : '',
        'Cant. Ejecutada Acumulada': item.type === 'item' ? physicalAccum : '',
        'Cant. Parcial': item.type === 'item' ? partialQty : '',
        'Vr. Parcial': item.type === 'item' ? partialVal : '',
        '% Pagado': item.type === 'item' ? `${partialPerc.toFixed(2)}%` : '',
        'Tipo': item.type.toUpperCase()
      };
    });

    exportToExcel(dataToExport, `Acta_Parcial_${selectedReport.name.replace(/\s+/g, '_')}`, 'Acta Parcial');
  };

  if (!selectedReport && !isCreatingReport) {
    return (
      <div>
        <div className="page-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <Receipt size={24} style={{ color: 'hsl(var(--accent-primary))' }} />
            <h2 className="page-title">Actas Parciales</h2>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button className="btn btn-primary btn-pulse" onClick={() => setIsCreatingReport(true)}>
              <Plus size={16} /> Registrar Parcial
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
              No hay actas parciales registradas. Haga clic en "Registrar Parcial" para comenzar.
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
                    if (window.confirm(`¿Estás seguro de que deseas eliminar el acta parcial "${report.name}"?`)) {
                      removePartialReport(project.id, report.id);
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
                  title="Eliminar acta"
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
                  {report.entries?.filter(e => e.partialQuantity > 0).length || 0} ítems valorizados
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
          <h2 className="page-title">Nueva Acta Parcial</h2>
        </div>
        
        <div className="glass-panel" style={{ maxWidth: '500px', margin: 'var(--spacing-xl) auto', padding: 'var(--spacing-xl)' }}>
          <div style={{ marginBottom: 'var(--spacing-lg)' }}>
            <label style={{ display: 'block', marginBottom: 'var(--spacing-xs)', fontSize: '0.9rem', color: 'hsl(var(--text-secondary))' }}>Nombre de la Acta / Periodo</label>
            <input 
              type="text" 
              className="input" 
              placeholder="Ej: Acta Parcial No. 1 - Mayo 2026" 
              value={newReportName}
              onChange={e => setNewReportName(e.target.value)}
              autoFocus
            />
          </div>
          <div style={{ marginBottom: 'var(--spacing-xl)' }}>
            <label style={{ display: 'block', marginBottom: 'var(--spacing-xs)', fontSize: '0.9rem', color: 'hsl(var(--text-secondary))' }}>Fecha de Valuación</label>
            <input 
              type="date" 
              className="input" 
              value={newReportDate}
              onChange={e => setNewReportDate(e.target.value)}
            />
          </div>
          <button className="btn btn-primary" style={{ width: '100%' }} onClick={handleCreateReport}>
            Crear Acta Parcial
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
        .parciales-row {
          position: relative;
          transition: all 0.2s ease;
        }
        .parciales-row::after {
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
        .parciales-row:hover::after {
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
            <span style={{ fontSize: '0.8rem', color: 'hsl(var(--text-muted))' }}>Fecha de valuación: {selectedReport?.date}</span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 'var(--spacing-sm)' }}>
          <button className="btn btn-secondary" onClick={handleExportExcel} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Download size={16} /> Exportar Excel
          </button>
        </div>
      </div>

      <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, overflow: 'hidden', padding: 0 }}>
        {/* Cabezal de Doble Nivel (ADN Programación) */}
        <div style={{ flexShrink: 0, overflow: 'hidden' }}>
          {/* Nivel 1: Grupos */}
          <div style={{ 
            display: 'flex', height: '35px', alignItems: 'center', padding: '0 16px',
            borderBottom: '1px solid hsl(var(--border-color) / 0.3)', fontWeight: 'bold', fontSize: '0.65rem',
            color: 'hsl(var(--text-muted))', backgroundColor: 'hsla(var(--bg-tertiary), 0.4)',
            backdropFilter: 'blur(10px)', width: '100%', minWidth: `${totalTableWidth}px`,
            textTransform: 'uppercase', letterSpacing: '0.1em'
          }}>
            <div style={{ width: getColWidth('item') + getColWidth('descripcion') + getColWidth('unidad') }}></div>
            <div style={{ width: getColWidth('vr_unit') + getColWidth('cant_p') + getColWidth('vr_total'), textAlign: 'center', borderLeft: '1px solid hsl(var(--border-color) / 0.3)' }}>Presupuesto</div>
            <div style={{ width: getColWidth('cant_ejec_acum'), textAlign: 'center', borderLeft: '1px solid hsl(var(--border-color) / 0.3)' }}>Avance Físico</div>
            <div style={{ width: getColWidth('cant_parcial') + getColWidth('vr_parcial') + getColWidth('p_pagado'), textAlign: 'center', borderLeft: '1px solid hsl(var(--border-color) / 0.3)' }}>Valuación Parcial</div>
          </div>
          
          {/* Nivel 2: Columnas Detalle */}
          <div style={{ 
            display: 'flex', height: '44px', alignItems: 'center', padding: '0 16px',
            borderBottom: '1px solid hsl(var(--border-color))', fontWeight: 'bold', fontSize: '0.7rem',
            color: 'hsl(var(--text-secondary))', backgroundColor: 'hsla(var(--bg-tertiary), 0.4)',
            backdropFilter: 'blur(10px)', width: '100%', minWidth: `${totalTableWidth}px`,
            textTransform: 'uppercase'
          }}>
            {[
              { key: 'item', label: 'Ítem' },
              { key: 'descripcion', label: 'Descripción' },
              { key: 'unidad', label: 'Unidad', align: 'center' },
              { key: 'vr_unit', label: 'Vr. Unit', align: 'right' },
              { key: 'cant_p', label: 'Cantidad', align: 'center' },
              { key: 'vr_total', label: 'Vr. Total', align: 'right' },
              { key: 'cant_ejec_acum', label: 'Cant. Ejec. Acum', align: 'center' },
              { key: 'cant_parcial', label: 'Cant. Parcial', align: 'center' },
              { key: 'vr_parcial', label: 'Vr. Parcial', align: 'right' },
              { key: 'p_pagado', label: '% Pagado', align: 'center' }
            ].map(col => {
              const collapsed = isCollapsed(col.key);
              const width = getColWidth(col.key);
              return (
                <div key={col.key} className="col-header-container" style={{ width: `${width}px`, textAlign: (col.align as any) || 'left' }}>
                  {collapsed ? (
                    <div className="collapsed-dot" onClick={() => toggleColumnCollapse('parciales', col.key)} style={{ cursor: 'pointer' }}>•</div>
                  ) : (
                    <>
                      {col.label}
                      <button className="collapse-btn" onClick={() => toggleColumnCollapse('parciales', col.key)} title="Colapsar columna" />
                      <div className="col-resizer" onMouseDown={(e) => onMouseDown(col.key, e)} onDoubleClick={() => onDoubleClick(col.key)} />
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Zona de Scroll */}
        <div className="floating-scroll" style={{ flex: 1 }}>
          <div style={{ width: '100%', minWidth: `${totalTableWidth}px` }}>
            {(() => {
              const rows: any[] = [];
              let currentChapterPrefix = '';
              let chapterBudgetTotal = 0;
              let chapterExecutedTotal = 0;
              let grandExecutedTotal = 0;

              for (let i = 0; i < budgetItems.length; i++) {
                const item = budgetItems[i];
                const mainChapter = item.item.split(/[\.\s]/)[0];

                if (currentChapterPrefix !== '' && mainChapter !== '' && currentChapterPrefix !== mainChapter) {
                  const chapterProgress = chapterBudgetTotal > 0 ? (chapterExecutedTotal / chapterBudgetTotal) * 100 : 0;
                  rows.push(
                    <div key={`subtotal-${currentChapterPrefix}`} style={{ 
                      display: 'flex', alignItems: 'center', height: '35px', padding: '0 16px',
                      backgroundColor: 'hsla(var(--primary-neon), 0.05)', borderBottom: '1px solid hsl(var(--border-color))',
                      fontWeight: '800', fontSize: '0.75rem', color: 'hsl(var(--primary-neon))'
                    }}>
                      <div style={{ width: getColWidth('item'), flexShrink: 0 }}></div>
                      <div style={{ width: getColWidth('descripcion') + getColWidth('unidad') + getColWidth('vr_unit') + getColWidth('cant_p'), textAlign: 'right', paddingRight: '12px', flexShrink: 0 }}>SUBTOTAL {currentChapterPrefix}</div>
                      <div style={{ width: getColWidth('vr_total'), textAlign: 'right', paddingRight: '4px', flexShrink: 0 }}>{formatCurrency(chapterBudgetTotal)}</div>
                      <div style={{ width: getColWidth('cant_ejec_acum') + getColWidth('cant_parcial'), flexShrink: 0 }}></div>
                      <div style={{ width: getColWidth('vr_parcial'), textAlign: 'right', paddingRight: '4px', flexShrink: 0, color: 'hsl(var(--primary-neon))', whiteSpace: 'nowrap' }}>
                        {formatCurrency(chapterExecutedTotal)}
                      </div>
                      <div style={{ width: getColWidth('p_pagado'), textAlign: 'center', flexShrink: 0, color: 'hsl(var(--primary-neon))', fontSize: '0.65rem' }}>
                        ({chapterProgress.toFixed(2)}%)
                      </div>
                    </div>
                  );
                  chapterBudgetTotal = 0;
                  chapterExecutedTotal = 0;
                }

                currentChapterPrefix = mainChapter;
                const isHeader = item.type === 'title' || item.type === 'subtitle';

                const entry = selectedReport?.entries?.find(e => e.itemCode === item.item);
                const partialQty = entry?.partialQuantity || 0;
                const partialVal = entry?.partialValue || 0;
                const partialPerc = entry?.partialPercentage || 0;

                const physicalAccum = isHeader ? 0 : getPhysicalAccumulatedForDate(item.item, selectedReport!.date);
                
                if (item.type === 'item') {
                  chapterBudgetTotal += item.vlrTotal;
                  chapterExecutedTotal += partialVal;
                  grandExecutedTotal += partialVal;
                }

                rows.push(
                  <div key={item.item + i} className="parciales-row" style={{ 
                    display: 'flex', alignItems: 'flex-start', minHeight: '35px', padding: '0 16px',
                    backgroundColor: isHeader ? 'hsla(var(--bg-tertiary), 0.3)' : 'transparent',
                    borderBottom: '1px solid hsl(var(--border-color))',
                    fontSize: '0.75rem', fontWeight: isHeader ? 'bold' : 'normal',
                    position: 'relative'
                  }}>
                    {[
                      { key: 'item', content: item.item, color: isHeader ? 'hsl(var(--primary-neon))' : 'inherit' },
                      { key: 'descripcion', content: item.descripcion, className: 'expandable-description' },
                      { key: 'unidad', content: isHeader ? '' : item.unidad, align: 'center', color: 'hsl(var(--text-muted))' },
                      { key: 'vr_unit', content: isHeader ? '' : formatCurrency(item.vlrUnitario), align: 'right', color: 'hsl(var(--text-muted))' },
                      { key: 'cant_p', content: isHeader ? '' : item.cantidad.toLocaleString(undefined, { minimumFractionDigits: 2 }), align: 'center', color: 'hsl(var(--text-muted))' },
                      { key: 'vr_total', content: isHeader ? '' : formatCurrency(item.vlrTotal), align: 'right', fontWeight: '600' },
                      { key: 'cant_ejec_acum', content: isHeader ? '' : physicalAccum.toLocaleString(undefined, { minimumFractionDigits: 2 }), align: 'center', backgroundColor: 'hsla(var(--bg-tertiary), 0.1)' },
                      { key: 'cant_parcial', content: isHeader ? '' : (
                        <input 
                          type="number" 
                          step="0.0001"
                          value={partialQty || ''} 
                          onChange={(e) => updatePartialEntry(project.id, selectedReport!.id, item.item, { partialQuantity: parseFloat(e.target.value) || 0 })}
                          style={{ width: '90%', background: 'transparent', border: 'none', borderBottom: '1px dashed hsl(var(--primary-neon))', color: 'hsl(var(--primary-neon))', textAlign: 'center', fontSize: '0.75rem' }}
                        />
                      ), align: 'center', backgroundColor: 'hsla(var(--primary-neon), 0.03)' },
                      { key: 'vr_parcial', content: isHeader ? '' : (
                        <input 
                          type="number" 
                          step="1"
                          value={partialVal || ''} 
                          onChange={(e) => updatePartialEntry(project.id, selectedReport!.id, item.item, { partialValue: parseFloat(e.target.value) || 0 })}
                          style={{ width: '90%', background: 'transparent', border: 'none', borderBottom: '1px dashed hsl(var(--primary-neon))', color: 'hsl(var(--primary-neon))', textAlign: 'right', fontSize: '0.75rem' }}
                        />
                      ), align: 'right', backgroundColor: 'hsla(var(--primary-neon), 0.03)', fontWeight: 'bold' },
                      { key: 'p_pagado', content: isHeader ? '' : (
                        <input 
                          type="number" 
                          step="0.01"
                          value={partialPerc || ''} 
                          onChange={(e) => updatePartialEntry(project.id, selectedReport!.id, item.item, { partialPercentage: parseFloat(e.target.value) || 0 })}
                          style={{ width: '90%', background: 'transparent', border: 'none', borderBottom: '1px dashed hsl(var(--primary-neon))', color: 'hsl(var(--primary-neon))', textAlign: 'center', fontSize: '0.75rem' }}
                        />
                      ), align: 'center', backgroundColor: 'hsla(var(--primary-neon), 0.03)' }
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
                const chapterProgress = chapterBudgetTotal > 0 ? (chapterExecutedTotal / chapterBudgetTotal) * 100 : 0;
                rows.push(
                  <div key={`subtotal-last`} style={{ 
                    display: 'flex', alignItems: 'center', height: '35px', padding: '0 16px',
                    backgroundColor: 'hsla(var(--primary-neon), 0.05)', borderBottom: '1px solid hsl(var(--border-color))',
                    fontWeight: '800', fontSize: '0.75rem', color: 'hsl(var(--primary-neon))'
                  }}>
                    <div style={{ width: getColWidth('item'), flexShrink: 0 }}></div>
                    <div style={{ width: getColWidth('descripcion') + getColWidth('unidad') + getColWidth('vr_unit') + getColWidth('cant_p'), textAlign: 'right', paddingRight: '12px', flexShrink: 0 }}>SUBTOTAL {currentChapterPrefix}</div>
                    <div style={{ width: getColWidth('vr_total'), textAlign: 'right', paddingRight: '4px', flexShrink: 0 }}>{formatCurrency(chapterBudgetTotal)}</div>
                    <div style={{ width: getColWidth('cant_ejec_acum') + getColWidth('cant_parcial'), flexShrink: 0 }}></div>
                    <div style={{ width: getColWidth('vr_parcial'), textAlign: 'right', paddingRight: '4px', flexShrink: 0, color: 'hsl(var(--primary-neon))', whiteSpace: 'nowrap' }}>
                      {formatCurrency(chapterExecutedTotal)}
                    </div>
                    <div style={{ width: getColWidth('p_pagado'), textAlign: 'center', flexShrink: 0, color: 'hsl(var(--primary-neon))', fontSize: '0.65rem' }}>
                      ({chapterProgress.toFixed(2)}%)
                    </div>
                  </div>
                );
              }

              const totalContractExec = grandExecutedTotal * (1 + aiuPercentage / 100);
              const totalProgressPercentage = directCostTotal > 0 ? (grandExecutedTotal / directCostTotal) * 100 : 0;

              rows.push(
                <div key="final-totals" style={{ display: 'flex', alignItems: 'center', height: '35px', padding: '0 16px', backgroundColor: 'hsla(var(--bg-tertiary), 0.4)', borderBottom: '1px solid hsl(var(--border-color))', fontWeight: 'bold', fontSize: '0.8rem' }}>
                  <div style={{ width: getColWidth('item') + getColWidth('descripcion') + getColWidth('unidad') + getColWidth('vr_unit') + getColWidth('cant_p'), textAlign: 'right', paddingRight: '12px', color: 'hsl(var(--text-muted))' }}>TOTAL COSTO DIRECTO</div>
                  <div style={{ width: getColWidth('vr_total'), textAlign: 'right', paddingRight: '4px' }}>{formatCurrency(directCostTotal)}</div>
                  <div style={{ width: getColWidth('cant_ejec_acum') + getColWidth('cant_parcial') }}></div>
                  <div style={{ width: getColWidth('vr_parcial'), textAlign: 'right', paddingRight: '4px', color: 'hsl(var(--success))', whiteSpace: 'nowrap' }}>
                    {formatCurrency(grandExecutedTotal)}
                  </div>
                  <div style={{ width: getColWidth('p_pagado'), textAlign: 'center', color: 'hsl(var(--success))' }}>
                    ({totalProgressPercentage.toFixed(2)}%)
                  </div>
                </div>
              );

              rows.push(
                <div key="final-aiu" style={{ display: 'flex', alignItems: 'center', height: '35px', padding: '0 16px', backgroundColor: 'hsla(var(--bg-tertiary), 0.2)', borderBottom: '1px solid hsl(var(--border-color))', fontWeight: 'bold', fontSize: '0.8rem' }}>
                  <div style={{ width: getColWidth('item') + getColWidth('descripcion') + getColWidth('unidad') + getColWidth('vr_unit') + getColWidth('cant_p'), textAlign: 'right', paddingRight: '12px' }}>A.I.U. ({aiuPercentage}%)</div>
                  <div style={{ width: getColWidth('vr_total'), textAlign: 'right', paddingRight: '4px' }}>{formatCurrency(directCostTotal * (aiuPercentage/100))}</div>
                  <div style={{ width: getColWidth('cant_ejec_acum') + getColWidth('cant_parcial') }}></div>
                  <div style={{ width: getColWidth('vr_parcial'), textAlign: 'right', paddingRight: '4px' }}>{formatCurrency(grandExecutedTotal * (aiuPercentage/100))}</div>
                  <div style={{ width: getColWidth('p_pagado') }}></div>
                </div>
              );

              rows.push(
                <div key="final-contract" style={{ display: 'flex', alignItems: 'center', height: '35px', padding: '0 16px', backgroundColor: 'hsl(var(--primary-neon))', color: '#000', fontWeight: '900', fontSize: '0.9rem' }}>
                  <div style={{ width: getColWidth('item') + getColWidth('descripcion') + getColWidth('unidad') + getColWidth('vr_unit') + getColWidth('cant_p'), textAlign: 'right', paddingRight: '12px' }}>TOTAL CONTRATO</div>
                  <div style={{ width: getColWidth('vr_total'), textAlign: 'right', paddingRight: '4px' }}>{formatCurrency(contractTotal)}</div>
                  <div style={{ width: getColWidth('cant_ejec_acum') + getColWidth('cant_parcial') }}></div>
                  <div style={{ width: getColWidth('vr_parcial'), textAlign: 'right', paddingRight: '4px', whiteSpace: 'nowrap' }}>
                    {formatCurrency(totalContractExec)}
                  </div>
                  <div style={{ width: getColWidth('p_pagado'), textAlign: 'center', fontWeight: 'bold' }}>
                    ({totalProgressPercentage.toFixed(2)}%)
                  </div>
                </div>
              );

              return rows;
            })()}
          </div>
        </div>
      </div>
    </div>
  );
}
