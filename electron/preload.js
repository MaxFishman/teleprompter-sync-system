const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('tss', {
  host: (opts) => ipcRenderer.invoke('host-session', opts),
  join: (opts) => ipcRenderer.invoke('join-session', opts),
  leave: () => ipcRenderer.invoke('leave-session'),
  focusMain: () => ipcRenderer.invoke('focus-main'),
});
