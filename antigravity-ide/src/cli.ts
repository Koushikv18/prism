#!/usr/bin/env node
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { Agent } from './agent.js';
import type { ToolContext } from './tools.js';

const c = { cy: (s: string) => `\x1b[36m${s}\x1b[0m`, gr: (s: string) => `\x1b[32m${s}\x1b[0m`, dim: (s: string) => `\x1b[2m${s}\x1b[0m`, yl: (s: string) => `\x1b[33m${s}\x1b[0m` };
const key = process.env.GEMINI_API_KEY;
if (!key) { console.error('Set GEMINI_API_KEY (get one at https://aistudio.google.com/apikey).'); process.exit(1); }

const rl = readline.createInterface({ input, output });
const ctx: ToolContext = {
  root: null,
  setRoot(p) { ctx.root = p; console.log(c.dim(`  workspace → ${p}`)); },
  status: m => console.log(c.cy(`  ◈ ${m}`)),
  approve: async cmd => (await rl.question(c.yl(`  ⚠ Run \`${cmd}\`? [y/N] `))).trim().toLowerCase() === 'y',
};
const agent = new Agent(key, ctx);

console.log(`${c.gr('◈ Antigravity')} ${c.dim('— local AI coding environment. Ctrl+C to exit.')}`);
console.log(c.dim('Try: "Clone https://github.com/owner/repo, find where authentication is handled, and explain it."\n'));
for (;;) {
  const q = (await rl.question(c.gr('› '))).trim();
  if (!q) continue;
  try { await agent.run(q, t => console.log(`\n${t}\n`)); } catch (e) { console.error(`Error: ${(e as Error).message}`); }
}
