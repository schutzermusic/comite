/**
 * DASHBOARD V2 — "O QUE ESTÁ ACONTECENDO" (QA isolado).
 *
 *   API por papel      cada papel lê a visão da empresa; o que o perfil não lê
 *                      sai "Restrito" (nunca zero), sem valor em R$ para quem
 *                      não lê faturamento/recebíveis
 *   inquilino vazio    o outro inquilino não vê NADA do inquilino principal —
 *                      nem na visão, nem pedindo a cadeia de uma linha alheia
 *   Entender           a cadeia causal de uma linha real, com contenção
 *                      ("faz parte"), nunca "atrasa"
 *   estados            carregando (esqueleto), erro real (servidor 500, com
 *                      "Tentar de novo"), parcial (seções restritas)
 *   tela               1440 e 390 px, claro e escuro: sem rolagem horizontal,
 *                      sem NaN/Infinity no SVG, sem erro no console; no
 *                      celular a fila de atenção vem antes do fluxo
 *
 * Capturas em test-results/dashboard-v2-shots — revisão visual, nunca versionadas.
 *
 *   npx playwright test -c playwright.qa.config.ts --project=desktop tests/qa-live/dashboard-v2.spec.ts
 */
import fs from 'node:fs';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { apiAs, authFile, type QaRole } from './support';
import type { DashboardOverview, ExplainResponse } from '../../src/lib/dashboard/types';

test.setTimeout(180_000);

const SHOTS = 'test-results/dashboard-v2-shots';
const ROLES: QaRole[] = ['owner', 'gestor', 'engenharia', 'compras', 'almoxarifado', 'financeiro', 'juridico', 'rh', 'outsider'];

async function overviewAs(role: QaRole): Promise<DashboardOverview> {
  const api = await apiAs(role);
  try {
    const res = await api.get('/api/dashboard/overview');
    expect(res.status(), `${role}: /api/dashboard/overview`).toBe(200);
    return (await res.json()) as DashboardOverview;
  } finally {
    await api.dispose();
  }
}

async function explainAs(role: QaRole, ref: string) {
  const api = await apiAs(role);
  try {
    const res = await api.get(`/api/dashboard/explain?ref=${encodeURIComponent(ref)}`);
    return { status: res.status(), body: (await res.json()) as ExplainResponse };
  } finally {
    await api.dispose();
  }
}

const svgNonFinite = (page: Page) => page.evaluate(() => {
  const bad: string[] = [];
  for (const el of Array.from(document.querySelectorAll('svg, svg *'))) {
    for (const a of Array.from(el.attributes)) if (/NaN|Infinity/.test(a.value)) bad.push(`<${el.tagName} ${a.name}="${a.value.slice(0, 60)}">`);
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
const boardReady = (page: Page) => expect(page.getByRole('heading', { name: 'O que está acontecendo' })).toBeVisible();

test.describe('API por papel', () => {
  for (const role of ROLES) {
    test(`${role}: visão coerente — restrito nunca vira zero, nada de R$ sem permissão`, async () => {
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

  test('inquilino vazio: nada do inquilino principal aparece', async () => {
    const [main, other] = await Promise.all([overviewAs('owner'), overviewAs('outsider')]);
    expect(other.hasOperation).toBe(false);
    if (other.feed.state === 'ok') expect(other.feed.data.total).toBe(0);
    if (other.projects.state === 'ok') expect(other.projects.data.total).toBe(0);
    if (other.calendar.state === 'ok') expect(other.calendar.data.items).toHaveLength(0);
    const body = JSON.stringify(other);
    const mainIds = [
      ...(main.projects.state === 'ok' ? main.projects.data.rows.map((p) => p.projectId) : []),
      ...(main.feed.state === 'ok' ? main.feed.data.rows.map((r) => r.location.id).filter(Boolean) as string[] : []),
    ];
    for (const id of mainIds) expect(body).not.toContain(id);
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
  test('carregando mostra o esqueleto; erro real mostra "Tentar de novo" e recupera', async ({ browser }) => {
    const { ctx, page } = await open(browser, 'owner', { width: 1440, height: 900 }, 'light');
    let fail = true;
    await page.route('**/api/dashboard/overview', async (route) => {
      await new Promise((r) => setTimeout(r, 1200));
      if (fail) await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'Falha simulada na leitura.' }) });
      else await route.continue();
    });
    await page.goto('/dashboard');
    await expect(page.getByRole('status', { name: /Carregando a situação/ })).toBeVisible();
    await expect(page.getByTestId('dashboard-v2').getByRole('alert')).toContainText('Não foi possível carregar');
    await expect(page.getByRole('heading', { name: 'O que está acontecendo' })).toBeVisible();
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
    await page.waitForLoadState('networkidle');
    const restricted = o.stages.filter((s) => s.state === 'restricted');
    if (restricted.length > 0) {
      await expect(page.getByTestId('dashboard-flow').getByText('Restrito').first()).toBeVisible();
      // Etapa restrita não conta como "sem pendência", nem vira "não há operação em nenhuma etapa".
      await expect(page.getByTestId('dashboard-flow')).not.toContainText('Nenhuma etapa com pendência');
      await expect(page.getByTestId('dashboard-flow')).not.toContainText('Ainda não há operação em nenhuma etapa');
    }
    await shot(page, 'parcial-rh-1440');
    expect(errors).toEqual([]);
    await ctx.close();
  });
});

for (const [label, viewport] of [['1440', { width: 1440, height: 900 }], ['390', { width: 390, height: 844 }]] as const) {
  for (const theme of ['light', 'dark'] as const) {
    for (const role of ['owner', 'financeiro', 'outsider'] as const) {
      test(`tela ${label} px · ${theme} · ${role}: sem rolagem lateral, sem NaN, sem erro`, async ({ browser }) => {
        const { ctx, page, errors } = await open(browser, role, viewport, theme);
        await page.goto('/dashboard');
        await boardReady(page);
        await page.waitForLoadState('networkidle');
        await page.waitForTimeout(800);
        expect(await horizontalOverflow(page), 'rolagem horizontal').toBeLessThanOrEqual(0);
        expect(await svgNonFinite(page)).toEqual([]);
        await expect(page.getByTestId('dashboard-attention')).toBeVisible();
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
          const explain = page.getByRole('button', { name: /^Entender:/ }).first();
          if (await explain.count()) {
            await explain.click();
            const panel = page.getByTestId('dashboard-explain');
            await expect(panel).toBeVisible();
            await expect(panel.getByRole('list', { name: 'Cadeia causal' })).toBeVisible();
            // O painel vai por portal para fora de .dv2: os tons --dv2-* precisam valer nele também.
            expect(await panel.evaluate((el) => getComputedStyle(el).getPropertyValue('--dv2-accent').trim()), 'tons no painel').not.toBe('');
            await expect(page).toHaveURL(/[?&]x=/);
            await page.waitForLoadState('networkidle');
            expect(await horizontalOverflow(page), 'rolagem horizontal com o painel').toBeLessThanOrEqual(0);
            await shot(page, `${role}-${label}-${theme}-entender`, false);
          }
        }
        expect(errors, 'nenhum erro de console').toEqual([]);
        await ctx.close();
      });
    }
  }
}
