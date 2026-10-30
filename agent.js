// Prism agent loop: Claude with tools (read/write/list/run) scoped to the open workspace.
const fs = require('fs');
const path = require('path');
const os = require('os');
const { exec, execFile } = require('child_process');
const WORKSPACES = path.join(os.homedir(), '.prism', 'workspaces');
const GH = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+?(\.git)?\/?$/;
const SKIP = new Set(['.git', 'node_modules', 'dist', 'build', '.next', '__pycache__', '.venv']);

const MODEL = process.env.PRISM_MODEL || 'claude-sonnet-5-5';
const SYSTEM0 = 'You are Prism, an expert coding agent inside a personal IDE. Work inside the open workspace using your tools. Read before editing, make focused changes, run commands to verify, and explain briefly what you did.';
const SYSTEM = SYSTEM0 + ' Prefer edit_file for small changes and code_search/analyze_repo to explore. Use remember to save durable project facts. REVERSE ENGINEERING: when asked to study a repo, clone_reference it, run analyze_repo, read entry points and core modules, then write ARCHITECTURE.md (purpose, module map, data flow, key algorithms, public API, build/run, trade-offs) and a clean-room build plan. Re-implement from your understanding in your own code; never copy source verbatim; report the license.';
const memo = r => { try { return '\n\nProject memory (PRISM.md):\n' + fs.readFileSync(path.join(r, 'PRISM.md'), 'utf8').slice(0, 8000); } catch { return ''; } };

const TOOLS = [
  { name: 'list_dir', description: 'List files in a workspace-relative directory.', input_schema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } },
  { name: 'read_file', description: 'Read a workspace-relative text file.', input_schema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } },
  { name: 'write_file', description: 'Create or overwrite a workspace-relative file.', input_schema: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] } },
  { name: 'git_clone', description: 'Clone a public GitHub repo (https://github.com/owner/repo) into the Prism workspace folder and make it the active workspace.', input_schema: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] } },
  { name: 'code_search', description: 'Case-insensitive regex search across the workspace. Returns file:line matches.', input_schema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } },
  { name: 'edit_file', description: 'Replace one exact, unique snippet in a file (safer than rewriting the whole file).', input_schema: { type: 'object', properties: { path: { type: 'string' }, old: { type: 'string' }, new: { type: 'string' } }, required: ['path', 'old', 'new'] } },
  { name: 'analyze_repo', description: 'Map a repo: file counts, languages, manifests, entry points, top dependencies, biggest files, license.', input_schema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } },
  { name: 'clone_reference', description: 'Shallow-clone a public GitHub repo into .prism/refs/<name> inside the workspace as a read-only reference to study (does not change the active workspace).', input_schema: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] } },
  { name: 'remember', description: 'Save a durable project note to PRISM.md (re-read every session).', input_schema: { type: 'object', properties: { note: { type: 'string' } }, required: ['note'] } },
  { name: 'run_command', description: 'Run a shell command in the workspace root (user must approve).', input_schema: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'] } },
];

function safe(root, rel) {
  if (!root) throw new Error('No workspace open. Use git_clone or ask the user to open a folder.');
  const p = path.resolve(root, rel || '.');
  if (p !== root && !p.startsWith(root + path.sep)) throw new Error('Path escapes workspace');
  return p;
}

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

