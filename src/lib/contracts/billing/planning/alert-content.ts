/**
 * O CONTEÚDO DO ALERTA — puro, testável, sem banco e sem JSX.
 *
 * ─── Por que o alerta renderiza a partir de um RETRATO ─────────────────────
 *
 * `facts_snapshot` guarda os fatos do marco no instante em que o alerta
 * nasceu, e a derivação de estado é a MESMA de toda a aplicação
 * (`deriveStage`, via `deriveBillingPlanState`). Duas consequências que
 * justificam o desenho:
 *
 *   1. Um aviso de 30 dias atrás continua contando a situação DAQUELE dia. Se
 *      ele relesse o estado de hoje, o histórico de alertas viraria N cópias
 *      da mesma linha atual e ninguém conseguiria auditar o que foi avisado.
 *
 *   2. Não existe uma segunda máquina de estado para o e-mail. O corpo do
 *      e-mail e a linha da tela nunca podem discordar sobre o mesmo marco.
 *
 * ─── O que o alerta NUNCA diz ──────────────────────────────────────────────
 *
 *   · não chama atraso de cronograma de inadimplemento contratual
 *   · não afirma que algo foi faturado, aceito, recebido ou pago
 *   · não promete entrega por um canal que não tem provedor integrado
 */

import {
  deriveBillingPlanState, BILLING_PLAN_STATE_LABEL,
  type BillingPlanState,
} from './monthly-planning';
import type { BillingMonthPlanRow, PlannedBillingDateBasis } from './month-plan-types';
import { toMonthPlanRow, type BillingMonthPlanRawRow } from './month-plan-types';

export type AlertKind = 'UPCOMING' | 'DUE_TODAY' | 'OVERDUE';

export interface BillingMilestoneAlert {
  readonly id: string;
  readonly organizationId: string;
  readonly contractId: string;
  readonly milestoneId: string;
  readonly projectId: string | null;
  readonly plannedDate: string;
  readonly plannedDateBasis: PlannedBillingDateBasis;
  readonly offsetDays: number;
  readonly kind: AlertKind;
  readonly amount: number | null;
  readonly currency: string | null;
  readonly policySource: 'default' | 'organization' | 'contract';
  readonly generatedAt: string;
  readonly asOfDate: string;
  readonly factsSnapshot: Record<string, unknown>;
}

/**
 * Reconstitui a linha de planejamento a partir do retrato.
 *
 * O retrato é gravado em snake_case exatamente para poder passar pelo
 * normalizador que já existe. Campos que o retrato não guarda entram como
 * ausentes — e ausente aqui é `null`, que a derivação já sabe tratar.
 */
