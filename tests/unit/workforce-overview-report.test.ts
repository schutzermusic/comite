/**
 * Camada de documento de Pessoas & Custos: tema, gráficos e narrativa.
 *
 * Dois invariantes travados aqui:
 *   1. gráfico sem série devolve o quadro de "não apurado", nunca string vazia
 *      nem eixo sozinho — um retângulo em branco no meio de um relatório de
 *      board lê como falha de geração;
 *   2. as duas paletas definem exatamente as mesmas chaves — uma cor só no
 *      escuro quebra o tema claro em silêncio, e isso só aparece na impressão.
 */
import { describe, expect, it } from 'vitest';
import {
  WF_DARK,
  WF_LIGHT,
  wfPalette,
  wfCurrency,
  wfPct,
  wfSignedPct,
  wfSignColor,
  wfAgenda,
} from '@/lib/workforce/overview/report/theme';
import {
  wfDonut,
  wfEmptyChart,
  wfGauge,
  wfGroupedBars,
  wfHorizontalBars,
  wfLegend,
  wfLineChart,
  wfParetoChart,
  wfSCurve,
  wfSparkline,
  wfStackedBars,
} from '@/lib/workforce/overview/report/charts';
import { buildWorkforceInsights } from '@/lib/workforce/overview/report/insights';
import { buildWorkforceOverviewModel } from '@/lib/workforce/overview/model';
import { EMPTY_ESOCIAL_LINK } from '@/lib/workforce/compliance';
import type { WorkforceActuals, WorkforceMonthlyRecord } from '@/lib/workforce/period';

const P = WF_DARK;

describe('paletas', () => {
  it('definem exatamente as mesmas chaves', () => {
    expect(Object.keys(WF_DARK).sort()).toEqual(Object.keys(WF_LIGHT).sort());
  });

  it('nenhum token fica indefinido ou vazio', () => {
    for (const palette of [WF_DARK, WF_LIGHT]) {
      for (const [key, value] of Object.entries(palette)) {
        expect(value, `${palette.mode}.${key}`).toBeTruthy();
      }
    }
  });

  it('resolvem por modo', () => {
    expect(wfPalette('light')).toBe(WF_LIGHT);
    expect(wfPalette('dark')).toBe(WF_DARK);
  });

  it('a cor do sinal respeita se subir é bom', () => {
    expect(wfSignColor(5, P, true)).toBe(P.positive);
    expect(wfSignColor(5, P, false)).toBe(P.negative);
    expect(wfSignColor(0, P, true)).toBe(P.muted);
  });
});

describe('formatação pt-BR', () => {
  it('usa vírgula decimal', () => {
    expect(wfPct(12.34)).toBe('12,3%');
    expect(wfSignedPct(4.2)).toBe('+4,2%');
    expect(wfSignedPct(-4.2)).toBe('-4,2%');
    expect(wfCurrency(1234)).toContain('1.234');
  });
});

describe('gráficos com série vazia', () => {
  const empty = { palette: P, width: 600, height: 300 };

  const cases: [string, string][] = [
    ['wfLineChart', wfLineChart([], [], empty)],
    ['wfGroupedBars', wfGroupedBars([], [], empty)],
    ['wfStackedBars', wfStackedBars([], [], empty)],
    ['wfParetoChart', wfParetoChart([], empty)],
    ['wfHorizontalBars', wfHorizontalBars([], empty)],
    ['wfDonut', wfDonut([], empty)],
    ['wfSCurve', wfSCurve([], [], null, empty)],
  ];

  it.each(cases)('%s devolve SVG válido e não vazio', (_name, svg) => {
    expect(svg).toMatch(/^<svg /);
    expect(svg).toMatch(/<\/svg>$/);
    expect(svg.length).toBeGreaterThan(120);
  });

  it.each(cases)('%s desenha o traço de "não apurado", nunca um zero', (_name, svg) => {
    expect(svg).toContain('–');
    // O quadro vazio não pode exibir um valor: `>0<` seria um rótulo de eixo.
    expect(svg).not.toMatch(/>0</);
  });

  it('o quadro vazio carrega o MOTIVO, não só a ausência', () => {
    const svg = wfEmptyChart(
      'Horas extras não classificadas',
      'Identificar a verba depende da tabela de rubricas do eSocial.',
      { palette: P, width: 600, height: 240 },
    );
    expect(svg).toContain('rubricas');
    expect(svg).toContain('stroke-dasharray');
  });
});

