/**
 * A máquina de estados do acompanhamento, e a regra que impede o spam.
 *
 * ─── Acompanhar não é importunar ───────────────────────────────────────────
 *
 * A pessoa responsável responde: "O cliente está analisando o aditivo.
 * Resposta esperada em 15/09."
 *
 * Isso não é um comentário — é um ESTADO. O acompanhamento passa a
 * `WAITING_EXTERNAL_PARTY` com `next_expected_event_at = 15/09`, e a partir
 * daí o Apex se cala. Cobrar todo dia alguém que já explicou onde a bola está
 * é a forma mais rápida de o produto inteiro virar ruído — e de o usuário
 * aprender a ignorar exatamente o aviso que importava.
 *
 * Em 15/09 o Apex volta: verifica se o evento esperado ocorreu, pede
 * atualização só se ainda não houve desfecho, e escala conforme a política.
 *
 * Espelha `apex_followup_due_nudges()` e `apex_followup_valid_transition()`
 * (migration 156), que são a autoridade.
 */

import type { ApexFollowupRow, FollowupState } from './types';

const TERMINAL: readonly FollowupState[] = ['COMPLETED', 'CANCELLED'];

/** Terminal é terminal: reabrir apagaria a razão do fechamento. */
export function isValidTransition(from: FollowupState, to: FollowupState): boolean {
  if (from === to) return true;
  if (TERMINAL.includes(from)) return false;
  return (
    ['ACTIVE', 'WAITING_EXTERNAL_PARTY', 'BLOCKED', 'ESCALATED', 'COMPLETED', 'CANCELLED'] as FollowupState[]
  ).includes(to);
}

export type NudgeReason = 'expected_event_reached' | 'overdue' | 'cadence';

export const NUDGE_REASON_LABEL: Record<NudgeReason, string> = {
  expected_event_reached: 'A data esperada chegou',
  overdue: 'Prazo vencido',
  cadence: 'Cadência de acompanhamento',
};

