/**
 * Reexecuta as provas de Decisões contra o esquema JÁ aplicado — numa
 * transação SEMPRE desfeita. Nada sobra no banco.
 *
 *   node scripts/decisions/prove.mjs --target=qa
 */
import { createProofContext, realAnchors, targetDatabase } from '../operations/lib/proof-kit.mjs';
import { decisionsProofs } from './proofs.mjs';

const target = targetDatabase();
const db = target.client();
let failed = 1;
try {
  await db.connect();
  const applied = (await db.query(`SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '240'`)).rowCount > 0;
  if (!applied) throw new Error('240 não está aplicada neste alvo.');
  console.log(`Alvo: ${target.label} (provas desfeitas)`);
  await db.query('BEGIN READ WRITE');
  const ctx = createProofContext(db);
  try {
    await decisionsProofs({ db, ...ctx, anchors: await realAnchors(db) });
  } catch (error) {
    ctx.check('provas concluídas sem erro inesperado', false, error.stack?.split('\n').slice(0, 3).join(' | ') ?? error.message);
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
