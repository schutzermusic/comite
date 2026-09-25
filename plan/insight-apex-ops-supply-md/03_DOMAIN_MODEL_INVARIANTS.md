# Insight Apex — Operations & Supply Chain
## Canonical Domain Model and Invariants

This document defines conceptual objects. **Do not blindly create tables with these exact names.** First inspect the existing database and extend canonical entities where appropriate.

---

# 1. Core relationship graph

```text
ProposalContext
  ├─ Technical Proposal Revision
  ├─ Commercial Proposal Revision
  └─ Customer Authorization
            ↓
       ServiceOrder
            ↓
          Project
            ↓
       ExecutionPlan
            ↓
        Activity
            ↓
       Requirement
            ↓
     SupplyRequirement
       ├─ Reservation
       ├─ Transfer
       ├─ PurchaseRequisition
       │      ↓
       │     RFQ
       │      ↓
       │    Quote
       │      ↓
       │  SourcingDecision
       │      ↓
       │ PurchaseOrder
       │      ↓
       │ GoodsReceipt
       └─ ExternalService
```

Other canonical domains connect to the graph:

```text
Project ↔ Contractual Context
Project ↔ Measurements
Project ↔ Documents
Project ↔ Risks
Project ↔ Team / Attendance
Project ↔ Finance
Project ↔ Fleet / Equipment
```

---

# 2. Suggested canonical concepts

## Operations

- `ServiceOrder`
- `ServiceOrderRevision` or immutable material-change history
- `ServiceOrderDivergence`
- `ExecutionPlan`
- `Activity` / `WorkPackage`
- `Requirement`
- `OperationalRisk`

## Supply Chain

- `Item` / `Material`
- `InventoryLocation`
- `InventoryMovement`
- `InventoryReservation`
- `SupplyRequirement`
- `SupplyDecision` / `SupplyAllocation`
- `StockTransfer`
- `PurchaseRequisition`
- `RFQ`
- `SupplierQuote`
- `SourcingDecision`
- `PurchaseOrder`
- `GoodsReceipt`
- `Shipment` / inbound logistics object

## Shared

- canonical `Party` with Supplier role;
- canonical `Document`;
- canonical `Project`;
- canonical user/person/organization permissions;
- canonical financial references.

---

# 3. Core invariants

## INV-01 — Tenant coherence

Every relationship across Service Order, Project, Requirement, Supply, Procurement, Inventory and Receiving must belong to the same organization unless an explicit cross-organization platform feature exists.

Database should refuse incoherent cross-tenant references.

## INV-02 — One operational truth

Project contextual views must not duplicate canonical Contract, Finance, Measurement, Attendance, Document or Supply truth.

## INV-03 — OS upstream provenance

An OS generated from a proposal context must retain the exact governing PT/PC revision references and authorization evidence used at creation/issuance.

Later proposal revisions do not silently rewrite an issued OS.

## INV-04 — OS issuance gate

Normal OS issuance is blocked by unresolved BLOCKING divergences.

Exceptions require explicit governed authorization and audit evidence.

## INV-05 — Project handoff idempotency

Repeated OS → Project handoff cannot create duplicate projects.

## INV-06 — Requirement source

Every requirement has explicit provenance:

- project activity;
- OS;
- manual governed requirement;
- imported plan;
- AI proposal later confirmed/authorized.

## INV-07 — Supply coverage is composable

One requirement may be fulfilled by multiple sources:

```text
40% reservation
30% transfer
30% purchase
```

The model must support partial allocations.

## INV-08 — No double allocation

The same available inventory quantity cannot satisfy two incompatible reservations at the same time.

Reservation must participate in an atomic availability check.

## INV-09 — Physical stock ≠ available stock

`available` must not equal `on_hand` when reservations/holds exist.

## INV-10 — Inventory movement immutability

Posted physical inventory movements should be append-only/corrected by reversing or adjustment entries, not silently rewritten.

## INV-11 — Receiving drives stock

An issued PO alone cannot increase physical inventory.

Only governed receipt/transfer completion/adjustment events can post relevant stock movement.

## INV-12 — Partial receipts remain open

Receipt of less than ordered quantity must preserve remaining open quantity.

## INV-13 — Procurement provenance

PO line(s) must be traceable to sourcing/requisition and, where applicable, originating requirement/project/activity.

