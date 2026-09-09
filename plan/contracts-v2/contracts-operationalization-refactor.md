# Insight Apex — Contracts Operationalization Refactor

## Purpose

Refactor the Insight Apex Contracts experience to match the new product direction:

**Insight Apex is not a contract authoring tool.**

Contracts are normally authored and sent by the client / contracting party.

Apex receives the original contract, understands what it requires, converts those requirements into operational intelligence, monitors what must happen, follows responsible people, verifies outcomes, and escalates only the exceptions that require human authority or judgment.

Target mental model:

```text
CLIENT CONTRACT
→ APEX UNDERSTANDS
→ APEX STRUCTURES
→ APEX OPERATIONALIZES
→ APEX MONITORS
→ APEX FOLLOWS UP
→ APEX VERIFIES
→ APEX ESCALATES EXCEPTIONS
→ HUMAN DECIDES ONLY WHEN NECESSARY
```

Before changing code:

1. Read the current Contracts V2 architecture/specifications.
2. Audit the current Contracts sidebar, dossier navigation, AI clause extraction, obligations, measurement, billing, approvals, documents, risk flows and existing domain ownership.
3. Preserve all frozen security, tenant, provenance, Event Graph, Approval Engine, Contract→Project→Measurement and Contract→Billing→Fiscal→Finance boundaries.
4. Do not create duplicate engines where Apex already has canonical infrastructure.
5. Do not start unrelated Phase 9/10 Autonomous Work implementation.

The previously analyzed test contract will be deleted by the user. Do not design around that contract. The next newly uploaded real contract must enter through this new architecture.

---

## 1. Product Principle

The original signed PDF is documentary / contractual source truth.

AI does **not** create contractual truth.

Apex creates:
- structured interpretation
- operational rules
- dependencies
- obligations
- risks
- requirements
- monitoring signals
- recommendations

Every AI-derived interpretation must retain:
- `organization_id`
- source document
- source page
- literal source excerpt
- confidence
- provider
- model
- `analyzed_at`
- pipeline/version provenance

Core invariants:
- Truth is deterministic where possible.
- Intelligence may be probabilistic.
- Authority is governed.
- Actions are auditable.
- AI must never impersonate human authority.

---

## 2. Keep the Global Contracts Sidebar — Exactly 8 Items

Preserve the existing global Contracts navigation:

1. Visão Geral
2. Contratos
3. Renovações
4. Obrigações
5. Faturamentos
6. Aprovações
7. Riscos & Cláusulas
8. Documentos

These are **portfolio / company-wide workspaces**.

Purpose:
- Visão Geral → portfolio Contract Control Tower
- Contratos → inventory + onboarding
- Renovações → expirations / renewals / notices / extensions
- Obrigações → obligations across all contracts
- Faturamentos → contractual billing readiness across the portfolio
- Aprovações → only items requiring governed human authority
- Riscos & Cláusulas → cross-contract intelligence / exposure
- Documentos → contract-related documents across the portfolio

Do not add more global sidebar items.

---

## 3. Remove Global / Local Navigation Redundancy

The contract dossier must **not** repeat the same menu names as the global sidebar.

Replace the current dossier navigation:
- Visão geral
- Financeiro
- Obrigações
- Documentos
- Riscos & Cláusulas
- Aprovações

with:

1. Resumo
2. Operação
3. Medição & Faturamento
4. Inteligência Contratual
5. Documentos
6. Governança

Conceptual distinction:

```text
GLOBAL SIDEBAR
→ Where is contractual work happening across the company?

CONTRACT DOSSIER
→ What is happening inside this specific contract?
```

When a dossier is open, reduce the visual prominence of the expanded Contracts sidebar submenu so the local dossier navigation becomes the dominant context.

Do not remove the global sidebar.

---

## 4. Contract Dossier — Resumo

The contract summary must become an outcome-oriented cockpit.

Show only truthful information.

Recommended hierarchy:
- Contract name / number
- Counterparty
- Lifecycle
- Data class
- Value
- Term
- linked project
- execution
- next measurement
- potential billable amount
- billing readiness
- material risks
- obligations currently active
- Apex follow-ups
- items requiring human attention

Primary question:

> **WHAT IS PREVENTING THE NEXT BUSINESS OUTCOME?**

