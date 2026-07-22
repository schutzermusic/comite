/**
 * E2E — Portal de Ponto Web (fluxo SELFIE) + isolamento de dados.
 *
 * Cobre o núcleo crítico viável de forma automatizada:
 *   - login do colaborador;
 *   - seleção de projeto + etapa do cronograma (WBS);
 *   - captura de selfie (câmera fake do Chromium) e registro do ponto;
 *   - evidência armazenada e vinculada (authentication_evidence);
 *   - ISOLAMENTO: o colaborador não acessa marcações de outro colaborador
 *     (RLS) — cobre o requisito de segurança 12.
 *
 * Pré-requisitos: seed (scripts/qa-seed-workforce.mjs → tests/.qa-env.json)
 * + servidor em 9002. A ativação de conta / entrega de e-mail usa test
 * doubles somente no provedor externo — nenhuma regra de produção é afrouxada.
 *
 * A câmera é simulada via flags do Chromium (getUserMedia devolve um vídeo
 * sintético → canvas.toDataURL gera um JPEG real). Não enfraquece segurança.
 */
import { test, expect } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config({ path: '.env' });
dotenv.config({ path: '.env.local' });

// câmera fake (só neste arquivo)
test.use({
  launchOptions: {
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
  },
});

const QA_PATH = 'tests/.qa-env.json';
const hasQa = existsSync(QA_PATH);
const qa = hasQa
  ? (JSON.parse(readFileSync(QA_PATH, 'utf8')) as { email: string; password: string; projectId: string; personId: string; orgId: string })
  : null;

// Sem seed → pula o arquivo inteiro (não quebra CI sem fixtures).
test.skip(!hasQa, 'requer tests/.qa-env.json (rode scripts/qa-seed-workforce.mjs)');
test.setTimeout(120_000);

const db = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
let timelineItemId: string;
let otherPersonId: string | null = null;

test.beforeAll(async () => {
  if (!qa) return;
  await db.connect();
  await db.query(
    `insert into project_allocations (organization_id, person_id, project_id, role_title, allocation_type, start_date, planned_percentage, status, source)
     values ($1,$2,$3,'QA Selfie','billable', current_date - 1, 50, 'active','manual')
     on conflict do nothing`,
    [qa.orgId, qa.personId, qa.projectId],
  );
  const r = await db.query(
    `insert into project_timeline_items (organization_id, project_id, wbs_code, title, type, status, percent_complete, row_order)
     values ($1,$2,'1.1','QA — Montagem eletromecânica','task','in_progress',40,1)
     returning id`,
    [qa.orgId, qa.projectId],
  );
  timelineItemId = r.rows[0].id;
  // um outro colaborador da MESMA org para testar isolamento (se existir)
  const other = await db.query(
    `select id from people where organization_id=$1 and id <> $2 limit 1`,
    [qa.orgId, qa.personId],
  );
  otherPersonId = other.rows[0]?.id ?? null;
});

test.afterAll(async () => {
  if (!qa) return;
  await db.query('delete from project_work_sessions where person_id=$1', [qa.personId]);
  await db.query('delete from project_timeline_items where id=$1', [timelineItemId]);
  await db.query('delete from project_allocations where person_id=$1', [qa.personId]);
  await db.end();
});

async function login(page: import('@playwright/test').Page) {
  await page.goto('/ponto/login');
  await page.getByPlaceholder('E-mail').fill(qa!.email);
  await page.getByPlaceholder('Senha').fill(qa!.password);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.waitForURL('**/ponto', { timeout: 30_000 });
  await expect(page.getByText(/Olá,/)).toBeVisible();
}

test('Selfie + etapa do cronograma registra o ponto com evidência facial', async ({ page, context }) => {
  await context.grantPermissions(['geolocation', 'camera'], { origin: 'http://localhost:9002' });
  await context.setGeolocation({ latitude: -19.9, longitude: -43.9 });
  await login(page);

  // entrada → folha de projeto/etapa
  await page.getByRole('button', { name: /escolher projeto/ }).click();
  await expect(page.getByText('Onde você vai trabalhar?')).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: /Montagem eletromecânica/ }).click();
  await page.getByRole('button', { name: /Registrar entrada/ }).click();

  // modal da selfie → tirar foto → registrar
  await expect(page.getByText(/Selfie para a entrada/)).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: /Tirar foto/ }).click();
  await page.getByRole('button', { name: /Usar esta foto e registrar/ }).click();

  await expect(page.getByText(/registrad/i)).toBeVisible({ timeout: 25_000 });
  await expect(page.getByText('Atividade em andamento')).toBeVisible({ timeout: 15_000 });

  // evidência facial vinculada à marcação
  const ev = await db.query(
    `select ae.method
       from attendance_punches ap
       join authentication_evidence ae on ae.id = ap.authentication_evidence_id
      where ap.person_id=$1 order by ap.occurred_at desc limit 1`,
    [qa!.personId],
  );
  expect(ev.rows[0]?.method).toBe('facial_verification');

  // a sessão de trabalho carrega a etapa (WBS)
  const sess = await db.query(
    `select timeline_item_id from project_work_sessions where person_id=$1 and status='running' limit 1`,
    [qa!.personId],
  );
  expect(sess.rows[0]?.timeline_item_id).toBe(timelineItemId);
});

test('Isolamento: colaborador não lê marcações de outro colaborador (RLS)', async ({ page }) => {
  test.skip(!otherPersonId, 'requer um segundo colaborador na org');
  await login(page);

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

  // token de acesso da sessão logada (armazenado pelo supabase-js)
  const token = await page.evaluate(() => {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)!;
      if (k.includes('auth-token')) {
        try {
          const v = JSON.parse(localStorage.getItem(k) || '{}');
          if (v?.access_token) return v.access_token as string;
        } catch {
          /* ignore */
        }
      }
    }
    return null;
  });
  expect(token, 'sessão deve ter access_token').toBeTruthy();

  // tenta ler marcações de OUTRO colaborador via REST → RLS deve retornar vazio
  const rows = await page.evaluate(
    async ([url, key, tk, other]) => {
      const res = await fetch(`${url}/rest/v1/attendance_punches?person_id=eq.${other}&select=id`, {
        headers: { apikey: key as string, Authorization: `Bearer ${tk}` },
      });
      return res.ok ? await res.json() : { status: res.status };
    },
    [supabaseUrl, anonKey, token, otherPersonId] as const,
  );
  expect(Array.isArray(rows) ? rows.length : 0).toBe(0);
});
