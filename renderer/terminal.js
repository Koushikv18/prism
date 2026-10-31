/* Streaming terminal: live output (ANSI colours), persistent cwd, stdin to running programs, Ctrl+C, history. */
(() => {
  const term = new Terminal({ fontFamily: '"JetBrains Mono", Consolas, monospace', fontSize: 12.5, convertEol: true, scrollback: 5000, disableStdin: true, cursorBlink: false,
    theme: { background: '#0d1117', foreground: '#c9d1d9', cursor: '#0d1117', selectionBackground: '#264f78' } });
  const fit = new FitAddon.FitAddon(); term.loadAddon(fit); term.open($('termout'));
  const refit = () => { try { fit.fit(); } catch {} };
  new ResizeObserver(refit).observe($('termout')); setTimeout(refit, 100);
  window.prismTerm = term;

  let cur = null, n = 0; const history = []; let hi = 0;
  const setPrompt = cwd => { if (cwd) $('ps').textContent = cwd.split(/[\\/]/).filter(Boolean).pop() + ' $'; };
  prism.onTermData(({ id, data }) => { if (id === cur) term.write(data); });
  prism.onTermExit(({ id, code, cwd }) => {
    if (id !== cur) return;
    term.write(code === 0 || code === null ? '' : `\r\n\x1b[31m[exit ${code}]\x1b[0m\r\n`);
    cur = null; $('cmd').placeholder = 'run command...'; setPrompt(cwd);
    if (typeof refresh === 'function') refresh(); if (typeof gitBranch === 'function') gitBranch();
  });
  window.prismTermRun = (cmd) => { // also used by tests / other UI
    cur = 'term_' + (++n); term.write(`\x1b[36m$ ${cmd}\x1b[0m\r\n`); $('cmd').placeholder = 'running… type to send input, Ctrl+C to stop';
    return prism.termRun(cur, cmd);
  };
  const orig = window.openedHook; // reset cwd when the workspace changes
  const resetOnOpen = setInterval(() => { if (typeof root !== 'undefined' && root !== window.__termRoot) { window.__termRoot = root; prism.termReset(); setPrompt(root); } }, 500);

  $('cmd').onkeydown = e => {
    const el = e.target;
    if (e.key === 'c' && e.ctrlKey && cur) { e.preventDefault(); prism.termKill(cur); term.write('^C\r\n'); return; }
    if (e.key === 'l' && e.ctrlKey) { e.preventDefault(); term.clear(); return; }
    if (e.key === 'ArrowUp' && !cur) { e.preventDefault(); hi = Math.max(0, hi - 1); el.value = history[hi] || ''; return; }
    if (e.key === 'ArrowDown' && !cur) { e.preventDefault(); hi = Math.min(history.length, hi + 1); el.value = history[hi] || ''; return; }
    if (e.key !== 'Enter') return;
    const text = el.value; el.value = '';
    if (cur) { term.write(text + '\r\n'); prism.termStdin(cur, text + '\n'); return; }
    if (!text.trim()) return;
    history.push(text); hi = history.length;
    if (text.trim() === 'clear' || text.trim() === 'cls') { term.clear(); return; }
    window.prismTermRun(text);
  };
})();
