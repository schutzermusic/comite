'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  CalendarRange,
  ChevronRight,
  Download,
  FileDown,
  FileSpreadsheet,
  FileText,
  Palette,
  Plus,
  Presentation,
  Trash2,
  X,
} from 'lucide-react';
import { InvestorPackPreview } from '@/components/finance/investor-pack';
import {
  FinanceFilterBar,
  FinanceFilterDateField,
  FinanceFilterRange,
  FinanceFilterSegment,
} from '@/components/finance/shared';
import {
  HudButton,
  HudCard,
  HudCardContent,
  HudCardDescription,
  HudCardHeader,
  HudCardTitle,
  HudHeader,
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
import { hydratePortfolioProjection } from '@/lib/finance/investor-pack/portfolio-projection';
import type { InvestorPack, InvestorPackMonth } from '@/lib/finance/investor-pack/types';
import { openInvestorPackPdf } from '@/lib/reports/modules/investor-pack-report';
import { REPORT_NAME, type ApexThemeMode } from '@/lib/finance/investor-pack/apex-theme';

function periodOffset(period: string, delta: number): string {
  const [year, month] = period.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1 + delta, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

export default function FinancialProjectionPage() {
  const current = useCurrentUser();
  const { notify } = useHudToast();
  const [projection, setProjection] = useState<InvestorPack | null>(null);
  const [filterStart, setFilterStart] = useState('');
  const [filterEnd, setFilterEnd] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [autoSaveError, setAutoSaveError] = useState('');
  const [exporting, setExporting] = useState<string | null>(null);
  const [presentationHtml, setPresentationHtml] = useState('');
  /** Tema dos exports PDF e PowerPoint — escuro (tela/projeção) ou claro (impressão/anexo). */
  const [pdfTheme, setPdfTheme] = useState<ApexThemeMode>('dark');
  const [dirty, setDirty] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [monthlyDataOpen, setMonthlyDataOpen] = useState(false);
  const editRevisionRef = useRef(0);

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
        const next = hydratePortfolioProjection(existingDraft ?? {
          ...createInvestorPackDraft(actor),
          title: REPORT_NAME,
          company: current.organization?.name ?? '',
        });
        setProjection(next);
        setFilterStart(next.periodStart);
        setFilterEnd(next.periodEnd);
        setAutoSaveError('');
        const needsPersistence = !existingDraft || next !== existingDraft;
        if (needsPersistence) editRevisionRef.current += 1;
        setDirty(needsPersistence);
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
  const revenueForecastStartPeriod = forecastStartPeriod;

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
        .map((month) => ({
          ...month,
          revenueForecastCents: month.period < revenueForecastStartPeriod ? 0 : month.revenueForecastCents,
          payrollForecastCents: month.period < forecastStartPeriod ? 0 : month.payrollForecastCents,
        })),
    };
  }, [filterEnd, filterStart, forecastStartPeriod, projection, revenueForecastStartPeriod]);

  const editable = Boolean(projection?.status === 'draft' && canEdit);

  const patch = (next: Partial<InvestorPack>) => {
    if (!editable) return;
    editRevisionRef.current += 1;
    setAutoSaveError('');
    setProjection((currentProjection) => currentProjection ? { ...currentProjection, ...next } : currentProjection);
    setDirty(true);
  };

  const patchMonth = (id: string, next: Partial<InvestorPackMonth>) => {
    if (!editable) return;
    editRevisionRef.current += 1;
    setAutoSaveError('');
    setProjection((currentProjection) => currentProjection ? {
      ...currentProjection,
      months: currentProjection.months.map((month) => month.id === id ? { ...month, ...next } : month),
    } : currentProjection);
    setDirty(true);
  };

  useEffect(() => {
    if (!projection || !editable || !dirty || saving || autoSaveError) return;
    const revision = editRevisionRef.current;
    const snapshot = projection;
    const timer = window.setTimeout(() => {
      setSaving(true);
      const periods = snapshot.months.map((month) => month.period).sort();
      void saveInvestorPack({
        ...snapshot,
        title: snapshot.title.trim() || REPORT_NAME,
        periodStart: periods[0] ?? snapshot.periodStart,
        periodEnd: periods[periods.length - 1] ?? snapshot.periodEnd,
        months: snapshot.months.map((month) => ({
          ...month,
          revenueForecastCents: month.period < revenueForecastStartPeriod ? 0 : month.revenueForecastCents,
          payrollForecastCents: month.period < forecastStartPeriod ? 0 : month.payrollForecastCents,
        })),
      }, actor)
        .then((saved) => {
          if (editRevisionRef.current !== revision) return;
          setProjection(saved);
          setDirty(false);
          setAutoSaveError('');
        })
        .catch((error) => {
          if (editRevisionRef.current !== revision) return;
          const message = error instanceof Error ? error.message : 'Erro inesperado.';
          setAutoSaveError(message);
          notify('Falha no salvamento automático', {
            variant: 'error',
            description: 'Os dados continuam na tela. Faça uma nova alteração para tentar novamente.',
          });
        })
        .finally(() => setSaving(false));
    }, 900);
    return () => window.clearTimeout(timer);
  }, [
    actor,
    autoSaveError,
    dirty,
    editable,
    forecastStartPeriod,
    notify,
    projection,
    revenueForecastStartPeriod,
    saving,
  ]);

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
    const result = openInvestorPackPdf(snapshot, { theme: pdfTheme });
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
        body: JSON.stringify({ pack: snapshot, theme: pdfTheme }),
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
        statusChips={[autoSaveError
          ? { label: 'Falha ao salvar automaticamente', variant: 'critical' }
          : saving
            ? { label: 'Salvando automaticamente...', variant: 'live' }
            : dirty
              ? { label: 'Aguardando salvamento automático', variant: 'warning' }
              : { label: 'Dados salvos automaticamente', variant: 'success' }]}
        actions={(
          <div className="grid w-full grid-cols-1 gap-2 sm:grid-cols-3 lg:w-auto [&_>_button]:w-full [&_>_button]:whitespace-nowrap">
            <HudButton variant="glass" leftIcon={<FileDown className="h-4 w-4" />} disabled={!canExport} onClick={exportPdf}>PDF {pdfTheme === 'light' ? 'claro' : 'escuro'}</HudButton>
            <HudButton variant="glass" leftIcon={<FileText className="h-4 w-4" />} disabled={!canExport} isLoading={exporting === 'pptx'} onClick={() => void exportPptx()}>PowerPoint {pdfTheme === 'light' ? 'claro' : 'escuro'}</HudButton>
            <HudButton variant="primary" leftIcon={<Presentation className="h-4 w-4" />} disabled={!canExport} onClick={presentHtml}>HTML apresentação</HudButton>
          </div>
        )}
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
              className="sm:w-[22rem] sm:max-w-[22rem]"
            />
            <FinanceFilterDateField
              label="Data-base"
              value={projection.referenceDate}
              onChange={(value) => patch({ referenceDate: value })}
              className="sm:w-[15rem] sm:max-w-[15rem] sm:shrink-0"
            />
            <FinanceFilterSegment<ApexThemeMode>
              icon={<Palette className="h-3.5 w-3.5" />}
              label="Tema do relatório"
              value={pdfTheme}
              options={[{ value: 'dark', label: 'Escuro' }, { value: 'light', label: 'Claro' }]}
              onChange={setPdfTheme}
            />
          </>
        }
      />

      <InvestorPackPreview pack={visibleProjection} />

      <HudCard>
        <HudCardHeader>
          <HudCardTitle>Carteira, faturamento, backlog e recebíveis</HudCardTitle>
          <HudCardDescription>
            Base contratual usada na projeção. “Saldo a receber” representa o valor informado na carteira, não necessariamente caixa já recebido.
          </HudCardDescription>
        </HudCardHeader>
        <HudCardContent className="overflow-x-auto p-0">
          <table className="w-full min-w-[1320px] text-xs">
            <thead className="border-b border-ig-border-subtle bg-ig-raised text-[10px] uppercase tracking-wider text-ig-fg-muted">
              <tr>
                <th className="px-3 py-3 text-left">Cliente</th>
                <th className="px-3 py-3 text-left">Status</th>
                <th className="px-3 py-3 text-center">Contratos</th>
                <th className="px-3 py-3 text-right">Carteira</th>
                <th className="px-3 py-3 text-right">Faturado</th>
                <th className="px-3 py-3 text-right">Backlog</th>
                <th className="px-3 py-3 text-right">Saldo a receber</th>
                <th className="px-3 py-3 text-right">Projetado até 2028</th>
                <th className="px-3 py-3 text-right">Saldo pós-2028</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ig-border-subtle">
              {visibleProjection.narrative.portfolio.map((client) => (
                <tr key={client.id} className="transition-colors hover:bg-ig-panel-hover">
                  <td className="px-3 py-3 font-semibold text-ig-fg-strong">{client.client}</td>
                  <td className="px-3 py-3 text-ig-fg-muted">{client.status}</td>
                  <td className="px-3 py-3 text-center tabular-nums">{client.contractsCount}</td>
                  <td className="px-3 py-3 text-right tabular-nums">{formatInvestorCurrency(client.portfolioCents)}</td>
                  <td className="px-3 py-3 text-right tabular-nums text-ig-success">{formatInvestorCurrency(client.billedCents)}</td>
                  <td className="px-3 py-3 text-right tabular-nums text-ig-info">{formatInvestorCurrency(client.backlogCents)}</td>
                  <td className="px-3 py-3 text-right tabular-nums">{formatInvestorCurrency(client.receivableCents)}</td>
                  <td className="px-3 py-3 text-right tabular-nums text-ig-accent">{formatInvestorCurrency(client.projectedThrough2028Cents)}</td>
                  <td className="px-3 py-3 text-right tabular-nums">{formatInvestorCurrency(client.remainingAfter2028Cents)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t border-ig-border-default bg-ig-raised font-semibold text-ig-fg-strong">
              <tr>
                <td className="px-3 py-3" colSpan={2}>Total da carteira</td>
                <td className="px-3 py-3 text-center tabular-nums">{visibleProjection.narrative.portfolio.reduce((sum, client) => sum + client.contractsCount, 0)}</td>
                {(['portfolioCents', 'billedCents', 'backlogCents', 'receivableCents', 'projectedThrough2028Cents', 'remainingAfter2028Cents'] as const).map((key) => (
                  <td key={key} className="px-3 py-3 text-right tabular-nums">
                    {formatInvestorCurrency(visibleProjection.narrative.portfolio.reduce((sum, client) => sum + client[key], 0))}
                  </td>
                ))}
              </tr>
            </tfoot>
          </table>
        </HudCardContent>
      </HudCard>

      <HudCard>
        <HudCardHeader className="flex-row items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => setMonthlyDataOpen((open) => !open)}
            aria-expanded={monthlyDataOpen}
            aria-controls="monthly-financial-data"
            className="group flex min-w-0 flex-1 items-center gap-3 text-left"
          >
            <ChevronRight
              className={`h-4 w-4 shrink-0 text-ig-fg-muted transition-transform group-hover:text-ig-accent ${monthlyDataOpen ? 'rotate-90 text-ig-accent' : ''}`}
            />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <HudCardTitle>Dados mensais</HudCardTitle>
                <span className="rounded-full bg-ig-raised px-2 py-0.5 text-[10px] tabular-nums text-ig-fg-muted">
                  {visibleProjection.months.length} {visibleProjection.months.length === 1 ? 'mês' : 'meses'}
                </span>
                <span className="text-[10px] text-ig-fg-muted">
                  {monthlyDataOpen ? 'recolher' : 'expandir'}
                </span>
              </div>
              <HudCardDescription>
                Preencha diretamente os valores em reais. KPIs e gráficos são atualizados em tempo real. Valores realizados aparecem em cor neutra e os <span className="font-semibold text-ig-accent">projetados em destaque</span>, na mesma coluna.
              </HudCardDescription>
            </div>
          </button>
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
        {monthlyDataOpen && <HudCardContent id="monthly-financial-data" className="overflow-x-auto p-0">
          <table className="w-full min-w-[880px] text-sm">
            <thead className="border-b border-ig-border-subtle bg-ig-raised text-[10px] uppercase tracking-wider text-ig-fg-muted">
              <tr>
                <th className="px-3 py-3 text-left">Competência</th>
                <th className="px-3 py-3 text-right">
                  Faturamento
                  <span className="block text-[9px] font-normal normal-case tracking-normal">
                    realizado até {formatInvestorPeriod(periodOffset(revenueForecastStartPeriod, -1))} · projetado a partir de {formatInvestorPeriod(revenueForecastStartPeriod)}
                  </span>
                </th>
                <th className="px-3 py-3 text-right">
                  Folha + encargos
                  <span className="block text-[9px] font-normal normal-case tracking-normal">
                    fechada até {formatInvestorPeriod(periodOffset(forecastStartPeriod, -1))} · projetada a partir de {formatInvestorPeriod(forecastStartPeriod)}
                  </span>
                </th>
                <th className="px-3 py-3 text-left">Observação</th>
                <th className="w-12" />
              </tr>
            </thead>
            <tbody className="divide-y divide-ig-border-subtle">
              {[...visibleProjection.months].sort((a, b) => a.period.localeCompare(b.period)).map((month) => (
                <tr key={month.id} className="transition-colors hover:bg-ig-panel-hover">
                  <td className="px-3 py-2">
                    <input type="month" value={month.period} disabled={!editable} onChange={(event) => patchMonth(month.id, { period: event.target.value })} className="investor-projection-field w-36 rounded-md border px-2 py-2 text-xs" />
                  </td>
                  {([
                    ['revenueActualCents', 'revenueForecastCents', revenueForecastStartPeriod, 'Faturamento'],
                    ['payrollActualCents', 'payrollForecastCents', forecastStartPeriod, 'Folha + encargos'],
                  ] as const).map(([actualKey, forecastKey, forecastFrom, label]) => {
                    // O realizado sempre prevalece: só cai para a projeção quando a competência
                    // está no horizonte projetado e ainda não tem valor fechado lançado.
                    const isForecast = Boolean(forecastFrom) && month.period >= forecastFrom && month[actualKey] === 0;
                    const key = isForecast ? forecastKey : actualKey;
                    const value = month[key];
                    return (
                      <td key={actualKey} className="px-3 py-2">
                        <input
                          type="number"
                          min={0}
                          step="0.01"
                          value={value / 100 || ''}
                          disabled={!editable}
                          aria-label={`${label} ${isForecast ? 'projetado' : 'realizado'} ${month.period}`}
                          title={isForecast ? `Valor projetado (a partir de ${formatInvestorPeriod(forecastFrom)})` : 'Valor realizado'}
                          onChange={(event) => patchMonth(month.id, { [key]: reaisToCents(event.target.value) })}
                          className={`investor-projection-field w-full min-w-40 rounded-md border px-2 py-2 text-right text-xs tabular-nums${isForecast ? ' investor-projection-field--forecast' : ''}`}
                        />
                      </td>
                    );
                  })}
                  <td className="px-3 py-2">
                    <input value={month.note} disabled={!editable} onChange={(event) => patchMonth(month.id, { note: event.target.value })} className="investor-projection-field w-full min-w-56 rounded-md border px-2 py-2 text-xs" placeholder="Contexto do mês" />
                  </td>
                  <td className="px-2 py-2">
                    {editable && <button type="button" aria-label={`Remover ${month.period}`} onClick={() => patch({ months: projection.months.filter((item) => item.id !== month.id) })} className="rounded-md p-2 text-ig-fg-muted hover:bg-ig-danger/10 hover:text-ig-danger"><Trash2 className="h-4 w-4" /></button>}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t border-ig-border-default bg-ig-raised text-xs font-semibold text-ig-fg-strong">
              <tr>
                <td className="px-3 py-3">Totais do filtro</td>
                {([
                  ['revenueActualCents', 'revenueForecastCents'],
                  ['payrollActualCents', 'payrollForecastCents'],
                ] as const).map(([actualKey, forecastKey]) => (
                  <td key={actualKey} className="px-3 py-3 text-right tabular-nums">
                    {formatInvestorCurrency(visibleProjection.months.reduce((sum, month) => sum + month[actualKey] + month[forecastKey], 0))}
                    <span className="block text-[9px] font-normal text-ig-fg-muted">
                      realizado {formatInvestorCurrency(visibleProjection.months.reduce((sum, month) => sum + month[actualKey], 0))}
                      {' · '}
                      <span className="text-ig-accent">projetado {formatInvestorCurrency(visibleProjection.months.reduce((sum, month) => sum + month[forecastKey], 0))}</span>
                    </span>
                  </td>
                ))}
                <td colSpan={2} />
              </tr>
            </tfoot>
          </table>
        </HudCardContent>}
      </HudCard>

      <div className="flex flex-wrap items-center justify-end gap-2">
        <HudButton variant="ghost" leftIcon={<Download className="h-4 w-4" />} disabled={!canExport} onClick={exportPdf}>Exportar PDF ({pdfTheme === 'light' ? 'claro' : 'escuro'})</HudButton>
        <HudButton variant="ghost" leftIcon={<FileText className="h-4 w-4" />} disabled={!canExport} isLoading={exporting === 'pptx'} onClick={() => void exportPptx()}>Exportar PowerPoint ({pdfTheme === 'light' ? 'claro' : 'escuro'})</HudButton>
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
