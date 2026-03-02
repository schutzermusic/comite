# Finance Overview — Redesign Specification

**Version:** 1.0
**Date:** 2026-03-02
**Author:** Senior Product Design / UX Architecture
**Status:** Draft — Pending Engineering Review

---

## Assumptions

1. **Currency:** All values in BRL (R$). Amounts stored as `amount_cents` (integer).
2. **Periods:** Monthly granularity (`period_key: YYYY-MM`). Default view = current month vs. prior month.
3. **Data availability:** Mock ledger with 6 months is available. Some projects may have zero COGS entries (margin = 100 %) — this must be treated as data-quality issue, not a real margin.
4. **Approval workflow:** `draft → in_review → approved → posted → reconciled`. Only `in_review` items appear in the action queue.
5. **Budget vs. Actual:** Budget data exists per category/period via `entry_type: 'budget'`. Variance = Actual − Budget.
6. **Above the fold:** Assumed viewport ≥ 1440 × 900 px (typical enterprise laptop). "Above the fold" = first ~800 px of vertical space.
7. **Navigation:** Left sidebar already provides sub-page links (Ledger, AP/AR, Payroll, etc.). The Overview page does NOT need to replicate navigation — it is a **command surface**, not a landing page.
8. **Source system:** `source_system` field (`manual | sankhya | payroll_alloc | other`) will be used in data-quality indicators.
9. **Existing component library:** HudPanel, HudTable, HudStatusPill, HudDrawer, HudFilterBar, HudHeader, HudEmptyState are available and should be reused.
10. **No new dependencies.** ECharts is already in use and will remain the charting library.

---

## 1. Layout Proposals

### Grid System

All layouts use a **12-column CSS grid** with:
- Column gap: `24px`
- Row gap: `20px`
- Max-width: `1800px` (already enforced by `HudPageLayout`)
- Side padding: `32px` (existing)

### Option A — "Executive Strip" (Recommended)

**Why this reduces the "AI template" look:**
The top row of 6 floating KPI cards is the single most recognizable pattern of template dashboards. Replacing them with a single, unbroken horizontal strip — no card borders, no icons, no individual glow boxes — immediately signals "purpose-built tool." The strip reads like a cockpit instrument bar: dense, scannable, subordinate to the content below.

```
┌──────────────────────────────────────────────────────────────────────┐
│  HEADER (HudHeader): "Financeiro · Visão Geral"  + Period Selector │  48px
├──────────────────────────────────────────────────────────────────────┤
│  EXECUTIVE STRIP  (12 cols)                                         │  56px
│  Revenue │ COGS │ Gross Margin │ OPEX │ Op. Result │ Pending (4)    │
│  R$ 12.4M  R$ 8.1M   34.7%▲     R$ 1.9M  R$ 1.2M   ● 4 items     │
├──────────────────────┬───────────────────────────────────────────────┤
│  P&L WATERFALL       │  APPROVAL / ACTION QUEUE                     │  ~340px
│  (8 cols)            │  (4 cols)                                     │
│  Full waterfall      │  Table: item, R$, SLA, owner, action         │
│  Revenue→Op.Result   │  Sorted by impact desc                       │
├──────────────────────┼───────────────────────────────────────────────┤
│  TOP DRIVERS         │  MARGIN BY PROJECT                           │  ~320px
│  (6 cols)            │  (6 cols)                                     │
│  Variance table      │  Horizontal bar ranking                      │
│  Top 10 contributors │  Top 10 projects by margin %                 │
├──────────────────────┴───────────────────────────────────────────────┤
│  COST COMPOSITION (12 cols)                                         │  ~280px
│  Stacked bar: COGS + OPEX + Financial + Taxes (NO revenue)          │
│  Monthly trend, 6-month window                                      │
├──────────────────────────────────────────────────────────────────────┤
│  DATA QUALITY BAR (12 cols)                                         │  40px
│  Inline indicators: % uncategorized · % missing project · evidence  │
└──────────────────────────────────────────────────────────────────────┘
```

**Placement summary:**

| Row | Component              | Cols     | Approx Height |
|-----|------------------------|----------|---------------|
| 0   | HudHeader              | 12       | 48px          |
| 1   | Executive Strip        | 12       | 56px          |
| 2L  | P&L Waterfall          | 8        | 340px         |
| 2R  | Approval Queue         | 4        | 340px         |
| 3L  | Top Drivers            | 6        | 320px         |
| 3R  | Margin by Project      | 6        | 320px         |
| 4   | Cost Composition       | 12       | 280px         |
| 5   | Data Quality Bar       | 12       | 40px          |

