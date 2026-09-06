# Contracts V2 — Phase 6 Execution Specification

Status: **APPROVED EXECUTION SPEC — PHASE 6**

Phase: **Contract ↔ Project / Measurement**

Repository target:

```text
plan/contracts-v2/phase-6-execution.md
```

Primary references:

- `plan/contracts-v2/architecture.md`
- `plan/contracts-v2/deferred-items.md`
- `plan/contracts-v2/phase-5-execution.md`
- `plan/contracts-v2/phase-4-execution.md`

Execution rule:

> Frozen architecture first. This specification second. Repository and production evidence third. If evidence conflicts with assumptions, STOP instead of inventing measurement truth.

---

# 1. Baseline

Expected starting point after Phase 5 merge:

```text
main = 2ef121a9657e1c44e55d3178a491918a959ba5da
migration registry tip = 129
090 = intentionally never applied and superseded
```

Phase 4 already provides:

```text
domain_events
transactional outbox
apex_jobs
typed handlers
scheduler
retry / dead-letter
same-org causation
```

Phase 5 already provides:

```text
shared Approval Engine
versioned policies
requests / stages / steps
SoD
authority/delegation runtime
atomic decisions
approval events
```

Contracts Approval Engine real cutover remains intentionally disabled until authoritative governance is defined. Phase 6 must not depend on that cutover.

Suggested branch:

```text
feat/contracts-v2-phase-6
```

Create from updated `main`.

---

# 2. Phase 6 objective

Connect contractual measurement requirements to real project execution without making Contracts own operations and without making Projects reinterpret the contract.

Target:

```text
CONTRACT
defines WHAT must be measured
and WHAT evidence/acceptance is required
        ↓
PROJECT / SCHEDULE
defines WHERE and WHEN execution is expected
        ↓
EXECUTION EVIDENCE
shows WHAT actually happened
        ↓
PROJECT MEASUREMENT
records the operational measurement instance
        ↓
SUBMISSION
measurement/report package prepared
        ↓
ACCEPTANCE / REJECTION
authoritative human/customer decision
        ↓
MEASUREMENT READINESS
what is complete / missing / blocked / unknown
        ↓
DOMAIN EVENTS
for Phase 7 Billing / Finance later
```

The product outcome is:

> Apex identifies in advance which contractual reports/evidence will be needed for each measurement event, maps them to expected project milestones, acquires real execution evidence automatically where deterministic, and shows exactly what is missing before billing — without pretending that evidence automatically equals accepted measurement.

---

# 3. Frozen ownership boundary

## Contracts owns

```text
contractual measurement rules
contractual measurement requirements
acceptance criteria
required evidence/document classes
frequency / cadence rules
billing-related contractual prerequisites
rule provenance
effective dates / amendment lineage
```

## Projects / Operations owns

```text
project
schedule / timeline
execution progress
field evidence
operational measurement instances
measurement package
submission
acceptance / rejection
operational measurement amount/quantity
actual measurement dates
```

## Platform owns

```text
domain_events
apex_jobs
Approval Engine
audit primitives
notifications
```

## Fiscal owns

```text
fiscal documents
```

## Finance owns

```text
AR
ledger
settlement
reconciliation
```

Contracts must not write Projects measurements. Projects must not rewrite contractual rules. Phase 6 must not write Fiscal or Finance.

---

# 4. No shadow ledger

A measurement amount is not:

```text
invoice amount
accounts receivable
payment
revenue recognition
```

Phase 6 records operational/contractual measurement truth only.

Do not create Finance/Fiscal rows.

---

# 5. Measurement is not billing

Keep these facts distinct:

```text
execution happened
measurement prepared
measurement submitted
measurement accepted
billing eligibility
billing released
invoice issued
payment received
```

Phase 6 ends at authoritative measurement acceptance/rejection plus readiness facts.

Phase 7 owns the financial chain.

Never infer:

```text
measurement accepted = invoice issued
measurement amount = received amount
```

---

# 6. Mandatory focused audit

Before schema work, audit only current Project/Operations and Contract measurement surfaces.

Inspect at minimum:

```text
projects
project schedule/timeline/Gantt tables
contract_milestones
measurement-related Contract tables from Phase 2
timeline_item_id usage
timesheet/project allocation mappings
execution progress tables
field evidence tables
attendance punches
location evidence
project geofences
daily allowances
existing project evidence/document tables
legacy measured_amount fields
billing_amount fields
existing acceptance/status fields
existing measurement/project UI
current project↔contract linking
current project event vocabulary
```

Produce:

```text
OBJECT
CURRENT OWNER
SOURCE OF TRUTH?
REAL DATA?
MOCK/LEGACY?
TENANT KEY
CONTRACT LINK
PROJECT LINK
TIMELINE LINK
MIGRATION ACTION
```

Do not re-audit unrelated modules.

---

# 7. Mandatory baseline gate

Continue only if:

```text
PHASE 5 MERGED: YES
PRODUCTION GREEN: YES
MIGRATION REGISTRY CONSISTENT: YES
REGISTRY TIP >= 129: YES
090 EXCEPTION EXPLICIT: YES
EVENT GRAPH HEALTHY: YES
APEX JOBS HEALTHY: YES
APPROVAL ENGINE HEALTHY: YES
PROJECT / SCHEDULE SOURCES MAPPED: YES
CONTRACT MEASUREMENT RULE SOURCES MAPPED: YES
LEGACY MEASURED_AMOUNT SOURCES MAPPED: YES
```

Otherwise STOP.

