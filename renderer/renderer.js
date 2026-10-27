const $ = id => document.getElementById(id);
let editor, root = '', active = null;
const tabs = new Map(); // path -> {model, saved, view}
let allFiles = [];

/* ---------- Monaco Editor with Cyberpunk Obsidian Theme ---------- */
require.config({ paths: { vs: '../node_modules/monaco-editor/min/vs' } });
require(['vs/editor/editor.main'], () => {
  monaco.editor.defineTheme('prism-dark', {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: 'comment', foreground: '525e75', fontStyle: 'italic' },
      { token: 'keyword', foreground: '10b981', fontStyle: 'bold' },
      { token: 'string', foreground: '38bdf8' },
      { token: 'number', foreground: 'f59e0b' },
      { token: 'type', foreground: 'a855f7' },
      { token: 'identifier', foreground: 'e2e8f0' }
    ],
    colors: {
      'editor.background': '#030712',
      'editor.foreground': '#f3f4f6',
      'editorLineNumber.foreground': '#374151',
      'editorLineNumber.activeForeground': '#10b981',
      'editor.lineHighlightBackground': '#0f172a66',
      'editorCursor.foreground': '#10b981',
      'editor.selectionBackground': '#1e293b99',
      'minimap.background': '#030712'
    }
  });

  editor = monaco.editor.create($('editor'), {
    theme: 'prism-dark',
    automaticLayout: true,
    fontSize: 13.5,
    fontFamily: '"JetBrains Mono", Consolas, monospace',
    fontLigatures: true,
    minimap: { enabled: true, side: 'right' },
    smoothScrolling: true,
    cursorSmoothCaretAnimation: 'on',
    bracketPairColorization: { enabled: true },
    padding: { top: 8 },
    model: null
  });

  editor.onDidChangeCursorPosition(e => {
    $('pos').textContent = `Ln ${e.position.lineNumber}, Col ${e.position.column}`;
  });
  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, save);
});

/* ---------- Ollama Health, Auto-Install & Orchestration ---------- */
let isOllamaOnline = false;

async function checkOllamaHealth() {
  const dot = $('ollama-status-dot');
  const modalText = $('modal-status-text');

  try {
    const health = await prism.checkOllama();
    isOllamaOnline = health.online;

    if (dot) {
      dot.className = 'status-dot ' + (health.online ? 'online' : 'offline');
      dot.title = health.online
        ? `Ollama: Connected (${health.models.length} model${health.models.length === 1 ? '' : 's'})`
        : 'Ollama: Not detected (click to open setup)';
    }

    if (modalText) {
      modalText.textContent = health.online
        ? `Connected • ${health.models.length} model(s) ready`
        : 'Offline • Daemon not running or not installed';
      modalText.style.color = health.online ? 'var(--ok)' : 'var(--err)';
    }
  } catch (e) {
    if (dot) {
      dot.className = 'status-dot offline';
      dot.title = 'Ollama: Connection error (click to open setup)';
    }
    if (modalText) modalText.textContent = 'Connection error: ' + e.message;
  }
}

function openOllamaModal() {
  $('ollama-modal').style.display = 'flex';
}
function closeOllamaModal() {
  $('ollama-modal').style.display = 'none';
}

if ($('ollama-status-dot')) $('ollama-status-dot').onclick = openOllamaModal;
if ($('btnOllama')) $('btnOllama').onclick = openOllamaModal;
if ($('close-modal')) $('close-modal').onclick = closeOllamaModal;

// Start Daemon
if ($('btn-start-daemon')) {
  $('btn-start-daemon').onclick = async () => {
    $('modal-log').textContent += '[Prism] Starting Ollama daemon in background...\n';
    $('btn-start-daemon').disabled = true;
    try {
      const res = await prism.startOllama();
      $('modal-log').textContent += `[Prism] ${res.message}\n`;
      await checkOllamaHealth();
      await loadModels();
    } catch (e) {
      $('modal-log').textContent += `[Error] ${e.message}\n`;
    } finally {
      $('btn-start-daemon').disabled = false;
    }
  };
}

