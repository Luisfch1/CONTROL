import { X } from 'lucide-react';
import { useProjects } from '../context/ProjectsContext';

export default function ReportsView() {
  const { closeProject } = useProjects();
  
  return (
    <div>
      <div className="page-header">
        <h2 className="page-title">Memorias de Cantidades Automáticas</h2>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button className="btn btn-primary">Generar Memoria</button>
          
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
      <div className="card" style={{ marginBottom: 'var(--spacing-md)' }}>
        <h3 style={{ marginBottom: 'var(--spacing-sm)' }}>Configuración de Generación</h3>
        <div style={{ display: 'flex', gap: 'var(--spacing-md)' }}>
          <div className="input-group" style={{ flex: 1 }}>
            <label className="input-label">Periodo de Avance</label>
            <select className="input-field">
              <option>Corte Actual</option>
            </select>
          </div>
          <div className="input-group" style={{ flex: 1 }}>
            <label className="input-label">Incluir Registro Fotográfico</label>
            <select className="input-field">
              <option>Sí, mapear por ítem automáticamente</option>
              <option>No, solo cantidades</option>
            </select>
          </div>
        </div>
      </div>
      <div className="card">
        <p style={{ color: 'hsl(var(--text-muted))', textAlign: 'center', padding: 'var(--spacing-xl)' }}>
          Seleccione los parámetros para construir el documento integrando Presupuesto, Avance y Fotos.
        </p>
      </div>
    </div>
  );
}
