# wecom KB — design turns

Mockups live in the Claude Design project `wecom KB Redesign` (id `8d3a1b0f-a941-4ceb-add4-7a58dd5a964d`).
Turns 1–2 are the original redesign (`wecom KB Redesign.dc.html`). Turns 3–6 are authored here:

| Local file | Project path (on push) | Turn | Options |
|---|---|---|---|
| `turn3-identity-admin.dc.html` | `wecom KB Turn 3 - Identity & Admin.dc.html` | 3 | 3a login · 3b users · 3c roles matrix · 3d groups→roles · 3e sessions · 3f audit |
| `turn4-connectors-sync.dc.html` | `wecom KB Turn 4 - Connectors & Sync.dc.html` | 4 | 4a registry · 4b WordPress wizard · 4c sync queue · 4d parity report · 4e conflict merge |
| `turn5-connected-data.dc.html` | `wecom KB Turn 5 - Connected Data.dc.html` | 5 | 5a data explorer · 5b graph · 5c CRM field page · 5d block page · 5e dashboards |
| `turn6-qol.dc.html` | `wecom KB Turn 6 - QOL.dc.html` | 6 | 6a library · 6b article · 6c editor · 6d notifications · 6e onboarding+palette · 6f accessibility · 6g mobile · 6h dark variants |

Rules: one `<section class="dv-turn">` per file, option ids `<turn><letter>`, every card `dir="rtl"`, Hebrew copy, tokens from `_helmet.html`.
Interactivity: a `DCLogic` class at the bottom of the file; values are bound with `{{ name }}`, lists with `<sc-for list="{{ items }}" as="x">`, conditions with `<sc-if value="{{ flag }}">`.

## Review locally
`design/support.js` here is a **local review shim only** — it is never pushed; the Claude Design project ships
its own `support.js` runtime. The shim resolves `{{ }}`, `<sc-for>`, `<sc-if>` and `onClick` the same way the
canvas does, so a turn file can be opened outside the canvas and screenshotted.

Serve the folder (Playwright blocks `file:`), then screenshot:

```bash
python3 -m http.server 8791 --bind 127.0.0.1 -d design &
pnpm dlx playwright screenshot --viewport-size=1400,900 --full-page \
  "http://127.0.0.1:8791/turn3-identity-admin.dc.html" design/review/turn3.png
```

Open the PNG; check: no horizontal overflow inside a card, Latin tokens isolated (no flipped "H+ / 3G"),
no clipped Hebrew descenders, contrast of chips on navy. A quick numeric check in the browser console:

```js
[...document.querySelectorAll('.dv-card')].map(c => [c.parentElement.id, c.scrollWidth - c.clientWidth, c.scrollHeight - c.clientHeight])
```
Every pair must be `0, 0`.

## Push
1. `DesignSync list_files { projectId }` — confirm the target path does not already exist unless updating it.
2. `DesignSync finalize_plan { projectId, writes: ["<project path>"], localDir: "design" }` → `planId`.
3. `DesignSync write_files { projectId, planId, files: [{ path: "<project path>", localPath: "<local file>" }] }`.
Never include `support.js`, `wecom KB Redesign.dc.html` or `wecom KB Wireframes.dc.html` in `writes`/`deletes`.

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
