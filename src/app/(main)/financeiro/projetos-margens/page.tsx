'use client';

import { useMemo, useState } from 'react';
import { Target, ExternalLink, FileBarChart2 } from 'lucide-react';
import {
  HudPageLayout, HudHeader, HudKpiStrip, HudButton, HudSelect,
  HudCard, HudCardHeader, HudCardTitle, HudCardContent,
  type KpiItem,
} from '@/components/hud';
import {
  FinanceFilterBar,
  FinanceInsightCard,
  FinanceStatusBadge, type FinanceStatus,
  FinanceDetailDrawer, FinanceDrawerSection, FinanceDrawerKeyValue,
  FinanceBarChart,
  FinanceRankMatrix,
  FinanceSCurveChart,
  FinanceDonutChart,
  fmtBRL, fmtPct, fmtCompactBRL,
  type FinancePeriod, type FinanceScenario,
} from '@/components/finance/shared';

type Project = {
  id: string;
  code: string;
  name: string;
  client: string;
  status: FinanceStatus;
  health: number;
  contracted: number;
  invoiced: number;
  cost: number;
  forecastCost: number;
  risks: string[];
};

const PROJECTS: Project[] = [
  { id: 'p1', code: 'PRJ-2026-001', name: 'Implantação ERP — Fase II',         client: 'Grupo Aurora',     status: 'active',    health: 88, contracted: 4_200_000, invoiced: 2_520_000, cost: 2_910_000, forecastCost: 3_080_000, risks: ['Escopo aditivo em discussão'] },
  { id: 'p2', code: 'PRJ-2026-002', name: 'Plataforma de Risco',               client: 'Banco Iguaçu',     status: 'at_risk',   health: 62, contracted: 3_180_000, invoiced: 1_590_000, cost: 2_650_000, forecastCost: 2_880_000, risks: ['Mobilização extra', 'Penalidade contratual', 'Schedule slip Q2'] },
  { id: 'p3', code: 'PRJ-2026-003', name: 'Modernização Data Lake',            client: 'Fênix Energia',    status: 'active',    health: 91, contracted: 2_640_000, invoiced: 1_320_000, cost: 1_790_000, forecastCost: 1_840_000, risks: [] },
  { id: 'p4', code: 'PRJ-2026-004', name: 'Compliance LGPD/SOX',               client: 'NorteCar',         status: 'pending',   health: 71, contracted: 1_980_000, invoiced: 0,         cost: 1_650_000, forecastCost: 1_720_000, risks: ['Aguardando aprovação do projeto'] },
  { id: 'p5', code: 'PRJ-2026-005', name: 'Insight Operations 3D',             client: 'Mineração Vale Sul', status: 'active',  health: 94, contracted: 5_750_000, invoiced: 4_312_500, cost: 3_810_000, forecastCost: 3_910_000, risks: [] },
  { id: 'p6', code: 'PRJ-2025-098', name: 'Squad Outsourcing — Q4',            client: 'OrionTech',        status: 'completed', health: 48, contracted: 1_320_000, invoiced: 1_320_000, cost: 1_390_000, forecastCost: 1_390_000, risks: ['Margem negativa — projeto encerrado com déficit'] },
];