describe('gráficos com série apurada', () => {
  it('a linha desenha um ponto por competência', () => {
    const svg = wfLineChart(
      ['Jan/26', 'Fev/26', 'Mar/26'],
      [{ name: 'Folha', values: [100, 120, 110], color: P.accent }],
      { palette: P },
    );
    expect(svg).toMatch(/^<svg /);
    expect((svg.match(/<circle /g) ?? []).length).toBe(3);
  });

  it('o Pareto traz barras e a linha acumulada', () => {
    const svg = wfParetoChart(
      [
        { label: 'Operações', value: 800 },
        { label: 'Administrativo', value: 500 },
        { label: 'Manutenção', value: 200 },
      ],
      { palette: P },
    );
    expect(svg).toContain('<rect');
    expect(svg).toContain('100%'); // eixo direito da acumulada
  });

  /** Todos os arcos do medidor, com a bandeira de arco longo. */
  const gaugeArcs = (svg: string) =>
    [
      ...svg.matchAll(
        /d="M ([\d.-]+),([\d.-]+) A ([\d.-]+),[\d.-]+ 0 (\d) 1 ([\d.-]+),([\d.-]+)"/g,
      ),
    ].map((m) => ({
      startX: Number(m[1]),
      startY: Number(m[2]),
      radius: Number(m[3]),
      large: Number(m[4]),
      endX: Number(m[5]),
      endY: Number(m[6]),
    }));

  it('o medidor desenha o semicírculo SUPERIOR', () => {
    // O eixo Y do SVG cresce para baixo: o arco de cima é `π → 2π`, onde `sin`
    // é negativo. Usar `π → 0` desenha o semicírculo de baixo e o arco do valor
    // sai pelo lado errado — foi exatamente o que aconteceu na primeira versão.
    const svg = wfGauge(50, { palette: P, width: 400, height: 240, max: 100 });
    const arcs = gaugeArcs(svg);
    expect(arcs.length).toBeGreaterThan(0);

    // O arco da trilha é o de meia volta: começa e termina na mesma altura.
    const track = arcs.find((a) => Math.abs(a.endY - a.startY) < 0.01 && a.endX > a.startX);
    expect(track).toBeDefined();
    const cy = track!.startY;
    const cx = (track!.startX + track!.endX) / 2;

    // 50% de 100 termina no TOPO do arco: acima do centro, e alinhado em x.
    const value = arcs.find((a) => Math.abs(a.startX - track!.startX) < 0.01 && a !== track);
    expect(value).toBeDefined();
    expect(value!.endY).toBeLessThan(cy - 1);
    expect(Math.abs(value!.endX - cx)).toBeLessThan(2);
  });

  it('o medidor no máximo fecha à direita, no mesmo eixo do início', () => {
    const svg = wfGauge(100, { palette: P, width: 400, height: 240, max: 100 });
    const arcs = gaugeArcs(svg);
    const last = arcs[arcs.length - 1];
    // Começa à esquerda e termina à direita, na mesma altura.
    expect(last.endX).toBeGreaterThan(last.startX);
    expect(Math.abs(last.endY - last.startY)).toBeLessThan(0.01);
  });

  it('nenhum arco do medidor pede o arco longo', () => {
    /**
     * `t` percorre meia volta, então NENHUM sub-arco passa de 180° e
     * `large-arc-flag` tem de ser 0 em todos eles.
     *
     * Derivar a bandeira de `|t1 - t0| > 0.5` fazia a faixa de 0 a 60 (108°)
     * pedir ao SVG o arco COMPLEMENTAR de 252° — que saía como um laço solto
     * por cima do medidor na página de Conformidade.
     *
     * A faixa 0–60 é o caso do bug e está de propósito nas duas fixtures.
     */
    for (const value of [0, 12, 44, 60, 61, 85, 99, 100]) {
      const svg = wfGauge(value, {
        palette: P,
        width: 400,
        height: 240,
        max: 100,
        bands: [
          [0, 60, P.negative],
          [60, 85, P.attention],
          [85, 100, P.positive],
        ],
      });
      const arcs = gaugeArcs(svg);
      expect(arcs.length, `valor ${value} não desenhou arco`).toBeGreaterThan(0);
      for (const a of arcs) {
        expect(a.large, `valor ${value}: arco com large-arc-flag=1`).toBe(0);
      }
    }
  });

  it('o medidor mantém o arco dentro do quadro', () => {
    // O bloco é centrado verticalmente, então nenhum traço pode escapar pelas
    // bordas — nem no painel largo e baixo, nem no estreito e alto.
    for (const [w, h] of [
      [400, 240],
      [560, 300],
      [260, 320],
    ]) {
      const svg = wfGauge(72, {
        palette: P,
        width: w,
        height: h,
        max: 100,
        bands: [[0, 100, P.accent]],
      });
      for (const a of gaugeArcs(svg)) {
        for (const [x, y] of [
          [a.startX, a.startY],
          [a.endX, a.endY],
        ]) {
          expect(x, `${w}×${h}: x fora do quadro`).toBeGreaterThanOrEqual(0);
          expect(x, `${w}×${h}: x fora do quadro`).toBeLessThanOrEqual(w);
          expect(y, `${w}×${h}: y fora do quadro`).toBeGreaterThanOrEqual(0);
          expect(y, `${w}×${h}: y fora do quadro`).toBeLessThanOrEqual(h);
        }
      }
    }
  });

  it('os rótulos girados do Pareto cabem dentro do quadro', () => {
    // Rótulo girado -32° cai `largura × sen(32°)` abaixo da âncora. Com padding
    // insuficiente o texto era cortado na base — visível na página de
    // concentração do PDF e no slide correspondente do PowerPoint.
    const h = 340;
    const svg = wfParetoChart(
      [
        { label: 'Operações de Campo Norte', value: 900 },
        { label: 'Manutenção Pesada Industrial', value: 500 },
      ],
      { palette: P, width: 980, height: h },
    );

    const anchors = [...svg.matchAll(/translate\([\d.]+, ([\d.]+)\) rotate\(-32\)/g)].map((m) =>
      Number(m[1]),
    );
    expect(anchors.length).toBeGreaterThan(0);

    // 22 caracteres é o teto de truncagem; a queda vertical vem daí.
    const drop = 22 * 5.6 * Math.sin((32 * Math.PI) / 180);
    for (const anchor of anchors) {
      expect(anchor + drop, 'rótulo ultrapassa a base do gráfico').toBeLessThanOrEqual(h);
    }
  });

  it('trunca rótulo longo em vez de deixá-lo transbordar', () => {
    const svg = wfParetoChart(
      [{ label: 'Centro de Custo Com Nome Absurdamente Longo Demais', value: 100 }],
      { palette: P },
    );
    expect(svg).toContain('…');
  });

  it('o medidor com valor nulo mostra o traço, não zero', () => {
    const nulo = wfGauge(null, { palette: P, label: 'Risco de folha' });
    expect(nulo).toContain('–');
    expect(nulo).not.toContain('>0<');

    const comValor = wfGauge(72, { palette: P, valueText: '72/100', label: 'Risco de folha' });
    expect(comValor).toContain('72/100');
  });

  it('a rosca ignora fatias zeradas', () => {
    const svg = wfDonut(
      [
        { name: 'VA', value: 100, color: P.accent },
        { name: 'VR', value: 0, color: P.success },
      ],
      { palette: P },
    );
    expect(svg).toContain('VA');
    expect(svg).not.toContain('VR');
  });

  it('a sparkline exige ao menos dois pontos', () => {
    expect(wfSparkline([1], P.accent)).not.toContain('<path');
    expect(wfSparkline([1, 2, 3], P.accent)).toContain('<path');
  });

  it('a legenda escapa o conteúdo', () => {
    const html = wfLegend([{ label: '<script>x</script>', color: P.accent }]);
    expect(html).not.toContain('<script>');
  });
});

