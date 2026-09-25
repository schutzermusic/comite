/**
 * DASHBOARD — O GLOBO (estilo APEX FILM, dado real; QA isolado).
 *
 *   API por papel      cada papel lê a visão da empresa; o que o perfil não lê
 *                      sai "Restrito" (nunca zero), sem valor em R$ para quem
 *                      não lê faturamento/recebíveis; os locais no globo só
 *                      têm posição real (oficial ou canteiro), finita
 *   local              /api/dashboard/site/[id] responde 200 com `ok:false` +
 *                      motivo para id inválido e para projeto de outro inquilino
 *   inquilino vazio    o outro inquilino não vê NADA do inquilino principal —
 *                      nem na visão, nem pedindo a cadeia de uma linha alheia
 *   Entender           a cadeia causal de uma linha real, com contenção
 *                      ("faz parte"), nunca "atrasa"
 *   estados            carregando (esqueleto sobre o palco), erro real
 *                      (servidor 500, com "Tentar de novo" e a barra superior),
 *                      parcial (seções restritas dizem "Restrito")
 *   globo              lista/marcador → vista do local (dg-site + dg-dock);
 *                      dock e teclado trocam o módulo (dg-plan, dg-supply,
 *                      dg-billing); Esc volta; a URL guarda o estado e o
 *                      Voltar do navegador funciona
 *   tela               1440 e 390 px, claro e escuro: sem rolagem horizontal,
 *                      sem NaN/Infinity no SVG, sem erro no console; no
 *                      celular a atenção vem antes do fluxo
 *
 * Capturas em test-results/dashboard-v2-shots — revisão visual, nunca versionadas.
 *
 *   npx playwright test -c playwright.qa.config.ts --project=desktop tests/qa-live/dashboard-v2.spec.ts
 */
import fs from 'node:fs';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { apiAs, authFile, type QaRole } from './support';
import type { DashboardOverview, ExplainResponse, SiteHudResponse } from '../../src/lib/dashboard/types';

test.setTimeout(240_000);

const SHOTS = process.env.DASHBOARD_SHOTS ?? 'test-results/dashboard-v2-shots';
const ROLES: QaRole[] = ['owner', 'gestor', 'engenharia', 'compras', 'almoxarifado', 'financeiro', 'juridico', 'rh', 'outsider'];
/** Os canteiros com coordenada do QA (cadastro do Supply, Pará). */
const QA_SITES = ['qa-scn-tucurui', 'qa-scn-maraba', 'qa-scn-barcarena'];

async function getAs<T>(role: QaRole, url: string): Promise<{ status: number; body: T }> {
  const api = await apiAs(role);
  try {
    const res = await api.get(url);
    return { status: res.status(), body: (await res.json()) as T };
  } finally {
    await api.dispose();
  }
}

async function overviewAs(role: QaRole): Promise<DashboardOverview> {
  const { status, body } = await getAs<DashboardOverview>(role, '/api/dashboard/overview');
  expect(status, `${role}: /api/dashboard/overview`).toBe(200);
  return body;
}

const explainAs = (role: QaRole, ref: string) => getAs<ExplainResponse>(role, `/api/dashboard/explain?ref=${encodeURIComponent(ref)}`);

const svgNonFinite = (page: Page) => page.evaluate(() => {
  const bad: string[] = [];
  for (const el of Array.from(document.querySelectorAll('svg, svg *'))) {
    for (const a of Array.from(el.attributes)) if (/NaN|Infinity/.test(a.value)) bad.push(`<${el.tagName} ${a.name}="${a.value.slice(0, 60)}">`);
    const style = (el as SVGElement).getAttribute('style') ?? '';
    if (/NaN|Infinity/.test(style)) bad.push(`<${el.tagName} style="${style.slice(0, 60)}">`);
  }
  return bad;
});
const horizontalOverflow = (page: Page) => page.evaluate(() => {
  const root = document.scrollingElement ?? document.documentElement;
  return root.scrollWidth - root.clientWidth;
});

