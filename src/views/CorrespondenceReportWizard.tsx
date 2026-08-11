import { useState, useMemo, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { 
  X, Filter, Calendar, Search, FileText, 
  Trash2, Printer, Check, FolderOpen
} from 'lucide-react';
import { useProjects } from '../context/ProjectsContext';
import type { ImportedEmail, Project } from '../types/projectTypes';
import { exportCorrespondenceDocx } from '../services/docxService';
import logo from '../assets/logo.png';

interface CorrespondenceReportWizardProps {
  onClose: () => void;
  savedReportId?: string; // Si editamos uno guardado (opcional)
}

export default function CorrespondenceReportWizard({ onClose, savedReportId }: CorrespondenceReportWizardProps) {
  const { getActiveProject, updateProject } = useProjects();
  const project = getActiveProject() as Project;

  if (!project) return null;

  // Buscar si hay un reporte guardado para editar
  const savedReport = useMemo(() => {
    return project.gmailCorrespondenceReports?.find(r => r.id === savedReportId);
  }, [project.gmailCorrespondenceReports, savedReportId]);

  const [dateFrom, setDateFrom] = useState(savedReport?.dateFrom || '');
  const [dateTo, setDateTo] = useState(savedReport?.dateTo || '');
  const [textFilter, setTextFilter] = useState(savedReport?.textFilter || '');
  const [categoryFilter, setCategoryFilter] = useState<string>(savedReport?.categoryFilter || 'all');
  
  const [reportEmails, setReportEmails] = useState<ImportedEmail[]>([]);
  const [isInitialized, setIsInitialized] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [reportName, setReportName] = useState('');

  // Cargar/filtrar correos al abrir o cambiar filtros
  useEffect(() => {
    if (!project) return;

    // Si es un reporte guardado, cargamos los correos específicos que se guardaron
    if (savedReport && !isInitialized) {
      const allEmails = project.gmailEmails || [];
      const savedEmails = savedReport.emailIds
        .map(id => allEmails.find(e => e.id === id))
        .filter((e): e is ImportedEmail => !!e);
      
      setReportEmails(savedEmails);
      setIsInitialized(true);
      return;
    }

    // Si es un reporte nuevo o ya se inicializó, filtramos dinámicamente
    if (!savedReport || isInitialized) {
      let filtered = [...(project.gmailEmails || [])];
      
      if (dateFrom) {
        filtered = filtered.filter(e => e.date >= dateFrom);
      }
      if (dateTo) {
        filtered = filtered.filter(e => e.date <= dateTo);
      }
      if (categoryFilter !== 'all') {
        filtered = filtered.filter(e => e.category === categoryFilter);
      }
      if (textFilter) {
        const query = textFilter.toLowerCase();
        filtered = filtered.filter(e => 
          e.subject.toLowerCase().includes(query) || 
          e.sender.toLowerCase().includes(query) || 
          e.receiver.toLowerCase().includes(query)
        );
      }

      // Ordenar cronológicamente ascendente para el reporte oficial
      filtered.sort((a, b) => a.dateTime.localeCompare(b.dateTime));
      setReportEmails(filtered);
      setIsInitialized(true);
    }
  }, [project, dateFrom, dateTo, textFilter, categoryFilter, savedReport, isInitialized]);

  // Excluir correo del reporte
  const handleExcludeEmail = (id: string) => {
    setReportEmails(prev => prev.filter(e => e.id !== id));
    setHasChanges(true);
  };

  // Guardar reporte
  const handleSaveReport = () => {
    if (!reportName.trim()) return;

    const newReport = {
      id: savedReport?.id || `corr-rep-${Date.now()}`,
      name: reportName.trim(),
      createdAt: savedReport?.createdAt || new Date().toISOString(),
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined,
      categoryFilter: categoryFilter !== 'all' ? categoryFilter : undefined,
      textFilter: textFilter || undefined,
      emailIds: reportEmails.map(e => e.id)
    };

    let updatedReports = [...(project.gmailCorrespondenceReports || [])];
    if (savedReport) {
      updatedReports = updatedReports.map(r => r.id === savedReport.id ? newReport : r);
    } else {
      updatedReports.push(newReport);
    }

    updateProject(project.id, { gmailCorrespondenceReports: updatedReports });
    setHasChanges(false);
    setShowSaveModal(false);

    // Mensaje flotante de éxito
    const flash = document.createElement('div');
    flash.innerText = "✓ Reporte Guardado Exitosamente";
    flash.style.position = 'fixed';
    flash.style.bottom = '24px';
    flash.style.right = '24px';
    flash.style.background = 'hsl(var(--accent-primary))';
    flash.style.color = '#000';
    flash.style.padding = '12px 24px';
    flash.style.borderRadius = '8px';
    flash.style.fontWeight = 'bold';
    flash.style.zIndex = '1000000';
    flash.style.fontSize = '0.8rem';
    document.body.appendChild(flash);
    setTimeout(() => flash.remove(), 2500);
  };

  const handlePrint = () => {
    window.print();
  };

  const handleExportWord = async () => {
    try {
      const blob = await exportCorrespondenceDocx(
        project.name,
        sentEmails,
        receivedEmails,
        getHeaderText()
      );
      
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `Reporte_Correspondencia_${project.name.replace(/[^a-zA-Z0-9]/g, '_')}_${new Date().toISOString().split('T')[0]}.docx`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err: any) {
      console.error("Error al exportar a Word:", err);
      alert("Error al generar el documento de Word: " + err.message);
    }
  };

  // Separar correos en enviados y recibidos
  const sentEmails = reportEmails.filter(e => e.direction === 'outbound');
  const receivedEmails = reportEmails.filter(e => e.direction === 'inbound');

  // Algoritmo de paginación para correspondencia
  interface PageSection {
    type: 'sent' | 'received';
    isContinuation: boolean;
    emails: ImportedEmail[];
  }
  
  interface PageContent {
    showHeader: boolean;
    sections: PageSection[];
  }

  const pages = useMemo<PageContent[]>(() => {
    if (reportEmails.length === 0) return [];
    
    const paginatedPages: PageContent[] = [];
    let currentSections: PageSection[] = [];
    let currentHeight = 0;

    const getPageCapacity = (pageIdx: number) => {
      // Altura total utilizable = 850px (conservador para evitar desborde bajo cualquier DPI)
      return pageIdx === 0 ? 730 : 810;
    };

    const getEmailHeight = (email: ImportedEmail) => {
      const senderText = email.sender.split(' <')[0];
      const receiverText = email.receiver.split(' <')[0];
      
      const subjectLines = Math.ceil(email.subject.length / 38);
      const senderLines = Math.ceil(senderText.length / 22);
      const receiverLines = Math.ceil(receiverText.length / 22);
      
      const maxLines = Math.max(1, subjectLines, senderLines, receiverLines);
      return 20 + maxLines * 13; // 20px base + 13px por cada línea de texto
    };

    let isFirstPage = true;
    const remainingSent = [...sentEmails];
    const remainingReceived = [...receivedEmails];

    const flushPage = () => {
      paginatedPages.push({
        showHeader: isFirstPage,
        sections: [...currentSections]
      });
      currentSections = [];
      currentHeight = 0;
      isFirstPage = false;
    };

    // Procesar correspondencia enviada
    if (remainingSent.length > 0) {
      let isContinuation = false;
      while (remainingSent.length > 0) {
        const capacity = getPageCapacity(paginatedPages.length);
        const startCost = isContinuation ? 30 : 65; // 30px cabecera tabla, 65px si tiene título de sección

        const firstEmailHeight = getEmailHeight(remainingSent[0]);
        if (currentHeight + startCost + firstEmailHeight > capacity) {
          flushPage();
          continue;
        }

        let accumulatedHeight = startCost;
        let count = 0;
        for (let i = 0; i < remainingSent.length; i++) {
          const itemHeight = getEmailHeight(remainingSent[i]);
          if (currentHeight + accumulatedHeight + itemHeight > capacity) {
            break;
          }
          accumulatedHeight += itemHeight;
          count++;
        }

        const batch = remainingSent.splice(0, count);
        currentSections.push({
          type: 'sent',
          isContinuation,
          emails: batch
        });

        currentHeight += accumulatedHeight;
        isContinuation = true;

        if (remainingSent.length > 0 || currentHeight >= capacity) {
          flushPage();
        }
      }
    } else {
      currentSections.push({
        type: 'sent',
        isContinuation: false,
        emails: []
      });
      currentHeight += 65 + 25; // costo de cabecera de sección + texto vacío
    }

    // Procesar correspondencia recibida
    if (remainingReceived.length > 0) {
      let isContinuation = false;
      while (remainingReceived.length > 0) {
        const capacity = getPageCapacity(paginatedPages.length);
        const marginCost = currentSections.length > 0 ? 20 : 0;
        const startCost = isContinuation ? (30 + marginCost) : (65 + marginCost);

        const firstEmailHeight = getEmailHeight(remainingReceived[0]);
        if (currentHeight + startCost + firstEmailHeight > capacity) {
          flushPage();
          continue;
        }

        let accumulatedHeight = startCost;
        let count = 0;
        for (let i = 0; i < remainingReceived.length; i++) {
          const itemHeight = getEmailHeight(remainingReceived[i]);
          if (currentHeight + accumulatedHeight + itemHeight > capacity) {
            break;
          }
          accumulatedHeight += itemHeight;
          count++;
        }

        const batch = remainingReceived.splice(0, count);
        currentSections.push({
          type: 'received',
          isContinuation,
          emails: batch
        });

        currentHeight += accumulatedHeight;
        isContinuation = true;

        if (remainingReceived.length > 0 || currentHeight >= capacity) {
          flushPage();
        }
      }
    } else {
      const capacity = getPageCapacity(paginatedPages.length);
      const marginCost = currentSections.length > 0 ? 20 : 0;
      const startCost = 65 + marginCost;

      if (currentHeight + startCost + 25 > capacity) {
        flushPage();
      }
      
      currentSections.push({
        type: 'received',
        isContinuation: false,
        emails: []
      });
      currentHeight += startCost + 25;
    }

    if (currentSections.length > 0) {
      flushPage();
    }

    return paginatedPages;
  }, [sentEmails, receivedEmails, reportEmails]);

  const getHeaderText = () => {
    if (dateFrom && dateTo) return `PERIODO: ${dateFrom} AL ${dateTo}`;
    if (dateFrom) return `PERIODO: DESDE ${dateFrom}`;
    if (dateTo) return `PERIODO: HASTA ${dateTo}`;
    return "CORRESPONDENCIA GENERAL DEL PROYECTO";
  };

  const getCategoryLabel = (cat: string) => {
    switch (cat) {
      case 'obra': return 'Obra';
      case 'supervision': return 'Supervisión';
      case 'interventoria': return 'Interventoría';
      case 'general': return 'General';
      default: return cat;
    }
  };

  return createPortal(
    <div className="report-wizard-overlay animate-in" style={{
      position: 'fixed', inset: 0, background: 'hsl(var(--bg-primary))', zIndex: 10000,
      display: 'flex', flexDirection: 'column', color: 'hsl(var(--text-primary))'
    }}>
      {/* Save Modal */}
      {showSaveModal && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', backdropFilter: 'blur(8px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10001
        }}>
          <div style={{
            background: 'hsl(var(--bg-secondary))',
            border: '1px solid hsl(var(--border-color))',
            borderRadius: '12px',
            padding: '24px',
            width: '400px',
            display: 'flex',
            flexDirection: 'column',
            gap: '16px'
          }}>
            <h3 style={{ margin: 0, fontSize: '0.9rem', fontWeight: 'bold', fontFamily: 'var(--font-technical)', color: 'hsl(var(--accent-primary))' }}>
              GUARDAR REPORTE DE CORRESPONDENCIA
            </h3>
            <div>
              <label style={{ fontSize: '0.65rem', color: 'hsl(var(--text-muted))', display: 'block', textTransform: 'uppercase', marginBottom: '6px' }}>Nombre del Reporte</label>
              <input
                type="text"
                value={reportName}
                onChange={e => setReportName(e.target.value)}
                style={{
                  width: '100%',
                  background: 'hsl(var(--bg-primary))',
                  border: '1px solid hsl(var(--border-color))',
                  borderRadius: '6px',
                  color: 'hsl(var(--text-primary))',
                  padding: '8px 12px',
                  fontSize: '0.75rem',
                  outline: 'none'
                }}
                placeholder="Nombre del reporte..."
              />
            </div>
            <div style={{ display: 'flex', gap: '10px', marginTop: '8px' }}>
              <button 
                className="btn btn-secondary" 
                onClick={() => setShowSaveModal(false)}
                style={{ flex: 1, fontSize: '0.75rem', height: '36px' }}
              >
                CANCELAR
              </button>
              <button 
                className="btn btn-primary" 
                onClick={handleSaveReport}
                disabled={!reportName.trim()}
                style={{ flex: 1, fontSize: '0.75rem', height: '36px', background: 'hsl(var(--accent-primary))', color: '#000', border: 'none' }}
              >
                GUARDAR
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main Header */}
      <header className="no-print" style={{
        height: '64px', borderBottom: '1px solid hsl(var(--border-color))',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 24px', background: 'hsla(var(--bg-secondary-hsl), 0.8)', backdropFilter: 'blur(10px)',
        flexShrink: 0
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <button onClick={onClose} className="btn-icon" style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'hsl(var(--text-muted))' }}>
            <X size={24} />
          </button>
          <div>
            <h2 style={{ margin: 0, fontSize: '0.9rem', fontWeight: '800', letterSpacing: '1px', color: 'hsl(var(--text-primary))' }}>
              ASISTENTE DE REPORTES DE CORRESPONDENCIA
            </h2>
            <p style={{ margin: 0, fontSize: '0.65rem', color: 'hsl(var(--text-muted))', fontWeight: '600' }}>
              {project.name.toUpperCase()}
            </p>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ display: 'flex', gap: '8px', marginRight: '16px' }}>
            <div className="badge badge-accent" style={{ fontSize: '10px', background: 'rgba(0, 255, 136, 0.1)', color: '#00ff88', border: '1px solid rgba(0, 255, 136, 0.2)', padding: '2px 8px', borderRadius: '4px', fontWeight: 'bold' }}>
              {reportEmails.length} CORREOS
            </div>
          </div>

          <button 
            onClick={() => {
              if (reportEmails.length === 0) {
                alert("No se puede guardar un reporte sin correos.");
                return;
              }
              setReportName(savedReport?.name || `Reporte Correspondencia - ${new Date().toLocaleDateString()}`);
              setShowSaveModal(true);
            }}
            className="btn btn-secondary"
            style={{ 
              height: '36px', 
              padding: '0 20px', 
              fontWeight: '800', 
              color: savedReport && !hasChanges ? 'hsl(var(--text-muted))' : '#000', 
              background: savedReport && !hasChanges ? 'transparent' : 'hsl(var(--accent-primary))',
              borderColor: savedReport && !hasChanges ? 'hsl(var(--border-color))' : 'hsl(var(--accent-primary))',
              fontSize: '0.75rem'
            }}
            disabled={!!savedReport && !hasChanges}
          >
            {savedReport ? 'GUARDAR CAMBIOS' : 'GUARDAR REPORTE'}
          </button>

          <button 
            onClick={handleExportWord} 
            className="btn btn-primary" 
            style={{ height: '36px', padding: '0 20px', fontWeight: '800', background: '#185abd', color: '#fff', border: 'none', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.75rem' }}
          >
            <FileText size={15} /> EXPORTAR WORD
          </button>

          <button 
            onClick={handlePrint} 
            className="btn btn-primary" 
            style={{ height: '36px', padding: '0 20px', fontWeight: '800', background: 'hsl(var(--danger))', border: 'none', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.75rem' }}
          >
            <Printer size={15} /> IMPRIMIR / PDF
          </button>
        </div>
      </header>

      {/* Main Body */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        
        {/* Sidebar Filters */}
        <aside className="no-print" style={{
          width: '320px', borderRight: '1px solid hsl(var(--border-color))',
          background: 'hsl(var(--bg-secondary))', padding: '24px', overflowY: 'auto',
          display: 'flex', flexDirection: 'column', gap: '24px'
        }}>
          <div>
            <h3 style={{ fontSize: '0.7rem', fontWeight: '900', color: 'hsl(var(--accent-primary))', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px', textTransform: 'uppercase' }}>
              <Filter size={14} /> FILTRAR CORRESPONDENCIA
            </h3>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {/* Fechas */}
              <div>
                <label style={{ display: 'block', fontSize: '0.6rem', fontWeight: '800', marginBottom: '8px', color: 'hsl(var(--text-muted))', textTransform: 'uppercase' }}>RANGO DE FECHAS</label>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <div className="date-input-wrapper" style={{ flex: 1, position: 'relative', background: 'hsl(var(--bg-primary))', border: '1px solid hsl(var(--border-color))', padding: '6px 8px', borderRadius: '6px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <Calendar size={13} style={{ color: 'hsl(var(--accent-primary))' }} />
                    <span style={{ fontSize: '0.7rem', color: dateFrom ? 'hsl(var(--text-primary))' : 'hsl(var(--text-muted))' }}>{dateFrom || 'DESDE'}</span>
                    <input 
                      type="date" 
                      value={dateFrom} 
                      onChange={e => { setDateFrom(e.target.value); setHasChanges(true); }} 
                      style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer' }}
                    />
                  </div>
                  <div className="date-input-wrapper" style={{ flex: 1, position: 'relative', background: 'hsl(var(--bg-primary))', border: '1px solid hsl(var(--border-color))', padding: '6px 8px', borderRadius: '6px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <Calendar size={13} style={{ color: 'hsl(var(--accent-primary))' }} />
                    <span style={{ fontSize: '0.7rem', color: dateTo ? 'hsl(var(--text-primary))' : 'hsl(var(--text-muted))' }}>{dateTo || 'HASTA'}</span>
                    <input 
                      type="date" 
                      value={dateTo} 
                      onChange={e => { setDateTo(e.target.value); setHasChanges(true); }} 
                      style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer' }}
                    />
                  </div>
                </div>
              </div>

              {/* Búsqueda por Texto */}
              <div>
                <label style={{ display: 'block', fontSize: '0.6rem', fontWeight: '800', marginBottom: '8px', color: 'hsl(var(--text-muted))', textTransform: 'uppercase' }}>BUSCAR ASUNTO / REMITENTE</label>
                <div style={{ position: 'relative' }}>
                  <Search size={14} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'hsl(var(--accent-primary))' }} />
                  <input 
                    type="text" 
                    placeholder="Buscar..." 
                    value={textFilter}
                    onChange={e => { setTextFilter(e.target.value); setHasChanges(true); }}
                    style={{
                      width: '100%',
                      background: 'hsl(var(--bg-primary))',
                      border: '1px solid hsl(var(--border-color))',
                      borderRadius: '6px',
                      color: 'hsl(var(--text-primary))',
                      padding: '6px 10px 6px 32px',
                      fontSize: '0.75rem',
                      outline: 'none'
                    }}
                  />
                </div>
              </div>

              {/* Grupo / Categoría */}
              <div>
                <label style={{ display: 'block', fontSize: '0.6rem', fontWeight: '800', marginBottom: '8px', color: 'hsl(var(--text-muted))', textTransform: 'uppercase' }}>FILTRAR POR GRUPO</label>
                <select
                  value={categoryFilter}
                  onChange={e => { setCategoryFilter(e.target.value); setHasChanges(true); }}
                  style={{
                    width: '100%',
                    background: 'hsl(var(--bg-primary))',
                    border: '1px solid hsl(var(--border-color))',
                    borderRadius: '6px',
                    color: 'hsl(var(--text-primary))',
                    padding: '6px 10px',
                    fontSize: '0.75rem',
                    outline: 'none'
                  }}
                >
                  <option value="all">TODOS LOS GRUPOS</option>
                  <option value="obra">CORREOS DE OBRA</option>
                  <option value="supervision">CORREOS DE SUPERVISIÓN</option>
                  <option value="interventoria">CORREOS DE INTERVENTORÍA</option>
                  <option value="general">CORREOS GENERALES</option>
                </select>
              </div>
            </div>
          </div>

          {savedReport && (
            <div style={{ padding: '12px', background: hasChanges ? 'rgba(234,179,8,0.1)' : 'rgba(59,130,246,0.1)', borderRadius: '8px', border: hasChanges ? '1px solid #eab308' : '1px solid #3b82f6' }}>
              <span style={{ fontSize: '0.65rem', fontWeight: 'bold', color: hasChanges ? '#eab308' : '#3b82f6', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <FolderOpen size={12} /> {hasChanges ? 'CAMBIOS SIN GUARDAR' : 'REPORTE GUARDADO'}
              </span>
              {hasChanges && (
                <p style={{ fontSize: '0.65rem', color: 'hsl(var(--text-muted))', margin: '4px 0 0 0', lineHeight: '1.4' }}>
                  Haz clic en "GUARDAR CAMBIOS" arriba para guardar las exclusiones.
                </p>
              )}
            </div>
          )}

          <div style={{ marginTop: 'auto', padding: '16px', background: 'rgba(0,0,0,0.2)', borderRadius: '8px', border: '1px solid hsl(var(--border-color))' }}>
            <p style={{ fontSize: '0.65rem', margin: 0, opacity: 0.6, lineHeight: '1.4' }}>
              <strong>Tip:</strong> Haz clic en el icono de papelera <Trash2 size={10} /> junto a un correo en las tablas del reporte para excluirlo del informe impreso. No se eliminará del historial de sincronización del proyecto.
            </p>
          </div>
        </aside>

        {/* Report Preview Sheets */}
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
            <div className="flex-center" style={{ height: '100%', flexDirection: 'column', opacity: 0.3, gap: '10px' }}>
              <FileText size={48} />
              <p className="font-bold">No hay correos correspondientes a los filtros.</p>
            </div>
          ) : (
            pages.map((page, pageIdx) => (
              <div key={pageIdx} className="report-page correspondence-report-page shadow-xl" style={{
                width: '21.6cm', // Ancho estándar carta
                height: '27.9cm', // Fijo para simular la hoja real
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
                {/* Header de la constructora/interventoría (solo en la primera página) */}
                {page.showHeader ? (
                  <div style={{ 
                    display: 'flex', 
                    alignItems: 'center', 
                    borderBottom: '2px solid #2F6FED',
                    paddingBottom: '12px',
                    marginBottom: '20px'
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                      <img src={logo} alt="" style={{ width: '42px', height: '42px', objectFit: 'contain' }} />
                      <div>
                        <h1 style={{ margin: 0, fontSize: '13pt', fontWeight: '900', color: '#0F172A', letterSpacing: '0.5px' }}>
                          {project.name.toUpperCase()}
                        </h1>
                        <p style={{ margin: '2px 0 0 0', fontSize: '7pt', fontWeight: '700', color: '#2F6FED', textTransform: 'uppercase' }}>
                          INFORME DE CONTROL DE CORRESPONDENCIA - {getHeaderText()}
                        </p>
                      </div>
                    </div>
                    <div style={{ marginLeft: 'auto', textAlign: 'right', fontSize: '7.5pt', color: '#64748B', fontWeight: 'bold' }}>
                      FECHA: {new Date().toLocaleDateString()}
                    </div>
                  </div>
                ) : (
                  /* Cabecera simplificada para páginas siguientes */
                  <div style={{ 
                    display: 'flex', 
                    justifyContent: 'space-between',
                    alignItems: 'center', 
                    borderBottom: '1px solid #cbd5e1',
                    paddingBottom: '6px',
                    marginBottom: '15px',
                    fontSize: '7.5pt',
                    color: '#64748B',
                    fontWeight: 'bold'
                  }}>
                    <span>{project.name.toUpperCase()} - REPORTE DE CORRESPONDENCIA</span>
                    <span>{new Date().toLocaleDateString()}</span>
                  </div>
                )}

                {/* Secciones de esta página */}
                <div style={{ flex: '1 0 auto', display: 'flex', flexDirection: 'column' }}>
                  {page.sections.map((section, secIdx) => {
                    const isSent = section.type === 'sent';
                    const titleText = isSent 
                      ? (section.isContinuation ? '6.1 CORRESPONDENCIA ENVIADA (Continuación)' : '6.1 CORRESPONDENCIA ENVIADA')
                      : (section.isContinuation ? '6.2 CORRESPONDENCIA RECIBIDA (Continuación)' : '6.2 CORRESPONDENCIA RECIBIDA');
                    
                    return (
                      <div key={secIdx} style={{ marginBottom: isSent ? '20px' : '0px' }}>
                        <h3 style={{
                          fontSize: '10pt',
                          fontWeight: '900',
                          color: '#0F172A',
                          margin: '0 0 8px 0',
                          borderBottom: '1px solid #cbd5e1',
                          paddingBottom: '3px',
                          fontFamily: 'var(--font-technical)'
                        }}>
                          {titleText}
                        </h3>

                        {section.emails.length === 0 ? (
                          <p style={{ fontSize: '8pt', color: '#64748B', margin: '5px 0', fontStyle: 'italic' }}>
                            {isSent 
                              ? 'No se registra correspondencia enviada en este rango de tiempo.'
                              : 'No se registra correspondencia recibida en este rango de tiempo.'}
                          </p>
                        ) : (
                          <table style={{
                            width: '100%',
                            borderCollapse: 'collapse',
                            fontSize: '8pt',
                            textAlign: 'left'
                          }}>
                            <thead>
                              <tr style={{ background: '#dbeafe', border: '1px solid #94a3b8' }}>
                                <th style={{ padding: '5px 6px', border: '1px solid #cbd5e1', width: '15%', fontWeight: 'bold', color: '#1e3a8a' }}>Fecha</th>
                                <th style={{ padding: '5px 6px', border: '1px solid #cbd5e1', width: '20%', fontWeight: 'bold', color: '#1e3a8a' }}>Remitente</th>
                                <th style={{ padding: '5px 6px', border: '1px solid #cbd5e1', width: '20%', fontWeight: 'bold', color: '#1e3a8a' }}>Destinatario</th>
                                <th style={{ padding: '5px 6px', border: '1px solid #cbd5e1', width: '35%', fontWeight: 'bold', color: '#1e3a8a' }}>Asunto</th>
                                <th style={{ padding: '5px 6px', border: '1px solid #cbd5e1', width: '10%', fontWeight: 'bold', color: '#1e3a8a', textAlign: 'center' }}>Anexos</th>
                                <th className="no-print" style={{ width: '30px', border: '1px solid #cbd5e1', background: '#f1f5f9' }}></th>
                              </tr>
                            </thead>
                            <tbody>
                              {section.emails.map(email => (
                                <tr key={email.id} style={{ borderBottom: '1px solid #cbd5e1' }}>
                                  <td style={{ padding: '5px 6px', border: '1px solid #cbd5e1', color: '#334155' }}>
                                    {email.date}
                                  </td>
                                  <td style={{ padding: '5px 6px', border: '1px solid #cbd5e1', color: '#334155', fontWeight: '500' }}>
                                    {email.sender.split(' <')[0]}
                                  </td>
                                  <td style={{ padding: '5px 6px', border: '1px solid #cbd5e1', color: '#334155' }}>
                                    {email.receiver.split(' <')[0]}
                                  </td>
                                  <td style={{ padding: '5px 6px', border: '1px solid #cbd5e1', color: '#0f172a', fontWeight: '500' }}>
                                    {email.category !== 'general' && (
                                      <span style={{ fontSize: '6.5pt', fontWeight: 'bold', background: '#f1f5f9', border: '1px solid #cbd5e1', padding: '1px 4px', borderRadius: '3px', marginRight: '6px', color: '#475569', textTransform: 'uppercase' }}>
                                        {getCategoryLabel(email.category)}
                                      </span>
                                    )}
                                    {email.subject}
                                  </td>
                                  <td style={{ padding: '5px 6px', border: '1px solid #cbd5e1', color: '#334155', textAlign: 'center' }}>
                                    {email.attachmentsCount || 0}
                                  </td>
                                  <td className="no-print" style={{ textAlign: 'center', border: '1px solid #cbd5e1', padding: '2px' }}>
                                    <button
                                      onClick={() => handleExcludeEmail(email.id)}
                                      style={{ background: 'transparent', border: 'none', color: '#ef4444', cursor: 'pointer', padding: '2px' }}
                                      title="Excluir del reporte"
                                    >
                                      <Trash2 size={12} />
                                    </button>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Footer de la página */}
                <div style={{ 
                  marginTop: 'auto', 
                  paddingTop: '12px', 
                  borderTop: '1px solid #e2e8f0',
                  display: 'flex',
                  justifyContent: 'space-between',
                  fontSize: '6.5pt',
                  color: '#94a3b8',
                  fontWeight: 'bold'
                }}>
                  <span>CONSOLIDADO DE CORRESPONDENCIA | CONTROL APP</span>
                  <span>PÁGINA {pageIdx + 1} DE {pages.length}</span>
                </div>
              </div>
            ))
          )}
        </main>

      </div>

      {/* Print-specific Styles */}
      <style>{`
        @media screen {
          .report-wizard-overlay { animation: fadeIn 0.2s ease; }
          @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
          .report-page.correspondence-report-page { border-radius: 4px; }
        }

        @media print {
          html, body {
            background: #fff !important;
            margin: 0 !important;
            padding: 0 !important;
            width: 216mm !important; /* Forzar Carta */
          }
          
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

          .report-page.correspondence-report-page {
            display: flex !important;
            flex-direction: column !important;
            width: 216mm !important;
            height: 279mm !important; /* Alto Carta estándar fijo */
            min-height: 279mm !important; /* Alto Carta estándar mínimo */
            padding: 15mm !important;
            margin: 0 0 20px 0 !important;
            box-shadow: none !important;
            page-break-after: always !important; /* Forzar salto entre hojas */
            break-after: page !important;
            background: #fff !important;
            position: relative !important;
            visibility: visible !important;
            opacity: 1 !important;
          }

          /* Evitar que las filas se dividan a la mitad */
          tr {
            page-break-inside: avoid !important;
            break-inside: avoid !important;
          }

          /* Repetir encabezado de tabla en cada página impresa */
          thead {
            display: table-header-group !important;
          }

          .report-page.correspondence-report-page * {
            visibility: visible !important;
            opacity: 1 !important;
          }

          @page {
            size: portrait;
            margin: 0;
          }
        }
      `}</style>
    </div>,
    document.body
  );
}
