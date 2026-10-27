// Prism agent loop: Claude with tools (read/write/list/run) scoped to the open workspace.
const fs = require('fs');
const path = require('path');
const os = require('os');
const { exec, execFile } = require('child_process');
const WORKSPACES = path.join(os.homedir(), '.prism', 'workspaces');
const GH = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+?(\.git)?\/?$/;
const SKIP = new Set(['.git', 'node_modules', 'dist', 'build', '.next', '__pycache__', '.venv']);

const MODEL = process.env.PRISM_MODEL || 'claude-sonnet-5-5';
const SYSTEM = 'You are Prism, an expert coding agent inside a personal IDE. Work inside the open workspace using your tools. Read before editing, make focused changes, run commands to verify, and explain briefly what you did.';

const TOOLS = [
  { name: 'list_dir', description: 'List files in a workspace-relative directory.', input_schema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } },
  { name: 'read_file', description: 'Read a workspace-relative text file.', input_schema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } },
  { name: 'write_file', description: 'Create or overwrite a workspace-relative file.', input_schema: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] } },
  { name: 'git_clone', description: 'Clone a public GitHub repo (https://github.com/owner/repo) into the Prism workspace folder and make it the active workspace.', input_schema: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] } },
  { name: 'code_search', description: 'Case-insensitive regex search across the workspace. Returns file:line matches.', input_schema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } },
  { name: 'run_command', description: 'Run a shell command in the workspace root (user must approve).', input_schema: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'] } },
];

function safe(root, rel) {
  if (!root) throw new Error('No workspace open. Use git_clone or ask the user to open a folder.');
  const p = path.resolve(root, rel || '.');
  if (p !== root && !p.startsWith(root + path.sep)) throw new Error('Path escapes workspace');
  return p;
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
    if (name === 'run_command') {
      if (!(await ctx.approve(input.command))) return 'User denied this command.';
      return await new Promise(res => exec(input.command, { cwd: ctx.root, timeout: 120000, maxBuffer: 2e6 },
        (err, out, errOut) => res(((out || '') + (errOut || '') + (err ? '\n[exit ' + err.code + ']' : '')).slice(-20000) || '(no output)')));
    }
    return 'Unknown tool';
  } catch (e) { return 'Error: ' + e.message; }
}

async function runClaude({ apiKey, messages, root, approve, emit, setRoot }) {
  const ctx = { root, approve, emit, setRoot };
  for (let step = 0; step < 25; step++) {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: MODEL, max_tokens: 4096, system: SYSTEM + '\nWorkspace: ' + root, tools: TOOLS, messages }),
    });
    const data = await r.json();
    if (data.error) throw new Error(data.error.message);
    messages.push({ role: 'assistant', content: data.content });
    const results = [];
    for (const b of data.content) {
      if (b.type === 'text') emit({ type: 'text', text: b.text });
      if (b.type === 'tool_use') {
        emit({ type: 'tool', name: b.name, input: b.input });
        results.push({ type: 'tool_result', tool_use_id: b.id, content: await runTool(b.name, b.input, ctx) });
      }
    }
    if (!results.length) return messages;
    messages.push({ role: 'user', content: results });
  }
  return messages;
}

const OLLAMA = process.env.OLLAMA_HOST || 'http://localhost:11434';

async function listOllamaModels() {
  const r = await fetch(OLLAMA + '/api/tags');
  return ((await r.json()).models || []).map(m => m.name);
}

// Local, free, offline: talks to Ollama's /api/chat with tool calling.
async function runOllama({ model, messages, root, approve, emit, setRoot }) {
  const ctx = { root, approve, emit, setRoot };
  if (!messages.length || messages[0].role !== 'system') messages.unshift({ role: 'system', content: SYSTEM + '\nWorkspace: ' + root });
  const tools = TOOLS.map(t => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.input_schema } }));
  for (let step = 0; step < 25; step++) {
    let r;
    try { r = await fetch(OLLAMA + '/api/chat', { method: 'POST', body: JSON.stringify({ model, messages, tools, stream: false }) }); }
    catch { throw new Error('Cannot reach Ollama at ' + OLLAMA + '. Install it from ollama.com and make sure it is running.'); }
    const data = await r.json();
    if (data.error) throw new Error(data.error);
    const m = data.message;
    messages.push(m);
    if (m.content) emit({ type: 'text', text: m.content });
    if (!m.tool_calls || !m.tool_calls.length) return messages;
    for (const c of m.tool_calls) {
      const name = c.function.name;
      const args = typeof c.function.arguments === 'string' ? JSON.parse(c.function.arguments) : c.function.arguments;
      emit({ type: 'tool', name, input: args });
      messages.push({ role: 'tool', tool_name: name, content: await runTool(name, args, ctx) });
    }
  }
  return messages;
}

// Google Gemini via REST function calling (no extra dependency).
const upper = s => Array.isArray(s) ? s.map(upper) : s && typeof s === 'object' ? Object.fromEntries(Object.entries(s).map(([k, v]) => [k, k === 'type' ? String(v).toUpperCase() : upper(v)])) : s;
async function runGemini({ apiKey, model, messages, root, approve, emit, setRoot }) {
  const ctx = { root, approve, emit, setRoot };
  const decls = TOOLS.map(t => ({ name: t.name, description: t.description, parameters: upper(t.input_schema) }));
  for (let step = 0; step < 25; step++) {
    const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent', {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({ systemInstruction: { parts: [{ text: SYSTEM + (ctx.root ? '\nWorkspace: ' + ctx.root : '\nNo workspace open yet.') }] }, contents: messages, tools: [{ functionDeclarations: decls }] }),
    });
    const data = await r.json();
    if (data.error) throw new Error(data.error.message);
    const content = data.candidates && data.candidates[0] && data.candidates[0].content;
    if (!content) throw new Error('Gemini returned no content' + (data.promptFeedback ? ': ' + JSON.stringify(data.promptFeedback) : ''));
    messages.push(content);
    const results = [];
    for (const p of content.parts || []) {
      if (p.text) emit({ type: 'text', text: p.text });
      if (p.functionCall) {
        emit({ type: 'tool', name: p.functionCall.name, input: p.functionCall.args || {} });
        results.push({ functionResponse: { name: p.functionCall.name, response: { output: await runTool(p.functionCall.name, p.functionCall.args || {}, ctx) } } });
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
