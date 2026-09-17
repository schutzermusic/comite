/** Run with: npx tsx scripts/qa-investor-pack-pdf-labels.ts */
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { buildInvestorPackPdfHtml } from '@/lib/finance/investor-pack/apex-pdf';
import { labelQaPack } from '../tests/fixtures/investor-pack-pdf-labels';

async function main() {
  const output = path.resolve('output/pdf');
  await fs.mkdir(output, { recursive: true });
  const faces = await Promise.all([400, 600, 700, 800].map(async (weight, i) => {
    const file = ['Regular', 'SemiBold', 'Bold', 'ExtraBold'][i];
    const font = await fs.readFile(`public/fonts/gilroy/Gilroy-${file}.ttf`);
    return `@font-face { font-family: Gilroy; font-weight: ${weight}; src: url(data:font/ttf;base64,${font.toString('base64')}) }`;
  }));
  const browser = await chromium.launch({ headless: true });
  try {
    for (const count of [12, 60]) for (const theme of ['light', 'dark'] as const) {
      const pack = labelQaPack(count);
      pack.narrative.clientForecasts.forEach((forecast) => {
        if (forecast.clientId === 'enel') forecast.client = 'Enel Green Power';
        if (forecast.clientId === 'axia') forecast.client = 'AXIA Energia';
      });
      // Exercise negative bars and a zero month using the real export builder.
      if (count === 12) pack.months[0].revenueActualCents = 0;
      const html = buildInvestorPackPdfHtml(pack, { theme }).replace('<style>', `<style>${faces.join('\n')}`);
      const page = await browser.newPage({ viewport: { width: 1123, height: 794 } });
      await page.setContent(html, { waitUntil: 'load' });
      await page.evaluate(() => document.fonts.ready);
      await page.emulateMedia({ media: 'print' });
      const result = await page.evaluate(() => {
        const problems: string[] = [];
        const svgs = [...document.querySelectorAll<SVGSVGElement>('svg.apex-chart')];
        for (const svg of svgs) {
          const texts = [...svg.querySelectorAll<SVGTextElement>('.apex-value-label text')];
          const rects = texts.map((text) => text.getBoundingClientRect());
          const frame = svg.getBoundingClientRect();
          rects.forEach((r, i) => {
            if (r.left < frame.left || r.right > frame.right || r.top < frame.top || r.bottom > frame.bottom)
              problems.push(`Clipped label: ${texts[i].textContent}`);
            if (svg.getAttribute('aria-label') === 'Faturamento previsto por cliente') {
              const title = texts[i].parentElement?.querySelector('title')?.textContent ?? '';
              const bar = [...svg.querySelectorAll('rect')].find((rect) => rect.querySelector('title')?.textContent?.startsWith(`${title} ·`));
              if (bar && r.left <= bar.getBoundingClientRect().right)
                problems.push(`Client label must stay right of its bar: ${title}`);
            }
            rects.slice(i + 1).forEach((other) => {
              if (r.left < other.right && r.right > other.left && r.top < other.bottom && r.bottom > other.top)
                problems.push(`Overlapping label: ${texts[i].textContent}`);
            });
            for (const axis of svg.querySelectorAll<SVGTextElement>('.apex-axis')) {
              const a = axis.getBoundingClientRect();
              if (r.left < a.right && r.right > a.left && r.top < a.bottom && r.bottom > a.top)
                problems.push(`Axis/forecast collision: ${texts[i].textContent}`);
            }
          });
        }
        const pages = [...document.querySelectorAll<HTMLElement>('.page')];
        pages.forEach((p, i) => { if (p.scrollHeight > p.clientHeight + 2) problems.push(`Page overflow ${i + 1}: ${p.scrollHeight}/${p.clientHeight} ${p.querySelector('h2')?.textContent}`); });
        return { problems, pages: pages.length, labels: rectsCount(), charts: svgs.length };
        function rectsCount() { return document.querySelectorAll('.apex-value-label').length; }
      });

      const file = path.join(output, `projecao-rotulos-qa-${count}-${theme}.pdf`);
      await page.pdf({ path: file, format: 'A4', landscape: true, printBackground: true, preferCSSPageSize: true });
      console.log(JSON.stringify({ file, ...result }));
      assert.deepEqual(result.problems, [], `${count} months / ${theme}`);
      await page.close();
    }
  } finally { await browser.close(); }
}

void main().catch((error) => { console.error(error); process.exitCode = 1; });
