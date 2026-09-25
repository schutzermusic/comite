# Insight Apex — Supply Chain Domain
## Material Planning, Inventory, Procurement, Suppliers, Receiving & Logistics

---

## 1. Domain purpose

Supply Chain must answer:

- What does execution need?
- When and where is it needed?
- What do we already have?
- What is already reserved?
- Can another location/project supply it?
- What must be purchased or externally sourced?
- Which supplier/option best satisfies cost, lead time and risk?
- What is in transit?
- What was actually received?
- Which project/activity consumed it?

The domain starts with **demand**, not with a manually-entered purchase order.

---

## 2. Navigation

```text
Supply Chain
├── Visão Geral
├── Planejamento de Materiais
├── Estoque
├── Compras
├── Fornecedores
└── Recebimentos & Logística
```

---

# 3. Supply Chain Overview

A control tower for exceptions and near-term execution.

Suggested KPI/read models:

- open committed spend;
- uncovered material demand;
- critical shortages;
- purchase approvals pending;
- late purchase orders;
- inbound value;
- inventory reserved;
- inventory at risk / obsolete later;
- projects exposed to supply delay.

Priority sections:

- Project supply risk;
- Critical shortages;
- Transfers that could avoid purchase;
- Late supplier deliveries;
- Receiving discrepancies;
- Pending sourcing/approval decisions.

Do not build a decorative dashboard. Every metric must drill into real records.

---

# 4. Material Planning

## 4.1 Core principle

Material Planning bridges Project Planning and Supply execution.

```text
Project Requirement
→ Supply Requirement
→ Coverage calculation
→ Supply Strategy
```

## 4.2 Coverage equation

Conceptually:

```text
Required Quantity
- Valid Project Reservation
- Other Supply Already Committed to Requirement
= Remaining Requirement
```

Available inventory must account for existing reservations.

Never use physical on-hand alone as available quantity.

## 4.3 Suggested supply strategies

- RESERVE_FROM_STOCK
- TRANSFER
- BUY
- EXTERNAL_SERVICE
- FUTURE: MAKE / FABRICATE

Do not hard-code future manufacturing if Apex does not need it yet, but keep the abstraction extensible.

## 4.4 Material planning screen

Portfolio table:

| Project | Requirement Date | Required | Covered | Reserved | Inbound | Shortage | Risk |
|---|---:|---:|---:|---:|---:|---:|---|

Drill-down item view:

```text
Material: Cabo 35 mm
Project: X
Activity: Y
Need date: 18/11

Required       1,000 m
Reserved         250 m
Inbound          300 m
Shortage         450 m

Potential alternative
- 200 m available in Warehouse B
- transfer ETA 2 days

Actions
[Simulate transfer]
[Prepare purchase request]
```

Apex recommendations remain explainable and governed.

---

# 5. Material / Item Master

Do not build disconnected free-text material names throughout the platform.

A canonical item/material concept should support:

- organization;
- internal code/SKU;
- description;
- category;
- unit of measure;
- manufacturer/brand when relevant;
- supplier part references;
- technical attributes;
- serial/lot tracking policy;
- active/inactive;
- substitution/equivalence later;
- document/spec links.

AI may suggest normalization, but master-data truth is governed.

---

# 6. Inventory

## 6.1 Ledger first

Inventory truth should be derived from a movement ledger, not a mutable quantity field alone.

Canonical movement examples:

- RECEIPT;
- RESERVATION;
- RESERVATION_RELEASE;
- TRANSFER_OUT;
- TRANSFER_IN;
- ISSUE_TO_PROJECT;
- RETURN_FROM_PROJECT;
- ADJUSTMENT;
- COUNT_CORRECTION.

Model the accounting of stock carefully: reservation often affects availability but not physical on-hand. It may be represented in a separate reservation ledger/table rather than as a physical movement.

## 6.2 Inventory location hierarchy

Support at least:

- warehouse;
- project/site stock;
- mobile/vehicle stock later if useful;
- logical quarantine/inspection location.

Potential hierarchy:

```text
Organization
→ Warehouse / Site
→ Zone
→ Bin (optional)
```

Do not force bin-level complexity on tenants that do not need it.

## 6.3 Quantities

The system must distinguish:

- on hand;
- reserved;
- available;
- in transit;
- under inspection;
- allocated to project;
- consumed.

Definitions must be deterministic and documented.

## 6.4 Reservations

Reservation links inventory to:

- project;
- activity/requirement;
- quantity;
- required-by date;
- location;
- status;
- source;
- actor/policy.

Core invariant:

> Reserved stock cannot simultaneously be treated as available to another demand.

Support partial reservation.

## 6.5 Transfers

Transfer workflow concept:

```text
REQUESTED
→ APPROVED / READY
→ IN_TRANSIT
→ RECEIVED
→ CLOSED
```

Need partial transfer/receipt support where operationally relevant.

Trace source and destination locations, project/requirement and logistics evidence.

---

# 7. Procurement

## 7.1 Procurement starts from need

Normal flow:

```text
Shortage / Approved Demand
→ Purchase Requisition
→ Sourcing / RFQ
→ Quotes
→ Comparison
→ Approval
→ Purchase Order
```

