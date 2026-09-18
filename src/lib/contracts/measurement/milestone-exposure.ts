/**
 * EXPOSIÇÃO E DIAGNÓSTICO DE GARGALO — lógica pura, testável sem DOM.
 *
 * Tudo que a aba afirma em número nasce aqui, com uma regra só: **nenhum
 * somatório mistura as três verdades**. Direito, apurado e aceito são somados
 * em separado, e um total ausente permanece `null` — jamais 0.
 */

import type { MilestoneWorkbenchRow } from './milestone-workbench-types';
import { assessMilestone, deriveStage } from './milestone-stage';

/** Soma que preserva ausência: `null` quando nenhuma linha sustentou valor. */
function sumOrNull(values: readonly (number | null)[]): number | null {
  const present = values.filter((v): v is number => v !== null);
  return present.length > 0 ? present.reduce((a, b) => a + b, 0) : null;
}

export interface MilestoneExposure {
  /** Σ do DIREITO contratual por evento. Distinto do total do instrumento. */
  readonly entitlementTotal: number | null;
  /** Σ do valor APURADO. Nunca preenchido pelo previsto. */
  readonly measuredTotal: number | null;
  /** Σ do valor ACEITO por autoridade. */
  readonly acceptedTotal: number | null;
  /** Σ dos eventos de faturamento existentes para estes marcos. */
  readonly billedTotal: number | null;
  readonly counts: {
    readonly total: number;
    readonly triggerAssessed: number;
    readonly readyToBill: number;
    readonly billed: number;
    readonly blocked: number;
  };
}

export function computeExposure(rows: readonly MilestoneWorkbenchRow[]): MilestoneExposure {
  const stages = rows.map((r) => deriveStage(r));
  return {
    entitlementTotal: sumOrNull(rows.map((r) => r.entitlementAmount)),
    measuredTotal: sumOrNull(rows.map((r) => r.measuredAmount)),
    acceptedTotal: sumOrNull(rows.map((r) => r.acceptedValue)),
    billedTotal: sumOrNull(rows.map((r) => r.billingEligibleAmount)),
    counts: {
      total: rows.length,
      triggerAssessed: stages.filter((s) => s.triggerAssessed).length,
      readyToBill: stages.filter((s) => s.stage === 'READY_TO_BILL').length,
      billed: stages.filter((s) => s.stage === 'BILLED').length,
      blocked: stages.filter((s) => s.stage === 'BLOCKED').length,
    },
  };
}

/**
 * A DIVERGÊNCIA entre o cabeçalho do instrumento e a soma dos direitos.
 *
 * Devolve `null` quando falta uma das pontas — e NÃO quando o delta é zero.
 * Um contrato conciliado precisa poder dizer "conferido: zero", que é
 * informação diferente de "não dá para comparar".
 */
export interface EntitlementReconciliation {
  readonly headerTotal: number;
  readonly entitlementTotal: number;
  readonly delta: number;
}

export function reconcileEntitlement(
  headerTotal: number | null,
  entitlementTotal: number | null,
): EntitlementReconciliation | null {
  if (headerTotal === null || entitlementTotal === null) return null;
  // Centavos inteiros na comparação: 8032339.77 - 8032339.76 em ponto
  // flutuante devolve 0.009999999776482582, e um `!== 0` ingênuo passaria a
  // exibir divergências fantasmas em contratos conciliados.
  const delta = Math.round(entitlementTotal * 100) - Math.round(headerTotal * 100);
  return { headerTotal, entitlementTotal, delta: delta / 100 };
}

/**
 * A DECOMPOSIÇÃO do que bloqueia receita.
 *
 * Três segmentos que somam o contratado: aceito, apurado-aguardando-aceite e
 * NÃO APURADO. O terceiro é o resto — e é tracejado na tela, porque é ausência
 * de apuração e não apuração de zero.
 */
export interface RevenueBlockBreakdown {
  readonly accepted: number;
  readonly measuredPending: number;
  readonly unassessed: number;
  readonly base: number | null;
}

