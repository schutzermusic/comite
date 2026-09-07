# Contracts V2 — Phase 7 Execution Specification

Status: **APPROVED EXECUTION SPEC — PHASE 7**

Phase: **Billing ↔ Fiscal ↔ Finance**

Repository target:

```text
plan/contracts-v2/phase-7-execution.md
```

Primary references:

- `plan/contracts-v2/architecture.md`
- `plan/contracts-v2/deferred-items.md`
- `plan/contracts-v2/phase-6-execution.md`
- `plan/contracts-v2/phase-5-execution.md`
- `plan/contracts-v2/phase-4-execution.md`
- `docs/runbooks/project-measurement.md`
- existing Fiscal NFS-e runbooks/configuration

Execution rule:

> Frozen architecture first. This specification second. Repository and production evidence third. If evidence conflicts with assumptions, STOP instead of inventing financial, fiscal, accounting, settlement or billing truth.

---

# 1. Baseline

Expected starting point after Phase 6 merge:

```text
main = 0b26eb26eeb9d8b8c6f072097b75eb4f4f2f992c
migration registry tip = 134
090 = intentionally never applied and superseded
```

Phase 4 provides:

```text
domain_events
transactional outbox
apex_jobs
typed routing
retry / dead-letter
scheduler
causation / correlation
```

Phase 5 provides:

```text
shared Approval Engine
versioned policy
SoD
authority/delegation
atomic decisions
approval events
```

Phase 6 provides:

```text
canonical Project-owned measurements
rule → measurement lineage
measurement readiness
submission
authoritative acceptance/rejection
accepted measurement immutability
projects.measurement.accepted event
```

Frozen measured-amount precedence remains:

```text
accepted canonical project measurement
→ legacy contract_milestones.measured_amount
→ UNKNOWN
```

Never fallback to:

```text
billing_amount
```

Suggested branch:

```text
feat/contracts-v2-phase-7
```

Create from updated `main`.

---

# 2. Phase 7 objective

Close the real contract-to-cash chain:

```text
ACCEPTED MEASUREMENT / CONTRACTUAL ENTITLEMENT
        ↓
BILLING ELIGIBILITY
        ↓
BILLING RELEASE
        ↓
FISCAL DOCUMENT
        ↓
ACCOUNTS RECEIVABLE
        ↓
DUE
        ↓
PAYMENT / PARTIAL PAYMENT
        ↓
RECONCILIATION
        ↓
SETTLEMENT
```

The system must truthfully know:

```text
what may be billed
why it may or may not be billed
what was released
what was invoiced
what became receivable
what was actually paid
what remains open
what was reconciled
```

Do not turn Contracts into a Finance/Fiscal shadow system.

---

# 3. Frozen ownership boundary

## Contracts owns

```text
contractual billing conditions
contractual billing eligibility rules
billing event / entitlement context
retention / glosa / dispute contractual context
contract-side read model
links to measurement / Fiscal / Finance truth
```

## Projects owns

```text
accepted measurement
measurement amount / quantity
acceptance provenance
measurement revision/history
```

## Fiscal owns

```text
fiscal_documents
NFS-e lifecycle
provider transmission
authorization/cancellation/replacement
fiscal snapshots
tax breakdown
fiscal_jobs
```

## Finance owns

```text
ledger_entry
accounts receivable
settlements
reconciliations
payment allocation
open balance
paid/received outcome
financial posting/reversal
```

## Platform owns

```text
domain_events
apex_jobs
Approval Engine
audit primitives
notifications
```

Absolute:

```text
Contracts NEVER writes Finance directly.
Contracts NEVER writes Fiscal directly.
```

Cross-domain flow:

```text
Contracts/Projects fact
→ domain_events
→ domain-owned handler/service
→ authoritative Fiscal/Finance mutation
```

---

# 4. Critical Finance warning

The current Finance foundation predates the newer Contracts V2 tenant model.

The existing Finance schema must be audited before any Phase 7 cross-domain write.

Known legacy concerns to verify:

```text
ledger_entry originally lacks organization_id
apar_title originally lacks organization_id
legacy Finance RLS is role-based rather than org-scoped
legacy client / supplier coexist with canonical parties
legacy cost_center coexists with canonical finance_cost_centers
paid_amount_cents is mutable legacy state
contract_id / project_id may lack strong same-org FKs
```

Do not trust table names such as `apar_title` or `ledger_entry` merely because they sound canonical.

---

# 5. Mandatory focused audit

Before migration 135, audit only the Phase 7 chain.

At minimum:

```text
contract_billing_events
contract_milestones
project_measurements
project_measurement events
contract billing conditions
contract obligations that block billing
fiscal_documents
fiscal_jobs
fiscal production gates
apar_title
ledger_entry
period_close
finance_audit_log
business_unit
cost_center
finance_cost_centers
client
supplier
parties
Finance RLS/helpers
Finance AR UI/APIs
Finance payment/reconciliation imports if any
existing billing helper functions
createBillingEventFromMilestone or equivalents
```

Produce:

```text
OBJECT
OWNER
SOURCE OF TRUTH?
ROW COUNT
REAL / DEMO / LEGACY
ORG-SCOPED?
RLS SAFE?
CURRENT WRITE PATH
CURRENT READ PATH
IDEMPOTENCY
MIGRATION ACTION
```

Do not re-audit unrelated modules.

---

# 6. Mandatory baseline gate

Continue only if:

```text
PHASE 6 MERGED: YES
PRODUCTION GREEN: YES
MIGRATION REGISTRY CONSISTENT: YES
REGISTRY TIP >= 134: YES
090 EXCEPTION EXPLICIT: YES
EVENT GRAPH HEALTHY: YES
APEX JOBS HEALTHY: YES
APPROVAL ENGINE HEALTHY: YES
PROJECT MEASUREMENT HEALTHY: YES
FINANCE TARGET TABLES AUDITED: YES
FISCAL TARGET TABLES AUDITED: YES
CONTRACT BILLING PATH AUDITED: YES
CURRENT REAL ROW COUNTS CAPTURED: YES
```

Otherwise STOP.

---

# 7. Finance tenant-hardening gate

Before any real automated Finance write, prove for every target:

```text
organization ownership is structural
same-org references are structural where possible
RLS/read paths cannot cross org
browser cannot forge settlement/reconciliation
service paths validate org
TRUNCATE remains revoked from anon/authenticated
```