export function rowFromSnapshot(alert: BillingMilestoneAlert): BillingMonthPlanRow {
  const f = alert.factsSnapshot as Partial<BillingMonthPlanRawRow> & Record<string, unknown>;
  return toMonthPlanRow({
    milestone_id: alert.milestoneId,
    organization_id: alert.organizationId,
    contract_id: alert.contractId,
    contract_number: (f.contract_number as string | null) ?? null,
    counterparty_name: (f.counterparty_name as string | null) ?? null,
    project_id: alert.projectId,
    title: (f.title as string) ?? '',
    description: null,
    status: (f.status as BillingMonthPlanRawRow['status']) ?? 'pending',
    milestone_due_date: (f.due_date as string | null) ?? null,
    completed_at: (f.completed_at as string | null) ?? null,
    milestone_owner_user_id: (f.owner_user_id as string | null) ?? null,
    contract_owner_user_id: null,
    timeline_responsible_user_id: null,
    planned_amount: alert.amount,
    planned_amount_basis: null,
    entitlement_amount: (f.entitlement_amount as number | null) ?? null,
    billing_amount: null,
    measured_amount: (f.measured_amount as number | null) ?? null,
    accepted_value: (f.accepted_value as number | null) ?? null,
    billing_eligible_amount: null,
    currency: alert.currency,
    planned_billing_date: alert.plannedDate,
    planned_billing_date_basis: alert.plannedDateBasis,
    planned_billing_month: alert.plannedDate.slice(0, 7),
    governed_mapping_count: (f.governed_mapping_count as number | null) ?? 0,
    timeline_item_id: (f.timeline_item_id as string | null) ?? null,
    timeline_title: (f.timeline_title as string | null) ?? null,
    timeline_wbs_code: (f.timeline_wbs_code as string | null) ?? null,
    timeline_status: (f.timeline_status as BillingMonthPlanRawRow['timeline_status']) ?? null,
    timeline_planned_finish: (f.timeline_planned_finish as string | null) ?? null,
    timeline_forecast_finish: null,
    timeline_actual_finish: (f.timeline_actual_finish as string | null) ?? null,
    timeline_is_active: true,
    timeline_percent_complete: null,
    reprogramming_count: 0,
    last_previous_planned_finish: null,
    last_new_planned_finish: null,
    last_reprogrammed_at: null,
    requirement_id: (f.requirement_id as string | null) ?? null,
    customer_acceptance_required: (f.customer_acceptance_required as boolean | null) ?? null,
    evidence_required: (f.evidence_required as boolean | null) ?? null,
    measurement_id: (f.measurement_id as string | null) ?? null,
    measurement_status: (f.measurement_status as BillingMonthPlanRawRow['measurement_status']) ?? null,
    measurement_readiness: (f.measurement_readiness as BillingMonthPlanRawRow['measurement_readiness']) ?? null,
    measurement_expected_at: null,
    measurement_accepted_at: (f.measurement_accepted_at as string | null) ?? null,
    measurement_evidence_count: (f.measurement_evidence_count as number | null) ?? null,
    evidence_document_id: (f.evidence_document_id as string | null) ?? null,
    evidence: (f.evidence as string | null) ?? null,
    billing_event_id: (f.billing_event_id as string | null) ?? null,
    billing_eligibility_state: (f.billing_eligibility_state as BillingMonthPlanRawRow['billing_eligibility_state']) ?? null,
    billing_release_state: (f.billing_release_state as BillingMonthPlanRawRow['billing_release_state']) ?? null,
    billing_amount_source: null,
    billing_fiscal_document_status: null,
    billing_receivable_status: (f.billing_receivable_status as BillingMonthPlanRawRow['billing_receivable_status']) ?? null,
    billing_finance_link_state: null,
    fiscal_document_number: null,
    fiscal_authorized_at: null,
    receivable_first_due_date: null,
    receivable_paid_amount_cents: null,
    receivable_open_amount_cents: null,
    receivable_last_payment_date: null,
    reconciled_settlement_count: null,
    payment_term_text: null,
  });
}

export function alertPlanState(alert: BillingMilestoneAlert): BillingPlanState {
  return deriveBillingPlanState(rowFromSnapshot(alert));
}

const formatBRL = (value: number | null, currency: string | null): string => {
  if (value === null) return 'Valor não apurado';
  try {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency', currency: currency ?? 'BRL',
    }).format(value);
  } catch {
    return `${currency ?? ''} ${value.toFixed(2)}`.trim();
  }
};

const formatDate = (iso: string): string => {
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
};

export interface AlertContent {
  readonly headline: string;
  readonly subject: string;
  /** Linhas rotuladas — a mesma ordem no in-app, no e-mail e na tela. */
  readonly lines: readonly { label: string; value: string }[];
  readonly bodyText: string;
  readonly actionLabel: string;
  /** Rota interna. Sempre relativa: o domínio é do ambiente, não do conteúdo. */
  readonly deepLink: string;
  readonly state: BillingPlanState;
}

/**
 * O título do alerta.
 *
 * "Marco previsto vencido" — e não "marco em atraso contratual". A diferença
 * não é estilística: a primeira frase descreve o cronograma; a segunda
 * acusaria inadimplemento, que só o contrato e a evidência podem sustentar.
 */
function headlineFor(kind: AlertKind, offsetDays: number): string {
  if (kind === 'OVERDUE') return 'Marco previsto vencido';
  if (kind === 'DUE_TODAY') return 'Marco de faturamento previsto para hoje';
  return `Marco de faturamento próximo — ${offsetDays} dia(s)`;
}

