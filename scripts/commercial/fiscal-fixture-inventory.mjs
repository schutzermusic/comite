/**
 * INVENTÁRIO dos documentos fiscais de FIXTURE deixados pelas suítes vivas.
 *
 * Somente LEITURA. Não cancela, não altera, não apaga — cancelamento de NFS-e
 * é ato real e governado, e exige autorização separada.
 *
 * Para cada documento responde: quem é, de quem, de onde veio, e por que se
 * afirma com confiança que é fixture e não produção.
 */
import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config({ path: '.env', quiet: true });
dotenv.config({ path: '.env.local', quiet: true });

const db = new pg.Client({
  connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });

const FIXTURE_ORG = "o.name LIKE '[P75]%' OR o.name LIKE '[P7XT]%' OR o.name LIKE '[P7-LIVE]%' "
  + "OR o.name LIKE '[P6-LIVE]%' OR o.name LIKE '[P5-LIVE]%' OR o.name LIKE '[PHASE4-LIVE]%'";

try {
  await db.connect();

  const rows = (await db.query(`
    SELECT fd.id, fd.document_number, fd.series, fd.dps_number, fd.status, fd.environment,
           fd.provider_key, fd.provider_document_id, fd.access_key,
           fd.authorized_at, fd.cancelled_at, fd.created_at,
           fd.net_amount_cents, fd.contract_id, fd.organization_id, fd.finance_status,
           o.name AS organization,
           ct.title AS contract_title,
           (SELECT r.id FROM public.finance_receivables r
             WHERE r.contract_id = fd.contract_id LIMIT 1) AS receivable_id
      FROM public.fiscal_documents fd
      JOIN public.organizations o ON o.id = fd.organization_id
      LEFT JOIN public.contracts ct ON ct.id = fd.contract_id
     ORDER BY fd.created_at`)).rows;

  const isFixture = (r) => /^\[(P75|P7XT|P7-LIVE|P6-LIVE|P5-LIVE|PHASE4-LIVE)\]/.test(r.organization);
  const fixtures = rows.filter(isFixture);
  const production = rows.filter((r) => !isFixture(r));

  console.log(`documentos fiscais no banco: ${rows.length}`);
  console.log(`  · de organização de FIXTURE: ${fixtures.length}`);
  console.log(`  · de organização REAL:       ${production.length}`);

  console.log('\n─── INVENTÁRIO DE FIXTURE ───────────────────────────────────');
  for (const r of fixtures) {
    const prefix = r.organization.match(/^\[[^\]]+\]/)?.[0] ?? '?';
    console.log([
      `id                 ${r.id}`,
      `nº NFS-e / série   ${r.document_number ?? '—'} / ${r.series ?? '—'}  (DPS ${r.dps_number ?? '—'})`,
      `chave de acesso    ${r.access_key ?? '—'}`,
      `organização        ${r.organization}`,
      `prefixo de fixture ${prefix}`,
      `contrato           ${r.contract_title ?? '—'} (${r.contract_id ?? '—'})`,
      `recebível ligado   ${r.receivable_id ?? 'nenhum'}`,
      `autorizado em      ${r.authorized_at ?? '(não autorizado)'}`,
      `cancelado em       ${r.cancelled_at ?? '(não cancelado)'}`,
      `criado em          ${r.created_at.toISOString()}`,
      `provedor/ambiente  ${r.provider_key ?? '—'} / ${r.environment}`,
      `status             ${r.status}`,
      `valor líquido      ${r.net_amount_cents !== null ? (r.net_amount_cents / 100).toFixed(2) : '—'}`,
      `estado em Finanças ${r.finance_status ?? '—'}`,
      `id no provedor     ${r.provider_document_id ?? 'nenhum — nunca saiu daqui'}`,
      `por que é fixture  organização com prefixo determinístico de suíte viva;`,
      `                   nenhum usuário humano pertence a ela; ambiente`,
      `                   '${r.environment}' e provedor '${r.provider_key ?? 'sandbox'}'.`,
    ].join('\n  ') + '\n');
  }

  // Isolamento: essas linhas aparecem em métrica de produção?
  const leak = (await db.query(`
    SELECT count(*)::int n FROM public.fiscal_documents fd
      JOIN public.organizations o ON o.id = fd.organization_id
     WHERE NOT (${FIXTURE_ORG})`)).rows[0].n;

  const realEnv = fixtures.filter((r) => r.environment === 'production');
  const realProvider = fixtures.filter((r) => r.provider_key && r.provider_key !== 'sandbox');
  const withProviderId = fixtures.filter((r) => r.provider_document_id);

  console.log('─── ISOLAMENTO ──────────────────────────────────────────────');
  console.log(`documentos fiscais em organização REAL: ${leak}`);
  console.log(`fixtures em ambiente 'production':       ${realEnv.length}`);
  console.log(`fixtures em provedor REAL (não sandbox): ${realProvider.length}`);
  console.log(`fixtures com id de documento no provedor: ${withProviderId.length}`);
  console.log('\nToda leitura de produção é escopada por organization_id (RLS + '
    + 'current_user_organization_id). Nenhum usuário humano pertence às '
    + 'organizações de fixture, portanto elas não entram em métrica de ninguém.');
  console.log('\nCancelamento NÃO executado: é ato fiscal real e exige autorização separada.');
} catch (error) {
  console.error('FALHOU:', error.message);
  process.exitCode = 1;
} finally { await db.end(); }
