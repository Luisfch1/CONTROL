export type Role = 'system' | 'user' | 'assistant' | 'function';

export interface MessageContent {
  type: 'text' | 'image_url' | 'file';
  text?: string;
  image_url?: {
    url: string; // URL o Base64 o Blob URL
  };
  file?: {
    url: string; // Base64 data URL
    name: string;
    mimeType: string;
  };
}

export interface ChatMessage {
  role: Role;
  content: string | MessageContent[];
  isReport?: boolean;
  timestamp?: string;
  functionCall?: {
    name: string;
    args: any;
  };
  functionResponse?: {
    name: string;
    response: any;
  };
}

export interface AIConfig {
  endpoint: string;
  maxContextMessages: number;
}

// Validar si una API Key es real y no un texto de marcador de posición (placeholder)
const isValidApiKey = (key?: string | null): boolean => {
  if (!key) return false;
  const k = key.trim();
  return (
    k.length > 10 && 
    k !== 'TU_API_KEY_DE_GEMINI_AQUI' && 
    k !== 'YOUR_GEMINI_API_KEY'
  );
};

// Obtener la API Key validando la prioridad: opción pasada -> localStorage -> Variable de entorno
const getApiKey = (optionsApiKey?: string): string => {
  // 1. Clave pasada en las opciones (nivel de proyecto activo)
  if (isValidApiKey(optionsApiKey)) {
    return optionsApiKey!.trim();
  }

  // 2. Clave guardada localmente por el usuario en la interfaz (localStorage)
  const localKey = localStorage.getItem('gemini-api-key');
  if (isValidApiKey(localKey)) {
    return localKey!.trim();
  }

  // 3. Variable de entorno Vite (último recurso)
  const envKey = import.meta.env.VITE_GEMINI_API_KEY;
  if (isValidApiKey(envKey)) {
    return envKey.trim();
  }

  return '';
};

const DEFAULT_CONFIG: AIConfig = {
  endpoint: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent',
  maxContextMessages: 20, // Aumentado gracias a la ventana de contexto de Gemini
};

/**
 * Traduce el historial de mensajes de la aplicación al formato oficial que requiere Gemini,
 * procesando asíncronamente imágenes en base64 o Blob URLs locales.
 */
const mapMessagesToGemini = async (messages: ChatMessage[]): Promise<any[]> => {
  const contents: any[] = [];

  for (const msg of messages) {
    // El system prompt se pasa por fuera en systemInstruction de Gemini
    if (msg.role === 'system') continue;

    let role = 'user';
    if (msg.role === 'assistant') {
      role = 'model';
    } else if (msg.role === 'function') {
      role = 'function';
    }

    const parts: any[] = [];

    if (msg.role === 'function' && msg.functionResponse) {
      parts.push({
        functionResponse: msg.functionResponse
      });
    } else if (msg.role === 'assistant' && msg.functionCall) {
      parts.push({
        functionCall: msg.functionCall
      });
    } else if (typeof msg.content === 'string') {
      if (msg.content) {
        parts.push({ text: msg.content });
      }
    } else if (Array.isArray(msg.content)) {
      for (const part of msg.content) {
        if (part.type === 'text') {
          parts.push({ text: part.text || '' });
        } else if (part.type === 'image_url' && part.image_url?.url) {
          const url = part.image_url.url;
          if (url.startsWith('data:')) {
            const mimeType = url.substring(url.indexOf(':') + 1, url.indexOf(';'));
            const data = url.substring(url.indexOf(',') + 1);
            parts.push({
              inlineData: {
                mimeType,
                data
              }
            });
          } else {
            // Es un Blob URL o URL remota, lo descargamos para convertirlo a inlineData
            try {
              const res = await fetch(url);
              const blob = await res.blob();
              const base64Data = await new Promise<string>((resolve, reject) => {
                const reader = new FileReader();
                reader.onloadend = () => {
                  const result = reader.result as string;
                  resolve(result.substring(result.indexOf(',') + 1));
                };
                reader.onerror = reject;
                reader.readAsDataURL(blob);
              });
              parts.push({
                inlineData: {
                  mimeType: blob.type || 'image/jpeg',
                  data: base64Data
                }
              });
            } catch (err) {
              console.error("Error al procesar la imagen para Gemini:", url, err);
            }
          }
        } else if (part.type === 'file' && part.file?.url) {
          const url = part.file.url;
          if (url.startsWith('data:')) {
            const mimeType = url.substring(url.indexOf(':') + 1, url.indexOf(';'));
            const data = url.substring(url.indexOf(',') + 1);
            parts.push({
              inlineData: {
                mimeType,
                data
              }
            });
          }
        }
      }
    }

    if (parts.length > 0) {
      contents.push({ role, parts });
    }
  }

  return contents;
};

