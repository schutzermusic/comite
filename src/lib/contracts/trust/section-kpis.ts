/**
 * Indicadores POR ÁREA da carteira de contratos.
 *
 * ─── O problema que este arquivo resolve ───────────────────────────────────
 *
 * `PortfolioKpiCards` era uma tira só, com oito indicadores fixos, repetida
 * acima de sete áreas diferentes. Abrir "Documentos" mostrava, antes de
 * qualquer coisa de documento, "Faturado", "Execução média" e "Obrigações
 * atrasadas" — números verdadeiros, mas que não respondem nenhuma pergunta de
 * quem foi até ali. O custo não era só de espaço: uma tira idêntica em toda
 * área treina o olho a pular a primeira dobra inteira.
 *
 * Aqui cada área declara os SEUS indicadores, de 4 a 6, a partir da mesma
 * verdade canônica que a própria área opera. Nenhum conjunto novo de dados é
 * criado: cada KPI lê do agregado que a página já montou
 * (`TrustedPortfolioStats`, `RenewalHorizon`, `ObligationPortfolio`,
 * `CashStage[]`, `PortfolioApprovals`, `ClauseRiskIntelligence`, a bancada de
 * marcos) — a duplicação de verdade de domínio é exatamente o que a camada de
 * confiança existe para impedir.
 *
 * ─── A regra que continua valendo ──────────────────────────────────────────
 *
 * O valor de um KPI é `Official<number>`. Ausência e falha são FORMAS
 * diferentes, não o número zero: uma consulta que não voltou vira "—" com
 * motivo, e nunca um `0` tranquilizador. Quem renderiza passa por
 * `ContractsKpiStrip`, que tem um único ponto onde ausência vira pixel.
 *
 * Sem React, sem I/O: roda em Node para os testes.
 */

import {
  derived, missing, live, failed,
  hasOfficialValue, isError,
  type Official,
} from './trusted';
import type { TrustedContract } from './read-model';
import type { TrustedPortfolioStats } from './portfolio';
import type { RenewalHorizon } from './renewal-horizon';
import type { PortfolioApprovals } from './approval-intelligence';
import type { PortfolioApprovalRequirements } from './approval-requirements';
import type { ClauseRiskIntelligence } from './clause-risk-intelligence';
import type { CashStage } from './contract-to-cash';
import type { ObligationPortfolio } from '../obligations/portfolio';
import type { SectionId } from '../portfolio-sections';
import type { BillingBacklog } from '../analytics/billing-backlog';
import type { RiskExposureBands } from '../analytics/risk-exposure-bands';

export type ContractKpiTone = 'default' | 'success' | 'warning' | 'danger' | 'info';

/** Como o número vira texto. `count` é inteiro; `currency` é BRL compacto. */
export type ContractKpiFormat = 'count' | 'currency' | 'percent';

/**
 * Para onde um KPI leva, quando leva a algum lugar.
 *
 * `section` navega para outra área da carteira; `filter` liga o recorte da
 * Executive Band que já existe. Nenhum KPI inventa uma navegação nova — os
 * dois caminhos são os que a página já opera.
 */
export type ContractKpiAction =
  | { readonly kind: 'section'; readonly section: SectionId }
  | { readonly kind: 'filter'; readonly filterId: string };

/**
 * A ÊNFASE DE DOMÍNIO da área a que o indicador pertence.
 *
 * Oito tiras com o mesmo desenho e rótulos diferentes leem como oito cópias da
 * mesma coisa — o olho aprende a pular a primeira dobra porque ela "já foi
 * vista". O acento não muda o sistema visual: escolhe o vocabulário de ícones,
 * decide se o número herda a cor do tom (status) ou fica metálico (dinheiro),
 * e diz o que a micro-barra mede naquela página.
 *
 * Mora aqui, e não no componente, porque é uma propriedade do INDICADOR: quem
 * define que "a vencer em 30 dias" é uma leitura de tempo é a área, não quem
 * desenha a célula.
 */
export type ContractKpiAccent =
  /** Renovações — janela, prazo, horizonte. */
  | 'time'
  /** Obrigações — SLA, estado da ocorrência. */
  | 'sla'
  /** Faturamentos — dinheiro e progressão na cadeia. */
  | 'money'
  /** Aprovações — decisão e alçada. */
  | 'governance'
  /** Riscos & Cláusulas — exposição e severidade. */
  | 'severity'
  /** Documentos — cobertura e versão. */
  | 'coverage'
  /** Contratos e Visão Geral — identidade e exposição da carteira. */
  | 'portfolio';

export type ContractKpi = {
  readonly id: string;
  readonly label: string;
  readonly value: Official<number>;
  readonly format: ContractKpiFormat;
  readonly tone?: ContractKpiTone;
  /** Linha de apoio: fonte, cobertura, ou o que falta apurar. */
  readonly hint?: string;
  readonly action?: ContractKpiAction;
  readonly accent: ContractKpiAccent;
  /**
   * Fração de 0 a 1 para a micro-barra da célula, e `null` quando o
   * denominador não foi apurado — caso em que nenhuma barra é desenhada.
   *
   * O que a fração MEDE muda por página, e é isso que faz a mesma peça servir
   * a sete domínios: em Faturamentos é a progressão sobre o contratado; em
   * Obrigações, a parcela da fila naquele estado; em Renovações, a parcela da
   * carteira naquela janela. `shareLabel` diz qual é o denominador, para que a
   * barra nunca dependa de o leitor adivinhar.
   */
  readonly share?: number | null;
  readonly shareLabel?: string;
};

/** Tudo que as oito áreas precisam. Cada uma lê só o que lhe diz respeito. */
export type SectionKpiInput = {
  readonly stats: TrustedPortfolioStats;
  /** O recorte VISÍVEL da carteira confiável (escopo + filtro de KPI). */
  readonly contracts: readonly TrustedContract[];
  readonly renewal: RenewalHorizon;
  readonly obligations: {
    readonly portfolio: ObligationPortfolio;
    readonly loading: boolean;
    readonly error: string | null;
  };
  readonly cash: readonly CashStage[];
  readonly backlog: BillingBacklog | null;
  /** `null` enquanto a bancada de marcos não chegou. */
  readonly backlogError: string | null;
  readonly approvals: PortfolioApprovals;
  readonly approvalRequirements: {
    readonly requirements: PortfolioApprovalRequirements['requirements'];
    readonly loading: boolean;
    readonly error: string | null;
  };
  readonly clauseRisk: ClauseRiskIntelligence;
  readonly riskBands: RiskExposureBands;
};

