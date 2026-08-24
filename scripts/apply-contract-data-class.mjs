/**
 * Aplica a migration 091 (classificação de origem do contrato) e audita o
 * resultado.
 *
 *   node scripts/apply-contract-data-class.mjs           # aplica e verifica
 *   node scripts/apply-contract-data-class.mjs --check   # só verifica
 *
 * A migration é aditiva e idempotente. O script imprime a classificação de
 * TODA linha da carteira antes e depois, para que a decisão fique registrada e
 * revisável — a classificação determina o que a empresa considera sua carteira
 * oficial, e isso não pode acontecer em silêncio.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config({ path: '.env' });
dotenv.config({ path: '.env.local' });

const dbUrl = process.env.SUPABASE_DB_URL;
if (!dbUrl) {
  console.error('SUPABASE_DB_URL ausente no .env/.env.local');
  process.exit(1);
}

const checkOnly = process.argv.includes('--check');
const MIGRATION = 'supabase/migrations/091_contract_data_class.sql';

const client = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
await client.connect();

const q = async (sql, params = []) => (await client.query(sql, params)).rows;

/** Imprime a carteira com a classificação atual. */
async function portfolio(label) {
  const hasColumn = (await q(`
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'contracts' AND column_name = 'data_class'`)).length > 0;

  console.log(`\n── ${label} ──`);
  if (!hasColumn) {
    console.log('   (coluna data_class ainda não existe)');
    return;
  }

  const rows = await q(`
    SELECT id, data_class, contract_number, title, counterparty_name, total_value
      FROM contracts
     WHERE deleted_at IS NULL
     ORDER BY data_class, created_at`);

  for (const r of rows) {
    console.log(
      `   ${String(r.data_class).padEnd(13)} ${String(r.contract_number ?? '—').padEnd(10)} ` +
      `${String(r.title).slice(0, 34).padEnd(34)} R$ ${String(r.total_value ?? '—').padStart(12)}   ${r.id}`,
    );
  }

  const totals = await q(`
    SELECT data_class, count(*)::int n, coalesce(sum(total_value), 0)::numeric exposure
      FROM contracts WHERE deleted_at IS NULL GROUP BY data_class ORDER BY data_class`);
  console.log('   ┈┈┈');
  for (const t of totals) {
    console.log(`   ${String(t.data_class).padEnd(13)} ${t.n} contrato(s) · exposição R$ ${t.exposure}`);
  }
}

try {
  await portfolio('ANTES');

  if (!checkOnly) {
    const sql = readFileSync(resolve(process.cwd(), MIGRATION), 'utf8');
    console.log(`\n▸ aplicando ${MIGRATION}…`);
    await client.query(sql);
    console.log('  ok');
  }

  await portfolio(checkOnly ? 'ESTADO ATUAL' : 'DEPOIS');

  // ── Verificações ──────────────────────────────────────────────────────────
  console.log('\n── verificações ──');

  const check = await q(`
    SELECT pg_get_constraintdef(oid) def FROM pg_constraint
     WHERE conname = 'contracts_data_class_check'`);
  console.log(`   CHECK: ${check[0]?.def ?? 'AUSENTE ✗'}`);

  const def = await q(`
    SELECT column_default, is_nullable FROM information_schema.columns
     WHERE table_name = 'contracts' AND column_name = 'data_class'`);
  console.log(`   DEFAULT: ${def[0]?.column_default ?? '—'} · nullable: ${def[0]?.is_nullable}`);

  const idx = await q(`SELECT indexname FROM pg_indexes WHERE indexname = 'idx_contracts_data_class'`);
  console.log(`   índice: ${idx.length ? 'presente' : 'AUSENTE ✗'}`);

  // A garantia que mais importa: a exposição OFICIAL da carteira.
  const official = await q(`
    SELECT count(*)::int n, coalesce(sum(total_value), 0)::numeric exposure
      FROM contracts WHERE deleted_at IS NULL AND data_class = 'live'`);
  const everything = await q(`
    SELECT count(*)::int n, coalesce(sum(total_value), 0)::numeric exposure
      FROM contracts WHERE deleted_at IS NULL`);
  console.log(`\n   exposição OFICIAL (live):  R$ ${official[0].exposure}  em ${official[0].n} contrato(s)`);
  console.log(`   exposição de TODA a base:  R$ ${everything[0].exposure}  em ${everything[0].n} contrato(s)`);
  console.log(`   → ${(Number(everything[0].exposure) - Number(official[0].exposure)).toFixed(2)} deixam de ser apresentados como carteira da empresa.`);

  const unclassified = await q(`
    SELECT count(*)::int n FROM contracts WHERE deleted_at IS NULL AND data_class = 'unclassified'`);
  if (unclassified[0].n > 0) {
    console.log(`\n   ⚠ ${unclassified[0].n} contrato(s) permanecem NÃO CLASSIFICADOS.`);
    console.log('     Não entram em métrica oficial. Exigem decisão de negócio para serem');
    console.log('     promovidos a `live` ou reconhecidos como `demo`.');
  }
} finally {
  await client.end();
}
