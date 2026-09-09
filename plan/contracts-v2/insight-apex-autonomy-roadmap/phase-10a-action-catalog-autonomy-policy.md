# Phase 10A — Action Catalog + Autonomy Policy

## Purpose

Define exactly what Apex is allowed to do before allowing AI to choose actions.

This is the governance foundation of **L3 — System of Action**.

## Core principle

No autonomous system may execute an unregistered action.

## Canonical Action Catalog

Each action should define:

- action type;
- owning domain;
- required inputs;
- deterministic preconditions;
- postconditions;
- idempotency basis;
- required permission;
- authority class;
- autonomy policy;
- audit event;
- timeout/retry semantics;
- reversible/irreversible classification.

Example actions:

- `create_task`
- `notify_owner`
- `request_document`
- `request_evidence`
- `request_approval`
- `schedule_followup`
- `create_draft`
- `recompute_readiness`
- `initiate_billing_release`

## Autonomy policy classes

- `AUTO_ALLOWED`
- `APPROVAL_REQUIRED`
- `HUMAN_REQUIRED`
- `NEVER_AUTOMATED`

Example:

| Action | Policy |
|---|---|
| Create task | AUTO_ALLOWED |
| Notify responsible person | AUTO_ALLOWED |
| Request evidence | AUTO_ALLOWED |
| Prepare draft | AUTO_ALLOWED |
| Initiate governed billing-release request | APPROVAL_REQUIRED |
| Approve payment | HUMAN_REQUIRED |
| Accept measurement | NEVER_AUTOMATED |
| Modify signed contract truth | NEVER_AUTOMATED |

## Authority invariants

- membership ≠ RBAC ≠ business authority ≠ autonomous authority;
- LLM never grants itself permission;
- enterprise admin does not imply domain execution authority;
- policy changes are human-governed;
- policy version used for each action is snapshotted;
- stale policy cannot silently authorize execution;
- tenant context validated server-side.

## Action request lifecycle

```text
PROPOSED
  ↓
POLICY_EVALUATED
  ↓
AUTO_APPROVED / APPROVAL_REQUIRED / HUMAN_REQUIRED / DENIED
  ↓
EXECUTING
  ↓
COMPLETED / FAILED / CANCELLED
```

## Gate

- every autonomous-capable action registered;
- no dynamic arbitrary tool dispatch;
- policy immutable/versioned;
- permission/authority snapshot captured;
- tenant-safe;
- NEVER_AUTOMATED actions proven unreachable by autonomous actor;
- audit/event coverage;
- idempotency tests;
- concurrency tests;
- security-definer surface reviewed.

## Complexity

**Very High.**

This phase defines the boundary between intelligence and authority. A mistake here can turn an LLM recommendation into unauthorized enterprise mutation.

## Recommended models

**Primary:** GPT-6 Astra or GPT-5.6 Sol High/Extra High.

Astra is justified because this is foundational autonomous governance.

**Independent review:** Claude Opus 5 or Sol if Astra implemented it.

**Gemini 3.8 Flash / Sonnet 5:** only after the policy model is frozen, for repetitive action registration and tests.

Do not let a cheaper model invent the autonomy authority model from scratch.
