'use client';

/**
 * A BANCADA DE EVIDÊNCIA DO MARCO — um arquivo, um registro, vários contextos.
 *
 * ─── O fluxo, em uma frase ─────────────────────────────────────────────────
 *
 * O PDF sobe UMA vez para `project-documents`, vira UMA linha de
 * `project_files` com o marco contratual ao lado, e — quando a instância de
 * medição já existe — é VINCULADO a ela pela RPC governada. O mesmo
 * `document_id` aparece em Medições & Evidências e em Documentos porque é o
 * mesmo registro, não porque duas telas copiam a mesma coisa.
 *
 * ─── O que anexar evidência NÃO faz ────────────────────────────────────────
 *
 * Não mede, não aceita, não torna elegível e não gera faturamento. Este módulo
 * não chama nenhuma transição de medição — nem `prepare`, nem `mark_ready`,
 * nem `submit`. Quem sobe um relatório de ensaio subiu um relatório de ensaio;
 * o resto continua sendo ato de quem tem autoridade para praticá-lo.
 *
 * ─── Por que o vínculo com a medição é CONDICIONAL ────────────────────────
 *
 * Porque a instância canônica de medição nasce da materialização governada
 * (migration 134), e não do navegador. Enquanto ela não existe, o documento
 * guarda o vínculo de MARCO — que é a identidade compartilhada — e a
 * reconciliação posterior o encontra por lá. Criar a medição daqui para "ter
 * onde pendurar o anexo" seria fabricar registro de medição, que é
 * exatamente o que o pedido proíbe.
 */

import { createClient } from '@/utils/supabase/client';
import { uploadProjectFile } from '@/lib/services/projects';
import { attachDocumentToMeasurement } from './measurement-service';
import {
  MEASUREMENT_EVIDENCE_DOCUMENT_TYPE, type EvidenceCategory,
} from './evidence-categories';
import type { RequirementKind } from './types';

export {
  EVIDENCE_CATEGORIES, EVIDENCE_CATEGORY_LABEL, MEASUREMENT_EVIDENCE_DOCUMENT_TYPE,
  type EvidenceCategory,
} from './evidence-categories';

/**
 * A exigência contratual que cada classe documental atende.
 *
 * Serve ao vínculo de evidência (`requirement_kind`), para que a prontidão da
 * medição saiba que o laudo de ensaio responde à exigência de ensaio. Classe
 * sem correspondência declarada devolve `null` — e `null` é resposta honesta:
 * o documento entra como evidência bruta, sem alegar satisfazer exigência
 * nenhuma.
 */
const REQUIREMENT_BY_CATEGORY: Partial<Record<EvidenceCategory, RequirementKind>> = {
  relatorio_medicao: 'SERVICE_REPORT',
  relatorio_tecnico: 'TECHNICAL_REPORT',
  relatorio_inspecao: 'TESTS_INSPECTION',
  relatorio_ensaio: 'TESTS_INSPECTION',
  relatorio_fotografico: 'PHOTOS',
  aceite: 'CUSTOMER_ACCEPTANCE',
  databook: 'DOCUMENT',
  protocolo: 'DOCUMENT',
};

export class EvidenceWorkspaceError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = 'EvidenceWorkspaceError';
  }
}

export interface UploadEvidenceInput {
  readonly projectId: string;
  readonly file: File;
  readonly category: EvidenceCategory;
  /** A identidade canônica do marco. É ela que liga o documento a tudo mais. */
  readonly milestoneId: string;
  readonly contractId: string | null;
  readonly timelineItemId: string | null;
  /** A instância de medição, quando já materializada. */
  readonly measurementId: string | null;
}

export interface UploadEvidenceResult {
  readonly documentId: string;
  /** O vínculo com a medição canônica foi criado? */
  readonly linkedToMeasurement: boolean;
  /**
   * O vínculo falhou depois de o arquivo já estar salvo.
   *
   * O upload NÃO é revertido: o documento é verdade do acervo e já pertence ao
   * projeto. Desfazê-lo por causa de um vínculo perdido apagaria o trabalho de
   * quem o enviou; dizer o que faltou deixa o conserto com quem pode fazê-lo.
   */
  readonly linkError: string | null;
}

export async function uploadMilestoneEvidence(
  input: UploadEvidenceInput,
): Promise<UploadEvidenceResult> {
  const { documentId } = await uploadProjectFile(input.projectId, input.file, 'document', {
    documentType: MEASUREMENT_EVIDENCE_DOCUMENT_TYPE,
    evidenceCategory: input.category,
    contractId: input.contractId,
    contractMilestoneId: input.milestoneId,
    measurementId: input.measurementId,
    timelineItemId: input.timelineItemId,
  });

  if (!input.measurementId) {
    return { documentId, linkedToMeasurement: false, linkError: null };
  }

  try {
    /*
      A porta da 191, e não a função de 131.

      Classe BRUTA e procedência MANUAL não viajam daqui: são literais do lado
      do banco. Nenhum upload se autovalida — nem quando quem sobe é quem
      validaria.
    */
    await attachDocumentToMeasurement(
      input.measurementId, documentId, REQUIREMENT_BY_CATEGORY[input.category] ?? null);
    return { documentId, linkedToMeasurement: true, linkError: null };
  } catch (e) {
    return {
      documentId,
      linkedToMeasurement: false,
      linkError: e instanceof Error ? e.message : String(e),
    };
  }
}

