import { useState, useMemo, useRef, useEffect } from 'react';
import { useProjects } from '../context/ProjectsContext';
import { Plus, Download, Edit2, Check, X } from 'lucide-react';
import { differenceInDays, addDays, min, max, parseISO, format } from 'date-fns';
import { es } from 'date-fns/locale';

export default function ScheduleView() {
  const {
    getActiveProject,
    updateBudgetItemDates,
    addBudgetItem,
    importMsProjectXml,
    closeProject,
    columnWidths,
    updateColumnWidth,
    collapsedColumns,
    toggleColumnCollapse
  } = useProjects();
  const project = getActiveProject();

  const budgetItems = useMemo(() => {
    if (!project) return [];
    const activeVersion = project.budgetVersions?.find(v => v.id === project.activeBudgetVersionId);
    return activeVersion?.items || project.budgetItems || [];
  }, [project]);

  const [editingRowIndex, setEditingRowIndex] = useState<number | null>(null);
  const [editStartDate, setEditStartDate] = useState('');
  const [editEndDate, setEditEndDate] = useState('');

  const fileInputRef = useRef<HTMLInputElement>(null);
  const leftScrollRef = useRef<HTMLDivElement>(null);
  const rightScrollRef = useRef<HTMLDivElement>(null);
  const headerScrollRef = useRef<HTMLDivElement>(null);
  const [rowHeights, setRowHeights] = useState<number[]>([]);
  const rowRefs = useRef<(HTMLDivElement | null)[]>([]);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  // Cursor vertical para el diagrama de Gantt
  const [ganttCursorX, setGanttCursorX] = useState<number | null>(null);
  const [ganttHoveredDayIndex, setGanttHoveredDayIndex] = useState<number | null>(null);
  const ganttBodyRef = useRef<HTMLDivElement>(null);

  const bottomScrollRef = useRef<HTMLDivElement>(null);

  // Sincronización de scroll
  const handleLeftScroll = (e: React.UIEvent<HTMLDivElement>) => {
    if (rightScrollRef.current && rightScrollRef.current.scrollTop !== e.currentTarget.scrollTop) {
      rightScrollRef.current.scrollTop = e.currentTarget.scrollTop;
    }
  };

  const handleRightScroll = (e: React.UIEvent<HTMLDivElement>) => {
    if (leftScrollRef.current && leftScrollRef.current.scrollTop !== e.currentTarget.scrollTop) {
      leftScrollRef.current.scrollTop = e.currentTarget.scrollTop;
    }
    if (headerScrollRef.current && headerScrollRef.current.scrollLeft !== e.currentTarget.scrollLeft) {
      headerScrollRef.current.scrollLeft = e.currentTarget.scrollLeft;
    }
    if (bottomScrollRef.current && bottomScrollRef.current.scrollLeft !== e.currentTarget.scrollLeft) {
      bottomScrollRef.current.scrollLeft = e.currentTarget.scrollLeft;
    }
  };

  const handleBottomScroll = (e: React.UIEvent<HTMLDivElement>) => {
    if (rightScrollRef.current && rightScrollRef.current.scrollLeft !== e.currentTarget.scrollLeft) {
      rightScrollRef.current.scrollLeft = e.currentTarget.scrollLeft;
    }
    if (headerScrollRef.current && headerScrollRef.current.scrollLeft !== e.currentTarget.scrollLeft) {
      headerScrollRef.current.scrollLeft = e.currentTarget.scrollLeft;
    }
  };

  // Sincronización de alturas orgánica (Premium sync)
  useEffect(() => {
    const observers = rowRefs.current.map((ref, index) => {
      if (!ref) return null;
      const observer = new ResizeObserver(entries => {
        for (let entry of entries) {
          const height = entry.contentRect.height;
          setRowHeights(prev => {
            const next = [...prev];
            next[index] = height;
            return next;
          });
        }
      });
      observer.observe(ref);
      return observer;
    });

    return () => observers.forEach(o => o?.disconnect());
  }, [budgetItems.length]);

  const handleEditClick = (index: number, currentStart?: string, currentEnd?: string) => {
    setEditingRowIndex(index);
    setEditStartDate(currentStart || '');
    setEditEndDate(currentEnd || '');
  };

  const handleSaveClick = (index: number) => {
    if (project) {
      updateBudgetItemDates(project.id, index, editStartDate, editEndDate);
    }
    setEditingRowIndex(null);
  };

  const handleCancelClick = () => {
    setEditingRowIndex(null);
  };

  const handleAddRow = () => {
    if (project) {
      addBudgetItem(project.id, {
        item: `S-${project.budgetItems.length + 1}`,
        descripcion: 'Nuevo Ítem de Programación',
        unidad: 'UN',
        cantidad: 1,
        vlrUnitario: 0,
        vlrTotal: 0,
        type: 'item',
        startDate: format(new Date(), 'yyyy-MM-dd'),
        endDate: format(addDays(new Date(), 7), 'yyyy-MM-dd')
      });
    }
  };

  const handleImportXmlClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !project) return;

    try {
      const text = await file.text();
      importMsProjectXml(project.id, text);
    } catch (err) {
      console.error("Error reading XML file", err);
      alert("No se pudo leer el archivo XML.");
    }

    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const { timelineStart, totalDays } = useMemo(() => {
    if (!project || budgetItems.length === 0) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      return { timelineStart: today, totalDays: 30 };
    }

    const validStarts = budgetItems
      .filter(i => i.startDate && i.startDate.length >= 10)
      .map(i => {
        const d = parseISO(i.startDate!);
        d.setHours(0, 0, 0, 0);
        return d;
      })
      .filter(d => !isNaN(d.getTime()));

    const validEnds = budgetItems
      .filter(i => i.endDate && i.endDate.length >= 10)
      .map(i => {
        const d = parseISO(i.endDate!);
        d.setHours(0, 0, 0, 0);
        return d;
      })
      .filter(d => !isNaN(d.getTime()));

    if (validStarts.length === 0 || validEnds.length === 0) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      return { timelineStart: today, totalDays: 30 };
    }

    // Empezar siempre el día 1 del mes del ítem más antiguo para evitar negativos y desorden
    const firstDate = min(validStarts);
    const tStart = new Date(firstDate.getFullYear(), firstDate.getMonth(), 1);

    const lastDate = max(validEnds);
    // Extender el final un poco para que no quede pegado al borde
    const tEnd = addDays(lastDate, 15);
    const days = Math.max(30, differenceInDays(tEnd, tStart));

    return { timelineStart: tStart, totalDays: days };
  }, [project]);

  // --- COLUMN RESIZING LOGIC ---
  const colWidths = columnWidths.schedule;
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
    const newWidth = Math.max(50, startWidth.current + diff);
    updateColumnWidth('schedule', resizingCol.current, newWidth);
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
    context.font = '14px Inter';
    let maxWidth = context.measureText(colKey.toUpperCase()).width + 40;

    budgetItems.forEach(item => {
      let text = '';
      if (colKey === 'item') text = String(item.item);
      if (colKey === 'descripcion') text = String(item.descripcion);
      if (colKey === 'inicio') text = item.startDate || '';
      if (colKey === 'fin') text = item.endDate || '';
      const metrics = context.measureText(text);
      if (metrics.width + 40 > maxWidth) maxWidth = metrics.width + 40;
    });
    updateColumnWidth('schedule', colKey, Math.min(800, maxWidth));
  };

  const getColWidth = (key: string) => collapsedColumns.schedule.includes(key) ? 30 : colWidths[key];
  const isCollapsed = (key: string) => collapsedColumns.schedule.includes(key);

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

  const DAY_WIDTH = 20;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
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
        .schedule-row {
          position: relative;
          transition: all 0.2s ease;
        }
        .schedule-row::after {
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
        .schedule-row:hover::after,
        .schedule-row.focused::after {
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
        <h2 className="page-title">Programación de Obra</h2>
        <div style={{ display: 'flex', gap: 'var(--spacing-sm)' }}>
          <input
            type="file"
            accept=".xml"
            style={{ display: 'none' }}
            ref={fileInputRef}
            onChange={handleFileChange}
          />
          <button className="btn btn-secondary" onClick={handleImportXmlClick}>
            <Download size={16} /> Importar XML
          </button>
          <button className="btn btn-primary" onClick={handleAddRow}>
            <Plus size={16} /> Agregar Tarea
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
      <div className="glass-panel" style={{ display: 'flex', flex: 1, minHeight: 0, overflow: 'hidden', padding: 0 }}>


        {/* PARTE IZQUIERDA: TABLA FIJA (Efecto Glass) */}
        <div style={{
          width: `${totalTableWidth + 32}px`,
          flexShrink: 0,
          borderRight: '1px solid hsl(var(--border-color))',
          display: 'flex',
          flexDirection: 'column',
          background: 'transparent',
          zIndex: 20,
          minHeight: 0
        }}>
          {/* Header Tabla */}
          <div style={{
            display: 'flex', flexShrink: 0, height: '44px', alignItems: 'center', padding: '0 16px',
            borderBottom: '1px solid hsl(var(--border-color))', fontWeight: 'bold', fontSize: '0.7rem',
            color: 'hsl(var(--text-secondary))', backgroundColor: 'hsla(var(--bg-tertiary), 0.4)',
            backdropFilter: 'blur(10px)', letterSpacing: '0.1em'
          }}>
            {[
              { key: 'item', label: 'ÍTEM' },
              { key: 'descripcion', label: 'DESCRIPCIÓN' },
              { key: 'inicio', label: 'INICIO' },
              { key: 'fin', label: 'FIN' },
              { key: 'acciones', label: 'ACC.', align: 'center' }
            ].map(col => {
              const collapsed = isCollapsed(col.key);
              const width = getColWidth(col.key);
              return (
                <div key={col.key} className="col-header-container" style={{ width: `${width}px`, textAlign: (col.align as any) || 'left' }}>
                  {collapsed ? (
                    <div className="collapsed-dot" onClick={() => toggleColumnCollapse('schedule', col.key)} style={{ cursor: 'pointer' }}>•</div>
                  ) : (
                    <>
                      {col.label}
                      <button className="collapse-btn" onClick={() => toggleColumnCollapse('schedule', col.key)} title="Colapsar columna" />
                      <div className="col-resizer" onMouseDown={(e) => onMouseDown(col.key, e)} onDoubleClick={() => onDoubleClick(col.key)} />
                    </>
                  )}
                </div>
              );
            })}
          </div>

          {/* Cuerpo Tabla */}
          <div style={{ overflowY: 'auto', flex: 1, overflowX: 'hidden' }} className="budget-table-body floating-scroll" ref={leftScrollRef} onScroll={handleLeftScroll}>
            {budgetItems.map((item, index) => {
              const isEditing = editingRowIndex === index;
              const isTitle = item.type === 'title';
              return (
                <div
                  key={index}
                  className={`schedule-row ${hoveredIndex === index ? 'focused' : ''}`}
                  ref={el => { rowRefs.current[index] = el; }}
                  onMouseEnter={() => setHoveredIndex(index)}
                  onMouseLeave={() => setHoveredIndex(null)}
                  style={{
                    display: 'flex', alignItems: 'flex-start', padding: '0 16px', borderBottom: '1px solid hsl(var(--border-color))',
                    backgroundColor: hoveredIndex === index ? 'hsla(var(--primary-neon-hsl), 0.05)' : (isTitle ? 'hsla(var(--bg-tertiary), 0.5)' : 'transparent'),
                    fontWeight: isTitle ? 'bold' : 'normal', fontSize: '0.75rem', minHeight: '35px', position: 'relative',
                    transition: 'background-color 0.2s ease'
                  }}
                >
                  {[
                    { key: 'item', content: item.item, color: isTitle ? 'hsl(var(--text-primary))' : 'hsl(var(--accent-primary))' },
                    { key: 'descripcion', content: item.descripcion, className: 'expandable-description' },
                    {
                      key: 'inicio', content: isEditing ? (
                        <input type="date" value={editStartDate} onChange={e => setEditStartDate(e.target.value)} style={{ width: '100%', padding: '2px', fontSize: '0.7rem', background: 'hsl(var(--bg-tertiary))', border: '1px solid hsl(var(--accent-primary))', color: '#fff', borderRadius: '4px' }} />
                      ) : (item.startDate || '-')
                    },
                    {
                      key: 'fin', content: isEditing ? (
                        <input type="date" value={editEndDate} onChange={e => setEditEndDate(e.target.value)} style={{ width: '100%', padding: '2px', fontSize: '0.7rem', background: 'hsl(var(--bg-tertiary))', border: '1px solid hsl(var(--accent-primary))', color: '#fff', borderRadius: '4px' }} />
                      ) : (item.endDate || '-')
                    },
                  ].map(col => {
                    const collapsed = isCollapsed(col.key);
                    const width = getColWidth(col.key);
                    return (
                      <div key={col.key} style={{
                        width: `${width}px`, color: col.color || 'inherit', paddingTop: '8px', paddingBottom: '8px', paddingRight: '8px', overflow: 'hidden'
                      }}>
                        {collapsed ? '' : (
                          <div className={col.className}>{col.content}</div>
                        )}
                      </div>
                    );
                  })}
                  {!isCollapsed('acciones') && (
                    <div style={{ width: getColWidth('acciones'), display: 'flex', justifyContent: 'center', paddingTop: '8px' }}>
                      {isEditing ? (
                        <div style={{ display: 'flex', gap: '4px' }}>
                          <button onClick={() => handleSaveClick(index)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'hsl(var(--success))', padding: '4px' }}><Check size={14} /></button>
                          <button onClick={handleCancelClick} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'hsl(var(--danger))', padding: '4px' }}><X size={14} /></button>
                        </div>
                      ) : (
                        <button onClick={() => handleEditClick(index, item.startDate, item.endDate)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'hsl(var(--text-muted))', padding: '4px' }}>
                          <Edit2 size={14} />
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* PARTE DERECHA: CRONOGRAMA (Clipping perfecto) */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: 'transparent', overflow: 'hidden', minHeight: 0, minWidth: 0 }}>
          {/* Header Cronograma */}
          <div style={{
            height: '44px', flexShrink: 0, overflow: 'hidden', borderBottom: '1px solid hsl(var(--border-color))',
            backgroundColor: 'hsla(var(--bg-tertiary), 0.4)', backdropFilter: 'blur(10px)',
            minWidth: 0
          }} ref={headerScrollRef}>
            <div style={{ display: 'flex', width: `${totalDays * DAY_WIDTH}px` }}>
              {Array.from({ length: totalDays }).map((_, i) => {
                const currentDay = addDays(timelineStart, i);
                const isFirstOfMonth = currentDay.getDate() === 1 || i === 0;
                const isHovered = ganttHoveredDayIndex === i;
                return (
                  <div key={i} style={{
                    width: `${DAY_WIDTH}px`, height: '44px', flexShrink: 0,
                    borderRight: '1px solid hsl(var(--border-color) / 0.5)',
                    display: 'flex', flexDirection: 'column', alignItems: 'center',
                    justifyContent: 'flex-end', paddingBottom: '4px',
                    fontSize: '0.65rem', position: 'relative',
                    color: isHovered ? 'hsl(var(--primary-neon))' : 'hsl(var(--text-muted))',
                    transition: 'color 0.1s ease',
                  }}>
                    {isFirstOfMonth && (
                      <div style={{ position: 'absolute', top: '4px', left: '4px', fontWeight: 'bold', color: 'hsl(var(--text-secondary))' }}>
                        {format(currentDay, 'MMM', { locale: es }).toUpperCase()}
                      </div>
                    )}
                    {/* Marco resaltado del día bajo el cursor */}
                    {isHovered && (
                      <div style={{
                        position: 'absolute',
                        bottom: '2px',
                        left: '1px',
                        right: '1px',
                        height: '20px',
                        borderRadius: '5px',
                        border: '1px solid hsl(var(--primary-neon-hsl) / 0.8)',
                        background: 'hsl(var(--primary-neon-hsl) / 0.12)',
                        boxShadow: '0 0 8px hsl(var(--primary-neon-hsl) / 0.35)',
                        pointerEvents: 'none',
                        zIndex: 5,
                      }} />
                    )}
                    <span style={{ position: 'relative', zIndex: 6, fontWeight: isHovered ? '900' : 'normal' }}>
                      {currentDay.getDate()}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Cuerpo Cronograma */}
          <div
            style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', minWidth: 0, position: 'relative' }}
            className="budget-table-body"
            ref={(el) => {
              (rightScrollRef as any).current = el;
              (ganttBodyRef as any).current = el;
            }}
            onScroll={handleRightScroll}
            onMouseMove={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              const scrollLeft = e.currentTarget.scrollLeft;
              const relativeX = e.clientX - rect.left + scrollLeft;
              setGanttCursorX(relativeX);
              const dayIndex = Math.floor(relativeX / DAY_WIDTH);
              if (dayIndex >= 0 && dayIndex < totalDays) {
                setGanttHoveredDayIndex(dayIndex);
              }
            }}
            onMouseLeave={() => {
              setGanttCursorX(null);
              setGanttHoveredDayIndex(null);
            }}
          >
            {/* Línea vertical de cursor — sin etiqueta flotante */}
            {ganttCursorX !== null && (
              <div
                style={{
                  position: 'absolute',
                  top: 0,
                  left: `${ganttCursorX}px`,
                  width: '1px',
                  height: '100%',
                  background: 'hsl(var(--primary-neon-hsl) / 0.45)',
                  boxShadow: '0 0 6px hsl(var(--primary-neon-hsl) / 0.6)',
                  pointerEvents: 'none',
                  zIndex: 50,
                }}
              />
            )}

            <div style={{ width: `${totalDays * DAY_WIDTH}px`, position: 'relative', minHeight: '100%' }}>
              {/* Grid Background */}
              <div style={{ position: 'absolute', top: 0, left: 0, bottom: 0, display: 'flex', zIndex: 0, pointerEvents: 'none' }}>
                {Array.from({ length: totalDays }).map((_, i) => (
                  <div key={i} style={{
                    width: `${DAY_WIDTH}px`, height: '100%', borderRight: '1px solid hsl(var(--border-color) / 0.2)',
                    backgroundColor: addDays(timelineStart, i).getDay() === 0 ? 'hsla(var(--bg-primary), 0.5)' : 'transparent'
                  }} />
                ))}
              </div>

              {/* Barras de Gantt */}
              <div style={{ position: 'relative', zIndex: 1, width: '100%' }}>
                {budgetItems.map((item, index) => {
                  const hasDates = item.startDate && item.endDate && item.startDate.length >= 10 && item.endDate.length >= 10;
                  let leftOffset = 0;
                  let width = 0;
                  if (hasDates) {
                    const startD = parseISO(item.startDate!);
                    startD.setHours(0, 0, 0, 0);
                    const endD = parseISO(item.endDate!);
                    endD.setHours(0, 0, 0, 0);
                    leftOffset = differenceInDays(startD, timelineStart) * DAY_WIDTH;
                    width = (differenceInDays(endD, startD) + 1) * DAY_WIDTH;
                  }
                  const isTitle = item.type === 'title';
                  const rowH = rowHeights[index] || 35;

                  return (
                    <div
                      key={index}
                      className={`schedule-row ${hoveredIndex === index ? 'focused' : ''}`}
                      onMouseEnter={() => setHoveredIndex(index)}
                      onMouseLeave={() => setHoveredIndex(null)}
                      style={{
                        height: `${rowH}px`, display: 'flex', alignItems: 'center', borderBottom: '1px solid hsl(var(--border-color) / 0.1)',
                        position: 'relative',
                        backgroundColor: hoveredIndex === index ? 'hsla(var(--primary-neon-hsl), 0.05)' : (isTitle ? 'hsla(var(--bg-tertiary), 0.5)' : 'transparent'),
                        transition: 'background-color 0.2s ease'
                      }}
                    >
                      {hasDates && width > 0 && (
                        <div style={{
                          position: 'absolute', left: `${leftOffset}px`, width: `${width}px`,
                          height: isTitle ? '6px' : '12px', backgroundColor: isTitle ? 'hsl(var(--text-muted))' : 'hsl(var(--primary-neon-hsl))',
                          borderRadius: '10px', boxShadow: isTitle ? 'none' : '0 0 10px hsl(var(--primary-neon-hsl) / 0.3)',
                          transition: 'all 0.3s ease', zIndex: 2
                        }} />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </div>


      {/* BARRA DE DESPLAZAMIENTO HORIZONTAL EXTERNA */}
      <div style={{ display: 'flex', width: '100%', flexShrink: 0 }}>
        <div style={{ width: `${totalTableWidth + 32}px`, flexShrink: 0 }}></div>
        <div
          className="floating-scroll"
          ref={bottomScrollRef}
          onScroll={handleBottomScroll}
          style={{
            flex: 1,
            marginTop: '8px',
            height: '16px',
            overflowX: 'auto',
            overflowY: 'hidden',
            background: 'hsla(var(--bg-tertiary-hsl), 0.3)',
            borderRadius: '8px',
            border: '1px solid hsla(var(--border-color), 0.2)',
            minWidth: 0
          }}
        >
          <div style={{ width: `${totalDays * DAY_WIDTH}px`, height: '1px' }} />
        </div>
      </div>
    </div>
  );
}
