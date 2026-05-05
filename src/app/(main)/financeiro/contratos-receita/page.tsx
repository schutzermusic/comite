'use client';

import { useMemo, useState } from 'react';
import { Handshake, Plus, ExternalLink, Calendar, FileSignature } from 'lucide-react';
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
  FinanceSCurveChart,
  FinanceDonutChart,
  fmtBRL, fmtPct, fmtCompactBRL,
  type FinancePeriod, type FinanceScenario,
} from '@/components/finance/shared';

type Contract = {
  id: string;
  code: string;
  client: string;
  type: 'recurring' | 'fixed' | 'usage';
  contracted: number;     // valor total contratado
  measured: number;       // medido
  invoiced: number;       // faturado
  received: number;       // recebido
  mrr: number;
  arr: number;
  start: string;
  end: string;
  status: FinanceStatus;
  delayedDays: number;    // dias atrasados em faturamento
  timeline: { date: string; event: string; amount?: number }[];
};

const CONTRACTS: Contract[] = [
  { id: 'c1', code: 'CT-2025-014', client: 'Grupo Aurora',       type: 'recurring', contracted: 2_208_000, measured: 1_472_000, invoiced: 1_280_000, received: 1_120_000, mrr: 184_000, arr: 2_208_000, start: '2025-08-01', end: '2027-07-31', status: 'active', delayedDays: 0,
    timeline: [
      { date: '2025-08-01', event: 'Início de vigência' },
      { date: '2026-04-30', event: 'Faturamento mensal',  amount: 184_000 },
      { date: '2026-04-15', event: 'Recebimento Mar/2026', amount: 184_000 },
    ]},
  { id: 'c2', code: 'CT-2025-021', client: 'Banco Iguaçu',       type: 'fixed',     contracted: 3_180_000, measured: 1_590_000, invoiced: 1_280_000, received: 980_000, mrr: 0, arr: 3_180_000, start: '2025-10-15', end: '2026-10-14', status: 'at_risk', delayedDays: 18,
    timeline: [
      { date: '2025-10-15', event: 'Assinatura' },
      { date: '2026-03-30', event: 'Marco 2 — entrega',   amount: 530_000 },
      { date: '2026-04-12', event: 'Faturamento Marco 2', amount: 530_000 },
      { date: '2026-04-30', event: 'Recebimento atrasado',},
    ]},
  { id: 'c3', code: 'CT-2026-003', client: 'Fênix Energia',      type: 'recurring', contracted: 1_104_000, measured: 368_000, invoiced: 368_000, received: 368_000, mrr: 92_000, arr: 1_104_000, start: '2026-01-01', end: '2028-12-31', status: 'active', delayedDays: 0,
    timeline: [{ date: '2026-04-30', event: 'Faturamento mensal', amount: 92_000 }] },
  { id: 'c4', code: 'CT-2026-009', client: 'NorteCar',           type: 'usage',     contracted: 462_000, measured: 154_000, invoiced: 138_000, received: 138_000, mrr: 38_500, arr: 462_000, start: '2026-02-01', end: '2027-01-31', status: 'pending', delayedDays: 7,
    timeline: [{ date: '2026-04-25', event: 'Medição mensal — consumo', amount: 38_500 }] },
  { id: 'c5', code: 'CT-2025-098', client: 'Mineração Vale Sul', type: 'fixed',     contracted: 5_750_000, measured: 4_312_500, invoiced: 4_120_000, received: 3_940_000, mrr: 0, arr: 5_750_000, start: '2024-11-01', end: '2026-10-31', status: 'active', delayedDays: 0,
    timeline: [{ date: '2026-04-20', event: 'Marco 4 — entrega', amount: 1_437_500 }] },
  { id: 'c6', code: 'CT-2024-122', client: 'OrionTech',          type: 'recurring', contracted: 324_000, measured: 324_000, invoiced: 324_000, received: 324_000, mrr: 27_000, arr: 324_000, start: '2024-04-01', end: '2025-03-31', status: 'completed', delayedDays: 0, timeline: [] },
];

const TYPE_LABEL: Record<Contract['type'], string> = { recurring: 'Recorrente', fixed: 'Escopo Fechado', usage: 'Por Consumo' };

