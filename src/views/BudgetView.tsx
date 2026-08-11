import { useRef, useState } from 'react';
import { Edit, Trash2, X, Download, Upload, Smartphone, Plus, Save, FilePlus, Folder, Copy, CheckCircle, AlertCircle } from 'lucide-react';
import { useProjects } from '../context/ProjectsContext';
import type { BudgetItem } from '../types/projectTypes';
import { exportToExcel } from '../utils/excelExport';
import { parseRobustNumber } from '../utils/mathUtils';

const normalizeHeader = (val: any): string => {
  if (val === null || val === undefined) return '';
  return String(val).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
};

export default function BudgetView() {
  const {
    getActiveProject,
    updateProject,
    updateBudgetItemType,
    updateBudgetItem,
    importBudgetExcel,
    addBudgetItem,
    removeBudgetItem,
    createBudgetVersion,
    switchActiveVersion,
    deleteBudgetVersion,
    renameBudgetVersion,
    duplicateBudgetVersion,
    columnWidths,
    updateColumnWidth,
    collapsedColumns,
    toggleColumnCollapse,
    closeProject
  } = useProjects();
  const project = getActiveProject();
  const [viewMode, setViewMode] = useState<'table' | 'folder'>('table');
  const [editingRowIndex, setEditingRowIndex] = useState<number | null>(null);
  const [editValues, setEditValues] = useState<Partial<BudgetItem>>({});
  const [showVersions, setShowVersions] = useState(false);
  const [showNameModal, setShowNameModal] = useState(false);
  const [newName, setNewName] = useState('');
  const [modalMode, setModalMode] = useState<'saveAs' | 'rename' | 'create'>('saveAs');
  const [targetVersionId, setTargetVersionId] = useState<string | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [showDiffs, setShowDiffs] = useState(false);
  const [importMode, setImportMode] = useState<'overwrite' | 'newScenario'>('overwrite');
  // Modal dual para crear nuevo presupuesto
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createModalName, setCreateModalName] = useState('');
  const [createModalMethod, setCreateModalMethod] = useState<'duplicate' | 'excel' | null>(null);
  const excelImportRef = useRef<HTMLInputElement>(null);
  const colWidths = columnWidths.budget;
  const getColWidth = (key: string) => collapsedColumns.budget.includes(key) ? 30 : colWidths[key];

  const fileInputRef = useRef<HTMLInputElement>(null);
  const activeVersion = project?.budgetVersions?.find(v => v.id === project.activeBudgetVersionId);
  const budgetItems = activeVersion?.items || project?.budgetItems || [];

  // Si no hay versiones pero sí hay items legacy, crear una versión virtual para mostrar en la carpeta
  const effectiveVersions = (() => {
    if (!project) return [];
    const versions = project.budgetVersions || [];
    if (versions.length > 0) return versions;
    // Fallback: si hay items en budgetItems, crear entrada virtual
    if ((project.budgetItems || []).length > 0) {
      return [{ id: '__legacy__', name: 'Presupuesto Principal', createdAt: project.createdAt || new Date().toISOString(), items: project.budgetItems }];
    }
    return [];
  })();

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(value);
  };

  const handleExportExcel = () => {
    if (!project || budgetItems.length === 0) return;

    const dataToExport = budgetItems.map(item => ({
      'Ítem': item.item,
      'Descripción': item.descripcion,
      'Unidad': item.type === 'item' ? item.unidad : '',
      'Cantidad': item.type === 'item' ? item.cantidad : '',
      'Vr. Unitario': item.type === 'item' ? item.vlrUnitario : '',
      'Vr. Total': item.type === 'item' ? item.vlrTotal : '',
      'Tipo': item.type.toUpperCase()
    }));

    exportToExcel(dataToExport, `Presupuesto_${project.name.replace(/\s+/g, '_')}`, 'Presupuesto');
  };

  const handleDownloadTemplate = () => {
    const templateData = [
      {
        'Ítem': '1',
        'Descripción': 'TÍTULO CAPÍTULO EJEMPLO',
        'Unidad': '',
        'Cantidad': '',
        'Vr. Unitario': '',
        'VLR. TOTAL': ''
      },
      {
        'Ítem': '1.1',
        'Descripción': 'SUBTÍTULO EJEMPLO',
        'Unidad': '',
        'Cantidad': '',
        'Vr. Unitario': '',
        'VLR. TOTAL': ''
      },
      {
        'Ítem': '1.1.1',
        'Descripción': 'Ejemplo de Actividad / Ítem contractual',
        'Unidad': 'm2',
        'Cantidad': 100,
        'Vr. Unitario': 25000,
        'VLR. TOTAL': 2500000
      }
    ];
    exportToExcel(templateData, 'Plantilla_Presupuesto_CONTROL', 'Presupuesto');
  };

  const handleExportLogi = () => {
    if (!project || budgetItems.length === 0) return;

    const dataToExport = budgetItems
      .filter(item => item.type === 'item')
      .map(item => ({
        'ITEM': item.item,
        'DESCRIPCION': item.descripcion,
        'UNIDAD': item.unidad
      }));

    exportToExcel(dataToExport, `Insumo_Logi_${project.name.replace(/\s+/g, '_')}`, 'Logi_Items');
  };

  const handleImportExcelClick = () => {
    setImportMode('overwrite');
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !project) return;

    try {
      const { read, utils } = await import('xlsx');
      const data = await file.arrayBuffer();
      const workbook = read(data);

      const sheetName = workbook.SheetNames.includes('Presupuesto') ? 'Presupuesto' : workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      const rows = utils.sheet_to_json<any[]>(worksheet, { header: 1 });

      let total = 0;
      const parsedItems: BudgetItem[] = [];

      let headerRowIdx = -1;
      for (let i = 0; i < Math.min(20, rows.length); i++) {
        const row = rows[i];
        if (row && normalizeHeader(row[0]).includes('ITEM')) {
          headerRowIdx = i;
          break;
        }
      }

      if (headerRowIdx !== -1) {
        for (let i = headerRowIdx + 1; i < rows.length; i++) {
          const row = rows[i];
          if (!row) continue;

          const itemCode = String(row[0] || '').trim();
          const description = String(row[1] || '').trim();

          // Ignorar filas de error (#N/A), vacías o con código 0
          if (!itemCode || itemCode === '0' || itemCode === '#N/A' || description === '#N/A') continue;

          const vlrUnitario = parseRobustNumber(row[4]);
          const cantidad = parseRobustNumber(row[3]);
          const valTotal = row[5] !== undefined ? parseRobustNumber(row[5]) : (cantidad * vlrUnitario);
          total += valTotal;

          let itemType: 'title' | 'subtitle' | 'item' = 'item';

          if (vlrUnitario === 0) {
            if (!itemCode.includes('.') && !itemCode.trim().includes(' ')) {
              itemType = 'title';
            } else {
              itemType = 'subtitle';
            }
          }

          parsedItems.push({
            item: itemCode,
            descripcion: description,
            unidad: String(row[2] || 'UN'),
            cantidad,
            vlrUnitario,
            vlrTotal: valTotal,
            type: itemType
          });
        }
      }

      if (importMode === 'newScenario') {
        createBudgetVersion(project.id, newName.trim());
        setTimeout(() => {
          importBudgetExcel(project.id, parsedItems, total);
          // Auto-save physical project in electron if function exists
          setTimeout(() => {
            const updatedProject = getActiveProject();
            if (updatedProject && (window as any).electronAPI && typeof (window as any).electronAPI.saveProject === 'function') {
              (window as any).electronAPI.saveProject(updatedProject)
                .then(() => console.log("[Excel New Version] Guardado físico automático exitoso."))
                .catch((err: any) => console.error("Error al guardar físicamente tras Excel:", err));
            }
          }, 100);
        }, 100);
      } else {
        importBudgetExcel(project.id, parsedItems, total);
        // Auto-save physical project in electron if function exists
        setTimeout(() => {
          const updatedProject = getActiveProject();
          if (updatedProject && (window as any).electronAPI && typeof (window as any).electronAPI.saveProject === 'function') {
            (window as any).electronAPI.saveProject(updatedProject)
              .then(() => console.log("[Excel Import] Guardado físico automático exitoso."))
              .catch((err: any) => console.error("Error al guardar físicamente tras Excel:", err));
          }
        }, 100);
      }

    } catch (error) {
      console.error("Error reading Excel:", error);
      alert("Hubo un error al leer el archivo Excel. Asegúrate de que sea un formato válido.");
    }

    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleCreateVersion = () => {
    if (!project) return;
    setCreateModalName(`Escenario ${new Date().toLocaleDateString()}`);
    setCreateModalMethod(null);
    setShowCreateModal(true);
  };

  const handleApplyDraft = () => {
    if (!project || !project.budgetDraft) return;
    const draft = project.budgetDraft;
    createBudgetVersion(project.id, draft.versionName);
    setTimeout(() => {
      const activeItems = project.budgetVersions?.find(v => v.id === project.activeBudgetVersionId)?.items || project.budgetItems || [];
      const preservedItems = draft.items.map(di => {
        const old = activeItems.find(oi => oi.item === di.item);
        return old ? { ...di, startDate: di.startDate || old.startDate, endDate: di.endDate || old.endDate } : di;
      });
      const total = preservedItems.filter(i => i.type === 'item').reduce((s, i) => s + i.vlrTotal, 0);
      importBudgetExcel(project.id, preservedItems, total);
      // Limpiar borrador
      updateProject(project.id, { budgetDraft: undefined, budgetRawText: undefined });
      if ((window as any).electronAPI?.saveProject) {
        setTimeout(() => {
          const updated = getActiveProject();
          if (updated) (window as any).electronAPI.saveProject(updated).catch(console.error);
        }, 150);
      }
    }, 100);
  };

  const handleDiscardDraft = () => {
    if (!project) return;
    updateProject(project.id, { budgetDraft: undefined, budgetRawText: undefined });
  };

  const handleCreateModalExcelChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !project) return;
    try {
      const { read, utils } = await import('xlsx');
      const data = await file.arrayBuffer();
      const workbook = read(data);
      const sheetName = workbook.SheetNames.includes('Presupuesto') ? 'Presupuesto' : workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      const rows = utils.sheet_to_json<any[]>(worksheet, { header: 1 });
      let total = 0;
      const parsedItems: BudgetItem[] = [];
      let headerRowIdx = -1;
      for (let i = 0; i < Math.min(20, rows.length); i++) {
        const row = rows[i];
        if (row && normalizeHeader(row[0]).includes('ITEM')) {
          headerRowIdx = i; break;
        }
      }
      if (headerRowIdx !== -1) {
        for (let i = headerRowIdx + 1; i < rows.length; i++) {
          const row = rows[i];
          if (!row) continue;

          const itemCode = String(row[0] || '').trim();
          const description = String(row[1] || '').trim();

          // Ignorar filas de error (#N/A), vacías o con código 0
          if (!itemCode || itemCode === '0' || itemCode === '#N/A' || description === '#N/A') continue;

          const vlrUnitario = parseRobustNumber(row[4]);
          const cantidad = parseRobustNumber(row[3]);
          const valTotal = row[5] !== undefined ? parseRobustNumber(row[5]) : cantidad * vlrUnitario;
          total += valTotal;

          let itemType: 'title' | 'subtitle' | 'item' = 'item';
          if (vlrUnitario === 0) {
            itemType = (!itemCode.includes('.') && !itemCode.trim().includes(' ')) ? 'title' : 'subtitle';
          }
          parsedItems.push({ item: itemCode, descripcion: description, unidad: String(row[2] || 'UN'), cantidad, vlrUnitario, vlrTotal: valTotal, type: itemType });
        }
      }
      const versionName = createModalName.trim() || `Importado ${new Date().toLocaleDateString()}`;
      createBudgetVersion(project.id, versionName);
      setTimeout(() => {
        importBudgetExcel(project.id, parsedItems, total);
        setTimeout(() => {
          const updated = getActiveProject();
          if (updated && (window as any).electronAPI?.saveProject) {
            (window as any).electronAPI.saveProject(updated).catch(console.error);
          }
        }, 100);
      }, 100);
      setShowCreateModal(false);
    } catch (err) {
      console.error('Error al leer Excel:', err);
      alert('Error al leer el archivo Excel. Verifica el formato.');
    }
    if (excelImportRef.current) excelImportRef.current.value = '';
  };

  const handleAddNewItem = () => {
    if (!project) return;

    const currentItems = activeVersion?.items || project?.budgetItems || [];
    const newIdx = currentItems.length;

    const newItem: BudgetItem = {
      item: '',
      descripcion: '',
      unidad: 'UN',
      cantidad: 0,
      vlrUnitario: 0,
      vlrTotal: 0,
      type: 'item'
    };

    addBudgetItem(project.id, newItem);
    setEditingRowIndex(newIdx);
    setEditValues(newItem);

    // Pequeño delay para asegurar que el DOM se renderice antes de hacer scroll
    setTimeout(() => {
      const container = document.querySelector('.budget-scroll-container');
      if (container) container.scrollTop = container.scrollHeight;
    }, 100);
  };

  const handleStartEdit = (index: number, item: BudgetItem) => {
    setEditingRowIndex(index);
    setEditValues({ ...item });
  };

  const handleSaveEdit = () => {
    if (editingRowIndex !== null && project) {
      updateBudgetItem(project.id, editingRowIndex, editValues);
      setEditingRowIndex(null);
      setEditValues({});
    }
  };

  const handleCancelEdit = () => {
    setEditingRowIndex(null);
    setEditValues({});
  };


  const handleInsertAfter = (index: number) => {
    if (!project) return;
    const newItem: BudgetItem = {
      item: '',
      descripcion: '',
      unidad: 'UN',
      cantidad: 0,
      vlrUnitario: 0,
      vlrTotal: 0,
      type: 'item'
    };
    addBudgetItem(project.id, newItem, index);
    setEditingRowIndex(index + 1);
    setEditValues(newItem);
  };



  const resizingCol = useRef<string | null>(null);
  const startX = useRef<number>(0);
  const startWidth = useRef<number>(0);

  const onMouseDown = (colKey: string, e: React.MouseEvent) => {
    resizingCol.current = colKey;
    startX.current = e.pageX;
    startWidth.current = colWidths[colKey];
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };

  const onMouseMove = (e: MouseEvent) => {
    if (!resizingCol.current) return;
    const diff = e.pageX - startX.current;
    const newWidth = Math.max(50, startWidth.current + diff);
    updateColumnWidth('budget', resizingCol.current, newWidth);
  };

  const onMouseUp = () => {
    resizingCol.current = null;
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
    document.body.style.cursor = 'default';
    document.body.style.userSelect = 'auto';
  };

  const onDoubleClick = (colKey: string) => {
    if (!project) return;

    // Heuristic measure logic
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) return;
    context.font = '14px Space Grotesk'; // Match table font
    let maxWidth = 60; // Initial min width for the header text itself
    const headerText = colKey.toUpperCase();
    maxWidth = context.measureText(headerText).width + 40;

    project.budgetItems.forEach(item => {
      let text = '';
      if (colKey === 'item') text = String(item.item);
      if (colKey === 'descripcion') text = String(item.descripcion);
      if (colKey === 'unidad') text = String(item.unidad);
      if (colKey === 'cantidad') text = item.cantidad.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      if (colKey === 'vlrUnitario') text = formatCurrency(item.vlrUnitario);
      if (colKey === 'vlrTotal') text = formatCurrency(item.vlrTotal);

      const metrics = context.measureText(text);
      if (metrics.width + 40 > maxWidth) maxWidth = metrics.width + 40;
    });

    updateColumnWidth('budget', colKey, Math.min(800, maxWidth));
  };

  const totalTableWidth = Object.values(colWidths).reduce((acc, width) => acc + width, 0);



  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', width: '100%' }}>
      {/* Estilos para el botón de colapso */}
      <style>{`
        .col-header-container {
          position: relative;
          display: flex;
          align-items: center;
          justify-content: center; /* Títulos siempre centrados */
          height: 100%;
          text-align: center;
        }
        .collapse-btn {
          position: absolute;
          top: 4px;
          right: 4px;
          width: 6px;
          height: 6px;
          background: hsl(var(--primary-neon-hsl));
          border: none;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          opacity: 0;
          transition: all 0.2s ease;
          padding: 0;
          z-index: 10;
          box-shadow: 0 0 8px hsl(var(--primary-neon-hsl) / 0.5);
        }
        .col-header-container:hover .collapse-btn {
          opacity: 1;
        }
        .collapsed-dot {
          display: flex;
          justify-content: center;
          align-items: center;
          width: 100%;
          color: hsl(var(--accent-primary));
          font-weight: bold;
          height: 100%;
        }
        /* Barra de desplazamiento personalizada, delgada y minimalista */
        .floating-scroll::-webkit-scrollbar {
          height: 6px; 
          width: 6px;
        }
        .floating-scroll::-webkit-scrollbar-track {
          background: transparent;
        }
        .floating-scroll::-webkit-scrollbar-thumb {
          background: hsl(var(--primary-neon-hsl) / 0.5);
          border-radius: 10px;
          transition: background 0.3s;
        }
        .floating-scroll::-webkit-scrollbar-thumb:hover {
          background: hsl(var(--primary-neon-hsl));
        }

        /* Botón de añadir fila (fantasma) */
        .add-row-btn {
          opacity: 0;
          transition: all 0.2s ease;
          background: transparent;
          color: hsl(var(--primary-neon-hsl));
          border: 1px solid transparent;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          position: absolute;
          left: 4px; /* Centrado en el nuevo padding de 28px */
          top: 50%;
          transform: translateY(-50%);
          width: 20px;
          height: 20px;
          border-radius: 50%;
          padding: 0;
          z-index: 10;
        }
        .budget-row:hover .add-row-btn {
          opacity: 0.7;
        }
        .add-row-btn:hover {
          opacity: 1 !important;
          background: hsl(var(--primary-neon-hsl) / 0.15);
          border-color: hsl(var(--primary-neon-hsl) / 0.3);
          transform: translateY(-50%) scale(1.1);
          box-shadow: 0 0 10px hsl(var(--primary-neon-hsl) / 0.3);
        }

        .edit-input {
          background: hsla(var(--bg-tertiary), 0.8);
          border: 1px solid hsl(var(--primary-neon-hsl) / 0.3);
          color: hsl(var(--text-primary));
          font-size: 0.75rem;
          padding: 2px 6px;
          border-radius: 4px;
          width: 100%;
          outline: none;
        }
        .edit-input:focus {
          border-color: hsl(var(--primary-neon-hsl));
          box-shadow: 0 0 5px hsl(var(--primary-neon-hsl) / 0.3);
        }

        .version-dropdown {
          position: absolute;
          top: 100%;
          right: 0;
          background: hsla(var(--bg-secondary), 0.95);
          backdrop-filter: blur(20px);
          border: 1px solid hsl(var(--border-color));
          border-radius: 12px;
          box-shadow: var(--shadow-lg);
          z-index: 1000;
          min-width: 250px;
          margin-top: 8px;
          padding: 8px;
        }
        .version-item {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 8px 12px;
          border-radius: 8px;
          cursor: pointer;
          transition: all 0.2s;
        }
        .version-item:hover {
          background: hsla(var(--text-primary), 0.05);
        }
        .version-item.active {
          background: hsl(var(--primary-neon-hsl) / 0.1);
          border: 1px solid hsl(var(--primary-neon-hsl) / 0.2);
        }

        /* Línea de enfoque técnica en hover */
        .budget-row {
          position: relative;
          transition: all 0.2s ease;
        }
        .budget-row::after {
          content: '';
          position: absolute;
          bottom: 0;
          left: 0;
          width: 100%;
          height: 1px;
          background: hsl(var(--primary-neon));
          opacity: 0;
          transition: opacity 0.2s ease;
          pointer-events: none;
          z-index: 10;
          transform: scaleY(0.5);
          transform-origin: bottom;
        }
        .budget-row:hover {
          border-bottom-color: transparent !important;
        }
        .budget-row:hover::after {
          opacity: 1;
        }

        /* Estilos para la Vista de Carpeta */
        .folder-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
          gap: 24px;
          padding: 32px;
        }
        .folder-card {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          background: hsla(var(--bg-secondary), 0.5);
          backdrop-filter: blur(10px);
          border: 1px solid hsl(var(--border-color));
          border-radius: 16px;
          padding: 24px;
          cursor: pointer;
          transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
          position: relative;
          user-select: none;
        }
        .folder-card:hover {
          transform: translateY(-5px);
          background: hsla(var(--primary-neon), 0.05);
          border-color: hsl(var(--primary-neon));
          box-shadow: 0 10px 25px -5px hsl(var(--primary-neon) / 0.2);
        }
        .folder-card.active {
          border-color: hsl(var(--primary-neon));
          background: hsla(var(--primary-neon), 0.08);
        }
        .folder-icon {
          color: hsl(var(--primary-neon));
          margin-bottom: 12px;
          filter: drop-shadow(0 0 8px hsl(var(--primary-neon) / 0.5));
        }
        .folder-name {
          font-size: 0.85rem;
          font-weight: bold;
          text-align: center;
          color: hsl(var(--text-primary));
          word-break: break-word;
          margin-bottom: 8px;
        }
        .folder-date {
          font-size: 0.65rem;
          color: hsl(var(--text-muted));
        }
        .folder-actions {
          position: absolute;
          top: 12px;
          right: 12px;
          display: flex;
          gap: 6px;
          opacity: 0;
          transition: all 0.2s ease;
          z-index: 10;
        }
        .folder-card:hover .folder-actions {
          opacity: 1;
        }
        .btn-icon {
          background: hsla(var(--bg-tertiary), 0.8);
          border: 1px solid hsl(var(--border-color));
          color: hsl(var(--text-secondary));
          padding: 6px;
          border-radius: 8px;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all 0.2s;
        }
        .btn-icon:hover {
          background: hsl(var(--primary-neon));
          color: #000;
          border-color: hsl(var(--primary-neon));
          transform: scale(1.1);
        }
        .btn-icon-danger:hover {
          background: hsl(var(--danger));
          color: #fff;
          border-color: hsl(var(--danger));
        }

        /* Botones Expansibles */
         .header-actions-container {
           display: flex;
           align-items: center;
           gap: 12px;
         }
         .btn-header-round {
           width: 40px;
           height: 40px;
           border-radius: 50%;
           display: flex;
           align-items: center;
           justify-content: center;
           background: hsl(var(--bg-tertiary)) !important;
           background-color: hsl(var(--bg-tertiary)) !important;
           color: hsl(var(--text-secondary)) !important;
           border: 1px solid hsl(var(--border-color)) !important;
           padding: 0;
           transition: all 0.2s ease;
           box-shadow: 0 2px 10px rgba(0,0,0,0.1);
           backdrop-filter: none !important;
           -webkit-backdrop-filter: none !important;
           opacity: 1 !important;
         }
         .btn-header-round:hover {
           color: hsl(var(--primary-neon)) !important;
           border-color: hsl(var(--primary-neon)) !important;
           background: hsl(var(--bg-tertiary)) !important;
         }
         .btn-expandable {
           display: flex;
           align-items: center;
           gap: 10px;
           width: 40px;
           height: 40px;
           overflow: hidden;
           transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
           padding: 0 10px !important;
           white-space: nowrap;
           justify-content: flex-start;
           border-radius: 20px !important;
           background: hsl(var(--bg-tertiary)) !important;
           background-color: hsl(var(--bg-tertiary)) !important;
           color: hsl(var(--text-secondary)) !important;
           border: 1px solid hsl(var(--border-color)) !important;
           backdrop-filter: none !important;
           -webkit-backdrop-filter: none !important;
           box-shadow: 0 2px 10px rgba(0,0,0,0.1);
           opacity: 1 !important;
         }
         .btn-expandable:hover {
           width: 160px;
           padding: 0 16px !important;
           color: hsl(var(--primary-neon)) !important;
           border-color: hsl(var(--primary-neon)) !important;
           background: hsl(var(--bg-tertiary)) !important;
         }
         .btn-expandable span {
           opacity: 0;
           transition: opacity 0.2s;
           pointer-events: none;
           font-size: 0.75rem;
           font-weight: 800;
           color: inherit;
           text-transform: uppercase;
           letter-spacing: 0.05em;
         }
         .btn-expandable:hover span {
           opacity: 1;
         }
         .btn-expandable svg {
           min-width: 18px;
           flex-shrink: 0;
           stroke-width: 2.5;
           color: inherit;
         }
      `}</style>
      <div className="page-header" style={{ flexShrink: 0, minWidth: 0, overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px', minWidth: 0 }}>
          <h2 className="page-title" style={{ margin: 0 }}>Presupuesto</h2>
          {project && effectiveVersions.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '0.65rem', color: 'hsl(var(--text-muted))', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Escenario:</span>
              <select
                value={project.activeBudgetVersionId || '__legacy__'}
                onChange={(e) => {
                  const val = e.target.value;
                  if (val && val !== '__legacy__') {
                    switchActiveVersion(project.id, val);
                  }
                }}
                style={{
                  background: 'hsla(var(--bg-tertiary), 0.7)',
                  border: '1px solid var(--border-color)',
                  color: 'hsl(var(--text-primary))',
                  padding: '6px 28px 6px 12px',
                  borderRadius: 'var(--radius-sm)',
                  fontSize: '0.75rem',
                  fontFamily: 'var(--font-technical)',
                  fontWeight: 'bold',
                  outline: 'none',
                  cursor: 'pointer',
                  appearance: 'none',
                  WebkitAppearance: 'none',
                  backgroundImage: `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none' stroke='hsl(var(--primary-neon-hsl))' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><polyline points='6 9 12 15 18 9'></polyline></svg>")`,
                  backgroundRepeat: 'no-repeat',
                  backgroundPosition: 'right 8px center',
                  backgroundSize: '14px',
                  minWidth: '160px',
                  transition: 'all 0.2s ease'
                }}
                onFocus={(e) => e.target.style.borderColor = 'hsl(var(--primary-neon))'}
                onBlur={(e) => e.target.style.borderColor = 'var(--border-color)'}
              >
                {effectiveVersions.map(v => (
                  <option key={v.id} value={v.id} style={{ background: 'hsl(var(--bg-secondary))', color: '#fff' }}>
                    {v.name}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
        <div className="header-actions-container" style={{ flexShrink: 0 }}>
          <input
            type="file"
            accept=".xlsx,.xls,.csv"
            style={{ display: 'none' }}
            ref={fileInputRef}
            onChange={handleFileChange}
          />

          {/* Centro de Guardado y Versiones */}
          <div style={{ position: 'relative' }}>
            <button
              className="btn-header-round"
              onClick={() => setShowVersions(!showVersions)}
              onMouseEnter={() => setShowVersions(true)}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Save size={20} strokeWidth={2.5} />
            </button>

            {showVersions && (
              <div className="version-dropdown" style={{ background: '#0f172a', border: '1px solid #1e293b', boxShadow: '0 10px 25px rgba(0,0,0,0.5)', width: '220px' }}>
                <div style={{ padding: '8px' }}>
                  <button
                    className="version-item"
                    onClick={() => {
                      setShowVersions(false);
                      setTimeout(() => alert("Cambios guardados en el presupuesto actual."), 100);
                    }}
                    style={{ width: '100%', justifyContent: 'flex-start', gap: '10px', background: '#1e293b', marginBottom: '8px', borderRadius: '8px', padding: '12px' }}
                  >
                    <Save size={18} color="hsl(var(--primary-neon))" />
                    <div style={{ textAlign: 'left' }}>
                      <div style={{ fontWeight: 'bold', fontSize: '0.85rem', color: '#fff' }}>Guardar</div>
                      <div style={{ fontSize: '0.65rem', color: 'rgba(255,255,255,0.5)' }}>Sobrescribir actual</div>
                    </div>
                  </button>

                  <button
                    className="version-item"
                    onClick={(e) => {
                      e.stopPropagation();
                      const currentName = project?.budgetVersions?.find(v => v.id === project?.activeBudgetVersionId)?.name || 'Presupuesto';
                      setNewName(`Copia de ${currentName}`);
                      setShowNameModal(true);
                      setShowVersions(false);
                    }}
                    style={{ width: '100%', justifyContent: 'flex-start', gap: '10px', background: '#1e293b', borderRadius: '8px', padding: '12px' }}
                  >
                    <FilePlus size={18} color="hsl(var(--accent-primary))" />
                    <div style={{ textAlign: 'left' }}>
                      <div style={{ fontWeight: 'bold', fontSize: '0.85rem', color: '#fff' }}>Guardar como...</div>
                      <div style={{ fontSize: '0.65rem', color: 'rgba(255,255,255,0.5)' }}>Crear nueva versión</div>
                    </div>
                  </button>
                </div>
              </div>
            )}
          </div>

          <button className="btn btn-secondary btn-expandable" onClick={handleImportExcelClick} title="Importar Excel">
            <Upload size={18} />
            <span>Importar Excel</span>
          </button>

          <button className="btn btn-secondary btn-expandable" onClick={handleDownloadTemplate} title="Descargar Plantilla Excel">
            <Download size={18} />
            <span>Plantilla Excel</span>
          </button>

          <button className="btn btn-secondary btn-expandable" onClick={handleExportExcel} disabled={!project?.budgetItems.length} title="Exportar Excel">
            <Download size={18} />
            <span>Exportar Excel</span>
          </button>

          <button
            className="btn btn-secondary btn-expandable btn-pulse"
            onClick={handleExportLogi}
            disabled={!project?.budgetItems.length}
            title="Exporta el archivo de insumo para la App Logi Kinetic"
            style={{
              background: 'var(--bg-secondary)',
              backgroundColor: 'var(--bg-secondary)',
              opacity: 1,
              color: 'var(--text-secondary)',
              border: '1px solid var(--border-color)',
              boxShadow: '0 2px 10px rgba(0,0,0,0.1)',
              backdropFilter: 'none !important',
              WebkitBackdropFilter: 'none !important'
            }}
          >
            <Smartphone size={18} strokeWidth={2.5} />
            <span>Insumo Logi</span>
          </button>
          {viewMode === 'table' && (
            <>
              <div style={{ width: '1px', height: '24px', background: 'var(--border-color)', margin: '0 8px', opacity: 0.3 }}></div>
              <button
                className="btn btn-ghost"
                onClick={() => setViewMode('folder')}
                title="Cerrar Presupuesto"
                style={{ color: 'hsl(var(--text-muted))', padding: '8px', borderRadius: '50%' }}
                onMouseEnter={(e) => { e.currentTarget.style.color = 'hsl(var(--danger))'; e.currentTarget.style.background = 'hsla(var(--danger), 0.1)' }}
                onMouseLeave={(e) => { e.currentTarget.style.color = 'hsl(var(--text-muted))'; e.currentTarget.style.background = 'none' }}
              >
                <X size={20} />
              </button>
            </>
          )}
        </div>
      </div>

      {/* === STAGING AREA: Banner de borrador IA === */}
      {project?.budgetDraft && project.budgetDraft.items.length > 0 && (
        <div style={{
          background: 'linear-gradient(135deg, hsla(280, 80%, 25%, 0.6), hsla(220, 80%, 20%, 0.6))',
          border: '1px solid hsl(280, 80%, 50%)',
          borderRadius: '10px',
          padding: '12px 20px',
          marginBottom: '12px',
          display: 'flex',
          alignItems: 'center',
          gap: '16px',
          flexShrink: 0,
          backdropFilter: 'blur(10px)',
          boxShadow: '0 0 20px hsl(280, 80%, 40% / 0.3)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flex: 1 }}>
            <AlertCircle size={20} color='hsl(280, 80%, 70%)' />
            <div>
              <div style={{ fontSize: '0.8rem', fontWeight: 'bold', color: 'hsl(280, 80%, 80%)' }}>
                📋 Borrador IA pendiente: «{project.budgetDraft.versionName}»
              </div>
              <div style={{ fontSize: '0.7rem', color: 'hsl(280, 60%, 65%)' }}>
                {project.budgetDraft.items.length} ítems interpretados por la IA listos para revisión
              </div>
            </div>
          </div>
          <button
            onClick={() => setShowDiffs(!showDiffs)}
            style={{
              background: 'hsla(280, 60%, 40%, 0.4)',
              border: '1px solid hsl(280, 60%, 50%)',
              color: 'hsl(280, 80%, 80%)',
              padding: '6px 14px',
              borderRadius: '8px',
              fontSize: '0.75rem',
              cursor: 'pointer'
            }}
          >
            {showDiffs ? 'Ocultar' : 'Ver comparación'}
          </button>
          <button
            onClick={handleApplyDraft}
            style={{
              background: 'hsl(280, 80%, 50%)',
              border: 'none',
              color: '#fff',
              padding: '8px 18px',
              borderRadius: '8px',
              fontSize: '0.75rem',
              fontWeight: 'bold',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px'
            }}
          >
            <CheckCircle size={14} /> Aplicar Borrador
          </button>
          <button
            onClick={handleDiscardDraft}
            style={{
              background: 'transparent',
              border: '1px solid hsl(0, 70%, 50%)',
              color: 'hsl(0, 70%, 70%)',
              padding: '6px 14px',
              borderRadius: '8px',
              fontSize: '0.75rem',
              cursor: 'pointer'
            }}
          >
            Descartar
          </button>
        </div>
      )}

      {/* === TABLA COMPARATIVA del borrador === */}
      {showDiffs && project?.budgetDraft && project.budgetDraft.items.length > 0 && (() => {
        const activeItems = activeVersion?.items || project.budgetItems || [];
        const draftItems = project.budgetDraft.items;
        const allCodes = Array.from(new Set([...activeItems.map(i => i.item), ...draftItems.map(i => i.item)]));
        return (
          <div style={{ background: 'hsla(var(--bg-secondary), 0.8)', border: '1px solid hsl(var(--border-color))', borderRadius: '10px', marginBottom: '12px', overflow: 'hidden', flexShrink: 0, maxHeight: '260px', overflowY: 'auto' }}>
            <div style={{ padding: '10px 16px', borderBottom: '1px solid hsl(var(--border-color))', fontSize: '0.7rem', fontWeight: 'bold', color: 'hsl(var(--text-secondary))', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'flex', gap: '0' }}>
              <div style={{ flex: '0 0 80px' }}>ÍTEM</div>
              <div style={{ flex: 1 }}>DESCRIPCIÓN</div>
              <div style={{ flex: '0 0 100px', textAlign: 'right' }}>CANT. ACTUAL</div>
              <div style={{ flex: '0 0 100px', textAlign: 'right' }}>CANT. NUEVA</div>
              <div style={{ flex: '0 0 80px', textAlign: 'center' }}>ESTADO</div>
            </div>
            {allCodes.map(code => {
              const cur = activeItems.find(i => i.item === code);
              const nw = draftItems.find(i => i.item === code);
              const status = !cur ? 'Nuevo' : !nw ? 'Eliminado' : cur.cantidad !== nw.cantidad || cur.vlrUnitario !== nw.vlrUnitario ? 'Modificado' : 'Sin cambios';
              const statusColor = status === 'Nuevo' ? 'hsl(120,70%,60%)' : status === 'Eliminado' ? 'hsl(0,70%,60%)' : status === 'Modificado' ? 'hsl(40,90%,60%)' : 'hsl(var(--text-muted))';
              return (
                <div key={code} style={{ display: 'flex', padding: '6px 16px', borderBottom: '1px solid hsla(var(--border-color), 0.3)', fontSize: '0.72rem', background: status !== 'Sin cambios' ? `${statusColor}10` : 'transparent' }}>
                  <div style={{ flex: '0 0 80px', fontWeight: 'bold', color: 'hsl(var(--primary-neon))' }}>{code}</div>
                  <div style={{ flex: 1, color: 'hsl(var(--text-secondary))', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{(cur || nw)?.descripcion}</div>
                  <div style={{ flex: '0 0 100px', textAlign: 'right', color: 'hsl(var(--text-muted))' }}>{cur ? cur.cantidad.toLocaleString('es-CO', { maximumFractionDigits: 2 }) : '—'}</div>
                  <div style={{ flex: '0 0 100px', textAlign: 'right', color: 'hsl(var(--text-primary))' }}>{nw ? nw.cantidad.toLocaleString('es-CO', { maximumFractionDigits: 2 }) : '—'}</div>
                  <div style={{ flex: '0 0 80px', textAlign: 'center', fontWeight: 'bold', color: statusColor, fontSize: '0.65rem' }}>{status}</div>
                </div>
              );
            })}
          </div>
        );
      })()}

      <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, overflow: 'hidden', padding: 0 }}>
        {viewMode === 'folder' ? (
          <div style={{ flex: 1, overflow: 'auto' }}>
            <div className="folder-grid">
              {effectiveVersions.map(v => (
                <div
                  key={v.id}
                  className={`folder-card ${v.id === project?.activeBudgetVersionId || (v.id === '__legacy__' && !project?.activeBudgetVersionId) ? 'active' : ''}`}
                  onClick={() => {
                    if (v.id !== '__legacy__' && v.id !== project?.activeBudgetVersionId) {
                      switchActiveVersion(project!.id, v.id);
                      // Auto-save physical project
                      setTimeout(() => {
                        const updatedProject = getActiveProject();
                        if (updatedProject && (window as any).electronAPI?.saveProject) {
                          (window as any).electronAPI.saveProject(updatedProject).catch(console.error);
                        }
                      }, 100);
                    }
                  }}
                  onDoubleClick={() => {
                    if (v.id !== '__legacy__' && v.id !== project?.activeBudgetVersionId) {
                      switchActiveVersion(project!.id, v.id);
                    }
                    setViewMode('table');
                  }}
                >
                  <div className="folder-actions">
                    <button className="btn-icon" onClick={(e) => {
                      e.stopPropagation();
                      if (v.id === '__legacy__') return;
                      setNewName(v.name);
                      setTargetVersionId(v.id);
                      setModalMode('rename');
                      setShowNameModal(true);
                    }} title="Renombrar"><Edit size={12} /></button>
                    <button className="btn-icon" onClick={(e) => {
                      e.stopPropagation();
                      if (v.id === '__legacy__') return;
                      duplicateBudgetVersion(project!.id, v.id);
                    }} title="Duplicar"><Copy size={12} /></button>
                    {/* Botón eliminar para versiones reales (el context impide borrar la última) */}
                    {v.id !== '__legacy__' && (
                      deleteConfirmId === v.id ? (
                        <>
                          <button className="btn-icon btn-icon-danger" onClick={(e) => {
                            e.stopPropagation();
                            deleteBudgetVersion(project!.id, v.id);
                            setDeleteConfirmId(null);
                          }} title="Confirmar eliminación" style={{ fontSize: '0.6rem', width: '48px', borderRadius: '6px' }}>¿Sí?</button>
                          <button className="btn-icon" onClick={(e) => { e.stopPropagation(); setDeleteConfirmId(null); }} title="Cancelar" style={{ fontSize: '0.6rem', width: '30px' }}>✕</button>
                        </>
                      ) : (
                        <button className="btn-icon btn-icon-danger" onClick={(e) => {
                          e.stopPropagation();
                          setDeleteConfirmId(v.id);
                        }} title="Eliminar"><Trash2 size={12} /></button>
                      )
                    )}
                  </div>
                  <Folder className="folder-icon" size={48} fill="currentColor" fillOpacity={0.1} />
                  <div className="folder-name">{v.name}</div>
                  <div className="folder-date">{new Date(v.createdAt).toLocaleDateString()}</div>
                  {v.id === project?.activeBudgetVersionId || (v.id === '__legacy__' && !project?.activeBudgetVersionId) ? (
                    <div style={{
                      marginTop: '12px',
                      fontSize: '0.65rem',
                      color: '#000',
                      background: 'hsl(var(--primary-neon))',
                      padding: '4px 10px',
                      borderRadius: '12px',
                      fontWeight: '800',
                      letterSpacing: '0.05em',
                      textTransform: 'uppercase',
                      boxShadow: '0 0 12px hsl(var(--primary-neon) / 0.4)'
                    }}>
                      ACTIVO
                    </div>
                  ) : (
                    v.id !== '__legacy__' && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          switchActiveVersion(project!.id, v.id);
                          setTimeout(() => {
                            const updatedProject = getActiveProject();
                            if (updatedProject && (window as any).electronAPI?.saveProject) {
                              (window as any).electronAPI.saveProject(updatedProject).catch(console.error);
                            }
                          }, 100);
                        }}
                        style={{
                          marginTop: '12px',
                          fontSize: '0.65rem',
                          color: 'hsl(var(--text-secondary))',
                          background: 'hsla(var(--bg-tertiary), 0.6)',
                          border: '1px solid hsl(var(--border-color))',
                          padding: '4px 10px',
                          borderRadius: '12px',
                          fontWeight: '800',
                          letterSpacing: '0.05em',
                          textTransform: 'uppercase',
                          cursor: 'pointer',
                          transition: 'all 0.2s ease',
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.borderColor = 'hsl(var(--primary-neon))';
                          e.currentTarget.style.color = 'hsl(var(--primary-neon))';
                          e.currentTarget.style.background = 'hsla(var(--primary-neon), 0.1)';
                          e.currentTarget.style.boxShadow = '0 0 8px hsla(var(--primary-neon), 0.3)';
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.borderColor = 'hsl(var(--border-color))';
                          e.currentTarget.style.color = 'hsl(var(--text-secondary))';
                          e.currentTarget.style.background = 'hsla(var(--bg-tertiary), 0.6)';
                          e.currentTarget.style.boxShadow = 'none';
                        }}
                      >
                        Activar
                      </button>
                    )
                  )}
                </div>
              ))}

              {/* Card para Crear Nuevo */}
              <div
                className="folder-card"
                onClick={handleCreateVersion}
                style={{ borderStyle: 'dashed', opacity: 0.7 }}
              >
                <Plus className="folder-icon" size={48} />
                <div className="folder-name">Nuevo Presupuesto</div>
                <div className="folder-date">Crear desde el actual</div>
              </div>
            </div>
          </div>
        ) : (
          /* Contenedor Principal (Desplazamiento Horizontal Sincronizado) */
          <div className="budget-scroll-container floating-scroll" style={{ flex: 1, overflowX: 'auto', overflowY: 'hidden', display: 'flex', flexDirection: 'column' }}>
            <div style={{ width: '100%', minWidth: `${totalTableWidth + 32}px`, display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
              {/* Cabezal Fijo (Fuera del scroll vertical) */}
              <div style={{
                display: 'flex',
                flexShrink: 0,
                height: '44px',
                alignItems: 'center',
                padding: '0 16px',
                borderBottom: '1px solid hsl(var(--border-color))',
                fontWeight: 'bold',
                fontSize: '0.7rem',
                color: 'hsl(var(--text-secondary))',
                backgroundColor: 'hsla(var(--bg-tertiary), 0.4)',
                backdropFilter: 'blur(10px)',
                letterSpacing: '0.1em',
                textTransform: 'uppercase',
                width: '100%'
              }}>
                {[
                  { key: 'item', label: 'Ítem' },
                  { key: 'descripcion', label: 'Descripción' },
                  { key: 'unidad', label: 'Unidad', align: 'center' },
                  { key: 'cantidad', label: 'Cant.', align: 'right' },
                  { key: 'vlrUnitario', label: 'Vr. Unitario', align: 'right' },
                  { key: 'vlrTotal', label: 'Vr. Total', align: 'right' },
                  { key: 'acciones', label: 'Acc.', align: 'center' }
                ].map((col) => {
                  const isCollapsed = collapsedColumns.budget.includes(col.key);
                  const width = isCollapsed ? 30 : colWidths[col.key];

                  return (
                    <div key={col.key} className="col-header-container" style={{ width: `${width}px`, flexShrink: 0 }}>
                      {isCollapsed ? (
                        <div className="collapsed-dot" onClick={() => toggleColumnCollapse('budget', col.key)} style={{ cursor: 'pointer' }}>•</div>
                      ) : (
                        <>
                          {col.label}
                          <button className="collapse-btn" onClick={() => toggleColumnCollapse('budget', col.key)} title="Colapsar columna" />
                          <div className="col-resizer" onMouseDown={(e) => onMouseDown(col.key, e)} onDoubleClick={() => onDoubleClick(col.key)} />
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
              {/* Cuerpo de la tabla (Scroll Vertical) */}
              <div className="floating-scroll" style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden' }}>
                {(() => {
                  const activeVersion = project?.budgetVersions?.find(v => v.id === project?.activeBudgetVersionId);
                  const budgetItems = activeVersion?.items || project?.budgetItems || [];

                  if (!project || budgetItems.length === 0) {
                    return (
                      <div style={{ padding: '40px', textAlign: 'center', color: 'hsl(var(--text-muted))' }}>
                        No hay ítems en el presupuesto.
                      </div>
                    );
                  }

                  const rows = [];
                  let currentChapterPrefix = '';
                  let chapterTotal = 0;
                  let grandTotal = 0;

                  for (let i = 0; i < budgetItems.length; i++) {
                    const item = budgetItems[i];
                    const itemStr = item.item ? item.item.toString() : '';
                    const mainChapter = itemStr.split(/[\.\s]/)[0];

                    // Subtotal de capítulo previo
                    if (currentChapterPrefix !== '' && mainChapter !== '' && currentChapterPrefix !== mainChapter) {
                      rows.push(
                        <div key={`subtotal-${currentChapterPrefix}`} style={{
                          display: 'flex', alignItems: 'center', height: '35px', padding: '0 16px',
                          backgroundColor: 'hsla(var(--primary-neon), 0.05)', borderBottom: '1px solid hsl(var(--border-color))',
                          fontWeight: '800', fontSize: '0.75rem', color: 'hsl(var(--primary-neon))'
                        }}>
                          <div style={{ width: getColWidth('item') }}></div>
                          <div style={{
                            width: getColWidth('descripcion') + getColWidth('unidad') + getColWidth('cantidad') + getColWidth('vlrUnitario'),
                            textAlign: 'right',
                            paddingRight: '16px',
                            fontWeight: 'bold',
                            color: 'hsl(var(--primary-neon))',
                            textTransform: 'uppercase',
                            fontSize: '0.75rem',
                            letterSpacing: '0.05em'
                          }}>
                            SUBTOTAL CAPÍTULO {currentChapterPrefix}
                          </div>
                          <div style={{ width: getColWidth('vlrTotal'), textAlign: 'right', paddingRight: '4px', fontWeight: 'bold', color: 'hsl(var(--primary-neon))', fontSize: '0.75rem' }}>
                            {formatCurrency(chapterTotal)}
                          </div>
                          <div style={{ width: getColWidth('acciones') }}></div>
                        </div>
                      );
                      chapterTotal = 0;
                    }

                    if (mainChapter !== '') currentChapterPrefix = mainChapter;
                    if (item.type === 'item') {
                      chapterTotal += item.vlrTotal;
                      grandTotal += item.vlrTotal;
                    }

                    const isTitle = item.type === 'title';
                    const isSubtitle = item.type === 'subtitle';
                    const isEditing = editingRowIndex === i;
                    const activeItem = isEditing ? editValues : item;

                    rows.push(
                      <div key={`${item.item}-${i}`} className="budget-row" style={{
                        display: 'flex', alignItems: 'flex-start', minHeight: '35px', padding: '0 16px',
                        backgroundColor: isEditing ? 'hsla(var(--primary-neon), 0.1)' : isTitle ? 'hsla(var(--bg-tertiary), 0.5)' : isSubtitle ? 'hsla(var(--bg-tertiary), 0.2)' : 'transparent',
                        borderBottom: '1px solid hsl(var(--border-color))',
                        fontSize: '0.75rem', fontWeight: (isTitle || isSubtitle) ? 'bold' : 'normal',
                        color: isTitle ? 'hsl(var(--primary-neon))' : 'inherit',
                        position: 'relative'
                      }}>
                        {[
                          { key: 'item', content: activeItem.item, editable: true },
                          { key: 'descripcion', content: activeItem.descripcion, className: 'expandable-description', editable: true },
                          { key: 'unidad', content: isTitle || isSubtitle ? '' : activeItem.unidad, align: 'center', editable: !isTitle && !isSubtitle },
                          { key: 'cantidad', content: item.type === 'item' ? (isEditing ? activeItem.cantidad : activeItem.cantidad?.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })) : '', align: 'right', editable: item.type === 'item' },
                          { key: 'vlrUnitario', content: item.type === 'item' ? (isEditing ? activeItem.vlrUnitario : formatCurrency(activeItem.vlrUnitario || 0)) : '', align: 'right', editable: item.type === 'item' },
                          { key: 'vlrTotal', content: isTitle || isSubtitle ? '' : formatCurrency(item.vlrTotal), align: 'right', fontWeight: (isTitle || isSubtitle) ? 'bold' : 'normal' },
                        ].map(col => {
                          const isCollapsed = collapsedColumns.budget.includes(col.key);
                          const width = isCollapsed ? 30 : colWidths[col.key];
                          const isItemCol = col.key === 'item';

                          return (
                            <div key={col.key} style={{
                              width: `${width}px`,
                              flexShrink: 0,
                              paddingTop: '8px',
                              paddingBottom: '8px',
                              textAlign: (col.align as any) || 'left',
                              overflow: 'hidden',
                              fontWeight: col.fontWeight || 'inherit',
                              position: isItemCol ? 'relative' : 'static',
                              paddingRight: col.align === 'right' ? '4px' : '0'
                            }}>
                              {isItemCol && !isCollapsed && (
                                <button
                                  className="add-row-btn"
                                  onClick={() => handleInsertAfter(i)}
                                  title="Insertar ítem debajo"
                                >
                                  <Plus size={14} />
                                </button>
                              )}
                              {isCollapsed ? '' : (
                                <div className={col.className} style={{ paddingLeft: isItemCol ? '28px' : '0' }}>
                                  {isEditing && col.editable ? (
                                    <input
                                      className="edit-input"
                                      type={(col.key === 'cantidad' || col.key === 'vlrUnitario') ? 'number' : 'text'}
                                      value={col.content}
                                      onChange={(e) => {
                                        const val = (col.key === 'cantidad' || col.key === 'vlrUnitario') ? Number(e.target.value) : e.target.value;
                                        setEditValues(prev => ({ ...prev, [col.key]: val }));
                                      }}
                                      autoFocus={col.key === 'item'}
                                    />
                                  ) : col.content}
                                </div>
                              )}
                            </div>
                          );
                        })}

                        {!collapsedColumns.budget.includes('acciones') && (
                          <div style={{ width: colWidths.acciones, display: 'flex', gap: '4px', justifyContent: 'center', paddingTop: '8px' }}>
                            {isEditing ? (
                              <>
                                <button className="btn-icon" onClick={handleSaveEdit} title="Guardar"><Save size={12} /></button>
                                <button className="btn-icon btn-icon-danger" onClick={handleCancelEdit} title="Cancelar"><X size={12} /></button>
                              </>
                            ) : (
                              <>
                                <select
                                  className="select-minimal"
                                  value={item.type}
                                  onChange={(e) => updateBudgetItemType(project.id, i, e.target.value as any)}
                                  style={{ fontSize: '0.65rem', padding: '2px 4px' }}
                                >
                                  <option value="item">Ítem</option>
                                  <option value="subtitle">Sub</option>
                                  <option value="title">Título</option>
                                </select>
                                <button className="btn-icon" onClick={() => handleStartEdit(i, item)}><Edit size={12} /></button>
                                <button className="btn-icon btn-icon-danger" onClick={() => removeBudgetItem(project.id, i)}><Trash2 size={12} /></button>
                              </>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  }

                  // Último subtotal
                  if (currentChapterPrefix !== '') {
                    rows.push(
                      <div key={`subtotal-last`} style={{
                        display: 'flex', alignItems: 'center', height: '35px', padding: '0 16px',
                        backgroundColor: 'hsla(var(--primary-neon), 0.05)', borderBottom: '1px solid hsl(var(--border-color))',
                        fontWeight: '800', fontSize: '0.75rem', color: 'hsl(var(--primary-neon))'
                      }}>
                        <div style={{ width: getColWidth('item') }}></div>
                        <div style={{
                          width: getColWidth('descripcion') + getColWidth('unidad') + getColWidth('cantidad') + getColWidth('vlrUnitario'),
                          textAlign: 'right',
                          paddingRight: '16px',
                          fontWeight: 'bold',
                          color: 'hsl(var(--primary-neon))',
                          textTransform: 'uppercase',
                          fontSize: '0.75rem',
                          letterSpacing: '0.05em'
                        }}>
                          SUBTOTAL CAPÍTULO {currentChapterPrefix}
                        </div>
                        <div style={{ width: getColWidth('vlrTotal'), textAlign: 'right', paddingRight: '4px', fontWeight: 'bold', color: 'hsl(var(--primary-neon))', fontSize: '0.75rem' }}>
                          {formatCurrency(chapterTotal)}
                        </div>
                        <div style={{ width: getColWidth('acciones') }}></div>
                      </div>
                    );
                  }

                  // Totales Finales
                  const admin = project.aiu?.administracion || 0;
                  const imprev = project.aiu?.imprevistos || 0;
                  const util = project.aiu?.utilidad || 0;
                  const totalAiuPercentage = admin + imprev + util;
                  const aiuValue = grandTotal * (totalAiuPercentage / 100);
                  const totalContract = grandTotal + aiuValue;

                  rows.push(
                    <div key="direct-cost" style={{ display: 'flex', alignItems: 'center', height: '35px', padding: '0 16px', backgroundColor: 'hsla(var(--bg-tertiary), 0.4)', borderBottom: '1px solid hsl(var(--border-color))', fontWeight: 'bold', fontSize: '0.8rem' }}>
                      <div style={{ width: getColWidth('item'), flexShrink: 0 }}></div>
                      <div style={{ width: getColWidth('descripcion') + getColWidth('unidad') + getColWidth('cantidad') + getColWidth('vlrUnitario'), textAlign: 'right', paddingRight: '16px' }}>SUBTOTAL COSTO DIRECTO</div>
                      <div style={{ width: getColWidth('vlrTotal'), textAlign: 'right', paddingRight: '4px' }}>{formatCurrency(grandTotal)}</div>
                      <div style={{ width: getColWidth('acciones') }}></div>
                    </div>
                  );

                  rows.push(
                    <div key="aiu-total" style={{ display: 'flex', alignItems: 'center', height: '35px', padding: '0 16px', backgroundColor: 'hsla(var(--bg-tertiary), 0.2)', borderBottom: '1px solid hsl(var(--border-color))', fontWeight: 'bold', fontSize: '0.8rem' }}>
                      <div style={{ width: getColWidth('item'), flexShrink: 0 }}></div>
                      <div style={{ width: getColWidth('descripcion') + getColWidth('unidad') + getColWidth('cantidad') + getColWidth('vlrUnitario'), textAlign: 'right', paddingRight: '16px' }}>A.I.U. ({totalAiuPercentage}%)</div>
                      <div style={{ width: getColWidth('vlrTotal'), textAlign: 'right', paddingRight: '4px' }}>{formatCurrency(aiuValue)}</div>
                      <div style={{ width: getColWidth('acciones') }}></div>
                    </div>
                  );

                  rows.push(
                    <div key="contract-total" style={{ display: 'flex', alignItems: 'center', height: '35px', padding: '0 16px', backgroundColor: 'hsl(var(--primary-neon))', color: '#000', fontWeight: '900', fontSize: '0.9rem' }}>
                      <div style={{ width: getColWidth('item'), flexShrink: 0 }}></div>
                      <div style={{ width: getColWidth('descripcion') + getColWidth('unidad') + getColWidth('cantidad') + getColWidth('vlrUnitario'), textAlign: 'right', paddingRight: '16px' }}>VALOR TOTAL DEL CONTRATO</div>
                      <div style={{ width: getColWidth('vlrTotal'), textAlign: 'right', paddingRight: '4px' }}>{formatCurrency(totalContract)}</div>
                      <div style={{ width: getColWidth('acciones') }}></div>
                    </div>
                  );

                  return rows;
                })()}
              </div>
            </div>
          </div>
        )}

        <NameModal
          isOpen={showNameModal}
          value={newName}
          onChange={setNewName}
          onConfirm={() => {
            if (newName.trim() && project) {
              if (modalMode === 'rename' && targetVersionId) {
                renameBudgetVersion(project.id, targetVersionId, newName.trim());
              } else {
                createBudgetVersion(project.id, newName.trim());
              }
              setShowNameModal(false);
              setTargetVersionId(null);
            }
          }}
          onCancel={() => { setShowNameModal(false); setTargetVersionId(null); }}
        />

        {/* Modal dual para crear nuevo presupuesto */}
        {showCreateModal && (
          <div style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            background: 'rgba(0,0,0,0.85)', zIndex: 10001,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            backdropFilter: 'blur(8px)'
          }}>
            <div style={{
              background: 'linear-gradient(160deg, #0d1526 0%, #0f172a 100%)',
              border: '1px solid #1e293b',
              padding: '32px', borderRadius: '16px', width: '480px',
              boxShadow: '0 30px 80px rgba(0,0,0,0.6)'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
                <h3 style={{ margin: 0, color: '#fff', fontSize: '1.1rem', fontWeight: 'bold' }}>Nuevo Presupuesto</h3>
                <button onClick={() => setShowCreateModal(false)} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.5)', cursor: 'pointer', padding: '4px' }}>
                  <X size={20} />
                </button>
              </div>

              <div style={{ marginBottom: '24px' }}>
                <label style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: '8px' }}>Nombre del escenario</label>
                <input
                  type="text"
                  value={createModalName}
                  onChange={e => setCreateModalName(e.target.value)}
                  placeholder="Ej: Presupuesto Modificado V1..."
                  style={{
                    width: '100%', padding: '10px 14px', background: '#1e293b',
                    border: '1px solid #334155', borderRadius: '8px', color: '#fff',
                    outline: 'none', fontSize: '0.9rem', boxSizing: 'border-box'
                  }}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                {/* Opción 1: Duplicar */}
                <button
                  onClick={() => {
                    if (!project || !createModalName.trim()) return;
                    createBudgetVersion(project.id, createModalName.trim());
                    setShowCreateModal(false);
                  }}
                  style={{
                    background: createModalMethod === 'duplicate' ? 'hsla(220, 80%, 50%, 0.2)' : 'hsla(220, 60%, 20%, 0.3)',
                    border: '1px solid hsl(220, 60%, 40%)',
                    borderRadius: '12px', padding: '20px 16px',
                    cursor: 'pointer', textAlign: 'center', color: '#fff',
                    transition: 'all 0.2s'
                  }}
                  onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = 'hsl(220, 80%, 60%)'; (e.currentTarget as HTMLButtonElement).style.background = 'hsla(220, 80%, 50%, 0.2)'; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = 'hsl(220, 60%, 40%)'; (e.currentTarget as HTMLButtonElement).style.background = 'hsla(220, 60%, 20%, 0.3)'; }}
                >
                  <Copy size={28} color="hsl(220, 80%, 70%)" style={{ marginBottom: '10px' }} />
                  <div style={{ fontWeight: 'bold', fontSize: '0.9rem', marginBottom: '6px' }}>Duplicar Actual</div>
                  <div style={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.5)', lineHeight: 1.4 }}>Copia el presupuesto activo con todos sus ítems y programación</div>
                </button>

                {/* Opción 2: Importar Excel */}
                <button
                  onClick={() => {
                    if (!createModalName.trim()) return;
                    excelImportRef.current?.click();
                  }}
                  style={{
                    background: 'hsla(160, 60%, 20%, 0.3)',
                    border: '1px solid hsl(160, 60%, 40%)',
                    borderRadius: '12px', padding: '20px 16px',
                    cursor: 'pointer', textAlign: 'center', color: '#fff',
                    transition: 'all 0.2s'
                  }}
                  onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = 'hsl(160, 80%, 60%)'; (e.currentTarget as HTMLButtonElement).style.background = 'hsla(160, 80%, 50%, 0.2)'; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = 'hsl(160, 60%, 40%)'; (e.currentTarget as HTMLButtonElement).style.background = 'hsla(160, 60%, 20%, 0.3)'; }}
                >
                  <Upload size={28} color="hsl(160, 80%, 70%)" style={{ marginBottom: '10px' }} />
                  <div style={{ fontWeight: 'bold', fontSize: '0.9rem', marginBottom: '6px' }}>Importar Excel</div>
                  <div style={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.5)', lineHeight: 1.4 }}>Sube un .xlsx con el nuevo presupuesto (preserva fechas de ítems existentes)</div>
                </button>
              </div>

              <input
                ref={excelImportRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                style={{ display: 'none' }}
                onChange={handleCreateModalExcelChange}
              />

              <div style={{ marginTop: '20px', textAlign: 'center' }}>
                <button onClick={() => setShowCreateModal(false)} style={{ background: 'none', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.5)', padding: '8px 20px', borderRadius: '8px', cursor: 'pointer', fontSize: '0.8rem' }}>Cancelar</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// Modal Component for Naming
function NameModal({ isOpen, value, onChange, onConfirm, onCancel }: any) {
  if (!isOpen) return null;
  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      background: 'rgba(0,0,0,0.8)', zIndex: 10000,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      backdropFilter: 'blur(4px)'
    }}>
      <div style={{
        background: '#0f172a', border: '1px solid #1e293b',
        padding: '24px', borderRadius: '12px', width: '350px',
        boxShadow: '0 20px 50px rgba(0,0,0,0.5)'
      }}>
        <h3 style={{ margin: '0 0 16px 0', color: '#fff', fontSize: '1rem' }}>Nombre del Presupuesto</h3>
        <input
          autoFocus
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') onConfirm(); if (e.key === 'Escape') onCancel(); }}
          style={{
            width: '100%', padding: '10px', background: '#1e293b',
            border: '1px solid #334155', borderRadius: '6px', color: '#fff',
            marginBottom: '20px', outline: 'none'
          }}
        />
        <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
          <button className="btn btn-secondary" onClick={onCancel}>Cancelar</button>
          <button className="btn btn-primary" onClick={onConfirm} style={{ background: 'hsl(var(--primary-neon))', color: '#000' }}>
            Guardar Copia
          </button>
        </div>
      </div>
    </div>
  );
}
