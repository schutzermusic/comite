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
 *                      dg-billing); a migalha sobe UM nível; Esc vai ao
 *                      portfólio de qualquer vista (e re-enquadra depois de
 *                      arrastar; com Entender aberto só fecha o painel); o
 *                      dock "Portfólio" faz o mesmo; a URL guarda o estado e
 *                      o Voltar do navegador funciona
 *   mouse              arrastar o globo: a pessoa dirige a câmera, a vista
 *                      não troca e nada abre (soltar não é clique)
 *   modelo do local    a nota "Representação esquemática…" e pontos
 *                      acessíveis; o ponto da frente de obra abre Planejar
 *   Supply             "Analisar a rede" → plano do Apex (reservar →
 *                      transferir → comprar) com os rótulos do servidor, sem
 *                      enum cru; A × B por papel (quem cota decide, quem não
 *                      cota aguarda Compras, sem leitura = "Restrito"); busca
 *                      na internet desligada diz o motivo; o envio da cotação
 *                      não atende GET e some para quem não cota
 *   tela               1440 e 390 px, claro e escuro: sem rolagem horizontal,
 *                      sem NaN/Infinity no SVG, sem erro no console; no
 *                      celular a atenção vem antes do fluxo
 *
 * SÓ LEITURA: toda prova de tela aborta e anota qualquer não-GET a /api/**
 * (o Dashboard tem botões de ato governado — reservar, transferir, requisitar,
 * convidar/enviar, decidir, aprovar) e termina exigindo a lista vazia; diálogo
 * nativo é sempre recusado. As recusas por POST (403/400/404 e `ok:false`,
 * que voltam antes de qualquer leitura de negócio, e-mail ou auditoria) só
 * rodam com QA_REFUSAL_POSTS=1.
 *
 * Capturas em test-results/dashboard-v2-shots — revisão visual, nunca versionadas.
 *
 *   npx playwright test -c playwright.qa.config.ts --project=desktop tests/qa-live/dashboard-v2.spec.ts
 */
import fs from 'node:fs';
import { expect, test, type Browser, type Locator, type Page } from '@playwright/test';
import { apiAs, authFile, type QaRole } from './support';
import type {
  DashboardOverview, ExplainResponse, RfqView, SiteHudResponse, SiteSupplyData, SiteSupplyResponse, SupplierDiscoveryResponse,
} from '../../src/lib/dashboard/types';

test.setTimeout(240_000);

const SHOTS = process.env.DASHBOARD_SHOTS ?? 'test-results/dashboard-v2-shots';
const ROLES: QaRole[] = ['owner', 'gestor', 'engenharia', 'compras', 'almoxarifado', 'financeiro', 'juridico', 'rh', 'outsider'];
/** Os canteiros com coordenada do QA (cadastro do Supply, Pará). */
const QA_SITES = ['qa-scn-tucurui', 'qa-scn-maraba', 'qa-scn-barcarena'];
/** Recusas por POST (nada grava, nada envia) — só onde o QA as permite. */
const REFUSAL_POSTS = process.env.QA_REFUSAL_POSTS === '1';
/** Um UUID válido que não é fornecedor convidado nem requisito de ninguém: nenhuma recusa chega a enviar ou buscar. */
const NOBODY = '00000000-0000-4000-8000-000000000000';
/**
 * Enum cru ou id na tela = vazamento do modelo (a tela fala português). As
 * bordas são de letra Unicode — o `\b` do JS é ASCII e casaria "transfer" em
 * "transferência".
 */
const RAW = /(?<![\p{L}\p{N}_])(?:OPEN|DECIDED|CANCELLED|DRAFT|APPROVAL_REQUIRED|HOMOLOGATED|PROSPECT|reserve|transfer|buy|suggested|blocked|ai_unavailable|restricted|undefined|null|NaN)(?![\p{L}\p{N}_])|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/u;

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

/** O Supply do local como o papel o lê (`null` = a seção não veio `ok`). */
async function supplyAs(role: QaRole, projectId = QA_SITES[0]): Promise<SiteSupplyData | null> {
  const { status, body } = await getAs<SiteSupplyResponse>(role, `/api/dashboard/site/${projectId}/supply`);
  expect(status, `${role}: GET supply`).toBe(200);
  return body.ok && body.supply.state === 'ok' ? body.supply.data : null;
}
const rfqsOf = (d: SiteSupplyData | null): RfqView[] =>
  d && d.procurement.state === 'ok' ? d.procurement.data.requisitions.flatMap((r) => r.rfqs) : [];
/** O caso-demo: cotação ABERTA com as propostas A e B e sem decisão. */
const openAbRfq = (d: SiteSupplyData | null) => rfqsOf(d).find((q) => q.status === 'OPEN' && q.quotes.length >= 2 && !q.decision) ?? null;

/** Um POST que a rota RECUSA (só com QA_REFUSAL_POSTS=1): devolve o status e o corpo, se houver. */
async function refusalPostAs<T>(role: QaRole, url: string, data: unknown): Promise<{ status: number; body: T | null }> {
  if (!REFUSAL_POSTS) throw new Error('recusa por POST sem QA_REFUSAL_POSTS=1');
  const api = await apiAs(role);
  try {
    const res = await api.post(url, { data, maxRedirects: 0 });
    return { status: res.status(), body: (await res.json().catch(() => null)) as T | null };
  } finally {
    await api.dispose();
  }
}

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

/**
 * Um contexto por papel — SÓ LEITURA. Todo pedido não-GET a /api/** é
 * abortado e anotado em `blocked`: um seletor que derive para um botão de ato
 * nunca vira escrita no inquilino de QA nem e-mail a fornecedor. Diálogo
 * nativo é sempre recusado. Cada prova de tela termina exigindo `blocked` vazio.
 */
