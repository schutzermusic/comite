# Insight Apex — Roadmap to L4 Autonomy

## North Star

Insight Apex evolves through four maturity levels:

- **L1 — System of Record:** Apex knows what happened.
- **L2 — System of Intelligence:** Apex understands what is happening.
- **L3 — System of Action:** Apex executes what needs to be done.
- **L4 — System of Autonomy:** Apex identifies, plans, executes, verifies, recovers, and continues within governed policy.

## Current position

Completed foundation:
- Phase 0 — Truth & Security
- Phase 1 — Canonical Party & Tenant Foundation
- Phase 2 — Structured Contract
- Phase 3 — Obligations Engine
- Phase 4 — Event Graph
- Phase 5 — Apex Approval Engine
- Phase 6 — Contract ↔ Project / Measurement
- Phase 7 — Billing ↔ Fiscal ↔ Finance
- Phase 7.5 — Enterprise Multi-Organization Foundation
- Production Clean-Slate Gate — PASS
- Post-Provision Production Organization Gate — PASS

Current production organization:
- `Insight Energia`
- `is_demo = false`
- zero operational facts after full navigation
- QA bot has no production membership
- human owner/admin confirmed

## Roadmap

| Step | Purpose | Target maturity | Complexity | Primary implementation model |
|---|---|---|---|---|
| Phase 7.6 | Apex AI Gateway | L2 foundation | Medium | GPT-5.6 Sol High / Opus 5 |
| Real Data Gate | First real contract and operational proof | Validation | Low–Medium | Gemini 3.8 Flash / Sonnet 5 |
| Phase 8 | Risks & Clauses Intelligence | L2 | High | Opus 5 / GPT-5.6 Sol High |
| Phase 9 | Enterprise Control Tower | L2 → L3 | Very High | GPT-5.6 Sol High / Opus 5 |
| Phase 10A | Action Catalog + Autonomy Policy | L3 foundation | Very High | GPT-6 Astra / GPT-5.6 Sol High |
| Phase 10B | Goal Engine + Context Engine | L3 | Very High | GPT-6 Astra / Opus 5 |
| Phase 10C | Planner + Governed Execution | L3 | Extreme | GPT-6 Astra / GPT-5.6 Sol High |
| Phase 10D | Verification + Recovery + Re-plan | L3 → L4 | **Extreme / Highest** | GPT-6 Astra + Sol red-team |
| Phase 10E | Autonomous Digital Workers | L4 | Very High | Opus 5 / GPT-6 Astra |
| Phase 10F | Learning + Optimization | L4 mature | High–Very High | GPT-6 Astra / GPT-5.6 Sol |

## Model usage strategy

### Claude Sonnet 5
Best fit for:
- implementation after architecture is already frozen;
- repetitive domain wiring;
- prompts, schemas, transformations;
- high-volume review and extraction;
- economically efficient production reasoning.

Do not make it the only architectural reviewer for the most security-sensitive autonomy phases.

### Gemini 3.8 Flash
Best fit for:
- operational execution;
- migrations with frozen semantics;
- E2E/browser validation;
- broad repo inventory;
- repetitive refactors;
- lower-cost parallel implementation.

Excellent for implementation when the specification is already precise.

### Claude Opus 5
Best fit for:
- complex multi-file implementation;
- long-running codebase work;
- nuanced enterprise domain modeling;
- AI orchestration;
- difficult cross-domain product logic.

### GPT-5.6 Sol
Best fit for:
- architecture review;
- security and governance;
- database invariants;
- cross-domain reasoning;
- red-team;
- concurrency, idempotency, authorization, and failure modes.

Use High/Extra High when the phase can alter authority or financial truth.

### GPT-6 Astra
Best fit for:
- the hardest end-to-end autonomy work;
- agent architecture;
- planner/verifier/recovery design;
- long-horizon orchestration;
- phases where a local implementation error can become a systemic autonomous error.

Use it selectively. It is overkill for routine implementation.

## Recommended one-agent-per-phase execution

1. Freeze the phase specification in Markdown.
2. Use one primary implementation agent for that phase.
3. Use a different frontier model only for the final adversarial review when warranted.
4. Avoid duplicate full audits.
5. Merge only after the phase-specific gate is proven.

## Difficulty ranking

From easiest to hardest:

1. Real Data Gate
2. Phase 7.6
3. Phase 8
4. Phase 10F
5. Phase 9
6. Phase 10E
7. Phase 10A
8. Phase 10B
9. Phase 10C
10. **Phase 10D**

Phase 10D is the hardest because recovery and re-planning can create loops, repeated side effects, unsafe retries, stale-context actions, compensation errors, or escalation failures. L4 only becomes trustworthy when this layer is correct.

## Architectural invariant

> **Truth is deterministic. Intelligence may be probabilistic. Authority is governed. Actions are auditable. Autonomy is earned.**
