# Contracts V2 — Phase 2 Execution Specification

Phase: **Contract Structured Model**

Status: **APPROVED FOR EXECUTION AFTER PHASE 1 MERGE**

Lead: **Codex**

Parallelism: Lead + at most 2 focused subagents.

Do not start Phase 3+.

---

## 0. Baseline gate

Before implementation:

1. checkout `main`
2. update `main`
3. confirm working tree clean
4. confirm Phase 1 is merged into `main`
5. confirm migrations 102–107 are in repository migration history
6. confirm production is green
7. inspect current migration tip
8. create `feat/contracts-v2-phase-2` from updated `main`

If Phase 1 is not merged into `main`: **STOP**.

Do not stack Phase 2 on an unmerged Phase 1 branch.

---

## 1. Objective

Turn the contract from a mostly flat record into a structured, time-aware contractual model that later phases can operate on.

Implement only the structural foundation for:

1. guarantees
2. insurance requirements/policies
3. adjustment/indexation rules
4. structured billing conditions
5. structured measurement/billing requirements
6. temporal `asOf` semantics
7. clause lineage
8. contract lineage
9. inheritance between parent instruments, amendments and renewals
10. deterministic current-state projection without rewriting history

This phase enables later obligations, measurement readiness, billing eligibility, risks, approvals and automation, but does not implement those engines.

---

## 2. Frozen rules

- Contract is the Root Business Object.
- Historical contractual truth is immutable.
- Amendments do not overwrite original facts.
- Current state is derived.
- Missing remains missing.
- AI is transversal, not a lifecycle stage.
- Contracts owns contractual rules.
- Projects/Operations owns execution.
- Fiscal owns fiscal documents.
- Finance owns ledger/AR/settlement.

Never silently convert missing into zero, compliant, satisfied, approved, not required or verified.

---

## 3. Existing amendment model

Inspect the current real amendment/clause implementation before adding schema.

Preserve existing semantics equivalent to:
- modified
- replaced / new redaction
- removed
- added

Existing saved relationships are immutable.

Editing an amendment appends history instead of rewriting prior relationships.

Do not create a second amendment system.

Do not rename backend states for presentation.

---

## 4. Contract lineage

Represent relationships such as:

```text
original contract
→ amendment
→ amendment
→ renewal / extension
```

Required:
- root/parent instrument
- lineage type
- effective date when known
- immutable relationship
- tenant coherence
- deterministic ordering where needed
- traceable source/origin

Protect against:
- self-reference
- cross-tenant lineage
- silent ambiguous parentage

If deeper cycle prevention is safe and testable, implement it. Otherwise document the limitation rather than adding fragile recursion.

Do not encode lineage as free text.

---

## 5. Inheritance semantics

Later instruments inherit contractual facts without copying and mutating everything blindly.

Support semantics compatible with the existing domain:
- INHERITED
- OVERRIDDEN
- REPLACED
- REMOVED
- ADDED

Do not create a competing vocabulary if the existing amendment model already represents these concepts.

The system must retain:
- original fact
- amendment fact
- effective version as of date D
- reason it is effective
- source instrument

Original facts remain queryable.

---

## 6. `asOf` semantics

Implement a focused Contracts resolver capable of answering:

> What was Contract X's effective structured state on date D?

Apply where supported:
- clauses
- term
- contract value
- guarantees
- insurance requirements
- indexation rules
- billing conditions
- measurement/billing requirements

Prefer explicit, testable Contracts logic over a speculative generic temporal framework.

`asOf` must be deterministic.

Do not invent effective dates.

---

## 7. Guarantees

Create the structured contractual guarantee model justified by real contract semantics/repository evidence.

Potential concepts:
- organization
- contract
- source instrument
- source clause/document
- guarantee type
- required amount or percentage
- percentage basis
- issuer/relevant Party
- validity start/end
- renewal requirement
- evidence/document relationship if supported
- effective period
- lineage/source

Do not build an operational guarantee workflow or notification automation yet.

Do not fake guarantee status.

---

## 8. Insurance

Create structured contractual insurance requirements.

Potential concepts:
- organization
- contract
- source instrument
- insurance type
- required coverage
- currency
- insured/relevant Party
- insurer Party where explicitly known
- policy requirement
- validity requirement
- source clause/document
- effective period

Keep contractual requirement separate from actual verified policy/evidence.

If insurance is required but no policy is verified:

```text
requirement = known
compliance = unknown
```

---

## 9. Adjustment / indexation

Create structured contractual rules for:
- index/indexer
- base date
- periodicity
- anniversary rule
- formula/rule representation
- lag
- floor/cap if contractual
- source clause
- source instrument
- effective period

Invariant:

```text
rule ≠ calculated outcome
```

Do not persist fictional adjusted contract values.

Do not build the final Finance calculation engine.

---

## 10. Billing conditions

Create structured Contracts-side billing conditions answering:

> What must contractually be true before this amount/service may be billed?

