/**
 * Paridade entre os destinos de Pessoas & Custos.
 *
 * O redesign inteiro se apoia numa aposta: um modelo só, consumido pela tela,
 * pelo PDF, pelo deck e pelo PowerPoint, torna a divergência impossível *por
 * construção*. Este arquivo é o que impede a aposta de se desfazer em
 * silêncio — se alguém formatar um número direto num dos destinos em vez de
 * ler do modelo, os documentos deixam de bater e o teste quebra.
 *
 * O PowerPoint não entra aqui: é server-only e gera binário. A cobertura dele
 * é o harness `scripts/qa-workforce-overview-exports.ts`.
 */
import { describe, expect, it } from 'vitest';
import { buildWorkforceOverviewPdfHtml } from '@/lib/workforce/overview/report/pdf';
import { buildWorkforceOverviewPresentationHtml } from '@/lib/workforce/overview/report/presentation';
import { buildWorkforceOverviewModel } from '@/lib/workforce/overview/model';
import { measuredText } from '@/lib/workforce/overview/report/format';
import { EMPTY_ESOCIAL_LINK } from '@/lib/workforce/compliance';
import { FALLBACK_REPORT_BRANDING } from '@/lib/reports/report-branding';
import type { WorkforceActuals, WorkforceMonthlyRecord } from '@/lib/workforce/period';

function actuals(i: number): WorkforceActuals {
  return {
    admissions: 4,
    terminations: 2,
    absenceDays: 18,
    absenceEvents: 6,
    overtimePct: 9.5 + i,
    headcountSource: 'esocial',
    composition: { salary: 620_000, benefits: 116_000, charges: 124_000 },
    benefitsByType: { va: 40_000, vr: 30_000, health: 26_000, dental: 8_000, transport: 12_000, other: 0 },
    areas: [
      { code: 'OPER', label: 'Operações', headcount: 26, admissions: 3, terminations: 2, absenceDays: 12, payroll: 520_000 },
      { code: 'ADM', label: 'Administrativo', headcount: 11, admissions: 1, terminations: 0, absenceDays: 6, payroll: 340_000 },
    ],
  };
}

const series: WorkforceMonthlyRecord[] = ['2026-01', '2026-02', '2026-03', '2026-04'].map(
  (competenceMonth, i) => ({
    competenceMonth,
    headcount: 37 + i,
    payroll: 860_000 + i * 12_000,
    revenue: 2_700_000 + i * 30_000,
    pj: 0,
    clt: 37 + i,
    pjCost: 0,
    cltCost: 860_000 + i * 12_000,
    costCenters: [
      { id: 'esocial-OPER', name: 'Operações', payrollValue: 520_000 + i * 8_000, headcount: 26 },
      { id: 'esocial-ADM', name: 'Administrativo', payrollValue: 340_000 + i * 4_000, headcount: 11 },
    ],
    actuals: actuals(i),
  }),
);

function build(rawSeries: WorkforceMonthlyRecord[]) {
  return buildWorkforceOverviewModel({
    period: { key: 'current-year' },
    comparison: 'previous-period',
    rawSeries,
    approvedBatches: [],
    esocialLink: EMPTY_ESOCIAL_LINK,
    generatedAt: '2026-05-01T12:00:00.000Z',
  });
}

/** Remove os SVGs: rótulo de eixo não é afirmação de KPI. */
const stripCharts = (html: string) => html.replace(/<svg[\s\S]*?<\/svg>/g, '');

