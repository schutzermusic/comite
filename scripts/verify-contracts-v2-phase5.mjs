/**
 * Fase 5 — reexecuta a bateria inteira contra o schema JÁ APLICADO.
 *
 *   node scripts/verify-contracts-v2-phase5.mjs
 *
 * Sempre dentro de uma transação, sempre com ROLLBACK no final. É o mesmo
 * arquivo de asserções que o aplicador roda, e é de propósito: uma bateria de
 * verificação diferente da de aplicação acaba divergindo, e a divergência
 * aparece como "passou na aplicação, falha em produção".
 *
 * Serve para regressão: qualquer mudança futura que enfraqueça segregação de
 * funções, ordem, quórum, alçada, delegação, impressão digital, atomicidade ou
 * fronteira de inquilino cai aqui.
 */
import pg from 'pg'; import dotenv from 'dotenv';
import { runPhase5Assertions } from './lib/phase5-assertions.mjs';
dotenv.config({ path: '.env', quiet: true }); dotenv.config({ path: '.env.local', quiet: true });

const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
c.on('notice', n => { if (!/skipping|already exists|no transaction/i.test(n.message)) console.log(`   NOTICE: ${n.message}`); });
await c.connect();
await c.query('SET SESSION default_transaction_read_only = off');
console.log('### VERIFICAÇÃO (ROLLBACK ao final) ###');

let ok = true;
const must = (label, pass, detail = '') => {
  console.log(`   ${pass ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!pass) ok = false;
};
const one = async (sql, params) => (await c.query(sql, params)).rows[0];

try {
  const tip = (await c.query(
    `SELECT version FROM supabase_migrations.schema_migrations ORDER BY version::int DESC LIMIT 1`)).rows[0].version;
  must('a Fase 5 está aplicada (registro >= 128)', Number(tip) >= 128, tip);
  if (Number(tip) < 128) throw new Error('aplique a Fase 5 antes de verificar.');

  await c.query('BEGIN');
  ok = (await runPhase5Assertions(c, { must, one })) && ok;
  await c.query('ROLLBACK');
  console.log('\n### ROLLBACK (verificação) ###');
} catch (e) {
  ok = false;
  try { await c.query('ROLLBACK'); } catch {}
  console.error('\nFALHA:', e.message);
  if (e.where) console.error('  em:', e.where);
} finally {
  await c.end();
}
console.log(ok ? '\nRESULTADO: VERDE' : '\nRESULTADO: VERMELHO');
process.exit(ok ? 0 : 1);
