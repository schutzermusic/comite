/**
 * O PAINEL NÃO DESENHA NaN (QA isolado, build de produção, organização vazia).
 *
 * Antes: o anel "Decisões / Votos" dividia 0 por 0 numa organização sem
 * deliberação em votação — `strokeDashoffset`, `cx` e `cy` saíam NaN (e o
 * denominador, `pendentes + aprovadas` com aprovadas sempre 0 no dado vivo,
 * fazia o anel marcar 100% sempre que houvesse uma votação). Agora a geometria
 * é finita na fonte, o vazio desenha só a trilha, e o denominador é real.
 *
 *   npx playwright test -c playwright.qa.config.ts --project=desktop tests/qa-live/dashboard-finite.spec.ts
 */
import { expect, test, type Page } from '@playwright/test';
import { authFile } from './support';

test.use({ storageState: authFile('owner') });

const svgNonFinite = (page: Page) => page.evaluate(() => {
  const bad: string[] = [];
  for (const el of Array.from(document.querySelectorAll('svg, svg *'))) {
    for (const a of Array.from(el.attributes)) {
      if (/NaN|Infinity/.test(a.value)) bad.push(`<${el.tagName} ${a.name}="${a.value.slice(0, 60)}">`);
    }
    const style = (el as SVGElement).getAttribute('style') ?? '';
    if (/NaN|Infinity/.test(style)) bad.push(`<${el.tagName} style="${style.slice(0, 60)}">`);
  }
  return bad;
});

for (const [label, viewport] of [['1440', { width: 1440, height: 900 }], ['390', { width: 390, height: 844 }]] as const) {
  for (const theme of ['light', 'dark'] as const) {
    test(`/dashboard ${label} px · ${theme}: nenhum NaN no SVG, nenhum erro no console`, async ({ browser }) => {
      const ctx = await browser.newContext({ storageState: authFile('owner'), viewport, colorScheme: theme });
      await ctx.addInitScript((v) => { try { localStorage.setItem('insight-theme-preference', v); } catch { /* sem armazenamento */ } }, theme);
      const page = await ctx.newPage();
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
      page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
      await page.goto('/dashboard');
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(3000);
      expect(await svgNonFinite(page)).toEqual([]);
      expect(errors.filter((e) => /NaN|Infinity|Expected length|Received NaN/.test(e))).toEqual([]);
      expect(errors, 'nenhum erro de console no painel').toEqual([]);
      await page.screenshot({ path: `test-results/dashboard-finite-shots/${label}-${theme}.png` });
      await ctx.close();
    });
  }
}
