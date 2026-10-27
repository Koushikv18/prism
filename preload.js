const { contextBridge, ipcRenderer } = require('electron');
const call = c => (...a) => ipcRenderer.invoke(c, ...a);
contextBridge.exposeInMainWorld('prism', {
  openFolder: call('open-folder'), clone: call('clone'), list: call('list'), read: call('read'),
  write: call('write'), term: call('term'), hasKey: call('has-key'), setKey: call('set-key'), agent: call('agent'), getSettings: call('get-settings'), setSettings: call('set-settings'), models: call('models'),
  onAgent: cb => ipcRenderer.on('agent-event', (_, ev) => cb(ev)),
});
