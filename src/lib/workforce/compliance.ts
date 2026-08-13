/**
 * Compliance de Pessoas & Custos — envio da folha, eventos do eSocial e guias.
 *
 * Amarra os indicadores da Visão Geral ao ciclo obrigatório da competência:
 *   fechamento → aprovação → envio ao financeiro → eventos eSocial → guias/impostos.
 *
 * Fontes:
 *   • `PayrollClosingBatchApproved` (Fechamento da Folha) — real quando em modo supabase.
 *   • eSocial (`/api/workforce/esocial-overview`) — hoje simulado enquanto o bridge PHP
 *     (nfephp-org/sped-esocial) não está publicado; o shape já é o definitivo.
 *   • Calendário legal (prazos) — derivado da competência, sem fonte externa.
 */

import type { PayrollClosingBatch, PayrollClosingStatus } from '@/lib/types/payroll-closing';

// ── Tipos ────────────────────────────────────────────────────────────────────

export type ObligationKind = 'payroll' | 'esocial' | 'tax_guide';

export type ObligationStatus =
  /** Concluído dentro do prazo. */
  | 'done'
  /** Concluído, porém depois do vencimento. */
  | 'done_late'
  /** Ainda no prazo, sem urgência. */
  | 'pending'
  /** Vence em até 3 dias. */
  | 'due_soon'
  /** Venceu e não foi concluído. */
  | 'late'
  /**
   * Venceu e o INSIGHT não tem fonte que confirme o recolhimento. Distinto de
   * `late`: aqui a ausência é de evidência, não necessariamente de pagamento —
   * afirmar atraso seria uma conclusão que o dado não sustenta.
   */
  | 'unconfirmed'
  /** Depende de uma etapa anterior que ainda não ocorreu. */
  | 'blocked';

export type ObligationSource = 'payroll_closing' | 'esocial';

export interface WorkforceObligation {
  id: string;
  /** Sigla curta usada no chip (ex.: 'FGTS', 'DCTFWeb', 'S-1200'). */
  code: string;
  label: string;
  description: string;
  kind: ObligationKind;
  /** Competência YYYY-MM. */
  competence: string;
  /** Vencimento legal, ISO (YYYY-MM-DD). */
  dueDate: string;
  status: ObligationStatus;
  /** Dias até o vencimento (negativo = vencido). */
  daysToDue: number;
  source: ObligationSource;
  /** Valor estimado da guia/lote em BRL, quando aplicável. */
  amount?: number;
  /** Rastro de evidência (protocolo, lote, recibo) quando existir. */
  evidence?: string;
  /** Destino do clique na UI. */
  href?: string;
  /** Quando `blocked`: o que exatamente está travando. */
  blockedReason?: string;
}

export interface EsocialLinkState {
  connected: boolean;
  environment: 'homologation' | 'production';
  certificateStatus: 'not_configured' | 'valid' | 'expiring' | 'expired' | 'invalid';
  certificateExpiresAt?: string;
  lastSyncAt?: string;
  nextScheduledSyncAt?: string;
  importedEventsCount: number;
  failedEventsCount: number;
  /** Kill switch do servidor: com ele desligado o cron consulta mas não grava. */
  automationEnabled: boolean;
  safeMessage: string;
}

/**
 * Valores apurados pelo eSocial para a competência. `undefined` = totalizador
 * ainda não transmitido/consultado; nunca uma estimativa.
 */
export interface EsocialCompetenceFigures {
  /** S-5011 — contribuição previdenciária. */
  inss?: number;
  /** S-5012 — IRRF. */
  irrf?: number;
  /** S-5003 — FGTS. */
  fgts?: number;
  /** Quais totalizadores já chegaram. */
  totalizers: Record<string, boolean>;
}

export interface ComplianceSnapshot {
  competence: string;
  competenceLabel: string;
  obligations: WorkforceObligation[];
  /** 0–100: proporção de obrigações concluídas, penalizando atrasos. */
  score: number;
  counts: Record<'done' | 'late' | 'due_soon' | 'pending' | 'blocked' | 'unconfirmed', number>;
  /** Próxima obrigação não concluída (a mais urgente). */
  nextDue?: WorkforceObligation;
  payrollStatus: PayrollClosingStatus | 'missing';
  payrollAmount?: number;
  esocial: EsocialLinkState;
}

// ── Calendário ───────────────────────────────────────────────────────────────

const MONTH_NAMES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

