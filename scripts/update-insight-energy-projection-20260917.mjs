import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import dotenv from 'dotenv';
import pg from 'pg';
import XLSX from 'xlsx';
import ts from 'typescript';

dotenv.config({ path: '.env.local', quiet: true });
const orgId = '5be2a16a-a1e3-478b-ab52-e8cadb349c34';
const packId = 'bbe4d354-b986-42bd-9f6f-36c325784b0d';
const input = process.argv.find((arg) => arg.startsWith('--input='))?.slice(8)
  ?? '/Users/schutzer/Downloads/FATURAMENTOS - 2026 3.xlsx';
const sheet = XLSX.read(await fs.readFile(input), { type: 'buffer' }).Sheets.Faturamentos;
if (!sheet) throw new Error('Aba Faturamentos ausente.');
const cents = (amount) => Math.round(amount * 100);
const actuals = {};
for (const [period, header, start, end, total] of [
  ['2026-07', 'JULHO', 4, 22, 23], ['2026-08', 'AGOSTO', 29, 49, 50],
]) {
  if (!String(sheet[`A${start - 3}`]?.v).includes(header)
    || sheet[`A${total}`]?.v !== 'JA FATURADO NO MÊS') throw new Error(`Seção inesperada: ${header}.`);
  actuals[period] = cents(sheet[`C${total}`]?.v);
  const sum = Array.from({ length: end - start + 1 }, (_, index) => cents(sheet[`C${start + index}`]?.v ?? 0))
    .reduce((a, b) => a + b, 0);
  if (sum !== actuals[period]) throw new Error(`Total não reconciliado: ${header}.`);
}
// Values transcribed from the supplied Visão Gerencial screenshot, 17 September 2026.
const management = [
  ['cemig', 'CEMIG', 198976342.86, 15287450.14, 183688892.72, 0, 2],
  ['petrobras', 'Petrobras', 126739271.47, 1506178.20, 125233093.27, 0, 2],
  ['enel', 'Enel Green Power', 74795353.45, 46633200.10, 28162153.35, 0, 5],
  ['axia', 'AXIA Energia', 44044856.92, 13587630.96, 30457225.96, 0, 5],
  ['hydro', 'Hydro Alunorte', 4965143.38, 828439.34, 4136704.04, 0, 1],
  ['belem', 'Belém Bioenergia', 1445844.71, 279135.36, 1166709.35, 0, 2],
  ['klabin', 'Klabin', 950000, 285000, 665000, 0, 1],
  ['ambar', 'Âmbar', 883317.21, 794985.49, 88331.72, 88331.72, 1],
  ['flessak', 'Flessak', 803178.97, 80317.90, 722861.07, 0, 1],
  ['nec', 'NEC Energia', 368121.18, 368121.18, 0, 0, 3],
  ['harbin', 'Harbin', 2619995.30, 0, 2619995.30, 0, 2],
  ['andritz', 'Andritz', 80000, 0, 80000, 0, 1],
  ['arcelor', 'ArcelorMittal', 261601.20, 0, 261601.20, 0, 1],
  ['gna', 'GNA', 70812.63, 0, 70812.63, 0, 1],
  ['tiete', 'Tietê Agroindustrial', 187848.91, 0, 187848.91, 0, 1],
].map(([id, client, portfolio, billed, backlog, blocked, contractsCount]) => ({
  id, client, portfolioCents: cents(portfolio), billedCents: cents(billed),
  backlogCents: cents(backlog), blockedCents: cents(blocked), contractsCount,
}));
const source = await fs.readFile('src/lib/finance/investor-pack/rebase-projection.ts', 'utf8');
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { rebaseRevenueProjection, REVENUE_IMPORT_VERSION } = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
const db = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
try {
  await db.connect();
  await db.query('BEGIN');
  const { rows: packs } = await db.query('SELECT p.* FROM investor_report_packs p JOIN organizations o ON o.id=p.organization_id WHERE p.id=$1 AND p.organization_id=$2 AND o.name=$3 FOR UPDATE OF p', [packId, orgId, 'INSIGHT ENERGY']);
  const p = packs[0];
  if (!p || p.status !== 'draft') throw new Error('Projeção Insight Energy em rascunho não encontrada.');
  if (p.narrative.projectionVersion === REVENUE_IMPORT_VERSION) {
    console.log('Atualização já aplicada; nenhum valor alterado.');
    await db.query('ROLLBACK');
  } else {
    const { rows } = await db.query('SELECT * FROM investor_report_pack_months WHERE pack_id=$1 AND organization_id=$2 ORDER BY period_key FOR UPDATE', [packId, orgId]);
    const pack = {
      id: p.id, organizationId: p.organization_id, status: p.status, periodEnd: p.period_end,
      narrative: p.narrative,
      months: rows.map((m) => ({ id: m.id, period: m.period_key, revenueActualCents: Number(m.revenue_actual_cents), revenueForecastCents: Number(m.revenue_forecast_cents), payrollActualCents: Number(m.payroll_actual_cents), payrollForecastCents: Number(m.payroll_forecast_cents), note: m.note })),
    };
    const next = rebaseRevenueProjection(pack, actuals, management);
    const summary = {
      actuals, previousAugustForecastCents: pack.months.find((m) => m.period === '2026-08').revenueForecastCents,
      future: next.months.filter((m) => m.period >= '2026-07' && m.period <= '2027-01').map((m) => ({ period: m.period, actual: m.revenueActualCents, forecast: m.revenueForecastCents })),
      portfolioTotals: Object.fromEntries(['portfolioCents', 'billedCents', 'backlogCents', 'blockedCents', 'contractsCount', 'projectedThrough2028Cents', 'remainingAfter2028Cents'].map((key) => [key, next.narrative.portfolio.reduce((sum, client) => sum + client[key], 0)])),
    };
    console.log(JSON.stringify(summary, null, 2));
    if (process.argv.includes('--apply')) {
      const backup = path.join(os.tmpdir(), `insight-energy-projection-${Date.now()}-before.json`);
      await fs.writeFile(backup, JSON.stringify({ pack: p, months: rows }, null, 2), { mode: 0o600 });
      for (const m of next.months) {
        const old = pack.months.find((row) => row.id === m.id);
        if (m.revenueActualCents === old.revenueActualCents && m.revenueForecastCents === old.revenueForecastCents && m.note === old.note) continue;
        const result = await db.query('UPDATE investor_report_pack_months SET revenue_actual_cents=$1,revenue_forecast_cents=$2,note=$3,updated_at=now() WHERE id=$4 AND pack_id=$5 AND organization_id=$6', [m.revenueActualCents, m.revenueForecastCents, m.note, m.id, packId, orgId]);
        if (result.rowCount !== 1) throw new Error('Competência não atualizada.');
      }
      await db.query('UPDATE investor_report_packs SET narrative=$1,reference_date=$2,updated_at=now() WHERE id=$3 AND organization_id=$4', [next.narrative, next.referenceDate, packId, orgId]);
      const { rows: saved } = await db.query('SELECT * FROM investor_report_pack_months WHERE pack_id=$1 AND organization_id=$2 ORDER BY period_key', [packId, orgId]);
      for (const row of saved) {
        const expected = next.months.find((m) => m.id === row.id);
        for (const [column, key] of [['revenue_actual_cents', 'revenueActualCents'], ['revenue_forecast_cents', 'revenueForecastCents'], ['payroll_actual_cents', 'payrollActualCents'], ['payroll_forecast_cents', 'payrollForecastCents']]) {
          if (Number(row[column]) !== expected[key]) throw new Error(`Verificação falhou: ${row.period_key}/${key}.`);
        }
      }
      await db.query('COMMIT');
      console.log(`Atualização salva e verificada. Backup: ${backup}`);
    } else {
      await db.query('ROLLBACK');
      console.log('Prévia conferida. Use --apply para salvar.');
    }
  }
} catch (error) {
  await db.query('ROLLBACK').catch(() => {});
  throw error;
} finally {
  await db.end();
}
