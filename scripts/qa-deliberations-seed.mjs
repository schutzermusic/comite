/**
 * QA seed for the Decision Control Room (docs/qa/deliberations-live.md §2).
 *
 * Direct-DB (pg) seed — resolves the owner_admin + organization (substitutes
 * auth.uid()) and inserts the full QA matrix of deliberations into
 * public.deliberations (+ a real vote into public.deliberation_votes).
 *
 * Detail (opinions / evidence / execution / minutes / audit) is written into
 * the JSONB columns/metadata exactly as the live services persist them, so the
 * `/deliberacoes` adapter renders it 1:1.
 *
 * Idempotent: every row is tagged with a "[QA]" title prefix and guarded by
 * NOT EXISTS. Use --reset to delete the org's [QA] deliberations first
 * (deliberation_votes cascades via FK).
 *
 *   node scripts/qa-deliberations-seed.mjs
 *   node scripts/qa-deliberations-seed.mjs --reset
 *
 * Env: SUPABASE_DB_URL (.env / .env.local). Optional: SUPABASE_SEED_ORG_ID.
 */
import pg from 'pg';
import dotenv from 'dotenv';
import { randomUUID } from 'node:crypto';

dotenv.config({ path: '.env' });
dotenv.config({ path: '.env.local' });

const dbUrl = process.env.SUPABASE_DB_URL;
if (!dbUrl) {
  console.error('SUPABASE_DB_URL ausente no .env/.env.local');
  process.exit(1);
}
const shouldReset = process.argv.includes('--reset');

const client = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
await client.connect();
const q = async (sql, params) => (await client.query(sql, params)).rows;

const iso = (msFromNow) => new Date(Date.now() + msFromNow).toISOString();
const DAY = 24 * 60 * 60 * 1000;

function auditRow(action, description, userId, userName) {
  return {
    id: `audit-${randomUUID()}`,
    action,
    description,
    userId,
    userName,
    timestamp: new Date().toISOString(),
  };
}

