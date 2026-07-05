'use client';

import { useMemo, useState } from 'react';
import { FileText, Send, FileType2, FileSpreadsheet, FileBarChart2, Wand2 } from 'lucide-react';
import {
  HudPageLayout, HudHeader, HudKpiStrip, HudButton,
  HudCard, HudCardHeader, HudCardTitle, HudCardContent,
  type KpiItem,
} from '@/components/hud';
import {
  FinanceFilterBar,
  FinanceInsightCard,
  FinanceStatusBadge, type FinanceStatus,
  FinanceDetailDrawer, FinanceDrawerSection,
  FinanceSparkline,
  FinanceDonutChart,
  FinanceAdvancedWaterfallChart,
  FinanceRadarChart,
  type FinancePeriod, type FinanceScenario,
} from '@/components/finance/shared';
import { ExportReportButton } from '@/components/reports/ExportReportButton';
import { openFinanceBoardReport, type BoardChartSpec, type BoardTemplateSection, type FinanceBoardReportPayload } from '@/lib/reports/modules/finance-board-report';

type Template = {
  id: string;
  code: string;
  title: string;
  description: string;
  audience: string;
  cadence: 'monthly' | 'quarterly' | 'on-demand';
  defaultStatus: FinanceStatus;
  icon: React.ReactNode;
  preview: string[];
};

const TEMPLATES: Template[] = [
  { id: 'tpl-dre',  code: 'BRD-001', title: 'DRE Mensal',                    description: 'Resultado mensal consolidado com bridge e variação vs orçado.',  audience: 'Conselho • Comitê Executivo', cadence: 'monthly',   defaultStatus: 'review', icon: <FileBarChart2 className="w-5 h-5" />,
    preview: [
      'Resultado Líquido Abr/2026: R$ 2.64M (+1.8% vs Orçado)',
      'EBITDA: R$ 4.23M, margem 26.2%',
      'Top 3 ofensores de OPEX e plano de mitigação',
    ] },
  { id: 'tpl-fcst', code: 'BRD-004', title: 'Forecast Trimestral',            description: 'Reforecast Q-rolling com cenários Stress, Optimistic e Board.', audience: 'CEO • CFO • Conselho',         cadence: 'quarterly', defaultStatus: 'draft',  icon: <FileType2 className="w-5 h-5" />,
    preview: [
      'Forecast 12m: receita R$ 19.2M, EBITDA R$ 4.5M',
      'Stress drawdown: −9.3% sob receita −12%',
      'Recomendação de baseline: elevar Board +2.5%',
    ] },
  { id: 'tpl-bvr', code: 'BRD-002',  title: 'Orçado x Realizado',             description: 'Análise de variância YTD por área, linha e centro de custo.',     audience: 'Comitê Executivo',             cadence: 'monthly',   defaultStatus: 'approved', icon: <FileBarChart2 className="w-5 h-5" />,
    preview: [
      '4 linhas em overrun: 1 crítico, 3 atenção',
      'Justificativas formalizadas para 3 linhas',
      'Ação corretiva aberta no PRJ-2026-002',
    ] },
  { id: 'tpl-prj', code: 'BRD-006',  title: 'Margens por Projeto',            description: 'Profitability detalhada por projeto, cliente e contrato.',         audience: 'Comitê de Operações',          cadence: 'monthly',   defaultStatus: 'review', icon: <FileSpreadsheet className="w-5 h-5" />,
    preview: [
      'Margem média da carteira: 30.0%',
      'PRJ-2026-005 lidera margem (33.7%)',
      'PRJ-2026-002 em risco de margem 16.7%',
    ] },
  { id: 'tpl-risk', code: 'BRD-003', title: 'Riscos Financeiros',             description: 'Risk map executivo com exposição cambial, contratual e tributária.', audience: 'Comitê de Risco',              cadence: 'quarterly', defaultStatus: 'pending', icon: <FileText className="w-5 h-5" />,
    preview: [
      'Exposição USD: +5.6% pressão em despesas',
      'Atraso CT-2025-021 (R$ 530k) — cobrança em curso',
      'CSRF Vale Sul atrasado — multa potencial 0.33%/dia',
    ] },
  { id: 'tpl-ir', code: 'BRD-005',   title: 'Earnings Pack — Investidores',   description: 'Pacote para investidores institucionais com KPIs e narrativa.',  audience: 'Investidores Institucionais',  cadence: 'quarterly', defaultStatus: 'draft', icon: <FileType2 className="w-5 h-5" />,
    preview: [
      'ARR contratado: R$ 13.0M (+18% YoY)',
      'Net Revenue Retention: 112%',
      'Cash burn neutralizado em Q1',
    ] },
];

