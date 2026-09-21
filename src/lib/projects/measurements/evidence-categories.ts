/**
 * A CLASSE DOCUMENTAL DA EVIDÊNCIA — vocabulário puro, sem banco e sem JSX.
 *
 * Separado da bancada de evidência (`evidence-workspace.ts`) de propósito: o
 * vitest deste repositório roda em `node`, e provar que esta lista continua
 * idêntica ao CHECK de `project_files.evidence_category` (migration 189) não
 * pode exigir o cliente do Supabase.
 *
 * Classe documental NÃO é estado. Um "Relatório de ensaio" continua sendo
 * evidência não validada até que alguém o valide, e continua não medindo, não
 * aceitando e não faturando. A classe diz O QUE o papel é; os estados vivem
 * cada um na sua autoridade.
 */

export type EvidenceCategory =
  | 'relatorio_medicao'
  | 'relatorio_tecnico'
  | 'relatorio_inspecao'
  | 'relatorio_ensaio'
  | 'databook'
  | 'protocolo'
  | 'aceite'
  | 'relatorio_fotografico'
  | 'desenho'
  | 'procedimento'
  | 'documento_suporte';

export const EVIDENCE_CATEGORY_LABEL: Record<EvidenceCategory, string> = {
  relatorio_medicao: 'Relatório de medição',
  relatorio_tecnico: 'Relatório técnico',
  relatorio_inspecao: 'Relatório de inspeção',
  relatorio_ensaio: 'Relatório de ensaio',
  databook: 'Databook',
  protocolo: 'Protocolo',
  aceite: 'Aceite',
  relatorio_fotografico: 'Relatório fotográfico',
  desenho: 'Desenho',
  procedimento: 'Procedimento',
  documento_suporte: 'Documento de suporte',
};

export const EVIDENCE_CATEGORIES = Object.keys(
  EVIDENCE_CATEGORY_LABEL,
) as readonly EvidenceCategory[];

/** O tipo documental com que a evidência entra no acervo do projeto. */
export const MEASUREMENT_EVIDENCE_DOCUMENT_TYPE = 'measurement_evidence';
