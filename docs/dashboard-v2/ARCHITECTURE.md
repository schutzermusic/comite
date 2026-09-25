# Dashboard V2 — "O que está acontecendo"

Branch `feat/dashboard-experience-v2` (base `feat/global-decisions` @ `95c731d`).
Contract: `src/lib/dashboard/types.ts`. Revised after three independent critiques (product/UX, data honesty/RBAC, feasibility/tests).

## 1. Role in the product

| Surface | Question | Route |
|---|---|---|
| **Dashboard** | "What is happening in the company?" | `/dashboard` |
| Decisões | "What needs me?" | `/decisoes`. The Dashboard only surfaces it: one line, top 3, links. |
| Apex findings | "What did Apex detect?" | `supply_signals` (`/supply?focus=apex`). The Dashboard shows them as evidence inside the rows. |
| Notices | "What happened?" | the bell (notifications) |
| Domains | "Where do I operate and investigate?" | Comercial, Operações, Supply, Contratos, Projetos… |

**How the Dashboard differs from `/operacoes`.** Operações lists record by record inside its own domain. The Dashboard is the company view:

- a **business flow as a bottleneck map** (Comercial → Caixa);
- rows **grouped by project/contract × problem class**, across domains;
- **Decisões** surfaced but not duplicated;
- a **company calendar** with one lane per domain.

**Outside the Dashboard:**
- **The globe.** It leaves the Dashboard. The operations map stays at `/projetos/operations-3d`, and every project row has "Ver no mapa".
- **Deliberações.** Committee votes, with their own module. Out of scope.
- **Demo organisations.** They also see real data. V1's mock is no longer used.

## 2. V1 problems (audit, 25/09)

1. **Fabricated data presented as fact:**
   - fixed fallbacks (12, 46);
   - `+0%` shown in green;
   - fixed trend lines;
   - "Faturamento mensal" and "Tendência de riscos" generated from a hash;
   - team size estimated from contract value;
   - invented risks;
   - static "vetores" chips;
   - "Valor a faturar" that is really the total contract value.
2. **No action for live organisations.** The action panel is always empty; there is no next action.
3. **"Decisões" appears on five surfaces, but they are all Deliberações.** Links point to parameters and routes that don't exist.
4. **Money leaks to roles without financial permission** (JSONB `valor_total`).
5. **No real states:**
   - loading is a blank page;
   - an error turns into zeros;
   - a "Live" label with no refresh;
   - dates without the day.
6. **Heavy page:**
   - `project_v2` is read four times on the client;
   - the globe intro takes 4.4 s;
   - at 390px the panels overlap.
7. **Decorative noise:** serial numbers, a watermark, scanlines, "CONTROL ROOM".

## 3. Screen (desktop 1440)

1. **Header.**
   - Eyebrow: "{Organização} · Visão da empresa".
   - Title: "O que está acontecendo".
   - Context: "N exceções · M críticas · atualizado às HH:mm", with the date when it isn't today. Also "Recarregar".
   - A **Decisões line** when count > 0: "3 aguardando você · 1 vencida", linking to `/decisoes` (the page always has a "Decisões" link).
2. **Business flow (bottleneck map)**, full width, 11 stages.
   - Each stage shows **what is stuck, with a noun** ("3 aceitas sem OS"), its volume and a link to the workspace.
   - `restricted` → "Restrito"; `unavailable` → "sem fonte canônica" (Execução, Caixa); `error` → "não carregou".
   - Tablet: 2 rows. Mobile: a vertical list of only the stuck stages, plus "N etapas sem pendência".
3. **Main grid:**
   - **Atenção agora** (feed):
     - domain filter chips;
     - each row reads: where · what · problem · **consequence** · due date · **"Resp.: X" / "sem responsável"** (always visible) · next action · "Entender";
     - the Apex note is shown as evidence;
     - the whole row is the tap target on mobile.
   - **Side column:**
     - **Decisões:** count from the badge store, "Vencidas", "Escaladas para você", top 3 in the inbox order. No act button.
     - **Projetos:** health `HEALTH_LABEL` (Em dia / Atenção / Crítico / Sem cronograma); the reason; the next milestone in the schedule; "Ver no mapa".
