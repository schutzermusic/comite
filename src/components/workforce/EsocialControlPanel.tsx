'use client';

/**
 * Controle eSocial — o estado do ACERVO, não o estado do negócio.
 *
 * Mora dentro de Fechamento da Folha, e não em Governança, de propósito.
 * Governança trata de exceção operacional classificada para análise humana
 * (sobre-alocação, quebra de segregação, custo sem centro de custo); aqui a
 * pergunta é outra e mais seca: o que eu tenho no acervo, o que está faltando,
 * e o que ainda não dá para afirmar por causa disso. Misturar as duas encheria
 * a fila de exceções de log técnico e afogaria a análise que importa.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  Boxes,
  CalendarX2,
  FileWarning,
  GitCompare,
  History,
  RefreshCw,
  ServerCog,
} from 'lucide-react';
import {
  HudBadge,
  HudButton,
  HudEmptyState,
  HudKpiStrip,
  HudPanel,
  HudSignal,
  HudStatusPill,
  HudTable,
  type HudTableColumn,
  type KpiItem,
} from '@/components/hud';
import { ExportReportButton } from '@/components/reports/ExportReportButton';
import { PROC_EMI_LABELS } from '@/lib/workforce/esocial-audit';
import type {
  ClosureRow,
  CompetenceCoverageRow,
  DivergenceRow,
  EventTypeCount,
  ExclusionRow,
  OriginRow,
  RubricGapRow,
  UnmappedLotacaoRow,
} from '@/lib/workforce/esocial-audit';
import { openEsocialCoverageReport } from '@/lib/reports/modules/esocial-coverage-report';

const NA = '—';

export interface EsocialAuditPayload {
  ok: boolean;
  available: boolean;
  connected?: boolean;
  message?: string;
  lastSyncAt?: string | null;
  lastSyncStatus?: string | null;
  competences?: CompetenceCoverageRow[];
  missingCompetences?: string[];
  eventsByType?: EventTypeCount[];
  exclusions?: ExclusionRow[];
  closures?: ClosureRow[];
  origins?: OriginRow[];
  rubricGaps?: RubricGapRow[];
  unmappedLotacoes?: UnmappedLotacaoRow[];
  divergences?: DivergenceRow[];
  runs?: Record<string, unknown>[];
}

function competenceLabel(competence: string): string {
  if (/^\d{4}-13$/.test(competence)) return `13º ${competence.slice(0, 4)}`;
  const [year, month] = competence.split('-').map(Number);
  if (!year || !month) return competence;
  return new Date(year, month - 1, 1).toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' });
}

function brl(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
}

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

export interface EsocialControlPanelProps {
  /** Link para o painel de mapeamento de centro de custo (passo 2 do wizard). */
  onGoToCostCenterMapping?: () => void;
}