Possible condition classes:
- milestone reached
- measurement accepted
- service report required
- evidence required
- technical acceptance required
- customer approval required
- specific document required
- elapsed contractual period
- contractual event

Do not invent conditions not present in the contract.

Every condition must retain provenance.

Do not implement full operational readiness yet.

---

## 11. Measurement / billing requirements

Apex does **not** generate the technical/service measurement report.

Phase 2 structures only **what the contract requires**.

Support when evidence exists:
- report required?
- measurement report type
- required document type
- technical report requirement
- tests/inspection requirement
- evidence requirement
- customer acceptance requirement
- responsible contractual Party where meaningful
- source clause
- source document
- annex
- page/reference
- applicability
- effective period
- relation to contractual milestone/billing condition

Do not implement READY/BLOCKED/INCOMPLETE operational state machines yet.

---

## 12. Provenance

Every structured contractual fact must remain traceable.

Where applicable retain:
- organization_id
- contract_id
- source instrument
- source clause
- source document
- page/reference
- effective date/period
- lineage
- creation provenance

Do not fabricate clause, page or annex.

Unknown remains null/missing.

---

## 13. Clause lineage

The system must explain:

```text
original clause
→ changed by Amendment X
→ replaced by Amendment Y
→ current effective version
```

Preserve existing clause relationships.

Do not flatten history into one mutable current clause.

Provide a read model/resolver returning:
- historical versions
- effective current version
- lineage reason
- source instrument
- effective date

Use existing vocabulary.

---

## 14. Current contract projection

Create one authoritative way to derive effective structured contract state.

Target concept:

```text
resolveContractAsOf(contractId, date)
```

or the closest architecture-aligned equivalent.

Where supported, derive:
- effective term
- effective value
- effective clause set
- guarantees
- insurance requirements
- indexation rules
- billing conditions
- measurement/billing requirements

Prefer history + deterministic projection over mutable current-state duplicates.

---

## 15. Party integration

Use canonical Party from Phase 1.

Do not reintroduce free-text identity where canonical Party exists.

Preserve historical/fallback text semantics.

Global `party_roles` remains master data only.

Do not add contract-relative roles to global `party_roles`.

If Phase 2 needs contract-specific Party relationships, model them inside Contracts.

All tenant-owned Party references require same-org structural integrity where appropriate.

---

## 16. Contract value and term

Inspect current value/term and amendment behavior.

Do not create a rival source of truth.

The final model must support:
- effective value asOf D
- effective term asOf D

without rewriting original records.

---

## 17. Schema principles

Every new table:
- organization-scoped
- RLS-enabled
- tenant-coherent
- correctly indexed
- deterministic CHECK constraints
- no `USING(true)`
- same-org structural FKs where needed
- provenance-aware where appropriate

Do not rely on RLS alone for tenant-owned relationships when the database can structurally reject invalid cross-org states.

---

## 18. Migration strategy

Inspect current migration tip.

Do not assume next number.

Do not rewrite already-applied migrations.

Prefer small coherent migrations.

Suggested grouping:
1. lineage / temporal foundation
2. guarantees + insurance
3. adjustment/indexation
4. billing + measurement requirement definitions
5. RLS/permissions/read-model support

Adjust only based on actual coupling.

---

## 19. Production preflight

Before apply, query production read-only.

Report at minimum:
- contract count
- data_class distribution
- live/demo/unclassified distribution if separate
- amendment count
- clause count
- clause relationship count
- contracts with amendments
- contracts with term/value amendments
- existing lineage-like structures
- relevant provenance fields
- null organization ownership
- orphan contract references
- duplicate/ambiguous amendment relationships
- current migration tip
- Phase 1 schema presence

Demo/mock contracts remain demo/mock.

No automatic reclassification.

---

## 20. STOP conditions

STOP instead of guessing if:
- current amendment semantics conflict with the frozen model
- existing records cannot be deterministically mapped
- lineage contains ambiguous parentage
- implementation would rewrite historical clauses
- implementation requires invented effective dates
- organization ownership is unclear
- proposed schema duplicates an existing authoritative model
- production differs materially from expected Phase 1 baseline
- migration numbering collides
- a tenant-owned relationship cannot be made structurally coherent
- migration would fabricate business facts

Report the discrepancy and stop.

---

## 21. Migration apply gate

Code and SQL may be written before apply.

Do **not** apply Phase 2 migrations until the Lead confirms:
- production preflight complete
- migration list/order reviewed
- no unresolved ambiguity
- no historical rewrite
- tenant FK coherence checked
- RLS/policy diff reviewed
- stop conditions clear
- dry run passes
- post-migration assertions defined

Lead must explicitly state:

```text
SAFE TO APPLY PHASE 2 MIGRATIONS: YES
```

If NO: STOP.

If YES: apply using the established safe migration workflow.

---

## 22. UI boundary

The Contracts UI Architecture Gate is closed.

Do not redesign:
- Contracts sidebar
- portfolio workspaces
- dossier top navigation
- light/dark hierarchy
- global visual tokens

