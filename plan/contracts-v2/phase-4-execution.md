# Contracts V2 — Phase 4 Execution Specification

Status: **APPROVED EXECUTION SPEC — PHASE 4**

Phase: **Platform Event Graph / Durable Work Execution**

Repository target:

```text
plan/contracts-v2/phase-4-execution.md
```

Primary references:

- `plan/contracts-v2/architecture.md`
- `plan/contracts-v2/deferred-items.md`
- `plan/contracts-v2/phase-3-execution.md`

Execution rule:

> Frozen architecture first. This spec second. Production/repository evidence third. If evidence conflicts with assumptions, STOP instead of improvising.

---

# 1. Baseline

Phase 3 is merged and closed.

Expected `main` baseline at the start of Phase 4:

```text
d24b63daa8090bfaa46d467dbd1a2f1c1c705d4c
```

Expected migration state:

```text
registry tip = 118
090 = intentionally never applied and superseded
112–118 = applied and registered
```

Known baseline:

- canonical obligation definitions/instances are present;
- `contract_obligations_materialize(...)` is deterministic and idempotent;
- `activation_kind = 'external_event'` exists but Phase 3 does not consume events;
- Fiscal Foundation exists;
- `fiscal_jobs` remains Fiscal-owned;
- platform TRUNCATE hardening is applied;
- migrations from 112 onward are applied and registered atomically.

Suggested branch:

```text
feat/contracts-v2-phase-4
```

Branch from updated `main`, never from the old Phase 3 branch.

---

# 2. Objective

Phase 4 creates the shared execution substrate that allows Apex to react durably to business facts without directly coupling modules.

Target:

```text
authoritative mutation
        ↓
domain event in SAME transaction
        ↓
transactional outbox / event graph
        ↓
durable routing
        ↓
apex_jobs
        ↓
safe concurrent claim
        ↓
typed handler
        ↓
success / retry / dead-letter
        ↓
new authoritative mutation
        ↓
new domain event when applicable
```

Contracts is the first consumer.

The infrastructure must be reusable by later:

- Phase 5 — Approval Engine
- Phase 6 — Project / Measurement
- Phase 7 — Billing / Finance
- Phase 8 — Risks
- Phase 10 — Autonomy

Do not implement those later phases here.

---

# 3. Event Graph is not event sourcing

Apex domain tables remain authoritative.

Examples:

```text
contracts
contract_obligation_definitions
contract_obligation_instances
fiscal_documents
projects
```

`domain_events` records durable facts, causality and orchestration.

It does **not** replace domain persistence and it does **not** become the source from which the entire application state must be rebuilt.

Do not redesign Apex as an event-sourced system.

---

# 4. Event vs job

A **domain event** is a fact that already happened.

Use past-tense semantics, for example:

```text
contracts.obligation.instance_activated
contracts.obligation.instance_satisfied
contracts.obligation.instance_waived
contracts.obligation.evidence_recorded
contracts.amendment.created
```

A **job/command** is work Apex should perform:

```text
contracts.obligations.materialize
contracts.obligation.external_activation.apply
contracts.clause_extraction.execute
```

Do not use `domain_events` as a generic command queue.

---

# 5. Ownership

Platform owns:

```text
domain_events
apex_jobs
event routing
worker runtime
scheduler entrypoint
retry/reaper
correlation/causation primitives
operational health primitives
```

Contracts owns:

```text
contract obligation definitions/instances
contract event bindings
contract handlers
clause extraction business result
```

Fiscal owns:

```text
fiscal_documents
fiscal_provider_configs
fiscal_jobs
provider transmission lifecycle
```

Do not migrate `fiscal_jobs` into `apex_jobs` in Phase 4.

---

# 6. Focused preflight

Before migrations, audit only Phase 4-relevant mechanisms:

- current `main`;
- migration registry and 090 exception;
- migrations 112–118;
- current cron routes;
- `.github/workflows`;
- `vercel.json`;
- cron authorization helpers;
- any existing queue/job implementations;
- `fiscal_jobs`;
- Ponto cron;
- clause extraction route/service;
- existing Next.js `after()` use;
- Phase 3 obligation materialization/transition functions;
- current audit logging;
- DB function ownership/security;
- table owners/default privileges.

Produce a concise map:

```text
EXISTING MECHANISM
→ authoritative / domain-specific / reusable / incompatible / legacy
→ Phase 4 action
```

Do not re-audit the whole repository.

---

# 7. Mandatory baseline gate

Continue only if:

