# QA — Deliberações (Live Supabase Backbone)

Runbook for validating the Decision Control Room (`/deliberacoes`) against live
Supabase data and the operational mutations (vote / opinion / evidence /
execution / minutes / task).

## 0. Architecture recap

- **UI page:** `src/app/(main)/deliberacoes/page.tsx` (Decision Control Room).
- **View-model:** `src/hooks/use-deliberacoes-view.ts` — live-first; maps the
  shared `DeliberationItem` backbone to the `Deliberacao` view shape via
  `src/lib/deliberacoes/live-adapter.ts`. Falls back to `DELIBERACOES_MOCK`
  **only** when Supabase env vars are absent (`isDemo`), and disables real
  mutations in that mode.
- **Live services:** `src/lib/services/deliberations.ts`
  (`listDeliberations`, `castVote`, `requestOpinion`, `attachEvidence`,
  `upsertExecutionItem`, `generateMinutes`, `createDeliberationTask`).
- **Tables:** `deliberations`, `deliberation_votes` (migration 010).
  Opinions / evidence / execution / minutes / audit trail persist as JSONB on
  the `deliberations` row by design (the migration header states re-runs must
  be a no-op; detail is not normalized into separate tables).
- **Audit:** dual — JSONB `audit_trail` (drawer timeline) **and** the
  enterprise `audit_logs` table via `logAuditEvent` (action taxonomy below).
- **Notifications:** shared `create_notification` SECURITY DEFINER RPC
  (best-effort, never blocks a mutation).
- **Permissions:** migrations 005 + **037** (new: `deliberations.edit`,
  `request_opinion`, `attach_evidence`, `execute`, `minutes`, `admin`).

## 1. Prerequisites

```bash
# .env.local must define:
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...   # server-only, seed script bypasses RLS
```

Apply migrations (010 core + 037 perms) to the target project, then confirm:

```sql
select key from permissions where key like 'deliberations.%' order by key;
-- expect the 6 new keys from 037 present.
```

## 2. Seed the QA matrix

```bash
npx tsx scripts/qa-deliberations-seed.mjs            # additive
npx tsx scripts/qa-deliberations-seed.mjs --reset    # wipe org's deliberations first
# optional: SUPABASE_SEED_ORG_ID=<uuid> SUPABASE_SEED_USER_ID=<uuid>
```

The seed creates deliberations covering every QA state:

| Scenario              | Status            | Notable data |
|-----------------------|-------------------|--------------|
| Draft                 | `draft`           | no votes |
| In review             | `in_review`       | pending opinion (reviews) |
| Voting (partial)      | `in_voting`       | quorumRequired 5 / present 2, 2 votes |
| Overdue               | `in_voting`       | dueDate in the past → SLA overdue |
| Critical              | `in_review`       | priority=critical, riskLevel=critical |
| Awaiting minutes      | `awaiting_minutes`| voteResult approved |
| In execution          | `in_execution`    | execution_items pending + evidence attached |
| Resolved              | `resolved`        | minutes published, audit rows |

## 3. UI checks (live mode — `isDemo` false, no "Demonstração" banner)

- [ ] Page opens; KPI band, pipeline, tabs and queue reflect seeded counts.
- [ ] KPI filters (Abertas / Críticas / Aguardando voto / Atrasadas / Execuções)
      single-select; clicking clears the pipeline stage and vice versa.
- [ ] Pipeline stage filter narrows the queue; "Limpar estágio" clears it.
- [ ] Search matches title / code / committee / responsible / next action.
- [ ] Advanced filters (comitê / responsável / prioridade / SLA) apply and chip.
- [ ] Click a card → dossier drawer opens with identity, quorum, opinions,
      evidence, execution, ata, audit.

## 4. Mutation checks (drawer stays open, data refreshes in place)

- [ ] **Vote:** open the `in_voting` decision → "A favor/Contra/Abster" →
      tally + quorum bar update; `deliberation.vote_cast` in audit trail.
- [ ] **Request opinion:** `in_review` → "Solicitar parecer" → pending review
      appears; reviewer notified (if a reviewer user is set).
- [ ] **Attach evidence:** any open decision → "Anexar evidência" (link+name) →
      evidence list grows; audit `evidence_added`.
- [ ] **Execution:** `in_execution` → toggle an item (Iniciar/Concluir) and
      "Criar tarefa" → an Agenda task is created with
      `related_deliberation_id`; assignee notified by the Agenda service.
- [ ] **Minutes:** `awaiting_minutes` → "Lavrar ata" / "Gerar ata" → status
      advances to `resolved`; audit `minutes_generated`.
- [ ] **Report export:** header + drawer export show `source: Supabase`.

## 5. Audit taxonomy (audit_logs.action)

`deliberation.vote_cast`, `deliberation.opinion_requested`,
`deliberation.evidence_attached`, `deliberation.execution_started`,
`deliberation.execution_updated`, `deliberation.minutes_generated`,
`deliberation.task_created`. (Create/update/decision events already flow
through the existing `deliberations.ts` status transitions + JSONB trail.)

```sql
select action, count(*) from audit_logs
where entity_type = 'deliberation' group by action order by action;
```

## 6. RBAC / RLS

- [ ] A user **without** `deliberations.vote` sees the vote buttons disabled
      (UI) and an INSERT into `deliberation_votes` is rejected by RLS.
- [ ] A user without `deliberations.request_opinion` / `attach_evidence` /
      `execute` / `minutes` (and without `deliberations.create` fallback) sees
      those drawer actions disabled.
- [ ] Cross-org read returns 0 rows (org-scoped SELECT policy).
- [ ] `owner_admin` can perform every action.

## 7. Mobile / tablet

- [ ] No horizontal page overflow at 375px / 768px.
- [ ] KPI band stacks (the standalone pipeline section was removed — the full
      flow lives in the drawer stepper, which wraps instead of overflowing).
- [ ] Tabs scroll; cards single-column; drawer full-width; toasts visible.

## 8. Drawer dynamic flow ("Fluxo da Decisão")

The stepper derives the historical path from persisted signals
(`metadata.creationRoute`, `metadata.enteredReviewAt`, audit `entered_review`,
pareceres issued before `voting_window_start`) — never from the mere existence
of an optional parecer.

- [ ] **Direct-to-voting (e.g. simple HR decision)**: create with route
      "votação direta" → drawer shows `Criada → Em votação → Concluída`
      (no "Em revisão" step).
- [ ] **Review route without parecer**: create with route "revisão", advance
      to voting without any parecer issued → drawer still shows
      `Criada → Em revisão → Em votação → Concluída`.
- [ ] **Optional parecer during voting**: on a direct-to-voting decision,
      request a parecer while `in_voting` (answered or not) → "Em revisão"
      does NOT appear in the flow.
- [ ] "Aguardando ata" appears only when the decision awaits/has real minutes
      (rejected decisions resolve without an ata step); "Em execução" only
      with execution actions or status.
- [ ] Legacy rows (created before `creationRoute` existed) fall back to
      audit/parecer-timing heuristics; a legacy review-route decision already
      in voting may under-show "Em revisão" — expected.

## 9. Known boundaries (next phase)

- Creating a deliberation from **this** screen still shows the local-draft
  banner; persisted creation lives in `/pautas`. Wiring this screen's create
  form to `createDeliberation` is the next step.
- Opinion / evidence / task inputs currently use lightweight prompts. Replace
  with in-drawer forms (reviewer picker, file upload to Storage, assignee
  picker) in the follow-up.
- Detail entities remain JSONB. If reporting needs per-vote/opinion SQL
  analytics later, normalize into child tables in a dedicated migration.
