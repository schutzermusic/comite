/**
 * Retenção LGPD das selfies (server-only). Remoção FÍSICA dos bytes via
 * Storage API (o Supabase bloqueia DELETE direto em storage.objects) +
 * anonimização dos ponteiros na authentication_evidence (RPC). Suporta
 * dry-run, cutoff por ambiente, escopo por organização e auditoria.
 */
if (typeof window !== 'undefined') {
  throw new Error('src/lib/ponto/retention-server.ts must not be imported in the browser');
}

import type { SupabaseClient } from '@supabase/supabase-js';
import { getServiceClient } from '@/lib/ai/server-clients';

const BUCKET = 'attendance-selfies';
// Só apaga objetos cujo caminho segue a convenção {orgId}/{personId}/arquivo.
const SELFIE_PATH_RE = /^[0-9a-fA-F-]{36}\/[0-9a-fA-F-]{36}\/.+\.(jpe?g|png|webp)$/;

export function retentionDaysDefault(): number {
  const v = Number(process.env.PONTO_SELFIE_RETENTION_DAYS);
  return Number.isFinite(v) && v > 0 ? v : 90;
}

export interface PurgeSummary {
  dryRun: boolean;
  retentionDays: number;
  scanned: number;
  matched: number; // vencidos que casam a convenção de caminho
  filesDeleted: number;
  pointersAnonymized: number;
  byOrg: Record<string, number>;
  errors: string[];
}

type StorageEntry = { name: string; id: string | null; created_at?: string; metadata?: unknown };

/** Lista recursivamente os arquivos de selfie sob um prefixo. */
async function listFiles(service: SupabaseClient, prefix: string, acc: Array<{ path: string; created: number }>): Promise<void> {
  const { data, error } = await service.storage.from(BUCKET).list(prefix, { limit: 1000 });
  if (error) throw new Error(`list ${prefix || '/'}: ${error.message}`);
  for (const entry of (data ?? []) as StorageEntry[]) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.id === null || entry.metadata == null) {
      await listFiles(service, path, acc); // "pasta" (org/ ou person/)
    } else {
      acc.push({ path, created: entry.created_at ? new Date(entry.created_at).getTime() : 0 });
    }
  }
}

/**
 * Expurga selfies vencidas. dryRun=true não apaga nem anonimiza — só conta.
 * `organizationId` restringe ao prefixo daquela org (nunca apaga fora dele).
 */
export async function purgeSelfies(opts: { retentionDays?: number; dryRun?: boolean; organizationId?: string | null } = {}): Promise<PurgeSummary> {
  const service = getServiceClient();
  const retentionDays = opts.retentionDays && opts.retentionDays > 0 ? opts.retentionDays : retentionDaysDefault();
  const dryRun = opts.dryRun === true;
  const cutoff = Date.now() - retentionDays * 86_400_000;
  const summary: PurgeSummary = { dryRun, retentionDays, scanned: 0, matched: 0, filesDeleted: 0, pointersAnonymized: 0, byOrg: {}, errors: [] };

  const all: Array<{ path: string; created: number }> = [];
  try {
    await listFiles(service, opts.organizationId ? opts.organizationId : '', all);
  } catch (e) {
    summary.errors.push(e instanceof Error ? e.message : String(e));
    return summary;
  }
  summary.scanned = all.length;

  // vencidos + convenção de caminho válida (defesa: nunca fora do padrão)
  const stale = all.filter((f) => f.created > 0 && f.created < cutoff && SELFIE_PATH_RE.test(f.path));
  summary.matched = stale.length;
  for (const f of stale) {
    const org = f.path.split('/')[0];
    summary.byOrg[org] = (summary.byOrg[org] ?? 0) + 1;
  }

  if (dryRun || stale.length === 0) return summary;

  // remoção física em lotes, com isolamento de falha por lote
  const paths = stale.map((f) => f.path);
  for (let i = 0; i < paths.length; i += 100) {
    const chunk = paths.slice(i, i + 100);
    const { error } = await service.storage.from(BUCKET).remove(chunk);
    if (error) summary.errors.push(`remove lote ${i}: ${error.message}`);
    else summary.filesDeleted += chunk.length;
  }

  // anonimiza ponteiros (RPC) — mantém a linha de evidência para auditoria
  const { data: cleared, error: rpcErr } = await service.rpc('purge_attendance_selfies', { p_retention_days: retentionDays });
  if (rpcErr) summary.errors.push(`rpc: ${rpcErr.message}`);
  else summary.pointersAnonymized = (cleared as number) ?? 0;

  // auditoria: uma linha por organização afetada (sem dados de selfie)
  for (const [orgId, count] of Object.entries(summary.byOrg)) {
    await service.from('audit_logs').insert({
      organization_id: orgId,
      actor_user_id: null,
      action: 'attendance.selfie.purged',
      entity_type: 'attendance_selfie_retention',
      entity_id: null,
      metadata: { retention_days: retentionDays, files_deleted: count, dry_run: false },
    });
  }

  return summary;
}
