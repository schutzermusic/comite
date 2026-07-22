/**
 * Retenção LGPD das selfies (server-only). Remoção FÍSICA dos bytes via
 * Storage API (o Supabase bloqueia DELETE direto em storage.objects) +
 * anonimização dos ponteiros na authentication_evidence — SÓ depois da
 * deleção bem-sucedida. Execução LIMITADA (batch + duração máx + cursor de
 * continuação) para bases grandes rodarem em vários passes sem timeout.
 * Suporta dry-run, escopo por organização e auditoria.
 */
if (typeof window !== 'undefined') {
  throw new Error('src/lib/ponto/retention-server.ts must not be imported in the browser');
}

import type { SupabaseClient } from '@supabase/supabase-js';
import { getServiceClient } from '@/lib/ai/server-clients';

const BUCKET = 'attendance-selfies';
// Só apaga objetos cujo caminho segue a convenção {orgId}/{personId}/arquivo.
const SELFIE_PATH_RE = /^[0-9a-fA-F-]{36}\/[0-9a-fA-F-]{36}\/.+\.(jpe?g|png|webp)$/;
const REMOVE_CHUNK = 100;

function envInt(name: string, def: number): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : def;
}
export function retentionDaysDefault(): number { return envInt('PONTO_SELFIE_RETENTION_DAYS', 90); }
export function retentionBatchDefault(): number { return envInt('PONTO_RETENTION_BATCH_SIZE', 500); }
export function retentionMaxMsDefault(): number { return envInt('PONTO_RETENTION_MAX_MS', 240_000); }

export interface PurgeSummary {
  dryRun: boolean;
  retentionDays: number;
  batchSize: number;
  scanned: number;
  matched: number; // vencidos que casam a convenção de caminho (nesta janela)
  filesDeleted: number;
  pointersAnonymized: number;
  byOrg: Record<string, number>;
  continuationCursor: string | null; // orgId para retomar; null = concluído
  errors: string[];
}

type StorageEntry = { name: string; id: string | null; created_at?: string; metadata?: unknown };

/** Lista os "diretórios" de topo do bucket (um por organização). */
async function listOrgPrefixes(service: SupabaseClient): Promise<string[]> {
  const { data, error } = await service.storage.from(BUCKET).list('', { limit: 1000 });
  if (error) throw new Error(`list root: ${error.message}`);
  return (data ?? [])
    .filter((e) => (e as StorageEntry).id === null) // só "pastas"
    .map((e) => e.name)
    .sort(); // determinístico
}

/** Lista recursivamente os arquivos de selfie sob um prefixo. */
async function listFiles(service: SupabaseClient, prefix: string, acc: Array<{ path: string; created: number }>): Promise<void> {
  const { data, error } = await service.storage.from(BUCKET).list(prefix, { limit: 1000 });
  if (error) throw new Error(`list ${prefix || '/'}: ${error.message}`);
  for (const entry of (data ?? []) as StorageEntry[]) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.id === null || entry.metadata == null) await listFiles(service, path, acc);
    else acc.push({ path, created: entry.created_at ? new Date(entry.created_at).getTime() : 0 });
  }
}

/** Anonimiza os ponteiros de evidência SÓ dos caminhos efetivamente deletados. */
async function anonymizePointers(service: SupabaseClient, paths: string[]): Promise<number> {
  if (paths.length === 0) return 0;
  const { data, error } = await service
    .from('authentication_evidence')
    .update({ provider_reference: null, metadata: { selfie_purged: true } })
    .in('provider_reference', paths)
    .select('id');
  if (error) throw new Error(`anonimizar ponteiros: ${error.message}`);
  return (data ?? []).length;
}

/**
 * Expurga selfies vencidas de forma LIMITADA. Processa organizações em ordem
 * determinística a partir de `continuationCursor`; para ao atingir batchSize
 * ou a duração máxima, devolvendo o cursor para o próximo pass. dryRun=true
 * não apaga nem anonimiza. `organizationId` restringe a UMA org (nunca fora).
 */