export interface ApiAuditLog {
  id: string;
  timestamp: string;
  model: string;
  url: string;
  status: number | string;
  durationMs: number;
  systemPrompt: string;
  messages: ChatMessage[];
  response?: any;
  error?: string;
}

export const apiAuditLogs: ApiAuditLog[] = [];

const addAuditLog = (log: Omit<ApiAuditLog, 'id' | 'timestamp'>) => {
  const newLog: ApiAuditLog = {
    ...log,
    id: `log-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    timestamp: new Date().toLocaleTimeString()
  };
  apiAuditLogs.unshift(newLog);
  if (apiAuditLogs.length > 50) {
    apiAuditLogs.pop();
  }
  window.dispatchEvent(new CustomEvent('control-api-audit-update'));

  // Escribir logs de API localmente para depuración en el espacio de trabajo
  if ((window as any).electronAPI && typeof (window as any).electronAPI.writeFile === 'function') {
    try {
      (window as any).electronAPI.writeFile('c:/Users/ingen/Documents/APPS/Antigravity/Control/api_logs.json', JSON.stringify(apiAuditLogs, null, 2))
        .catch((err: any) => console.error("Error writing api_logs.json:", err));
    } catch (e) {
      console.error("Error serializing API logs:", e);
    }
  }
};

interface ChatOptions {
  tools?: any[];
  toolConfig?: any;
  apiKey?: string;
}

export const chatWithAgent = async (
  messages: ChatMessage[],
  systemPrompt: string,
  config: AIConfig = DEFAULT_CONFIG,
  options?: ChatOptions
): Promise<any> => {
  const apiKey = getApiKey(options?.apiKey);
  if (!apiKey) {
    throw new Error(
      "🔑 Falta configurar la API Key de Google AI Studio (Gemini).\n\n" +
      "Por favor realiza una de las siguientes opciones:\n" +
      "1. Haz clic en el botón 'Configuración' (icono de engranaje en la barra lateral izquierda) y guarda tu API Key en la sección 'Configuración Agente IA'.\n" +
      "2. Crea un archivo `.env` en la raíz del proyecto y agrega `VITE_GEMINI_API_KEY=tu_api_key`.\n" +
      "3. O ejecuta en la consola de desarrollador: `localStorage.setItem('gemini-api-key', 'tu_api_key')`."
    );
  }

  // Filtrar los últimos mensajes según la capacidad de contexto definida
  const userAndAssistantMessages = messages.filter(m => m.role !== 'system');
  const recentMessages = userAndAssistantMessages.slice(-config.maxContextMessages);

  // Mapear los mensajes al formato de Gemini
  const contents = await mapMessagesToGemini(recentMessages);

  interface Candidate {
    name: string;
    url: string;
    isV1Fallback: boolean;
  }

  const candidates: Candidate[] = [
    {
      name: 'v1beta / gemini-2.5-flash',
      url: `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      isV1Fallback: false
    },
    {
      name: 'v1beta / gemini-2.5-flash-lite',
      url: `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${apiKey}`,
      isV1Fallback: false
    },
    {
      name: 'v1beta / gemini-1.5-flash',
      url: `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
      isV1Fallback: false
    },
    {
      name: 'v1beta / gemini-2.5-pro',
      url: `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent?key=${apiKey}`,
      isV1Fallback: false
    },
    {
      name: 'v1 / gemini-2.5-flash',
      url: `https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      isV1Fallback: true
    },
    {
      name: 'v1 / gemini-1.5-flash',
      url: `https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
      isV1Fallback: true
    }
  ];

  // Reordenar candidatos según el último exitoso almacenado
  try {
    const lastSuccessful = localStorage.getItem('gemini-last-successful-candidate');
    if (lastSuccessful) {
      const idx = candidates.findIndex(c => c.name === lastSuccessful);
      if (idx > 0) {
        const [matched] = candidates.splice(idx, 1);
        candidates.unshift(matched);
        console.log(`[AI Service] Reordenado: Se probará primero el candidato exitoso anterior: '${lastSuccessful}'`);
      }
    }
  } catch (e) {
    console.warn('[AI Service] No se pudo leer localStorage para el candidato exitoso', e);
  }

  let lastError: any = null;

  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i];
    const startTime = Date.now();
    console.log(`[AI Service] Intentando conexión con candidato: ${candidate.name}...`);

    // Clonar contents para evitar mutar el original en múltiples intentos de forma robusta
    let requestContents;
    try {
      requestContents = JSON.parse(JSON.stringify(contents));
    } catch (e) {
      console.warn("[AI Service] Error al serializar el contenido de mensajes (historial grande). Recortando historial...", e);
      const systemMessage = contents.find(m => m.role === 'system');
      const lastMessages = contents.slice(-3); // Conservar últimos 3 turnos
      const pruned = systemMessage ? [systemMessage, ...lastMessages] : lastMessages;
      requestContents = JSON.parse(JSON.stringify(pruned));
    }

    const requestBody: any = {
      contents: requestContents,
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 8192,
      },
      safetySettings: [
        { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
        { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
        { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
        { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" },
        { category: "HARM_CATEGORY_CIVIC_INTEGRITY", threshold: "BLOCK_NONE" }
      ]
    };

    if (candidate.isV1Fallback) {
      // En la versión v1, el sistema de Google lanza error al enviar systemInstruction o tools en el cuerpo.
      // Simulamos la instrucción del sistema inyectándola directamente en el mensaje de usuario.
      if (systemPrompt && requestContents.length > 0) {
        // Encontrar el primer mensaje de usuario o agregar uno
        const firstUserIndex = requestContents.findIndex((m: any) => m.role === 'user');
        if (firstUserIndex !== -1) {
          const parts = requestContents[firstUserIndex].parts;
          if (parts && parts.length > 0 && typeof parts[0].text === 'string') {
            parts[0].text = `[INSTRUCCIÓN DE SISTEMA: ${systemPrompt}]\n\n${parts[0].text}`;
          }
        }
      }
    } else {
      // Formato v1beta completo con systemInstruction y tools
      if (systemPrompt) {
        requestBody.systemInstruction = {
          parts: [{ text: systemPrompt }]
        };
      }
      if (options?.tools) {
        requestBody.tools = options.tools;
        if (options.toolConfig) {
          requestBody.toolConfig = options.toolConfig;
        }
      }
    }

    const isLite = candidate.name.toLowerCase().includes('lite') || candidate.name.toLowerCase().includes('flash');
    const timeoutMs = isLite ? 15000 : 25000;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    let response: Response;
    let fetchDurationMs = 0;

    try {
      response = await fetch(candidate.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        signal: controller.signal,
        body: JSON.stringify(requestBody)
      });
      clearTimeout(timeoutId);
      fetchDurationMs = Date.now() - startTime;
    } catch (error: any) {
      clearTimeout(timeoutId);
      console.error(`[AI Service] Falló fetch para candidato ${candidate.name}:`, error);

      const durationMs = Date.now() - startTime;
      const errorText = error.name === 'AbortError'
        ? `⏱️ Tiempo de espera agotado. La API de Gemini tardó más de ${timeoutMs / 1000} segundos en responder.`
        : error.message || String(error);

      // Registrar error de red una sola vez
      addAuditLog({
        model: candidate.name,
        url: candidate.url,
        status: error.name === 'AbortError' ? 'Timeout' : 'Error de Conexión',
        durationMs,
        systemPrompt,
        messages,
        error: errorText
      });

      if (error.name === 'AbortError') {
        lastError = new Error(`⏱️ Tiempo de espera agotado. La API de Gemini tardó más de ${timeoutMs / 1000} segundos en responder.`);
      } else {
        lastError = error;
      }

      // Probar siguiente candidato si está disponible
      continue;
    }

    const durationMs = fetchDurationMs;

    // Controlar errores de respuesta HTTP
    if (!response.ok) {
      let errorMessage = `Error HTTP ${response.status}: ${response.statusText}`;
      try {
        const errorData = await response.json();
        if (errorData.error?.message) {
          errorMessage = errorData.error.message;
        }
      } catch (_) {}

      // Registrar error HTTP una sola vez con su estado real
      addAuditLog({
        model: candidate.name,
        url: candidate.url,
        status: response.status,
        durationMs,
        systemPrompt,
        messages,
        error: errorMessage
      });

      const lowerError = errorMessage.toLowerCase();
      const isApiKeyError = 
        response.status === 400 && (lowerError.includes('api key') || lowerError.includes('key not valid') || lowerError.includes('expired'));
      const isExpiredKey =
        response.status === 403 && (lowerError.includes('expired') || lowerError.includes('api key') || lowerError.includes('invalid') || lowerError.includes('forbidden') || lowerError.includes('api_key'));

      if (isApiKeyError || isExpiredKey) {
        throw new Error(`🔑 Error de API Key de Gemini: ${errorMessage}. Por favor, verifica tu clave API en la configuración del agente.`);
      }

      // Comprobar si es un error de modelo no encontrado o de versión no soportada
      const isModelNotFoundError =
        response.status === 404 ||
        lowerError.includes('not found') ||
        lowerError.includes('not supported') ||
        lowerError.includes('modelservice');

      if (isModelNotFoundError && i < candidates.length - 1) {
        console.warn(`[AI Service] Modelo no encontrado en ${candidate.name}. Error: ${errorMessage}. Probando siguiente fallback...`);
        lastError = new Error(`Error en Google AI Studio (${candidate.name}): ${errorMessage}`);
        continue; // Probar el siguiente candidato
      }

      // Errores de cuota (Rate Limit / Quota Exceeded): probamos el siguiente candidato por si es específico de este modelo
      if (response.status === 429) {
        console.warn(`[AI Service] Modelo ${candidate.name} retornó 429 (Cuota/Límite excedido). Probando siguiente candidato...`);
        lastError = new Error(`⚠️ Cuota de API excedida (Rate Limit): ${errorMessage}.`);
        if (i < candidates.length - 1) {
          continue;
        }
        throw lastError;
      }

      lastError = new Error(`Error en Google AI Studio (${candidate.name}): ${errorMessage}`);
      
      if (i < candidates.length - 1) {
        continue;
      }
      throw lastError;
    }

    // Petición exitosa: procesar y validar respuesta
    try {
      const data = await response.json();

      const candidateResponse = data.candidates?.[0];
      if (!candidateResponse) {
        const promptFeedback = data.promptFeedback;
        let blockReason = "";
        if (promptFeedback?.blockReason) {
          blockReason = ` (Bloqueado por: ${promptFeedback.blockReason})`;
        }
        const errStr = `No se recibió respuesta o fue bloqueada por los filtros de seguridad de Google${blockReason}.`;
        addAuditLog({
          model: candidate.name,
          url: candidate.url,
          status: response.status,
          durationMs,
          systemPrompt,
          messages,
          error: errStr
        });
        throw new Error(errStr);
      }

      const finishReason = candidateResponse.finishReason;
      if (finishReason && finishReason !== 'STOP' && finishReason !== 'MAX_TOKENS') {
        const errStr = `La respuesta no finalizó correctamente (Motivo: ${finishReason}).`;
        addAuditLog({
          model: candidate.name,
          url: candidate.url,
          status: response.status,
          durationMs,
          systemPrompt,
          messages,
          error: errStr
        });
        throw new Error(errStr);
      }

      const parts = candidateResponse.content?.parts;
      if (!parts || !Array.isArray(parts) || parts.length === 0) {
        const errStr = `La respuesta recibida no contiene partes legibles (Finish Reason: ${finishReason || 'Desconocido'}).`;
        addAuditLog({
          model: candidate.name,
          url: candidate.url,
          status: response.status,
          durationMs,
          systemPrompt,
          messages,
          error: errStr
        });
        throw new Error(errStr);
      }

      // Guardar el candidato exitoso en localStorage
      try {
        localStorage.setItem('gemini-last-successful-candidate', candidate.name);
      } catch (e) {
        console.warn('[AI Service] No se pudo guardar el candidato exitoso en localStorage', e);
      }

      // Buscar si algún part contiene una llamada a función
      const functionCallPart = parts.find((p: any) => p.functionCall);
      if (functionCallPart) {
        addAuditLog({
          model: candidate.name,
          url: candidate.url,
          status: response.status,
          durationMs,
          systemPrompt,
          messages,
          response: functionCallPart.functionCall
        });
        return functionCallPart.functionCall;
      }

      // Si no hay llamada a función, concatenar todos los textos
      const textResponse = parts
        .filter((p: any) => p.text)
        .map((p: any) => p.text)
        .join('\n')
        .trim();

      addAuditLog({
        model: candidate.name,
        url: candidate.url,
        status: response.status,
        durationMs,
        systemPrompt,
        messages,
        response: textResponse
      });

      return textResponse;
    } catch (parseError: any) {
      console.error(`[AI Service] Error parseando respuesta exitosa de ${candidate.name}:`, parseError);
      lastError = parseError;

      addAuditLog({
        model: candidate.name,
        url: candidate.url,
        status: 'Error de Lectura',
        durationMs,
        systemPrompt,
        messages,
        error: parseError.message || String(parseError)
      });

      if (i < candidates.length - 1) {
        continue;
      }
      throw lastError;
    }
  }

  throw lastError || new Error("Error desconocido al comunicarse con el Agente de Google AI Studio.");
};

export const transcribeAudio = async (
  base64Data: string,
  mimeType: string,
  optionsApiKey?: string
): Promise<string> => {
  const apiKey = getApiKey(optionsApiKey);
  if (!apiKey) {
    throw new Error(
      "🔑 Falta configurar la API Key de Google AI Studio (Gemini).\n\n" +
      "Por favor realiza una de las siguientes opciones:\n" +
      "1. Haz clic en el botón 'Configuración' (icono de engranaje en la barra lateral izquierda) y guarda tu API Key en la sección 'Configuración Agente IA'.\n" +
      "2. Crea un archivo `.env` en la raíz del proyecto y agrega `VITE_GEMINI_API_KEY=tu_api_key`.\n" +
      "3. O ejecuta en la consola de desarrollador: `localStorage.setItem('gemini-api-key', 'tu_api_key')`."
    );
  }

  interface Candidate {
    name: string;
    url: string;
  }

  const candidates: Candidate[] = [
    {
      name: 'v1beta / gemini-3.1-flash-lite',
      url: `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent?key=${apiKey}`,
    },
    {
      name: 'v1beta / gemini-2.5-flash-lite',
      url: `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${apiKey}`,
    },
    {
      name: 'v1beta / gemini-2.5-flash',
      url: `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
    },
    {
      name: 'v1beta / gemini-2.0-flash',
      url: `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
    }
  ];

  // Reordenar candidatos según el último exitoso almacenado
  try {
    const lastSuccessful = localStorage.getItem('gemini-last-successful-candidate');
    if (lastSuccessful) {
      const idx = candidates.findIndex(c => c.name === lastSuccessful);
      if (idx > 0) {
        const [matched] = candidates.splice(idx, 1);
        candidates.unshift(matched);
      }
    }
  } catch (e) {
    console.warn('[Audio Service] No se pudo leer localStorage para el candidato exitoso', e);
  }

  let lastError: any = null;

  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i];
    const startTime = Date.now();
    console.log(`[Audio Service] Intentando transcripción con candidato: ${candidate.name}...`);

    const requestBody = {
      contents: [
        {
          role: 'user',
          parts: [
            {
              inlineData: {
                mimeType,
                data: base64Data
              }
            },
            {
              text: "Transcribe este audio en español. Devuelve únicamente la transcripción literal de lo hablado, sin comentarios, sin formato extra y sin añadir explicaciones adicionales. Si no hay audio legible o está en silencio, responde con un espacio en blanco."
            }
          ]
        }
      ],
      generationConfig: {
        temperature: 0.0,
        maxOutputTokens: 1024,
      }
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);

    try {
      const response = await fetch(candidate.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        signal: controller.signal,
        body: JSON.stringify(requestBody)
      });
      clearTimeout(timeoutId);

      const durationMs = Date.now() - startTime;

      if (!response.ok) {
        let errorMessage = `Error HTTP ${response.status}: ${response.statusText}`;
        try {
          const errorData = await response.json();
          if (errorData.error?.message) {
            errorMessage = errorData.error.message;
          }
        } catch (_) {}

        // Registrar error en log de auditoría
        addAuditLog({
          model: `Transcription / ${candidate.name}`,
          url: candidate.url,
          status: response.status,
          durationMs,
          systemPrompt: "Audio Transcription Prompt",
          messages: [{ role: 'user', content: 'Audio dictado' } as ChatMessage],
          error: errorMessage
        });

        const isModelNotFoundError =
          response.status === 404 ||
          errorMessage.toLowerCase().includes('not found') ||
          errorMessage.toLowerCase().includes('not supported') ||
          errorMessage.toLowerCase().includes('modelservice');

        if (isModelNotFoundError && i < candidates.length - 1) {
          console.warn(`[Audio Service] Modelo no encontrado en ${candidate.name}. Probando siguiente fallback...`);
          lastError = new Error(`Error en Google AI Studio (${candidate.name}): ${errorMessage}`);
          continue;
        }

        lastError = new Error(`Error en Google AI Studio (${candidate.name}): ${errorMessage}`);
        if (i < candidates.length - 1) {
          continue;
        }
        throw lastError;
      }

      const data = await response.json();
      const part = data.candidates?.[0]?.content?.parts?.[0];
      if (!part || !part.text) {
        throw new Error("La respuesta de transcripción no contiene texto.");
      }

      // Guardar el candidato exitoso en localStorage
      try {
        localStorage.setItem('gemini-last-successful-candidate', candidate.name);
      } catch (e) {}

      const transcriptionText = part.text.trim();

      addAuditLog({
        model: `Transcription / ${candidate.name}`,
        url: candidate.url,
        status: response.status,
        durationMs,
        systemPrompt: "Audio Transcription Prompt",
        messages: [{ role: 'user', content: 'Audio dictado' } as ChatMessage],
        response: transcriptionText
      });

      return transcriptionText;
    } catch (error: any) {
      clearTimeout(timeoutId);
      console.error(`[Audio Service] Falló transcripción para candidato ${candidate.name}:`, error);

      const durationMs = Date.now() - startTime;
      const errorText = error.name === 'AbortError'
        ? "⏱️ Tiempo de espera agotado. La API de Gemini tardó más de 30 segundos en transcribir."
        : error.message || String(error);

      addAuditLog({
        model: `Transcription / ${candidate.name}`,
        url: candidate.url,
        status: error.name === 'AbortError' ? 'Timeout' : 'Error de Conexión',
        durationMs,
        systemPrompt: "Audio Transcription Prompt",
        messages: [{ role: 'user', content: 'Audio dictado' } as ChatMessage],
        error: errorText
      });

      lastError = error;
      if (i < candidates.length - 1) {
        continue;
      }
    }
  }

  throw lastError || new Error("Error desconocido al transcribir el audio.");
};

export const analyzeCorrespondencePdf = async (
  base64Data: string,
  fileName: string,
  optionsApiKey?: string
): Promise<{
  date?: string;
  sender?: string;
  receiver?: string;
  subject?: string;
  summary?: string;
  status: 'pending' | 'answered' | 'no_action_needed';
  followUpDeadline?: string;
}> => {
  const apiKey = getApiKey(optionsApiKey);
  if (!apiKey) {
    throw new Error("🔑 Falta configurar la API Key de Gemini.");
  }

  interface Candidate {
    name: string;
    url: string;
  }

  const candidates: Candidate[] = [
    {
      name: 'v1beta / gemini-3.1-flash-lite',
      url: `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent?key=${apiKey}`,
    },
    {
      name: 'v1beta / gemini-2.5-flash-lite',
      url: `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${apiKey}`,
    },
    {
      name: 'v1beta / gemini-2.5-flash',
      url: `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
    }
  ];

  // Reordenar candidatos según el último exitoso almacenado
  try {
    const lastSuccessful = localStorage.getItem('gemini-last-successful-candidate');
    if (lastSuccessful) {
      const idx = candidates.findIndex(c => c.name === lastSuccessful);
      if (idx > 0) {
        const [matched] = candidates.splice(idx, 1);
        candidates.unshift(matched);
      }
    }
  } catch (e) {}

  let lastError: any = null;

  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i];
    const startTime = Date.now();
    console.log(`[PDF Analysis] Intentando análisis con candidato: ${candidate.name}...`);

    try {
      const requestBody = {
        contents: [
          {
            role: 'user',
            parts: [
              {
                inlineData: {
                  mimeType: 'application/pdf',
                  data: base64Data
                }
              },
              {
                text: `Analiza este documento PDF de correspondencia (oficio/comunicación) adjunto.
Extrae la información y responde ÚNICA y EXCLUSIVAMENTE con un objeto JSON válido con las siguientes propiedades:
- date: La fecha oficial de emisión del documento en formato YYYY-MM-DD (si no se encuentra, la fecha actual en la que se sube).
- sender: El nombre del remitente (quién firma o envía el oficio).
- receiver: El nombre del destinatario (a quién va dirigido).
- subject: El asunto del oficio de forma resumida (ej. "Solicitud de ampliación de plazo").
- summary: Un resumen técnico muy concreto del contenido (máximo 2 frases).
- status: El valor debe ser "pending" (si es un oficio que requiere respuesta o acción pendiente de seguimiento) o "no_action_needed" (si es informativo o ya está resuelto).
- followUpDeadline: Fecha límite estimada para hacerle seguimiento en formato YYYY-MM-DD (ej. de 7 a 15 días hábiles después de la fecha del documento).

Ejemplo de salida JSON:
{
  "date": "2026-05-25",
  "sender": "Consorcio Vial 2026",
  "receiver": "LCH Ingeniería S.A.S.",
  "subject": "Presentación de informe mensual de interventoría",
  "summary": "Se hace entrega del informe correspondiente al mes de abril de 2026 para revisión y aprobación.",
  "status": "pending",
  "followUpDeadline": "2026-06-01"
}

No agregues preámbulos, no agregues bloques de código de markdown como \`\`\`json, solo devuelve el objeto JSON directamente.`
              }
            ]
          }
        ],
        generationConfig: {
          temperature: 0.1,
          responseMimeType: "application/json",
          maxOutputTokens: 2048
        }
      };

      const response = await fetch(candidate.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody)
      });

      if (!response.ok) {
        let errMsg = `HTTP ${response.status}`;
        try {
          const errJson = await response.json();
          if (errJson.error?.message) errMsg = errJson.error.message;
        } catch (_) {}
        throw new Error(errMsg);
      }

      const data = await response.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (text !== undefined) {
        try {
          let cleanText = text.trim();
          if (cleanText.startsWith('```')) {
            cleanText = cleanText.replace(/^```json\s*/, '').replace(/```$/, '').trim();
          }
          const parsed = JSON.parse(cleanText);
          return {
            date: parsed.date || new Date().toISOString().split('T')[0],
            sender: parsed.sender || 'Desconocido',
            receiver: parsed.receiver || 'Desconocido',
            subject: parsed.subject || 'Sin Asunto',
            summary: parsed.summary || 'Sin Resumen',
            status: parsed.status === 'pending' || parsed.status === 'answered' || parsed.status === 'no_action_needed' ? parsed.status : 'pending',
            followUpDeadline: parsed.followUpDeadline || undefined
          };
        } catch (jsonErr) {
          console.error("Failed to parse JSON response from Gemini for PDF:", text, jsonErr);
          throw new Error("La respuesta del modelo no tiene formato JSON válido.");
        }
      }
      throw new Error("No se obtuvo respuesta del modelo.");
    } catch (err) {
      console.error(`[PDF Analysis] Failed with ${candidate.name}:`, err);
      lastError = err;
    }
  }

  throw lastError || new Error("Error analizando el PDF.");
};