// ═══════════════════════════════════════════════════════════════════════════
// Auxiliares — todos preservam ausência
// ═══════════════════════════════════════════════════════════════════════════

/** Contagem apurada sobre uma lista já materializada. `0` aqui É apurado. */
const counted = (n: number, rule: string, from: Parameters<typeof derived>[1]['from']): Official<number> =>
  derived(n, { rule, from });

/**
 * Uma contagem que só existe quando a leitura assíncrona voltou.
 *
 * Enquanto carrega, o indicador é `missing` com motivo "ainda carregando" — e
 * não `0`, que seria lido como "não há nenhum" por quem chegou antes da
 * resposta. Falha vira `error`, com a mensagem da origem.
 */
function fromAsync(
  n: number,
  state: { loading: boolean; error: string | null },
  rule: string,
  from: Parameters<typeof derived>[1]['from'],
): Official<number> {
  if (state.error) return failed<number>(state.error);
  if (state.loading) return missing<number>('no-rows', 'leitura em andamento');
  return derived(n, { rule, from });
}

/** Soma que preserva ausência: `null` nunca vira zero. */
function sumOrMissing(
  values: readonly (number | null)[],
  rule: string,
  from: Parameters<typeof derived>[1]['from'],
  absentNote: string,
): Official<number> {
  const present = values.filter((v): v is number => v !== null);
  if (present.length === 0) return missing<number>('no-rows', absentNote);
  return derived(present.reduce((a, b) => a + b, 0), {
    rule, from, coverage: { counted: present.length, total: values.length },
  });
}

/** O estágio da cadeia contrato→caixa, pelo nome. */
const stageAmount = (stages: readonly CashStage[], key: CashStage['key']): Official<number> =>
  stages.find((s) => s.key === key)?.amount
  ?? missing<number>('no-rows', 'estágio não apurado na carteira');

/**
 * A guarda do RECORTE VAZIO.
 *
 * Sem contrato nenhum no recorte, uma métrica SOBRE os contratos não vale
 * zero — ela não tem sujeito. "0 requisitos governados", "0 riscos vinculados"
 * e "0 documentos válidos" sobre uma carteira vazia são três afirmações que
 * ninguém apurou, e as três soariam tranquilizadoras.
 *
 * A exceção é a contagem do PRÓPRIO sujeito: "Total de contratos: 0" é o
 * resultado de olhar, não a ausência de olhar, e continua sendo zero apurado.
 */
function ifPopulated(
  contracts: readonly TrustedContract[],
  value: Official<number>,
): Official<number> {
  if (contracts.length > 0) return value;
  return missing<number>('no-rows', 'nenhum contrato no recorte');
}

/**
 * Fração de um valor sobre um denominador, para a micro-barra da célula.
 *
 * `null` sempre que qualquer das pontas não foi apurada ou o denominador é
 * zero — a barra some, em vez de desenhar um traço de largura zero que se lê
 * como "quase nada" sobre um dado que ninguém tem.
 */
function shareOf(value: Official<number>, total: Official<number> | number | null): number | null {
  if (!hasOfficialValue(value)) return null;
  const denom = typeof total === 'number' ? total : total === null ? null
    : hasOfficialValue(total) ? total.value : null;
  if (denom === null || denom <= 0) return null;
  return Math.max(0, Math.min(value.value / denom, 1));
}

/** Tom por limiar, sem inventar cor para ausência. */
function toneWhenPositive(
  value: Official<number>,
  positive: ContractKpiTone,
  zero: ContractKpiTone = 'default',
): ContractKpiTone {
  if (!hasOfficialValue(value)) return 'default';
  return value.value > 0 ? positive : zero;
}

// ═══════════════════════════════════════════════════════════════════════════
// VISÃO GERAL — a leitura executiva da carteira inteira
// ═══════════════════════════════════════════════════════════════════════════

