import { describe, expect, it } from 'vitest';
import { calculateInvestorPack } from '@/lib/finance/investor-pack/calculations';
import { apexMonthlyChart, apexMonthlyLineChart, apexCurveChart, apexBalanceChart, apexClientForecastChart } from '@/lib/finance/investor-pack/apex-charts';
import { compactChartCurrency, boxesOverlap, type LabelBox } from '@/lib/finance/investor-pack/chart-value-labels';
import { labelQaPack } from '../fixtures/investor-pack-pdf-labels';


function boxes(svg: string): LabelBox[] {
  return [...svg.matchAll(/data-label-box="([^"]+)"/g)].map((match) => {
    const [x, y, width, height] = match[1].split(',').map(Number);
    return { x, y, width, height };
  });
}

describe('Direct numeric references in projection PDF charts', () => {
  it.each([[94_000_000, 'R$ 940 mil'], [120_000_000, 'R$ 1,2 mi'], [800_000_000, 'R$ 8,0 mi'],
    [1_150_000_000, 'R$ 11,5 mi'], [11_320_000_000, 'R$ 113,2 mi'], [-120_000_000, '-R$ 1,2 mi'], [0, 'R$ 0']])(
    'formats %s cents as %s', (value, expected) => expect(compactChartCurrency(Number(value))).toBe(expected));

  it.each([1, 6, 12, 24, 60])('retains every monthly value without collisions in %s months', (count) => {
    const { points } = calculateInvestorPack(labelQaPack(count));
    const original = structuredClone(points);
    for (const renderer of [apexMonthlyChart, apexMonthlyLineChart, apexCurveChart, apexBalanceChart]) {
      const svg = renderer(points, { width: 980, height: 478, valueLabels: true });
      const layout = boxes(svg);
      expect(layout.length).toBe(count * 2);
      layout.forEach((box, i) => {
        expect(box.x).toBeGreaterThanOrEqual(70);
        expect(box.y).toBeGreaterThanOrEqual(8);
        expect(box.x + box.width).toBeLessThanOrEqual(958);
        expect(box.y + box.height).toBeLessThanOrEqual(400);
        layout.slice(i + 1).forEach((other) => expect(boxesOverlap(box, other)).toBe(false));
      });
    }
    expect(points).toEqual(original);
  }, 30_000);

  it('shows totals and color-linked major clients, omitting tiny segment callouts', () => {
    const pack = labelQaPack();
    const svg = apexClientForecastChart(pack.narrative.clientForecasts, pack.months.map((m) => m.period),
      { width: 980, height: 505, valueLabels: true });
    expect(boxes(svg)).toHaveLength(20); // Five monthly totals plus three major clients per month.
    expect((svg.match(/class="apex-value-leader"/g) ?? []).length).toBeGreaterThanOrEqual(15);
    expect(svg).toContain('R$ 11,5 mi');
    expect(svg).toMatch(/Axia<\/title>[\s\S]*?fill="#4D8DFF"/);
    expect(svg).not.toContain('data-value-cents="115000"');
  });

  it.each([12, 60])('keeps every client callout to the right of its bar, including the last of %s months', (count) => {
    const pack = labelQaPack(count);
    pack.narrative.clientForecasts.forEach((forecast) => {
      if (forecast.clientId === 'enel') forecast.client = 'Enel Green Power';
      if (forecast.clientId === 'axia') forecast.client = 'AXIA Energia';
    });
    const svg = apexClientForecastChart(pack.narrative.clientForecasts, pack.months.map((m) => m.period),
      { width: 980, height: 505, valueLabels: true });
    const bars = [...svg.matchAll(/<rect x="([\d.]+)" y="[\d.]+" width="([\d.]+)"[^>]*>\s*<title>([^<]+)<\/title>/g)];
    const labels = [...svg.matchAll(/data-label-box="([^"]+)">\s*<title>([^<]+)<\/title>/g)];
    const clients = labels.filter((label) => !label[2].endsWith('Total projetado'));
    expect(clients.length).toBeGreaterThan(0);
    for (const label of clients) {
      const [x, , width] = label[1].split(',').map(Number);
      const bar = bars.find((candidate) => candidate[3].startsWith(`${label[2]} ·`));
      expect(bar).toBeDefined();
      expect(x).toBeGreaterThan(Number(bar![1]) + Number(bar![2]));
      expect(x + width).toBeLessThanOrEqual(972);
      if (count === 12) {
        const nextBar = bars.filter((candidate) => Number(candidate[1]) > Number(bar![1]) + .1)
          .sort((a, b) => Number(a[1]) - Number(b[1]))[0];
        if (nextBar) expect(x + width).toBeLessThanOrEqual(Number(nextBar[1]));
      }
    }
    const layout = boxes(svg);
    layout.forEach((box, i) => layout.slice(i + 1).forEach((other) => expect(boxesOverlap(box, other)).toBe(false)));
  });

  it('keeps negative/zero values and does not enable labels in the interactive renderer', () => {
    const { points } = calculateInvestorPack(labelQaPack());
    points[0].balanceCents = -94_000_000;
    points[0].balanceCumulativeCents = -94_000_000;
    points[1].balanceCents = 0;
    expect(apexBalanceChart(points, { valueLabels: true })).toContain('-R$ 940 mil');
    expect(apexMonthlyChart(points)).not.toContain('apex-value-label');
    expect(apexMonthlyLineChart(points, { valueLabels: true })).toContain('stroke-dasharray="8 7"');
    expect(apexMonthlyChart(points, { valueLabels: true })).toContain('patternTransform="rotate(45)"');
  });

  it('handles coincident series at the top of the domain across 60 months', () => {
    const pack = labelQaPack(60);
    pack.months.forEach((month) => {
      month.revenueActualCents = 10_000_000_000;
      month.payrollActualCents = 10_000_000_000;
      month.revenueForecastCents = 0;
      month.payrollForecastCents = 0;
    });
    const { points } = calculateInvestorPack(pack);
    for (const renderer of [apexMonthlyChart, apexMonthlyLineChart, apexCurveChart, apexBalanceChart]) {
      const layout = boxes(renderer(points, { width: 980, height: 478, valueLabels: true }));
      expect(layout).toHaveLength(120);
      layout.forEach((box, index) => layout.slice(index + 1).forEach((other) => expect(boxesOverlap(box, other)).toBe(false)));
    }
  }, 30_000);
});
