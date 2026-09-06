# Contracts V2 — Phase 3 Execution Specification

Status: **APPROVED EXECUTION SPEC — PHASE 3**

Phase: **Obligations Engine**

Repository path:

```text
plan/contracts-v2/phase-3-execution.md
```

This document is the primary execution specification for Contracts V2 Phase 3.

Read together with:
- `plan/contracts-v2/architecture.md`
- `plan/contracts-v2/deferred-items.md`
- `plan/contracts-v2/phase-2-execution.md`

Priority:
1. frozen architecture invariants;
2. this Phase 3 execution spec;
3. production/repository evidence may trigger STOP;
4. never silently redesign.

---

# 1. Objective

Phase 3 turns contractual obligations from a task-list concept into a structured, traceable obligations engine.

It must answer:

```text
WHAT must happen?
WHO is contractually responsible?
WHO benefits / receives / verifies?
WHY is it required?
WHEN does it become applicable?
WHEN is it due?
IS it recurring?
WHAT does it depend on?
WHAT evidence is required?
WHAT exception or waiver exists?
WHAT escalation is applicable?
WHAT contractual financial consequence exists?
DOES the unresolved obligation block billing?
```

Phase 3 does not implement the Event Graph, Approval Engine, Project Measurement Engine, Finance chain, Control Tower, or autonomy.

The target is a deterministic contractual model that later phases can automate.

---

# 2. Required baseline

Before implementation confirm:
- Phase 2 merged into `main`;
- migrations 108–111 present;
- production Phase 2 schema present;
- production green;
- clean working tree;
- `.preview/` clean;
- current migration tip known;
- migration-registry gate below closed.

Suggested branch:

```text
feat/contracts-v2-phase-3
```

---

# 3. Mandatory pre-Phase-3 gate — migration history reconciliation

Production schema contains migrations beyond the version recorded in `supabase_migrations.schema_migrations`.

Resolve this before the first Phase 3 migration is created or applied.

## 3.1 Required proof

Inspect migrations 089–111 file-by-file.

For every version:
- prove the file exists;
- prove its intended structural effect exists in production;
- prove there is no partial apply;
- prove there is no version collision;
- record the result.

Do not infer applied state from file presence alone.
Do not replay already-applied SQL just to advance the registry.

## 3.2 Reconciliation rule

Use the safest supported mechanism in the actual Supabase/project tooling to mark proven historical migrations as applied.

Prefer a supported migration-history repair mechanism over arbitrary direct writes.

If direct registry writes are the only path, STOP unless an approved repository precedent exists and the exact registry schema is verified.

After reconciliation, future migration application must not recreate the drift.

The future apply path must either:
- update the canonical migration registry on every successful apply; or
- use the canonical Supabase migration mechanism, with custom preflight/assertion scripts around it.

Do not maintain two independent migration histories.

Gate:

```text
MIGRATIONS 089–111 PROVEN APPLIED: YES
MIGRATION REGISTRY RECONCILED: YES
SCHEMA AND MIGRATION HISTORY CONSISTENT: YES
FUTURE APPLY PATH RECORDS MIGRATION HISTORY: YES
```

If any answer is NO or cannot be proven: **STOP PHASE 3.**

---

# 4. Focused production preflight

Inspect only what Phase 3 needs:
- obligation-like tables;
- Contracts obligation services/types/routes/components;
- production obligation rows;
- links to contracts, clauses, amendments, documents and milestones;
- statuses/responsibility fields;
- due/recurrence fields;
- evidence/document links;
- billing-block fields;
- `Obrigações` UI assumptions;
- tenant ownership/RLS;
- whether each existing object is authoritative or legacy/to-do-list-like.

Produce:

```text
EXISTING OBJECT
→ authoritative / compatible / superseded / legacy adapter / unused
→ Phase 3 action
```

Do not create a second obligations model when an existing one can be safely evolved.

Do not destructively migrate ambiguous legacy rows.
If mapping is not deterministic, preserve history and STOP if destructive migration would be required.

---

# 5. Definition vs Instance — mandatory split

## Obligation Definition

Represents what the contract requires.

Examples:
- submit monthly safety report;
- maintain valid performance guarantee;
- provide measurement report before billing;
- client must issue formal acceptance within 10 calendar days;
- renew insurance annually.

A definition is contractual truth. It must carry provenance.

## Obligation Instance

Represents one occurrence.

