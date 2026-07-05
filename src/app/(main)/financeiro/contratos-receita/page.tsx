'use client';

import { useMemo, useState } from 'react';
import { Handshake, Plus, ExternalLink, Calendar, FileSignature, Activity } from 'lucide-react';
import {
  HudPageLayout, HudHeader, HudButton,
  HudCard, HudCardHeader, HudCardTitle, HudCardContent,
} from '@/components/hud';
import {
  FinanceFilterBar, FinanceFilterChip,
  FinanceInsightCard,
  FinanceStatusBadge,
  FinanceDetailDrawer, FinanceDrawerSection, FinanceDrawerKeyValue,
  FinanceSCurveChart,
  FinanceDonutChart,
  FinanceKpiGrid,
  FinanceChartContainer,
  fmtBRL, fmtPct, fmtCompactBRL,
  type FinancePeriod, type FinanceScenario,
} from '@/components/finance/shared';
import {
  CONTRACTS,
  CONTRACT_TYPE_LABEL,
  buildContractsKpis,
  buildRecognitionFunnel,
  type ContractMock,
} from '@/lib/finance';
import { ExportReportButton } from '@/components/reports/ExportReportButton';
import { openFinanceReport, kpiFromHud } from '@/lib/reports/modules/finance-report';

export default function ContratosReceitaPage() {
  const [period, setPeriod] = useState<FinancePeriod>('2026-Q2');
  const [scenario, setScenario] = useState<FinanceScenario>('realized');
  const [filterStatus, setFilterStatus] = useState<string>('');
  const [filterType, setFilterType] = useState<string>('');
  const [selected, setSelected] = useState<ContractMock | null>(null);

  const filtered = useMemo(() => CONTRACTS.filter((c) => {
    if (filterStatus && c.status !== filterStatus) return false;
    if (filterType && c.type !== filterType) return false;
    return true;
  }), [filterStatus, filterType]);

  const kpis = useMemo(() => buildContractsKpis(filtered, '2026-04-30'), [filtered]);
  const funnelStages = useMemo(() => buildRecognitionFunnel(filtered), [filtered]);

  const totalContracted = funnelStages[0]?.value ?? 0;
  const totalMeasured = funnelStages[1]?.value ?? 0;
  const totalInvoiced = funnelStages[2]?.value ?? 0;
  const totalReceived = funnelStages[3]?.value ?? 0;
  const totalBacklog = funnelStages[4]?.value ?? 0;

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
            <FinanceFilterChip
              icon={<FileSignature className="h-3.5 w-3.5" />}
              label="Modelo" value={filterType} onChange={setFilterType}
              options={[{ value: '', label: 'Todos' }, { value: 'recurring', label: 'Recorrente' }, { value: 'fixed', label: 'Escopo fechado' }, { value: 'usage', label: 'Por consumo' }]}
            />
            <FinanceFilterChip
              icon={<Activity className="h-3.5 w-3.5" />}
              label="Status" value={filterStatus} onChange={setFilterStatus}
              options={[{ value: '', label: 'Todos' }, { value: 'active', label: 'Ativo' }, { value: 'pending', label: 'Pendente' }, { value: 'at_risk', label: 'Em risco' }, { value: 'completed', label: 'Concluído' }]}
            />
          </>
        }
        rightSlot={
          <>
            <ExportReportButton
              size="sm"
              variant="primary"
              label="Exportar PDF"
              permission="finance.export"
              fallbackPermission="finance.view"
              build={() => openFinanceReport({
                title: 'Contratos & Receita',
                fileContext: 'contratos-receita',
                periodLabel: period,
                scenarioLabel: scenario,
                context: 'Reconhecimento de receita, faturamento e backlog por contrato',
                kpis: kpis.map((k) => kpiFromHud(k)),
                sections: [{
                  title: 'Funil de Reconhecimento',
                  charts: [{
                    title: 'Contratado → Medido → Faturado → Recebido → Backlog',
                    spec: { kind: 'bars', valueFmt: 'compactCurrency', rows: funnelStages.map((s) => ({ label: s.label, value: s.value })) },
                  }],
                  tables: [{
                    title: 'Contratos',
                    columns: [
                      { key: 'code', label: 'Código' },
                      { key: 'client', label: 'Cliente' },
                      { key: 'type', label: 'Tipo' },
                      { key: 'contracted', label: 'Contratado', num: true },
                      { key: 'invoiced', label: 'Faturado', num: true },
                      { key: 'received', label: 'Recebido', num: true },
                      { key: 'status', label: 'Status' },
                    ],
                    rows: filtered.map((c) => ({
                      code: c.code,
                      client: c.client,
                      type: CONTRACT_TYPE_LABEL[c.type],
                      contracted: { html: `<span class="mono">${fmtBRL(c.contracted)}</span>` },
                      invoiced: { html: `<span class="mono">${fmtBRL(c.invoiced)}</span>` },
                      received: { html: `<span class="mono">${fmtBRL(c.received)}</span>` },
                      status: String(c.status),
                    })),
                  }],
                }],
              })}
            />
            <HudButton variant="ghost" size="sm" leftIcon={<Calendar className="w-4 h-4" />}>Previsão de faturamento</HudButton>
            <HudButton variant="primary" size="sm" leftIcon={<Plus className="w-4 h-4" />}>Novo contrato</HudButton>
          </>
        }
      />

      <FinanceKpiGrid kpis={kpis} columns={6} />

      <div className="grid grid-cols-1 lg:grid-cols-[1.6fr_1fr] gap-4">
        <HudCard>
          <HudCardHeader><HudCardTitle>Funil de reconhecimento de receita</HudCardTitle></HudCardHeader>
          <HudCardContent className="p-5 space-y-2.5">
            {funnelStages.map((s, idx) => {
              const refMax = funnelStages[0].value || 1;
              const widthPct = (s.value / refMax) * 100;
              const conversion = idx === 0 ? 100 : (s.value / funnelStages[0].value) * 100;
              return (
                <div key={s.label}>
                  <div className="flex items-center justify-between mb-1 gap-3 min-w-0">
                    <span className="text-[11.5px] font-medium text-ig-text-secondary truncate">{s.label}</span>
                    <div className="flex items-center gap-3 shrink-0">
                      <span className="text-[11px] tabular-nums text-ig-text-tertiary">{conversion.toFixed(0)}%</span>
                      <span className="text-[12.5px] tabular-nums text-ig-text-primary">{fmtBRL(s.value)}</span>
                    </div>
                  </div>
                  <div className="relative h-2.5 rounded-full bg-ig-surface-subtle overflow-hidden">
                    <div className={'absolute inset-y-0 left-0 ' + s.color + ' opacity-90 transition-[width] duration-500'} style={{ width: `${widthPct}%` }} />
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
            { id: '3', tone: 'positive', title: 'ARR contratado em alta', detail: 'Pipeline de renovação de R$ 1,4M para Q3, taxa de retenção 96%.' },
            { id: '4', tone: 'neutral',  title: 'Backlog R$ 6,0M', detail: 'Backlog representa 35% da receita contratada; cadência atual sustentável.' },
          ]}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1.5fr_1fr] gap-4">
        <HudCard>
          <HudCardHeader><HudCardTitle>S-Curve — Reconhecimento de receita acumulado</HudCardTitle></HudCardHeader>
          <HudCardContent className="p-3">
            <FinanceChartContainer>
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
            </FinanceChartContainer>
          </HudCardContent>
        </HudCard>

        <HudCard>
          <HudCardHeader><HudCardTitle>Receita: estágios atuais</HudCardTitle></HudCardHeader>
          <HudCardContent className="p-3">
            <FinanceChartContainer>
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
            </FinanceChartContainer>
          </HudCardContent>
        </HudCard>
      </div>

      <HudCard>
        <HudCardHeader><HudCardTitle>Carteira contratual</HudCardTitle></HudCardHeader>
        <HudCardContent className="p-0">
          <FinanceChartContainer scrollX>
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
                    <td className="px-5 py-2.5 font-mono text-[12px] text-ig-text-secondary whitespace-nowrap">{c.code}</td>
                    <td className="px-5 py-2.5 text-ig-text-primary whitespace-nowrap">{c.client}</td>
                    <td className="px-5 py-2.5 text-ig-text-secondary whitespace-nowrap">{CONTRACT_TYPE_LABEL[c.type]}</td>
                    <td className="text-right px-5 py-2.5 tabular-nums whitespace-nowrap">{fmtBRL(c.contracted)}</td>
                    <td className="text-right px-5 py-2.5 tabular-nums text-ig-text-secondary whitespace-nowrap">{fmtBRL(c.measured)}</td>
                    <td className="text-right px-5 py-2.5 tabular-nums whitespace-nowrap">{fmtBRL(c.invoiced)}</td>
                    <td className="text-right px-5 py-2.5 tabular-nums text-ig-text-secondary whitespace-nowrap">{fmtBRL(c.received)}</td>
                    <td className={'text-right px-5 py-2.5 tabular-nums whitespace-nowrap ' + (c.delayedDays > 0 ? 'text-ig-danger' : 'text-ig-text-tertiary')}>
                      {c.delayedDays > 0 ? `${c.delayedDays}d` : '—'}
                    </td>
                    <td className="px-5 py-2.5 tabular-nums text-[11px] text-ig-text-tertiary whitespace-nowrap">{c.start} → {c.end}</td>
                    <td className="px-5 py-2.5"><FinanceStatusBadge status={c.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </FinanceChartContainer>
        </HudCardContent>
      </HudCard>

      <FinanceDetailDrawer
        open={!!selected}
        onClose={() => setSelected(null)}
        title={selected?.client || ''}
        subtitle={selected ? `${selected.code} • ${CONTRACT_TYPE_LABEL[selected.type]}` : ''}
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
                      <div className="text-[10.5px] tabular-nums uppercase tracking-[0.12em] text-ig-text-tertiary">{e.date}</div>
                      <div className="text-[13px] text-ig-text-primary">{e.event}</div>
                      {e.amount !== undefined && <div className="text-[12px] tabular-nums text-ig-text-secondary">{fmtBRL(e.amount)}</div>}
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