**Above the fold (800px):** Header + Executive Strip + P&L Waterfall + Approval Queue are all visible. The user sees the P&L shape AND the action queue without scrolling.

---

### Option B — "DRE-First Header"

**Why this reduces the "AI template" look:**
Instead of any metric summary, the page opens directly with the P&L table as the dominant header element — full width, compact rows, no chrome. This is how a CFO's spreadsheet works: numbers first, decoration never. The P&L IS the executive summary.

```
┌──────────────────────────────────────────────────────────────────────┐
│  HEADER: "Financeiro · Visão Geral"  + Period Selector              │  48px
├──────────────────────────────────────────────────────────────────────┤
│  DRE / P&L TABLE — FULL WIDTH (12 cols)                             │  ~220px
│  ┌────────────────┬──────────┬──────────┬──────────┬───────────┐    │
│  │ Line Item      │  Actual  │  Budget  │  Var R$  │  Var %    │    │
│  │ A. Revenue     │ 12.4M    │ 11.8M    │  +600k   │  +5.1%   │    │
│  │ B. COGS        │ (8.1M)   │ (7.9M)   │  (200k)  │  -2.5%   │    │
│  │   Gross Margin │  4.3M    │  3.9M    │  +400k   │  +10.3%  │    │
│  │ C. OPEX        │ (1.9M)   │ (2.0M)   │  +100k   │  +5.0%   │    │
│  │ D. Financial   │ (320k)   │ (280k)   │  (40k)   │  -14.3%  │    │
│  │ E. Taxes       │ (860k)   │ (800k)   │  (60k)   │  -7.5%   │    │
│  │   Op. Result   │  1.22M   │  820k    │  +400k   │  +48.8%  │    │
│  └────────────────┴──────────┴──────────┴──────────┴───────────┘    │
├──────────────────────┬───────────────────────────────────────────────┤
│  APPROVAL QUEUE      │  P&L WATERFALL (visual)                      │  ~300px
│  (4 cols)            │  (8 cols)                                     │
├──────────────────────┼──────────────────────────────────────────────┤
│  TOP DRIVERS         │  MARGIN BY PROJECT                           │  ~320px
│  (6 cols)            │  (6 cols)                                     │
├──────────────────────┴───────────────────────────────────────────────┤
│  COST COMPOSITION (12 cols)                                         │  ~280px
├──────────────────────────────────────────────────────────────────────┤
│  DATA QUALITY BAR (12 cols)                                         │  40px
└──────────────────────────────────────────────────────────────────────┘
```

| Row | Component              | Cols     | Approx Height |
|-----|------------------------|----------|---------------|
| 0   | HudHeader              | 12       | 48px          |
| 1   | DRE / P&L Table        | 12       | 220px         |
| 2L  | Approval Queue         | 4        | 300px         |
| 2R  | P&L Waterfall (chart)  | 8        | 300px         |
| 3L  | Top Drivers            | 6        | 320px         |
| 3R  | Margin by Project      | 6        | 320px         |
| 4   | Cost Composition       | 12       | 280px         |
| 5   | Data Quality Bar       | 12       | 40px          |

**Above the fold:** Header + full P&L table + Approval Queue + Waterfall chart.

**Trade-off vs. Option A:**
- Pro: The P&L is THE most important artifact for a CFO. Leading with it is the correct information hierarchy.
- Con: It consumes ~220px of vertical space before any visualization, making the page feel more "spreadsheet" than "command center" if the user is not a finance executive. The P&L table also appears redundant with the waterfall chart unless they serve clearly different purposes (table = precision, chart = shape/trend).

**Recommendation:** Option A (Executive Strip) for the default overview page. The full P&L table should be accessible via a single click on any metric in the strip (opens the DRE drawer or navigates to a DRE detail view). This keeps the overview as a true command surface — scannable at a glance — while preserving the ability to "pull up the spreadsheet" instantly.

---

## 2. Component Specifications

### 2.1 Executive Strip

**Title:** (none — frameless, no panel header)
**Purpose:** Replace the 6 KPI cards with a single dense horizontal bar. Provides the same 6 data points but without card/widget chrome.
**Location:** Row 1, span 12 columns, height 56px.

**Key Metrics (left to right, separated by 1px vertical dividers):**

