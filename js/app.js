/* wecom KB — app shell: sidebar (full / rail), tab strip, view routing, mobile drawer */
(function () {
  'use strict';
  const KB = window.KB; const { $, $$, el, esc } = KB; const S = KB.state(); const nav = KB.nav;
  KB.views = KB.views || {};

  const sidebar = $('#sidebar'), content = $('#content'), viewEl = $('#view'), tabsEl = $('#tabstrip');
  let mobileOpen = false, scrim = null;

  /* ── sidebar ──────────────────────────────────────────────────────────── */
  function renderSidebar() {
    const r = nav.current || { route: 'library' };
    const railMode = ['doc', 'edit', 'history', 'sources'].includes(r.route) && !S.prefs.sideExpanded;
    $('#app').classList.toggle('rail', railMode);
    sidebar.classList.toggle('rail-mode', railMode);
    sidebar.innerHTML = '';
    const counts = KB.catCounts();
    const docs = KB.docs();
    const drafts = Object.keys(S.drafts).length;
    const pendingSrc = KB.SOURCE_DOCS.filter((d) => KB.sourceStatus(d.id) === 'pending').length;
    const crmChanges = KB.CRM_FIELDS.filter((f) => f.status !== 'ok').length;
    const item = (label, route, a, cnt, badge) => el('div', { class: 'snav' + (r.route === route && (a == null || r.a === a) ? ' on' : ''), onclick: () => { closeMobile(); nav.go(route, a); } }, el('span', { class: 'dot' }), label, cnt != null ? el('span', { class: 'cnt' + (badge ? ' badge' : '') }, String(cnt)) : null);
    // rail (collapsed) content
    const rail = el('div', { class: 'rail-only' },
      el('span', { class: 'rail-logo', onclick: () => nav.go('library'), title: 'ספרייה' }, 'w.'),
      el('span', { class: 'rail-btn', title: 'הרחב תפריט', onclick: () => { S.prefs.sideExpanded = true; KB.save(); renderSidebar(); } }, '☰'),
      el('span', { class: 'rail-btn' + (r.route === 'pinned' ? ' on' : ''), title: 'מוצמדים', onclick: () => nav.go('pinned') }, '★'),
      el('span', { class: 'rail-btn' + (r.route === 'recent' ? ' on' : ''), title: 'נצפו לאחרונה', onclick: () => nav.go('recent') }, '🕘'),
      el('span', { class: 'rail-btn' + (r.route === 'sources' ? ' on' : ''), title: 'מסמכי מקור', onclick: () => nav.go('sources') }, '📄', pendingSrc ? el('span', { class: 'b' }, String(pendingSrc)) : null),
      el('span', { class: 'rail-btn', title: 'חיפוש · Ctrl K', onclick: () => KB.palette.open() }, '⌕'),
      el('span', { class: 'rail-btn bottom', title: 'מצב כהה · Ctrl D', onclick: KB.toggleTheme }, '◐'));
    sidebar.appendChild(rail);
    sidebar.appendChild(el('div', { class: 'brand' }, el('span', { class: 'logo', onclick: () => { closeMobile(); nav.go('library'); } }, 'wecom.'), el('span', { class: 'tag' }, 'מאגר ידע פנימי'), S.prefs.sideExpanded && ['doc', 'edit', 'history', 'sources'].includes(r.route) ? el('span', { class: 'rail-btn', style: 'width:28px;height:28px', title: 'כווץ', onclick: () => { S.prefs.sideExpanded = false; KB.save(); renderSidebar(); } }, '⟨') : null));
    sidebar.appendChild(el('div', { class: 'search-trigger', onclick: () => { closeMobile(); KB.palette.open(); } }, el('span', null, 'חיפוש בכל המקורות…'), el('kbd', null, 'Ctrl K')));
    const scroll = el('div', { class: 'scroll' });
    scroll.appendChild(el('nav', null,
      item('ספריית ידע', 'library', undefined, KB.topics().length),
      item('מוצמדים', 'pinned', undefined, S.pins.length),
      item('נצפו לאחרונה', 'recent'),
      item('טיוטות', 'drafts', undefined, drafts || null, true),
      item('היסטוריית גרסאות', 'history'),
      item('סל מיחזור', 'trash', undefined, S.trash.length || null),
      item('מסמכי מקור', 'sources', undefined, pendingSrc || null, true)));
    scroll.appendChild(el('div', { class: 'sec-title' }, 'מקורות נתונים'));
    const srcs = el('div', { style: 'display:flex;flex-direction:column;gap:2px;padding:0 10px' });
    KB.SOURCES.forEach((src) => {
      let meta = '', warn = false;
      if (src.kind === 'docs') { const n = docs.filter((d) => (d.src || 'topics') === src.id).length; meta = n + (src.id === 'topics' ? ' · מסונכרן' : ''); }
      else if (src.kind === 'fields') { meta = crmChanges ? crmChanges + ' שינויים' : KB.CRM_FIELDS.length + ' · מסונכרן'; warn = !!crmChanges; }
      else meta = String(KB.SCRIPTS.length);
      srcs.appendChild(el('div', { class: 'src-row', onclick: () => { closeMobile(); if (src.kind === 'fields') nav.go('fields'); else if (src.kind === 'scripts') KB.palette.open({ type: 'script' }); else nav.go('library', src.id === 'intl' ? 'intl' : undefined); } }, el('span', { class: 'sq' + (warn ? ' warn' : '') }), el('bdi', { class: 'lat', dir: 'ltr' }, src.file), el('span', { class: 'meta' + (warn ? ' warn' : '') }, meta)));
    });
    srcs.appendChild(el('div', { class: 'src-add', onclick: () => KB.pickFile('.json,.csv', (f) => KB.importFile(f, () => nav.go('library'))) }, '+ הוסף מקור (JSON / CSV)'));
    scroll.appendChild(srcs);
    scroll.appendChild(el('div', { class: 'sec-title' }, 'קטגוריות'));
    const cats = el('div', { style: 'display:flex;flex-direction:column;gap:1px;padding:0 10px' });
    Object.keys(KB.CATS).forEach((c) => cats.appendChild(el('div', { class: 'cat-row' + (r.route === 'library' && r.a === c ? ' on' : ''), onclick: () => { closeMobile(); nav.go('library', c); } }, el('span', null, KB.CATS[c].label), el('span', null, String(counts[c] || 0)))));
    scroll.appendChild(cats);
    sidebar.appendChild(scroll);
    const dark = document.documentElement.dataset.theme === 'dark';
    sidebar.appendChild(el('div', { class: 'user' }, el('span', { class: 'avatar' }, KB.USER.initial), el('div', { class: 'who', onclick: KB.showSettings, style: 'cursor:pointer', title: 'הגדרות' }, el('div', null, KB.USER.name), el('div', null, KB.USER.role)), el('span', { class: 'toggle' + (dark ? ' on' : ''), title: 'מצב כהה · Ctrl D', onclick: KB.toggleTheme })));
  }

  /* ── tab strip (open documents, history, split) ───────────────────────── */
  function renderTabs() {
    const r = nav.current || {};
    S.tabs = S.tabs.filter((t) => KB.doc(t.docId));
    if (r.route !== 'doc' || !S.tabs.length) { tabsEl.innerHTML = ''; tabsEl.hidden = true; return; }
    tabsEl.hidden = false; tabsEl.className = 'tabstrip'; tabsEl.innerHTML = '';
    S.tabs.forEach((t, i) => {
      const d = KB.doc(t.docId);
      const on = i === S.activeTab && r.a === t.docId;
      tabsEl.appendChild(el('div', { class: 'tab' + (on ? ' on' : ''), title: d.title, onclick: () => nav.go('doc', t.docId), onauxclick: (e) => { if (e.button === 1) { e.preventDefault(); nav.closeTab(i); } } }, el('span', { class: 't' }, d.title), el('span', { class: 'x', title: 'סגור (W)', onclick: (e) => { e.stopPropagation(); nav.closeTab(i); } }, '×')));
    });
    tabsEl.appendChild(el('span', { class: 'plus', title: 'לשונית חדשה · Alt T', onclick: nav.newTab }, '+'));
    const dirBack = document.dir === 'rtl' ? '→' : '←', dirFwd = document.dir === 'rtl' ? '←' : '→';
    tabsEl.appendChild(el('div', { class: 'navbtns' },
      el('button', { title: 'אחורה · Alt ←', disabled: !nav.canBack(), onclick: nav.back }, dirBack),
      el('button', { title: 'קדימה · Alt →', disabled: !nav.canForward(), onclick: nav.forward }, dirFwd),
      el('button', { class: nav.split ? 'on' : '', title: 'פיצול מסך · Ctrl \\', onclick: () => nav.toggleSplit() }, '⫿')));
  }
  KB.renderTabs = renderTabs;

  /* ── view routing ─────────────────────────────────────────────────────── */
  const VIEW_OF = { library: 'library', pinned: 'library', recent: 'library', drafts: 'library', fields: 'fields', blocks: 'blocks', doc: 'article', edit: 'editor', history: 'history', trash: 'trash', sources: 'sources' };
  let currentTeardown = null;
  function renderView() {
    const r = nav.current || { route: 'library' };
    if (currentTeardown) { try { currentTeardown(); } catch (e) { /* noop */ } currentTeardown = null; }
    viewEl.innerHTML = '';
    viewEl.className = 'view on';
    const fn = KB.views[VIEW_OF[r.route]] || KB.views.library;
    currentTeardown = fn(viewEl, r) || null;
    renderTabs();
    renderSidebar();
    closeMobile();
  }
  KB.on('route', renderView);
  KB.on('docs', () => { renderSidebar(); const r = nav.current || {}; if (['library', 'pinned', 'recent', 'drafts', 'fields', 'blocks', 'trash', 'history'].includes(r.route)) renderView(); else if (r.route === 'doc') { KB.emit('doc-refresh'); renderTabs(); } });
  KB.on('pins', () => { renderSidebar(); const r = nav.current || {}; if (r.route === 'pinned' || r.route === 'library') renderView(); });
  KB.on('trash', () => renderSidebar());
  KB.on('tabs', renderTabs);
  KB.on('theme', renderSidebar);
  KB.on('sources', renderSidebar);

  /* ── mobile drawer ────────────────────────────────────────────────────── */
  KB.openMobileNav = () => { mobileOpen = true; sidebar.classList.add('open'); scrim = el('div', { class: 'scrim', onclick: closeMobile }); document.body.appendChild(scrim); };
  function closeMobile() { if (!mobileOpen) return; mobileOpen = false; sidebar.classList.remove('open'); if (scrim) { scrim.remove(); scrim = null; } }
  KB.hamburger = () => el('button', { class: 'btn ghost hamburger', title: 'תפריט', onclick: KB.openMobileNav }, '☰');

  /* ── global shortcuts that need view context ──────────────────────────── */
  KB.on('key', (e) => {
    const r = nav.current || {};
    if (e.key === 'w' || e.key === 'W' || e.key === "'") { if (r.route === 'doc' && S.tabs.length) { e.preventDefault(); nav.closeTab(S.activeTab); } }
  });
  KB.on('escape', () => { const ov = $$('.overlay'); if (ov.length) return; if (mobileOpen) closeMobile(); });

  /* ── boot ─────────────────────────────────────────────────────────────── */
  nav.start(); // emits 'route' → renderView
  if (!nav.current) nav.go('library', undefined, undefined, { replace: true });
})();