export function computeRevenueBlock(
  rows: readonly MilestoneWorkbenchRow[],
  base: number | null,
): RevenueBlockBreakdown {
  const accepted = rows.reduce((s, r) => s + (r.acceptedValue ?? 0), 0);
  // Apurado que ainda não foi aceito. Sem dupla contagem: quem tem aceito sai.
  const measuredPending = rows.reduce(
    (s, r) => s + (r.acceptedValue === null ? (r.measuredAmount ?? 0) : 0), 0);
  const unassessed = base !== null
    ? Math.max(0, base - accepted - measuredPending)
    : 0;
  return { accepted, measuredPending, unassessed, base };
}

// ═══════════════════════════════════════════════════════════════════════════
// DIAGNÓSTICO DO GARGALO
// ═══════════════════════════════════════════════════════════════════════════

export interface BottleneckDiagnosis {
  /** A frase exibida sob a esteira. Derivada, nunca escrita à mão. */
  readonly note: string;
  /** Rótulo da ação que desbloqueia, quando existe caminho conhecido. */
  readonly actionLabel: string | null;
  readonly projectId: string | null;
}

const money = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);

/**
 * O que está bloqueado, quanto vale, por quê e para onde ir.
 *
 * A causa é lida do DADO — quantos marcos, em que estágio, com qual lacuna — e
 * não de um mapa de mensagens por estágio. Um texto fixo por estágio voltaria a
 * dizer "configure o cronograma" para um contrato cujo projeto nem existe.
 */
export function diagnoseBottleneck(
  rows: readonly MilestoneWorkbenchRow[],
  projectId: string | null,
  hasTimeline: boolean,
): BottleneckDiagnosis | null {
  if (rows.length === 0) {
    return {
      note: 'Nenhum marco contratual registrado. Sem marco, a etapa "Medido" não pode ser apurada '
        + 'e o faturamento fica sem lastro contratual.',
      actionLabel: null,
      projectId,
    };
  }

  const assessments = rows.map((r) => assessMilestone(r));
  const by = (stage: string) => assessments.filter((a) => a.stage.stage === stage);
  const valueOf = (subset: typeof assessments) =>
    subset.reduce((s, a) => s + (a.row.entitlementAmount ?? 0), 0);

  const unmapped = [...by('UNMAPPED'), ...by('UNINSTRUMENTED')];
  if (unmapped.length > 0) {
    const value = valueOf(unmapped);
    const cause = !hasTimeline
      ? 'o projeto vinculado não possui itens de cronograma'
      : 'as exigências de medição ainda não foram mapeadas a etapas do cronograma';
    return {
      note: `${unmapped.length} marco(s) sem gatilho apurado bloqueiam ${money(value)} de medição. `
        + `Causa: ${cause}. Sem etapa mapeada, nenhum marco sai de "não apurado".`,
      actionLabel: hasTimeline ? 'Mapear cronograma' : 'Importar cronograma',
      projectId,
    };
  }

  const blocked = by('BLOCKED');
  if (blocked.length > 0) {
    return {
      note: `${blocked.length} medição(ões) bloqueada(s) impedem ${money(valueOf(blocked))} de avançar. `
        + 'O motivo do bloqueio está registrado na medição, em Projetos.',
      actionLabel: 'Ver bloqueios',
      projectId,
    };
  }

  const pending = [...by('TRIGGER_PENDING'), ...by('UNKNOWN')];
  if (pending.length > 0) {
    return {
      note: `${pending.length} marco(s) aguardam o gatilho contratual ocorrer na execução `
        + `(${money(valueOf(pending))}). A data virá do cronograma do projeto, não do calendário.`,
      actionLabel: 'Ver cronograma',
      projectId,
    };
  }

  const awaiting = [...by('AWAITING_EVIDENCE'), ...by('AWAITING_ACCEPTANCE'), ...by('READY_TO_MEASURE')];
  if (awaiting.length > 0) {
    return {
      note: `${awaiting.length} marco(s) com gatilho ocorrido aguardam evidência ou aceite `
        + `(${money(valueOf(awaiting))}). O aceite é ato de autoridade e acontece em Projetos.`,
      actionLabel: 'Abrir medições',
      projectId,
    };
  }

  const ready = by('READY_TO_BILL');
  if (ready.length > 0) {
    return {
      note: `${ready.length} marco(s) elegíveis para faturar somam ${money(valueOf(ready))}. `
        + 'Gerar o evento de faturamento continua sendo um ato humano.',
      actionLabel: null,
      projectId: null,
    };
  }

  return null;
}
