'use client';

import { useMemo, useState } from 'react';
import { Wallet, Calendar, AlertTriangle, FileBarChart2 } from 'lucide-react';
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
  FinanceDonutChart,
  FinanceStackedBarChart,
  FinanceSCurveChart,
  fmtBRL, fmtPct, fmtCompactBRL,
  type FinancePeriod, type FinanceScenario,
} from '@/components/finance/shared';

type TaxEntry = {
  id: string;
  code: string;
  name: string;
  type: 'federal' | 'estadual' | 'municipal' | 'retencao';
  provisioned: number;
  paid: number;
  dueDate: string;
  reference: string;
  status: FinanceStatus;
  client?: string;
  contract?: string;
  dreImpact: number;
  alert?: string;
};

const ENTRIES: TaxEntry[] = [
  { id: 't1', code: 'PIS',     name: 'PIS sobre faturamento',    type: 'federal',  provisioned: 305_000, paid: 305_000, dueDate: '2026-05-25', reference: '2026-04', status: 'paid',     dreImpact: -305_000 },
  { id: 't2', code: 'COFINS',  name: 'COFINS sobre faturamento', type: 'federal',  provisioned: 1_085_500, paid: 1_085_500, dueDate: '2026-05-25', reference: '2026-04', status: 'paid', dreImpact: -1_085_500 },
  { id: 't3', code: 'ISS',     name: 'ISS — São Paulo',          type: 'municipal', provisioned: 462_000, paid: 0, dueDate: '2026-05-15', reference: '2026-04', status: 'pending', dreImpact: -462_000, alert: 'Vence em 11 dias' },
  { id: 't4', code: 'IRPJ',    name: 'IRPJ — apuração mensal',    type: 'federal',  provisioned: 680_000, paid: 0, dueDate: '2026-05-31', reference: '2026-04', status: 'pending', dreImpact: -680_000 },
  { id: 't5', code: 'CSLL',    name: 'CSLL — apuração mensal',    type: 'federal',  provisioned: 305_300, paid: 0, dueDate: '2026-05-31', reference: '2026-04', status: 'pending', dreImpact: -305_300 },
  { id: 't6', code: 'IRRF',    name: 'IRRF — Banco Iguaçu',       type: 'retencao', provisioned: 79_500,  paid: 79_500, dueDate: '2026-04-20', reference: '2026-04', status: 'paid', client: 'Banco Iguaçu', contract: 'CT-2025-021', dreImpact: 0 },
  { id: 't7', code: 'CSRF',    name: 'CSRF — Mineração Vale Sul', type: 'retencao', provisioned: 215_625, paid: 0, dueDate: '2026-05-20', reference: '2026-04', status: 'overdue', client: 'Mineração Vale Sul', contract: 'CT-2025-098', dreImpact: 0, alert: 'Atrasado 4 dias' },
  { id: 't8', code: 'INSS',    name: 'INSS sobre folha',          type: 'federal',  provisioned: 558_000, paid: 558_000, dueDate: '2026-05-20', reference: '2026-04', status: 'paid', dreImpact: -558_000 },
  { id: 't9', code: 'ICMS',    name: 'ICMS — produtos digitais',  type: 'estadual', provisioned: 142_000, paid: 0, dueDate: '2026-05-22', reference: '2026-04', status: 'review', dreImpact: -142_000, alert: 'Em revisão fiscal' },
];

const TYPE_LABEL: Record<TaxEntry['type'], string> = { federal: 'Federal', estadual: 'Estadual', municipal: 'Municipal', retencao: 'Retenção' };

