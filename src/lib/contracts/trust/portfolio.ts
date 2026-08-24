/**
 * Agregação de carteira sobre o read model confiável.
 *
 * Espelha `ContractPortfolioStats` (o agregador legado), mas cada indicador é
 * `Official<number>` em vez de `number`. A diferença prática: onde o legado
 * devolvia `0` — indistinguível de zero apurado — este devolve `missing` com
 * motivo, e onde a leitura falhou devolve `error` em vez de silêncio.
 *
 * É a única fonte de números da Executive Band e dos dois PDFs.
 */

import {
  live, derived, missing, sumTrusted, ratioTrusted,
  hasOfficialValue, isError, officialByOrigin, isOfficialOrigin,
  type Official,
} from './trusted';
import type { TrustedContract } from './read-model';

/**
 * A FRONTEIRA da carteira oficial.
 *
 * Toda métrica abaixo passa por aqui. Um contrato cuja origem não foi validada
 * — demonstração ou não classificado — tem seus indicadores convertidos em
 * `missing` com o motivo correspondente ANTES de qualquer soma. O valor não é
 * ignorado em silêncio: ele vira uma ausência declarada, e a cobertura de
 * `sumTrusted` registra que aquele contrato não contribuiu.
 *
 * É por isso que a Executive Band passou a mostrar R$ 40 mil onde mostrava
 * R$ 1,5M: R$ 1,46M vinham de linhas que ninguém validou como operacionais.
 */
/**
 * Motivo da ausência quando a carteira oficial está VAZIA porque tudo foi
 * excluído por origem.
 *
 * Sem isto, `sumTrusted([])` devolveria `no-rows` — "não há registro" —, que é
 * falso: os registros existem, e o que não existe é validação de origem. A
 * distinção muda a ação do usuário: "não há contrato" leva a cadastrar, "nenhum
 * contrato validado" leva a classificar.
 */
function emptyOfficialReason(all: readonly TrustedContract[]): Official<number> | null {
  if (all.length === 0) return null;
  const classes = new Set(all.map((c) => c.dataClass));
  if (classes.size === 1 && classes.has('demo')) {
    return { trust: 'missing', reason: 'demo-excluded', note: 'toda a carteira é de demonstração' };
  }
  return {
    trust: 'missing',
    reason: 'unclassified-contract',
    note: 'nenhum contrato da carteira tem origem validada como operacional',
  };
}

const byOrigin = (
  contracts: readonly TrustedContract[],
  pick: (c: TrustedContract) => Official<number>,
): Official<number>[] =>
  /**
   * FILTRA antes de mapear, em vez de converter todos em `missing`.
   *
   * A diferença aparece na cobertura e na mensagem. Convertendo, uma carteira
   * com 1 contrato operacional entre 4 mostrava "parcial · 1/4" — que o olho lê
   * como "3 falharam" — e a razão da ausência virava o genérico
   * "não se reparte pelo recorte", porque três motivos distintos se misturavam.
   *
   * O agregado OFICIAL é sobre a carteira OFICIAL: a cobertura certa é 1/1, e
   * o motivo da ausência é o do contrato operacional, não o dos que nunca
   * fizeram parte da conta. A composição por origem já está declarada em
   * `scope` e na barra de escopo.
   */
  contracts
    .filter((c) => isOfficialOrigin(c.dataClass))
    .map((c) => officialByOrigin(pick(c), c.dataClass));

export type TrustedPortfolioStats = {
  /**
   * Composição da carteira por origem. A interface precisa poder dizer
   * "1 ao vivo · 3 de demonstração" — esconder a fronteira seria deixar o
   * usuário supor que o que vê é a carteira da empresa.
   */
  readonly scope: {
    readonly live: number;
    readonly demo: number;
    readonly unclassified: number;
    readonly total: number;
  };
  /** Contratos que alimentam as métricas abaixo (apenas `live`). */
  readonly contractCount: number;

  /** Exposição. */
  readonly totalValue: Official<number>;
  readonly billedValue: Official<number>;
  readonly remainingValue: Official<number>;
  readonly billedPct: Official<number>;
  readonly backlogPct: Official<number>;

  /** Renovação. */
  readonly expiring90: Official<number>;
  readonly within30: Official<number>;

  /** Risco. */
  readonly highRisk: Official<number>;
  readonly highRiskExposure: Official<number>;

  /** Operacional. */
  readonly overdueObligations: Official<number>;
  readonly contractsWithOverdue: Official<number>;
  readonly pendingDocuments: Official<number>;
  readonly contractsWithPendingDocs: Official<number>;
  readonly contractsWithoutProject: Official<number>;
  readonly contractsWithoutBilling: Official<number>;
  readonly contractsInLegalReview: Official<number>;
  readonly contractsWithoutAi: Official<number>;
};

/** Conta contratos por um indicador booleano confiável. */
function countFlag(
  contractsIn: readonly TrustedContract[],
  pick: (c: TrustedContract) => Official<boolean>,
  want: boolean,
  rule: string,
  from: Parameters<typeof derived>[1]['from'],
): Official<number> {
  const contracts = contractsIn.filter((c) => isOfficialOrigin(c.dataClass));
  const picked = contracts.map(pick);
  const firstError = picked.find(isError);
  if (firstError) return firstError as Official<number>;

  const evaluable = picked.filter(hasOfficialValue);
  if (contracts.length > 0 && evaluable.length === 0) {
    return missing<number>('no-rows', 'nenhum contrato com o indicador apurado');
  }
  return derived(evaluable.filter((item) => item.value === want).length, {
    rule, from, coverage: { counted: evaluable.length, total: picked.length },
  });
}