function overviewKpis(input: SectionKpiInput): ContractKpi[] {
  const { stats, backlog, obligations, renewal } = input;

  /*
    "Requer decisão" soma o que está PARADO esperando um humano: obrigação
    vencida e etapa de alçada fora do prazo. Não inclui o que o Apex ainda
    monitora — a torre de controle já separa as duas coisas, e repetir a
    separação aqui com outro nome faria dois números discordarem.
  */
  const requiresDecision: Official<number> = obligations.error
    ? failed<number>(obligations.error)
    : obligations.loading
      ? missing<number>('no-rows', 'leitura em andamento')
      : counted(
          obligations.portfolio.counts.OVERDUE + input.approvals.overdueCount,
          'obrigações vencidas somadas às etapas de alçada fora do prazo',
          ['contract_obligation_definitions', 'contract_approvals'],
        );

  const eligible = backlog?.segments.find((s) => s.key === 'eligible')?.amount ?? null;
  const blocked = backlog
    ? backlog.segments
        .filter((s) => s.key !== 'eligible' && s.key !== 'billed')
        .map((s) => s.amount)
    : [];

  const eligibleValue: Official<number> = input.backlogError
    ? failed<number>(input.backlogError)
    : backlog === null
      ? missing<number>('no-rows', 'bancada de marcos ainda não lida')
      : eligible === null
        ? missing<number>('no-rows', 'nenhum marco elegível com valor apurado')
        : derived(eligible, { rule: 'soma do direito dos marcos elegíveis para faturar', from: ['contract_milestones'] });

  const blockedValue: Official<number> = input.backlogError
    ? failed<number>(input.backlogError)
    : backlog === null
      ? missing<number>('no-rows', 'bancada de marcos ainda não lida')
      : sumOrMissing(blocked, 'soma do direito dos marcos que ainda não podem ser faturados',
          ['contract_milestones'], 'nenhum marco bloqueado com valor apurado');

  /** Renovações: janelas até 90 dias mais o que já venceu sem decisão. */
  const renewalsAhead = counted(
    renewal.bands
      .filter((b) => b.band === 'expired' || b.band === 30 || b.band === 60 || b.band === 90)
      .reduce((sum, b) => sum + b.count, 0),
    'contratos vencidos ou com decisão de renovação em até 90 dias',
    ['contracts'],
  );

  /**
   * Cobertura APURADA: que fração da carteira visível tem valor contratado
   * legível. É o indicador de confiança da própria tela — sem ele, a exposição
   * acima parece completa mesmo quando metade da carteira não foi lida.
   */
  const priced = input.contracts.filter((c) => hasOfficialValue(c.totalValue)).length;
  const coverage: Official<number> = input.contracts.length === 0
    ? missing<number>('no-rows', 'nenhum contrato no recorte')
    : input.contracts.some((c) => isError(c.totalValue))
      ? failed<number>('falha ao ler o valor de ao menos um contrato')
      : derived(priced / input.contracts.length, {
          rule: 'contratos com valor contratado apurado sobre o total do recorte',
          from: ['contracts'],
          coverage: { counted: priced, total: input.contracts.length },
        });

  const active = live(
    input.contracts.filter((c) => c.status === 'active').length,
    'contracts',
  );

  /*
    ─── "EXPOSIÇÃO CONTRATADA" NÃO ENTRA AQUI ───────────────────────────────

    O herói financeiro, imediatamente acima desta tira, ABRE com esse número em
    tipografia de destaque — e ainda traz faturado, backlog e execução. Repeti-lo
    na primeira célula da tira punha o mesmo fato duas vezes na mesma dobra, a
    poucos pixels de distância, e o leitor gasta uma leitura conferindo se os
    dois números batem em vez de seguir adiante.

    Cinco indicadores é o conjunto certo, e não um conjunto incompleto: o sexto
    lugar não é preenchido com métrica de enchimento só para fechar a grade.
  */
  return [
    {
      id: 'overview-active',
      label: 'Contratos ativos',
      value: active,
      format: 'count',
      tone: 'default',
      accent: 'portfolio',
      // Distinto do "N contratos operacionais" do herói, que conta ORIGEM
      // validada; aqui a pergunta é sobre o estado do instrumento.
      hint: `de ${input.contracts.length} no recorte · status do instrumento`,
      share: shareOf(active, input.contracts.length),
      shareLabel: 'do recorte',
      action: { kind: 'section', section: 'contracts' },
    },
    {
      id: 'overview-decision',
      label: 'Requer decisão',
      value: requiresDecision,
      format: 'count',
      tone: toneWhenPositive(requiresDecision, 'danger', 'success'),
      accent: 'portfolio',
      hint: 'Obrigações vencidas e alçadas fora do prazo',
      action: { kind: 'section', section: 'obligations' },
    },
    {
      id: 'overview-eligible',
      label: 'Faturamento elegível',
      value: eligibleValue,
      format: 'currency',
      tone: 'success',
      accent: 'portfolio',
      hint: hasOfficialValue(blockedValue)
        ? `bloqueado: ${Math.round(blockedValue.value).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', notation: 'compact', maximumFractionDigits: 1 })}`
        : 'bloqueado não apurado',
      share: shareOf(eligibleValue, backlog?.base ?? null),
      shareLabel: 'do direito previsto',
      action: { kind: 'section', section: 'faturamento' },
    },
    {
      id: 'overview-renewals',
      label: 'Renovações no horizonte',
      value: renewalsAhead,
      format: 'count',
      tone: toneWhenPositive(renewalsAhead, 'warning', 'success'),
      accent: 'portfolio',
      hint: 'Vencidos e decisões em até 90 dias',
      share: shareOf(renewalsAhead, renewal.entries.length),
      shareLabel: 'da carteira datada',
      action: { kind: 'section', section: 'renewals' },
    },
    {
      /*
        "Cobertura DE VALOR", e não "Cobertura apurada".

        O herói já tem uma célula chamada "Cobertura", que mede outra coisa:
        dimensões de saúde apuradas por contrato. Duas células vizinhas com o
        mesmo nome medindo denominadores diferentes é pior que duplicação —
        é ambiguidade. O nome agora diz qual eixo está sendo coberto.
      */
      id: 'overview-coverage',
      label: 'Cobertura de valor',
      value: coverage,
      format: 'percent',
      tone: hasOfficialValue(coverage)
        ? (coverage.value >= 0.9 ? 'success' : coverage.value >= 0.5 ? 'warning' : 'danger')
        : 'default',
      accent: 'portfolio',
      hint: 'Contratos com valor contratado legível',
      share: hasOfficialValue(coverage) ? coverage.value : null,
      shareLabel: 'do recorte',
    },
  ];
}

// ═══════════════════════════════════════════════════════════════════════════
// CONTRATOS — o inventário
// ═══════════════════════════════════════════════════════════════════════════

