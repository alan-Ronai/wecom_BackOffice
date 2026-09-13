# L7 — Design Mockups (Claude Design) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce four new mockup turns (3–6) in the existing Claude Design project so lanes L4/L2/L3/L6 implement the admin, connector, connected-data and QOL screens from reviewed designs, not from prose.

**Architecture:** Each turn is one `.dc.html` design-canvas file authored locally under `design/`, using the exact document format of `wecom KB Redesign.dc.html` (an `<x-dc>` root, a `<helmet data-dc-atomics>` block with fonts and `dv-*` chrome styles, one `<section class="dv-turn">` holding `dv-opt` cards, and an optional `<script type="text/x-dc" data-dc-script>` DCLogic class for interactive values). Files are checked with Playwright screenshots, then pushed to project `8d3a1b0f-a941-4ceb-add4-7a58dd5a964d` with the DesignSync tool. The existing `support.js` in the project provides the runtime; every new file references it with `<script src="./support.js"></script>`.

**Tech Stack:** Design-canvas HTML (`x-dc`, `sc-for`, `sc-if`, `{{ }}` bindings, `DCLogic`), IBM Plex Sans Hebrew / IBM Plex Mono / Rubik, Playwright MCP for visual checks, DesignSync MCP for publishing.

**Spec:** `docs/superpowers/specs/2026-09-13-kb-platform-program-and-lanes.md` §5 (lane L7), §9 (connected data), §10 (admin & identity); `docs/superpowers/specs/2026-09-13-kb-platform-stage1-foundation-design.md` §3 (identity/RBAC), §5 (frontend screens).

## Global Constraints

- Design tokens exactly as the shipped app: navy `#1F2E3B`, navy-mid `#2E4255`, red `#FF3D00`, red-dark `#C02800`, red-light `#FFF0EB`, red-mid `#FFB596`, bg `#F4F5F7`, border `#E2E4E6`, muted `#6B7280`, muted-2 `#A6ABB0`, ok `#1A7A4A` / `#EDFAF3` / `#B7E8CE`, warn `#B86A00` / `#FFF8EE` / `#F5D8A5`, info `#1D45B4` / `#EBF1FF`, dark surfaces `#151D25` / `#1F2A35`.
- Fonts: body `'IBM Plex Sans Hebrew',Rubik,sans-serif`; Latin identifiers, codes, keyboard shortcuts and dates in `'IBM Plex Mono',monospace` wrapped in `<bdi dir="ltr" style="unicode-bidi:isolate">`; CRM fields as navy chips with fixed direction.
- Every card `dir="rtl"`, all copy in Hebrew; English only inside identifiers.
- Card widths: full screens 1280px, panels/dialogs 640–1000px, mobile 390px. No card taller than 900px; long lists are truncated with a "+N" row.
- Every element that a lane must implement is visible in a card; nothing is described only in prose.
- Files are named `wecom KB Turn 3 - Identity & Admin.dc.html` … `Turn 6 - QOL.dc.html`; option ids continue the existing numbering (`3a`, `3b`, … `6h`).
- Push only after the local Playwright review passes; never delete or overwrite `wecom KB Redesign.dc.html`, `wecom KB Wireframes.dc.html` or `support.js`.
- Commit after every task; commit messages end with the attribution lines the session provides.

## File structure produced by this plan

```
design/
  README.md                                   turn structure, naming, how to push
  _helmet.html                                shared <helmet> block copied into every turn file
  wecom KB Turn 3 - Identity & Admin.dc.html  options 3a–3f
  wecom KB Turn 4 - Connectors & Sync.dc.html options 4a–4e
  wecom KB Turn 5 - Connected Data.dc.html    options 5a–5e
  wecom KB Turn 6 - QOL.dc.html               options 6a–6h
  review/                                      Playwright screenshots (git-ignored)
```

Each turn file has this skeleton (identical to the imported redesign file):

```html
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<script src="./support.js"></script>
</head>
<body>
<x-dc>
<!-- contents of design/_helmet.html -->
<section class="dv-turn" id="t3">
<div class="dv-thd"><a class="dv-tid" href="#t3">3</a><span class="dv-tname">Identity &amp; admin — …</span></div>
<div class="dv-opts">
  <div class="dv-opt" id="3a">
    <div class="dv-olabel"><a class="dv-oid" href="#3a">3a</a>Login — …</div>
    <div class="dv-card" dir="rtl" style="…"> … </div>
  </div>
  <!-- more dv-opt -->
</div>
<p class="dv-next">Try next: …</p>
</section>
</x-dc>
<script type="text/x-dc" data-dc-script data-props="{}">
class Component extends DCLogic { state = {}; renderVals() { return {}; } }
</script>
</body>
</html>
```

---

### Task 1: Design folder, shared helmet, README, review harness

**Files:**
- Create: `design/README.md`, `design/_helmet.html`, `design/review/.gitkeep`
- Modify: `.gitignore` (add `design/review/*.png`)

**Interfaces:**
- Produces: `design/_helmet.html` — the exact `<helmet data-dc-atomics>` block every turn file pastes in; the `tok` helper convention for Latin chips (see Step 2); the review script `pnpm dlx playwright screenshot` command used by every later task.

- [ ] **Step 1: Write `design/README.md`**

```markdown
# wecom KB — design turns

Mockups live in the Claude Design project `wecom KB Redesign` (id `8d3a1b0f-a941-4ceb-add4-7a58dd5a964d`).
Turns 1–2 are the original redesign (`wecom KB Redesign.dc.html`). Turns 3–6 are authored here:

| File | Turn | Options |
|---|---|---|
| `wecom KB Turn 3 - Identity & Admin.dc.html` | 3 | 3a login · 3b users · 3c roles matrix · 3d groups→roles · 3e sessions · 3f audit |
| `wecom KB Turn 4 - Connectors & Sync.dc.html` | 4 | 4a registry · 4b WordPress wizard · 4c sync queue · 4d parity report · 4e conflict merge |
| `wecom KB Turn 5 - Connected Data.dc.html` | 5 | 5a data explorer · 5b graph · 5c CRM field page · 5d block page · 5e dashboards |
| `wecom KB Turn 6 - QOL.dc.html` | 6 | 6a library · 6b article · 6c editor · 6d notifications · 6e onboarding+palette · 6f accessibility · 6g mobile · 6h dark variants |

Rules: one `<section class="dv-turn">` per file, option ids `<turn><letter>`, every card `dir="rtl"`, Hebrew copy, tokens from `_helmet.html`.
Interactivity: a `DCLogic` class at the bottom of the file; values are bound with `{{ name }}`, lists with `<sc-for list="{{ items }}" as="x">`, conditions with `<sc-if value="{{ flag }}">`.

## Review locally
`pnpm dlx playwright screenshot --viewport-size=1400,900 --full-page "file://$PWD/design/<file>" design/review/<name>.png`
Open the PNG; check: no horizontal overflow inside a card, Latin tokens isolated (no flipped "H+ / 3G"), no clipped Hebrew descenders, contrast of chips on navy.

## Push
1. `DesignSync list_files { projectId }` — confirm the target path does not already exist unless updating it.
2. `DesignSync finalize_plan { projectId, writes: ["<file name>"], localDir: "design" }` → `planId`.
3. `DesignSync write_files { projectId, planId, files: [{ path: "<file name>", localPath: "<file name>" }] }`.
Never include `support.js`, `wecom KB Redesign.dc.html` or `wecom KB Wireframes.dc.html` in `writes`/`deletes`.
```

- [ ] **Step 2: Write `design/_helmet.html`** (verbatim helmet from the redesign file plus shared token classes so cards can use short class names instead of only inline styles)

