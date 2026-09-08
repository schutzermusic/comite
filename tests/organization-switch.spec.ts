import { expect, test } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config({ path: '.env' });
dotenv.config({ path: '.env.local' });

const QA_PATH = 'tests/.qa-env.json';
const ready = existsSync(QA_PATH) && !!process.env.SUPABASE_DB_URL;
const qa = existsSync(QA_PATH)
  ? JSON.parse(readFileSync(QA_PATH, 'utf8')) as { email: string; password: string }
  : null;

const FIXTURE_SLUG = 'qa-phase75-organization-switch';
const FIXTURE_NAME = '[QA P75] Organization Switch';

test.skip(!ready, 'requer tests/.qa-env.json + SUPABASE_DB_URL');
test.describe.configure({ mode: 'serial' });
test.setTimeout(120_000);

const db = new pg.Client({
  connectionString: process.env.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false },
});

let userId = '';
let homeOrgId = '';
let homeOrgName = '';
let fixtureOrgId = '';

test.beforeAll(async () => {
  if (!ready) return;
  await db.connect();
  const user = await db.query(
    `SELECT u.id, p.organization_id, o.name, o.enterprise_account_id
       FROM auth.users u
       JOIN profiles p ON p.user_id=u.id
       JOIN organizations o ON o.id=p.organization_id
      WHERE u.email=$1`, [qa!.email],
  );
  expect(user.rowCount).toBe(1);
  userId = user.rows[0].id;
  homeOrgId = user.rows[0].organization_id;
  homeOrgName = user.rows[0].name;

  const existing = await db.query(`SELECT id FROM organizations WHERE slug=$1`, [FIXTURE_SLUG]);
  if (existing.rowCount) {
    fixtureOrgId = existing.rows[0].id;
    await db.query(
      `UPDATE organizations
          SET status='active', suspended_at=NULL, archived_at=NULL
        WHERE id=$1`, [fixtureOrgId],
    );
  } else {
    const created = await db.query(
      `INSERT INTO organizations(name,slug,enterprise_account_id)
       VALUES($1,$2,$3) RETURNING id`,
      [FIXTURE_NAME, FIXTURE_SLUG, user.rows[0].enterprise_account_id],
    );
    fixtureOrgId = created.rows[0].id;
  }

  await db.query(
    `INSERT INTO organization_memberships
       (organization_id,user_id,status,source,joined_at,disabled_at)
     VALUES($1,$2,'ACTIVE','BACKFILL',now(),NULL)
     ON CONFLICT(organization_id,user_id) DO UPDATE
       SET status='ACTIVE',disabled_at=NULL,disabled_by=NULL,updated_at=now()`,
    [fixtureOrgId, userId],
  );
  await db.query(
    `INSERT INTO user_roles(user_id,role_id,organization_id)
     SELECT $1,r.id,$2 FROM roles r
      WHERE r.organization_id IS NULL AND r.key='owner_admin'
     ON CONFLICT DO NOTHING`, [userId, fixtureOrgId],
  );
  await db.query(`DELETE FROM user_active_organization WHERE user_id=$1`, [userId]);
});

test.afterAll(async () => {
  if (!ready || !fixtureOrgId) return;
  try {
    await db.query(`DELETE FROM user_active_organization WHERE user_id=$1`, [userId]);
    await db.query(`DELETE FROM user_roles WHERE user_id=$1 AND organization_id=$2`, [userId, fixtureOrgId]);
    await db.query(`DELETE FROM organization_memberships WHERE user_id=$1 AND organization_id=$2`, [userId, fixtureOrgId]);
    await db.query(
      `UPDATE organizations
          SET status='archived', suspended_at=NULL, archived_at=COALESCE(archived_at,now())
        WHERE id=$1`, [fixtureOrgId],
    );
  } finally {
    await db.end();
  }
});

test('perda da organização ativa exige seleção e descarta o contexto do navegador', async ({ page }) => {
  await page.goto('/login');
  await page.locator('input[type="email"]').fill(qa!.email);
  await page.locator('input[type="password"]').fill(qa!.password);
  await page.locator('input[type="password"]').press('Enter');
  await page.waitForURL(/\/configuracoes\/organizacoes/, { timeout: 60_000 });

  await expect(page.getByTestId('access-state')).toContainText('Selecione explicitamente', { timeout: 60_000 });
  const fixtureRow = page.locator(`[data-organization-id="${fixtureOrgId}"]`);
  await fixtureRow.getByRole('button', { name: 'Entrar' }).click();
  await page.waitForLoadState('domcontentloaded');
  await expect(page.getByTestId('active-organization-name')).toHaveText(FIXTURE_NAME, { timeout: 60_000 });

  await db.query(
    `UPDATE organization_memberships
        SET status='SUSPENDED',disabled_at=now(),updated_at=now()
      WHERE organization_id=$1 AND user_id=$2`, [fixtureOrgId, userId],
  );
  await page.reload();
  await expect(page.getByTestId('active-organization-name')).toHaveText('Sem organização', { timeout: 60_000 });
  await expect(page.getByTestId('access-state')).toContainText('Selecione explicitamente', { timeout: 60_000 });

  const homeRow = page.locator(`[data-organization-id="${homeOrgId}"]`);
  await homeRow.getByRole('button', { name: 'Entrar' }).click();
  await page.waitForLoadState('domcontentloaded');
  await expect(page.getByTestId('active-organization-name')).toHaveText(homeOrgName, { timeout: 60_000 });

  const stored = await db.query(
    `SELECT organization_id FROM user_active_organization WHERE user_id=$1`, [userId],
  );
  expect(stored.rows[0]?.organization_id).toBe(homeOrgId);
});
