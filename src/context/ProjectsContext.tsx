import { createContext, useContext, useState, useEffect, useMemo, useCallback } from 'react';
import type { ReactNode } from 'react';
import type { Project, BudgetItem, ProgressReport, PartialReport, LogiEntry, PhotoReport, ReportFormat, ReportStaff, BudgetVersion, ExecutiveReport } from '../types/projectTypes';
import { photoDB } from '../services/PhotoDatabase';
import JSZip from 'jszip';

// Cache global de URLs de Blobs en memoria para rendimiento instantáneo en renderizados
export const globalBlobUrlCache = new Map<string, string>();

interface ProjectsContextType {
  projects: Project[];
  activeProjectId: string | null;
  addProject: (project: Project) => void;
  updateProject: (id: string, updates: Partial<Project>) => void;
  setActiveProject: (id: string) => void;
  getActiveProject: () => Project | undefined;
  updateBudgetItemType: (projectId: string, itemIndex: number, newType: 'title' | 'subtitle' | 'item') => void;
  updateBudgetItemDates: (projectId: string, itemIndex: number, startDate: string, endDate: string) => void;
  addBudgetItem: (projectId: string, item: BudgetItem, index?: number) => void;
  updateBudgetItem: (projectId: string, itemIndex: number, updates: Partial<BudgetItem>) => void;
  removeBudgetItem: (projectId: string, itemIndex: number) => void;
  importMsProjectXml: (projectId: string, xmlText: string) => void;
  importBudgetExcel: (projectId: string, items: BudgetItem[], totalBase: number) => void;
  addProgressReport: (projectId: string, date: string, name: string, reportId?: string) => void;
  updateProgressEntry: (projectId: string, reportId: string, itemCode: string, quantity: number) => void;
  importProgressEntries: (projectId: string, reportId: string, entries: { itemCode: string; accumulatedQuantity: number }[]) => void;
  removeProgressReport: (projectId: string, reportId: string) => void;
  addPartialReport: (projectId: string, date: string, name: string) => void;
  updatePartialEntry: (projectId: string, reportId: string, itemCode: string, fields: { partialQuantity?: number, partialValue?: number, partialPercentage?: number }) => void;
  removePartialReport: (projectId: string, reportId: string) => void;
  exportActiveProject: () => Promise<void>;
  importProject: () => Promise<void>;
  handleFileLaunch: (handle: any) => Promise<void>;
  closeProject: () => void;
  importLogiData: (projectId: string, entries: LogiEntry[]) => void;
  removeLogiEntry: (projectId: string, entryId: string) => void;
  removeLogiEntries: (projectId: string, entryIds: string[]) => void;
  syncWithCloud: (projectId: string) => Promise<void>;
  createBudgetVersion: (projectId: string, name: string) => void;
  switchActiveVersion: (projectId: string, versionId: string) => void;
  deleteBudgetVersion: (projectId: string, versionId: string) => void;
  renameBudgetVersion: (projectId: string, versionId: string, newName: string) => void;
  duplicateBudgetVersion: (projectId: string, versionId: string) => void;
  columnWidths: {
    budget: { [key: string]: number };
    schedule: { [key: string]: number };
    progress: { [key: string]: number };
    parciales: { [key: string]: number };
  };
  collapsedColumns: {
    budget: string[];
    schedule: string[];
    progress: string[];
    parciales: string[];
  };
  updateColumnWidth: (view: 'budget' | 'schedule' | 'progress' | 'parciales', colKey: string, width: number) => void;
  toggleColumnCollapse: (view: 'budget' | 'schedule' | 'progress' | 'parciales', colKey: string) => void;
  acceptAiProposal: (projectId: string, entryId: string) => void;
  rejectAiProposal: (projectId: string, entryId: string) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  migratePhotosToLocal: (projectId: string) => Promise<void>;
  exportLocalPhotosBackup: (projectId: string) => Promise<void>;
  importLocalPhotosBackup: (projectId: string) => Promise<void>;
  getPhotoLocalUrl: (entryId: string) => Promise<string | null>;
  currentView: 'dashboard' | 'budget' | 'schedule' | 'progress' | 'photos' | 'reports' | 'parciales' | 'analytics' | 'create-project' | 'edit-project' | 'photo-reports' | 'correspondence' | 'costs' | 'monthly-reports';
  setCurrentView: (view: 'dashboard' | 'budget' | 'schedule' | 'progress' | 'photos' | 'reports' | 'parciales' | 'analytics' | 'create-project' | 'edit-project' | 'photo-reports' | 'correspondence' | 'costs' | 'monthly-reports') => void;
  costsActiveTab: 'contract' | 'operation' | 'control';
  setCostsActiveTab: (tab: 'contract' | 'operation' | 'control') => void;
  selectedPhotoId: string | null;
  setSelectedPhotoId: (id: string | null) => void;
  updateLogiEntry: (projectId: string, entryId: string, updates: Partial<LogiEntry>) => void;
  updateLogiEntries: (projectId: string, entryIds: string[], updates: Partial<LogiEntry>) => void;
  addPhotoReport: (projectId: string, report: Omit<PhotoReport, 'id' | 'createdAt'>) => void;
  removePhotoReport: (projectId: string, reportId: string) => void;
  updatePhotoReport: (projectId: string, reportId: string, updates: Partial<Omit<PhotoReport, 'id' | 'createdAt'>>) => void;
  addExecutiveReport: (projectId: string, report: Omit<ExecutiveReport, 'id' | 'createdAt'>) => void;
  removeExecutiveReport: (projectId: string, reportId: string) => void;
  updateExecutiveReport: (projectId: string, reportId: string, updates: Partial<Omit<ExecutiveReport, 'id' | 'createdAt'>>) => void;
}

const ProjectsContext = createContext<ProjectsContextType | undefined>(undefined);