export default function ContratosReceitaPage() {
  const [period, setPeriod] = useState<FinancePeriod>('2026-Q2');
  const [scenario, setScenario] = useState<FinanceScenario>('realized');
  const [filterStatus, setFilterStatus] = useState<string>('');
  const [filterType, setFilterType] = useState<string>('');
  const [selected, setSelected] = useState<Contract | null>(null);

  const filtered = useMemo(() => CONTRACTS.filter((c) => {
    if (filterStatus && c.status !== filterStatus) return false;
    if (filterType && c.type !== filterType) return false;
    return true;
  }), [filterStatus, filterType]);

  const totalContracted = filtered.reduce((a, c) => a + c.contracted, 0);
  const totalMeasured = filtered.reduce((a, c) => a + c.measured, 0);
  const totalInvoiced = filtered.reduce((a, c) => a + c.invoiced, 0);
  const totalReceived = filtered.reduce((a, c) => a + c.received, 0);
  const totalBacklog = totalContracted - totalMeasured;
  const delayed = filtered.filter((c) => c.delayedDays > 0).length;
  const totalArr = filtered.reduce((a, c) => a + c.arr, 0);
  const totalMrr = filtered.reduce((a, c) => a + c.mrr, 0);

  const kpis: KpiItem[] = [
    { id: 'arr', label: 'ARR contratado', value: fmtBRL(totalArr), variant: 'success', tintValue: true },
    { id: 'mrr', label: 'MRR ativo', value: fmtBRL(totalMrr), variant: 'success', tintValue: true },
    { id: 'inv', label: 'Faturado', value: fmtBRL(totalInvoiced), variant: 'info', tintValue: true },
    { id: 'rec', label: 'Recebido', value: fmtBRL(totalReceived), variant: 'info', tintValue: true },
    { id: 'bk',  label: 'Backlog', value: fmtBRL(totalBacklog), variant: 'warning', tintValue: true },
    { id: 'dl',  label: 'Faturas atrasadas', value: delayed.toString(), variant: delayed > 0 ? 'danger' : 'success', tintValue: true },
  ];

  const funnelStages = [
    { label: 'Contratado', value: totalContracted, color: 'bg-ig-info' },
    { label: 'Medido',     value: totalMeasured, color: 'bg-ig-accent' },
    { label: 'Faturado',   value: totalInvoiced, color: 'bg-emerald-400' },
    { label: 'Recebido',   value: totalReceived, color: 'bg-ig-success' },
    { label: 'Backlog',    value: totalBacklog,  color: 'bg-ig-warning' },
  ];

  return (
    <HudPageLayout>
      <HudHeader
        title="Contratos & Receita"
        subtitle="Reconhecimento de receita por contrato, funil contratual e backlog de faturamento"
        icon={<Handshake className="w-5 h-5" />}
        iconTint="#8B5CF6"
        breadcrumbs={[{ label: 'Financeiro', href: '/financeiro' }, { label: 'Contratos & Receita' }]}
      />

      <FinanceFilterBar
        period={period} onPeriodChange={setPeriod}
        scenario={scenario} onScenarioChange={setScenario}
        extra={
          <>
            <HudSelect label="Modelo" size="sm" value={filterType} onChange={setFilterType}
              options={[{ value: '', label: 'Todos' }, { value: 'recurring', label: 'Recorrente' }, { value: 'fixed', label: 'Escopo fechado' }, { value: 'usage', label: 'Por consumo' }]} />
            <HudSelect label="Status" size="sm" value={filterStatus} onChange={setFilterStatus}
              options={[{ value: '', label: 'Todos' }, { value: 'active', label: 'Ativo' }, { value: 'pending', label: 'Pendente' }, { value: 'at_risk', label: 'Em risco' }, { value: 'completed', label: 'Concluído' }]} />
          </>
        }
        rightSlot={
          <>
            <HudButton variant="ghost" size="sm" leftIcon={<Calendar className="w-4 h-4" />}>Previsão de faturamento</HudButton>
            <HudButton variant="primary" size="sm" leftIcon={<Plus className="w-4 h-4" />}>Novo contrato</HudButton>
          </>
        }
      />

      <HudKpiStrip kpis={kpis} columns={6} connected align="center" />

      <div className="grid grid-cols-1 xl:grid-cols-[1.6fr_1fr] gap-4">
        <HudCard>
          <HudCardHeader><HudCardTitle>Funil de reconhecimento de receita</HudCardTitle></HudCardHeader>
          <HudCardContent className="p-5 space-y-2.5">
            {funnelStages.map((s, idx) => {
              const refMax = funnelStages[0].value || 1;
              const widthPct = (s.value / refMax) * 100;
              const conversion = idx === 0 ? 100 : (s.value / funnelStages[0].value) * 100;
              return (
                <div key={s.label}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[11.5px] font-medium text-ig-text-secondary">{s.label}</span>
                    <div className="flex items-center gap-3">
                      <span className="text-[11px] font-mono tabular-nums text-ig-text-tertiary">{conversion.toFixed(0)}%</span>
                      <span className="text-[12.5px] font-mono tabular-nums text-ig-text-primary">{fmtBRL(s.value)}</span>
                    </div>
                  </div>
                  <div className="relative h-2.5 rounded-full bg-ig-surface-subtle overflow-hidden">
                    <div className={'absolute inset-y-0 left-0 ' + s.color + ' opacity-90'} style={{ width: `${widthPct}%` }} />
                  </div>
                </div>
              );
            })}
          </HudCardContent>
        </HudCard>

        <FinanceInsightCard
          title="Sinais contratuais"
          subtitle="Risco de receita, atrasos e oportunidades"
          insights={[
            { id: '1', tone: 'negative', title: 'Banco Iguaçu — recebimento atrasado', detail: 'CT-2025-021 com 18 dias de atraso no recebimento do Marco 2 (R$ 530k). Acionar cobrança.' },
            { id: '2', tone: 'warning',  title: 'NorteCar — medição parcial', detail: 'CT-2026-009 fatura 7 dias após medição do consumo; revisar SLA.' },
            { id: '3', tone: 'positive', title: 'ARR contratado em alta', detail: 'Pipeline de renovação de R$ 1.4M para Q3, taxa de retenção 96%.' },
            { id: '4', tone: 'neutral',  title: 'Backlog R$ 6.0M', detail: 'Backlog representa 35% da receita contratada; cadência atual sustentável.' },
          ]}
        />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1.5fr_1fr] gap-4">
        <HudCard>
          <HudCardHeader><HudCardTitle>S-Curve — Reconhecimento de receita acumulado</HudCardTitle></HudCardHeader>
          <HudCardContent className="p-3">
            <FinanceSCurveChart
              categories={['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']}
              series={[
                { name: 'Contratado', values: Array(12).fill(totalContracted / 12), tone: 'budget', dashed: true },
                { name: 'Medido',     values: Array(12).fill(0).map((_, i) => i < 4 ? (totalMeasured / 4) : 0), tone: 'accent', emphasized: true },
                { name: 'Faturado',   values: Array(12).fill(0).map((_, i) => i < 4 ? (totalInvoiced / 4) : 0), tone: 'success' },
                { name: 'Recebido',   values: Array(12).fill(0).map((_, i) => i < 4 ? (totalReceived / 4) : 0), tone: 'info' },
              ]}
              height={300}
            />
          </HudCardContent>
        </HudCard>

        <HudCard>
          <HudCardHeader><HudCardTitle>Receita: estágios atuais</HudCardTitle></HudCardHeader>
          <HudCardContent className="p-3">
            <FinanceDonutChart
              data={[
                { name: 'Recebido',   value: totalReceived, tone: 'success' },
                { name: 'Faturado',   value: Math.max(totalInvoiced - totalReceived, 0), tone: 'info' },
                { name: 'Medido',     value: Math.max(totalMeasured - totalInvoiced, 0), tone: 'accent' },
                { name: 'Backlog',    value: totalBacklog, tone: 'warning' },
              ]}
              centerLabel="Contratado"
              centerValue={fmtCompactBRL(totalContracted)}
              height={300}
            />
          </HudCardContent>
        </HudCard>
      </div>

      <HudCard>
        <HudCardHeader><HudCardTitle>Carteira contratual</HudCardTitle></HudCardHeader>
        <HudCardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-ig-border-subtle">
                <tr className="text-[10.5px] uppercase tracking-[0.12em] text-ig-text-tertiary">
                  <th className="text-left px-5 py-3 font-medium">Código</th>
                  <th className="text-left px-5 py-3 font-medium">Cliente</th>
                  <th className="text-left px-5 py-3 font-medium">Modelo</th>
                  <th className="text-right px-5 py-3 font-medium">Contratado</th>
                  <th className="text-right px-5 py-3 font-medium">Medido</th>
                  <th className="text-right px-5 py-3 font-medium">Faturado</th>
                  <th className="text-right px-5 py-3 font-medium">Recebido</th>
                  <th className="text-right px-5 py-3 font-medium">Atraso</th>
                  <th className="text-left px-5 py-3 font-medium">Vigência</th>
                  <th className="text-left px-5 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((c) => (
                  <tr key={c.id} onClick={() => setSelected(c)} className="border-b border-ig-border-subtle/40 hover:bg-ig-surface-subtle/30 cursor-pointer">
                    <td className="px-5 py-2.5 font-mono text-[12px] text-ig-text-secondary">{c.code}</td>
                    <td className="px-5 py-2.5 text-ig-text-primary">{c.client}</td>
                    <td className="px-5 py-2.5 text-ig-text-secondary">{TYPE_LABEL[c.type]}</td>
                    <td className="text-right px-5 py-2.5 font-mono tabular-nums">{fmtBRL(c.contracted)}</td>
                    <td className="text-right px-5 py-2.5 font-mono tabular-nums text-ig-text-secondary">{fmtBRL(c.measured)}</td>
                    <td className="text-right px-5 py-2.5 font-mono tabular-nums">{fmtBRL(c.invoiced)}</td>
                    <td className="text-right px-5 py-2.5 font-mono tabular-nums text-ig-text-secondary">{fmtBRL(c.received)}</td>
                    <td className={'text-right px-5 py-2.5 font-mono tabular-nums ' + (c.delayedDays > 0 ? 'text-ig-danger' : 'text-ig-text-tertiary')}>
                      {c.delayedDays > 0 ? `${c.delayedDays}d` : '—'}
                    </td>
                    <td className="px-5 py-2.5 font-mono text-[11px] text-ig-text-tertiary">{c.start} → {c.end}</td>
                    <td className="px-5 py-2.5"><FinanceStatusBadge status={c.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </HudCardContent>
      </HudCard>

      <FinanceDetailDrawer
        open={!!selected}
        onClose={() => setSelected(null)}
        title={selected?.client || ''}
        subtitle={selected ? `${selected.code} • ${TYPE_LABEL[selected.type]}` : ''}
        metaPills={selected ? [
          { label: `ARR ${fmtBRL(selected.arr)}`, tone: 'info' },
          { label: `Recebido ${fmtPct((selected.received / selected.contracted) * 100)}`, tone: 'pos' },
          ...(selected.delayedDays > 0 ? [{ label: `Atraso ${selected.delayedDays}d`, tone: 'neg' as const }] : []),
        ] : []}
        primaryActions={
          <>
            <HudButton variant="ghost" size="sm" leftIcon={<FileSignature className="w-4 h-4" />}>Ver contrato</HudButton>
            <HudButton variant="primary" size="sm" leftIcon={<ExternalLink className="w-4 h-4" />}>Abrir no módulo</HudButton>
          </>
        }
      >
        {selected && (
          <>
            <FinanceDrawerSection title="Reconhecimento de receita">
              <FinanceDrawerKeyValue rows={[
                { label: 'Contratado',  value: fmtBRL(selected.contracted) },
                { label: 'Medido',      value: fmtBRL(selected.measured) },
                { label: 'Faturado',    value: fmtBRL(selected.invoiced) },
                { label: 'Recebido',    value: fmtBRL(selected.received) },
                { label: 'Backlog',     value: fmtBRL(selected.contracted - selected.measured), tone: 'neutral' },
                { label: 'Restante',    value: fmtBRL(selected.contracted - selected.received), tone: 'neutral' },
              ]} />
            </FinanceDrawerSection>

            <FinanceDrawerSection title="Linha do tempo">
              {selected.timeline.length === 0 ? (
                <p className="text-[12.5px] text-ig-text-tertiary">Sem eventos registrados.</p>
              ) : (
                <ol className="relative pl-4 border-l border-ig-border-subtle space-y-3">
                  {selected.timeline.map((e, i) => (
                    <li key={i} className="relative">
                      <span className="absolute -left-[20px] top-1 w-2 h-2 rounded-full bg-ig-accent" />
                      <div className="text-[10.5px] font-mono uppercase tracking-[0.12em] text-ig-text-tertiary">{e.date}</div>
                      <div className="text-[13px] text-ig-text-primary">{e.event}</div>
                      {e.amount !== undefined && <div className="text-[12px] font-mono tabular-nums text-ig-text-secondary">{fmtBRL(e.amount)}</div>}
                    </li>
                  ))}
                </ol>
              )}
            </FinanceDrawerSection>
          </>
        )}
      </FinanceDetailDrawer>
    </HudPageLayout>
  );
}