## INV-14 — Supplier is a Party role

Do not create an isolated supplier identity table that competes with canonical Party identity.

## INV-15 — Protected approvals are explicit

Approval cannot be inferred merely because later workflow steps exist.

Record who approved, what exact version/value, under what permission/policy, and when.

## INV-16 — AI cannot fabricate physical events

AI cannot assert goods were received, inventory was consumed, a team was on site, or a customer accepted work without supporting governed evidence/action.

## INV-17 — Financial truth boundaries

Supply Chain may expose committed/expected costs but should not create a second Accounts Payable/Fiscal ledger.

## INV-18 — Measurement remains canonical

Operations must reuse the existing measurement/evidence workflow rather than cloning it into Project Planning or Service Orders.

## INV-19 — Deletion protection

Material history/audit/ledger tables should follow the platform's canonical history protection rules. Deletion paths, if any, must be privileged, governed and tenant-safe.

## INV-20 — Immutable references after material externalization

Once an OS/PO/accepted package has been issued externally or used as governing execution truth, material edits should produce version/history rather than overwrite what was previously issued.

---

# 4. State-machine guidance

Avoid over-modeling.

Use state only where it represents a meaningful lifecycle transition.

Prefer derived/read-model states for:

- shortage;
- coverage percentage;
- project supply health;
- late delivery;
- readiness;

when those facts can be calculated from dates/allocations/transactions.

Do not create mutable status fields that can contradict their underlying truth.

---

# 5. Event model

Important canonical events should be queryable for project timeline and intelligence.

Examples:

- SERVICE_ORDER_CREATED
- SERVICE_ORDER_ISSUED
- PROJECT_LINKED
- EXECUTION_PLAN_ACCEPTED
- REQUIREMENT_CONFIRMED
- INVENTORY_RESERVED
- RESERVATION_RELEASED
- TRANSFER_DISPATCHED
- TRANSFER_RECEIVED
- PURCHASE_REQUISITION_SUBMITTED
- SOURCING_COMPLETED
- PURCHASE_ORDER_ISSUED
- GOODS_PARTIALLY_RECEIVED
- GOODS_RECEIVED
- RECEIVING_DIVERGENCE_RECORDED
- MATERIAL_ISSUED_TO_PROJECT
- MATERIAL_RETURNED
- MEASUREMENT_SUBMITTED
- CUSTOMER_ACCEPTANCE_RECORDED

Do not necessarily implement one generic event table if current platform already has canonical histories per domain. The requirement is a coherent queryable timeline/read model.

---

# 6. Read models

Recommended read models should be derived from canonical truth.

### Operations Overview

- project health;
- OS queue;
- critical activities;
- measurement queue;
- supply blockers.

### Project 360

- contract context;
- financial context;
- schedule;
- team;
- measurements;
- risks;
- supply;
- timeline.

### Supply Control Tower

- demand coverage;
- shortages;
- PO exposure;
- inbound risk;
- supplier risk;
- project impact.

### Inventory availability

Per item/location/project:

- on hand;
- reserved;
- available;
- inbound;
- allocated;
- in inspection;
- in transit.

---

# 7. Concurrency requirements

Pay special attention to concurrent operations:

- two users reserving the same inventory;
- PO issuance retry;
- two receipts against same PO line;
- transfer receiving while a stock count occurs;
- project handoff retry;
- shortage computation while allocations change.

Use database transactions/locking or other deterministic concurrency controls appropriate to the current stack.

Do not rely on browser-side checks for inventory or authorization integrity.

---

# 8. Security boundaries

### Browser may read authorized data.

### Browser should not directly perform protected writes such as:

- issuing OS;
- overriding blocking divergence;
- atomic reservation;
- approving procurement;
- issuing PO;
- posting receipt;
- inventory adjustments;
- sensitive financial handoff.

Use governed server-side functions/services with RBAC/RLS and audit.

---

# 9. AI provenance

For AI-derived fields where material:

- provider;
- model;
- task;
- confidence;
- source document;
- page;
- quote/span where applicable;
- confirmation state;
- created timestamp.

AI interpretation and human/canonical truth must remain distinguishable.

---

# 10. Naming principle

Use user-facing Portuguese labels independently from canonical internal vocabulary.

Do not force database renaming to satisfy UI copy.

Keep UI labels centralized where practical.