async function open(browser: Browser, role: QaRole, viewport: { width: number; height: number }, theme: 'light' | 'dark') {
  const ctx = await browser.newContext({ storageState: authFile(role), viewport, colorScheme: theme, reducedMotion: 'reduce' });
  await ctx.addInitScript((t) => { try { localStorage.setItem('insight-theme-preference', t); } catch { /* sem armazenamento */ } }, theme);
  const blocked: string[] = [];
  await ctx.route('**/api/**', (route) => {
    const req = route.request();
    if (req.method() === 'GET' || req.method() === 'HEAD') return route.fallback();
    blocked.push(`${req.method()} ${new URL(req.url()).pathname}`);
    return route.abort('blockedbyclient');
  });
  const page = await ctx.newPage();
  page.setDefaultTimeout(60_000);
  page.on('dialog', (d) => void d.dismiss().catch(() => undefined));
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    // "Failed to load resource" não diz qual — o endereço vai junto (qual leitura falhou).
    const at = /Failed to load resource/.test(m.text()) ? (m.location()?.url ?? '') : '';
    errors.push(`console: ${m.text()}${at ? ` — ${at.replace(/^https?:\/\/[^/]+/, '').split('?')[0]}` : ''}`);
  });
  return { ctx, page, errors, blocked };
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
 * O HUD vivo: o `dashboard-globe` do <main>. No `next dev`, o trecho em
 * streaming (`<div hidden id="S:0">`) traz por ~100 ms uma 2ª cópia do HUD;
 * sem este escopo, `getByTestId` casaria as duas (violação do modo estrito).
 * Toda busca por test id do HUD passa por aqui.
 */
const dg = (page: Page) => page.locator('main [data-testid="dashboard-globe"]');
/**
 * O portfólio pronto: o painel com a organização (o esqueleto some). A visão
 * da empresa compõe vários modelos de leitura — no servidor de
 * desenvolvimento, sob carga, passa de 20 s; o prazo é o da leitura.
 */
const boardReady = async (page: Page) => {
  await expect(dg(page)).toBeVisible({ timeout: 60_000 });
  await expect(dg(page).getByTestId('dg-portfolio')).toBeVisible({ timeout: 90_000 });
};
/** O palco do Cesium assentado. `false` = sem WebGL neste navegador (o palco caiu no aviso) — a prova pula, nunca finge. */
async function stageReady(page: Page): Promise<boolean> {
  const stage = dg(page).getByTestId('ag-stage');
  await expect(stage).toBeAttached({ timeout: 60_000 });
  await expect(stage).toHaveAttribute('data-status', /^(ready|error)$/, { timeout: 120_000 });
  return (await stage.getAttribute('data-status')) === 'ready';
}
type GlobeDebug = { control: 'auto' | 'user'; epoch: number; view: { lat: number; lng: number; dist: number; heading: number; pitch: number } | null };
/** Os contadores do motor (`window.__apexGlobe`) — só no build de desenvolvimento; `null` em produção. */
const globeDebug = (page: Page) => page.evaluate(() => {
  const d = (window as unknown as { __apexGlobe?: GlobeDebug }).__apexGlobe;
  return d ? { control: d.control, epoch: d.epoch, view: d.view ? { ...d.view } : null } : null;
});
/** Arrasta o globo por um ponto do palco sem painel (centro, 62% da altura: entre as colunas, acima da dica). */
async function dragGlobe(page: Page, dx: number, dy: number, onGrab?: () => Promise<void>) {
  const box = await dg(page).getByTestId('ag-stage').boundingBox();
  if (!box) throw new Error('palco sem caixa');
  const x = box.x + box.width / 2;
  const y = box.y + box.height * 0.62;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 40, y + 6, { steps: 4 });
  await onGrab?.();
  await page.mouse.move(x + dx, y + dy, { steps: 16 });
  await page.mouse.up();
}
/**
 * Quanto (0–1) da caixa de um elemento do palco a pessoa NÃO vê: sob um
 * painel do HUD (que fica acima do globo) ou fora da janela. Um texto
 * obrigatório escondido atrás de um painel não conta como mostrado.
 */
