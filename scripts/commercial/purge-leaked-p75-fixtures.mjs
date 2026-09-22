/**
 * Remove o resíduo de FIXTURE deixado pelas suítes vivas.
 *
 * ─── O que é resíduo aqui ────────────────────────────────────────────────
 *
 * As suítes `contracts-phase7-*`, `phase75-multi-organization-live` e afins
 * criam contratos e partes com prefixo de teste (`[P75]`, `[P7XT]`,
 * `[P7-LIVE]`) e nem sempre os removem no teardown. Parte disso é histórico da
 * suíte; parte foi agravada por um `ON DELETE RESTRICT` introduzido na 197 e
 * corrigido na 207, que abortava a limpeza no meio.
 *
 * ─── O cerco ─────────────────────────────────────────────────────────────
 *
 *  • só títulos/nomes com prefixo de fixture conhecido;
 *  • nunca toca em organização (o apagamento esbarra em `audit_logs`, que é
 *    append-only — e isso é correto: auditoria não se apaga);
 *  • o que outra tabela real ainda referencia é RELATADO, não forçado.
 *
 * Sem `--apply`, apenas lista.
 */
import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config({ path: '.env', quiet: true });
dotenv.config({ path: '.env.local', quiet: true });

const apply = process.argv.includes('--apply');
/*
  Os prefixos de fixture das suítes vivas. A lista é larga porque o vazamento
  é largo: `[P5-LIVE] contrato 0` existe desde 15/09 e ganhou uma cópia nova
  em cada execução posterior.

  O que segura a mão não é o prefixo — é a JANELA. Só sai o que as execuções
  DESTA sessão criaram. As cópias de 12/09, 15/09 e 18/09 ficam onde estão:
  são resíduo anterior ao trabalho, e limpá-las é decisão de quem responde
  pelo ambiente.
*/
const PREFIXES = ['[P75]%', '[P7XT]%', '[P7-LIVE]%', '[P6-LIVE]%', '[P5-LIVE]%', '[PHASE4-LIVE]%'];
const SINCE_HOURS = Number(process.argv.find((a) => a.startsWith('--hours='))?.split('=')[1] ?? 14);
const db = new pg.Client({
  connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });

try {
  await db.connect();
  await db.query('SET SESSION default_transaction_read_only = off');
  await db.query('BEGIN');

  const realReceivables = (await db.query(
    `SELECT count(*)::int n FROM public.finance_receivables r
       JOIN public.organizations o ON o.id = r.organization_id
      WHERE NOT (o.name LIKE ANY($1))`, [PREFIXES])).rows[0].n;

  const before = (await db.query(`SELECT
    (SELECT count(*)::int FROM public.contracts WHERE deleted_at IS NULL) contratos,
    (SELECT count(*)::int FROM public.parties) parties,
    (SELECT count(*)::int FROM public.project_measurements) medicoes,
    (SELECT count(*)::int FROM public.projects) projetos`)).rows[0];
  console.log('antes:', before, `| recebíveis em organização real: ${realReceivables}`);

  /*
    Os recebíveis de FIXTURE saem antes dos contratos.

    `fr_contract_tenant` (migration 138, anterior a este trabalho) impede
    apagar um contrato que ainda tem recebível — e as suítes da Fase 7 criam
    recebíveis nas suas organizações descartáveis. Sem remover o recebível
    primeiro, o contrato de teste fica para sempre.

    O cerco é duplo: a organização precisa ter nome de fixture E o recebível
    precisa ter nascido na janela desta sessão. Nenhum recebível de
    organização real é alcançado — a consulta abaixo o exclui por construção.
  */
  /*
    A cadeia de Finanças sai de trás para frente: conciliação → liquidação →
    recebível → contrato. Cada uma segura a seguinte por chave estrangeira, e
    tentar apagar na ordem natural falha na primeira.
  */
  const reconciliations = (await db.query(
    `DELETE FROM public.finance_reconciliations f
      USING public.organizations o
      WHERE o.id = f.organization_id
        AND o.name LIKE ANY($1)
        AND f.created_at > now() - ($2 || ' hours')::interval
      RETURNING f.id`, [PREFIXES, String(SINCE_HOURS)])).rowCount;

  const settlements = (await db.query(
    `DELETE FROM public.finance_settlements s
      USING public.organizations o
      WHERE o.id = s.organization_id
        AND o.name LIKE ANY($1)
        AND s.created_at > now() - ($2 || ' hours')::interval
      RETURNING s.id`, [PREFIXES, String(SINCE_HOURS)])).rowCount;

  const receivables = (await db.query(
    `DELETE FROM public.finance_receivables r
      USING public.organizations o
      WHERE o.id = r.organization_id
        AND o.name LIKE ANY($1)
        AND r.created_at > now() - ($2 || ' hours')::interval
      RETURNING r.id`, [PREFIXES, String(SINCE_HOURS)])).rowCount;
  console.log(`fixture de Finanças removida → conciliações ${reconciliations}, `
    + `liquidações ${settlements}, recebíveis ${receivables}`);

  const targets = (await db.query(
    `SELECT id, title, created_at FROM public.contracts
      WHERE title LIKE ANY($1) AND created_at > now() - ($2 || ' hours')::interval`,
    [PREFIXES, String(SINCE_HOURS)])).rows;
  console.log(`alvos (prefixo de fixture, criados nas últimas ${SINCE_HOURS}h): ${targets.length}`);
  const removed = []; const kept = [];
  for (const row of targets) {
    await db.query('SAVEPOINT one');
    try {
      await db.query('DELETE FROM public.contracts WHERE id=$1', [row.id]);
      await db.query('RELEASE SAVEPOINT one');
      removed.push(row.title);
    } catch (error) {
      await db.query('ROLLBACK TO SAVEPOINT one');
      await db.query('RELEASE SAVEPOINT one');
      kept.push(`${row.title} — ${error.message.split('\n')[0]}`);
    }
  }

  const orphanParties = (await db.query(
    `DELETE FROM public.parties p
      WHERE p.legal_name LIKE ANY($1)
        AND p.created_at > now() - ($2 || ' hours')::interval
        AND NOT EXISTS (SELECT 1 FROM public.contracts c WHERE c.counterparty_party_id = p.id)
        AND NOT EXISTS (SELECT 1 FROM public.commercial_engagements e WHERE e.counterparty_party_id = p.id)
      RETURNING p.legal_name`, [PREFIXES, String(SINCE_HOURS)])).rowCount;

  const emptyEngagements = (await db.query(
    `DELETE FROM public.commercial_engagements e
      WHERE e.title LIKE ANY($1)
        AND e.created_at > now() - ($2 || ' hours')::interval
        AND NOT EXISTS (SELECT 1 FROM public.commercial_engagement_authorizations a
                         WHERE a.engagement_id = e.id)
        AND NOT EXISTS (SELECT 1 FROM public.project_measurements m WHERE m.engagement_id = e.id)
        AND NOT EXISTS (SELECT 1 FROM public.internal_service_orders s WHERE s.engagement_id = e.id)
      RETURNING e.id`, [PREFIXES, String(SINCE_HOURS)])).rowCount;

  const after = (await db.query(`SELECT
    (SELECT count(*)::int FROM public.contracts WHERE deleted_at IS NULL) contratos,
    (SELECT count(*)::int FROM public.parties) parties,
    (SELECT count(*)::int FROM public.project_measurements) medicoes,
    (SELECT count(*)::int FROM public.projects) projetos,
    (SELECT count(*)::int FROM public.contracts WHERE deleted_at IS NULL AND engagement_id IS NULL) orfaos`
  )).rows[0];
  console.log('depois:', after);
  console.log(`removidos: ${removed.length} contrato(s), ${orphanParties} parte(s), `
    + `${emptyEngagements} trabalho(s) vazio(s)`);
  if (kept.length) {
    console.log('\nMANTIDOS (referenciados por dado real — reportado, nunca forçado):');
    for (const k of kept) console.log(' ·', k);
  }
  if (after.orfaos !== 0) throw new Error('contrato vivo ficou sem engajamento.');

  const realAfter = (await db.query(
    `SELECT count(*)::int n FROM public.finance_receivables r
       JOIN public.organizations o ON o.id = r.organization_id
      WHERE NOT (o.name LIKE ANY($1))`, [PREFIXES])).rows[0].n;
  if (realAfter !== realReceivables) {
    throw new Error(`recebível de organização REAL foi tocado (${realReceivables} → ${realAfter}).`);
  }

  if (apply) { await db.query('COMMIT'); console.log('\nCOMMIT.'); }
  else { await db.query('ROLLBACK'); console.log('\nENSAIO. Use --apply.'); }
} catch (error) {
  console.error('FALHOU:', error.message);
  try { await db.query('ROLLBACK'); } catch {}
  process.exitCode = 1;
} finally { await db.end(); }