---

# 8. Canonical Contract rule → Project instance relationship

Phase 2 Contract measurement definitions remain contractual source of truth.

Phase 6 creates operational instances under Projects.

Mandatory relationship:

```text
project_measurement.contract_measurement_rule_id
→ canonical contractual measurement rule
```

or equivalent same-org composite FK.

The Project instance must know which contractual rule generated/justified it.

Do not duplicate contractual rule text into Projects as a second source of truth.

Snapshot only what is required for historical execution fidelity.

---

# 9. Canonical `project_measurements`

Create a Project-owned, org-scoped canonical measurement model.

Conceptually support:

```text
id
organization_id
project_id
contract_id
contract_measurement_rule_id
timeline_item_id nullable
occurrence_key
measurement_period_start
measurement_period_end
expected_at
measured_at
submitted_at
accepted_at
rejected_at
cancelled_at
status
quantity/value
unit
currency when monetary
created_by/source
correlation_id
source_event_id nullable
revision/supersession linkage
```

Exact fields depend on the focused audit.

Do not add fields whose semantics cannot be proven.

---

# 10. Measurement lifecycle

Recommended conceptual lifecycle:

```text
PLANNED
IN_PREPARATION
READY_FOR_SUBMISSION
SUBMITTED
UNDER_REVIEW
ACCEPTED
REJECTED
RETURNED_FOR_CORRECTION
CANCELLED
SUPERSEDED
```

Reconcile with existing domain vocabulary if stronger semantics already exist.

Important distinctions:

```text
READY_FOR_SUBMISSION != SUBMITTED
SUBMITTED != ACCEPTED
REJECTED != RETURNED_FOR_CORRECTION
```

No automated path may jump from execution evidence directly to `ACCEPTED`.

---

# 11. Acceptance is NEVER_AUTOMATED

This is a frozen invariant.

Apex may automatically:

```text
detect execution evidence
infer candidate progress
identify missing documents
prepare measurement package/checklist
notify responsible roles
mark readiness
create an acceptance request when authoritative policy exists
```

Apex may NOT automatically:

```text
accept measurement
pretend customer accepted
mark technical report approved
release billing
```

If no authoritative acceptance exists:

```text
acceptance = UNKNOWN / PENDING
```

not accepted.

---

# 12. Measured amount precedence — frozen

When resolving measured amount:

```text
1. accepted canonical project measurement
2. legacy milestone.measured_amount
3. STOP / UNKNOWN
```

Never fallback to:

```text
billing_amount
```

`billing_amount` is not evidence of measurement.

This rule is merge-blocking and needs permanent regression tests.

---

# 13. Quantity / value semantics

Distinguish:

```text
quantity
unit
unit_price if contractual
measured_value
currency
```

Do not assume every measurement is monetary.

Examples:

```text
km of line
structures installed
hours
percentage milestone
lump-sum milestone
monetary measurement
```

The Contract rule determines permitted semantics.

---

# 14. Incremental vs cumulative semantics

Explicitly distinguish when needed:

```text
incremental
cumulative
milestone-fixed
percentage
quantity-based
```

Do not double-count cumulative measurements.

If the current Contract model does not encode required semantics and real data needs them, STOP and add explicit structured semantics rather than infer.

---

# 15. Occurrence identity

Recurring Contract measurement rules require stable occurrence identity.

Use:

```text
rule + project scope + occurrence_key
```

or equivalent.

No duplicate canonical instance for the same deterministic occurrence.

If occurrence cannot be resolved deterministically:

```text
occurrence_unresolved
```

Do not guess from nearest date.

---

# 16. Schedule integration

Schedule answers:

```text
WHEN is the measurement expected?
```

It does not prove execution or acceptance.

Map Contract measurement requirements to Project timeline/milestone items explicitly where possible.

Support an explicit mapping:

```text
contract measurement rule
↔ project timeline item
```

with same-org integrity and provenance.

Do not fuzzy-link by title in production.

---

# 17. Schedule mapping provenance

Each mapping records:

```text
mapping source
mapped_by
mapped_at
confidence if system-proposed
review state when inferred
```

Safe sources:

```text
explicit/manual
deterministic import/reference
governed system mapping
```

AI may propose a mapping, but:

```text
proposal != truth
```

---

# 18. Schedule changes

If schedule changes, expected dates may move.

Historical measurement facts do not get rewritten.

Preserve material history between:

```text
original expectation
current schedule projection
actual measurement facts
```

Do not rewrite accepted measurement history because the Gantt changed later.

---

# 19. Execution evidence sources

Audit and reuse actual current sources, potentially including:

```text
attendance punches
location evidence
geofence matches
timesheets
daily allowances
photos/documents
field reports
task completion
project progress
vehicle/equipment evidence
explicit operational entries
```

Evidence can support:

```text
execution observed
presence observed
work likely occurred
progress candidate
```

Evidence cannot by itself prove contractual acceptance.

---

# 20. Evidence provenance

Every evidence link used by a measurement must preserve:

```text
source_type
source_id
captured_at
organization
project
person/device where relevant
provenance
confidence when inferred
validation state if applicable
```

Never convert unverifiable free text into authoritative field evidence.

---

# 21. Evidence classification

Distinguish at least:

```text
RAW_EVIDENCE
DERIVED_EVIDENCE
VALIDATED_EVIDENCE
ACCEPTANCE_EVIDENCE
```

Do not blur a GPS/punch observation with a signed or accepted measurement report.

---

# 22. Automatic evidence acquisition