export function competenceLabel(competence: string): string {
  const [y, m] = competence.split('-').map(Number);
  return `${MONTH_NAMES[m - 1]}/${y}`;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Dia `day` do mês seguinte à competência; antecipa para o dia útil anterior se cair em fim de semana. */
function dueOnNextMonthDay(competence: string, day: number): string {
  const [y, m] = competence.split('-').map(Number);
  const d = new Date(Date.UTC(y, m, day));
  // Vencimentos fiscais que caem em sábado/domingo são antecipados.
  const dow = d.getUTCDay();
  if (dow === 6) d.setUTCDate(d.getUTCDate() - 1);
  if (dow === 0) d.setUTCDate(d.getUTCDate() - 2);
  return isoDate(d);
}

/** N-ésimo dia útil do mês seguinte à competência (usado no prazo de pagamento da folha). */
function dueOnNextMonthBusinessDay(competence: string, businessDay: number): string {
  const [y, m] = competence.split('-').map(Number);
  const d = new Date(Date.UTC(y, m, 1));
  let counted = 0;
  while (counted < businessDay) {
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) counted += 1;
    if (counted < businessDay) d.setUTCDate(d.getUTCDate() + 1);
  }
  return isoDate(d);
}

function daysBetween(fromIso: string, toIso: string): number {
  const a = Date.parse(`${fromIso}T00:00:00Z`);
  const b = Date.parse(`${toIso}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

// ── Derivação ────────────────────────────────────────────────────────────────

const DONE_PAYROLL_STATUSES: PayrollClosingStatus[] = ['approved', 'sent_to_finance', 'posted'];

function statusFor(
  done: boolean,
  doneAt: string | undefined,
  dueDate: string,
  today: string,
  blocked: boolean,
  /** True quando não existe fonte capaz de confirmar a conclusão (guias derivadas). */
  untracked: boolean,
): { status: ObligationStatus; daysToDue: number } {
  const daysToDue = daysBetween(today, dueDate);
  if (done) {
    const late = doneAt ? daysBetween(dueDate, doneAt.slice(0, 10)) > 0 : false;
    return { status: late ? 'done_late' : 'done', daysToDue };
  }
  if (blocked) return { status: 'blocked', daysToDue };
  if (daysToDue < 0) return { status: untracked ? 'unconfirmed' : 'late', daysToDue };
  if (daysToDue <= 3) return { status: 'due_soon', daysToDue };
  return { status: 'pending', daysToDue };
}

export const EMPTY_ESOCIAL_LINK: EsocialLinkState = {
  connected: false,
  environment: 'homologation',
  certificateStatus: 'not_configured',
  importedEventsCount: 0,
  failedEventsCount: 0,
  automationEnabled: false,
  safeMessage: 'Integração eSocial ainda não configurada.',
};

export interface BuildComplianceInput {
  competence: string;
  /** Lote de fechamento da competência, quando existir. */
  batch?: Pick<
    PayrollClosingBatch,
    'id' | 'status' | 'total_amount_cents' | 'updated_at' | 'approved_by' | 'payment_deadline'
  >;
  esocial?: EsocialLinkState;
  /** Valores apurados pelo eSocial para esta competência (totalizadores). */
  figures?: EsocialCompetenceFigures;
  /** Data de referência ISO (default: hoje). Injetável para testes/relatórios. */
  today?: string;
}

/**
 * Monta o snapshot de compliance da competência: envio da folha, eventos do
 * eSocial e guias derivadas. Todas as guias ficam `blocked` enquanto a folha da
 * competência não é aprovada — é a folha que define a base de cálculo.
 */
export function buildComplianceSnapshot({
  competence,
  batch,
  esocial = EMPTY_ESOCIAL_LINK,
  figures,
  today = isoDate(new Date()),
}: BuildComplianceInput): ComplianceSnapshot {
  const payrollStatus: PayrollClosingStatus | 'missing' = batch?.status ?? 'missing';
  const payrollApproved = batch ? DONE_PAYROLL_STATUSES.includes(batch.status) : false;
  const payrollSentToFinance = batch ? batch.status === 'sent_to_finance' || batch.status === 'posted' : false;
  const payrollAmount = batch ? batch.total_amount_cents / 100 : undefined;
  const doneAt = batch?.updated_at;

  const esocialSynced =
    esocial.connected && Boolean(esocial.lastSyncAt) && esocial.importedEventsCount > 0;

  const obligations: WorkforceObligation[] = [];

  const push = (
    o: Omit<WorkforceObligation, 'status' | 'daysToDue'> & {
      done: boolean;
      doneAt?: string;
      blocked?: boolean;
    },
  ) => {
    const { done, doneAt: at, blocked, ...rest } = o;
    // O eSocial informa QUANTO se deve, não SE foi pago: o recolhimento vive no
    // banco/PIX, fora do alcance do conector. Por isso uma guia vencida entra
    // como "sem confirmação", não como atraso comprovado.
    const untracked = rest.kind === 'tax_guide';
    obligations.push({
      ...rest,
      ...statusFor(done, at, rest.dueDate, today, blocked ?? false, untracked),
    });
  };

  // 1. Fechamento e aprovação da folha — origem de tudo.
  push({
    id: `${competence}-payroll-close`,
    code: 'FOLHA',
    label: 'Fechamento da folha aprovado',
    description: 'Importação, validação e aprovação do lote da competência.',
    kind: 'payroll',
    competence,
    dueDate: dueOnNextMonthBusinessDay(competence, 3),
    source: 'payroll_closing',
    amount: payrollAmount,
    evidence: batch ? `Lote ${batch.id.slice(0, 8)}` : undefined,
    href: '/workforce-cost/fechamento-folha',
    done: payrollApproved,
    doneAt,
  });

  // 2. Envio ao financeiro / pagamento.
  push({
    id: `${competence}-payroll-send`,
    code: 'PGTO',
    label: 'Folha enviada ao financeiro',
    description: 'Handoff contábil-financeiro e liberação do pagamento aos colaboradores.',
    kind: 'payroll',
    competence,
    dueDate: batch?.payment_deadline?.slice(0, 10) ?? dueOnNextMonthBusinessDay(competence, 5),
    source: 'payroll_closing',
    amount: payrollAmount,
    href: '/workforce-cost/fechamento-folha',
    blockedReason: 'Aguardando aprovação da folha',
    done: payrollSentToFinance,
    doneAt,
    blocked: !payrollApproved,
  });

  // 3. Eventos periódicos do eSocial (remuneração + pagamento).
  push({
    id: `${competence}-esocial-1200`,
    code: 'S-1200',
    label: 'eSocial — remuneração (S-1200)',
    description: 'Transmissão da remuneração por trabalhador da competência.',
    kind: 'esocial',
    competence,
    dueDate: dueOnNextMonthDay(competence, 15),
    source: 'esocial',
    evidence: esocial.lastSyncAt ? `Sync ${esocial.lastSyncAt.slice(0, 10)}` : undefined,
    href: '/configuracoes/integracoes',
    blockedReason: 'Aguardando aprovação da folha',
    done: esocialSynced,
    doneAt: esocial.lastSyncAt,
    blocked: !payrollApproved,
  });

  push({
    id: `${competence}-esocial-1210`,
    code: 'S-1210',
    label: 'eSocial — pagamentos (S-1210)',
    description: 'Transmissão dos pagamentos efetuados na competência.',
    kind: 'esocial',
    competence,
    dueDate: dueOnNextMonthDay(competence, 15),
    source: 'esocial',
    href: '/configuracoes/integracoes',
    blockedReason: 'Aguardando envio da folha ao financeiro',
    done: esocialSynced && payrollSentToFinance,
    doneAt: esocial.lastSyncAt,
    blocked: !payrollSentToFinance,
  });

  // 4. Guias e declarações — valores APURADOS pelo eSocial, nunca estimados.
  //
  //    Cada guia tem um totalizador correspondente. Enquanto ele não chega, a
  //    obrigação fica `blocked` e sem valor: é mais útil dizer "o eSocial ainda
  //    não apurou" do que exibir um número que ninguém pode conferir.
  const t = figures?.totalizers ?? {};

  push({
    id: `${competence}-dctfweb`,
    code: 'DCTFWeb',
    label: 'DCTFWeb transmitida',
    description: 'Declaração gerada a partir dos eventos periódicos do eSocial.',
    kind: 'tax_guide',
    competence,
    dueDate: dueOnNextMonthDay(competence, 15),
    source: 'esocial',
    href: '/financeiro/impostos',
    blockedReason: esocial.connected ? 'Aguardando apuração do eSocial' : 'Conecte o eSocial para apurar',
    // A DCTFWeb é gerada pela apuração; com os totalizadores fechados, a
    // declaração está disponível para transmissão.
    done: Boolean(t['S-5011'] && t['S-5012']),
    doneAt: esocial.lastSyncAt,
    blocked: !esocialSynced,
  });

  push({
    id: `${competence}-inss`,
    code: 'INSS',
    label: 'DARF INSS (contribuição previdenciária)',
    description: 'Valor apurado pelo eSocial no totalizador S-5011.',
    kind: 'tax_guide',
    competence,
    dueDate: dueOnNextMonthDay(competence, 20),
    source: 'esocial',
    amount: figures?.inss,
    evidence: t['S-5011'] ? 'S-5011 apurado' : undefined,
    href: '/financeiro/impostos',
    blockedReason: esocial.connected ? 'Aguardando apuração do eSocial' : 'Conecte o eSocial para apurar',
    done: false,
    blocked: !t['S-5011'],
  });

  push({
    id: `${competence}-fgts`,
    code: 'FGTS',
    label: 'FGTS Digital',
    description: 'Valor apurado pelo eSocial no totalizador S-5013.',
    kind: 'tax_guide',
    competence,
    dueDate: dueOnNextMonthDay(competence, 20),
    source: 'esocial',
    amount: figures?.fgts,
    evidence: t['S-5013'] ? 'S-5013 apurado' : undefined,
    href: '/financeiro/impostos',
    blockedReason: esocial.connected ? 'Aguardando apuração do eSocial' : 'Conecte o eSocial para apurar',
    done: false,
    blocked: !t['S-5013'],
  });

  push({
    id: `${competence}-irrf`,
    code: 'IRRF',
    label: 'DARF IRRF (código 0561)',
    description: 'Valor apurado pelo eSocial no totalizador S-5012.',
    kind: 'tax_guide',
    competence,
    dueDate: dueOnNextMonthDay(competence, 20),
    source: 'esocial',
    amount: figures?.irrf,
    evidence: t['S-5012'] ? 'S-5012 apurado' : undefined,
    href: '/financeiro/impostos',
    blockedReason: esocial.connected ? 'Aguardando apuração do eSocial' : 'Conecte o eSocial para apurar',
    done: false,
    blocked: !t['S-5012'],
  });

  const counts = { done: 0, late: 0, due_soon: 0, pending: 0, blocked: 0, unconfirmed: 0 };
  for (const o of obligations) {
    if (o.status === 'done') counts.done += 1;
    else if (o.status === 'done_late') { counts.done += 1; counts.late += 1; }
    else if (o.status === 'late') counts.late += 1;
    else if (o.status === 'unconfirmed') counts.unconfirmed += 1;
    else if (o.status === 'due_soon') counts.due_soon += 1;
    else if (o.status === 'blocked') counts.blocked += 1;
    else counts.pending += 1;
  }

  // Score: concluídas valem 1, concluídas em atraso 0.6, atrasadas 0, sem
  // confirmação 0.4 (não é atraso comprovado, mas também não é evidência) e as
  // demais 0.5.
  const weight = (s: ObligationStatus) =>
    s === 'done' ? 1 : s === 'done_late' ? 0.6 : s === 'late' ? 0 : s === 'unconfirmed' ? 0.4 : 0.5;
  const score = obligations.length
    ? Math.round((obligations.reduce((sum, o) => sum + weight(o.status), 0) / obligations.length) * 100)
    : 0;

  const openObligations = obligations
    .filter((o) => o.status !== 'done' && o.status !== 'done_late')
    .sort((a, b) => a.daysToDue - b.daysToDue);

  return {
    competence,
    competenceLabel: competenceLabel(competence),
    obligations,
    score,
    counts,
    nextDue: openObligations[0],
    payrollStatus,
    payrollAmount,
    esocial,
  };
}

// ── Rótulos de UI ────────────────────────────────────────────────────────────

export const OBLIGATION_STATUS_META: Record<
  ObligationStatus,
  { label: string; tone: 'success' | 'warning' | 'critical' | 'info' | 'neutral' }
> = {
  done:      { label: 'Concluído',        tone: 'success'  },
  done_late: { label: 'Concluído c/ atraso', tone: 'warning' },
  pending:   { label: 'No prazo',         tone: 'info'     },
  due_soon:  { label: 'Vence em breve',   tone: 'warning'  },
  late:      { label: 'Em atraso',        tone: 'critical' },
  unconfirmed: { label: 'Sem confirmação', tone: 'warning' },
  blocked:   { label: 'Aguardando folha', tone: 'neutral'  },
};

export const PAYROLL_STATUS_LABEL: Record<PayrollClosingStatus | 'missing', string> = {
  missing: 'Sem lote na competência',
  imported: 'Importada',
  validated: 'Validada',
  reviewed: 'Em revisão',
  approved: 'Aprovada',
  sent_to_finance: 'Enviada ao financeiro',
  posted: 'Contabilizada',
  cancelled: 'Cancelada',
};