function contractsKpis(input: SectionKpiInput): ContractKpi[] {
  const { stats, contracts } = input;

  const signed = live(
    contracts.filter((c) => c.status === 'active' || c.status === 'signed').length,
    'contracts',
  );

  return [
    {
      id: 'contracts-total',
      label: 'Total de contratos',
      value: live(contracts.length, 'contracts'),
      format: 'count',
      tone: 'info',
      accent: 'portfolio',
      hint: stats.scope.total === contracts.length
        ? 'todos no recorte atual'
        : `${contracts.length} no recorte · ${stats.scope.total} na base`,
    },
    {
      id: 'contracts-exposure',
      label: 'Exposição contratada',
      value: stats.totalValue,
      format: 'currency',
      accent: 'portfolio',
      hint: 'Carteira oficial — não muda com o recorte',
    },
    {
      id: 'contracts-signed',
      label: 'Assinados / ativos',
      value: signed,
      format: 'count',
      tone: 'success',
      accent: 'portfolio',
      hint: 'Status registrado no instrumento',
      share: shareOf(signed, contracts.length),
      shareLabel: 'do recorte',
    },
    {
      id: 'contracts-high-risk',
      label: 'Alto risco',
      value: stats.highRisk,
      format: 'count',
      tone: toneWhenPositive(stats.highRisk, 'danger'),
      accent: 'portfolio',
      // O escopo fica DITO, como na exposição ao lado: nesta área as duas
      // métricas oficiais convivem com contagens de recorte, e um número sem
      // escopo declarado ao lado de outro com escopo diferente é armadilha.
      hint: 'Classificação registrada · carteira oficial',
      share: shareOf(stats.highRisk, stats.contractCount),
      shareLabel: 'da carteira oficial',
      action: { kind: 'filter', filterId: 'alto_risco' },
    },
    {
      id: 'contracts-no-project',
      label: 'Sem projeto vinculado',
      value: stats.contractsWithoutProject,
      format: 'count',
      tone: toneWhenPositive(stats.contractsWithoutProject, 'warning'),
      accent: 'portfolio',
      hint: 'Vínculo real — auto-match não conta',
      share: shareOf(stats.contractsWithoutProject, stats.contractCount),
      shareLabel: 'da carteira oficial',
    },
    {
      id: 'contracts-no-billing',
      label: 'Sem faturamento registrado',
      value: stats.contractsWithoutBilling,
      format: 'count',
      tone: toneWhenPositive(stats.contractsWithoutBilling, 'warning'),
      accent: 'portfolio',
      hint: 'Nenhum evento de faturamento na origem',
      share: shareOf(stats.contractsWithoutBilling, stats.contractCount),
      shareLabel: 'da carteira oficial',
      action: { kind: 'section', section: 'faturamento' },
    },
  ];
}

// ═══════════════════════════════════════════════════════════════════════════
// RENOVAÇÕES — as janelas de decisão
// ═══════════════════════════════════════════════════════════════════════════

function renewalKpis(input: SectionKpiInput): ContractKpi[] {
  const { renewal } = input;
  const band = (key: RenewalHorizon['bands'][number]['band']) =>
    renewal.bands.find((b) => b.band === key);

  const within30 = band(30)?.count ?? 0;
  const within60 = band(60)?.count ?? 0;
  const within90 = band(90)?.count ?? 0;
  const expired = band('expired');

  /*
    "Valor em renovação" soma APENAS as janelas até 90 dias, e apenas os
    contratos daquelas janelas cujo valor foi apurado. `exposure` já vem `null`
    quando nenhum contrato da faixa tem valor — somar zeros ali afirmaria que a
    faixa não vale nada.
  */
  const renewalValue = sumOrMissing(
    [band(30)?.exposure ?? null, band(60)?.exposure ?? null, band(90)?.exposure ?? null],
    'exposição dos contratos com decisão de renovação em até 90 dias',
    ['contracts'],
    'nenhum contrato em renovação com valor apurado',
  );

  /**
   * "Decisões pendentes" é contagem de CONTRATO, não de janela: um contrato
   * vencido sem decisão registrada e outro a 12 dias são duas decisões, e
   * somar as faixas já produz exatamente isso.
   */
  const pending = counted(
    (expired?.count ?? 0) + within30 + within60 + within90,
    'contratos vencidos ou com janela de decisão em até 90 dias',
    ['contracts'],
  );

  const undated = renewal.undatedContracts.length;
  /*
    O denominador das janelas é a CARTEIRA DATADA, não o recorte inteiro:
    contrato sem vigência registrada não está em janela nenhuma, e incluí-lo no
    divisor faria toda janela parecer menor do que é.
  */
  const dated = renewal.entries.length;
  const w30 = counted(within30, 'contratos na janela de 30 dias', ['contracts']);
  const w60 = counted(within60, 'contratos na janela de 31 a 60 dias', ['contracts']);
  const w90 = counted(within90, 'contratos na janela de 61 a 90 dias', ['contracts']);
  const expiredCount = counted(expired?.count ?? 0, 'contratos com a data de decisão no passado', ['contracts']);

  return [
    {
      id: 'renewals-30',
      label: 'A vencer em 30 dias',
      value: w30,
      format: 'count',
      tone: within30 > 0 ? 'danger' : 'success',
      accent: 'time',
      hint: undated > 0 ? `${undated} sem data de vigência` : 'renewal_date, ou end_date na falta dela',
      share: shareOf(w30, dated),
      shareLabel: 'da carteira datada',
    },
    {
      id: 'renewals-60',
      label: 'A vencer em 60 dias',
      value: w60,
      format: 'count',
      tone: within60 > 0 ? 'warning' : 'default',
      accent: 'time',
      hint: 'Janela de 31 a 60 dias',
      share: shareOf(w60, dated),
      shareLabel: 'da carteira datada',
    },
    {
      id: 'renewals-90',
      label: 'A vencer em 90 dias',
      value: w90,
      format: 'count',
      tone: within90 > 0 ? 'warning' : 'default',
      accent: 'time',
      hint: 'Janela de 61 a 90 dias',
      share: shareOf(w90, dated),
      shareLabel: 'da carteira datada',
    },
    {
      id: 'renewals-value',
      label: 'Valor em renovação',
      value: renewalValue,
      format: 'currency',
      tone: 'info',
      accent: 'time',
      hint: 'Exposição das janelas de até 90 dias',
    },
    {
      id: 'renewals-expired',
      label: 'Renovações vencidas',
      value: expiredCount,
      format: 'count',
      tone: (expired?.count ?? 0) > 0 ? 'danger' : 'success',
      accent: 'time',
      hint: 'A data passou e nada foi registrado',
      share: shareOf(expiredCount, dated),
      shareLabel: 'da carteira datada',
    },
    {
      id: 'renewals-pending',
      label: 'Decisões pendentes',
      value: pending,
      format: 'count',
      tone: toneWhenPositive(pending, 'warning', 'success'),
      accent: 'time',
      hint: `cobertura ${renewal.coverage.counted}/${renewal.coverage.total}`,
      share: shareOf(pending, dated),
      shareLabel: 'da carteira datada',
    },
  ];
}

// ═══════════════════════════════════════════════════════════════════════════
// OBRIGAÇÕES — o modelo canônico da Fase 3
// ═══════════════════════════════════════════════════════════════════════════

