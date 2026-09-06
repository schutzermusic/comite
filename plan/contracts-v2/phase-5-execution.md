# Contracts V2 — Phase 5 Execution Specification

Status: **APPROVED EXECUTION SPEC — PHASE 5**

Phase: **Apex Approval Engine**

Repository target:

```text
plan/contracts-v2/phase-5-execution.md
```

Read with:
- `plan/contracts-v2/architecture.md`
- `plan/contracts-v2/deferred-items.md`
- `plan/contracts-v2/phase-4-execution.md`

Rule: frozen architecture first, this spec second, production/repository evidence third. STOP instead of inventing governance.

---

# 1. Baseline

Expected starting point:

```text
main = fe8879527b1dc1e51d3a920478aaff2973d49b07
migration registry tip = 124
090 = intentionally never applied and superseded
```

Phase 4 already provides:

```text
domain_events
transactional outbox
apex_jobs
SKIP LOCKED claim
lease token
retry / dead-letter
GitHub scheduler
after() fast path
```

Contracts is the first Approval Engine pilot.

Suggested branch:

```text
feat/contracts-v2-phase-5
```

Create from updated `main`.

---

# 2. Objective

Build one Platform-owned Approval Engine for Apex.

It must answer:

```text
WHAT decision is requested?
WHY?
WHO can decide?
IN WHAT order?
UNDER WHAT authority?
CAN the same person perform multiple steps?
WHAT policy/version governed it?
WHAT happened?
WHEN?
WHAT is the final outcome?
```

Target:

```text
authoritative business need
→ deterministic policy/version
→ approval request
→ instantiated stages/steps
→ eligibility + SoD + authority
→ atomic decision
→ progression/finalization
→ immutable decision history
→ domain event
→ durable downstream execution
```

Do not build another Contracts-only approval engine.

---

# 3. Approval is not every human action

Distinguish:

```text
APPROVAL
AUTHORIZATION
RELEASE
ACCEPTANCE
VALIDATION
REVIEW
ACKNOWLEDGEMENT
```

These may share the engine but are not semantically interchangeable.

Never interpret review/acknowledgement as approval.

---

# 4. Platform ownership

Platform owns shared approval infrastructure.

Conceptual entities:

```text
approval_policies
approval policy versions / policy steps
approval_requests
approval request steps
approval_decisions
approval_delegations
approval runtime
approval events/read models
```

Exact table split may change after audit.

Contracts owns why a Contract action needs governance and how a final governed outcome affects Contracts.

---

# 5. Mandatory focused audit

Before migrations, audit all existing approval implementations only.

Map:

```text
DOMAIN
TABLES
RPC / ROUTE
STATES
ORDERING
SELF-APPROVAL RULE
SOD
AUTHORITY LIMIT
DELEGATION
HISTORY
PRODUCTION USE
CUTOVER STRATEGY
```

Inspect at minimum:
- Contracts
- Finance
- Procurement/Purchases
- People/HR
- Ponto/Jornada
- Fiscal if present
- Projects/Operations approval-like actions
- permission/role model

Do not delete/migrate anything until this matrix exists.

---

# 6. Mandatory baseline gate

Continue only if:

```text
PHASE 4 MERGED: YES
PRODUCTION GREEN: YES
MIGRATION REGISTRY CONSISTENT: YES
REGISTRY TIP >= 124: YES
090 EXCEPTION EXPLICIT: YES
EVENT GRAPH HEALTHY: YES
APEX JOBS HEALTHY: YES
CURRENT CONTRACT APPROVAL SAFETY PRESENT: YES
ALL EXISTING APPROVAL IMPLEMENTATIONS MAPPED: YES
```

Otherwise STOP.

---

# 7. No big-bang migration

Phase 5 builds shared infrastructure and migrates **Contracts as pilot**.

Do not migrate every module in this phase.

Preferred transition:

```text
shared engine built
→ Contracts pilot
→ legacy history preserved
→ new Contracts writes cut over
→ other domains later
```

---

# 8. Policy model

Approval policies are reusable governance definitions.

They should express:

```text
organization
policy identity
business domain
decision purpose
subject/action type
applicability conditions
effective period
version
stage/step definitions
eligibility
authority rules
SoD rules
delegation permission
quorum
expiration
return/correction behavior
final outcome semantics
```

Policies used by requests become immutable history.

---

# 9. Policy versioning

Required:

```text
Policy v1 → Request A
Policy v2 → Request B
```