Allow exceptional/manual requests with governance, but preserve source/reason.

## 7.2 Purchase Requisition

Minimum concepts:

- organization;
- requester;
- project;
- source requirement(s);
- items/services;
- quantities;
- required-by date;
- delivery location;
- estimated cost;
- justification;
- priority;
- approval state;
- sourcing state.

Multiple project requirements may be consolidated only with explicit traceability.

## 7.3 RFQ / Quotations

Support:

- invited suppliers;
- requested items;
- response deadline;
- supplier quote versions;
- price;
- freight;
- taxes where applicable;
- lead time;
- payment terms;
- validity;
- deviations;
- attachment/provenance.

## 7.4 Quote comparison

Compare beyond price:

- landed/total cost;
- delivery date;
- lead time;
- payment terms;
- technical compliance;
- supplier reliability;
- project delay exposure;
- exceptions.

Apex may recommend an option but must show rationale.

## 7.5 Approvals

Approval policy can depend on:

- value;
- project;
- cost center;
- category;
- supplier risk;
- exception/deviation;
- role/authority.

Do not hard-code one approval chain for every tenant.

## 7.6 Purchase Order

PO must retain links to:

- requisition;
- sourcing decision;
- supplier;
- project(s);
- requirement(s);
- delivery location;
- expected dates;
- items/services;
- prices/terms;
- approvals;
- documents.

Lifecycle concept:

```text
DRAFT
→ APPROVAL_REQUIRED
→ APPROVED
→ ISSUED
→ PARTIALLY_RECEIVED
→ RECEIVED
→ CLOSED / CANCELLED
```

Inspect current vocabulary before implementing.

---

# 8. Suppliers

Supplier master should eventually support:

- party linkage;
- categories;
- contacts;
- tax/legal identifiers;
- bank/payment data through appropriately restricted finance boundaries;
- documents/certifications;
- homologation/status;
- commercial terms;
- performance metrics;
- incidents/nonconformance;
- historical quotes/orders;
- lead-time reliability.

Reuse `parties` / `party_roles` instead of creating another disconnected counterparty master.

A supplier is a role of a canonical party.

---

# 9. Receiving & Logistics

## 9.1 Inbound visibility

Track expected inbound from issued POs / transfers.

Views:

- expected today;
- in transit;
- late;
- partially received;
- discrepancy;
- completed.

## 9.2 Goods receipt

Receiving must support:

- PO/transfer reference;
- location/site;
- date/time;
- received by;
- quantities;
- partial receipt;
- rejected/damaged quantity;
- lot/serial when applicable;
- photos/documents/evidence;
- discrepancy reason;
- inspection status when required.

Inventory posting must be controlled and auditable.

## 9.3 Partial receipt is first-class

Example:

```text
Ordered: 100
Received: 80
Rejected: 0
Pending: 20
```

Do not prematurely close PO or requirement.

## 9.4 Logistics

Initial scope:

- origin;
- destination;
- carrier/vehicle where known;
- dispatch date;
- ETA;
- actual arrival;
- status;
- delay;
- related PO/transfer/project.

Later enhancements:

- route optimization;
- proof of delivery;
- tracking integrations;
- freight contracts.

---

# 10. Future supplier invoice / 3-way match hook

Do not fully implement Fiscal/AP here unless in scope, but design for:

```text
Purchase Order
× Goods Receipt
× Supplier Invoice
```

Expected outcomes:

- match;
- quantity divergence;
- price divergence;
- tax divergence;
- missing receipt;
- duplicate invoice;
- release/block for Accounts Payable.

The Supply Chain domain should expose the canonical PO and receiving facts needed by Finance.

---

# 11. Apex Intelligence in Supply Chain

Do not create an isolated AI page.

Embedded intelligence examples:

### Shortage risk

> Activity starts in 6 days. Material ETA is 10 days.

### Alternate inventory

> 200 units available at Warehouse B. Transfer costs R$ X and avoids Y days of delay.

### Sourcing recommendation

> Supplier B is 4% more expensive but arrives 9 days earlier and prevents a critical-path delay.

### Supplier risk

> Supplier has missed 3 of last 5 committed dates for this category.

### Autonomous actions later

Within policy:

- create draft purchase requisition;
- propose consolidation;
- request quote;
- prepare transfer;
- notify owner;
- escalate approval.

Never auto-receive physical goods or silently approve protected spending.

---

# 12. Supply Chain acceptance criteria

1. Project material requirements feed Material Planning.
2. Availability subtracts valid reservations.
3. One requirement can be partially covered by stock, transfer and purchase.
4. Reservations cannot over-allocate the same available stock.
5. Transfers retain full source/destination/project traceability.
6. Purchase requisitions retain source requirement provenance.
7. Quote comparison includes cost + time + risk, not price only.
8. PO issuance is governed and audited.
9. Partial receiving works without corrupting PO/requirement status.
10. Inventory posting is ledger-driven and auditable.
11. Supplier identity reuses canonical parties.
12. Project and Supply Chain screens read the same canonical records.
13. AI recommendations are explainable and do not silently create protected truth.