const hiddenShare = (el: Locator) => el.evaluate((node) => {
  const r = node.getBoundingClientRect();
  const area = Math.max(1, r.width * r.height);
  const root = node.closest('[data-testid="dashboard-globe"]');
  const shown = (p: Element) => (p as Element & { checkVisibility?: (o: object) => boolean })
    .checkVisibility?.({ opacityProperty: true, visibilityProperty: true }) ?? true;
  let under = 0;
  for (const p of Array.from(root?.querySelectorAll('.dg-hud .dg-col > *, .dg-hud .dg-dock, .dg-hud .dg-crumbs') ?? [])) {
    if (!shown(p)) continue;
    const q = p.getBoundingClientRect();
    const w = Math.min(r.right, q.right) - Math.max(r.left, q.left);
    const h = Math.min(r.bottom, q.bottom) - Math.max(r.top, q.top);
    if (w > 0 && h > 0) under += w * h;
  }
  const inW = Math.max(0, Math.min(r.right, window.innerWidth) - Math.max(r.left, 0));
  const inH = Math.max(0, Math.min(r.bottom, window.innerHeight) - Math.max(r.top, 0));
  return Math.min(1, (under + (area - inW * inH)) / area);
});
/** Abre a etapa do fluxo do Supply se ela estiver fechada. */
async function expandStep(step: Locator, timeout?: number) {
  if ((await step.getAttribute('data-open')) !== 'true') await step.getByRole('button', { expanded: false }).first().click({ timeout });
  await expect(step).toHaveAttribute('data-open', 'true', { timeout });
}
/** Supply do local: a necessidade carregou; varre a rede (quem lê estoque) ou vai direto ao plano (quem não lê). */
async function supplyFlow(page: Page) {
  await expect(dg(page).getByTestId('dg-supply')).toBeVisible();
  const scan = dg(page).getByTestId('dg-supply-scan');
  const direct = dg(page).getByRole('button', { name: 'Ver o plano do Apex' });
  await expect(scan.or(direct)).toBeVisible({ timeout: 60_000 });
  if (await scan.count()) await scan.click(); else await direct.click();
  await expect(dg(page).getByTestId('dg-supply-plan')).toBeVisible({ timeout: 30_000 });
}

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
    const { ctx, page, blocked } = await open(browser, 'owner', { width: 1440, height: 900 }, 'dark');
    let fail = true;
    await page.route('**/api/dashboard/overview', async (route) => {
      await new Promise((r) => setTimeout(r, 1200));
      if (fail) await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'Falha simulada na leitura.' }) });
      else await route.fallback();
    });
    await page.goto('/dashboard');
    await expect(page.getByRole('status', { name: /Carregando a situação/ })).toBeVisible();
    await expect(dg(page).getByTestId('dg-globe')).toBeAttached();
    const alert = dg(page).getByRole('alert');
    await expect(alert).toContainText('Não foi possível carregar');
    await expect(alert).toContainText('Falha simulada na leitura.');
    // A barra superior segue de pé (caminho e Recarregar).
    await expect(page.getByRole('navigation', { name: 'Caminho no Dashboard' })).toContainText('Portfólio');
    await expect(page.getByRole('button', { name: /Recarregar a situação/ })).toBeVisible();
    await shot(page, 'estado-erro-1440', false);
    fail = false;
    await page.getByRole('button', { name: 'Tentar de novo' }).click();
    await boardReady(page);
    await expect(dg(page).getByTestId('dashboard-flow')).toBeVisible();
    expect(blocked, 'nenhum ato (não-GET) tentado').toEqual([]);
    await ctx.close();
  });

  test('perfil parcial (rh): seções que o perfil não lê dizem "Restrito", nunca zero', async ({ browser }) => {
    const o = await overviewAs('rh');
    const { ctx, page, errors, blocked } = await open(browser, 'rh', { width: 1440, height: 900 }, 'light');
    await page.goto('/dashboard');
    await boardReady(page);
    await quiet(page);
    const restricted = o.stages.filter((s) => s.state === 'restricted' || (s.state === 'ok' && s.stuck === null && s.noNumber === 'restricted'));
    if (restricted.length > 0) {
      const flow = dg(page).getByTestId('dashboard-flow');
      await expect(flow.getByText('Restrito').first()).toBeVisible();
      // Etapa restrita não conta como "sem pendência", nem vira "não há operação em nenhuma etapa".
      await expect(flow).not.toContainText('Nenhuma etapa com pendência');
      await expect(flow).not.toContainText('Ainda não há operação em nenhuma etapa');
    }
    if (o.projects.state === 'restricted') {
      await expect(dg(page).getByTestId('dg-portfolio').getByText('Restrito').first()).toBeVisible();
    }
    await shot(page, 'parcial-rh-1440');
    expect(blocked, 'nenhum ato (não-GET) tentado').toEqual([]);
    expect(errors).toEqual([]);
    await ctx.close();
  });

  test('inquilino vazio (outsider): globo sem marcador, "Ainda não há operação"', async ({ browser }) => {
    const { ctx, page, errors, blocked } = await open(browser, 'outsider', { width: 1440, height: 900 }, 'dark');
    await page.goto('/dashboard');
    await boardReady(page);
    await expect(dg(page).getByTestId('dg-portfolio')).toContainText('Ainda não há operação');
    await expect(dg(page).getByTestId('dg-portfolio').getByRole('button', { name: /Abrir no globo/ })).toHaveCount(0);
    await shot(page, 'vazio-outsider-1440', false);
    expect(blocked, 'nenhum ato (não-GET) tentado').toEqual([]);
    expect(errors).toEqual([]);
    await ctx.close();
  });
});