| Metric         | Source                                      | Format          | Color Logic                                                |
|----------------|---------------------------------------------|-----------------|------------------------------------------------------------|
| Net Revenue    | Sum of `group=revenue` actuals              | `R$ 12.4M`     | Always `orion-text-primary` (white-green)                  |
| COGS           | Sum of `group=cogs` actuals (absolute)      | `R$ 8.1M`      | Always `text-amber-400`                                    |
| Gross Margin % | `(revenue + cogs) / revenue × 100`         | `34.7%`         | ≥30 % = emerald-400, 15–30 % = amber-400, <15 % = red-400 |
| OPEX           | Sum of `group=opex` actuals (absolute)      | `R$ 1.9M`      | Always `text-indigo-400`                                   |
| Op. Result     | Revenue + COGS + OPEX + Financial + Taxes   | `R$ 1.2M`      | Positive = emerald-400, negative = red-400                 |
| Pending Actions| Count of entries with `status=in_review`    | `4 itens`       | 0 = emerald-400, 1–5 = amber-400, >5 = red-400            |

Each metric shows:
- **Label:** 10px uppercase, `orion-label` class, letter-spacing 0.08em, `text-[var(--orion-text-tertiary)]`.
- **Value:** 20px tabular-nums, `font-semibold`, color per table above.
- **Delta:** 10px, inline after value, `↑ 5.1%` or `↓ 2.3%`, emerald for favorable, red for unfavorable.

**Separator:** 1px solid `rgba(200, 220, 235, 0.09)` (same as `cr-glass-panel` border color). No glow, no gradient.

**Background:** Single continuous `cr-glass-panel` — ONE panel, not six. No individual card borders.

**Default Filters:** Current `period_key` from the period selector in the header.

**Interaction Model:**
- Clicking any metric opens a **Drawer** (HudDrawer, right side, 560px width) with:
  - Title = metric label (e.g., "Receita Líquida — Jan 2026")
  - Filtered LedgerEntry table: entries matching the relevant category group, period, status=approved|posted|reconciled.
  - Columns: Date, Description, Project, Category (L3), Amount, Status.
  - Footer: total sum, entry count.
- Clicking "Pending Actions" scrolls to the Approval Queue panel (smooth scroll, no drawer).

**Empty State:** If no ledger entries exist for the selected period:
```
Strip shows all values as "—" with label "Sem dados para o período selecionado."
```

---

### 2.2 P&L Waterfall

**Title:** "DRE — Cascata"
**Purpose:** Visualize the flow from Revenue to Operating Result, making it immediately clear where value is created and destroyed.
**Location:** Row 2, cols 1–8, height ~340px.

**Chart Type:** Waterfall bar chart (ECharts).

**Bars (left to right):**

| Bar             | Value                     | Color           | Direction  |
|-----------------|---------------------------|-----------------|------------|
| Receita         | Sum revenue actuals       | `emerald-500`   | Positive   |
| COGS            | Sum COGS actuals (neg)    | `amber-500`     | Decrease   |
| Margem Bruta    | Revenue + COGS            | `emerald-400`   | Subtotal   |
| OPEX            | Sum OPEX actuals (neg)    | `indigo-500`    | Decrease   |
| Financeiro      | Sum financial actuals     | `pink-500`      | Decrease   |
| Tributos        | Sum taxes actuals (neg)   | `red-500`       | Decrease   |
| Resultado Op.   | Final sum                 | `cyan-400`      | Total      |

**Visual rules:**
- Subtotal bars (Margem Bruta, Resultado Op.) use a slightly lighter shade and a dashed top connector.
- Each bar label shows value in `formatCompactBRL`. No axis labels on Y — the bars ARE the labels.
- X-axis: category names. No grid lines. Minimal chrome.
- Bar width: 40px. Gap: 20px. Total chart area: ~480px wide within the 8-col panel.

**Default Filters:** Current period from header selector.

**Interaction Model:**
- Clicking any bar opens a **Drawer** with filtered LedgerEntry table:
  - Filters applied: `period_key`, `category.group` matching the clicked bar.
  - For "Margem Bruta" and "Resultado Op." (subtotals), show ALL entries (revenue + relevant cost groups).
- Hover tooltip: `"COGS: R$ 8.1M (65.3% da Receita) | Budget: R$ 7.9M | Var: -R$ 200k (-2.5%)"`.

**Empty State:**
```
"Nenhum lançamento aprovado para o período selecionado.
Acesse Lançamentos para registrar as movimentações do mês."
[Button: "Ir para Lançamentos →"]
```

---

### 2.3 Approval / Action Queue

**Title:** "Fila de Aprovação"
**Purpose:** Surface pending items that require human action, ranked by financial impact. This panel ensures governance visibility — the user should never need to hunt for items awaiting approval.
**Location:** Row 2, cols 9–12, height ~340px.

**Table Columns:**

