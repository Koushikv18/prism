const { contextBridge, ipcRenderer } = require('electron');
const call = c => (...a) => ipcRenderer.invoke(c, ...a);

const api = {
  openFolder: call('open-folder'),
  clone: call('clone'),
  list: call('list'),
  read: call('read'),
  write: call('write'),
  term: call('term'),
  hasKey: call('has-key'),
  setKey: call('set-key'),
  agent: call('agent'),
  getSettings: call('get-settings'),
  setSettings: call('set-settings'),
  models: call('models'),

  // Ollama Orchestration
  checkOllama: call('ollama:health'),
  startOllama: call('ollama:start'),
  installOllama: call('ollama:install'),
  pullModel: call('ollama:pull'),
  onInstallLog: cb => {
    const fn = (_, log) => cb(log);
    ipcRenderer.on('ollama:install-log', fn);
    return () => ipcRenderer.removeListener('ollama:install-log', fn);
  },
  onAgent: cb => ipcRenderer.on('agent-event', (_, ev) => cb(ev)),
  onAgentEvent: cb => ipcRenderer.on('agent-event', (_, ev) => cb(ev)),
};

contextBridge.exposeInMainWorld('prism', api);