function obligationKpis(input: SectionKpiInput): ContractKpi[] {
  const { obligations } = input;
  const { counts, rows } = obligations.portfolio;
  const state = { loading: obligations.loading, error: obligations.error };
  const from: Parameters<typeof derived>[1]['from'] = ['contract_obligation_definitions'];

  const overdue = fromAsync(counts.OVERDUE, state, 'ocorrências com o prazo vencido', from);
  const dueToday = fromAsync(counts.DUE, state, 'ocorrências que vencem na data de referência', from);
  const onTrack = fromAsync(counts.UPCOMING, state, 'ocorrências ativas com prazo futuro', from);
  /*
    `UNKNOWN` e `AWAITING_SCHEDULE_ANCHOR` NÃO se somam. O primeiro é lacuna de
    dado — alguém precisa agir; o segundo é o Apex esperando Projetos agendar,
    e não é trabalho de ninguém aqui. Somá-los pediria trabalho onde não há.
  */
  const undated = fromAsync(counts.UNKNOWN, state, 'ocorrências sem prazo apurado', from);
  const noEvidence = fromAsync(
    rows.filter((r) => r.evidenceComplete === 'FALSE').length,
    state,
    'ocorrências cuja evidência exigida ainda não está completa',
    from,
  );
  const closed = fromAsync(
    counts.NOT_APPLICABLE,
    state,
    'ocorrências cumpridas, dispensadas ou canceladas',
    from,
  );

  /** A fila inteira é o denominador do SLA: cada estado é uma parcela dela. */
  const queue = rows.length;

  return [
    {
      id: 'obligations-overdue',
      label: 'Em atraso',
      value: overdue,
      format: 'count',
      tone: toneWhenPositive(overdue, 'danger', 'success'),
      accent: 'sla',
      hint: 'O prazo passou e nada foi registrado',
      share: shareOf(overdue, queue),
      shareLabel: 'da fila',
    },
    {
      id: 'obligations-due',
      label: 'Vence hoje',
      value: dueToday,
      format: 'count',
      tone: toneWhenPositive(dueToday, 'warning'),
      accent: 'sla',
      hint: obligations.portfolio.asOf ? `referência ${obligations.portfolio.asOf.slice(0, 10)}` : undefined,
      share: shareOf(dueToday, queue),
      shareLabel: 'da fila',
    },
    {
      id: 'obligations-on-track',
      label: 'No prazo',
      value: onTrack,
      format: 'count',
      tone: 'success',
      accent: 'sla',
      hint: 'Exigências ativas com prazo por vir',
      share: shareOf(onTrack, queue),
      shareLabel: 'da fila',
    },
    {
      id: 'obligations-unknown',
      label: 'Prazo não apurado',
      value: undated,
      format: 'count',
      tone: toneWhenPositive(undated, 'warning'),
      accent: 'sla',
      hint: `${counts.AWAITING_SCHEDULE_ANCHOR} aguardando agenda de Projetos`,
      share: shareOf(undated, queue),
      shareLabel: 'da fila',
    },
    {
      id: 'obligations-no-evidence',
      label: 'Sem evidência',
      value: noEvidence,
      format: 'count',
      tone: toneWhenPositive(noEvidence, 'warning'),
      accent: 'sla',
      hint: 'Evidência exigida e ainda não completa',
      share: shareOf(noEvidence, queue),
      shareLabel: 'da fila',
    },
    {
      id: 'obligations-closed',
      label: 'Encerradas',
      value: closed,
      format: 'count',
      tone: 'default',
      accent: 'sla',
      hint: 'Cumpridas, dispensadas ou canceladas',
      share: shareOf(closed, queue),
      shareLabel: 'da fila',
    },
  ];
}

// ═══════════════════════════════════════════════════════════════════════════
// FATURAMENTOS — a cadeia contrato → caixa
// ═══════════════════════════════════════════════════════════════════════════

function billingKpis(input: SectionKpiInput): ContractKpi[] {
  const { cash, backlog, backlogError } = input;

  const contracted = stageAmount(cash, 'contracted');
  const billed = stageAmount(cash, 'billed');

  /** Saldo: só existe quando AS DUAS pontas existem. */
  const backlogValue: Official<number> =
    hasOfficialValue(contracted) && hasOfficialValue(billed)
      ? derived(Math.max(contracted.value - billed.value, 0), {
          rule: 'valor contratado menos o faturado',
          from: ['contracts', 'contract_billing_events'],
        })
      : isError(contracted) ? contracted
        : isError(billed) ? billed
          : missing<number>('no-rows', 'uma das pontas da subtração não foi apurada');

  const eligibleSegment = backlog?.segments.find((s) => s.key === 'eligible');
  const eligibleCount: Official<number> = backlogError
    ? failed<number>(backlogError)
    : backlog === null
      ? missing<number>('no-rows', 'bancada de marcos ainda não lida')
      : ifPopulated(
          input.contracts,
          counted(eligibleSegment?.count ?? 0, 'marcos em estágio elegível para faturar', ['contract_milestones']),
        );

  const measured = stageAmount(cash, 'measured');
  const approved = stageAmount(cash, 'approved');

  /*
    A micro-barra desta página mede PROGRESSÃO SOBRE O CONTRATADO — é a leitura
    monetária que a área existe para dar. Onde o contratado não foi apurado, ou
    o próprio estágio não foi, a barra some: uma barra vazia ao lado de "Não
    apurado" seria lida como "0% executado".
  */
  return [
    {
      id: 'billing-contracted',
      label: 'Valor contratado',
      value: contracted,
      format: 'currency',
      tone: 'info',
      accent: 'money',
      hint: 'Cabeçalho dos instrumentos do recorte',
      share: hasOfficialValue(contracted) ? 1 : null,
      shareLabel: 'base da cadeia',
    },
    {
      id: 'billing-measured',
      label: 'Valor medido',
      value: measured,
      format: 'currency',
      accent: 'money',
      hint: 'Medição apurada — o previsto em contrato não conta',
      share: shareOf(measured, contracted),
      shareLabel: 'do contratado',
    },
    {
      id: 'billing-approved',
      label: 'Valor aprovado',
      value: approved,
      format: 'currency',
      accent: 'money',
      hint: 'Aceito por autoridade — não é o medido',
      share: shareOf(approved, contracted),
      shareLabel: 'do contratado',
    },
    {
      id: 'billing-billed',
      label: 'Valor faturado',
      value: billed,
      format: 'currency',
      tone: 'success',
      accent: 'money',
      hint: 'Eventos de faturamento realizados',
      share: shareOf(billed, contracted),
      shareLabel: 'do contratado',
    },
    {
      id: 'billing-backlog',
      label: 'Saldo a faturar',
      value: backlogValue,
      format: 'currency',
      tone: 'warning',
      accent: 'money',
      hint: 'Contratado menos faturado',
      share: shareOf(backlogValue, contracted),
      shareLabel: 'do contratado',
    },
    {
      id: 'billing-eligible-count',
      label: 'Marcos elegíveis',
      value: eligibleCount,
      format: 'count',
      tone: toneWhenPositive(eligibleCount, 'success'),
      accent: 'money',
      hint: 'Sem bloqueio de medição, evidência ou aceite',
      share: shareOf(eligibleCount, backlog?.totalMilestones ?? null),
      shareLabel: 'dos marcos',
    },
  ];
}

