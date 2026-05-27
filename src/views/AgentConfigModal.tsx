import React, { useState, useEffect } from 'react';
import { Bot, X, Key, Cpu, Layers, Eye, Save } from 'lucide-react';
import type { Project } from '../types/projectTypes';
import { buildProjectSystemInstruction } from '../services/aiContextBuilder';

interface AgentConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
  project: Project | null;
  updateProject: (id: string, updates: Partial<Project>) => void;
  globalGeminiKey: string;
  setGlobalGeminiKey: (key: string) => void;
}

export default function AgentConfigModal({
  isOpen,
  onClose,
  project,
  updateProject,
  globalGeminiKey,
  setGlobalGeminiKey
}: AgentConfigModalProps) {
  const [activeTab, setActiveTab] = useState<'settings' | 'skills' | 'memory'>('settings');
  const [apiKey, setApiKey] = useState(globalGeminiKey);
  const [customInstructions, setCustomInstructions] = useState(project?.agentCustomInstructions || '');
  const [isPreviewExpanded, setIsPreviewExpanded] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Sync state with props when open/project changes
  useEffect(() => {
    if (isOpen) {
      setApiKey(globalGeminiKey);
      setCustomInstructions(project?.agentCustomInstructions || '');
      setSaveSuccess(false);
    }
  }, [isOpen, globalGeminiKey, project?.agentCustomInstructions]);

  if (!isOpen) return null;

  const handleSave = () => {
    if (!project) return;
    
    // Save Gemini Key
    setGlobalGeminiKey(apiKey);
    localStorage.setItem('gemini-api-key', apiKey);

    // Save Custom Instructions to Project
    updateProject(project.id, {
      geminiApiKey: apiKey,
      agentCustomInstructions: customInstructions
    });

    // Auto-save physical project in electron if function exists
    if ((window as any).electronAPI && typeof (window as any).electronAPI.saveProject === 'function') {
      const updatedProj = {
        ...project,
        geminiApiKey: apiKey,
        agentCustomInstructions: customInstructions
      };
      (window as any).electronAPI.saveProject(updatedProj)
        .then(() => console.log("[Agent Config] Saved project with new settings"))
        .catch((err: any) => console.error("Error saving project settings:", err));
    }

    setSaveSuccess(true);
    setTimeout(() => setSaveSuccess(false), 3000);
  };

  // Generate live prompt preview
  const liveSystemPrompt = project ? buildProjectSystemInstruction(project) : '';

  // Memory stats
  const budgetCount = project?.budgetItems?.filter(i => i.type === 'item')?.length || 0;
  const reportsCount = project?.progressReports?.length || 0;
  const partialsCount = project?.partialReports?.length || 0;
  const photosCount = project?.logiEntries?.length || 0;
  const todosCount = project?.agentTodos?.filter(t => !t.completed)?.length || 0;
  const correspondenceCount = project?.correspondenceFiles?.length || 0;
  const apusCount = project?.activityAPUs?.length || 0;
  const resourcesCount = project?.costResources?.length || 0;
  const transactionsCount = project?.costTransactions?.length || 0;

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      background: 'hsla(var(--bg-secondary), 0.95)',
      backgroundImage: 'var(--bg-image)',
      backgroundSize: 'cover',
      backgroundPosition: 'center',
      backdropFilter: 'var(--glass-blur)',
      WebkitBackdropFilter: 'var(--glass-blur)',
      display: 'flex',
      flexDirection: 'column',
      zIndex: 9999,
      animation: 'fadeIn 0.2s ease-out'
    }}>
      {/* Header */}
      <div style={{
        padding: '16px 24px',
        borderBottom: '1px solid var(--border-color)',
        background: 'hsla(var(--bg-tertiary), 0.4)'
      }}>
        <div style={{
          maxWidth: '1200px',
          margin: '0 auto',
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{
              background: 'hsla(var(--primary-neon-hsl), 0.12)',
              border: '1px solid hsl(var(--primary-neon))',
              borderRadius: '50%',
              width: '36px',
              height: '36px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 0 10px hsla(var(--primary-neon-hsl), 0.25)'
            }}>
              <Bot size={20} style={{ color: 'hsl(var(--primary-neon))' }} />
            </div>
            <div>
              <h3 style={{ margin: 0, fontSize: '1rem', color: 'hsl(var(--text-primary))', fontFamily: 'var(--font-technical)', fontWeight: 'bold', letterSpacing: '0.5px' }}>
                CONFIGURACIÓN Y MEMORIA DEL AGENTE IA
              </h3>
              <p style={{ margin: 0, fontSize: '0.65rem', color: 'hsl(var(--text-muted))', textTransform: 'uppercase', letterSpacing: '1px', marginTop: '2px' }}>
                {project ? `${project.name.toUpperCase()} (CÓDIGO: ${project.code})` : 'SIN PROYECTO ACTIVO'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              color: 'hsl(var(--text-secondary))',
              cursor: 'pointer',
              padding: '6px',
              borderRadius: '50%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'all 0.2s'
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; e.currentTarget.style.color = 'hsl(var(--text-primary))'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'hsl(var(--text-secondary))'; }}
          >
            <X size={20} />
          </button>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div style={{
        borderBottom: '1px solid var(--border-color)',
        background: 'hsla(var(--bg-tertiary), 0.2)',
        padding: '0 24px'
      }}>
        <div style={{
          maxWidth: '1200px',
          margin: '0 auto',
          width: '100%',
          display: 'flex'
        }}>
          <button
            onClick={() => setActiveTab('settings')}
            style={{
              padding: '12px 16px',
              background: 'none',
              border: 'none',
              color: activeTab === 'settings' ? 'hsl(var(--primary-neon))' : 'hsl(var(--text-secondary))',
              borderBottom: activeTab === 'settings' ? '2px solid hsl(var(--primary-neon))' : '2px solid transparent',
              cursor: 'pointer',
              fontSize: '0.75rem',
              fontWeight: 'bold',
              fontFamily: 'var(--font-technical)',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              transition: 'all 0.2s'
            }}
          >
            <Key size={14} />
            <span>CONFIGURACIÓN</span>
          </button>
          <button
            onClick={() => setActiveTab('skills')}
            style={{
              padding: '12px 16px',
              background: 'none',
              border: 'none',
              color: activeTab === 'skills' ? 'hsl(var(--primary-neon))' : 'hsl(var(--text-secondary))',
              borderBottom: activeTab === 'skills' ? '2px solid hsl(var(--primary-neon))' : '2px solid transparent',
              cursor: 'pointer',
              fontSize: '0.75rem',
              fontWeight: 'bold',
              fontFamily: 'var(--font-technical)',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              transition: 'all 0.2s'
            }}
          >
            <Cpu size={14} />
            <span>HABILIDADES</span>
          </button>
          <button
            onClick={() => setActiveTab('memory')}
            style={{
              padding: '12px 16px',
              background: 'none',
              border: 'none',
              color: activeTab === 'memory' ? 'hsl(var(--primary-neon))' : 'hsl(var(--text-secondary))',
              borderBottom: activeTab === 'memory' ? '2px solid hsl(var(--primary-neon))' : '2px solid transparent',
              cursor: 'pointer',
              fontSize: '0.75rem',
              fontWeight: 'bold',
              fontFamily: 'var(--font-technical)',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              transition: 'all 0.2s'
            }}
          >
            <Layers size={14} />
            <span>MEMORIA DE CONTEXTO</span>
          </button>
        </div>
      </div>

      {/* Content Body */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '32px 24px', minHeight: 0 }}>
        <div style={{
          maxWidth: '1200px',
          margin: '0 auto',
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column'
        }}>
          {/* TAB 1: SETTINGS */}
          {activeTab === 'settings' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', maxWidth: '800px', width: '100%' }}>
              <div>
                <h4 style={{ color: 'hsl(var(--text-primary))', fontSize: '0.85rem', fontFamily: 'var(--font-technical)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '8px' }}>
                  Llave de Acceso (Gemini API Key)
                </h4>
                <p style={{ fontSize: '0.75rem', color: 'hsl(var(--text-muted))', marginBottom: '12px', lineHeight: '1.4' }}>
                  El agente requiere de una clave API de Google AI Studio para operar de forma inteligente con el modelo Gemini. Esta clave se guarda localmente encriptada por proyecto.
                </p>
                <input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="Ingresa tu API Key de Gemini..."
                  style={{
                    width: '100%',
                    background: 'hsl(var(--bg-primary))',
                    border: '1px solid var(--border-color)',
                    color: 'hsl(var(--text-primary))',
                    padding: '12px 16px',
                    borderRadius: 'var(--radius-sm)',
                    fontSize: '0.8rem',
                    outline: 'none',
                    transition: 'border-color 0.2s'
                  }}
                  onFocus={(e) => e.target.style.borderColor = 'hsl(var(--primary-neon))'}
                  onBlur={(e) => e.target.style.borderColor = 'var(--border-color)'}
                />
              </div>

              <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '24px' }}>
                <h4 style={{ color: 'hsl(var(--text-primary))', fontSize: '0.85rem', fontFamily: 'var(--font-technical)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '8px' }}>
                  Instrucciones de Comportamiento del Agente
                </h4>
                <p style={{ fontSize: '0.75rem', color: 'hsl(var(--text-muted))', marginBottom: '12px', lineHeight: '1.4' }}>
                  Personaliza cómo actúa el agente IA. Agrega lineamientos específicos, prioridades del proyecto o formas en las que prefieres que te responda (ej. "Llámame Ing. Luis", "Prioriza alertas sobre vaciados", etc.).
                </p>
                <textarea
                  value={customInstructions}
                  onChange={(e) => setCustomInstructions(e.target.value)}
                  placeholder="Ej: Trátame como Ingeniero Luis. Prioriza las alertas de retraso sobre las de correspondencia. Sé extra crítico con los ítems de concreto..."
                  rows={12}
                  style={{
                    width: '100%',
                    background: 'hsl(var(--bg-primary))',
                    border: '1px solid var(--border-color)',
                    color: 'hsl(var(--text-primary))',
                    padding: '14px',
                    borderRadius: 'var(--radius-sm)',
                    fontSize: '0.8rem',
                    fontFamily: 'inherit',
                    resize: 'vertical',
                    outline: 'none',
                    transition: 'border-color 0.2s',
                    lineHeight: '1.4'
                  }}
                  onFocus={(e) => e.target.style.borderColor = 'hsl(var(--primary-neon))'}
                  onBlur={(e) => e.target.style.borderColor = 'var(--border-color)'}
                />
              </div>
            </div>
          )}

          {/* TAB 2: SKILLS */}
          {activeTab === 'skills' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              <p style={{ fontSize: '0.75rem', color: 'hsl(var(--text-muted))', lineHeight: '1.4', marginBottom: '8px', maxWidth: '800px' }}>
                El agente IA tiene habilitadas las siguientes habilidades/herramientas técnicas nativas de CONTROL. El modelo las invoca automáticamente cuando detecta la intención en tus mensajes.
              </p>

              <div style={{ 
                display: 'grid', 
                gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', 
                gap: '16px' 
              }}>
                <SkillCard 
                  name="export_report_data" 
                  title="Exportación Tabular de Reportes" 
                  desc="Genera y exporta reportes de interventoría física y financiera de actividades a archivos físicos Word (.doc) y Excel (.xlsx)."
                />
                <SkillCard 
                  name="generate_photo_report" 
                  title="Generación de Informes Fotográficos" 
                  desc="Filtra y exporta las fotos de avance de campo a documentos Word (.doc) o archivos comprimidos (.zip) listos para reportar."
                />
                <SkillCard 
                  name="generate_progress_report" 
                  title="Registro e Informe de Avances" 
                  desc="Calcula acumulados y genera de forma automática reportes oficiales de progreso de obra con base en avances técnicos descritos por el usuario."
                />
                <SkillCard 
                  name="add_todo" 
                  title="Gestión de Pendientes (Creación)" 
                  desc="Detecta compromisos y pendientes nuevos para redactarlos y agregarlos al archivo físico PENDIENTES.md."
                />
                <SkillCard 
                  name="delete_todo" 
                  title="Gestión de Pendientes (Cierre)" 
                  desc="Marca tareas como completadas o las elimina de PENDIENTES.md tras verificar tu confirmación conversacional."
                />
              </div>
            </div>
          )}

          {/* TAB 3: MEMORY */}
          {activeTab === 'memory' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', flex: 1, minHeight: 0 }}>
              <div>
                <h4 style={{ color: 'hsl(var(--text-primary))', fontSize: '0.85rem', fontFamily: 'var(--font-technical)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '12px' }}>
                  Resumen de Datos Inyectados (Caja Negra)
                </h4>
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
                  gap: '12px',
                  marginBottom: '10px'
                }}>
                  <StatPill label="Presupuesto" count={`${budgetCount} ítems`} />
                  <StatPill label="Avances de Obra" count={`${reportsCount} reportes`} />
                  <StatPill label="Actas Parciales" count={`${partialsCount} actas`} />
                  <StatPill label="Registro de Fotos" count={`${photosCount} imágenes`} />
                  <StatPill label="Agenda Pendientes" count={`${todosCount} activos`} />
                  <StatPill label="Oficios/Cartas" count={`${correspondenceCount} cargados`} />
                  <StatPill label="APUs Actividades" count={`${apusCount} cargados`} />
                  <StatPill label="Insumos (DB)" count={`${resourcesCount} recursos`} />
                  <StatPill label="Costos Reales" count={`${transactionsCount} transac.`} />
                </div>
              </div>

              <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '20px', flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                <div 
                  onClick={() => setIsPreviewExpanded(!isPreviewExpanded)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    cursor: 'pointer',
                    padding: '12px 16px',
                    borderRadius: 'var(--radius-sm)',
                    background: 'hsla(var(--bg-tertiary), 0.3)',
                    border: '1px solid var(--border-color)',
                    transition: 'all 0.2s',
                    marginBottom: '12px'
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.borderColor = 'hsl(var(--primary-neon))'}
                  onMouseLeave={(e) => e.currentTarget.style.borderColor = 'var(--border-color)'}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Eye size={16} style={{ color: 'hsl(var(--primary-neon))' }} />
                    <span style={{ fontSize: '0.75rem', fontWeight: 'bold', color: 'hsl(var(--text-primary))' }}>
                      Previsualizar Prompt de Sistema Completo
                    </span>
                  </div>
                  <span style={{ fontSize: '0.75rem', color: 'hsl(var(--text-muted))' }}>
                    {isPreviewExpanded ? 'Ocultar ▲' : 'Ver ▼'}
                  </span>
                </div>

                {isPreviewExpanded && (
                  <pre style={{
                    flex: 1,
                    padding: '16px',
                    background: 'hsl(var(--bg-primary))',
                    border: '1px solid var(--border-color)',
                    borderRadius: 'var(--radius-sm)',
                    color: 'hsl(var(--text-secondary))',
                    fontSize: '0.75rem',
                    fontFamily: 'monospace',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-all',
                    overflowY: 'auto',
                    lineHeight: '1.4',
                    minHeight: '200px'
                  }}>
                    {liveSystemPrompt || 'No hay información cargada.'}
                  </pre>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Footer Actions */}
      <div style={{
        padding: '16px 24px',
        borderTop: '1px solid var(--border-color)',
        background: 'hsla(var(--bg-tertiary), 0.4)'
      }}>
        <div style={{
          maxWidth: '1200px',
          margin: '0 auto',
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'flex-end',
          gap: '12px'
        }}>
          {saveSuccess && (
            <span style={{
              fontSize: '0.75rem',
              color: 'hsl(var(--primary-neon))',
              fontWeight: 'bold',
              animation: 'fadeIn 0.2s'
            }}>
              ✓ ¡Cambios guardados con éxito!
            </span>
          )}
          <button
            onClick={onClose}
            className="btn btn-secondary"
            style={{ padding: '8px 20px', fontSize: '0.75rem', height: 'auto' }}
          >
            Cancelar
          </button>
          
          {activeTab === 'settings' && (
            <button
              onClick={handleSave}
              className="btn btn-primary btn-pulse"
              style={{
                padding: '8px 20px',
                fontSize: '0.75rem',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                height: 'auto'
              }}
            >
              <Save size={14} />
              <span>Guardar</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function SkillCard({ name, title, desc }: { name: string; title: string; desc: string }) {
  return (
    <div style={{
      background: 'hsla(var(--bg-tertiary), 0.3)',
      border: '1px solid var(--border-color)',
      borderRadius: 'var(--radius-sm)',
      padding: '12px 16px',
      display: 'flex',
      flexDirection: 'column',
      gap: '4px'
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: '0.8rem', fontWeight: 'bold', color: 'hsl(var(--text-primary))', fontFamily: 'var(--font-technical)' }}>
          {title}
        </span>
        <span style={{
          fontSize: '0.55rem',
          color: 'hsl(var(--primary-neon))',
          background: 'hsla(var(--primary-neon-hsl), 0.1)',
          border: '1px solid hsl(var(--primary-neon))',
          padding: '2px 6px',
          borderRadius: '4px',
          fontWeight: 'bold',
          letterSpacing: '0.5px'
        }}>
          ACTIVA
        </span>
      </div>
      <code style={{ fontSize: '0.65rem', color: 'hsl(var(--primary-neon))', margin: '2px 0' }}>
        {name}()
      </code>
      <p style={{ fontSize: '0.7rem', color: 'hsl(var(--text-secondary))', lineHeight: '1.4', margin: 0 }}>
        {desc}
      </p>
    </div>
  );
}

function StatPill({ label, count }: { label: string; count: string }) {
  return (
    <div style={{
      background: 'hsla(var(--bg-tertiary), 0.3)',
      border: '1px solid var(--border-color)',
      borderRadius: 'var(--radius-sm)',
      padding: '10px 14px',
      display: 'flex',
      flexDirection: 'column',
      gap: '2px'
    }}>
      <span style={{ fontSize: '0.6rem', color: 'hsl(var(--text-muted))', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
        {label}
      </span>
      <span style={{ fontSize: '0.8rem', color: 'hsl(var(--primary-neon))', fontWeight: 'bold', fontFamily: 'var(--font-technical)' }}>
        {count}
      </span>
    </div>
  );
}