async function runTool(name, input, ctx) {
  try {
    if (name === 'list_dir') {
      return fs.readdirSync(safe(ctx.root, input.path), { withFileTypes: true })
        .filter(e => e.name !== 'node_modules' && e.name !== '.git')
        .map(e => e.name + (e.isDirectory() ? '/' : '')).join('\n') || '(empty)';
    }
    if (name === 'read_file') return fs.readFileSync(safe(ctx.root, input.path), 'utf8').slice(0, 100000);
    if (name === 'write_file') {
      const p = safe(ctx.root, input.path);
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, input.content);
      ctx.emit({ type: 'file_changed', path: input.path });
      return 'Wrote ' + input.path;
    }
    if (name === 'git_clone') {
      if (!GH.test(input.url)) return 'Error: only https://github.com/owner/repo URLs are allowed';
      const dest = path.join(WORKSPACES, input.url.replace(/\/$/, '').replace(/\.git$/, '').split('/').slice(-2).join('__'));
      fs.mkdirSync(WORKSPACES, { recursive: true });
      const git = args => new Promise(res => execFile('git', args, { cwd: fs.existsSync(dest) ? dest : WORKSPACES, timeout: 300000 }, (err, o, e) => res(err ? 'Error: ' + (e || err.message) : o || 'ok')));
      const out = fs.existsSync(path.join(dest, '.git')) ? await git(['pull', '--ff-only']) : await git(['clone', '--depth', '1', input.url, dest]);
      if (out.startsWith('Error')) return out;
      ctx.root = dest; ctx.setRoot && ctx.setRoot(dest);
      return 'Cloned to ' + dest + '. Top level: ' + fs.readdirSync(dest).filter(n => !SKIP.has(n)).join(', ');
    }
    if (name === 'code_search') {
      const re = new RegExp(input.query, 'i'), hits = [];
      const walk = d => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { if (hits.length >= 200) return; if (SKIP.has(e.name)) continue; const f = path.join(d, e.name); if (e.isDirectory()) walk(f); else { let t; try { t = fs.readFileSync(f, 'utf8'); } catch { continue; } if (t.includes('\0')) continue; t.split('\n').forEach((l, i) => { if (hits.length < 200 && re.test(l)) hits.push(path.relative(ctx.root, f) + ':' + (i + 1) + ': ' + l.trim().slice(0, 160)); }); } } };
      walk(safe(ctx.root, '.')); return hits.join('\n') || 'No matches.';
    }
    if (name === 'edit_file') {
      const p = safe(ctx.root, input.path), t = fs.readFileSync(p, 'utf8'), n = t.split(input.old).length - 1;
      if (n !== 1) return `Error: snippet matched ${n} times; it must match exactly once.`;
      fs.writeFileSync(p, t.replace(input.old, () => input.new)); ctx.emit({ type: 'file_changed', path: input.path });
      return 'Edited ' + input.path;
    }
    if (name === 'analyze_repo') return analyze(ctx.root, input.path);
    if (name === 'remember') { fs.appendFileSync(path.join(safe(ctx.root, '.'), 'PRISM.md'), '- ' + input.note + '\n'); return 'Saved to PRISM.md'; }
    if (name === 'clone_reference') {
      if (!GH.test(input.url)) return 'Error: only https://github.com/owner/repo URLs are allowed';
      if (!(await ctx.approve('git clone --depth 1 ' + input.url + ' (reference only)'))) return 'User denied this clone.';
      const nm = input.url.replace(/\/$/, '').replace(/\.git$/, '').split('/').pop(), dest = path.join(safe(ctx.root, '.'), '.prism', 'refs', nm);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      const err = await new Promise(r => execFile('git', ['clone', '--depth', '1', input.url, dest], { timeout: 300000 }, (e, o, er) => r(e ? er || e.message : '')));
      const gi = path.join(ctx.root, '.gitignore'); try { if (!fs.existsSync(gi) || !fs.readFileSync(gi, 'utf8').includes('.prism/')) fs.appendFileSync(gi, '\n.prism/\n'); } catch {}
      return err ? 'Clone failed: ' + err : 'Cloned to .prism/refs/' + nm + '. Use analyze_repo on that path.';
    }
    if (name === 'run_command') {
      if (!(await ctx.approve(input.command))) return 'User denied this command.';
      return await new Promise(res => exec(input.command, { cwd: ctx.root, timeout: 120000, maxBuffer: 2e6 },
        (err, out, errOut) => res(((out || '') + (errOut || '') + (err ? '\n[exit ' + err.code + ']' : '')).slice(-20000) || '(no output)')));
    }
    return 'Unknown tool';
  } catch (e) { return 'Error: ' + e.message; }
}

async function runClaude({ apiKey, model, messages, root, approve, emit, setRoot, signal }) {
  const ctx = { root, approve, emit, setRoot };
  const claudeModel = model || MODEL || 'claude-3-5-sonnet-20241022';
  for (let step = 0; step < 40; step++) {
    if (signal?.aborted) throw new Error('Agent stopped by user');
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal,
      headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: claudeModel, max_tokens: 8192, system: SYSTEM + '\nWorkspace: ' + root + memo(root), tools: TOOLS, messages }),
    });
    const data = await r.json();
    if (data.error) throw new Error(data.error.message);
    messages.push({ role: 'assistant', content: data.content });
    const results = [];
    for (const b of data.content) {
      if (signal?.aborted) throw new Error('Agent stopped by user');
      if (b.type === 'text') emit({ type: 'text', text: b.text });
      if (b.type === 'tool_use') {
        const tid = b.id || ('tool_' + Math.random().toString(36).slice(2, 8));
        emit({ type: 'tool', id: tid, name: b.name, input: b.input });
        const out = await runTool(b.name, b.input, ctx);
        emit({ type: 'tool_result', id: tid, name: b.name, output: out });
        results.push({ type: 'tool_result', tool_use_id: b.id, content: out });
      }
    }
    if (!results.length) return messages;
    messages.push({ role: 'user', content: results });
  }
  return messages;
}

