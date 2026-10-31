const { contextBridge, ipcRenderer } = require('electron');
const call = c => (...a) => ipcRenderer.invoke(c, ...a);

const api = {
  openFolder: call('open-folder'),
  openPath: call('open-path'),
  getRecents: call('get-recents'),
  clearRecents: call('clear-recents'),
  clone: call('clone'),
  list: call('list'),
  read: call('read'),
  write: call('write'),
  term: call('term'),
  hasKey: call('has-key'),
  setKey: call('set-key'),
  agent: call('agent'),
  stopAgent: call('agent-stop'),
  getSettings: call('get-settings'),
  setSettings: call('set-settings'),
  models: call('models'),
  inlineEdit: call('inline-edit'),
  complete: call('complete'),
  radar: call('radar'),

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
  deletePath: rel => ipcRenderer.invoke('delete-path', rel),
  termRun: (id, cmd) => ipcRenderer.invoke('term-run', id, cmd),
  termKill: id => ipcRenderer.invoke('term-kill', id),
  termStdin: (id, d) => ipcRenderer.invoke('term-stdin', id, d),
  termReset: () => ipcRenderer.invoke('term-reset'),
  onTermData: cb => ipcRenderer.on('term-data', (_, d) => cb(d)),
  onTermExit: cb => ipcRenderer.on('term-exit', (_, d) => cb(d)),
  onAgent: cb => ipcRenderer.on('agent-event', (_, ev) => cb(ev)),
  onAgentEvent: cb => ipcRenderer.on('agent-event', (_, ev) => cb(ev)),
};

contextBridge.exposeInMainWorld('prism', api);