```html
<helmet data-dc-atomics><meta name="design_doc_mode" content="canvas"><link href="https://fonts.googleapis.com/css2?family=Rubik:wght@300;400;500;600;700&family=IBM+Plex+Sans+Hebrew:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet"><style>body{margin:0;background:#ECEEF1;font-family:'IBM Plex Sans Hebrew',Rubik,system-ui,sans-serif;color:#1F2E3B}a{color:#1F2E3B}a:hover{color:#FF3D00}.dv-turn{padding:40px 44px 32px;border-bottom:1px solid rgba(0,0,0,.08);scroll-margin-top:16px}.dv-thd{display:flex;align-items:baseline;gap:10px;margin:0 0 20px}.dv-tid{font:600 10px ui-monospace,Menlo,monospace;padding:3px 7px;background:#1a1a1a;color:#fff;border-radius:4px;text-decoration:none}.dv-tname{font:600 13px/1.2 system-ui,sans-serif;color:#1a1a1a}.dv-opts{display:flex;flex-wrap:wrap;gap:28px;align-items:flex-start}.dv-opt{flex:none;display:flex;flex-direction:column;gap:9px;scroll-margin-top:16px}.dv-oid{font:600 10.5px ui-monospace,Menlo,monospace;padding:3px 7px;background:rgba(0,0,0,.08);color:#1a1a1a;border-radius:5px;text-decoration:none}.dv-olabel{display:flex;align-items:baseline;gap:8px;font:400 11px/1.3 system-ui,sans-serif;color:rgba(0,0,0,.55)}.dv-card{max-width:100%;background:#fff;border:1px solid rgba(0,0,0,.08);border-radius:8px;box-shadow:0 1px 3px rgba(0,0,0,.06);overflow:hidden}.dv-opt:target .dv-oid{background:#2a78d6;color:#fff}.dv-next{margin:22px 0 0;font:12px/1.5 system-ui,sans-serif;color:rgba(0,0,0,.5)}@keyframes wkPulse{0%,100%{opacity:.35}50%{opacity:1}}
/* shared tokens for turns 3–6 */
.k-side{background:#1F2E3B;color:#fff;display:flex;flex-direction:column;padding:16px 0}.k-side .logo{padding:0 18px 14px;font-size:22px;font-weight:700;color:#FF3D00;font-family:Rubik,sans-serif}.k-side .sec{padding:6px 18px;font-size:10.5px;font-weight:600;letter-spacing:1px;text-transform:uppercase;color:rgba(255,255,255,.4)}.k-side .nav{display:flex;flex-direction:column;gap:2px;padding:0 10px;font-size:13px}.k-side .nav>div{display:flex;align-items:center;gap:10px;padding:8px 12px;border-radius:8px;color:rgba(255,255,255,.7)}.k-side .nav>div.on{background:rgba(255,61,0,.16);color:#fff;font-weight:500}.k-side .nav .cnt{margin-inline-start:auto;font-size:11px;color:rgba(255,255,255,.5)}
.k-top{height:56px;display:flex;align-items:center;gap:10px;padding:0 22px;background:#fff;border-bottom:1px solid #E2E4E6}.k-crumb{font-size:12.5px;color:#6B7280}.k-crumb b{color:#1F2E3B;font-weight:500}.k-actions{margin-inline-start:auto;display:flex;gap:8px}
.k-btn{white-space:nowrap;flex-shrink:0;display:inline-flex;align-items:center;gap:6px;padding:6px 12px;border-radius:8px;border:1px solid #E2E4E6;font-size:12.5px;background:#fff}.k-btn.p{background:#FF3D00;color:#fff;border-color:#FF3D00;font-weight:500}.k-btn.n{background:#1F2E3B;color:#fff;border-color:#1F2E3B}.k-btn.d{color:#C02800;border-color:#FFB596}
.k-chip{display:inline-flex;align-items:center;gap:5px;font-size:11px;font-weight:500;padding:2px 9px;border-radius:20px;background:#F5F5F5;color:#6B7280;white-space:nowrap}.k-chip.red{background:#FFF0EB;color:#C02800}.k-chip.amber{background:#FFF8EE;color:#B86A00}.k-chip.green{background:#EDFAF3;color:#1A7A4A}.k-chip.blue{background:#EBF1FF;color:#1D45B4}.k-chip.navy{background:#1F2E3B;color:#fff}
.k-eyebrow{font-size:10.5px;font-weight:600;letter-spacing:.8px;text-transform:uppercase;color:#6B7280}.k-card{background:#fff;border:1px solid #E2E4E6;border-radius:12px;padding:14px 16px}.k-mono{font-family:'IBM Plex Mono',monospace;unicode-bidi:isolate;direction:ltr}.k-crm{unicode-bidi:isolate;direction:ltr;display:inline-flex;align-items:center;gap:5px;font-family:'IBM Plex Mono',monospace;font-size:11.5px;background:#1F2E3B;color:#fff;padding:1px 7px;border-radius:5px}.k-crm.rtl{direction:rtl}
.k-table{display:grid;gap:0;font-size:12.5px}.k-table>div{display:contents}.k-table>div>span{padding:10px 12px;border-bottom:1px solid #F0F2F4;display:flex;align-items:center;gap:8px;min-width:0}.k-table>div.h>span{font-size:10.5px;font-weight:600;letter-spacing:.6px;text-transform:uppercase;color:#6B7280;border-bottom:1px solid #E2E4E6}.k-table>div.sel>span{background:#FFF8F5}
.k-av{width:26px;height:26px;border-radius:50%;background:#1F2E3B;color:#fff;display:grid;place-items:center;font-size:11px;font-weight:600;flex-shrink:0}.k-av.r{background:#FF3D00}.k-av.g{background:#A6ABB0}
.k-kbd{font-family:'IBM Plex Mono',monospace;font-size:10.5px;background:#F0F2F4;padding:1px 6px;border-radius:4px;color:#6B7280;direction:ltr;unicode-bidi:isolate}
.k-toggle{width:30px;height:18px;border-radius:9px;background:#C7CBD0;position:relative;flex-shrink:0}.k-toggle.on{background:#FF3D00}.k-toggle::after{content:'';position:absolute;top:2px;right:2px;width:14px;height:14px;border-radius:50%;background:#fff}.k-toggle.on::after{right:auto;left:2px}
.k-focus{outline:2px solid #FF3D00;outline-offset:2px;border-radius:6px}
</style></helmet>
```

- [ ] **Step 3: Add the review ignore and verify the helmet renders**

Append `design/review/*.png` to `.gitignore`. Create `design/review/.gitkeep`. Create a throwaway `design/_smoke.dc.html` (skeleton above with helmet and one card `<div class="dv-card" dir="rtl" style="width:400px;padding:20px"><span class="k-chip red">בדיקה</span> <span class="k-crm">sim block lbl</span></div>`), run:

`pnpm dlx playwright screenshot --viewport-size=900,400 "file://$PWD/design/_smoke.dc.html" design/review/smoke.png`

Expected: PNG shows a red chip and a navy mono chip; text renders in Plex Hebrew (fonts load from Google). Delete `_smoke.dc.html` afterwards.

- [ ] **Step 4: Commit**

```bash
git add design .gitignore && git commit -m "design: turn scaffold, shared helmet, review harness"
```

---

### Task 2: Turn 3 — Identity & admin (3a–3f)

**Files:**
- Create: `design/wecom KB Turn 3 - Identity & Admin.dc.html`
- Screenshot: `design/review/turn3.png`

**Interfaces:**
- Consumes: `design/_helmet.html`, option numbering `3a…3f`.
- Produces: the reference cards for L4 screens `/login`, `/admin/users`, `/admin/roles`, `/admin/groups-map`, `/admin/sessions`, `/admin/audit`; permission names exactly from `packages/shared/src/permissions.ts` (`docs.read … system.admin`).

**QOL checklist the turn must show:** provider buttons + "זוהית אוטומטית דרך GlobalProtect" state with the detected user and a "לא אני" link; break-glass local login hidden behind "כניסה מקומית"; users table with source badge (Entra / GlobalProtect / מקומי), roles chips with category scope, last login relative time, bulk select + "הקצה תפקיד" toolbar, inline deactivate with undo toast; role matrix as permissions × roles grid with locked cells for admin (`roles.manage`, `users.manage`), inherited cells dimmed, "מה משתנה" preview counting affected users; group→role mapping with search of Entra groups and "סנכרון אחרון" timestamp; sessions list with IP, device, "מכשיר זה" tag, revoke single/all; audit explorer with filter chips (משתמש, ישות, פעולה, תאריך), row expansion into before/after JSON diff with green/red marks, export CSV.

