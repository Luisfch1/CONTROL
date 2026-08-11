import { useState, useEffect, useRef } from 'react';
import {
  LayoutDashboard, Calculator, CalendarClock, TrendingUp,
  Camera, FileText, Sun, Moon, Download, Upload,
  Folder, X, Settings, Image, Palette, Undo2, Redo2, Bot, Check,
  Receipt, HardHat, Glasses, Terminal, ChevronDown, ChevronRight, DollarSign
} from 'lucide-react';
import { useProjects } from './context/ProjectsContext';
import { useAgent } from './context/AgentContext';
import { apiAuditLogs, type ApiAuditLog } from './services/aiService';
import './index.css';

// Importing views dynamically or statically. 
// Since they are independent components, they won't share HTML.
import DashboardView from './views/DashboardView';
import BudgetView from './views/BudgetView';
import ScheduleView from './views/ScheduleView';
import ProgressView from './views/ProgressView';
import PhotosView from './views/PhotosView';
import MonthlyReportsView from './views/MonthlyReportsView';
import MemoriasView from './views/MemoriasView';
import ReportView from './views/ReportView';
import ParcialesView from './views/ParcialesView';
import CreateProjectView from './views/CreateProjectView';
import EditProjectView from './views/EditProjectView';
import AgentPanel from './views/AgentPanel';
import PhotoReportsView from './views/PhotoReportsView';
import CorrespondenceView from './views/CorrespondenceView';
import CostsView from './views/CostsView';
import AgentConfigModal from './views/AgentConfigModal';
import logo from './assets/logo.png';

type ViewState = 'dashboard' | 'budget' | 'schedule' | 'progress' | 'photos' | 'reports' | 'parciales' | 'analytics' | 'create-project' | 'edit-project' | 'photo-reports' | 'correspondence' | 'costs' | 'monthly-reports';

// Utilidad para convertir HEX a HSL (H S% L%)
const hexToHSL = (hex: string): string => {
  let r = 0, g = 0, b = 0;
  if (hex.length === 4) {
    r = parseInt("0x" + hex[1] + hex[1]);
    g = parseInt("0x" + hex[2] + hex[2]);
    b = parseInt("0x" + hex[3] + hex[3]);
  } else if (hex.length === 7) {
    r = parseInt("0x" + hex[1] + hex[2]);
    g = parseInt("0x" + hex[3] + hex[4]);
    b = parseInt("0x" + hex[5] + hex[6]);
  }
  r /= 255;
  g /= 255;
  b /= 255;
  const cmin = Math.min(r, g, b), cmax = Math.max(r, g, b), delta = cmax - cmin;
  let h = 0, s = 0, l = 0;

  if (delta === 0) h = 0;
  else if (cmax === r) h = ((g - b) / delta) % 6;
  else if (cmax === g) h = (b - r) / delta + 2;
  else h = (r - g) / delta + 4;

  h = Math.round(h * 60);
  if (h < 0) h += 360;

  l = (cmax + cmin) / 2;
  s = delta === 0 ? 0 : delta / (1 - Math.abs(2 * l - 1));

  s = +(s * 100).toFixed(1);
  l = +(l * 100).toFixed(1);

  return `${h} ${s}% ${l}%`;
};

