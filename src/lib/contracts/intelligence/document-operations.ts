/**
 * Documento como EVIDÊNCIA OPERACIONAL, não como arquivo.
 *
 * ─── O que o repositório deixa de ser ──────────────────────────────────────
 *
 * Uma lista plana de nomes de arquivo com um selo de status. Ela responde
 * "quais papéis foram anexados" — e nenhuma das perguntas que fazem alguém
 * abrir esta aba: este documento serve para quê? que exigência ele satisfaz?
 * ele ainda vale? o que falta chegar?
 *
 * ─── O que ele passa a ser ─────────────────────────────────────────────────
 *
 * Categorias operacionais, e dentro delas o VÍNCULO: qual obrigação aquele
 * papel satisfaz, qual exigência de evidência ele cumpre, até quando vale.
 * O vínculo vem de `contract_obligation_evidence`, que já existe desde a Fase
 * 3 e nunca tinha sido lido pela tela.
 *
 * ─── Ausência continua ausência ────────────────────────────────────────────
 *
 * Um documento sem vínculo NÃO é apresentado como "documento avulso, tudo
 * certo": ele é apresentado como um papel cuja finalidade operacional ninguém
 * registrou. E uma exigência sem documento aparece como o que é — o que falta
 * chegar — em vez de sumir da lista por não ter arquivo.
 */

export type DocumentCategory =
  | 'original_contract'
  | 'amendment'
  | 'guarantee'
  | 'insurance'
  | 'certificate'
  | 'measurement_report'
  | 'acceptance_evidence'
  | 'communication'
  | 'other';

export const DOCUMENT_CATEGORY_LABEL: Record<DocumentCategory, string> = {
  original_contract: 'Contrato original',
  amendment: 'Aditivos',
  guarantee: 'Garantias',
  insurance: 'Seguros',
  certificate: 'Certidões',
  measurement_report: 'Relatórios de medição',
  acceptance_evidence: 'Evidências de aceite',
  communication: 'Comunicações',
  other: 'Outras evidências contratuais',
};

/**
 * Ordem de leitura. O contrato original vem primeiro sempre — ele é a verdade
 * documental de que todo o resto deriva.
 */
export const DOCUMENT_CATEGORY_ORDER: readonly DocumentCategory[] = [
  'original_contract', 'amendment', 'guarantee', 'insurance', 'certificate',
  'measurement_report', 'acceptance_evidence', 'communication', 'other',
];

/** Mapeia o `document_type` persistido para a categoria operacional. */
const TYPE_TO_CATEGORY: Record<string, DocumentCategory> = {
  contract: 'original_contract',
  amendment: 'amendment',
  guarantee: 'guarantee',
  insurance: 'insurance',
  certificate: 'certificate',
  approval: 'acceptance_evidence',
  minutes: 'communication',
  invoice: 'other',
  purchase_order: 'other',
  annex: 'other',
};

export function documentCategory(documentType: string): DocumentCategory {
  return TYPE_TO_CATEGORY[documentType] ?? 'other';
}

/** O vínculo de um documento com o que ele satisfaz. */
export interface DocumentLink {
  readonly obligationTitle: string | null;
  readonly requirementLabel: string | null;
  readonly occurrenceKey: string | null;
  /** `TRUE` = evidência aceita; `UNKNOWN` = entregue e sem aceite registrado. */
  readonly acceptanceState: 'accepted' | 'pending' | 'rejected' | 'unknown';
}

export interface OperationalDocumentInput {
  id: string;
  title: string;
  documentType: string;
  status: string;
  version: number;
  supersededBy: string | null;
  links: readonly DocumentLink[];
}

export interface OperationalDocument {
  readonly id: string;
  readonly title: string;
  readonly category: DocumentCategory;
  readonly status: string;
  readonly version: number;
  readonly superseded: boolean;
  readonly links: readonly DocumentLink[];
  /** O que este papel FAZ, em uma frase. */
  readonly purpose: string;
}

/**
 * Uma exigência de evidência que ainda não tem documento.
 *
 * Ela pertence ao repositório tanto quanto os papéis que chegaram: um
 * repositório que só mostra o que existe esconde exatamente o que falta.
 */
export interface MissingEvidence {
  readonly obligationTitle: string;
  readonly requirementLabel: string;
  readonly occurrenceKey: string | null;
  readonly dueDate: string | null;
  /** Aguardando a agenda de Projetos, e não uma pendência de quem lê. */
  readonly awaitingSchedule: boolean;
}

export interface DocumentOperations {
  readonly groups: readonly { category: DocumentCategory; documents: readonly OperationalDocument[] }[];
  readonly missing: readonly MissingEvidence[];
  readonly total: number;
  readonly linkedCount: number;
  readonly unlinkedCount: number;
}

function purposeOf(doc: OperationalDocumentInput, category: DocumentCategory): string {
  if (category === 'original_contract') {
    return 'Verdade documental do contrato. Toda interpretação do Apex se confere contra este papel.';
  }
  if (doc.links.length === 0) {
    return 'Finalidade operacional não registrada — este papel não está vinculado a nenhuma exigência.';
  }
  const accepted = doc.links.filter((l) => l.acceptanceState === 'accepted').length;
  const first = doc.links[0];
  const subject = first.requirementLabel ?? first.obligationTitle ?? 'uma exigência contratual';
  if (doc.links.length === 1) {
    return accepted === 1
      ? `Satisfaz "${subject}" — evidência aceita.`
      : `Entregue para "${subject}" — aceite ainda não registrado.`;
  }
  return `Vinculado a ${doc.links.length} exigências · ${accepted} com aceite registrado.`;
}

export function buildDocumentOperations(
  documents: readonly OperationalDocumentInput[],
  missing: readonly MissingEvidence[],
): DocumentOperations {
  const operational = documents.map((doc): OperationalDocument => {
    const category = documentCategory(doc.documentType);
    return {
      id: doc.id,
      title: doc.title,
      category,
      status: doc.status,
      version: doc.version,
      superseded: doc.supersededBy !== null,
      links: doc.links,
      purpose: purposeOf(doc, category),
    };
  });

  const groups = DOCUMENT_CATEGORY_ORDER
    .map((category) => ({
      category,
      documents: operational.filter((d) => d.category === category),
    }))
    // Categoria vazia não vira cabeçalho: um repositório cheio de seções
    // "nenhum documento" ensina a rolar sem ler.
    .filter((group) => group.documents.length > 0);

  const linkedCount = operational.filter((d) => d.links.length > 0).length;

  return {
    groups,
    missing,
    total: operational.length,
    linkedCount,
    unlinkedCount: operational.length - linkedCount,
  };
}
