import React, { createContext, useContext, useState } from 'react';
import type { ReactNode } from 'react';
import { chatWithAgent } from '../services/aiService';
import type { ChatMessage, MessageContent } from '../services/aiService';
import { EXPORT_REPORT_DATA_TOOL, ADD_TODO_TOOL, DELETE_TODO_TOOL, GENERATE_PHOTO_REPORT_TOOL, GENERATE_PROGRESS_REPORT_TOOL } from '../services/aiTaskEngine';
import type { TaskProgress } from '../services/aiTaskEngine';
import { AI_GLOSSARY, getPackageData, buildProjectSystemInstruction } from '../services/aiContextBuilder';
import { useProjects } from './ProjectsContext';
import type { Project, LogiEntry, AgentTodo } from '../types/projectTypes';
import { exportPhotosToWord, exportPhotosToZip, getFilteredPhotos } from '../utils/photoReportExporter';

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
  sendMessage: (content: string) => Promise<void>;
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
  const { activeProjectId, projects, updateProject, getPhotoLocalUrl, addPhotoReport } = useProjects();
  
  const [rateLimitCountdown, setRateLimitCountdown] = useState<number>(0);
  const sendingRef = React.useRef(false);
  const systemPromptRef = React.useRef<string>('');
  const lastProjectIdRef = React.useRef<string>('');

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

  const sendMessage = async (content: string) => {
    if (sendingRef.current || isLoading || rateLimitCountdown > 0) {
      console.warn("[Agent Memory] Mensaje cancelado: petición en curso o rate limit activo.");
      return;
    }
    sendingRef.current = true;
    
    const userMsg: ChatMessage = { role: 'user', content };
    setMessages(prev => [...prev, userMsg]);
    setIsLoading(true);

    try {
      const activeProject = projects.find(p => p.id === activeProjectId);
      const normalizedContent = content.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

      // 1. Inyectar la instrucción de sistema rígida con el contexto completo .lch y directrices de LCH Ingeniería (Optimizada con caché)
      let systemPrompt = '';
      if (activeProject) {
        if (activeProject.id === lastProjectIdRef.current && systemPromptRef.current) {
          systemPrompt = systemPromptRef.current;
        } else {
          console.log("[Agent Memory] Generando y cacheando instrucción de sistema para el proyecto:", activeProject.name);
          const builtPrompt = buildProjectSystemInstruction(activeProject);
          systemPromptRef.current = builtPrompt;
          lastProjectIdRef.current = activeProject.id;
          systemPrompt = builtPrompt;
        }
      } else {
        systemPrompt = buildProjectSystemInstruction(null);
      }

      if (activeProject) {
        systemPrompt += `\n\nINSTRUCCIONES DE GESTIÓN DE PENDIENTES:
- Si el usuario te indica que tiene una nueva tarea, deber, pendiente o actividad por realizar, debes invocar obligatoriamente la herramienta 'add_todo' con el texto descriptivo de la tarea.
- Si el usuario te indica que ya realizó, completó, terminó o quiere eliminar una tarea/pendiente, debes invocar obligatoriamente la herramienta 'delete_todo' especificando el texto de la tarea a eliminar.
- Si el usuario te pregunta qué pendientes tiene, respóndele de forma natural basándote en la sección 'TAREAS PENDIENTES REGISTRADAS' listada arriba.

INSTRUCCIONES DE REPORTE FOTOGRÁFICO:
- Si el usuario te pide generar un reporte de fotos, de evidencias o un informe fotográfico (en Word o ZIP) para un rango de fechas, ítem o texto de búsqueda, debes invocar la herramienta 'generate_photo_report' con los filtros correspondientes.
- La herramienta 'generate_photo_report' recibe 'format' (obligatorio, 'word' o 'zip'), 'dateFrom' (YYYY-MM-DD), 'dateTo' (YYYY-MM-DD), 'itemFilter' e 'textFilter'.`;
      }

      // Helper interno para procesar y ejecutar el Function Calling de reportes tabulares y tareas pendientes
      const handleAiResponse = async (responseVal: any): Promise<boolean> => {
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
            exportToExcel(args.tableData, args.title, 'Reporte Interventoría');
          }
          
          if (args.format === 'word' || args.format === 'both') {
            const { exportAIReportToWord } = await import('../utils/aiReportExport');
            if (activeProject) {
              exportAIReportToWord(activeProject, reportMarkdown);
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

        if (typeof responseVal === 'string' && responseVal.trim().length > 0) {
          processAiActions(responseVal);
          setMessages(prev => [...prev, { role: 'assistant', content: responseVal }]);
          if (!isAgentOpen) setHasUnreadResponse(true);
          return true;
        }

        return false;
      };

      if (activeProject) {
        // Optimización de llamadas: Solo lanzar el decision router ReAct si la pregunta contiene palabras clave de bases de datos
        const needsDataPackage = 
          normalizedContent.includes('avance') ||
          normalizedContent.includes('ejecut') ||
          normalizedContent.includes('program') ||
          normalizedContent.includes('cronogram') ||
          normalizedContent.includes('presupuesto') ||
          normalizedContent.includes('costo') ||
          normalizedContent.includes('valora') ||
          normalizedContent.includes('tarea') ||
          normalizedContent.includes('foto') ||
          normalizedContent.includes('imagen') ||
          normalizedContent.includes('registro') ||
          normalizedContent.includes('especificaci');

        let selectedPackage = 'NINGUNO';

        if (needsDataPackage) {
          const decisionPrompt = `El usuario te ha preguntado: "${content}".\n\nLee el siguiente GLOSARIO de paquetes de datos disponibles:\n\n${AI_GLOSSARY}\n\nSelecciona QUÉ paquete de datos necesitas para poder responder a su pregunta. Debes responder ÚNICA y EXCLUSIVAMENTE con el NOMBRE EXACTO del paquete (una sola palabra). No des explicaciones, no saludes, solo el nombre del paquete.`;

          try {
            const decisionMessages: import('../services/aiService').ChatMessage[] = [{ role: 'user', content: decisionPrompt }];
            const decisionResponse = await chatWithAgent(decisionMessages, "Eres un enrutador de datos estricto. Tu única salida permitida es el nombre de un paquete en mayúsculas.", undefined, { apiKey: activeProject?.geminiApiKey });

            selectedPackage = decisionResponse.trim().replace(/[^a-zA-Z_]/g, '').toUpperCase();
            console.log(`[ReAct] Gemini solicitó el paquete: ${selectedPackage}`);
          } catch (e) {
            console.warn("[ReAct] Falló la consulta de decisión, procediendo sin datos", e);
          }
        } else {
          console.log("[ReAct Router] Saltando decisión. Consulta conversacional o de pendientes simple.");
        }

        if (selectedPackage && selectedPackage !== 'NINGUNO') {
          const response = getPackageData(selectedPackage, activeProject, content);
          const { textChunks, images } = response;
          
          if (textChunks.length === 1) {
            systemPrompt += `\n\nTe he traído los datos de la base que solicitaste:\n${textChunks[0]}`;
            
            const updatedMessages: ChatMessage[] = [...messages, userMsg];
            
            if (images && images.length > 0) {
              const lastMsg = updatedMessages[updatedMessages.length - 1];
              const multimodalContent: MessageContent[] = [
                { type: 'text', text: typeof lastMsg.content === 'string' ? lastMsg.content : '' },
                ...images.map(url => ({ 
                  type: 'image_url' as const, 
                  image_url: { url }
                }))
              ];
              updatedMessages[updatedMessages.length - 1] = { ...lastMsg, content: multimodalContent };
            }

            const aiResponse = await chatWithAgent(updatedMessages, systemPrompt, undefined, { tools: [EXPORT_REPORT_DATA_TOOL, ADD_TODO_TOOL, DELETE_TODO_TOOL, GENERATE_PHOTO_REPORT_TOOL, GENERATE_PROGRESS_REPORT_TOOL], apiKey: activeProject?.geminiApiKey });
            const processed = await handleAiResponse(aiResponse);
            if (processed) {
              setIsLoading(false);
              sendingRef.current = false;
              return;
            }
          } else if (textChunks.length > 1) {
            let fullResponse = "";
            for (let i = 0; i < textChunks.length; i++) {
              setTaskProgress({ 
                currentChunk: i + 1, 
                totalChunks: textChunks.length, 
                statusText: `Analizando ${selectedPackage} (Lote ${i + 1} de ${textChunks.length})...` 
              });
              
              let iterPrompt = systemPrompt + `\n\nTe estoy enviando un paquete de datos (Lote ${i + 1} de ${textChunks.length}).\n\n${textChunks[i]}`;
              iterPrompt += `\n\nINSTRUCCIÓN: Lee ÚNICAMENTE la información de este lote y responde a: "${content}".`;

              const iterMessages: import('../services/aiService').ChatMessage[] = [
                { role: 'user', content: content }
              ];
              
              const aiResponse = await chatWithAgent(iterMessages, iterPrompt, undefined, { tools: [EXPORT_REPORT_DATA_TOOL, ADD_TODO_TOOL, DELETE_TODO_TOOL, GENERATE_PHOTO_REPORT_TOOL, GENERATE_PROGRESS_REPORT_TOOL], apiKey: activeProject?.geminiApiKey });
              
              if (aiResponse && typeof aiResponse === 'object') {
                const processed = await handleAiResponse(aiResponse);
                if (processed) {
                  setTaskProgress(null);
                  setIsLoading(false);
                  sendingRef.current = false;
                  return;
                }
              }
              
              fullResponse += aiResponse + "\n\n";
            }
            
            processAiActions(fullResponse);
            setMessages(prev => [...prev, { role: 'assistant', content: fullResponse.trim() }]);
            if (!isAgentOpen) setHasUnreadResponse(true);
            setTaskProgress(null);
            setIsLoading(false);
            sendingRef.current = false;
            return;
          }
        }
      }

      const updatedMessages = [...messages, userMsg];
      const aiResponse = await chatWithAgent(updatedMessages, systemPrompt, undefined, { tools: [EXPORT_REPORT_DATA_TOOL, ADD_TODO_TOOL, DELETE_TODO_TOOL, GENERATE_PHOTO_REPORT_TOOL, GENERATE_PROGRESS_REPORT_TOOL], apiKey: activeProject?.geminiApiKey });

      const processed = await handleAiResponse(aiResponse);
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