```text
MAIN CONTAINS PHASE 3 MERGE: YES
PRODUCTION GREEN: YES
MIGRATION REGISTRY TIP >= 118: YES
090 EXCEPTION STILL EXPLICIT: YES
MIGRATION HISTORY CONSISTENT: YES
ANON TRUNCATE GRANTS: 0
AUTHENTICATED TRUNCATE GRANTS: 0
PHASE 3 OBLIGATION ENGINE PRESENT: YES
```

Otherwise STOP and report.

---

# 8. Canonical `domain_events`

Create one Platform-owned, organization-scoped model supporting at least:

```text
id
organization_id
event_type
schema_version
aggregate_type
aggregate_id
occurred_at
recorded_at
actor_user_id
source
correlation_id
causation_event_id
idempotency_key
payload
routing_state
route_count
routing_error_code
routing_error_safe
```

Rules:

- `organization_id` mandatory;
- `event_type` namespaced text, not ENUM;
- `schema_version` positive integer;
- `aggregate_type + aggregate_id` identifies the primary authoritative subject;
- `occurred_at` is the authoritative business/event time when known;
- `recorded_at` is insertion time;
- source distinguishes human/system/cron/provider/integration;
- causation must remain same-org;
- payload is small, versioned JSON;
- no secrets or binary/private artifacts in payload.

Never persist:

- tokens;
- passwords;
- certificate secrets;
- sessions;
- raw XML/PDF;
- full private documents;
- provider credentials.

---

# 9. Event idempotency

Use stable business identity, conceptually:

```text
UNIQUE (organization_id, event_type, idempotency_key)
```

Random UUID alone is not idempotency.

Examples:

```text
obligation-instance:<instance_id>:history:<history_id>
amendment:<amendment_id>:created
```

Exact duplicate retry may return/reuse the existing event.

Same idempotency key with conflicting meaning must be rejected.

---

# 10. Event immutability

Factual event fields are append-only.

Application paths must not rewrite:

```text
organization_id
event_type
schema_version
aggregate_type
aggregate_id
occurred_at
actor/source
correlation
causation
idempotency_key
payload
```

Routing metadata may evolve only through server-controlled paths.

Browser roles may not mutate events.

Do not use event deletion as undo.

Privileged tenant erasure remains allowed under the existing organization-erasure boundary.

---

# 11. Transactional outbox — absolute invariant

A required event must commit or roll back with the authoritative domain mutation.

Forbidden:

```text
UPDATE domain;
COMMIT;
INSERT event later;
```

Allowed:

```text
transaction
├── authoritative mutation
└── event emission
COMMIT
```

or a specific database trigger when the mutation itself unambiguously means the event.

Do not create generic "every UPDATE emits an event" triggers.

Do not edit applied migrations 114–118.

---

# 12. Safe event emitter

Create a controlled server/database primitive conceptually:

```text
emit_domain_event(...)
```

It must:

- be server-only;
- derive/validate tenant;
- validate same-org causation;
- enforce idempotency;
- use fixed safe `search_path`;
- avoid cross-tenant existence oracles;
- expose only explicit safe grants;
- reject conflicting duplicate meaning.

Do not trust a browser-provided `organization_id` as proof of tenancy.

---

# 13. Initial event vocabulary

Add only current authoritative events with clear semantics.

Audit at minimum:

```text
contracts.obligation.instance_activated
contracts.obligation.instance_satisfied
contracts.obligation.instance_waived
contracts.obligation.evidence_recorded
contracts.amendment.created
```

Only emit a type if:

1. source mutation is authoritative;
2. transactional emission is provable;
3. payload semantics are clear;
4. current/foundational use is justified.

Do not fabricate future events:

```text
projects.measurement.accepted
finance.payment.received
billing.released
```

before those phases exist.

---

# 14. No synthetic historical backfill

Do not fabricate event history for pre-Phase-4 contracts, amendments, obligations, clauses or evidence.

Event capture starts from the Phase 4 go-live boundary.

If current state requires processing, use explicit reconciliation/scheduled work.

Do not invent historical timestamps to make the graph look complete.

---

# 15. Event routing

Persisted events route to zero or more durable jobs via an explicit typed registry:

```text
(event_type, schema_version) → [job_type...]
```

Routing must be:

- idempotent;
- concurrency-safe;
- restart-safe;
- version-aware.

Never mark an event routed before its jobs are durable.

Safe sequence:

```text
unrouted event
→ resolve routes
→ insert jobs idempotently
→ mark routed
```

Crash after job insertion but before routed marker must be safe through job uniqueness.

Events with zero consumers may finalize with `route_count = 0`.

Do not auto-replay historical events when future handlers are added.

---

# 16. Canonical `apex_jobs`

Create one Platform-owned, organization-scoped queue supporting:

