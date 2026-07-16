'use client';

/**
 * Aprovações de Horas — exception-driven queue (spec seção 15).
 * Only entries with status='submitted' land here (clean submissions
 * auto-approve). Grouped by exception flag; approve/reject individual
 * or in bulk, with evidence context per entry.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Check, CheckSquare, Hourglass, X } from 'lucide-react';
import {
  HudBadge,
  HudButton,
  HudEmptyState,
  HudHeader,
  HudInput,
  HudKpiStrip,
  HudModal,
  HudPageLayout,
  HudPanel,
  useHudToast,
  type KpiItem,
} from '@/components/hud';
import type { TimeEntry, TimesheetExceptionFlag } from '@/lib/types/people';
import { EXCEPTION_FLAG_LABELS } from '@/lib/types/people';
import { approveEntry, getApprovalQueue, rejectEntry } from '@/lib/services/timesheet';
import { getProjectsAsync } from '@/lib/services/projects';

function formatHours(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return m > 0 ? `${h}h${String(m).padStart(2, '0')}` : `${h}h`;
}

function formatDate(date: string): string {
  const [y, m, d] = date.split('-');
  return `${d}/${m}/${y}`;
}

export default function AprovacoesPage() {
  const { notify } = useHudToast();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [queue, setQueue] = useState<TimeEntry[]>([]);
  const [projectNames, setProjectNames] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [flagFilter, setFlagFilter] = useState<TimesheetExceptionFlag | 'all'>('all');
  const [rejecting, setRejecting] = useState<TimeEntry[] | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [queueRes, projects] = await Promise.all([
        getApprovalQueue(),
        getProjectsAsync().catch(() => []),
      ]);
      setQueue(queueRes);
      setProjectNames(Object.fromEntries(projects.map((p) => [p.id, p.codigo || p.nome || p.id])));
      setSelected(new Set());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao carregar fila');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const flagCounts = useMemo(() => {
    const counts = new Map<TimesheetExceptionFlag, number>();
    for (const e of queue) for (const f of e.exceptionFlags) counts.set(f, (counts.get(f) ?? 0) + 1);
    return counts;
  }, [queue]);

  const filtered = useMemo(
    () =>
      flagFilter === 'all' ? queue : queue.filter((e) => e.exceptionFlags.includes(flagFilter)),
    [queue, flagFilter],
  );

  const kpis: KpiItem[] = useMemo(
    () => [
      {
        id: 'pending',
        label: 'Registros pendentes',
        value: queue.length,
        icon: <Hourglass className="h-4 w-4" />,
        onClick: () => setFlagFilter('all'),
        active: flagFilter === 'all',
      },
      {
        id: 'hours',
        label: 'Horas pendentes',
        value: formatHours(queue.reduce((s, e) => s + e.minutes, 0)),
      },
      ...(['no_active_allocation', 'over_capacity', 'time_overlap', 'over_planned'] as const).map(
        (f) => ({
          id: f,
          label: EXCEPTION_FLAG_LABELS[f],
          value: flagCounts.get(f) ?? 0,
          variant: (flagCounts.get(f) ?? 0) > 0 ? ('warning' as const) : ('default' as const),
          onClick: () => setFlagFilter((cur) => (cur === f ? 'all' : f)),
          active: flagFilter === f,
        }),
      ),
    ],
    [queue, flagCounts, flagFilter],
  );

  function toggleSelected(id: string) {
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleApprove(entries: TimeEntry[]) {
    setBusy(true);
    try {
      for (const e of entries) await approveEntry(e.id);
      notify(`${entries.length} apontamento(s) aprovado(s)`, { variant: 'success' });
      await reload();
    } catch (e) {
      notify('Erro ao aprovar', {
        description: e instanceof Error ? e.message : undefined,
        variant: 'error',
      });
    } finally {
      setBusy(false);
    }
  }

  const selectedEntries = filtered.filter((e) => selected.has(e.id));

  return (
    <HudPageLayout>
      <div className="space-y-6">
        <HudHeader
          title="Aprovações de Horas"
          subtitle="Fila orientada a exceções — registros limpos são aprovados automaticamente"
          icon={<CheckSquare className="h-5 w-5" />}
          breadcrumbs={[{ label: 'Pessoas & Custos', href: '/workforce-cost' }, { label: 'Aprovações' }]}
          actions={
            selectedEntries.length > 0 ? (
              <div className="flex items-center gap-2">
                <HudButton
                  variant="primary"
                  leftIcon={<Check className="h-4 w-4" />}
                  disabled={busy}
                  onClick={() => void handleApprove(selectedEntries)}
                >
                  Aprovar {selectedEntries.length} selecionado(s)
                </HudButton>
                <HudButton
                  variant="secondary"
                  leftIcon={<X className="h-4 w-4" />}
                  disabled={busy}
                  onClick={() => setRejecting(selectedEntries)}
                >
                  Rejeitar
                </HudButton>
              </div>
            ) : undefined
          }
        />

        {error && (
          <HudPanel state="critical">
            <p className="text-sm text-ig-danger">{error}</p>
          </HudPanel>
        )}

        <HudKpiStrip kpis={kpis} columns={6} />

        <HudPanel>
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-ig-border border-t-ig-accent" />
            </div>
          ) : filtered.length === 0 ? (
            <HudEmptyState
              icon="inbox"
              title="Fila vazia"
              description="Nenhum apontamento aguardando revisão. Registros sem exceções são aprovados automaticamente no envio."
            />
          ) : (
            <div className="space-y-2">
              {filtered.map((e) => (
                <div
                  key={e.id}
                  className={`flex flex-wrap items-center gap-3 rounded-lg border px-4 py-3 transition-colors ${
                    selected.has(e.id)
                      ? 'border-ig-border-focus bg-ig-accent-weak/40'
                      : 'border-ig-border-subtle bg-ig-panel/60 hover:bg-ig-panel-hover/40'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={selected.has(e.id)}
                    onChange={() => toggleSelected(e.id)}
                    className="h-4 w-4 accent-[var(--ig-accent)]"
                    aria-label="Selecionar registro"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-ig-fg-strong">
                      {e.person?.fullName ?? '—'}
                      <span className="ml-2 text-xs font-normal tabular-nums text-ig-fg-muted">
                        {formatDate(e.workDate)} · {formatHours(e.minutes)} ·{' '}
                        {projectNames[e.projectId] ?? e.projectId}
                      </span>
                    </p>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      {e.exceptionFlags.map((f) => (
                        <HudBadge key={f} variant="warning">
                          <AlertTriangle className="mr-1 h-3 w-3" />
                          {EXCEPTION_FLAG_LABELS[f]}
                        </HudBadge>
                      ))}
                      {e.description && (
                        <span className="text-xs text-ig-fg-muted">“{e.description}”</span>
                      )}
                      {!e.allocationId && (
                        <span className="text-[11px] text-ig-fg-muted">
                          · sem alocação vinculada
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <HudButton
                      variant="primary"
                      size="sm"
                      disabled={busy}
                      onClick={() => void handleApprove([e])}
                    >
                      Aprovar
                    </HudButton>
                    <HudButton
                      variant="ghost"
                      size="sm"
                      disabled={busy}
                      onClick={() => setRejecting([e])}
                    >
                      Rejeitar
                    </HudButton>
                  </div>
                </div>
              ))}
            </div>
          )}
        </HudPanel>
      </div>

      <RejectModal
        entries={rejecting}
        onClose={() => setRejecting(null)}
        onDone={async () => {
          setRejecting(null);
          await reload();
        }}
      />
    </HudPageLayout>
  );
}

/* ─────────────────────── RejectModal ─────────────────────────── */

