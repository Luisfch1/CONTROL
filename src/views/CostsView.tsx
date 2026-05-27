import { useState, useEffect, useRef, useMemo } from 'react';
import {
  DollarSign, Calculator, TrendingUp, Bot, Plus, Trash2, Edit, Save,
  AlertTriangle, Check, ArrowRight, Loader2, Sparkles, PlusCircle, 
  Eye, X, UploadCloud, FileText, ChevronDown, ChevronRight
} from 'lucide-react';
import { useProjects } from '../context/ProjectsContext';
import { extractApusFromPdf } from '../services/aiService';
import { apuFilesDB } from '../services/ApuDatabase';
import type { 
  BudgetItem, ActivityAPU, CostResource, CostTransaction, APUResource 
} from '../types/projectTypes';

export default function CostsView() {
  const { 
    activeProjectId, 
    projects, 
    updateProject, 
    costsActiveTab, 
    setCostsActiveTab 
  } = useProjects();

  const activeProject = useMemo(() => {
    return projects.find(p => p.id === activeProjectId);
  }, [projects, activeProjectId]);

  // Si no hay proyecto activo
  if (!activeProject) {
    return (
      <div className="card" style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        padding: 'var(--spacing-xl)', textAlign: 'center', minHeight: '300px', margin: '20px'
      }}>
        <AlertTriangle size={48} style={{ color: 'hsl(var(--warning))', marginBottom: 'var(--spacing-md)' }} />
        <h3 style={{ fontFamily: 'var(--font-technical)', marginBottom: 'var(--spacing-sm)' }}>
          NO HAY PROYECTO ACTIVO
        </h3>
        <p style={{ color: 'hsl(var(--text-secondary))', maxWidth: '400px', fontSize: '0.875rem' }}>
          Por favor, cree un proyecto nuevo o abra un archivo de proyecto (.lch) existente desde el Menú Archivo en la barra lateral para acceder al control de costos.
        </p>
      </div>
    );
  }

  // Inicializar subcolecciones si no existen en el proyecto
  const activityAPUs = activeProject.activityAPUs || [];
  const costResources = activeProject.costResources || [];
  const costTransactions = activeProject.costTransactions || [];

  // Pestaña secundaria para "Mis Costos" ('resources' | 'transactions')
  const [opSubTab, setOpSubTab] = useState<'resources' | 'transactions'>('transactions');

  // --- ESTADOS DE CONTRATO (APUs) ---
  const [selectedItemCode, setSelectedItemCode] = useState<string>('');
  const [apuFilterText, setApuFilterText] = useState('');
  
  // Estados para carga IA
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  // Estados para carga por lotes (Batch)
  const [isBatchLoading, setIsBatchLoading] = useState(false);
  const [batchMessage, setBatchMessage] = useState('');
  const [batchProgress, setBatchProgress] = useState<{ current: number; total: number } | null>(null);

  // Estados del visor de PDFs
  const [viewingPdfUrl, setViewingPdfUrl] = useState<string | null>(null);
  const [selectedPdfName, setSelectedPdfName] = useState<string | null>(null);

  // Formulario manual de recursos para el APU
  const [newApuResType, setNewApuResType] = useState<'materials' | 'labor' | 'equipment' | 'transport'>('materials');
  const [newApuResDesc, setNewApuResDesc] = useState('');
  const [newApuResUnit, setNewApuResUnit] = useState('und');
  const [newApuResQty, setNewApuResQty] = useState<number>(0);
  const [newApuResPrice, setNewApuResPrice] = useState<number>(0);

  // --- ESTADOS DE MIS COSTOS (Catálogo & Bitácora) ---
  // Formulario Catálogo
  const [newCatCode, setNewCatCode] = useState('');
  const [newCatDesc, setNewCatDesc] = useState('');
  const [newCatType, setNewCatType] = useState<'material' | 'labor' | 'equipment' | 'transport' | 'other'>('material');
  const [newCatUnit, setNewCatUnit] = useState('und');
  const [newCatPrice, setNewCatPrice] = useState<number>(0);

  // Formulario Egreso
  const [newTxDate, setNewTxDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [newTxItem, setNewTxItem] = useState('');
  const [newTxResId, setNewTxResId] = useState('');
  const [newTxDesc, setNewTxDesc] = useState('');
  const [newTxQty, setNewTxQty] = useState<number>(0);
  const [newTxPrice, setNewTxPrice] = useState<number>(0);
  const [newTxProvider, setNewTxProvider] = useState('');
  const [newTxInvoice, setNewTxInvoice] = useState('');

  // --- CONSULTAS Y CÁLCULOS GENERALES ---
  // Obtener la cantidad ejecutada acumulada para cada actividad
  const latestProgressReport = useMemo(() => {
    if (!activeProject.progressReports || activeProject.progressReports.length === 0) return null;
    return [...activeProject.progressReports].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())[0];
  }, [activeProject.progressReports]);

  const getExecutedQty = (itemCode: string) => {
    if (!latestProgressReport) return 0;
    const entry = latestProgressReport.entries.find(e => e.itemCode === itemCode);
    return entry ? entry.accumulatedQuantity : 0;
  };

  // Filtrar items del presupuesto que sean tipo 'item' (actividades facturables)
  const contractItems = useMemo(() => {
    return activeProject.budgetItems.filter(bi => bi.type === 'item');
  }, [activeProject.budgetItems]);

  // Filtrar actividades según buscador en pestaña Contrato
  const filteredApuItems = useMemo(() => {
    return contractItems.filter(bi => 
      bi.item.toLowerCase().includes(apuFilterText.toLowerCase()) ||
      bi.descripcion.toLowerCase().includes(apuFilterText.toLowerCase())
    );
  }, [contractItems, apuFilterText]);

  // Selección automática de la primera actividad si no hay seleccionada
  useEffect(() => {
    if (filteredApuItems.length > 0 && !selectedItemCode) {
      setSelectedItemCode(filteredApuItems[0].item);
    }
  }, [filteredApuItems, selectedItemCode]);

  // Actividad de contrato seleccionada actualmente para el APU
  const selectedBudgetItem = useMemo(() => {
    return contractItems.find(bi => bi.item === selectedItemCode);
  }, [contractItems, selectedItemCode]);

  // APU correspondiente a la actividad seleccionada
  const selectedAPU = useMemo(() => {
    return activityAPUs.find(apu => apu.itemCode === selectedItemCode);
  }, [activityAPUs, selectedItemCode]);

  // --- LOGICA DE ACTUALIZACIÓN DEL PROYECTO (IndexedDB & LocalStorage) ---
  const saveCostsData = (
    newAPUs: ActivityAPU[],
    newResources: CostResource[],
    newTransactions: CostTransaction[]
  ) => {
    // Clonamos la lista de recursos existente para actualizarla
    const updatedResources = [...newResources];

    // Mapeo de categorías del APU a tipos del CostResource
    const categoryMapping = {
      materials: 'material',
      labor: 'labor',
      equipment: 'equipment',
      transport: 'transport'
    } as const;

    // Prefijos para los códigos de recursos
    const prefixMapping = {
      material: 'MAT',
      labor: 'LAB',
      equipment: 'EQP',
      transport: 'TRA',
      other: 'OTH'
    } as const;

    // Obtener el siguiente código disponible para un tipo de recurso
    const getNextCode = (type: keyof typeof prefixMapping) => {
      const prefix = prefixMapping[type];
      const filtered = updatedResources.filter(r => r.code.startsWith(prefix + '-'));
      let maxNum = 0;
      filtered.forEach(r => {
        const parts = r.code.split('-');
        if (parts.length === 2) {
          const num = parseInt(parts[1], 10);
          if (!isNaN(num) && num > maxNum) {
            maxNum = num;
          }
        }
      });
      const nextNum = maxNum + 1;
      return `${prefix}-${String(nextNum).padStart(4, '0')}`;
    };

    let hasNew = false;

    // Escanear todos los APUs en busca de nuevos insumos
    newAPUs.forEach(apu => {
      (['materials', 'labor', 'equipment', 'transport'] as const).forEach(category => {
        const items = apu[category] || [];
        const resourceType = categoryMapping[category];

        items.forEach(item => {
          if (!item.description || !item.description.trim()) return;

          const cleanDesc = item.description.trim().toLowerCase();
          
          // Buscar si ya existe un insumo con la misma descripción y categoría
          const exists = updatedResources.some(
            r => r.description.trim().toLowerCase() === cleanDesc && r.type === resourceType
          );

          if (!exists) {
            const nextCode = getNextCode(resourceType);
            const newRes: CostResource = {
              id: `res-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
              code: nextCode,
              description: item.description.trim(),
              type: resourceType,
              unit: item.unit ? item.unit.trim() : 'und',
              referencePrice: Number(item.price || 0)
            };
            updatedResources.push(newRes);
            hasNew = true;
          }
        });
      });
    });

    updateProject(activeProject.id, {
      activityAPUs: newAPUs,
      costResources: updatedResources,
      costTransactions: newTransactions
    });

    if (hasNew) {
      console.log(`[Auto-Catalog Sync] Sincronizados nuevos insumos desde los APUs al catálogo de recursos.`);
    }
  };

  // --- MANEJADORES CONTRATO (APUs) ---
  const handleCreateEmptyAPU = () => {
    if (!selectedItemCode) return;
    const exists = activityAPUs.some(apu => apu.itemCode === selectedItemCode);
    if (exists) return;

    const newAPU: ActivityAPU = {
      itemCode: selectedItemCode,
      materials: [],
      labor: [],
      equipment: [],
      transport: []
    };

    saveCostsData([...activityAPUs, newAPU], costResources, costTransactions);
  };

  const handleAddApuResource = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedItemCode || !newApuResDesc.trim()) return;

    const targetAPUs = [...activityAPUs];
    let apuIndex = targetAPUs.findIndex(apu => apu.itemCode === selectedItemCode);

    if (apuIndex === -1) {
      // Crear APU si no existía
      const newAPU: ActivityAPU = {
        itemCode: selectedItemCode,
        materials: [],
        labor: [],
        equipment: [],
        transport: []
      };
      targetAPUs.push(newAPU);
      apuIndex = targetAPUs.length - 1;
    }

    const newResource: APUResource = {
      description: newApuResDesc.trim(),
      unit: newApuResUnit,
      quantity: Number(newApuResQty),
      price: Number(newApuResPrice),
      total: Number(newApuResQty) * Number(newApuResPrice)
    };

    targetAPUs[apuIndex][newApuResType].push(newResource);

    saveCostsData(targetAPUs, costResources, costTransactions);

    // Resetear formulario
    setNewApuResDesc('');
    setNewApuResUnit('und');
    setNewApuResQty(0);
    setNewApuResPrice(0);
  };

  const handleDeleteApuResource = (category: 'materials' | 'labor' | 'equipment' | 'transport', index: number) => {
    const targetAPUs = [...activityAPUs];
    const apuIndex = targetAPUs.findIndex(apu => apu.itemCode === selectedItemCode);
    if (apuIndex === -1) return;

    targetAPUs[apuIndex][category].splice(index, 1);
    saveCostsData(targetAPUs, costResources, costTransactions);
  };

  // --- NUEVA LÓGICA: CARGA Y ALMACENAMIENTO DE PDFs ---

  // Convertir archivo a base64
  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = (error) => reject(error);
    });
  };

  // Guardar archivo físicamente en disco o en IndexedDB (fallback web)
  const saveApuFileToStorage = async (fileName: string, base64Data: string) => {
    if ((window as any).electronAPI) {
      // Guardar localmente en la carpeta Documents/CONTROL_APUs/
      await (window as any).electronAPI.saveApuFile(activeProject.id, fileName, base64Data);
    } else {
      // Guardar en base de datos local IndexedDB
      await apuFilesDB.saveFile(fileName, activeProject.id, base64Data);
    }

    // Registrar en metadatos del proyecto
    const updatedApuFiles = [...(activeProject.apuFiles || [])];
    if (!updatedApuFiles.includes(fileName)) {
      updatedApuFiles.push(fileName);
      updateProject(activeProject.id, { apuFiles: updatedApuFiles });
    }
  };

  // Cargar PDF a nivel individual para la actividad seleccionada
  const handleSinglePdfUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !selectedItemCode) return;

    setIsAiLoading(true);
    setAiError(null);

    try {
      const base64Data = await fileToBase64(file);
      await saveApuFileToStorage(file.name, base64Data);

      // Contexto del contrato para Gemini
      const contractContext = contractItems.map(item => ({ item: item.item, descripcion: item.descripcion }));

      // Extraer desde Gemini
      const extractedList = await extractApusFromPdf(base64Data, contractContext, activeProject.geminiApiKey);

      // Intentar emparejar con la actividad seleccionada o tomar el primer APU del lote
      let apuData = extractedList.find(e => e.itemCode === selectedItemCode);
      if (!apuData && extractedList.length > 0) {
        apuData = extractedList[0];
      }

      if (apuData) {
        const targetAPUs = [...activityAPUs];
        const apuIdx = targetAPUs.findIndex(a => a.itemCode === selectedItemCode);
        const newApu: ActivityAPU = {
          itemCode: selectedItemCode,
          materials: apuData.materials,
          labor: apuData.labor,
          equipment: apuData.equipment,
          transport: apuData.transport,
          pdfFileName: file.name
        };

        if (apuIdx === -1) {
          targetAPUs.push(newApu);
        } else {
          targetAPUs[apuIdx] = newApu;
        }

        saveCostsData(targetAPUs, costResources, costTransactions);
        alert(`✨ APU del archivo "${file.name}" importado y estructurado con éxito.`);
      } else {
        throw new Error("No se pudo extraer ningún APU válido que corresponda a esta actividad desde el PDF.");
      }
    } catch (err: any) {
      console.error(err);
      setAiError(err.message || "Error al procesar el PDF.");
    } finally {
      setIsAiLoading(false);
      e.target.value = ''; // Limpiar input
    }
  };

  // Cargar grupo de PDFs masivamente (Batch Upload)
  const handleBatchPdfUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setIsBatchLoading(true);
    setBatchProgress(null);
    let updatedAPUs = [...activityAPUs];
    const updatedApuFiles = [...(activeProject.apuFiles || [])];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      setBatchMessage(`Procesando archivo ${i + 1} de ${files.length}: ${file.name}...`);

      try {
        const base64Data = await fileToBase64(file);
        
        // Guardar archivo localmente
        await saveApuFileToStorage(file.name, base64Data);
        if (!updatedApuFiles.includes(file.name)) {
          updatedApuFiles.push(file.name);
        }

        // Llamar a Gemini con el contexto de las actividades del presupuesto
        const contractContext = contractItems.map(item => ({ item: item.item, descripcion: item.descripcion }));
        const extracted = await extractApusFromPdf(
          base64Data, 
          contractContext, 
          activeProject.geminiApiKey,
          (current, total) => {
            setBatchProgress({ current, total });
            setBatchMessage(`Procesando archivo ${i + 1} de ${files.length}: ${file.name} (Bloque ${current} de ${total})...`);
          }
        );

        // Mapear cada APU extraído al presupuesto correspondiente
        extracted.forEach(item => {
          if (!item.itemCode) return;
          
          const apuIdx = updatedAPUs.findIndex(a => a.itemCode === item.itemCode);
          const newApu: ActivityAPU = {
            itemCode: item.itemCode,
            materials: item.materials,
            labor: item.labor,
            equipment: item.equipment,
            transport: item.transport,
            pdfFileName: file.name
          };

          if (apuIdx === -1) {
            updatedAPUs.push(newApu);
          } else {
            updatedAPUs[apuIdx] = newApu;
          }
        });
      } catch (err: any) {
        console.error(`Error al procesar el archivo ${file.name}:`, err);
        alert(`No se pudo procesar el archivo "${file.name}": ${err.message || err}`);
      }
    }

    saveCostsData(updatedAPUs, costResources, costTransactions);
    updateProject(activeProject.id, { apuFiles: updatedApuFiles });

    setIsBatchLoading(false);
    setBatchMessage('');
    setBatchProgress(null);
    e.target.value = ''; // Limpiar input
    alert("✨ Fusión masiva de PDFs de APUs completada.");
  };

  // Desvincular APU y borrar archivo físico si ya no se usa en otra actividad
  const handleUnlinkPdf = async (apu: ActivityAPU) => {
    const fileName = apu.pdfFileName;
    if (!fileName) return;

    const confirmClear = window.confirm(`¿Deseas desvincular el archivo "${fileName}" de esta actividad?`);
    if (!confirmClear) return;

    const targetAPUs = [...activityAPUs];
    const idx = targetAPUs.findIndex(a => a.itemCode === apu.itemCode);
    if (idx === -1) return;

    // Quitar la referencia en el APU
    targetAPUs[idx] = {
      ...targetAPUs[idx],
      pdfFileName: undefined
    };

    // Validar si el archivo PDF se sigue utilizando en algún otro APU del proyecto
    const isUsedElsewhere = targetAPUs.some(a => a.pdfFileName === fileName);
    let updatedApuFiles = [...(activeProject.apuFiles || [])];

    if (!isUsedElsewhere) {
      // Borrar el archivo físico de manera permanente
      try {
        if ((window as any).electronAPI) {
          await (window as any).electronAPI.deleteApuFile(activeProject.id, fileName);
        } else {
          await apuFilesDB.deleteFile(fileName);
        }
        updatedApuFiles = updatedApuFiles.filter(f => f !== fileName);
      } catch (e) {
        console.error("Error al borrar el archivo físico:", e);
      }
    }

    saveCostsData(targetAPUs, costResources, costTransactions);
    updateProject(activeProject.id, { apuFiles: updatedApuFiles });
  };

  // Abrir previsualización integrada de PDF en iframe
  const handleViewPdf = async (fileName: string) => {
    try {
      let dataUrl: string | null = null;

      if ((window as any).electronAPI) {
        dataUrl = await (window as any).electronAPI.readApuFile(activeProject.id, fileName);
      } else {
        dataUrl = await apuFilesDB.getFile(fileName);
      }

      if (!dataUrl) {
        alert("No se pudo cargar el archivo PDF desde el disco local.");
        return;
      }

      // Convertir base64 a Blob URL para mejor compatibilidad del visor iframe
      const cleanBase64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;
      const binary = atob(cleanBase64);
      const array = [];
      for (let i = 0; i < binary.length; i++) {
        array.push(binary.charCodeAt(i));
      }
      const blob = new Blob([new Uint8Array(array)], { type: 'application/pdf' });
      const blobUrl = URL.createObjectURL(blob);

      setViewingPdfUrl(blobUrl);
      setSelectedPdfName(fileName);
    } catch (e) {
      console.error(e);
      alert("Error al cargar la visualización del archivo.");
    }
  };

  const handleClosePdfViewer = () => {
    if (viewingPdfUrl) {
      URL.revokeObjectURL(viewingPdfUrl);
      setViewingPdfUrl(null);
      setSelectedPdfName(null);
    }
  };

  // --- MANEJADORES MIS COSTOS (Catálogo) ---
  const handleAddCatResource = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCatCode.trim() || !newCatDesc.trim()) return;

    const exists = costResources.some(cr => cr.code.toUpperCase() === newCatCode.toUpperCase());
    if (exists) {
      alert("Ya existe un insumo con este código en tu catálogo.");
      return;
    }

    const newResource: CostResource = {
      id: `res-${Date.now()}`,
      code: newCatCode.trim().toUpperCase(),
      description: newCatDesc.trim(),
      type: newCatType,
      unit: newCatUnit,
      referencePrice: Number(newCatPrice)
    };

    saveCostsData(activityAPUs, [...costResources, newResource], costTransactions);

    setNewCatCode('');
    setNewCatDesc('');
    setNewCatUnit('und');
    setNewCatPrice(0);
  };

  const handleDeleteCatResource = (id: string) => {
    const isUsed = costTransactions.some(tx => tx.resourceId === id);
    if (isUsed) {
      alert("No se puede eliminar este insumo del catálogo porque está registrado en transacciones de la bitácora.");
      return;
    }
    const filtered = costResources.filter(cr => cr.id !== id);
    saveCostsData(activityAPUs, filtered, costTransactions);
  };

  // --- MANEJADORES MIS COSTOS (Egresos) ---
  const handleSelectCatalogResource = (resId: string) => {
    setNewTxResId(resId);
    const res = costResources.find(cr => cr.id === resId);
    if (res) {
      setNewTxDesc(res.description);
      setNewTxPrice(res.referencePrice);
    }
  };

  const handleAddTransaction = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTxItem || !newTxDesc.trim() || newTxQty <= 0) {
      alert("Por favor completa los campos obligatorios y define una cantidad válida.");
      return;
    }

    const res = costResources.find(cr => cr.id === newTxResId);

    const newTx: CostTransaction = {
      id: `tx-${Date.now()}`,
      date: newTxDate,
      itemCode: newTxItem,
      resourceId: newTxResId || undefined,
      resourceType: res ? res.type : 'other',
      description: newTxDesc.trim(),
      quantity: Number(newTxQty),
      unitPrice: Number(newTxPrice),
      totalPrice: Number(newTxQty) * Number(newTxPrice),
      provider: newTxProvider.trim() || undefined,
      invoiceNumber: newTxInvoice.trim() || undefined
    };

    saveCostsData(activityAPUs, costResources, [...costTransactions, newTx]);

    setNewTxQty(0);
    setNewTxPrice(0);
    setNewTxDesc('');
    setNewTxResId('');
    setNewTxProvider('');
    setNewTxInvoice('');
  };

  const handleDeleteTransaction = (id: string) => {
    const filtered = costTransactions.filter(tx => tx.id !== id);
    saveCostsData(activityAPUs, costResources, filtered);
  };

  // --- CÁLCULOS DEL APU SELECCIONADO ---
  const apuTotals = useMemo(() => {
    if (!selectedAPU) return { materials: 0, labor: 0, equipment: 0, transport: 0, total: 0 };
    const sum = (arr: APUResource[]) => arr.reduce((acc, r) => acc + r.total, 0);
    const m = sum(selectedAPU.materials);
    const l = sum(selectedAPU.labor);
    const e = sum(selectedAPU.equipment);
    const t = sum(selectedAPU.transport);
    return {
      materials: m,
      labor: l,
      equipment: e,
      transport: t,
      total: m + l + e + t
    };
  }, [selectedAPU]);

  // --- CÁLCULOS GENERALES DEL DASHBOARD (Control) ---
  const financialSummary = useMemo(() => {
    let totalContractExecutedValue = 0; // Lo facturado al cliente en físico
    let totalEstimatedApuCost = 0;      // El costo que debió tener según APU
    let totalRealExpenseValue = 0;      // Egresos reales en bitácora

    contractItems.forEach(bi => {
      const executedQty = getExecutedQty(bi.item);
      totalContractExecutedValue += executedQty * bi.vlrUnitario;

      // Buscar APU
      const apu = activityAPUs.find(a => a.itemCode === bi.item);
      if (apu) {
        const apuUnitCost = 
          apu.materials.reduce((acc, r) => acc + r.total, 0) +
          apu.labor.reduce((acc, r) => acc + r.total, 0) +
          apu.equipment.reduce((acc, r) => acc + r.total, 0) +
          apu.transport.reduce((acc, r) => acc + r.total, 0);
        totalEstimatedApuCost += executedQty * apuUnitCost;
      }
    });

    totalRealExpenseValue = costTransactions.reduce((acc, tx) => acc + tx.totalPrice, 0);

    const marginReal = totalContractExecutedValue - totalRealExpenseValue;
    const marginPercent = totalContractExecutedValue > 0 ? (marginReal / totalContractExecutedValue) * 100 : 0;
    
    const apuDeviation = totalEstimatedApuCost - totalRealExpenseValue; // Si es negativo, gastamos más que el costo teórico

    return {
      executedIncome: totalContractExecutedValue,
      plannedCost: totalEstimatedApuCost,
      realCost: totalRealExpenseValue,
      marginReal,
      marginPercent,
      apuDeviation
    };
  }, [contractItems, activityAPUs, costTransactions, latestProgressReport]);

  return (
    <div className="costs-view-container" style={{
      display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden',
      animation: 'fadeInUp 0.3s ease-out'
    }}>
      
      {/* PDF Viewer Modal */}
      {viewingPdfUrl && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.92)',
          backdropFilter: 'blur(12px)',
          display: 'flex', flexDirection: 'column',
          zIndex: 99999,
          animation: 'fadeIn 0.2s ease'
        }}>
          {/* Modal Header */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '14px 24px',
            borderBottom: '1px solid hsla(0, 0%, 100%, 0.15)',
            background: 'hsl(var(--bg-secondary))',
            flexShrink: 0
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <Eye size={18} style={{ color: 'hsl(var(--accent-primary))' }} />
              <h3 style={{ margin: 0, fontSize: '0.85rem', fontFamily: 'var(--font-technical)', fontWeight: 'bold', color: 'hsl(var(--text-primary))' }}>
                {selectedPdfName || 'VISUALIZADOR DE PDF APU'}
              </h3>
            </div>
            <button
              onClick={handleClosePdfViewer}
              style={{
                background: 'rgba(255, 0, 80, 0.15)',
                border: '1px solid hsl(var(--danger))',
                color: 'hsl(var(--danger))',
                borderRadius: '6px',
                padding: '6px 14px',
                fontSize: '0.75rem',
                fontWeight: 'bold',
                cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: '6px'
              }}
            >
              <X size={14} /> CERRAR
            </button>
          </div>
          {/* PDF iframe */}
          <iframe
            src={viewingPdfUrl}
            title="Visualizador de PDF APU"
            style={{ flex: 1, border: 'none', width: '100%' }}
          />
        </div>
      )}

      {/* OVERLAY DE CARGA MASIVA (BATCH LOADING) */}
      {isBatchLoading && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(5, 5, 5, 0.92)', backdropFilter: 'blur(15px)',
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          zIndex: 99999, gap: '24px', padding: '40px'
        }}>
          {/* Contenedor del spinner con halo neon y animación de pulso */}
          <div style={{
            position: 'relative',
            width: '80px',
            height: '80px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}>
            <div style={{
              position: 'absolute',
              width: '100%',
              height: '100%',
              borderRadius: '50%',
              background: 'hsla(var(--primary-neon-hsl), 0.15)',
              filter: 'blur(15px)',
              animation: 'bot-pulse 2s infinite ease-in-out'
            }} />
            <Loader2 size={56} className="animate-spin" style={{ color: 'hsl(var(--primary-neon))', zIndex: 2 }} />
          </div>

          <div style={{ textAlign: 'center', maxWidth: '500px' }}>
            <h3 style={{
              fontFamily: 'var(--font-technical)',
              textTransform: 'uppercase',
              letterSpacing: '3px',
              fontSize: '1.1rem',
              color: '#fff',
              margin: '0 0 8px 0',
              textShadow: '0 0 10px hsla(var(--primary-neon-hsl), 0.4)'
            }}>
              PROCESANDO REGISTROS DE APUs
            </h3>
            <p style={{
              color: 'hsl(var(--text-muted))',
              fontSize: '0.75rem',
              fontFamily: 'monospace',
              letterSpacing: '1px',
              textTransform: 'uppercase',
              margin: 0
            }}>
              Extracción y mapeo semántico con IA de Gemini
            </p>
          </div>

          {/* Barra de progreso visual si tenemos información del bloque */}
          {batchProgress && (
            <div style={{ width: '100%', maxWidth: '400px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.725rem', color: 'hsl(var(--text-secondary))', fontFamily: 'monospace' }}>
                <span>PROGRESO DE EXTRACCIÓN</span>
                <span style={{ color: 'hsl(var(--primary-neon))', fontWeight: 'bold' }}>
                  {Math.round((batchProgress.current / batchProgress.total) * 100)}%
                </span>
              </div>
              
              {/* Pista física de la barra */}
              <div style={{
                width: '100%',
                height: '6px',
                background: 'rgba(255,255,255,0.05)',
                borderRadius: '10px',
                overflow: 'hidden',
                border: '1px solid rgba(255,255,255,0.08)'
              }}>
                <div style={{
                  width: `${(batchProgress.current / batchProgress.total) * 100}%`,
                  height: '100%',
                  background: 'linear-gradient(90deg, hsl(var(--primary-neon)) 0%, hsl(var(--accent-primary)) 100%)',
                  borderRadius: '10px',
                  boxShadow: '0 0 8px hsl(var(--primary-neon))',
                  transition: 'width 0.4s cubic-bezier(0.4, 0, 0.2, 1)'
                }} />
              </div>

              <div style={{
                textAlign: 'center',
                fontSize: '0.65rem',
                color: 'hsl(var(--text-muted))',
                fontFamily: 'monospace',
                marginTop: '4px'
              }}>
                Bloque {batchProgress.current} de {batchProgress.total} de actividades del contrato
              </div>
            </div>
          )}

          {/* Tarjeta de estado detallada */}
          <div className="glass-panel" style={{
            padding: '16px 24px',
            borderRadius: 'var(--radius-sm)',
            border: '1px solid hsla(var(--primary-neon-hsl), 0.2)',
            background: 'rgba(255, 255, 255, 0.02)',
            maxWidth: '550px',
            width: '100%',
            textAlign: 'center',
            boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)'
          }}>
            <p style={{
              color: 'hsl(var(--text-primary))',
              fontSize: '0.85rem',
              margin: 0,
              fontFamily: 'monospace',
              lineHeight: '1.4',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '10px'
            }}>
              <span className="alert-status-dot" style={{ color: 'hsl(var(--primary-neon))' }} />
              {batchMessage || 'Analizando estructura del documento...'}
            </p>
          </div>

          <div style={{
            fontSize: '0.7rem',
            color: 'hsl(var(--text-muted))',
            maxWidth: '350px',
            textAlign: 'center',
            lineHeight: '1.5',
            marginTop: '10px'
          }}>
            Por favor, no cierres la ventana. El procesamiento realiza lecturas profundas e introduce la información estructurada directamente a tu base de datos de costos.
          </div>
        </div>
      )}

      {/* HEADER DE PANTALLA */}
      <div className="page-header" style={{ flexShrink: 0, paddingBottom: 'var(--spacing-md)' }}>
        <div>
          <span className="technical-heading">ADMINISTRACIÓN FINANCIERA</span>
          <h2 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <DollarSign size={24} style={{ color: 'hsl(var(--accent-primary))' }} /> CONTROL DE COSTOS
          </h2>
        </div>

        {/* selectores de pestañas superiores */}
        <div style={{
          display: 'flex', gap: '8px', background: 'hsla(var(--bg-tertiary), 0.5)',
          padding: '4px', borderRadius: 'var(--radius-sm)', border: '1px solid hsl(var(--border-color))'
        }}>
          <button
            onClick={() => setCostsActiveTab('contract')}
            className={`btn ${costsActiveTab === 'contract' ? 'btn-primary' : 'btn-secondary'}`}
            style={{ padding: '6px 12px', fontSize: '0.75rem', height: 'auto' }}
          >
            📊 Contrato (APUs)
          </button>
          <button
            onClick={() => setCostsActiveTab('operation')}
            className={`btn ${costsActiveTab === 'operation' ? 'btn-primary' : 'btn-secondary'}`}
            style={{ padding: '6px 12px', fontSize: '0.75rem', height: 'auto' }}
          >
            🛒 Egresos y Catálogo
          </button>
          <button
            onClick={() => setCostsActiveTab('control')}
            className={`btn ${costsActiveTab === 'control' ? 'btn-primary' : 'btn-secondary'}`}
            style={{ padding: '6px 12px', fontSize: '0.75rem', height: 'auto' }}
          >
            🚨 Control de Desviaciones
          </button>
        </div>
      </div>

      {/* CUERPO DE PESTAÑAS */}
      <div className="viewport-body" style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        
        {/* --- PESTAÑA 1: CONTRATO (APUs) --- */}
        {costsActiveTab === 'contract' && (
          <div style={{ display: 'flex', gap: 'var(--spacing-md)', flex: 1, minHeight: 0 }}>
            {/* Actividades del Contrato (Lado Izquierdo) */}
            <div className="glass-panel" style={{
              width: '320px', display: 'flex', flexDirection: 'column', padding: 'var(--spacing-md)',
              borderRight: '1px solid var(--border-color)', flexShrink: 0
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                <h3 style={{ fontSize: '0.85rem', textTransform: 'uppercase', fontFamily: 'var(--font-technical)', margin: 0 }}>
                  Actividades de Obra
                </h3>

                {/* INPUT MASIVO DE PDFs */}
                <input
                  type="file"
                  multiple
                  accept="application/pdf"
                  id="batch-pdf-input"
                  onChange={handleBatchPdfUpload}
                  style={{ display: 'none' }}
                />
                <button
                  onClick={() => document.getElementById('batch-pdf-input')?.click()}
                  className="btn btn-secondary"
                  title="Cargar múltiples PDFs con APUs del proyecto para autodetectar desgloses"
                  style={{ padding: '4px 8px', fontSize: '0.65rem', display: 'flex', gap: '4px', height: 'auto' }}
                >
                  <UploadCloud size={12} /> Cargar PDFs
                </button>
              </div>
              
              <input
                type="text"
                value={apuFilterText}
                onChange={(e) => setApuFilterText(e.target.value)}
                placeholder="Buscar por código o descripción..."
                className="input-field"
                style={{ width: '100%', padding: '6px 10px', fontSize: '0.75rem', marginBottom: '12px' }}
              />

              <div className="floating-scroll" style={{ flex: 1, minHeight: 0 }}>
                {filteredApuItems.length === 0 ? (
                  <div style={{ fontSize: '0.75rem', color: 'hsl(var(--text-muted))', textAlign: 'center', padding: '20px' }}>
                    No se encontraron actividades.
                  </div>
                ) : (
                  filteredApuItems.map(bi => {
                    const apu = activityAPUs.find(a => a.itemCode === bi.item);
                    
                    // Calcular costo unitario del APU y si hay descuadre con el presupuesto
                    const apuTotal = apu
                      ? (apu.materials || []).reduce((acc, r) => acc + r.total, 0) +
                        (apu.labor || []).reduce((acc, r) => acc + r.total, 0) +
                        (apu.equipment || []).reduce((acc, r) => acc + r.total, 0) +
                        (apu.transport || []).reduce((acc, r) => acc + r.total, 0)
                      : 0;
                    const hasDiscrepancy = apu && Math.abs(apuTotal - bi.vlrUnitario) > 1.0;

                    return (
                      <div
                        key={bi.item}
                        onClick={() => setSelectedItemCode(bi.item)}
                        style={{
                          padding: '10px', cursor: 'pointer', borderRadius: 'var(--radius-sm)',
                          fontSize: '0.75rem', marginBottom: '6px', border: '1px solid transparent',
                          background: selectedItemCode === bi.item ? 'hsla(var(--primary-neon-hsl), 0.1)' : 'transparent',
                          borderColor: selectedItemCode === bi.item ? 'hsl(var(--primary-neon))' : 'transparent',
                          transition: 'all 0.2s', display: 'flex', justifyContent: 'space-between', alignItems: 'center'
                        }}
                      >
                        <div style={{ marginRight: '6px', overflow: 'hidden' }}>
                          <span style={{ fontWeight: 'bold', color: 'hsl(var(--accent-primary))', display: 'block' }}>
                            {bi.item}
                          </span>
                          <span style={{
                            color: selectedItemCode === bi.item ? 'hsl(var(--text-primary))' : 'hsl(var(--text-secondary))',
                            whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden', display: 'block'
                          }}>
                            {bi.descripcion}
                          </span>
                        </div>
                        {apu ? (
                          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '3px', flexShrink: 0 }}>
                            {hasDiscrepancy && (
                              <span className="badge" style={{ 
                                fontSize: '0.55rem', 
                                padding: '1px 5px',
                                background: 'rgba(234, 179, 8, 0.15)',
                                border: '1px solid hsl(var(--warning))',
                                color: 'hsl(var(--warning))',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '2px'
                              }}>
                                ⚠️ Descuadre
                              </span>
                            )}
                            <span className="badge badge-success" style={{ fontSize: '0.55rem', padding: '1px 5px' }}>
                              APU
                            </span>
                            {apu.pdfFileName && (
                              <span title={`Origen: ${apu.pdfFileName}`}>
                                <FileText size={10} style={{ color: 'hsl(var(--accent-primary))' }} />
                              </span>
                            )}
                          </div>
                        ) : (
                          <span style={{ fontSize: '0.55rem', color: 'hsl(var(--text-muted))', flexShrink: 0 }}>
                            s/APU
                          </span>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {/* Detalle del APU (Lado Derecho) */}
            <div className="glass-panel" style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: 'var(--spacing-lg)', minWidth: 0 }}>
              {selectedBudgetItem ? (
                <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
                  
                  {/* Encabezado del Item de Contrato */}
                  <div style={{
                    borderBottom: '1px solid var(--border-color)', paddingBottom: 'var(--spacing-md)',
                    marginBottom: 'var(--spacing-md)', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
                    flexShrink: 0
                  }}>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.8rem', color: 'hsl(var(--text-muted))' }}>
                        <span>ACTIVIDAD SELECCIONADA</span>
                        <ArrowRight size={12} />
                        <span style={{ fontWeight: 'bold', color: 'hsl(var(--accent-primary))' }}>{selectedBudgetItem.item}</span>
                      </div>
                      <h3 style={{ fontSize: '1.2rem', fontFamily: 'var(--font-technical)', margin: '4px 0 8px 0' }}>
                        {selectedBudgetItem.descripcion}
                      </h3>
                      <div style={{ display: 'flex', gap: '20px', fontSize: '0.75rem', color: 'hsl(var(--text-secondary))' }}>
                        <span>Unidad: <strong>{selectedBudgetItem.unidad}</strong></span>
                        <span>Cantidad Contrato: <strong>{selectedBudgetItem.cantidad.toLocaleString()}</strong></span>
                        <span>Tarifa Contratada (Venta): <strong>${selectedBudgetItem.vlrUnitario.toLocaleString()}</strong></span>
                      </div>
                    </div>

                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: '0.65rem', color: 'hsl(var(--text-muted))', letterSpacing: '1px' }}>COSTO ESTIMADO APU</div>
                      <div style={{
                        fontSize: '1.5rem', fontFamily: 'var(--font-technical)', fontWeight: 'bold',
                        color: apuTotals.total > selectedBudgetItem.vlrUnitario ? 'hsl(var(--danger))' : 'hsl(var(--primary-neon))'
                      }}>
                        ${apuTotals.total.toLocaleString()}
                      </div>
                      <div style={{ fontSize: '0.7rem', color: 'hsl(var(--text-secondary))' }}>
                        Margen Teórico Unitario:{' '}
                        <strong style={{
                          color: selectedBudgetItem.vlrUnitario - apuTotals.total >= 0 ? 'hsl(var(--success))' : 'hsl(var(--danger))'
                        }}>
                          ${(selectedBudgetItem.vlrUnitario - apuTotals.total).toLocaleString()} ({
                            selectedBudgetItem.vlrUnitario > 0 
                              ? Math.round(((selectedBudgetItem.vlrUnitario - apuTotals.total) / selectedBudgetItem.vlrUnitario) * 100) 
                              : 0
                          }%)
                        </strong>
                      </div>
                    </div>
                  </div>

                  {/* Cuerpo del APU */}
                  {!selectedAPU ? (
                    <div style={{
                      flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                      textAlign: 'center', gap: '20px', padding: '40px'
                    }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        <Calculator size={36} style={{ color: 'hsl(var(--text-muted))', margin: '0 auto' }} />
                        <span style={{ fontSize: '0.85rem', color: 'hsl(var(--text-secondary))' }}>
                          Esta actividad no cuenta con Análisis de Precios Unitarios (APU) registrado en el proyecto.
                        </span>
                      </div>
                      
                      <div style={{ display: 'flex', gap: '12px' }}>
                        <button onClick={handleCreateEmptyAPU} className="btn btn-secondary" style={{ fontSize: '0.75rem' }}>
                          <Plus size={14} /> Estructurar Manualmente
                        </button>
                      </div>

                      {/* PDF Uploader Card */}
                      <div style={{
                        width: '100%', maxWidth: '500px', border: '1px solid hsla(var(--primary-neon-hsl), 0.2)',
                        padding: '20px', borderRadius: 'var(--radius-md)', background: 'hsla(var(--bg-tertiary), 0.3)',
                        textAlign: 'left', marginTop: '10px', display: 'flex', flexDirection: 'column', gap: '10px'
                      }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <Bot size={16} style={{ color: 'hsl(var(--primary-neon))' }} />
                          <span style={{ fontSize: '0.8rem', fontWeight: 'bold', fontFamily: 'var(--font-technical)' }}>
                            ASISTENTE EXTRACCIÓN CON IA (GEMINI)
                          </span>
                        </div>
                        <p style={{ fontSize: '0.7rem', color: 'hsl(var(--text-muted))', margin: 0 }}>
                          Sube el documento PDF de APU correspondiente a esta actividad. La IA de Gemini leerá el archivo y poblará la estructura de costos automáticamente.
                        </p>

                        <input
                          type="file"
                          accept="application/pdf"
                          id="single-pdf-input"
                          onChange={handleSinglePdfUpload}
                          style={{ display: 'none' }}
                        />

                        {aiError && (
                          <div style={{ fontSize: '0.7rem', color: 'hsl(var(--danger))' }}>
                            ⚠️ {aiError}
                          </div>
                        )}

                        <button
                          onClick={() => document.getElementById('single-pdf-input')?.click()}
                          disabled={isAiLoading}
                          className="btn btn-primary animate-pulse"
                          style={{ width: '100%', padding: '10px', fontSize: '0.75rem', display: 'flex', gap: '8px' }}
                        >
                          {isAiLoading ? (
                            <>
                              <Loader2 size={14} className="animate-spin" /> Analizando PDF...
                            </>
                          ) : (
                            <>
                              <UploadCloud size={14} /> Cargar PDF de APU de Actividad
                            </>
                          )}
                        </button>
                      </div>

                    </div>
                  ) : (
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                      
                      {/* Alerta de Descuadre de Tarifa del APU frente al Presupuesto de Venta */}
                      {Math.abs(apuTotals.total - selectedBudgetItem.vlrUnitario) > 1.0 && (
                        <div style={{
                          display: 'flex',
                          alignItems: 'flex-start',
                          gap: '12px',
                          background: 'rgba(234, 179, 8, 0.1)',
                          border: '1px solid hsl(var(--warning))',
                          padding: '12px 16px',
                          borderRadius: 'var(--radius-sm)',
                          marginBottom: '12px',
                          fontSize: '0.75rem',
                          lineHeight: '1.4',
                          flexShrink: 0
                        }}>
                          <AlertTriangle size={18} style={{ color: 'hsl(var(--warning))', flexShrink: 0, marginTop: '2px' }} />
                          <div style={{ flex: 1 }}>
                            <strong style={{ color: 'hsl(var(--warning))', display: 'block', marginBottom: '2px' }}>
                              ⚠️ ADVERTENCIA: DESVIACIÓN DE TARIFA APU
                            </strong>
                            <span>
                              El costo total unitario del APU (<strong>${apuTotals.total.toLocaleString()}</strong>) no coincide con la tarifa unitaria de venta pactada en el presupuesto (<strong>${selectedBudgetItem.vlrUnitario.toLocaleString()}</strong>). Existe un descuadre de <strong>${(apuTotals.total - selectedBudgetItem.vlrUnitario).toLocaleString()}</strong>.
                            </span>
                          </div>
                        </div>
                      )}

                      {/* Mostrar enlace de PDF de APU de la actividad */}
                      {selectedAPU.pdfFileName && (
                        <div style={{
                          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                          background: 'hsla(var(--primary-neon-hsl), 0.05)',
                          border: '1px solid hsla(var(--primary-neon-hsl), 0.2)',
                          padding: '8px 12px', borderRadius: 'var(--radius-sm)', marginBottom: '12px',
                          fontSize: '0.75rem', flexShrink: 0
                        }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <FileText size={16} style={{ color: 'hsl(var(--primary-neon))' }} />
                            <span>Extraído del archivo: <strong>{selectedAPU.pdfFileName}</strong></span>
                          </div>

                          <div style={{ display: 'flex', gap: '10px' }}>
                            <button
                              onClick={() => handleViewPdf(selectedAPU.pdfFileName!)}
                              className="btn btn-secondary"
                              style={{ padding: '2px 8px', fontSize: '0.65rem', display: 'flex', gap: '4px', height: 'auto' }}
                            >
                              <Eye size={12} /> Ver PDF
                            </button>
                            <button
                              onClick={() => handleUnlinkPdf(selectedAPU)}
                              className="btn btn-ghost"
                              style={{ padding: '2px 8px', fontSize: '0.65rem', display: 'flex', gap: '4px', height: 'auto', color: 'hsl(var(--danger))' }}
                            >
                              <Trash2 size={12} /> Desvincular
                            </button>
                          </div>
                        </div>
                      )}

                      {/* Formulario de Agregar Recurso al APU */}
                      <form onSubmit={handleAddApuResource} style={{
                        display: 'grid', gridTemplateColumns: '120px 1fr 60px 100px 100px auto', gap: '8px',
                        padding: '10px', background: 'hsla(var(--bg-tertiary), 0.5)', borderRadius: 'var(--radius-sm)',
                        border: '1px solid var(--border-color)', marginBottom: '12px', flexShrink: 0, alignItems: 'end'
                      }}>
                        <div className="input-group" style={{ margin: 0 }}>
                          <span className="input-label" style={{ fontSize: '0.6rem' }}>Categoría</span>
                          <select
                            value={newApuResType}
                            onChange={(e: any) => setNewApuResType(e.target.value)}
                            className="input-field"
                            style={{ padding: '4px 6px', fontSize: '0.7rem', height: '30px' }}
                          >
                            <option value="materials">Materiales</option>
                            <option value="labor">Mano de Obra</option>
                            <option value="equipment">Equipos</option>
                            <option value="transport">Transporte</option>
                          </select>
                        </div>
                        
                        <div className="input-group" style={{ margin: 0 }}>
                          <span className="input-label" style={{ fontSize: '0.6rem' }}>Descripción Insumo</span>
                          <input
                            type="text"
                            required
                            value={newApuResDesc}
                            onChange={(e) => setNewApuResDesc(e.target.value)}
                            placeholder="Ej: Mezcla concreto..."
                            className="input-field"
                            style={{ padding: '4px 6px', fontSize: '0.7rem', height: '30px' }}
                          />
                        </div>

                        <div className="input-group" style={{ margin: 0 }}>
                          <span className="input-label" style={{ fontSize: '0.6rem' }}>Unidad</span>
                          <input
                            type="text"
                            required
                            value={newApuResUnit}
                            onChange={(e) => setNewApuResUnit(e.target.value)}
                            placeholder="kg"
                            className="input-field"
                            style={{ padding: '4px 6px', fontSize: '0.7rem', height: '30px' }}
                          />
                        </div>

                        <div className="input-group" style={{ margin: 0 }}>
                          <span className="input-label" style={{ fontSize: '0.6rem' }}>Cant/Rend</span>
                          <input
                            type="number"
                            required
                            step="any"
                            value={newApuResQty}
                            onChange={(e) => setNewApuResQty(Number(e.target.value))}
                            className="input-field"
                            style={{ padding: '4px 6px', fontSize: '0.7rem', height: '30px' }}
                          />
                        </div>

                        <div className="input-group" style={{ margin: 0 }}>
                          <span className="input-label" style={{ fontSize: '0.6rem' }}>Valor Unitario</span>
                          <input
                            type="number"
                            required
                            value={newApuResPrice}
                            onChange={(e) => setNewApuResPrice(Number(e.target.value))}
                            className="input-field"
                            style={{ padding: '4px 6px', fontSize: '0.7rem', height: '30px' }}
                          />
                        </div>

                        <button type="submit" className="btn btn-primary" style={{ height: '30px', padding: '0 10px', fontSize: '0.7rem' }}>
                          <Plus size={12} /> Agregar
                        </button>
                      </form>

                      {/* Lista de Insumos del APU Agrupados */}
                      <div className="floating-scroll" style={{ flex: 1, minHeight: 0 }}>
                        
                        {(['materials', 'labor', 'equipment', 'transport'] as const).map(category => {
                          const list = selectedAPU[category] || [];
                          const categoryTitle = 
                            category === 'materials' ? 'Materiales' :
                            category === 'labor' ? 'Mano de Obra' :
                            category === 'equipment' ? 'Equipos e Herramientas' : 'Transporte';
                          
                          if (list.length === 0) return null;

                          return (
                            <div key={category} style={{ marginBottom: '16px' }}>
                              <h4 style={{
                                fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '1px',
                                borderBottom: '1px solid hsla(var(--border-color), 0.2)', paddingBottom: '4px',
                                marginBottom: '8px', color: 'hsl(var(--accent-primary))'
                              }}>
                                {categoryTitle}
                              </h4>
                              
                              <table className="data-table" style={{ fontSize: '0.7rem' }}>
                                <thead>
                                  <tr>
                                    <th style={{ width: '40%' }}>Insumo</th>
                                    <th style={{ width: '10%', textAlign: 'center' }}>Unidad</th>
                                    <th style={{ width: '15%', textAlign: 'right' }}>Cant/Rend</th>
                                    <th style={{ width: '15%', textAlign: 'right' }}>Precio Unit.</th>
                                    <th style={{ width: '15%', textAlign: 'right' }}>Costo Total</th>
                                    <th style={{ width: '5%', textAlign: 'center' }}>Acciones</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {list.map((res, index) => {
                                    // Buscar si este insumo ya existe registrado en la base de datos del catálogo (costResources)
                                    const catRes = costResources.find(r => 
                                      r.description.trim().toLowerCase() === res.description.trim().toLowerCase() &&
                                      r.type === (
                                        category === 'materials' ? 'material' :
                                        category === 'labor' ? 'labor' :
                                        category === 'equipment' ? 'equipment' : 'transport'
                                      )
                                    );

                                    return (
                                      <tr key={index}>
                                        <td style={{ verticalAlign: 'middle' }}>
                                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                                            {catRes && (
                                              <span style={{ 
                                                color: 'hsl(var(--accent-primary))', 
                                                fontWeight: 'bold', 
                                                fontFamily: 'monospace',
                                                background: 'hsla(var(--primary-neon-hsl), 0.1)',
                                                border: '1px solid hsla(var(--primary-neon-hsl), 0.2)',
                                                padding: '1px 4px',
                                                borderRadius: '3px',
                                                fontSize: '0.65rem',
                                                lineHeight: '1.2'
                                              }}>
                                                {catRes.code}
                                              </span>
                                            )}
                                            <span>{res.description}</span>
                                          </div>
                                        </td>
                                        <td className="cell-center">{res.unit}</td>
                                        <td className="cell-right">{res.quantity.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 4 })}</td>
                                        <td className="cell-right">${res.price.toLocaleString()}</td>
                                        <td className="cell-right">${res.total.toLocaleString()}</td>
                                        <td className="cell-center">
                                          <button
                                            onClick={() => handleDeleteApuResource(category, index)}
                                            style={{ background: 'transparent', color: 'hsl(var(--danger))', cursor: 'pointer' }}
                                            title="Borrar insumo"
                                          >
                                            <Trash2 size={12} />
                                          </button>
                                        </td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </div>
                          );
                        })}

                        {apuTotals.total === 0 && (
                          <div style={{ padding: '40px', textAlign: 'center', fontSize: '0.75rem', color: 'hsl(var(--text-muted))' }}>
                            Aún no se han agregado insumos al APU. Usa el formulario superior o carga un PDF de APU.
                          </div>
                        )}
                      </div>

                      {/* IA Extractor Opcional (Para APUs existentes) */}
                      {!selectedAPU.pdfFileName && (
                        <div style={{
                          borderTop: '1px solid var(--border-color)', paddingTop: '10px', marginTop: '10px',
                          display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0
                        }}>
                          <span style={{ fontSize: '0.7rem', color: 'hsl(var(--text-muted))' }}>
                            💡 Tip: Puedes poblar/sobrescribir este APU cargando un nuevo documento PDF.
                          </span>
                          
                          <button
                            onClick={() => document.getElementById('single-pdf-input')?.click()}
                            className="btn btn-secondary"
                            style={{ padding: '4px 8px', fontSize: '0.65rem', display: 'flex', gap: '4px' }}
                          >
                            <Sparkles size={10} /> Sobrescribir con PDF
                          </button>
                        </div>
                      )}

                    </div>
                  )}

                </div>
              ) : (
                <div style={{
                  flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: 'hsl(var(--text-muted))', fontSize: '0.85rem'
                }}>
                  Selecciona una actividad de obra en el panel izquierdo para ver o estructurar su APU.
                </div>
              )}
            </div>
          </div>
        )}

        {/* --- PESTAÑA 2: EGRESOS Y CATALOGO --- */}
        {costsActiveTab === 'operation' && (
          <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
            {/* Navegación interna (Egresos vs Catálogo) */}
            <div style={{ display: 'flex', gap: '15px', borderBottom: '1px solid var(--border-color)', paddingBottom: '8px', marginBottom: '12px', flexShrink: 0 }}>
              <button
                onClick={() => setOpSubTab('transactions')}
                style={{
                  background: 'transparent', color: opSubTab === 'transactions' ? 'hsl(var(--primary-neon))' : 'hsl(var(--text-secondary))',
                  fontWeight: 'bold', fontSize: '0.8rem', borderBottom: opSubTab === 'transactions' ? '2px solid hsl(var(--primary-neon))' : 'none',
                  paddingBottom: '4px', cursor: 'pointer', fontFamily: 'var(--font-technical)'
                }}
              >
                📝 BITÁCORA DE EGRESOS (Compras / Pagos)
              </button>
              <button
                onClick={() => setOpSubTab('resources')}
                style={{
                  background: 'transparent', color: opSubTab === 'resources' ? 'hsl(var(--primary-neon))' : 'hsl(var(--text-secondary))',
                  fontWeight: 'bold', fontSize: '0.8rem', borderBottom: opSubTab === 'resources' ? '2px solid hsl(var(--primary-neon))' : 'none',
                  paddingBottom: '4px', cursor: 'pointer', fontFamily: 'var(--font-technical)'
                }}
              >
                📋 CATÁLOGO DE INSUMOS
              </button>
            </div>

            {/* Sub-vista A: Bitácora de Egresos */}
            {opSubTab === 'transactions' && (
              <div style={{ display: 'flex', gap: 'var(--spacing-md)', flex: 1, minHeight: 0 }}>
                {/* Formulario de Egreso (Lado Izquierdo) */}
                <form onSubmit={handleAddTransaction} className="glass-panel" style={{
                  width: '320px', display: 'flex', flexDirection: 'column', padding: 'var(--spacing-md)',
                  flexShrink: 0, gap: '10px'
                }}>
                  <h3 style={{ fontSize: '0.85rem', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '4px', fontFamily: 'var(--font-technical)' }}>
                    Registrar Compra / Pago
                  </h3>

                  <div className="input-group" style={{ margin: 0 }}>
                    <span className="input-label">Fecha</span>
                    <input
                      type="date"
                      required
                      value={newTxDate}
                      onChange={(e) => setNewTxDate(e.target.value)}
                      className="input-field"
                      style={{ padding: '6px 8px', fontSize: '0.75rem' }}
                    />
                  </div>

                  <div className="input-group" style={{ margin: 0 }}>
                    <span className="input-label">Actividad Asociada *</span>
                    <select
                      required
                      value={newTxItem}
                      onChange={(e) => setNewTxItem(e.target.value)}
                      className="input-field"
                      style={{ padding: '6px 8px', fontSize: '0.75rem' }}
                    >
                      <option value="">-- Selecciona Actividad --</option>
                      {contractItems.map(bi => (
                        <option key={bi.item} value={bi.item}>
                          {bi.item} - {bi.descripcion}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="input-group" style={{ margin: 0 }}>
                    <span className="input-label">Asociar Insumo del Catálogo</span>
                    <select
                      value={newTxResId}
                      onChange={(e) => handleSelectCatalogResource(e.target.value)}
                      className="input-field"
                      style={{ padding: '6px 8px', fontSize: '0.75rem' }}
                    >
                      <option value="">-- Sin insumo (Texto libre) --</option>
                      {costResources.map(cr => (
                        <option key={cr.id} value={cr.id}>
                          [{cr.code}] {cr.description} ({cr.unit})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="input-group" style={{ margin: 0 }}>
                    <span className="input-label">Descripción Detalle *</span>
                    <input
                      type="text"
                      required
                      value={newTxDesc}
                      onChange={(e) => setNewTxDesc(e.target.value)}
                      placeholder="Ej: Compra de 50 bultos de cemento..."
                      className="input-field"
                      style={{ padding: '6px 8px', fontSize: '0.75rem' }}
                    />
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                    <div className="input-group" style={{ margin: 0 }}>
                      <span className="input-label">Cantidad *</span>
                      <input
                        type="number"
                        required
                        step="any"
                        value={newTxQty}
                        onChange={(e) => setNewTxQty(Number(e.target.value))}
                        className="input-field"
                        style={{ padding: '6px 8px', fontSize: '0.75rem' }}
                      />
                    </div>
                    <div className="input-group" style={{ margin: 0 }}>
                      <span className="input-label">Precio Unitario *</span>
                      <input
                        type="number"
                        required
                        value={newTxPrice}
                        onChange={(e) => setNewTxPrice(Number(e.target.value))}
                        className="input-field"
                        style={{ padding: '6px 8px', fontSize: '0.75rem' }}
                      />
                    </div>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                    <div className="input-group" style={{ margin: 0 }}>
                      <span className="input-label">Proveedor</span>
                      <input
                        type="text"
                        value={newTxProvider}
                        onChange={(e) => setNewTxProvider(e.target.value)}
                        placeholder="Ferretería..."
                        className="input-field"
                        style={{ padding: '6px 8px', fontSize: '0.75rem' }}
                      />
                    </div>
                    <div className="input-group" style={{ margin: 0 }}>
                      <span className="input-label">Nro Soporte</span>
                      <input
                        type="text"
                        value={newTxInvoice}
                        onChange={(e) => setNewTxInvoice(e.target.value)}
                        placeholder="Fact-987..."
                        className="input-field"
                        style={{ padding: '6px 8px', fontSize: '0.75rem' }}
                      />
                    </div>
                  </div>

                  <div style={{
                    marginTop: '4px', fontSize: '0.8rem', color: 'hsl(var(--text-muted))',
                    display: 'flex', justifyContent: 'space-between', padding: '6px',
                    background: 'hsla(var(--bg-tertiary), 0.3)', borderRadius: '4px'
                  }}>
                    <span>TOTAL REGISTRO:</span>
                    <strong style={{ color: 'hsl(var(--primary-neon))' }}>
                      ${(newTxQty * newTxPrice).toLocaleString()}
                    </strong>
                  </div>

                  <button type="submit" className="btn btn-primary" style={{ width: '100%', padding: '8px', fontSize: '0.8rem' }}>
                    <PlusCircle size={14} /> Registrar en Bitácora
                  </button>
                </form>

                {/* Tabla de Egresos Registrados (Lado Derecho) */}
                <div className="glass-panel" style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: 'var(--spacing-md)', minWidth: 0 }}>
                  <h3 style={{ fontSize: '0.9rem', marginBottom: '10px', textTransform: 'uppercase', fontFamily: 'var(--font-technical)' }}>
                    Bitácora de Egresos (Total Gastado: ${costTransactions.reduce((a, t) => a + t.totalPrice, 0).toLocaleString()})
                  </h3>

                  <div className="floating-scroll" style={{ flex: 1, minHeight: 0 }}>
                    {costTransactions.length === 0 ? (
                      <div style={{ padding: '40px', textAlign: 'center', fontSize: '0.8rem', color: 'hsl(var(--text-muted))' }}>
                        Aún no se han registrado transacciones o egresos en el proyecto.
                      </div>
                    ) : (
                      <table className="data-table" style={{ fontSize: '0.7rem' }}>
                        <thead>
                          <tr>
                            <th style={{ width: '10%' }}>Fecha</th>
                            <th style={{ width: '10%' }}>Actividad</th>
                            <th style={{ width: '10%' }}>Tipo</th>
                            <th style={{ width: '30%' }}>Descripción / Proveedor</th>
                            <th style={{ width: '10%', textAlign: 'right' }}>Cant.</th>
                            <th style={{ width: '12%', textAlign: 'right' }}>Val. Unit.</th>
                            <th style={{ width: '13%', textAlign: 'right' }}>Total</th>
                            <th style={{ width: '5%', textAlign: 'center' }}>Acciones</th>
                          </tr>
                        </thead>
                        <tbody>
                          {costTransactions.map(tx => (
                            <tr key={tx.id}>
                              <td>{tx.date}</td>
                              <td><strong style={{ color: 'hsl(var(--accent-primary))' }}>{tx.itemCode}</strong></td>
                              <td>
                                <span className="badge" style={{
                                  fontSize: '0.55rem', padding: '1px 5px',
                                  background: tx.resourceType === 'labor' ? 'rgba(0,229,255,0.1)' : 'rgba(255,255,255,0.05)',
                                  color: tx.resourceType === 'labor' ? 'hsl(var(--accent-primary))' : 'inherit'
                                }}>
                                  {tx.resourceType}
                                </span>
                              </td>
                              <td>
                                <div>{tx.description}</div>
                                {(tx.provider || tx.invoiceNumber) && (
                                  <div style={{ fontSize: '0.6rem', color: 'hsl(var(--text-muted))' }}>
                                    {tx.provider && `Prov: ${tx.provider}`} {tx.invoiceNumber && `| Soporte: ${tx.invoiceNumber}`}
                                  </div>
                                )}
                              </td>
                              <td className="cell-right">{tx.quantity.toLocaleString()}</td>
                              <td className="cell-right">${tx.unitPrice.toLocaleString()}</td>
                              <td className="cell-right"><strong style={{ color: 'hsl(var(--primary-neon))' }}>${tx.totalPrice.toLocaleString()}</strong></td>
                              <td className="cell-center">
                                <button
                                  onClick={() => handleDeleteTransaction(tx.id)}
                                  style={{ background: 'transparent', color: 'hsl(var(--danger))', cursor: 'pointer' }}
                                  title="Borrar transacción"
                                >
                                  <Trash2 size={12} />
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Sub-vista B: Catálogo de Insumos */}
            {opSubTab === 'resources' && (
              <div style={{ display: 'flex', gap: 'var(--spacing-md)', flex: 1, minHeight: 0 }}>
                {/* Crear Recurso (Lado Izquierdo) */}
                <form onSubmit={handleAddCatResource} className="glass-panel" style={{
                  width: '320px', display: 'flex', flexDirection: 'column', padding: 'var(--spacing-md)',
                  flexShrink: 0, gap: '12px'
                }}>
                  <h3 style={{ fontSize: '0.85rem', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '4px', fontFamily: 'var(--font-technical)' }}>
                    Nuevo Insumo
                  </h3>

                  <div className="input-group" style={{ margin: 0 }}>
                    <span className="input-label">Código Insumo *</span>
                    <input
                      type="text"
                      required
                      value={newCatCode}
                      onChange={(e) => setNewCatCode(e.target.value)}
                      placeholder="Ej: MAT-01, MO-12..."
                      className="input-field"
                      style={{ padding: '6px 8px', fontSize: '0.75rem' }}
                    />
                  </div>

                  <div className="input-group" style={{ margin: 0 }}>
                    <span className="input-label">Descripción *</span>
                    <input
                      type="text"
                      required
                      value={newCatDesc}
                      onChange={(e) => setNewCatDesc(e.target.value)}
                      placeholder="Ej: Bulto cemento gris..."
                      className="input-field"
                      style={{ padding: '6px 8px', fontSize: '0.75rem' }}
                    />
                  </div>

                  <div className="input-group" style={{ margin: 0 }}>
                    <span className="input-label">Tipo</span>
                    <select
                      value={newCatType}
                      onChange={(e: any) => setNewCatType(e.target.value)}
                      className="input-field"
                      style={{ padding: '6px 8px', fontSize: '0.75rem' }}
                    >
                      <option value="material">Material</option>
                      <option value="labor">Mano de Obra</option>
                      <option value="equipment">Equipo/Herramienta</option>
                      <option value="transport">Transporte</option>
                      <option value="other">Otro</option>
                    </select>
                  </div>

                  <div className="input-group" style={{ margin: 0 }}>
                    <span className="input-label">Unidad de Medida</span>
                    <input
                      type="text"
                      required
                      value={newCatUnit}
                      onChange={(e) => setNewCatUnit(e.target.value)}
                      placeholder="Ej: bto, kg, h..."
                      className="input-field"
                      style={{ padding: '6px 8px', fontSize: '0.75rem' }}
                    />
                  </div>

                  <div className="input-group" style={{ margin: 0 }}>
                    <span className="input-label">Precio Referencia *</span>
                    <input
                      type="number"
                      required
                      value={newCatPrice}
                      onChange={(e) => setNewCatPrice(Number(e.target.value))}
                      className="input-field"
                      style={{ padding: '6px 8px', fontSize: '0.75rem' }}
                    />
                  </div>

                  <button type="submit" className="btn btn-primary" style={{ width: '100%', padding: '8px', fontSize: '0.8rem' }}>
                    <Plus size={14} /> Registrar Insumo
                  </button>
                </form>

                {/* Tabla del Catálogo (Lado Derecho) */}
                <div className="glass-panel" style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: 'var(--spacing-md)', minWidth: 0 }}>
                  <h3 style={{ fontSize: '0.9rem', marginBottom: '10px', textTransform: 'uppercase', fontFamily: 'var(--font-technical)' }}>
                    Catálogo de Insumos Registrados
                  </h3>

                  <div className="floating-scroll" style={{ flex: 1, minHeight: 0 }}>
                    {costResources.length === 0 ? (
                      <div style={{ padding: '40px', textAlign: 'center', fontSize: '0.8rem', color: 'hsl(var(--text-muted))' }}>
                        El catálogo está vacío. Utiliza el formulario izquierdo para alimentar los insumos de referencia.
                      </div>
                    ) : (
                      <table className="data-table" style={{ fontSize: '0.7rem' }}>
                        <thead>
                          <tr>
                            <th style={{ width: '15%' }}>Código</th>
                            <th style={{ width: '40%' }}>Descripción</th>
                            <th style={{ width: '15%' }}>Tipo</th>
                            <th style={{ width: '10%', textAlign: 'center' }}>Unidad</th>
                            <th style={{ width: '15%', textAlign: 'right' }}>Precio Referencia</th>
                            <th style={{ width: '5%', textAlign: 'center' }}>Acciones</th>
                          </tr>
                        </thead>
                        <tbody>
                          {costResources.map(cr => (
                            <tr key={cr.id}>
                              <td><strong style={{ color: 'hsl(var(--accent-primary))' }}>{cr.code}</strong></td>
                              <td>{cr.description}</td>
                              <td>
                                <span className="badge" style={{
                                  fontSize: '0.55rem', padding: '1px 5px',
                                  background: 'hsla(var(--primary-neon-hsl), 0.05)',
                                  color: 'hsl(var(--text-primary))'
                                }}>
                                  {cr.type}
                                </span>
                              </td>
                              <td className="cell-center">{cr.unit}</td>
                              <td className="cell-right">${cr.referencePrice.toLocaleString()}</td>
                              <td className="cell-center">
                                <button
                                  onClick={() => handleDeleteCatResource(cr.id)}
                                  style={{ background: 'transparent', color: 'hsl(var(--danger))', cursor: 'pointer' }}
                                  title="Borrar insumo"
                                >
                                  <Trash2 size={12} />
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* --- PESTAÑA 3: CONTROL FINANCIERO (Dashboard) --- */}
        {costsActiveTab === 'control' && (
          <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, gap: 'var(--spacing-md)' }}>
            
            {/* KPI Cards Row */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px', flexShrink: 0 }}>
              
              <div className="glass-card" style={{ padding: '16px', display: 'flex', flexDirection: 'column' }}>
                <span style={{ fontSize: '0.65rem', color: 'hsl(var(--text-muted))', letterSpacing: '1px', textTransform: 'uppercase' }}>
                  Ingresos Ejecutados (Venta)
                </span>
                <strong style={{ fontSize: '1.4rem', fontFamily: 'var(--font-technical)', margin: '4px 0' }}>
                  ${financialSummary.executedIncome.toLocaleString()}
                </strong>
                <span style={{ fontSize: '0.6rem', color: 'hsl(var(--text-secondary))' }}>
                  Suma de (Cant. Ejecutada * Precio Contrato)
                </span>
              </div>

              <div className="glass-card" style={{ padding: '16px', display: 'flex', flexDirection: 'column' }}>
                <span style={{ fontSize: '0.65rem', color: 'hsl(var(--text-muted))', letterSpacing: '1px', textTransform: 'uppercase' }}>
                  Costo Estimado APU
                </span>
                <strong style={{ fontSize: '1.4rem', fontFamily: 'var(--font-technical)', margin: '4px 0', color: 'hsl(var(--accent-primary))' }}>
                  ${financialSummary.plannedCost.toLocaleString()}
                </strong>
                <span style={{ fontSize: '0.6rem', color: 'hsl(var(--text-secondary))' }}>
                  Suma de (Cant. Ejecutada * Costo APU)
                </span>
              </div>

              <div className="glass-card" style={{ padding: '16px', display: 'flex', flexDirection: 'column' }}>
                <span style={{ fontSize: '0.65rem', color: 'hsl(var(--text-muted))', letterSpacing: '1px', textTransform: 'uppercase' }}>
                  Egresos Reales (Pagos)
                </span>
                <strong style={{ fontSize: '1.4rem', fontFamily: 'var(--font-technical)', margin: '4px 0', color: 'hsl(var(--warning))' }}>
                  ${financialSummary.realCost.toLocaleString()}
                </strong>
                <span style={{ fontSize: '0.6rem', color: 'hsl(var(--text-secondary))' }}>
                  Suma de todos los egresos registrados
                </span>
              </div>

              <div className="glass-card" style={{
                padding: '16px', display: 'flex', flexDirection: 'column',
                borderLeft: `4px solid ${financialSummary.marginReal >= 0 ? 'hsl(var(--success))' : 'hsl(var(--danger))'}`
              }}>
                <span style={{ fontSize: '0.65rem', color: 'hsl(var(--text-muted))', letterSpacing: '1px', textTransform: 'uppercase' }}>
                  Margen Real Acumulado
                </span>
                <strong style={{
                  fontSize: '1.4rem', fontFamily: 'var(--font-technical)', margin: '4px 0',
                  color: financialSummary.marginReal >= 0 ? 'hsl(var(--success))' : 'hsl(var(--danger))'
                }}>
                  ${financialSummary.marginReal.toLocaleString()} ({Math.round(financialSummary.marginPercent)}%)
                </strong>
                <span style={{ fontSize: '0.6rem', color: 'hsl(var(--text-secondary))' }}>
                  Diferencia: Ejecutado - Egresos Reales
                </span>
              </div>

            </div>

            {/* Fila de Controles y Alertas */}
            <div style={{ display: 'flex', gap: '16px', flex: 1, minHeight: 0 }}>
              
              {/* Tabla de Desviaciones por Actividad */}
              <div className="glass-panel" style={{ flex: 2, display: 'flex', flexDirection: 'column', padding: 'var(--spacing-md)', minWidth: 0 }}>
                <h3 style={{ fontSize: '0.9rem', marginBottom: '10px', textTransform: 'uppercase', fontFamily: 'var(--font-technical)', display: 'flex', justifyContent: 'space-between' }}>
                  <span>Control de Desviaciones por Actividad</span>
                  <span style={{ fontSize: '0.7rem', color: 'hsl(var(--text-muted))' }}>Cruzado con Avance Físico</span>
                </h3>

                <div className="floating-scroll" style={{ flex: 1, minHeight: 0 }}>
                  <table className="data-table" style={{ fontSize: '0.7rem' }}>
                    <thead>
                      <tr>
                        <th style={{ width: '8%' }}>Código</th>
                        <th style={{ width: '22%' }}>Actividad Presupuesto</th>
                        <th style={{ width: '8%', textAlign: 'right' }}>Cant. Ejec.</th>
                        <th style={{ width: '12%', textAlign: 'right' }}>Cobrado Cliente</th>
                        <th style={{ width: '12%', textAlign: 'right' }}>Est. APU Unit</th>
                        <th style={{ width: '12%', textAlign: 'right' }}>Est. APU Total</th>
                        <th style={{ width: '12%', textAlign: 'right' }}>Gastado Real</th>
                        <th style={{ width: '14%', textAlign: 'right' }}>Margen Real</th>
                      </tr>
                    </thead>
                    <tbody>
                      {contractItems.map(bi => {
                        const executedQty = getExecutedQty(bi.item);
                        const incomeVal = executedQty * bi.vlrUnitario;

                        // Buscar APU
                        const apu = activityAPUs.find(a => a.itemCode === bi.item);
                        const apuUnitCost = apu 
                          ? apu.materials.reduce((acc, r) => acc + r.total, 0) +
                            apu.labor.reduce((acc, r) => acc + r.total, 0) +
                            apu.equipment.reduce((acc, r) => acc + r.total, 0) +
                            apu.transport.reduce((acc, r) => acc + r.total, 0)
                          : 0;
                        const apuTotalCost = executedQty * apuUnitCost;

                        // Buscar egresos reales asociados a este ítem en la bitácora
                        const realCost = costTransactions
                          .filter(tx => tx.itemCode === bi.item)
                          .reduce((acc, tx) => acc + tx.totalPrice, 0);

                        const marginReal = incomeVal - realCost;
                        const hasLoss = realCost > apuTotalCost && apuTotalCost > 0;
                        
                        // Validar descuadre entre APU y Presupuesto
                        const hasApuDiscrepancy = apu && Math.abs(apuUnitCost - bi.vlrUnitario) > 1.0;

                        return (
                          <tr key={bi.item} style={{
                            background: hasLoss ? 'rgba(255, 0, 80, 0.04)' : 'transparent'
                          }}>
                            <td><strong style={{ color: 'hsl(var(--accent-primary))' }}>{bi.item}</strong></td>
                            <td style={{
                              whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden', maxWidth: '200px'
                            }} title={bi.descripcion}>
                              {bi.descripcion}
                            </td>
                            <td className="cell-right">{executedQty.toLocaleString()}</td>
                            <td className="cell-right">${incomeVal.toLocaleString()}</td>
                            <td className="cell-right" style={{
                              color: hasApuDiscrepancy ? 'hsl(var(--warning))' : 'inherit',
                              fontWeight: hasApuDiscrepancy ? 'bold' : 'normal'
                            }}>
                              {hasApuDiscrepancy && (
                                <span title={`Descuadre de tarifa de APU vs Contrato. Presupuestado: $${bi.vlrUnitario.toLocaleString()}`} style={{ marginRight: '4px', cursor: 'help' }}>
                                  ⚠️
                                </span>
                              )}
                              ${apuUnitCost.toLocaleString()}
                            </td>
                            <td className="cell-right" style={{ color: 'hsl(var(--text-secondary))' }}>
                              ${apuTotalCost.toLocaleString()}
                            </td>
                            <td className="cell-right" style={{
                              color: realCost > apuTotalCost && apuTotalCost > 0 ? 'hsl(var(--danger))' : 'inherit'
                            }}>
                              ${realCost.toLocaleString()}
                            </td>
                            <td className="cell-right" style={{
                              color: marginReal >= 0 ? 'hsl(var(--success))' : 'hsl(var(--danger))',
                              fontWeight: 'bold'
                            }}>
                              ${marginReal.toLocaleString()}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Panel de Alertas Financieras y Consumos */}
              <div className="glass-panel" style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: 'var(--spacing-md)', minWidth: 0 }}>
                <h3 style={{ fontSize: '0.9rem', marginBottom: '10px', textTransform: 'uppercase', fontFamily: 'var(--font-technical)' }}>
                  Alertas y Análisis de Consumos
                </h3>

                <div className="floating-scroll" style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  
                  {/* Generar alertas de pérdidas reales */}
                  {contractItems.map(bi => {
                    const executedQty = getExecutedQty(bi.item);
                    const apu = activityAPUs.find(a => a.itemCode === bi.item);
                    if (!apu) return null;

                    const apuUnitCost = 
                      apu.materials.reduce((acc, r) => acc + r.total, 0) +
                      apu.labor.reduce((acc, r) => acc + r.total, 0) +
                      apu.equipment.reduce((acc, r) => acc + r.total, 0) +
                      apu.transport.reduce((acc, r) => acc + r.total, 0);

                    const apuTotalCost = executedQty * apuUnitCost;
                    const realCost = costTransactions
                      .filter(tx => tx.itemCode === bi.item)
                      .reduce((acc, tx) => acc + tx.totalPrice, 0);

                    if (realCost > apuTotalCost && apuTotalCost > 0) {
                      const loss = realCost - apuTotalCost;
                      return (
                        <div key={bi.item} style={{
                          border: '1px solid hsl(var(--danger))', background: 'rgba(255,0,80,0.05)',
                          padding: '10px', borderRadius: 'var(--radius-sm)', fontSize: '0.75rem'
                        }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'hsl(var(--danger))', fontWeight: 'bold', marginBottom: '4px' }}>
                            <AlertTriangle size={14} />
                            <span>DESVIACIÓN EN {bi.item}</span>
                          </div>
                          <p style={{ color: 'hsl(var(--text-secondary))', fontSize: '0.7rem' }}>
                            El egreso registrado (<strong>${realCost.toLocaleString()}</strong>) supera el costo estimado del APU de contrato (<strong>${apuTotalCost.toLocaleString()}</strong>) en <strong>${loss.toLocaleString()}</strong>.
                          </p>
                        </div>
                      );
                    }
                    return null;
                  })}

                  {/* Alertas de Descuadre de APU frente al Presupuesto */}
                  {contractItems.map(bi => {
                    const apu = activityAPUs.find(a => a.itemCode === bi.item);
                    if (!apu) return null;

                    const apuUnitCost = 
                      apu.materials.reduce((acc, r) => acc + r.total, 0) +
                      apu.labor.reduce((acc, r) => acc + r.total, 0) +
                      apu.equipment.reduce((acc, r) => acc + r.total, 0) +
                      apu.transport.reduce((acc, r) => acc + r.total, 0);

                    if (Math.abs(apuUnitCost - bi.vlrUnitario) > 1.0) {
                      const diff = apuUnitCost - bi.vlrUnitario;
                      return (
                        <div key={`descuadre-${bi.item}`} style={{
                          border: '1px solid hsl(var(--warning))', background: 'rgba(234,179,8,0.05)',
                          padding: '10px', borderRadius: 'var(--radius-sm)', fontSize: '0.75rem'
                        }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'hsl(var(--warning))', fontWeight: 'bold', marginBottom: '4px' }}>
                            <AlertTriangle size={14} />
                            <span>DESCUADRE DE APU EN {bi.item}</span>
                          </div>
                          <p style={{ color: 'hsl(var(--text-secondary))', fontSize: '0.7rem' }}>
                            El costo unitario estimado del APU (<strong>${apuUnitCost.toLocaleString()}</strong>) no coincide con el valor unitario contratado (<strong>${bi.vlrUnitario.toLocaleString()}</strong>). Desviación: <strong>${diff.toLocaleString()}</strong>.
                          </p>
                        </div>
                      );
                    }
                    return null;
                  })}

                  {/* Alertas de APU Faltantes en ítems ejecutados */}
                  {contractItems.map(bi => {
                    const executedQty = getExecutedQty(bi.item);
                    const hasApu = activityAPUs.some(a => a.itemCode === bi.item);
                    
                    if (executedQty > 0 && !hasApu) {
                      return (
                        <div key={bi.item} style={{
                          border: '1px solid hsl(var(--warning))', background: 'rgba(255,170,0,0.05)',
                          padding: '10px', borderRadius: 'var(--radius-sm)', fontSize: '0.75rem'
                        }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'hsl(var(--warning))', fontWeight: 'bold', marginBottom: '4px' }}>
                            <AlertTriangle size={14} />
                            <span>APU FALTANTE</span>
                          </div>
                          <p style={{ color: 'hsl(var(--text-secondary))', fontSize: '0.7rem' }}>
                            La actividad <strong>{bi.item}</strong> ya registra avance ejecutado (<strong>{executedQty} {bi.unidad}</strong>) pero no tiene un APU estructurado para estimar su costo teórico.
                          </p>
                        </div>
                      );
                    }
                    return null;
                  })}

                  {/* Estado Saludable */}
                  {financialSummary.executedIncome > 0 && financialSummary.marginReal >= 0 && (
                    <div style={{
                      border: '1px solid hsl(var(--success))', background: 'rgba(0,255,100,0.05)',
                      padding: '10px', borderRadius: 'var(--radius-sm)', fontSize: '0.75rem',
                      display: 'flex', alignItems: 'flex-start', gap: '8px'
                    }}>
                      <Check size={16} style={{ color: 'hsl(var(--success))', flexShrink: 0 }} />
                      <div>
                        <strong style={{ color: 'hsl(var(--success))', display: 'block', marginBottom: '2px' }}>
                          PROYECTO FINANCIERAMENTE SANO
                        </strong>
                        <span style={{ fontSize: '0.7rem', color: 'hsl(var(--text-secondary))' }}>
                          Los egresos reales están dentro de los márgenes presupuestados de la facturación ejecutada. Margen del {Math.round(financialSummary.marginPercent)}%.
                        </span>
                      </div>
                    </div>
                  )}

                  {financialSummary.executedIncome === 0 && (
                    <div style={{ padding: '20px', textAlign: 'center', fontSize: '0.75rem', color: 'hsl(var(--text-muted))' }}>
                      No hay avance físico reportado en el proyecto para generar análisis de desviaciones de consumos.
                    </div>
                  )}

                </div>
              </div>

            </div>

          </div>
        )}

      </div>
    </div>
  );
}
