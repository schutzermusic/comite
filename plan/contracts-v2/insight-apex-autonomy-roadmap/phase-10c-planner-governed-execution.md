# Phase 10C — Planner + Governed Execution

## Purpose

Allow Apex to produce a bounded plan for a business goal and execute approved actions through existing domain engines.

This is the core of **L3 — System of Action**.

## Architecture

```text
Goal
 ↓
Context
 ↓
Planner
 ↓
Proposed plan
 ↓
Policy evaluation per step
 ↓
Action Engine
 ↓
Domain service / RPC / Event Graph / Job
```

## Planner responsibilities

The planner may:
- order actions;
- identify dependencies;
- select from allowed Action Catalog entries;
- declare expected postconditions;
- declare required evidence;
- stop and escalate when required.

The planner may not:
- invent new tools;
- bypass policy;
- write database rows directly;
- change permissions;
- change autonomy policy;
- reinterpret canonical financial/contractual truth.

## Plan representation

Every step should include:
- action type;
- input bindings;
- reason;
- expected postcondition;
- policy result;
- dependency;
- retry class;
- deadline;
- stop/escalation condition.

## Execution requirements

- action requests are durable;
- idempotency keys deterministic;
- action execution tenant-bound;
- events emitted transactionally where required;
- approval-required steps pause plan;
- human-required steps pause plan;
- NEVER_AUTOMATED steps cannot be executed by autonomous actor;
- irreversible actions must be explicit.

## Example

Goal: unlock billing for accepted measurement.

Plan:
1. verify required evidence;
2. request missing CND;
3. wait for evidence;
4. recompute readiness;
5. open approval request;
6. await approval;
7. initiate billing release;
8. verify billing state.

## Gate

- only registered actions executable;
- all step policy evaluations persisted;
- no LLM direct write path;
- idempotency under redelivery;
- concurrency safety;
- approval pause/resume;
- stale-plan invalidation;
- domain ownership respected;
- audit complete;
- failure cannot silently skip a required step.

## Complexity

**Extreme.**

This is where probabilistic reasoning starts causing real side effects. Correctness requires strong idempotency, authority, concurrency, lifecycle, and replay semantics.

## Recommended models

**Primary:** GPT-6 Astra.

This is one of the few phases where the strongest end-to-end model is justified.

**Alternative primary:** GPT-5.6 Sol High/Extra High for architecture-heavy implementation.

**Independent review:** Claude Opus 5 or Sol.

**Gemini 3.8 Flash:** high-volume test expansion and deterministic action wiring only after the planner contract is frozen.

**Sonnet 5:** production planner candidate for low-risk goals after evaluation, not necessarily the implementation model.
