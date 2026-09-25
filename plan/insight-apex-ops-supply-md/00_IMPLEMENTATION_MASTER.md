# Insight Apex — Operações + Supply Chain
## Implementation Master Plan

**Status:** implementation specification  
**Scope:** new Operations and Supply Chain architecture  
**Product direction:** autonomous enterprise operating system; transactional discipline + operational intelligence + governed actions.

---

## 1. Objective

Implement the next major Apex domains without turning the product into a menu-heavy legacy ERP.

The platform must combine:

- **transactional rigor:** canonical records, state machines, RBAC/RLS, audit, idempotency, tenant isolation;
- **operational context:** projects, activities, requirements, inventory, suppliers, purchase orders, receipts and financial consequences connected as one graph;
- **autonomy:** Apex observes, infers, plans, recommends, acts under policy, verifies and escalates exceptions.

The user should progressively govern **decisions and exceptions**, not manually maintain every record.

---

## 2. Navigation target

### Operações

- Visão Geral
- Ordens de Serviço
- Projetos
- Mapa de Operações
- Planejamento
- Medições & Evidências

### Supply Chain

- Visão Geral
- Planejamento de Materiais
- Estoque
- Compras
- Fornecedores
- Recebimentos & Logística

Do **not** expose implementation entities as top-level menu items. Requisitions, RFQs, quotes, reservations, transfers and receipts can be tabs/workspaces inside the domain screens.

---

## 3. Project workspace target

`Operações → Projetos → [Projeto]`

Keep or implement the following internal work areas:

1. Visão Geral
2. Cronograma / Planejamento
3. Financeiro
4. Contexto Contratual
5. Medições & Evidências
6. Timeline
7. Riscos
8. Documentos
9. Equipe
10. Apontamento
11. Materiais & Supply

The project workspace is a **contextual view over canonical domain data**. Do not duplicate Finance, Contracts, Measurements, HR/Attendance or Supply Chain state inside project-specific tables merely to render the project screen.

---

## 4. Golden operational path

```text
Commercial proposal context (PT + PC)
        ↓
Customer authorization / accepted governing package
        ↓
Internal Service Order
        ↓
Project
        ↓
Execution Plan
        ↓
Activities / Requirements
        ↓
Material / Resource Demand
        ↓
Supply Planning
        ↓
Reserve | Transfer | Buy | External Service
        ↓
Procurement / Logistics / Receiving
        ↓
Execution
        ↓
Measurements & Evidence
        ↓
Customer acceptance
        ↓
Billing eligibility
        ↓
Fiscal / Receivable / Cash
```

The chain must be traceable in both directions.

Example question the data model must support:

> Why did we buy this material?

Answer path:

```text
Purchase Order
→ Purchase Requisition
→ Supply Requirement
→ Project Requirement
→ Project Activity
→ Service Order
→ Proposal Context
→ PT / PC governing revisions
```

---

## 5. Non-negotiable architecture rules

### 5.1 Canonical truth

Never create a second state machine when a canonical entity already exists.

Before adding a table, route, service or enum:

1. inspect current migrations and schema;
2. inspect existing services/read models;
3. identify whether an existing canonical entity can be extended;
4. document why a new canonical entity is required.

### 5.2 No silent AI truth

AI may:

- extract;
- classify;
- compare;
- infer;
- recommend;
- pre-fill;
- simulate;
- explain;
- create governed drafts/actions where policy explicitly allows.

AI may **not** silently create:

- customer acceptance;
- internal approval;
- billing eligibility;
- stock consumption;
- goods receipt;
- supplier invoice validation;
- execution authorization;
- any other legally/financially material truth.

### 5.3 Tenant isolation

Every canonical record must be coherently bound to the same organization/tenant. Cross-tenant joins and references must be prevented at database level wherever practical.

### 5.4 Audit and provenance

Critical transitions must record:

- entity;
- previous state;
- new state;
- actor;
- timestamp;
- reason/evidence;
- source/path;
- related object IDs.

### 5.5 Idempotency

Actions such as:

- create project from OS;
- create purchase requisition from shortage;
- create PO from approved sourcing decision;
- create receipt from provider event;

must be safe to retry.

### 5.6 Derived metrics, not duplicated totals

Availability, shortage, reserved quantity, committed spend and project supply exposure should be derived from canonical ledgers/transactions whenever possible.

---

## 6. Implementation sequencing

### Phase A — Discovery and boundary map

Before coding:

- map existing Project, Contract, Measurement, Document, HR/Attendance, Fleet, Finance and Commercial entities;
- map existing routes/services/read models;
- identify what can be reused;
- identify migration collisions;
- produce a short boundary report.

Do not modify production data in discovery.

### Phase B — Operations shell + Service Orders

Implement:

