# Contracts V2 — Frozen Architecture

Status: **FROZEN**

## 1. Product objective

Contracts is the operational system of record for the contractual lifecycle. It must transform contractual language into structured, traceable business rules without destroying legal history.

Long-term flow:

```text
Contract
→ structured contractual rules
→ obligations / milestones / conditions
→ execution evidence
→ measurement / acceptance
→ billing eligibility
→ fiscal document
→ accounts receivable
→ settlement / reconciliation
```

AI is transversal to this lifecycle. It is not a manual lifecycle stage.

## 2. Core invariants

### Historical truth is immutable
- Amendments do not overwrite the original contract.
- Clauses are not rewritten to make history look current.
- Current state is derived from historical facts and lineage.
- Original facts remain queryable.

### Missing is not a positive assertion
Absence must never silently become zero, compliant, approved, satisfied, not applicable, or verified.

### Demo/mock data is not official
Demo/mock contracts do not enter official portfolio metrics or official reporting. No automatic promotion to live.

### Tenant coherence is structural
RLS is necessary but not sufficient. Where tenant-owned tables reference each other, use same-org structural enforcement when required, normally:

```text
(organization_id, foreign_id)
→
(organization_id, id)
```

### Domain ownership remains explicit
Contracts must not become a shadow Finance/Fiscal/Operations ledger.

## 3. Canonical ownership

### Platform
- parties
- party_roles
- approval infrastructure
- domain_events
- apex_jobs
- audit primitives
- Trusted/Official primitives
- data_class
- notifications
- finance_cost_centers

### Contracts
- contracts
- current contractual value/term projection
- clauses
- AI clause proposals
- amendments
- contract lineage
- clause lineage
- inheritance
- contractual obligations definitions
- contractual measurement rules
- acceptance criteria
- contractual billing conditions
- billing eligibility/release rules
- guarantees
- insurance requirements
- indexation/adjustment rules
- contractual risks and links
- contract documents/evidence references

### Projects / Operations
- projects
- schedule progress
- operational execution
- field evidence
- operational measurement instances
- submit/accept/reject measurement events

### Fiscal
- fiscal documents
- fiscal-specific Party extensions

### Finance
- ledger
- AP/AR
- settlement
- reconciliation
- paid/received outcomes

## 4. Frozen decisions

### D1 — Canonical Party
Platform-level `parties` + `party_roles`. Do not promote `fiscal_parties`. `party_roles` is master data, not a universal relationship graph.

### D2 — Finance persisted
Finance remains authoritative for ledger/AR/settlement. Contracts does not own it.

### D3 — Measurement ownership split
Contracts owns contractual measurement rules/acceptance criteria. Projects/Operations owns actual measurement instances/events.

### D4 — Canonical Cost Center
`finance_cost_centers` is the canonical Apex cost-center model.

### D5 — Apex Approval Engine
Approvals are transversal. Contracts is the pilot, not a separate permanent approval system.

### D6 — Contract status vocabulary
Audit production values, constrain them, align TypeScript. Do not silently rename backend states.

### D7 — AI is not a workspace stage
No primary `Análise IA` workspace.

### D8 — Migration 095 admin issue
Previously suspected issue was refuted. Do not reopen without new evidence.

### D9 — New platform tables are org-scoped
All new shared tables are multi-org from day one.

### D10 — Contract official state
Contract starts `unclassified`; explicit governance changes it to `live` or `demo`.

## 5. Party model

Identity and role are separate.

Example:

```text
Party: ACME Energia S.A.
Roles: customer, supplier
```

Do not put contract-relative relations into global `party_roles`, such as contractor of Contract X, guarantor of Contract X, debtor of Obligation X, or beneficiary of Billing Event X.

## 6. Contract counterparty transition

Preserve `counterparty_name` and support canonical `counterparty_party_id`.

Rules:
1. Existing historical text remains intact.
2. Existing contracts are not auto-linked.
3. Canonical Party takes precedence when explicitly linked.
4. Text remains fallback.
5. No fuzzy matching.
6. No LLM identity inference.
7. Legal identity must be deterministically proven.

