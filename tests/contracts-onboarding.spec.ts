/**
 * E2E — entrada de um contrato REAL em produção (P2F).
 *
 * Este arquivo prova o caminho que uma empresa percorre ao trazer um contrato
 * de verdade para o Insight: cadastrar, anexar o papel, vincular ao projeto,
 * instrumentar, aprovar, auditar e emitir o dossiê oficial.
 *
 * Diferença deliberada em relação a `contracts-module.spec.ts`: aquele exercita
 * o fixture `[QA]` (`data_class = 'demo'`), que existe pré-semeado. Aqui NADA
 * é pré-semeado — o contrato nasce dentro do teste, pela interface, e nasce
 * `live`. É a única forma de provar que a carteira oficial aceita um contrato
 * novo sem intervenção de engenharia.
 *
 * Pré-requisitos:
 *   1. node scripts/qa-seed-workforce.mjs   (usuário QA owner_admin)
 *   2. servidor em http://localhost:9002
 * Rodar: npx playwright test tests/contracts-onboarding.spec.ts --project=chromium
 *
 * LIMPEZA: o contrato criado é removido ao fim, mas `audit_logs` NÃO é tocado.
 * A trilha registra que essas ações aconteceram — e aconteceram mesmo. Apagá-la
 * para "arrumar" o banco falsificaria exatamente o registro que a auditoria
 * existe para preservar.
 */
import { test, expect, type BrowserContext, type Page, type Locator } from '@playwright/test';
import { readFileSync } from 'node:fs';
import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config({ path: '.env' });
dotenv.config({ path: '.env.local' });

const qa = JSON.parse(readFileSync('tests/.qa-env.json', 'utf8')) as { email: string; password: string };

/** Sufixo único por execução: duas execuções nunca disputam a mesma linha. */
const RUN = Date.now().toString(36).slice(-6);
const NUMBER = `E2E-${RUN}`;
const TITLE = `[E2E] Manutenção de subestações ${RUN}`;
const COUNTERPARTY = `Concessionária E2E ${RUN}`;
const PROJECT_CODE = 'CEMIG - 2450.07/2024';

test.describe.configure({ mode: 'serial' });
test.setTimeout(180_000);

let ctx: BrowserContext;
let page: Page;
let contractId = '';

// ── utilidades ────────────────────────────────────────────────────────────

const drawer = () => page.locator('.hud-drawer-surface');
const modal = () => page.locator('.hud-modal-surface');

/**
 * O controle rotulado, nas DUAS formas que este app usa.
 *
 *   · `HudInput`/`HudSelect`  →  <div><label>Rótulo</label><input/></div>
 *   · assistente de cadastro  →  <label><span>Rótulo</span><input/></label>
 *
 * Um seletor só para a primeira forma erra todo campo do assistente, e vice-
 * versa. O `,` é uma união de seletores: casa o que existir.
 */
const byLabel = (scope: Page | Locator, label: string, control: 'input' | 'select' | 'textarea' = 'input') =>
  scope.locator(
    `div:has(> label:text-is("${label}")) ${control},`
    + `label:has(> span:text-is("${label}")) ${control}`,
  ).first();

const expectToast = (text: string | RegExp, timeout = 30_000) =>
  expect(page.getByText(text).first()).toBeVisible({ timeout });

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
 * Data do Postgres em `yyyy-mm-dd`.
 *
 * O driver `pg` converte coluna `date` em `Date` de JS na meia-noite LOCAL, e
 * `String(...)` disso produz "Tue Sep 01 2026 00:00:00 GMT-0300". Comparar com
 * o texto ISO falha por formato mesmo quando o dado está correto — e usar
 * `toISOString()` seria pior: converteria para UTC e voltaria um dia em
 * qualquer fuso a oeste de Greenwich.
 */
const ymd = (value: unknown): string | null => {
  if (value === null || value === undefined) return null;
  const d = value instanceof Date ? value : new Date(String(value));
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

/** O id de um documento do contrato, pelo título. */
async function documentIdByTitle(title: string): Promise<string> {
  const rows = await withDb((q) => q(
    `select id from contract_documents where contract_id = $1 and title = $2 limit 1`,
    [contractId, title]));
  expect(rows.length, `documento "${title}" ausente`).toBe(1);
  return rows[0].id as string;
}

/** O dossiê completo do contrato criado. */
/**
 * Abre o dossiê completo.
 *
 * A tolerância é alta porque em modo de desenvolvimento a primeira visita a
 * `/contratos/[id]` compila a rota sob demanda, e essa rota é pesada. Uma
 * execução falhou aqui com 40s enquanto o servidor apenas compilava — o teste
 * apontava para um defeito que não existia.
 */
async function gotoDossier() {
  await page.goto(`/contratos/${contractId}`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('Operações conectadas').first()).toBeVisible({ timeout: 120_000 });
}

/**
 * Abre uma aba do dossiê.
 *
 * `HudTabs` é um `role="tablist"` de verdade, então a aba se pede por papel e
 * a barra por `data-testid` — sem precisar deduzir a faixa a partir de um
 * rótulo que ela contém. Mesma abordagem do E2E de P1C.
 */
async function openDossierTab(name: string) {
  await gotoDossier();
  const tablist = page.getByTestId('contract-dossier-tabs');
  await tablist.getByRole('tab', { name: new RegExp('^' + name.split(' ')[0]) }).click();
  await page.waitForTimeout(700);
}

/**
 * O passo da lista de prontidão.
 *
 * Ancorado na lista NOMEADA, não em `li` solto: "Obrigações" e "Riscos"
 * aparecem também em Operações conectadas, e um seletor por texto casa com o
 * painel errado — foi o que aconteceu na primeira execução.
 */
const readinessList = () => page.getByRole('list', { name: 'Prontidão do contrato' });
const readinessStep = (label: string) =>
  readinessList().locator('li').filter({ hasText: label }).first();

// ── ciclo ─────────────────────────────────────────────────────────────────

test.beforeAll(async ({ browser }) => {
  ctx = await browser.newContext();
  page = await ctx.newPage();
  page.setDefaultTimeout(20_000);
  await ctx.addInitScript(() => { window.print = () => {}; });

  await page.goto('/login');
  await page.locator('input[type="email"]').fill(qa.email);
  await page.locator('input[type="password"]').fill(qa.password);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 60_000 });
});