test.describe('globo: local e módulos', () => {
  test('lista → local (dg-site + dg-dock); dock e teclado trocam o módulo; migalha sobe um nível, Esc vai ao portfólio; Voltar', async ({ browser }) => {
    const o = await overviewAs('owner');
    test.skip(o.sites.state !== 'ok' || o.sites.data.markers.length === 0, 'sem local com posição no QA');
    const { ctx, page, errors, blocked } = await open(browser, 'owner', { width: 1440, height: 900 }, 'dark');
    await page.goto('/dashboard');
    await boardReady(page);
    // Um marcador para cada operação localizada, com o caminho de teclado na lista.
    const rows = dg(page).getByTestId('dg-portfolio').getByRole('button', { name: /Abrir no globo/ });
    await expect(rows).toHaveCount(o.sites.state === 'ok' ? o.sites.data.markers.length : 0);
    await rows.first().click();
    await expect(page).toHaveURL(/[?&]site=/);
    await expect(dg(page).getByTestId('dg-site')).toBeVisible();
    await expect(dg(page).getByTestId('dg-dock')).toBeVisible();
    await expect(dg(page).getByTestId('dg-site').getByRole('heading')).not.toHaveText('');
    await shot(page, 'local-1440', false);

    const dock = dg(page).getByTestId('dg-dock');
    await expect(dock.getByRole('tab')).toHaveCount(4);
    await dock.getByRole('tab', { name: /Planejar/ }).click();
    await expect(page).toHaveURL(/[?&]m=plan/);
    await expect(dg(page).getByTestId('dg-plan')).toBeVisible();
    await expect(dock.getByRole('tab', { name: /Planejar/ })).toHaveAttribute('aria-selected', 'true');
    // Atalhos (fora de campo e de diálogo): 3 = Supply Chain, 4 = Faturamento, Esc = o INÍCIO (portfólio), de qualquer vista.
    await page.keyboard.press('3');
    await expect(page).toHaveURL(/[?&]m=supply/);
    await expect(dg(page).getByTestId('dg-supply')).toBeVisible();
    await page.keyboard.press('4');
    await expect(page).toHaveURL(/[?&]m=billing/);
    await expect(dg(page).getByTestId('dg-billing')).toBeVisible();
    await shot(page, 'faturamento-1440', false);
    // A migalha sobe UM nível: Faturamento → o local (Portfólio › <local> › Faturamento; o 2º botão é o local).
    await page.getByRole('navigation', { name: 'Caminho no Dashboard' }).getByRole('button').nth(1).click();
    await expect(page).not.toHaveURL(/[?&]m=/);
    await expect(page).toHaveURL(/[?&]site=/);
    await expect(dg(page).getByTestId('dg-site')).toBeVisible();
    // Voltar do navegador: o módulo anterior (Faturamento).
    await page.goBack();
    await expect(page).toHaveURL(/[?&]m=billing/);
    await expect(dg(page).getByTestId('dg-billing')).toBeVisible();
    // Esc, de dentro do módulo, vai direto ao portfólio — sem parar no local.
    await page.keyboard.press('Escape');
    await expect(page).not.toHaveURL(/[?&](site|m)=/);
    await boardReady(page);
    await expect(dock).toHaveAttribute('aria-hidden', 'true');
    // E o Voltar do navegador devolve o módulo de onde se saiu.
    await page.goBack();
    await expect(page).toHaveURL(/[?&]m=billing/);
    await expect(dg(page).getByTestId('dg-billing')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page).not.toHaveURL(/[?&](site|m)=/);
    await boardReady(page);
    expect(await svgNonFinite(page)).toEqual([]);
    expect(blocked, 'nenhum ato (não-GET) tentado').toEqual([]);
    expect(errors, 'nenhum erro de console').toEqual([]);
    await ctx.close();
  });

  test('arrastar o globo: a pessoa dirige a câmera, a vista não troca, nada abre', async ({ browser }) => {
    const { ctx, page, errors, blocked } = await open(browser, 'owner', { width: 1440, height: 900 }, 'dark');
    await page.goto('/dashboard');
    await boardReady(page);
    const ready = await stageReady(page);
    if (!ready) await ctx.close();
    test.skip(!ready, 'sem WebGL neste navegador: o palco caiu no aviso "O globo não carregou"');
    const stage = dg(page).getByTestId('ag-stage');
    await expect(stage).toHaveAttribute('data-interaction', 'full');
    const before = await globeDebug(page);
    await dragGlobe(page, 260, 50, async () => {
      await expect(stage).toHaveAttribute('data-grabbing', '1');
      if (before) await expect.poll(async () => (await globeDebug(page))?.control).toBe('user');
    });
    await expect(stage).not.toHaveAttribute('data-grabbing', '1');
    // Soltar depois de arrastar não é clique: nenhum local abre, a vista segue o portfólio.
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(dg(page)).toHaveAttribute('data-view', 'portfolio');
    if (before?.view) {
      const moved = (await globeDebug(page))?.view;
      expect(moved, 'a câmera tem vista depois de arrastar').toBeTruthy();
      const delta = Math.abs(moved!.lng - before.view.lng) + Math.abs(moved!.lat - before.view.lat) + Math.abs(moved!.heading - before.view.heading);
      expect(delta, 'a câmera saiu da pose do portfólio').toBeGreaterThan(0.5);
    }
    expect(blocked, 'nenhum ato (não-GET) tentado').toEqual([]);
    expect(errors).toEqual([]);
    await ctx.close();
  });

  test('Esc vai ao portfólio de qualquer vista (e re-enquadra depois de arrastar); dock "Portfólio" idem; com Entender aberto, Esc só fecha o painel', async ({ browser }) => {
    const site = await getAs<SiteHudResponse>('owner', `/api/dashboard/site/${QA_SITES[0]}`);
    expect(site.body.ok, `${QA_SITES[0]} legível para o dono`).toBe(true);
    const { ctx, page, errors, blocked } = await open(browser, 'owner', { width: 1440, height: 900 }, 'dark');
    // Do MÓDULO direto ao portfólio.
    await page.goto(`/dashboard?site=${QA_SITES[0]}&m=supply`);
    await expect(dg(page).getByTestId('dg-supply')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page).not.toHaveURL(/[?&](site|m)=/);
    await boardReady(page);
    await expect(dg(page).getByTestId('dg-dock')).toHaveAttribute('aria-hidden', 'true');
    // O dock "Portfólio" (aria-keyshortcuts=Escape) é o mesmo ato.
    await page.goto(`/dashboard?site=${QA_SITES[0]}&m=plan`);
    await expect(dg(page).getByTestId('dg-plan')).toBeVisible();
    const home = dg(page).getByTestId('dg-dock').getByRole('button', { name: 'Voltar ao portfólio', exact: true });
    await expect(home).toHaveAttribute('aria-keyshortcuts', 'Escape');
    await home.click();
    await expect(page).not.toHaveURL(/[?&](site|m)=/);
    await boardReady(page);
    // No portfólio, depois de arrastar: Esc não muda a URL, mas sobe a época — o globo volta ao enquadramento.
    if (await stageReady(page)) {
      await dragGlobe(page, 240, 40);
      const e0 = await globeDebug(page);
      await page.keyboard.press('Escape');
      await expect(page).toHaveURL(/\/dashboard$/);
      if (e0) {
        await expect.poll(async () => (await globeDebug(page))?.epoch).toBeGreaterThan(e0.epoch);
        await expect.poll(async () => (await globeDebug(page))?.control, { timeout: 15_000 }).toBe('auto');
      }
    }
    // Esc com Entender aberto sobre o LOCAL: fecha só o painel (o atalho não age com diálogo aberto).
    const explainable = site.body.ok && site.body.attention.state === 'ok' && site.body.attention.data.rows.slice(0, 6).some((r) => r.explainRef);
    await page.goto(`/dashboard?site=${QA_SITES[0]}`);
    await expect(dg(page).getByTestId('dg-site')).toBeVisible();
    if (explainable) {
      const explain = dg(page).getByTestId('dg-site-attention').getByRole('button', { name: /^Entender:/ }).first();
      await explain.click();
      await expect(page.getByTestId('dashboard-explain')).toBeVisible();
      await expect(page).toHaveURL(/[?&]x=/);
      await page.keyboard.press('Escape');
      await expect(page.getByTestId('dashboard-explain')).toBeHidden();
      await expect(page).not.toHaveURL(/[?&]x=/);
      await expect(page).toHaveURL(new RegExp(`[?&]site=${QA_SITES[0]}`));
      await expect(dg(page).getByTestId('dg-site')).toBeVisible();
    }
    expect(blocked, 'nenhum ato (não-GET) tentado').toEqual([]);
    expect(errors).toEqual([]);
    await ctx.close();
  });

  test('local: modelo esquemático com a nota obrigatória e pontos acessíveis; o ponto da frente de obra abre Planejar', async ({ browser }) => {
    const { ctx, page, errors, blocked } = await open(browser, 'owner', { width: 1440, height: 900 }, 'dark');
    await page.goto(`/dashboard?site=${QA_SITES[0]}`);
    await expect(dg(page).getByTestId('dg-site')).toBeVisible();
    const ready = await stageReady(page);
    if (!ready) await ctx.close();
    test.skip(!ready, 'sem WebGL neste navegador');
    const hot = dg(page).getByTestId('ag-hotspots');
    const note = hot.getByRole('note');
    await expect(note).toHaveText('Representação esquemática — não é o projeto executivo', { timeout: 30_000 });
    // A nota é obrigatória: visível, não escondida sob um painel do HUD nem cortada pela janela.
    await expect(note).toBeVisible();
    await expect.poll(() => hiddenShare(note), { timeout: 15_000, message: 'nota esquemática escondida sob o HUD' }).toBeLessThanOrEqual(0.05);
    // Todo ponto é um botão com nome acessível; o que leva a um módulo diz para onde.
    const front = hot.locator('button[data-hotspot="workfront"]');
    await expect(front).toBeVisible({ timeout: 30_000 });
    for (const b of await hot.locator('button[data-hotspot]').all()) {
      const label = (await b.getAttribute('aria-label')) ?? '';
      expect(label.trim(), `ponto ${await b.getAttribute('data-hotspot')} sem nome`).not.toBe('');
      if (await b.getAttribute('data-target')) expect(label).toMatch(/ — abre \S/);
    }
    await expect(front).toHaveAttribute('aria-label', /— abre Planejar$/);
    await shot(page, 'local-esquematico-1440', false);
    await front.click();
    await expect(page).toHaveURL(/[?&]m=plan/);
    await expect(dg(page).getByTestId('dg-plan')).toBeVisible();
    expect(blocked, 'nenhum ato (não-GET) tentado').toEqual([]);
    expect(errors).toEqual([]);
    await ctx.close();
  });

  test('recarregar num módulo cai no mesmo lugar (URL é o estado)', async ({ browser }) => {
    const { ctx, page, errors, blocked } = await open(browser, 'owner', { width: 1440, height: 900 }, 'light');
    await page.goto(`/dashboard?site=${QA_SITES[0]}&m=plan`);
    await expect(dg(page).getByTestId('dg-plan')).toBeVisible();
    await expect(dg(page).getByTestId('dg-dock').getByRole('tab', { name: /Planejar/ })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('navigation', { name: 'Caminho no Dashboard' })).toContainText('Planejar');
    expect(blocked, 'nenhum ato (não-GET) tentado').toEqual([]);
    expect(errors).toEqual([]);
    await ctx.close();
  });

  test('390 px: local em folhas, dock em abas, sem rolagem lateral', async ({ browser }) => {
    const { ctx, page, errors, blocked } = await open(browser, 'owner', { width: 390, height: 844 }, 'dark');
    await page.goto(`/dashboard?site=${QA_SITES[0]}`);
    await expect(dg(page).getByTestId('dg-site')).toBeVisible();
    await expect(dg(page).getByTestId('dg-dock')).toBeVisible();
    for (const tab of await dg(page).getByTestId('dg-dock').getByRole('tab').all()) {
      const box = await tab.boundingBox();
      expect(box && box.height >= 44, 'aba com 44 px de toque').toBe(true);
    }
    expect(await horizontalOverflow(page), 'rolagem horizontal').toBeLessThanOrEqual(0);
    await shot(page, 'local-390');
    await dg(page).getByTestId('dg-dock').getByRole('tab', { name: /Supply/ }).click();
    await expect(dg(page).getByTestId('dg-supply')).toBeVisible();
    expect(await horizontalOverflow(page), 'rolagem horizontal no Supply').toBeLessThanOrEqual(0);
    expect(blocked, 'nenhum ato (não-GET) tentado').toEqual([]);
    expect(errors).toEqual([]);
    await ctx.close();
  });
});