async function open(browser: Browser, role: QaRole, viewport: { width: number; height: number }, theme: 'light' | 'dark') {
  const ctx = await browser.newContext({ storageState: authFile(role), viewport, colorScheme: theme, reducedMotion: 'reduce' });
  await ctx.addInitScript((t) => { try { localStorage.setItem('insight-theme-preference', t); } catch { /* sem armazenamento */ } }, theme);
  const page = await ctx.newPage();
  page.setDefaultTimeout(60_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
  return { ctx, page, errors };
}
const shot = async (page: Page, name: string, fullPage = true) => {
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage });
};
/**
 * A rede sossega — com teto: o globo ao vivo continua pedindo ladrilhos de
 * imagem enquanto a câmera assenta, então "rede ociosa" pode não chegar; o
 * que a prova precisa (o HUD com os dados) já foi esperado antes.
 */
const quiet = async (page: Page) => {
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);
  await page.waitForTimeout(800);
};
/**
 * O portfólio pronto: o painel com a organização (o esqueleto some). A visão
 * da empresa compõe vários modelos de leitura — no servidor de
 * desenvolvimento, sob carga, passa de 20 s; o prazo é o da leitura.
 */
const boardReady = async (page: Page) => {
  await expect(page.getByTestId('dashboard-globe')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId('dg-portfolio')).toBeVisible({ timeout: 90_000 });
};

test.describe('API por papel', () => {
  for (const role of ROLES) {
    test(`${role}: visão coerente — restrito nunca vira zero, nada de R$ sem permissão, posição só real`, async () => {
      const o = await overviewAs(role);
      expect(o.ok).toBe(true);
      expect(o.stages).toHaveLength(11);
      // `null` = não dá para saber (restrito/falhou) — nunca vira "não há operação".
      expect([true, false, null], `${role}: hasOperation`).toContain(o.hasOperation);
      for (const s of o.stages) {
        if (s.state !== 'ok') expect(s.stuck, `${role}: etapa ${s.id} ${s.state} não carrega número`).toBeNull();
        if (s.state === 'ok' && s.stuck === null) expect(s.reason, `${role}: etapa ${s.id} ok sem número diz por quê`).toBeTruthy();
        if (s.stuck) expect(Number.isFinite(s.stuck.value)).toBe(true);
      }
      for (const d of o.readable) expect(o.notReadable).not.toContain(d);
      if (o.feed.state === 'ok') {
        const f = o.feed.data;
        expect(Array.isArray(f.failed), `${role}: feed.failed`).toBe(true);
        expect(typeof f.partial, `${role}: feed.partial`).toBe('boolean');
        expect(f.total).toBeGreaterThanOrEqual(f.rows.length);
        for (const r of f.rows) {
          expect(o.readable, `${role}: linha ${r.key} de área não legível`).toContain(r.domain);
          expect(r.nextAction.href.startsWith('/')).toBe(true);
          expect(r.problem.length).toBeGreaterThan(0);
        }
      }
      // O globo: toda posição é finita e dentro do intervalo; nunca um centróide inventado.
      expect(o.sites, `${role}: seção sites`).toBeTruthy();
      if (o.sites.state === 'ok') {
        expect(o.sites.data.unlocated).toBeGreaterThanOrEqual(0);
        for (const m of o.sites.data.markers) {
          expect(Number.isFinite(m.position.lat) && Math.abs(m.position.lat) <= 90, `${role}: ${m.projectId} lat`).toBe(true);
          expect(Number.isFinite(m.position.lng) && Math.abs(m.position.lng) <= 180, `${role}: ${m.projectId} lng`).toBe(true);
          expect(['canonical', 'project_site']).toContain(m.position.source);
        }
      }
      // Sem leitura de faturamento/recebíveis, nenhum valor em R$ fora de Decisões
      // (o valor da decisão segue a máscara da própria caixa de Decisões).
      if (!o.readable.includes('faturamento') && !o.readable.includes('recebivel')) {
        const { decisions: _decisions, ...rest } = o;
        expect(JSON.stringify(rest), `${role}: valor monetário vazou`).not.toMatch(/R\$\s?\d/);
      }
      if (o.decisions.state === 'ok') {
        for (const d of o.decisions.data.top) {
          if (d.amountRestricted) expect(d.amountText).toBeNull();
          expect(d.href.startsWith('/decisoes')).toBe(true);
        }
      }
    });
  }

  test('inquilino vazio: nada do inquilino principal aparece (nem no globo)', async () => {
    const [main, other] = await Promise.all([overviewAs('owner'), overviewAs('outsider')]);
    expect(other.hasOperation).toBe(false);
    if (other.feed.state === 'ok') expect(other.feed.data.total).toBe(0);
    if (other.projects.state === 'ok') expect(other.projects.data.total).toBe(0);
    if (other.calendar.state === 'ok') expect(other.calendar.data.items).toHaveLength(0);
    if (other.sites.state === 'ok') expect(other.sites.data.markers).toHaveLength(0);
    const body = JSON.stringify(other);
    const mainIds = [
      ...(main.projects.state === 'ok' ? main.projects.data.rows.map((p) => p.projectId) : []),
      ...(main.feed.state === 'ok' ? main.feed.data.rows.map((r) => r.location.id).filter(Boolean) as string[] : []),
      ...(main.sites.state === 'ok' ? main.sites.data.markers.map((m) => m.projectId) : []),
    ];
    for (const id of mainIds) expect(body).not.toContain(id);
  });
});

