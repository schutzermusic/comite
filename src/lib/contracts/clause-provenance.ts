/**
 * De onde veio uma cláusula estruturada.
 *
 * A Inteligência Contratual dizia "Registro manual estruturado" sobre TODA
 * cláusula — inclusive as que o Apex leu do documento assinado. Isso não é um
 * rótulo impreciso: é uma afirmação factualmente falsa sobre autoria, no
 * lugar do produto onde a procedência é justamente o que dá (ou tira) crédito
 * ao que está escrito.
 *
 * A decisão sai de METADADO, nunca de suposição. Uma cláusula que uma pessoa
 * cadastrou continua sendo manual, e nada aqui a relabela.
 *
 * Vocabulário de produto: o nome do leitor é **Apex**. Modelo, provedor e SDK
 * são detalhe de implementação e não aparecem em tela.
 *
 * Lógica pura, sem JSX — o vitest deste repositório roda em `node`.
 */

export type ClauseProvenance = 'apex' | 'manual';

/** Campos de proveniência que a decisão observa. Todos nulos = registro manual. */
export type ClauseProvenanceInput = {
  readonly ai_flagged?: boolean | null;
  readonly ai_analysis_id?: string | null;
  readonly ai_proposed_at?: string | null;
  readonly ai_model?: string | null;
  readonly ai_confidence?: number | string | null;
  readonly interpretation_state?: string | null;
};

/**
 * A cláusula foi estruturada pelo Apex a partir do documento?
 *
 * Basta UM sinal de leitura automática. A migration 093 gravou a linhagem da
 * proposta (`ai_analysis_id`, `ai_proposed_at`, `ai_model`) e a 154 gravou o
 * estado de interpretação; acervo anterior a elas só tem `ai_flagged`. Exigir
 * todos classificaria como manual exatamente as cláusulas mais antigas lidas
 * por máquina.
 */
export function isApexStructuredClause(clause: ClauseProvenanceInput): boolean {
  return Boolean(
    clause.ai_flagged
    || clause.ai_analysis_id
    || clause.ai_proposed_at
    || clause.ai_model
    || clause.interpretation_state,
  );
}

export function clauseProvenance(clause: ClauseProvenanceInput): ClauseProvenance {
  return isApexStructuredClause(clause) ? 'apex' : 'manual';
}

export const CLAUSE_PROVENANCE_LABEL: Readonly<Record<ClauseProvenance, string>> = {
  apex: 'Estruturado pelo Apex · origem documental',
  manual: 'Registro manual estruturado',
};

/** Rótulo curto, para a linha da cláusula. */
export function clauseProvenanceLabel(clause: ClauseProvenanceInput): string {
  return CLAUSE_PROVENANCE_LABEL[clauseProvenance(clause)];
}

/**
 * Subtítulo do painel, honesto sobre a MISTURA.
 *
 * Uma lista com as duas origens não pode escolher uma só — e o painel também
 * não pode calar sobre a diferença, que é o defeito que este módulo corrige.
 */
export function clauseListProvenanceSubtitle(clauses: readonly ClauseProvenanceInput[]): string {
  const apex = clauses.filter(isApexStructuredClause).length;
  const manual = clauses.length - apex;
  if (apex > 0 && manual > 0) {
    return 'Interpretação estruturada pelo Apex e registro manual — com origem documental e estado de revisão';
  }
  if (apex > 0) {
    return 'Interpretação estruturada pelo Apex a partir do documento — com origem documental e estado de revisão';
  }
  return 'Registro manual estruturado — com origem documental e estado de revisão';
}
