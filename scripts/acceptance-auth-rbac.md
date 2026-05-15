# Acceptance Checklist — Auth + RBAC Hardening

- Date: 2026-05-13
- Branch: main
- Scope: Foundation auth, RBAC tables/RLS, middleware protection, sidebar gating, admin polish.

## Files touched across agents

### Agent A — DB hardening
- `supabase/migrations/007_auth_rbac_hardening.sql` (new)

### Agent B — Middleware + auth callback + login/reset/onboarding
- `src/utils/supabase/middleware.ts`
- `src/utils/auth/safe-path.ts` (new)
- `src/app/auth/callback/route.ts` (new)
- `src/app/login/page.tsx`
- `src/app/reset-password/page.tsx`
- `src/app/onboarding/page.tsx`

### Agent C — Sidebar + deliberacoes/pautas/votacoes gating
- `src/components/layout/app-sidebar.tsx`
- `src/app/(main)/deliberacoes/page.tsx`
- `src/app/(main)/pautas/page.tsx`
- `src/app/(main)/pautas/nova/page.tsx`
- `src/app/(main)/votacoes/page.tsx`
- `src/app/(main)/votacoes/[id]/page.tsx`

### Agent D — Admin pages polish
- `src/app/(main)/admin/users/page.tsx`
- `src/app/(main)/admin/roles/page.tsx`
- `src/app/(main)/admin/audit/page.tsx`
- `scripts/acceptance-auth-rbac.md` (new)

---

## Acceptance criteria

### Auth foundation

- [ ] **Auth foundation is secure**
  - Test: Inspect `src/utils/supabase/middleware.ts` and `src/utils/auth/safe-path.ts`. Confirm no service-role key referenced in client/edge code.
  - Expected: only `anon` key used in browser/middleware; redirects validate paths to prevent open-redirect.
  - Result: ___

- [ ] **Auth callback route handles PKCE/OAuth and password recovery**
  - Test: Visit `/auth/callback?code=...` and `/auth/callback?token_hash=...&type=recovery`.
  - Expected: Code is exchanged, session is set, user is redirected to safe internal path.
  - Result: ___

### DB tables/seeds/helpers/RLS

- [ ] **Migration 007 applies cleanly**
  - Test: `supabase db reset` or apply `007_auth_rbac_hardening.sql` against a clean schema.
  - Expected: No errors. `profiles`, `organizations`, `roles`, `permissions`, `role_permissions`, `user_roles`, `audit_logs` exist with proper FK and indexes.
  - Result: ___

- [ ] **System roles + permissions seeded**
  - Test: `SELECT key, name FROM roles WHERE is_system_role = true;` and `SELECT count(*) FROM permissions;`.
  - Expected: System roles present (e.g. admin, governance_member, viewer). Permissions cover all modules.
  - Result: ___

- [ ] **RLS enforces organization isolation**
  - Test: As user from org A, attempt `SELECT * FROM profiles WHERE organization_id = '<org B>';`.
  - Expected: 0 rows returned (RLS blocks).
  - Result: ___

- [ ] **Helpers `has_permission(uuid, text)` and similar are present and SECURITY DEFINER where appropriate**
  - Test: `\df+ public.has_permission` in psql.
  - Expected: function exists, returns boolean, joins user_roles + role_permissions + permissions.
  - Result: ___

### Permission helpers/hooks

- [ ] **`hasPermission(permissions, 'x.y')` returns correctly**
  - Test: Inspect `src/lib/auth/permissions.ts`.
  - Expected: pure check against array; no DB call.
  - Result: ___

- [ ] **`useCurrentUser()` returns `{ profile, organization, permissions, loading }` consistently**
  - Test: Mount any admin page; observe initial `loading=true` then resolved state.
  - Expected: no flicker of access-restricted while loading.
  - Result: ___

### Routes / Middleware

- [ ] **Middleware protects direct routes (not just sidebar links)**
  - Test: While logged out, `curl -I http://localhost:9002/admin/users`. While logged in but missing `admin.manage_users`, hit same URL.
  - Expected: Logged-out -> 302 to `/login`. Insufficient perms -> rendered with `AccessRestrictedState` or redirect.
  - Result: ___

- [ ] **Login page rejects open redirects**
  - Test: `/login?next=https://evil.com/`.
  - Expected: After success, redirect to `/` (safe default), not external host.
  - Result: ___

