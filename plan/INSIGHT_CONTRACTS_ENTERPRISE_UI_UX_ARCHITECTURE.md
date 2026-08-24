# Insight Energy — Contract Intelligence Command Center
## Enterprise UI/UX, Product Architecture & Contract Intelligence Specification

**Version:** 1.0  
**Date:** 2026-08-18  
**Product:** Insight Energy / Insight Apex  
**Module:** Gestão de Contratos  
**Direction:** Enterprise Command Center · Futuristic Institutional UI · Contract Intelligence · Operational Governance

---

# 1. Executive Vision

The Contracts module should evolve from a traditional contract-management dashboard into a true **Contract Intelligence Command Center**.

The goal is not to simply display contract data.

The system must actively help the user understand:

- what requires attention now;
- which contracts are deteriorating;
- where financial exposure exists;
- what can block billing or cash generation;
- which obligations are overdue or at risk;
- which approvals are delaying execution;
- which clauses create legal or financial exposure;
- which contracts should be renewed, renegotiated, reviewed, or terminated;
- which documents are missing;
- what changed since the last review;
- why a risk or recommendation exists;
- who must act next;
- what the recommended next action is.

The desired product perception is:

> **A next-generation enterprise operating system for contracts, financial exposure, obligations, risks, approvals, documents, and governance.**

The module should feel less like a conventional SaaS dashboard and more like an advanced institutional control room.

---

# 2. Core Product Principle

The module must not only show the current state of contracts.

It must **drive the contract operation**.

Every relevant screen should answer four questions:

1. **What happened?**
2. **Why does it matter?**
3. **What is the business impact?**
4. **What should happen next?**

This principle should guide all UI, workflows, intelligence, alerts, dashboards, AI outputs, and architecture.

---

# 3. Visual Direction

## 3.1 Design Objective

The product must remain visually rich, sophisticated, futuristic, and high-end.

Do **not** over-compact the interface in a way that makes it feel simplistic or generic.

The target visual language is:

- enterprise-grade;
- institutional;
- futuristic;
- premium;
- high-density when necessary, but never visually cramped;
- spacious enough to convey importance;
- strong in data visualization;
- rich in contextual intelligence;
- visually deeper than conventional SaaS dashboards.

The interface should evoke:

- enterprise command centers;
- institutional financial terminals;
- modern automotive HMI;
- aerospace control interfaces;
- Palantir-style operational systems;
- Ramp-style financial intelligence;
- premium next-generation enterprise software.

Avoid turning the system into a minimal, flat, overly compact Linear clone.

---

# 4. Design Philosophy

## 4.1 Do Not Remove Cards — Improve Their Architecture

Cards remain an important part of the Insight visual identity.

The problem is not card size.

The problem is:

- repetitive card structures;
- identical visual weight;
- excessive nested borders;
- mini-cards everywhere;
- too many small KPI blocks;
- too many pills and chips;
- too much information presented in the same visual pattern.

The solution is to create a **hierarchy of card types**.

### Hero Cards
Use for strategic, executive, financial, or portfolio-level information.

Recommended size:
- 380–520 px width;
- generous internal spacing;
- visualizations;
- large metrics;
- contextual insight;
- embedded actions.

### Operational Cards
Use for obligations, risks, approvals, billing, documents, and workflows.

Recommended size:
- 280–420 px width;
- medium-to-high information richness;
- operational state;
- actions;
- contextual detail.

### Micro Metrics
Use only for truly secondary indicators.

Do not turn every metric into a mini-card.

---

# 5. Visual Mass and Composition

The product should have controlled **visual mass**.

Large surfaces are desirable when they:

- establish hierarchy;
- provide operational context;
- contain meaningful visualization;
- improve scanning;
- create a premium perception.

Use:

- large glass surfaces;
- asymmetric grid compositions;
- embedded charts;
- ambient depth;
- strong typography;
- contextual panels;
- large numbers;
- visual breathing room.

Avoid:

- excessive tiny containers;
- card-inside-card-inside-card structures;
- repetitive 4-column KPI grids;
- unnecessary borders around every data point.

Preferred composition:

```text
SURFACE
├── Context
├── Visualization
├── Intelligence
└── Action
```

Avoid:

```text
CARD
└── CARD
    └── CARD
        └── BADGE
```

---

# 6. Glass / HUD System

The current dark + teal language is strong and should be preserved.

The next evolution should introduce a more sophisticated, layered glass/HUD system.

Recommended depth model:

