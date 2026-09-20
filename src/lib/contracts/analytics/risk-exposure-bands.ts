/**
 * EXPOSIÇÃO FINANCEIRA POR CLASSIFICAÇÃO DE RISCO.
 *
 * Contar contratos por risco é fácil e quase inútil: três contratos de risco
 * alto podem valer R$ 30 mil ou R$ 30 milhões, e a decisão é outra em cada
 * caso. Aqui cada faixa carrega as DUAS leituras — quantos contratos e quanto
 * dinheiro — porque nenhuma das duas sozinha sustenta uma decisão.
 *
 * ─── Sobre a faixa "não apurado" ───────────────────────────────────────────
 *
 * `contracts.risk_level` é NOT NULL e o read model já resolve a coluna para
 * uma das três classes. Não existe, portanto, contrato sem classificação — e
 * inventar uma quarta faixa de risco "não apurado" aqui afirmaria uma ausência
 * que o modelo de domínio não tem. Mudar isso seria mexer em regra de negócio.
 *
 * O que EXISTE de não apurado é o outro eixo: o valor. Um contrato de risco
 * alto sem `total_value` legível tem classificação conhecida e exposição
 * desconhecida. Ele conta na sua faixa e NÃO entra na soma dela — e a lacuna
 * aparece como uma linha própria, `unpriced`, separada das três faixas, para
 * que ninguém a confunda com uma quarta classe de risco nem a some duas vezes.
 *
 * É por isso que `exposure` é `number | null` e nunca `0` por ausência: uma
 * faixa em que nenhum contrato teve valor lido não vale zero, ela é
 * desconhecida, e a barra correspondente desenha trilho tracejado.
 *
 * Lógica pura, sem JSX, sem I/O.
 */

import { hasOfficialValue, isError } from '../trust/trusted';
import type { TrustedContract } from '../trust/read-model';

export type RiskBandKey = 'high' | 'medium' | 'low';

export const RISK_BAND_ORDER: readonly RiskBandKey[] = ['high', 'medium', 'low'];

export const RISK_BAND_LABEL: Record<RiskBandKey, string> = {
  high: 'Alto',
  medium: 'Médio',
  low: 'Baixo',
};

export type RiskBand = {
  readonly key: RiskBandKey;
  readonly label: string;
  readonly count: number;
  /** Σ do valor contratado dos contratos da faixa. `null` = nada apurado. */
  readonly exposure: number | null;
  /** Contratos da faixa cujo valor pôde ser lido. */
  readonly pricedCount: number;
  /** Fração da exposição total apurada, de 0 a 1. `null` sem as duas pontas. */
  readonly share: number | null;
  readonly contractIds: readonly string[];
};

export type RiskExposureBands = {
  readonly bands: readonly RiskBand[];
  /** Σ das faixas. `null` quando nenhum contrato teve valor apurado. */
  readonly total: number | null;
  readonly contractCount: number;
  /**
   * A lacuna do eixo financeiro: contratos classificados cujo valor não foi
   * lido. NÃO é uma faixa de risco — é cobertura, e fica separada de propósito.
   */
  readonly unpriced: { readonly count: number; readonly contractIds: readonly string[] };
  /** Contratos cuja leitura de valor FALHOU — incidente, não ausência. */
  readonly erroredContracts: readonly string[];
};

export function buildRiskExposureBands(
  contracts: readonly TrustedContract[],
): RiskExposureBands {
  const errored: string[] = [];
  const unpricedIds: string[] = [];

  const bands: RiskBand[] = RISK_BAND_ORDER.map((key) => {
    const inBand = contracts.filter((c) => c.riskLevel === key);
    const values: number[] = [];
    let priced = 0;

    for (const contract of inBand) {
      if (isError(contract.totalValue)) {
        errored.push(contract.code);
        unpricedIds.push(contract.id);
        continue;
      }
      if (!hasOfficialValue(contract.totalValue)) {
        unpricedIds.push(contract.id);
        continue;
      }
      values.push(contract.totalValue.value);
      priced += 1;
    }

    return {
      key,
      label: RISK_BAND_LABEL[key],
      count: inBand.length,
      exposure: values.length > 0 ? values.reduce((a, b) => a + b, 0) : null,
      pricedCount: priced,
      share: null as number | null,
      contractIds: inBand.map((c) => c.id),
    };
  });

  const known = bands.map((b) => b.exposure).filter((v): v is number => v !== null);
  const total = known.length > 0 ? known.reduce((a, b) => a + b, 0) : null;

  return {
    bands: bands.map((b) => ({
      ...b,
      share: b.exposure !== null && total !== null && total > 0 ? b.exposure / total : null,
    })),
    total,
    contractCount: contracts.length,
    unpriced: { count: unpricedIds.length, contractIds: unpricedIds },
    erroredContracts: errored,
  };
}
