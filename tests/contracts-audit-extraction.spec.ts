/**
 * E2E — o caminho de SUCESSO da extração de cláusulas, e a auditoria que só
 * existe nele.
 *
 * Por que esta suíte foi escrita separada das outras duas: as suítes existentes
 * anexam `Buffer.from('%PDF-1.4\n% contrato e2e\n')` — o cabeçalho de um PDF,
 * não um PDF. Isso é adequado para o que elas testam (upload, versionamento,
 * supersessão, e o comportamento diante de uma análise que FALHA), e não vale a
 * pena mudá-las. Mas significa que toda extração daquelas suítes cai no ramo de
 * erro, e que o ramo de sucesso — o único que escreve
 * `contract.clauses_extracted` — nunca era executado. A trilha de auditoria da
 * análise assistida jamais tinha sido observada de ponta a ponta.
 *
 * Aqui um PDF legítimo, com cláusulas reais, atravessa a rota de verdade.
 *
 * Roda contra o baseURL configurado. Contra a Vercel, `user_agent` e
 * `ip_address` chegam dos cabeçalhos reais da requisição; em servidor local não
 * há proxy e o IP fica nulo — o teste afirma o que o ambiente pode sustentar e
 * não inventa o resto.
 *
 * Toda mutação recai sobre o contrato `[QA]` (`data_class = 'demo'`).
 */
import { test, expect, type BrowserContext, type Page, type Locator } from '@playwright/test';
import { readFileSync } from 'node:fs';
import pg from 'pg';
import dotenv from 'dotenv';
import { makeContractPdf, QA_CONTRACT_LINES } from '../scripts/fixtures/make-contract-pdf.mjs';

dotenv.config({ path: '.env' });
dotenv.config({ path: '.env.local' });

const qa = JSON.parse(readFileSync('tests/.qa-env.json', 'utf8')) as { email: string; password: string };

const CONTRACT_TITLE = '[QA] Contrato de Serviços';
const RUN = Date.now().toString(36).slice(-5);
const DOC_TITLE = `[QA] Contrato assinado ${RUN}.pdf`;

test.describe.configure({ mode: 'serial' });
test.setTimeout(300_000);

let ctx: BrowserContext;
let page: Page;
let contractId = '';
let documentId = '';
let actorUserId = '';
let organizationId = '';

const drawer = () => page.locator('.hud-drawer-surface');
const modal = () => page.locator('.hud-modal-surface');
const byLabel = (scope: Page | Locator, label: string, control: 'input' | 'select' = 'input') =>
  scope.locator(`div:has(> label:text-is("${label}")) ${control}`).first();

async function withDb<T>(fn: (q: (sql: string, params?: unknown[]) => Promise<any[]>) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    return await fn(async (sql, params) => (await client.query(sql, params)).rows);
  } finally {
    await client.end();
  }
}

/**
 * Espera a ANÁLISE chegar a um estado terminal, lendo o banco.
 *
 * Não se espera texto de tela: o painel de cláusulas já exibe frases como
 * "Nenhuma cláusula proposta" como estado vazio, e um matcher de toast casa com
 * elas no mesmo instante do clique — a leitura do banco então corre na frente
 * da escrita e o teste conclui que nada aconteceu. A rota grava a linha de
 * análise como `running` ANTES de chamar o modelo, então a própria tabela é o
 * sinal confiável de que a extração começou e de quando terminou.
 */
async function waitForAnalysis(docId: string, timeoutMs = 280_000) {
  const deadline = Date.now() + timeoutMs;
  let last: any = null;
  while (Date.now() < deadline) {
    const [row] = await withDb((q) => q(
      `select status, model, extractor_version, document_id, error_message
         from contract_ai_analyses where document_id = $1 order by created_at desc limit 1`, [docId]));
    last = row ?? last;
    if (row && ['completed', 'failed', 'superseded'].includes(row.status)) return row;
    await new Promise((r) => setTimeout(r, 3_000));
  }
  throw new Error(`análise não chegou a estado terminal em ${timeoutMs}ms (última: ${JSON.stringify(last)})`);
}

async function gotoDossier() {
  await page.goto(`/contratos/${contractId}`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('Operações conectadas').first()).toBeVisible({ timeout: 120_000 });
}

async function openDossierTab(name: string) {
  await gotoDossier();
  await page.getByRole('button', { name }).first().click();
}

/**
 * A conta da Anthropic tem crédito?
 *
 * Esta suíte é a única do repositório que depende do modelo responder de
 * verdade. Sem crédito, a rota devolve 400 com "credit balance is too low" e a
 * análise termina em `failed` — o que NÃO é um defeito do produto e não deve
 * ser reportado como um. Sem esta verificação, a suíte ficaria permanentemente
 * vermelha por um motivo externo, e uma suíte cronicamente vermelha para de ser
 * lida. Com ela, o resultado é "não verificável neste ambiente", que é a
 * verdade — e volta a rodar sozinha assim que houver crédito.
 */