Request A must always resolve under v1.

Never retroactively reinterpret old requests with new policy versions.

Policy lifecycle may be:

```text
DRAFT
ACTIVE
INACTIVE
SUPERSEDED
```

Only active versions create new requests.

---

# 10. Deterministic policy selection

Policy selection may use structured context:

```text
organization
domain
action type
subject type
amount
currency
cost center
business unit
contract type
risk class
```

No LLM policy selection.

If zero matches, return explicit no-policy/unsupported according to domain rule.

If multiple authoritative policies match equally, STOP as ambiguous.

Do not choose "latest" or "first row" unless precedence is explicitly governed.

---

# 11. Subject model

Approval request refers to authoritative business subject/action:

```text
subject_type
subject_id
action_type
decision_purpose
```

Server-side domain adapter must:
- resolve subject;
- derive tenant;
- build subject fingerprint;
- expose approval context;
- define final-outcome reaction.

Browser cannot invent tenant or actor.

---

# 12. Request model

Support at least:

```text
id
organization_id
policy identity/version
decision_purpose
subject_type
subject_id
action_type
subject_fingerprint
requested_by
requested_at
request_reason/context
status
current_stage
expires_at
correlation_id
source_event_id nullable
supersedes_request_id nullable
finalized_at
```

Current status is projection, not sole historical truth.

---

# 13. Request lifecycle

Recommended:

```text
PENDING
APPROVED
REJECTED
RETURNED_FOR_CORRECTION
CANCELLED
EXPIRED
SUPERSEDED
```

`RETURNED_FOR_CORRECTION` is not rejection.

Do not add UI-only states.

Conditional approval may be added only if a real current business requirement proves it necessary.

---

# 14. Step/stage model

Support:

```text
ordered stages
parallel steps inside a stage
explicit quorum
```

A staged DAG is enough unless audit proves otherwise.

Each policy step should define:

```text
stable step key
stage/order
name
decision purpose
eligibility basis
authority requirement
SoD requirement
parallel/quorum rule
delegation allowed?
expiration
reason requirements
```

When a request is created, instantiate/snapshot the governed step plan.

Pending requests must not depend on mutable policy definitions.

---

# 15. Step lifecycle

Recommended:

```text
WAITING
OPEN
APPROVED
REJECTED
RETURNED
SKIPPED
CANCELLED
EXPIRED
```

Only open stages accept decisions.

Future-stage decisions are rejected.

Finalized steps cannot be decided again.

Do not silently skip a step because no eligible approver exists.

---

# 16. Parallel / quorum

Parallel approvals occur only where configured.

Example:

```text
Stage 2
Legal + Finance
quorum 2/2
```

One actor counts once.

Rejection behavior must be explicit.

Never assume majority semantics.

---

# 17. Segregation of Duties — mandatory

At minimum support:

```text
requester cannot approve own request
subject creator cannot approve where policy forbids
same actor cannot satisfy incompatible steps
```

Contracts must preserve Phase 0 self-approval protection.

Admin/editor permission does not automatically bypass SoD.

If required actor provenance is missing, do not assume independence.

---

# 18. Authority limits

Support authority limits where real rules require them.

Examples:

```text
up to BRL 10,000
up to BRL 100,000
unlimited
```

Do not hard-code thresholds in handlers.

Capture authority provenance at decision time:

```text
authority source
role/permission basis
limit
amount
currency
```

Do not invent FX conversion.

Unknown/incompatible currency blocks decision when threshold matters.

---

# 19. Eligibility

Eligibility may depend on:

```text
active org membership
permission
role
authority limit
SoD
step-specific rule
valid delegation
```

Re-evaluate at decision time.

Support named approvers and dynamic role/permission-based approvers when needed.

Do not replace a named legal authority with a generic role for convenience.

---

# 20. Delegation

Delegation must be:

```text
explicit
org-scoped
time-bounded
auditable
scope-limited
revocable
```

Model conceptually:

```text
delegator
delegate
scope
effective_from
effective_until
reason
created_by
revoked_at
```

Delegate cannot gain more authority than delegator.

Delegation cannot bypass SoD, tenant boundary or named-person restrictions unless policy explicitly allows it.

Default: no delegation chaining.

Decision history must show the actual delegate and delegation provenance.

---

# 21. Atomic decision RPC — mandatory

All decision logic is one transaction.

Conceptually:

```text
approval_decide(...)
```

