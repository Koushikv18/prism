// Real-model smoke test:  node scripts/selftest.js
// Env: PRISM_PROVIDER=ollama|claude|gemini  PRISM_MODEL=<model>  (ANTHROPIC_API_KEY / GEMINI_API_KEY for cloud)
const os = require('os'), fs = require('fs'), path = require('path');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'prism-selftest-'));
process.env.HOME = process.env.USERPROFILE = tmp; // isolate learnings/checkpoints
const { runAgent } = require('../agent');
const provider = process.env.PRISM_PROVIDER || 'ollama', model = process.env.PRISM_MODEL || 'qwen2.5-coder:7b';
const apiKey = provider === 'claude' ? process.env.ANTHROPIC_API_KEY : provider === 'gemini' ? process.env.GEMINI_API_KEY : undefined;
const root = path.join(tmp, 'ws'); fs.mkdirSync(root); const tools = [];
const task = 'Create fib.js exporting fib(n) (iterative). Create test.js that asserts fib(10)===55 and prints PASS. Run it with node test.js. Then call learn with one short lesson.';
runAgent({ provider, model, apiKey, root, messages: [{ role: 'user', content: task }].map(m => provider === 'gemini' ? { role: 'user', parts: [{ text: m.content }] } : m),
  approve: async () => true, emit: ev => { if (ev.type === 'tool') { tools.push(ev.name); console.log('⚙', ev.name); } if (ev.type === 'text') console.log(ev.text); } })
  .then(() => {
    const ok = { 'fib.js written': fs.existsSync(path.join(root, 'fib.js')), 'test.js written': fs.existsSync(path.join(root, 'test.js')), 'ran a command': tools.includes('run_command'), 'learned a lesson': fs.existsSync(path.join(tmp, '.prism', 'learnings.md')) };
    for (const [k, v] of Object.entries(ok)) console.log(v ? '✅' : '❌', k);
    process.exit(Object.values(ok).every(Boolean) ? 0 : 1);
  }).catch(e => { console.error('❌ error:', e.message); process.exit(2); });