```text
Background
↓
Ambient Glow
↓
Glass Surface
↓
Internal Gradient
↓
Subtle Grid / Noise Texture
↓
Content Layer
↓
Interactive Highlight
```

The effect must remain subtle.

Avoid excessive cyberpunk aesthetics.

The intended result is:

> **Advanced institutional technology**, not a neon sci-fi game interface.

---

# 7. Color Strategy

Suggested direction:

### Base
`#05090C`

### Surface 1
`#091116`

### Surface 2
`#0C171D`

### Elevated Glass
`rgba(15, 29, 35, 0.68)`

### Primary Teal
Use the current Insight teal family as the primary focus / active state color.

### Semantic Colors

**Emerald / Green**
- healthy;
- approved;
- completed;
- successful;
- compliant.

**Amber**
- attention;
- nearing deadline;
- moderate risk;
- pending action.

**Coral / Red**
- critical;
- overdue;
- high risk;
- blocked.

**Ice Blue**
- informational;
- neutral intelligence;
- forecasts.

**Subtle Violet**
- advanced intelligence;
- analytical layer;
- predictive or comparative outputs.

Important:

Teal must not be used as decoration everywhere.

Teal should communicate:
- Insight identity;
- active state;
- focus;
- selected navigation;
- system intelligence.

---

# 8. Typography

Increase typographic hierarchy.

Recommended ranges:

### Hero Metric
36–44 px

### Section / Portfolio Metric
28–36 px

### Card Metric
24–32 px

### Card Title
16–18 px

### Body
13–15 px

### Metadata
11–12 px

Large values should visually dominate when business importance is high.

Avoid making all information the same size.

---

# 9. Navigation Architecture

Current navigation is functionally complete, but it should be reorganized into a clearer operating model.

Recommended primary contract navigation:

1. **Command Center**
2. **Contratos**
3. **Obrigações**
4. **Financeiro**
5. **Renovações**
6. **Riscos**
7. **Documentos**
8. **Aprovações**
9. **Auditoria**

## 9.1 Remove “Análise IA” as a Primary Isolated Destination

AI should not feel like a separate feature.

AI should be embedded throughout the product.

Examples:

- Contract → automatic summary;
- Obligation → delay risk;
- Billing → inconsistency detection;
- Renewal → recommendation;
- Document → missing or conflicting evidence;
- Clause → legal/financial risk;
- Approval → decision context;
- Portfolio → anomaly detection.

The goal is to make the entire system feel intelligent.

---

# 10. Context-Aware Headers

The large global KPI panel should not remain identical across every tab.

Each area should have a contextual header.

## Command Center
Show:
- total exposure;
- billed;
- backlog;
- portfolio health;
- revenue at risk;
- critical actions.

## Financeiro
Show:
- planned;
- measured;
- approved;
- billed;
- received;
- blocked;
- overdue.

## Obrigações
Show:
- overdue;
- due soon;
- at risk;
- completed;
- SLA exposure.

## Renovações
Show:
- next 30 days;
- next 60 days;
- next 90 days;
- exposed value;
- decision status.

## Riscos
Show:
- risk exposure;
- high-risk contracts;
- legal exposure;
- financial exposure;
- monitored clauses.

## Documentos
Show:
- completeness;
- critical missing docs;
- expired docs;
- docs blocking billing.

This removes unnecessary repetition while keeping the interface rich and substantial.

---

# 11. Command Center — New Overview

The current overview should evolve into an executive and operational command surface.

Recommended structure:

```text
GESTÃO DE CONTRATOS
Portfolio Intelligence

[ HERO — CONTRACT PORTFOLIO ]

Total Exposure         Portfolio Health
R$ 1.5M                82

Executed               Billed
20%                    R$ 305.9K

Backlog                Revenue at Risk
R$ 1.2M                R$ 480K

[ Financial / Exposure / Forecast visualization ]

[ ACTION REQUIRED ]    [ NEXT 90 DAYS ]
Critical: 1            Milestones: 3
Attention: 3           Renewals: 2
Monitoring: 2          Exposure: R$ 420K
```

The hero area should feel visually strong and substantial.

---

# 12. Operational Intelligence / Attention Center

Replace many generic warning cards with an intelligence region.

Each item must include:

- severity;
- contract;
- problem;
- business impact;
- responsible area;
- time dimension;
- next action.

Example:

```text
CRITICAL

CTR-42ACE9
QA Contract Services

R$ 480K billing milestone overdue
52 days overdue
Contract health ↓ 12 pts

Financial exposure: R$ 480,000
Responsible: Finance

[ Review milestone ]
[ Open dossier → ]
```

