/**
 * Pessoas & Custos · SST / ASO & CAT → relatório PDF.
 *
 * Só layout. Todos os números chegam prontos dos MESMOS seletores que
 * alimentam a tela (`src/lib/workforce/sst.ts`), pela mesma razão do
 * risk-report: um relatório que recalcula é um relatório que diverge da tela
 * sem ninguém perceber.
 *
 * A regra dos quatro estados do ASO atravessa o documento: "em dia", "a
 * vencer", "vencido" e "sem vencimento apurável" aparecem separados aqui como
 * aparecem na tela. Consolidar os dois últimos num só produziria um número de
 * conformidade que ninguém pode defender numa auditoria.
 */
import { esc, fmtInt } from '@/lib/reports/report-formatters';
import { C, REPORT_BRAND_NAME } from '@/lib/reports/report-theme';
import { svgHorizontalBar } from '@/lib/reports/report-charts';
import {
  reportCover, sectionTitle, kpiGrid, chartBlock, dataTable, dataQualityBox, summaryBox,
  type KpiCardSpec,
} from '@/lib/reports/report-blocks';
import {
  composePages, block, mmForChart, mmForCover, mmForKpiGrid,
  mmForSectionTitle, mmForSummary, mmForTable, mmForWarningBox, type ReportBlock,
} from '@/lib/reports/report-compose';
import { renderReportDocument } from '@/lib/reports/report-shell';
import { openReport, buildReportMeta, buildReportFileName } from '@/lib/reports/report-export';
import type { ReportExportResult } from '@/lib/reports/report-types';
import {
  ASO_EXAM_KIND_LABELS,
  CAT_LOCAL_LABELS,
  CAT_TYPE_LABELS,
  RISK_ASSESSMENT_LABELS,
} from '@/lib/esocial/connector/sst';
import type { SstEvent, SstSummary, WorkerAsoStatus } from '@/lib/workforce/sst';

const NA = '—';

export interface SstReportPayload {
  summary: SstSummary;
  cats: SstEvent[];
  asoStatuses: WorkerAsoStatus[];
  exposures: SstEvent[];
  areas: { areaLabel: string; total: number; withLeave: number }[];
  agents: { code: string; description: string | null; workers: number; assessment: string | null }[];
  periodLabel: string;
  /** Quem gerou tinha permissão de ver nomes? Muda o que sai impresso. */
  identified: boolean;
  brandName?: string;
  generatedBy?: string;
}

function dateLabel(value: string | null): string {
  return value ? value.split('-').reverse().join('/') : NA;
}

function labelFor(map: Record<string, string>, code: string | null | undefined): string {
  if (!code) return NA;
  return map[code] ?? code;
}

/** Valor ausente sai cinza e marcado, nunca como zero. */
function count(value: number | null): { value: string; missing: boolean } {
  return value === null ? { value: NA, missing: true } : { value: fmtInt(value), missing: false };
}