async function anthropicUnavailable(): Promise<string | null> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return 'ANTHROPIC_API_KEY ausente';
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'claude-opus-5', max_tokens: 8, messages: [{ role: 'user', content: 'ping' }] }),
    });
    if (res.ok) return null;
    const body = await res.text();
    return `API indisponível (HTTP ${res.status}): ${body.slice(0, 200)}`;
  } catch (err) {
    return `API inacessível: ${err instanceof Error ? err.message : String(err)}`;
  }
}

test.beforeAll(async ({ browser }) => {
  // `test.setTimeout` no escopo do arquivo vale para os TESTES; um hook tem
  // orçamento próprio de 30s, e o login real não cabe nele nesta máquina.
  test.setTimeout(180_000);

  const unavailable = await anthropicUnavailable();
  test.skip(Boolean(unavailable), `Extração real não verificável: ${unavailable}`);
  ctx = await browser.newContext();
  page = await ctx.newPage();
  page.setDefaultTimeout(30_000);

  await page.goto('/login');
  await page.locator('input[type="email"]').fill(qa.email);
  await page.locator('input[type="password"]').fill(qa.password);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 60_000 });

  const [row] = await withDb((q) => q(
    `select id, organization_id from contracts where title = $1 and deleted_at is null limit 1`,
    [CONTRACT_TITLE]));
  expect(row, 'a fixture [QA] precisa existir (rode scripts/qa-contracts-governance-seed.mjs)').toBeTruthy();
  contractId = row.id;
  organizationId = row.organization_id;

  const [me] = await withDb((q) => q(`select user_id from profiles where full_name = 'QA Workforce Bot' limit 1`));
  actorUserId = me.user_id;
});

