/**
 * O PORTÃO DA OS, NO NAVEGADOR, COM ESCRITA REAL (QA isolado).
 *
 * Os caminhos de governança da OS interna que o caminho de ouro não
 * atravessa, cada um pelo papel que tem a alçada — nenhuma escrita
 * interceptada:
 *
 *   gestor    importa uma OS já emitida em PDF: o arquivo vai ao Storage do
 *             inquilino, o SERVIDOR calcula a impressão digital e a OS nasce
 *             em rascunho com o documento vinculado;
 *   jurídico  decide uma divergência BLOQUEANTE dizendo qual fonte prevalece,
 *             com justificativa — não existe "ignorar";
 *   titular   emite uma OS com bloqueante em aberto SOB EXCEÇÃO nomeada: a
 *             exceção vai ao livro com a pessoa, a permissão e o motivo, e a
 *             divergência continua registrada.
 *
 * Depois de cada ato, o estado PERSISTIDO é conferido no banco.
 */
import { createHash } from 'node:crypto';
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import type pg from 'pg';
import { acceptedPackage, baseFacts } from '../../scripts/qa/lib/commercial.mjs';
import { authFile, governed, one, qaDb, qaLive, tag, type QaRole } from './support';

test.describe.configure({ mode: 'serial' });
test.setTimeout(180_000);

const T = tag();
let db: pg.Client;
const S = {} as { importCustomer: string; decideOs: string; decideDivergence: string; exceptionOs: string; exceptionDivergence: string };
const sessions = new Map<QaRole, { ctx: BrowserContext; page: Page }>();

