# Dashboard: the globe (APEX FILM prototype style, V1 as the base)

> **Status (2026-09-25).** The user rejected the flat V2 layout, which had no globe and none of the Apex motion. The decision now:
> - the Dashboard is **exactly the interactive prototype's style** (`APEX FILM/prototipo.html`);
> - the **V1 dashboard is the base** (full-bleed Cesium globe + left/right HUD columns);
> - it shows **real data** (the V2 read model).
>
> §1 of `ARCHITECTURE.md` ("the globe leaves the Dashboard") is **revoked**.
>
> The rest of `ARCHITECTURE.md` still applies: RLS gates, "Restrito" never shown as 0, a failed read never looks calm, Entender, and the feed.

**Reference material:**
- **Visual:** the prototype screenshots at 1920×1080 and the motion spec.
- **Code:** `APEX FILM/js/app/app.js`, `js/world/*.js`, `css/app.css`, `css/components.css`, `css/apex.css`. These are **read-only**; do not edit anything in APEX FILM.

## 1. User decisions

| Topic | Decision |
|---|---|
| Portfolio panels | **V1 structure**: left and right columns over the globe, restyled as the prototype's panels, with real data. |
| Globe position | The **official** location (`project_globe_marker`). Otherwise, the **site coordinate from Supply** (`inventory_locations` PROJECT_SITE, active, lat/lng), shown with its source ("Canteiro · cadastro do Supply"). Never a UF centroid, jitter or estimate. More than one site with coordinates means ambiguous, so no point. |
| Actions | **Approve purchase** runs on the Dashboard, with confirmation, through the **same Decisões action** (`POST /api/decisions/[key]/act`, same authority, policy and audit), reusing `ConfirmActDialog` and the `DecisionPanel` logic. **Billing opens Contratos**; no invoice is issued from the Dashboard. |
| Theme | Follows the system. The **globe stays dark**. Panels have a dark variant (the prototype's) and a light one (light glass over a dark globe, with the vignette softened). |

## 2. Stage (layers, bottom to top), inside `<main>`

This follows V1's `.cr-viewport`: `absolute inset-0`, overflow hidden. The sidebar starts collapsed on /dashboard, as it already does today.

```
.dg-backdrop   aurora + grid (static)                      z0
ApexGlobe      Cesium (transparent sky), CesiumWidget       z1
canvas overlay pulses, arcs + particles, state highlight    z2
world labels   DOM pinned to lat/lng (wl-tag, wl-node)      z3
shade+vignette horizon shade by pitch + radial vignette     z4
HUD            top bar, columns / panels, dock, toast       z10
```

Top bar (`.dg-top`, inside the Dashboard, not the app header):
- left: breadcrumb `Portfólio › {Projeto} › {Módulo}`, where each segment returns to that level;
- right: `● OPERAÇÃO AO VIVO` plus the real São Paulo clock `25 SET 2026 · 14:32`, which refreshes every minute; then "Atualizado às HH:mm"; then the Recarregar button.

## 3. Views and camera

Presets are computed from the data; values follow `app.js:38-44`.

| View | Camera | dim | Panels |
|---|---|---|---|
| `portfolio` | Framing that fits every marker: bbox centre, `dist` = max(bbox diagonal × 1.25, 900 km), clamp 900–4500 km, pitch 52, heading −4, ox +200 (desktop, because of the left column), oy +90. With 0 markers: Brazil (−14.235, −54.5), 5200 km, pitch 52. | .16 | **Left column:** Portfolio panel (title = organisation, 2×2 KPIs, list of located operations, "N sem localização"), then "Atenção agora" (compact, 5 rows). **Right column:** Decisões, "Fluxo do negócio" (11 compact stages), "Próximos 30 dias" (next 5). |
| `site` (Visão geral) | Site position, dist 1.4 km (`precision: municipality` → 18 km), pitch 48, heading 58, ox +190, oy +40. Breathing enabled. | .06 | **Left:** "Projeto em foco" panel. **Right:** "Atenção neste local" (the site's feed + Entender) and site Decisões. **Dock** at the bottom. |
| `plan` (Planejar) | Same target, dist 1.6 km (municipality 22), pitch 50, heading 64, ox +40, oy −170 | .42 | **Bottom-left:** Gantt panel. **Right:** "Atividade" panel (needs of the focused activity). |
| `supply` (Supply Chain) | Framing that fits the site plus the stock nodes with coordinates: bbox centre, dist = max(diag × 1.4, 60 km), clamp 60–2400 km, pitch 64, heading −6, ox −20, oy −30 | .22 | **Left:** material balance. **Right:** Apex plan + orders + decision (Aprovar). **Map:** arcs from stock locations to the site, with node cards. |
| `billing` (Faturamento) | Site, dist 9 km, pitch 54, heading 60, ox +90, oy +60 | .38 | **Left:** billing schedule (eventograma). **Right:** chain of the focused event (Entender `bill:`) + "Abrir em Contratos". |

**Flight rules.** Use the film's tween (`contract.ts`):
- start from the **current** camera, even mid-flight;
- panels that leave fade immediately, panels that arrive use `settle(arrive)`;
- enter from −18 px;
- use exponential fades (rate 6).

**Intro.** The first mount plays the film's keyed track (Earth at 28,000 km → Brazil → portfolio view) over about 4.4 s. Under `prefers-reduced-motion` it cuts straight to the view.

**Keyboard:** `Esc` goes back one level; `1`–`4` switch modules when a site is focused; `F` goes fullscreen. No shortcut fires while a field or dialog is focused.

**URL state:**
- `?site=<projectId>&m=overview|plan|supply|billing`: reload lands in the same state, and the back button works.
- `?x=` still opens Entender.

## 4. Real data per panel

Use the contract in `src/lib/dashboard/types.ts`: `sites`, `SiteHud`, `SitePlan*`, `SiteSupply*`, `SiteBilling*`.

**Portfolio: `/api/dashboard/overview` (a single read)**
- **KPIs:**
  - critical projects: `projects.counts.critical`;
  - critical materials: `needs` stage;
  - decisions waiting for you: the header badge / `decisions.count`;
  - to invoice: `faturamento` stage.
  - Restricted means the "Restrito" tile, never 0.
- **List:** `sites.markers`, sorted critical → attention → the rest, then by name. Each row has a hexagon bullet with the tone, the name, `client · UF · canteiro/oficial`, and a status em ("crítico", "atenção", "em dia", "sem cronograma").
- **Map:** one hexagon per marker, coloured by `level` (critical `#EF4B55`, attention `#F5A524`, healthy `#22D3EE`, unknown `ig-tone-neutral`). Pulse is 0.7 on critical and 0.4 on attention. The label of the worst site is always visible.
- **Attention / Decisões / Fluxo / Calendário:** the existing V2 models, restyled.

**Site: `GET /api/dashboard/site/[projectId]`**
- **"Projeto em foco":**
  - eyebrow "PROJETO EM FOCO · {UF}", name, client;
  - chips: OS code, project code, location + source;
  - "ESCOPO" (only when `scope` exists);
  - 2×2 grid:
    - "Fase atual", with a **real** bar;
    - "Próximo marco" + date;
    - "Equipe": allocated, or "Restrito";
    - "Contrato": linked contract(s); the value only with finance;
  - attention card: the site's most serious row + `nextAction`;
  - link "Ver plano do Apex ›", which goes to supply when there is a shortage.
- **Right:** the site's feed (rows with Entender) and site Decisões.

**Planejar: `/plan`**
- **Gantt, in the prototype's grammar:**
  - critical row: amber rail + dashed bar + "CRÍTICA" pill;
  - "Necessário até" line;
  - hatched gap between today and the need date;
  - "Hoje" line;
  - milestone diamond;
  - finish-to-start links;
  - 73.6 % opacity dimming on the rows not in focus.
- **Right panel "Atividade":** window, %, needs (`needsByActivity`) with their status, and "Resolver no Supply Chain ›".

**Supply Chain: `/supply`**
- **Material balance** (prototype rows) from the live coverage: Necessário / Reservado / Consumido / Em trânsito / Pedido / Coberto / Falta, with a lot/coverage bar.
- **Right:**
  - the Apex plan (open `apex` signals with evidence);
  - orders (supplier, status, ETA, "chega N dias depois da necessidade");
  - **the decision**. When there is a `SupplyDecision` in the viewer's inbox, the "Aprovar compra" button (and the other actions the detail returns) opens `ConfirmActDialog` → `POST /api/decisions/[key]/act`, **exactly like `DecisionPanel`**. After success: `notifyChanged()`, then reread `/supply` + the site + the overview. The marker, the HUD and the Gantt react from the server data.
- **Map:** arcs from each `StockNode` with coordinates to the site (tone `hit` when `available > 0`) + `wl-node` cards ("{available} {unit} · {name}").
- **No invented supplier arc.** Suppliers have no coordinates, so they appear only in the list.

**Faturamento: `/billing`**
- The contract's billing schedule (eventograma): rows with state and value (value only with finance).
- The focused event's chain comes from **Entender `bill:<id>`** (explain), drawn as the prototype's stepper (done / wait / pending).
- "Abrir em Contratos" goes to `/contratos?view=faturamento`.

## 5. Responsive, theme, accessibility

**≥ 1180 px:**
- the prototype's layout, with 24 px safe margins;
- left column 420–460 px, right column 380–420 px;
- the dock is centred.

**768–1179 px:**
- the columns get narrower (360/340);
- the right column can collapse into a "Painel" button.

**≤ 767 px (390 px):**
- the globe fills the top 44 vh;
- the HUD becomes a **bottom sheet** stack (scrollable page, no horizontal overflow);
- the dock becomes 44 px tabs;
- camera `ox`/`oy` = 0;
- attention comes first.

**Theme:**
- `html.light` gives light-glass panels (`rgba(255,255,255,.86)` + blur + dark text tokens), a milder vignette, and no aurora;
- the globe and the map labels stay in the dark style;
- the panel shadow is light.

**Accessibility:**
- every marker has a keyboard path (the operations list);
- panels are `section` elements with an `aria-label`;
- the dock is a `tablist`;
- `prefers-reduced-motion` switches to an immediate camera, no pulses or particles or breathing, and opacity-only fades ≤ 150 ms.

## 6. Test ids (QA-live)

| Element | Test id |
|---|---|
| Page root | `dashboard-globe` |
| Globe container | `dg-globe` |
| Portfolio | `dg-portfolio` |
| Attention | `dashboard-attention` |
| Decisões | `dashboard-decisions` |
| Flow | `dashboard-flow` |
| Calendar | `dashboard-calendar` |
| Site | `dg-site` |
| Dock | `dg-dock` |
| Planejar | `dg-plan` |
| Supply Chain | `dg-supply` |
| Faturamento | `dg-billing` |
| Entender | `dashboard-explain` |

There must still be exactly one `header-decisions` element (in the app header) and a visible link named /Decisões/.

## 7. Performance and robustness

- `requestRenderMode` whenever there is no flight, pulse or particle.
- `webglcontextlost` shows a fallback; the HUD keeps working without the globe.
- Guard NaN at the edges: finite `lat`/`lng` within range.
- Marker and entity diffs by id; nothing is recreated on hover.
- Cesium and imagery keep V1's setup (jsDelivr CDN, Esri imagery, local Blue Marble as the base layer).
- Zero console errors on /dashboard (the `dashboard-finite` spec).
