const { app, BrowserWindow, ipcMain, session, dialog } = require('electron');
app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('disable-gpu-sandbox');
const path = require('path');
const fs = require('fs');
const http = require('http');
const os = require('os');
const { ImapFlow } = require('imapflow');
const isDev = !app.isPackaged;

function getLocalIPs() {
  const ips = [];
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        ips.push(iface.address);
      }
    }
  }
  return ips.length > 0 ? ips : ['127.0.0.1'];
}

let httpServer = null;

// Handler para leer archivos desde el sistema
ipcMain.handle('read-file', async (event, filePath) => {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    console.error("Error reading file", error);
    return null;
  }
});

// Handler para escribir archivos en el sistema
ipcMain.handle('write-file', async (event, filePath, content) => {
  try {
    fs.writeFileSync(filePath, content, 'utf8');
    return true;
  } catch (error) {
    console.error("Error writing file", error);
    return false;
  }
});

// Helpers y manejadores para almacenamiento de oficios en la carpeta del usuario
const getCorrespondenceDir = (projectId) => {
  const dir = path.join(os.homedir(), 'Documents', 'CONTROL_Oficios', projectId);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
};

ipcMain.handle('save-correspondence-file', async (event, projectId, fileName, base64Data) => {
  try {
    const dir = getCorrespondenceDir(projectId);
    const filePath = path.join(dir, fileName);
    const cleanBase64 = base64Data.includes(',') ? base64Data.split(',')[1] : base64Data;
    fs.writeFileSync(filePath, Buffer.from(cleanBase64, 'base64'));
    return filePath;
  } catch (error) {
    console.error("Error saving correspondence file to disk:", error);
    return null;
  }
});

ipcMain.handle('read-correspondence-file', async (event, projectId, fileName) => {
  try {
    const dir = getCorrespondenceDir(projectId);
    const filePath = path.join(dir, fileName);
    if (fs.existsSync(filePath)) {
      const buffer = fs.readFileSync(filePath);
      return `data:application/pdf;base64,${buffer.toString('base64')}`;
    }
    return null;
  } catch (error) {
    console.error("Error reading correspondence file from disk:", error);
    return null;
  }
});

ipcMain.handle('delete-correspondence-file', async (event, projectId, fileName) => {
  try {
    const dir = getCorrespondenceDir(projectId);
    const filePath = path.join(dir, fileName);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      return true;
    }
    return false;
  } catch (error) {
    console.error("Error deleting correspondence file from disk:", error);
    return false;
  }
});

// Helpers y manejadores para almacenamiento de APUs en la carpeta del usuario
const getApuDir = (projectId) => {
  const dir = path.join(os.homedir(), 'Documents', 'CONTROL_APUs', projectId);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
};

ipcMain.handle('save-apu-file', async (event, projectId, fileName, base64Data) => {
  try {
    const dir = getApuDir(projectId);
    const filePath = path.join(dir, fileName);
    const cleanBase64 = base64Data.includes(',') ? base64Data.split(',')[1] : base64Data;
    fs.writeFileSync(filePath, Buffer.from(cleanBase64, 'base64'));
    return filePath;
  } catch (error) {
    console.error("Error saving APU file to disk:", error);
    return null;
  }
});

ipcMain.handle('read-apu-file', async (event, projectId, fileName) => {
  try {
    const dir = getApuDir(projectId);
    const filePath = path.join(dir, fileName);
    if (fs.existsSync(filePath)) {
      const buffer = fs.readFileSync(filePath);
      return `data:application/pdf;base64,${buffer.toString('base64')}`;
    }
    return null;
  } catch (error) {
    console.error("Error reading APU file from disk:", error);
    return null;
  }
});

ipcMain.handle('delete-apu-file', async (event, projectId, fileName) => {
  try {
    const dir = getApuDir(projectId);
    const filePath = path.join(dir, fileName);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      return true;
    }
    return false;
  } catch (error) {
    console.error("Error deleting APU file from disk:", error);
    return false;
  }
});

