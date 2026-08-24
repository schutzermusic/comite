# Financeiro Real Backend + Contracts Integration

## Status
**Deferred / Backlog — do not implement from Contracts.**

This plan records the dependency discovered during Contracts P2C and should be resumed when the Financeiro module is structurally modernized.

## Context
Repository inspection established that:

- `apar_title` is the intended canonical AP/AR domain.
- `ledger_entry` is the intended ledger domain.
- The schema supports payable/receivable, open/partial/paid/overdue/cancelled, partial settlement, ledger linking, source system and idempotency keys.
- The current Financeiro UI still relies on in-memory/mock state (`finance-store.ts`).
- There is no real persisted operational pipeline writing `apar_title` / `ledger_entry`.
- Contracts must not create financial truth and then read it back as if Financeiro owned it.
- Therefore Contracts correctly keeps `Received = Não integrado`.

## Objective
When Financeiro is rebuilt, establish the real chain:

`Contract → Measurement → Approval → Billing → Accounts Receivable → Receipt → Ledger`

Financeiro owns:
- AP/AR;
- financial titles;
- settlements;
- receipts;
- reversals/cancellations;
- ledger entries;
- reconciliation.

Contracts remains an orchestration/consumer layer.

## F0 — Financeiro Architecture Audit
Before coding:

1. Audit all Financeiro routes, components, stores and APIs.
2. Map all consumers of `finance-store.ts`.
3. Map `apar_title`, `ledger_entry`, clients, suppliers, cost centers and RLS.
4. Identify all mock/reference data paths.
5. Confirm tenant/organization model.
6. Confirm the authoritative lifecycle for AP and AR.
7. Identify which existing tables should be preserved, extended or replaced.
8. Avoid parallel financial sources of truth.

## F1 — Real AP/AR Persistence
Replace in-memory AP/AR with a persisted backend supporting:

- create payable/receivable;
- lifecycle-safe editing;
- partial settlement;
- full settlement;
- overdue;
- cancellation/reversal;
- audit;
- idempotent integrations;
- filters/search/pagination;
- RBAC.

The UI must consume persisted data rather than mock arrays.

## F2 — Real Ledger Persistence
Establish `ledger_entry` as a persisted authoritative ledger where appropriate.

Define:
- posting lifecycle;
- reversal model;
- relationship to AP/AR;
- source system;
- external key/idempotency;
- audit;
- tenant ownership.

## F3 — Tenant & Relational Hardening
Review whether financial tables require explicit `organization_id`.

Evaluate, where justified:
- `organization_id` on `apar_title`;
- `organization_id` on `ledger_entry`;
- organization/status/date indexes;
- FK integrity;
- organization consistency constraints/triggers.

Any migration must be additive, backfillable and rollback-safe.

## F4 — Contract ↔ Financeiro Integration Contract
Only after F1–F3 are real.

Define the authoritative relationship between:

`contract_billing_events`
and
`apar_title(type = receivable)`

Preferred flow:

`Contract Billing Event`
→ Financeiro handoff/request
→ Financeiro creates/owns AR
→ settlement updates AR
→ ledger records financial event
→ Contracts reads resulting state

Contracts must not maintain a competing `received_amount` truth.

## Required Integration States
Contracts must distinguish:

- not integrated;
- no financial title;
- open;
- partial;
- paid;
- overdue;
- cancelled/reversed;
- read/integration error.

Missing data must never become `R$ 0`.

## F5 — Billing → AR Workflow
Recommended sequence:

1. Contract milestone becomes eligible.
2. Billing event is created/approved.
3. Financial handoff/request is created.
4. Financeiro validates/accepts and creates the receivable.
5. Relationship is persisted and audited.
6. Financeiro owns settlement lifecycle.

If an event/outbox architecture exists, prefer a durable event such as:

`contract.billing.ready_for_receivable`

## F6 — Contract-to-Cash Completion
Once Financeiro persistence exists, Contracts may show:

`Contracted`
→ `Measured`
→ `Approved`
→ `Billed`
→ `Receivable`
→ `Received`

`Received` must derive only from authoritative Financeiro settlement data.

Partial receipts must be represented correctly.

## F7 — Connected Operations
After integration, the Financeiro row inside Contracts should show real state, e.g.:

- open amount;
- received amount;
- overdue titles;
- authoritative financial status.

Clicking must navigate to the owning Financeiro context.

Do not reproduce the full Financeiro workspace inside Contracts.

## F8 — Reconciliation & Integrity
Add deterministic checks for:

- billed value without AR;
- AR without source billing event;
- duplicate AR from one billing event;
- received > billed;
- paid title without settlement evidence;
- cancelled/reversed title counted as received;
- organization mismatch;
- orphan relationships;
- duplicate external keys.

These should become operational signals.

## F9 — Testing
### Unit / Integration
- AP/AR lifecycle;
- partial/full settlement;
- overdue;
- cancellation/reversal;
- idempotency;
- tenant isolation;
- billing → AR mapping;
- Contract-to-Cash derived state;
- missing/error behavior.

### Authenticated E2E
- create receivable;
- create/link AR from approved contract billing flow;
- partial receipt;
- full receipt;
- overdue;
- cancellation;
- Contract-to-Cash update;
- Contracts → Financeiro navigation;
- retry without duplicate title;
- RBAC.

## Architectural Rules
1. Financeiro owns financial truth.
2. Contracts orchestrates and consumes; it does not duplicate.
3. `Received` never comes from a Contracts-local field when Financeiro owns it.
4. Missing persistence = `Não integrado`, not zero.
5. Cross-module links must be auditable.
6. Idempotency is mandatory.
7. Tenant isolation must be explicit and testable.
8. Never integrate Contracts with mock/in-memory Financeiro data.
9. Do not implement this opportunistically from another module.
10. Complete Financeiro persistence first; connect Contracts second.

## Explicit Deferred Dependency
Until this plan is implemented:

> **Contracts → Financeiro remains NOT INTEGRATED.**

Contract-to-Cash stops at **BILLED**.

`RECEIVED` remains explicitly unavailable / not integrated.

This is intentional architecture, not a Contracts defect.

## Re-entry Criteria
Resume this plan when:

- Financeiro restructuring is active;
- persisted AP/AR is in scope;
- persisted ledger is in scope;
- tenant model is confirmed;
- Financeiro lifecycle is defined;
- Contracts can integrate without becoming the financial source of truth.

At that point, restart from **F0 — Financeiro Architecture Audit** and update this document against the then-current repository before coding.
