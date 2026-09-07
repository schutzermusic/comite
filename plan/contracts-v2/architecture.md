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
- Phase 5 — Apex Approval Engine — complete (migrations 125–129)
- Phase 6 — Contract ↔ Project / Measurement — complete (migrations 130–134)
- Phase 7 — Billing ↔ Fiscal ↔ Finance — complete (migrations 135–139)
- Phase 8 — Risks & Clauses Operationalization
- Phase 9 — Contract Control Tower
- Phase 10 — Autonomy

### D5.1 — Approval Engine ownership, settled by Phase 5

The engine is **Platform-owned**. Contracts is the pilot and owns only two
things: why a Contract action needs governance, and how a final governed
outcome affects Contracts. It does not own policy, request, step, decision or
delegation.

Two rules later phases inherit rather than re-decide:

1. **The decision is one transaction.** Lock, validate, re-evaluate eligibility
   / SoD / authority / delegation, re-check the subject fingerprint, write the
   immutable decision, tally quorum, progress, finalize and emit the event —
   together or not at all. There is no client-side multi-write path, and
   `authenticated` has no INSERT on the decision tables at all.
2. **The actor is never a parameter.** `approval_decide` reads `auth.uid()`
   itself. AI may summarize or recommend; it cannot approve, reject, authorize,
   accept or release.

### Phase 5 cutover status — Contracts NOT cut over

The engine is complete and proven; the **real Contracts cutover is blocked**,
and the reason is evidence, not effort. The Phase 5 audit found that
`contract_approvals` holds three rows, all on one `data_class = 'demo'`
contract. There is no real contract approval in the database, and nowhere in
the repository or the schema is there an authority limit, a quorum, a
delegation or a named approver.

Per Phase 5 §34/§63, that means: build the engine, prove it on a disposable
policy and org, and stop before claiming cutover. Inventing "Legal approves up
to R$ 100,000" would have been fabricated governance — and a fabricated
threshold is indistinguishable from a real one once someone approves against it.

`approval_engine_cutover` is the boundary, and it is **empty**. With no row,
the legacy path keeps writing and the shared engine refuses to open a request
for the same action; with a row, the two swap. There is never an instant where
both write.

Phase 6 invariant, now implemented:

```text
accepted project measurement
→ legacy milestone.measured_amount
→ UNKNOWN
```

Never fallback to `billing_amount`.

## 10.6 Phase 6 — Contract ↔ Project / Measurement (migrations 130–134)

### Ownership, settled

```text
CONTRACTS  defines WHAT must be measured, WHAT evidence and acceptance are
           required, with effective dates and amendment lineage
PROJECTS   owns the measurement INSTANCE: where, when, what actually happened,
           the evidence package, submission, acceptance and rejection
PLATFORM   owns domain_events, apex_jobs, the Approval Engine
```

Contracts never writes a measurement instance. Projects never rewrites a
contractual rule. Neither writes Finance or Fiscal — Phase 6 ends at
authoritative acceptance.

### The chain

```text
contract_measurement_requirements          (Phase 2, contractual truth)
  → contract_measurement_rule_timeline_mappings   (governed, review_state='accepted')
    → project_measurements                        (operational instance)
      → project_measurement_evidence              (classed, provenanced)
      → project_measurement_requirements          (resolved as-of the occurrence)
        → project_measurement_readiness()         (canonical resolver)
          → submission → authoritative acceptance
            → projects.measurement.accepted       (Phase 7 input)
```

### Acceptance is NEVER_AUTOMATED

This is structural, not a convention, and it is refused in four independent places:

1. the state machine has no path to `ACCEPTED` except from `SUBMITTED` or
   `UNDER_REVIEW` — execution evidence cannot reach acceptance;
2. `project_measurement_accept` raises `ACCEPTANCE_NEVER_AUTOMATED` when there
   is no `auth.uid()` and the source is internal;
3. external acceptance requires provenance — a party, a document or an external
   reference — so a system caller cannot impersonate the customer;
4. `pm_accepted_coherent` and `pm_acceptance_actor` refuse an `ACCEPTED` row
   without a source and without an actor, at the table level.

The RPC takes no "who accepted" parameter. It reads `auth.uid()` itself.

### Readiness

One canonical resolver, consumed by both Projects and Contracts. It returns
dimensions, not a boolean, and derives the overall state as:

```text
BLOCKED > UNKNOWN > INCOMPLETE > READY     (NOT_APPLICABLE only when all are)
```

`UNKNOWN` outranks `INCOMPLETE` deliberately. "The report is missing" is work
someone knows how to do; "I don't know which rule governs this" is work nobody
knows they have. Burying the second under the first is how a measurement
reaches acceptance with an unnoticed hole.