test.describe('local em foco (API)', () => {
  test('dono lê o local; id inválido e projeto alheio respondem 200 com motivo', async () => {
    const own = await getAs<SiteHudResponse>('owner', `/api/dashboard/site/${QA_SITES[0]}`);
    expect(own.status).toBe(200);
    expect(own.body.ok).toBe(true);
    if (own.body.ok) {
      expect(own.body.project.id).toBe(QA_SITES[0]);
      if (own.body.location.state === 'ok' && own.body.location.data.position) {
        const p = own.body.location.data.position;
        expect(Number.isFinite(p.lat) && Number.isFinite(p.lng)).toBe(true);
      }
      expect(JSON.stringify(own.body)).not.toMatch(/\batras(a|ará|aria)\b/i);
    }
    const invalid = await getAs<SiteHudResponse>('owner', `/api/dashboard/site/${encodeURIComponent('x;drop table')}`);
    expect(invalid.status).toBe(200);
    expect(invalid.body.ok).toBe(false);
    if (!invalid.body.ok) expect(invalid.body.reason).toBe('invalid');
    const foreign = await getAs<SiteHudResponse>('outsider', `/api/dashboard/site/${QA_SITES[0]}`);
    expect(foreign.status).toBe(200);
    expect(foreign.body.ok).toBe(false);
    if (!foreign.body.ok) expect(['not_found', 'restricted']).toContain(foreign.body.reason);
    expect(JSON.stringify(foreign.body)).not.toContain('Tucuruí');
  });
});

test.describe('Entender', () => {
  test('a cadeia de uma linha real: contenção, nunca "atrasa"; outro inquilino não lê', async () => {
    const o = await overviewAs('owner');
    test.skip(o.feed.state !== 'ok' || o.feed.data.rows.every((r) => !r.explainRef), 'sem linha explicável no QA');
    const rows = o.feed.state === 'ok' ? o.feed.data.rows.filter((r) => r.explainRef) : [];
    for (const r of rows.slice(0, 6)) {
      const { status, body } = await explainAs('owner', r.explainRef as string);
      expect(status, `explain ${r.explainRef}`).toBe(200);
      expect(body.ok).toBe(true);
      if (!body.ok) continue;
      expect(body.chain.length).toBeGreaterThan(0);
      expect(typeof body.detected.ownerApplicable, `explain ${r.explainRef}: ownerApplicable`).toBe('boolean');
      expect(JSON.stringify(body)).not.toMatch(/\batras(a|ará|aria)\b/i);
      if (body.nextAction) expect(body.nextAction.href.startsWith('/')).toBe(true);
    }
    // A rota responde 200 com `ok:false` (o Dashboard não gera erro de console); o motivo vem no corpo.
    const foreign = await explainAs('outsider', rows[0].explainRef as string);
    expect(foreign.status).toBe(200);
    expect(foreign.body.ok).toBe(false);
    if (!foreign.body.ok) expect(['not_found', 'restricted']).toContain(foreign.body.reason);
    expect(JSON.stringify(foreign.body)).not.toContain(rows[0].object);
  });

  test('referência inválida é recusada', async () => {
    for (const ref of ['', 'x:1', 'mat:not-a-uuid', 'sig:00000000-0000-0000-0000-000000000000;drop']) {
      const { status, body } = await explainAs('owner', ref);
      expect(status).toBe(200);
      expect(body.ok).toBe(false);
      if (!body.ok) expect(body.reason).toBe('invalid');
    }
  });
});

