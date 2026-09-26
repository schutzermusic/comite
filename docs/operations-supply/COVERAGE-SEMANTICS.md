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

## Procurement quantities: partial orders, cancellation and reopening (migration 248)

### Defect (proven in QA)

Requirement 100 m; RC-A requisitions 100; the winning quote covers 60; the order for 60 is **issued**.
- Issuing marked the line as served without looking at quantities, so the 40 that were never ordered became purchasable and RC-B requisitioned them (claimed 100).
- Cancelling the order then counted RC-A's **whole** allocation as requested again: **140 claimed against 100**, and re-quoting RC-A asked suppliers for 100 again (a double purchase).
- The same happened with a reservation or a transfer instead of RC-B, with one line serving two requirements, and with a requisition split across two orders.

Neighbouring paths of the same defect:
- an old quote of a **cancelled** requisition could still be decided and issued (200 against 100);
- a line the winning quote did not price was stuck: no new RFQ, no new requisition;
- a requirement cancelled, re-planned or reduced after the order was bought again in full on cancel.

### Open quantity

```
open(a)            = a.quantity − Σ releases(a)                   (allocation a; append-only ledger; no rounding)
open(line)         = Σ open(a) over its allocations               (a line with NO allocation — manual requisition — uses l.quantity)
required-by(line)  = min(project_requirements.required_by) over its OPEN allocations   (no allocation: l.required_by)
requested          = Σ open(a) of lines of SUBMITTED/SOURCING requisitions with no issued-class order on the line
```

- **Rule for readers:** an allocation or line with open quantity 0 does not exist as live demand. No list, loop, liveness check, date or requirement set includes it.
- `procurement_requested_open` and the `requested` CTE of `supply_requirement_coverage` count `open(a)`. The view keeps its 20 columns, order, types, grants and comment.
- `purchase_requisition_open_allocations` (security_invoker) exposes `allocated_qty`, `released_qty` and `open_qty` per allocation, raw.

### The release ledger

`procurement_requisition_releases`: what stopped being open demand of an allocation, and why.

| Stage | Cause | Written by | Meaning |
|---|---|---|---|
| `PO_ISSUED` | `NOT_ORDERED` | `purchase_order_issue` | the requisition asked for more than this order ordered |
| `PO_CANCELLED` | `COVERED` | `purchase_order_cancel` | other active coverage already took it; reopening would over-claim |
| `PO_CANCELLED` | `REQUIREMENT_INACTIVE` | `purchase_order_cancel` | the requirement is no longer a CONFIRMED material/external service |

- One row per (order, allocation, stage); `quantity` is unconstrained `numeric`, > 0.
- A release is **never** active claimed coverage.
- Append-only (`operations_reject_history_rewrite`, `contracts_reject_history_erasure`). The read policy is exactly the allocations' one, so the coverage view sees allocations and releases with the same eyes. No actor column: the actor is in the order history and in the event.

### Issue: the unordered remainder is released explicitly

`purchase_order_issue`, after locking the order and then (in a statement of its own) the order's requisitions:
- refuses unless every requisition is SUBMITTED or SOURCING (*"Requisition % is %: this order can no longer be issued."*) — an old order of a dead requisition is never issued;
- for each open allocation on the order's lines: `remainder = open(a) − ordered(a)` (this order's allocation for that line and requirement); a positive remainder is released (`PO_ISSUED`, `NOT_ORDERED`);
- **no claim changes**: a line with an issued order is already out of *requested* and the remainder was already purchasable. Releasing makes it explicit and leaves `open(a)` equal to what was ordered — the most a cancellation can give back;
- marks ORDERED in a later statement (fresh snapshot): every line with open quantity > 0 has an issued-class order;
- emits `supply.requisition.released` and returns `released: [{requirement_id, item_id, unit, released_qty}]`. The replay is unchanged.

### Cancel: reopen only what is genuinely uncovered

`purchase_order_cancel`, per requirement `r`, computed in fresh statements under the locks and **before** the order changes status:

```
T         = requisitions with a line on this order, status SUBMITTED / SOURCING / ORDERED
C         = open allocations on lines of T with no issued-class order other than this one,
            on a line of this order — or of an ORDERED requisition (legacy inconsistent rows)
pre(r)    = supply_requirement_claimed(r)
own(r)    = this order's open on-order for r (when issued) + Σ open(a) of C that already counts as requested
capacity  = r.quantity when r is CONFIRMED MATERIAL/EXTERNAL_SERVICE, else 0
budget    = GREATEST(capacity − (pre − own), 0)
keep(a)   = LEAST(open(a), remaining budget)     in requisition requested_at, then allocation id, order
release   = open(a) − keep(a)  → ledger (COVERED, or REQUIREMENT_INACTIVE when capacity is 0)
```