```text
id
organization_id
event_id nullable
job_type
payload_version
idempotency_key
status
payload
run_after
attempt_count
max_attempts
locked_at
locked_by
lock_token
last_error_code
last_error_safe
correlation_id
created_at
updated_at
completed_at
```

`event_id` is nullable because work may originate from events, schedules or explicit operator requests.

If present, enforce same-org structural FK.

Lifecycle:

```text
PENDING
PROCESSING
COMPLETED
DEAD_LETTER
CANCELLED
```

Retryable failure returns to `PENDING` with future `run_after`.

---

# 17. Job idempotency

Use stable identity, conceptually:

```text
UNIQUE (organization_id, job_type, idempotency_key)
```

Event-caused jobs may use:

```text
event_id + job_type
```

Scheduled jobs must use stable period keys.

Example:

```text
contracts-obligation-materialize:<organization>:2026-09-06
```

Never use current timestamp alone as idempotency.

---

# 18. Job payload/error safety

Persist references, not secrets.

Never persist:

- API keys;
- bearer tokens;
- cookies;
- certificate passwords;
- DB URL;
- full private documents;
- raw credentials.

Persist only safe error code/message.

Do not serialize raw exception objects if they may contain protected data.

---

# 19. Safe claim using `SKIP LOCKED`

Implement atomic claim using equivalent of:

```sql
FOR UPDATE SKIP LOCKED
```

Claim must atomically:

- select due `PENDING` jobs;
- set `PROCESSING`;
- set `locked_at`;
- set `locked_by`;
- generate `lock_token`;
- increment attempts consistently;
- return claimed jobs.

Do not SELECT then UPDATE later.

---

# 20. Lease token

Completion/failure requires:

```text
job_id + current lock_token
```

Required scenario:

```text
Worker A claims
A hangs
lease expires
reaper releases
Worker B claims
A wakes
A completion rejected
```

This must be proven against real Postgres.

---

# 21. Lock expiry and reaper

Expired `PROCESSING` jobs must recover.

Conceptually:

```text
PROCESSING + expired lease
→ PENDING if attempts remain
→ DEAD_LETTER if exhausted
```

Reaper must:

- not steal fresh leases;
- invalidate the old token;
- preserve truthful attempt count;
- be idempotent;
- persist only safe failure reason.

---

# 22. Retry policy

Retry only genuinely transient failures:

```text
timeout
408
429
temporary 5xx
temporary network/database failure
explicit retryable provider error
```

Do not retry deterministic failures:

```text
invalid payload/version
unknown job type
cross-tenant mismatch
missing provenance
permission failure
business invariant violation
```

Use bounded exponential backoff.

---

# 23. Delivery semantics

The worker is **at-least-once**.

Do not claim exactly-once.

Handlers must be idempotent because a crash can occur after a side effect but before job completion is recorded.

---

# 24. Typed handler registry

Create runtime-validated typed registry:

```text
job_type → handler
```

Each handler defines:

- payload version;
- tenant validation;
- idempotency basis;
- retryable failures;
- terminal failures.

Unknown type/version must be terminal and visible.

Never execute arbitrary code named by untrusted payload data.

---

# 25. Recursive transactional discipline

If a handler changes authoritative domain state and that mutation requires a new event:

```text
domain mutation + new event
```

must again be one transaction.

Causal events use:

```text
new_event.causation_event_id = source_event.id
new_event.correlation_id = source_event.correlation_id
```

Do not reintroduce dual-write races downstream.

---

# 26. Loop prevention

Use:

- stable event idempotency;
- explicit route registry;
- handler semantics;
- causation tests.

Do not rely on a generic max-depth counter as the primary correctness mechanism.

---

# 27. Scheduler

Scheduler is a wake-up mechanism, not business truth.

Primary cadence:

```text
GitHub Actions
*/10 * * * *
→ authenticated Platform drain endpoint
```

The queue must tolerate delayed GitHub scheduling.

Do not depend on exact scheduler time.

Do not depend on frequent Vercel Hobby cron.

---

# 28. Cron authorization

Create/reuse strong server-only Bearer authorization.

Requirements:

- no secret in query string;
- no secret in logs;
- wrong/missing secret rejected;
- ordinary authenticated user cannot run worker;
- reuse an authoritative existing helper if appropriate.

Do not weaken Ponto cron security.

---

# 29. Drain endpoint

Create one Platform execution entrypoint, conceptually:

```text
POST /api/platform/jobs/drain
```

One bounded drain:

```text
1. authorize
2. reap expired leases
3. run scheduled producers
4. route unrouted events
5. claim due jobs
6. execute bounded batch
7. record outcomes
8. return safe counters
```

