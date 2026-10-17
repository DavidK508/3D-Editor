const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  openProject: () => ipcRenderer.invoke('dialog:open'),
  saveProject: (content, defaultName, filters) =>
    ipcRenderer.invoke('dialog:save', { content, defaultName, filters }),
  saveBuffer: (buffer, defaultName, filters) =>
    ipcRenderer.invoke('dialog:save-buffer', { buffer, defaultName, filters }),
  onMenuAction: (callback) => {
    ipcRenderer.on('menu-action', (_event, action) => callback(action));
  },
});
