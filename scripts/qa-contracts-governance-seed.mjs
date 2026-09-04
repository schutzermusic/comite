/**
 * Fase 8 §2: executa o runbook docs/qa/contracts-governance-live.md (§1–§7)
 * contra SUPABASE_DB_URL, adaptado para conexão direta (sem auth.uid()):
 * resolve o usuário owner_admin da organização e semeia as linhas [QA].
 *
 * Idempotente (guardas NOT EXISTS, marcador [QA]). Limpeza: runbook §9.
 *
 *   node scripts/qa-contracts-governance-seed.mjs
 */
import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config({ path: '.env' });
dotenv.config({ path: '.env.local' });

const dbUrl = process.env.SUPABASE_DB_URL;
if (!dbUrl) {
  console.error('SUPABASE_DB_URL ausente no .env/.env.local');
  process.exit(1);
}

const client = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
await client.connect();

const q = async (sql, params) => (await client.query(sql, params)).rows;

try {
  // §0 — resolve owner_admin + organização (substitui auth.uid() do runbook).
  const [me] = await q(`
    select p.user_id, p.organization_id, p.full_name
    from public.profiles p
    join public.user_roles ur on ur.user_id = p.user_id
    join public.roles r on r.id = ur.role_id and r.key = 'owner_admin'
    limit 1`);
  if (!me) throw new Error('Nenhum owner_admin encontrado.');
  console.log(`Organização: ${me.organization_id} · owner_admin: ${me.full_name} (${me.user_id})`);

  // §1 — contrato alvo [QA].
  await client.query(
    // `data_class = 'demo'` é explícito: este contrato é fixture e NUNCA pode
    // alimentar exposição, saúde ou PDF oficiais (migration 091).
    `insert into public.contracts (organization_id, title, contract_number, counterparty_name,
                                   contract_type, status, currency, total_value, risk_level,
                                   owner_user_id, created_by, updated_by, data_class)
     select $1, '[QA] Contrato de Serviços', 'QA-0001', 'Fornecedor QA Ltda.',
            'Prestação de serviços', 'active', 'BRL', 1200000, 'medium', $2, $2, $2, 'demo'
     where not exists (
       select 1 from public.contracts c
       where c.organization_id = $1 and c.title = '[QA] Contrato de Serviços')`,
    [me.organization_id, me.user_id],
  );

  /*
    A fixture precisa ESTAR utilizável, e não apenas existir.

    O `where not exists` acima ignora `deleted_at`, de propósito — recriar um
    segundo `[QA] Contrato de Serviços` ao lado de um excluído produziria duas
    fixtures com o mesmo nome. Mas então uma exclusão anterior deixava a linha
    presente e invisível, o SELECT com `deleted_at is null` não achava nada, e o
    script quebrava com "Cannot read properties of undefined". Foi o que
    aconteceu nesta base: o contrato QA estava excluído desde um teste anterior.

    Reviver é o comportamento certo AQUI e só aqui: a linha é `data_class='demo'`,
    foi criada por este mesmo script, e nunca entra em métrica oficial. Nenhum
    contrato real é tocado.
  */
  const revived = await q(
    `update public.contracts
        set deleted_at = null, updated_by = $2, updated_at = now()
      where organization_id = $1 and title = '[QA] Contrato de Serviços' and deleted_at is not null
      returning id`,
    [me.organization_id, me.user_id],
  );
  if (revived.length > 0) console.log(`Fixture QA reativada (${revived.length} linha).`);

  const [target] = await q(
    `select id as contract_id, organization_id, owner_user_id
     from public.contracts
     where organization_id = $1 and title = '[QA] Contrato de Serviços' and deleted_at is null
     limit 1`,
    [me.organization_id],
  );
  if (!target) throw new Error('Fixture [QA] Contrato de Serviços não pôde ser criada nem reativada.');
  console.log('Contrato QA:', target.contract_id);
  const T = [target.organization_id, target.contract_id, target.owner_user_id];

  // §2 — obrigações (open / overdue / done).
  await client.query(
    `insert into public.contract_obligations (organization_id, contract_id, title, description, owner_user_id, status, due_date, evidence)
     select $1, $2, x.title, x.descr, $3, x.status, x.due, x.evidence
     from (values
       ('[QA] Entregar apólice de garantia', 'Garantia contratual', 'open',    (now() + interval '20 days')::date, 'Apólice assinada'),
       ('[QA] Medição física fase 1',        'Aceite técnico',      'overdue', (now() - interval '5 days')::date,  'Boletim de medição'),
       ('[QA] Relatório de conformidade',    'Compliance',          'done',    (now() - interval '30 days')::date, 'Relatório aprovado')
     ) as x(title, descr, status, due, evidence)
     where not exists (
       select 1 from public.contract_obligations o where o.contract_id = $2 and o.title = x.title)`,
    T,
  );

  // §3 — eventos de faturamento (pago / pendente / pendente-vencido).
  await client.query(
    `insert into public.contract_billing_events (organization_id, contract_id, title, amount, due_date, paid_at, status)
     select $1, $2, x.title, x.amount, x.due, x.paid, x.status
     from (values
       ('[QA] Mobilização (10%)',    120000, (now() - interval '25 days')::date, (now() - interval '24 days'), 'pago'),
       ('[QA] Medição fase 1 (40%)', 480000, (now() + interval '10 days')::date, null::timestamptz, 'pendente'),
       ('[QA] Encerramento (50%)',   600000, (now() - interval '3 days')::date,  null::timestamptz, 'pendente')
     ) as x(title, amount, due, paid, status)
     where not exists (
       select 1 from public.contract_billing_events b where b.contract_id = $2 and b.title = x.title)`,
    T.slice(0, 2),
  );

  // §4 — documentos (approved / pending_approval / rejected) com proveniência 035.
  await client.query(
    `insert into public.contract_documents (organization_id, contract_id, title, file_path, document_type, status, uploaded_by, approved_at, approved_by, rejection_reason)
     select $1, $2, x.title, x.path, x.dtype, x.status, $3,
            case when x.status = 'approved' then now() end,
            case when x.status = 'approved' then $3::uuid end,
            x.reason
     from (values
       ('[QA] Contrato assinado.pdf', 'qa/contract.pdf',  'contract',  'approved',         null),
       ('[QA] Apólice de seguro.pdf', 'qa/insurance.pdf', 'insurance', 'pending_approval', null),
       ('[QA] Aditivo rejeitado.pdf', 'qa/amend.pdf',     'amendment', 'rejected',         'Cláusula de reajuste incompatível')
     ) as x(title, path, dtype, status, reason)
     where not exists (
       select 1 from public.contract_documents d where d.contract_id = $2 and d.title = x.title)`,
    T,
  );

  // §5 — workflow de aprovação com timestamps reais p/ SLA (036: started_at/completed_at).
  //
  // O revisor NÃO pode ser quem cadastrou o contrato: a migration 100 passou a
  // exigir segregação de funções no banco, e o trigger vale também para a chave
  // de serviço — inclusive para este script. Antes a fixture semeava
  // `reviewer_user_id = owner_user_id` e gravava `approved`, ou seja, ela
  // codificava exatamente o defeito que a Fase 0.2 corrigiu.
  //
  // Sem um segundo usuário na organização não existe aprovação legítima a
  // semear, e a fixture diz isso em vez de inventar uma.
  const [reviewer] = await q(
    `select p.user_id from public.profiles p
      where p.organization_id = $1 and p.user_id <> $2 limit 1`,
    [me.organization_id, me.user_id],
  );
  if (!reviewer) {
    console.warn(
      'AVISO: nenhum segundo usuário na organização — a etapa `juridico` será semeada como `under_review`, ' +
      'não como `approved`. Segregação de funções (migration 100) impede o autor de decidir o próprio contrato.',
    );
  }
  const reviewerId = reviewer?.user_id ?? me.user_id;
  const juridicoStatus = reviewer ? 'approved' : 'under_review';
  // Parênteses obrigatórios: sem eles `::timestamptz` liga no literal do
  // interval, e o Postgres recusa com "cannot cast type interval to timestamptz".
  const juridicoApprovedAt = reviewer ? "(now() - interval '20 hours')" : 'null';

  await client.query(
    `insert into public.contract_approvals (organization_id, contract_id, step_name, status, reviewer_user_id, deadline_date, comments, approval_timestamp, created_at, started_at, completed_at)
     select $1, $2, x.step, x.status, $3, x.deadline, x.comments, x.appr_ts, x.created,
            x.created, x.appr_ts
     from (values
       ('juridico',   '${juridicoStatus}', (now() + interval '2 days')::date, '[QA] parecer ok', ${juridicoApprovedAt}::timestamptz, now() - interval '2 days'),
       ('financeiro', 'under_review', (now() + interval '3 days')::date, '[QA] em análise', null::timestamptz,           now() - interval '1 day'),
       ('comite',     'pending',      (now() + interval '7 days')::date, null,              null::timestamptz,           now() - interval '6 hours')
     ) as x(step, status, deadline, comments, appr_ts, created)
     where not exists (
       select 1 from public.contract_approvals a where a.contract_id = $2 and a.step_name = x.step)`,
    [target.organization_id, target.contract_id, reviewerId],
  );

  // §6 — vínculos de projeto e risco (se existirem na org).
  await client.query(
    `insert into public.contract_project_links (organization_id, contract_id, project_id)
     select $1, $2, p.id from (select id from public.projects limit 1) p
     where not exists (select 1 from public.contract_project_links l where l.contract_id = $2)`,
    T.slice(0, 2),
  );
  await client.query(
    `insert into public.contract_risks_links (organization_id, contract_id, risk_id)
     select $1, $2, r.id from (select id from public.risks limit 1) r
     where not exists (select 1 from public.contract_risks_links l where l.contract_id = $2 and l.risk_id = r.id)`,
    T.slice(0, 2),
  );

  // §7 — tarefa de agenda + análise IA (best-effort: schema pode divergir).
  try {
    await client.query(
      `insert into public.tasks (organization_id, title, description, status, priority, due_at, assignee_user_id, related_contract_id, creator_user_id)
       select $1, '[QA] Revisar renovação', 'Tarefa QA', 'todo', 'medium', now() + interval '15 days', $3, $2, $3
       where not exists (select 1 from public.tasks k where k.related_contract_id = $2 and k.title = '[QA] Revisar renovação')`,
      T,
    );
    console.log('§7 tarefa de agenda: OK');
  } catch (err) {
    console.warn('§7 tarefa de agenda: PULADA —', err.message);
  }
  try {
    await client.query(
      `insert into public.contract_ai_analyses (organization_id, contract_id, status, summary, extracted_data, findings, created_by)
       select $1, $2, 'pending', '[QA] placeholder', '{"confidence":0.0}'::jsonb, '[]'::jsonb, $3
       where not exists (select 1 from public.contract_ai_analyses a where a.contract_id = $2)`,
      T,
    );
    console.log('§7 análise IA: OK');
  } catch (err) {
    console.warn('§7 análise IA: PULADA —', err.message);
  }

  // ── Verificações (§8, lado banco) ────────────────────────────────────────
  const [counts] = await q(
    `select
       (select count(*) from public.contract_obligations where contract_id = $1) as obligations,
       (select count(*) from public.contract_billing_events where contract_id = $1) as billing,
       (select count(*) from public.contract_documents where contract_id = $1) as documents,
       (select count(*) from public.contract_approvals where contract_id = $1) as approvals,
       (select count(*) from public.contract_project_links where contract_id = $1) as project_links,
       (select count(*) from public.contract_risks_links where contract_id = $1) as risk_links`,
    [target.contract_id],
  );
  console.log('Linhas ao vivo por seção:', counts);

  const docs = await q(
    `select title, status, approved_at is not null as has_approved_at,
            approved_by is not null as has_approved_by, rejection_reason
     from public.contract_documents where contract_id = $1 order by title`,
    [target.contract_id],
  );
  console.log('Documentos (035):');
  for (const d of docs) console.log(' ', d);

  const sla = await q(
    `select step_name, status,
            round(extract(epoch from (completed_at - started_at)) / 3600) as sla_hours
     from public.contract_approvals where contract_id = $1 order by created_at`,
    [target.contract_id],
  );
  console.log('SLA por etapa (036):', sla);

  // ── §7b — instrumentação operacional (P2B, migration 092) ────────────────
  //
  // Marcos, cláusulas e penalidades passaram a ter caminho de escrita. A
  // fixture cobre os três estados que o Contract-to-Cash precisa distinguir:
  // marco MEDIDO (entra na soma), marco PREVISTO (não entra), e cláusula
  // REGISTRADA mas não validada.
  await client.query(
    `insert into public.contract_milestones
       (organization_id, contract_id, title, milestone_type, status, due_date,
        completed_at, billing_amount, measured_amount, owner_user_id, evidence,
        created_by, updated_by)
     select $1, $2, '[QA] Medição física fase 1', 'Medição', 'measured', '2026-07-01',
            '2026-07-05T00:00:00Z', 480000, 455000, $3, 'Boletim de medição 01', $3, $3
     where not exists (
       select 1 from public.contract_milestones m
       where m.contract_id = $2 and m.title = '[QA] Medição física fase 1')`,
    T,
  );
  await client.query(
    `insert into public.contract_milestones
       (organization_id, contract_id, title, milestone_type, status, due_date,
        billing_amount, created_by, updated_by)
     select $1, $2, '[QA] Encerramento', 'Medição', 'pending', '2026-12-01', 600000, $3, $3
     where not exists (
       select 1 from public.contract_milestones m
       where m.contract_id = $2 and m.title = '[QA] Encerramento')`,
    T,
  );
  await client.query(
    `insert into public.contract_clauses
       (organization_id, contract_id, title, clause_type, risk_level, percentage,
        source_page, review_status, ai_flagged, created_by, updated_by)
     select $1, $2, '[QA] Multa por atraso de entrega', 'penalidade', 'high', 2, 12,
            'draft', false, $3, $3
     where not exists (
       select 1 from public.contract_clauses c
       where c.contract_id = $2 and c.title = '[QA] Multa por atraso de entrega')`,
    T,
  );
  await client.query(
    `insert into public.contract_penalties
       (organization_id, contract_id, clause_id, title, penalty_type, percentage,
        trigger_condition, status, created_by, updated_by)
     select $1, $2,
            (select id from public.contract_clauses
              where contract_id = $2 and title = '[QA] Multa por atraso de entrega' limit 1),
            '[QA] Multa 2% sobre o saldo', 'contratual', 2,
            'Atraso superior a 5 dias na entrega', 'active', $3, $3
     where not exists (
       select 1 from public.contract_penalties p
       where p.contract_id = $2 and p.title = '[QA] Multa 2% sobre o saldo')`,
    T,
  );
  console.log('Instrumentação (092):', await q(
    `select
       (select count(*) from public.contract_milestones where contract_id = $1) as marcos,
       (select count(*) from public.contract_clauses where contract_id = $1) as clausulas,
       (select count(*) from public.contract_penalties where contract_id = $1) as penalidades`,
    [target.contract_id],
  ));

  const policies = await q(
    `select tablename, count(*) as policies from pg_policies
     where tablename in ('contract_obligations','contract_billing_events','contract_documents','contract_approvals','contract_project_links','contract_risks_links')
     group by tablename order by tablename`,
  );
  console.log('Policies RLS por tabela:', policies);

  const [infra] = await q(
    `select
       exists(select 1 from information_schema.tables where table_name = 'audit_logs') as audit_logs_table,
       exists(select 1 from pg_proc where proname = 'create_notification') as create_notification_rpc,
       exists(select 1 from information_schema.tables where table_name = 'notifications') as notifications_table`,
  );
  console.log('Infra de auditoria/notificação:', infra);

  console.log('\nRunbook §1–§7 semeado. Validar §8 na UI logado como owner_admin.');
} catch (err) {
  console.error('Erro no runbook:', err);
  process.exitCode = 1;
} finally {
  await client.end();
}
