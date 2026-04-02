# Insight Energy Control Room

## Objective
- Upgrade `src/app/(main)/dashboard/page.tsx` without changing the macro layout: left KPI stack, center globe, right stack.
- Make the center globe the primary KPI interaction surface.
- Remove detached 2D Brazil overlays from the dashboard and keep all state layers on the globe.

## Product Principles
- Minimal futuristic enterprise interface.
- Deep glass HUD cards with depth and separation, no grain/noise texture.
- Controlled accent system (emerald/cyan) with restrained glow.
- Unified HUD typography: uppercase labels, tracked micro-labels, tabular numerals for all KPI and chart numbers.

## Globe KPI Layer

### State boundaries on globe
- Render Brazil state polygons directly in `GlobeCanvas` through `StateOverlay`.
- Draw thin boundary stroke and subtle glow halo on state contours.
- Highlight only states with active projects.
- Keep inactive states muted with low opacity fill and low-contrast stroke.
- Block any standalone 2D map component in `/dashboard`.

### Dual activity signals per active state
- Heat glow signal:
- Metric formula: `stateIntensity = 0.45 * revenueNorm + 0.35 * activityNorm + 0.20 * riskNorm`.
- Visual mapping: soft cap gradient plus slight altitude lift.
- Pulse wave signal:
- Expanding ring anchored to state centroid.
- Pulse period driven by activity (`high activity -> faster pulse`).
- Pulse color uses status palette (`healthy`, `attention`, `critical`) with low alpha.

### Project anchor layer
- Add one glowing anchor node per project from `GlobeProjectRecord`.
- Anchors use gentle breathing animation (radius + emissive intensity).
- Nodes are hoverable and clickable.
- Hover shows compact project tooltip.
- Click selects project and syncs drawer/router context.

### Operational-only logistics arcs
- Render curved arcs only when `mode="operacional"`.
- Arc source is an operations hub list; target is project anchors.
- Keep arc style discreet (thin, low opacity, low animation speed).

## Interaction Model

### Hover
- State hover returns: state name, project count, forecast vs actual delta, risk score, last update.
- Project hover returns: project name, UF, health status, contract value, next milestone.
- Hover latency target: under 60ms perceived response.

### Click and camera
- Click state from global view:
- Camera flight to state centroid with eased transition (800ms to 1200ms).
- Set `scopeMode="state"` and update both side stacks.
- Open state drawer without waiting for flight completion.
- Click project anchor:
- Keep globe context, focus node with slight zoom, open project preview block in drawer.
- Background click or back action:
- Return to Brazil focus and clear selection.

### Drawer behavior
- Replace detached overlay behavior with `StateDrawer` anchored to the right.
- Drawer sections: state KPIs, active project list, finance mini-summary, CTA row.
- Primary CTA: `Open Projects`.
- Secondary CTA: `Open Project Detail` when a project is selected.

## Routing Contract To Projects
- Canonical deep-link:
- `/projetos?state=UF&projectId=ID&from=dashboard`
- Compatibility alias:
- `/projects?state=UF&projectId=ID` rewrites to `/projetos`.
- State-level CTA:
- `router.push('/projetos?state=SP&from=dashboard')`
- Project-level CTA:
- `router.push('/projetos/proj-001?state=SP&from=dashboard')`
- Preserve `state` filter on all dashboard-origin project navigations.

## Finance Snapshot Redesign
- Replace progress-bar style visuals in `LeftHudStack` finance card with three compact charts.
- Monthly Revenue chart:
- Bars for actual revenue.
- Line for forecast.
- Delta marker for variance (`Δ`) at the current month.
- Expense/Burn chart:
- Line or area series for monthly burn.
- Horizontal run-rate indicator with current pace label.
- S-curve chart:
- Cumulative forecast vs cumulative actual.
- Gap shading between curves.
- Optional drilldown:
- Collapsible compact waterfall (`Revenue -> Costs -> Margin/EBITDA`), hidden by default.

## Visual Spec For Deep Glass HUD
- Card shell:
- Outer 1px border.
- Inner 1px stroke.
- Top specular gradient highlight.
- Long soft shadow to separate cards from globe.
- No grain/noise overlays on glass surfaces.
- Typography:
- One HUD font stack across panels/menus.
- Uppercase micro-labels with tracking.
- `tabular-nums` on all numeric components.
- Motion:
- Small purposeful transitions only (hover intensification, pulse, drawer slide).
- Avoid excessive neon glows or noisy animation loops.

## Next.js Component Plan

### Extend existing
- `src/components/dashboard/ControlCanvas.tsx`
- Add `mode` pass-through and state/project selection orchestration.
- Bind `onProjectOpen` and `onStateContextChange` to drawer and router.
- `src/components/globe/GlobeCanvas.tsx`
- Orchestrate state overlay, pulse, project anchors, optional flow arcs.
- Expose callbacks: `onStateSelect`, `onProjectSelect`, `onProjectOpen`.
- `src/components/globe/StateOverlay.tsx`
- Render active-only emphasis and state boundary glow.
- `src/components/globe/HotspotLayer.tsx`
- Keep pulse waves and tie frequency/intensity to activity.
- `src/components/dashboard/LeftHudStack.tsx`
- Replace finance progress bars with compact chart suite component.

### New components
- `src/components/globe/ProjectAnchorLayer.tsx`
- Project nodes, hover/click handlers, breathing animation.
- `src/components/globe/StateTooltipHud.tsx`
- Typed tooltip component for state hover.
- `src/components/globe/ProjectTooltipHud.tsx`
- Typed tooltip component for project hover.
- `src/components/globe/FlowArcLayer.tsx`
- Logistics arcs rendered only in operational mode.
- `src/components/globe/StateDrawer.tsx`
- Right-side drawer with scoped KPIs, project list, finance summary, CTAs.
- `src/components/dashboard/finance/FinanceSnapshotCharts.tsx`
- Revenue combo, burn chart, s-curve, optional waterfall drilldown.

## Data Contracts
- Extend `StateAggregate` with:
- `forecastRevenue`, `actualRevenue`, `riskScore`, `activityScore`, `eventCount24h`.
- Keep `GlobeProjectRecord` as project-level source of truth:
- `lat`, `lon`, `status`, `contractTotal`, `invoiced`, `toInvoice`, `riskCount`, `updatedAt`.
- Compute visual intensity from raw values; apply formatting only in UI components.

## Delivery Sequence
- Phase 1: globe layer parity and removal of detached 2D overlay.
- Phase 2: project anchor interactions + drawer + routing.
- Phase 3: finance chart replacement in left stack.
- Phase 4: polish glass depth, typography consistency, and motion tuning.

## Acceptance Criteria
- `/dashboard` has no detached 2D Brazil overlay.
- State boundaries and overlays render only on the globe.
- Active states show both heat and pulse activity signals.
- Each project is represented by a clickable anchor node.
- State and project hover/click interactions work on desktop and mobile.
- Finance Snapshot uses chart visuals instead of long progress bars.
- Projects routing preserves `state` and `projectId` context from dashboard actions.
