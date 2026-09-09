# Phase 10D — Verification + Recovery + Re-plan

## Purpose

Turn execution into autonomy.

An L3 system can perform actions. An L4 system must determine whether the action worked, understand failure, recover safely, and continue without creating duplicate or unsafe effects.

This is the most difficult phase in the roadmap.

## Core loop

```text
OBSERVE
  ↓
REASON
  ↓
PLAN
  ↓
ACT
  ↓
VERIFY
  ↓
COMPLETE
or
RECOVER / RE-PLAN / ESCALATE
```

## Verification model

Every action must declare deterministic postconditions when possible.

Examples:
- requested document exists;
- approval request is pending;
- readiness changed from BLOCKED to READY;
- billing release request exists;
- fiscal job accepted;
- task assigned;
- external integration acknowledged.

LLM should not decide success if a deterministic postcondition exists.

## Failure classification

- transient;
- permanent;
- policy denied;
- human waiting;
- stale context;
- stale plan;
- dependency changed;
- external timeout;
- conflicting action;
- compensation required;
- unknown.

## Recovery primitives

- retry with bounded backoff;
- refresh context;
- re-evaluate policy;
- rebuild plan;
- wait for event;
- request human intervention;
- cancel remaining steps;
- compensate reversible action;
- terminal failure.

## Anti-loop controls

- max attempts;
- max plan revisions;
- max autonomous runtime;
- max spend/tokens;
- repeated-state detection;
- repeated-action fingerprint;
- dead-letter;
- escalation threshold;
- no infinite retry on human-required condition.

## Compensation

Compensation is not rollback.

For each reversible action:
- define safe compensating action;
- define when compensation is permitted;
- preserve both original and compensation audit events.

Never fake atomicity across external systems.

## Stale context protection

Before material side effects:
- re-read critical facts;
- re-evaluate policy;
- validate active organization;
- validate target lifecycle;
- validate authority;
- reject stale plan if required state changed.

## Gate

- verifier deterministic where possible;
- retry cannot duplicate effects;
- action replay safe;
- loop limits proven;
- stale context tests;
- mid-plan policy change tests;
- mid-plan tenant/membership loss tests;
- concurrent worker tests;
- external timeout tests;
- compensation tests;
- human escalation tests;
- dead-letter observable;
- no autonomous path can increase its own authority.

## Complexity

**EXTREME — highest in the roadmap.**

The hardest bugs here are not obvious syntax defects. They are second-order behaviors:
- duplicate side effects;
- infinite loops;
- stale authorization;
- incorrect success detection;
- retry storms;
- compensation races;
- re-plan oscillation;
- acting after context changed.

## Recommended models

**Primary:** GPT-6 Astra.

**Mandatory independent red-team:** GPT-5.6 Sol High/Extra High.

**Secondary implementation/review:** Claude Opus 5.

**Gemini 3.8 Flash:** only for large deterministic test matrices after semantics are frozen.

**Sonnet 5:** runtime verifier/reasoner can be evaluated later, but deterministic verification must dominate whenever possible.

Do not implement and approve this phase with the same model alone.