Phase 6 should reduce manual maintenance.

Automatically ingest/link evidence where deterministic and already available.

Examples:

```text
timeline item explicitly belongs to project
a high-confidence existing resolver maps person/evidence → project
task explicitly links to timeline item
document explicitly uploads to measurement
```

Do not ask managers to re-enter information Apex already knows.

---

# 23. Evidence confidence

For inferred evidence, preserve confidence/state.

Do not promote:

```text
AMBIGUOUS
UNMATCHED
NO_EVIDENCE
```

to execution truth.

Reuse existing authoritative confidence rules if present.

Do not casually invent a new threshold.

---

# 24. Progress inference vs authoritative progress

Keep distinct:

```text
observed/inferred progress
authoritative project progress
accepted measurement progress
```

Apex may recommend progress updates.

Do not silently overwrite authoritative project progress unless current Project governance explicitly allows it.

---

# 25. Measurement package

A measurement instance should expose:

```text
required evidence
provided evidence
validated evidence
missing evidence
technical/service report reference
supporting photos
field records
contractual documents
submission package
```

Apex does not author the technical/service report.

Engineering/Operations owns report content.

Apex tracks requirement, presence, provenance, validation and readiness.

---

# 26. Requirement resolution

For each measurement instance, resolve effective Contract requirements as-of the relevant period/event.

Use Phase 2 temporal lineage.

Do not apply today's amended rule to an old measurement governed by an earlier rule.

Required provenance:

```text
contract
rule
rule version/effective interval
clause/document source
measurement occurrence
```

---

# 27. Canonical readiness resolver

Create one shared readiness resolver.

Core states:

```text
READY
BLOCKED
INCOMPLETE
NOT_APPLICABLE
UNKNOWN
```

Semantics:

- `READY` — all known prerequisites for the target action are satisfied.
- `BLOCKED` — a known blocker prevents the action.
- `INCOMPLETE` — a known required item is missing/incomplete.
- `NOT_APPLICABLE` — authoritative rule proves it does not apply.
- `UNKNOWN` — required truth cannot yet be determined.

Missing information must never become `READY`.

---

# 28. Readiness dimensions

Do not collapse readiness into one opaque boolean.

Resolve dimensions such as:

```text
execution
required evidence
technical report
contractual documents
measurement completeness
submission
acceptance
billing prerequisite projection
```

Then derive overall state transparently.

---

# 29. Readiness reason codes

Provide actionable machine-readable reasons, for example:

```text
MISSING_REQUIRED_REPORT
MISSING_REQUIRED_DOCUMENT
MISSING_PHOTOS
EXECUTION_NOT_OBSERVED
WAITING_CUSTOMER_ACCEPTANCE
RULE_UNRESOLVED
TIMELINE_MAPPING_UNRESOLVED
OCCURRENCE_UNRESOLVED
OBLIGATION_BLOCKING
```

Do not return only `BLOCKED` without explanation.

---

# 30. UNKNOWN is first-class

Examples that yield UNKNOWN:

```text
Contract rule unresolved
timeline mapping unresolved
business-day date cannot be calculated
execution evidence ambiguous
acceptance source absent
measurement occurrence ambiguous
```

Missing truth is not compliance.

---

# 31. Measurement readiness vs billing readiness

Phase 6 may compute a pre-billing prerequisite projection.

Do not create actual:

```text
billing entitlement
billing release
invoice
AR
```

Keep:

```text
measurement_readiness
billing_prerequisite_readiness
```

separate.

Phase 7 owns billing rights/release.

---

# 32. Contract obligations integration

Read existing obligations rather than duplicate them.

Readiness may reference:

```text
obligation instance
blocks_billing
evidence completeness
formal acceptance state
```

Projects does not rewrite obligation truth directly.

Use Event Graph for legitimate cross-domain reactions.

---

# 33. Approval Engine integration

The shared Approval Engine may govern measurement acceptance only if an authoritative real policy exists.

If not:

```text
do not fabricate one
```

Projects may still record an external/customer acceptance through a controlled domain action with provenance.

Phase 6 must not depend on Contracts Approval Engine cutover.

---

# 34. Acceptance provenance

Support authoritative sources such as:

```text
customer portal/user
signed measurement bulletin
authorized internal reviewer
external acceptance document
Approval Engine decision
integration/provider
```

Record:

```text
who/what accepted
when
source
provenance
document/reference
```

Do not treat an arbitrary free-text comment as proof when stronger evidence is required.

---

# 35. External actors

If external customer acceptance has no Apex user account, represent external actor/provenance explicitly.

Potential references:

```text
accepted_by_party_id
external actor name/reference
acceptance document
source = external
```

Reuse canonical Party/document models where appropriate.

Do not create fake internal users.

---

# 36. Submit / accept / reject ownership

Projects/Operations owns:

```text
submit measurement
accept measurement
reject measurement
return for correction
```

Contracts defines what acceptance is required.

Platform Approval Engine may govern who may decide.

Do not put operational transition state in Contracts tables.

---

# 37. Atomic transition RPCs

Create controlled transitions, conceptually:

```text
project_measurement_submit(...)
project_measurement_accept(...)
project_measurement_reject(...)
project_measurement_return(...)
project_measurement_supersede(...)
```

Each transaction:

```text
lock measurement
→ validate current state
→ validate tenant
→ validate actor/source
→ validate required provenance
→ write immutable history
→ update current projection
→ emit domain event
→ commit
```

No browser direct multi-write sequence.

---