Do not show synthetic or demo KPIs.

`UNKNOWN` remains `UNKNOWN`.

---

## 5. Contract Onboarding

The main action in Contracts should conceptually be:

**Adicionar contrato**

not:

**Cadastrar contrato manualmente**

Preferred flow:

```text
Original PDF upload
→ contract born UNCLASSIFIED
→ Apex analyzes document
→ Apex structures the contract
→ Apex identifies operational rules
→ Apex identifies risks / dependencies
→ Apex begins monitoring permitted items
→ human attention only where policy requires it
```

Do not automatically classify as `LIVE`.

Do not convert demo contracts into production contracts.

Do not invent missing information.

---

## 6. Contract Analysis Output

Apex should automatically identify and structure at minimum:

- parties and party roles
- contract value / currency
- effective dates
- expiration / term
- Insight obligations
- contracting-party obligations
- third-party obligations
- measurement rules
- billing conditions
- guarantees
- insurance requirements
- indexation / reajuste rules
- penalties
- required documents
- recurring documents
- approvals
- renewal / extension conditions
- operational dependencies
- material contractual risks
- contractual notices
- evidence requirements

The product should be capable of summarizing a contract conceptually like:

```text
195 pages analyzed

43 obligations
→ 32 Insight
→ 11 contracting party

7 billing conditions
4 guarantees
3 insurance requirements
2 indexation rules
8 material risks
6 recurring documents
5 approval events
```

Do **not** fabricate counts. These numbers must derive from persisted structured data.

---

## 7. Remove the "AI Proposed Clause" Mental Model

Remove or rename concepts such as:
- Cláusulas propostas
- Proposta pela IA
- Proposta pela leitura
- Proposta não vale como cláusula até ser validada
- mandatory Validate / Reject interaction for every AI interpretation

The contract clause already exists. Apex did not propose it.

Use language such as:
- Inteligência Contratual
- Regra contratual identificada
- Interpretação estruturada
- Interpretação do Apex
- Fonte contratual
- Impacto operacional
- Evidência documental
- Requer atenção
- Leitura contratual

Replace:
> "Proposta não vale como cláusula até ser validada."

with something conceptually equivalent to:
> "Esta é uma interpretação estruturada do Apex baseada no documento original."

If policy requires human attention:
> "Esta interpretação requer análise humana antes de produzir uma decisão governada."

Do not imply Apex authored the contract.

---

## 8. Human Governance by Exception

Do **not** require humans to validate every extracted contractual item.

Apex should automatically structure well-evidenced interpretations where policy permits.

Human attention is required when one or more conditions apply:
- low confidence
- legal ambiguity
- conflicting clauses
- amendment precedence conflict
- unclear party responsibility
- material financial exposure
- material contractual risk
- possible legal commitment
- possible contractual amendment
- exceptional billing treatment
- risk acceptance
- authority required
- human-only policy
- `NEVER_AUTOMATED` action

Target UX:

```text
2 items require your attention
```

not:

```text
47 AI proposals waiting for validation
```

Humans should decide what to **do** with material issues, not manually certify that the AI read every sentence.

---

## 9. Absolute Authority Boundaries

Never allow AI / service role / script to fabricate:
- human review
- `reviewed_by`
- human approval
- legal acceptance
- contractual acceptance
- financial authority
- payment approval
- measurement acceptance

Measurement acceptance remains:

```text
NEVER_AUTOMATED
```

Preserve the database impersonation guard already introduced for clause review.

If additional authority surfaces are discovered during this refactor, fail closed.

---

## 10. Contract = What / Project = When

Preserve this domain ownership:

```text
CONTRACT
= WHAT must happen

PROJECT / SCHEDULE
= WHEN operational events happen

EXECUTION
= whether the work happened

APEX
= what is missing / blocked / exposed

BILLING
= whether contractual invoicing is allowed

FISCAL
= invoice issuance

FINANCE
= AR / payment / reconciliation / settlement
```

Contracts owns rules.

Projects owns operational schedule and measurement instances.

Contracts must not invent project dates.

Contracts must not own measurement instances.

Contracts must not write Finance or Fiscal truth.

---

## 11. Temporal / Operational Rule Classification

Every relevant contract rule should support classification into at least:

### A. Absolute Date
Example: "Guarantee must be submitted by 15/10/2026."

Apex may immediately create/materialize the obligation.

### B. Relative to Future Event
Example: "Documents must be submitted 5 business days before measurement."

Persist conceptually:

```text
anchor = MEASUREMENT
offset = -5 business days
date_state = AWAITING_SCHEDULE_ANCHOR
```

Do not create a fake date.

When Projects later schedules a measurement, Apex calculates the real operational deadline.

### C. Condition-Based
Example: "Billing may occur only after contracting-party acceptance."

Persist the contractual billing condition.

When measurement exists and acceptance is missing:

```text
billing_readiness = BLOCKED
```

### D. Recurring
Example: "Submit certificate monthly."

Persist recurrence.

Materialize instances only when enough temporal/project context exists.

`UNKNOWN` remains `UNKNOWN`.

---

## 12. Operação Tab

The dossier tab `Operação` should show the operational consequences of the contract:

- obligations
- requirements
- responsible party
- deadlines
- recurrence
- guarantees
- insurance
- evidence requirements
- follow-ups
- upcoming contractual work

Group responsibilities clearly:
- INSIGHT MUST DO
- CONTRACTING PARTY MUST DO
- THIRD PARTIES MUST DO

Each item should retain contractual provenance.

---

## 13. Medição & Faturamento Tab

Replace the generic local `Financeiro` tab with:

**Medição & Faturamento**

This dossier view should answer:

> **CAN THIS CONTRACTUAL EVENT BE INVOICED?**

Preserve the frozen chain:

```text
execution
→ measurement
→ acceptance
→ billing entitlement
→ release
→ invoice
→ AR
→ due
→ payment
→ reconciliation
→ settlement
```

Contracts owns only the contractual/readiness side.

Do not fake:
- received amount
- payment
- reconciliation
- finance status

unless canonical Finance data exists.

---

## 14. Inteligência Contratual Tab

The local dossier tab should be called:

**Inteligência Contratual**

This is broader than `Riscos & Cláusulas`.

It should show:
- contractual structure
- relevant source clauses
- interpretations
- obligations discovered
- billing conditions
- guarantees
- insurance
- indexation
- document requirements
- approvals
- ambiguities
- conflicts
- risks
- operational effects
- items requiring human attention

Each interpretation card should visually separate:

1. Source Contract
2. Apex Interpretation
3. Operational Impact
4. Attention / Governance, only when required

Do not use generic AI-looking cards.

---

## 15. Risks UX

Risk intelligence should look like operational exposure, not contract drafting.

A risk item should communicate:
- contractual basis
- observed issue
- potential impact
- current exposure only when canonical amount exists
- Apex recommendation
- available governed actions

Possible actions:
- View source clause
- Assign responsible person
- Create follow-up
- Request legal review
- Create commercial action
- Accept risk

Apex may recommend an amendment.

Apex must never alter signed contractual truth automatically.

---

## 16. Apex Follow-up — Foundation

Introduce/reuse a transversal governed follow-up capability.

Do **not** build the full Phase 10 autonomous planner.

This is only the foundation required for Contracts operational follow-up.

The model should support conceptually:
- source entity
- goal
- responsible person
- due date
- expected evidence
- state
- next expected event
- follow-up cadence
- escalation policy
- verification rule
- audit history

Suggested states:

```text
ACTIVE
WAITING_EXTERNAL_PARTY
BLOCKED
COMPLETED
ESCALATED
CANCELLED
```

When a human assigns responsibility to a material issue:

```text
Apex identifies issue
→ human assigns responsible person
→ Apex owns operational follow-up
→ Apex monitors state/timeline
→ Apex reminds intelligently
→ Apex waits if external response is expected
→ Apex escalates when necessary
→ Apex verifies evidence/outcome
→ Apex closes when verified
```

Do not reduce this to a checkbox task.

---

## 17. Schedule-Anchored Follow-up

If the contract says documents are required 5 business days before measurement:

At contract ingestion:

```text
rule known
date unknown
anchor = MEASUREMENT
```

Later Projects schedules:

```text
measurement = 30/09
```

Apex then:

```text
→ calculates deadline
→ materializes requirement
→ activates follow-up
→ monitors evidence
→ recalculates billing readiness
```

