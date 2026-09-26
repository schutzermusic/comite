# Coverage semantics: one rule for inventory and procurement (migration 246)

## Defect (proven in QA)

The end-to-end Dashboard Supply test ran this scenario:

- requirement 500 m;
- 100 m reserved at the site;
- a 150 m transfer from another warehouse, in status **REQUESTED**;
- result: `purchase_requisition_from_shortage` requisitioned **400 m**, so 650 m ended up promised against 500 m.

The audit found two canonical rules that disagree about what a pending transfer is:

| Rule | Counts REQUESTED/APPROVED transfers? | Counts open requisitions? |
|---|---|---|
| `supply_requirement_coverage.shortage_qty` + `purchase_requisition_from_shortage` (procurement) | **no** | yes (`procurement_requested_open`) |
| `inventory_requirement_committed` → guards of `inventory_reserve` / `inventory_transfer_request` (inventory) | yes | **no** |

Consequences:
- **Transfer, then requisition:** the transfer is bought again (the `qa-flx-*` case).
- **Requisition, then transfer or reserve:** the requisition is covered again (QA Tucuruí: 1,450 m promised against 1,200 m).

This is not a race. Every writer takes `project_requirements … FOR UPDATE` and they serialize. The asymmetric rule is what breaks.

## What each transfer state guarantees

| Transfer line | Holds stock? | Coverage |
|---|---|---|
| REQUESTED, no origin reservation | **No.** No availability check and no hold. | **Pending** (planned) |
| APPROVED, no origin reservation | **No.** Approval only flips the status; dispatch can still fail with "insufficient stock" (proof: `concurrency.spec.ts`). | **Pending** (planned) |
| REQUESTED/APPROVED **with** `source_reservation_id` (origin reservation for the same requirement) | Yes, via the reservation. | Confirmed (already in `reserved_qty`) |
| IN_TRANSIT / PARTIALLY_RECEIVED | Yes. `TRANSFER_OUT` at the origin. | **Committed internal** (`in_transit_qty`) |
| RECEIVED | Yes. Reservation at the destination. | Confirmed |
| CANCELLED / CLOSED with loss | — | Returns to uncovered on its own |

**Decision.** A transfer starts reducing the purchasable quantity only when it is committed:
- dispatched (IN_TRANSIT / PARTIALLY_RECEIVED), or
- backed by an origin reservation.

A REQUESTED or APPROVED transfer is **pending**:
- it is not coverage, so the requirement stays short (risk, stages and signals see the shortage);
- it is also not bought again without a human decision.

## The rule (per requirement)

```
confirmed            = reserved_qty + consumed_qty                      (includes pending lines with an origin reservation)
committed internal   = in_transit_qty                                    (dispatched)
committed external   = on_order_qty + inspection_qty                     (PO issued / receipt under inspection)
uncovered (shortage) = GREATEST(required − confirmed − committed internal − committed external, 0)   ← unchanged
requested            = requested_qty (open requisitions)                                              ← unchanged
pending internal     = Σ quantity of REQUESTED/APPROVED transfer lines with no source_reservation_id  ← NEW: pending_transfer_qty
purchasable          = GREATEST(uncovered − requested − pending internal, 0)                          ← NEW: purchasable_qty
claimed              = committed (inventory) + requested   → symmetric guard for reserve/transfer   ← NEW: supply_requirement_claimed()
```

## Purchase request (`purchase_requisition_from_shortage`)

**Default (no exception):** requisitions only the purchasable quantity. If purchasable is 0:
- with pending transfers, it is refused with a distinct message naming the transfers: *"…is covered by pending internal transfer(s) TR-…: dispatch or cancel the transfer, or request a coverage exception."*
- with no pending transfers, it keeps the existing message (*"no uncovered shortage left to requisition (% already requested)"*).

**Governed coverage exception** (option 2 of the brief):
- **Payload:** `coverage_override: { reason }`.
- **Permission:** new key `procurement.coverage_override`, checked in the DB. Seeded to `owner_admin` and `ceo_diretoria`; not to `compras`.
- **Reason:** at least 20 characters.
- **Quantity:** requisitions `uncovered − requested`, which buys the pending part too, **declared**.
- **Record:** one row per requirement in the append-only ledger `procurement_coverage_exceptions`:
  - requisition, requirement, pending quantity and the transfers (number/quantity);
  - purchasable before, requisitioned quantity, reason, who authorized it and with which permission;
  - plus the event `supply.requisition.coverage_exception`.
- **The Apex signal (`supply_signal_execute`) never uses the exception.**

**Response** (compatible, fields added):
- `purchasable_qty`, `pending_transfer_qty` and `pending_transfers` (`[{transfer_id, transfer_number, status, quantity}]`), per requirement under `requirements[]`;
- `override` (bool) and `requisitioned_qty`.

**Idempotency:** the key is re-read **under** the requirement lock (the 238 pattern).

**Exact arithmetic (migration 247):** the requisition decides on **unrounded** values, never on the view's `numeric(18,4)` columns:
- pending = the raw sum of the pending transfer lines (the view's predicate);
- purchasable = `GREATEST(shortage − requested − pending, 0)`;
- the exception ledger records these same values, so `pcx_is_an_exception` always holds;
- the "covered by pending internal transfer(s)" refusal is raised only when pending > 0.

## Symmetric guard (reserve and transfer)

`inventory_reserve` and `inventory_transfer_request` now use `supply_requirement_claimed` (committed + open requisitions):
- a reservation or transfer on top of an open requisition that already covers the requirement is refused ("over-cover");
- to swap a purchase for stock, cancel the requisition first.

The receipt caps (`inventory_transfer_receive`, `goods_receipt_post`, `goods_receipt_inspect`) are **unchanged**; they keep using `inventory_requirement_committed`.

`inventory_transfer_request` also starts locking the requirements in **sorted** order (no deadlock with other writers).

## View `supply_requirement_coverage`

- Two columns are **appended** at the end: `pending_transfer_qty` and `purchasable_qty`.
  - They are `numeric(18,4)` **display** values, while `shortage_qty` is unrounded.
  - A column cannot change type in place, so they stay that way. No writer decides on them (247).
- The 18 existing columns are unchanged, and `shortage_qty` stays gross.
- `security_invoker`, the grants and the COMMENT are re-applied.

## Consumers

- **The Dashboard, the Supply planning panel, the Apex signals and the control tower read `purchasable_qty` and `pending_transfer_qty` from the domain.** No screen derives its own purchasable quantity.
- **When pending coverage exists, the screen says so explicitly and offers only two ways forward:**
  - resolve the transfer, via the link to it in Estoque;
  - the exception, only for someone with the permission, with the reason field.

## Proof and regression

- **`scripts/operations/apply-246.mjs`:** SQL proofs, always rolled back.
- **`scripts/operations/apply-247.mjs`:** the rounding cases, a regression of the 246 contract, and a source check that `inventory_transfer_request` locks in sorted order. Always rolled back.
- **Unit tests** for the rule in TypeScript.
- **`tests/qa-live/dashboard-supply-flow.spec.ts`** covers:
  1. no double coverage;
  2. a cancelled or failed transfer returns the quantity to purchasable;
  3. a dispatched transfer reduces the purchase;
  4. no over-purchase through concurrent actions (requisition ∥ requisition, requisition ∥ transfer, under `forcedOverlap`);
  5. the exception: `compras` refused (403); `owner` with a reason goes through and is recorded.
- **Golden path:** `tests/qa-live/golden-path.spec.ts`.