// Auto Install
if ($('btn-install-ollama')) {
  $('btn-install-ollama').onclick = async () => {
    $('modal-log').textContent += '[Prism] Starting automated native installation...\n';
    $('btn-install-ollama').disabled = true;
    try {
      const res = await prism.installOllama();
      if (res.success) {
        $('modal-log').textContent += '[Prism] Ollama setup successfully finished.\n';
        await checkOllamaHealth();
        await loadModels();
      } else {
        $('modal-log').textContent += `[Error] ${res.error}\n`;
      }
    } catch (e) {
      $('modal-log').textContent += `[Exception] ${e.message}\n`;
    } finally {
      $('btn-install-ollama').disabled = false;
    }
  };
}

if (prism.onInstallLog) {
  prism.onInstallLog(log => {
    if ($('modal-log')) {
      $('modal-log').textContent += log;
      $('modal-log').scrollTop = 1e9;
    }
  });
}

// Quick pull buttons
document.querySelectorAll('[data-pull]').forEach(btn => {
  btn.onclick = async () => {
    const m = btn.dataset.pull;
    $('modal-log').textContent += `[Prism] Pulling model ${m}...\n`;
    await prism.pullModel(m);
    $('modal-log').textContent += `[Prism] Finished pulling ${m}.\n`;
    await loadModels();
  };
});

/* ---------- File Menu & Clone Modal ---------- */
const fileMenuBtn = $('file-menu-btn');
const fileMenu = $('file-menu');
if (fileMenuBtn && fileMenu) {
  fileMenuBtn.onclick = e => {
    e.stopPropagation();
    const isHidden = fileMenu.hidden;
    fileMenu.hidden = !isHidden;
    fileMenuBtn.setAttribute('aria-expanded', isHidden ? 'true' : 'false');
    if ($('settings-popover')) $('settings-popover').hidden = true;
  };
}

const menuOpen = $('menu-open');
if (menuOpen) menuOpen.onclick = async () => {
  if (fileMenu) fileMenu.hidden = true;
  opened(await prism.openFolder());
};

function openCloneModal() {
  if ($('clone-modal')) {
    $('clone-modal').style.display = 'flex';
    $('clone-url').value = '';
    $('clone-url').focus();
  }
}
function closeCloneModal() {
  if ($('clone-modal')) $('clone-modal').style.display = 'none';
}
if ($('close-clone-modal')) $('close-clone-modal').onclick = closeCloneModal;
if ($('cancel-clone')) $('cancel-clone').onclick = closeCloneModal;
if ($('submit-clone')) {
  $('submit-clone').onclick = async () => {
    const u = $('clone-url').value.trim();
    if (!u) return;
    $('submit-clone').textContent = 'Cloning…';
    $('submit-clone').disabled = true;
    try {
      const r = await prism.clone(u);
      if (r.error) alert(r.error);
      else {
        closeCloneModal();
        opened(r.root);
      }
    } finally {
      $('submit-clone').textContent = 'Clone';
      $('submit-clone').disabled = false;
    }
  };
}

if ($('menu-clone')) $('menu-clone').onclick = () => {
  if (fileMenu) fileMenu.hidden = true;
  openCloneModal();
};
if ($('menu-save')) $('menu-save').onclick = () => {
  if (fileMenu) fileMenu.hidden = true;
  save();
};
if ($('menu-save-all')) $('menu-save-all').onclick = () => {
  if (fileMenu) fileMenu.hidden = true;
  saveAll();
};
if ($('menu-close-tab')) $('menu-close-tab').onclick = () => {
  if (fileMenu) fileMenu.hidden = true;
  if (active) closeTab(active);
};