**The user's invariants:**
- **Healthy data:** after the cancel, claimed ≤ required.
- **Legacy data already over-claimed:** after the cancel, claimed ≤ the claim just before it — never above the remaining valid capacity.
- **What cannot be reopened goes to the ledger**, and is never active claimed coverage.
- **A coverage exception is not carried over by a cancel.** Buying the pending part again takes a NEW governed exception (246/247). The `procurement_coverage_exceptions` row stays as the record of the original decision.
- **Inactive requirements have 0 capacity**, pre-issue cancels included.
- **No rounding anywhere.**

Computing after the status flip would count this order's lines at their full allocation and `own` twice: the rule must run before.

**Requisition status is derived from its lines** (it was a blind SUBMITTED): CLOSED when every line has open 0 (sets `closed_at`, `close_reason` — the first producer of CLOSED); ORDERED when every open line has an issued-class order; SOURCING when some open line is in a live RFQ; SUBMITTED otherwise. Written only when it changes.

**Outcome:** the history transition stays `cancelled`; the 237 detail keys are kept and `requirements` / `requisitions` are merged in. The result is `{purchase_order_id, status, replayed, approval_request_status, requirements: [{requirement_id, item_id, unit, reopened_qty, released_qty, cause}], requisitions: [{requisition_id, requisition_number, status_from, status_to}]}` — per requirement, never summed across items. `reopened_qty` is what newly counts as requested (0 for a pre-issue allocation). A replay returns the stored outcome (a cancel made before 248: empty lists). `supply.requisition.released` is emitted per (requisition, project), key `requisition:<id>:released:<po>:<stage>:<project>`.

| Case | Result |
|---|---|
| 100 required, order 60, RC-B 40 | issue releases 40; cancel reopens 60; claimed 100; re-RFQ asks 60 |
| full order, nothing else | reopens 100 (the apply-234 contract) |
| pre-issue cancel, healthy | nothing changes |
| requirement cancelled / re-planned | reopens 0, releases everything, requisition CLOSED |
| coverage exception + pending transfer, order 60 or 100 | reopens 0, releases COVERED, claimed = required |
| requirement edited 100 → 80, full order | reopens 80, releases 20 |

### Stale quotes and unpriced lines

- `procurement_decide` locks the RFQ's requisitions (uuid order) **before** the RFQ. Quote lines of a requisition that is no longer SUBMITTED/SOURCING, or of a line with open 0, are not ordered — like unquoted lines — and are returned in `not_ordered`. With no orderable line it refuses (*"No line of this quotation can become an order: its requisitions were cancelled or closed."*). Allocation takes `LEAST(left, open(a))` over open allocations only, so it never inserts 0.
- `purchase_requisition_cancel` refuses a CLOSED requisition (*"Requisition is CLOSED: nothing to cancel."*) and, under its lock, cancels every OPEN RFQ of it whose lines all belong to requisitions that are no longer SUBMITTED/SOURCING (`close_reason` *"Solicitação <n> cancelada"*). Since 249 it first locks those OPEN RFQs (uuid order, a statement of its own) and sweeps in a later statement, so of two requisitions cancelled at the same time the second one sees the first cancelled and closes the RFQ. A replay (the requisition is already CANCELLED) locks and sweeps the same way and returns `rfqs_cancelled`: calling it again repairs an RFQ left OPEN by that race before 249.
- `procurement_rfq_create` locks the requisitions before reading lines, quotes the line's **open** quantity with the required-by of its open allocations, and refuses a fully released line (*"Requisition line is fully released: nothing left to source."*). A line is in a **live** RFQ only when the RFQ is OPEN, or DECIDED with a non-cancelled order that has a line for it: a line the winning quote did not price can be quoted again.

### Lock order (migration 249)

Global prefix: `[order row] → project_requirements (uuid) → purchase_requisitions (uuid) → procurement_rfqs`. No function holds a requisition lock while it waits on a requirement.

| Function | Lock order |
|---|---|
| `purchase_order_cancel` | order → approval → requirements (`FOR NO KEY UPDATE`, uuid) → requisitions (uuid) → RFQ |
| `purchase_order_issue` | order → requirements with something to release (`FOR KEY SHARE`, uuid; a full issue takes none) → requisitions (uuid, own statement) |
| `procurement_decide` | requirements (`FOR KEY SHARE`, uuid) → requisitions (uuid) → RFQ |
| `procurement_rfq_create` | requisitions (uuid) |
| `purchase_requisition_cancel` | requisition → RFQs (uuid, own statement; the dead-RFQ sweep is a later statement) |
| `from_shortage` / `inventory_reserve` / `inventory_transfer_request` | requirements `FOR UPDATE` (uuid), then their own locks |

