# QA Runbook — Contract Governance (live data)

Verify the **live** governance path (Phase 2–5) end-to-end against real
migration-034/035 rows. This is a **dev/staging-only** runbook. It does **not**
run automatically, contains **no hardcoded organization/contract values**, and is
**idempotent** (every insert is guarded by a `[QA]` marker + `NOT EXISTS`).

> ⚠️ Do **not** run in production. Run in the Supabase SQL editor (or `psql`) of a
> dev/staging project, authenticated as / impersonating a user of the target org.

---

## 0. Prerequisites

- Migrations applied **in order** through:
  - **034_contracts_control_room.sql** — obligations / approvals / documents / links.
  - **035_contract_documents_approved.sql** — `approved` document status +
    `approved_at` / `approved_by` / `rejection_reason`.
  - **036_contract_persistence_fields.sql** — obligation completion fields,
    approval `started_at` / `completed_at` / `requested_changes_note`, and billing
    `realized_amount` / `invoice_reference` / `realized_note` / `realized_by` /
    `realized_at`. Required for **step-level SLA** and realized-billing provenance.

  Apply with `supabase db push` (or run each file in the SQL editor in numeric order).
- At least one user + organization already exist.
- RLS is enabled — run as a member of the org whose data you want to seed, or use
  the service role in a **staging** project only.

Set the working ids once (replace the SELECTs if you prefer literal ids):

```sql
-- Pick the current org + an owner user. Adjust the WHERE clauses to your org.
\set ON_ERROR_STOP on
-- These are illustrative; in the Supabase SQL editor use CTEs instead of \set.
```

The blocks below resolve org/owner/contract inline via CTEs, so you can paste them
as-is. They target the **most recently updated active contract** in the org of the
user you choose. Change `p.user_id = auth.uid()` to a specific `user_id` if not
running as that user.

---

## 1. Ensure a target contract exists

Creates one `[QA] Contrato` if the org has no active contract yet.

```sql
with me as (
  select p.user_id, p.organization_id
  from public.profiles p
  where p.user_id = auth.uid()      -- or: where p.user_id = '<USER_UUID>'
  limit 1
)
insert into public.contracts (organization_id, title, contract_number, counterparty_name,
                              contract_type, status, currency, total_value, risk_level,
                              owner_user_id, created_by, updated_by)
select me.organization_id, '[QA] Contrato de Serviços', 'QA-0001', 'Fornecedor QA Ltda.',
       'Prestação de serviços', 'active', 'BRL', 1200000, 'medium',
       me.user_id, me.user_id, me.user_id
from me
where not exists (
  select 1 from public.contracts c
  where c.organization_id = me.organization_id and c.title = '[QA] Contrato de Serviços'
);
```

A reusable CTE for the following steps (resolves org + the QA/most-recent contract):

```sql
-- Paste this `with target as (...)` prefix before each insert block below.
with target as (
  select c.id as contract_id, c.organization_id, c.owner_user_id
  from public.contracts c
  join public.profiles p on p.organization_id = c.organization_id and p.user_id = auth.uid()
  where c.deleted_at is null
  order by (c.title = '[QA] Contrato de Serviços') desc, c.updated_at desc
  limit 1
)
```

---

## 2. Obligations (open / overdue / completed)

```sql
with target as ( /* ← paste the CTE from §1 */ )
insert into public.contract_obligations (organization_id, contract_id, title, description, owner_user_id, status, due_date, evidence)
select t.organization_id, t.contract_id, x.title, x.descr, t.owner_user_id, x.status, x.due, x.evidence
from target t
cross join (values
  ('[QA] Entregar apólice de garantia', 'Garantia contratual', 'open',    (now() + interval '20 days')::date, 'Apólice assinada'),
  ('[QA] Medição física fase 1',        'Aceite técnico',      'overdue', (now() - interval '5 days')::date,  'Boletim de medição'),
  ('[QA] Relatório de conformidade',    'Compliance',          'done',    (now() - interval '30 days')::date, 'Relatório aprovado')
) as x(title, descr, status, due, evidence)
where not exists (
  select 1 from public.contract_obligations o where o.contract_id = t.contract_id and o.title = x.title
);
```