# 38. Immutable transition history

Create append-only measurement transition/history.

Preserve:

```text
from_state
to_state
actor/source
occurred_at
reason
provenance
correlation
```

Do not overwrite history when status changes.

---

# 39. Rejection vs return for correction

Keep distinct:

```text
REJECTED
RETURNED_FOR_CORRECTION
```

Rejected = authoritative negative decision.

Returned = package may be corrected/resubmitted.

Do not collapse them into one status/comment.

---

# 40. Revision / supersession

Material changes after submission/rejection must be traceable as revisions.

Do not rewrite an accepted measurement in place.

If accepted truth must change, require explicit governed supersession/reversal.

---

# 41. Accepted measurement immutability

Core accepted facts are immutable:

```text
accepted quantity/value
period
contract rule
project
acceptance provenance
accepted_at
```

Corrections require explicit supersession/reversal.

---

# 42. Measurement events

Use Phase 4 Event Graph.

Initial vocabulary may include:

```text
projects.measurement.created
projects.measurement.ready_for_submission
projects.measurement.submitted
projects.measurement.returned_for_correction
projects.measurement.accepted
projects.measurement.rejected
projects.measurement.cancelled
projects.measurement.superseded
projects.measurement.evidence_linked
```

Only emit facts backed by authoritative transitions.

---

# 43. Transactional event integrity

Measurement mutation and event commit together.

Never:

```text
accept measurement
COMMIT
then emit projects.measurement.accepted
```

`projects.measurement.accepted` is a critical future Phase 7 input and must not be losable.

---

# 44. Event causation

Preserve:

```text
correlation_id
causation_event_id
source_event_id
```

where causality is known.

Examples are valid only when authoritative:

```text
project milestone completion → measurement candidate
approval.request.approved → measurement acceptance
```

Do not fabricate causal chains.

---

# 45. Automatic measurement candidate creation

Phase 6 may automatically create a planned/candidate measurement when:

```text
Contract rule + project + occurrence + schedule mapping
```

are deterministic.

Safe:

```text
rule + deterministic occurrence → PLANNED measurement
```

Unsafe:

```text
attendance punch → ACCEPTED measurement
```

---

# 46. Candidate idempotency

Use stable uniqueness such as:

```text
organization
project
contract measurement rule
occurrence key
```

Repeated events/jobs must not duplicate candidates.

---

# 47. Event-triggered creation / reconciliation

If authoritative Project events exist, use them.

Otherwise use bounded scheduled reconciliation through existing `apex_jobs`.

Potential job types:

```text
projects.measurements.reconcile_candidates
projects.measurements.recompute_readiness
```

Do not create a new queue.

Do not scan the full database every 10 minutes.

---

# 48. Readiness recomputation

Readiness is derived and recomputable.

Prefer resolver/read model, or a cache with explicit:

```text
computed_at
input fingerprint/version
```

Do not make a stale boolean the only truth.

---

# 49. Requirement provenance UX

Users must be able to answer:

```text
Why is Apex asking for this report/document/evidence?
```

with:

```text
contract rule
clause/document source
effective date
amendment lineage
```

---

# 50. No ISO-library dependency

Do not make Phase 6 depend on building a universal ISO/normative-document library.

Use contractual requirements actually structured from the contract.

External standards may be referenced as provenance when already available.

---

# 51. Responsibility assignment

Resolve responsible party/team with a deterministic hierarchy when possible:

```text
explicit requirement owner
→ project/timeline owner
→ team/role resolver
→ UNKNOWN
```

Do not require manual assignment where an authoritative project owner already exists.

Do not silently assign arbitrary users.

---

# 52. Operational work

If missing requirements need tasks, reuse existing task capability only when a real integration exists.

Do not build a new task engine.

At minimum readiness must expose:

```text
what is missing
owner/role if known
expected/due date
source requirement
```

---

# 53. Manager-as-observer UX

The product goal is to reduce manual operational feeding.

The Project/Measurement view should make visible:

```text
upcoming measurement events
execution progress
contract requirements expected
evidence acquired automatically
missing report/evidence
submission readiness
acceptance state
value potentially blocked later
```

Do not ask managers to manually duplicate evidence already present in Apex.

But inferred evidence remains visibly inferred until authoritative.

---

# 54. Measurement timeline UX

Show a real timeline:

```text
expected
execution observed
package prepared
submitted
returned/rejected
resubmitted
accepted
```

No fake `Análise IA` lifecycle stage.

---

# 55. Contracts UI boundary

Contracts may show:

```text
measurement rules
mapped project/timeline
current/next measurement
readiness
accepted/rejected history
missing requirements
```

Contracts is not the operational measurement editing workspace.

---

# 56. Projects UI boundary

Projects owns:

```text
measurement instances
evidence package
submission
acceptance/rejection
timeline linkage
```

Do not redesign the whole Projects module.

Add only the canonical measurement surfaces required by Phase 6.

---

# 57. Contract dossier integration

Contract dossier may expose contextual measurement readiness and links to Projects.

Do not add a new top-level Contracts navigation item.

---

# 58. No fake portfolio money

Do not show portfolio totals like:

```text
R$ blocked
R$ ready to invoice
```

unless derivation is truthful from accepted measurements and known Contract prerequisites.

Actual billing release remains Phase 7.

---

# 59. Demo / official separation

Demo/mock contracts, projects and measurements must remain outside official metrics.

No auto-promotion.

Use disposable/demo entities for tests.

---

# 60. Security posture

All new tables are org-scoped.

