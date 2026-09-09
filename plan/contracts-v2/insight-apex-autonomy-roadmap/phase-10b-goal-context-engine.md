# Phase 10B — Goal Engine + Context Engine

## Purpose

Move Apex from executing isolated commands to pursuing bounded business goals.

This establishes the orchestration substrate for L3.

## Goal model

A goal is not a prompt. It is a durable governed object.

Example:

```text
Goal:
Make measurement M-847 ready for billing.
```

A goal should retain:
- organization;
- goal type;
- target entity;
- creator/source;
- policy envelope;
- current state;
- deadline;
- priority;
- expected deterministic completion condition;
- current blockers;
- context snapshot/version;
- plan/version;
- audit history.

## Goal lifecycle

```text
CREATED
  ↓
CONTEXT_BUILDING
  ↓
READY
  ↓
PLANNING
  ↓
ACTIVE
  ↓
WAITING / BLOCKED
  ↓
COMPLETED / FAILED / CANCELLED / ESCALATED
```

## Context Engine

The Context Engine assembles a minimal, governed context package.

For a billing goal it may collect:
- contract;
- accepted clauses;
- obligations;
- billing conditions;
- project;
- measurement;
- execution evidence;
- customer acceptance;
- required documents;
- approvals;
- fiscal state;
- finance state;
- risks;
- relevant domain events.

## Context rules

- no unrestricted database dump to LLM;
- only authorized organization-scoped context;
- every included fact retains provenance;
- stale context carries freshness metadata;
- UNKNOWN stays UNKNOWN;
- context size bounded;
- sensitive fields minimized;
- deterministic facts distinguished from AI findings.

## Context package

The model should receive something like:

```json
{
  "goal": "...",
  "canonical_facts": [],
  "unknowns": [],
  "blockers": [],
  "allowed_actions": [],
  "policy_constraints": [],
  "freshness": {}
}
```

## Gate

- durable goal model;
- deterministic completion predicates;
- organization isolation;
- context provenance;
- context freshness;
- minimal-data principle;
- no cross-org joins;
- bounded token payload;
- replayable context builder;
- no provider-specific semantics in goal/domain code.

## Complexity

**Very High.**

The hard part is producing enough context for good reasoning without turning the LLM into an unbounded database reader or allowing stale context to drive actions.

## Recommended models

**Primary:** GPT-6 Astra or Claude Opus 5.

- Astra: best for end-to-end agent architecture and difficult orchestration.
- Opus 5: excellent for large, coherent, multi-module implementation.

**Security/red-team:** GPT-5.6 Sol High.

**Gemini 3.8 Flash:** context-builder test matrices and operational E2E after architecture freeze.

**Sonnet 5:** suitable for runtime goal interpretation, but not as sole architecture reviewer.