// Utilidad simple para extraer HEX desde variables (aproximado) si se necesita
function App() {
  const [sidebarTab, setSidebarTab] = useState<'technical' | 'administrative'>('technical');
  const [isDarkMode, setIsDarkMode] = useState(() => {
    const saved = localStorage.getItem('lch-control-theme');
    return saved === null ? true : saved === 'dark';
  });
  const [isFileMenuOpen, setIsFileMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const { toggleAgent, hasUnreadResponse, isLoading: isAgentLoading, activeAlerts, triggerAlertQuery } = useAgent();
  const {
    activeProjectId,
    projects,
    exportActiveProject,
    importProject,
    handleFileLaunch,
    undo,
    redo,
    canUndo,
    canRedo,
    currentView,
    setCurrentView,
    updateProject,
    costsActiveTab,
    setCostsActiveTab
  } = useProjects();
  const [isCostsMenuExpanded, setIsCostsMenuExpanded] = useState(() => currentView === 'costs');
  const [showLaunchFlash, setShowLaunchFlash] = useState(false);
  const [launchedFileName, setLaunchedFileName] = useState('');

  useEffect(() => {
    if (currentView === 'costs') {
      setIsCostsMenuExpanded(true);
    }
  }, [currentView]);
  
  const [currentTimeText, setCurrentTimeText] = useState('');
  const [currentAlertIndex, setCurrentAlertIndex] = useState(0);
  const [isAgentManualOpen, setIsAgentManualOpen] = useState(false);
  const [auditLogs, setAuditLogs] = useState<ApiAuditLog[]>([]);
  const [isAuditModalOpen, setIsAuditModalOpen] = useState(false);
  const [selectedAuditLog, setSelectedAuditLog] = useState<ApiAuditLog | null>(null);
  const [isAgentConfigOpen, setIsAgentConfigOpen] = useState(false);

  useEffect(() => {
    const handleUpdate = () => {
      setAuditLogs([...apiAuditLogs]);
    };
    window.addEventListener('control-api-audit-update', handleUpdate);
    return () => window.removeEventListener('control-api-audit-update', handleUpdate);
  }, []);
  
  const [globalGeminiKey, setGlobalGeminiKey] = useState(() => {
    return localStorage.getItem('gemini-api-key') || '';
  });

  // Sincronizar el input con la clave del proyecto activo si cambia
  useEffect(() => {
    const activeProject = projects.find(p => p.id === activeProjectId);
    if (activeProject?.geminiApiKey) {
      setGlobalGeminiKey(activeProject.geminiApiKey);
    } else {
      setGlobalGeminiKey(localStorage.getItem('gemini-api-key') || '');
    }
  }, [activeProjectId, projects]);
  
  useEffect(() => {
    const updateClock = () => {
      const now = new Date();
      let hours = now.getHours();
      const minutes = String(now.getMinutes()).padStart(2, '0');
      const seconds = String(now.getSeconds()).padStart(2, '0');
      const ampm = hours >= 12 ? 'PM' : 'AM';
      hours = hours % 12;
      hours = hours ? hours : 12; // 0 should be 12
      setCurrentTimeText(`${hours}:${minutes}:${seconds} ${ampm} CE`);
    };
    
    updateClock();
    const intervalId = setInterval(updateClock, 1000);
    return () => clearInterval(intervalId);
  }, []);

  useEffect(() => {
    if (!activeAlerts || activeAlerts.length === 0) return;
    const interval = setInterval(() => {
      setCurrentAlertIndex(prev => (prev + 1) % activeAlerts.length);
    }, 30000); // 30 seconds
    return () => clearInterval(interval);
  }, [activeAlerts]);

  useEffect(() => {
    setCurrentAlertIndex(0);
  }, [activeAlerts?.length]);

  const activeProject = projects.find(p => p.id === activeProjectId);
  
  const [accentColor, setAccentColor] = useState(() => {
    return localStorage.getItem('lch-control-accent') || '72 100% 50%';
  });
  const [accentHex, setAccentHex] = useState(() => {
    return localStorage.getItem('lch-control-accent-hex') || '#aaff00';
  });
  const [isConfigMenuOpen, setIsConfigMenuOpen] = useState(false);
  const [customBg, setCustomBg] = useState(() => {
    return localStorage.getItem('lch-control-custom-bg') || '';
  });
  const [glassOpacity, setGlassOpacity] = useState(() => {
    const saved = localStorage.getItem('lch-control-glass');
    return saved !== null ? parseFloat(saved) : 0.05;
  });

  const configMenuRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [undoFeedback, setUndoFeedback] = useState<string | null>(null);

  const triggerFeedback = (msg: string) => {
    setUndoFeedback(msg);
    setTimeout(() => setUndoFeedback(null), 2000);
  };

  const ACCENT_OPTIONS = [
    { name: 'Cyan Neón', hsl: '190 100% 55%', color: '#00E5FF' },
    { name: 'Magenta Reactivo', hsl: '320 100% 60%', color: '#FF00A0' },
    { name: 'Ámbar Eléctrico', hsl: '35 100% 55%', color: '#FFAB00' },
    { name: 'Verde Matriz', hsl: '150 100% 50%', color: '#00FF88' },
    { name: 'Hielo', hsl: '210 20% 90%', color: '#E2E8F0' },
  ];

  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.setAttribute('data-theme', 'dark');
      localStorage.setItem('lch-control-theme', 'dark');
    } else {
      document.documentElement.setAttribute('data-theme', 'light');
      localStorage.setItem('lch-control-theme', 'light');
    }

    // Aplicar Color de Acento (Ajustado para contraste en modo claro)
    let displayAccent = accentColor;
    if (!isDarkMode) {
      const parts = accentColor.split(' ');
      if (parts.length === 3) {
        const h = parts[0];
        const s = parts[1];
        const l = parseInt(parts[2]);
        // Reducir luminosidad para modo claro sutilmente para mantener la energía
        displayAccent = `${h} ${s} ${Math.max(l - 15, 40)}%`;
      }
    }

    document.documentElement.style.setProperty('--primary-neon-hsl', displayAccent);
    localStorage.setItem('lch-control-accent', accentColor);

    // Aplicar opacidad del glassmorphism
    document.documentElement.style.setProperty('--glass-opacity', glassOpacity.toString());
    document.documentElement.style.setProperty('--glass-opacity-card', Math.min(1, glassOpacity + 0.15).toString());
    localStorage.setItem('lch-control-glass', glassOpacity.toString());

    // Aplicar Fondo Personalizado
    if (customBg) {
      document.body.style.setProperty('--bg-image', `url("${customBg}")`);
    } else {
      document.body.style.removeProperty('--bg-image');
    }
  }, [isDarkMode, accentColor, customBg, glassOpacity]);

  const handleBgUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      // Verificar tamaño (límite de ~4MB para localStorage base64)
      if (file.size > 4 * 1024 * 1024) {
        alert("⚠️ IMAGEN DEMASIADO GRANDE: Por favor elija una imagen de menos de 4MB para asegurar que se guarde correctamente.");
        return;
      }

      const reader = new FileReader();
      reader.onloadend = () => {
        const base64String = reader.result as string;
        try {
          setCustomBg(base64String);
          localStorage.setItem('lch-control-custom-bg', base64String);
        } catch (err) {
          console.error("Error saving to localStorage:", err);
          alert("No se pudo guardar la imagen permanentemente (espacio insuficiente). Se aplicará solo para esta sesión.");
        }
      };
      reader.readAsDataURL(file);
    }
  };

  const handleResetBg = () => {
    setCustomBg('');
    localStorage.removeItem('lch-control-custom-bg');
  };

  // Cerrar menú al hacer click fuera
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsFileMenuOpen(false);
      }
      if (configMenuRef.current && !configMenuRef.current.contains(event.target as Node)) {
        setIsConfigMenuOpen(false);
      }
    }
    if (isFileMenuOpen || isConfigMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isFileMenuOpen, isConfigMenuOpen]);

  // Manejar el lanzamiento desde archivo (.lch)
  useEffect(() => {
    // Escuchar desde PWA (Navegador)
    if ('launchQueue' in window) {
      (window as any).launchQueue.setConsumer(async (launchParams: any) => {
        if (launchParams.files.length > 0) {
          const handle = launchParams.files[0];
          await handleFileLaunch(handle);
          setLaunchedFileName(handle.name);
          setShowLaunchFlash(true);
          setTimeout(() => setShowLaunchFlash(false), 3000);
        }
      });
    }

    // Escuchar desde Electron (Escritorio)
    if ((window as any).electronAPI) {
      (window as any).electronAPI.onOpenFile(async (filePath: string) => {
        try {
          const content = await (window as any).electronAPI.readFile(filePath);
          if (content) {
            await handleFileLaunch({
              getFile: async () => ({
                text: async () => content,
                name: filePath.split(/[\\/]/).pop() || 'archivo.lch',
                path: filePath
              })
            });
            setLaunchedFileName(filePath.split(/[\\/]/).pop() || 'archivo.lch');
            setShowLaunchFlash(true);
            setTimeout(() => setShowLaunchFlash(false), 3000);
          }
        } catch (e) {
          console.error("Error loading file from Electron", e);
        }
      });
    }
  }, [handleFileLaunch]);

  // Global Keyboard Shortcuts for Undo/Redo
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Solo disparar si no se está editando un input de texto (opcional, pero Ctrl+Z suele ser nativo en inputs)
      // Aunque aquí queremos el Undo global de datos.
      if (e.ctrlKey || e.metaKey) {
        if (e.key.toLowerCase() === 'z') {
          if (e.shiftKey) {
            redo();
            triggerFeedback('REHACER');
          } else {
            undo();
            triggerFeedback('DESHACER');
          }
          e.preventDefault();
        } else if (e.key.toLowerCase() === 'y') {
          redo();
          triggerFeedback('REHACER');
          e.preventDefault();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [undo, redo]);


  const renderView = () => {
    switch (currentView) {
      case 'dashboard': return <DashboardView />;
      case 'budget': return <BudgetView />;
      case 'schedule': return <ScheduleView />;
      case 'progress': return <ProgressView />;
      case 'photos': return <PhotosView />;
      case 'reports': return <MemoriasView />;
      case 'monthly-reports': return <MonthlyReportsView />;
      case 'parciales': return <ParcialesView />;
      case 'analytics': return <ReportView />;
      case 'create-project': return <CreateProjectView onProjectCreated={() => setCurrentView('dashboard')} />;
      case 'edit-project': return <EditProjectView onSaved={() => setCurrentView('dashboard')} onCancel={() => setCurrentView('dashboard')} />;
      case 'photo-reports': return <PhotoReportsView />;
      case 'correspondence': return <CorrespondenceView />;
      case 'costs': return <CostsView />;
      default: return <DashboardView />;
    }
  };

  return (
    <div className="app-container">
      {showLaunchFlash && (
        <div style={{
          position: 'fixed', top: '20px', left: '50%', transform: 'translateX(-50%)',
          background: 'hsl(var(--accent-primary))', color: '#000',
          padding: '12px 24px', borderRadius: 'var(--radius-md)', fontWeight: 'bold',
          zIndex: 1000, boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
          display: 'flex', alignItems: 'center', gap: '10px', animation: 'slideDown 0.3s ease-out'
        }}>
          <Folder size={18} /> Proyecto Cargado: {launchedFileName}
        </div>
      )}

      {/* Sidebar Navigation */}
      <aside className="sidebar">
        <div className="sidebar-header" style={{ paddingBottom: 'var(--spacing-md)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: 'var(--spacing-md)' }}>
            <div style={{
              width: '32px',
              height: '32px',
              borderRadius: '4px',
              overflow: 'hidden',
              flexShrink: 0,
              background: '#000',
              border: '1px solid rgba(255,255,255,0.1)'
            }}>
              <img
                src={logo}
                alt=""
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              />
            </div>
            <h1 style={{
              margin: 0,
              fontSize: '1.2rem',
              letterSpacing: '4px',
              fontWeight: 700,
              whiteSpace: 'nowrap',
              color: 'hsl(var(--text-primary))',
              fontFamily: 'var(--font-technical)'
            }}>CONTROL</h1>
          </div>

          {/* Menú Archivo */}
          <div style={{ position: 'relative', marginBottom: 'var(--spacing-md)' }} ref={menuRef}>
            <button
              onClick={() => setIsFileMenuOpen(!isFileMenuOpen)}
              style={{
                background: 'hsl(var(--bg-tertiary))',
                border: '1px solid hsl(var(--border-color))',
                color: 'hsl(var(--text-secondary))', borderRadius: 'var(--radius-sm)',
                padding: '8px 12px', fontSize: '0.8rem', cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: '8px', width: '100%',
                transition: 'all 0.2s',
                boxShadow: '0 2px 4px rgba(0,0,0,0.2)'
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = 'hsl(var(--accent-primary))';
                e.currentTarget.style.color = 'hsl(var(--text-primary))';
                e.currentTarget.style.background = 'hsl(var(--bg-tertiary))';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = 'hsl(var(--border-color))';
                e.currentTarget.style.color = 'hsl(var(--text-secondary))';
              }}
            >
              <Folder size={14} /> Menú Archivo
            </button>

            {isFileMenuOpen && (
              <div style={{
                position: 'absolute', top: '110%', left: '0',
                background: 'hsl(var(--bg-secondary))', border: '1px solid hsl(var(--border-color))',
                borderRadius: 'var(--radius-md)', padding: 'var(--spacing-xs)', zIndex: 100,
                width: '180px', boxShadow: '0 8px 32px rgba(0,0,0,0.8)',
                overflow: 'hidden', animation: 'slideDownTechnical 0.2s ease-out'
              }}>
                <div
                  className="dropdown-item"
                  onClick={() => { setCurrentView('create-project'); setIsFileMenuOpen(false); }}
                  style={{
                    padding: '12px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '10px',
                    fontSize: '0.85rem', borderBottom: '1px solid hsl(var(--border-color))', fontWeight: '600',
                    color: 'hsl(var(--accent-primary))'
                  }}
                >
                  <Folder size={14} /> Nuevo Proyecto
                </div>
                {activeProjectId && (
                  <div
                    className="dropdown-item"
                    onClick={() => { setCurrentView('edit-project'); setIsFileMenuOpen(false); }}
                    style={{
                      padding: '12px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '10px',
                      fontSize: '0.85rem', borderBottom: '1px solid hsl(var(--border-color))', fontWeight: '600',
                      color: 'hsl(var(--accent-technical))'
                    }}
                  >
                    <Calculator size={14} /> Editar Proyecto
                  </div>
                )}
                <div
                  className="dropdown-item"
                  onClick={async () => {
                    try {
                      await importProject();
                      setIsFileMenuOpen(false);
                    } catch (e) { }
                  }}
                  style={{ padding: '12px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '10px', fontSize: '0.85rem' }}
                >
                  <Upload size={14} /> Abrir Proyecto (.lch)
                </div>
                <div
                  className="dropdown-item"
                  onClick={() => { exportActiveProject(); setIsFileMenuOpen(false); }}
                  style={{ padding: '12px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '10px', fontSize: '0.85rem' }}
                >
                  <Download size={14} /> Guardar Proyecto (.lch)
                </div>
              </div>
            )}
          </div>

          {/* Menú Configuración */}
          <div style={{ position: 'relative', marginBottom: 'var(--spacing-md)' }} ref={configMenuRef}>
            <button
              onClick={() => setIsConfigMenuOpen(!isConfigMenuOpen)}
              style={{
                background: 'hsl(var(--bg-tertiary))',
                border: '1px solid hsl(var(--border-color))',
                color: 'hsl(var(--text-secondary))', borderRadius: 'var(--radius-sm)',
                padding: '8px 12px', fontSize: '0.8rem', cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: '8px', width: '100%',
                transition: 'all 0.2s',
                boxShadow: '0 2px 4px rgba(0,0,0,0.2)'
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = 'hsl(var(--accent-primary))';
                e.currentTarget.style.color = 'hsl(var(--text-primary))';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = 'hsl(var(--border-color))';
                e.currentTarget.style.color = 'hsl(var(--text-secondary))';
              }}
            >
              <Settings size={14} /> Configuración
            </button>

            {isConfigMenuOpen && (
              <div style={{
                position: 'absolute', top: '110%', left: '0',
                background: 'hsl(var(--bg-secondary))', border: '1px solid hsl(var(--border-color))',
                borderRadius: 'var(--radius-md)', padding: 'var(--spacing-md)', zIndex: 100,
                width: '220px', boxShadow: '0 8px 32px rgba(0,0,0,0.8)',
                animation: 'slideDownTechnical 0.2s ease-out'
              }}>
                {/* Color de Acento */}
                <div style={{ marginBottom: 'var(--spacing-md)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.65rem', color: 'hsl(var(--text-secondary))', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '1px' }}>
                    <Palette size={10} /> Color de Acento
                  </div>
                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '8px' }}>
                    {ACCENT_OPTIONS.map(opt => (
                      <div
                        key={opt.hsl}
                        onClick={() => {
                          setAccentColor(opt.hsl);
                          setAccentHex(opt.color);
                        }}
                        title={opt.name}
                        style={{
                          width: '24px', height: '24px', borderRadius: '50%', background: opt.color, cursor: 'pointer',
                          border: accentColor === opt.hsl ? '2px solid #fff' : '1px solid rgba(255,255,255,0.2)',
                          boxShadow: accentColor === opt.hsl ? `0 0 12px ${opt.color}` : 'none',
                          transition: 'all 0.2s'
                        }}
                      />
                    ))}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <input 
                      type="color" 
                      value={accentHex}
                      onChange={(e) => {
                        const hex = e.target.value;
                        setAccentHex(hex);
                        setAccentColor(hexToHSL(hex));
                        localStorage.setItem('lch-control-accent-hex', hex);
                      }}
                      style={{ 
                        width: '32px', height: '32px', padding: 0, border: 'none', borderRadius: '4px', cursor: 'pointer',
                        background: 'transparent'
                      }}
                      title="Color libre"
                    />
                    <span style={{ fontSize: '0.7rem', color: 'hsl(var(--text-muted))' }}>Selector Libre</span>
                  </div>
                </div>

                <div style={{ height: '1px', background: 'hsl(var(--border-color))', margin: '12px 0' }}></div>

                {/* Opacidad del Glass */}
                <div style={{ marginBottom: 'var(--spacing-md)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '0.65rem', color: 'hsl(var(--text-secondary))', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '1px' }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><Settings size={10} /> Cristal</span>
                    <span>{Math.round(glassOpacity * 100)}%</span>
                  </div>
                  <input 
                    type="range" 
                    min="0" 
                    max="1" 
                    step="0.01" 
                    value={glassOpacity}
                    onChange={(e) => setGlassOpacity(parseFloat(e.target.value))}
                    style={{ width: '100%', cursor: 'pointer' }}
                  />
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.6rem', color: 'hsl(var(--text-muted))', marginTop: '4px' }}>
                    <span>Transparente</span>
                    <span>Sólido</span>
                  </div>
                </div>

                <div style={{ height: '1px', background: 'hsl(var(--border-color))', margin: '12px 0' }}></div>

                {/* Fondo Personalizado */}
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.65rem', color: 'hsl(var(--text-secondary))', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '1px' }}>
                    <Image size={10} /> Fondo de App
                  </div>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleBgUpload}
                    style={{ display: 'none' }}
                    ref={fileInputRef}
                  />
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      className="btn btn-secondary"
                      style={{ padding: '6px 10px', fontSize: '0.75rem', width: '100%', height: 'auto' }}
                    >
                      <Upload size={12} /> Subir Imagen
                    </button>
                    {customBg && (
                      <button
                        onClick={handleResetBg}
                        className="btn btn-ghost"
                        style={{ padding: '6px 10px', fontSize: '0.75rem', width: '100%', height: 'auto', color: 'hsl(var(--danger))' }}
                      >
                        <X size={12} /> Resetear Fondo
                      </button>
                    )}
                  </div>
                </div>

                <div style={{ height: '1px', background: 'hsl(var(--border-color))', margin: '12px 0' }}></div>

                {/* Configuración del Agente IA */}
                <div style={{ marginBottom: 'var(--spacing-md)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.65rem', color: 'hsl(var(--text-secondary))', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '1px' }}>
                    <Bot size={10} style={{ color: 'hsl(var(--accent-primary))' }} /> Configuración Agente IA
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <label style={{ fontSize: '0.6rem', color: 'hsl(var(--text-muted))' }}>GEMINI API KEY (GOOGLE AI STUDIO)</label>
                    <input 
                      type="password" 
                      value={globalGeminiKey}
                      onChange={(e) => {
                        const newKey = e.target.value;
                        setGlobalGeminiKey(newKey);
                        localStorage.setItem('gemini-api-key', newKey);
                        
                        // Si hay un proyecto activo, guardar también a nivel de proyecto
                        const activeProject = projects.find(p => p.id === activeProjectId);
                        if (activeProject) {
                          updateProject(activeProject.id, { geminiApiKey: newKey });
                        }
                      }}
                      placeholder="Google AI Studio Key"
                      style={{
                        background: 'hsl(var(--bg-tertiary))',
                        border: '1px solid hsl(var(--border-color))',
                        color: 'hsl(var(--text-primary))',
                        borderRadius: 'var(--radius-sm)',
                        padding: '6px 8px',
                        fontSize: '0.7rem',
                        width: '100%',
                        outline: 'none',
                        transition: 'border-color 0.2s'
                      }}
                      onFocus={(e) => e.target.style.borderColor = 'hsl(var(--accent-primary))'}
                      onBlur={(e) => e.target.style.borderColor = 'hsl(var(--border-color))'}
                    />
                  </div>
                </div>

                <div style={{ height: '1px', background: 'hsl(var(--border-color))', margin: '12px 0' }}></div>

                {/* Manual del Agente */}
                <div>
                  <button
                    onClick={() => {
                      setIsAgentManualOpen(true);
                      setIsConfigMenuOpen(false);
                    }}
                    className="btn btn-primary"
                    style={{
                      width: '100%',
                      padding: '8px 12px',
                      fontSize: '0.7rem',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '6px',
                      fontFamily: 'var(--font-technical)',
                      fontWeight: 'bold',
                      background: 'hsla(var(--primary-neon-hsl), 0.1)',
                      border: '1px solid hsl(var(--primary-neon))',
                      color: 'hsl(var(--primary-neon))',
                      boxShadow: '0 0 10px hsla(var(--primary-neon-hsl), 0.15)',
                      transition: 'all 0.3s ease',
                      height: 'auto'
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = 'hsl(var(--primary-neon))';
                      e.currentTarget.style.color = '#000';
                      e.currentTarget.style.boxShadow = '0 0 18px hsla(var(--primary-neon-hsl), 0.4)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = 'hsla(var(--primary-neon-hsl), 0.1)';
                      e.currentTarget.style.color = 'hsl(var(--primary-neon))';
                      e.currentTarget.style.boxShadow = '0 0 10px hsla(var(--primary-neon-hsl), 0.15)';
                    }}
                  >
                    <Bot size={14} /> MANUAL DEL AGENTE
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* v2026-05-05: Undo/Redo Compacto en Sidebar */}
          <div style={{
            display: 'flex',
            gap: '4px',
            marginBottom: 'var(--spacing-md)',
            background: 'hsla(var(--bg-tertiary), 0.5)',
            padding: '4px',
            borderRadius: 'var(--radius-sm)',
            border: '1px solid hsla(var(--border-color), 0.5)'
          }}>
            <button
              onClick={() => { undo(); triggerFeedback('DESHACER'); }}
              disabled={!canUndo}
              style={{
                flex: 1,
                padding: '6px',
                fontSize: '0.6rem',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '2px',
                background: 'transparent',
                color: 'hsl(var(--text-secondary))',
                opacity: canUndo ? 1 : 0.2,
                cursor: canUndo ? 'pointer' : 'default'
              }}
              title="Deshacer (Ctrl+Z)"
            >
              <Undo2 size={12} style={{ color: canUndo ? 'hsl(var(--accent-primary))' : 'currentColor' }} />
              <span style={{ fontSize: '0.5rem', fontWeight: '800' }}>UNDO</span>
            </button>
            <div style={{ width: '1px', background: 'hsl(var(--border-color))', margin: '4px 0' }}></div>
            <button
              onClick={() => { redo(); triggerFeedback('REHACER'); }}
              disabled={!canRedo}
              style={{
                flex: 1,
                padding: '6px',
                fontSize: '0.6rem',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '2px',
                background: 'transparent',
                color: 'hsl(var(--text-secondary))',
                opacity: canRedo ? 1 : 0.2,
                cursor: canRedo ? 'pointer' : 'default'
              }}
              title="Rehacer (Ctrl+Y)"
            >
              <Redo2 size={12} style={{ color: canRedo ? 'hsl(var(--accent-primary))' : 'currentColor' }} />
              <span style={{ fontSize: '0.5rem', fontWeight: '800' }}>REDO</span>
            </button>
          </div>
        </div>
        <nav className="sidebar-nav">
          {/* Tab Selector (Técnico / Administrativo) */}
          <div style={{
            display: 'flex',
            gap: '8px',
            marginBottom: 'var(--spacing-md)',
            padding: '0 8px'
          }}>
            <button
              onClick={() => setSidebarTab('technical')}
              style={{
                flex: 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
                padding: '8px 12px',
                borderRadius: 'var(--radius-sm)',
                fontSize: '0.75rem',
                fontWeight: 'bold',
                fontFamily: 'var(--font-technical)',
                cursor: 'pointer',
                transition: 'all 0.3s ease',
                background: sidebarTab === 'technical' ? 'hsla(var(--primary-neon-hsl), 0.15)' : 'transparent',
                border: sidebarTab === 'technical' ? '1px solid hsl(var(--primary-neon))' : '1px solid transparent',
                color: sidebarTab === 'technical' ? 'hsl(var(--primary-neon))' : 'hsl(var(--text-secondary))',
                boxShadow: sidebarTab === 'technical' ? '0 0 10px hsla(var(--primary-neon-hsl), 0.15)' : 'none'
              }}
            >
              <HardHat size={16} />
              <span>TÉCNICO</span>
            </button>
            <button
              onClick={() => setSidebarTab('administrative')}
              style={{
                flex: 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
                padding: '8px 12px',
                borderRadius: 'var(--radius-sm)',
                fontSize: '0.75rem',
                fontWeight: 'bold',
                fontFamily: 'var(--font-technical)',
                cursor: 'pointer',
                transition: 'all 0.3s ease',
                background: sidebarTab === 'administrative' ? 'hsla(var(--primary-neon-hsl), 0.15)' : 'transparent',
                border: sidebarTab === 'administrative' ? '1px solid hsl(var(--primary-neon))' : '1px solid transparent',
                color: sidebarTab === 'administrative' ? 'hsl(var(--primary-neon))' : 'hsl(var(--text-secondary))',
                boxShadow: sidebarTab === 'administrative' ? '0 0 10px hsla(var(--primary-neon-hsl), 0.15)' : 'none'
              }}
            >
              <Glasses size={16} />
              <span>ADMIN</span>
            </button>
          </div>

          {sidebarTab === 'technical' ? (
            <>
              <div
                className={`nav-item ${currentView === 'dashboard' ? 'active' : ''}`}
                onClick={() => setCurrentView('dashboard')}
              >
                <LayoutDashboard size={20} />
                <span>Resumen</span>
              </div>
              <div
                className={`nav-item ${currentView === 'budget' ? 'active' : ''}`}
                onClick={() => setCurrentView('budget')}
              >
                <Calculator size={20} />
                <span>Presupuesto</span>
              </div>
              <div
                className={`nav-item ${currentView === 'schedule' ? 'active' : ''}`}
                onClick={() => setCurrentView('schedule')}
              >
                <CalendarClock size={20} />
                <span>Programación</span>
              </div>
              <div
                className={`nav-item ${currentView === 'progress' ? 'active' : ''}`}
                onClick={() => setCurrentView('progress')}
              >
                <TrendingUp size={20} />
                <span>Avance</span>
              </div>
              <div
                className={`nav-item ${currentView === 'photos' ? 'active' : ''}`}
                onClick={() => setCurrentView('photos')}
              >
                <Camera size={20} />
                <span>Registro Fotográfico</span>
              </div>
              <div
                className={`nav-item ${currentView === 'reports' ? 'active' : ''}`}
                onClick={() => setCurrentView('reports')}
              >
                <FileText size={20} />
                <span>Memorias</span>
              </div>
              <div
                className={`nav-item ${currentView === 'parciales' ? 'active' : ''}`}
                onClick={() => setCurrentView('parciales')}
              >
                <Receipt size={20} />
                <span>Parciales</span>
              </div>
              <div
                className={`nav-item ${currentView === 'analytics' ? 'active' : ''}`}
                onClick={() => setCurrentView('analytics')}
                style={{
                  color: 'hsl(var(--primary-neon))'
                }}
              >
                <TrendingUp size={20} />
                <span>Control Curva S</span>
              </div>
            </>
          ) : (
            <>
              <div
                className={`nav-item ${currentView === 'photo-reports' ? 'active' : ''}`}
                onClick={() => setCurrentView('photo-reports')}
              >
                <Folder size={20} />
                <span>Informes Fotográficos</span>
              </div>
              <div
                className={`nav-item ${currentView === 'monthly-reports' ? 'active' : ''}`}
                onClick={() => setCurrentView('monthly-reports')}
              >
                <FileText size={20} />
                <span>Informes Mensuales</span>
              </div>
              <div
                className={`nav-item ${currentView === 'correspondence' ? 'active' : ''}`}
                onClick={() => setCurrentView('correspondence')}
              >
                <FileText size={20} />
                <span>Correspondencia</span>
              </div>

              {/* COSTOS Item */}
              <div
                className={`nav-item ${currentView === 'costs' ? 'active' : ''}`}
                onClick={() => setCurrentView('costs')}
              >
                <DollarSign size={20} />
                <span>Costos</span>
              </div>
            </>
          )}

          <div style={{ flex: 1 }}></div>

          <div
            className="nav-item"
            onClick={() => setIsDarkMode(!isDarkMode)}
            style={{ marginBottom: 'var(--spacing-md)', marginTop: 'var(--spacing-md)' }}
          >
            {isDarkMode ? <Sun size={20} /> : <Moon size={20} />}
            <span>{isDarkMode ? 'Modo Claro' : 'Modo Oscuro'}</span>
          </div>
        </nav>
      </aside>

      {/* Main Viewport */}
      <main className="main-content" style={{ display: 'flex', flexDirection: 'column' }}>

        {undoFeedback && (
          <div style={{
            position: 'fixed',
            top: '60px',
            right: '20px',
            background: 'hsl(var(--accent-primary))',
            color: '#000',
            padding: '4px 12px',
            borderRadius: '4px',
            fontSize: '0.6rem',
            fontWeight: '900',
            zIndex: 1000,
            boxShadow: '0 0 20px hsla(var(--primary-neon), 0.4)',
            animation: 'fadeInOut 2s forwards',
            letterSpacing: '2px'
          }}>
            ✓ {undoFeedback}
          </div>
        )}

        <div className="viewport-wrapper" style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          {renderView()}
        </div>

        {/* GLOBAL AGENT SYSTEM STATUS BAR */}
        {activeProject && (
          <div className="system-footer-container">
            <footer className="system-bar">
              <div className="system-alerts" style={{ display: 'flex', gap: '30px', alignItems: 'center' }}>
                <div 
                  className="system-label-interactive" 
                  onClick={toggleAgent}
                  style={{ 
                    display: 'flex', 
                    alignItems: 'center', 
                    gap: '8px',
                    cursor: 'pointer',
                    position: 'relative',
                    padding: '2px 8px',
                    borderRadius: '6px',
                    transition: 'background 0.3s ease'
                  }}
                >
                  <Bot size={20} className="agent-status-bot-icon" />
                  <span>AGENTE IA</span>



                  {/* Indicador de "Trabajando" (Pulso) */}
                  {isAgentLoading && (
                    <div style={{
                      position: 'absolute',
                      bottom: '-2px',
                      left: '12px',
                      width: '6px',
                      height: '6px',
                      borderRadius: '50%',
                      background: 'hsl(var(--accent-primary))',
                      boxShadow: '0 0 6px hsla(var(--primary-neon-hsl), 0.8)',
                      animation: 'pulse-ring 1.5s infinite',
                      zIndex: 10
                    }} />
                  )}
                </div>
                
                {/* Mostrar una única alerta a la vez, rotando cada 30 segundos */}
                {activeAlerts && activeAlerts.length > 0 && (() => {
                  const alertToShow = activeAlerts[currentAlertIndex % activeAlerts.length];
                  return (
                    <div 
                      key={alertToShow.id} 
                      className={`alert-pill-interactive alert-type-${alertToShow.type}`}
                      onClick={() => triggerAlertQuery(alertToShow)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        cursor: 'pointer',
                        padding: '4px 12px',
                        borderRadius: '20px',
                        transition: 'all 0.3s ease',
                      }}
                    >
                      <div className="alert-status-dot" style={{ color: alertToShow.color }} />
                      <span style={{ color: 'hsl(var(--text-primary))', fontWeight: 'bold', fontSize: '0.65rem' }}>
                        {alertToShow.text}
                      </span>
                    </div>
                  );
                })()}
              </div>
              
              <div className="system-time" style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '0.65rem' }}>
                <span>{currentTimeText}</span>
                <span style={{ opacity: 0.3 }}>|</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ color: 'hsl(var(--primary-neon))', fontWeight: 'bold' }}>✓ AGENTE ACTIVO</span>
                  <button
                    onClick={() => {
                      setAuditLogs([...apiAuditLogs]);
                      if (apiAuditLogs.length > 0 && !selectedAuditLog) {
                        setSelectedAuditLog(apiAuditLogs[0]);
                      }
                      setIsAuditModalOpen(true);
                    }}
                    style={{
                      background: 'hsla(var(--primary-neon-hsl), 0.1)',
                      border: '1px solid hsl(var(--primary-neon))',
                      color: 'hsl(var(--primary-neon))',
                      borderRadius: '4px',
                      padding: '2px 6px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px',
                      cursor: 'pointer',
                      fontSize: '0.55rem',
                      fontWeight: '800',
                      fontFamily: 'var(--font-technical)',
                      transition: 'all 0.2s ease',
                      boxShadow: '0 0 5px hsla(var(--primary-neon-hsl), 0.15)'
                    }}
                    title="Auditar llamadas API de CONTROL"
                  >
                    <Terminal size={10} /> AUDITAR
                  </button>

                  <button
                    onClick={() => setIsAgentConfigOpen(true)}
                    style={{
                      background: 'hsla(var(--primary-neon-hsl), 0.1)',
                      border: '1px solid hsl(var(--primary-neon))',
                      color: 'hsl(var(--primary-neon))',
                      borderRadius: '4px',
                      padding: '2px 6px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px',
                      cursor: 'pointer',
                      fontSize: '0.55rem',
                      fontWeight: '800',
                      fontFamily: 'var(--font-technical)',
                      transition: 'all 0.2s ease',
                      boxShadow: '0 0 5px hsla(var(--primary-neon-hsl), 0.15)'
                    }}
                    title="Configuración y memoria del Agente IA"
                  >
                    <Bot size={10} /> CONFIGURAR
                  </button>
                </div>
              </div>
            </footer>
          </div>
        )}

        <AgentPanel />

        {/* MODAL DEL MANUAL DE OPERACIONES DEL AGENTE IA */}
        {isAgentManualOpen && (
          <div style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0, 0, 0, 0.75)',
            backdropFilter: 'blur(8px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
            animation: 'fadeIn 0.25s ease-out'
          }}>
            <div style={{
              background: 'hsl(var(--bg-secondary))',
              border: '1px solid hsl(var(--border-color))',
              borderRadius: 'var(--radius-lg)',
              width: '90%',
              maxWidth: '650px',
              maxHeight: '85vh',
              display: 'flex',
              flexDirection: 'column',
              boxShadow: '0 24px 64px rgba(0,0,0,0.8), inset 0 1px 0 rgba(255,255,255,0.05)',
              overflow: 'hidden',
              animation: 'zoomInTechnical 0.25s cubic-bezier(0.16, 1, 0.3, 1)'
            }}>
              {/* Header */}
              <div style={{
                padding: '16px 20px',
                borderBottom: '1px solid hsl(var(--border-color))',
                background: 'hsla(var(--bg-tertiary), 0.6)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <div style={{
                    background: 'hsla(var(--primary-neon-hsl), 0.1)',
                    padding: '8px',
                    borderRadius: '8px',
                    border: '1px solid hsl(var(--primary-neon))',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                  }}>
                    <Bot size={20} style={{ color: 'hsl(var(--primary-neon))' }} />
                  </div>
                  <div>
                    <h3 style={{ margin: 0, fontSize: '1rem', color: 'hsl(var(--text-primary))', fontFamily: 'var(--font-technical)', fontWeight: 'bold', letterSpacing: '0.5px' }}>
                      MANUAL DEL AGENTE IA
                    </h3>
                    <p style={{ margin: 0, fontSize: '0.65rem', color: 'hsl(var(--text-muted))', textTransform: 'uppercase', letterSpacing: '1px', marginTop: '2px' }}>
                      Especificaciones de Operación e Integración
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setIsAgentManualOpen(false)}
                  style={{
                    background: 'transparent',
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
                  <X size={18} />
                </button>
              </div>

              {/* Body */}
              <div 
                className="custom-scrollbar"
                style={{
                  padding: '24px',
                  overflowY: 'auto',
                  fontSize: '0.8rem',
                  lineHeight: '1.5',
                  color: 'hsl(var(--text-secondary))',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '20px'
                }}
              >
                <div style={{ fontSize: '0.75rem', background: 'hsla(var(--accent-primary), 0.03)', border: '1px solid hsla(var(--accent-primary), 0.15)', borderRadius: 'var(--radius-md)', padding: '12px 16px', color: 'hsl(var(--text-primary))' }}>
                  <strong>Nota del Ingeniero:</strong> El agente está diseñado para trabajar de forma compacta y reactiva localmente. Hemos refinado su motor eliminando las revisiones complejas por lotes que saturaban el modelo local de LM Studio, logrando una operación de latencia cero para tareas cotidianas y manteniendo tu privacidad total.
                </div>

                {/* Section 1 */}
                <div>
                  <h4 style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.85rem', color: 'hsl(var(--accent-primary))', fontFamily: 'var(--font-technical)', margin: '0 0 10px 0', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                    <span style={{ fontSize: '1rem' }}>📌</span> 1. Gestión Conversacional de Pendientes
                  </h4>
                  <p style={{ margin: '0 0 10px 0' }}>
                    El agente analiza tus mensajes para administrar tus tareas pendientes de forma automática y transparente:
                  </p>
                  <ul style={{ margin: 0, paddingLeft: '20px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <li>
                      <strong>Creación de Tareas:</strong> Activado de manera instantánea por frases como <em>"tengo que"</em>, <em>"me falta"</em>, <em>"tengo pendiente"</em>, <em>"necesito"</em> o <em>"hay que"</em>.
                      <br />
                      <span style={{ color: 'hsl(var(--text-muted))', fontSize: '0.75rem' }}>Ejemplo: "me falta hacer el informe semanal a corte del 17 de mayo"</span>
                    </li>
                    <li>
                      <strong>Completar Tareas:</strong> Activado por frases como <em>"ya hice"</em>, <em>"marca como hecho"</em> o <em>"completado"</em>.
                      <br />
                      <span style={{ color: 'hsl(var(--text-muted))', fontSize: '0.75rem' }}>Ejemplo: "ya hice el oficio del comedor" o haciendo clic en el check verde del panel.</span>
                    </li>
                    <li>
                      <strong>Sincronización Física:</strong> Escribe automáticamente la lista ordenada en el archivo físico <strong style={{ color: 'hsl(var(--accent-primary))' }}>PENDIENTES.md</strong> en la carpeta raíz de tu proyecto.
                    </li>
                  </ul>
                </div>

                <div style={{ height: '1px', background: 'hsl(var(--border-color))' }}></div>

                {/* Section 2 */}
                <div>
                  <h4 style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.85rem', color: 'hsl(var(--accent-primary))', fontFamily: 'var(--font-technical)', margin: '0 0 10px 0', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                    <span style={{ fontSize: '1rem' }}>🚨</span> 2. Sistema de Alertas (Barra Inferior)
                  </h4>
                  <p style={{ margin: '0 0 10px 0' }}>
                    El agente audita constantemente el estado del proyecto y rota alertas de advertencia en la barra de estado inferior cada <strong>30 segundos</strong>:
                  </p>
                  <ul style={{ margin: 0, paddingLeft: '20px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <li>
                      <strong>Evidencia Fotográfica (📷):</strong> Advierte si hoy no has subido fotos de avance o calcula el número exacto de días transcurridos desde el último registro.
                    </li>
                    <li>
                      <strong>Atraso de Cronograma (⚠️):</strong> Alerta sobre actividades del presupuesto cuya fecha límite ya venció y presentan un avance menor al 100%.
                    </li>
                    <li>
                      <strong>Rezago Financiero (💰):</strong> Compara el avance financiero total acumulado en Actas Parciales frente al avance físico y alerta si el desfase supera el <strong>15%</strong>.
                    </li>
                    <li>
                      <strong>Clima en Obra (🌧️/☀️):</strong> Alerta si se registran días lluviosos recientes en la bitácora de obra, advirtiendo riesgos en vaciados.
                    </li>
                  </ul>
                </div>

                <div style={{ height: '1px', background: 'hsl(var(--border-color))' }}></div>

                {/* Section 3 */}
                <div>
                  <h4 style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.85rem', color: 'hsl(var(--accent-primary))', fontFamily: 'var(--font-technical)', margin: '0 0 10px 0', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                    <span style={{ fontSize: '1rem' }}>📸</span> 3. Asignación Inteligente de Fotos
                  </h4>
                  <p style={{ margin: 0 }}>
                    Al cargar fotos en la pestaña de Evidencia, el agente analiza automáticamente las descripciones del presupuesto y te sugiere los ítems de obra más probables para clasificar la imagen de manera inmediata.
                  </p>
                </div>
              </div>

              {/* Footer */}
              <div style={{
                padding: '12px 20px',
                borderTop: '1px solid hsl(var(--border-color))',
                background: 'hsla(var(--bg-tertiary), 0.6)',
                display: 'flex',
                justifyContent: 'flex-end'
              }}>
                <button
                  onClick={() => setIsAgentManualOpen(false)}
                  className="btn btn-secondary"
                  style={{ padding: '6px 16px', fontSize: '0.75rem', height: 'auto' }}
                >
                  Entendido
                </button>
              </div>
            </div>
          </div>
        )}

        {/* MODAL DE AUDITORÍA DE LLAMADAS API */}
        {isAuditModalOpen && (
          <div style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0, 0, 0, 0.75)',
            backdropFilter: 'blur(8px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
            animation: 'fadeIn 0.25s ease-out'
          }}>
            <div style={{
              background: 'hsl(var(--bg-secondary))',
              border: '1px solid hsl(var(--border-color))',
              borderRadius: 'var(--radius-lg)',
              width: '90%',
              maxWidth: '900px',
              height: '80vh',
              maxHeight: '80vh',
              display: 'flex',
              flexDirection: 'column',
              boxShadow: '0 24px 64px rgba(0,0,0,0.8)',
              overflow: 'hidden',
              animation: 'zoomInTechnical 0.25s cubic-bezier(0.16, 1, 0.3, 1)'
            }}>
              {/* Header */}
              <div style={{
                padding: '16px 20px',
                borderBottom: '1px solid hsl(var(--border-color))',
                background: 'hsla(var(--bg-tertiary), 0.6)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <div style={{
                    background: 'hsla(var(--primary-neon-hsl), 0.1)',
                    padding: '8px',
                    borderRadius: '8px',
                    border: '1px solid hsl(var(--primary-neon))',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                  }}>
                    <Terminal size={20} style={{ color: 'hsl(var(--primary-neon))' }} />
                  </div>
                  <div>
                    <h3 style={{ margin: 0, fontSize: '1rem', color: 'hsl(var(--text-primary))', fontFamily: 'var(--font-technical)', fontWeight: 'bold', letterSpacing: '0.5px' }}>
                      AUDITORÍA DE LLAMADAS API (CONTROL IA)
                    </h3>
                    <p style={{ margin: 0, fontSize: '0.65rem', color: 'hsl(var(--text-muted))', textTransform: 'uppercase', letterSpacing: '1px', marginTop: '2px' }}>
                      Registro de Peticiones y Respuestas de Google AI Studio (Gemini)
                    </p>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  {auditLogs.length > 0 && (
                    <button
                      onClick={() => {
                        apiAuditLogs.length = 0;
                        setAuditLogs([]);
                        setSelectedAuditLog(null);
                      }}
                      className="btn btn-ghost"
                      style={{ padding: '6px 12px', fontSize: '0.7rem', color: 'hsl(var(--danger))', height: 'auto' }}
                    >
                      LIMPIAR REGISTRO
                    </button>
                  )}
                  <button
                    onClick={() => setIsAuditModalOpen(false)}
                    style={{
                      background: 'transparent',
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
                    <X size={18} />
                  </button>
                </div>
              </div>

              {/* Body */}
              <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
                {/* Left Pane: Logs List */}
                <div style={{
                  width: '320px',
                  borderRight: '1px solid hsl(var(--border-color))',
                  background: 'hsla(var(--bg-tertiary), 0.3)',
                  overflowY: 'auto',
                  display: 'flex',
                  flexDirection: 'column'
                }}>
                  {auditLogs.length === 0 ? (
                    <div className="flex-center" style={{ flex: 1, flexDirection: 'column', gap: '8px', color: 'hsl(var(--text-muted))', padding: '20px' }}>
                      <Terminal size={32} style={{ opacity: 0.2 }} />
                      <span style={{ fontSize: '0.75rem', fontWeight: 'bold' }}>Sin peticiones registradas</span>
                    </div>
                  ) : (
                    auditLogs.map((log) => {
                      const isSelected = selectedAuditLog?.id === log.id;
                      const isOk = typeof log.status === 'number' && log.status >= 200 && log.status < 300;
                      const statusColor = isOk ? 'hsl(var(--accent-primary))' : 'hsl(var(--danger))';
                      return (
                        <div
                          key={log.id}
                          onClick={() => setSelectedAuditLog(log)}
                          style={{
                            padding: '12px 16px',
                            borderBottom: '1px solid hsla(var(--border-color), 0.5)',
                            cursor: 'pointer',
                            background: isSelected ? 'hsla(var(--primary-neon-hsl), 0.08)' : 'transparent',
                            borderLeft: isSelected ? '3px solid hsl(var(--primary-neon))' : '3px solid transparent',
                            transition: 'all 0.2s ease',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '4px'
                          }}
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span style={{ fontSize: '0.7rem', color: 'hsl(var(--text-primary))', fontWeight: 'bold', fontFamily: 'var(--font-technical)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '180px' }}>
                              {log.model}
                            </span>
                            <span style={{
                              fontSize: '0.6rem',
                              fontWeight: '900',
                              padding: '2px 6px',
                              borderRadius: '4px',
                              background: isOk ? 'rgba(0,229,255,0.1)' : 'rgba(255,0,0,0.1)',
                              color: statusColor,
                              border: `1px solid ${isOk ? 'rgba(0,229,255,0.2)' : 'rgba(255,0,0,0.2)'}`
                            }}>
                              {log.status}
                            </span>
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.65rem', color: 'hsl(var(--text-muted))' }}>
                            <span>{log.timestamp}</span>
                            <span>{log.durationMs} ms</span>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>

                {/* Right Pane: Log details */}
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, background: 'hsl(var(--bg-primary))' }}>
                  {selectedAuditLog ? (
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, padding: '24px', overflowY: 'auto', gap: '16px' }}>
                      {/* Metadatos */}
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '12px', background: 'hsla(var(--bg-secondary-hsl), 0.5)', padding: '12px 16px', borderRadius: '6px', border: '1px solid hsl(var(--border-color))' }}>
                        <div>
                          <span style={{ fontSize: '0.6rem', color: 'hsl(var(--text-muted))', display: 'block', textTransform: 'uppercase' }}>Candidato Conectado</span>
                          <span style={{ fontSize: '0.75rem', fontWeight: 'bold', color: 'hsl(var(--text-primary))' }}>{selectedAuditLog.model}</span>
                        </div>
                        <div>
                          <span style={{ fontSize: '0.6rem', color: 'hsl(var(--text-muted))', display: 'block', textTransform: 'uppercase' }}>Tiempo de Respuesta</span>
                          <span style={{ fontSize: '0.75rem', fontWeight: 'bold', color: 'hsl(var(--text-primary))' }}>{selectedAuditLog.durationMs} ms</span>
                        </div>
                        <div style={{ gridColumn: 'span 2' }}>
                          <span style={{ fontSize: '0.6rem', color: 'hsl(var(--text-muted))', display: 'block', textTransform: 'uppercase' }}>Endpoint URL</span>
                          <span style={{ fontSize: '0.65rem', fontFamily: 'monospace', color: 'hsl(var(--text-muted))', wordBreak: 'break-all' }}>{selectedAuditLog.url}</span>
                        </div>
                      </div>

                      {/* System Prompt */}
                      {selectedAuditLog.systemPrompt && (
                        <div>
                          <h4 style={{ margin: '0 0 6px 0', fontSize: '0.7rem', fontWeight: 'bold', color: 'hsl(var(--text-secondary))', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                            Instrucción del Sistema (Inyectado en la API)
                          </h4>
                          <pre style={{
                            margin: 0,
                            padding: '12px',
                            background: 'hsl(var(--bg-tertiary))',
                            border: '1px solid hsl(var(--border-color))',
                            borderRadius: '6px',
                            fontSize: '0.7rem',
                            color: 'hsl(var(--text-muted))',
                            fontFamily: 'monospace',
                            whiteSpace: 'pre-wrap',
                            maxHeight: '160px',
                            overflowY: 'auto'
                          }}>
                            {selectedAuditLog.systemPrompt}
                          </pre>
                        </div>
                      )}

                      {/* Messages Historial */}
                      <div>
                        <h4 style={{ margin: '0 0 6px 0', fontSize: '0.7rem', fontWeight: 'bold', color: 'hsl(var(--text-secondary))', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                          Historial de Mensajes Enviados
                        </h4>
                        <div style={{
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '8px',
                          maxHeight: '200px',
                          overflowY: 'auto',
                          border: '1px solid hsl(var(--border-color))',
                          borderRadius: '6px',
                          padding: '12px',
                          background: 'hsla(var(--bg-secondary-hsl), 0.2)'
                        }}>
                          {selectedAuditLog.messages.map((m: any, idx: number) => {
                            const isUser = m.role === 'user';
                            return (
                              <div key={idx} style={{
                                padding: '8px 12px',
                                borderRadius: '4px',
                                background: isUser ? 'hsla(var(--primary-neon-hsl), 0.05)' : 'hsla(255,255,255,0.02)',
                                borderLeft: `3px solid ${isUser ? 'hsl(var(--primary-neon))' : 'hsl(var(--text-muted))'}`
                              }}>
                                <span style={{ fontSize: '0.6rem', color: isUser ? 'hsl(var(--primary-neon))' : 'hsl(var(--text-muted))', fontWeight: 'bold', display: 'block', textTransform: 'uppercase', marginBottom: '2px' }}>
                                  {isUser ? 'Usuario' : 'Asistente'}
                                </span>
                                <span style={{ fontSize: '0.7rem', color: 'hsl(var(--text-primary))', whiteSpace: 'pre-wrap' }}>
                                  {typeof m.content === 'string' ? m.content : '[Mensaje estructurado con imágenes/herramientas]'}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      </div>

                      {/* Response / Error */}
                      <div>
                        <h4 style={{ margin: '0 0 6px 0', fontSize: '0.7rem', fontWeight: 'bold', color: 'hsl(var(--text-secondary))', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                          {selectedAuditLog.error ? 'Error Recibido' : 'Respuesta del Agente'}
                        </h4>
                        {selectedAuditLog.error ? (
                          <div style={{
                            padding: '12px',
                            background: 'rgba(255,0,0,0.05)',
                            border: '1px solid hsl(var(--danger))',
                            borderRadius: '6px',
                            color: 'hsl(var(--danger))',
                            fontSize: '0.7rem',
                            fontWeight: 'bold',
                            fontFamily: 'monospace'
                          }}>
                            {selectedAuditLog.error}
                          </div>
                        ) : (
                          <pre style={{
                            margin: 0,
                            padding: '12px',
                            background: 'hsla(var(--accent-primary-hsl), 0.02)',
                            border: '1px solid hsla(var(--accent-primary-hsl), 0.3)',
                            borderRadius: '6px',
                            fontSize: '0.7rem',
                            color: 'hsl(var(--text-primary))',
                            fontFamily: 'monospace',
                            whiteSpace: 'pre-wrap',
                            maxHeight: '200px',
                            overflowY: 'auto'
                          }}>
                            {typeof selectedAuditLog.response === 'object'
                              ? JSON.stringify(selectedAuditLog.response, null, 2)
                              : selectedAuditLog.response}
                          </pre>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="flex-center" style={{ flex: 1, flexDirection: 'column', gap: '8px', color: 'hsl(var(--text-muted))' }}>
                      <Terminal size={48} style={{ opacity: 0.1 }} />
                      <span style={{ fontSize: '0.8rem' }}>Selecciona una llamada del listado para ver su auditoría</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Footer */}
              <div style={{
                padding: '12px 20px',
                borderTop: '1px solid hsl(var(--border-color))',
                background: 'hsla(var(--bg-tertiary), 0.6)',
                display: 'flex',
                justifyContent: 'flex-end'
              }}>
                <button
                  onClick={() => setIsAuditModalOpen(false)}
                  className="btn btn-secondary"
                  style={{ padding: '6px 16px', fontSize: '0.75rem', height: 'auto' }}
                >
                  Cerrar
                </button>
              </div>
            </div>
          </div>
        )}

        {/* MODAL DE CONFIGURACIÓN Y MEMORIA DEL AGENTE IA */}
        <AgentConfigModal
          isOpen={isAgentConfigOpen}
          onClose={() => setIsAgentConfigOpen(false)}
          project={activeProject || null}
          updateProject={updateProject}
          globalGeminiKey={globalGeminiKey}
          setGlobalGeminiKey={setGlobalGeminiKey}
        />
      </main>
    </div>
  );
}

export default App;