Browser roles should not directly mutate accepted measurement truth/history.

Use authorized reads and controlled server/RPC transitions.

RLS is defense in depth, not sole invariant.

---

# 61. Same-org structural integrity

Enforce composite same-org FKs where possible:

```text
measurement → project
measurement → contract
measurement → Contract rule
measurement → timeline item
measurement evidence → measurement
measurement history → measurement
source event → domain_events
approval request → same org if linked
```

No cross-tenant references.

---

# 62. Polymorphic evidence safety

If evidence uses:

```text
source_type + source_id
```

controlled server functions must:

```text
resolve source
→ derive organization
→ derive project when possible
→ validate target measurement org/project
```

Do not let browsers attach arbitrary source IDs.

---

# 63. Actor integrity

Human acceptance/rejection actor comes from authenticated identity or validated external acceptance provenance.

Browser cannot set:

```text
accepted_by = another_user
```

AI/system cannot impersonate customer or engineer.

---

# 64. Approval Engine subject safety

If Approval Engine governs acceptance:

```text
decision_purpose = ACCEPTANCE
subject = exact measurement revision/fingerprint
```

If measurement changes materially, old approval cannot apply.

Do not approve a mutable generic container.

---

# 65. Document storage

Reuse existing private document/storage architecture.

Do not create public buckets.

Do not store binaries in `domain_events` or `apex_jobs`.

---

# 66. Required vs provided vs accepted evidence

Keep separate:

```text
required evidence
provided evidence
validation
acceptance
```

A file existing does not automatically satisfy a contractual requirement.

---

# 67. Legacy measurement compatibility

Audit existing milestone measurement data.

Do not fabricate canonical measurement/acceptance history from legacy values unless deterministic provenance exists.

Preferred:

```text
new canonical measurements after cutover
legacy milestone.measured_amount remains read fallback
```

No fake historical `projects.measurement.accepted` events.

---

# 68. Legacy amount resolver — permanent invariant

Read precedence:

```text
canonical accepted project measurement
→ legacy milestone.measured_amount
→ UNKNOWN
```

Never:

```text
→ billing_amount
```

Add permanent regression coverage.

---

# 69. Measurement cutover

Define an explicit canonical Project Measurement cutover boundary.

After cutover:

```text
new measurement writes → project_measurements
```

Legacy sources may remain read compatibility.

Do not allow two canonical write engines for the same measurement.

---

# 70. No destructive legacy drop

Do not drop legacy milestone measurement fields/tables in initial Phase 6.

Preserve until later production evidence proves safe cleanup.

---

# 71. Aggregation semantics

If multiple accepted measurements contribute to one milestone, aggregation must be explicit.

Possible semantics:

```text
sum incremental accepted values
latest cumulative total
percentage
quantity accumulation
fixed milestone amount
```

Do not universally `SUM`.

If aggregation semantics are unknown, return UNKNOWN.

---

# 72. Partial acceptance

Only model partial acceptance if real business evidence requires it.

Potential distinction:

```text
submitted quantity/value
accepted quantity/value
rejected/glosa quantity/value
```

Financial glosa belongs to Phase 7.

Do not add speculative complexity.

---

# 73. Acceptance reversal

Do not allow ordinary status rollback from ACCEPTED.

Real rescission requires explicit governed reversal/supersession with immutable provenance.

---

# 74. Time semantics

Use UTC timestamps for event/history times.

Preserve business local-date semantics where Contract rules use dates/periods.

Delayed workers must use authoritative event/business time, not worker execution time.

---

# 75. As-of resolution

Where material, readiness/history supports `asOf`.

An amendment must not make old measurement history appear governed by today's rules.

---

# 76. Explicit project↔contract linkage

Canonical Contract measurement automation requires an explicit Project→Contract link.

Do not fuzzy-match project name/customer to contract.

If absent:

```text
contractual readiness = UNKNOWN / UNLINKED
```

---

# 77. Multiple contracts/projects

Audit cardinality.

Support exact scope if current model permits:

```text
one contract → multiple projects
one project → multiple contracts
```

Measurement instance always points to exact governing Contract rule.

---

# 78. Timeline cardinality

A timeline item is execution organization, not the Contract rule itself.

Mappings may be one-to-one or one-to-many only if explicitly represented.

If ambiguous, do not guess.

---

# 79. Ponto/location boundary

Ponto/location data is execution evidence, not Contract truth.

Reuse existing project attribution resolver.

Do not rebuild or weaken it in Phase 6.

Preferred:

```text
punch/location
→ resolved project
→ project execution evidence
→ measurement readiness
```

Avoid direct raw punch→contract matching.

---

# 80. Task boundary

Task completion may support execution evidence only if explicitly linked to Project/timeline scope.

Generic task completion never equals measurement acceptance.

---

# 81. Automatic alerts

Reuse Event Graph/jobs/notification capability where appropriate.

Examples:

```text
measurement expected soon but required report missing
execution observed but measurement package incomplete
measurement submitted and acceptance pending
```

Alerts do not change domain truth.

---

# 82. Phase 6 autonomy level

Allowed:

```text
observe
link deterministic evidence
create planned candidates
recompute readiness
prepare checklists
notify
route work
```

Not allowed:

```text
accept measurement
invent technical report
invent evidence
release billing
```

---

# 83. AI boundary

AI may:

```text
summarize evidence
suggest rule/timeline mapping
suggest requirement classification
prepare draft checklist
```

AI may not:

```text
fabricate quantity/value
accept measurement
decide contractual applicability without provenance
create official evidence from inference
```