## 3. Billing events (planned / realized / overdue)

```sql
with target as ( /* ← §1 CTE */ )
insert into public.contract_billing_events (organization_id, contract_id, title, amount, due_date, paid_at, status)
select t.organization_id, t.contract_id, x.title, x.amount, x.due, x.paid, x.status
from target t
cross join (values
  ('[QA] Mobilização (10%)', 120000, (now() - interval '25 days')::date, (now() - interval '24 days'), 'pago'),
  ('[QA] Medição fase 1 (40%)', 480000, (now() + interval '10 days')::date, null::timestamptz, 'pendente'),
  ('[QA] Encerramento (50%)', 600000, (now() - interval '3 days')::date, null::timestamptz, 'pendente')
) as x(title, amount, due, paid, status)
where not exists (
  select 1 from public.contract_billing_events b where b.contract_id = t.contract_id and b.title = x.title
);
```

## 4. Documents (uploaded / pending / approved / rejected)

`file_path` here is a placeholder pointer; no file is uploaded to storage.

```sql
with target as ( /* ← §1 CTE */ )
insert into public.contract_documents (organization_id, contract_id, title, file_path, document_type, status, uploaded_by, approved_at, approved_by, rejection_reason)
select t.organization_id, t.contract_id, x.title, x.path, x.dtype, x.status, t.owner_user_id, x.appr_at, x.appr_by, x.reason
from target t
cross join (values
  ('[QA] Contrato assinado.pdf', 'qa/contract.pdf', 'contract',  'approved', now(), null, null),
  ('[QA] Apólice de seguro.pdf', 'qa/insurance.pdf','insurance', 'pending_approval', null, null, null),
  ('[QA] Aditivo rejeitado.pdf', 'qa/amend.pdf',    'amendment', 'rejected', null, null, 'Cláusula de reajuste incompatível')
) as x(title, path, dtype, status, appr_at, appr_by, reason)
where not exists (
  select 1 from public.contract_documents d where d.contract_id = t.contract_id and d.title = x.title
);
-- approved_by is left null to avoid coupling to a specific user; set it to a real
-- auth.users id if you want the "Aprovado por" provenance populated.
```

## 5. Approval workflow (for SLA)

`created_at` in the past + `approval_timestamp` gives a real, live SLA duration.

```sql
with target as ( /* ← §1 CTE */ )
insert into public.contract_approvals (organization_id, contract_id, step_name, status, reviewer_user_id, deadline_date, comments, approval_timestamp, created_at)
select t.organization_id, t.contract_id, x.step, x.status, t.owner_user_id, x.deadline, x.comments, x.appr_ts, x.created
from target t
cross join (values
  ('juridico',   'approved',     (now() + interval '2 days')::date, '[QA] parecer ok',      now() - interval '20 hours', now() - interval '2 days'),
  ('financeiro', 'under_review', (now() + interval '3 days')::date, '[QA] em análise',      null::timestamptz,           now() - interval '1 day'),
  ('comite',     'pending',      (now() + interval '7 days')::date, null,                    null::timestamptz,           now() - interval '6 hours')
) as x(step, status, deadline, comments, appr_ts, created)
where not exists (
  select 1 from public.contract_approvals a where a.contract_id = t.contract_id and a.step_name = x.step
);
```

## 6. Project + risk links

```sql
-- Project link (only if the org has a project; links the first one found).
with target as ( /* ← §1 CTE */ ), proj as (select id from public.projects limit 1)
insert into public.contract_project_links (organization_id, contract_id, project_id)
select t.organization_id, t.contract_id, proj.id
from target t cross join proj
where proj.id is not null
  and not exists (select 1 from public.contract_project_links l where l.contract_id = t.contract_id);

-- Risk link (only if the org has a risk).
with target as ( /* ← §1 CTE */ ), rk as (select id from public.risks limit 1)
insert into public.contract_risks_links (organization_id, contract_id, risk_id)
select t.organization_id, t.contract_id, rk.id
from target t cross join rk
where rk.id is not null
  and not exists (select 1 from public.contract_risks_links l where l.contract_id = t.contract_id and l.risk_id = rk.id);
```

## 7. Agenda task + AI analysis (optional)

