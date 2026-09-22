/**
 * E2E de INTERFACE — módulo Comercial e a navegação simplificada do pós-venda.
 *
 * O que este arquivo prova, e por que ele existe:
 *
 * A entrega anterior passou em typecheck, build, unidade, integração e nas 65
 * provas de banco — e mesmo assim `/comercial` não abria para ninguém, porque
 * as onze permissões `commercial.*` nasceram sem nenhuma concessão a papel.
 * Nada que não seja um navegador de verdade teria encontrado isso.
 *
 * Por isso as provas aqui são de RENDERIZAÇÃO e de ALÇADA, nas duas direções:
 * quem deve entrar entra, quem não deve continua fora.
 *
 * O branch NÃO semeou nenhuma linha comercial de propósito. Tela vazia é o
 * resultado CORRETO; o que não pode aparecer é negação de permissão, erro de
 * execução ou dado de mentira.
 *
 * Pré-requisitos:
 *   1. node scripts/qa-seed-workforce.mjs   (usuário QA owner_admin)
 *   2. servidor em http://localhost:9002
 * Rodar: npx playwright test tests/commercial-module.spec.ts --project=chromium
 */
import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config({ path: '.env' });
dotenv.config({ path: '.env.local' });

const qa = JSON.parse(readFileSync('tests/.qa-env.json', 'utf8')) as {
  email: string; password: string; orgId: string;
};

test.describe.configure({ mode: 'serial' });
test.setTimeout(120_000);

let ctx: BrowserContext;
let page: Page;

const db = () => new pg.Client({
  connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });

/**
 * Entra pela tela real de login.
 *
 * O envio é por `Enter` no campo de senha, e não por clique no botão. A tela
 * de login anima continuamente (inclinação 3D em framer-motion), então o
 * botão nunca fica "estável" pelo critério do Playwright e o clique entra em
 * laço de retentativa até estourar. `Enter` submete o mesmo `<form>`, pelo
 * mesmo `onSubmit`, sem depender de o alvo parar de se mexer.
 */
async function signIn(target: Page) {
  await target.goto('/login');
  await target.locator('input[type="email"]').fill(qa.email);
  const password = target.locator('input[type="password"]');
  await password.fill(qa.password);
  await password.press('Enter');
  await target.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 60_000 });
}

/**
 * Abre o submenu de um módulo na sidebar.
 *
 * O item do grupo é um `<Link>` (navega), e quem revela as áreas é um botão de
 * ação separado, rotulado "Expandir submenu de …". Procurar um `button` com o
 * nome do módulo não encontra nada — foi assim que a primeira versão destes
 * testes falhou.
 */
function sidebarGroupAction(target: Page, label: string) {
  /*
    O rótulo alterna entre "Expandir submenu de X" e "Recolher submenu de X"
    conforme o estado. Casar pelo texto fixo "Expandir" encontra o controle só
    enquanto ele está fechado — e some justamente quando a prova quer conferir
    que abriu. O seletor casa pelo SUFIXO, que não muda.
  */
  return target.locator(`[data-sidebar="menu-action"][aria-label$="submenu de ${label}"]`).first();
}

async function openSidebarGroup(target: Page, label: string) {
  const action = sidebarGroupAction(target, label);
  await expect(action).toBeVisible({ timeout: 30_000 });
  if ((await action.getAttribute('aria-expanded')) !== 'true') await action.click();
  await expect(action).toHaveAttribute('aria-expanded', 'true', { timeout: 15_000 });
}

/** Nenhuma tela pode exibir negação de permissão nem estouro de execução. */
async function expectNoFailureSurface(target: Page) {
  await expect(target.getByText(/Esta ação exige:/i)).toHaveCount(0);
  await expect(target.getByText(/Application error|Unhandled Runtime Error/i)).toHaveCount(0);
  await expect(target.getByText(/Não foi possível (carregar|consultar|calcular)/i)).toHaveCount(0);
}

test.beforeAll(async ({ browser }) => {
  ctx = await browser.newContext();
  page = await ctx.newPage();
  page.setDefaultTimeout(25_000);
  await signIn(page);
});

test.afterAll(async () => { await ctx?.close(); });

// ── 1 · Comercial: as seis áreas abrem ────────────────────────────────────

