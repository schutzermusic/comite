# Phase 10F — Learning + Optimization

## Purpose

Make autonomy improve from observed outcomes without allowing the AI to silently rewrite truth, policy, or authority.

This is **L4 mature**.

## What Apex should learn

- predicted risk vs actual risk;
- forecast vs actual result;
- action selected vs outcome;
- time to resolve blocker;
- external party response time;
- customer acceptance latency;
- approval latency;
- billing blockage patterns;
- recurring failure modes;
- model confidence calibration.

## Learning outputs

Learning may produce:
- better ranking;
- better risk calibration;
- better estimated resolution times;
- model routing recommendations;
- prompt/version recommendations;
- suggested policy changes;
- suggested action sequencing;
- suggested worker configuration.

Learning must not directly produce:
- permission grants;
- policy activation;
- authority escalation;
- signed contract modification;
- ledger truth;
- approval decisions.

## Data model

Persist:
- goal;
- context version;
- plan version;
- action history;
- predicted outcome;
- actual outcome;
- verifier result;
- human override;
- model/provider/version;
- latency;
- token usage;
- cost;
- failure class;
- resolution path.

## Evaluation

Create offline and shadow evaluation pipelines:

- replay historical cases;
- compare old vs candidate model;
- compare proposed plans;
- measure false-positive risk findings;
- measure action success;
- measure human override rate;
- measure autonomous completion rate;
- measure cost per completed work unit.

## Deployment policy

No learned optimization goes directly to production.

Recommended:
```text
observe
↓
candidate change
↓
offline eval
↓
shadow
↓
human approval
↓
limited rollout
↓
monitor
```

## Core metrics

- autonomous completion rate;
- human intervention rate;
- exception rate;
- policy-denial rate;
- successful first-plan rate;
- re-plan rate;
- average time-to-goal;
- cost per goal;
- model tokens per goal;
- rollback/compensation rate;
- false-positive finding rate.

## Gate

- outcome telemetry complete;
- no cross-tenant training contamination;
- evaluation datasets tenant-safe;
- model changes versioned;
- policy suggestions require human governance;
- rollback to prior routing/prompt possible;
- shadow evaluation available;
- cost observability reliable.

## Complexity

**High–Very High.**

Conceptually sophisticated, but safer to stage than 10C/10D because learning can initially remain offline and advisory.

## Recommended models

**Primary:** GPT-6 Astra or GPT-5.6 Sol High.

Astra for optimization architecture and agent evaluation design.

Sol for metrics, experiment integrity, security boundaries, and adversarial review.

**Opus 5:** strong alternative for large telemetry/evaluation implementation.

**Gemini 3.8 Flash:** excellent for high-volume replay/evaluation harness work.

**Sonnet 5:** cost-effective production inference and candidate comparison, not policy self-modification.