export interface ExtractedAPUItem {
  itemCode: string;
  materials: { description: string; unit: string; quantity: number; price: number; total: number }[];
  labor: { description: string; unit: string; quantity: number; price: number; total: number }[];
  equipment: { description: string; unit: string; quantity: number; price: number; total: number }[];
  transport: { description: string; unit: string; quantity: number; price: number; total: number }[];
}

export const extractApusFromPdf = async (
  base64Pdf: string,
  contractItemsContext: { item: string; descripcion: string }[],
  optionsApiKey?: string,
  onProgress?: (current: number, total: number) => void
): Promise<ExtractedAPUItem[]> => {
  const apiKey = getApiKey(optionsApiKey);
  if (!apiKey) {
    throw new Error("🔑 Falta configurar la API Key de Gemini.");
  }

  if (!contractItemsContext || contractItemsContext.length === 0) {
    return [];
  }

  // Dividimos en bloques de máximo 8 actividades para evitar exceder el límite de tokens de salida y prevenir JSON truncados
  const chunkSize = 8;
  const chunks: { item: string; descripcion: string }[][] = [];
  for (let i = 0; i < contractItemsContext.length; i += chunkSize) {
    chunks.push(contractItemsContext.slice(i, i + chunkSize));
  }

  const allResults: ExtractedAPUItem[] = [];

  for (let chunkIdx = 0; chunkIdx < chunks.length; chunkIdx++) {
    const currentChunk = chunks[chunkIdx];
    if (onProgress) {
      onProgress(chunkIdx + 1, chunks.length);
    }

    const chunkResults = await executeSingleApuPdfExtraction(base64Pdf, currentChunk, apiKey);
    allResults.push(...chunkResults);
  }

  return allResults;
};