// Helpers y manejadores para almacenamiento de Habilidades (Skills) en la carpeta del usuario
const DEFAULT_SKILLS = {
  generate_executive_report: `# Habilidad: Generación de Informe Ejecutivo (generate_executive_report)

Esta habilidad permite al Agente IA consolidar un informe ejecutivo detallado a una fecha de corte específica. El informe incluye el análisis del estado del proyecto, resumen de avance físico y financiero, AIU, curvas S de progreso en formato gráfico y el seguimiento detallado de actividades atrasadas.

## Reglas de Trabajo e Instrucciones

1. **Formato Único de Exportación (CRÍTICO):**
   - Los informes ejecutivos de estado de obra se generarán **EXCLUSIVAMENTE en formato Microsoft Word** (\`format: \"word\"\`).
   - Queda prohibido generarlo en formato Excel o cualquier otro formato a menos que el usuario lo solicite explícitamente por chat.

2. **Título del Informe:**
   - Debe encabezarse estrictamente como: \`INFORME EJECUTIVO A CORTE DE LA FECHA [FECHA_DE_CORTE]\` de acuerdo a la fecha indicada por el usuario (o la fecha del último avance si no se especifica).

3. **Ubicación y Consulta de Datos del Proyecto (Obligatorio):**
   - Para realizar el análisis de obra y generar el reporte, debes leer y basarte en las siguientes bases de datos inyectadas en tu instrucción de sistema:
     - **Presupuesto y Programación:** Consulta la sección \`ESTRUCTURA COMPLETA DEL PRESUPUESTO Y CRONOGRAMA\` para conocer todos los códigos de ítems, descripciones, unidades, cantidades y fechas contractuales programadas (Inicio y Fin).
     - **Avance Físico Ejecutado:** Consulta la sección \`HISTÓRICO DE REPORTES DE PROGRESO DE OBRA\`. Busca el reporte de progreso más reciente (por fecha de corte) para extraer las cantidades acumuladas ejecutadas reales de cada actividad (\`accumulatedQuantity\`).
     - **Avance Financiero (Actas):** Consulta la sección \`HISTÓRICO DE ACTAS DE COBRO / REPORTES PARCIALES\` para evaluar el valor acumulado cobrado al cliente.
     - **Porcentajes de AIU:** Consulta la sección \`INFORMACIÓN COMPLETA DEL PROYECTO ACTIVO\` para obtener los porcentajes de Administración, Imprevistos y Utilidad configurados para el proyecto.

4. **Instrucciones de Ejecución de la Herramienta (export_report_data):**
   - Debes llamar obligatoriamente a la herramienta \`export_report_data\`.
   - **Parámetro format:** Debe ser estrictamente \`\"word\"\`.
   - **Parámetro title:** Debe contener estrictamente la frase \`\"Informe Ejecutivo de Estado de Obra - [Nombre del Proyecto]\"\`.
   - **Parámetro summary:** Aquí debes escribir la redacción de tu análisis técnico (Resumen Ejecutivo) en prosa. Debes evaluar:
     - El porcentaje real de ejecución física de la obra frente al programado teórico (indicando si el proyecto va adelantado o atrasado).
     - Las causas técnicas de los atrasos si existen (cruzando los comentarios de las fotos o correspondencia).
     - El estado financiero (actas de cobro vs. avance físico).
     - Las recomendaciones de ingeniería para el contratista.
   - **Parámetro tableData:** Pasa un arreglo vacío \`[]\`. El motor de exportación de Word de la aplicación interceptará el llamado y construirá de forma automática y completa:
     - La tabla completa con **todos** los ítems del presupuesto contractual.
     - Las cantidades ejecutadas acumuladas y el porcentaje de avance de cada actividad de acuerdo con la base de datos de la aplicación.
     - Las sumatorias de Costo Directo, los cálculos de AIU y el Total General del contrato.
     - Los **Gráficos de Curva S vectoriales** (Física y Financiera) de ancho completo.
     - La tabla de **Seguimiento a la Programación** identificando de forma automática las actividades atrasadas frente al cronograma.`,

  export_report_data: `# Habilidad: Exportación Tabular de Reportes (export_report_data)

Esta habilidad permite al Agente IA generar y exportar reportes de interventoría física y financiera de las actividades del proyecto en formatos Word (.doc) y Excel (.xlsx).

## Reglas de Trabajo e Instrucciones
1. **Consistencia de Datos:** Toda exportación tabular debe utilizar los datos del presupuesto activo y los reportes acumulados de avance físico y financiero.
2. **Formato:** Los reportes de Excel deben presentar la estructura de capítulos y subcapítulos con su sangría y jerarquía visual.
3. **Moneda:** Los valores financieros deben formatearse en pesos colombianos (COP).
4. **Resumen de Avance:** Siempre debe incluirse una fila de totales generales del proyecto calculando el avance ponderado real vs. programado.`,

  generate_photo_report: `# Habilidad: Generación de Informes Fotográficos (generate_photo_report)

Esta habilidad permite filtrar, ordenar y exportar las fotos de avance de obra (evidencias de campo) a documentos de reporte Word (.doc) o a un archivo comprimido (.zip) con su respectiva información técnica.

## Reglas de Trabajo e Instrucciones
1. **Filtros de Fecha:** Si el usuario solicita un reporte de fotos para un período específico, se deben filtrar estrictamente los registros cuya fecha se encuentre en ese rango.
2. **Asociación de Ítems:** Cada foto debe estar vinculada a su código de ítem presupuestal correspondiente (ej: 1.2.1). Si no tiene ítem, se categoriza como "General" o "S/N".
3. **Ordenamiento:** Las fotos deben ordenarse cronológicamente de forma ascendente para mostrar el avance de la obra secuencialmente.
4. **Nombres de Archivos:** Las imágenes deben nombrarse siguiendo el patrón \`fecha_item_fotoNumero.ext\` y acompañarse de un archivo \`.txt\` con su descripción para reportes comprimidos.`,

  generate_progress_report: `# Habilidad: Registro e Informe de Avances (generate_progress_report)

Esta habilidad permite calcular cantidades acumuladas de obra y generar reportes periódicos (semanales o mensuales) basados en las descripciones de avance técnico ingresadas por el usuario.

## Reglas de Trabajo e Instrucciones
1. **Cálculo de Acumulados:** La cantidad acumulada de una actividad es la suma de la cantidad del reporte anterior más la cantidad ejecutada en el período actual.
2. **Límites de Cantidad:** La cantidad acumulada no debe exceder la cantidad total contratada/presupuestada a menos que exista un adicional aprobado.
3. **Validación de Fechas:** Las fechas de los reportes de avance deben ser consecutivas y no solaparse con períodos anteriores.`,

  add_todo: `# Habilidad: Gestión de Pendientes - Creación (add_todo)

Esta habilidad permite al Agente IA detectar compromisos, tareas y pendientes pendientes durante el análisis o chat con el usuario, redactarlos de forma técnica y agregarlos al archivo físico \`PENDIENTES.md\`.

## Reglas de Trabajo e Instrucciones
1. **Redacción Técnica:** Las tareas deben ser claras, indicar el responsable si se conoce y usar verbos de acción (ej: "Verificar vaciado de losa", "Revisar correspondencia de interventoría").
2. **Priorización:** Clasificar la tarea según su criticidad en el avance de la obra (Alta, Media, Baja).
3. **Estructura en PENDIENTES.md:** Cada pendiente debe insertarse con formato de lista de verificación (\`- [ ]\`) bajo el capítulo del proyecto correspondiente.`,

  delete_todo: `# Habilidad: Gestión de Pendientes - Cierre (delete_todo)

Esta habilidad permite al Agente IA marcar tareas pendientes como completadas (\`- [x]\`) o eliminarlas físicamente de \`PENDIENTES.md\` una vez que el usuario confirme verbalmente su finalización.

## Reglas de Trabajo e Instrucciones
1. **Verificación Conversacional:** Antes de cerrar o eliminar una tarea, se debe comprobar que el usuario explícitamente confirme que el trabajo asociado ha sido terminado o descartado.
2. **Preservar Historial:** Se prefiere marcar las tareas como completadas (\`[x]\`) en lugar de eliminarlas físicamente para mantener la trazabilidad, a menos que el usuario solicite borrarla.
3. **Actualización:** Registrar la fecha de cierre de la tarea en la misma línea del pendiente.`,

  generate_new_budget: `# Habilidad: Generar Nuevo Presupuesto (generate_new_budget)

Esta habilidad permite al Agente IA analizar un archivo Excel cargado que contiene modificaciones del presupuesto (adicionales, variaciones de cantidades o precios) y estructurar un nuevo presupuesto o escenario comparativo.

## Reglas de Trabajo e Instrucciones

1. **Acción Principal (Crear Nueva Versión):**
   - El agente debe tomar el presupuesto activo del proyecto como base (presupuesto anterior).
   - Debe proponer la creación de un nuevo escenario o versión del presupuesto usando la herramienta o indicando los cambios para que se guarde como una nueva versión en la aplicación.

2. **Comparación e Incorporación de Datos (Columnas a la Derecha):**
   - El nuevo presupuesto debe mantener la estructura del presupuesto anterior, pero agregar columnas de comparación para el análisis técnico:
     - **Presupuesto Anterior (LCH Base):** Cantidad, Precio Unitario, Valor Total.
     - **Presupuesto Modificado (Nuevos datos):** Nuevas Cantidades, Nuevos Precios Unitarios, Nuevos Valores Totales.
     - **Diferencia / Variación:** Variación de Cantidad, Variación de Precio, Desviación de Valor Total.
   - Debe identificar claramente:
     - **Ítems Adicionales:** Nuevas actividades que no existían en el presupuesto contractual anterior.
     - **Ítems con Aumento/Disminución de Cantidad:** Actividades con variación en volumen de obra.
     - **Ítems con Variación de Precio:** Actividades con costos unitarios diferentes.

3. **Cálculo y Presentación Visual:**
   - Realizar las sumas de costo directo para ambos escenarios (anterior y modificado), calcular el AIU correspondiente y contrastar el valor total de contrato resultante.
   - Presentar el reporte comparativo en formato de tabla Markdown limpia siguiendo la paleta de colores de LCH Ingeniería (texto negro, títulos gris oscuro, cabeceras gris claro, sin amarillos/dorados).`
};