const COMMERCIAL_AREAS = [
  ['Visão Geral', ''],
  ['Contas & Contatos', 'contas'],
  ['Oportunidades', 'oportunidades'],
  ['Follow-ups', 'follow-ups'],
  ['Propostas', 'propostas'],
  ['Forecast', 'forecast'],
] as const;

for (const [label, slug] of COMMERCIAL_AREAS) {
  test(`1 · Comercial → ${label} renderiza sem negação nem erro`, async () => {
    await page.goto(slug ? `/comercial?view=${slug}` : '/comercial');
    // O cabeçalho é a prova de que a PÁGINA montou, e não só respondeu 200.
    await expect(page.getByRole('heading', { name: new RegExp(`Comercial · ${label}`) }))
      .toBeVisible({ timeout: 30_000 });
    await expectNoFailureSurface(page);
  });
}

test('2 · a sidebar do Comercial marca a área corrente', async () => {
  await page.goto('/comercial');
  /*
    Dentro de `/comercial` o grupo precisa NASCER aberto — as seis áreas moram
    em `?view=` e a sidebar é a única navegação entre elas. Uma versão anterior
    deste branch não ligou o estado do submenu, e a seta era um controle morto.
  */
  await expect(sidebarGroupAction(page, 'Comercial'))
    .toHaveAttribute('aria-expanded', 'true', { timeout: 30_000 });

  for (const [label, slug] of [['Oportunidades', 'oportunidades'], ['Propostas', 'propostas']] as const) {
    await page.getByRole('link', { name: label, exact: true }).first().click();
    await expect(page).toHaveURL(new RegExp(`/comercial\\?view=${slug}$`));
    await expect(page.getByRole('link', { name: label, exact: true }).first())
      .toHaveAttribute('aria-current', 'page');
  }
});

test('3 · vazio é estado vazio INTENCIONAL, não dado de mentira', async () => {
  await page.goto('/comercial?view=oportunidades');
  await expect(page.getByRole('heading', { name: /Comercial · Oportunidades/ })).toBeVisible();

  /*
    O branch não semeou nenhuma oportunidade. Ou a tela mostra o estado vazio
    explicativo, ou mostra linhas REAIS — e nunca um placeholder inventado
    para a tela parecer povoada.
  */
  const empty = page.getByText('Nenhuma oportunidade registrada');
  const rows = page.locator('section[aria-label="Oportunidades"] li');

  /*
    ESPERA de verdade, não contagem instantânea.

    A área busca os dados no cliente e passa por "Carregando…" antes de
    resolver. Contar na hora mede o estado intermediário e reprova uma tela
    correta — foi o que aconteceu na primeira execução destas provas.
  */
  await expect(empty.or(rows.first())).toBeVisible({ timeout: 40_000 });

  const emptyCount = await empty.count();
  const rowCount = await rows.count();
  expect(emptyCount > 0 || rowCount > 0).toBeTruthy();
  if (emptyCount > 0) expect(rowCount).toBe(0);
});

test('4 · o Forecast declara que não é receita', async () => {
  await page.goto('/comercial?view=forecast');
  await expect(page.getByRole('heading', { name: /Comercial · Forecast/ })).toBeVisible();
  await expectNoFailureSurface(page);
  // Quando há linhas, o aviso vem do SERVIDOR junto com os dados; sem linhas,
  // o estado vazio explica o recorte. Uma das duas coisas tem de estar na tela.
  const disclaimer = page.getByText(/não é receita contratada/i);
  const emptyState = page.getByText('Nada em aberto no funil');
  await expect(disclaimer.or(emptyState).first()).toBeVisible({ timeout: 40_000 });
});

// ── 5 · Pós-venda: cinco fases, e só elas ─────────────────────────────────

test('5 · a sidebar do pós-venda tem as cinco fases, e não as oito antigas', async () => {
  await page.goto('/contratos');
  await openSidebarGroup(page, 'Gestão de Contratos');

  for (const label of ['Visão Geral', 'Carteira', 'Ordens de Serviço',
                       'Medições & Aprovações', 'Faturamento']) {
    await expect(page.getByRole('link', { name: label, exact: true }).first()).toBeVisible();
  }
  // Os destinos antigos não podem voltar ao menu lateral.
  const sidebar = page.locator('[data-sidebar="sidebar"], aside').first();
  for (const gone of ['Renovações', 'Obrigações', 'Riscos & Cláusulas', 'Documentos']) {
    await expect(sidebar.getByRole('link', { name: gone, exact: true })).toHaveCount(0);
  }
});