export function buildSstReportHtml(payload: SstReportPayload): string {
  const {
    summary, cats, asoStatuses, exposures, areas, agents, periodLabel, identified,
  } = payload;

  const brand = payload.brandName ?? REPORT_BRAND_NAME;
  const fileName = buildReportFileName({ module: 'pessoas-custos', context: 'sst' });
  const meta = buildReportMeta({
    brand,
    periodLabel,
    filtersLabel: identified ? 'com identificação nominal' : 'sem identificação nominal',
    source: 'eSocial (S-2210 / S-2220 / S-2240)',
    generatedBy: payload.generatedBy,
  });

  const blocks: ReportBlock[] = [];

  // ── Capa ──
  const cat = count(summary.catsInPeriod);
  const expired = count(summary.asoExpired);
  blocks.push(block(
    reportCover({
      meta,
      kicker: 'Relatório Executivo · Saúde e Segurança do Trabalho',
      title: 'SST / ASO & CAT',
      context: `Acidentes, saúde ocupacional e exposição a agentes nocivos — ${periodLabel}`,
      coverKpis: [
        { label: 'CATs no período', value: cat.value },
        { label: 'ASOs vencidos', value: expired.value },
        { label: 'Vínculos ativos', value: fmtInt(summary.activeWorkers) },
      ],
    }),
    mmForCover(true),
  ));

  // ── 1. Panorama ──
  const narrative: string[] = [];
  if (summary.catsInPeriod === null) {
    narrative.push(
      'Não há eventos de SST no acervo do eSocial para este recorte. Os indicadores desta seção ficam ausentes — nenhum deles foi zerado, porque zero afirmaria que nada aconteceu, e o que se sabe é apenas que nada foi importado.',
    );
  } else {
    narrative.push(
      `No período foram apurados ${fmtInt(summary.catsInPeriod)} comunicado(s) de acidente, ${fmtInt(summary.asosInPeriod ?? 0)} exame(s) ocupacional(is) e ${fmtInt(summary.exposedWorkers ?? 0)} trabalhador(es) com exposição declarada a agente nocivo.`,
    );
    if (summary.catsWithLeaveUndeclared && summary.catsWithLeaveUndeclared > 0) {
      narrative.push(
        `${fmtInt(summary.catsWithLeaveUndeclared)} CAT(s) não declararam se houve afastamento. Elas não estão contadas entre as que afastaram nem entre as que não afastaram: o dado simplesmente não foi informado no atestado.`,
      );
    }
    narrative.push(
      'A validade do ASO não é declarada pelo leiaute do eSocial. Ela é apurada apenas para o exame periódico, pela periodicidade anual da NR-7; os demais tipos aparecem como "sem vencimento apurável" e não devem ser lidos como conformidade.',
    );
  }

  blocks.push(block(sectionTitle('Panorama', periodLabel, 1), mmForSectionTitle(true), { keepWithNext: true }));
  blocks.push(block(summaryBox(narrative), mmForSummary(narrative), { keepWithNext: true }));

  const kpis: KpiCardSpec[] = [
    { label: 'CATs no período', ...count(summary.catsInPeriod), color: C.critical },
    { label: 'CATs com afastamento', ...count(summary.catsWithLeave), color: C.critical },
    { label: 'CATs sem declaração de afastamento', ...count(summary.catsWithLeaveUndeclared), color: C.subtle },
    { label: 'ASOs realizados', ...count(summary.asosInPeriod), color: C.primary },
    { label: 'ASOs vencidos', ...count(summary.asoExpired), color: C.critical },
    { label: 'ASOs a vencer (60 dias)', ...count(summary.asoExpiring), color: C.warning },
    { label: 'Sem ASO no acervo', ...count(summary.workersWithoutAso), color: C.warning },
    { label: 'Sem vencimento apurável', ...count(summary.asoUndetermined), color: C.subtle,
      helper: 'Tipo de exame não estabelece periodicidade' },
  ];
  blocks.push(block(kpiGrid(kpis, 4), mmForKpiGrid(kpis.length, 4) + 3));

  // ── 2. Acidentes por lotação ──
  if (areas.length > 0) {
    blocks.push(block(sectionTitle('Acidentes por lotação', 'Onde os acidentes se concentram', 2),
      mmForSectionTitle(true), { breakBefore: true, keepWithNext: true }));

    const svg = svgHorizontalBar(
      areas.slice(0, 12).map((a) => ({ label: a.areaLabel, value: a.total })),
      { width: 900 },
    );
    blocks.push(block(
      chartBlock({ title: 'CATs por lotação', sub: 'Lotação herdada do S-1200 do trabalhador', svg }),
      mmForChart(Math.max(140, areas.slice(0, 12).length * 26 + 40), { title: true }),
    ));

    blocks.push(block(
      dataTable(
        [
          { key: 'area', label: 'Lotação' },
          { key: 'total', label: 'CATs', num: true },
          { key: 'leave', label: 'Com afastamento', num: true },
        ],
        areas.map((a) => ({
          area: a.areaLabel,
          total: fmtInt(a.total),
          leave: a.withLeave > 0
            ? { html: `<span style="color:${C.critical}">${fmtInt(a.withLeave)}</span>` }
            : fmtInt(a.withLeave),
        })),
      ),
      mmForTable(areas.length),
    ));
  }

  // ── 3. Comunicações de acidente ──
  blocks.push(block(sectionTitle('Comunicações de Acidente (S-2210)', periodLabel, 3),
    mmForSectionTitle(true), { breakBefore: true, keepWithNext: true }));

  blocks.push(block(
    cats.length
      ? dataTable(
          [
            { key: 'date', label: 'Data' },
            ...(identified ? [{ key: 'worker', label: 'Trabalhador' }] : []),
            { key: 'area', label: 'Lotação' },
            { key: 'type', label: 'Tipo' },
            { key: 'local', label: 'Local' },
            { key: 'leave', label: 'Afastou' },
          ],
          cats.map((c) => ({
            date: dateLabel(c.eventDate),
            ...(identified ? { worker: c.workerName ?? NA } : {}),
            area: c.areaLabel ?? NA,
            type: labelFor(CAT_TYPE_LABELS, c.cat?.catType),
            local: labelFor(CAT_LOCAL_LABELS, c.cat?.localKind),
            leave:
              c.cat?.causedLeave === true
                ? { html: `<span class="pill crit">Sim</span>` }
                : c.cat?.causedLeave === false
                  ? 'Não'
                  // Não declarado nunca vira "Não".
                  : { html: `<span style="color:${C.subtle}">não declarado</span>` },
          })),
        )
      : '<p class="empty">Nenhuma CAT no período.</p>',
    cats.length ? mmForTable(cats.length, { rowMm: 5.4 }) : 8,
  ));

  // ── 4. Saúde ocupacional ──
  blocks.push(block(sectionTitle('Saúde Ocupacional (S-2220)', 'Situação do ASO por vínculo ativo', 4),
    mmForSectionTitle(true), { breakBefore: true, keepWithNext: true }));

  const STATUS_LABEL: Record<WorkerAsoStatus['status'], { label: string; cls: string }> = {
    expired: { label: 'Vencido', cls: 'crit' },
    expiring: { label: 'A vencer', cls: 'warn' },
    valid: { label: 'Em dia', cls: 'ok' },
    undetermined: { label: 'Sem vencimento apurável', cls: 'info' },
    absent: { label: 'Sem ASO no acervo', cls: 'info' },
  };
  const order: WorkerAsoStatus['status'][] = ['expired', 'expiring', 'absent', 'undetermined', 'valid'];
  const sorted = [...asoStatuses].sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status));

  blocks.push(block(
    sorted.length
      ? dataTable(
          [
            ...(identified ? [{ key: 'worker', label: 'Trabalhador' }] : []),
            { key: 'area', label: 'Lotação' },
            { key: 'exam', label: 'Último exame' },
            { key: 'kind', label: 'Tipo' },
            { key: 'until', label: 'Vence em' },
            { key: 'status', label: 'Situação' },
          ],
          sorted.map((s) => ({
            ...(identified ? { worker: s.worker.name ?? NA } : {}),
            area: s.worker.areaLabel ?? NA,
            exam: dateLabel(s.lastExamDate),
            kind: labelFor(ASO_EXAM_KIND_LABELS, s.lastExamKind),
            until: s.validUntil ? dateLabel(s.validUntil) : NA,
            status: { html: `<span class="pill ${STATUS_LABEL[s.status].cls}">${esc(STATUS_LABEL[s.status].label)}</span>` },
          })),
        )
      : '<p class="empty">Nenhum vínculo ativo apurado.</p>',
    sorted.length ? mmForTable(sorted.length, { rowMm: 5.4 }) : 8,
  ));

  // ── 5. Exposição a agentes nocivos ──
  if (agents.length > 0 || exposures.length > 0) {
    blocks.push(block(sectionTitle('Exposição a Agentes Nocivos (S-2240)', periodLabel, 5),
      mmForSectionTitle(true), { breakBefore: true, keepWithNext: true }));

    blocks.push(block(
      agents.length
        ? dataTable(
            [
              { key: 'code', label: 'Código' },
              { key: 'desc', label: 'Agente' },
              { key: 'aval', label: 'Avaliação' },
              { key: 'workers', label: 'Trabalhadores', num: true },
            ],
            agents.map((a) => ({
              code: a.code,
              desc: a.description ?? NA,
              aval: labelFor(RISK_ASSESSMENT_LABELS, a.assessment),
              workers: fmtInt(a.workers),
            })),
          )
        : '<p class="empty">Nenhum agente nocivo declarado no período.</p>',
      agents.length ? mmForTable(agents.length) : 8,
    ));
  }

  // ── 6. Qualidade dos dados ──
  const issues: string[] = [];
  if (summary.catsInPeriod === null) {
    issues.push('Nenhum evento de SST foi importado: todos os indicadores desta seção estão ausentes, não zerados.');
  }
  if (summary.catsWithLeaveUndeclared && summary.catsWithLeaveUndeclared > 0) {
    issues.push(`${fmtInt(summary.catsWithLeaveUndeclared)} CAT(s) sem declaração de afastamento no atestado.`);
  }
  if (summary.asoUndetermined && summary.asoUndetermined > 0) {
    issues.push(`${fmtInt(summary.asoUndetermined)} trabalhador(es) com ASO cujo tipo de exame não estabelece periodicidade — a validade não é apurável e não deve ser lida como conformidade.`);
  }
  if (summary.workersWithoutAso && summary.workersWithoutAso > 0) {
    issues.push(`${fmtInt(summary.workersWithoutAso)} vínculo(s) ativo(s) sem nenhum ASO no acervo. O exame pode existir e não ter sido baixado: o pacote do eSocial Download tem janela de retenção.`);
  }
  if (!identified) {
    issues.push('Este relatório foi gerado sem permissão de identificação nominal; nomes e CPF foram omitidos.');
  }

  blocks.push(block(sectionTitle('Qualidade dos Dados', undefined, 6),
    mmForSectionTitle(), { breakBefore: true, keepWithNext: true }));
  blocks.push(block(dataQualityBox(issues), mmForWarningBox(Math.max(1, issues.length))));

  return renderReportDocument({
    fileName,
    brand,
    logoUrl: meta.logoUrl,
    footerLabel: `SST / ASO & CAT · ${periodLabel}`,
    pages: composePages(blocks, { orientation: 'landscape' }),
    orientation: 'landscape',
  });
}

export function openSstReport(payload: SstReportPayload): ReportExportResult {
  try {
    return openReport(buildSstReportHtml(payload), { width: 1280, height: 860 });
  } catch (err) {
    return { ok: false, reason: 'error', message: err instanceof Error ? err.message : 'Falha ao gerar o relatório.' };
  }
}
