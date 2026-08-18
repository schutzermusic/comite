'use client';

/**
 * SST / ASO & CAT — saúde e segurança do trabalho.
 *
 * DUAS FONTES, COM PAPÉIS DIFERENTES E DECLARADOS
 *
 * O controle de ASO é feito pelo DOCUMENTO ORIGINAL: o PDF do atestado, enviado
 * pelo RH e aprovado na revisão. Ele é a fonte primária, funciona sozinho e não
 * depende de importação nenhuma — os indicadores de vencimento no topo saem
 * dele.
 *
 * O eSocial entra ao lado, e só onde tem o que dizer: CAT (S-2210), exposição a
 * agentes nocivos (S-2240) e, para o ASO, uma CONFERÊNCIA OPCIONAL contra o
 * S-2220. O leiaute do S-2220 não declara vencimento — ele nunca poderia
 * sustentar este controle sozinho, e é por isso que a ordem é essa.
 *
 * A tela mostra os dois eixos separados por colaborador: situação do DOCUMENTO
 * e situação do eSOCIAL. Nenhum estado do segundo bloqueia o primeiro, e
 * "documento não enviado" é pendência de acervo — nunca irregularidade.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  Biohazard,
  CalendarClock,
  FileUp,
  HeartPulse,
  RefreshCw,
  Stethoscope,
  Users,
} from 'lucide-react';
import {
  HudBadge,
  HudButton,
  HudEmptyState,
  HudHeader,
  HudKpiStrip,
  HudPageLayout,
  HudPanel,
  HudSelect,
  HudStatusPill,
  HudTable,
  HudTabs,
  type HudTab,
  type HudTableColumn,
  type KpiItem,
} from '@/components/hud';
import { ExportReportButton } from '@/components/reports/ExportReportButton';
import { usePermissions } from '@/hooks/use-permissions';
import {
  ASO_EXAM_KIND_LABELS,
  ASO_RESULT_LABELS,
  CAT_INITIATOR_LABELS,
  CAT_LOCAL_LABELS,
  CAT_TYPE_LABELS,
  RISK_ASSESSMENT_LABELS,
} from '@/lib/esocial/connector/sst';
import {
  agentExposure,
  asoStatusByWorker,
  catsByArea,
  filterByCompetence,
  sstCompetences,
  summarizeSst,
  type AsoStatus,
  type SstEvent,
  type SstWorker,
  type WorkerAsoStatus,
} from '@/lib/workforce/sst';
import { ASO_CONTROL_NOTICE, type AsoAlertSummary } from '@/lib/workforce/aso-alerts';
import { openSstReport } from '@/lib/reports/modules/sst-report';
import { AsoDocumentsPanel } from '@/components/workforce/AsoDocumentsPanel';
import { AsoAlertsPanel } from '@/components/workforce/AsoAlertsPanel';

const NA = '—';

/**
 * Estados do ASO apurados SÓ pelo eSocial.
 *
 * Este mapa vale apenas para a aba de conferência do S-2220, e não para o
 * controle. `absent` aqui significa "não há evento importado" — jamais "o
 * colaborador está sem ASO", que é uma afirmação que só o acervo de documentos
 * pode fazer.
 */
const ASO_STATUS_META: Record<AsoStatus, { label: string; pill: 'active' | 'warning' | 'error' | 'neutral' }> = {
  valid: { label: 'Em dia (pelo eSocial)', pill: 'active' },
  expiring: { label: 'A vencer (pelo eSocial)', pill: 'warning' },
  expired: { label: 'Vencido (pelo eSocial)', pill: 'error' },
  // Deliberadamente neutro: não é bom nem ruim, é desconhecido.
  undetermined: { label: 'Sem vencimento apurável', pill: 'neutral' },
  absent: { label: 'Sem evento S-2220', pill: 'neutral' },
};

function competenceLabel(competence: string): string {
  const [year, month] = competence.split('-').map(Number);
  return new Date(year, month - 1, 1).toLocaleDateString('pt-BR', { month: 'short', year: 'numeric' });
}

function dateLabel(value: string | null): string {
  return value ? value.split('-').reverse().join('/') : NA;
}

/** Rótulo de código tabelado; sem tradução conhecida, mostra o próprio código. */
function labelFor(map: Record<string, string>, code: string | null): string {
  if (!code) return NA;
  return map[code] ?? code;
}

