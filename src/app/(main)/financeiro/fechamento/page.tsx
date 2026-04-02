'use client';

import { useState, useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { Lock, CheckCircle, XCircle, ShieldCheck, AlertTriangle, TrendingUp } from 'lucide-react';
import ReactECharts from 'echarts-for-react';
import {
  HudPageLayout, HudHeader, HudPanel, HudButton, HudStatusPill,
  HudSelect, HudTable, HudModal, HudInput,
  type HudTableColumn,
} from '@/components/hud';
import {
  getPeriodCloses, getPeriodClose, getCloseChecklist,
  softClosePeriod, hardClosePeriod, formatBRL, formatCompactBRL,
} from '@/lib/finance/finance-store';
import type { PeriodClose, PnLSnapshot } from '@/lib/types/finance';

const STATUS_VARIANTS: Record<string, string> = { open: 'info', soft_close: 'warning', closed: 'completed' };
const STATUS_LABELS: Record<string, string> = { open: 'Aberto', soft_close: 'Fechamento Parcial', closed: 'Fechado' };

export default function FechamentoPage() {
  const t = useTranslations('finance');
  const [selectedPeriod, setSelectedPeriod] = useState('2026-03');
  const [confirmModalOpen, setConfirmModalOpen] = useState(false);
  const [closeType, setCloseType] = useState<'soft' | 'hard'>('soft');
  const [notes, setNotes] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const periods = useMemo(() => getPeriodCloses(), [refreshKey]);
  const currentPeriod = useMemo(() => getPeriodClose(selectedPeriod), [selectedPeriod, refreshKey]);
  const checklist = useMemo(() => getCloseChecklist(selectedPeriod), [selectedPeriod, refreshKey]);

  const allReady = Object.values(checklist).every(Boolean);

  const checklistItems = [
    { key: 'allEntriesPosted', label: t('allEntriesPosted'), ok: checklist.allEntriesPosted },
    { key: 'payrollPosted', label: t('payrollPosted'), ok: checklist.payrollPosted },
    { key: 'allocationsPosted', label: t('allocationsPosted'), ok: checklist.allocationsPosted },
    { key: 'noPendingEntries', label: t('noPendingEntries'), ok: checklist.noPendingEntries },
    { key: 'allEvidenceProvided', label: t('allEvidenceProvided'), ok: checklist.allEvidenceProvided },
  ];

  const periodColumns: HudTableColumn<PeriodClose>[] = [
    { key: 'period_key', header: t('period'), cell: (p) => <span className="text-white/80 text-xs font-mono">{p.period_key}</span> },
    { key: 'status', header: 'Status', cell: (p) => <HudStatusPill variant={STATUS_VARIANTS[p.status] as any} size="sm">{STATUS_LABELS[p.status]}</HudStatusPill> },
    { key: 'soft_closed_at', header: t('softClose'), cell: (p) => <span className="text-white/50 text-xs font-mono">{p.soft_closed_at?.slice(0, 10) || '—'}</span> },
    { key: 'closed_at', header: t('hardClose'), cell: (p) => <span className="text-white/50 text-xs font-mono">{p.closed_at?.slice(0, 10) || '—'}</span> },
    { key: 'snapshot', header: 'Snapshot', cell: (p) => p.snapshot_json ? (
      <span className="text-emerald-400 text-xs">Resultado: {formatBRL(p.snapshot_json.net_result)}</span>
    ) : <span className="text-white/30 text-xs">—</span> },
  ];

  const handleClose = () => {
    if (closeType === 'soft') {
      softClosePeriod(selectedPeriod);
    } else {
      hardClosePeriod(selectedPeriod);
    }
    setConfirmModalOpen(false);
    setRefreshKey(k => k + 1);
  };

  return (
    <HudPageLayout>
      <HudHeader
        title={t('periodClose')}
        icon={<Lock className="w-5 h-5" />}
        breadcrumbs={[{ label: t('title'), href: '/financeiro' }, { label: t('periodClose') }]}
        actions={
          <HudSelect label="" value={selectedPeriod} onChange={setSelectedPeriod} size="sm"
            options={[
              { value: '2026-01', label: 'Jan/2026' },
              { value: '2026-02', label: 'Fev/2026' },
              { value: '2026-03', label: 'Mar/2026' },
            ]}
          />
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-4">
        {/* Checklist */}
        <HudPanel title={t('closeChecklist')} icon={<ShieldCheck className="w-4 h-4" />}>
          <div className="space-y-3">
            {checklistItems.map((item) => (
              <div key={item.key} className="flex items-center gap-3 py-2 px-3 rounded-lg bg-white/[0.02] border border-white/[0.04]">
                {item.ok ? (
                  <CheckCircle className="w-5 h-5 text-emerald-400 shrink-0" />
                ) : (
                  <XCircle className="w-5 h-5 text-red-400 shrink-0" />
                )}
                <span className={`text-sm ${item.ok ? 'text-white/70' : 'text-red-300'}`}>{item.label}</span>
              </div>
            ))}

            <div className="pt-4 border-t border-white/[0.06]">
              <div className="flex items-center gap-2 mb-3">
                <span className="text-white/40 text-xs uppercase tracking-wider">Status atual:</span>
                <HudStatusPill variant={STATUS_VARIANTS[currentPeriod?.status || 'open'] as any}>
                  {STATUS_LABELS[currentPeriod?.status || 'open']}
                </HudStatusPill>
              </div>

              {currentPeriod?.status === 'closed' ? (
                <div className="flex items-center gap-2 p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
                  <Lock className="w-4 h-4 text-emerald-400" />
                  <span className="text-emerald-300 text-xs">Período fechado definitivamente</span>
                </div>
              ) : (
                <div className="flex gap-2">
                  {(!currentPeriod || currentPeriod.status === 'open') && (
                    <HudButton variant="secondary" leftIcon={<Lock className="w-4 h-4" />} onClick={() => { setCloseType('soft'); setConfirmModalOpen(true); }} fullWidth>
                      {t('softClose')}
                    </HudButton>
                  )}
                  {currentPeriod?.status === 'soft_close' && (
                    <HudButton variant="primary" leftIcon={<Lock className="w-4 h-4" />} onClick={() => { setCloseType('hard'); setConfirmModalOpen(true); }} fullWidth disabled={!allReady}>
                      {t('hardClose')}
                    </HudButton>
                  )}
                </div>
              )}

              {!allReady && currentPeriod?.status !== 'closed' && (
                <div className="flex items-center gap-2 mt-3 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
                  <AlertTriangle className="w-4 h-4 text-amber-400" />
                  <span className="text-amber-300 text-xs">Resolva as pendências acima antes do fechamento definitivo</span>
                </div>
              )}
            </div>
          </div>
        </HudPanel>

        {/* Snapshot */}
        <HudPanel title="Snapshot P&L" icon={<Lock className="w-4 h-4" />}>
          {currentPeriod?.snapshot_json ? (
            <div className="space-y-2">
              {[
                { label: 'Receita', value: currentPeriod.snapshot_json.revenue },
                { label: 'COGS', value: currentPeriod.snapshot_json.cogs },
                { label: 'Margem Bruta', value: currentPeriod.snapshot_json.gross_margin },
                { label: 'OPEX', value: currentPeriod.snapshot_json.opex },
                { label: 'Resultado Operacional', value: currentPeriod.snapshot_json.operating_result },
                { label: 'Financeiro', value: currentPeriod.snapshot_json.financial },
                { label: 'Tributos', value: currentPeriod.snapshot_json.taxes },
                { label: 'Resultado Líquido', value: currentPeriod.snapshot_json.net_result },
              ].map((row) => (
                <div key={row.label} className="flex justify-between py-2 px-3 rounded-lg bg-white/[0.02] border border-white/[0.04]">
                  <span className="text-white/60 text-xs">{row.label}</span>
                  <span className={`text-xs font-mono ${row.value >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{formatBRL(row.value)}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-12">
              <Lock className="w-8 h-8 text-white/20 mx-auto mb-3" />
              <p className="text-white/30 text-sm">O snapshot será gerado ao fechar o período definitivamente.</p>
            </div>
          )}
        </HudPanel>
      </div>

      {/* Waterfall Result Chart */}
      {currentPeriod?.snapshot_json && (
        <div className="mt-4">
          <HudPanel title="Resultado do Período — Waterfall" icon={<TrendingUp className="w-4 h-4" />}>
            <WaterfallChart snapshot={currentPeriod.snapshot_json} />
          </HudPanel>
        </div>
      )}

      {/* All Periods */}
      <div className="mt-4">
        <HudPanel title="Histórico de Períodos">
          <HudTable columns={periodColumns} data={periods} keyExtractor={(p) => p.id} compact />
        </HudPanel>
      </div>

      <HudModal isOpen={confirmModalOpen} onClose={() => setConfirmModalOpen(false)} title={closeType === 'soft' ? t('softClose') : t('hardClose')} size="sm">
        <p className="text-white/60 text-sm mb-4">
          {closeType === 'soft'
            ? 'O fechamento parcial impede novos lançamentos do tipo "Real" neste período. Ajustes ainda são permitidos.'
            : 'O fechamento definitivo congela o período e gera um snapshot do P&L. Esta ação não pode ser desfeita.'}
        </p>
        <HudInput label="Observações" value={notes} onChange={(e) => setNotes(e.target.value)} />
        <div className="flex gap-2 mt-4">
          <HudButton variant="secondary" onClick={() => setConfirmModalOpen(false)} fullWidth>Cancelar</HudButton>
          <HudButton variant={closeType === 'hard' ? 'danger' : 'primary'} onClick={handleClose} fullWidth>
            Confirmar {closeType === 'soft' ? 'Fechamento Parcial' : 'Fechamento Definitivo'}
          </HudButton>
        </div>
      </HudModal>
    </HudPageLayout>
  );
}

function WaterfallChart({ snapshot }: { snapshot: PnLSnapshot }) {
  const steps = [
    { name: 'Receita',     value: snapshot.revenue,          type: 'start' },
    { name: 'COGS',        value: snapshot.cogs,             type: 'step' },
    { name: 'Margem Bruta',value: snapshot.gross_margin,     type: 'subtotal' },
    { name: 'OPEX',        value: snapshot.opex,             type: 'step' },
    { name: 'Result. Oper.', value: snapshot.operating_result, type: 'subtotal' },
    { name: 'Financeiro',  value: snapshot.financial,        type: 'step' },
    { name: 'Tributos',    value: snapshot.taxes,            type: 'step' },
    { name: 'Result. Líq.',value: snapshot.net_result,       type: 'total' },
  ];

  const transparentData: (number | string)[] = [];
  const positiveData: (number | string)[] = [];
  const negativeData: (number | string)[] = [];

  let cumulative = 0;
  steps.forEach((step, i) => {
    if (step.type === 'start' || step.type === 'subtotal' || step.type === 'total') {
      transparentData.push(step.value >= 0 ? 0 : Math.abs(step.value));
      positiveData.push(step.value >= 0 ? step.value : '-');
      negativeData.push(step.value < 0 ? Math.abs(step.value) : '-');
      cumulative = step.value;
    } else {
      const prev = cumulative;
      cumulative = cumulative + step.value;
      if (step.value < 0) {
        transparentData.push(Math.max(cumulative, 0));
        positiveData.push('-');
        negativeData.push(Math.abs(step.value));
      } else {
        transparentData.push(prev >= 0 ? prev : 0);
        positiveData.push(step.value);
        negativeData.push('-');
      }
    }
  });

  const option = {
    tooltip: {
      trigger: 'axis' as const,
      axisPointer: { type: 'shadow' as const },
      backgroundColor: 'rgba(10,20,18,0.95)',
      borderColor: 'rgba(6,182,212,0.25)',
      textStyle: { color: '#e2e8f0', fontSize: 12 },
      formatter: (params: any[]) => {
        const idx = params[0]?.dataIndex ?? 0;
        const step = steps[idx];
        const color = step.value >= 0 ? '#10b981' : '#ef4444';
        return `<div style="font-weight:600;margin-bottom:4px">${step.name}</div>
                <span style="color:${color};font-family:monospace;font-size:13px">${formatBRL(step.value)}</span>`;
      },
    },
    grid: { left: 12, right: 20, top: 24, bottom: 8, containLabel: true },
    xAxis: {
      type: 'category' as const,
      data: steps.map(s => s.name),
      axisLabel: { color: '#94a3b8', fontSize: 10, rotate: 0, interval: 0 },
      axisLine: { lineStyle: { color: '#1e293b' } },
      axisTick: { show: false },
    },
    yAxis: {
      type: 'value' as const,
      axisLabel: { color: '#64748b', fontSize: 10, formatter: (v: number) => formatCompactBRL(v) },
      splitLine: { lineStyle: { color: 'rgba(255,255,255,0.04)', type: 'dashed' as const } },
      axisLine: { show: false },
    },
    series: [
      {
        name: 'Transparent',
        type: 'bar',
        stack: 'waterfall',
        silent: true,
        itemStyle: { borderColor: 'transparent', color: 'transparent' },
        emphasis: { itemStyle: { borderColor: 'transparent', color: 'transparent' } },
        data: transparentData,
      },
      {
        name: 'Positivo',
        type: 'bar',
        stack: 'waterfall',
        data: positiveData,
        itemStyle: {
          color: {
            type: 'linear' as const, x: 0, y: 0, x2: 0, y2: 1,
            colorStops: [
              { offset: 0, color: '#34d399' },
              { offset: 1, color: '#059669' },
            ],
          },
          borderRadius: [4, 4, 0, 0],
        },
        label: {
          show: true,
          position: 'top' as const,
          color: '#34d399',
          fontSize: 10,
          fontFamily: 'monospace',
          formatter: (p: any) => {
            const idx = p.dataIndex;
            return formatCompactBRL(steps[idx].value);
          },
        },
      },
      {
        name: 'Negativo',
        type: 'bar',
        stack: 'waterfall',
        data: negativeData,
        itemStyle: {
          color: {
            type: 'linear' as const, x: 0, y: 0, x2: 0, y2: 1,
            colorStops: [
              { offset: 0, color: '#f87171' },
              { offset: 1, color: '#dc2626' },
            ],
          },
          borderRadius: [4, 4, 0, 0],
        },
        label: {
          show: true,
          position: 'top' as const,
          color: '#f87171',
          fontSize: 10,
          fontFamily: 'monospace',
          formatter: (p: any) => {
            const idx = p.dataIndex;
            return formatCompactBRL(steps[idx].value);
          },
        },
      },
    ],
    animationDuration: 800,
    animationEasing: 'cubicInOut',
  };

  const netPositive = snapshot.net_result >= 0;

  return (
    <div>
      <div className="flex items-center justify-between mb-4 px-1">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-sm bg-gradient-to-b from-emerald-400 to-emerald-600" />
            <span className="text-[11px] text-white/50">Positivo</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-sm bg-gradient-to-b from-red-400 to-red-600" />
            <span className="text-[11px] text-white/50">Negativo</span>
          </div>
        </div>
        <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border ${
          netPositive
            ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-300'
            : 'bg-red-500/10 border-red-500/20 text-red-300'
        }`}>
          <TrendingUp className={`w-4 h-4 ${!netPositive ? 'rotate-180' : ''}`} />
          <span className="text-xs font-medium">Resultado Líquido:</span>
          <span className="text-sm font-mono font-bold">{formatBRL(snapshot.net_result)}</span>
        </div>
      </div>
      <ReactECharts option={option} style={{ height: 380 }} opts={{ renderer: 'svg' }} />
    </div>
  );
}
