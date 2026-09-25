# Insight Apex — Operations Domain
## Service Orders, Projects, Operations Map, Planning, Measurements

---

## 1. Domain purpose

Operations translates **authorized commercial work** into **planned, resourced and measurable execution**.

It must answer:

- What are we authorized to execute?
- Where?
- When?
- Who is responsible?
- Which activities and dependencies exist?
- What resources/materials are required?
- What is blocked or at risk?
- What has actually been executed?
- What evidence supports measurement and billing?

---

## 2. Navigation

```text
Operações
├── Visão Geral
├── Ordens de Serviço
├── Projetos
├── Mapa de Operações
├── Planejamento
└── Medições & Evidências
```

Do not add separate sidebar entries for every execution object.

---

# 3. Operations Overview

The Operations Overview is an exception/control surface, not a decorative dashboard.

Suggested sections:

### KPI strip

- Projetos ativos
- OS aguardando emissão
- Atividades críticas
- Projetos em risco
- Pendências de medição
- Demandas de material sem cobertura

### Decision / attention queue

Examples:

- OS with blocking divergence;
- project lacking execution readiness;
- critical activity due without required material;
- measurement awaiting evidence;
- operational risk without owner;
- overdue customer dependency.

### Near-term execution

- next 7/14/30 days;
- critical project milestones;
- upcoming material need dates;
- workforce/equipment conflicts.

### Geographic view shortcut

Summary linked to Operations Map.

---

# 4. Internal Service Orders

## 4.1 Purpose

The Internal Service Order (OS) is the governed handoff from Commercial to Operations.

It is **not** the customer's PO, authorization letter, contract or external work order.

External documents are authorization sources/evidence. The Apex Internal OS is the company's internal operational authorization.

## 4.2 Creation paths

### Path A — Generate from proposal context

```text
Accepted / authorized PT+PC package
→ Generate Internal OS draft
→ Review
→ Resolve divergences
→ Issue
→ Create/link Project
```

Autofill from governing documents:

**PT primarily supplies:**

- scope;
- deliverables;
- activities;
- technical requirements;
- assumptions;
- exclusions;
- tests;
- customer dependencies;
- likely materials/equipment where supported.

**PC primarily supplies:**

- commercial value;
- validity/accepted commercial package metadata;
- payment/commercial conditions relevant to execution;
- measurement/billing rules;
- customer commercial constraints.

### Path B — Upload existing internally-created OS

```text
Upload OS PDF
→ canonical document storage
→ extraction
→ candidate field review
→ compare OS × governing PT × governing PC
→ confirm
→ issue / link project
```

AI extraction must preserve page/quote provenance where feasible.

## 4.3 Canonical OS capabilities

Minimum concepts:

- OS number;
- organization;
- customer/account;
- proposal context;
- governing PT/PC revision snapshot/reference;
- authorization source;
- title / work package;
- location/site;
- scope;
- activities;
- deliverables;
- dates;
- owner/responsible team;
- requirements;
- customer dependencies;
- commercial references;
- divergences;
- source documents;
- status;
- audit trail.

## 4.4 Suggested lifecycle

Do not create this enum blindly; inspect existing workflow first.

Conceptually:

```text
DRAFT
→ UNDER_REVIEW
→ READY_TO_ISSUE
→ ISSUED
→ PROJECT_LINKED
→ CLOSED / CANCELLED
```

Important invariants:

- an OS cannot be issued with unresolved **blocking** divergences unless a governed exception path explicitly permits it;
- an issued OS should be immutable in material fields; changes create revision/amendment history, not silent rewrites;
- project creation/linking is idempotent;
- OS retains exact upstream proposal/authorization provenance.

## 4.5 Divergence engine

Compare uploaded/generated OS against commercial truth.

Categories:

- scope;
- deliverables;
- dates;
- technical requirements;
- materials;
- customer dependencies;
- exclusions;
- measurement conditions;
- commercial references.

Severity:

- INFO;
- WARNING;
- BLOCKING.

AI may identify candidate divergence. Human/policy confirms whether it is operationally binding when necessary.

---

# 5. Project workspace

## 5.1 Principle

A Project is the execution context, not a data silo.

The Project screen should aggregate canonical objects from other domains.

## 5.2 Target tabs

```text
Projeto
├── Visão Geral
├── Cronograma / Planejamento
├── Financeiro
├── Contexto Contratual
├── Medições & Evidências
├── Timeline
├── Riscos
├── Documentos
├── Equipe
├── Apontamento
└── Materiais & Supply
```

### Visão Geral

Show:

- project health;
- current phase;
- critical blockers;
- next milestones;
- measurements pending;
- supply risk;
- team status;
- major contractual/financial exposure.

### Cronograma / Planejamento

Use the canonical schedule/execution plan.

Capabilities:

- activities/work packages;
- dependency relationships;
- planned dates;
- actual dates;
- milestones;
- progress;
- readiness;
- requirements;
- resource needs;
- customer dependencies;
- links to measurement events.

Preserve the existing principle that measurement events appear visibly linked beneath/with the relevant schedule line where applicable.

### Financeiro

