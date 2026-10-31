// Local codebase index: BM25 keyword search + optional embedding re-rank (Ollama nomic-embed-text, free).
const fs = require('fs');
const path = require('path');

const OLLAMA = process.env.OLLAMA_HOST ? (/^https?:/.test(process.env.OLLAMA_HOST) ? process.env.OLLAMA_HOST : 'http://' + process.env.OLLAMA_HOST) : 'http://localhost:11434';
const EMBED_MODEL = process.env.PRISM_EMBED_MODEL || 'nomic-embed-text';
const SKIP = new Set(['.git', 'node_modules', 'dist', 'build', '.next', '__pycache__', '.venv', 'venv', 'target', 'coverage', '.idea', '.vscode', 'vendor', '.antigravity']);
const TEXT = /\.(js|jsx|ts|tsx|mjs|cjs|json|md|py|go|rs|java|kt|c|h|cpp|hpp|cs|rb|php|swift|html|css|scss|vue|svelte|astro|sql|sh|yml|yaml|toml|glsl|vert|frag)$/i;
const MAX_FILES = 3000, MAX_BYTES = 300000, CHUNK = 50, OVERLAP = 10, MAX_EMBED = 1500;
const cache = new Map();

const tok = s => s.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase().match(/[a-z0-9_]{2,}/g) || [];

function listFiles(root) {
  const out = [];
  const walk = d => {
    let ents; try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      if (out.length >= MAX_FILES) return;
      if (SKIP.has(e.name) || e.name.startsWith('.') && e.isDirectory()) continue;
      const f = path.join(d, e.name);
      if (e.isDirectory()) walk(f);
      else if (TEXT.test(e.name) && !/(-lock\.json|\.min\.\w+|package-lock\.json)$/.test(e.name)) {
        try { const st = fs.statSync(f); if (st.size > 0 && st.size <= MAX_BYTES) out.push({ f, rel: path.relative(root, f), mtime: st.mtimeMs }); } catch {}
      }
    }
  };
  walk(root);
  return out;
}

function build(root, files) {
  const chunks = [], df = new Map();
  for (const { f, rel } of files) {
    let text; try { text = fs.readFileSync(f, 'utf8'); } catch { continue; }
    if (text.includes('\0')) continue;
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i += CHUNK - OVERLAP) {
      const body = lines.slice(i, i + CHUNK).join('\n');
      if (!body.trim()) continue;
      const toks = tok(rel + ' ' + body), tf = new Map();
      for (const t of toks) tf.set(t, (tf.get(t) || 0) + 1);
      for (const t of tf.keys()) df.set(t, (df.get(t) || 0) + 1);
      chunks.push({ file: rel, start: i + 1, end: Math.min(i + CHUNK, lines.length), text: body, tf, len: toks.length, vec: null });
      if (i + CHUNK >= lines.length) break;
    }
  }
  const avg = chunks.reduce((n, c) => n + c.len, 0) / (chunks.length || 1);
  return { root, chunks, df, avg, sig: signature(files), embedState: 'idle' };
}
const signature = files => files.length + ':' + Math.round(files.reduce((m, x) => Math.max(m, x.mtime), 0));

function getIndex(root) {
  const files = listFiles(root), sig = signature(files), cur = cache.get(root);
  if (cur && cur.sig === sig) return cur;
  const idx = build(root, files); cache.set(root, idx); return idx;
}

function bm25(idx, query, k = 40) {
  const q = [...new Set(tok(query))], N = idx.chunks.length, scores = [];
  if (!q.length) return [];
  for (const c of idx.chunks) {
    let s = 0;
    for (const t of q) {
      const f = c.tf.get(t); if (!f) continue;
      const n = idx.df.get(t) || 0, idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
      s += idf * (f * 2.2) / (f + 1.2 * (0.25 + 0.75 * c.len / idx.avg));
    }
    if (s > 0) scores.push([c, s]);
  }
  return scores.sort((a, b) => b[1] - a[1]).slice(0, k);
}

