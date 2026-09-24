/**
 * Acesso ao banco e ao Auth do QA ISOLADO. Toda conexão passa pelo guarda:
 * nada aqui alcança o banco hospedado.
 */
import pg from 'pg';
import { loadQaEnv, assertLocal } from './qa-env.mjs';

export function qaClient(env = loadQaEnv()) {
  return new pg.Client({ connectionString: assertLocal(env.QA_DB_URL, 'QA_DB_URL') });
}

export async function withQaDb(fn) {
  const env = loadQaEnv();
  const c = qaClient(env);
  await c.connect();
  try { return await fn(c, env); } finally { await c.end(); }
}

/** Helpers no formato do `proof-kit` (one/all), sobre um cliente conectado. */
export function kit(c) {
  return {
    one: async (sql, params = []) => (await c.query(sql, params)).rows[0],
    all: async (sql, params = []) => (await c.query(sql, params)).rows,
  };
}

/**
 * Executa `sql` como o usuário `uid` pela RLS real (papel `authenticated` +
 * claims do JWT), dentro de uma transação que TERMINA — nunca estado de sessão
 * vazando para a próxima consulta.
 */
export async function asUser(c, uid, sql, params = [], { commit = true } = {}) {
  await c.query('BEGIN');
  try {
    await c.query(`SELECT set_config('request.jwt.claims', $1, true)`,
      [JSON.stringify({ sub: uid, role: 'authenticated' })]);
    await c.query('SET LOCAL ROLE authenticated');
    const r = await c.query(sql, params);
    await c.query(commit ? 'COMMIT' : 'ROLLBACK');
    return r.rows;
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    throw e;
  }
}

/** Cliente mínimo da API administrativa do GoTrue local. */
export function authAdmin(env = loadQaEnv()) {
  const base = `${assertLocal(env.QA_API_URL, 'QA_API_URL')}/auth/v1/admin`;
  const headers = { apikey: env.QA_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.QA_SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json' };
  const call = async (path, init = {}) => {
    const res = await fetch(`${base}${path}`, { ...init, headers: { ...headers, ...(init.headers ?? {}) } });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`GoTrue ${init.method ?? 'GET'} ${path}: ${res.status} ${JSON.stringify(body)}`);
    return body;
  };
  return {
    async ensureUser(email, password, name) {
      const list = await call(`/users?per_page=1000`);
      const found = (list.users ?? []).find((u) => u.email === email);
      if (found) {
        await call(`/users/${found.id}`, { method: 'PUT', body: JSON.stringify({ password, email_confirm: true, user_metadata: { full_name: name } }) });
        return found.id;
      }
      const created = await call('/users', { method: 'POST',
        body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { full_name: name } }) });
      return created.id;
    },
  };
}
