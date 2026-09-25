/**
 * FATURAMENTO DO LOCAL — `GET /api/dashboard/site/[projectId]/billing` (server-only).
 *
 * O eventograma dos contratos VINCULADOS ao projeto (o evento de faturamento
 * não tem projeto: o caminho é projeto → `project_contract_link_governed` →
 * contrato → `contract_to_cash_read_model`). Colunas EXPLÍCITAS, nunca `*`.
 *
 * Portões = espelho da RLS (os mesmos do Dashboard, `./rules`):
 *  • a seção: `contracts.view` (o vínculo e o contrato) E `billingGate` (a RLS
 *    EFETIVA de `contract_billing_events` — quem leria só parte das linhas é
 *    Restrito, nunca um eventograma incompleto);
 *  • valor (evento e total): só com `current_user_can_view_project_financials()`;
 *  • situação do título (recebível): só com `receivablesGate` — sem ela o pago
 *    some (`fs_select`) e o título pareceria em aberto.
 * O faturamento se executa em Contratos: aqui só se lê, e o link abre lá.
 */
if (typeof window !== 'undefined') {
  throw new Error('dashboard/site-billing.ts não pode ser importado no navegador');
}

import type { SupabaseClient } from '@supabase/supabase-js';
import type { CommercialSession } from '@/lib/commercial/server-session';
import { selectIn } from '@/lib/supabase/select-in';
import { ELIGIBILITY_LABEL, RECEIVABLE_STATUS_LABEL, RELEASE_LABEL } from '@/lib/contracts/billing/contract-to-cash-display';
import type { BillingEligibilityState, BillingReleaseState, ReceivableStatus } from '@/lib/contracts/billing/contract-to-cash-service';
import { MEASUREMENT_STATUS_LABEL, type MeasurementStatus } from '@/lib/projects/measurements/types';
import { resolveGates, SECTION_TIMEOUT_MS } from './overview';
import { billingClass, isoDay, maskedMoney, sumByCurrency, type BillingEventLike } from './rules';
import { isSiteProjectId, loadSiteProject, siteFailure, sitePart, withTimeout } from './site-supply';
import type { EventogramRow, EventogramState, SiteBillingData, SiteBillingResponse } from './types';

type Session = CommercialSession;

/** Teto de linhas por leitura (o `max_rows` do PostgREST). */
const READ_LIMIT = 1000;

export const BILLING_HREF = '/contratos?view=faturamento';

const num = (v: unknown): number | null => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

/* ══════════════════════════════════════════════════════════════════════════
   Regras puras (testadas em tests/unit/dashboard-site-billing.test.ts)
   ══════════════════════════════════════════════════════════════════════════ */

/** A linha de `contract_to_cash_read_model` que o eventograma lê (os campos opcionais só vêm com o portão). */
export interface CashRow {
  billing_event_id: string;
  contract_id: string | null;
  milestone_id: string | null;
  title: string | null;
  currency: string | null;
  eligibility_state: string | null;
  release_state: string | null;
  legacy_row: boolean | null;
  cancelled_at: string | null;
  superseded_by_id: string | null;
  source_measurement_id: string | null;
  fiscal_request_state: string | null;
  fiscal_document_id: string | null;
  fiscal_document_status: string | null;
  fiscal_document_number: string | null;
  created_at: string | null;
  /** Só com a leitura financeira. */
  eligible_amount?: number | string | null;
  /** Só com `receivablesGate`. */
  receivable_id?: string | null;
  receivable_status?: string | null;
  due_date?: string | null;
}

/** Situação da NF (fiscal_documents.status) — o vocabulário do Fiscal. */
export const FISCAL_STATUS_LABEL: Record<string, string> = {
  draft: 'Rascunho', pending_approval: 'Aguardando aprovação', approved: 'Aprovada', queued: 'Na fila',
  processing: 'Em processamento', authorized: 'Autorizada', rejected: 'Rejeitada', error: 'Com erro',
  cancellation_requested: 'Cancelamento pedido', cancelled: 'Cancelada', replaced: 'Substituída', archived: 'Arquivada',
};

const LEGACY_LABEL = 'Faturamento anterior à Fase 7: origem do valor desconhecida';
const FISCAL_BLOCKED_LABEL = 'Fiscal bloqueado por configuração';