test.afterAll(async () => {
  test.setTimeout(120_000);
  await ctx?.close();
  if (!documentId) return;

  /*
    Sai o objeto temporário; FICA a auditoria.

    As cláusulas propostas e a análise apontam para um documento que deixa de
    existir, e por isso saem junto. As linhas de `audit_logs` permanecem: elas
    registram que uma extração aconteceu de fato, e apagá-las para deixar o
    banco arrumado seria reescrever exatamente o histórico que esta suíte
    existe para provar que funciona.
  */
  await withDb(async (q) => {
    await q(`update contract_clauses set superseded_by_clause_id = null where source_document_id = $1`, [documentId]);
    await q(`delete from contract_clauses where source_document_id = $1`, [documentId]);
    await q(`delete from contract_ai_analyses where document_id = $1`, [documentId]);
    await q(`update contract_documents set superseded_by_document_id = null, supersedes_document_id = null
              where contract_id = $1 and title like '[QA] Contrato assinado %'`, [contractId]);
    await q(`delete from contract_documents where id = $1`, [documentId]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════

test('1 · Anexar um PDF de contrato REAL pela interface', async () => {
  await gotoDossier();
  await page.getByRole('button', { name: 'Mais ações' }).first().click();
  await page.getByRole('menuitem', { name: /Anexar documento/ }).click();
  await expect(modal()).toBeVisible();

  await byLabel(modal(), 'Título do documento').fill(DOC_TITLE);
  await byLabel(modal(), 'Tipo', 'select').selectOption('contract');
  await modal().locator('input[type="file"]').setInputFiles({
    name: `qa-contrato-${RUN}.pdf`,
    mimeType: 'application/pdf',
    buffer: makeContractPdf(QA_CONTRACT_LINES),
  });
  await modal().getByRole('button', { name: /Anexar|Salvar|Registrar/ }).first().click();
  await expect(modal()).toBeHidden({ timeout: 60_000 });

  const [doc] = await withDb((q) => q(
    `select id, file_path from contract_documents where contract_id = $1 and title = $2`,
    [contractId, DOC_TITLE]));
  expect(doc, 'o documento precisa existir').toBeTruthy();
  // O arquivo tem de estar no bucket: sem objeto no storage, o extrator não lê.
  expect(doc.file_path, 'o documento precisa apontar para um objeto no bucket').toBeTruthy();
  documentId = doc.id;
});

test('2 · A extração roda pela rota real e PROPÕE cláusulas', async () => {
  await openDossierTab('Riscos & Cláusulas');

  const select = page.getByLabel('Documento a analisar');
  await expect(select).toBeVisible({ timeout: 30_000 });
  await select.selectOption({ label: DOC_TITLE });
  await page.getByRole('button', { name: 'Extrair cláusulas' }).click();

  const analysis = await waitForAnalysis(documentId);
  expect(analysis, 'a análise precisa ter deixado registro').toBeTruthy();
  expect(analysis.status, `análise falhou: ${analysis?.error_message ?? ''}`).toBe('completed');
  expect(analysis.model).toBeTruthy();
  expect(analysis.extractor_version).toBeTruthy();
  expect(analysis.document_id).toBe(documentId);

  const proposals = await withDb((q) => q(
    `select source_page, source_excerpt, review_status, ai_confidence, ai_model, ai_analysis_id
       from contract_clauses where source_document_id = $1 and ai_flagged = true`, [documentId]));
  expect(proposals.length, 'um contrato com cláusulas reais deveria produzir propostas').toBeGreaterThan(0);

  for (const p of proposals) {
    // Portão de evidência (093): sem página e trecho, o próprio banco recusa.
    expect(p.source_page).not.toBeNull();
    expect(String(p.source_excerpt).trim().length).toBeGreaterThan(19);
    // Proposta NÃO é cláusula contratual: nasce aguardando revisão humana.
    expect(p.review_status).toBe('draft');
    // Proveniência em COLUNAS, não dentro de jsonb.
    expect(p.ai_model).toBeTruthy();
    expect(p.ai_analysis_id).toBeTruthy();
    expect(Number(p.ai_confidence)).toBeGreaterThan(0);
    expect(Number(p.ai_confidence)).toBeLessThanOrEqual(1);
  }
});

test('3 · A auditoria contract.clauses_extracted foi escrita, e é completa', async () => {
  const [row] = await withDb((q) => q(
    `select action, actor_user_id, organization_id, entity_type, entity_id,
            ip_address, user_agent, metadata, created_at
       from audit_logs
      where action = 'contract.clauses_extracted' and entity_id = $1
      order by created_at desc limit 1`, [contractId]));

  expect(row, 'a extração bem-sucedida precisa estar auditada').toBeTruthy();
  expect(row.actor_user_id).toBe(actorUserId);
  expect(row.organization_id).toBe(organizationId);
  expect(row.entity_type).toBe('contract');
  expect(row.entity_id).toBe(contractId);
  expect(row.metadata.document_id).toBe(documentId);
  expect(row.metadata.model).toBeTruthy();
  expect(row.metadata.version).toBeTruthy();
  expect(Number(row.metadata.proposed)).toBeGreaterThan(0);

  /*
    `user_agent` vem do cabeçalho da requisição e existe em qualquer ambiente:
    é o navegador que o envia. `ip_address` depende de PROXY — `x-forwarded-for`
    ou `x-real-ip`. Num servidor local não há proxy nenhum, e o valor honesto é
    nulo. Nada é fabricado para fazer a asserção passar; o teste afirma o que o
    ambiente sustenta e reporta o resto.
  */
  expect(row.user_agent, 'o user-agent vem do cabeçalho e deve estar sempre presente').toBeTruthy();

  const viaProxy = /vercel\.app|https:\/\//.test(process.env.PLAYWRIGHT_BASE_URL ?? '');
  console.log(`[auditoria] user_agent=${String(row.user_agent).slice(0, 60)}… ip_address=${row.ip_address ?? 'null'}`);
  if (viaProxy) {
    expect(row.ip_address, 'atrás de proxy, o IP encaminhado precisa ser registrado').toBeTruthy();
  }
});

test('4 · Reanálise do mesmo documento não duplica proposta idêntica', async () => {
  const before = await withDb((q) => q(
    `select count(*)::int n from contract_clauses where source_document_id = $1 and ai_flagged = true`,
    [documentId]));

  await openDossierTab('Riscos & Cláusulas');
  const select = page.getByLabel('Documento a analisar');
  await expect(select).toBeVisible({ timeout: 30_000 });
  await select.selectOption({ label: DOC_TITLE });
  await page.getByRole('button', { name: /Extrair cláusulas|Reanalisar/ }).first().click();
  await waitForAnalysis(documentId);

  const after = await withDb((q) => q(
    `select count(*)::int n from contract_clauses where source_document_id = $1 and ai_flagged = true`,
    [documentId]));

  /*
    O índice único de fingerprint (094) cobre
    (contrato, documento, página, md5(trecho)) — reler o MESMO documento não
    pode multiplicar a fila de revisão. Pode haver alguma proposta a mais se o
    modelo citar um trecho diferente, mas nunca o dobro.
  */
  expect(after[0].n).toBeLessThan(before[0].n * 2);
  expect(after[0].n).toBeGreaterThanOrEqual(before[0].n);

  // E a análise anterior daquele documento fica marcada como superada.
  const analyses = await withDb((q) => q(
    `select status from contract_ai_analyses where document_id = $1 order by created_at`, [documentId]));
  expect(analyses.length).toBeGreaterThanOrEqual(2);
  expect(analyses.filter((a) => a.status === 'superseded').length).toBeGreaterThan(0);
});