```sql
-- Contract-linked agenda task (read-side "I · Tarefas na agenda").
with target as ( /* ← §1 CTE */ )
insert into public.tasks (organization_id, title, description, status, priority, due_at, assignee_user_id, related_contract_id, creator_user_id)
select t.organization_id, '[QA] Revisar renovação', 'Tarefa QA', 'todo', 'medium',
       now() + interval '15 days', t.owner_user_id, t.contract_id, t.owner_user_id
from target t
where not exists (select 1 from public.tasks k where k.related_contract_id = t.contract_id and k.title = '[QA] Revisar renovação');
-- NOTE (validated Fase 8): the 031 schema uses `creator_user_id`, not `created_by`.

-- AI analysis (pending placeholder).
with target as ( /* ← §1 CTE */ )
insert into public.contract_ai_analyses (organization_id, contract_id, status, summary, extracted_data, findings, created_by)
select t.organization_id, t.contract_id, 'pending', '[QA] placeholder', '{"confidence":0.0}'::jsonb, '[]'::jsonb, t.owner_user_id
from target t
where not exists (select 1 from public.contract_ai_analyses a where a.contract_id = t.contract_id);
```

---

## 8. Verify in the UI

Open **Gestão de Contratos** → open the `[QA]` contract drawer and confirm:

- Governance chip reads **“Governança: X/Y seções ao vivo”** (not “estimada”).
- Sections B–E show **Ao vivo** badges where rows exist.
- **F · Obrigações**: 3 rows (open/overdue/done); Concluir + Criar tarefa work.
- **G · Faturamento**: 3 rows; “Marcar faturado” opens the modal; realized moves
  **Valor faturado / Saldo a faturar** KPIs.
- **H · Documentos**: approved/pending/rejected chips; Aprovar / Rejeitar (modal
  with reason) work.
- **D · Governança → SLA por etapa**: with §5 seeded (jurídico completed in 20h,
  financeiro under_review, comitê pending), confirm the per-step grid shows
  `Jurídico 20h`, financeiro/comitê as `—`/`open`, the **Ao vivo** badge (real
  `completed_at`), and any overdue/rejected banner. The top **SLA médio** KPI and
  the drawer "SLA médio" pill should both read the real average, and the KPI
  subline should say **“aprovação · ao vivo”**.
- Approve the pending document (§4) → status chip flips to **Aprovado**; it drops
  out of “Docs faltantes”. Reject one → modal requires a reason; `rejection_reason`
  is persisted on the row.
- Mark a billing event realized via the modal → `realized_amount` / `realized_at` /
  `invoice_reference` populate; **Valor faturado** / **Saldo a faturar** move.
- Complete an obligation with a note → `completion_note` / `completed_by` /
  `completed_at` populate.
- **Tabs**: open the **Obrigações** tab → Concluir / Criar tarefa per live row;
  open the **Documentos** tab → the “Documentos ao vivo” panel with Aprovar /
  Rejeitar / Enviar para aprovação. After each, the tab stays active, filters/
  selected contract persist, and KPIs/counts update (no full reload).
- **I · Tarefas na agenda**: the `[QA]` task appears.
- Reject a document → confirm an `audit_logs` row `contract.document_rejected` and
  a `notifications` row for the owner.

## 9. Cleanup (dev/staging only)

```sql
-- Removes only the [QA]-marked rows and the QA contract.
delete from public.contract_obligations where title like '[QA]%';
delete from public.contract_billing_events where title like '[QA]%';
delete from public.contract_documents where title like '[QA]%';
delete from public.contract_approvals a using public.contracts c
  where a.contract_id = c.id and c.title = '[QA] Contrato de Serviços';
delete from public.tasks where title like '[QA]%';
delete from public.contract_ai_analyses a using public.contracts c
  where a.contract_id = c.id and c.title = '[QA] Contrato de Serviços';
delete from public.contract_project_links l using public.contracts c
  where l.contract_id = c.id and c.title = '[QA] Contrato de Serviços';
delete from public.contract_risks_links l using public.contracts c
  where l.contract_id = c.id and c.title = '[QA] Contrato de Serviços';
delete from public.contracts where title = '[QA] Contrato de Serviços';
```