// Función auxiliar para extraer APUs de un bloque específico de actividades
const executeSingleApuPdfExtraction = async (
  base64Pdf: string,
  chunkItems: { item: string; descripcion: string }[],
  apiKey: string
): Promise<ExtractedAPUItem[]> => {
  interface Candidate {
    name: string;
    url: string;
  }

  const candidates: Candidate[] = [
    {
      name: 'v1beta / gemini-3.1-flash-lite',
      url: `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent?key=${apiKey}`,
    },
    {
      name: 'v1beta / gemini-2.5-flash-lite',
      url: `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${apiKey}`,
    },
    {
      name: 'v1beta / gemini-2.5-flash',
      url: `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
    }
  ];

  try {
    const lastSuccessful = localStorage.getItem('gemini-last-successful-candidate');
    if (lastSuccessful) {
      const idx = candidates.findIndex(c => c.name === lastSuccessful);
      if (idx > 0) {
        const [matched] = candidates.splice(idx, 1);
        candidates.unshift(matched);
      }
    }
  } catch (e) {}

  let lastError: any = null;
  const cleanBase64 = base64Pdf.includes(',') ? base64Pdf.split(',')[1] : base64Pdf;

  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i];
    const startTime = Date.now();
    console.log(`[APU PDF Chunk Analysis] Intentando bloque de ${chunkItems.length} actividades con candidato: ${candidate.name}...`);

    try {
      const requestBody = {
        contents: [
          {
            role: 'user',
            parts: [
              {
                inlineData: {
                  mimeType: 'application/pdf',
                  data: cleanBase64
                }
              },
              {
                text: `Analiza este documento PDF que contiene el desglose de Análisis de Precios Unitarios (APU) de obra.
El objetivo es extraer los insumos de cada APU encontrado y asociarlos con una de las actividades del presupuesto del contrato de la obra.

SOLO debes extraer los APUs que correspondan a las siguientes actividades del presupuesto del contrato de la obra (ignora cualquier otra actividad del PDF que no esté en este listado):
${JSON.stringify(chunkItems)}

Por favor, lee el PDF y para cada APU identificado en el documento que coincida con una de estas actividades del contrato, realiza lo siguiente:
1. Encuentra la actividad del contrato que mejor coincida semánticamente con el APU del PDF (basado en descripción o código de ítem).
2. Clasifica sus insumos en cuatro listas: materials, labor, equipment y transport.
3. Para cada insumo, extrae:
   - description: Nombre o descripción clara del insumo.
   - unit: Unidad de medida (ej. Gl, m3, Kg, h, und, bto).
   - quantity: Cantidad o rendimiento necesario por unidad de actividad (debe ser un número).
   - price: Precio unitario del insumo (debe ser un número).
   - total: Costo total del insumo (quantity * price, debe ser un número).

Responde ÚNICA y EXCLUSIVAMENTE con un objeto JSON válido con la siguiente estructura (no incluyas formato markdown \`\`\`json ni preámbulos):
{
  "apus": [
    {
      "itemCode": "Código de la actividad mapeada (ej: NP 01)",
      "materials": [
        {"description": "Cemento gris", "unit": "bto", "quantity": 0.5, "price": 31000, "total": 15500}
      ],
      "labor": [
        {"description": "Oficial de obra", "unit": "h", "quantity": 2.5, "price": 12000, "total": 30000}
      ],
      "equipment": [
        {"description": "Mezcladora", "unit": "h", "quantity": 0.25, "price": 15000, "total": 3750}
      ],
      "transport": [
        {"description": "Volqueta (acarreo)", "unit": "m3-km", "quantity": 1.0, "price": 5000, "total": 5000}
      ]
    }
  ]
}`
              }
            ]
          }
        ],
        generationConfig: {
          temperature: 0.1,
          responseMimeType: "application/json",
          maxOutputTokens: 8192
        }
      };

      const response = await fetch(candidate.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody)
      });

      if (!response.ok) {
        let errMsg = `HTTP ${response.status}`;
        try {
          const errJson = await response.json();
          if (errJson.error?.message) errMsg = errJson.error.message;
        } catch (_) {}
        throw new Error(errMsg);
      }

      const data = await response.json();
      const textResponse = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (textResponse !== undefined) {
        try {
          let cleanText = textResponse.trim();
          if (cleanText.startsWith('```')) {
            cleanText = cleanText.replace(/^```json\s*/, '').replace(/```$/, '').trim();
          }
          const parsed = JSON.parse(cleanText);
          
          if (!parsed.apus || !Array.isArray(parsed.apus)) {
            throw new Error("La respuesta no contiene un arreglo 'apus'.");
          }

          const sanitizeList = (arr: any) => {
            if (!Array.isArray(arr)) return [];
            return arr.map((item: any) => ({
              description: String(item.description || 'Insumo sin nombre'),
              unit: String(item.unit || 'und'),
              quantity: Number(item.quantity ?? 0),
              price: Number(item.price ?? 0),
              total: Number(item.total ?? 0)
            }));
          };

          const resultList = parsed.apus.map((apu: any) => ({
            itemCode: String(apu.itemCode || ''),
            materials: sanitizeList(apu.materials),
            labor: sanitizeList(apu.labor),
            equipment: sanitizeList(apu.equipment),
            transport: sanitizeList(apu.transport)
          }));

          // Guardar candidato exitoso
          try {
            localStorage.setItem('gemini-last-successful-candidate', candidate.name);
          } catch (e) {}

          return resultList;
        } catch (jsonErr) {
          console.error("Failed to parse JSON response from Gemini for APU PDF:", textResponse, jsonErr);
          throw new Error("La respuesta del modelo no tiene formato JSON válido.");
        }
      }
      throw new Error("No se obtuvo respuesta del modelo.");
    } catch (err) {
      console.error(`[APU PDF Extraction Chunk] Failed with ${candidate.name}:`, err);
      lastError = err;
    }
  }

  throw lastError || new Error("Error extrayendo APUs desde el PDF.");
};