/**
 * O estado do evento na régua do protótipo (aguardando → elegível → em
 * aprovação → liberado → NF → título → recebido), da etapa MAIS avançada que
 * a pessoa LÊ. Sem `receivablesGate` a cadeia para na NF (o título não é
 * inventado nem dado como pago).
 */
export function eventogramState(r: CashRow, opts: { receivables: boolean }): { state: EventogramState; stateLabel: string } {
  const release = r.release_state as BillingReleaseState | null;
  if (r.cancelled_at || release === 'CANCELLED') return { state: 'cancelled', stateLabel: RELEASE_LABEL.CANCELLED };
  if (r.superseded_by_id || release === 'SUPERSEDED') return { state: 'cancelled', stateLabel: RELEASE_LABEL.SUPERSEDED };
  if (opts.receivables && r.receivable_id) {
    const status = r.receivable_status as ReceivableStatus | null;
    if (status === 'PAID') return { state: 'paid', stateLabel: RECEIVABLE_STATUS_LABEL.PAID };
    return { state: 'receivable', stateLabel: status ? RECEIVABLE_STATUS_LABEL[status] ?? 'Título em Finanças' : 'Título em Finanças' };
  }
  if (r.fiscal_document_id) {
    const fiscal = r.fiscal_document_status;
    if (fiscal === 'rejected' || fiscal === 'error') return { state: 'blocked', stateLabel: `NF ${FISCAL_STATUS_LABEL[fiscal].toLowerCase()}` };
    return { state: 'invoiced', stateLabel: fiscal === 'authorized' ? 'Nota autorizada' : 'Nota em preparo' };
  }
  if (release === 'RELEASED') {
    return r.fiscal_request_state === 'BLOCKED_BY_CONFIGURATION'
      ? { state: 'blocked', stateLabel: FISCAL_BLOCKED_LABEL }
      : { state: 'released', stateLabel: 'Liberado · sem NF emitida' };
  }
  if (release === 'PENDING_RELEASE') return { state: 'pending_release', stateLabel: RELEASE_LABEL.PENDING_RELEASE };
  if (release === 'RELEASE_REJECTED') return { state: 'blocked', stateLabel: RELEASE_LABEL.RELEASE_REJECTED };
  if (r.legacy_row === true || release === 'LEGACY') return { state: 'blocked', stateLabel: LEGACY_LABEL };
  const eligibility = r.eligibility_state as BillingEligibilityState | null;
  if (release === 'ELIGIBLE' && eligibility === 'ELIGIBLE') return { state: 'eligible', stateLabel: RELEASE_LABEL.ELIGIBLE };
  if (eligibility === 'BLOCKED' || eligibility === 'INCOMPLETE') return { state: 'blocked', stateLabel: ELIGIBILITY_LABEL[eligibility] };
  return { state: 'awaiting', stateLabel: 'Aguardando elegibilidade' };
}

const moneyOf = (amount: unknown, currency: string | null, financial: boolean) =>
  maskedMoney(sumByCurrency([{ amount: num(amount), currency }]), financial);

/** Uma linha da visão → a linha do eventograma (valor só com a leitura financeira). */
export function eventogramRow(
  r: CashRow,
  opts: { financial: boolean; receivables: boolean; measurement: { id: string; status: string } | null },
): EventogramRow {
  const { state, stateLabel } = eventogramState(r, opts);
  const fiscalStatus = r.fiscal_document_status;
  let fiscal: EventogramRow['fiscal'] = null;
  if (r.fiscal_document_id) {
    fiscal = { number: r.fiscal_document_number, status: fiscalStatus,
      statusLabel: fiscalStatus ? FISCAL_STATUS_LABEL[fiscalStatus] ?? 'Em preparo' : 'Em preparo' };
  } else if (r.release_state === 'RELEASED' && r.fiscal_request_state === 'BLOCKED_BY_CONFIGURATION') {
    fiscal = { number: null, status: null, statusLabel: FISCAL_BLOCKED_LABEL };
  }
  let receivable: EventogramRow['receivable'] = null;
  if (opts.receivables && r.receivable_id) {
    const status = r.receivable_status as ReceivableStatus | null;
    receivable = { due: isoDay(r.due_date ?? null), state: status, stateLabel: status ? RECEIVABLE_STATUS_LABEL[status] ?? null : null };
  } else if (!opts.receivables && fiscalStatus === 'authorized') {
    // O título nasce da NF autorizada — existe ou não, a pessoa não lê: "Restrito", nunca "sem título".
    receivable = { due: null, state: null, stateLabel: 'Restrito' };
  }
  return {
    billingEventId: r.billing_event_id,
    contractId: r.contract_id ?? '',
    title: r.title ?? 'Evento de faturamento',
    amount: opts.financial ? moneyOf(r.eligible_amount, r.currency, true) : null,
    state,
    stateLabel,
    measurement: opts.measurement
      ? { id: opts.measurement.id, status: opts.measurement.status,
        statusLabel: MEASUREMENT_STATUS_LABEL[opts.measurement.status as MeasurementStatus] ?? 'Medição' }
      : null,
    fiscal,
    receivable,
    href: BILLING_HREF,
  };
}

