const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('edariDesktop', {
  isDesktop: true,
  lookupEdariMaterial: (code) => ipcRenderer.invoke('lookup-edari-material', code),
  processEdariSync: () => ipcRenderer.invoke('process-edari-sync')
});
