'use client';

import { useState, useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { Lock, CheckCircle, XCircle, ShieldCheck, AlertTriangle, TrendingUp, FileCheck2, Clock3, CalendarRange } from 'lucide-react';
import {
  HudPageLayout, HudHeader, HudPanel, HudButton, HudStatusPill,
  HudSelect, HudTable, HudModal, HudInput, HudKpiStrip,
  type HudTableColumn, type KpiItem,
} from '@/components/hud';
import { FinanceAdvancedWaterfallChart, FinanceFilterBar, FinanceFilterChip } from '@/components/finance/shared';
import {
  getPeriodCloses, getPeriodClose, getCloseChecklist,
  softClosePeriod, hardClosePeriod, formatBRL, formatCompactBRL,
} from '@/lib/finance/finance-store';
import type { PeriodClose, PnLSnapshot } from '@/lib/types/finance';
import { ExportReportButton } from '@/components/reports/ExportReportButton';
import { openFinanceReport, kpiFromHud } from '@/lib/reports/modules/finance-report';

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
    { key: 'allEntriesPosted', label: t('allEntriesPosted'), ok: checklist.allEntriesPosted, owner: 'Controladoria', due: 'D+1', evidence: 'Razão contábil' },
    { key: 'payrollPosted', label: t('payrollPosted'), ok: checklist.payrollPosted, owner: 'RH / Folha', due: 'D+2', evidence: 'Lote folha' },
    { key: 'allocationsPosted', label: t('allocationsPosted'), ok: checklist.allocationsPosted, owner: 'PMO', due: 'D+2', evidence: 'Rateios' },
    { key: 'noPendingEntries', label: t('noPendingEntries'), ok: checklist.noPendingEntries, owner: 'Financeiro', due: 'D+3', evidence: 'Fila zerada' },
    { key: 'allEvidenceProvided', label: t('allEvidenceProvided'), ok: checklist.allEvidenceProvided, owner: 'Auditoria', due: 'D+4', evidence: 'Documentos' },
  ];
  const checklistDone = checklistItems.filter(item => item.ok).length;
  const closeProgress = Math.round((checklistDone / checklistItems.length) * 100);

  const closeKpis: KpiItem[] = [
    { id: 'status', label: 'Status do período', value: STATUS_LABELS[currentPeriod?.status || 'open'], icon: <Lock className="h-5 w-5" />, variant: currentPeriod?.status === 'closed' ? 'success' : 'warning' },
    { id: 'progress', label: 'Checklist pronto', value: closeProgress, format: 'percent', icon: <ShieldCheck className="h-5 w-5" />, variant: allReady ? 'success' : 'warning' },
    { id: 'blockers', label: 'Bloqueios', value: checklistItems.length - checklistDone, icon: <AlertTriangle className="h-5 w-5" />, variant: allReady ? 'success' : 'danger' },
    { id: 'reporting', label: 'Resultado líquido', value: currentPeriod?.snapshot_json ? currentPeriod.snapshot_json.net_result / 100 : 'Pendente', format: currentPeriod?.snapshot_json ? 'compactCurrency' : 'raw', icon: <FileCheck2 className="h-5 w-5" />, variant: currentPeriod?.snapshot_json ? 'info' : 'warning' },
  ];

  const periodColumns: HudTableColumn<PeriodClose>[] = [
    { key: 'period_key', header: t('period'), cell: (p) => <span className="font-mono text-xs text-ig-fg-strong">{p.period_key}</span> },
    { key: 'status', header: 'Status', cell: (p) => <HudStatusPill variant={STATUS_VARIANTS[p.status] as any} size="sm">{STATUS_LABELS[p.status]}</HudStatusPill> },
    { key: 'soft_closed_at', header: t('softClose'), cell: (p) => <span className="font-mono text-xs text-ig-fg-muted">{p.soft_closed_at?.slice(0, 10) || '—'}</span> },
    { key: 'closed_at', header: t('hardClose'), cell: (p) => <span className="font-mono text-xs text-ig-fg-muted">{p.closed_at?.slice(0, 10) || '—'}</span> },
    { key: 'snapshot', header: 'Snapshot', cell: (p) => p.snapshot_json ? (
      <span className="text-xs text-ig-success">Resultado: {formatBRL(p.snapshot_json.net_result)}</span>
    ) : <span className="text-xs text-ig-fg-subtle">—</span> },
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
        iconTint="#14B8A6"
        breadcrumbs={[{ label: t('title'), href: '/financeiro' }, { label: t('periodClose') }]}
      />

      <FinanceFilterBar
        showPeriod={false}
        showScenario={false}
        extra={
          <FinanceFilterChip
            icon={<CalendarRange className="h-3.5 w-3.5" />}
            label="Período"
            value={selectedPeriod}
            onChange={setSelectedPeriod}
            options={[
              { value: '2026-01', label: 'Jan/2026' },
              { value: '2026-02', label: 'Fev/2026' },
              { value: '2026-03', label: 'Mar/2026' },
            ]}
          />
        }
        rightSlot={
          <>
            <ExportReportButton
              size="sm"
              variant="glass"
              permission="finance.export"
              fallbackPermission="finance.view"
              build={() => openFinanceReport({
                title: 'Fechamento Mensal',
                fileContext: 'fechamento',
                periodLabel: selectedPeriod,
                context: `Status do fechamento contábil — período <b>${selectedPeriod}</b>`,
                kpis: closeKpis.map((k) => kpiFromHud(k)),
                sections: [{
                  title: 'Checklist de Fechamento',
                  tables: [{
                    columns: [
                      { key: 'item', label: 'Item' },
                      { key: 'owner', label: 'Responsável' },
                      { key: 'due', label: 'Prazo' },
                      { key: 'ev', label: 'Evidência' },
                      { key: 'status', label: 'Status' },
                    ],
                    rows: checklistItems.map((it) => ({
                      item: it.label,
                      owner: it.owner,
                      due: it.due,
                      ev: it.evidence,
                      status: { html: `<span class="pill ${it.ok ? 'ok' : 'warn'}">${it.ok ? 'OK' : 'pendente'}</span>` },
                    })),
                  }],
                  note: {
                    title: 'Situação do período',
                    tone: allReady ? 'ok' : 'warn',
                    items: [
                      `Progresso do checklist: ${closeProgress}% (${checklistDone}/${checklistItems.length}).`,
                      `Status do período: ${currentPeriod?.status ?? 'aberto'}.`,
                      currentPeriod?.snapshot_json ? `Resultado do snapshot: ${formatBRL(currentPeriod.snapshot_json.net_result)}.` : 'Snapshot ainda não gerado.',
                    ],
                  },
                }],
              })}
            />
            <HudButton
              variant="secondary" size="sm" leftIcon={<Lock className="w-4 h-4" />}
              onClick={() => { setCloseType('soft'); setConfirmModalOpen(true); }}
              disabled={currentPeriod?.status === 'closed'}
            >
              {t('softClose')}
            </HudButton>
            <HudButton
              variant="primary" size="sm" leftIcon={<Lock className="w-4 h-4" />}
              onClick={() => { setCloseType('hard'); setConfirmModalOpen(true); }}
              disabled={!allReady || currentPeriod?.status === 'closed'}
            >
              {t('hardClose')}
            </HudButton>
          </>
        }
      />

      <HudKpiStrip kpis={closeKpis} columns={4} size="sm" />

      <HudPanel className="mt-4" title="Trilha executiva do fechamento" subtitle="Status board-ready sem alterar o fluxo operacional" icon={<Clock3 className="h-4 w-4" />} sweep>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4 lg:grid-cols-7">
          {[
            { label: 'Aberto', active: currentPeriod?.status === 'open', variant: 'info' },
            { label: 'Em revisão', active: currentPeriod?.status === 'soft_close', variant: 'warning' },
            { label: 'Pendente', active: !allReady && currentPeriod?.status !== 'closed', variant: 'warning' },
            { label: 'Aprovado', active: allReady && currentPeriod?.status !== 'closed', variant: 'completed' },
            { label: 'Fechado', active: currentPeriod?.status === 'closed', variant: 'completed' },
            { label: 'Reportado', active: Boolean(currentPeriod?.snapshot_json), variant: 'active' },
            { label: 'Bloqueado', active: !allReady && currentPeriod?.status === 'soft_close', variant: 'error' },
          ].map((phase) => (
            <div
              key={phase.label}
              className={`rounded-xl border p-3 transition-all ${phase.active ? 'border-ig-border-focus bg-ig-accent-weak' : 'border-ig-border-subtle bg-ig-panel/40'}`}
            >
              <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-ig-fg-subtle">{phase.label}</p>
              <div className="mt-2">
                <HudStatusPill variant={phase.variant as any} size="sm">{phase.active ? 'Atual' : 'Standby'}</HudStatusPill>
              </div>
            </div>
          ))}
        </div>
      </HudPanel>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-4">
        {/* Checklist */}
        <HudPanel title={t('closeChecklist')} icon={<ShieldCheck className="w-4 h-4" />}>
          <div className="space-y-3">
            {checklistItems.map((item) => (
              <div key={item.key} className="grid grid-cols-[auto_1fr] gap-3 rounded-xl border border-ig-border-subtle bg-ig-panel/45 px-3 py-2.5 md:grid-cols-[auto_1fr_auto]">
                {item.ok ? (
                  <CheckCircle className="h-5 w-5 shrink-0 text-ig-success" />
                ) : (
                  <XCircle className="h-5 w-5 shrink-0 text-ig-danger" />
                )}
                <div className="min-w-0">
                  <span className={`block text-sm ${item.ok ? 'text-ig-fg-strong' : 'text-ig-danger'}`}>{item.label}</span>
                  <span className="text-[10px] uppercase tracking-[0.14em] text-ig-fg-subtle">{item.owner} · {item.due}</span>
                </div>
                <span className="hidden rounded-md border border-ig-border-subtle bg-ig-raised px-2 py-1 text-[10px] text-ig-fg-muted md:inline-flex">{item.evidence}</span>
              </div>
            ))}

            <div className="border-t border-ig-border-subtle pt-4">
              <div className="flex items-center gap-2 mb-3">
                <span className="text-xs uppercase tracking-wider text-ig-fg-subtle">Status atual:</span>
                <HudStatusPill variant={STATUS_VARIANTS[currentPeriod?.status || 'open'] as any}>
                  {STATUS_LABELS[currentPeriod?.status || 'open']}
                </HudStatusPill>
              </div>

              {currentPeriod?.status === 'closed' ? (
                <div className="flex items-center gap-2 rounded-lg border border-[color-mix(in_oklab,var(--ig-success)_28%,transparent)] bg-[color-mix(in_oklab,var(--ig-success)_12%,transparent)] p-3">
                  <Lock className="h-4 w-4 text-ig-success" />
                  <span className="text-xs text-ig-success">Período fechado definitivamente</span>
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
                <div className="mt-3 flex items-center gap-2 rounded-lg border border-[color-mix(in_oklab,var(--ig-warning)_28%,transparent)] bg-[color-mix(in_oklab,var(--ig-warning)_12%,transparent)] p-3">
                  <AlertTriangle className="h-4 w-4 text-ig-warning" />
                  <span className="text-xs text-ig-warning">Resolva as pendências acima antes do fechamento definitivo</span>
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
                { label: 'Custo Direto', value: currentPeriod.snapshot_json.cogs },
                { label: 'Margem Bruta', value: currentPeriod.snapshot_json.gross_margin },
                { label: 'Despesas Operacionais', value: currentPeriod.snapshot_json.opex },
                { label: 'Resultado Operacional', value: currentPeriod.snapshot_json.operating_result },
                { label: 'Financeiro', value: currentPeriod.snapshot_json.financial },
                { label: 'Tributos', value: currentPeriod.snapshot_json.taxes },
                { label: 'Resultado Líquido', value: currentPeriod.snapshot_json.net_result },
              ].map((row) => (
                <div key={row.label} className="flex justify-between rounded-lg border border-ig-border-subtle bg-ig-panel/45 px-3 py-2">
                  <span className="text-xs text-ig-fg-muted">{row.label}</span>
                  <span className={`font-mono text-xs ${row.value >= 0 ? 'text-ig-success' : 'text-ig-danger'}`}>{formatBRL(row.value)}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-12">
              <Lock className="mx-auto mb-3 h-8 w-8 text-ig-fg-subtle" />
              <p className="text-sm text-ig-fg-muted">O snapshot será gerado ao fechar o período definitivamente.</p>
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
        <p className="mb-4 text-sm text-ig-fg-muted">
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
    { label: 'Receita', value: snapshot.revenue, type: 'start' as const },
    { label: 'Custo Direto', value: snapshot.cogs, type: 'delta' as const },
    { label: 'Margem Bruta', value: snapshot.gross_margin, type: 'end' as const },
    { label: 'Despesas Op.', value: snapshot.opex, type: 'delta' as const },
    { label: 'Result. Oper.', value: snapshot.operating_result, type: 'end' as const },
    { label: 'Financeiro', value: snapshot.financial, type: 'delta' as const },
    { label: 'Tributos', value: snapshot.taxes, type: 'delta' as const },
    { label: 'Result. Líq.', value: snapshot.net_result, type: 'end' as const },
  ];
  const netPositive = snapshot.net_result >= 0;

  return (
    <div>
      <div className="flex items-center justify-between mb-4 px-1">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="h-3 w-3 rounded-sm bg-ig-success" />
            <span className="text-[11px] text-ig-fg-muted">Positivo</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="h-3 w-3 rounded-sm bg-ig-danger" />
            <span className="text-[11px] text-ig-fg-muted">Negativo</span>
          </div>
        </div>
        <div className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 ${
          netPositive
            ? 'border-[color-mix(in_oklab,var(--ig-success)_28%,transparent)] bg-[color-mix(in_oklab,var(--ig-success)_12%,transparent)] text-ig-success'
            : 'border-[color-mix(in_oklab,var(--ig-danger)_28%,transparent)] bg-[color-mix(in_oklab,var(--ig-danger)_12%,transparent)] text-ig-danger'
        }`}>
          <TrendingUp className={`w-4 h-4 ${!netPositive ? 'rotate-180' : ''}`} />
          <span className="text-xs font-medium">Resultado Líquido:</span>
          <span className="text-sm font-mono font-bold">{formatBRL(snapshot.net_result)}</span>
        </div>
      </div>
      <FinanceAdvancedWaterfallChart steps={steps} height={380} />
    </div>
  );
}