test.describe('estados da tela', () => {
  test('carregando mostra o esqueleto sobre o palco; erro real mostra "Tentar de novo" e recupera', async ({ browser }) => {
    const { ctx, page } = await open(browser, 'owner', { width: 1440, height: 900 }, 'dark');
    let fail = true;
    await page.route('**/api/dashboard/overview', async (route) => {
      await new Promise((r) => setTimeout(r, 1200));
      if (fail) await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'Falha simulada na leitura.' }) });
      else await route.continue();
    });
    await page.goto('/dashboard');
    await expect(page.getByRole('status', { name: /Carregando a situação/ })).toBeVisible();
    await expect(page.getByTestId('dg-globe')).toBeAttached();
    const alert = page.getByTestId('dashboard-globe').getByRole('alert');
    await expect(alert).toContainText('Não foi possível carregar');
    await expect(alert).toContainText('Falha simulada na leitura.');
    // A barra superior segue de pé (caminho e Recarregar).
    await expect(page.getByRole('navigation', { name: 'Caminho no Dashboard' })).toContainText('Portfólio');
    await expect(page.getByRole('button', { name: /Recarregar a situação/ })).toBeVisible();
    await shot(page, 'estado-erro-1440', false);
    fail = false;
    await page.getByRole('button', { name: 'Tentar de novo' }).click();
    await boardReady(page);
    await expect(page.getByTestId('dashboard-flow')).toBeVisible();
    await ctx.close();
  });

  test('perfil parcial (rh): seções que o perfil não lê dizem "Restrito", nunca zero', async ({ browser }) => {
    const o = await overviewAs('rh');
    const { ctx, page, errors } = await open(browser, 'rh', { width: 1440, height: 900 }, 'light');
    await page.goto('/dashboard');
    await boardReady(page);
    await quiet(page);
    const restricted = o.stages.filter((s) => s.state === 'restricted' || (s.state === 'ok' && s.stuck === null && s.noNumber === 'restricted'));
    if (restricted.length > 0) {
      const flow = page.getByTestId('dashboard-flow');
      await expect(flow.getByText('Restrito').first()).toBeVisible();
      // Etapa restrita não conta como "sem pendência", nem vira "não há operação em nenhuma etapa".
      await expect(flow).not.toContainText('Nenhuma etapa com pendência');
      await expect(flow).not.toContainText('Ainda não há operação em nenhuma etapa');
    }
    if (o.projects.state === 'restricted') {
      await expect(page.getByTestId('dg-portfolio').getByText('Restrito').first()).toBeVisible();
    }
    await shot(page, 'parcial-rh-1440');
    expect(errors).toEqual([]);
    await ctx.close();
  });

  test('inquilino vazio (outsider): globo sem marcador, "Ainda não há operação"', async ({ browser }) => {
    const { ctx, page, errors } = await open(browser, 'outsider', { width: 1440, height: 900 }, 'dark');
    await page.goto('/dashboard');
    await boardReady(page);
    await expect(page.getByTestId('dg-portfolio')).toContainText('Ainda não há operação');
    await expect(page.getByTestId('dg-portfolio').getByRole('button', { name: /Abrir no globo/ })).toHaveCount(0);
    await shot(page, 'vazio-outsider-1440', false);
    expect(errors).toEqual([]);
    await ctx.close();
  });
});