describe('paridade entre PDF e apresentação', () => {
  const model = build(series);
  const pdf = buildWorkforceOverviewPdfHtml(model, { theme: 'dark' });
  const deck = buildWorkforceOverviewPresentationHtml(model);

  it('os dois documentos imprimem exatamente os mesmos valores de KPI', () => {
    const kpis = model.executive.kpis.filter(
      (k) => k.group === 'custo' || k.group === 'volume' || k.group === 'eficiencia',
    );
    expect(kpis.length).toBeGreaterThan(0);

    for (const kpi of kpis.slice(0, 8)) {
      const text = measuredText(kpi.value, kpi.format, kpi.display);
      // O valor tal como o modelo o formata precisa aparecer nos dois.
      expect(pdf, `KPI "${kpi.id}" ausente do PDF`).toContain(text);
      expect(deck, `KPI "${kpi.id}" ausente da apresentação`).toContain(text);
    }
  });

  it('a manchete e o veredito são idênticos nos dois', () => {
    expect(pdf).toContain(model.executive.headline);
    expect(deck).toContain(model.executive.headline);
  });

  it('o período e o recorte são idênticos nos dois', () => {
    expect(pdf).toContain(model.meta.periodLabel);
    expect(deck).toContain(model.meta.periodLabel);
    expect(pdf).toContain(model.meta.filtersLabel);
    expect(deck).toContain(model.meta.filtersLabel);
  });

  it('os dois temas do PDF diferem apenas na paleta, nunca nos números', () => {
    const light = buildWorkforceOverviewPdfHtml(model, { theme: 'light' });
    const kpis = model.executive.kpis.filter((k) => k.group === 'custo' || k.group === 'volume');
    for (const kpi of kpis) {
      const text = measuredText(kpi.value, kpi.format, kpi.display);
      expect(light, `KPI "${kpi.id}" difere no tema claro`).toContain(text);
    }
    // Mesma estrutura de páginas nos dois temas.
    const pages = (s: string) => (s.match(/class="page[ "]/g) ?? []).length;
    expect(pages(light)).toBe(pages(pdf));
  });
});

describe('série sem apuração — a ausência atravessa os dois destinos', () => {
  // Folha importada, sem eSocial e sem receita: metade dos indicadores ausente.
  const sparse: WorkforceMonthlyRecord[] = ['2026-03', '2026-04'].map((competenceMonth, i) => ({
    competenceMonth,
    headcount: 0,
    payroll: 900_000 + i * 5_000,
    revenue: 0,
    pj: 0,
    clt: 0,
    pjCost: 0,
    cltCost: 900_000 + i * 5_000,
    costCenters: [
      { id: 'cc-total', name: 'Folha Importada', payrollValue: 900_000 + i * 5_000, headcount: 0 },
    ],
  }));

  const model = build(sparse);
  const pdf = stripCharts(buildWorkforceOverviewPdfHtml(model, { theme: 'light' }));
  const deck = stripCharts(buildWorkforceOverviewPresentationHtml(model));

  it('nenhum documento exibe R$ 0 ou 0,0% fora dos eixos', () => {
    for (const [name, doc] of [['PDF', pdf], ['apresentação', deck]] as const) {
      expect(doc, `${name} exibe R$ 0`).not.toMatch(/>R\$\s*0</);
      expect(doc, `${name} exibe 0,0%`).not.toMatch(/>0,0%</);
    }
  });

  it('os dois marcam o indicador ausente com o mesmo traço', () => {
    expect(pdf).toContain('–');
    expect(deck).toContain('–');
    expect(pdf).toContain('não apurado');
    expect(deck).toContain('não apurado');
  });

  it('os dois declaram o que não foi apurado na seção de método', () => {
    expect(pdf).toContain('O que não foi apurado');
    expect(deck).toContain('O que não foi apurado');
  });

  it('o risco de folha não é pontuado em nenhum dos dois', () => {
    expect(model.executive.risk.score.measured).toBe(false);
    expect(pdf).toContain('não é apurável');
  });
});

