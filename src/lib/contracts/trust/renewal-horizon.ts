/**
 * Renewal Horizon — a carteira distribuída em janelas de decisão.
 *
 * Lógica pura, sem JSX.
 *
 * Duas restrições dão forma a este arquivo:
 *
 *  1. **Só data autoritativa.** A janela sai de `contracts.renewal_date` quando
 *     existe, e de `contracts.end_date` quando não. Nada é inferido de duração
 *     típica, de tipo de contrato ou de histórico. Contrato sem nenhuma das
 *     duas datas não entra numa janela: entra na lista de vigência não apurada,
 *     que é uma lacuna de cadastro e precisa ser vista como tal.
 *
 *  2. **Nenhuma recomendação sintética.** O módulo diz QUANDO a decisão vence e
 *     o que já se sabe do contrato; não diz "renovar" nem "renegociar". Essa
 *     recomendação exigiria histórico de performance e política comercial, e
 *     nenhum dos dois existe aqui.
 */

import { hasOfficialValue, isError, isOfficialOrigin } from './trusted';
import type { TrustedContract } from './read-model';

/** Limites em dias, do mais distante ao mais próximo. */
export const RENEWAL_WINDOWS = [180, 120, 90, 60, 30] as const;
export type RenewalWindow = (typeof RENEWAL_WINDOWS)[number];

export type HorizonBand = RenewalWindow | 'expired' | 'beyond';

export const HORIZON_LABEL: Record<HorizonBand, string> = {
  expired: 'Vencidos',
  30: 'Até 30 dias',
  60: '31 a 60 dias',
  90: '61 a 90 dias',
  120: '91 a 120 dias',
  180: '121 a 180 dias',
  beyond: 'Além de 180 dias',
};

export type HorizonEntry = {
  readonly contractId: string;
  readonly code: string;
  readonly title: string;
  readonly counterparty: string | null;
  readonly band: HorizonBand;
  readonly days: number;
  readonly date: Date;
  /** Qual coluna sustentou a janela — a proveniência fica visível. */
  readonly dateSource: 'renewal_date' | 'end_date';
  /** Valor em jogo, quando apurado. */
  readonly exposure: number | null;
  readonly hasProject: boolean;
};

export type RenewalHorizon = {
  readonly entries: readonly HorizonEntry[];
  /** Contagem por faixa, incluindo as vazias — a janela vazia é informação. */
  readonly bands: readonly { band: HorizonBand; count: number; exposure: number | null }[];
  /** Contratos sem `renewal_date` nem `end_date`. */
  readonly undatedContracts: readonly { code: string; title: string }[];
  readonly erroredContracts: readonly string[];
  readonly coverage: { readonly counted: number; readonly total: number };
};

const DAY = 86_400_000;

/** A faixa de um prazo em dias. Ordem: vencido → 30 → 60 → 90 → 120 → 180 → além. */
export function bandOf(days: number): HorizonBand {
  if (days < 0) return 'expired';
  if (days <= 30) return 30;
  if (days <= 60) return 60;
  if (days <= 90) return 90;
  if (days <= 120) return 120;
  if (days <= 180) return 180;
  return 'beyond';
}

const BAND_ORDER: HorizonBand[] = ['expired', 30, 60, 90, 120, 180, 'beyond'];

export function buildRenewalHorizon(
  contracts: readonly TrustedContract[],
  now: Date = new Date(),
  options: { officialOnly?: boolean } = {},
): RenewalHorizon {
  const scope = options.officialOnly === false
    ? contracts
    : contracts.filter((c) => isOfficialOrigin(c.dataClass));

  const entries: HorizonEntry[] = [];
  const undated: { code: string; title: string }[] = [];
  const errored: string[] = [];
  let counted = 0;

  for (const contract of scope) {
    if (isError(contract.endDate)) { errored.push(contract.code); continue; }
    counted += 1;

    // `renewal_date` vence `end_date`: quando alguém registrou a data da
    // decisão, é ela que governa a janela, não o fim da vigência.
    const source = contract.renewalDate;
    const chosen = hasOfficialValue(source)
      ? { date: source.value, from: 'renewal_date' as const }
      : hasOfficialValue(contract.endDate)
        ? { date: contract.endDate.value, from: 'end_date' as const }
        : null;

    if (!chosen) {
      undated.push({ code: contract.code, title: contract.title });
      continue;
    }

    const days = Math.floor((chosen.date.getTime() - now.getTime()) / DAY);
    entries.push({
      contractId: contract.id,
      code: contract.code,
      title: contract.title,
      counterparty: hasOfficialValue(contract.counterparty) ? contract.counterparty.value : null,
      band: bandOf(days),
      days,
      date: chosen.date,
      dateSource: chosen.from,
      exposure: hasOfficialValue(contract.totalValue) ? contract.totalValue.value : null,
      hasProject: hasOfficialValue(contract.project),
    });
  }

  entries.sort((a, b) => a.days - b.days);

  const bands = BAND_ORDER.map((band) => {
    const inBand = entries.filter((e) => e.band === band);
    const withExposure = inBand.filter((e) => e.exposure !== null);
    return {
      band,
      count: inBand.length,
      // `null` quando nenhum contrato da faixa tem valor apurado — somar só os
      // que têm produziria um total que se apresenta como o da faixa inteira.
      exposure: withExposure.length > 0
        ? withExposure.reduce((sum, e) => sum + (e.exposure ?? 0), 0)
        : null,
    };
  });

  return {
    entries,
    bands,
    undatedContracts: undated,
    erroredContracts: errored,
    coverage: { counted, total: scope.length },
  };
}