try {
  // §0 — resolve owner_admin + organization.
  const orgOverride = process.env.SUPABASE_SEED_ORG_ID;
  const [me] = await q(
    `select p.user_id, p.organization_id, coalesce(p.full_name, 'Owner Admin') as full_name
     from public.profiles p
     join public.user_roles ur on ur.user_id = p.user_id
     join public.roles r on r.id = ur.role_id and r.key = 'owner_admin'
     ${orgOverride ? 'where p.organization_id = $1' : ''}
     limit 1`,
    orgOverride ? [orgOverride] : [],
  );
  if (!me) throw new Error('Nenhum owner_admin encontrado para a organização.');
  const orgId = me.organization_id;
  const userId = me.user_id;
  const userName = me.full_name;
  console.log(`Organização: ${orgId} · owner_admin: ${userName} (${userId})`);

  if (shouldReset) {
    const del = await q(
      `delete from public.deliberations where organization_id = $1 and title like '[QA]%' returning id`,
      [orgId],
    );
    console.log(`--reset: ${del.length} deliberações [QA] removidas.`);
  }

  // Resolve any committee for owner linkage (optional).
  const [committee] = await q(
    `select id, name from public.committees where organization_id = $1 order by created_at asc limit 1`,
    [orgId],
  );
  const committeeId = committee?.id ?? null;
  const committeeName = committee?.name ?? 'Comitê Executivo';

  // §2 — QA matrix.
  const items = [
    {
      code: 'QA-DEL-001',
      title: '[QA] Rascunho de política de alçadas',
      status: 'draft',
      priority: 'medium',
      risk: 'low',
      due: iso(15 * DAY),
      meta: { reviews: [], attachments: [] },
    },
    {
      code: 'QA-DEL-002',
      title: '[QA] Revisão de contrato estratégico (parecer pendente)',
      status: 'in_review',
      priority: 'high',
      risk: 'high',
      due: iso(5 * DAY),
      meta: {
        reviews: [{ type: 'Legal', status: 'pending', reviewerName: 'Jurídico' }],
        attachments: [],
      },
    },
    {
      code: 'QA-DEL-003',
      title: '[QA] Aporte de capital — votação (quórum parcial)',
      status: 'in_voting',
      priority: 'high',
      risk: 'medium',
      due: iso(2 * DAY),
      quorumRequired: 5,
      quorumPresent: 2,
      vote: 'yes',
      meta: { reviews: [], attachments: [] },
    },
    {
      code: 'QA-DEL-004',
      title: '[QA] Decisão atrasada — SLA estourado',
      status: 'in_voting',
      priority: 'high',
      risk: 'high',
      due: iso(-3 * DAY),
      quorumRequired: 3,
      quorumPresent: 1,
      meta: { reviews: [], attachments: [] },
    },
    {
      code: 'QA-DEL-005',
      title: '[QA] Exposição crítica de compliance',
      status: 'in_review',
      priority: 'critical',
      risk: 'critical',
      due: iso(1 * DAY),
      meta: {
        reviews: [{ type: 'Compliance', status: 'pending', reviewerName: 'Compliance' }],
        attachments: [],
      },
    },
    {
      code: 'QA-DEL-006',
      title: '[QA] Aguardando ata — votação aprovada',
      status: 'awaiting_minutes',
      priority: 'medium',
      risk: 'medium',
      due: iso(4 * DAY),
      voteResult: 'approved',
      quorumRequired: 3,
      quorumPresent: 3,
      meta: { reviews: [{ type: 'Finance', status: 'approved', reviewerName: 'Financeiro' }], attachments: [] },
    },
    {
      code: 'QA-DEL-007',
      title: '[QA] Em execução — ações + evidência',
      status: 'in_execution',
      priority: 'high',
      risk: 'medium',
      due: iso(10 * DAY),
      voteResult: 'approved',
      execution_items: [
        {
          id: `exec-${randomUUID()}`,
          title: 'Implementar controle aprovado',
          ownerName: userName,
          dueDate: iso(7 * DAY),
          status: 'in_progress',
        },
      ],
      meta: {
        reviews: [],
        attachments: [
          { id: `att-${randomUUID()}`, name: 'Evidência de execução.pdf', url: 'https://example.com/evidencia.pdf', type: 'document' },
        ],
      },
    },
    {
      code: 'QA-DEL-008',
      title: '[QA] Concluída — ata publicada',
      status: 'resolved',
      priority: 'medium',
      risk: 'low',
      due: iso(-1 * DAY),
      voteResult: 'approved',
      minutes: {
        status: 'published',
        agendaSummary: 'Decisão concluída para QA.',
        evidenceList: [],
        votingResult: 'approved',
        decisionText: 'Aprovado por unanimidade.',
        actionItems: [],
        publishedAt: new Date().toISOString(),
      },
      meta: { reviews: [], attachments: [] },
    },
  ];

  let inserted = 0;
  for (const it of items) {
    const metadata = {
      ownerName: userName,
      ownerCommitteeName: committeeName,
      riskLevel: it.risk,
      quorumRequired: it.quorumRequired ?? 0,
      quorumPresent: it.quorumPresent ?? 0,
      requestedDecision: it.title.replace('[QA] ', ''),
      ...it.meta,
    };
    const auditTrail = [auditRow('status_changed', `Semeada em ${it.status} (QA).`, userId, userName)];

    const rows = await q(
      `insert into public.deliberations
         (organization_id, code, title, description, status, vote_result, priority,
          owner_committee_id, submitted_by, created_by, assignee_user_id, due_date,
          stages, minutes, linked_entities, execution_items, audit_trail, metadata)
       select $1,$2,$3,$4,$5,$6,$7,$8,$9,$9,$9,$10,
              '[]'::jsonb, $11::jsonb, '[]'::jsonb, $12::jsonb, $13::jsonb, $14::jsonb
       where not exists (
         select 1 from public.deliberations d
         where d.organization_id = $1 and d.title = $3)
       returning id`,
      [
        orgId,
        it.code,
        it.title,
        it.title.replace('[QA] ', ''),
        it.status,
        it.voteResult ?? null,
        it.priority,
        committeeId,
        userId,
        it.due,
        JSON.stringify(it.minutes ?? null),
        JSON.stringify(it.execution_items ?? []),
        JSON.stringify(auditTrail),
        JSON.stringify(metadata),
      ],
    );

    if (rows[0]?.id) {
      inserted += 1;
      // A single real vote for the voting/awaiting scenarios (unique per voter).
      if (it.vote || it.status === 'awaiting_minutes') {
        await client.query(
          `insert into public.deliberation_votes
             (organization_id, deliberation_id, voter_id, voter_name, vote, voted_at)
           select $1,$2,$3,$4,$5, now()
           where not exists (
             select 1 from public.deliberation_votes v
             where v.deliberation_id = $2 and v.voter_id = $3 and coalesce(v.stage_id,'') = '')`,
          [orgId, rows[0].id, userId, userName, it.vote ?? 'yes'],
        );
      }
    }
  }

  console.log(`Deliberações [QA] inseridas: ${inserted} (de ${items.length}).`);
  console.log('Concluído. Abra /deliberacoes para validar o runbook docs/qa/deliberations-live.md.');
} catch (err) {
  console.error('Falha no seed:', err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await client.end();
}
