/* wecom KB — recycle bin: auto-purge countdown, restore-to-source, what links break */
(function () {
  'use strict';
  const KB = window.KB; const { $, $$, el, esc } = KB; const S = KB.state(); const nav = KB.nav;
  KB.views = KB.views || {};

  KB.views.trash = function (root) {
    const sel = new Set();
    const subs = []; subs.push(KB.on('trash', () => draw()));
    root.appendChild(el('div', { class: 'topbar' }, KB.hamburger(), el('div', { class: 'crumb' }, el('a', { onclick: () => nav.go('library') }, 'ספרייה'), el('span', { class: 'sep' }, '/'), el('b', null, 'סל מיחזור'))));
    const body = el('div', { class: 'trash-body' });
    root.appendChild(el('div', { class: 'scroll-area' }, body));
    function draw() {
      body.innerHTML = '';
      const items = S.trash.slice().sort((a, b) => a.deletedAt - b.deletedAt);
      body.appendChild(el('div', { class: 'hd' }, el('h2', null, 'סל מיחזור ', el('span', null, items.length + ' פריטים · נמחקים סופית אחרי ' + KB.TRASH_DAYS + ' יום')),
        el('div', { class: 'btns' },
          sel.size ? el('button', { class: 'btn sm navy', onclick: () => { Array.from(sel).forEach((id) => KB.restoreTrash(id)); sel.clear(); KB.toast('שוחזרו פריטים', 'ok'); } }, 'שחזר ' + sel.size + ' נבחרים') : null,
          sel.size ? el('button', { class: 'btn sm danger', onclick: () => KB.confirm('מחיקה לצמיתות', sel.size + ' פריטים יימחקו לצמיתות. לא ניתן לבטל.', 'מחק לצמיתות', 'danger', () => { Array.from(sel).forEach((id) => KB.purgeTrashEntry(id)); sel.clear(); }) }, 'מחק לצמיתות') : null,
          el('button', { class: 'btn sm', disabled: !items.length, onclick: () => { items.forEach((e) => KB.restoreTrash(e.id)); KB.toast('כל הפריטים שוחזרו', 'ok'); } }, 'שחזר הכל'),
          el('button', { class: 'btn sm danger', disabled: !items.length, onclick: () => KB.confirm('ריקון סל המיחזור', 'כל ' + items.length + ' הפריטים יימחקו לצמיתות. לא ניתן לבטל.', 'רוקן סל', 'danger', () => { S.trash = []; KB.save(); KB.emit('trash'); }) }, 'רוקן סל'))));
      if (!items.length) { body.appendChild(el('div', { class: 'empty' }, el('b', null, 'סל המיחזור ריק'), 'פריטים שנמחקים נשמרים כאן ' + KB.TRASH_DAYS + ' יום לפני מחיקה סופית')); return; }
      body.appendChild(el('div', { class: 'trow head' }, el('span'), el('span', null, 'פריט'), el('span', null, 'נמחק על ידי'), el('span', null, 'מחיקה סופית'), el('span', null, 'השפעה')));
      items.forEach((e) => {
        const ageDays = (Date.now() - e.deletedAt) / 864e5; const left = Math.max(0, KB.TRASH_DAYS - ageDays); const pct = Math.min(100, Math.round((ageDays / KB.TRASH_DAYS) * 100));
        const urgent = left <= 3;
        const impact = e.kind === 'doc' && e.impact && e.impact.broken ? el('span', { class: 'chip chip-red', title: (e.impact.docs || []).map((id) => (KB.doc(id) || {}).title).filter(Boolean).join(' · ') }, e.impact.broken + ' קישורים שבורים')
          : e.kind === 'block' && e.impact && e.impact.broken ? el('span', { class: 'chip chip-red' }, e.impact.broken + ' מסמכים חסרים בלוק')
          : e.kind === 'category' ? el('span', { class: 'chip chip-gray' }, 'מיפוי נשמר') : el('span', { class: 'chip chip-green' }, 'ללא השפעה');
        body.appendChild(el('div', { class: 'trow' + (urgent ? ' urgent' : '') },
          el('span', { class: 'cb' + (sel.has(e.id) ? ' on' : ''), role: 'checkbox', 'aria-checked': sel.has(e.id), onclick: () => { if (sel.has(e.id)) sel.delete(e.id); else sel.add(e.id); draw(); } }, sel.has(e.id) ? '✓' : ''),
          el('div', null, el('div', { class: 't' }, (e.kind === 'topic' ? 'כרטיס: ' : e.kind === 'category' ? 'קטגוריה: ' : '') + e.title), el('div', { class: 'm', html: KB.fmt(e.meta || '', { noCrm: true }) })),
          el('div', { class: 'cd' }, e.deletedBy, el('div', { class: 'm' }, KB.ago(e.deletedAt))),
          el('div', null, el('div', { class: 'cd' + (urgent ? ' red' : '') }, left < 1 ? 'היום' : 'בעוד ' + Math.ceil(left) + ' ' + (Math.ceil(left) === 1 ? 'יום' : 'ימים')), el('div', { class: 'bar' }, el('i', { class: pct > 85 ? 'hot' : pct > 50 ? 'mid' : '', style: 'width:' + Math.max(3, pct) + '%' }))),
          el('div', { class: 'imp' }, impact, el('span', { class: 'restore', onclick: () => { const r = KB.restoreTrash(e.id); if (r) KB.toast('"' + esc(r.title) + '" שוחזר למקור' + (r.kind === 'doc' ? ' · הקישורים תוקנו' : ''), 'ok'); } }, 'שחזר'))));
      });
    }
    draw();
    return () => subs.forEach((u) => u());
  };
})();