const asEvent = (r: CashRow): BillingEventLike => ({
  billingEventId: r.billing_event_id, contractId: r.contract_id, title: r.title, eligibleAmount: num(r.eligible_amount),
  currency: r.currency, releaseState: r.release_state, eligibilityState: r.eligibility_state, fiscalDocumentId: r.fiscal_document_id,
  supersededById: r.superseded_by_id, legacyRow: r.legacy_row, cancelledAt: r.cancelled_at,
});

/**
 * Ordem do eventograma: pela data do marco contratual (sem data por último),
 * depois pela criação; cancelados/substituídos no fim.
 */
export function sortCashRows(rows: readonly CashRow[], milestoneDue: ReadonlyMap<string, string | null>): CashRow[] {
  const closed = (r: CashRow) => Number(!!r.cancelled_at || !!r.superseded_by_id || r.release_state === 'CANCELLED' || r.release_state === 'SUPERSEDED');
  const due = (r: CashRow) => (r.milestone_id ? isoDay(milestoneDue.get(r.milestone_id) ?? null) : null);
  return [...rows].sort((a, b) => {
    const c = closed(a) - closed(b);
    if (c) return c;
    const da = due(a); const db = due(b);
    if (da !== db) { if (!da) return 1; if (!db) return -1; return da < db ? -1 : 1; }
    const ca = a.created_at ?? ''; const cb = b.created_at ?? '';
    if (ca !== cb) return ca < cb ? -1 : 1;
    return a.billing_event_id.localeCompare(b.billing_event_id);
  });
}

/**
 * O evento em foco: o primeiro elegível ou em aprovação de liberação; senão o
 * próximo a faturar (liberado sem NF); senão o primeiro que ainda aguarda
 * elegibilidade. As classes são as de `billingClass` (as mesmas da fila).
 */
export function eventogramFocus(sorted: readonly CashRow[]): string | null {
  const events = sorted.map(asEvent);
  const first = (pred: (e: BillingEventLike) => boolean) => events.find(pred)?.billingEventId ?? null;
  return first((e) => { const c = billingClass(e); return c === 'release' || c === 'approval'; })
    ?? first((e) => billingClass(e) === 'invoice')
    ?? sorted.find((r) => eventogramState(r, { receivables: false }).state === 'awaiting')?.billing_event_id
    ?? null;
}

/** Soma dos eventos vigentes (direito contratual), por moeda — só com a leitura financeira e lista inteira. */
export function eventogramTotal(rows: readonly CashRow[], financial: boolean, truncated: boolean): string | null {
  if (!financial || truncated) return null;
  const live = rows.filter((r) => !r.cancelled_at && !r.superseded_by_id && r.release_state !== 'CANCELLED' && r.release_state !== 'SUPERSEDED');
  return maskedMoney(sumByCurrency(live.map((r) => ({ amount: num(r.eligible_amount), currency: r.currency }))), true);
}

/** "CT-0042 · Retrofit UG-05"; sem número nem título → "Contrato". */
export function contractLabel(c: { contract_number: string | null; title: string | null }): string {
  return [c.contract_number, c.title].filter(Boolean).join(' · ') || 'Contrato';
}

/* ══════════════════════════════════════════════════════════════════════════
   Leitura
   ══════════════════════════════════════════════════════════════════════════ */

const CASH_COLUMNS = 'billing_event_id,contract_id,milestone_id,title,currency,eligibility_state,release_state,legacy_row,cancelled_at,'
  + 'superseded_by_id,source_measurement_id,fiscal_request_state,fiscal_document_id,fiscal_document_status,fiscal_document_number,created_at';