Safe counters may include:

```text
reaped
events_routed
jobs_created
claimed
completed
retried
dead_letter
duration_ms
```

Do not return sensitive payloads.

---

# 30. Bounded execution

Use:

- max route batch;
- max jobs per batch;
- elapsed-time budget;
- provider timeouts;
- graceful stop before hosting timeout.

If work remains, leave it durable for the next wake-up.

---

# 31. `after()` fast path

Use Next.js `after()` only as best-effort low-latency wake-up after durable commit:

```text
commit durable event/job
→ response
→ after()
→ small drain
```

Correctness remains the queue + scheduler.

If `after()` never runs, work must still execute later.

---

# 32. Scheduled producer registry

Not all work comes from events.

Create a code-level scheduled producer registry:

```text
platform scheduler
→ producer registry
→ domain producer
→ enqueue apex_job
→ domain handler
```

Keep Platform generic.

Do not put Contracts-specific SQL directly into worker core.

---

# 33. Automatic obligation materialization — required

Phase 3 explicitly deferred automatic materialization to Phase 4.

Implement using existing:

```text
contract_obligations_materialize(...)
```

Do not rewrite recurrence logic in TypeScript.

Requirements:

- stable job idempotency;
- tenant-safe;
- bounded rolling horizon;
- no duplicate occurrences;
- no fabricated dates;
- unknown anchor remains unknown;
- business-days stay unknown without calendar;
- removed/superseded definitions handled correctly;
- demo data excluded from official metrics.

Do not materialize arbitrary years ahead.

---

# 34. External-event obligation activation — required

Phase 3 stores:

```text
activation_kind = external_event
activation_event_text
```

but does not consume events.

Phase 4 adds explicit execution binding.

Do not infer event type from contractual text via LLM/fuzzy matching.

Use explicit binding, conceptually:

```text
obligation definition
+ platform event type
+ schema version
+ optional aggregate/subject constraints
→ activation binding
```

Contract text remains legal provenance.
Binding is execution configuration.

Do not rewrite contractual history to fit event taxonomy.

---

# 35. Binding requirements

Bindings must:

- be org-scoped;
- reference the obligation definition;
- preserve definition history;
- declare event type/version;
- optionally constrain aggregate/subject;
- record creator/source;
- reject cross-tenant relation;
- be auditable;
- avoid fuzzy identity matching.

If contractual definition changes, follow lineage.

Do not silently retarget a historical definition.

---

# 36. External activation handler

On matching authoritative event:

```text
event
→ explicit binding
→ determine occurrence
→ materialize if deterministic
→ activate only target instance(s)
→ preserve Phase 3 history/invariants
→ emit activation event transactionally
```

If occurrence mapping is ambiguous:

```text
UNKNOWN / unresolved
```

Do not guess.

Use authoritative event occurrence time, not worker execution time.

Example:

```text
event occurred Sep 10
worker ran Sep 11
activated_at = Sep 10
```

when Sep 10 is the triggering business fact.

---

# 37. No fake external events

Do not fabricate `measurement.accepted`, `service.completed` or similar production events.

Phase 6 does not exist yet.

Tests may use disposable orgs/transactions.

If no real producer exists, implement mechanics/tests without production business fabrication.

---

# 38. Queued clause extraction — required

Move current clause extraction workload to durable queued execution where appropriate.

Preserve:

- document evidence gate;
- page/excerpt provenance;
- fingerprint/idempotency;
- AI analysis history;
- human review;
- no automatic promotion of AI inference to contractual truth.

Queueing changes execution reliability, not legal meaning.

Target:

```text
request extraction
→ durable job/request
→ return queued/pending
→ worker executes
→ existing result model updated
```

Use asynchronous HTTP semantics where appropriate.

Repeated request must not multiply provider work.

Retry transient provider/network failures only.

Never persist protected document content or API secrets in queue errors.

---

# 39. Fiscal boundary

Do not:

- replace `fiscal_jobs`;
- rename it;
- move provider transmission into Apex queue;
- enable Fiscal production;
- implement Phase 7 Finance integration.

`fiscal_jobs` remains Fiscal-owned.

---

# 40. Ponto boundary

Do not migrate Ponto cron/jobs into Event Graph.

Reuse only proven patterns where appropriate.

Ponto remains out of Phase 4 scope unless a shared helper change is unavoidable.

---

# 41. Phase 5+ boundaries

Do not implement:

## Phase 5
Approval Engine tables/decisions/delegations.

## Phase 6
Project measurements, measurement acceptance, field evidence/schedule readiness.

