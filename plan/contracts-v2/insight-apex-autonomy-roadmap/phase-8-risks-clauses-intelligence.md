# Phase 8 — Risks & Clauses Intelligence

## Purpose

Transform structured contract truth into governed risk intelligence.

Phase 8 advances Insight Apex deeper into **L2 — System of Intelligence**.

## Core principle

```text
AI finding ≠ official risk
```

The system may detect, explain, score, and propose. Official risk state must remain governed.

## Inputs

- canonical contract;
- accepted clauses;
- amendments and temporal lineage;
- bilateral/multilateral obligations;
- guarantees;
- insurance;
- indexation;
- measurement rules;
- billing conditions;
- execution/project facts;
- billing state;
- historical evidence.

## Capabilities

- clause classification;
- conflicting-clause detection;
- amendment precedence analysis;
- risk exposure detection;
- financial exposure estimation from deterministic amounts;
- obligation-risk linkage;
- billing-blocker risk;
- renewal risk;
- guarantee/insurance expiry exposure;
- ambiguous drafting detection;
- compliance concern proposal;
- operational dependency identification;
- evidence-backed mitigation recommendations.

## Risk lifecycle

Recommended separation:

```text
AI Finding
  ↓
Review / triage
  ↓
Accepted Risk
  ↓
Mitigation
  ↓
Monitoring
  ↓
Resolved / Accepted / Transferred / Closed
```

Do not allow an LLM to promote itself from finding to official corporate risk.

## Provenance

Every AI finding should retain:
- organization;
- source domain;
- source entity;
- source document/clause;
- model;
- provider;
- prompt/pipeline version;
- analyzed_at;
- confidence;
- rationale;
- evidence references.

## Cross-domain constraints

- Contracts owns contractual source truth.
- Risks may reference Contracts/Projects/Finance but not rewrite them.
- Amounts come from canonical sources.
- No inferred received/paid values.
- No AI-created financial ledger entries.

## Gate

- risk finding vs official risk boundary enforced;
- clause/amendment lineage honored;
- all material findings evidence-backed;
- no demo data in production;
- model provenance complete;
- risk deduplication deterministic;
- human review/acceptance auditable;
- typecheck/unit/integration/E2E/build green.

## Complexity

**High.**

The challenge is not the LLM call. It is correct legal/contractual provenance, temporal amendment reasoning, and governance of probabilistic findings.

## Recommended models

**Primary:** Claude Opus 5 or GPT-5.6 Sol High.

- Opus 5: strong for long multi-file enterprise implementation and nuanced contract semantics.
- Sol High: strong for invariants, security, data lineage, and adversarial review.

**Production inference:** Claude Sonnet 5 by default, with escalation only for difficult ambiguity.

**Gemini 3.8 Flash:** excellent for test expansion, UI wiring, and repetitive migration work after semantics are frozen.

**Astra:** reserve for a difficult architecture deadlock or final red-team, not routine implementation.
