/**
 * Contratos → board-ready PDF report on the shared engine (pilot of the
 * premium executive layout).
 *
 * Consumes the SAME enriched governance records used by the on-screen contracts
 * module (ContractGovernanceRecord from enrichContractsForGovernance) and the
 * SAME portfolio aggregation as the Executive Band
 * (computeContractPortfolioStats), so screen and PDF never diverge. The caller
 * passes the already-filtered records so the report matches the screen.
 *
 * Six chapters — Visão Executiva, Carteira & Exposição, Risco & Governança,
 * Renovações & Timeline, Insights Executivos, Apêndices — packed into pages by
 * composePages (sparse chapters merge; footer numbering stays accurate).
 */

import type { ContractGovernanceRecord } from '@/components/contracts/contract-governance-data';
import { resolveForDisplay, type DisplayPortfolioStats } from '@/lib/contracts/trust/display';
import type { TrustedPortfolioStats } from '@/lib/contracts/trust/portfolio';
import type { TrustedContract } from '@/lib/contracts/trust/read-model';
import { officialCurrencyCompact, officialCurrencyFull, officialPercent } from '@/lib/contracts/trust/format';
import { hasOfficialValue, missing, ratioTrusted, isOfficialOrigin } from '@/lib/contracts/trust/trusted';
import { BRL, compactBRL, esc, fmtDate, fmtInt } from '@/lib/reports/report-formatters';
import { C, REPORT_BRAND_NAME } from '@/lib/reports/report-theme';
import {
  svgDonut, svgGauge, svgHorizontalBar, svgStackedBar, svgWaterfall,
  svgHeatmapGrid, svgTimelineStrip, type TimelineMarker,
} from '@/lib/reports/report-charts';
import {
  reportCover, sectionTitle, kpiGrid, chartBlock, dataTable, dataTableChunked,
  dataQualityBox, warningBox, type KpiCardSpec,
} from '@/lib/reports/report-blocks';
import {
  composePages, block, mmForChart, mmForColumns, mmForCover, mmForKpiGrid,
  mmForSectionTitle, mmForTable, mmForWarningBox, type ReportBlock,
} from '@/lib/reports/report-compose';
import { insightPanel, mmForInsightPanel, type InsightItem } from '@/lib/reports/report-insights';
import { renderReportDocument } from '@/lib/reports/report-shell';
import { openReport, buildReportMeta, buildReportFileName } from '@/lib/reports/report-export';
import type { ReportExportResult } from '@/lib/reports/report-types';

export interface ContractReportPayload {
  /**
   * Linhas para as tabelas de detalhe por contrato. Continuam vindo do record
   * legado nesta fase — as TABELAS são listagem, não métrica executiva.
   */
  records: ContractGovernanceRecord[];
  /**
   * Contratos confiáveis, por id. É a fonte de TODA quantia por contrato nas
   * tabelas: sem isto, as colunas Faturado/Saldo voltariam a imprimir os
   * valores do enricher, e dado de demonstração estaria de novo num PDF
   * oficial — exatamente o que P0.3 proíbe.
   */
  trustedContracts: readonly TrustedContract[];
  /**
   * Instante de referência da timeline de renovações.
   *
   * Injetável porque o documento embute os rótulos dos próximos 12 meses: sem
   * isto o HTML muda sozinho quando o dia vira, e o teste de caracterização
   * que fixa a estrutura do documento passa a falhar por calendário, não por
   * regressão. Padrão continua sendo agora.
   */
  now?: Date;
  /**
   * Agregado CONFIÁVEL — a fonte de toda métrica executiva do relatório.
   *
   * É o mesmo objeto que alimenta a Executive Band na tela, então os dois não
   * podem divergir. Métrica sem apuração imprime "Não apurado"; leitura que
   * falhou imprime "Dados indisponíveis"; nenhuma das duas vira R$ 0.
   */
  trusted: TrustedPortfolioStats;
  brandName?: string;
  periodLabel?: string;
  filtersLabel?: string;
  source?: string;
  generatedBy?: string;
}

const RENEWAL_LABEL: Record<ContractGovernanceRecord['renewalStatus'], string> = {
  expired: 'Vencido',
  critical: 'Crítico (≤30d)',
  attention: 'Atenção (≤90d)',
  planned: 'Planejado (≤180d)',
  stable: 'Estável',
};
const RENEWAL_COLOR: Record<ContractGovernanceRecord['renewalStatus'], string> = {
  expired: C.critical,
  critical: C.cost,
  attention: C.warning,
  planned: C.info,
  stable: C.success,
};
const OBLIGATION_LABEL: Record<ContractGovernanceRecord['obligations'][number]['status'], string> = {
  open: 'Em aberto',
  due_soon: 'Vence em breve',
  overdue: 'Atrasada',
  done: 'Concluída',
};

const renewalPill = (s: ContractGovernanceRecord['renewalStatus']): string =>
  `<span class="pill ${s === 'expired' || s === 'critical' ? 'crit' : s === 'attention' ? 'warn' : 'ok'}">${esc(RENEWAL_LABEL[s])}</span>`;

