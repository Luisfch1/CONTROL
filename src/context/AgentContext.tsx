import React, { createContext, useContext, useState } from 'react';
import type { ReactNode } from 'react';
import { chatWithAgent } from '../services/aiService';
import type { ChatMessage, MessageContent } from '../services/aiService';
import { 
  EXPORT_REPORT_DATA_TOOL, ADD_TODO_TOOL, DELETE_TODO_TOOL, GENERATE_PHOTO_REPORT_TOOL, GENERATE_PROGRESS_REPORT_TOOL, CREATE_NEW_BUDGET_TOOL,
  READ_BUDGET_TOOL, READ_PROGRESS_REPORTS_TOOL, READ_PARTIAL_REPORTS_TOOL, READ_APUS_TOOL, READ_COST_RESOURCES_TOOL, READ_COST_TRANSACTIONS_TOOL, READ_CORRESPONDENCE_TOOL, READ_TODOS_TOOL,
  READ_RAW_BUDGET_CHUNK_TOOL, WRITE_BUDGET_DRAFT_CHUNK_TOOL, GENERATE_EXECUTIVE_REPORT_TOOL
} from '../services/aiTaskEngine';
import type { TaskProgress } from '../services/aiTaskEngine';
import { AI_GLOSSARY, getPackageData, buildProjectSystemInstruction } from '../services/aiContextBuilder';
import { useProjects } from './ProjectsContext';
import type { Project, LogiEntry, AgentTodo } from '../types/projectTypes';
import { exportPhotosToWord, exportPhotosToZip, getFilteredPhotos } from '../utils/photoReportExporter';
import { LOCAL_DEFAULT_SKILLS } from '../services/defaultSkills';
import { parseRobustNumber } from '../utils/mathUtils';

export interface AgentAlert {
  id: string;
  type: 'critical' | 'warning' | 'info';
  icon: string;
  text: string;
  color: string;
  glowColor: string;
  agentPrompt: string;
}

// Helper to parse active tasks from markdown file
const parseTodosFromMarkdown = (markdown: string): { text: string; createdAt: string }[] => {
  const lines = markdown.split('\n');
  const todos: { text: string; createdAt: string }[] = [];
  let inPendingSection = false;

  for (const line of lines) {
    if (line.includes('## ⏳ Tareas Pendientes')) {
      inPendingSection = true;
      continue;
    }
    if (line.startsWith('##') && inPendingSection) {
      inPendingSection = false;
    }

    if (inPendingSection && line.trim().startsWith('- [ ]')) {
      const boldMatch = line.match(/\*\*([^*]+)\*\*/);
      if (boldMatch) {
        const text = boldMatch[1].trim();
        let createdAt = new Date().toISOString();
        const dateMatch = line.match(/\*\(Creado el:\s*([^)]+)\)\*/);
        if (dateMatch) {
          const dateStr = dateMatch[1].trim();
          try {
            const parts = dateStr.split(/\s+de\s+/i);
            if (parts.length === 3) {
              const day = parseInt(parts[0], 10);
              const year = parseInt(parts[2], 10);
              const months = [
                'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
                'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'
              ];
              const monthIdx = months.indexOf(parts[1].toLowerCase());
              if (!isNaN(day) && monthIdx !== -1 && !isNaN(year)) {
                createdAt = new Date(year, monthIdx, day).toISOString();
              }
            }
          } catch (_) {}
        }
        todos.push({ text, createdAt });
      }
    }
  }
  return todos;
};



const updateTodosFile = (todos: AgentTodo[], filePath?: string) => {
  const active = todos.filter(t => !t.completed);
  
  let markdown = `# 📌 CONTROL - Pendientes del Proyecto\n\n`;
  markdown += `Este archivo es gestionado automáticamente por el **Agente IA de CONTROL**.\n\n`;
  
  markdown += `## ⏳ Tareas Pendientes\n\n`;
  if (active.length === 0) {
    markdown += `*No hay tareas pendientes en este momento. ¡Buen trabajo!* 🎉\n\n`;
  } else {
    active.forEach(t => {
      const dateStr = new Date(t.createdAt).toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' });
      markdown += `- [ ] **${t.text}** *(Creado el: ${dateStr})*\n`;
    });
    markdown += `\n`;
  }
  
  if ((window as any).electronAPI && typeof (window as any).electronAPI.writeFile === 'function') {
    let targetPath = 'PENDIENTES.md';
    if (filePath) {
      const normalized = filePath.replace(/\\/g, '/');
      const lastSlash = normalized.lastIndexOf('/');
      if (lastSlash !== -1) {
        const dir = filePath.substring(0, lastSlash);
        targetPath = `${dir}/PENDIENTES.md`;
      }
    }
    (window as any).electronAPI.writeFile(targetPath, markdown)
      .then((success: boolean) => console.log('[Agent Memory] PENDIENTES.md written successfully at:', targetPath, success))
      .catch((err: any) => console.error('Error writing PENDIENTES.md:', err));
  }
};

interface AgentContextProps {
  isAgentOpen: boolean;
  toggleAgent: () => void;
  messages: ChatMessage[];
  sendMessage: (content: string, attachments?: any[]) => Promise<void>;
  isLoading: boolean;
  clearHistory: () => void;
  taskProgress: TaskProgress | null;
  hasUnreadResponse: boolean;
  setHasUnreadResponse: (val: boolean) => void;
  activeAlerts: AgentAlert[];
  triggerAlertQuery: (alert: AgentAlert) => void;
  completeTodo: (id: string) => void;
  rateLimitCountdown: number;
  generatePhotoProposals: (photos: LogiEntry[]) => Promise<void>;
}

const AgentContext = createContext<AgentContextProps | undefined>(undefined);

