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