Contextual project finance only; reuse Finance truth.

Examples:

- contracted/authorized value;
- measured;
- accepted;
- billed;
- received;
- committed cost;
- actual cost;
- forecast;
- margin/exposure when permission allows.

Financial data must remain hidden from unauthorized users.

### Contexto Contratual

Aggregate:

- governing commercial engagement;
- proposal package;
- contract if one exists;
- amendments;
- obligations;
- relevant clauses;
- customer authorizations;
- internal OS.

Do not assume formal contract always exists.

### Medições & Evidências

Reuse canonical project measurement IDs/documents.

Show:

- measurement events;
- evidence completeness;
- submission status;
- internal review;
- customer response;
- billing eligibility.

Do not create a second measurement workflow.

### Timeline

One chronological stream of material project events:

- OS issuance;
- project creation;
- schedule changes;
- risk events;
- document issuance;
- team allocation;
- material reservation;
- purchase/receipt events;
- measurements;
- approvals;
- customer responses;
- billing events.

### Riscos

Canonical operational risk register linked to:

- activity;
- project;
- supplier/material;
- contract/obligation;
- financial impact;
- mitigation owner.

### Documentos

Canonical document repository filtered to project context.

Do not duplicate stored files.

### Equipe

Show allocations, responsible people, competency/role context and availability where supported.

### Apontamento

Contextual view of attendance/time/evidence already captured by the platform.

Avoid parallel timekeeping logic if attendance domain already exists.

### Materiais & Supply

Show project demand and supply coverage:

- required;
- available;
- reserved;
- transferred;
- purchased;
- in transit;
- received;
- consumed;
- shortage;
- critical material risks.

---

# 6. Planning

## 6.1 Planning is not a legacy factory PCP screen

Use **Planejamento** as the product term.

The canonical model should support project/service execution as well as future manufacturing-like planning if needed.

## 6.2 Planning hierarchy

```text
Project
→ Execution Plan
→ Work Package / Activity
→ Requirement
```

Requirement types can include:

- MATERIAL;
- EQUIPMENT;
- VEHICLE;
- WORKFORCE;
- EXTERNAL_SERVICE;
- DOCUMENT;
- CUSTOMER_DEPENDENCY;
- OTHER.

## 6.3 Requirement minimum fields

- organization;
- project;
- activity/work package;
- requirement type;
- canonical item/resource reference when applicable;
- quantity/unit;
- required-by date;
- location/site;
- priority/criticality;
- source/provenance;
- status/readiness;
- notes/constraints.

## 6.4 Planning states

Avoid unnecessary workflow complexity.

At minimum the system must distinguish:

- planned requirement;
- confirmed requirement;
- covered/supplied;
- partially covered;
- shortage;
- cancelled/superseded.

Prefer derived coverage status from Supply Chain rather than manually editable duplicated status.

## 6.5 Planning UX

Primary views:

- timeline/Gantt;
- activity table;
- readiness matrix;
- requirements by date;
- constraints;
- resource/material coverage;
- critical path / risk.

Apex Intelligence should surface exceptions such as:

- activity starts before critical material arrival;
- workforce overlap;
- customer dependency overdue;
- required document missing;
- planned measurement event lacks required evidence path.

---

# 7. Operations Map

## 7.1 Purpose

A geographic operational control surface.

Potential layers:

- active projects;
- active service orders;
- project sites;
- warehouses;
- teams where authorized;
- vehicles where authorized;
- geofences;
- material movements;
- operational incidents/alerts.

## 7.2 Existing data reuse

Inspect and reuse existing:

- project geofences;
- attendance punches;
- location evidence;
- fleet/vehicle location capabilities if available.

Do not create redundant coordinates/evidence stores.

## 7.3 UX

Map + synchronized side panel.

Filters:

- project;
- region;
- customer;
- risk;
- status;
- team;
- supply alert.

Clicking a project should reveal:

- current execution status;
- next milestone;
- team;
- supply blocker;
- operational alerts;
- link to project workspace.

---

# 8. Measurements & Evidence

Keep the existing canonical workflow and strengthen contextual integration.

The global Operations screen should answer:

- what is ready for evidence;
- what evidence is missing;
- what is awaiting internal review;
- what was returned;
- what is awaiting customer acceptance;
- what became billing eligible.

Do not conflate:

`APPROVED_FOR_CUSTOMER` with `CUSTOMER_ACCEPTED`.

Global screen = portfolio queue.  
Project tab = project context.  
Same IDs and same source of truth.

---

# 9. Operations acceptance criteria

1. Authorized proposal context can produce/import a governed OS.
2. Uploaded OS extraction preserves document provenance.
3. OS can be compared against governing PT/PC.
4. Blocking divergence prevents normal issuance.
5. Issued OS creates/links a project idempotently.
6. Project workspace aggregates existing canonical domains.
7. Planning produces dated requirements.
8. Materials & Supply shows real supply coverage, not duplicated manual totals.
9. Operations Map reuses canonical geospatial evidence.
10. Measurements remain one canonical workflow.
11. Protected fields respect existing RBAC/RLS.
12. Every material transition has audit evidence.