export function ProjectsProvider({ children }: { children: ReactNode }) {
  // Manejador del archivo físico para poder sobreescribirlo (File System Access API)
  const [fileHandle, setFileHandle] = useState<any>(null);

  // Inicializar estado desde localStorage si existe
  const [projects, setProjects] = useState<Project[]>(() => {
    const saved = localStorage.getItem('lch-control-data');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        return Array.isArray(parsed) ? parsed : [];
      } catch (e) {
        console.error("Error parsing saved data", e);
        return [];
      }
    }
    return [];
  });

  const [activeProjectId, setActiveProjectId] = useState<string | null>(() => {
    return localStorage.getItem('lch-control-active') || null;
  });

  const [currentView, setCurrentView] = useState<'dashboard' | 'budget' | 'schedule' | 'progress' | 'photos' | 'reports' | 'parciales' | 'analytics' | 'create-project' | 'edit-project' | 'photo-reports' | 'correspondence' | 'costs' | 'monthly-reports'>('dashboard');
  const [costsActiveTab, setCostsActiveTab] = useState<'contract' | 'operation' | 'control'>('contract');
  const [selectedPhotoId, setSelectedPhotoId] = useState<string | null>(null);

  // Historia para Undo/Redo
  const [past, setPast] = useState<Project[][]>([]);
  const [future, setFuture] = useState<Project[][]>([]);

  // Capturar estado actual antes de un cambio
  const captureHistory = () => {
    setPast(prev => {
      // Guardamos una copia profunda para evitar referencias
      const newPast = [...prev, JSON.parse(JSON.stringify(projects))];
      return newPast.slice(-30); // Limitar a 30 pasos
    });
    setFuture([]); // Limpiar futuro al hacer nueva acción
  };

  const undo = () => {
    if (past.length === 0) return;

    const previous = past[past.length - 1];
    const newPast = past.slice(0, past.length - 1);

    setFuture(prev => [JSON.parse(JSON.stringify(projects)), ...prev].slice(0, 30));
    setPast(newPast);
    setProjects(previous);
  };

  const redo = () => {
    if (future.length === 0) return;

    const next = future[0];
    const newFuture = future.slice(1);

    setPast(prev => [...prev, JSON.parse(JSON.stringify(projects))].slice(-30));
    setFuture(newFuture);
    setProjects(next);
  };

  const [columnWidths, setColumnWidths] = useState<{
    budget: { [key: string]: number };
    schedule: { [key: string]: number };
    progress: { [key: string]: number };
    parciales: { [key: string]: number };
  }>(() => {
    const defaultWidths = {
      budget: {
        item: 80,
        descripcion: 400,
        unidad: 80,
        cantidad: 100,
        vlrUnitario: 120,
        vlrTotal: 150,
        acciones: 120
      },
      schedule: {
        item: 60,
        descripcion: 300,
        inicio: 90,
        fin: 90,
        acciones: 60
      },
      progress: {
        item: 60,
        descripcion: 250,
        cant_p: 80,
        vr_unit: 100,
        vr_total: 120,
        ant: 80,
        act: 80,
        acum: 80,
        saldo: 80,
        p_act: 70,
        p_cap: 70,
        p_cont: 70,
        p_total: 70,
        exec: 180
      },
      parciales: {
        item: 60,
        descripcion: 250,
        unidad: 60,
        vr_unit: 100,
        cant_p: 80,
        vr_total: 120,
        cant_ejec_acum: 100,
        cant_parcial: 90,
        vr_parcial: 110,
        p_pagado: 85
      }
    };

    const saved = localStorage.getItem('lch-control-colwidths');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (parsed && typeof parsed === 'object') {
          return {
            ...defaultWidths,
            ...parsed,
            budget: { ...defaultWidths.budget, ...(parsed.budget || {}) },
            schedule: { ...defaultWidths.schedule, ...(parsed.schedule || {}) },
            progress: { ...defaultWidths.progress, ...(parsed.progress || {}) },
            parciales: { ...defaultWidths.parciales, ...(parsed.parciales || {}) }
          };
        }
      } catch (e) {
        console.error("Error parsing saved column widths", e);
      }
    }
    return defaultWidths;
  });

  const [collapsedColumns, setCollapsedColumns] = useState<{
    budget: string[];
    schedule: string[];
    progress: string[];
    parciales: string[];
  }>(() => {
    const defaultCollapsed = { budget: [], schedule: [], progress: [], parciales: [] };
    const saved = localStorage.getItem('lch-control-collapsed');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          return {
            ...defaultCollapsed,
            ...parsed
          };
        }
      } catch (e) {
        console.error("Error parsing collapsed columns", e);
      }
    }
    return defaultCollapsed;
  });

  const updateColumnWidth = (view: 'budget' | 'schedule' | 'progress' | 'parciales', colKey: string, width: number) => {
    setColumnWidths(prev => ({
      ...prev,
      [view]: {
        ...prev[view],
        [colKey]: width
      }
    }));
  };

  const toggleColumnCollapse = (view: 'budget' | 'schedule' | 'progress' | 'parciales', colKey: string) => {
    setCollapsedColumns(prev => {
      const current = prev[view];
      const isCollapsed = current.includes(colKey);
      return {
        ...prev,
        [view]: isCollapsed ? current.filter(c => c !== colKey) : [...current, colKey]
      };
    });
  };

  // Guardar automáticamente cada vez que cambian los proyectos o el activo
  useEffect(() => {
    // Sanitizar proyectos para evitar saturar localStorage con base64 pesados (PDFs)
    const sanitizedProjects = projects.map(p => {
      if (p.correspondenceFiles && p.correspondenceFiles.length > 0) {
        return {
          ...p,
          correspondenceFiles: p.correspondenceFiles.map(cf => ({
            ...cf,
            fileData: undefined // No persistir el PDF en localStorage
          }))
        };
      }
      return p;
    });

    try {
      localStorage.setItem('lch-control-data', JSON.stringify(sanitizedProjects));
    } catch (e) {
      console.error("[Local Storage] Error al guardar datos en localStorage (límite de cuota excedido):", e);
    }

    // Auto-guardado físico en Electron si el proyecto activo tiene filePath (aquí sí conservamos fileData)
    if (activeProjectId && (window as any).electronAPI && typeof (window as any).electronAPI.writeFile === 'function') {
      const activeProject = projects.find(p => String(p.id) === String(activeProjectId));
      if (activeProject && activeProject.filePath) {
        photoDB.getPhotosByProject(activeProject.id).then((photos) => {
          const projectToSave = {
            ...activeProject,
            localPhotos: photos
          };
          
          let serializedData: string;
          try {
            // Usamos JSON.stringify compacto para evitar el overhead de espacios/saltos de línea (null, 2)
            serializedData = JSON.stringify(projectToSave);
          } catch (stringifyErr) {
            console.error('[Auto-Save] Error al serializar proyecto con fotos, intentando guardar sin fotos:', stringifyErr);
            serializedData = JSON.stringify(activeProject);
          }

          (window as any).electronAPI.writeFile(activeProject.filePath, serializedData)
            .then((success: boolean) => console.log('[Auto-Save] Proyecto guardado físicamente en:', activeProject.filePath, success))
            .catch((err: any) => console.error('[Auto-Save] Error al guardar físicamente en disco:', err));
        }).catch((err) => {
          console.error('[Auto-Save] Error al leer fotos o procesar auto-guardado:', err);
          try {
            const serializedFallback = JSON.stringify(activeProject);
            (window as any).electronAPI.writeFile(activeProject.filePath, serializedFallback)
              .then((success: boolean) => console.log('[Auto-Save] Proyecto guardado físicamente (sin fotos) en:', activeProject.filePath, success))
              .catch((err: any) => console.error('[Auto-Save] Error al guardar físicamente (sin fotos):', err));
          } catch (fallbackErr) {
            console.error('[Auto-Save] Error crítico al serializar fallback sin fotos:', fallbackErr);
          }
        });
      }
    }
  }, [projects, activeProjectId]);

  useEffect(() => {
    if (activeProjectId) {
      localStorage.setItem('lch-control-active', activeProjectId);
    } else {
      localStorage.removeItem('lch-control-active');
    }
  }, [activeProjectId]);

  useEffect(() => {
    localStorage.setItem('lch-control-colwidths', JSON.stringify(columnWidths));
  }, [columnWidths]);

  useEffect(() => {
    localStorage.setItem('lch-control-collapsed', JSON.stringify(collapsedColumns));
  }, [collapsedColumns]);

  // Escuchar sincronización inalámbrica por WiFi directa
  useEffect(() => {
    if (typeof (window as any).electronAPI === 'undefined') return;

    const api = (window as any).electronAPI;

    api.onWifiSyncStart((data: any) => {
      console.log("WiFi Sync started", data);
      const { projectId, entries } = data;
      
      setProjects(prev => prev.map(p => {
        if (String(p.id) !== String(projectId)) return p;

        const currentEntries = p.logiEntries || [];
        const updatedEntries = [...currentEntries];

        // Integrar entradas
        entries.forEach((newEntry: any) => {
          const existingIdx = updatedEntries.findIndex(e => String(e.id) === String(newEntry.id));
          const entryToUpsert = {
            id: String(newEntry.id),
            date: newEntry.date || new Date().toISOString().split('T')[0],
            itemCode: String(newEntry.itemCode || "").trim(),
            description: String(newEntry.description || "").trim(),
            imageUrl: newEntry.imageUrl || "",
            isLocal: true,
            status: 'pending' as 'pending' | 'integrated'
          };

          if (existingIdx >= 0) {
            const localEntry = updatedEntries[existingIdx];
            updatedEntries[existingIdx] = {
              ...localEntry,
              ...entryToUpsert,
              imageUrl: entryToUpsert.imageUrl || localEntry.imageUrl || "",
              itemCode: (localEntry.itemCode && localEntry.itemCode.trim()) ? localEntry.itemCode : entryToUpsert.itemCode,
              description: (localEntry.description && localEntry.description.trim()) ? localEntry.description : entryToUpsert.description,
              status: localEntry.status === 'integrated' ? 'integrated' : entryToUpsert.status
            };
          } else {
            updatedEntries.push(entryToUpsert);
          }
        });

        // Asegurar que las fotos correspondientes se marquen como locales
        const finalEntries = updatedEntries.map(e => {
          return { ...e, isLocal: true };
        });

        return { ...p, logiEntries: finalEntries };
      }));
    });

    api.onWifiSyncPhoto(async (data: any) => {
      console.log("WiFi Sync photo received", data.id);
      const { id, projectId, base64Data } = data;
      if (id && base64Data) {
        await photoDB.savePhoto(id, projectId, base64Data);
      }
    });

    api.onWifiSyncEnd(() => {
      console.log("WiFi Sync ended");
      // Forzar re-renderización del listado en el visor
      setProjects(prev => [...prev]);
    });
  }, []);

  // --- MIGRATION: Convert legacy budgetItems to budgetVersions ---
  useEffect(() => {
    setProjects(prev => {
      let changed = false;
      const migrated = prev.map(p => {
        if (!p.budgetVersions || p.budgetVersions.length === 0) {
          changed = true;
          const originalVersion = {
            id: 'v-original',
            name: 'Presupuesto Original',
            createdAt: p.startDate ? `${p.startDate}T00:00:00Z` : new Date().toISOString(),
            items: p.budgetItems || []
          };
          return {
            ...p,
            budgetVersions: [originalVersion],
            activeBudgetVersionId: 'v-original'
          };
        }
        return p;
      });
      return changed ? migrated : prev;
    });
  }, []);

  // --- BACKGROUND SYNC ENGINE ---
  useEffect(() => {
    if (!activeProjectId) return;

    const project = projects.find(p => String(p.id) === String(activeProjectId));
    if (!project || !project.cloudConfig?.url || !project.cloudConfig?.apiKey) return;

    // Sincronización inicial al cargar el proyecto
    syncWithCloud(activeProjectId).catch(err => console.error("Initial background sync failed", err));

    // Intervalo de 5 minutos (300,000 ms)
    const SYNC_INTERVAL = 5 * 60 * 1000;
    const interval = setInterval(() => {
      console.log("Running automatic background sync...");
      syncWithCloud(activeProjectId).catch(err => console.error("Automatic background sync failed", err));
    }, SYNC_INTERVAL);

    return () => clearInterval(interval);
  }, [activeProjectId, projects.find(p => p.id === activeProjectId)?.cloudConfig?.url, projects.find(p => p.id === activeProjectId)?.cloudConfig?.apiKey]);

  const addProject = (project: Project) => {
    captureHistory();
    setProjects(prev => [...prev, project]);
  };

  const updateProject = (id: string, updates: Partial<Project>) => {
    captureHistory();
    setProjects(prev => prev.map(p => String(p.id) === String(id) ? { ...p, ...updates } : p));
  };

  const setActiveProject = (id: string) => {
    setActiveProjectId(id);
  };

  const getActiveProject = () => {
    return projects.find(p => String(p.id) === String(activeProjectId));
  };

  const addPhotoReport = (projectId: string, reportData: Omit<PhotoReport, 'id' | 'createdAt'>) => {
    captureHistory();
    const newReport: PhotoReport = {
      ...reportData,
      id: `rep-${Date.now()}`,
      createdAt: new Date().toISOString()
    };
    setProjects(prev => prev.map(p => {
      if (String(p.id) !== String(projectId)) return p;
      return {
        ...p,
        photoReports: [...(p.photoReports || []), newReport]
      };
    }));
  };

  const removePhotoReport = (projectId: string, reportId: string) => {
    captureHistory();
    setProjects(prev => prev.map(p => {
      if (String(p.id) !== String(projectId)) return p;
      return {
        ...p,
        photoReports: (p.photoReports || []).filter(r => r.id !== reportId)
      };
    }));
  };

  const updatePhotoReport = (projectId: string, reportId: string, updates: Partial<Omit<PhotoReport, 'id' | 'createdAt'>>) => {
    captureHistory();
    setProjects(prev => prev.map(p => {
      if (String(p.id) !== String(projectId)) return p;
      return {
        ...p,
        photoReports: (p.photoReports || []).map(r =>
          r.id === reportId ? { ...r, ...updates } : r
        )
      };
    }));
  };

  const addExecutiveReport = (projectId: string, reportData: Omit<ExecutiveReport, 'id' | 'createdAt'>) => {
    captureHistory();
    const newReport: ExecutiveReport = {
      ...reportData,
      id: `rep-exec-${Date.now()}`,
      createdAt: new Date().toISOString()
    };
    setProjects(prev => prev.map(p => {
      if (String(p.id) !== String(projectId)) return p;
      return {
        ...p,
        executiveReports: [...(p.executiveReports || []), newReport]
      };
    }));
  };

  const removeExecutiveReport = (projectId: string, reportId: string) => {
    captureHistory();
    setProjects(prev => prev.map(p => {
      if (String(p.id) !== String(projectId)) return p;
      return {
        ...p,
        executiveReports: (p.executiveReports || []).filter(r => r.id !== reportId)
      };
    }));
  };

  const updateExecutiveReport = (projectId: string, reportId: string, updates: Partial<Omit<ExecutiveReport, 'id' | 'createdAt'>>) => {
    captureHistory();
    setProjects(prev => prev.map(p => {
      if (String(p.id) !== String(projectId)) return p;
      return {
        ...p,
        executiveReports: (p.executiveReports || []).map(r =>
          r.id === reportId ? { ...r, ...updates } : r
        )
      };
    }));
  };

  const updateBudgetItemType = (projectId: string, itemIndex: number, newType: 'title' | 'subtitle' | 'item') => {
    captureHistory();
    setProjects(prev => prev.map(p => {
      if (p.id !== projectId) return p;

      const newVersions = (p.budgetVersions || []).map(v => {
        if (v.id !== p.activeBudgetVersionId) return v;
        const newItems = [...v.items];
        newItems[itemIndex] = { ...newItems[itemIndex], type: newType };
        return { ...v, items: newItems };
      });

      return { ...p, budgetVersions: newVersions };
    }));
  };

  const updateBudgetItemDates = (projectId: string, itemIndex: number, startDate: string, endDate: string) => {
    captureHistory();
    setProjects(prev => prev.map(p => {
      if (p.id !== projectId) return p;

      const newVersions = (p.budgetVersions || []).map(v => {
        if (v.id !== p.activeBudgetVersionId) return v;
        const newItems = [...v.items];
        newItems[itemIndex] = { ...newItems[itemIndex], startDate, endDate };
        return { ...v, items: newItems };
      });

      return { ...p, budgetVersions: newVersions };
    }));
  };

  const addBudgetItem = (projectId: string, item: BudgetItem, index?: number) => {
    captureHistory();
    setProjects(prev => prev.map(p => {
      if (p.id !== projectId) return p;

      const newVersions = (p.budgetVersions || []).map(v => {
        if (v.id !== p.activeBudgetVersionId) return v;

        const newItems = [...v.items];
        if (typeof index === 'number') {
          newItems.splice(index + 1, 0, item);
        } else {
          newItems.push(item);
        }
        return { ...v, items: newItems };
      });

      // Recalculate total budget base based on active version
      const activeVersion = newVersions.find(v => v.id === p.activeBudgetVersionId);
      const newTotal = activeVersion ? activeVersion.items.reduce((acc, curr) =>
        curr.type === 'item' ? acc + (Number(curr.vlrTotal) || 0) : acc, 0) : p.budgetTotalBase;

      return { ...p, budgetVersions: newVersions, budgetTotalBase: newTotal };
    }));
  };

  const updateBudgetItem = (projectId: string, itemIndex: number, updates: Partial<BudgetItem>) => {
    captureHistory();
    setProjects(prev => prev.map(p => {
      if (p.id !== projectId) return p;

      const newVersions = (p.budgetVersions || []).map(v => {
        if (v.id !== p.activeBudgetVersionId) return v;
        const newItems = [...v.items];
        const updatedItem = { ...newItems[itemIndex], ...updates };

        // Recalculate total if quantity or unit price changed
        if (updates.cantidad !== undefined || updates.vlrUnitario !== undefined) {
          updatedItem.vlrTotal = (updatedItem.cantidad || 0) * (updatedItem.vlrUnitario || 0);
        }

        newItems[itemIndex] = updatedItem;
        return { ...v, items: newItems };
      });

      // Recalculate grand total
      const activeVersion = newVersions.find(v => v.id === p.activeBudgetVersionId);
      const newTotal = activeVersion ? activeVersion.items.reduce((acc, curr) =>
        curr.type === 'item' ? acc + (Number(curr.vlrTotal) || 0) : acc, 0) : p.budgetTotalBase;

      return { ...p, budgetVersions: newVersions, budgetTotalBase: newTotal };
    }));
  };

  const removeBudgetItem = (projectId: string, itemIndex: number) => {
    captureHistory();
    setProjects(prev => prev.map(p => {
      if (p.id !== projectId) return p;

      const newVersions = (p.budgetVersions || []).map(v => {
        if (v.id !== p.activeBudgetVersionId) return v;
        const newItems = [...v.items];
        newItems.splice(itemIndex, 1);
        return { ...v, items: newItems };
      });

      return { ...p, budgetVersions: newVersions };
    }));
  };

  const createBudgetVersion = (projectId: string, name: string) => {
    captureHistory();
    setProjects(prev => prev.map(p => {
      if (p.id !== projectId) return p;

      const existingVersions = p.budgetVersions || [];
      let baseVersions = existingVersions;

      // MIGRACIÓN: si no hay versiones reales pero sí hay budgetItems legacy,
      // crear primero "Presupuesto Principal" para preservarlo como versión permanente
      if (existingVersions.length === 0 && (p.budgetItems || []).length > 0) {
        const principalVersion = {
          id: `v-principal-${Date.now()}`,
          name: 'Presupuesto Principal',
          createdAt: p.createdAt || new Date().toISOString(),
          items: (p.budgetItems || []).map(item => ({ ...item }))
        };
        baseVersions = [principalVersion];
      }

      // Obtener items fuente (de la versión activa, o la primera versión, o budgetItems)
      const sourceItems =
        baseVersions.find(v => v.id === p.activeBudgetVersionId)?.items ||
        baseVersions[0]?.items ||
        p.budgetItems ||
        [];

      const newVersion = {
        id: `v-${Date.now()}`,
        name,
        createdAt: new Date().toISOString(),
        items: sourceItems.map(item => ({ ...item })) // copia profunda
      };

      return {
        ...p,
        budgetVersions: [...baseVersions, newVersion],
        activeBudgetVersionId: newVersion.id
      };
    }));
  };

  const deleteBudgetVersion = (projectId: string, versionId: string) => {
    captureHistory();
    setProjects(prev => prev.map(p => {
      if (p.id !== projectId) return p;
      if ((p.budgetVersions || []).length <= 1) return p; // Don't delete the last version

      const newVersions = (p.budgetVersions || []).filter(v => v.id !== versionId);
      const newActiveId = p.activeBudgetVersionId === versionId ? newVersions[0].id : p.activeBudgetVersionId;

      return { ...p, budgetVersions: newVersions, activeBudgetVersionId: newActiveId };
    }));
  };

  const renameBudgetVersion = (projectId: string, versionId: string, newName: string) => {
    captureHistory();
    setProjects(prev => prev.map(p => {
      if (p.id !== projectId) return p;
      const newVersions = (p.budgetVersions || []).map(v =>
        v.id === versionId ? { ...v, name: newName } : v
      );
      return { ...p, budgetVersions: newVersions };
    }));
  };

  const duplicateBudgetVersion = (projectId: string, versionId: string) => {
    captureHistory();
    setProjects(prev => prev.map(p => {
      if (p.id !== projectId) return p;
      const versionToCopy = p.budgetVersions?.find(v => v.id === versionId);
      if (!versionToCopy) return p;

      const newVersion = {
        ...versionToCopy,
        id: `v-${Date.now()}`,
        name: `${versionToCopy.name} (Copia)`,
        createdAt: new Date().toISOString(),
        items: [...versionToCopy.items.map(item => ({ ...item }))]
      };

      return {
        ...p,
        budgetVersions: [...(p.budgetVersions || []), newVersion]
      };
    }));
  };

  const switchActiveVersion = (projectId: string, versionId: string) => {
    captureHistory();
    setProjects(prev => prev.map(p => {
      if (p.id !== projectId) return p;
      return { ...p, activeBudgetVersionId: versionId };
    }));
  };

  const importMsProjectXml = (projectId: string, xmlText: string) => {
    try {
      captureHistory();
      const parser = new DOMParser();
      const xmlDoc = parser.parseFromString(xmlText, "text/xml");
      const tasks = Array.from(xmlDoc.getElementsByTagName("Task"));

      const newItems: BudgetItem[] = [];

      for (const task of tasks) {
        // Skip null or empty tasks
        const isNull = task.getElementsByTagName("IsNull")[0]?.textContent;
        const name = task.getElementsByTagName("Name")[0]?.textContent;
        if (isNull === "1" || !name) continue;

        // Skip root project summary task (usually OutlineLevel 0)
        const outlineLevel = task.getElementsByTagName("OutlineLevel")[0]?.textContent;
        if (outlineLevel === "0") continue;

        const wbs = task.getElementsByTagName("WBS")[0]?.textContent || "";
        const summary = task.getElementsByTagName("Summary")[0]?.textContent;
        const start = task.getElementsByTagName("Start")[0]?.textContent;
        const finish = task.getElementsByTagName("Finish")[0]?.textContent;

        // NEW: Try to extract custom ITEM field from ExtendedAttributes
        let customItemCode = "";
        const extendedAttrs = Array.from(task.getElementsByTagName("ExtendedAttribute"));
        for (const attr of extendedAttrs) {
          const fieldId = attr.getElementsByTagName("FieldID")[0]?.textContent;
          // FieldID 188743731 is Texto1 (ITEM alias in this XML)
          if (fieldId === "188743731") {
            customItemCode = attr.getElementsByTagName("Value")[0]?.textContent || "";
            break;
          }
        }

        const type = summary === "1" ? "title" : "item";

        const formatXmlDate = (xmlDateStr?: string | null) => {
          if (!xmlDateStr) return undefined;
          try {
            return xmlDateStr.split('T')[0]; // Extract YYYY-MM-DD
          } catch (e) {
            return undefined;
          }
        };

        newItems.push({
          item: customItemCode || wbs, // Prioritize custom ITEM code over WBS
          descripcion: name,
          unidad: type === "title" ? "" : "UN",
          cantidad: type === "title" ? 0 : 1,
          vlrUnitario: 0,
          vlrTotal: 0,
          type: type,
          startDate: formatXmlDate(start),
          endDate: formatXmlDate(finish)
        });
      }

      if (newItems.length > 0) {
        setProjects(prev => prev.map(p => {
          if (p.id !== projectId) return p;

          const activeVersion = (p.budgetVersions || []).find(v => v.id === p.activeBudgetVersionId);
          if (!activeVersion) return p;

          const mergedItems = [...activeVersion.items];

          for (const newItem of newItems) {
            // Limpieza profunda de descripción para comparación (quitar todo lo que no sea letra o número)
            const cleanNewDesc = newItem.descripcion.trim().toLowerCase().replace(/[^a-z0-9áéíóúñ]/gi, '');
            const newItemCode = String(newItem.item).trim().toLowerCase();

            // 1. Intento por Código Exacto (WBS)
            let matchIdx = mergedItems.findIndex(i => String(i.item).trim().toLowerCase() === newItemCode);

            // 2. Intento por Descripción Exacta (pero limpia de basura visual)
            if (matchIdx === -1) {
              matchIdx = mergedItems.findIndex(i => {
                const cleanI = i.descripcion.trim().toLowerCase().replace(/[^a-z0-9áéíóúñ]/gi, '');
                return cleanI === cleanNewDesc && cleanI.length > 10; // Solo si la descripción es larga y significativa
              });
            }

            // 3. Intento por "Contiene" (Para casos de códigos NP o variaciones leves)
            if (matchIdx === -1 && newItemCode.length > 1) {
              matchIdx = mergedItems.findIndex(i => {
                const cleanI = String(i.item).trim().toLowerCase();
                return cleanI.length > 1 && (newItemCode.includes(cleanI) || cleanI.includes(newItemCode));
              });
            }

            if (matchIdx >= 0) {
              // Si hay coincidencia, solo actualizamos las fechas del ítem existente
              mergedItems[matchIdx] = {
                ...mergedItems[matchIdx],
                startDate: newItem.startDate || mergedItems[matchIdx].startDate,
                endDate: newItem.endDate || mergedItems[matchIdx].endDate
              };
            } else {
              // Solo si después de todos los intentos no hay match, lo agregamos como nuevo
              // Pero evitamos agregar ítems con valor $0 que parecen ser títulos mal detectados
              if (newItem.vlrTotal > 0 || newItem.type === 'title') {
                mergedItems.push(newItem);
              }
            }
          }

          // Sort the items by their WBS hierarchy
          mergedItems.sort((a, b) => {
            const aParts = a.item.split('.').map(Number);
            const bParts = b.item.split('.').map(Number);
            for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
              const aVal = aParts[i] || 0;
              const bVal = bParts[i] || 0;
              if (aVal !== bVal) return aVal - bVal;
            }
            return 0;
          });

          const newVersions = (p.budgetVersions || []).map(v => {
            if (v.id === p.activeBudgetVersionId) return { ...v, items: mergedItems };
            return v;
          });

          return { ...p, budgetVersions: newVersions };
        }));
      }
    } catch (e) {
      console.error("Error parsing MS Project XML", e);
      alert("Hubo un error al procesar el archivo XML.");
    }
  };

  const importBudgetExcel = (projectId: string, items: BudgetItem[], totalBase: number) => {
    captureHistory();
    setProjects(prev => prev.map(p => {
      if (p.id !== projectId) return p;

      const activeVersion = p.budgetVersions?.find(v => v.id === p.activeBudgetVersionId);
      const oldItems = activeVersion ? activeVersion.items : p.budgetItems || [];

      // Create a set of new item codes for fast lookup
      const newItemCodes = new Set(items.map(i => String(i.item).trim()));

      // 1. Process items from the new Excel sheet (merging dates if they exist)
      const updatedItems = items.map(newItem => {
        const matchingOldItem = oldItems.find(oldItem => String(oldItem.item).trim() === String(newItem.item).trim());
        if (matchingOldItem) {
          return {
            ...newItem,
            startDate: newItem.startDate || matchingOldItem.startDate,
            endDate: newItem.endDate || matchingOldItem.endDate,
          };
        }
        return newItem;
      });

      // 2. Find items in the old budget that are NOT in the new Excel sheet
      const missingItems = oldItems.filter(oldItem => !newItemCodes.has(String(oldItem.item).trim()));

      // 3. For missing items, set their quantity and total to 0, but keep them
      const disabledItems = missingItems.map(oldItem => ({
        ...oldItem,
        cantidad: 0,
        vlrTotal: 0
      }));

      // 4. Merge the lists
      const mergedItems = [...updatedItems, ...disabledItems];

      // 5. Sort them naturally using item codes (e.g. 1, 1.1, 1.2.5n, 1.2.10n, 2)
      const compareItemCodes = (a: string, b: string) => {
        const aParts = String(a).split('.');
        const bParts = String(b).split('.');
        for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
          const aPart = aParts[i] || '';
          const bPart = bParts[i] || '';
          
          const aNum = parseFloat(aPart);
          const bNum = parseFloat(bPart);
          
          if (!isNaN(aNum) && !isNaN(bNum)) {
            if (aNum !== bNum) return aNum - bNum;
            const aStr = aPart.replace(String(aNum), '');
            const bStr = bPart.replace(String(bNum), '');
            if (aStr !== bStr) return aStr.localeCompare(bStr);
          } else {
            if (aPart !== bPart) return aPart.localeCompare(bPart);
          }
        }
        return 0;
      };

      mergedItems.sort((a, b) => compareItemCodes(a.item, b.item));

      // 6. Recalculate total budget base based on the merged items (only summing up items of type 'item')
      const calculatedTotal = mergedItems.reduce((acc, curr) => 
        curr.type === 'item' ? acc + (Number(curr.vlrTotal) || 0) : acc, 0
      );

      const newVersions = (p.budgetVersions || []).map(v => {
        if (v.id !== p.activeBudgetVersionId) return v;
        return { ...v, items: mergedItems };
      });

      return { 
        ...p, 
        budgetVersions: newVersions, 
        budgetItems: p.activeBudgetVersionId === 'v-original' || !p.activeBudgetVersionId ? mergedItems : p.budgetItems,
        budgetTotalBase: calculatedTotal 
      };
    }));
  };

  const exportActiveProject = async () => {
    const project = getActiveProject();
    if (!project) {
      alert("No hay ningún proyecto activo para guardar.");
      return;
    }

    // Obtener las fotos locales del proyecto desde IndexedDB para empaquetarlas en el .lch
    let localPhotos: any[] = [];
    try {
      localPhotos = await photoDB.getPhotosByProject(project.id);
    } catch (e) {
      console.error("Error al leer fotos locales para exportar:", e);
    }

    const projectToExport = {
      ...project,
      localPhotos
    };

    let dataStr = '';
    try {
      dataStr = JSON.stringify(projectToExport);
    } catch (err) {
      console.error("Error al serializar proyecto con fotos, exportando sin fotos:", err);
      alert("El archivo es demasiado grande debido a las fotos. Guardando el proyecto sin fotos.");
      try {
        dataStr = JSON.stringify(project);
      } catch (err2) {
        console.error("Error crítico al serializar proyecto:", err2);
        alert("Error crítico al exportar el proyecto.");
        return;
      }
    }
    const safeName = project.name.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();

    try {
      // --- Electron: usar diálogo nativo del OS ---
      const api = (window as any).electronAPI;
      if (api && typeof api.saveLchDialog === 'function') {
        // Si ya tenemos filePath guardado, escribir directamente sin diálogo
        if (project.filePath) {
          const ok = await api.writeFile(project.filePath, dataStr);
          if (ok) {
            const flash = document.createElement('div');
            flash.innerText = '✓ Proyecto Guardado Correctamente';
            Object.assign(flash.style, { position:'fixed', bottom:'20px', right:'20px', background:'hsl(var(--accent-primary))', color:'#000', padding:'10px 20px', borderRadius:'8px', fontWeight:'bold', zIndex:'9999' });
            document.body.appendChild(flash);
            setTimeout(() => flash.remove(), 2500);
          }
          return;
        }
        // Si no tiene filePath, abrir diálogo de guardar
        const savedPath = await api.saveLchDialog(`${safeName}.lch`, dataStr);
        if (savedPath) {
          // Guardar el filePath en el proyecto para auto-guardado futuro
          setProjects(prev => prev.map(p => p.id === project.id ? { ...p, filePath: savedPath } : p));
          const flash = document.createElement('div');
          flash.innerText = '✓ Proyecto Guardado Exitosamente';
          Object.assign(flash.style, { position:'fixed', bottom:'20px', right:'20px', background:'hsl(var(--accent-primary))', color:'#000', padding:'10px 20px', borderRadius:'8px', fontWeight:'bold', zIndex:'9999' });
          document.body.appendChild(flash);
          setTimeout(() => flash.remove(), 2500);
        }
        return;
      }

      // --- Navegador Web: File System Access API ---
      if ('showSaveFilePicker' in window) {
        let handle = fileHandle;
        if (!handle) {
          handle = await (window as any).showSaveFilePicker({
            suggestedName: `${safeName}.lch`,
            types: [{ description: 'LCH Project File', accept: { 'application/json': ['.lch'] } }],
          });
          setFileHandle(handle);
        }
        const writable = await handle.createWritable();
        await writable.write(dataStr);
        await writable.close();

        const flash = document.createElement('div');
        flash.innerText = '✓ Proyecto Guardado Exitosamente';
        Object.assign(flash.style, { position:'fixed', bottom:'20px', right:'20px', background:'hsl(var(--accent-primary))', color:'#000', padding:'10px 20px', borderRadius:'8px', fontWeight:'bold', zIndex:'9999' });
        document.body.appendChild(flash);
        setTimeout(() => flash.remove(), 2500);

      } else {
        // Fallback descarga directa
        const blob = new Blob([dataStr], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${safeName}.lch`;
        a.click();
        URL.revokeObjectURL(url);
      }
    } catch (error: any) {
      if (error.name !== 'AbortError') {
        console.error("Error al guardar el archivo", error);
        alert("Ocurrió un error al intentar guardar el archivo.");
      }
    }
  };

  const importProject = async () => {
    try {
      // --- Electron: usar diálogo nativo del OS ---
      const api = (window as any).electronAPI;
      if (api && typeof api.openLchDialog === 'function') {
        const result = await api.openLchDialog();
        if (!result) return; // Usuario canceló

        const importedData = JSON.parse(result.content);
        if (importedData.localPhotos && Array.isArray(importedData.localPhotos)) {
          let importedCount = 0;
          for (const photo of importedData.localPhotos) {
            if (photo.id && photo.base64Data) {
              await photoDB.savePhoto(photo.id, importedData.id, photo.base64Data);
              importedCount++;
            }
          }
          console.log(`[Import Electron] Importadas ${importedCount} fotos locales a IndexedDB.`);
          delete importedData.localPhotos;
        }

        const importedProject = importedData as Project;
        if (!importedProject.id || !importedProject.name) {
          throw new Error("Formato de archivo inválido.");
        }

        importedProject.filePath = result.filePath;

        captureHistory();
        setProjects(prev => {
          const exists = prev.some(p => p.id === importedProject.id);
          if (exists) {
            return prev.map(p => p.id === importedProject.id ? importedProject : p);
          }
          return [...prev, importedProject];
        });
        setActiveProjectId(importedProject.id);
        return;
      }

      // --- Navegador Web: File System Access API ---
      if ('showOpenFilePicker' in window) {
        const [handle] = await (window as any).showOpenFilePicker({
          types: [{ description: 'LCH Project File', accept: { 'application/json': ['.lch'] } }],
        });

        setFileHandle(handle);
        const file = await handle.getFile();
        const content = await file.text();
        
        const importedData = JSON.parse(content);
        if (importedData.localPhotos && Array.isArray(importedData.localPhotos)) {
          let importedCount = 0;
          for (const photo of importedData.localPhotos) {
            if (photo.id && photo.base64Data) {
              await photoDB.savePhoto(photo.id, importedData.id, photo.base64Data);
              importedCount++;
            }
          }
          console.log(`[Import Web] Importadas ${importedCount} fotos locales a IndexedDB.`);
          delete importedData.localPhotos;
        }

        const importedProject = importedData as Project;

        if (!importedProject.id || !importedProject.name) {
          throw new Error("Formato de archivo inválido.");
        }

        if (file.path) importedProject.filePath = file.path;

        captureHistory();
        setProjects(prev => {
          const exists = prev.some(p => p.id === importedProject.id);
          if (exists) {
            return prev.map(p => p.id === importedProject.id ? importedProject : p);
          }
          return [...prev, importedProject];
        });
        setActiveProjectId(importedProject.id);
      } else {
        alert("Tu navegador no soporta la carga avanzada de archivos.");
      }
    } catch (error: any) {
      if (error.name !== 'AbortError') {
        console.error("Error importando archivo", error);
        alert("Error al intentar cargar el proyecto.");
      }
    }
  };

  const handleFileLaunch = useCallback(async (handle: any) => {
    try {
      setFileHandle(handle);
      const file = await handle.getFile();
      const content = await file.text();
      
      const importedData = JSON.parse(content);
      if (importedData.localPhotos && Array.isArray(importedData.localPhotos)) {
        let importedCount = 0;
        for (const photo of importedData.localPhotos) {
          if (photo.id && photo.base64Data) {
            await photoDB.savePhoto(photo.id, importedData.id, photo.base64Data);
            importedCount++;
          }
        }
        console.log(`[Launch Electron] Importadas ${importedCount} fotos locales a IndexedDB.`);
        delete importedData.localPhotos;
      }

      const importedProject = importedData as Project;

      if (!importedProject.id || !importedProject.name) {
        throw new Error("Formato de archivo inválido.");
      }

      // Preservar el filePath (crucial para auto-guardado en Electron)
      if (file.path) {
        importedProject.filePath = file.path;
      }

      setProjects(prev => {
        const exists = prev.some(p => p.id === importedProject.id);
        if (exists) {
          // Reemplazar el proyecto completo con los datos del archivo más reciente
          return prev.map(p => p.id === importedProject.id ? importedProject : p);
        }
        return [...prev, importedProject];
      });

      setActiveProjectId(importedProject.id);
    } catch (error) {
      console.error("Error launching from file", error);
    }
  }, []);

  const closeProject = () => {
    setActiveProjectId(null);
    setFileHandle(null);
  };

  const importLogiData = (projectId: string, newEntries: LogiEntry[]) => {
    captureHistory();
    setProjects(prev => prev.map(p => {
      if (p.id !== projectId) return p;

      const currentLogi = p.logiEntries || [];
      const updatedLogi = [...currentLogi];

      newEntries.forEach(newEntry => {
        const existingIdx = updatedLogi.findIndex(e => e.id === newEntry.id);

        if (existingIdx >= 0) {
          const localEntry = updatedLogi[existingIdx];
          // Actualizar metadatos pero PRESERVAR el status local (ej. 'integrated')
          // y proteger itemCode y description de sobreescritura si ya existen localmente
          updatedLogi[existingIdx] = {
            ...localEntry,
            date: newEntry.date,
            itemCode: (localEntry.itemCode && localEntry.itemCode.trim()) ? localEntry.itemCode : newEntry.itemCode,
            description: (localEntry.description && localEntry.description.trim()) ? localEntry.description : newEntry.description,
            imageUrl: newEntry.imageUrl || localEntry.imageUrl
          };
        } else {
          // Agregar nuevo registro
          updatedLogi.push(newEntry);
        }
      });

      return {
        ...p,
        logiEntries: updatedLogi
      };
    }));
  };


  const updateLogiEntry = (projectId: string, entryId: string, updates: Partial<LogiEntry>) => {
    captureHistory();
    setProjects(prev => prev.map(p => {
      if (String(p.id) !== String(projectId)) return p;
      const newEntries = (p.logiEntries || []).map(e => {
        if (String(e.id) !== String(entryId)) return e;
        return {
          ...e,
          ...updates
        };
      });
      return { ...p, logiEntries: newEntries };
    }));
  };

  const updateLogiEntries = (projectId: string, entryIds: string[], updates: Partial<LogiEntry>) => {
    captureHistory();
    const idSet = new Set(entryIds.map(id => String(id)));
    setProjects(prev => prev.map(p => {
      if (String(p.id) !== String(projectId)) return p;
      const newEntries = (p.logiEntries || []).map(e => {
        if (!idSet.has(String(e.id))) return e;
        return {
          ...e,
          ...updates
        };
      });
      return { ...p, logiEntries: newEntries };
    }));
  };

  const removeLogiEntry = (projectId: string, entryId: string) => {
    captureHistory();
    setProjects(prev => prev.map(p => {
      if (String(p.id) !== String(projectId)) return p;
      return {
        ...p,
        logiEntries: (p.logiEntries || []).filter(e => String(e.id) !== String(entryId))
      };
    }));
  };

  const removeLogiEntries = (projectId: string, entryIds: string[]) => {
    if (!entryIds || entryIds.length === 0) return;
    captureHistory();
    const idSet = new Set(entryIds.map(id => String(id)));

    setProjects(prev => prev.map(p => {
      if (String(p.id) !== String(projectId)) return p;
      const currentEntries = p.logiEntries || [];
      const newEntries = currentEntries.filter(e => !idSet.has(String(e.id)));

      return {
        ...p,
        logiEntries: newEntries
      };
    }));
  };

  const syncWithCloud = async (projectId: string) => {
    const project = projects.find(p => p.id === projectId);
    if (!project || !project.cloudConfig?.url || !project.cloudConfig?.apiKey) {
      throw new Error("No se han configurado las credenciales de la nube para este proyecto.");
    }

    try {
      // v2026-05-04: Soporte para Sincronización Delta (Incremental)
      const lastSyncKey = `last_sync_${projectId}`;
      const lastSync = localStorage.getItem(lastSyncKey);
      const since = lastSync ? parseInt(lastSync, 10) : undefined;

      const syncStartTime = Date.now();

      const { SyncService } = await import('../services/SyncService');
      const entries = await SyncService.fetchLogiEntries(
        project.cloudConfig.url,
        project.cloudConfig.apiKey,
        project.id,
        since
      );

      if (entries.length > 0) {
        importLogiData(projectId, entries);
        console.log(`[DeltaSync] Descargados ${entries.length} registros nuevos/modificados.`);
      } else {
        console.log(`[DeltaSync] No hay cambios desde la última sincronización.`);
      }

      // Persistir timestamp (menos 1 minuto de margen para evitar perder registros por desincronización de relojes)
      localStorage.setItem(lastSyncKey, (syncStartTime - 60000).toString());

    } catch (err) {
      console.error("Cloud sync failed:", err);
      throw err;
    }
  };

  const addProgressReport = (projectId: string, date: string, name: string, reportId?: string) => {
    captureHistory();
    setProjects(prev => prev.map(p => {
      if (p.id !== projectId) return p;
      
      const activeVersion = p.budgetVersions?.find(v => v.id === p.activeBudgetVersionId);
      const currentBudgetItems = activeVersion?.items || p.budgetItems || [];

      const lastReport = p.progressReports && p.progressReports.length > 0
        ? p.progressReports[p.progressReports.length - 1]
        : null;

      const newReport: ProgressReport = {
        id: reportId || crypto.randomUUID(),
        date,
        name,
        entries: currentBudgetItems.filter(i => i.type === 'item').map(i => {
          const prevEntry = lastReport?.entries.find(e => e.itemCode === i.item);
          return {
            itemCode: i.item,
            accumulatedQuantity: prevEntry ? prevEntry.accumulatedQuantity : 0
          };
        })
      };
      return { ...p, progressReports: [...(p.progressReports || []), newReport] };
    }));
  };

  const updateProgressEntry = (projectId: string, reportId: string, itemCode: string, quantity: number) => {
    captureHistory();
    setProjects(prev => prev.map(p => {
      if (p.id !== projectId) return p;
      const newReports = (p.progressReports || []).map(r => {
        if (r.id !== reportId) return r;
        const entryIdx = r.entries.findIndex(e => e.itemCode === itemCode);
        const newEntries = [...r.entries];
        if (entryIdx >= 0) {
          newEntries[entryIdx] = { ...newEntries[entryIdx], accumulatedQuantity: quantity };
        } else {
          newEntries.push({ itemCode, accumulatedQuantity: quantity });
        }
        return { ...r, entries: newEntries };
      });
      return { ...p, progressReports: newReports };
    }));
  };

  const importProgressEntries = (projectId: string, reportId: string, newEntriesList: { itemCode: string; accumulatedQuantity: number }[]) => {
    captureHistory();
    setProjects(prev => prev.map(p => {
      if (p.id !== projectId) return p;
      const newReports = (p.progressReports || []).map(r => {
        if (r.id !== reportId) return r;
        
        const newQuantitiesMap = new Map(newEntriesList.map(e => [e.itemCode, e.accumulatedQuantity]));
        
        const updatedEntries = r.entries.map(entry => {
          if (newQuantitiesMap.has(entry.itemCode)) {
            return { ...entry, accumulatedQuantity: newQuantitiesMap.get(entry.itemCode)! };
          }
          return entry;
        });
        
        const existingCodes = new Set(r.entries.map(e => e.itemCode));
        const addedEntries = newEntriesList
          .filter(e => !existingCodes.has(e.itemCode))
          .map(e => ({ itemCode: e.itemCode, accumulatedQuantity: e.accumulatedQuantity }));
          
        return { ...r, entries: [...updatedEntries, ...addedEntries] };
      });
      return { ...p, progressReports: newReports };
    }));
  };

  const removeProgressReport = (projectId: string, reportId: string) => {
    captureHistory();
    setProjects(prev => prev.map(p => {
      if (String(p.id) !== String(projectId)) return p;
      return {
        ...p,
        progressReports: (p.progressReports || []).filter(r => String(r.id) !== String(reportId))
      };
    }));
  };

  const addPartialReport = (projectId: string, date: string, name: string) => {
    captureHistory();
    setProjects(prev => prev.map(p => {
      if (p.id !== projectId) return p;
      const activeVersion = p.budgetVersions?.find(v => v.id === p.activeBudgetVersionId);
      const budgetItems = activeVersion?.items || p.budgetItems || [];

      const newReport: PartialReport = {
        id: crypto.randomUUID(),
        date,
        name,
        entries: budgetItems.filter(i => i.type === 'item').map(i => ({
          itemCode: i.item,
          partialQuantity: 0,
          partialValue: 0,
          partialPercentage: 0
        }))
      };
      return { ...p, partialReports: [...(p.partialReports || []), newReport] };
    }));
  };

  const updatePartialEntry = (
    projectId: string,
    reportId: string,
    itemCode: string,
    fields: { partialQuantity?: number; partialValue?: number; partialPercentage?: number }
  ) => {
    captureHistory();
    setProjects(prev => prev.map(p => {
      if (p.id !== projectId) return p;
      const activeVersion = p.budgetVersions?.find(v => v.id === p.activeBudgetVersionId);
      const budgetItems = activeVersion?.items || p.budgetItems || [];
      const item = budgetItems.find(i => i.item === itemCode || String(i.item) === String(itemCode));
      const unitPrice = item?.vlrUnitario || 0;
      const quantityBudget = item?.cantidad || 0;
      const valueBudget = item?.vlrTotal || 0;

      const newReports = (p.partialReports || []).map(r => {
        if (r.id !== reportId) return r;
        const newEntries = (r.entries || []).map(entry => {
          if (entry.itemCode !== itemCode && String(entry.itemCode) !== String(itemCode)) return entry;
          
          let partialQuantity = entry.partialQuantity ?? 0;
          let partialValue = entry.partialValue ?? 0;
          let partialPercentage = entry.partialPercentage ?? 0;

          if ('partialQuantity' in fields) {
            partialQuantity = fields.partialQuantity ?? 0;
            partialValue = partialQuantity * unitPrice;
            partialPercentage = valueBudget > 0 ? (partialValue / valueBudget) * 100 : 0;
          } else if ('partialValue' in fields) {
            partialValue = fields.partialValue ?? 0;
            partialQuantity = unitPrice > 0 ? partialValue / unitPrice : 0;
            partialPercentage = valueBudget > 0 ? (partialValue / valueBudget) * 100 : 0;
          } else if ('partialPercentage' in fields) {
            partialPercentage = fields.partialPercentage ?? 0;
            partialValue = (partialPercentage / 100) * valueBudget;
            partialQuantity = unitPrice > 0 ? partialValue / unitPrice : 0;
          }

          return {
            itemCode,
            partialQuantity,
            partialValue,
            partialPercentage
          };
        });
        return { ...r, entries: newEntries };
      });

      return { ...p, partialReports: newReports };
    }));
  };

  const removePartialReport = (projectId: string, reportId: string) => {
    captureHistory();
    setProjects(prev => prev.map(p => {
      if (String(p.id) !== String(projectId)) return p;
      return {
        ...p,
        partialReports: (p.partialReports || []).filter(r => String(r.id) !== String(reportId))
      };
    }));
  };

  const acceptAiProposal = (projectId: string, entryId: string) => {
    captureHistory();
    setProjects(prev => prev.map(p => {
      if (String(p.id) !== String(projectId)) return p;
      const newEntries = (p.logiEntries || []).map(e => {
        if (String(e.id) !== String(entryId) || !e.aiProposal) return e;
        return {
          ...e,
          itemCode: e.aiProposal.itemCode,
          description: e.aiProposal.description,
          aiProposal: undefined,
          status: 'integrated' as const
        };
      });
      return { ...p, logiEntries: newEntries };
    }));
  };

  const rejectAiProposal = (projectId: string, entryId: string) => {
    captureHistory();
    setProjects(prev => prev.map(p => {
      if (String(p.id) !== String(projectId)) return p;
      const newEntries = (p.logiEntries || []).map(e => {
        if (String(e.id) !== String(entryId)) return e;
        return { ...e, aiProposal: undefined };
      });
      return { ...p, logiEntries: newEntries };
    }));
  };

  const getPhotoLocalUrl = useCallback(async (entryId: string) => {
    if (globalBlobUrlCache.has(entryId)) {
      return globalBlobUrlCache.get(entryId)!;
    }
    const url = await photoDB.getPhotoBlobUrl(entryId);
    if (url) {
      globalBlobUrlCache.set(entryId, url);
    }
    return url;
  }, []);

  const migratePhotosToLocal = async (projectId: string) => {
    const project = projects.find(p => p.id === projectId);
    if (!project) return;

    try {
      const migratedIds = new Set<string>();
      // 1. Download all photos from Supabase and store them in IndexedDB
      for (const entry of project.logiEntries || []) {
        if (!entry.isLocal && entry.imageUrl) {
          try {
            const response = await fetch(entry.imageUrl);
            const blob = await response.blob();
            const reader = new FileReader();
            
            const base64Promise = new Promise<string>((resolve, reject) => {
              reader.onloadend = () => resolve(reader.result as string);
              reader.onerror = reject;
            });
            reader.readAsDataURL(blob);
            const base64Data = await base64Promise;
            
            await photoDB.savePhoto(entry.id, projectId, base64Data);
            migratedIds.add(entry.id);
          } catch (e) {
            console.error(`Error migrando foto ${entry.id}:`, e);
            // Si falla una, continuamos con el resto
          }
        } else if (entry.isLocal) {
          migratedIds.add(entry.id);
        }
      }

      // 2. Actualizar el estado para marcar solo las migradas exitosamente como isLocal: true
      captureHistory();
      setProjects(prev => prev.map(p => {
        if (String(p.id) !== String(projectId)) return p;
        const newEntries = (p.logiEntries || []).map(e => ({
          ...e,
          isLocal: migratedIds.has(e.id) ? true : e.isLocal
        }));
        return { ...p, logiEntries: newEntries };
      }));

      // 3. Exportar el archivo
      await exportLocalPhotosBackup(projectId);
      alert("Migración completada exitosamente.");
    } catch (error) {
      console.error("Error en migración:", error);
      alert("Ocurrió un error al migrar las fotos.");
    }
  };

  const exportLocalPhotosBackup = async (projectId: string) => {
    const project = projects.find(p => p.id === projectId);
    if (!project) return;

    try {
      const includePhotos = confirm(
        "¿Desea incluir las fotos locales (imágenes) en la copia de seguridad?\n\n" +
        "• presione Aceptar para incluir imágenes (se creará un archivo comprimido .lchp seguro).\n" +
        "• presione Cancelar para exportar solo la base de datos de textos y clasificaciones (ligero, rápido y seguro)."
      );

      let photos: any[] = [];
      let zipBlob: Blob | null = null;
      let dataStr = '';
      let isZipFile = false;

      if (includePhotos) {
        photos = await photoDB.getPhotosByProject(projectId);
        
        // Crear un archivo ZIP para evitar RangeError: Invalid string length
        const zip = new JSZip();
        
        // backup.json no contiene el base64 pesado de fotos, solo las clasificaciones y metadatos
        const backupData = {
          version: 1,
          projectId,
          projectName: project.name,
          entries: project.logiEntries || [],
          items: project.logiEntries || []
        };
        
        zip.file("backup.json", JSON.stringify(backupData));
        
        // Agregar cada foto como binario al ZIP
        for (const photo of photos) {
          if (photo.id && photo.base64Data) {
            const parts = photo.base64Data.split(',');
            const base64DataOnly = parts.length > 1 ? parts[1] : parts[0];
            
            let ext = 'jpg';
            if (parts[0].includes('image/png')) ext = 'png';
            else if (parts[0].includes('image/webp')) ext = 'webp';
            else if (parts[0].includes('image/gif')) ext = 'gif';
            
            zip.file(`photos/${photo.id}.${ext}`, base64DataOnly, { base64: true });
          }
        }
        
        zipBlob = await zip.generateAsync({ type: "blob" });
        isZipFile = true;
      } else {
        const backupData = {
          version: 1,
          projectId,
          projectName: project.name,
          entries: project.logiEntries || [],
          items: project.logiEntries || [],
          photos: []
        };
        dataStr = JSON.stringify(backupData);
      }

      const isElectron = !!(window as any).electronAPI;
      let savedUsingPicker = false;

      if ('showSaveFilePicker' in window && !isElectron) {
        try {
          const safeName = project.name.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
          const handle = await (window as any).showSaveFilePicker({
            suggestedName: `${safeName}_Fotos.lchp`,
            types: [{
              description: 'LCH Photos Backup',
              accept: { 'application/octet-stream': ['.lchp'] },
            }],
          });

          const writable = await handle.createWritable();
          if (isZipFile && zipBlob) {
            await writable.write(zipBlob);
          } else {
            await writable.write(dataStr);
          }
          await writable.close();
          savedUsingPicker = true;

          const flash = document.createElement('div');
          flash.innerText = "✓ Backup de Fotos (.lchp) Guardado";
          flash.style.position = 'fixed';
          flash.style.bottom = '70px';
          flash.style.right = '20px';
          flash.style.background = 'hsl(var(--accent-primary))';
          flash.style.color = '#000';
          flash.style.padding = '10px 20px';
          flash.style.borderRadius = '8px';
          flash.style.fontWeight = 'bold';
          flash.style.zIndex = '9999';
          document.body.appendChild(flash);
          setTimeout(() => flash.remove(), 2500);
        } catch (pickerErr: any) {
          if (pickerErr.name === 'AbortError') {
            return;
          }
          console.warn("showSaveFilePicker failed, falling back to traditional download method", pickerErr);
        }
      }

      if (!savedUsingPicker) {
        const blob = isZipFile && zipBlob ? zipBlob : new Blob([dataStr], { type: isZipFile ? 'application/zip' : 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const safeName = project.name.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
        a.download = `${safeName}_Fotos.lchp`;
        a.click();
        URL.revokeObjectURL(url);
      }
    } catch (error: any) {
      if (error.name !== 'AbortError') {
        console.error("Error al exportar fotos", error);
        alert("Ocurrió un error al intentar guardar el backup de fotos:\n" + (error.message || String(error)));
      }
    }
  };

  const importLocalPhotosBackup = async (projectId: string) => {
    try {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.lchp,.json,.zip';
      input.multiple = true;
      input.style.display = 'none';

      const filesSelectedPromise = new Promise<File[] | null>((resolve) => {
        input.onchange = (e: any) => {
          const files = e.target.files ? Array.from(e.target.files) as File[] : [];
          resolve(files.length > 0 ? files : null);
        };
        // Para cuando cancelan en navegadores o Electron que cierran sin selección
        window.addEventListener('focus', () => {
          setTimeout(() => {
            if (!input.files || input.files.length === 0) {
              resolve(null);
            }
          }, 600);
        }, { once: true });
      });

      document.body.appendChild(input);
      input.click();
      document.body.removeChild(input);

      const files = await filesSelectedPromise;
      if (!files || files.length === 0) return;

      let totalImportedPhotos = 0;
      let totalUpdatedEntries = 0;
      
      captureHistory();

      for (const file of files) {
        let backupData: any = null;
        
        // Detectar si el archivo es un ZIP leyendo los primeros 4 bytes mágicos (50 4B 03 04 -> PK\x03\x04)
        const headerBuffer = await file.slice(0, 4).arrayBuffer();
        const headerArr = new Uint8Array(headerBuffer);
        const isZip = (headerArr[0] === 0x50 && headerArr[1] === 0x4B && headerArr[2] === 0x03 && headerArr[3] === 0x04) ||
                      file.name.endsWith('.zip') || 
                      file.type === 'application/zip' || 
                      file.type === 'application/x-zip-compressed';
                      
        let imported = 0;
        const localPhotosArray: { id: string; base64Data: string }[] = [];
        let backupPhotos: any[] = [];

        if (isZip) {
          const zip = await JSZip.loadAsync(file);
          const bj = zip.file("backup.json");
          if (!bj) {
            throw new Error(`No se encontró backup.json dentro del archivo ZIP: ${file.name}`);
          }
          const jsonText = await bj.async("string");
          backupData = JSON.parse(jsonText);

          const items = backupData.items || [];
          if (!Array.isArray(items)) {
            throw new Error(`Estructura de backup de Logi inválida en ${file.name}`);
          }

          for (const item of items) {
            if (!item.id) continue;
            
            // Buscar la foto por su id en la carpeta 'photos/'
            const possiblePaths = [
              `photos/${item.id}.jpg`,
              `photos/${item.id}.jpeg`,
              `photos/${item.id}.png`,
              `photos/${item.id}.webp`,
              `photos/${item.id}.bin`,
              `photos/${projectId}/${item.id}.jpg`,
              `photos/${projectId}/${item.id}.jpeg`,
              `photos/${projectId}/${item.id}.png`,
              `photos/${projectId}/${item.id}.webp`
            ];
            
            let photoFile = null;
            for (const path of possiblePaths) {
              const zf = zip.file(path);
              if (zf) {
                photoFile = zf;
                break;
              }
            }

            if (!photoFile) {
              // Fallback buscar en todo el zip
              const filename = Object.keys(zip.files).find(name => name.includes(item.id) && !zip.files[name].dir);
              if (filename) {
                photoFile = zip.file(filename);
              }
            }

            if (photoFile) {
              const arrayBuffer = await photoFile.async("arraybuffer");
              const mimeType = item.mime || "image/jpeg";
              const blob = new Blob([arrayBuffer], { type: mimeType });
              const base64Data = await new Promise<string>((resolve, reject) => {
                const reader = new FileReader();
                reader.onloadend = () => resolve(reader.result as string);
                reader.onerror = reject;
                reader.readAsDataURL(blob);
              });

              await photoDB.savePhoto(item.id, projectId, base64Data);
              localPhotosArray.push({ id: item.id, base64Data });
              imported++;
            }
          }
        } else {
          const content = await file.text();
          backupData = JSON.parse(content);

          backupPhotos = backupData.photos || [];
          if (!backupData.entries && !backupData.items && !Array.isArray(backupData.photos)) {
            throw new Error(`Formato de archivo .lchp o .json inválido en ${file.name}`);
          }

          for (const photo of backupPhotos) {
            if (photo.id && photo.base64Data) {
              await photoDB.savePhoto(photo.id, projectId, photo.base64Data);
              localPhotosArray.push({ id: photo.id, base64Data: photo.base64Data });
              imported++;
            }
          }
        }

        totalImportedPhotos += imported;
        const backupEntries = backupData.entries || backupData.items || [];
        totalUpdatedEntries += backupEntries.length;

        // Integrar en el estado del proyecto
        setProjects(prev => prev.map(p => {
          if (String(p.id) !== String(projectId)) return p;
          
          const currentEntries = p.logiEntries || [];
          const updatedEntries = [...currentEntries];

          // 1. Integrar o actualizar las entradas del archivo .lchp V2 / Logi items
          backupEntries.forEach((newEntry: any) => {
            const existingIdx = updatedEntries.findIndex(e => String(e.id) === String(newEntry.id));
            const hasLocalPhoto = isZip
              ? localPhotosArray.some((ph: any) => String(ph.id) === String(newEntry.id))
              : backupPhotos.some((ph: any) => String(ph.id) === String(newEntry.id));
            
            const entryToUpsert = {
              id: String(newEntry.id),
              date: newEntry.date || newEntry.fecha || new Date().toISOString().split('T')[0],
              itemCode: String(newEntry.itemCode || "").trim(),
              description: String(newEntry.description || newEntry.descripcion || "").trim(),
              imageUrl: newEntry.imageUrl || "",
              isLocal: hasLocalPhoto ? true : !!newEntry.isLocal,
              status: (newEntry.status || (newEntry.done ? 'integrated' : 'pending')) as 'pending' | 'integrated'
            };

            if (existingIdx >= 0) {
              const localEntry = updatedEntries[existingIdx];
              
              // Priorizar datos clasificados del backup (no vacíos ni temporales)
              const backupHasCode = entryToUpsert.itemCode && entryToUpsert.itemCode.trim() !== '' && entryToUpsert.itemCode !== 'S/N' && entryToUpsert.itemCode !== 'General';
              const backupHasDesc = entryToUpsert.description && entryToUpsert.description.trim() !== '';
              const isLocalTemp = !localEntry.itemCode || localEntry.itemCode.trim() === '' || localEntry.itemCode === 'S/N' || localEntry.itemCode === 'General';
              
              updatedEntries[existingIdx] = {
                ...localEntry,
                ...entryToUpsert,
                imageUrl: entryToUpsert.imageUrl || localEntry.imageUrl || "",
                itemCode: (backupHasCode || isLocalTemp) ? entryToUpsert.itemCode : localEntry.itemCode,
                description: (backupHasDesc || isLocalTemp) ? entryToUpsert.description : localEntry.description,
                status: entryToUpsert.status === 'integrated' ? 'integrated' : localEntry.status
              };
            } else {
              updatedEntries.push(entryToUpsert);
            }
          });

          // 2. Para las entradas existentes que no venían en 'entries' pero su foto sí está en 'photos',
          // marcarlas como isLocal: true
          const finalEntries = updatedEntries.map(e => {
            const hasLocalPhoto = isZip
              ? localPhotosArray.some((ph: any) => String(ph.id) === String(e.id))
              : backupData.photos?.some((ph: any) => String(ph.id) === String(e.id));
            if (hasLocalPhoto) {
              return { ...e, isLocal: true };
            }
            return e;
          });

          return { ...p, logiEntries: finalEntries };
        }));
      }

      alert(`Sincronización en lote finalizada.\n\nSe importaron ${totalImportedPhotos} fotos y se actualizaron/crearon ${totalUpdatedEntries} entradas a partir de ${files.length} archivo(s).`);
    } catch (error: any) {
      console.error("Error importando fotos", error);
      alert("Error al intentar cargar los archivos: " + (error.message || String(error)));
    }
  };

  return (
    <ProjectsContext.Provider value={{
      projects,
      activeProjectId,
      addProject,
      updateProject,
      setActiveProject,
      getActiveProject,
      updateBudgetItemType,
      updateBudgetItemDates,
      addBudgetItem,
      updateBudgetItem,
      removeBudgetItem,
      importMsProjectXml,
      importBudgetExcel,
      addProgressReport,
      updateProgressEntry,
      importProgressEntries,
      removeProgressReport,
      addPartialReport,
      updatePartialEntry,
      removePartialReport,
      exportActiveProject,
      importProject,
      handleFileLaunch,
      closeProject,
      importLogiData,
      removeLogiEntry,
      removeLogiEntries,
      syncWithCloud,
      createBudgetVersion,
      switchActiveVersion,
      deleteBudgetVersion,
      renameBudgetVersion,
      duplicateBudgetVersion,
      columnWidths,
      updateColumnWidth,
      collapsedColumns,
      toggleColumnCollapse,
      acceptAiProposal,
      rejectAiProposal,
      undo,
      redo,
      canUndo: past.length > 0,
      canRedo: future.length > 0,
      migratePhotosToLocal,
      exportLocalPhotosBackup,
      importLocalPhotosBackup,
      getPhotoLocalUrl,
      currentView,
      setCurrentView,
      costsActiveTab,
      setCostsActiveTab,
      selectedPhotoId,
      setSelectedPhotoId,
      updateLogiEntry,
      updateLogiEntries,
      addPhotoReport,
      removePhotoReport,
      updatePhotoReport,
      addExecutiveReport,
      removeExecutiveReport,
      updateExecutiveReport
    }}>
      {children}
    </ProjectsContext.Provider>
  );
}

export function useProjects() {
  const context = useContext(ProjectsContext);
  if (context === undefined) {
    throw new Error('useProjects must be used within a ProjectsProvider');
  }
  return context;
}
