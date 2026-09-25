/**
 * Reexecuta as provas da 243 (e da 244, se aplicada) contra o esquema JÁ aplicado — numa transação
 * SEMPRE desfeita. Nada sobra no banco.
 *
 *   node scripts/notifications/prove.mjs --target=qa
 */
import { createProofContext, realAnchors, targetDatabase } from '../operations/lib/proof-kit.mjs';
import { payrollEmailProofs } from './proofs-243.mjs';
import { payrollHardeningProofs } from './proofs-244.mjs';

const target = targetDatabase();
const db = target.client();
let failed = 1;
try {
  await db.connect();
  const applied = (await db.query(`SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '243'`)).rowCount > 0;
  if (!applied) throw new Error('243 não está aplicada neste alvo.');
  console.log(`Alvo: ${target.label} (provas desfeitas)`);
  await db.query('BEGIN READ WRITE');
  const ctx = createProofContext(db);
  try {
    const anchors = await realAnchors(db);
    const has244 = (await db.query(`SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '244'`)).rowCount > 0;
    if (has244) await payrollHardeningProofs({ db, ...ctx, anchors });
    await payrollEmailProofs({ db, ...ctx, anchors });
  } catch (error) {
    ctx.check('provas concluídas sem erro inesperado', false, error.message);
  }
  failed = ctx.results.filter((r) => !r.ok).length;
  console.log(`\n${ctx.results.length - failed}/${ctx.results.length} provas passaram.`);
} catch (error) {
  console.error(`FALHA: ${error.message}`);
} finally {
  await db.query('ROLLBACK').catch(() => undefined);
  await db.end().catch(() => undefined);
}
process.exitCode = failed > 0 ? 1 : 0;