Transaction:

```text
lock request/step
→ validate request active
→ validate stage open
→ resolve authenticated actor
→ validate eligibility
→ validate SoD
→ validate authority
→ validate delegation
→ record immutable decision
→ update step projection
→ compute quorum/stage result
→ open next stage if appropriate
→ finalize request if appropriate
→ emit approval event(s)
→ commit
```

No client-side multi-write sequence.

---

# 22. Concurrency safety

Prove:

```text
parallel actors can decide distinct open steps
same single step cannot be decided twice
approve/reject race yields one governed outcome
decision after finalization rejected
duplicate HTTP retry does not duplicate decision
```

Use DB locks/constraints/atomic RPC.

Frontend button state is not a security boundary.

---

# 23. Decision idempotency

Use stable idempotency key.

Same retry = same decision record/result.

Same key with conflicting decision/reason = reject.

Decision history is append-only.

Never edit APPROVE into REJECT.

---

# 24. Reasons

Policy defines whether reason is:

```text
optional
required on reject
required on return
required always
```

Do not require meaningless generic comments unnecessarily.

---

# 25. Cancellation / expiration / supersession

Cancellation:
- authorized only;
- no deletion;
- normally not allowed after finalization.

Expiration:
- distinct from rejection;
- processed by Event Graph/apex_jobs;
- decision after expiry rejected;
- scheduler delay must not alter effective expiry semantics.

Supersession:
- when subject changes materially or a new governed request replaces old;
- old request remains immutable;
- old request no longer decidable.

---

# 26. Subject fingerprint — mandatory

Approval must bind to exact subject content.

Possible fingerprint inputs:

```text
contract version
amendment revision
structured payload hash
document version
amount/currency
```

If subject materially changes:

```text
block old decision
or supersede old request
```

Never let approval of yesterday's object authorize today's modified content.

For amendment approval, prefer exact amendment revision, not mutable container.

---

# 27. One-active-request rule

Prevent duplicate active chains for same governed action/fingerprint unless policy explicitly permits parallel independent processes.

Repeated clicks/events must not create duplicate approval requests.

---

# 28. Events

Use Phase 4 Event Graph.

Initial vocabulary may include:

```text
approval.request.created
approval.step.opened
approval.decision.recorded
approval.request.approved
approval.request.rejected
approval.request.returned_for_correction
approval.request.cancelled
approval.request.expired
approval.request.superseded
```

Events are transactional facts, not commands.

Decision + event(s) commit together.

Use same-org causation/correlation.

---

# 29. Event/job integration

Use existing `apex_jobs` for:
- event-driven request creation where real;
- expiration;
- durable downstream execution;
- optional reminders if explicitly needed.

Do not create an approval-specific job queue.

Do not build speculative Phase 6/7 consumers.

---

# 30. Decision vs downstream execution

Keep separate:

```text
Approval decision = APPROVED
Downstream execution = pending / completed / failed
```

A valid approval is not reverted to PENDING because downstream execution fails.

Use Event Graph/jobs for durable downstream reaction.

If approval finalization and domain mutation must be inseparable, implement one atomic boundary.

If asynchronous, expose execution state truthfully.

---

# 31. Contracts pilot

Audit the existing Contracts approval semantics and select only real governed actions.

Candidates to evaluate:

```text
current contract approval
contract amendment approval if currently governed
contract classification/governance if currently governed
```

Do not make every Contract action approval-required.

Do not invent approval thresholds or approver identities.

---

# 32. Legacy Contracts compatibility

Do not rewrite historical `contract_approvals` or equivalent data to look like shared-engine history if fields were never recorded.

Preferred:

```text
legacy approvals → read-only compatibility adapter
new approvals after cutover → shared engine
```

Define explicit cutover boundary.

After cutover:
- disable old write path;
- preserve legacy read history;
- prevent two engines from creating competing requests.

Do not drop legacy tables in the initial pilot unless unquestionably safe.

---

# 33. No fake historical migration

Do not fabricate:

```text
policy version
authority basis
delegation
step semantics
timestamps
```

for legacy history.

Label legacy provenance honestly.

---

# 34. Policy bootstrap

Do not seed fake business approval policies into real organizations.

Safe migration seeds:

```text
permissions
system vocabularies
```

A real Contracts pilot policy may be created only from authoritative existing rules.

If real rules cannot be proven:
- complete engine infrastructure;
- validate with disposable policy/test org;
- STOP before claiming real Contracts cutover.