The system should not merely say:

> “2 overdue obligations.”

It should explain:

> what is overdue, why it matters, and what to do next.

---

# 13. Contract Health Score

The Contract Health Score should become a central, explainable system capability.

Example:

```text
CONTRACT HEALTH
82 — HEALTHY

Financial      91
Compliance     84
Delivery       73
Legal          88
Documents      96
Approvals      79
```

The score should be clickable.

Example:

> Why is Delivery 73?

System response:

- 1 obligation overdue by 12 days;
- 1 evidence package not submitted;
- next measurement depends on that obligation;
- potential billing impact: R$ 480K.

This makes the score operationally meaningful.

---

# 14. Suggested Contract Health Model

Potential weighted dimensions:

- Financial execution;
- Billing readiness;
- Obligation compliance;
- Document completeness;
- Legal risk;
- Approval status;
- Project linkage;
- Renewal preparedness;
- SLA performance;
- Evidence quality;
- Risk severity.

The exact weights should be configurable by organization or contract type.

The UI should expose:
- score;
- trend;
- drivers;
- deteriorations;
- improvements;
- evidence.

---

# 15. Contracts Portfolio

The module should support multiple operating views.

Recommended view selector:

**Portfolio | Table | Cards | Risk Map**

## 15.1 Cards

Cards should remain prominent and visually rich.

Recommended card width:
350–420 px.

Example:

```text
CTR-42ACE9                         ● ACTIVE

QA CONTRACT SERVICES

CEMIG MODERNIZATION
────────────────────────────────────────

R$ 1.2M                 73
Exposure                Health

[ execution visualization ]

12%
Executed

R$ 143K                 R$ 1.1M
Billed                   Remaining

────────────────────────────────────────

⚠ 2 obligations
◉ 1 financial risk
□ 1 document

DOSSIER →
```

Cards should feel like compact instrument panels, not generic SaaS rectangles.

---

# 16. Smart Table

For large enterprise portfolios, the system must also have a powerful table view.

Recommended columns:

- Contract;
- Counterparty;
- Project;
- Health;
- Status;
- Total value;
- Billed;
- Remaining;
- Revenue at risk;
- Next milestone;
- Renewal date;
- Obligations;
- Documents;
- Risk;
- Responsible;
- Last activity.

Capabilities:

- sorting;
- filtering;
- saved views;
- column configuration;
- grouping;
- pinning;
- bulk actions;
- export;
- keyboard navigation;
- quick search;
- advanced filters.

Table mode should be designed for 50, 500, or 5,000 contracts.

---

# 17. Split View

Implement a split-view experience.

Left:
- contract list/table.

Right:
- contract quick dossier.

Example:

```text
CONTRACT LIST                 CONTRACT DOSSIER

CTR-42ACE9                    QA Contract Services
CTR-58021B                    Health 73
CTR-69B85F                    R$ 1.2M
CTR-06C9B7                    ----------------------
                              Summary
                              Risks
                              Financial
                              Obligations
                              Documents
```

This reduces context switching and allows rapid contract review.

---

# 18. Contract Dossier

Every contract should have a central dossier acting as the source of truth.

## Header Example

```text
CTR-42ACE9
Contrato de Serviços — Fornecedor QA Ltda.

ACTIVE · Health 73 · Medium Risk

Project
CEMIG-MOD-01

Value
R$ 1.2M

Term
13/05/2026 → 13/05/2027

Responsible
João Silva
```

Recommended internal navigation:

- Overview;
- Financial;
- Obligations;
- Clauses;
- Documents;
- Approvals;
- Risks;
- History.

---

# 19. Intelligence Side Panel

The contract dossier should have a contextual intelligence panel.

Example:

```text
INSIGHT INTELLIGENCE

3 items require attention

R$ 480K billing potentially delayed
Measurement Phase 1 expired on 12/07

1 overdue obligation
Delivery evidence pending

Renewal preparation
Recommended decision by 12/02/2027
```

This panel should dynamically change based on the active contract tab.

---

# 20. Ask Insight

Introduce a global intelligence command accessible from the Contracts module.

Example entry point:

`⌘K Ask Insight`

Example questions:

- Which contracts can block billing this month?
- Which CEMIG contracts have overdue obligations?
- Compare ENEL and CEMIG adjustment clauses.
- Show contracts expiring in 180 days with margin below 12%.
- Which contracts have financial exposure above R$ 500K?
- Which contracts have missing evidence?
- Which approvals have exceeded SLA?

Answer structure should include:

- direct response;
- supporting records;
- impact;
- evidence;
- links to relevant objects.

---

# 21. AI Explainability

AI output must never be a generic statement.

Avoid:

> AI detected high risk.

Prefer:

```text
PAYMENT CLAUSE RISK

Medium Risk
Confidence 87%

Reason
Payment term exceeds portfolio baseline.

Evidence
Clause 8.2 — page 14
Clause 8.4 — page 15

Estimated Impact
+15 days in cash conversion cycle

[ Open evidence ]
```

Every AI-generated output should support:

- source;
- page;
- clause;
- confidence;
- analysis timestamp;
- model/version;
- human validation state;
- audit trail.

Enterprise AI requires explainability and provenance.

---

# 22. Renewals — Renewal Pipeline

Replace a simple renewal list with a pipeline.

Example:

```text
180+ DAYS      120 DAYS      90 DAYS      60 DAYS      30 DAYS

CEMIG          ENEL          QA
R$ 40K         R$ 130K       R$ 1.2M
```

Each contract should have a recommendation:

- RENEW;
- RENEGOTIATE;
- REVIEW;
- DO NOT RENEW.

Supporting reasons may include:

- margin decline;
- poor SLA;
- repeated amendments;
- legal risk;
- project dependency;
- price deviation;
- performance history;
- financial attractiveness.

---

# 23. Renewal Intelligence

Example:

```text
RECOMMENDATION
RENEGOTIATE

Confidence: 84%

Drivers:
- Margin decreased 8.2%
- SLA performance remains 97%
- 3 amendments executed
- Price is 11% below portfolio benchmark
- Renewal window opens in 61 days
```

The user should be able to inspect the evidence behind each driver.

---

# 24. Obligations Control Tower

Transform the obligations page into a contract obligations control tower.

Primary status segmentation:

- Overdue;
- Due Soon;
- At Risk;
- On Track;
- Completed.

Recommended timeline visualization:

```text
JUL                     AUG                     SEP

● Measurement
  27 Jul
  OVERDUE

          ● Insurance
            22 Aug

                             ● Delivery Evidence
                               03 Sep
```

---

# 25. Predicted SLA Breach

The system should detect probable future delays.

Signals can include:

- responsible person has not started;
- dependent document missing;
- predecessor approval overdue;
- deadline approaching;
- previous delays;
- responsible team's historical performance;
- incomplete evidence;
- blocked project dependency.

Example:

```text
PREDICTED SLA BREACH

High probability
73%

Delivery Evidence
Due in 6 days

Drivers:
- prerequisite document missing
- responsible team has 3 open tasks
- previous obligation delayed 9 days
```

---

# 26. Financial / Contract-to-Cash

The financial area should go beyond planned vs billed.

Introduce a Contract-to-Cash flow.

Example:

```text
CONTRACTED
R$ 1.5M
   ↓
ELIGIBLE FOR MEASUREMENT
R$ 620K
   ↓
MEASURED
R$ 480K
   ↓
APPROVED
R$ 350K
   ↓
BILLED
R$ 305K
   ↓
RECEIVED
R$ 241K
```

This makes financial leakage immediately visible.

---

# 27. Revenue at Risk

Add a dedicated financial intelligence block.

Example:

```text
REVENUE AT RISK
R$ 480K

Primary Cause
Measurement overdue

Contract
CTR-42ACE9

Age
52 days

Next Action
Validate delivery evidence
```

The system should aggregate revenue at risk by:

- contract;
- project;
- client;
- business unit;
- responsible;
- reason;
- aging bucket.

---

# 28. Financial Visualizations

Preferred visualizations:

- Contract-to-Cash flow;
- cumulative billing curve;
- planned vs actual;
- cash realization curve;
- billing aging;
- revenue at risk;
- milestone waterfall;
- invoice readiness;
- exposure by client/project;
- payment term distribution.

Avoid generic pie charts.

---

# 29. Risk & Clause Intelligence

Risk should not be presented only as simple lists.

Introduce a risk matrix.

## Risk Exposure Matrix

X-axis:
Probability

Y-axis:
Impact

Each point:
- contract;
- clause;
- obligation;
- financial exposure.

Example:

```text
IMPACT
 ↑
 │                ● QA SLA
 │
 │      ● CEMIG
 │
 │                     ● ENEL Penalty
 └────────────────────────────→
           PROBABILITY
```

---

# 30. Clause Intelligence

Recommended clause categories:

- Responsibility;
- Penalties;
- SLA;
- Payment;
- Price Adjustment;
- Termination;
- Renewal;
- Guarantees;
- Insurance;
- Compliance;
- Confidentiality;
- Liability;
- Indemnification;
- Scope;
- Acceptance;
- Force Majeure.

The system should support portfolio comparison.

Example:

```text
PENALTY CLAUSE

QA Ltda.
10%

Portfolio Median
2%

Deviation
+8 pp

Risk
High
```

This is more valuable than merely displaying extracted clauses.

---

# 31. Document Intelligence

The Documents page should focus on compliance, not only files.

Create a document completeness model.

Example:

```text
DOCUMENT READINESS
93%

██████████████████░░

5 pending documents
2 can block billing
1 expires in 30 days
```

---

# 32. Document Compliance Matrix

Example:

| Contract | Signed | Insurance | Guarantee | Tax | Amendments |
|---|---:|---:|---:|---:|---:|
| QA | ✓ | ✓ | ⚠ | ✓ | ⚠ |
| CEMIG | ✓ | ✓ | ✓ | ✓ | ✓ |
| ENEL | ✓ | ⚠ | ✓ | ⚠ | ✓ |

The system should allow filtering by:

- missing;
- rejected;
- expired;
- expiring soon;
- blocking;
- pending approval.

---

# 33. Approvals

The approvals page should evolve from statuses into a decision journey.

Example:

```text
REQUESTED
   ✓
LEGAL
28h
   ✓
FINANCE
1112h ⚠
   ○
COMMITTEE
```

---

# 34. Approval Decision Context

Before approving, the user should see:

- financial impact;
- contract value;
- risk level;
- critical clauses;
- missing documents;
- obligations;
- project dependency;
- AI recommendation;
- previous approval history.

Example:

```text
DECISION CONTEXT

Financial Impact
R$ 1.2M

Risk
Medium

Pending Documents
2

Critical Clauses
1

Recommendation
Approve with reservation
```

This prevents blind approvals.

---

# 35. Audit Trail

Audit should become semantically rich.

Avoid:

> Legal Review

Prefer:

```text
Maria Santos reviewed Clause 7.2

Before
Penalty: 5%

After
Penalty: 2%

09/07/2026 · 16:13
```

Another example:

```text
Finance approved payment condition

Before
30 days

After
45 days

Approved by
Carlos Mendes
```

Audit should record:

- actor;
- timestamp;
- action;
- entity;
- before;
- after;
- source;
- approval context;
- AI involvement if applicable.

---

# 36. Modern Data Visualization System

Create a proprietary **Insight Data Visualization System**.

Avoid relying on generic SaaS chart patterns.

Recommended visual primitives:

## Exposure Arc
Shows:
- contracted;
- executed;
- billed;
- received.

## Contract Pulse
Timeline of:
- risk;
- billing;
- approval;
- obligation;
- document;
- amendment.

## Risk Constellation
Scatter / matrix for portfolio risk.

## Obligation Radar
Temporal obligation view.

## Revenue Pipeline
Simplified flow from contract to cash.

## Portfolio Health Bands
Distribution of contracts by health score.

## Renewal Horizon
Time-based renewal exposure.

## Clause Deviation Map
Portfolio clause comparison.

---

# 37. Asymmetric Grid System

Avoid uniform card grids.

Use editorial layouts.

Example:

```text
┌───────────────────────────────┬────────────────┐
│                               │                │
│ LARGE FINANCIAL GRAPH         │ RISK CARD      │
│                               │                │
├────────────────┬──────────────┴────────────────┤
│ OBLIGATIONS    │                               │
│                │ CONTRACT INTELLIGENCE         │
│                │                               │
└────────────────┴───────────────────────────────┘
```

The interface should feel intentionally composed, not template-generated.

---

# 38. Microinteractions

Use animation selectively.

Preferred libraries:
- Motion;
- GSAP;
- anime.js;
- react-spring.

Do not use all libraries simultaneously in the same component.

Recommended interactions:

## Contract Card Hover
- subtle border illumination;
- slight depth increase;
- health composition reveal;
- mini-chart animation;
- secondary actions appear;
- subtle background response.

## Contract Open
Use shared-layout transition:
- card expands into dossier;
- context preserved.

## Intelligence Alerts
- severity edge highlight;
- non-intrusive pulse only when newly critical.

## Charts
- smooth reveal;
- hover crosshair;
- contextual tooltip;
- no decorative motion without meaning.

Avoid:
- particles;
- permanent neon;
- excessive glow;
- distracting parallax;
- animation that delays interaction.