async function as(browser: Browser, role: QaRole): Promise<Page> {
  const open = sessions.get(role);
  if (open) return open.page;
  const ctx = await browser.newContext({ storageState: authFile(role), viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  page.setDefaultTimeout(45_000);
  page.on('pageerror', (e) => { throw new Error(`[${role}] erro de runtime: ${e.message}`); });
  sessions.set(role, { ctx, page });
  return page;
}

/** Um PDF de verdade (assinatura %PDF, catálogo, uma página) — o servidor confere a assinatura do conteúdo. */
const PDF = Buffer.from(`%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n`
  + `3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]>>endobj\n% OS importada ${T}\ntrailer<</Root 1 0 R>>\n%%EOF\n`);

test.beforeAll(async () => {
  db = await qaDb();
  const live = qaLive();
  const g = await governed(db);
  const q = (sql: string, params: unknown[]) => one(db, sql, params);
  const pkg = (code: string, customer: string) => acceptedPackage(q, { org: g.org, owner: g.actor }, {
    code, title: `Retrofit ${code}`, customer, value: 640_000,
    facts: baseFacts('Retrofit de painéis de média tensão', 'Relatório de ensaios', 'Cliente libera a subestação', { label: 'Painel MT', qty: 4, unit: 'un' }),
  });
  // O trabalho autorizado de onde a OS importada nasce.
  S.importCustomer = `Cliente Import ${T}`;
  await pkg(`GI-${T}`, S.importCustomer);
  // Duas OS geradas, revisadas, cada uma com uma divergência BLOQUEANTE apontada por pessoa.
  const withBlocking = async (code: string) => {
    const p = await pkg(code, `Cliente ${code}`);
    const os = await g.act<{ service_order_id: string }>('internal_service_order_generate_from_package', g.org, live.users.gestor.id, p.acceptanceId,
      g.J({ os_number: `OS-${code}` }));
    const items = (await db.query(`SELECT id FROM public.internal_service_order_items WHERE service_order_id = $1`, [os.service_order_id])).rows;
    await g.act('internal_service_order_items_decide', g.org, live.users.gestor.id, os.service_order_id,
      g.J(items.map((i) => ({ item_id: i.id, decision: 'CONFIRMED' }))));
    await g.act('internal_service_order_record_divergence', g.org, live.users.gestor.id, os.service_order_id, g.J({
      scope: 'DATES', field_path: 'planned_finish', severity: 'BLOCKING', detected_by: 'human',
      left_value: '120 dias corridos (PT, p. 14)', right_value: '90 dias corridos (OS)', summary: `Prazo da OS menor que o da PT aceita (${code})` }));
    const d = await one<{ id: string }>(db, `SELECT id FROM public.commercial_divergences WHERE service_order_id = $1 AND severity = 'BLOCKING'`,
      [os.service_order_id]);
    return { os: os.service_order_id, divergence: d.id };
  };
  const a = await withBlocking(`GD-${T}`); S.decideOs = a.os; S.decideDivergence = a.divergence;
  const b = await withBlocking(`GE-${T}`); S.exceptionOs = b.os; S.exceptionDivergence = b.divergence;
});

test.afterAll(async () => {
  for (const { ctx } of sessions.values()) await ctx.close().catch(() => undefined);
  await db?.end();
});

test('1 · gestor importa a OS em PDF: Storage do inquilino, impressão digital calculada no servidor, OS em rascunho', async ({ browser }) => {
  const page = await as(browser, 'gestor');
  await page.goto('/operacoes/ordens-servico');
  await page.getByRole('button', { name: /^Importar OS/ }).click();
  const panel = page.getByTestId('import-os-modal');
  const target = panel.getByLabel('Trabalho autorizado');
  await expect(target.locator('option', { hasText: S.importCustomer })).toHaveCount(1, { timeout: 30_000 });
  const value = await target.locator('option', { hasText: S.importCustomer }).getAttribute('value');
  await target.selectOption(value!);
  await panel.getByLabel('Número da OS (opcional)').fill(`OS-IMP-${T}`);
  await panel.getByLabel('PDF da OS').setInputFiles({ name: `OS-IMP-${T}.pdf`, mimeType: 'application/pdf', buffer: PDF });
  await panel.getByRole('button', { name: 'Importar' }).click();
  await page.waitForURL(/\/operacoes\/ordens-servico\/[0-9a-f-]{36}/, { timeout: 90_000 });

  const os = await one<{ id: string; origin: string; status: string; document_id: string }>(db,
    `SELECT id, origin, status, document_id FROM public.internal_service_orders WHERE os_number = $1`, [`OS-IMP-${T}`]);
  expect(os).toMatchObject({ origin: 'uploaded_document', status: 'DRAFT' });
  expect(page.url()).toContain(os.id);
  const doc = await one<{ file_path: string; sha: string; uploaded_by: string; type: string }>(db,
    `SELECT file_path, content_sha256 sha, uploaded_by, document_type type FROM public.contract_documents WHERE id = $1`, [os.document_id]);
  // A impressão digital é a do CONTEÚDO que chegou ao Storage — calculada pelo servidor sobre os bytes.
  expect(doc.sha).toBe(createHash('sha256').update(PDF).digest('hex'));
  expect(doc).toMatchObject({ uploaded_by: qaLive().users.gestor.id, type: 'internal_service_order' });
  expect(doc.file_path.startsWith(`${qaLive().organization.id}/`)).toBe(true);
  expect((await one<{ n: number }>(db, `SELECT count(*)::int n FROM storage.objects WHERE bucket_id = 'contract-files' AND name = $1`,
    [doc.file_path])).n).toBe(1);
  await expect(page.getByTestId('os-workspace').getByRole('tab', { name: /^Documentos/ })).toBeVisible();
});

test('2 · jurídico decide a bloqueante: qual fonte prevalece, com justificativa — e o portão abre', async ({ browser }) => {
  const page = await as(browser, 'juridico');
  await page.goto(`/operacoes/ordens-servico/${S.decideOs}?tab=divergencias`);
  const card = page.getByTestId('os-divergence').filter({ hasText: 'Bloqueante' }).first();
  await card.getByRole('button', { name: 'Decidir' }).click();
  const form = page.getByTestId('divergence-resolve-form');
  await form.getByRole('radiogroup', { name: 'Fonte que prevalece' }).getByText('Proposta aceita (PT/PC)').click();
  await form.getByLabel('Justificativa').fill('Ata de 22/09 com o cliente: vale o prazo da PT aceita, 120 dias corridos.');
  await form.getByRole('button', { name: 'Registrar decisão' }).click();
  await expect.poll(async () => (await one<{ state: string }>(db, `SELECT state FROM public.commercial_divergences WHERE id = $1`,
    [S.decideDivergence])).state, { timeout: 30_000 }).toBe('RESOLVED');
  const d = await one(db, `SELECT resolved_source_kind, resolved_by, resolution_note FROM public.commercial_divergences WHERE id = $1`, [S.decideDivergence]);
  expect(d).toEqual({ resolved_source_kind: 'accepted_proposal', resolved_by: qaLive().users.juridico.id,
    resolution_note: 'Ata de 22/09 com o cliente: vale o prazo da PT aceita, 120 dias corridos.' });
  // Sem bloqueante em aberto, o portão de emissão deixa de citar a divergência.
  await page.getByTestId('os-workspace').getByRole('tab', { name: /^Resumo/ }).click();
  await expect(page.getByText('0 bloqueante(s) em aberto').or(page.getByText('Sem divergência bloqueante'))).toBeVisible();
});

test('3 · titular emite sob exceção nomeada: a exceção vai ao livro e a divergência continua registrada', async ({ browser }) => {
  const page = await as(browser, 'owner');
  await page.goto(`/operacoes/ordens-servico/${S.exceptionOs}`);
  const ws = page.getByTestId('os-workspace');
  // A emissão normal está travada pela bloqueante; a exceção é um ato separado, com motivo.
  await expect(ws.getByRole('button', { name: 'Emitir OS' }).first()).toBeDisabled();
  await ws.getByRole('button', { name: /Emitir sob exceção/ }).click();
  const form = page.getByTestId('os-exception-form');
  await form.getByLabel(/Motivo/).fill('Cliente autorizou o início por e-mail de 23/09 enquanto o aditivo de prazo é assinado.');
  await form.getByRole('button', { name: 'Emitir sob exceção' }).click();
  await expect.poll(async () => (await one<{ status: string }>(db, `SELECT status FROM public.internal_service_orders WHERE id = $1`,
    [S.exceptionOs])).status, { timeout: 30_000 }).toBe('ISSUED');
  const ex = await one<{ authorized_by: string; permission: string; reason: string; ids: string[] }>(db,
    `SELECT authorized_by, authorized_permission permission, reason, divergence_ids::text[] ids
       FROM public.internal_service_order_issue_exceptions WHERE service_order_id = $1`, [S.exceptionOs]);
  expect(ex).toMatchObject({ authorized_by: qaLive().users.owner.id, permission: 'operations.service_orders.override',
    reason: 'Cliente autorizou o início por e-mail de 23/09 enquanto o aditivo de prazo é assinado.' });
  expect(ex.ids).toContain(S.exceptionDivergence);
  // A exceção não apaga a pergunta: a divergência segue aberta, para ser decidida.
  expect(await one(db, `SELECT state FROM public.commercial_divergences WHERE id = $1`, [S.exceptionDivergence])).toEqual({ state: 'OPEN' });
});
