/**
 * Retenção LGPD das selfies — dispara o endpoint seguro /api/ponto/retention
 * (remoção física via Storage API + anonimização de ponteiros + auditoria).
 * Lógica única no servidor; este script é para agente/cron externo ou manual.
 *
 *   node scripts/purge-attendance-selfies.mjs [--dry-run] [retentionDays]
 *
 * Env: CRON_SECRET (obrigatório), PONTO_CRON_URL / NEXT_PUBLIC_PONTO_URL /
 *      NEXT_PUBLIC_SITE_URL (base), PONTO_SELFIE_RETENTION_DAYS (default 90).
 */
import dotenv from 'dotenv';
dotenv.config({ path: '.env' });
dotenv.config({ path: '.env.local' });

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run') || args.includes('--dryRun');
const days = args.find((a) => /^\d+$/.test(a));

const base = (
  process.env.PONTO_CRON_URL ||
  process.env.NEXT_PUBLIC_PONTO_URL ||
  process.env.NEXT_PUBLIC_SITE_URL ||
  'http://localhost:9002'
).replace(/\/$/, '');
const secret = process.env.CRON_SECRET;
if (!secret) {
  console.error('CRON_SECRET ausente no ambiente.');
  process.exit(1);
}

const url = new URL(`${base}/api/ponto/retention`);
if (dryRun) url.searchParams.set('dryRun', '1');
if (days) url.searchParams.set('retentionDays', days);

const res = await fetch(url, { method: 'POST', headers: { authorization: `Bearer ${secret}` } });
const json = await res.json().catch(() => ({}));
if (!res.ok || json.ok === false) {
  console.error(`Falha (${res.status}):`, json.error || 'erro desconhecido');
  process.exit(1);
}
console.log(dryRun ? 'DRY-RUN (nada removido):' : 'Retenção executada:', JSON.stringify(json.summary, null, 2));