| Column      | Width  | Content                                                        |
|-------------|--------|----------------------------------------------------------------|
| Description | flex   | Entry description, truncated with tooltip. Below: category L2. |
| Impact R$   | 100px  | `formatCompactBRL(amount_cents)`. Bold.                        |
| Aging       | 72px   | Days since `created_at`. Color: ≤3d = neutral, 4–7d = amber, >7d = red. |
| Owner       | 80px   | `created_by` initials in avatar circle.                        |
| Action      | 64px   | "Revisar" button (HudButton, size=xs, variant=glass).         |

**Sorting:** Default: descending by `amount_cents` (highest impact first).

**Max visible rows:** 6 (with scroll if more). Show total count in panel header: "Fila de Aprovação (12)".

**Default Filters:** `status = 'in_review'`, ordered by `amount_cents DESC`.

**Interaction Model:**
- Clicking "Revisar" opens the HudDrawer with the full LedgerEntry detail (same drawer used by the Ledger Entries page).
- Clicking the row (anywhere except the button) opens the same drawer.
- Drawer must show: all entry fields, evidence attachment status, approval history, and approve/reject actions.

**Empty State:**
```
"Nenhum item pendente de aprovação.
Todos os lançamentos do período foram revisados."
[Icon: ✓ circle, emerald-400]
```

**SLA Indicator:**
- Panel header includes a micro-badge: `"SLA: 2 itens > 7 dias"` in red if any items exceed 7 days aging. Hidden if all items are ≤ 7 days.

---

### 2.4 Top Drivers (Variance Contributors)

**Title:** "Maiores Variações"
**Purpose:** Answer "why is this month different from budget?" by showing the top 10 line items (by category or project) contributing most to the total variance.
**Location:** Row 3, cols 1–6, height ~320px.

**Table Columns:**

| Column        | Width  | Content                                                              |
|---------------|--------|----------------------------------------------------------------------|
| #             | 28px   | Rank number (1–10).                                                  |
| Category      | flex   | Category L2 name. Below (small): L1 group tag (e.g., "B. COGS").    |
| Project       | 120px  | Project name or "Corporativo" if no project. Truncated.              |
| Var R$        | 100px  | Absolute variance (actual − budget). Positive = over-budget (red), negative = under-budget (emerald). |
| Var %         | 64px   | Percentage variance. Same color logic.                               |
| Contrib %     | 64px   | This item's share of total absolute variance.                        |

**Sorting:** Descending by absolute `Var R$`.

**Default Filters:** Current period. Only categories where `|actual − budget| > 0`.

**Interaction Model:**
- Clicking a row opens a **Drawer** with:
  - Title: category L2 name + period
  - Filtered LedgerEntry table: entries matching `category_id` (and `project_id` if applicable), current `period_key`.
  - Summary line at top: Actual vs. Budget vs. Variance.
- A toggle in the panel header switches between "Por Categoria" and "Por Projeto" views.

**Empty State:**
```
"Sem dados de orçamento para o período selecionado.
Importe o orçamento ou registre lançamentos do tipo 'budget' para visualizar variações."
```

---

### 2.5 Margin by Project

**Title:** "Margem por Projeto"
**Purpose:** Rank active projects by gross margin percentage, enabling quick identification of underperforming contracts.
**Location:** Row 3, cols 7–12, height ~320px.

**Chart Type:** Horizontal bar chart.

**Bars:** Top 10 projects, sorted descending by margin %.

**Bar Labels:**
- Left: Project name (truncated at 24 chars).
- Right (inside bar or outside if bar is short): margin % value.

**Color Logic:**
- Margin ≥ 30%: `emerald-500`
- Margin 15–30%: `amber-500`
- Margin < 15%: `red-500`
- Margin negative: `red-600` with striped/hatched pattern.

**Default Filters:** Current period. Only projects with at least one revenue AND one COGS entry.

**Interaction Model:**
- Clicking a bar opens the **Financial Dossier** drawer (see Section 4, Drill-Down Standard).
- Hover tooltip: `"Projeto Alpha | Receita: R$ 2.1M | COGS: R$ 1.4M | Margem: 33.3% | Var vs. Budget: +2.1 pp"`.

**Empty/Insufficient Data State:**
```
"Dados insuficientes para calcular margens por projeto.

Para que este painel funcione, cada projeto precisa de:
  • Pelo menos 1 lançamento de receita (grupo A)
  • Pelo menos 1 lançamento de custo direto (grupo B)

Projetos sem ambos os lançamentos não aparecem no ranking."
```

**Data Quality Warning (inline):**
If any project has revenue but zero COGS, show a yellow warning bar at the bottom of the panel:
```
"⚠ 3 projetos têm receita sem COGS registrado — margem pode estar inflada."
```

---