export function buildContractReportHtml(payload: ContractReportPayload): string {
  const allRecords = payload.records ?? [];
  const brand = payload.brandName ?? REPORT_BRAND_NAME;
  const fileName = buildReportFileName({ module: 'contratos' });
  const meta = buildReportMeta({
    brand,
    periodLabel: payload.periodLabel,
    filtersLabel: payload.filtersLabel,
    source: payload.source,
    generatedBy: payload.generatedBy,
  });

  // Resolução ÚNICA e auditável do agregado confiável para exibição.
  const stats: DisplayPortfolioStats = resolveForDisplay(payload.trusted);

  /**
   * Índice dos contratos confiáveis. As tabelas cruzam por id para imprimir
   * quantias apuradas; um contrato ausente do índice imprime "Não apurado" em
   * vez de herdar o número do record.
   */
  /**
   * Índice APENAS dos contratos de origem validada.
   *
   * O relatório de carteira é documento oficial. Antes desta guarda, as tabelas
   * por contrato liam o índice inteiro e imprimiam as quantias de contratos de
   * demonstração — os KPIs executivos já os excluíam, mas as tabelas logo
   * abaixo os mostravam, o que é pior do que não filtrar nada: o documento
   * ficava internamente contraditório, e o leitor tenderia a acreditar na
   * tabela, que parece mais detalhada.
   */
  const officialContracts = payload.trustedContracts.filter((c) => isOfficialOrigin(c.dataClass));
  const trustedById = new Map(officialContracts.map((c) => [c.id, c]));
  const excludedByOrigin = payload.trustedContracts.length - officialContracts.length;

  /** Linhas do relatório: só contratos de origem validada. */
  const records = allRecords.filter((r) => trustedById.has(r.contract.id));
  const money = (id: string, pick: (c: TrustedContract) => Parameters<typeof officialCurrencyCompact>[0]): string => {
    const t = trustedById.get(id);
    return t ? officialCurrencyCompact(pick(t)) : 'Não apurado';
  };
  const moneyFull = (id: string, pick: (c: TrustedContract) => Parameters<typeof officialCurrencyFull>[0]): string => {
    const t = trustedById.get(id);
    return t ? officialCurrencyFull(pick(t)) : 'Não apurado';
  };
  /** Soma de coluna por extenso, contando somente o apurado. */
  const sumFull = (rowsIn: readonly ContractGovernanceRecord[], pick: (c: TrustedContract) => Parameters<typeof hasOfficialValue>[0]): string => {
    const vals = rowsIn
      .map((r) => trustedById.get(r.contract.id))
      .filter((c): c is TrustedContract => Boolean(c))
      .map(pick)
      .filter(hasOfficialValue);
    return vals.length
      ? officialCurrencyFull({ trust: 'derived', value: vals.reduce((sum, v) => sum + (v.value as number), 0), derivation: { rule: 'soma da tabela', from: [] } })
      : officialCurrencyFull(missing<number>('no-rows'));
  };
  const allObligations = records.flatMap((r) => r.obligations);
  const blocks: ReportBlock[] = [];

  /* ── 01 · Visão Executiva ── */

  const cover = reportCover({
    meta,
    kicker: 'Relatório Executivo · Contratos',
    title: 'Carteira de Contratos',
    context: `<b>${fmtInt(stats.contractCount)}</b> contratos<span class="sep">·</span>valor total <b>${esc(stats.totalValue.text)}</b>`,
    coverKpis: [
      { label: 'Valor total', value: stats.totalValue.text },
      { label: 'Execução financeira', value: stats.billedPct.text },
      { label: 'Contratos', value: fmtInt(stats.contractCount) },
      { label: 'Alto risco', value: stats.highRisk.text },
    ],
  });
  blocks.push(block(cover, mmForCover(true)));

  /**
   * Cor de uma métrica: cinza quando não apurada, vermelho quando a leitura
   * falhou. Uma métrica ausente jamais herda o verde de "está tudo bem".
   */
  const toneOf = (m: DisplayPortfolioStats[keyof DisplayPortfolioStats & string], bad: string, good: string): string => {
    const metric = m as { available: boolean; failed: boolean; value: number | null };
    if (metric.failed) return C.critical;
    if (!metric.available) return C.muted ?? C.info;
    return metric.value ? bad : good;
  };

  const kpiCards: KpiCardSpec[] = [
    { label: 'Valor total contratado', value: stats.totalValue.text, color: C.info, helper: `${fmtInt(stats.contractCount)} contratos` },
    { label: 'Faturado', value: stats.billedValue.text, color: stats.billedValue.available ? C.success : C.info, helper: stats.billedPct.available ? `${stats.billedPct.text} do total` : 'sem execução apurada' },
    { label: 'Saldo a faturar', value: stats.remainingValue.text, color: stats.remainingValue.available ? C.cost : C.info, helper: stats.backlogPct.available ? `${stats.backlogPct.text} da exposição` : 'sem saldo apurado' },
    { label: 'Exposição alto risco', value: stats.highRiskExposure.text, color: toneOf(stats.highRisk, C.critical, C.success), helper: `${stats.highRisk.text} contratos` },
    { label: 'Vencendo ≤90d', value: stats.expiring90.text, color: toneOf(stats.expiring90, C.warning, C.success), helper: `${stats.within30.text} em ≤30d`, chip: stats.within30.value ? { label: 'urgente', cls: 'crit' } : undefined },
    { label: 'Obrigações atrasadas', value: stats.overdueObligations.text, color: toneOf(stats.overdueObligations, C.critical, C.success), helper: `${stats.contractsWithOverdue.text} contratos` },
    { label: 'Contratos sem projeto', value: stats.contractsWithoutProject.text, color: toneOf(stats.contractsWithoutProject, C.warning, C.success), helper: 'vínculo operacional ausente' },
    { label: 'Docs pendentes', value: stats.pendingDocuments.text, color: toneOf(stats.pendingDocuments, C.warning, C.success), helper: `${stats.contractsWithPendingDocs.text} contratos` },
  ];
  blocks.push(block(sectionTitle('Visão Executiva', 'indicadores consolidados da carteira', 1), mmForSectionTitle(true), { keepWithNext: true }));
  blocks.push(block(kpiGrid(kpiCards, 4), mmForKpiGrid(8, 4)));

  /**
   * Gráficos financeiros só existem se houver execução apurada.
   *
   * Um gauge em 0% e um donut com fatia vazia parecem medição — comunicam
   * "nada foi faturado" quando a verdade é "não sabemos". Sem apuração, o
   * espaço traz a declaração da lacuna em vez do desenho.
   */
  const gaugeBlock = stats.billedPct.available
    ? chartBlock({
        title: 'Execução Financeira da Carteira',
        sub: `faturado ${stats.billedValue.text} de ${stats.totalValue.text}`,
        svg: svgGauge(stats.billedPct.value ?? 0, { width: 490, height: 132, label: 'Faturado', sublabel: `${fmtInt(stats.contractCount)} contratos` }),
      })
    : chartBlock({
        title: 'Execução Financeira da Carteira',
        sub: stats.billedPct.failed ? 'leitura de faturamento indisponível' : 'sem faturamento apurado',
        svg: `<div style="height:132px;display:flex;align-items:center;justify-content:center;color:${C.info};font-size:13px">${stats.billedPct.text}</div>`,
      });

  const compositionBlock = stats.billedValue.available && stats.remainingValue.available
    ? chartBlock({
        title: 'Composição Financeira',
        svg: svgDonut(
          [
            { label: 'Faturado', value: stats.billedValue.value ?? 0, color: C.success },
            { label: 'A faturar', value: stats.remainingValue.value ?? 0, color: C.cost },
          ],
          { width: 490, height: 132, centerLabel: stats.totalValue.text, fmtValue: compactBRL },
        ),
      })
    : chartBlock({
        title: 'Composição Financeira',
        sub: 'exige faturado e saldo apurados',
        svg: `<div style="height:132px;display:flex;align-items:center;justify-content:center;color:${C.info};font-size:13px">${stats.billedValue.text}</div>`,
      });
  blocks.push(block(
    `<div class="two-col">${gaugeBlock}${compositionBlock}</div>`,
    mmForColumns(
      mmForChart(132, { svgWidthPx: 490, cols: 2, title: true }),
      mmForChart(132, { svgWidthPx: 490, cols: 2, title: true }),
    ),
  ));

  // Alertas só a partir de métrica apurada: alarmar sobre número inexistente
  // é pior do que não alarmar.
  const alerts: string[] = [];
  if (stats.within30.value) alerts.push(`${stats.within30.text} contrato(s) vencem em até 30 dias.`);
  if (stats.overdueObligations.value) alerts.push(`${stats.overdueObligations.text} obrigação(ões) contratual(is) em atraso em ${stats.contractsWithOverdue.text} contrato(s).`);
  if (stats.highRisk.value) alerts.push(`Exposição de ${stats.highRiskExposure.text} em ${stats.highRisk.text} contrato(s) de alto risco.`);
  if (alerts.length) blocks.push(block(warningBox('Principais alertas', alerts, 'crit'), mmForWarningBox(alerts.length)));

  /**
   * O relatório oficial DECLARA suas lacunas. Um PDF que omite o que não
   * conseguiu apurar engana tanto quanto um que preenche com ficção.
   */
  /**
   * O relatório declara o próprio recorte. Um documento que exclui contratos
   * sem dizer quantos deixa o leitor supor que viu a base inteira.
   */
  if (excludedByOrigin > 0) {
    blocks.push(block(
      warningBox('Recorte da carteira oficial', [
        `${fmtInt(excludedByOrigin)} contrato(s) foram excluídos deste relatório por não terem origem validada como operacional (demonstração ou não classificados).`,
        'Métrica oficial de carteira deriva exclusivamente de contratos classificados como operacionais.',
      ], 'warn'),
      mmForWarningBox(2),
    ));
  }

  if (stats.unavailable.length) {
    const gaps = stats.unavailable.map((item) =>
      item.reason === 'error'
        ? `${item.label}: falha na leitura da fonte — não apresentado.`
        : `${item.label}: sem dado apurado na base — não apresentado.`,
    );
    blocks.push(block(warningBox('Cobertura da apuração', gaps, 'warn'), mmForWarningBox(gaps.length)));
  }

  /* ── 02 · Carteira & Exposição Financeira ── */

  blocks.push(block(sectionTitle('Carteira & Exposição Financeira', 'concentração, execução e saldo por contrato', 2), mmForSectionTitle(true), { breakBefore: true, keepWithNext: true }));

  const byCompany: Record<string, number> = {};
  // Concentração por empresa a partir do valor APURADO; contratos sem valor
  // apurado não inflam nem esvaziam a barra de ninguém.
  records.forEach((r) => {
    const t = trustedById.get(r.contract.id);
    if (t && hasOfficialValue(t.totalValue)) {
      byCompany[r.companyName] = (byCompany[r.companyName] || 0) + t.totalValue.value;
    }
  });
  const companyRows = Object.entries(byCompany).map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value).slice(0, 8);
  const topShare = stats.totalValue.value ? Math.round(((companyRows[0]?.value ?? 0) / stats.totalValue.value) * 100) : 0;
  const companyBlock = chartBlock({
    title: 'Valor por Empresa / Fornecedor',
    sub: `top ${companyRows.length} · maior concentração: ${companyRows[0] ? `${esc(companyRows[0].label)} (${topShare}%)` : '—'}`,
    svg: svgHorizontalBar(companyRows, { width: 490, fmtValue: compactBRL }),
  });
  const waterfallBlock = stats.totalValue.available && stats.billedValue.available
    ? chartBlock({
        title: 'Do Contratado ao Saldo',
        sub: 'ponte financeira da carteira',
        svg: svgWaterfall(
          [
            { label: 'Contratado', value: stats.totalValue.value ?? 0, type: 'total', color: C.info },
            { label: 'Faturado', value: -(stats.billedValue.value ?? 0) },
            { label: 'Saldo a faturar', value: 0, type: 'total', color: C.cost },
          ],
          { width: 490, height: 170 },
        ),
      })
    : chartBlock({
        title: 'Do Contratado ao Saldo',
        sub: 'exige contratado e faturado apurados',
        svg: `<div style="height:170px;display:flex;align-items:center;justify-content:center;color:${C.info};font-size:13px">${stats.billedValue.text}</div>`,
      });
  blocks.push(block(
    `<div class="two-col">${companyBlock}${waterfallBlock}</div>`,
    mmForColumns(
      mmForChart(companyRows.length * 26 + 8, { svgWidthPx: 490, cols: 2, title: true }),
      mmForChart(170, { svgWidthPx: 490, cols: 2, title: true }),
    ),
  ));

  /**
   * Ordenação por saldo APURADO. Contratos sem saldo apurado vão para o fim —
   * não podem disputar o topo de um ranking de exposição com um número que
   * ninguém mediu.
   */
  const saldoDe = (r: ContractGovernanceRecord): number => {
    const t = trustedById.get(r.contract.id);
    return t && hasOfficialValue(t.remainingValue) ? t.remainingValue.value : -1;
  };
  const topExposure = [...records].sort((a, b) => saldoDe(b) - saldoDe(a)).slice(0, 10);
  const exposureTable = dataTable(
    [
      { key: 'code', label: 'Contrato' },
      { key: 'company', label: 'Empresa' },
      { key: 'total', label: 'Contratado', num: true },
      { key: 'billed', label: 'Faturado', num: true },
      { key: 'saldo', label: 'Saldo', num: true },
      { key: 'exec', label: 'Execução', num: true },
      { key: 'renewal', label: 'Renovação' },
    ],
    topExposure.map((r) => ({
      code: r.code,
      company: r.companyName,
      total: { html: `<span class="mono">${esc(money(r.contract.id, (c) => c.totalValue))}</span>` },
      billed: { html: `<span class="mono">${esc(money(r.contract.id, (c) => c.billedValue))}</span>` },
      saldo: { html: `<span class="mono" style="font-weight:700">${esc(money(r.contract.id, (c) => c.remainingValue))}</span>` },
      exec: (() => {
        const t = trustedById.get(r.contract.id);
        if (!t) return '—';
        return officialPercent(ratioTrusted(t.billedValue, t.totalValue, 'execução', ['contracts', 'contract_billing_events']));
      })(),
      renewal: { html: renewalPill(r.renewalStatus) },
    })),
  ).replace('</table>', (() => {
    // O rodapé só soma o que está apurado — e diz quantos contratos entraram.
    const somaDe = (pick: (c: TrustedContract) => Parameters<typeof hasOfficialValue>[0]) => {
      const vals = topExposure
        .map((r) => trustedById.get(r.contract.id))
        .filter((c): c is TrustedContract => Boolean(c))
        .map(pick)
        .filter(hasOfficialValue);
      return vals.length
        ? officialCurrencyCompact({ trust: 'derived', value: vals.reduce((sum, v) => sum + (v.value as number), 0), derivation: { rule: 'soma da tabela', from: [] } })
        : officialCurrencyCompact(missing<number>('no-rows'));
    };
    return `<tfoot><tr><td>Total (top ${topExposure.length})</td><td></td>` +
      `<td class="num">${esc(somaDe((c) => c.totalValue))}</td>` +
      `<td class="num">${esc(somaDe((c) => c.billedValue))}</td>` +
      `<td class="num">${esc(somaDe((c) => c.remainingValue))}</td><td></td><td></td></tr></tfoot></table>`;
  })());
  blocks.push(block(
    `<p class="chart-title">Maiores Exposições — Saldo a Faturar</p>${exposureTable}`,
    mmForTable(topExposure.length + 1, { rowMm: 5.6 }) + 5,
  ));

  /* ── 03 · Risco & Governança ── */

  blocks.push(block(sectionTitle('Risco & Governança', 'classificação de risco, obrigações e aprovações', 3), mmForSectionTitle(true), { breakBefore: true, keepWithNext: true }));

  const riskColor = { low: C.success, medium: C.warning, high: C.critical } as const;
  const riskLabel = { low: 'Baixo', medium: 'Médio', high: 'Alto' } as const;
  const riskCounts = (['high', 'medium', 'low'] as const)
    .map((k) => ({ label: riskLabel[k], value: records.filter((r) => r.contract.riskClassification === k).length, color: riskColor[k] }))
    .filter((s) => s.value > 0);
  const riskBlock = chartBlock({
    title: 'Distribuição de Risco dos Contratos',
    svg: svgDonut(riskCounts, { width: 490, height: 132, centerLabel: fmtInt(records.length), fmtValue: fmtInt }),
  });

  const renewalKeys = ['expired', 'critical', 'attention', 'planned', 'stable'] as const;
  const heatValues = (['high', 'medium', 'low'] as const).map((rk) =>
    renewalKeys.map((nk) => records.filter((r) => r.contract.riskClassification === rk && r.renewalStatus === nk).length));
  const heatBlock = chartBlock({
    title: 'Risco × Janela de Renovação',
    sub: 'nº de contratos por combinação',
    svg: svgHeatmapGrid(
      ['Alto', 'Médio', 'Baixo'],
      ['Vencido', '≤30d', '≤90d', '≤180d', 'Estável'],
      heatValues,
      { width: 490, labelW: 60, color: C.critical },
    ),
  });
  blocks.push(block(
    `<div class="two-col">${riskBlock}${heatBlock}</div>`,
    mmForColumns(
      mmForChart(132, { svgWidthPx: 490, cols: 2, title: true }),
      mmForChart(3 * 26 + 40, { svgWidthPx: 490, cols: 2, title: true }),
    ),
  ));

  const oblByStatus = (['overdue', 'due_soon', 'open', 'done'] as const)
    .map((k) => ({
      label: OBLIGATION_LABEL[k],
      value: allObligations.filter((o) => o.status === k).length,
      color: k === 'overdue' ? C.critical : k === 'due_soon' ? C.warning : k === 'done' ? C.success : C.info,
    }))
    .filter((s) => s.value > 0);
  const oblBlock = chartBlock({
    title: 'Obrigações por Situação',
    sub: `${fmtInt(allObligations.length)} obrigações mapeadas`,
    svg: svgHorizontalBar(oblByStatus, { width: 490, fmtValue: fmtInt, labelW: 130 }),
  });

  const legalBlock = chartBlock({
    title: 'Aprovações Jurídicas e Financeiras',
    svg: svgStackedBar(
      [
        { label: 'Jurídico aprovado', value: records.filter((r) => r.legalStatus === 'approved').length, color: C.success },
        { label: 'Em revisão', value: records.filter((r) => r.legalStatus === 'review').length, color: C.warning },
        { label: 'Pendente', value: records.filter((r) => r.legalStatus === 'pending').length, color: C.critical },
      ],
      { width: 490, fmtValue: fmtInt },
    ) + svgStackedBar(
      [
        { label: 'Financeiro ok', value: records.filter((r) => r.financialStatus === 'ok').length, color: C.success },
        { label: 'Atenção', value: records.filter((r) => r.financialStatus === 'attention').length, color: C.warning },
        { label: 'Bloqueado', value: records.filter((r) => r.financialStatus === 'blocked').length, color: C.critical },
      ],
      { width: 490, fmtValue: fmtInt },
    ),
  });
  blocks.push(block(
    `<div class="two-col">${oblBlock}${legalBlock}</div>`,
    mmForColumns(
      mmForChart(oblByStatus.length * 26 + 8, { svgWidthPx: 490, cols: 2, title: true }),
      mmForChart(120, { svgWidthPx: 490, cols: 2, title: true }),
    ),
  ));

  const criticalObligations = allObligations
    .filter((o) => o.status === 'overdue' || o.status === 'due_soon')
    .sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime())
    .slice(0, 8);
  if (criticalObligations.length) {
    const recByObl = new Map(records.flatMap((r) => r.obligations.map((o) => [o.id, r] as const)));
    const criticalTable = dataTable(
      [
        { key: 'titulo', label: 'Obrigação crítica' },
        { key: 'contrato', label: 'Contrato' },
        { key: 'owner', label: 'Responsável' },
        { key: 'due', label: 'Prazo' },
        { key: 'status', label: 'Situação' },
      ],
      criticalObligations.map((o) => ({
        titulo: o.title,
        contrato: recByObl.get(o.id)?.code ?? '—',
        owner: o.owner,
        due: { html: `<span class="mono" style="${o.status === 'overdue' ? `color:${C.critical};font-weight:700` : ''}">${esc(fmtDate(o.dueDate))}</span>` },
        status: { html: `<span class="pill ${o.status === 'overdue' ? 'crit' : 'warn'}">${esc(OBLIGATION_LABEL[o.status])}</span>` },
      })),
    );
    blocks.push(block(`<p class="chart-title">Obrigações Críticas — Atrasadas e Próximas do Prazo</p>${criticalTable}`, mmForTable(criticalObligations.length) + 6));
  }

  /* ── 04 · Renovações & Timeline ── */

  blocks.push(block(sectionTitle('Renovações & Timeline', 'vencimentos dos próximos 12 meses', 4), mmForSectionTitle(true), { breakBefore: true, keepWithNext: true }));

  const now = payload.now ?? new Date();
  const monthLabels: string[] = [];
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    const mon = d.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '');
    monthLabels.push(i === 0 || d.getMonth() === 0 ? `${mon} ${String(d.getFullYear()).slice(2)}` : mon);
  }
  const expiring12 = records.filter((r) => r.daysUntilExpiration != null && r.daysUntilExpiration >= 0 && r.daysUntilExpiration <= 365);
  const monthIdxFor = (days: number) => Math.min(11, Math.floor(days / 30.44));
  const expCounts = Array.from({ length: 12 }, () => 0);
  expiring12.forEach((r) => { expCounts[monthIdxFor(r.daysUntilExpiration as number)] += 1; });
  // Marcadores ordenados e rotulados pelo valor APURADO — nenhuma quantia do
  // relatório oficial passa mais pelo record de demonstração.
  const valorDe = (r: ContractGovernanceRecord): number => {
    const t = trustedById.get(r.contract.id);
    return t && hasOfficialValue(t.totalValue) ? t.totalValue.value : -1;
  };
  const expMarkers: TimelineMarker[] = [...expiring12]
    .sort((a, b) => valorDe(b) - valorDe(a))
    .slice(0, 6)
    .map((r) => ({
      monthIdx: monthIdxFor(r.daysUntilExpiration as number),
      label: r.code,
      value: money(r.contract.id, (c) => c.totalValue),
      color: RENEWAL_COLOR[r.renewalStatus],
    }));
  const expirationStrip = chartBlock({
    title: 'Vencimentos de Contratos — Próximos 12 Meses',
    sub: `${fmtInt(expiring12.length)} contratos com vencimento na janela · marcadores = maiores valores`,
    svg: svgTimelineStrip(monthLabels, expMarkers, { width: 1000, counts: expCounts, accent: C.warning }),
  });
  blocks.push(block(expirationStrip, mmForChart(expMarkers.length ? 128 : 68, { svgWidthPx: 1000, title: true })));

  const oblCounts = Array.from({ length: 12 }, () => 0);
  allObligations
    .filter((o) => o.status !== 'done')
    .forEach((o) => {
      const days = Math.floor((o.dueDate.getTime() - now.getTime()) / 86_400_000);
      if (days >= 0 && days <= 365) oblCounts[monthIdxFor(days)] += 1;
    });
  const renewalDonut = chartBlock({
    title: 'Contratos por Status de Renovação',
    svg: svgDonut(
      renewalKeys
        .map((k) => ({ label: RENEWAL_LABEL[k], value: records.filter((r) => r.renewalStatus === k).length, color: RENEWAL_COLOR[k] }))
        .filter((s) => s.value > 0),
      { width: 490, height: 132, centerLabel: fmtInt(records.length), fmtValue: fmtInt },
    ),
  });
  const oblStrip = chartBlock({
    title: 'Obrigações em Aberto por Mês de Vencimento',
    svg: svgTimelineStrip(monthLabels, [], { width: 490, counts: oblCounts, accent: C.info }),
  });
  blocks.push(block(
    `<div class="two-col">${renewalDonut}${oblStrip}</div>`,
    mmForColumns(
      mmForChart(132, { svgWidthPx: 490, cols: 2, title: true }),
      mmForChart(68, { svgWidthPx: 490, cols: 2, title: true }),
    ),
  ));

  const expiring180 = records
    .filter((r) => r.daysUntilExpiration != null && r.daysUntilExpiration >= 0 && r.daysUntilExpiration <= 180)
    .sort((a, b) => (a.daysUntilExpiration as number) - (b.daysUntilExpiration as number))
    .slice(0, 8);
  if (expiring180.length) {
    const renewTable = dataTable(
      [
        { key: 'code', label: 'Contrato' },
        { key: 'company', label: 'Empresa' },
        { key: 'valor', label: 'Valor', num: true },
        { key: 'saldo', label: 'Saldo', num: true },
        { key: 'dias', label: 'Vence em', num: true },
        { key: 'renewal', label: 'Status' },
        { key: 'owner', label: 'Gestor' },
      ],
      expiring180.map((r) => ({
        code: r.code,
        company: r.companyName,
        valor: { html: `<span class="mono">${esc(money(r.contract.id, (c) => c.totalValue))}</span>` },
        saldo: { html: `<span class="mono">${esc(money(r.contract.id, (c) => c.remainingValue))}</span>` },
        dias: { html: `<span class="mono" style="${(r.daysUntilExpiration as number) <= 30 ? `color:${C.critical};font-weight:700` : ''}">${fmtInt(r.daysUntilExpiration as number)}d</span>` },
        renewal: { html: renewalPill(r.renewalStatus) },
        owner: r.owner,
      })),
    );
    blocks.push(block(`<p class="chart-title">Contratos Vencendo em até 180 Dias</p>${renewTable}`, mmForTable(expiring180.length) + 6));
  }

  /* ── 05 · Insights Executivos ── */

  const insights: InsightItem[] = [];
  if (companyRows[0] && stats.totalValue) {
    insights.push({
      kind: 'fact',
      title: 'Concentração da carteira',
      detail: `${companyRows[0].label} responde por ${topShare}% do valor contratado (${compactBRL(companyRows[0].value)}).`,
      value: `${topShare}%`,
    });
  }
  if (stats.totalValue.available && stats.billedValue.available) {
    insights.push({
      kind: 'fact',
      title: 'Execução financeira',
      detail: `${stats.billedValue.text} faturados de ${stats.totalValue.text} contratados; saldo de ${stats.remainingValue.text}.`,
      value: stats.billedPct.text,
    });
  }
  const largestBalance = [...records].sort((a, b) => saldoDe(b) - saldoDe(a))[0];
  if (largestBalance && saldoDe(largestBalance) > 0) {
    insights.push({
      kind: 'fact',
      title: 'Maior saldo a faturar',
      detail: `${largestBalance.code} · ${largestBalance.companyName} concentra o maior saldo apurado da carteira.`,
      value: money(largestBalance.contract.id, (c) => c.remainingValue),
    });
  }
  const expiredCritical = records.filter((r) => r.renewalStatus === 'expired' || r.renewalStatus === 'critical');
  if (expiredCritical.length) {
    insights.push({
      kind: 'alert',
      title: 'Risco de renovação imediato',
      detail: `${fmtInt(expiredCritical.length)} contrato(s) vencidos ou vencendo em ≤30d, somando ${compactBRL(expiredCritical.reduce((s, r) => s + r.totalValue, 0))}.`,
      value: fmtInt(expiredCritical.length),
    });
  }
  if (stats.overdueObligations.value) {
    insights.push({
      kind: 'alert',
      title: 'Obrigações contratuais em atraso',
      detail: `${stats.overdueObligations.text} obrigação(ões) vencida(s) em ${stats.contractsWithOverdue.text} contrato(s) exigem regularização.`,
      value: stats.overdueObligations.text,
    });
  }
  if (stats.contractsWithoutBilling.value) {
    insights.push({
      kind: 'alert',
      title: 'Contratos sem faturamento registrado',
      detail: `${stats.contractsWithoutBilling.text} contrato(s) não possuem nenhum evento de faturamento na base — a exposição desses contratos não pode ser apurada.`,
      value: stats.contractsWithoutBilling.text,
    });
  }
  if (stats.expiring90.value) {
    insights.push({
      kind: 'recommendation',
      title: 'Priorizar pipeline de renovação',
      detail: `Iniciar tratativas para os ${stats.expiring90.text} contrato(s) que vencem em ≤90 dias antes da janela crítica de 30 dias.`,
    });
  }
  if (stats.pendingDocuments.value) {
    insights.push({
      kind: 'recommendation',
      title: 'Regularizar documentação',
      detail: `${stats.pendingDocuments.text} documento(s) pendente(s) em ${stats.contractsWithPendingDocs.text} contrato(s) — condição para aprovação jurídica plena.`,
    });
  }
  const noExpiration = records.filter((r) => r.daysUntilExpiration == null).length;
  if (noExpiration) {
    insights.push({
      kind: 'data-quality',
      title: 'Vigência não cadastrada',
      detail: `${fmtInt(noExpiration)} contrato(s) sem data de expiração — janela de renovação não monitorável.`,
    });
  }
  if (stats.contractsWithoutProject.value) {
    insights.push({
      kind: 'data-quality',
      title: 'Contratos sem projeto vinculado',
      detail: `${stats.contractsWithoutProject.text} contrato(s) sem vínculo com projeto, fora da visão consolidada de portfólio.`,
    });
  }

  const shownInsights = insights.slice(0, 9);
  if (shownInsights.length) {
    blocks.push(block(sectionTitle('Insights Executivos', 'leituras factuais geradas a partir dos dados deste relatório', 5), mmForSectionTitle(true), { breakBefore: true, keepWithNext: true }));
    blocks.push(block(insightPanel(shownInsights, { cols: 2 }), mmForInsightPanel(shownInsights.length, 2)));
  }

  /* ── 06 · Apêndices ── */

  blocks.push(block(sectionTitle('Apêndice — Contratos', `${fmtInt(records.length)} contratos · top 60 por valor`, 6), mmForSectionTitle(true), { breakBefore: true, keepWithNext: true }));
  const appendixRows = [...records].sort((a, b) => b.totalValue - a.totalValue).slice(0, 60);
  blocks.push(...dataTableChunked(
    [
      { key: 'code', label: 'Código' },
      { key: 'company', label: 'Empresa' },
      { key: 'project', label: 'Projeto' },
      { key: 'type', label: 'Tipo' },
      { key: 'total', label: 'Valor total', num: true },
      { key: 'billed', label: 'Faturado', num: true },
      { key: 'expira', label: 'Expira em', num: true },
      { key: 'renewal', label: 'Renovação' },
      { key: 'risk', label: 'Risco', num: true },
    ],
    appendixRows.map((r) => ({
      code: r.code,
      company: r.companyName,
      project: r.project ? `${r.project.codigo}` : '—',
      type: r.contractType,
      total: { html: `<span class="mono">${esc(moneyFull(r.contract.id, (c) => c.totalValue))}</span>` },
      billed: { html: `<span class="mono">${esc(moneyFull(r.contract.id, (c) => c.billedValue))}</span>` },
      expira: r.daysUntilExpiration == null ? '—' : `${fmtInt(r.daysUntilExpiration)}d`,
      renewal: { html: renewalPill(r.renewalStatus) },
      risk: fmtInt(r.riskScore),
    })),
    {
      rowsPerChunk: 30,
      rowMm: 4.6,
      totalsRow: {
        code: `Total (${fmtInt(appendixRows.length)})`,
        total: { html: `<span class="mono">${esc(sumFull(appendixRows, (c) => c.totalValue))}</span>` },
        billed: { html: `<span class="mono">${esc(sumFull(appendixRows, (c) => c.billedValue))}</span>` },
      },
    },
  ));

  const oblRows = records.flatMap((r) => r.obligations.map((o) => ({ rec: r, o })))
    .sort((a, b) => a.o.dueDate.getTime() - b.o.dueDate.getTime())
    .slice(0, 40);
  if (oblRows.length) {
    blocks.push(block(sectionTitle('Apêndice — Obrigações', `${fmtInt(allObligations.length)} obrigações · próximas 40 por prazo`), mmForSectionTitle(true), { keepWithNext: true }));
    blocks.push(...dataTableChunked(
      [
        { key: 'titulo', label: 'Obrigação' },
        { key: 'contrato', label: 'Contrato' },
        { key: 'owner', label: 'Responsável' },
        { key: 'due', label: 'Prazo' },
        { key: 'status', label: 'Situação' },
      ],
      oblRows.map(({ rec, o }) => ({
        titulo: o.title,
        contrato: rec.code,
        owner: o.owner,
        due: { html: `<span class="mono" style="${o.status === 'overdue' ? `color:${C.critical};font-weight:700` : ''}">${esc(fmtDate(o.dueDate))}</span>` },
        status: { html: `<span class="pill ${o.status === 'overdue' ? 'crit' : o.status === 'due_soon' ? 'warn' : o.status === 'done' ? 'ok' : ''}">${esc(OBLIGATION_LABEL[o.status])}</span>` },
      })),
      { rowsPerChunk: 22 },
    ));
  }

  const clauseRows = records
    .flatMap((r) => r.clauses.filter((c) => c.category === 'SLA' || c.risk === 'high').map((c) => ({ rec: r, c })))
    .slice(0, 30);
  if (clauseRows.length) {
    blocks.push(block(sectionTitle('Apêndice — Cláusulas / Penalidades', 'SLA e alto risco'), mmForSectionTitle(true), { keepWithNext: true }));
    blocks.push(block(dataTable(
      [
        { key: 'titulo', label: 'Cláusula / penalidade' },
        { key: 'contrato', label: 'Contrato' },
        { key: 'cat', label: 'Categoria' },
        { key: 'risk', label: 'Risco' },
        { key: 'status', label: 'Status' },
      ],
      clauseRows.map(({ rec, c }) => ({
        titulo: c.title,
        contrato: rec.code,
        cat: c.category,
        risk: { html: `<span class="pill ${c.risk === 'high' ? 'crit' : c.risk === 'medium' ? 'warn' : 'ok'}">${esc(c.risk)}</span>` },
        status: c.status,
      })),
    ), mmForTable(clauseRows.length)));
  }

  const issues: string[] = [];
  if (!stats.contractCount) issues.push('Nenhum contrato no recorte selecionado.');
  if (noExpiration) issues.push(`${fmtInt(noExpiration)} contrato(s) sem data de expiração cadastrada.`);
  if (stats.contractsWithPendingDocs.value) issues.push(`${stats.contractsWithPendingDocs.text} contrato(s) com documentos pendentes.`);
  if (stats.contractsWithoutProject.value) issues.push(`${stats.contractsWithoutProject.text} contrato(s) sem projeto vinculado.`);
  if (stats.contractsWithoutAi.value) issues.push(`${stats.contractsWithoutAi.text} contrato(s) sem análise de IA registrada.`);
  // Lacunas de apuração entram na qualidade dos dados, não são escondidas.
  for (const gap of stats.unavailable) {
    issues.push(gap.reason === 'error'
      ? `${gap.label}: falha ao ler a fonte.`
      : `${gap.label}: sem dado apurado na base.`);
  }
  blocks.push(block(sectionTitle('Qualidade dos Dados'), mmForSectionTitle(), { keepWithNext: true }));
  blocks.push(block(dataQualityBox(issues), mmForWarningBox(Math.max(1, issues.length))));

  const pages = composePages(blocks, { orientation: 'landscape' });

  return renderReportDocument({
    fileName,
    brand,
    logoUrl: meta.logoUrl,
    footerLabel: 'Carteira de Contratos',
    pages,
    orientation: 'landscape',
  });
}

export function openContractReport(payload: ContractReportPayload): ReportExportResult {
  try {
    return openReport(buildContractReportHtml(payload), { width: 1280, height: 860 });
  } catch (err) {
    return { ok: false, reason: 'error', message: err instanceof Error ? err.message : 'Falha ao gerar o relatório.' };
  }
}
