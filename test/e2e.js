// End-to-end test: launches the real Prism app (headless on Linux) against a scripted fake Ollama and drives the UI.
// Run: npm run test:e2e   (Linux needs xvfb: sudo apt install xvfb)
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path'), http = require('http');
const WebSocket = require('ws');
const ROOT = path.join(__dirname, '..'), MOCK_PORT = 11999, CDP = 9444;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const procs = [];
const launch = (cmd, args, opts = {}) => { const p = spawn(cmd, args, { stdio: 'ignore', detached: process.platform !== 'win32', ...opts }); procs.push(p); return p; };
const killAll = () => procs.forEach(p => { try { process.platform === 'win32' ? p.kill() : process.kill(-p.pid, 'SIGKILL'); } catch {} });
const getJson = u => new Promise((res, rej) => http.get(u, r => { let b = ''; r.on('data', d => b += d); r.on('end', () => { try { res(JSON.parse(b)); } catch (e) { rej(e); } }); }).on('error', rej));

class Page {
  constructor(ws) { this.ws = ws; this.id = 0; this.pend = {}; this.errors = [];
    ws.on('message', m => { const j = JSON.parse(m);
      if (j.id && this.pend[j.id]) this.pend[j.id](j);
      if (j.method === 'Runtime.exceptionThrown') this.errors.push((j.params.exceptionDetails.exception || {}).description || j.params.exceptionDetails.text); }); }
  send(method, params) { return new Promise(r => { const i = ++this.id; this.pend[i] = r; this.ws.send(JSON.stringify({ id: i, method, params })); }); }
  async eval(expr) { const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.result.exceptionDetails) throw new Error(r.result.exceptionDetails.exception ? r.result.exceptionDetails.exception.description : 'eval failed');
    return r.result.result.value; }
  async waitFor(expr, ms = 8000) { const t = Date.now(); while (Date.now() - t < ms) { try { if (await this.eval(expr)) return true; } catch {} await sleep(150); } throw new Error('timeout waiting for: ' + expr.slice(0, 90)); }
}

const results = []; const tests = [];
const test = (name, fn) => tests.push([name, fn]);
const assert = (c, msg) => { if (!c) throw new Error(msg || 'assertion failed'); };

