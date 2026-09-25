/**
 * O painel não desenha NaN. Regressão do anel "Decisões / Votos": numa
 * organização sem deliberação em votação, `0 / 0` virava `stroke-dashoffset`,
 * `cx` e `cy` NaN. A geometria agora é finita por construção e o vazio é só a
 * trilha; o denominador do dado vivo é real (deliberações em aberto).
 */
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/contexts/ThemeContext', () => ({ useTheme: () => ({ theme: 'dark' }) }));

import { barHeightPct, finite, ringGeometry, sparklineGeometry, svgSafeId } from '@/components/dashboard/hud/geometry';
import { HudRingGauge } from '@/components/dashboard/hud/HudRingGauge';
import { HudSparkline } from '@/components/dashboard/hud/HudSparkline';
import { buildLiveDashboardPayload } from '@/lib/dashboard-live';
import type { DeliberationItem } from '@/lib/types';

const allFinite = (o: Record<string, unknown>) => Object.values(o).every((v) => typeof v !== 'number' || Number.isFinite(v));
const NON_FINITE = /NaN|Infinity/;

describe('ringGeometry', () => {
  it('sem denominador (a organização vazia): vazio, tudo finito', () => {
    const g = ringGeometry(74, 5, 0, 0);
    expect(g.empty).toBe(true);
    expect(g.progress).toBe(0);
    expect(allFinite(g as never)).toBe(true);
  });

  it('entradas indefinidas ou não finitas não viram NaN', () => {
    for (const [v, m] of [[NaN, 5], [3, NaN], [undefined, undefined], [Infinity, 10], [5, -Infinity], ['x', '4']] as const) {
      expect(allFinite(ringGeometry(74, 5, v, m) as never), `${String(v)}/${String(m)}`).toBe(true);
    }
  });

  it('proporção real, limitada a [0,1]', () => {
    expect(ringGeometry(74, 5, 3, 5).progress).toBeCloseTo(0.6);
    expect(ringGeometry(74, 5, 9, 5).progress).toBe(1);
    expect(ringGeometry(74, 5, -2, 5).progress).toBe(0);
    expect(ringGeometry(74, 5, 0, 5).empty).toBe(false);
  });
});

describe('sparklineGeometry e barras', () => {
  it('menos de dois pontos finitos não é tendência', () => {
    expect(sparklineGeometry({ values: [], width: 40, height: 20 })).toBeNull();
    expect(sparklineGeometry({ values: [5], width: 40, height: 20 })).toBeNull();
    expect(sparklineGeometry({ values: [NaN, 5, undefined], width: 40, height: 20 })).toBeNull();
  });

  it('série constante, com NaN e com previsão: todos os pontos finitos', () => {
    for (const input of [
      { values: [4, 4, 4], width: 40, height: 20 },
      { values: [1, NaN, 3, Infinity, 2], width: 40, height: 20 },
      { values: [1, 2], forecast: [2, NaN, 3], bandLower: [0, 1], bandUpper: [3, 4], width: 0, height: 0 },
    ]) {
      const g = sparklineGeometry(input)!;
      const all = [...g.points, ...(g.forecast ?? []), ...(g.bandTop ?? []), ...(g.bandBottom ?? [])].join(' ');
      expect(all).not.toMatch(NON_FINITE);
    }
  });

  it('barra: série toda zero ou denominador inválido fica na altura mínima', () => {
    expect(barHeightPct(0, 0)).toBe(8);
    expect(barHeightPct(5, 0)).toBe(8);
    expect(barHeightPct(NaN, 10)).toBe(8);
    expect(barHeightPct(5, 10)).toBe(50);
    expect(barHeightPct(50, 10)).toBe(100);
    expect(finite('x', 3)).toBe(3);
  });

  it('id de SVG estável e seguro para url(#…)', () => {
    expect(svgSafeId('ring', ':r1:')).toBe('ring-r1');
    expect(svgSafeId('spark', '«r2»')).toBe('spark-r2');
  });
});

describe('componentes renderizados', () => {
  it('anel vazio: só trilha e faixas, sem arco nem marcador, nada NaN', () => {
    const html = renderToStaticMarkup(React.createElement(HudRingGauge, { value: 0, max: 0, label: 'Pendentes' }));
    expect(html).not.toMatch(NON_FINITE);
    expect((html.match(/<circle/g) ?? []).length).toBe(4); // 3 faixas + trilha
    expect(html).not.toContain('stroke-linecap="round"');
  });

  it('anel com proporção: arco e marcador, tudo finito', () => {
    const html = renderToStaticMarkup(React.createElement(HudRingGauge, { value: 2, max: 4, label: 'Pendentes' }));
    expect(html).not.toMatch(NON_FINITE);
    expect((html.match(/<circle/g) ?? []).length).toBe(6);
    expect(html).not.toMatch(/url\(#ring-[^)]*[:«»]/);
  });

  it('sparkline de um ponto não desenha; de vários, finita', () => {
    expect(renderToStaticMarkup(React.createElement(HudSparkline, { values: [5], variant: 'line' }))).toBe('');
    const html = renderToStaticMarkup(React.createElement(HudSparkline, { values: [1, NaN, 3], variant: 'line', height: 20 }));
    expect(html).not.toMatch(NON_FINITE);
    const bars = renderToStaticMarkup(React.createElement(HudSparkline, { values: [0, 0, 0] }));
    expect(bars).not.toMatch(NON_FINITE);
  });
});

describe('dado vivo do painel', () => {
  it('organização vazia: nenhuma votação, denominador zero — anel vazio, não NaN', () => {
    const p = buildLiveDashboardPayload([], [], new Map());
    expect(p.votingStatus).toMatchObject({ pending: 0, open: 0 });
    const g = ringGeometry(74, 5, p.votingStatus.pending, p.votingStatus.open ?? 0);
    expect(g.empty).toBe(true);
    expect(allFinite(g as never)).toBe(true);
  });

  it('denominador real: em votação sobre deliberações em aberto (não mais 100% fixo)', () => {
    const d = (status: string) => ({ deliberationStatus: status } as unknown as DeliberationItem);
    const p = buildLiveDashboardPayload([], [], new Map(), {
      deliberations: [d('in_voting'), d('in_review'), d('submitted'), d('in_voting'), d('closed'), d('draft')],
    });
    expect(p.votingStatus).toMatchObject({ pending: 2, open: 4 });
    expect(ringGeometry(74, 5, p.votingStatus.pending, p.votingStatus.open).progress).toBeCloseTo(0.5);
  });
});