Examples:
- monthly safety report — September 2026;
- insurance renewal — policy year 2027;
- measurement report — Milestone 12;
- client acceptance — Measurement #45.

Definitions and instances must not collapse into one mutable to-do row.

A recurring definition may produce many instances.
An instance may evolve operationally, but transition history remains queryable.

---

# 6. Canonical conceptual model

Use repository evidence for final physical names, but support these concepts:

```text
contract_obligation_definitions
contract_obligation_parties
contract_obligation_instances
contract_obligation_dependencies
contract_obligation_evidence_requirements
contract_obligation_evidence
contract_obligation_exceptions
contract_obligation_escalation_rules
contract_obligation_instance_history
```

Exact names may differ if an authoritative existing model should be evolved.

Do not create rival truth sources.

---

# 7. Obligation definition requirements

Each canonical definition must be organization- and contract-scoped and support where applicable:
- stable identity;
- title;
- requirement text;
- category/type;
- contractual responsible side;
- one or more contractual parties;
- source clause;
- source amendment;
- source document;
- source page/reference;
- effective period;
- predecessor/supersession lineage;
- activation rule;
- due rule;
- recurrence rule;
- evidence requirements;
- escalation rules;
- financial consequence definition;
- `blocks_billing`;
- recorded metadata.

Absence remains absence.
Do not fill unknowns with truth-asserting defaults.

---

# 8. Historical truth and lineage

If an amendment changes an obligation:

```text
old obligation definition
→ predecessor
→ new obligation definition
```

Do not overwrite the old requirement.

Reuse the historical vocabulary already established where applicable:

```text
added
altered
removed
```

Requirements:
- old versions queryable;
- current state derived;
- removed obligations historical;
- effective dates only from explicit evidence;
- no fabricated provenance;
- same-org/same-contract lineage coherence;
- ambiguous successors rejected;
- cycles rejected.

Unknown amendment effective date means affected state remains UNKNOWN/non-comparable.

---

# 9. Contractual parties and responsibility

Support bilateral and multilateral responsibility:
- Insight / contracting organization;
- customer / contracting party;
- supplier / subcontractor;
- insurer;
- bank / guarantor;
- inspector;
- regulator;
- other explicitly identified third party.

Do not misuse global `party_roles` for contract-relative relationships.

Contract-relative roles belong to Contracts and may include, where justified:

```text
obligor
beneficiary
recipient
verifier
guarantor
insurer
other
```

Do not assume only one external party.

Do not infer Party identity by name similarity or LLM.
If canonical identity cannot be deterministically proven, preserve text and leave the Party link missing.

Internal employee/team assignment is operational coordination and must remain distinct from contractual responsibility.

---

# 10. Activation model

Structure when an obligation becomes applicable.

Support concepts equivalent to:

```text
date-based activation
contract-date-relative activation
explicit/manual activation
future external-event activation
```

Examples:
- contract start;
- N days after start;
- N days before end;
- fixed contractual date;
- explicit contractual event.

Do not build Phase 4 `domain_events`.

For future external events, Phase 3 may store the contractual trigger descriptor, but does not consume a platform event bus.

An event not observed must not be treated as activated.

---

# 11. Due rules

Separate the contractual rule from the calculated due date.

Support, where evidenced:
- fixed date;
- N days after activation;
- N days before contract end;
- same day as activation;
- recurring due rule.

The rule is contractual truth.
The calculated date is derived.

## Calendar basis

Distinguish:

```text
calendar_days
business_days
unspecified
```

Do not calculate business-day deadlines without an authoritative calendar.

If the contract says "5 business days" but no calendar exists:

```text
due_rule = known
due_date = UNKNOWN
```

Never treat business days as calendar days.

---

# 12. Recurrence

Recurring obligations are mandatory Phase 3 scope.

Support where evidenced:
- one-time;
- daily;
- weekly;
- monthly;
- quarterly;
- yearly;
- fixed interval;
- explicit custom dates if needed.

Do not invent recurrence.

## Materialization

Provide deterministic, idempotent instance materialization, conceptually:

```text
materialize(definition, through_horizon)
```

Requirements:
- repeated execution creates no duplicates;
- stable occurrence key;
- tenant-safe;
- transaction-safe;
- respects effective period;
- respects contract term when known;
- bounded by explicit end or supplied horizon;
- no scheduler required.

Phase 4 may invoke it automatically later.