function RejectModal({
  entries,
  onClose,
  onDone,
}: {
  entries: TimeEntry[] | null;
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const { notify } = useHudToast();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (entries) setReason('');
  }, [entries]);

  async function handleReject() {
    if (!entries || entries.length === 0) return;
    if (!reason.trim()) {
      notify('Informe o motivo da rejeição', { variant: 'warning' });
      return;
    }
    setBusy(true);
    try {
      for (const e of entries) await rejectEntry(e.id, reason.trim());
      notify(`${entries.length} apontamento(s) rejeitado(s)`, {
        description: 'O colaborador poderá corrigir e reenviar.',
        variant: 'success',
      });
      await onDone();
    } catch (e) {
      notify('Erro ao rejeitar', {
        description: e instanceof Error ? e.message : undefined,
        variant: 'error',
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <HudModal
      isOpen={Boolean(entries && entries.length > 0)}
      onClose={onClose}
      title={`Rejeitar ${entries?.length ?? 0} apontamento(s)`}
      subtitle="O registro volta para o colaborador como rejeitado, editável para correção"
      size="md"
      footer={
        <div className="flex justify-end gap-2">
          <HudButton variant="ghost" onClick={onClose}>
            Cancelar
          </HudButton>
          <HudButton variant="primary" onClick={() => void handleReject()} disabled={busy}>
            {busy ? 'Rejeitando…' : 'Rejeitar'}
          </HudButton>
        </div>
      }
    >
      <HudInput
        label="Motivo da rejeição"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Ex.: horas acima do executado em campo"
      />
    </HudModal>
  );
}
