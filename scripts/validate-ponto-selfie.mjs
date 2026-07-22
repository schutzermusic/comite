/**
 * Validação da infra de selfie do Ponto (não deixa dados residuais):
 *  1) upload real no bucket privado attendance-selfies via service role
 *     -> confirma SUPABASE_SERVICE_ROLE_KEY + bucket writable + privacidade;
 *  2) teste transacional (ROLLBACK) da query de frescor de 3 min + posse
 *     usada por /api/mobile/punch.
 */
import { createClient } from '@supabase/supabase-js';
import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config({ path: '.env' });
dotenv.config({ path: '.env.local' });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const dbUrl = process.env.SUPABASE_DB_URL;
const BUCKET = 'attendance-selfies';

// 1x1 JPEG (base64)
const JPEG_1x1 =
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAAAv/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AfwD/2Q==';

async function main() {
  console.log('— Validação da selfie de Ponto —\n');

  // 1) storage roundtrip
  const svc = createClient(url, serviceKey, { auth: { persistSession: false } });
  const path = `_selftest/${Date.now()}.jpg`;
  const bytes = Buffer.from(JPEG_1x1, 'base64');

  const up = await svc.storage.from(BUCKET).upload(path, bytes, { contentType: 'image/jpeg', upsert: false });
  console.log('1) upload service-role:', up.error ? `FALHOU: ${up.error.message}` : 'OK');
  if (!up.error) {
    // confirmar privacidade: getPublicUrl não deve servir o objeto
    const pub = svc.storage.from(BUCKET).getPublicUrl(path);
    const res = await fetch(pub.data.publicUrl).catch(() => null);
    console.log('   privacidade (public URL bloqueada):', res && res.ok ? `FALHOU (HTTP ${res.status} acessível!)` : `OK (bucket privado)`);
    // signed url deve funcionar (acesso autorizado)
    const signed = await svc.storage.from(BUCKET).createSignedUrl(path, 60);
    console.log('   signed URL (acesso autorizado):', signed.error ? `FALHOU: ${signed.error.message}` : 'OK');
    // cleanup
    const rm = await svc.storage.from(BUCKET).remove([path]);
    console.log('   cleanup:', rm.error ? `FALHOU: ${rm.error.message}` : 'OK (objeto de teste removido)');
  }

  // 2) freshness/ownership — transacional com ROLLBACK
  const client = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    const person = await client.query(
      `select id, organization_id from people limit 1`,
    );
    if (!person.rows[0]) {
      console.log('\n2) freshness: pulado (nenhuma pessoa cadastrada para o teste)');
      return;
    }
    const { id: personId, organization_id: orgId } = person.rows[0];
    await client.query('BEGIN');

    // evidência fresca (agora) e evidência velha (4 min atrás)
    const fresh = await client.query(
      `insert into authentication_evidence (organization_id, person_id, method, result, assurance_level)
       values ($1,$2,'facial_verification','success','standard') returning id`,
      [orgId, personId],
    );
    const stale = await client.query(
      `insert into authentication_evidence (organization_id, person_id, method, result, verified_at, created_at)
       values ($1,$2,'facial_verification','success', now() - interval '4 minutes', now() - interval '4 minutes') returning id`,
      [orgId, personId],
    );

    // query EXATA do punch: result success + created_at >= cutoff(3min) + dono
    const cutoffQ = `select id from authentication_evidence
       where id = $1 and person_id = $2 and result = 'success'
         and created_at >= now() - interval '3 minutes'`;
    const freshHit = await client.query(cutoffQ, [fresh.rows[0].id, personId]);
    const staleHit = await client.query(cutoffQ, [stale.rows[0].id, personId]);
    // posse: outra pessoa não acha a evidência
    const wrongOwner = await client.query(cutoffQ, [fresh.rows[0].id, '00000000-0000-0000-0000-000000000000']);

    console.log('\n2) freshness/ownership (ROLLBACK, sem persistir):');
    console.log('   evidência fresca aceita:      ', freshHit.rowCount === 1 ? 'OK' : 'FALHOU');
    console.log('   evidência de 4min recusada:   ', staleHit.rowCount === 0 ? 'OK' : 'FALHOU');
    console.log('   evidência de outro dono negada:', wrongOwner.rowCount === 0 ? 'OK' : 'FALHOU');

    await client.query('ROLLBACK');
  } finally {
    await client.end();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
