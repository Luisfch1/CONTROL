import React, { useState, useEffect } from 'react';
import { Bot, X, Key, Cpu, Layers, Eye, Save, Search, ArrowLeft, ChevronLeft, ChevronRight, CornerDownRight, ExternalLink } from 'lucide-react';
import type { Project } from '../types/projectTypes';
import { buildProjectSystemInstruction } from '../services/aiContextBuilder';
import { LOCAL_DEFAULT_SKILLS } from '../services/defaultSkills';

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
  const [selectedDb, setSelectedDb] = useState<string | null>(null);
  const [dbSearchQuery, setDbSearchQuery] = useState('');
  const [dbPage, setDbPage] = useState(1);
  const [expandedRowId, setExpandedRowId] = useState<string | null>(null);

  // Estados para el editor de Habilidades (.md)
  const [selectedSkill, setSelectedSkill] = useState<string | null>(null);
  const [skillContent, setSkillContent] = useState('');
  const [isReadingSkill, setIsReadingSkill] = useState(false);
  const [isSavingSkill, setIsSavingSkill] = useState(false);
  const [saveSkillSuccess, setSaveSkillSuccess] = useState(false);

  // Resetear la selección al cerrar/abrir
  useEffect(() => {
    if (!isOpen) {
      setSelectedSkill(null);
    }
  }, [isOpen]);

  // Cargar contenido de la habilidad (.md)
  useEffect(() => {
    if (selectedSkill && project) {
      setIsReadingSkill(true);
      const loadSkill = async () => {
        try {
          if ((window as any).electronAPI && typeof (window as any).electronAPI.readSkillFile === 'function') {
            const content = await (window as any).electronAPI.readSkillFile(project.id, selectedSkill);
            setSkillContent(content || '');
          } else {
            const localKey = `lch-skill-${project.id}-${selectedSkill}`;
            let saved = localStorage.getItem(localKey);
            
            // Migración al vuelo para el modal también:
            if (selectedSkill === 'generate_executive_report' && saved && (saved.includes('excel') || saved.includes('Excel') || saved.includes('formato Excel') || !saved.includes('word'))) {
              console.log(`[Migration Modal] Reseteando regla de reporte ejecutivo obsoleta (Excel) a Word.`);
              saved = LOCAL_DEFAULT_SKILLS[selectedSkill];
              localStorage.setItem(localKey, saved);
            }
            
            if (saved) {
              setSkillContent(saved);
            } else {
              const defaultContent = LOCAL_DEFAULT_SKILLS[selectedSkill] || `# Habilidad: ${selectedSkill}\n\nEscribe aquí las reglas.`;
              setSkillContent(defaultContent);
            }
          }
        } catch (e) {
          console.error("Error reading skill file:", e);
        } finally {
          setIsReadingSkill(false);
        }
      };
      loadSkill();
    }
  }, [selectedSkill, project]);

  const handleSaveSkill = async () => {
    if (!project || !selectedSkill) return;
    setIsSavingSkill(true);
    setSaveSkillSuccess(false);
    try {
      if ((window as any).electronAPI && typeof (window as any).electronAPI.saveSkillFile === 'function') {
        await (window as any).electronAPI.saveSkillFile(project.id, selectedSkill, skillContent);
      } else {
        const localKey = `lch-skill-${project.id}-${selectedSkill}`;
        localStorage.setItem(localKey, skillContent);
      }
      setSaveSkillSuccess(true);
      setTimeout(() => setSaveSkillSuccess(false), 2500);
    } catch (e) {
      console.error("Error saving skill file:", e);
      alert("No se pudo guardar la habilidad en el disco.");
    } finally {
      setIsSavingSkill(false);
    }
  };

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
  const providersCount = Array.from(new Set(project?.costTransactions?.map(t => t.provider).filter(Boolean))).length;

  // --- BASE DE DATOS DE MEMORIA: PARSING, FILTRADO Y PAGINACIÓN ---
  let rawRecords: any[] = [];
  if (project) {
    switch (selectedDb) {
      case 'budget': {
        const activeVersion = project.budgetVersions?.find(v => v.id === project.activeBudgetVersionId) || project.budgetVersions?.[0];
        rawRecords = activeVersion ? activeVersion.items : project.budgetItems || [];
        break;
      }
      case 'versions':
        rawRecords = project.budgetVersions || [];
        break;
      case 'progress':
        rawRecords = project.progressReports || [];
        break;
      case 'partials':
        rawRecords = project.partialReports || [];
        break;
      case 'photos':
        rawRecords = project.logiEntries || [];
        break;
      case 'photoReports':
        rawRecords = project.photoReports || [];
        break;
      case 'todos':
        rawRecords = project.agentTodos || [];
        break;
      case 'correspondence':
        rawRecords = project.correspondenceFiles || [];
        break;
      case 'apus':
        rawRecords = project.activityAPUs || [];
        break;
      case 'resources':
        rawRecords = project.costResources || [];
        break;
      case 'transactions':
        rawRecords = project.costTransactions || [];
        break;
      case 'providers': {
        const txs = project.costTransactions || [];
        const providerMap = new Map<string, { name: string; totalAmount: number; count: number; lastDate: string; items: Set<string> }>();
        txs.forEach(t => {
          if (!t.provider) return;
          const name = t.provider.trim();
          const existing = providerMap.get(name) || { name, totalAmount: 0, count: 0, lastDate: '', items: new Set<string>() };
          existing.totalAmount += t.totalPrice || 0;
          existing.count += 1;
          if (!existing.lastDate || t.date > existing.lastDate) {
            existing.lastDate = t.date;
          }
          if (t.itemCode) {
            existing.items.add(t.itemCode);
          }
          providerMap.set(name, existing);
        });
        rawRecords = Array.from(providerMap.values()).map(p => ({
          id: p.name,
          name: p.name,
          totalAmount: p.totalAmount,
          count: p.count,
          lastDate: p.lastDate,
          items: Array.from(p.items).join(', ')
        }));
        break;
      }
      case 'gmail':
        rawRecords = project.gmailEmails || [];
        break;
    }
  }

  const query = dbSearchQuery.toLowerCase().trim();
  const filteredRecords = rawRecords.filter(rec => {
    if (!query) return true;
    switch (selectedDb) {
      case 'budget':
        return (
          String(rec.item || '').toLowerCase().includes(query) ||
          String(rec.descripcion || '').toLowerCase().includes(query) ||
          String(rec.unidad || '').toLowerCase().includes(query)
        );
      case 'versions':
        return (
          String(rec.id || '').toLowerCase().includes(query) ||
          String(rec.name || '').toLowerCase().includes(query)
        );
      case 'progress':
        return (
          String(rec.id || '').toLowerCase().includes(query) ||
          String(rec.name || '').toLowerCase().includes(query) ||
          String(rec.date || '').toLowerCase().includes(query)
        );
      case 'partials':
        return (
          String(rec.id || '').toLowerCase().includes(query) ||
          String(rec.name || '').toLowerCase().includes(query) ||
          String(rec.date || '').toLowerCase().includes(query)
        );
      case 'photos':
        return (
          String(rec.itemCode || '').toLowerCase().includes(query) ||
          String(rec.description || '').toLowerCase().includes(query) ||
          String(rec.date || '').toLowerCase().includes(query)
        );
      case 'photoReports':
        return (
          String(rec.name || '').toLowerCase().includes(query) ||
          String(rec.itemFilter || '').toLowerCase().includes(query) ||
          String(rec.textFilter || '').toLowerCase().includes(query)
        );
      case 'todos':
        return (
          String(rec.text || '').toLowerCase().includes(query) ||
          String(rec.createdAt || '').toLowerCase().includes(query)
        );
      case 'correspondence':
        return (
          String(rec.name || '').toLowerCase().includes(query) ||
          String(rec.metadata?.sender || '').toLowerCase().includes(query) ||
          String(rec.metadata?.receiver || '').toLowerCase().includes(query) ||
          String(rec.metadata?.subject || '').toLowerCase().includes(query) ||
          String(rec.metadata?.summary || '').toLowerCase().includes(query)
        );
      case 'apus':
        return (
          String(rec.itemCode || '').toLowerCase().includes(query) ||
          (project?.budgetItems?.find(i => i.item === rec.itemCode)?.descripcion || '').toLowerCase().includes(query)
        );
      case 'resources':
        return (
          String(rec.code || '').toLowerCase().includes(query) ||
          String(rec.description || '').toLowerCase().includes(query) ||
          String(rec.type || '').toLowerCase().includes(query)
        );
      case 'transactions':
        return (
          String(rec.itemCode || '').toLowerCase().includes(query) ||
          String(rec.description || '').toLowerCase().includes(query) ||
          String(rec.provider || '').toLowerCase().includes(query) ||
          String(rec.invoiceNumber || '').toLowerCase().includes(query)
        );
      case 'providers':
        return (
          String(rec.name || '').toLowerCase().includes(query) ||
          String(rec.items || '').toLowerCase().includes(query)
        );
      case 'gmail':
        return (
          String(rec.sender || '').toLowerCase().includes(query) ||
          String(rec.receiver || '').toLowerCase().includes(query) ||
          String(rec.subject || '').toLowerCase().includes(query) ||
          String(rec.bodySnippet || '').toLowerCase().includes(query)
        );
      default:
        return false;
    }
  });

  // We render the full list in a single scrollable container instead of pagination
  const paginatedRecords = filteredRecords;

  const formatCurrency = (val: number) => {
    return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', minimumFractionDigits: 0 }).format(val);
  };

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return '-';
    try {
      const parts = dateStr.split('T')[0].split('-');
      if (parts.length === 3) {
        return `${parts[2]}/${parts[1]}/${parts[0]}`;
      }
      return new Date(dateStr).toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric' });
    } catch {
      return dateStr;
    }
  };

  const handleRowClick = (dbKey: string, rec: any) => {
    if (['progress', 'partials', 'apus'].includes(dbKey)) {
      const id = rec.id || rec.itemCode || rec.item;
      setExpandedRowId(prev => prev === id ? null : id);
    }
  };

  const renderTableHeaders = (dbKey: string) => {
    const thStyle = {
      padding: '10px 12px',
      borderBottom: '1px solid var(--border-color)',
      color: 'hsl(var(--text-primary))',
      fontWeight: 'bold',
      position: 'sticky' as const,
      top: 0,
      zIndex: 10,
      background: 'hsl(var(--bg-secondary))'
    };
    const thRightStyle = { ...thStyle, textAlign: 'right' as const };
    switch (dbKey) {
      case 'budget':
        return (
          <>
            <th style={{ ...thStyle, width: '90px' }}>Ítem</th>
            <th style={{ ...thStyle, width: '100px' }}>Tipo</th>
            <th style={thStyle}>Descripción</th>
            <th style={{ ...thStyle, width: '60px' }}>Unidad</th>
            <th style={{ ...thRightStyle, width: '90px' }}>Cantidad</th>
            <th style={{ ...thRightStyle, width: '110px' }}>Valor Unit.</th>
            <th style={{ ...thRightStyle, width: '120px' }}>Valor Total</th>
          </>
        );
      case 'versions':
        return (
          <>
            <th style={thStyle}>Nombre Escenario</th>
            <th style={thStyle}>ID Versión</th>
            <th style={thStyle}>Fecha de Creación</th>
            <th style={{ ...thRightStyle, width: '110px' }}>Nº Actividades</th>
          </>
        );
      case 'apus':
        return (
          <>
            <th style={{ ...thStyle, width: '100px' }}>Ítem</th>
            <th style={thStyle}>Descripción de Actividad</th>
            <th style={{ ...thRightStyle, width: '150px' }}>Costo Directo APU</th>
            <th style={{ ...thStyle, width: '220px' }}>Estructura de Recursos</th>
            <th style={{ ...thStyle, width: '90px' }}>Detalles</th>
          </>
        );
      case 'resources':
        return (
          <>
            <th style={{ ...thStyle, width: '100px' }}>Código</th>
            <th style={thStyle}>Descripción de Insumo</th>
            <th style={{ ...thStyle, width: '110px' }}>Tipo</th>
            <th style={{ ...thStyle, width: '70px' }}>Unidad</th>
            <th style={{ ...thRightStyle, width: '130px' }}>Precio Referencia</th>
          </>
        );
      case 'transactions':
        return (
          <>
            <th style={{ ...thStyle, width: '90px' }}>Fecha</th>
            <th style={{ ...thStyle, width: '80px' }}>Ítem</th>
            <th style={{ ...thStyle, width: '90px' }}>Tipo Insumo</th>
            <th style={thStyle}>Descripción de Gasto</th>
            <th style={{ ...thRightStyle, width: '70px' }}>Cant.</th>
            <th style={{ ...thRightStyle, width: '100px' }}>Vlr. Unit</th>
            <th style={{ ...thRightStyle, width: '110px' }}>Total Real</th>
            <th style={thStyle}>Proveedor</th>
            <th style={{ ...thStyle, width: '90px' }}>Factura</th>
          </>
        );
      case 'providers':
        return (
          <>
            <th style={thStyle}>Nombre de Proveedor</th>
            <th style={{ ...thRightStyle, width: '150px' }}>Compras Acumuladas</th>
            <th style={{ ...thRightStyle, width: '130px' }}>Nº Compras</th>
            <th style={{ ...thStyle, width: '140px' }}>Última Operación</th>
            <th style={thStyle}>Actividades Vinculadas</th>
          </>
        );
      case 'progress':
        return (
          <>
            <th style={thStyle}>Nombre del Reporte</th>
            <th style={{ ...thStyle, width: '120px' }}>Fecha de Corte</th>
            <th style={{ ...thRightStyle, width: '140px' }}>Ítems Reportados</th>
            <th style={{ ...thStyle, width: '100px' }}>Detalles</th>
          </>
        );
      case 'partials':
        return (
          <>
            <th style={thStyle}>Nombre de Acta</th>
            <th style={{ ...thStyle, width: '120px' }}>Fecha</th>
            <th style={{ ...thRightStyle, width: '120px' }}>Nº Entradas</th>
            <th style={{ ...thRightStyle, width: '160px' }}>Valor Total Acta</th>
            <th style={{ ...thStyle, width: '100px' }}>Detalles</th>
          </>
        );
      case 'photos':
        return (
          <>
            <th style={{ ...thStyle, width: '50px' }}>Foto</th>
            <th style={{ ...thStyle, width: '90px' }}>Fecha</th>
            <th style={{ ...thStyle, width: '80px' }}>Ítem</th>
            <th style={thStyle}>Descripción Técnica en Campo</th>
            <th style={{ ...thStyle, width: '90px' }}>Estado</th>
            <th style={thStyle}>Sugerencia IA</th>
          </>
        );
      case 'photoReports':
        return (
          <>
            <th style={thStyle}>Nombre de Informe</th>
            <th style={{ ...thStyle, width: '100px' }}>Creado el</th>
            <th style={thStyle}>Filtros Aplicados</th>
            <th style={{ ...thRightStyle, width: '130px' }}>Fotos Incluidas</th>
          </>
        );
      case 'todos':
        return (
          <>
            <th style={thStyle}>Tarea / Compromiso Pendiente</th>
            <th style={{ ...thStyle, width: '120px' }}>Fecha de Registro</th>
            <th style={{ ...thStyle, width: '120px' }}>Fecha Cierre</th>
            <th style={{ ...thStyle, width: '100px' }}>Estado</th>
          </>
        );
      case 'correspondence':
        return (
          <>
            <th style={thStyle}>Nombre de Archivo / Documento</th>
            <th style={{ ...thStyle, width: '100px' }}>Fecha Oficio</th>
            <th style={{ ...thStyle, width: '160px' }}>Remitente → Destinatario</th>
            <th style={thStyle}>Asunto</th>
            <th style={thStyle}>Resumen Ejecutivo IA</th>
            <th style={{ ...thStyle, width: '90px' }}>Seguimiento</th>
          </>
        );
      case 'gmail':
        return (
          <>
            <th style={{ ...thStyle, width: '120px' }}>Fecha/Hora</th>
            <th style={{ ...thStyle, width: '70px' }}>Tipo</th>
            <th style={{ ...thStyle, width: '150px' }}>Remitente</th>
            <th style={{ ...thStyle, width: '150px' }}>Destinatario</th>
            <th style={thStyle}>Asunto del Correo</th>
            <th style={{ ...thStyle, width: '90px' }}>Categoría</th>
            <th style={thStyle}>Cuerpo/Snippet</th>
          </>
        );
      default:
        return null;
    }
  };

  const renderTableRowCells = (dbKey: string, rec: any, index: number) => {
    const tdStyle = { padding: '8px 12px', whiteSpace: 'nowrap' as const, overflow: 'hidden', textOverflow: 'ellipsis' };
    const tdWrapStyle = { ...tdStyle, whiteSpace: 'normal' as const };
    const tdRightStyle = { ...tdStyle, textAlign: 'right' as const };
    
    switch (dbKey) {
      case 'budget':
        return (
          <>
            <td style={{ ...tdStyle, fontWeight: ['title', 'subtitle'].includes(rec.type) ? 'bold' : 'normal' }}>{rec.item}</td>
            <td style={tdStyle}>
              <span style={{
                fontSize: '0.55rem',
                padding: '2px 6px',
                borderRadius: '3px',
                background: rec.type === 'title' ? 'hsla(var(--primary-neon-hsl), 0.15)' : rec.type === 'subtitle' ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.03)',
                border: rec.type === 'title' ? '1px solid hsl(var(--primary-neon))' : '1px solid var(--border-color)',
                color: rec.type === 'title' ? 'hsl(var(--primary-neon))' : 'hsl(var(--text-muted))'
              }}>
                {rec.type === 'title' ? 'CAPÍTULO' : rec.type === 'subtitle' ? 'SUBCAPÍTULO' : 'ACTIVIDAD'}
              </span>
            </td>
            <td style={tdWrapStyle}>{rec.descripcion}</td>
            <td style={tdStyle}>{rec.type === 'item' ? rec.unidad : ''}</td>
            <td style={tdRightStyle}>{rec.type === 'item' ? rec.cantidad?.toLocaleString('es-CO') : ''}</td>
            <td style={tdRightStyle}>{rec.type === 'item' ? formatCurrency(rec.vlrUnitario) : ''}</td>
            <td style={{ ...tdRightStyle, color: rec.type === 'title' ? 'hsl(var(--primary-neon))' : 'hsl(var(--text-secondary))' }}>
              {formatCurrency(rec.vlrTotal)}
            </td>
          </>
        );
      case 'versions':
        return (
          <>
            <td style={{ ...tdStyle, fontWeight: 'bold' }}>{rec.name}</td>
            <td style={{ ...tdStyle, fontFamily: 'monospace' }}>{rec.id}</td>
            <td style={tdStyle}>{formatDate(rec.createdAt)}</td>
            <td style={tdRightStyle}>{rec.items?.filter((i: any) => i.type === 'item')?.length || 0}</td>
          </>
        );
      case 'apus': {
        const matCount = rec.materials?.length || 0;
        const labCount = rec.labor?.length || 0;
        const equCount = rec.equipment?.length || 0;
        const traCount = rec.transport?.length || 0;
        
        const matTotal = rec.materials?.reduce((sum: number, r: any) => sum + (r.total || 0), 0) || 0;
        const labTotal = rec.labor?.reduce((sum: number, r: any) => sum + (r.total || 0), 0) || 0;
        const equTotal = rec.equipment?.reduce((sum: number, r: any) => sum + (r.total || 0), 0) || 0;
        const traTotal = rec.transport?.reduce((sum: number, r: any) => sum + (r.total || 0), 0) || 0;
        const apuTotal = matTotal + labTotal + equTotal + traTotal;
        
        const description = project?.budgetItems?.find(i => i.item === rec.itemCode)?.descripcion || 'Actividad del Contrato';
        
        return (
          <>
            <td style={{ ...tdStyle, fontWeight: 'bold' }}>{rec.itemCode}</td>
            <td style={tdWrapStyle}>{description}</td>
            <td style={{ ...tdRightStyle, color: 'hsl(var(--primary-neon))', fontWeight: 'bold' }}>{formatCurrency(apuTotal)}</td>
            <td style={tdStyle}>
              <span style={{ fontSize: '0.6rem', color: 'hsl(var(--text-muted))' }}>
                Mat: <strong style={{ color: '#fff' }}>{matCount}</strong> | 
                Mano: <strong style={{ color: '#fff' }}>{labCount}</strong> | 
                Equ: <strong style={{ color: '#fff' }}>{equCount}</strong> | 
                Trans: <strong style={{ color: '#fff' }}>{traCount}</strong>
              </span>
            </td>
            <td style={tdStyle}>
              <span style={{ color: 'hsl(var(--primary-neon))', fontSize: '0.65rem' }}>
                {expandedRowId === rec.itemCode ? 'Ocultar ▲' : 'Detalles ▼'}
              </span>
            </td>
          </>
        );
      }
      case 'resources':
        return (
          <>
            <td style={{ ...tdStyle, fontFamily: 'monospace', fontWeight: 'bold' }}>{rec.code}</td>
            <td style={tdWrapStyle}>{rec.description}</td>
            <td style={tdStyle}>
              <span style={{
                fontSize: '0.55rem',
                padding: '2px 5px',
                borderRadius: '3px',
                background: rec.type === 'material' ? 'rgba(59, 130, 246, 0.15)' : rec.type === 'labor' ? 'rgba(16, 185, 129, 0.15)' : rec.type === 'equipment' ? 'rgba(168, 85, 247, 0.15)' : 'rgba(255,255,255,0.05)',
                color: rec.type === 'material' ? '#60a5fa' : rec.type === 'labor' ? '#34d399' : rec.type === 'equipment' ? '#c084fc' : '#a3a3a3',
                border: '1px solid currentColor'
              }}>
                {String(rec.type).toUpperCase()}
              </span>
            </td>
            <td style={tdStyle}>{rec.unit}</td>
            <td style={{ ...tdRightStyle, color: 'hsl(var(--text-primary))' }}>{formatCurrency(rec.referencePrice)}</td>
          </>
        );
      case 'transactions':
        return (
          <>
            <td style={tdStyle}>{formatDate(rec.date)}</td>
            <td style={{ ...tdStyle, fontWeight: 'bold' }}>{rec.itemCode}</td>
            <td style={tdStyle}>
              <span style={{
                fontSize: '0.55rem',
                textTransform: 'uppercase',
                color: rec.resourceType === 'material' ? '#60a5fa' : rec.resourceType === 'labor' ? '#34d399' : '#a3a3a3'
              }}>
                {rec.resourceType}
              </span>
            </td>
            <td style={tdWrapStyle}>{rec.description}</td>
            <td style={tdRightStyle}>{rec.quantity}</td>
            <td style={tdRightStyle}>{formatCurrency(rec.unitPrice)}</td>
            <td style={{ ...tdRightStyle, fontWeight: 'bold', color: 'hsl(var(--text-primary))' }}>{formatCurrency(rec.totalPrice)}</td>
            <td style={tdStyle}>{rec.provider || '-'}</td>
            <td style={{ ...tdStyle, fontFamily: 'monospace' }}>{rec.invoiceNumber || '-'}</td>
          </>
        );
      case 'providers':
        return (
          <>
            <td style={{ ...tdStyle, fontWeight: 'bold' }}>{rec.name}</td>
            <td style={{ ...tdRightStyle, color: 'hsl(var(--primary-neon))', fontWeight: 'bold' }}>{formatCurrency(rec.totalAmount)}</td>
            <td style={tdRightStyle}>{rec.count}</td>
            <td style={tdStyle}>{formatDate(rec.lastDate)}</td>
            <td style={tdWrapStyle}>{rec.items || '-'}</td>
          </>
        );
      case 'progress':
        return (
          <>
            <td style={{ ...tdStyle, fontWeight: 'bold' }}>{rec.name}</td>
            <td style={tdStyle}>{formatDate(rec.date)}</td>
            <td style={tdRightStyle}>{rec.entries?.length || 0} actividades</td>
            <td style={tdStyle}>
              <span style={{ color: 'hsl(var(--primary-neon))', fontSize: '0.65rem' }}>
                {expandedRowId === rec.id ? 'Ocultar ▲' : 'Ver Detalle ▼'}
              </span>
            </td>
          </>
        );
      case 'partials': {
        const totalActa = rec.entries?.reduce((sum: number, entry: any) => sum + (entry.partialValue || 0), 0) || 0;
        return (
          <>
            <td style={{ ...tdStyle, fontWeight: 'bold' }}>{rec.name}</td>
            <td style={tdStyle}>{formatDate(rec.date)}</td>
            <td style={tdRightStyle}>{rec.entries?.length || 0} registros</td>
            <td style={{ ...tdRightStyle, color: 'hsl(var(--primary-neon))', fontWeight: 'bold' }}>{formatCurrency(totalActa)}</td>
            <td style={tdStyle}>
              <span style={{ color: 'hsl(var(--primary-neon))', fontSize: '0.65rem' }}>
                {expandedRowId === rec.id ? 'Ocultar ▲' : 'Ver Detalle ▼'}
              </span>
            </td>
          </>
        );
      }
      case 'photos':
        return (
          <>
            <td style={tdStyle}>
              <img 
                src={rec.imageUrl} 
                alt="Miniatura" 
                style={{
                  width: '32px',
                  height: '32px',
                  objectFit: 'cover',
                  borderRadius: '3px',
                  border: '1px solid var(--border-color)',
                  cursor: 'zoom-in',
                  transition: 'transform 0.15s ease'
                }} 
                onClick={(e) => {
                  e.stopPropagation();
                  const w = window.open();
                  if (w) w.document.write(`<img src="${rec.imageUrl}" style="max-width:100%; max-height:100%; display:block; margin:auto;" />`);
                }}
                onMouseEnter={(e) => { e.currentTarget.style.transform = 'scale(1.3)'; e.currentTarget.style.zIndex = '50'; }}
                onMouseLeave={(e) => { e.currentTarget.style.transform = 'scale(1.0)'; }}
              />
            </td>
            <td style={tdStyle}>{formatDate(rec.date)}</td>
            <td style={{ ...tdStyle, fontWeight: 'bold' }}>{rec.itemCode || 'S/N'}</td>
            <td style={tdWrapStyle}>{rec.description || 'Sin descripción técnica'}</td>
            <td style={tdStyle}>
              <span style={{
                fontSize: '0.55rem',
                padding: '2px 5px',
                borderRadius: '3px',
                background: rec.status === 'integrated' ? 'rgba(16, 185, 129, 0.15)' : 'rgba(249, 115, 22, 0.15)',
                color: rec.status === 'integrated' ? '#34d399' : '#f97316',
                border: '1px solid currentColor'
              }}>
                {rec.status === 'integrated' ? 'INTEGRADA' : 'PENDIENTE'}
              </span>
            </td>
            <td style={tdWrapStyle}>
              {rec.aiProposal ? (
                <span style={{ fontSize: '0.65rem', color: 'hsl(var(--primary-neon))' }}>
                  Sugerencia: <strong>{rec.aiProposal.itemCode}</strong> - {rec.aiProposal.description}
                </span>
              ) : '-'}
            </td>
          </>
        );
      case 'photoReports':
        return (
          <>
            <td style={{ ...tdStyle, fontWeight: 'bold' }}>{rec.name}</td>
            <td style={tdStyle}>{formatDate(rec.createdAt)}</td>
            <td style={tdWrapStyle}>
              <span style={{ fontSize: '0.65rem', color: 'hsl(var(--text-muted))' }}>
                {rec.dateFrom || rec.dateTo ? `F. ${rec.dateFrom || ''} a ${rec.dateTo || ''} | ` : ''}
                {rec.itemFilter ? `Ítem: ${rec.itemFilter} | ` : ''}
                {rec.textFilter ? `Txt: "${rec.textFilter}"` : ''}
                {!rec.dateFrom && !rec.dateTo && !rec.itemFilter && !rec.textFilter ? 'General (Sin Filtros)' : ''}
              </span>
            </td>
            <td style={tdRightStyle}>{rec.photoIds?.length || 0} fotos</td>
          </>
        );
      case 'todos':
        return (
          <>
            <td style={{ ...tdWrapStyle, textDecoration: rec.completed ? 'line-through' : 'none', color: rec.completed ? 'hsl(var(--text-muted))' : 'hsl(var(--text-secondary))' }}>
              {rec.text}
            </td>
            <td style={tdStyle}>{formatDate(rec.createdAt)}</td>
            <td style={tdStyle}>{rec.completedAt ? formatDate(rec.completedAt) : '-'}</td>
            <td style={tdStyle}>
              <span style={{
                fontSize: '0.55rem',
                padding: '2px 5px',
                borderRadius: '3px',
                background: rec.completed ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                color: rec.completed ? '#34d399' : '#f87171',
                border: '1px solid currentColor',
                fontWeight: 'bold'
              }}>
                {rec.completed ? 'COMPLETADO' : 'PENDIENTE'}
              </span>
            </td>
          </>
        );
      case 'correspondence':
        return (
          <>
            <td style={{ ...tdStyle, fontWeight: 'bold', color: '#fff' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                📄 {rec.name}
              </span>
            </td>
            <td style={tdStyle}>{rec.metadata?.date ? formatDate(rec.metadata.date) : formatDate(rec.uploadDate)}</td>
            <td style={tdWrapStyle}>
              <span style={{ fontSize: '0.65rem', color: 'hsl(var(--text-muted))' }}>De: </span>{rec.metadata?.sender || '-'}<br />
              <span style={{ fontSize: '0.65rem', color: 'hsl(var(--text-muted))' }}>Para: </span>{rec.metadata?.receiver || '-'}
            </td>
            <td style={tdWrapStyle}>{rec.metadata?.subject || 'Sin Asunto'}</td>
            <td style={tdWrapStyle}>{rec.metadata?.summary || 'No procesado por IA'}</td>
            <td style={tdStyle}>
              <span style={{
                fontSize: '0.55rem',
                padding: '2px 5px',
                borderRadius: '3px',
                background: rec.metadata?.status === 'answered' ? 'rgba(16, 185, 129, 0.15)' : rec.metadata?.status === 'pending' ? 'rgba(234, 179, 8, 0.15)' : 'rgba(255,255,255,0.05)',
                color: rec.metadata?.status === 'answered' ? '#34d399' : rec.metadata?.status === 'pending' ? '#facc15' : '#a3a3a3',
                border: '1px solid currentColor'
              }}>
                {rec.metadata?.status === 'answered' ? 'CONTESTADO' : rec.metadata?.status === 'pending' ? 'PENDIENTE SEGUIM.' : 'SIN ACCIÓN'}
              </span>
            </td>
          </>
        );
      case 'gmail':
        return (
          <>
            <td style={tdStyle}>{formatDate(rec.date)}</td>
            <td style={tdStyle}>
              <span style={{ fontSize: '0.55rem', color: rec.direction === 'inbound' ? '#60a5fa' : '#34d399' }}>
                {rec.direction === 'inbound' ? 'ENTRANTE 📥' : 'SALIENTE 📤'}
              </span>
            </td>
            <td style={tdStyle}>{rec.sender}</td>
            <td style={tdStyle}>{rec.receiver}</td>
            <td style={{ ...tdWrapStyle, fontWeight: 'bold' }}>{rec.subject}</td>
            <td style={tdStyle}>
              <span style={{
                fontSize: '0.55rem',
                padding: '2px 4px',
                borderRadius: '3px',
                background: 'rgba(255,255,255,0.05)',
                color: 'hsl(var(--text-muted))',
                border: '1px solid var(--border-color)'
              }}>
                {rec.category?.toUpperCase() || 'GENERAL'}
              </span>
            </td>
            <td style={tdWrapStyle}>{rec.bodySnippet}</td>
          </>
        );
      default:
        return null;
    }
  };

  const renderExpandedDetails = (dbKey: string, rec: any) => {
    switch (dbKey) {
      case 'progress':
        return (
          <div style={{ padding: '8px 12px', background: 'hsla(var(--bg-secondary), 0.5)', border: '1px solid var(--border-color)', borderRadius: '4px' }}>
            <h5 style={{ margin: '0 0 8px 0', fontSize: '0.75rem', color: 'hsl(var(--primary-neon))', textTransform: 'uppercase', fontFamily: 'var(--font-technical)' }}>
              Detalle de Avances Reportados: {rec.name}
            </h5>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '8px' }}>
              {rec.entries?.map((entry: any, i: number) => {
                const bItem = project?.budgetItems?.find(item => item.item === entry.itemCode);
                return (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 8px', borderBottom: '1px solid rgba(255,255,255,0.04)', fontSize: '0.65rem' }}>
                    <span style={{ color: 'hsl(var(--text-primary))', fontFamily: 'monospace', fontWeight: 'bold', width: '50px' }}>{entry.itemCode}</span>
                    <span style={{ color: 'hsl(var(--text-secondary))', flex: 1, paddingLeft: '8px', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                      {bItem?.descripcion || 'Actividad Contractual'}
                    </span>
                    <span style={{ color: 'hsl(var(--primary-neon))', fontWeight: 'bold', paddingLeft: '8px' }}>
                      {entry.accumulatedQuantity?.toLocaleString('es-CO')} {bItem?.unidad}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        );
      case 'partials':
        return (
          <div style={{ padding: '8px 12px', background: 'hsla(var(--bg-secondary), 0.5)', border: '1px solid var(--border-color)', borderRadius: '4px' }}>
            <h5 style={{ margin: '0 0 8px 0', fontSize: '0.75rem', color: 'hsl(var(--primary-neon))', textTransform: 'uppercase', fontFamily: 'var(--font-technical)' }}>
              Detalle de Entradas de Acta Parcial: {rec.name}
            </h5>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.65rem' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border-color)', color: 'hsl(var(--text-primary))' }}>
                  <th style={{ padding: '4px', textAlign: 'left' }}>Código</th>
                  <th style={{ padding: '4px', textAlign: 'left' }}>Descripción</th>
                  <th style={{ padding: '4px', textAlign: 'right' }}>Cant. Parcial</th>
                  <th style={{ padding: '4px', textAlign: 'right' }}>Valor Parcial</th>
                  <th style={{ padding: '4px', textAlign: 'right' }}>% Parcial</th>
                </tr>
              </thead>
              <tbody>
                {rec.entries?.map((entry: any, i: number) => {
                  const bItem = project?.budgetItems?.find(item => item.item === entry.itemCode);
                  return (
                    <tr key={i} style={{ borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                      <td style={{ padding: '4px', fontFamily: 'monospace', fontWeight: 'bold' }}>{entry.itemCode}</td>
                      <td style={{ padding: '4px', color: 'hsl(var(--text-secondary))' }}>{bItem?.descripcion || 'Actividad Contractual'}</td>
                      <td style={{ padding: '4px', textAlign: 'right' }}>{entry.partialQuantity?.toLocaleString('es-CO')} {bItem?.unidad}</td>
                      <td style={{ padding: '4px', textAlign: 'right', fontWeight: 'bold' }}>{formatCurrency(entry.partialValue)}</td>
                      <td style={{ padding: '4px', textAlign: 'right', color: 'hsl(var(--primary-neon))' }}>{entry.partialPercentage ? `${entry.partialPercentage.toFixed(2)}%` : '0.00%'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        );
      case 'apus':
        return (
          <div style={{ padding: '12px', background: 'hsla(var(--bg-secondary), 0.5)', border: '1px solid var(--border-color)', borderRadius: '4px' }}>
            <h5 style={{ margin: '0 0 10px 0', fontSize: '0.75rem', color: 'hsl(var(--primary-neon))', textTransform: 'uppercase', fontFamily: 'var(--font-technical)' }}>
              Análisis Unitario Desagregado (APU) - Código {rec.itemCode}
            </h5>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {rec.materials && rec.materials.length > 0 && (
                <div>
                  <h6 style={{ margin: '0 0 4px 0', fontSize: '0.65rem', color: '#60a5fa', textTransform: 'uppercase' }}>Materiales</h6>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.6rem' }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.08)', color: 'hsl(var(--text-primary))' }}>
                        <th style={{ padding: '3px', textAlign: 'left' }}>Descripción</th>
                        <th style={{ padding: '3px', textAlign: 'left', width: '60px' }}>Unidad</th>
                        <th style={{ padding: '3px', textAlign: 'right', width: '70px' }}>Cantidad</th>
                        <th style={{ padding: '3px', textAlign: 'right', width: '90px' }}>Precio Base</th>
                        <th style={{ padding: '3px', textAlign: 'right', width: '100px' }}>Subtotal</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rec.materials.map((r: any, idx: number) => (
                        <tr key={idx} style={{ borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                          <td style={{ padding: '3px' }}>{r.description}</td>
                          <td style={{ padding: '3px' }}>{r.unit}</td>
                          <td style={{ padding: '3px', textAlign: 'right' }}>{r.quantity}</td>
                          <td style={{ padding: '3px', textAlign: 'right' }}>{formatCurrency(r.price)}</td>
                          <td style={{ padding: '3px', textAlign: 'right', fontWeight: 'bold' }}>{formatCurrency(r.total)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {rec.labor && rec.labor.length > 0 && (
                <div>
                  <h6 style={{ margin: '0 0 4px 0', fontSize: '0.65rem', color: '#34d399', textTransform: 'uppercase' }}>Mano de Obra</h6>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.6rem' }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.08)', color: 'hsl(var(--text-primary))' }}>
                        <th style={{ padding: '3px', textAlign: 'left' }}>Descripción</th>
                        <th style={{ padding: '3px', textAlign: 'left', width: '60px' }}>Unidad</th>
                        <th style={{ padding: '3px', textAlign: 'right', width: '70px' }}>Cantidad</th>
                        <th style={{ padding: '3px', textAlign: 'right', width: '90px' }}>Precio Base</th>
                        <th style={{ padding: '3px', textAlign: 'right', width: '100px' }}>Subtotal</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rec.labor.map((r: any, idx: number) => (
                        <tr key={idx} style={{ borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                          <td style={{ padding: '3px' }}>{r.description}</td>
                          <td style={{ padding: '3px' }}>{r.unit}</td>
                          <td style={{ padding: '3px', textAlign: 'right' }}>{r.quantity}</td>
                          <td style={{ padding: '3px', textAlign: 'right' }}>{formatCurrency(r.price)}</td>
                          <td style={{ padding: '3px', textAlign: 'right', fontWeight: 'bold' }}>{formatCurrency(r.total)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {rec.equipment && rec.equipment.length > 0 && (
                <div>
                  <h6 style={{ margin: '0 0 4px 0', fontSize: '0.65rem', color: '#c084fc', textTransform: 'uppercase' }}>Equipo / Maquinaria</h6>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.6rem' }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.08)', color: 'hsl(var(--text-primary))' }}>
                        <th style={{ padding: '3px', textAlign: 'left' }}>Descripción</th>
                        <th style={{ padding: '3px', textAlign: 'left', width: '60px' }}>Unidad</th>
                        <th style={{ padding: '3px', textAlign: 'right', width: '70px' }}>Cantidad</th>
                        <th style={{ padding: '3px', textAlign: 'right', width: '90px' }}>Precio Base</th>
                        <th style={{ padding: '3px', textAlign: 'right', width: '100px' }}>Subtotal</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rec.equipment.map((r: any, idx: number) => (
                        <tr key={idx} style={{ borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                          <td style={{ padding: '3px' }}>{r.description}</td>
                          <td style={{ padding: '3px' }}>{r.unit}</td>
                          <td style={{ padding: '3px', textAlign: 'right' }}>{r.quantity}</td>
                          <td style={{ padding: '3px', textAlign: 'right' }}>{formatCurrency(r.price)}</td>
                          <td style={{ padding: '3px', textAlign: 'right', fontWeight: 'bold' }}>{formatCurrency(r.total)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {rec.transport && rec.transport.length > 0 && (
                <div>
                  <h6 style={{ margin: '0 0 4px 0', fontSize: '0.65rem', color: '#f59e0b', textTransform: 'uppercase' }}>Transporte / Acarreos</h6>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.6rem' }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.08)', color: 'hsl(var(--text-primary))' }}>
                        <th style={{ padding: '3px', textAlign: 'left' }}>Descripción</th>
                        <th style={{ padding: '3px', textAlign: 'left', width: '60px' }}>Unidad</th>
                        <th style={{ padding: '3px', textAlign: 'right', width: '70px' }}>Cantidad</th>
                        <th style={{ padding: '3px', textAlign: 'right', width: '90px' }}>Precio Base</th>
                        <th style={{ padding: '3px', textAlign: 'right', width: '100px' }}>Subtotal</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rec.transport.map((r: any, idx: number) => (
                        <tr key={idx} style={{ borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                          <td style={{ padding: '3px' }}>{r.description}</td>
                          <td style={{ padding: '3px' }}>{r.unit}</td>
                          <td style={{ padding: '3px', textAlign: 'right' }}>{r.quantity}</td>
                          <td style={{ padding: '3px', textAlign: 'right' }}>{formatCurrency(r.price)}</td>
                          <td style={{ padding: '3px', textAlign: 'right', fontWeight: 'bold' }}>{formatCurrency(r.total)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        );
      default:
        return null;
    }
  };

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
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', flex: 1, minHeight: 0 }}>
              {!selectedSkill ? (
                <>
                  <p style={{ fontSize: '0.75rem', color: 'hsl(var(--text-muted))', lineHeight: '1.4', marginBottom: '8px', maxWidth: '800px' }}>
                    El agente IA tiene habilitadas las siguientes habilidades/herramientas técnicas nativas de CONTROL. El modelo las invoca automáticamente cuando detecta la intención en tus mensajes. Haz clic en **VER / EDITAR REGLAS** en cualquier tarjeta para gestionar sus reglas de operación físicas en formato `.md`.
                  </p>

                  <div style={{ 
                    display: 'grid', 
                    gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', 
                    gap: '16px' 
                  }}>
                    <SkillCard 
                      name="generate_executive_report" 
                      title="Generación de Informe Ejecutivo" 
                      desc="Genera un informe ejecutivo consolidado a una fecha de corte, con avances físicos, financieros, gráficos y seguimiento de atrasos."
                      onEdit={() => setSelectedSkill('generate_executive_report')}
                    />
                    <SkillCard 
                      name="export_report_data" 
                      title="Exportación Tabular de Reportes" 
                      desc="Genera y exporta reportes de interventoría física y financiera de actividades a archivos físicos Word (.doc) y Excel (.xlsx)."
                      onEdit={() => setSelectedSkill('export_report_data')}
                    />
                    <SkillCard 
                      name="generate_photo_report" 
                      title="Generación de Informes Fotográficos" 
                      desc="Filtra y exporta las fotos de avance de campo a documentos Word (.doc) o archivos comprimidos (.zip) listos para reportar."
                      onEdit={() => setSelectedSkill('generate_photo_report')}
                    />
                    <SkillCard 
                      name="generate_progress_report" 
                      title="Registro e Informe de Avances" 
                      desc="Calcula acumulados y genera de forma automática reportes oficiales de progreso de obra con base en avances técnicos descritos por el usuario."
                      onEdit={() => setSelectedSkill('generate_progress_report')}
                    />
                    <SkillCard 
                      name="add_todo" 
                      title="Gestión de Pendientes (Creación)" 
                      desc="Detecta compromisos y pendientes nuevos para redactarlos y agregarlos al archivo físico PENDIENTES.md."
                      onEdit={() => setSelectedSkill('add_todo')}
                    />
                    <SkillCard 
                      name="delete_todo" 
                      title="Gestión de Pendientes (Cierre)" 
                      desc="Marca tareas como completadas o las elimina de PENDIENTES.md tras verificar tu confirmación conversacional."
                      onEdit={() => setSelectedSkill('delete_todo')}
                    />
                    <SkillCard 
                      name="generate_new_budget" 
                      title="Generación de Nuevo Presupuesto" 
                      desc="Analiza modificaciones presupuestales (adicionales, cantidades, precios) a partir de archivos subidos y genera una nueva versión o reporte comparativo."
                      onEdit={() => setSelectedSkill('generate_new_budget')}
                    />
                  </div>
                </>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', flex: 1, minHeight: 0 }}>
                  {/* Skill Editor Header */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--border-color)', paddingBottom: '12px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                      <button 
                        onClick={() => setSelectedSkill(null)}
                        className="btn btn-secondary"
                        style={{ padding: '6px 12px', fontSize: '0.7rem', height: 'auto', display: 'flex', alignItems: 'center', gap: '6px' }}
                      >
                        ← Volver
                      </button>
                      <div>
                        <h4 style={{ margin: 0, fontSize: '0.85rem', color: 'hsl(var(--text-primary))', fontFamily: 'var(--font-technical)', fontWeight: 'bold' }}>
                          Reglas de {SKILL_TITLES[selectedSkill] || selectedSkill}
                        </h4>
                        <span style={{ fontSize: '0.65rem', color: 'hsl(var(--primary-neon))', fontFamily: 'monospace' }}>
                          {selectedSkill}.md
                        </span>
                      </div>
                    </div>
                    
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                      {saveSkillSuccess && (
                        <span style={{ fontSize: '0.7rem', color: 'hsl(var(--primary-neon))', fontWeight: 'bold', animation: 'fadeIn 0.2s' }}>
                          ✓ ¡Habilidad guardada en disco!
                        </span>
                      )}
                      <button 
                        onClick={handleSaveSkill}
                        disabled={isSavingSkill}
                        className="btn btn-primary btn-pulse"
                        style={{ padding: '8px 20px', fontSize: '0.75rem', height: 'auto', display: 'flex', alignItems: 'center', gap: '8px' }}
                      >
                        <Save size={14} />
                        <span>{isSavingSkill ? 'Guardando...' : 'Guardar Habilidad (.md)'}</span>
                      </button>
                    </div>
                  </div>

                  {/* Split screen editor */}
                  <div style={{ display: 'flex', gap: '20px', flex: 1, minHeight: 0 }}>
                    {/* Left Panel: Markdown Textarea */}
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '8px', minHeight: 0 }}>
                      <span style={{ fontSize: '0.65rem', color: 'hsl(var(--text-muted))', fontWeight: 'bold', letterSpacing: '0.5px' }}>
                        EDITOR DE INSTRUCCIONES (MARKDOWN)
                      </span>
                      <textarea
                        value={skillContent}
                        onChange={(e) => setSkillContent(e.target.value)}
                        disabled={isReadingSkill}
                        style={{
                          flex: 1,
                          width: '100%',
                          background: 'hsl(var(--bg-primary))',
                          border: '1px solid var(--border-color)',
                          color: 'hsl(var(--text-primary))',
                          padding: '16px',
                          borderRadius: 'var(--radius-sm)',
                          fontSize: '0.8rem',
                          fontFamily: 'monospace',
                          resize: 'none',
                          outline: 'none',
                          lineHeight: '1.5',
                          transition: 'border-color 0.2s'
                        }}
                        onFocus={(e) => e.target.style.borderColor = 'hsl(var(--primary-neon))'}
                        onBlur={(e) => e.target.style.borderColor = 'var(--border-color)'}
                      />
                    </div>

                    {/* Right Panel: Rendered Markdown Preview */}
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '8px', minHeight: 0 }}>
                      <span style={{ fontSize: '0.65rem', color: 'hsl(var(--text-muted))', fontWeight: 'bold', letterSpacing: '0.5px' }}>
                        PREVISUALIZACIÓN DE REGLAS
                      </span>
                      <div 
                        style={{
                          flex: 1,
                          background: 'hsla(var(--bg-tertiary), 0.2)',
                          border: '1px solid var(--border-color)',
                          borderRadius: 'var(--radius-sm)',
                          padding: '20px',
                          overflowY: 'auto',
                          fontSize: '0.75rem',
                          color: 'hsl(var(--text-secondary))',
                          lineHeight: '1.6'
                        }}
                        dangerouslySetInnerHTML={{ __html: parseMarkdown(skillContent) }}
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* TAB 3: MEMORY */}
          {activeTab === 'memory' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', flex: 1, minHeight: 0 }}>
              {!selectedDb ? (
                // VIEW 1: Dashboard overview with 12 clickable cards
                <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', flex: 1, minHeight: 0 }}>
                  <div>
                    <h4 style={{ color: 'hsl(var(--text-primary))', fontSize: '0.85rem', fontFamily: 'var(--font-technical)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '4px' }}>
                      Bases de Datos de Memoria de Contexto
                    </h4>
                    <p style={{ fontSize: '0.75rem', color: 'hsl(var(--text-muted))', lineHeight: '1.4', marginBottom: '16px' }}>
                      El Agente IA de CONTROL utiliza un modelo de consulta bajo demanda. Haz clic en cualquiera de las siguientes 13 bases de datos para previsualizar sus registros, realizar búsquedas de texto y validar la información cargada.
                    </p>
                    
                    <div style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))',
                      gap: '16px',
                      marginBottom: '20px'
                    }}>
                      <DbCard 
                        label="Presupuesto Contractual" 
                        count={`${budgetCount} ítems`} 
                        emoji="💼" 
                        desc="Listado de capítulos, actividades, unidades y cantidades contractuales."
                        onClick={() => { setSelectedDb('budget'); setDbSearchQuery(''); setDbPage(1); setExpandedRowId(null); }}
                      />
                      <DbCard 
                        label="Versiones del Presupuesto" 
                        count={`${project?.budgetVersions?.length || 0} versiones`} 
                        emoji="🗃️" 
                        desc="Historial de escenarios presupuestales creados o importados por el agente."
                        onClick={() => { setSelectedDb('versions'); setDbSearchQuery(''); setDbPage(1); setExpandedRowId(null); }}
                      />
                      <DbCard 
                        label="APUs Actividades" 
                        count={`${apusCount} análisis`} 
                        emoji="📐" 
                        desc="Análisis de Precios Unitarios desagregados en materiales, mano de obra, equipos y transporte."
                        onClick={() => { setSelectedDb('apus'); setDbSearchQuery(''); setDbPage(1); setExpandedRowId(null); }}
                      />
                      <DbCard 
                        label="Catálogo de Insumos" 
                        count={`${resourcesCount} insumos`} 
                        emoji="🛠️" 
                        desc="Base de datos de recursos del proyecto con precios base de referencia."
                        onClick={() => { setSelectedDb('resources'); setDbSearchQuery(''); setDbPage(1); setExpandedRowId(null); }}
                      />
                      <DbCard 
                        label="Costos Reales / Egresos" 
                        count={`${transactionsCount} egresos`} 
                        emoji="💵" 
                        desc="Transacciones de gastos reales en campo agrupadas por proveedor y factura."
                        onClick={() => { setSelectedDb('transactions'); setDbSearchQuery(''); setDbPage(1); setExpandedRowId(null); }}
                      />
                      <DbCard 
                        label="Directorio de Proveedores" 
                        count={`${providersCount} proveedores`} 
                        emoji="🤝" 
                        desc="Directorio dinámico consolidado de contratistas y compras facturadas de obra."
                        onClick={() => { setSelectedDb('providers'); setDbSearchQuery(''); setDbPage(1); setExpandedRowId(null); }}
                      />
                      <DbCard 
                        label="Avances de Obra" 
                        count={`${reportsCount} reportes`} 
                        emoji="📈" 
                        desc="Cierres acumulados de cantidades de obra ejecutadas por ítem."
                        onClick={() => { setSelectedDb('progress'); setDbSearchQuery(''); setDbPage(1); setExpandedRowId(null); }}
                      />
                      <DbCard 
                        label="Actas Parciales (Cobro)" 
                        count={`${partialsCount} actas`} 
                        emoji="📊" 
                        desc="Actas parciales mensuales de cobro y avance financiero."
                        onClick={() => { setSelectedDb('partials'); setDbSearchQuery(''); setDbPage(1); setExpandedRowId(null); }}
                      />
                      <DbCard 
                        label="Registro de Fotos" 
                        count={`${photosCount} imágenes`} 
                        emoji="📷" 
                        desc="Evidencias fotográficas subidas a la bitácora con su ítem y descripción técnica."
                        onClick={() => { setSelectedDb('photos'); setDbSearchQuery(''); setDbPage(1); setExpandedRowId(null); }}
                      />
                      <DbCard 
                        label="Informes de Fotos" 
                        count={`${project?.photoReports?.length || 0} informes`} 
                        emoji="🖼️" 
                        desc="Historial de reportes fotográficos en Word/ZIP generados por el agente."
                        onClick={() => { setSelectedDb('photoReports'); setDbSearchQuery(''); setDbPage(1); setExpandedRowId(null); }}
                      />
                      <DbCard 
                        label="Agenda de Pendientes" 
                        count={`${project?.agentTodos?.length || 0} tareas`} 
                        emoji="📌" 
                        desc="Lista de compromisos y actividades por realizar gestionada en PENDIENTES.md."
                        onClick={() => { setSelectedDb('todos'); setDbSearchQuery(''); setDbPage(1); setExpandedRowId(null); }}
                      />
                      <DbCard 
                        label="Oficios / Correspondencia" 
                        count={`${correspondenceCount} oficios`} 
                        emoji="✉️" 
                        desc="Cartas, circulares y documentos oficiales con su metadata y estado de seguimiento."
                        onClick={() => { setSelectedDb('correspondence'); setDbSearchQuery(''); setDbPage(1); setExpandedRowId(null); }}
                      />
                      <DbCard 
                        label="Gmail Integrado" 
                        count={`${project?.gmailEmails?.length || 0} correos`} 
                        emoji="📧" 
                        desc="Mensajes de correo electrónico sincronizados y clasificados por tema."
                        onClick={() => { setSelectedDb('gmail'); setDbSearchQuery(''); setDbPage(1); setExpandedRowId(null); }}
                      />
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
                          Previsualizar Prompt de Sistema Completo (Caché del Motor)
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
              ) : (
                // VIEW 2: Selected database visualizer with table, search, pagination, and back button
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', flex: 1, minHeight: 0 }}>
                  {/* Top Bar inside selected database */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--border-color)', paddingBottom: '12px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                      <button 
                        onClick={() => setSelectedDb(null)}
                        style={{
                          background: 'hsla(var(--bg-tertiary), 0.5)',
                          border: '1px solid var(--border-color)',
                          color: 'hsl(var(--text-secondary))',
                          cursor: 'pointer',
                          padding: '6px 12px',
                          borderRadius: 'var(--radius-sm)',
                          fontSize: '0.7rem',
                          fontFamily: 'var(--font-technical)',
                          fontWeight: 'bold',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px',
                          transition: 'all 0.2s'
                        }}
                        onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'hsl(var(--primary-neon))'; e.currentTarget.style.color = '#fff'; }}
                        onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border-color)'; e.currentTarget.style.color = 'hsl(var(--text-secondary))'; }}
                      >
                        <ArrowLeft size={14} />
                        <span>VOLVER AL RESUMEN</span>
                      </button>
                      <div>
                        <h4 style={{ margin: 0, fontSize: '0.85rem', color: 'hsl(var(--text-primary))', fontFamily: 'var(--font-technical)', fontWeight: 'bold', textTransform: 'uppercase' }}>
                          BASE DE DATOS: {
                            selectedDb === 'budget' ? 'Presupuesto Contractual' :
                            selectedDb === 'versions' ? 'Versiones de Presupuesto' :
                            selectedDb === 'apus' ? 'Análisis de Precios Unitarios (APUs)' :
                            selectedDb === 'resources' ? 'Catálogo de Insumos de Referencia' :
                            selectedDb === 'transactions' ? 'Registro de Costos Reales / Gastos' :
                            selectedDb === 'progress' ? 'Avances Físicos de Obra' :
                            selectedDb === 'partials' ? 'Actas Parciales de Cobro' :
                            selectedDb === 'photos' ? 'Registro de Fotos de Campo' :
                            selectedDb === 'photoReports' ? 'Informes Fotográficos Generados' :
                            selectedDb === 'todos' ? 'Agenda de Tareas Pendientes' :
                            selectedDb === 'correspondence' ? 'Oficios y Correspondencia de Proyecto' :
                            selectedDb === 'gmail' ? 'Gmail Integrado' : ''
                          }
                        </h4>
                        <span style={{ fontSize: '0.65rem', color: 'hsl(var(--primary-neon))', fontFamily: 'monospace' }}>
                          Total: {rawRecords.length} registros | Filtrados: {filteredRecords.length}
                        </span>
                      </div>
                    </div>

                    {/* Search Bar */}
                    <div style={{ position: 'relative', width: '280px' }}>
                      <Search size={14} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'hsl(var(--text-muted))' }} />
                      <input 
                        type="text"
                        placeholder="Buscar en esta base de datos..."
                        value={dbSearchQuery}
                        onChange={(e) => { setDbSearchQuery(e.target.value); setDbPage(1); }}
                        style={{
                          width: '100%',
                          background: 'hsl(var(--bg-primary))',
                          border: '1px solid var(--border-color)',
                          color: 'hsl(var(--text-primary))',
                          padding: '6px 12px 6px 30px',
                          borderRadius: 'var(--radius-sm)',
                          fontSize: '0.75rem',
                          fontFamily: 'var(--font-technical)',
                          outline: 'none',
                          transition: 'border-color 0.2s'
                        }}
                        onFocus={(e) => e.target.style.borderColor = 'hsl(var(--primary-neon))'}
                        onBlur={(e) => e.target.style.borderColor = 'var(--border-color)'}
                      />
                    </div>
                  </div>

                  {/* Dense Table View Container */}
                  <div style={{ flex: 1, overflowY: 'auto', background: 'hsla(var(--bg-tertiary), 0.15)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)', minHeight: 0 }}>
                    {filteredRecords.length === 0 ? (
                      <div style={{ padding: '32px', textAlign: 'center', color: 'hsl(var(--text-muted))', fontSize: '0.75rem' }}>
                        No se encontraron registros que coincidan con la búsqueda.
                      </div>
                    ) : (
                      <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0, fontSize: '0.7rem', textAlign: 'left' }}>
                        <thead>
                          <tr style={{ borderBottom: '1px solid var(--border-color)' }}>
                            {renderTableHeaders(selectedDb)}
                          </tr>
                        </thead>
                        <tbody>
                          {paginatedRecords.map((rec, index) => {
                            const uniqueId = rec.id || rec.itemCode || rec.item || `row-${index}`;
                            const isExpanded = expandedRowId === uniqueId;
                            return (
                              <React.Fragment key={uniqueId}>
                                <tr 
                                  onClick={() => handleRowClick(selectedDb, rec)}
                                  style={{ 
                                    borderBottom: '1px solid var(--border-color)', 
                                    cursor: ['progress', 'partials', 'apus'].includes(selectedDb) ? 'pointer' : 'default',
                                    transition: 'background 0.15s ease',
                                    background: isExpanded ? 'hsla(var(--primary-neon-hsl), 0.05)' : (rec.type === 'title' ? 'hsla(var(--bg-tertiary), 0.6)' : rec.type === 'subtitle' ? 'hsla(var(--bg-tertiary), 0.3)' : 'transparent'),
                                    fontWeight: ['title', 'subtitle'].includes(rec.type) ? 'bold' : 'normal',
                                    color: rec.type === 'title' ? 'hsl(var(--primary-neon))' : 'hsl(var(--text-secondary))'
                                  }}
                                  onMouseEnter={(e) => { e.currentTarget.style.background = 'hsla(var(--primary-neon-hsl), 0.03)'; }}
                                  onMouseLeave={(e) => { e.currentTarget.style.background = isExpanded ? 'hsla(var(--primary-neon-hsl), 0.05)' : (rec.type === 'title' ? 'hsla(var(--bg-tertiary), 0.6)' : rec.type === 'subtitle' ? 'hsla(var(--bg-tertiary), 0.3)' : 'transparent'); }}
                                >
                                  {renderTableRowCells(selectedDb, rec, index)}
                                </tr>
                                {isExpanded && (
                                  <tr style={{ background: 'hsla(var(--bg-primary), 0.4)' }}>
                                    <td colSpan={10} style={{ padding: '12px 16px', borderBottom: '1px solid var(--border-color)' }}>
                                      {renderExpandedDetails(selectedDb, rec)}
                                    </td>
                                  </tr>
                                )}
                              </React.Fragment>
                            );
                          })}
                        </tbody>
                      </table>
                    )}
                  </div>

                  {/* Count summary */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', padding: '4px 0', fontSize: '0.7rem', color: 'hsl(var(--text-muted))' }}>
                    <span>
                      Mostrando {filteredRecords.length} registros
                    </span>
                  </div>
                </div>
              )}
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

function SkillCard({ name, title, desc, onEdit }: { name: string; title: string; desc: string; onEdit: () => void }) {
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
      <p style={{ fontSize: '0.7rem', color: 'hsl(var(--text-secondary))', lineHeight: '1.4', margin: '0 0 10px 0' }}>
        {desc}
      </p>
      <button
        onClick={onEdit}
        className="btn btn-secondary"
        style={{
          width: '100%',
          padding: '6px 12px',
          fontSize: '0.65rem',
          fontWeight: 'bold',
          height: 'auto',
          background: 'hsla(var(--bg-primary), 0.4)',
          border: '1px solid var(--border-color)',
          color: 'hsl(var(--text-secondary))',
          transition: 'all 0.2s'
        }}
        onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'hsl(var(--primary-neon))'; e.currentTarget.style.color = '#fff'; }}
        onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border-color)'; e.currentTarget.style.color = 'hsl(var(--text-secondary))'; }}
      >
        VER / EDITAR REGLAS (.MD)
      </button>
    </div>
  );
}

const SKILL_TITLES: Record<string, string> = {
  generate_executive_report: 'Generación de Informe Ejecutivo',
  export_report_data: 'Exportación Tabular de Reportes',
  generate_photo_report: 'Generación de Informes Fotográficos',
  generate_progress_report: 'Registro e Informe de Avances',
  add_todo: 'Gestión de Pendientes (Creación)',
  delete_todo: 'Gestión de Pendientes (Cierre)',
  generate_new_budget: 'Generación de Nuevo Presupuesto'
};

const parseMarkdown = (md: string) => {
  if (!md) return '';
  let html = md
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  
  html = html.replace(/^# (.*$)/gim, '<h1 style="font-size: 1.1rem; font-weight: bold; border-bottom: 1px solid var(--border-color); padding-bottom: 6px; margin: 16px 0 8px; color: hsl(var(--primary-neon));">$1</h1>');
  html = html.replace(/^## (.*$)/gim, '<h2 style="font-size: 0.9rem; font-weight: bold; margin: 14px 0 6px; color: hsl(var(--text-primary));">$1</h2>');
  html = html.replace(/^### (.*$)/gim, '<h3 style="font-size: 0.8rem; font-weight: bold; margin: 12px 0 4px; color: hsl(var(--text-secondary));">$1</h3>');
  html = html.replace(/\*\*(.*?)\*\*/g, '<strong style="color: hsl(var(--primary-neon));">$1</strong>');
  html = html.replace(/`(.*?)`/g, '<code style="background: hsla(var(--primary-neon-hsl), 0.1); padding: 2px 4px; border-radius: 4px; color: hsl(var(--primary-neon)); font-size: 0.75rem;">$1</code>');
  html = html.replace(/^\s*-\s+(.*$)/gim, '<li style="margin-left: 12px; margin-bottom: 4px; font-size: 0.75rem; list-style-type: disc;">$1</li>');
  html = html.replace(/^\s*\d+\.\s+(.*$)/gim, '<li style="margin-left: 12px; margin-bottom: 4px; list-style-type: decimal; font-size: 0.75rem;">$1</li>');
  html = html.replace(/\n/g, '<br />');
  return html;
};


function DbCard({ label, count, emoji, desc, onClick }: { label: string; count: string; emoji: string; desc: string; onClick: () => void }) {
  const [hovered, setHovered] = useState(false);
  return (
    <div 
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: hovered ? 'hsla(var(--primary-neon-hsl), 0.05)' : 'hsla(var(--bg-tertiary), 0.3)',
        border: hovered ? '1px solid hsl(var(--primary-neon))' : '1px solid var(--border-color)',
        borderRadius: 'var(--radius-sm)',
        padding: '14px 16px',
        display: 'flex',
        flexDirection: 'column',
        gap: '6px',
        cursor: 'pointer',
        transition: 'all 0.2s ease',
        boxShadow: hovered ? '0 0 10px hsla(var(--primary-neon-hsl), 0.15)' : 'none',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: '1.2rem' }}>{emoji}</span>
        <span style={{
          fontSize: '0.65rem',
          color: hovered ? 'hsl(var(--primary-neon))' : 'hsl(var(--text-muted))',
          background: hovered ? 'hsla(var(--primary-neon-hsl), 0.15)' : 'rgba(255,255,255,0.03)',
          border: hovered ? '1px solid hsl(var(--primary-neon))' : '1px solid var(--border-color)',
          padding: '2px 6px',
          borderRadius: '4px',
          fontWeight: 'bold',
          letterSpacing: '0.5px',
          transition: 'all 0.2s'
        }}>
          {count}
        </span>
      </div>
      <span style={{
        fontSize: '0.75rem',
        color: hovered ? '#fff' : 'hsl(var(--text-primary))',
        fontWeight: 'bold',
        fontFamily: 'var(--font-technical)',
        transition: 'color 0.2s'
      }}>
        {label}
      </span>
      <p style={{
        margin: 0,
        fontSize: '0.65rem',
        color: 'hsl(var(--text-muted))',
        lineHeight: '1.3'
      }}>
        {desc}
      </p>
    </div>
  );
}
