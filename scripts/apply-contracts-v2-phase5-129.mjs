/**
 * Fase 5 — correção 129: a expiração ganha ponto de entrada POR INQUILINO.
 *
 *   node scripts/apply-contracts-v2-phase5-129.mjs           # ENSAIO
 *   node scripts/apply-contracts-v2-phase5-129.mjs --apply   # COMMIT
 *
 * A 127 não foi editada. Migration aplicada é registro — a mesma regra que
 * produziu a 123 e a 124 na Fase 4.
 */
import { readFileSync } from 'node:fs';
import pg from 'pg'; import dotenv from 'dotenv';
import { recordMigrationApplied } from './lib/migration-registry.mjs';
dotenv.config({ path: '.env', quiet: true }); dotenv.config({ path: '.env.local', quiet: true });
const APPLY = process.argv.includes('--apply');
const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await c.connect(); await c.query('SET SESSION default_transaction_read_only = off');
let ok = true; const must=(l,p,d='')=>{console.log(`   ${p?'✓':'✗'} ${l}${d?` — ${d}`:''}`); if(!p) ok=false;};
try {
  const tip=(await c.query(`SELECT version FROM supabase_migrations.schema_migrations ORDER BY version::int DESC LIMIT 1`)).rows[0].version;
  must('ponta do registro é 128', tip==='128', tip);
  if (tip!=='128') throw new Error('esperava 128');
  await c.query('BEGIN');
  await c.query(readFileSync('supabase/migrations/129_platform_approval_expiration_job.sql','utf8')
    .replace(/^\s*BEGIN;\s*$/gm,'').replace(/^\s*COMMIT;\s*$/gm,''));
  await recordMigrationApplied(c,'129','platform_approval_expiration_job');
  must('129 aplicada e registrada', true);
  // Provas: sem pedido vencido, nada é enfileirado; guardas recusam.
  must('nenhum pedido vencido hoje ⇒ nenhum trabalho enfileirado',
    (await c.query(`SELECT approval_enqueue_expiration() n`)).rows[0].n === 0);
  const bad = async (sql)=>{ await c.query('SAVEPOINT s'); try{ await c.query(sql); await c.query('ROLLBACK TO SAVEPOINT s'); return null;}catch(e){await c.query('ROLLBACK TO SAVEPOINT s'); return e.message;} };
  must('expiração sem organização é recusada', (await bad(`SELECT approval_requests_expire_due_for_org(NULL)`)) !== null);
  must('limite NULL é recusado (lição da 124)',
    (await bad(`SELECT approval_requests_expire_due_for_org(gen_random_uuid(), NULL)`)) !== null);
  must('o tipo de trabalho casa com o CHECK de apex_jobs',
    (await c.query(`SELECT 'platform.approvals.expire' ~ '^[a-z][a-z0-9_]*(\\.[a-z][a-z0-9_]*)+$' AS v`)).rows[0].v);
  const t=(await c.query(`SELECT count(*)::int n FROM information_schema.role_table_grants WHERE table_schema='public' AND privilege_type='TRUNCATE' AND grantee IN ('anon','authenticated')`)).rows[0].n;
  must('TRUNCATE continua zero', t===0);
  if (APPLY && ok) { await c.query('COMMIT'); console.log('### COMETIDO ###'); }
  else { await c.query('ROLLBACK'); console.log(APPLY?'### ROLLBACK: falha ###':'### ROLLBACK (ensaio) ###'); }
} catch(e){ ok=false; try{await c.query('ROLLBACK');}catch{}; console.error('FALHA:', e.message); }
finally { await c.end(); }
console.log(ok?'VERDE':'VERMELHO'); process.exit(ok?0:1);