const getSkillsDir = (projectId) => {
  const dir = path.join(os.homedir(), 'Documents', 'CONTROL_Skills', projectId);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
};

ipcMain.handle('read-skill-file', async (event, projectId, skillName) => {
  try {
    const dir = getSkillsDir(projectId);
    const filePath = path.join(dir, `${skillName}.md`);
    if (fs.existsSync(filePath)) {
      return fs.readFileSync(filePath, 'utf8');
    }
    const defaultContent = DEFAULT_SKILLS[skillName] || `# Habilidad: ${skillName}\n\nDescripción por defecto.`;
    fs.writeFileSync(filePath, defaultContent, 'utf8');
    return defaultContent;
  } catch (error) {
    console.error("Error reading/initializing skill file:", error);
    return null;
  }
});

ipcMain.handle('save-skill-file', async (event, projectId, skillName, content) => {
  try {
    const dir = getSkillsDir(projectId);
    const filePath = path.join(dir, `${skillName}.md`);
    fs.writeFileSync(filePath, content, 'utf8');
    return true;
  } catch (error) {
    console.error("Error saving skill file:", error);
    return false;
  }
});

ipcMain.handle('start-sync-server', async (event) => {
  if (httpServer) {
    return { ips: getLocalIPs(), port: httpServer.address().port };
  }

  return new Promise((resolve) => {
    httpServer = http.createServer((req, res) => {
      // CORS Headers
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }

      if (req.url === '/api/sync-start' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
          try {
            const data = JSON.parse(body);
            if (mainWindow) {
              mainWindow.webContents.send('wifi-sync-start', data);
            }
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: 'ok' }));
          } catch(e) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: e.message }));
          }
        });
      } else if (req.url === '/api/sync-photo' && req.method === 'POST') {
        let body = '';
        // Aumentar los límites de buffers implícitamente al procesar por chunks
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
          try {
            const data = JSON.parse(body);
            if (mainWindow) {
              mainWindow.webContents.send('wifi-sync-photo', data);
            }
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: 'ok', id: data.id }));
          } catch(e) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: e.message }));
          }
        });
      } else if (req.url === '/api/sync-end' && req.method === 'POST') {
        if (mainWindow) {
          mainWindow.webContents.send('wifi-sync-end');
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok' }));
      } else if (req.url === '/api/ping' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', app: 'Antigravity CONTROL' }));
      } else {
        res.writeHead(404);
        res.end();
      }
    });

    const PORT = 8383;
    httpServer.listen(PORT, '0.0.0.0', () => {
      console.log(`WiFi Sync Server running on port ${PORT}`);
      resolve({ ips: getLocalIPs(), port: PORT });
    });

    httpServer.on('error', (err) => {
      console.error("HTTP sync server error", err);
      resolve({ error: err.message });
    });
  });
});

