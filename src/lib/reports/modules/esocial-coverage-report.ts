/**
 * Pessoas & Custos · Controle eSocial → relatório PDF de cobertura.
 *
 * O documento que se leva a uma auditoria para responder "de onde vieram estes
 * números e o que falta neles". Só layout: tudo chega pronto dos seletores de
 * `src/lib/workforce/esocial-audit.ts`, os mesmos da tela.
 *
 * A linguagem é escolhida com cuidado em dois pontos, e ambos aparecem no
 * texto impresso: competência ausente é ausente NO ACERVO (a janela de
 * retenção do eSocial Download pode simplesmente não a ter trazido), e
 * divergência entre a folha e o eSocial é exposta, nunca julgada.
 */
import { fmtInt } from '@/lib/reports/report-formatters';
import { C, REPORT_BRAND_NAME } from '@/lib/reports/report-theme';
import {
  reportCover, sectionTitle, kpiGrid, dataTable, dataQualityBox, summaryBox,
  type KpiCardSpec,
} from '@/lib/reports/report-blocks';
import {
  composePages, block, mmForCover, mmForKpiGrid,
  mmForSectionTitle, mmForSummary, mmForTable, mmForWarningBox, type ReportBlock,
} from '@/lib/reports/report-compose';
import { renderReportDocument } from '@/lib/reports/report-shell';
import { openReport, buildReportMeta, buildReportFileName } from '@/lib/reports/report-export';
import type { ReportExportResult } from '@/lib/reports/report-types';
import {
  PROC_EMI_LABELS,
  type ClosureRow,
  type CompetenceCoverageRow,
  type DivergenceRow,
  type EventTypeCount,
  type ExclusionRow,
  type OriginRow,
  type RubricGapRow,
  type UnmappedLotacaoRow,
} from '@/lib/workforce/esocial-audit';

const NA = '—';

export interface EsocialCoverageReportPayload {
  competences: CompetenceCoverageRow[];
  missing: string[];
  eventsByType: EventTypeCount[];
  exclusions: ExclusionRow[];
  origins: OriginRow[];
  rubricGaps: RubricGapRow[];
  unmapped: UnmappedLotacaoRow[];
  divergences: DivergenceRow[];
  closures: ClosureRow[];
  brandName?: string;
  generatedBy?: string;
}

function competenceLabel(competence: string): string {
  if (/^\d{4}-13$/.test(competence)) return `13º ${competence.slice(0, 4)}`;
  const [year, month] = competence.split('-').map(Number);
  if (!year || !month) return competence;
  return new Date(year, month - 1, 1).toLocaleDateString('pt-BR', { month: 'short', year: 'numeric' });
}

function brl(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
}

