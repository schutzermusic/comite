import { readFileSync } from 'node:fs';
import pg from 'pg'; import dotenv from 'dotenv';
import { recordMigrationApplied } from './lib/migration-registry.mjs';
dotenv.config({path:'.env',quiet:true}); dotenv.config({path:'.env.local',quiet:true});
const APPLY=process.argv.includes('--apply');
const c=new pg.Client({connectionString:process.env.SUPABASE_DB_URL,ssl:{rejectUnauthorized:false}});
await c.connect(); await c.query('SET SESSION default_transaction_read_only = off');
const strip=(s)=>s.replace(/^\s*(BEGIN|COMMIT)\s*;\s*$/gmi,'');
let ok=true; const must=(l,p,d='')=>{console.log(`   ${p?'✓':'✗'} ${l}${d?` — ${d}`:''}`);if(!p)ok=false;};
try{
  const tip=(await c.query(`SELECT version FROM supabase_migrations.schema_migrations ORDER BY version::int DESC LIMIT 1`)).rows[0].version;
  must('ponta do registro é 147', tip==='147', tip);
  if(tip!=='147') throw new Error('ponta inesperada');
  await c.query('BEGIN');
  await c.query(strip(readFileSync('supabase/migrations/148_organization_enterprise_anchor.sql','utf8')));
  await recordMigrationApplied(c,'148','organization_enterprise_anchor');
  console.log('   ✓ 148_organization_enterprise_anchor');
  await c.query('SAVEPOINT battery');
  const sfx=Math.random().toString(36).slice(2,8);
  const org=(await c.query(`INSERT INTO organizations (name,slug) VALUES ($1,$2) RETURNING id, enterprise_account_id`,[`[P148] ${sfx}`,`p148-${sfx}`])).rows[0];
  must('inserção legada ganha âncora empresarial', !!org.enterprise_account_id, org.enterprise_account_id);
  const eam=(await c.query(`SELECT count(*)::int n FROM enterprise_account_memberships WHERE enterprise_account_id=$1`,[org.enterprise_account_id])).rows[0].n;
  must('a conta criada NÃO concede autoridade a ninguém', Number(eam)===0, `${eam} vínculo(s)`);
  const org2=(await c.query(`INSERT INTO organizations (name,slug) VALUES ($1,$2) RETURNING enterprise_account_id`,[`[P148] ${sfx}`,`p148b-${sfx}`])).rows[0];
  must('duas organizações homônimas não colidem de slug de conta', org2.enterprise_account_id!==org.enterprise_account_id);
  must('cada uma no PRÓPRIO grupo (isolamento máximo por omissão)', org2.enterprise_account_id!==org.enterprise_account_id);
  await c.query('ROLLBACK TO SAVEPOINT battery');
  must('resíduo zero', Number((await c.query(`SELECT count(*)::int n FROM organizations WHERE name LIKE '[P148]%'`)).rows[0].n)===0);
  if(!ok) throw new Error('bateria reprovada');
  if(APPLY){await c.query('COMMIT');console.log('=== COMETIDO ===');}
  else{await c.query('ROLLBACK');console.log('=== ENSAIO: DESFEITO ===');}
}catch(e){await c.query('ROLLBACK').catch(()=>{});console.error('✗ FALHOU:',e.message);ok=false;}
await c.end(); process.exit(ok?0:1);