interface SstResponse {
  ok: boolean;
  available: boolean;
  identified: boolean;
  events: SstEvent[];
  workers: SstWorker[];
  message?: string;
}

export default function SstPage() {
  const { hasPermission } = usePermissions();
  const canManageIntegrations = hasPermission('admin.manage_integrations');

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<SstResponse | null>(null);
  const [competence, setCompetence] = useState<string>('all');
  /** Sobe quando um ASO é enviado ou revisado, para a fila recarregar. */
  const [asoVersion, setAsoVersion] = useState(0);
  /** Resumo do acervo de documentos — a fonte dos KPIs de ASO no topo. */
  const [asoSummary, setAsoSummary] = useState<AsoAlertSummary | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/workforce/esocial-sst');
      const json = (await res.json()) as SstResponse & { error?: string };
      if (!res.ok || !json.ok) throw new Error(json.error ?? 'Falha ao carregar SST');
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao carregar SST');
    } finally {
      setLoading(false);
    }
  }, []);

  /**
   * Os indicadores de ASO vêm da fila de documentos, e não do acervo do
   * eSocial. Falha aqui NÃO derruba a página: a seção continua servindo CAT e
   * exposição, e os KPIs de ASO ficam ausentes em vez de zerados.
   */
  const reloadAso = useCallback(async () => {
    try {
      const res = await fetch('/api/workforce/aso-alerts');
      const json = (await res.json()) as { ok: boolean; summary?: AsoAlertSummary };
      setAsoSummary(res.ok && json.ok ? (json.summary ?? null) : null);
    } catch {
      setAsoSummary(null);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    void reloadAso();
  }, [reloadAso, asoVersion]);

  const allEvents = useMemo(() => data?.events ?? [], [data]);
  const workers = useMemo(() => data?.workers ?? [], [data]);
  const competences = useMemo(() => sstCompetences(allEvents), [allEvents]);

  const events = useMemo(
    () => filterByCompetence(allEvents, competence === 'all' ? undefined : competence),
    [allEvents, competence],
  );

  const summary = useMemo(
    () => summarizeSst(events, allEvents, workers),
    [events, allEvents, workers],
  );
  const asoStatuses = useMemo(() => asoStatusByWorker(allEvents, workers), [allEvents, workers]);
  const areas = useMemo(() => catsByArea(events), [events]);
  const agents = useMemo(() => agentExposure(events), [events]);

  const hasArchive = allEvents.length > 0;
  const periodLabel = competence === 'all' ? 'Todo o acervo' : competenceLabel(competence);

  /**
   * Indicador sem fonte fica AUSENTE, e sem tom semântico: pintar de verde uma
   * contagem que não foi apurada afirma "está tudo bem" sobre algo não medido.
   */
  const kpis: KpiItem[] = useMemo(() => {
    const n = (value: number | null) => (value === null ? '–' : value);
    const tone = (value: number | null, bad: boolean): KpiItem['variant'] =>
      value === null ? 'default' : value > 0 && bad ? 'danger' : 'default';

    return [
      {
        id: 'cats',
        label: 'CATs no período',
        value: n(summary.catsInPeriod),
        icon: <AlertTriangle className="h-4 w-4" />,
        variant: tone(summary.catsInPeriod, true),
        deltaLabel: hasArchive ? periodLabel : 'Sem eventos de SST no acervo',
      },
      {
        id: 'cats-leave',
        label: 'CATs com afastamento',
        value: n(summary.catsWithLeave),
        variant: tone(summary.catsWithLeave, true),
        deltaLabel:
          summary.catsWithLeaveUndeclared && summary.catsWithLeaveUndeclared > 0
            ? `${summary.catsWithLeaveUndeclared} não declararam`
            : 'Declarado no atestado',
      },
      // ── ASO: apurado sobre o ACERVO DE DOCUMENTOS, não sobre o eSocial ──
      // Enquanto a fila não carrega, o valor é ausente ('–') e não zero: zero
      // afirmaria que não há nenhum ASO vencido, que é o oposto de "não sei".
      {
        id: 'aso-expired',
        label: 'ASOs vencidos',
        value: asoSummary ? asoSummary.expired : '–',
        icon: <CalendarClock className="h-4 w-4" />,
        variant: asoSummary && asoSummary.expired > 0 ? 'danger' : 'default',
        deltaLabel: 'Sobre documento aprovado',
      },
      {
        id: 'aso-expiring',
        label: 'ASOs a vencer (30d)',
        value: asoSummary ? asoSummary.expiring30 : '–',
        variant: asoSummary && asoSummary.expiring30 > 0 ? 'warning' : 'default',
      },
      {
        id: 'aso-missing',
        label: 'Documento não enviado',
        value: asoSummary ? asoSummary.noDocument : '–',
        icon: <FileUp className="h-4 w-4" />,
        // Nunca semântico: é pendência de acervo, não irregularidade.
        variant: 'default',
        deltaLabel: 'Anexe o PDF do atestado',
      },
      {
        id: 'aso-pending',
        label: 'ASOs aguardando revisão',
        value: asoSummary ? asoSummary.pendingReview : '–',
        icon: <Stethoscope className="h-4 w-4" />,
        variant: asoSummary && asoSummary.pendingReview > 0 ? 'warning' : 'default',
        deltaLabel: 'Nenhum é aprovado automaticamente',
      },
      {
        id: 'aso-undetermined',
        label: 'Sem vencimento apurável',
        value: asoSummary ? asoSummary.noValidity : '–',
        // Nunca semântico: é lacuna do papel, não uma infração.
        variant: 'default',
        deltaLabel: 'O documento não declarou validade',
      },
      {
        id: 'aso-divergent',
        label: 'Divergem do S-2220',
        value: asoSummary ? asoSummary.esocialDivergent : '–',
        icon: <Users className="h-4 w-4" />,
        variant: 'default',
        deltaLabel: 'Conferência opcional com o eSocial',
      },
      {
        id: 'exposed',
        label: 'Expostos a agente nocivo',
        value: n(summary.exposedWorkers),
        icon: <Biohazard className="h-4 w-4" />,
        deltaLabel:
          summary.distinctAgents !== null ? `${summary.distinctAgents} agente(s) distinto(s)` : undefined,
      },
    ];
  }, [summary, hasArchive, periodLabel, asoSummary]);

  // ── Colunas ──────────────────────────────────────────────────────────────
  const catColumns: HudTableColumn<SstEvent>[] = [
    {
      key: 'date',
      header: 'Data',
      cell: (r) => <span className="text-sm tabular-nums text-ig-fg-strong">{dateLabel(r.eventDate)}</span>,
    },
    {
      key: 'worker',
      header: 'Trabalhador',
      cell: (r) => (
        <div className="min-w-0">
          <p className="truncate text-sm text-ig-fg-strong">{r.workerName ?? 'Identificação restrita'}</p>
          <p className="text-xs text-ig-fg-muted">{r.workerMask ?? r.areaLabel ?? NA}</p>
        </div>
      ),
    },
    { key: 'area', header: 'Lotação', cell: (r) => <span className="text-sm text-ig-fg-muted">{r.areaLabel ?? NA}</span> },
    {
      key: 'type',
      header: 'Tipo',
      cell: (r) => <HudBadge variant="subtle" size="sm">{labelFor(CAT_TYPE_LABELS, r.cat?.catType ?? null)}</HudBadge>,
    },
    { key: 'local', header: 'Local', cell: (r) => <span className="text-sm text-ig-fg-muted">{labelFor(CAT_LOCAL_LABELS, r.cat?.localKind ?? null)}</span> },
    {
      key: 'initiator',
      header: 'Iniciativa',
      cell: (r) => <span className="text-xs text-ig-fg-muted">{labelFor(CAT_INITIATOR_LABELS, r.cat?.initiator ?? null)}</span>,
    },
    {
      key: 'leave',
      header: 'Afastou',
      cell: (r) =>
        r.cat?.causedLeave === true ? (
          <HudStatusPill size="sm" variant="error">Sim</HudStatusPill>
        ) : r.cat?.causedLeave === false ? (
          <HudStatusPill size="sm" variant="neutral">Não</HudStatusPill>
        ) : (
          // Não declarado ≠ não afastou. O traço diz isso.
          <span className="text-sm text-ig-fg-subtle" title="O evento não declarou afastamento">{NA}</span>
        ),
    },
  ];

  const asoColumns: HudTableColumn<WorkerAsoStatus>[] = [
    {
      key: 'worker',
      header: 'Trabalhador',
      cell: (r) => (
        <div className="min-w-0">
          <p className="truncate text-sm text-ig-fg-strong">{r.worker.name ?? 'Identificação restrita'}</p>
          <p className="text-xs text-ig-fg-muted">{r.worker.areaLabel ?? NA}</p>
        </div>
      ),
    },
    {
      key: 'exam',
      header: 'Último exame',
      cell: (r) => (
        <div>
          <p className="text-sm tabular-nums text-ig-fg-strong">{dateLabel(r.lastExamDate)}</p>
          <p className="text-xs text-ig-fg-muted">{labelFor(ASO_EXAM_KIND_LABELS, r.lastExamKind)}</p>
        </div>
      ),
    },
    {
      key: 'validUntil',
      header: 'Vence em',
      align: 'right',
      cell: (r) => (
        <span className="text-sm tabular-nums text-ig-fg-strong">
          {r.validUntil ? dateLabel(r.validUntil) : NA}
        </span>
      ),
    },
    {
      key: 'days',
      header: 'Dias',
      align: 'right',
      cell: (r) => (
        <span className="text-sm tabular-nums text-ig-fg-muted">
          {r.daysToExpiry === null ? NA : r.daysToExpiry}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Situação',
      cell: (r) => (
        <HudStatusPill size="sm" variant={ASO_STATUS_META[r.status].pill}>
          {ASO_STATUS_META[r.status].label}
        </HudStatusPill>
      ),
    },
  ];

  const exposureColumns: HudTableColumn<SstEvent>[] = [
    {
      key: 'worker',
      header: 'Trabalhador',
      cell: (r) => (
        <div className="min-w-0">
          <p className="truncate text-sm text-ig-fg-strong">{r.workerName ?? 'Identificação restrita'}</p>
          <p className="text-xs text-ig-fg-muted">{r.areaLabel ?? NA}</p>
        </div>
      ),
    },
    {
      key: 'period',
      header: 'Exposição',
      cell: (r) => (
        <span className="text-sm tabular-nums text-ig-fg-muted">
          {dateLabel(r.exposure?.start ?? null)} → {r.exposure?.end ? dateLabel(r.exposure.end) : 'em aberto'}
        </span>
      ),
    },
    { key: 'env', header: 'Ambiente', cell: (r) => <span className="text-sm text-ig-fg-muted">{r.exposure?.environmentCode ?? NA}</span> },
    {
      key: 'agents',
      header: 'Agentes nocivos',
      cell: (r) => (
        <div className="flex flex-wrap gap-1">
          {(r.exposure?.agents ?? []).map((a, i) => (
            <HudBadge key={`${a.code}-${i}`} size="sm" variant={a.epiEfficient === false ? 'warning' : 'subtle'}>
              {a.description ?? a.code}
              {a.assessment ? ` · ${labelFor(RISK_ASSESSMENT_LABELS, a.assessment)}` : ''}
              {a.intensity && a.toleranceLimit ? ` · ${a.intensity}/${a.toleranceLimit}` : ''}
            </HudBadge>
          ))}
          {(r.exposure?.agents ?? []).length === 0 && <span className="text-sm text-ig-fg-subtle">{NA}</span>}
        </div>
      ),
    },
  ];

  const cats = events.filter((e) => e.eventType === 'S-2210');
  const exposures = events.filter((e) => e.eventType === 'S-2240');
  const asosInPeriod = events.filter((e) => e.eventType === 'S-2220');

  const tabs: HudTab[] = [
    {
      id: 'cat',
      label: 'CAT (S-2210)',
      badge: cats.length || undefined,
      content: (
        <div className="space-y-6">
          <HudPanel title="Comunicações de Acidente de Trabalho" subtitle={periodLabel}>
            <HudTable<SstEvent>
              columns={catColumns}
              data={cats}
              keyExtractor={(r) => r.eventId}
              loading={loading}
              emptyState={
                <HudEmptyState
                  icon="inbox"
                  compact
                  title="Nenhuma CAT no período"
                  description="Comunicações de acidente chegam pelo pacote do eSocial Download (evento S-2210)."
                />
              }
            />
          </HudPanel>

          {areas.length > 0 && (
            <HudPanel title="Acidentes por lotação" subtitle="Onde os acidentes se concentram">
              <div className="space-y-2">
                {areas.map((a) => (
                  <div key={a.areaLabel} className="flex items-center justify-between gap-4 border-b border-ig-border-subtle pb-2 last:border-0">
                    <span className="truncate text-sm text-ig-fg-strong">{a.areaLabel}</span>
                    <div className="flex shrink-0 items-center gap-3">
                      <span className="text-sm tabular-nums text-ig-fg-muted">{a.total} CAT(s)</span>
                      {a.withLeave > 0 && (
                        <HudBadge size="sm" variant="warning">{a.withLeave} com afastamento</HudBadge>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </HudPanel>
          )}
        </div>
      ),
    },
    {
      id: 'documents',
      label: 'ASO — acervo de documentos',
      content: <AsoDocumentsPanel onChanged={() => setAsoVersion((v) => v + 1)} />,
    },
    {
      id: 'alerts',
      label: 'ASO — vencimentos',
      badge: asoSummary && asoSummary.actionable > 0 ? asoSummary.actionable : undefined,
      content: <AsoAlertsPanel refreshKey={asoVersion} />,
    },
    {
      id: 'aso',
      label: 'Conferência S-2220 (opcional)',
      badge: asosInPeriod.length || undefined,
      content: (
        <div className="space-y-6">
          <HudPanel
            title="O que o eSocial diz sobre os exames"
            subtitle="Conferência opcional — não é esta aba que controla o vencimento"
          >
            <p className="mb-4 text-[11px] leading-relaxed text-ig-fg-muted">
              O leiaute do S-2220 <strong className="text-ig-fg-strong">não declara data de
              vencimento</strong>. O que se vê aqui é uma dedução: apurada só para o exame{' '}
              <strong className="text-ig-fg-strong">periódico</strong>, pela periodicidade anual da
              NR-7. Admissional, retorno ao trabalho, mudança de risco e demissional aparecem como{' '}
              <strong className="text-ig-fg-strong">sem vencimento apurável</strong> — nunca como
              &ldquo;em dia&rdquo;. Por isso o controle de verdade fica nas duas abas anteriores, sobre
              o documento original; esta serve para achar erro de transmissão.
            </p>
            <HudTable<WorkerAsoStatus>
              columns={asoColumns}
              data={[...asoStatuses].sort((a, b) => {
                const order: AsoStatus[] = ['expired', 'expiring', 'absent', 'undetermined', 'valid'];
                return order.indexOf(a.status) - order.indexOf(b.status);
              })}
              keyExtractor={(r) => r.worker.workerKey}
              loading={loading}
              emptyState={
                <HudEmptyState
                  icon="inbox"
                  compact
                  title="Nenhum evento S-2220 importado"
                  description="Esta aba só existe quando há pacote do eSocial no acervo. O controle de ASO não depende dela."
                />
              }
            />
          </HudPanel>
        </div>
      ),
    },
    {
      id: 'exposure',
      label: 'Exposição a risco (S-2240)',
      badge: exposures.length || undefined,
      content: (
        <div className="space-y-6">
          <HudPanel title="Condições ambientais declaradas" subtitle={periodLabel}>
            <HudTable<SstEvent>
              columns={exposureColumns}
              data={exposures}
              keyExtractor={(r) => r.eventId}
              loading={loading}
              emptyState={
                <HudEmptyState
                  icon="inbox"
                  compact
                  title="Nenhuma exposição declarada no período"
                  description="Agentes nocivos chegam pelo evento S-2240 do pacote do eSocial Download."
                />
              }
            />
          </HudPanel>

          {agents.length > 0 && (
            <HudPanel title="Agentes nocivos" subtitle="Alcance de cada agente declarado">
              <div className="space-y-2">
                {agents.map((a) => (
                  <div key={a.code} className="flex items-center justify-between gap-4 border-b border-ig-border-subtle pb-2 last:border-0">
                    <div className="min-w-0">
                      <p className="truncate text-sm text-ig-fg-strong">{a.description ?? a.code}</p>
                      <p className="font-mono text-[11px] text-ig-fg-muted">{a.code}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                      {a.assessment && (
                        <HudBadge size="sm" variant="subtle">{labelFor(RISK_ASSESSMENT_LABELS, a.assessment)}</HudBadge>
                      )}
                      <span className="text-sm tabular-nums text-ig-fg-muted">{a.workers} trabalhador(es)</span>
                    </div>
                  </div>
                ))}
              </div>
            </HudPanel>
          )}
        </div>
      ),
    },
  ];

  return (
    <HudPageLayout>
      <HudHeader
        title="SST / ASO & CAT"
        subtitle={ASO_CONTROL_NOTICE}
        icon={<HeartPulse className="h-5 w-5" />}
        breadcrumbs={[{ label: 'Pessoas & Custos', href: '/workforce-cost' }, { label: 'SST / ASO & CAT' }]}
        statusChips={[
          { label: periodLabel, variant: 'info' },
          { label: 'ASO pelo documento original', variant: 'success' as const },
          hasArchive
            ? { label: `${allEvents.length} evento(s) de SST no eSocial`, variant: 'info' as const }
            : { label: 'eSocial não importado (opcional)', variant: 'neutral' as const },
          ...(data && !data.identified
            ? [{ label: 'identificação restrita', variant: 'warning' as const }]
            : []),
        ]}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {competences.length > 0 && (
              <div className="w-44">
                <HudSelect
                  value={competence}
                  onChange={setCompetence}
                  options={[
                    { value: 'all', label: 'Todo o acervo' },
                    ...competences.map((c) => ({ value: c, label: competenceLabel(c) })),
                  ]}
                />
              </div>
            )}
            <HudButton
              variant="secondary"
              size="sm"
              leftIcon={<RefreshCw className="h-4 w-4" />}
              onClick={() => void reload()}
            >
              Atualizar
            </HudButton>
            <ExportReportButton
              size="sm"
              permission="people.view"
              build={() =>
                openSstReport({
                  summary,
                  cats,
                  asoStatuses,
                  exposures,
                  areas,
                  agents,
                  periodLabel,
                  identified: data?.identified ?? false,
                })
              }
            />
          </div>
        }
      />

      {error && (
        <HudPanel state="critical">
          <p className="text-sm text-ig-danger">{error}</p>
        </HudPanel>
      )}

      {data && !data.available && (
        <HudPanel state="warning">
          <p className="text-sm text-ig-warning">{data.message}</p>
        </HudPanel>
      )}

      {/* eSocial ausente é INFORMAÇÃO, não alerta.
          O controle de ASO não depende dele: os PDFs sustentam a seção inteira.
          O que a importação acrescenta é CAT, exposição a agentes nocivos e a
          conferência do S-2220 — coisas que faltam, e não coisas que quebraram.
          Pintar isso de aviso ensinaria que a seção está incompleta quando ela
          está funcionando exatamente como deve. */}
      {!loading && !error && !hasArchive && (
        <HudPanel elevation={2}>
          <HudEmptyState
            icon="package"
            compact
            title="eSocial não importado — o ASO funciona sem ele"
            description="O controle de saúde ocupacional é feito pelos PDFs dos atestados, na aba de acervo. A importação do eSocial acrescenta CAT (S-2210), exposição a agentes nocivos (S-2240) e a conferência opcional do S-2220 contra os documentos."
            action={
              canManageIntegrations
                ? { label: 'Ir para Integrações', onClick: () => { window.location.href = '/configuracoes/integracoes'; } }
                : undefined
            }
          />
        </HudPanel>
      )}

      <HudKpiStrip kpis={kpis} columns={4} size="sm" />

      {data && !data.identified && (
        <HudPanel elevation={1}>
          <p className="text-[11px] leading-relaxed text-ig-fg-muted">
            Você está vendo os fatos e as contagens, mas não a identificação dos trabalhadores.
            Nome e CPF de eventos de saúde ocupacional exigem a permissão{' '}
            <code className="font-mono text-ig-fg-strong">people.view_sensitive_data</code>.
          </p>
        </HudPanel>
      )}

      {/* Abre no acervo de documentos: é a fonte primária, e é o que o RH vem
          fazer aqui todo dia. A aba de CAT continua a primeira da lista porque
          o evento é o mais grave, mas não é a mais usada. */}
      <HudTabs tabs={tabs} variant="underline" defaultTab="documents" contentClassName="mt-5" />

      <p className="text-[11px] text-ig-fg-muted">
        Precisa do controle técnico do acervo (competências faltantes, eventos por tipo, exclusões)?
        Ele fica em{' '}
        <Link href="/workforce-cost/fechamento-folha?tab=esocial" className="text-ig-accent hover:underline">
          Fechamento da Folha → Controle eSocial
        </Link>
        .
      </p>
    </HudPageLayout>
  );
}
