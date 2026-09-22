/**
 * MEDE o acúmulo de fixture das suítes vivas — e, com `--check`, reprova.
 *
 * ─── Por que existe ──────────────────────────────────────────────────────
 *
 * As suítes de integração rodam contra o banco VIVO. Quando um teardown falha
 * no meio, ele não avisa: some do log e reaparece semanas depois como uma
 * carteira com contratos que ninguém reconhece. Foi assim que 21 contratos,
 * 17 recebíveis e 17 documentos fiscais de fixture chegaram ao banco.
 *
 * Sem medida, "a higiene melhorou" é opinião. Com medida, é diferença entre
 * duas fotografias.
 *
 * ─── A linha que o `--check` cobra ───────────────────────────────────────
 *
 * LINHA DE NEGÓCIO tem de voltar a zero: contrato, projeto, medição,
 * faturamento, recebível, liquidação, conciliação, documento fiscal, trabalho
 * autorizado, ordem de serviço. Qualquer sobra aqui é defeito de teardown.
 *
 * ORGANIZAÇÃO vazia é tolerada, e a tolerância é explicada, não conveniente:
 * `audit_logs` é append-only e referencia a organização. A trilha registra que
 * aquelas ações aconteceram — e aconteceram. Apagá-la para arrumar a contagem
 * falsificaria exatamente o registro que a auditoria existe para preservar.
 * O relatório NOMEIA quantas ficaram e por quê; ele não as esconde.
 *
 *   node scripts/commercial/fixture-drift-probe.mjs              # fotografia
 *   node scripts/commercial/fixture-drift-probe.mjs --check A B  # compara
 */
import { readFileSync } from 'node:fs';
import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config({ path: '.env', quiet: true });
dotenv.config({ path: '.env.local', quiet: true });

/** Linhas que NUNCA podem sobrar depois de uma suíte. */
const BUSINESS_KEYS = [
  'contratos', 'projetos', 'medicoes', 'faturamentos', 'recebiveis',
  'liquidacoes', 'conciliacoes', 'documentos_fiscais',
  'trabalhos_autorizados', 'ordens_servico', 'parties',
];

const db = new pg.Client({
  connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });

async function snapshot() {
  return (await db.query(`SELECT
    (SELECT count(*)::int FROM organizations) organizacoes,
    (SELECT count(*)::int FROM organizations WHERE name LIKE '[%') organizacoes_fixture,
    (SELECT count(*)::int FROM contracts WHERE deleted_at IS NULL) contratos,
    (SELECT count(*)::int FROM parties) parties,
    (SELECT count(*)::int FROM projects) projetos,
    (SELECT count(*)::int FROM project_measurements) medicoes,
    (SELECT count(*)::int FROM contract_billing_events) faturamentos,
    (SELECT count(*)::int FROM finance_receivables) recebiveis,
    (SELECT count(*)::int FROM finance_settlements) liquidacoes,
    (SELECT count(*)::int FROM finance_reconciliations) conciliacoes,
    (SELECT count(*)::int FROM fiscal_documents) documentos_fiscais,
    (SELECT count(*)::int FROM commercial_engagements) trabalhos_autorizados,
    (SELECT count(*)::int FROM internal_service_orders) ordens_servico
  `)).rows[0];
}

try {
  await db.connect();
  const args = process.argv.slice(2);
  const check = args.indexOf('--check');

  if (check === -1) {
    console.log(JSON.stringify(await snapshot()));
  } else {
    const [beforePath, afterPath] = args.slice(check + 1);
    const before = JSON.parse(readFileSync(beforePath, 'utf8'));
    const after = JSON.parse(readFileSync(afterPath, 'utf8'));

    const drifted = BUSINESS_KEYS
      .map((key) => [key, (after[key] ?? 0) - (before[key] ?? 0)])
      .filter(([, delta]) => delta !== 0);

    const orgDelta = (after.organizacoes ?? 0) - (before.organizacoes ?? 0);
    console.log(`linhas de negócio deixadas para trás: ${drifted.length === 0 ? 'nenhuma'
      : drifted.map(([k, d]) => `${k} ${d > 0 ? '+' : ''}${d}`).join(', ')}`);

    if (orgDelta !== 0) {
      const held = (await db.query(
        `SELECT count(*)::int n FROM audit_logs a JOIN organizations o ON o.id = a.organization_id
          WHERE o.name LIKE '[%'`)).rows[0].n;
      console.log(`organizações de fixture vazias acrescentadas: ${orgDelta} — `
        + `retidas por ${held} linhas de auditoria append-only. `
        + 'Relatado de propósito: apagar auditoria para arrumar a contagem '
        + 'falsificaria o registro que ela existe para preservar.');
    }

    if (drifted.length > 0) {
      console.error('\nFALHOU: teardown de suíte viva deixou linha de NEGÓCIO no banco.');
      process.exitCode = 1;
    } else {
      console.log('\nOK: nenhuma linha de negócio sobreviveu à execução.');
    }
  }
} catch (error) {
  console.error('FALHOU:', error.message);
  process.exitCode = 1;
} finally { await db.end(); }