export function buildEsocialCoverageReportHtml(payload: EsocialCoverageReportPayload): string {
  const {
    competences, missing, eventsByType, exclusions, origins, rubricGaps, unmapped, divergences,
  } = payload;

  const brand = payload.brandName ?? REPORT_BRAND_NAME;
  const fileName = buildReportFileName({ module: 'pessoas-custos', context: 'esocial' });

  const imported = competences.filter((c) => c.imported);
  const closed = competences.filter((c) => c.closed);
  const totalEvents = eventsByType.reduce((s, e) => s + e.count, 0);
  const range =
    competences.length > 0
      ? `${competenceLabel(competences[0].competence)} – ${competenceLabel(competences[competences.length - 1].competence)}`
      : 'sem competência apurada';

  const meta = buildReportMeta({
    brand,
    periodLabel: range,
    source: 'eSocial Download (acervo importado)',
    generatedBy: payload.generatedBy,
  });

  const blocks: ReportBlock[] = [];

  blocks.push(block(
    reportCover({
      meta,
      kicker: 'Controle Técnico · eSocial',
      title: 'Cobertura e Auditoria do Acervo',
      context: 'O que está importado, o que falta e o que ainda não pode ser afirmado',
      coverKpis: [
        { label: 'Competências importadas', value: fmtInt(imported.length) },
        { label: 'Faltando no acervo', value: fmtInt(missing.length) },
        { label: 'Eventos', value: fmtInt(totalEvents) },
      ],
    }),
    mmForCover(true),
  ));

  // ── 1. Panorama ──
  const narrative: string[] = [
    `O acervo cobre ${range} e contém ${fmtInt(totalEvents)} evento(s) de ${fmtInt(eventsByType.length)} tipo(s) distinto(s). ${fmtInt(imported.length)} competência(s) foram apuradas e ${fmtInt(closed.length)} têm o evento de fechamento S-1299.`,
  ];
  if (missing.length > 0) {
    narrative.push(
      `${fmtInt(missing.length)} competência(s) estão ausentes dentro do intervalo já coberto. Ausente aqui significa ausente NO ACERVO: o pacote do eSocial Download é entregue dentro de uma janela de retenção, então a lacuna pode ser de download e não de transmissão.`,
    );
  }
  if (closed.length < imported.length) {
    narrative.push(
      'A ausência de S-1299 numa competência não significa que ela esteja aberta — significa apenas que o evento de fechamento não está no acervo. Totalizador não é fechamento.',
    );
  }

  blocks.push(block(sectionTitle('Panorama do Acervo', range, 1), mmForSectionTitle(true), { keepWithNext: true }));
  blocks.push(block(summaryBox(narrative), mmForSummary(narrative), { keepWithNext: true }));

  const kpis: KpiCardSpec[] = [
    { label: 'Competências importadas', value: fmtInt(imported.length), color: C.primary },
    { label: 'Faltando no acervo', value: fmtInt(missing.length), color: missing.length ? C.warning : C.success },
    { label: 'Com fechamento S-1299', value: `${fmtInt(closed.length)}/${fmtInt(imported.length)}`, color: C.primary },
    { label: 'Eventos no acervo', value: fmtInt(totalEvents), color: C.primary },
    { label: 'Rubricas por classificar', value: fmtInt(rubricGaps.length), color: rubricGaps.length ? C.warning : C.success,
      helper: 'competências afetadas' },
    { label: 'Lotações sem centro de custo', value: fmtInt(unmapped.length), color: unmapped.length ? C.warning : C.success },
    { label: 'Exclusões S-3000', value: fmtInt(exclusions.length), color: C.subtle },
    { label: 'Origens distintas', value: fmtInt(origins.length), color: C.subtle, helper: 'procEmi / verProc' },
  ];
  blocks.push(block(kpiGrid(kpis, 4), mmForKpiGrid(kpis.length, 4) + 3));

  // ── 2. Cobertura por competência ──
  blocks.push(block(sectionTitle('Cobertura por Competência', 'Sequência mensal do intervalo coberto', 2),
    mmForSectionTitle(true), { breakBefore: true, keepWithNext: true }));

  blocks.push(block(
    competences.length
      ? dataTable(
          [
            { key: 'competence', label: 'Competência' },
            { key: 'state', label: 'Acervo' },
            { key: 'closed', label: 'Fechamento' },
            { key: 'headcount', label: 'Quadro', num: true },
            { key: 'events', label: 'Eventos', num: true },
            { key: 'totalizers', label: 'Totalizadores' },
          ],
          [...competences].reverse().map((c) => ({
            competence: competenceLabel(c.competence),
            state: c.imported
              ? { html: `<span class="pill ok">Importada</span>` }
              : { html: `<span class="pill warn">Faltando no acervo</span>` },
            closed: c.closed ? 'S-1299' : NA,
            headcount: c.imported ? fmtInt(c.headcount) : NA,
            events: c.eventCount ? fmtInt(c.eventCount) : NA,
            totalizers: c.totalizers.join(' · ') || NA,
          })),
        )
      : '<p class="empty">Nenhuma competência apurada.</p>',
    competences.length ? mmForTable(competences.length, { rowMm: 5.4 }) : 8,
  ));

  // ── 3. Mapeamentos pendentes ──
  if (rubricGaps.length > 0 || unmapped.length > 0) {
    blocks.push(block(sectionTitle('Mapeamentos Pendentes', 'O que impede a composição da folha e o rateio', 3),
      mmForSectionTitle(true), { breakBefore: true, keepWithNext: true }));

    if (rubricGaps.length > 0) {
      blocks.push(block(
        dataTable(
          [
            { key: 'competence', label: 'Competência' },
            { key: 'total', label: 'Declarado', num: true },
            { key: 'mapped', label: 'Classificado', num: true },
            { key: 'gap', label: 'Sem rubrica', num: true },
            { key: 'coverage', label: 'Cobertura', num: true },
          ],
          rubricGaps.map((g) => ({
            competence: competenceLabel(g.competence),
            total: brl(g.totalCents),
            mapped: brl(g.mappedCents),
            gap: { html: `<span style="color:${C.warning}">${brl(g.unmappedCents)}</span>` },
            coverage: `${(g.coverage * 100).toFixed(1)}%`,
          })),
        ),
        mmForTable(rubricGaps.length),
      ));
    }

    if (unmapped.length > 0) {
      blocks.push(block(
        dataTable(
          [
            { key: 'code', label: 'Lotação' },
            { key: 'label', label: 'Descrição' },
            { key: 'comp', label: 'Competências', num: true },
            { key: 'base', label: 'Base apurada', num: true },
          ],
          unmapped.map((l) => ({
            code: l.areaCode,
            label: l.areaLabel,
            comp: fmtInt(l.competences),
            base: brl(l.baseCents || l.grossCents),
          })),
        ),
        mmForTable(unmapped.length),
      ));
    }
  }

  // ── 4. Divergências ──
  if (divergences.length > 0) {
    blocks.push(block(sectionTitle('Divergências Apex × eSocial', 'Exposição da diferença, não julgamento', 4),
      mmForSectionTitle(true), { breakBefore: true, keepWithNext: true }));

    blocks.push(block(
      summaryBox([
        'Divergir não é errar. Rescisão complementar, competência reaberta e trabalhador sem vínculo produzem diferenças legítimas entre a folha fechada internamente e o que foi apurado pelo eSocial. A tabela expõe o par de números para que a diferença possa ser explicada — não a classifica como erro.',
      ]),
      mmForSummary(['x']),
      { keepWithNext: true },
    ));

    blocks.push(block(
      dataTable(
        [
          { key: 'competence', label: 'Competência' },
          { key: 'he', label: 'Quadro eSocial', num: true },
          { key: 'hp', label: 'Quadro folha', num: true },
          { key: 'dh', label: 'Δ quadro', num: true },
          { key: 'ge', label: 'Bruto eSocial', num: true },
          { key: 'gp', label: 'Bruto folha', num: true },
          { key: 'dg', label: 'Δ bruto', num: true },
        ],
        divergences.map((d) => ({
          competence: competenceLabel(d.competence),
          he: fmtInt(d.esocialHeadcount),
          hp: d.payrollHeadcount === null ? NA : fmtInt(d.payrollHeadcount),
          dh: d.headcountDelta === null
            ? NA
            : { html: `<span style="color:${d.headcountDelta === 0 ? C.subtle : C.warning}">${d.headcountDelta > 0 ? '+' : ''}${d.headcountDelta}</span>` },
          ge: d.esocialGrossCents === null ? NA : brl(d.esocialGrossCents),
          gp: d.payrollGrossCents === null ? NA : brl(d.payrollGrossCents),
          dg: d.grossDeltaPct === null
            ? NA
            : { html: `<span style="color:${Math.abs(d.grossDeltaPct) > 5 ? C.warning : C.subtle}">${d.grossDeltaPct > 0 ? '+' : ''}${d.grossDeltaPct.toFixed(1)}%</span>` },
        })),
      ),
      mmForTable(divergences.length, { rowMm: 5.4 }),
    ));
  }

  // ── 5. Eventos, origem e exclusões ──
  blocks.push(block(sectionTitle('Eventos, Origem e Exclusões', 'Composição técnica do acervo', 5),
    mmForSectionTitle(true), { breakBefore: true, keepWithNext: true }));

  blocks.push(block(
    dataTable(
      [
        { key: 'type', label: 'Tipo' },
        { key: 'count', label: 'Eventos', num: true },
        { key: 'comp', label: 'Competências', num: true },
      ],
      eventsByType.map((e) => ({
        type: e.eventType,
        count: fmtInt(e.count),
        comp: fmtInt(e.competences),
      })),
    ),
    mmForTable(eventsByType.length),
  ));

  if (origins.length > 0) {
    blocks.push(block(
      dataTable(
        [
          { key: 'proc', label: 'Emissor' },
          { key: 'ver', label: 'Versão' },
          { key: 'count', label: 'Eventos', num: true },
          { key: 'comp', label: 'Competências', num: true },
        ],
        origins.map((o) => ({
          proc: o.procEmi ? (PROC_EMI_LABELS[o.procEmi] ?? `procEmi ${o.procEmi}`) : 'Não declarado',
          ver: o.verProc ?? NA,
          count: fmtInt(o.count),
          comp: fmtInt(o.competences),
        })),
      ),
      mmForTable(origins.length),
    ));
  }

  // ── 6. Qualidade dos dados ──
  const issues: string[] = [];
  if (missing.length > 0) {
    issues.push(`${fmtInt(missing.length)} competência(s) ausente(s) no acervo: ${missing.slice(0, 12).map(competenceLabel).join(', ')}${missing.length > 12 ? '…' : ''}.`);
  }
  if (closed.length < imported.length) {
    issues.push(`${fmtInt(imported.length - closed.length)} competência(s) sem o evento de fechamento S-1299 no acervo — o que não é o mesmo que competência aberta.`);
  }
  if (rubricGaps.length > 0) {
    const total = rubricGaps.reduce((s, g) => s + g.unmappedCents, 0);
    issues.push(`${brl(total)} declarado(s) no S-1200 sem rubrica classificada na tabela S-1010. Enquanto isso durar, horas extras, benefícios e descontos ficam indisponíveis — não zerados.`);
  }
  if (unmapped.length > 0) {
    issues.push(`${fmtInt(unmapped.length)} lotação(ões) do eSocial sem centro de custo correspondente: o custo apurado por elas não chega ao rateio por projeto.`);
  }
  if (exclusions.some((x) => x.targetStillPresent)) {
    issues.push('Há exclusões S-3000 cujo evento alvo continua no acervo. As contagens por tipo incluem eventos que o eSocial já apagou; as exclusões são reportadas, não aplicadas aos agregados.');
  }
  if (origins.length === 0) {
    issues.push('Nenhuma procedência (procEmi/verProc) registrada: os eventos foram ingeridos antes da auditoria existir. A próxima reapuração do acervo preenche esse campo.');
  }

  blocks.push(block(sectionTitle('Qualidade dos Dados', undefined, 6),
    mmForSectionTitle(), { breakBefore: true, keepWithNext: true }));
  blocks.push(block(dataQualityBox(issues), mmForWarningBox(Math.max(1, issues.length))));

  return renderReportDocument({
    fileName,
    brand,
    logoUrl: meta.logoUrl,
    footerLabel: `Controle eSocial · ${range}`,
    pages: composePages(blocks, { orientation: 'landscape' }),
    orientation: 'landscape',
  });
}

export function openEsocialCoverageReport(payload: EsocialCoverageReportPayload): ReportExportResult {
  try {
    return openReport(buildEsocialCoverageReportHtml(payload), { width: 1280, height: 860 });
  } catch (err) {
    return { ok: false, reason: 'error', message: err instanceof Error ? err.message : 'Falha ao gerar o relatório.' };
  }
}
