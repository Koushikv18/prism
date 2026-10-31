// One-command local setup: picks a coding model that fits this machine's RAM and pulls it with Ollama.
const os = require('os'), { spawnSync } = require('child_process');
const { recommendModel } = require('../agent');
const model = recommendModel();
console.log(`RAM ${(os.totalmem() / 2 ** 30).toFixed(0)} GB -> ${model}`);
const r = spawnSync('ollama', ['pull', model], { stdio: 'inherit', shell: process.platform === 'win32' });
if (r.error || r.status) { console.log('Ollama not found or pull failed. Install from https://ollama.com, then re-run.'); process.exit(1); }
console.log(`Ready. Test it: PRISM_MODEL=${model} node scripts/selftest.js`);