---

# 35. Permissions

Potential shared permissions, aligned to repo conventions:

```text
approvals.view
approvals.request
approvals.decide
approvals.delegate
approvals.policy.manage
approvals.admin
```

`approvals.admin` must not mean:
- unlimited approval authority;
- SoD bypass;
- ability to impersonate actor.

Policy administration ≠ business decision authority.

---

# 36. Actor integrity

Human decision actor comes from authenticated identity.

Browser cannot send `approved_by = someone_else`.

System actions use explicit system source and never impersonate a human.

AI may summarize/recommend but cannot approve, reject, authorize, accept or release in Phase 5.

---

# 37. Policy validation

Before activation validate:
- at least one valid step;
- stable unique step keys;
- stage ordering;
- valid quorum;
- no impossible SoD;
- coherent eligibility;
- valid authority rules;
- coherent expiry;
- no cycles if represented.

If requester is forbidden and requester is the only possible approver, detect `NO_ELIGIBLE_APPROVER`.

Do not silently fall back to Admin/Owner.

---

# 38. RLS / structural tenancy

All new tables org-scoped.

Use same-org composite FKs where possible:

```text
request → policy version
request step → request
decision → request/step
source event → domain_events
superseded request → same org
delegation → same org actors
```

Browser roles should not directly mutate decision history.

Decisions go through controlled RPC/server route.

---

# 39. SECURITY DEFINER review

Any SECURITY DEFINER function must:
- set safe `search_path`;
- validate tenant/caller;
- avoid foreign existence oracle;
- use explicit grants;
- not trust caller actor id;
- not leak secrets.

---

# 40. TRUNCATE regression

Every new table must prove:

```text
anon unintended TRUNCATE = 0
authenticated unintended TRUNCATE = 0
```

Do not edit migration 118.

---

# 41. Read model / UI

Create one canonical approval read model resolving:

```text
request
policy/version
subject metadata
current stage
steps
decisions
viewer eligibility/actions
delegation provenance
final outcome
legacy provenance
```

Contracts navigation remains unchanged.

Existing Contracts `Aprovações` workspace and dossier section become views over shared engine + honest legacy history.

No new Approval Engine sidebar.

No generic AI cards.

---

# 42. UX requirements

User must quickly see:

```text
what needs decision
subject
why
stage
who can decide
blocker
age
history
policy/version
delegation
```

Server remains authoritative even if client hides/disables buttons.

---

# 43. Missing semantics

No data must never become:

```text
0 approvals
all approved
no blockers
```

if integration/truth is unknown.

Use explicit missing/unknown semantics where appropriate.

---

# 44. Approval history vs audit log

`approval_decisions` = authoritative decision history.

`audit_logs` = operational/admin audit.

`domain_events` = durable business facts/causality.

Do not replace one with another.

---

# 45. Phase boundaries

Do not implement Phase 6:
- project_measurements;
- measurement acceptance;
- schedule/evidence readiness.

Do not implement Phase 7:
- billing release;
- invoice orchestration;
- AR;
- settlement;
- reconciliation;
- glosa/retention.

Do not implement Phase 8–10.

Approval Engine may later govern those actions but does not own them.

---

# 46. Formal acceptance boundary

A Phase 3 obligation requiring formal acceptance may use Approval Engine only if the policy/request purpose governs that exact acceptance.

Never infer:

```text
evidence present = accepted
approval of something else = formal acceptance
```

---

# 47. Migration strategy

Do not edit migrations 001–124.

Inspect actual tip.

If tip remains 124, likely begin at 125.

Suggested split only:

```text
125 — policies/versioning
126 — requests/steps/decisions
127 — delegation/authority/atomic runtime
128 — Contracts pilot/compatibility
129+ — evidence-driven corrections only
```

Every migration:
- canonical runner;
- registration inside same transaction;
- structural assertions;
- RLS/grant/TRUNCATE review;
- preserves 090 as superseded hole.

---

# 48. Required DB/security tests

Prove:
- same-org structural integrity;
- foreign policy/request/decision rejected;
- foreign delegation rejected;
- no existence oracle;
- browser cannot directly write decisions;
- no actor spoofing;
- self approval blocked;
- out-of-order blocked;
- admin cannot bypass SoD by default;
- no unintended TRUNCATE.

---

# 49. Required policy/version tests

Prove:

```text
Request A → policy v1
activate v2
Request A remains v1
Request B uses v2
```