If current Finance targets are not safely org-scoped:

```text
HARDEN THEM FIRST
```

with additive migrations.

Do not hide tenant gaps behind server-only code.

---

# 8. Canonical Party boundary

New Phase 7 AR links must prefer:

```text
parties
```

as the canonical counterparty.

Legacy:

```text
client
supplier
```

may remain for compatibility.

Do not fuzzy-map legacy client/supplier to Party.

Only deterministic proven links become canonical.

---

# 9. Canonical cost center boundary

Use:

```text
finance_cost_centers
```

for new Phase 7 cross-domain financial context.

Do not expand legacy `cost_center` as if it were canonical.

If `ledger_entry.cost_center_id` still references legacy cost centers, create an explicit bridge/cutover or report configuration blocked.

Never guess mappings.

---

# 10. Billing event role

Audit whether existing:

```text
contract_billing_events
```

can safely evolve into the canonical Contracts-side billing event/entitlement record.

Billing event means:

```text
commercial entitlement / billing candidate context
```

It is NOT:

```text
invoice
AR
payment
settlement
```

If existing table can be extended without historical lies, reuse it.

Otherwise create a canonical successor with explicit compatibility.

Do not create two competing billing truths.

---

# 11. Billing amount provenance — mandatory

Every billable amount must expose:

```text
amount
currency
amount_source
source_id
source_revision / fingerprint where relevant
derived_at
derivation rule/version
```

Recommended conceptual sources:

```text
ACCEPTED_MEASUREMENT
LEGACY_MEASURED_AMOUNT
FIXED_CONTRACT_ENTITLEMENT
GOVERNED_ADJUSTMENT
```

`billing_amount` may represent forecast/planned billing.

It is not measured truth.

If a populated `billing_amount` is legally a fixed entitlement, this must be proven by contractual rule and recorded explicitly as:

```text
FIXED_CONTRACT_ENTITLEMENT
```

Do not infer this merely because the column has a value.

---

# 12. Resolve the Phase 6 residual

Audit `createBillingEventFromMilestone` and every equivalent legacy path.

Required outcome:

```text
billing event amount provenance is explicit
```

Remove any opaque business logic equivalent to:

```text
measured_amount ?? billing_amount
```

when the downstream record cannot tell which source won.

A forecast `billing_amount` cannot produce released billing without explicit contractual entitlement.

---

# 13. Measurement precedence remains frozen

For measured truth:

```text
accepted canonical project measurement
→ legacy contract_milestones.measured_amount
→ UNKNOWN
```

Never:

```text
→ billing_amount
```

Retain permanent regression tests from Phase 6.

---

# 14. Accepted measurement is not billing release

Keep distinct:

```text
measurement ACCEPTED
billing ELIGIBLE
billing RELEASED
invoice AUTHORIZED
AR OPEN
payment RECEIVED
reconciliation COMPLETE
settlement FINAL
```

No background worker may silently equate these states.

---

# 15. Billing eligibility resolver

Build one canonical resolver.

Inputs may include:

```text
accepted measurement
fixed contractual entitlement
contract billing conditions
obligation blockers
required documents
formal acceptance
retention
glosa/dispute
prior billing
contract temporal lineage
counterparty readiness
Fiscal configuration readiness
```

Result:

```text
ELIGIBLE
BLOCKED
INCOMPLETE
NOT_APPLICABLE
UNKNOWN
```

Missing truth must never become `ELIGIBLE`.

---

# 16. Eligibility reason codes

Return machine-readable reasons, for example:

```text
MEASUREMENT_NOT_ACCEPTED
MEASUREMENT_UNKNOWN
CONTRACT_RULE_UNRESOLVED
OBLIGATION_BLOCKING
REQUIRED_DOCUMENT_MISSING
FORMAL_ACCEPTANCE_PENDING
RETENTION_APPLIES
DISPUTE_OPEN
AMOUNT_UNKNOWN
CURRENCY_UNKNOWN
COUNTERPARTY_UNRESOLVED
FISCAL_PROFILE_INCOMPLETE
ACCOUNTING_CONFIGURATION_MISSING
```

Do not return a single opaque boolean.

---

# 17. Billing release

Eligibility and release are distinct.

Conceptual lifecycle:

```text
NOT_ELIGIBLE
ELIGIBLE
PENDING_RELEASE
RELEASED
RELEASE_REJECTED
CANCELLED
SUPERSEDED
```

Exact vocabulary may adapt after audit.

Default posture:

```text
system prepares
human/governed rule releases
```

Do not auto-release merely because eligibility becomes true unless a real explicit policy authorizes it.

---

# 18. Approval Engine integration

If real governance exists:

```text
decision_purpose = RELEASE
subject = exact billing event revision/fingerprint
```

Use shared Approval Engine.

If no real policy exists:

```text
do not invent one
```

Do not create arbitrary alçadas or approver names.

---

# 19. Billing release fingerprint

Release binds to exact facts:

```text
source measurement/revision
gross eligible amount
retention
glosa
adjustments
currency
counterparty
billing rule
```

Material change invalidates/supersedes old release.

No silent amount mutation after release.

---

# 20. Transactional release event

Billing release and its domain event commit together.

Likely fact:

```text
contracts.billing.released
```

after event-vocabulary audit.

Never:

```text
commit release
→ second HTTP call to emit
```

---

# 21. Phase 6 accepted-measurement consumer

`projects.measurement.accepted` is the first canonical Phase 7 upstream fact.

Handler must be idempotent:

```text
accepted measurement
→ billing candidate / eligibility recompute
```

It does NOT automatically release billing.

Replay must not duplicate candidate/event.

---

# 22. Billing event idempotency

Stable key should include:

```text
organization
contract
source type
source id/revision
billing rule/occurrence
```

Repeated event delivery creates no duplicate entitlement.

---

# 23. Billing cardinality

Audit whether reality requires:

```text
one measurement → one invoice
many measurements → one invoice
one measurement → many partial invoices
```

Do not force 1:1 without evidence.

When aggregation/splitting exists, preserve exact allocation and cent conservation.

---

# 24. Partial billing

If real semantics support it, track:

```text
eligible amount
released amount
invoiced amount
remaining billable amount
```

Never duplicate full measurement amount across partial invoices.

If no real evidence for partial billing exists, defer rather than invent.

---

# 25. Retention

Retention is distinct from:

```text
tax withholding
glosa
unpaid AR
```

Model separately where real.

Preserve:

```text
retained amount
rule/provenance
release condition
release history
```

Never rewrite measurement amount.

---

# 26. Glosa

Glosa is distinct from measurement rejection.

A measurement may remain accepted while billing/invoice is reduced.

Store:

```text
base billing amount
glosa amount
reason
source/counterparty
status
effective billable amount
history
```

Never overwrite accepted measurement to match glosa.

---

# 27. Dispute

If real business process requires it, model dispute separately.

Possible lifecycle:

```text
OPEN
UNDER_REVIEW
RESOLVED
CANCELLED
```

Do not overload `apar_title.status`.

If no real dispute semantics exist yet, defer.

---

# 28. Governed commercial adjustments

Manual adjustment must be explicit:

```text
original amount
adjustment
reason code
reason text
actor
approval reference if required
timestamp
```

No silent overwrite.

---

# 29. Fiscal boundary

Contracts never inserts directly into `fiscal_documents`.

Preferred:

```text
billing RELEASED
→ domain event
→ Fiscal handler/service
→ Fiscal draft/request
```

Fiscal remains authoritative.

---

# 30. Fiscal production gate remains absolute

Phase 7 must not enable real NFS-e merely because billing is released.

Real issuance still depends on:

```text
certificate
issuer config
municipal registration
service catalog
tax config
provider/homologation
production gate
```

If unavailable:

```text
REAL FISCAL ISSUANCE = BLOCKED_BY_CONFIGURATION
```

Adapter existence is not issuance proof.

---

# 31. Fiscal document linkage

Add/verify explicit same-org linkage between billing provenance and Fiscal document.

Frozen architectural target:

```text
contract_billing_events.fiscal_document_id
```

or a dedicated allocation/link structure if cardinality requires many-to-many.

Never match invoices to billing events by amount/date heuristics.

---

# 32. Fiscal cardinality

Audit:

```text
one billing event → one invoice
one billing event → multiple invoices
multiple events → one invoice
replacement/cancellation
```

Use dedicated allocation table if needed.

---

# 33. Fiscal authorization event

Authorized invoice creates an authoritative Fiscal fact for Finance.

Conceptual event:

```text
fiscal.document.authorized
```

Payload should include safe identifiers and business fields only:

```text
document
billing provenance
amount basis
withholdings
party
contract/project
competence
issue/due date
```

Never place provider secrets/raw XML into domain event payload.

---

# 34. Fiscal cancellation / replacement

Support causal reversal:

```text
fiscal authorized
→ AR created

fiscal cancelled/replaced
→ Finance reversal/supersession
```

Never hard-delete invoice or AR history.

---

# 35. Accounts receivable ownership

AR belongs to Finance.

Contracts can read it.

Contracts cannot directly mutate:

```text
paid amount
status
due
payment
reconciliation
```

---

# 36. AP/AR canonical audit

Before reusing `apar_title`, verify:

```text
organization_id
party_id
contract/project same-org links
fiscal_document_id
billing_event_id
currency
original amount
open amount
paid amount
due date
status
source/idempotency
history
RLS
```

If insufficient:

```text
extend safely
or create canonical successor
```

Do not declare the legacy table canonical without evidence.

---

# 37. AR structural tenant scope

Canonical receivable must include:

```text
organization_id
```

and same-org links to relevant:

```text
party
contract
project
billing event
fiscal document
cost center/business unit
```

If existing `apar_title` lacks this, harden before automation.

---

# 38. AR idempotency

Authorized Fiscal document replay must not duplicate AR.

Stable key:

```text
organization + fiscal document + installment key
```

or equivalent.

---

# 39. Installments

Support real structured payment terms.

Each installment:

```text
sequence
due_date
original_amount
currency
open_amount
status projection
```

Sum must equal authoritative receivable basis.

Do not invent due dates from free-text `payment_terms`.

If structured terms are unavailable:

```text
UNKNOWN / configuration required
```

---

# 40. AR amount basis — critical

Do not assume:

```text
service_amount_cents = receivable cash amount
```

because:

```text
withholding
deductions
taxes
discounts
retention
```

can change cash receivable.

Define authoritative basis explicitly.

If gross-vs-net semantics cannot be proven:

```text
STOP
```

Do not choose one silently.

---

# 41. Finance ledger posting

Finance owns ledger posting.

Only Finance service/function may create `ledger_entry`.

Required provenance:

```text
source domain
source document
billing event
AR title
contract/project
party
cost center
business unit
category/account mapping
```

Contracts/Fiscal UI must not directly insert ledger entries.

---

# 42. Accounting configuration gate

If authoritative:

```text
management category
cost center
business unit
account mapping
```

is missing:

```text
ledger posting = PENDING_CONFIGURATION / BLOCKED
```

Do not invent accounting mappings to make smoke pass.

---

# 43. Period-close safety

Respect existing:

```text
open
soft_close
closed
```

Finance periods.

No bypass.

Late facts must use legitimate adjustment/reversal semantics.

Do not rewrite dates to force posting.

---

# 44. Settlement model

Create/use append-only Finance settlement facts.

Conceptually:

```text
apar_settlement
```

with:

```text
organization_id
receivable_id
amount
currency
effective_date
received_at
source
external payment/bank reference
actor/source
reversal_of
correlation
created_at
```

Settlement is authoritative history.

---

# 45. Paid / received is derived

Canonical:

```text
paid_amount
received_amount
open_amount
```

derive from valid non-reversed settlements/payment allocations.

Do not keep `apar_title.paid_amount_cents` as primary mutable truth.

It may remain legacy/cache compatibility.

---

# 46. Partial payments

Prove:

```text
AR 100
settlement 40
→ paid 40
→ open 60
→ PARTIAL

settlement +60
→ paid 100
→ open 0
→ PAID
```

No rounding drift.

---

# 47. Overpayment

Open balance must never silently become negative.

If payment > open amount:

```text
unallocated credit
or REVIEW_REQUIRED
```

using an existing safe Finance model.

If no model exists, STOP rather than accepting overpayment silently.

---

# 48. Payment allocation

One cash receipt may cover:

```text
one AR
multiple ARs
partial ARs
```

If needed, model payment allocation separately from settlement.

Do not duplicate the same bank transaction into unrelated settlements without shared source identity.

---

# 49. Reconciliation

Reconciliation answers:

```text
does recorded settlement correspond to authoritative bank/cash evidence?
```

It is distinct from payment recording.