export default function ImpostosRetencoesPage() {
  const [period, setPeriod] = useState<FinancePeriod>('2026-04');
  const [scenario, setScenario] = useState<FinanceScenario>('realized');
  const [filterType, setFilterType] = useState<string>('');
  const [filterStatus, setFilterStatus] = useState<string>('');
  const [selected, setSelected] = useState<TaxEntry | null>(null);

  const filtered = useMemo(() => ENTRIES.filter((e) => {
    if (filterType && e.type !== filterType) return false;
    if (filterStatus && e.status !== filterStatus) return false;
    return true;
  }), [filterType, filterStatus]);

  const totalProvisioned = filtered.reduce((a, e) => a + e.provisioned, 0);
  const totalPaid = filtered.reduce((a, e) => a + e.paid, 0);
  const totalOpen = totalProvisioned - totalPaid;
  const upcoming = filtered.filter((e) => e.status === 'pending' || e.status === 'review').length;
  const overdue = filtered.filter((e) => e.status === 'overdue').length;
  const dreImpactTotal = filtered.reduce((a, e) => a + e.dreImpact, 0);

  const kpis: KpiItem[] = [
    { id: 'p', label: 'Provisionado', value: totalProvisioned, format: 'compactCurrency', variant: 'info', tintValue: true },
    { id: 'pd', label: 'Pago', value: totalPaid, format: 'compactCurrency', variant: 'success', tintValue: true },
    { id: 'o', label: 'Em aberto', value: totalOpen, format: 'compactCurrency', variant: 'warning', tintValue: true },
    { id: 'u', label: 'A vencer', value: upcoming, variant: 'info', tintValue: true },
    { id: 'ov', label: 'Atrasados', value: overdue, variant: overdue ? 'danger' : 'success', tintValue: true },
    { id: 'dr', label: 'Impacto na DRE', value: dreImpactTotal, format: 'compactCurrency', variant: 'danger', tintValue: true },
  ];

  const byType = (['federal', 'estadual', 'municipal', 'retencao'] as TaxEntry['type'][]).map((t) => ({
    type: t,
    provisioned: ENTRIES.filter((e) => e.type === t).reduce((a, e) => a + e.provisioned, 0),
    paid: ENTRIES.filter((e) => e.type === t).reduce((a, e) => a + e.paid, 0),
  }));

  const calendar = [...filtered]
    .filter((e) => e.status !== 'paid')
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));

  return (
    <HudPageLayout>
      <HudHeader
        title="Impostos & Retenções"
        subtitle="Gestão de provisões, pagamentos, retenções por contrato e impacto na DRE"
        icon={<Wallet className="w-5 h-5" />}
        iconTint="#A855F7"
        breadcrumbs={[{ label: 'Financeiro', href: '/financeiro' }, { label: 'Impostos & Retenções' }]}
      />

      <FinanceFilterBar
        period={period} onPeriodChange={setPeriod}
        scenario={scenario} onScenarioChange={setScenario}
        extra={
          <>
            <HudSelect label="Tipo" size="sm" value={filterType} onChange={setFilterType}
              options={[{ value: '', label: 'Todos' }, ...(['federal', 'estadual', 'municipal', 'retencao'] as TaxEntry['type'][]).map((t) => ({ value: t, label: TYPE_LABEL[t] }))]} />
            <HudSelect label="Status" size="sm" value={filterStatus} onChange={setFilterStatus}
              options={[{ value: '', label: 'Todos' }, { value: 'paid', label: 'Pago' }, { value: 'pending', label: 'Pendente' }, { value: 'review', label: 'Em revisão' }, { value: 'overdue', label: 'Atrasado' }]} />
          </>
        }
        rightSlot={<HudButton variant="ghost" size="sm" leftIcon={<FileBarChart2 className="w-4 h-4" />}>Impacto na DRE</HudButton>}
      />

      <HudKpiStrip kpis={kpis} columns={6} connected align="center" />

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_1fr] gap-4">
        <HudCard>
          <HudCardHeader><HudCardTitle>S-Curve — Exposição tributária acumulada (12m)</HudCardTitle></HudCardHeader>
          <HudCardContent className="p-3">
            <FinanceSCurveChart
              categories={['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']}
              series={[
                { name: 'Provisionado', values: [3_410_000, 3_460_000, 3_510_000, 3_832_300, 0, 0, 0, 0, 0, 0, 0, 0], tone: 'accent', emphasized: true },
                { name: 'Pago',         values: [3_350_000, 3_410_000, 3_460_000, 2_028_000, 0, 0, 0, 0, 0, 0, 0, 0], tone: 'success' },
                { name: 'Orçado',       values: Array(12).fill(3_500_000), tone: 'budget', dashed: true },
              ]}
              height={300}
            />
          </HudCardContent>
        </HudCard>

        <HudCard>
          <HudCardHeader><HudCardTitle>Composição — Tributos do período</HudCardTitle></HudCardHeader>
          <HudCardContent className="p-3">
            <FinanceDonutChart
              data={ENTRIES.map((e, i) => ({
                name: e.code, value: e.provisioned,
                tone: (['accent', 'info', 'success', 'warning', 'danger', 'budget'] as const)[i % 6],
              }))}
              centerLabel="Provisionado"
              centerValue={fmtCompactBRL(totalProvisioned)}
              height={300}
            />
          </HudCardContent>
        </HudCard>
      </div>

      <HudCard>
        <HudCardHeader><HudCardTitle>Provisionado vs Pago — por tipo de tributo</HudCardTitle></HudCardHeader>
        <HudCardContent className="p-3">
          <FinanceStackedBarChart
            categories={byType.map((t) => TYPE_LABEL[t.type])}
            series={[
              { name: 'Pago',         data: byType.map((t) => t.paid), tone: 'success' },
              { name: 'Em aberto',    data: byType.map((t) => t.provisioned - t.paid), tone: 'warning' },
            ]}
            height={260}
          />
        </HudCardContent>
      </HudCard>

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_1fr_1fr] gap-4">
        <HudCard className="xl:col-span-1">
          <HudCardHeader><HudCardTitle>Provisionado vs Pago — barras comparativas</HudCardTitle></HudCardHeader>
          <HudCardContent className="p-3">
            <FinanceBarChart
              categories={byType.map((t) => TYPE_LABEL[t.type])}
              series={[
                { name: 'Provisionado', data: byType.map((t) => t.provisioned), tone: 'info' },
                { name: 'Pago',          data: byType.map((t) => t.paid),         tone: 'success' },
              ]}
              height={260}
            />
          </HudCardContent>
        </HudCard>

        <HudCard className="xl:col-span-1">
          <HudCardHeader>
            <HudCardTitle className="flex items-center gap-2"><Calendar className="w-4 h-4" /> Calendário fiscal</HudCardTitle>
          </HudCardHeader>
          <HudCardContent className="p-4">
            <ul className="divide-y divide-ig-border-subtle/60">
              {calendar.map((e) => (
                <li key={e.id} className="py-2 flex items-start gap-3">
                  <div className="text-center w-12 shrink-0">
                    <div className="text-[10px] uppercase font-mono tracking-[0.12em] text-ig-text-tertiary">
                      {new Date(e.dueDate).toLocaleString('pt-BR', { month: 'short' }).replace('.', '')}
                    </div>
                    <div className="text-[18px] font-semibold leading-none text-ig-text-primary">
                      {new Date(e.dueDate).getDate()}
                    </div>
                  </div>
                  <div className="flex-1 min-w-0">
                    <button onClick={() => setSelected(e)} className="text-[12.5px] font-medium text-ig-text-primary hover:text-ig-accent text-left truncate w-full">
                      {e.code} — {e.name}
                    </button>
                    <div className="text-[10.5px] text-ig-text-tertiary truncate">{TYPE_LABEL[e.type]} • Ref. {e.reference}</div>
                    {e.alert && (
                      <div className="mt-0.5 inline-flex items-center gap-1 text-[10.5px] text-ig-warning">
                        <AlertTriangle className="w-3 h-3" /> {e.alert}
                      </div>
                    )}
                  </div>
                  <div className="text-right">
                    <div className="text-[12px] font-mono tabular-nums">{fmtBRL(e.provisioned)}</div>
                    <FinanceStatusBadge status={e.status} size="xs" />
                  </div>
                </li>
              ))}
            </ul>
          </HudCardContent>
        </HudCard>

        <FinanceInsightCard
          title="Sinais fiscais"
          subtitle="Risco e oportunidades de tributação"
          insights={[
            { id: '1', tone: 'negative', title: 'CSRF atrasado', detail: 'Mineração Vale Sul — retenção atrasada 4 dias, possível multa de 0.33%/dia.', action: { label: 'Regularizar' } },
            { id: '2', tone: 'warning',  title: 'ICMS em revisão', detail: 'Classificação fiscal de produtos digitais sob revisão; risco de R$ 142k.' },
            { id: '3', tone: 'positive', title: 'Lei do Bem em apuração', detail: 'Benefício fiscal estimado em R$ 380k para Q2 — aguardando dossiê P&D.' },
            { id: '4', tone: 'neutral',  title: 'IRRF reconciliado', detail: 'Todas as retenções na fonte do mês conferem com NFs emitidas.' },
          ]}
        />
      </div>

      <HudCard>
        <HudCardHeader><HudCardTitle>Apuração tributária</HudCardTitle></HudCardHeader>
        <HudCardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-ig-border-subtle">
                <tr className="text-[10.5px] uppercase tracking-[0.12em] text-ig-text-tertiary">
                  <th className="text-left px-5 py-3 font-medium">Imposto</th>
                  <th className="text-left px-5 py-3 font-medium">Tipo</th>
                  <th className="text-left px-5 py-3 font-medium">Cliente / Contrato</th>
                  <th className="text-right px-5 py-3 font-medium">Provisionado</th>
                  <th className="text-right px-5 py-3 font-medium">Pago</th>
                  <th className="text-right px-5 py-3 font-medium">Em aberto</th>
                  <th className="text-left px-5 py-3 font-medium">Vencimento</th>
                  <th className="text-left px-5 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((e) => (
                  <tr key={e.id} onClick={() => setSelected(e)} className="border-b border-ig-border-subtle/40 hover:bg-ig-surface-subtle/30 cursor-pointer">
                    <td className="px-5 py-2.5 text-ig-text-primary">
                      <div className="font-medium">{e.code} — {e.name}</div>
                      {e.alert && <div className="text-[10.5px] text-ig-warning inline-flex items-center gap-1 mt-0.5"><AlertTriangle className="w-3 h-3" />{e.alert}</div>}
                    </td>
                    <td className="px-5 py-2.5 text-ig-text-secondary">{TYPE_LABEL[e.type]}</td>
                    <td className="px-5 py-2.5 text-ig-text-secondary">{e.client ? `${e.client}${e.contract ? ` • ${e.contract}` : ''}` : '—'}</td>
                    <td className="text-right px-5 py-2.5 font-mono tabular-nums">{fmtBRL(e.provisioned)}</td>
                    <td className="text-right px-5 py-2.5 font-mono tabular-nums text-ig-text-secondary">{fmtBRL(e.paid)}</td>
                    <td className="text-right px-5 py-2.5 font-mono tabular-nums">{fmtBRL(e.provisioned - e.paid)}</td>
                    <td className="px-5 py-2.5 font-mono text-[11px] text-ig-text-tertiary">{e.dueDate}</td>
                    <td className="px-5 py-2.5"><FinanceStatusBadge status={e.status} /></td>
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
        title={selected ? `${selected.code} — ${selected.name}` : ''}
        subtitle={selected ? `Ref. ${selected.reference} • ${TYPE_LABEL[selected.type]}` : ''}
        metaPills={selected ? [
          { label: `Vence ${selected.dueDate}`, tone: 'info' },
          { label: `Em aberto ${fmtBRL(selected.provisioned - selected.paid)}`, tone: selected.provisioned - selected.paid > 0 ? 'warn' : 'pos' },
          ...(selected.status === 'overdue' ? [{ label: 'Atrasado', tone: 'neg' as const }] : []),
        ] : []}
        primaryActions={
          <>
            <HudButton variant="ghost" size="sm">Anexar guia</HudButton>
            <HudButton variant="primary" size="sm">Registrar pagamento</HudButton>
          </>
        }
      >
        {selected && (
          <>
            <FinanceDrawerSection title="Apuração">
              <FinanceDrawerKeyValue rows={[
                { label: 'Provisionado', value: fmtBRL(selected.provisioned) },
                { label: 'Pago',          value: fmtBRL(selected.paid) },
                { label: 'Em aberto',     value: fmtBRL(selected.provisioned - selected.paid), tone: selected.provisioned - selected.paid > 0 ? 'neg' : 'pos' },
                { label: 'Impacto DRE',   value: fmtBRL(selected.dreImpact), tone: selected.dreImpact < 0 ? 'neg' : 'neutral' },
                { label: 'Tipo',          value: TYPE_LABEL[selected.type] },
                { label: 'Status',        value: selected.status },
              ]} />
            </FinanceDrawerSection>

            {(selected.client || selected.contract) && (
              <FinanceDrawerSection title="Vínculo contratual">
                <p className="text-[12.5px] text-ig-text-secondary leading-snug">
                  Cliente: <span className="text-ig-text-primary">{selected.client}</span>
                  {selected.contract && <> • Contrato: <span className="font-mono">{selected.contract}</span></>}
                </p>
              </FinanceDrawerSection>
            )}

            <FinanceDrawerSection title="Próximos passos">
              <ul className="space-y-1.5 text-[12.5px] text-ig-text-secondary">
                <li>• Conciliar guia gerada com sistema fiscal (Sankhya / SEFAZ).</li>
                <li>• Validar enquadramento e alíquota aplicada.</li>
                <li>• {selected.status === 'overdue' ? 'Calcular multa e juros antes do pagamento.' : 'Anexar comprovante após pagamento.'}</li>
              </ul>
            </FinanceDrawerSection>
          </>
        )}
      </FinanceDetailDrawer>

      {/* Variation footer pill */}
      <div className="text-right text-[10.5px] text-ig-text-tertiary">
        Variação efetiva vs orçada: <span className="font-mono">{fmtPct(((totalProvisioned - 2_900_000) / 2_900_000) * 100)}</span>
      </div>
    </HudPageLayout>
  );
}
