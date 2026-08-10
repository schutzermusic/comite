'use client';

/**
 * Histórico de marcações (§9).
 *
 * No celular são cartões diários que abrem a linha do tempo do dia — sem
 * tabela espremida. A partir de `lg` os mesmos cartões ganham duas
 * colunas, aproveitando a tela sem mudar o modelo mental.
 */

import * as React from 'react';
import { CalendarRange, CircleAlert, Filter, Inbox } from 'lucide-react';
import { pontoApi, PontoApiError } from '@/lib/ponto/client';
import type { PunchRecord } from '@/lib/ponto/attendance-types';
import {
  DAY_STATUS_LABEL,
  formatDuration,
  groupPunchesByDay,
  type DayRecord,
  type DayStatus,
} from '@/lib/ponto/attendance-state';
import { usePonto } from '@/components/ponto/PontoSessionProvider';
import {
  AttendanceHistoryCard,
  EmptyState,
  PontoButton,
  PontoCard,
  PontoSkeleton,
  PontoSheet,
  SectionLabel,
} from '@/components/ponto';
import { AdjustmentRequestForm } from '@/components/ponto/AdjustmentRequestForm';
import type { AdjustmentInput } from '@/lib/ponto/attendance-types';

type RangePreset = 'current_month' | 'last_30' | 'custom';

const STATUS_FILTERS: Array<{ value: DayStatus | 'all'; label: string }> = [
  { value: 'all', label: 'Todos' },
  { value: 'complete', label: DAY_STATUS_LABEL.complete },
  { value: 'incomplete', label: DAY_STATUS_LABEL.incomplete },
  { value: 'under_review', label: DAY_STATUS_LABEL.under_review },
  { value: 'adjusted', label: DAY_STATUS_LABEL.adjusted },
  { value: 'rejected', label: DAY_STATUS_LABEL.rejected },
];

function toIsoDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function presetRange(preset: RangePreset): { from: string; to: string } {
  const now = new Date();
  if (preset === 'current_month') {
    return { from: toIsoDate(new Date(now.getFullYear(), now.getMonth(), 1)), to: toIsoDate(now) };
  }
  const from = new Date(now);
  from.setDate(from.getDate() - 29);
  return { from: toIsoDate(from), to: toIsoDate(now) };
}

const FIELD_CLASS =
  'min-h-[44px] w-full rounded-[var(--ig-radius-md)] border border-ig-border-strong bg-ig-base px-3 py-2 text-ig-body-sm text-ig-fg-strong focus-visible:outline-none focus-visible:shadow-[var(--ig-focus-ring-outer)]';

