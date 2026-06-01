/**
 * Workforce overview → print-ready HTML report (browser print → PDF).
 *
 * Mirrors the portfolio export pattern: a pure `buildWorkforceReportHtml(model)`
 * renderer plus `openWorkforceReport(payload)` that opens the print window. The
 * report ALWAYS reflects the selected period — title carries the period label,
 * the generated date and the source.
 */

import { formatWorkforceCurrency } from '@/lib/workforce-data';
import type { WorkforceViewModel } from './period';

export interface WorkforceReportPayload extends WorkforceViewModel {
  brandName?: string;
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string
  ));
}

function fmtPct(n: number): string {
  return `${n > 0 ? '+' : ''}${n.toFixed(1)}%`;
}

export function buildWorkforceReportHtml(payload: WorkforceReportPayload): string {
  const { metrics, costConcentration, payrollRisk, alerts, meta } = payload;
  const brand = payload.brandName ?? 'INSIGHT — Governança Corporativa';
  const generated = new Date(meta.generatedAt).toLocaleString('pt-BR');

  const variationCell = (trend: number, hasComparison: boolean, fallback: string) =>
    hasComparison ? `<span class="${trend > 0 ? 'up' : 'down'}">${fmtPct(trend)}</span>` : `<span class="muted">${fallback}</span>`;

  const kpiRows = `
    <tr><td>Total Funcionários</td><td class="num">${metrics.headcount.total.toLocaleString('pt-BR')}</td>
      <td class="num">${variationCell(metrics.headcount.trend, meta.hasComparison, esc(meta.accumulatedLabels.headcount))}</td></tr>
    <tr><td>Folha Mensal${meta.aggregation === 'average' ? ' (média)' : ''}</td>
      <td class="num">${esc(formatWorkforceCurrency(metrics.monthlyPayroll.value))}</td>
      <td class="num">${variationCell(metrics.monthlyPayroll.trend, meta.hasComparison, esc(meta.accumulatedLabels.payroll))}</td></tr>
    <tr><td>Custo Médio / Funcionário</td><td class="num">${esc(formatWorkforceCurrency(metrics.avgCostPerEmployee.value))}</td>
      <td class="num">${variationCell(metrics.avgCostPerEmployee.trend, meta.hasComparison, esc(meta.accumulatedLabels.avgCost))}</td></tr>
    <tr><td>Folha / Receita</td><td class="num">${metrics.payrollAsRevenuePercent.value.toFixed(1)}%</td>
      <td class="num muted">limite ${metrics.payrollAsRevenuePercent.threshold}%</td></tr>
    <tr><td>PJ vs CLT</td><td class="num">${metrics.contractDistribution.pj} / ${metrics.contractDistribution.clt}</td>
      <td class="num muted">PJ ${metrics.contractDistribution.pjPercent.toFixed(0)}% · CLT ${metrics.contractDistribution.cltPercent.toFixed(0)}%</td></tr>
  `;

  const ccRows = [...costConcentration.costCenters]
    .sort((a, b) => b.payrollValue - a.payrollValue)
    .map((c) => `
      <tr>
        <td>${esc(c.name)}</td>
        <td class="num">${esc(formatWorkforceCurrency(c.payrollValue))}</td>
        <td class="num">${c.headcount}</td>
        <td class="num"><span class="${c.growthVsPrevious > 0 ? 'up' : 'down'}">${fmtPct(c.growthVsPrevious)}</span>${c.isAbnormal ? ' <span class="flag">⚠</span>' : ''}</td>
      </tr>`)
    .join('');

  const alertRows = alerts.length
    ? alerts.map((a) => `<li><strong>${esc(a.title)}</strong> — ${esc(a.description)}</li>`).join('')
    : '<li class="muted">Nenhum alerta ativo no período selecionado.</li>';

  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8" />
<title>Pessoas & Custos — ${esc(meta.periodLabel)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, Segoe UI, Roboto, Arial, sans-serif; color: #0f172a; margin: 0; padding: 32px; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  h2 { font-size: 14px; text-transform: uppercase; letter-spacing: .08em; color: #475569; margin: 28px 0 8px; }
  .sub { color: #475569; font-size: 12px; }
  .meta { margin-top: 6px; font-size: 12px; color: #475569; }
  .meta b { color: #0f172a; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th, td { text-align: left; padding: 7px 8px; border-bottom: 1px solid #e2e8f0; }
  th { font-size: 11px; text-transform: uppercase; letter-spacing: .05em; color: #64748b; }
  .num { text-align: right; font-variant-numeric: tabular-nums; }
  .up { color: #b91c1c; font-weight: 600; }
  .down { color: #047857; font-weight: 600; }
  .muted { color: #94a3b8; }
  .flag { color: #b45309; }
  ul { margin: 6px 0; padding-left: 18px; font-size: 13px; }
  .risk { display: inline-block; padding: 3px 10px; border-radius: 999px; font-size: 12px; font-weight: 600; }
  .risk.healthy { background: #dcfce7; color: #166534; }
  .risk.attention { background: #fef9c3; color: #854d0e; }
  .risk.risk { background: #fee2e2; color: #991b1b; }
  .bar { margin-top: 24px; }
  button { font: inherit; padding: 8px 14px; border: 1px solid #cbd5e1; border-radius: 8px; background: #fff; cursor: pointer; }
  @media print { .bar { display: none; } body { padding: 16px; } }
</style></head>
<body>
  <h1>Pessoas &amp; Custos — Sala de Controle de Custos de Pessoal</h1>
  <div class="sub">${esc(brand)}</div>
  <div class="meta">
    <b>Período:</b> ${esc(meta.periodLabel)} &nbsp;·&nbsp;
    <b>Gerado em:</b> ${esc(generated)} &nbsp;·&nbsp;
    <b>Fonte:</b> ${esc(meta.source)} &nbsp;·&nbsp;
    <b>Meses no escopo:</b> ${meta.monthsInRange}
    ${meta.aggregation === 'average' ? ` &nbsp;·&nbsp; <b>Folha acumulada:</b> ${esc(formatWorkforceCurrency(meta.totalPayrollAccum))}` : ''}
  </div>

  <h2>Indicadores</h2>
  <table>
    <thead><tr><th>Indicador</th><th class="num">Valor</th><th class="num">${meta.hasComparison ? esc(meta.comparisonLabel) : 'Referência'}</th></tr></thead>
    <tbody>${kpiRows}</tbody>
  </table>

  <h2>Concentração de Custos por Centro</h2>
  <table>
    <thead><tr><th>Centro de Custo</th><th class="num">Folha</th><th class="num">Headcount</th><th class="num">Variação</th></tr></thead>
    <tbody>${ccRows}</tbody>
  </table>
  <div class="meta" style="margin-top:8px;">Top 3 concentração: <b>${costConcentration.top3Concentration.toFixed(1)}%</b></div>

  <h2>Risco de Folha</h2>
  <p><span class="risk ${payrollRisk.status}">${payrollRisk.riskScore}/100</span> &nbsp; ${esc(payrollRisk.message)}<br/>
  <span class="sub">Folha ${fmtPct(payrollRisk.payrollGrowth)} · Receita ${fmtPct(payrollRisk.revenueGrowth)}</span></p>

  <h2>Central de Alertas</h2>
  <ul>${alertRows}</ul>

  <div class="bar"><button onclick="window.print()">Imprimir / Salvar PDF</button></div>
</body></html>`;
}

export type WorkforceExportResult =
  | { ok: true }
  | { ok: false; reason: 'popup_blocked' | 'error'; message: string };

export function openWorkforceReport(payload: WorkforceReportPayload): WorkforceExportResult {
  try {
    const html = buildWorkforceReportHtml(payload);
    const w = window.open('', '_blank', 'width=1024,height=768');
    if (!w) {
      return {
        ok: false,
        reason: 'popup_blocked',
        message: 'O navegador bloqueou a janela de impressão. Habilite pop-ups para este site.',
      };
    }
    w.document.open();
    w.document.write(html);
    w.document.close();
    w.focus();
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      reason: 'error',
      message: err instanceof Error ? err.message : 'Falha ao gerar o relatório.',
    };
  }
}