---

# 84. Canonical measurement read model

Create one canonical resolver/service consumed by Contracts and Projects.

Inputs:

```text
organization
measurement
asOf
```

Outputs:

```text
measurement identity/status
Contract rule provenance
timeline mapping
execution evidence summary
requirements
provided evidence
missing items
submission readiness
acceptance state
billing prerequisite projection
trust/unknown reasons
```

Avoid duplicated business logic in UI.

---

# 85. Project measurement service

Create server-side service/types for:

```text
list/get
create candidate/manual instance
link evidence
submit
return/reject
accept
supersede
resolve readiness
```

No direct client DB mutation for governed transitions.

---

# 86. Performance

Index for actual access patterns:

```text
project + status
contract + status
rule + occurrence
timeline item
expected_at
submitted_at
accepted_at
evidence links
correlation/source event
```

Do not full-scan portfolios on each render or scheduler tick.

---

# 87. Event/job performance

Scheduled reconciliation must be bounded/incremental.

Use where appropriate:

```text
due horizon
changed-since timestamp
cursor/high-water mark
event-driven invalidation
```

---

# 88. Migration strategy

Do not edit migrations 001–129.

Inspect actual registry tip first.

If still 129, likely begin at 130.

Suggested split only:

```text
130 — project_measurements + immutable transition history
131 — measurement evidence + Contract rule/timeline mappings
132 — readiness + schedule integration
133 — events/jobs + legacy compatibility
134+ — evidence-driven corrections only
```

Every migration:
- canonical runner;
- registration inside same transaction;
- structural assertions;
- RLS/grants/TRUNCATE review;
- preserve 090 superseded hole.

---

# 89. Required structural tests

Prove:
- org/project/contract/rule integrity;
- same-org FKs;
- cross-tenant links rejected;
- occurrence uniqueness;
- accepted core facts immutable;
- transition history append-only;
- browser cannot mutate accepted facts directly;
- no unintended TRUNCATE.

---

# 90. Required lifecycle tests

Prove valid and invalid transitions.

At minimum:

```text
PLANNED
→ IN_PREPARATION
→ READY_FOR_SUBMISSION
→ SUBMITTED
→ ACCEPTED
```

and:

```text
SUBMITTED → RETURNED_FOR_CORRECTION → resubmitted
SUBMITTED → REJECTED
```

Invalid/finalized transitions rejected.

---

# 91. Required acceptance safety tests

Prove:
- evidence alone cannot accept;
- AI/system cannot accept;
- unauthorized user cannot accept;
- actor cannot be spoofed;
- missing acceptance provenance blocks acceptance;
- accepted facts immutable;
- duplicate acceptance idempotent;
- accept/reject race yields one governed result.

---

# 92. Required concurrency tests

Use real Postgres/two connections.

Test:

```text
accept vs reject race
duplicate submit
duplicate accept
evidence link race
supersede vs accept race
```

No double finalization or duplicate events.

---

# 93. Required transactional outbox tests

Prove:

```text
measurement mutation + event → both commit
failed event emission → domain transition rolls back
failed transition → no event
duplicate retry → no duplicate event
```

---

# 94. Required schedule mapping tests

Prove:
- explicit mapping works;
- cross-tenant mapping rejected;
- fuzzy title alone does not auto-link;
- schedule date changes adjust expectation without rewriting accepted history;
- unlinked rule yields UNKNOWN.

---

# 95. Required evidence tests

Prove:
- deterministic evidence auto-links safely;
- ambiguous/unmatched evidence does not promote;
- raw evidence != validated evidence;
- wrong Project/org rejected;
- duplicate evidence link idempotent;
- evidence removal/revocation recomputes readiness truthfully.

---

# 96. Required readiness tests

Test all states:

```text
READY
BLOCKED
INCOMPLETE
NOT_APPLICABLE
UNKNOWN
```

Prove missing rule/evidence never becomes READY.

Prove actionable reason codes.

Prove temporal/as-of rule selection.

---

# 97. Required legacy amount tests

Permanent regression:

```text
accepted canonical amount exists
→ use it

no canonical accepted amount
+ milestone.measured_amount exists
→ use legacy measured_amount

neither exists
+ billing_amount exists
→ UNKNOWN
```

Never use billing_amount fallback.

---

# 98. Required rule-lineage tests

Prove:
- old occurrence uses old effective rule;
- new occurrence after amendment uses successor rule;
- historical measurement not rewritten;
- rule/clause provenance remains queryable.

---

# 99. Required candidate tests

Prove:
- deterministic rule/occurrence creates one candidate;
- repeat job/event does not duplicate;
- ambiguous occurrence remains unresolved;
- no acceptance side effect;
- no fake production candidates for showcase.

---

# 100. Required Approval Engine tests

If real acceptance policy exists:
- subject fingerprint = exact measurement revision;
- material measurement change invalidates old approval;
- Phase 5 SoD preserved;
- no policy invented;
- approved acceptance routes through controlled measurement transition.

If no real policy exists, report:

```text
NOT_APPLICABLE / blocked by governance
```

without fabricating one.

---

# 101. Required UI tests

Projects:
- canonical measurement list/detail;
- evidence/checklist;
- readiness reasons;
- submission/acceptance lifecycle;
- no accept action for ineligible actor.

Contracts:
- rule/readiness context;
- link to Project measurement;
- no duplicate operational editor;
- no fake billing totals.

---

# 102. Production smoke

Use disposable org/project/contract whenever possible.