- [ ] **Reset password and onboarding flows render and submit**
  - Test: visit each route logged out / mid-flow.
  - Expected: forms render, errors surface inline, success redirects properly.
  - Result: ___

### Sidebar + nav

- [ ] **Sidebar respects actual permissions**
  - Test: As a user with only `deliberations.view`, inspect sidebar.
  - Expected: Only Deliberacoes (and dashboard if granted) visible. No admin items.
  - Result: ___

- [ ] **Sidebar uses same source of truth as middleware**
  - Test: Search codebase for sidebar permission map vs `permissions.ts`.
  - Expected: same keys; no drift.
  - Result: ___

### Module-specific gating

- [ ] **Deliberacoes accessible only with `deliberations.view`**
  - Test: Remove `deliberations.view`; visit `/deliberacoes`, `/pautas`, `/votacoes`.
  - Expected: Access restricted state OR middleware redirect.
  - Result: ___

- [ ] **Pautas / Votacoes pages gate write actions (create, vote, etc.)**
  - Test: As viewer-only user, attempt to open `/pautas/nova` and `/votacoes/[id]`.
  - Expected: write controls hidden or disabled; direct route blocked.
  - Result: ___

- [ ] **Finance does NOT receive admin/sensitive permissions inadvertently**
  - Test: Inspect role seeds; ensure finance role has only `finance.*` keys plus dashboard view, no `admin.*`, no `deliberations.approve`.
  - Expected: clean separation.
  - Result: ___

- [ ] **Projects schema/RLS unchanged**
  - Test: `git diff HEAD -- supabase/migrations/` should not touch projects tables.
  - Expected: only 007 added, no project table alterations.
  - Result: ___

- [ ] **Contracts module continues to work with `006_contracts_supabase.sql`**
  - Test: Load `/contracts`; perform a read.
  - Expected: page loads, contracts list visible under proper RLS.
  - Result: ___

### Admin pages (Agent D scope)

- [ ] **`/admin/users` gated by `admin.manage_users`**
  - Test: Without permission, visit page.
  - Expected: `AccessRestrictedState` rendered.
  - Result: ___

- [ ] **`/admin/users` mutations rely on RLS (no service-role bypass)**
  - Test: Inspect file; confirm only `createClient()` (browser) and no service-role env key.
  - Expected: confirmed.
  - Result: ___

- [ ] **`/admin/roles` gated by `admin.manage_roles`, shows read-only banner**
  - Test: With permission, visit page.
  - Expected: banner reads "Edicao da matriz de permissoes sera habilitada em uma proxima iteracao. Atualmente, esta tela e somente leitura."
  - Result: ___

- [ ] **`/admin/roles` handles empty/error state**
  - Test: temporarily revoke RLS read on roles; visit page.
  - Expected: loading skeleton, then either empty state or error banner; no crash.
  - Result: ___

- [ ] **`/admin/audit` gated by `audit.view`**
  - Test: Without permission, visit page.
  - Expected: AccessRestrictedState rendered.
  - Result: ___

### Build / static analysis

- [ ] **`npm run typecheck` passes**
  - Result: ___

- [ ] **ESLint passes for changed files**
  - Result: ___

- [ ] **`npm run build` succeeds**
  - If failures: categorize as "in-scope (must fix)" or "out-of-scope (pre-existing debt, documented below)".
  - Result: ___

### Permission constants verification

The Agent B route map references the following keys. All confirmed present in `src/lib/auth/permissions.ts` at the time of audit:
- finance.view OK
- contracts.view OK
- projects.view OK
- risks.view OK
- people.view OK
- org_chart.view OK
- committees.view OK
- meetings.view OK
- minutes.view OK
- deliberations.view OK
- audit.view OK
- admin.view OK
- admin.manage_users OK
- admin.manage_roles OK
- dashboard.view OK

No follow-ups needed for permission constants.

---

## Build / lint / typecheck results (filled by Agent D)

- `npm run typecheck` exit code: 0 — PASS, no errors.
- `npm run lint -- <changed files>` exit code: 0 — one warning surfaced (see below).
- `npm run build` exit code: 0 — PASS, full production build succeeded.

## Out-of-scope failures (pre-existing debt)

