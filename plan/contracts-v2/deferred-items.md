# Contracts V2 — Deferred Items Register

Do not pull these items into an authorized phase as opportunistic cleanup.

## Phase 0 deferred
- Successful live clause extraction after provider credit restoration.

## Phase 1 deferred

### Party / legacy adapters
- client.party_id
- supplier.party_id
- dropping contracts.client_id
- dropping contracts.supplier_id
- future fiscal_parties.party_id
- Party addresses/contacts
- Party roles beyond customer/supplier
- broader legacy Party-like text cleanup

### Cost center
- dropping legacy cost_center
- converting payroll_cost_center_mappings.cost_center_id text bridge
- classifying the eight seeded finance_cost_centers.type
- assigning business units to seeded cost centers
- deeper hierarchy cycle prevention
- cleanup of redundant single-column FKs where stronger composite FKs coexist

### Application cleanup
- /financeiro/centros-custo mock shim
- ContractInstrumentCard project cliente fallback
- unrelated sidebar lint issue

## Phase 3 — Obligations Engine
Deferred:
- obligation instances
- recurrence
- activation events
- due rules
- dependencies
- evidence completion
- waiver/exception
- escalation
- operational financial impact
- blocks_billing evaluation

## Phase 4 — Event Graph
Deferred:
- domain_events
- transactional outbox
- apex_jobs
- SKIP LOCKED claim
- lock expiry/reaper
- scheduler
- queued clause extraction

## Phase 5 — Shared Approval Engine
Deferred:
- approval_policies
- approval_requests
- approval_steps
- approval_decisions
- approval_delegations
- atomic decision RPC
- migration from module-specific approval engines

## Phase 6 — Project Measurement
Deferred:
- project_measurements
- operational measurement instances
- accepted/rejected measurement events
- schedule integration
- execution evidence integration
- readiness computation

Frozen invariant:

```text
accepted project measurement
→ legacy milestone.measured_amount
→ STOP
```

Never fallback to billing_amount.

## Phase 7 — Finance Chain
Deferred:
- real Finance replacement where mock remains
- billing event → fiscal document
- AR titles
- settlement
- reversal
- reconciliation
- dispute
- retention
- glosa
- real paid/received joins

## Phase 8 — Risks
Deferred:
- derived risk fingerprint/idempotency
- financial exposure
- operational risk links
- clause → obligation → finance → approval → amendment graph

## Phase 9 — Control Tower
Deferred until real Phase 3 + 7 + 8 data exists:
- required actions
- money blocked
- overdue obligations
- renewals
- receivables
- approvals
- risk/exposure
- counterparties blocking progress
- recent material changes

Do not fake this dashboard before the underlying data is real.

## Phase 10 — Autonomy
Deferred:
- automation policies
- automation executions
- reversibility model
- higher autonomy levels

Measurement acceptance remains NEVER_AUTOMATED.

## Measurement / billing readiness
Phase 2 structures requirements only.

Operational readiness remains deferred.

Apex does not generate the technical report.

```text
Contracts → WHAT is required
Schedule → WHEN expected
Projects / Operations → WHAT happened
Apex → WHAT is missing
Engineering → authors report
Billing → acceptance → release → invoice → receivable
```

## UI items intentionally not reopened
- Contracts module sidebar hierarchy
- dossier horizontal navigation
- removed vertical dossier rail
- portfolio-level Histórico
- portfolio-level Exportar PDF
- Análise IA as workspace
- generic Reports workspace
- global UI token redesign

## Repository housekeeping

### `.preview/`
Tests regenerate tracked `.preview/` files.
Restore incidental changes and keep net diff zero.

### Existing sidebar lint issue
Known pre-existing `react-hooks/set-state-in-effect` in `app-sidebar.tsx`.
Do not fix inside a Contracts schema phase unless that logic is touched.

### Disk capacity
Recent builds reached ENOSPC. Ensure adequate free space before large builds, Playwright runs or worktrees.

## Mandatory pre-Phase-3 gate — migration registry drift

`supabase_migrations.schema_migrations` in production ends at **088**, while the
schema itself carries everything through **111**. Migrations 089–111 were applied
through the controlled runners in `scripts/` (`apply-contracts-v2-phase0/1/2.mjs`
and their siblings), which execute the files inside one transaction with real
preflight and post-apply assertions — but do not write a registry row.

Nothing is wrong with the schema: every applied migration is in the repository, in
order, and the Phase 2 runner verifies the result structurally on each run. What is
wrong is that the registry no longer describes the database, so `supabase db push`
or any registry-driven tool would try to replay 089 onward against a database that
already has them, and the first `CREATE TABLE` would fail — or worse, a partially
idempotent one would not.

**This was deliberately left out of the Phase 2 security fix.** Reconciling a
migration registry is a write to migration history, and doing it inside a change
whose subject is a cross-tenant leak would have mixed two unrelated risks in one
reviewable diff.

Before Phase 3 starts, decide and execute one of:

1. **Backfill the registry** — insert rows 089–111 as already-applied, after
   proving file-by-file that each is in fact present in the schema. Registry
   becomes truthful; runners stay the apply path.
2. **Adopt the registry as the apply path** — reconcile as above, then move the
   phase runners' preflight/assertions into repeatable checks around
   `supabase db push`, so one mechanism owns applying and the other owns proving.
3. **Record the runners as the sole source of truth** — document that
   `schema_migrations` is not used by this project, and remove or fence the tools
   that would consult it, so no one later trusts a number that means nothing.

Do not pick by default. Whichever is chosen, the gate closes only when the
registry and the schema agree, or when the registry is provably out of the loop.