/**
 * O DOCUMENTO QUE CHEGOU ANTES DA MEDIÇÃO.
 *
 * Evidência anexada ao marco enquanto a instância canônica não existia fica com
 * `measurement_id` nulo. Quando a materialização governada finalmente cria a
 * medição, o documento não se liga sozinho — e não se liga sozinho de
 * propósito: o vínculo de evidência é ato com autor, e um gatilho de banco o
 * criaria sem autor nenhum, escrevendo em `project_measurement_evidence` por
 * fora da RPC que valida inquilino, projeto e proveniência.
 *
 * Então o vínculo continua sendo humano, pelo MESMO caminho governado do
 * upload. O que esta função faz é poupar a pessoa de subir o arquivo de novo —
 * que era a única alternativa que ela tinha.
 */
export async function linkExistingEvidence(
  measurementId: string,
  doc: MilestoneEvidenceDocument,
): Promise<void> {
  await attachDocumentToMeasurement(
    measurementId,
    doc.documentId,
    doc.evidenceCategory ? REQUIREMENT_BY_CATEGORY[doc.evidenceCategory] ?? null : null);

  /*
    O ponteiro do acervo acompanha o vínculo. Ele é conveniência de leitura —
    a verdade do vínculo mora em `project_measurement_evidence`, que a RPC
    acabou de escrever. Falhar aqui não desfaz o vínculo, e por isso o erro
    não sobe: seria um alarme sobre um trabalho que deu certo.
  */
  await createClient()
    .from('project_files')
    .update({ measurement_id: measurementId })
    .eq('id', doc.documentId);
}

// ═══════════════════════════════════════════════════════════════════════════
// LEITURA
// ═══════════════════════════════════════════════════════════════════════════

/** Uma evidência do acervo, na forma em que a tela a mostra. */
export interface MilestoneEvidenceDocument {
  readonly documentId: string;
  readonly fileName: string;
  readonly evidenceCategory: EvidenceCategory | null;
  readonly contentType: string | null;
  readonly fileSize: number | null;
  readonly milestoneId: string | null;
  readonly measurementId: string | null;
  readonly timelineItemId: string | null;
  readonly uploadedBy: string | null;
  readonly uploadedAt: string;
  readonly bucketId: string;
  readonly objectPath: string;
}

function toEvidenceDocument(raw: any): MilestoneEvidenceDocument {
  return {
    documentId: String(raw.id),
    fileName: raw.file_name,
    evidenceCategory: (raw.evidence_category ?? null) as EvidenceCategory | null,
    contentType: raw.content_type ?? null,
    fileSize: raw.file_size ?? null,
    milestoneId: raw.contract_milestone_id ?? null,
    measurementId: raw.measurement_id ?? null,
    timelineItemId: raw.timeline_item_id ?? null,
    uploadedBy: raw.created_by ?? null,
    uploadedAt: raw.created_at,
    bucketId: raw.bucket_id,
    objectPath: raw.object_path,
  };
}

const EVIDENCE_COLUMNS =
  'id, file_name, evidence_category, content_type, file_size, contract_milestone_id, '
  + 'measurement_id, timeline_item_id, created_by, created_at, bucket_id, object_path';

/**
 * As evidências de medição deste projeto, indexadas pelo MARCO.
 *
 * Uma consulta, um instante. Uma consulta por marco produziria N instantes do
 * mesmo acervo numa tela só — o mesmo motivo pelo qual a visão 181 existe.
 */
export async function listProjectEvidenceByMilestone(
  projectId: string,
): Promise<ReadonlyMap<string, readonly MilestoneEvidenceDocument[]>> {
  const { data, error } = await createClient()
    .from('project_files')
    .select(EVIDENCE_COLUMNS)
    .eq('project_id', projectId)
    .not('contract_milestone_id', 'is', null)
    .order('created_at', { ascending: false });

  if (error) throw new EvidenceWorkspaceError(error.message, error);

  const out = new Map<string, MilestoneEvidenceDocument[]>();
  for (const raw of data ?? []) {
    const doc = toEvidenceDocument(raw);
    if (!doc.milestoneId) continue;
    const list = out.get(doc.milestoneId);
    if (list) list.push(doc);
    else out.set(doc.milestoneId, [doc]);
  }
  return out;
}

/** Só as contagens, para as facetas da fila. Deriva do mapa, sem segunda ida. */
export function countByMilestone(
  byMilestone: ReadonlyMap<string, readonly MilestoneEvidenceDocument[]>,
): ReadonlyMap<string, number> {
  return new Map([...byMilestone].map(([id, docs]) => [id, docs.length]));
}

/**
 * URL assinada de leitura, válida por cinco minutos.
 *
 * Assinada e curta porque o bucket é privado desde a 150: uma URL pública aqui
 * contornaria a RLS que a própria migration existe para impor.
 */
export async function signedEvidenceUrl(
  doc: MilestoneEvidenceDocument,
): Promise<string | null> {
  const { data } = await createClient().storage
    .from(doc.bucketId)
    .createSignedUrl(doc.objectPath, 300);
  return data?.signedUrl ?? null;
}
