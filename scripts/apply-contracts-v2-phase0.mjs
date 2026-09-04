/**
 * Aplicador das migrations da Fase 0 do Contracts V2 (099, 100, 101).
 *
 *   node scripts/apply-contracts-v2-phase0.mjs           # ENSAIO: aplica e faz ROLLBACK
 *   node scripts/apply-contracts-v2-phase0.mjs --apply   # aplica de verdade (COMMIT)
 *
 * As três migrations vão numa transação só, e por um motivo: 100 depende da
 * 101? Não — mas aplicar metade da Fase 0 deixa o banco num estado que nenhum
 * teste descreve. Ou entra tudo, ou não entra nada.
 *
 * O ensaio é o modo padrão de propósito. Ele executa exatamente o mesmo SQL,
 * roda as mesmas verificações e as mesmas provas funcionais dos invariantes, e
 * desfaz tudo no final — então "passou no ensaio" significa que o SQL vale
 * contra os dados REAIS desta base, não contra uma cópia parecida.
 *
 * Se qualquer prova falhar, o COMMIT não acontece nem com `--apply`.
 */
import { readFileSync } from 'node:fs';
import pg from 'pg'; import dotenv from 'dotenv';
dotenv.config({ path: '.env' }); dotenv.config({ path: '.env.local' });

const APPLY = process.argv.includes('--apply');
const FILES = ['099_tenant_isolation_reference_tables.sql','100_contract_approval_safety.sql','101_contract_status_vocabulary.sql'];

const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
c.on('notice', n => console.log(`   NOTICE: ${n.message}`));
await c.connect();
console.log(APPLY ? '### MODO APLICAR (COMMIT) ###' : '### DRY RUN (ROLLBACK ao final) ###');

let ok = true;
try {
  await c.query('BEGIN');
  for (const f of FILES) {
    const sql = readFileSync(`supabase/migrations/${f}`, 'utf8')
      .replace(/^\s*BEGIN;\s*$/gm, '').replace(/^\s*COMMIT;\s*$/gm, '');
    process.stdout.write(`\n-> ${f}\n`);
    await c.query(sql);
    console.log(`   OK`);
  }

  // ---- verificações dentro da mesma transação ----
  const v = async (label, sql) => {
    const { rows } = await c.query(sql);
    console.log(`\n[check] ${label}`);
    console.log(rows.length ? rows.map(r => '   ' + JSON.stringify(r)).join('\n') : '   (vazio)');
  };
  await v('policies cost_center/supplier', `SELECT tablename, policyname, cmd, qual, with_check FROM pg_policies WHERE schemaname='public' AND tablename IN ('cost_center','supplier') ORDER BY 1,2`);
  await v('policies contract_approvals', `SELECT policyname, cmd, qual IS NOT NULL AS has_using, with_check IS NOT NULL AS has_check FROM pg_policies WHERE schemaname='public' AND tablename='contract_approvals' ORDER BY 1`);
  await v('org columns', `SELECT table_name, column_name, is_nullable FROM information_schema.columns WHERE table_schema='public' AND table_name IN ('cost_center','supplier') AND column_name='organization_id'`);
  await v('contracts CHECKs', `SELECT conname, pg_get_constraintdef(oid) def FROM pg_constraint WHERE conrelid='public.contracts'::regclass AND contype='c'`);
  await v('trigger', `SELECT tgname FROM pg_trigger WHERE tgrelid='public.contract_approvals'::regclass AND NOT tgisinternal`);

  // ---- prova funcional dos invariantes (dentro da tx) ----
  const [{ id: cid, created_by: creator, organization_id: org }] = (await c.query(
    `SELECT id, created_by, organization_id FROM contracts WHERE created_by IS NOT NULL ORDER BY created_at DESC LIMIT 1`)).rows;
  const other = (await c.query(`SELECT user_id FROM profiles WHERE user_id <> $1 LIMIT 1`, [creator])).rows[0]?.user_id;
  console.log(`\n[prova] contrato=${cid} criador=${creator} outro_usuario=${other ?? 'NENHUM'}`);

  const expectFail = async (label, sql, params) => {
    await c.query('SAVEPOINT sp');
    try { await c.query(sql, params); console.log(`   ✗ ${label}: PASSOU (deveria falhar)`); ok = false; }
    catch (e) { console.log(`   ✓ ${label}: bloqueado — ${e.message.split('\n')[0]}`); }
    await c.query('ROLLBACK TO SAVEPOINT sp');
  };
  const expectOk = async (label, sql, params) => {
    await c.query('SAVEPOINT sp');
    try { await c.query(sql, params); console.log(`   ✓ ${label}: permitido`); }
    catch (e) { console.log(`   ✗ ${label}: BLOQUEADO — ${e.message.split('\n')[0]}`); ok = false; }
    await c.query('ROLLBACK TO SAVEPOINT sp');
  };

  const ins = `INSERT INTO contract_approvals (organization_id, contract_id, step_name, status, reviewer_user_id) VALUES ($1,$2,$3,$4,$5)`;
  await expectFail('autor não aprova o próprio contrato', ins, [org, cid, 'juridico', 'approved', creator]);
  await expectFail('autor não rejeita o próprio contrato', ins, [org, cid, 'juridico', 'rejected', creator]);
  await expectOk('trâmite (under_review) do autor é permitido', ins, [org, cid, 'juridico', 'under_review', creator]);
  if (other) {
    await expectOk('outro usuário aprova a 1a etapa', ins, [org, cid, 'juridico', 'approved', other]);
    await c.query('SAVEPOINT sp2');
    await c.query(ins, [org, cid, 'juridico', 'pending', other]);
    await expectFail('etapa posterior não aprova com anterior pendente', ins, [org, cid, 'diretoria', 'approved', other]);
    await c.query('ROLLBACK TO SAVEPOINT sp2');
  }
  await expectFail('status fora do vocabulário', `UPDATE contracts SET status='wat' WHERE id=$1`, [cid]);
  await expectOk('status do vocabulário', `UPDATE contracts SET status='signed' WHERE id=$1`, [cid]);

} catch (e) {
  ok = false;
  console.error(`\n!!! FALHA: ${e.message}`);
} finally {
  if (APPLY && ok) { await c.query('COMMIT'); console.log('\n>>> COMMIT aplicado.'); }
  else { await c.query('ROLLBACK'); console.log(APPLY ? '\n>>> ROLLBACK (houve falha) — nada aplicado.' : '\n>>> ROLLBACK (dry run) — nada aplicado.'); }
  await c.end();
}
process.exit(ok ? 0 : 1);
