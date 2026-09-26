/**
 * Apoio das provas vivas no QA ISOLADO.
 *
 * Tudo aqui passa pelo guarda de `scripts/qa/lib/qa-env.mjs`: banco, API e app
 * só podem ser endereços desta máquina. Nada escreve no inquilino real.
 */
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { request as playwrightRequest, type APIRequestContext, type Page } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { assertLocal, loadQaEnv, QA_LIVE_FILE } from '../../scripts/qa/lib/qa-env.mjs';

export type QaRole = 'owner' | 'gestor' | 'engenharia' | 'compras' | 'almoxarifado' | 'financeiro' | 'juridico' | 'rh' | 'outsider';

export interface QaLive {
  password: string;
  organization: { id: string; name: string };
  outsiderOrganization: { id: string; name: string };
  users: Record<QaRole, { id: string; email: string; name: string; role: string; organizationId: string }>;
  locations: { central: string; norte: string; quarentena: string };
  suppliers: { a: string; b: string };
}

export const APP_URL = assertLocal(process.env.QA_APP_URL ?? 'http://localhost:9102', 'QA_APP_URL');
export const AUTH_DIR = path.resolve('tests/qa-live/.auth');
export const authFile = (role: QaRole) => path.join(AUTH_DIR, `${role}.json`);

export function qaLive(): QaLive {
  if (!fs.existsSync(QA_LIVE_FILE)) throw new Error('tests/.qa-live.json ausente — rode `npm run qa:build`.');
  return JSON.parse(fs.readFileSync(QA_LIVE_FILE, 'utf8')) as QaLive;
}

export const qaEnv = () => loadQaEnv() as Record<string, string>;

/** Cliente pg no banco do QA (guardado). */
export async function qaDb(): Promise<pg.Client> {
  const c = new pg.Client({ connectionString: assertLocal(qaEnv().QA_DB_URL, 'QA_DB_URL') });
  await c.connect();
  return c;
}

export async function one<T = Record<string, unknown>>(db: pg.Client, sql: string, params: unknown[] = []): Promise<T> {
  return (await db.query(sql, params)).rows[0] as T;
}

/** Contexto de API com a SESSÃO REAL do papel (cookies do login pela tela). */
export async function apiAs(role: QaRole): Promise<APIRequestContext> {
  return playwrightRequest.newContext({ baseURL: APP_URL, storageState: authFile(role) });
}

/** Cliente Supabase do NAVEGADOR (anon + JWT do usuário) — a RLS real, sem o servidor no meio. */
export async function browserClientAs(role: QaRole): Promise<SupabaseClient> {
  const env = qaEnv(); const live = qaLive();
  const sb = createClient(assertLocal(env.QA_API_URL, 'QA_API_URL'), env.QA_ANON_KEY, { auth: { persistSession: false } });
  const { error } = await sb.auth.signInWithPassword({ email: live.users[role].email, password: live.password });
  if (error) throw new Error(`login ${role}: ${error.message}`);
  return sb;
}

/** Entra pela tela real de login (Enter no campo de senha: a tela anima). */
export async function signIn(page: Page, role: QaRole) {
  const live = qaLive();
  await page.goto('/login');
  await page.locator('input[type="email"]').fill(live.users[role].email);
  const pw = page.locator('input[type="password"]');
  await pw.fill(live.password);
  await pw.press('Enter');
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 });
}