The user must not manually recreate a contractual obligation Apex already understands.

---

## 18. Intelligent Follow-up — No Spam

Follow-up should be state-aware.

Example:

Responsible person reports:

> "Customer is reviewing the amendment. Expected answer 15/09."

Apex should persist conceptually:

```text
state = WAITING_EXTERNAL_PARTY
next_expected_event = 15/09
```

Do not remind every day.

On/after 15/09:

```text
→ verify whether expected event occurred
→ request update only if still unresolved
→ escalate according to policy if necessary
```

---

## 19. Verification > Manual "Done"

Where possible, verify outcomes instead of trusting manual completion.

Example:

Goal:

```text
renew CND
```

Preferred model:

```text
document uploaded
→ Apex reads document
→ confirms correct company/CNPJ
→ confirms validity
→ confirms required date coverage
→ requirement becomes satisfied
→ billing readiness recalculated
→ follow-up closes automatically
```

Use deterministic verification whenever possible.

When deterministic verification is impossible:
→ require human confirmation according to policy.

Do not implement general autonomous verification outside the bounded Contracts follow-up scope.

---

## 20. Global Visão Geral — Contract Control Tower

The global Visão Geral should move away from a generic dashboard.

It should answer:
- What is happening in the contract portfolio?
- What requires attention?
- What value is blocked?
- What is Apex already following?

Possible truthful areas:

### Portfolio
- active contracts
- contracted value
- potentially billable amount

### Apex is monitoring
- active obligations
- billing conditions
- renewals
- risks
- follow-ups

### Requires attention
- material risk
- authority decision
- overdue obligation
- billing blocker
- renewal decision

### Resolved / progressed by Apex
- evidence received
- obligation satisfied
- guarantee renewed
- schedule anchor materialized
- blocker removed

Do not fabricate counters or "resolved by Apex" claims.

---

## 21. Global Contratos

The global Contracts table should become operationally informative.

Recommended concepts:
- Contract
- Counterparty
- Value
- Term
- Linked project
- Health
- Billing readiness
- Attention items
- Apex monitoring state

The table should help answer:
- Which contracts are healthy?
- Which require intervention?
- Which have blocked revenue?
- Which have no operational linkage?
- Which is Apex actively following?

---

## 22. Global Renovações

Apex should monitor:
- contract expiration
- automatic renewal
- notice periods
- extensions
- reajustes
- guarantees
- insurance expirations
- renewal-related documents

Human actions:
- Renew
- Do not renew
- Start negotiation
- Assign responsible

Apex follows the selected path.

---

## 23. Global Obrigações

This workspace should aggregate operational obligations across the portfolio.

Provide useful segmentation:
- Insight
- Contracting parties
- Third parties

States may include:

```text
upcoming
due
overdue
waiting for schedule anchor
waiting external party
blocked
satisfied
waived
not applicable
```

Never transform `UNKNOWN` into satisfied.

---

## 24. Global Faturamentos

This is contractual billing readiness across all contracts.

Primary questions:
- What can be invoiced?
- What cannot?
- Why?
- How much is exposed?
- Who/what is blocking it?

Do not turn this into Finance.

Contracts must not become ledger.

---

## 25. Global Aprovações

Approvals should increasingly represent only:

> **WHAT APEX DOES NOT HAVE AUTHORITY TO DECIDE.**

Examples:
- risk acceptance
- contractual exception
- extraordinary billing release
- amendment decision
- governed business authority

Avoid routing simple operational work into approvals if policy allows Apex to monitor/execute it.

Preserve the canonical Apex Approval Engine.

---

## 26. Global Riscos & Cláusulas

Keep the global sidebar name:

**Riscos & Cláusulas**

But make it the cross-contract Contract Intelligence workspace.

It may aggregate:
- material exposures
- recurring problematic clauses
- ambiguous acceptance terms
- penalty patterns
- guarantees
- insurance
- indexation
- counterparty obligations
- amendment conflicts
- high-impact billing dependencies

Do not present this as AI contract drafting.

---

## 27. Documents

Documents must be operationally meaningful, not just files.

Example categories:
- original contract
- amendments
- guarantees
- insurance
- certificates
- measurement reports
- acceptance evidence
- communications
- other contractual evidence

