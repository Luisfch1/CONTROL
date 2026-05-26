import { useState, useRef } from 'react';
import { 
  Folder, Trash2, Plus, FileText, ArrowLeft, Download, 
  Clock, CheckCircle, AlertCircle, X, Save, Edit, Eye, User, FileDigit, Calendar
} from 'lucide-react';
import { useProjects } from '../context/ProjectsContext';
import { analyzeCorrespondencePdf } from '../services/aiService';
import { correspondenceDB } from '../services/CorrespondenceDatabase';
import type { CorrespondenceFile, CorrespondenceFolder } from '../types/projectTypes';

export default function CorrespondenceView() {
  const { getActiveProject, updateProject } = useProjects();
  const project = getActiveProject();

  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<CorrespondenceFile | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [viewingPdfUrl, setViewingPdfUrl] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!project) {
    return (
      <div className="flex-center" style={{ height: '70vh', color: 'hsl(var(--text-muted))', flexDirection: 'column', gap: 'var(--spacing-md)' }}>
        <Folder size={48} style={{ opacity: 0.2 }} />
        <p className="font-medium">Seleccione un proyecto para gestionar su correspondencia.</p>
      </div>
    );
  }

  const folders = project.correspondenceFolders || [];
  const files = project.correspondenceFiles || [];

  // Filter folders and files in current directory
  const currentFolders = folders.filter(f => f.parentId === currentFolderId);
  const currentFiles = files.filter(f => f.folderId === (currentFolderId || 'root'));

  // Breadcrumbs
  const getBreadcrumbs = () => {
    const crumbs: CorrespondenceFolder[] = [];
    let currentId = currentFolderId;
    while (currentId) {
      const folder = folders.find(f => f.id === currentId);
      if (folder) {
        crumbs.unshift(folder);
        currentId = folder.parentId;
      } else {
        break;
      }
    }
    return crumbs;
  };

  const saveProjectPhysically = (foldersList: CorrespondenceFolder[], filesList: CorrespondenceFile[]) => {
    if ((window as any).electronAPI && typeof (window as any).electronAPI.saveProject === 'function') {
      const updatedProject = { 
        ...project, 
        correspondenceFolders: foldersList, 
        correspondenceFiles: filesList 
      };
      (window as any).electronAPI.saveProject(updatedProject)
        .then(() => console.log("[Correspondence] Guardado físico automático exitoso."))
        .catch((err: any) => console.error("Error al guardar físicamente:", err));
    }
  };

  const handleCreateFolder = () => {
    const name = prompt('Ingrese el nombre de la nueva carpeta:');
    if (!name || name.trim() === '') return;

    const newFolder: CorrespondenceFolder = {
      id: 'folder-' + Date.now(),
      name: name.trim(),
      parentId: currentFolderId
    };

    const updatedFolders = [...folders, newFolder];
    updateProject(project.id, { correspondenceFolders: updatedFolders });
    saveProjectPhysically(updatedFolders, files);
  };

  const handleDeleteFolder = async (folderId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm('⚠️ ¿Está seguro de que desea eliminar esta carpeta y todo su contenido?')) {
      const getSubfolderIds = (id: string): string[] => {
        const subs = folders.filter(f => f.parentId === id);
        return [id, ...subs.flatMap(s => getSubfolderIds(s.id))];
      };

      const idsToRemove = getSubfolderIds(folderId);
      const updatedFolders = folders.filter(f => !idsToRemove.includes(f.id));
      const updatedFiles = files.filter(f => !idsToRemove.includes(f.folderId));

      // Eliminar archivos asociados en IndexedDB
      const filesToRemove = files.filter(f => idsToRemove.includes(f.folderId));
      for (const f of filesToRemove) {
        try {
          await correspondenceDB.deleteFile(f.id);
        } catch (err) {
          console.error("Error deleting file from IndexedDB:", err);
        }
      }

      updateProject(project.id, { 
        correspondenceFolders: updatedFolders, 
        correspondenceFiles: updatedFiles 
      });
      saveProjectPhysically(updatedFolders, updatedFiles);

      if (selectedFile && idsToRemove.includes(selectedFile.folderId)) {
        setSelectedFile(null);
      }
    }
  };

  const handleFileUploadClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.type !== 'application/pdf') {
      alert("❌ Solo se permiten archivos PDF de correspondencia.");
      return;
    }

    setIsAnalyzing(true);
    setAnalysisError(null);

    const reader = new FileReader();
    reader.onloadend = async () => {
      try {
        const base64String = (reader.result as string).split(',')[1];
        
        // Call Gemini analysis directly
        const metadata = await analyzeCorrespondencePdf(
          base64String, 
          file.name, 
          project.geminiApiKey
        );

        const fileId = 'corr-file-' + Date.now();
        const base64Data = reader.result as string;

        // Guardar archivo PDF en IndexedDB localmente para evitar saturar localStorage
        try {
          await correspondenceDB.saveFile(fileId, project.id, base64Data);
        } catch (dbErr) {
          console.error("Error al guardar PDF en IndexedDB:", dbErr);
        }

        const newFile: CorrespondenceFile = {
          id: fileId,
          name: file.name,
          uploadDate: new Date().toISOString(),
          fileData: base64Data, // save base64 (se limpia al persistir en localStorage pero permanece en memoria y archivo físico)
          folderId: currentFolderId || 'root',
          metadata: {
            date: metadata.date,
            sender: metadata.sender,
            receiver: metadata.receiver,
            subject: metadata.subject,
            summary: metadata.summary,
            status: metadata.status || 'pending',
            followUpDeadline: metadata.followUpDeadline
          }
        };

        const updatedFiles = [...files, newFile];
        updateProject(project.id, { correspondenceFiles: updatedFiles });
        saveProjectPhysically(folders, updatedFiles);
        setSelectedFile(newFile);
      } catch (err: any) {
        console.error("Error al procesar correspondencia con Gemini:", err);
        setAnalysisError(err.message || "Error analizando el PDF.");
      } finally {
        setIsAnalyzing(false);
        if (fileInputRef.current) fileInputRef.current.value = '';
      }
    };

    reader.onerror = () => {
      setIsAnalyzing(false);
      alert("Error al leer el archivo físico.");
    };

    reader.readAsDataURL(file);
  };

  const handleDeleteFile = async (fileId: string) => {
    if (confirm('¿Está seguro de que desea eliminar este oficio permanentemente?')) {
      try {
        await correspondenceDB.deleteFile(fileId);
      } catch (dbErr) {
        console.error("Error al borrar PDF de IndexedDB:", dbErr);
      }
      const updatedFiles = files.filter(f => f.id !== fileId);
      updateProject(project.id, { correspondenceFiles: updatedFiles });
      saveProjectPhysically(folders, updatedFiles);
      setSelectedFile(null);
    }
  };

  const handleUpdateMetadata = (updates: Partial<NonNullable<CorrespondenceFile['metadata']>>) => {
    if (!selectedFile) return;

    const updatedFiles = files.map(f => {
      if (f.id === selectedFile.id) {
        return {
          ...f,
          metadata: {
            ...f.metadata,
            status: f.metadata?.status || 'pending',
            ...updates
          }
        };
      }
      return f;
    });

    updateProject(project.id, { correspondenceFiles: updatedFiles });
    saveProjectPhysically(folders, updatedFiles);

    // Update selected view
    const nextSelected = updatedFiles.find(f => f.id === selectedFile.id);
    if (nextSelected) {
      setSelectedFile(nextSelected);
    }
  };

  const handleUpdateFileName = (newName: string) => {
    if (!selectedFile) return;

    const updatedFiles = files.map(f => {
      if (f.id === selectedFile.id) {
        return {
          ...f,
          name: newName
        };
      }
      return f;
    });

    updateProject(project.id, { correspondenceFiles: updatedFiles });
    saveProjectPhysically(folders, updatedFiles);

    const nextSelected = updatedFiles.find(f => f.id === selectedFile.id);
    if (nextSelected) {
      setSelectedFile(nextSelected);
    }
  };

  const handleViewPdf = async (file: CorrespondenceFile, e?: React.MouseEvent) => {
    e?.stopPropagation();
    let data = file.fileData;
    if (!data) {
      try {
        data = await correspondenceDB.getFile(file.id) || undefined;
      } catch (dbErr) {
        console.error("Error al cargar PDF desde IndexedDB:", dbErr);
      }
    }
    if (!data) {
      alert("No hay datos físicos asociados a este archivo para visualizar.");
      return;
    }
    // Construct a blob URL from base64 to load in iframe
    const base64Content = data.startsWith('data:') ? data.split(',')[1] : data;
    const byteCharacters = atob(base64Content);
    const byteNumbers = new Array(byteCharacters.length);
    for (let i = 0; i < byteCharacters.length; i++) {
      byteNumbers[i] = byteCharacters.charCodeAt(i);
    }
    const byteArray = new Uint8Array(byteNumbers);
    const blob = new Blob([byteArray], { type: 'application/pdf' });
    const blobUrl = URL.createObjectURL(blob);
    setViewingPdfUrl(blobUrl);
  };

  const handleClosePdfViewer = () => {
    if (viewingPdfUrl) {
      URL.revokeObjectURL(viewingPdfUrl);
      setViewingPdfUrl(null);
    }
  };

  const handleDownloadPdf = async (file: CorrespondenceFile) => {
    let data = file.fileData;
    if (!data) {
      try {
        data = await correspondenceDB.getFile(file.id) || undefined;
      } catch (dbErr) {
        console.error("Error al cargar PDF desde IndexedDB:", dbErr);
      }
    }

    if (!data) {
      alert("No hay datos físicos asociados a este archivo.");
      return;
    }
    const link = document.createElement("a");
    link.href = data;
    link.download = file.name;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const getStatusLabel = (status?: string) => {
    switch (status) {
      case 'pending': return 'Pendiente';
      case 'answered': return 'Respondido';
      case 'no_action_needed': return 'Informativo';
      default: return 'Pendiente';
    }
  };

  const getStatusColor = (status?: string) => {
    switch (status) {
      case 'pending': return '#f97316'; // Orange warning
      case 'answered': return '#00ff88'; // Clean Green
      case 'no_action_needed': return '#94a3b8'; // Cool slate/gray
      default: return '#f97316';
    }
  };

  const getStatusBg = (status?: string) => {
    switch (status) {
      case 'pending': return 'rgba(249, 115, 22, 0.15)';
      case 'answered': return 'rgba(0, 255, 136, 0.1)';
      case 'no_action_needed': return 'rgba(148, 163, 184, 0.1)';
      default: return 'rgba(249, 115, 22, 0.15)';
    }
  };

  const getFilesCountInFolder = (folderId: string): number => {
    const getFolderAndSubfolderIds = (id: string): string[] => {
      const subs = folders.filter(f => f.parentId === id);
      return [id, ...subs.flatMap(s => getFolderAndSubfolderIds(s.id))];
    };
    const allFolderIds = getFolderAndSubfolderIds(folderId);
    return files.filter(f => allFolderIds.includes(f.folderId)).length;
  };

  return (
    <div className="dashboard-container animate-in" style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
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
            borderBottom: '1px solid hsla(var(--border-color-hsl), 0.3)',
            background: 'hsla(var(--bg-secondary-hsl), 0.8)',
            flexShrink: 0
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <Eye size={18} style={{ color: 'hsl(var(--accent-primary))' }} />
              <h3 style={{ margin: 0, fontSize: '0.85rem', fontFamily: 'var(--font-technical)', fontWeight: 'bold', color: 'hsl(var(--text-primary))' }}>
                {selectedFile?.name || 'VISUALIZADOR DE OFICIO'}
              </h3>
            </div>
            <button
              onClick={handleClosePdfViewer}
              style={{
                background: 'hsla(var(--danger-hsl), 0.15)',
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
            title="Visualizador de Oficio"
            style={{ flex: 1, border: 'none', width: '100%' }}
          />
        </div>
      )}

      {/* Spinner Loader overlay */}
      {isAnalyzing && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0, 0, 0, 0.8)', backdropFilter: 'blur(8px)',
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          zIndex: 99999, gap: '20px'
        }}>
          <div className="agent-status-bot-icon" style={{
            background: 'hsla(var(--primary-neon-hsl), 0.1)',
            padding: '24px', borderRadius: '50%',
            border: '2px solid hsl(var(--primary-neon))',
            animation: 'pulse-ring 1.5s infinite',
            display: 'flex', alignItems: 'center', justifyContent: 'center'
          }}>
            <FileText size={48} style={{ color: 'hsl(var(--primary-neon))' }} />
          </div>
          <div style={{ textAlign: 'center' }}>
            <h3 style={{ margin: 0, fontSize: '1.2rem', color: 'hsl(var(--text-primary))', fontFamily: 'var(--font-technical)', fontWeight: 'bold' }}>
              CONTROL IA analizando oficio...
            </h3>
            <p style={{ margin: '8px 0 0 0', fontSize: '0.8rem', color: 'hsl(var(--text-muted))' }}>
              Extrayendo remitente, destinatario, asunto, resumen y fechas estimadas con Gemini.
            </p>
          </div>
        </div>
      )}

      {/* Main header block */}
      <div className="page-header" style={{ flexShrink: 0 }}>
        <div>
          <h2 className="page-title">Correspondencia y Oficios</h2>
          <p style={{ color: 'hsl(var(--text-muted))', fontSize: '0.7rem', fontWeight: '600', margin: '4px 0 0 0', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
            ADMINISTRACIÓN DE COMUNICACIONES TÉCNICAS
          </p>
        </div>

        <div style={{ display: 'flex', gap: '10px' }}>
          <button 
            className="btn btn-secondary" 
            onClick={handleCreateFolder}
            style={{ 
              fontWeight: '700', 
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              height: '38px',
              fontSize: '0.75rem'
            }}
          >
            <Plus size={14} /> CARPETA
          </button>
          
          <button 
            className="btn btn-primary" 
            onClick={handleFileUploadClick}
            style={{ 
              fontWeight: '700', 
              background: 'hsl(var(--accent-primary))', 
              color: '#000',
              border: 'none',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              height: '38px',
              fontSize: '0.75rem'
            }}
          >
            <Plus size={14} /> SUBIR OFICIO (PDF)
          </button>
          
          <input 
            type="file" 
            ref={fileInputRef} 
            onChange={handleFileChange} 
            accept="application/pdf" 
            style={{ display: 'none' }} 
          />
        </div>
      </div>

      {analysisError && (
        <div style={{
          margin: '0 24px 12px 24px', padding: '12px 16px',
          background: 'rgba(239, 68, 68, 0.1)', border: '1px solid #ef4444',
          borderRadius: '8px', color: '#f87171', fontSize: '0.8rem',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between'
        }}>
          <span><strong>Error:</strong> {analysisError}</span>
          <button onClick={() => setAnalysisError(null)} style={{ background: 'transparent', border: 'none', color: 'inherit', cursor: 'pointer' }}><X size={16} /></button>
        </div>
      )}

      {/* Main split view container */}
      <div style={{ display: 'flex', flex: 1, minHeight: 0, padding: '0 24px 24px 24px', gap: '20px' }}>
        
        {/* Left Side: Navigation tree and items */}
        <div style={{ 
          flex: selectedFile ? 1.2 : 1, 
          display: 'flex', 
          flexDirection: 'column', 
          background: 'hsla(var(--bg-secondary-hsl), 0.25)', 
          backdropFilter: 'blur(10px)',
          border: '1px solid hsla(var(--border-color-hsl), 0.3)',
          borderRadius: '12px',
          overflow: 'hidden'
        }}>
          
          {/* Breadcrumbs header */}
          <div style={{ 
            padding: '12px 16px', 
            borderBottom: '1px solid hsla(var(--border-color-hsl), 0.3)',
            background: 'hsla(var(--bg-tertiary-hsl), 0.3)',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            fontSize: '0.8rem'
          }}>
            <span 
              onClick={() => { setCurrentFolderId(null); setSelectedFile(null); }}
              style={{ cursor: 'pointer', color: currentFolderId ? 'hsl(var(--accent-primary))' : 'hsl(var(--text-primary))', fontWeight: !currentFolderId ? 'bold' : 'normal' }}
            >
              Raíz
            </span>

            {getBreadcrumbs().map((crumb) => (
              <span key={crumb.id} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ opacity: 0.3 }}>/</span>
                <span 
                  onClick={() => { setCurrentFolderId(crumb.id); setSelectedFile(null); }}
                  style={{ cursor: 'pointer', color: crumb.id === currentFolderId ? 'hsl(var(--text-primary))' : 'hsl(var(--accent-primary))', fontWeight: crumb.id === currentFolderId ? 'bold' : 'normal' }}
                >
                  {crumb.name}
                </span>
              </span>
            ))}

            {currentFolderId && (
              <button 
                onClick={() => {
                  const current = folders.find(f => f.id === currentFolderId);
                  if (current) setCurrentFolderId(current.parentId);
                }}
                style={{
                  marginLeft: 'auto', background: 'transparent', border: 'none',
                  color: 'hsl(var(--accent-primary))', cursor: 'pointer', display: 'flex',
                  alignItems: 'center', gap: '4px', fontSize: '0.75rem', fontWeight: 'bold'
                }}
              >
                <ArrowLeft size={12} /> Atras
              </button>
            )}
          </div>

          {/* Directory Content List */}
          <div className="custom-scrollbar" style={{ flex: 1, overflowY: 'auto', padding: '16px' }}>
            
            {currentFolders.length === 0 && currentFiles.length === 0 ? (
              <div className="flex-center" style={{ height: '30vh', flexDirection: 'column', gap: '12px', color: 'hsl(var(--text-muted))' }}>
                <Folder size={32} style={{ opacity: 0.2 }} />
                <span style={{ fontSize: '0.75rem' }}>Esta carpeta está vacía.</span>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                
                {/* Folders grid if any */}
                {currentFolders.map(folder => (
                  <div
                    key={folder.id}
                    onClick={() => setCurrentFolderId(folder.id)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      padding: '10px 14px',
                      background: 'hsla(var(--bg-secondary-hsl), 0.4)',
                      border: '1px solid hsla(var(--border-color-hsl), 0.3)',
                      borderRadius: '8px',
                      cursor: 'pointer',
                      transition: 'all 0.2s ease',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.borderColor = 'hsl(var(--accent-primary))';
                      e.currentTarget.style.background = 'hsla(var(--bg-secondary-hsl), 0.6)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.borderColor = 'hsla(var(--border-color-hsl), 0.3)';
                      e.currentTarget.style.background = 'hsla(var(--bg-secondary-hsl), 0.4)';
                    }}
                  >
                    <Folder size={18} style={{ color: 'hsl(var(--accent-primary))', marginRight: '12px' }} />
                    <div style={{ flex: 1 }}>
                      <span style={{ fontSize: '0.8rem', fontWeight: 'bold', color: 'hsl(var(--text-primary))' }}>
                        {folder.name}
                      </span>
                      <span style={{ fontSize: '0.65rem', color: 'hsl(var(--text-muted))', marginLeft: '12px' }}>
                        ({getFilesCountInFolder(folder.id)} oficios)
                      </span>
                    </div>
                    <button
                      onClick={(e) => handleDeleteFolder(folder.id, e)}
                      style={{
                        background: 'transparent', border: 'none', color: 'hsl(var(--danger))',
                        opacity: 0.5, transition: 'opacity 0.2s', padding: '4px', cursor: 'pointer'
                      }}
                      onMouseEnter={(e) => e.currentTarget.style.opacity = '1'}
                      onMouseLeave={(e) => e.currentTarget.style.opacity = '0.5'}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}

                {/* Files list if any */}
                {currentFiles.map(file => {
                  const isSelected = selectedFile?.id === file.id;
                  const status = file.metadata?.status || 'pending';
                  
                  return (
                    <div
                      key={file.id}
                      onClick={() => setSelectedFile(file)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        padding: '10px 14px',
                        background: isSelected ? 'hsla(var(--accent-primary-hsl), 0.05)' : 'hsla(var(--bg-secondary-hsl), 0.2)',
                        border: isSelected ? '1px solid hsl(var(--accent-primary))' : '1px solid hsla(var(--border-color-hsl), 0.2)',
                        borderRadius: '8px',
                        cursor: 'pointer',
                        transition: 'all 0.2s ease',
                      }}
                      onMouseEnter={(e) => {
                        if (!isSelected) {
                          e.currentTarget.style.borderColor = 'hsla(var(--border-color-hsl), 0.5)';
                          e.currentTarget.style.background = 'hsla(var(--bg-secondary-hsl), 0.35)';
                        }
                      }}
                      onMouseLeave={(e) => {
                        if (!isSelected) {
                          e.currentTarget.style.borderColor = 'hsla(var(--border-color-hsl), 0.2)';
                          e.currentTarget.style.background = 'hsla(var(--bg-secondary-hsl), 0.2)';
                        }
                      }}
                    >
                      <FileText size={18} style={{ color: 'hsl(var(--text-secondary))', marginRight: '12px' }} />
                      <div style={{ flex: 1, minWidth: 0, marginRight: '12px' }}>
                        <div style={{ fontSize: '0.8rem', fontWeight: '600', color: 'hsl(var(--text-primary))', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {file.name}
                        </div>
                        <div style={{ fontSize: '0.65rem', color: 'hsl(var(--text-muted))', marginTop: '2px', display: 'flex', flexWrap: 'wrap', gap: '12px' }}>
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '200px' }}><strong>Asunto:</strong> {file.metadata?.subject || 'Sin Asunto'}</span>
                          <span><strong>De:</strong> {file.metadata?.sender || 'Desconocido'}</span>
                          <span><strong>Fecha:</strong> {file.metadata?.date || file.uploadDate.split('T')[0]}</span>
                        </div>
                      </div>
                      
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{
                          fontSize: '0.65rem',
                          fontWeight: 'bold',
                          padding: '2px 8px',
                          borderRadius: '10px',
                          background: getStatusBg(status),
                          color: getStatusColor(status),
                          border: `1px solid ${getStatusColor(status)}30`
                        }}>
                          {getStatusLabel(status)}
                        </span>
                        <button
                          title="Visualizar PDF"
                          onClick={(e) => handleViewPdf(file, e)}
                          style={{
                            background: 'hsla(var(--accent-primary-hsl), 0.1)',
                            border: '1px solid hsla(var(--accent-primary-hsl), 0.3)',
                            borderRadius: '6px',
                            color: 'hsl(var(--accent-primary))',
                            cursor: 'pointer',
                            padding: '4px 6px',
                            display: 'flex', alignItems: 'center',
                            transition: 'all 0.2s ease'
                          }}
                          onMouseEnter={(e) => { e.currentTarget.style.background = 'hsla(var(--accent-primary-hsl), 0.25)'; }}
                          onMouseLeave={(e) => { e.currentTarget.style.background = 'hsla(var(--accent-primary-hsl), 0.1)'; }}
                        >
                          <Eye size={13} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Right Side: Metadata / Action Panel */}
        {selectedFile && (
          <div style={{ 
            flex: 0.8, 
            display: 'flex', 
            flexDirection: 'column', 
            background: 'hsla(var(--bg-secondary-hsl), 0.4)', 
            backdropFilter: 'blur(10px)',
            border: '1px solid hsla(var(--border-color-hsl), 0.4)',
            borderRadius: '12px',
            overflow: 'hidden',
            animation: 'slideRight 0.25s cubic-bezier(0.16, 1, 0.3, 1)'
          }}>
            
            {/* Panel Title */}
            <div style={{ 
              padding: '14px 20px', 
              borderBottom: '1px solid hsla(var(--border-color-hsl), 0.3)',
              background: 'hsla(var(--bg-tertiary-hsl), 0.5)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <FileDigit size={18} style={{ color: 'hsl(var(--accent-primary))' }} />
                <h3 style={{ margin: 0, fontSize: '0.85rem', color: 'hsl(var(--text-primary))', fontFamily: 'var(--font-technical)', fontWeight: 'bold' }}>
                  DETALLES DEL OFICIO
                </h3>
              </div>
              <button 
                onClick={() => setSelectedFile(null)}
                style={{ background: 'transparent', border: 'none', color: 'hsl(var(--text-secondary))', cursor: 'pointer', display: 'flex', alignItems: 'center' }}
              >
                <X size={16} />
              </button>
            </div>

            {/* Metadata Fields Form */}
            <div className="custom-scrollbar" style={{ flex: 1, overflowY: 'auto', padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
              
              <div>
                <label style={{ fontSize: '0.6rem', color: 'hsl(var(--text-muted))', display: 'block', textTransform: 'uppercase', marginBottom: '4px' }}>Nombre del Oficio (Editable)</label>
                <input
                  type="text"
                  value={selectedFile.name}
                  onChange={(e) => handleUpdateFileName(e.target.value)}
                  style={{
                    width: '100%',
                    background: 'hsla(var(--bg-tertiary-hsl), 0.3)',
                    border: '1px solid hsla(var(--border-color-hsl), 0.3)',
                    borderRadius: '6px',
                    color: 'hsl(var(--text-primary))',
                    padding: '6px 8px',
                    fontSize: '0.75rem',
                    outline: 'none',
                    fontWeight: 'bold'
                  }}
                />
                <span style={{ fontSize: '0.6rem', color: 'hsl(var(--text-muted))', display: 'block', marginTop: '4px' }}>Cargado el: {new Date(selectedFile.uploadDate).toLocaleString()}</span>
              </div>

              <div style={{ height: '1px', background: 'hsla(var(--border-color-hsl), 0.2)' }}></div>

              {/* Status Selector */}
              <div>
                <label style={{ fontSize: '0.6rem', color: 'hsl(var(--text-muted))', display: 'block', textTransform: 'uppercase', marginBottom: '6px' }}>Estado de Seguimiento</label>
                <div style={{ display: 'flex', gap: '6px' }}>
                  {(['pending', 'answered', 'no_action_needed'] as const).map(st => {
                    const active = (selectedFile.metadata?.status || 'pending') === st;
                    return (
                      <button
                        key={st}
                        onClick={() => handleUpdateMetadata({ status: st })}
                        style={{
                          flex: 1,
                          padding: '6px 4px',
                          fontSize: '0.7rem',
                          fontWeight: 'bold',
                          borderRadius: '6px',
                          border: active ? `1px solid ${getStatusColor(st)}` : '1px solid hsla(var(--border-color-hsl), 0.3)',
                          background: active ? getStatusBg(st) : 'transparent',
                          color: active ? getStatusColor(st) : 'hsl(var(--text-muted))',
                          cursor: 'pointer',
                          transition: 'all 0.2s ease'
                        }}
                      >
                        {getStatusLabel(st)}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Editable note field */}
              <div>
                <label style={{ fontSize: '0.6rem', color: 'hsl(var(--text-muted))', display: 'block', textTransform: 'uppercase', marginBottom: '4px' }}>Notas / Bitácora de Acciones</label>
                <textarea
                  value={selectedFile.metadata?.notes || ''}
                  onChange={(e) => handleUpdateMetadata({ notes: e.target.value })}
                  placeholder="Escriba aquí el seguimiento, oficios de respuesta, actas, etc..."
                  style={{
                    width: '100%',
                    minHeight: '80px',
                    background: 'hsla(var(--bg-tertiary-hsl), 0.3)',
                    border: '1px solid hsla(var(--border-color-hsl), 0.3)',
                    borderRadius: '6px',
                    color: 'hsl(var(--text-primary))',
                    padding: '8px',
                    fontSize: '0.75rem',
                    outline: 'none',
                    resize: 'vertical',
                    fontFamily: 'inherit'
                  }}
                />
              </div>

              <div style={{ height: '1px', background: 'hsla(var(--border-color-hsl), 0.2)' }}></div>

              {/* Extracted read-only / custom editable metadata */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                
                <div>
                  <span style={{ fontSize: '0.6rem', color: 'hsl(var(--text-muted))', display: 'flex', alignItems: 'center', gap: '4px', textTransform: 'uppercase', marginBottom: '4px' }}>
                    <Calendar size={10} /> Fecha del Oficio
                  </span>
                  <input
                    type="date"
                    value={selectedFile.metadata?.date || ''}
                    onChange={(e) => handleUpdateMetadata({ date: e.target.value })}
                    style={{
                      width: '100%',
                      background: 'hsla(var(--bg-tertiary-hsl), 0.3)',
                      border: '1px solid hsla(var(--border-color-hsl), 0.3)',
                      borderRadius: '6px',
                      color: 'hsl(var(--text-primary))',
                      padding: '6px 8px',
                      fontSize: '0.75rem',
                      outline: 'none'
                    }}
                  />
                </div>

                <div>
                  <span style={{ fontSize: '0.6rem', color: 'hsl(var(--text-muted))', display: 'flex', alignItems: 'center', gap: '4px', textTransform: 'uppercase', marginBottom: '4px' }}>
                    <User size={10} /> Remitente (Quién envía)
                  </span>
                  <input
                    type="text"
                    value={selectedFile.metadata?.sender || ''}
                    onChange={(e) => handleUpdateMetadata({ sender: e.target.value })}
                    style={{
                      width: '100%',
                      background: 'hsla(var(--bg-tertiary-hsl), 0.3)',
                      border: '1px solid hsla(var(--border-color-hsl), 0.3)',
                      borderRadius: '6px',
                      color: 'hsl(var(--text-primary))',
                      padding: '6px 8px',
                      fontSize: '0.75rem',
                      outline: 'none'
                    }}
                  />
                </div>

                <div>
                  <span style={{ fontSize: '0.6rem', color: 'hsl(var(--text-muted))', display: 'flex', alignItems: 'center', gap: '4px', textTransform: 'uppercase', marginBottom: '4px' }}>
                    <User size={10} /> Destinatario (A quién va dirigido)
                  </span>
                  <input
                    type="text"
                    value={selectedFile.metadata?.receiver || ''}
                    onChange={(e) => handleUpdateMetadata({ receiver: e.target.value })}
                    style={{
                      width: '100%',
                      background: 'hsla(var(--bg-tertiary-hsl), 0.3)',
                      border: '1px solid hsla(var(--border-color-hsl), 0.3)',
                      borderRadius: '6px',
                      color: 'hsl(var(--text-primary))',
                      padding: '6px 8px',
                      fontSize: '0.75rem',
                      outline: 'none'
                    }}
                  />
                </div>

                <div>
                  <span style={{ fontSize: '0.6rem', color: 'hsl(var(--text-muted))', display: 'flex', alignItems: 'center', gap: '4px', textTransform: 'uppercase', marginBottom: '4px' }}>
                    <FileText size={10} /> Asunto Extracted
                  </span>
                  <textarea
                    value={selectedFile.metadata?.subject || ''}
                    onChange={(e) => handleUpdateMetadata({ subject: e.target.value })}
                    style={{
                      width: '100%',
                      minHeight: '40px',
                      background: 'hsla(var(--bg-tertiary-hsl), 0.3)',
                      border: '1px solid hsla(var(--border-color-hsl), 0.3)',
                      borderRadius: '6px',
                      color: 'hsl(var(--text-primary))',
                      padding: '6px 8px',
                      fontSize: '0.75rem',
                      outline: 'none',
                      resize: 'none'
                    }}
                  />
                </div>

                <div>
                  <span style={{ fontSize: '0.6rem', color: 'hsl(var(--text-muted))', display: 'flex', alignItems: 'center', gap: '4px', textTransform: 'uppercase', marginBottom: '4px' }}>
                    <AlertCircle size={10} /> Resumen Ejecutivo IA
                  </span>
                  <div style={{ 
                    padding: '10px', 
                    background: 'hsla(var(--accent-primary-hsl), 0.02)',
                    border: '1px solid hsla(var(--accent-primary-hsl), 0.15)',
                    borderRadius: '6px',
                    fontSize: '0.75rem',
                    color: 'hsl(var(--text-secondary))',
                    lineHeight: '1.4'
                  }}>
                    {selectedFile.metadata?.summary || 'Sin resumen disponible.'}
                  </div>
                </div>

                <div>
                  <span style={{ fontSize: '0.6rem', color: 'hsl(var(--text-muted))', display: 'flex', alignItems: 'center', gap: '4px', textTransform: 'uppercase', marginBottom: '4px' }}>
                    <Clock size={10} /> Fecha Límite de Seguimiento
                  </span>
                  <input
                    type="date"
                    value={selectedFile.metadata?.followUpDeadline || ''}
                    onChange={(e) => handleUpdateMetadata({ followUpDeadline: e.target.value })}
                    style={{
                      width: '100%',
                      background: 'hsla(var(--bg-tertiary-hsl), 0.3)',
                      border: '1px solid hsla(var(--border-color-hsl), 0.3)',
                      borderRadius: '6px',
                      color: 'hsl(var(--text-primary))',
                      padding: '6px 8px',
                      fontSize: '0.75rem',
                      outline: 'none'
                    }}
                  />
                </div>

              </div>

            </div>

            {/* Bottom Actions footer */}
            <div style={{ 
              padding: '12px 20px', 
              borderTop: '1px solid hsla(var(--border-color-hsl), 0.3)',
              background: 'hsla(var(--bg-tertiary-hsl), 0.5)',
              display: 'flex',
              gap: '10px'
            }}>
              <button
                className="btn btn-primary"
                onClick={() => handleViewPdf(selectedFile)}
                style={{ 
                  flex: 1, 
                  display: 'flex', 
                  alignItems: 'center', 
                  justifyContent: 'center', 
                  gap: '6px',
                  fontSize: '0.75rem',
                  height: '36px',
                  background: 'hsl(var(--accent-primary))',
                  color: '#000',
                  border: 'none'
                }}
              >
                <Eye size={14} /> VER OFICIO
              </button>

              <button
                className="btn btn-secondary"
                onClick={() => handleDownloadPdf(selectedFile)}
                style={{ 
                  display: 'flex', 
                  alignItems: 'center', 
                  justifyContent: 'center', 
                  gap: '6px',
                  fontSize: '0.75rem',
                  height: '36px'
                }}
              >
                <Download size={14} /> DESCARGAR
              </button>

              <button
                className="btn btn-ghost"
                onClick={() => handleDeleteFile(selectedFile.id)}
                style={{ 
                  padding: '6px 12px', 
                  color: 'hsl(var(--danger))',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  fontSize: '0.75rem',
                  height: '36px'
                }}
              >
                <Trash2 size={14} /> ELIMINAR
              </button>
            </div>

          </div>
        )}

      </div>
    </div>
  );
}