test.describe('globo: local e módulos', () => {
  test('lista → local (dg-site + dg-dock); dock e teclado trocam o módulo; Esc e Voltar', async ({ browser }) => {
    const o = await overviewAs('owner');
    test.skip(o.sites.state !== 'ok' || o.sites.data.markers.length === 0, 'sem local com posição no QA');
    const { ctx, page, errors } = await open(browser, 'owner', { width: 1440, height: 900 }, 'dark');
    await page.goto('/dashboard');
    await boardReady(page);
    // Um marcador para cada operação localizada, com o caminho de teclado na lista.
    const rows = page.getByTestId('dg-portfolio').getByRole('button', { name: /Abrir no globo/ });
    await expect(rows).toHaveCount(o.sites.state === 'ok' ? o.sites.data.markers.length : 0);
    await rows.first().click();
    await expect(page).toHaveURL(/[?&]site=/);
    await expect(page.getByTestId('dg-site')).toBeVisible();
    await expect(page.getByTestId('dg-dock')).toBeVisible();
    await expect(page.getByTestId('dg-site').getByRole('heading')).not.toHaveText('');
    await shot(page, 'local-1440', false);

    const tabs = page.getByTestId('dg-dock').getByRole('tab');
    await expect(tabs).toHaveCount(4);
    await page.getByTestId('dg-dock').getByRole('tab', { name: /Planejar/ }).click();
    await expect(page).toHaveURL(/[?&]m=plan/);
    await expect(page.getByTestId('dg-plan')).toBeVisible();
    await expect(page.getByTestId('dg-dock').getByRole('tab', { name: /Planejar/ })).toHaveAttribute('aria-selected', 'true');
    // Atalhos (fora de campo e de diálogo): 3 = Supply Chain, 4 = Faturamento, Esc = volta um nível.
    await page.keyboard.press('3');
    await expect(page).toHaveURL(/[?&]m=supply/);
    await expect(page.getByTestId('dg-supply')).toBeVisible();
    await page.keyboard.press('4');
    await expect(page).toHaveURL(/[?&]m=billing/);
    await expect(page.getByTestId('dg-billing')).toBeVisible();
    await shot(page, 'faturamento-1440', false);
    await page.keyboard.press('Escape');
    await expect(page).not.toHaveURL(/[?&]m=/);
    await expect(page.getByTestId('dg-site')).toBeVisible();
    // Voltar do navegador: o módulo anterior (Faturamento).
    await page.goBack();
    await expect(page).toHaveURL(/[?&]m=billing/);
    await page.keyboard.press('Escape');
    await expect(page).not.toHaveURL(/[?&]m=/);
    await page.keyboard.press('Escape');
    await expect(page).not.toHaveURL(/[?&]site=/);
    await boardReady(page);
    expect(await svgNonFinite(page)).toEqual([]);
    expect(errors, 'nenhum erro de console').toEqual([]);
    await ctx.close();
  });

  test('recarregar num módulo cai no mesmo lugar (URL é o estado)', async ({ browser }) => {
    const { ctx, page, errors } = await open(browser, 'owner', { width: 1440, height: 900 }, 'light');
    await page.goto(`/dashboard?site=${QA_SITES[0]}&m=plan`);
    await expect(page.getByTestId('dg-plan')).toBeVisible();
    await expect(page.getByTestId('dg-dock').getByRole('tab', { name: /Planejar/ })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('navigation', { name: 'Caminho no Dashboard' })).toContainText('Planejar');
    expect(errors).toEqual([]);
    await ctx.close();
  });

  test('390 px: local em folhas, dock em abas, sem rolagem lateral', async ({ browser }) => {
    const { ctx, page, errors } = await open(browser, 'owner', { width: 390, height: 844 }, 'dark');
    await page.goto(`/dashboard?site=${QA_SITES[0]}`);
    await expect(page.getByTestId('dg-site')).toBeVisible();
    await expect(page.getByTestId('dg-dock')).toBeVisible();
    for (const tab of await page.getByTestId('dg-dock').getByRole('tab').all()) {
      const box = await tab.boundingBox();
      expect(box && box.height >= 44, 'aba com 44 px de toque').toBe(true);
    }
    expect(await horizontalOverflow(page), 'rolagem horizontal').toBeLessThanOrEqual(0);
    await shot(page, 'local-390');
    await page.getByTestId('dg-dock').getByRole('tab', { name: /Supply/ }).click();
    await expect(page.getByTestId('dg-supply')).toBeVisible();
    expect(await horizontalOverflow(page), 'rolagem horizontal no Supply').toBeLessThanOrEqual(0);
    expect(errors).toEqual([]);
    await ctx.close();
  });
});

