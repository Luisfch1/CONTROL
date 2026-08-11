import React, { useState, useRef, useEffect } from 'react';
import { X, Send, Bot, User, Trash2, Download, Mic, MicOff, Paperclip, FileText } from 'lucide-react';
import { useAgent } from '../context/AgentContext';
import { useProjects } from '../context/ProjectsContext';
import { exportAIReportToWord } from '../utils/aiReportExport';
import { chatWithAgent, transcribeAudio, type ChatMessage, type MessageContent } from '../services/aiService';
import { processUploadedFile, type ProcessedFile } from '../services/fileParserService';

const AgentPanel: React.FC = () => {
  const { isAgentOpen, toggleAgent, messages, sendMessage, isLoading, clearHistory, taskProgress, rateLimitCountdown } = useAgent();
  const { getActiveProject } = useProjects();
  const activeProject = getActiveProject();
  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [isListening, setIsListening] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingTimeoutRef = useRef<any>(null);

  const [pendingFiles, setPendingFiles] = useState<ProcessedFile[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleAttachClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    
    setIsUploading(true);
    const newProcessedFiles: ProcessedFile[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      try {
        const processed = await processUploadedFile(file);
        newProcessedFiles.push(processed);
      } catch (err) {
        console.error("Error al procesar archivo:", file.name, err);
        alert(`Error al procesar "${file.name}": ` + (err instanceof Error ? err.message : String(err)));
      }
    }
    setPendingFiles(prev => [...prev, ...newProcessedFiles]);
    setIsUploading(false);
    
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const removePendingFile = (idx: number) => {
    setPendingFiles(prev => prev.filter((_, i) => i !== idx));
  };

  useEffect(() => {
    return () => {
      if (recordingTimeoutRef.current) {
        clearTimeout(recordingTimeoutRef.current);
      }
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop();
      }
    };
  }, []);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioChunksRef.current = [];
      
      const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
      
      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      recorder.onstop = async () => {
        // Detener todos los tracks del stream para liberar el micrófono
        stream.getTracks().forEach(track => track.stop());

        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        if (audioBlob.size < 1000) {
          // Demasiado corto (ej: menos de 1 KB), posiblemente un click accidental
          return;
        }

        setIsTranscribing(true);
        try {
          const reader = new FileReader();
          reader.readAsDataURL(audioBlob);
          reader.onloadend = async () => {
            const base64Data = (reader.result as string).split(',')[1];
            try {
              const transcription = await transcribeAudio(base64Data, 'audio/webm');
              if (transcription && transcription.trim()) {
                setInput(prev => {
                  const trimmed = prev.trim();
                  return trimmed ? `${trimmed} ${transcription.trim()}` : transcription.trim();
                });
              }
            } catch (apiErr: any) {
              console.error("Error transcribiendo audio con Gemini:", apiErr);
              alert("❌ Error al transcribir el audio: " + (apiErr.message || apiErr));
            } finally {
              setIsTranscribing(false);
            }
          };
        } catch (err) {
          console.error("Error procesando audio:", err);
          setIsTranscribing(false);
        }
      };

      mediaRecorderRef.current = recorder;
      recorder.start();
      setIsListening(true);

      // Tiempo máximo de grabación: 20 segundos
      recordingTimeoutRef.current = setTimeout(() => {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
          stopRecording();
        }
      }, 20000);
    } catch (err: any) {
      console.error("Error al acceder al micrófono:", err);
      alert("🎙️ No se pudo acceder al micrófono. Asegúrate de dar los permisos necesarios.");
      setIsListening(false);
    }
  };

  const stopRecording = () => {
    if (recordingTimeoutRef.current) {
      clearTimeout(recordingTimeoutRef.current);
      recordingTimeoutRef.current = null;
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    setIsListening(false);
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isLoading]);

  useEffect(() => {
    if (isAgentOpen) {
      const timer = setTimeout(() => {
        inputRef.current?.focus();
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [isAgentOpen]);

  if (!isAgentOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const hasAttachments = pendingFiles.length > 0;
    if ((input.trim() || hasAttachments) && !isLoading) {
      sendMessage(input.trim(), pendingFiles);
      setInput('');
      setPendingFiles([]);
    }
  };

  return (
    <div style={{
      position: 'fixed',
      top: '20px',
      right: '20px',
      bottom: '20px',
      width: '400px',
      background: 'hsla(var(--bg-secondary), 0.95)',
      backdropFilter: 'blur(10px)',
      border: '1px solid hsl(var(--border-color))',
      borderRadius: 'var(--radius-lg)',
      boxShadow: '0 10px 40px rgba(0,0,0,0.5), 0 0 0 1px hsla(var(--accent-primary), 0.2)',
      display: 'flex',
      flexDirection: 'column',
      zIndex: 1000,
      animation: 'slideLeft 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
      overflow: 'hidden'
    }}>
      <style>{`
        @keyframes agent-spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
        @keyframes agent-pulse {
          0%, 100% { opacity: 0.5; }
          50% { opacity: 1; }
        }
        .agent-loading-spinner {
          width: 12px;
          height: 12px;
          border: 2px solid hsla(var(--primary-neon-hsl), 0.2);
          border-top-color: hsl(var(--accent-primary));
          border-radius: 50%;
          animation: agent-spin 0.8s linear infinite;
        }
        .agent-loading-text {
          animation: agent-pulse 1.5s ease-in-out infinite;
          font-family: var(--font-technical);
          font-size: 0.72rem;
          letter-spacing: 0.5px;
          text-transform: uppercase;
          font-weight: bold;
          color: hsl(var(--accent-primary));
        }
        .agent-spinning-icon {
          animation: agent-spin 4s linear infinite;
        }
      `}</style>
      {/* Header */}
      <div style={{
        padding: '16px',
        borderBottom: '1px solid hsl(var(--border-color))',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        background: 'hsla(var(--bg-tertiary), 0.5)'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div style={{
            background: 'hsla(var(--accent-primary), 0.2)',
            padding: '6px',
            borderRadius: '50%',
            color: 'hsl(var(--accent-primary))'
          }}>
            <Bot size={18} />
          </div>
          <div>
            <h3 style={{ margin: 0, fontSize: '1rem', color: 'hsl(var(--text-primary))', fontFamily: 'var(--font-technical)', letterSpacing: '1px' }}>CONTROL IA</h3>
            <span style={{ fontSize: '0.65rem', color: 'hsl(var(--accent-primary))', textTransform: 'uppercase', letterSpacing: '1px' }}>POWERED BY LCH IA</span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            onClick={clearHistory}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'hsl(var(--text-muted))',
              cursor: 'pointer',
              padding: '4px',
              borderRadius: '4px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'all 0.2s'
            }}
            onMouseEnter={(e) => { e.currentTarget.style.color = 'hsl(var(--danger))'; e.currentTarget.style.background = 'hsla(var(--danger), 0.1)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'hsl(var(--text-muted))'; e.currentTarget.style.background = 'transparent'; }}
            title="Limpiar Memoria"
          >
            <Trash2 size={16} />
          </button>
          <button
            onClick={toggleAgent}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'hsl(var(--text-muted))',
              cursor: 'pointer',
              padding: '4px',
              borderRadius: '4px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'all 0.2s'
            }}
            onMouseEnter={(e) => { e.currentTarget.style.color = 'hsl(var(--text-primary))'; e.currentTarget.style.background = 'hsla(var(--border-color), 0.5)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'hsl(var(--text-muted))'; e.currentTarget.style.background = 'transparent'; }}
          >
            <X size={18} />
          </button>
        </div>
      </div>

      {/* Chat Area */}
      <div style={{
        flex: 1,
        overflowY: 'auto',
        padding: '16px',
        display: 'flex',
        flexDirection: 'column',
        gap: '16px',
      }} className="custom-scrollbar">
        {messages.map((msg, idx) => (
          <div key={idx} style={{
            display: 'flex',
            flexDirection: msg.role === 'user' ? 'row-reverse' : 'row',
            gap: '12px',
            alignItems: 'flex-start'
          }}>
            <div style={{
              width: '28px',
              height: '28px',
              borderRadius: '50%',
              background: msg.role === 'user' ? 'hsla(var(--bg-tertiary), 1)' : 'hsla(var(--accent-primary), 0.1)',
              border: `1px solid ${msg.role === 'user' ? 'hsl(var(--border-color))' : 'hsla(var(--accent-primary), 0.5)'}`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
              color: msg.role === 'user' ? 'hsl(var(--text-secondary))' : 'hsl(var(--accent-primary))'
            }}>
              {msg.role === 'user' ? <User size={14} /> : <Bot size={14} />}
            </div>
            <div style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: msg.role === 'user' ? 'flex-end' : 'flex-start',
              maxWidth: '85%'
            }}>
              <div style={{
                background: msg.role === 'user' ? 'hsla(var(--bg-tertiary), 0.8)' : 'transparent',
                border: msg.role === 'user' ? '1px solid hsl(var(--border-color))' : 'none',
                padding: msg.role === 'user' ? '10px 14px' : '4px 0',
                borderRadius: 'var(--radius-md)',
                borderTopRightRadius: msg.role === 'user' ? '0' : 'var(--radius-md)',
                borderTopLeftRadius: msg.role === 'assistant' ? '0' : 'var(--radius-md)',
                color: 'hsl(var(--text-primary))',
                fontSize: '0.85rem',
                lineHeight: '1.5',
                wordBreak: 'break-word',
                whiteSpace: 'pre-wrap', // Para respetar saltos de línea y formateo markdown básico
                width: '100%'
              }}>
                {typeof msg.content === 'string' ? (
                  msg.content
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {/* Text parts */}
                    {(msg.content as MessageContent[])
                      .filter(c => c.type === 'text')
                      .map((c, i) => (
                        <span key={i}>{c.text}</span>
                      ))}
                    
                    {/* Image parts */}
                    {(msg.content as MessageContent[])
                      .filter(c => c.type === 'image_url')
                      .map((c, i) => c.image_url?.url && (
                        <img
                          key={i}
                          src={c.image_url.url}
                          alt="Adjunto"
                          style={{
                            maxWidth: '100%',
                            maxHeight: '150px',
                            objectFit: 'contain',
                            borderRadius: 'var(--radius-sm)',
                            border: '1px solid hsl(var(--border-color))',
                            marginTop: '4px',
                            cursor: 'pointer'
                          }}
                          onClick={() => window.open(c.image_url!.url, '_blank')}
                        />
                      ))}
                    
                    {/* File parts */}
                    {(msg.content as MessageContent[])
                      .filter(c => c.type === 'file')
                      .map((c, i) => c.file && (
                        <div
                          key={i}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px',
                            background: 'hsla(var(--bg-primary), 0.5)',
                            border: '1px solid hsl(var(--border-color))',
                            borderRadius: 'var(--radius-sm)',
                            padding: '6px 10px',
                            fontSize: '0.75rem',
                            marginTop: '4px',
                            alignSelf: 'flex-start'
                          }}
                        >
                          <FileText size={16} style={{ color: 'hsl(var(--accent-primary))', flexShrink: 0 }} />
                          <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                            <span style={{ fontWeight: '500', color: 'hsl(var(--text-primary))', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '200px' }}>{c.file.name}</span>
                            <span style={{ fontSize: '0.65rem', color: 'hsl(var(--text-muted))' }}>{c.file.mimeType}</span>
                          </div>
                        </div>
                      ))}
                  </div>
                )}
                {msg.isReport && activeProject && (
                  <button
                    onClick={() => exportAIReportToWord(activeProject, typeof msg.content === 'string' ? msg.content : '')}
                    className="btn btn-secondary"
                    style={{
                      marginTop: '12px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      fontSize: '0.75rem',
                      padding: '6px 12px',
                      background: 'hsla(var(--accent-primary), 0.1)',
                      color: 'hsl(var(--accent-primary))',
                      border: '1px solid hsla(var(--accent-primary), 0.3)',
                      borderRadius: '4px',
                      cursor: 'pointer',
                      width: '100%',
                      justifyContent: 'center'
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = 'hsla(var(--accent-primary), 0.2)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = 'hsla(var(--accent-primary), 0.1)'; }}
                  >
                    <Download size={14} /> DESCARGAR REPORTE WORD
                  </button>
                )}
              </div>
              {msg.timestamp && (
                <span style={{
                  fontSize: '0.65rem',
                  color: 'hsl(var(--text-muted))',
                  marginTop: '4px',
                  marginRight: msg.role === 'user' ? '4px' : '0',
                  marginLeft: msg.role === 'assistant' ? '4px' : '0',
                  fontFamily: 'var(--font-technical)',
                  opacity: 0.8
                }}>
                  {msg.timestamp}
                </span>
              )}
            </div>
          </div>
        ))}
        {isLoading && (
          <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
             <div style={{
              width: '28px', height: '28px', borderRadius: '50%',
              background: 'hsla(var(--accent-primary), 0.1)', border: '1px solid hsla(var(--accent-primary), 0.5)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'hsl(var(--accent-primary))'
            }}>
              <Bot size={14} className="agent-spinning-icon" />
            </div>
            <div style={{ padding: '8px 0', fontSize: '0.85rem', color: 'hsl(var(--text-muted))', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div className="agent-loading-spinner" />
              <span className="agent-loading-text">Pensando...</span>
            </div>
          </div>
        )}
        
        {/* Task Progress Indicator */}
        {taskProgress && (
          <div style={{
            background: 'hsla(var(--accent-primary), 0.1)',
            border: '1px solid hsla(var(--accent-primary), 0.3)',
            borderRadius: 'var(--radius-md)',
            padding: '12px',
            marginTop: '8px',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: 'hsl(var(--text-primary))', fontWeight: 'bold' }}>
              <span>Motor CoT en Ejecución</span>
              <span style={{ color: 'hsl(var(--accent-primary))' }}>Lote {taskProgress.currentChunk} de {taskProgress.totalChunks}</span>
            </div>
            
            <div style={{ width: '100%', height: '4px', background: 'hsla(var(--bg-tertiary), 1)', borderRadius: '2px', overflow: 'hidden' }}>
              <div style={{ 
                width: `${(taskProgress.currentChunk / Math.max(taskProgress.totalChunks, 1)) * 100}%`, 
                height: '100%', 
                background: 'hsl(var(--accent-primary))',
                transition: 'width 0.5s ease-out'
              }}></div>
            </div>
            
            <div style={{ fontSize: '0.65rem', color: 'hsl(var(--text-muted))', textAlign: 'center', marginTop: '4px' }}>
              {taskProgress.statusText}
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input Area */}
      <div style={{
        padding: '16px',
        borderTop: '1px solid hsl(var(--border-color))',
        background: 'hsla(var(--bg-tertiary), 0.5)'
      }}>
        {rateLimitCountdown > 0 && (
          <div style={{
            background: 'hsla(var(--accent-primary), 0.03)',
            border: '1px solid hsla(var(--accent-primary), 0.15)',
            borderRadius: 'var(--radius-md)',
            padding: '10px 14px',
            marginBottom: '12px',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
            boxShadow: '0 4px 12px rgba(0,0,0,0.15)'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.72rem', color: 'hsl(var(--text-primary))', fontWeight: 'bold' }}>
              <span style={{ color: 'hsl(var(--accent-primary))', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span className="alert-status-dot warning" style={{ width: '6px', height: '6px', display: 'inline-block', flexShrink: 0 }}></span>
                Rate Limit Excedido (API 429)
              </span>
              <span style={{ color: 'hsl(var(--text-muted))' }}>Reintentar en {rateLimitCountdown}s</span>
            </div>
            
            <div style={{ width: '100%', height: '4px', background: 'hsla(var(--bg-tertiary), 1)', borderRadius: '2px', overflow: 'hidden' }}>
              <div style={{ 
                width: `${(rateLimitCountdown / 30) * 100}%`, 
                height: '100%', 
                background: 'hsl(var(--accent-primary))',
                transition: 'width 1s linear'
              }}></div>
            </div>
          </div>
        )}
        {/* Visualización de archivos pendientes */}
        {pendingFiles.length > 0 && (
          <div style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: '8px',
            marginBottom: '10px',
            padding: '4px 0',
            maxHeight: '120px',
            overflowY: 'auto'
          }} className="custom-scrollbar">
            {pendingFiles.map((file, idx) => (
              <div
                key={idx}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  background: 'hsla(var(--bg-primary), 0.6)',
                  border: '1px solid hsl(var(--border-color))',
                  borderRadius: 'var(--radius-sm)',
                  padding: '4px 8px',
                  fontSize: '0.75rem',
                  color: 'hsl(var(--text-primary))',
                  maxWidth: '180px',
                  position: 'relative'
                }}
              >
                {file.mimeType.startsWith('image/') && file.url ? (
                  <img
                    src={file.url}
                    alt={file.name}
                    style={{
                      width: '20px',
                      height: '20px',
                      objectFit: 'cover',
                      borderRadius: '2px'
                    }}
                  />
                ) : (
                  <FileText size={14} style={{ color: 'hsl(var(--accent-primary))', flexShrink: 0 }} />
                )}
                <span
                  style={{
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    flex: 1
                  }}
                  title={file.name}
                >
                  {file.name}
                </span>
                <button
                  type="button"
                  onClick={() => removePendingFile(idx)}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: 'hsl(var(--text-muted))',
                    cursor: 'pointer',
                    padding: '2px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderRadius: '50%',
                    transition: 'all 0.2s'
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.color = 'hsl(var(--danger))'}
                  onMouseLeave={(e) => e.currentTarget.style.color = 'hsl(var(--text-muted))'}
                >
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ display: 'flex', gap: '8px' }}>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            onChange={handleFileChange}
            style={{ display: 'none' }}
          />
          <button
            type="button"
            onClick={handleAttachClick}
            disabled={isLoading || rateLimitCountdown > 0 || isTranscribing || isUploading}
            style={{
              background: 'hsla(var(--bg-tertiary), 1)',
              color: 'hsl(var(--text-secondary))',
              border: '1px solid hsl(var(--border-color))',
              borderRadius: 'var(--radius-md)',
              padding: '0 12px',
              cursor: (isLoading || rateLimitCountdown > 0 || isTranscribing || isUploading) ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'all 0.2s',
              opacity: (isLoading || rateLimitCountdown > 0 || isTranscribing || isUploading) ? 0.5 : 1
            }}
            title="Adjuntar archivos"
          >
            {isUploading ? (
              <span className="dot-pulse" style={{ fontSize: '0.65rem' }}>...</span>
            ) : (
              <Paperclip size={16} />
            )}
          </button>
          
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={
              rateLimitCountdown > 0 
                ? `API en espera (${rateLimitCountdown}s)...` 
                : isTranscribing 
                  ? "Transcribiendo voz con IA..." 
                  : isListening 
                    ? "Escuchando... habla ahora y presiona el micro al terminar." 
                    : isUploading
                      ? "Procesando archivo adjunto..."
                      : "Pregúntale al Agente IA..."
            }
            disabled={isLoading || rateLimitCountdown > 0 || isTranscribing || isUploading}
            style={{
              flex: 1,
              background: 'hsl(var(--bg-primary))',
              border: '1px solid hsl(var(--border-color))',
              color: 'hsl(var(--text-primary))',
              padding: '10px 14px',
              borderRadius: 'var(--radius-md)',
              fontSize: '0.85rem',
              outline: 'none',
              transition: 'border-color 0.2s',
            }}
            onFocus={(e) => e.target.style.borderColor = 'hsl(var(--accent-primary))'}
            onBlur={(e) => e.target.style.borderColor = 'hsl(var(--border-color))'}
          />
          
          <button
            type="button"
            onClick={isListening ? stopRecording : startRecording}
            disabled={isLoading || rateLimitCountdown > 0 || isTranscribing || isUploading}
            style={{
              background: isListening ? 'hsl(var(--danger))' : 'hsla(var(--bg-tertiary), 1)',
              color: isListening ? '#fff' : 'hsl(var(--text-secondary))',
              border: isListening ? 'none' : '1px solid hsl(var(--border-color))',
              borderRadius: 'var(--radius-md)',
              padding: '0 12px',
              cursor: (isLoading || rateLimitCountdown > 0 || isTranscribing || isUploading) ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'all 0.2s',
              boxShadow: isListening ? '0 0 10px hsla(var(--danger-hsl), 0.4)' : 'none',
              opacity: (isLoading || rateLimitCountdown > 0 || isTranscribing || isUploading) ? 0.5 : 1
            }}
            title={
              isTranscribing 
                ? "Procesando..." 
                : isListening 
                  ? "Detener dictado por voz" 
                  : "Dictar por voz"
            }
          >
            {isTranscribing ? (
              <span className="dot-pulse" style={{ fontSize: '0.65rem' }}>...</span>
            ) : isListening ? (
              <MicOff size={16} />
            ) : (
              <Mic size={16} />
            )}
          </button>
          
          <button
            type="submit"
            disabled={(!input.trim() && pendingFiles.length === 0) || isLoading || rateLimitCountdown > 0 || isTranscribing || isUploading}
            style={{
              background: (input.trim() || pendingFiles.length > 0) && !isLoading && rateLimitCountdown === 0 && !isTranscribing && !isUploading ? 'hsl(var(--accent-primary))' : 'hsla(var(--bg-tertiary), 1)',
              color: (input.trim() || pendingFiles.length > 0) && !isLoading && rateLimitCountdown === 0 && !isTranscribing && !isUploading ? '#000' : 'hsl(var(--text-muted))',
              border: 'none',
              borderRadius: 'var(--radius-md)',
              padding: '0 16px',
              cursor: (input.trim() || pendingFiles.length > 0) && !isLoading && rateLimitCountdown === 0 && !isTranscribing && !isUploading ? 'pointer' : 'not-allowed',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'all 0.2s',
              minWidth: '48px'
            }}
          >
            {isLoading ? (
              <div className="agent-loading-spinner" style={{ borderTopColor: 'currentColor' }} />
            ) : (
              <Send size={16} />
            )}
          </button>
        </form>
      </div>
    </div>
  );
};

export default AgentPanel;