Possible states:

```text
UNRECONCILED
MATCHED
PARTIAL
MISMATCH
REVIEW_REQUIRED
RECONCILED
REVERSED
```

Adapt after audit.

---

# 50. No fake bank integration

If no real bank/payment source exists:

- build canonical reconciliation model;
- test with disposable evidence;
- keep automatic real-bank reconciliation disabled;
- support governed/manual reconciliation only if current process allows it.

Report:

```text
REAL AUTO-RECONCILIATION = BLOCKED_BY_SOURCE
```

Do not fake bank confirmation.

---

# 51. Reconciliation source provenance

Possible authoritative sources:

```text
OFX
CNAB
bank API
ERP import
payment provider
manual bank proof
```

Record stable source identity/hash/reference.

---

# 52. Reconciliation idempotency

Repeated import of same bank transaction must not duplicate settlement.

Prefer external transaction ID.

If no stable source ID exists, use deterministic fingerprint with collision/review handling.

---

# 53. Fuzzy matching is proposal only

Fuzzy payer/date/amount matching may create:

```text
MATCH_CANDIDATE
```

It may not finalize reconciliation automatically.

Only deterministic rules explicitly frozen by Finance can auto-reconcile.

---

# 54. Receivable status derivation

Prefer status derived from:

```text
original amount
valid settlements
open amount
due date
cancellation/reversal
```

Conceptual:

```text
OPEN
PARTIAL
PAID
OVERDUE
CANCELLED
REVERSED
```

Do not rely on forgotten manual status updates.

---

# 55. Overdue

Derived when:

```text
open_amount > 0
AND due_date < current/business date
AND not cancelled/reversed
```

Payment clears overdue through derivation.

---

# 56. Renegotiation

Preserve old receivable.

Preferred:

```text
original AR superseded/renegotiated
→ new titles/schedule
→ explicit linkage
```

Do not overwrite original amount/due date and erase history.

---

# 57. Cancellation / reversal

Financial truth is reversible, not erasable.

Support explicit:

```text
billing cancellation
invoice cancellation/replacement
AR cancellation/reversal
settlement reversal
reconciliation reversal
ledger reversal
```

No hard-delete history.

---

# 58. Contract-side received value

Contracts derives:

```text
invoiced
receivable
received
open
overdue
reconciled
```

from Fiscal/Finance read models.

No Contracts-owned `paid_amount` or `paid_at` may remain authoritative.

---

# 59. Legacy `contract_billing_events.paid_at`

Audit current usage.

Do not continue to use it as canonical payment truth.

Historical value may remain legacy provenance.

New truth comes from Finance settlement.

---

# 60. Billing status dimensions

Do not collapse the chain into one `status`.

Keep dimensions:

```text
eligibility
release
Fiscal
AR
payment
reconciliation
settlement
```

One status string cannot represent them faithfully.

---

# 61. Canonical contract-to-cash read model

Build one shared resolver/service per billing event:

```text
source measurement/entitlement
amount + provenance
eligibility
blockers
release
retention/glosa/dispute
Fiscal document(s)
invoice status
AR title(s)
due
original receivable
received
open
overdue
reconciliation
settlement
```

Contracts UI consumes this service.

---

# 62. Missing truth semantics

Never show:

```text
R$ 0 recebido
```

when Finance is unlinked/unknown.

Use:

```text
UNKNOWN
NOT_LINKED
PENDING_CONFIGURATION
```

Zero means proven zero.

---

# 63. Finance → Contracts direction

Frozen:

```text
Finance authoritative tables
→ read model
→ Contracts
```

Avoid copying Finance values into Contracts as parallel truth.

If cache is required, expose:

```text
computed_at
source fingerprint/version
```

---

# 64. Event vocabulary

Audit event registry first.

Potential Phase 7 facts:

```text
contracts.billing.eligible
contracts.billing.blocked
contracts.billing.released
contracts.billing.cancelled
fiscal.document.authorized
fiscal.document.cancelled
fiscal.document.replaced
finance.receivable.created
finance.receivable.partial
finance.receivable.paid
finance.settlement.recorded
finance.settlement.reversed
finance.reconciliation.completed
finance.reconciliation.reversed
```

Emit only authoritative facts.

---

# 65. Transactional outbox

Each domain mutation + its own fact commit together.

Examples:

```text
billing release + event
Fiscal authorization + event
AR create + event
settlement + event
reconciliation + event
```

No best-effort post-commit event.

---

# 66. Cross-domain execution

Use:

```text
domain_events
→ apex_jobs / domain-owned handler
```

for cross-domain reactions.

Frozen exception:

```text
Fiscal provider transmission remains fiscal_jobs
```

Do not migrate Fiscal provider queue into `apex_jobs`.

---

# 67. At-least-once

Every handler is idempotent.

Prove replay safety for:

```text
measurement accepted
billing released
Fiscal authorized
Fiscal cancelled/replaced
payment import
settlement reverse
reconciliation reverse
```

Do not claim exactly-once delivery.

---

# 68. Causation chain

Preserve:

```text
projects.measurement.accepted
→ contracts.billing.*
→ fiscal.document.*
→ finance.receivable.*
→ finance.settlement.*
→ finance.reconciliation.*
```

with same-org causation/correlation.

---

# 69. Browser write boundary

Browser must not directly forge:

```text
billing release
Fiscal authorization
AR
settlement
reconciliation
ledger posting
```

Use controlled domain service/RPC/server path.

---

# 70. Actor integrity

Human actor derives from authenticated identity.

Browser cannot set:

```text
released_by = another user
reconciled_by = another user
```

System facts identify system source.

AI never impersonates actors.

---

# 71. SECURITY DEFINER rules

Any new SECURITY DEFINER function must:

```text
set safe search_path
validate org/caller
avoid cross-tenant existence oracle
not trust caller actor id
use explicit grants
pass live service-role and authenticated tests
```

---

# 72. Same-org FKs

Enforce composite tenant FKs where possible:

```text
billing ↔ contract
billing ↔ measurement
billing ↔ Fiscal linkage
AR ↔ Party
AR ↔ contract/project
AR ↔ billing event
AR ↔ Fiscal document
settlement ↔ AR
reconciliation ↔ settlement/payment source
```

RLS alone is insufficient.

---

# 73. Finance RLS modernization boundary

Do not rewrite every Finance permission in Phase 7.

But every Phase 7 path must be safe.