describe('marca da empresa atravessa os destinos', () => {
  const customLogo = 'data:image/png;base64,QUNNRUxPR088';
  const branded = buildWorkforceOverviewModel({
    period: { key: 'current-year' },
    comparison: 'previous-period',
    rawSeries: series,
    approvedBatches: [],
    esocialLink: EMPTY_ESOCIAL_LINK,
    branding: {
      companyName: 'Acme Participações',
      logoDataUri: customLogo,
      logoSmallDataUri: customLogo,
      logoAspect: 2.5,
      logoAlt: 'Acme Participações',
      isCustomLogo: true,
      brandColor: '#7C3AED',
    },
  });

  it('o PDF usa o logo da empresa, nos dois temas', () => {
    for (const theme of ['dark', 'light'] as const) {
      const html = buildWorkforceOverviewPdfHtml(branded, { theme });
      expect(html, `tema ${theme}`).toContain(customLogo);
      expect(html, `tema ${theme}`).toContain('Acme Participações');
    }
  });

  it('a apresentação usa o logo da empresa', () => {
    const deck = buildWorkforceOverviewPresentationHtml(branded);
    expect(deck).toContain(customLogo);
    expect(deck).toContain('Acme Participações');
  });

  it('nenhum destino embute a marca do produto quando há logo da empresa', () => {
    const pdf = buildWorkforceOverviewPdfHtml(branded);
    const deck = buildWorkforceOverviewPresentationHtml(branded);
    // O wordmark do produto é um PNG base64 que começa com esta assinatura.
    const productLogoSignature = FALLBACK_REPORT_BRANDING.logoDataUri.slice(0, 80);
    expect(pdf).not.toContain(productLogoSignature);
    expect(deck).not.toContain(productLogoSignature);
  });

  it('sem logo da empresa, os destinos usam a marca do produto e não quebram', () => {
    const plain = buildWorkforceOverviewModel({
      period: { key: 'current-year' },
      comparison: 'previous-period',
      rawSeries: series,
      approvedBatches: [],
      esocialLink: EMPTY_ESOCIAL_LINK,
    });
    expect(plain.meta.branding).toBe(FALLBACK_REPORT_BRANDING);

    const pdf = buildWorkforceOverviewPdfHtml(plain);
    const deck = buildWorkforceOverviewPresentationHtml(plain);
    // Marca presente e embutida — nunca uma imagem quebrada.
    expect(pdf).toContain(FALLBACK_REPORT_BRANDING.logoDataUri.slice(0, 60));
    expect(deck).toContain(FALLBACK_REPORT_BRANDING.logoDataUri.slice(0, 60));
    expect(pdf).not.toMatch(/url\(['"]?https?:/);
    expect(deck).not.toMatch(/url\(['"]?https?:/);
  });

  it('a apresentação continua autocontida com logo da empresa', () => {
    const deck = buildWorkforceOverviewPresentationHtml(branded);
    expect(deck).not.toMatch(/<img[^>]+src=["']https?:/);
    expect(deck).not.toMatch(/url\(['"]?https?:/);
  });
});

describe('estrutura dos documentos', () => {
  it('o PDF numera todas as páginas com o total correto', () => {
    const model = build(series);
    const html = buildWorkforceOverviewPdfHtml(model);
    const pages = (html.match(/class="page[ "]/g) ?? []).length;
    // "Página N de TOTAL" é calculado na montagem porque o Chromium
    // renderiza `counter(pages)` como 0 na impressão.
    expect(html).toContain(`Página 1 de ${pages}`);
    expect(html).toContain(`Página ${pages} de ${pages}`);
  });

  it('a apresentação não depende de CDN nem de imagem remota', () => {
    const html = buildWorkforceOverviewPresentationHtml(build(series));
    expect(html).not.toMatch(/<script[^>]+src=["']http/);
    expect(html).not.toMatch(/<link[^>]+href=["']http/);
    expect(html).not.toMatch(/@import\s+url\(["']?http/);
    // Imagem remota é o que aparece QUEBRADA sem rede — logo e gráficos têm de
    // estar embutidos. As fontes Gilroy vêm da origem da aplicação por decisão
    // de `src/lib/fonts.ts` (embuti-las somaria 1–2 MB) e degradam para a
    // fonte de sistema offline, sem quebrar o layout.
    expect(html).not.toMatch(/url\(['"]?https?:[^)]*\.(png|jpe?g|svg|webp|gif)/i);
    expect(html).not.toMatch(/<img[^>]+src=["']https?:/i);
  });

  it('o documento sem competência ainda é um documento legível', () => {
    const model = build([]);
    const html = buildWorkforceOverviewPdfHtml(model);
    expect(html).toContain('Nenhuma competência apurada');
    // Capa, resumo, conformidade e método continuam existindo.
    expect((html.match(/class="page[ "]/g) ?? []).length).toBeGreaterThanOrEqual(4);
  });
});