Policy changes do not rewrite pending/historical requests.

Policy ambiguity blocks request creation.

---

# 50. Required sequential tests

Example:

```text
Stage 1 approve
→ Stage 2 opens
Stage 2 approve
→ request APPROVED
```

Stage 2 cannot decide early.

---

# 51. Required parallel/quorum tests

Example:

```text
Stage 1:
A + B
quorum 2

A approves → request remains pending
B approves → stage completes
```

Use real concurrent DB connections.

---

# 52. Required SoD tests

Prove:

```text
requester cannot self-approve
subject creator blocked where policy says so
same actor cannot satisfy incompatible steps
delegate does not bypass SoD
```

---

# 53. Required authority tests

If real pilot uses thresholds:

```text
amount <= limit → eligible
amount > limit → refused
unknown amount → blocked
wrong currency → blocked
```

No invented FX.

If pilot has no authority thresholds, return `NOT_APPLICABLE` honestly.

---

# 54. Required delegation tests

If delegation implemented:
- valid delegation works;
- provenance recorded;
- expired/revoked refused;
- cross-tenant refused;
- delegate cannot exceed delegator authority;
- forbidden policy delegation refused;
- no chaining.

If real pilot does not require delegation, schema/runtime may still support it but do not fabricate production delegation rows.

---

# 55. Required decision atomicity tests

Failure injection:

```text
decision insert fails → no step/request update
step update fails → no decision commit
finalization fails → no partial final state
event emission fails → whole decision rolls back
```

---

# 56. Required concurrency tests

With real Postgres/two connections:

```text
same step concurrent decisions → one governed result
parallel different steps → both may succeed
approve/reject race → deterministic single finalization
duplicate retry → no duplicate history
decision after final state → refused
```

---

# 57. Required lifecycle tests

Prove:
- rejection;
- return for correction distinct from rejection;
- authorized cancellation;
- expiry;
- decision after expiry refused;
- supersession;
- old superseded request no longer decidable.

---

# 58. Required fingerprint tests

Prove:
- request tied to exact subject content;
- unchanged content allows decision;
- material change invalidates/supersedes;
- old approval cannot authorize new amendment revision.

---

# 59. Required Event Graph tests

Prove:
- approval events emitted in same transaction;
- idempotent;
- same-org causation;
- no event before commit;
- downstream failure does not rewrite decision outcome.

---

# 60. Required legacy/cutover tests

Contracts:
- legacy history remains readable;
- no legacy fields fabricated;
- no new legacy writes after cutover;
- new shared requests visible in existing workspace;
- one business action cannot be active in both engines.

---

# 61. UI tests

Verify:
- navigation unchanged;
- Approvals workspace real data only;
- dossier Approvals real data only;
- viewer eligibility truthful;
- self-approval not possible server-side;
- return/reject reasons visible;
- delegation visible;
- legacy rows labeled honestly;
- no fake approval KPIs.

---

# 62. Production smoke

Use disposable org/test objects.

Smoke:

```text
policy
→ request
→ step decision
→ next stage
→ final decision
→ events
→ read model
```

Also:
- self-approval rejection;
- out-of-order rejection;
- duplicate retry;
- concurrency if practical.

Clean disposable data.

Do not fabricate approval history in real production orgs.

---

# 63. Real Contracts cutover gate

Before enabling real Contracts writes through shared engine:

```text
REAL CONTRACT APPROVAL RULES IDENTIFIED: YES
NO POLICY THRESHOLDS INVENTED: YES
NO APPROVER IDENTITIES INVENTED: YES
LEGACY HISTORY PRESERVED: YES
ONE-WRITE-ENGINE GUARANTEE: YES
PHASE 0 SOD PRESERVED OR SAFELY SUPERSEDED: YES
```

If real policy cannot be proven, engine may be complete but real Contracts cutover remains blocked.

---

# 64. Performance

Index/query-plan coverage for:
- org + request status;
- subject lookup;
- current open steps;
- policy selection;
- decision history;
- delegation validity;
- expiry scan.

Do not over-engineer a BPM platform.

---

# 65. No arbitrary workflow DSL

Prefer structured rules.

Do not introduce:
- arbitrary SQL expressions;
- arbitrary JavaScript;
- user-authored code;
- Turing-complete workflow language.

Phase 5 should support enterprise governance, not become a generic BPMN engine.

---

# 66. Reasonable capability ceiling

