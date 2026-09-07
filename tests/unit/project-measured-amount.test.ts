/**
 * REGRESSÃO PERMANENTE — a precedência do valor medido (Fase 6, §12/§68/§97).
 *
 * Este arquivo existe por causa de um defeito real. Antes da Fase 6,
 * `contract-to-cash.ts` somava `m.measured_amount ?? m.billing_amount` e
 * chamava o resultado de "medido". `billing_amount` é o valor PREVISTO no
 * contrato: um marco que ninguém apurou contribuía com o previsto dele, e o
 * painel apresentava previsão como apuração.
 *
 * O plano marca a regra como bloqueadora de merge e pede cobertura
 * permanente. É esta. Se alguém reintroduzir o fallback, o teste
 * `billing_amount jamais vira valor medido` cai — e ele passa um número
 * absurdo justamente para que a falha seja legível no diff da saída.
 */
import { describe, expect, it } from 'vitest';
import {
  resolveMeasuredAmount, MEASURED_AMOUNT_SOURCE_LABEL,
  type AcceptedMeasurementInput,
} from '@/lib/projects/measurements/measured-amount';

const accepted = (over: Partial<AcceptedMeasurementInput> = {}): AcceptedMeasurementInput => ({
  acceptedValue: 100,
  acceptedCurrency: 'BRL',
  acceptedAt: '2026-01-01T00:00:00Z',
  aggregationMode: 'SUM_INCREMENTAL',
  ...over,
});

describe('precedência do valor medido', () => {
  it('1) medição canônica aceita tem precedência sobre o legado', () => {
    const r = resolveMeasuredAmount({
      accepted: [accepted({ acceptedValue: 300_000 })],
      legacyMeasuredAmount: 455_000,
      billingAmount: 500_000,
    });
    expect(r.source).toBe('canonical_accepted');
    expect(r.amount).toBe(300_000);
  });

  it('2) sem medição canônica, o legado measured_amount responde', () => {
    const r = resolveMeasuredAmount({
      accepted: [], legacyMeasuredAmount: 455_000, billingAmount: 500_000,
    });
    expect(r.source).toBe('legacy_measured_amount');
    expect(r.amount).toBe(455_000);
  });

  it('3) sem nenhum dos dois, a resposta é UNKNOWN — e não zero', () => {
    const r = resolveMeasuredAmount({
      accepted: [], legacyMeasuredAmount: null, billingAmount: 500_000,
    });
    expect(r.source).toBe('UNKNOWN');
    expect(r.amount).toBeNull();
    expect(r.reason).toBe('NO_MEASUREMENT');
  });

  /*
    O teste que bloqueia merge. O valor absurdo é proposital: se ele aparecer
    na saída, o número no relatório de falha diz sozinho de onde veio.
  */
  it('billing_amount JAMAIS vira valor medido, em nenhuma combinação', () => {
    const ABSURDO = 987_654_321;
    const casos = [
      { accepted: [], legacyMeasuredAmount: null, billingAmount: ABSURDO },
      { accepted: [], legacyMeasuredAmount: 10, billingAmount: ABSURDO },
      { accepted: [accepted({ acceptedValue: 10 })], legacyMeasuredAmount: null, billingAmount: ABSURDO },
      { accepted: [accepted({ aggregationMode: 'UNKNOWN' })], legacyMeasuredAmount: null, billingAmount: ABSURDO },
      { accepted: [], legacyMeasuredAmount: 0, billingAmount: ABSURDO },
    ] as const;

    for (const caso of casos) {
      const r = resolveMeasuredAmount(caso);
      expect(r.amount).not.toBe(ABSURDO);
      expect(JSON.stringify(r)).not.toContain(String(ABSURDO));
      // A presença do previsto é DIAGNÓSTICO, e ele é sinalizado como ignorado.
      expect(r.billingAmountPresentAndIgnored).toBe(true);
    }
  });

  it('zero apurado é diferente de não apurado', () => {
    const zero = resolveMeasuredAmount({ accepted: [], legacyMeasuredAmount: 0, billingAmount: null });
    expect(zero.source).toBe('legacy_measured_amount');
    expect(zero.amount).toBe(0);

    const ausente = resolveMeasuredAmount({ accepted: [], legacyMeasuredAmount: null, billingAmount: null });
    expect(ausente.source).toBe('UNKNOWN');
    expect(ausente.amount).toBeNull();
  });
});

describe('semântica de agregação (§71)', () => {
  it('INCREMENTAL soma as parcelas', () => {
    const r = resolveMeasuredAmount({
      accepted: [accepted({ acceptedValue: 100 }), accepted({ acceptedValue: 250 })],
      legacyMeasuredAmount: null, billingAmount: null,
    });
    expect(r.amount).toBe(350);
    expect(r.acceptedCount).toBe(2);
  });

  it('CUMULATIVO NÃO soma — o último aceite já é o total', () => {
    const r = resolveMeasuredAmount({
      accepted: [
        accepted({ acceptedValue: 100, acceptedAt: '2026-01-01T00:00:00Z', aggregationMode: 'LATEST_CUMULATIVE' }),
        accepted({ acceptedValue: 250, acceptedAt: '2026-02-01T00:00:00Z', aggregationMode: 'LATEST_CUMULATIVE' }),
      ],
      legacyMeasuredAmount: null, billingAmount: null,
    });
    // 250, e não 350: somar contaria a medição de janeiro duas vezes.
    expect(r.amount).toBe(250);
  });

  it('semântica desconhecida devolve UNKNOWN em vez de somar às cegas', () => {
    const r = resolveMeasuredAmount({
      accepted: [accepted({ aggregationMode: 'UNKNOWN' })],
      legacyMeasuredAmount: 999, billingAmount: null,
    });
    expect(r.source).toBe('UNKNOWN');
    expect(r.reason).toBe('AGGREGATION_SEMANTICS_UNKNOWN');
    expect(r.amount).toBeNull();
    // E não cai para o legado: existe medição aceita, o que falta é como somá-la.
    expect(r.amount).not.toBe(999);
  });

  it('semântica MISTA entre as parcelas devolve UNKNOWN', () => {
    const r = resolveMeasuredAmount({
      accepted: [
        accepted({ aggregationMode: 'SUM_INCREMENTAL' }),
        accepted({ aggregationMode: 'LATEST_CUMULATIVE' }),
      ],
      legacyMeasuredAmount: null, billingAmount: null,
    });
    expect(r.source).toBe('UNKNOWN');
    expect(r.reason).toBe('AGGREGATION_SEMANTICS_UNKNOWN');
  });

  it('numeric do Postgres chega como string e não vira zero', () => {
    const r = resolveMeasuredAmount({
      accepted: [accepted({ acceptedValue: '300000.00' })],
      legacyMeasuredAmount: null, billingAmount: null,
    });
    expect(r.amount).toBe(300_000);
  });
});

describe('procedência exibível', () => {
  it('todo estado de fonte tem rótulo', () => {
    for (const k of ['canonical_accepted', 'legacy_measured_amount', 'UNKNOWN'] as const) {
      expect(MEASURED_AMOUNT_SOURCE_LABEL[k]).toBeTruthy();
    }
  });
});
