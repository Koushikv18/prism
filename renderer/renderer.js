const $ = id => document.getElementById(id);
let editor, root = '', active = null;
const tabs = new Map(); // path -> {model, saved, view}
let allFiles = [];

/* ---------- Monaco ---------- */
require.config({ paths: { vs: '../node_modules/monaco-editor/min/vs' } });
require(['vs/editor/editor.main'], () => {
  monaco.editor.defineTheme('prism', { base: 'vs-dark', inherit: true, rules: [],
    colors: { 'editor.background': '#0e0f13', 'editorLineNumber.foreground': '#4a5160', 'editor.lineHighlightBackground': '#161922', 'editorCursor.foreground': '#8b7bff' } });
  editor = monaco.editor.create($('editor'), { theme: 'prism', automaticLayout: true, fontSize: 13.5, fontFamily: '"JetBrains Mono",Consolas,monospace',
    fontLigatures: true, minimap: { enabled: true }, smoothScrolling: true, cursorSmoothCaretAnimation: 'on', bracketPairColorization: { enabled: true },
    padding: { top: 8 }, model: null });
  editor.onDidChangeCursorPosition(e => $('pos').textContent = `Ln ${e.position.lineNumber}, Col ${e.position.column}`);
  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, save);
});

/* ---------- Explorer ---------- */
const icon = n => ({ js: '🟨', ts: '🟦', json: '🧾', md: '📝', html: '🌐', css: '🎨', py: '🐍' }[n.split('.').pop()] || '📄');
async function tree(rel, el, depth = 0) {
  el.innerHTML = '';
  for (const f of await prism.list(rel)) {
    const p = rel ? rel + '/' + f.name : f.name;
    const row = document.createElement('div'); row.className = 'row'; row.style.paddingLeft = depth * 14 + 10 + 'px'; row.dataset.path = p;
    row.innerHTML = `<span class="ch">${f.dir ? '▶' : ''}</span><span>${f.dir ? '📁' : icon(f.name)}</span><span>${f.name}</span>`;
    const kids = document.createElement('div');
    row.onclick = async e => {
      e.stopPropagation();
      if (!f.dir) return openFile(p);
      const open = kids.hasChildNodes(); row.querySelector('.ch').textContent = open ? '▶' : '▼';
      open ? (kids.innerHTML = '') : await tree(p, kids, depth + 1);
    };
    el.append(row, kids);
  }
  mark();
}
const mark = () => document.querySelectorAll('.row').forEach(r => r.classList.toggle('on', r.dataset.path === active));
async function indexFiles(rel = '', out = []) {
  for (const f of await prism.list(rel)) { const p = rel ? rel + '/' + f.name : f.name; f.dir ? await indexFiles(p, out) : out.push(p); if (out.length > 4000) break; }
  return out;
}
const refresh = async () => { if (root) { await tree('', $('tree')); allFiles = await indexFiles(); } };

/* ---------- Tabs / files ---------- */
async function openFile(p) {
  if (!editor) return;
  if (!tabs.has(p)) {
    const text = await prism.read(p);
    const model = monaco.editor.createModel(text, undefined, monaco.Uri.file('/' + p));
    model.onDidChangeContent(() => { tabs.get(p).dirty = model.getValue() !== tabs.get(p).saved; renderTabs(); });
    tabs.set(p, { model, saved: text, dirty: false, view: null });
  }
  show(p);
}
function show(p) {
  if (active && tabs.has(active)) tabs.get(active).view = editor.saveViewState();
  active = p; const t = tabs.get(p);
  editor.setModel(t.model); if (t.view) editor.restoreViewState(t.view); editor.focus();
  $('welcome').hidden = true; $('lang').textContent = t.model.getLanguageId();
  $('crumbs').textContent = p.split('/').join('  ›  '); $('fileinfo').textContent = p; renderTabs(); mark();
}
function closeTab(p) {
  const t = tabs.get(p); if (t.dirty && !confirm(`${p} has unsaved changes. Close anyway?`)) return;
  t.model.dispose(); tabs.delete(p);
  if (active === p) { active = null; const next = [...tabs.keys()].pop(); if (next) show(next); else { editor.setModel(null); $('welcome').hidden = false; $('crumbs').textContent = ''; $('fileinfo').textContent = ''; $('lang').textContent = ''; } }
  renderTabs(); mark();
}
function renderTabs() {
  $('tabs').innerHTML = '';
  for (const [p, t] of tabs) {
    const d = document.createElement('div'); d.className = 'tab' + (p === active ? ' on' : '');
    d.innerHTML = `<span>${icon(p)}</span><span>${p.split('/').pop()}</span><span class="x">${t.dirty ? '<span class="dot">●</span>' : '✕'}</span>`;
    d.onclick = () => show(p); d.querySelector('.x').onclick = e => { e.stopPropagation(); closeTab(p); };
    d.onauxclick = () => closeTab(p); $('tabs').append(d);
  }
}
async function save() { const t = tabs.get(active); if (!t) return; const v = t.model.getValue(); await prism.write(active, v); t.saved = v; t.dirty = false; renderTabs(); }
async function saveAll() { for (const [p, t] of tabs) { const v = t.model.getValue(); if (t.dirty) { await prism.write(p, v); t.saved = v; t.dirty = false; } } renderTabs(); }