describe('roteiro dos documentos', () => {
  it('omite as seções sem dado e mantém resumo e método', () => {
    const agenda = wfAgenda({
      hasEfficiency: false,
      hasDynamics: false,
      hasCostStructure: false,
      hasConcentration: false,
    });
    expect(agenda.map((a) => a.id)).toEqual(['resumo', 'conformidade', 'metodologia']);
  });

  it('inclui todas quando há dado', () => {
    const agenda = wfAgenda({
      hasEfficiency: true,
      hasDynamics: true,
      hasCostStructure: true,
      hasConcentration: true,
    });
    expect(agenda).toHaveLength(7);
  });
});

describe('narrativa', () => {
  function actuals(overrides: Partial<WorkforceActuals> = {}): WorkforceActuals {
    return {
      admissions: 3,
      terminations: 1,
      absenceDays: 8,
      absenceEvents: 5,
      overtimePct: 9.4,
      headcountSource: 'esocial',
      composition: { salary: 900, benefits: 150, charges: 250 },
      benefitsByType: { va: 80, vr: 30, health: 20, dental: 10, transport: 10, other: 0 },
      areas: [
        { code: 'OPER', label: 'Operações', headcount: 8, admissions: 2, terminations: 1, absenceDays: 6, payroll: 800 },
      ],
      ...overrides,
    };
  }

  const series: WorkforceMonthlyRecord[] = ['2026-03', '2026-04'].map((competenceMonth) => ({
    competenceMonth,
    headcount: 12,
    payroll: 1300,
    revenue: 5000,
    pj: 0,
    clt: 12,
    pjCost: 0,
    cltCost: 1300,
    costCenters: [{ id: 'esocial-OPER', name: 'Operações', payrollValue: 1300, headcount: 12 }],
    actuals: actuals(),
  }));

  const model = (rawSeries: WorkforceMonthlyRecord[]) =>
    buildWorkforceOverviewModel({
      period: { key: 'all' },
      comparison: 'previous-period',
      rawSeries,
      approvedBatches: [],
      esocialLink: EMPTY_ESOCIAL_LINK,
    });

  it('sem competência, não produz card nenhum', () => {
    const insights = buildWorkforceInsights(model([]));
    expect(insights.cards).toEqual([]);
    expect(insights.gaps.length).toBeGreaterThan(0);
    expect(insights.verdict).toContain('Não há competência apurada');
  });

  it('não emite card sobre indicador não apurado', () => {
    // Sem receita: risco e razão folha/receita ficam ausentes.
    const semReceita = series.map((r) => ({ ...r, revenue: 0 }));
    const insights = buildWorkforceInsights(model(semReceita));

    const titles = insights.cards.map((c) => c.title).join(' | ');
    expect(titles).not.toContain('Folha crescendo acima da receita');
    expect(titles).not.toContain('Folha acima do limite sobre a receita');
    // …e a ausência vira uma lacuna declarada, com o motivo.
    expect(insights.gaps.join(' ')).toContain('receita');
  });

  it('ordena alertas antes de observações e sinais', () => {
    const insights = buildWorkforceInsights(model(series));
    const order = insights.cards.map((c) => c.kind);
    const rank = { alert: 0, watch: 1, signal: 2, gap: 3 } as const;
    const ranks = order.map((k) => rank[k]);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
  });

  it('limita a seis cards', () => {
    expect(buildWorkforceInsights(model(series)).cards.length).toBeLessThanOrEqual(6);
  });

  it('a manchete é a mesma da tela', () => {
    const m = model(series);
    expect(buildWorkforceInsights(m).headline).toBe(m.executive.headline);
  });
});
