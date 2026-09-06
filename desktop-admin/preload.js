const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('edariDesktop', {
  isDesktop: true,
  lookupEdariMaterial: (code) => ipcRenderer.invoke('lookup-edari-material', code),
  processEdariSync: (options) => ipcRenderer.invoke('process-edari-sync', options || {}),
  getEdariProductImportStatus: () => ipcRenderer.invoke('edari-product-import-status'),
  fetchEdariProductImportBatch: (options) => ipcRenderer.invoke('edari-product-import-batch', options || {}),
  getEdariWarehouseImportStatus: () => ipcRenderer.invoke('edari-warehouse-import-status'),
  fetchEdariWarehouseImportBatch: (options) => ipcRenderer.invoke('edari-warehouse-import-batch', options || {})
});
