/**
 * OS HANDOFFS DA MEDIÇÃO — quem precisa saber o quê, e com que palavras.
 *
 * Lógica pura: sem banco, sem provedor de e-mail e sem JSX. A entrega mora em
 * `handoff-server.ts`, e a separação existe porque o CONTEÚDO de um aviso é
 * testável sem rede — e porque o teste de "o e-mail diz que foi aceito quando
 * ninguém aceitou" tem de ser um teste de unidade.
 *
 * ─── A regra que este módulo codifica ──────────────────────────────────────
 *
 *   TODO HANDOFF TEM UM DESTINATÁRIO NOMEADO, NUNCA UM DEPARTAMENTO.
 *
 * Cada evento declara os PAPÉIS que devem saber. O papel é resolvido por
 * vínculo autoritativo (`project_measurement_stakeholders`), e quando não
 * resolve o trabalho vai para a fila configurada — explicitamente, e não para
 * "todos os usuários com a permissão", que é como um canal morre.
 *
 * ─── O que um aviso nunca faz ──────────────────────────────────────────────
 *
 * Não afirma o que não aconteceu. `measurement.accepted` só é disparado pela
 * transição de aceite; nenhum texto aqui constrói a frase "a contratante
 * aceitou" a partir de aprovação interna.
 */

import { measurementHref, contractReviewHref, fiscalIssueHref } from '@/lib/projects/cross-module-links';
import { MEASUREMENT_STATUS_LABEL, type MeasurementStatus, type StakeholderRole } from './types';

/**
 * Os eventos de handoff. A lista é a §12 do plano, um a um — e não é maior que
 * ela: um aviso que ninguém pediu é ruído que treina a ignorar os que
 * importam.
 */
export type HandoffEvent =
  | 'evidence.pending_detected'
  | 'measurement.submitted_for_review'
  | 'measurement.correction_requested'
  | 'measurement.resubmitted'
  | 'measurement.approved_for_customer'
  | 'measurement.sent_to_customer'
  | 'measurement.customer_correction_requested'
  | 'measurement.accepted'
  | 'measurement.billing_eligible'
  | 'measurement.invoice_due'
  | 'sla.reminder';

/** Onde o destinatário resolve o assunto. Um aviso sem destino é um lembrete. */
export type HandoffTarget = 'project' | 'contracts' | 'fiscal';

export interface HandoffDefinition {
  readonly event: HandoffEvent;
  /** Papéis que devem saber. Ordem = ordem de exibição, não de importância. */
  readonly roles: readonly StakeholderRole[];
  /** `notifications.type` — o mesmo vocabulário de tipo do restante do produto. */
  readonly notificationType: string;
  readonly target: HandoffTarget;
  readonly headline: string;
}

export const HANDOFFS: Record<HandoffEvent, HandoffDefinition> = {
  'evidence.pending_detected': {
    event: 'evidence.pending_detected',
    roles: ['project_manager', 'measurement_responsible'],
    notificationType: 'projects.measurement.evidence_pending',
    target: 'project',
    headline: 'Pendência de evidência na medição',
  },
  'measurement.submitted_for_review': {
    event: 'measurement.submitted_for_review',
    roles: ['contract_manager'],
    notificationType: 'contracts.measurement.awaiting_review',
    target: 'contracts',
    headline: 'Medição aguardando análise contratual',
  },
  'measurement.correction_requested': {
    event: 'measurement.correction_requested',
    roles: ['project_manager', 'measurement_responsible'],
    notificationType: 'projects.measurement.correction_requested',
    target: 'project',
    headline: 'Correção solicitada pela Gestão de Contratos',
  },
  'measurement.resubmitted': {
    event: 'measurement.resubmitted',
    roles: ['contract_manager'],
    notificationType: 'contracts.measurement.resubmitted',
    target: 'contracts',
    headline: 'Medição reenviada para análise',
  },
  'measurement.approved_for_customer': {
    event: 'measurement.approved_for_customer',
    roles: ['contract_manager', 'project_manager'],
    notificationType: 'contracts.measurement.approved_for_customer',
    target: 'contracts',
    headline: 'Pacote aprovado para envio à contratante',
  },
  'measurement.sent_to_customer': {
    event: 'measurement.sent_to_customer',
    roles: ['contract_manager', 'project_manager'],
    notificationType: 'contracts.measurement.sent_to_customer',
    target: 'contracts',
    headline: 'Pacote enviado à contratante',
  },
  'measurement.customer_correction_requested': {
    // Os DOIS lados: a correção pode ser operacional (Projeto) e ainda assim
    // exigir resposta contratual (Contratos). Avisar um só produz a espera
    // circular clássica.
    event: 'measurement.customer_correction_requested',
    roles: ['project_manager', 'contract_manager', 'measurement_responsible'],
    notificationType: 'projects.measurement.customer_correction',
    target: 'project',
    headline: 'A contratante pediu correção',
  },
  'measurement.accepted': {
    event: 'measurement.accepted',
    roles: ['contract_manager', 'project_manager'],
    notificationType: 'contracts.measurement.accepted',
    target: 'contracts',
    headline: 'Aceite da contratante registrado',
  },
  'measurement.billing_eligible': {
    event: 'measurement.billing_eligible',
    roles: ['billing_owner', 'contract_manager'],
    notificationType: 'contracts.measurement.billing_eligible',
    target: 'contracts',
    headline: 'Medição elegível para faturar',
  },
  'measurement.invoice_due': {
    event: 'measurement.invoice_due',
    roles: ['finance_owner'],
    notificationType: 'finance.measurement.invoice_due',
    target: 'fiscal',
    headline: 'NF a emitir',
  },
  'sla.reminder': {
    event: 'sla.reminder',
    // O dono da etapa em curso é resolvido pelo chamador, que sabe o estado.
    // Declarar aqui todos os papéis faria o lembrete de análise chegar ao
    // financeiro.
    roles: [],
    notificationType: 'projects.measurement.sla_reminder',
    target: 'contracts',
    headline: 'Pendência de medição fora do prazo',
  },
};

