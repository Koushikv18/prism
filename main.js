const { app, BrowserWindow, ipcMain, dialog, safeStorage } = require('electron');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { runAgent } = require('./agent');

let win, root = null, history = [];
const keyPath = () => path.join(app.getPath('userData'), 'anthropic.key');
const getKey = () => process.env.ANTHROPIC_API_KEY || (fs.existsSync(keyPath()) ? safeStorage.decryptString(fs.readFileSync(keyPath())) : null);
const inRoot = rel => { const p = path.resolve(root, rel || '.'); if (p !== root && !p.startsWith(root + path.sep)) throw new Error('outside workspace'); return p; };

app.whenReady().then(() => {
  win = new BrowserWindow({ width: 1500, height: 900, backgroundColor: '#1e1e1e', title: 'Prism',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false } });
  win.loadFile('renderer/index.html');
});

ipcMain.handle('open-folder', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory'] });
  if (r.canceled) return null;
  root = r.filePaths[0]; history = []; return root;
});
ipcMain.handle('clone', async (_, url) => {
  const r = await dialog.showOpenDialog(win, { title: 'Choose where to clone', properties: ['openDirectory', 'createDirectory'] });
  if (r.canceled) return { error: 'cancelled' };
  return new Promise(res => exec(`git clone "${url}"`, { cwd: r.filePaths[0] }, (err, o, e) => {
    if (err) return res({ error: e || err.message });
    root = path.join(r.filePaths[0], path.basename(url).replace(/\.git$/, '')); history = []; res({ root });
  }));
});
ipcMain.handle('list', (_, rel) => fs.readdirSync(inRoot(rel), { withFileTypes: true })
  .filter(e => e.name !== '.git' && e.name !== 'node_modules')
  .map(e => ({ name: e.name, dir: e.isDirectory() })).sort((a, b) => b.dir - a.dir || a.name.localeCompare(b.name)));
ipcMain.handle('read', (_, rel) => fs.readFileSync(inRoot(rel), 'utf8'));
ipcMain.handle('write', (_, rel, text) => { fs.writeFileSync(inRoot(rel), text); return true; });
ipcMain.handle('term', (_, cmd) => new Promise(res => exec(cmd, { cwd: root, timeout: 120000 },
  (err, o, e) => res((o || '') + (e || '') + (err ? `\n[exit ${err.code}]` : '')))));
ipcMain.handle('has-key', () => !!getKey());
ipcMain.handle('set-key', (_, k) => { fs.writeFileSync(keyPath(), safeStorage.encryptString(k)); return true; });
ipcMain.handle('agent', async (_, prompt) => {
  if (!root) return { error: 'Open a folder first.' };
  const apiKey = getKey(); if (!apiKey) return { error: 'Set your Anthropic API key first.' };
  history.push({ role: 'user', content: prompt });
  try {
    await runAgent({ apiKey, messages: history, root,
      emit: ev => win.webContents.send('agent-event', ev),
      approve: async cmd => (await dialog.showMessageBox(win, { type: 'question', buttons: ['Run', 'Deny'], defaultId: 1, message: 'Agent wants to run:', detail: cmd })).response === 0 });
    return { ok: true };
  } catch (e) { return { error: e.message }; }
});
app.on('window-all-closed', () => app.quit());
