const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  // Invoke methods
  startBatch: (config) => ipcRenderer.invoke('start-batch', config),
  getBatchStatus: (batchId) => ipcRenderer.invoke('get-batch-status', batchId),
  getRecentBatches: (limit) => ipcRenderer.invoke('get-recent-batches', limit),
  getDashboardData: () => ipcRenderer.invoke('get-dashboard-data'),
  getPerformanceStats: (days) => ipcRenderer.invoke('get-performance-stats', days),
  getMetrics: (params) => ipcRenderer.invoke('get-metrics', params),
  selectFile: () => ipcRenderer.invoke('select-file'),
  testApiConnection: () => ipcRenderer.invoke('test-api-connection'),
  openConnectionSettings: () => ipcRenderer.invoke('open-connection-settings'),
  getConnectionSettings: () => ipcRenderer.invoke('get-connection-settings'),
  saveConnectionSettings: (settings) => ipcRenderer.invoke('save-connection-settings', settings),
  testConnectionWithSettings: (settings) => ipcRenderer.invoke('test-connection-with-settings', settings),

  // Event listeners
  onBatchStarted: (callback) => ipcRenderer.on('batch-started', callback),
  onUploadingFile: (callback) => ipcRenderer.on('uploading-file', callback),
  onFileUploaded: (callback) => ipcRenderer.on('file-uploaded', callback),
  onChunkStarted: (callback) => ipcRenderer.on('chunk-started', callback),
  onChunkCompleted: (callback) => ipcRenderer.on('chunk-completed', callback),
  onFaxSubmitted: (callback) => ipcRenderer.on('fax-submitted', callback),
  onFaxFailed: (callback) => ipcRenderer.on('fax-failed', callback),
  onFaxCompleted: (callback) => ipcRenderer.on('fax-completed', callback),
  onBatchCompleted: (callback) => ipcRenderer.on('batch-completed', callback),
  onBatchFailed: (callback) => ipcRenderer.on('batch-failed', callback),
  onBatchError: (callback) => ipcRenderer.on('batch-error', callback),

  // Platform detection
  isElectron: true
});
