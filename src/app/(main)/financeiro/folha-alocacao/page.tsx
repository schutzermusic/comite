'use client';

import { useMemo, useState } from 'react';
import { FileSpreadsheet, RefreshCcw, Plus } from 'lucide-react';
import {
  HudPageLayout, HudHeader, HudKpiStrip, HudButton, HudTabs,
  HudCard, HudCardHeader, HudCardTitle, HudCardContent,
  type KpiItem,
} from '@/components/hud';
import {
  FinanceFilterBar,
  FinanceInsightCard,
  FinanceStatusBadge, type FinanceStatus,
  FinanceDetailDrawer, FinanceDrawerSection, FinanceDrawerKeyValue,
  FinanceDonutChart,
  FinanceStackedBarChart,
  FinanceBubbleChart,
  FinanceSCurveChart,
  fmtBRL, fmtCompactBRL,
  type FinancePeriod, type FinanceScenario,
} from '@/components/finance/shared';

type Batch = { id: string; period: string; bu: string; gross: number; charges: number; benefits: number; headcount: number; status: FinanceStatus };
type Allocation = { project: string; cc: string; allocated: number; effort: number; rate: number };
type Employee = {
  id: string;
  name: string;
  role: string;
  cc: string;
  monthlyCost: number;
  allocations: { project: string; hours: number; pct: number }[];
};

const BATCHES: Batch[] = [
  { id: 'b1', period: '2026-04', bu: 'Tecnologia', gross: 1_240_000, charges: 558_000, benefits: 172_000, headcount: 84, status: 'approved' },
  { id: 'b2', period: '2026-04', bu: 'Operações',  gross: 820_000,   charges: 369_000, benefits: 110_000, headcount: 62, status: 'closed' },
  { id: 'b3', period: '2026-04', bu: 'Comercial',  gross: 510_000,   charges: 229_500, benefits: 71_400,  headcount: 38, status: 'approved' },
  { id: 'b4', period: '2026-04', bu: 'CS',         gross: 320_000,   charges: 144_000, benefits: 44_800,  headcount: 24, status: 'draft' },
  { id: 'b5', period: '2026-04', bu: 'G&A',        gross: 240_000,   charges: 108_000, benefits: 33_600,  headcount: 18, status: 'draft' },
];

const ALLOCATIONS: Allocation[] = [
  { project: 'PRJ-2026-001 — ERP Aurora',          cc: 'CC-001', allocated: 412_000, effort: 1840, rate: 224 },
  { project: 'PRJ-2026-002 — Plataforma de Risco', cc: 'CC-001', allocated: 318_000, effort: 1420, rate: 224 },
  { project: 'PRJ-2026-003 — Data Lake Fênix',     cc: 'CC-001', allocated: 264_000, effort: 1180, rate: 224 },
  { project: 'PRJ-2026-005 — Operations 3D',       cc: 'CC-002', allocated: 575_000, effort: 2750, rate: 209 },
  { project: 'Estrutura — Não alocado',             cc: 'CC-001', allocated: 198_000, effort: 880,  rate: 225 },
];

const EMPLOYEES: Employee[] = [
  { id: 'e1', name: 'Carla Mendes',     role: 'Eng. Mgr',     cc: 'CC-001', monthlyCost: 38_000, allocations: [{ project: 'PRJ-2026-001', hours: 92, pct: 60 }, { project: 'PRJ-2026-003', hours: 60, pct: 40 }] },
  { id: 'e2', name: 'Felipe Araújo',    role: 'Tech Lead',    cc: 'CC-001', monthlyCost: 32_000, allocations: [{ project: 'PRJ-2026-002', hours: 152, pct: 100 }] },
  { id: 'e3', name: 'Renata Souza',     role: 'Senior Eng.',  cc: 'CC-001', monthlyCost: 26_000, allocations: [{ project: 'PRJ-2026-002', hours: 100, pct: 65 }, { project: 'PRJ-2026-003', hours: 52, pct: 35 }] },
  { id: 'e4', name: 'Diego Lopes',      role: 'Senior Eng.',  cc: 'CC-001', monthlyCost: 26_000, allocations: [{ project: 'PRJ-2026-005', hours: 152, pct: 100 }] },
  { id: 'e5', name: 'Beatriz Tavares',  role: 'Data Eng.',    cc: 'CC-001', monthlyCost: 22_000, allocations: [{ project: 'PRJ-2026-003', hours: 120, pct: 78 }, { project: 'Estrutura', hours: 32, pct: 22 }] },
];