Required:

```text
ordered stages
parallel steps
quorum
SoD
authority limits where real
delegation
expiration
return for correction
cancellation
supersession
subject fingerprinting
immutable decisions
```

Not required:
- visual workflow builder;
- arbitrary loops;
- arbitrary code;
- AI decisions.

---

# 67. Preview

Create Vercel Preview.

Verify:
- Contracts navigation unchanged;
- Approvals workspace/dossier work;
- legacy history honest;
- shared-engine pilot works;
- no Phase 6/7 UI;
- no runtime errors;
- no fake data.

If Deployment Protection blocks interactive smoke, report it and run equivalent authenticated E2E.

---

# 68. Regression suite

Run:
- Phase 0 approval/security;
- Phase 1 tenant/Party;
- Phase 2 temporal/lineage;
- Phase 3 obligations;
- Phase 4 Event Graph/jobs;
- migration registry;
- TRUNCATE hardening;
- Approval Engine unit/integration/live DB tests;
- Contracts approval E2E;
- impacted modules only where shared primitives changed;
- `tsc --noEmit`;
- production build;
- changed-file lint.

Keep `.preview/` net diff zero.

---

# 69. Pre-apply gate

Before Phase 5 migrations:

```text
MIGRATION REGISTRY CONSISTENT: YES
CURRENT TIP CONFIRMED: YES
NO VERSION COLLISION: YES
PHASE 4 FINGERPRINT STABLE: YES
TRUNCATE HARDENING GREEN: YES
APPROVAL IMPLEMENTATIONS AUDITED: YES
POLICY MODEL VALIDATED: YES
SOD MODEL VALIDATED: YES
AUTHORITY MODEL VALIDATED: YES
DELEGATION MODEL VALIDATED: YES
ATOMIC DECISION PROVEN IN DRY RUN: YES
CONCURRENCY TESTS GREEN: YES
TENANT SECURITY GREEN: YES
SAFE TO APPLY PHASE 5 MIGRATIONS: YES
```

Otherwise STOP.

---

# 70. STOP conditions

STOP if:
- current approval rules cannot be proven;
- policy selection ambiguous;
- migration registry inconsistent;
- 090 appears applied;
- migration collision;
- legacy approvals require invented provenance;
- real approver identities/limits would need guessing;
- shared engine weakens SoD;
- actor can be spoofed;
- decision cannot be atomic;
- concurrent decisions can double-finalize;
- policy v2 can alter v1 request;
- changed subject can reuse old approval;
- cross-tenant relations are possible;
- delegation can escalate authority;
- admin implicitly bypasses SoD;
- approval event is non-transactional;
- Contracts would have two active write engines;
- pilot requires Phase 6/7 truth;
- production needs fabricated approval data.

Report exact blocker.

---

# 71. Git discipline

At completion:
- branch from updated `main`;
- working tree clean;
- `.preview/` net zero;
- only Phase 5 + required docs/tests;
- push branch;
- do not merge automatically.

---

# 72. Documentation updates

After success:
- mark Phase 5 delivered in `architecture.md`;
- update `deferred-items.md`;
- document policy versioning;
- SoD;
- authority;
- delegation;
- decision lifecycle;
- Contracts cutover;
- legacy compatibility;
- operational runbook.

Do not rewrite historical Phase 0 evidence.

---

# 73. Required final report

Return concise sections:
1. baseline;
2. focused approval audit;
3. legacy implementation matrix;
4. final schema;
5. policy versioning/selection;
6. request lifecycle;
7. stages/steps/quorum;
8. SoD;
9. authority;
10. delegation;
11. atomic decision RPC;
12. concurrency/idempotency;
13. immutable decisions;
14. expiry/return/cancel/supersede;
15. subject fingerprint;
16. Event Graph integration;
17. Contracts pilot;
18. legacy compatibility/cutover;
19. tenant/RLS/security;
20. UI/read model;
21. migrations;
22. tests/failure injection;
23. Preview;
24. production smoke;
25. commit SHA;
26. residual risks;
27. deferred items.

