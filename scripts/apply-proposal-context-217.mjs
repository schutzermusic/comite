/**
 * Aplica e registra a 217 (PT + PC = um contexto de proposta).
 * Sem `--apply` é ensaio: tudo roda numa transação desfeita no fim.
 * As provas rodam num SAVEPOINT e são sempre desfeitas, mesmo com `--apply`.
 */
import { readFileSync, readdirSync } from 'node:fs';
import pg from 'pg';
import dotenv from 'dotenv';
import { recordMigrationApplied } from './lib/migration-registry.mjs';

dotenv.config({ path: '.env', quiet: true });
dotenv.config({ path: '.env.local', quiet: true });

const apply = process.argv.includes('--apply');
const db = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
const strip = (sql) => sql.replace(/^\s*(BEGIN|COMMIT)\s*;\s*$/gmi, '');
const one = async (sql, params = []) => (await db.query(sql, params)).rows[0];

async function rejects(failures, label, sql, params) {
  const sp = `sp_${Math.random().toString(36).slice(2, 8)}`;
  await db.query(`SAVEPOINT ${sp}`);
  try {
    await db.query(sql, params);
    failures.push(label);
  } catch {
    await db.query(`ROLLBACK TO SAVEPOINT ${sp}`);
  }
}

try {
  await db.connect();
  await db.query('SET SESSION default_transaction_read_only = off');
  const tip = (await one('SELECT version FROM supabase_migrations.schema_migrations ORDER BY version::int DESC LIMIT 1'))?.version;
  if (tip !== '216') throw new Error(`Esperava ponta 216, encontrei ${tip}.`);
  const before = await one(`SELECT count(*)::int n FROM public.commercial_proposals`);
  await db.query('BEGIN');
  const [file] = readdirSync('supabase/migrations').filter((f) => f.startsWith('217_'));
  await db.query(strip(readFileSync(`supabase/migrations/${file}`, 'utf8')));
  await recordMigrationApplied(db, '217', file.slice(4).replace(/\.sql$/, ''));

  const failures = [];
  const paired = await one(`SELECT count(*)::int n FROM public.commercial_proposals WHERE context_id <> id`);
  const contexts = await one(`SELECT count(DISTINCT (organization_id, context_id))::int n FROM public.commercial_proposals`);
  console.log(`Backfill: ${before.n} documento(s) → ${contexts.n} contexto(s); ${paired.n} documento(s) entraram no contexto do par.`);

  for (const fn of ['commercial_proposal_context_transition(uuid,uuid,uuid,text)',
    'commercial_proposal_context_link_opportunity(uuid,uuid,uuid,uuid,text)',
    'commercial_proposal_create(uuid,uuid,jsonb)', 'commercial_proposal_revision_transition(uuid,uuid,uuid,text)']) {
    const r = await one(`SELECT has_function_privilege('authenticated', 'public.${fn}', 'EXECUTE') b`);
    if (r.b) failures.push(`${fn} alcançável pelo navegador`);
  }

  await db.query('SAVEPOINT proofs');
  const { org, actor } = await one(`SELECT p.organization_id org, p.user_id actor FROM public.profiles p
    WHERE p.status='active' AND p.organization_id IS NOT NULL ORDER BY p.created_at LIMIT 1`);
  const stamp = Date.now();
  const create = (payload) => one(`SELECT public.commercial_proposal_create($1,$2,$3) r`, [org, actor, JSON.stringify(payload)]).then((x) => x.r);
  const pt = await create({ proposal_number: `PT-P217-${stamp}`, kind: 'TECHNICAL', title: 'Prova 217', counterparty_name: 'Prova 217' });
  const pc = await create({ proposal_number: `PC-P217-${stamp}`, kind: 'COMMERCIAL', counterparty_name: 'Prova 217',
    total_value: '1000', currency: 'BRL', context_proposal_id: pt.proposal_id });
  if (pc.context_id !== pt.proposal_id) failures.push('PC não entrou no contexto da PT');
  await rejects(failures, 'segunda PC no mesmo contexto aceita', `SELECT public.commercial_proposal_create($1,$2,$3)`,
    [org, actor, JSON.stringify({ proposal_number: `PC2-P217-${stamp}`, kind: 'COMMERCIAL', title: 'x', counterparty_name: 'x', context_proposal_id: pt.proposal_id })]);
  await rejects(failures, 'combinada entrou em contexto com PT/PC', `SELECT public.commercial_proposal_create($1,$2,$3)`,
    [org, actor, JSON.stringify({ proposal_number: `C-P217-${stamp}`, kind: 'COMBINED', title: 'x', counterparty_name: 'x', context_proposal_id: pt.proposal_id })]);
  await rejects(failures, 'contexto reescrito', `UPDATE public.commercial_proposals SET context_id = id WHERE id = $1`, [pc.proposal_id]);

  const ctx = 'SELECT public.commercial_proposal_context_transition($1,$2,$3,$4) r';
  await rejects(failures, 'pacote aprovado sem passar por aprovação interna', ctx, [org, actor, pt.proposal_id, 'INTERNALLY_APPROVED']);
  const review = (await one(ctx, [org, actor, pt.proposal_id, 'INTERNAL_REVIEW'])).r;
  if (review.moved.length !== 2) failures.push('pacote não andou junto para aprovação interna');
  const approved = (await one(ctx, [org, actor, pc.proposal_id, 'INTERNALLY_APPROVED'])).r;
  if (approved.moved.length !== 2) failures.push('PT sem valor não pôde ser aprovada no pacote');
  const sent = (await one(ctx, [org, actor, pc.proposal_id, 'SENT'])).r;
  if (sent.moved.length !== 2) failures.push('pacote não foi enviado junto');
  const statuses = await db.query(`SELECT status FROM public.commercial_proposal_revisions WHERE proposal_id = ANY($1)`,
    [[pt.proposal_id, pc.proposal_id]]);
  if (!statuses.rows.every((s) => s.status === 'SENT')) failures.push('estado do pacote incoerente');

  // Cliente pede mudança: PC R02 nasce rascunho; enviar de novo exige reaprovar.
  const rev = (await one(`SELECT public.commercial_proposal_revise($1,$2,$3,$4) r`,
    [org, actor, pc.revision_id, JSON.stringify({ total_value: '930', currency: 'BRL' })])).r;
  await rejects(failures, 'nova revisão enviada sem reaprovação', ctx, [org, actor, pc.proposal_id, 'SENT']);
  const re = (await one(ctx, [org, actor, pt.proposal_id, 'INTERNAL_REVIEW'])).r;
  if (re.moved.length !== 1 || re.moved[0].revision_id !== rev.revision_id) failures.push('reaprovação não isolou a nova revisão');

  const opp = (await one(`SELECT public.commercial_opportunity_upsert($1,$2,$3) id`, [org, actor,
    JSON.stringify({ title: `Prova 217 ${stamp}`, counterparty_name: 'Prova 217', currency: 'BRL' })])).id;
  const link = (await one('SELECT public.commercial_proposal_context_link_opportunity($1,$2,$3,$4,$5) r',
    [org, actor, pc.proposal_id, opp, 'prova'])).r;
  if (link.documents_linked !== 2) failures.push('vínculo não alcançou PT e PC');
  const fc = await one(`SELECT proposal_count FROM public.commercial_forecast_read_model WHERE opportunity_id = $1`, [opp]);
  if (fc?.proposal_count !== 1) failures.push(`forecast contou ${fc?.proposal_count} propostas para um contexto`);

  // ── Aceite do PACOTE: qual PT + PC exatamente o cliente aceitou ─────────
  const outcome = 'SELECT public.commercial_proposal_context_record_outcome($1,$2,$3,$4,$5) r';
  const evidence = JSON.stringify({ acceptance_source: 'purchase_order', acceptance_external_ref: `PO-P217-${stamp}` });
  const ledger = (ctxId) => db.query(`SELECT * FROM public.commercial_proposal_context_acceptances
    WHERE organization_id = $1 AND context_id = $2 ORDER BY created_at`, [org, ctxId]).then((r) => r.rows);
  const pkg = async (tag) => {
    const a = await create({ proposal_number: `PT-${tag}-${stamp}`, kind: 'TECHNICAL', title: `Prova 217 ${tag}`, counterparty_name: 'Prova 217' });
    const b = await create({ proposal_number: `PC-${tag}-${stamp}`, kind: 'COMMERCIAL', counterparty_name: 'Prova 217',
      total_value: '500', currency: 'BRL', context_proposal_id: a.proposal_id });
    for (const to of ['INTERNAL_REVIEW', 'INTERNALLY_APPROVED', 'SENT']) await one(ctx, [org, actor, a.proposal_id, to]);
    return { pt: a, pc: b };
  };

  // (a) pacote enviado + aceite do pacote → UMA linha, completa, com as duas revisões, evidência, ator, hora.
  const A = await pkg('ACC');
  const accA = (await one(outcome, [org, actor, A.pc.proposal_id, 'ACCEPTED', evidence])).r;
  if (accA.moved.length !== 2) failures.push('aceite do pacote não alcançou PT e PC');
  const rowsA = await ledger(A.pt.proposal_id);
  if (rowsA.length !== 1) failures.push(`aceite do pacote gerou ${rowsA.length} linhas no livro`);
  const la = rowsA[0] ?? {};
  if (!la.complete || la.technical_revision_id !== A.pt.revision_id || la.commercial_revision_id !== A.pc.revision_id
      || la.recorded_by !== actor || la.acceptance_source !== 'purchase_order' || !la.accepted_at || la.origin !== 'package') {
    failures.push(`livro não registrou o pacote exato: ${JSON.stringify(la)}`);
  }
  await rejects(failures, 'aceite gravado de novo sobre pacote já aceito', outcome, [org, actor, A.pc.proposal_id, 'ACCEPTED', evidence]);
  await rejects(failures, 'revisão aceita sucedida (herança de aceite)', 'SELECT public.commercial_proposal_revise($1,$2,$3,$4)',
    [org, actor, A.pc.revision_id, JSON.stringify({ total_value: '1' })]);
  await rejects(failures, 'livro de aceite com txid reescrito', 'UPDATE public.commercial_proposal_context_acceptances SET txid = txid + 1 WHERE id = $1', [la.id]);
  // Apagar segue a regra canônica (210), a mesma das outras tabelas de história:
  // a APLICAÇÃO nunca apaga; só o caminho governado de remoção de inquilino.
  for (const role of ['authenticated', 'anon']) {
    await db.query('SAVEPOINT sp_role');
    await db.query(`SET LOCAL ROLE ${role}`);
    try {
      const del = await db.query('DELETE FROM public.commercial_proposal_context_acceptances WHERE id = $1', [la.id]);
      if (del.rowCount) failures.push(`livro de aceite apagado por ${role}`);
    } catch { /* recusado — esperado */ }
    await db.query('ROLLBACK TO SAVEPOINT sp_role');
  }

  // (b) cliente não aceita o que não recebeu: PT em rascunho bloqueia o aceite do pacote.
  const B = await pkg('PAR');
  const ptB2 = (await one(`SELECT public.commercial_proposal_revise($1,$2,$3,$4) r`, [org, actor, B.pt.revision_id, '{}'])).r;
  await rejects(failures, 'pacote aceito com PT R02 em rascunho', outcome, [org, actor, B.pc.proposal_id, 'ACCEPTED', evidence]);

  // (c) aceite só da PC pelo caminho por revisão → linha INCOMPLETA; a PT R02 posterior não herda nada.
  await one(`SELECT public.commercial_proposal_revision_record_outcome($1,$2,$3,'ACCEPTED',$4)`, [org, actor, B.pc.revision_id, evidence]);
  const rowsB = await ledger(B.pt.proposal_id);
  if (rowsB.length !== 1 || rowsB[0].complete || rowsB[0].technical_revision_id !== ptB2.revision_id
      || rowsB[0].technical_status !== 'DRAFT' || rowsB[0].origin !== 'revision_outcome') {
    failures.push(`aceite parcial não ficou marcado como incompleto: ${JSON.stringify(rowsB[0])}`);
  }

  // (d) fechamento/fast-track aceita PT e PC em sequência → uma linha, completa.
  const C = await pkg('FT');
  for (const rev of [C.pt.revision_id, C.pc.revision_id]) {
    await one(`SELECT public.commercial_proposal_revision_record_outcome($1,$2,$3,'ACCEPTED',$4)`, [org, actor, rev, evidence]);
  }
  const rowsC = await ledger(C.pt.proposal_id);
  if (rowsC.length !== 1 || !rowsC[0].complete) failures.push(`fechamento gerou ${rowsC.length} linha(s), completa=${rowsC[0]?.complete}`);

  // (e) recusa do pacote vale para os dois documentos.
  const D = await pkg('REJ');
  const rej = (await one(outcome, [org, actor, D.pt.proposal_id, 'REJECTED', JSON.stringify({ rejection_reason: 'preço' })])).r;
  if (rej.moved.length !== 2) failures.push('recusa do pacote não alcançou PT e PC');

  // (f) PT SOZINHA continua exigindo valor para aprovar/aceitar.
  const solo = await create({ proposal_number: `PT-SOLO-${stamp}`, kind: 'TECHNICAL', title: 'Prova 217 solo', counterparty_name: 'Prova 217 solo' });
  await one(ctx, [org, actor, solo.proposal_id, 'INTERNAL_REVIEW']);
  await rejects(failures, 'PT sozinha aprovada sem valor', ctx, [org, actor, solo.proposal_id, 'INTERNALLY_APPROVED']);

  const priv = await one(`SELECT has_function_privilege('authenticated',
    'public.commercial_proposal_context_record_outcome(uuid,uuid,uuid,text,jsonb)', 'EXECUTE') b`);
  if (priv.b) failures.push('resposta do cliente ao pacote alcançável pelo navegador');
  const writes = await one(`SELECT count(*)::int n FROM information_schema.role_table_grants
    WHERE grantee IN ('authenticated','anon') AND table_schema='public'
      AND table_name='commercial_proposal_context_acceptances' AND privilege_type IN ('INSERT','UPDATE','DELETE','TRUNCATE')`);
  if (writes.n) failures.push('navegador escreve no livro de aceite');
  await db.query('ROLLBACK TO SAVEPOINT proofs');

  if (failures.length) {
    console.error('PROVAS FALHARAM:\n- ' + failures.join('\n- '));
    await db.query('ROLLBACK');
    process.exit(1);
  }
  console.log('Contexto único PT+PC, pacote andando junto, reaprovação, vínculo do contexto, forecast sem dupla contagem e aceite do pacote exato (livro append-only, sem herança) — provado.');
  if (apply) { await db.query('COMMIT'); console.log('COMMIT — 217 aplicada e registrada.'); }
  else { await db.query('ROLLBACK'); console.log('ENSAIO ok. Use --apply para cometer.'); }
} catch (error) {
  console.error('FALHOU:', error.message);
  try { await db.query('ROLLBACK'); } catch {}
  process.exitCode = 1;
} finally { await db.end(); }