- [ ] **Step 1: Write the file skeleton and option 3a (login) in full**

```html
<div class="dv-opt" id="3a">
<div class="dv-olabel"><a class="dv-oid" href="#3a">3a</a>Login — Entra ID button, GlobalProtect auto-identify state, break-glass local login hidden</div>
<div class="dv-card" dir="rtl" style="width:1280px;height:720px;display:grid;grid-template-columns:1fr 480px;background:#F4F5F7">
  <div style="background:#1F2E3B;color:#fff;padding:48px 56px;display:flex;flex-direction:column">
    <div style="font-size:28px;font-weight:700;color:#FF3D00;font-family:Rubik,sans-serif">wecom.</div>
    <div style="margin-top:8px;font-size:13px;color:rgba(255,255,255,.55)">מאגר ידע פנימי · שרת LAN פנימי</div>
    <div style="margin-top:auto;display:flex;flex-direction:column;gap:14px;max-width:420px">
      <div style="font-size:22px;font-weight:600;line-height:1.35">כל נוהל, כל שדה CRM, כל גרסה — במקום אחד, מחובר למסמכי המקור.</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;font-size:11.5px;color:rgba(255,255,255,.7)"><span class="k-chip" style="background:rgba(255,255,255,.1);color:#fff">52 כרטיסים</span><span class="k-chip" style="background:rgba(255,255,255,.1);color:#fff">14 שדות CRM</span><span class="k-chip" style="background:rgba(255,255,255,.1);color:#fff">3 מקורות מסונכרנים</span></div>
    </div>
    <div style="margin-top:28px;font-size:11px;color:rgba(255,255,255,.4)">גרסת מערכת <bdi class="k-mono">1.0.0</bdi> · <bdi class="k-mono">kb.wecom.local</bdi></div>
  </div>
  <div style="display:flex;align-items:center;justify-content:center;padding:40px">
    <div style="width:100%;max-width:380px;display:flex;flex-direction:column;gap:14px">
      <div style="font-size:20px;font-weight:700">כניסה</div>
      <sc-if value="{{ identified }}" hint-placeholder-val="{{ true }}">
        <div style="border:1px solid #B7E8CE;background:#EDFAF3;border-radius:12px;padding:14px 16px;display:flex;gap:12px;align-items:center">
          <span class="k-av r">ע</span>
          <div style="line-height:1.35;flex:1"><div style="font-size:13.5px;font-weight:600">ענבר ל.</div><div style="font-size:11.5px;color:#1A7A4A">זוהית אוטומטית דרך GlobalProtect · <bdi class="k-mono">10.20.4.17</bdi></div></div>
          <span onClick="{{ notMe }}" style="font-size:11.5px;color:#6B7280;text-decoration:underline;cursor:pointer">לא אני</span>
        </div>
        <span onClick="{{ enter }}" class="k-btn p" style="justify-content:center;padding:11px;font-size:14px">המשך כ־ענבר ל.</span>
      </sc-if>
      <sc-if value="{{ notIdentified }}" hint-placeholder-val="{{ false }}">
        <span class="k-btn n" style="justify-content:center;padding:11px;font-size:14px;gap:10px"><span style="width:16px;height:16px;background:#fff;border-radius:2px;display:inline-block"></span>כניסה עם חשבון Microsoft של wecom</span>
        <div style="font-size:11.5px;color:#6B7280;text-align:center">מתחבר דרך Entra ID · אותה כניסה של ה-VPN</div>
      </sc-if>
      <div style="display:flex;align-items:center;gap:10px;color:#A6ABB0;font-size:11px"><span style="flex:1;height:1px;background:#E2E4E6"></span>או<span style="flex:1;height:1px;background:#E2E4E6"></span></div>
      <details style="font-size:12px;color:#6B7280"><summary style="cursor:pointer">כניסה מקומית (מנהל מערכת בלבד)</summary>
        <div style="margin-top:10px;display:flex;flex-direction:column;gap:8px"><input placeholder="שם משתמש" style="padding:9px 10px;border:1px solid #E2E4E6;border-radius:8px;font:inherit"><input type="password" placeholder="סיסמה" style="padding:9px 10px;border:1px solid #E2E4E6;border-radius:8px;font:inherit"><span class="k-btn" style="justify-content:center">כניסה</span></div>
      </details>
      <div style="margin-top:8px;font-size:11px;color:#A6ABB0;line-height:1.5">הכניסה נרשמת ביומן הביקורת. בעיות בזיהוי? פנה ל-IT · <bdi class="k-mono">it@wecom.co.il</bdi></div>
    </div>
  </div>
</div></div>
```

DCLogic values for this card (`renderVals`): `identified: this.state.identified`, `notIdentified: !this.state.identified`, `notMe: () => this.setState({identified:false})`, `enter: () => {}`; `state = { identified: true }`.

- [ ] **Step 2: Add options 3b–3f as fully specified cards**

- **3b Users (1280×760)** — `k-side` with nav (ספרייה, מקורות, מחברים, **משתמשים** on, תפקידים, יומן ביקורת, מערכת); `k-top` crumb "ניהול / משתמשים", actions: search input `חפש לפי שם, מייל, קבוצה`, filter chips `הכל 84 · Entra 71 · GlobalProtect 9 · מקומי 4 · לא פעילים 6`, `k-btn n` "סנכרן מ-Entra · לפני 3 שעות", `k-btn p` "✚ משתמש מקומי". Bulk toolbar row (visible because two rows selected): "2 נבחרו · הקצה תפקיד ▾ · הגבל לקטגוריה ▾ · השבת". `k-table` grid `24px 1fr 160px 220px 140px 120px 90px` with header (☐, משתמש, מקור, תפקידים, קבוצות, כניסה אחרונה, סטטוס) and 8 rows: Hebrew names, `k-av` initials, email in `k-mono`; source chip `blue` Entra / `amber` GlobalProtect / gray מקומי; role chips `navy` "עורכת" + scope chip "חו"ל ונדידה בלבד"; groups "KB-Editors, Support-L2"; last login "לפני 12 דק׳"; status `green` פעיל / `red` מושבת; row 5 has an inline toast strip "המשתמש הושבת · <u>בטל</u> · 6s". Footer: pagination "1–20 מתוך 84" and `k-kbd` hints `J/K ניווט · X בחירה · A הקצאה`.
- **3c Role & permission matrix (1100×700)** — header "תפקידים והרשאות" + `k-btn` "✚ תפקיד" + `k-btn n` "שמור (3 שינויים)". Grid: first column 19 permission rows grouped by resource (מסמכים, בלוקים ושדות, הערות, הצעות, מקורות ומחברים, ניהול), then columns `נציג · עורך · ראש צוות · מנהל · צוות חו"ל (מותאם)`. Cells: ✓ solid navy = granted, ✓ dimmed = inherited from a lower role, empty = none, 🔒 = locked (`roles.manage`, `users.manage` in מנהל). Three cells in "צוות חו"ל" highlighted amber as unsaved changes. Side drawer (280px) "מה משתנה": "12 משתמשים יקבלו `docs.publish` · 3 יאבדו `fields.edit`", with a "הצג משתמשים" link and a "הסקופ של תפקיד זה: חו"ל ונדידה" category chips editor.
- **3d Group → role mapping (900px)** — left: Entra groups list with search ("KB-Editors (23) · Support-L2 (41) · Retention (9) · IT-Admins (5)"), each with a dropdown "→ תפקיד" and a resulting members count; right: preview "לפי המיפוי: 23 עורכים, 5 מנהלים, 41 נציגים, 15 ללא תפקיד"; banner "סנכרון אחרון מ-Graph: היום 06:00 · הבא: מחר 06:00" and `k-btn` "סנכרן עכשיו". Footer note: "משתמש שהוסר מהקבוצה מאבד את התפקיד בכניסה הבאה, לא באמצע פעילות."
- **3e Sessions (820px)** — list of 5 sessions: device icon, "Chrome · Windows", IP `k-mono`, "מכשיר זה" chip on the first, "נראה לאחרונה לפני 2 דק׳", `k-btn d` "נתק"; header `k-btn d` "נתק את כל האחרים"; expiry line "תוקף: 8 שעות מחוסר פעילות".
- **3f Audit explorer (1280×720)** — filter bar chips (משתמש: ענבר ל. ×, ישות: מסמך ×, פעולה ▾, 7 ימים ▾), `k-btn` "ייצוא CSV"; table `160px 120px 1fr 160px 90px` (מתי, מי, מה, ישות, בקשה) with 7 rows; row 3 expanded showing two columns "לפני / אחרי" of JSON with `<span style="background:#FFE0E0;text-decoration:line-through">` and `<span style="background:#D8F5E5">` marks on the changed lines (`"threshold": 5` → `6`), request id `k-mono`, and a "פתח את הגרסה v8" link.

