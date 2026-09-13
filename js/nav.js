/* wecom KB — navigation: router, tabs, history, split view, keyboard, palette, hover peek */
(function () {
  'use strict';
  const KB = window.KB; const { $, $$, el, esc } = KB;
  const S = KB.state();

  /* ── router ───────────────────────────────────────────────────────────── */
  const nav = { stack: [], pos: -1, current: null, split: null, listeners: [] };
  KB.nav = nav;
  const parse = (hash) => {
    const p = (hash || '').replace(/^#\/?/, '').split('/').map(decodeURIComponent).filter((x) => x.length);
    const route = p[0] || 'library';
    return { route, a: p[1], b: p[2] };
  };
  const build = (r) => '#/' + [r.route, r.a, r.b].filter((x) => x != null && x !== '').map(encodeURIComponent).join('/');
  nav.titleOf = (r) => {
    if (r.route === 'library') return r.a && KB.CATS[r.a] ? KB.CATS[r.a].label : 'ספרייה';
    if (r.route === 'doc') { const d = KB.doc(r.a); return d ? d.title + (r.b ? ' §' + (KB.step(d, r.b) || {}).num : '') : 'מסמך'; }
    if (r.route === 'edit') return r.a === 'new' ? 'פריט ידע חדש' : 'עריכה: ' + ((KB.doc(r.a) || {}).title || '');
    if (r.route === 'history') return 'גרסאות: ' + ((KB.doc(r.a) || {}).title || '');
    return { trash: 'סל מיחזור', sources: 'מסמכי מקור', pinned: 'מוצמדים', recent: 'נצפו לאחרונה', drafts: 'טיוטות', fields: 'שדות CRM', blocks: 'בלוקים משותפים' }[r.route] || r.route;
  };
  nav.go = (route, a, b, opts) => {
    opts = opts || {};
    const r = { route, a, b };
    if (route === 'doc') {
      const d = KB.doc(a); if (!d) { KB.toast('המסמך לא נמצא', 'warn'); return; }
      openTab(a, opts.newTab);
    }
    const h = build(r);
    if (location.hash !== h) { if (opts.replace) history.replaceState(null, '', h); else { suppress = true; location.hash = h; } }
    render(r, opts.replace);
  };
  let suppress = false;
  function render(r, replace) {
    // local stack for Alt ←/→ and the trail
    if (!replace) {
      const same = nav.current && nav.current.route === r.route && nav.current.a === r.a && nav.current.b === r.b;
      if (!same) { nav.stack = nav.stack.slice(0, nav.pos + 1); nav.stack.push(r); nav.pos = nav.stack.length - 1; }
    } else if (nav.pos >= 0) nav.stack[nav.pos] = r;
    nav.current = r;
    if (r.route !== 'doc') nav.split = null;
    KB.emit('route', r);
    document.title = 'wecom | ' + nav.titleOf(r);
  }
  window.addEventListener('hashchange', () => {
    if (suppress) { suppress = false; return; }
    const r = parse(location.hash);
    // browser back/forward: sync our stack pointer if the hash matches a neighbour
    const eq = (x) => x && x.route === r.route && x.a === r.a && x.b === r.b;
    if (eq(nav.stack[nav.pos - 1])) nav.pos--; else if (eq(nav.stack[nav.pos + 1])) nav.pos++; else { nav.stack = nav.stack.slice(0, nav.pos + 1); nav.stack.push(r); nav.pos = nav.stack.length - 1; }
    nav.current = r; if (r.route === 'doc') openTab(r.a); if (r.route !== 'doc') nav.split = null;
    KB.emit('route', r); document.title = 'wecom | ' + nav.titleOf(r);
  });
  nav.back = () => { if (nav.pos <= 0) return; nav.pos--; const r = nav.stack[nav.pos]; suppress = true; location.hash = build(r); nav.current = r; if (r.route === 'doc') openTab(r.a); KB.emit('route', r); };
  nav.forward = () => { if (nav.pos >= nav.stack.length - 1) return; nav.pos++; const r = nav.stack[nav.pos]; suppress = true; location.hash = build(r); nav.current = r; if (r.route === 'doc') openTab(r.a); KB.emit('route', r); };
  nav.canBack = () => nav.pos > 0; nav.canForward = () => nav.pos < nav.stack.length - 1;
  nav.openDoc = (docId, stepId, opts) => nav.go('doc', docId, stepId, opts);
  nav.start = () => { const r = parse(location.hash); if (r.route === 'doc' && !KB.doc(r.a)) { location.hash = '#/library'; return; } if (r.route === 'doc') openTab(r.a); render(r, true); };

  /* ── tabs ─────────────────────────────────────────────────────────────── */
  function openTab(docId, forceNew) {
    S.tabs = S.tabs.filter((t) => KB.doc(t.docId));
    const i = S.tabs.findIndex((t) => t.docId === docId);
    if (i >= 0) { S.activeTab = i; }
    else if (forceNew || !S.tabs.length || S.activeTab == null || !S.tabs[S.activeTab]) { S.tabs.push({ docId }); S.activeTab = S.tabs.length - 1; }
    else { S.tabs[S.activeTab] = { docId }; }
    if (S.tabs.length > 8) { S.tabs.shift(); S.activeTab = Math.max(0, S.activeTab - 1); }
    KB.save();
  }
  nav.closeTab = (idx) => {
    const wasActive = idx === S.activeTab;
    S.tabs.splice(idx, 1);
    if (S.activeTab >= S.tabs.length) S.activeTab = S.tabs.length - 1;
    KB.save();
    if (wasActive) { if (S.tabs.length) nav.go('doc', S.tabs[S.activeTab].docId); else nav.go('library'); }
    else KB.emit('tabs');
  };
  nav.newTab = () => KB.palette.open({ mode: 'newtab' });

  /* ── split view ───────────────────────────────────────────────────────── */
  nav.toggleSplit = (rightId) => {
    if (nav.split) { nav.split = null; KB.emit('route', nav.current); KB.toast('פיצול מסך בוטל'); return; }
    if (!nav.current || nav.current.route !== 'doc') { KB.toast('פיצול מסך זמין מתוך מסמך', 'warn'); return; }
    const leftId = nav.current.a;
    const pick = rightId || S.recent.find((id) => id !== leftId && KB.doc(id)) || (S.tabs.find((t) => t.docId !== leftId) || {}).docId;
    if (!pick) { KB.palette.open({ mode: 'split' }); return; }
    nav.split = { left: leftId, right: pick };
    KB.emit('route', nav.current);
  };

  /* ── keyboard shortcuts ───────────────────────────────────────────────── */
  KB.KEYMAP = [
    ['Ctrl K', 'חיפוש בכל המקורות'], ['Ctrl D', 'מצב כהה / בהיר'], ['Ctrl \\', 'פיצול מסך'], ['Alt T', 'פתיחת מסמך בלשונית חדשה'],
    ['Alt ← / →', 'היסטוריה אחורה / קדימה'], ['↑ ↓', 'מעבר בין שלבים (מצב שיחה)'], ['↵', 'פתיחת השלב הנוכחי'], ['1 – 3', 'בחירת תוצאה בשלב'],
    ['G ואז מספר', 'קפיצה לשלב'], ['N', 'הערת נציג לשלב'], ['P', 'הצמד / בטל הצמדה'], ['C', 'העתקת סיכום לתיעוד'],
    ['E', 'עריכת המסמך'], ['H', 'היסטוריית גרסאות'], ['W', 'סגירת הלשונית'], ['?', 'מפת הקיצורים'], ['Esc', 'סגירת חלון / חזרה']
  ];
  nav.showKeymap = () => KB.modal({ title: '⌨️ כל הקיצורים', body: el('div', { class: 'keymap' }, KB.KEYMAP.map(([k, d]) => el('div', null, el('span', null, d), el('kbd', null, k)))) });
  let gArmed = null;
  const isTyping = () => { const a = document.activeElement; return a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT' || a.isContentEditable); };
  document.addEventListener('keydown', (e) => {
    const k = e.key; const mod = e.ctrlKey || e.metaKey;
    if (mod && (k === 'k' || k === 'K' || k === 'ק')) { e.preventDefault(); KB.palette.open(); return; }
    if (mod && (k === 'd' || k === 'D' || k === 'ג')) { e.preventDefault(); KB.toggleTheme(); return; }
    if (mod && k === '\\') { e.preventDefault(); nav.toggleSplit(); return; }
    if (e.altKey && (k === 't' || k === 'T')) { e.preventDefault(); nav.newTab(); return; }
    if (e.altKey && k === 'ArrowLeft') { e.preventDefault(); document.dir === 'rtl' ? nav.forward() : nav.back(); return; }
    if (e.altKey && k === 'ArrowRight') { e.preventDefault(); document.dir === 'rtl' ? nav.back() : nav.forward(); return; }
    if (isTyping()) return;
    if (k === 'Escape') { KB.emit('escape'); return; }
    if (k === '?' ) { e.preventDefault(); nav.showKeymap(); return; }
    if (mod || e.altKey) return;
    // G then number: jump to step
    if (k === 'g' || k === 'G' || k === 'ע') { gArmed = { buf: '', t: setTimeout(() => { gArmed = null; KB.emit('jump-armed', null); }, 1500) }; KB.emit('jump-armed', ''); return; }
    if (gArmed) {
      if (/^\d$/.test(k)) { gArmed.buf += k; clearTimeout(gArmed.t); gArmed.t = setTimeout(() => { KB.emit('jump', gArmed.buf); gArmed = null; KB.emit('jump-armed', null); }, 450); KB.emit('jump-armed', gArmed.buf); return; }
      if (k === 'Enter') { clearTimeout(gArmed.t); KB.emit('jump', gArmed.buf); gArmed = null; KB.emit('jump-armed', null); return; }
    }
    KB.emit('key', e);
  });

  /* ── hover peek ───────────────────────────────────────────────────────── */
  const peek = { el: null, timer: null, hideTimer: null };
  KB.peek = peek;
  peek.show = (docId, anchor) => {
    const d = KB.doc(docId); if (!d || !anchor) return;
    peek.hide(true);
    const cur = nav.current && nav.current.route === 'doc' ? KB.doc(nav.current.a) : null;
    const shared = cur ? KB.sharedWith(cur, d) : [];
    const t = KB.topicForDoc(d) || {};
    const box = el('div', { class: 'peek', onmouseenter: () => clearTimeout(peek.hideTimer), onmouseleave: () => peek.hide() },
      el('div', { class: 'eyebrow' }, 'תצוגה מקדימה · ריחוף על קישור'),
      el('div', { class: 't' }, d.title),
      el('div', { class: 'm' }, KB.CATS[d.cat].label + ' · ' + KB.stepCount(d) + ' שלבים · ' + (KB.PRI[t.pri || d.pri || 'm'].label) + ' · v' + (d.version || 1)),
      el('div', { class: 's' }, shared.length ? 'משתף איתך: ' + shared.map((s) => '⧉ ' + s.block.title + ' (שלב ' + s.step.num + ')').join(', ') : (d.desc || '')),
      el('div', { class: 'b' },
        el('span', { class: 'p', onclick: () => { peek.hide(true); nav.openDoc(docId); } }, 'פתח'),
        el('span', { onclick: () => { peek.hide(true); nav.openDoc(docId, null, { newTab: true }); } }, 'פתח בלשונית'),
        el('span', { onclick: () => { peek.hide(true); if (cur && cur.id !== docId) { nav.split = null; nav.toggleSplit(docId); } else nav.openDoc(docId); } }, 'פיצול מסך')));
    document.body.appendChild(box);
    const r = anchor.getBoundingClientRect();
    let top = r.bottom + 8, left = Math.min(Math.max(8, r.left + r.width / 2 - 150), window.innerWidth - 308);
    if (top + box.offsetHeight > window.innerHeight - 8) top = Math.max(8, r.top - box.offsetHeight - 8);
    box.style.top = top + 'px'; box.style.left = left + 'px';
    peek.el = box;
  };
  peek.hide = (now) => { clearTimeout(peek.timer); clearTimeout(peek.hideTimer); if (!peek.el) return; if (now) { peek.el.remove(); peek.el = null; } else peek.hideTimer = setTimeout(() => { if (peek.el) { peek.el.remove(); peek.el = null; } }, 220); };
  document.addEventListener('mouseover', (e) => {
    const a = e.target.closest && e.target.closest('[data-doc]');
    if (!a || a.dataset.nopeek != null) return;
    clearTimeout(peek.timer); clearTimeout(peek.hideTimer);
    peek.timer = setTimeout(() => peek.show(a.dataset.doc, a), 350);
  });
  document.addEventListener('mouseout', (e) => { const a = e.target.closest && e.target.closest('[data-doc]'); if (a) { clearTimeout(peek.timer); peek.hide(); } });
  document.addEventListener('click', (e) => {
    const a = e.target.closest && e.target.closest('a.doc-link[data-doc]');
    if (!a) return;
    e.preventDefault(); peek.hide(true);
    nav.openDoc(a.dataset.doc, a.dataset.step || null, { newTab: e.ctrlKey || e.metaKey });
  });
  document.addEventListener('click', (e) => {
    const c = e.target.closest && e.target.closest('.crm[data-crm]');
    if (c && !e.target.closest('.eact')) { e.stopPropagation(); KB.showField(c.dataset.crm); }
  });
  KB.on('route', () => peek.hide(true));

  /* ── CRM field popover (docs using a field) ───────────────────────────── */
  KB.showField = (name) => {
    const f = KB.CRM_FIELDS.find((x) => x.name === name);
    const docs = KB.fieldUsage(name);
    const body = el('div', null,
      el('p', { html: KB.crmChip(name) + ' · ' + (f ? esc(f.path) + ' · עודכן ' + KB.fmtDate(f.updated) : 'שדה לא מוכר ב-crm-fields.json') + (f && f.status === 'renamed' ? '<br><b style="color:var(--red-dark)">שונה שם ל-' + esc(f.renamedTo) + '</b> — יש לעדכן את המסמכים המפנים לשם הישן.' : '') + (f && f.status === 'new' ? '<br><b style="color:var(--warn)">שדה חדש</b> — נוסף השבוע.' : '') }),
      el('div', { class: 'eyebrow', style: 'margin-top:14px' }, 'ב-' + docs.length + ' מסמכים'),
      el('div', { class: 'field-docs' }, docs.length ? docs.map((d) => el('a', { class: 'rel', 'data-doc': d.id, 'data-nopeek': '', onclick: () => { m.close(); nav.openDoc(d.id); } }, el('span', { class: 'ic' }, KB.CATS[d.cat].icon), el('div', { class: 'tx' }, d.title, el('div', null, KB.CATS[d.cat].label + ' · v' + (d.version || 1))))) : el('div', { class: 'muted small' }, 'אף מסמך לא מפנה לשדה זה')));
    const m = KB.modal({ title: 'שדה CRM', body });
  };

  /* ── command palette ──────────────────────────────────────────────────── */
  const palette = { open: null, el: null };
  KB.palette = palette;
  const TYPES = [['all', 'הכל'], ['doc', 'מסמכים'], ['step', 'שלבים'], ['crm', 'שדות CRM'], ['block', 'בלוקים'], ['script', 'תסריטים'], ['action', 'פעולות']];
  function buildIndex() {
    const idx = [];
    KB.docs().forEach((d) => {
      const t = KB.topicForDoc(d) || {};
      idx.push({ type: 'doc', id: d.id, title: d.title, text: (d.title + ' ' + (d.desc || '') + ' ' + (t.desc || '')).toLowerCase(), meta: (d.src === 'intl' ? 'intl-roaming.json' : 'topics.json') + ' · ' + KB.CATS[d.cat].label + ' · ' + KB.stepCount(d) + ' שלבים · v' + (d.version || 1), icon: KB.CATS[d.cat].icon, doc: d });
      KB.docSteps(d).forEach((s) => idx.push({ type: 'step', id: d.id + '#' + s.id, docId: d.id, stepId: s.id, num: s.num, title: KB.stripFmt(s.title), text: KB.stripFmt(KB.stepText(s)).toLowerCase(), meta: (d.src === 'intl' ? 'intl-roaming.json' : 'topics.json') + ' · ' + KB.CATS[d.cat].label + ' · ' + (s._phase.label || '') + (s.block && KB.block(s.block) ? ' · ⧉ ' + KB.block(s.block).title : ''), sub: 'בתוך ' + d.title, doc: d }));
    });
    KB.topics().filter((t) => !t.docId).forEach((t) => idx.push({ type: 'doc', id: 'topic:' + t.id, topicId: t.id, title: t.title, text: (t.title + ' ' + t.desc).toLowerCase(), meta: KB.CATS[t.cat].label + ' · כרטיס ללא מסמך', icon: KB.CATS[t.cat].icon, placeholder: true }));
    KB.blocks().forEach((b) => { const used = KB.blockUsage(b.id); idx.push({ type: 'block', id: b.id, title: b.title, text: (b.title + ' ' + (b.actions || []).map((a) => a.text).join(' ') + ' ' + (b.script || '')).toLowerCase(), meta: 'משמש ב: ' + (used.map((d) => d.title).slice(0, 4).join(' · ') || '—') + (used.length > 4 ? ' · +' + (used.length - 4) : ''), sub: (b.actions || []).map((a) => KB.stripFmt(a.text)).join(' ← ').slice(0, 90), used }); });
    KB.CRM_FIELDS.forEach((f) => idx.push({ type: 'crm', id: f.name, title: f.name, text: (f.name + ' ' + f.path + ' ' + (f.renamedTo || '')).toLowerCase(), meta: 'crm-fields.json · ב-' + KB.fieldUsage(f.name).length + ' מסמכים · עודכן ' + KB.fmtDate(f.updated) + (f.status === 'renamed' ? ' · שונה שם' : f.status === 'new' ? ' · חדש' : '') }));
    KB.SCRIPTS.forEach((s) => idx.push({ type: 'script', id: s.id, title: s.title, text: (s.title + ' ' + s.text).toLowerCase(), meta: 'scripts.json · ' + s.text.slice(0, 80), script: s }));
    const actions = [
      { id: 'new', title: 'צור פריט ידע חדש', kbd: 'Ctrl N', icon: '✚', run: () => nav.go('edit', 'new') },
      { id: 'dark', title: document.documentElement.dataset.theme === 'dark' ? 'מצב בהיר' : 'מצב כהה', kbd: 'Ctrl D', icon: '◐', run: KB.toggleTheme },
      { id: 'split', title: 'פיצול מסך', kbd: 'Ctrl \\', icon: '⫿', run: () => nav.toggleSplit() },
      { id: 'sources', title: 'מסמכי מקור (Word) – עיבוד שינויים', icon: '📄', run: () => nav.go('sources') },
      { id: 'trash', title: 'סל מיחזור', icon: '🗑', run: () => nav.go('trash') },
      { id: 'pinned', title: 'מוצמדים', icon: '★', run: () => nav.go('pinned') },
      { id: 'recent', title: 'נצפו לאחרונה', icon: '🕘', run: () => nav.go('recent') },
      { id: 'fields', title: 'שדות CRM – מה השתנה השבוע', icon: 'CRM', run: () => nav.go('fields') },
      { id: 'blocks', title: 'בלוקים משותפים', icon: '⧉', run: () => nav.go('blocks') },
      { id: 'export', title: 'ייצוא הספרייה ל-JSON', icon: '⤓', run: KB.exportAll },
      { id: 'import', title: 'ייבוא JSON / CSV', icon: '⤒', run: () => KB.pickFile('.json,.csv', (f) => KB.importFile(f)) },
      { id: 'font', title: S.prefs.font === 'rubik' ? 'מערכת טיפוגרפיה: עבור ל-Plex Hebrew (מוצע)' : 'מערכת טיפוגרפיה: עבור ל-Rubik (נוכחי)', icon: 'Aא', run: () => { KB.setFont(S.prefs.font === 'rubik' ? 'plex' : 'rubik'); KB.toast('הופעל: ' + (S.prefs.font === 'rubik' ? 'Rubik' : 'IBM Plex Sans Hebrew')); } },
      { id: 'type', title: 'הגדרות תצוגה וטיפוגרפיה', icon: '⚙', run: () => KB.showSettings() },
      { id: 'keys', title: 'כל הקיצורים', kbd: '?', icon: '⌨', run: nav.showKeymap },
      { id: 'print', title: 'הדפסה', icon: '🖨', run: () => window.print() }
    ];
    if (nav.current && nav.current.route === 'doc') { const d = KB.doc(nav.current.a); if (d) { actions.unshift({ id: 'edit', title: 'ערוך את "' + d.title + '"', kbd: 'E', icon: '✏', run: () => nav.go('edit', d.id) }); actions.unshift({ id: 'hist', title: 'היסטוריית גרסאות של "' + d.title + '"', kbd: 'H', icon: '🕓', run: () => nav.go('history', d.id) }); } }
    actions.forEach((a) => idx.push({ type: 'action', id: a.id, title: a.title, text: a.title.toLowerCase(), kbd: a.kbd, icon: a.icon, run: a.run }));
    return idx;
  }
  function score(item, q) {
    if (!q) return item.type === 'action' ? 0 : 1;
    const t = item.title.toLowerCase();
    if (t === q) return 100; if (t.startsWith(q)) return 80; if (t.includes(q)) return 60;
    const words = q.split(/\s+/).filter(Boolean);
    if (words.every((w) => item.text.includes(w))) return 30 + Math.min(20, words.length * 5);
    return 0;
  }
  const hi = (text, q) => { if (!q) return esc(text); const i = text.toLowerCase().indexOf(q); if (i < 0) return esc(text); return esc(text.slice(0, i)) + '<mark>' + esc(text.slice(i, i + q.length)) + '</mark>' + esc(text.slice(i + q.length)); };
  palette.open = (opts) => {
    opts = opts || {};
    if (palette.el) palette.close();
    const mode = opts.mode || 'search';
    let type = opts.type || 'all', sel = 0, results = [];
    const index = buildIndex();
    const input = el('input', { type: 'text', placeholder: mode === 'newtab' ? 'איזה מסמך לפתוח בלשונית חדשה?' : mode === 'split' ? 'איזה מסמך להציג לצד הנוכחי?' : 'חפש מסמך, שלב, שדה CRM, תסריט או פעולה…', value: opts.query || '' });
    const typesEl = el('div', { class: 'types' });
    const res = el('div', { class: 'res' });
    const foot = el('div', { class: 'foot' }, el('span', null, '↑↓ ניווט'), el('span', null, '↵ פתיחה'), el('span', null, 'Tab סוג תוצאה'), el('span', null, 'Ctrl ↵ בלשונית'), el('span', { class: 'stat' }));
    const box = el('div', { class: 'palette', role: 'dialog' }, el('div', { class: 'in' }, el('span', { class: 'ic' }, '⌕'), input, typesEl, el('kbd', { onclick: () => palette.close() }, 'Esc')), res, foot);
    const ov = el('div', { class: 'overlay dark', onmousedown: (e) => { if (e.target === ov) palette.close(); } }, box);
    document.body.appendChild(ov); palette.el = ov; input.focus();
    const renderTypes = () => { typesEl.innerHTML = ''; TYPES.filter(([k]) => mode === 'search' || k === 'all' || k === 'doc').forEach(([k, l]) => typesEl.appendChild(el('span', { class: k === type ? 'on' : '', onclick: () => { type = k; run(); } }, l))); };
    const run = () => {
      const t0 = performance.now();
      const q = input.value.trim().toLowerCase();
      renderTypes();
      let pool = index.filter((it) => mode === 'search' ? true : it.type === 'doc' && !it.placeholder);
      if (type !== 'all') pool = pool.filter((it) => it.type === type);
      results = pool.map((it) => ({ it, s: score(it, q) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s || a.it.title.localeCompare(b.it.title)).slice(0, q ? 40 : 14).map((x) => x.it);
      if (!q && type === 'all' && mode === 'search') { results = index.filter((it) => it.type === 'action').slice(0, 6).concat(S.recent.slice(0, 5).map((id) => index.find((it) => it.type === 'doc' && it.id === id)).filter(Boolean)); }
      else { // group by type, groups ordered by their best hit
        const order = []; results.forEach((it) => { if (!order.includes(it.type)) order.push(it.type); });
        results = order.flatMap((t) => results.filter((it) => it.type === t));
      }
      sel = 0; draw();
      const files = new Set(results.map((r) => (r.meta || '').split(' · ')[0]).filter((f) => f.endsWith('.json')));
      foot.querySelector('.stat').textContent = results.length + ' תוצאות ב-' + files.size + ' קבצים · ' + Math.max(1, Math.round(performance.now() - t0)) + 'ms';
    };
    const groupLabel = { block: 'בלוק משותף', step: 'שלבים', doc: 'מסמכים', crm: 'שדות CRM', script: 'תסריטים', action: 'פעולות' };
    const draw = () => {
      res.innerHTML = '';
      if (!results.length) { res.appendChild(el('div', { class: 'empty' }, 'אין תוצאות')); return; }
      const q = input.value.trim().toLowerCase();
      let lastType = null;
      results.forEach((it, i) => {
        if (it.type !== lastType) { lastType = it.type; res.appendChild(el('div', { class: 'gh' }, groupLabel[it.type] + (it.type === 'block' ? ' · ' + (it.used ? it.used.length : 0) + ' מסמכים' : ''))); }
        const ic = it.type === 'step' ? el('span', { class: 'ic round' }, it.num) : it.type === 'block' ? el('span', { class: 'ic red' }, '⧉') : it.type === 'crm' ? el('span', { class: 'ic', style: 'font-size:10px' }, 'CRM') : it.type === 'script' ? el('span', { class: 'ic' }, '“') : el('span', { class: 'ic' }, it.icon || '📄');
        const row = el('div', { class: 'ri' + (i === sel ? ' on' : ''), onmouseenter: () => { sel = i; $$('.ri', res).forEach((r, j) => r.classList.toggle('on', j === sel)); }, onclick: (e) => choose(it, e.ctrlKey || e.metaKey) }, ic,
          el('div', { class: 'tx' }, el('div', { class: 't' + (it.type === 'block' ? ' w' : ''), html: (it.type === 'crm' ? '<bdi class="lat" dir="ltr">' + hi(it.title, q) + '</bdi>' : hi(it.title, q)) + (it.sub ? ' <span class="muted">· ' + esc(it.sub) + '</span>' : '') }), el('div', { class: 'm' }, it.meta || '')),
          it.kbd ? el('kbd', null, it.kbd) : (i === sel ? el('kbd', null, '↵') : null));
        res.appendChild(row);
      });
      const on = res.querySelector('.ri.on'); if (on) on.scrollIntoView({ block: 'nearest' });
    };
    const choose = (it, newTab) => {
      palette.close();
      if (!it) return;
      if (mode === 'split') { nav.split = null; nav.toggleSplit(it.id); return; }
      if (mode === 'newtab') { nav.openDoc(it.id, null, { newTab: true }); return; }
      if (it.type === 'doc') { if (it.placeholder) KB.openTopic(it.topicId); else nav.openDoc(it.id, null, { newTab }); }
      else if (it.type === 'step') nav.openDoc(it.docId, it.stepId, { newTab });
      else if (it.type === 'crm') KB.showField(it.id);
      else if (it.type === 'block') KB.showBlock(it.id);
      else if (it.type === 'script') KB.modal({ title: '“ ' + it.title, body: '<div class="script">' + esc(it.script.text) + '</div><p class="small muted" style="margin-top:10px">משמש ב: ' + it.script.usedIn.map((id) => (KB.doc(id) || {}).title).filter(Boolean).join(' · ') + '</p>', buttons: [{ label: 'העתק', cls: 'primary', onclick: () => KB.copy(it.script.text) }] });
      else if (it.type === 'action') it.run();
    };
    input.addEventListener('input', run);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(results.length - 1, sel + 1); draw(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(0, sel - 1); draw(); }
      else if (e.key === 'Enter') { e.preventDefault(); choose(results[sel], e.ctrlKey || e.metaKey); }
      else if (e.key === 'Tab') { e.preventDefault(); const keys = TYPES.map((t) => t[0]).filter((k) => mode === 'search' || k === 'all' || k === 'doc'); type = keys[(keys.indexOf(type) + (e.shiftKey ? -1 : 1) + keys.length) % keys.length]; run(); }
      else if (e.key === 'Escape') { e.preventDefault(); palette.close(); }
    });
    run();
  };
  palette.close = () => { if (palette.el) { palette.el.remove(); palette.el = null; } };
  KB.on('escape', () => palette.close());

  /* ── shared block popover ─────────────────────────────────────────────── */
  KB.showBlock = (blockId) => {
    const b = KB.block(blockId); if (!b) return;
    const used = KB.blockUsage(blockId);
    const body = el('div', null,
      el('div', { class: 'chips', style: 'display:flex;gap:6px;margin-bottom:10px' }, el('span', { class: 'blockbar' }, '⧉ בלוק משותף · ' + used.length), el('span', { class: 'chip chip-gray' }, 'v' + (b.version || 1) + ' · ' + (b.author || '') + ' · ' + KB.fmtDate(b.updated))),
      b.kind === 'script' ? el('div', { class: 'script', html: KB.fmt(b.script) }) : el('div', { class: 'acts' }, (b.actions || []).map((a) => el('div', { class: 'act' }, el('span', { class: 'caret' }, '›'), el('span', { html: KB.fmt(a.text) })))),
      el('div', { class: 'eyebrow', style: 'margin-top:14px' }, 'משמש ב-' + used.length + ' מסמכים · שינוי בבלוק מתעדכן בכולם'),
      el('div', { class: 'field-docs' }, used.map((d) => { const s = KB.steps(d).find((x) => x.block === blockId || (x.blockRefs || []).includes(blockId)); return el('a', { class: 'rel', 'data-doc': d.id, 'data-nopeek': '', onclick: () => { m.close(); nav.openDoc(d.id, s ? s.id : null); } }, el('span', { class: 'ic' }, KB.CATS[d.cat].icon), el('div', { class: 'tx' }, d.title, el('div', null, 'שלב ' + (s ? s.num : '') + (s && s.block === blockId ? ' · מוטמע' : ' · מפנה')))); })));
    const m = KB.modal({ title: '⧉ ' + b.title, body, buttons: [{ label: 'מחק בלוק', cls: 'danger', onclick: () => { KB.confirm('מחיקת בלוק משותף', 'הבלוק "' + esc(b.title) + '" משמש ב-' + used.length + ' מסמכים. הוא יועבר לסל המיחזור ל-30 יום; בינתיים המסמכים יציגו שלב חסר.', 'העבר לסל', 'danger', () => { KB.deleteBlock(blockId); KB.toast('הבלוק הועבר לסל המיחזור', 'ok', () => { const e = S.trash.find((x) => x.refId === blockId); if (e) KB.restoreTrash(e.id); }); }); } }, { label: 'ערוך בלוק', cls: 'navy', onclick: () => KB.editBlock(blockId) }, { label: 'סגור' }] });
  };
  KB.editBlock = (blockId) => {
    const b = KB.clone(KB.block(blockId)); if (!b) return;
    const used = KB.blockUsage(blockId);
    const list = el('div', { class: 'form' });
    const redraw = () => {
      list.innerHTML = '';
      if (b.kind === 'script') { const ta = el('textarea', { rows: 4 }); ta.value = b.script || ''; ta.addEventListener('input', () => { b.script = ta.value; }); list.appendChild(el('label', null, 'תסריט', ta)); return; }
      (b.actions || []).forEach((a, i) => { const inp = el('input', { type: 'text', value: a.text }); inp.addEventListener('input', () => { a.text = inp.value; }); list.appendChild(el('div', { class: 'eact' }, el('span', { class: 'caret' }, '›'), inp, el('span', { class: 'x', onclick: () => { b.actions.splice(i, 1); redraw(); } }, '✕'))); });
      list.appendChild(el('div', { class: 'addrow' }, el('span', { onclick: () => { b.actions.push({ id: KB.uid('b'), text: '' }); redraw(); setTimeout(() => { const ins = list.querySelectorAll('input'); ins[ins.length - 1].focus(); }, 20); } }, '+ פעולה')));
    };
    const title = el('input', { type: 'text', value: b.title });
    title.addEventListener('input', () => { b.title = title.value; });
    redraw();
    KB.modal({ title: 'עריכת בלוק משותף', body: el('div', null, el('p', { class: 'small muted' }, 'שינוי כאן יעדכן ' + used.length + ' מסמכים בבת אחת.'), el('div', { class: 'form' }, el('label', null, 'שם הבלוק', title)), list),
      buttons: [{ label: 'ביטול' }, { label: 'שמור ועדכן ' + used.length + ' מסמכים', cls: 'primary', onclick: () => { b.version = (b.version || 1) + 1; b.updated = new Date().toISOString().slice(0, 10); b.author = KB.USER.name; S.blocks[blockId] = b; KB.save(); KB.emit('docs'); KB.toast('הבלוק עודכן ב-' + used.length + ' מסמכים', 'ok'); } }] });
  };

  /* ── settings (type system toggle etc.) ───────────────────────────────── */
  KB.showSettings = () => {
    const sample = el('div', { class: 'type-sample' });
    const drawSample = () => {
      sample.innerHTML = '<div>' + KB.fmt('ודא שה-APN מוגדר ל-WE · אם לא מוגדר → הגדר. סימון רשת: H+ / 3G / LTE / 5G.') + '</div>'
        + '<div>' + KB.fmt('CRM ← מצב עריכה ← sim block lbl ← שמור · שוב עריכה ← sim allow lbl ← שמור') + '</div>'
        + '<div>' + KB.fmt('בקש מהלקוח להריץ Speedtest — מעל 6 Mbps תקין · עודכן 12.06.2025 · גרסה v7') + '</div>'
        + '<div class="n">' + (S.prefs.font === 'rubik' ? 'נוכחי: Rubik Latin רחב ובהיר יותר מהעברית; מזהים לטיניים עדיין מבודדים (bdi ltr) כדי שהסדר לא יתהפך.' : 'מוצע: אותיות עבריות ולטיניות באותו משקל וגובה x, כל מזהה מבודד (bdi ltr) — הסדר קבוע גם עם "/" ו-"=".') + '</div>';
    };
    drawSample();
    const fontToggle = el('span', { class: 'pill-toggle' }, el('span', { class: S.prefs.font === 'rubik' ? 'on' : '', onclick: () => { KB.setFont('rubik'); refresh(); } }, 'מצב נוכחי (Rubik)'), el('span', { class: S.prefs.font !== 'rubik' ? 'on' : '', onclick: () => { KB.setFont('plex'); refresh(); } }, 'מוצע (Plex Hebrew)'));
    const themeToggle = el('span', { class: 'pill-toggle' }, el('span', { class: document.documentElement.dataset.theme !== 'dark' ? 'on' : '', onclick: () => { S.prefs.theme = 'light'; KB.applyPrefs(); KB.save(); refresh(); } }, 'בהיר'), el('span', { class: document.documentElement.dataset.theme === 'dark' ? 'on' : '', onclick: () => { S.prefs.theme = 'dark'; KB.applyPrefs(); KB.save(); refresh(); } }, 'כהה'), el('span', { class: !S.prefs.theme ? 'on' : '', onclick: () => { S.prefs.theme = null; KB.applyPrefs(); KB.save(); refresh(); } }, 'לפי המערכת'));
    const panelToggle = el('span', { class: 'pill-toggle' }, el('span', { class: S.prefs.panel ? 'on' : '', onclick: () => { S.prefs.panel = true; KB.save(); refresh(); } }, 'מוצג'), el('span', { class: !S.prefs.panel ? 'on' : '', onclick: () => { S.prefs.panel = false; KB.save(); refresh(); } }, 'מוסתר'));
    const body = el('div', null,
      el('div', { class: 'settings-row' }, el('div', null, 'מערכת טיפוגרפיה', el('div', { class: 'd' }, 'החלפה חיה בין המערכת הנוכחית למוצעת')), fontToggle),
      el('div', { class: 'settings-row' }, el('div', null, 'ערכת צבעים', el('div', { class: 'd' }, 'מצב כהה לנציגים במשמרות לילה · Ctrl D')), themeToggle),
      el('div', { class: 'settings-row' }, el('div', null, 'פאנל קשרים במסמך', el('div', { class: 'd' }, 'הפאנל הימני: קשרים · הערות · גרסאות')), panelToggle),
      el('div', { class: 'eyebrow', style: 'margin:16px 0 8px' }, 'דוגמת טקסט מעורב'), sample,
      el('div', { class: 'type-rules', style: 'margin-top:10px' },
        el('div', { html: '<b>כללי טיפוגרפיה</b>גוף: IBM Plex Sans Hebrew 400/500<br>כותרות: 600/700, ריווח אותיות 0<br>מזהים לטיניים: <bdi class="lat" dir="ltr">IBM Plex Mono</bdi><br>מספרים: תמיד ספרות לטיניות, <bdi class="lat" dir="ltr">tabular-nums</bdi>' }),
        el('div', { html: '<b>כללי bidi</b>כל מזהה לטיני / מספר / נתיב עטוף ב-<bdi class="lat" dir="ltr">&lt;bdi dir="ltr"&gt;</bdi><br>חצים ופיסוק בתוך הטקסט העברי, לא בתוך המזהה<br>שדות CRM = צ\'יפ עם כיוון קבוע<br>קיצורי מקשים ותאריכים — <bdi class="lat" dir="ltr">ltr</bdi> תמיד' })),
      el('div', { class: 'settings-row', style: 'margin-top:14px;border:0' }, el('div', null, 'איפוס נתונים מקומיים', el('div', { class: 'd' }, 'מוחק עריכות, הצמדות, היסטוריה וסל מיחזור בדפדפן זה')), el('button', { class: 'btn sm danger', onclick: () => KB.confirm('איפוס מקומי', 'כל השינויים שנשמרו בדפדפן זה יימחקו והספרייה תחזור לתוכן המקורי. להמשיך?', 'אפס', 'danger', KB.resetAll) }, 'אפס')));
    const m = KB.modal({ title: '⚙ תצוגה וטיפוגרפיה', body, wide: true });
    function refresh() { m.close(); KB.showSettings(); KB.emit('theme'); }
  };
})();
