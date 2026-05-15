# Finance AI Copilot Plan

## Objective

The Finance AI must not be designed as a limited risk scanner only.

## Answers to Implementation Questions

### (a) Finance entity
Use `finance_entries` as the main entity for Phase 1.

Do not scan `payroll` in Phase 1. Payroll will require a dedicated scanner later.

### (b) Projects scan scope
Scan the full project first.

If milestones exist, use them as supporting evidence, but keep the main scanner project-level:

POST /api/ai/risk-scan/projects/[id]

### (c) Dismiss AI alert behavior
Use a separate `ai_dismissed` flag.

Do not use `status='closed'` for dismissed AI suggestions.

`closed` means the risk was treated/resolved.
`ai_dismissed` means the AI suggestion was rejected.

It must be structured as a **Financial Intelligence Copilot**: an executive financial intelligence layer capable of analyzing finance entries, P&L, forecast, budget vs actuals, accounts payable/receivable, contracts, projects, cost centers, and cash flow to generate alerts, explanations, simulations, and recommendations.

Implementation must be incremental, but the architecture must be prepared from the beginning for the complete roadmap.

---

## Main Role

The Finance AI should help leadership understand:

- what happened;
- why it happened;
- what can happen next;
- what financial risks are emerging;
- what decisions should be considered.

The AI should turn financial data into executive insight, not just generate generic chat responses.

---

## Expected Capabilities

### 1. AI Risk Scanner

Automatically detect financial risks such as:

- abnormal finance entries;
- supplier without linked contract;
- atypical due dates;
- possible duplicate entries;
- expense without project or cost center;
- cost center exceeding budget;
- project with negative margin risk;
- payment or receivable concentration;
- recurring delays or delinquency.

---

### 2. AI Variance Analysis

Explain deviations between budget, actuals, and forecast:

- revenue variance;
- direct cost variance;
- OPEX variance;
- margin variance;
- EBITDA variance;
- variance by project;
- variance by client;
- variance by cost center;
- variance by supplier.

Example output:

> The negative margin variance was mainly driven by increased mobilization costs in Project X and delayed receivables from Client Y.

---

### 3. AI KPI Explanation

Each financial KPI should be explainable by AI:

- Revenue;
- EBITDA;
- Margin;
- Cash;
- Burn rate;
- Forecast;
- Budget vs Actual;
- Accounts Payable;
- Accounts Receivable;
- Financially critical projects.

The output should be:

- short;
- executive;
- actionable;
- based on system data.

---

### 4. AI Forecast & Scenario Simulator

The AI should support forecast and scenario simulation:

- base case;
- conservative case;
- optimistic case;
- stress case;
- impact of delayed receivables;
- impact of cost increase;
- impact of new hires;
- impact of supplier renegotiation;
- impact of project delays.

Important rule:

The AI must not invent numbers. It must use system data and explicitly state assumptions when needed.

---

### 5. AI Cash Flow Intelligence

The AI should analyze cash flow:

- cash shortage risk;
- payment concentration;
- receivable concentration;
- critical weeks;
- working capital needs;
- client payment delays;
- 30/60/90-day cash projection.

---

### 6. AI Classification Assistant

The AI should suggest finance entry classification:

- financial category;
- cost center;
- linked project;
- linked contract;
- supplier;
- expense nature;
- recurrence;
- classification confidence.

This is not Phase 1, but the architecture must allow this capability later.

---

### 7. AI Contract-to-Finance Intelligence

The AI should connect contracts to finance:

- extract installments;
- due dates;
- adjustments/indexation;
- penalties;
- payment triggers;
- financial obligations;
- penalty risk;
- forecast impact;
- link to accounts payable/receivable.

---

### 8. AI Board Briefing

The AI should generate an executive financial briefing for leadership and committees:

- period summary;
- main variances;
- main risks;
- attention points;
- recommendations;
- suggested decisions;
- impact on cash, margin, and projects.

This briefing should later feed:

- reports;
- meetings;
- minutes;
- executive dashboard;
- PDF exports.

---

## Implementation Phases

### Phase 1 — Now

Implement only:

- AI Risk Scanner for `finance_entries`;
- AI Risk Scanner for `projects`;
- “AI Alerts” tab/filter in `/riscos`;
- AI metadata persistence:
  - `origin='ai'`
  - `source_module`
  - `source_entity_id`
  - `ai_confidence`
  - `ai_rationale`
  - `ai_analyzed_at`
- AI dismissal flow using `ai_dismissed`, not `status='closed'`.

Dismissal fields:

- `ai_dismissed`
- `ai_dismissed_at`
- `ai_dismissed_by`
- `ai_dismissal_reason`

Rules:

- `closed` means a risk was treated or resolved.
- `ai_dismissed` means an AI suggestion was rejected.
- These concepts must remain separate.

---

### Phase 2

Implement:

- AI KPI Explanation;
- AI Variance Analysis;
- executive finance summary by period;
- AI insight cards inside Finance pages.

---

### Phase 3

Implement:

- AI Forecast & Scenario Simulator;
- Cash Flow Intelligence;
- automatic scenario generation.

---

### Phase 4

Implement:

- automatic finance entry classification;
- Contract-to-Finance Intelligence;
- Board Briefing;
- PDF export.

---

## Desired Architecture

Create a generic AI Finance Engine layer, not isolated scanner files only.

Preferred structure:

```txt
src/lib/ai/finance/
  finance-risk-scanner.ts
  finance-variance-analyzer.ts
  finance-kpi-explainer.ts
  finance-forecast-simulator.ts
  finance-cashflow-analyzer.ts
  finance-classification-assistant.ts
  finance-board-briefing.ts
  schemas.ts
  prompts.ts
  types.ts
```
