/* wecom KB — library view (multi-source shell, pinned & recent, wave/priority facets), CRM fields & blocks lists */
(function () {
  'use strict';
  const KB = window.KB; const { $, $$, el, esc } = KB; const S = KB.state(); const nav = KB.nav;
  KB.views = KB.views || {};

  const facetState = { wave: 'all', flag: null };

  KB.cardFor = function (t, opts) {
    opts = opts || {};
    const d = KB.docForTopic(t);
    const status = KB.docStatus(d);
    const pinned = d && KB.isPinned(d.id);
    const chips = [el('span', { class: 'chip chip-blue' }, KB.CATS[t.cat].short)];
    if (status === 'partial') chips.push(el('span', { class: 'chip chip-amber' }, 'מסמך חלקי'));
    else if (status === 'draft') chips.push(el('span', { class: 'chip chip-amber' }, 'טיוטה'));
    else chips.push(el('span', { class: 'chip ' + KB.PRI[t.pri].cls }, KB.PRI[t.pri].label));
    const meta = el('div', { class: 'meta' });
    if (d) {
      const steps = KB.stepCount(d), out = KB.docLinksOut(d).length, inn = KB.docLinksIn(d.id).length, views = S.views[d.id] || 0, crm = KB.docCrm(d), blocks = KB.steps(d).filter((s) => s.block).length;
      const bits = [steps + ' שלבים'];
      if (status === 'partial') { meta.classList.add('warn'); bits.push('חסרים שלבים · לבדיקה'); }
      else if (views) bits.push('נצפה ' + views + '×');
      else if (out) bits.push(out + ' קישורים יוצאים');
      else if (inn) bits.push('מקושר מ-' + inn);
      else if (blocks) bits.push('בלוק משותף ⧉');
      else if (crm.length) bits.push(crm.length + ' שדות CRM');
      bits.forEach((b, i) => { if (i) meta.appendChild(el('span', null, '·')); meta.appendChild(el('span', null, b)); });
      const avs = el('span', { class: 'avs' });
      if (crm.length) avs.appendChild(el('span', { class: 'mini-av', title: crm.join(', ') }, 'CRM'));
      avs.appendChild(el('span', { class: 'mini-av v', title: 'גרסה ' + (d.version || 1) }, 'v' + (d.version || 1)));
      meta.appendChild(avs);
    } else meta.appendChild(el('span', null, 'כרטיס ללא מסמך · לחץ לכתיבה'));
    const card = el('div', { class: 'tcard' + (status === 'partial' ? ' partial' : '') + (!d ? ' placeholder' : ''), tabindex: 0, role: 'button', 'data-doc': d ? d.id : null, 'data-nopeek': '',
      onclick: () => { if (d) nav.openDoc(d.id, null, { newTab: false }); else KB.openTopic(t.id); },
      onkeydown: (e) => { if (e.key === 'Enter') card.click(); } },
      d ? el('span', { class: 'star' + (pinned ? ' on' : ''), title: pinned ? 'בטל הצמדה' : 'הצמד', onclick: (e) => { e.stopPropagation(); const on = KB.togglePin(d.id); KB.toast(on ? '★ הוצמד' : 'הוסרה הצמדה'); } }, '★') : null,
      el('span', { class: 'kebab', title: 'פעולות', onclick: (e) => { e.stopPropagation(); KB.cardMenu(t, d, e.currentTarget); } }, '⋯'),
      el('div', { class: 'chips' }, chips),
      el('div', { class: 'title' }, t.title),
      el('div', { class: 'desc' }, t.desc || (d ? d.desc : '')),
      meta);
    return card;
  };
  KB.cardMenu = (t, d, anchor) => {
    const items = [];
    if (d) { items.push(['✏️ ערוך', () => nav.go('edit', d.id)], ['🕓 היסטוריית גרסאות', () => nav.go('history', d.id)], ['⧉ פתח בלשונית', () => nav.openDoc(d.id, null, { newTab: true })], [KB.isPinned(d.id) ? '☆ בטל הצמדה' : '★ הצמד', () => KB.togglePin(d.id)]); }
    else items.push(['✚ כתוב מסמך לכרטיס', () => KB.openTopic(t.id)]);
    items.push(['🗑 מחק', () => KB.confirm('מחיקת פריט ידע', '"' + esc(t.title) + '" יועבר לסל המיחזור ל-30 יום.' + (d && KB.docLinksIn(d.id).length ? '<br><b style="color:var(--red-dark)">' + KB.docLinksIn(d.id).length + ' מסמכים מקשרים אליו — הקישורים יישברו.</b>' : ''), 'העבר לסל', 'danger', () => { KB.deleteTopic(t.id); KB.toast('הועבר לסל המיחזור', 'ok', () => { const e = S.trash[0]; if (e) KB.restoreTrash(e.id); }); })]);
    const menu = el('div', { class: 'slash', style: 'position:fixed;width:220px' }, items.map(([l, fn]) => el('div', { onclick: () => { menu.remove(); fn(); } }, l)));
    const r = anchor.getBoundingClientRect(); menu.style.top = (r.bottom + 4) + 'px'; menu.style.left = Math.max(8, r.left - 180) + 'px';
    document.body.appendChild(menu);
    setTimeout(() => document.addEventListener('mousedown', function h(e) { if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener('mousedown', h); } }), 0);
  };
  KB.openTopic = (topicId) => {
    const t = KB.topic(topicId); if (!t) return;
    KB.modal({ title: t.title, body: '<p>' + esc(t.desc) + '</p><p class="small muted" style="margin-top:10px">📝 הכרטיס קיים בספרייה אבל המסמך עצמו טרם נכתב. אפשר לכתוב אותו עכשיו בעורך הבלוקים או לעבד פרק ממסמך מקור.</p>',
      buttons: [{ label: 'ממסמך מקור', onclick: () => nav.go('sources') }, { label: '✚ כתוב עכשיו', cls: 'primary', onclick: () => nav.go('edit', 'new', String(topicId)) }] });
  };

  /* Auto card: CRM fields changing this week */
  function autoCard() {
    const changed = KB.CRM_FIELDS.filter((f) => f.status !== 'ok');
    const top = KB.CRM_FIELDS.map((f) => ({ f, n: KB.fieldUsage(f.name).length })).filter((x) => x.n).sort((a, b) => b.n - a.n).slice(0, 2);
    const rows = el('div', { class: 'rows' });
    top.forEach(({ f, n }) => rows.appendChild(el('div', null, el('code', { onclick: () => KB.showField(f.name), style: 'cursor:pointer' }, f.name), el('span', null, 'ב-' + n + ' מסמכים'))));
    changed.slice(0, 2).forEach((f) => rows.appendChild(el('div', null, el('code', { class: 'hot', onclick: () => KB.showField(f.name), style: 'cursor:pointer' }, f.name), el('span', { class: 'hot' }, (f.status === 'renamed' ? 'שונה שם · בדוק ' + KB.fieldUsage(f.name).length : 'שדה חדש')))));
    return el('div', { class: 'tcard auto', onclick: () => nav.go('fields') }, el('div', { class: 'eyebrow' }, 'נוצר אוטומטית · מהנתונים'), el('div', { class: 'title' }, 'שדות CRM שמשתנים השבוע'), rows);
  }

  KB.views.library = function (root, r) {
    const mode = r.route; // library | pinned | recent | drafts
    const cat = mode === 'library' ? r.a : null;
    let topics = KB.topics();
    if (cat && KB.CATS[cat]) topics = topics.filter((t) => t.cat === cat);
    if (mode === 'pinned') topics = S.pins.map((id) => KB.topics().find((t) => t.docId === id)).filter(Boolean);
    if (mode === 'recent') topics = S.recent.map((id) => KB.topics().find((t) => t.docId === id)).filter(Boolean);
    if (mode === 'drafts') topics = KB.topics().filter((t) => (t.docId && S.drafts[t.docId]) || (t.docId && KB.docStatus(KB.doc(t.docId)) === 'draft'));
    const draftNew = mode === 'drafts' ? Object.keys(S.drafts).filter((id) => !KB.doc(id)) : [];
    const title = mode === 'pinned' ? 'מוצמדים' : mode === 'recent' ? 'נצפו לאחרונה' : mode === 'drafts' ? 'טיוטות' : cat ? KB.CATS[cat].label : 'ספריית ידע';
    const srcFile = cat === 'intl' ? 'intl-roaming.json' : 'topics.json';
    const lastUpd = topics.map((t) => KB.docForTopic(t)).filter(Boolean).map((d) => d.updated).sort().pop();

    root.appendChild(el('div', { class: 'topbar' }, KB.hamburger(),
      el('div', { class: 'crumb' }, el('a', { onclick: () => nav.go('library') }, 'ספרייה'), (cat || mode !== 'library') ? el('span', { class: 'sep' }, '/') : null, (cat || mode !== 'library') ? el('b', null, title) : null),
      el('div', { class: 'actions' },
        el('button', { class: 'btn', onclick: () => KB.pickFile('.json,.csv', (f) => KB.importFile(f)) }, 'ייבוא JSON / CSV'),
        el('button', { class: 'btn', onclick: KB.exportAll }, 'ייצוא'),
        el('button', { class: 'btn primary', onclick: () => nav.go('edit', 'new', cat || undefined) }, '✚ פריט ידע חדש'))));
    const body = el('div', { class: 'lib-body' });
    const scroll = el('div', { class: 'scroll-area' }, body);
    root.appendChild(scroll);

    const waves = new Set(topics.map((t) => t.wave)).size;
    const head = el('div', { class: 'lib-head' },
      el('div', null, el('h1', null, title, el('span', null, topics.length + ' נושאים' + (mode === 'library' ? ' · ' + waves + ' גלי כתיבה' : ''))),
        el('p', null, mode === 'library' ? 'מסודר לפי שכיחות פנייה · מקור: ' + srcFile + (lastUpd ? ' · עודכן ' + KB.fmtDate(lastUpd) : '') : mode === 'pinned' ? 'מסמכים שהצמדת · מקש P מתוך מסמך' : mode === 'recent' ? 'לפי סדר צפייה אחרון' : 'עריכות שלא פורסמו · נשמרות אוטומטית בדפדפן זה')),
      el('div', { class: 'facets' }));
    const facets = head.querySelector('.facets');
    const fac = (label, on, fn, dot) => el('span', { class: 'facet' + (on ? ' on' : ''), onclick: fn }, dot ? el('span', { class: 'dot' }) : null, label);
    facets.appendChild(fac('הכל', facetState.wave === 'all', () => { facetState.wave = 'all'; draw(); }));
    [1, 2, 3].forEach((w) => facets.appendChild(fac('גל ' + w, facetState.wave === w, () => { facetState.wave = facetState.wave === w ? 'all' : w; draw(); })));
    facets.appendChild(el('span', { class: 'vsep' }));
    facets.appendChild(fac('שכיח מאוד', facetState.flag === 'hh', () => { facetState.flag = facetState.flag === 'hh' ? null : 'hh'; draw(); }, true));
    facets.appendChild(fac('עודכן החודש', facetState.flag === 'month', () => { facetState.flag = facetState.flag === 'month' ? null : 'month'; draw(); }));
    facets.appendChild(fac('מסמך חלקי', facetState.flag === 'partial', () => { facetState.flag = facetState.flag === 'partial' ? null : 'partial'; draw(); }));
    body.appendChild(head);
    const grid = el('div', { class: 'grid' });
    body.appendChild(grid);

    function draw() {
      $$('.facet', facets).forEach((f, i) => { const labels = ['הכל', 'גל 1', 'גל 2', 'גל 3', 'שכיח מאוד', 'עודכן החודש', 'מסמך חלקי']; const l = labels[i]; f.classList.toggle('on', (l === 'הכל' && facetState.wave === 'all') || l === 'גל ' + facetState.wave || (l === 'שכיח מאוד' && facetState.flag === 'hh') || (l === 'עודכן החודש' && facetState.flag === 'month') || (l === 'מסמך חלקי' && facetState.flag === 'partial')); });
      let list = topics.slice();
      if (facetState.wave !== 'all') list = list.filter((t) => t.wave === facetState.wave);
      const monthAgo = Date.now() - 30 * 864e5;
      if (facetState.flag === 'hh') list = list.filter((t) => t.pri === 'hh');
      if (facetState.flag === 'month') list = list.filter((t) => { const d = KB.docForTopic(t); return d && Date.parse(d.updated) > monthAgo; });
      if (facetState.flag === 'partial') list = list.filter((t) => KB.docStatus(KB.docForTopic(t)) === 'partial' || !t.docId);
      grid.innerHTML = '';
      if (mode === 'drafts' && draftNew.length) {
        grid.appendChild(el('div', { class: 'rule' }, el('span', null, 'טיוטות חדשות · טרם פורסמו')));
        draftNew.forEach((id) => { const d = S.drafts[id].doc; grid.appendChild(el('div', { class: 'tcard partial', onclick: () => nav.go('edit', id) }, el('div', { class: 'chips' }, el('span', { class: 'chip chip-blue' }, KB.CATS[d.cat] ? KB.CATS[d.cat].short : ''), el('span', { class: 'chip chip-amber' }, 'טיוטה')), el('div', { class: 'title' }, d.title || 'פריט ידע ללא שם'), el('div', { class: 'desc' }, d.desc || ''), el('div', { class: 'meta warn' }, el('span', null, KB.stepCount(d) + ' שלבים · נשמר ' + KB.ago(S.drafts[id].ts))))); });
      }
      if (!list.length && !(mode === 'drafts' && draftNew.length)) { grid.appendChild(el('div', { class: 'empty', style: 'grid-column:1/-1' }, el('b', null, mode === 'pinned' ? 'אין מסמכים מוצמדים' : mode === 'recent' ? 'עוד לא נצפו מסמכים' : mode === 'drafts' ? 'אין טיוטות פתוחות' : 'אין נושאים תואמים'), mode === 'pinned' ? 'לחץ ★ על כרטיס או P מתוך מסמך' : mode === 'library' ? 'נסה לשנות את המסננים' : '')); return; }
      if (mode === 'library') {
        const pinned = list.filter((t) => t.docId && KB.isPinned(t.docId));
        const showAuto = !cat || cat === 'tech' || cat === 'intl';
        if (pinned.length || showAuto) {
          grid.appendChild(el('div', { class: 'rule' }, el('span', null, pinned.length ? 'מוצמדים · נצפו הרבה השבוע' : 'מהנתונים · השבוע')));
          pinned.forEach((t) => grid.appendChild(KB.cardFor(t)));
          if (showAuto) grid.appendChild(autoCard());
        }
        [1, 2, 3].forEach((w) => {
          const wt = list.filter((t) => t.wave === w && !(t.docId && KB.isPinned(t.docId)));
          if (!wt.length) return;
          grid.appendChild(el('div', { class: 'rule' }, el('span', null, KB.WAVES[w])));
          wt.forEach((t) => grid.appendChild(KB.cardFor(t)));
        });
      } else list.forEach((t) => grid.appendChild(KB.cardFor(t)));
    }
    draw();
  };

  /* ── CRM fields overview ──────────────────────────────────────────────── */
  KB.views.fields = function (root) {
    root.appendChild(el('div', { class: 'topbar' }, KB.hamburger(), el('div', { class: 'crumb' }, el('a', { onclick: () => nav.go('library') }, 'ספרייה'), el('span', { class: 'sep' }, '/'), el('b', null, 'שדות CRM')), el('div', { class: 'actions' }, el('span', { class: 'chip chip-gray' }, el('bdi', { class: 'lat', dir: 'ltr' }, 'crm-fields.json'), ' · ' + KB.CRM_FIELDS.length + ' שדות'))));
    const body = el('div', { class: 'lib-body' });
    root.appendChild(el('div', { class: 'scroll-area' }, body));
    body.appendChild(el('div', { class: 'lib-head' }, el('div', null, el('h1', null, 'שדות CRM', el('span', null, KB.CRM_FIELDS.filter((f) => f.status !== 'ok').length + ' שינויים השבוע')), el('p', null, 'כל שדה מזוהה אוטומטית בטקסט השלבים ומוצג כצ׳יפ עם כיוון קבוע. שדה ששונה שמו מסומן באדום עד שהמסמכים יעודכנו.'))));
    const grid = el('div', { class: 'grid' });
    const groups = [['שינויים לבדיקה', KB.CRM_FIELDS.filter((f) => f.status !== 'ok')], ['שדות פעילים', KB.CRM_FIELDS.filter((f) => f.status === 'ok')]];
    groups.forEach(([label, fs]) => { if (!fs.length) return; grid.appendChild(el('div', { class: 'rule' }, el('span', null, label))); fs.forEach((f) => { const used = KB.fieldUsage(f.name); grid.appendChild(el('div', { class: 'tcard', onclick: () => KB.showField(f.name) }, el('div', { class: 'chips' }, el('span', { class: 'chip ' + (f.status === 'renamed' ? 'chip-red' : f.status === 'new' ? 'chip-amber' : 'chip-green') }, f.status === 'renamed' ? 'שונה שם' : f.status === 'new' ? 'חדש' : 'תקין')), el('div', { class: 'title', html: KB.crmChip(f.name) + (f.renamedTo ? ' → ' + KB.crmChip(f.renamedTo) : '') }), el('div', { class: 'desc' }, f.path), el('div', { class: 'meta' }, el('span', null, 'ב-' + used.length + ' מסמכים'), el('span', null, '·'), el('span', null, 'עודכן ' + KB.fmtDate(f.updated))))); }); });
    body.appendChild(grid);
  };

  /* ── shared blocks overview ───────────────────────────────────────────── */
  KB.views.blocks = function (root) {
    root.appendChild(el('div', { class: 'topbar' }, KB.hamburger(), el('div', { class: 'crumb' }, el('a', { onclick: () => nav.go('library') }, 'ספרייה'), el('span', { class: 'sep' }, '/'), el('b', null, 'בלוקים משותפים')), el('div', { class: 'actions' }, el('button', { class: 'btn primary', onclick: () => KB.newBlock() }, '✚ בלוק חדש'))));
    const body = el('div', { class: 'lib-body' });
    root.appendChild(el('div', { class: 'scroll-area' }, body));
    body.appendChild(el('div', { class: 'lib-head' }, el('div', null, el('h1', null, 'בלוקים משותפים', el('span', null, KB.blocks().length + ' בלוקים')), el('p', null, 'שלב או תסריט שנכתב פעם אחת ומוטמע בכמה מסמכים. עריכה של הבלוק מתעדכנת בכולם.'))));
    const grid = el('div', { class: 'grid' });
    KB.blocks().forEach((b) => { const used = KB.blockUsage(b.id); grid.appendChild(el('div', { class: 'tcard', onclick: () => KB.showBlock(b.id) }, el('div', { class: 'chips' }, el('span', { class: 'blockbar' }, '⧉ ' + (b.kind === 'script' ? 'תסריט' : 'שלב')), el('span', { class: 'chip chip-gray' }, 'v' + (b.version || 1))), el('div', { class: 'title' }, b.title), el('div', { class: 'desc', html: b.kind === 'script' ? esc((b.script || '').slice(0, 110)) + '…' : (b.actions || []).map((a) => KB.fmt(a.text)).join(' ← ') }), el('div', { class: 'meta' }, el('span', null, (b.actions || []).length + ' פעולות'), el('span', null, '·'), el('span', null, 'ב-' + used.length + ' מסמכים')))); });
    body.appendChild(grid);
  };
  KB.newBlock = () => {
    KB.prompt('בלוק משותף חדש', 'שם הבלוק', '', (name) => { if (!name.trim()) return; const id = 'blk-' + name.trim().toLowerCase().replace(/[^\w֐-׿]+/g, '-').slice(0, 30) + '-' + Date.now().toString(36).slice(-3); S.blocks[id] = { id, title: name.trim(), kind: 'step', actions: [{ id: 'b1', text: '' }], outcomes: [{ kind: 'ok', text: '✓ הסתדר – סיום' }, { kind: 'next', text: '→ לא הסתדר – המשך' }], version: 1, updated: new Date().toISOString().slice(0, 10), author: KB.USER.name }; KB.save(); KB.emit('docs'); KB.editBlock(id); });
  };

  KB.sourceStatus = (id) => S.sourceStatus[id] || (KB.SOURCE_DOCS.find((d) => d.id === id) || {}).status || 'synced';
})();