A document should know, when possible:
- which contract
- which obligation
- which measurement
- which requirement
- validity period
- which evidence requirement it satisfies

The original file remains accessible.

---

## 28. Governança Tab

The local contract `Governança` tab should consolidate:
- approvals
- authorities
- exceptions
- contract classification
- governed decisions
- human risk acceptance
- amendment decisions
- relevant audit context

Do not duplicate the existing header `Histórico` action.

---

## 29. Remove Manual-Operation Language

Prefer:
- Apex identified
- Apex is monitoring
- Waiting for schedule
- Waiting for contracting party
- Requires your decision
- Follow-up active
- Evidence received
- Requirement satisfied
- Billing blocked

Avoid unnecessary:
- Create obligation
- Manually update status
- Validate every interpretation
- Mark everything completed
- Maintain AI findings manually

If Apex already knows a fact from canonical data, do not ask the user to enter it again.

---

## 30. Architectural Boundaries — Non-Negotiable

Preserve:

### Platform owns
- parties
- party_roles
- approval engine
- domain events
- apex jobs
- audit
- organization boundaries

### Contracts owns
- contract truth
- clauses
- amendments / lineage
- contractual obligations
- measurement rules
- billing conditions
- guarantees
- insurance
- indexation
- contractual risks/intelligence
- document relationships

### Projects owns
- project
- schedule
- operational progress
- operational evidence
- measurement instances

### Fiscal owns
- fiscal documents / NFS-e

### Finance owns
- AR/AP
- settlement
- reconciliation
- payment truth

Contracts must **never** write Finance/Fiscal truth.

Apex does **not** generate technical service / measurement reports.

Apex identifies what reports/evidence are required and tracks readiness.

---

## 31. Real-Data Safety

The next uploaded real contract must:
- begin `UNCLASSIFIED`
- preserve original document
- preserve AI provenance
- preserve evidence
- avoid invented fields
- avoid auto-`LIVE` classification
- use the new contract intelligence model
- avoid mandatory per-clause human validation
- escalate only exceptions according to policy

No demo fallback.

No mock KPI.

No silent auto-seed.

---

## 32. Data Model / Migrations

Audit existing schema before adding tables.

Reuse existing:
- contract obligations
- structured clauses
- billing conditions
- measurement requirements
- Event Graph
- Apex Jobs
- Approval Engine
- AI Gateway
- risk provenance
- Projects measurement lifecycle

Create migrations only where the new concepts cannot be safely represented.

If Apex Follow-up needs new platform-level persisted objects, design them as organization-scoped, RLS-protected and transversal rather than Contracts-only task duplication.

All browser writes must go through governed server/domain paths.

No service-role impersonation.

No direct browser mutation of protected truth.

---

## 33. UX Quality

Keep the current modern enterprise visual language.

Do not redesign the entire application.

Improve hierarchy and semantics.

Avoid:
- generic AI cards
- duplicated navigation
- excessive mini cards
- decorative AI badges
- meaningless confidence labels without context
- walls of operational forms

Prefer:
- executive hierarchy
- clear operational states
- evidence
- blockers
- exposure
- ownership
- next expected event
- human attention by exception

---

## 34. Testing

After implementation run at minimum:
- focused Contracts unit tests
- AI Gateway / contract intelligence tests
- provenance tests
- authority / impersonation tests
- RLS tests
- cross-org isolation tests
- obligations tests
- measurement/billing readiness integration tests
- follow-up tests
- schedule-anchor materialization tests
- idempotency tests
- typecheck
- changed-scope lint
- integration suite
- production build
- `git diff --check`

Add tests specifically proving:

1. Original contract remains source truth.
2. AI interpretation does not pretend to be contract authorship.
3. Per-clause human validation is not mandatory.
4. Low-confidence/material exceptions still require attention.
5. AI/service role cannot fabricate human review.
6. Relative rules do not invent dates.
7. Schedule anchor materializes the correct operational deadline.
8. Billing conditions block readiness correctly.
9. Follow-up does not spam while `WAITING_EXTERNAL_PARTY`.
10. Verified evidence can satisfy a requirement.
11. Contracts does not write Finance/Fiscal truth.
12. Cross-org leakage is impossible.
13. Empty production state does not render demo/mock data.

