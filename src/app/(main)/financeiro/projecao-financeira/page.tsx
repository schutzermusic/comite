'use client';

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  CalendarRange,
  Download,
  FileDown,
  FileSpreadsheet,
  FileText,
  Plus,
  Presentation,
  Save,
  Trash2,
  X,
} from 'lucide-react';
import { InvestorPackPreview } from '@/components/finance/investor-pack';
import {
  FinanceFilterBar,
  FinanceFilterDateField,
  FinanceFilterRange,
} from '@/components/finance/shared';
import {
  HudButton,
  HudCard,
  HudCardContent,
  HudCardDescription,
  HudCardHeader,
  HudCardTitle,
  HudHeader,
  HudInput,
  HudPageLayout,
  useHudToast,
} from '@/components/hud';
import { useCurrentUser } from '@/hooks/use-current-user';
import {
  addInvestorPackMonth,
  createInvestorPackDraft,
  listInvestorPacks,
  saveInvestorPack,
  type InvestorPackActor,
} from '@/lib/finance/investor-pack/store';
import {
  buildInvestorPackPresentationHtml,
  downloadInvestorPackHtml,
} from '@/lib/finance/investor-pack/html-presentation';
import {
  formatInvestorCurrency,
  formatInvestorPeriod,
  reaisToCents,
  validateInvestorPack,
} from '@/lib/finance/investor-pack/calculations';
import type { InvestorPack, InvestorPackMonth } from '@/lib/finance/investor-pack/types';
import { openInvestorPackPdf } from '@/lib/reports/modules/investor-pack-report';

function periodOffset(period: string, delta: number): string {
  const [year, month] = period.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1 + delta, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function TextAreaField({ label, value, onChange, rows = 4, disabled, placeholder }: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  rows?: number;
  disabled?: boolean;
  placeholder?: string;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[11px] font-medium uppercase tracking-wider text-ig-fg-muted">{label}</span>
      <textarea
        rows={rows}
        value={value}
        disabled={disabled}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className="w-full resize-y rounded-lg border border-ig-border-default bg-ig-bg-raised/60 px-4 py-3 text-sm text-ig-fg-strong outline-none transition focus:border-ig-border-focus disabled:cursor-not-allowed disabled:opacity-60"
      />
    </label>
  );
}