async function embed(texts, signal) {
  const r = await fetch(OLLAMA + '/api/embed', { method: 'POST', signal, body: JSON.stringify({ model: EMBED_MODEL, input: texts }) });
  const j = await r.json();
  if (j.error || !j.embeddings) throw new Error(j.error || 'no embeddings');
  return j.embeddings;
}
const cos = (a, b) => { let d = 0, x = 0, y = 0; for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; x += a[i] * a[i]; y += b[i] * b[i]; } return d / (Math.sqrt(x * y) || 1); };

// Background: embed chunks if the embedding model is installed (silently skipped otherwise)
async function ensureEmbeddings(idx) {
  if (idx.embedState !== 'idle') return;
  idx.embedState = 'running';
  try {
    const tags = await (await fetch(OLLAMA + '/api/tags', { signal: AbortSignal.timeout(3000) })).json();
    if (!(tags.models || []).some(m => m.name.startsWith(EMBED_MODEL))) { idx.embedState = 'unavailable'; return; }
    const todo = idx.chunks.slice(0, MAX_EMBED);
    for (let i = 0; i < todo.length; i += 16) {
      const batch = todo.slice(i, i + 16), vecs = await embed(batch.map(c => (c.file + '\n' + c.text).slice(0, 1500)));
      batch.forEach((c, j) => c.vec = vecs[j]);
    }
    idx.embedState = 'ready';
  } catch { idx.embedState = 'unavailable'; }
}

async function search(root, query, limit = 8) {
  const idx = getIndex(root);
  if (!idx.chunks.length) return 'The workspace has no indexable source files yet.';
  ensureEmbeddings(idx);
  let ranked = bm25(idx, query, 40);
  let mode = 'keyword';
  if (idx.embedState === 'ready' && ranked.length) {
    try {
      const [qv] = await embed([query]), top = ranked[0][1] || 1;
      const pool = new Map(ranked.map(([c, s]) => [c, s / top]));
      for (const c of idx.chunks) if (c.vec) { const sim = cos(qv, c.vec); if (sim > 0.5) pool.set(c, (pool.get(c) || 0) * 0.5 + sim); }
      ranked = [...pool.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40); mode = 'hybrid (keyword + semantic)';
    } catch {}
  }
  const seen = new Set(), out = [];
  for (const [c] of ranked) {
    const key = c.file + ':' + Math.floor(c.start / 40); if (seen.has(key)) continue; seen.add(key);
    out.push(`${c.file}:${c.start}-${c.end}\n${c.text.split('\n').slice(0, 14).map(l => '  ' + l.slice(0, 140)).join('\n')}`);
    if (out.length >= limit) break;
  }
  return out.length ? `Top matches (${mode}, ${idx.chunks.length} chunks indexed):\n\n` + out.join('\n\n') : 'No relevant code found. Try different keywords.';
}

// ---- repo map: tree + top-level symbols, so the agent knows the layout without reading everything ----
const SYMBOL = /^\s*(?:export\s+(?:default\s+)?)?(?:async\s+)?(?:function\*?\s+([\w$]+)|class\s+([\w$]+)|(?:const|let|var)\s+([\w$]+)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[\w$]+)\s*=>|def\s+(\w+)|func\s+(?:\([^)]*\)\s*)?(\w+)|(?:pub\s+)?fn\s+(\w+)|interface\s+(\w+)|type\s+(\w+)\s*=)/;
function repoMap(root, maxChars = 6000) {
  const files = listFiles(root).sort((a, b) => a.rel.localeCompare(b.rel));
  let out = `Workspace ${path.basename(root)}: ${files.length} source files\n`;
  for (const { f, rel } of files) {
    if (out.length > maxChars) { out += '… (truncated)\n'; break; }
    let syms = [];
    if (/\.(js|jsx|ts|tsx|mjs|cjs|py|go|rs|java|kt|cs|rb|php|swift|vue|svelte)$/i.test(rel)) {
      try { for (const l of fs.readFileSync(f, 'utf8').split('\n')) { const m = SYMBOL.exec(l); if (m) { const n = m.slice(1).find(Boolean); if (n && !syms.includes(n)) syms.push(n); if (syms.length >= 8) break; } } } catch {}
    }
    out += rel + (syms.length ? '  → ' + syms.join(', ') : '') + '\n';
  }
  return out;
}

module.exports = { search, repoMap, getIndex, bm25, tok };
