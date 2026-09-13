/* wecom KB — core: state, persistence, formatting helpers, modals, toasts */
(function () {
  'use strict';
  const KB = window.KB;

  /* ── tiny DOM helpers ─────────────────────────────────────────────────── */
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function el(tag, attrs, ...children) {
    const node = document.createElement(tag);
    if (attrs) for (const k in attrs) {
      const v = attrs[k];
      if (v == null || v === false) continue;
      if (k === 'class') node.className = v;
      else if (k === 'html') node.innerHTML = v;
      else if (k === 'style') node.style.cssText = v;
      else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
      else if (k === 'dataset') Object.assign(node.dataset, v);
      else node.setAttribute(k, v === true ? '' : v);
    }
    for (const c of children.flat(Infinity)) {
      if (c == null || c === false) continue;
      node.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
    }
    return node;
  }
  const uid = (p) => (p || 'id') + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
  Object.assign(KB, { $, $$, esc, el, uid, clone, debounce });

  /* ── dates ────────────────────────────────────────────────────────────── */
  const HE_MONTHS = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];
  KB.fmtDate = (ts, opts) => {
    const d = new Date(typeof ts === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(ts) ? ts + 'T12:00:00' : ts);
    if (isNaN(d)) return '';
    if (opts && opts.month) return HE_MONTHS[d.getMonth()] + ' ' + d.getFullYear();
    return d.getDate() + ' ' + HE_MONTHS[d.getMonth()] + ' ' + d.getFullYear();
  };
  KB.fmtTime = (ts) => { const d = new Date(ts); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
  KB.ago = (ts) => {
    const s = Math.max(0, (Date.now() - ts) / 1000);
    if (s < 5) return 'עכשיו';
    if (s < 60) return 'לפני ' + Math.floor(s) + ' שנ׳';
    const m = s / 60; if (m < 60) return 'לפני ' + Math.floor(m) + ' דק׳';
    const h = m / 60; if (h < 24) return 'לפני ' + Math.floor(h) + ' שעות';
    const d = h / 24; if (d < 2) return 'אתמול'; if (d < 30) return 'לפני ' + Math.floor(d) + ' ימים';
    return KB.fmtDate(ts);
  };
  KB.inDays = (ts) => { const d = Math.ceil((ts - Date.now()) / 864e5); return d <= 0 ? 'היום' : d === 1 ? 'מחר' : 'בעוד ' + d + ' ימים'; };

  /* ── text formatting: bidi system, CRM chips, links, bold ─────────────── */
  const CRM_NAMES = () => KB.CRM_FIELDS.map((f) => f.name).sort((a, b) => b.length - a.length);
  const LATIN_RE = /[A-Za-z][A-Za-z0-9+\-/.]*(?:[ ][A-Za-z0-9+\-/.]+)*|\d+(?:[.:]\d+)+|\d+s\b/g;
  const CODE_RE = /\b([RMOE]-\d{2}|T-\d{2})\b/g;
  KB.docByCode = (code) => KB.docs().find((d) => d.code === code);

  function fmtPlain(text) {
    // escape, then wrap latin identifiers / numeric tokens as isolated ltr runs
    let out = '';
    let last = 0;
    const s = String(text);
    LATIN_RE.lastIndex = 0;
    let m;
    while ((m = LATIN_RE.exec(s))) {
      out += esc(s.slice(last, m.index));
      const tok = m[0];
      if (/^[A-Za-z]$/.test(tok) && !/[A-Za-z]/.test(s[m.index + 1] || '')) { out += esc(tok); }  // lone letter (e.g. ל-x) stays
      else out += '<bdi class="lat" dir="ltr">' + esc(tok) + '</bdi>';
      last = m.index + tok.length;
    }
    out += esc(s.slice(last));
    return out;
  }
  /**
   * fmt(text): markdown-lite → HTML honoring the bidi rules from the type system:
   *  **bold**, "quoted", [[doc:id|label]] links, R-01 style codes → doc links,
   *  CRM field names → chips with fixed direction, Latin runs → <bdi dir=ltr>.
   */
  KB.fmt = function (text, opts) {
    if (text == null) return '';
    opts = opts || {};
    const s = String(text);
    // 1. split out protected segments: links, crm fields, codes, bold
    const parts = [];
    const names = CRM_NAMES();
    const nameRe = names.length ? new RegExp('(' + names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')') : null;
    const linkRe = /\[\[doc:([\w-]+)(?:\|([^\]]+))?\]\]/;
    let rest = s;
    while (rest.length) {
      const cands = [];
      const lm = linkRe.exec(rest); if (lm) cands.push({ i: lm.index, len: lm[0].length, kind: 'link', m: lm });
      const bm = /\*\*([^*]+)\*\*/.exec(rest); if (bm) cands.push({ i: bm.index, len: bm[0].length, kind: 'bold', m: bm });
      if (nameRe && !opts.noCrm) { const cm = nameRe.exec(rest); if (cm) cands.push({ i: cm.index, len: cm[0].length, kind: 'crm', m: cm }); }
      CODE_RE.lastIndex = 0; const km = CODE_RE.exec(rest); if (km) cands.push({ i: km.index, len: km[0].length, kind: 'code', m: km });
      if (!cands.length) { parts.push({ kind: 'text', t: rest }); break; }
      cands.sort((a, b) => a.i - b.i || b.len - a.len);
      const c = cands[0];
      if (c.i > 0) parts.push({ kind: 'text', t: rest.slice(0, c.i) });
      parts.push({ kind: c.kind, m: c.m });
      rest = rest.slice(c.i + c.len);
    }
    return parts.map((p) => {
      if (p.kind === 'text') return fmtPlain(p.t);
      if (p.kind === 'bold') return '<b>' + KB.fmt(p.m[1], { noCrm: opts.noCrm }) + '</b>';
      if (p.kind === 'crm') return KB.crmChip(p.m[1]);
      if (p.kind === 'link') {
        const doc = KB.doc(p.m[1]);
        const label = p.m[2] || (doc ? doc.title : p.m[1]);
        return '<a class="doc-link" data-doc="' + esc(p.m[1]) + '">' + esc(label) + '</a>';
      }
      if (p.kind === 'code') {
        const doc = KB.docByCode(p.m[1]);
        return doc ? '<a class="doc-link" data-doc="' + esc(doc.id) + '"><bdi class="lat" dir="ltr">' + esc(p.m[1]) + '</bdi></a>' : '<bdi class="lat" dir="ltr">' + esc(p.m[1]) + '</bdi>';
      }
      return '';
    }).join('');
  };
  KB.crmChip = function (name, extra) {
    const f = KB.CRM_FIELDS.find((x) => x.name === name);
    const isLatin = /^[A-Za-z]/.test(name);
    const st = f ? f.status : 'unknown';
    const title = f ? (st === 'renamed' ? 'שדה CRM · שונה שם ל-' + f.renamedTo : st === 'new' ? 'שדה CRM · חדש' : 'שדה CRM · תקין · ' + f.path) : 'שדה CRM · לא מוכר';
    return '<span class="crm ' + (isLatin ? '' : 'rtl ') + esc(st) + '" data-crm="' + esc(name) + '" title="' + esc(title) + '">' + esc(name) + '<i class="dot"></i></span>' + (extra ? '<span class="fnote">' + esc(extra) + '</span>' : '');
  };
  KB.stripFmt = (t) => String(t || '').replace(/\*\*/g, '').replace(/\[\[doc:[\w-]+(?:\|([^\]]+))?\]\]/g, (m, l) => l || '');
  KB.crmIn = (text) => CRM_NAMES().filter((n) => String(text || '').includes(n));

  /* ── state & persistence ──────────────────────────────────────────────── */
  const KEY = 'wecom_kb2_state_v1';
  const LEGACY = { docs: 'wecom_kb_docs_v1', topics: 'wecom_kb_topics_v1' };
  const defaults = () => ({
    seedVersion: KB.SEED_VERSION,
    topics: [], docs: {}, deletedDocs: [], blocks: {}, deletedBlocks: [],
    pins: [], recent: [], views: {}, notes: {}, notesLiked: [],
    trash: [], versions: {}, drafts: {}, sourceDecisions: {}, sourceStatus: {},
    tabs: [], activeTab: 0, prefs: { theme: null, font: 'plex', panel: true, callMode: true, reviewRequests: {} }, calls: {}
  });
  let S = defaults();
  KB.state = () => S;

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const saved = JSON.parse(raw);
        S = Object.assign(defaults(), saved);
        S.prefs = Object.assign(defaults().prefs, saved.prefs || {});
        if (saved.seedVersion !== KB.SEED_VERSION) {
          // seed changed: drop overrides of seed docs so fresh content shows; keep user-authored docs
          Object.keys(S.docs).forEach((id) => { if (KB.SEED.docs.some((d) => d.id === id) && !(S.docs[id] && S.docs[id]._userEdited)) delete S.docs[id]; });
          S.seedVersion = KB.SEED_VERSION;
        }
      } else migrateLegacy();
    } catch (e) { S = defaults(); }
    purgeTrash();
  }
  /* Bring forward knowledge items written with the previous stage-based builder. */
  function migrateLegacy() {
    try {
      const docsRaw = localStorage.getItem(LEGACY.docs), topicsRaw = localStorage.getItem(LEGACY.topics);
      if (!docsRaw) return;
      const old = JSON.parse(docsRaw) || {};
      const oldTopics = topicsRaw ? JSON.parse(topicsRaw) : [];
      let n = 0;
      Object.keys(old).forEach((id) => {
        if (id.startsWith('pdf_') || id.startsWith('view-')) return;
        const d = old[id]; if (!d || !d.stages) return;
        const steps = d.stages.map((s, i) => ({ id: 's' + (i + 1), num: String(s.num || i + 1), title: s.title || 'שלב ' + (i + 1),
          actions: (s.items || []).map((it, j) => ({ id: 's' + (i + 1) + 'a' + (j + 1), text: typeof it === 'object' ? it.text : String(it) })) }));
        const t = oldTopics.find((x) => x.dynId === id) || {};
        S.docs[id] = { id, title: d.topic || t.title || 'פריט ידע', desc: t.desc || '', cat: d.cat || 'tech', wave: d.wave || 2, pri: t.pri || 'm', src: 'topics', kind: 'steps',
          status: 'published', version: 1, updated: new Date().toISOString().slice(0, 10), author: KB.USER.name, phases: [{ id: 'p1', label: 'שלבי הטיפול', steps }], _userEdited: true, _migrated: true };
        if (t.id) S.topics.push({ id: t.id, cat: S.docs[id].cat, wave: S.docs[id].wave, pri: t.pri || 'm', title: S.docs[id].title, desc: t.desc || '', docId: id });
        n++;
      });
      if (n) setTimeout(() => KB.toast(n + ' פריטי ידע מהגרסה הקודמת יובאו לספרייה החדשה', 'ok'), 800);
    } catch (e) { /* ignore corrupt legacy data */ }
  }
  const saveNow = () => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { KB.toast('לא ניתן לשמור מקומית (אחסון מלא?)', 'warn'); } };
  KB.save = debounce(saveNow, 120);
  KB.saveNow = saveNow;
  KB.resetAll = () => { localStorage.removeItem(KEY); location.reload(); };

  /* ── derived collections ──────────────────────────────────────────────── */
  KB.topics = () => {
    const seed = KB.TOPICS.filter((t) => !S.topics.some((u) => u.id === t.id && u._deleted));
    const overrides = S.topics.filter((t) => !t._deleted);
    const map = new Map(seed.map((t) => [t.id, t]));
    overrides.forEach((t) => map.set(t.id, Object.assign({}, map.get(t.id) || {}, t)));
    return Array.from(map.values()).filter((t) => !(t.docId && S.deletedDocs.includes(t.docId) && !t._keepCard));
  };
  KB.topic = (id) => KB.topics().find((t) => t.id === id);
  KB.docs = () => {
    const map = new Map(KB.SEED.docs.map((d) => [d.id, d]));
    Object.keys(S.docs).forEach((id) => map.set(id, S.docs[id]));
    return Array.from(map.values()).filter((d) => !S.deletedDocs.includes(d.id));
  };
  KB.doc = (id) => { if (!id || S.deletedDocs.includes(id)) return null; return S.docs[id] || KB.SEED.docs.find((d) => d.id === id) || null; };
  KB.docForTopic = (t) => (t && t.docId ? KB.doc(t.docId) : null);
  KB.topicForDoc = (doc) => KB.topics().find((t) => t.docId === doc.id) || (doc.topicId ? KB.topic(doc.topicId) : null);
  KB.blocks = () => { const map = new Map(KB.BLOCKS.map((b) => [b.id, b])); Object.keys(S.blocks).forEach((id) => map.set(id, S.blocks[id])); return Array.from(map.values()).filter((b) => !S.deletedBlocks.includes(b.id)); };
  KB.block = (id) => (S.deletedBlocks.includes(id) ? null : S.blocks[id] || KB.BLOCKS.find((b) => b.id === id) || null);
  KB.steps = (doc) => (doc && doc.phases ? doc.phases.flatMap((p) => p.steps.map((s) => Object.assign({ _phase: p }, s))) : []);
  KB.step = (doc, id) => KB.steps(doc).find((s) => s.id === id);
  /* resolve a step's effective content (shared block content is embedded at read time) */
  KB.resolveStep = (step) => {
    if (!step) return step;
    if (!step.block) return step;
    const b = KB.block(step.block);
    if (!b) return Object.assign({}, step, { _blockMissing: true });
    return Object.assign({}, step, { title: step.title || b.title, desc: step.desc || b.desc, actions: b.actions || [], outcomes: step.outcomes || b.outcomes || [], script: step.script || b.script, _block: b });
  };
  KB.stepActions = (step) => KB.resolveStep(step).actions || [];
  KB.docSteps = (doc) => KB.steps(doc).map(KB.resolveStep);
  KB.blockUsage = (blockId) => KB.docs().filter((d) => KB.steps(d).some((s) => s.block === blockId || (s.blockRefs || []).includes(blockId)));
  KB.docCrm = (doc) => { const set = new Set(); KB.docSteps(doc).forEach((s) => { (s.actions || []).forEach((a) => KB.crmIn(a.text).forEach((n) => set.add(n))); if (s.branch) s.branch.options.forEach((o) => KB.crmIn(o.text).forEach((n) => set.add(n))); (s.stages || []).forEach((st) => (st.actions || []).forEach((a) => KB.crmIn(a).forEach((n) => set.add(n)))); }); return Array.from(set); };
  KB.fieldUsage = (name) => KB.docs().filter((d) => KB.docCrm(d).includes(name));
  KB.stepText = (s) => { const r = KB.resolveStep(s); return [r.title, r.desc, ...(r.actions || []).map((a) => a.text), r.script || '', ...(r.branch ? [r.branch.q, ...r.branch.options.map((o) => o.label + ' ' + o.text)] : []), ...(r.outcomes || []).map((o) => o.text), ...(r.stages || []).flatMap((st) => [st.label, st.script || '', ...(st.actions || [])]), ...(r.signals || []).flatMap((g) => g.items), r.objection ? r.objection.q + ' ' + r.objection.a : '', ...(r.principles || [])].filter(Boolean).join(' · '); };
  /* outgoing links: goto targets in other docs, [[doc:]] and codes in text */
  KB.docLinksOut = (doc) => {
    const ids = new Set();
    const scan = (t) => { String(t || '').replace(/\[\[doc:([\w-]+)/g, (m, id) => { ids.add(id); return m; }); String(t || '').replace(CODE_RE, (m, c) => { const d = KB.docByCode(c); if (d) ids.add(d.id); return m; }); };
    KB.docSteps(doc).forEach((s) => scan(KB.stepText(s)));
    (doc.related || []).forEach((r) => ids.add(r.docId));
    ids.delete(doc.id);
    return Array.from(ids).filter((id) => KB.doc(id));
  };
  KB.docLinksIn = (docId) => KB.docs().filter((d) => d.id !== docId && KB.docLinksOut(d).includes(docId));
  KB.stepBlocks = (s) => [s.block].concat(s.blockRefs || []).filter((id) => id && KB.block(id));
  KB.sharedWith = (a, b) => { const ba = new Set(KB.steps(a).flatMap(KB.stepBlocks)); return KB.steps(b).flatMap((s) => KB.stepBlocks(s).filter((id) => ba.has(id)).map((id) => ({ block: KB.block(id), step: s }))); };
  /* automatic related docs: explicit + shared blocks + shared crm fields + links */
  KB.relatedDocs = (doc) => {
    const out = new Map();
    (doc.related || []).forEach((r) => { if (KB.doc(r.docId)) out.set(r.docId, r.why); });
    KB.docLinksOut(doc).forEach((id) => { if (!out.has(id)) out.set(id, 'מקושר מהמסמך'); });
    const myBlocks = new Set(KB.steps(doc).map((s) => s.block).filter(Boolean));
    const myCrm = new Set(KB.docCrm(doc));
    KB.docs().forEach((d) => {
      if (d.id === doc.id || out.has(d.id)) return;
      const sb = KB.steps(d).filter((s) => s.block && myBlocks.has(s.block) && KB.block(s.block));
      if (sb.length) { out.set(d.id, 'בלוק משותף: ' + sb.map((s) => KB.block(s.block).title).join(', ')); return; }
      const sc = KB.docCrm(d).filter((n) => myCrm.has(n));
      if (sc.length >= 2) out.set(d.id, 'משתף ' + sc.length + ' שדות CRM');
    });
    return Array.from(out.entries()).map(([docId, why]) => ({ docId, why })).slice(0, 6);
  };
  KB.stepCount = (doc) => KB.steps(doc).length;
  KB.catCounts = () => { const c = {}; KB.topics().forEach((t) => { c[t.cat] = (c[t.cat] || 0) + 1; }); return c; };
  KB.docStatus = (doc) => {
    if (!doc) return 'placeholder';
    if (doc.status === 'draft') return 'draft';
    if (doc.status === 'partial' || KB.docSteps(doc).some((s) => !(s.actions || []).length && !s.branch && !s.script && !s.stages && !s.signals && !s.pillars)) return 'partial';
    return 'published';
  };
  KB.notesFor = (docId) => { const seed = (KB.doc(docId) || {}).notes || []; return seed.concat(S.notes[docId] || []); };
  KB.isPinned = (id) => S.pins.includes(id);
  KB.togglePin = (id) => { const i = S.pins.indexOf(id); if (i >= 0) S.pins.splice(i, 1); else S.pins.unshift(id); KB.save(); KB.emit('pins'); return i < 0; };
  KB.touchRecent = (docId) => { S.recent = [docId].concat(S.recent.filter((x) => x !== docId)).slice(0, 30); S.views[docId] = (S.views[docId] || 0) + 1; KB.save(); };

  /* ── documents: create/update/publish/delete ──────────────────────────── */
  KB.upsertDoc = (doc, opts) => {
    opts = opts || {};
    doc._userEdited = true;
    S.docs[doc.id] = doc;
    // keep a library card in sync
    let t = KB.topics().find((x) => x.docId === doc.id);
    if (!t && doc.topicId) { const cand = KB.topic(doc.topicId); if (cand && (!cand.docId || cand.docId === doc.id)) t = cand; }
    if (!t) {
      const maxId = Math.max(...KB.topics().map((x) => x.id), 100);
      t = { id: maxId + 1 };
    }
    const ov = Object.assign({}, S.topics.find((x) => x.id === t.id) || {}, { id: t.id, cat: doc.cat, wave: doc.wave, pri: doc.pri || t.pri || 'm', title: doc.title, desc: doc.desc || t.desc || '', docId: doc.id });
    S.topics = S.topics.filter((x) => x.id !== t.id).concat([ov]);
    doc.topicId = t.id;
    if (!opts.silent) KB.save();
    KB.emit('docs');
    return doc;
  };
  KB.versionsOf = (docId) => {
    const seed = (KB.SEED.versions && KB.SEED.versions[docId]) || [];
    const user = S.versions[docId] || [];
    return seed.concat(user).sort((a, b) => a.v - b.v);
  };
  /* Reconstruct the document as it was at version v (seed versions are described as patches back from current). */
  KB.docAtVersion = (docId, v) => {
    const doc = KB.doc(docId); if (!doc) return null;
    const vs = KB.versionsOf(docId);
    const target = vs.find((x) => x.v === v); if (!target) return null;
    if (target.snapshot) return target.snapshot;
    // seed patch versions: apply patches from all versions >= v that have patches (each patch describes "state at that version" relative to current)
    const base = clone(KB.SEED.docs.find((d) => d.id === docId) || doc);
    const patches = vs.filter((x) => x.v <= v && x.patch).sort((a, b) => b.v - a.v);
    if (!patches.length) return base;
    const p = patches[0].patch;
    p.forEach((pp) => {
      base.phases.forEach((ph) => {
        const i = ph.steps.findIndex((s) => s.id === pp.stepId);
        if (i < 0) return;
        if (pp.remove) { ph.steps.splice(i, 1); return; }
        const cp = Object.assign({}, pp); delete cp.stepId;
        Object.keys(cp).forEach((k) => { if (cp[k] === null) delete ph.steps[i][k]; else ph.steps[i][k] = cp[k]; });
      });
    });
    base.version = v;
    return base;
  };
  KB.publish = (doc, label) => {
    const existing = KB.doc(doc.id);
    const vs = KB.versionsOf(doc.id);
    const nextV = (vs.length ? Math.max(...vs.map((x) => x.v)) : (existing ? existing.version || 0 : 0)) + 1;
    doc.version = nextV; doc.status = doc.status === 'partial' ? 'partial' : 'published'; doc.updated = new Date().toISOString().slice(0, 10); doc.author = KB.USER.name;
    // previous published state becomes a stored snapshot if no snapshot exists for it
    if (existing && !vs.some((x) => x.snapshot && x.v === existing.version) && !vs.some((x) => x.v === existing.version)) {
      (S.versions[doc.id] = S.versions[doc.id] || []).push({ v: existing.version || 0, ts: Date.parse(existing.updated || 0) || Date.now() - 1, author: existing.author || 'מערכת', label: 'גרסה קודמת', kind: 'published', snapshot: clone(existing) });
    }
    KB.upsertDoc(doc, { silent: true });
    (S.versions[doc.id] = S.versions[doc.id] || []).push({ v: nextV, ts: Date.now(), author: KB.USER.name, label: label || 'פורסם', kind: 'published', snapshot: clone(doc) });
    // seed "current" flag no longer applies
    delete S.drafts[doc.id];
    KB.save(); KB.emit('docs');
    return doc;
  };
  KB.restoreVersion = (docId, v) => {
    const snap = clone(KB.docAtVersion(docId, v)); if (!snap) return null;
    return KB.publish(snap, 'שוחזר מגרסה v' + v);
  };
  KB.deleteDoc = (docId, who) => {
    const doc = KB.doc(docId); if (!doc) return;
    const linksIn = KB.docLinksIn(docId).map((d) => d.id);
    S.trash.unshift({ id: uid('tr'), kind: 'doc', refId: docId, title: doc.title, meta: KB.CATS[doc.cat].label + ' · ' + (doc.src === 'intl' ? 'intl-roaming.json' : 'topics.json') + '#' + (doc.topicId || '') + ' · v' + (doc.version || 1) + ' · ' + KB.stepCount(doc) + ' שלבים', deletedBy: who || KB.USER.name, deletedAt: Date.now(), payload: clone(doc), impact: { broken: linksIn.length, docs: linksIn } });
    S.deletedDocs.push(docId);
    S.tabs = S.tabs.filter((t) => t.docId !== docId);
    KB.save(); KB.emit('docs'); KB.emit('trash');
  };
  KB.deleteTopic = (topicId) => {
    const t = KB.topic(topicId); if (!t) return;
    if (t.docId) { KB.deleteDoc(t.docId); return; }
    S.trash.unshift({ id: uid('tr'), kind: 'topic', refId: topicId, title: t.title, meta: KB.CATS[t.cat].label + ' · כרטיס ללא מסמך', deletedBy: KB.USER.name, deletedAt: Date.now(), payload: clone(t), impact: { broken: 0 } });
    S.topics = S.topics.filter((x) => x.id !== topicId).concat([{ id: topicId, _deleted: true }]);
    KB.save(); KB.emit('docs'); KB.emit('trash');
  };
  KB.deleteBlock = (blockId) => {
    const b = KB.block(blockId); if (!b) return;
    const used = KB.blockUsage(blockId);
    S.trash.unshift({ id: uid('tr'), kind: 'block', refId: blockId, title: 'בלוק משותף: ' + b.title, meta: 'shared/' + blockId + ' · ' + (b.kind === 'script' ? 'תסריט' : 'שלב') + ' · היה ב-' + used.length + ' מסמכים', deletedBy: KB.USER.name, deletedAt: Date.now(), payload: clone(b), impact: { broken: used.length, docs: used.map((d) => d.id) } });
    S.deletedBlocks.push(blockId);
    KB.save(); KB.emit('docs'); KB.emit('trash');
  };
  KB.restoreTrash = (entryId) => {
    const i = S.trash.findIndex((e) => e.id === entryId); if (i < 0) return;
    const e = S.trash[i];
    if (e.kind === 'doc') { S.deletedDocs = S.deletedDocs.filter((x) => x !== e.refId); if (e.payload._userEdited) S.docs[e.refId] = e.payload; (S.versions[e.refId] = S.versions[e.refId] || []).push({ v: (e.payload.version || 0), ts: Date.now(), author: 'מערכת', label: 'שוחזר מסל מיחזור', kind: 'system', snapshot: clone(e.payload) }); }
    else if (e.kind === 'topic') { S.topics = S.topics.filter((x) => x.id !== e.refId); if (!KB.TOPICS.some((t) => t.id === e.refId)) S.topics.push(e.payload); }
    else if (e.kind === 'block') { S.deletedBlocks = S.deletedBlocks.filter((x) => x !== e.refId); if (!KB.BLOCKS.some((b) => b.id === e.refId)) S.blocks[e.refId] = e.payload; }
    S.trash.splice(i, 1);
    KB.save(); KB.emit('docs'); KB.emit('trash');
    return e;
  };
  KB.purgeTrashEntry = (entryId) => { S.trash = S.trash.filter((e) => e.id !== entryId); KB.save(); KB.emit('trash'); };
  KB.TRASH_DAYS = 30;
  function purgeTrash() { const cutoff = Date.now() - KB.TRASH_DAYS * 864e5; const before = S.trash.length; S.trash = S.trash.filter((e) => e.deletedAt > cutoff); if (S.trash.length !== before) saveNow(); }

  /* ── events ───────────────────────────────────────────────────────────── */
  const listeners = {};
  KB.on = (ev, fn) => { (listeners[ev] = listeners[ev] || []).push(fn); return () => { const a = listeners[ev] || []; const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); }; };
  KB.emit = (ev, data) => { (listeners[ev] || []).forEach((fn) => { try { fn(data); } catch (e) { console.error(e); } }); };

  /* ── toasts / modals ──────────────────────────────────────────────────── */
  KB.toast = (msg, kind, undo) => {
    let wrap = $('.toasts'); if (!wrap) { wrap = el('div', { class: 'toasts' }); document.body.appendChild(wrap); }
    const t = el('div', { class: 'toast ' + (kind || '') }, el('span', { html: msg }));
    if (undo) t.appendChild(el('span', { class: 'u', onclick: () => { undo(); t.remove(); } }, 'בטל'));
    wrap.appendChild(t);
    setTimeout(() => { t.style.transition = 'opacity .3s'; t.style.opacity = '0'; setTimeout(() => t.remove(), 300); }, undo ? 6000 : 3200);
  };
  KB.modal = (opts) => {
    const ov = el('div', { class: 'overlay center' + (opts.dark ? ' dark' : '') });
    const m = el('div', { class: 'modal' + (opts.wide ? ' wide' : '') });
    const close = () => { ov.remove(); document.removeEventListener('keydown', onKey); if (opts.onClose) opts.onClose(); };
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
    m.appendChild(el('h2', null, opts.title || '', el('span', { class: 'x', onclick: close, title: 'סגור (Esc)' }, '✕')));
    if (opts.body) m.appendChild(typeof opts.body === 'string' ? el('div', { html: opts.body }) : opts.body);
    if (opts.buttons) m.appendChild(el('div', { class: 'foot' }, opts.buttons.map((b) => el('button', { class: 'btn ' + (b.cls || ''), onclick: () => { const r = b.onclick ? b.onclick() : true; if (r !== false) close(); } }, b.label))));
    ov.appendChild(m);
    ov.addEventListener('mousedown', (e) => { if (e.target === ov && !opts.sticky) close(); });
    document.addEventListener('keydown', onKey);
    document.body.appendChild(ov);
    const f = m.querySelector('input,textarea,select,button.primary'); if (f) setTimeout(() => f.focus(), 30);
    return { close, el: m };
  };
  KB.confirm = (title, html, okLabel, okCls, onOk) => KB.modal({ title, body: '<p>' + html + '</p>', buttons: [{ label: 'ביטול' }, { label: okLabel || 'אישור', cls: okCls || 'primary', onclick: onOk }] });
  KB.prompt = (title, label, value, onOk, multiline) => {
    const inp = multiline ? el('textarea', { rows: 4 }) : el('input', { type: 'text' });
    inp.value = value || '';
    const body = el('div', { class: 'form' }, el('label', null, label, inp));
    const m = KB.modal({ title, body, buttons: [{ label: 'ביטול' }, { label: 'אישור', cls: 'primary', onclick: () => onOk(inp.value) }] });
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !multiline) { e.preventDefault(); onOk(inp.value); m.close(); } });
  };
  KB.copy = (text) => { const done = () => KB.toast('הועתק ללוח', 'ok'); if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, () => fallback()); else fallback(); function fallback() { const ta = el('textarea', { style: 'position:fixed;opacity:0' }); ta.value = text; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); done(); } catch (e) { KB.toast('לא ניתן להעתיק', 'warn'); } ta.remove(); } };
  KB.download = (name, data, type) => { const a = el('a', { href: URL.createObjectURL(new Blob([data], { type: type || 'application/json' })), download: name }); document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500); };

  /* ── prefs ────────────────────────────────────────────────────────────── */
  KB.applyPrefs = () => {
    const root = document.documentElement;
    const theme = S.prefs.theme || (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    root.dataset.theme = theme;
    root.dataset.font = S.prefs.font === 'rubik' ? 'rubik' : 'plex';
  };
  KB.toggleTheme = () => { const cur = document.documentElement.dataset.theme; S.prefs.theme = cur === 'dark' ? 'light' : 'dark'; KB.applyPrefs(); KB.save(); KB.emit('theme'); KB.toast(S.prefs.theme === 'dark' ? '◐ מצב כהה' : '○ מצב בהיר'); };
  KB.setFont = (f) => { S.prefs.font = f; KB.applyPrefs(); KB.save(); };

  /* ── export / import ──────────────────────────────────────────────────── */
  KB.exportAll = () => {
    const data = { exportedAt: new Date().toISOString(), app: 'wecom-kb', version: 2, topics: KB.topics(), docs: KB.docs(), blocks: KB.blocks(), crmFields: KB.CRM_FIELDS, scripts: KB.SCRIPTS };
    KB.download('wecom-kb-export-' + new Date().toISOString().slice(0, 10) + '.json', JSON.stringify(data, null, 2));
    KB.toast('הספרייה יוצאה כ-JSON', 'ok');
  };
  KB.importFile = (file, onDone) => {
    const rd = new FileReader();
    rd.onload = () => {
      try {
        let added = 0;
        if (/\.csv$/i.test(file.name)) {
          const rows = rd.result.split(/\r?\n/).filter((r) => r.trim());
          const head = rows.shift().split(',').map((h) => h.trim().toLowerCase());
          const ix = (k) => head.indexOf(k);
          rows.forEach((r) => {
            const c = r.split(',').map((x) => x.trim().replace(/^"|"$/g, ''));
            const title = c[ix('title')] || c[0]; if (!title) return;
            const maxId = Math.max(...KB.topics().map((x) => x.id), 100);
            S.topics.push({ id: maxId + 1, title, desc: c[ix('desc')] || '', cat: KB.CATS[c[ix('cat')]] ? c[ix('cat')] : 'tech', wave: parseInt(c[ix('wave')]) || 2, pri: KB.PRI[c[ix('pri')]] ? c[ix('pri')] : 'm' });
            added++;
          });
        } else {
          const j = JSON.parse(rd.result);
          const docs = Array.isArray(j) ? j : (j.docs || []);
          docs.forEach((d) => { if (!d || !d.title) return; if (!d.id || KB.doc(d.id)) d.id = uid('doc'); if (!d.phases) d.phases = [{ id: 'p1', label: 'שלבי הטיפול', steps: [] }]; d.cat = KB.CATS[d.cat] ? d.cat : 'tech'; d.wave = d.wave || 2; d.kind = d.kind || 'steps'; d.status = d.status || 'published'; d.version = d.version || 1; d.src = d.src || 'topics'; KB.upsertDoc(d, { silent: true }); added++; });
          (j.topics || []).forEach((t) => { if (t && t.title && !KB.topics().some((x) => x.title === t.title)) { const maxId = Math.max(...KB.topics().map((x) => x.id), 100); S.topics.push(Object.assign({}, t, { id: maxId + 1, docId: KB.doc(t.docId) ? t.docId : undefined })); added++; } });
        }
        KB.save(); KB.emit('docs');
        KB.toast('יובאו ' + added + ' פריטים מ-' + esc(file.name), 'ok');
        if (onDone) onDone(added);
      } catch (e) { KB.toast('הקובץ לא נקרא: ' + esc(e.message), 'warn'); }
    };
    rd.readAsText(file);
  };
  KB.pickFile = (accept, cb) => { const inp = el('input', { type: 'file', accept: accept || '.json,.csv', style: 'display:none' }); inp.addEventListener('change', () => { if (inp.files[0]) cb(inp.files[0]); inp.remove(); }); document.body.appendChild(inp); inp.click(); };

  /* ── word-level diff (for version history + editor diff) ─────────────── */
  KB.wordDiff = (a, b) => {
    const A = KB.stripFmt(a || '').split(/(\s+)/).filter((x) => x.length), B = KB.stripFmt(b || '').split(/(\s+)/).filter((x) => x.length);
    const n = A.length, m = B.length;
    const L = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = A[i] === B[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
    let i = 0, j = 0; const outA = [], outB = [];
    while (i < n && j < m) {
      if (A[i] === B[j]) { outA.push(esc(A[i])); outB.push(esc(B[j])); i++; j++; }
      else if (L[i + 1][j] >= L[i][j + 1]) { outA.push('<del class="d">' + esc(A[i]) + '</del>'); i++; }
      else { outB.push('<ins class="d">' + esc(B[j]) + '</ins>'); j++; }
    }
    while (i < n) { outA.push('<del class="d">' + esc(A[i++]) + '</del>'); }
    while (j < m) { outB.push('<ins class="d">' + esc(B[j++]) + '</ins>'); }
    return { a: outA.join(''), b: outB.join(''), changed: outA.some((x) => x.startsWith('<del')) || outB.some((x) => x.startsWith('<ins')) };
  };

  load();
  KB.applyPrefs();
})();
