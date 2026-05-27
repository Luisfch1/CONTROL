const { app, BrowserWindow, ipcMain, session, dialog } = require('electron');
app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('disable-gpu-sandbox');
const path = require('path');
const fs = require('fs');
const http = require('http');
const os = require('os');
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