4. **Next 30 days: a company calendar by lane.**
   - Operação: schedule milestones + critical activities.
   - Supply: expected deliveries (ETA) + uncovered material needs.
   - Medição: customer deadlines.
   - Recebíveis: due dates, only if readable.
5. **Footnote:** provenance, plus "Seu perfil não lê: …".

**Empty and partial states.**
- **No operation at all** (no active project, no open OS, no opportunity): "Ainda não há operação para acompanhar", with actions into Comercial / Ordens de Serviço. The flow highlights the first stage.
- **Operation running, no exceptions:** "Nada fora do lugar".
- **Decisões with 0:** use `setup` to say "nenhuma alçada declarada" when that is the case.
- **Apex without a reading:** "Ainda sem leitura do Apex".
- **Unreadable domains:** they don't take up space; they go in the footnote.

**Mobile (390), attention first, same DOM, CSS order:**
1. compact header;
2. Decisões line (only when > 0);
3. Atenção agora (top 5, domain diversity);
4. projects with a blocker (max 3, then "N em dia");
5. stuck stages;
6. next 7 days (expands to 30).

**Entender (`?x=<ref>`).**
- A `SidePanel`: Radix, focus trap, Esc/back closes it, full screen on mobile, the primary action in the footer.
- Content: detected · the chain (each link `found` / `none` / `restricted` / `unconfirmed` / `pending`) · how to read it · evidence · rule · next action.

## 4. Feed merge contract

- **Severity map:** see `Severity` in `types.ts`.
- **Order:** severity → due date → domain order. The **top 8** (desktop) or **top 5** (mobile) contain the first critical row of every readable domain.
- **Grouping:**
  - overdue activities → **one row per project**: "4 atividades vencidas (1 bloqueada)", pointing to the schedule;
  - OS → one row per OS;
  - material → one row per requirement.
- **Dedup by object:**
  - `req:<id>` merges the Operações `mat:` row with SHORTAGE / ALTERNATE_STOCK / ETA_RISK signals, and with `decision:req` when it has a single requirement.
  - Tone = max(operations, signal). The text comes from **live coverage**: with `requested_qty > 0`, "requisitado, sem pedido emitido".
  - When the live coverage no longer shows the shortage, a SHORTAGE / ALTERNATE_STOCK signal is marked `stale` and doesn't raise the row (`STALE_ON_COVERAGE`). ETA_RISK and DECISION_PENDING are **never** stale from coverage alone: an inbound that covers the quantity can still arrive after the need.
  - Material risk everywhere = `supplyRisk(needDate)` (need date = min(`required_by`, activity start)).
  - `po:<id>`: the `decision:po` signal is **dropped only if** the viewer's inbox contains that PO. Otherwise: "Aprovação de compra parada", never counted as a decision.
  - `bill:<id>`: `PENDING_RELEASE` is dropped if it is in the inbox (`contract_billing_event`).
- **Total** = the deduplicated total, **with no cap** (per-kind counts are computed before the lists are cut; open signals are read up to 1000 and counted exactly).
- **Partial and failed sources.** `feed.failed` lists the readable sources whose read failed; `feed.partial` says some source was capped, so the total is a floor ("259+", "ao menos"). With a failed source the screen never says "Nada fora do lugar", "0 exceções" or "Ainda não há operação": it names what did not load.
- **`hasOperation`** is tri-state: `true` (some read showed operation), `false` (every operation read the viewer makes answered, and answered empty — only then the onboarding copy), `null` (restricted or failed — neutral copy).

## 5. `GET /api/dashboard/overview`: gates (mirror of RLS)

Route: `requireCommercialSession([])`, i.e. authenticated with an active organisation (the Decisões boundary). Every signed-in person lands here, so every section answers **200**. Restrictions go in the body.