export default function FinancialProjectionPage() {
  const current = useCurrentUser();
  const { notify } = useHudToast();
  const [projection, setProjection] = useState<InvestorPack | null>(null);
  const [filterStart, setFilterStart] = useState('');
  const [filterEnd, setFilterEnd] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState<string | null>(null);
  const [presentationHtml, setPresentationHtml] = useState('');
  const [dirty, setDirty] = useState(false);
  const [loadError, setLoadError] = useState('');

  const isAdmin = current.roles.some((role) => role.key === 'owner_admin');
  const canEdit = isAdmin || current.permissions.includes('finance.edit_entry');
  const canExport = isAdmin || current.permissions.includes('finance.export');

  const actor: InvestorPackActor = useMemo(() => ({
    organizationId: current.organization?.id ?? null,
    userId: current.user?.id ?? null,
    authorName: current.profile?.full_name || current.user?.email || 'Financeiro',
  }), [current.organization?.id, current.profile?.full_name, current.user?.email, current.user?.id]);

  useEffect(() => {
    if (current.loading) return;
    let active = true;
    setLoading(true);
    setLoadError('');
    void listInvestorPacks()
      .then((packs) => {
        if (!active) return;
        const existingDraft = packs.find((item) => item.status === 'draft');
        const next = existingDraft ?? {
          ...createInvestorPackDraft(actor),
          title: 'Projeção Financeira',
          company: current.organization?.name ?? '',
        };
        setProjection(next);
        setFilterStart(next.periodStart);
        setFilterEnd(next.periodEnd);
      })
      .catch((error) => {
        if (active) setLoadError(error instanceof Error ? error.message : 'Não foi possível carregar a projeção.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [actor, current.loading, current.organization?.name]);

  const monthOptions = useMemo(() => {
    if (!projection) return [];
    const periods = new Set(projection.months.map((month) => month.period));
    const center = projection.referenceDate.slice(0, 7);
    for (let index = -18; index <= 24; index += 1) periods.add(periodOffset(center, index));
    return [...periods]
      .sort()
      .map((period) => ({ value: period, label: formatInvestorPeriod(period) }));
  }, [projection]);

  const forecastStartPeriod = useMemo(
    () => projection ? periodOffset(projection.referenceDate.slice(0, 7), 1) : '',
    [projection],
  );

  const visibleProjection = useMemo(() => {
    if (!projection) return null;
    const start = filterStart || projection.periodStart;
    const end = filterEnd || projection.periodEnd;
    return {
      ...projection,
      periodStart: start,
      periodEnd: end,
      months: projection.months
        .filter((month) => month.period >= start && month.period <= end)
        .map((month) => month.period < forecastStartPeriod ? {
          ...month,
          revenueForecastCents: 0,
          payrollForecastCents: 0,
        } : month),
    };
  }, [filterEnd, filterStart, forecastStartPeriod, projection]);

  const editable = Boolean(projection?.status === 'draft' && canEdit);

  const patch = (next: Partial<InvestorPack>) => {
    if (!editable) return;
    setProjection((currentProjection) => currentProjection ? { ...currentProjection, ...next } : currentProjection);
    setDirty(true);
  };

  const patchMonth = (id: string, next: Partial<InvestorPackMonth>) => {
    if (!editable) return;
    setProjection((currentProjection) => currentProjection ? {
      ...currentProjection,
      months: currentProjection.months.map((month) => month.id === id ? { ...month, ...next } : month),
    } : currentProjection);
    setDirty(true);
  };

  const handleSave = async () => {
    if (!projection || !editable) return;
    setSaving(true);
    try {
      const periods = projection.months.map((month) => month.period).sort();
      const saved = await saveInvestorPack({
        ...projection,
        title: projection.title.trim() || 'Projeção Financeira',
        periodStart: periods[0] ?? projection.periodStart,
        periodEnd: periods[periods.length - 1] ?? projection.periodEnd,
        months: projection.months.map((month) => month.period < forecastStartPeriod ? {
          ...month,
          revenueForecastCents: 0,
          payrollForecastCents: 0,
        } : month),
      }, actor);
      setProjection(saved);
      setDirty(false);
      notify('Projeção financeira salva', { variant: 'success' });
    } catch (error) {
      notify('Falha ao salvar', { variant: 'error', description: error instanceof Error ? error.message : 'Erro inesperado.' });
    } finally {
      setSaving(false);
    }
  };

  const ensureExportable = (): InvestorPack | null => {
    if (!visibleProjection) return null;
    const validation = validateInvestorPack(visibleProjection);
    if (!validation.valid) {
      notify('Preencha os dados antes de exportar', { variant: 'error', description: validation.errors[0] });
      return null;
    }
    return visibleProjection;
  };

  const exportPdf = () => {
    const snapshot = ensureExportable();
    if (!snapshot) return;
    const result = openInvestorPackPdf(snapshot);
    if (!result.ok) notify('Falha ao gerar PDF', { variant: 'error', description: result.message });
  };

  const presentHtml = () => {
    const snapshot = ensureExportable();
    if (!snapshot) return;
    setPresentationHtml(buildInvestorPackPresentationHtml(snapshot));
  };

  const exportPptx = async () => {
    const snapshot = ensureExportable();
    if (!snapshot) return;
    setExporting('pptx');
    try {
      const response = await fetch('/api/finance/investor-pack/pptx', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pack: snapshot }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(data.error || 'Falha ao gerar PowerPoint.');
      }
      const blob = await response.blob();
      const disposition = response.headers.get('content-disposition') ?? '';
      const fileName = disposition.match(/filename="([^"]+)"/)?.[1] ?? 'projecao-financeira.pptx';
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = fileName;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      notify('Falha ao gerar PowerPoint', { variant: 'error', description: error instanceof Error ? error.message : 'Erro inesperado.' });
    } finally {
      setExporting(null);
    }
  };

  if (loading || current.loading) {
    return <HudPageLayout><div className="py-24 text-center text-sm text-ig-fg-muted">Carregando projeção financeira...</div></HudPageLayout>;
  }

  if (loadError || !projection || !visibleProjection) {
    return (
      <HudPageLayout>
        <HudHeader
          title="Projeção Financeira"
          subtitle="Faturamento, folha e Curva S em uma visão executiva"
          icon={<FileSpreadsheet className="h-5 w-5" />}
          iconTint="#35E6BB"
          breadcrumbs={[{ label: 'Financeiro', href: '/financeiro' }, { label: 'Projeção Financeira' }]}
        />
        <HudCard><HudCardContent className="py-12 text-center text-sm text-ig-danger">{loadError || 'Projeção não encontrada.'}</HudCardContent></HudCard>
      </HudPageLayout>
    );
  }

  return (
    <HudPageLayout maxWidth="2xl">
      <HudHeader
        title="Projeção Financeira"
        subtitle="Faturamento realizado, previsão, folha e Curva S em uma única tela"
        icon={<FileSpreadsheet className="h-5 w-5" />}
        iconTint="#35E6BB"
        breadcrumbs={[{ label: 'Financeiro', href: '/financeiro' }, { label: 'Projeção Financeira' }]}
        statusChips={[{ label: dirty ? 'Alterações não salvas' : projection.createdAt === projection.updatedAt ? 'Nova projeção' : 'Dados salvos', variant: dirty ? 'warning' : 'success' }]}
        actions={editable ? (
          <HudButton variant="primary" isLoading={saving} leftIcon={<Save className="h-4 w-4" />} onClick={() => void handleSave()}>
            Salvar dados
          </HudButton>
        ) : undefined}
      />

      <FinanceFilterBar
        showPeriod={false}
        showScenario={false}
        sticky={false}
        extra={
          <>
            <FinanceFilterRange
              icon={<CalendarRange className="h-3.5 w-3.5" />}
              label="Período"
              fromValue={filterStart}
              toValue={filterEnd}
              options={monthOptions}
              onChange={(from, to) => { setFilterStart(from); setFilterEnd(to); }}
            />
            <FinanceFilterDateField
              label="Data-base"
              value={projection.referenceDate}
              onChange={(value) => patch({ referenceDate: value })}
            />
          </>
        }
        rightSlot={
          <>
            <HudButton variant="glass" leftIcon={<FileDown className="h-4 w-4" />} disabled={!canExport} onClick={exportPdf}>PDF</HudButton>
            <HudButton variant="glass" leftIcon={<FileText className="h-4 w-4" />} disabled={!canExport} isLoading={exporting === 'pptx'} onClick={() => void exportPptx()}>PowerPoint</HudButton>
            <HudButton variant="primary" leftIcon={<Presentation className="h-4 w-4" />} disabled={!canExport} onClick={presentHtml}>HTML apresentação</HudButton>
          </>
        }
      />

      <InvestorPackPreview pack={visibleProjection} />

      <HudCard>
        <HudCardHeader className="flex-row items-center justify-between gap-3">
          <div>
            <HudCardTitle>Dados mensais</HudCardTitle>
            <HudCardDescription>Preencha diretamente os valores em reais. KPIs e gráficos são atualizados em tempo real.</HudCardDescription>
          </div>
          {editable && (
            <HudButton
              variant="glass"
              size="sm"
              leftIcon={<Plus className="h-4 w-4" />}
              onClick={() => {
                const month = addInvestorPackMonth(projection);
                patch({ months: [...projection.months, month] });
                setFilterEnd(month.period);
              }}
            >
              Adicionar mês
            </HudButton>
          )}
        </HudCardHeader>
        <HudCardContent className="overflow-x-auto p-0">
          <table className="w-full min-w-[1120px] text-sm">
            <thead className="border-b border-ig-border-subtle bg-ig-bg-raised/40 text-[10px] uppercase tracking-wider text-ig-fg-muted">
              <tr>
                <th className="px-3 py-3 text-left">Competência</th>
                <th className="px-3 py-3 text-right">Faturamento realizado</th>
                <th className="px-3 py-3 text-right">
                  Previsão de faturamento
                  <span className="block text-[9px] font-normal normal-case tracking-normal">
                    a partir de {formatInvestorPeriod(forecastStartPeriod)}
                  </span>
                </th>
                <th className="px-3 py-3 text-right">Folha fechada</th>
                <th className="px-3 py-3 text-right">
                  Projeção da folha
                  <span className="block text-[9px] font-normal normal-case tracking-normal">
                    a partir de {formatInvestorPeriod(forecastStartPeriod)}
                  </span>
                </th>
                <th className="px-3 py-3 text-left">Observação</th>
                <th className="w-12" />
              </tr>
            </thead>
            <tbody className="divide-y divide-ig-border-subtle">
              {[...visibleProjection.months].sort((a, b) => a.period.localeCompare(b.period)).map((month) => (
                <tr key={month.id} className="hover:bg-ig-bg-raised/25">
                  <td className="px-3 py-2">
                    <input type="month" value={month.period} disabled={!editable} onChange={(event) => patchMonth(month.id, { period: event.target.value })} className="w-36 rounded-md border border-ig-border-subtle bg-ig-bg-raised/40 px-2 py-2 text-xs text-ig-fg-strong" />
                  </td>
                  {([
                    ['revenueActualCents', month.revenueActualCents, 'Faturamento realizado'],
                    ['revenueForecastCents', month.revenueForecastCents, 'Previsão de faturamento'],
                    ['payrollActualCents', month.payrollActualCents, 'Folha fechada'],
                    ['payrollForecastCents', month.payrollForecastCents, 'Projeção da folha'],
                  ] as const).map(([key, value, label]) => {
                    const forecastOnly = key === 'revenueForecastCents' || key === 'payrollForecastCents';
                    const forecastLocked = forecastOnly && month.period < forecastStartPeriod;
                    return (
                      <td key={key} className="px-3 py-2">
                        <input
                          type="number"
                          min={0}
                          step="0.01"
                          value={value / 100 || ''}
                          disabled={!editable || forecastLocked}
                          aria-label={`${label} ${month.period}`}
                          title={forecastLocked ? `Previsões disponíveis a partir de ${formatInvestorPeriod(forecastStartPeriod)}` : undefined}
                          onChange={(event) => patchMonth(month.id, { [key]: reaisToCents(event.target.value) })}
                          className="w-full min-w-40 rounded-md border border-ig-border-subtle bg-ig-bg-raised/40 px-2 py-2 text-right text-xs tabular-nums text-ig-fg-strong disabled:bg-ig-bg-base/50 disabled:text-ig-fg-subtle"
                        />
                      </td>
                    );
                  })}
                  <td className="px-3 py-2">
                    <input value={month.note} disabled={!editable} onChange={(event) => patchMonth(month.id, { note: event.target.value })} className="w-full min-w-56 rounded-md border border-ig-border-subtle bg-ig-bg-raised/40 px-2 py-2 text-xs text-ig-fg-strong" placeholder="Contexto do mês" />
                  </td>
                  <td className="px-2 py-2">
                    {editable && <button type="button" aria-label={`Remover ${month.period}`} onClick={() => patch({ months: projection.months.filter((item) => item.id !== month.id) })} className="rounded-md p-2 text-ig-fg-muted hover:bg-ig-danger/10 hover:text-ig-danger"><Trash2 className="h-4 w-4" /></button>}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t border-ig-border-default bg-ig-bg-raised/35 text-xs font-semibold text-ig-fg-strong">
              <tr>
                <td className="px-3 py-3">Totais do filtro</td>
                <td className="px-3 py-3 text-right tabular-nums">{formatInvestorCurrency(visibleProjection.months.reduce((sum, month) => sum + month.revenueActualCents, 0))}</td>
                <td className="px-3 py-3 text-right tabular-nums">{formatInvestorCurrency(visibleProjection.months.reduce((sum, month) => sum + month.revenueForecastCents, 0))}</td>
                <td className="px-3 py-3 text-right tabular-nums">{formatInvestorCurrency(visibleProjection.months.reduce((sum, month) => sum + month.payrollActualCents, 0))}</td>
                <td className="px-3 py-3 text-right tabular-nums">{formatInvestorCurrency(visibleProjection.months.reduce((sum, month) => sum + month.payrollForecastCents, 0))}</td>
                <td colSpan={2} />
              </tr>
            </tfoot>
          </table>
        </HudCardContent>
      </HudCard>

      <HudCard>
        <HudCardHeader>
          <HudCardTitle>Contexto da apresentação</HudCardTitle>
          <HudCardDescription>Informações usadas no PDF, PowerPoint e HTML. Não há etapas: edite quando necessário.</HudCardDescription>
        </HudCardHeader>
        <HudCardContent className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <HudInput label="Empresa" value={projection.company} disabled={!editable} onChange={(event) => patch({ company: event.target.value })} />
          <HudInput label="Destinatário" value={projection.recipient} disabled={!editable} onChange={(event) => patch({ recipient: event.target.value })} />
          <div className="lg:col-span-2">
            <TextAreaField label="Resumo executivo" value={projection.narrative.executiveSummary} disabled={!editable} onChange={(value) => patch({ narrative: { ...projection.narrative, executiveSummary: value } })} placeholder="Síntese do cenário financeiro e da trajetória projetada." />
          </div>
          <TextAreaField label="Destaques - uma linha por item" value={projection.narrative.highlights.join('\n')} disabled={!editable} onChange={(value) => patch({ narrative: { ...projection.narrative, highlights: value.split('\n') } })} />
          <TextAreaField label="Riscos - uma linha por item" value={projection.narrative.risks.join('\n')} disabled={!editable} onChange={(value) => patch({ narrative: { ...projection.narrative, risks: value.split('\n') } })} />
          <TextAreaField label="Premissas - uma linha por item" value={projection.narrative.assumptions.join('\n')} disabled={!editable} onChange={(value) => patch({ narrative: { ...projection.narrative, assumptions: value.split('\n') } })} />
          <TextAreaField label="Mensagem final" value={projection.narrative.closingMessage} disabled={!editable} onChange={(value) => patch({ narrative: { ...projection.narrative, closingMessage: value } })} />
        </HudCardContent>
      </HudCard>

      <div className="flex flex-wrap items-center justify-end gap-2">
        <HudButton variant="ghost" leftIcon={<Download className="h-4 w-4" />} disabled={!canExport} onClick={exportPdf}>Exportar PDF</HudButton>
        <HudButton variant="ghost" leftIcon={<FileText className="h-4 w-4" />} disabled={!canExport} isLoading={exporting === 'pptx'} onClick={() => void exportPptx()}>Exportar PowerPoint</HudButton>
        <HudButton variant="primary" leftIcon={<Presentation className="h-4 w-4" />} disabled={!canExport} onClick={presentHtml}>Abrir apresentação HTML</HudButton>
      </div>

      {presentationHtml && typeof document !== 'undefined' && createPortal((
        <div className="fixed inset-0 z-[9999] bg-[#071014]">
          <div className="absolute right-4 top-4 z-[10000] flex items-center gap-1 rounded-xl border border-white/20 bg-[#071014]/95 p-1 shadow-2xl">
            <button
              type="button"
              className="inline-flex h-9 items-center gap-2 rounded-lg border border-white/15 bg-white/5 px-3 text-xs font-semibold text-white transition hover:bg-white/10"
              style={{ color: '#ffffff', background: 'rgba(255,255,255,.08)', borderColor: 'rgba(255,255,255,.18)' }}
              onClick={() => downloadInvestorPackHtml(visibleProjection)}
            >
              <Download className="h-4 w-4" />
              Baixar HTML
            </button>
            <button
              type="button"
              className="inline-flex h-9 items-center gap-2 rounded-lg border border-white/15 bg-white/5 px-3 text-xs font-semibold text-white transition hover:bg-white/10"
              style={{ color: '#ffffff', background: 'rgba(255,255,255,.08)', borderColor: 'rgba(255,255,255,.18)' }}
              onClick={() => setPresentationHtml('')}
            >
              <X className="h-4 w-4" />
              Fechar
            </button>
          </div>
          <iframe
            title="Apresentação da projeção financeira"
            srcDoc={presentationHtml}
            className="h-full w-full border-0"
            allow="fullscreen"
          />
        </div>
      ), document.body)}
    </HudPageLayout>
  );
}