If old broad RLS exists on touched tables:

```text
harden those tables/read models now
```

and defer unrelated cleanup.

---

# 74. Legacy Finance roles vs Platform RBAC

Audit coexistence:

```text
user_finance_role
Platform permissions
```

Do not silently grant old roles broader cross-domain authority.

Avoid big-bang RBAC rewrite unless required for safety.

---

# 75. Shared Approval Engine only

Any Phase 7 approval requirement uses shared Approval Engine.

Do not build a Finance-specific approval engine.

Potential governed actions:

```text
billing release
large adjustment
manual reconciliation exception
write-off
```

Only where real policy exists.

---

# 76. Write-off

If no real write-off policy/process exists:

```text
defer
```

Do not disguise write-off as cancellation.

If implemented, it must be explicit, governed, immutable and auditable.

---

# 77. Retention vs tax withholding vs glosa

Keep separate:

```text
contractual retention
Fiscal tax withholding
commercial glosa
```

Different semantics, different owners.

---

# 78. Currency

Preserve currency throughout.

No portfolio aggregation across currencies without explicit FX policy.

No invented FX source.

---

# 79. Precision

Use integer cents for BRL Finance/Fiscal flows where current schemas do.

Never floating-point currency.

When crossing from Contracts numeric decimal, use explicit deterministic rounding.

---

# 80. Cent conservation

Prove:

```text
sum(installments/allocations) = authoritative total
```

including:

```text
partial billing
retention release
payment allocation
reversal
```

No cent drift.

---

# 81. Fiscal snapshot immutability

Authorized Fiscal document snapshots remain immutable.

Replacement creates new Fiscal truth.

Phase 7 must never mutate authorized snapshots in place.

---

# 82. Finance history immutability

Posted/reconciled/settled facts change through:

```text
adjustment
reversal
supersession
```

not silent edit/delete.

---

# 83. Ledger provenance

Automated ledger entries must include stable provenance:

```text
source_system
source_ref
idempotency/external key
contract/project
Fiscal document
AR
correlation
```

Never write system-generated rows with misleading `manual` source.

---

# 84. Revenue is not cash

Keep distinct:

```text
billing/invoice
revenue recognition
AR
cash receipt
```

Do not show invoice as received.

Do not redesign entire DRE accounting model in Phase 7.

---

# 85. Contracts UI

Contracts navigation remains unchanged.

`Faturamentos` becomes the operational contract-to-cash view.

No new Recebimentos workspace under Contracts.

---

# 86. Faturamentos view

Show real chain per event:

```text
contract
project/measurement
eligible amount
amount source
eligibility + blockers
release
retention
glosa/dispute
invoice
AR
due date
received
open balance
reconciliation
```

No fake AI metrics/cards.

---

# 87. Contract dossier Financeiro

Use the same canonical contract-to-cash service filtered to one contract.

No second calculation implementation.

---

# 88. Finance UI

Finance remains operator for:

```text
AR
settlement
reconciliation
ledger
```

Modernize only what canonical Phase 7 operation requires.

Do not redesign the whole Finance product.

---

# 89. Fiscal UI

Fiscal remains operator for invoice lifecycle/provider controls.

Contracts may show linked status only.

---

# 90. Operational automation

Allowed:

```text
accepted measurement → candidate
eligibility recompute
governed release → Fiscal request
authorized invoice → AR
derive open/overdue
process deterministic payment source
route reconciliation work
```

Not allowed:

```text
invent release
invent Fiscal authorization
invent payment
invent reconciliation
invent write-off
```

---

# 91. Manager-as-observer objective

Reduce duplicate manual input:

```text
accepted measurement
→ candidate appears
→ blockers explained
→ release routes automatically
→ Fiscal authorization creates AR
→ payment/reconciliation updates open/received
```

Humans decide gates/exceptions, not retype facts.

---

# 92. No manual duplicate invoice entry

Fiscal-authoritative fields should flow into Finance automatically where configured.

Do not require Finance to re-enter:

```text
invoice number
party
contract
amount
due
```

from an already-authoritative Fiscal document.

---

# 93. Notifications

Use existing notification infrastructure only.

Potential notifications:

```text
eligible but unreleased
released but Fiscal blocked
authorized invoice but AR failed
overdue AR
unmatched payment
open dispute
```

Notifications never mutate truth.

---

# 94. Health / observability

Expose internal health for:

```text
released with no Fiscal work
authorized Fiscal with no AR
AR anomaly
negative/open balance anomaly
unreconciled settlements
duplicate causal chain
Phase 7 dead letters
Finance posting blocked by config
```

Do not build Phase 9 Control Tower.

---

# 95. Billing event supersession

Material post-release change:

```text
new version / successor / reversal
```

not silent mutation.

---

# 96. Contract amendments

Use as-of contractual billing rules.

Later amendment must not rewrite historical billing entitlement.

---

# 97. Billing condition provenance

Eligibility/readiness must answer:

```text
why can/can't we bill?
```

with references to:

```text
contract clause
billing condition
measurement
obligation
acceptance
retention
amendment
```

---

# 98. No AI financial truth

AI may summarize/explain.

AI may not:

```text
declare billable
release
set invoice amount
mark payment
reconcile
write off
```

in Phase 7.

---

# 99. Demo / official separation

Demo/mock/unclassified roots do not enter official contract-to-cash metrics.

No auto-promotion.

---

# 100. Disposable production smoke discipline

If production smoke is used, cleanup must independently verify zero residue across:

```text
billing
Fiscal docs/jobs
AR
settlements
reconciliations
ledger
events/jobs
test organization/project/contract/measurement
```

Dry-run output alone is not cleanup proof.

---

# 101. Real production proof gate

Do not claim real contract-to-cash proven unless a real chain exists:

```text
live contract
→ real structured billing rule
→ accepted real measurement or fixed entitlement
→ real release
→ real authorized Fiscal document
→ real AR
→ real payment evidence
→ real reconciliation
```

If unavailable:

```text
REAL CONTRACT-TO-CASH FLOW = BLOCKED_BY_REAL_DATA
```

Infrastructure can still be complete.

---

# 102. Real Fiscal proof gate

If real credentials/config/provider response are unavailable:

```text
REAL FISCAL ISSUANCE = BLOCKED_BY_CONFIGURATION
```

Do not fake authorization.

---

# 103. Real reconciliation proof gate

If no real bank/payment source exists:

```text
REAL AUTO-RECONCILIATION = BLOCKED_BY_SOURCE
```

---

# 104. Migration strategy

Do not edit migrations 001–134.

Inspect registry first.

If tip remains 134, likely:

```text
135 — Finance tenant / canonical AR hardening
136 — billing entitlement / release + measurement bridge
137 — Fiscal linkage / authorized-invoice bridge
138 — settlements / payment allocation / reconciliation
139 — read models / events / legacy compatibility
140+ — evidence-driven corrections only
```

Exact split follows audit.

Never alter applied migrations.

---

# 105. Finance structural pre-apply gate

Before real Finance automation:

```text
AR ORG-SCOPED: YES
SETTLEMENT ORG-SCOPED: YES
RECONCILIATION ORG-SCOPED: YES
PARTY LINKS SAME-ORG: YES
CONTRACT/PROJECT LINKS SAME-ORG: YES
BROWSER CANNOT FORGE SETTLEMENT: YES
PAID AMOUNT DERIVED: YES
DUPLICATE FISCAL→AR PREVENTED: YES
```

Otherwise STOP.

---

# 106. Fiscal structural gate

Before release→Fiscal automation:

```text
FISCAL DOCUMENT ORG-SCOPED: YES
PARTY LINK CANONICAL: YES
CONTRACT/PROJECT SAME-ORG: YES
PRODUCTION GATE INTACT: YES
FISCAL JOBS INTACT: YES
IDEMPOTENCY PROVEN: YES
```

---

# 107. Required billing tests

Prove:

```text
accepted measurement creates one billing candidate
duplicate accepted event creates none
unknown amount blocks eligibility
obligation blocker blocks eligibility
missing requirement never becomes eligible
eligibility does not auto-release
release binds exact fingerprint
material change invalidates/supersedes old release
```

---

# 108. Required amount-provenance tests

Permanent:

```text
accepted measurement → ACCEPTED_MEASUREMENT
legacy measured_amount → LEGACY_MEASURED_AMOUNT
billing_amount only, no contractual entitlement → not measured / not auto-released
fixed entitlement with explicit rule → FIXED_CONTRACT_ENTITLEMENT
```

Every displayed amount exposes source.

---

# 109. Required Fiscal tests

Prove:

```text
release creates Fiscal work idempotently
Contracts cannot direct-write Fiscal
production gate still blocks unauthorized production
authorized Fiscal document links exact billing provenance
cancel/replacement emits facts
replay creates no duplicate Fiscal document
```

---

# 110. Required AR tests

Prove:

```text
authorized Fiscal document creates correct AR
duplicate event does not duplicate AR
same-org Party enforced
same-org billing/contract/project enforced
currency preserved
installment totals reconcile
gross/net basis follows explicit configuration
unknown AR basis blocks
```

---

# 111. Required settlement tests

Prove:

```text
partial settlement
full settlement
duplicate payment idempotency
overpayment refused/unallocated
settlement reversal
open balance recomputation
paid amount derived
```

No authoritative direct `paid_amount` update.

---

# 112. Required reconciliation tests

Prove:

```text
exact source-id match reconciles
duplicate bank transaction does not duplicate
fuzzy match stays proposal
mismatch stays REVIEW_REQUIRED
manual reconciliation records actor/evidence
reversal preserves history
```

If no bank source exists, real integration remains blocked.

---

# 113. Required cancellation / replacement tests

Prove:

```text
Fiscal cancellation → AR reversal/cancel path
payment reversal → open balance reopens
billing cancellation → no deletion
replacement invoice → old/new lineage preserved
```

---

# 114. Required retention/glosa/dispute tests

Only if real semantics exist.

Prove:

```text
measurement truth unchanged
retention separate
glosa separate
effective billable derived transparently
dispute history preserved
```

Otherwise report `NOT_APPLICABLE`.

---

# 115. Required concurrency tests

With real Postgres/two connections:

```text
duplicate measurement-accepted consumer
two release attempts
release vs cancel
Fiscal authorization replay
two AR creation attempts
two settlements racing remaining balance
settlement vs reversal
reconciliation vs reversal
```

No duplicate effect or negative balance.

---

# 116. Failure injection

Prove:

```text
billing mutation + failed event → rollback
AR creation failure after authorized invoice → durable retry, no fake AR
settlement event failure → rollback settlement
reconciliation event failure → rollback reconciliation
ledger posting failure → AR truth remains; posting state becomes blocked/error
```

Cross-domain truth must recover durably.

---

# 117. Tenant security tests

Prove no cross-org:

```text
billing → measurement
billing → Fiscal
Fiscal → AR
AR → Party
AR → contract/project
settlement → AR
reconciliation → settlement/source
```

Test DB + application paths.

---

# 118. Privilege tests

For all new/altered tables:

```text
anon TRUNCATE = 0
authenticated TRUNCATE = 0
```

Prove no direct browser mutation of authoritative financial history.

---

# 119. Read-model tests

Verify:

```text
unknown stays unknown
zero means proven zero
partial payment displays partial
cancelled invoice not collectible
reversed settlement reopens balance
retention/glosa not counted as received
payment state distinct from reconciliation state
```

---

# 120. UI tests

Contracts `Faturamentos`:

```text
real events only
amount source
eligibility/blockers
release
invoice
AR
received/open
reconciliation
```

Contract dossier Financeiro uses same service.

Finance operates AR/settlements/reconciliation.

Fiscal operates issuance.

No duplicate domain calculations in UI.

---

# 121. No fake KPIs

Do not expose:

```text
R$ ready to bill
R$ invoiced
R$ received
DSO
overdue %
```

unless derived only from official real data.

---

# 122. Performance

Index/query-plan coverage:

```text
organization + billing state
source measurement
contract
Fiscal link
AR due/status
Party
contract/project
settlement AR/date
reconciliation source
event idempotency/correlation
```

No portfolio full scan per page.

---

# 123. Scheduler

Reuse existing platform scheduler for Apex jobs.

Do not add another generic scheduler.

Fiscal provider transmission remains `fiscal_jobs`.

---

# 124. Dead-letter behavior

Critical handlers must be replay-safe:

```text
billing→Fiscal
Fiscal→AR
settlement/reconciliation
```

Health output must not expose secrets.

---

# 125. Legacy compatibility

Preserve existing:

```text
contract_billing_events
contract_milestones.billing_amount
contract_milestones.measured_amount
apar_title rows
ledger_entry rows
```

