const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), os = require('os'), path = require('path');
const { runTool } = require('../agent');
const indexer = require('../indexer');

const mk = () => { const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prism-')); return { root, ctx: { root, approve: async () => false, emit() {}, setRoot() {} } }; };

test('indexer finds code by meaning keywords and builds a repo map', async () => {
  const { root } = mk(); fs.mkdirSync(root + '/src');
  fs.writeFileSync(root + '/src/session.js', 'export function checkLogin(user, password) {\n  return createSession(user);\n}\n');
  fs.writeFileSync(root + '/src/canvas.js', 'export class Renderer { draw(scene) {} }\n');
  const hit = await indexer.search(root, 'where is user login handled');
  assert.match(hit, /src\/session\.js/);
  assert.match(indexer.repoMap(root), /checkLogin/);
});

test('tool aliases and argument names from small models are normalised', async () => {
  const { root, ctx } = mk();
  const r = await runTool('create_file', { file_path: 'a/b.txt', contents: 'hello' }, ctx);
  assert.match(r, /wrote|Success/i);
  assert.strictEqual(fs.readFileSync(root + '/a/b.txt', 'utf8'), 'hello');
});

test('paths cannot escape the workspace', async () => {
  const { ctx } = mk();
  assert.match(await runTool('read_file', { path: '../../etc/passwd' }, ctx), /escapes/i);
  assert.match(await runTool('write_file', { path: '../x.txt', content: 'x' }, ctx), /escapes/i);
});

test('git_clone and inspect_site reject unsafe targets', async () => {
  const { ctx } = mk();
  assert.match(await runTool('git_clone', { url: 'https://evil.example/x/y' }, ctx), /only https:\/\/github\.com/i);
  assert.match(await runTool('inspect_site', { url: 'http://localhost:3000' }, ctx), /public https/i);
  assert.match(await runTool('inspect_site', { url: 'https://192.168.1.5/' }, ctx), /public https/i);
});

test('optimize_audit flags real problems', async () => {
  const { root, ctx } = mk();
  fs.writeFileSync(root + '/index.html', '<html><head><script src="a.js"></script></head><body><img src="a.png"></body></html>');
  fs.writeFileSync(root + '/big.png', Buffer.alloc(400 * 1024));
  const r = await runTool('optimize_audit', {}, ctx);
  assert.match(r, /high/); assert.match(r, /big\.png/); assert.match(r, /alt/); assert.match(r, /viewport/);
});

test('scaffold copies a template and refuses a non-empty target', async () => {
  const { root, ctx } = mk();
  assert.match(await runTool('scaffold', { template: 'creative-site', dir: 'site' }, ctx), /Scaffolded/);
  assert.ok(fs.existsSync(root + '/site/index.html'));
  assert.match(await runTool('scaffold', { template: 'creative-site', dir: 'site' }, ctx), /not empty/);
});

test('shell commands need approval', async () => {
  const { ctx } = mk();
  assert.match(await runTool('run_command', { command: 'echo hi' }, ctx), /denied|declin|not approved/i);
});
