/**
 * E2E — Contratos como camada de orquestração (P1C).
 *
 * Pré-requisitos:
 *   1. node scripts/qa-contracts-governance-seed.mjs   (contrato [QA] + relações)
 *   2. node scripts/qa-seed-workforce.mjs              (usuário QA owner_admin)
 *   3. servidor em http://localhost:9002
 * Rodar: npx playwright test tests/contracts-module.spec.ts --project=chromium
 *
 * Login real via /login, como todo E2E deste repositório — nenhum bypass de
 * autenticação é introduzido aqui.
 *
 * TODA mutação recai sobre o contrato `[QA]` (`data_class = 'demo'`), que
 * existe exatamente para isso. O contrato CEMIG (`live`) é apenas LIDO.
 */
import { test, expect, type BrowserContext, type Page, type Locator } from '@playwright/test';
import { readFileSync } from 'node:fs';
import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config({ path: '.env' });
dotenv.config({ path: '.env.local' });

const qa = JSON.parse(readFileSync('tests/.qa-env.json', 'utf8')) as {
  email: string; password: string;
};

const CONTRACT_NUMBER = 'QA-0001';
const CONTRACT_TITLE = '[QA] Contrato de Serviços';
const PROJECT_CODE = 'CEMIG - 2450.07/2024';
/** Sufixo único por execução: nenhum teste depende de estado deixado por outro. */
const RUN = Date.now().toString(36).slice(-5);

test.describe.configure({ mode: 'serial' });
test.setTimeout(180_000);

let ctx: BrowserContext;
let page: Page;
let contractId = '';

// ── utilidades ────────────────────────────────────────────────────────────

/** input/select dentro do wrapper cujo <label> direto tem o texto dado. */
const byLabel = (scope: Page | Locator, label: string, control: 'input' | 'select' = 'input') =>
  scope.locator(`div:has(> label:text-is("${label}")) ${control}`).first();

const expectToast = (text: string | RegExp, timeout = 20_000) =>
  expect(page.getByText(text).first()).toBeVisible({ timeout });

/** HudDrawer/HudModal não expõem role própria; a classe da superfície os ancora. */
const drawer = () => page.locator('.hud-drawer-surface');
const modal = () => page.locator('.hud-modal-surface');

/**
 * A linha de uma lista, e não o `<div>` mais interno que contém o texto.
 *
 * `filter({ hasText })` casa com todo ancestral; `.last()` sozinho devolve o
 * wrapper do título, que não tem os botões de ação. Filtrar TAMBÉM pelo
 * controle procurado ancora no elemento certo.
 */
const rowWith = (text: string, control: Locator) =>
  page.locator('div').filter({ hasText: text }).filter({ has: control }).last();

async function withDb<T>(fn: (q: (sql: string, params?: unknown[]) => Promise<any[]>) => Promise<T>): Promise<T> {
  const client = new pg.Client({
    connectionString: process.env.SUPABASE_DB_URL,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  try {
    return await fn(async (sql, params) => (await client.query(sql, params)).rows);
  } finally {
    await client.end();
  }
}

/**
 * Vai para a carteira e revela o recorte de demonstração, onde o [QA] vive.
 *
 * O seletor de escopo NÃO fica exposto no cabeçalho: `PortfolioScopeNotice` só
 * mostra "N registro(s) fora da carteira oficial" quando existe algo fora dela,
 * e o seletor abre a partir daí. A área nobre da tela é operação; escolher
 * recorte é o caso incomum, e fica atrás de um clique deliberado.
 *
 * Este helper esperava o seletor já visível e falhava com "element(s) not
 * found" — o que também significa que ele só funciona quando a fixture [QA]
 * existe: sem nada fora da oficial, não há aviso nenhum para abrir.
 */
async function gotoDemoPortfolio() {
  await page.goto('/contratos');
  await page
    .getByRole('button', { name: /registro\(s\) fora da carteira oficial/ })
    .click({ timeout: 30_000 });
  const scope = page.getByRole('group', { name: 'Escopo da carteira' });
  await expect(scope).toBeVisible({ timeout: 30_000 });
  await scope.getByRole('button', { name: /Demonstração/ }).click();
  await gotoPortfolioSection(page, 'Contratos');
}

async function openQuickDossier() {
  await expect(drawer()).toBeVisible({ timeout: 20_000 });
  await expect(drawer().getByText('cockpit operacional')).toBeVisible();
  await expect(drawer().getByText(CONTRACT_NUMBER).first()).toBeVisible({ timeout: 20_000 });
}

// ── sessão ────────────────────────────────────────────────────────────────

test.beforeAll(async ({ browser }) => {
  ctx = await browser.newContext();
  page = await ctx.newPage();
  page.setDefaultTimeout(20_000);
  // O PDF abre em popup e dispara window.print(): neutralizado para não travar.
  await ctx.addInitScript(() => { window.print = () => {}; });

  await page.goto('/login');
  await page.locator('input[type="email"]').fill(qa.email);
  await page.locator('input[type="password"]').fill(qa.password);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 60_000 });

  const rows = await withDb((q) =>
    q(`select id from contracts where contract_number = $1 and deleted_at is null limit 1`, [CONTRACT_NUMBER]),
  );
  expect(rows.length, 'contrato [QA] ausente — rode scripts/qa-contracts-governance-seed.mjs').toBe(1);
  contractId = rows[0].id;
});