type ReportRun = { id: string; templateId: string; period: string; generatedAt: string; owner: string; status: FinanceStatus; recipients: number };

const RUNS: ReportRun[] = [
  { id: 'r1', templateId: 'tpl-dre',  period: '2026-04', generatedAt: '2026-04-30', owner: 'CFO Office', status: 'approved', recipients: 12 },
  { id: 'r2', templateId: 'tpl-fcst', period: '2026-Q1', generatedAt: '2026-04-08', owner: 'FP&A',       status: 'closed',   recipients: 18 },
  { id: 'r3', templateId: 'tpl-bvr',  period: '2026-04', generatedAt: '2026-05-02', owner: 'FP&A',       status: 'review',   recipients: 8  },
  { id: 'r4', templateId: 'tpl-prj',  period: '2026-04', generatedAt: '2026-05-02', owner: 'CFO Office', status: 'draft',    recipients: 0  },
  { id: 'r5', templateId: 'tpl-risk', period: '2026-Q1', generatedAt: '2026-04-12', owner: 'Risk',       status: 'approved', recipients: 9  },
];

const CADENCE_LABEL: Record<Template['cadence'], string> = { monthly: 'Mensal', quarterly: 'Trimestral', 'on-demand': 'Sob demanda' };

/** Normalized chart descriptor per board template (same figures as the on-screen preview). */
function templateChartSpec(id: string): BoardChartSpec {
  switch (id) {
    case 'tpl-dre':
      return { kind: 'bars', rows: [
        { label: 'Receita Líquida', value: 16_129_800 },
        { label: 'Custo Direto', value: -8_710_400 },
        { label: 'OPEX', value: -3_185_700 },
        { label: 'Resultado Fin.', value: -612_400 },
        { label: 'Impostos', value: -985_300 },
        { label: 'Lucro Líquido', value: 2_636_000 },
      ] };
    case 'tpl-fcst':
      return { kind: 'donut', center: 'R$ 4,5M', slices: [
        { label: 'Receita', value: 19_240_000 },
        { label: 'Custo', value: 11_750_000 },
        { label: 'OPEX', value: 3_005_000 },
        { label: 'Caixa líq.', value: 4_485_000 },
      ] };
    case 'tpl-bvr':
      return { kind: 'donut', center: 'Δ R$ 461k', slices: [
        { label: 'Pessoal direto', value: 290_000 },
        { label: 'Pessoal não aloc.', value: 60_000 },
        { label: 'G&A', value: 33_700 },
        { label: 'Resultado fin.', value: 32_400 },
        { label: 'Impostos', value: 45_300 },
      ] };
    case 'tpl-prj':
      return { kind: 'donut', center: '30,0%', slices: [
        { label: '≥ 30% (saudável)', value: 12_590_000 },
        { label: '15–30% (médio)', value: 5_180_000 },
        { label: '< 15% (baixa)', value: 1_320_000 },
      ] };
    case 'tpl-risk':
      return { kind: 'grouped', valueFmt: 'number',
        labels: ['Câmbio', 'Crédito', 'Tributário', 'Operacional', 'Contratual'],
        series: [
          { name: 'Exposição', values: [62, 45, 38, 30, 70], color: '#B91C1C' },
          { name: 'Mitigação', values: [45, 60, 70, 65, 50], color: '#047857' },
        ] };
    case 'tpl-ir':
    default:
      return { kind: 'trend',
        labels: ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago'],
        series: [{ name: 'Lucro líquido', values: [2_080_000, 2_240_000, 2_410_000, 2_580_000, 2_720_000, 2_870_000, 3_020_000, 3_180_000] }] };
  }
}

const STATUS_LABEL_PT: Record<string, string> = { draft: 'Rascunho', review: 'Em revisão', approved: 'Aprovado', closed: 'Encerrado', pending: 'Pendente' };