## Phase 7
Billing release, invoice orchestration from Contracts, AR, settlement, reconciliation, glosa, retention.

## Phase 8
Operational risk graph.

## Phase 9
Contract Control Tower.

## Phase 10
Autonomy policy/execution engine.

No worker may manufacture approval, measurement acceptance or billing release.

---

# 42. Security posture

`domain_events` and `apex_jobs` are server infrastructure.

Default:

```text
anon          → no direct access
authenticated → no direct mutation
```

Use RLS as defense in depth, not as the only boundary.

Explicitly revoke unsafe DML/TRUNCATE.

No end-user Event Graph or Jobs workspace is required.

---

# 43. Same-org structural integrity

Enforce tenant coherence where structurally possible:

```text
apex_jobs.organization_id + event_id
→ domain_events.organization_id + id

domain_events.organization_id + causation_event_id
→ domain_events.organization_id + id

obligation event binding
→ same-org obligation definition
```

For polymorphic aggregate IDs, compensate with controlled emitters + tests.

---

# 44. SECURITY DEFINER review

Every new `SECURITY DEFINER` function must prove:

- safe fixed `search_path`;
- caller/tenant validation;
- no cross-tenant existence oracle;
- explicit grants/revokes;
- no unsafe browser execution;
- no owner-vs-caller identity confusion;
- no secret leakage.

---

# 45. Migration 118 regression

Every new Phase 4 table must prove:

```text
anon TRUNCATE = false
authenticated TRUNCATE = false
```

Do not edit migration 118.

If new tables unexpectedly inherit TRUNCATE, STOP and investigate owner/default ACL drift.

---

# 46. Infrastructure state ≠ business truth

A failed job does not mean a contractual obligation failed.

`DEAD_LETTER` is infrastructure state, not legal/business state.

Keep queue state separate from domain state.

---

# 47. Dead-letter and replay

Do not auto-delete dead letters.

Provide operator-safe inspection:

```text
job type
tenant
safe error
attempts
age
event/correlation
```

Manual replay may exist through internal script/endpoint.

Replay must:

- preserve auditability;
- preserve idempotency;
- not erase prior failure.

No end-user UI required.

---

# 48. Operational health

Provide internal health/readiness that can answer:

```text
due pending jobs
oldest pending age
processing jobs
expired leases
dead-letter count
unrouted event count
oldest unrouted age
last successful drain
```

No sensitive payload output.

This is infrastructure observability, not Phase 9 Control Tower.

---

# 49. Structured logs

Logs should include:

```text
organization_id
event_id
job_id
correlation_id
job_type
attempt
result
duration
```

Do not log full payload by default.

No silent catches for durable work.

Every failure becomes retry, terminal/dead-letter, cancellation or rollback.

---

# 50. Typed schemas

Create runtime-validated registries:

```text
EventType
EventPayloadByType
EventSchemaVersion

JobType
JobPayloadByType
```

Unknown type/version must not be silently interpreted.

Malformed persisted payload must become terminal rather than crash the worker forever.

---

# 51. Event naming

Use:

```text
<domain>.<entity>.<past_tense_fact>
```

Avoid:

```text
button_clicked
screen_opened
run_ai
```

Do not encode schema version in event type when `schema_version` exists.

---

# 52. Derived time state is not an event

Do not emit daily "became overdue" events merely because time passed.

Phase 3 derives urgency from:

```text
state + due_date + asOf
```

Scheduled materialization is work, not a fake business event.

---

# 53. Indexing

Create only indexes needed by real access patterns.

Events:

```text
unrouted
organization + recorded_at
event_type + version
aggregate
correlation
causation
idempotency
```

Jobs:

```text
PENDING + run_after
PROCESSING + locked_at
organization + status
event_id
correlation
job_type
idempotency
dead-letter age
```

Verify claim/reaper/routing query plans.

Do not ship obvious full-table scans every 10 minutes.

---

# 54. Fairness and ordering

Do not claim global ordering.

If per-aggregate serialization is required, use a scoped concurrency key/advisory lock.

Do not serialize the whole platform.

Audit whether one tenant backlog can starve others, but do not build a complex fair scheduler without evidence.

---

# 55. GitHub scheduler workflow

Add a dedicated workflow, conceptually:

```text
.github/workflows/apex-jobs.yml
```

Target:

```yaml
schedule:
  - cron: '*/10 * * * *'
workflow_dispatch:
```

Use:

- protected URL/secret;
- explicit timeout;
- HTTP status validation;
- non-zero exit on failure;
- safe counters;
- concurrency group;
- `cancel-in-progress: false`.

Do not print secrets.

---

# 56. Concurrent wake-ups