export default function ProjetosMargensPage() {
  const [period, setPeriod] = useState<FinancePeriod>('2026-Q2');
  const [scenario, setScenario] = useState<FinanceScenario>('realized');
  const [filterStatus, setFilterStatus] = useState<string>('');
  const [filterMargin, setFilterMargin] = useState<string>('');
  const [filterClient, setFilterClient] = useState<string>('');
  type EnrichedProject = Project & { margin: number; marginPct: number; fcstMargin: number; fcstMarginPct: number };
  const [selected, setSelected] = useState<EnrichedProject | null>(null);

  const enriched: EnrichedProject[] = PROJECTS.map((p) => {
    const margin = p.contracted - p.cost;
    const marginPct = (margin / p.contracted) * 100;
    const fcstMargin = p.contracted - p.forecastCost;
    const fcstMarginPct = (fcstMargin / p.contracted) * 100;
    return { ...p, margin, marginPct, fcstMargin, fcstMarginPct };
  });

  const filtered = useMemo(() => enriched.filter((p) => {
    if (filterStatus && p.status !== filterStatus) return false;
    if (filterClient && p.client !== filterClient) return false;
    if (filterMargin === 'high'    && p.marginPct < 30) return false;
    if (filterMargin === 'mid'     && (p.marginPct >= 30 || p.marginPct < 15)) return false;
    if (filterMargin === 'low'     && p.marginPct >= 15) return false;
    return true;
  }), [enriched, filterStatus, filterClient, filterMargin]);

  const totalRev = filtered.reduce((a, p) => a + p.contracted, 0);
  const totalCost = filtered.reduce((a, p) => a + p.cost, 0);
  const totalMargin = totalRev - totalCost;
  const avgMargin = totalRev > 0 ? (totalMargin / totalRev) * 100 : 0;
  const atRisk = filtered.filter((p) => p.status === 'at_risk').length;

  const kpis: KpiItem[] = [
    { id: 'n', label: 'Projetos no filtro', value: filtered.length.toString(), variant: 'info', tintValue: true },
    { id: 'r', label: 'Receita contratada', value: fmtBRL(totalRev), variant: 'success', tintValue: true },
    { id: 'c', label: 'Custo realizado', value: fmtBRL(totalCost), variant: 'warning', tintValue: true },
    { id: 'm', label: 'Margem total', value: fmtBRL(totalMargin), variant: 'success', tintValue: true },
    { id: 'p', label: 'Margem média', value: `${avgMargin.toFixed(1)}%`, variant: 'success', tintValue: true },
    { id: 'a', label: 'Em risco', value: atRisk.toString(), variant: atRisk ? 'danger' : 'success', tintValue: true },
  ];

  const ranking = [...enriched].sort((a, b) => b.marginPct - a.marginPct);
  const rankCats = ranking.map((p) => p.code);
  const rankSeries = [{
    name: 'Margem %',
    data: ranking.map((p) => Math.round(p.marginPct * 10) / 10),
    tone: 'accent' as const,
  }];

  const clients = Array.from(new Set(PROJECTS.map((p) => p.client)));

  return (
    <HudPageLayout>
      <HudHeader
        title="Projetos & Margens"
        subtitle="Performance financeira por projeto — receita contratada, custo realizado, forecast e margem"
        icon={<Target className="w-5 h-5" />}
        iconTint="#10B981"
        breadcrumbs={[{ label: 'Financeiro', href: '/financeiro' }, { label: 'Projetos & Margens' }]}
      />

      <FinanceFilterBar
        period={period} onPeriodChange={setPeriod}
        scenario={scenario} onScenarioChange={setScenario}
        extra={
          <>
            <HudSelect label="Cliente" size="sm" value={filterClient} onChange={setFilterClient}
              options={[{ value: '', label: 'Todos' }, ...clients.map((c) => ({ value: c, label: c }))]} />
            <HudSelect label="Status" size="sm" value={filterStatus} onChange={setFilterStatus}
              options={[{ value: '', label: 'Todos' }, { value: 'active', label: 'Ativo' }, { value: 'at_risk', label: 'Em risco' }, { value: 'completed', label: 'Concluído' }, { value: 'pending', label: 'Pendente' }]} />
            <HudSelect label="Margem" size="sm" value={filterMargin} onChange={setFilterMargin}
              options={[{ value: '', label: 'Todas' }, { value: 'high', label: '≥ 30%' }, { value: 'mid', label: '15–30%' }, { value: 'low', label: '< 15%' }]} />
          </>
        }
      />

      <HudKpiStrip kpis={kpis} columns={6} connected align="center" />

      <HudCard>
        <HudCardHeader>
          <HudCardTitle>Ranking de margem por projeto</HudCardTitle>
        </HudCardHeader>
        <HudCardContent className="p-3">
          <FinanceRankMatrix
            mode="progress"
            sort="desc"
            headers={{ rank: 'Rank', label: 'Projeto', bar: 'Margem %', secondary: 'Receita / Custo' }}
            valueFormatter={(v) => `${v.toFixed(1)}%`}
            axisFormatter={(v) => `${v.toFixed(0)}%`}
            rows={enriched.map((p) => ({
              id: p.id,
              label: `${p.code} ${p.name}`,
              meta: `${p.client} • Health ${p.health}`,
              value: Math.round(p.marginPct * 10) / 10,
              benchmark: 25,
              tone: (p.marginPct >= 30 ? 'success' : p.marginPct >= 15 ? 'warning' : 'danger') as 'success' | 'warning' | 'danger',
              secondaryLabel: 'Receita / Custo',
              secondary: `${fmtCompactBRL(p.contracted)} / ${fmtCompactBRL(p.cost)}`,
            }))}
          />
        </HudCardContent>
      </HudCard>

      <div className="grid grid-cols-1 xl:grid-cols-[1.4fr_1fr] gap-4">
        <HudCard>
          <HudCardHeader><HudCardTitle>Ranking de margem por projeto</HudCardTitle></HudCardHeader>
          <HudCardContent className="p-3">
            <FinanceBarChart categories={rankCats} series={rankSeries} horizontal height={280} />
          </HudCardContent>
        </HudCard>

        <FinanceInsightCard
          title="Insights de portfólio"
          subtitle="Sinais financeiros e de risco entre projetos"
          insights={[
            { id: '1', tone: 'positive', title: 'Insight Operations 3D lidera margem', detail: 'PRJ-2026-005 com margem 33.7%, principal contribuidor de EBITDA do trimestre.' },
            { id: '2', tone: 'negative', title: 'PRJ-2026-002 em risco', detail: 'Health 62 e mobilização adicional pressionam margem para 16.7%; reavaliar margem-alvo.' },
            { id: '3', tone: 'warning',  title: 'Squad Outsourcing Q4 com déficit', detail: 'PRJ-2025-098 fechou com margem negativa (–5.3%) — não renovar nesse formato.' },
            { id: '4', tone: 'neutral',  title: 'Forecast cost vs Realizado', detail: 'Variação média entre forecast e custo de +3.4%; cadência de reforecast quinzenal recomendada.' },
          ]}
        />
      </div>

      <HudCard>
        <HudCardHeader><HudCardTitle>Margem por projeto</HudCardTitle></HudCardHeader>
        <HudCardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-ig-border-subtle">
                <tr className="text-[10.5px] uppercase tracking-[0.12em] text-ig-text-tertiary">
                  <th className="text-left px-5 py-3 font-medium">Código</th>
                  <th className="text-left px-5 py-3 font-medium">Projeto</th>
                  <th className="text-left px-5 py-3 font-medium">Cliente</th>
                  <th className="text-right px-5 py-3 font-medium">Receita</th>
                  <th className="text-right px-5 py-3 font-medium">Custo</th>
                  <th className="text-right px-5 py-3 font-medium">Margem %</th>
                  <th className="text-right px-5 py-3 font-medium">Forecast %</th>
                  <th className="text-right px-5 py-3 font-medium">Health</th>
                  <th className="text-left px-5 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((p) => {
                  const tone = p.marginPct >= 30 ? 'text-ig-success' : p.marginPct >= 15 ? 'text-ig-warning' : 'text-ig-danger';
                  return (
                    <tr key={p.id} onClick={() => setSelected(p)} className="border-b border-ig-border-subtle/40 hover:bg-ig-surface-subtle/30 cursor-pointer">
                      <td className="px-5 py-2.5 font-mono text-[12px] text-ig-text-secondary">{p.code}</td>
                      <td className="px-5 py-2.5 text-ig-text-primary">{p.name}</td>
                      <td className="px-5 py-2.5 text-ig-text-secondary">{p.client}</td>
                      <td className="text-right px-5 py-2.5 font-mono tabular-nums">{fmtBRL(p.contracted)}</td>
                      <td className="text-right px-5 py-2.5 font-mono tabular-nums text-ig-text-secondary">{fmtBRL(p.cost)}</td>
                      <td className={'text-right px-5 py-2.5 font-mono tabular-nums ' + tone}>{p.marginPct.toFixed(1)}%</td>
                      <td className="text-right px-5 py-2.5 font-mono tabular-nums text-ig-text-secondary">{p.fcstMarginPct.toFixed(1)}%</td>
                      <td className="text-right px-5 py-2.5">
                        <div className="inline-flex items-center gap-2">
                          <div className="w-16 h-1.5 rounded-full bg-ig-surface-subtle overflow-hidden">
                            <div className={'h-full ' + (p.health >= 80 ? 'bg-ig-success' : p.health >= 60 ? 'bg-ig-warning' : 'bg-ig-danger')} style={{ width: `${p.health}%` }} />
                          </div>
                          <span className="text-[11px] font-mono text-ig-text-secondary">{p.health}</span>
                        </div>
                      </td>
                      <td className="px-5 py-2.5"><FinanceStatusBadge status={p.status} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </HudCardContent>
      </HudCard>

      <FinanceDetailDrawer
        open={!!selected}
        onClose={() => setSelected(null)}
        title={selected?.name || ''}
        subtitle={selected ? `${selected.code} • ${selected.client}` : ''}
        metaPills={selected ? [
          { label: `Margem ${selected.marginPct.toFixed(1)}%`, tone: selected.marginPct >= 30 ? 'pos' : selected.marginPct >= 15 ? 'warn' : 'neg' },
          { label: `Health ${selected.health}`, tone: selected.health >= 80 ? 'pos' : selected.health >= 60 ? 'warn' : 'neg' },
        ] : []}
        primaryActions={
          <>
            <HudButton variant="ghost" size="sm" leftIcon={<FileBarChart2 className="w-4 h-4" />}>DRE do projeto</HudButton>
            <HudButton variant="primary" size="sm" leftIcon={<ExternalLink className="w-4 h-4" />}>Abrir projeto</HudButton>
          </>
        }
      >
        {selected && (
          <>
            <FinanceDrawerSection title="Composição financeira">
              <FinanceDrawerKeyValue rows={[
                { label: 'Receita contratada', value: fmtBRL(selected.contracted) },
                { label: 'Faturado',            value: fmtBRL(selected.invoiced) },
                { label: 'Custo direto',        value: fmtBRL(selected.cost) },
                { label: 'Custo previsto',      value: fmtBRL(selected.forecastCost) },
                { label: 'Margem realizada',    value: fmtBRL(selected.contracted - selected.cost), tone: selected.contracted - selected.cost >= 0 ? 'pos' : 'neg' },
                { label: 'Margem forecast',     value: fmtBRL(selected.contracted - selected.forecastCost), tone: selected.contracted - selected.forecastCost >= 0 ? 'pos' : 'neg' },
              ]} />
            </FinanceDrawerSection>

            <FinanceDrawerSection title="Risk register">
              {selected.risks.length === 0 ? (
                <p className="text-[12.5px] text-ig-text-tertiary">Nenhum risco financeiro mapeado.</p>
              ) : (
                <ul className="space-y-1.5">
                  {selected.risks.map((r, i) => (
                    <li key={i} className="text-[12.5px] text-ig-text-secondary flex items-start gap-2">
                      <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-ig-danger shrink-0" />
                      {r}
                    </li>
                  ))}
                </ul>
              )}
            </FinanceDrawerSection>

            <FinanceDrawerSection title="S-Curve do projeto — Custo planejado vs realizado vs forecast">
              <FinanceSCurveChart
                categories={['M1', 'M2', 'M3', 'M4', 'M5', 'M6', 'M7', 'M8']}
                series={[
                  { name: 'Planejado', values: Array(8).fill(selected.forecastCost / 8), tone: 'budget', dashed: true },
                  { name: 'Realizado', values: [selected.cost * 0.08, selected.cost * 0.11, selected.cost * 0.14, selected.cost * 0.16, selected.cost * 0.18, selected.cost * 0.16, selected.cost * 0.10, selected.cost * 0.07], tone: 'accent', emphasized: true },
                  { name: 'Forecast',  values: [selected.forecastCost * 0.08, selected.forecastCost * 0.11, selected.forecastCost * 0.13, selected.forecastCost * 0.15, selected.forecastCost * 0.16, selected.forecastCost * 0.16, selected.forecastCost * 0.12, selected.forecastCost * 0.09], tone: 'success' },
                ]}
                height={220}
                showArea={false}
              />
            </FinanceDrawerSection>

            <FinanceDrawerSection title="Composição de custo do projeto">
              <FinanceDonutChart
                data={[
                  { name: 'Pessoal alocado', value: selected.cost * 0.62, tone: 'danger' },
                  { name: 'Subcontratação',  value: selected.cost * 0.16, tone: 'warning' },
                  { name: 'Cloud / Infra',   value: selected.cost * 0.14, tone: 'info' },
                  { name: 'Materiais',       value: selected.cost * 0.05, tone: 'budget' },
                  { name: 'Outros',          value: selected.cost * 0.03, tone: 'accent' },
                ]}
                centerLabel="Custo total"
                centerValue={fmtCompactBRL(selected.cost)}
                height={220}
              />
            </FinanceDrawerSection>

            <FinanceDrawerSection title="Forecast vs Realizado">
              <p className="text-[12.5px] text-ig-text-secondary leading-snug">
                Variação entre custo previsto e realizado: {fmtPct(((selected.cost - selected.forecastCost) / selected.forecastCost) * 100)}.
                {selected.cost > selected.forecastCost ? ' Pressão sobre margem; recomenda revisar mobilização.' : ' Custo dentro do esperado.'}
              </p>
            </FinanceDrawerSection>
          </>
        )}
      </FinanceDetailDrawer>
    </HudPageLayout>
  );
}