export default function RelatoriosDiretoriaPage() {
  const [period, setPeriod] = useState<FinancePeriod>('2026-04');
  const [scenario, setScenario] = useState<FinanceScenario>('realized');
  const [selected, setSelected] = useState<Template | null>(null);
  // Single-select KPI filter (padrão Contratos) sobre o histórico de distribuições.
  const [runFilter, setRunFilter] = useState<'sent' | 'review' | 'draft' | null>(null);

  const stats = useMemo(() => {
    const sent = RUNS.filter((r) => r.status === 'approved' || r.status === 'closed').length;
    const drafts = RUNS.filter((r) => r.status === 'draft').length;
    const review = RUNS.filter((r) => r.status === 'review').length;
    return { sent, drafts, review };
  }, []);

  const visibleRuns = useMemo(() => {
    if (!runFilter) return RUNS;
    if (runFilter === 'sent') return RUNS.filter((r) => r.status === 'approved' || r.status === 'closed');
    return RUNS.filter((r) => r.status === runFilter);
  }, [runFilter]);

  const toggleRunFilter = (key: 'sent' | 'review' | 'draft') =>
    setRunFilter((current) => (current === key ? null : key));

  const kpis: KpiItem[] = [
    { id: 't', label: 'Templates ativos', value: TEMPLATES.length.toString(), variant: 'info', tintValue: true, onClick: () => setRunFilter(null) },
    { id: 's', label: 'Distribuídos no mês', value: stats.sent.toString(), variant: 'success', tintValue: true, onClick: () => toggleRunFilter('sent'), active: runFilter === 'sent' },
    { id: 'r', label: 'Em revisão', value: stats.review.toString(), variant: 'warning', tintValue: true, onClick: () => toggleRunFilter('review'), active: runFilter === 'review' },
    { id: 'd', label: 'Em rascunho', value: stats.drafts.toString(), variant: 'info', tintValue: true, onClick: () => toggleRunFilter('draft'), active: runFilter === 'draft' },
    { id: 'rc', label: 'Destinatários (acum.)', value: RUNS.reduce((a, r) => a + r.recipients, 0).toString(), variant: 'info', tintValue: true, onClick: () => setRunFilter(null) },
  ];

  const toSection = (tpl: Template): BoardTemplateSection => ({
    code: tpl.code,
    title: tpl.title,
    audience: tpl.audience,
    cadence: CADENCE_LABEL[tpl.cadence],
    status: STATUS_LABEL_PT[tpl.defaultStatus] ?? tpl.defaultStatus,
    summaryBullets: tpl.preview,
    chart: templateChartSpec(tpl.id),
  });

  const buildBoardPayload = (only?: Template): FinanceBoardReportPayload => ({
    periodLabel: period,
    scenarioLabel: scenario,
    source: 'demonstração',
    singleTitle: only?.title,
    templates: (only ? [only] : TEMPLATES).map(toSection),
    aiInsights: [
      { tone: 'positive', title: 'Resultado robusto em Abr/2026', detail: 'Lucro líquido R$ 2.64M (+32% YoY), EBITDA margin expansão de 270 bps.' },
      { tone: 'warning', title: 'Pressão em custo direto', detail: 'Mobilização do PRJ-2026-002 e cloud growth +4.6% sobre orçado em CC-001.' },
      { tone: 'neutral', title: 'Pipeline e renovação', detail: 'Pipeline qualificado de R$ 4.8M para Q2/Q3, taxa de renovação 96%.' },
      { tone: 'positive', title: 'Conformidade fiscal', detail: '8 de 9 obrigações pagas no prazo; CSRF Vale Sul em regularização.' },
    ],
    runs: RUNS.map((r) => {
      const tpl = TEMPLATES.find((t) => t.id === r.templateId)!;
      return { title: tpl.title, code: tpl.code, period: r.period, owner: r.owner, generatedAt: r.generatedAt, recipients: r.recipients, status: r.status };
    }),
    nextActions: [
      'Validar dados do período antes de submeter para revisão.',
      'Anexar narrativa CFO e racional de variâncias ≥ 5%.',
      'Submeter para aprovação de comitê executivo.',
      'Distribuir nos canais oficiais (board portal, e-mail).',
    ],
  });

  return (
    <HudPageLayout>
      <HudHeader
        title="Relatórios da Diretoria"
        subtitle="Builder de pacotes executivos com AI summary, status workflow e distribuição"
        icon={<FileText className="w-5 h-5" />}
        iconTint="#0EA5E9"
        breadcrumbs={[{ label: 'Financeiro', href: '/financeiro' }, { label: 'Relatórios da Diretoria' }]}
      />

      <FinanceFilterBar
        period={period} onPeriodChange={setPeriod}
        scenario={scenario} onScenarioChange={setScenario}
        rightSlot={
          <>
            <HudButton variant="ghost" size="sm" leftIcon={<Wand2 className="w-4 h-4" />}>AI summary</HudButton>
            <ExportReportButton
              size="sm"
              variant="primary"
              label="Exportar PDF"
              permission="finance.export"
              fallbackPermission="finance.view"
              build={() => openFinanceBoardReport(buildBoardPayload())}
            />
          </>
        }
      />

      <HudKpiStrip kpis={kpis} columns={5} connected align="center" />

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {TEMPLATES.map((tpl) => {
          const sparkValues =
            tpl.id === 'tpl-dre'  ? [4_120, 4_290, 4_580, 5_550, 5_780, 6_010, 6_240, 6_510]
          : tpl.id === 'tpl-fcst' ? [4_000, 4_200, 4_500, 5_300, 5_600, 5_900, 6_100, 6_400]
          : tpl.id === 'tpl-bvr'  ? [3_910, 3_780, 3_760, 3_700, 4_020, 3_910, 4_440, 4_180]
          : tpl.id === 'tpl-prj'  ? [28, 30, 31, 33, 34, 33, 35, 36]
          : tpl.id === 'tpl-risk' ? [40, 38, 42, 45, 48, 50, 52, 55]
          :                          [12.5, 13.0, 13.4, 13.0, 12.6, 12.9, 13.2, 13.6];
          const tone =
            tpl.id === 'tpl-risk' ? 'danger' :
            tpl.id === 'tpl-bvr'  ? 'warning' :
            tpl.id === 'tpl-fcst' ? 'budget' :
            tpl.id === 'tpl-prj'  ? 'success' :
            'accent';
          return (
            <button
              key={tpl.id}
              type="button"
              onClick={() => setSelected(tpl)}
              className="text-left rounded-xl border border-ig-border-subtle bg-ig-panel/85 backdrop-blur-xl shadow-[0_10px_30px_-15px_rgba(0,0,0,0.45)] hover:border-ig-border-focus transition-colors overflow-hidden"
            >
              <div className="p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="w-9 h-9 rounded-lg flex items-center justify-center bg-ig-accent-weak border border-ig-border-focus text-ig-accent shrink-0">
                    {tpl.icon}
                  </div>
                  <FinanceStatusBadge status={tpl.defaultStatus} size="xs" />
                </div>
                <div className="mt-3">
                  <div className="text-[10.5px] uppercase tracking-[0.12em] text-ig-text-tertiary">{tpl.code} • {CADENCE_LABEL[tpl.cadence]}</div>
                  <h3 className="mt-1 text-[15px] font-semibold text-ig-text-primary leading-tight">{tpl.title}</h3>
                  <p className="mt-1.5 text-[12px] text-ig-text-secondary leading-snug">{tpl.description}</p>
                  <div className="mt-2 text-[10.5px] text-ig-text-tertiary">{tpl.audience}</div>
                </div>
              </div>

              <div className="px-2 -mt-1 pb-1">
                <FinanceSparkline values={sparkValues} tone={tone as any} height={48} />
              </div>

              <div className="px-5 py-2.5 border-t border-ig-border-subtle/60 flex items-center justify-between text-[11px] text-ig-text-secondary">
                <span className="inline-flex items-center gap-1.5"><Wand2 className="w-3 h-3 text-ig-accent" /> AI preview</span>
                <span className="text-ig-accent">Abrir →</span>
              </div>
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[2fr_1fr] gap-4">
        <HudCard>
          <HudCardHeader><HudCardTitle>Histórico de pacotes gerados</HudCardTitle></HudCardHeader>
          <HudCardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-ig-border-subtle">
                  <tr className="text-[10.5px] uppercase tracking-[0.12em] text-ig-text-tertiary">
                    <th className="text-left px-5 py-3 font-medium">Template</th>
                    <th className="text-left px-5 py-3 font-medium">Período</th>
                    <th className="text-left px-5 py-3 font-medium">Owner</th>
                    <th className="text-right px-5 py-3 font-medium">Geração</th>
                    <th className="text-right px-5 py-3 font-medium">Destinatários</th>
                    <th className="text-left px-5 py-3 font-medium">Status</th>
                    <th className="text-right px-5 py-3 font-medium">Exportar</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleRuns.map((r) => {
                    const tpl = TEMPLATES.find((t) => t.id === r.templateId)!;
                    return (
                      <tr key={r.id} className="border-b border-ig-border-subtle/40 hover:bg-ig-surface-subtle/30">
                        <td className="px-5 py-2.5 text-ig-text-primary">
                          <div className="font-medium">{tpl.title}</div>
                          <div className="text-[10.5px] text-ig-text-tertiary">{tpl.code}</div>
                        </td>
                        <td className="px-5 py-2.5 tabular-nums text-[12px] text-ig-text-secondary">{r.period}</td>
                        <td className="px-5 py-2.5 text-ig-text-secondary">{r.owner}</td>
                        <td className="text-right px-5 py-2.5 tabular-nums text-[11px] text-ig-text-tertiary">{r.generatedAt}</td>
                        <td className="text-right px-5 py-2.5 tabular-nums">{r.recipients}</td>
                        <td className="px-5 py-2.5"><FinanceStatusBadge status={r.status} /></td>
                        <td className="text-right px-5 py-2.5">
                          <div className="inline-flex items-center gap-1">
                            <button title="PDF"   className="px-1.5 py-0.5 rounded border border-ig-border-subtle text-[10.5px] text-ig-text-secondary hover:text-ig-text-primary hover:border-ig-border-focus">PDF</button>
                            <button title="Excel" className="px-1.5 py-0.5 rounded border border-ig-border-subtle text-[10.5px] text-ig-text-secondary hover:text-ig-text-primary hover:border-ig-border-focus">XLS</button>
                            <button title="PPT"   className="px-1.5 py-0.5 rounded border border-ig-border-subtle text-[10.5px] text-ig-text-secondary hover:text-ig-text-primary hover:border-ig-border-focus">PPT</button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </HudCardContent>
        </HudCard>

        <FinanceInsightCard
          title="AI Executive Summary"
          subtitle="Preview narrativo do pacote do mês"
          insights={[
            { id: '1', tone: 'positive', title: 'Resultado robusto em Abr/2026', detail: 'Lucro líquido R$ 2.64M (+32% YoY), EBITDA margin expansão de 270 bps.' },
            { id: '2', tone: 'warning',  title: 'Pressão em custo direto', detail: 'Mobilização do PRJ-2026-002 e cloud growth +4.6% sobre orçado em CC-001.' },
            { id: '3', tone: 'neutral',  title: 'Pipeline e renovação', detail: 'Pipeline qualificado de R$ 4.8M para Q2/Q3, taxa de renovação 96%.' },
            { id: '4', tone: 'positive', title: 'Conformidade fiscal', detail: '8 de 9 obrigações pagas no prazo; CSRF Vale Sul em regularização.' },
          ]}
        />
      </div>

      <FinanceDetailDrawer
        open={!!selected}
        onClose={() => setSelected(null)}
        title={selected?.title || ''}
        subtitle={selected ? `${selected.code} • ${CADENCE_LABEL[selected.cadence]} • ${selected.audience}` : ''}
        metaPills={selected ? [
          { label: CADENCE_LABEL[selected.cadence], tone: 'info' },
          { label: selected.defaultStatus, tone: 'neutral' },
        ] : []}
        primaryActions={
          <>
            {selected && (
              <ExportReportButton
                size="sm"
                variant="ghost"
                label="PDF"
                permission="finance.export"
                fallbackPermission="finance.view"
                build={() => openFinanceBoardReport(buildBoardPayload(selected))}
              />
            )}
            <HudButton variant="ghost" size="sm" leftIcon={<FileSpreadsheet className="w-4 h-4" />}>Excel</HudButton>
            <HudButton variant="primary" size="sm" leftIcon={<Send className="w-4 h-4" />}>Distribuir</HudButton>
          </>
        }
      >
        {selected && (
          <>
            <FinanceDrawerSection title="Preview do pacote">
              <div className="rounded-lg border border-ig-border-subtle bg-ig-surface-subtle/40 p-3">
                {selected.id === 'tpl-dre' && (
                  <FinanceAdvancedWaterfallChart
                    height={220}
                    steps={[
                      { label: 'Receita Líq.', value: 16_129_800, type: 'start' },
                      { label: 'Custo Direto', value: -8_710_400 },
                      { label: 'OPEX',         value: -3_185_700 },
                      { label: 'Result. Fin.', value: -612_400 },
                      { label: 'Impostos',     value: -985_300 },
                      { label: 'Lucro Líq.',   value: 2_636_000, type: 'end' },
                    ]}
                  />
                )}
                {selected.id === 'tpl-fcst' && (
                  <FinanceDonutChart
                    height={220}
                    centerLabel="Forecast"
                    centerValue="R$ 4.5M"
                    data={[
                      { name: 'Receita',    value: 19_240_000, tone: 'accent' },
                      { name: 'Custo',      value: 11_750_000, tone: 'danger' },
                      { name: 'OPEX',       value: 3_005_000,  tone: 'warning' },
                      { name: 'Caixa líq.', value: 4_485_000,  tone: 'success' },
                    ]}
                  />
                )}
                {selected.id === 'tpl-bvr' && (
                  <FinanceDonutChart
                    height={220}
                    centerLabel="Δ vs Orçado"
                    centerValue="R$ 461k"
                    data={[
                      { name: 'Pessoal direto',     value: 290_000, tone: 'danger'  },
                      { name: 'Pessoal não aloc.',   value: 60_000,  tone: 'warning' },
                      { name: 'G&A',                value: 33_700,  tone: 'info'    },
                      { name: 'Result. fin.',       value: 32_400,  tone: 'budget'  },
                      { name: 'Impostos',           value: 45_300,  tone: 'accent'  },
                    ]}
                  />
                )}
                {selected.id === 'tpl-prj' && (
                  <FinanceDonutChart
                    height={220}
                    centerLabel="Margem média"
                    centerValue="30.0%"
                    data={[
                      { name: '≥ 30% (saudável)', value: 12_590_000, tone: 'success' },
                      { name: '15–30% (médio)',    value: 5_180_000, tone: 'warning' },
                      { name: '< 15% (baixa)',     value: 1_320_000, tone: 'danger'  },
                    ]}
                  />
                )}
                {selected.id === 'tpl-risk' && (
                  <FinanceRadarChart
                    height={220}
                    indicators={['Câmbio', 'Crédito', 'Tributário', 'Operacional', 'Contratual']}
                    series={[
                      { name: 'Exposição',  values: [62, 45, 38, 30, 70], tone: 'danger' },
                      { name: 'Mitigação',  values: [45, 60, 70, 65, 50], tone: 'success' },
                    ]}
                    max={100}
                  />
                )}
                {selected.id === 'tpl-ir' && (
                  <FinanceSparkline values={[2_080_000, 2_240_000, 2_410_000, 2_580_000, 2_720_000, 2_870_000, 3_020_000, 3_180_000]} tone="success" height={220} />
                )}
              </div>
            </FinanceDrawerSection>

            <FinanceDrawerSection title="AI executive summary">
              <ul className="space-y-2">
                {selected.preview.map((p, idx) => (
                  <li key={idx} className="text-[12.5px] text-ig-text-secondary leading-snug flex items-start gap-2">
                    <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-ig-accent shrink-0" />
                    {p}
                  </li>
                ))}
              </ul>
            </FinanceDrawerSection>

            <FinanceDrawerSection title="Configuração">
              <div className="grid grid-cols-2 gap-3 text-[12px]">
                <div>
                  <div className="text-[10px] uppercase tracking-[0.12em] text-ig-text-tertiary">Período base</div>
                  <div className="text-ig-text-primary">{period}</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-[0.12em] text-ig-text-tertiary">Cenário base</div>
                  <div className="text-ig-text-primary">{scenario}</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-[0.12em] text-ig-text-tertiary">Cadência</div>
                  <div className="text-ig-text-primary">{CADENCE_LABEL[selected.cadence]}</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-[0.12em] text-ig-text-tertiary">Destinatários</div>
                  <div className="text-ig-text-primary">{selected.audience}</div>
                </div>
              </div>
            </FinanceDrawerSection>

            <FinanceDrawerSection title="Próximas ações">
              <ul className="space-y-1.5 text-[12.5px] text-ig-text-secondary">
                <li>• Validar dados do período antes de submeter para revisão.</li>
                <li>• Anexar narrativa CFO e racional de variâncias ≥ 5%.</li>
                <li>• Submeter para aprovação de comitê executivo.</li>
                <li>• Distribuir nos canais oficiais (board portal, e-mail).</li>
              </ul>
            </FinanceDrawerSection>
          </>
        )}
      </FinanceDetailDrawer>
    </HudPageLayout>
  );
}