## 7. Measurement / billing readiness — frozen responsibility model

Apex does **not** author the technical/service report.

```text
Contracts → WHAT the contract requires
Schedule → WHEN the milestone is expected
Projects / Operations → WHAT actually happened
Apex → WHAT is still missing
Engineering → authors the report
Billing → validation → release → invoice → receivable
```

Future readiness states may include READY, BLOCKED, INCOMPLETE, NOT_APPLICABLE, UNKNOWN. Missing requirement information means UNKNOWN.

## 8. Contract-to-cash target chain

```text
condition
→ execution / delivery
→ measurement
→ acceptance
→ right to bill
→ released
→ invoice
→ accounts receivable
→ due date
→ payment
→ reconciliation
→ settlement
```

Eventually support dispute, retention, glosa, partial amount, delay, renegotiation, cancellation, reversal.

## 9. Contracts module navigation

Final module sidebar:
- Visão Geral
- Contratos
- Renovações
- Obrigações
- Faturamentos
- Aprovações
- Riscos & Cláusulas
- Documentos

Do not add Auditoria, Análise IA, Relatórios, or Aditivos as primary module navigation.

## 10. Dossier navigation

Current dossier navigation is horizontal and contextual:
- Visão geral
- Financeiro
- Obrigações
- Documentos
- Riscos & Cláusulas
- Aprovações

Do not recreate the removed vertical dossier rail.

## 11. Phase map

- Phase 0 — Truth & Security — complete
- UI Architecture Gate — complete
- Phase 1 — Canonical Party & Tenant Foundation — complete
- Phase 2 — Contract Structured Model — complete
- Phase 3 — Obligations Engine — complete (migrations 114–117)
- Phase 4 — Platform Event Graph / Durable Work Execution — complete (migrations 119–124)
- Phase 5 — Apex Approval Engine — next
- Phase 6 — Contract ↔ Project / Measurement
- Phase 7 — Billing ↔ Finance
- Phase 8 — Risks & Clauses Operationalization
- Phase 9 — Contract Control Tower
- Phase 10 — Autonomy

Phase 6 invariant:

```text
accepted project measurement
→ legacy milestone.measured_amount
→ STOP
```

Never fallback to `billing_amount`.

## 11.1 Platform execution substrate (Phase 4)

Phase 4 stopped being a Contracts feature and became shared infrastructure. The
chain, in order, is:

```text
authoritative mutation
        ↓ (same transaction — never a second round-trip)
domain_events
        ↓
apex_event_routes + registered dynamic route providers
        ↓
apex_jobs
        ↓ (FOR UPDATE SKIP LOCKED + lease token)
typed handler
        ↓
success · bounded retry · dead-letter
        ↓
new authoritative mutation + new causal event
```

Ownership, unchanged by later phases:

- Platform owns `domain_events`, `apex_jobs`, routing, the worker runtime, the
  scheduler entrypoint, retry/reaper and health.
- Contracts owns its obligation model, its event bindings and its handlers.
- Fiscal keeps `fiscal_jobs`. It was not replaced, renamed or absorbed.
- Ponto keeps its own cron, its own secret and its own workflow.

Two rules that later phases inherit rather than re-decide:

1. **The event graph is not event sourcing.** Domain tables stay authoritative.
   Deleting `domain_events` entirely would lose causality and pending work — not
   a single contract.
2. **Delivery is at-least-once.** Every handler is idempotent because a process
   can die between the side effect and the `COMPLETED` write.

Phase 4 did not implement Phase 5–10 decisions. No worker manufactures approval,
measurement acceptance or billing release.

## 12. Engineering discipline

- Do not re-audit the whole repository every phase.
- Preflight only what the current phase needs.
- Stop instead of guessing when production evidence conflicts with assumptions.
- Applied migrations are historical records; do not rewrite them after production apply.
- Keep `.preview/` noise out of unrelated commits.
- Do not use demo/mock data to make a feature appear complete.
