# Phase 9 — Enterprise Control Tower

## Purpose

Create a cross-domain operational intelligence layer that answers one executive question:

> What requires attention now, why, what is financially/operationally exposed, and what should happen next?

Phase 9 moves Apex from isolated domain intelligence toward **L2 advanced / early L3**.

## Preconditions

Phase 9 must not start until:
- Phase 3 obligations is real;
- Phase 7 contract-to-cash is real;
- Phase 8 risk intelligence is real;
- production organization contains enough truthful operational data to make cross-domain prioritization meaningful.

## Inputs

- contracts;
- obligations;
- projects;
- measurements;
- billing readiness;
- approvals;
- fiscal;
- finance/AR;
- risks;
- workforce capacity where relevant;
- domain events;
- audit trail.

## Core read models

The Control Tower should expose, with provenance:

- required actions;
- blocked money;
- overdue obligations;
- renewal exposure;
- receivables;
- approvals blocking workflows;
- risks and exposure;
- counterparty blockers;
- recent material changes.

## Forbidden behavior

- no mock KPI fallback;
- no fabricated received/paid values;
- no AI-generated number presented as canonical;
- no generic dashboard cards disconnected from domain truth;
- no silent collapse of `UNKNOWN` into zero;
- no Control Tower writes directly into domain tables.

## Prioritization

Apex should calculate deterministic signals first:

```text
amount exposed
days overdue
deadline proximity
workflow blocker
risk severity
authority waiting time
```

AI may then:
- summarize;
- explain causality;
- cluster related issues;
- produce executive narrative;
- recommend focus order.

## Output example

Instead of:
- 8 alerts;
- 4 overdue items;
- 3 risks.

Prefer:
> R$ 1.82M of potential billing is blocked across four measurements. R$ 680k is blocked only by an expired fiscal certificate; two other cases require customer acceptance.

The numbers must be deterministic. The narrative may be AI-generated.

## Gate

- every executive number traceable to canonical rows;
- UNKNOWN preserved;
- cross-domain organization isolation proven;
- Control Tower read models do not weaken RLS;
- no AI-generated financial truth;
- latency acceptable;
- material change feed event-backed;
- drill-down reaches underlying facts;
- no production mock fallback.

## Complexity

**Very High.**

This is the first major cross-domain synthesis surface. Incorrect joins can create false executive truth even when every individual domain is correct.

## Recommended models

**Primary:** GPT-5.6 Sol High or Claude Opus 5.

Use Sol High when working on:
- canonical joins;
- finance provenance;
- RLS/security;
- invariant review.

Use Opus 5 for:
- large implementation across UI/read models/services;
- long-running cohesive code changes.

**Gemini 3.8 Flash:** parallel test generation, E2E navigation, broad data inventory.

**Sonnet 5:** production executive synthesis, not canonical calculations.

**Astra:** optional final architecture/red-team for cross-domain truth before release.