Only expose real Phase 2 structured data where necessary.

Prefer contextual dossier presentation.

Do not add new global sidebar items.

Do not create generic AI cards.

Do not create fake operational status.

Do not create a major `Medições & Requisitos` workspace merely because schema exists.

---

## 23. Explicitly excluded — Phase 3+

Do not implement:

### Phase 3
- obligations engine
- recurrence instances
- dependency engine
- evidence completion workflow
- waiver/exception/escalation
- operational blocks_billing

### Phase 4
- domain_events
- transactional outbox
- apex_jobs
- scheduler
- queued execution framework

### Phase 5
- shared Apex Approval Engine

### Phase 6
- project_measurements
- operational measurement instances
- schedule/execution integration
- readiness computation

### Phase 7
- AR
- settlements
- reconciliation
- full billing-to-finance chain

### Phase 8
- risk operationalization

### Phase 9
- Control Tower

### Phase 10
- autonomy engine

---

## 24. Tests

### Database / security
- tenant isolation
- same-org composite FK coherence
- lineage constraints
- no cross-org lineage
- no self-lineage
- immutable amendment history
- guarantee constraints
- insurance constraints
- indexation constraints
- billing-condition provenance
- measurement-requirement provenance
- RLS on every new table
- no unrestricted boundary policies

### Temporal
- asOf before amendment
- asOf on effective amendment
- asOf after multiple amendments
- removed clause disappears only from effective projection
- historical removed clause remains queryable
- replaced clause resolves correctly
- added clause appears only when effective
- unknown effective date is not invented

### Contracts regression
- existing contract renders
- contract without amendments
- contract with one amendment
- contract with multiple amendments
- historical text counterparty
- canonical Party counterparty
- Phase 0 status/approval behavior
- Phase 1 Party/RLS behavior
- PDF/export where affected

### Cross-domain
Run impacted:
- Projects tests
- Finance tests
- Fiscal tests only if shared Fiscal code is touched

### General
- `tsc --noEmit`
- production build
- changed-file lint
- unit tests
- Contracts integration
- Contracts E2E

Do not commit incidental `.preview/` changes.

---

## 25. Agent strategy

Codex is the Lead.

Use at most two focused subagents only where parallelism materially saves time.

### Agent A — Schema / migrations / RLS / temporal model
Scope:
- lineage schema
- guarantee/insurance/indexation schema
- billing/measurement requirements schema
- RLS
- same-org FK structure
- migration assertions

### Agent B — Resolver / compatibility / tests
Scope:
- `asOf` resolver
- clause lineage read model
- current projection
- existing Contracts compatibility
- focused tests

### Lead
Owns:
- repository preflight
- architecture decisions
- migration numbering
- integration
- production preflight
- migration apply
- final regression
- Preview
- merge readiness

Subagents must not re-audit the full repository.

---

## 26. Preview / smoke

After migrations and tests are green:
- create Vercel Preview
- smoke Contracts navigation
- open a historical contract
- verify unchanged historical display
- verify real structured Phase 2 data only if it exists without fabricated production facts
- verify no portfolio/dossier navigation regression

Do not merge `main` automatically.

---

## 27. Final report

Return concise:
1. current-state findings
2. final schema
3. migrations created
4. contract lineage model
5. inheritance semantics
6. asOf behavior
7. guarantee model
8. insurance model
9. adjustment/indexation model
10. billing-condition model
11. measurement/billing requirement model
12. clause lineage behavior
13. production preflight
14. migration apply result
15. RLS/FK result
16. tests
17. Preview URL
18. commit SHA
19. residual risks
20. deferred items

Explicitly answer:
- Were any historical clauses rewritten?
- Were any existing contracts reclassified?
- Were any effective dates invented?
- Was any demo/mock data promoted to official?
- Was operational measurement/readiness implemented?
- Was any Phase 3+ capability introduced?
- Were any tenant-owned relationships left protected only by RLS where structural coherence was required?
- Were any `.preview/` artifacts committed?

End exactly with:

```text
PHASE 2 COMPLETE: YES / NO
CONTRACT LINEAGE STRUCTURED: YES / NO
CLAUSE LINEAGE PRESERVED: YES / NO
AS-OF RESOLUTION WORKING: YES / NO
GUARANTEES STRUCTURED: YES / NO
INSURANCE STRUCTURED: YES / NO
INDEXATION STRUCTURED: YES / NO
BILLING CONDITIONS STRUCTURED: YES / NO
MEASUREMENT REQUIREMENTS STRUCTURED: YES / NO
HISTORICAL CONTRACT TRUTH PRESERVED: YES / NO
TENANT ISOLATION PASS: YES / NO
MIGRATIONS APPLIED SAFELY: YES / NO
PHASE 3+ NOT STARTED: YES / NO
SAFE TO MERGE PHASE 2: YES / NO
READY FOR PHASE 3 AFTER MERGE: YES / NO
```
