/* wecom KB — article · call mode: progress rail, keyboard nav, live CRM refs, notes,
   connected card (typed relationships, hover peek), tabs / split view / jump-to-step */
(function () {
  'use strict';
  const KB = window.KB; const { $, $$, el, esc } = KB; const S = KB.state(); const nav = KB.nav;
  KB.views = KB.views || {};

  const OUT_KBD = ['1', '2', '3'];
  const callOf = (docId) => { if (!S.calls[docId]) S.calls[docId] = { started: null, active: null, results: {}, expanded: [] }; return S.calls[docId]; };

  /* ── step renderer (shared by article, split panes, editor preview) ───── */
  KB.renderStep = function (doc, step, ctx) {
    ctx = ctx || {};
    const s = KB.resolveStep(step);
    const cur = ctx.activeId === s.id, done = !!(ctx.results && ctx.results[s.id]), skipped = ctx.skipped && ctx.skipped.has(s.id);
    const open = cur || ctx.expandAll || (ctx.expanded && ctx.expanded.includes(s.id));
    const res = ctx.results && ctx.results[s.id];
    const node = el('div', { class: 'step' + (cur ? ' cur' : '') + (done ? ' done' : '') + (skipped ? ' skip' : '') + (s.tone === 'alert' ? ' alert' : ''), id: ctx.prefix ? ctx.prefix + s.id : 'step-' + s.id, 'data-step': s.id, 'data-block': KB.stepBlocks(s)[0] || null });
    node.appendChild(el('div', { class: 'n' + (String(s.num).length > 1 && /[א-ת]/.test(s.num) ? ' sub' : '') }, done ? '✓' : s.num));
    const box = el('div', { class: 'box', onclick: (e) => { if (ctx.onSelect && !e.target.closest('.out,.bo,.note-add,.doc-link,.crm,.blockbar')) ctx.onSelect(s.id); } });
    const head = el('div', { class: 'head' }, el('span', { class: 't', html: KB.fmt(s.title, { noCrm: true }) }));
    if (s.hint) head.appendChild(el('span', { class: 'h' }, s.hint));
    if (!open) head.appendChild(el('span', { class: 'h' }, stepHint(s)));
    if (s.block && s._block) head.appendChild(el('span', { class: 'blockbar', title: 'בלוק משותף · לחץ לפרטים', onclick: (e) => { e.stopPropagation(); KB.showBlock(s.block); } }, '⧉ בלוק משותף · ' + KB.blockUsage(s.block).length));
    if (s._blockMissing) head.appendChild(el('span', { class: 'chip chip-red' }, 'בלוק חסר · בסל המיחזור'));
    (s.blockRefs || []).forEach((bid) => { const b = KB.block(bid); if (b) head.appendChild(el('span', { class: 'blockbar ref', onclick: (e) => { e.stopPropagation(); KB.showBlock(bid); } }, '⧉ ' + b.title)); });
    if (cur && ctx.callMode) head.appendChild(el('span', { class: 'k' }, '↵ · ' + OUT_KBD.slice(0, Math.max(1, (s.outcomes || (s.branch ? s.branch.options : [])).length)).join(' / ')));
    else if (ctx.showPrevNext && cur) head.appendChild(el('span', { class: 'k' }, ''));
    box.appendChild(head);
    if (open) {
      if (s.desc) box.appendChild(el('div', { class: 'desc', html: KB.fmt(s.desc) }));
      if (s.signals) box.appendChild(el('div', { class: 'signals' }, s.signals.map((g) => el('div', { class: g.tone === 'blue' ? 'blue' : '' }, el('div', { class: 'lbl' }, g.label), el('div', { class: 'pills' }, g.items.map((it) => el('span', { class: 'pill' }, it)))))));
      if (s.script) box.appendChild(el('div', { class: 'script', html: KB.fmt(s.script) }));
      if ((s.actions || []).length) box.appendChild(el('div', { class: 'acts' }, s.actions.map((a) => el('div', { class: 'act' }, el('span', { class: 'caret' }, '›'), el('span', { html: KB.fmt(a.text) + crmNote(a.text) })))));
      if (s.pillars) box.appendChild(el('div', { class: 'pillars' }, s.pillars.map((p) => el('div', { class: p.tone || 'gray' }, el('b', null, p.label), el('span', { html: KB.fmt(p.text) })))));
      if (s.stages) box.appendChild(el('div', { class: 'stage-row' }, s.stages.map((st) => el('div', null, el('div', { class: 'lbl' }, st.label), st.actions ? el('div', { class: 'acts', style: 'margin-top:0' }, st.actions.map((a) => el('div', { class: 'act' }, el('span', { class: 'caret' }, '›'), el('span', { html: KB.fmt(a) })))) : null, st.script ? el('div', { class: 'script sm', html: KB.fmt(st.script) }) : null))));
      if (s.objection) box.appendChild(el('div', { class: 'objection' }, el('div', { class: 'q' }, el('span', { class: 'tag' }, 'לקוח'), el('span', { html: KB.fmt(s.objection.q) })), el('div', { class: 'a' }, el('span', { class: 'tag rep', style: 'margin-inline-end:6px' }, 'נציג'), el('span', { html: KB.fmt(s.objection.a) }))));
      if (s.principles) box.appendChild(el('div', { class: 'principles' }, el('div', { class: 't' }, 'עקרונות-על לשיחה טובה'), el('ol', null, s.principles.map((p) => el('li', { html: KB.fmt(p) })))));
      if (s.branch) {
        box.appendChild(el('div', { class: 'branch' }, el('div', { class: 'q' }, el('i', null, '?'), s.branch.q),
          s.branch.options.map((o, i) => el('div', { class: 'bo' + (res && res.kind === 'branch' && res.idx === i ? ' picked' : ''), onclick: (e) => { e.stopPropagation(); if (ctx.onOutcome) ctx.onOutcome(s.id, { kind: 'branch', idx: i, label: o.label, goto: o.goto }); } }, el('span', { class: 'lbl ' + (o.kind || 'if') }, o.label), el('span', { html: KB.fmt(o.text) }), ctx.callMode && cur ? el('kbd', { style: 'margin-inline-start:auto' }, String(i + 1)) : null))));
      }
      if ((s.outcomes || []).length || (ctx.callMode && cur)) {
        const outs = el('div', { class: 'outs' });
        (s.outcomes || []).forEach((o, i) => outs.appendChild(el('span', { class: 'out ' + (o.kind || 'next') + (res && res.kind === 'out' && res.idx === i ? ' picked' : ''), onclick: (e) => { e.stopPropagation(); if (ctx.onOutcome) ctx.onOutcome(s.id, { kind: 'out', idx: i, label: KB.stripFmt(o.text), goto: o.goto }); } }, el('span', { html: KB.fmt(o.text) }), ctx.callMode && cur && !s.branch ? el('kbd', null, String(i + 1)) : null)));
        if (ctx.callMode && cur && ctx.onNote) outs.appendChild(el('span', { class: 'note-add', onclick: (e) => { e.stopPropagation(); ctx.onNote(s.id); } }, '＋ הערת נציג', el('kbd', null, 'N')));
        box.appendChild(outs);
      }
      if (cur && ctx.connections) box.appendChild(KB.stepConnections(doc, s));
    }
    node.appendChild(box);
    return node;
  };
  function stepHint(s) {
    const n = (s.actions || []).length;
    const bits = [];
    if (s._block) bits.push('בלוק משותף ⧉');
    if (n) bits.push(n + ' פעולות');
    if (s.branch) bits.push('הסתעפות');
    if (s.script) bits.push('תסריט');
    if (s.stages) bits.push(s.stages.length + ' שלבי שיחה');
    const crm = KB.crmIn(KB.stepText(s)); if (crm.length) bits.unshift('CRM');
    return bits.join(' · ');
  }
  function crmNote(text) {
    const f = KB.crmIn(text)[0]; if (!f) return '';
    const field = KB.CRM_FIELDS.find((x) => x.name === f);
    const n = KB.fieldUsage(f).length;
    return '<span class="fnote">שדה CRM · ' + (field ? (field.status === 'renamed' ? 'שונה שם' : field.status === 'new' ? 'חדש' : 'תקין') : 'לא מוכר') + ' · ב-' + n + ' מסמכים</span>';
  }
  /* typed relationships of one step: same block in, CRM fields, depends on, source § */
  KB.stepConnections = function (doc, s) {
    const wrap = el('div', { class: 'conn' }, el('div', { class: 'eyebrow' }, 'קשרים של השלב'));
    const g = el('div', { class: 'grid4' });
    const sameBlock = s.block ? KB.blockUsage(s.block).filter((d) => d.id !== doc.id) : [];
    const link = (d) => '<a class="doc-link" data-doc="' + esc(d.id) + '">' + esc(d.title) + '</a>';
    g.appendChild(el('div', { class: 'c' }, el('span', { class: 'k' }, '⧉ אותו בלוק ב־'), el('span', { class: 'v', html: sameBlock.length ? sameBlock.slice(0, 3).map(link).join(' · ') + (sameBlock.length > 3 ? ' · +' + (sameBlock.length - 3) : '') : (s.block ? 'רק במסמך זה' : '—') })));
    const crm = KB.crmIn(KB.stepText(s));
    g.appendChild(el('div', { class: 'c' }, el('span', { class: 'k' }, '▦ שדות CRM'), el('span', { class: 'v', html: crm.length ? crm.map((n) => KB.crmChip(n)).join(' ') : '—' })));
    const deps = (s.deps || []).map((id) => KB.step(doc, id)).filter(Boolean).map((d) => '<a class="doc-link" data-doc="' + esc(doc.id) + '" data-step="' + esc(d.id) + '" data-nopeek>שלב ' + esc(d.num) + ' ' + esc(KB.stripFmt(d.title)) + '</a>');
    const idTopic = KB.topics().find((t) => t.id === 37); if (idTopic && s.num !== '0' && doc.kind !== 'retain') deps.push(esc(idTopic.title));
    const prevNext = []; const steps = KB.steps(doc); const i = steps.findIndex((x) => x.id === s.id);
    if (i > 0) prevNext.push('קודם ' + steps[i - 1].num); if (i < steps.length - 1) prevNext.push('הבא ' + steps[i + 1].num);
    g.appendChild(el('div', { class: 'c' }, el('span', { class: 'k' }, '↳ תלוי ב־'), el('span', { class: 'v', html: (deps.length ? deps.join(' · ') : '—') + (prevNext.length ? '<div class="small muted">' + prevNext.join(' · ') + '</div>' : '') })));
    const src = doc.sourceDoc ? KB.SOURCE_DOCS.find((x) => x.id === doc.sourceDoc.id) : null;
    g.appendChild(el('div', { class: 'c', style: src ? 'cursor:pointer' : '', onclick: src ? () => nav.go('sources', src.id) : null }, el('span', { class: 'k' }, '§ מקור'), el('span', { class: 'v' }, src ? src.title + ' ' + (s.source || doc.sourceDoc.ref || '') + ' · ' + (KB.sourceStatus(src.id) === 'pending' ? 'שינויים ממתינים' : 'מסונכרן') : 'נכתב ישירות בספרייה')));
    wrap.appendChild(g);
    return wrap;
  };

  /* ── document body (phases + steps) ───────────────────────────────────── */
  KB.renderDocBody = function (doc, ctx) {
    const body = el('div', { class: 'doc-body' });
    doc.phases.forEach((p) => {
      if (p.label) body.appendChild(el('div', { class: 'phase' }, el('span', { class: 'lbl' + (p.route ? ' route' : '') }, (p.route ? (p.route === '1' ? '📍 ' : '🌐 ') : '') + p.label), el('span', { class: 'line' }), p.note ? el('span', { class: 'chip chip-blue' }, p.note) : null));
      p.steps.forEach((s) => body.appendChild(KB.renderStep(doc, s, ctx)));
    });
    if (!KB.steps(doc).length) body.appendChild(el('div', { class: 'empty' }, el('b', null, 'המסמך עדיין ריק'), 'הוסף שלבים בעורך'));
    return body;
  };
  KB.renderDocHead = function (doc, opts) {
    opts = opts || {};
    const t = KB.topicForDoc(doc) || {};
    const status = KB.docStatus(doc);
    return el('div', { class: 'doc-head' },
      el('div', { class: 'meta' }, el('span', { class: 'chip chip-blue' }, doc.kind === 'retain' ? 'שימור לקוחות' : 'תפעולי – ' + KB.CATS[doc.cat].short),
        status === 'partial' ? el('span', { class: 'chip chip-amber' }, 'מסמך חלקי') : status === 'draft' ? el('span', { class: 'chip chip-amber' }, 'טיוטה v' + (doc.version || 1)) : el('span', { class: 'chip chip-gray' }, 'v' + (doc.version || 1) + ' · עודכן ' + KB.fmtDate(doc.updated, { month: true })),
        el('span', { class: 'chip chip-gray' }, KB.stepCount(doc) + ' שלבים' + (doc.phases.filter((p) => p.route).length ? ' · ' + doc.phases.filter((p) => p.route).length + ' מסלולים' : '')),
        el('span', { class: 'src' }, 'מקור: ', el('bdi', { class: 'lat', dir: 'ltr' }, (doc.src === 'intl' ? 'intl-roaming.json' : 'topics.json') + '#' + (t.id || doc.topicId || '')))),
      el('h1', null, doc.title), el('p', null, doc.desc || t.desc || ''));
  };

  /* ── the article view ─────────────────────────────────────────────────── */
  KB.views.article = function (root, r) {
    const doc = KB.doc(r.a);
    if (!doc) { root.appendChild(el('div', { class: 'empty' }, el('b', null, 'המסמך לא נמצא'), 'ייתכן שהועבר לסל המיחזור')); return; }
    KB.touchRecent(doc.id);
    const call = callOf(doc.id);
    const steps = () => KB.docSteps(doc);
    if (r.b && KB.step(doc, r.b)) call.active = r.b;
    if (!call.active || !KB.step(doc, call.active)) call.active = (steps()[0] || {}).id;
    const subs = [];
    const on = (ev, fn) => subs.push(KB.on(ev, fn));
    let panelTab = 'links', timer = null, panelMobile = false, jumpBuf = null;
    const callMode = () => S.prefs.callMode !== false;

    // ── header
    const callPill = el('span', { class: 'callpill', title: 'מצב שיחה: ניווט במקלדת, מעקב תוצאות וסיכום לתיעוד', onclick: () => { S.prefs.callMode = !callMode(); KB.save(); if (callMode() && !call.started) call.started = Date.now(); redraw(); } });
    const pinBtn = el('button', { class: 'btn sm', onclick: () => { const on = KB.togglePin(doc.id); KB.toast(on ? '★ הוצמד' : 'הוסרה הצמדה'); pinBtn.textContent = (KB.isPinned(doc.id) ? '★ מוצמד' : '☆ הצמד'); } }, KB.isPinned(doc.id) ? '★ מוצמד' : '☆ הצמד');
    root.appendChild(el('div', { class: 'topbar h56' }, KB.hamburger(),
      el('div', { class: 'crumb' }, el('a', { onclick: () => nav.go('library') }, 'ספרייה'), el('span', { class: 'sep' }, '/'), el('a', { onclick: () => nav.go('library', doc.cat) }, KB.CATS[doc.cat].label), el('span', { class: 'sep' }, '/'), el('b', null, doc.title)),
      el('div', { class: 'actions' }, callPill,
        el('button', { class: 'btn sm', onclick: () => window.print() }, 'הדפסה'), pinBtn,
        el('button', { class: 'btn sm', onclick: () => nav.go('edit', doc.id), title: 'E' }, '✏️ ערוך'),
        el('button', { class: 'btn sm', onclick: () => nav.go('history', doc.id), title: 'H' }, '🕓 v' + (doc.version || 1)),
        el('button', { class: 'btn sm hamburger', onclick: () => { panelMobile = !panelMobile; redraw(); } }, 'קשרים'))));
    const trail = el('div', { class: 'trail' });
    const jump = el('div', { class: 'jumpstrip' });
    root.appendChild(trail); root.appendChild(jump);
    const layoutHost = el('div', { style: 'display:flex;flex-direction:column;flex:1;min-height:0' });
    root.appendChild(layoutHost);

    // ── call state ops
    const resultsMap = () => call.results;
    const skippedSet = () => { const st = steps(); const ai = st.findIndex((s) => s.id === call.active); const set = new Set(); st.slice(0, Math.max(0, ai)).forEach((s) => { if (!call.results[s.id]) set.add(s.id); }); return set; };
    const setActive = (id, scroll) => { if (!KB.step(doc, id)) return; call.active = id; if (callMode() && !call.started) call.started = Date.now(); KB.save(); nav.go('doc', doc.id, id, { replace: true }); redraw(); if (scroll !== false) setTimeout(() => { const n = $('#step-' + CSS.escape(id), root); if (n) n.scrollIntoView({ block: 'center', behavior: 'smooth' }); }, 30); };
    const move = (dir) => { const st = steps(); const i = st.findIndex((s) => s.id === call.active); const j = Math.min(st.length - 1, Math.max(0, i + dir)); if (j !== i) setActive(st[j].id); };
    const pickOutcome = (stepId, res) => {
      call.results[stepId] = Object.assign({ ts: Date.now() }, res);
      if (!call.started) call.started = Date.now();
      const st = steps(); const i = st.findIndex((s) => s.id === stepId);
      const next = res.goto && KB.step(doc, res.goto) ? res.goto : (st[i + 1] || {}).id;
      if (next) setActive(next); else { KB.save(); redraw(); KB.toast('✓ סיום המסמך · הסיכום מוכן להעתקה', 'ok'); }
    };
    const summaryText = () => { const st = steps(); const parts = [doc.title]; st.forEach((s) => { const r = call.results[s.id]; if (r) parts.push('ש' + s.num + ' ' + (r.kind === 'out' && /^[✓⚑→]/.test(r.label) ? r.label : '✓ ' + r.label)); else if (s.id === call.active) parts.push('ש' + s.num + ' ▶'); }); return parts.join(' · '); };
    const addNote = (stepId) => { const st = KB.step(doc, stepId); KB.prompt('הערת נציג · שלב ' + (st ? st.num : ''), 'מה כדאי שנציגים אחרים ידעו בשלב הזה?', '', (text) => { if (!text.trim()) return; (S.notes[doc.id] = S.notes[doc.id] || []).push({ id: KB.uid('n'), author: KB.USER.name, ts: Date.now(), stepId, text: text.trim(), likes: 0 }); KB.save(); panelTab = 'notes'; redraw(); KB.toast('ההערה נוספה', 'ok'); }, true); };
    const resetCall = () => { call.results = {}; call.started = callMode() ? Date.now() : null; call.active = (steps()[0] || {}).id; KB.save(); redraw(); };

    // ── layout
    function redraw() {
      KB.renderTabs();
      const st = steps();
      const active = KB.step(doc, call.active) || st[0];
      const done = Object.keys(call.results).filter((id) => KB.step(doc, id)).length;
      const skipped = skippedSet();
      callPill.className = 'callpill' + (callMode() ? '' : ' off');
      callPill.innerHTML = '';
      callPill.appendChild(el('span', { class: 'pulse' }));
      callPill.appendChild(el('span', null, callMode() ? 'מצב שיחה · ' + elapsed() : 'מצב קריאה'));
      if (callMode() && done) callPill.appendChild(el('span', { style: 'opacity:.7;cursor:pointer', title: 'אפס מעקב', onclick: (e) => { e.stopPropagation(); resetCall(); } }, ' ↺'));
      // trail
      trail.innerHTML = '';
      [['ספרייה', () => nav.go('library')], [KB.CATS[doc.cat].label, () => nav.go('library', doc.cat)], [doc.title, null]].forEach(([l, fn], i) => { if (i) trail.appendChild(el('span', null, '›')); trail.appendChild(fn ? el('a', { onclick: fn, style: 'cursor:pointer' }, l) : el('span', { style: 'color:var(--text);font-weight:500' }, l)); });
      if (active) { trail.appendChild(el('span', null, '›')); trail.appendChild(el('span', { class: 'cur' }, 'שלב ' + active.num + ' · ' + KB.stripFmt(active.title))); }
      trail.appendChild(el('span', { class: 'src' }, doc.sourceDoc ? 'מקור: ' + (active && active.source ? active.source : doc.sourceDoc.ref) : 'נכתב בספרייה'));
      // jump strip
      jump.innerHTML = '';
      st.forEach((s) => jump.appendChild(el('span', { class: 'j' + (call.results[s.id] ? ' done' : s.id === call.active ? ' cur' : skipped.has(s.id) ? ' skip' : ''), title: KB.stripFmt(s.title), onclick: () => setActive(s.id) }, s.num)));
      const routeLabel = active && active._phase && active._phase.route ? ' · מסלול ' + active._phase.route : '';
      jump.appendChild(el('span', { class: 'hint' + (jumpBuf != null ? ' armed' : '') }, skipped.size ? el('span', null, skipped.size + ' דולג' + routeLabel) : null, el('span', null, 'קפיצה לשלב '), el('kbd', null, jumpBuf != null ? 'G ' + (jumpBuf || '…') : 'G ואז מספר')));
      // main
      layoutHost.innerHTML = '';
      if (nav.split && nav.split.left === doc.id && KB.doc(nav.split.right)) { layoutHost.appendChild(renderSplit(nav.split.right)); return; }
      const ctx = { activeId: call.active, results: resultsMap(), skipped, callMode: callMode(), expandAll: !callMode(), connections: true, onSelect: (id) => setActive(id, false), onOutcome: pickOutcome, onNote: addNote };
      const article = el('article', { class: 'doc' }, KB.renderDocHead(doc), KB.renderDocBody(doc, ctx));
      const aside = renderCallAside(st, active, done);
      const scroll = el('div', { class: 'doc-scroll' + (callMode() ? '' : ' no-aside') }, article, callMode() ? aside : null);
      const main = el('div', { class: 'doc-main' }, scroll);
      const panel = renderPanel();
      panel.classList.toggle('mobile-open', panelMobile);
      layoutHost.appendChild(el('div', { class: 'doc-layout' + (S.prefs.panel === false ? ' no-panel' : '') }, main, S.prefs.panel === false ? null : panel));
    }
    function elapsed() { if (!call.started) return '00:00'; const s = Math.floor((Date.now() - call.started) / 1000); return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0'); }
    function renderCallAside(st, active, done) {
      const pct = Math.round((done / Math.max(1, st.length)) * 100);
      const ai = st.findIndex((s) => s.id === (active || {}).id);
      const cur = el('div', { class: 'card' }, el('div', { class: 'eyebrow', style: 'margin-bottom:10px' }, 'מעקב שיחה'),
        el('div', { class: 'row' }, el('span', null, 'שלב ' + (ai + 1) + ' מתוך ' + st.length), el('span', { class: 'muted' }, pct + '%')),
        el('div', { class: 'progress' }, el('i', { style: 'width:' + Math.max(pct, 4) + '%' })));
      const list = el('div', { class: 'rail-list' });
      const activePhase = active ? active._phase : null;
      const shown = st.filter((s) => !s._phase.route || (activePhase && s._phase.id === activePhase.id));
      const hidden = st.length - shown.length;
      shown.forEach((s) => list.appendChild(el('div', { class: 'rail-item' + (call.results[s.id] ? ' done' : s.id === call.active ? ' cur' : ''), onclick: () => setActive(s.id) }, el('span', { class: 'd' }, call.results[s.id] ? '✓' : s.num), el('span', { class: 't' }, KB.stripFmt(s.title)))));
      if (hidden) list.appendChild(el('div', { class: 'rail-more' }, '+ ' + hidden + ' שלבים לפי מסלול'));
      cur.appendChild(list);
      cur.appendChild(el('div', { class: 'keys' }, el('span', null, el('kbd', null, '↑↓'), ' מעבר שלב'), el('span', null, el('kbd', null, '1-3'), ' בחירת תוצאה'), el('span', null, el('kbd', null, 'N'), ' הערה'), el('span', null, el('kbd', null, 'G'), ' קפיצה לשלב')));
      const sum = el('div', { class: 'card' }, el('div', { class: 'eyebrow', style: 'margin-bottom:8px' }, 'סיכום לתיעוד'), el('div', { class: 'summary' }, summaryText()), el('span', { class: 'summary-copy', onclick: () => KB.copy(summaryText()) }, 'העתק ל-CRM', el('kbd', null, 'C')));
      return el('aside', { class: 'callaside' }, cur, sum);
    }
    function renderPanel() {
      const notes = KB.notesFor(doc.id);
      const panel = el('aside', { class: 'panel' });
      const tabs = el('div', { class: 'tabs' }, [['links', 'קשרים'], ['notes', 'הערות ' + notes.length], ['versions', 'גרסאות']].map(([k, l]) => el('span', { class: k === panelTab ? 'on' : '', onclick: () => { panelTab = k; redraw(); } }, l)));
      if (panelMobile) tabs.appendChild(el('span', { style: 'flex:0 0 44px', onclick: () => { panelMobile = false; redraw(); } }, '✕'));
      panel.appendChild(tabs);
      const body = el('div', { class: 'pbody' });
      if (panelTab === 'links') {
        const rel = KB.relatedDocs(doc);
        body.appendChild(el('div', null, el('div', { class: 'eyebrow' }, 'מסמכים קשורים · אוטומטי'), el('div', { style: 'display:flex;flex-direction:column;gap:6px' }, rel.length ? rel.map((x) => { const d = KB.doc(x.docId); return el('a', { class: 'rel', 'data-doc': d.id, onclick: (e) => nav.openDoc(d.id, null, { newTab: e.ctrlKey || e.metaKey }) }, el('span', { class: 'ic' }, KB.CATS[d.cat].icon), el('div', { class: 'tx' }, d.title, el('div', null, x.why))); }) : el('div', { class: 'small muted' }, 'לא זוהו קשרים עדיין'))));
        const crm = KB.docCrm(doc);
        body.appendChild(el('div', null, el('div', { class: 'eyebrow' }, 'שדות CRM במסמך'), el('div', { class: 'crm-wrap', html: crm.length ? crm.map((n) => KB.crmChip(n)).join('') : '<span class="small muted">אין שדות CRM</span>' })));
        const blocks = KB.steps(doc).filter((s) => s.block).map((s) => KB.block(s.block)).filter(Boolean);
        body.appendChild(el('div', null, el('div', { class: 'eyebrow' }, 'בלוקים משותפים'), el('div', { class: 'blocks-list' }, blocks.length ? blocks.map((b) => el('div', { onclick: () => KB.showBlock(b.id) }, el('span', null, b.title + ' (' + (b.actions || []).length + ' פעולות)'), el('span', { class: 'u' }, 'ב-' + KB.blockUsage(b.id).length + ' מסמכים'))) : el('div', { class: 'small muted' }, 'אין בלוקים משותפים במסמך'))));
        body.appendChild(renderMap());
        const latest = notes[notes.length - 1];
        if (latest) body.appendChild(noteEl(latest));
      } else if (panelTab === 'notes') {
        const ta = el('textarea', { placeholder: 'מה כדאי שנציגים אחרים ידעו? (N מתוך שלב)' });
        const stepSel = el('select', null, el('option', { value: '' }, 'כללי'), steps().map((s) => el('option', { value: s.id, selected: s.id === call.active }, 'שלב ' + s.num)));
        body.appendChild(el('div', { class: 'note-form' }, el('div', { class: 'eyebrow' }, 'הערת נציג חדשה'), ta, el('div', { class: 'r' }, stepSel, el('button', { class: 'btn sm primary', onclick: () => { if (!ta.value.trim()) return; (S.notes[doc.id] = S.notes[doc.id] || []).push({ id: KB.uid('n'), author: KB.USER.name, ts: Date.now(), stepId: stepSel.value || null, text: ta.value.trim(), likes: 0 }); KB.save(); redraw(); } }, 'הוסף'))));
        if (!notes.length) body.appendChild(el('div', { class: 'small muted' }, 'אין הערות עדיין'));
        notes.slice().reverse().forEach((n) => body.appendChild(noteEl(n)));
      } else {
        const vs = KB.versionsOf(doc.id).slice().reverse();
        const list = el('div', { class: 'vlist' });
        vs.forEach((v, i) => list.appendChild(el('div', { class: 'vi' + (i === 0 ? ' cur' : ''), onclick: () => nav.go('history', doc.id, i === 0 ? undefined : String(v.v)) }, el('span', { class: 'd' }), el('div', { class: 'b' }, el('div', { class: 't' }, 'v' + v.v + (i === 0 ? ' · נוכחי' : '')), el('div', { class: 'm' }, v.author + ' · ' + KB.fmtDate(v.ts)), v.label ? el('div', { class: 'l' }, v.label) : null))));
        if (!vs.length) list.appendChild(el('div', { class: 'small muted' }, 'עדיין אין גרסאות שמורות · פרסום מהעורך יוצר גרסה'));
        body.appendChild(el('div', null, el('div', { class: 'eyebrow' }, 'היסטוריית גרסאות'), list, el('button', { class: 'btn sm', style: 'margin-top:8px', onclick: () => nav.go('history', doc.id) }, 'השוואה מלאה ושחזור')));
      }
      panel.appendChild(body);
      return panel;
    }
    function noteEl(n) {
      const liked = S.notesLiked.includes(n.id);
      const st = n.stepId ? KB.step(doc, n.stepId) : null;
      return el('div', { class: 'note' }, el('div', { class: 'by' }, el('span', null, 'הערת נציג · ' + n.author + ' · ' + KB.ago(n.ts)), st ? el('span', { style: 'cursor:pointer', onclick: () => setActive(st.id) }, 'שלב ' + st.num) : null), el('span', { html: KB.fmt(n.text) }), el('span', { class: 'like' + (liked ? ' on' : ''), onclick: () => { const i = S.notesLiked.indexOf(n.id); if (i >= 0) { S.notesLiked.splice(i, 1); n.likes = Math.max(0, (n.likes || 0) - 1); } else { S.notesLiked.push(n.id); n.likes = (n.likes || 0) + 1; } KB.save(); redraw(); } }, '👍 ' + (n.likes || 0)));
    }
    function renderMap() {
      const st = steps(); const active = KB.step(doc, call.active);
      const map = el('div', { class: 'map' });
      doc.phases.forEach((p) => {
        if (!p.steps.length) return;
        const nums = p.steps.map((s) => s.num); const rng = nums.length > 1 ? nums[0] + '–' + nums[nums.length - 1] : nums[0];
        const allDone = p.steps.every((s) => call.results[s.id]); const here = active && active._phase.id === p.id;
        map.appendChild(el('div', { class: (p.route ? 'in' : '') + (here ? ' here' : ''), onclick: () => setActive(p.steps[0].id) }, el('span', { class: 'd' + (allDone ? ' done' : here ? ' cur' : '') }), (p.label || 'שלבים') + ' · ' + rng, here ? el('span', { class: 'here-tag' }, 'כאן') : null));
      });
      const last = st[st.length - 1];
      if (last && (last.outcomes || []).some((o) => o.kind === 'alert')) map.appendChild(el('div', null, el('span', { class: 'd' }), 'הסלמה · מומחי תמיכה'));
      return el('div', { class: 'card', style: 'padding:14px 16px' }, el('div', { class: 'eyebrow', style: 'margin-bottom:8px' }, 'מפת הכרטיס'), map, el('div', { class: 'map-foot' }, el('span', null, 'נכנס מ־: ' + KB.docLinksIn(doc.id).length + ' כרטיסים'), el('span', null, 'יוצא ל־: ' + KB.docLinksOut(doc).length)));
    }
    /* split view: two documents, scroll synced by shared block */
    function renderSplit(rightId) {
      const right = KB.doc(rightId);
      const shared = KB.sharedWith(doc, right);
      const banner = el('div', { class: 'split-banner' }, el('b', null, 'פיצול מסך'), el('span', { class: 'muted' }, shared.length ? '· גלילה מסונכרנת לפי בלוק משותף: ' + shared.map((s) => '⧉ ' + s.block.title).join(', ') : '· אין בלוק משותף בין שני המסמכים — גלילה חופשית'), el('span', { class: 'small muted' }, '⫿ Ctrl \\'), el('button', { class: 'btn xs', onclick: () => { nav.split = { left: doc.id, right: null }; KB.palette.open({ mode: 'split' }); } }, 'החלף מסמך'), el('button', { class: 'btn xs', onclick: () => nav.toggleSplit() }, '✕ סגור פיצול'));
      const ctxL = { activeId: call.active, results: resultsMap(), skipped: skippedSet(), callMode: callMode(), expandAll: !callMode(), onSelect: (id) => setActive(id, false), onOutcome: pickOutcome, onNote: addNote, prefix: 'L-' };
      const ctxR = { expandAll: true, prefix: 'R-' };
      const paneL = el('div', { class: 'pane' }, el('div', { class: 'pane-head' }, el('b', null, doc.title), el('span', { class: 'chip chip-gray' }, 'שלב ' + ((KB.step(doc, call.active) || {}).num || ''))), el('div', { class: 'doc-scroll no-aside' }, el('article', { class: 'doc' }, KB.renderDocBody(doc, ctxL))));
      const paneR = el('div', { class: 'pane' }, el('div', { class: 'pane-head' }, el('b', null, right.title), el('button', { class: 'btn xs', onclick: () => nav.openDoc(right.id) }, 'פתח מלא')), el('div', { class: 'doc-scroll no-aside' }, el('article', { class: 'doc' }, KB.renderDocBody(right, ctxR))));
      // synced scroll: when a shared-block step reaches the top of one pane, align the same block in the other
      let lock = 0;
      const sync = (from, to) => () => {
        if (lock) return;
        const fs = from.querySelector('.doc-scroll'), ts = to.querySelector('.doc-scroll');
        const top = fs.getBoundingClientRect().top;
        const blocks = $$('.step[data-block]', fs).filter((n) => n.dataset.block);
        const near = blocks.find((n) => { const r = n.getBoundingClientRect(); return r.top >= top - 20 && r.top <= top + 140; });
        if (!near) return;
        const target = ts.querySelector('.step[data-block="' + CSS.escape(near.dataset.block) + '"]');
        if (!target) return;
        lock = 1; ts.scrollTop += target.getBoundingClientRect().top - ts.getBoundingClientRect().top - (near.getBoundingClientRect().top - top); setTimeout(() => { lock = 0; }, 120);
      };
      paneL.querySelector('.doc-scroll').addEventListener('scroll', sync(paneL, paneR));
      paneR.querySelector('.doc-scroll').addEventListener('scroll', sync(paneR, paneL));
      return el('div', { style: 'display:flex;flex-direction:column;flex:1;min-height:0' }, banner, el('div', { class: 'splitwrap' }, paneL, paneR));
    }

    // ── keyboard
    on('key', (e) => {
      const k = e.key;
      if (k === 'ArrowDown') { e.preventDefault(); move(1); }
      else if (k === 'ArrowUp') { e.preventDefault(); move(-1); }
      else if (k === 'Enter') { e.preventDefault(); const n = $('#step-' + CSS.escape(call.active), root); if (n) n.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
      else if (/^[1-3]$/.test(k) && callMode()) { const s = KB.resolveStep(KB.step(doc, call.active)); if (!s) return; const i = parseInt(k) - 1; if (s.branch && s.branch.options[i]) pickOutcome(s.id, { kind: 'branch', idx: i, label: s.branch.options[i].label, goto: s.branch.options[i].goto }); else if ((s.outcomes || [])[i]) pickOutcome(s.id, { kind: 'out', idx: i, label: KB.stripFmt(s.outcomes[i].text), goto: s.outcomes[i].goto }); }
      else if (k === 'n' || k === 'N' || k === 'מ') addNote(call.active);
      else if (k === 'p' || k === 'P' || k === 'פ') { const on = KB.togglePin(doc.id); KB.toast(on ? '★ הוצמד' : 'הוסרה הצמדה'); pinBtn.textContent = on ? '★ מוצמד' : '☆ הצמד'; }
      else if (k === 'c' || k === 'C' || k === 'ב') KB.copy(summaryText());
      else if (k === 'e' || k === 'E' || k === 'ק') nav.go('edit', doc.id);
      else if (k === 'h' || k === 'H' || k === 'י') nav.go('history', doc.id);
    });
    on('jump-armed', (buf) => { jumpBuf = buf; const h = jump.querySelector('.hint'); if (h) { h.classList.toggle('armed', buf != null); h.querySelector('kbd').textContent = buf != null ? 'G ' + (buf || '…') : 'G ואז מספר'; } });
    on('jump', (num) => { const s = steps().find((x) => String(x.num) === String(num)); if (s) setActive(s.id); else KB.toast('אין שלב ' + num, 'warn'); });
    on('doc-refresh', () => { const fresh = KB.doc(doc.id); if (!fresh) { nav.go('library'); return; } Object.assign(doc, fresh); redraw(); });
    on('escape', () => { if (panelMobile) { panelMobile = false; redraw(); } else if (nav.split) nav.toggleSplit(); });
    on('pins', () => { pinBtn.textContent = KB.isPinned(doc.id) ? '★ מוצמד' : '☆ הצמד'; });
    if (callMode() && !call.started) call.started = Date.now();
    timer = setInterval(() => { const t = callPill.querySelector('span:nth-child(2)'); if (t && callMode()) t.textContent = 'מצב שיחה · ' + elapsed(); }, 1000);
    redraw();
    if (r.b) setTimeout(() => { const n = $('#step-' + CSS.escape(r.b), root); if (n) n.scrollIntoView({ block: 'center' }); }, 60);
    return () => { clearInterval(timer); subs.forEach((u) => u()); };
  };
})();
