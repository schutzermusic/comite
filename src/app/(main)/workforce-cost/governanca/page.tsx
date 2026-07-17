'use client';

/**
 * Governança — cockpit de exceções operacionais (Fase 7, spec §18, D3).
 * Classifica (não acusa fraude, ADR-008) sobre-alocação, quebra de
 * segregação de funções, horas em projeto encerrado, custo sem centro de
 * custo, correções recorrentes e folha sem alocação, com workflow de
 * análise/resolução. Trilha de auditoria é append-only (enforced no banco).
 */

import type React from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Eye,
  ScanSearch,
  ShieldCheck,
  XCircle,
} from 'lucide-react';
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
  HudStatusPill,
  useHudToast,
  type KpiItem,
} from '@/components/hud';
import { usePermissions } from '@/hooks/use-permissions';
import type {
  GovernanceException,
  GovernanceExceptionType,
  GovernanceSeverity,
  GovernanceStatus,
} from '@/lib/types/people';
import {
  GOVERNANCE_SEVERITY_LABELS,
  GOVERNANCE_TYPE_LABELS,
} from '@/lib/types/people';
import {
  dismissException,
  listExceptions,
  resolveException,
  scanExceptions,
  startReview,
} from '@/lib/services/governance';
import { DEMO_EXCEPTIONS } from '@/components/workforce/governance-demo-data';

const SEVERITY_ORDER: Record<GovernanceSeverity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
};

const SEVERITY_PILL: Record<GovernanceSeverity, 'critical' | 'error' | 'warning' | 'info' | 'neutral'> = {
  critical: 'critical',
  high: 'error',
  medium: 'warning',
  low: 'info',
  info: 'neutral',
};

const STATUS_PILL: Record<GovernanceStatus, 'active' | 'pending' | 'neutral' | 'warning'> = {
  open: 'warning',
  under_review: 'pending',
  resolved: 'active',
  dismissed: 'neutral',
};

const STATUS_LABEL: Record<GovernanceStatus, string> = {
  open: 'Aberta',
  under_review: 'Em análise',
  resolved: 'Resolvida',
  dismissed: 'Dispensada',
};