/* ---------- Workspace ---------- */
async function opened(r) {
  if (!r) return; root = r; document.title = 'Prism – ' + r;
  $('rootName').textContent = r.split(/[\\/]/).pop(); [...tabs.keys()].forEach(closeTab);
  await refresh(); gitBranch();
}
async function gitBranch() { const b = (await prism.term('git branch --show-current')).trim(); $('branch').textContent = '⎇ ' + (b && !b.includes('[exit') ? b : 'no git'); }
$('open').onclick = async () => opened(await prism.openFolder());
$('clone').onclick = async () => { const u = $('url').value.trim(); if (!u) return; $('clone').textContent = 'Cloning…'; const r = await prism.clone(u); $('clone').textContent = 'Clone'; r.error ? alert(r.error) : opened(r.root); };
$('key').onclick = async () => { const k = prompt('Anthropic API key (stored encrypted on this machine):'); if (k) await prism.setKey(k); };

/* ---------- Terminal ---------- */
const hist = []; let hi = 0;
$('cmd').onkeydown = async e => {
  if (e.key === 'ArrowUp') { hi = Math.max(0, hi - 1); e.target.value = hist[hi] || ''; return; }
  if (e.key === 'ArrowDown') { hi = Math.min(hist.length, hi + 1); e.target.value = hist[hi] || ''; return; }
  if (e.key !== 'Enter' || !e.target.value.trim()) return;
  const c = e.target.value; e.target.value = ''; hist.push(c); hi = hist.length;
  $('termout').textContent += `$ ${c}\n`; $('termout').scrollTop = 1e9;
  $('termout').textContent += (await prism.term(c)) + '\n'; $('termout').scrollTop = 1e9; refresh(); gitBranch();
};

/* ---------- Agent chat ---------- */
const log = (t, c = 'ai') => { const d = document.createElement('div'); d.className = 'msg ' + c; d.textContent = t; $('log').append(d); $('log').scrollTop = 1e9; return d; };
prism.onAgent(ev => {
  if (ev.type === 'text') log(ev.text);
  if (ev.type === 'tool') log('⚙ ' + ev.name + ' ' + JSON.stringify(ev.input).slice(0, 160), 'tool');
  if (ev.type === 'file_changed') { refresh(); const t = tabs.get(ev.path); if (t) prism.read(ev.path).then(x => { t.saved = x; t.model.setValue(x); }); }
});
$('prompt').onkeydown = async e => {
  if (e.key !== 'Enter' || e.shiftKey) return; e.preventDefault();
  const t = e.target.value.trim(); if (!t) return; e.target.value = ''; log(t, 'me');
  await saveAll(); const busy = log('Thinking…', 'tool'); const r = await prism.agent(t); busy.remove();
  if (r.error) log(r.error, 'err'); refresh();
};

/* ---------- Providers ---------- */
async function loadModels() {
  const s = await prism.getSettings(); $('provider').value = s.provider; $('prov').textContent = s.provider === 'ollama' ? 'Local model' : 'Claude';
  const sel = $('model'); sel.innerHTML = '';
  const names = s.provider === 'ollama' ? await prism.models() : ['claude-sonnet-5-5', 'claude-opus-5-5', 'claude-haiku-5-5'];
  if (!names.length) { sel.innerHTML = '<option>No models: run "ollama pull qwen2.5-coder:7b"</option>'; return; }
  for (const n of names) sel.add(new Option(n, n));
  if (!names.includes(s.model)) await prism.setSettings({ model: names[0] }); else sel.value = s.model;
}
$('provider').onchange = async e => { await prism.setSettings({ provider: e.target.value }); await loadModels(); };
$('model').onchange = e => prism.setSettings({ model: e.target.value });
loadModels();

