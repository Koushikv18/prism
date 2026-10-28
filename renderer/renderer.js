const $ = id => document.getElementById(id);
const tabs = new Map(); let editor, diffEd, current = null, bubble = null, reviewId = null;
require.config({ paths: { vs: '../node_modules/monaco-editor/min/vs' } });
require(['vs/editor/editor.main'], () => {
  monaco.editor.defineTheme('prism', { base: 'vs-dark', inherit: true, rules: [], colors: { 'editor.background': '#0b0d12' } });
  editor = monaco.editor.create($('editor'), { theme: 'prism', automaticLayout: true, minimap: { enabled: false }, fontSize: 13, value: '// Open a folder or clone a repo to start' });
  diffEd = monaco.editor.createDiffEditor($('diff'), { theme: 'prism', automaticLayout: true, readOnly: true, renderSideBySide: true });
  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, save);
});
const save = () => current && prism.write(current, tabs.get(current).model.getValue());
function drawTabs() { $('tabs').innerHTML = ''; for (const p of tabs.keys()) { const t = document.createElement('div'); t.className = 'tab' + (p === current ? ' on' : ''); t.textContent = p.split('/').pop() + '  ✕'; t.onclick = e => (e.offsetX > t.clientWidth - 22 ? closeTab(p) : openFile(p)); $('tabs').append(t); } }
function closeTab(p) { tabs.get(p).model.dispose(); tabs.delete(p); current = null; const n = [...tabs.keys()].pop(); n ? openFile(n) : (editor.setModel(monaco.editor.createModel('')), drawTabs()); }
async function openFile(p) { if (!tabs.has(p)) tabs.set(p, { model: monaco.editor.createModel(await prism.read(p), undefined, monaco.Uri.file('/' + p)) }); current = p; editor.setModel(tabs.get(p).model); drawTabs(); }
async function tree(rel, el, d = 0) { el.innerHTML = ''; for (const f of await prism.list(rel)) { const p = rel ? rel + '/' + f.name : f.name; const n = document.createElement('div'), k = document.createElement('div'); n.style.paddingLeft = d * 12 + 6 + 'px'; n.textContent = (f.dir ? '▸ ' : '') + f.name; n.onclick = async e => { e.stopPropagation(); f.dir ? (k.hasChildNodes() ? (k.innerHTML = '') : await tree(p, k, d + 1)) : openFile(p); }; el.append(n, k); } }
const refresh = () => tree('', $('tree'));
const opened = r => { if (r) { $('st1').textContent = '📁 ' + r; document.title = 'Prism – ' + r; refresh(); } };
$('open').onclick = async () => opened(await prism.openFolder());
$('clone').onclick = async () => { const r = await prism.clone($('url').value); r.error ? alert(r.error) : opened(r.root); };
$('save').onclick = save; $('key').onclick = async () => { const k = prompt('Anthropic API key (stored encrypted on this machine):'); if (k) await prism.setKey(k); };
async function sh(c) { $('termout').textContent += '$ ' + c + '\n' + (await prism.term(c)) + '\n'; $('termout').scrollTop = 1e9; }
$('cmd').onkeydown = e => { if (e.key === 'Enter') { const c = e.target.value; e.target.value = ''; sh(c); } };
$('gs').onclick = () => sh('git status -sb'); $('gp').onclick = () => sh('git push');
$('gc').onclick = () => { const m = prompt('Commit message:'); if (m) sh(`git add -A && git commit -m "${m.replace(/"/g, '\\"')}"`); };
const add = (t, c) => { const d = document.createElement('div'); d.className = 'msg ' + (c || ''); d.textContent = t; $('log').append(d); $('log').scrollTop = 1e9; return d; };
prism.onAgent(ev => {
  if (ev.type === 'delta') { bubble = bubble || add(''); bubble.textContent += ev.text; $('log').scrollTop = 1e9; }
  if (ev.type === 'turn_end') bubble = null;
  if (ev.type === 'tool') add('⚙ ' + ev.name + ' ' + JSON.stringify(ev.input).slice(0, 140), 'tool');
  if (ev.type === 'file_changed') { refresh(); if (tabs.has(ev.path)) prism.read(ev.path).then(t => tabs.get(ev.path).model.setValue(t)); }
  if (ev.type === 'review') { reviewId = ev.id; $('revt').textContent = 'Review change: ' + ev.path; $('rev').classList.add('show');
    diffEd.setModel({ original: monaco.editor.createModel(ev.old), modified: monaco.editor.createModel(ev.new) }); }
});
const decide = ok => { $('rev').classList.remove('show'); prism.reviewResult(reviewId, ok); };
$('acc').onclick = () => decide(true); $('rej').onclick = () => decide(false);
$('prompt').onkeydown = async e => { if (e.key !== 'Enter' || !e.target.value) return; const t = e.target.value; e.target.value = ''; add(t, 'me'); $('st2').textContent = '● working…'; const r = await prism.agent(t); $('st2').textContent = ''; if (r.error) add('Error: ' + r.error, 'err'); refresh(); };
async function loadModels() { const s = await prism.getSettings(); $('provider').value = s.provider; const sel = $('model'); sel.innerHTML = '';
  const names = s.provider === 'ollama' ? await prism.models() : ['claude-sonnet-5-5', 'claude-opus-5-5', 'claude-haiku-5-5'];
  if (!names.length) { sel.innerHTML = '<option>run: ollama pull qwen2.5-coder:7b</option>'; return; }
  for (const n of names) sel.add(new Option(n, n)); if (!names.includes(s.model)) await prism.setSettings({ model: names[0] }); else sel.value = s.model; }
$('provider').onchange = async e => { await prism.setSettings({ provider: e.target.value }); loadModels(); };
$('model').onchange = e => prism.setSettings({ model: e.target.value }); loadModels();