---

# 39. Responsive Behavior

Desktop remains the primary enterprise environment.

Recommended design targets:

- 1440 px;
- 1600 px;
- 1920 px.

For narrower screens:

- preserve information hierarchy;
- collapse secondary intelligence to drawer;
- reduce side-by-side panels;
- keep main operational action visible;
- avoid shrinking cards until readability is lost.

The module should not become overly dense on smaller desktop widths.

---

# 40. Empty States

Empty states should not look generic.

Instead of:

> No obligations found.

Use:

```text
No obligations require attention.

All mapped obligations are currently on track.

Next critical milestone:
22 Aug 2026 · Insurance renewal
```

Empty states should preserve intelligence.

---

# 41. Loading States

Avoid full-page spinners.

Use:

- skeleton surfaces;
- chart placeholders;
- progressive hydration;
- preserved page geometry.

High-value content should load first:

1. contract identity;
2. critical actions;
3. financial exposure;
4. obligations;
5. risk;
6. secondary analytics.

---

# 42. Command Palette

Add a global command palette.

Example:

`⌘K`

Commands:

- Open contract;
- Search counterparty;
- Create contract;
- Upload document;
- Add obligation;
- Start approval;
- Ask Insight;
- Find overdue obligations;
- Find expiring contracts;
- Open revenue at risk;
- Export portfolio.

---

# 43. Search

Search must support:

- contract ID;
- counterparty;
- project;
- clause;
- document;
- responsible person;
- amount;
- obligation;
- approval;
- risk;
- natural language.

Example:

> ENEL contracts with missing fiscal documents

---

# 44. Saved Views

Enterprise users should save views.

Examples:

- My contracts;
- Contracts at risk;
- Billing blocked;
- Renewals next 90 days;
- Legal review pending;
- Missing guarantees;
- ENEL portfolio;
- CEMIG portfolio;
- High-value contracts;
- Obligations due this week.

---

# 45. Notifications

Notifications must be contextual.

Avoid:

> Contract alert.

Prefer:

```text
CTR-42ACE9
Billing milestone became overdue.

Exposure
R$ 480K

Owner
Finance

[ Review ]
```

Notification severity should be tied to business impact.

---

# 46. Backend Domain Architecture

Do not treat contracts as a single database table.

Recommended domain model:

```text
Contract
├── ContractVersion
├── Counterparty
├── ProjectLink
├── Clause
├── Obligation
├── Milestone
├── BillingEvent
├── Renewal
├── Document
├── ApprovalWorkflow
├── Risk
├── Analysis
└── AuditEvent
```

---

# 47. Contract Entity

Suggested responsibilities:

```text
Contract
- id
- code
- title
- type
- status
- counterparty_id
- owner_id
- organization_id
- start_date
- end_date
- total_value
- currency
- health_score
- risk_level
- created_at
- updated_at
```

Avoid storing derived portfolio intelligence directly unless needed for performance.

---

# 48. Contract Versioning

Every meaningful contract modification should create or reference a version.

```text
ContractVersion
- id
- contract_id
- version_number
- document_id
- effective_date
- created_by
- change_reason
- source
- created_at
```

The system should allow:

- comparison between versions;
- audit of clause changes;
- financial delta;
- approval trace.

---

# 49. Clause Model

```text
Clause
- id
- contract_version_id
- category
- title
- extracted_text
- normalized_value
- risk_level
- confidence
- source_page
- source_location
- reviewed_by
- review_status
```

---

# 50. Obligation Model

```text
Obligation
- id
- contract_id
- clause_id
- title
- description
- owner_id
- department_id
- due_date
- status
- priority
- financial_impact
- evidence_required
- completed_at
```

---

# 51. Billing Event Model

```text
BillingEvent
- id
- contract_id
- milestone_id
- title
- planned_amount
- planned_date
- measured_amount
- approved_amount
- billed_amount
- received_amount
- status
- blocking_reason
```

---

# 52. Approval Workflow Model

```text
ApprovalWorkflow
- id
- contract_id
- workflow_type
- status
- initiated_by
- initiated_at
- completed_at

ApprovalStep
- id
- workflow_id
- sequence
- role
- assignee_id
- status
- sla_hours
- started_at
- completed_at
- decision
- comments
```

---

# 53. Risk Model

```text
Risk
- id
- contract_id
- clause_id
- category
- severity
- probability
- impact
- exposure_amount
- source
- status
- mitigation_owner
- mitigation_plan
```

---

# 54. Analysis Model