### 2.6 Cost Composition

**Title:** "Composição de Custos"
**Purpose:** Show the cost structure over time (monthly), broken down by P&L group. Revenue is explicitly excluded to avoid the common mistake of stacking revenue with costs (which distorts proportions).
**Location:** Row 4, span 12 columns, height ~280px.

**Chart Type:** Stacked bar chart (ECharts), one bar per month.

**Series (bottom to top):**

| Series     | Color          | Source                      |
|------------|----------------|-----------------------------|
| COGS       | `amber-500`    | Sum of group=cogs           |
| OPEX       | `indigo-500`   | Sum of group=opex           |
| Financial  | `pink-500`     | Sum of group=financial      |
| Taxes      | `red-500`      | Sum of group=taxes          |

**Axes:**
- X-axis: Month labels (`Jan`, `Fev`, `Mar`, ...). Show 6 months.
- Y-axis: `formatCompactBRL`. Light grid lines at `rgba(255,255,255,0.04)`.

**Default Filters:** Last 6 months from current period.

**Interaction Model:**
- Clicking a bar segment (specific series + month) opens a **Drawer** with:
  - Title: `"COGS — Mar 2026"`
  - Filtered LedgerEntry table: `category.group` + `period_key`.
- Legend items are toggleable (click to show/hide a series). Standard ECharts behavior.

**Empty State:**
```
"Nenhum lançamento de custo encontrado nos últimos 6 meses.
Verifique os filtros ou acesse Lançamentos para registrar custos."
```

---

### 2.7 Data Quality Bar

**Title:** (none — inline, no panel header)
**Purpose:** Persistent, unobtrusive indicator of data health. Alerts the user when data quality issues could affect the reliability of the dashboards above.
**Location:** Row 5, span 12 columns, height 40px.

**Layout:** Single horizontal bar with 4 metrics separated by `·` (middle dot).

**Metrics:**

| Metric                  | Source                                                  | Display                   | Alert Threshold  |
|-------------------------|---------------------------------------------------------|---------------------------|------------------|
| % Uncategorized         | Entries where `category_id` is null or unmapped         | `"2.1% sem categoria"`    | > 0% = yellow    |
| % Missing Project       | Revenue/COGS entries where `project_id` is null         | `"4 itens sem projeto"`   | > 0 = yellow     |
| Pending Evidence        | Entries where `evidence_required && !evidence_provided` | `"7 sem evidência"`       | > 0 = yellow     |
| Stale Drafts            | Entries with `status=draft` and `created_at > 7 days`  | `"2 rascunhos > 7d"`      | > 0 = amber      |

**Visual:**
- Background: `rgba(0,0,0,0.2)` — slightly recessed, no panel chrome.
- Text: `orion-text-tertiary` for metric labels, value color = emerald if clean, amber/red if alerting.
- Status dot (4px circle) before each metric: emerald = clean, amber = warning, red = critical.

**Interaction Model:**
- Clicking any metric opens a **Drawer** with a filtered table of the offending entries.
  - E.g., clicking "4 itens sem projeto" opens a table of entries where `project_id IS NULL` and `category.group IN ('revenue', 'cogs')`.

**Empty State:** When all metrics are green:
```
"✓ Qualidade de dados OK para o período selecionado."
(All dots emerald, text emerald.)
```

---

## 3. Visual System Guidelines

### 3.1 Typography Hierarchy

| Level    | Element             | Size   | Weight     | Font Feature     | Color                          | Example               |
|----------|---------------------|--------|------------|------------------|--------------------------------|------------------------|
| T1       | Page title          | 18px   | 600        | —                | `--orion-text-primary`         | "Financeiro"           |
| T2       | Panel title         | 11px   | 600        | uppercase, 0.08em tracking | `--orion-text-secondary` | "DRE — CASCATA"      |
| T3       | Metric value (strip)| 20px   | 600        | `tabular-nums`   | Contextual (see strip spec)    | "R$ 12.4M"            |
| T4       | Metric value (table)| 13px   | 500        | `tabular-nums`   | `--orion-text-primary`         | "R$ 1.234.567,89"     |
| T5       | Metric label        | 10px   | 500        | uppercase, 0.08em tracking | `--orion-text-tertiary` | "RECEITA LÍQUIDA"    |
| T6       | Delta / variance    | 10px   | 500        | `tabular-nums`   | emerald-400 or red-400         | "↑ 5.1%"             |
| T7       | Table body text     | 12px   | 400        | —                | `--orion-text-secondary`       | "Contrato Petrobras"  |
| T8       | Micro text / captions| 10px  | 400        | —                | `--orion-text-muted`           | "Atualizado há 2h"    |

