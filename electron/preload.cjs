const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  onOpenFile: (callback) => {
    // Eliminar listeners anteriores antes de registrar uno nuevo (evita acumulación)
    ipcRenderer.removeAllListeners('open-file');
    ipcRenderer.on('open-file', (event, filePath) => callback(filePath));
  },
  readFile: (filePath) => ipcRenderer.invoke('read-file', filePath),
  writeFile: (filePath, content) => ipcRenderer.invoke('write-file', filePath, content),
  // Diálogos nativos para archivos .lch (reemplazan showOpenFilePicker en Electron)
  openLchDialog: () => ipcRenderer.invoke('open-lch-dialog'),
  saveLchDialog: (suggestedName, content) => ipcRenderer.invoke('save-lch-dialog', suggestedName, content),
  saveCorrespondenceFile: (projectId, fileName, content) => ipcRenderer.invoke('save-correspondence-file', projectId, fileName, content),
  readCorrespondenceFile: (projectId, fileName) => ipcRenderer.invoke('read-correspondence-file', projectId, fileName),
  deleteCorrespondenceFile: (projectId, fileName) => ipcRenderer.invoke('delete-correspondence-file', projectId, fileName),
  saveApuFile: (projectId, fileName, content) => ipcRenderer.invoke('save-apu-file', projectId, fileName, content),
  readApuFile: (projectId, fileName) => ipcRenderer.invoke('read-apu-file', projectId, fileName),
  deleteApuFile: (projectId, fileName) => ipcRenderer.invoke('delete-apu-file', projectId, fileName),
  startSyncServer: () => ipcRenderer.invoke('start-sync-server'),
  stopSyncServer: () => ipcRenderer.invoke('stop-sync-server'),
  onWifiSyncStart: (callback) => ipcRenderer.on('wifi-sync-start', (event, data) => callback(data)),
  onWifiSyncPhoto: (callback) => ipcRenderer.on('wifi-sync-photo', (event, data) => callback(data)),
  onWifiSyncEnd: (callback) => ipcRenderer.on('wifi-sync-end', (event) => callback())
});