test('6 · cada fase do pós-venda abre e monta', async () => {
  for (const [label, slug] of [
    ['Carteira', 'carteira'],
    ['Ordens de Serviço', 'ordens-de-servico'],
    ['Medições & Aprovações', 'medicoes'],
    ['Faturamento', 'faturamento'],
  ] as const) {
    await page.goto(`/contratos?view=${slug}`);
    await expect(page.getByTestId('portfolio-workspace')).toBeVisible({ timeout: 40_000 });
    await expectNoFailureSurface(page);
    expect(label).toBeTruthy();
  }
});

test('7 · slug ANTIGO ainda chega ao contexto certo, e não à visão geral', async () => {
  for (const legacy of ['obrigacoes', 'renovacoes', 'documentos', 'riscos-clausulas']) {
    await page.goto(`/contratos?view=${legacy}`);
    await expect(page.getByTestId('portfolio-workspace')).toBeVisible({ timeout: 40_000 });
    // A tira de contexto da Carteira é o que prova que não caiu na visão geral.
    await expect(page.getByRole('navigation', { name: 'Contexto da carteira' }))
      .toBeVisible({ timeout: 30_000 });
  }
  // Slug desconhecido não quebra: cai na visão geral.
  await page.goto('/contratos?view=nao-existe');
  await expect(page.getByTestId('portfolio-workspace')).toBeVisible({ timeout: 40_000 });
});

test('8 · Ordens de Serviço explica que a OS interna não é documento do cliente', async () => {
  await page.goto('/contratos?view=ordens-de-servico');
  await expect(page.getByText(/autorização .*operacional da Insight/i)).toBeVisible({ timeout: 40_000 });
  await expect(page.getByText(/não substitui.*pedido de compra do cliente/i)).toBeVisible();
  await expectNoFailureSurface(page);
});

test('9 · a Carteira oferece as quatro portas de entrada, não só "contrato"', async () => {
  await page.goto('/contratos?view=carteira');
  await expect(page.getByTestId('portfolio-workspace')).toBeVisible({ timeout: 40_000 });
  const add = page.getByRole('button', { name: 'Adicionar', exact: true }).first();
  await expect(add).toBeVisible({ timeout: 30_000 });
  await add.click();
  for (const option of ['Novo contrato para análise', 'Importar proposta aprovada',
                        'Registrar pedido/autorização', 'Criar manualmente']) {
    await expect(page.getByText(option, { exact: true })).toBeVisible();
  }
  await page.keyboard.press('Escape');
});

// ── 10 · Projeto mostra a cadeia comercial, e "não há" contrato é resposta ──

test('10 · o Projeto exibe a origem comercial sem tratar ausência como erro', async () => {
  await page.goto('/projetos');
  const first = page.getByRole('link', { name: /Projeto|proj-/ }).first();
  const projects = await first.count();
  test.skip(projects === 0, 'nenhum projeto disponível neste ambiente');

  await first.click();
  await page.waitForURL(/\/projetos\/[^/]+$/, { timeout: 40_000 });
  const tab = page.getByRole('tab', { name: /Contrato/i }).first();
  if (await tab.count()) {
    await tab.click();
    await expect(page.getByLabel('Origem comercial do projeto')
      .or(page.getByText('Projeto sem origem comercial registrada')))
      .toBeVisible({ timeout: 40_000 });
    // Ausência de contrato é uma RESPOSTA, nunca um alerta de dado faltando.
    await expect(page.getByText(/Application error|Unhandled Runtime Error/i)).toHaveCount(0);
  }
});

// ── 11 · A alçada nega de verdade ─────────────────────────────────────────