**Rules:**
- ALL numeric displays use `font-variant-numeric: tabular-nums` for column alignment.
- Negative values are displayed with parentheses in tables: `(R$ 8.1M)`. In charts/strips, use the bar direction or color (never a minus sign alone).
- Deltas always show direction arrow (`↑` or `↓`) before the number. Do NOT use TrendingUp/TrendingDown Lucide icons for inline deltas — they are too large and add visual noise.
- Panel titles are UPPERCASE with letter-spacing. Body text is never uppercase.

### 3.2 Separators Instead of Cards

**Rule:** Do not wrap individual metrics or data points in their own bordered container. Instead, use:

| Separator Type        | CSS                                                   | Use Case                          |
|-----------------------|-------------------------------------------------------|-----------------------------------|
| Vertical divider      | `1px solid rgba(200, 220, 235, 0.09)`                | Between metrics in the Executive Strip |
| Horizontal rule       | `1px solid rgba(200, 220, 235, 0.06)`, full width    | Between table sections (e.g., subtotals) |
| Row zebra             | Alternate rows at `rgba(255, 255, 255, 0.02)`        | Tables with > 5 rows              |
| Section gap           | `20px` vertical margin, no line                       | Between major page sections        |

**Anti-patterns to avoid:**
- Individual `cr-glass-panel` around each KPI metric.
- `border-radius > 8px` on inner elements (only the outer panel gets 14px radius).
- Glow/shadow on separators.
- Double borders (border + outline) on inner components.

### 3.3 Contrast Rules for Dark UI

| Element                  | Minimum Contrast Ratio | Reference Background |
|--------------------------|------------------------|----------------------|
| Primary text             | 7:1 (AAA)             | `#0c1210`            |
| Secondary text           | 4.5:1 (AA)            | `#0c1210`            |
| Tertiary/muted text      | 3:1 (AA large text)   | `#0c1210`            |
| Chart bar fills          | 3:1 vs. adjacent bars | N/A (distinguish by hue, not luminance alone) |
| Interactive elements     | 4.5:1 (AA)            | Panel background     |
| Focus ring               | 3:1 vs. background    | Panel background     |

**Specific rules:**
- Never use `rgba(255,255,255,0.3)` or lower for text — too faint on dark backgrounds.
- Chart tooltips must have a solid background (`#162522` with `border: 1px solid rgba(200,220,235,0.12)`) — never transparent or semi-transparent.
- Status dots (Data Quality Bar) must be ≥ 6px diameter for visibility.

### 3.4 Icon Usage

**Rule:** Minimal. Icons are used ONLY for:

| Use Case              | Icon Source     | Size   | When to Use                                |
|------------------------|-----------------|--------|--------------------------------------------|
| Panel header           | Lucide React    | 14px   | Only if title alone is ambiguous            |
| Status indicators      | Colored dot     | 4–6px  | Data quality, SLA status                    |
| Action buttons         | Lucide React    | 14px   | "Revisar", "Exportar", "Filtrar"            |
| Direction arrows       | Unicode `↑↓`    | inline | Deltas, sort indicators                     |
| Empty state            | Lucide React    | 32px   | One icon per empty state, centered           |

**Anti-patterns:**
- No icons inside KPI values or next to numbers.
- No animated or pulsing icons.
- No icon-only buttons without accessible labels.
- No decorative icons that don't aid comprehension.

### 3.5 Avoiding Generic Dashboard Aesthetics

| Principle                              | Implementation                                                                 |
|----------------------------------------|--------------------------------------------------------------------------------|
| No floating card grid                  | Use one continuous Executive Strip instead of 6 individual cards.              |
| No rounded-corner excess               | Only outer panels get `border-radius: 14px`. Inner elements: `4–8px` max.     |
| No glow borders on inner elements      | Remove `cr-glass-panel-border`, `-specular`, `-inner-stroke` from sub-components. Only the main panel containers use the full glass treatment. |
| No staggered entrance animations       | Use a single `opacity 0→1` transition for the entire page (200ms). No per-card stagger — it screams "template." |
| Dense information layout               | Favor tables and inline metrics over charts when data has < 10 items. Charts are for trends (time series) and distributions (bar rankings). |
| Consistent column alignment            | All monetary columns in tables are right-aligned, same width. All percentage columns are right-aligned, fixed 64px. |
| Subordinate chrome                     | Panel borders, shadows, and backgrounds must be less prominent than the data they contain. If you notice the border before you notice the number, reduce the border. |

---

## 4. Drill-Down Standard (Global Rule)

Every clickable element on the Finance Overview page follows one of three drill-down patterns. The pattern is determined by what the user clicked.