Drain must be safe under concurrent:

```text
GitHub Actions
after()
manual operator trigger
optional fallback cron
```

Duplicate wake-ups must not duplicate authoritative effects.

---

# 57. Audit logs vs events

Do not replace `audit_logs`.

Audit answers:

```text
who performed/attempted an action?
```

Domain event answers:

```text
what durable business fact happened and what did it cause?
```

One action may create both.

---

# 58. Migration strategy

Do not edit migrations 001–118.

Inspect current tip.

If still 118, likely begin at 119.

Suggested concern split only:

```text
119 — domain_events / outbox
120 — apex_jobs / lease / claim / reaper
121 — Contracts event bindings + transactional emissions
122 — queued clause extraction / scheduler support
123+ — live-proof corrections only
```

Do not create empty migrations to match this outline.

Every migration must be applied and registered atomically using the canonical runner pattern.

Preserve 090 as explicit superseded hole.

---

# 59. Pre-apply gate

Before production apply:

```text
MIGRATION REGISTRY CONSISTENT: YES
CURRENT TIP CONFIRMED: YES
NO VERSION COLLISION: YES
PHASE 3 FINGERPRINT STABLE: YES
FISCAL FOUNDATION FINGERPRINT STABLE: YES
TRUNCATE HARDENING GREEN: YES
NEW RLS/GRANTS REVIEWED: YES
SECURITY DEFINER REVIEWED: YES
OUTBOX TRANSACTIONALITY PROVEN: YES
JOB CLAIM CONCURRENCY PROVEN: YES
LEASE/REAPER PROVEN: YES
```

Then:

```text
SAFE TO APPLY PHASE 4 MIGRATIONS: YES
```

Otherwise STOP.

---

# 60. Required event tests

Prove:

- organization required;
- event type non-empty;
- schema version positive;
- exact duplicate idempotent;
- conflicting idempotency reuse rejected;
- same-org causation;
- cross-org causation rejected;
- factual fields immutable;
- application cannot erase event history;
- privileged tenant erasure still works;
- browser direct mutation denied;
- no unintended TRUNCATE.

---

# 61. Required transactional-outbox tests

Prove:

```text
domain succeeds + event succeeds → both commit
event fails → domain mutation rolls back
domain fails → no event
duplicate request → no duplicate event
foreign-org emission → rejected
migration apply → no fake historical events
```

This test family is merge-blocking.

---

# 62. Required routing tests

Prove:

- unrouted event routes;
- rerouting cannot duplicate jobs;
- zero-consumer event finalizes cleanly;
- crash between job insert and routed marker cannot lose work;
- unsupported event version is not silently dropped;
- foreign-tenant event/job relation rejected;
- routing does not mutate factual event payload.

---

# 63. Required job tests

Against real Postgres prove:

- only due PENDING jobs claim;
- two workers do not receive same lease;
- `SKIP LOCKED` works;
- claim sets token/time/worker;
- stale token cannot complete;
- current token completes;
- retryable failure schedules retry;
- terminal failure dead-letters;
- exhausted retries dead-letter;
- fresh lease not reaped;
- expired lease reaped;
- old worker cannot complete after reaper;
- job idempotency works;
- cross-tenant event/job link rejected;
- browser mutation rejected;
- no unintended TRUNCATE.

---

# 64. Required worker tests

Test:

- typed dispatch;
- unknown job type terminal;
- malformed payload terminal;
- retry classification;
- safe error sanitization;
- bounded batch;
- time-budget stop;
- one job failure does not corrupt another;
- concurrent drains safe;
- logs contain IDs but not secrets.

---

# 65. Required scheduler authorization tests

Prove:

- missing Bearer rejected;
- wrong Bearer rejected;
- correct Bearer accepted;
- browser login alone insufficient;
- secret not returned/logged;
- workflow fails on non-2xx.

---

# 66. Required obligation materialization tests

Prove:

- producer enqueues correct work;
- repeated producer creates no duplicate job;
- repeated handler creates no duplicate occurrence;
- removed definition ignored;
- horizon bounded;
- unknown anchor remains unknown;
- business-days remains unknown without calendar;
- tenant isolation;
- demo does not affect official metrics.

---

# 67. Required external activation tests

Disposable data only.

Prove:

- explicit binding required;
- free-text descriptor alone does not activate;
- matching event activates correct target;
- wrong type/version does not;
- wrong tenant does not;
- duplicate delivery does not duplicate history;
- authoritative event time drives activation;
- delayed worker does not change activation time;
- ambiguous occurrence mapping remains unresolved;
- causal chain preserved.

---

# 68. Required clause extraction queue tests

