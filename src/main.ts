import { app, BrowserWindow, ipcMain, dialog, safeStorage } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { exec, spawn, ChildProcess } from 'child_process';

const OLLAMA_HOST = process.env.OLLAMA_HOST || 'http://localhost:11434';
const WORKSPACES_DIR = path.join(os.homedir(), '.antigravity', 'workspaces');
const SKIP_PATTERNS = new Set(['.git', 'node_modules', 'dist', 'build', '.next', '__pycache__', '.venv']);

let mainWindow: BrowserWindow | null = null;
let currentWorkspace: string | null = null;
let chatHistory: Array<{ role: string; content?: any; parts?: any }> = [];
let ollamaProcess: ChildProcess | null = null;

interface AppSettings {
  provider: 'ollama' | 'gemini' | 'claude';
  model: string;
  theme: 'cyberpunk-dark';
  geminiKey?: string;
  claudeKey?: string;
}

const settingsPath = () => path.join(app.getPath('userData'), 'antigravity-settings.json');
let settings: AppSettings = {
  provider: 'ollama',
  model: 'qwen2.5-coder:7b',
  theme: 'cyberpunk-dark',
};

try {
  if (fs.existsSync(settingsPath())) {
    settings = { ...settings, ...JSON.parse(fs.readFileSync(settingsPath(), 'utf8')) };
  }
} catch (e) {
  console.warn('Failed to parse settings:', e);
}

// Key encryption store
const getKeyPath = (provider: string) =>
  path.join(app.getPath('userData'), `${provider}.key`);

const getStoredApiKey = (provider: string): string | null => {
  if (provider === 'gemini' && process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY;
  if (provider === 'claude' && process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY;
  const p = getKeyPath(provider);
  if (fs.existsSync(p)) {
    try {
      return safeStorage.isEncryptionAvailable()
        ? safeStorage.decryptString(fs.readFileSync(p))
        : fs.readFileSync(p, 'utf8');
    } catch {
      return null;
    }
  }
  return null;
};

const storeApiKey = (key: string, provider: string) => {
  const p = getKeyPath(provider);
  if (safeStorage.isEncryptionAvailable()) {
    fs.writeFileSync(p, safeStorage.encryptString(key));
  } else {
    fs.writeFileSync(p, key, 'utf8');
  }
};

// Workspace Security Sandbox: Prevents directory traversal attacks
const resolveSafePath = (relPath: string = '.'): string => {
  if (!currentWorkspace) {
    throw new Error('No workspace currently opened. Open a folder or clone a repository first.');
  }
  const full = path.resolve(currentWorkspace, relPath);
  if (full !== currentWorkspace && !full.startsWith(currentWorkspace + path.sep)) {
    throw new Error('Access denied: target path escapes workspace boundary');
  }
  return full;
};

// ==========================================
// 1. Ollama Health & Local Service Manager
// ==========================================

async function checkOllamaHealth(): Promise<{ online: boolean; models: string[]; host: string }> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
    const res = await fetch(`${OLLAMA_HOST}/api/tags`, { signal: controller.signal });
    clearTimeout(timeout);

    if (res.ok) {
      const data = (await res.json()) as { models?: Array<{ name: string }> };
      const models = (data.models || []).map(m => m.name);
      return { online: true, models, host: OLLAMA_HOST };
    }
    return { online: false, models: [], host: OLLAMA_HOST };
  } catch {
    return { online: false, models: [], host: OLLAMA_HOST };
  }
}

async function startOllamaDaemon(): Promise<{ success: boolean; message: string }> {
  const health = await checkOllamaHealth();
  if (health.online) return { success: true, message: 'Ollama is already running.' };

  return new Promise((resolve) => {
    try {
      ollamaProcess = spawn('ollama', ['serve'], {
        detached: true,
        stdio: 'ignore',
        shell: true,
      });
      ollamaProcess.unref();

      // Poll until online
      let attempts = 0;
      const interval = setInterval(async () => {
        attempts++;
        const check = await checkOllamaHealth();
        if (check.online) {
          clearInterval(interval);
          resolve({ success: true, message: 'Ollama background daemon started successfully.' });
        } else if (attempts > 12) {
          clearInterval(interval);
          resolve({ success: false, message: 'Timed out waiting for "ollama serve" to start.' });
        }
      }, 1000);
    } catch (err: any) {
      resolve({ success: false, message: `Failed to spawn Ollama daemon: ${err.message}` });
    }
  });
}