- [ ] **Step 3: Write the DCLogic script** — `state = { identified: true }`; `renderVals()` returns the 3a values plus static arrays if `sc-for` is used for users rows (`users: [...]` with `name, initials, email, source, sourceCls, roles, groups, last, active`).

- [ ] **Step 4: Review**

`pnpm dlx playwright screenshot --viewport-size=1400,900 --full-page "file://$PWD/design/wecom KB Turn 3 - Identity & Admin.dc.html" design/review/turn3.png`

Check: six cards visible; no card overflows 1280px; email/IP/request ids render LTR; matrix cells align; expanded audit row shows red/green marks.

- [ ] **Step 5: Push with DesignSync**

1. `DesignSync { method: "list_files", projectId: "8d3a1b0f-a941-4ceb-add4-7a58dd5a964d" }` — expected: the new file name is not yet present.
2. `DesignSync { method: "finalize_plan", projectId: "8d3a1b0f-a941-4ceb-add4-7a58dd5a964d", writes: ["wecom KB Turn 3 - Identity & Admin.dc.html"], localDir: "design" }` → note `planId`.
3. `DesignSync { method: "write_files", projectId: "8d3a1b0f-a941-4ceb-add4-7a58dd5a964d", planId: "<planId>", files: [{ path: "wecom KB Turn 3 - Identity & Admin.dc.html", localPath: "wecom KB Turn 3 - Identity & Admin.dc.html" }] }`.
4. Open `https://claude.ai/design/p/8d3a1b0f-a941-4ceb-add4-7a58dd5a964d?file=wecom+KB+Turn+3+-+Identity+%26+Admin.dc.html` and confirm the six options render.

- [ ] **Step 6: Commit**

```bash
git add design && git commit -m "design: turn 3 identity & admin mockups"
```

---

### Task 3: Turn 4 — Connectors & sync (4a–4e)

**Files:**
- Create: `design/wecom KB Turn 4 - Connectors & Sync.dc.html`
- Screenshot: `design/review/turn4.png`

**Interfaces:**
- Produces: reference for L4 `/admin/connectors`, `/admin/connectors/:id`, `/sync`, `/sync/parity`, `/sync/conflicts/:id`; states use the connector contract capabilities (`read/write/webhooks/identity`) and sync states `synced/pending/processing/error`, conflict resolution "review queue".

**QOL checklist:** registry cards with health dot, last run, next run, capabilities icons, "בדוק חיבור" inline result; wizard with 4 steps (כתובת ואימות → מה לייבא → מיפוי לכרטיסים → תזמון ו-webhook) and a live "נמצאו 38 עמודים" preview; sync queue with per-item state, retry, "עצור", progress bar for processing, and a "ממתין לסקירה" badge that deep-links to suggestions; parity report as a table of links with per-side hash/time and a state pill (זהה / ממתין לייבוא / ממתין לדחיפה / קונפליקט); three-column merge (בסיס · WordPress · הספרייה) with per-paragraph "קח משמאל/מימין" buttons, an editable merged column and a "פרסם לשני הצדדים" primary action.

- [ ] **Step 1: Write option 4b (WordPress setup wizard) in full**

```html
<div class="dv-opt" id="4b">
<div class="dv-olabel"><a class="dv-oid" href="#4b">4b</a>WordPress wizard — 4 steps, test connection, live preview of what will be imported</div>
<div class="dv-card" dir="rtl" style="width:960px;background:#F4F5F7;padding:22px;display:grid;grid-template-columns:220px 1fr;gap:16px">
  <div style="display:flex;flex-direction:column;gap:6px">
    <div class="k-eyebrow" style="margin-bottom:6px">מחבר חדש · WordPress</div>
    <sc-for list="{{ wizard }}" as="w" hint-placeholder-count="4">
      <div style="display:flex;gap:10px;align-items:center;padding:9px 12px;border-radius:8px;background:{{ w.bg }};color:{{ w.color }};font-size:12.5px;font-weight:{{ w.weight }}"><span style="width:20px;height:20px;border-radius:50%;background:{{ w.dot }};color:#fff;display:grid;place-items:center;font-size:10px">{{ w.mark }}</span>{{ w.label }}</div>
    </sc-for>
    <div style="margin-top:auto;font-size:11px;color:#6B7280;line-height:1.5">ההגדרות נשמרות מוצפנות בשרת. סיסמת האפליקציה לא נשמרת בדפדפן.</div>
  </div>
  <div class="k-card" style="display:flex;flex-direction:column;gap:14px;min-height:460px">
    <div style="display:flex;align-items:center;gap:10px"><span style="font-size:16px;font-weight:600">שלב 1 · כתובת ואימות</span><span class="k-chip amber">טרם נבדק</span></div>
    <label style="display:flex;flex-direction:column;gap:4px;font-size:11.5px;color:#6B7280">כתובת האתר<input value="https://help.wecom.co.il" style="padding:9px 10px;border:1px solid #E2E4E6;border-radius:8px;font:inherit;direction:ltr;font-family:'IBM Plex Mono',monospace"></label>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      <label style="display:flex;flex-direction:column;gap:4px;font-size:11.5px;color:#6B7280">משתמש WordPress<input value="kb-sync" style="padding:9px 10px;border:1px solid #E2E4E6;border-radius:8px;font:inherit;direction:ltr"></label>
      <label style="display:flex;flex-direction:column;gap:4px;font-size:11.5px;color:#6B7280">סיסמת אפליקציה<input type="password" value="xxxx xxxx xxxx xxxx" style="padding:9px 10px;border:1px solid #E2E4E6;border-radius:8px;font:inherit;direction:ltr"></label>
    </div>
    <div style="display:flex;gap:8px;align-items:center"><span onClick="{{ test }}" class="k-btn n">בדוק חיבור</span>
      <sc-if value="{{ tested }}" hint-placeholder-val="{{ true }}"><span class="k-chip green">✓ מחובר · WordPress <bdi class="k-mono">6.6</bdi> · REST API פתוח · 38 עמודים, 12 פוסטים</span></sc-if>
    </div>
    <div style="border:1px dashed #E2E4E6;border-radius:10px;padding:12px 14px;font-size:12px;color:#6B7280;line-height:1.6"><b style="color:#1F2E3B">יכולות שזוהו</b> · קריאה ✓ · כתיבה ✓ (הרשאת עורך) · webhook: מומלץ להתקין את התוסף <bdi class="k-mono">wecom-kb-hook</bdi> · זהות: לא</div>
    <div style="margin-top:auto;display:flex;gap:8px;justify-content:flex-end"><span class="k-btn">ביטול</span><span class="k-btn p">המשך למה לייבא ←</span></div>
  </div>
</div></div>
```