ipcMain.handle('stop-sync-server', async () => {
  if (httpServer) {
    httpServer.close();
    httpServer = null;
    return true;
  }
  return false;
});

// Diálogo nativo para ABRIR archivos .lch
ipcMain.handle('open-lch-dialog', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Abrir Proyecto CONTROL',
    filters: [
      { name: 'Proyecto CONTROL', extensions: ['lch'] },
      { name: 'Todos los archivos', extensions: ['*'] }
    ],
    properties: ['openFile']
  });

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  const filePath = result.filePaths[0];
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    return { filePath, content };
  } catch (error) {
    console.error('Error reading .lch file:', error);
    return null;
  }
});

// Diálogo nativo para GUARDAR archivos .lch
ipcMain.handle('save-lch-dialog', async (event, suggestedName, content) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Guardar Proyecto CONTROL',
    defaultPath: suggestedName || 'proyecto.lch',
    filters: [
      { name: 'Proyecto CONTROL', extensions: ['lch'] },
      { name: 'Todos los archivos', extensions: ['*'] }
    ]
  });

  if (result.canceled || !result.filePath) {
    return null;
  }

  try {
    fs.writeFileSync(result.filePath, content, 'utf8');
    return result.filePath;
  } catch (error) {
    console.error('Error saving .lch file:', error);
    return null;
  }
});