None blocking the build. The lint output flags one `react-hooks/set-state-in-effect` issue:

- `src/components/layout/app-sidebar.tsx:187` — `setAdminOpen(storedAdmin === "true")` is called synchronously inside `useEffect`. Owned by Agent C. This file was modified by Agent C in this PR, so this counts as in-scope follow-up for Agent C (not destructive, not blocking build; refactor to use lazy `useState` initializer or `useSyncExternalStore`).

## In-scope failures / follow-ups

- [ ] (Agent C) Refactor `app-sidebar.tsx` localStorage hydration to avoid synchronous setState in effect (rule `react-hooks/set-state-in-effect`). Suggested approach: hydrate state via lazy initializer guarded by `typeof window !== 'undefined'` rather than in `useEffect`.
- No issues found in Agent D's owned admin pages.

---

# Part 2 — Projects RLS Hardening Addendum

- Date: 2026-05-13
- Scope: Tighten `projects` / `project_files` / `storage.objects['project-files']` to org-scoped, permission-gated, authenticated-only access. No risks or contracts touched.

## Files touched

### Agent E — DB
- `supabase/migrations/008_projects_rls_hardening.sql` (new, 303 lines)

### Agent F — Service code
- `src/lib/services/projects.ts` (modified — org/user resolution, split insert/update, storage path `{org}/{project}/...`, RLS-friendly errors)
- `scripts/seed-projects-to-supabase.ts` (modified — service-role key, env-driven org/user fallbacks)

## Checklist

- [ ] `008_projects_rls_hardening.sql` applies cleanly to a DB that already has 004–007.
- [ ] After apply, `projects.organization_id` and `project_files.organization_id` are NOT NULL on all rows.
- [ ] Orphan rows were assigned to the first organization (or to a created `Default Organization`).
- [ ] Anon role cannot SELECT/INSERT/UPDATE/DELETE on `projects` or `project_files`.
- [ ] Authenticated user from Org A cannot see Org B projects.
- [ ] INSERT with `created_by != auth.uid()` is rejected.
- [ ] UPDATE that tries to change `organization_id` is rejected.
- [ ] Storage upload to `<other_org_id>/...` is rejected; upload to own `<org_id>/<project_id>/...` succeeds (with `projects.upload`).
- [ ] `owner_admin` can DELETE; user with only `projects.view` cannot.
- [ ] `npm run typecheck` ✅ (verified: exit 0)
- [ ] ESLint on changed files ✅ (verified: no warnings/errors)
- [ ] `npm run build` ✅ (verified: exit 0)
- [ ] `scripts/seed-projects-to-supabase.ts` runs with `SUPABASE_SERVICE_ROLE_KEY` set, fails with helpful error if absent.

## Validation results

- typecheck: **PASS**
- lint (services/projects.ts + seed script): **PASS** — no warnings or errors
- build: **PASS** — full production build succeeded; `/projetos`, `/projetos/[id]`, `/projetos/novo`, `/projects` all built

## Follow-ups (deferred, not blocking Part 2)

- "Assigned to me" enforcement (`projects.view_assigned` differentiation) requires a `project_assignees` table — out of scope.
- Migrate `/projects` legacy route to redirect to `/projetos` — out of scope per user decision.
- Bucket remains public; download URLs continue to use `public_url`. Path-scoping plus RLS on `storage.objects` mitigates cross-org access, but a future hardening pass could flip the bucket to private + signed URLs.

---

# Part 3 — Risks Migration to Supabase Addendum

- Date: 2026-05-13
- Scope: Move Risks module from in-memory mock to Supabase `risks` table. JSONB for actions/history/evidences (per user decision). `reference_id` as free-form text (no FK).

## Files touched

### Agent G — DB
- `supabase/migrations/009_risks_supabase.sql` (new, ~7.3 KB)
- `scripts/seed-risks-to-supabase.ts` (new, ~7.6 KB)

### Agent H — Service code
- `src/lib/services/risks.ts` (new — listRisks/createRisk/updateRisk/deleteRisk + mappers)
- `src/hooks/use-risks.ts` (new — client hook with refresh/create/update/delete)
- `src/app/(main)/riscos/page.tsx` (modified — replaced MOCK_RISKS import with useRisks(); added permission guard, loading/error states)