DCLogic: `state = { tested: true }`, `wizard` = four entries with the first `on` (bg `#FFF0EB`, dot `#FF3D00`, mark `1`) and the others neutral (`bg:'transparent'`, dot `#C7CBD0`, marks `2..4`), `test: () => this.setState({tested:true})`.

- [ ] **Step 2: Add 4a, 4c, 4d, 4e as fully specified cards**

- **4a Registry (1280×640)** — sidebar `k-side` (מחברים on), top bar "ניהול / מחברים" + `k-btn p` "✚ מחבר". Grid of connector cards (3 per row): **WordPress · help.wecom.co.il** (green dot "תקין", "ריצה אחרונה לפני 14 דק׳ · הבאה בעוד 46 דק׳", capabilities icons `📥 📤 🔔`, stats "38 קישורים · 2 ממתינים לסקירה · 1 קונפליקט", buttons "הרץ עכשיו · בדוק חיבור · הגדרות"); **תיקיית Word · \\fs01\kb\procedures** (green, "צופה בתיקייה · 4 קבצים", `📥`); **crm-fields.xlsx** (amber "3 שינויים לא מעובדים"); **JSON סטטי · topics.json** (gray "מקור מקומי"); dashed "+ הוסף מחבר" card listing available types (WordPress, תיקייה, SharePoint — בקרוב, Google Drive — בקרוב).
- **4c Sync queue (1000px)** — header "תור סנכרון · 6 פריטים" with `k-btn` "עצור הכל" and filter chips (הכל · מייבא · דוחף · שגיאה); rows `28px 1fr 140px 200px 120px`: state icon, title + connector, direction chip (📥 ייבוא / 📤 דחיפה), progress (`processing` row shows a 62% bar "מעבד פסקאות 12/19"), actions ("נסה שוב" on the error row with the error text "401 — סיסמת האפליקציה פגה", "ממתין לסקירה" link on the imported row). Bottom line: "הצעות מוכנות לסקירה: 5 · <u>פתח מסמכי מקור</u>".
- **4d Parity report (1100px)** — table `1fr 150px 150px 130px 120px`: מסמך, WordPress (hash `k-mono` + זמן), הספרייה (גרסה + זמן), מצב pill (green זהה / amber ממתין לייבוא / blue ממתין לדחיפה / red קונפליקט), פעולה (סנכרן / פתח / פתור). 8 rows; header counters "38 קישורים · 33 זהים · 3 ממתינים · 1 דחיפה · 1 קונפליקט"; a "מסמכים ללא קישור: 14 · <u>קשר עכשיו</u>" line.
- **4e Three-way merge (1280×760)** — header "קונפליקט · איטיות גלישה §8 · שני הצדדים השתנו מאז הסנכרון האחרון (12.06 12:48)"; three columns "בסיס (v7)" · "WordPress (עודכן 09:12 · אלון)" · "הספרייה (v8 · ענבר)" each with the paragraph text and word-level marks; under each paragraph a row of `k-btn` "קח מ-WordPress" / "קח מהספרייה"; fourth panel (right side, 300px) "תוצאה ממוזגת" as an editable textarea with the merged text; footer: `k-btn d` "השאר בהמתנה", `k-btn n` "שמור כטיוטה", `k-btn p` "פרסם לשני הצדדים (v9 + עדכון WP)".

- [ ] **Step 3: Write the DCLogic script** (`wizard`, `tested`, `test`; queue rows as a static array if `sc-for` is used).

- [ ] **Step 4: Review** — screenshot as in Task 2 to `design/review/turn4.png`; check that the merge card's three columns don't wrap and URL inputs are LTR.

- [ ] **Step 5: Push with DesignSync** — same three calls as Task 2 Step 5 with `writes: ["wecom KB Turn 4 - Connectors & Sync.dc.html"]`.

- [ ] **Step 6: Commit** — `git add design && git commit -m "design: turn 4 connectors & sync mockups"`.

---

### Task 4: Turn 5 — Connected data (5a–5e)

**Files:**
- Create: `design/wecom KB Turn 5 - Connected Data.dc.html`
- Screenshot: `design/review/turn5.png`

**Interfaces:**
- Produces: reference for L4 `/data`, `/graph`, `/fields/:name`, `/blocks/:id`, `/dashboards`; node types documents/blocks/fields/sources, edge types exactly `next, prerequisite, shares_block, same_field, derived_from_source, related, link`.

**QOL checklist:** data explorer with file list (kind icon, rows, mapped ✓/✗, last import), column→field mapping table with auto-detected suggestions and a sample-row preview, "ייבא מחדש" with dry-run diff counts (+3 · ~2 · −1); graph with legend of node/edge types, filter chips, search-to-focus, hover peek card, selected node side panel "מה נשבר אם אמחק" listing dependents; CRM field page with definition, status timeline, usage table (מסמך · שלב · טקסט), "עדכן את כל ההפניות" dialog preview when renamed; block page with versions, usage, embedded vs referenced distinction, "נתק בכל המסמכים" danger action; dashboards with five tiles and one chart each (bars/lines as plain divs), per-category drill-down.

- [ ] **Step 1: Write option 5b (relationship graph) in full**

