/**
 * Validação CONTROLADA da retenção real de selfies (LGPD). NÃO toca dados de
 * produção: opera SOMENTE sob o path de um colaborador QA recém-criado e
 * remove APENAS os objetos que ele mesmo criou. Confirma:
 *   - deleção física via Storage API (objeto vencido some);
 *   - anonimização do ponteiro (authentication_evidence.provider_reference = null);
 *   - objeto/ponteiro NÃO vencidos permanecem intactos;
 *   - registro do resultado em ponto_job_runs.
 *
 * Replica a mesma mecânica de src/lib/ponto/retention-server.ts (Storage
 * remove + anonimização por-path), escopada ao QA. Rode em staging:
 *   node scripts/qa-retention-staging.mjs
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config({ path: '.env' });
dotenv.config({ path: '.env.local' });

const BUCKET = 'attendance-selfies';
const RETENTION_DAYS = 90;
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
const qa = JSON.parse(readFileSync('tests/.qa-env.json', 'utf8'));

const svc = createClient(url, service, { auth: { persistSession: false } });
const db = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });

const JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAAAv/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AfwD/2Q==',
  'base64',
);

let ok = true;
const P = (cond, msg) => { console.log((cond ? '✅' : '❌') + ' ' + msg); if (!cond) ok = false; };

async function main() {
  await db.connect();
  const per = await db.query(
    `insert into people (organization_id, full_name, status, source) values ($1,$2,'active','manual') returning id`,
    [qa.orgId, `QA Retention ${randomUUID().slice(0, 6)}`],
  );
  const personId = per.rows[0].id;
  const base = `${qa.orgId}/${personId}`;
  const oldPath = `${base}/old-${randomUUID()}.jpg`;
  const freshPath = `${base}/fresh-${randomUUID()}.jpg`;

  try {
    // 1) sobe 2 selfies + evidências
    for (const p of [oldPath, freshPath]) {
      const up = await svc.storage.from(BUCKET).upload(p, JPEG, { contentType: 'image/jpeg', upsert: false });
      if (up.error) throw new Error(`upload ${p}: ${up.error.message}`);
      await db.query(
        `insert into authentication_evidence (organization_id, person_id, method, result, assurance_level, provider_reference, metadata)
         values ($1,$2,'facial_verification','success','standard',$3, jsonb_build_object('path',$3::text))`,
        [qa.orgId, personId, p],
      );
    }
    // 2) envelhece SÓ o "old" (>90d) direto no storage.objects
    await db.query(
      `update storage.objects set created_at = now() - interval '200 days' where bucket_id=$1 and name=$2`,
      [BUCKET, oldPath],
    );

    // 3) "retention run" real, escopada ao person QA (mesma mecânica do produto)
    const cutoff = Date.now() - RETENTION_DAYS * 86_400_000;
    const runId = randomUUID();
    const { data: files, error: lerr } = await svc.storage.from(BUCKET).list(base, { limit: 100 });
    if (lerr) throw new Error(`list: ${lerr.message}`);
    const stale = (files || [])
      .filter((f) => f.id && f.created_at && new Date(f.created_at).getTime() < cutoff)
      .map((f) => `${base}/${f.name}`);

    let deleted = 0;
    let anonymized = 0;
    if (stale.length) {
      const rm = await svc.storage.from(BUCKET).remove(stale);
      if (rm.error) throw new Error(`remove: ${rm.error.message}`);
      deleted = stale.length;
      const upd = await db.query(
        `update authentication_evidence set provider_reference = null,
           metadata = (metadata - 'path') || jsonb_build_object('selfie_purged', true)
         where provider_reference = any($1) returning id`,
        [stale],
      );
      anonymized = upd.rowCount;
    }

    // 4) verificações
    const after = await svc.storage.from(BUCKET).list(base, { limit: 100 });
    const names = (after.data || []).map((f) => f.name);
    P(!names.includes(oldPath.split('/').pop()), 'objeto vencido removido do Storage');
    P(names.includes(freshPath.split('/').pop()), 'objeto recente permanece no Storage');

    const oldEv = await db.query('select provider_reference from authentication_evidence where person_id=$1 and provider_reference is null', [personId]);
    P(oldEv.rowCount === 1, 'ponteiro do vencido anonimizado (provider_reference = null)');
    const freshEv = await db.query('select 1 from authentication_evidence where provider_reference=$1', [freshPath]);
    P(freshEv.rowCount === 1, 'ponteiro do recente intacto');
    P(deleted === 1 && anonymized === 1, `resumo determinístico: deleted=${deleted}, anonymized=${anonymized}`);

    // 5) registra o resultado do job
    await db.query(
      `insert into ponto_job_runs (run_id, job_type, organization_id, status, dry_run, automation_enabled, scanned, succeeded, skipped, failed, triggered_by, metadata, completed_at)
       values ($1,'retention',$2,'success',false,false,$3,$4,0,0,'qa-staging', jsonb_build_object('scope','qa_person', 'person_id', $5::text, 'pointers_anonymized', $6::int), now())`,
      [runId, qa.orgId, (files || []).length, deleted, personId, anonymized],
    );
    P(true, `ponto_job_runs registrado (run_id=${runId})`);
  } finally {
    // cleanup total do QA
    try { await svc.storage.from(BUCKET).remove([oldPath, freshPath]); } catch { /* ignora */ }
    await db.query('delete from authentication_evidence where person_id=$1', [personId]).catch(() => {});
    await db.query('delete from ponto_job_runs where metadata->>\'person_id\' = $1', [personId]).catch(() => {});
    await db.query('delete from people where id=$1', [personId]).catch(() => {});
    await db.end();
  }

  console.log(ok ? '\nRETENÇÃO QA: OK' : '\nRETENÇÃO QA: FALHOU');
  process.exit(ok ? 0 : 1);
}

main().catch((e) => { console.error('ERRO', e.message); process.exit(1); });
