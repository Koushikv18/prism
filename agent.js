// Prism agent: streaming Claude + Ollama loops, 7 tools, diff review, project memory (PRISM.md).
const fs = require('fs'), path = require('path');
const { exec, execFile } = require('child_process');
const OLLAMA = process.env.OLLAMA_HOST || 'http://localhost:11434';
const BASE = 'You are Prism, an expert autonomous coding agent inside a personal IDE. Plan briefly, explore with list_dir/search/read_file before editing, prefer edit_file for small changes, verify by running tests or builds, fix failures, and end with a short summary. Use remember to save durable project facts. REVERSE ENGINEERING: when asked to study a repo, clone_reference it, run analyze_repo, read entry points and core modules, then write ARCHITECTURE.md (purpose, module map, data flow, key algorithms, public API, build/run, design trade-offs) and a clean-room build plan. Re-implement from your understanding in your own code; never copy source verbatim, and respect and report the license.';
const str = { type: 'string' };
const obj = (properties, required) => ({ type: 'object', properties, required });
const TOOLS = [
  { name: 'list_dir', description: 'List a workspace directory.', input_schema: obj({ path: str }, ['path']) },
  { name: 'read_file', description: 'Read a text file.', input_schema: obj({ path: str }, ['path']) },
  { name: 'search', description: 'Search workspace text (grep -rn).', input_schema: obj({ pattern: str }, ['pattern']) },
  { name: 'write_file', description: 'Create or overwrite a file (user reviews a diff).', input_schema: obj({ path: str, content: str }, ['path', 'content']) },
  { name: 'edit_file', description: 'Replace one exact, unique snippet in a file.', input_schema: obj({ path: str, old: str, new: str }, ['path', 'old', 'new']) },
  { name: 'run_command', description: 'Run a shell command in the workspace root (user approves).', input_schema: obj({ command: str }, ['command']) },
  { name: 'clone_reference', description: 'Shallow-clone a public https git repo into .prism/refs/<name> as a read-only reference to study.', input_schema: obj({ url: str }, ['url']) },
  { name: 'analyze_repo', description: 'Map a repo: file counts, languages, manifests, entry points, top dependencies, biggest files, license.', input_schema: obj({ path: str }, ['path']) },
  { name: 'remember', description: 'Save a durable project note to PRISM.md.', input_schema: obj({ note: str }, ['note']) },
];
const safe = (root, rel) => { const p = path.resolve(root, rel || '.'); if (p !== root && !p.startsWith(root + path.sep)) throw new Error('Path escapes workspace'); return p; };
const system = root => { let m = ''; try { m = '\n\nProject memory (PRISM.md):\n' + fs.readFileSync(path.join(root, 'PRISM.md'), 'utf8').slice(0, 8000); } catch {} return BASE + '\nWorkspace: ' + root + m; };

function analyze(root, rel) {
  const base = safe(root, rel), ext = {}, imp = {}, big = [], ent = [], man = []; let n = 0, lic = '';
  const skip = ['node_modules', '.git', 'dist', 'build', '__pycache__', '.venv', 'vendor', '.prism'];
  const walk = d => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { if (skip.includes(e.name)) continue; const p = path.join(d, e.name);
    if (e.isDirectory()) { walk(p); continue; } if (++n > 5000) return; const r = path.relative(base, p), x = path.extname(e.name).toLowerCase() || e.name, sz = fs.statSync(p).size;
    ext[x] = (ext[x] || 0) + 1; big.push([r, sz]);
    if (/^(package\.json|requirements\.txt|pyproject\.toml|go\.mod|Cargo\.toml|pom\.xml|build\.gradle|Gemfile|composer\.json|Dockerfile|Makefile)$/.test(e.name)) man.push(r);
    if (/^(main|index|app|server|cli|__main__)\.[a-z]+$/i.test(e.name)) ent.push(r);
    if (/^licen[sc]e/i.test(e.name)) lic = fs.readFileSync(p, 'utf8').slice(0, 120).replace(/\s+/g, ' ');
    if (/\.(js|jsx|ts|tsx|mjs|py|go|rs|java)$/.test(x) && sz < 200000) for (const m of fs.readFileSync(p, 'utf8').matchAll(/from\s+['"]([^'"]+)['"]|require\(['"]([^'"]+)['"]\)|^\s*(?:from|import)\s+([\w.]+)/gm)) { const k = m[1] || m[2] || m[3]; if (k && !k.startsWith('.')) imp[k] = (imp[k] || 0) + 1; } } };
  walk(base);
  const top = (o, k) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, k).map(([a, b]) => `${a} (${b})`).join(', ');
  return `Files: ${n}\nLanguages: ${top(ext, 10)}\nManifests: ${man.slice(0, 15).join(', ')}\nEntry candidates: ${ent.slice(0, 15).join(', ')}\nTop dependencies: ${top(imp, 25)}\nLargest files: ${big.sort((a, b) => b[1] - a[1]).slice(0, 10).map(([a, b]) => `${a} (${b}B)`).join(', ')}\nLicense: ${lic || 'none found'}`;
}