export default function GovernancaPage() {
  const { hasPermission } = usePermissions();
  const { notify } = useHudToast();
  const canManage = hasPermission('people.governance_manage');

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exceptions, setExceptions] = useState<GovernanceException[]>([]);
  const [statusFilter, setStatusFilter] = useState<GovernanceStatus | 'open_all'>('open_all');
  const [typeFilter, setTypeFilter] = useState<GovernanceExceptionType | 'all'>('all');
  const [busy, setBusy] = useState(false);
  const [resolving, setResolving] = useState<{ ex: GovernanceException; mode: 'resolve' | 'dismiss' } | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setExceptions(await listExceptions({ status: 'all' }));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao carregar exceções');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const usingDemo = !loading && !error && exceptions.length === 0;
  const source = usingDemo ? DEMO_EXCEPTIONS : exceptions;

  async function handleScan() {
    setBusy(true);
    try {
      const result = await scanExceptions();
      notify('Varredura concluída', {
        description:
          result.detected === 0
            ? 'Nenhuma exceção detectada nos dados atuais.'
            : `${result.detected} exceção(ões) classificada(s).`,
        variant: 'success',
      });
      await reload();
    } catch (e) {
      notify('Erro na varredura', {
        description: e instanceof Error ? e.message : undefined,
        variant: 'error',
      });
    } finally {
      setBusy(false);
    }
  }

  async function handleReview(ex: GovernanceException) {
    try {
      await startReview(ex.id);
      await reload();
    } catch (e) {
      notify('Erro ao iniciar análise', {
        description: e instanceof Error ? e.message : undefined,
        variant: 'error',
      });
    }
  }

  const kpis: KpiItem[] = useMemo(() => {
    const open = source.filter((e) => e.status === 'open').length;
    const critical = source.filter(
      (e) => (e.severity === 'critical' || e.severity === 'high') && e.status !== 'resolved' && e.status !== 'dismissed',
    ).length;
    const review = source.filter((e) => e.status === 'under_review').length;
    const resolved = source.filter((e) => e.status === 'resolved').length;
    return [
      { id: 'open', label: 'Exceções abertas', value: open, variant: open > 0 ? 'warning' : 'default', icon: <AlertTriangle className="h-4 w-4" /> },
      { id: 'critical', label: 'Alta / crítica', value: critical, variant: critical > 0 ? 'danger' : 'default', tintValue: critical > 0 },
      { id: 'review', label: 'Em análise', value: review, icon: <Eye className="h-4 w-4" /> },
      { id: 'resolved', label: 'Resolvidas', value: resolved, variant: 'success', icon: <ShieldCheck className="h-4 w-4" /> },
    ];
  }, [source]);

  const typeCounts = useMemo(() => {
    const m = new Map<GovernanceExceptionType, number>();
    for (const e of source) {
      if (e.status === 'resolved' || e.status === 'dismissed') continue;
      m.set(e.type, (m.get(e.type) ?? 0) + 1);
    }
    return m;
  }, [source]);

  const filtered = useMemo(() => {
    return source
      .filter((e) => {
        if (statusFilter === 'open_all') {
          if (e.status === 'resolved' || e.status === 'dismissed') return false;
        } else if (e.status !== statusFilter) return false;
        if (typeFilter !== 'all' && e.type !== typeFilter) return false;
        return true;
      })
      .sort((a, b) => {
        const s = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
        return s !== 0 ? s : b.detectedAt.localeCompare(a.detectedAt);
      });
  }, [source, statusFilter, typeFilter]);

  return (
    <HudPageLayout>
      <div className="space-y-6">
        <HudHeader
          title="Governança de Pessoas & Custos"
          subtitle="Exceções operacionais classificadas para análise — não é acusação de fraude"
          icon={<ShieldCheck className="h-5 w-5" />}
          breadcrumbs={[{ label: 'Pessoas & Custos', href: '/workforce-cost' }, { label: 'Governança' }]}
          actions={
            canManage ? (
              <HudButton
                variant="primary"
                leftIcon={<ScanSearch className="h-4 w-4" />}
                disabled={busy}
                onClick={() => void handleScan()}
              >
                {busy ? 'Varrendo…' : 'Executar varredura'}
              </HudButton>
            ) : undefined
          }
        />

        {usingDemo && (
          <div className="flex items-center gap-2">
            <HudBadge variant="warning">dados demonstrativos</HudBadge>
            <span className="text-xs text-ig-fg-muted">
              Nenhuma exceção registrada — exibindo exemplo. Execute a varredura para classificar os
              dados reais.
            </span>
          </div>
        )}
        {error && (
          <HudPanel state="critical">
            <p className="text-sm text-ig-danger">{error}</p>
          </HudPanel>
        )}

        <HudKpiStrip kpis={kpis} columns={4} />

        {/* filtro por tipo (chips) */}
        <div className="flex flex-wrap items-center gap-2">
          <FilterChip active={typeFilter === 'all'} onClick={() => setTypeFilter('all')}>
            Todos os tipos
          </FilterChip>
          {(Object.keys(GOVERNANCE_TYPE_LABELS) as GovernanceExceptionType[]).map((t) => (
            <FilterChip key={t} active={typeFilter === t} onClick={() => setTypeFilter(t)}>
              {GOVERNANCE_TYPE_LABELS[t]}
              {typeCounts.get(t) ? (
                <span className="ml-1.5 tabular-nums text-ig-fg-muted">{typeCounts.get(t)}</span>
              ) : null}
            </FilterChip>
          ))}
          <div className="ml-auto flex items-center gap-2">
            <FilterChip active={statusFilter === 'open_all'} onClick={() => setStatusFilter('open_all')}>
              Ativas
            </FilterChip>
            <FilterChip active={statusFilter === 'resolved'} onClick={() => setStatusFilter('resolved')}>
              Resolvidas
            </FilterChip>
            <FilterChip active={statusFilter === 'dismissed'} onClick={() => setStatusFilter('dismissed')}>
              Dispensadas
            </FilterChip>
          </div>
        </div>

        <HudPanel>
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-ig-border border-t-ig-accent" />
            </div>
          ) : filtered.length === 0 ? (
            <HudEmptyState
              icon="alert"
              title={statusFilter === 'open_all' ? 'Nenhuma exceção ativa' : 'Nada aqui'}
              description={
                canManage
                  ? 'Execute a varredura para classificar alocação, jornada e custo. Registros normais não geram exceção.'
                  : 'Sem exceções para os filtros atuais.'
              }
            />
          ) : (
            <div className="space-y-2">
              {filtered.map((ex) => (
                <div
                  key={ex.id}
                  className="flex flex-wrap items-start gap-3 rounded-lg border border-ig-border-subtle bg-ig-panel/60 px-4 py-3"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <HudStatusPill variant={SEVERITY_PILL[ex.severity]} size="sm">
                        {GOVERNANCE_SEVERITY_LABELS[ex.severity]}
                      </HudStatusPill>
                      <HudBadge variant="neutral">{GOVERNANCE_TYPE_LABELS[ex.type]}</HudBadge>
                      <HudStatusPill variant={STATUS_PILL[ex.status]} size="sm">
                        {STATUS_LABEL[ex.status]}
                      </HudStatusPill>
                    </div>
                    <p className="mt-1.5 text-sm font-medium text-ig-fg-strong">{ex.title}</p>
                    <p className="text-xs text-ig-fg-muted">
                      {ex.person?.fullName ? `${ex.person.fullName} · ` : ''}
                      {ex.projectId ? `Projeto ${ex.projectId} · ` : ''}
                      Detectada em {new Date(ex.detectedAt).toLocaleDateString('pt-BR')}
                      {ex.resolutionNotes ? ` · Nota: ${ex.resolutionNotes}` : ''}
                    </p>
                  </div>
                  {canManage && ex.status !== 'resolved' && ex.status !== 'dismissed' && (
                    <div className="flex items-center gap-1.5">
                      {ex.status === 'open' && (
                        <HudButton
                          variant="ghost"
                          size="sm"
                          leftIcon={<Eye className="h-3.5 w-3.5" />}
                          onClick={() => {
                            if (usingDemo) return notify('Indisponível em modo demo', { variant: 'warning' });
                            void handleReview(ex);
                          }}
                        >
                          Analisar
                        </HudButton>
                      )}
                      <HudButton
                        variant="secondary"
                        size="sm"
                        leftIcon={<CheckCircle2 className="h-3.5 w-3.5" />}
                        onClick={() => {
                          if (usingDemo) return notify('Indisponível em modo demo', { variant: 'warning' });
                          setResolving({ ex, mode: 'resolve' });
                        }}
                      >
                        Resolver
                      </HudButton>
                      <HudButton
                        variant="ghost"
                        size="sm"
                        leftIcon={<XCircle className="h-3.5 w-3.5" />}
                        onClick={() => {
                          if (usingDemo) return notify('Indisponível em modo demo', { variant: 'warning' });
                          setResolving({ ex, mode: 'dismiss' });
                        }}
                      >
                        Dispensar
                      </HudButton>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </HudPanel>

        <p className="text-[11px] text-ig-fg-muted">
          A trilha de auditoria destas ações é <strong>append-only</strong> (imutável, reforçada no
          banco). Consulte o histórico completo em Administração → Auditoria.
        </p>
      </div>

      <ResolveModal
        target={resolving}
        onClose={() => setResolving(null)}
        onDone={async () => {
          setResolving(null);
          await reload();
        }}
      />
    </HudPageLayout>
  );
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
        active
          ? 'border-ig-border-focus bg-ig-accent-weak text-ig-accent'
          : 'border-ig-border-subtle text-ig-fg-muted hover:bg-ig-panel-hover'
      }`}
    >
      {children}
    </button>
  );
}

function ResolveModal({
  target,
  onClose,
  onDone,
}: {
  target: { ex: GovernanceException; mode: 'resolve' | 'dismiss' } | null;
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const { notify } = useHudToast();
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (target) setNotes('');
  }, [target]);

  async function handleConfirm() {
    if (!target) return;
    if (!notes.trim()) {
      notify('Informe uma nota de encaminhamento', { variant: 'warning' });
      return;
    }
    setBusy(true);
    try {
      if (target.mode === 'resolve') await resolveException(target.ex.id, notes.trim());
      else await dismissException(target.ex.id, notes.trim());
      notify(target.mode === 'resolve' ? 'Exceção resolvida' : 'Exceção dispensada', {
        variant: 'success',
      });
      await onDone();
    } catch (e) {
      notify('Erro ao encaminhar', {
        description: e instanceof Error ? e.message : undefined,
        variant: 'error',
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <HudModal
      isOpen={Boolean(target)}
      onClose={onClose}
      title={target?.mode === 'resolve' ? 'Resolver exceção' : 'Dispensar exceção'}
      subtitle={target?.ex.title}
      size="md"
      footer={
        <div className="flex justify-end gap-2">
          <HudButton variant="ghost" onClick={onClose}>
            Cancelar
          </HudButton>
          <HudButton variant="primary" onClick={() => void handleConfirm()} disabled={busy}>
            {busy ? 'Registrando…' : target?.mode === 'resolve' ? 'Resolver' : 'Dispensar'}
          </HudButton>
        </div>
      }
    >
      <HudInput
        label="Nota de encaminhamento (registrada na auditoria)"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder={
          target?.mode === 'resolve'
            ? 'Ex.: alocação ajustada para 90% com aprovação da diretoria'
            : 'Ex.: exceção esperada — colaborador em transição entre projetos'
        }
      />
    </HudModal>
  );
}