Missing information never becomes `READY`.

### Evidence is not acceptance

Four classes, and the boundaries are enforced by CHECK constraints:

```text
RAW_EVIDENCE         the record as captured
DERIVED_EVIDENCE     inferred by the existing execution-matching resolver
VALIDATED_EVIDENCE   a human checked it        (requires validated_by)
ACCEPTANCE_EVIDENCE  a document or signed record (manual link only)
```

System-inferred evidence can never rise above `DERIVED_EVIDENCE`. Ponto and
location data reuse the existing project attribution resolver and its declared
thresholds (`AUTOMATION_POLICY`); Phase 6 invented no new threshold.

### Approval Engine — mechanism, no invented policy

`project_measurement` is registered as an approval subject with a real content
fingerprint over the exact revision, so a material change invalidates a prior
approval. `approval_engine_cutover` remains **empty** for measurement, and no
acceptance policy was seeded. The Phase 6 audit found the same picture Phase 5
found for Contracts: zero measurement rules, zero measurements, zero policies,
no authority limit anywhere. Per §33/§100, that means mechanism and stop.

Phase 6 does not depend on the Contracts cutover.

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

## 12. Phase 7 — Billing ↔ Fiscal ↔ Finance, settled

Migrations 135–139. The chain the phase closed:

```text
accepted measurement / fixed contractual entitlement
  → billing candidate with AMOUNT PROVENANCE
    → eligibility with machine-readable reasons
      → governed human release, bound to a fingerprint
        → durable fiscal request (Fiscal decides)
          → authorized NFS-e
            → canonical Accounts Receivable (Finance decides)
              → settlement → reconciliation
                → contract_to_cash_read_model
```

### D7.1 — The Finance foundation predated the tenant model, and was hardened first

The audit found `apar_title`, `ledger_entry`, `period_close` and
`finance_audit_log` with **no `organization_id`**, RLS scoped by finance ROLE
only, and `period_close.period_key` unique **globally** — one tenant closing a
month closed it for everyone. All four were empty, which is why 135 could add
the column `NOT NULL` without rewriting history.

Role and tenant now apply together. Phase 7 did not redesign Finance
authorization beyond the tables it touches.

### D7.2 — Provenance travels with every amount

`billing_amount` is the contractual FORECAST and has **no step** in the
measured-amount precedence. The Phase 6 residual —
`measured_amount ?? billing_amount` written without recording which source
won — is resolved: `contract_billing_create_from_milestone` delegates to the
provenance resolver, and `amount_source` is stored beside the number.

A forecast becomes an entitlement only through
`contract_billing_entitlement_rules`, which requires a clause, a document or a
contractual reference. Column populated is not proof of right.

### D7.3 — Seven dimensions, not one status

Eligibility, release, fiscal, AR, payment, reconciliation and ledger posting
are separate columns and separate states. One status string cannot represent
them without lying about at least three.

### D7.4 — Gross vs net was declared, never inferred

`service_amount_cents` is not automatically the cash receivable: withholding,
deductions and discounts change it. Rather than choose,
`finance_receivable_basis_policies` makes the basis a **governed declaration**
with justification and author. With no row, AR creation refuses with
`AR_BASIS_UNCONFIGURED` and nothing is created.

The same posture governs accounting mapping (`finance_posting_rules`) and
fiscal service selection: absent configuration blocks the step and names the
blocker, instead of guessing.

### D7.5 — Paid is derived; settlement is append-only

`finance_receivables` has no paid column. `finance_receivable_balances` derives
paid, open and status from valid settlements. Settlements never update and
never delete from the application; reversal is a new row pointing at the
original. Overpayment is refused, not absorbed.

Payment and reconciliation are distinct tables because they answer distinct
questions. Fuzzy matching lives in `finance_reconciliation_candidates` and can
never finalize a reconciliation.

Two rules later phases inherit rather than re-decide:

1. **Invoice is not cash, and payment is not reconciliation.** The read model
   returns UNKNOWN — never `R$ 0` — when Finance has no title.
2. **Financial truth is reversible, not erasable.** Cancellation, replacement,
   supersession and reversal preserve the prior record in every path.

## 12. Engineering discipline

- Do not re-audit the whole repository every phase.
- Preflight only what the current phase needs.
- Stop instead of guessing when production evidence conflicts with assumptions.
- Applied migrations are historical records; do not rewrite them after production apply.
- Keep `.preview/` noise out of unrelated commits.
- Do not use demo/mock data to make a feature appear complete.
