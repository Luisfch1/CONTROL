import { useState, useMemo, useCallback } from 'react';
import { useProjects } from '../context/ProjectsContext';
import {
  FileText, Plus, Trash2, Download, Save, Search,
  Calendar, User, Hash, Info, X, CheckCircle2, ChevronRight
} from 'lucide-react';
import type { CalculationMemory } from '../types/projectTypes';

export default function MemoriasView() {
  const { getActiveProject, updateProject, closeProject } = useProjects();
  const project = getActiveProject();

  // Local state for search & form
  const [searchTerm, setSearchTerm] = useState('');
  const [code, setCode] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [author, setAuthor] = useState('');
  const [revision, setRevision] = useState('0');
  const [date, setDate] = useState(() => new Date().toISOString().split('T')[0]);
  
  // Mock file state
  const [fileName, setFileName] = useState('');
  const [fileSize, setFileSize] = useState('');

  // Feedback notifications
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [toastType, setToastType] = useState<'success' | 'error' | 'info'>('success');

  const triggerToast = (msg: string, type: 'success' | 'error' | 'info' = 'success') => {
    setToastMessage(msg);
    setToastType(type);
    setTimeout(() => setToastMessage(null), 3000);
  };

  // Get calculation memories list or empty array
  const memoriesList = useMemo(() => {
    return project?.calculationMemories || [];
  }, [project?.calculationMemories]);

  // Filter memories
  const filteredMemories = useMemo(() => {
    if (!searchTerm.trim()) return memoriesList;
    const term = searchTerm.toLowerCase();
    return memoriesList.filter(
      m =>
        m.code.toLowerCase().includes(term) ||
        m.title.toLowerCase().includes(term) ||
        m.description.toLowerCase().includes(term) ||
        m.author.toLowerCase().includes(term)
    );
  }, [memoriesList, searchTerm]);

  // Reset form
  const resetForm = () => {
    setCode('');
    setTitle('');
    setDescription('');
    setAuthor('');
    setRevision('0');
    setDate(new Date().toISOString().split('T')[0]);
    setFileName('');
    setFileSize('');
  };

  // Handle add calculation memory
  const handleAddMemory = useCallback(() => {
    if (!project) return;
    if (!code.trim() || !title.trim() || !author.trim()) {
      triggerToast('Código, Título y Autor son campos obligatorios.', 'error');
      return;
    }

    // Check for duplicate codes
    if (memoriesList.some(m => m.code.trim().toLowerCase() === code.trim().toLowerCase())) {
      triggerToast(`Ya existe una memoria de cálculo con el código ${code}.`, 'error');
      return;
    }

    const newMemory: CalculationMemory = {
      id: `mem-${Date.now()}`,
      code: code.trim().toUpperCase(),
      title: title.trim(),
      description: description.trim(),
      author: author.trim(),
      revision: revision.trim(),
      date,
      fileName: fileName || undefined,
      fileSize: fileSize || undefined,
      fileUrl: fileName ? `mock-url-for-${fileName}` : undefined
    };

    const updatedMemories = [...memoriesList, newMemory];
    updateProject(project.id, { calculationMemories: updatedMemories });
    triggerToast('✓ Memoria de cálculo guardada correctamente', 'success');
    resetForm();
  }, [project, code, title, description, author, revision, date, fileName, fileSize, memoriesList, updateProject]);

  // Handle delete memory
  const handleDeleteMemory = useCallback((memoryId: string, memoryCode: string) => {
    if (!project) return;
    if (confirm(`¿Está seguro de que desea eliminar la memoria de cálculo ${memoryCode}?`)) {
      const updatedMemories = memoriesList.filter(m => m.id !== memoryId);
      updateProject(project.id, { calculationMemories: updatedMemories });
      triggerToast(`✓ Memoria ${memoryCode} eliminada`, 'info');
    }
  }, [project, memoriesList, updateProject]);

  // Handle mock download
  const handleDownload = (m: CalculationMemory) => {
    triggerToast(`Descargando documento ${m.code}: ${m.fileName || 'memoria.pdf'}...`, 'success');
  };

  // Mock file picker simulation
  const handleMockFileSelect = () => {
    const mockFiles = [
      { name: 'Memoria_Estructural_Cimentacion.pdf', size: '4.8 MB' },
      { name: 'Diseno_Vigas_NSR10_Piso2.xlsx', size: '2.3 MB' },
      { name: 'Estudio_Geotecnico_Suelos_Final.pdf', size: '12.5 MB' },
      { name: 'Analisis_Sismico_Dinamico_Edificio.pdf', size: '8.1 MB' },
      { name: 'Plano_Despiece_Refuerzo_Zapatas.dwg', size: '15.4 MB' },
      { name: 'Especificaciones_Tecnicas_Concretos.pdf', size: '1.2 MB' }
    ];
    // Select a random mock file or cycle
    const randomIndex = Math.floor(Math.random() * mockFiles.length);
    const selected = mockFiles[randomIndex];
    setFileName(selected.name);
    setFileSize(selected.size);
    triggerToast(`Archivo cargado: ${selected.name}`, 'info');

    // Auto-fill codes and titles based on selection to make it easier
    if (!code) {
      const acronym = selected.name.split('_').map(w => w[0]).join('').substring(0, 3).toUpperCase();
      setCode(`MC-${acronym}-${Math.floor(100 + Math.random() * 900)}`);
    }
    if (!title) {
      setTitle(selected.name.replace(/_/g, ' ').replace(/\.[^/.]+$/, ""));
    }
  };

  if (!project) return null;

  // ────────────────────────────────────────────────────────
  //  STYLING / TOKENS DE DISEÑO
  // ────────────────────────────────────────────────────────
  const labelStyle: React.CSSProperties = {
    fontSize: '0.65rem',
    color: 'hsl(var(--text-muted))',
    fontWeight: 800,
    textTransform: 'uppercase',
    letterSpacing: '0.8px',
    fontFamily: 'var(--font-technical)',
  };

  const inputStyle: React.CSSProperties = {
    background: 'hsl(var(--bg-tertiary))',
    border: '1px solid var(--border-color)',
    color: 'hsl(var(--text-primary))',
    borderRadius: 'var(--radius-sm)',
    padding: '8px 12px',
    fontSize: '0.8rem',
    outline: 'none',
    transition: 'all 0.2s',
    width: '100%',
    fontFamily: 'var(--font-body)',
  };

  const formSectionHeaderStyle: React.CSSProperties = {
    fontSize: '0.75rem',
    fontWeight: 800,
    color: 'hsl(var(--primary-neon))',
    textTransform: 'uppercase',
    letterSpacing: '1.5px',
    fontFamily: 'var(--font-technical)',
    marginBottom: '16px',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    paddingBottom: '8px',
    borderBottom: '1px solid hsla(var(--primary-neon-hsl), 0.2)',
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      {/* Header de la Pantalla */}
      <div className="page-header">
        <h2 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <FileText size={24} style={{ color: 'hsl(var(--primary-neon))' }} />
          Memorias de Cálculo y Diseño Técnico
        </h2>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <span style={{
            fontSize: '0.65rem',
            background: 'hsla(var(--primary-neon-hsl), 0.15)',
            border: '1px solid hsl(var(--primary-neon))',
            color: 'hsl(var(--primary-neon))',
            padding: '2px 8px',
            borderRadius: '10px',
            fontFamily: 'var(--font-technical)',
            fontWeight: 'bold',
            letterSpacing: '1px'
          }}>
            {memoriesList.length} MEMORIAS REGISTRADAS
          </span>
          <div style={{ width: '1px', height: '24px', background: 'var(--border-color)', margin: '0 8px', opacity: 0.3 }}></div>
          <button
            className="btn btn-ghost"
            onClick={closeProject}
            title="Cerrar Proyecto"
            style={{ color: 'hsl(var(--text-muted))', padding: '8px', borderRadius: '50%' }}
            onMouseEnter={(e) => { e.currentTarget.style.color = 'hsl(var(--text-primary))'; e.currentTarget.style.background = 'hsla(var(--text-primary), 0.1)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'hsl(var(--text-muted))'; e.currentTarget.style.background = 'none'; }}
          >
            <X size={20} />
          </button>
        </div>
      </div>

      {/* Toast Notification */}
      {toastMessage && (
        <div style={{
          position: 'fixed',
          top: '20px',
          right: '20px',
          background: toastType === 'error' ? 'hsl(var(--danger))' : toastType === 'info' ? 'hsl(var(--accent-primary))' : 'hsl(var(--success))',
          color: toastType === 'error' || toastType === 'info' ? '#000' : '#fff',
          padding: '10px 20px',
          borderRadius: 'var(--radius-sm)',
          fontSize: '0.75rem',
          fontWeight: 'bold',
          zIndex: 1000,
          boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          fontFamily: 'var(--font-technical)',
          animation: 'slideDown 0.2s ease-out'
        }}>
          <CheckCircle2 size={16} />
          {toastMessage}
        </div>
      )}

      {/* Contenido Principal con Layout Dividido */}
      <div style={{ display: 'flex', flex: 1, gap: '20px', minHeight: 0, paddingBottom: '20px' }}>
        
        {/* LADO IZQUIERDO: Listado y Búsqueda */}
        <div style={{ display: 'flex', flexDirection: 'column', flex: 3, minWidth: 0 }}>
          
          {/* Barra de Filtros */}
          <div className="glass-panel" style={{ padding: '12px 16px', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '12px' }}>
            <Search size={16} style={{ color: 'hsl(var(--text-muted))' }} />
            <input
              type="text"
              placeholder="Buscar por código, título, autor o descripción..."
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              style={{
                background: 'transparent',
                border: 'none',
                color: 'hsl(var(--text-primary))',
                fontSize: '0.8rem',
                outline: 'none',
                flex: 1,
                fontFamily: 'var(--font-body)'
              }}
            />
            {searchTerm && (
              <button 
                onClick={() => setSearchTerm('')} 
                style={{ background: 'none', border: 'none', color: 'hsl(var(--text-muted))', cursor: 'pointer' }}
              >
                <X size={14} />
              </button>
            )}
          </div>

          {/* Listado de Memorias */}
          <div className="custom-scrollbar" style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '12px', paddingRight: '4px' }}>
            {filteredMemories.length === 0 ? (
              <div style={{
                flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                color: 'hsl(var(--text-muted))', border: '1px dashed var(--border-color)', borderRadius: 'var(--radius-md)', padding: '40px', textAlign: 'center'
              }}>
                <FileText size={48} style={{ opacity: 0.15, marginBottom: '12px' }} />
                <p style={{ margin: 0, fontWeight: 'bold', fontSize: '0.85rem' }}>No se encontraron memorias de cálculo</p>
                <p style={{ margin: '4px 0 0 0', fontSize: '0.7rem' }}>
                  {searchTerm ? 'Pruebe con otro término de búsqueda.' : 'Registre una nueva memoria en el formulario de la derecha.'}
                </p>
              </div>
            ) : (
              filteredMemories.map(m => (
                <div 
                  key={m.id} 
                  className="glass-panel"
                  style={{
                    padding: '16px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '10px',
                    transition: 'all 0.2s ease-in-out',
                    borderLeft: '4px solid hsl(var(--primary-neon))',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = 'hsl(var(--primary-neon))';
                    e.currentTarget.style.boxShadow = '0 0 15px hsla(var(--primary-neon-hsl), 0.1)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = 'hsl(var(--primary-neon))';
                    e.currentTarget.style.boxShadow = 'none';
                  }}
                >
                  {/* Fila Superior: Código, Revisión, Título y Acciones */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{
                          fontFamily: 'monospace',
                          fontSize: '0.75rem',
                          fontWeight: 'bold',
                          color: 'hsl(var(--primary-neon))',
                          background: 'hsla(var(--primary-neon-hsl), 0.08)',
                          padding: '2px 6px',
                          borderRadius: '4px',
                          border: '1px solid hsla(var(--primary-neon-hsl), 0.2)'
                        }}>
                          {m.code}
                        </span>
                        <span style={{
                          fontSize: '0.6rem',
                          fontWeight: 'bold',
                          background: 'hsla(var(--text-muted-hsl), 0.1)',
                          color: 'hsl(var(--text-secondary))',
                          padding: '2px 6px',
                          borderRadius: '4px',
                          textTransform: 'uppercase'
                        }}>
                          Rev {m.revision}
                        </span>
                      </div>
                      <h4 style={{ margin: '4px 0 0 0', fontSize: '0.85rem', fontWeight: 700, color: 'hsl(var(--text-primary))' }}>
                        {m.title}
                      </h4>
                    </div>
                    
                    {/* Botones de acción */}
                    <div style={{ display: 'flex', gap: '4px' }}>
                      <button
                        onClick={() => handleDownload(m)}
                        className="btn btn-ghost"
                        style={{ padding: '6px', borderRadius: '4px', color: 'hsl(var(--primary-neon))' }}
                        title={m.fileName ? `Descargar: ${m.fileName}` : "Descargar Memoria"}
                      >
                        <Download size={14} />
                      </button>
                      <button
                        onClick={() => handleDeleteMemory(m.id, m.code)}
                        className="btn btn-ghost"
                        style={{ padding: '6px', borderRadius: '4px', color: 'hsl(var(--danger))' }}
                        title="Eliminar Registro"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>

                  {/* Descripción de la memoria */}
                  {m.description && (
                    <p style={{ margin: 0, fontSize: '0.75rem', color: 'hsl(var(--text-muted))', lineHeight: '1.4' }}>
                      {m.description}
                    </p>
                  )}

                  {/* Metadatos de firma y autoría */}
                  <div style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    borderTop: '1px solid var(--border-color)',
                    paddingTop: '8px',
                    marginTop: '4px',
                    fontSize: '0.65rem',
                    color: 'hsl(var(--text-muted))',
                    gap: '10px'
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <User size={12} />
                      <span>Autor: <strong style={{ color: 'hsl(var(--text-secondary))' }}>{m.author}</strong></span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <Calendar size={12} />
                      <span>Fecha: <strong style={{ color: 'hsl(var(--text-secondary))' }}>{m.date}</strong></span>
                    </div>
                    {m.fileName && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '4px', background: 'rgba(255,255,255,0.03)', padding: '2px 6px', borderRadius: '4px' }}>
                        <Info size={10} />
                        <span style={{ fontFamily: 'monospace' }}>{m.fileName} ({m.fileSize || 'N/A'})</span>
                      </div>
                    )}
                  </div>

                </div>
              ))
            )}
          </div>
        </div>

        {/* LADO DERECHO: Registro de Nueva Memoria */}
        <div style={{ flex: 2, minWidth: '300px' }}>
          <div className="glass-panel" style={{ padding: '20px', height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            <div style={formSectionHeaderStyle}>
              <Plus size={16} /> Registrar Memoria de Cálculo
            </div>

            <div className="custom-scrollbar" style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '12px', paddingRight: '4px' }}>
              
              {/* Código */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={labelStyle}>Código del Documento *</label>
                <div style={{ display: 'flex', gap: '6px' }}>
                  <input
                    type="text"
                    placeholder="Ej: MC-EST-001"
                    value={code}
                    onChange={e => setCode(e.target.value)}
                    style={inputStyle}
                  />
                  <button
                    onClick={() => {
                      const rand = Math.floor(100 + Math.random() * 900);
                      setCode(`MC-EST-${rand}`);
                    }}
                    className="btn btn-secondary"
                    style={{ padding: '0 8px', fontSize: '0.65rem', height: '32px', whiteSpace: 'nowrap' }}
                    title="Generar código automático"
                  >
                    Auto-Gen
                  </button>
                </div>
              </div>

              {/* Título */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={labelStyle}>Título de la Memoria *</label>
                <input
                  type="text"
                  placeholder="Ej: Memoria de Diseño de Cimentación"
                  value={title}
                  onChange={e => setTitle(e.target.value)}
                  style={inputStyle}
                />
              </div>

              {/* Autor */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={labelStyle}>Autor / Ingeniero Diseñador *</label>
                <input
                  type="text"
                  placeholder="Ej: Ing. Luis Cuellar"
                  value={author}
                  onChange={e => setAuthor(e.target.value)}
                  style={inputStyle}
                />
              </div>

              {/* Fila: Revisión y Fecha */}
              <div style={{ display: 'flex', gap: '10px' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', flex: 1 }}>
                  <label style={labelStyle}>Revisión</label>
                  <select
                    value={revision}
                    onChange={e => setRevision(e.target.value)}
                    style={{ ...inputStyle, cursor: 'pointer' }}
                  >
                    <option value="0">Rev 0 (Preliminar)</option>
                    <option value="A">Rev A (Para Aprobación)</option>
                    <option value="B">Rev B (Para Construcción)</option>
                    <option value="1">Rev 1 (Final)</option>
                    <option value="2">Rev 2 (As-Built)</option>
                  </select>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', flex: 1 }}>
                  <label style={labelStyle}>Fecha</label>
                  <input
                    type="date"
                    value={date}
                    onChange={e => setDate(e.target.value)}
                    style={inputStyle}
                  />
                </div>
              </div>

              {/* Descripción */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={labelStyle}>Descripción / Alcance técnico</label>
                <textarea
                  placeholder="Detalles sobre las cargas, combinaciones de diseño, software utilizado..."
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  style={{ ...inputStyle, minHeight: '60px', resize: 'vertical' }}
                />
              </div>

              {/* Adjunto de archivo */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginTop: '4px' }}>
                <label style={labelStyle}>Documento Técnico Adjunto</label>
                {fileName ? (
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '8px 12px',
                    background: 'hsla(var(--primary-neon-hsl), 0.05)',
                    border: '1px solid hsla(var(--primary-neon-hsl), 0.2)',
                    borderRadius: 'var(--radius-sm)',
                    fontSize: '0.75rem',
                  }}>
                    <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, paddingRight: '10px' }}>
                      <span style={{ color: 'hsl(var(--text-primary))', fontWeight: 'bold', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {fileName}
                      </span>
                      <span style={{ color: 'hsl(var(--text-muted))', fontSize: '0.65rem' }}>{fileSize}</span>
                    </div>
                    <button
                      onClick={() => {
                        setFileName('');
                        setFileSize('');
                      }}
                      style={{ background: 'none', border: 'none', color: 'hsl(var(--danger))', cursor: 'pointer', display: 'flex' }}
                    >
                      <X size={14} />
                    </button>
                  </div>
                ) : (
                  <div
                    onClick={handleMockFileSelect}
                    style={{
                      border: '1px dashed var(--border-color)',
                      borderRadius: 'var(--radius-sm)',
                      padding: '16px',
                      textAlign: 'center',
                      cursor: 'pointer',
                      transition: 'all 0.2s',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '6px',
                      background: 'rgba(255,255,255,0.01)'
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.borderColor = 'hsl(var(--primary-neon))';
                      e.currentTarget.style.background = 'rgba(252,253,0,0.02)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.borderColor = 'var(--border-color)';
                      e.currentTarget.style.background = 'rgba(255,255,255,0.01)';
                    }}
                  >
                    <Download size={20} style={{ color: 'hsl(var(--text-muted))' }} />
                    <span style={{ fontSize: '0.75rem', color: 'hsl(var(--text-secondary))', fontWeight: 'bold' }}>Simular Carga de Documento</span>
                    <span style={{ fontSize: '0.6rem', color: 'hsl(var(--text-muted))' }}>PDF, XLSX, DWG, DOCX (Máx. 50MB)</span>
                  </div>
                )}
              </div>

            </div>

            {/* Botón Guardar */}
            <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '16px', marginTop: '16px' }}>
              <button
                onClick={handleAddMemory}
                className="btn btn-primary"
                style={{
                  width: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                  height: '40px',
                  fontSize: '0.8rem',
                  fontWeight: 'bold',
                  letterSpacing: '1px'
                }}
              >
                <Save size={16} /> REGISTRAR MEMORIA
              </button>
            </div>

          </div>
        </div>

      </div>
    </div>
  );
}
