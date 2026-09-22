# Commercial workspace refinement

The six Commercial areas keep their information architecture, their navigation and their visual language. This round adds **product depth**: detail workspaces, governed stage transitions, real follow-up creation, deterministic signals and forecast movement. No screen was redesigned from scratch, no seventh area was added, and no parallel domain was created.

## Screens and workspaces

| Screen | Result |
| --- | --- |
| Visão Geral | Integrated KPI strip; open and weighted pipeline; blocking-signal count; a decision queue driven by the same deterministic signals the areas show; conversion definition; creation momentum; permission-aware opportunity creation. |
| Contas & Contatos | Account and contact views, search, relationship filters, counters and contact creation against an existing canonical party — plus **Account 360**, a contextual drawer gathering contacts, opportunities, proposals, authorized work, projects, commercial history and open follow-ups around one `party_id`. |
| Oportunidades | **Opportunity workspace** drawer (account, contacts, value, stage, probability, expected close, owner, next action, stage aging, follow-ups, linked proposals, activity timeline, signals); governed stage transitions with a mandatory reason on loss/abandonment; signal cuts (stalled, no next action, overdue response, missing close date, proposal at risk, stage/probability mismatch); owner and currency filters; full **pipeline/list parity**. |
| Follow-ups | Real creation on the canonical `apex_followups` engine, with a subject picker so no commitment is orphaned; governed state transitions; subject and counterparty resolution; owner filter; waiting-on-customer bucket. |
| Propostas | **Proposal workspace** drawer: technical and commercial framing, all revisions with the governing one marked, value, payment terms, validity, acceptance state and provenance, documents, extracted facts grouped by domain with page/quote provenance and promotability, open divergences, and the staged handoff to the Internal Service Order. |
| Forecast | Executive workspace: gross and weighted pipeline by expected-close month, **movement in and out of the forecast** derived from append-only stage history, filters by owner/customer/stage applied to chart and tables alike, a selectable movement window, and the zero-data structure preserved. |

## Operational capabilities added

- **Governed stage transitions.** Stage stopped being a form field. `commercial_opportunity_transition_stage` records every change with actor, reason and timestamp; closing as lost or abandoned demands a stated reason; a closed opportunity does not return to the funnel. `commercial_opportunity_upsert` no longer touches stage after creation — one path, not two.
- **Stage aging.** `stage_entered_at` is stamped by the transition, so "how long has this been stuck" survives any other edit to the row. `updated_at` never answered that question honestly.
- **Real commercial follow-ups.** The previously disabled scheduling button now opens a commitment in `apex_followups` — the same engine, state machine, append-only history and verified-completion rule as post-sale. Only the authority predicate changed: a commercial source kind asks for `commercial.manage` instead of `contracts.edit`.
- **Deterministic signals.** Eight rules over dates and states: no next action, customer response overdue, proposal expiring, proposal validity lapsed, opportunity stalled, missing expected close, stage/probability inconsistent, won without authorized work. Each carries a suggested action and a destination; none writes anything, and none is a generic AI recommendation.
- **Forecast movement without snapshots.** Entries and exits are reconstructed from stage history for any window, instead of a daily photograph table that ages on its own and lies when the job does not run.

## Canonical architecture reused

`commercial_engagement`, canonical `parties`, `apex_followups`, the proposal/version model, `contract_documents`, `commercial_extracted_facts`, `internal_service_orders`, `commercial_divergences` and `engagement_project_links` are all read as they are. No duplicate customer master, no second follow-up engine, no parallel measurement or billing path, no "activity" table — the timeline is assembled from records that already exist (stage events, revision stamps, follow-ups).

Every write still goes through a governed `SECURITY DEFINER` function called by the server after the route has decided authorization; the browser writes to no commercial table. Signals are computed server-side once (`pipeline-signals.ts`, pure and unit-tested), so list, kanban, dossier and overview cannot disagree.

Sections whose data lives under `contracts.view` or `projects.view` — divergences, service orders, authorized work, projects, documents — come back marked **restricted**, not empty. "No divergences" and "you may not see divergences" are opposite answers, and showing the second as the first is how a block becomes invisible.

## Scope limitations

- Owner names are resolved server-side for the ids already present in rows the caller can see. `profiles_select_scoped` was not loosened; nothing but the name crosses.
- Proposal facts are read and shown with provenance, but confirming a fact still happens through the existing governed path, not from these drawers.
- The follow-up composer assigns a responsible as text. Assigning a named platform user goes through `apex_followup_assign` and is not yet surfaced here.
- Counters and analysis use the records returned by existing endpoints with their existing limits; this work adds no server pagination.

## Verification

- `npm run typecheck` — clean.
- `npm run test:unit` — 124 files, 2736 tests, including `tests/unit/commercial-pipeline-signals.test.ts` (27 cases pinning every threshold, the governing-revision rule and the stage transition table that mirrors the SQL).
- `npm run verify:commercial` — end-to-end proof, structural invariants and security audit all clean at migration tip 212.
- Integration: `contracts-operationalization-live`, `contracts-operationalization-final-blockers-live`, `contracts-phase7-security-contract`, `contracts-phase7-live`, `project-measurement-live`.
- Playwright: `tests/commercial-workspace-ui.spec.ts` (16 tests) and `tests/commercial-module.spec.ts` (18 tests), covering all six areas in light and dark at 1440 and 390, the three detail workspaces, the governed stage change, follow-up creation with idempotency, restricted sections, pipeline/list parity and forecast movement. Test payloads are intercepted inside Playwright and never written to the database.

Screenshots in `output/commercial-ui/`.
