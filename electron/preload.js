const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('tss', {
  host: (opts) => ipcRenderer.invoke('host-session', opts),
  join: (opts) => ipcRenderer.invoke('join-session', opts),
  leave: () => ipcRenderer.invoke('leave-session'),
  focusMain: () => ipcRenderer.invoke('focus-main'),
  checkUpdates: () => ipcRenderer.invoke('check-updates'),
  downloadUpdate: (url) => ipcRenderer.invoke('download-update', url),
  onUpdateProgress: (cb) => ipcRenderer.on('update-progress', (_e, p) => cb(p)),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  getConfig: () => ipcRenderer.invoke('get-config'),
  setConfig: (obj) => ipcRenderer.invoke('set-config', obj),
  listApps: () => ipcRenderer.invoke('list-apps'),
  axStatus: () => ipcRenderer.invoke('ax-status'),
  axPrompt: () => ipcRenderer.invoke('ax-prompt'),
  openAccessibility: () => ipcRenderer.invoke('open-accessibility'),
  exportSettings: () => ipcRenderer.invoke('export-settings'),
  importSettings: () => ipcRenderer.invoke('import-settings'),
  listSessions: () => ipcRenderer.invoke('list-sessions'),
});
