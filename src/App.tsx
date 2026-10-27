import React, { useState, useEffect, useRef } from 'react';
import type * as Monaco from 'monaco-editor';

// Safe global window accessor
declare global {
  interface Window {
    antigravity?: any;
    prism?: any;
    monaco?: typeof Monaco;
  }
}

interface FileItem {
  name: string;
  isDir: boolean;
  path: string;
}

interface OpenTab {
  path: string;
  name: string;
  dirty: boolean;
  content: string;
}

interface AgentLog {
  id: string;
  type: 'user' | 'assistant' | 'tool' | 'error' | 'thought';
  title?: string;
  content: string;
  timestamp: string;
}

export const App: React.FC = () => {
  // Bridge API handle (supports antigravity or legacy prism bridge)
  const api = window.antigravity || window.prism;

  // Ollama & Service Status
  const [ollamaOnline, setOllamaOnline] = useState<boolean | null>(null);
  const [models, setModels] = useState<string[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>('qwen2.5-coder:7b');
  const [selectedProvider, setSelectedProvider] = useState<string>('ollama');
  const [showInstallModal, setShowInstallModal] = useState<boolean>(false);
  const [installLogs, setInstallLogs] = useState<string[]>([]);
  const [isInstalling, setIsInstalling] = useState<boolean>(false);
  const [isStartingService, setIsStartingService] = useState<boolean>(false);
  const [customPullModel, setCustomPullModel] = useState<string>('');

  // Workspace & Files
  const [workspaceRoot, setWorkspaceRoot] = useState<string | null>(null);
  const [fileTree, setFileTree] = useState<FileItem[]>([]);
  const [searchFilter, setSearchFilter] = useState<string>('');
  const [openTabs, setOpenTabs] = useState<OpenTab[]>([]);
  const [activeTabPath, setActiveTabPath] = useState<string | null>(null);

  // Editor State
  const editorContainerRef = useRef<HTMLDivElement | null>(null);
  const editorInstanceRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null);

  // Agent & Terminal
  const [agentLogs, setAgentLogs] = useState<AgentLog[]>([
    {
      id: 'welcome-0',
      type: 'assistant',
      content: 'Antigravity IDE v2 initialized. Ready to inspect, code, refactor, and run local agentic tasks.',
      timestamp: new Date().toLocaleTimeString(),
    },
  ]);
  const [promptInput, setPromptInput] = useState<string>('');
  const [isAgentThinking, setIsAgentThinking] = useState<boolean>(false);
  const [terminalOpen, setTerminalOpen] = useState<boolean>(false);
  const [terminalOutput, setTerminalOutput] = useState<string>('Antigravity Terminal v2 Ready.\n$ ');
  const [terminalInput, setTerminalInput] = useState<string>('');
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(false);
  const [agentCollapsed, setAgentCollapsed] = useState<boolean>(false);

  // ==========================================
  // Ollama Health & Model Polling
  // ==========================================
  const checkHealth = async () => {
    try {
      if (api?.checkOllama) {
        const health = await api.checkOllama();
        setOllamaOnline(health.online);
        if (health.online) {
          setModels(health.models);
          if (health.models.length > 0 && !health.models.includes(selectedModel)) {
            setSelectedModel(health.models[0]);
          }
        }
      } else {
        // Fallback fetch in browser mode
        const res = await fetch('http://localhost:11434/api/tags');
        if (res.ok) {
          const data = await res.json();
          const names = (data.models || []).map((m: any) => m.name);
          setOllamaOnline(true);
          setModels(names);
        } else {
          setOllamaOnline(false);
        }
      }
    } catch {
      setOllamaOnline(false);
    }
  };

  useEffect(() => {
    checkHealth();
    const interval = setInterval(checkHealth, 6000);
    return () => clearInterval(interval);
  }, [selectedModel]);

  // Listen to install/agent events
  useEffect(() => {
    if (!api) return;

    if (api.onInstallLog) {
      const unsub = api.onInstallLog((logText: string) => {
        setInstallLogs((prev) => [...prev, logText]);
      });
      return unsub;
    }

    if (api.onAgentEvent) {
      const unsub = api.onAgentEvent((ev: any) => {
        if (ev.type === 'text') {
          setAgentLogs((prev) => [
            ...prev,
            {
              id: Math.random().toString(36),
              type: 'assistant',
              content: ev.text,
              timestamp: new Date().toLocaleTimeString(),
            },
          ]);
        } else if (ev.type === 'tool') {
          setAgentLogs((prev) => [
            ...prev,
            {
              id: Math.random().toString(36),
              type: 'tool',
              title: `Execute: ${ev.name}`,
              content: JSON.stringify(ev.input, null, 2),
              timestamp: new Date().toLocaleTimeString(),
            },
          ]);
        }
      });
      return unsub;
    }
  }, [api]);

  // ==========================================
  // Monaco Editor Initialization
  // ==========================================
  useEffect(() => {
    if (!editorContainerRef.current) return;

    if (window.monaco) {
      initMonaco(window.monaco);
    } else {
      // If monaco loader exists
      const monacoLoader = (window as any).require;
      if (monacoLoader) {
        monacoLoader(['vs/editor/editor.main'], () => {
          initMonaco((window as any).monaco);
        });
      }
    }

    function initMonaco(monaco: typeof Monaco) {
      monaco.editor.defineTheme('cyberpunk-obsidian', {
        base: 'vs-dark',
        inherit: true,
        rules: [
          { token: 'comment', foreground: '525e75', fontStyle: 'italic' },
          { token: 'keyword', foreground: '10b981', fontStyle: 'bold' },
          { token: 'string', foreground: '38bdf8' },
          { token: 'number', foreground: 'f59e0b' },
          { token: 'type', foreground: 'a855f7' },
        ],
        colors: {
          'editor.background': '#030712',
          'editor.foreground': '#f3f4f6',
          'editorLineNumber.foreground': '#374151',
          'editorLineNumber.activeForeground': '#10b981',
          'editor.lineHighlightBackground': '#0f172a80',
          'editorCursor.foreground': '#10b981',
          'editor.selectionBackground': '#1e293b90',
        },
      });

      if (!editorInstanceRef.current && editorContainerRef.current) {
        const ed = monaco.editor.create(editorContainerRef.current, {
          theme: 'cyberpunk-obsidian',
          value: '// Welcome to Antigravity IDE v2\n// Open a workspace folder or query local Ollama models on the right panel.\n\nfunction activate() {\n  console.log("Antigravity Neon Kernel Online");\n}\n',
          language: 'typescript',
          automaticLayout: true,
          fontFamily: '"JetBrains Mono", "Fira Code", monospace',
          fontSize: 14,
          minimap: { enabled: true, side: 'right' },
          bracketPairColorization: { enabled: true },
          smoothScrolling: true,
          cursorBlinking: 'smooth',
          lineHeight: 24,
        });

        ed.onDidChangeModelContent(() => {
          if (activeTabPath) {
            setOpenTabs((prev) =>
              prev.map((t) => (t.path === activeTabPath ? { ...t, dirty: true, content: ed.getValue() } : t))
            );
          }
        });

        editorInstanceRef.current = ed;
      }
    }

    return () => {
      editorInstanceRef.current?.dispose();
      editorInstanceRef.current = null;
    };
  }, []);

  // ==========================================
  // Workspace Handlers
  // ==========================================
  const handleOpenFolder = async () => {
    if (!api?.openFolder) return;
    const folder = await api.openFolder();
    if (folder) {
      setWorkspaceRoot(folder);
      loadDirectoryTree('');
    }
  };

  const loadDirectoryTree = async (relPath: string = '') => {
    if (!api?.listDir) return;
    try {
      const items = await api.listDir(relPath);
      setFileTree(items);
    } catch (e) {
      console.error('Failed to list files:', e);
    }
  };

  const handleOpenFile = async (item: FileItem) => {
    if (item.isDir || !api?.readFile) return;

    let existing = openTabs.find((t) => t.path === item.path);
    if (!existing) {
      const content = await api.readFile(item.path);
      const newTab: OpenTab = { path: item.path, name: item.name, dirty: false, content };
      setOpenTabs((prev) => [...prev, newTab]);
      existing = newTab;
    }

    setActiveTabPath(existing.path);
    if (editorInstanceRef.current) {
      editorInstanceRef.current.setValue(existing.content);
      // Set language extension
      const ext = item.name.split('.').pop() || '';
      const langMap: Record<string, string> = {
        ts: 'typescript',
        tsx: 'typescript',
        js: 'javascript',
        jsx: 'javascript',
        json: 'json',
        md: 'markdown',
        py: 'python',
        css: 'css',
        html: 'html',
      };
      if (window.monaco) {
        window.monaco.editor.setModelLanguage(
          editorInstanceRef.current.getModel()!,
          langMap[ext] || 'plaintext'
        );
      }
    }
  };

  const handleSaveCurrentFile = async () => {
    if (!activeTabPath || !api?.writeFile || !editorInstanceRef.current) return;
    const content = editorInstanceRef.current.getValue();
    await api.writeFile(activeTabPath, content);
    setOpenTabs((prev) =>
      prev.map((t) => (t.path === activeTabPath ? { ...t, dirty: false, content } : t))
    );
  };

  // ==========================================
  // Ollama Automated Setup Actions
  // ==========================================
  const triggerStartOllama = async () => {
    setIsStartingService(true);
    try {
      if (api?.startOllama) {
        await api.startOllama();
      }
      await checkHealth();
    } finally {
      setIsStartingService(false);
    }
  };

  const triggerInstallOllama = async () => {
    setIsInstalling(true);
    setInstallLogs(['[Antigravity] Starting native Ollama auto-installer...\n']);
    try {
      if (api?.installOllama) {
        const res = await api.installOllama();
        if (res.success) {
          setInstallLogs((prev) => [...prev, '[Antigravity] Ollama installed and active!']);
          await checkHealth();
        } else {
          setInstallLogs((prev) => [...prev, `[Antigravity] Install Error: ${res.error}`]);
        }
      } else {
        setInstallLogs((prev) => [...prev, 'IPC bridge not attached in web mockup mode.']);
      }
    } finally {
      setIsInstalling(false);
    }
  };

  const handlePullModel = async (modelName: string) => {
    if (!modelName.trim() || !api?.pullModel) return;
    setInstallLogs((prev) => [...prev, `[Antigravity] Pulling model "${modelName}" from Ollama library...\n`]);
    setShowInstallModal(true);
    await api.pullModel(modelName.trim());
    await checkHealth();
  };

  // ==========================================
  // Agent Chat Execution
  // ==========================================
  const handleSendPrompt = async () => {
    if (!promptInput.trim() || isAgentThinking) return;

    const userText = promptInput.trim();
    setPromptInput('');
    setAgentLogs((prev) => [
      ...prev,
      {
        id: Math.random().toString(36),
        type: 'user',
        content: userText,
        timestamp: new Date().toLocaleTimeString(),
      },
    ]);

    setIsAgentThinking(true);
    try {
      if (api?.chat) {
        const res = await api.chat(userText);
        if (res.error) {
          setAgentLogs((prev) => [
            ...prev,
            {
              id: Math.random().toString(36),
              type: 'error',
              content: res.error,
              timestamp: new Date().toLocaleTimeString(),
            },
          ]);
        }
      }
    } catch (e: any) {
      setAgentLogs((prev) => [
        ...prev,
        {
          id: Math.random().toString(36),
          type: 'error',
          content: e.message || 'Execution failed',
          timestamp: new Date().toLocaleTimeString(),
        },
      ]);
    } finally {
      setIsAgentThinking(false);
    }
  };

  // ==========================================
  // Terminal
  // ==========================================
  const handleRunCommand = async (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && terminalInput.trim() && api?.execCommand) {
      const cmd = terminalInput.trim();
      setTerminalInput('');
      setTerminalOutput((prev) => `${prev}${cmd}\n`);
      const res = await api.execCommand(cmd);
      setTerminalOutput((prev) => `${prev}${res}\n$ `);
    }
  };

  const filteredTree = fileTree.filter((f) =>
    f.name.toLowerCase().includes(searchFilter.toLowerCase())
  );

  return (
    <div className="flex flex-col h-screen w-screen bg-[#030712] text-slate-100 font-sans select-none overflow-hidden">
      {/* ======================================================== */}
      {/* 1. TOP NAVBAR / TITLEBAR                                 */}
      {/* ======================================================== */}
      <header className="h-11 bg-slate-950/80 backdrop-blur-md border-b border-emerald-500/20 px-3 flex items-center justify-between z-30">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 font-black tracking-wider text-sm">
            <span className="w-5 h-5 rounded bg-emerald-500/10 border border-emerald-500/40 flex items-center justify-center text-emerald-400 shadow-[0_0_10px_rgba(16,185,129,0.3)]">
              ◈
            </span>
            <span className="bg-gradient-to-r from-emerald-400 via-teal-300 to-cyan-400 bg-clip-text text-transparent font-extrabold">
              ANTIGRAVITY
            </span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-950 text-emerald-400 border border-emerald-700/50">
              v2.0
            </span>
          </div>

          <div className="h-4 w-px bg-slate-800 mx-1" />

          {/* Open Folder Action */}
          <button
            onClick={handleOpenFolder}
            className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md bg-slate-900 border border-slate-700 hover:border-emerald-500/50 hover:bg-slate-800 transition"
          >
            <span>📁</span>
            <span>{workspaceRoot ? workspaceRoot.split(/[\\/]/).pop() : 'Open Folder'}</span>
          </button>
        </div>

        {/* Center: Ollama Status Badge */}
        <div className="flex items-center gap-2">
          <div
            onClick={() => setShowInstallModal(true)}
            className={`flex items-center gap-2 px-3 py-1 rounded-full border text-xs cursor-pointer transition ${
              ollamaOnline === true
                ? 'bg-emerald-950/40 border-emerald-500/40 text-emerald-300 hover:border-emerald-400'
                : ollamaOnline === false
                ? 'bg-rose-950/40 border-rose-500/40 text-rose-300 hover:border-rose-400 animate-pulse'
                : 'bg-amber-950/40 border-amber-500/40 text-amber-300'
            }`}
          >
            <span
              className={`w-2 h-2 rounded-full ${
                ollamaOnline === true
                  ? 'bg-emerald-400 shadow-[0_0_8px_#34d399]'
                  : ollamaOnline === false
                  ? 'bg-rose-500 shadow-[0_0_8px_#f43f5e]'
                  : 'bg-amber-400'
              }`}
            />
            <span className="font-mono font-medium">
              {ollamaOnline === true
                ? 'OLLAMA ONLINE (11434)'
                : ollamaOnline === false
                ? 'OLLAMA NOT DETECTED'
                : 'CHECKING OLLAMA...'}
            </span>
          </div>
        </div>

        {/* Right: Model & Provider Controls */}
        <div className="flex items-center gap-2 text-xs">
          <select
            value={selectedProvider}
            onChange={(e) => setSelectedProvider(e.target.value)}
            className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-slate-300 focus:outline-none focus:border-emerald-500/60"
          >
            <option value="ollama">Local · Ollama</option>
            <option value="gemini">Google Gemini 2.5</option>
            <option value="claude">Claude 3.5 Sonnet</option>
          </select>

          {selectedProvider === 'ollama' && (
            <select
              value={selectedModel}
              onChange={(e) => setSelectedModel(e.target.value)}
              className="bg-slate-900 border border-emerald-500/30 rounded px-2 py-1 text-emerald-300 font-mono font-semibold focus:outline-none focus:border-emerald-400"
            >
              {models.length > 0 ? (
                models.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))
              ) : (
                <option value="">No local models (Click to Install)</option>
              )}
            </select>
          )}

          <button
            onClick={() => setTerminalOpen(!terminalOpen)}
            className="px-2 py-1 bg-slate-900 border border-slate-700 hover:border-slate-500 rounded text-slate-300 font-mono"
            title="Toggle Terminal"
          >
            Terminal ⌁
          </button>
        </div>
      </header>

      {/* ======================================================== */}
      {/* 2. MAIN WORKSPACE BODY                                   */}
      {/* ======================================================== */}
      <div className="flex flex-1 overflow-hidden relative">
        {/* Left Sidebar: Collapsible File Explorer */}
        <aside
          className={`${
            sidebarCollapsed ? 'w-10' : 'w-64'
          } bg-slate-950/70 backdrop-blur-md border-r border-emerald-500/10 flex flex-col transition-all duration-200 z-20`}
        >
          <div className="h-9 px-3 flex items-center justify-between border-b border-slate-800/80">
            {!sidebarCollapsed && (
              <span className="text-[11px] font-bold tracking-wider text-slate-400 uppercase">
                WORKSPACE EXPLORER
              </span>
            )}
            <button
              onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
              className="text-slate-400 hover:text-emerald-400 text-xs p-1"
              title="Toggle Sidebar"
            >
              {sidebarCollapsed ? '→' : '←'}
            </button>
          </div>

          {!sidebarCollapsed && (
            <>
              {/* Search filter input */}
              <div className="p-2 border-b border-slate-800/60">
                <input
                  type="text"
                  placeholder="Filter files (name)..."
                  value={searchFilter}
                  onChange={(e) => setSearchFilter(e.target.value)}
                  className="w-full bg-slate-900/90 border border-slate-700/60 rounded px-2 py-1 text-xs text-slate-200 focus:outline-none focus:border-emerald-500/50"
                />
              </div>

              {/* File list tree */}
              <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
                {filteredTree.length > 0 ? (
                  filteredTree.map((item) => (
                    <div
                      key={item.path}
                      onClick={() => handleOpenFile(item)}
                      className={`flex items-center gap-2 px-2 py-1.5 rounded text-xs cursor-pointer transition ${
                        activeTabPath === item.path
                          ? 'bg-emerald-950/40 text-emerald-300 border border-emerald-500/30'
                          : 'text-slate-400 hover:bg-slate-900/80 hover:text-slate-200'
                      }`}
                    >
                      <span className="text-[13px]">{item.isDir ? '📁' : '📄'}</span>
                      <span className="truncate">{item.name}</span>
                    </div>
                  ))
                ) : (
                  <div className="text-center py-8 text-xs text-slate-500">
                    {workspaceRoot ? 'No matching files' : 'Open a workspace folder to view files'}
                  </div>
                )}
              </div>
            </>
          )}
        </aside>

        {/* Center Stage: Tabs + Monaco Editor + Terminal */}
        <main className="flex-1 flex flex-col overflow-hidden bg-[#030712] relative">
          {/* Tabs Bar */}
          <div className="h-9 bg-slate-950/90 border-b border-slate-800 flex items-center overflow-x-auto px-1 gap-1">
            {openTabs.map((tab) => (
              <div
                key={tab.path}
                onClick={() => {
                  setActiveTabPath(tab.path);
                  if (editorInstanceRef.current) {
                    editorInstanceRef.current.setValue(tab.content);
                  }
                }}
                className={`flex items-center gap-2 px-3 py-1 rounded-t text-xs cursor-pointer border-t-2 transition ${
                  activeTabPath === tab.path
                    ? 'bg-[#030712] border-emerald-400 text-slate-100 font-medium'
                    : 'bg-slate-900/50 border-transparent text-slate-400 hover:text-slate-200'
                }`}
              >
                <span>{tab.name}</span>
                {tab.dirty && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />}
                <span
                  onClick={(e) => {
                    e.stopPropagation();
                    const next = openTabs.filter((t) => t.path !== tab.path);
                    setOpenTabs(next);
                    if (activeTabPath === tab.path) {
                      setActiveTabPath(next[0]?.path || null);
                    }
                  }}
                  className="hover:text-rose-400 px-0.5"
                >
                  ✕
                </span>
              </div>
            ))}

            {openTabs.length > 0 && (
              <button
                onClick={handleSaveCurrentFile}
                className="ml-auto px-2 py-0.5 text-[11px] rounded bg-emerald-950/60 border border-emerald-600/40 text-emerald-300 hover:bg-emerald-900 transition"
              >
                Ctrl+S Save
              </button>
            )}
          </div>

          {/* Monaco Editor Container */}
          <div className="flex-1 relative">
            <div ref={editorContainerRef} className="absolute inset-0" />
          </div>

          {/* Bottom Drawer: Built-in Terminal */}
          {terminalOpen && (
            <div className="h-48 bg-slate-950/95 border-t border-emerald-500/20 flex flex-col backdrop-blur-md">
              <div className="h-7 px-3 flex items-center justify-between border-b border-slate-800 text-xs font-mono text-emerald-400">
                <span>TERMINAL INSTANCE</span>
                <button
                  onClick={() => setTerminalOpen(false)}
                  className="text-slate-400 hover:text-slate-100"
                >
                  ✕
                </button>
              </div>
              <div className="flex-1 p-2 font-mono text-xs text-slate-300 overflow-y-auto whitespace-pre-wrap">
                {terminalOutput}
              </div>
              <div className="h-8 px-2 border-t border-slate-800/80 flex items-center gap-2 font-mono text-xs">
                <span className="text-emerald-400 font-bold">$</span>
                <input
                  type="text"
                  value={terminalInput}
                  onChange={(e) => setTerminalInput(e.target.value)}
                  onKeyDown={handleRunCommand}
                  placeholder="Execute shell command in workspace..."
                  className="flex-1 bg-transparent border-none outline-none text-slate-100"
                />
              </div>
            </div>
          )}
        </main>

        {/* Right Sidebar: Split AI Agent Panel */}
        <aside
          className={`${
            agentCollapsed ? 'w-10' : 'w-96'
          } bg-slate-950/80 backdrop-blur-md border-l border-emerald-500/10 flex flex-col transition-all duration-200 z-20`}
        >
          <div className="h-9 px-3 flex items-center justify-between border-b border-slate-800/80">
            <button
              onClick={() => setAgentCollapsed(!agentCollapsed)}
              className="text-slate-400 hover:text-emerald-400 text-xs p-1"
              title="Toggle Agent"
            >
              {agentCollapsed ? '←' : '→'}
            </button>
            {!agentCollapsed && (
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-bold tracking-wider text-emerald-400 uppercase">
                  AGENT REASONING KERNEL
                </span>
                <span className="w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_6px_#34d399] animate-pulse" />
              </div>
            )}
          </div>

          {!agentCollapsed && (
            <>
              {/* Agent Logs Stream */}
              <div className="flex-1 overflow-y-auto p-3 space-y-3">
                {agentLogs.map((log) => (
                  <div
                    key={log.id}
                    className={`p-2.5 rounded-lg border text-xs leading-relaxed ${
                      log.type === 'user'
                        ? 'bg-slate-900 border-slate-700 text-slate-200 ml-4'
                        : log.type === 'tool'
                        ? 'bg-emerald-950/30 border-emerald-500/30 font-mono text-emerald-300'
                        : log.type === 'error'
                        ? 'bg-rose-950/40 border-rose-500/40 text-rose-300'
                        : 'bg-slate-900/60 border-slate-800 text-slate-300 mr-2 shadow-[0_0_15px_rgba(0,0,0,0.5)]'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1 text-[10px] opacity-70">
                      <span className="font-bold uppercase tracking-wider">
                        {log.type === 'user' ? 'YOU' : log.type === 'tool' ? 'TOOL EXECUTION' : 'ANTIGRAVITY'}
                      </span>
                      <span>{log.timestamp}</span>
                    </div>

                    {log.title && <div className="font-bold text-emerald-400 mb-1">{log.title}</div>}
                    <div className="whitespace-pre-wrap">{log.content}</div>
                  </div>
                ))}

                {isAgentThinking && (
                  <div className="p-3 rounded-lg border border-emerald-500/30 bg-emerald-950/20 text-xs text-emerald-400 flex items-center gap-2 animate-pulse">
                    <span className="w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_8px_#34d399]" />
                    <span>Agent is generating tool actions & reasoning...</span>
                  </div>
                )}
              </div>

              {/* Prompt Composer Box */}
              <div className="p-3 border-t border-slate-800/80 bg-slate-950">
                <textarea
                  rows={3}
                  value={promptInput}
                  onChange={(e) => setPromptInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleSendPrompt();
                    }
                  }}
                  placeholder="Ask Antigravity to write code, inspect files, or refactor..."
                  className="w-full bg-slate-900 border border-slate-700/80 focus:border-emerald-500/60 rounded-lg p-2.5 text-xs text-slate-100 placeholder-slate-500 focus:outline-none resize-none shadow-inner"
                />
                <div className="flex items-center justify-between mt-2">
                  <span className="text-[10px] text-slate-500">Enter to send • Shift+Enter newline</span>
                  <button
                    onClick={handleSendPrompt}
                    disabled={isAgentThinking}
                    className="px-3 py-1 bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 text-slate-950 font-bold text-xs rounded-md shadow-[0_0_12px_rgba(16,185,129,0.4)] transition"
                  >
                    Send ↵
                  </button>
                </div>
              </div>
            </>
          )}
        </aside>
      </div>

      {/* ======================================================== */}
      {/* 3. OLLAMA NOT DETECTED / INSTALLATION MODAL CARD         */}
      {/* ======================================================== */}
      {showInstallModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-md flex items-center justify-center z-50 p-4">
          <div className="bg-[#030712] border border-emerald-500/30 w-full max-w-xl rounded-xl shadow-[0_0_35px_rgba(16,185,129,0.2)] overflow-hidden flex flex-col">
            {/* Modal Header */}
            <div className="p-4 border-b border-slate-800 flex items-center justify-between bg-slate-900/60">
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-full bg-emerald-400 shadow-[0_0_10px_#10b981]" />
                <h3 className="font-bold text-sm text-slate-100 tracking-wide">
                  Ollama Local Orchestration & Setup
                </h3>
              </div>
              <button
                onClick={() => setShowInstallModal(false)}
                className="text-slate-400 hover:text-slate-100 text-sm"
              >
                ✕
              </button>
            </div>

            {/* Modal Content */}
            <div className="p-5 space-y-4 text-xs">
              <div className="flex items-center justify-between p-3 rounded-lg bg-slate-900/80 border border-slate-800">
                <div>
                  <div className="font-semibold text-slate-200">Local Daemon Status:</div>
                  <div className="text-slate-400 font-mono mt-0.5">http://localhost:11434</div>
                </div>
                <div
                  className={`px-2.5 py-1 rounded text-[11px] font-bold ${
                    ollamaOnline
                      ? 'bg-emerald-950 text-emerald-400 border border-emerald-700/50'
                      : 'bg-rose-950 text-rose-400 border border-rose-700/50'
                  }`}
                >
                  {ollamaOnline ? 'CONNECTED' : 'DISCONNECTED'}
                </div>
              </div>

              {/* Action Buttons */}
              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={triggerStartOllama}
                  disabled={isStartingService}
                  className="p-3 rounded-lg bg-slate-900 border border-slate-700 hover:border-emerald-500/50 text-left transition"
                >
                  <div className="font-bold text-slate-200 flex items-center gap-1.5">
                    <span>⚡</span>
                    <span>Start Local Service</span>
                  </div>
                  <div className="text-[11px] text-slate-400 mt-1">
                    Triggers `ollama serve` in the background if already installed.
                  </div>
                </button>

                <button
                  onClick={triggerInstallOllama}
                  disabled={isInstalling}
                  className="p-3 rounded-lg bg-emerald-950/30 border border-emerald-500/40 hover:border-emerald-400 text-left transition shadow-[0_0_15px_rgba(16,185,129,0.1)]"
                >
                  <div className="font-bold text-emerald-300 flex items-center gap-1.5">
                    <span>📦</span>
                    <span>One-Click Install Ollama</span>
                  </div>
                  <div className="text-[11px] text-slate-400 mt-1">
                    Downloads & configures Ollama natively for Windows/macOS/Linux.
                  </div>
                </button>
              </div>

              {/* Quick Model Pull */}
              <div className="space-y-2 pt-2 border-t border-slate-800">
                <div className="font-semibold text-slate-300">Quick Pull Recommended Models:</div>
                <div className="flex flex-wrap gap-2">
                  {['qwen2.5-coder:7b', 'llama3:8b', 'deepseek-coder:6.7b'].map((m) => (
                    <button
                      key={m}
                      onClick={() => handlePullModel(m)}
                      className="px-2.5 py-1 rounded bg-slate-900 border border-slate-700 hover:border-emerald-500/50 font-mono text-[11px] text-emerald-300 transition"
                    >
                      + {m}
                    </button>
                  ))}
                </div>

                <div className="flex items-center gap-2 mt-2">
                  <input
                    type="text"
                    value={customPullModel}
                    onChange={(e) => setCustomPullModel(e.target.value)}
                    placeholder="Custom model tag (e.g. codellama:7b)..."
                    className="flex-1 bg-slate-900 border border-slate-700 rounded px-2.5 py-1 text-slate-200 focus:outline-none focus:border-emerald-500/50 font-mono"
                  />
                  <button
                    onClick={() => handlePullModel(customPullModel)}
                    className="px-3 py-1 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold rounded"
                  >
                    Pull
                  </button>
                </div>
              </div>

              {/* Live Terminal Progress Log */}
              {installLogs.length > 0 && (
                <div className="mt-3">
                  <div className="text-[11px] font-mono text-slate-400 mb-1">EXECUTION LOGS:</div>
                  <div className="h-32 bg-black border border-slate-800 rounded p-2 overflow-y-auto font-mono text-[11px] text-emerald-400 whitespace-pre-wrap leading-tight">
                    {installLogs.join('')}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;