unless deterministic safe migration is proven.

Do not fabricate missing lineage/history.

---

# 126. Legacy `contract_billing_events.status`

If ambiguous, do not mass-reclassify.

Add structured dimensions/read adapter.

Historical text remains historical.

---

# 127. Legacy `apar_title.paid_amount_cents`

Audit source.

If historical paid values lack settlement provenance:

```text
do not fabricate settlement rows
```

Keep them as explicitly legacy truth until a deterministic migration exists.

---

# 128. Source-specific Finance cutover

Do not big-bang all Finance.

After Phase 7 cutover:

```text
new Contract/Fiscal-driven AR
→ canonical new Phase 7 path
```

Unrelated manual/ERP Finance flows may continue.

---

# 129. Billing cutover

Prevent old helper/functions from creating competing billing events for the same source.

No dual-write after cutover.

---

# 130. Fiscal `finance_status`

Define exact meaning of:

```text
not_posted
pending_configuration
posted
reversed
review_required
error
```

Do not mark `posted` merely because an AR exists if ledger posting is a separate requirement.

---

# 131. Billing vs accounting status

Keep separate:

```text
billing released
invoice authorized
AR created
ledger posted
payment received
reconciled
```

No single `completed`.

---

# 132. Collections boundary

Phase 7 may show open/overdue.

Do not build full collections CRM/dunning/legal collection unless already present and strictly necessary.

---

# 133. Risk boundary

Do not implement Phase 8 risk operationalization.

Phase 7 may emit facts for later risk use.

---

# 134. Control Tower boundary

Do not build Phase 9 dashboard.

Only real read models/health primitives.

---

# 135. Autonomy boundary

Do not start general Phase 10 autonomy.

Allowed deterministic automation:

```text
candidate
eligibility recompute
Fiscal request after governed release
AR after Fiscal authorization
derived balances/status
deterministic reconciliation from authoritative identity
```

Forbidden:

```text
invent release
write-off
invent payment
fuzzy auto-reconcile
```

---

# 136. Preview

Create Vercel Preview if available.

Verify:

```text
Contracts Faturamentos
dossier Financeiro
Finance AR
Fiscal linkage
no fake metrics
no Phase 8/9/10 UI
no runtime errors
```

If Preview access unavailable, run equivalent authenticated local E2E and report it.

---

# 137. Regression suite

Run:

```text
Phase 0 Contracts security
Phase 1 Party/tenant
Phase 2 lineage
Phase 3 obligations
Phase 4 Event Graph/jobs
Phase 5 Approval Engine
Phase 6 Project Measurement
Finance unit/integration/RLS
Fiscal safety/provider foundation
migration registry
TRUNCATE hardening
contract-to-cash read model
AR/settlement/reconciliation live tests
concurrency/failure injection
E2E
tsc --noEmit
production build
changed-file lint
```

Keep `.preview/` net diff zero.

---

# 138. Pre-apply gate

Before migrations:

```text
MIGRATION REGISTRY CONSISTENT: YES
CURRENT TIP CONFIRMED: YES
NO VERSION COLLISION: YES
PHASE 6 FINGERPRINT STABLE: YES
FINANCE SCHEMA AUDITED: YES
FINANCE TENANT BOUNDARY SAFE: YES
FISCAL SCHEMA AUDITED: YES
FISCAL PRODUCTION GATE INTACT: YES
CONTRACT BILLING PATH AUDITED: YES
AMOUNT PROVENANCE MODEL VALIDATED: YES
MEASUREMENT PRECEDENCE PRESERVED: YES
AR AMOUNT BASIS VALIDATED: YES
SETTLEMENT MODEL VALIDATED: YES
RECONCILIATION MODEL VALIDATED: YES
TRANSACTIONAL EVENTS PROVEN: YES
TENANT SECURITY GREEN: YES
TRUNCATE HARDENING GREEN: YES
SAFE TO APPLY PHASE 7 MIGRATIONS: YES
```

Otherwise STOP.

---

# 139. Post-apply gate

After production apply:

```text
MIGRATIONS REGISTERED: YES
NO LEGACY HISTORY REWRITTEN: YES
NO FAKE BILLING EVENTS: YES
NO FAKE FISCAL DOCUMENTS: YES
NO FAKE AR: YES
NO FAKE PAYMENTS: YES
NO FAKE RECONCILIATIONS: YES
TRUNCATE GRANTS STILL ZERO: YES
EVENT GRAPH HEALTHY: YES
APEX JOBS HEALTHY: YES
FISCAL JOBS HEALTHY: YES
APPROVAL ENGINE HEALTHY: YES
PROJECT MEASUREMENTS HEALTHY: YES
```

---

# 140. STOP conditions

STOP if:

- Finance target is not safely org-scoped;
- cross-tenant AR/settlement/reconciliation relation is possible;
- billing amount source is ambiguous;
- `billing_amount` would be treated as measured truth;
- release requires invented governance;
- Fiscal production gate would be bypassed;
- AR gross/net basis is unknown;
- Party linkage requires fuzzy identity matching;
- Finance accounting/cost-center mapping would need guessing;
- period close would need bypass;
- Fiscal→AR duplicate prevention cannot be proven;
- paid amount remains manually authoritative;
- partial settlements can produce negative open balance;
- fuzzy matching would finalize reconciliation;
- cancellation/replacement cannot reverse downstream state safely;
- historical paid data requires fabricated settlements;
- smoke would require fake facts in a real production org;
- Phase 8+ is required to finish.

Report exact blocker.

---

# 141. Git discipline

At completion:

```text
branch from updated main
working tree clean
.preview/ net zero
only Phase 7 + required tests/docs
push branch
do not merge automatically
```

---

# 142. Documentation updates

After success:

```text
architecture.md → Phase 7 complete
deferred-items.md → update
billing eligibility/release runbook
amount provenance
Fiscal bridge
AR/cutover
settlement/reconciliation
reversal/cancellation
Finance tenant hardening
production runbook
```

Do not rewrite historical phases.

---

# 143. Required final report

Return concise sections:

