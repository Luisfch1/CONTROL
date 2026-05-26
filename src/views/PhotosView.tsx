import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  Search, Filter, Calendar,
  Trash2, ChevronLeft, ChevronRight, X,
  Grid3X3, LayoutGrid, Square, CheckCircle2,
  Download, FileText, Folder, Wand2
} from 'lucide-react';
import { useProjects } from '../context/ProjectsContext';
import { useAgent } from '../context/AgentContext';
import PhotoReportWizard from './PhotoReportWizard';
import './Dashboard.css';

// Componente para cargar imágenes locales dinámicamente
const LocalImage = ({ photo, getPhotoLocalUrl, className, style, onLoad }: any) => {
  const [url, setUrl] = useState<string | null>(photo.isLocal ? null : photo.imageUrl);

  useEffect(() => {
    let active = true;
    if (photo.isLocal) {
      getPhotoLocalUrl(photo.id).then((blobUrl: string | null) => {
        if (active && blobUrl) setUrl(blobUrl);
      });
    }
    return () => { active = false; };
  }, [photo.id, photo.isLocal, getPhotoLocalUrl]);

  return url ? <img src={url} alt={photo.description} className={className} style={style} onLoad={onLoad} loading="lazy" /> : null;
};

export default function PhotosView() {
  const { 
    getActiveProject, removeLogiEntry, removeLogiEntries, 
    acceptAiProposal, rejectAiProposal, importLocalPhotosBackup, getPhotoLocalUrl,
    selectedPhotoId, setSelectedPhotoId, updateLogiEntry, updateLogiEntries
  } = useProjects();
  const { generatePhotoProposals } = useAgent();
  const project = getActiveProject();
  const [filter, setFilter] = useState('');
  const [gridSize, setGridSize] = useState(() => {
    const saved = localStorage.getItem('lch-control-gridsize');
    return saved ? parseInt(saved) : 3;
  }); // 2, 3, o 4 columnas
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [isWizardOpen, setIsWizardOpen] = useState(false);

  const [editingItemCode, setEditingItemCode] = useState('');
  const [editingDescription, setEditingDescription] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [itemFilter, setItemFilter] = useState('');
  const [showItemsTable, setShowItemsTable] = useState(false);

  const [showBulkAssignModal, setShowBulkAssignModal] = useState(false);
  const [bulkItemFilter, setBulkItemFilter] = useState('');
  const [showOnlyUnassigned, setShowOnlyUnassigned] = useState(false);



  // Manejo de teclado para la galería (Esc, Left, Right)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (selectedIdx === null) return;
      if (e.key === 'Escape') setSelectedIdx(null);
      if (e.key === 'ArrowLeft') handlePrev();
      if (e.key === 'ArrowRight') handleNext();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedIdx]);

  useEffect(() => {
    localStorage.setItem('lch-control-gridsize', gridSize.toString());
  }, [gridSize]);

  if (!project) {
    return (
      <div className="flex-center" style={{ height: '70vh', color: 'hsl(var(--text-muted))', flexDirection: 'column', gap: 'var(--spacing-md)' }}>
        <Filter size={48} style={{ opacity: 0.2 }} />
        <p className="font-medium">Seleccione un proyecto para ver el registro fotográfico.</p>
      </div>
    );
  }

  const [visibleCount, setVisibleCount] = useState(20);

  const photos = project.logiEntries || [];

  const activeVersion = project.budgetVersions?.find(v => v.id === project.activeBudgetVersionId);
  const budgetItems = activeVersion?.items || project.budgetItems || [];
  const onlyItems = budgetItems.filter(i => i.type === 'item');

  const filteredItems = onlyItems.filter(item =>
    (item.item || '').toLowerCase().includes(itemFilter.toLowerCase()) ||
    (item.descripcion || '').toLowerCase().includes(itemFilter.toLowerCase())
  );

  const filteredPhotos = [...photos]
    .filter(p => {
      if (showOnlyUnassigned && p.itemCode && p.itemCode.trim() !== '') {
        return false;
      }
      return (
        (p.itemCode || '').toLowerCase().includes(filter.toLowerCase()) ||
        (p.description || '').toLowerCase().includes(filter.toLowerCase())
      );
    })
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  const currentPhoto = selectedIdx !== null ? filteredPhotos[selectedIdx] : null;

  useEffect(() => {
    if (currentPhoto) {
      setEditingItemCode(currentPhoto.itemCode || '');
      setEditingDescription(currentPhoto.description || '');
      setSaveSuccess(false);
      setItemFilter('');
      setShowItemsTable(false);
    } else {
      setEditingItemCode('');
      setEditingDescription('');
      setSaveSuccess(false);
      setItemFilter('');
      setShowItemsTable(false);
    }
  }, [currentPhoto]);

  const handleSavePhotoDetails = () => {
    if (!project || !currentPhoto) return;
    setIsSaving(true);
    updateLogiEntry(project.id, currentPhoto.id, {
      itemCode: editingItemCode.trim(),
      description: editingDescription.trim(),
      status: 'integrated'
    });
    setIsSaving(false);
    setSaveSuccess(true);
  };

  // Sincronizar selección externa de foto desde el Resumen (Dashboard)
  useEffect(() => {
    if (selectedPhotoId) {
      const idx = filteredPhotos.findIndex(p => String(p.id) === String(selectedPhotoId));
      if (idx !== -1) {
        setSelectedIdx(idx);
      }
      setSelectedPhotoId(null);
    }
  }, [selectedPhotoId, filteredPhotos, setSelectedPhotoId]);

  useEffect(() => {
    setVisibleCount(20);
  }, [filter, showOnlyUnassigned]);

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const { scrollTop, scrollHeight, clientHeight } = e.currentTarget;
    if (scrollHeight - scrollTop <= clientHeight + 300) {
      if (visibleCount < filteredPhotos.length) {
        setVisibleCount(prev => prev + 20);
      }
    }
  };

  const handleDownload = async (photo: any) => {
    try {
      let url = photo.imageUrl;
      if (photo.isLocal) {
        url = await getPhotoLocalUrl(photo.id);
      }
      if (!url) {
        alert("⚠️ No se pudo obtener la imagen local.");
        return;
      }
      const response = await fetch(url);
      const blob = await response.blob();
      const blobUrl = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = `EVIDENCIA_${photo.itemCode}_${new Date().getTime()}.jpg`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(blobUrl);
      if (photo.isLocal) {
        window.URL.revokeObjectURL(url);
      }
    } catch (err) {
      console.error("Download failed", err);
      if (photo.imageUrl) {
        window.open(photo.imageUrl, '_blank');
      }
    }
  };

  const handleDelete = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    e.preventDefault();
    if (confirm("¿Está seguro de que desea eliminar esta evidencia del registro local?")) {
      removeLogiEntry(project.id, id);
      setSelectedIds(prev => prev.filter(selectedId => String(selectedId) !== String(id)));
      
      const flash = document.createElement('div');
      flash.innerText = "✓ Eliminada";
      flash.style.position = 'fixed';
      flash.style.bottom = '40px';
      flash.style.right = '40px';
      flash.style.background = 'hsl(var(--danger))';
      flash.style.color = '#fff';
      flash.style.padding = '12px 24px';
      flash.style.borderRadius = '12px';
      flash.style.fontWeight = '800';
      flash.style.zIndex = '10000';
      document.body.appendChild(flash);
      setTimeout(() => flash.remove(), 2500);
    }
  };

  const handleAiProposalsForSelected = async () => {
    if (selectedIds.length === 0) return;
    const selectedPhotos = photos.filter(p => selectedIds.includes(p.id));
    if (selectedPhotos.length > 5) {
      alert("Para evitar sobrepasar los límites de cuota de la API, se procesarán las primeras 5 fotos seleccionadas.");
    }
    const targetPhotos = selectedPhotos.slice(0, 5);
    await generatePhotoProposals(targetPhotos);
    setSelectedIds([]);
  };

  const handleProposeOrphansWithAi = async () => {
    const orphanPhotos = photos.filter(p => {
      const noItem = !p.itemCode || p.itemCode === 'S/N' || p.itemCode === 'General' || p.itemCode.trim() === '';
      const noDesc = !p.description || p.description.trim().length < 5;
      return noItem || noDesc;
    });

    if (orphanPhotos.length === 0) {
      alert("¡Excelente! Todas las fotos de este proyecto ya cuentan con ítem y descripción asignados.");
      return;
    }

    const sortedOrphans = [...orphanPhotos].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    const batch = sortedOrphans.slice(0, 3);
    const flash = document.createElement('div');
    flash.innerText = `🤖 Generando propuestas para ${batch.length} fotos...`;
    flash.style.position = 'fixed';
    flash.style.bottom = '40px';
    flash.style.right = '40px';
    flash.style.background = 'hsl(var(--accent-primary))';
    flash.style.color = '#000';
    flash.style.padding = '12px 24px';
    flash.style.borderRadius = '12px';
    flash.style.fontWeight = '800';
    flash.style.zIndex = '10000';
    document.body.appendChild(flash);

    try {
      await generatePhotoProposals(batch);
    } finally {
      flash.remove();
    }
  };

  const handleToggleSelect = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    setSelectedIds(prev =>
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    );
  };

  const handleSelectAll = () => {
    if (selectedIds.length === filteredPhotos.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(filteredPhotos.map(p => p.id));
    }
  };

  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);

  const handleDeleteSelected = () => {
    if (selectedIds.length === 0) return;
    if (!isConfirmingDelete) {
      setIsConfirmingDelete(true);
      setTimeout(() => setIsConfirmingDelete(false), 4000);
      return;
    }
    try {
      const count = selectedIds.length;
      removeLogiEntries(project.id, selectedIds);
      setSelectedIds([]);
      setIsConfirmingDelete(false);
      const flash = document.createElement('div');
      flash.innerText = `✓ ${count} eliminadas`;
      flash.style.position = 'fixed';
      flash.style.bottom = '40px';
      flash.style.right = '40px';
      flash.style.background = 'hsl(var(--danger))';
      flash.style.color = '#fff';
      flash.style.padding = '12px 24px';
      flash.style.borderRadius = '12px';
      flash.style.fontWeight = '800';
      flash.style.zIndex = '10000';
      document.body.appendChild(flash);
      setTimeout(() => flash.remove(), 3000);
    } catch (err: any) {
      alert("Error: " + err.message);
      setIsConfirmingDelete(false);
    }
  };

  const handlePrev = () => {
    setSelectedIdx(prev => (prev !== null && prev > 0) ? prev - 1 : prev);
  };

  const handleNext = () => {
    setSelectedIdx(prev => (prev !== null && prev < filteredPhotos.length - 1) ? prev + 1 : prev);
  };

  const hasCloudConfig = !!(project.cloudConfig?.url && project.cloudConfig?.apiKey);

  return (
    <div className="dashboard-container animate-in">
      {isWizardOpen && <PhotoReportWizard onClose={() => setIsWizardOpen(false)} />}
      
      <div className="page-header" style={{ flexShrink: 0 }}>
        <div>
          <h2 className="page-title">Registro Fotográfico</h2>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginTop: '4px' }}>
            <div className={`badge ${hasCloudConfig ? 'badge-accent' : 'badge-warning'}`}
              style={{ fontSize: '10px', padding: '2px 8px', fontWeight: '900', letterSpacing: '0.5px' }}>
              {hasCloudConfig ? 'LOGI CLOUD SYNC' : 'MODO LOCAL'}
            </div>
            <p style={{ color: 'hsl(var(--text-muted))', fontSize: '0.7rem', fontWeight: '600', margin: 0, textTransform: 'uppercase', letterSpacing: '0.1em' }}>
              {filteredPhotos.length} EVIDENCIAS ENCONTRADAS
            </p>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-md)' }}>
          <button 
            className="btn btn-secondary" 
            onClick={() => importLocalPhotosBackup(project.id)}
            style={{ fontWeight: '700', background: 'hsl(var(--bg-tertiary))', border: '1px solid var(--border-color)' }}
            title="Enlazar archivo local .lchp"
          >
            <Folder size={16} /> CARGAR .LCHP
          </button>
        </div>
      </div>

      <div style={{
        display: 'flex',
        flexShrink: 0,
        height: '44px',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 16px',
        borderBottom: '1px solid hsl(var(--border-color))',
        backgroundColor: 'hsla(var(--bg-tertiary), 0.4)',
        backdropFilter: 'blur(10px)',
        position: 'relative'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-lg)' }}>
          <div style={{ display: 'flex', gap: '2px', background: 'hsl(var(--bg-primary))', padding: '3px', borderRadius: '6px', border: '1px solid var(--border-color)' }}>
            <button className={`grid-btn ${gridSize === 4 ? 'active' : ''}`} onClick={() => setGridSize(4)} style={{ width: '32px', height: '32px', color: gridSize === 4 ? 'white' : 'hsl(var(--text-muted))' }}><Grid3X3 size={14} /></button>
            <button className={`grid-btn ${gridSize === 3 ? 'active' : ''}`} onClick={() => setGridSize(3)} style={{ width: '32px', height: '32px', color: gridSize === 3 ? 'white' : 'hsl(var(--text-muted))' }}><LayoutGrid size={14} /></button>
            <button className={`grid-btn ${gridSize === 2 ? 'active' : ''}`} onClick={() => setGridSize(2)} style={{ width: '32px', height: '32px', color: gridSize === 2 ? 'white' : 'hsl(var(--text-muted))' }}><Square size={14} /></button>
          </div>
          <div style={{ width: '1px', height: '24px', background: 'var(--border-color)', opacity: 0.5 }}></div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button className="btn btn-ghost" onClick={handleSelectAll} style={{ fontSize: '0.7rem', padding: '4px 12px', height: '32px', fontWeight: '800', background: 'var(--surface-glass)', border: '1px solid var(--border-color)', color: 'hsl(var(--text-primary))' }}>
              {selectedIds.length === filteredPhotos.length ? 'DESELECCIONAR' : 'SELECCIONAR TODO'}
            </button>
            {selectedIds.length > 1 && (
              <button
                className="btn btn-ghost"
                onClick={() => {
                  setBulkItemFilter('');
                  setShowBulkAssignModal(true);
                }}
                style={{
                  fontSize: '0.7rem',
                  padding: '4px 12px',
                  height: '32px',
                  color: 'black',
                  background: 'hsl(var(--accent-primary))',
                  border: 'none',
                  fontWeight: '800'
                }}
              >
                ASIGNAR ÍTEM
              </button>
            )}
            {selectedIds.length > 0 && (
              <button
                className="btn btn-ghost"
                onClick={handleAiProposalsForSelected}
                style={{
                  fontSize: '0.7rem',
                  padding: '4px 12px',
                  height: '32px',
                  color: 'black',
                  background: 'hsl(var(--accent-primary))',
                  border: 'none',
                  fontWeight: '800',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px'
                }}
              >
                <Wand2 size={12} /> PROPUESTA IA
              </button>
            )}
            {selectedIds.length > 0 && (
              <button
                className="btn btn-ghost"
                onClick={handleDeleteSelected}
                style={{
                  fontSize: '0.7rem',
                  padding: '4px 12px',
                  height: '32px',
                  color: 'white',
                  background: isConfirmingDelete ? 'hsl(var(--warning))' : 'hsl(var(--danger))',
                  border: 'none',
                  fontWeight: '900',
                  transition: 'all 0.2s ease',
                  transform: isConfirmingDelete ? 'scale(1.05)' : 'scale(1)'
                }}
              >
                {isConfirmingDelete ? `¿ESTÁS SEGURO DE BORRAR ${selectedIds.length}?` : `ELIMINAR (${selectedIds.length})`}
              </button>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button
            onClick={() => setShowOnlyUnassigned(!showOnlyUnassigned)}
            style={{
              height: '32px',
              padding: '0 12px',
              borderRadius: '6px',
              fontSize: '0.7rem',
              fontWeight: '800',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              transition: 'all 0.2s ease',
              background: showOnlyUnassigned ? 'hsl(var(--warning) / 0.15)' : 'rgba(255,255,255,0.03)',
              border: showOnlyUnassigned ? '1px solid hsl(var(--warning))' : '1px solid var(--border-color)',
              color: showOnlyUnassigned ? 'hsl(var(--warning))' : 'hsl(var(--text-muted))'
            }}
            title="Mostrar solo evidencias sin ítem asignado"
          >
            <Filter size={12} />
            SIN ÍTEM
          </button>
          
          <button
            onClick={handleProposeOrphansWithAi}
            style={{
              height: '32px',
              padding: '0 12px',
              borderRadius: '6px',
              fontSize: '0.7rem',
              fontWeight: '800',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              transition: 'all 0.2s ease',
              background: 'hsla(var(--accent-primary), 0.1)',
              border: '1px solid hsla(var(--accent-primary), 0.3)',
              color: 'hsl(var(--accent-primary))'
            }}
            title="Generar propuestas de ítem/descripción para las fotos sin clasificar"
          >
            <Wand2 size={12} /> PROPUESTA IA AUTOMÁTICA
          </button>
          
          <div style={{ position: 'relative', width: '280px' }}>
            <Search size={14} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'hsl(var(--accent-primary))' }} />
            <input
              type="text"
              className="input-field"
              placeholder="BUSCAR EVIDENCIA..."
              style={{
                width: '100%',
                paddingLeft: '38px',
                borderRadius: '6px',
                height: '32px',
                fontSize: '0.75rem',
                background: 'hsl(var(--bg-secondary))',
                border: '1px solid var(--border-color)',
                color: 'hsl(var(--text-primary))',
                fontWeight: '600'
              }}
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
          </div>
        </div>
      </div>

      <div
        onScroll={handleScroll}
        style={{
          flex: 1,
          overflowY: 'auto',
          overflowX: 'hidden',
          padding: 'var(--spacing-lg)'
        }}
      >
        {filteredPhotos.length === 0 ? (
          <div className="flex-center" style={{ padding: 'var(--spacing-2xl) 0', textAlign: 'center', height: '100%', flexDirection: 'column' }}>
            <div style={{ opacity: 0.1, marginBottom: 'var(--spacing-lg)' }}>
              <Folder size={96} style={{ margin: '0 auto' }} />
            </div>
            <h3 className="font-bold">No hay evidencias registradas</h3>
            <p style={{ color: 'hsl(var(--text-muted))', maxWidth: '350px' }}>
              Cargue un archivo .lchp para importar evidencias fotográficas desde Logi.
            </p>
          </div>
        ) : (
          <div style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${gridSize}, 1fr)`,
            gap: gridSize === 4 ? 'var(--spacing-md)' : 'var(--spacing-xl)'
          }}>
            {filteredPhotos.slice(0, visibleCount).map((photo, idx) => (
              <div
                key={photo.id}
                className="photo-card animate-in glass-card"
                onClick={(e) => {
                  // Prevent opening lightbox if clicking on any interactive element
                  if ((e.target as HTMLElement).closest('button') || 
                      (e.target as HTMLElement).closest('.selection-overlay') || 
                      (e.target as HTMLElement).closest('.badge')) return;
                  setSelectedIdx(idx);
                }}
                style={{
                  animationDelay: idx < 20 ? `${idx * 0.03}s` : '0s',
                  overflow: 'hidden',
                  transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                  cursor: 'pointer',
                  position: 'relative',
                  padding: '0',
                  boxShadow: selectedIds.includes(photo.id) ? '0 0 0 2px hsl(var(--accent-primary)), 0 10px 30px -10px hsl(var(--accent-primary) / 0.3)' : 'none',
                  transform: selectedIds.includes(photo.id) ? 'scale(0.98)' : 'none'
                }}
              >
                <div
                  className="photo-placeholder-shimmer"
                  style={{
                    position: 'relative',
                    height: gridSize === 4 ? '160px' : '220px',
                    background: 'hsl(var(--bg-tertiary))',
                    overflow: 'hidden'
                  }}
                >
                  <LocalImage
                    photo={photo}
                    getPhotoLocalUrl={getPhotoLocalUrl}
                    className="photo-img"
                    onLoad={(e: any) => (e.currentTarget.style.opacity = '1')}
                    style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 0, opacity: 0, transition: 'opacity 0.6s ease' }}
                  />

                  <div
                    className={`selection-overlay ${selectedIds.includes(photo.id) ? 'active' : ''}`}
                    onClick={(e) => handleToggleSelect(e, photo.id)}
                    onMouseDown={(e) => e.stopPropagation()}
                    style={{
                      position: 'absolute',
                      top: '12px',
                      left: '12px',
                      zIndex: 10,
                      cursor: 'pointer',
                      color: selectedIds.includes(photo.id) ? 'hsl(var(--accent-primary))' : 'white',
                      filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.5))',
                      transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
                      opacity: selectedIds.includes(photo.id) ? 1 : 0
                    }}
                  >
                    <CheckCircle2 size={24} fill={selectedIds.includes(photo.id) ? 'currentColor' : 'rgba(0,0,0,0.2)'} color={selectedIds.includes(photo.id) ? 'black' : 'white'} />
                  </div>

                  <div 
                    onMouseDown={(e) => e.stopPropagation()}
                    style={{ position: 'absolute', top: '12px', right: '12px', display: 'flex', gap: '8px', zIndex: 25 }}
                  >
                    <button
                      className="icon-btn delete-btn"
                      onClick={(e) => handleDelete(e, photo.id)}
                      style={{ background: 'hsl(var(--danger) / 0.9)', color: 'white', border: 'none', padding: '10px', borderRadius: '10px', backdropFilter: 'blur(8px)', boxShadow: '0 4px 12px rgba(0,0,0,0.3)', cursor: 'pointer' }}
                    >
                      <Trash2 size={14} />
                    </button>
                    <span className={`badge ${photo.status === 'integrated' ? 'badge-success' : 'badge-accent'}`}
                      style={{ fontSize: '9px', fontWeight: '800', backdropFilter: 'blur(10px)' }}>
                      {photo.status === 'integrated' ? 'OK' : 'PND'}
                    </span>
                  </div>
                </div>

                <div style={{
                  padding: gridSize === 4 ? '8px 10px' : '12px 14px',
                  backgroundColor: 'hsla(var(--bg-tertiary), 0.85)',
                  borderTop: '1px solid var(--border-color)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '4px'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '2px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <div style={{ width: '4px', height: '4px', borderRadius: '50%', background: 'hsl(var(--primary-neon))' }}></div>
                      <span style={{
                        fontSize: '0.6rem',
                        fontWeight: '800',
                        color: 'hsl(var(--primary-neon))',
                        letterSpacing: '0.1em',
                        fontFamily: 'var(--font-technical)',
                        textTransform: 'uppercase'
                      }}>
                        ITEM {photo.itemCode || 'S/N'}
                      </span>
                    </div>
                    <div style={{
                      fontSize: '0.6rem',
                      color: 'hsl(var(--text-muted))',
                      fontWeight: '700',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px',
                      fontFamily: 'var(--font-technical)'
                    }}>
                      <Calendar size={10} />
                      {photo.date ? photo.date.split('-').slice(1, 3).reverse().map(n => parseInt(n)).join('/') : '—'}
                    </div>
                  </div>

                  <p
                    className="photo-desc"
                    style={{
                      fontSize: gridSize === 4 ? '0.7rem' : '0.75rem',
                      lineHeight: '1.3',
                      margin: 0,
                      color: 'hsl(var(--text-primary))',
                      fontWeight: '600',
                      opacity: 0.9
                    }}>
                    {photo.description || 'Sin descripción.'}
                  </p>

                  {/* UI DE PROPUESTA IA - ADN ZAPATAS */}
                  {photo.aiProposal && (
                    <div style={{
                      marginTop: '8px',
                      padding: '8px',
                      background: 'linear-gradient(135deg, hsla(var(--accent-primary), 0.1) 0%, transparent 100%)',
                      border: '1px solid hsla(var(--accent-primary), 0.3)',
                      borderRadius: '8px',
                      position: 'relative'
                    }}>
                      <div style={{ fontSize: '0.6rem', color: 'hsl(var(--accent-primary))', fontWeight: '900', marginBottom: '4px', letterSpacing: '0.5px' }}>
                        PROPUESTA IA ({Math.round((photo.aiProposal.confidence || 0.9) * 100)}%)
                      </div>
                      <div style={{ fontSize: '0.65rem', fontWeight: '800', color: '#fff', marginBottom: '2px' }}>
                        ITEM: {photo.aiProposal.itemCode}
                      </div>
                      <div style={{ fontSize: '0.65rem', opacity: 0.8, fontStyle: 'italic', lineHeight: '1.2' }}>
                        "{photo.aiProposal.description}"
                      </div>
                      <div style={{ display: 'flex', gap: '6px', marginTop: '8px' }}>
                        <button 
                          className="btn-sync" 
                          onClick={(e) => { e.stopPropagation(); acceptAiProposal(project.id, photo.id); }}
                          style={{ padding: '4px 10px', fontSize: '0.6rem', background: 'hsl(var(--accent-primary))', color: '#000', border: 'none', borderRadius: '4px', fontWeight: '800', cursor: 'pointer' }}
                        >
                          ACEPTAR
                        </button>
                        <button 
                          onClick={(e) => { e.stopPropagation(); rejectAiProposal(project.id, photo.id); }}
                          style={{ padding: '4px 10px', fontSize: '0.6rem', background: 'rgba(255,255,255,0.1)', color: '#fff', border: 'none', borderRadius: '4px', fontWeight: '800', cursor: 'pointer' }}
                        >
                          DESCARTAR
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {selectedIdx !== null && filteredPhotos[selectedIdx] && createPortal(
        <div className="lightbox-overlay" onClick={() => setSelectedIdx(null)}>
          
          {/* Close Button at Overlay corner (no overlap) */}
          <button 
            onClick={(e) => { e.stopPropagation(); setSelectedIdx(null); }}
            style={{
              position: 'absolute',
              top: '25px',
              right: '25px',
              background: 'rgba(255,255,255,0.1)',
              border: 'none',
              color: 'white',
              padding: '10px',
              borderRadius: '50%',
              cursor: 'pointer',
              zIndex: 10100,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'background 0.2s'
            }}
            onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.2)'}
            onMouseLeave={e => e.currentTarget.style.background = 'rgba(255,255,255,0.1)'}
          >
            <X size={24} />
          </button>

          {/* Download Button at Overlay corner (no overlap) */}
          <button
            onClick={(e) => { e.stopPropagation(); handleDownload(filteredPhotos[selectedIdx]); }}
            style={{
              position: 'absolute',
              top: '25px',
              right: '75px',
              background: 'hsl(var(--accent-primary))',
              border: 'none',
              color: '#000',
              padding: '12px',
              borderRadius: '50%',
              cursor: 'pointer',
              zIndex: 10100,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'opacity 0.2s'
            }}
            onMouseEnter={e => e.currentTarget.style.opacity = '0.8'}
            onMouseLeave={e => e.currentTarget.style.opacity = '1'}
            title="Descargar Foto"
          >
            <Download size={20} />
          </button>

          <div className="lightbox-content" onClick={e => e.stopPropagation()} style={{ position: 'relative' }}>
            <button className="lightbox-nav prev" onClick={handlePrev} disabled={selectedIdx === 0} style={{ position: 'absolute', left: '20px', zIndex: 10 }}>
              <ChevronLeft size={32} />
            </button>

            <div style={{
              display: 'flex',
              flexDirection: 'row',
              width: '100%',
              height: '100%',
              gap: '24px',
              alignItems: 'stretch',
              padding: '0 80px',
              boxSizing: 'border-box',
              justifyContent: showItemsTable ? 'stretch' : 'center',
              transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)'
            }}>
              {/* Left Column: Photo + Editing Metadata Form */}
              <div style={{
                flex: showItemsTable ? '1 1 45%' : '0 1 950px',
                display: 'flex',
                flexDirection: 'column',
                gap: '16px',
                justifyContent: 'space-between',
                height: '100%',
                minWidth: showItemsTable ? '350px' : 'none',
                transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)'
              }}>
                <div style={{
                  flex: 1,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: 'rgba(0,0,0,0.4)',
                  borderRadius: '12px',
                  border: '1px solid rgba(255,255,255,0.05)',
                  overflow: 'hidden',
                  maxHeight: showItemsTable ? '60vh' : '78vh',
                  transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)'
                }}>
                  <LocalImage
                    photo={filteredPhotos[selectedIdx]}
                    getPhotoLocalUrl={getPhotoLocalUrl}
                    className="lightbox-img"
                    style={{
                      maxHeight: '100%',
                      maxWidth: '100%',
                      objectFit: 'contain',
                      borderRadius: '8px'
                    }}
                  />
                </div>

                <div className="lightbox-info" style={{
                  padding: '12px 16px',
                  background: 'rgba(255,255,255,0.03)',
                  backdropFilter: 'blur(10px)',
                  borderRadius: '12px',
                  border: '1px solid rgba(255,255,255,0.08)',
                  textAlign: 'left'
                }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    
                    {/* Caja interactiva del Ítem (Badge + Descripción + Quitar + Fecha) */}
                    <div 
                      onClick={() => setShowItemsTable(!showItemsTable)}
                      style={{
                        padding: '10px 14px',
                        background: 'rgba(255,255,255,0.02)',
                        border: showItemsTable ? '1px solid hsl(var(--accent-primary))' : '1px solid rgba(255,255,255,0.08)',
                        borderRadius: '8px',
                        cursor: 'pointer',
                        transition: 'all 0.2s ease',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '6px'
                      }}
                      onMouseEnter={e => {
                        e.currentTarget.style.background = 'rgba(255,255,255,0.04)';
                        if (!showItemsTable) e.currentTarget.style.borderColor = 'rgba(255,255,255,0.2)';
                      }}
                      onMouseLeave={e => {
                        e.currentTarget.style.background = 'rgba(255,255,255,0.02)';
                        if (!showItemsTable) e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)';
                      }}
                      title="Haz clic para seleccionar o cambiar ítem"
                    >
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          {editingItemCode ? (
                            <span style={{
                              background: 'hsl(var(--accent-primary))',
                              color: '#000',
                              padding: '3px 8px',
                              borderRadius: '4px',
                              fontSize: '0.7rem',
                              fontWeight: '800',
                              textTransform: 'uppercase',
                              letterSpacing: '0.5px'
                            }}>
                              ÍTEM {editingItemCode}
                            </span>
                          ) : (
                            <span style={{
                              background: 'rgba(255,255,255,0.1)',
                              color: 'hsl(var(--accent-primary))',
                              padding: '3px 8px',
                              borderRadius: '4px',
                              fontSize: '0.7rem',
                              fontWeight: '800',
                              textTransform: 'uppercase',
                              letterSpacing: '0.5px'
                            }}>
                              ASIGNAR ÍTEM
                            </span>
                          )}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                          {editingItemCode && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setEditingItemCode('');
                                setSaveSuccess(false);
                              }}
                              style={{
                                background: 'transparent',
                                border: 'none',
                                color: 'hsl(var(--danger))',
                                fontSize: '0.65rem',
                                cursor: 'pointer',
                                fontWeight: '700',
                                textTransform: 'uppercase',
                                padding: '2px 6px'
                              }}
                              title="Quitar asignación"
                            >
                              Quitar
                            </button>
                          )}
                          <span style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.4)', whiteSpace: 'nowrap' }}>
                            {filteredPhotos[selectedIdx].date}
                          </span>
                        </div>
                      </div>
                      
                      {editingItemCode && (
                        <div style={{ 
                          fontSize: '0.8rem', 
                          color: 'rgba(255,255,255,0.85)', 
                          fontWeight: '600', 
                          lineHeight: '1.3'
                        }}>
                          {onlyItems.find(i => i.item === editingItemCode)?.descripcion}
                        </div>
                      )}
                    </div>

                    {/* Fila Horizontal: Descripción + Botón Guardar */}
                    <div style={{ 
                      paddingTop: '8px', 
                      borderTop: '1px solid rgba(255,255,255,0.05)',
                      display: 'flex',
                      flexDirection: 'row',
                      gap: '12px',
                      alignItems: 'flex-end'
                    }}>
                      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        <label style={{ fontSize: '0.65rem', fontWeight: '800', color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '1px' }}>
                          DESCRIPCIÓN DE LA EVIDENCIA
                        </label>
                        <textarea
                          value={editingDescription}
                          onChange={e => {
                            setEditingDescription(e.target.value);
                            setSaveSuccess(false);
                          }}
                          placeholder="Escribe la descripción de la evidencia fotográfica..."
                          style={{
                            background: 'rgba(0, 0, 0, 0.3)',
                            border: '1px solid rgba(255, 255, 255, 0.12)',
                            color: '#fff',
                            borderRadius: '8px',
                            padding: '8px 12px',
                            fontSize: '0.8rem',
                            lineHeight: '1.3',
                            outline: 'none',
                            resize: 'none',
                            width: '100%',
                            height: '38px',
                            fontFamily: 'inherit',
                            boxSizing: 'border-box'
                          }}
                          onFocus={e => e.target.style.borderColor = 'hsl(var(--accent-primary))'}
                          onBlur={e => e.target.style.borderColor = 'rgba(255, 255, 255, 0.12)'}
                        />
                      </div>
                      
                      <button
                        onClick={handleSavePhotoDetails}
                        disabled={isSaving}
                        style={{
                          background: saveSuccess ? 'hsl(var(--success))' : 'hsl(var(--accent-primary))',
                          color: '#000',
                          border: 'none',
                          borderRadius: '6px',
                          height: '38px',
                          padding: '0 16px',
                          fontWeight: '800',
                          fontSize: '0.75rem',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: '6px',
                          transition: 'all 0.2s',
                          whiteSpace: 'nowrap'
                        }}
                      >
                        {saveSuccess ? (
                          <>
                            <CheckCircle2 size={14} />
                            <span>GUARDADO</span>
                          </>
                        ) : (
                          'GUARDAR CAMBIOS'
                        )}
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {/* Right Column: Searchable Table of Budget Items */}
              {showItemsTable && (
                <div style={{
                  flex: '1 1 55%',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '12px',
                  height: '100%',
                  background: 'rgba(255,255,255,0.02)',
                  border: '1px solid rgba(255,255,255,0.08)',
                  borderRadius: '12px',
                  padding: '16px',
                  boxSizing: 'border-box',
                  minWidth: '400px',
                  animation: 'fadeIn 0.2s ease'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '8px' }}>
                    <h4 style={{ margin: 0, color: 'hsl(var(--accent-primary))', fontFamily: 'var(--font-technical)', fontSize: '0.9rem', letterSpacing: '0.5px' }}>
                      SELECCIONAR ÍTEM DEL PRESUPUESTO
                    </h4>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.4)', fontWeight: '600' }}>
                        {onlyItems.length} ÍTEMS
                      </span>
                      {/* El botón colapsar como un punto neón */}
                      <button
                        onClick={() => setShowItemsTable(false)}
                        title="Colapsar tabla"
                        style={{
                          width: '10px',
                          height: '10px',
                          background: 'hsl(var(--primary-neon))',
                          border: 'none',
                          borderRadius: '50%',
                          cursor: 'pointer',
                          padding: '0',
                          boxShadow: '0 0 8px hsl(var(--primary-neon-hsl) / 0.8)',
                          marginLeft: '8px',
                          transition: 'all 0.2s ease'
                        }}
                        onMouseEnter={e => e.currentTarget.style.transform = 'scale(1.3)'}
                        onMouseLeave={e => e.currentTarget.style.transform = 'scale(1)'}
                      />
                    </div>
                  </div>

                  {/* Local Search Input for Budget Items */}
                  <div style={{ position: 'relative' }}>
                    <Search size={12} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'rgba(255,255,255,0.4)' }} />
                    <input
                      type="text"
                      placeholder="Filtrar por código o descripción..."
                      value={itemFilter}
                      onChange={e => setItemFilter(e.target.value)}
                      style={{
                        width: '100%',
                        padding: '8px 12px 8px 30px',
                        borderRadius: '6px',
                        fontSize: '0.8rem',
                        background: 'rgba(0,0,0,0.3)',
                        border: '1px solid rgba(255,255,255,0.1)',
                        color: '#fff',
                        outline: 'none',
                        boxSizing: 'border-box'
                      }}
                    />
                    {itemFilter && (
                      <button
                        onClick={() => setItemFilter('')}
                        style={{
                          position: 'absolute',
                          right: '10px',
                          top: '50%',
                          transform: 'translateY(-50%)',
                          background: 'transparent',
                          border: 'none',
                          color: 'rgba(255,255,255,0.4)',
                          cursor: 'pointer',
                          fontSize: '0.8rem'
                        }}
                      >
                        <X size={12} />
                      </button>
                    )}
                  </div>

                  {/* Table of Items */}
                  <div style={{
                    flex: 1,
                    overflowY: 'auto',
                    border: '1px solid rgba(255,255,255,0.05)',
                    borderRadius: '8px',
                    background: 'rgba(0,0,0,0.2)'
                  }} className="custom-scrollbar">
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.75rem', textAlign: 'left' }}>
                      <thead>
                        <tr style={{ background: 'rgba(255,255,255,0.04)', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                          <th style={{ padding: '8px 12px', width: '80px', color: 'rgba(255,255,255,0.6)', fontWeight: '700' }}>CÓDIGO</th>
                          <th style={{ padding: '8px 12px', color: 'rgba(255,255,255,0.6)', fontWeight: '700' }}>DESCRIPCIÓN</th>
                          <th style={{ padding: '8px 12px', width: '50px', color: 'rgba(255,255,255,0.6)', fontWeight: '700' }}>UNID</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredItems.map(item => {
                          const isSelected = item.item === editingItemCode;
                          return (
                            <tr
                              key={item.item}
                              onClick={() => {
                                setEditingItemCode(item.item);
                                setSaveSuccess(false);
                              }}
                              style={{
                                borderBottom: '1px solid rgba(255,255,255,0.03)',
                                cursor: 'pointer',
                                background: isSelected ? 'hsla(var(--accent-primary), 0.12)' : 'transparent',
                                color: isSelected ? 'hsl(var(--accent-primary))' : 'rgba(255,255,255,0.8)',
                                fontWeight: isSelected ? 'bold' : 'normal',
                                transition: 'all 0.15s ease'
                              }}
                              className="item-row"
                            >
                              <td style={{ padding: '8px 12px', fontFamily: 'var(--font-technical)' }}>{item.item}</td>
                              <td style={{ padding: '8px 12px', lineHeight: '1.3' }}>{item.descripcion}</td>
                              <td style={{ padding: '8px 12px', opacity: 0.6 }}>{item.unidad}</td>
                            </tr>
                          );
                        })}
                        {filteredItems.length === 0 && (
                          <tr>
                            <td colSpan={3} style={{ padding: '20px', textAlign: 'center', color: 'rgba(255,255,255,0.4)', fontStyle: 'italic' }}>
                              No se encontraron ítems coincidentes.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>

            <button className="lightbox-nav next" onClick={handleNext} disabled={selectedIdx === filteredPhotos.length - 1} style={{ position: 'absolute', right: '20px', zIndex: 10 }}>
              <ChevronRight size={32} />
            </button>
          </div>
        </div>,
        document.body
      )}

      {showBulkAssignModal && createPortal(
        <div className="lightbox-overlay" onClick={() => setShowBulkAssignModal(false)}>
          <div className="lightbox-content" onClick={e => e.stopPropagation()} style={{
            width: '100%',
            maxWidth: '650px',
            height: '75vh',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '0 20px',
            boxSizing: 'border-box'
          }}>
            
            {/* Close Button */}
            <button 
              onClick={() => setShowBulkAssignModal(false)}
              style={{
                position: 'absolute',
                top: '25px',
                right: '25px',
                background: 'rgba(255,255,255,0.1)',
                border: 'none',
                color: 'white',
                padding: '10px',
                borderRadius: '50%',
                cursor: 'pointer',
                zIndex: 10100,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'background 0.2s'
              }}
              onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.2)'}
              onMouseLeave={e => e.currentTarget.style.background = 'rgba(255,255,255,0.1)'}
            >
              <X size={24} />
            </button>

            {/* Modal Body */}
            <div style={{
              width: '100%',
              display: 'flex',
              flexDirection: 'column',
              gap: '12px',
              height: '100%',
              background: 'rgba(30,30,30,0.85)',
              backdropFilter: 'blur(20px)',
              border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: '16px',
              padding: '20px',
              boxSizing: 'border-box',
              animation: 'fadeIn 0.2s ease'
            }}>
              <div style={{ borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: '12px' }}>
                <h3 style={{ margin: 0, color: 'hsl(var(--accent-primary))', fontFamily: 'var(--font-technical)', fontSize: '1.05rem', letterSpacing: '0.5px', textTransform: 'uppercase' }}>
                  ASIGNAR ÍTEM A {selectedIds.length} FOTOS
                </h3>
                <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: '0.7rem', margin: '4px 0 0 0', fontWeight: '600' }}>
                  SELECCIONE EL ÍTEM DEL PRESUPUESTO QUE SE APLICARÁ EN LOTE
                </p>
              </div>

              {/* Local Search Input for Budget Items */}
              <div style={{ position: 'relative' }}>
                <Search size={14} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'rgba(255,255,255,0.4)' }} />
                <input
                  type="text"
                  placeholder="Filtrar por código o descripción..."
                  value={bulkItemFilter}
                  onChange={e => setBulkItemFilter(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '10px 12px 10px 36px',
                    borderRadius: '8px',
                    fontSize: '0.85rem',
                    background: 'rgba(0,0,0,0.3)',
                    border: '1px solid rgba(255,255,255,0.1)',
                    color: '#fff',
                    outline: 'none',
                    boxSizing: 'border-box'
                  }}
                  onFocus={e => e.target.style.borderColor = 'hsl(var(--accent-primary))'}
                  onBlur={e => e.target.style.borderColor = 'rgba(255,255,255,0.1)'}
                />
                {bulkItemFilter && (
                  <button
                    onClick={() => setBulkItemFilter('')}
                    style={{
                      position: 'absolute',
                      right: '12px',
                      top: '50%',
                      transform: 'translateY(-50%)',
                      background: 'transparent',
                      border: 'none',
                      color: 'rgba(255,255,255,0.4)',
                      cursor: 'pointer'
                    }}
                  >
                    <X size={14} />
                  </button>
                )}
              </div>

              {/* Table of Items */}
              <div style={{
                flex: 1,
                overflowY: 'auto',
                border: '1px solid rgba(255,255,255,0.05)',
                borderRadius: '8px',
                background: 'rgba(0,0,0,0.2)'
              }} className="custom-scrollbar">
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem', textAlign: 'left' }}>
                  <thead>
                    <tr style={{ background: 'rgba(255,255,255,0.04)', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                      <th style={{ padding: '10px 12px', width: '80px', color: 'rgba(255,255,255,0.6)', fontWeight: '700' }}>CÓDIGO</th>
                      <th style={{ padding: '10px 12px', color: 'rgba(255,255,255,0.6)', fontWeight: '700' }}>DESCRIPCIÓN</th>
                      <th style={{ padding: '10px 12px', width: '50px', color: 'rgba(255,255,255,0.6)', fontWeight: '700' }}>UNID</th>
                    </tr>
                  </thead>
                  <tbody>
                    {onlyItems
                      .filter(item =>
                        (item.item || '').toLowerCase().includes(bulkItemFilter.toLowerCase()) ||
                        (item.descripcion || '').toLowerCase().includes(bulkItemFilter.toLowerCase())
                      )
                      .map(item => (
                        <tr
                          key={item.item}
                          onClick={() => {
                            updateLogiEntries(project.id, selectedIds, { itemCode: item.item, status: 'integrated' });
                            const count = selectedIds.length;
                            setSelectedIds([]);
                            setShowBulkAssignModal(false);
                            
                            // Visual Flash Confirmation Toast
                            const flash = document.createElement('div');
                            flash.innerText = `✓ Asignado ítem ${item.item} a ${count} evidencias`;
                            flash.style.position = 'fixed';
                            flash.style.bottom = '40px';
                            flash.style.right = '40px';
                            flash.style.background = 'hsl(var(--success))';
                            flash.style.color = '#fff';
                            flash.style.padding = '12px 24px';
                            flash.style.borderRadius = '12px';
                            flash.style.fontWeight = '800';
                            flash.style.zIndex = '10000';
                            document.body.appendChild(flash);
                            setTimeout(() => flash.remove(), 3000);
                          }}
                          style={{
                            borderBottom: '1px solid rgba(255,255,255,0.03)',
                            cursor: 'pointer',
                            color: 'rgba(255,255,255,0.8)',
                            transition: 'all 0.15s ease'
                          }}
                          className="item-row"
                        >
                          <td style={{ padding: '10px 12px', fontFamily: 'var(--font-technical)', fontWeight: 'bold' }}>{item.item}</td>
                          <td style={{ padding: '10px 12px', lineHeight: '1.4' }}>{item.descripcion}</td>
                          <td style={{ padding: '10px 12px', opacity: 0.6 }}>{item.unidad}</td>
                        </tr>
                      ))}
                    {onlyItems.filter(item =>
                      (item.item || '').toLowerCase().includes(bulkItemFilter.toLowerCase()) ||
                      (item.descripcion || '').toLowerCase().includes(bulkItemFilter.toLowerCase())
                    ).length === 0 && (
                      <tr>
                        <td colSpan={3} style={{ padding: '20px', textAlign: 'center', color: 'rgba(255,255,255,0.4)', fontStyle: 'italic' }}>
                          No se encontraron ítems coincidentes.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '12px' }}>
                <button
                  onClick={() => setShowBulkAssignModal(false)}
                  style={{
                    background: 'rgba(255,255,255,0.05)',
                    color: '#fff',
                    border: 'none',
                    borderRadius: '6px',
                    padding: '8px 16px',
                    fontWeight: '700',
                    fontSize: '0.75rem',
                    cursor: 'pointer',
                    transition: 'all 0.2s'
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.1)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}
                >
                  CANCELAR
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}

      <style>{`
        .animate-in { animation: slideUp 0.4s cubic-bezier(0.16, 1, 0.3, 1) both; }
        @keyframes slideUp { from { opacity: 0; transform: translateY(15px); } to { opacity: 1; transform: translateY(0); } }

        .grid-btn {
          width: 32px; height: 32px; border-radius: 8px; border: none; background: transparent;
          color: hsl(var(--text-muted)); display: flex; align-items: center; justify-content: center;
          cursor: pointer; transition: all 0.2s;
        }
        .grid-btn:hover { background: hsl(var(--bg-tertiary)); color: hsl(var(--text-primary)); }
        .grid-btn.active { background: hsl(var(--accent-primary)); color: white; }

        .photo-card:hover { transform: translateY(-4px); border-color: hsl(var(--accent-primary) / 0.5) !important; }
        .photo-card:hover .photo-img { transform: scale(1.05); }
        .photo-img { transition: transform 0.5s ease; }
        
        .photo-desc { 
          max-height: 2.6em;
          overflow: hidden; 
          display: -webkit-box; 
          -webkit-line-clamp: 2; 
          -webkit-box-orient: vertical; 
          transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1); 
        }
        .photo-desc:hover { 
          max-height: 200px;
          -webkit-line-clamp: initial; 
        }

        .delete-btn { opacity: 0; transform: scale(0.8); transition: all 0.2s; }
        .photo-card:hover .delete-btn { opacity: 1; transform: scale(1); }
        .photo-card:hover .selection-overlay { opacity: 1 !important; }
        .selection-overlay:hover { transform: scale(1.1); }
        .selection-overlay.active { opacity: 1 !important; }

        .lightbox-overlay {
          position: fixed; inset: 0; background: rgba(0,0,0,0.92); z-index: 9999;
          display: flex; align-items: center; justify-content: center; backdrop-filter: blur(8px);
          animation: fadeIn 0.3s ease;
        }
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }

        .lightbox-content {
          position: relative; width: 90vw; height: 90vh; display: flex; align-items: center; justify-content: center;
        }
        .lightbox-image-container {
          max-width: 80%; max-height: 80%; position: relative; display: flex; flex-direction: column; align-items: center;
        }
        .lightbox-img { 
          max-width: 100%; max-height: 70vh; border-radius: 12px; box-shadow: 0 20px 50px rgba(0,0,0,0.5);
          animation: zoomIn 0.3s cubic-bezier(0.16, 1, 0.3, 1);
        }
        @keyframes zoomIn { from { transform: scale(0.9); opacity: 0; } to { transform: scale(1); opacity: 1; } }

        .lightbox-info {
          width: 100%; margin-top: 20px; color: white; text-align: left; background: rgba(255,255,255,0.05);
          padding: 20px; border-radius: 16px; border: 1px solid rgba(255,255,255,0.1);
        }

        .lightbox-close {
          position: absolute; top: 20px; right: 20px; background: rgba(255,255,255,0.1); border: none;
          color: white; padding: 10px; border-radius: 50%; cursor: pointer; transition: background 0.2s;
        }
        .lightbox-close:hover { background: rgba(255,255,255,0.2); }

        .lightbox-nav {
          background: rgba(255,255,255,0.1); border: none; color: white; padding: 20px;
          border-radius: 50%; cursor: pointer; transition: all 0.2s;
        }
        .lightbox-nav:hover:not(:disabled) { background: rgba(255,255,255,0.15); transform: scale(1.1); }
        .lightbox-nav:disabled { opacity: 0.2; cursor: default; }

        .item-row:hover {
          background: rgba(255, 255, 255, 0.05) !important;
        }
      `}</style>
    </div>
  );
}
