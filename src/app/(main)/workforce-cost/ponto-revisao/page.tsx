'use client';

/**
 * Revisão de Ponto — fila de marcações "under_review" (fora do geofence ou
 * com falha de auth). O gestor (people.attendance_manage) confere a selfie
 * + a distância do geofence e aprova (accepted) ou rejeita (cancelled), com
 * nota e trilha de auditoria. Fecha o loop do ADR-008.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, MapPin, ScanFace, ShieldAlert, X } from 'lucide-react';
import {
  HudButton,
  HudEmptyState,
  HudHeader,
  HudKpiStrip,
  HudPageLayout,
  HudPanel,
  HudStatusPill,
  useHudToast,
  type KpiItem,
} from '@/components/hud';
import { usePermissions } from '@/hooks/use-permissions';
import { listReviewItems, resolvePunch, type ReviewItem } from '@/lib/ponto/review-client';

type JobRun = {
  id: string; job_type: string; started_at: string; status: string; dry_run: boolean;
  scanned: number; succeeded: number; failed: number; skipped: number; error_summary: string | null;
};
type JobsState = { automationEnabled: boolean; schedules: Record<string, string>; runs: JobRun[] };

const PUNCH_LABEL: Record<string, string> = {
  clock_in: 'Entrada',
  break_start: 'Início de intervalo',
  break_end: 'Retorno de intervalo',
  clock_out: 'Saída',
};

function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export default function PontoRevisaoPage() {
  const { hasPermission } = usePermissions();
  const { notify } = useHudToast();
  const canManage = hasPermission('people.attendance_manage');

  const [items, setItems] = useState<ReviewItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setItems(await listReviewItems());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao carregar revisões');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (canManage) void reload();
    else setLoading(false);
  }, [canManage, reload]);

  const kpis: KpiItem[] = useMemo(
    () => [
      { id: 'pending', label: 'Em revisão', value: items.length, icon: <ShieldAlert className="h-4 w-4" />, variant: items.length ? 'warning' : 'default' },
      { id: 'outfence', label: 'Fora do geofence', value: items.filter((i) => (i.location?.distanceMeters ?? 0) > 0).length },
      { id: 'nosel', label: 'Sem selfie', value: items.filter((i) => !i.selfieUrl && !i.selfiePurged).length },
    ],
    [items],
  );

  async function resolve(punchId: string, decision: 'accept' | 'reject') {
    setBusy(punchId);
    try {
      await resolvePunch(punchId, decision, notes[punchId]);
      notify(decision === 'accept' ? 'Marcação aprovada' : 'Marcação rejeitada', { variant: 'success' });
      setItems((prev) => prev.filter((i) => i.punchId !== punchId));
    } catch (e) {
      notify('Falha ao resolver', { description: e instanceof Error ? e.message : undefined, variant: 'error' });
    } finally {
      setBusy(null);
    }
  }

  if (!canManage) {
    return (
      <HudPageLayout>
        <HudPanel state="critical">
          <p className="text-sm text-ig-danger">Você não tem permissão para revisar marcações de ponto.</p>
        </HudPanel>
      </HudPageLayout>
    );
  }

  return (
    <HudPageLayout>
      <div className="space-y-6">
        <HudHeader
          title="Revisão de Ponto"
          subtitle="Marcações sinalizadas (fora do geofence ou falha de autenticação) aguardando decisão"
          icon={<ScanFace className="h-5 w-5" />}
          breadcrumbs={[{ label: 'Pessoas & Custos', href: '/workforce-cost' }, { label: 'Revisão de Ponto' }]}
        />

        {error && (
          <HudPanel state="critical">
            <p className="text-sm text-ig-danger">{error}</p>
          </HudPanel>
        )}

        <PontoJobsPanel />

        <HudKpiStrip kpis={kpis} columns={3} />

        {loading ? (
          <HudPanel><p className="py-6 text-center text-sm text-ig-fg-muted">Carregando…</p></HudPanel>
        ) : items.length === 0 ? (
          <HudPanel>
            <HudEmptyState icon="inbox" title="Nada para revisar" description="Todas as marcações estão dentro das regras. Novas exceções aparecem aqui automaticamente." />
          </HudPanel>
        ) : (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {items.map((item) => {
              const dist = item.location?.distanceMeters;
              return (
                <HudPanel key={item.punchId}>
                  <div className="flex gap-4">
                    <div className="h-28 w-28 shrink-0 overflow-hidden rounded-xl border border-ig-border-subtle bg-ig-panel-hover">
                      {item.selfieUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={item.selfieUrl} alt={`Selfie de ${item.personName}`} className="h-full w-full object-cover" />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center px-2 text-center text-[10px] text-ig-fg-subtle">
                          {item.selfiePurged ? 'Selfie expurgada (retenção)' : 'Sem selfie'}
                        </div>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-ig-fg-strong">{item.personName}</p>
                          <p className="text-xs text-ig-fg-muted">{PUNCH_LABEL[item.type] ?? item.type} · {fmtDateTime(item.occurredAt)}</p>
                        </div>
                        <HudStatusPill variant="warning" size="sm">Em revisão</HudStatusPill>
                      </div>
                      <div className="mt-2 space-y-1 text-xs text-ig-fg-muted">
                        <p className="flex items-center gap-1.5">
                          <MapPin className="h-3.5 w-3.5" />
                          {item.location
                            ? item.location.geofenceName
                              ? `${item.location.geofenceName}${dist != null ? ` · ${Math.round(dist)} m do limite` : ''}`
                              : dist != null ? `${Math.round(dist)} m do geofence` : 'Sem geofence associado'
                            : 'Sem localização capturada'}
                          {item.location?.accuracyMeters != null && <span className="text-ig-fg-subtle"> (±{Math.round(item.location.accuracyMeters)} m)</span>}
                        </p>
                        {item.authMethod && <p>Autenticação: {item.authMethod === 'facial_verification' ? 'selfie' : item.authMethod}</p>}
                      </div>
                    </div>
                  </div>

                  <textarea
                    value={notes[item.punchId] ?? ''}
                    onChange={(e) => setNotes((prev) => ({ ...prev, [item.punchId]: e.target.value }))}
                    placeholder="Nota da revisão (opcional)…"
                    rows={2}
                    className="mt-3 w-full resize-none rounded-lg border border-ig-border-subtle bg-ig-panel/50 px-3 py-2 text-sm text-ig-fg-strong outline-none focus:border-ig-border-focus"
                  />

                  <div className="mt-3 flex justify-end gap-2">
                    <HudButton variant="danger" disabled={busy === item.punchId} leftIcon={<X className="h-4 w-4" />} onClick={() => void resolve(item.punchId, 'reject')}>
                      Rejeitar
                    </HudButton>
                    <HudButton variant="primary" isLoading={busy === item.punchId} leftIcon={<Check className="h-4 w-4" />} onClick={() => void resolve(item.punchId, 'accept')}>
                      Aprovar
                    </HudButton>
                  </div>
                </HudPanel>
              );
            })}
          </div>
        )}
      </div>
    </HudPageLayout>
  );
}

/* ─────────────────────── Painel de automação/jobs ─────────────────────── */

function fmtJobTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function PontoJobsPanel() {
  const [state, setState] = useState<JobsState | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let active = true;
    void fetch('/api/ponto/jobs')
      .then((r) => r.json())
      .then((j) => { if (active) { if (j.ok) setState(j); else setError(true); } })
      .catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, []);

  if (error) return null;

  const cronRuns = state?.runs.filter((r) => r.job_type === 'cron') ?? [];
  const retRuns = state?.runs.filter((r) => r.job_type === 'retention') ?? [];
  const lastSuccess = state?.runs.find((r) => r.status === 'success' || r.status === 'partial') ?? null;
  const lastFailed = state?.runs.find((r) => r.status === 'failed') ?? null;

  return (
    <HudPanel>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ig-fg-muted">Automação do Ponto</p>
          <HudStatusPill variant={state?.automationEnabled ? 'active' : 'neutral'} size="sm">
            {state == null ? '…' : state.automationEnabled ? 'Ativada' : 'Desativada (dry-run)'}
          </HudStatusPill>
        </div>
        <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-ig-fg-muted">
          <span>Cron: <span className="text-ig-fg-strong">{state?.schedules.cron ?? '—'}</span></span>
          <span>Retenção: <span className="text-ig-fg-strong">{state?.schedules.retention ?? '—'}</span></span>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <JobStat label="Última execução OK" value={fmtJobTime(lastSuccess?.started_at ?? null)} sub={lastSuccess ? `${lastSuccess.succeeded} ok · ${lastSuccess.failed} falha` : undefined} />
        <JobStat label="Última falha" value={fmtJobTime(lastFailed?.started_at ?? null)} sub={lastFailed?.error_summary ?? undefined} tone={lastFailed ? 'danger' : undefined} />
        <JobStat label="Cron (últimas)" value={cronRuns.length ? `${cronRuns[0].succeeded} processados` : '—'} sub={cronRuns.length ? `${cronRuns[0].failed} falha · ${cronRuns[0].dry_run ? 'dry-run' : 'live'}` : undefined} />
        <JobStat label="Retenção (última)" value={retRuns.length ? `${retRuns[0].succeeded} removidos` : '—'} sub={retRuns.length ? `${retRuns[0].failed} falha · ${retRuns[0].dry_run ? 'dry-run' : 'live'}` : undefined} />
      </div>
    </HudPanel>
  );
}

function JobStat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'danger' }) {
  return (
    <div className="rounded-lg border border-ig-border-subtle bg-ig-panel/40 px-3 py-2">
      <p className="text-[10px] uppercase tracking-[0.08em] text-ig-fg-subtle">{label}</p>
      <p className={`text-sm font-semibold ${tone === 'danger' ? 'text-ig-danger' : 'text-ig-fg-strong'}`}>{value}</p>
      {sub && <p className="mt-0.5 truncate text-[11px] text-ig-fg-muted" title={sub}>{sub}</p>}
    </div>
  );
}