export const AgentProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [isAgentOpen, setIsAgentOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [taskProgress, setTaskProgress] = useState<TaskProgress | null>(null);
  const [hasUnreadResponse, setHasUnreadResponse] = useState(false);
  const { activeProjectId, projects, updateProject, getPhotoLocalUrl, addPhotoReport, createBudgetVersion, importBudgetExcel, addExecutiveReport } = useProjects();
  
  const [rateLimitCountdown, setRateLimitCountdown] = useState<number>(0);
  const sendingRef = React.useRef(false);
  const systemPromptRef = React.useRef<string>('');
  const lastProjectIdRef = React.useRef<string>('');
  const lastProjectStateRef = React.useRef<string>('');

  // Temporizador para cuenta regresiva del rate limit (429)
  React.useEffect(() => {
    if (rateLimitCountdown <= 0) return;
    const timer = setInterval(() => {
      setRateLimitCountdown(prev => {
        if (prev <= 1) {
          clearInterval(timer);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [rateLimitCountdown]);

  const clearPromptCache = React.useCallback(() => {
    systemPromptRef.current = '';
    lastProjectStateRef.current = '';
  }, []);

  const syncTodosFromFile = React.useCallback(() => {
    if (!activeProjectId) return;
    const activeProject = projects.find(p => p.id === activeProjectId);
    if (!activeProject) return;

    if ((window as any).electronAPI && typeof (window as any).electronAPI.readFile === 'function') {
      let targetPath = 'PENDIENTES.md';
      if (activeProject.filePath) {
        const normalized = activeProject.filePath.replace(/\\/g, '/');
        const lastSlash = normalized.lastIndexOf('/');
        if (lastSlash !== -1) {
          const dir = activeProject.filePath.substring(0, lastSlash);
          targetPath = `${dir}/PENDIENTES.md`;
        }
      }

      (window as any).electronAPI.readFile(targetPath)
        .then((content: string | null) => {
          if (content) {
            const parsed = parseTodosFromMarkdown(content);
            const currentTodos = activeProject.agentTodos || [];
            const activeCurrent = currentTodos.filter(t => !t.completed);
            
            let hasNewTasksInFile = false;
            const updatedTodos = [...currentTodos];
            
            parsed.forEach((p, idx) => {
              const exists = currentTodos.some(t => t.text.toLowerCase().trim() === p.text.toLowerCase().trim());
              if (!exists) {
                updatedTodos.push({
                  id: `todo-${Date.now()}-${idx}`,
                  text: p.text,
                  createdAt: p.createdAt,
                  completed: false
                });
                hasNewTasksInFile = true;
              }
            });

            let hasMissingTasksInFile = false;
            activeCurrent.forEach(t => {
              const existsInFile = parsed.some(p => p.text.toLowerCase().trim() === t.text.toLowerCase().trim());
              if (!existsInFile) {
                hasMissingTasksInFile = true;
              }
            });

            if (hasNewTasksInFile) {
              console.log('[Agent Memory] Agregando nuevas tareas de PENDIENTES.md a la memoria');
              updateProject(activeProjectId, { agentTodos: updatedTodos });
              updateTodosFile(updatedTodos, activeProject.filePath);
            } else if (hasMissingTasksInFile) {
              console.log('[Agent Memory] Sincronizando pendientes de memoria hacia PENDIENTES.md');
              updateTodosFile(currentTodos, activeProject.filePath);
            }
          }
        })
        .catch((err: any) => console.warn('[Agent Memory] Error al sincronizar desde archivo:', err));
    }
  }, [activeProjectId, projects, updateProject]);

  const toggleAgent = () => {
    setIsAgentOpen(prev => {
      const nextVal = !prev;
      if (nextVal) {
        setHasUnreadResponse(false);
        syncTodosFromFile();
      }
      return nextVal;
    });
  };

  const clearHistory = () => setMessages([]);

  // Sincronizar de PENDIENTES.md a la memoria al cargar o detectar cambios en el archivo
  React.useEffect(() => {
    if (!activeProjectId) return;
    const activeProject = projects.find(p => p.id === activeProjectId);
    if (!activeProject) return;

    if ((window as any).electronAPI && typeof (window as any).electronAPI.readFile === 'function') {
      let targetPath = 'PENDIENTES.md';
      if (activeProject.filePath) {
        const normalized = activeProject.filePath.replace(/\\/g, '/');
        const lastSlash = normalized.lastIndexOf('/');
        if (lastSlash !== -1) {
          const dir = activeProject.filePath.substring(0, lastSlash);
          targetPath = `${dir}/PENDIENTES.md`;
        }
      }

      (window as any).electronAPI.readFile(targetPath)
        .then((content: string | null) => {
          if (content) {
            const parsed = parseTodosFromMarkdown(content);
            const currentTodos = activeProject.agentTodos || [];
            const activeCurrent = currentTodos.filter(t => !t.completed);
            
            let hasNewTasksInFile = false;
            const updatedTodos = [...currentTodos];
            
            parsed.forEach((p, idx) => {
              const exists = currentTodos.some(t => t.text.toLowerCase().trim() === p.text.toLowerCase().trim());
              if (!exists) {
                updatedTodos.push({
                  id: `todo-${Date.now()}-${idx}`,
                  text: p.text,
                  createdAt: p.createdAt,
                  completed: false
                });
                hasNewTasksInFile = true;
              }
            });

            let hasMissingTasksInFile = false;
            activeCurrent.forEach(t => {
              const existsInFile = parsed.some(p => p.text.toLowerCase().trim() === t.text.toLowerCase().trim());
              if (!existsInFile) {
                hasMissingTasksInFile = true;
              }
            });

            if (hasNewTasksInFile) {
              console.log('[Agent Memory] Agregando nuevas tareas de PENDIENTES.md a la memoria');
              updateProject(activeProjectId, { agentTodos: updatedTodos });
              updateTodosFile(updatedTodos, activeProject.filePath);
            } else if (hasMissingTasksInFile) {
              console.log('[Agent Memory] Sincronizando pendientes de memoria hacia PENDIENTES.md');
              updateTodosFile(currentTodos, activeProject.filePath);
            }
          } else {
            // Si el archivo no existe o está vacío, lo creamos con lo de memoria
            updateTodosFile(activeProject.agentTodos || [], activeProject.filePath);
          }
        })
        .catch((err: any) => {
          console.warn('[Agent Memory] Error al leer PENDIENTES.md, creando archivo:', err);
          updateTodosFile(activeProject.agentTodos || [], activeProject.filePath);
        });
    }
  }, [activeProjectId]);

  // --- CÁLCULO EN TIEMPO REAL DE ALERTAS DEL AGENTE IA ---
  const activeAlerts = React.useMemo<AgentAlert[]>(() => {
    const alerts: AgentAlert[] = [];
    const activeProject = projects.find(p => p.id === activeProjectId);
    if (!activeProject) return [];

    const budgetItems = activeProject.budgetItems || [];
    const baseValue = budgetItems.reduce((acc, item) => item.type === 'item' ? acc + (item.vlrTotal || 0) : acc, 0);

    // Obtener la cantidad ejecutada acumulada para cada ítem desde el último reporte de progreso
    const latestProgressReport = activeProject.progressReports && activeProject.progressReports.length > 0 
      ? activeProject.progressReports[activeProject.progressReports.length - 1] 
      : null;

    const getExecutedProgress = (itemCode: string): number => {
      if (!latestProgressReport) return 0;
      const entry = (latestProgressReport.entries || []).find(e => e.itemCode === itemCode);
      return entry ? (entry.accumulatedQuantity || 0) : 0;
    };

    const getExecutedPercentage = (itemCode: string, totalQty: number): number => {
      if (totalQty <= 0) return 0;
      const qty = getExecutedProgress(itemCode);
      return (qty / totalQty) * 100;
    };

    let totalExecutedValue = 0;
    if (latestProgressReport) {
      (latestProgressReport.entries || []).forEach(entry => {
        const item = budgetItems.find(i => i.item === entry.itemCode);
        if (item) {
          totalExecutedValue += (entry.accumulatedQuantity || 0) * (item.vlrUnitario || 0);
        }
      });
    }
    const executedPerc = baseValue > 0 ? (totalExecutedValue / baseValue) * 100 : 0;

    // 1. ALERTA DE EVIDENCIA FOTOGRÁFICA (📷)
    const logiEntries = activeProject.logiEntries || [];
    const getLocalTodayStr = () => {
      const d = new Date();
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    };
    const todayStr = getLocalTodayStr();
    const hasPhotoToday = logiEntries.some(e => e.date === todayStr);

    if (!hasPhotoToday) {
      const sorted = [...logiEntries].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
      const lastDateStr = sorted[0]?.date;
      if (lastDateStr) {
        const diffTime = Math.abs(new Date(todayStr + 'T12:00:00').getTime() - new Date(lastDateStr + 'T12:00:00').getTime());
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        if (diffDays > 0) {
          const text = diffDays === 1 
            ? "No registras fotos desde ayer"
            : `Sin fotos de avance desde hace ${diffDays} días`;
          alerts.push({
            id: 'photo-alert',
            type: diffDays >= 3 ? 'critical' : 'warning',
            icon: '📷',
            text,
            color: diffDays >= 3 ? '#ff4d4d' : '#f97316',
            glowColor: diffDays >= 3 ? 'rgba(255, 77, 77, 0.4)' : 'rgba(249, 115, 22, 0.4)',
            agentPrompt: `Agente, no he registrado fotos de evidencia fotográfica en el proyecto desde hace ${diffDays} días.`
          });
        }
      } else {
        alerts.push({
          id: 'photo-alert',
          type: 'critical',
          icon: '📷',
          text: "Hoy no has subido fotos de avance",
          color: '#ff4d4d',
          glowColor: 'rgba(255, 77, 77, 0.4)',
          agentPrompt: `Agente, hoy no he registrado ninguna foto de avance.`
        });
      }
    }

    // 5. ALERTAS DE TAREAS PENDIENTES (📌)
    const activeTodos = activeProject.agentTodos?.filter(t => !t.completed) || [];
    activeTodos.forEach(todo => {
      alerts.push({
        id: todo.id,
        type: 'info',
        icon: '📌',
        text: `Pendiente: ${todo.text}`,
        color: 'hsl(var(--accent-primary))',
        glowColor: 'hsla(var(--primary-neon-hsl), 0.2)',
        agentPrompt: `Hola Agente, con respecto a mi pendiente: "${todo.text}". ¿Qué sugerencias me das al respecto?`
      });
    });

    // 6. ALERTAS DE CORRESPONDENCIA PENDIENTE (✉️)
    const correspondenceFiles = activeProject.correspondenceFiles || [];
    correspondenceFiles.forEach(file => {
      if (file.metadata?.status === 'pending') {
        const docDate = file.metadata?.date || file.uploadDate;
        const diffTime = Math.abs(new Date(todayStr + 'T12:00:00').getTime() - new Date(docDate.split('T')[0] + 'T12:00:00').getTime());
        const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
        if (diffDays >= 2) {
          alerts.push({
            id: `correspondence-alert-${file.id}`,
            type: 'warning',
            icon: '✉️',
            text: `Seguimiento pendiente (hace ${diffDays} días): ${file.metadata?.subject || file.name}`,
            color: '#eab308',
            glowColor: 'rgba(234, 179, 8, 0.4)',
            agentPrompt: `Agente, tengo pendiente el seguimiento del oficio "${file.name}" con asunto "${file.metadata?.subject || 'Sin Asunto'}", enviado por "${file.metadata?.sender || 'Desconocido'}" el ${docDate}. Dame sugerencias sobre el curso de acción.`
          });
        }
      }
    });

    return alerts;
  }, [activeProjectId, projects]);

  const triggerAlertQuery = (alert: AgentAlert) => {
    setIsAgentOpen(true);
    sendMessage(alert.agentPrompt);
  };

  const processAiActions = (text: string) => {
    if (!activeProjectId) return;
    const updatePhotoRegex = /\[ACTION:UPDATE_PHOTO\|([^|]+)\|([^\]]+)\]/g;
    const suggestItemRegex = /\[ACTION:SUGGEST_PHOTO_ITEM\|([^|]+)\|([^|]+)\|([^\]]+)\]/g;

    let match;
    let updatedCount = 0;

    const activeProject = projects.find(p => p.id === activeProjectId);
    if (!activeProject) return;

    const newEntries = [...(activeProject.logiEntries || [])];

    // Acción 1: Actualización Directa
    while ((match = updatePhotoRegex.exec(text)) !== null) {
      const photoId = match[1];
      const newDesc = match[2];
      const idx = newEntries.findIndex(e => e.id === photoId);
      if (idx !== -1) {
        newEntries[idx] = { ...newEntries[idx], description: newDesc };
        updatedCount++;
      }
    }

    // Acción 2: Propuesta (Triage)
    while ((match = suggestItemRegex.exec(text)) !== null) {
      const photoId = match[1];
      const itemCode = match[2];
      const suggestion = match[3];
      const idx = newEntries.findIndex(e => e.id === photoId);
      if (idx !== -1) {
        newEntries[idx] = {
          ...newEntries[idx],
          aiProposal: {
            itemCode,
            description: suggestion,
            confidence: 0.9
          }
        };
        updatedCount++;
      }
    }

    if (updatedCount > 0) {
      updateProject(activeProjectId, { logiEntries: newEntries });
      console.log(`[Agente Action] Se procesaron ${updatedCount} acciones de IA.`);
    }
  };

  const completeTodo = (id: string) => {
    if (!activeProjectId) return;
    const activeProject = projects.find(p => p.id === activeProjectId);
    if (!activeProject) return;

    const currentTodos = activeProject.agentTodos || [];
    // Borrar el pendiente completamente de la lista en memoria y del archivo
    const updatedTodos = currentTodos.filter(t => t.id !== id);

    clearPromptCache();
    updateProject(activeProjectId, { agentTodos: updatedTodos });
    updateTodosFile(updatedTodos, activeProject.filePath);
  };

  const sendMessage = async (content: string, attachments?: any[]) => {
    if (sendingRef.current || isLoading || rateLimitCountdown > 0) {
      console.warn("[Agent Memory] Mensaje cancelado: petición en curso o rate limit activo.");
      return;
    }
    sendingRef.current = true;
    
    // Process attachments to generate clean message content
    let finalContent: string | MessageContent[] = content;
    
    if (attachments && attachments.length > 0) {
      let appendedText = content;
      const nonTextAttachments: any[] = [];
      
      attachments.forEach(file => {
        if (file.isTextBased && file.extractedText) {
          appendedText += `\n\n[Archivo Adjunto: ${file.name}]\n${file.extractedText}`;
        } else {
          nonTextAttachments.push(file);
        }
      });
      
      if (nonTextAttachments.length > 0) {
        const contentArray: MessageContent[] = [{ type: 'text', text: appendedText }];
        nonTextAttachments.forEach(file => {
          if (file.url) {
            if (file.mimeType.startsWith('image/')) {
              contentArray.push({
                type: 'image_url',
                image_url: { url: file.url }
              });
            } else {
              contentArray.push({
                type: 'file',
                file: { url: file.url, name: file.name, mimeType: file.mimeType }
              });
            }
          }
        });
        finalContent = contentArray;
      } else {
        finalContent = appendedText;
      }
    }

    const activeProject = projects.find(p => p.id === activeProjectId);

    let isLargeBudget = false;
    let linesCount = 0;

    if (typeof finalContent === 'string' && finalContent.length > 5000 && activeProjectId && activeProject) {
      const lines = finalContent.split('\n');
      linesCount = lines.length;
      const hasTabsOrPipes = lines.slice(0, 15).some(line => line.includes('\t') || line.includes('|') || line.includes(';'));
      const hasNumbers = lines.slice(0, 15).some(line => /\d+/.test(line));
      
      if (hasTabsOrPipes && hasNumbers) {
        console.log("[Agent Intercept] Presupuesto extenso detectado. Redirigiendo a buffer.");
        isLargeBudget = true;
        
        // Guardar en budgetRawText y reiniciar borrador
        updateProject(activeProjectId, {
          budgetRawText: finalContent,
          budgetDraft: { versionName: 'Presupuesto Modificado V1', items: [] }
        });
        
        // Guardar físicamente si es posible
        if ((window as any).electronAPI && typeof (window as any).electronAPI.saveProject === 'function') {
          const updatedProj = {
            ...activeProject,
            budgetRawText: finalContent,
            budgetDraft: { versionName: 'Presupuesto Modificado V1', items: [] }
          };
          (window as any).electronAPI.saveProject(updatedProj)
            .catch((err: any) => console.error("Error al guardar físicamente tras intercepción:", err));
        }

        finalContent = `[SISTEMA: El usuario ha pegado un presupuesto extenso de ${linesCount} líneas. El texto completo se ha almacenado en el buffer 'budgetRawText' del proyecto. Debes procesarlo de forma secuencial utilizando la herramienta 'read_raw_budget_chunk' para leer bloques de 20-30 líneas, procesarlos/validarlos, e ir guardando los ítems interpretados en el borrador usando la herramienta 'write_budget_draft_chunk'. Haz un plan de pasos y empieza leyendo el primer chunk. Explica al usuario en tu respuesta inicial que has detectado un presupuesto extenso y que vas a procesarlo en bloques para garantizar la precisión numérica.]`;
      }
    }

    const userMsgForChat: ChatMessage = isLargeBudget 
      ? { role: 'user', content: `[Presupuesto de obra pegado por el usuario - ${linesCount} líneas]` }
      : { role: 'user', content: finalContent };

    const userMsgForAi: ChatMessage = isLargeBudget 
      ? { role: 'user', content: finalContent }
      : userMsgForChat;

    setMessages(prev => [...prev, userMsgForChat]);
    setIsLoading(true);

    try {

      // 1. Inyectar la instrucción de sistema rígida con el contexto completo .lch y directrices de LCH Ingeniería (Optimizada con caché)
      let systemPrompt = '';
      if (activeProject) {
        const projectStateStr = JSON.stringify({
          id: activeProject.id,
          agentCustomInstructions: activeProject.agentCustomInstructions,
          activeBudgetVersionId: activeProject.activeBudgetVersionId
        });

        if (activeProject.id === lastProjectIdRef.current && systemPromptRef.current && projectStateStr === lastProjectStateRef.current) {
          systemPrompt = systemPromptRef.current;
        } else {
          console.log("[Agent Memory] Generando y cacheando instrucción de sistema para el proyecto:", activeProject.name);
          const builtPrompt = buildProjectSystemInstruction(activeProject);
          systemPromptRef.current = builtPrompt;
          lastProjectIdRef.current = activeProject.id;
          lastProjectStateRef.current = projectStateStr;
          systemPrompt = builtPrompt;
        }

        // Cargar las habilidades (Skills) guardadas en archivos locales del usuario o localStorage e inyectarlas al contexto
        try {
          const skillNames = ['generate_executive_report', 'export_report_data', 'generate_photo_report', 'generate_progress_report', 'add_todo', 'delete_todo', 'generate_new_budget'];
          let validSkills: string[] = [];

          if ((window as any).electronAPI && typeof (window as any).electronAPI.readSkillFile === 'function') {
            const skillPromises = skillNames.map(name => 
              (window as any).electronAPI.readSkillFile(activeProject.id, name)
                .then((content: string | null) => content ? `### HABILIDAD: ${name}\n${content}` : '')
                .catch(() => '')
            );
            const skillContents = await Promise.all(skillPromises);
            validSkills = skillContents.filter(Boolean);
          } else {
            // Modo Web: cargar de localStorage o fallbacks por defecto
            validSkills = skillNames.map(name => {
              const localKey = `lch-skill-${activeProject.id}-${name}`;
              let saved = localStorage.getItem(localKey);
              
              // Migración al vuelo: Si el reporte ejecutivo guardado en localStorage todavía tiene el texto "excel" o "Excel", lo reseteamos al default de Word
              if (name === 'generate_executive_report' && saved && (saved.includes('excel') || saved.includes('Excel') || saved.includes('formato Excel') || !saved.includes('word'))) {
                console.log(`[Migration] Detectada regla de reporte ejecutivo obsoleta (Excel) en localStorage para el proyecto ${activeProject.id}. Reseteando a la plantilla Word por defecto.`);
                saved = LOCAL_DEFAULT_SKILLS[name] || '';
                localStorage.setItem(localKey, saved);
              }
              
              const content = saved || LOCAL_DEFAULT_SKILLS[name] || '';
              return content ? `### HABILIDAD: ${name}\n${content}` : '';
            }).filter(Boolean);
          }

          if (validSkills.length > 0) {
            systemPrompt += `\n\nREGLAS DE OPERACIÓN POR HABILIDAD (CONTROL_Skills):\nEl usuario ha definido las siguientes reglas específicas para tus habilidades. Síguelas al pie de la letra:\n\n${validSkills.join('\n\n')}`;
          }
        } catch (skillErr) {
          console.error("Error cargando habilidades para el prompt de sistema:", skillErr);
        }
      } else {
        systemPrompt = buildProjectSystemInstruction(null);
      }

      if (activeProject) {
        systemPrompt += `\n\nINSTRUCCIONES DE GESTIÓN DE PENDIENTES:
- Si el usuario te indica que tiene una nueva tarea, deber, pendiente o actividad por realizar, debes invocar obligatoriamente la herramienta 'add_todo' con el texto descriptivo de la tarea.
- Si el usuario te indica que ya realizó, completó, terminó o quiere eliminar una tarea/pendiente, debes invocar obligatoriamente la herramienta 'delete_todo' especificando el texto de la tarea a eliminar.
- Si el usuario te pregunta qué pendientes tiene, puedes consultar 'read_todos' o responder basándote en lo que recuerdas de la lista de pendientes.

INSTRUCCIONES DE REPORTE FOTOGRÁFICO:
- Si el usuario te pide generar un reporte de fotos, de evidencias o un informe fotográfico (en Word o ZIP) para un rango de fechas, ítem o texto de búsqueda, debes invocar la herramienta 'generate_photo_report' con los filtros correspondientes.
- La herramienta 'generate_photo_report' recibe 'format' (obligatorio, 'word' o 'zip'), 'dateFrom' (YYYY-MM-DD), 'dateTo' (YYYY-MM-DD), 'itemFilter' e 'textFilter'.

INSTRUCCIONES DE GENERACIÓN DE NUEVO PRESUPUESTO (CRÍTICO):
- Si el usuario te indica que el presupuesto del proyecto cambió, tiene adicionales, variaciones de cantidades o precios (de forma manual o adjuntando archivos), debes invocar obligatoriamente la herramienta 'create_new_budget'.
- Define un nombre descriptivo para 'versionName' (ej: 'Presupuesto Modificado V1') y envía en 'items' la lista completa estructurada con todos los capítulos, subcapítulos e ítems modificados o nuevos.
- PROHIBICIÓN DE REDUNDANCIA EN TEXTO: Queda estrictamente PROHIBIDO enumerar o listar detalladamente los ítems del presupuesto como texto en tu respuesta en la burbuja de chat si vas a invocar la herramienta 'create_new_budget'. No repitas la tabla ni listes los códigos/descripciones en prosa. Invoca la herramienta directamente con los datos estructurados en 'items'. Esto evita exceder el límite de tokens y que la respuesta se corte.`;
      }

      // Helper interno para procesar y ejecutar el Function Calling de reportes tabulares y tareas pendientes
      const handleAiResponse = async (responseVal: any): Promise<boolean> => {
        if (responseVal && typeof responseVal === 'object' && responseVal.name === 'create_new_budget') {
          const args = responseVal.args;
          const { versionName, items } = args;

          if (!activeProjectId || !activeProject) {
            setMessages(prev => [...prev, {
              role: 'assistant',
              content: '❌ **Error:** Necesitas abrir o seleccionar un proyecto primero para crear presupuestos.'
            }]);
            if (!isAgentOpen) setHasUnreadResponse(true);
            return true;
          }

          try {
            createBudgetVersion(activeProjectId, versionName);

            let calculatedTotal = 0;
            const mappedItems = items.map((it: any) => {
              const qty = parseRobustNumber(it.cantidad);
              const unitPrice = parseRobustNumber(it.vlrUnitario);
              const total = qty * unitPrice;
              if (it.type === 'item') {
                calculatedTotal += total;
              }
              return {
                item: String(it.item),
                descripcion: String(it.descripcion),
                unidad: String(it.unidad || 'UN'),
                cantidad: qty,
                vlrUnitario: unitPrice,
                vlrTotal: total,
                type: it.type || 'item'
              };
            });

            importBudgetExcel(activeProjectId, mappedItems, calculatedTotal);

            if ((window as any).electronAPI && typeof (window as any).electronAPI.saveProject === 'function') {
              const updatedProject = projects.find(p => p.id === activeProjectId);
              if (updatedProject) {
                (window as any).electronAPI.saveProject(updatedProject)
                  .then(() => console.log("[IA New Budget] Escenario guardado físicamente."))
                  .catch((err: any) => console.error("Error al guardar físicamente tras presupuesto IA:", err));
              }
            }

            const assistantMsg = `💼 **¡Se ha creado el nuevo presupuesto con éxito!**\n\n` +
              `*   **Nombre de la Versión/Escenario:** ${versionName}\n` +
              `*   **Cantidad de Ítems Registrados:** ${mappedItems.length}\n` +
              `*   **Costo Directo Total Calculado:** $${calculatedTotal.toLocaleString('es-CO')}\n\n` +
              `Este presupuesto se ha configurado como la versión **activa** y ya puedes visualizarlo y seleccionarlo en la pantalla de Presupuesto.`;

            setMessages(prev => [...prev, { role: 'assistant', content: assistantMsg }]);
          } catch (err: any) {
            console.error("Error al crear el nuevo presupuesto:", err);
            setMessages(prev => [...prev, { role: 'assistant', content: `❌ **Error al crear el presupuesto: ${err.message || String(err)}**` }]);
          }

          if (!isAgentOpen) setHasUnreadResponse(true);
          return true;
        }

        if (responseVal && typeof responseVal === 'object' && responseVal.name === 'generate_photo_report') {
          const args = responseVal.args;
          const { dateFrom, dateTo, itemFilter, textFilter, format } = args;

          if (!activeProjectId || !activeProject) {
            setMessages(prev => [...prev, {
              role: 'assistant',
              content: '❌ **Error:** Necesitas abrir o seleccionar un proyecto primero para que pueda generar el reporte.'
            }]);
            if (!isAgentOpen) setHasUnreadResponse(true);
            return true;
          }

          // Notificar en chat
          setMessages(prev => [...prev, {
            role: 'assistant',
            content: `🤖 **Generando reporte fotográfico (${format.toUpperCase()})...**\n${dateFrom ? `- Desde: ${dateFrom}\n` : ''}${dateTo ? `- Hasta: ${dateTo}\n` : ''}${itemFilter ? `- Ítem: ${itemFilter}\n` : ''}${textFilter ? `- Búsqueda: "${textFilter}"\n` : ''}\nPor favor, espera un momento...`
          }]);

          try {
            if (format === 'word') {
              await exportPhotosToWord(activeProject, {
                dateFrom,
                dateTo,
                itemFilter,
                textFilter,
                onProgress: (p) => setTaskProgress({ totalChunks: 100, currentChunk: p, statusText: `Exportando Word... ${p}%` })
              });
            } else if (format === 'zip') {
              await exportPhotosToZip(activeProject, {
                dateFrom,
                dateTo,
                itemFilter,
                textFilter,
                onProgress: (p) => setTaskProgress({ totalChunks: 100, currentChunk: p, statusText: `Generando ZIP... ${p}%` })
              });
            }

            // Guardar reporte en el apartado administrativo del proyecto
            try {
              const filteredPhotos = getFilteredPhotos(activeProject, { dateFrom, dateTo, itemFilter, textFilter });
              const photoIds = filteredPhotos.map(p => p.id);
              let reportName = `Informe IA`;
              if (dateFrom && dateTo) reportName += ` (${dateFrom} a ${dateTo})`;
              else if (dateFrom) reportName += ` (Desde ${dateFrom})`;
              else if (itemFilter) reportName += ` (Ítem ${itemFilter})`;
              else if (textFilter) reportName += ` (Búsqueda "${textFilter}")`;
              else reportName += ` General`;

              addPhotoReport(activeProject.id, {
                name: reportName,
                dateFrom,
                dateTo,
                itemFilter,
                textFilter,
                photoIds
              });
            } catch (saveErr) {
              console.error("Error al registrar el informe en el apartado administrativo:", saveErr);
            }

            setMessages(prev => [...prev, {
              role: 'assistant',
              content: `✓ **Reporte generado y descargado exitosamente** en formato **${format.toUpperCase()}** y registrado en la sección de informes fotográficos.`
            }]);
          } catch (err: any) {
            console.error(err);
            setMessages(prev => [...prev, {
              role: 'assistant',
              content: `❌ **Error al generar el reporte:** ${err.message || String(err)}`
            }]);
          } finally {
            setTaskProgress(null);
          }
          if (!isAgentOpen) setHasUnreadResponse(true);
          return true;
        }

        if (responseVal && typeof responseVal === 'object' && responseVal.name === 'generate_progress_report') {
          const args = responseVal.args;
          const { reportName, reportDate, updates } = args;

          if (!activeProjectId || !activeProject) {
            setMessages(prev => [...prev, {
              role: 'assistant',
              content: '❌ **Error:** Necesitas abrir o seleccionar un proyecto primero para registrar avances.'
            }]);
            if (!isAgentOpen) setHasUnreadResponse(true);
            return true;
          }

          const budgetItems = activeProject.budgetVersions?.find(v => v.id === activeProject.activeBudgetVersionId)?.items || activeProject.budgetItems || [];
          const executableItems = budgetItems.filter(i => i.type === 'item');

          const sortedReports = [...(activeProject.progressReports || [])].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
          const latestReport = sortedReports[sortedReports.length - 1];
          
          const accumulatedMap = new Map<string, number>();
          if (latestReport) {
            latestReport.entries.forEach(entry => {
              accumulatedMap.set(entry.itemCode, entry.accumulatedQuantity);
            });
          }

          const processedUpdates: { itemCode: string; description: string; oldQty: number; newQty: number }[] = [];
          const notFoundUpdates: string[] = [];

          if (Array.isArray(updates)) {
            updates.forEach((up: any) => {
              const codeOrDesc = String(up.itemCode).trim().toLowerCase();
              const newQty = Number(up.accumulatedQuantity);

              let targetItem = executableItems.find(i => i.item.toLowerCase() === codeOrDesc);

              if (!targetItem) {
                targetItem = executableItems.find(i => {
                  const desc = i.descripcion.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
                  const cleanSearch = codeOrDesc.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
                  return desc.includes(cleanSearch) || cleanSearch.includes(desc);
                });
              }

              if (!targetItem) {
                const words = codeOrDesc.split(/\s+/).filter(w => w.length > 3);
                targetItem = executableItems.find(i => {
                  const desc = i.descripcion.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
                  return words.some(w => desc.includes(w));
                });
              }

              if (targetItem) {
                const oldQty = accumulatedMap.get(targetItem.item) || 0;
                accumulatedMap.set(targetItem.item, newQty);
                processedUpdates.push({
                  itemCode: targetItem.item,
                  description: targetItem.descripcion,
                  oldQty,
                  newQty
                });
              } else {
                notFoundUpdates.push(up.itemCode);
              }
            });
          }

          const newEntries = executableItems.map(item => ({
            itemCode: item.item,
            accumulatedQuantity: accumulatedMap.get(item.item) || 0
          })).filter(entry => entry.accumulatedQuantity > 0);

          const newReport = {
            id: 'report-' + Date.now(),
            name: reportName || `Avance ${reportDate}`,
            date: reportDate || new Date().toISOString().split('T')[0],
            entries: newEntries
          };

          const updatedReports = [...(activeProject.progressReports || []), newReport];
          
          clearPromptCache();
          updateProject(activeProject.id, { progressReports: updatedReports });

          if ((window as any).electronAPI && typeof (window as any).electronAPI.saveProject === 'function') {
            const updatedProject = { ...activeProject, progressReports: updatedReports };
            (window as any).electronAPI.saveProject(updatedProject)
              .then(() => console.log("[IA Progress Report] Guardado físico automático exitoso."))
              .catch((err: any) => console.error("Error al guardar físicamente tras avance IA:", err));
          }

          let assistantMsg = `📈 **¡Nuevo balance de obra generado y guardado!**\n\n`;
          assistantMsg += `*   **Nombre del Reporte:** ${newReport.name}\n`;
          assistantMsg += `*   **Fecha de Corte:** ${newReport.date}\n\n`;
          
          if (processedUpdates.length > 0) {
            assistantMsg += `**Actividades Actualizadas:**\n`;
            processedUpdates.forEach(up => {
              assistantMsg += `- [${up.itemCode}] **${up.description}**: de **${up.oldQty}** a **${up.newQty}**\n`;
            });
          } else {
            assistantMsg += `*(Nota: No se modificó ningún ítem existente, o la entrada coincide exactamente con los acumulados actuales.)*\n`;
          }

          if (notFoundUpdates.length > 0) {
            assistantMsg += `\n⚠️ **No se pudieron identificar las siguientes actividades:**\n`;
            notFoundUpdates.forEach(nf => {
              assistantMsg += `- "${nf}" (Por favor indica el código exacto o una palabra clave clara del presupuesto)\n`;
            });
          }

          assistantMsg += `\nEl reporte ha sido incorporado al historial de reportes de progreso y se ha guardado en el archivo del proyecto.`;

          setMessages(prev => [...prev, { role: 'assistant', content: assistantMsg }]);
          if (!isAgentOpen) setHasUnreadResponse(true);
          return true;
        }

        if (responseVal && typeof responseVal === 'object' && responseVal.name === 'export_report_data') {
          const args = responseVal.args;
          
          // Compilar los datos tabulares a formato Markdown
          let mdTable = `| Ítem | Descripción | Unidad | Cantidad | Vlr Unitario | Vlr Total | Ejecutado Acum. | Estado | Observaciones |\n`;
          mdTable += `| --- | --- | --- | --- | --- | --- | --- | --- | --- |\n`;
          if (Array.isArray(args.tableData)) {
            args.tableData.forEach((row: any) => {
              mdTable += `| ${row.itemCode || ''} | ${row.description || ''} | ${row.unit || ''} | ${row.quantity || 0} | $${(row.unitPrice || 0).toLocaleString('es-CO')} | $${(row.totalPrice || 0).toLocaleString('es-CO')} | ${row.executedQuantity || 0} | ${row.status || ''} | ${row.notes || ''} |\n`;
            });
          }

          const reportMarkdown = `# ${args.title}\n\n## Resumen Ejecutivo\n${args.summary}\n\n## Detalle de Actividades\n\n${mdTable}`;

          // Exportar según el formato solicitado
          if (args.format === 'excel' || args.format === 'both') {
            const { exportToExcel } = await import('../utils/excelExport');
            exportToExcel(args.tableData, args.title, 'Reporte Interventoría', activeProject);
          }
          
          if (args.format === 'word' || args.format === 'both') {
            const { exportAIReportToWord } = await import('../utils/aiReportExport');
            if (activeProject) {
              exportAIReportToWord(activeProject, args.title, args.summary);
            }
          }

          // Guardar copia de seguridad local vía Electron API
          if ((window as any).electronAPI && typeof (window as any).electronAPI.writeFile === 'function') {
            const safeTitle = args.title.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
            (window as any).electronAPI.writeFile(`${safeTitle}.md`, reportMarkdown)
              .then(() => console.log(`Respaldo local del reporte guardado en ${safeTitle}.md`))
              .catch((err: any) => console.error("Error al escribir respaldo local:", err));
          }

          const assistantMsg = `📊 **¡Reporte Generado Exitosamente!**
 
*   **Título:** ${args.title}
*   **Formato de Exportación:** ${args.format.toUpperCase()}
*   **Resumen Ejecutivo:** ${args.summary}
 
El archivo estructurado se ha generado y descargado a tu sistema siguiendo la paleta de colores de LCH Ingeniería (texto negro, títulos gris oscuro, cabeceras gris claro, tipografía Arial). Se ha guardado una copia en formato Markdown de forma local.`;

          setMessages(prev => [...prev, { role: 'assistant', content: assistantMsg }]);
          if (!isAgentOpen) setHasUnreadResponse(true);
          return true;
        }

        if (responseVal && typeof responseVal === 'object' && responseVal.name === 'add_todo') {
          const args = responseVal.args;
          const taskText = args.text;
          if (!activeProjectId || !activeProject) {
            setMessages(prev => [...prev, {
              role: 'assistant',
              content: '❌ **Error:** Necesitas abrir o seleccionar un proyecto primero para que pueda guardar tus pendientes.'
            }]);
            if (!isAgentOpen) setHasUnreadResponse(true);
            return true;
          }

          const currentTodos = activeProject.agentTodos || [];
          const newTodo = {
            id: 'todo-' + Date.now(),
            text: taskText,
            createdAt: new Date().toISOString(),
            completed: false
          };
          const updatedTodos = [...currentTodos, newTodo];
          clearPromptCache();
          updateProject(activeProjectId, { agentTodos: updatedTodos });
          updateTodosFile(updatedTodos, activeProject.filePath);

          const assistantMsg = `📝 **¡Entendido!** He anotado esta tarea en tus pendientes del proyecto:\n*   **${taskText}**\n\nHe guardado la tarea en el archivo \`PENDIENTES.md\` de tu proyecto. Te la estaré recordando en el cuadro de texto hasta que me confirmes que la terminaste.`;
          setMessages(prev => [...prev, { role: 'assistant', content: assistantMsg }]);
          if (!isAgentOpen) setHasUnreadResponse(true);
          return true;
        }

        if (responseVal && typeof responseVal === 'object' && responseVal.name === 'delete_todo') {
          const args = responseVal.args;
          const taskText = args.text;
          if (!activeProjectId || !activeProject) {
            setMessages(prev => [...prev, {
              role: 'assistant',
              content: '❌ **Error:** Necesitas abrir o seleccionar un proyecto primero para que pueda gestionar tus pendientes.'
            }]);
            if (!isAgentOpen) setHasUnreadResponse(true);
            return true;
          }

          const currentTodos = activeProject.agentTodos || [];
          const uncompleted = currentTodos.filter(t => !t.completed);
          if (uncompleted.length === 0) {
            setMessages(prev => [...prev, {
              role: 'assistant',
              content: 'Actualmente no tienes tareas pendientes en la lista. ¡Todo al día! 🎉'
            }]);
            if (!isAgentOpen) setHasUnreadResponse(true);
            return true;
          }

          let matchedTodo = uncompleted.find(t => 
            taskText ? t.text.toLowerCase().includes(taskText.toLowerCase()) || taskText.toLowerCase().includes(t.text.toLowerCase()) : false
          );

          if (!matchedTodo && uncompleted.length > 0) {
            const keywords = taskText.toLowerCase().split(/\s+/).filter((w: string) => w.length > 3);
            matchedTodo = uncompleted.find(t => 
              keywords.some((kw: string) => t.text.toLowerCase().includes(kw))
            );
            if (!matchedTodo) {
              matchedTodo = uncompleted[0];
            }
          }

          if (matchedTodo) {
            const updatedTodos = currentTodos.filter(t => t.id !== matchedTodo!.id);
            clearPromptCache();
            updateProject(activeProjectId, { agentTodos: updatedTodos });
            updateTodosFile(updatedTodos, activeProject.filePath);

            const assistantMsg = `✅ **¡Excelente!** He completado y borrado de tus pendientes la tarea:\n*   **${matchedTodo.text}**\n\nHe actualizado el archivo \`PENDIENTES.md\` de tu proyecto.`;
            setMessages(prev => [...prev, { role: 'assistant', content: assistantMsg }]);
          } else {
            setMessages(prev => [...prev, { role: 'assistant', content: `No encontré ninguna tarea que coincida con "${taskText}".` }]);
          }
          if (!isAgentOpen) setHasUnreadResponse(true);
          return true;
        }

        if (responseVal && typeof responseVal === 'object' && responseVal.name === 'generate_executive_report') {
          const args = responseVal.args;
          if (!activeProjectId || !activeProject) {
            setMessages(prev => [...prev, {
              role: 'assistant',
              content: '❌ **Error:** Necesitas abrir o seleccionar un proyecto primero para que pueda generar el informe ejecutivo.'
            }]);
            if (!isAgentOpen) setHasUnreadResponse(true);
            return true;
          }

          // Determinar período
          const selectedMonth: string = args.selectedMonth || new Date().toISOString().slice(0, 7);
          const [yyyy, mm] = selectedMonth.split('-').map(Number);
          const autoDateFrom = args.dateFrom || `${yyyy}-${String(mm).padStart(2, '0')}-01`;
          const lastDay = new Date(yyyy, mm, 0).getDate();
          const autoDateTo = args.dateTo || `${yyyy}-${String(mm).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

          // Buscar informe guardado del mismo mes
          const savedReport = (activeProject.executiveReports || []).find(r => r.selectedMonth === selectedMonth);

          // REGLA CRÍTICA: NUNCA usar narrativa del modelo (puede ser inventada).
          // Prioridad: (1) narrativa persistida en reportConfig del proyecto → (2) narrativa del informe guardado → (3) texto neutral base
          const persistedNarrative = activeProject.reportConfig?.executiveNarratives?.[selectedMonth];
          const narrative = persistedNarrative 
            || savedReport?.narrativeText 
            || `Informe Ejecutivo del período ${autoDateFrom} al ${autoDateTo}. Los datos de avance se presentan a continuación según el registro de obra actualizado a la fecha de corte.`;

          // Calcular avances reales del proyecto (los únicos datos válidos)
          const { calculateProgressData, calculatePlannedPctAtCutoff, generateSCurvePng, fmtQty, fmtCurrency, fmtPct } = await import('../utils/progressCalculator');
          const progressData = calculateProgressData(activeProject, autoDateTo);
          const execPct = progressData?.pctTotal ?? 0;
          const plannedPct = calculatePlannedPctAtCutoff(activeProject, autoDateTo);

          // Caption de curva S: SIEMPRE con los % reales calculados arriba, nunca inventados.
          // Prioridad: (1) caption persistido en reportConfig → (2) caption del informe guardado → (3) auto-generado con datos reales
          const persistedCaption = activeProject.reportConfig?.sCurveCaptions?.[selectedMonth];
          const autoCaption = `Al corte del presente informe, el proyecto expone un avance ejecutado por el orden del ${fmtPct(execPct)}, contra una programación que, a la misma fecha de corte, exige un avance del ${fmtPct(plannedPct)}.`;
          const sCurveCaption = persistedCaption || savedReport?.sCurveCaption || autoCaption;

          // Notificar en chat
          setMessages(prev => [...prev, {
            role: 'assistant',
            content: `📄 **Generando Informe Ejecutivo...**\n- Período: **${selectedMonth}** (${autoDateFrom} → ${autoDateTo})\n- Avance físico ejecutado: **${execPct.toFixed(2)}%**\n- Programado a la fecha: **${plannedPct.toFixed(2)}%**\n\nPor favor, espera un momento...`
          }]);

          try {
            // Generar curva S PNG
            const chartConfig = {
              plannedColor: '#00E5FF', executedColor: '#c5ff00', financialColor: '#FFAB00',
              plannedWidth: 1.2, executedWidth: 3, financialWidth: 1,
              plannedDashArray: '4 2', financialDashArray: '3 3',
              gridVisible: true, gridColor: 'rgba(128,128,128,0.15)',
              axisFontSize: 10, labelFontSize: 9, legendFontSize: 11,
              pointSize: 3, axisColor: '#94a3b8',
              executedGlowRadius: 4, plannedGlowRadius: 2, financialGlowRadius: 2,
              executedFillOpacity: 0.08
            };
            const visibleCurves = activeProject.visibleCurves || { planned: true, executed: true, financial: true };
            const showStatusLine = activeProject.showStatusLine !== false;
            const curveSBase64 = await generateSCurvePng(activeProject, autoDateTo, chartConfig, 'months', showStatusLine, visibleCurves);

            // Construir filas de la tabla de avance
            const tableRows: string[][] = [];
            if (progressData) {
              progressData.tableRows.forEach(r => {
                if (r.isTitle) {
                  tableRows.push([r.item + ' ' + r.description, '', '', '', '', '', '', '', '']);
                } else {
                  tableRows.push([
                    r.item, r.description, r.unit,
                    fmtQty(r.contractedQty), fmtCurrency(r.unitPrice), fmtCurrency(r.contractedTotal),
                    fmtQty(r.acumQty), fmtCurrency(r.acumValue), fmtPct(r.pctExecution)
                  ]);
                }
              });
              tableRows.push(['COSTO DIRECTO', '', '', '', '', fmtCurrency(progressData.costoDirectoContratado), '', fmtCurrency(progressData.costoDirectoEjecutado), fmtPct(progressData.pctCostoDirecto)]);
              tableRows.push([`AIU (${progressData.aiuPct}%)`, '', '', '', '', fmtCurrency(progressData.aiuContratado), '', fmtCurrency(progressData.aiuEjecutado), fmtPct(progressData.pctAiu)]);
              tableRows.push(['TOTAL DE OBRA', '', '', '', '', fmtCurrency(progressData.totalContratado), '', fmtCurrency(progressData.totalEjecutado), fmtPct(progressData.pctTotal)]);
            }

            // Seleccionar fotos del período
            const periodPhotos = (activeProject.logiEntries || []).filter(e => e.date >= autoDateFrom && e.date <= autoDateTo);
            const excludedIds = new Set(savedReport?.excludedPhotoIds || []);
            const photos = periodPhotos.filter(p => !excludedIds.has(p.id));

            // Llamar al exportador
            const { exportExecutiveReportToWord } = await import('../utils/executiveReportExporter');
            const config = activeProject.reportConfig || {};
            const monthLabel = `${selectedMonth}`;
            await exportExecutiveReportToWord(activeProject, {
              projectName: config.objetoObra || activeProject.name,
              projectCode: config.noContrato || activeProject.code,
              periodLabel: `${monthLabel} (del ${autoDateFrom} al ${autoDateTo})`,
              narrativeText: narrative,
              tableRows,
              curveSBase64,
              photos,
              sCurveCaption
            });

            // Guardar el reporte en executiveReports del proyecto
            try {
              addExecutiveReport(activeProjectId, {
                name: `Informe Ejecutivo ${monthLabel} (IA)`,
                selectedMonth,
                dateFrom: autoDateFrom,
                dateTo: autoDateTo,
                narrativeText: narrative,
                excludedPhotoIds: [],
                sCurveCaption
              });
            } catch (saveErr) {
              console.warn('[Agent] No se pudo registrar el informe ejecutivo en el proyecto:', saveErr);
            }

            setMessages(prev => [...prev, {
              role: 'assistant',
              content: `✅ **¡Informe Ejecutivo generado y descargado!**\n\n` +
                `- **Período:** ${monthLabel} (${autoDateFrom} → ${autoDateTo})\n` +
                `- **Avance Ejecutado:** ${execPct.toFixed(2)}%\n` +
                `- **Programado a la fecha:** ${plannedPct.toFixed(2)}%\n` +
                `- **Fotos incluidas:** ${photos.length}\n\n` +
                `El archivo \`.doc\` se ha descargado a tu equipo y el informe ha quedado registrado en la sección de Informes Guardados.`
            }]);
          } catch (err: any) {
            console.error('[Agent] Error generando informe ejecutivo:', err);
            setMessages(prev => [...prev, {
              role: 'assistant',
              content: `❌ **Error al generar el Informe Ejecutivo:** ${err.message || String(err)}`
            }]);
          }

          if (!isAgentOpen) setHasUnreadResponse(true);
          return true;
        }

        if (typeof responseVal === 'string' && responseVal.trim().length > 0) {
          processAiActions(responseVal);
          setMessages(prev => [...prev, { role: 'assistant', content: responseVal }]);
          if (!isAgentOpen) setHasUnreadResponse(true);
          return true;
        }

        return false;
      };

      const activeTools = [
        GENERATE_EXECUTIVE_REPORT_TOOL, EXPORT_REPORT_DATA_TOOL, ADD_TODO_TOOL, DELETE_TODO_TOOL, GENERATE_PHOTO_REPORT_TOOL, GENERATE_PROGRESS_REPORT_TOOL, CREATE_NEW_BUDGET_TOOL,
        READ_BUDGET_TOOL, READ_PROGRESS_REPORTS_TOOL, READ_PARTIAL_REPORTS_TOOL, READ_APUS_TOOL, READ_COST_RESOURCES_TOOL, READ_COST_TRANSACTIONS_TOOL, READ_CORRESPONDENCE_TOOL, READ_TODOS_TOOL,
        READ_RAW_BUDGET_CHUNK_TOOL, WRITE_BUDGET_DRAFT_CHUNK_TOOL
      ];

      let updatedMessages = [...messages, userMsgForAi];
      let loopCount = 0;
      const maxLoops = 6;
      let keepRunning = true;
      let finalAiResponse: any = null;

      while (keepRunning && loopCount < maxLoops) {
        loopCount++;
        console.log(`[Agent ReAct Loop] Iteración ${loopCount}...`);
        
        const aiResponse = await chatWithAgent(
          updatedMessages,
          systemPrompt,
          undefined,
          { tools: activeTools, apiKey: activeProject?.geminiApiKey }
        );

        if (aiResponse && typeof aiResponse === 'object' && aiResponse.name) {
          const toolName = aiResponse.name;
          const args = aiResponse.args;

          if (toolName.startsWith('read_') || toolName === 'write_budget_draft_chunk') {
            console.log(`[Agent ReAct Loop] Ejecutando consulta de lectura: ${toolName}`, args);
            let toolOutput: any = null;

            if (activeProject) {
              switch (toolName) {
                case 'read_raw_budget_chunk': {
                  const lineStart = Number(args?.lineStart || 1);
                  const chunkSize = Number(args?.chunkSize || 20);
                  const rawText = activeProject.budgetRawText || '';
                  const lines = rawText.split('\n');
                  
                  const startIdx = Math.max(0, lineStart - 1);
                  const endIdx = Math.min(lines.length, startIdx + chunkSize);
                  const chunkLines = lines.slice(startIdx, endIdx);
                  
                  toolOutput = {
                    totalLines: lines.length,
                    lineStart: startIdx + 1,
                    lineEnd: endIdx,
                    chunk: chunkLines.join('\n'),
                    hasMore: endIdx < lines.length
                  };
                  break;
                }
                case 'write_budget_draft_chunk': {
                  const versionName = args?.versionName || 'Presupuesto Modificado V1';
                  const itemsInput = args?.items || [];
                  
                  const parsedItems = itemsInput.map((it: any) => {
                    const qty = parseRobustNumber(it.cantidad);
                    const unitPrice = parseRobustNumber(it.vlrUnitario);
                    return {
                      item: String(it.item),
                      descripcion: String(it.descripcion),
                      unidad: String(it.unidad || 'UN'),
                      cantidad: qty,
                      vlrUnitario: unitPrice,
                      vlrTotal: qty * unitPrice,
                      type: it.type || 'item'
                    };
                  });
                  
                  const currentDraft = activeProject.budgetDraft || { versionName, items: [] };
                  const existingItems = [...currentDraft.items];
                  parsedItems.forEach((newItem: any) => {
                    const idx = existingItems.findIndex(i => i.item === newItem.item);
                    if (idx !== -1) {
                      existingItems[idx] = newItem;
                    } else {
                      existingItems.push(newItem);
                    }
                  });
                  
                  const updatedDraft = {
                    versionName,
                    items: existingItems
                  };
                  
                  updateProject(activeProject.id, { budgetDraft: updatedDraft });
                  
                  if ((window as any).electronAPI && typeof (window as any).electronAPI.saveProject === 'function') {
                    const updatedProj = {
                      ...activeProject,
                      budgetDraft: updatedDraft
                    };
                    (window as any).electronAPI.saveProject(updatedProj)
                      .catch((err: any) => console.error("Error al guardar físicamente tras borrador chunk:", err));
                  }
                  
                  toolOutput = {
                    success: true,
                    totalItemsInDraft: existingItems.length,
                    message: `Se guardaron ${parsedItems.length} ítems. Total en borrador: ${existingItems.length}.`
                  };
                  break;
                }
                case 'read_budget': {
                  const activeVersion = activeProject.budgetVersions?.find(v => v.id === activeProject.activeBudgetVersionId) || activeProject.budgetVersions?.[0];
                  const items = activeVersion ? activeVersion.items : activeProject.budgetItems || [];
                  toolOutput = items.map(i => ({
                    item: i.item,
                    descripcion: i.descripcion,
                    unidad: i.unidad,
                    cantidad: i.cantidad,
                    vlrUnitario: i.vlrUnitario,
                    vlrTotal: i.vlrTotal,
                    type: i.type,
                    startDate: i.startDate,
                    endDate: i.endDate
                  }));
                  break;
                }
                case 'read_progress_reports': {
                  toolOutput = (activeProject.progressReports || []).map(r => ({
                    name: r.name,
                    date: r.date,
                    entries: r.entries
                  }));
                  break;
                }
                case 'read_partial_reports': {
                  toolOutput = (activeProject.partialReports || []).map(r => ({
                    name: r.name,
                    date: r.date,
                    entries: r.entries
                  }));
                  break;
                }
                case 'read_apus': {
                  const itemFilter = args?.itemCode ? String(args.itemCode).toLowerCase().trim() : null;
                  let apus = activeProject.activityAPUs || [];
                  if (itemFilter) {
                    apus = apus.filter(apu => apu.itemCode.toLowerCase().includes(itemFilter));
                  }
                  toolOutput = apus.map(apu => ({
                    itemCode: apu.itemCode,
                    materials: apu.materials,
                    labor: apu.labor,
                    equipment: apu.equipment,
                    transport: apu.transport,
                    pdfFileName: apu.pdfFileName
                  }));
                  break;
                }
                case 'read_cost_resources': {
                  toolOutput = (activeProject.costResources || []).map(r => ({
                    code: r.code,
                    description: r.description,
                    type: r.type,
                    unit: r.unit,
                    referencePrice: r.referencePrice
                  }));
                  break;
                }
                case 'read_cost_transactions': {
                  toolOutput = (activeProject.costTransactions || []).map(t => ({
                    date: t.date,
                    itemCode: t.itemCode,
                    resourceType: t.resourceType,
                    description: t.description,
                    quantity: t.quantity,
                    unitPrice: t.unitPrice,
                    totalPrice: t.totalPrice,
                    provider: t.provider,
                    invoiceNumber: t.invoiceNumber
                  }));
                  break;
                }
                case 'read_correspondence': {
                  const files = (activeProject.correspondenceFiles || []).map(f => {
                    const folder = (activeProject.correspondenceFolders || []).find(fol => fol.id === f.folderId);
                    return {
                      name: f.name,
                      folderName: folder ? folder.name : 'Raíz',
                      uploadDate: f.uploadDate,
                      date: f.metadata?.date,
                      sender: f.metadata?.sender,
                      receiver: f.metadata?.receiver,
                      subject: f.metadata?.subject,
                      summary: f.metadata?.summary,
                      status: f.metadata?.status,
                      followUpDeadline: f.metadata?.followUpDeadline
                    };
                  });
                  const emails = (activeProject.gmailEmails || []).map(e => ({
                    date: e.date,
                    direction: e.direction,
                    sender: e.sender,
                    receiver: e.receiver,
                    subject: e.subject,
                    bodySnippet: e.bodySnippet,
                    category: e.category
                  }));
                  toolOutput = { correspondenceFiles: files, gmailEmails: emails };
                  break;
                }
                case 'read_todos': {
                  toolOutput = (activeProject.agentTodos || []).map(t => ({
                    text: t.text,
                    createdAt: t.createdAt,
                    completed: t.completed,
                    completedAt: t.completedAt
                  }));
                  break;
                }
                default:
                  toolOutput = { error: 'Herramienta de lectura no reconocida.' };
              }
            } else {
              toolOutput = { error: 'No hay ningún proyecto activo cargado.' };
            }

            const assistantCallMsg: ChatMessage = {
              role: 'assistant',
              content: '',
              functionCall: {
                name: toolName,
                args: args
              }
            };

            const toolResponseMsg: ChatMessage = {
              role: 'function',
              content: '',
              functionResponse: {
                name: toolName,
                response: {
                  output: toolOutput
                }
              }
            };

            updatedMessages = [...updatedMessages, assistantCallMsg, toolResponseMsg];
          } else {
            finalAiResponse = aiResponse;
            keepRunning = false;
          }
        } else {
          finalAiResponse = aiResponse;
          keepRunning = false;
        }
      }

      if (!finalAiResponse) {
        setMessages(prev => [...prev, { 
          role: 'assistant', 
          content: 'No se obtuvo una respuesta válida del agente.' 
        }]);
        setIsLoading(false);
        sendingRef.current = false;
        return;
      }

      const processed = await handleAiResponse(finalAiResponse);
      if (!processed) {
        setMessages(prev => [...prev, { role: 'assistant', content: 'No se obtuvo una respuesta válida del agente.' }]);
      }
    } catch (error: any) {
      console.error(error);
      const userFriendlyError = error.message || 'Error desconocido';
      
      const isRateLimit = 
        userFriendlyError.includes('429') || 
        userFriendlyError.toLowerCase().includes('rate limit') || 
        userFriendlyError.toLowerCase().includes('quota') ||
        userFriendlyError.toLowerCase().includes('limite de peticiones') ||
        userFriendlyError.toLowerCase().includes('excedida');

      if (isRateLimit) {
        setRateLimitCountdown(30);
        setMessages(prev => [...prev, { 
          role: 'assistant', 
          content: '⏳ **Límite de peticiones alcanzado (Rate Limit):** Hemos pausado las peticiones brevemente para evitar saturar la API. Por favor, espera a que finalice la cuenta regresiva en pantalla antes de enviar tu mensaje.' 
        }]);
      } else {
        setMessages(prev => [...prev, { 
          role: 'assistant', 
          content: `❌ **Error de Conexión o Cuota con Gemini:**\n\n${userFriendlyError}\n\n*   Asegúrate de haber configurado tu clave API de Google AI Studio.\n*   Verifica tu conexión a internet.` 
        }]);
      }
    } finally {
      setIsLoading(false);
      sendingRef.current = false;
    }
  };

  const triggerProactiveReview = async () => {
    if (messages.length > 0 || isLoading || !activeProjectId) return;
    const activeProject = projects.find(p => p.id === activeProjectId);
    if (!activeProject) return;

    setIsLoading(true);
    try {
      const systemPrompt = buildProjectSystemInstruction(activeProject);
      const todayStr = new Date().toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' });
      const orphanPhotosCount = (activeProject.logiEntries || []).filter(e => !e.description || e.description.length < 5 || e.itemCode === 'S/N' || !e.itemCode).length;

      const hour = new Date().getHours();
      let greeting = "Buenos días";
      let periodName = "matutino";
      if (hour >= 12 && hour < 18) {
        greeting = "Buenas tardes";
        periodName = "de la tarde";
      } else if (hour >= 18 || hour < 6) {
        greeting = "Buenas noches";
        periodName = "de fin de jornada";
      }

      const proactivePrompt = `Actúa como CONTROL IA. Hoy es ${todayStr}.
Genera un saludo proactivo e informe ejecutivo ${periodName} para el ingeniero interventor.
Debe empezar con un saludo afectuoso y muy técnico en español (ej. "¡${greeting}, Ingeniero!" o similar adecuado para ${periodName}).

Analiza detalladamente la información del proyecto que tienes cargada (presupuesto, fechas programadas de actividades, informes de progreso y tareas pendientes):
1. Dale un diagnóstico rápido de cómo va la obra (revisa el último reporte de progreso y compáralo con las fechas de actividades vigentes para estimar si vamos a tiempo, atrasados o adelantados).
2. Enumera qué actividades puntuales deberían estar ejecutándose hoy según el cronograma (revisa las fechas de inicio y fin programadas).
3. Recuérdale de forma resumida las tareas pendientes que tiene registradas en la agenda.
4. Menciónale que hay exactamente ${orphanPhotosCount} fotos de avance sin clasificar (sin ítem asignado o sin descripción) que requieren atención técnica.

Reglas críticas:
- Tono profesional, técnico pero cercano (de ingeniero a ingeniero).
- Usa la tipografía Arial (en formato conceptual) y adhiérete a la marca de LCH Ingeniería (sin amarillos/ocre, texto negro, títulos gris oscuro).
- No uses identificadores técnicos feos (como IDs de tareas de base de datos) al listar los pendientes.
- El mensaje debe ser directo y conciso (máximo 3 párrafos cortos).`;

      const reviewMessages: ChatMessage[] = [
        { role: 'user', content: proactivePrompt }
      ];

      const aiResponse = await chatWithAgent(reviewMessages, systemPrompt, undefined, { apiKey: activeProject.geminiApiKey });

      if (typeof aiResponse === 'string' && aiResponse.trim().length > 0) {
        setMessages(prev => [...prev, { role: 'assistant', content: aiResponse }]);
        setHasUnreadResponse(true);
      }
    } catch (err) {
      console.error("Error generating proactive review:", err);
    } finally {
      setIsLoading(false);
    }
  };

  const generatePhotoProposals = async (targetPhotos: LogiEntry[]) => {
    if (targetPhotos.length === 0 || !activeProjectId) return;
    const activeProject = projects.find(p => p.id === activeProjectId);
    if (!activeProject) return;

    setIsLoading(true);
    setTaskProgress({ totalChunks: 1, currentChunk: 0, statusText: 'Analizando fotos con IA...' });

    try {
      const budgetItems = activeProject.budgetVersions?.find(v => v.id === activeProject.activeBudgetVersionId)?.items || activeProject.budgetItems || [];
      const executableItems = budgetItems.filter(i => i.type === 'item');

      const systemPrompt = `Actúas como un asistente de clasificación y etiquetado técnico de evidencias fotográficas para LCH Ingeniería.
Tu tarea es analizar las imágenes provistas y sugerir para cada una el ítem del presupuesto más pertinente y una descripción técnica corta y exacta de lo que muestra la imagen.

PRESUPUESTO DISPONIBLE:
${executableItems.map(i => `[${i.item}] ${i.descripcion}`).join('\n')}

REGLA DE FORMATO DE SALIDA (OBLIGATORIA):
Por cada imagen procesada, debes responder con el formato:
[ACTION:SUGGEST_PHOTO_ITEM|photoId|itemCode|description]
Donde:
- photoId: El ID exacto de la foto provisto.
- itemCode: El código del ítem del presupuesto que mejor se asocie a la imagen.
- description: Una descripción técnica corta de la actividad observada.

No agregues saludos, introducciones, ni texto libre fuera de los bloques de acción. Si no puedes clasificar una foto, no agregues su acción.`;

      const imageParts: MessageContent[] = [];
      
      for (const photo of targetPhotos) {
        let url = photo.imageUrl;
        if (photo.isLocal) {
          url = await getPhotoLocalUrl(photo.id) || '';
        }
        if (url) {
          imageParts.push({
            type: 'image_url',
            image_url: { url }
          });
        }
      }

      const promptText = `Procesa las siguientes ${targetPhotos.length} fotos de obra y genera las acciones correspondientes:
${targetPhotos.map(p => `- ID de la foto: ${p.id}`).join('\n')}`;

      const messages: ChatMessage[] = [
        {
          role: 'user',
          content: [
            { type: 'text', text: promptText },
            ...imageParts
          ]
        }
      ];

      setTaskProgress({ totalChunks: 1, currentChunk: 1, statusText: 'Gemini analizando imágenes...' });
      const aiResponse = await chatWithAgent(messages, systemPrompt, undefined, { apiKey: activeProject.geminiApiKey });

      if (typeof aiResponse === 'string' && aiResponse.trim().length > 0) {
        processAiActions(aiResponse);
      }
    } catch (error) {
      console.error("Error generating photo proposals:", error);
      alert("Error al generar las propuestas con IA: " + (error instanceof Error ? error.message : String(error)));
    } finally {
      setIsLoading(false);
      setTaskProgress(null);
    }
  };

  React.useEffect(() => {
    if (!activeProjectId) return;
    const timer = setTimeout(() => {
      triggerProactiveReview();
    }, 300000); // 5 minutos

    return () => clearTimeout(timer);
  }, [activeProjectId]);

  return (
    <AgentContext.Provider value={{
      isAgentOpen, toggleAgent, messages, sendMessage, isLoading, clearHistory, taskProgress,
      hasUnreadResponse, setHasUnreadResponse, activeAlerts, triggerAlertQuery, completeTodo,
      rateLimitCountdown, generatePhotoProposals
    }}>
      {children}
    </AgentContext.Provider>
  );
};

export const useAgent = () => {
  const context = useContext(AgentContext);
  if (!context) {
    throw new Error('useAgent debe usarse dentro de un AgentProvider');
  }
  return context;
};