- menu/navigation;
- Operations Overview shell;
- Service Order canonical domain;
- upload existing internal OS;
- extraction/review;
- generate OS from accepted PT+PC package;
- OS ↔ proposal context provenance;
- OS ↔ project handoff.

### Phase C — Project workspace consolidation

Implement project workspace/read models for:

- financial;
- contractual context;
- measurements/evidence;
- timeline;
- risks;
- documents;
- team;
- attendance/time entries;
- materials/supply.

Prefer aggregation over duplication.

### Phase D — Planning foundation

Implement:

- execution plans;
- activities/work packages;
- dependencies;
- resource/material requirements;
- required-by dates;
- operational constraints;
- planning status/readiness.

### Phase E — Operations Map

Implement geospatial operational control for:

- projects;
- active service orders;
- teams;
- vehicles where authorized;
- warehouses/stock locations;
- operational alerts.

Reuse existing geofence/location evidence where possible.

### Phase F — Supply Chain foundation

Implement:

- Supply Chain Overview;
- Material Planning;
- material master / canonical items;
- supply requirements;
- shortage calculation;
- supply strategy abstraction.

### Phase G — Inventory

Implement:

- inventory locations;
- inventory ledger;
- availability;
- reservations;
- transfers;
- project/task allocation;
- consumption/returns;
- inventory audit/counting foundations.

### Phase H — Procurement

Implement:

- purchase requisitions;
- RFQ / quotation process;
- quote comparison;
- approvals / authority rules;
- purchase orders;
- supplier linkage;
- project/source traceability.

### Phase I — Receiving & Logistics

Implement:

- expected deliveries;
- shipment/in-transit visibility;
- partial receipts;
- receiving discrepancies;
- inventory posting;
- project/site delivery;
- future supplier invoice / 3-way match hooks.

### Phase J — Autonomous intelligence

Only after canonical workflows are proven:

- shortage detection;
- project supply risk;
- alternate-stock recommendations;
- transfer simulation;
- sourcing recommendations;
- ETA risk;
- governed action execution.

---

## 7. Migration strategy

Current Commercial work reaches migration **217**.

Do not assume the next migration number until checking the repository and active worktrees.

Important: previous Fiscal planning reserved the 220–229 range. Avoid collisions across branches/worktrees. Prefer one of:

- 218–219 for small immediately-following foundations and 230+ for the broader Operations/Supply Chain sequence; or
- another conflict-free range after inspecting all active branches.

Never renumber an already-applied migration casually.

---

## 8. Security model

Every new domain must define explicit permissions, for example:

### Operations

- `operations.view`
- `operations.manage`
- `service_orders.view`
- `service_orders.create`
- `service_orders.issue`
- `service_orders.override`
- `planning.view`
- `planning.manage`

### Supply Chain

- `supply.view`
- `supply.plan`
- `inventory.view`
- `inventory.manage`
- `inventory.reserve`
- `procurement.view`
- `procurement.request`
- `procurement.source`
- `procurement.approve`
- `purchase_orders.issue`
- `receiving.view`
- `receiving.receive`
- `suppliers.view`
- `suppliers.manage`

Names are illustrative: first inspect existing permission vocabulary and extend consistently.

Sensitive writes must use governed server functions/services rather than direct browser writes.

---

## 9. UI principles

- premium enterprise;
- high information density without clutter;
- no generic “AI cards”;
- no excessive neon/glow;
- strong hierarchy;
- exceptions first;
- progressive disclosure;
- one canonical context, many contextual views;
- desktop operational density + strong mobile field behavior;
- every screen must answer a decision/action question.

Do not create empty dashboard filler. Every KPI must have a source, definition and drill-down.

---

## 10. Acceptance criteria for the whole program

The architecture is acceptable when:

1. an accepted PT+PC package can create/import one governed internal OS;
2. an issued OS can create/link a Project idempotently;
3. Project Planning can create requirements with dates and provenance;
4. Supply Planning can determine whether a requirement is covered, reserved, transferable or short;
5. Inventory availability cannot double-count reserved stock;
6. shortages can generate governed procurement demand;
7. POs retain complete project/requirement traceability;
8. partial receiving is first-class;
9. project screens aggregate canonical Finance/Contracts/Measurements/People/Supply data instead of duplicating it;
10. AI can explain and recommend without silently creating protected business truth;
11. RLS/RBAC/security audits prove tenant isolation and server-only governed writes;
12. automated proofs and browser tests cover the golden path and important exception paths.

---

## 11. Definition of done per phase

A phase is not done because screens render.

It is done only when it has:

- canonical domain model;
- migrations;
- RBAC/RLS;
- services/actions;
- read models;
- UI;
- audit/provenance;
- deterministic tests;
- integration proof;
- browser proof where applicable;
- no mock business data masquerading as production truth;
- documented remaining debt.