### Kept as-is
- `src/components/risks/risk-mock-data.ts` (still imported by seed script)

## Checklist

- [ ] `009_risks_supabase.sql` applies cleanly to a DB that already has 005–008.
- [ ] `risks` table created with org_id NOT NULL, GENERATED `level`, CHECK constraints on probability/impact/severity/origin/status.
- [ ] RLS: anon denied; Org A cannot read Org B; INSERT requires `created_by = auth.uid()`; UPDATE cannot change `organization_id`; DELETE gated by `risks.delete`.
- [ ] `scripts/seed-risks-to-supabase.ts` runs with `SUPABASE_SERVICE_ROLE_KEY`, inserts MOCK_RISKS with fresh UUIDs, `--reset` removes only `origin='manual'` rows.
- [ ] `/riscos` page shows access-restricted for users without `risks.view`.
- [ ] `/riscos` page renders Supabase data; loading + error states present.
- [ ] No mutation UI wired yet (out of scope) — hook exposes create/update/delete for future use.
- [x] `npm run typecheck` — PASS
- [x] `npm run build` — PASS
- [ ] ESLint focused on changed files — PASS for new files; one **pre-existing** warning in `riscos/page.tsx` line 68 (`Date.now()` inside `useMemo`, flagged by `react-hooks/purity`). Code is unchanged vs. HEAD; warning surfaced because the file is now linted directly. Documented as out-of-scope debt.

## Out-of-scope follow-ups

- React 19 `react-hooks/purity` warning on `Date.now()` inside `avgAging` `useMemo`. Pre-existing. Fix: lift `Date.now()` into state initialized via `useEffect`, or capture it once in a ref.
- Mutation UI (create/edit/delete risk forms) in `/riscos/page.tsx` — hook is ready, UI not built.
- Bridge between embedded `projects.project_v2.risks[]` and the new `risks` table (e.g., when `origin='project'`, mirror back to project JSONB). Currently independent.
- Linking deliberations to risks via FK (`ItemRelacionadoTipo='risco'` exists in types) — not enforced at DB.

---

# Part 4 — Deliberations / Votes Migration Addendum

- Date: 2026-05-13
- Scope: Move Deliberations/Votes from in-memory mock to Supabase. Add Reject + Close action buttons (perms already existed in 005). Vote persistence + audit trail in DB. JSONB-heavy schema (stages/minutes/audit_trail/linked_entities/execution_items) with `deliberation_votes` as separate auditable table. `owner_committee_id` is FK to `committees(id)`.

## Files touched

### Agent I — DB
- `supabase/migrations/010_deliberations_supabase.sql` (new, 295 lines)
- `scripts/seed-deliberations-to-supabase.ts` (new, 443 lines)

### Agent J — Service code + UI
- `src/lib/services/deliberations.ts` (new — listDeliberations/createDeliberation/updateDeliberation/castVote/startVoting/closeVoting/approve/reject/close/withdraw/delete)
- `src/hooks/use-deliberations.ts` (new — client hook with refresh + all mutations)
- `src/app/(main)/pautas/page.tsx` (modified — replaced `initialItems` state with `useDeliberations()`; rewired all handlers; added view permission gate + loading/error states)
- `src/components/deliberacoes/DecisionInspector.tsx` (modified — Aprovar / Rejeitar / Encerrar buttons gated by `canApprove` / `canReject` / `canClose` + status, with `window.confirm` guard)

### Post-validation fixes (in-scope)
- `pautas/page.tsx` line 462: replaced `useEffect + setState` with derived value (`selectedIdState ?? items[0]?.id`) to satisfy `react-hooks/set-state-in-effect`.
- `DecisionInspector.tsx` line 513: escaped quotes in `"Criar Ação"` string for `react/no-unescaped-entities`.

## Checklist

