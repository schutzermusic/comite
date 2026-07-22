/**
 * Expurgo físico das selfies de ponto vencidas (LGPD). Usa a Storage API
 * (remoção real dos bytes) e depois chama a função SQL para limpar os
 * ponteiros na authentication_evidence. Agende-o (cron/agente) para rodar
 * diariamente, ou rode sob demanda:
 *
 *   node scripts/purge-attendance-selfies.mjs [retentionDays=90]
 */
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env' });
dotenv.config({ path: '.env.local' });

const BUCKET = 'attendance-selfies';
const retentionDays = Number(process.argv[2] || 90);
const cutoff = Date.now() - retentionDays * 86_400_000;

const svc = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

async function listAllOld(prefix, acc) {
  // storage.list é paginado por pasta; percorremos org/person/arquivo.
  const { data, error } = await svc.storage.from(BUCKET).list(prefix, { limit: 1000 });
  if (error) throw new Error(`list ${prefix}: ${error.message}`);
  for (const entry of data ?? []) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.id === null || entry.metadata == null) {
      // "pasta" (org/ ou person/) — desce um nível
      await listAllOld(path, acc);
    } else {
      const created = entry.created_at ? new Date(entry.created_at).getTime() : 0;
      if (created && created < cutoff) acc.push(path);
    }
  }
  return acc;
}

async function main() {
  console.log(`Expurgo de selfies com mais de ${retentionDays} dias…`);
  const old = await listAllOld('', []);
  if (old.length === 0) {
    console.log('Nada a expurgar.');
  } else {
    for (let i = 0; i < old.length; i += 100) {
      const chunk = old.slice(i, i + 100);
      const { error } = await svc.storage.from(BUCKET).remove(chunk);
      if (error) throw new Error(`remove: ${error.message}`);
    }
    console.log(`Removidos ${old.length} objetos de selfie.`);
  }
  // limpa ponteiros nas evidências (mantém a linha p/ auditoria)
  const { data, error } = await svc.rpc('purge_attendance_selfies', { p_retention_days: retentionDays });
  if (error) console.log('Aviso ao limpar ponteiros:', error.message);
  else console.log('Ponteiros de evidência limpos. Retorno SQL:', data);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