/**
 * Conta contratos que satisfazem um predicado sobre um indicador confiável.
 *
 * Se QUALQUER contrato tiver o indicador em erro, a contagem inteira é `error`:
 * uma contagem que ignora leituras falhas subestima silenciosamente. Contratos
 * com indicador `missing` simplesmente não contam a favor, e a cobertura
 * registra quantos puderam ser avaliados.
 */
function countBy(
  contractsIn: readonly TrustedContract[],
  pick: (c: TrustedContract) => Official<number>,
  predicate: (value: number) => boolean,
  rule: string,
  from: Parameters<typeof derived>[1]['from'],
): Official<number> {
  // Contagem oficial conta apenas contratos de origem validada.
  const contracts = contractsIn.filter((c) => isOfficialOrigin(c.dataClass));
  const picked = contracts.map(pick);
  const firstError = picked.find(isError);
  if (firstError) return firstError;

  const evaluable = picked.filter(hasOfficialValue);
  if (contracts.length > 0 && evaluable.length === 0) {
    return missing<number>('no-rows', 'nenhum contrato com o indicador apurado');
  }

  return derived(evaluable.filter((item) => predicate(item.value)).length, {
    rule,
    from,
    coverage: { counted: evaluable.length, total: picked.length },
  });
}

export function computeTrustedPortfolioStats(
  contracts: readonly TrustedContract[],
): TrustedPortfolioStats {
  /** Só a carteira validada alimenta métrica. */
  const officialContracts = contracts.filter((c) => isOfficialOrigin(c.dataClass));
  /** Quando ninguém sobrou, o motivo é a origem — não a ausência de registro. */
  const emptyReason = officialContracts.length === 0 ? emptyOfficialReason(contracts) : null;
  const official = (value: Official<number>): Official<number> => emptyReason ?? value;
  const scope = {
    live: officialContracts.length,
    demo: contracts.filter((c) => c.dataClass === 'demo').length,
    unclassified: contracts.filter((c) => c.dataClass === 'unclassified').length,
    total: contracts.length,
  };

  const totalValue = official(sumTrusted(
    byOrigin(contracts, (c) => c.totalValue),
    'soma do valor total dos contratos',
    ['contracts'],
 ));

  const billedValue = official(sumTrusted(
    byOrigin(contracts, (c) => c.billedValue),
    'soma do faturamento realizado',
    ['contract_billing_events'],
 ));

  const remainingValue = official(sumTrusted(
    byOrigin(contracts, (c) => c.remainingValue),
    'soma do saldo a faturar',
    ['contracts', 'contract_billing_events'],
 ));

  const highRiskExposure = official(sumTrusted(
    byOrigin(contracts.filter((c) => c.riskLevel === 'high'), (c) => c.totalValue),
    'soma do valor dos contratos de risco alto',
    ['contracts'],
 ));

  const overdueObligations = official(sumTrusted(
    byOrigin(contracts, (c) => c.overdueObligations),
    'soma das obrigações atrasadas',
    ['contract_obligations'],
 ));

  const pendingDocuments = official(sumTrusted(
    byOrigin(contracts, (c) => c.pendingDocuments),
    'soma dos documentos pendentes',
    ['contract_documents'],
 ));

  return {
    scope,
    contractCount: officialContracts.length,

    totalValue,
    billedValue,
    remainingValue,
    billedPct: ratioTrusted(billedValue, totalValue, 'faturado sobre valor total', ['contracts', 'contract_billing_events']),
    backlogPct: ratioTrusted(remainingValue, totalValue, 'saldo sobre valor total', ['contracts', 'contract_billing_events']),

    expiring90: countBy(contracts, (c) => c.daysUntilExpiration, (d) => d >= 0 && d <= 90,
      'contratos vencendo em até 90 dias', ['contracts']),
    within30: countBy(contracts, (c) => c.daysUntilExpiration, (d) => d >= 0 && d <= 30,
      'contratos vencendo em até 30 dias', ['contracts']),

    // Classificação de risco vem de coluna NOT NULL: sempre apurada.
    highRisk: live(officialContracts.filter((c) => c.riskLevel === 'high').length, 'contracts'),
    highRiskExposure,

    overdueObligations,
    contractsWithOverdue: countBy(contracts, (c) => c.overdueObligations, (n) => n > 0,
      'contratos com ao menos uma obrigação atrasada', ['contract_obligations']),

    pendingDocuments,
    contractsWithPendingDocs: countBy(contracts, (c) => c.pendingDocuments, (n) => n > 0,
      'contratos com ao menos um documento pendente', ['contract_documents']),

    contractsWithoutProject: (() => {
      const firstError = officialContracts.map((c) => c.project).find(isError);
      if (firstError) return firstError as Official<number>;
      return derived(officialContracts.filter((c) => !hasOfficialValue(c.project)).length, {
        rule: 'contratos sem vínculo de projeto real',
        from: ['contracts', 'contract_project_links'],
      });
    })(),

    contractsWithoutBilling: (() => {
      const firstError = officialContracts.map((c) => c.billingEvents).find(isError);
      if (firstError) return firstError as Official<number>;
      return derived(
        officialContracts.filter((c) => hasOfficialValue(c.billingEvents) && c.billingEvents.value.length === 0).length,
        { rule: 'contratos sem nenhum evento de faturamento registrado', from: ['contract_billing_events'] },
      );
    })(),

    contractsInLegalReview: countFlag(contracts, (c) => c.inLegalReview, true,
      'contratos em revisão jurídica', ['contracts', 'contract_approvals']),

    contractsWithoutAi: countFlag(contracts, (c) => c.hasAiAnalysis, false,
      'contratos sem análise de IA registrada', ['contract_ai_analyses']),
  };
}