Prove:

- request becomes durable work;
- HTTP request can finish before provider execution;
- duplicate request does not duplicate provider call;
- evidence gate preserved;
- fingerprint idempotency preserved;
- transient provider failure retries;
- deterministic validation error does not retry;
- successful job writes existing analysis/result model;
- no obligation auto-created from AI output;
- sensitive data absent from queue errors.

---

# 69. Failure injection

Inject failures at:

```text
after domain mutation before event insert
after event before routing
after job insert before routed marker
after claim before handler
after idempotent domain effect before job completion
after lease expiry
stale completion after re-claim
```

Expected:

```text
no lost durable work
no duplicate authoritative fact
no cross-tenant mutation
```

---

# 70. Production smoke

Use disposable organization/transaction where possible.

Prove:

```text
event
→ route
→ job
→ claim
→ handler
→ complete
```

Also smoke:

```text
scheduled obligation materialization
```

and queued clause extraction without fabricating real business data.

Clean all disposable records.

---

# 71. Scheduler production verification

After deployment:

- workflow exists;
- secret configured without exposure;
- manual trigger succeeds;
- HTTP 2xx;
- counters sane;
- no duplicate work;
- scheduled cadence correct.

Do not claim scheduler operational merely because YAML exists.

---

# 72. Performance gate

Validate:

- claim query plan;
- reaper query plan;
- unrouted event scan;
- bounded indexes;
- cheap idle drain.

Avoid speculative over-engineering, but do not ship O(N) scans on every wake-up.

---

# 73. UI boundary

Do not redesign Contracts navigation.

Do not add:

- Event Graph sidebar;
- Jobs end-user workspace;
- generic AI cards;
- Phase 5–7 UI.

User-facing change only where behavior is real, e.g. queued extraction status or externally activated obligation state.

Operational queue tooling stays internal.

---

# 74. Preview

Create Vercel Preview.

Verify:

- Contracts navigation unchanged;
- Obligations workspace works;
- dossier works;
- extraction flow works;
- no runtime errors;
- no fake metrics;
- no Phase 5+ UI.

If Deployment Protection blocks interactive smoke, report it and run equivalent authenticated local E2E.

Do not weaken protection.

---

# 75. Regression suite

Run:

- Phase 0 Contracts security;
- Phase 1 Party/tenant;
- Phase 2 temporal/lineage;
- Phase 3 obligations;
- migration registry;
- platform TRUNCATE hardening;
- Fiscal Foundation security;
- queued clause extraction;
- Ponto only if shared cron helper touched;
- Contracts unit/integration/E2E;
- impacted Fiscal tests;
- impacted Finance/Projects tests only if shared primitives touched;
- `tsc --noEmit`;
- production build;
- changed-file lint.

Keep `.preview/` net diff zero.

---

# 76. Git discipline

At completion:

- working tree clean;
- `.preview/` net zero;
- branch based on current `main`;
- only Phase 4 plus directly required tests/docs;
- push branch;
- do not merge automatically.

---

# 77. Documentation updates

After successful Phase 4:

- mark Phase 4 delivered in `deferred-items.md`;
- move residual items to explicit deferred list;
- update stale phase-status text in `architecture.md`;
- add scheduler/worker runbook;
- document dead-letter/recovery;
- document event/job naming/versioning.

Do not rewrite historical decisions.

---

# 78. STOP conditions

STOP if:

- registry no longer matches production;
- 090 appears applied;
- migration collision exists;
- event cannot be emitted transactionally with required domain mutation;
- tenant cannot be derived safely;
- stable idempotency identity cannot be defined;
- cross-tenant polymorphic handling cannot be made safe;
- external activation requires semantic guessing;
- occurrence mapping is ambiguous;
- queue requires secrets in payload;
- SECURITY DEFINER creates tenant oracle;
- browser roles regain unsafe privilege;
- concurrent claim safety cannot be proven;
- stale lease can complete;
- correctness depends on exact scheduler timing;
- `fiscal_jobs` needs destructive migration;
- handler requires Phase 5/6/7 truth;
- production data must be fabricated to demonstrate the feature.

Report exact blocker and evidence.

---

# 79. Required final report

Return concise sections:

1. baseline/preflight;
2. migration registry;
3. `domain_events`;
4. event immutability;
5. transactional outbox proof;
6. event type/version registry;
7. routing;
8. `apex_jobs`;
9. job idempotency;
10. SKIP LOCKED claim;
11. lease token;
12. reaper;
13. retry/dead-letter;
14. scheduler;
15. cron authorization;
16. `after()` fast path;
17. obligation auto-materialization;
18. external obligation activation;
19. clause extraction queue;
20. Fiscal/Ponto boundaries;
21. tenant/security;
22. TRUNCATE regression;
23. failure injection;
24. tests;
25. Preview;
26. production smoke;
27. workflow verification;
28. commit SHA;
29. residual risks;
30. deferred items.

