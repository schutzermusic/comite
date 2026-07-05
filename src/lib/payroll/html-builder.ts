/**
 * Deterministic builders for the payroll closing e-mail body, the executive
 * report and the dashboard snapshot. Pure string functions (no AI, no DOM) so
 * they run identically on server and client. Numbers come straight from the
 * `PayrollParseResult` — the source of truth — never from the model.
 */

import type {
  PayrollComparisonRow,
  PayrollNarrative,
  PayrollParseResult,
} from '@/lib/types/payroll-closing';
import { FONT_FAMILY_SANS, buildGilroyFontFaceCss } from '@/lib/fonts';

function brl(cents: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100);
}

function pctLabel(value: number): string {
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(2).replace('.', ',')}%`;
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function competenceLabel(competence: string): string {
  const m = competence.match(/(\d{4})-(\d{2})/);
  if (!m) return competence || '—';
  const meses = ['', 'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
  return `${meses[Number(m[2])] ?? m[2]}/${m[1]}`;
}

function comparisonRows(rows: PayrollComparisonRow[]): string {
  if (rows.length === 0) return '<tr><td colspan="3" style="padding:8px;color:#64748b;">Sem dados comparativos por centro de custo.</td></tr>';
  return rows
    .map(
      (r) => `<tr>
        <td style="padding:6px 10px;border-bottom:1px solid #e2e8f0;">${esc(r.label)}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #e2e8f0;text-align:right;">${brl(r.current_cents)}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #e2e8f0;text-align:right;color:${r.variation_cents >= 0 ? '#dc2626' : '#16a34a'};">${pctLabel(r.variation_percentage)}</td>
      </tr>`,
    )
    .join('');
}

function bullets(items: string[]): string {
  if (!items || items.length === 0) return '';
  return `<ul style="margin:8px 0 16px;padding-left:20px;">${items.map((i) => `<li style="margin-bottom:4px;">${esc(i)}</li>`).join('')}</ul>`;
}

export interface EmailBodyInput {
  parse: PayrollParseResult;
  narrative?: PayrollNarrative | null;
  /** Which audience this body targets — selects the narrative variant. */
  audience: 'board' | 'finance' | 'hr' | 'custom';
  organizationName?: string;
}

/** Builds the e-mail HTML body. Narrative is optional (degrades to numbers only). */
export function buildEmailHtml(input: EmailBodyInput): string {
  const { parse, narrative, audience } = input;
  const org = input.organizationName ?? 'INSIGHT Governança Corporativa';
  const varColor = parse.variation_amount_cents >= 0 ? '#dc2626' : '#16a34a';

  const intro =
    audience === 'board'
      ? narrative?.board_summary
      : audience === 'finance'
        ? narrative?.finance_email
        : audience === 'hr'
          ? narrative?.hr_validation
          : narrative?.closing_email;

  return `<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="utf-8"/></head>
<body style="margin:0;background:#f1f5f9;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#0f172a;">
<div style="max-width:680px;margin:0 auto;padding:24px;">
  <div style="background:#0b1220;color:#fff;padding:20px 24px;border-radius:12px 12px 0 0;">
    <div style="font-size:12px;letter-spacing:1px;opacity:.7;text-transform:uppercase;">${esc(org)}</div>
    <div style="font-size:20px;font-weight:700;margin-top:4px;">Fechamento da Folha — ${esc(competenceLabel(parse.competence_month))}</div>
  </div>
  <div style="background:#fff;padding:24px;border:1px solid #e2e8f0;border-top:none;">
    <table style="width:100%;border-collapse:collapse;margin-bottom:20px;">
      <tr>
        <td style="padding:12px;background:#f8fafc;border-radius:8px;">
          <div style="font-size:11px;color:#64748b;text-transform:uppercase;">Total da Folha</div>
          <div style="font-size:22px;font-weight:700;">${brl(parse.total_amount_cents)}</div>
        </td>
        <td style="width:12px;"></td>
        <td style="padding:12px;background:#f8fafc;border-radius:8px;">
          <div style="font-size:11px;color:#64748b;text-transform:uppercase;">Mês Anterior</div>
          <div style="font-size:22px;font-weight:700;">${brl(parse.previous_month_amount_cents)}</div>
        </td>
        <td style="width:12px;"></td>
        <td style="padding:12px;background:#f8fafc;border-radius:8px;">
          <div style="font-size:11px;color:#64748b;text-transform:uppercase;">Variação</div>
          <div style="font-size:22px;font-weight:700;color:${varColor};">${brl(parse.variation_amount_cents)} (${pctLabel(parse.variation_percentage)})</div>
        </td>
      </tr>
    </table>

    ${intro ? `<div style="font-size:14px;line-height:1.6;white-space:pre-wrap;margin-bottom:20px;">${esc(intro)}</div>` : ''}

    <h3 style="font-size:14px;margin:16px 0 8px;">Variação por Centro de Custo</h3>
    <table style="width:100%;border-collapse:collapse;font-size:13px;">
      <thead><tr style="background:#f1f5f9;">
        <th style="padding:8px 10px;text-align:left;">Centro de Custo</th>
        <th style="padding:8px 10px;text-align:right;">Atual</th>
        <th style="padding:8px 10px;text-align:right;">Variação</th>
      </tr></thead>
      <tbody>
        ${comparisonRows([...parse.comparison.top_increases, ...parse.comparison.top_decreases])}
      </tbody>
    </table>

    ${narrative && narrative.attention_points.length > 0 ? `<h3 style="font-size:14px;margin:20px 0 8px;color:#b45309;">Pontos de Atenção</h3>${bullets(narrative.attention_points)}` : ''}
    ${narrative && narrative.recommendations.length > 0 ? `<h3 style="font-size:14px;margin:16px 0 8px;">Recomendações</h3>${bullets(narrative.recommendations)}` : ''}
    ${narrative?.conclusion ? `<div style="font-size:13px;line-height:1.6;margin-top:16px;padding-top:16px;border-top:1px solid #e2e8f0;color:#334155;white-space:pre-wrap;">${esc(narrative.conclusion)}</div>` : ''}
  </div>
  <div style="padding:16px 24px;font-size:11px;color:#94a3b8;text-align:center;">
    Documento gerado automaticamente pelo módulo Pessoas & Custos. Os valores têm como fonte a planilha de folha importada.
  </div>