async function runTool(name, i, ctx) {
  const { root, emit } = ctx;
  try {
    if (name === 'list_dir') return fs.readdirSync(safe(root, i.path), { withFileTypes: true }).filter(e => !['node_modules', '.git'].includes(e.name)).map(e => e.name + (e.isDirectory() ? '/' : '')).join('\n') || '(empty)';
    if (name === 'read_file') return fs.readFileSync(safe(root, i.path), 'utf8').slice(0, 100000);
    if (name === 'search') return await new Promise(r => execFile('grep', ['-rnI', '--exclude-dir=node_modules', '--exclude-dir=.git', '-m', '5', '--', i.pattern, '.'], { cwd: root, maxBuffer: 1e6 }, (e, o) => r((o || '(no matches)').slice(0, 12000))));
    if (name === 'write_file' || name === 'edit_file') {
      const p = safe(root, i.path); const old = fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
      let next = i.content;
      if (name === 'edit_file') { const n = old.split(i.old).length - 1; if (n !== 1) return `Error: snippet matched ${n} times; it must match exactly once.`; next = old.replace(i.old, () => i.new); }
      if (!(await ctx.review(i.path, old, next))) return 'User rejected this change.';
      fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, next); emit({ type: 'file_changed', path: i.path });
      return 'Applied ' + i.path;
    }
    if (name === 'run_command') {
      if (!(await ctx.approve(i.command))) return 'User denied this command.';
      return await new Promise(r => exec(i.command, { cwd: root, timeout: 180000, maxBuffer: 2e6 }, (e, o, er) => r(((o || '') + (er || '') + (e ? `\n[exit ${e.code}]` : '')).slice(-20000) || '(no output)')));
    }
    if (name === 'analyze_repo') return analyze(root, i.path);
    if (name === 'clone_reference') {
      if (!/^https:\/\/[\w.-]+\/[\w./-]+$/.test(i.url)) return 'Error: provide an https git URL';
      if (!(await ctx.approve('git clone --depth 1 ' + i.url))) return 'User denied this clone.';
      const nm = path.basename(i.url).replace(/\.git$/, ''), dest = path.join(root, '.prism', 'refs', nm); fs.mkdirSync(path.dirname(dest), { recursive: true });
      const err = await new Promise(r => execFile('git', ['clone', '--depth', '1', i.url, dest], (e, o, er) => r(e ? er || e.message : '')));
      const gi = path.join(root, '.gitignore'); try { if (!fs.existsSync(gi) || !fs.readFileSync(gi, 'utf8').includes('.prism/')) fs.appendFileSync(gi, '\n.prism/\n'); } catch {}
      return err ? 'Clone failed: ' + err : 'Cloned to .prism/refs/' + nm;
    }
    if (name === 'remember') { fs.appendFileSync(path.join(root, 'PRISM.md'), '- ' + i.note + '\n'); return 'Saved to PRISM.md'; }
    return 'Unknown tool';
  } catch (e) { return 'Error: ' + e.message; }
}

