/**
 * Antes de qualquer prova viva:
 *  1. o GUARDA: app, API e banco têm de ser desta máquina (QA isolado);
 *  2. o QA tem de estar na ponta certa (253) e semeado;
 *  3. cada papel entra pela TELA REAL de login uma vez, e a sessão (cookies)
 *     fica salva para as provas de UI e de API daquele papel.
 */
import fs from 'node:fs';
import { chromium, type FullConfig } from '@playwright/test';
import { APP_URL, AUTH_DIR, authFile, qaDb, qaLive, signIn, type QaRole } from './support';

export default async function globalSetup(config: FullConfig) {
  const baseURL = String(config.projects[0]?.use?.baseURL ?? APP_URL);
  if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(baseURL)) {
    throw new Error(`[QA GUARD] baseURL ${baseURL} não é local — provas vivas só no QA isolado.`);
  }
  const live = qaLive();
  const db = await qaDb();
  try {
    const tip = (await db.query(`SELECT max(version::int) v FROM supabase_migrations.schema_migrations WHERE version ~ '^[0-9]+$'`)).rows[0].v;
    if (Number(tip) < 253) throw new Error(`QA na ponta ${tip}: aplique até a 253 (npm run qa:build).`);
    const roles = (await db.query(`SELECT count(*)::int n FROM public.user_roles WHERE organization_id = $1`, [live.organization.id])).rows[0].n;
    if (roles < 8) throw new Error('QA sem os usuários por papel — rode `node scripts/qa/seed.mjs`.');
  } finally {
    await db.end();
  }

  fs.mkdirSync(AUTH_DIR, { recursive: true });
  const browser = await chromium.launch();
  try {
    for (const role of Object.keys(live.users) as QaRole[]) {
      const context = await browser.newContext({ baseURL, reducedMotion: 'reduce' });
      const page = await context.newPage();
      await signIn(page, role);
      await context.storageState({ path: authFile(role) });
      await context.close();
    }
  } finally {
    await browser.close();
  }
}