function installOllamaNative(onProgress: (log: string) => void): Promise<{ success: boolean; error?: string }> {
  return new Promise((resolve) => {
    const isWin = process.platform === 'win32';
    const scriptPath = isWin
      ? path.join(__dirname, '..', 'scripts', 'install-ollama.ps1')
      : path.join(__dirname, '..', 'scripts', 'install-ollama.sh');

    onProgress(`[Antigravity] Executing installer script: ${path.basename(scriptPath)}...\n`);

    const child = isWin
      ? spawn('powershell.exe', ['-ExecutionPolicy', 'Bypass', '-File', scriptPath])
      : spawn('bash', [scriptPath]);

    child.stdout.on('data', (d) => onProgress(d.toString()));
    child.stderr.on('data', (d) => onProgress(d.toString()));

    child.on('close', async (code) => {
      if (code === 0) {
        onProgress('[Antigravity] Installation sequence completed successfully.\n');
        await startOllamaDaemon();
        resolve({ success: true });
      } else {
        resolve({ success: false, error: `Installer exited with code ${code}` });
      }
    });

    child.on('error', (err) => {
      resolve({ success: false, error: err.message });
    });
  });
}

// ==========================================
// 2. Window Initialization & IPC Handlers
// ==========================================

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1540,
    height: 960,
    minWidth: 1080,
    minHeight: 700,
    backgroundColor: '#030712',
    title: 'Antigravity IDE v2',
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#030712',
      symbolColor: '#10b981',
      height: 38,
    },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist-renderer', 'index.html'));
  }
}