async function* lines(res) {
  const d = new TextDecoder(); let b = '';
  for await (const c of res.body) { b += d.decode(c, { stream: true }); let n; while ((n = b.indexOf('\n')) >= 0) { const l = b.slice(0, n).trim(); b = b.slice(n + 1); if (l) yield l; } }
  if (b.trim()) yield b.trim();
}

async function claudeTurn({ apiKey, model, root, messages, emit }) {
  const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model, max_tokens: 8192, stream: true, system: system(root), tools: TOOLS, messages }) });
  if (!r.ok) throw new Error((await r.json()).error?.message || 'API error ' + r.status);
  const bl = [];
  for await (const l of lines(r)) {
    if (!l.startsWith('data:')) continue; const e = JSON.parse(l.slice(5));
    if (e.type === 'content_block_start') bl[e.index] = { ...e.content_block, text: e.content_block.text || '', json: '' };
    else if (e.type === 'content_block_delta') { const b = bl[e.index];
      if (e.delta.type === 'text_delta') { b.text += e.delta.text; emit({ type: 'delta', text: e.delta.text }); }
      else if (e.delta.type === 'input_json_delta') b.json += e.delta.partial_json; }
  }
  return bl.filter(Boolean).map(b => b.type === 'tool_use' ? { type: 'tool_use', id: b.id, name: b.name, input: b.json ? JSON.parse(b.json) : {} } : { type: 'text', text: b.text });
}

async function runClaude(o) {
  const ctx = { root: o.root, emit: o.emit, approve: o.approve, review: o.review };
  for (let s = 0; s < 40; s++) {
    const content = await claudeTurn(o); o.emit({ type: 'turn_end' });
    o.messages.push({ role: 'assistant', content });
    const res = [];
    for (const b of content) if (b.type === 'tool_use') { o.emit({ type: 'tool', name: b.name, input: b.input }); res.push({ type: 'tool_result', tool_use_id: b.id, content: await runTool(b.name, b.input, ctx) }); }
    if (!res.length) return; o.messages.push({ role: 'user', content: res });
  }
}

async function listOllamaModels() { return ((await (await fetch(OLLAMA + '/api/tags')).json()).models || []).map(m => m.name); }

async function runOllama(o) {
  const ctx = { root: o.root, emit: o.emit, approve: o.approve, review: o.review };
  const tools = TOOLS.map(t => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.input_schema } }));
  if (!o.messages.length || o.messages[0].role !== 'system') o.messages.unshift({ role: 'system', content: system(o.root) });
  for (let s = 0; s < 40; s++) {
    let r; try { r = await fetch(OLLAMA + '/api/chat', { method: 'POST', body: JSON.stringify({ model: o.model, messages: o.messages, tools, stream: true }) }); }
    catch { throw new Error('Cannot reach Ollama at ' + OLLAMA + '. Install it from ollama.com and keep it running.'); }
    if (!r.ok) throw new Error((await r.json()).error || 'Ollama error');
    let text = '', calls = [];
    for await (const l of lines(r)) { const m = JSON.parse(l).message; if (!m) continue; if (m.content) { text += m.content; o.emit({ type: 'delta', text: m.content }); } if (m.tool_calls) calls.push(...m.tool_calls); }
    o.emit({ type: 'turn_end' }); o.messages.push({ role: 'assistant', content: text, tool_calls: calls });
    if (!calls.length) return;
    for (const c of calls) { const n = c.function.name, a = typeof c.function.arguments === 'string' ? JSON.parse(c.function.arguments) : c.function.arguments;
      o.emit({ type: 'tool', name: n, input: a }); o.messages.push({ role: 'tool', tool_name: n, content: await runTool(n, a, ctx) }); }
  }
}
module.exports = { runAgent: o => (o.provider === 'claude' ? runClaude(o) : runOllama(o)), listOllamaModels };