test.afterAll(async () => {
  // A limpeza abre conexão remota ao Postgres; 30s (o padrão de hook) não
  // cobre isso somado ao fechamento do contexto do browser.
  test.setTimeout(120_000);
  await ctx?.close();

  // Devolve o fixture [QA] ao estado semeado: sem isso, cada execução deixaria
  // uma obrigação, uma tarefa, um faturamento e um documento novos, e o QA
  // visual passaria a olhar uma carteira inflada pelo próprio teste.
  //
  // `audit_logs` NÃO é limpo: o registro do que foi feito é justamente o que
  // não se apaga.
  if (!contractId) return;
  await withDb(async (q) => {
    // As penalidades saem antes das cláusulas: `clause_id` referencia cláusula.
    await q(`delete from contract_penalties where contract_id = $1 and title like 'E2E %'`, [contractId]);
    /*
      Fase 3 antes das cláusulas: uma definição de obrigação referencia a sua
      ORIGEM com ON DELETE RESTRICT, e é isso que impede apagar a cláusula que
      sustenta uma obrigação viva. A ordem aqui é a mesma regra que protege o
      contrato em produção, não um detalhe de limpeza.
    */
    await q(`delete from contract_obligation_evidence where contract_id = $1`, [contractId]);
    await q(`delete from contract_obligation_exceptions where contract_id = $1`, [contractId]);
    await q(`delete from contract_obligation_financial_impacts where contract_id = $1`, [contractId]);
    await q(`delete from contract_obligation_evidence_requirements where contract_id = $1`, [contractId]);
    await q(`delete from contract_obligation_dependencies where contract_id = $1`, [contractId]);
    await q(`delete from contract_obligation_instances where contract_id = $1`, [contractId]);
    await q(`delete from contract_obligation_definitions where contract_id = $1`, [contractId]);
    // Cláusulas substituídas apontam para a sucessora: solta o vínculo antes.
    await q(`update contract_clauses set superseded_by_clause_id = null where contract_id = $1`, [contractId]);
    await q(`delete from contract_clauses where contract_id = $1 and (title like 'E2E %' or ai_flagged = true)`, [contractId]);
    await q(`delete from contract_ai_analyses where contract_id = $1 and extracted_data->>'kind' = 'clause_extraction'`, [contractId]);
    // Desfaz a linhagem de versão criada pelos cenários de supersessão.
    await q(`update contract_documents set superseded_by_document_id = null, supersedes_document_id = null,
             superseded_at = null, version = 1 where contract_id = $1`, [contractId]);
    for (const [table, column] of [
      ['contract_obligations', 'contract_id'],
      ['contract_billing_events', 'contract_id'],
      ['contract_documents', 'contract_id'],
      ['contract_milestones', 'contract_id'],
      ['contract_clauses', 'contract_id'],
      ['tasks', 'related_contract_id'],
    ] as const) {
      await q(`delete from ${table} where ${column} = $1 and title like 'E2E %'`, [contractId]);
    }
    await q(
      `update contract_approvals set status = 'pending' where contract_id = $1 and step_name = 'comite'`,
      [contractId],
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 1–3 · Entrada no cockpit pelos dois caminhos, e a subida para o dossiê
// ═══════════════════════════════════════════════════════════════════════════


/**
 * Vai a uma área da carteira pela SIDEBAR — a navegação canônica do módulo.
 *
 * A barra horizontal de abas da carteira não existe mais: havia duas formas de
 * apresentar a mesma hierarquia. Clicar na sidebar (em vez de navegar pela URL)
 * é o que prova que a navegação real funciona.
 */
async function gotoPortfolioSection(page: Page, label: string) {
  const group = page.getByRole('button', { name: 'Contratos', exact: true });
  if (await group.count()) {
    const expanded = await group.first().getAttribute('aria-expanded');
    if (expanded === 'false') await group.first().click();
  }
  await page.getByRole('link', { name: label, exact: true }).first().click();
}

test('1 · Card → Quick Dossier', async () => {
  await gotoDemoPortfolio();
  await page.getByRole('button', { name: 'Cards' }).click();

  const card = page.getByRole('button').filter({ hasText: CONTRACT_NUMBER }).first();
  await expect(card).toBeVisible({ timeout: 20_000 });
  // O selo de origem tem de estar no card: demo nunca se apresenta como oficial.
  await expect(card.getByText('Demonstração').first()).toBeVisible();
  await card.click();

  await openQuickDossier();
});

test('2 · Smart Table → Quick Dossier', async () => {
  await gotoDemoPortfolio();
  await page.getByRole('button', { name: 'Tabela' }).click();

  const search = page.getByPlaceholder(/Buscar contrato/);
  await expect(search).toBeVisible();
  await search.fill(CONTRACT_NUMBER);

  await page.getByRole('button').filter({ hasText: CONTRACT_NUMBER }).first().click();
  await openQuickDossier();
});

test('3 · Quick Dossier → Full Dossier', async () => {
  await drawer().getByRole('button', { name: 'Abrir dossiê completo' }).click();
  await page.waitForURL(new RegExp(`/contratos/${contractId}`), { timeout: 30_000 });
  await expect(page.getByText(CONTRACT_TITLE).first()).toBeVisible();
  // A banda de contexto do dossiê traz as operações conectadas.
  await expect(page.getByText('Operações conectadas').first()).toBeVisible();
});

// ═══════════════════════════════════════════════════════════════════════════
// 4 · Contrato ↔ Projeto — relação de primeira classe, nos dois estados
// ═══════════════════════════════════════════════════════════════════════════

test('4 · Vincular projeto (estado não vinculado → vinculado)', async () => {
  // Parte do estado NÃO VINCULADO para exercitar o caminho de verdade; o
  // vínculo da seed é restaurado pela própria ação sob teste.
  await withDb((q) => q(`delete from contract_project_links where contract_id = $1`, [contractId]));

  await gotoDemoPortfolio();
  await page.getByRole('button', { name: 'Cards' }).click();
  await page.getByRole('button').filter({ hasText: CONTRACT_NUMBER }).first().click();
  await openQuickDossier();

  // Sem projeto, a ausência é declarada — não some da tela.
  await expect(drawer().getByText(/Sem projeto vinculado|não vinculado/i).first()).toBeVisible();

  // Sem vínculo, "Vincular projeto" é PROMOVIDA a ação primária contextual e
  // passa a existir duas vezes: como primária e na grade de governança.
  const linkButtons = drawer().getByRole('button', { name: 'Vincular projeto' });
  await expect(linkButtons.first()).toBeVisible();
  await expect(drawer().locator('button[data-variant="primary"]', { hasText: 'Vincular projeto' })).toHaveCount(1);
  await linkButtons.first().click();
  await expect(modal().getByText('Vincular projeto').first()).toBeVisible();
  const projectSelect = byLabel(modal(), 'Projeto', 'select');
  const projectValue = await projectSelect.locator('option', { hasText: PROJECT_CODE }).first().getAttribute('value');
  expect(projectValue, `projeto ${PROJECT_CODE} ausente na lista`).toBeTruthy();
  await projectSelect.selectOption(projectValue!);
  await modal().getByRole('button', { name: 'Vincular', exact: true }).click();
  await expectToast('Projeto vinculado');

  const links = await withDb((q) =>
    q(`select project_id from contract_project_links where contract_id = $1`, [contractId]),
  );
  expect(links.length, 'o vínculo tem de existir na tabela canônica').toBe(1);
});

// ═══════════════════════════════════════════════════════════════════════════
// 5–9 · Operações de governança a partir do cockpit
// ═══════════════════════════════════════════════════════════════════════════

/**
 * A obrigação passou a ser ESTRUTURADA (Fase 3): ela grava uma definição
 * canônica, não uma linha na lista de tarefas antiga. A diferença que este
 * teste cobra é a ORIGEM — sem cláusula ou documento que a sustente, o banco
 * recusa a definição, e o formulário recusa antes.
 */
test('5 · Criar obrigação estruturada exige origem contratual', async () => {
  await drawer().getByRole('button', { name: 'Criar obrigação' }).click();
  await expect(modal().getByText('Nova obrigação contratual').first()).toBeVisible();
  await byLabel(modal(), 'Título').fill(`E2E obrigação ${RUN}`);

  // Sem origem: recusa, e nada é gravado.
  await modal().getByRole('button', { name: 'Registrar obrigação', exact: true }).click();
  await expectToast('Origem obrigatória');
  // O contrato de QA é reaproveitado entre execuções, então a prova é sobre
  // ESTA obrigação: a de agora não pode ter sido gravada sem origem.
  const semOrigem = await withDb((q) =>
    q(`select id from contract_obligation_definitions where contract_id = $1 and title = $2`,
      [contractId, `E2E obrigação ${RUN}`]));
  expect(semOrigem.length, 'nada pode ser gravado sem origem').toBe(0);

  // Com origem: grava a definição canônica, com proveniência.
  const origem = byLabel(modal(), 'Origem no contrato', 'select');
  const opcao = await origem.locator('option').nth(1).getAttribute('value');
  expect(opcao, 'o contrato precisa ter cláusula ou documento para originar a obrigação').toBeTruthy();
  await origem.selectOption(opcao!);
  await modal().getByRole('button', { name: 'Registrar obrigação', exact: true }).click();
  await expectToast('Registro criado');

  const rows = await withDb((q) =>
    q(`select title, source_clause_id, source_document_id, blocks_billing, responsible_side
         from contract_obligation_definitions where contract_id = $1 and title = $2`,
      [contractId, `E2E obrigação ${RUN}`]),
  );
  expect(rows.length).toBe(1);
  // Proveniência gravada: ao menos um caminho de origem.
  expect(Boolean(rows[0].source_clause_id || rows[0].source_document_id)).toBe(true);
  // Não apurado permanece NULO — nunca um `false` por omissão.
  expect(rows[0].blocks_billing).toBeNull();
  expect(rows[0].responsible_side).toBe('unknown');

  // A lista de tarefas legada NÃO recebeu nada: ela é somente-leitura.
  const legado = await withDb((q) =>
    q(`select id from contract_obligations where contract_id = $1 and title = $2`,
      [contractId, `E2E obrigação ${RUN}`]));
  expect(legado.length, 'a lista legada não pode mais receber escrita').toBe(0);
});

test('6 · Criar tarefa na agenda (módulo dono: tasks)', async () => {
  await drawer().getByRole('button', { name: 'Criar tarefa', exact: true }).click();
  await byLabel(modal(), 'Título da tarefa').fill(`E2E tarefa ${RUN}`);
  await modal().getByRole('button', { name: 'Criar tarefa', exact: true }).click();
  await expectToast('Tarefa criada');

  // A tarefa vive em `tasks`, não numa cópia dentro de Contratos.
  const rows = await withDb((q) =>
    q(`select id from tasks where related_contract_id = $1 and title = $2`, [contractId, `E2E tarefa ${RUN}`]),
  );
  expect(rows.length, 'a tarefa tem de nascer no módulo Agenda & Tarefas').toBe(1);
});

test('7 · Criar evento de faturamento', async () => {
  await drawer().getByRole('button', { name: 'Criar faturamento' }).click();
  await expect(modal().getByText('Novo evento de faturamento').first()).toBeVisible();
  await byLabel(modal(), 'Título do evento').fill(`E2E faturamento ${RUN}`);
  await byLabel(modal(), 'Valor (R$)').fill('1500');
  await modal().getByRole('button', { name: 'Registrar evento', exact: true }).click();
  await expectToast('Registro criado');

  const rows = await withDb((q) =>
    q(`select amount from contract_billing_events where contract_id = $1 and title = $2`, [contractId, `E2E faturamento ${RUN}`]),
  );
  expect(rows.length).toBe(1);
  expect(Number(rows[0].amount)).toBe(1500);
});

test('8 · Anexar documento', async () => {
  await drawer().getByRole('button', { name: 'Anexar documento' }).click();
  await byLabel(modal(), 'Título do documento').fill(`E2E documento ${RUN}`);
  await modal().locator('input[type="file"]').setInputFiles({
    name: `e2e-${RUN}.pdf`,
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.4\n% e2e contracts\n'),
  });
  await modal().getByRole('button', { name: 'Anexar', exact: true }).click();
  await expectToast('Documento anexado', 40_000);

  const rows = await withDb((q) =>
    q(`select id from contract_documents where contract_id = $1 and title = $2`, [contractId, `E2E documento ${RUN}`]),
  );
  expect(rows.length).toBe(1);
});

test('9 · Aprovar / rejeitar etapa', async () => {
  await drawer().getByRole('button', { name: 'Aprovar / rejeitar' }).click();
  await byLabel(modal(), 'Etapa', 'select').selectOption('comite');
  await byLabel(modal(), 'Decisão', 'select').selectOption('changes');
  await modal().locator('textarea').last().fill(`E2E ajustes ${RUN}`);
  await modal().getByRole('button', { name: 'Solicitar', exact: true }).click();
  await expectToast('Ajustes solicitados');

  const rows = await withDb((q) =>
    q(`select status from contract_approvals where contract_id = $1 and step_name = 'comite'`, [contractId]),
  );
  expect(rows.length).toBe(1);
  // `requestContractApprovalChanges` reabre a etapa como `under_review` e
  // registra `contract.changes_requested` na auditoria — é lá que a decisão vive.
  expect(rows[0].status).toBe('under_review');
  const audited = await withDb((q) =>
    q(`select id from audit_logs where entity_type='contract' and entity_id=$1 and action='contract.changes_requested'`, [contractId]),
  );
  expect(audited.length).toBeGreaterThan(0);
});

// ═══════════════════════════════════════════════════════════════════════════
// 12–18 · Instrumentação operacional (P2B)
//
// Os domínios `contract_milestones`, `contract_clauses` e `contract_penalties`
// existiam desde a migration 006 e nunca receberam uma linha. Estes cenários
// exercitam os caminhos de escrita abertos pela migration 092.
// ═══════════════════════════════════════════════════════════════════════════

/** Abre a aba do dossiê completo do contrato [QA]. */
async function openDossierTab(tab: 'Financeiro' | 'Riscos & Cláusulas') {
  await page.goto(`/contratos/${contractId}`);
  await page.getByText('Operações conectadas').first().waitFor({ timeout: 30_000 });
  const tablist = page.getByTestId('contract-dossier-tabs');
  await tablist.getByRole('tab', { name: new RegExp('^' + tab.split(' ')[0]) }).click();
  await page.waitForTimeout(700);
}

test('12 · Criar marco de medição', async () => {
  await openDossierTab('Financeiro');

  await page.getByRole('button', { name: 'Novo marco' }).click();
  await expect(modal().getByText('Novo marco de medição')).toBeVisible();
  await byLabel(modal(), 'Título do marco').fill(`E2E marco ${RUN}`);
  await byLabel(modal(), 'Valor previsto (R$)').fill('480000');
  await byLabel(modal(), 'Evidência esperada').fill('Boletim de medição E2E');
  await modal().getByRole('button', { name: 'Registrar marco' }).click();
  await expectToast('Marco registrado');

  const rows = await withDb((q) =>
    q(`select id, status, billing_amount, measured_amount, evidence, created_by
         from contract_milestones where contract_id = $1 and title = $2`,
      [contractId, `E2E marco ${RUN}`]),
  );
  expect(rows.length).toBe(1);
  // Nasce previsto e sem medição: registrar não é medir.
  expect(rows[0].status).toBe('pending');
  expect(rows[0].measured_amount).toBeNull();
  expect(Number(rows[0].billing_amount)).toBe(480000);
  expect(rows[0].evidence).toBe('Boletim de medição E2E');
  expect(rows[0].created_by).toBeTruthy();
});

test('13 · Atualizar marco para medido, com valor e evidência', async () => {
  await openDossierTab('Financeiro');

  const row = rowWith(`E2E marco ${RUN}`, page.getByTitle('Editar marco'));
  await row.getByTitle('Editar marco').click();
  await expect(modal().getByText('Editar marco de medição')).toBeVisible();
  await byLabel(modal(), 'Valor medido (R$)').fill('455000');
  await byLabel(modal(), 'Situação', 'select').selectOption('measured');
  await modal().getByRole('button', { name: 'Salvar marco' }).click();
  await expectToast('Marco atualizado');

  const rows = await withDb((q) =>
    q(`select status, measured_amount, completed_at, updated_by
         from contract_milestones where contract_id = $1 and title = $2`,
      [contractId, `E2E marco ${RUN}`]),
  );
  expect(rows[0].status).toBe('measured');
  expect(Number(rows[0].measured_amount)).toBe(455000);
  // Entrar em medido carimba a data — o marco passa a ter quando.
  expect(rows[0].completed_at).not.toBeNull();
  expect(rows[0].updated_by).toBeTruthy();
});

test('14 · O marco medido aparece no Contract-to-Cash', async () => {
  /*
    A asserção sai do BANCO, não de um número fixo.
    Fixar "1 registro(s)" acoplava o teste ao conteúdo da fixture: quando o
    seed passou a semear um marco medido, a etapa virou "2 registro(s)" e o
    teste quebrou sem que nada no produto tivesse mudado. O que precisa ser
    verdade é outra coisa — a tela mostra o que a fonte diz.
  */
  const measured = await withDb((q) =>
    q(`select count(*)::int as n from contract_milestones
        where contract_id = $1 and status in ('measured', 'approved')`, [contractId]),
  );
  const esperado = measured[0].n as number;
  expect(esperado, 'o marco criado nos cenários 12–13 deveria estar medido').toBeGreaterThan(0);

  await openDossierTab('Financeiro');

  // `ol > li` ancora na cadeia; `li` sozinho casa com qualquer lista da página.
  // E `hasText` casa com o texto do DOM — o caixa-alta da etapa é só CSS.
  const chain = page.locator('ol > li').filter({ hasText: 'Medido' }).first();
  await expect(chain).toBeVisible({ timeout: 20_000 });
  // Antes de P2B esta etapa dizia "Não instrumentado" em qualquer contrato.
  await expect(chain).not.toContainText('Não instrumentado');
  await expect(chain).not.toContainText('Sem registro');
  await expect(chain).toContainText('R$');
  await expect(chain).toContainText(`${esperado} registro(s)`);
});

test('15 · Gerar faturamento a partir do marco medido', async () => {
  await openDossierTab('Financeiro');

  const row = rowWith(`E2E marco ${RUN}`, page.getByTitle(/Gerar evento de faturamento/));
  await row.getByTitle(/Gerar evento de faturamento/).click();
  await expectToast('Faturamento gerado a partir do marco');

  const rows = await withDb((q) =>
    q(`select b.amount, b.status, b.milestone_id
         from contract_billing_events b
         join contract_milestones m on m.id = b.milestone_id
        where b.contract_id = $1 and m.title = $2`,
      [contractId, `E2E marco ${RUN}`]),
  );
  expect(rows.length).toBe(1);
  // O evento nasce PENDENTE: medir não fatura.
  expect(rows[0].status).toBe('pendente');
  expect(Number(rows[0].amount)).toBe(455000);
});

test('16 · Registrar cláusula com origem e efeito contratual', async () => {
  await openDossierTab('Riscos & Cláusulas');

  await page.getByRole('button', { name: 'Registrar cláusula' }).first().click();
  // Título do modal e CTA têm o mesmo texto; o campo é o que prova que abriu.
  await expect(byLabel(modal(), 'Título da cláusula')).toBeVisible();
  await byLabel(modal(), 'Título da cláusula').fill(`E2E cláusula ${RUN}`);
  await byLabel(modal(), 'Categoria', 'select').selectOption('penalidade');
  await byLabel(modal(), 'Percentual (%)').fill('2');
  await byLabel(modal(), 'Página').fill('12');
  await modal().getByRole('button', { name: 'Registrar cláusula' }).click();
  await expectToast('Cláusula registrada');

  const rows = await withDb((q) =>
    q(`select id, clause_type, percentage, source_page, ai_flagged, review_status
         from contract_clauses where contract_id = $1 and title = $2`,
      [contractId, `E2E cláusula ${RUN}`]),
  );
  expect(rows.length).toBe(1);
  expect(rows[0].clause_type).toBe('penalidade');
  expect(Number(rows[0].percentage)).toBe(2);
  expect(rows[0].source_page).toBe(12);
  // As duas garantias que separam registro manual de extração automática.
  expect(rows[0].ai_flagged).toBe(false);
  expect(rows[0].review_status).toBe('draft');
});

test('17 · Registrar penalidade a partir da cláusula', async () => {
  await openDossierTab('Riscos & Cláusulas');

  const clauseRow = rowWith(`E2E cláusula ${RUN}`, page.getByRole('button', { name: 'Penalidade' }));
  await clauseRow.getByRole('button', { name: 'Penalidade' }).click();
  await expect(byLabel(modal(), 'Título da penalidade')).toBeVisible();
  await byLabel(modal(), 'Título da penalidade').fill(`E2E penalidade ${RUN}`);
  await byLabel(modal(), 'Percentual (%)').fill('2');
  await byLabel(modal(), 'Condição de gatilho').fill('Atraso superior a 5 dias');
  await modal().getByRole('button', { name: 'Registrar penalidade' }).click();
  await expectToast('Penalidade registrada');

  const rows = await withDb((q) =>
    q(`select p.percentage, p.trigger_condition, c.title as clause_title
         from contract_penalties p
         left join contract_clauses c on c.id = p.clause_id
        where p.contract_id = $1 and p.title = $2`,
      [contractId, `E2E penalidade ${RUN}`]),
  );
  expect(rows.length).toBe(1);
  expect(Number(rows[0].percentage)).toBe(2);
  // A penalidade aponta para a cláusula que a origina, em vez de repetir o texto.
  expect(rows[0].clause_title).toBe(`E2E cláusula ${RUN}`);
});

test('18 · Revisar cláusula e verificar a trilha de auditoria', async () => {
  await openDossierTab('Riscos & Cláusulas');

  const clauseRow = rowWith(`E2E cláusula ${RUN}`, page.getByRole('button', { name: 'Revisar' }));
  await clauseRow.getByRole('button', { name: 'Revisar' }).click();
  await expect(modal().getByText('Revisar cláusula')).toBeVisible();
  await byLabel(modal(), 'Decisão', 'select').selectOption('validated');
  await modal().locator('textarea').last().fill(`E2E revisão ${RUN}`);
  await modal().getByRole('button', { name: 'Registrar revisão' }).click();
  await expectToast('Cláusula validada');

  const clause = await withDb((q) =>
    q(`select review_status, reviewed_by, reviewed_at from contract_clauses
        where contract_id = $1 and title = $2`, [contractId, `E2E cláusula ${RUN}`]),
  );
  expect(clause[0].review_status).toBe('validated');
  expect(clause[0].reviewed_by).toBeTruthy();
  expect(clause[0].reviewed_at).not.toBeNull();

  // Trilha de auditoria: cada escrita da instrumentação deixa registro.
  const audit = await withDb((q) =>
    q(`select action from audit_logs
        where entity_type = 'contract' and entity_id = $1
          and action in ('contract.milestone_created', 'contract.milestone_updated',
                         'contract.billing_created_from_milestone', 'contract.clause_created',
                         'contract.penalty_created', 'contract.clause_reviewed')`,
      [contractId]),
  );
  const actions = new Set(audit.map((r: { action: string }) => r.action));
  for (const expected of [
    'contract.milestone_created', 'contract.milestone_updated',
    'contract.billing_created_from_milestone', 'contract.clause_created',
    'contract.penalty_created', 'contract.clause_reviewed',
  ]) {
    expect(actions.has(expected), `sem auditoria de ${expected}`).toBe(true);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// 19–25 · Inteligência assistida de cláusulas (P2D)
//
// O fluxo HUMANO é exercitado sobre propostas semeadas por SQL — determinístico
// e sem custo. A garantia anti-alucinação é o único cenário que chama o modelo
// de verdade, porque é a única que não dá para provar sem ele.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Semeia uma proposta de IA como o extrator a gravaria.
 *
 * Cada proposta recebe página e trecho PRÓPRIOS: o índice único de
 * `idx_contract_clauses_ai_fingerprint` (migration 094) trata mesma página +
 * mesmo trecho como a mesma leitura, e duas cláusulas diferentes de verdade
 * vêm de lugares diferentes do documento.
 */
let seedCounter = 0;
async function seedProposal(title: string, over: Record<string, unknown> = {}): Promise<string> {
  seedCounter += 1;
  const rows = await withDb((q) => q(
    `insert into contract_clauses (
       organization_id, contract_id, title, clause_type, content, risk_level,
       source_document_id, source_page, source_excerpt,
       ai_flagged, review_status, ai_confidence, ai_model, ai_proposed_at,
       ai_proposed_title, ai_proposed_content, percentage
     )
     select c.organization_id, c.id, $2, 'penalidade',
            'Multa de 2% sobre a parcela por atraso superior a 5 dias.', 'high',
            (select id from contract_documents where contract_id = c.id limit 1),
            $3, $4, true, 'draft', 0.92, 'claude-opus-5', now(),
            $2, 'Multa de 2% sobre a parcela por atraso superior a 5 dias.', 2
       from contracts c where c.id = $1
     returning id`,
    [contractId, title, over.page ?? (10 + seedCounter), over.excerpt
      ?? `A CONTRATADA sujeitar-se-á à multa de 2% (dois por cento) sobre o valor da parcela em atraso — leitura ${seedCounter} de ${RUN}.`],
  ));
  return rows[0].id as string;
}

test('19 · A proposta aparece na fila de revisão com a evidência à vista', async () => {
  await seedProposal(`E2E proposta ${RUN}`);
  await openDossierTab('Riscos & Cláusulas');

  const queue = page.locator('li').filter({ hasText: `E2E proposta ${RUN}` }).first();
  await expect(queue).toBeVisible({ timeout: 20_000 });
  // A evidência é o elemento central: trecho literal e página.
  await expect(queue).toContainText('Trecho do contrato');
  await expect(queue).toContainText('multa de 2%');
  await expect(queue).toContainText('p. 11');
  // E o aviso de que proposta não é cláusula.
  await expect(queue).toContainText('não vale como cláusula');
});

test('20 · Validar a proposta carimba quem decidiu', async () => {
  await openDossierTab('Riscos & Cláusulas');
  const queue = page.locator('li').filter({ hasText: `E2E proposta ${RUN}` }).first();
  await queue.getByRole('button', { name: 'Validar' }).click();

  await expect(modal().getByText('Revisar cláusula')).toBeVisible();
  await byLabel(modal(), 'Decisão', 'select').selectOption('validated');
  await modal().getByRole('button', { name: 'Registrar revisão' }).click();
  await expectToast('Cláusula validada');

  const rows = await withDb((q) => q(
    `select review_status, reviewed_by, reviewed_at, ai_flagged
       from contract_clauses where contract_id = $1 and title = $2`,
    [contractId, `E2E proposta ${RUN}`]));
  expect(rows[0].review_status).toBe('validated');
  expect(rows[0].reviewed_by).toBeTruthy();
  expect(rows[0].reviewed_at).not.toBeNull();
  // Validar NÃO apaga a marca de origem: continua sendo leitura de máquina
  // que uma pessoa conferiu.
  expect(rows[0].ai_flagged).toBe(true);
});

test('21 · Rejeitar exige justificativa', async () => {
  await seedProposal(`E2E rejeitada ${RUN}`);
  await openDossierTab('Riscos & Cláusulas');

  const queue = page.locator('li').filter({ hasText: `E2E rejeitada ${RUN}` }).first();
  await queue.getByRole('button', { name: 'Rejeitar' }).click();
  await byLabel(modal(), 'Decisão', 'select').selectOption('rejected');
  await modal().locator('textarea').last().fill(`E2E motivo ${RUN}`);
  await modal().getByRole('button', { name: 'Rejeitar', exact: true }).click();
  await expectToast('Revisão registrada');

  const rows = await withDb((q) => q(
    `select review_status from contract_clauses where contract_id = $1 and title = $2`,
    [contractId, `E2E rejeitada ${RUN}`]));
  expect(rows[0].review_status).toBe('rejected');
});

test('22 · Corrigir preserva a proposta original e aponta para a sucessora', async () => {
  await seedProposal(`E2E corrigir ${RUN}`);
  await openDossierTab('Riscos & Cláusulas');

  const queue = page.locator('li').filter({ hasText: `E2E corrigir ${RUN}` }).first();
  await queue.getByRole('button', { name: 'Corrigir' }).click();
  await expect(modal().getByText('Corrigir proposta')).toBeVisible();
  // O trecho lido continua à vista durante a correção.
  await expect(modal()).toContainText('multa de 2%');
  await byLabel(modal(), 'Título da cláusula').fill(`E2E corrigida ${RUN}`);
  await byLabel(modal(), 'Percentual (%)').fill('3');
  await modal().getByRole('button', { name: 'Substituir proposta' }).click();
  await expectToast('Proposta corrigida e substituída');

  const original = await withDb((q) => q(
    `select review_status, superseded_by_clause_id from contract_clauses
      where contract_id = $1 and title = $2`, [contractId, `E2E corrigir ${RUN}`]));
  expect(original[0].review_status).toBe('superseded');
  expect(original[0].superseded_by_clause_id).toBeTruthy();

  const replacement = await withDb((q) => q(
    `select percentage, ai_flagged, review_status, source_excerpt
       from contract_clauses where contract_id = $1 and title = $2`,
    [contractId, `E2E corrigida ${RUN}`]));
  expect(Number(replacement[0].percentage)).toBe(3);
  // A versão corrigida é afirmação HUMANA — não carrega a marca de máquina...
  expect(replacement[0].ai_flagged).toBe(false);
  expect(replacement[0].review_status).toBe('draft');
  // ...mas herda a evidência documental que a sustenta.
  expect(replacement[0].source_excerpt).toContain('multa de 2%');
});

test('23 · O banco recusa proposta de IA sem evidência', async () => {
  /*
    A regra "nunca inventar cláusula sem evidência" não pode depender só do
    código do extrator: quem tiver `contracts.edit` fala com a tabela direto.
    O CHECK da migration 093 é a barreira que não se contorna.
  */
  let rejected = false;
  try {
    await withDb((q) => q(
      `insert into contract_clauses (organization_id, contract_id, title, risk_level, ai_flagged, review_status)
       select organization_id, id, $2, 'medium', true, 'draft' from contracts where id = $1`,
      [contractId, `E2E sem evidencia ${RUN}`]));
  } catch (err) {
    rejected = true;
    expect(String(err)).toContain('contract_clauses_ai_needs_evidence_check');
  }
  expect(rejected, 'o banco aceitou uma proposta de IA sem evidência').toBe(true);

  // E a mesma linha SEM a marca de IA é aceita: registro manual não exige
  // trecho — quem transcreve afirma, e responde pela afirmação.
  await withDb((q) => q(
    `insert into contract_clauses (organization_id, contract_id, title, risk_level, ai_flagged, review_status)
     select organization_id, id, $2, 'medium', false, 'draft' from contracts where id = $1`,
    [contractId, `E2E manual sem trecho ${RUN}`]));
  const manual = await withDb((q) => q(
    `select id from contract_clauses where contract_id = $1 and title = $2`,
    [contractId, `E2E manual sem trecho ${RUN}`]));
  expect(manual.length).toBe(1);
});

test('24 · A trilha de auditoria cobre o ciclo proposta → decisão', async () => {
  const audit = await withDb((q) => q(
    `select action from audit_logs
      where entity_type = 'contract' and entity_id = $1
        and action in ('contract.clause_reviewed', 'contract.clause_superseded', 'contract.clause_created')`,
    [contractId]));
  const actions = new Set(audit.map((r: { action: string }) => r.action));
  for (const expected of [
    'contract.clause_reviewed',   // validar e rejeitar
    'contract.clause_superseded', // corrigir
    'contract.clause_created',    // a versão corrigida
  ]) {
    expect(actions.has(expected), `sem auditoria de ${expected}`).toBe(true);
  }
});

test('25 · Documento sem cláusula contratual não produz proposta alguma', async () => {
  /*
    O ÚNICO cenário que chama o modelo de verdade, e o mais importante: um
    documento sem cláusula tem de devolver lista vazia. Um extrator que
    "encontra" cláusulas típicas em qualquer PDF é pior do que nenhum.
  */
  test.setTimeout(300_000);

  await openDossierTab('Riscos & Cláusulas');

  const before = await withDb((q) => q(
    `select count(*)::int n from contract_clauses where contract_id = $1 and ai_flagged = true`,
    [contractId]));

  const select = page.getByLabel('Documento a analisar');
  await expect(select).toBeVisible({ timeout: 20_000 });
  await select.selectOption({ index: 1 });
  await page.getByRole('button', { name: 'Extrair cláusulas' }).click();

  // A leitura de um PDF leva alguns segundos; a resposta é um toast.
  await expect(
    page.getByText(/Nenhuma cláusula com evidência|cláusula\(s\) propostas|não pôde ser concluída/).first(),
  ).toBeVisible({ timeout: 240_000 });

  const after = await withDb((q) => q(
    `select count(*)::int n from contract_clauses where contract_id = $1 and ai_flagged = true`,
    [contractId]));
  // O PDF do fixture não tem texto contratual: nada pode ser proposto a partir dele.
  expect(after[0].n).toBe(before[0].n);

  /*
    A proveniência da análise mora em COLUNAS desde a migration 094 — antes
    vivia dentro de `extracted_data`, onde não dava para consultar. Ler o jsonb
    aqui passou a olhar o lugar errado: numa análise que falhou, o jsonb fica
    com o payload mínimo do início e o modelo só existe na coluna.
  */
  const analysis = await withDb((q) => q(
    `select id, status, model, extractor_version, document_id, error_message, extracted_data
       from contract_ai_analyses
      where contract_id = $1 and extracted_data->>'kind' = 'clause_extraction'
      order by created_at desc limit 1`, [contractId]));
  expect(analysis.length, 'a análise deveria ter deixado registro').toBe(1);

  const [record] = analysis;
  // Independentemente do desfecho, o registro identifica modelo, versão e documento.
  expect(record.model).toBeTruthy();
  expect(record.extractor_version).toBeTruthy();
  expect(record.document_id).toBeTruthy();

  if (record.status === 'completed') {
    // Documento sem texto contratual: nada pôde ser proposto a partir dele.
    expect(record.extracted_data.proposed).toBe(0);
  } else {
    // Falhou: então o estado é terminal e o motivo está registrado — um
    // documento não pode ficar eternamente "analisando".
    expect(record.status).toBe('failed');
    expect(record.error_message).toBeTruthy();
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// 26–31 · Operação da análise de cláusulas (P2E)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Resolve um documento do contrato [QA] pelo TÍTULO.
 *
 * Por posição não funciona: a ordem de `created_at` da fixture não é a ordem
 * em que os documentos aparecem no seed, e o cenário 8 ainda acrescenta um
 * documento novo a cada execução. Identificar por título é o que torna estes
 * cenários legíveis e estáveis.
 */
async function documentByTitle(title: string): Promise<string> {
  const rows = await withDb((q) => q(
    `select id from contract_documents where contract_id = $1 and title = $2 limit 1`,
    [contractId, title]));
  expect(rows.length, `documento "${title}" ausente na fixture`).toBe(1);
  return rows[0].id as string;
}

const DOC_CONTRATO = '[QA] Contrato assinado.pdf';
const DOC_APOLICE = '[QA] Apólice de seguro.pdf';

test('26 · O ciclo de vida por documento aparece no dossiê', async () => {
  const docId = await documentByTitle(DOC_CONTRATO);
  // Uma análise concluída, uma falhada: dois estados distintos na mesma tela.
  await withDb((q) => q(
    `insert into contract_ai_analyses (organization_id, contract_id, document_id, status,
       error_message, model, extractor_version, extracted_data, findings, completed_at)
     select organization_id, id, $2, 'failed', 'E2E timeout na leitura', 'claude-opus-5',
            'clause-extractor/1.0.0', '{"kind":"clause_extraction"}'::jsonb, '[]'::jsonb, now()
       from contracts where id = $1`, [contractId, docId]));

  await openDossierTab('Riscos & Cláusulas');
  const ops = page.locator('li').filter({ hasText: '[QA] Contrato assinado.pdf' }).first();
  await expect(ops).toBeVisible({ timeout: 20_000 });
  await expect(ops).toContainText('Falhou');
  // Falha silenciosa é pior que falha: o motivo fica à vista.
  await expect(ops).toContainText('E2E timeout na leitura');

  // E os documentos nunca analisados aparecem como tal.
  await expect(page.locator('li').filter({ hasText: '[QA] Apólice de seguro.pdf' }).first())
    .toContainText('Não analisado');
});

test('27 · A cobertura mostra o vocabulário inteiro, sem inferir o que o contrato deveria ter', async () => {
  await openDossierTab('Riscos & Cláusulas');

  /*
    Ancorar na LISTA e não num `div` com o título: `.last()` sobre `div`
    devolve o cabeçalho do painel (título + subtítulo), que não contém as
    categorias — o mesmo erro de seletor que já derrubou uma captura antes.
  */
  const coverage = page.locator('ul').filter({ hasText: 'Condições de pagamento' }).first();
  await expect(coverage).toBeVisible({ timeout: 20_000 });

  // O vocabulário INTEIRO aparece, inclusive o que o contrato não tem.
  for (const label of ['Condições de pagamento', 'SLA e nível de serviço', 'Penalidades e multas', 'Seguros', 'Compliance e anticorrupção']) {
    await expect(coverage).toContainText(label);
  }
  // A ressalva que impede a leitura errada da coluna.
  await expect(page.getByText('padrão de carteira que ainda não existe')).toBeVisible();
});

test('28 · Reanálise não duplica leitura idêntica', async () => {
  const docId = await documentByTitle(DOC_CONTRATO);
  const excerpt = `E2E trecho literal idêntico para deduplicação ${RUN}`;

  const insertProposal = () => withDb((q) => q(
    `insert into contract_clauses (organization_id, contract_id, title, clause_type, risk_level,
       source_document_id, source_page, source_excerpt, ai_flagged, review_status, ai_confidence, ai_model)
     select organization_id, id, $2, 'sla', 'medium', $3, 42, $4, true, 'draft', 0.8, 'claude-opus-5'
       from contracts where id = $1`, [contractId, `E2E dedupe ${RUN}`, docId, excerpt]));

  await insertProposal();

  // A segunda inserção idêntica é recusada pelo índice único da migration 094.
  let blocked = false;
  try {
    await insertProposal();
  } catch (err) {
    blocked = true;
    expect(String(err)).toContain('idx_contract_clauses_ai_fingerprint');
  }
  expect(blocked, 'o banco aceitou uma proposta duplicada').toBe(true);

  const rows = await withDb((q) => q(
    `select count(*)::int n from contract_clauses
      where contract_id = $1 and source_excerpt = $2`, [contractId, excerpt]));
  expect(rows[0].n).toBe(1);
});

test('29 · Substituir documento encerra as propostas pendentes dele', async () => {
  // O Contrato assinado é o documento que carrega as propostas semeadas.
  const oldDoc = await documentByTitle(DOC_CONTRATO);
  const newDoc = await documentByTitle(DOC_APOLICE);

  const pendingBefore = await withDb((q) => q(
    `select count(*)::int n from contract_clauses
      where source_document_id = $1 and ai_flagged = true and review_status in ('draft','in_review')`,
    [oldDoc]));
  expect(pendingBefore[0].n).toBeGreaterThan(0);

  // Simula o que `supersedeContractDocument` faz — o serviço é exercitado
  // pelos testes unitários; aqui interessa o EFEITO sobre a fila.
  await withDb((q) => q(
    `update contract_documents set superseded_by_document_id = $2, superseded_at = now() where id = $1`,
    [oldDoc, newDoc]));
  await withDb((q) => q(
    `update contract_documents set supersedes_document_id = $1, version = 2 where id = $2`,
    [oldDoc, newDoc]));
  await withDb((q) => q(
    `update contract_clauses set review_status = 'superseded'
      where source_document_id = $1 and ai_flagged = true and review_status in ('draft','in_review')`,
    [oldDoc]));

  const pendingAfter = await withDb((q) => q(
    `select count(*)::int n from contract_clauses
      where source_document_id = $1 and ai_flagged = true and review_status in ('draft','in_review')`,
    [oldDoc]));
  // Proposta lida de um papel que não vale mais não pode seguir "vigente".
  expect(pendingAfter[0].n).toBe(0);

  await openDossierTab('Riscos & Cláusulas');
  await expect(page.locator('li').filter({ hasText: DOC_CONTRATO }).first())
    .toContainText('substituído por versão mais recente', { timeout: 20_000 });
  // E a versão que passou a valer aparece marcada.
  await expect(page.locator('li').filter({ hasText: DOC_APOLICE }).first())
    .toContainText('v2');
});

test('30 · Cláusula validada sobrevive à substituição do documento', async () => {
  const oldDoc = await documentByTitle(DOC_CONTRATO);
  await withDb((q) => q(
    `insert into contract_clauses (organization_id, contract_id, title, clause_type, risk_level,
       source_document_id, source_page, source_excerpt, ai_flagged, review_status, reviewed_at)
     select organization_id, id, $2, 'pagamento', 'medium', $3, 77,
            $4, true, 'validated', now()
       from contracts where id = $1`,
    [contractId, `E2E validada ${RUN}`, oldDoc, `E2E trecho de cláusula já validada ${RUN}`]));

  // O documento já está substituído pelo cenário 29; a validada não é tocada.
  await withDb((q) => q(
    `update contract_clauses set review_status = 'superseded'
      where source_document_id = $1 and ai_flagged = true and review_status in ('draft','in_review')`,
    [oldDoc]));

  const rows = await withDb((q) => q(
    `select review_status from contract_clauses where contract_id = $1 and title = $2`,
    [contractId, `E2E validada ${RUN}`]));
  // Decisão humana registrada é verdade histórica: apagá-la para "limpar"
  // destruiria a trilha que justifica a validação.
  expect(rows[0].review_status).toBe('validated');
});

test('31 · Auditoria e métricas do ciclo de análise', async () => {
  const analyses = await withDb((q) => q(
    `select status, error_message, document_id from contract_ai_analyses
      where contract_id = $1 and status = 'failed'`, [contractId]));
  expect(analyses.length).toBeGreaterThan(0);
  // Falha registrada carrega motivo e documento — sem os dois não é acionável.
  expect(analyses[0].error_message).toBeTruthy();
  expect(analyses[0].document_id).toBeTruthy();

  const audit = await withDb((q) => q(
    `select action from audit_logs where entity_type = 'contract' and entity_id = $1
       and action in ('contract.clauses_extracted', 'contract.clause_reviewed', 'contract.clause_superseded')`,
    [contractId]));
  expect(audit.length).toBeGreaterThan(0);
});

// ═══════════════════════════════════════════════════════════════════════════
// 10 · Operações conectadas — navegação ao módulo dono, e honestidade
// ═══════════════════════════════════════════════════════════════════════════

test('10 · Operações conectadas cobrem os nove módulos e navegam', async () => {
  await page.goto(`/contratos/${contractId}`);
  const connected = page.locator('ul').filter({ hasText: 'Não integrado' }).last();
  await expect(connected).toBeVisible({ timeout: 30_000 });

  for (const label of ['Projeto', 'Tarefas', 'Obrigações', 'Faturamento', 'Documentos', 'Riscos', 'Aprovações', 'Auditoria', 'Financeiro']) {
    await expect(connected.getByText(label, { exact: true }).first(), `linha ausente: ${label}`).toBeVisible();
  }

  // O Financeiro DECLARA a falta de integração — não exibe zero.
  const finance = connected.locator('li').filter({ hasText: 'Financeiro' }).first();
  await expect(finance.getByText('Não integrado')).toBeVisible();
  await expect(finance.getByText(/R\$\s*0/)).toHaveCount(0);

  // Tarefas e Auditoria mostram contagem apurada do módulo dono.
  await expect(connected.locator('li').filter({ hasText: 'Tarefas' }).first().getByText(/tarefa/)).toBeVisible();
  await expect(connected.locator('li').filter({ hasText: 'Auditoria' }).first().getByText(/evento/)).toBeVisible();

  // Navegação: a linha entrega o assunto a quem o governa.
  await connected.locator('li').filter({ hasText: 'Financeiro' }).first().locator('button').click();
  await page.waitForURL(/\/financeiro/, { timeout: 30_000 });

  await page.goto(`/contratos/${contractId}`);
  const again = page.locator('ul').filter({ hasText: 'Não integrado' }).last();
  await again.locator('li').filter({ hasText: 'Projeto' }).first().locator('button').click();
  await page.waitForURL(/\/projetos\//, { timeout: 30_000 });
});

// ═══════════════════════════════════════════════════════════════════════════
// 11 · PDF do dossiê
// ═══════════════════════════════════════════════════════════════════════════

test('11 · Gerar PDF do dossiê', async () => {
  await page.goto(`/contratos/${contractId}`);
  const popupPromise = page.waitForEvent('popup', { timeout: 30_000 });
  await page.getByRole('button', { name: /Exportar PDF/ }).first().click();
  const popup = await popupPromise;
  await popup.waitForLoadState('domcontentloaded');

  const body = await popup.locator('body').innerText();
  expect(body).toContain(CONTRACT_NUMBER);
  // Contrato de demonstração NUNCA sai do sistema sem o rótulo.
  expect(body.toUpperCase()).toContain('DEMONSTRAÇÃO');
  await popup.close();
});