Explicitly answer:
- Is Approval Engine Platform-owned?
- Did Contracts remain the pilot?
- Were legacy approvals rewritten?
- Can requester approve own request?
- Can future unopened step be approved?
- Can one actor satisfy incompatible steps?
- Are authority limits enforced at decision time?
- Can delegation exceed delegator authority?
- Can expired delegation approve?
- Can duplicate retry duplicate history?
- Can concurrent actors double-finalize?
- Does policy v2 alter requests created under v1?
- Can modified subject reuse old approval?
- Can admin bypass SoD by default?
- Does APPROVED mean downstream execution succeeded?
- Are approval events transactional?
- Can AI approve/reject?
- Was Phase 6 implemented?
- Was Finance/AR implemented?
- Was fake production approval data created?
- Did browser roles regain TRUNCATE?
- Were `.preview/` artifacts committed?

---

# 74. Final gate block

End exactly with:

```text
PHASE 4 BASELINE VERIFIED: YES / NO
MIGRATION REGISTRY CONSISTENT: YES / NO
PHASE 5 COMPLETE: YES / NO
APEX APPROVAL ENGINE SHARED: YES / NO
POLICIES VERSIONED / IMMUTABLE: YES / NO
POLICY SELECTION DETERMINISTIC: YES / NO
REQUESTS STRUCTURED: YES / NO
STEPS / STAGES STRUCTURED: YES / NO
PARALLEL / QUORUM WORKING: YES / NO
SEGREGATION OF DUTIES WORKING: YES / NO
AUTHORITY LIMITS WORKING: YES / NO / NOT_APPLICABLE
DELEGATION WORKING: YES / NO / NOT_APPLICABLE
ATOMIC DECISION RPC WORKING: YES / NO
DECISION IDEMPOTENCY WORKING: YES / NO
CONCURRENT DECISION SAFETY PASS: YES / NO
RETURN FOR CORRECTION WORKING: YES / NO
CANCELLATION WORKING: YES / NO
EXPIRATION WORKING: YES / NO
SUPERSESSION WORKING: YES / NO
SUBJECT FINGERPRINT PROTECTION WORKING: YES / NO
DECISION HISTORY IMMUTABLE: YES / NO
APPROVAL EVENTS TRANSACTIONAL: YES / NO
CONTRACTS PILOT WORKING: YES / NO
LEGACY CONTRACT APPROVAL HISTORY PRESERVED: YES / NO
LEGACY CONTRACT APPROVAL NEW WRITES DISABLED AFTER CUTOVER: YES / NO / NOT_CUT_OVER
TENANT ISOLATION PASS: YES / NO
SELF APPROVAL POSSIBLE: NO / YES
OUT-OF-ORDER APPROVAL POSSIBLE: NO / YES
ADMIN DEFAULT SOD BYPASS: NO / YES
AI CAN APPROVE / REJECT: NO / YES
FAKE PRODUCTION APPROVAL DATA CREATED: NO / YES
ANON UNINTENDED TRUNCATE PRIVILEGES: 0 / N
AUTHENTICATED UNINTENDED TRUNCATE PRIVILEGES: 0 / N
PHASE 6+ NOT STARTED: YES / NO
MIGRATIONS APPLIED SAFELY: YES / NO
PRODUCTION GREEN: YES / NO
SAFE TO MERGE PHASE 5: YES / NO
```

---

# 75. Completion definition

Phase 5 is complete only when Apex can do:

```text
business action requires governance
→ deterministic policy/version
→ idempotent request
→ exact subject fingerprint
→ staged approval
→ eligibility + SoD + authority revalidated atomically
→ immutable decision
→ parallel/quorum semantics correct
→ final outcome written once
→ transactional approval event
→ durable downstream execution
```

while proving:

```text
no self approval
no out-of-order approval
no double finalization
no policy-history rewrite
no subject substitution
no tenant leak
no delegation authority escalation
```

Central rule:

```text
DECISION TRUTH FIRST.
WORKFLOW CONVENIENCE SECOND.
```

---

# 76. Architectural outcome

After Phase 5:

```text
AUTHORITATIVE BUSINESS NEED
        ↓
VERSIONED APPROVAL POLICY
        ↓
APPROVAL REQUEST + SUBJECT FINGERPRINT
        ↓
STAGES / STEPS
        ↓
ELIGIBILITY
(permission + authority + SoD + delegation)
        ↓
ATOMIC DECISION
        ↓
IMMUTABLE DECISION HISTORY
        ↓
FINAL OUTCOME
        ↓
DOMAIN EVENT
        ↓
APEX JOBS / DOMAIN EXECUTION
```

This becomes the shared governance substrate for Contracts first, then Projects, Finance, Fiscal, Procurement, People and other Apex domains.

Phase 5 must not implement those future domain capabilities itself.
