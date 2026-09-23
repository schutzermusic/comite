/**
 * PROPOSTA A PARTIR DO PDF — a área de preparo antes de a proposta existir.
 *
 * "Nova proposta" começa pelo documento: a pessoa solta a PT/PC, a Apex lê,
 * a pessoa revisa, e só então a proposta nasce. Até a confirmação nada é
 * gravado no domínio — nem proposta, nem documento, nem fato.
 *
 * O PDF espera numa pasta de preparo que é da PESSOA (`_staging/<user>/`), e
 * a leitura fica ao lado dele num arquivo que só o servidor escreve
 * (`<pdf>.apex.json`). Quando a proposta é criada, o registro canônico do
 * documento (215) ADOTA o arquivo: move-o para a pasta da proposta e usa a
 * leitura guardada em vez de pagar o provedor duas vezes. O cliente nunca
 * envia fatos — só o caminho que o servidor gerou.
 */
if (typeof window !== 'undefined') {
  throw new Error('proposal-staging.ts não pode ser importado no navegador');
}

import { platformServiceClient } from '@/lib/platform/server-client';
import { ONBOARDING_STORAGE_BUCKET } from '@/lib/contracts/onboarding/upload-paths';
import { extractionModeForProposal, type ExtractionMode } from './document-intelligence';
import { expiredStagedPaths, type StagedObject } from './staging-sweep';

export const stagingPrefix = (organizationId: string, userId: string) =>
  `${organizationId}/proposals/_staging/${userId}/`;

export const sidecarPath = (pdfPath: string) => `${pdfPath}.apex.json`;

export interface StagedAnalysis {
  version: 1;
  /** O modo da leitura (inclui a combinada PT+PC). O registro só reusa se casar. */
  context: ExtractionMode;
  fileName: string;
  analyzedAt: string;
  output: unknown;
  provenance: { provider: string; model: string };
}

export async function writeStagedAnalysis(pdfPath: string, analysis: StagedAnalysis): Promise<void> {
  const body = new Blob([JSON.stringify(analysis)], { type: 'application/json' });
  const { error } = await platformServiceClient().storage.from(ONBOARDING_STORAGE_BUCKET)
    .upload(sidecarPath(pdfPath), body, { upsert: true, contentType: 'application/json' });
  if (error) throw new Error('Não foi possível guardar a leitura do PDF.');
}

export async function readStagedAnalysis(pdfPath: string): Promise<StagedAnalysis | null> {
  const { data, error } = await platformServiceClient().storage.from(ONBOARDING_STORAGE_BUCKET)
    .download(sidecarPath(pdfPath));
  if (error || !data) return null;
  try {
    const parsed = JSON.parse(await data.text()) as StagedAnalysis;
    return parsed?.version === 1 && parsed.output ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Move o PDF preparado para a pasta da proposta. A leitura guardada é
 * devolvida e apagada: ela serve a UMA adoção.
 */
export async function adoptStagedPdf(stagedPath: string, targetPath: string): Promise<StagedAnalysis | null> {
  const storage = platformServiceClient().storage.from(ONBOARDING_STORAGE_BUCKET);
  const analysis = await readStagedAnalysis(stagedPath);
  const { error } = await storage.move(stagedPath, targetPath);
  if (error) throw new Error('O PDF preparado não está mais disponível. Envie o arquivo de novo.');
  await storage.remove([sidecarPath(stagedPath)]);
  return analysis;
}

export async function discardStaged(paths: string[]): Promise<void> {
  if (!paths.length) return;
  await platformServiceClient().storage.from(ONBOARDING_STORAGE_BUCKET)
    .remove(paths.flatMap((p) => [p, sidecarPath(p)]));
}

export const contextForKind = (kind: 'TECHNICAL' | 'COMMERCIAL' | 'COMBINED'): ExtractionMode =>
  extractionModeForProposal(kind);

/**
 * Varre a área de preparo e apaga o que expirou (`staging-sweep.ts` decide).
 * Com `userId`, só a pasta daquela pessoa (varredura oportunista a cada novo
 * envio); sem, todas as pessoas da organização (agendador). Nunca apaga um
 * caminho que `contract_documents` referencia.
 */
export async function sweepExpiredStaging(input: {
  organizationId: string; userId?: string; now?: Date; ttlMs?: number; dryRun?: boolean;
}): Promise<{ scanned: number; removed: string[] }> {
  const storage = platformServiceClient().storage.from(ONBOARDING_STORAGE_BUCKET);
  const base = `${input.organizationId}/proposals/_staging`;
  const folders = input.userId
    ? [input.userId]
    : ((await storage.list(base, { limit: 1000 })).data ?? []).filter((f) => !f.id).map((f) => f.name);

  const objects: StagedObject[] = [];
  for (const folder of folders) {
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await storage.list(`${base}/${folder}`, { limit: 1000, offset });
      if (error || !data?.length) break;
      for (const file of data) {
        if (!file.id) continue;
        objects.push({ path: `${base}/${folder}/${file.name}`, createdAt: file.created_at ?? null });
      }
      if (data.length < 1000) break;
    }
  }
  if (!objects.length) return { scanned: 0, removed: [] };

  const candidates = expiredStagedPaths(objects, { now: input.now ?? new Date(), ttlMs: input.ttlMs });
  if (!candidates.length) return { scanned: objects.length, removed: [] };

  // Defesa: o que o acervo canônico referencia não se apaga, nem que esteja aqui.
  const pdfs = candidates.filter((p) => !p.endsWith('.apex.json'));
  const { data: referenced, error } = await platformServiceClient().from('contract_documents')
    .select('file_path').eq('organization_id', input.organizationId).in('file_path', pdfs.length ? pdfs : ['-']);
  if (error) throw new Error('Não foi possível conferir o acervo antes de limpar o preparo.');
  const removable = expiredStagedPaths(objects, {
    now: input.now ?? new Date(), ttlMs: input.ttlMs,
    protectedPaths: (referenced ?? []).map((r) => r.file_path as string),
  });
  if (!input.dryRun && removable.length) {
    for (let i = 0; i < removable.length; i += 100) {
      await storage.remove(removable.slice(i, i + 100));
    }
  }
  return { scanned: objects.length, removed: removable };
}
