/* wecom KB — editor: block library (reusable steps), structured form ↔ live preview,
   autosave, permissions, JSON export, pre-publish checks */
(function () {
  'use strict';
  const KB = window.KB; const { $, $$, el, esc } = KB; const S = KB.state(); const nav = KB.nav;
  KB.views = KB.views || {};

  const BASICS = [
    { type: 'step', label: 'שלב', ic: '1', cls: 'round' }, { type: 'branch', label: 'הסתעפות אם/אז', ic: '?', cls: 'navy' }, { type: 'outcomes', label: 'תוצאות', ic: '✓', cls: 'ok' },
    { type: 'script', label: 'תסריט שיחה', ic: '“', cls: 'quote' }, { type: 'crm', label: 'שדה CRM', ic: 'CRM', cls: '' }, { type: 'link', label: 'קישור למסמך', ic: '↗', cls: '' }
  ];
  const newStep = (num) => ({ id: KB.uid('s'), num: String(num), title: '', actions: [{ id: KB.uid('a'), text: '' }], outcomes: [] });
  const renumber = (doc) => { let n = 1; doc.phases.forEach((p) => p.steps.forEach((s) => { if (!/[א-ת]/.test(s.num || '')) s.num = String(n++); })); };

  KB.views.editor = function (root, r) {
    const isNew = r.a === 'new';
    const existing = isNew ? null : KB.doc(r.a);
    if (!isNew && !existing && !S.drafts[r.a]) { root.appendChild(el('div', { class: 'empty' }, el('b', null, 'המסמך לא נמצא'))); return; }
    const draftId = isNew ? ('doc-' + Date.now().toString(36)) : r.a;
    let doc;
    if (S.drafts[draftId]) doc = S.drafts[draftId].doc;
    else if (existing) doc = KB.clone(existing);
    else {
      const topic = /^\d+$/.test(r.b || '') ? KB.topic(parseInt(r.b)) : null;
      doc = { id: draftId, title: topic ? topic.title : '', desc: topic ? topic.desc : '', cat: topic ? topic.cat : (KB.CATS[r.b] ? r.b : 'tech'), wave: topic ? topic.wave : 2, pri: topic ? topic.pri : 'm', src: (topic && topic.cat === 'intl') || r.b === 'intl' ? 'intl' : 'topics', kind: 'steps', status: 'draft', version: 0, author: KB.USER.name, updated: new Date().toISOString().slice(0, 10), topicId: topic ? topic.id : undefined, phases: [{ id: 'p1', label: 'שלב 1 – מסנן', steps: [newStep(1)] }] };
    }
    if (isNew) { history.replaceState(null, '', '#/edit/' + draftId); nav.current = { route: 'edit', a: draftId }; if (nav.pos >= 0) nav.stack[nav.pos] = nav.current; S.drafts[draftId] = { doc, ts: Date.now() }; KB.save(); }
    const published = existing ? KB.doc(existing.id) : null;
    let selected = (KB.steps(doc)[0] || {}).id, sideTab = 'preview', lastSaved = S.drafts[draftId] ? S.drafts[draftId].ts : null, dirty = false, blockQuery = '';
    const subs = []; const on = (ev, fn) => subs.push(KB.on(ev, fn));

    const save = KB.debounce(() => { S.drafts[draftId] = { doc, ts: Date.now() }; lastSaved = Date.now(); dirty = false; KB.save(); drawSaved(); KB.emit('drafts'); }, 600);
    const touch = (opts) => { dirty = true; drawSaved(); save(); if (!opts || !opts.noSide) drawSide(); if (opts && opts.redraw) drawBody(); };

    /* ── layout ─────────────────────────────────────────────────────────── */
    const blocksPane = el('aside', { class: 'ed-blocks' });
    const main = el('div', { class: 'ed-main' });
    const side = el('aside', { class: 'ed-side' });
    root.appendChild(el('div', { class: 'ed-layout' }, blocksPane, main, side));

    // topbar
    const titleIn = el('input', { class: 'title-in', type: 'text', placeholder: 'שם פריט הידע…', value: doc.title });
    titleIn.addEventListener('input', () => { doc.title = titleIn.value; touch(); });
    const statusChip = el('span', { class: 'chip chip-amber' });
    const savedEl = el('span', { class: 'saved' });
    const publishBtn = el('button', { class: 'btn primary sm', onclick: publish });
    main.appendChild(el('div', { class: 'topbar h56' }, KB.hamburger(), el('button', { class: 'btn ghost sm', title: 'חזרה', onclick: () => leave() }, '→'), titleIn, statusChip, savedEl,
      el('div', { class: 'actions' }, el('button', { class: 'btn sm hamburger', onclick: () => { blocksPane.classList.toggle('mobile-open'); } }, 'בלוקים'), el('button', { class: 'btn sm hamburger', onclick: () => { side.classList.toggle('mobile-open'); } }, 'תצוגה'),
        el('button', { class: 'btn sm', onclick: () => KB.download((doc.title || 'knowledge-item') + '.json', JSON.stringify(doc, null, 2)) }, 'ייצוא JSON'),
        el('button', { class: 'btn sm', onclick: requestReview }, 'בקש סקירה'), publishBtn)));
    const body = el('div', { class: 'ed-body' });
    main.appendChild(body);

    function drawSaved() { savedEl.className = 'saved' + (dirty ? ' dirty' : ''); savedEl.innerHTML = ''; savedEl.appendChild(el('span', { class: 'dot' })); savedEl.appendChild(el('span', null, dirty ? 'שומר…' : lastSaved ? 'נשמר · ' + KB.ago(lastSaved) : 'טרם נשמר')); const rev = S.prefs.reviewRequests[draftId]; statusChip.textContent = rev ? 'בסקירה' : published ? 'טיוטה על v' + (published.version || 1) : 'טיוטה'; publishBtn.textContent = 'פרסם v' + ((published ? published.version || 0 : 0) + 1); }
    const savedTimer = setInterval(drawSaved, 5000);

    /* ── block library ──────────────────────────────────────────────────── */
    function drawBlocks() {
      blocksPane.innerHTML = '';
      blocksPane.appendChild(el('div', { class: 'eyebrow', style: 'display:flex;justify-content:space-between;align-items:center' }, 'ספריית בלוקים', el('span', { class: 'hamburger', style: 'cursor:pointer', onclick: () => blocksPane.classList.remove('mobile-open') }, '✕')));
      const q = el('input', { type: 'text', placeholder: 'חפש בלוק…', value: blockQuery }); q.addEventListener('input', () => { blockQuery = q.value.trim().toLowerCase(); drawBlockList(); });
      blocksPane.appendChild(q);
      const list = el('div', { class: 'list' }); blocksPane.appendChild(list);
      function drawBlockList() {
        list.innerHTML = '';
        const match = (t) => !blockQuery || t.toLowerCase().includes(blockQuery);
        const basics = BASICS.filter((b) => match(b.label));
        if (basics.length) { list.appendChild(el('div', { class: 'gl' }, el('span', null, 'יסודות'))); basics.forEach((b) => list.appendChild(el('div', { class: 'blk', draggable: true, title: 'גרור לטופס או לחץ להוספה', ondragstart: (e) => { e.dataTransfer.setData('text/kb', 'basic:' + b.type); e.dataTransfer.effectAllowed = 'copy'; }, onclick: () => addBasic(b.type) }, el('span', { class: 'ic ' + b.cls }, b.ic), b.label))); }
        const shared = KB.blocks().filter((b) => match(b.title + ' ' + (b.actions || []).map((a) => a.text).join(' ')));
        list.appendChild(el('div', { class: 'gl' }, el('span', null, 'בלוקים משותפים'), el('span', null, String(KB.blocks().length))));
        shared.forEach((b) => { const used = KB.blockUsage(b.id).length; list.appendChild(el('div', { class: 'blk' + (used >= 3 ? ' shared' : ''), draggable: true, ondragstart: (e) => { e.dataTransfer.setData('text/kb', 'shared:' + b.id); e.dataTransfer.effectAllowed = 'copy'; }, onclick: () => addShared(b.id) }, el('span', { class: 'ic ' + (used >= 3 ? 'red' : 'navy') }, '⧉'), el('div', { class: 'tx' }, b.title, el('div', null, (b.kind === 'script' ? 'תסריט' : (b.actions || []).length + ' פעולות') + ' · ב-' + used)))); });
        list.appendChild(el('div', { class: 'blk', style: 'border-style:dashed;justify-content:center;color:var(--muted)', onclick: () => KB.newBlock() }, '+ בלוק משותף חדש'));
        KB.PRESETS.forEach((g) => { const items = g.items.filter(match); if (!items.length) return; list.appendChild(el('div', { class: 'gl' }, el('span', null, g.group))); items.forEach((t) => list.appendChild(el('div', { class: 'preset-item', draggable: true, title: 'הוסף כפעולה לשלב הנבחר', ondragstart: (e) => { e.dataTransfer.setData('text/kb', 'preset:' + t); }, onclick: () => addAction(t) }, t))); });
      }
      drawBlockList();
    }
    const selStep = () => KB.step(doc, selected) || KB.steps(doc)[0];
    const phaseOf = (stepId) => doc.phases.find((p) => p.steps.some((s) => s.id === stepId));
    function addBasic(type, targetId) {
      const s = targetId ? KB.step(doc, targetId) : selStep();
      if (type === 'step') { const p = s ? phaseOf(s.id) : doc.phases[doc.phases.length - 1]; const ns = newStep(KB.steps(doc).length + 1); const i = s ? p.steps.findIndex((x) => x.id === s.id) + 1 : p.steps.length; p.steps.splice(i, 0, ns); selected = ns.id; renumber(doc); touch({ redraw: true }); focusTitle(ns.id); return; }
      if (!s) { addBasic('step'); return; }
      if (type === 'branch') { s.branch = s.branch || { q: 'מה מוצג?', options: [{ kind: 'if', label: '', text: '' }, { kind: 'then', label: '', text: '' }] }; }
      if (type === 'outcomes') { s.outcomes = s.outcomes && s.outcomes.length ? s.outcomes : [{ kind: 'ok', text: '✓ הסתדר – סיום' }, { kind: 'next', text: '→ לא הסתדר – המשך' }]; }
      if (type === 'script') { s.script = s.script || '"…"'; }
      if (type === 'crm') { pickCrm((name) => { s.actions = s.actions || []; s.actions.push({ id: KB.uid('a'), text: 'פתח CRM ↗ שדה ' + name }); touch({ redraw: true }); }); return; }
      if (type === 'link') { pickDoc((d) => { s.actions = s.actions || []; s.actions.push({ id: KB.uid('a'), text: 'המשך לפי [[doc:' + d.id + ']]' }); touch({ redraw: true }); }); return; }
      touch({ redraw: true });
    }
    function addShared(blockId, targetId) {
      const b = KB.block(blockId); if (!b) return;
      const s = targetId ? KB.step(doc, targetId) : null;
      if (s && !s.block) { s.block = blockId; delete s.actions; s.title = s.title || b.title; touch({ redraw: true }); return; }
      const p = doc.phases[doc.phases.length - 1];
      const ns = { id: KB.uid('s'), num: String(KB.steps(doc).length + 1), title: b.title, block: blockId, outcomes: KB.clone(b.outcomes || []) };
      p.steps.push(ns); selected = ns.id; renumber(doc); touch({ redraw: true });
    }
    function addAction(text, targetId) { const s = targetId ? KB.step(doc, targetId) : selStep(); if (!s) { addBasic('step'); return; } if (s.block) { KB.toast('זהו בלוק משותף — נתק העתק כדי לערוך', 'warn'); return; } s.actions = s.actions || []; s.actions.push({ id: KB.uid('a'), text }); touch({ redraw: true }); }
    function pickCrm(cb) { const sel = el('select', null, KB.CRM_FIELDS.map((f) => el('option', { value: f.name }, f.name + (f.status !== 'ok' ? ' · ' + (f.status === 'renamed' ? 'שונה שם' : 'חדש') : '')))); KB.modal({ title: 'שדה CRM', body: el('div', { class: 'form' }, el('label', null, 'בחר שדה מ-crm-fields.json', sel)), buttons: [{ label: 'ביטול' }, { label: 'הוסף', cls: 'primary', onclick: () => cb(sel.value) }] }); }
    function pickDoc(cb) { const docs = KB.docs().filter((d) => d.id !== doc.id); const sel = el('select', null, docs.map((d) => el('option', { value: d.id }, d.title))); KB.modal({ title: 'קישור למסמך', body: el('div', { class: 'form' }, el('label', null, 'מסמך יעד', sel)), buttons: [{ label: 'ביטול' }, { label: 'קשר', cls: 'primary', onclick: () => cb(KB.doc(sel.value)) }] }); }
    function focusTitle(id) { setTimeout(() => { const n = $('[data-estep="' + CSS.escape(id) + '"] input.t', body); if (n) { n.focus(); n.scrollIntoView({ block: 'center' }); } }, 30); }

    /* ── main form ──────────────────────────────────────────────────────── */
    function drawBody() {
      body.innerHTML = '';
      const fields = el('div', { class: 'ed-fields' });
      const mk = (label, node) => el('label', null, label, node);
      const catSel = el('select', null, Object.keys(KB.CATS).map((c) => el('option', { value: c, selected: c === doc.cat }, KB.CATS[c].icon + ' ' + KB.CATS[c].label))); catSel.addEventListener('change', () => { doc.cat = catSel.value; if (doc.cat === 'intl') doc.src = 'intl'; touch({ redraw: true }); });
      const waveSel = el('select', null, [1, 2, 3].map((w) => el('option', { value: w, selected: w === doc.wave }, 'גל ' + w))); waveSel.addEventListener('change', () => { doc.wave = parseInt(waveSel.value); touch(); });
      const priSel = el('select', null, Object.keys(KB.PRI).map((p) => el('option', { value: p, selected: p === (doc.pri || 'm') }, KB.PRI[p].label))); priSel.addEventListener('change', () => { doc.pri = priSel.value; touch(); });
      const srcSel = el('select', { class: 'mono' }, KB.SOURCES.filter((s) => s.kind === 'docs').map((s) => el('option', { value: s.id, selected: s.id === (doc.src || 'topics') }, s.file))); srcSel.addEventListener('change', () => { doc.src = srcSel.value; touch(); });
      fields.append(mk('קטגוריה', catSel), mk('גל כתיבה', waveSel), mk('שכיחות', priSel), mk('קובץ יעד', srcSel));
      body.appendChild(fields);
      const desc = el('input', { class: 'ed-desc', type: 'text', placeholder: 'תיאור קצר לנציגים (מוצג בכרטיס)', value: doc.desc || '' }); desc.addEventListener('input', () => { doc.desc = desc.value; touch(); });
      body.appendChild(desc);
      doc.phases.forEach((p, pi) => {
        const lbl = el('input', { type: 'text', value: p.label || '', placeholder: 'שם השלב (למשל: שלב 1 – מסנן)' }); lbl.addEventListener('input', () => { p.label = lbl.value; touch(); });
        body.appendChild(el('div', { class: 'ed-phase' }, lbl, el('span', { class: 'line' }), el('span', { class: 'x', title: 'שנה שם' }, '✎ שם השלב'), doc.phases.length > 1 ? el('span', { class: 'x', onclick: () => { if (p.steps.length && !confirm('למחוק את הקבוצה עם ' + p.steps.length + ' שלבים?')) return; doc.phases.splice(pi, 1); renumber(doc); touch({ redraw: true }); } }, '✕') : null));
        p.steps.forEach((s, si) => body.appendChild(stepEditor(s, p, si)));
      });
      body.appendChild(dropzone());
      const authors = Array.from(new Set(KB.versionsOf(doc.id).map((v) => v.author))).join(', ');
      body.appendChild(el('div', { class: 'perm' }, el('b', null, 'הרשאות'), el('span', { class: 'chip chip-navy' }, 'עורכים'), el('span', { class: 'chip' }, 'מנהלי צוות – פרסום'), el('span', { class: 'chip' }, 'נציגים – הערות בלבד'), el('span', { class: 'hist' }, 'היסטוריה: ' + KB.versionsOf(doc.id).length + ' גרסאות' + (authors ? ' · ' + authors : '')), el('button', { class: 'btn xs', onclick: () => { doc.phases.push({ id: KB.uid('p'), label: 'קבוצה חדשה', steps: [] }); touch({ redraw: true }); } }, '+ קבוצת שלבים')));
    }
    function stepEditor(s, p, si) {
      const box = el('div', { class: 'ebox' + (s.block ? ' shared' : '') + (s.id === selected ? ' sel' : ''), onclick: () => { if (selected !== s.id) { selected = s.id; $$('.ebox', body).forEach((b) => b.classList.remove('sel')); box.classList.add('sel'); } },
        ondragover: (e) => { if (e.dataTransfer.types.includes('text/kb')) { e.preventDefault(); wrap.classList.add('over'); } }, ondragleave: () => wrap.classList.remove('over'),
        ondrop: (e) => { e.preventDefault(); wrap.classList.remove('over'); const d = e.dataTransfer.getData('text/kb'); handleDrop(d, s.id, p, si); } });
      const wrap = el('div', { class: 'estep', 'data-estep': s.id }, el('span', { class: 'n' }, s.num), box);
      const hd = el('div', { class: 'hd' });
      if (s.block) {
        const b = KB.block(s.block); const used = b ? KB.blockUsage(s.block).length : 0;
        hd.appendChild(el('span', { class: 'shared-hd', style: 'flex:1' }, el('span', { class: 'blockbar' }, '⧉ בלוק משותף'), el('span', { class: 't' }, b ? b.title : 'בלוק חסר'), el('span', null, 'מקושר · שינוי כאן יעדכן ' + used + ' מסמכים'), el('span', { class: 'detach', onclick: (e) => { e.stopPropagation(); if (b) { s.actions = KB.clone(b.actions || []); s.title = s.title || b.title; if (b.script) s.script = b.script; } delete s.block; touch({ redraw: true }); KB.toast('הבלוק נותק — עותק מקומי'); } }, 'נתק העתק'), b ? el('span', { class: 'detach', onclick: (e) => { e.stopPropagation(); KB.editBlock(s.block); } }, 'ערוך בלוק') : null));
      } else {
        const t = el('input', { class: 't', type: 'text', placeholder: 'כותרת השלב', value: s.title || '' }); t.addEventListener('input', () => { s.title = t.value; touch(); });
        hd.appendChild(t);
      }
      hd.appendChild(el('span', { class: 'mv', title: 'העלה', onclick: (e) => { e.stopPropagation(); moveStep(s.id, -1); } }, '↑'));
      hd.appendChild(el('span', { class: 'mv', title: 'הורד', onclick: (e) => { e.stopPropagation(); moveStep(s.id, 1); } }, '↓'));
      hd.appendChild(el('span', { class: 'drag', draggable: true, title: 'גרור לסידור מחדש', ondragstart: (e) => { e.dataTransfer.setData('text/kb', 'move:' + s.id); wrap.classList.add('dragging'); }, ondragend: () => wrap.classList.remove('dragging') }, '⋮⋮ גרור'));
      hd.appendChild(el('span', { class: 'del', title: 'מחק שלב', onclick: (e) => { e.stopPropagation(); p.steps.splice(si, 1); renumber(doc); touch({ redraw: true }); } }, '✕'));
      box.appendChild(hd);
      if (s.block) { const b = KB.block(s.block); box.appendChild(el('div', { class: 'shared-body', html: b ? (b.kind === 'script' ? KB.fmt(b.script) : (b.actions || []).map((a) => KB.fmt(a.text)).join(' · ')) : 'הבלוק בסל המיחזור' })); }
      else {
        if (s.desc != null) { const d = el('input', { type: 'text', placeholder: 'תיאור / הנחיה', value: s.desc, style: 'font-size:12.5px' }); d.addEventListener('input', () => { s.desc = d.value; touch(); }); box.appendChild(d); }
        (s.actions || []).forEach((a, ai) => {
          const inp = el('input', { type: 'text', placeholder: 'פעולה… (שדות CRM מזוהים אוטומטית, **מודגש**, [[doc:id]] קישור)', value: a.text });
          const st = el('span', { class: 'st' });
          const upd = () => { const f = KB.crmIn(inp.value); st.textContent = f.length ? 'שדה מזוהה ✓' : (/"[^"]+"/.test(inp.value) ? 'ציטוט · לא שדה CRM' : ''); st.className = 'st' + (f.length ? ' ok' : ''); };
          inp.addEventListener('input', () => { a.text = inp.value; upd(); touch(); });
          inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); s.actions.splice(ai + 1, 0, { id: KB.uid('a'), text: '' }); touch({ redraw: true }); setTimeout(() => { const ins = $$('[data-estep="' + CSS.escape(s.id) + '"] .eact input', body); if (ins[ai + 1]) ins[ai + 1].focus(); }, 20); } if (e.key === 'Backspace' && !inp.value && s.actions.length > 1) { e.preventDefault(); s.actions.splice(ai, 1); touch({ redraw: true }); } });
          upd();
          box.appendChild(el('div', { class: 'eact' }, el('span', { class: 'caret' }, '›'), inp, st, el('span', { class: 'x', onclick: () => { s.actions.splice(ai, 1); touch({ redraw: true }); } }, '✕')));
        });
        if (s.script != null) { const ta = el('textarea', { rows: 2, placeholder: 'תסריט שיחה לנציג' }); ta.value = s.script; ta.addEventListener('input', () => { s.script = ta.value; touch(); }); box.appendChild(el('div', { class: 'escript' }, ta, el('span', { class: 'x small muted', style: 'cursor:pointer', onclick: () => { delete s.script; touch({ redraw: true }); } }, 'הסר תסריט'))); }
        if (s.branch) box.appendChild(branchEditor(s));
      }
      (s.outcomes || []).forEach((o, oi) => {
        const kind = el('select', null, [['ok', '✓ סיום'], ['next', '→ המשך'], ['alert', '⚑ חריג']].map(([k, l]) => el('option', { value: k, selected: k === o.kind }, l))); kind.addEventListener('change', () => { o.kind = kind.value; touch(); });
        const tx = el('input', { type: 'text', placeholder: 'טקסט התוצאה', value: o.text }); tx.addEventListener('input', () => { o.text = tx.value; touch(); });
        box.appendChild(el('div', { class: 'eout' }, kind, tx, gotoSel(o), el('span', { class: 'x', onclick: () => { s.outcomes.splice(oi, 1); touch({ redraw: true }); } }, '✕')));
      });
      const add = el('div', { class: 'addrow' });
      if (!s.block) { add.appendChild(el('span', { onclick: () => { s.actions = s.actions || []; s.actions.push({ id: KB.uid('a'), text: '' }); touch({ redraw: true }); setTimeout(() => { const ins = $$('[data-estep="' + CSS.escape(s.id) + '"] .eact input', body); if (ins.length) ins[ins.length - 1].focus(); }, 20); } }, '+ פעולה')); }
      add.appendChild(el('span', { onclick: () => { s.outcomes = s.outcomes || []; s.outcomes.push({ kind: s.outcomes.length ? 'next' : 'ok', text: '' }); touch({ redraw: true }); } }, '+ תוצאה'));
      if (!s.block) { add.appendChild(el('span', { onclick: () => addBasic('branch', s.id) }, '+ הסתעפות')); add.appendChild(el('span', { onclick: () => { if (s.script == null) s.script = ''; touch({ redraw: true }); } }, '+ תסריט')); add.appendChild(el('span', { onclick: () => { if (s.desc == null) s.desc = ''; touch({ redraw: true }); } }, '+ תיאור')); add.appendChild(el('span', { onclick: () => addBasic('crm', s.id) }, '+ שדה CRM')); add.appendChild(el('span', { onclick: () => addBasic('link', s.id) }, '+ קישור')); }
      box.appendChild(add);
      return wrap;
    }
    function gotoSel(o) { const sel = el('select', { class: 'goto', title: 'קפיצה לשלב' }, el('option', { value: '' }, 'הבא'), KB.steps(doc).map((x) => el('option', { value: x.id, selected: x.id === o.goto }, '→ ' + x.num + ' ' + KB.stripFmt(x.title).slice(0, 18)))); sel.addEventListener('change', () => { if (sel.value) o.goto = sel.value; else delete o.goto; touch(); }); return sel; }
    function branchEditor(s) {
      const br = el('div', { class: 'ebr' });
      const q = el('input', { type: 'text', value: s.branch.q, placeholder: 'השאלה (מה מוצג?)' }); q.addEventListener('input', () => { s.branch.q = q.value; touch(); });
      br.appendChild(el('div', { class: 'qrow' }, el('i', { style: 'font-style:normal;width:18px;height:18px;border-radius:5px;background:var(--navy);color:#fff;display:grid;place-items:center;font-size:11px' }, '?'), q, el('span', { class: 'x muted', style: 'cursor:pointer', onclick: () => { delete s.branch; touch({ redraw: true }); } }, '✕')));
      s.branch.options.forEach((o, i) => {
        const kind = el('select', null, [['if', 'אם'], ['then', 'אז']].map(([k, l]) => el('option', { value: k, selected: k === o.kind }, l))); kind.addEventListener('change', () => { o.kind = kind.value; touch(); });
        const l = el('input', { class: 'l', type: 'text', placeholder: 'תנאי', value: o.label }); l.addEventListener('input', () => { o.label = l.value; touch(); });
        const tx = el('input', { class: 'tx', type: 'text', placeholder: 'מה עושים', value: o.text }); tx.addEventListener('input', () => { o.text = tx.value; touch(); });
        br.appendChild(el('div', { class: 'orow' }, kind, l, tx, gotoSel(o), el('span', { class: 'x muted', style: 'cursor:pointer', onclick: () => { s.branch.options.splice(i, 1); touch({ redraw: true }); } }, '✕')));
      });
      br.appendChild(el('div', { class: 'addrow' }, el('span', { onclick: () => { s.branch.options.push({ kind: 'if', label: '', text: '' }); touch({ redraw: true }); } }, '+ אפשרות')));
      return br;
    }
    function moveStep(id, dir) { const p = phaseOf(id); const i = p.steps.findIndex((s) => s.id === id); const j = i + dir; if (j < 0 || j >= p.steps.length) return; const [s] = p.steps.splice(i, 1); p.steps.splice(j, 0, s); renumber(doc); touch({ redraw: true }); }
    function handleDrop(data, targetId, p, si) {
      if (!data) return;
      const [kind, val] = [data.slice(0, data.indexOf(':')), data.slice(data.indexOf(':') + 1)];
      if (kind === 'move') { if (val === targetId) return; const fp = phaseOf(val); const fi = fp.steps.findIndex((s) => s.id === val); const [s] = fp.steps.splice(fi, 1); const tp = targetId ? phaseOf(targetId) : doc.phases[doc.phases.length - 1]; const ti = targetId ? tp.steps.findIndex((x) => x.id === targetId) : tp.steps.length; tp.steps.splice(ti, 0, s); renumber(doc); touch({ redraw: true }); }
      else if (kind === 'basic') { if (val === 'step' || !targetId) { selected = targetId || selected; addBasic(val === 'step' ? 'step' : val, targetId); } else addBasic(val, targetId); }
      else if (kind === 'shared') addShared(val, targetId);
      else if (kind === 'preset') addAction(val, targetId || selected);
    }
    function dropzone() {
      const inp = el('input', { type: 'text', 'aria-label': 'פקודה מהירה' });
      const z = el('div', { class: 'z', ondragover: (e) => { if (e.dataTransfer.types.includes('text/kb')) { e.preventDefault(); z.classList.add('over'); } }, ondragleave: () => z.classList.remove('over'), ondrop: (e) => { e.preventDefault(); z.classList.remove('over'); const d = e.dataTransfer.getData('text/kb'); if (d.startsWith('move:')) { const val = d.slice(5); const fp = phaseOf(val); const [s] = fp.steps.splice(fp.steps.findIndex((x) => x.id === val), 1); doc.phases[doc.phases.length - 1].steps.push(s); renumber(doc); touch({ redraw: true }); } else handleDrop(d, null); } },
        el('span', null, 'שחרר בלוק כאן · או '), el('b', { onclick: () => { inp.focus(); inp.value = '/'; showSlash(); } }, '/'), el('span', null, ' לפקודה מהירה'), inp);
      let menu = null;
      const CMDS = [['✚ שלב חדש', () => addBasic('step')], ['? הסתעפות אם/אז', () => addBasic('branch')], ['✓ תוצאות', () => addBasic('outcomes')], ['“ תסריט שיחה', () => addBasic('script')], ['CRM שדה', () => addBasic('crm')], ['↗ קישור למסמך', () => addBasic('link')], ['⧉ ריענון SIM (בלוק משותף)', () => addShared('sim-refresh')], ['⧉ בדיקות במכשיר הלקוח (בלוק משותף)', () => addShared('device-checks')], ['▤ קבוצת שלבים חדשה', () => { doc.phases.push({ id: KB.uid('p'), label: 'קבוצה חדשה', steps: [] }); touch({ redraw: true }); }]];
      let idx = 0;
      function showSlash() {
        if (menu) menu.remove();
        const q = inp.value.replace(/^\//, '').trim().toLowerCase();
        const items = CMDS.filter(([l]) => !q || l.toLowerCase().includes(q));
        idx = Math.min(idx, Math.max(0, items.length - 1));
        menu = el('div', { class: 'slash' }, items.length ? items.map(([l, fn], i) => el('div', { class: i === idx ? 'on' : '', onmousedown: (e) => { e.preventDefault(); fn(); hide(); } }, l)) : el('div', { class: 'muted' }, 'אין פקודה תואמת'));
        z.appendChild(menu);
        menu._items = items;
      }
      function hide() { if (menu) { menu.remove(); menu = null; } inp.value = ''; inp.blur(); }
      inp.addEventListener('input', () => { if (inp.value.startsWith('/')) showSlash(); else if (menu) { menu.remove(); menu = null; } });
      inp.addEventListener('keydown', (e) => { if (!menu) { if (e.key === 'Enter' && inp.value.trim()) { e.preventDefault(); addBasic('step'); const s = KB.steps(doc).pop(); s.title = inp.value.trim(); inp.value = ''; touch({ redraw: true }); } return; } if (e.key === 'ArrowDown') { e.preventDefault(); idx = Math.min(menu._items.length - 1, idx + 1); showSlash(); } else if (e.key === 'ArrowUp') { e.preventDefault(); idx = Math.max(0, idx - 1); showSlash(); } else if (e.key === 'Enter') { e.preventDefault(); const it = menu._items[idx]; hide(); if (it) it[1](); } else if (e.key === 'Escape') { e.stopPropagation(); hide(); } });
      inp.addEventListener('blur', () => setTimeout(() => { if (menu) { menu.remove(); menu = null; } }, 150));
      return el('div', { class: 'dropzone' }, el('span', { class: 'n' }), z);
    }

    /* ── side: live preview / JSON / diff + checks ──────────────────────── */
    function drawSide() {
      side.innerHTML = '';
      side.appendChild(el('div', { class: 'tabs' }, [['preview', 'תצוגה חיה'], ['json', 'JSON'], ['diff', 'Diff']].map(([k, l]) => el('span', { class: k === sideTab ? 'on' : '', onclick: () => { sideTab = k; drawSide(); } }, l)), el('span', { class: 'hint' }, sideTab === 'preview' ? 'כמו שהנציג יראה' : sideTab === 'diff' ? (published ? 'מול v' + (published.version || 1) : 'מסמך חדש') : 'מבנה הנתונים'), el('span', { class: 'hamburger', style: 'cursor:pointer', onclick: () => side.classList.remove('mobile-open') }, '✕')));
      const b = el('div', { class: 'body' });
      if (sideTab === 'preview') b.appendChild(el('div', { class: 'preview' }, el('article', { class: 'doc' }, KB.renderDocHead(doc), KB.renderDocBody(doc, { expandAll: true }))));
      else if (sideTab === 'json') b.appendChild(el('pre', null, JSON.stringify(doc, null, 2)));
      else b.appendChild(KB.renderDiff(published || { phases: [] }, doc, { compact: true, docId: doc.id }));
      b.appendChild(checks());
      side.appendChild(b);
    }
    function checkList() {
      const out = [];
      const steps = KB.docSteps(doc);
      const crm = KB.docCrm(doc); const unknown = [];
      steps.forEach((s) => { (s.actions || []).forEach((a) => { const m = /(?:CRM|שדה)\s*[↗←]?\s*"([^"]+)"/.exec(a.text); if (m && !KB.CRM_FIELDS.some((f) => f.name === m[1])) unknown.push(m[1]); }); });
      const renamed = crm.filter((n) => (KB.CRM_FIELDS.find((f) => f.name === n) || {}).status === 'renamed');
      out.push(unknown.length ? ['bad', '! שדה לא מוכר ב-crm-fields.json: ' + unknown.join(', ')] : renamed.length ? ['warn', '! שדה ששונה שמו: ' + renamed.join(', ') + ' — עדכן לשם החדש'] : ['ok', '✓ כל שדות CRM קיימים ב-crm-fields.json']);
      const noOut = steps.filter((s) => !(s.outcomes || []).length && !s.branch);
      out.push(noOut.length ? ['warn', '! ' + noOut.length + ' שלבים ללא תוצאה (' + noOut.slice(0, 3).map((s) => s.num).join(', ') + ')'] : ['ok', '✓ אין שלבים ללא תוצאה']);
      const empty = steps.filter((s) => !(s.actions || []).some((a) => a.text.trim()) && !s.branch && !s.script && !s.block);
      out.push(empty.length ? ['warn', '! שלב ' + empty.map((s) => s.num).join(', ') + ' ריק — יסומן "מסמך חלקי"'] : ['ok', '✓ לכל שלב יש תוכן']);
      const rel = KB.relatedDocs(doc);
      out.push(rel.length ? ['ok', '✓ ' + rel.length + ' מסמכים קשורים זוהו אוטומטית'] : ['warn', '! אין מסמכים קשורים — נזהה אוטומטית לפי בלוקים ושדות']);
      if (!doc.title.trim()) out.unshift(['bad', '! חסרה כותרת']);
      if (!steps.length) out.unshift(['bad', '! אין שלבים במסמך']);
      return out;
    }
    function checks() { return el('div', { class: 'checks' }, el('div', { class: 'eyebrow' }, 'בדיקות לפני פרסום'), el('div', { class: 'rows' }, checkList().map(([k, t]) => el('span', { class: k }, t)))); }

    /* ── actions ────────────────────────────────────────────────────────── */
    function requestReview() { S.prefs.reviewRequests[draftId] = Date.now(); KB.save(); save(); drawSaved(); KB.toast('נשלחה בקשת סקירה למנהלי הצוות · המסמך מסומן "בסקירה"', 'ok'); }
    function publish() {
      const bad = checkList().filter((c) => c[0] === 'bad');
      if (bad.length) { KB.toast(bad[0][1], 'warn'); return; }
      const partial = checkList().some((c) => c[1].includes('ריק'));
      KB.prompt('פרסום v' + ((published ? published.version || 0 : 0) + 1), 'מה השתנה? (מופיע בהיסטוריית הגרסאות)', published ? '' : 'פריט ידע חדש', (label) => {
        const out = KB.clone(doc); out.status = partial ? 'partial' : 'published'; renumber(out);
        out.phases.forEach((p) => p.steps.forEach((s) => { if (s.actions) s.actions = s.actions.filter((a) => a.text.trim()); }));
        delete S.prefs.reviewRequests[draftId];
        KB.publish(out, label || 'פורסם');
        KB.toast('פורסם v' + out.version + ' · הכרטיס בספרייה עודכן', 'ok');
        nav.go('doc', out.id);
      });
    }
    function leave() { if (published) nav.go('doc', published.id); else nav.go('library'); }
    on('escape', () => { if ($$('.overlay').length) return; leave(); });
    on('docs', () => drawBlocks());

    drawBlocks(); drawBody(); drawSide(); drawSaved();
    if (isNew && !doc.title) setTimeout(() => titleIn.focus(), 50);
    return () => { clearInterval(savedTimer); subs.forEach((u) => u()); if (dirty) { S.drafts[draftId] = { doc, ts: Date.now() }; KB.saveNow(); } };
  };
})();