// ═══════════════════════════════════════════════════════════════════════════
// APROVAÇÕES — exigência governada e alçada
// ═══════════════════════════════════════════════════════════════════════════

function approvalKpis(input: SectionKpiInput): ContractKpi[] {
  const { approvals, approvalRequirements, contracts } = input;
  const reqState = { loading: approvalRequirements.loading, error: approvalRequirements.error };
  const reqs = approvalRequirements.requirements;
  const from: Parameters<typeof derived>[1]['from'] = ['contract_approvals', 'contract_billing_conditions'];

  const scoped = (v: Official<number>) => ifPopulated(contracts, v);

  const governed = scoped(fromAsync(reqs.length, reqState, 'exigências de aprovação lidas do contrato', from));
  const pendingConfig = scoped(fromAsync(
    reqs.filter((r) => r.state === 'pending_configuration').length,
    reqState, 'exigências sem rota de decisão configurada', from,
  ));
  const awaiting = scoped(fromAsync(
    reqs.filter((r) => r.state === 'awaiting_decision').length,
    reqState, 'exigências aguardando decisão', from,
  ));
  const contractsWithRequirement = scoped(fromAsync(
    new Set(reqs.map((r) => r.contractId)).size,
    reqState, 'contratos com ao menos uma exigência ativa', from,
  ));

  const overdue = scoped(counted(approvals.overdueCount, 'etapas de alçada abertas além do prazo', ['contract_approvals']));
  /*
    "No prazo" é etapa ABERTA dentro do prazo. Não inclui etapa concluída: a
    pergunta é "quantas decisões estão em dia agora", não "quantas já foram".
  */
  const onTime = scoped(counted(
    approvals.rows.reduce(
      (sum, row) => sum + row.intelligence.steps.filter((s) => s.isOpen && (s.overdueDays ?? 0) <= 0).length,
      0,
    ),
    'etapas de alçada abertas e dentro do prazo',
    ['contract_approvals'],
  ));

  /** Denominadores da governança: a fila de exigências e as etapas abertas. */
  const openSteps = (hasOfficialValue(overdue) ? overdue.value : 0)
    + (hasOfficialValue(onTime) ? onTime.value : 0);

  return [
    {
      id: 'approvals-governed',
      label: 'Requisitos governados',
      value: governed,
      format: 'count',
      tone: 'info',
      accent: 'governance',
      hint: `${contracts.length} contrato(s) no recorte`,
    },
    {
      id: 'approvals-pending-config',
      label: 'Configuração pendente',
      value: pendingConfig,
      format: 'count',
      tone: toneWhenPositive(pendingConfig, 'warning'),
      accent: 'governance',
      hint: 'O contrato exige; a rota não existe',
      share: shareOf(pendingConfig, governed),
      shareLabel: 'das exigências',
    },
    {
      id: 'approvals-awaiting',
      label: 'Aguardando decisão',
      value: awaiting,
      format: 'count',
      tone: toneWhenPositive(awaiting, 'warning'),
      accent: 'governance',
      hint: 'Há rota e alguém precisa decidir',
      share: shareOf(awaiting, governed),
      shareLabel: 'das exigências',
    },
    {
      id: 'approvals-overdue',
      label: 'Vencidas',
      value: overdue,
      format: 'count',
      tone: toneWhenPositive(overdue, 'danger', 'success'),
      accent: 'governance',
      hint: approvals.withoutRoute.length > 0
        ? `${approvals.withoutRoute.length} contrato(s) sem rota de alçada`
        : 'Etapas abertas além do prazo',
      share: shareOf(overdue, openSteps),
      shareLabel: 'das etapas abertas',
    },
    {
      id: 'approvals-on-time',
      label: 'No prazo',
      value: onTime,
      format: 'count',
      tone: 'success',
      accent: 'governance',
      hint: 'Etapas abertas dentro do prazo',
      share: shareOf(onTime, openSteps),
      shareLabel: 'das etapas abertas',
    },
    {
      id: 'approvals-contracts',
      label: 'Contratos com exigência ativa',
      value: contractsWithRequirement,
      format: 'count',
      tone: 'default',
      accent: 'governance',
      hint: 'Exigência lida do próprio instrumento',
      share: shareOf(contractsWithRequirement, contracts.length),
      shareLabel: 'do recorte',
    },
  ];
}

// ═══════════════════════════════════════════════════════════════════════════
// RISCOS & CLÁUSULAS
// ═══════════════════════════════════════════════════════════════════════════