/* ---------- Command palette ---------- */
const cmds = () => [
  ['Open Folder', () => $('open').click()], ['Save File', save], ['Save All', saveAll],
  ['Close Tab', () => active && closeTab(active)], ['Toggle Terminal', () => $('panel').hidden = !$('panel').hidden],
  ['Toggle AI Panel', toggleChat], ['Focus AI Agent', () => { $('chat').hidden = false; $('prompt').focus(); }],
  ['Format Document', () => editor?.getAction('editor.action.formatDocument').run()], ['Refresh Explorer', refresh],
].map(([n, fn]) => ({ label: n, hint: 'command', run: fn }));
let items = [], sel = 0, mode = 'files';
function openPalette(m) { mode = m; $('palette').hidden = false; $('pin').value = m === 'cmd' ? '>' : ''; $('pin').focus(); filter(); }
function filter() {
  let q = $('pin').value; if (q.startsWith('>')) mode = 'cmd'; q = q.replace(/^>/, '').toLowerCase();
  const pool = mode === 'cmd' ? cmds() : allFiles.map(f => ({ label: f.split('/').pop(), hint: f, run: () => openFile(f) }));
  items = pool.filter(i => (i.label + i.hint).toLowerCase().includes(q)).slice(0, 40); sel = 0; drawList();
}
function drawList() { $('plist').innerHTML = ''; items.forEach((it, i) => { const li = document.createElement('li'); li.className = i === sel ? 'on' : ''; li.innerHTML = `${it.label}<small>${it.hint}</small>`; li.onclick = () => pick(i); $('plist').append(li); }); }
function pick(i) { const it = items[i]; closePalette(); it && it.run(); }
const closePalette = () => { $('palette').hidden = true; editor?.focus(); };
$('pin').oninput = filter;
$('pin').onkeydown = e => {
  if (e.key === 'Escape') closePalette();
  if (e.key === 'ArrowDown') { sel = Math.min(items.length - 1, sel + 1); drawList(); e.preventDefault(); }
  if (e.key === 'ArrowUp') { sel = Math.max(0, sel - 1); drawList(); e.preventDefault(); }
  if (e.key === 'Enter') pick(sel);
};
const toggleChat = () => { $('chat').hidden = !$('chat').hidden; $('s3').hidden = $('chat').hidden; };
$('togChat').onclick = toggleChat;
document.querySelector('[data-view="search"]').onclick = () => openPalette('files');
addEventListener('keydown', e => {
  const m = e.ctrlKey || e.metaKey;
  if (m && e.shiftKey && e.key.toLowerCase() === 'p') { e.preventDefault(); openPalette('cmd'); }
  else if (m && e.key.toLowerCase() === 'p') { e.preventDefault(); openPalette('files'); }
  else if (m && e.key === '`') { e.preventDefault(); $('panel').hidden = !$('panel').hidden; if (!$('panel').hidden) $('cmd').focus(); }
  else if (m && e.key.toLowerCase() === 'l') { e.preventDefault(); toggleChat(); if (!$('chat').hidden) $('prompt').focus(); }
  else if (m && e.key.toLowerCase() === 's' && !editor?.hasTextFocus()) { e.preventDefault(); save(); }
});

/* ---------- Resizable splitters ---------- */
function drag(handle, target, axis, dir, min, max) {
  handle.onmousedown = e => {
    e.preventDefault(); handle.classList.add('drag'); const start = axis === 'x' ? e.clientX : e.clientY;
    const size = axis === 'x' ? target.offsetWidth : target.offsetHeight;
    const mv = ev => { const d = ((axis === 'x' ? ev.clientX : ev.clientY) - start) * dir; const v = Math.max(min, Math.min(max, size + d)); target.style[axis === 'x' ? 'width' : 'height'] = v + 'px'; };
    const up = () => { handle.classList.remove('drag'); removeEventListener('mousemove', mv); removeEventListener('mouseup', up); };
    addEventListener('mousemove', mv); addEventListener('mouseup', up);
  };
}
drag($('s1'), $('side'), 'x', 1, 140, 500); drag($('s3'), $('chat'), 'x', -1, 240, 640); drag($('s2'), $('panel'), 'y', -1, 60, 600);