</div>
</body></html>`;
}

/** Plain-text version (for the report text / preview). */
export function buildEmailText(input: EmailBodyInput): string {
  const { parse, narrative, audience } = input;
  const lines: string[] = [];
  lines.push(`Fechamento da Folha — ${competenceLabel(parse.competence_month)}`);
  lines.push('');
  lines.push(`Total da folha: ${brl(parse.total_amount_cents)}`);
  lines.push(`Mês anterior: ${brl(parse.previous_month_amount_cents)}`);
  lines.push(`Variação: ${brl(parse.variation_amount_cents)} (${pctLabel(parse.variation_percentage)})`);
  lines.push('');
  const intro =
    audience === 'board' ? narrative?.board_summary
    : audience === 'finance' ? narrative?.finance_email
    : audience === 'hr' ? narrative?.hr_validation
    : narrative?.closing_email;
  if (intro) {
    lines.push(intro);
    lines.push('');
  }
  if (narrative?.attention_points.length) {
    lines.push('Pontos de atenção:');
    narrative.attention_points.forEach((p) => lines.push(`- ${p}`));
    lines.push('');
  }
  if (narrative?.recommendations.length) {
    lines.push('Recomendações:');
    narrative.recommendations.forEach((p) => lines.push(`- ${p}`));
    lines.push('');
  }
  if (narrative?.conclusion) lines.push(narrative.conclusion);
  return lines.join('\n');
}

/** Print-ready executive report HTML (used as the "executive_pdf" attachment via print). */
export function buildExecutiveReportHtml(parse: PayrollParseResult, narrative?: PayrollNarrative | null): string {
  const ccRows = parse.cost_centers
    .map(
      (c) => `<tr>
        <td style="padding:6px 10px;border-bottom:1px solid #e2e8f0;">${esc(c.cost_center_label)}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #e2e8f0;text-align:right;">${brl(c.amount_cents)}</td>
      </tr>`,
    )
    .join('');

  return `<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="utf-8"/>
<title>Relatório Executivo — Folha ${esc(competenceLabel(parse.competence_month))}</title>
<style>${buildGilroyFontFaceCss()}@media print{.no-print{display:none}}body{font-family:${FONT_FAMILY_SANS};color:#0f172a;margin:40px;}</style>
</head><body>
  <h1 style="margin-bottom:0;">Relatório Executivo — Fechamento da Folha</h1>
  <div style="color:#64748b;margin-bottom:24px;">Competência ${esc(competenceLabel(parse.competence_month))}</div>
  ${narrative?.executive_summary ? `<p style="font-size:14px;line-height:1.7;white-space:pre-wrap;">${esc(narrative.executive_summary)}</p>` : ''}
  <h2>Indicadores</h2>
  <ul>
    <li>Total da folha: <strong>${brl(parse.total_amount_cents)}</strong></li>
    <li>Mês anterior: ${brl(parse.previous_month_amount_cents)}</li>
    <li>Variação: <strong style="color:${parse.variation_amount_cents >= 0 ? '#dc2626' : '#16a34a'};">${brl(parse.variation_amount_cents)} (${pctLabel(parse.variation_percentage)})</strong></li>
    ${parse.headcount ? `<li>Headcount: ${parse.headcount}</li>` : ''}
    ${parse.clt_count || parse.pj_count ? `<li>CLT: ${parse.clt_count ?? 0} · PJ: ${parse.pj_count ?? 0}</li>` : ''}
  </ul>
  <h2>Folha por Centro de Custo</h2>
  <table style="width:100%;border-collapse:collapse;font-size:13px;">
    <thead><tr style="background:#f1f5f9;"><th style="padding:8px 10px;text-align:left;">Centro de Custo</th><th style="padding:8px 10px;text-align:right;">Valor</th></tr></thead>
    <tbody>${ccRows || '<tr><td colspan="2" style="padding:8px;color:#64748b;">Sem detalhamento por centro de custo.</td></tr>'}</tbody>
  </table>
  ${narrative?.anomalies.length ? `<h2>Anomalias</h2>${bullets(narrative.anomalies)}` : ''}
  ${narrative?.attention_points.length ? `<h2>Pontos de Atenção</h2>${bullets(narrative.attention_points)}` : ''}
  ${narrative?.recommendations.length ? `<h2>Recomendações</h2>${bullets(narrative.recommendations)}` : ''}
  ${narrative?.conclusion ? `<h2>Conclusão</h2><p style="line-height:1.7;white-space:pre-wrap;">${esc(narrative.conclusion)}</p>` : ''}
  <button class="no-print" onclick="window.print()" style="margin-top:24px;padding:10px 16px;">Imprimir / Salvar PDF</button>
</body></html>`;
}