function riskKpis(input: SectionKpiInput): ContractKpi[] {
  const { clauseRisk, stats, riskBands } = input;

  const scoped = (v: Official<number>) => ifPopulated(input.contracts, v);

  const monitoredClauses = scoped(counted(
    clauseRisk.clauses.length, 'cláusulas extraídas e monitoradas', ['contract_clauses'],
  ));
  const penalties = scoped(counted(
    clauseRisk.penalties.length, 'penalidades identificadas no instrumento', ['contract_penalties'],
  ));
  const attention = scoped(counted(
    clauseRisk.attentionCount,
    'interpretações operacionais que exigem decisão',
    ['contract_operational_interpretations'],
  ));
  const linkedRisks = clauseRisk.erroredContracts.length > 0
    ? failed<number>('falha ao ler os vínculos de risco de ao menos um contrato')
    : scoped(counted(clauseRisk.risks.length, 'riscos vinculados a contratos do recorte', ['contract_risks_links']));

  /**
   * A exposição por risco vem do MESMO agregador do gráfico — a banda e o
   * gráfico não podem discordar. `highRiskExposure` de `stats` é a carteira
   * oficial inteira; aqui a pergunta é sobre o recorte visível.
   */
  const highBand = riskBands.bands.find((b) => b.key === 'high');
  /** Contagem do recorte — a mesma base do mapa de risco e da exposição. */
  const highBandCount = counted(
    highBand?.count ?? 0,
    'contratos classificados como risco alto no recorte',
    ['contracts'],
  );
  const riskExposure: Official<number> = highBand?.exposure === null || highBand === undefined
    ? missing<number>('no-rows', 'nenhum contrato de risco alto com valor apurado')
    : derived(highBand.exposure, {
        rule: 'soma do valor dos contratos classificados como risco alto',
        from: ['contracts'],
        coverage: { counted: highBand.pricedCount, total: highBand.count },
      });

  return [
    {
      id: 'risks-linked',
      label: 'Riscos vinculados',
      value: linkedRisks,
      format: 'count',
      tone: toneWhenPositive(linkedRisks, 'warning'),
      accent: 'severity',
      hint: 'Registros do módulo Riscos ligados a contrato',
    },
    {
      /*
        ─── O MESMO RECORTE DO MAPA LOGO ABAIXO ──────────────────────────

        Este indicador lia `stats.highRisk`, que conta só a CARTEIRA OFICIAL,
        enquanto o mapa de risco e a exposição desta mesma página contam o
        RECORTE visível. Num escopo de demonstração a tela mostrava, a dois
        centímetros de distância, "Contratos alto risco: 0" e um mapa com
        "Alto: 1" — dois números sobre o mesmo fato, ambos corretos nas suas
        definições, e impossíveis de conciliar por quem está lendo.

        A métrica oficial da empresa continua protegida onde ela é a pergunta:
        na Executive Band e no PDF. Aqui a pergunta é sobre o que está na tela.
      */
      id: 'risks-high-contracts',
      label: 'Contratos alto risco',
      value: highBandCount,
      format: 'count',
      tone: toneWhenPositive(highBandCount, 'danger'),
      accent: 'severity',
      hint: 'Classificação registrada no instrumento, no recorte atual',
      share: shareOf(highBandCount, riskBands.contractCount),
      shareLabel: 'do recorte',
    },
    {
      id: 'risks-clauses',
      label: 'Cláusulas monitoradas',
      value: monitoredClauses,
      format: 'count',
      tone: 'info',
      accent: 'severity',
      hint: 'Texto extraído com proveniência de página',
    },
    {
      id: 'risks-penalties',
      label: 'Penalidades identificadas',
      value: penalties,
      format: 'count',
      tone: toneWhenPositive(penalties, 'warning'),
      accent: 'severity',
      hint: 'Multa, retenção ou rescisão previstas',
    },
    {
      id: 'risks-attention',
      label: 'Interpretações requerendo atenção',
      value: attention,
      format: 'count',
      tone: toneWhenPositive(attention, 'danger'),
      accent: 'severity',
      hint: 'Exposição material, ambiguidade ou alçada',
      share: shareOf(attention, clauseRisk.pendingProposals.length || null),
      shareLabel: 'da fila de interpretações',
    },
    {
      /*
        A barra aqui mede CONCENTRAÇÃO: que fatia da exposição apurada está em
        contratos de risco alto. É a leitura de severidade da página — um valor
        absoluto grande numa carteira grande significa outra coisa que o mesmo
        valor numa carteira pequena.
      */
      id: 'risks-exposure',
      label: 'Exposição financeira por risco',
      value: riskExposure,
      format: 'currency',
      tone: 'danger',
      accent: 'severity',
      hint: 'Valor dos contratos de risco alto no recorte',
      share: shareOf(riskExposure, riskBands.total),
      shareLabel: 'da exposição apurada',
    },
  ];
}

// ═══════════════════════════════════════════════════════════════════════════
// DOCUMENTOS — o acervo e sua linhagem
// ═══════════════════════════════════════════════════════════════════════════

