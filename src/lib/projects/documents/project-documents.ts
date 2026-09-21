/**
 * O ACERVO DOCUMENTAL DO PROJETO — a borda tipada de
 * `project_document_read_model` (migration 189).
 *
 * ─── A regra que este módulo protege ───────────────────────────────────────
 *
 * UM documento, UM `document_id`, UMA procedência. Evidência de medição não é
 * uma cópia do documento de projeto: é a MESMA linha, classificada pelo
 * vínculo que ela carrega. Documento contratual não é copiado para cá em
 * nenhuma hipótese — ele entra como REFERÊNCIA, sem caminho de objeto, e o
 * download continua sendo do módulo Contratos.
 *
 * O tipo e a classificação são puros — sem banco e sem JSX — para que o teste
 * possa provar a categorização com linhas de mentira, que é a única forma de
 * provar que um documento contratual nunca vira arquivo de projeto.
 */

import {
  EVIDENCE_CATEGORY_LABEL, type EvidenceCategory,
} from '@/lib/projects/measurements/evidence-categories';

/**
 * De onde o documento vem. Três procedências, três donos.
 *
 * `CONTRACT` é o único que NÃO pertence a Projetos: o módulo Contratos é dono
 * do instrumento, dos aditivos, das garantias e dos anexos, e esta aba só os
 * mostra para que ninguém precise procurá-los em outra tela.
 */
export type DocumentOrigin = 'PROJECT' | 'MEASUREMENT_EVIDENCE' | 'CONTRACT';

export const ORIGIN_LABEL: Record<DocumentOrigin, string> = {
  PROJECT: 'Origem: Projeto',
  MEASUREMENT_EVIDENCE: 'Origem: Evidência de medição',
  CONTRACT: 'Origem: Contrato',
};

export const ORIGIN_SHORT: Record<DocumentOrigin, string> = {
  PROJECT: 'Projeto',
  MEASUREMENT_EVIDENCE: 'Evidência de medição',
  CONTRACT: 'Contrato',
};

/**
 * As gavetas do acervo.
 *
 * Categoria é ARRUMAÇÃO, e não estado: um relatório de ensaio na gaveta
 * "Ensaios" continua sendo evidência não validada até que alguém a valide. As
 * duas coisas vivem em campos diferentes de propósito.
 */
export type DocumentShelf =
  | 'MEASUREMENT_EVIDENCE'
  | 'TECHNICAL_REPORTS'
  | 'TESTS'
  | 'DRAWINGS'
  | 'DATABOOK'
  | 'FIELD_PHOTOS'
  | 'PROCEDURES'
  | 'EXECUTION'
  | 'SCHEDULE'
  | 'CONTRACTUAL';

export const SHELF_LABEL: Record<DocumentShelf, string> = {
  MEASUREMENT_EVIDENCE: 'Evidências de medição',
  TECHNICAL_REPORTS: 'Relatórios técnicos',
  TESTS: 'Ensaios',
  DRAWINGS: 'Desenhos',
  DATABOOK: 'Databook',
  FIELD_PHOTOS: 'Fotos / evidências de campo',
  PROCEDURES: 'Procedimentos',
  EXECUTION: 'Documentação de execução',
  SCHEDULE: 'Cronograma',
  CONTRACTUAL: 'Documentos contratuais (referência)',
};

/** Ordem das gavetas: o que a operação produz primeiro; referência por último. */
export const SHELF_ORDER: readonly DocumentShelf[] = [
  'MEASUREMENT_EVIDENCE',
  'TECHNICAL_REPORTS',
  'TESTS',
  'FIELD_PHOTOS',
  'DATABOOK',
  'DRAWINGS',
  'PROCEDURES',
  'SCHEDULE',
  'EXECUTION',
  'CONTRACTUAL',
];

export interface ProjectDocument {
  readonly documentId: string;
  readonly organizationId: string;
  readonly projectId: string;
  readonly origin: DocumentOrigin;
  readonly title: string;
  readonly documentType: string | null;
  readonly evidenceCategory: EvidenceCategory | null;
  readonly category: string | null;