export const tag = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`.toUpperCase();

/**
 * Sobreposição FORÇADA: segura uma trava num terceiro cliente, dispara as
 * chamadas (que ficam presas na mesma trava dentro das próprias transações),
 * espera o banco mostrar ≥ `waiters` sessões aguardando, e só então solta.
 * Sem isso, "concorrência" em teste costuma ser só execução em sequência.
 */
export async function forcedOverlap<T>(lockSql: string, lockParams: unknown[], fire: () => Promise<T>[], waiters = 2): Promise<T[]> {
  const blocker = await qaDb();
  try {
    await blocker.query('BEGIN');
    await blocker.query(lockSql, lockParams);
    const pending = fire();
    const deadline = Date.now() + 20_000;
    for (;;) {
      // Dentro da transação, pg_stat_activity fica congelado na primeira leitura: sem limpar, um pedido
      // que ainda não tinha chegado ao banco nunca apareceria esperando.
      await blocker.query('SELECT pg_stat_clear_snapshot()');
      const { rows } = await blocker.query(`SELECT count(*)::int n FROM pg_stat_activity
        WHERE datname = current_database() AND wait_event_type = 'Lock' AND pid <> pg_backend_pid()`);
      if (rows[0].n >= waiters) break;
      if (Date.now() > deadline) throw new Error(`sobreposição não aconteceu: ${rows[0].n}/${waiters} sessões aguardando a trava`);
      await new Promise((r) => setTimeout(r, 100));
    }
    await blocker.query('COMMIT');
    return await Promise.all(pending);
  } finally {
    await blocker.query('ROLLBACK').catch(() => undefined);
    await blocker.end();
  }
}

/**
 * Ordem FORÇADA: segura uma trava de linha num terceiro cliente e dispara as
 * chamadas UMA A UMA — a seguinte só sai quando a anterior já está na fila da
 * trava (presa atrás do bloqueador ou de quem chegou antes dela). Solta com
 * todas na fila: o PostgreSQL atende a fila de uma linha na ordem de chegada,
 * então a corrida roda na ordem PEDIDA, não na que a rede sortear.
 */
export async function forcedOrder<T>(lockSql: string, lockParams: unknown[], fire: Array<() => Promise<T>>): Promise<T[]> {
  const blocker = await qaDb();
  try {
    await blocker.query('BEGIN');
    await blocker.query(lockSql, lockParams);
    // a fila: o bloqueador e, na ordem, cada chamada já presa atrás dele
    const queue: number[] = [(await blocker.query('SELECT pg_backend_pid() AS pid')).rows[0].pid];
    const pending: Promise<T>[] = [];
    for (const call of fire) {
      pending.push(call());
      const deadline = Date.now() + 20_000;
      for (;;) {
        // Dentro da transação o pg_stat_activity é um retrato tirado na 1ª leitura: sem limpá-lo, uma conexão
        // aberta depois (o pool da API cresce) nunca aparece.
        await blocker.query('SELECT pg_stat_clear_snapshot()');
        // quem espera por alguém da fila e ainda não está nela: é a chamada que acabou de sair
        const { rows } = await blocker.query(`SELECT pid FROM pg_stat_activity
          WHERE datname = current_database() AND wait_event_type = 'Lock' AND NOT (pid = ANY ($1::int[]))
            AND pg_blocking_pids(pid) && $1::int[]`, [queue]);
        if (rows.length > 1) throw new Error(`ordem não garantida: ${rows.length} sessões entraram juntas na fila da trava`);
        if (rows.length === 1) { queue.push(rows[0].pid); break; }
        if (Date.now() > deadline) throw new Error(`ordem não aconteceu: a chamada ${queue.length} não chegou à trava`);
        await new Promise((r) => setTimeout(r, 100));
      }
    }
    await blocker.query('COMMIT');
    return await Promise.all(pending);
  } finally {
    await blocker.query('ROLLBACK').catch(() => undefined);
    await blocker.end();
  }
}

/** Cenário por funções governadas (mesmo caminho da aplicação), com o titular como ator. */
export async function governed(db: pg.Client) {
  const live = qaLive();
  const org = live.organization.id; const actor = live.users.owner.id;
  const act = async <T = Record<string, unknown>>(fn: string, ...args: unknown[]): Promise<T> =>
    (await db.query(`SELECT public.${fn}(${args.map((_, i) => `$${i + 1}`).join(',')}) r`, args)).rows[0].r as T;
  const J = (x: unknown) => JSON.stringify(x);
  return {
    org, actor, act, J,
    async item(code: string, unit = 'm', category = 'Cabos') {
      return (await act<{ item_id: string }>('supply_item_upsert', org, actor, J({ code, description: `Item ${code}`, unit, category }))).item_id;
    },
    async location(code: string, kind: 'WAREHOUSE' | 'PROJECT_SITE' | 'QUARANTINE', extra: Record<string, unknown> = {}) {
      return (await act<{ location_id: string }>('inventory_location_upsert', org, actor, J({ code, name: code, kind, ...extra }))).location_id;
    },
    async stock(itemId: string, locationId: string, quantity: number) {
      return act('inventory_adjust', org, actor, J({ item_id: itemId, location_id: locationId, quantity, reason: 'Saldo de prova (QA isolado)' }));
    },
    async project(code: string) {
      const id = `qa-${code.toLowerCase()}`;
      await db.query(`INSERT INTO public.projects (id, organization_id, project, created_by) VALUES ($1,$2,$3,$4)`,
        [id, org, J({ id, nome: `Obra QA ${code}`, cliente: 'Cliente QA', status: 'em_andamento' }), actor]);
      return id;
    },
    async material(projectId: string, itemId: string, quantity: number, requiredBy = '2026-12-15') {
      const r = await act<{ requirement_id: string }>('project_requirement_upsert', org, actor, J({ project_id: projectId,
        requirement_type: 'MATERIAL', title: `Material ${quantity}`, quantity, item_id: itemId, required_by: requiredBy }));
      await act('project_requirement_transition', org, actor, r.requirement_id, 'CONFIRMED', null, null);
      return r.requirement_id;
    },
  };
}