test('11 · sem commercial.view o módulo é NEGADO — e volta a abrir ao devolver', async ({ browser }) => {
  /*
    A negação é provada com `user_permission_overrides` (migration 014) em vez
    de criar um usuário novo: é o MESMO resolvedor canônico que a RLS usa
    (`current_user_has_permission`), e `deny` vence a concessão por papel.
    Criar um segundo usuário provaria menos e sujaria o banco.
  */
  const client = db();
  await client.connect();
  await client.query('SET SESSION default_transaction_read_only = off');

  const { rows } = await client.query(
    `SELECT u.id FROM auth.users u WHERE u.email = $1`, [qa.email]);
  const userId = rows[0].id;

  await client.query(
    `INSERT INTO public.user_permission_overrides (user_id, organization_id, permission_id, effect)
     SELECT $1, $2, p.id, 'deny' FROM public.permissions p WHERE p.key = 'commercial.view'
     ON CONFLICT (user_id, organization_id, permission_id) DO UPDATE SET effect = 'deny'`,
    [userId, qa.orgId]);

  try {
    const denied = await browser.newContext();
    const deniedPage = await denied.newPage();
    deniedPage.setDefaultTimeout(25_000);
    await signIn(deniedPage);
    await deniedPage.goto('/comercial?view=oportunidades');
    // A recusa é explícita e NOMEIA a permissão — não é tela branca.
    await expect(deniedPage.getByText(/Esta ação exige: commercial\.view/i))
      .toBeVisible({ timeout: 40_000 });
    await denied.close();
  } finally {
    await client.query(
      `DELETE FROM public.user_permission_overrides
        WHERE user_id = $1 AND organization_id = $2
          AND permission_id = (SELECT id FROM public.permissions WHERE key = 'commercial.view')`,
      [userId, qa.orgId]);
    await client.end();
  }

  // Devolvida a permissão, o módulo volta a abrir para a mesma pessoa.
  const restored = await browser.newContext();
  const restoredPage = await restored.newPage();
  restoredPage.setDefaultTimeout(25_000);
  await signIn(restoredPage);
  await restoredPage.goto('/comercial?view=oportunidades');
  await expect(restoredPage.getByRole('heading', { name: /Comercial · Oportunidades/ }))
    .toBeVisible({ timeout: 40_000 });
  await restored.close();
});

// ── 12 · A passagem comercial → pós-venda existe no NAVEGADOR ─────────────

test('12 · Ordens de Serviço oferece criar OS, e só sobre trabalho AUTORIZADO', async () => {
  await page.goto('/contratos?view=ordens-de-servico');
  const create = page.getByRole('button', { name: 'Nova Ordem de Serviço', exact: true }).first();
  await expect(create).toBeVisible({ timeout: 40_000 });
  await create.click();

  const modal = page.locator('.hud-modal-surface');
  await expect(modal).toBeVisible({ timeout: 20_000 });
  await expect(modal.getByText('Autorização operacional da Insight para começar a executar.'))
    .toBeVisible();

  /*
    O seletor de trabalho autorizado NÃO pode oferecer nada em análise. Com o
    banco sem trabalho autorizado, o próprio placeholder diz isso — e dizer é
    melhor do que deixar escolher e receber recusa do banco depois.
  */
  const select = modal.locator('select').first();
  await expect(select).toBeVisible();
  const options = await select.locator('option').allTextContents();
  for (const option of options) {
    expect(option).not.toMatch(/em análise/i);
  }

  // Sem seleção, criar continua desabilitado: o portão está na tela também.
  await expect(modal.getByRole('button', { name: 'Criar OS', exact: true })).toBeDisabled();
  await page.keyboard.press('Escape');
});

test('13 · Propostas oferece a passagem para trabalho autorizado quando há aceite', async () => {
  await page.goto('/comercial?view=propostas');
  await expect(page.getByRole('heading', { name: /Comercial · Propostas/ })).toBeVisible();

  const accepted = page.getByText('Esta é a revisão que pode autorizar execução.');
  const emptyState = page.getByText('Nenhuma proposta registrada');
  await expect(accepted.or(emptyState).first()).toBeVisible({ timeout: 40_000 });

  /*
    Onde há revisão aceita, o gatilho para o pós-venda TEM de estar ao lado —
    era exatamente isto que faltava: o caminho existia no banco e não existia
    no navegador. Sem proposta aceita no ambiente, o estado vazio é a resposta
    correta e a prova não inventa dado para forçar o botão a aparecer.
  */
  if (await accepted.count()) {
    await expect(page.getByRole('button', { name: 'Gerar trabalho autorizado' }).first())
      .toBeVisible();
  }
});