---

# 13. Instance lifecycle

Do not use a single mutable status field as the only historical record.

Concepts may include:

```text
NOT_ACTIVATED
OPEN
SATISFIED
WAIVED
CANCELLED
EXCEPTION
```

Urgency should preferably be derived:

```text
UPCOMING
DUE
OVERDUE
UNKNOWN
```

Examples:

```text
OPEN + due_at < asOf → OVERDUE
OPEN + due_at unknown → UNKNOWN
```

Do not mark satisfied because the due date passed.
Do not treat missing evidence as waived.
Do not equate not activated with not applicable.

Material transitions must be auditable.
If a current-state cache exists, update it transactionally with append-only history.

---

# 14. Dependencies

Support contractual obligation dependencies.

Example:

```text
Client acceptance
depends on
Submission of measurement report
```

Requirements:
- same-tenant integrity;
- no self-dependency;
- cycle rejection;
- definition-level dependencies;
- explicit instance-level dependency when recurrence makes mapping ambiguous;
- do not guess recurring-series alignment.

If recurring mapping is non-deterministic:
- require explicit mapping or supported same-occurrence key;
- otherwise return UNKNOWN/unresolved.

Do not build a generic project-task dependency engine.

---

# 15. Evidence requirements vs evidence

Separate:

```text
evidence requirement
```

from:

```text
evidence actually provided
```

Evidence requirement may specify:
- evidence/document type;
- requirement text;
- provenance;
- required count if explicit;
- whether evidence is mandatory;
- whether formal verification/acceptance is contractually required.

Evidence may reference canonical Contracts documents or explicit evidence references already supported.

Do not duplicate Projects/Operations field evidence.

## Presence is not approval

Evidence existence does not automatically mean:

```text
accepted
approved
valid
compliant
```

If formal acceptance is required, represent the distinction without building Phase 5.

---

# 16. Satisfaction

An obligation is satisfied only when defined satisfaction conditions are met.

Possible deterministic bases:
- explicit authorized completion;
- required evidence present when presence is sufficient;
- explicit contractual fact with provenance;
- future integrated event in later phases.

Do not auto-satisfy from ambiguous evidence.

If satisfaction cannot be determined:

```text
satisfaction = UNKNOWN
```

Record actor/time for human completion.

Formal approval required by contract must not be replaced by a boolean.

---

# 17. Waiver and exception

Waiver/exception are separate historical objects, not mutations of the original obligation.

Support:
- waiver vs exception;
- reason;
- scope;
- effective period;
- provenance;
- authority reference;
- recorded by/at;
- relation to definition and/or instance.

The original obligation remains historical truth.

Do not create a Phase 5 approval workflow.

If a waiver requires approval and no approved decision exists, do not treat it as effective.

---

# 18. Escalation

Phase 3 owns escalation rules and deterministic escalation state, not notification infrastructure.

Support concepts such as:
- N days before due;
- on due date;
- N days overdue;
- severity;
- target responsibility/role.

The read model may determine that escalation is applicable.

Do not implement:
- `domain_events`;
- `apex_jobs`;
- scheduler;
- notification workers.

No cron is required for Phase 3 completeness.

---

# 19. Contractual financial impact

Phase 3 may structure explicit contractual consequences of non-compliance:
- penalty;
- withholding;
- billing block;
- liquidated damages;
- service credit;
- other explicit consequence.

Where evidenced support:
- impact type;
- fixed amount;
- percentage;
- currency;
- basis text/reference;
- provenance;
- rule vs recorded occurrence impact.

Do not post ledger entries.
Do not create AR/AP.
Potential contractual impact is not realized accounting.

Finance remains authoritative.

---

# 20. `blocks_billing` semantics

`blocks_billing` means:

```text
this contractual obligation is a prerequisite for billing
```

It does not give Phase 3 ownership of billing execution.

Expose deterministic result conceptually:

```text
TRUE
FALSE
UNKNOWN
```

Rules:
- non-blocking definition → false for this obligation;
- applicable unresolved blocking instance → true;
- satisfied instance → no blocker from that instance;
- valid effective waiver → no blocker unless waiver semantics state otherwise;
- applicability cannot be determined → UNKNOWN;
- missing definition/provenance never silently becomes false.

Do not write Finance.
Do not create invoice release records.
Do not implement Phase 7.

---

# 21. Canonical read model

Provide one canonical obligation resolver, conceptually:

```text
resolveContractObligationsAsOf(contractId, asOf)
```

Return as appropriate:
- effective definitions;
- applicable instances;
- responsible parties;
- activation state;
- due date/confidence;
- occurrence identity;
- dependency state;
- evidence completeness;
- satisfaction state;
- waiver/exception;
- escalation;
- financial impact;
- billing-block state;
- provenance.

Reuse Phase 2 temporal and Trusted/Official primitives.
Do not invent a competing truth-state abstraction.

Missing stays missing.

---

# 22. Provenance

Every contractual definition must explain:

```text
why does Apex believe this obligation exists?
```

Reuse Phase 2 provenance patterns:
- source clause;
- source amendment;
- source document;
- page;
- source reference/excerpt.

Do not require every field if one authoritative path is enough.
Do not invent clause/page numbers.

Operational instance actions also require actor/time provenance.

---

# 23. Tenant isolation

Every new tenant-owned table must be organization-scoped.

RLS is mandatory but not sufficient.

Use same-org structural FKs where tenant-owned records reference:
- contracts;
- clauses;
- amendments;
- documents;
- Parties;
- obligation definitions;
- obligation instances;
- evidence;
- dependencies;
- exceptions;
- escalation rules.

Required:
- no cross-tenant dependency;
- no cross-tenant evidence link;
- no cross-tenant Party link;
- no cross-tenant predecessor;
- no SECURITY DEFINER tenant oracle;
- no application-writable org reassignment;
- no unrestricted boundary policy.

Review every SECURITY DEFINER helper for caller-tenant leakage.

---

# 24. Mutation model

Distinguish:

```text
historical rewrite
≠ legitimate operational transition
≠ privileged erasure
```

Definitions:
- append-only historical truth.

Instances:
- controlled state transitions.

History:
- append-only.

Privileged tenant erasure:
- must remain possible through the already approved privileged boundary.

Do not let owner identity substitute for caller identity in authorization decisions.

---

# 25. Authorization

Reuse existing Contracts permissions where suitable.

At minimum distinguish:
- read obligations;
- create/edit structured definitions where authorized;
- record instance progress/evidence;
- record waiver/exception where authorized;
- privileged erasure.

Do not invent a parallel permission framework.
Do not implement module-specific approvals.

---

# 26. UI boundary

Contracts navigation remains unchanged:

```text
Visão Geral
Contratos
Renovações
Obrigações
Faturamentos
Aprovações
Riscos & Cláusulas
Documentos
```

Dossier remains:

```text
Visão geral
Financeiro
Obrigações
Documentos
Riscos & Cláusulas
Aprovações
```

Do not redesign navigation.

## `Obrigações` workspace

Evolve the existing workspace to consume the canonical Phase 3 read model.

Prioritize:
- what needs attention;
- due/overdue/unknown;
- responsible side;
- contract;
- next due date;
- evidence state;
- billing-block indicator;
- provenance/context on drill-down.

Keep it visual and operationally simple.
Avoid generic AI cards.
Do not expose database concepts.
Do not fabricate counts or demo obligations.

## Contract dossier

Expose real obligation information through the existing `Obrigações` section.
Do not add new dossier navigation.

---

# 27. AI boundary

AI remains transversal, not a lifecycle stage.

Do not create an "AI obligation analysis" workspace.

If existing clause extraction can safely propose obligation definitions with provenance and this is a small reuse, it may be adapted.

Otherwise defer automatic extraction.

AI proposals must never become official obligations merely because a model inferred them.

Safe progression:

```text
document/clause
→ extracted proposal
→ explicit provenance
→ governed structured obligation
```

Do not turn Phase 3 into a new LLM extraction project.

---

# 28. Explicit Phase 4+ exclusions

Do not implement:

## Phase 4
- `domain_events`
- transactional outbox
- `apex_jobs`
- `SKIP LOCKED`
- lock reaper
- scheduler
- queued obligation automation
- queued clause extraction

## Phase 5
- shared Approval Engine tables/RPC
- approval policies/requests/steps/decisions/delegations

## Phase 6
- `project_measurements`
- field execution evidence integration
- schedule-driven execution state
- measurement acceptance
- operational readiness

## Phase 7
- invoices
- AR
- settlements
- reconciliation
- retention/glosa workflow
- billing release execution

## Phase 8
- full risk graph/exposure engine

## Phase 9
- Control Tower

