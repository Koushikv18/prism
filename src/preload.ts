import { contextBridge, ipcRenderer } from 'electron';

export interface OllamaHealth {
  online: boolean;
  models: string[];
  host: string;
}

export interface AntigravityAPI {
  // Ollama
  checkOllama: () => Promise<OllamaHealth>;
  startOllama: () => Promise<{ success: boolean; message: string }>;
  installOllama: () => Promise<{ success: boolean; error?: string }>;
  pullModel: (name: string) => Promise<{ success: boolean; error?: string }>;
  getModels: () => Promise<string[]>;
  onInstallLog: (callback: (log: string) => void) => () => void;
  onPullProgress: (callback: (data: string) => void) => () => void;

  // File System
  openFolder: () => Promise<string | null>;
  listDir: (relPath?: string) => Promise<Array<{ name: string; isDir: boolean; path: string }>>;
  readFile: (relPath: string) => Promise<string>;
  writeFile: (relPath: string, content: string) => Promise<boolean>;
  searchFiles: (query: string) => Promise<Array<{ file: string; line: number; text: string }>>;
  execCommand: (cmd: string) => Promise<string>;

  // Settings & Secrets
  getSettings: () => Promise<any>;
  setSettings: (settings: any) => Promise<any>;
  hasKey: (provider: string) => Promise<boolean>;
  setKey: (key: string, provider: string) => Promise<boolean>;

  // Agent
  chat: (prompt: string) => Promise<{ success?: boolean; error?: string }>;
  onAgentEvent: (callback: (event: any) => void) => () => void;
}

const api: AntigravityAPI = {
  checkOllama: () => ipcRenderer.invoke('ollama:health'),
  startOllama: () => ipcRenderer.invoke('ollama:start'),
  installOllama: () => ipcRenderer.invoke('ollama:install'),
  pullModel: (name: string) => ipcRenderer.invoke('ollama:pull', name),
  getModels: () => ipcRenderer.invoke('ollama:models'),
  onInstallLog: (callback) => {
    const handler = (_: any, log: string) => callback(log);
    ipcRenderer.on('ollama:install-log', handler);
    return () => ipcRenderer.removeListener('ollama:install-log', handler);
  },
  onPullProgress: (callback) => {
    const handler = (_: any, data: string) => callback(data);
    ipcRenderer.on('ollama:pull-progress', handler);
    return () => ipcRenderer.removeListener('ollama:pull-progress', handler);
  },

  openFolder: () => ipcRenderer.invoke('fs:open-folder'),
  listDir: (relPath?: string) => ipcRenderer.invoke('fs:list', relPath),
  readFile: (relPath: string) => ipcRenderer.invoke('fs:read', relPath),
  writeFile: (relPath: string, content: string) => ipcRenderer.invoke('fs:write', relPath, content),
  searchFiles: (query: string) => ipcRenderer.invoke('fs:search', query),
  execCommand: (cmd: string) => ipcRenderer.invoke('terminal:exec', cmd),

  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (s: any) => ipcRenderer.invoke('settings:set', s),
  hasKey: (prov: string) => ipcRenderer.invoke('secrets:has-key', prov),
  setKey: (key: string, prov: string) => ipcRenderer.invoke('secrets:set-key', key, prov),

  chat: (prompt: string) => ipcRenderer.invoke('agent:chat', prompt),
  onAgentEvent: (callback) => {
    const handler = (_: any, ev: any) => callback(ev);
    ipcRenderer.on('agent:event', handler);
    return () => ipcRenderer.removeListener('agent:event', handler);
  },
};

contextBridge.exposeInMainWorld('antigravity', api);