---

## 35. Execution Strategy

Audit first.

Then implement the smallest coherent architecture that makes the new Contracts model real.

Do **not** only rename UI labels while leaving the old "AI proposals waiting for validation" semantics underneath.

Likewise, do **not** overbuild the future Autonomous Work Layer.

This work should create a strong bridge:

```text
SYSTEM OF INTELLIGENCE
→ early SYSTEM OF ACTION
```

through bounded contract operationalization and Apex Follow-up.

Do not start:
- general autonomous planning
- self-directed tool use
- autonomous legal decisions
- Phase 9 Control Tower architecture
- Phase 10 digital workers

---

## 36. Final Report

Finish with exact evidence:

```text
GLOBAL CONTRACTS NAVIGATION PRESERVED AT 8 ITEMS: YES / NO

DOSSIER NAVIGATION:
- Resumo: YES / NO
- Operação: YES / NO
- Medição & Faturamento: YES / NO
- Inteligência Contratual: YES / NO
- Documentos: YES / NO
- Governança: YES / NO

GLOBAL/LOCAL NAVIGATION REDUNDANCY REMOVED: YES / NO

CONTRACT AUTHORING MENTAL MODEL REMOVED: YES / NO
CLIENT-CONTRACT OPERATIONALIZATION MODEL: PASS / FAIL

ORIGINAL PDF REMAINS SOURCE TRUTH: YES / NO
AI INTERPRETATION IS SEPARATE FROM CONTRACT TRUTH: YES / NO

MANDATORY PER-CLAUSE HUMAN REVIEW REMOVED: YES / NO
EXCEPTION-BASED HUMAN GOVERNANCE: PASS / FAIL
SERVICE ROLE CAN IMPERSONATE HUMAN REVIEWER: NO / YES

CONTRACT WHAT / PROJECT WHEN SEPARATION: PASS / FAIL

ABSOLUTE CONTRACT RULES: PASS / FAIL
RELATIVE-TO-EVENT RULES: PASS / FAIL
CONDITION-BASED RULES: PASS / FAIL
RECURRING RULES: PASS / FAIL

INSIGHT OBLIGATIONS SUPPORTED: YES / NO
COUNTERPARTY OBLIGATIONS SUPPORTED: YES / NO
THIRD-PARTY OBLIGATIONS SUPPORTED: YES / NO

CONTRACTUAL BILLING READINESS: PASS / FAIL
CONTRACTS WRITES FINANCE/FISCAL: NO / YES

APEX FOLLOW-UP FOUNDATION: PASS / FAIL
RESPONSIBLE-PERSON ASSIGNMENT: PASS / FAIL
SCHEDULE-ANCHORED FOLLOW-UP: PASS / FAIL
WAITING_EXTERNAL_PARTY BEHAVIOR: PASS / FAIL
EVIDENCE-BASED VERIFICATION: PASS / FAIL

CONTRACT INTELLIGENCE UX: PASS / FAIL
RISK UX IS OPERATIONAL, NOT AUTHORING: YES / NO
DOCUMENTS ARE OPERATIONALLY LINKED: YES / NO

NO MOCK/DEMO FALLBACK IN REAL ORGANIZATION: PASS / FAIL
NO INVENTED DATES/VALUES: PASS / FAIL
TENANT ISOLATION: PASS / FAIL

TYPECHECK: PASS / FAIL
UNIT TESTS: <passed/failed>
INTEGRATION TESTS: <passed/failed/skipped>
BUILD: PASS / FAIL
MIGRATION TIP: <N>
FINAL SHA: <sha>
ORIGIN/MAIN SYNCED: YES / NO

SAFE TO DELETE PREVIOUS TEST CONTRACT: YES / NO
SAFE TO UPLOAD A NEW REAL CONTRACT USING THE NEW MODEL: YES / NO

PHASE 9 STARTED: NO
GENERAL PHASE 10 AUTONOMY STARTED: NO
```

---

## Product Acceptance Test

Any person opening Contracts should immediately understand:

> **"The client sent us this contract. Apex understood what it requires, transformed it into operational rules, and is now monitoring compliance."**

If the implementation still feels like an AI assistant helping draft or manually review a contract, the refactor is not complete.