Explicitly answer:

- Is Event Graph event sourcing?
- Are required events atomic with business mutations?
- Can a committed mutation exist without its required event?
- Can routing duplicate jobs?
- Can two workers execute the same lease?
- Can a stale worker complete after lease recovery?
- Are handlers idempotent?
- Are payloads secret-free?
- Was historical event data fabricated?
- Was external activation inferred from free text?
- Was `fiscal_jobs` replaced?
- Was Ponto cron migrated?
- Was Approval Engine implemented?
- Was Project Measurement implemented?
- Was Finance/AR implemented?
- Was any production demo event fabricated?
- Did browser roles regain TRUNCATE?
- Were `.preview/` artifacts committed?

---

# 80. Final gate block

End exactly with:

```text
PHASE 3 BASELINE VERIFIED: YES / NO
MIGRATION REGISTRY CONSISTENT: YES / NO
PHASE 4 COMPLETE: YES / NO
DOMAIN EVENTS STRUCTURED: YES / NO
EVENT PAYLOAD VERSIONING WORKING: YES / NO
TRANSACTIONAL OUTBOX PROVEN: YES / NO
EVENT IDEMPOTENCY WORKING: YES / NO
EVENT ROUTING IDEMPOTENT: YES / NO
APEX JOBS STRUCTURED: YES / NO
SKIP LOCKED CLAIM WORKING: YES / NO
LEASE TOKEN SAFETY WORKING: YES / NO
LOCK REAPER WORKING: YES / NO
RETRY / DEAD LETTER WORKING: YES / NO
CONCURRENT DRAIN SAFE: YES / NO
GITHUB SCHEDULER WORKING: YES / NO
CRON AUTHORIZATION SAFE: YES / NO
AFTER FAST PATH SAFE: YES / NO
OBLIGATION AUTO-MATERIALIZATION WORKING: YES / NO
EXTERNAL OBLIGATION ACTIVATION WORKING: YES / NO
CLAUSE EXTRACTION QUEUED: YES / NO
HISTORICAL EVENTS FABRICATED: NO / YES
FISCAL JOBS LEFT DOMAIN-OWNED: YES / NO
PONTO CRON LEFT INTACT: YES / NO
TENANT ISOLATION PASS: YES / NO
ANON UNINTENDED TRUNCATE PRIVILEGES: 0 / N
AUTHENTICATED UNINTENDED TRUNCATE PRIVILEGES: 0 / N
SECRETS PERSISTED IN EVENT/JOB PAYLOADS: NO / YES
PHASE 5+ NOT STARTED: YES / NO
MIGRATIONS APPLIED SAFELY: YES / NO
PRODUCTION GREEN: YES / NO
SAFE TO MERGE PHASE 4: YES / NO
```

---

# 81. Completion definition

Phase 4 is complete only when Apex can truthfully and durably do:

```text
real fact happens
→ fact committed with authoritative mutation
→ platform cannot lose it
→ durable routing
→ durable job
→ safe concurrent claim
→ crash recovery
→ bounded retries
→ visible dead-letter
→ idempotent authoritative effect
→ causal trace remains queryable
```

First required Contracts automations:

```text
scheduled wake-up
→ obligation materialization job
→ existing Phase 3 materializer
```

and:

```text
explicit authoritative event
→ explicit obligation event binding
→ correct obligation activation
```

and:

```text
clause extraction request
→ durable queued job
→ existing evidence-gated extraction
```

Central rule:

```text
DURABILITY FIRST.
AUTOMATION SECOND.
```

Apex must never become more autonomous by becoming less truthful.

---

# 82. Architectural outcome

After Phase 4:

```text
DOMAIN TRUTH
contracts / obligations / fiscal / projects / finance
        ↓
TRANSACTIONAL FACT
domain_events
        ↓
DURABLE WORK
apex_jobs
        ↓
EXECUTION
typed handlers
        ↓
RECOVERY
retry + lease + reaper + dead-letter
        ↓
LOW-LATENCY WAKE-UP
after()
        +
DURABLE WAKE-UP
GitHub Actions scheduler
```

Phase 5 can later create governed approval work.
Phase 6 can emit real project/measurement facts.
Phase 7 can safely react with Fiscal/Finance.
Phase 10 can add policy-driven autonomy.

Phase 4 must finish without implementing those future decisions.