export default function PontoHistoryPage() {
  const { session } = usePonto();
  const [preset, setPreset] = React.useState<RangePreset>('current_month');
  const [range, setRange] = React.useState(() => presetRange('current_month'));
  const [statusFilter, setStatusFilter] = React.useState<DayStatus | 'all'>('all');
  const [punches, setPunches] = React.useState<PunchRecord[] | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const [adjustDay, setAdjustDay] = React.useState<DayRecord | null>(null);
  const [submitting, setSubmitting] = React.useState(false);
  const [submitError, setSubmitError] = React.useState<string | null>(null);
  const [submitted, setSubmitted] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await pontoApi.history(range.from, range.to);
      setPunches(result.punches);
    } catch (e) {
      setPunches(null);
      setError(
        e instanceof PontoApiError && e.isOffline
          ? 'Sem conexão. Conecte-se para consultar o histórico.'
          : e instanceof Error
            ? e.message
            : 'Não foi possível carregar o histórico.',
      );
    } finally {
      setLoading(false);
    }
  }, [range.from, range.to]);

  React.useEffect(() => {
    void load();
  }, [load]);

  function applyPreset(next: RangePreset) {
    setPreset(next);
    if (next !== 'custom') setRange(presetRange(next));
  }

  const days = React.useMemo(() => (punches ? groupPunchesByDay(punches) : []), [punches]);
  const visibleDays = React.useMemo(
    () => (statusFilter === 'all' ? days : days.filter((day) => day.status === statusFilter)),
    [days, statusFilter],
  );
  const totalMinutes = React.useMemo(
    () => visibleDays.reduce((sum, day) => sum + day.summary.workedMinutes, 0),
    [visibleDays],
  );

  async function handleAdjustment(input: AdjustmentInput) {
    setSubmitting(true);
    setSubmitError(null);
    try {
      await pontoApi.createAdjustment(input);
      setSubmitted(true);
      setAdjustDay(null);
      await load();
    } catch (e) {
      setSubmitError(
        e instanceof Error ? e.message : 'Não foi possível enviar a solicitação. Tente novamente.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    /* No desktop os filtros viram uma coluna fixa à esquerda e a lista
       ocupa a largura restante em duas colunas. */
    <div className="xl:grid xl:grid-cols-[300px_minmax(0,1fr)] xl:items-start xl:gap-6">
      <div className="space-y-5 xl:sticky xl:top-28">
      <section>
        <SectionLabel icon={Filter}>Período</SectionLabel>
        <PontoCard className="space-y-3 p-4">
          <div className="flex flex-wrap gap-2">
            {(
              [
                { value: 'current_month', label: 'Mês atual' },
                { value: 'last_30', label: 'Últimos 30 dias' },
                { value: 'custom', label: 'Escolher período' },
              ] as Array<{ value: RangePreset; label: string }>
            ).map((option) => (
              <button
                key={option.value}
                type="button"
                aria-pressed={preset === option.value}
                onClick={() => applyPreset(option.value)}
                className={
                  preset === option.value
                    ? 'min-h-[44px] rounded-full border border-[color-mix(in_oklab,var(--ig-accent)_45%,transparent)] bg-ig-accent-weak px-4 text-ig-body-sm font-semibold text-ig-accent focus-visible:outline-none focus-visible:shadow-[var(--ig-focus-ring-outer)]'
                    : 'min-h-[44px] rounded-full border border-ig-border bg-ig-panel px-4 text-ig-body-sm text-ig-fg-muted hover:text-ig-fg-strong focus-visible:outline-none focus-visible:shadow-[var(--ig-focus-ring-outer)]'
                }
              >
                {option.label}
              </button>
            ))}
          </div>

          {preset === 'custom' ? (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label htmlFor="ponto-de" className="block text-ig-caption font-semibold text-ig-fg-strong">
                  De
                </label>
                <input
                  id="ponto-de"
                  type="date"
                  value={range.from}
                  max={range.to}
                  onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))}
                  className={FIELD_CLASS}
                />
              </div>
              <div className="space-y-1.5">
                <label htmlFor="ponto-ate" className="block text-ig-caption font-semibold text-ig-fg-strong">
                  Até
                </label>
                <input
                  id="ponto-ate"
                  type="date"
                  value={range.to}
                  min={range.from}
                  onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))}
                  className={FIELD_CLASS}
                />
              </div>
            </div>
          ) : null}

          <div className="space-y-1.5">
            <label htmlFor="ponto-status" className="block text-ig-caption font-semibold text-ig-fg-strong">
              Situação
            </label>
            <select
              id="ponto-status"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as DayStatus | 'all')}
              className={FIELD_CLASS}
            >
              {STATUS_FILTERS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </PontoCard>
      </section>
      </div>

      <div className="mt-5 space-y-5 xl:mt-0">
      {!loading && !error && visibleDays.length > 0 ? (
        <p className="ig-tabular px-1 text-ig-body-sm text-ig-fg-muted">
          {visibleDays.length} {visibleDays.length === 1 ? 'dia' : 'dias'} · total trabalhado{' '}
          <span className="font-semibold text-ig-accent">{formatDuration(totalMinutes)}</span>
        </p>
      ) : null}

      {loading ? (
        <div className="space-y-3" aria-busy="true">
          <PontoSkeleton className="h-[84px] w-full rounded-[var(--ig-radius-lg)]" />
          <PontoSkeleton className="h-[84px] w-full rounded-[var(--ig-radius-lg)]" />
          <PontoSkeleton className="h-[84px] w-full rounded-[var(--ig-radius-lg)]" />
          <p className="sr-only">Carregando o histórico</p>
        </div>
      ) : error ? (
        <PontoCard>
          <EmptyState
            icon={CircleAlert}
            title="Não foi possível carregar"
            description={error}
            action={
              <PontoButton variant="secondary" onClick={() => void load()}>
                Tentar novamente
              </PontoButton>
            }
          />
        </PontoCard>
      ) : visibleDays.length === 0 ? (
        <PontoCard>
          <EmptyState
            icon={Inbox}
            title={statusFilter === 'all' ? 'Nenhum registro no período' : 'Nenhum dia com essa situação'}
            description={
              statusFilter === 'all'
                ? 'Assim que você registrar pontos neste período, eles aparecem aqui.'
                : 'Experimente outro filtro de situação ou amplie o período.'
            }
          />
        </PontoCard>
      ) : (
        <div className="grid grid-cols-1 items-start gap-3 md:grid-cols-2">
          {visibleDays.map((day, index) => (
            <AttendanceHistoryCard
              key={day.date}
              day={day}
              defaultOpen={index === 0 && visibleDays.length <= 3}
              onRequestAdjustment={setAdjustDay}
            />
          ))}
        </div>
      )}

      {session.pending.length > 0 ? (
        <p className="flex items-start gap-2 px-1 text-ig-caption text-ig-fg-subtle">
          <CalendarRange className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {session.pending.length}{' '}
          {session.pending.length === 1 ? 'marcação ainda está' : 'marcações ainda estão'} salva
          {session.pending.length === 1 ? '' : 's'} no aparelho e só aparece
          {session.pending.length === 1 ? '' : 'm'} aqui depois de sincronizar.
        </p>
      ) : null}
      </div>

      <PontoSheet
        open={adjustDay !== null}
        onOpenChange={(open) => {
          if (!open) {
            setAdjustDay(null);
            setSubmitError(null);
          }
        }}
        title="Solicitar ajuste"
        description="Seu gestor recebe o pedido e responde por aqui."
      >
        {adjustDay ? (
          <AdjustmentRequestForm
            initialDate={adjustDay.date}
            originalPunchId={adjustDay.punches.at(-1)?.id}
            submitting={submitting}
            error={submitError}
            onSubmit={(input) => void handleAdjustment(input)}
            onCancel={() => setAdjustDay(null)}
          />
        ) : null}
      </PontoSheet>

      <PontoSheet
        open={submitted}
        onOpenChange={(open) => !open && setSubmitted(false)}
        title="Solicitação enviada"
        description="Você acompanha a resposta na aba Solicitações."
        footer={<PontoButton variant="primary" onClick={() => setSubmitted(false)}>Entendi</PontoButton>}
      >
        <p className="pb-2 text-ig-body-sm text-ig-fg-muted">
          Enquanto o gestor analisa, o pedido aparece como “Em análise”. Nenhuma marcação anterior foi
          apagada.
        </p>
      </PontoSheet>
    </div>
  );
}