- [ ] `010_deliberations_supabase.sql` applies cleanly to a DB with 005–009.
- [ ] `deliberations` table created with all 28 columns; `deliberation_votes` table with 10 columns + unique index on (deliberation_id, voter_id, COALESCE(stage_id,'')).
- [ ] RLS: anon denied on both tables; Org A cannot read Org B; INSERT enforces `submitted_by = auth.uid()`; vote INSERT enforces parent `status='in_voting'` and `voter_id = auth.uid()`.
- [ ] DELETE on deliberations is admin-only; non-admins must use status='withdrawn'.
- [ ] Same voter cannot double-vote on same (deliberation, stage).
- [ ] `scripts/seed-deliberations-to-supabase.ts` runs with `SUPABASE_SERVICE_ROLE_KEY`; `--reset` wipes per-org; non-UUID voter ids in mock are skipped with warning.
- [ ] `/pautas` page renders Supabase data; loading + error + access-restricted states present.
- [ ] DecisionInspector shows Aprovar/Rejeitar/Encerrar only when permission + status match.
- [x] `npm run typecheck` — PASS
- [x] `npm run build` — PASS
- [x] ESLint focused on changed files — PASS

## Out-of-scope follow-ups

- Replace `window.confirm` with proper HUD modal for Reject/Close (with required justification field).
- Promote inline mock `initialItems` in `pautas/page.tsx` to a deletion (once seed in Supabase is exercised in dev).
- Wire `vote.voter_id` lookup in seed script to a real `auth.users` mapping so vote history seeds end-to-end.
- Cross-module side-effects on deliberation approval (e.g., auto-create risk mitigation task, link approved decision to project audit log) — design pending in Part 5 (AI Risk Engine).
- Tighten `deliberation_votes` UPDATE: business rule may dictate immutability after voting window closes; current policy lets voter amend while perm is held.

---

## Master sequence status

- ✅ Part 1 — Auth + RBAC foundation
- ✅ Part 2 — Projects RLS hardening
- ✅ Part 3 — Risks → Supabase
- ✅ Part 4 — Deliberations/Votes → Supabase + reject/close actions

Next proposed: **Part 5 — AI Risk Engine** (Anthropic API in server routes, writing to `risks` table with `origin='ai'`, starting with Contracts module).

---

# Part 5 — AI Risk Engine (Contracts Pilot) Addendum

- Date: 2026-05-13
- Scope: Anthropic Claude API integration to generate risk alerts from contract data. Pilot module: **Contracts**. Direct write to `risks` with `origin='ai'`, visible badge, on-demand trigger.

## User decisions
- Model: `claude-sonnet-4-6` (cost-optimized)
- Lifecycle: direct to panel (no staging), distinguished by `origin='ai'` + "IA" badge
- Trigger: on-demand button, gated by `risks.ai_scan`

## Files touched

### DB (Agent K)
- `supabase/migrations/011_ai_risk_engine.sql` (new, 142 lines)
  - Extends `risks.origin` CHECK to include `'ai'`
  - Adds AI columns: `source_module`, `source_entity_id`, `ai_confidence`, `ai_rationale`, `ai_model`, `ai_analyzed_at`
  - Adds index `risks_source_entity_idx`
  - Seeds permission `risks.ai_scan` and grants to owner_admin, ceo_diretoria, gestor_projetos, juridico_contratos, financeiro

### Backend (Agent L + finalization)
- `src/lib/ai/risk-scanner.ts` (new, 410 lines)
  - Anthropic SDK wrapper, server-only via `typeof window` guard
  - Uses `output_config.format: json_schema` (verified in @anthropic-ai/sdk@0.96.0)
  - Loads contract context (clauses, penalties, milestones, billing) via service-role client
  - Model: `claude-sonnet-4-6` with `thinking: adaptive` + `effort: medium`
  - Inserts findings with `origin='ai'`, `source_module='contracts'`, full AI metadata
- `src/app/api/ai/risk-scan/contracts/[id]/route.ts` (new)
  - POST handler; resolves user via Supabase server client
  - Verifies `risks.ai_scan` via user_roles → roles → role_permissions → permissions chain
  - Returns `{ ok, inserted, findings_count, risks }`
- `src/lib/services/risks.ts` (modified)
  - `mapRowToExtendedRisk` reads new AI columns
  - Adds `triggerContractAiScan(contractId)` client helper that POSTs to the route
- `src/lib/auth/permissions.ts` (modified) — adds `risks.ai_scan` key
- `src/components/risks/risk-types.ts` (modified) — extends ExtendedRisk with AI fields

### UI (finalization)
- `src/app/(main)/contratos/[id]/page.tsx` (modified)
  - Imports `triggerContractAiScan` from services
  - Adds `canScanAi = hasPermission('risks.ai_scan')` and `scanningAi` state
  - Adds "Analisar com IA" button (BrainCircuit icon) in header actions, gated + confirm dialog
  - Result/error surfaced via existing `flowNotice` panel