### Pattern A — Metric Drill-Down (Ledger Table)

**Trigger:** Clicking a numeric metric (in the Executive Strip, Waterfall bar, Cost Composition bar segment, Data Quality metric).

**Action:** Opens a `HudDrawer` (right side, 640px width) containing:

| Drawer Section    | Content                                                        |
|-------------------|----------------------------------------------------------------|
| Header            | Metric label + formatted value. Period badge.                  |
| Summary bar       | Actual | Budget | Variance (if budget data exists).            |
| Filtered table    | HudTable with LedgerEntry records matching the applied filters.|
| Footer            | Total sum, row count, "Exportar CSV" button.                   |

**Table Columns:**
`Date | Description | Project | Category L3 | Cost Center | Amount | Status | Source`

**Filters applied (automatically, shown as chips above the table):**

| Filter          | Source                                          |
|-----------------|-------------------------------------------------|
| `period_key`    | From the period selector in the page header.    |
| `category.group`| Derived from the clicked metric (e.g., clicking COGS → group = 'cogs'). |
| `status`        | `['approved', 'posted', 'reconciled']` (excludes drafts/in_review). |
| `entry_type`    | `'actual'` (excludes budget/forecast).          |

**User can modify:** All filters are editable chips. Removing a filter chip broadens the query. Adding filters (project, supplier, cost_center, source_system) is available via a "Add Filter" button.

---

### Pattern B — Project Drill-Down (Financial Dossier)

**Trigger:** Clicking a project name (in the Margin by Project chart, Top Drivers table, or any filtered table row).

**Action:** Opens a `HudDrawer` (right side, 720px width) — wider than Pattern A — containing a project-level financial dossier.

| Dossier Section          | Content                                                                |
|--------------------------|------------------------------------------------------------------------|
| Header                   | Project name + contract reference. Status pill (active/completed).     |
| Mini P&L                 | Compact P&L table (Revenue, COGS, Gross Margin, allocated OPEX if any). Actual vs. Budget. |
| Top Cost Drivers         | Top 5 category-level costs for this project, sorted by amount desc.   |
| Margin Trend             | Sparkline of monthly gross margin % (last 6 months).                   |
| Evidence Status          | Count of entries with/without evidence. Progress bar.                  |
| Pending Approvals        | List of `in_review` entries for this project.                          |
| Recent Transactions      | Last 10 posted entries. "Ver todos" link to Ledger page with project filter pre-applied. |

**Filters applied:**

| Filter          | Value                                           |
|-----------------|-------------------------------------------------|
| `project_id`    | Clicked project's ID.                           |
| `period_key`    | From page header (but Mini P&L shows all periods for comparison). |

---

### Pattern C — Variance Drill-Down (Transaction Set)

**Trigger:** Clicking a row in the Top Drivers table.

**Action:** Opens a `HudDrawer` (right side, 640px width) focused on explaining the variance.

| Drawer Section          | Content                                                               |
|-------------------------|-----------------------------------------------------------------------|
| Header                  | Category L2 name + variance summary (`"B.2 Mobilização: +R$ 120k vs. Budget"`). |
| Breakdown table         | LedgerEntry records filtered to this category + period, showing both `actual` and `budget` entries side by side. |
| Comparison              | Two-column mini-table: `Actual: R$ 320k | Budget: R$ 200k | Var: +R$ 120k (+60%)`. |
| Drill-deeper link       | "Ver por projeto" — re-groups the same entries by `project_id` to show which project drove the variance. |

**Filters applied:**

| Filter           | Value                                      |
|------------------|--------------------------------------------|
| `period_key`     | From page header.                          |
| `category_id`    | All L3 categories under the clicked L2.    |
| `entry_type`     | Both `'actual'` and `'budget'` shown.      |

---

### Filter Chip Behavior (Applies to All Patterns)

- Filters are displayed as removable chips at the top of the drawer.
- Each chip shows: filter name (muted) + value (primary). E.g., `Período: Jan 2026 ×`.
- Removing a chip immediately re-queries and updates the table.
- Available filter dimensions: `period_key`, `project_id`, `category_id`, `cost_center_id`, `supplier_id`, `source_system`, `status`, `entry_type`.
- Filters persist within the drawer session. Closing and reopening resets to the default filters for that drill-down.

---

## 5. Acceptance Criteria (Testable)

### Layout & Structure

