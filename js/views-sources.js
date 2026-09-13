/* wecom KB — source-document workflow: edit the Word file only; a local rule engine reads
   the tracked changes and proposes card changes for review (accept / reject live) */
(function () {
  'use strict';
  const KB = window.KB; const { $, $$, el, esc } = KB; const S = KB.state(); const nav = KB.nav;
  KB.views = KB.views || {};

  const allSources = () => KB.SOURCE_DOCS.concat((S.userSources || []));
  const decisions = (id) => (S.sourceDecisions[id] = S.sourceDecisions[id] || {});

  /* rule engine for user-linked text files: numbered paragraphs → new-card suggestions */
  KB.analyzeSourceText = function (title, text) {
    const paras = text.split(/\n\s*\n|\r?\n(?=\s*\d+(?:\.\d+)*\s)/).map((p) => p.trim()).filter((p) => p.length > 20);
    const paragraphs = [], suggestions = [];
    paras.slice(0, 40).forEach((p, i) => {
      const m = /^(\d+(?:\.\d+)*)\.?\s+([^.:\n]{3,80})[.:]?\s*/.exec(p);
      const ref = m ? m[1] : String(i + 1); const head = m ? m[2].trim() : p.slice(0, 40);
      const rest = m ? p.slice(m[0].length) : p;
      paragraphs.push({ ref, title: head + '.', isNew: true, runs: [{ t: rest, add: true }] });
      const sentences = rest.split(/(?<=[.!?])\s+|\s*·\s*|\s*→\s*/).map((s) => s.trim()).filter((s) => s.length > 3).slice(0, 8);
      const crm = KB.crmIn(rest);
      const existing = KB.docs().find((d) => d.title.toLowerCase().includes(head.toLowerCase().slice(0, 12)));
      const steps = sentences.length ? sentences.map((s, j) => ({ id: 's' + (j + 1), num: String(j + 1), title: s.length > 48 ? s.slice(0, 45) + '…' : s, actions: [{ id: 'a1', text: s }], outcomes: j === sentences.length - 1 ? [{ kind: 'ok', text: '✓ הסתדר – סיום' }] : [{ kind: 'next', text: '→ המשך לשלב ' + (j + 2), goto: 's' + (j + 2) }], source: '§' + ref })) : [{ id: 's1', num: '1', title: head, actions: [{ id: 'a1', text: rest }], outcomes: [{ kind: 'ok', text: '✓ סיום' }], source: '§' + ref }];
      const doc = { id: 'src-' + Date.now().toString(36) + '-' + i, title: head, desc: rest.slice(0, 90), cat: /חו"ל|נדידה|roaming/i.test(p) ? 'intl' : /חיוב|חשבונית/.test(p) ? 'billing' : /שימור|נטישה/.test(p) ? 'ops' : 'tech', wave: 2, pri: 'm', src: 'topics', kind: 'steps', status: 'published', sourceDoc: { id: null, ref: '§' + ref }, phases: [{ id: 'p1', label: 'שלבי הטיפול', steps }] };
      suggestions.push({ id: 'u' + i, tag: existing ? 'עדכון אפשרי' : 'כרטיס חדש', tone: existing ? 'amber' : 'green', title: head, conf: Math.min(0.95, 0.55 + Math.min(0.35, sentences.length * 0.06)).toFixed(2),
        why: 'פסקה ' + ref + ' עם ' + sentences.length + ' משפטי פעולה' + (crm.length ? ' · שדות CRM: ' + crm.join(', ') : '') + (existing ? ' · דומה לכרטיס קיים "' + existing.title + '"' : ''),
        diff: 'כרטיס: ' + KB.CATS[doc.cat].label + ' · גל 2 · ' + steps.length + ' שלבים' + (crm.length ? ' · ' + crm.length + ' שדות CRM' : ' · שדה CRM: אין'), anchor: '§' + ref, target: existing ? 'ליד "' + existing.title + '"' : 'כרטיס חדש',
        apply: { type: 'new-doc', doc } });
    });
    return { paragraphs, suggestions };
  };

  function applySuggestion(sug, src) {
    const a = sug.apply; if (!a) return;
    const edited = sug._edited;
    if (a.type === 'update-step') {
      const doc = KB.clone(KB.doc(a.docId)); if (!doc) return;
      const st = KB.step(doc, a.stepId); if (!st) return;
      const target = doc.phases.flatMap((p) => p.steps).find((s) => s.id === a.stepId);
      if (a.addActions) { target.actions = target.actions || []; a.addActions.forEach((t, i) => target.actions.push({ id: KB.uid('a'), text: edited && i === 0 ? edited : t })); }
      if (a.branch) target.branch = KB.clone(a.branch);
      if (a.patch) Object.assign(target, KB.clone(a.patch));
      KB.publish(doc, 'ממסמך מקור · ' + src.title + ' ' + sug.anchor + ' · ' + sug.title);
    } else if (a.type === 'new-doc') {
      const doc = KB.clone(a.doc); if (edited) doc.title = edited;
      if (KB.doc(doc.id)) doc.id = doc.id + '-' + Date.now().toString(36).slice(-3);
      if (!doc.sourceDoc || !doc.sourceDoc.id) doc.sourceDoc = { id: src.id, ref: sug.anchor };
      KB.publish(doc, 'נוצר ממסמך מקור · ' + src.title + ' ' + sug.anchor);
    } else if (a.type === 'update-block') {
      const b = KB.clone(KB.block(a.blockId)); if (!b) return;
      b.actions = KB.clone(a.actions); if (edited) b.actions[b.actions.length - 1].text = edited;
      b.version = (b.version || 1) + 1; b.updated = new Date().toISOString().slice(0, 10); b.author = KB.USER.name;
      S.blocks[a.blockId] = b;
    }
  }

  KB.views.sources = function (root, r) {
    const srcs = allSources();
    let cur = srcs.find((s) => s.id === r.a) || srcs.find((s) => KB.sourceStatus(s.id) === 'pending') || srcs[0];
    let viewChanges = true, panelMobile = false, sideMobile = false;
    const subs = []; subs.push(KB.on('sources', () => draw()));
    const side = el('aside', { class: 'src-side' }), main = el('div', { class: 'src-main' }), panel = el('aside', { class: 'src-panel' });
    root.appendChild(el('div', { class: 'src-layout' }, side, main, panel));

    const pendingCount = (s) => (s.suggestions || []).filter((g) => (decisions(s.id)[g.id] || 'pending') === 'pending').length;
    const applied = (s) => KB.sourceStatus(s.id) === 'synced' && S.sourceApplied && S.sourceApplied[s.id];

    function draw() {
      // sidebar
      side.innerHTML = ''; side.classList.toggle('mobile-open', sideMobile);
      side.appendChild(el('div', { class: 'logo', onclick: () => nav.go('library'), style: 'cursor:pointer' }, 'wecom.'));
      side.appendChild(el('div', { class: 'sec-title' }, 'מסמכי מקור'));
      const list = el('div', { class: 'docs' });
      allSources().forEach((s) => { const st = KB.sourceStatus(s.id); const p = st === 'pending' ? pendingCount(s) : 0; list.appendChild(el('div', { class: 'sdoc' + (cur && s.id === cur.id ? ' on' : ''), onclick: () => { cur = s; sideMobile = false; nav.go('sources', s.id, undefined, { replace: true }); draw(); } }, el('span', { class: 'r' }, el('span', null, s.title), el('span', { class: 'ext' }, s.ext)), el('span', { class: 'st' + (p ? ' warn' : '') }, p ? p + ' שינויים לא מעובדים' : 'מסונכרן · ' + (s.fields ? s.linkedCards + ' שדות' : s.linkedCards + ' כרטיסים')))); });
      list.appendChild(el('div', { class: 'src-add', style: 'text-align:center;justify-content:center', onclick: linkSource }, '+ קשר מסמך / תיקייה'));
      side.appendChild(list);
      side.appendChild(el('div', { class: 'model' }, el('div', { class: 'on' }, el('i'), 'מנוע כללים מקומי · פעיל'), el('div', { class: 'dim' }, 'עיבוד בדפדפן זה בלבד · לא נשלח לענן'), el('div', { class: 'dim' }, el('span', null, 'סריקה אחרונה'), el('bdi', { class: 'lat', dir: 'ltr' }, S.lastScan ? KB.fmtTime(S.lastScan) : '14:02'))));
      // main
      main.innerHTML = '';
      if (!cur) { main.appendChild(el('div', { class: 'empty' }, 'אין מסמכי מקור')); return; }
      const st = KB.sourceStatus(cur.id); const pend = st === 'pending' ? pendingCount(cur) : 0;
      main.appendChild(el('div', { class: 'topbar h56' }, KB.hamburger(), el('button', { class: 'btn ghost sm hamburger', onclick: () => { sideMobile = true; draw(); } }, '📄'),
        el('span', { style: 'font-size:13.5px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0' }, cur.title), el('bdi', { class: 'lat', dir: 'ltr', style: 'font-size:11px;color:var(--muted);white-space:nowrap' }, 'v' + cur.version + ' · ' + cur.time),
        pend ? el('span', { class: 'chip chip-amber' }, pend + ' שינויים מסומנים') : el('span', { class: 'chip chip-green' }, 'מסונכרן'),
        el('div', { class: 'actions' }, el('button', { class: 'btn sm hamburger', onclick: () => { panelMobile = true; draw(); } }, 'הצעות'), el('button', { class: 'btn sm', onclick: () => KB.toast('הקובץ נפתח בעורך המקור (Word) · שינויים במעקב יזוהו בסריקה הבאה') }, 'פתח ב-' + (cur.ext === '.xlsx' ? 'Excel' : 'Word')), el('button', { class: 'btn navy sm', onclick: rescan }, '⟳ עבד שינויים'))));
      main.appendChild(el('div', { class: 'viewbar' }, el('span', null, 'מציג:'), el('span', { class: 'facet' + (viewChanges ? ' on' : ''), style: 'padding:3px 9px;font-size:11.5px', onclick: () => { viewChanges = true; draw(); } }, 'שינויים בלבד'), el('span', { class: 'facet' + (!viewChanges ? ' on' : ''), style: 'padding:3px 9px;font-size:11.5px', onclick: () => { viewChanges = false; draw(); } }, 'כל המסמך'),
        el('span', { class: 'legend' }, el('span', null, el('i', { style: 'background:var(--ok-mark)' }), 'נוסף'), el('span', null, el('i', { style: 'background:var(--del-mark)' }), 'נמחק'), el('span', null, el('i', { style: 'background:var(--warn-mark)' }), 'שונה'))));
      const page = el('div', { class: 'src-page' }, el('div', { class: 'ph' }, el('span', null, cur.chapter || ''), el('span', null, cur.pages || '')));
      const isApplied = applied(cur);
      (cur.paragraphs || []).forEach((p) => {
        const changed = !p.unchanged && !isApplied;
        if (viewChanges && !changed) return;
        const para = el('div', { class: 'para' + (p.isNew && !isApplied ? ' new' : '') });
        if (p.isNew && !isApplied) para.appendChild(el('span', { class: 'tagn' }, 'פסקה חדשה'));
        para.appendChild(el('b', { class: 'h' }, p.ref + ' ' + p.title + ' '));
        p.runs.forEach((run) => {
          if (isApplied && run.del) return;
          const cls = isApplied ? '' : run.del ? 'r-del' : run.add ? 'r-add' : run.chg ? 'r-chg' : '';
          const node = run.code ? el('bdi', { class: 'lat', dir: 'ltr', style: 'background:var(--surface-3);padding:1px 6px;border-radius:4px' }, run.t) : el('span', { class: cls, html: KB.fmt(run.t, { noCrm: true }) });
          para.appendChild(node);
        });
        page.appendChild(para);
      });
      if (!page.querySelector('.para')) page.appendChild(el('div', { class: 'small muted' }, viewChanges ? 'אין שינויים מסומנים במסמך זה · עבור ל"כל המסמך"' : 'אין פסקאות'));
      page.appendChild(el('div', { class: 'foot' }, el('span', null, '👤 ' + cur.editor + ' · ' + (cur.edits || 0) + ' עריכות · היום ' + cur.time), el('span', null, '· מקושר ל-' + cur.linkedCards + (cur.fields ? ' שדות' : ' כרטיסים'))));
      main.appendChild(el('div', { class: 'src-page-wrap' }, page));
      drawPanel();
    }
    function drawPanel() {
      panel.innerHTML = ''; panel.classList.toggle('mobile-open', panelMobile);
      const sugs = (cur && cur.suggestions) || []; const dec = decisions(cur.id);
      const st = KB.sourceStatus(cur.id);
      const pending = st === 'pending' ? sugs.filter((g) => (dec[g.id] || 'pending') === 'pending').length : 0;
      const accepted = st === 'pending' ? sugs.filter((g) => dec[g.id] === 'accepted').length : 0;
      panel.appendChild(el('div', { class: 'hd' }, el('b', null, 'הצעות לכרטיסים'), el('span', null, st === 'pending' ? pending + ' ממתינות · מהסריקה ' + (S.lastScan ? KB.fmtTime(S.lastScan) : '14:02') : 'אין שינויים ממתינים'), st === 'pending' && pending ? el('span', { class: 'all', onclick: () => { sugs.forEach((g) => { dec[g.id] = 'accepted'; }); KB.save(); drawPanel(); } }, 'אשר הכל') : null, panelMobile ? el('span', { style: 'cursor:pointer', onclick: () => { panelMobile = false; drawPanel(); } }, '✕') : null));
      const body = el('div', { class: 'body' });
      if (st !== 'pending' || !sugs.length) body.appendChild(el('div', { class: 'empty' }, el('b', null, 'המסמך מסונכרן'), 'כשיסומנו שינויים במעקב (Track Changes) הם יופיעו כאן כהצעות'));
      sugs.forEach((g) => {
        if (st !== 'pending') return;
        const s = dec[g.id] || 'pending';
        const card = el('div', { class: 'sug' + (s === 'accepted' ? ' acc' : s === 'rejected' ? ' rej' : '') });
        card.appendChild(el('div', { class: 'hd' }, el('span', { class: 'tag ' + g.tone }, g.tag), el('span', { class: 't' }, g._edited && g.apply.type === 'new-doc' ? g._edited : g.title), el('span', { class: 'conf' }, typeof g.conf === 'number' ? g.conf.toFixed(2) : g.conf)));
        card.appendChild(el('div', { class: 'why' }, g.why));
        if (s === 'pending') {
          const diffBox = el('div', { class: 'diff', html: KB.fmt(g._edited ? g.diff + ' · <b>נערך:</b> ' + esc(g._edited) : g.diff, { noCrm: true }) });
          card.appendChild(diffBox);
          const bt = el('span', { class: 'bt' },
            el('span', { onclick: () => { dec[g.id] = 'rejected'; KB.save(); drawPanel(); } }, 'דחה'),
            el('span', { onclick: () => { const ta = el('textarea', { rows: 3 }); ta.value = g._edited || (g.apply.type === 'new-doc' ? g.apply.doc.title : g.apply.type === 'update-block' ? g.apply.actions[g.apply.actions.length - 1].text : (g.apply.addActions || [''])[0]); diffBox.innerHTML = ''; diffBox.appendChild(el('div', { class: 'small muted', style: 'margin-bottom:4px' }, g.apply.type === 'new-doc' ? 'שם הכרטיס החדש' : 'הטקסט שייכנס לשלב / לבלוק')); diffBox.appendChild(ta); diffBox.appendChild(el('div', { style: 'display:flex;gap:6px;justify-content:flex-end;margin-top:6px' }, el('button', { class: 'btn xs', onclick: () => drawPanel() }, 'ביטול'), el('button', { class: 'btn xs primary', onclick: () => { g._edited = ta.value.trim(); drawPanel(); } }, 'שמור עריכה'))); ta.focus(); } }, 'ערוך'),
            el('span', { class: 'p', onclick: () => { dec[g.id] = 'accepted'; KB.save(); drawPanel(); } }, 'אשר'));
          card.appendChild(el('div', { class: 'ft' }, el('span', null, 'מקור: ' + g.anchor), el('span', null, '· יעד: ' + g.target), bt));
        } else {
          card.appendChild(el('div', { class: 'status', style: 'color:' + (s === 'accepted' ? 'var(--ok)' : 'var(--muted)') }, el('span', null, s === 'accepted' ? '✓ אושר — יעודכן בפרסום' : '✕ נדחה — המנוע ילמד מזה'), el('span', { class: 'undo', onclick: () => { dec[g.id] = 'pending'; KB.save(); drawPanel(); } }, 'בטל')));
        }
        body.appendChild(card);
      });
      body.appendChild(el('div', { class: 'sug-info', html: '<b>מה המנוע בודק</b> · שינוי סף/ערכים → עדכון שלב · פסקה חדשה → כרטיס חדש או שלב · טקסט זהה ב-2+ פרקים → בלוק משותף · שדה CRM לא מוכר → התראה · פסקה שנמחקה → הוצאה משימוש' }));
      panel.appendChild(body);
      panel.appendChild(el('div', { class: 'foot' }, el('span', null, accepted + ' מאושרות'), el('button', { class: 'btn sm primary', disabled: !accepted, onclick: publishAccepted }, 'פרסם לספרייה')));
    }
    function rescan() {
      S.lastScan = Date.now();
      if (cur.suggestions && cur.suggestions.length) { const dec = decisions(cur.id); cur.suggestions.forEach((g) => { if (dec[g.id] === 'rejected') delete dec[g.id]; }); S.sourceStatus[cur.id] = applied(cur) ? 'synced' : 'pending'; }
      KB.save(); KB.emit('sources');
      KB.toast(cur.suggestions && cur.suggestions.length && !applied(cur) ? 'נסרקו ' + (cur.paragraphs || []).filter((p) => !p.unchanged).length + ' פסקאות מסומנות · ' + cur.suggestions.length + ' הצעות' : 'אין שינויים במעקב במסמך זה', 'ok');
      draw();
    }
    function publishAccepted() {
      const dec = decisions(cur.id);
      const acc = (cur.suggestions || []).filter((g) => dec[g.id] === 'accepted');
      if (!acc.length) return;
      const names = acc.map((g) => g.title);
      KB.confirm('פרסום לספרייה', acc.length + ' הצעות יוחלו על הספרייה ויירשמו כגרסאות חדשות:<br>• ' + names.map(esc).join('<br>• '), 'פרסם', 'primary', () => {
        acc.forEach((g) => applySuggestion(g, cur));
        S.sourceStatus[cur.id] = 'synced'; (S.sourceApplied = S.sourceApplied || {})[cur.id] = true; S.sourceDecisions[cur.id] = {};
        if (cur.fields) KB.CRM_FIELDS.forEach((f) => { if (f.status !== 'ok') f.status = 'ok'; });
        KB.save(); KB.emit('docs'); KB.emit('sources');
        KB.toast('פורסמו ' + acc.length + ' שינויים · הכרטיסים והבלוקים עודכנו', 'ok');
        draw();
      });
    }
    function linkSource() {
      KB.pickFile('.txt,.md,.docx,.json', (f) => {
        if (/\.docx$/i.test(f.name)) { KB.toast('קובצי Word נקראים דרך תיקיית הסנכרון בלבד · לניסיון מיידי קשר קובץ .txt / .md', 'warn'); return; }
        const rd = new FileReader();
        rd.onload = () => {
          const { paragraphs, suggestions } = KB.analyzeSourceText(f.name, String(rd.result));
          const id = 'usrc-' + Date.now().toString(36);
          const src = { id, title: f.name.replace(/\.[^.]+$/, ''), ext: f.name.slice(f.name.lastIndexOf('.')), version: 1, time: KB.fmtTime(Date.now()), editor: KB.USER.name, edits: paragraphs.length, linkedCards: 0, chapter: 'מסמך מקושר · ' + paragraphs.length + ' פסקאות', pages: '', paragraphs, suggestions, status: 'pending' };
          (S.userSources = S.userSources || []).push(src); S.sourceStatus[id] = 'pending'; S.lastScan = Date.now(); KB.save(); KB.emit('sources');
          cur = src; nav.go('sources', id, undefined, { replace: true }); draw();
          KB.toast('נסרק: ' + paragraphs.length + ' פסקאות · ' + suggestions.length + ' הצעות לכרטיסים', 'ok');
        };
        rd.readAsText(f);
      });
    }
    draw();
    return () => subs.forEach((u) => u());
  };
})();