const OLLAMA = process.env.OLLAMA_HOST || 'http://localhost:11434';

async function listOllamaModels() {
  try {
    const controller = new AbortController();
    const to = setTimeout(() => controller.abort(), 2500);
    const r = await fetch(OLLAMA + '/api/tags', { signal: controller.signal });
    clearTimeout(to);
    if (!r.ok) return [];
    return ((await r.json()).models || []).map(m => m.name);
  } catch {
    return [];
  }
}

// Local, free, offline: talks to Ollama's /api/chat with tool calling.
async function runOllama({ model, messages, root, approve, emit, setRoot, signal }) {
  const ctx = { root, approve, emit, setRoot };
  if (!messages.length || messages[0].role !== 'system') messages.unshift({ role: 'system', content: SYSTEM + '\nWorkspace: ' + root + memo(root) });
  const tools = TOOLS.map(t => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.input_schema } }));
  for (let step = 0; step < 40; step++) {
    if (signal?.aborted) throw new Error('Agent stopped by user');
    let r;
    try { r = await fetch(OLLAMA + '/api/chat', { method: 'POST', signal, body: JSON.stringify({ model, messages, tools, stream: false }) }); }
    catch (e) {
      if (signal?.aborted) throw new Error('Agent stopped by user');
      throw new Error('Cannot reach Ollama at ' + OLLAMA + '. Install it from ollama.com and make sure it is running.');
    }
    const data = await r.json();
    if (data.error) throw new Error(data.error);
    const m = data.message;
    messages.push(m);
    if (m.content) emit({ type: 'text', text: m.content });
    if (!m.tool_calls || !m.tool_calls.length) return messages;
    for (const c of m.tool_calls) {
      if (signal?.aborted) throw new Error('Agent stopped by user');
      const name = c.function.name;
      const args = typeof c.function.arguments === 'string' ? JSON.parse(c.function.arguments) : c.function.arguments;
      const tid = c.id || ('tool_' + Math.random().toString(36).slice(2, 8));
      emit({ type: 'tool', id: tid, name, input: args });
      const out = await runTool(name, args, ctx);
      emit({ type: 'tool_result', id: tid, name, output: out });
      messages.push({ role: 'tool', tool_name: name, content: out });
    }
  }
  return messages;
}

// Google Gemini via REST function calling (no extra dependency).
const upper = s => Array.isArray(s) ? s.map(upper) : s && typeof s === 'object' ? Object.fromEntries(Object.entries(s).map(([k, v]) => [k, k === 'type' ? String(v).toUpperCase() : upper(v)])) : s;
async function runGemini({ apiKey, model, messages, root, approve, emit, setRoot, signal }) {
  const ctx = { root, approve, emit, setRoot };
  const decls = TOOLS.map(t => ({ name: t.name, description: t.description, parameters: upper(t.input_schema) }));
  for (let step = 0; step < 40; step++) {
    if (signal?.aborted) throw new Error('Agent stopped by user');
    const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent', {
      method: 'POST', signal, headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({ systemInstruction: { parts: [{ text: SYSTEM + (ctx.root ? '\nWorkspace: ' + ctx.root + memo(ctx.root) : '\nNo workspace open yet.') }] }, contents: messages, tools: [{ functionDeclarations: decls }] }),
    });
    const data = await r.json();
    if (data.error) throw new Error(data.error.message);
    const content = data.candidates && data.candidates[0] && data.candidates[0].content;
    if (!content) throw new Error('Gemini returned no content' + (data.promptFeedback ? ': ' + JSON.stringify(data.promptFeedback) : ''));
    messages.push(content);
    const results = [];
    for (const p of content.parts || []) {
      if (signal?.aborted) throw new Error('Agent stopped by user');
      if (p.text) emit({ type: 'text', text: p.text });
      if (p.functionCall) {
        const tid = 'tool_' + Math.random().toString(36).slice(2, 8);
        emit({ type: 'tool', id: tid, name: p.functionCall.name, input: p.functionCall.args || {} });
        const out = await runTool(p.functionCall.name, p.functionCall.args || {}, ctx);
        emit({ type: 'tool_result', id: tid, name: p.functionCall.name, output: out });
        results.push({ functionResponse: { name: p.functionCall.name, response: { output: out } } });
      }
    }
    if (!results.length) return messages;
    messages.push({ role: 'user', parts: results });
  }
  return messages;
}

function runAgent(opts) {
  return opts.provider === 'claude' ? runClaude(opts) : opts.provider === 'gemini' ? runGemini(opts) : runOllama(opts);
}

module.exports = { runAgent, listOllamaModels, runTool };
