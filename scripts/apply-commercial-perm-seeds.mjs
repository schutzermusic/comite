/**
 * Aplica e registra a migration 211 (alçada do módulo Comercial).
 *
 * As provas cobrem as duas metades da pergunta: quem DEVE entrar entra, e
 * quem NÃO deve continua fora. Provar só a primeira metade seria provar que
 * a tela abriu, não que a autorização funciona.
 */
import { readFileSync, readdirSync } from 'node:fs';
import pg from 'pg';
import dotenv from 'dotenv';
import { recordMigrationApplied } from './lib/migration-registry.mjs';

dotenv.config({ path: '.env', quiet: true });
dotenv.config({ path: '.env.local', quiet: true });

const apply = process.argv.includes('--apply');
const db = new pg.Client({
  connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
const strip = (sql) => sql.replace(/^\s*(BEGIN|COMMIT)\s*;\s*$/gmi, '');

/** papel → permissões commercial.* esperadas (contagem exata). */
const EXPECTED = {
  owner_admin: 11,
  ceo_diretoria: 4,
  juridico_contratos: 10,
  gestor_projetos: 3,
};
const MUST_HAVE_NONE = ['financeiro', 'engenharia_pcp', 'rh', 'ponto_field_worker'];

try {
  await db.connect();
  await db.query('SET SESSION default_transaction_read_only = off');
  await db.query('BEGIN');
  const [file] = readdirSync('supabase/migrations').filter((f) => f.startsWith('211_'));
  await db.query(strip(readFileSync(`supabase/migrations/${file}`, 'utf8')));
  await recordMigrationApplied(db, '211', file.slice(4).replace(/\.sql$/, ''));

  const failures = [];
  const granted = Object.fromEntries((await db.query(
    `SELECT r.key, count(*)::int n FROM role_permissions rp
       JOIN permissions p ON p.id = rp.permission_id
       JOIN roles r ON r.id = rp.role_id
      WHERE p.module = 'commercial' AND r.organization_id IS NULL
      GROUP BY r.key`)).rows.map((r) => [r.key, r.n]));

  for (const [role, n] of Object.entries(EXPECTED)) {
    if (granted[role] !== n) failures.push(`${role}: esperava ${n} permissões, tem ${granted[role] ?? 0}`);
  }
  for (const role of MUST_HAVE_NONE) {
    if (granted[role]) failures.push(`${role} NÃO deveria receber nada, tem ${granted[role]}`);
  }

  // O caminho real: o resolvedor do servidor vê `commercial.view` para o admin?
  const adminSees = (await db.query(
    `SELECT EXISTS (
       SELECT 1 FROM auth.users u
         JOIN user_roles ur ON ur.user_id = u.id
         JOIN role_permissions rp ON rp.role_id = ur.role_id
         JOIN permissions p ON p.id = rp.permission_id
        WHERE u.email = 'schutzermusic@gmail.com' AND p.key = 'commercial.view') ok`)).rows[0].ok;
  if (!adminSees) failures.push('o admin/CTO continua sem commercial.view');

  // E a negação continua real para um papel operacional.
  const fieldDenied = (await db.query(
    `SELECT NOT EXISTS (
       SELECT 1 FROM roles r
         JOIN role_permissions rp ON rp.role_id = r.id
         JOIN permissions p ON p.id = rp.permission_id
        WHERE r.key = 'ponto_field_worker' AND p.module = 'commercial') ok`)).rows[0].ok;
  if (!fieldDenied) failures.push('papel operacional recebeu acesso comercial');

  // Nenhum papel novo foi criado.
  const roleCount = (await db.query(
    'SELECT count(*)::int n FROM roles WHERE organization_id IS NULL')).rows[0].n;
  if (roleCount !== 8) failures.push(`esperava 8 papéis de sistema, há ${roleCount}`);

  if (failures.length) {
    console.error('PROVAS FALHARAM:\n- ' + failures.join('\n- '));
    await db.query('ROLLBACK');
    process.exit(1);
  }
  console.log('Concessões:', granted);
  console.log('admin/CTO vê Comercial · papel operacional continua negado · nenhum papel novo.');

  if (apply) { await db.query('COMMIT'); console.log('COMMIT — 211 aplicada e registrada.'); }
  else { await db.query('ROLLBACK'); console.log('ENSAIO ok. Use --apply.'); }
} catch (error) {
  console.error('FALHOU:', error.message);
  try { await db.query('ROLLBACK'); } catch {}
  process.exitCode = 1;
} finally { await db.end(); }