function civilDays(from: string, to: string): number {
  const a = Date.parse(`${from.slice(0, 10)}T00:00:00Z`);
  const b = Date.parse(`${to.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.round((b - a) / 86_400_000);
}

export interface NudgeDecision {
  shouldNudge: boolean;
  reason: NudgeReason | null;
  /** Por que o Apex está calado, quando está. Vai para a tela. */
  silenceReason: string | null;
}

/**
 * O Apex deve falar com alguém sobre este acompanhamento hoje?
 *
 * `asOf` é sempre explícito: uma decisão que depende de "hoje" implícito não é
 * testável, e esta precisa ser.
 */
export function nudgeDecision(followup: ApexFollowupRow, asOf: string): NudgeDecision {
  const quiet = (silenceReason: string): NudgeDecision => ({ shouldNudge: false, reason: null, silenceReason });

  if (TERMINAL.includes(followup.state)) return quiet('Acompanhamento encerrado.');

  // A bola está com o outro lado e a data esperada não chegou.
  if (followup.state === 'WAITING_EXTERNAL_PARTY') {
    if (!followup.next_expected_event_at) {
      // O CHECK do banco impede esta linha existir; a UI não deve quebrar se ela existir.
      return quiet('Aguardando a contraparte, sem data esperada registrada.');
    }
    if (civilDays(asOf, followup.next_expected_event_at) > 0) {
      return quiet(
        `Aguardando a contraparte. O Apex volta a cobrar em ${followup.next_expected_event_at}.`,
      );
    }
    return { shouldNudge: true, reason: 'expected_event_reached', silenceReason: null };
  }

  // Cadência já cumprida: cobrado há pouco, não se cobra de novo.
  if (followup.last_nudge_at && followup.cadence_days !== null) {
    if (civilDays(followup.last_nudge_at, asOf) < followup.cadence_days) {
      return quiet('Cobrança recente; a próxima respeita a cadência combinada.');
    }
  }

  const overdue = followup.due_date !== null && civilDays(followup.due_date, asOf) > 0;
  if (overdue) return { shouldNudge: true, reason: 'overdue', silenceReason: null };

  const dueToday = followup.due_date !== null && civilDays(followup.due_date, asOf) >= 0;
  if (followup.cadence_days !== null) {
    return { shouldNudge: true, reason: 'cadence', silenceReason: null };
  }
  if (dueToday) return { shouldNudge: true, reason: 'overdue', silenceReason: null };

  return quiet('Nada vencido e nenhuma cadência definida — não há o que cobrar.');
}

/** Escalonamento por política, nunca por impaciência. */
export function shouldEscalate(followup: ApexFollowupRow, asOf: string): boolean {
  if (TERMINAL.includes(followup.state)) return false;
  if (followup.escalated_at) return false;
  if (followup.escalate_after_days === null || followup.due_date === null) return false;
  return civilDays(followup.due_date, asOf) >= followup.escalate_after_days;
}

/**
 * O que o Apex está esperando, em uma frase.
 *
 * É esta linha — e não um contador de tarefas — que responde "o Apex está
 * fazendo alguma coisa a respeito disso?".
 */
export function followupNarrative(followup: ApexFollowupRow, asOf: string): string {
  switch (followup.state) {
    case 'COMPLETED':
      return followup.closure_basis === 'verified_evidence'
        ? 'Evidência verificada pelo Apex; a exigência foi satisfeita.'
        : 'Concluído com confirmação humana.';
    case 'CANCELLED':
      return 'Acompanhamento cancelado.';
    case 'ESCALATED':
      return 'Escalado: o prazo estourou a política de acompanhamento.';
    case 'BLOCKED':
      return followup.state_note?.trim() || 'Bloqueado por dependência externa.';
    case 'WAITING_EXTERNAL_PARTY': {
      const event = followup.next_expected_event?.trim() || 'resposta da contraparte';
      return followup.next_expected_event_at
        ? `Aguardando ${event}. Retomada prevista para ${followup.next_expected_event_at}.`
        : `Aguardando ${event}.`;
    }
    case 'ACTIVE':
    default: {
      const decision = nudgeDecision(followup, asOf);
      if (decision.shouldNudge && decision.reason === 'overdue') {
        return 'Prazo vencido — o Apex está cobrando o responsável.';
      }
      return followup.due_date
        ? `Em acompanhamento. Prazo em ${followup.due_date}.`
        : 'Em acompanhamento.';
    }
  }
}

/**
 * Verificação determinística de evidência.
 *
 * Só existe para o escopo limitado que o refactor autorizou: conferir que um
 * documento recebido é da empresa certa e cobre a data exigida. Fora disso a
 * regra devolve `null` e a política manda pedir confirmação humana — que é o
 * oposto de deixar o Apex "achar" que verificou.
 */
export interface EvidenceCandidate {
  /** CNPJ lido no documento, só dígitos. */
  documentTaxId: string | null;
  /** Validade do documento em `YYYY-MM-DD`. */
  validUntil: string | null;
}

export interface EvidenceRequirement {
  /** CNPJ que o documento precisa comprovar, só dígitos. */
  expectedTaxId: string | null;
  /** Data que a validade precisa cobrir. */
  mustCoverDate: string | null;
}

export type VerificationOutcome =
  | { verified: true; basis: string }
  | { verified: false; reason: string }
  | { verified: null; reason: string };

export function verifyEvidence(
  requirement: EvidenceRequirement,
  candidate: EvidenceCandidate,
): VerificationOutcome {
  // Sem regra conferível não há verificação determinística — e "não dá para
  // conferir" nunca vira "conferido".
  if (requirement.expectedTaxId === null && requirement.mustCoverDate === null) {
    return { verified: null, reason: 'Nenhuma regra determinística de verificação foi definida.' };
  }

  if (requirement.expectedTaxId !== null) {
    if (candidate.documentTaxId === null) {
      return { verified: null, reason: 'O documento não expõe o CNPJ para conferência.' };
    }
    if (candidate.documentTaxId !== requirement.expectedTaxId) {
      return { verified: false, reason: 'O documento é de outra empresa.' };
    }
  }

  if (requirement.mustCoverDate !== null) {
    if (candidate.validUntil === null) {
      return { verified: null, reason: 'O documento não expõe validade para conferência.' };
    }
    if (civilDays(requirement.mustCoverDate, candidate.validUntil) < 0) {
      return { verified: false, reason: 'A validade do documento não cobre a data exigida.' };
    }
  }

  const parts = [
    requirement.expectedTaxId !== null ? 'CNPJ conferido' : null,
    requirement.mustCoverDate !== null ? `validade cobre ${requirement.mustCoverDate}` : null,
  ].filter(Boolean);
  return { verified: true, basis: parts.join(' · ') };
}
