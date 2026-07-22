/**
 * Dispara o job agendado do Ponto (auto-provisionamento + lembretes +
 * detecção de ativação) chamando o endpoint seguro /api/ponto/cron.
 * Para agentes/cron externos (ou teste local). Requer:
 *   CRON_SECRET             — o mesmo do servidor
 *   PONTO_CRON_URL (ou NEXT_PUBLIC_PONTO_URL / NEXT_PUBLIC_SITE_URL) — base
 *
 *   node scripts/ponto-cron.mjs
 */
import dotenv from 'dotenv';
dotenv.config({ path: '.env' });
dotenv.config({ path: '.env.local' });

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

const dryRun = process.argv.includes('--dry-run') || process.argv.includes('--dryRun');
const url = new URL(`${base}/api/ponto/cron`);
if (dryRun) url.searchParams.set('dryRun', '1');

const res = await fetch(url, {
  method: 'POST',
  headers: { authorization: `Bearer ${secret}` },
});
const json = await res.json().catch(() => ({}));
if (!res.ok || json.ok === false) {
  console.error(`Falha (${res.status}):`, json.error || 'erro desconhecido');
  process.exit(1);
}
console.log(dryRun ? 'DRY-RUN (nada enviado/mutado):' : 'Cron do Ponto executado:', JSON.stringify(json.summary, null, 2));
