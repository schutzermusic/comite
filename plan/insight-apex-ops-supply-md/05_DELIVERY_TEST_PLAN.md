# Insight Apex — Operations + Supply Chain
## Delivery, Branching, Verification and Test Plan

---

# 1. Branch strategy

Do not implement the entire program in one branch.

Suggested sequence after the current Commercial Proposal Context work is merged and manually validated:

1. `feat/operations-service-orders`
2. `feat/operations-project-planning`
3. `feat/operations-map`
4. `feat/supply-chain-foundation`
5. `feat/inventory-reservations`
6. `feat/procurement-sourcing`
7. `feat/receiving-logistics`

Exact naming may follow repository conventions.

Each branch must begin from the latest integrated base, not a stale feature branch.

---

# 2. Mandatory discovery before coding

For every branch, first return a short report:

- current branch and HEAD;
- dirty/untracked files;
- relevant existing migrations;
- relevant existing schema/tables/functions;
- relevant routes/services/components;
- existing permissions;
- reusable primitives;
- conflicts or duplicate concepts;
- proposed changes.

Do not reset, clean or overwrite unrelated work.

---

# 3. Database migration rules

Before choosing migration number:

- inspect `supabase/migrations`;
- inspect other active worktrees/branches if accessible;
- avoid the Fiscal reserved range 220–229 unless plans have changed;
- use reversible/read-only preview scripts for risky backfills;
- prove real-data compatibility before apply;
- never fabricate migration success.

For migrations that transform existing business data:

1. read-only preview;
2. ambiguity report;
3. dry-run transaction;
4. security audit;
5. explicit apply approval when requested;
6. post-apply verification.

---

# 4. Test pyramid

## Unit

Cover:

- state transition rules;
- requirement coverage math;
- reservation availability;
- partial receiving;
- divergence classification;
- project/supply aggregation;
- permission checks;
- idempotency helpers.

## Database proofs

Prove:

- tenant isolation;
- cross-org foreign references refused;
- browser cannot call protected functions;
- no double reservation;
- project handoff idempotent;
- PO/source traceability;
- partial receiving accounting;
- immutable/audited history.

## Integration

Golden path:

```text
Accepted proposal package
→ OS
→ Project
→ Planning requirement
→ Inventory coverage
→ Shortage
→ Purchase requisition
→ Quote / approval
→ PO
→ Partial receipt
→ Final receipt
→ Inventory/project availability update
```

Exception paths:

- blocking OS divergence;
- insufficient stock under concurrency;
- transfer instead of purchase;
- procurement approval rejected;
- PO cancelled;
- receiving discrepancy;
- receipt exceeds open PO quantity;
- wrong-tenant references;
- repeated/retried action.

## Browser / Playwright

Critical flows only; do not make screenshots the source of truth.

Test:

- create/import OS;
- review divergence;
- issue OS;
- link/create project;
- planning requirement;
- material planning shortage;
- inventory reservation;
- procurement decision;
- receiving mobile flow.

---

# 5. Real-data safety

Where `.env.local` points to hosted Supabase:

- do not create production business records unless explicitly authorized;
- prefer read-only verification;
- use rolled-back DB proofs;
- use intercepted browser states when UI verification does not require live writes;
- clearly identify any intentional live write test.

Manual user validation should be separate from automated fixture validation.

---

# 6. Security audit expansion

Extend security audit for each new domain.

Verify:

- RLS enabled;
- policies coherent;
- no anonymous protected reads/writes;
- no browser direct execution of server-only functions;
- function grants explicit;
- tenant coherence;
- history protection;
- canonical permission seeds;
- no test/fixture data masquerading as production truth.

---

# 7. Performance considerations

Prioritize server-side aggregation/read models for control towers.

Avoid N+1 reads in:

- Project 360;
- Supply Chain Overview;
- Material Planning;
- Inventory position;
- Procurement queues.

Indexes should match actual query paths:

- organization + status;
- project + activity;
- item + location;
- requirement + status;
- PO + supplier/status;
- need date / expected date;
- project/source references.

Do not add indexes blindly; verify query patterns.

---

# 8. Observability

For critical governed actions log/trace:

- action type;
- actor/principal;
- organization;
- target entity;
- duration;
- result;
- idempotency key where relevant;
- provider/model for AI tasks;
- error classification.

Never log secrets or unnecessary sensitive data.

---

# 9. Definition of done for a branch

Return:

1. files changed;
2. migrations created/applied status;
3. architecture decisions;
4. invariants implemented;
5. permissions/RLS changes;
6. tests and exact counts;
7. browser verification;
8. real-data impact;
9. known debt;
10. exact commit recommendation;
11. FINAL VERDICT: READY / NOT READY.

No “production ready” claim if live paths or invariants were not actually tested.

---

# 10. Manual acceptance checklist — Service Orders

- upload an existing OS PDF;
- extraction creates structured review, not raw text dump;
- provenance available;
- generate OS from accepted PT+PC;
- exact governing revisions shown;
- divergence engine catches a known mismatch;
- blocking divergence prevents normal issuance;
- OS issues successfully when clean;
- create/link project once;
- retry does not duplicate project.

---

# 11. Manual acceptance checklist — Planning

- create work package/activity;
- define material requirement and need date;
- link to project/OS;
- readiness reflects missing material;
- requirement appears in Material Planning;
- changes are reflected without duplicated state.

---

# 12. Manual acceptance checklist — Inventory

- receive stock;
- on-hand updates;
- reserve partial stock for Project A;
- available quantity decreases;
- Project B cannot reserve the already-reserved quantity;
- release reservation restores availability;
- transfer preserves source/destination history;
- project issue/consumption is auditable.

---

# 13. Manual acceptance checklist — Procurement

- shortage creates/prepares requisition;
- source project/requirement visible;
- multiple supplier quotes captured;
- comparison shows cost, ETA and conditions;
- approval permission enforced;
- PO retains requisition/source links;
- unauthorized browser path cannot issue PO.

---

# 14. Manual acceptance checklist — Receiving

- locate PO;
- receive partial quantity;
- PO remains partially received;
- remaining quantity correct;
- stock posting correct;
- second receipt completes order when appropriate;
- damaged/rejected quantity handled separately;
- evidence/document retained;
- downstream finance hook receives canonical PO/receipt facts.