Smoke:

```text
Contract rule
→ Project/timeline mapping
→ measurement candidate
→ evidence
→ readiness
→ submit
→ controlled accept/reject
→ domain event
→ read model
```

Clean all disposable data.

Do not fabricate measurement events in real Projects/Contracts.

---

# 103. Real production flow gate

Do not claim real operational proof merely because disposable smoke succeeds.

Real proof requires at least one real Project with:

```text
explicit Contract link
real measurement rule
real schedule/timeline mapping
real execution evidence
real measurement package
authoritative acceptance source
```

If unavailable:

```text
REAL PRODUCTION MEASUREMENT FLOW PROVEN = BLOCKED_BY_REAL_DATA
```

This does not invalidate the engine if infrastructure is correctly complete.

---

# 104. No report-generation claim

Apex tracks/report requirements and evidence.

Apex does not author the engineering/service report in Phase 6.

---

# 105. Phase 7 boundary

Phase 6 may emit:

```text
projects.measurement.accepted
```

Phase 7 will consume it.

Phase 6 must not create:

```text
billing entitlement
billing release
Fiscal document
AR
settlement
reconciliation
```

No Finance/Fiscal writes.

---

# 106. Phase 9/10 boundary

Do not build Control Tower.

Do not implement general autonomy policies.

Phase 6 automation is limited to observation, preparation, linking, readiness and routing.

Measurement acceptance remains NEVER_AUTOMATED.

---

# 107. Preview

Create Vercel Preview.

Verify:
- Projects measurement UX works;
- Contracts contextual readiness works;
- no unrelated navigation redesign;
- no Phase 7 UI;
- no fake metrics;
- no runtime errors.

If Deployment Protection blocks interactive smoke, report it and run equivalent authenticated local E2E.

---

# 108. Regression suite

Run:
- Phase 0 Contracts security;
- Phase 1 tenant/Party;
- Phase 2 temporal/lineage;
- Phase 3 obligations;
- Phase 4 Event Graph/jobs;
- Phase 5 Approval Engine;
- migration registry;
- TRUNCATE hardening;
- Projects/Gantt/timeline regressions;
- Ponto/evidence resolver tests if integration touched;
- Contracts measurement/readiness tests;
- Project measurement live DB tests;
- E2E;
- `tsc --noEmit`;
- production build;
- changed-file lint.

Keep `.preview/` net diff zero.

---

# 109. Pre-apply gate

Before Phase 6 migrations:

```text
MIGRATION REGISTRY CONSISTENT: YES
CURRENT TIP CONFIRMED: YES
NO VERSION COLLISION: YES
PHASE 5 FINGERPRINT STABLE: YES
TRUNCATE HARDENING GREEN: YES
PROJECT SOURCES AUDITED: YES
CONTRACT MEASUREMENT RULES AUDITED: YES
LEGACY MEASUREMENT SOURCES AUDITED: YES
OWNERSHIP BOUNDARY PROVEN: YES
ACCEPTANCE NEVER_AUTOMATED: YES
AMOUNT PRECEDENCE TESTED: YES
ATOMIC TRANSITIONS PROVEN: YES
TENANT SECURITY GREEN: YES
CONCURRENCY GREEN: YES
SAFE TO APPLY PHASE 6 MIGRATIONS: YES
```

Otherwise STOP.

---

# 110. Post-apply gate

After production apply:

```text
MIGRATIONS REGISTERED: YES
NO LEGACY HISTORY REWRITTEN: YES
NO FAKE MEASUREMENTS CREATED: YES
NO FINANCE/FISCAL WRITES: YES
NO BILLING_AMOUNT FALLBACK: YES
TRUNCATE GRANTS STILL ZERO: YES
EVENT GRAPH HEALTHY: YES
APEX JOBS HEALTHY: YES
APPROVAL ENGINE HEALTHY: YES
```

---

# 111. STOP conditions

STOP if:
- Project↔Contract relation cannot be proven;
- Contract measurement rule source is ambiguous;
- legacy measured amount semantics cannot be mapped;
- implementation would fallback to `billing_amount`;
- occurrence mapping requires guessing;
- schedule mapping requires fuzzy title as truth;
- evidence attribution remains ambiguous;
- measurement acceptance would require automation/fabrication;
- external acceptance provenance cannot be represented safely;
- cross-tenant polymorphic evidence cannot be validated;
- accepted measurement can be edited in place;
- transition/event atomicity cannot be proven;
- browser can spoof accepting actor;
- required aggregation semantics are unknown;
- cumulative vs incremental semantics are unknown but required;
- Phase 7 Finance/Fiscal writes would be needed;
- production demo data would be required to claim completion.

Report exact blocker and evidence.

---

# 112. Git discipline

At completion:
- branch from updated `main`;
- working tree clean;
- `.preview/` net zero;
- only Phase 6 + required docs/tests;
- push branch;
- do not merge automatically.

---

# 113. Documentation updates

After successful Phase 6:
- mark Phase 6 delivered in `architecture.md`;
- update `deferred-items.md`;
- document ownership boundary;
- measurement lifecycle;
- readiness states/reasons;
- acceptance provenance;
- evidence model;
- legacy amount resolver;
- Project Measurement cutover;
- production runbook.

Do not rewrite legacy measurement history.

---

# 114. Required final report

Return concise sections:

1. baseline/preflight;
2. Projects/Contracts measurement audit;
3. ownership map;
4. final `project_measurements` model;
5. lifecycle;
6. Contract rule→instance linkage;
7. schedule mapping;
8. evidence acquisition/provenance;
9. readiness resolver;
10. measurement package;
11. submission;
12. acceptance/rejection;
13. Approval Engine integration;
14. immutable transition history;
15. Event Graph integration;
16. candidate automation;
17. legacy compatibility;
18. measured amount precedence;
19. tenant/RLS/security;
20. UI/read models;
21. migrations;
22. tests/concurrency/failure injection;
23. Preview;
24. production smoke;
25. real-data proof status;
26. commit SHA;
27. residual risks;
28. deferred items.

Explicitly answer:

- Does Contracts own measurement instances?
- Does Projects own measurement instances?
- Can schedule alone prove execution?
- Can execution evidence alone accept a measurement?
- Can AI/system accept a measurement?
- Is measurement acceptance ever automated?
- Is each canonical measurement linked to Contract rule provenance?
- Is rule→timeline mapping governed?
- Can ambiguous evidence become authoritative progress?
- Does missing requirement information ever become READY?
- Are accepted measurements immutable?
- Can accepted measurement be silently edited?
- Are transitions/events atomic?
- Can concurrent actors double-finalize?
- Is `billing_amount` ever used as measured amount fallback?
- What is the measured amount precedence?
- Was legacy history fabricated?
- Were Phase 7 Finance/Fiscal writes added?
- Were fake production measurements created?
- Did browser roles regain TRUNCATE?
- Were `.preview/` artifacts committed?

---

# 115. Final gate block

End exactly with:

```text
PHASE 5 BASELINE VERIFIED: YES / NO
MIGRATION REGISTRY CONSISTENT: YES / NO
PHASE 6 COMPLETE: YES / NO
PROJECT MEASUREMENTS CANONICAL: YES / NO
CONTRACT RULE → MEASUREMENT LINK STRUCTURAL: YES / NO
PROJECT / CONTRACT LINK PROVEN: YES / NO
SCHEDULE MAPPING GOVERNED: YES / NO
EVIDENCE PROVENANCE WORKING: YES / NO
AUTOMATIC EVIDENCE LINKING SAFE: YES / NO
MEASUREMENT READINESS WORKING: YES / NO
READY / BLOCKED / INCOMPLETE / NOT_APPLICABLE / UNKNOWN WORKING: YES / NO
MEASUREMENT PACKAGE WORKING: YES / NO
SUBMISSION LIFECYCLE WORKING: YES / NO
ACCEPTANCE / REJECTION WORKING: YES / NO
MEASUREMENT ACCEPTANCE AUTOMATED: NO / YES
ACCEPTED MEASUREMENTS IMMUTABLE: YES / NO
TRANSITION HISTORY IMMUTABLE: YES / NO
MEASUREMENT EVENTS TRANSACTIONAL: YES / NO
CANDIDATE MATERIALIZATION IDEMPOTENT: YES / NO
APPROVAL ENGINE INTEGRATION SAFE: YES / NO / NOT_APPLICABLE
LEGACY MEASUREMENT HISTORY PRESERVED: YES / NO
MEASURED AMOUNT PRECEDENCE CORRECT: YES / NO
BILLING_AMOUNT USED AS MEASUREMENT FALLBACK: NO / YES
TENANT ISOLATION PASS: YES / NO
ANON UNINTENDED TRUNCATE PRIVILEGES: 0 / N
AUTHENTICATED UNINTENDED TRUNCATE PRIVILEGES: 0 / N
FAKE PRODUCTION MEASUREMENTS CREATED: NO / YES
FINANCE / FISCAL WRITES ADDED: NO / YES
PHASE 7+ NOT STARTED: YES / NO
MIGRATIONS APPLIED SAFELY: YES / NO
PRODUCTION GREEN: YES / NO
REAL PRODUCTION MEASUREMENT FLOW PROVEN: YES / NO / BLOCKED_BY_REAL_DATA
SAFE TO MERGE PHASE 6: YES / NO
```

---

# 116. Completion definition

Phase 6 is complete only when Apex can truthfully do:

```text
Contract defines measurement requirement
→ Project/timeline maps expected execution
→ real evidence arrives
→ Apex links deterministic evidence automatically
→ measurement candidate exists
→ readiness explains missing requirements
→ Engineering/Operations completes package
→ measurement submitted
→ authorized human/external party accepts or rejects
→ immutable measurement fact emitted
→ Phase 7 can later consume accepted measurement
```

while proving:

```text
no acceptance fabrication
no billing_amount fallback
no tenant leak
no lost event
no duplicate occurrence
no rewritten accepted measurement
no hidden Finance/Fiscal write
```

Central rule:

```text
EXECUTION EVIDENCE IS NOT ACCEPTANCE.
MEASUREMENT TRUTH BEFORE BILLING AUTOMATION.
```

---

# 117. Architectural outcome

After Phase 6:

```text
CONTRACTUAL RULE
        ↓
PROJECT + TIMELINE
        ↓
EXECUTION EVIDENCE
        ↓
PROJECT MEASUREMENT
        ↓
READINESS / PACKAGE
        ↓
SUBMISSION
        ↓
AUTHORITATIVE ACCEPTANCE
        ↓
projects.measurement.accepted
        ↓
PHASE 7
Billing → Fiscal → AR → Settlement
```

This is the bridge that lets Apex move from Contract intelligence into real operational execution without becoming dependent on manual re-entry and without inventing acceptance.

Phase 6 must finish before Phase 7 turns accepted measurement truth into financial workflow.