## Phase 10
- autonomous policy execution

Do not opportunistically clean unrelated modules.

---

# 29. Migration strategy

Do not edit applied migrations.

After registry reconciliation:
1. inspect current migration tip;
2. allocate new Phase 3 numbers without collision;
3. keep migrations reviewable by concern;
4. use preflight + dry-run + assertions;
5. ensure successful apply records canonical migration history.

Possible concern split, not mandatory:
- definitions / parties / provenance / lineage;
- instances / recurrence / due / dependencies;
- evidence / waiver / escalation / billing block;
- compatibility/hardening found by live proof.

Do not create empty migrations just to match this grouping.

---

# 30. Production apply gate

Before applying prove:
- registry reconciled;
- baseline still matches;
- no ambiguous legacy migration;
- no historical rewrite;
- no invented dates;
- no unsafe tenant FK path;
- RLS reviewed;
- SECURITY DEFINER reviewed;
- recurrence idempotent in dry-run;
- dependency cycles rejected;
- business-day uncertainty safe;
- privileged erasure still possible;
- unrelated Phase 0–2 data fingerprints/counts stable.

Only then state:

```text
SAFE TO APPLY PHASE 3 MIGRATIONS: YES
```

Otherwise STOP.

---

# 31. STOP conditions

STOP if:
- migrations 089–111 cannot be proven;
- registry repair requires speculative writes;
- legacy obligation semantics are ambiguous and destructive migration is needed;
- an effective date would need invention;
- Party identity would require fuzzy matching;
- contractual responsibility cannot be separated from internal assignment;
- recurrence cannot be deterministic;
- recurring dependencies cannot be deterministic;
- business-day calculation lacks authoritative calendar;
- evidence presence would be treated as approval;
- waiver would become effective without authority/provenance;
- `blocks_billing` requires Phase 7;
- activation requires Phase 4 Event Graph;
- formal acceptance requires Phase 5;
- operational measurement requires Phase 6;
- a new table duplicates an authoritative source;
- tenant ownership is unclear;
- SECURITY DEFINER leaks cross-tenant information;
- migration numbering collides;
- production differs materially from baseline.

Report exact blocker and evidence.

---

# 32. Required database/security tests

Tenant:
- Org A cannot read Org B definitions/instances.
- Org A cannot reference Org B contract/Party.
- Cross-tenant dependencies/evidence/predecessors rejected.
- SECURITY DEFINER helpers leak nothing across tenant.

History:
- predecessor lineage preserved;
- historical definition cannot be rewritten;
- removal preserves history;
- unknown effective date remains unknown;
- amendment does not mutate predecessor;
- privileged erasure still reaches Phase 3 subtree.

Instances:
- repeated materialization creates no duplicate;
- occurrence key stable;
- recurrence respects bounds;
- unknown anchor creates no fabricated due date;
- transition + history atomic;
- invalid transition rejected.

Dependencies:
- self-dependency rejected;
- cycles rejected;
- cross-tenant dependency rejected;
- unresolved recurring mapping returns UNKNOWN.

Evidence/exceptions:
- requirement and provided evidence separate;
- missing evidence not approved;
- waiver preserves original obligation;
- expired waiver stops suppressing blocker;
- unauthorized mutation rejected.

Billing block:
- unresolved applicable blocker → true;
- satisfied blocker stops blocking;
- effective waiver deterministic;
- unknown applicability → UNKNOWN, never false.

---

# 33. Required resolver tests

Cover at minimum:
- before effective date;
- on effective date;
- after alteration;
- after removal;
- unknown effective date;
- one-time;
- recurring;
- before activation;
- after activation;
- before due;
- on due;
- overdue;
- satisfied;
- waived;
- expired waiver;
- dependency unresolved;
- dependency satisfied;
- evidence missing;
- evidence present;
- evidence requiring formal acceptance;
- billing blocker true/false/unknown.

---

# 34. Regression suite

Run:
- Phase 0 security regression;
- Phase 1 Party/tenant regression;
- Phase 2 lineage/asOf regression;
- Contracts unit;
- Contracts integration;
- Contracts E2E;
- impacted Projects tests;
- impacted Finance tests;
- Fiscal only if shared code touched;
- `tsc --noEmit`;
- production build;
- changed-file lint.

Keep `.preview/` net diff zero.
Do not hide failures by narrowing the suite without justification.

---

