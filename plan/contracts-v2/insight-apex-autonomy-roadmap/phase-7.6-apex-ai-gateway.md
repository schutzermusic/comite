# Phase 7.6 — Apex AI Gateway

## Purpose

Create a provider-agnostic intelligence gateway so every LLM-enabled capability in Insight Apex uses one governed server-side interface instead of depending directly on Anthropic, OpenAI, Google, or any future provider.

This phase strengthens **L2 — System of Intelligence** and prepares L3/L4. It does not create autonomous agents.

## Current problem

AI call sites are not yet fully centralized:
- Anthropic SDK calls exist directly in AI modules.
- model IDs are hardcoded in more than one place;
- contract extraction uses a different hardcoded model from other scanners;
- a legacy Genkit/Gemini path exists separately;
- provider-specific features such as structured output, PDF input, caching, effort, retries, and usage metadata are not abstracted behind one capability layer.

## Target architecture

```text
Domain capability
      ↓
Apex AI Gateway
      ↓
Task policy / capability request
      ↓
Provider adapter
 ┌────┼─────┐
 │    │     │
Anthropic OpenAI Google
```

## In scope

- server-only `ApexAIGateway`;
- typed task registry;
- model policy by task;
- Anthropic adapter;
- OpenAI adapter interface;
- Google adapter interface;
- structured-output abstraction;
- document/PDF capability abstraction;
- reasoning/effort abstraction;
- prompt-cache abstraction where supported;
- timeout/retry/error normalization;
- token/model/provider metadata;
- model provenance persisted with AI-generated findings/proposals;
- deterministic fallbacks preserved where they already exist;
- environment configuration documentation;
- tests proving routing and provider isolation.

## Suggested task classes

- `CONTRACT_EXTRACTION`
- `CONTRACT_RISK_ANALYSIS`
- `FINANCE_RISK_ANALYSIS`
- `PROJECT_RISK_ANALYSIS`
- `WORKFORCE_ADVISOR`
- `PAYROLL_NARRATIVE`
- `EXECUTIVE_SYNTHESIS`
- `MEETING_MINUTES`
- `COMPLEX_ESCALATION`

## Initial production routing

Default production provider: Anthropic.

Recommended:
- normal intelligence tasks → Claude Sonnet 5;
- difficult escalation → configurable;
- no domain module may assume a specific model ID.

## Hard invariants

- LLM unavailability must not corrupt deterministic workflows.
- API keys are server-only.
- No browser-side provider credentials.
- LLM cannot become source of financial, contractual, approval, or measurement truth.
- provider/model must be recorded for persisted AI outputs.
- organization context must be explicit and server-validated.
- no silent fallback from a stronger model to a weaker model for high-risk tasks unless policy explicitly permits it.
- no cross-tenant cache reuse containing customer data.

## Out of scope

- autonomous planning;
- action execution;
- goal engine;
- self-learning;
- Phase 8 risk semantics redesign;
- first real contract onboarding.

## Gate

- all current production AI call sites inventoried;
- provider-specific API usage removed from domain modules where practical;
- routing unit tests pass;
- structured outputs preserved;
- contract evidence gates preserved;
- payroll deterministic fallback preserved;
- token/provider/model metadata observable;
- typecheck, unit, integration, build green;
- AI disabled → deterministic Apex remains operational.

## Complexity

**Medium.**

This is cross-cutting but bounded. The domain semantics already exist, so the main risk is abstraction quality rather than new business logic.

## Recommended models

**Primary:** GPT-5.6 Sol High or Claude Opus 5.

Why:
- requires repo-wide architecture judgment;
- must preserve heterogeneous provider capabilities;
- must avoid accidental weakening of evidence/provenance.

**Implementation follow-up:** Gemini 3.8 Flash or Claude Sonnet 5 for repetitive adapter conversion once the interface is frozen.

**Do not spend Astra here unless the first architecture review exposes deeper coupling than expected.**
