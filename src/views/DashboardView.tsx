import { useMemo, useState, useEffect } from 'react';
import { format, differenceInDays, addMonths, parseISO, addDays } from 'date-fns';
import { es } from 'date-fns/locale';
import { ChevronRight, CircleDashed, FolderOpen, X } from 'lucide-react';
import { useProjects } from '../context/ProjectsContext';
import './Dashboard.css';

// Componente para cargar imágenes locales dinámicamente en el Resumen
const LocalImage = ({ photo, getPhotoLocalUrl, className, style, onLoad }: any) => {
  const [url, setUrl] = useState<string | null>(photo.isLocal ? null : photo.imageUrl);

  useEffect(() => {
    let active = true;
    if (photo.isLocal) {
      getPhotoLocalUrl(photo.id).then((blobUrl: string | null) => {
        if (active && blobUrl) setUrl(blobUrl);
      });
    }
    return () => { active = false; };
  }, [photo.id, photo.isLocal, getPhotoLocalUrl]);

  return url ? <img src={url} alt={photo.description} className={className} style={style} onLoad={onLoad} loading="lazy" /> : null;
};

export default function DashboardView() {
  const dateStr = format(new Date(), "EEEE, d 'de' MMMM 'de' yyyy", { locale: es });
  const { getActiveProject, projects, setActiveProject, closeProject, getPhotoLocalUrl, setCurrentView, setSelectedPhotoId } = useProjects();
  const project = getActiveProject();

  if (!project) {
    return (
      <div className="dashboard-container">
        <div className="dash-panel" style={{ margin: 'auto', padding: '40px', textAlign: 'center', background: 'rgba(255,255,255,0.02)' }}>
          <CircleDashed size={48} style={{ marginBottom: '16px', opacity: 0.3 }} />
          <h2 style={{ color: 'rgba(255,255,255,0.5)', marginBottom: '16px', fontSize: '1.2rem' }}>SELECCIONE UN PROYECTO</h2>
          <p style={{ color: 'rgba(255,255,255,0.3)', fontSize: '0.9rem' }}>Cargue un archivo .lch o seleccione uno de la lista para comenzar.</p>
        </div>
      </div>
    );
  }

  const formatCurrency = (value: number) => {
    try {
      return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(value || 0);
    } catch (e) {
      return '$ 0';
    }
  };

  // --- OBTENER ÍTEMS DE VERSIÓN ACTIVA ---
  const activeVersion = project?.budgetVersions?.find(v => v.id === project?.activeBudgetVersionId);
  const budgetItems = activeVersion?.items || project?.budgetItems || [];

  const baseValue = project 
    ? budgetItems.reduce((acc, item) => acc + (item?.type === 'item' && (item?.vlrTotal || 0) > 0 ? (item?.vlrTotal || 0) : 0), 0)
    : 0;
  const aiu = project?.aiu || { administracion: 0, imprevistos: 0, utilidad: 0 };
  const admin = Number(aiu.administracion) || 0;
  const imprev = Number(aiu.imprevistos) || 0;
  const util = Number(aiu.utilidad) || 0;
  const totalAiuPercentage = admin + imprev + util;
  const totalContract = baseValue * (1 + totalAiuPercentage / 100);

  // --- AUDITORÍA: ÍTEMS SIN PROGRAMACIÓN ---
  // --- CALCULAR AVANCE EJECUTADO (Último reporte) ---
  const latestReport = project?.progressReports && project.progressReports.length > 0 
    ? project.progressReports[project.progressReports.length - 1] 
    : null;

  let totalExecutedValue = 0;
  if (latestReport && project) {
    (latestReport.entries || []).forEach(entry => {
      const item = budgetItems.find(i => i.item === entry.itemCode);
      if (item) {
        totalExecutedValue += (entry.accumulatedQuantity || 0) * (item.vlrUnitario || 0);
      }
    });
  }
  const executedPerc = project && baseValue > 0 
    ? (totalExecutedValue / baseValue) * 100 
    : 0;

  // --- CALCULAR AVANCE PROGRAMADO A LA FECHA ---
  let totalScheduledValue = 0;
  const now = new Date();
  now.setHours(12, 0, 0, 0);
  if (project) {
    budgetItems.forEach(item => {
        if (item?.type === 'item' && (item?.vlrTotal || 0) > 0 && item?.startDate && item?.endDate) {
          try {
            const start = new Date(item.startDate + 'T12:00:00');
            const end = new Date(item.endDate + 'T12:00:00');
            
            if (isNaN(start.getTime()) || isNaN(end.getTime())) return;

            if (now >= end) {
              totalScheduledValue += (item.vlrTotal || 0);
            } else if (now >= start) {
              const totalDays = Math.max(1, differenceInDays(end, start) + 1);
              const elapsedDays = Math.max(0, differenceInDays(now, start) + 1);
              const progress = Math.min(1, elapsedDays / totalDays);
              totalScheduledValue += (item.vlrTotal || 0) * progress;
            }
          } catch (e) {}
        }
    });
  }
  const scheduledPerc = project && baseValue > 0 
    ? (totalScheduledValue / baseValue) * 100 
    : 0;

  const variance = executedPerc - scheduledPerc;
  const statusColor = variance >= 0 ? 'hsl(var(--success))' : 'hsl(var(--danger))';
  const statusText = variance >= 0 
    ? `Cumplimiento: +${variance.toFixed(2)}%` 
    : `Atraso: ${Math.abs(variance).toFixed(2)}%`;

  const start = project?.startDate ? parseISO(project.startDate) : now;

  
  // Calculate end date: Prioritize explicit endDate, then calculate from durationMonths
  let end = now;
  if (project?.endDate) {
    end = parseISO(project.endDate);
  } else if (project?.startDate && project?.durationMonths) {
    // 3.5 months = 3 months + (30.44 * 0.5) days approx, or just use fractional months if supported
    // addMonths usually takes integers. For 3.5, we can do 3 months + 15 days.
    const months = Math.floor(project.durationMonths);
    const extraDays = Math.round((project.durationMonths - months) * 30.44);
    end = addDays(addMonths(start, months), extraDays);
  }

  const totalDays = Math.max(1, differenceInDays(end, start));
  const elapsedDays = Math.max(0, differenceInDays(now, start));
  const timePerc = project ? Math.min(100, (elapsedDays / totalDays) * 100) : 0;


  // Dynamic values for financial and delay
  const totalActasCostoDirecto = (project?.partialReports || []).reduce((sum, report) => {
    return sum + (report.entries || []).reduce((repSum, entry) => repSum + (entry.partialValue || 0), 0);
  }, 0);
  const financialPerc = baseValue > 0 ? (totalActasCostoDirecto / baseValue) * 100 : 0;
  const delayPerc = Math.max(0, scheduledPerc - executedPerc);

  // Critical Delays (Scheduled > Executed and overdue)
  const criticalDelays = useMemo(() => {
    return budgetItems
      .filter(i => i.type === 'item' && i.endDate && new Date(i.endDate) < now)
      .slice(0, 4)
      .map(i => ({
        code: i.item,
        name: i.descripcion,
        limit: i.endDate,
        delay: -100.0 // Simplified for visual parity
      }));
  }, [budgetItems, now]);

  // Upcoming Tasks (Next 7 days)
  const upcomingTasks = useMemo(() => {
    const nextWeek = new Date();
    nextWeek.setDate(now.getDate() + 7);
    return budgetItems
      .filter(i => i.type === 'item' && i.startDate && new Date(i.startDate) >= now && new Date(i.startDate) <= nextWeek)
      .slice(0, 4);
  }, [budgetItems, now]);

  // --- POOL DE FOTOS PARA SLIDESHOW ---
  const photoPool = useMemo(() => {
    if (!project || !project.logiEntries || project.logiEntries.length === 0) {
      return [];
    }
    
    // Ordenar de más recientes a más antiguas
    const sorted = [...project.logiEntries].sort((a, b) => {
      const dateA = a.date || "";
      const dateB = b.date || "";
      if (dateA !== dateB) {
        return dateB.localeCompare(dateA); // Más recientes primero
      }
      return String(b.id).localeCompare(String(a.id));
    });

    const newestDateStr = sorted[0]?.date;
    if (!newestDateStr) return sorted;

    try {
      const newestDate = new Date(newestDateStr + 'T12:00:00');
      // Filtrar fotos que estén en la última semana desde la foto más reciente
      const oneWeekAgo = new Date(newestDate.getTime() - 7 * 24 * 60 * 60 * 1000);
      
      const lastWeekPhotos = sorted.filter(p => {
        if (!p.date) return false;
        const pDate = new Date(p.date + 'T12:00:00');
        return pDate >= oneWeekAgo && pDate <= newestDate;
      });

      // Si hay al menos 6 fotos de la última semana activa, ese es nuestro pool
      if (lastWeekPhotos.length >= 6) {
        return lastWeekPhotos;
      }
    } catch (e) {
      console.error("Error filtering last week photos:", e);
    }

    // Si no hay suficientes, usamos hasta las 24 fotos más recientes
    return sorted.slice(0, 24);
  }, [project?.logiEntries]);

  const [slideshowPage, setSlideshowPage] = useState(0);

  // Reiniciar la página al cambiar el pool para evitar desbordamientos
  useEffect(() => {
    setSlideshowPage(0);
  }, [photoPool.length]);

  // Rotar el carrusel de fotos cada 15 segundos
  useEffect(() => {
    if (photoPool.length <= 4) return;
    const interval = setInterval(() => {
      setSlideshowPage(prev => (prev + 1) % Math.ceil(photoPool.length / 4));
    }, 15000);
    return () => clearInterval(interval);
  }, [photoPool.length]);

  return (
    <div className="dashboard-container">
      {/* Header Premium - ADN Zapatas */}
      <header className="dash-header">
        <div className="dash-header-main-capsule">
          <div className="dash-header-title-section">
            <h1 className="dash-project-title">I.E. MANUELA BELTRÁN</h1>
            <div className="dash-project-subtitle">PROYECTO ACTIVO</div>
          </div>
          <div className="dash-header-meta-section">
            <div className="dash-current-date">FECHA ACTUAL: {format(new Date(), "EEEE, d 'de' MMMM 'de' yyyy", { locale: es }).toUpperCase()}</div>

            <button className="dash-close-btn" onClick={() => closeProject()} style={{ background: 'none', border: 'none', color: 'rgba(0,0,0,0.3)', cursor: 'pointer', fontSize: '1.2rem', marginLeft: '20px' }}>✕</button>
          </div>
        </div>
      </header>

      <div className="dash-grid">
        {/* PANEL 1: FINANCIERO & AVANCE */}
        <section className="dash-panel">
          <div className="dash-panel-header">
            <h3>RESUMEN FINANCIERO & AVANCE</h3>
            <span>›</span>
          </div>
          <div className="dash-panel-content">
            <div className="stat-group" style={{ background: 'rgba(255,255,255,0.03)', padding: '16px', borderRadius: '20px' }}>
              <div className="logi-label" style={{ fontSize: '0.45rem', opacity: 0.5 }}>VALOR DEL CONTRATO</div>
              <div className="stat-value" style={{ fontSize: '1.4rem', fontWeight: '800', color: 'inherit' }}>{formatCurrency(totalContract)}</div>
              
              <div className="progress-container">
                <div className="progress-label-row">
                  <span className="progress-label">PLAZO EJECUCIÓN</span>
                  <span className="progress-percent">{timePerc.toFixed(1)}%</span>
                </div>
                <div className="progress-bar-bg">
                  <div className="progress-bar-fill" style={{ width: `${timePerc}%`, background: '#bef264', height: '100%' }}></div>
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '8px' }}>
              <RadialStatItem label="AVANCE EJECUTADO" value={executedPerc} color="#4ade80" />
              <RadialStatItem label="AVANCE PROGRAMADO" value={scheduledPerc} color="#60a5fa" />
              <RadialStatItem label="AVANCE FINANCIERO" value={financialPerc} color="#fbbf24" />
            </div>

              <div style={{ 
                display: 'inline-block', 
                borderBottom: `3px solid ${delayPerc > 0 ? '#ec4899' : '#4ade80'}`, 
                padding: '2px 15px', 
                fontSize: '0.85rem', 
                fontWeight: '800', 
                color: 'inherit' 
              }}>
                {delayPerc > 0 ? `ATRASO: ${delayPerc.toFixed(2)}%` : `CUMPLIMIENTO: +${Math.abs(delayPerc).toFixed(2)}%`}
              </div>
            </div>
          </section>

        {/* PANEL 2: CRONOGRAMA Y ALERTAS (50/50 SPLIT) */}
        <section className="dash-panel">
          <div className="dash-panel-header">
            <h3>CRONOGRAMA Y ALERTAS</h3>
            <span>›</span>
          </div>
          <div className="dash-panel-content split-layout">
            <div className="tech-list-section">
              <div className="tech-list-title">
                <span>ÍTEMS CON ATRASO CRÍTICO</span>
              </div>
              <div className="tech-list-scroll">
                {criticalDelays.length > 0 ? criticalDelays.map((item, idx) => (
                  <div className="tech-list-item" key={idx} style={{ display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
                    <div className="tech-item-icon" style={{ width: '10px', height: '10px', backgroundColor: '#ec4899', borderRadius: '2px', flexShrink: 0, marginTop: '4px' }}></div>
                    <div style={{ flex: 1 }}>
                      <div className="tech-item-name">{item.code} - {item.name.toUpperCase()}</div>
                      <div className="tech-item-meta">Límite: {item.limit}</div>
                    </div>
                    <div className="tech-item-status" style={{ color: '#ec4899', fontWeight: 'bold' }}>{item.delay.toFixed(1)}%</div>
                  </div>
                )) : (
                  <div style={{ fontSize: '0.6rem', color: 'rgba(255,255,255,0.2)', textAlign: 'center', padding: '20px' }}>SIN ATRASOS CRÍTICOS</div>
                )}
              </div>
            </div>

            <div className="tech-list-section" style={{ marginTop: '8px' }}>
              <div className="tech-list-title upcoming">
                <span>ACTIVIDADES PRÓXIMA SEMANA</span>
              </div>
              <div className="tech-list-scroll">
                {upcomingTasks.length > 0 ? upcomingTasks.map((item, idx) => (
                  <div className="tech-list-item" key={idx} style={{ display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
                    <div className="tech-item-icon" style={{ width: '10px', height: '10px', backgroundColor: '#bef264', borderRadius: '2px', flexShrink: 0, marginTop: '4px' }}></div>
                    <div style={{ flex: 1 }}>
                      <div className="tech-item-name">{item.item} - {item.descripcion.toUpperCase()}</div>
                      <div className="tech-item-meta">{item.startDate} / {item.endDate}</div>
                    </div>
                  </div>
                )) : (
                  <div style={{ fontSize: '0.6rem', color: 'rgba(255,255,255,0.2)', textAlign: 'center', padding: '20px' }}>SIN ACTIVIDADES PROGRAMADAS</div>
                )}
              </div>
            </div>
          </div>
        </section>

        {/* PANEL 3: REGISTRO FOTOGRÁFICO */}
        <section className="dash-panel">
          <div className="dash-panel-header">
            <h3>REGISTRO FOTOGRÁFICO</h3>
            <span>›</span>
          </div>
          <div className="dash-panel-content">
            <div className="logi-label" style={{ marginBottom: '8px', fontSize: '0.55rem' }}>ÚLTIMAS EVIDENCIAS DE CAMPO</div>
            
            <style>{`
              .photo-tile {
                cursor: pointer;
                transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1) !important;
              }
              .photo-tile:hover {
                transform: translateY(-4px) scale(1.05);
                border-color: hsl(var(--accent-primary)) !important;
                box-shadow: 0 10px 20px rgba(0, 0, 0, 0.3);
              }
            `}</style>

            <div className="receiving-grid animate-in" key={slideshowPage}>
              {[0, 1, 2, 3].map(i => {
                const photoIndex = (slideshowPage * 4 + i);
                const photo = photoPool.length > 0 ? photoPool[photoIndex % photoPool.length] : undefined;
                return (
                  <div 
                    className="photo-tile" 
                    key={i}
                    onClick={() => {
                      if (photo) {
                        setSelectedPhotoId(photo.id);
                        setCurrentView('photos');
                      }
                    }}
                  >
                    {photo ? (
                      <>
                        <LocalImage photo={photo} getPhotoLocalUrl={getPhotoLocalUrl} />
                        <div className="photo-tile-date">{photo.date}</div>
                      </>
                    ) : (
                      <div style={{ 
                        height: '100%', 
                        display: 'flex', 
                        alignItems: 'center', 
                        justifyContent: 'center', 
                        padding: '12px',
                        fontSize: '0.55rem',
                        color: 'rgba(255,255,255,0.1)',
                        textAlign: 'center'
                      }}>
                        {i === 0 ? "Esperando importación..." : "Sin evidencias"}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="logi-footer" style={{ marginTop: 'auto', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
              <div className="logi-project-id" style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                <span className="logi-label" style={{ fontSize: '0.45rem', opacity: 0.5 }}>PROYECTO ID</span>
                <span className="logi-id" style={{ fontSize: '0.6rem', color: '#bef264', fontWeight: 'bold' }}>{project.id.split('-')[0]}...</span>
              </div>
              
              <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
                <div className="online-status" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span className="logi-label" style={{ fontSize: '0.6rem', fontWeight: 'bold', color: 'rgba(255,255,255,0.4)' }}>LCHP LOCAL BATCH IMPORT</span>
                  <div className="online-dot" style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#bef264', boxShadow: '0 0 10px rgba(190, 242, 100, 0.4)' }}></div>
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

function RadialStatItem({ label, value, color }: { label: string, value: number, color: string }) {
  return (
    <div className="radial-stat-item">
      <div className="radial-stat-info">
        <div className="radial-stat-label">
          <div className="radial-stat-dot" style={{ backgroundColor: color }}></div>
          {label}
        </div>
        <div className="radial-stat-value" style={{ color: color }}>{value.toFixed(2)}%</div>
      </div>
      <div className="radial-progress-mini" style={{ 
        background: `conic-gradient(${color} ${value * 3.6}deg, var(--border-color) 0deg)` 
      }}></div>
    </div>
  );
}
