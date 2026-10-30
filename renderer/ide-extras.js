/* Prism IDE extras: streaming chat, tool cards, agent-change review (diff/keep/revert), Ctrl+K inline edit, ghost-text autocomplete */
(() => {
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const md = text => {
    const parts = String(text).split(/(```[\w+-]*\n[\s\S]*?(?:```|$))/g);
    return parts.map(p => {
      const m = p.match(/^```([\w+-]*)\n([\s\S]*?)(?:```)?$/);
      if (m) return `<div class="code"><div class="code-h"><span>${esc(m[1] || 'code')}</span><button class="copy">Copy</button></div><pre><code>${esc(m[2].replace(/\n$/, ''))}</code></pre></div>`;
      return esc(p).replace(/`([^`\n]+)`/g, '<code>$1</code>').replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>').replace(/\n{2,}/g, '<br><br>').replace(/\n/g, '<br>');
    }).join('');
  };
  const scroll = () => { $('log').scrollTop = 1e9; };
  const add = (cls, html) => { const d = document.createElement('div'); d.className = 'msg ' + cls; d.innerHTML = html; $('log').append(d); scroll(); return d; };
  $('log').addEventListener('click', e => {
    if (e.target.classList.contains('copy')) { navigator.clipboard.writeText(e.target.closest('.code').querySelector('code').textContent); e.target.textContent = 'Copied'; setTimeout(() => e.target.textContent = 'Copy', 1200); }
  });

  /* ---------- chat ---------- */
  let live = null, liveText = '', status = null, timer = null, t0 = 0;
  const tools = new Map(), touched = new Set();
  const brief = i => { const v = i.path || i.command || i.query || i.url || i.name || i.template || ''; return String(v).slice(0, 70); };
  const PrismChat = {
    busy: false,
    start() {
      this.busy = true; touched.clear(); t0 = Date.now();
      status = add('status', '<span class="spin"></span><span class="st">Working…</span><button class="stop">Stop</button>');
      status.querySelector('.stop').onclick = () => prism.stopAgent();
      timer = setInterval(() => { const s = Math.round((Date.now() - t0) / 1000); const st = status && status.querySelector('.st'); if (st) st.textContent = 'Working… ' + s + 's'; }, 1000);
    },
    async end(r) {
      await new Promise(res => setTimeout(res, 250)); // let trailing stream events render first
      this.busy = false; clearInterval(timer); if (status) status.remove(); status = null; live = null; liveText = '';
      if (r && r.error) {
        const stopped = /stopped by user/i.test(r.error);
        add(stopped ? 'tool' : 'err', esc(stopped ? 'Stopped.' : r.error));
      } else if (touched.size) add('ai summary', '✦ Changed ' + touched.size + ' file' + (touched.size > 1 ? 's' : '') + ': ' + [...touched].map(esc).join(', ') + '. Review each change in the editor (View diff · Keep · Revert).');
    },
    handle(ev) {
      if (ev.type === 'delta') { if (!live) { live = add('ai', ''); liveText = ''; } liveText += ev.text; live.innerHTML = md(liveText); scroll(); }
      else if (ev.type === 'final') { if (ev.text) { if (!live) live = add('ai', ''); live.innerHTML = md(ev.text); scroll(); } else if (live) live.remove(); live = null; liveText = ''; }
      else if (ev.type === 'text') add('ai', md(ev.text));
      else if (ev.type === 'tool') {
        live = null; liveText = '';
        const d = document.createElement('details'); d.className = 'msg tool';
        d.innerHTML = `<summary><b>${esc(ev.name)}</b> <span>${esc(brief(ev.input || {}))}</span></summary><pre></pre>`;
        d.querySelector('pre').textContent = JSON.stringify(ev.input, null, 1).slice(0, 2500);
        $('log').append(d); if (ev.id) tools.set(ev.id, d);
        if (status) $('log').append(status); scroll();
      } else if (ev.type === 'tool_result') {
        const d = tools.get(ev.id); if (!d) return;
        d.querySelector('pre').textContent += '\n──────\n' + String(ev.output).slice(0, 3000);
        if (/^Error/.test(String(ev.output))) d.classList.add('bad');
      }
    },
  };
  window.PrismChat = PrismChat;

  /* ---------- review of agent edits ---------- */
  const changes = new Map(); let diffEd = null, diffOrig = null, bar = null;
  const wrap = () => $('editorWrap');
  function ensureBar() {
    if (bar) return bar;
    bar = document.createElement('div'); bar.id = 'review-bar'; bar.hidden = true;
    bar.innerHTML = '<span class="rb-t"></span><div class="rb-s"></div><button data-a="diff">View diff</button><button data-a="keep" class="ok">Keep</button><button data-a="revert" class="danger">Revert</button>';
    wrap().parentNode.insertBefore(bar, wrap());
    bar.onclick = e => { const a = e.target.dataset && e.target.dataset.a; if (a) review(a); };
    return bar;
  }
  function hideDiff() { const d = $('diff-wrap'); if (d) d.style.display = 'none'; if (diffEd) diffEd.setModel(null); if (diffOrig) { diffOrig.dispose(); diffOrig = null; } }
  function updateBar() {
    ensureBar(); const c = changes.get(active);
    if (!c) { bar.hidden = true; hideDiff(); return; }
    bar.hidden = false; bar.querySelector('.rb-t').textContent = c.isNew ? '✦ Prism created this file' : '✦ Prism changed this file';
    bar.querySelector('[data-a=revert]').style.display = c.isNew ? 'none' : '';
  }
  async function review(a) {
    const p = active, c = changes.get(p), t = tabs.get(p); if (!c || !t) return;
    if (a === 'keep') { changes.delete(p); updateBar(); }
    if (a === 'revert') { await prism.write(p, c.before); t.saved = c.before; t.model.setValue(c.before); changes.delete(p); updateBar(); refresh(); }
    if (a === 'diff') {
      let d = $('diff-wrap');
      if (d && d.style.display === 'block') { hideDiff(); bar.querySelector('[data-a=diff]').textContent = 'View diff'; return; }
      if (!d) { d = document.createElement('div'); d.id = 'diff-wrap'; wrap().append(d); }
      if (!diffEd) diffEd = monaco.editor.createDiffEditor(d, { theme: 'prism-dark', automaticLayout: true, renderSideBySide: false, originalEditable: false, fontSize: 13.5, fontFamily: '"JetBrains Mono", Consolas, monospace' });
      diffOrig = monaco.editor.createModel(c.before || '', t.model.getLanguageId());
      diffEd.setModel({ original: diffOrig, modified: t.model }); d.style.display = 'block'; bar.querySelector('[data-a=diff]').textContent = 'Hide diff';
    }
  }
  async function fileChanged(ev) {
    if (ev.before === undefined) { refresh(); return; } // directory-level change (scaffold)
    touched.add(ev.path);
    const prev = changes.get(ev.path); changes.set(ev.path, { before: prev ? prev.before : ev.before, isNew: prev ? prev.isNew : !!ev.isNew });
    await refresh();
    const t = tabs.get(ev.path), text = await prism.read(ev.path);
    if (t) { t.saved = text; t.model.setValue(text); }
    await openFile(ev.path); show(ev.path); hideDiff(); updateBar();
  }
  window.PrismReview = { fileChanged, updateBar };
  const wait = setInterval(() => { if (typeof editor !== 'undefined' && editor && typeof monaco !== 'undefined') { clearInterval(wait); init(); } }, 200);
  const nav = setInterval(() => { try { if (typeof active !== 'undefined' && window.__lastActive !== active) { window.__lastActive = active; updateBar(); } } catch {} }, 250);

  function init() {
    /* ---------- Ctrl+K inline edit ---------- */
    const box = document.createElement('div'); box.id = 'inline-edit'; box.hidden = true;
    box.innerHTML = '<span class="ie-i">✦</span><input placeholder="Describe the change…  Enter to apply · Esc to cancel" spellcheck="false"><span class="ie-s"></span>';
    wrap().append(box);
    const input = box.querySelector('input'), st = box.querySelector('.ie-s'); let sel = null, running = false;
    const close = () => { box.hidden = true; running = false; input.value = ''; st.textContent = ''; editor.focus(); };
    editor.addAction({ id: 'prism.inlineEdit', label: 'Prism: Edit selection with AI', keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyK],
      run: () => { if (!editor.getModel()) return; sel = editor.getSelection(); if (sel.isEmpty()) { const l = sel.startLineNumber; sel = new monaco.Selection(l, 1, l, editor.getModel().getLineMaxColumn(l)); } box.hidden = false; input.focus(); } });
    input.onkeydown = async e => {
      if (e.key === 'Escape') return close();
      if (e.key !== 'Enter' || running || !input.value.trim()) return;
      running = true; st.textContent = 'Editing…';
      const model = editor.getModel(), all = model.getValue(), a = model.getOffsetAt({ lineNumber: sel.startLineNumber, column: sel.startColumn }), b = model.getOffsetAt({ lineNumber: sel.endLineNumber, column: sel.endColumn });
      const r = await prism.inlineEdit({ instruction: input.value.trim(), code: all.slice(a, b), before: all.slice(Math.max(0, a - 1500), a), after: all.slice(b, b + 800), language: model.getLanguageId(), filePath: active });
      if (r.error) { st.textContent = r.error.slice(0, 120); running = false; return; }
      editor.pushUndoStop(); editor.executeEdits('prism-inline', [{ range: sel, text: r.text, forceMoveMarkers: true }]); editor.pushUndoStop();
      const end = model.getPositionAt(a + r.text.length), dec = editor.createDecorationsCollection([{ range: new monaco.Range(sel.startLineNumber, 1, end.lineNumber, 1), options: { isWholeLine: true, className: 'ai-edit-flash' } }]);
      setTimeout(() => dec.clear(), 2500); close();
    };

    /* ---------- ghost-text autocomplete (local model) ---------- */
    monaco.languages.registerInlineCompletionsProvider('*', {
      async provideInlineCompletions(model, pos, _ctx, token) {
        await new Promise(r => setTimeout(r, 450)); if (token.isCancellationRequested) return { items: [] };
        const prefix = model.getValueInRange({ startLineNumber: 1, startColumn: 1, endLineNumber: pos.lineNumber, endColumn: pos.column });
        if (prefix.trim().length < 3) return { items: [] };
        const suffix = model.getValueInRange({ startLineNumber: pos.lineNumber, startColumn: pos.column, endLineNumber: model.getLineCount(), endColumn: model.getLineMaxColumn(model.getLineCount()) });
        let text = await prism.complete({ prefix, suffix, language: model.getLanguageId() });
        if (token.isCancellationRequested || !text || !text.trim()) return { items: [] };
        text = text.split('\n').slice(0, 8).join('\n');
        return { items: [{ insertText: text, range: new monaco.Range(pos.lineNumber, pos.column, pos.lineNumber, pos.column) }] };
      },
      freeInlineCompletions() {},
    });
  }
})();