- **What `issue` and `decide` pre-lock.** `issue` locks the requirements of the open allocations on the order's requisition lines; `decide` locks those on the RFQ's requisition lines. These are the targets of the foreign-key checks of the release ledger (`issue`) and of the order allocations (`decide`). Open quantity only goes down, because the ledger is append-only, so the set locked up front covers every requirement those inserts reference. Before 249 the foreign-key checks took these locks one row at a time, in allocation order, while the requisitions were already held.
- **How the modes interact.** `FOR KEY SHARE` and the cancel's `FOR NO KEY UPDATE` do not conflict, so `issue`, `decide` and the cancel meet on the requisitions, in uuid order. Both modes conflict with `FOR UPDATE`, so `issue`, `decide` and the cancel queue in uuid order behind the claim-changing writers.
- **The three 248 race defects that 249 removes** (each reproduced on a clone of QA with real commits before 249, and gone after it):
  - two concurrent `purchase_requisition_cancel` calls for requisitions that share one OPEN RFQ, which left the RFQ OPEN for ever;
  - `issue ∥ from_shortage`, a 2-way deadlock;
  - `cancel ∥ issue|decide ∥ from_shortage`, a 3-way deadlock.

**Known cycle, out of scope: receipts.** `goods_receipt_post`, `goods_receipt_inspect` and `inventory_transfer_receive` lock requirements in their own order, not in uuid order. So a receipt of **another** order that shares ≥ 2 requirements can deadlock with a function that locks those same requirements in uuid order:
- the cancel (`FOR NO KEY UPDATE`), as documented in 248;
- through the same receipt order, the `FOR KEY SHARE` pre-lock of `issue` and `decide`. This was proven on the clone. Only a partial issue (one with something to release) takes that pre-lock; a full issue takes no requirement lock, as in 248, so it never joins this cycle.

In every case PostgreSQL aborts one side and `governedRpc` retries `40P01` up to 3 times. All of these cycles have one cause, and the receiving-deadlock follow-up removes them: receipts pre-lock their requirements in uuid order.

### Follow-ups (outside the frozen scope)

- The receiving/reservation deadlock, including the receipt cycle above.
- Supplier quotes above the RFQ quantity (the order line exceeds the allocation; the excess has no requirement).
- Editing committed requirements (quantity, item, status) without a claim check. 248 only stops a cancel from buying above capacity.

### Proof

- **`scripts/operations/apply-248.mjs`** (always rolled back): every case of the frozen contract through the governed chain (partial quotes via `fixtures.mjs`), replays, the 237 detail keys under an engine policy, `/has receipts/`, grants and `search_path`, the ledger's RLS and append-only triggers, event keys per order/stage/project, the lock order checked in the function sources, the view's 20 columns, and neutrality over every cancellable QA order (the Tucuruí demo excluded).
- **`scripts/operations/apply-249.mjs`** (always rolled back):
  - the three rewrites keep their grants, their `search_path`, every refusal and every line of the 248 code; the only line dropped is the replay's early return;
  - the lock order of every function above, checked in the source;
  - the sweep in sequence, including the replay repairing an RFQ that the proof leaves OPEN by direct writes;
  - the 248 proof gaps: the legacy ORDERED safeguard, the derived ORDERED on cancel and on issue, the budget order (the oldest requisition keeps the reopen), and the exact refusal of a fully released line;
  - neutrality: a replay over every cancelled QA requisition sweeps nothing.

  Each sabotage from the 248 review (s1–s7), and each 249 one, fails at least one proof. The cancel's requirement lock pointed at an empty set, and `decide` without its open-quantity filter, are caught only in the source; the race that depends on the cancel's lock is in qa-live.
- **Races with real commits, on a throwaway clone of QA with 249 applied:** the three removed cycles and the earlier races (issue ∥ cancel, decide ∥ requisition cancel, decide ∥ cancel, cancel ∥ `from_shortage`/reserve/transfer), with no deadlock and no over-claim. See `IMPLEMENTATION-LOG.md`, section 249.
- **`tests/qa-live/dashboard-supply-flow.spec.ts`**: the same partial-order story through the real routes, plus the races (cancel ∥ `from_shortage`, cancel ∥ reserve, issue ∥ cancel) under `forcedOverlap`.