- `src/components/risks/RiskActionQueue.tsx` (modified) — "IA" pill when `risk.origin === 'ai'`
- `src/components/risks/RiskDetailDrawer.tsx` (modified) — "IA" pill in executive summary

## Dependencies
- Installed: `@anthropic-ai/sdk@^0.96.0` (47 vulnerabilities surface; project pre-existing, not from this package)

## Required env vars (USER ACTION)
Add to `.env.local`:
```
ANTHROPIC_API_KEY=sk-ant-...
SUPABASE_SERVICE_ROLE_KEY=eyJ... # already used by other server routes; confirm present
```
Without `ANTHROPIC_API_KEY`, the `/api/ai/risk-scan/contracts/[id]` endpoint returns 500 with a friendly message.

## Checklist
- [ ] Migration 011 applies cleanly to a DB with 005–010.
- [ ] `risks.origin` CHECK accepts `'ai'`; rejects others.
- [ ] `risks.ai_scan` permission exists; granted to listed roles.
- [ ] User without `risks.ai_scan` → 403 from the route.
- [ ] User with `risks.ai_scan` + ANTHROPIC_API_KEY set → scan runs and inserts 0..N rows.
- [ ] Inserted rows have `origin='ai'`, `source_module='contracts'`, populated `ai_model`, `ai_confidence`, `ai_rationale`, `ai_analyzed_at`.
- [ ] `/riscos` shows "IA" badge on AI rows in both list and detail drawer.
- [ ] Contract detail page shows "Analisar com IA" button only for users with the perm.
- [x] `npm run typecheck` — PASS
- [x] `npm run build` — PASS
- [x] ESLint on changed files — PASS

## Out-of-scope follow-ups
- Extend AI scanning to Finance (ledger entries / payroll anomalies) and Projects (margin/schedule risk).
- Add "AI Alerts" filter tab in /riscos for quick triage.
- Background batch trigger (cron job scanning entities modified in last 24h).
- Approval workflow: optional `risks.approve_ai` step before AI risks become "official" in the risk score calculation.
- Cost telemetry: log `usage.cache_read_input_tokens` and `output_tokens` per scan to a `ai_usage_log` table.
- Tighten prompt-cache: the current system prompt may be <2048 tokens (Sonnet 4.6 cache threshold). Pad with category definitions and historical examples to activate caching for repeat scans.

---

## Master sequence status

- ✅ Part 1 — Auth + RBAC foundation
- ✅ Part 2 — Projects RLS hardening
- ✅ Part 3 — Risks → Supabase
- ✅ Part 4 — Deliberações/Votações → Supabase + Reject/Close
- ✅ Part 5 — AI Risk Engine (Contracts pilot)
- ✅ Part 6 — AI Risk Engine Phase 1 expansion (Finance + Projects + Alertas IA + dismissal)

---

# Part 6 — AI Risk Engine Phase 1 (Finance + Projects + Dismiss)

- Date: 2026-05-14
- Scope: Phase 1 of `docs/plan/FINANCE_AI_COPILOT_PLAN.md`. Adds AI risk scanning for finance (ledger_entry batches) and projects (one project at a time), an "Alertas IA" filter in `/riscos`, and a proper AI-dismissal flow (separate from `status='resolved'`).
- Architectural note (codebase vs. doc): The plan calls the entity `finance_entries`, but this codebase's canonical table is `ledger_entry` (migration 001). `ledger_entry` has no `organization_id` today (RLS is BU-scoped). Per user decision, Phase 1 uses `current_user_organization_id()` from the caller's profile to stamp AI-generated risks; finance↔org canonical linkage is a Phase-2 improvement.

## Files touched

### DB
- `supabase/migrations/012_ai_risk_dismiss.sql` (new) — `ai_dismissed*` columns, unique partial index on active AI risks, `risks.ai_dismiss` permission seed.

