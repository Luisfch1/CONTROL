import { useState, useEffect } from 'react';
import { CheckCircle2, Building2, MapPin, CalendarDays, X, Copy } from 'lucide-react';
import { useProjects } from '../context/ProjectsContext';
import './Dashboard.css';

interface Props {
  onSaved?: () => void;
  onCancel?: () => void;
}

export default function EditProjectView({ onSaved, onCancel }: Props) {
  const { getActiveProject, updateProject } = useProjects();
  const project = getActiveProject();

  // Form states
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [location, setLocation] = useState('');
  const [startDate, setStartDate] = useState('');
  const [durationMonths, setDurationMonths] = useState('');
  
  const [admin, setAdmin] = useState('10');
  const [imprevistos, setImprevistos] = useState('5');
  const [utilidad, setUtilidad] = useState('5');

  const [cloudUrl, setCloudUrl] = useState('');
  const [cloudApiKey, setCloudApiKey] = useState('');
  const [geminiApiKey, setGeminiApiKey] = useState('');

  useEffect(() => {
    if (project) {
      setName(project.name);
      setCode(project.code);
      setLocation(project.location);
      setStartDate(project.startDate || '');
      setDurationMonths(String(project.durationMonths || ''));
      setAdmin(String(project.aiu.administracion || '10'));
      setImprevistos(String(project.aiu.imprevistos || '5'));
      setUtilidad(String(project.aiu.utilidad || '5'));
      setCloudUrl(project.cloudConfig?.url || '');
      setCloudApiKey(project.cloudConfig?.apiKey || '');
      setGeminiApiKey(project.geminiApiKey || '');
    }
  }, [project]);

  const handleSave = () => {
    if (!project) return;
    if (!name) {
      alert("Por favor ingresa el nombre del proyecto.");
      return;
    }

    const updatedProject = {
      ...project,
      name,
      code,
      location,
      startDate,
      durationMonths: Number(durationMonths) || 0,
      aiu: {
        administracion: Number(admin) || 0,
        imprevistos: Number(imprevistos) || 0,
        utilidad: Number(utilidad) || 0
      },
      cloudConfig: {
        ...project.cloudConfig,
        provider: 'supabase' as 'supabase' | 'firebase',
        url: cloudUrl,
        apiKey: cloudApiKey,
        projectId: project.id
      },
      geminiApiKey
    };

    updateProject(project.id, updatedProject);
    alert("¡Proyecto actualizado con éxito!");

    if (onSaved) {
      onSaved();
    }
  };

  if (!project) return null;

  return (
    <div className="dashboard-container">
      <header className="page-header">
        <h2 className="page-title" style={{ color: 'hsl(var(--text-primary))' }}>CONFIGURACIÓN DEL PROYECTO</h2>
        <div className="badge badge-accent">EDICIÓN</div>
      </header>

      <div className="dash-grid" style={{ gridTemplateColumns: '1fr', gridTemplateRows: 'auto', maxWidth: '800px', margin: '0 auto', maxHeight: '85vh', overflowY: 'auto', paddingRight: '10px' }}>
        
        <section className="dash-panel">
          <div className="dash-panel-header" style={{ borderBottomColor: 'hsl(var(--accent-technical))' }}>
            <h3 style={{ color: 'hsl(var(--accent-technical))' }}>IDENTIFICACIÓN Y SINCRONIZACIÓN</h3>
          </div>
          <div className="dash-panel-content" style={{ padding: 'var(--spacing-lg)', overflowY: 'auto' }}>
            
            <div className="input-group" style={{ marginBottom: 'var(--spacing-md)' }}>
              <label className="input-label">ID ÚNICO DEL PROYECTO (LOGI)</label>
              <div style={{ display: 'flex', gap: '8px' }}>
                <input type="text" className="input-field" value={project.id} readOnly style={{ background: 'hsl(var(--bg-tertiary))', color: 'hsl(var(--text-muted))', width: '100%' }} />
                <button type="button" className="btn btn-secondary" onClick={() => navigator.clipboard.writeText(project.id)}><Copy size={16} /></button>
              </div>
            </div>

            <div className="input-group">
              <label className="input-label">NOMBRE DEL PROYECTO</label>
              <div style={{ position: 'relative' }}>
                <Building2 size={16} color="hsl(var(--text-muted))" style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)' }} />
                <input type="text" className="input-field" style={{ width: '100%', paddingLeft: '36px' }} value={name} onChange={(e) => setName(e.target.value)} />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--spacing-md)' }}>
              <div className="input-group">
                <label className="input-label">CÓDIGO DE CONTRATO / ID</label>
                <input type="text" className="input-field" style={{ width: '100%' }} value={code} onChange={(e) => setCode(e.target.value)} />
              </div>
              <div className="input-group">
                <label className="input-label">UBICACIÓN</label>
                <div style={{ position: 'relative' }}>
                  <MapPin size={16} color="hsl(var(--text-muted))" style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)' }} />
                  <input type="text" className="input-field" style={{ width: '100%', paddingLeft: '36px' }} value={location} onChange={(e) => setLocation(e.target.value)} />
                </div>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--spacing-md)', marginTop: 'var(--spacing-sm)' }}>
              <div className="input-group">
                <label className="input-label" style={{ color: 'hsl(var(--accent-technical))', fontWeight: 'bold' }}>FECHA DE INICIO (ACTA DE INICIO)</label>
                <div style={{ position: 'relative' }}>
                  <CalendarDays size={16} color="hsl(var(--accent-technical))" style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)' }} />
                  <input type="date" className="input-field" style={{ width: '100%', paddingLeft: '36px', borderColor: 'hsl(var(--accent-technical) / 0.5)' }} value={startDate} onChange={(e) => setStartDate(e.target.value)} />
                </div>
              </div>
              <div className="input-group">
                <label className="input-label">PLAZO ESTIMADO (MESES)</label>
                <input type="number" className="input-field" style={{ width: '100%' }} value={durationMonths} onChange={(e) => setDurationMonths(e.target.value)} />
              </div>
            </div>

            <div style={{ height: '1px', background: 'hsl(var(--border-color))', margin: 'var(--spacing-lg) 0' }}></div>

            <h3 style={{ color: 'hsl(var(--accent-primary))', fontSize: '0.8rem', textTransform: 'uppercase', marginBottom: 'var(--spacing-md)', letterSpacing: '1px' }}>Sincronización Logi (Configuración Nube)</h3>
            <div className="input-group">
              <label className="input-label">URL DEL PROYECTO (SUPABASE/FIREBASE)</label>
              <input 
                type="text" 
                className="input-field" 
                style={{ width: '100%' }} 
                value={cloudUrl} 
                onChange={(e) => setCloudUrl(e.target.value)} 
                placeholder="https://your-project.supabase.co"
              />
            </div>
            <div className="input-group" style={{ marginTop: 'var(--spacing-sm)' }}>
              <label className="input-label">API KEY (PUBLIC ANON)</label>
              <input 
                type="password" 
                className="input-field" 
                style={{ width: '100%' }} 
                value={cloudApiKey} 
                onChange={(e) => setCloudApiKey(e.target.value)} 
                placeholder="Su clave API secreta"
              />
            </div>

            <div style={{ height: '1px', background: 'hsl(var(--border-color))', margin: 'var(--spacing-lg) 0' }}></div>

            <h3 style={{ color: 'hsl(var(--accent-primary))', fontSize: '0.8rem', textTransform: 'uppercase', marginBottom: 'var(--spacing-md)', letterSpacing: '1px' }}>Agente IA (Gemini)</h3>
            <div className="input-group">
              <label className="input-label">GEMINI API KEY (GOOGLE AI STUDIO)</label>
              <input 
                type="password" 
                className="input-field" 
                style={{ width: '100%' }} 
                value={geminiApiKey} 
                onChange={(e) => setGeminiApiKey(e.target.value)} 
                placeholder="Clave API de Gemini..."
              />
            </div>

            <div style={{ height: '1px', background: 'hsl(var(--border-color))', margin: 'var(--spacing-lg) 0' }}></div>

            <label className="input-label">ESTRUCTURA DE COSTOS (AIU %)</label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 'var(--spacing-md)' }}>
              <div className="input-group">
                <label className="input-label" style={{ fontSize: '0.65rem' }}>ADMINISTRACIÓN (%)</label>
                <input type="number" className="input-field" style={{ width: '100%' }} value={admin} onChange={(e) => setAdmin(e.target.value)} />
              </div>
              <div className="input-group">
                <label className="input-label" style={{ fontSize: '0.65rem' }}>IMPREVISTOS (%)</label>
                <input type="number" className="input-field" style={{ width: '100%' }} value={imprevistos} onChange={(e) => setImprevistos(e.target.value)} />
              </div>
              <div className="input-group">
                <label className="input-label" style={{ fontSize: '0.65rem' }}>UTILIDAD (%)</label>
                <input type="number" className="input-field" style={{ width: '100%' }} value={utilidad} onChange={(e) => setUtilidad(e.target.value)} />
              </div>
            </div>

          </div>
        </section>

        {/* ACCIONES */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--spacing-md)', marginTop: 'var(--spacing-md)' }}>
          <button className="btn btn-secondary" onClick={onCancel}>
            <X size={16} />
            CANCELAR
          </button>
          <button className="btn btn-primary" onClick={handleSave} style={{ background: 'hsl(var(--accent-technical))', borderColor: 'hsl(var(--accent-technical))', color: '#000' }}>
            <CheckCircle2 size={16} />
            GUARDAR CAMBIOS
          </button>
        </div>

      </div>
    </div>
  );
}