/* ---------- Settings Popover ---------- */
const btnSettings = $('btn-settings');
const settingsPopover = $('settings-popover');
if (btnSettings && settingsPopover) {
  btnSettings.onclick = e => {
    e.stopPropagation();
    const isHidden = settingsPopover.hidden;
    settingsPopover.hidden = !isHidden;
    if (fileMenu) fileMenu.hidden = true;
    if (isHidden) updateKeyHint();
  };
}
if ($('close-settings-btn')) {
  $('close-settings-btn').onclick = () => {
    if (settingsPopover) settingsPopover.hidden = true;
  };
}

async function updateKeyHint() {
  const s = await prism.getSettings();
  const prov = s.provider;
  const isLocal = prov === 'ollama';
  if ($('key-row')) $('key-row').style.display = isLocal ? 'none' : 'flex';
  if (!isLocal && $('key-hint')) {
    const has = await prism.hasKey(prov);
    $('key-hint').textContent = has
      ? `✓ ${prov === 'gemini' ? 'Gemini' : 'Anthropic'} API key is stored`
      : `No ${prov === 'gemini' ? 'Gemini' : 'Anthropic'} API key configured`;
    $('key-hint').style.color = has ? 'var(--ok)' : 'var(--warn)';
  }
}

if ($('key-save-btn')) {
  $('key-save-btn').onclick = async () => {
    const val = $('key-input').value.trim();
    if (!val) return;
    const s = await prism.getSettings();
    await prism.setKey(val, s.provider);
    $('key-input').value = '';
    await updateKeyHint();
  };
}

// Global outside-click dismiss
document.addEventListener('click', e => {
  if (fileMenu && !fileMenu.hidden && fileMenuBtn && !fileMenuBtn.contains(e.target) && !fileMenu.contains(e.target)) {
    fileMenu.hidden = true;
    fileMenuBtn.setAttribute('aria-expanded', 'false');
  }
  if (settingsPopover && !settingsPopover.hidden && btnSettings && !btnSettings.contains(e.target) && !settingsPopover.contains(e.target)) {
    settingsPopover.hidden = true;
  }
});