export function buildAlertContent(alert: BillingMilestoneAlert): AlertContent {
  const row = rowFromSnapshot(alert);
  const state = deriveBillingPlanState(row);
  const f = alert.factsSnapshot;

  const contract = (f.contract_number as string | null) ?? alert.contractId;
  const client = (f.counterparty_name as string | null) ?? 'Cliente não informado';
  const headline = headlineFor(alert.kind, alert.offsetDays);

  const lines = [
    { label: 'Contrato', value: contract },
    { label: 'Projeto', value: alert.projectId ?? 'Projeto não vinculado' },
    { label: 'Cliente', value: client },
    { label: 'Marco', value: row.title },
    { label: 'Valor previsto', value: formatBRL(alert.amount, alert.currency) },
    {
      label: alert.plannedDateBasis.startsWith('timeline')
        ? 'Data prevista no cronograma'
        : 'Data prevista',
      value: formatDate(alert.plannedDate),
    },
    { label: 'Status', value: BILLING_PLAN_STATE_LABEL[state] },
  ];

  const deepLink = alert.projectId
    ? `/contratos?aba=faturamento&marco=${alert.milestoneId}&projeto=${encodeURIComponent(alert.projectId)}`
    : `/contratos?aba=faturamento&marco=${alert.milestoneId}`;

  return {
    headline,
    subject: `[Faturamento] ${headline} — ${contract}`,
    lines,
    bodyText: lines.map((l) => `${l.label}: ${l.value}`).join('\n'),
    /*
      A ação é a que RESOLVE o gargalo daquele estado. Um botão genérico
      "abrir contrato" devolveria ao destinatário o trabalho de descobrir o
      que fazer — que é o que o alerta deveria ter feito por ele.
    */
    actionLabel: state === 'AWAITING_MEASUREMENT' || state === 'AWAITING_EVIDENCE'
      ? 'Abrir medição'
      : state === 'ELIGIBLE'
        ? 'Gerar faturamento'
        : 'Abrir projeto',
    deepLink,
    state,
  };
}

/**
 * Corpo HTML do e-mail. Sem imagem remota, sem rastreador e sem promessa de
 * canal: o e-mail diz o que sabe e leva para dentro do produto.
 */
export function buildAlertEmailHtml(alert: BillingMilestoneAlert, appUrl: string): string {
  const c = buildAlertContent(alert);
  const rows = c.lines.map((l) => `
      <tr>
        <td style="padding:6px 12px 6px 0;color:#6b7280;font-size:13px;white-space:nowrap;">${escapeHtml(l.label)}</td>
        <td style="padding:6px 0;color:#111827;font-size:13px;font-weight:600;">${escapeHtml(l.value)}</td>
      </tr>`).join('');

  return `<div style="font-family:Arial,Helvetica,sans-serif;max-width:620px;margin:0 auto;">
  <div style="background:linear-gradient(135deg,#0F766E 0%,#14B8A6 100%);padding:24px;">
    <h1 style="color:#fff;margin:0;font-size:18px;">Insight — Faturamento</h1>
    <p style="color:#d1fae5;margin:6px 0 0;font-size:14px;">${escapeHtml(c.headline)}</p>
  </div>
  <div style="padding:24px;background:#f9fafb;">
    <table style="border-collapse:collapse;width:100%;">${rows}</table>
    <p style="margin:20px 0 0;">
      <a href="${appUrl}${c.deepLink}"
         style="background:#0F766E;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;font-size:14px;font-weight:600;display:inline-block;">
        ${escapeHtml(c.actionLabel)}
      </a>
    </p>
    <p style="color:#6b7280;font-size:12px;margin-top:20px;line-height:1.5;">
      Este aviso informa a data PREVISTA do marco contratual. Não afirma que o
      faturamento ocorreu, que a medição foi aceita, nem que há inadimplemento
      contratual.
    </p>
  </div>
</div>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
