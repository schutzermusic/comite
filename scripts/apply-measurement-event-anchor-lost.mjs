/**
 * Aplica a migration 186 — estado ANCHOR_LOST.
 *
 * Apenas LEITURA: acrescenta um estado derivado e quatro colunas à visão.
 * Não escreve em mapeamento nem em cronograma.
 *
 * Uso: node scripts/apply-measurement-event-anchor-lost.mjs [--apply]
 */
import pg from 'pg'; import dotenv from 'dotenv'; import fs from 'node:fs';
dotenv.config({ path: '.env', quiet: true });
dotenv.config({ path: '.env.local', quiet: true });
const apply = process.argv.includes('--apply');
const url = process.env.SUPABASE_DB_URL;
if (!url) { console.error('SUPABASE_DB_URL ausente.'); process.exit(2); }
const c = new pg.Client({ connectionString: url });
await c.connect();
const P = 'proj-3a445bb5-c576-445d-bb49-adcddd52dc1d';
try {
  await c.query('BEGIN');
  await c.query(fs.readFileSync('supabase/migrations/186_measurement_event_anchor_lost.sql', 'utf8')
    .replace(/^BEGIN;$/m, '--').replace(/^COMMIT;$/m, '--'));
  console.log('✓ 186_measurement_event_anchor_lost.sql');

  const before = (await c.query(`select link_state, count(*)::int n
    from project_schedule_contract_events where project_id=$1 group by 1 order by 1`, [P])).rows;
  console.log('  estado atual:', before.map(r => `${r.link_state}=${r.n}`).join(' '));

  // Simula a etapa sumindo do cronograma novo: ela é DESATIVADA, não apagada.
  await c.query('SAVEPOINT s');
  const item = (await c.query(
    `select timeline_item_id from project_schedule_contract_events
      where project_id=$1 and link_state='ACCEPTED' limit 1`, [P])).rows[0];
  await c.query('update project_timeline_items set is_active=false where id=$1', [item.timeline_item_id]);
  const after = (await c.query(`select link_state, count(*)::int n
    from project_schedule_contract_events where project_id=$1 group by 1 order by 1`, [P])).rows;
  console.log('  com 1 etapa desativada:', after.map(r => `${r.link_state}=${r.n}`).join(' '));
  if (!after.some(r => r.link_state === 'ANCHOR_LOST' && r.n === 1)) {
    throw new Error('ANCHOR_LOST não apareceu');
  }
  const still = (await c.query(
    `select review_state, reviewed_by is not null rev from contract_measurement_rule_timeline_mappings
      where timeline_item_id=$1`, [item.timeline_item_id])).rows[0];
  console.log('  o mapeamento continua', still.review_state, '· revisor preservado:', still.rev);
  await c.query('ROLLBACK TO SAVEPOINT s');

  const ev = await c.query('select count(*)::int n from contract_billing_events');
  console.log('  contract_billing_events:', ev.rows[0].n, '(inalterado)');

  if (apply) { await c.query('COMMIT'); console.log('\nAPLICADA.'); }
  else { await c.query('ROLLBACK'); console.log('\nENSAIO — desfeito.'); }
} catch (e) {
  await c.query('ROLLBACK'); console.error('\nFALHOU:', e.message); process.exitCode = 1;
} finally { await c.end(); }