// Handler para conectar a Gmail e importar correos por IMAP
function countAttachments(node) {
  if (!node) return 0;
  let count = 0;
  if (node.disposition === 'attachment') {
    count = 1;
  }
  if (node.childNodes && Array.isArray(node.childNodes)) {
    for (const child of node.childNodes) {
      count += countAttachments(child);
    }
  }
  return count;
}

ipcMain.handle('fetch-gmail-emails', async (event, { email, appPassword, dateFrom, dateTo }) => {
  console.log(`[IMAP] Sincronizando Gmail para: ${email} en rango ${dateFrom} - ${dateTo}`);
  const client = new ImapFlow({
    host: 'imap.gmail.com',
    port: 993,
    secure: true,
    auth: {
      user: email,
      pass: appPassword
    },
    logger: false
  });

  try {
    try {
      await client.connect();
    } catch (connectErr) {
      throw new Error(`Fallo de conexión o autenticación. Verifique que el correo de Gmail y la Contraseña de Aplicación de 16 caracteres sean correctos, y que la opción de acceso IMAP esté activa en la configuración de su cuenta de Gmail. (Detalle: ${connectErr.message})`);
    }
    const emails = [];

    // 1. Buscar en Bandeja de Entrada (INBOX)
    let lock;
    try {
      lock = await client.getMailboxLock('INBOX');
    } catch (inboxErr) {
      throw new Error(`Error al acceder a la bandeja de entrada (INBOX): ${inboxErr.message}`);
    }
    try {
      const searchCriteria = {};
      if (dateFrom) {
        searchCriteria.since = new Date(dateFrom);
      }
      if (dateTo) {
        const beforeDate = new Date(dateTo);
        beforeDate.setDate(beforeDate.getDate() + 1);
        searchCriteria.before = beforeDate;
      }
      if (!dateFrom && !dateTo) {
        const oneMonthAgo = new Date();
        oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);
        searchCriteria.since = oneMonthAgo;
      }

      const inboxMessages = await client.search(searchCriteria);
      console.log(`[IMAP] Encontrados ${inboxMessages.length} correos en INBOX`);

      for (const seq of inboxMessages) {
        try {
          const msg = await client.fetchOne(seq, { envelope: true, bodyStructure: true });
          if (msg && msg.envelope) {
            const dateStr = msg.envelope.date ? msg.envelope.date.toISOString().split('T')[0] : new Date().toISOString().split('T')[0];
            const dateTimeStr = msg.envelope.date ? msg.envelope.date.toISOString() : new Date().toISOString();
            
            const senderName = msg.envelope.from?.[0]?.name || '';
            const senderAddr = msg.envelope.from?.[0]?.address || '';
            const sender = senderName ? `${senderName} <${senderAddr}>` : senderAddr;

            const receiverName = msg.envelope.to?.[0]?.name || '';
            const receiverAddr = msg.envelope.to?.[0]?.address || '';
            const receiver = receiverName ? `${receiverName} <${receiverAddr}>` : receiverAddr;

            const attachmentsCount = msg.bodyStructure ? countAttachments(msg.bodyStructure) : 0;

            emails.push({
              id: `gmail-in-${msg.uid || seq}-${msg.envelope.messageId ? msg.envelope.messageId.replace(/[^a-zA-Z0-9]/g, '') : Date.now()}`,
              date: dateStr,
              dateTime: dateTimeStr,
              direction: 'inbound',
              sender: sender || 'Desconocido',
              receiver: receiver || email,
              subject: msg.envelope.subject || 'Sin Asunto',
              bodySnippet: '',
              category: 'general',
              attachmentsCount: attachmentsCount
            });
          }
        } catch (fetchErr) {
          console.error(`[IMAP] Error fetching INBOX message seq ${seq}:`, fetchErr);
        }
      }
    } finally {
      lock.release();
    }

    // 2. Buscar en Bandeja de Enviados
    const list = await client.list();
    let sentMailboxName = null;
    for (const box of list) {
      const boxPath = box.path || box.name;
      if (!boxPath) continue;
      const pathLower = boxPath.toLowerCase();
      if (box.specialUse === '\\Sent' || pathLower.includes('enviados') || pathLower.includes('sent')) {
        sentMailboxName = boxPath;
        break;
      }
    }

    if (sentMailboxName) {
      console.log(`[IMAP] Accediendo a la bandeja de enviados: "${sentMailboxName}"`);
      let sentLock;
      try {
        sentLock = await client.getMailboxLock(sentMailboxName);
      } catch (sentErr) {
        throw new Error(`Error al acceder a la bandeja de enviados (${sentMailboxName}): ${sentErr.message}`);
      }
      try {
        const searchCriteria = {};
        if (dateFrom) {
          searchCriteria.since = new Date(dateFrom);
        }
        if (dateTo) {
          const beforeDate = new Date(dateTo);
          beforeDate.setDate(beforeDate.getDate() + 1);
          searchCriteria.before = beforeDate;
        }
        if (!dateFrom && !dateTo) {
          const oneMonthAgo = new Date();
          oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);
          searchCriteria.since = oneMonthAgo;
        }

        const sentMessages = await client.search(searchCriteria);
        console.log(`[IMAP] Encontrados ${sentMessages.length} correos en Enviados`);

        for (const seq of sentMessages) {
          try {
            const msg = await client.fetchOne(seq, { envelope: true, bodyStructure: true });
            if (msg && msg.envelope) {
              const dateStr = msg.envelope.date ? msg.envelope.date.toISOString().split('T')[0] : new Date().toISOString().split('T')[0];
              const dateTimeStr = msg.envelope.date ? msg.envelope.date.toISOString() : new Date().toISOString();

              const senderName = msg.envelope.from?.[0]?.name || '';
              const senderAddr = msg.envelope.from?.[0]?.address || '';
              const sender = senderName ? `${senderName} <${senderAddr}>` : senderAddr;

              const receiverName = msg.envelope.to?.[0]?.name || '';
              const receiverAddr = msg.envelope.to?.[0]?.address || '';
              const receiver = receiverName ? `${receiverName} <${receiverAddr}>` : receiverAddr;

              const attachmentsCount = msg.bodyStructure ? countAttachments(msg.bodyStructure) : 0;

              emails.push({
                id: `gmail-out-${msg.uid || seq}-${msg.envelope.messageId ? msg.envelope.messageId.replace(/[^a-zA-Z0-9]/g, '') : Date.now()}`,
                date: dateStr,
                dateTime: dateTimeStr,
                direction: 'outbound',
                sender: sender || email,
                receiver: receiver || 'Desconocido',
                subject: msg.envelope.subject || 'Sin Asunto',
                bodySnippet: '',
                category: 'general',
                attachmentsCount: attachmentsCount
              });
            }
          } catch (fetchErr) {
            console.error(`[IMAP] Error fetching Sent message seq ${seq}:`, fetchErr);
          }
        }
      } finally {
        sentLock.release();
      }
    } else {
      console.warn("[IMAP] No se pudo encontrar una bandeja con atributo de Enviados.");
    }

    await client.logout();

    // Ordenar correos cronológicamente descendente
    emails.sort((a, b) => b.dateTime.localeCompare(a.dateTime));

    return { success: true, emails };

  } catch (err) {
    console.error("[IMAP] Error general durante la sincronización:", err);
    try {
      await client.logout();
    } catch (_) {}
    return { success: false, error: err.message || String(err) };
  }
});

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1000,
    minHeight: 700,
    title: "Antigravity CONTROL",
    icon: (() => {
      const devPath = path.join(__dirname, '../public/control_app_icon.ico');
      const prodPath = path.join(__dirname, '../dist/control_app_icon.ico');
      const devPng = path.join(__dirname, '../public/control_app_icon.png');
      const prodPng = path.join(__dirname, '../dist/control_app_icon.png');
      const devFallback = path.join(__dirname, '../public/icon.png');
      const prodFallback = path.join(__dirname, '../dist/icon.png');
      if (isDev) {
        if (fs.existsSync(devPath)) return devPath;
        if (fs.existsSync(devPng)) return devPng;
        return devFallback;
      } else {
        if (fs.existsSync(prodPath)) return prodPath;
        if (fs.existsSync(prodPng)) return prodPng;
        return prodFallback;
      }
    })(),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.cjs')
    },
    // backgroundColor: '#0a0a0a',
    show: false
  });

  // Quitar la barra de menú predeterminada
  mainWindow.setMenuBarVisibility(false);

  // Configurar permisos automáticos para el micrófono
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    if (permission === 'media') {
      return callback(true);
    }
    callback(false);
  });

  session.defaultSession.setPermissionCheckHandler((webContents, permission, origin) => {
    if (permission === 'media') {
      return true;
    }
    return false;
  });

  const startURL = isDev 
    ? 'http://localhost:5173' 
    : `file://${path.join(__dirname, '../dist/index.html')}`;

  mainWindow.loadURL(startURL);

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    if (isDev) {
      mainWindow.webContents.openDevTools();
    }
    
    // Si se abrió con un archivo .lch (Windows)
    // IMPORTANTE: delay de 1000ms para que React monte y registre el listener onOpenFile
    const filePath = process.argv.find(arg => arg.endsWith('.lch'));
    if (filePath) {
      setTimeout(() => {
        mainWindow.webContents.send('open-file', filePath);
      }, 1000);
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// Manejar apertura de archivos cuando la app ya está abierta (Windows)
app.on('second-instance', (event, commandLine, workingDirectory) => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
    
    const filePath = commandLine.find(arg => arg.endsWith('.lch'));
    if (filePath) {
      // Pequeño delay para que React esté listo
      setTimeout(() => {
        mainWindow.webContents.send('open-file', filePath);
      }, 300);
    }
  }
});

// Registrar asociación de archivos en Windows (para desarrollo)
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('ready', createWindow);
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  }
});