function documentKpis(input: SectionKpiInput): ContractKpi[] {
  const { contracts } = input;

  /*
    O acervo de cada contrato, já estreitado. `filter(hasOfficialValue)` não
    estreita o CAMPO de um objeto — o compilador continua vendo `Official<…>`
    em `c.documents` — então a leitura é materializada uma vez aqui, e o resto
    da função trabalha sobre `readable`, onde a lista existe de fato.
  */
  const readable = contracts.flatMap((c) =>
    (hasOfficialValue(c.documents) ? [{ id: c.id, docs: c.documents.value }] : []));
  const anyError = contracts.some((c) => isError(c.documents));
  const docs = readable.flatMap((c) => c.docs);

  const wrap = (n: number, rule: string): Official<number> => {
    if (anyError) return failed<number>('falha ao ler o acervo de ao menos um contrato');
    /*
      RECORTE VAZIO não produz zero.

      Com nenhum contrato no recorte, `derived(0)` afirmava "zero documentos
      válidos", "zero pendentes", "zero contratos sem instrumento" — seis zeros
      tranquilizadores sobre uma carteira que ninguém sequer olhou, porque não
      havia o que olhar. A ausência de sujeito não é uma resposta sobre ele.
    */
    if (contracts.length === 0) {
      return missing<number>('no-rows', 'nenhum contrato no recorte');
    }
    if (readable.length === 0) {
      return missing<number>('no-rows', 'nenhum contrato com o acervo apurado');
    }
    return derived(n, {
      rule, from: ['contract_documents'],
      coverage: { counted: readable.length, total: contracts.length },
    });
  };

  /** Vigente = aprovado e não substituído. Substituído nunca conta como válido. */
  const current = docs.filter((d) => !d.superseded_by_document_id);
  const valid = wrap(current.filter((d) => d.status === 'approved').length, 'documentos vigentes e aprovados');
  const pending = wrap(
    current.filter((d) => d.status === 'pending_approval' || d.status === 'uploaded').length,
    'documentos vigentes ainda sem aprovação',
  );
  const superseded = wrap(docs.filter((d) => d.superseded_by_document_id).length, 'versões substituídas por uma posterior');
  const awaitingApproval = wrap(
    current.filter((d) => d.status === 'pending_approval').length,
    'documentos enviados para aprovação e ainda não decididos',
  );

  /** Contrato sem o instrumento principal no acervo — lacuna de controle. */
  const withoutPrimary = anyError
    ? failed<number>('falha ao ler o acervo de ao menos um contrato')
    : contracts.length === 0
      ? missing<number>('no-rows', 'nenhum contrato no recorte')
      : derived(
        readable.filter((c) => !c.docs.some(
          (d) => d.document_type === 'contract' && !d.superseded_by_document_id,
        )).length,
        {
          rule: 'contratos sem documento do tipo "contract" vigente',
          from: ['contract_documents'],
          coverage: { counted: readable.length, total: contracts.length },
        },
      );

  const coverage: Official<number> = contracts.length === 0
    ? missing<number>('no-rows', 'nenhum contrato no recorte')
    : anyError
      ? failed<number>('falha ao ler o acervo de ao menos um contrato')
      : derived(
          readable.filter((c) => c.docs.length > 0).length / contracts.length,
          {
            rule: 'contratos com ao menos um documento no acervo, sobre o recorte',
            from: ['contract_documents'],
            coverage: { counted: readable.length, total: contracts.length },
          },
        );

  /** O acervo vigente é o denominador da cobertura documental. */
  const currentTotal = current.length;

  return [
    {
      id: 'documents-valid',
      label: 'Documentos válidos',
      value: valid,
      format: 'count',
      tone: 'success',
      accent: 'coverage',
      hint: 'Vigentes e aprovados',
      share: shareOf(valid, currentTotal),
      shareLabel: 'do acervo vigente',
    },
    {
      id: 'documents-pending',
      label: 'Pendentes',
      value: pending,
      format: 'count',
      tone: toneWhenPositive(pending, 'warning'),
      accent: 'coverage',
      share: shareOf(pending, currentTotal),
      shareLabel: 'do acervo vigente',
      /*
        A linha de apoio fala do indicador QUE ESTÁ ACIMA dela.

        Aqui ela vinha de `stats.pendingDocuments` — a contagem da carteira
        OFICIAL — enquanto o número exibido é o do RECORTE visível. Um "0" com
        a legenda "carteira oficial não apurada" faz o leitor atribuir a
        ausência ao número que está vendo, que foi apurado. Emprestar
        proveniência de outro agregado é a forma silenciosa de duas verdades
        virarem uma só.
      */
      hint: 'Vigentes, enviados ou aguardando decisão',
    },
    {
      id: 'documents-superseded',
      label: 'Versões substituídas',
      value: superseded,
      format: 'count',
      tone: 'default',
      accent: 'coverage',
      hint: 'Linhagem preservada — não são exclusões',
      share: shareOf(superseded, docs.length),
      shareLabel: 'do acervo total',
    },
    {
      id: 'documents-without-primary',
      label: 'Contratos sem documento principal',
      value: withoutPrimary,
      format: 'count',
      tone: toneWhenPositive(withoutPrimary, 'danger'),
      accent: 'coverage',
      hint: 'Nenhum instrumento vigente no acervo',
      share: shareOf(withoutPrimary, contracts.length),
      shareLabel: 'do recorte',
    },
    {
      id: 'documents-awaiting-approval',
      label: 'Aprovações documentais pendentes',
      value: awaitingApproval,
      format: 'count',
      tone: toneWhenPositive(awaitingApproval, 'warning'),
      accent: 'coverage',
      hint: 'Enviados e ainda não decididos',
      share: shareOf(awaitingApproval, currentTotal),
      shareLabel: 'do acervo vigente',
    },
    {
      id: 'documents-coverage',
      label: 'Cobertura documental',
      value: coverage,
      format: 'percent',
      tone: hasOfficialValue(coverage)
        ? (coverage.value >= 0.9 ? 'success' : coverage.value >= 0.5 ? 'warning' : 'danger')
        : 'default',
      accent: 'coverage',
      hint: 'Contratos com ao menos um documento',
      share: hasOfficialValue(coverage) ? coverage.value : null,
      shareLabel: 'do recorte',
    },
  ];
}

// ═══════════════════════════════════════════════════════════════════════════

const BUILDERS: Record<SectionId, (input: SectionKpiInput) => ContractKpi[]> = {
  overview: overviewKpis,
  contracts: contractsKpis,
  renewals: renewalKpis,
  obligations: obligationKpis,
  faturamento: billingKpis,
  aprovacoes: approvalKpis,
  risks: riskKpis,
  documents: documentKpis,
};

/**
 * Os indicadores de UMA área. Máximo de seis por área, por desenho: a sétima
 * célula de uma tira executiva nunca é lida, e a primeira perde peso.
 *
 * O tom de um indicador SEM valor é neutralizado aqui, e não no renderizador.
 * Cor é afirmação sobre o número — "No prazo" nasce verde porque estar no
 * prazo é bom, mas um "—" verde afirma que a AUSÊNCIA é boa, e um "—" vermelho
 * alarma sobre o que ninguém leu. Fazer isso num único lugar impede que uma
 * segunda superfície (um PDF, um card) reintroduza o problema por esquecimento.
 */
export function buildSectionKpis(section: SectionId, input: SectionKpiInput): ContractKpi[] {
  return BUILDERS[section](input)
    .slice(0, 6)
    .map((kpi) => (hasOfficialValue(kpi.value) ? kpi : { ...kpi, tone: 'default' as const }));
}