export function EsocialControlPanel({ onGoToCostCenterMapping }: EsocialControlPanelProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<EsocialAuditPayload | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/workforce/esocial-audit');
      const json = (await res.json()) as EsocialAuditPayload & { error?: string };
      if (!res.ok || !json.ok) throw new Error(json.error ?? 'Falha ao carregar o controle eSocial');
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao carregar o controle eSocial');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const competences = useMemo(() => data?.competences ?? [], [data]);
  const missing = useMemo(() => data?.missingCompetences ?? [], [data]);
  const eventsByType = useMemo(() => data?.eventsByType ?? [], [data]);
  const exclusions = useMemo(() => data?.exclusions ?? [], [data]);
  const origins = useMemo(() => data?.origins ?? [], [data]);
  const rubricGaps = useMemo(() => data?.rubricGaps ?? [], [data]);
  const unmapped = useMemo(() => data?.unmappedLotacoes ?? [], [data]);
  const divergences = useMemo(() => data?.divergences ?? [], [data]);
  const closures = useMemo(() => data?.closures ?? [], [data]);

  const totalEvents = eventsByType.reduce((s, e) => s + e.count, 0);
  const closedCount = competences.filter((c) => c.closed).length;
  const importedCount = competences.filter((c) => c.imported).length;

  const kpis: KpiItem[] = [
    {
      id: 'competences',
      label: 'Competências importadas',
      value: importedCount,
      icon: <Boxes className="h-4 w-4" />,
      deltaLabel: competences.length > 0 ? `Intervalo de ${competences.length} mês(es)` : undefined,
    },
    {
      id: 'missing',
      label: 'Competências faltando',
      value: missing.length,
      icon: <CalendarX2 className="h-4 w-4" />,
      variant: missing.length > 0 ? 'warning' : 'default',
      deltaLabel: 'Lacunas dentro do intervalo já coberto',
    },
    {
      id: 'closed',
      label: 'Com fechamento (S-1299)',
      value: `${closedCount}/${importedCount}`,
      deltaLabel: 'Totalizador não é fechamento',
    },
    {
      id: 'events',
      label: 'Eventos no acervo',
      value: totalEvents,
      icon: <ServerCog className="h-4 w-4" />,
      deltaLabel: `${eventsByType.length} tipo(s) distinto(s)`,
    },
  ];

  const competenceColumns: HudTableColumn<CompetenceCoverageRow>[] = [
    {
      key: 'competence',
      header: 'Competência',
      cell: (r) => <span className="text-sm font-medium text-ig-fg-strong">{competenceLabel(r.competence)}</span>,
    },
    {
      key: 'imported',
      header: 'Acervo',
      cell: (r) =>
        r.imported ? (
          <HudStatusPill size="sm" variant="active">Importada</HudStatusPill>
        ) : (
          // "Faltando no acervo", não "não transmitida": o pacote do eSocial
          // Download tem janela de retenção e a lacuna pode ser só de download.
          <HudStatusPill size="sm" variant="warning">Faltando no acervo</HudStatusPill>
        ),
    },
    {
      key: 'closed',
      header: 'Fechamento',
      cell: (r) =>
        r.closed ? (
          <HudBadge size="sm" variant="success">S-1299</HudBadge>
        ) : (
          <span className="text-sm text-ig-fg-subtle" title="Sem S-1299 no acervo — não significa competência aberta">
            {NA}
          </span>
        ),
    },
    {
      key: 'headcount',
      header: 'Quadro',
      align: 'right',
      cell: (r) => <span className="text-sm tabular-nums text-ig-fg-muted">{r.imported ? r.headcount : NA}</span>,
    },
    {
      key: 'events',
      header: 'Eventos',
      align: 'right',
      cell: (r) => <span className="text-sm tabular-nums text-ig-fg-muted">{r.eventCount || NA}</span>,
    },
    {
      key: 'totalizers',
      header: 'Totalizadores',
      cell: (r) => (
        <div className="flex flex-wrap gap-1">
          {r.totalizers.length > 0
            ? r.totalizers.map((t) => <HudBadge key={t} size="sm" variant="subtle">{t}</HudBadge>)
            : <span className="text-sm text-ig-fg-subtle">{NA}</span>}
        </div>
      ),
    },
  ];

  if (loading) {
    return (
      <HudPanel elevation={2}>
        <HudEmptyState icon="package" compact title="Carregando o acervo…" description="Lendo eventos, competências e mapeamentos." />
      </HudPanel>
    );
  }

  if (error) {
    return (
      <HudPanel state="critical">
        <p className="text-sm text-ig-danger">{error}</p>
        <HudButton className="mt-3" size="sm" variant="secondary" onClick={() => void reload()}>Tentar de novo</HudButton>
      </HudPanel>
    );
  }

  if (data && (!data.available || data.connected === false)) {
    return (
      <HudPanel elevation={2}>
        <HudEmptyState
          icon="package"
          title="Nenhum evento do eSocial no acervo"
          description={data.message ?? 'Importe o pacote do eSocial Download em Configurações → Integrações para começar a auditar a cobertura.'}
          action={{ label: 'Ir para Integrações', onClick: () => { window.location.href = '/configuracoes/integracoes'; } }}
        />
      </HudPanel>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-3xl text-[11px] leading-relaxed text-ig-fg-muted">
          O que está no acervo e o que falta para poder confiar nele. Lacunas aqui são lacunas do que
          foi <strong className="text-ig-fg-strong">baixado</strong> — o pacote do eSocial Download tem
          janela de retenção, então uma competência ausente não é, por si, uma competência não transmitida.
        </p>
        <div className="flex items-center gap-2">
          <HudButton size="sm" variant="secondary" leftIcon={<RefreshCw className="h-4 w-4" />} onClick={() => void reload()}>
            Atualizar
          </HudButton>
          <ExportReportButton
            size="sm"
            permission="people.view"
            build={() =>
              openEsocialCoverageReport({
                competences, missing, eventsByType, exclusions, origins,
                rubricGaps, unmapped, divergences, closures,
              })
            }
          />
        </div>
      </div>

      <HudKpiStrip kpis={kpis} columns={4} size="sm" />

      {/* ── Cobertura ── */}
      <HudPanel
        title="Cobertura por competência"
        subtitle="Sequência mensal entre a primeira e a última competência do acervo"
        icon={<Boxes className="h-4 w-4" />}
      >
        <HudTable<CompetenceCoverageRow>
          columns={competenceColumns}
          data={[...competences].reverse()}
          keyExtractor={(r) => r.competence}
          emptyState={<HudEmptyState icon="inbox" compact title="Nenhuma competência apurada" />}
        />
      </HudPanel>

      {/* ── Mapeamentos pendentes ── */}
      {(rubricGaps.length > 0 || unmapped.length > 0) && (
        <HudPanel
          title="Mapeamentos pendentes"
          subtitle="O que impede a composição da folha e o rateio por centro de custo"
          icon={<FileWarning className="h-4 w-4" />}
          state="warning"
        >
          <div className="grid gap-6 lg:grid-cols-2">
            <div>
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ig-fg-muted">
                Rubricas sem classificação
              </h4>
              {rubricGaps.length === 0 ? (
                <p className="text-sm text-ig-fg-subtle">Todas as verbas declaradas têm rubrica na tabela S-1010.</p>
              ) : (
                <div className="space-y-2">
                  {rubricGaps.slice(0, 8).map((g) => (
                    <div key={g.competence} className="flex items-center justify-between gap-3 border-b border-ig-border-subtle pb-2 last:border-0">
                      <span className="text-sm text-ig-fg-strong">{competenceLabel(g.competence)}</span>
                      <div className="flex items-center gap-3">
                        <span className="text-xs tabular-nums text-ig-fg-muted">{pct(g.coverage)} classificado</span>
                        <span className="text-sm tabular-nums text-ig-warning">{brl(g.unmappedCents)}</span>
                      </div>
                    </div>
                  ))}
                  <p className="pt-1 text-[11px] leading-relaxed text-ig-fg-muted">
                    Sem a tabela de rubricas completa, horas extras, benefícios e descontos ficam
                    indisponíveis — não zerados. Importe o S-1010 do período correspondente.
                  </p>
                </div>
              )}
            </div>

            <div>
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ig-fg-muted">
                Lotações sem centro de custo
              </h4>
              {unmapped.length === 0 ? (
                <p className="text-sm text-ig-fg-subtle">Todas as lotações do eSocial têm correspondência no financeiro.</p>
              ) : (
                <div className="space-y-2">
                  {unmapped.slice(0, 8).map((l) => (
                    <div key={l.areaCode} className="flex items-center justify-between gap-3 border-b border-ig-border-subtle pb-2 last:border-0">
                      <div className="min-w-0">
                        <p className="truncate text-sm text-ig-fg-strong">{l.areaLabel}</p>
                        <p className="font-mono text-[11px] text-ig-fg-muted">{l.areaCode} · {l.competences} competência(s)</p>
                      </div>
                      <span className="shrink-0 text-sm tabular-nums text-ig-warning">{brl(l.baseCents || l.grossCents)}</span>
                    </div>
                  ))}
                  {onGoToCostCenterMapping && (
                    <HudButton size="sm" variant="secondary" className="mt-2" onClick={onGoToCostCenterMapping}>
                      Abrir mapeamento de centros de custo
                    </HudButton>
                  )}
                </div>
              )}
            </div>
          </div>
        </HudPanel>
      )}

      {/* ── Divergências ── */}
      {divergences.length > 0 && (
        <HudPanel
          title="Divergências Apex × eSocial"
          subtitle="Diferença entre a folha importada e o que foi apurado pelo governo — mostrada, não julgada"
          icon={<GitCompare className="h-4 w-4" />}
        >
          <p className="mb-3 text-[11px] leading-relaxed text-ig-fg-muted">
            Divergir não é errar: rescisão complementar, competência reaberta e trabalhador sem vínculo
            produzem diferenças legítimas. O que a tabela faz é expor o par de números.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-ig-border text-left text-[11px] uppercase tracking-wide text-ig-fg-muted">
                  <th className="py-2 pr-3">Competência</th>
                  <th className="py-2 pr-3 text-right">Quadro eSocial</th>
                  <th className="py-2 pr-3 text-right">Quadro folha</th>
                  <th className="py-2 pr-3 text-right">Δ quadro</th>
                  <th className="py-2 pr-3 text-right">Bruto eSocial</th>
                  <th className="py-2 pr-3 text-right">Bruto folha</th>
                  <th className="py-2 text-right">Δ bruto</th>
                </tr>
              </thead>
              <tbody>
                {divergences.slice(0, 18).map((d) => (
                  <tr key={d.competence} className="border-b border-ig-border-subtle last:border-0">
                    <td className="py-2 pr-3 text-ig-fg-strong">{competenceLabel(d.competence)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums text-ig-fg-muted">{d.esocialHeadcount}</td>
                    <td className="py-2 pr-3 text-right tabular-nums text-ig-fg-muted">{d.payrollHeadcount ?? NA}</td>
                    <td className={`py-2 pr-3 text-right tabular-nums ${d.headcountDelta ? 'text-ig-warning' : 'text-ig-fg-subtle'}`}>
                      {d.headcountDelta === null ? NA : d.headcountDelta > 0 ? `+${d.headcountDelta}` : d.headcountDelta}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums text-ig-fg-muted">
                      {d.esocialGrossCents === null ? NA : brl(d.esocialGrossCents)}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums text-ig-fg-muted">
                      {d.payrollGrossCents === null ? NA : brl(d.payrollGrossCents)}
                    </td>
                    <td className={`py-2 text-right tabular-nums ${d.grossDeltaPct && Math.abs(d.grossDeltaPct) > 5 ? 'text-ig-warning' : 'text-ig-fg-subtle'}`}>
                      {d.grossDeltaPct === null ? NA : `${d.grossDeltaPct > 0 ? '+' : ''}${d.grossDeltaPct.toFixed(1)}%`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </HudPanel>
      )}

      {/* ── Eventos, origem e exclusões ── */}
      <div className="grid gap-6 lg:grid-cols-2">
        <HudPanel title="Eventos por tipo" subtitle="O que existe no acervo" icon={<ServerCog className="h-4 w-4" />}>
          <div className="space-y-1.5">
            {eventsByType.map((e) => (
              <div key={e.eventType} className="flex items-center justify-between gap-3 border-b border-ig-border-subtle pb-1.5 last:border-0">
                <span className="font-mono text-xs text-ig-fg-strong">{e.eventType}</span>
                <div className="flex items-center gap-3">
                  <span className="text-[11px] text-ig-fg-muted">{e.competences} competência(s)</span>
                  <span className="text-sm tabular-nums text-ig-fg-strong">{e.count}</span>
                </div>
              </div>
            ))}
            {eventsByType.length === 0 && <p className="text-sm text-ig-fg-subtle">Acervo vazio.</p>}
          </div>
        </HudPanel>

        <HudPanel title="Origem dos eventos" subtitle="procEmi / verProc do ideEvento" icon={<History className="h-4 w-4" />}>
          <p className="mb-3 text-[11px] leading-relaxed text-ig-fg-muted">
            Folha fechada pelo sistema do escritório e folha digitada no portal têm qualidade diferente,
            e o valor sozinho não conta essa diferença.
          </p>
          <div className="space-y-1.5">
            {origins.map((o, i) => (
              <div key={`${o.procEmi}-${o.verProc}-${i}`} className="flex items-center justify-between gap-3 border-b border-ig-border-subtle pb-1.5 last:border-0">
                <div className="min-w-0">
                  <p className="truncate text-sm text-ig-fg-strong">
                    {o.procEmi ? (PROC_EMI_LABELS[o.procEmi] ?? `procEmi ${o.procEmi}`) : 'Não declarado'}
                  </p>
                  <p className="font-mono text-[11px] text-ig-fg-muted">{o.verProc ?? NA}</p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <span className="text-[11px] text-ig-fg-muted">{o.competences} competência(s)</span>
                  <span className="text-sm tabular-nums text-ig-fg-strong">{o.count}</span>
                </div>
              </div>
            ))}
            {origins.length === 0 && (
              <p className="text-sm text-ig-fg-subtle">
                Sem procedência registrada. Ela é preenchida na próxima reapuração do acervo.
              </p>
            )}
          </div>
        </HudPanel>
      </div>

      {/* ── Exclusões ── */}
      {exclusions.length > 0 && (
        <HudPanel
          title="Eventos excluídos (S-3000)"
          subtitle="Exclusões são reportadas, e não aplicadas aos agregados"
          icon={<AlertTriangle className="h-4 w-4" />}
        >
          <p className="mb-3 text-[11px] leading-relaxed text-ig-fg-muted">
            Subtrair automaticamente um S-1200 excluído mudaria todo o histórico com base num casamento
            por recibo que ainda não é confiável o bastante. A lista existe para que se possa julgar se ele é.
          </p>
          <div className="space-y-1.5">
            {exclusions.slice(0, 20).map((x) => (
              <div key={x.eventId} className="flex items-center justify-between gap-3 border-b border-ig-border-subtle pb-1.5 last:border-0">
                <div className="min-w-0">
                  <p className="text-sm text-ig-fg-strong">
                    {x.targetEventType ?? 'Evento'} · {x.competence ? competenceLabel(x.competence) : NA}
                  </p>
                  <p className="font-mono text-[11px] text-ig-fg-muted">{x.targetReceipt ?? NA}</p>
                </div>
                {x.targetStillPresent ? (
                  <HudSignal label="alvo no acervo" tone="warning" size="sm" />
                ) : (
                  <HudSignal label="alvo fora do acervo" tone="neutral" size="sm" />
                )}
              </div>
            ))}
          </div>
        </HudPanel>
      )}
    </div>
  );
}