/* ---------- SVG Icons & Security Helper ---------- */
function escapeHtml(str) {
  if (typeof str !== 'string') return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const svgChevron = open => open
  ? `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>`
  : `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>`;

const svgFolder = open => `<svg class="file-icon folder" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${
  open
    ? '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>'
    : '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>'
}</svg>`;

const svgFile = n => {
  const ext = n.split('.').pop().toLowerCase();
  return `<svg class="file-icon ${ext}" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`;
};

/* ---------- Explorer & Search ---------- */
async function tree(rel, el, depth = 0, query = '') {
  el.innerHTML = '';
  const entries = await prism.list(rel);
  for (const f of entries) {
    const p = rel ? rel + '/' + f.name : f.name;
    if (query && !f.dir && !f.name.toLowerCase().includes(query.toLowerCase())) continue;

    const row = document.createElement('div');
    row.className = 'row';
    row.style.paddingLeft = depth * 14 + 10 + 'px';
    row.dataset.path = p;
    row.innerHTML = `<span class="ch">${f.dir ? svgChevron(false) : ''}</span>${f.dir ? svgFolder(false) : svgFile(f.name)}<span>${escapeHtml(f.name)}</span>`;

    const kids = document.createElement('div');
    row.onclick = async e => {
      e.stopPropagation();
      if (!f.dir) return openFile(p);
      const open = kids.hasChildNodes();
      row.querySelector('.ch').innerHTML = svgChevron(!open);
      open ? (kids.innerHTML = '') : await tree(p, kids, depth + 1, query);
    };
    el.append(row, kids);
  }
  mark();
}

const mark = () => document.querySelectorAll('.row').forEach(r => r.classList.toggle('on', r.dataset.path === active));

async function indexFiles(rel = '', out = []) {
  for (const f of await prism.list(rel)) {
    const p = rel ? rel + '/' + f.name : f.name;
    f.dir ? await indexFiles(p, out) : out.push(p);
    if (out.length > 4000) break;
  }
  return out;
}

const refresh = async () => {
  if (root) {
    const q = $('filter')?.value || '';
    await tree('', $('tree'), 0, q);
    allFiles = await indexFiles();
  }
};

$('filter').oninput = e => {
  if (root) tree('', $('tree'), 0, e.target.value);
};

/* ---------- Tabs / Files ---------- */
async function openFile(p) {
  if (!editor) return;
  if (!tabs.has(p)) {
    const text = await prism.read(p);
    const model = monaco.editor.createModel(text, undefined, monaco.Uri.file('/' + p));
    model.onDidChangeContent(() => {
      tabs.get(p).dirty = model.getValue() !== tabs.get(p).saved;
      renderTabs();
    });
    tabs.set(p, { model, saved: text, dirty: false, view: null });
  }
  show(p);
}

function show(p) {
  if (active && tabs.has(active)) tabs.get(active).view = editor.saveViewState();
  active = p;
  const t = tabs.get(p);
  editor.setModel(t.model);
  if (t.view) editor.restoreViewState(t.view);
  editor.focus();
  $('welcome').hidden = true;
  $('lang').textContent = t.model.getLanguageId();
  $('crumbs').textContent = p.split('/').join('  ›  ');
  $('fileinfo').textContent = p;
  renderTabs();
  mark();
}

function closeTab(p) {
  const t = tabs.get(p);
  if (t.dirty && !confirm(`${p} has unsaved changes. Close anyway?`)) return;
  t.model.dispose();
  tabs.delete(p);
  if (active === p) {
    active = null;
    const next = [...tabs.keys()].pop();
    if (next) show(next);
    else {
      editor.setModel(null);
      $('welcome').hidden = false;
      $('crumbs').textContent = '';
      $('fileinfo').textContent = 'No file open';
      $('lang').textContent = '';
    }
  }
  renderTabs();
  mark();
}

function renderTabs() {
  $('tabs').innerHTML = '';
  for (const [p, t] of tabs) {
    const d = document.createElement('div');
    d.className = 'tab' + (p === active ? ' on' : '');
    d.innerHTML = `${svgFile(p)}<span>${escapeHtml(p.split('/').pop())}</span><span class="x">${t.dirty ? '<span class="dot">●</span>' : '✕'}</span>`;
    d.onclick = () => show(p);
    d.querySelector('.x').onclick = e => { e.stopPropagation(); closeTab(p); };
    d.onauxclick = () => closeTab(p);
    $('tabs').append(d);
  }
}

async function save() {
  const t = tabs.get(active);
  if (!t) return;
  const v = t.model.getValue();
  await prism.write(active, v);
  t.saved = v;
  t.dirty = false;
  renderTabs();
}

async function saveAll() {
  for (const [p, t] of tabs) {
    const v = t.model.getValue();
    if (t.dirty) {
      await prism.write(p, v);
      t.saved = v;
      t.dirty = false;
    }
  }
  renderTabs();
}

/* ---------- Workspace Handlers ---------- */
async function opened(r) {
  if (!r) return;
  root = r;
  document.title = 'Prism – ' + r;
  $('rootName').textContent = r.split(/[\\/]/).pop();
  [...tabs.keys()].forEach(closeTab);
  await refresh();
  gitBranch();
}

async function gitBranch() {
  const b = (await prism.term('git branch --show-current')).trim();
  $('branch').textContent = '⎇ ' + (b && !b.includes('[exit') ? b : 'no-git');
}

if ($('open')) $('open').onclick = async () => opened(await prism.openFolder());
if ($('key')) $('key').onclick = () => {
  if ($('btn-settings')) $('btn-settings').click();
};

/* ---------- Terminal ---------- */
const hist = [];
let hi = 0;
$('cmd').onkeydown = async e => {
  if (e.key === 'ArrowUp') { hi = Math.max(0, hi - 1); e.target.value = hist[hi] || ''; return; }
  if (e.key === 'ArrowDown') { hi = Math.min(hist.length, hi + 1); e.target.value = hist[hi] || ''; return; }
  if (e.key !== 'Enter' || !e.target.value.trim()) return;
  const c = e.target.value;
  e.target.value = '';
  hist.push(c);
  hi = hist.length;
  $('termout').textContent += `$ ${c}\n`;
  $('termout').scrollTop = 1e9;
  $('termout').textContent += (await prism.term(c)) + '\n';
  $('termout').scrollTop = 1e9;
  refresh();
  gitBranch();
};

/* ---------- AI Agent Chat ---------- */
const log = (t, c = 'ai') => {
  const d = document.createElement('div');
  d.className = 'msg ' + c;
  d.textContent = t;
  $('log').append(d);
  $('log').scrollTop = 1e9;
  return d;
};

prism.onAgent(ev => {
  if (ev.type === 'text') log(ev.text);
  if (ev.type === 'tool') log('⚙ ' + ev.name + ' ' + JSON.stringify(ev.input).slice(0, 160), 'tool');
  if (ev.type === 'workspace') opened(ev.root);
  if (ev.type === 'file_changed') {
    refresh();
    const t = tabs.get(ev.path);
    if (t) prism.read(ev.path).then(x => { t.saved = x; t.model.setValue(x); });
  }
});

$('prompt').onkeydown = async e => {
  if (e.key !== 'Enter' || e.shiftKey) return;
  e.preventDefault();
  const t = e.target.value.trim();
  if (!t) return;
  e.target.value = '';
  log(t, 'me');
  await saveAll();
  const busy = log('Thinking…', 'tool');
  const r = await prism.agent(t);
  busy.remove();
  if (r.error) log(r.error, 'err');
  refresh();
};

/* ---------- Provider & Model Selector ---------- */
async function loadModels() {
  const s = await prism.getSettings();
  $('provider').value = s.provider;
  $('prov').textContent = { ollama: 'Local Ollama', gemini: 'Gemini', claude: 'Claude' }[s.provider];

  const sel = $('model');
  sel.innerHTML = '';
  const names = s.provider === 'ollama'
    ? await prism.models()
    : s.provider === 'gemini'
    ? ['gemini-2.5-flash', 'gemini-2.5-pro']
    : ['claude-3-5-sonnet', 'claude-3-opus'];

  if (!names.length) {
    sel.innerHTML = '<option value="">No local models (Click ⚡ to Install)</option>';
    return;
  }
  for (const n of names) sel.add(new Option(n, n));
  if (!names.includes(s.model)) await prism.setSettings({ model: names[0] });
  else sel.value = s.model;
}

$('provider').onchange = async e => {
  await prism.setSettings({ provider: e.target.value });
  await loadModels();
};
$('model').onchange = e => prism.setSettings({ model: e.target.value });

// Init routines
loadModels();
checkOllamaHealth();
setInterval(checkOllamaHealth, 8000);

/* ---------- Command Palette ---------- */
const cmds = () => [
  ['Open Folder', async () => opened(await prism.openFolder())],
  ['Clone Repository', openCloneModal],
  ['AI Settings', () => $('btn-settings') && $('btn-settings').click()],
  ['Save File', save],
  ['Save All', saveAll],
  ['Close Tab', () => active && closeTab(active)],
  ['Toggle Terminal', () => $('panel').hidden = !$('panel').hidden],
  ['Toggle Agent Panel', toggleChat],
  ['Ollama Setup', openOllamaModal],
  ['Format Document', () => editor?.getAction('editor.action.formatDocument').run()],
  ['Refresh Explorer', refresh],
].map(([n, fn]) => ({ label: n, hint: 'command', run: fn }));

let items = [], sel = 0, mode = 'files';
function openPalette(m) {
  mode = m;
  $('palette').hidden = false;
  $('pin').value = m === 'cmd' ? '>' : '';
  $('pin').focus();
  filter();
}
function filter() {
  let q = $('pin').value;
  if (q.startsWith('>')) mode = 'cmd';
  q = q.replace(/^>/, '').toLowerCase();
  const pool = mode === 'cmd'
    ? cmds()
    : allFiles.map(f => ({ label: f.split('/').pop(), hint: f, run: () => openFile(f) }));
  items = pool.filter(i => (i.label + i.hint).toLowerCase().includes(q)).slice(0, 40);
  sel = 0;
  drawList();
}
function drawList() {
  $('plist').innerHTML = '';
  items.forEach((it, i) => {
    const li = document.createElement('li');
    li.className = i === sel ? 'on' : '';
    li.innerHTML = `${it.label}<small>${it.hint}</small>`;
    li.onclick = () => pick(i);
    $('plist').append(li);
  });
}
function pick(i) {
  const it = items[i];
  closePalette();
  it && it.run();
}
const closePalette = () => { $('palette').hidden = true; editor?.focus(); };
$('pin').oninput = filter;
$('pin').onkeydown = e => {
  if (e.key === 'Escape') closePalette();
  if (e.key === 'ArrowDown') { sel = Math.min(items.length - 1, sel + 1); drawList(); e.preventDefault(); }
  if (e.key === 'ArrowUp') { sel = Math.max(0, sel - 1); drawList(); e.preventDefault(); }
  if (e.key === 'Enter') pick(sel);
};

const toggleChat = () => {
  $('chat').hidden = !$('chat').hidden;
  $('s3').hidden = $('chat').hidden;
};
$('togChat').onclick = toggleChat;
document.querySelector('[data-view="search"]').onclick = () => openPalette('files');

addEventListener('keydown', async e => {
  const m = e.ctrlKey || e.metaKey;
  if (m && e.shiftKey && e.key.toLowerCase() === 'p') { e.preventDefault(); openPalette('cmd'); }
  else if (m && e.key.toLowerCase() === 'p') { e.preventDefault(); openPalette('files'); }
  else if (m && e.key.toLowerCase() === 'o') { e.preventDefault(); opened(await prism.openFolder()); }
  else if (m && e.key === '`') { e.preventDefault(); $('panel').hidden = !$('panel').hidden; if (!$('panel').hidden) $('cmd').focus(); }
  else if (m && e.key.toLowerCase() === 'l') { e.preventDefault(); toggleChat(); if (!$('chat').hidden) $('prompt').focus(); }
  else if (m && e.key.toLowerCase() === 's' && !editor?.hasTextFocus()) { e.preventDefault(); save(); }
});

/* ---------- Resizable Splitters ---------- */
function drag(handle, target, axis, dir, min, max) {
  handle.onmousedown = e => {
    e.preventDefault();
    handle.classList.add('drag');
    const start = axis === 'x' ? e.clientX : e.clientY;
    const size = axis === 'x' ? target.offsetWidth : target.offsetHeight;
    const mv = ev => {
      const d = ((axis === 'x' ? ev.clientX : ev.clientY) - start) * dir;
      const v = Math.max(min, Math.min(max, size + d));
      target.style[axis === 'x' ? 'width' : 'height'] = v + 'px';
    };
    const up = () => {
      handle.classList.remove('drag');
      removeEventListener('mousemove', mv);
      removeEventListener('mouseup', up);
    };
    addEventListener('mousemove', mv);
    addEventListener('mouseup', up);
  };
}
drag($('s1'), $('side'), 'x', 1, 140, 500);
drag($('s3'), $('chat'), 'x', -1, 240, 640);
drag($('s2'), $('panel'), 'y', -1, 60, 600);