async function readSiteBilling(
  sb: SupabaseClient, org: string, projectId: string, opts: { financial: boolean; receivables: boolean },
): Promise<{ data: SiteBillingData; truncated: boolean }> {
  const links = await sb.from('project_contract_link_governed').select('contract_id')
    .eq('organization_id', org).eq('project_id', projectId).limit(READ_LIMIT);
  if (links.error) throw new Error('vínculo do projeto com contrato');
  const contractIds = Array.from(new Set(((links.data ?? []) as Array<{ contract_id: string | null }>)
    .map((l) => l.contract_id).filter((id): id is string => !!id)));
  if (!contractIds.length) {
    return { data: { contracts: [], total: null, rows: [], focus: null, focusExplainRef: null }, truncated: false };
  }
  const columns = `${CASH_COLUMNS}${opts.financial ? ',eligible_amount' : ''}${opts.receivables ? ',receivable_id,receivable_status,due_date' : ''}`;
  const [contracts, cash] = await Promise.all([
    selectIn<{ id: string; contract_number: string | null; title: string | null }>(contractIds,
      (c) => sb.from('contracts').select('id,contract_number,title').eq('organization_id', org).in('id', c)),
    // O evento substituído tem sucessor vigente: só o vigente entra no eventograma.
    selectIn<CashRow>(contractIds, (c) => sb.from('contract_to_cash_read_model').select(columns)
      .eq('organization_id', org).is('superseded_by_id', null).in('contract_id', c)
      .order('billing_event_id').limit(READ_LIMIT) as unknown as PromiseLike<{ data: CashRow[] | null; error: { message: string } | null }>),
  ]);
  const [milestones, measurements] = await Promise.all([
    selectIn<{ id: string; due_date: string | null }>(cash.map((r) => r.milestone_id),
      (c) => sb.from('contract_milestones').select('id,due_date').eq('organization_id', org).in('id', c)),
    selectIn<{ id: string; status: string }>(cash.map((r) => r.source_measurement_id),
      (c) => sb.from('project_measurements').select('id,status').eq('organization_id', org).in('id', c)),
  ]);
  const truncated = cash.length >= READ_LIMIT;
  const sorted = sortCashRows(cash, new Map(milestones.map((m) => [m.id, m.due_date])));
  const measurementById = new Map(measurements.map((m) => [m.id, m]));
  const labelById = new Map(contracts.map((c) => [c.id, contractLabel(c)]));
  const focus = eventogramFocus(sorted);
  return {
    data: {
      contracts: contractIds.map((id) => ({ id, label: labelById.get(id) ?? 'Contrato' })),
      total: eventogramTotal(sorted, opts.financial, truncated),
      rows: sorted.map((r) => eventogramRow(r, { ...opts,
        measurement: r.source_measurement_id ? measurementById.get(r.source_measurement_id) ?? null : null })),
      focus,
      focusExplainRef: focus ? `bill:${focus}` : null,
    },
    truncated,
  };
}

/**
 * Monta o Faturamento do local. Falha de validação, projeto inexistente ou
 * perfil sem `projects.view` → `ok: false` com o motivo (a rota responde 200).
 * Sem vínculo de contrato → `ok` com `contracts: []` (a tela diz "projeto sem
 * contrato vinculado"); leitura que falhou → `error`, nunca eventograma vazio.
 */
export async function buildSiteBilling(
  session: Session, projectId: string, today: string, timings?: Record<string, number>,
): Promise<SiteBillingResponse> {
  if (!isSiteProjectId(projectId)) return siteFailure('invalid');
  const sb = session.supabase;
  const org = session.organizationId;
  const g = await resolveGates(session);
  if (!g.projects) return siteFailure('restricted');

  let project: { id: string; name: string } | null;
  try {
    project = await withTimeout(loadSiteProject(sb, org, projectId), SECTION_TIMEOUT_MS, 'o projeto');
  } catch (error) {
    console.error('[dashboard/site] billing: projeto', error);
    return siteFailure('error');
  }
  if (!project) return siteFailure('not_found');

  const billing = await sitePart(g.contracts && g.billing, 'o faturamento do contrato',
    () => readSiteBilling(sb, org, projectId, { financial: g.financial, receivables: g.receivables }), timings, 'billing');
  return {
    ok: true,
    today,
    project,
    billing: billing.state === 'ok'
      ? { state: 'ok', data: billing.data.data, ...(billing.data.truncated ? { truncated: true } : {}) }
      : billing,
  };
}