(async () => {
  const ws1 = fs.mkdtempSync(path.join(os.tmpdir(), 'prism-ws-')), data = fs.mkdtempSync(path.join(os.tmpdir(), 'prism-data-'));
  fs.writeFileSync(ws1 + '/hello.txt', 'line1\nline2\n'); fs.writeFileSync(ws1 + '/bad.ts', 'let n: number = "oops";\n');
  fs.writeFileSync(ws1 + '/calc.js', 'const items=[1,2,3];\nlet total=0;\nfor(const i of items){total+=i}\n');
  launch(process.execPath, [path.join(__dirname, 'mock-ollama.js')], { env: { ...process.env, MOCK_PORT: String(MOCK_PORT) } });
  const electron = require(path.join(ROOT, 'node_modules', 'electron'));
  const eargs = ['.', `--remote-debugging-port=${CDP}`, `--user-data-dir=${data}`, ...(process.platform === 'linux' ? ['--no-sandbox'] : [])];
  const env = { ...process.env, OLLAMA_HOST: '127.0.0.1:' + MOCK_PORT };
  const headless = process.platform === 'linux' && !process.env.DISPLAY;
  launch(headless ? 'xvfb-run' : electron, headless ? ['-a', '-s', '-screen 0 1400x900x24', electron, ...eargs] : eargs, { cwd: ROOT, env });
  let page;
  for (let i = 0; i < 60 && !page; i++) { await sleep(500); try { const t = (await getJson(`http://127.0.0.1:${CDP}/json`)).find(x => x.type === 'page'); if (t) { const ws = new WebSocket(t.webSocketDebuggerUrl); await new Promise((r, j) => { ws.on('open', r); ws.on('error', j); }); page = new Page(ws); } } catch {} }
  if (!page) { console.error('Could not start Prism (is xvfb installed on Linux?)'); killAll(); process.exit(2); }
  await page.send('Runtime.enable');
  await page.waitFor("typeof prism !== 'undefined' && typeof monaco !== 'undefined' && !!document.getElementById('prompt')", 30000);
  await sleep(1500);
  const ask = async (text, ms = 3500) => { await page.eval(`(()=>{const p=document.getElementById('prompt');p.value=${JSON.stringify(text)};p.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))})()`); await sleep(400); await page.waitFor('!PrismChat.busy', 20000); await sleep(300); };
  const log = () => page.eval("document.getElementById('log').innerText");
  const termText = () => page.eval("(()=>{const b=prismTerm.buffer.active;let s=[];for(let i=0;i<b.length;i++){const l=b.getLine(i);s.push(l?l.translateToString(true):'')}return s.filter(Boolean).join('\\n')})()");
  const term = async (cmd, ms) => { await page.eval(`prismTermRun(${JSON.stringify(cmd)})`); await sleep(ms || 1200); };

  test('boots without script errors and opens a workspace', async () => {
    assert(page.errors.length === 0, 'startup errors: ' + page.errors.join(' | '));
    await page.eval(`prism.openPath(${JSON.stringify(ws1)}).then(r=>opened(r.root))`);
    await page.waitFor("document.getElementById('tree').innerText.includes('hello.txt')");
  });
  test('agent task streams, runs a tool and edits the file', async () => {
    await ask('overwrite hello.txt please');
    assert(fs.readFileSync(ws1 + '/hello.txt', 'utf8') === 'hi from agent v2', 'file not written');
    const l = await log(); assert(/Creating the file/.test(l) && /write_file/.test(l) && /All set/.test(l), 'chat incomplete: ' + l);
  });
  test('review bar, diff view and revert work', async () => {
    assert(await page.eval("!document.getElementById('review-bar').hidden"), 'review bar missing');
    await page.eval("document.querySelector('#review-bar [data-a=diff]').click()"); await sleep(700);
    assert(await page.eval("getComputedStyle(document.getElementById('diff-wrap')).display") === 'block', 'diff not shown');
    await page.eval("document.querySelector('#review-bar [data-a=diff]').click(); document.querySelector('#review-bar [data-a=revert]').click()"); await sleep(800);
    assert(fs.readFileSync(ws1 + '/hello.txt', 'utf8') === 'line1\nline2\n', 'revert failed');
  });
  test('run card: Undo run removes a new file', async () => {
    await ask('please nudge: create a file');
    assert(fs.existsSync(ws1 + '/a.txt'), 'nudge flow did not create a.txt');
    await page.eval("(()=>{const c=document.querySelectorAll('#log .msg.summary');c[c.length-1].querySelector('[data-a=undo]').click()})()"); await sleep(900);
    assert(!fs.existsSync(ws1 + '/a.txt'), 'undo did not delete the new file');
  });
  test('small-model tool aliases (create_file/file_path/contents) work', async () => {
    await ask('alias test: create a file'); assert(fs.readFileSync(ws1 + '/alias.txt', 'utf8') === 'alias ok');
  });
  test('terminal streams output, keeps cwd, handles stdin and Ctrl+C', async () => {
    await term('echo hello; sleep 1; echo done', 2500); assert(/hello/.test(await termText()) && /done/.test(await termText()), 'no output');
    await term('cd /tmp'); await term('pwd'); assert(/^\/tmp$/m.test(await termText()), 'cwd not kept');
    await term('sleep 30', 500);
    await page.eval("document.getElementById('cmd').dispatchEvent(new KeyboardEvent('keydown',{key:'c',ctrlKey:true,bubbles:true}))"); await sleep(1200);
    assert(await page.eval("document.getElementById('cmd').placeholder") === 'run command...', 'Ctrl+C did not stop the process');
    await term('read x; echo got:$x', 500);
    await page.eval("(()=>{const c=document.getElementById('cmd');c.value='banana';c.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))})()"); await sleep(1200);
    assert(/got:banana/.test(await termText()), 'stdin not delivered');
  });
  test('TypeScript language service reports errors (Monaco workers)', async () => {
    await page.eval("openFile('bad.ts')"); await sleep(4000);
    const m = await page.eval("monaco.editor.getModelMarkers({}).map(x=>x.message)"); assert(m.some(x => /not assignable/.test(x)), 'no diagnostics: ' + JSON.stringify(m));
  });
  test('Ctrl+K inline edit rewrites the selection', async () => {
    await page.eval("openFile('calc.js')"); await sleep(500);
    await page.eval("(()=>{editor.setSelection(new monaco.Selection(2,1,3,32));editor.focus();editor.getAction('prism.inlineEdit').run()})()"); await sleep(300);
    await page.eval("(()=>{const i=document.querySelector('#inline-edit input');i.value='use reduce';i.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))})()"); await sleep(2500);
    assert(/reduce/.test(await page.eval('editor.getValue()')), 'selection not rewritten');
  });
  test('autocomplete returns a local-model suggestion', async () => {
    const t = await page.eval("prism.complete({prefix:'function add(a,b){\\n  return ',suffix:'\\n}'})"); assert(/completed_by_ai/.test(t), 'no completion: ' + t);
  });
  test('@file mentions autocomplete and attach file contents', async () => {
    await page.eval("(()=>{const p=document.getElementById('prompt');p.focus();p.value='look at @hel';p.selectionStart=p.selectionEnd=p.value.length;p.dispatchEvent(new Event('input',{bubbles:true}))})()"); await sleep(300);
    assert(await page.eval("!document.getElementById('at-pop').hidden && document.getElementById('at-pop').innerText.includes('hello.txt')"), 'popup missing');
    await page.eval("window.dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',bubbles:true}))"); await page.eval("document.getElementById('prompt').dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',bubbles:true}))"); await sleep(200);
    assert(/@hello\.txt /.test(await page.eval("document.getElementById('prompt').value")), 'mention not inserted');
    const a = await page.eval("PrismChat.attach('see @hello.txt and @nope.txt')"); assert(a.length === 1 && a[0].path === 'hello.txt' && /line1/.test(a[0].content), 'attach failed');
    await page.eval("document.getElementById('prompt').value=''");
  });
  test('agent context includes editor problems and recent terminal output', async () => {
    const c = await page.eval('getIdeContext()'); assert(c.problems.some(p => /bad\.ts/.test(p)), 'problems missing: ' + JSON.stringify(c.problems)); assert(/got:banana/.test(c.terminalTail), 'terminal tail missing');
  });
  test('missing model gives an actionable error', async () => {
    await page.eval("prism.setSettings({model:'missing-model'})"); await ask('create something');
    assert(/ollama pull missing-model/.test(await log()), 'error text missing'); await page.eval("prism.setSettings({model:'qwen2.5-coder:7b'})");
  });

  let failed = 0;
  for (const [name, fn] of tests) { try { await fn(); console.log('  ✓ ' + name); } catch (e) { failed++; console.log('  ✗ ' + name + '\n      ' + e.message); } }
  console.log(`\n${tests.length - failed}/${tests.length} e2e tests passed`);
  killAll(); process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); killAll(); process.exit(1); });
process.on('SIGINT', () => { killAll(); process.exit(1); });
