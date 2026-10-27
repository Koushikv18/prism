const $ = id => document.getElementById(id);
let editor, current = null;
require.config({ paths: { vs: '../node_modules/monaco-editor/min/vs' } });
require(['vs/editor/editor.main'], () => { editor = monaco.editor.create($('editor'), { theme: 'vs-dark', automaticLayout: true, value: '// Open a folder or clone a repo' }); });

async function tree(rel, el, depth = 0) {
  el.innerHTML = '';
  for (const f of await prism.list(rel)) {
    const p = rel ? rel + '/' + f.name : f.name;
    const d = document.createElement('div'); d.style.paddingLeft = depth * 12 + 4 + 'px'; d.textContent = (f.dir ? '▸ ' : '') + f.name;
    const kids = document.createElement('div');
    d.onclick = async e => { e.stopPropagation(); if (f.dir) { kids.hasChildNodes() ? (kids.innerHTML = '') : await tree(p, kids, depth + 1); } else openFile(p); };
    el.append(d, kids);
  }
}
async function openFile(p) {
  current = p; const text = await prism.read(p);
  const model = monaco.editor.createModel(text, undefined, monaco.Uri.file('/' + p)); editor.setModel(model);
}
const refresh = () => tree('', $('tree'));
async function opened(root) { if (root) { document.title = 'Prism – ' + root; refresh(); } }
$('open').onclick = async () => opened(await prism.openFolder());
$('clone').onclick = async () => { const r = await prism.clone($('url').value); r.error ? alert(r.error) : opened(r.root); };
$('save').onclick = () => current && prism.write(current, editor.getValue());
$('key').onclick = async () => { const k = prompt('Anthropic API key (stored encrypted on this machine):'); if (k) await prism.setKey(k); };
$('cmd').onkeydown = async e => { if (e.key !== 'Enter') return; const c = e.target.value; e.target.value = ''; $('termout').textContent += '$ ' + c + '\n'; $('termout').textContent += await prism.term(c) + '\n'; $('termout').scrollTop = 1e9; };
const log = (t, c) => { const d = document.createElement('div'); d.className = c || ''; d.textContent = t; $('log').append(d); $('log').scrollTop = 1e9; };
prism.onAgent(ev => {
  if (ev.type === 'text') log(ev.text);
  if (ev.type === 'tool') log('⚙ ' + ev.name + ' ' + JSON.stringify(ev.input).slice(0, 160), 'tool');
  if (ev.type === 'file_changed') { refresh(); if (ev.path === current) openFile(current); }
});
$('prompt').onkeydown = async e => { if (e.key !== 'Enter') return; const t = e.target.value; e.target.value = ''; log('› ' + t, 'me'); const r = await prism.agent(t); if (r.error) log('Error: ' + r.error); refresh(); };
