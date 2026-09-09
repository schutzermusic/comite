# Phase 10E — Autonomous Digital Workers

## Purpose

Package the L4 substrate into bounded digital workers that own measurable enterprise outcomes.

This is where Insight Apex begins to look like "work as a service" rather than software with AI.

## Principle

Digital workers are organized around work outcomes, not menu modules.

Avoid:
- Finance Agent;
- Contract Agent;
- HR Agent;

Prefer:
- Billing Operator;
- Contract Lifecycle Operator;
- Workforce Capacity Operator;
- Evidence & Compliance Operator.

## Initial workers

### Apex Billing Operator

Goal:
maximize eligible billing throughput while respecting contract, evidence, fiscal, approval, and finance boundaries.

Monitors:
- accepted measurements;
- billing conditions;
- evidence;
- customer acceptance;
- approvals;
- fiscal handoff;
- AR creation;
- due dates;
- reconciliation status.

### Apex Contract Lifecycle Operator

Goal:
keep live contracts governed and operationally compliant.

Monitors:
- renewals;
- obligations;
- guarantees;
- insurance;
- amendments;
- indexation;
- notices;
- evidence;
- contractual exposure.

### Apex Workforce Capacity Operator

Goal:
maintain governed visibility over capacity and operational allocation.

May:
- detect overload/underallocation;
- create review tasks;
- request missing evidence;
- prepare recommendations.

Must not autonomously make employment decisions.

## Worker runtime

Each worker uses:
- goals;
- context engine;
- planner;
- action catalog;
- policy engine;
- verification;
- recovery;
- event subscriptions.

## Human operating model

Desired UI:

```text
97 actions completed autonomously
8 waiting on external parties
3 require human decision
1 escalated due to policy conflict
```

Humans supervise exceptions and authority decisions.

## Worker boundaries

- explicit scope;
- explicit domain permissions;
- explicit goal types;
- explicit spend/runtime limits;
- no arbitrary tool access;
- no authority inheritance from another worker;
- no cross-tenant memory;
- no policy self-modification.

## Gate

- first worker proves bounded production outcome;
- autonomous action history fully reconstructable;
- all escalations visible;
- no hidden failures;
- policy boundary tests;
- worker stop/kill switch;
- budget limits;
- tenant isolation;
- human takeover;
- outcome metrics.

## Complexity

**Very High.**

The substrate from 10A–10D reduces the technical risk. The remaining complexity is product orchestration, worker scope, exception UX, and operational reliability.

## Recommended models

**Primary:** Claude Opus 5 or GPT-6 Astra.

Opus 5 is particularly suitable for cohesive long-running agent implementation across a large codebase.

Astra is preferred if the worker spans many domains and requires difficult end-to-end orchestration.

**Red-team:** GPT-5.6 Sol High.

**Gemini 3.8 Flash:** E2E/browser test expansion and repetitive worker wiring.

**Sonnet 5:** strong candidate for production worker reasoning where cost matters.