```html
<div class="dv-opt" id="5b">
<div class="dv-olabel"><a class="dv-oid" href="#5b">5b</a>Relationship graph — typed edges, filters, hover peek, "what breaks if I delete this"</div>
<div class="dv-card" dir="rtl" style="width:1280px;height:760px;display:grid;grid-template-columns:1fr 320px;background:#F4F5F7">
  <div style="display:flex;flex-direction:column;min-width:0">
    <div class="k-top"><span class="k-crumb">ספרייה <span style="margin:0 8px;color:#C7CBD0">/</span> <b>גרף קשרים</b></span>
      <div style="display:flex;gap:6px;margin-inline-start:16px"><span class="k-chip navy">מסמכים 52</span><span class="k-chip">בלוקים 4</span><span class="k-chip">שדות CRM 14</span><span class="k-chip">מקורות 4</span></div>
      <div class="k-actions"><span class="k-btn" style="min-width:220px;color:#A6ABB0">⌕ מקד לפי שם…</span><span class="k-btn">קטגוריה ▾</span><span class="k-btn">סוג קשר ▾</span><span class="k-btn">ייצוא PNG</span></div></div>
    <div style="position:relative;flex:1;overflow:hidden;background:radial-gradient(circle at 1px 1px,#E2E4E6 1px,transparent 1px);background-size:22px 22px">
      <svg viewBox="0 0 960 660" style="position:absolute;inset:0;width:100%;height:100%">
        <g stroke-width="1.5" fill="none">
          <line x1="480" y1="330" x2="300" y2="200" stroke="#FF3D00"/><line x1="480" y1="330" x2="660" y2="200" stroke="#FF3D00"/><line x1="480" y1="330" x2="700" y2="440" stroke="#1D45B4" stroke-dasharray="4 3"/><line x1="480" y1="330" x2="260" y2="470" stroke="#1A7A4A"/><line x1="480" y1="330" x2="480" y2="560" stroke="#B86A00" stroke-dasharray="2 3"/><line x1="300" y1="200" x2="660" y2="200" stroke="#FF3D00" opacity=".4"/>
        </g>
        <g font-family="IBM Plex Sans Hebrew" font-size="12" text-anchor="middle">
          <circle cx="480" cy="330" r="34" fill="#1F2E3B" stroke="#FF3D00" stroke-width="3"/><text x="480" y="335" fill="#fff">איטיות גלישה</text>
          <circle cx="300" cy="200" r="26" fill="#fff" stroke="#1F2E3B"/><text x="300" y="204" fill="#1F2E3B">אין קליטה</text>
          <circle cx="660" cy="200" r="26" fill="#fff" stroke="#1F2E3B"/><text x="660" y="204" fill="#1F2E3B">אין גלישה בחו"ל</text>
          <rect x="672" y="418" width="56" height="44" rx="8" fill="#FF3D00"/><text x="700" y="444" fill="#fff">⧉ ריענון SIM</text>
          <rect x="226" y="452" width="68" height="36" rx="6" fill="#EBF1FF" stroke="#1D45B4"/><text x="260" y="475" fill="#1D45B4" font-family="IBM Plex Mono" font-size="11">sim block lbl</text>
          <polygon points="480,540 500,560 480,580 460,560" fill="#FFF8EE" stroke="#B86A00"/><text x="480" y="604" fill="#B86A00">§ נהלי תמיכה</text>
        </g>
      </svg>
      <div style="position:absolute;bottom:14px;inset-inline-start:14px;background:#fff;border:1px solid #E2E4E6;border-radius:10px;padding:10px 12px;font-size:11px;display:flex;flex-direction:column;gap:4px">
        <span><i style="display:inline-block;width:18px;height:2px;background:#FF3D00;vertical-align:middle"></i> קישור / הבא</span><span><i style="display:inline-block;width:18px;height:2px;background:#1D45B4;vertical-align:middle;border-top:1px dashed #1D45B4"></i> אותו בלוק</span><span><i style="display:inline-block;width:18px;height:2px;background:#1A7A4A;vertical-align:middle"></i> אותו שדה CRM</span><span><i style="display:inline-block;width:18px;height:2px;background:#B86A00;vertical-align:middle;border-top:1px dotted #B86A00"></i> נגזר ממקור §</span>
      </div>
      <div style="position:absolute;top:120px;inset-inline-start:520px;width:240px;background:#1F2E3B;color:#fff;border-radius:12px;padding:12px 14px;font-size:12px;box-shadow:0 12px 30px rgba(31,46,59,.25)"><div class="k-eyebrow" style="color:#FFB596">ריחוף · אין גלישה בחו"ל</div><div style="font-size:13.5px;font-weight:600;margin-top:4px">חו"ל ונדידה · 8 שלבים · v4</div><div style="color:rgba(255,255,255,.75);margin-top:4px">משתף: ⧉ ריענון SIM (שלב 7) · 2 שדות CRM · נכנס מ־3</div></div>
    </div>
  </div>
  <aside style="background:#fff;border-inline-start:1px solid #E2E4E6;padding:16px 18px;display:flex;flex-direction:column;gap:16px;overflow:hidden">
    <div><div class="k-eyebrow">נבחר</div><div style="font-size:16px;font-weight:700;margin-top:4px">איטיות גלישה / חוסר גלישה</div><div style="font-size:12px;color:#6B7280">תמיכה טכנית · v8 · 15 שלבים</div></div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:12px"><div class="k-card" style="padding:10px 12px"><div class="k-eyebrow">נכנס מ־</div><div style="font-size:18px;font-weight:700">3</div></div><div class="k-card" style="padding:10px 12px"><div class="k-eyebrow">יוצא ל־</div><div style="font-size:18px;font-weight:700">4</div></div></div>
    <div><div class="k-eyebrow" style="margin-bottom:8px">מה נשבר אם אמחק</div>
      <div style="display:flex;flex-direction:column;gap:6px;font-size:12.5px">
        <div style="display:flex;justify-content:space-between;padding:8px 10px;border:1px solid #FFB596;background:#FFF8F5;border-radius:8px"><span>דיבאג נטישה · שלב 2</span><span class="k-chip red">קישור ישבר</span></div>
        <div style="display:flex;justify-content:space-between;padding:8px 10px;border:1px solid #FFB596;background:#FFF8F5;border-radius:8px"><span>בעיות גלישה ברכב · שלב 3</span><span class="k-chip red">קישור ישבר</span></div>
        <div style="display:flex;justify-content:space-between;padding:8px 10px;border:1px solid #E2E4E6;border-radius:8px"><span>WordPress · עמוד 214</span><span class="k-chip amber">יישאר ללא מקור</span></div>
      </div></div>
    <div><div class="k-eyebrow" style="margin-bottom:8px">קשרים לפי סוג</div><div style="display:flex;flex-wrap:wrap;gap:6px"><span class="k-chip">link 4</span><span class="k-chip">shares_block 3</span><span class="k-chip">same_field 6</span><span class="k-chip">derived_from_source 1</span><span class="k-chip">related 3</span></div></div>
    <div style="margin-top:auto;display:flex;gap:6px"><span class="k-btn p" style="flex:1;justify-content:center">פתח מסמך</span><span class="k-btn">פיצול</span></div>
  </aside>
</div></div>
```

- [ ] **Step 2: Add 5a, 5c, 5d, 5e as fully specified cards**

- **5a Data explorer (1280×720)** — left list of files (`topics.json` 38 שורות ✓, `intl-roaming.json` 14 ✓, `crm-fields.json` 14 ⚠ 3 שינויים, `scripts.json` 7 ✓, `agents-scripts.csv` 120 ✗ לא ממופה, "+ העלה JSON/CSV"); main: header with file name, kind chip, "ייבוא אחרון לפני 2 ימים", buttons "ייבא מחדש", "הורד"; mapping table `1fr 160px 1fr 120px` (עמודה בקובץ · דוגמה · שדה בכרטיס ▾ · מצב) with rows `title → כותרת ✓`, `desc → תיאור ✓`, `cat → קטגוריה ✓ (מיפוי ערכים: tech→תמיכה טכנית)`, `wave → גל ✓`, `pri → שכיחות ✓`, `owner → — (לא ממופה) ⚠`; right drawer "הרצה יבשה": "+3 כרטיסים חדשים · ~2 יעודכנו · −1 יוסר (יועבר לסל) · 0 שגיאות" and a `k-btn p` "החל ייבוא".
- **5c CRM field page (1000px)** — title as `k-crm` chip "שירות נדידה" + status `k-chip red` "שונה שם ל-שירותי נדידה"; definition card (נתיב `CRM ↗ שירותים`, סוג בוליאני, בעלים IT, עודכן 11.06); timeline (3 entries: נוצר · שונה שם · —); usage table `1fr 90px 1fr` (מסמך · שלב · הטקסט שמפנה) with 3 rows and the old name highlighted amber; primary action "עדכן את כל ההפניות (3)" opening an inline confirmation box that lists the 3 diffs and "ייצור גרסה חדשה בכל מסמך"; secondary "סמן כפג תוקף".
- **5d Shared block page (1000px)** — header "⧉ ריענון SIM" + "v3 · ענבר ל. · 12.06"; actions list rendered like the article (3 `act` rows); usage split into "מוטמע (3)" and "מפנה (2)" lists with step numbers and per-row "פתח · נתק כאן"; versions strip (v1 · v2 · v3 selected) with diff of the last change (`+ ולחכות 90 שניות`); danger zone "נתק בכל המסמכים (יוצר עותקים) · מחק בלוק".
- **5e Dashboards (1280×760)** — five tiles in a grid: **כיסוי** (donut-ish bars: 23 מסמכים / 29 כרטיסים ללא מסמך / 2 חלקיים, per-category bar list), **רעננות** (bars per category "עודכן ב-30 יום"), **שימוש** (line as 12 stacked divs: צפיות שבועיות; top 5 מסמכים במצב שיחה; "תוצאה נפוצה: ✓ הסתדר 61%"), **צינור הצעות** (funnel: 14 נוצרו · 9 אושרו · 3 נדחו · 2 ממתינות; זמן ממוצע לסקירה 1.4 ימים), **סנכרון** (38 קישורים, 33 זהים, 1 קונפליקט, sparkline of runs); header with period chips (7 ימים · 30 · 90) and category filter; every tile has a "פתח רשימה" link.

- [ ] **Step 3: Write the DCLogic script** — static data only (no interactivity required for this turn); `renderVals()` returns `{}`.

- [ ] **Step 4: Review** — screenshot to `design/review/turn5.png`; check SVG labels don't clip, mono chips are LTR, dashboards tile grid fits 1280px.

- [ ] **Step 5: Push with DesignSync** — same three calls with `writes: ["wecom KB Turn 5 - Connected Data.dc.html"]`.