### Shared AI layer
- `src/lib/ai/types.ts` (new) — `AiRiskFinding`, severity helpers.
- `src/lib/ai/schemas.ts` (new) — shared JSON schema for Anthropic structured output.
- `src/lib/ai/server-clients.ts` (new) — lazy Anthropic + service-role Supabase clients with friendly errors when keys are missing.
- `src/lib/ai/anthropic-call.ts` (new) — single `callAnthropicForRiskFindings()` used by every scanner.
- `src/lib/ai/risk-persistence.ts` (new) — pre-filtered dedup insertion into `public.risks`.

### Scanners
- `src/lib/ai/finance/finance-risk-scanner.ts` (new) — batch scanner over `ledger_entry`.
- `src/lib/ai/projects/projects-risk-scanner.ts` (new) — full-project scanner (milestones used as supporting evidence in the JSON payload).

### API routes
- `src/app/api/ai/risk-scan/finance/route.ts` (new) — POST {periodFrom?, periodTo?}, gated by `risks.ai_scan`.
- `src/app/api/ai/risk-scan/projects/[id]/route.ts` (new) — POST, gated by `risks.ai_scan`.
- `src/app/api/ai/risks/[id]/dismiss/route.ts` (new) — POST {reason?}, gated by `risks.ai_dismiss`, org-checked.

### Service / hook / types
- `src/lib/services/risks.ts` (modified) — RiskRow extended with dismissal columns; mapper hydrates them; adds `triggerFinanceAiScan`, `triggerProjectAiScan`, `dismissAiRisk`.
- `src/hooks/use-risks.ts` (modified) — exposes `dismissAiRisk`.
- `src/components/risks/risk-types.ts` (modified) — `ExtendedRisk` carries `aiDismissed*` fields.
- `src/lib/auth/permissions.ts` (modified) — `risks.ai_dismiss` added to the risks module.

### UI
- `src/app/(main)/riscos/page.tsx` (modified) — top-level scope tabs (Todos / Alertas IA / Descartados); whole dashboard reshapes on switch; dismissed rows hidden from the default view; dismiss handler wired to drawer.
- `src/components/risks/RiskDetailDrawer.tsx` (modified) — "IA descartada" pill, "Análise IA" section with rationale/confidence/model, "Descartar IA" action (perm-gated, prompts for reason).
- `src/app/(main)/projetos/[id]/page.tsx` (modified) — "Analisar com IA" button + inline notice.
- `src/components/finance/control-room/FinanceControlRoom.tsx` (modified) — "Analisar com IA" button in header; uses current period range.

## Checklist

- [ ] Migration 012 applies cleanly to a DB with 005–011.
- [ ] `risks.ai_dismissed` defaults to false; partial unique index prevents duplicate active AI risks per (org, source_module, source_entity_id, category).
- [ ] `risks.ai_dismiss` permission granted to owner_admin + ceo_diretoria + gestor_projetos + juridico_contratos + financeiro.
- [ ] `POST /api/ai/risk-scan/finance` with empty body scans last 90 days; with `{periodFrom,periodTo}` filters by `period_key`. Returns `{scanned, inserted, skipped_duplicates}`.
- [ ] `POST /api/ai/risk-scan/projects/[id]` scans full project; rejects projects without `organization_id` with a clear error pointing to migration 008.
- [ ] `POST /api/ai/risks/[id]/dismiss` blocks non-AI rows (400), rows from other orgs (403), already-dismissed (200 ok:true, already:true).
- [ ] Without `ANTHROPIC_API_KEY`, all scan routes return 500 with a readable Portuguese message.
- [ ] `/riscos` "Alertas IA" filter narrows the whole dashboard to `origin='ai' AND ai_dismissed=false`.
- [ ] Dismissing an AI risk from the drawer removes it from the default view but keeps it visible under "Descartados".
- [x] `npm run typecheck` — PASS
- [x] `npm run build` — PASS

## Future improvements (out of scope, Phase 2+)

- **Canonical org link in Finance**: add `organization_id` to `ledger_entry` (or via `business_unit`) so AI scans don't have to derive org from the caller's profile. Currently safe because the deployment has a single primary org, but it will break in multi-tenant.
- AI Variance Analysis, KPI explainers, Forecast simulator, Cash Flow Intelligence, Classification Assistant, Contract-to-Finance, Board Briefing — see roadmap in `docs/plan/FINANCE_AI_COPILOT_PLAN.md`.
- Move `risk-scanner.ts` (contracts) under `src/lib/ai/contracts/` to match the directory convention introduced for finance/projects.
