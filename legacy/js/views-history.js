/* wecom KB — version history: timeline + side-by-side step diff, restore any version, blame per block */
(function () {
  'use strict';
  const KB = window.KB; const { $, $$, el, esc } = KB; const S = KB.state(); const nav = KB.nav;
  KB.views = KB.views || {};

  const stepLines = (s) => {
    const r = KB.resolveStep(s); const lines = [];
    (r.actions || []).forEach((a) => lines.push('› ' + KB.stripFmt(a.text)));
    if (r.script) lines.push('“ ' + KB.stripFmt(r.script));
    if (r.branch) { lines.push('? ' + r.branch.q); r.branch.options.forEach((o) => lines.push('• ' + o.label + ': ' + KB.stripFmt(o.text))); }
    (r.outcomes || []).forEach((o) => lines.push(KB.stripFmt(o.text)));
    (r.stages || []).forEach((st) => { lines.push('▸ ' + st.label); (st.actions || []).forEach((a) => lines.push('› ' + KB.stripFmt(a))); if (st.script) lines.push('“ ' + KB.stripFmt(st.script)); });
    if (r.block) lines.unshift('⧉ בלוק משותף: ' + (r._block ? r._block.title : r.block));
    return lines;
  };
  const stepSig = (s) => KB.stripFmt(KB.resolveStep(s).title || '') + '\n' + stepLines(s).join('\n');

  /* rows aligned by step id: [{old, new, kind}] */
  KB.diffSteps = function (oldDoc, newDoc) {
    const O = KB.steps(oldDoc || { phases: [] }), N = KB.steps(newDoc || { phases: [] });
    const oldIdx = new Map(O.map((s, i) => [s.id, i]));
    const rows = []; let cursor = 0;
    N.forEach((n) => {
      const oi = oldIdx.has(n.id) ? oldIdx.get(n.id) : -1;
      if (oi >= 0) { while (cursor < oi) { const o = O[cursor++]; if (!N.some((x) => x.id === o.id)) rows.push({ old: o, new: null, kind: 'removed' }); } cursor = oi + 1; rows.push({ old: O[oi], new: n, kind: stepSig(O[oi]) === stepSig(n) ? 'same' : 'changed' }); }
      else rows.push({ old: null, new: n, kind: 'added' });
    });
    while (cursor < O.length) { const o = O[cursor++]; if (!N.some((x) => x.id === o.id)) rows.push({ old: o, new: null, kind: 'removed' }); }
    return rows;
  };
  /* blame: which version last touched each step of the current document */
  function blameMap(docId, upToV) {
    const vs = KB.versionsOf(docId).filter((v) => upToV == null || v.v <= upToV).sort((a, b) => a.v - b.v);
    const map = {};
    let prev = null;
    vs.forEach((v) => { const d = KB.docAtVersion(docId, v.v); if (!d) return; KB.steps(d).forEach((s) => { const sig = stepSig(s); const ps = prev ? KB.step(prev, s.id) : null; if (!ps) map[s.id] = { v: v.v, author: v.author, kind: 'added' }; else if (stepSig(ps) !== sig) map[s.id] = { v: v.v, author: v.author, kind: 'changed' }; }); prev = d; });
    return map;
  }
  KB.renderDiff = function (oldDoc, newDoc, opts) {
    opts = opts || {};
    const rows = KB.diffSteps(oldDoc, newDoc);
    const blame = opts.docId ? blameMap(opts.docId, opts.newV) : {};
    const left = el('div', { class: 'diff-col' }, el('div', { class: 'eyebrow' }, opts.leftLabel || ('v' + (oldDoc.version || 0) + (oldDoc.updated ? ' · ' + KB.fmtDate(oldDoc.updated) : ''))));
    const right = el('div', { class: 'diff-col' }, el('div', { class: 'eyebrow cur' }, opts.rightLabel || ('v' + (newDoc.version || '') + (newDoc.updated ? ' · ' + KB.fmtDate(newDoc.updated) : '') + ' · נוכחי')));
    if (!rows.length) { left.appendChild(el('div', { class: 'small muted' }, 'אין שלבים')); right.appendChild(el('div', { class: 'small muted' }, 'אין שלבים')); }
    rows.forEach((r) => {
      if (opts.compact && r.kind === 'same') return;
      const ol = r.old ? stepLines(r.old) : [], nl = r.new ? stepLines(r.new) : [];
      const n = Math.max(ol.length, nl.length); const la = [], lb = [];
      for (let i = 0; i < n; i++) { const d = KB.wordDiff(ol[i] || '', nl[i] || ''); la.push(ol[i] != null ? d.a : null); lb.push(nl[i] != null ? d.b : null); }
      const tdiff = KB.wordDiff(r.old ? KB.stripFmt(KB.resolveStep(r.old).title || '') : '', r.new ? KB.stripFmt(KB.resolveStep(r.new).title || '') : '');
      const bl = r.new && blame[r.new.id];
      const blameTxt = r.kind === 'added' ? 'נוסף' + (bl ? ' · ' + bl.author + ' v' + bl.v : '') : r.kind === 'changed' ? 'שונה' + (bl ? ' · ' + bl.author + ' v' + bl.v : '') : '';
      left.appendChild(r.old ? el('div', { class: 'dstep' + (r.kind === 'changed' ? ' chg' : r.kind === 'same' ? ' same' : '') }, el('span', { class: 'n' }, r.old.num), el('div', { class: 'b' }, el('div', { class: 't', html: r.kind === 'changed' ? tdiff.a : esc(KB.stripFmt(KB.resolveStep(r.old).title || '')) }), el('div', { class: 'l' }, la.filter((x) => x != null).map((h) => el('div', { html: h }))))) : el('div', { class: 'dstep gone' }, el('span', { class: 'n' }), el('div', { class: 'b' }, '— אין שלב ' + r.new.num + ' —')));
      right.appendChild(r.new ? el('div', { class: 'dstep' + (r.kind === 'changed' ? ' chg cur' : r.kind === 'added' ? ' new' : ' cur same') }, el('span', { class: 'n' }, r.new.num), el('div', { class: 'b' }, el('div', { class: 't', html: (r.kind === 'changed' ? tdiff.b : esc(KB.stripFmt(KB.resolveStep(r.new).title || ''))) + (blameTxt ? '<span class="blame">' + esc(blameTxt) + (r.new.block ? ' ⧉' : '') + '</span>' : '') }), el('div', { class: 'l' }, lb.filter((x) => x != null).map((h) => el('div', { html: h }))))) : el('div', { class: 'dstep gone' }, el('span', { class: 'n' }), el('div', { class: 'b' }, '— שלב ' + r.old.num + ' הוסר —')));
    });
    if (opts.compact && !rows.some((r) => r.kind !== 'same')) { left.appendChild(el('div', { class: 'small muted' }, 'אין שינויים')); right.appendChild(el('div', { class: 'small muted' }, 'זהה לגרסה שפורסמה')); }
    const wrap = el('div', { class: 'diff-cols' }, left, right);
    wrap._stats = { changed: rows.filter((r) => r.kind === 'changed').length, added: rows.filter((r) => r.kind === 'added').length, removed: rows.filter((r) => r.kind === 'removed').length };
    return wrap;
  };

  KB.views.history = function (root, r) {
    const docId = r.a;
    if (!docId) { // picker
      root.appendChild(el('div', { class: 'topbar' }, KB.hamburger(), el('div', { class: 'crumb' }, el('a', { onclick: () => nav.go('library') }, 'ספרייה'), el('span', { class: 'sep' }, '/'), el('b', null, 'היסטוריית גרסאות'))));
      const body = el('div', { class: 'lib-body' }); root.appendChild(el('div', { class: 'scroll-area' }, body));
      body.appendChild(el('div', { class: 'lib-head' }, el('div', null, el('h1', null, 'היסטוריית גרסאות'), el('p', null, 'בחר מסמך כדי להשוות גרסאות, לראות מי שינה כל בלוק ולשחזר'))));
      const grid = el('div', { class: 'grid' });
      KB.docs().map((d) => ({ d, vs: KB.versionsOf(d.id) })).sort((a, b) => b.vs.length - a.vs.length || Date.parse(b.d.updated) - Date.parse(a.d.updated)).forEach(({ d, vs }) => grid.appendChild(el('div', { class: 'tcard', onclick: () => nav.go('history', d.id) }, el('div', { class: 'chips' }, el('span', { class: 'chip chip-blue' }, KB.CATS[d.cat].short), el('span', { class: 'chip chip-gray' }, 'v' + (d.version || 1))), el('div', { class: 'title' }, d.title), el('div', { class: 'meta' }, el('span', null, vs.length + ' גרסאות שמורות'), el('span', null, '·'), el('span', null, (d.author || '') + ' · ' + KB.fmtDate(d.updated))))));
      body.appendChild(grid);
      return;
    }
    const doc = KB.doc(docId);
    if (!doc) { root.appendChild(el('div', { class: 'empty' }, el('b', null, 'המסמך לא נמצא'))); return; }
    let filter = 'all';
    const vs = () => KB.versionsOf(docId).slice().sort((a, b) => b.v - a.v);
    const curV = () => (vs()[0] || { v: doc.version || 1 }).v;
    let cmpV = r.b ? parseInt(r.b) : null;
    if (cmpV == null || !vs().some((v) => v.v === cmpV) || cmpV === curV()) { const older = vs().filter((v) => v.v < curV()); cmpV = older.length ? older[0].v : null; }
    const side = el('aside', { class: 'hist-side' });
    const main = el('div', { class: 'hist-main' });
    root.appendChild(el('div', { class: 'hist-layout' }, side, main));
    const subs = []; subs.push(KB.on('docs', () => { const d = KB.doc(docId); if (d) Object.assign(doc, d); draw(); }));
    function draw() {
      side.innerHTML = ''; main.innerHTML = '';
      side.appendChild(el('div', { class: 'hd' }, el('b', null, 'היסטוריית גרסאות'), el('span', null, doc.title)));
      side.appendChild(el('div', { class: 'filters' }, [['all', 'הכל'], ['published', 'פורסם'], ['mine', 'שלי']].map(([k, l]) => el('span', { class: 'facet' + (filter === k ? ' on' : ''), style: 'padding:3px 9px;font-size:11px', onclick: () => { filter = k; draw(); } }, l))));
      const list = el('div', { class: 'vlist' });
      const all = vs();
      const shown = all.filter((v) => filter === 'all' || (filter === 'published' && v.kind === 'published') || (filter === 'mine' && v.author === KB.USER.name));
      if (!shown.length) list.appendChild(el('div', { class: 'small muted', style: 'padding:10px' }, 'אין גרסאות תואמות'));
      shown.forEach((v) => {
        const isCur = v.v === curV(), isCmp = v.v === cmpV;
        let stats = null;
        if (!isCur) { const prev = all.find((x) => x.v < v.v); if (prev) { const rows = KB.diffSteps(KB.docAtVersion(docId, prev.v), KB.docAtVersion(docId, v.v)); const a = rows.filter((x) => x.kind === 'added').length, c = rows.filter((x) => x.kind === 'changed').length, rm = rows.filter((x) => x.kind === 'removed').length; stats = [a ? '+' + a + ' שלבים' : null, c ? '~' + c + ' שונו' : null, rm ? '−' + rm : null].filter(Boolean); } }
        else { const prev = all.find((x) => x.v < v.v); if (prev) { const rows = KB.diffSteps(KB.docAtVersion(docId, prev.v), doc); const a = rows.filter((x) => x.kind === 'added').length, c = rows.filter((x) => x.kind === 'changed').length, rm = rows.filter((x) => x.kind === 'removed').length; stats = [a ? '+' + a + ' שלבים' : null, c ? '~' + c + ' שונו' : null, rm ? '−' + rm : null].filter(Boolean); } }
        list.appendChild(el('div', { class: 'vi' + (isCur ? ' cur' : isCmp ? ' cmp' : ''), onclick: () => { if (!isCur) { cmpV = v.v; nav.go('history', docId, String(v.v), { replace: true }); draw(); } }, title: isCur ? 'הגרסה הנוכחית' : 'לחץ להשוואה מול הגרסה הנוכחית' },
          el('span', { class: 'd' }), el('div', { class: 'b' }, el('div', { class: 't' }, 'v' + v.v + (isCur ? ' · נוכחי' : isCmp ? ' · בהשוואה' : '') + (v.kind === 'system' ? ' · ' + v.label : '')), el('div', { class: 'm' }, v.author + ' · ' + KB.fmtDate(v.ts)), v.label && v.kind !== 'system' ? el('div', { class: 'l' }, v.label) : null, stats && stats.length ? el('div', { class: 's' }, stats.map((s) => el('span', { class: s.startsWith('+') ? 'add' : s.startsWith('−') ? 'rem' : '' }, s))) : null)));
      });
      side.appendChild(list);
      // main
      const oldDoc = cmpV != null ? KB.docAtVersion(docId, cmpV) : null;
      const diff = oldDoc ? KB.renderDiff(oldDoc, doc, { docId, leftLabel: 'v' + cmpV + ' · ' + KB.fmtDate((all.find((v) => v.v === cmpV) || {}).ts || oldDoc.updated), rightLabel: 'v' + curV() + ' · ' + KB.fmtDate(doc.updated) + ' · נוכחי' }) : null;
      const st = diff ? diff._stats : { changed: 0, added: 0, removed: 0 };
      main.appendChild(el('div', { class: 'topbar' }, KB.hamburger(), el('button', { class: 'btn ghost sm', onclick: () => nav.go('doc', docId) }, '→ למסמך'),
        cmpV != null ? el('span', { class: 'vtag' }, 'v' + cmpV) : el('span', { class: 'muted' }, 'אין גרסה קודמת להשוואה'), cmpV != null ? el('span', { class: 'muted' }, '←→') : null, el('span', { class: 'vtag cur' }, 'v' + curV() + ' נוכחי'),
        cmpV != null ? el('span', { class: 'muted', style: 'margin-inline-start:12px;white-space:nowrap' }, [st.changed ? st.changed + ' שונו' : null, st.added ? st.added + ' נוסף' : null, st.removed ? st.removed + ' הוסר' : null].filter(Boolean).join(' · ') || 'ללא שינויים בשלבים') : null,
        el('div', { class: 'actions' }, el('button', { class: 'btn sm', onclick: () => KB.modal({ title: 'JSON · v' + (cmpV != null ? cmpV : curV()), wide: true, body: el('pre', null, JSON.stringify(oldDoc || doc, null, 2)), buttons: [{ label: 'הורד', onclick: () => KB.download(doc.id + '-v' + (cmpV != null ? cmpV : curV()) + '.json', JSON.stringify(oldDoc || doc, null, 2)) }, { label: 'סגור' }] }) }, 'הצג JSON'),
          cmpV != null ? el('button', { class: 'btn navy sm', onclick: () => KB.confirm('שחזור ל-v' + cmpV, 'המסמך יחזור למצב של גרסה v' + cmpV + '. השחזור נשמר כגרסה חדשה (v' + (curV() + 1) + '), כך שאפשר לבטל גם אותו.', 'שחזר ל-v' + cmpV, 'navy', () => { KB.restoreVersion(docId, cmpV); KB.toast('שוחזר ל-v' + cmpV + ' כגרסה v' + KB.doc(docId).version, 'ok'); }) }, 'שחזר ל-v' + cmpV) : null)));
      if (diff) main.appendChild(diff); else main.appendChild(el('div', { class: 'empty' }, el('b', null, 'זו הגרסה הראשונה של המסמך'), 'פרסום מהעורך יוסיף גרסאות להשוואה'));
    }
    draw();
    return () => subs.forEach((u) => u());
  };
})();