test.describe('Supply no globo (só leitura)', () => {
  test('"Analisar a rede de estoque" varre a rede e revela o plano do Apex (reservar → transferir → comprar), em português', async ({ browser }) => {
    const d = await supplyAs('owner');
    test.skip(!d || d.stock.state !== 'ok' || !d.focus, 'sem material em foco ou estoque legível no QA');
    const plan = d!.plan;
    const { ctx, page, errors, blocked } = await open(browser, 'owner', { width: 1440, height: 900 }, 'dark');
    await page.goto(`/dashboard?site=${QA_SITES[0]}&m=supply`);
    const supply = dg(page).getByTestId('dg-supply');
    await expect(supply).toHaveAttribute('data-stage', 'idle');
    // Antes do clique: só a necessidade (origem e saldo) — o plano não aparece.
    await expect(dg(page).getByTestId('dg-supply-origin')).toBeVisible();
    await expect(dg(page).getByTestId('dg-supply-balance')).toBeVisible();
    await expect(dg(page).getByTestId('dg-supply-plan')).toHaveCount(0);
    const reread = page.waitForResponse((r) => r.url().includes(`/api/dashboard/site/${QA_SITES[0]}/supply`) && r.request().method() === 'GET');
    await dg(page).getByTestId('dg-supply-scan').click();
    await reread; // a varredura RELÊ o Supply (dado vivo, não o de antes do clique)
    await expect(supply).toHaveAttribute('data-stage', 'revealed', { timeout: 30_000 });
    const ledger = dg(page).getByTestId('dg-supply-network');
    await expect(ledger).toBeVisible();
    await expect(ledger).toContainText('Rede de estoque');
    // O plano do Apex: um passo por passo do servidor, na ordem reservar → transferir → comprar.
    const panel = dg(page).getByTestId('dg-supply-plan');
    await expect(panel).toBeVisible();
    const step = panel.getByTestId('dg-supply-step-plan');
    await expect(step).toBeVisible();
    if (plan.state === 'ok') {
      // Depois de revelado, o fluxo assenta na etapa da vez e o plano pode fechar sozinho: a prova (re)abre a
      // etapa — aberta por clique, ela fica — e lê os passos de uma vez.
      const rank = { reserve: 0, transfer: 1, buy: 2 } as Record<string, number>;
      const verb = { reserve: 'Reservar', transfer: 'Transferir', buy: 'Comprar' } as const;
      await expect(async () => {
        await expandStep(step, 2_000);
        const items = step.getByTestId('dg-supply-plan-steps').locator(':scope > li');
        await expect(items).toHaveCount(plan.data.steps.length, { timeout: 2_000 });
        // A tela decompõe o rótulo do servidor (verbo + quantidade + origem); o rótulo inteiro fica no `title`.
        const titles = await items.evaluateAll((els) => els.map((e) => e.getAttribute('title') ?? ''));
        expect([...titles].sort()).toEqual(plan.data.steps.map((s) => s.label).sort());
        const kinds = await items.evaluateAll((els) => els.map((e) => e.getAttribute('data-kind') ?? ''));
        expect(kinds, 'reservar → transferir → comprar').toEqual([...kinds].sort((a, b) => rank[a] - rank[b]));
        for (const s of plan.data.steps) await expect(step.locator(`li[data-kind="${s.kind}"]`).first()).toContainText(verb[s.kind], { timeout: 2_000 });
      }).toPass({ timeout: 30_000 });
    }
    expect(await panel.innerText(), 'enum cru ou id no plano').not.toMatch(RAW);
    // No globo (com WebGL): cada posição da rede responde com o texto do cartão ("… disponíveis" / "sem saldo disponível").
    if (await stageReady(page)) {
      await expect(dg(page).locator('.ag-labels .wl-node').first()).toBeVisible({ timeout: 30_000 });
      await expect(dg(page).locator('.ag-labels .wl-node .wl-val').filter({ hasText: /disponíve(is|l)/ }).first()).toBeVisible();
    }
    await shot(page, 'supply-plano-1440', false);
    // "Analisar a rede de novo" relê e mantém o plano (a revelação não se desfaz).
    await dg(page).getByTestId('dg-supply-scan').click();
    await expect(dg(page).getByTestId('dg-supply-plan')).toBeVisible();
    expect(blocked, 'nenhum ato (não-GET) tentado').toEqual([]);
    expect(errors).toEqual([]);
    await ctx.close();
  });

  // Quem cota (procurement.source) decide; quem não cota aguarda Compras; sem leitura de compras = "Restrito".
  for (const c of [
    { role: 'compras', expect: 'decide' }, { role: 'owner', expect: 'decide' }, { role: 'engenharia', expect: 'decide' },
    { role: 'gestor', expect: 'wait' }, { role: 'financeiro', expect: 'wait' }, { role: 'almoxarifado', expect: 'wait' },
    { role: 'juridico', expect: 'wait' }, { role: 'rh', expect: 'restricted' },
  ] as Array<{ role: QaRole; expect: 'decide' | 'wait' | 'restricted' }>) {
    const title = c.expect === 'decide' ? 'quem cota vê "Decidir fornecedor"'
      : c.expect === 'wait' ? 'quem não cota aguarda Compras, sem botão de ato' : 'sem leitura de compras diz "Restrito", nunca "nenhuma cotação"';
    test(`A × B (${c.role}): ${title}`, async ({ browser }) => {
      const demo = openAbRfq(await supplyAs('owner'));
      test.skip(!demo, 'o caso-demo (cotação aberta com A e B, sem decisão) não está no QA');
      const d = await supplyAs(c.role);
      expect(d, `${c.role}: Supply legível`).toBeTruthy();
      // O servidor e a tela dizem a mesma alçada.
      expect(d!.capabilities.source, `${c.role}: procurement.source`).toBe(c.expect === 'decide');
      if (c.expect === 'restricted') expect(d!.procurement.state, `${c.role}: compras`).toBe('restricted');
      const rfq = c.expect === 'restricted' ? null : rfqsOf(d).find((q) => q.id === demo!.id) ?? null;
      if (c.expect !== 'restricted') expect(rfq, `${c.role}: lê a cotação ${demo!.number}`).toBeTruthy();

      const { ctx, page, errors, blocked } = await open(browser, c.role, { width: 1440, height: 900 }, 'light');
      await page.goto(`/dashboard?site=${QA_SITES[0]}&m=supply`);
      if (c.expect === 'restricted') {
        const supply = dg(page).getByTestId('dg-supply');
        await expect(supply.getByText('Restrito').first()).toBeVisible({ timeout: 60_000 });
        // Plano, compras e fornecedores todos restritos: não há o que ver — o fluxo não é oferecido e a tela diz por quê.
        const flowReadable = [d!.plan.state, d!.procurement.state, d!.suppliers.state].some((s) => s !== 'restricted');
        if (flowReadable) {
          await supplyFlow(page);
          const quotes = dg(page).getByTestId('dg-supply-step-quotes');
          await expect(quotes).toBeVisible({ timeout: 30_000 });
          // Fechada, a etapa já diz "Restrito" no resumo — restrito não é vazio.
          await expect(quotes.getByRole('heading')).toContainText('Restrito');
          await expandStep(quotes);
          await expect(quotes).toContainText('Restrito');
        } else {
          await expect(dg(page).getByTestId('dg-supply-scan')).toHaveCount(0);
          await expect(dg(page).getByRole('button', { name: 'Ver o plano do Apex' })).toHaveCount(0);
          await expect(dg(page).getByTestId('dg-supply-plan')).toHaveCount(0);
        }
        await expect(supply).not.toContainText(/nenhuma cotação/i);
        await expect(dg(page).getByTestId('dg-supply-ab')).toHaveCount(0);
        await expect(dg(page).getByTestId('dg-supply-decide')).toHaveCount(0);
      } else {
        await supplyFlow(page);
        const quotes = dg(page).getByTestId('dg-supply-step-quotes');
        await expect(quotes).toBeVisible({ timeout: 30_000 });
        await expect(quotes).toHaveAttribute('data-open', 'true');
        const ab = dg(page).getByTestId('dg-supply-ab');
        await expect(ab).toContainText(rfq!.number);
        const a = ab.getByRole('article', { name: /^Proposta A: / });
        const b = ab.getByRole('article', { name: /^Proposta B: / });
        await expect(a).toBeVisible();
        await expect(b).toBeVisible();
        // A é a recomendada pela Apex (a recomendação vem do servidor; a IA não decide).
        await expect(a).toContainText('Recomendada pela Apex');
        const rec = rfq!.quotes.find((q) => q.recommended);
        if (rec) await expect(a).toContainText(rec.supplier.name);
        for (const q of rfq!.quotes.slice(0, 2)) if (q.totalText) await expect(ab).toContainText(q.totalText);
        await expect(ab).not.toContainText(/R\$\s?0(,00)?\b/);
        await expect(dg(page).getByTestId('dg-supply-recommendation')).toBeVisible();
        const gov = dg(page).getByTestId('dg-supply-governance');
        if (c.expect === 'decide') {
          // O ato existe e está habilitado para quem cota — a prova nunca o aciona.
          await expect(gov.getByTestId('dg-supply-decide')).toBeVisible();
          await expect(gov.getByTestId('dg-supply-decide')).toBeEnabled();
        } else {
          await expect(gov.getByTestId('dg-supply-decide')).toHaveCount(0);
          await expect(gov).toContainText('Aguardando a decisão de Compras');
        }
        expect(await ab.innerText(), 'enum cru ou id no A × B').not.toMatch(RAW);
      }
      await shot(page, `supply-ab-${c.role}-1440`, false);
      expect(blocked, 'nenhum ato (não-GET) tentado').toEqual([]);
      expect(errors).toEqual([]);
      await ctx.close();
    });
  }

  test('busca na internet (Apex) desligada: a tela diz o motivo do servidor, sem botão de busca, e a lista interna segue', async ({ browser }) => {
    const d = await supplyAs('compras');
    test.skip(!d, 'Supply não legível');
    const ai = d!.capabilities.aiSearch;
    test.skip(ai.available, 'a busca está LIGADA nesta instalação — o QA isolado desliga a IA (appEnvForQa)');
    expect(ai.reason, 'o motivo vem do servidor').toBeTruthy();
    const { ctx, page, errors, blocked } = await open(browser, 'compras', { width: 1440, height: 900 }, 'dark');
    await page.goto(`/dashboard?site=${QA_SITES[0]}&m=supply`);
    await supplyFlow(page);
    const sup = dg(page).getByTestId('dg-supply-step-suppliers');
    await expect(sup).toBeVisible({ timeout: 30_000 });
    await expandStep(sup);
    const off = sup.getByTestId('dg-supply-discover-off');
    await expect(off).toBeVisible();
    await expect(off).toContainText(ai.reason as string);
    await expect(off).toContainText('A lista interna acima segue valendo');
    await expect(sup.getByTestId('dg-supply-discover')).toHaveCount(0);
    expect(blocked, 'nenhum ato — nem a busca').toEqual([]);
    expect(errors).toEqual([]);
    await ctx.close();
  });

  test('busca na internet: a rota recusa sem alçada, com a IA desligada e com corpo inválido — antes de ler ou auditar', async () => {
    test.skip(!REFUSAL_POSTS, 'recusas por POST só com QA_REFUSAL_POSTS=1');
    const d = await supplyAs('compras');
    // Com a IA LIGADA, o POST de quem tem alçada chegaria ao provedor: aí a prova não roda.
    test.skip(!d || d.capabilities.aiSearch.available, 'a busca precisa estar DESLIGADA para esta prova');
    const url = `/api/dashboard/site/${QA_SITES[0]}/supply/discover`;
    const cases: Array<{ role: QaRole; data: unknown; reason: string }> = [
      { role: 'compras', data: { requirementId: 'x;drop' }, reason: 'invalid' },
      { role: 'rh', data: { requirementId: NOBODY }, reason: 'restricted' },
      { role: 'compras', data: { requirementId: NOBODY }, reason: 'ai_unavailable' },
    ];
    for (const k of cases) {
      const { status, body } = await refusalPostAs<SupplierDiscoveryResponse>(k.role, url, k.data);
      expect(status, `${k.role}: discover`).toBe(200);
      expect(body?.ok, `${k.role}: discover recusado`).toBe(false);
      if (body && !body.ok) {
        expect(body.reason, `${k.role}: motivo`).toBe(k.reason);
        expect(body.message.trim(), `${k.role}: mensagem`).not.toBe('');
      }
    }
  });

  test('envio da cotação: a rota não atende GET (link/prefetch nunca envia) e quem não cota não vê o botão', async ({ browser }) => {
    const rfq = rfqsOf(await supplyAs('owner')).find((q) => q.status === 'OPEN') ?? null;
    test.skip(!rfq, 'sem cotação aberta no QA');
    for (const role of ['compras', 'rh', 'outsider'] as QaRole[]) {
      const api = await apiAs(role);
      try {
        const res = await api.get(`/api/supply/procurement/rfqs/${rfq!.id}/send`, { maxRedirects: 0 });
        expect(res.status(), `${role}: GET no envio`).toBe(405);
      } finally {
        await api.dispose();
      }
    }
    for (const role of ['gestor', 'financeiro'] as QaRole[]) {
      const d = await supplyAs(role);
      expect(d?.capabilities.source, `${role}: procurement.source`).toBe(false);
      const { ctx, page, errors, blocked } = await open(browser, role, { width: 1440, height: 900 }, 'light');
      await page.goto(`/dashboard?site=${QA_SITES[0]}&m=supply`);
      await supplyFlow(page);
      const sup = dg(page).getByTestId('dg-supply-step-suppliers');
      await expect(sup).toBeVisible({ timeout: 30_000 });
      await expandStep(sup);
      await expect(sup.getByTestId('dg-supply-suppliers')).toBeVisible();
      await expect(sup.getByTestId('dg-supply-send')).toHaveCount(0);
      await expect(sup.getByTestId('dg-supply-invite')).toHaveCount(0);
      expect(blocked, `${role}: nenhum ato (não-GET) tentado`).toEqual([]);
      expect(errors).toEqual([]);
      await ctx.close();
    }
  });

  test('envio da cotação: a rota recusa quem não cota (403), id inválido (400) e cotação de outra organização (403/404)', async () => {
    test.skip(!REFUSAL_POSTS, 'recusas por POST só com QA_REFUSAL_POSTS=1');
    const before = rfqsOf(await supplyAs('owner')).find((q) => q.status === 'OPEN') ?? null;
    test.skip(!before, 'sem cotação aberta no QA');
    const url = (id: string) => `/api/supply/procurement/rfqs/${id}/send`;
    // Sempre um fornecedor NÃO convidado: mesmo que um portão regrida, a rota para em 422 — nunca envia e-mail.
    const body = { supplierIds: [NOBODY] };
    for (const role of ['gestor', 'financeiro', 'almoxarifado', 'juridico', 'rh'] as QaRole[]) {
      const d = await supplyAs(role);
      expect(d?.capabilities.source ?? false, `${role}: procurement.source`).toBe(false);
      expect((await refusalPostAs(role, url(before!.id), body)).status, `${role}: sem alçada`).toBe(403);
    }
    expect((await refusalPostAs('compras', url('not-a-uuid'), body)).status, 'compras: id inválido').toBe(400);
    expect([403, 404], 'outsider: cotação de outra organização').toContain((await refusalPostAs('outsider', url(before!.id), body)).status);
    // Nada mudou na cotação.
    const after = rfqsOf(await supplyAs('owner')).find((q) => q.id === before!.id);
    expect(after?.status).toBe('OPEN');
    expect(after?.quotes.length).toBe(before!.quotes.length);
    expect(after?.invited.map((i) => i.sentAt)).toEqual(before!.invited.map((i) => i.sentAt));
  });
});

