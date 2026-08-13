'use client';

/**
 * SST / ASO & CAT — saúde e segurança do trabalho a partir do eSocial.
 *
 * Cobre três eventos que o conector já ingeria e nunca mostrava: S-2210 (CAT),
 * S-2220 (ASO) e S-2240 (agentes nocivos). Seção própria, e não uma aba dentro
 * de Folha & Encargos, porque acidente e exame ocupacional não são custo — e
 * porque a pergunta aqui é sobre PESSOA ("quem está sem ASO válido"), não sobre
 * competência.
 *
 * O ASO tem QUATRO estados nesta tela, e não dois. O leiaute do S-2220 não
 * declara vencimento, então ele só é apurável para o exame periódico; o resto
 * aparece em "sem vencimento apurável" em vez de aparecer, falsamente, como
 * "em dia". Ver `src/lib/esocial/connector/sst.ts`.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  Biohazard,
  CalendarClock,
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
import { openSstReport } from '@/lib/reports/modules/sst-report';
import { AsoDocumentsPanel } from '@/components/workforce/AsoDocumentsPanel';
import { AsoAlertsPanel } from '@/components/workforce/AsoAlertsPanel';

const NA = '—';

const ASO_STATUS_META: Record<AsoStatus, { label: string; pill: 'active' | 'warning' | 'error' | 'neutral' }> = {
  valid: { label: 'Em dia', pill: 'active' },
  expiring: { label: 'A vencer', pill: 'warning' },
  expired: { label: 'Vencido', pill: 'error' },
  // Deliberadamente neutro: não é bom nem ruim, é desconhecido.
  undetermined: { label: 'Sem vencimento apurável', pill: 'neutral' },
  absent: { label: 'Sem ASO no acervo', pill: 'neutral' },
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

  useEffect(() => {
    void reload();
  }, [reload]);

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
      {
        id: 'asos',
        label: 'ASOs realizados',
        value: n(summary.asosInPeriod),
        icon: <Stethoscope className="h-4 w-4" />,
        deltaLabel: periodLabel,
      },
      {
        id: 'aso-expired',
        label: 'ASOs vencidos',
        value: n(summary.asoExpired),
        icon: <CalendarClock className="h-4 w-4" />,
        variant: tone(summary.asoExpired, true),
        deltaLabel: 'Vencimento apurado e no passado',
      },
      {
        id: 'aso-expiring',
        label: 'ASOs a vencer (60d)',
        value: n(summary.asoExpiring),
        variant: summary.asoExpiring && summary.asoExpiring > 0 ? 'warning' : 'default',
      },
      {
        id: 'aso-absent',
        label: 'Sem ASO no acervo',
        value: n(summary.workersWithoutAso),
        icon: <Users className="h-4 w-4" />,
        variant: tone(summary.workersWithoutAso, true),
        deltaLabel: `De ${summary.activeWorkers} vínculo(s) ativo(s)`,
      },
      {
        id: 'aso-undetermined',
        label: 'Sem vencimento apurável',
        value: n(summary.asoUndetermined),
        // Nunca semântico: é uma lacuna de leiaute, não uma infração.
        variant: 'default',
        deltaLabel: 'Tipo de exame não estabelece periodicidade',
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
  }, [summary, hasArchive, periodLabel]);

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
      id: 'aso',
      label: 'ASO (S-2220)',
      badge: asosInPeriod.length || undefined,
      content: (
        <div className="space-y-6">
          <HudPanel
            title="Situação do ASO por trabalhador"
            subtitle="Sempre sobre o acervo inteiro — o exame que vale hoje pode ter sido feito fora do período filtrado"
          >
            <p className="mb-4 text-[11px] leading-relaxed text-ig-fg-muted">
              O leiaute do S-2220 não declara data de vencimento. Ela é apurada apenas para o exame{' '}
              <strong className="text-ig-fg-strong">periódico</strong>, pela periodicidade anual da NR-7.
              Admissional, retorno ao trabalho, mudança de risco e demissional aparecem como{' '}
              <strong className="text-ig-fg-strong">sem vencimento apurável</strong> — nunca como &ldquo;em dia&rdquo;.
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
                  title="Nenhum vínculo ativo apurado"
                  description="A situação do ASO é calculada sobre os vínculos ativos vindos do eSocial."
                />
              }
            />
          </HudPanel>
        </div>
      ),
    },
    {
      id: 'alerts',
      label: 'Alertas de vencimento',
      content: <AsoAlertsPanel refreshKey={asoVersion} />,
    },
    {
      id: 'documents',
      label: 'Documentos (ASO)',
      content: <AsoDocumentsPanel onChanged={() => setAsoVersion((v) => v + 1)} />,
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
        subtitle="Saúde e segurança do trabalho apurada dos eventos S-2210, S-2220 e S-2240 do eSocial"
        icon={<HeartPulse className="h-5 w-5" />}
        breadcrumbs={[{ label: 'Pessoas & Custos', href: '/workforce-cost' }, { label: 'SST / ASO & CAT' }]}
        statusChips={[
          { label: periodLabel, variant: 'info' },
          hasArchive
            ? { label: `${allEvents.length} evento(s) de SST`, variant: 'success' as const }
            : { label: 'sem acervo de SST', variant: 'neutral' as const },
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

      {/* Acervo vazio é um AVISO, e não uma parede.
          Enviar os PDFs dos ASOs não depende do eSocial — e é justamente o
          caminho mais curto para a seção ficar útil antes da primeira
          importação. Trocar as abas por um estado vazio esconderia o upload
          exatamente de quem mais precisa dele. */}
      {!loading && !error && !hasArchive && (
        <HudPanel elevation={2} state="warning">
          <HudEmptyState
            icon="package"
            compact
            title="Nenhum evento de SST no acervo do eSocial"
            description="CAT, exames e agentes nocivos chegam pelo pacote do eSocial Download. Enquanto ele não vem, os ASOs em PDF já podem ser enviados na aba Documentos — a validade escrita no papel vale mais que a inferida."
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

      <HudTabs tabs={tabs} variant="underline" defaultTab={hasArchive ? undefined : 'documents'} contentClassName="mt-5" />

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