/** Quem deve saber do lembrete de SLA, por etapa. */
export function slaReminderRoles(status: MeasurementStatus): readonly StakeholderRole[] {
  switch (status) {
    case 'SUBMITTED':
    case 'UNDER_REVIEW':
    case 'APPROVED_FOR_CUSTOMER':
    case 'AWAITING_CUSTOMER_ACCEPTANCE':
      return ['contract_manager'];
    case 'RETURNED_FOR_CORRECTION':
    case 'CUSTOMER_CORRECTION_REQUESTED':
      return ['project_manager', 'measurement_responsible'];
    default:
      return [];
  }
}

export interface HandoffSubject {
  readonly measurementId: string;
  readonly projectId: string;
  readonly projectCode: string | null;
  readonly contractId: string;
  readonly contractNumber: string | null;
  readonly milestoneId: string | null;
  readonly milestoneTitle: string | null;
  readonly status: MeasurementStatus;
  /** O que falta, em linguagem de gente. Vazio quando não há pendência. */
  readonly pending: readonly string[];
  /** Texto do motivo, quando o handoff tem um (correção, rejeição). */
  readonly reason: string | null;
  readonly dueAt: string | null;
}

export interface HandoffContent {
  readonly subject: string;
  readonly headline: string;
  readonly bodyText: string;
  readonly deepLink: string;
}

const fmtDate = (iso: string | null) =>
  (iso ? iso.slice(0, 10).split('-').reverse().join('/') : null);

/**
 * O caminho direto para o ITEM — não para a lista.
 *
 * Um aviso que abre a lista devolve ao leitor o trabalho de reencontrar o que o
 * aviso já sabia.
 */
export function handoffDeepLink(event: HandoffEvent, s: HandoffSubject): string {
  switch (HANDOFFS[event].target) {
    case 'project': return measurementHref(s.projectId, s.milestoneId);
    case 'contracts': return contractReviewHref(s.measurementId);
    case 'fiscal': return fiscalIssueHref();
  }
}

export function buildHandoffContent(event: HandoffEvent, s: HandoffSubject): HandoffContent {
  const def = HANDOFFS[event];
  const ref = [s.contractNumber, s.projectCode].filter(Boolean).join(' · ')
    || s.contractId.slice(0, 8);
  const marco = s.milestoneTitle ?? 'Evento contratual';

  const lines: string[] = [`${marco} — ${ref}.`];
  lines.push(`Estado atual: ${MEASUREMENT_STATUS_LABEL[s.status]}.`);
  if (s.reason) lines.push(`Motivo: ${s.reason}`);
  if (s.pending.length > 0) {
    lines.push(`Pendências: ${s.pending.join('; ')}.`);
  }
  const due = fmtDate(s.dueAt);
  // Prazo só aparece quando FOI DECLARADO. "Prazo: —" ensina a ignorar a linha.
  if (due) lines.push(`Prazo: ${due}.`);

  return {
    subject: `[INSIGHT APEX] ${def.headline} — ${ref}`,
    headline: def.headline,
    bodyText: lines.join(' '),
    deepLink: handoffDeepLink(event, s),
  };
}

/**
 * A CHAVE DE DEDUPLICAÇÃO.
 *
 * Carrega a revisão e o discriminador da rodada porque o segundo pedido de
 * correção PRECISA avisar de novo — e uma chave só com o nome do evento
 * silenciaria exatamente o aviso mais importante.
 */
export function handoffKey(
  event: HandoffEvent,
  revision: number,
  round: number | string | null = null,
): string {
  return round == null ? `${event}:r${revision}` : `${event}:r${revision}:c${round}`;
}

/** O HTML do e-mail. Sóbrio de propósito: e-mail de governança não é peça. */
export function buildHandoffEmailHtml(content: HandoffContent, appOrigin: string): string {
  const url = `${appOrigin.replace(/\/$/, '')}${content.deepLink}`;
  const esc = (t: string) => t
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return [
    '<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:560px">',
    `<h2 style="font-size:16px;margin:0 0 12px">${esc(content.headline)}</h2>`,
    `<p style="font-size:14px;line-height:1.55;color:#333;margin:0 0 16px">${esc(content.bodyText)}</p>`,
    `<p style="margin:0"><a href="${esc(url)}" style="font-size:14px;color:#0b6bcb">Abrir o item no INSIGHT APEX</a></p>`,
    '<p style="font-size:12px;color:#888;margin:20px 0 0">',
    'Este aviso é gerado pelo acompanhamento governado do Apex. ',
    'Ele informa um estado registrado — não constitui aceite, faturamento nem autorização.',
    '</p>',
    '</div>',
  ].join('');
}