# 35. Production data rules

Do not fabricate production obligations.

Demo contracts remain demo.
Live contracts remain live unless separately governed.
Do not auto-create obligations from free text without approved provenance.

Zero canonical production obligations after Phase 3 is acceptable.
Show a truthful empty state.

---

# 36. Preview validation

After green implementation:
- create Vercel Preview;
- verify Contracts navigation unchanged;
- open `Obrigações`;
- open a contract dossier;
- verify truthful empty state if needed;
- verify only deterministic migrated obligations;
- verify no fake metrics;
- verify historical contracts and Phase 2 data still render;
- verify no runtime errors.

If Deployment Protection blocks interactive smoke:
- do not weaken project security;
- report it;
- run equivalent authenticated local E2E;
- do not claim interactive Preview smoke passed.

---

# 37. Commit / PR boundary

At completion:
- working tree clean;
- `.preview/` net zero;
- commit only Phase 3 and required migration-history reconciliation;
- push `feat/contracts-v2-phase-3`;
- do not merge `main`.

Migration-history reconciliation may be a separate first commit on the same branch for audit clarity.

Do not mix unrelated cleanup.

---

# 38. Required final report

Return concise sections:
1. migration-registry reconciliation;
2. production preflight;
3. existing obligation model findings;
4. schema/migrations;
5. definition vs instance;
6. responsibility/Party model;
7. activation;
8. due rules;
9. recurrence/materialization;
10. dependencies;
11. evidence;
12. satisfaction;
13. waiver/exception;
14. escalation;
15. financial impact;
16. `blocks_billing`;
17. `asOf` read model;
18. tenant/security;
19. migration apply;
20. tests;
21. Preview;
22. commit SHA;
23. residual risks;
24. deferred items.

Explicitly answer:
- Were migrations 089–111 proven before reconciliation?
- Is migration history now truthful?
- Will future applies update canonical migration history?
- Were any historical obligations rewritten?
- Were any dates invented?
- Was any Party matched fuzzily?
- Were obligations fabricated from free text?
- Was evidence presence treated as approval?
- Was Approval Engine implemented?
- Was Event Graph implemented?
- Was Project Measurement/readiness implemented?
- Was Finance/AR implemented?
- Is any tenant-owned relationship structurally unsafe?
- Were `.preview/` artifacts committed?

---

# 39. Final gate block

End exactly with:

```text
MIGRATIONS 089–111 PROVEN APPLIED: YES / NO
MIGRATION REGISTRY RECONCILED: YES / NO
FUTURE MIGRATION HISTORY SAFE: YES / NO
PHASE 3 COMPLETE: YES / NO
OBLIGATION DEFINITIONS STRUCTURED: YES / NO
OBLIGATION INSTANCES STRUCTURED: YES / NO
BILATERAL / MULTILATERAL RESPONSIBILITY WORKING: YES / NO
ACTIVATION MODEL WORKING: YES / NO
DUE RULES WORKING: YES / NO
RECURRENCE IDEMPOTENT: YES / NO
DEPENDENCIES WORKING: YES / NO
EVIDENCE MODEL WORKING: YES / NO
WAIVER / EXCEPTION WORKING: YES / NO
ESCALATION MODEL WORKING: YES / NO
CONTRACTUAL FINANCIAL IMPACT STRUCTURED: YES / NO
BLOCKS_BILLING SEMANTICS WORKING: YES / NO
AS-OF OBLIGATION RESOLUTION WORKING: YES / NO
HISTORICAL TRUTH PRESERVED: YES / NO
TENANT ISOLATION PASS: YES / NO
MIGRATIONS APPLIED SAFELY: YES / NO
PHASE 4+ NOT STARTED: YES / NO
SAFE TO MERGE PHASE 3: YES / NO
```

---

# 40. Completion definition

Phase 3 is complete only when Apex can truthfully know:

```text
what is required
who is responsible
when it applies
when it is due
what it depends on
what evidence is required
whether an exception exists
what should be escalated
whether billing is contractually blocked
```

without requiring a parallel manual checklist.

Boundary:

```text
Phase 3 knows the contractual obligation.
Phase 4 reacts to platform events.
Phase 5 governs formal approvals.
Phase 6 connects project execution/measurement.
Phase 7 executes the financial chain.
```

The objective is not to automate everything in Phase 3.

The objective is to create the reliable contractual truth model that makes later automation safe.