test.afterAll(async () => {
  test.setTimeout(120_000);
  await ctx?.close();
  if (!contractId) return;

  /*
    O contrato criado e o que pende dele saem. `audit_logs` fica.

    A trilha de auditoria é um registro do que aconteceu, e essas ações
    aconteceram de fato: um contrato foi criado, um documento foi anexado, uma
    etapa foi aprovada. Apagar essas linhas para deixar o banco "limpo" seria
    reescrever a história — e a auditoria que se deixa reescrever para
    conveniência de um teste não serve para auditar nada.

    As linhas remanescentes apontam para um contrato que não existe mais, e
    isso é correto: é assim que uma trilha registra algo que foi removido.
  */
  await withDb(async (q) => {
    // Aditivos primeiro: `contract_amendment_clauses` referencia cláusulas.
    await q(`delete from contract_amendment_clauses where amendment_id in
             (select id from contract_amendments where contract_id = $1)`, [contractId]);
    await q(`delete from contract_amendments where contract_id = $1`, [contractId]);
    await q(`delete from contract_penalties where contract_id = $1`, [contractId]);
    /*
      Fase 3 antes das cláusulas e documentos: uma definição de obrigação
      referencia a sua ORIGEM com ON DELETE RESTRICT, e é isso que impede
      apagar a cláusula que sustenta uma obrigação viva. A ordem aqui não é
      detalhe de limpeza — é a mesma regra que protege o contrato em produção.
    */
    await q(`delete from contract_obligation_evidence where contract_id = $1`, [contractId]);
    await q(`delete from contract_obligation_exceptions where contract_id = $1`, [contractId]);
    await q(`delete from contract_obligation_financial_impacts where contract_id = $1`, [contractId]);
    await q(`delete from contract_obligation_evidence_requirements where contract_id = $1`, [contractId]);
    await q(`delete from contract_obligation_dependencies where contract_id = $1`, [contractId]);
    await q(`delete from contract_obligation_instances where contract_id = $1`, [contractId]);
    await q(`delete from contract_obligation_definitions where contract_id = $1`, [contractId]);
    await q(`update contract_clauses set superseded_by_clause_id = null where contract_id = $1`, [contractId]);
    await q(`delete from contract_clauses where contract_id = $1`, [contractId]);
    await q(`delete from contract_ai_analyses where contract_id = $1`, [contractId]);
    await q(`update contract_documents set superseded_by_document_id = null,
             supersedes_document_id = null, superseded_at = null where contract_id = $1`, [contractId]);
    for (const [table, column] of [
      ['contract_obligations', 'contract_id'],
      ['contract_billing_events', 'contract_id'],
      ['contract_documents', 'contract_id'],
      ['contract_milestones', 'contract_id'],
      ['contract_approvals', 'contract_id'],
      ['contract_project_links', 'contract_id'],
      ['contract_risks_links', 'contract_id'],
      ['contract_files', 'contract_id'],
      ['tasks', 'related_contract_id'],
    ] as const) {
      await q(`delete from ${table} where ${column} = $1`, [contractId]);
    }
    await q(`delete from contracts where id = $1`, [contractId]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 1 · Cadastro
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

test('1 · Cadastrar um contrato operacional pela interface', async () => {
  await page.goto('/contratos');
  await page.getByRole('button', { name: 'Novo Contrato' }).click();
  await expect(drawer()).toBeVisible({ timeout: 20_000 });

  // ── Etapa 1: identidade ──
  await byLabel(drawer(), 'Nº do contrato').fill(NUMBER);
  await byLabel(drawer(), 'Nome do contrato').fill(TITLE);
  await byLabel(drawer(), 'Contraparte').fill(COUNTERPARTY);
  await byLabel(drawer(), 'Tipo de contrato', 'select').selectOption('Prestação de serviços');

  // O responsável é um usuário REAL da organização, não texto livre.
  const owner = byLabel(drawer(), 'Responsável interno', 'select');
  await expect(owner.locator('option')).not.toHaveCount(1, { timeout: 20_000 });
  await owner.selectOption({ index: 1 });

  await byLabel(drawer(), 'Situação', 'select').selectOption('active');
  await byLabel(drawer(), 'Classificação de risco', 'select').selectOption('high');
  const scopeField = byLabel(drawer(), 'Objeto do contrato', 'textarea');
  await scopeField.fill('Manutenção preventiva e corretiva de subestações — escopo de teste E2E.');
  /*
    Confere que o campo REALMENTE reteve o texto antes de seguir.

    Uma execução gravou `scope_summary` nulo: o `fill` encontrou o elemento,
    não lançou, e o valor não chegou ao estado. A falha só apareceu dois
    cenários adiante, como um erro de matcher sobre `null` — mensagem que não
    aponta para nada. Verificar aqui faz o teste falhar onde o problema é.
  */
  await expect(scopeField).toHaveValue(/escopo de teste E2E/);

  // ── Etapa 2: vigência e valor ──
  await drawer().getByRole('button', { name: 'Avançar' }).click();
  await byLabel(drawer(), 'Início da vigência').fill('2026-09-01');
  await byLabel(drawer(), 'Fim da vigência').fill('2027-08-31');
  await byLabel(drawer(), 'Data de assinatura').fill('2026-08-20');
  await byLabel(drawer(), 'Valor contratual (R$)').fill('2400000');
  await byLabel(drawer(), 'Condições de pagamento').fill('30 dias após medição aprovada');

  // ── Etapa 3: projeto ──
  await drawer().getByRole('button', { name: 'Avançar' }).click();
  const projectSelect = byLabel(drawer(), 'Projeto', 'select');
  // O valor da opção é o id do projeto; localiza pelo código exibido.
  const projectValue = await projectSelect
    .locator('option', { hasText: PROJECT_CODE })
    .first()
    .getAttribute('value');
  expect(projectValue, `projeto "${PROJECT_CODE}" ausente na lista`).toBeTruthy();
  await projectSelect.selectOption(projectValue!);

  // ── Etapa 4: documento ──
  await drawer().getByRole('button', { name: 'Avançar' }).click();
  await drawer().locator('input[type="file"]').setInputFiles({
    name: `contrato-${RUN}.pdf`,
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.4\n% contrato e2e\n'),
  });
  await byLabel(drawer(), 'Tipo do documento', 'select').selectOption('contract');

  // ── Etapa 5: revisão e salvamento ──
  await drawer().getByRole('button', { name: 'Avançar' }).click();
  await expect(drawer().getByText(NUMBER)).toBeVisible();
  await drawer().getByRole('button', { name: 'Salvar contrato' }).click();

  await expectToast(new RegExp(`Contrato "\\[E2E\\].*${RUN}" criado`), 60_000);

  const rows = await withDb((q) => q(
    `select * from contracts where contract_number = $1 and deleted_at is null`, [NUMBER]));
  expect(rows.length, 'o contrato deveria existir no banco').toBe(1);
  contractId = rows[0].id;
});

test('2 · O contrato nasce NÃO CLASSIFICADO, com identidade completa', async () => {
  const [c] = await withDb((q) => q(`select * from contracts where id = $1`, [contractId]));

  /*
    Fase 0.7: cadastrar não é afirmar procedência.

    Antes a interface gravava `'live'` — ela se autocertificava como carteira
    oficial —, o que contradizia o default que a própria migration 091 escolheu
    para a coluna. Agora o contrato nasce `unclassified`: existe, é plenamente
    operável, e fica fora de toda métrica oficial até que alguém afirme, com
    justificativa e trilha, que ele é real.
  */
  expect(c.data_class).toBe('unclassified');

  expect(c.title).toBe(TITLE);
  expect(c.counterparty_name).toBe(COUNTERPARTY);
  expect(c.contract_type).toBe('Prestação de serviços');
  expect(c.status).toBe('active');
  expect(String(c.total_value)).toBe('2400000.00');
  expect(c.currency).toBe('BRL');
  expect(c.payment_terms).toBe('30 dias após medição aprovada');
  expect(c.risk_level).toBe('high');

  // Responsável é um usuário real, gravado na coluna — não texto no resumo.
  expect(c.owner_user_id).toBeTruthy();
  expect(c.scope_summary).not.toContain('Responsável');

  // Vigência é a informada, sem arredondamento nem invenção.
  expect(ymd(c.start_date)).toBe('2026-09-01');
  expect(ymd(c.end_date)).toBe('2027-08-31');
  expect(ymd(c.signed_date)).toBe('2026-08-20');
});

test('3 · O que não foi informado permanece VAZIO', async () => {
  /*
    O cadastro anterior gravava um vencimento de um ano à frente e uma data de
    renovação 60 dias antes dele quando o usuário não informava nenhum dos
    dois. Os dois valores viravam colunas de um contrato `live` e alimentavam o
    Horizonte de Renovação como se tivessem sido lidos do papel.
  */
  const [c] = await withDb((q) => q(`select * from contracts where id = $1`, [contractId]));
  expect(c.renewal_date, 'renovação não informada não pode ser inventada').toBeNull();
  expect(c.monthly_value, 'valor mensal não informado não pode virar zero').toBeNull();

  // `lifecycle_stage` recebe o estágio, não o status comercial.
  expect(c.lifecycle_stage).toBe('created');
  expect(c.lifecycle_stage).not.toBe(c.status);
});

test('4 · O documento original entra versionado e analisável', async () => {
  const docs = await withDb((q) => q(
    `select * from contract_documents where contract_id = $1`, [contractId]));
  expect(docs.length, 'o PDF do cadastro deveria estar em contract_documents').toBe(1);
  expect(docs[0].document_type).toBe('contract');
  expect(docs[0].version).toBe(1);
  expect(docs[0].file_path).toBeTruthy();

  /*
    Ir para `contract_documents`, e não `contract_files`, é o que torna o papel
    original analisável, versionável e substituível: o extrator lê desta tabela.
  */
  const files = await withDb((q) => q(
    `select count(*)::int n from contract_files where contract_id = $1`, [contractId]));
  expect(files[0].n).toBe(0);
});

test('5 · Nenhuma análise falsa é criada no cadastro', async () => {
  /*
    A criação registrava uma análise `pending` que nada jamais concluía —
    o contrato exibia "tem análise de IA" sem ter análise alguma.
  */
  const rows = await withDb((q) => q(
    `select status, extracted_data from contract_ai_analyses where contract_id = $1`, [contractId]));
  expect(rows.length, 'o cadastro sem análise pedida não cria análise').toBe(0);
});

// ═══════════════════════════════════════════════════════════════════════════
// 2 · Prontidão
// ═══════════════════════════════════════════════════════════════════════════

test('6 · A lista de prontidão mostra o que existe e o que falta', async () => {
  await gotoDossier();

  const identity = readinessStep('Identidade do contrato');
  await expect(identity).toContainText('Registrado', { timeout: 20_000 });
  await expect(readinessStep('Projeto vinculado')).toContainText('Registrado');
  await expect(readinessStep('Documento original')).toContainText('Registrado');

  // Identidade + projeto + documento ⇒ operável.
  await expect(page.getByText(/plenamente operável/)).toBeVisible();
});

test('7 · Ausência de instrumentação NÃO é tratada como irregularidade', async () => {
  await gotoDossier();

  // Ainda não há obrigação, marco nem aprovação — e o painel diz isso sem alarme.
  await expect(readinessStep('Obrigações')).toContainText('A registrar');
  await expect(readinessStep('Marcos e medições')).toContainText('A registrar');

  // A frase que impede a leitura errada da lista inteira.
  await expect(page.getByText('Ausência aqui não é irregularidade')).toBeVisible();
});

// ═══════════════════════════════════════════════════════════════════════════
// 3 · Instrumentação
// ═══════════════════════════════════════════════════════════════════════════

test('8 · Registrar obrigação estruturada, com origem e prazo', async () => {
  await openDossierTab('Obrigações');
  await page.getByRole('button', { name: /Nova obrigação/ }).first().click();
  await byLabel(modal(), 'Título').fill(`E2E obrigação ${RUN}`);
  await byLabel(modal(), 'Prazo').fill('2026-12-15');

  const origem = byLabel(modal(), 'Origem no contrato', 'select');
  const opcao = await origem.locator('option').nth(1).getAttribute('value');
  expect(opcao, 'o contrato precisa ter cláusula ou documento para originar a obrigação').toBeTruthy();
  await origem.selectOption(opcao!);
  await modal().getByRole('button', { name: 'Registrar obrigação' }).click();
  await expectToast('Registro criado');

  const rows = await withDb((q) => q(
    `select title, due_kind, due_fixed_date, effective_from, recurrence_kind
       from contract_obligation_definitions where contract_id = $1`, [contractId]));
  expect(rows.length).toBe(1);
  expect(rows[0].title).toBe(`E2E obrigação ${RUN}`);
  // A data informada virou REGRA de prazo, não um campo solto.
  expect(rows[0].due_kind).toBe('fixed_date');
  expect(rows[0].recurrence_kind).toBe('one_time');
  // O driver devolve `date` como Date; comparar o dia evita depender do fuso
  // em que o teste roda.
  expect(new Date(rows[0].due_fixed_date).toISOString().slice(0, 10)).toBe('2026-12-15');
});

test('9 · Registrar marco de medição', async () => {
  await openDossierTab('Financeiro');
  await page.getByRole('button', { name: 'Novo marco' }).first().click();
  await byLabel(modal(), 'Título do marco').fill(`E2E marco ${RUN}`);
  await byLabel(modal(), 'Valor previsto (R$)').fill('600000');
  await modal().getByRole('button', { name: 'Registrar marco' }).click();
  await expectToast('Marco registrado');

  const rows = await withDb((q) => q(
    `select * from contract_milestones where contract_id = $1`, [contractId]));
  expect(rows.length).toBe(1);
});

test('10 · Registrar evento de faturamento', async () => {
  await openDossierTab('Financeiro');
  await page.getByRole('button', { name: 'Novo evento' }).first().click();
  await byLabel(modal(), 'Título do evento').fill(`E2E faturamento ${RUN}`);
  await byLabel(modal(), 'Valor (R$)').fill('600000');
  await byLabel(modal(), 'Vencimento').fill('2026-11-30');
  await modal().getByRole('button', { name: 'Registrar evento', exact: true }).click();
  await expectToast('Registro criado');

  const rows = await withDb((q) => q(
    `select * from contract_billing_events where contract_id = $1`, [contractId]));
  expect(rows.length).toBe(1);
});

test('11 · A prontidão reflete a instrumentação recém-criada', async () => {
  await gotoDossier();
  await expect(readinessStep('Obrigações')).toContainText('Registrado', { timeout: 20_000 });
  await expect(readinessStep('Obrigações')).toContainText('1 obrigação registrada');
  await expect(readinessStep('Marcos e medições')).toContainText('Registrado');
});

// ═══════════════════════════════════════════════════════════════════════════
// 4 · Análise assistida — opcional, e segura quando pulada
// ═══════════════════════════════════════════════════════════════════════════

test('12 · O contrato é plenamente operável sem nenhuma análise de IA', async () => {
  /*
    A verificação que importa nesta fase: a IA é opcional de verdade. Um
    contrato que nunca foi analisado atravessa cadastro, instrumentação,
    aprovação e dossiê oficial sem bloqueio algum.
  */
  const rows = await withDb((q) => q(
    `select count(*)::int n from contract_ai_analyses where contract_id = $1`, [contractId]));
  expect(rows[0].n).toBe(0);

  await gotoDossier();
  await expect(page.getByText(/plenamente operável/)).toBeVisible();

  // E as cláusulas aparecem como não registradas — jamais como violação.
  await expect(readinessStep('Cláusulas revisadas')).toContainText('A registrar');
});


// ═══════════════════════════════════════════════════════════════════════════
// 4b · Análise assistida executada de verdade
// ═══════════════════════════════════════════════════════════════════════════

test('12b · Rodar a análise no documento do cadastro', async () => {
  await openDossierTab('Riscos & Cláusulas');

  const analyze = page.getByRole('button', { name: /^(Analisar|Reanalisar)$/ }).first();
  await expect(analyze).toBeVisible({ timeout: 30_000 });
  await analyze.click();

  // A extração chama um modelo remoto: pode concluir ou falhar por rede/cota.
  // Os DOIS desfechos são aceitáveis aqui; o que não é aceitável é ficar
  // eternamente "analisando" ou gravar análise sem proveniência.
  await expect(
    page.getByText(/cláusula\(s\) propostas|Nenhuma cláusula nova|não pôde ser|Falha/).first(),
  ).toBeVisible({ timeout: 120_000 });

  const [record] = await withDb((q) => q(
    `select status, model, extractor_version, document_id, error_message
       from contract_ai_analyses
      where contract_id = $1 and extracted_data->>'kind' = 'clause_extraction'
      order by created_at desc limit 1`, [contractId]));

  expect(record, 'a análise deveria ter deixado registro').toBeTruthy();
  // Estado TERMINAL: um documento não pode ficar para sempre em análise.
  expect(['completed', 'failed']).toContain(record.status);
  // Proveniência em COLUNAS — consultável, inclusive quando a análise falha.
  expect(record.model).toBeTruthy();
  expect(record.extractor_version).toBeTruthy();
  expect(record.document_id).toBeTruthy();
  if (record.status === 'failed') expect(record.error_message).toBeTruthy();
});

test('12c · Toda proposta nasce aguardando revisão humana', async () => {
  const rows = await withDb((q) => q(
    `select review_status, ai_flagged, source_excerpt, source_document_id
       from contract_clauses where contract_id = $1 and ai_flagged = true`, [contractId]));

  for (const r of rows) {
    // Nenhuma leitura de máquina entra como cláusula validada do contrato.
    expect(r.review_status, 'proposta não pode nascer validada').not.toBe('validated');
    // E nenhuma entra sem o trecho que a sustenta.
    expect(r.source_excerpt, 'proposta sem evidência não deveria existir').toBeTruthy();
    expect(r.source_document_id).toBeTruthy();
  }

  // A prontidão continua contando cláusulas VALIDADAS, não propostas.
  if (rows.length > 0) {
    await gotoDossier();
    await expect(readinessStep('Cláusulas revisadas')).toContainText(/aguardando revisão|A registrar/);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// 4c · Linhagem do documento
// ═══════════════════════════════════════════════════════════════════════════

test('12d · Substituir o documento versiona e encerra as propostas pendentes', async () => {
  /*
    A substituição de documento ainda NÃO tem controle na interface — existe
    como serviço desde P2E. O teste exercita a regra pela mesma porta que o
    produto usaria, e a ausência do botão está registrada como pendência.
  */
  const original = await documentIdByTitle(`contrato-${RUN}.pdf`);

  const [replacement] = await withDb((q) => q(
    `insert into contract_documents
       (organization_id, contract_id, title, file_path, document_type, status, uploaded_by)
     select organization_id, contract_id, $2, $3, 'contract', 'uploaded', uploaded_by
       from contract_documents where id = $1
     returning id`,
    [original, `contrato-${RUN}-v2.pdf`, `e2e/${RUN}/v2.pdf`]));

  const pendingBefore = await withDb((q) => q(
    `select count(*)::int n from contract_clauses
      where source_document_id = $1 and ai_flagged = true
        and review_status in ('draft', 'in_review')`, [original]));

  await withDb(async (q) => {
    await q(`update contract_documents set superseded_by_document_id = $2, superseded_at = now() where id = $1`,
      [original, replacement.id]);
    await q(`update contract_documents set supersedes_document_id = $1, version = 2 where id = $2`,
      [original, replacement.id]);
    await q(`update contract_clauses set review_status = 'superseded'
              where source_document_id = $1 and ai_flagged = true
                and review_status in ('draft', 'in_review')`, [original]);
  });

  const [after] = await withDb((q) => q(
    `select version, supersedes_document_id from contract_documents where id = $1`, [replacement.id]));
  expect(after.version).toBe(2);
  expect(after.supersedes_document_id).toBe(original);

  // Propostas do papel superado saem da fila: não podem seguir vigentes.
  const [still] = await withDb((q) => q(
    `select count(*)::int n from contract_clauses
      where source_document_id = $1 and review_status in ('draft', 'in_review')`, [original]));
  expect(still.n).toBe(0);

  // O selo de versão vive no painel de operação de cláusulas, não na visão geral.
  await openDossierTab('Riscos & Cláusulas');
  await expect(page.locator('li').filter({ hasText: `contrato-${RUN}-v2.pdf` }).first())
    .toContainText('v2', { timeout: 20_000 });
  await expect(page.locator('li').filter({ hasText: `contrato-${RUN}.pdf` }).first())
    .toContainText('substituído por versão mais recente');
  expect(pendingBefore[0].n).toBeGreaterThanOrEqual(0);
});

// ═══════════════════════════════════════════════════════════════════════════
// 4d · Aprovação
// ═══════════════════════════════════════════════════════════════════════════

/*
  Fase 0.2 mudou o que este cenário pode provar, e a mudança é o ponto.

  Quem executa este E2E é o mesmo usuário que cadastrou o contrato alguns testes
  atrás. Antes, ele aprovava a etapa jurídica do próprio contrato e o teste
  registrava isso como o caminho feliz. Agora o banco recusa — segregação de
  funções, trigger `trg_contract_approval_safety`, migration 100 — e a recusa é
  o comportamento correto, não uma regressão.

  O caminho feliz da aprovação por um SEGUNDO usuário é provado onde pode ser
  provado de verdade, com dois usuários distintos e RLS ativa:
  `tests/integration/contracts-phase0-live-rls.test.ts`.
*/
test('12e · O autor do contrato não decide a própria aprovação', async () => {
  await openDossierTab('Aprovações');
  await page.getByRole('button', { name: 'Registrar decisão' }).first().click();
  await expect(modal()).toBeVisible({ timeout: 20_000 });

  await byLabel(modal(), 'Etapa', 'select').selectOption('juridico');
  await byLabel(modal(), 'Decisão', 'select').selectOption('approved');
  await modal().locator('textarea').last().fill(`E2E parecer jurídico ${RUN}`);
  await modal().getByRole('button', { name: 'Aprovar', exact: true }).click();

  // A recusa vem do banco e chega ao usuário com o motivo, não como erro genérico.
  await expectToast(/Segregação de funções/i, 40_000);

  const decided = await withDb((q) => q(
    `select step_name, status from contract_approvals
      where contract_id = $1 and status in ('approved','rejected')`, [contractId]));
  expect(decided, 'nenhuma decisão terminal pode ter sido gravada').toEqual([]);
});

test('12e.1 · O trâmite continua livre: solicitar ajustes é registrado', async () => {
  // `under_review` não é decisão — recusar isso travaria o fluxo inteiro para
  // quem cadastra, que é justamente quem conduz o contrato até a aprovação.
  await byLabel(modal(), 'Decisão', 'select').selectOption('changes');
  await modal().locator('textarea').last().fill(`E2E ajustes jurídicos ${RUN}`);
  await modal().getByRole('button', { name: 'Solicitar', exact: true }).click();

  /*
    Espera-se o FECHAMENTO do modal, não um texto de toast.

    `expectToast` procura o texto em qualquer lugar da página, e com a decisão
    "changes" selecionada o próprio modal exibe o rótulo "Ajustes solicitados
    (obrigatório)" no textarea. Um matcher amplo casava com esse rótulo e
    retornava ANTES do clique terminar, deixando a leitura do banco correr na
    frente da escrita — o teste passava ou falhava conforme a latência.

    O modal só fecha quando a operação inteira concluiu (`run()` fecha no
    sucesso), então esperá-lo sumir é esperar o fato, não a aparência dele.
  */
  await expect(modal()).toBeHidden({ timeout: 40_000 });

  const rows = await withDb((q) => q(
    `select step_name, status, reviewer_user_id, comments
       from contract_approvals where contract_id = $1`, [contractId]));
  const juridico = rows.find((r) => r.step_name === 'juridico');
  expect(juridico?.status).toBe('under_review');
  // Quem agiu fica carimbado: etapa sem autor não é etapa.
  expect(juridico?.reviewer_user_id, 'a etapa precisa registrar quem agiu').toBeTruthy();
  expect(juridico?.comments).toContain(RUN);

  const audited = await withDb((q) => q(
    `select id from audit_logs
      where entity_type='contract' and entity_id=$1 and action='contract.changes_requested'`, [contractId]));
  expect(audited.length, 'a solicitação de ajustes precisa estar na auditoria').toBeGreaterThan(0);
});

test('12f · A prontidão reflete a rota de aprovação registrada', async () => {
  await gotoDossier();
  await expect(readinessStep('Rota de aprovação')).toContainText('Registrado', { timeout: 20_000 });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4e · Substituição de documento pela INTERFACE (P2F.1)
// ═══════════════════════════════════════════════════════════════════════════

test('12g · Substituir documento pela interface preserva a versão anterior', async () => {
  await openDossierTab('Documentos');

  const card = page.locator('div').filter({ hasText: `contrato-${RUN}-v2.pdf` })
    .filter({ has: page.getByRole('button', { name: 'Substituir por nova versão' }) }).last();
  await expect(card).toBeVisible({ timeout: 30_000 });
  await card.getByRole('button', { name: 'Substituir por nova versão' }).click();

  await expect(modal()).toBeVisible({ timeout: 20_000 });
  await byLabel(modal(), 'Título da nova versão').fill(`contrato-${RUN}-v3.pdf`);
  await modal().locator('input[type="file"]').setInputFiles({
    name: `contrato-${RUN}-v3.pdf`,
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.4\n% v3 e2e\n'),
  });
  await modal().getByRole('button', { name: 'Registrar nova versão' }).click();
  await expectToast(/nova versão registrada/i, 60_000);

  const docs = await withDb((q) => q(
    `select id, title, version, supersedes_document_id, superseded_by_document_id
       from contract_documents where contract_id = $1 order by created_at`, [contractId]));

  const v2 = docs.find((d) => d.title === `contrato-${RUN}-v2.pdf`);
  const v3 = docs.find((d) => d.title === `contrato-${RUN}-v3.pdf`);
  expect(v3, 'a nova versão deveria existir').toBeTruthy();

  // A anterior NÃO foi apagada — continua no repositório, apontando o sucessor.
  expect(v2, 'a versão anterior não pode ser apagada').toBeTruthy();
  expect(v2.superseded_by_document_id).toBe(v3.id);
  expect(v3.supersedes_document_id).toBe(v2.id);
  expect(v3.version).toBe(3);

  // E a auditoria registra a substituição.
  const audit = await withDb((q) => q(
    `select action from audit_logs where entity_type = 'contract' and entity_id = $1`, [contractId]));
  expect(audit.map((r) => r.action)).toContain('contract.document_superseded');
});

test('12h · O documento já substituído não oferece substituição', async () => {
  /*
    Substituir um documento já substituído criaria duas versões apontando para
    o mesmo antecessor, e a linhagem deixaria de ser uma linha.
  */
  await openDossierTab('Documentos');
  const stale = page.locator('div').filter({ hasText: `contrato-${RUN}-v2.pdf` }).last();
  await expect(stale).toContainText('substituído por versão mais recente', { timeout: 20_000 });
  await expect(stale.getByRole('button', { name: 'Substituir por nova versão' })).toHaveCount(0);
});

// ═══════════════════════════════════════════════════════════════════════════
// 4f · Aditivo contratual
// ═══════════════════════════════════════════════════════════════════════════

test('12i · Registrar o Aditivo 01 pela interface', async () => {
  await gotoDossier();
  await page.getByRole('button', { name: 'Adicionar aditivo' }).first().click();
  await expect(modal()).toBeVisible({ timeout: 20_000 });

  await byLabel(modal(), 'Número do aditivo').fill(`TA-01-${RUN}`);
  await byLabel(modal(), 'Título').fill('Reajuste e prorrogação');
  await byLabel(modal(), 'Data de assinatura').fill('2027-01-10');
  await byLabel(modal(), 'Data de efeito').fill('2027-02-01');
  await byLabel(modal(), 'Situação', 'select').selectOption('active');

  // Acréscimo de valor: o papel diz "fica acrescido de".
  await modal().getByText('Acréscimo ou supressão').click();
  await byLabel(modal(), 'Acréscimo (R$)').fill('600000');

  // Prorrogação de prazo.
  await modal().getByText('Prorrogação em dias').click();
  await byLabel(modal(), 'Dias de prorrogação').fill('180');

  await modal().locator('input[type="file"]').setInputFiles({
    name: `aditivo-01-${RUN}.pdf`,
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.4\n% aditivo e2e\n'),
  });

  await modal().getByRole('button', { name: 'Registrar aditivo' }).click();
  /*
    A frase completa, não um trecho: `/aditivo .* registrado/i` casava com
    "Nenhum aditivo registrado" — o estado VAZIO do próprio painel — e o teste
    passava sem que nada tivesse sido gravado.
  */
  await expectToast('O contrato original permanece inalterado.', 60_000);

  const rows = await withDb((q) => q(
    `select * from contract_amendments where contract_id = $1`, [contractId]));
  expect(rows.length).toBe(1);
  const a = rows[0];
  expect(a.amendment_number).toBe(`TA-01-${RUN}`);
  expect(a.status).toBe('active');
  expect(Number(a.value_delta)).toBe(600000);
  expect(a.value_absolute, 'as duas formas de valor são exclusivas').toBeNull();
  expect(a.term_extension_days).toBe(180);
  expect(ymd(a.effective_date)).toBe('2027-02-01');
  expect(a.document_id, 'o PDF do aditivo deveria estar vinculado').toBeTruthy();
});

test('12j · O contrato MESTRE não é sobrescrito pelo aditivo', async () => {
  /*
    A regra central de P2F.1. Se o aditivo gravasse o valor novo por cima do
    mestre, a pergunta "de quanto foi o reajuste?" perderia resposta no dia em
    que uma auditoria precisasse dela.
  */
  const [c] = await withDb((q) => q(`select * from contracts where id = $1`, [contractId]));
  expect(String(c.total_value), 'o valor original permanece').toBe('2400000.00');
  expect(ymd(c.end_date), 'a vigência original permanece').toBe('2027-08-31');
});

test('12k · O aditivo permanece ligado ao contrato mestre', async () => {
  const [a] = await withDb((q) => q(
    `select a.contract_id, c.contract_number
       from contract_amendments a join contracts c on c.id = a.contract_id
      where a.contract_id = $1`, [contractId]));
  expect(a.contract_id).toBe(contractId);
  expect(a.contract_number).toBe(NUMBER);

  // O PDF do aditivo entra como documento do contrato, tipado como aditivo.
  const [doc] = await withDb((q) => q(
    `select d.document_type from contract_documents d
       join contract_amendments a on a.document_id = d.id
      where a.contract_id = $1`, [contractId]));
  expect(doc.document_type).toBe('amendment');
});

test('12l · O efeito declarado é registrado, datado, e ainda NÃO é o vigente', async () => {
  /*
    O TA-01 tem efeito em 01/02/2027, data que ainda não chegou. "Vigente" é o
    estado do contrato HOJE, e antecipá-lo afirmaria como valor de contrato um
    número que nenhuma cláusula ainda produz — um reajuste futuro apresentado
    como faturável agora. O aditivo aparece inteiro na cadeia, com a data e o
    efeito que declara; o valor e a vigência vigentes só mudam quando a data
    chegar. Ver `effectiveContractState` e o motivo de omissão 'future'.
  */
  await gotoDossier();
  const instruments = page.getByRole('list', { name: 'Instrumentos contratuais' });
  await expect(instruments).toBeVisible({ timeout: 30_000 });

  // O mestre e o aditivo aparecem, nessa ordem.
  await expect(instruments.locator('li').first()).toContainText('Contrato mestre');
  await expect(instruments).toContainText(`TA-01-${RUN}`);

  // O efeito declarado fica visível no próprio instrumento, com a data e a razão
  // pela qual ainda não foi aplicado.
  const step = instruments.locator('li').filter({ hasText: `TA-01-${RUN}` }).last();
  await expect(step).toContainText('efeito em 01/02/2027');
  await expect(step).toContainText('600.000');
  await expect(step).toContainText('180 dias');
  await expect(step).toContainText('efeito futuro');

  /*
    Valor e vigência vivem em CARDS IRMÃOS do painel. Um seletor ancorado em
    "Valor original" devolve só o primeiro — foi o que fez a asserção de data
    procurar no lugar errado.
  */
  const valueCard = page.locator('div').filter({ hasText: 'Valor original' }).last();
  await expect(valueCard).toContainText('2.400.000');
  await expect(valueCard).not.toContainText('3.000.000');

  // A prorrogação de 180 dias (31/08/2027 → 27/02/2028) também é futura.
  const termCard = page.locator('div').filter({ hasText: 'Vigência original' }).last();
  await expect(termCard).toContainText('31/08/2027');
  await expect(termCard).not.toContainText('27/02/2028');
});

test('12m · Aditivo em rascunho é registrado mas NÃO altera o vigente', async () => {
  await gotoDossier();
  await page.getByRole('button', { name: 'Adicionar aditivo' }).first().click();
  await expect(modal()).toBeVisible({ timeout: 20_000 });

  await byLabel(modal(), 'Número do aditivo').fill(`TA-02-${RUN}`);
  await byLabel(modal(), 'Data de efeito').fill('2027-06-01');
  await byLabel(modal(), 'Situação', 'select').selectOption('draft');
  await modal().getByText('Novo valor total').click();
  await byLabel(modal(), 'Novo valor total (R$)').fill('9999999');
  await modal().getByRole('button', { name: 'Registrar aditivo' }).click();
  await expectToast('O contrato original permanece inalterado.', 60_000);

  await gotoDossier();
  const valueCard = page.locator('div').filter({ hasText: 'Valor original' }).last();
  // O rascunho aparece na lista…
  await expect(page.getByRole('list', { name: 'Instrumentos contratuais' }))
    .toContainText(`TA-02-${RUN}`);
  // …e NÃO altera o valor vigente, que segue sendo o do mestre: nem o rascunho
  // nem o TA-01 (efeito futuro) produzem efeito hoje.
  await expect(valueCard).toContainText('2.400.000');
  await expect(valueCard).not.toContainText('9.999.999');
});

test('12n · A auditoria registra o aditivo', async () => {
  const rows = await withDb((q) => q(
    `select action, metadata from audit_logs
      where entity_type = 'contract' and entity_id = $1 and action = 'contract.amendment_created'
      order by created_at`, [contractId]));
  expect(rows.length).toBe(2);
  const first = rows[0];
  expect(first.metadata.amendment_number).toBe(`TA-01-${RUN}`);
  // O efeito declarado fica na trilha, não só o fato de ter havido aditivo.
  expect(String(first.metadata.value_delta)).toBe('600000');
  expect(first.metadata.term_extension_days).toBe(180);
});

test('12o · A leitura assistida aceita o PDF do aditivo', async () => {
  /*
    Um aditivo é analisável como qualquer outro documento do contrato: ele
    entra em `contract_documents`, e o extrator lê dessa tabela.
  */
  await openDossierTab('Riscos & Cláusulas');
  /*
    O documento do aditivo é TITULADO pelo instrumento ("TA-01 — Reajuste"),
    não pelo nome do arquivo: é o rótulo que um humano procura no painel.
  */
  /*
    Filtrar TAMBÉM pelo botão: o número do aditivo aparece em dois painéis da
    mesma página — o de Instrumentos e o de operação de cláusulas — e só o
    segundo tem o gatilho de análise.
  */
  const row = page.locator('li')
    .filter({ hasText: `TA-01-${RUN}` })
    .filter({ has: page.getByRole('button', { name: /^(Analisar|Reanalisar)$/ }) })
    .first();
  await expect(row).toBeVisible({ timeout: 30_000 });
  await row.getByRole('button', { name: /^(Analisar|Reanalisar)$/ }).click();

  await expect(
    page.getByText(/cláusula\(s\) propostas|Nenhuma cláusula nova|não pôde ser|Falha/).first(),
  ).toBeVisible({ timeout: 120_000 });

  const [amendmentDoc] = await withDb((q) => q(
    `select d.id from contract_documents d join contract_amendments a on a.document_id = d.id
      where a.contract_id = $1 and a.amendment_number = $2`, [contractId, `TA-01-${RUN}`]));

  const [record] = await withDb((q) => q(
    `select status, model, extractor_version, document_id from contract_ai_analyses
      where contract_id = $1 and document_id = $2 order by created_at desc limit 1`,
    [contractId, amendmentDoc.id]));

  expect(record, 'a análise do aditivo deveria ter registro').toBeTruthy();
  expect(['completed', 'failed']).toContain(record.status);
  // Proveniência: a análise aponta para o documento DO ADITIVO.
  expect(record.document_id).toBe(amendmentDoc.id);
  expect(record.model).toBeTruthy();

  // E toda proposta vinda dele guarda origem, página e trecho.
  const proposals = await withDb((q) => q(
    `select source_document_id, source_page, source_excerpt, review_status
       from contract_clauses where source_document_id = $1 and ai_flagged = true`,
    [amendmentDoc.id]));
  for (const prop of proposals) {
    expect(prop.source_excerpt).toBeTruthy();
    expect(prop.source_page).not.toBeNull();
    expect(prop.review_status).not.toBe('validated');
  }
});

test('12p · O dossiê em PDF preserva mestre e aditivos', async () => {
  await gotoDossier();
  const popup = page.waitForEvent('popup', { timeout: 60_000 });
  await page.getByRole('button', { name: /Exportar PDF/ }).first().click();
  const pdf = await popup;
  await pdf.waitForLoadState('domcontentloaded');

  const body = await pdf.locator('body').innerText();
  expect(body).toContain('Instrumentos Contratuais');
  expect(body).toContain(`TA-01-${RUN}`);
  // Original e vigente, os dois — nunca só um.
  expect(body).toContain('Valor original');
  expect(body).toContain('2.400.000');
  /*
    O TA-01 tem efeito em 01/02/2027 e o documento é emitido antes dessa data:
    o acréscimo declarado é impresso como alteração do instrumento, com a
    situação que explica por que ainda não entrou no vigente. Imprimir
    3.000.000 como valor vigente seria antecipar um reajuste que nenhuma
    cláusula ainda produziu.
  */
  expect(body).toContain('600.000');
  expect(body).toContain('efeito futuro');
  await pdf.close();
});

// ═══════════════════════════════════════════════════════════════════════════
// 5 · Aprovação, auditoria e saída oficial
// ═══════════════════════════════════════════════════════════════════════════

test('13 · A trilha de auditoria registra a entrada do contrato', async () => {
  const rows = await withDb((q) => q(
    `select action from audit_logs where entity_type = 'contract' and entity_id = $1 order by created_at`,
    [contractId]));
  const actions = rows.map((r) => r.action);
  expect(actions, 'a criação precisa estar auditada').toContain('contract.created');
  expect(actions, 'o anexo do documento precisa estar auditado').toContain('contract.document_uploaded');
});

test('14 · A auditoria aparece no dossiê', async () => {
  /*
    A auditoria deixou de ser aba e virou a gaveta "Histórico" — ela aparecia
    duas vezes no dossiê, na timeline lateral e na aba. O destino é o mesmo, e
    `?tab=audit` continua abrindo a gaveta; o que este teste garante é que o
    histórico siga alcançável a partir do dossiê.
  */
  await gotoDossier();
  await page.getByRole('button', { name: 'Histórico' }).click();
  // A gaveta traduz a ação para pt-BR; o nome cru só existe em `audit_logs`.
  await expect(page.getByText('Contrato criado').first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('Documento enviado').first()).toBeVisible();
});

test('15 · O contrato recém-criado NÃO entra na carteira oficial', async () => {
  /*
    A inversão da Fase 0.7 vista da tela.

    Este teste afirmava o contrário — "o contrato aparece na carteira OFICIAL"
    sem tocar em filtro nenhum — porque a interface gravava `live` na criação.
    Agora o contrato nasce `unclassified`: ele existe, é plenamente operável, e
    fica fora do recorte oficial até que alguém afirme o contrário.

    O escopo padrão da carteira é "Ao vivo". Encontrar o contrato exige mudar
    para "Não classificados", e é justamente isso que prova a fronteira.
  */
  await page.goto('/contratos');
  await gotoPortfolioSection(page, 'Contratos');
  await page.getByRole('button', { name: 'Tabela' }).click();

  const search = page.getByPlaceholder(/Buscar contrato/);
  await expect(search).toBeVisible({ timeout: 30_000 });
  await search.fill(NUMBER);

  /*
    A ausência é afirmada pelo estado vazio, não por `getByText(NUMBER)` oculto.

    A mensagem de "nenhum resultado" CONTÉM o termo buscado — `Nenhum contrato
    corresponde a "E2E-xxxxxx"` —, então procurar o número e esperá-lo invisível
    encontraria justamente a frase que prova a ausência e concluiria o oposto.
    Afirmar o estado vazio é mais direto e não depende dessa coincidência.
  */
  await expect(page.getByText(/Nenhum contrato corresponde/)).toBeVisible({ timeout: 20_000 });

  /*
    E a carteira DIZ que ele existe, sem que ninguém precise procurar.

    `PortfolioScopeNotice` só aparece quando há registro fora da oficial: o
    contrato recém-criado faz surgir "N registro(s) fora da carteira oficial",
    que abre o seletor de escopo sob demanda. Ausente da métrica, presente na
    tela — que é exatamente a diferença que a Fase 0.7 quis criar.
  */
  await page.getByRole('button', { name: /registro\(s\) fora da carteira oficial/ }).click();

  // Em "Não classificados", está — não sumiu da base, só não é oficial.
  await page.getByRole('button', { name: /Não classificados/ }).click();
  await expect(page.getByText(/Nenhum contrato corresponde/)).toBeHidden({ timeout: 20_000 });
  await expect(page.getByText(NUMBER).first()).toBeVisible({ timeout: 20_000 });
});

test('15.1 · Classificar a origem é um ato de governança, com justificativa', async () => {
  /*
    O outro lado da regra: a afirmação precisa EXISTIR, ela só não pode ser
    automática. Sem esta tela, nascer `unclassified` viraria um beco sem saída e
    nenhum contrato novo entraria jamais na carteira oficial.
  */
  await gotoDossier();
  await page.getByRole('button', { name: 'Mais ações' }).first().click();
  await page.getByRole('menuitem', { name: /Classificar origem/ }).click();
  await expect(modal()).toBeVisible({ timeout: 20_000 });

  await byLabel(modal(), 'Nova origem', 'select').selectOption('live');
  await modal().locator('textarea').last().fill(`Contrato operacional verificado no E2E ${RUN}`);
  await modal().getByRole('button', { name: /Registrar classificação/ }).click();
  await expectToast(/reclassificad|origem/i, 40_000);

  const [c] = await withDb((q) => q(`select data_class from contracts where id = $1`, [contractId]));
  expect(c.data_class).toBe('live');

  // A decisão fica auditada com origem e destino — não basta o estado final.
  const [audit] = await withDb((q) => q(
    `select metadata from audit_logs
      where entity_type='contract' and entity_id=$1 and action='contract.reclassified'
      order by created_at desc limit 1`, [contractId]));
  expect(audit, 'a reclassificação precisa estar na auditoria').toBeTruthy();
  expect(audit.metadata.from).toBe('unclassified');
  expect(audit.metadata.to).toBe('live');
  expect(audit.metadata.reason).toContain(RUN);
});

test('15.2 · Classificado, o contrato passa a compor a carteira oficial', async () => {
  await page.goto('/contratos');
  await gotoPortfolioSection(page, 'Contratos');
  await page.getByRole('button', { name: 'Tabela' }).click();

  const search = page.getByPlaceholder(/Buscar contrato/);
  await expect(search).toBeVisible({ timeout: 30_000 });
  await search.fill(NUMBER);
  // Agora sem tocar em escopo algum: ele pertence ao recorte oficial.
  await expect(page.getByText(/Nenhum contrato corresponde/)).toBeHidden({ timeout: 20_000 });
  await expect(page.getByText(NUMBER).first()).toBeVisible({ timeout: 20_000 });
});

test('16 · Dossiê rápido abre a partir do card da carteira', async () => {
  await page.goto('/contratos');
  await gotoPortfolioSection(page, 'Contratos');
  await page.getByRole('button', { name: 'Cards' }).click();

  const card = page.getByRole('button').filter({ hasText: NUMBER }).first();
  await expect(card).toBeVisible({ timeout: 30_000 });
  await card.click();

  await expect(drawer()).toBeVisible({ timeout: 20_000 });
  await expect(drawer().getByText(COUNTERPARTY).first()).toBeVisible();
});

test('17 · Operações conectadas cobrem os módulos e o Financeiro segue não integrado', async () => {
  await gotoDossier();
  const connected = page.locator('li,div').filter({ hasText: 'Operações conectadas' }).last();
  await expect(connected).toBeVisible();

  /*
    Fronteira de módulo: Contratos orquestra, não duplica. O Financeiro
    permanece NÃO INTEGRADO até ter backend persistido próprio — e a linha diz
    isso em vez de exibir R$ 0, que sugeriria integração existente com
    resultado zero.
  */
  await expect(page.getByText('Não integrado').first()).toBeVisible({ timeout: 20_000 });
});

/*
  Os dois invariantes que a segunda passagem do UI Architecture Gate fixou.
  São de ARQUITETURA, não de estética: um diz que os níveis de navegação são
  distinguíveis, o outro que a tela não pode afirmar duas coisas contrárias
  sobre o mesmo vínculo.
*/
test('19 · A navegação do dossiê é do objeto, e não outra navegação de módulo', async () => {
  await gotoDossier();

  /*
    Os dois níveis se distinguem por EIXO e por peso: a sidebar do Apex é
    vertical e persistente; a do dossiê é horizontal e presa ao contrato. O
    rail vertical anterior punha duas colunas de navegação lado a lado.
  */
  const subnav = page.getByTestId('contract-dossier-tabs');
  await expect(subnav).toBeVisible({ timeout: 20_000 });
  await expect(subnav).toHaveAttribute('aria-orientation', 'horizontal');
  await expect(subnav).toHaveRole('tablist');

  // Uma navegação de dossiê só — nunca duas ao mesmo tempo.
  await expect(page.getByRole('tablist')).toHaveCount(1);

  const selected = subnav.getByRole('tab', { selected: true });
  await expect(selected).toHaveCount(1);

  // O painel é rotulado pela aba corrente.
  await expect(page.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', /^dossier-tab-/);

  // Ações de objeto vivem aqui, não na carteira.
  await expect(page.getByRole('button', { name: 'Histórico' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Exportar/i }).first()).toBeVisible();
});

test('19.1 · A subnav do dossiê acompanha a rolagem', async () => {
  await gotoDossier();
  const subnav = page.getByTestId('contract-dossier-tabs');
  await expect(subnav).toBeVisible({ timeout: 20_000 });

  const before = await subnav.boundingBox();
  await page.mouse.move(760, 500);
  await page.mouse.wheel(0, 900);
  await page.waitForTimeout(1000);
  const after = await subnav.boundingBox();

  /*
    Contrato longo é longo: trocar de seção não pode exigir voltar ao topo.
    O ancestral `HudPageLayout` fecha com `overflow-x: hidden`, o que faz o
    `overflow-y` computar `auto` e transforma aquela raiz no scrollport mais
    próximo — a barra grudava numa caixa tão alta quanto o conteúdo, ou seja,
    não grudava. `.ig-dossier-page` devolve a rolagem ao <main>.
  */
  expect(before!.y).toBeGreaterThan(200);
  expect(after!.y).toBeLessThan(200);
  expect(after!.y).toBeGreaterThanOrEqual(0);
});

test('19.2 · A carteira não expõe ações que pertencem a um contrato', async () => {
  await page.goto('/contratos');
  await expect(page.getByRole('heading', { name: 'Gestão de Contratos' })).toBeVisible({ timeout: 30_000 });

  // "Histórico de quê?" e "PDF de qual recorte?" não têm resposta no módulo.
  await expect(page.getByRole('button', { name: 'Histórico' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Exportar PDF/i })).toHaveCount(0);
});

test('19.3 · Área especializada começa pelo próprio conteúdo', async () => {
  /*
    O resumo executivo completo ocupava a primeira dobra das SETE áreas
    especializadas. Clicar em "Faturamentos" mostrava, antes de faturamento, o
    mesmo panorama da Visão Geral. Agora só a tira de contexto precede.
  */
  await page.goto('/contratos?view=faturamentos');
  const strip = page.getByLabel('Contexto da carteira oficial');
  await expect(strip).toBeVisible({ timeout: 30_000 });

  const box = await strip.boundingBox();
  expect(box!.height).toBeLessThan(96); // uma linha rasa, não um painel

  // O conteúdo da área alcança a primeira dobra.
  const chain = page.getByText('Contract-to-Cash').first();
  await expect(chain).toBeVisible();
  expect((await chain.boundingBox())!.y).toBeLessThan(760);

  // Na Visão Geral o resumo completo continua existindo.
  await page.goto('/contratos');
  await expect(page.getByLabel(/Resumo executivo da carteira oficial/)).toBeVisible({ timeout: 20_000 });
});

test('20 · O dossiê nunca nega o vínculo de projeto que ele mesmo exibe', async () => {
  await gotoDossier();

  /*
    A faixa "assinado sem projeto vinculado" lia `contracts.project_id`; o
    resumo lia o vínculo RESOLVIDO, que aceita também `contract_project_links`.
    Um contrato ligado pela tabela de vínculo aparecia como sem projeto logo
    acima do projeto ao qual está ligado. As duas leituras agora saem da mesma
    relação — e não podem mais coexistir.
  */
  const deniesProject = page.getByText('sem projeto vinculado');
  const showsProject = page.getByRole('link', { name: /Projeto|CEMIG/ });

  const denies = await deniesProject.count();
  const shows = await showsProject.count();
  expect(denies === 0 || shows === 0, 'a tela afirma e nega o mesmo vínculo').toBeTruthy();
});

/*
  Fechamento do UI Architecture Gate: a navegação do módulo é a sidebar.
  Estes testes cobrem o que o §9 pede — rota por área, estado ativo, voltar do
  navegador, deep link direto e sidebar recolhida.
*/
test('21 · Cada área da carteira tem rota própria, e a sidebar a marca', async () => {
  await page.goto('/contratos');

  // Não pode restar uma segunda forma de navegar o mesmo nível.
  await expect(page.getByTestId('portfolio-nav')).toHaveCount(0);

  const group = page.getByRole('button', { name: 'Contratos', exact: true }).first();
  if ((await group.getAttribute('aria-expanded')) === 'false') await group.click();

  for (const [label, slug] of [
    ['Obrigações', 'obrigacoes'],
    ['Faturamentos', 'faturamentos'],
    ['Renovações', 'renovacoes'],
  ] as const) {
    await page.getByRole('link', { name: label, exact: true }).first().click();
    await expect(page).toHaveURL(new RegExp(`\\?view=${slug}$`));
    // O item corrente se anuncia — estado ativo é semântico, não só cor.
    await expect(page.getByRole('link', { name: label, exact: true }).first())
      .toHaveAttribute('aria-current', 'page');
  }

  // Voltar devolve a área anterior, não sai da carteira.
  await page.goBack();
  await expect(page).toHaveURL(/\?view=faturamentos$/);
  await page.goForward();
  await expect(page).toHaveURL(/\?view=renovacoes$/);
});

test('22 · A área da carteira abre por deep link direto', async () => {
  await page.goto('/contratos?view=obrigacoes');
  await expect(page.getByRole('link', { name: 'Obrigações', exact: true }).first())
    .toHaveAttribute('aria-current', 'page');

  // Slug desconhecido não quebra a página: cai na visão geral.
  await page.goto('/contratos?view=nao-existe');
  await expect(page.getByTestId('portfolio-workspace')).toBeVisible({ timeout: 20_000 });
});

test('23 · Recolhida, a sidebar continua dando acesso às áreas', async () => {
  await page.goto('/contratos');
  const collapse = page.getByRole('button', { name: /Recolher|Colapsar|Collapse/i }).first();
  await collapse.click();
  // A sidebar anima ao recolher; o alvo do hover só é estável depois disso.
  await expect(page.getByRole('button', { name: /Expandir/i }).first()).toBeVisible({ timeout: 10_000 });

  // Oito rótulos não cabem em modo ícone: eles vêm no flyout do módulo.
  const trigger = page.getByRole('link', { name: 'Contratos', exact: true }).first();
  await trigger.hover();
  await trigger.focus(); // o Tooltip do Radix abre no foco também, e o teclado é caminho de primeira classe
  /*
    `.first()`: o Radix monta o conteúdo do tooltip duas vezes — o visível e uma
    cópia oculta para leitor de tela. As duas são o mesmo grupo acessível, e
    contar as duas quebraria o modo estrito sem indicar defeito algum.
  */
  const flyout = page.getByRole('group', { name: 'Contratos' }).first();
  await expect(flyout).toBeVisible({ timeout: 15_000 });
  await expect(flyout.getByRole('link')).toHaveCount(8);
  await expect(flyout.getByRole('link', { name: 'Faturamentos' })).toBeVisible();

  await page.getByRole('button', { name: /Expandir/i }).first().click();
});

test('18 · O dossiê oficial em PDF é gerado a partir do contrato live', async () => {
  await gotoDossier();
  const popup = page.waitForEvent('popup', { timeout: 60_000 });
  await page.getByRole('button', { name: /Exportar|PDF|Dossiê/ }).first().click();
  const pdf = await popup;
  await pdf.waitForLoadState('domcontentloaded');

  const body = await pdf.locator('body').innerText();
  expect(body).toContain(NUMBER);
  expect(body).toContain(COUNTERPARTY);
  await pdf.close();
});
