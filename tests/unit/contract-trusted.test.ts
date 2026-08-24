/**
 * Trust Layer de Contratos — invariantes.
 *
 * Cada bloco trava uma das regras obrigatórias de P0.3. Vários testes são
 * de TIPO, não de runtime: `@ts-expect-error` falha o `tsc` se a construção
 * passar a compilar, que é a forma mais forte de impedir a reintrodução do
 * comportamento silencioso.
 */

import { describe, it, expect } from 'vitest';
import {
  live, derived, missing, failed, demo,
  isLive, isDerived, isMissing, isError, isDemo, hasValue, hasOfficialValue,
  toOfficial, toOfficialRecord, mapTrusted, sumTrusted, countTrusted, ratioTrusted,
  renderTrusted, renderOfficial, formatOfficial, trustBadge,
  TRUST_FALLBACK_LABEL,
  type Trusted, type Official,
} from '@/lib/contracts/trust/trusted';

const brl = (v: number) => `R$ ${v.toFixed(2)}`;

// ═══════════════════════════════════════════════════════════════════
// REGRA: um `0` apurado é um valor válido
// ═══════════════════════════════════════════════════════════════════

describe('zero apurado', () => {
  it('live(0) é um valor, não uma ausência', () => {
    const t = live(0, 'contracts');
    expect(hasValue(t)).toBe(true);
    expect(isMissing(t)).toBe(false);
    if (isLive(t)) expect(t.value).toBe(0);
    expect(formatOfficial(t, brl)).toBe('R$ 0.00');
  });

  it('0 apurado e ausência têm FORMAS diferentes, não valores diferentes', () => {
    const zero = live(0, 'contract_billing_events');
    const ausente = missing<number>('no-rows');
    expect(zero.trust).not.toBe(ausente.trust);
    expect('value' in zero).toBe(true);
    expect('value' in ausente).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════
// REGRA: MISSING nunca vira 0
// ═══════════════════════════════════════════════════════════════════

describe('missing nunca vira 0', () => {
  it('não expõe `.value` nenhum', () => {
    const t = missing<number>('no-rows');
    expect('value' in t).toBe(false);
  });

  it('formata como "Não apurado", não como zero', () => {
    expect(formatOfficial(missing<number>('no-rows'), brl)).toBe('Não apurado');
    expect(formatOfficial(missing<number>('not-integrated'), brl)).not.toContain('0');
  });

  it('soma de indicadores todos ausentes é missing, não 0', () => {
    const total = sumTrusted(
      [missing<number>('no-rows'), missing<number>('no-rows')],
      'soma', ['contract_billing_events'],
    );
    expect(total.trust).toBe('missing');
    expect('value' in total).toBe(false);
  });

  it('lista vazia soma para missing, não 0', () => {
    const total = sumTrusted([], 'soma', ['contracts']);
    expect(total.trust).toBe('missing');
    if (isMissing(total)) expect(total.reason).toBe('no-rows');
  });

  it('@ts-expect-error: não dá para ler .value sem estreitar', () => {
    const t: Trusted<number> = missing('no-rows');
    // @ts-expect-error `missing` e `error` não têm `value`
    const _v = t.value;
    expect(_v).toBeUndefined();
  });

  it('@ts-expect-error: Trusted<number> não passa onde se espera number', () => {
    const t: Trusted<number> = live(10, 'contracts');
    expect(() => {
      // @ts-expect-error é exatamente `formatCurrency(valor)` direto que se impede.
      // O compilador barra; se alguém silenciar o erro, quebra em runtime também.
      return brl(t);
    }).toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════════
// REGRA: ERROR nunca vira [], 0, "estimado" ou dado sintético
// ═══════════════════════════════════════════════════════════════════

describe('error é incidente, não ausência', () => {
  it('tem forma própria, distinta de missing', () => {
    const e = failed<number>('permission denied', 'contract_documents');
    expect(isError(e)).toBe(true);
    expect(isMissing(e)).toBe(false);
    expect('value' in e).toBe(false);
  });

  it('NUNCA é rotulado "estimado" — a correção semântica exigida', () => {
    const label = formatOfficial(failed<number>('timeout'), brl);
    expect(label).toBe('Dados indisponíveis');
    expect(label.toLowerCase()).not.toContain('estimad');
    expect(trustBadge(failed('x')).label).toBe('Dados indisponíveis');
    expect(trustBadge(failed('x')).tone).toBe('danger');
  });

  it('demo e error NUNCA compartilham representação', () => {
    const e = trustBadge(failed('x'));
    const d = trustBadge(demo(1, 'preview'));
    expect(e.label).not.toBe(d.label);
    expect(e.tone).not.toBe(d.tone);
  });

  it('CONTAMINA a soma — um total que ignora leitura falha é um total errado', () => {
    const total = sumTrusted(
      [live(100, 'contract_billing_events'), failed<number>('timeout'), live(50, 'contract_billing_events')],
      'soma', ['contract_billing_events'],
    );
    expect(total.trust).toBe('error');
    expect('value' in total).toBe(false);
  });

  it('contamina a razão em qualquer das duas pontas', () => {
    expect(ratioTrusted(failed<number>('x'), live(10, 'contracts'), 'r', []).trust).toBe('error');
    expect(ratioTrusted(live(1, 'contracts'), failed<number>('x'), 'r', []).trust).toBe('error');
  });
});

// ═══════════════════════════════════════════════════════════════════
// REGRA: DEMO é explícito, isolado, e nunca alcança superfície oficial
// ═══════════════════════════════════════════════════════════════════

describe('demo é isolado', () => {
  it('carrega nota obrigatória identificando-se', () => {
    const d = demo(1_000, 'preview sintético do enricher');
    expect(isDemo(d)).toBe(true);
    if (isDemo(d)) expect(d.note).toBe('preview sintético do enricher');
    expect(trustBadge(d).label).toBe('Demonstração');
  });

  it('toOfficial converte demo em missing(demo-excluded), preservando a nota', () => {
    const official = toOfficial(demo(999_999, 'escada 10/40/50%'));
    expect(official.trust).toBe('missing');
    if (isMissing(official)) {
      expect(official.reason).toBe('demo-excluded');
      expect(official.note).toBe('escada 10/40/50%');
    }
  });

  it('o valor sintético NÃO sobrevive à passagem para oficial', () => {
    const official = toOfficial(demo(999_999, 'x'));
    expect('value' in official).toBe(false);
    expect(formatOfficial(official, brl)).toBe('Não apurado');
    expect(formatOfficial(official, brl)).not.toContain('999');
  });

  it('toOfficialRecord limpa um conjunto inteiro de indicadores', () => {
    const out = toOfficialRecord({
      real: live(10, 'contracts'),
      sintetico: demo(999, 'mock'),
      ausente: missing<number>('no-rows'),
    });
    expect(out.real.trust).toBe('live');
    expect(out.sintetico.trust).toBe('missing');
    expect(out.ausente.trust).toBe('missing');
  });

  it('@ts-expect-error: Trusted<T> não é aceito onde se exige Official<T>', () => {
    const t: Trusted<number> = demo(5, 'mock');
    // @ts-expect-error demo está excluído de Official POR TIPO
    const o: Official<number> = t;
    expect(o).toBeDefined();
  });

  it('sumTrusted só aceita Official — demo não entra em agregação oficial', () => {
    const seguro = sumTrusted([toOfficial(demo(999, 'mock')), live(10, 'contracts')], 'soma', ['contracts']);
    expect(seguro.trust).toBe('derived');
    if (isDerived(seguro)) {
      expect(seguro.value).toBe(10);                       // o 999 não entrou
      expect(seguro.derivation.coverage).toEqual({ counted: 1, total: 2 });
    }
  });

  it('renderTrusted sem onDemo NÃO vaza o valor sintético', () => {
    const out = renderTrusted(demo(42, 'mock'), {
      onValue: (v) => `valor:${v}`,
      onMissing: (r) => `ausente:${r}`,
      onError: (m) => `erro:${m}`,
    });
    expect(out).toBe('ausente:demo-excluded');
  });

  it('renderTrusted COM onDemo permite uso deliberado em dev', () => {
    const out = renderTrusted(demo(42, 'mock'), {
      onValue: (v) => `valor:${v}`,
      onMissing: (r) => `ausente:${r}`,
      onError: (m) => `erro:${m}`,
      onDemo: (v, n) => `demo:${v}:${n}`,
    });
    expect(out).toBe('demo:42:mock');
  });
});

// ═══════════════════════════════════════════════════════════════════
// REGRA: DERIVED é determinístico e preserva proveniência
// ═══════════════════════════════════════════════════════════════════

describe('derived explica como foi produzido', () => {
  it('carrega regra, fontes e cobertura', () => {
    const total = sumTrusted(
      [live(100, 'contract_billing_events'), live(50, 'contract_billing_events'), missing<number>('no-rows')],
      'soma de eventos faturados', ['contract_billing_events'],
    );
    expect(total.trust).toBe('derived');
    if (isDerived(total)) {
      expect(total.value).toBe(150);
      expect(total.derivation.rule).toBe('soma de eventos faturados');
      expect(total.derivation.from).toEqual(['contract_billing_events']);
      // Total verdadeiro, porém PARCIAL — e a interface consegue dizer isso.
      expect(total.derivation.coverage).toEqual({ counted: 2, total: 3 });
    }
  });

  it('é determinístico: mesma entrada, mesma saída', () => {
    const input = [live(7, 'contracts'), live(3, 'contracts')];
    expect(sumTrusted(input, 'r', ['contracts'])).toEqual(sumTrusted(input, 'r', ['contracts']));
  });

  it('ratio recusa denominador não apurado em vez de inventar 0%', () => {
    const r = ratioTrusted(live(50, 'contracts'), missing<number>('no-rows'), 'pct', ['contracts']);
    expect(r.trust).toBe('missing');
    if (isMissing(r)) expect(r.reason).toBe('not-comparable');
  });

  it('ratio recusa denominador zero — 0/0 não é 0%', () => {
    const r = ratioTrusted(live(0, 'contracts'), live(0, 'contracts'), 'pct', ['contracts']);
    expect(r.trust).toBe('missing');
    if (isMissing(r)) expect(r.note).toBe('denominador zero');
  });

  it('countTrusted propaga o estado da lista de origem', () => {
    expect(countTrusted(failed<readonly number[]>('x'), () => true, 'c', []).trust).toBe('error');
    expect(countTrusted(missing<readonly number[]>('no-rows'), () => true, 'c', []).trust).toBe('missing');
    const ok = countTrusted(live([1, 2, 3] as readonly number[], 'contracts'), (n) => n > 1, 'c', ['contracts']);
    expect(ok.trust).toBe('derived');
    if (isDerived(ok)) expect(ok.value).toBe(2);
  });
});

// ═══════════════════════════════════════════════════════════════════
// mapTrusted preserva estado
// ═══════════════════════════════════════════════════════════════════

describe('mapTrusted', () => {
  it('preserva o estado e a proveniência em todos os cinco casos', () => {
    expect(mapTrusted(live(2, 'contracts'), (n) => n * 2)).toEqual(live(4, 'contracts'));
    expect(mapTrusted(missing<number>('no-rows'), (n) => n * 2).trust).toBe('missing');
    expect(mapTrusted(failed<number>('x'), (n) => n * 2).trust).toBe('error');
    expect(mapTrusted(demo(2, 'nota'), (n) => n * 2)).toEqual(demo(4, 'nota'));
    const d = mapTrusted(derived(2, { rule: 'r', from: ['contracts'] }), (n) => n * 2);
    expect(d.trust).toBe('derived');
    if (isDerived(d)) expect(d.value).toBe(4);
  });

  it('não invoca a função de transformação em estados sem valor', () => {
    let chamou = false;
    mapTrusted(missing<number>('no-rows'), (n) => { chamou = true; return n; });
    mapTrusted(failed<number>('x'), (n) => { chamou = true; return n; });
    expect(chamou).toBe(false);
  });
});

describe('rótulos', () => {
  it('missing e error têm textos distintos e nenhum diz "estimado"', () => {
    expect(TRUST_FALLBACK_LABEL.missing).toBe('Não apurado');
    expect(TRUST_FALLBACK_LABEL.error).toBe('Dados indisponíveis');
    expect(TRUST_FALLBACK_LABEL.missing).not.toBe(TRUST_FALLBACK_LABEL.error);
  });

  it('renderOfficial obriga a tratar cada estado', () => {
    const render = (t: Official<number>) => renderOfficial(t, {
      onValue: (v, state) => `${state}:${v}`,
      onMissing: (r) => `missing:${r}`,
      onError: (m) => `error:${m}`,
    });
    expect(render(live(1, 'contracts'))).toBe('live:1');
    expect(render(derived(2, { rule: 'r', from: [] }))).toBe('derived:2');
    expect(render(missing('no-rows'))).toBe('missing:no-rows');
    expect(render(failed('boom'))).toBe('error:boom');
  });
});