const PROJECT_KEYS = Array.from(new Set(EMPLOYEES.flatMap((e) => e.allocations.map((a) => a.project))));

export default function FolhaAlocacaoPage() {
  const [period, setPeriod] = useState<FinancePeriod>('2026-04');
  const [scenario, setScenario] = useState<FinanceScenario>('realized');
  const [tab, setTab] = useState('folha');
  const [selected, setSelected] = useState<Employee | null>(null);

  const totalGross = BATCHES.reduce((a, b) => a + b.gross, 0);
  const totalCharges = BATCHES.reduce((a, b) => a + b.charges, 0);
  const totalBenefits = BATCHES.reduce((a, b) => a + b.benefits, 0);
  const totalHeadcount = BATCHES.reduce((a, b) => a + b.headcount, 0);
  const totalCost = totalGross + totalCharges + totalBenefits;
  const totalAllocated = ALLOCATIONS.reduce((a, x) => a + x.allocated, 0);
  const allocationRate = (totalAllocated / totalCost) * 100;
  const overtimeCost = 88_500;
  const mobilizationCost = 142_000;

  const matrix = useMemo(() => {
    const rows = EMPLOYEES.map((e) => {
      const row: Record<string, number | string> = { id: e.id, name: e.name };
      let total = 0;
      e.allocations.forEach((a) => {
        const cost = e.monthlyCost * (a.pct / 100);
        row[a.project] = cost;
        total += cost;
      });
      row['__total'] = total;
      return row;
    });
    return rows;
  }, []);

  const kpis: KpiItem[] = [
    { id: 'g', label: 'Folha bruta', value: fmtBRL(totalGross), variant: 'info', tintValue: true },
    { id: 'c', label: 'Encargos + Benefícios', value: fmtBRL(totalCharges + totalBenefits), variant: 'warning', tintValue: true },
    { id: 't', label: 'Custo total c/ encargos', value: fmtBRL(totalCost), variant: 'success', tintValue: true },
    { id: 'h', label: 'Headcount', value: totalHeadcount.toString(), variant: 'info', tintValue: true },
    { id: 'r', label: 'Taxa de alocação', value: `${allocationRate.toFixed(1)}%`, variant: allocationRate >= 70 ? 'success' : 'warning', tintValue: true },
    { id: 'o', label: 'Hora extra + Mobilização', value: fmtBRL(overtimeCost + mobilizationCost), variant: 'warning', tintValue: true },
  ];

  return (
    <HudPageLayout>
      <HudHeader
        title="Folha & Alocação"
        subtitle="Custo de força de trabalho por colaborador, projeto e centro de custo, com matriz de alocação"
        icon={<FileSpreadsheet className="w-5 h-5" />}
        iconTint="#14B8A6"
        breadcrumbs={[{ label: 'Financeiro', href: '/financeiro' }, { label: 'Folha & Alocação' }]}
      />

      <FinanceFilterBar
        period={period} onPeriodChange={setPeriod}
        scenario={scenario} onScenarioChange={setScenario}
        rightSlot={
          <>
            <HudButton variant="ghost" size="sm" leftIcon={<RefreshCcw className="w-4 h-4" />}>Recalcular rateio</HudButton>
            <HudButton variant="primary" size="sm" leftIcon={<Plus className="w-4 h-4" />}>Novo lote</HudButton>
          </>
        }
      />

      <HudKpiStrip kpis={kpis} columns={6} connected align="center" />

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <HudCard>
          <HudCardHeader><HudCardTitle>Composição do custo de força de trabalho</HudCardTitle></HudCardHeader>
          <HudCardContent className="p-3">
            <FinanceDonutChart
              data={[
                { name: 'Folha bruta',  value: totalGross,    tone: 'accent'  },
                { name: 'Encargos',     value: totalCharges,  tone: 'warning' },
                { name: 'Benefícios',   value: totalBenefits, tone: 'info'    },
                { name: 'Hora extra',   value: overtimeCost,  tone: 'danger'  },
                { name: 'Mobilização',  value: mobilizationCost, tone: 'budget' },
              ]}
              centerLabel="Total c/ encargos"
              centerValue={fmtCompactBRL(totalCost + overtimeCost + mobilizationCost)}
              height={300}
            />
          </HudCardContent>
        </HudCard>

        <HudCard className="xl:col-span-2">
          <HudCardHeader><HudCardTitle>Stacked — Alocação de custo por projeto × BU</HudCardTitle></HudCardHeader>
          <HudCardContent className="p-3">
            <FinanceStackedBarChart
              categories={['Tecnologia', 'Operações', 'Comercial', 'CS', 'G&A']}
              series={[
                { name: 'PRJ-2026-001 ERP',          tone: 'accent',  data: [412_000, 0, 0, 0, 0] },
                { name: 'PRJ-2026-002 Risco',        tone: 'danger',  data: [318_000, 0, 0, 0, 0] },
                { name: 'PRJ-2026-003 Data Lake',    tone: 'info',    data: [264_000, 0, 0, 0, 0] },
                { name: 'PRJ-2026-005 Operations 3D', tone: 'success', data: [0, 575_000, 0, 0, 0] },
                { name: 'Estrutura / não alocado',   tone: 'budget',  data: [198_000, 245_000, 510_000, 320_000, 240_000] },
              ]}
              height={300}
            />
          </HudCardContent>
        </HudCard>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1.4fr_1fr] gap-4">
        <HudCard>
          <HudCardHeader><HudCardTitle>Bubble — Colaboradores por custo, horas e overtime</HudCardTitle></HudCardHeader>
          <HudCardContent className="p-3">
            <FinanceBubbleChart
              xAxisLabel="Horas alocadas (mês)"
              yAxisLabel="Custo R$/mês"
              xFormatter={(v) => `${v}h`}
              yFormatter={(v) => fmtCompactBRL(v)}
              points={EMPLOYEES.map((e) => {
                const hours = e.allocations.reduce((a, x) => a + x.hours, 0);
                const overtime = hours > 152 ? (hours - 152) : 0;
                return {
                  id: e.id, label: e.name.split(' ')[0],
                  x: hours, y: e.monthlyCost,
                  size: e.monthlyCost * (1 + overtime / 50),
                  tone: overtime > 8 ? 'danger' : overtime > 0 ? 'warning' : 'success',
                  meta: `${e.role} • ${e.cc}`,
                };
              })}
              height={300}
            />
          </HudCardContent>
        </HudCard>

        <HudCard>
          <HudCardHeader><HudCardTitle>S-Curve — Custo de pessoas acumulado (12m)</HudCardTitle></HudCardHeader>
          <HudCardContent className="p-3">
            <FinanceSCurveChart
              categories={['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']}
              series={[
                { name: 'Realizado', values: [3_010_000, 3_080_000, 3_140_000, 3_198_800, 0, 0, 0, 0, 0, 0, 0, 0], tone: 'accent', emphasized: true },
                { name: 'Orçado',    values: Array(12).fill(3_120_000), tone: 'budget', dashed: true },
              ]}
              height={300}
            />
          </HudCardContent>
        </HudCard>
      </div>

      <HudTabs
        activeTab={tab}
        onTabChange={setTab}
        tabs={[
          {
            id: 'folha', label: 'Folha Mensal',
            content: (
              <HudCard>
                <HudCardHeader><HudCardTitle>Lotes de folha — Abril/2026</HudCardTitle></HudCardHeader>
                <HudCardContent className="p-0">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="border-b border-ig-border-subtle">
                        <tr className="text-[10.5px] uppercase tracking-[0.12em] text-ig-text-tertiary">
                          <th className="text-left px-5 py-3 font-medium">Período</th>
                          <th className="text-left px-5 py-3 font-medium">Business Unit</th>
                          <th className="text-right px-5 py-3 font-medium">Bruto</th>
                          <th className="text-right px-5 py-3 font-medium">Encargos</th>
                          <th className="text-right px-5 py-3 font-medium">Benefícios</th>
                          <th className="text-right px-5 py-3 font-medium">HC</th>
                          <th className="text-left px-5 py-3 font-medium">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {BATCHES.map((b) => (
                          <tr key={b.id} className="border-b border-ig-border-subtle/40 hover:bg-ig-surface-subtle/30">
                            <td className="px-5 py-2.5 font-mono text-[12px] text-ig-text-secondary">{b.period}</td>
                            <td className="px-5 py-2.5 text-ig-text-primary">{b.bu}</td>
                            <td className="text-right px-5 py-2.5 font-mono tabular-nums">{fmtBRL(b.gross)}</td>
                            <td className="text-right px-5 py-2.5 font-mono tabular-nums text-ig-text-secondary">{fmtBRL(b.charges)}</td>
                            <td className="text-right px-5 py-2.5 font-mono tabular-nums text-ig-text-secondary">{fmtBRL(b.benefits)}</td>
                            <td className="text-right px-5 py-2.5 font-mono tabular-nums">{b.headcount}</td>
                            <td className="px-5 py-2.5"><FinanceStatusBadge status={b.status} /></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </HudCardContent>
              </HudCard>
            ),
          },
          {
            id: 'aloc', label: 'Alocação por Projeto',
            content: (
              <HudCard>
                <HudCardHeader><HudCardTitle>Custo de pessoas alocado em projetos</HudCardTitle></HudCardHeader>
                <HudCardContent className="p-0">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="border-b border-ig-border-subtle">
                        <tr className="text-[10.5px] uppercase tracking-[0.12em] text-ig-text-tertiary">
                          <th className="text-left px-5 py-3 font-medium">Projeto</th>
                          <th className="text-left px-5 py-3 font-medium">Centro de Custo</th>
                          <th className="text-right px-5 py-3 font-medium">Alocado</th>
                          <th className="text-right px-5 py-3 font-medium">Esforço (h)</th>
                          <th className="text-right px-5 py-3 font-medium">R$/h</th>
                        </tr>
                      </thead>
                      <tbody>
                        {ALLOCATIONS.map((a, idx) => (
                          <tr key={idx} className="border-b border-ig-border-subtle/40 hover:bg-ig-surface-subtle/30">
                            <td className="px-5 py-2.5 text-ig-text-primary">{a.project}</td>
                            <td className="px-5 py-2.5 text-ig-text-secondary">{a.cc}</td>
                            <td className="text-right px-5 py-2.5 font-mono tabular-nums">{fmtBRL(a.allocated)}</td>
                            <td className="text-right px-5 py-2.5 font-mono tabular-nums text-ig-text-secondary">{a.effort.toLocaleString('pt-BR')}</td>
                            <td className="text-right px-5 py-2.5 font-mono tabular-nums">{fmtBRL(a.rate)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </HudCardContent>
              </HudCard>
            ),
          },
          {
            id: 'matrix', label: 'Matriz Colaborador × Projeto',
            content: (
              <HudCard>
                <HudCardHeader><HudCardTitle>Matriz de alocação</HudCardTitle></HudCardHeader>
                <HudCardContent className="p-0">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="border-b border-ig-border-subtle">
                        <tr className="text-[10.5px] uppercase tracking-[0.12em] text-ig-text-tertiary">
                          <th className="text-left px-5 py-3 font-medium sticky left-0 bg-ig-panel z-10">Colaborador</th>
                          {PROJECT_KEYS.map((p) => (
                            <th key={p} className="text-right px-3 py-3 font-medium whitespace-nowrap">{p.split(' — ')[0]}</th>
                          ))}
                          <th className="text-right px-5 py-3 font-medium">Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {matrix.map((r) => {
                          const emp = EMPLOYEES.find((e) => e.id === r.id)!;
                          return (
                            <tr key={r.id as string} onClick={() => setSelected(emp)} className="border-b border-ig-border-subtle/40 hover:bg-ig-surface-subtle/30 cursor-pointer">
                              <td className="px-5 py-2.5 text-ig-text-primary sticky left-0 bg-ig-panel z-10">
                                <div>{r.name}</div>
                                <div className="text-[10.5px] text-ig-text-tertiary">{emp.role} • {emp.cc}</div>
                              </td>
                              {PROJECT_KEYS.map((p) => {
                                const v = (r as any)[p] as number | undefined;
                                const pct = v ? (v / (r['__total'] as number)) * 100 : 0;
                                return (
                                  <td key={p} className="text-right px-3 py-2.5">
                                    {v ? (
                                      <div className="inline-flex flex-col items-end">
                                        <span className="text-[12px] font-mono tabular-nums">{fmtBRL(v)}</span>
                                        <span className="text-[10px] text-ig-text-tertiary">{pct.toFixed(0)}%</span>
                                      </div>
                                    ) : (
                                      <span className="text-ig-text-tertiary">—</span>
                                    )}
                                  </td>
                                );
                              })}
                              <td className="text-right px-5 py-2.5 font-mono tabular-nums">{fmtBRL(r['__total'] as number)}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </HudCardContent>
              </HudCard>
            ),
          },
        ]}
      />

      <FinanceInsightCard
        title="Workforce insights"
        subtitle="Eficiência, mobilização e custo de hora"
        insights={[
          { id: '1', tone: 'warning',  title: 'Hora extra concentrada', detail: `${fmtBRL(overtimeCost)} em hora extra no mês — 78% concentrado em PRJ-2026-002.` },
          { id: '2', tone: 'negative', title: 'Mobilização extra', detail: `${fmtBRL(mobilizationCost)} de custo de mobilização não previsto no orçamento.` },
          { id: '3', tone: 'positive', title: 'Taxa de alocação saudável', detail: `${allocationRate.toFixed(1)}% do custo de pessoas direcionado a projetos faturáveis.` },
          { id: '4', tone: 'neutral',  title: 'Custo médio por hora', detail: 'R$ 218/h (média ponderada) — dentro do range planejado de R$ 200–230/h.' },
        ]}
      />

      <FinanceDetailDrawer
        open={!!selected}
        onClose={() => setSelected(null)}
        title={selected?.name || ''}
        subtitle={selected ? `${selected.role} • ${selected.cc}` : ''}
        metaPills={selected ? [
          { label: `Custo ${fmtBRL(selected.monthlyCost)}/mês`, tone: 'info' },
          { label: `${selected.allocations.length} alocações`, tone: 'neutral' },
        ] : []}
      >
        {selected && (
          <FinanceDrawerSection title="Alocações do mês">
            <ul className="divide-y divide-ig-border-subtle/60">
              {selected.allocations.map((a, idx) => (
                <li key={idx} className="py-2.5 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-[12.5px] text-ig-text-primary truncate">{a.project}</div>
                    <div className="text-[10.5px] text-ig-text-tertiary">{a.hours}h • {a.pct}% do mês</div>
                  </div>
                  <div className="text-right">
                    <div className="text-[12.5px] font-mono tabular-nums">{fmtBRL(selected.monthlyCost * (a.pct / 100))}</div>
                  </div>
                </li>
              ))}
            </ul>
          </FinanceDrawerSection>
        )}
      </FinanceDetailDrawer>
    </HudPageLayout>
  );
}