test('cabeçalho: um só selo de Decisões e um link "Decisões" visível', async ({ browser }) => {
  const { ctx, page } = await open(browser, 'owner', { width: 1440, height: 900 }, 'dark');
  await page.goto('/dashboard');
  await boardReady(page);
  await expect(page.getByTestId('header-decisions')).toHaveCount(1);
  await expect(page.getByRole('link', { name: /Decisões/ }).first()).toBeVisible();
  await ctx.close();
});

for (const [label, viewport] of [['1440', { width: 1440, height: 900 }], ['390', { width: 390, height: 844 }]] as const) {
  for (const theme of ['light', 'dark'] as const) {
    for (const role of ['owner', 'financeiro', 'outsider'] as const) {
      test(`tela ${label} px · ${theme} · ${role}: sem rolagem lateral, sem NaN, sem erro`, async ({ browser }) => {
        const { ctx, page, errors } = await open(browser, role, viewport, theme);
        await page.goto('/dashboard');
        await boardReady(page);
        await quiet(page);
        expect(await horizontalOverflow(page), 'rolagem horizontal').toBeLessThanOrEqual(0);
        expect(await svgNonFinite(page)).toEqual([]);
        await expect(page.getByTestId('dashboard-attention')).toBeVisible();
        await expect(page.getByTestId('dashboard-decisions')).toBeAttached();
        await expect(page.getByTestId('dashboard-calendar')).toBeAttached();
        if (label === '390') {
          // No celular a atenção vem ANTES do fluxo do negócio.
          const [attention, flow] = await Promise.all([
            page.getByTestId('dashboard-attention').boundingBox(),
            page.getByTestId('dashboard-flow').boundingBox(),
          ]);
          expect(attention && flow && attention.y < flow.y, 'atenção antes do fluxo').toBe(true);
        }
        await shot(page, `${role}-${label}-${theme}`);
        if (role === 'owner') {
          const explain = page.getByTestId('dashboard-attention').getByRole('button', { name: /^Entender:/ }).first();
          if (await explain.count()) {
            await explain.click();
            const panel = page.getByTestId('dashboard-explain');
            await expect(panel).toBeVisible();
            await expect(panel.getByRole('list', { name: 'Cadeia causal' })).toBeVisible({ timeout: 60_000 });
            // O painel vai por portal para fora do Dashboard: os tons --dv2-* precisam valer nele também.
            expect(await panel.evaluate((el) => getComputedStyle(el).getPropertyValue('--dv2-accent').trim()), 'tons no painel').not.toBe('');
            await expect(page).toHaveURL(/[?&]x=/);
            await quiet(page);
            expect(await horizontalOverflow(page), 'rolagem horizontal com o painel').toBeLessThanOrEqual(0);
            await shot(page, `${role}-${label}-${theme}-entender`, false);
            await page.keyboard.press('Escape');
            await expect(panel).toBeHidden();
            await expect(page).not.toHaveURL(/[?&]x=/);
          }
        }
        expect(errors, 'nenhum erro de console').toEqual([]);
        await ctx.close();
      });
    }
  }
}
