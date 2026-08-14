/**
 * Resumo de conferência de um ASO — o que o RH lê antes de confirmar.
 *
 * Adaptador entre a linha do banco (`AsoDocumentRow`) e as camadas puras de
 * revisão. Existe como módulo próprio porque TRÊS caminhos precisam da mesma
 * resposta e não podem divergir: o retorno do upload, a listagem do acervo e a
 * aprovação em lote. Quando o resumo era montado dentro de cada rota, a tela
 * mostrava um conjunto de ressalvas e o servidor decidia por outro.
 *
 * Nada aqui faz I/O: recebe a linha e os irmãos já lidos, e devolve estrutura.
 */

import type { AsoDocumentRow } from './aso-store';
import {
  assessApprovalReadiness,
  mergeAsoFields,
  type AsoApprovalReadiness,
  type AsoApprovalSibling,
  type AsoFields,
} from './aso-review';

export interface AsoReviewSummary {
  documentId: string;
  fileName: string;

  /** Vínculo com o cadastro. `personId` nulo = documento sem dono. */
  personId: string | null;
  workerName: string | null;
  workerRegistration: string | null;

  examKind: string | null;
  examDate: string | null;
  validityDate: string | null;
  validityBasis: AsoDocumentRow['validity_basis'];
  result: string | null;

  doctorName: string | null;
  doctorCrm: string | null;
  clinicName: string | null;
  companyName: string | null;
  occupationalRisks: string[];

  extractionMethod: AsoDocumentRow['extraction_method'];
  extractionConfidence: number | null;
  /** Ressalvas do extrator: campos não lidos, com o motivo. */
  extractionIssues: { field: string; reason: string }[];

  esocialMatchStatus: AsoDocumentRow['esocial_match_status'];
  divergenceSummary: string | null;

  reviewStatus: AsoDocumentRow['review_status'];
  documentStatus: AsoDocumentRow['document_status'];

  readiness: AsoApprovalReadiness;
}

/** Campos vigentes: o que a máquina leu, sobreposto pelo que uma pessoa corrigiu. */
export function effectiveFields(row: AsoDocumentRow): AsoFields {
  return mergeAsoFields(row.extracted_fields_json ?? {}, row.reviewed_fields_json ?? {});
}

/**
 * Monta o resumo e avalia se o documento pode ser confirmado.
 *
 * As colunas planas são a fonte dos valores exibidos — elas já são a
 * sobreposição das duas camadas, e é sobre elas que os índices e os
 * indicadores trabalham. Os JSONs entram só para o portão saber a PROCEDÊNCIA
 * de cada campo.
 */
export function buildAsoReviewSummary(
  row: AsoDocumentRow,
  siblings: AsoApprovalSibling[] = [],
  today: Date = new Date(),
): AsoReviewSummary {
  const fields: AsoFields = {
    ...effectiveFields(row),
    // As colunas planas vencem: são o valor que o resto do sistema enxerga.
    workerName: row.worker_name_raw,
    workerRegistration: row.worker_registration,
    companyName: row.company_name,
    companyCnpj: row.company_cnpj,
    clinicName: row.clinic_name,
    examDate: row.exam_date,
    examKind: (row.exam_kind as AsoFields['examKind']) ?? null,
    result: (row.exam_result as AsoFields['result']) ?? null,
    validityDate: row.validity_date,
    validityBasis: row.validity_basis,
    doctorName: row.doctor_name,
    doctorCrm: row.doctor_crm,
    occupationalRisks: row.occupational_risks ?? null,
  };

  const readiness = assessApprovalReadiness({
    fields,
    personId: row.person_id,
    extractionConfidence: row.extraction_confidence,
    extractionMethod: row.extraction_method,
    siblings,
    documentId: row.id,
    today,
  });

  return {
    documentId: row.id,
    fileName: row.file_name,
    personId: row.person_id,
    workerName: row.worker_name_raw,
    workerRegistration: row.worker_registration,
    examKind: row.exam_kind,
    examDate: row.exam_date,
    validityDate: row.validity_date,
    validityBasis: row.validity_basis,
    result: row.exam_result,
    doctorName: row.doctor_name,
    doctorCrm: row.doctor_crm,
    clinicName: row.clinic_name,
    companyName: row.company_name,
    occupationalRisks: row.occupational_risks ?? [],
    extractionMethod: row.extraction_method,
    extractionConfidence: row.extraction_confidence,
    extractionIssues: row.extraction_issues ?? [],
    esocialMatchStatus: row.esocial_match_status,
    divergenceSummary: row.divergence_summary,
    reviewStatus: row.review_status,
    documentStatus: row.document_status,
    readiness,
  };
}

/**
 * Agrupa os irmãos de cada documento — outros ASOs do mesmo colaborador.
 *
 * Só entram documentos com pessoa vinculada: sem vínculo não há "mesmo
 * colaborador" a afirmar, e cruzar por nome bruto acusaria conflito entre
 * homônimos.
 */
export function siblingsByPerson(rows: AsoDocumentRow[]): Map<string, AsoApprovalSibling[]> {
  const map = new Map<string, AsoApprovalSibling[]>();
  for (const row of rows) {
    if (!row.person_id) continue;
    const list = map.get(row.person_id) ?? [];
    list.push({ id: row.id, examDate: row.exam_date, documentStatus: row.document_status });
    map.set(row.person_id, list);
  }
  return map;
}

/** Irmãos de um documento específico, prontos para o portão. */
export function siblingsFor(
  row: AsoDocumentRow,
  index: Map<string, AsoApprovalSibling[]>,
): AsoApprovalSibling[] {
  if (!row.person_id) return [];
  return (index.get(row.person_id) ?? []).filter((s) => s.id !== row.id);
}