test('cabeçalho: um só selo de Decisões e um link "Decisões" visível', async ({ browser }) => {
  const { ctx, page, blocked } = await open(browser, 'owner', { width: 1440, height: 900 }, 'dark');
  await page.goto('/dashboard');
  await boardReady(page);
  await expect(page.getByTestId('header-decisions')).toHaveCount(1);
  await expect(page.getByRole('link', { name: /Decisões/ }).first()).toBeVisible();
  expect(blocked, 'nenhum ato (não-GET) tentado').toEqual([]);
  await ctx.close();
});

for (const [label, viewport] of [['1440', { width: 1440, height: 900 }], ['390', { width: 390, height: 844 }]] as const) {
  for (const theme of ['light', 'dark'] as const) {
    for (const role of ['owner', 'financeiro', 'outsider'] as const) {
      test(`tela ${label} px · ${theme} · ${role}: sem rolagem lateral, sem NaN, sem erro`, async ({ browser }) => {
        const { ctx, page, errors, blocked } = await open(browser, role, viewport, theme);
        await page.goto('/dashboard');
        await boardReady(page);
        await quiet(page);
        expect(await horizontalOverflow(page), 'rolagem horizontal').toBeLessThanOrEqual(0);
        expect(await svgNonFinite(page)).toEqual([]);
        await expect(dg(page).getByTestId('dashboard-attention')).toBeVisible();
        await expect(dg(page).getByTestId('dashboard-decisions')).toBeAttached();
        await expect(dg(page).getByTestId('dashboard-calendar')).toBeAttached();
        if (label === '390') {
          // No celular a atenção vem ANTES do fluxo do negócio.
          const [attention, flow] = await Promise.all([
            dg(page).getByTestId('dashboard-attention').boundingBox(),
            dg(page).getByTestId('dashboard-flow').boundingBox(),
          ]);
          expect(attention && flow && attention.y < flow.y, 'atenção antes do fluxo').toBe(true);
        }
        await shot(page, `${role}-${label}-${theme}`);
        if (role === 'owner') {
          const explain = dg(page).getByTestId('dashboard-attention').getByRole('button', { name: /^Entender:/ }).first();
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
        expect(blocked, 'nenhum ato (não-GET) tentado').toEqual([]);
        expect(errors, 'nenhum erro de console').toEqual([]);
        await ctx.close();
      });
    }
  }
}
