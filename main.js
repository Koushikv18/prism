const { app, BrowserWindow, ipcMain, dialog, safeStorage } = require('electron');
const fs = require('fs');
const path = require('path');
const { exec, spawn } = require('child_process');
const { runAgent, listOllamaModels } = require('./agent');

let win, root = null, history = [];
const OLLAMA_HOST = process.env.OLLAMA_HOST || 'http://localhost:11434';
const setPath = () => path.join(app.getPath('userData'), 'settings.json');
let settings = { provider: 'ollama', model: 'qwen2.5-coder:7b' };
try { settings = { ...settings, ...JSON.parse(fs.readFileSync(setPath(), 'utf8')) }; } catch {}

const keyPath = p => path.join(app.getPath('userData'), (p === 'gemini' ? 'gemini' : 'anthropic') + '.key');
const getKey = p => (p === 'gemini' ? process.env.GEMINI_API_KEY : process.env.ANTHROPIC_API_KEY) || (fs.existsSync(keyPath(p)) ? safeStorage.decryptString(fs.readFileSync(keyPath(p))) : null);

const inRoot = rel => {
  const p = path.resolve(root, rel || '.');
  if (p !== root && !p.startsWith(root + path.sep)) throw new Error('outside workspace');
  return p;
};

// Ollama Service Manager
async function checkOllama() {
  try {
    const controller = new AbortController();
    const to = setTimeout(() => controller.abort(), 2000);
    const res = await fetch(`${OLLAMA_HOST}/api/tags`, { signal: controller.signal });
    clearTimeout(to);
    if (res.ok) {
      const data = await res.json();
      const models = (data.models || []).map(m => m.name);
      return { online: true, models, host: OLLAMA_HOST };
    }
    return { online: false, models: [], host: OLLAMA_HOST };
  } catch {
    return { online: false, models: [], host: OLLAMA_HOST };
  }
}

function startOllamaDaemon() {
  return new Promise(resolve => {
    try {
      const child = spawn('ollama', ['serve'], { detached: true, stdio: 'ignore', shell: true });
      child.unref();
      let count = 0;
      const timer = setInterval(async () => {
        count++;
        const h = await checkOllama();
        if (h.online) {
          clearInterval(timer);
          resolve({ success: true, message: 'Ollama is online.' });
        } else if (count > 10) {
          clearInterval(timer);
          resolve({ success: false, message: 'Timed out waiting for ollama serve.' });
        }
      }, 1000);
    } catch (e) {
      resolve({ success: false, message: e.message });
    }
  });
}

function installOllama(onLog) {
  return new Promise(resolve => {
    const isWin = process.platform === 'win32';
    const script = isWin
      ? path.join(__dirname, 'scripts', 'install-ollama.ps1')
      : path.join(__dirname, 'scripts', 'install-ollama.sh');

    onLog(`[Antigravity] Executing installer: ${path.basename(script)}...\n`);
    const child = isWin
      ? spawn('powershell.exe', ['-ExecutionPolicy', 'Bypass', '-File', script])
      : spawn('bash', [script]);

    child.stdout.on('data', d => onLog(d.toString()));
    child.stderr.on('data', d => onLog(d.toString()));

    child.on('close', async code => {
      if (code === 0) {
        onLog('[Antigravity] Installation completed successfully.\n');
        await startOllamaDaemon();
        resolve({ success: true });
      } else {
        resolve({ success: false, error: `Exited with code ${code}` });
      }
    });

    child.on('error', err => resolve({ success: false, error: err.message }));
  });
}

app.whenReady().then(() => {
  win = new BrowserWindow({
    width: 1540,
    height: 940,
    backgroundColor: '#030712',
    title: 'Antigravity IDE v2',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  win.loadFile('renderer/index.html');
});

// Ollama IPCs
ipcMain.handle('ollama:health', async () => checkOllama());
ipcMain.handle('ollama:start', async () => startOllamaDaemon());
ipcMain.handle('ollama:install', async (ev) => {
  return installOllama(chunk => ev.sender.send('ollama:install-log', chunk));
});
ipcMain.handle('ollama:pull', async (ev, name) => {
  try {
    const res = await fetch(`${OLLAMA_HOST}/api/pull`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, stream: false })
    });
    return { success: res.ok };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// Workspace IPCs
ipcMain.handle('open-folder', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory'] });
  if (r.canceled) return null;
  root = r.filePaths[0];
  history = [];
  return root;
});

ipcMain.handle('clone', async (_, url) => {
  const r = await dialog.showOpenDialog(win, { title: 'Choose where to clone', properties: ['openDirectory', 'createDirectory'] });
  if (r.canceled) return { error: 'cancelled' };
  return new Promise(res => exec(`git clone "${url}"`, { cwd: r.filePaths[0] }, (err, o, e) => {
    if (err) return res({ error: e || err.message });
    root = path.join(r.filePaths[0], path.basename(url).replace(/\.git$/, ''));
    history = [];
    res({ root });
  }));
});

ipcMain.handle('list', (_, rel) => fs.readdirSync(inRoot(rel), { withFileTypes: true })
  .filter(e => e.name !== '.git' && e.name !== 'node_modules')
  .map(e => ({ name: e.name, dir: e.isDirectory() })).sort((a, b) => b.dir - a.dir || a.name.localeCompare(b.name)));

ipcMain.handle('read', (_, rel) => fs.readFileSync(inRoot(rel), 'utf8'));
ipcMain.handle('write', (_, rel, text) => { fs.writeFileSync(inRoot(rel), text); return true; });
ipcMain.handle('term', (_, cmd) => new Promise(res => exec(cmd, { cwd: root || undefined, timeout: 120000 },
  (err, o, e) => res((o || '') + (e || '') + (err ? `\n[exit ${err.code}]` : '')))));

ipcMain.handle('has-key', (_, p) => !!getKey(p));
ipcMain.handle('set-key', (_, k, p) => { fs.writeFileSync(keyPath(p), safeStorage.encryptString(k)); return true; });
ipcMain.handle('get-settings', () => settings);
ipcMain.handle('set-settings', (_, s) => { settings = { ...settings, ...s }; history = []; fs.writeFileSync(setPath(), JSON.stringify(settings)); return settings; });
ipcMain.handle('models', async () => { try { return await listOllamaModels(); } catch { return []; } });

ipcMain.handle('agent', async (_, prompt) => {
  const apiKey = getKey(settings.provider);
  if (settings.provider === 'claude' && !apiKey) return { error: 'Set your Anthropic API key first, or switch provider.' };
  if (settings.provider === 'gemini' && !apiKey) return { error: 'Set your Gemini API key first, or switch provider.' };
  history.push({ role: 'user', content: prompt });
  try {
    await runAgent({
      provider: settings.provider,
      model: settings.model,
      apiKey,
      messages: history,
      root,
      setRoot: p => { root = p; win.webContents.send('agent-event', { type: 'workspace', root: p }); },
      emit: ev => win.webContents.send('agent-event', ev),
      approve: async cmd => (await dialog.showMessageBox(win, {
        type: 'question',
        buttons: ['Run', 'Deny'],
        defaultId: 0,
        message: 'Agent wants to run shell command:',
        detail: cmd
      })).response === 0
    });
    return { ok: true };
  } catch (e) {
    return { error: e.message };
  }
});

app.on('window-all-closed', () => app.quit());