  /** `null` em documento contratual: a referência não carrega caminho. */
  readonly bucketId: string | null;
  readonly objectPath: string | null;
  readonly publicUrl: string | null;
  readonly contentType: string | null;
  readonly fileSize: number | null;

  readonly contractId: string | null;
  readonly contractMilestoneId: string | null;
  readonly measurementId: string | null;
  readonly timelineItemId: string | null;

  readonly uploadedBy: string | null;
  readonly uploadedAt: string;
  readonly contractDocumentStatus: string | null;
}

export function toProjectDocument(raw: any): ProjectDocument {
  return {
    documentId: String(raw.document_id),
    organizationId: raw.organization_id,
    projectId: String(raw.project_id),
    origin: raw.origin as DocumentOrigin,
    title: raw.title,
    documentType: raw.document_type ?? null,
    evidenceCategory: (raw.evidence_category ?? null) as EvidenceCategory | null,
    category: raw.category ?? null,
    bucketId: raw.bucket_id ?? null,
    objectPath: raw.object_path ?? null,
    publicUrl: raw.public_url ?? null,
    contentType: raw.content_type ?? null,
    fileSize: raw.file_size === null || raw.file_size === undefined ? null : Number(raw.file_size),
    contractId: raw.contract_id ?? null,
    contractMilestoneId: raw.contract_milestone_id ?? null,
    measurementId: raw.measurement_id ?? null,
    timelineItemId: raw.timeline_item_id ?? null,
    uploadedBy: raw.uploaded_by ?? null,
    uploadedAt: raw.uploaded_at,
    contractDocumentStatus: raw.contract_document_status ?? null,
  };
}

/**
 * A gaveta de um documento.
 *
 * A procedência manda primeiro: documento contratual vai para a prateleira de
 * referência mesmo quando o tipo dele se pareceria com um relatório técnico.
 * Confundir os dois é como um aditivo apareceria entre as evidências da obra.
 */
export function shelfOf(doc: ProjectDocument): DocumentShelf {
  if (doc.origin === 'CONTRACT') return 'CONTRACTUAL';
  if (doc.category === 'cronograma') return 'SCHEDULE';

  switch (doc.evidenceCategory) {
    case 'relatorio_tecnico': return 'TECHNICAL_REPORTS';
    case 'relatorio_inspecao':
    case 'relatorio_ensaio': return 'TESTS';
    case 'relatorio_fotografico': return 'FIELD_PHOTOS';
    case 'databook': return 'DATABOOK';
    case 'desenho': return 'DRAWINGS';
    case 'procedimento': return 'PROCEDURES';
    case 'relatorio_medicao':
    case 'protocolo':
    case 'aceite': return 'MEASUREMENT_EVIDENCE';
    default: break;
  }

  if (doc.origin === 'MEASUREMENT_EVIDENCE') return 'MEASUREMENT_EVIDENCE';
  return 'EXECUTION';
}

/** O rótulo humano do tipo, sem inventar quando não há classificação. */
export function typeLabel(doc: ProjectDocument): string {
  if (doc.evidenceCategory) return EVIDENCE_CATEGORY_LABEL[doc.evidenceCategory];
  if (doc.origin === 'CONTRACT') return doc.documentType ?? 'Documento contratual';
  if (doc.category === 'cronograma') return 'Cronograma';
  return doc.documentType ?? 'Documento';
}

export interface DocumentShelfGroup {
  readonly shelf: DocumentShelf;
  readonly documents: readonly ProjectDocument[];
}

export function groupByShelf(
  docs: readonly ProjectDocument[],
): readonly DocumentShelfGroup[] {
  return SHELF_ORDER
    .map((shelf) => ({ shelf, documents: docs.filter((d) => shelfOf(d) === shelf) }))
    .filter((g) => g.documents.length > 0);
}