1. baseline/preflight
2. Finance audit
3. Fiscal audit
4. Contracts billing audit
5. tenant-hardening changes
6. billing-event model
7. amount provenance
8. eligibility resolver
9. release lifecycle
10. Approval Engine integration
11. Phase 6 event integration
12. Fiscal bridge
13. invoice lifecycle/linkage
14. AR model
15. installments
16. AR amount basis
17. ledger posting
18. settlements
19. partial payments
20. reconciliation
21. retention/glosa/dispute
22. cancellation/reversal/renegotiation
23. Event Graph/jobs
24. legacy compatibility/cutovers
25. security/RLS
26. read models/UI
27. migrations
28. tests/concurrency/failure injection
29. Preview
30. production smoke
31. real-data proof status
32. commit SHA
33. residual risks
34. deferred items

Explicitly answer:

- Does Contracts write Finance directly?
- Does Contracts write Fiscal directly?
- Is billing eligibility distinct from release?
- Does accepted measurement automatically release billing?
- Can `billing_amount` be presented as measured amount?
- Does every billing amount expose provenance?
- Can forecast `billing_amount` create released billing without contractual proof?
- Is Fiscal production gate intact?
- Does authorized Fiscal document create AR idempotently?
- Is AR structurally org-scoped?
- Is canonical Party used?
- Is paid/received derived from settlements?
- Can paid amount be forged directly?
- Are partial payments supported?
- Can open balance go negative?
- Is reconciliation distinct from payment?
- Can fuzzy bank matching auto-finalize reconciliation?
- Are cancellations/reversals append-only?
- Are ledger postings Finance-owned?
- Were accounting mappings invented?
- Is period close respected?
- Was legacy history fabricated?
- Were fake production financial facts created?
- Did browser roles regain TRUNCATE?
- Was Phase 8+ started?

---

# 144. Final gate block

End exactly with:

```text
PHASE 6 BASELINE VERIFIED: YES / NO
MIGRATION REGISTRY CONSISTENT: YES / NO
PHASE 7 COMPLETE: YES / NO
FINANCE TENANT BOUNDARY HARDENED: YES / NO
CANONICAL BILLING EVENT / ENTITLEMENT: YES / NO
BILLING AMOUNT PROVENANCE WORKING: YES / NO
MEASUREMENT PRECEDENCE PRESERVED: YES / NO
BILLING_AMOUNT USED AS MEASURED FALLBACK: NO / YES
BILLING ELIGIBILITY WORKING: YES / NO
BILLING RELEASE DISTINCT: YES / NO
ACCEPTED MEASUREMENT AUTO-RELEASES BILLING: NO / YES
APPROVAL ENGINE RELEASE INTEGRATION: YES / NO / NOT_APPLICABLE
FISCAL BRIDGE WORKING: YES / NO
FISCAL PRODUCTION GATE INTACT: YES / NO
FISCAL DOCUMENT LINKAGE WORKING: YES / NO
CANONICAL AR WORKING: YES / NO
AR ORG-SCOPED STRUCTURALLY: YES / NO
CANONICAL PARTY USED FOR NEW AR LINKS: YES / NO
FISCAL → AR IDEMPOTENCY WORKING: YES / NO
AR AMOUNT BASIS EXPLICIT: YES / NO
INSTALLMENTS CONSERVE TOTAL: YES / NO / NOT_APPLICABLE
SETTLEMENT MODEL WORKING: YES / NO
PARTIAL PAYMENT WORKING: YES / NO
PAID / RECEIVED AMOUNT DERIVED: YES / NO
OPEN BALANCE CAN GO NEGATIVE: NO / YES
RECONCILIATION MODEL WORKING: YES / NO
FUZZY MATCH CAN AUTO-RECONCILE: NO / YES
REVERSAL / CANCELLATION HISTORY IMMUTABLE: YES / NO
LEDGER POSTING FINANCE-OWNED: YES / NO
ACCOUNTING CONFIGURATION FABRICATED: NO / YES
PERIOD CLOSE RESPECTED: YES / NO
CONTRACT-TO-CASH READ MODEL WORKING: YES / NO
DOMAIN EVENTS TRANSACTIONAL: YES / NO
CROSS-DOMAIN HANDLERS IDEMPOTENT: YES / NO
TENANT ISOLATION PASS: YES / NO
ANON UNINTENDED TRUNCATE PRIVILEGES: 0 / N
AUTHENTICATED UNINTENDED TRUNCATE PRIVILEGES: 0 / N
FAKE PRODUCTION BILLING / FISCAL / AR / PAYMENT DATA CREATED: NO / YES
PHASE 8+ NOT STARTED: YES / NO
MIGRATIONS APPLIED SAFELY: YES / NO
PRODUCTION GREEN: YES / NO
REAL CONTRACT-TO-CASH FLOW PROVEN: YES / NO / BLOCKED_BY_REAL_DATA
REAL FISCAL ISSUANCE PROVEN: YES / NO / BLOCKED_BY_CONFIGURATION
REAL AUTO-RECONCILIATION PROVEN: YES / NO / BLOCKED_BY_SOURCE
SAFE TO MERGE PHASE 7: YES / NO
```

---

# 145. Completion definition

Phase 7 is complete only when Apex can truthfully do:

```text
accepted measurement / explicit contractual entitlement
→ billing candidate
→ eligibility with blockers/reasons
→ governed release
→ Fiscal request
→ authorized invoice
→ canonical AR
→ partial/full settlement
→ reconciliation
→ Contracts read model reflects received/open truth
```

while proving:

```text
no Contracts direct Finance write
no Contracts direct Fiscal write
no billing_amount-as-measurement lie
no duplicate invoice/AR on replay
no fake paid amount
no negative open balance
no cross-tenant Finance link
no fuzzy reconciliation as final truth
no erased cancellation/reversal history
```

Central rule:

```text
INVOICE IS NOT CASH.
PAYMENT IS NOT RECONCILIATION.
FINANCIAL TRUTH MUST HAVE PROVENANCE.
```

---

# 146. Architectural outcome

After Phase 7:

```text
CONTRACTUAL CONDITION
        +
ACCEPTED MEASUREMENT
        ↓
BILLING ELIGIBILITY
        ↓
GOVERNED RELEASE
        ↓
FISCAL
NFS-e / invoice truth
        ↓
FINANCE
Accounts Receivable
        ↓
SETTLEMENT
        ↓
RECONCILIATION
        ↓
CONTRACT READ MODEL
received / open / overdue / blocked
```

Contracts remains commercial context.

Projects remains operational truth.

Fiscal remains invoice truth.

Finance remains receivable/cash truth.

Platform remains orchestration/governance.

Phase 7 must finish without turning Contracts into a ledger and without starting Risks, Control Tower or general Autonomy.
