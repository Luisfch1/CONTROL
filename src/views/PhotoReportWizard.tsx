import React, { useState, useMemo, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { 
  X, Filter, Calendar, Search, FileText, 
  Trash2, Download, Printer, ChevronLeft, ChevronRight,
  Settings, Layers, Layout, Folder
} from 'lucide-react';
import { useProjects, globalBlobUrlCache } from '../context/ProjectsContext';
import type { LogiEntry, ReportFormat, PhotoReport } from '../types/projectTypes';
import logo from '../assets/logo.png';
import { exportPhotosToWord as exportWordUtil, exportPhotosToZip as exportZipUtil } from '../utils/photoReportExporter';

// Componente para renderizar imágenes locales con IntersectionObserver (Lazy loading)
// y caché síncrona en memoria para evitar saturar el navegador con cientos de IndexedDB reads.
const LocalImage = ({ photo, getPhotoLocalUrl, style, className, onLoad }: any) => {
  const [inView, setInView] = useState(false);
  const [url, setUrl] = useState<string | null>(() => {
    if (!photo.isLocal) return photo.imageUrl;
    return globalBlobUrlCache.get(photo.id) || null;
  });
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (url) return; // Si ya está en caché, no necesitamos IntersectionObserver

    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setInView(true);
        observer.disconnect();
      }
    }, { rootMargin: '200px' });

    if (ref.current) {
      observer.observe(ref.current);
    }

    return () => observer.disconnect();
  }, [url]);

  useEffect(() => {
    if (!photo.isLocal || url || !inView) return;

    let active = true;
    getPhotoLocalUrl(photo.id).then((blobUrl: string | null) => {
      if (active && blobUrl) setUrl(blobUrl);
    });
    return () => { active = false; };
  }, [photo.id, photo.isLocal, getPhotoLocalUrl, url, inView]);

  return (
    <div ref={ref} style={{ width: '100%', height: '100%' }}>
      {url ? (
        <img 
          src={url} 
          alt={photo.description} 
          className={className} 
          style={style} 
          onLoad={onLoad} 
          loading="lazy" 
        />
      ) : (
        <div style={{ width: '100%', height: '100%', background: 'rgba(255,255,255,0.05)', border: '1px dashed hsl(var(--border-color))', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <span style={{ fontSize: '9px', color: 'hsl(var(--text-muted))', fontWeight: 'bold' }}>CARGANDO...</span>
        </div>
      )}
    </div>
  );
};


interface PhotoReportWizardProps {
  onClose: () => void;
  savedReport?: PhotoReport;
}

const LOGI_CLASSIC: ReportFormat = {
  id: 'logi-classic',
  name: 'Logi Clásica (Plantilla 1)',
  isBase: true,
  config: {
    columns: 2,
    photoHeightCm: 4.6,
    photoWidthCm: 7.6,
    showItemCode: true,
    showDescription: true,
    showUnit: true,
    showQuantity: false,
    showHeader: true,
    showFooter: true
  }
};

export default function PhotoReportWizard({ onClose, savedReport }: PhotoReportWizardProps) {
  const { getActiveProject, getPhotoLocalUrl, addPhotoReport, updatePhotoReport } = useProjects();
  const project = getActiveProject();

  if (!project) return null;

  const [dateFrom, setDateFrom] = useState(savedReport?.dateFrom || '');
  const [dateTo, setDateTo] = useState(savedReport?.dateTo || '');
  const [itemFilter, setItemFilter] = useState(savedReport?.itemFilter || '');
  const [textFilter, setTextFilter] = useState(savedReport?.textFilter || '');
  const [currentFormat, setCurrentFormat] = useState<ReportFormat>(LOGI_CLASSIC);
  const [reportPhotos, setReportPhotos] = useState<LogiEntry[]>([]);
  const [isInitialized, setIsInitialized] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [logoBase64, setLogoBase64] = useState<string>('');
  
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [reportName, setReportName] = useState('');
  const [hasChanges, setHasChanges] = useState(false);
  
  // Estados para exportación de ZIP
  const [isZipExporting, setIsZipExporting] = useState(false);
  const [zipProgress, setZipProgress] = useState(0);

  useEffect(() => {
    // Convert logo to base64 for embedding in Word
    const img = new Image();
    img.crossOrigin = 'Anonymous';
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(img, 0, 0);
        setLogoBase64(canvas.toDataURL('image/png'));
      }
    };
    img.src = logo;
  }, []);

  useEffect(() => {
    if (!project) return;
    if (savedReport) {
      // Guard: solo inicializar una vez. Si ya se inicializó (ej. después de
      // un updatePhotoReport que recarga project), no sobreescribir reportPhotos
      // con los photoIds viejos de la prop estática savedReport.
      if (isInitialized) return;
      const map = new Map((project.logiEntries || []).map(e => [e.id, e]));
      const filtered = savedReport.photoIds
        .map(id => map.get(id))
        .filter((e): e is LogiEntry => !!e);
      setReportPhotos(filtered);
      setIsInitialized(true);
      return;
    }

    let filtered = [...(project.logiEntries || [])];
    if (dateFrom) filtered = filtered.filter(p => p.date >= dateFrom);
    if (dateTo) filtered = filtered.filter(p => p.date <= dateTo);
    if (itemFilter) filtered = filtered.filter(p => p.itemCode.includes(itemFilter));
    if (textFilter) {
      const q = textFilter.toLowerCase();
      filtered = filtered.filter(p => 
        p.description.toLowerCase().includes(q) || 
        p.itemCode.toLowerCase().includes(q)
      );
    }
    filtered.sort((a, b) => (a.date || "").localeCompare(b.date || ""));
    setReportPhotos(filtered);
    setIsInitialized(true);
  }, [project, dateFrom, dateTo, itemFilter, textFilter, savedReport]);

  const handleSaveReport = () => {
    if (!reportName.trim()) return;
    addPhotoReport(project.id, {
      name: reportName.trim(),
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined,
      itemFilter: itemFilter || undefined,
      textFilter: textFilter || undefined,
      photoIds: reportPhotos.map(p => p.id)
    });
    setShowSaveModal(false);
    
    const flash = document.createElement('div');
    flash.innerText = "✓ Informe Guardado Correctamente";
    flash.style.position = 'fixed';
    flash.style.bottom = '20px';
    flash.style.right = '20px';
    flash.style.background = 'hsl(var(--accent-primary))';
    flash.style.color = '#000';
    flash.style.padding = '10px 20px';
    flash.style.borderRadius = '8px';
    flash.style.fontWeight = 'bold';
    flash.style.zIndex = '100000';
    document.body.appendChild(flash);
    setTimeout(() => flash.remove(), 2500);
  };


  const removePhotoFromReport = (id: string) => {
    setReportPhotos(prev => prev.filter(p => p.id !== id));
    setHasChanges(true);
  };

  const handlePrint = () => {
    window.print();
  };

  const exportToWord = async () => {
    try {
      setIsExporting(true);
      setExportProgress(0);
      await exportWordUtil(project, {
        dateFrom,
        dateTo,
        itemFilter,
        textFilter,
        onProgress: (p) => setExportProgress(p)
      });
    } catch (error) {
      console.error("Error exporting to Word:", error);
      alert("Error al generar el reporte: " + (error instanceof Error ? error.message : String(error)));
    } finally {
      setIsExporting(false);
    }
  };

  const exportPhotosToZip = async () => {
    try {
      setIsZipExporting(true);
      setZipProgress(0);
      await exportZipUtil(project, {
        dateFrom,
        dateTo,
        itemFilter,
        textFilter,
        onProgress: (p) => setZipProgress(p)
      });
      alert(`¡Éxito! Se ha generado y descargado el archivo ZIP.`);
    } catch (error: any) {
      console.error("Error generando ZIP:", error);
      alert("Error al intentar generar el archivo ZIP: " + error.message);
    } finally {
      setIsZipExporting(false);
      setZipProgress(0);
    }
  };

  const PHOTOS_PER_PAGE = 6; 
  const pages = useMemo(() => {
    const p = [];
    for (let i = 0; i < reportPhotos.length; i += PHOTOS_PER_PAGE) {
      p.push(reportPhotos.slice(i, i + PHOTOS_PER_PAGE));
    }
    return p;
  }, [reportPhotos]);

  const getHeaderText = () => {
    if (dateFrom && dateTo) return `REPORTE FOTOGRÁFICO: ${dateFrom} AL ${dateTo}`;
    if (dateFrom) return `REPORTE FOTOGRÁFICO: DESDE ${dateFrom}`;
    if (textFilter) return `REPORTE DE EVIDENCIAS: BÚSQUEDA "${textFilter.toUpperCase()}"`;
    if (itemFilter) return `REPORTE DE EVIDENCIAS: ÍTEM ${itemFilter}`;
    return "REPORTE FOTOGRÁFICO GENERAL";
  };

  return createPortal(
    <div className="report-wizard-overlay animate-in" style={{
      position: 'fixed', inset: 0, background: 'hsl(var(--bg-primary))', zIndex: 10000,
      display: 'flex', flexDirection: 'column', color: 'hsl(var(--text-primary))'
    }}>
      <header style={{
        height: '64px', borderBottom: '1px solid hsl(var(--border-color))',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 24px', background: 'hsla(var(--bg-secondary), 0.8)', backdropFilter: 'blur(10px)'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <button onClick={onClose} className="btn-icon" style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'hsl(var(--text-muted))' }}>
            <X size={24} />
          </button>
          <div>
            <h2 style={{ margin: 0, fontSize: '1rem', fontWeight: '800', letterSpacing: '1px' }}>ASISTENTE DE INFORMES</h2>
            <p style={{ margin: 0, fontSize: '0.7rem', color: 'hsl(var(--text-muted))', fontWeight: '600' }}>{project.name.toUpperCase()}</p>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div className="no-print" style={{ display: 'flex', gap: '8px', marginRight: '16px' }}>
            <div className="badge badge-accent" style={{ fontSize: '10px' }}>{reportPhotos.length} FOTOS</div>
            <div className="badge badge-secondary" style={{ fontSize: '10px' }}>{pages.length} PÁGINAS</div>
          </div>
          
          {savedReport ? (
            <button
              onClick={() => {
                if (!hasChanges) {
                  return;
                }
                if (reportPhotos.length === 0) {
                  alert("No se puede guardar un informe sin fotos.");
                  return;
                }
                updatePhotoReport(project.id, savedReport.id, {
                  photoIds: reportPhotos.map(p => p.id)
                });
                setHasChanges(false);
                const flash = document.createElement('div');
                flash.innerText = '✓ Cambios Guardados Correctamente';
                flash.style.cssText = 'position:fixed;bottom:20px;right:20px;background:hsl(var(--accent-primary));color:#000;padding:10px 20px;border-radius:8px;font-weight:bold;z-index:100001;font-size:0.8rem;';
                document.body.appendChild(flash);
                setTimeout(() => flash.remove(), 2800);
              }}
              className="btn btn-secondary no-print"
              disabled={!hasChanges}
              style={{
                height: '36px',
                padding: '0 20px',
                fontWeight: '800',
                color: hasChanges ? '#000' : 'hsl(var(--text-muted))',
                background: hasChanges ? 'hsl(var(--accent-primary))' : 'transparent',
                borderColor: hasChanges ? 'hsl(var(--accent-primary))' : 'hsl(var(--border-color))',
                minWidth: '160px',
                transition: 'all 0.2s ease'
              }}
            >
              GUARDAR CAMBIOS
            </button>
          ) : (
            <button 
              onClick={() => {
                if (reportPhotos.length === 0) {
                  alert("No se puede guardar un reporte sin fotos.");
                  return;
                }
                setReportName(`Reporte Fotográfico - ${new Date().toLocaleDateString()}`);
                setShowSaveModal(true);
              }}
              className="btn btn-secondary no-print"
              style={{ 
                height: '36px', 
                padding: '0 20px', 
                fontWeight: '800', 
                color: '#000', 
                background: 'hsl(var(--accent-primary))',
                borderColor: 'hsl(var(--accent-primary))',
                minWidth: '150px'
              }}
            >
              GUARDAR REPORTE
            </button>
          )}

          <button 
            onClick={exportPhotosToZip}
            disabled={isZipExporting}
            className={`btn btn-secondary no-print ${isZipExporting ? 'loading' : ''}`}
            style={{ 
              height: '36px', 
              padding: '0 18px', 
              fontWeight: '800', 
              color: isZipExporting ? 'hsl(var(--text-muted))' : 'hsl(var(--accent-primary))', 
              borderColor: 'hsl(var(--accent-primary) / 0.3)',
              minWidth: '150px',
              background: 'linear-gradient(135deg, hsla(var(--accent-primary), 0.1) 0%, transparent 100%)'
            }}
          >
            {isZipExporting ? (
              <span style={{ fontSize: '10px' }}>ZIP GENERANDO {zipProgress}%</span>
            ) : (
              <><Folder size={16} /> EXPORTAR ZIP (DIAS)</>
            )}
          </button>

          <button 
            onClick={exportToWord} 
            disabled={isExporting}
            className={`btn btn-secondary no-print ${isExporting ? 'loading' : ''}`} 
            style={{ 
              height: '36px', 
              padding: '0 20px', 
              fontWeight: '800', 
              color: isExporting ? 'hsl(var(--text-muted))' : 'hsl(var(--accent-primary))', 
              borderColor: 'hsl(var(--accent-primary) / 0.3)',
              minWidth: '160px'
            }}
          >
            {isExporting ? (
              <span style={{ fontSize: '10px' }}>GENERANDO {exportProgress}%</span>
            ) : (
              <><FileText size={16} /> EXPORTAR WORD</>
            )}
          </button>

          <button onClick={handlePrint} className="btn btn-primary no-print" style={{ height: '36px', padding: '0 20px', fontWeight: '800', background: 'hsl(var(--danger))', border: 'none' }}>
            <Download size={16} /> EXPORTAR PDF
          </button>
        </div>
      </header>

      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        <aside className="no-print" style={{
          width: '320px', borderRight: '1px solid hsl(var(--border-color))',
          background: 'hsl(var(--bg-secondary))', padding: '24px', overflowY: 'auto'
        }}>
          <section style={{ marginBottom: '32px' }}>
            <h3 style={{ fontSize: '0.75rem', fontWeight: '900', color: 'hsl(var(--accent-primary))', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Filter size={14} /> FILTRAR EVIDENCIAS
            </h3>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.65rem', fontWeight: '800', marginBottom: '8px', opacity: 0.6 }}>RANGO DE FECHAS</label>
                <div style={{ display: 'flex', gap: '8px' }}>
                  {/* Selector Fecha Inicio */}
                  <div className="date-input-wrapper" style={{ 
                    flex: 1, 
                    position: 'relative',
                    opacity: savedReport ? 0.5 : 1,
                    pointerEvents: savedReport ? 'none' : 'auto'
                  }}>
                    <Calendar size={14} className="date-icon" />
                    <span className="date-display">{dateFrom || 'INICIO'}</span>
                    <input 
                      type="date" 
                      value={dateFrom} 
                      onChange={e => setDateFrom(e.target.value)} 
                      className="hidden-date-input"
                      disabled={!!savedReport}
                    />
                  </div>
                  {/* Selector Fecha Fin */}
                  <div className="date-input-wrapper" style={{ 
                    flex: 1, 
                    position: 'relative',
                    opacity: savedReport ? 0.5 : 1,
                    pointerEvents: savedReport ? 'none' : 'auto'
                  }}>
                    <Calendar size={14} className="date-icon" />
                    <span className="date-display">{dateTo || 'FINAL'}</span>
                    <input 
                      type="date" 
                      value={dateTo} 
                      onChange={e => setDateTo(e.target.value)} 
                      className="hidden-date-input"
                      disabled={!!savedReport}
                    />
                  </div>
                </div>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.65rem', fontWeight: '800', marginBottom: '6px', opacity: 0.6 }}>BUSQUEDA POR TEXTO (EJ. LLUVIA)</label>
                <div style={{ position: 'relative' }}>
                  <Search size={14} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'hsl(var(--accent-primary))' }} />
                  <input 
                    type="text" 
                    placeholder="BUSCAR..." 
                    value={textFilter}
                    onChange={e => setTextFilter(e.target.value)}
                    className="input-field" 
                    style={{ paddingLeft: '32px', width: '100%', fontSize: '0.75rem' }} 
                    disabled={!!savedReport}
                  />
                </div>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.65rem', fontWeight: '800', marginBottom: '6px', opacity: 0.6 }}>CODIGO DE ITEM</label>
                <input 
                  type="text" 
                  placeholder="ITEM..." 
                  value={itemFilter}
                  onChange={e => setItemFilter(e.target.value.toUpperCase())}
                  className="input-field" 
                  style={{ width: '100%', fontSize: '0.75rem' }} 
                  disabled={!!savedReport}
                />
              </div>
            </div>
          </section>

          {savedReport && (
            <div style={{ marginTop: '16px', padding: '12px', background: hasChanges ? 'rgba(234,179,8,0.1)' : 'rgba(59,130,246,0.1)', borderRadius: '6px', border: hasChanges ? '1px solid #eab308' : '1px solid #3b82f6', marginBottom: '24px' }}>
              <p style={{ fontSize: '0.7rem', margin: 0, color: hasChanges ? '#eab308' : '#3b82f6', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Folder size={12} /> {hasChanges ? '⚠ CAMBIOS SIN GUARDAR' : 'MODO EDICIÓN — INFORME GUARDADO'}
              </p>
              {hasChanges && (
                <p style={{ fontSize: '0.6rem', margin: '6px 0 0 0', color: 'hsl(var(--text-muted))', lineHeight: '1.4' }}>
                  Haga clic en "GUARDAR CAMBIOS" para aplicar las modificaciones al informe.
                </p>
              )}
            </div>
          )}

          <section style={{ marginBottom: '32px' }}>
            <h3 style={{ fontSize: '0.75rem', fontWeight: '900', color: 'hsl(var(--text-primary))', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Layout size={14} /> FORMATO DE INFORME
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <button 
                className={`btn ${currentFormat.id === 'logi-classic' ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setCurrentFormat(LOGI_CLASSIC)}
                style={{ justifyContent: 'flex-start', fontSize: '0.75rem', height: '40px' }}
              >
                <Layers size={14} /> PLANTILLA LOGI CLÁSICA
              </button>
              <button className="btn btn-secondary" style={{ justifyContent: 'flex-start', fontSize: '0.75rem', height: '40px', opacity: 0.5 }} disabled>
                <Settings size={14} /> + NUEVO FORMATO
              </button>
            </div>
          </section>

          <div style={{ marginTop: 'auto', padding: '16px', background: 'rgba(0,0,0,0.2)', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
             <p style={{ fontSize: '0.65rem', margin: 0, opacity: 0.6, lineHeight: '1.4' }}>
               TIP: Haz clic en la papelera de una foto en el preview para excluirla de este reporte sin borrarla del proyecto.
             </p>
          </div>
        </aside>

        <main id="report-export-content" style={{ 
          flex: 1, 
          overflowY: 'auto', 
          background: 'hsl(var(--bg-tertiary))', 
          padding: '40px 0',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '40px'
        }}>
          {pages.length === 0 ? (
            <div className="flex-center" style={{ height: '100%', flexDirection: 'column', opacity: 0.3 }}>
              <FileText size={64} />
              <p className="font-bold">No hay fotos que coincidan con los filtros</p>
            </div>
          ) : (
            pages.map((pagePhotos, pageIdx) => (
              <div key={pageIdx} className="report-page shadow-xl" style={{
                width: '21cm',
                minHeight: '27.9cm',
                background: '#fff',
                color: '#000',
                padding: '1.5cm',
                display: 'flex',
                flexDirection: 'column',
                position: 'relative',
                visibility: 'visible',
                opacity: 1
              }}>
                <table border={0} cellSpacing={0} cellPadding={0} style={{ 
                  width: '100%', 
                  tableLayout: 'fixed',
                  border: '0.5pt solid #2F6FED',
                  background: '#fff'
                }}>
                  <tbody>
                    {/* Cabecera */}
                    <tr>
                      <td colSpan={2} style={{ padding: 0 }}>
                        <div style={{ 
                          display: 'flex', 
                          alignItems: 'stretch', 
                          background: '#0B1220',
                          color: '#fff',
                        }}>
                          <div style={{ width: '18%', background: '#0B1220', padding: '15px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <img src={logo} alt="" style={{ width: '40px', height: '40px', objectFit: 'contain', filter: 'invert(1)' }} />
                          </div>
                          <div style={{ width: '82%', background: '#172554', padding: '15px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                              <h1 style={{ margin: 0, fontSize: '14pt', fontWeight: '900', letterSpacing: '0.5px' }}>{project.name.toUpperCase()}</h1>
                              <span style={{ fontSize: '18pt', fontWeight: '900', opacity: 0.9 }}>Logi</span>
                            </div>
                            <p style={{ margin: '4px 0 0 0', fontSize: '7.5pt', fontWeight: '800', color: '#3B82F6', textAlign: 'right', textTransform: 'uppercase' }}>
                              {getHeaderText()}
                            </p>
                          </div>
                        </div>
                        <div style={{ height: '3.5pt', background: '#3B82F6', width: '100%' }}></div>
                      </td>
                    </tr>

                    <tr style={{ height: '15px' }}><td colSpan={2}></td></tr>

                    {/* Filas de fotos y captions */}
                    {(() => {
                      const rows = [];
                      for (let i = 0; i < pagePhotos.length; i += 2) {
                        const left = pagePhotos[i];
                        const right = pagePhotos[i+1];
                        
                        // Fila de imágenes
                        rows.push(
                          <tr key={`img-${i}`}>
                            {[left, right].map((photo, idx) => (
                              <td key={`td-img-${idx}`} style={{ 
                                width: '50%', 
                                padding: '8pt', 
                                verticalAlign: 'top',
                                borderLeft: idx === 0 ? 'none' : '0.5pt solid #2F6FED',
                                borderTop: '0.5pt solid #2F6FED',
                                textAlign: 'center'
                              }}>
                                {photo ? (
                                  <div style={{
                                    width: '7.59cm',
                                    height: '4.6cm',
                                    background: 'transparent',
                                    overflow: 'hidden',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    position: 'relative',
                                    borderRadius: 0,
                                    margin: '0 auto'
                                  }}>
                                    <button 
                                      onClick={() => removePhotoFromReport(photo.id)}
                                      className="no-print"
                                      style={{
                                        position: 'absolute', top: '5px', right: '5px',
                                        background: 'rgba(255,0,0,0.8)', color: '#fff',
                                        border: 'none', padding: '6px', borderRadius: '4px',
                                        cursor: 'pointer', zIndex: 10
                                      }}
                                    >
                                      <Trash2 size={12} />
                                    </button>
                                    {photo.isLocal ? (
                                      <LocalImage
                                        key={photo.id}
                                        photo={photo}
                                        getPhotoLocalUrl={getPhotoLocalUrl}
                                        style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 0 }}
                                      />
                                    ) : (
                                      <img 
                                        key={photo.id}
                                        src={photo.imageUrl} 
                                        alt="" 
                                        style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 0 }} 
                                      />
                                    )}
                                  </div>
                                ) : null}
                              </td>
                            ))}
                          </tr>
                        );

                        // Fila de captions
                        rows.push(
                          <tr key={`cap-${i}`}>
                            {[left, right].map((photo, idx) => {
                              const globalIdx = (pageIdx * PHOTOS_PER_PAGE) + (i + idx) + 1;
                              const showItem = photo && photo.itemCode && photo.itemCode !== 'N/A' && photo.itemCode !== 'General' && photo.itemCode.trim() !== '';
                              
                              let itemDesc = '';
                              if (showItem) {
                                const activeItems = project.activeBudgetVersionId 
                                  ? project.budgetVersions?.find(v => v.id === project.activeBudgetVersionId)?.items || project.budgetItems
                                  : project.budgetItems;
                                const budgetItem = activeItems?.find(b => b.item === photo?.itemCode);
                                itemDesc = budgetItem ? budgetItem.descripcion : '';
                                if (itemDesc.length > 45) {
                                  itemDesc = itemDesc.substring(0, 45).trim() + '...';
                                }
                              }

                              return (
                                <td key={`td-cap-${idx}`} style={{ 
                                  width: '50%', 
                                  padding: '10pt', 
                                  verticalAlign: 'top',
                                  borderLeft: idx === 0 ? 'none' : '0.5pt solid #2F6FED',
                                  borderBottom: '0.5pt solid #2F6FED'
                                }}>
                                  {photo ? (
                                    <div style={{ minHeight: '45pt' }}>
                                      <p style={{ 
                                        fontSize: '9.5pt', 
                                        lineHeight: '1.2', 
                                        margin: '0', 
                                        color: '#111'
                                      }}>
                                        <span>Foto No. {globalIdx}</span>
                                        {showItem && <span>, ítem {photo.itemCode}. {itemDesc ? `"${itemDesc}"` : ''}</span>}
                                        {!showItem && <span>.</span>}
                                        {photo.description && <span> {photo.description}</span>}
                                      </p>
                                    </div>
                                  ) : null}
                                </td>
                              );
                            })}
                          </tr>
                        );
                      }
                      return rows;
                    })()}
                  </tbody>
                </table>

                <div style={{ 
                  marginTop: '20px', 
                  paddingTop: '10px', 
                  borderTop: '1px solid #eee',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  fontSize: '7pt',
                  color: '#999',
                  fontWeight: '700'
                }}>
                  <span>GENERADO POR CONTROL APP | {new Date().toLocaleDateString()}</span>
                  <span>PÁGINA {pageIdx + 1} DE {pages.length}</span>
                </div>
              </div>
            ))
          )}
        </main>
      </div>

      <style>{`
        @media screen {
          .report-wizard-overlay { animation: fadeIn 0.3s ease; }
          @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
          .report-page { margin-bottom: 40px; border-radius: 4px; }
        }

        @media print {
          /* Reset total para impresión */
          html, body { 
            background: #fff !important; 
            margin: 0 !important; 
            padding: 0 !important; 
            width: 210mm !important; /* Forzar ancho A4/Carta */
          }
          
          /* Ocultar todo lo que no sea el reporte */
          body > *:not(.report-wizard-overlay) { display: none !important; }
          .report-wizard-overlay { 
            position: static !important; 
            display: block !important; 
            background: #fff !important;
            padding: 0 !important;
            margin: 0 !important;
          }
          header, aside, .no-print { display: none !important; }
          main { 
            padding: 0 !important; 
            margin: 0 !important; 
            display: block !important;
            overflow: visible !important;
          }

          .report-page { 
            display: flex !important;
            flex-direction: column !important;
            width: 210mm !important; 
            height: 279mm !important; /* Alto Carta estándar */
            padding: 15mm !important;
            margin: 0 !important;
            box-shadow: none !important;
            page-break-after: always !important;
            break-after: page !important;
            background: #fff !important;
            position: relative !important;
            visibility: visible !important;
            opacity: 1 !important;
          }

          .report-page * {
            visibility: visible !important;
            opacity: 1 !important;
          }

          @page { 
            size: portrait; 
            margin: 0; 
          }
        }

        .report-wizard-overlay .input-field {
          background: hsl(var(--bg-primary));
          border: 1px solid hsl(var(--border-color));
          color: hsl(var(--text-primary));
          height: 32px;
          border-radius: 4px;
          padding: 0 10px;
          outline: none;
        }
        .report-wizard-overlay .input-field:focus {
          border-color: hsl(var(--accent-primary));
        }
        .report-wizard-overlay .btn-icon:hover {
          color: hsl(var(--text-primary)) !important;
        }

        /* Estilos para selectores de fecha técnicos */
        .date-input-wrapper {
          display: flex;
          align-items: center;
          gap: 10px;
          height: 32px;
          background: hsl(var(--bg-primary));
          border: 1px solid hsl(var(--border-color));
          border-radius: 4px;
          padding: 0 10px;
          cursor: pointer;
          transition: all 0.2s ease;
        }
        .date-input-wrapper:hover {
          border-color: hsl(var(--accent-primary));
          background: hsla(var(--accent-primary), 0.05);
        }
        .date-icon {
          color: hsl(var(--accent-primary));
          opacity: 0.8;
        }
        .date-display {
          font-size: 0.65rem;
          font-weight: 800;
          font-family: var(--font-technical);
          letter-spacing: 0.5px;
          color: hsl(var(--text-primary));
        }
        .hidden-date-input {
          position: absolute;
          inset: 0;
          opacity: 0;
          cursor: pointer;
          width: 100%;
          height: 100%;
        }
        /* Ajuste para que el icono de calendario nativo no estorbe si apareciera */
        .hidden-date-input::-webkit-calendar-picker-indicator {
          position: absolute;
          inset: 0;
          width: 100%;
          height: 100%;
          cursor: pointer;
        }
      `}</style>
      {showSaveModal && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 11000
        }}>
          <div style={{
            background: 'hsl(var(--bg-secondary))', border: '1px solid hsl(var(--border-color))',
            borderRadius: '8px', padding: '24px', width: '400px', boxShadow: '0 20px 50px rgba(0,0,0,0.5)',
            display: 'flex', flexDirection: 'column', gap: '16px'
          }}>
            <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 'bold', letterSpacing: '0.5px', color: 'hsl(var(--text-primary))' }}>
              GUARDAR INFORME FOTOGRÁFICO
            </h3>
            <div>
              <label style={{ display: 'block', fontSize: '0.65rem', fontWeight: 'bold', marginBottom: '8px', color: 'hsl(var(--text-secondary))' }}>
                NOMBRE DEL INFORME
              </label>
              <input 
                type="text" 
                value={reportName} 
                onChange={e => setReportName(e.target.value)} 
                placeholder="Nombre del reporte..."
                style={{
                  width: '100%', height: '36px', background: 'hsl(var(--bg-primary))',
                  border: '1px solid hsl(var(--border-color))', borderRadius: '4px',
                  color: 'hsl(var(--text-primary))', padding: '0 12px', fontSize: '0.8rem',
                  outline: 'none'
                }}
                onFocus={e => e.target.style.borderColor = 'hsl(var(--accent-primary))'}
                onBlur={e => e.target.style.borderColor = 'hsl(var(--border-color))'}
              />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '8px' }}>
              <button 
                onClick={() => setShowSaveModal(false)}
                className="btn btn-secondary"
                style={{ height: '32px', padding: '0 16px', fontSize: '0.75rem' }}
              >
                CANCELAR
              </button>
              <button 
                onClick={handleSaveReport}
                className="btn btn-primary"
                style={{ height: '32px', padding: '0 16px', fontSize: '0.75rem', background: 'hsl(var(--accent-primary))', color: '#000', border: 'none' }}
              >
                GUARDAR
              </button>
            </div>
          </div>
        </div>
      )}
    </div>,
    document.body
  );
}
