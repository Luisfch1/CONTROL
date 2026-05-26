import React, { useState, useRef, useEffect } from 'react';
import { X, Send, Bot, User, Trash2, Download, Mic, MicOff } from 'lucide-react';
import { useAgent } from '../context/AgentContext';
import { useProjects } from '../context/ProjectsContext';
import { exportAIReportToWord } from '../utils/aiReportExport';
import { chatWithAgent, transcribeAudio, type ChatMessage, type MessageContent } from '../services/aiService';

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
    if (input.trim() && !isLoading) {
      sendMessage(input.trim());
      setInput('');
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
              background: msg.role === 'user' ? 'hsla(var(--bg-tertiary), 0.8)' : 'transparent',
              border: msg.role === 'user' ? '1px solid hsl(var(--border-color))' : 'none',
              padding: msg.role === 'user' ? '10px 14px' : '4px 0',
              borderRadius: 'var(--radius-md)',
              borderTopRightRadius: msg.role === 'user' ? '0' : 'var(--radius-md)',
              borderTopLeftRadius: msg.role === 'assistant' ? '0' : 'var(--radius-md)',
              maxWidth: '85%',
              color: 'hsl(var(--text-primary))',
              fontSize: '0.85rem',
              lineHeight: '1.5',
              wordBreak: 'break-word',
              whiteSpace: 'pre-wrap' // Para respetar saltos de línea y formateo markdown básico
            }}>
              {typeof msg.content === 'string' ? (
                msg.content
              ) : (
                (msg.content as MessageContent[]).map((c, i) => c.type === 'text' ? c.text : null).join('')
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
          </div>
        ))}
        {isLoading && (
          <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
             <div style={{
              width: '28px', height: '28px', borderRadius: '50%',
              background: 'hsla(var(--accent-primary), 0.1)', border: '1px solid hsla(var(--accent-primary), 0.5)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'hsl(var(--accent-primary))'
            }}>
              <Bot size={14} />
            </div>
            <div style={{ padding: '8px 0', fontSize: '0.85rem', color: 'hsl(var(--text-muted))', display: 'flex', alignItems: 'center', gap: '4px' }}>
              <span className="dot-pulse">Generando respuesta...</span>
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
        <form onSubmit={handleSubmit} style={{ display: 'flex', gap: '8px' }}>
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
                    : "Pregúntale al Agente IA..."
            }
            disabled={isLoading || rateLimitCountdown > 0 || isTranscribing}
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
            disabled={isLoading || rateLimitCountdown > 0 || isTranscribing}
            style={{
              background: isListening ? 'hsl(var(--danger))' : 'hsla(var(--bg-tertiary), 1)',
              color: isListening ? '#fff' : 'hsl(var(--text-secondary))',
              border: isListening ? 'none' : '1px solid hsl(var(--border-color))',
              borderRadius: 'var(--radius-md)',
              padding: '0 12px',
              cursor: (isLoading || rateLimitCountdown > 0 || isTranscribing) ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'all 0.2s',
              boxShadow: isListening ? '0 0 10px hsla(var(--danger-hsl), 0.4)' : 'none',
              opacity: (isLoading || rateLimitCountdown > 0 || isTranscribing) ? 0.5 : 1
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
            disabled={!input.trim() || isLoading || rateLimitCountdown > 0 || isTranscribing}
            style={{
              background: input.trim() && !isLoading && rateLimitCountdown === 0 && !isTranscribing ? 'hsl(var(--accent-primary))' : 'hsla(var(--bg-tertiary), 1)',
              color: input.trim() && !isLoading && rateLimitCountdown === 0 && !isTranscribing ? '#000' : 'hsl(var(--text-muted))',
              border: 'none',
              borderRadius: 'var(--radius-md)',
              padding: '0 16px',
              cursor: input.trim() && !isLoading && rateLimitCountdown === 0 && !isTranscribing ? 'pointer' : 'not-allowed',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'all 0.2s'
            }}
          >
            <Send size={16} />
          </button>
        </form>
      </div>
    </div>
  );
};

export default AgentPanel;