- [ ] **Step 6: Commit** — `git add design && git commit -m "design: turn 5 connected data mockups"`.

---

### Task 5: Turn 6 — QOL pass on existing screens (6a–6h)

**Files:**
- Create: `design/wecom KB Turn 6 - QOL.dc.html`
- Screenshot: `design/review/turn6.png`

**Interfaces:**
- Produces: reference for L4 improvements to Library, Article, Editor, global chrome (notification center, onboarding, palette actions), accessibility states, mobile layouts, dark variants; keyboard names consistent with `KB.KEYMAP` in `legacy/js/nav.js` (`Ctrl K`, `Ctrl D`, `Ctrl \`, `Alt T`, `G`+number, `N`, `P`, `C`, `E`, `H`, `W`, `?`).

**QOL checklist:** *library* — saved views bar ("שלי · חו"ל ממתין לעדכון · חלקיים"), density toggle (נוח / דחוס), list mode with keyboard focus row and `J/K` hints, bulk select with actions (הצמד, שנה גל, ייצא, מחק), "שונה לאחרונה" dot + relative time on cards, sort menu, empty-state with CTA; *article* — presence avatars "אלון צופה · דנה עורכת" in the top bar, inline step comment thread with `@דנה` mention chip and resolve button, "הסבר ללקוח" script picker popover with copy, print/PDF layout card (A4, header/footer, QR to the doc), breadcrumb quick-switch dropdown listing sibling docs; *editor* — multi-select of steps with a floating toolbar (הזז לקבוצה, שכפל, הפוך לבלוק משותף, מחק), undo/redo history strip with named checkpoints, templates gallery dialog (תבנית טכנית 13 שלבים · שימור · חו"ל), side-by-side source paragraph ↔ step mapping panel with drag handles, conflict banner "אלון שמר גרסה חדשה לפני 2 דק׳ · הצג הבדלים · מזג"; *global* — notification center panel (הצעות · סנכרון · אזכורים · מערכת tabs, unread dot, mark-all-read), onboarding tour tooltip (step 2/5 "Ctrl K פותח חיפוש בכל המקורות"), palette actions section ("פתח בלשונית", "הצמד", "העתק קישור", "שלח לסקירה"); *accessibility* — focus ring on a button, a card with reduced-motion note, screen-reader labels shown as `aria-label` tags, contrast pairs listed; *mobile* — library (390px) with bottom nav, article (390px) with sticky outcome bar and step drawer, notifications (390px); *dark* — library card row and notification panel in dark tokens.

- [ ] **Step 1: Write option 6b (article QOL) in full**

```html
<div class="dv-opt" id="6b">
<div class="dv-olabel"><a class="dv-oid" href="#6b">6b</a>Article QOL — presence, inline comments with @mentions, "explain to customer" picker, quick-switch breadcrumb</div>
<div class="dv-card" dir="rtl" style="width:1000px;background:#F4F5F7;display:flex;flex-direction:column">
  <div class="k-top">
    <span class="k-crumb">ספרייה / תמיכה טכנית /</span>
    <span style="position:relative;font-size:12.5px;font-weight:500;display:inline-flex;gap:6px;align-items:center;padding:4px 8px;border-radius:6px;background:#F0F2F4">איטיות גלישה ▾
      <div style="position:absolute;top:110%;inset-inline-start:0;width:260px;background:#fff;border:1px solid #E2E4E6;border-radius:10px;box-shadow:0 12px 30px rgba(31,46,59,.18);padding:6px;font-weight:400;z-index:2">
        <div style="padding:6px 8px;font-size:10.5px;color:#6B7280">מסמכים אחרים בתמיכה טכנית · <span class="k-kbd">↑↓</span></div>
        <div style="padding:8px 10px;border-radius:6px;background:#FFF0EB">אין קליטה / אין שירות</div><div style="padding:8px 10px">לא מצליח להוציא/לקבל שיחות</div><div style="padding:8px 10px">Hotspot לא עובד</div>
      </div></span>
    <div class="k-actions">
      <span style="display:inline-flex;align-items:center;gap:-4px"><span class="k-av g" title="אלון צופה" style="margin-inline-start:-6px;border:2px solid #fff">א</span><span class="k-av r" title="דנה עורכת" style="margin-inline-start:-6px;border:2px solid #fff">ד</span><span style="font-size:11.5px;color:#6B7280;margin-inline-start:8px">אלון צופה · <b style="color:#C02800">דנה עורכת</b></span></span>
      <span class="k-btn">🖨 PDF</span><span class="k-btn">★ הצמד</span><span class="k-btn">✏️ ערוך</span>
    </div>
  </div>
  <div style="padding:20px 24px;display:flex;flex-direction:column;gap:14px">
    <div style="display:flex;gap:14px">
      <div style="width:36px;height:36px;border-radius:50%;background:#FF3D00;color:#fff;font-weight:700;display:grid;place-items:center;flex-shrink:0">8</div>
      <div style="flex:1;background:#fff;border:1.5px solid #FF3D00;border-radius:10px;padding:12px 16px;position:relative">
        <div style="display:flex;align-items:center;gap:8px"><span style="font-weight:600;font-size:14.5px">בדיקת מהירות גלישה</span><span style="font-size:11px;color:#6B7280">רק אם מדובר באיטיות</span><span style="margin-inline-start:auto;display:inline-flex;gap:6px"><span class="k-btn" style="padding:4px 9px;font-size:11.5px">💬 2</span><span onClick="{{ toggleScripts }}" class="k-btn" style="padding:4px 9px;font-size:11.5px">🗣 הסבר ללקוח</span></span></div>
        <div style="margin-top:10px;display:flex;gap:8px;align-items:center;background:#F8F9FB;border:1px solid #E2E4E6;border-radius:6px;padding:8px 12px;font-size:13.5px"><span style="color:#A6ABB0">›</span>בקש מהלקוח להריץ <bdi class="k-mono" style="background:#F0F2F4;padding:1px 6px;border-radius:4px">Speedtest</bdi></div>
        <sc-if value="{{ scriptsOpen }}" hint-placeholder-val="{{ true }}">
        <div style="position:absolute;top:44px;inset-inline-start:16px;width:360px;background:#fff;border:1px solid #E2E4E6;border-radius:12px;box-shadow:0 12px 30px rgba(31,46,59,.18);padding:10px;z-index:3">
          <div class="k-eyebrow" style="padding:4px 6px 8px">תסריטים לשלב זה · scripts.json</div>
          <div style="padding:8px 10px;border-radius:8px;background:#FFF0EB;font-size:12.5px;line-height:1.55">"אני רוצה לבדוק יחד איתך את המהירות בפועל — תוכל להריץ בדיקת מהירות כשאתה מנותק מ-Wi-Fi?"<div style="display:flex;gap:6px;margin-top:6px"><span class="k-btn" style="padding:3px 8px;font-size:11px">העתק</span><span class="k-btn" style="padding:3px 8px;font-size:11px">הקרא</span><span style="margin-inline-start:auto;font-size:10.5px;color:#6B7280">משמש ב-4 מסמכים</span></div></div>
          <div style="padding:8px 10px;font-size:12.5px;color:#6B7280">"אם התוצאה מתחת ל-6 מגה, נעבור לריענון הגלישה מהצד שלנו."</div>
        </div></sc-if>
        <div style="margin-top:12px;border-top:1px dashed #E2E4E6;padding-top:10px;display:flex;flex-direction:column;gap:8px">
          <div style="display:flex;gap:10px;font-size:12.5px"><span class="k-av">ד</span><div style="flex:1;line-height:1.5"><b>דנה ר.</b> <span style="color:#6B7280;font-size:11px">לפני 3 ימים</span><div>Speedtest חוסם ב-Wi-Fi של הלקוח — <span class="k-chip blue">@אלון</span> אפשר להוסיף פעולה לפני?</div></div><span class="k-btn" style="padding:3px 8px;font-size:11px;align-self:flex-start">✓ פתור</span></div>
          <div style="display:flex;gap:10px;font-size:12.5px"><span class="k-av g">א</span><div style="flex:1;line-height:1.5"><b>אלון ר.</b> <span style="color:#6B7280;font-size:11px">אתמול</span><div>נוסף בהצעה ממסמך המקור §4.8 · <a href="#" style="color:#FF3D00">v8</a></div></div></div>
          <div style="display:flex;gap:8px;align-items:center"><span class="k-av r">ע</span><span style="flex:1;border:1px solid #E2E4E6;border-radius:20px;padding:7px 12px;font-size:12.5px;color:#A6ABB0">הערה לשלב… <span class="k-kbd">@</span> לאזכור · <span class="k-kbd">N</span></span></div>
        </div>
      </div>
    </div>
  </div>
</div></div>
```

DCLogic: `state = { scriptsOpen: true }`, `toggleScripts: () => this.setState(s => ({scriptsOpen: !s.scriptsOpen}))`.

- [ ] **Step 2: Add 6a, 6c, 6d, 6e, 6f, 6g, 6h as fully specified cards**

- **6a Library QOL (1280×720)** — saved-views bar under the top bar (chips "כל הספרייה · שלי · חו"ל ממתין לעדכון · חלקיים · + שמור תצוגה"), toolbar right: sort ▾ "לפי שינוי אחרון", density toggle (נוח | דחוס), view toggle (כרטיסים | רשימה); list mode shown: rows `24px 1fr 120px 100px 110px 140px` with the focused row outlined red and `k-kbd` `J/K` hint, "שונה לפני 2 שעות" with a red dot on 2 rows; bulk bar "3 נבחרו · הצמד · שנה גל ▾ · ייצא · מחק"; an empty-state card "אין תוצאות לתצוגה זו · <u>נקה מסננים</u> · ✚ פריט ידע".
- **6c Editor QOL (1280×780)** — top: undo/redo strip "↶ ↷ · נקודות שמירה: 12:40 שלב 8 · 12:52 בלוק · 13:01 עכשיו"; conflict banner (amber) "אלון שמר גרסה חדשה לפני 2 דק׳ · הצג הבדלים · מזג אוטומטית"; two steps selected with a floating toolbar "2 שלבים · הזז לקבוצה ▾ · שכפל · ⧉ הפוך לבלוק משותף · מחק"; right pane replaced by "מיפוי מקור ↔ שלבים": left column source paragraphs (§4.8, §4.9, §4.10 …), right column steps, drag handles `⋮⋮` and a dashed drop target "גרור פסקה לכאן"; templates gallery dialog overlay (3 template cards: "נוהל טכני · 13 שלבים · 2 מסלולים", "שימור · 3 סיבות + סגירה", "חו"ל · מסנן → מברר → הסלמה") with "התחל מתבנית".
- **6d Notification center (420×640)** — panel with tabs (הכל 7 · הצעות 3 · סנכרון 2 · אזכורים 1 · מערכת 1), "סמן הכל כנקרא"; items with icon, title, body, time, unread dot; e.g. "3 הצעות חדשות מ'נהלי תמיכה טכנית' · לפני 14 דק׳", "קונפליקט סנכרון · איטיות גלישה §8 · WordPress", "@ענבר · דנה הזכירה אותך בשלב 8", "גיבוי לילה הצליח · 02:00"; footer "הגדרות התראות".
- **6e Onboarding + palette actions (760px ×2 stacked)** — tour tooltip anchored to a sidebar search trigger: "שלב 2 מתוך 5 · Ctrl K פותח חיפוש בכל המקורות" with "הבא", "דלג על הסיור"; palette card in "פעולות על המסמך הנוכחי" mode listing "פתח בלשונית · הצמד · העתק קישור · שלח לסקירה · ייצא PDF · פיצול מסך · היסטוריה" each with `k-kbd`.
- **6f Accessibility (760px)** — four small panels: focus ring example (`k-focus` on a `k-btn p`), "העדפת תנועה מופחתת: אנימציות הפעימה והמעברים כבויות" with a static pill, screen-reader labels table (`aria-label="הצמד מסמך"`, `role="tab"`, `aria-live="polite"` for toasts), contrast pairs list (טקסט על navy 12.6:1 · red on white 4.6:1 · muted on bg 5.1:1).
- **6g Mobile (three 390px cards side by side)** — library: search field, saved views scroller, single-column cards, bottom nav (ספרייה · חיפוש · התראות 3 · אני); article: sticky top with step "8/15", collapsed steps, sticky outcome bar at the bottom with 2 outcome pills + "הערה", a "שלבים ▾" drawer handle; notifications: list with swipe hint "החלק לסימון כנקרא".
- **6h Dark variants (two cards 640px)** — library list rows and the notification panel with dark tokens (`#151D25` bg, `#1F2A35` surface, `#E8ECF0` text, `rgba(255,255,255,.1)` borders), same content as 6a/6d.

- [ ] **Step 3: Write the DCLogic script** — `scriptsOpen`, `toggleScripts`; static arrays for notifications if `sc-for` is used.

- [ ] **Step 4: Review** — screenshot to `design/review/turn6.png` at 1400 wide and again at `--viewport-size=420,900` for the mobile cards; check bottom bars don't overlap content and dark cards keep 4.5:1 contrast on chips.

- [ ] **Step 5: Push with DesignSync** — same three calls with `writes: ["wecom KB Turn 6 - QOL.dc.html"]`.

- [ ] **Step 6: Commit** — `git add design && git commit -m "design: turn 6 QOL mockups"`.

---

### Task 6: Handoff index for implementing lanes

**Files:**
- Modify: `design/README.md` (append the mapping table)

- [ ] **Step 1: Append a "where each option is implemented" table**

```markdown
## Option → lane / route
| Option | Lane | Route / component |
|---|---|---|
| 3a | L4 + L3 | `/login`, `Login.tsx`, `/auth/providers` |
| 3b–3e | L4 + L3 | `/admin/users`, `/admin/roles`, `/admin/groups-map`, `/admin/sessions` |
| 3f | L4 + L3 | `/admin/audit` |
| 4a–4b | L4 + L6 | `/admin/connectors`, connector wizard |
| 4c–4e | L4 + L6 | `/sync`, `/sync/parity`, `/sync/conflicts/:id` |
| 5a | L4 + L2 | `/data` (sources of kind json/csv, mapping) |
| 5b | L4 + L2 | `/graph` (`GET /documents/:id/links`, `/graph` endpoint added in stage 4) |
| 5c–5d | L4 + L2 | `/fields/:name`, `/blocks/:id` |
| 5e | L4 + L2 | `/dashboards` |
| 6a–6c | L4 | Library, Article, Editor components |
| 6d–6e | L4 | NotificationCenter, Tour, Palette |
| 6f–6h | L4 | global styles, responsive layouts, dark tokens |
```

- [ ] **Step 2: Commit** — `git add design/README.md && git commit -m "design: option to lane mapping"`.

---

## Self-review

- **Spec coverage**: program §5 L7 deliverables (login/identity, admin, connectors & sync queue, data explorer, graph, dashboards, improved existing screens) → Tasks 2, 3, 4, 5; §9 (explorer, graph, field/block pages, dashboards, cross-file links) → Task 4 cards 5a–5e; §10 (users, roles matrix, group map, sessions, audit, system page) → Task 2; the system status page is already implemented in stage 1 and is not re-mocked. User's QOL request → Task 5 checklist (library, article, editor, global, accessibility, mobile, dark).
- **Placeholder scan**: every task has a full card written out (3a, 4b, 5b, 6b) and element-level specs for the rest; push steps carry exact DesignSync calls; no "TBD".
- **Consistency**: option ids `3a–6h` match `design/README.md`; permission strings, edge types, sync states and keyboard names match `packages/shared` and `legacy/js/nav.js`; the helmet CSS class names (`k-*`) are defined once in Task 1 and used in all cards.
