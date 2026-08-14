/**
 * Vocabulário do módulo de ASO — uma frase, um lugar só.
 *
 * Estes rótulos apareciam escritos à mão em três telas, e já tinham começado a
 * divergir: o mesmo estado era "pendente de revisão" num lugar e "aguardando
 * confirmação" no outro. Para quem opera, dois nomes para o mesmo estado é a
 * dúvida sobre se são dois estados.
 *
 * A escolha de palavra também não é neutra e está fixada aqui de propósito:
 *
 *   "Documento enviado"              — o PDF chegou. Não diz nada sobre valer.
 *   "Aguardando confirmação do RH"   — a pendência é de GENTE, não do papel.
 *   "Confirmado pelo RH"             — alguém assumiu. É o que sustenta o
 *                                      indicador de vencimento.
 *   "Validade declarada no documento" — fato lido do papel.
 *   "Validade inferida pelo sistema"  — premissa nossa, e a frase diz de quem é.
 *   "Sem validade apurável"           — ninguém escreveu a data. Não é infração.
 *   "eSocial não importado"           — estado NORMAL, não pendência.
 */

import type { AsoDocumentStatus, AsoReviewStatus } from './aso-review';
import type { AsoEsocialMatchStatus, AsoValidityBasis } from './aso-extractor';
import type { AsoAlertLevel } from './aso-alerts';

export type LabelTone = 'active' | 'warning' | 'error' | 'neutral';

export interface LabelMeta {
  label: string;
  tone: LabelTone;
  hint: string;
}

/** Situação do DOCUMENTO — a que decide se ele controla vencimento. */
export const ASO_DOCUMENT_STATUS_LABELS: Record<AsoDocumentStatus, LabelMeta> = {
  pending_review: {
    label: 'Aguardando confirmação do RH',
    tone: 'warning',
    hint: 'O documento está enviado e lido. Enquanto ninguém confirmar, ele não sustenta vencimento oficial.',
  },
  approved: {
    label: 'Confirmado pelo RH',
    tone: 'active',
    hint: 'Conferido e assumido por uma pessoa. É este documento que controla o vencimento do colaborador.',
  },
  needs_correction: {
    label: 'Precisa de correção',
    tone: 'warning',
    hint: 'Devolvido para ajuste. Corrija os campos apontados e o documento volta para confirmação.',
  },
  rejected: {
    label: 'Rejeitado',
    tone: 'error',
    hint: 'Recusado na conferência. O colaborador segue sem documento válido no acervo.',
  },
};

/** Estado do arquivo enquanto ele não tem decisão nenhuma. */
export const ASO_UPLOADED_LABEL = 'Documento enviado';

export const ASO_REVIEW_STATUS_LABELS: Record<AsoReviewStatus, string> = {
  pending: ASO_DOCUMENT_STATUS_LABELS.pending_review.label,
  approved: ASO_DOCUMENT_STATUS_LABELS.approved.label,
  correction_requested: ASO_DOCUMENT_STATUS_LABELS.needs_correction.label,
  rejected: ASO_DOCUMENT_STATUS_LABELS.rejected.label,
};

/** Procedência da data de validade. Fato e premissa nunca usam a mesma frase. */
export const ASO_VALIDITY_BASIS_LABELS: Record<AsoValidityBasis, LabelMeta> = {
  declared_document: {
    label: 'Validade declarada no documento',
    tone: 'active',
    hint: 'A data estava escrita no ASO. É fato do papel.',
  },
  inferred_periodicity: {
    label: 'Validade inferida pelo sistema',
    tone: 'warning',
    hint: 'O documento não declarou validade; deduzida pela periodicidade anual da NR-7. É premissa nossa, não fato do papel.',
  },
  undetermined: {
    label: 'Sem validade apurável',
    tone: 'neutral',
    hint: 'Nem o documento declarou, nem o tipo de exame permite deduzir. Não leia como "em dia" — e também não é irregularidade.',
  },
};

/** Conferência com o eSocial. Opcional em todos os estados. */
export const ASO_ESOCIAL_STATUS_LABELS: Record<AsoEsocialMatchStatus, LabelMeta> = {
  not_imported: {
    label: 'eSocial não importado',
    tone: 'neutral',
    hint: 'Não há evento S-2220 com que comparar. Estado normal — a conferência com o eSocial é opcional.',
  },
  matched: {
    label: 'eSocial conferido',
    tone: 'active',
    hint: 'O S-2220 transmitido conta a mesma história do documento.',
  },
  divergent: {
    label: 'eSocial divergente',
    tone: 'warning',
    hint: 'O S-2220 transmitido diverge do documento. É erro de transmissão a corrigir — o papel continua valendo.',
  },
  not_applicable: {
    label: 'eSocial não aplicável',
    tone: 'neutral',
    hint: 'Há evento, mas falta no documento o dado necessário para comparar.',
  },
};

/** Níveis da fila de vencimento. */
export const ASO_ALERT_LEVEL_LABELS: Record<AsoAlertLevel, LabelMeta> = {
  expired: { label: 'Vencido', tone: 'error', hint: 'A validade do documento confirmado já passou.' },
  expiring_30: { label: 'Vence em 30 dias', tone: 'warning', hint: 'Dentro da janela crítica.' },
  expiring_60: { label: 'Vence em 60 dias', tone: 'warning', hint: 'Dentro da janela de aviso.' },
  ok: { label: 'Em dia', tone: 'active', hint: 'Documento confirmado e dentro do prazo.' },
  no_validity: {
    label: 'Sem validade apurável',
    tone: 'neutral',
    hint: 'Documento confirmado, mas o papel não declara validade e o tipo de exame não permite deduzi-la.',
  },
  pending_review: {
    label: 'Aguardando confirmação do RH',
    tone: 'warning',
    hint: 'Há PDF no acervo, ainda sem confirmação. Documento pendente não sustenta vencimento oficial.',
  },
  needs_correction: {
    label: 'Rejeitado / a corrigir',
    tone: 'warning',
    hint: 'O documento enviado não está apto a sustentar o controle.',
  },
  no_document: {
    // Neutro de propósito: é pendência de acervo, não infração.
    label: 'Documento não enviado',
    tone: 'neutral',
    hint: 'Nenhum ASO em PDF para este colaborador. Pendência de acervo, não irregularidade.',
  },
};

export const ASO_RESULT_LABELS: Record<string, string> = { '1': 'Apto', '2': 'Inapto' };
