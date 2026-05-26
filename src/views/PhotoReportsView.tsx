import { useState } from 'react';
import { Folder, Trash2, Plus, FileText } from 'lucide-react';
import { useProjects } from '../context/ProjectsContext';
import PhotoReportWizard from './PhotoReportWizard';
import type { PhotoReport } from '../types/projectTypes';

export default function PhotoReportsView() {
  const { getActiveProject, removePhotoReport } = useProjects();
  const project = getActiveProject();

  const [isWizardOpen, setIsWizardOpen] = useState(false);
  const [selectedReport, setSelectedReport] = useState<PhotoReport | undefined>(undefined);

  if (!project) {
    return (
      <div className="flex-center" style={{ height: '70vh', color: 'hsl(var(--text-muted))', flexDirection: 'column', gap: 'var(--spacing-md)' }}>
        <Folder size={48} style={{ opacity: 0.2 }} />
        <p className="font-medium">Seleccione un proyecto para ver sus informes fotográficos.</p>
      </div>
    );
  }

  const reports = project.photoReports || [];

  const handleOpenReport = (report: PhotoReport) => {
    setSelectedReport(report);
    setIsWizardOpen(true);
  };

  const handleCreateReport = () => {
    setSelectedReport(undefined);
    setIsWizardOpen(true);
  };

  const handleDeleteReport = (reportId: string) => {
    if (confirm('¿Está seguro de que desea eliminar este informe guardado?')) {
      removePhotoReport(project.id, reportId);
      
      const flash = document.createElement('div');
      flash.innerText = "✓ Informe Eliminado";
      flash.style.position = 'fixed';
      flash.style.bottom = '20px';
      flash.style.right = '20px';
      flash.style.background = 'hsl(var(--danger))';
      flash.style.color = '#fff';
      flash.style.padding = '10px 20px';
      flash.style.borderRadius = '8px';
      flash.style.fontWeight = 'bold';
      flash.style.zIndex = '100000';
      document.body.appendChild(flash);
      setTimeout(() => flash.remove(), 2500);
    }
  };

  return (
    <div className="dashboard-container animate-in">
      {isWizardOpen && (
        <PhotoReportWizard 
          savedReport={selectedReport} 
          onClose={() => setIsWizardOpen(false)} 
        />
      )}

      <div className="page-header" style={{ flexShrink: 0 }}>
        <div>
          <h2 className="page-title">Informes Fotográficos</h2>
          <p style={{ color: 'hsl(var(--text-muted))', fontSize: '0.7rem', fontWeight: '600', margin: '4px 0 0 0', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
            {reports.length} INFORMES GUARDADOS
          </p>
        </div>

        <button 
          className="btn btn-primary" 
          onClick={handleCreateReport}
          style={{ 
            fontWeight: '700', 
            background: 'hsl(var(--accent-primary))', 
            color: '#000',
            border: 'none',
            display: 'flex',
            alignItems: 'center',
            gap: '8px'
          }}
        >
          <Plus size={16} /> NUEVO REPORTE
        </button>
      </div>

      <div style={{ padding: '0 24px 24px 24px', flex: 1, overflowY: 'auto' }}>
        {reports.length === 0 ? (
          <div 
            className="flex-center" 
            style={{ 
              height: '40vh', 
              flexDirection: 'column', 
              gap: '16px',
              border: '1px dashed hsl(var(--border-color))',
              borderRadius: '8px',
              background: 'hsla(var(--bg-secondary-hsl), 0.1)',
              marginTop: '20px'
            }}
          >
            <FileText size={48} style={{ opacity: 0.15, color: 'hsl(var(--accent-primary))' }} />
            <div style={{ textAlign: 'center' }}>
              <p style={{ margin: 0, fontWeight: 'bold', color: 'hsl(var(--text-secondary))' }}>No hay informes guardados</p>
              <p style={{ margin: '4px 0 0 0', fontSize: '0.75rem', color: 'hsl(var(--text-muted))' }}>
                Haga clic en "+ NUEVO REPORTE" para generar y guardar un informe fotográfico.
              </p>
            </div>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '20px', paddingTop: '20px' }}>
            {reports.map((report) => (
              <div 
                key={report.id}
                onClick={() => handleOpenReport(report)}
                style={{
                  background: 'hsla(var(--bg-secondary-hsl, 222 15% 15%), 0.4)',
                  backdropFilter: 'blur(10px)',
                  border: '1px solid hsla(var(--border-color-hsl, 222 15% 30%), 0.5)',
                  borderRadius: '12px',
                  padding: '20px',
                  cursor: 'pointer',
                  transition: 'all 0.3s ease',
                  position: 'relative',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '12px'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = 'hsl(var(--accent-primary))';
                  e.currentTarget.style.boxShadow = '0 0 15px hsla(var(--accent-primary-hsl), 0.15)';
                  e.currentTarget.style.transform = 'translateY(-2px)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = 'hsla(var(--border-color-hsl), 0.5)';
                  e.currentTarget.style.boxShadow = 'none';
                  e.currentTarget.style.transform = 'translateY(0)';
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{
                    background: 'hsla(var(--accent-primary-hsl), 0.1)',
                    border: '1px solid hsl(var(--accent-primary))',
                    borderRadius: '8px',
                    padding: '8px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: 'hsl(var(--accent-primary))'
                  }}>
                    <Folder size={20} />
                  </div>
                  
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteReport(report.id);
                    }}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      cursor: 'pointer',
                      color: 'hsl(var(--danger))',
                      opacity: 0.7,
                      transition: 'opacity 0.2s',
                      padding: '4px'
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.opacity = '1'}
                    onMouseLeave={(e) => e.currentTarget.style.opacity = '0.7'}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
                
                <div>
                  <h3 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 'bold', color: 'hsl(var(--text-primary))', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {report.name}
                  </h3>
                  <p style={{ margin: '4px 0 0 0', fontSize: '0.7rem', color: 'hsl(var(--text-muted))' }}>
                    Creado: {new Date(report.createdAt).toLocaleDateString()} {new Date(report.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </p>
                </div>

                <div style={{ height: '1px', background: 'hsl(var(--border-color))', opacity: 0.3 }}></div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '0.75rem', color: 'hsl(var(--text-secondary))' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>Evidencias:</span>
                    <span style={{ fontWeight: 'bold', color: 'hsl(var(--accent-primary))' }}>{report.photoIds.length} fotos</span>
                  </div>
                  {(report.dateFrom || report.dateTo) && (
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span>Fecha:</span>
                      <span style={{ fontSize: '0.65rem', color: 'hsl(var(--text-muted))' }}>{report.dateFrom || '★'} a {report.dateTo || '★'}</span>
                    </div>
                  )}
                  {report.itemFilter && (
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span>Ítem:</span>
                      <span style={{ fontFamily: 'var(--font-technical)', fontWeight: 'bold', color: 'hsl(var(--text-primary))' }}>{report.itemFilter}</span>
                    </div>
                  )}
                  {report.textFilter && (
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span>Búsqueda:</span>
                      <span style={{ fontStyle: 'italic' }}>"{report.textFilter}"</span>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