| Block | Gate | Money |
|---|---|---|
| OS (flow, OS rows) | `operations.view` | none |
| Projects / schedule / health / needs / calendar Operação | `projects.view` | none |
| Measurements | `projects.measurements.view` \|\| `projects.view` | none on the Dashboard |
| Risks | `risks.view` | never `financial_exposure` |
| Supply flow | `supply.view` \|\| `procurement.view` \|\| `receiving.view` \|\| `operations.planning.view` \|\| `projects.view` | `openPoValue` is **not** used |
| Apex signals | the `/api/supply/intelligence` keys (236) | none |
| Billing (awaiting release, NF to issue) | `billingGate`: `contracts.edit` \|\| ((`contracts.view_values` \|\| `finance.view`) && `contracts.view`) — the effective select rule of `contract_billing_events` behind the `security_invoker` view (`contract_billing_events_select_scoped` needs `current_user_can_read_contract`; `manage_permissioned` is `FOR ALL` for `contracts.edit`). Admin-only, `contracts.approve`-only and responsible-only paths read just some rows, so they are **Restrito**, never a partial 0 | amounts only when `current_user_can_view_project_financials()` |
| Receivables (open / overdue) | `receivablesGate` = `billingGate` && the `fs_select` predicate (`finance.view` \|\| `has_finance_role_or_perm(...)`) — same helper in Entender | same RPC |
| Commercial: open opportunities | `commercial.view` | counts only |
| Commercial: authorized without OS | `contracts.view` | counts only |
| Decisões | viewer | as the inbox |

**Service role:** no *new* service-role read. Allowed, because they already exist in the composed models and only resolve ids already read under RLS after the gate:
- `resolveOwnerNames`;
- the `listServiceOrders` context (only when the OS gate passes);
- the inbox's `enrichInbox`.

**Performance:**
- Don't call `supplyOverview` / `materialDemand`. Use a narrow coverage read + `supplyFlow` + a narrow signals read (OPEN, critical/high, `count: exact`).
- `Promise.allSettled` with a timeout per section.
- Chunked `.in()` everywhere (`selectIn`).
- `truncated` / `partial` when a read hits `max_rows`: flow stages show "≥ N", calendar lanes say "parcial", and a count that would be a ceiling (Planejamento "sem cronograma" on a capped schedule read) is not shown at all (`noNumber: 'incomplete'`).
- `Server-Timing` and `no-store` on the response.

**Phase 2 (debt):**
- ASO (needs the route's composition, with a service role for documents);
- JSON-arrow project identity;
- removing the legacy HUD (together with its two unit tests).

## 6. Entender: `GET /api/dashboard/explain?ref=<kind>:<id>`

- **Allowed kinds:** `mat` · `act` · `proj-act` · `meas` · `os` · `dep` · `risk` · `po` · `bill` · `sig`. Validate the id; `.eq('organization_id')` everywhere. Always 200.
- **Contract link:**
  - query `contract_measurement_rule_timeline_mappings` (`review_state='accepted'`, anchor active) for the activity **or its ancestors**;
  - walk `parent_id` once, depth ≤ 12, with a cycle guard;
  - join `contract_measurement_requirements.milestone_id` with `effect <> 'removed'`.
  - Wording: "faz parte da etapa A, que ancora o marco M". **Never "atrasa".** A date comparison only when it is explicit.
  - Link states: no `contracts.view` → `restricted`; ANCHOR_LOST / AMBIGUOUS / PROPOSED → `unconfirmed` ("confirmar em Contratos"); no contract link for the project → "projeto sem contrato vinculado".
- **Billing, NF and receivable states are financial** (182/186): take them from the masked view, or apply the financial RPC.
- **`APPROVED_FOR_CUSTOMER` / `AWAITING_CUSTOMER_ACCEPTANCE`** → billing link `pending` ("aguardando aceite do cliente").
- **The schedule's "next milestone" relation** is labelled temporal adjacency ("próximo marco do cronograma"), never impact.

## 7. Preserved

Untouched:
- tables, workflows, RLS/RBAC, the Approval Engine;
- Decisões: `useDecisionBadge`, a single `header-decisions`, the sidebar block untouched;
- notifications;
- domain semantics;
- `(main)/layout.tsx`, `sidebar-preference.ts` (collapsed on `/dashboard`) and the audit.

## 8. Visual

- The ax layer (`--ig-*` tokens, light and dark), CSS in `dashboard-v2.css`.
- The flow as a continuous rail, with nodes and connectors.
- Rows on continuous planes with a severity rail.
- Calendar in SVG with guarded `x()`: no NaN, dates filtered.
- `prefers-reduced-motion` respected.
- None of: KPI card grid, glass, watermark, "Analisar com IA", generic AI cards.
- No theme or viewport branching in JS (hydration).