```text
Analysis
- id
- contract_id
- analysis_type
- model_version
- confidence
- summary
- evidence
- created_at
- validated_by
- validation_status
```

---

# 55. Event-Driven Architecture

Important contract events should generate domain events.

Recommended examples:

```text
contract.created
contract.updated
contract.signed
contract.version.created
contract.health.changed

document.uploaded
document.approved
document.rejected
document.expiring
document.missing

obligation.created
obligation.due_soon
obligation.overdue
obligation.completed

billing.ready
billing.blocked
billing.measured
billing.approved
billing.invoiced
billing.received

approval.requested
approval.step_completed
approval.overdue
approval.completed
approval.rejected

renewal.window_opened
renewal.recommendation_changed
renewal.approved
renewal.declined

risk.detected
risk.escalated
risk.mitigated

analysis.completed
analysis.validated
```

---

# 56. Why Event-Driven Matters

A contract event stream enables:

- notifications;
- automations;
- audit;
- intelligence;
- health scores;
- workflow triggers;
- predictive models;
- dashboards;
- reporting;
- SLA tracking;
- anomaly detection.

Avoid implementing duplicate business logic independently inside each screen.

---

# 57. Intelligence Layer

Recommended intelligence architecture:

```text
Operational Data
↓
Domain Events
↓
Rules Engine
↓
Derived Signals
↓
Contract Health
↓
Recommendations
↓
AI / Semantic Analysis
↓
Human Validation
↓
Audit
```

Rules and deterministic logic should handle what can be known deterministically.

AI should handle:

- summarization;
- extraction;
- semantic comparison;
- anomaly interpretation;
- natural language interaction;
- clause interpretation assistance.

Do not use AI where a deterministic rule is more appropriate.

---

# 58. Governance

Every high-impact AI or automated decision should support human validation.

Recommended states:

- Suggested;
- Needs Review;
- Validated;
- Rejected;
- Superseded.

High-impact outputs should never silently alter contractual truth.

---

# 59. Permissions / RBAC

Contracts require granular permissions.

Suggested scopes:

```text
contracts.view
contracts.create
contracts.edit
contracts.archive

contracts.documents.view
contracts.documents.upload
contracts.documents.approve

contracts.obligations.view
contracts.obligations.manage

contracts.financial.view
contracts.financial.manage

contracts.risk.view
contracts.risk.manage

contracts.approvals.request
contracts.approvals.approve

contracts.audit.view

contracts.ai.use
contracts.ai.validate
```

Permissions should support:
- organization;
- business unit;
- project;
- contract;
- department;
- role.

---

# 60. Auditability

Critical actions must be auditable.

Log:

- actor;
- timestamp;
- IP/device where relevant;
- entity;
- previous state;
- new state;
- source;
- approval;
- AI recommendation used;
- human confirmation;
- document version.

---

# 61. Performance

The dashboard should remain fast even with large portfolios.

Recommended strategy:

- server-side aggregation;
- materialized summaries where justified;
- indexed contract metrics;
- lazy-load secondary analytics;
- pagination / virtualization for large tables;
- cache expensive portfolio calculations;
- precompute health signals;
- asynchronous document analysis.

---

# 62. Portfolio Aggregates

Consider dedicated read models for:

```text
contract_portfolio_summary
contract_financial_summary
contract_risk_summary
contract_obligation_summary
contract_document_summary
contract_renewal_summary
```

These should be read-optimized.

Do not overload the transactional contract table with dashboard concerns.

---

# 63. Accessibility

Futuristic design must remain accessible.

Requirements:

- minimum AA contrast;
- status not communicated only by color;
- keyboard navigation;
- visible focus states;
- semantic labels;
- chart descriptions;
- screen reader support;
- reduced-motion support.

---

# 64. Things to Avoid

Do not introduce:

- excessive neon;
- permanent glow;
- large amounts of purple/blue “AI gradient”;
- generic sparkles;
- 3D icons without meaning;
- decorative gauges;
- too many rounded pills;
- excessive nested borders;
- mini-card overload;
- identical cards everywhere;
- generic pie charts;
- empty AI claims;
- arbitrary animations;
- over-compact layouts;
- huge whitespace with little information;
- futuristic visuals that reduce usability.

---

# 65. Target Experience

The user should feel they are operating:

> **A contract control room with financial, legal, operational, and governance intelligence.**

The system should feel:

- powerful;
- serious;
- fast;
- precise;
- visually advanced;
- explainable;
- auditable;
- scalable.

---

# 66. Priority Roadmap

## P0 — Structural UX