app.whenReady().then(() => {
  createMainWindow();

  // Ollama IPC Endpoints
  ipcMain.handle('ollama:health', async () => checkOllamaHealth());
  ipcMain.handle('ollama:start', async () => startOllamaDaemon());
  ipcMain.handle('ollama:models', async () => (await checkOllamaHealth()).models);
  ipcMain.handle('ollama:install', async (event) => {
    return installOllamaNative((chunk) => {
      event.sender.send('ollama:install-log', chunk);
    });
  });

  // Pull Model from Ollama
  ipcMain.handle('ollama:pull', async (event, modelName: string) => {
    try {
      const res = await fetch(`${OLLAMA_HOST}/api/pull`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: modelName, stream: true }),
      });

      if (!res.body) throw new Error('No streaming body from Ollama API');
      const reader = res.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const text = decoder.decode(value);
        event.sender.send('ollama:pull-progress', text);
      }
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // File System IPC Endpoints
  ipcMain.handle('fs:open-folder', async () => {
    if (!mainWindow) return null;
    const res = await dialog.showOpenDialog(mainWindow, {
      title: 'Select Workspace Directory',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (res.canceled || !res.filePaths.length) return null;
    currentWorkspace = res.filePaths[0];
    chatHistory = [];
    return currentWorkspace;
  });

  ipcMain.handle('fs:list', (_, relDir: string = '') => {
    const target = resolveSafePath(relDir);
    return fs
      .readdirSync(target, { withFileTypes: true })
      .filter((e) => !SKIP_PATTERNS.has(e.name))
      .map((e) => ({
        name: e.name,
        isDir: e.isDirectory(),
        path: relDir ? `${relDir}/${e.name}` : e.name,
      }))
      .sort((a, b) => Number(b.isDir) - Number(a.isDir) || a.name.localeCompare(b.name));
  });

  ipcMain.handle('fs:read', (_, relPath: string) => {
    return fs.readFileSync(resolveSafePath(relPath), 'utf8');
  });

  ipcMain.handle('fs:write', (_, relPath: string, content: string) => {
    const target = resolveSafePath(relPath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content, 'utf8');
    return true;
  });

  ipcMain.handle('fs:search', (_, query: string) => {
    if (!currentWorkspace) return [];
    const re = new RegExp(query, 'i');
    const matches: Array<{ file: string; line: number; text: string }> = [];

    const scan = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (matches.length >= 100) return;
        if (SKIP_PATTERNS.has(e.name)) continue;
        const full = path.join(dir, e.name);
        if (e.isDirectory()) {
          scan(full);
        } else {
          try {
            const content = fs.readFileSync(full, 'utf8');
            if (content.includes('\0')) continue;
            content.split('\n').forEach((line, idx) => {
              if (matches.length < 100 && re.test(line)) {
                matches.push({
                  file: path.relative(currentWorkspace!, full),
                  line: idx + 1,
                  text: line.trim().slice(0, 160),
                });
              }
            });
          } catch {}
        }
      }
    };

    scan(currentWorkspace);
    return matches;
  });

  // Terminal Execution
  ipcMain.handle('terminal:exec', (_, cmd: string) => {
    return new Promise((res) => {
      exec(cmd, { cwd: currentWorkspace || undefined, timeout: 120000 }, (err, stdout, stderr) => {
        res((stdout || '') + (stderr || '') + (err ? `\n[Process exited with code ${err.code}]` : ''));
      });
    });
  });

  // Settings & Secrets
  ipcMain.handle('settings:get', () => settings);
  ipcMain.handle('settings:set', (_, newSettings: Partial<AppSettings>) => {
    settings = { ...settings, ...newSettings };
    fs.writeFileSync(settingsPath(), JSON.stringify(settings, null, 2));
    return settings;
  });

  ipcMain.handle('secrets:has-key', (_, prov: string) => !!getStoredApiKey(prov));
  ipcMain.handle('secrets:set-key', (_, key: string, prov: string) => {
    storeApiKey(key, prov);
    return true;
  });

  // ==========================================
  // 3. AI Agent Execution (Ollama / Gemini / Claude)
  // ==========================================

  ipcMain.handle('agent:chat', async (event, prompt: string) => {
    const apiKey = getStoredApiKey(settings.provider);

    if (settings.provider === 'gemini' && !apiKey) {
      return { error: 'Gemini API Key missing. Please configure it in settings.' };
    }
    if (settings.provider === 'claude' && !apiKey) {
      return { error: 'Anthropic API Key missing. Please configure it in settings.' };
    }

    const emitEvent = (payload: any) => {
      mainWindow?.webContents.send('agent:event', payload);
    };

    const approveCommand = async (command: string): Promise<boolean> => {
      if (!mainWindow) return false;
      const resp = await dialog.showMessageBox(mainWindow, {
        type: 'question',
        buttons: ['Approve & Run', 'Reject'],
        defaultId: 0,
        title: 'Security Prompt: Execute Command',
        message: 'The AI agent is requesting permission to execute:',
        detail: command,
      });
      return resp.response === 0;
    };

    // Tool registry
    const runTool = async (name: string, input: any): Promise<string> => {
      try {
        if (name === 'list_dir') {
          const p = resolveSafePath(input.path || '.');
          return fs.readdirSync(p).filter((f) => !SKIP_PATTERNS.has(f)).join('\n') || '(empty)';
        }
        if (name === 'read_file') {
          return fs.readFileSync(resolveSafePath(input.path), 'utf8').slice(0, 80000);
        }
        if (name === 'write_file') {
          const p = resolveSafePath(input.path);
          fs.mkdirSync(path.dirname(p), { recursive: true });
          fs.writeFileSync(p, input.content, 'utf8');
          emitEvent({ type: 'file_changed', path: input.path });
          return `Successfully wrote file: ${input.path}`;
        }
        if (name === 'run_command') {
          const approved = await approveCommand(input.command);
          if (!approved) return 'User rejected execution of this command.';
          return await new Promise((res) => {
            exec(input.command, { cwd: currentWorkspace || undefined, timeout: 60000 }, (err, out, errOut) => {
              res(((out || '') + (errOut || '') + (err ? `\n[exit: ${err.code}]` : '')).slice(-15000));
            });
          });
        }
        return `Unknown tool invocation: ${name}`;
      } catch (e: any) {
        return `Tool error: ${e.message}`;
      }
    };

    // Local Ollama chat loop with tool calling
    if (settings.provider === 'ollama') {
      try {
        chatHistory.push({ role: 'user', content: prompt });
        const tools = [
          {
            type: 'function',
            function: {
              name: 'read_file',
              description: 'Read workspace file content',
              parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
            },
          },
          {
            type: 'function',
            function: {
              name: 'write_file',
              description: 'Create or update file in workspace',
              parameters: {
                type: 'object',
                properties: { path: { type: 'string' }, content: { type: 'string' } },
                required: ['path', 'content'],
              },
            },
          },
          {
            type: 'function',
            function: {
              name: 'run_command',
              description: 'Run shell command inside workspace',
              parameters: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'] },
            },
          },
        ];

        for (let round = 0; round < 10; round++) {
          const res = await fetch(`${OLLAMA_HOST}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              model: settings.model,
              messages: [
                {
                  role: 'system',
                  content: `You are Antigravity IDE agent. Expert coder, concise, efficient. Active workspace: ${currentWorkspace || 'None'}`,
                },
                ...chatHistory,
              ],
              tools,
              stream: false,
            }),
          });

          if (!res.ok) {
            throw new Error(`Ollama API error: ${res.statusText}`);
          }

          const data = (await res.json()) as any;
          const msg = data.message;
          chatHistory.push(msg);

          if (msg.content) {
            emitEvent({ type: 'text', text: msg.content });
          }

          if (!msg.tool_calls || !msg.tool_calls.length) {
            break;
          }

          for (const tc of msg.tool_calls) {
            const toolName = tc.function.name;
            const toolArgs =
              typeof tc.function.arguments === 'string'
                ? JSON.parse(tc.function.arguments)
                : tc.function.arguments;

            emitEvent({ type: 'tool', name: toolName, input: toolArgs });
            const toolResult = await runTool(toolName, toolArgs);
            chatHistory.push({
              role: 'tool',
              content: toolResult,
            });
          }
        }
        return { success: true };
      } catch (err: any) {
        return { error: err.message };
      }
    }

    return { error: `Provider ${settings.provider} execution not configured.` };
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