export async function purgeSelfies(opts: {
  retentionDays?: number;
  dryRun?: boolean;
  organizationId?: string | null;
  batchSize?: number;
  maxDurationMs?: number;
  continuationCursor?: string | null;
} = {}): Promise<PurgeSummary> {
  const service = getServiceClient();
  const startedAt = Date.now();
  const retentionDays = opts.retentionDays && opts.retentionDays > 0 ? opts.retentionDays : retentionDaysDefault();
  const batchSize = opts.batchSize && opts.batchSize > 0 ? opts.batchSize : retentionBatchDefault();
  const maxDurationMs = opts.maxDurationMs && opts.maxDurationMs > 0 ? opts.maxDurationMs : retentionMaxMsDefault();
  const dryRun = opts.dryRun === true;
  const cutoff = Date.now() - retentionDays * 86_400_000;
  const summary: PurgeSummary = {
    dryRun, retentionDays, batchSize, scanned: 0, matched: 0, filesDeleted: 0,
    pointersAnonymized: 0, byOrg: {}, continuationCursor: null, errors: [],
  };

  let orgs: string[];
  try {
    orgs = opts.organizationId ? [opts.organizationId] : await listOrgPrefixes(service);
  } catch (e) {
    summary.errors.push(e instanceof Error ? e.message : String(e));
    return summary;
  }
  // retoma do cursor (ordem determinística)
  if (opts.continuationCursor) orgs = orgs.filter((o) => o >= opts.continuationCursor!);

  for (const org of orgs) {
    if (summary.filesDeleted >= batchSize || Date.now() - startedAt >= maxDurationMs) {
      summary.continuationCursor = org; // retoma aqui no próximo pass
      break;
    }
    let files: Array<{ path: string; created: number }> = [];
    try {
      await listFiles(service, org, files);
    } catch (e) {
      summary.errors.push(e instanceof Error ? e.message : String(e));
      continue; // isola falha por org
    }
    summary.scanned += files.length;
    // vencidos + convenção de caminho válida (defesa: nunca fora do padrão / fora da org)
    const stale = files.filter((f) => f.created > 0 && f.created < cutoff && SELFIE_PATH_RE.test(f.path) && f.path.startsWith(`${org}/`));
    summary.matched += stale.length;
    if (stale.length === 0) continue;
    if (dryRun) {
      summary.byOrg[org] = (summary.byOrg[org] ?? 0) + stale.length;
      continue;
    }

    // remove só até o orçamento do lote; o restante volta no próximo pass
    const budget = Math.max(0, batchSize - summary.filesDeleted);
    const toRemove = stale.slice(0, budget).map((f) => f.path);
    let orgDeleted = 0;
    for (let i = 0; i < toRemove.length; i += REMOVE_CHUNK) {
      if (Date.now() - startedAt >= maxDurationMs) break;
      const chunk = toRemove.slice(i, i + REMOVE_CHUNK);
      const { error } = await service.storage.from(BUCKET).remove(chunk);
      if (error) { summary.errors.push(`remove ${org}[${i}]: ${error.message}`); continue; }
      summary.filesDeleted += chunk.length;
      orgDeleted += chunk.length;
      // anonimiza ponteiros SÓ dos que foram apagados (após deleção)
      try {
        summary.pointersAnonymized += await anonymizePointers(service, chunk);
      } catch (e) {
        summary.errors.push(e instanceof Error ? e.message : String(e));
      }
    }
    if (orgDeleted > 0) summary.byOrg[org] = (summary.byOrg[org] ?? 0) + orgDeleted;
    // se restou mais nesta org do que o orçamento, retoma nesta org
    if (toRemove.length < stale.length) { summary.continuationCursor = org; break; }
  }

  // auditoria por organização afetada (sem dados de selfie), só em execução real
  if (!dryRun) {
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
  }

  return summary;
}