- Introduce contextual headers;
- reduce repetitive KPI grids;
- redesign Command Center;
- establish card hierarchy;
- implement Smart Table;
- implement Split View;
- create Contract Dossier;
- improve navigation structure.

## P1 — Operational Intelligence

- Contract Health;
- Attention Center;
- Revenue at Risk;
- contextual Intelligence Panel;
- document completeness;
- richer audit events.

## P2 — Operational Control

- Obligations Control Tower;
- Contract-to-Cash;
- Renewal Pipeline;
- Approval Journey;
- Risk Exposure Matrix;
- Clause Intelligence.

## P3 — Advanced Intelligence

- Ask Insight;
- cross-contract clause comparison;
- predictive SLA breach;
- anomaly detection;
- renewal recommendations;
- predictive revenue risk;
- portfolio benchmarking.

---

# 67. Suggested First Implementation Slice

Build the first high-impact version around one complete contract workflow.

Recommended reference contract:
`CTR-42ACE9`

Implement:

1. Contract Dossier;
2. Contract Health;
3. Financial Exposure;
4. Obligations;
5. Documents;
6. Approvals;
7. Risks;
8. Audit;
9. Intelligence Panel.

Once the component system is validated, expand to the portfolio level.

This avoids redesigning the entire module before validating the new architecture.

---

# 68. Design System Components

Recommended reusable components:

```text
ContractHero
PortfolioExposureCard
ContractHealthCard
RevenueAtRiskCard
AttentionItem
ContractInstrumentCard
ContractSmartTable
ContractQuickDossier
ContractDossierHeader
IntelligencePanel
ObligationTimeline
ObligationStatusRail
RenewalPipeline
RenewalRecommendation
ContractToCashFlow
RiskExposureMatrix
ClauseComparisonCard
DocumentReadinessCard
DocumentComplianceMatrix
ApprovalJourney
DecisionContext
AuditTimeline
EvidenceViewer
AIConfidenceBadge
SourceReference
CommandPalette
SavedViewSelector
ContextualModuleHeader
```

---

# 69. Card Interaction States

Every card should define:

- Default;
- Hover;
- Focus;
- Selected;
- Critical;
- Disabled;
- Loading;
- Empty.

Selected contract cards may use:
- subtle edge glow;
- slightly elevated background;
- highlighted side rail.

Do not turn the whole card into a glowing neon block.

---

# 70. Design Token Direction

Suggested token families:

```text
--surface-base
--surface-raised
--surface-glass
--surface-interactive

--border-subtle
--border-active
--border-critical

--text-primary
--text-secondary
--text-muted

--accent-primary
--accent-info
--accent-success
--accent-warning
--accent-critical
--accent-intelligence

--shadow-low
--shadow-medium
--shadow-high

--glow-active
--glow-critical
--glow-intelligence
```

---

# 71. Information Hierarchy Rule

Every surface should have no more than one primary message.

Example:

A Financial Exposure card's primary message is:

> How much money is exposed?

Secondary:
- billed;
- backlog;
- trend.

Tertiary:
- metadata.

Avoid putting five equal-priority messages inside a single card.

---

# 72. Data Density Rule

The UI should be visually substantial without being noisy.

Use density strategically:

### High-density areas
- tables;
- audit;
- portfolio review;
- obligations lists.

### Medium-density areas
- contract dossier;
- approvals;
- risk analysis.

### Low-density / high-impact areas
- hero metrics;
- critical attention;
- revenue at risk;
- portfolio health.

---

# 73. Futuristic UI Rule

Futurism must come from:

- information architecture;
- motion;
- intelligent behavior;
- data visualization;
- dynamic context;
- responsive surfaces;
- depth;
- real-time states.

Not from:
- random neon;
- decorative grids;
- excessive glow;
- sci-fi ornament.

---

# 74. Enterprise UX Rule

Every important action should show consequences.

Before:
- approve;
- reject;
- renew;
- terminate;
- alter value;
- close obligation;
- mark billing milestone complete.

Show:

- affected contract;
- financial impact;
- workflow consequence;
- dependencies;
- audit consequence.

---

# 75. Final Product Principle

The design target is not:

> A prettier contract dashboard.

The design target is:

> **An intelligent enterprise command center that continuously interprets contractual, financial, operational, legal, and governance signals and transforms them into prioritized action.**

The interface should preserve the strong Insight Energy visual identity while evolving toward a more sophisticated, asymmetric, layered, data-rich, futuristic experience.

The final product should feel like a system used to **operate a company**, not simply observe it.