| #   | Criterion                                                                                          | Verification Method                        |
|-----|----------------------------------------------------------------------------------------------------|--------------------------------------------|
| L1  | No KPI cards (individual bordered metric boxes) present on the page.                               | Visual inspection. `HudKpiStrip` and `HudKpi` components are NOT imported in the finance overview page. |
| L2  | Executive Strip spans full width (12 cols) as a single container.                                  | DOM inspection: one parent `div` with 6 metric sections inside, separated by CSS borders, not individual panels. |
| L3  | Approval Queue panel is visible above the fold at 1440×900 viewport.                               | Scroll position test: bottom edge of Approval Queue panel < 800px from top. |
| L4  | Approval Queue shows `amount_cents` (formatted as R$) and aging (days) for each item.              | Content inspection of each row.            |

### Drill-Down & Interactivity

| #   | Criterion                                                                                          | Verification Method                        |
|-----|----------------------------------------------------------------------------------------------------|--------------------------------------------|
| D1  | Every numeric metric in the Executive Strip is clickable and opens a drawer with filtered entries.  | Click each of the 5 numeric metrics → drawer opens with correct filter chips. |
| D2  | Every bar in the P&L Waterfall is clickable and opens a drawer.                                    | Click each of the 7 bars → drawer opens, filter chip shows correct `category.group`. |
| D3  | Every bar segment in Cost Composition is clickable and opens a drawer.                             | Click a segment → drawer opens with correct `category.group` + `period_key`. |
| D4  | Every project bar in Margin by Project is clickable and opens a Financial Dossier drawer.          | Click a project → wider drawer opens with Mini P&L, drivers, evidence, transactions. |
| D5  | Every row in Top Drivers is clickable and opens a variance drill-down drawer.                      | Click a row → drawer opens with actual vs. budget comparison.  |
| D6  | Every row in Approval Queue is clickable and opens the entry detail drawer.                        | Click a row → drawer opens with full LedgerEntry detail and approve/reject actions. |
| D7  | User can reach underlying transactions from every panel within exactly 1 click.                    | Automated test: for each panel, simulate one click → assert drawer contains a `HudTable` with `LedgerEntry` data. |

### Data Integrity

| #   | Criterion                                                                                          | Verification Method                        |
|-----|----------------------------------------------------------------------------------------------------|--------------------------------------------|
| I1  | P&L Waterfall final bar ("Resultado Op.") equals the sum in the Executive Strip "Op. Result."      | `expect(waterfallFinalBar.value).toEqual(stripOperatingResult.value)`. |
| I2  | P&L Waterfall bar values match the P&L table row values (when Option B is used or when the DRE drawer is opened). | Cross-reference each bar value with the corresponding P&L row `actual` value. |
| I3  | Cost Composition chart total per month = COGS + OPEX + Financial + Taxes (no revenue included).    | For each month bar, sum series values and compare against `computePnL` output excluding revenue. |

### Data Quality

| #   | Criterion                                                                                          | Verification Method                        |
|-----|----------------------------------------------------------------------------------------------------|--------------------------------------------|
| Q1  | Data Quality Bar is visible on the page (below Cost Composition).                                  | DOM element exists and is in viewport after scrolling. |
| Q2  | Data Quality Bar shows at least: % uncategorized, missing project count, pending evidence count.    | Content inspection: 3+ metrics visible with values. |
| Q3  | Each Data Quality metric is clickable and opens a drawer with the offending entries.                | Click each metric → drawer opens with filtered table showing only problematic entries. |

### Visual / Anti-Pattern

| #   | Criterion                                                                                          | Verification Method                        |
|-----|----------------------------------------------------------------------------------------------------|--------------------------------------------|
| V1  | No `HudKpi` or `HudKpiStrip` component imported or rendered.                                      | Code inspection: `import` statements do not include these components. |
| V2  | No staggered per-card entrance animations. Page fades in as one unit.                              | Visual inspection at page load. No sequential card pop-in effect. |
| V3  | Inner elements (tables, strip metrics) do not have `cr-glass-panel-border`, `-specular`, or `-inner-stroke` classes. | DOM/class inspection on elements inside panels.  |
| V4  | All monetary columns in tables use `text-align: right` and `tabular-nums`.                         | CSS inspection on `<td>` elements containing R$ values. |

---

## Appendix: Period Selector Specification

The period selector in the `HudHeader` controls all panels globally.

- **Component:** `HudSelect` (existing).
- **Options:** Last 12 months as `YYYY-MM` values, displayed as `"Jan 2026"`, `"Dez 2025"`, etc.
- **Default:** Current month.
- **Behavior:** Changing the period re-computes all panels. No partial updates — all data on the page reflects the selected period.
- **Comparison period:** Automatically set to the previous month (for delta calculations in the Executive Strip). Not user-selectable in v1.

---

*End of specification.*
