'use client';

/**
 * O COCKPIT DE FATURAMENTO — os quatro níveis, numa tela.
 *
 *   A. resumo executivo do mês         → BillingMonthCockpit
 *   B. linha do tempo e previsão       → BillingForecastTimeline
 *   C. ledger detalhado do mês         → BillingMonthLedger
 *   D. histórico faturado / recebido   → ContractToCashPanel (o painel canônico)
 *
 * ─── A fronteira entre C e D, que é a fronteira do módulo ─────────────────
 *
 * C mostra MARCOS CONTRATUAIS — o que se espera faturar. D mostra EVENTOS DE
 * FATURAMENTO — o que alguém gerou. Não são a mesma lista com filtros
 * diferentes: a primeira existe antes de qualquer faturamento e continua
 * existindo mesmo com zero eventos; a segunda só passa a existir quando um ato
 * humano a cria. Foi exatamente por confundir as duas que uma previsão de
 * R$ 8 milhões já apareceu neste produto com a cara de dinheiro faturado.
 *
 * ─── Uma leitura, um instante ─────────────────────────────────────────────
 *
 * Tudo abaixo vem de UMA consulta à visão `contract_billing_month_plan`. Os
 * três níveis recortam o mesmo array em memória. Três consultas produziriam
 * três instantes da mesma carteira, e o total do mês poderia discordar da
 * soma das linhas na mesma tela.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, AlertTriangle, BellRing, RefreshCw } from 'lucide-react';
import { DossierSection, DossierDisclosure } from '../../shell/DossierPrimitives';
import { HudPanel } from '@/components/hud';
import {
  listBillingMonthPlan, listPendingMappingProposals,
  type MappingProposalRow,
} from '@/lib/contracts/billing/planning/month-plan-service';
import type { BillingMonthPlanRow } from '@/lib/contracts/billing/planning/month-plan-types';
import {
  buildMonthlyPortfolio, monthKey, shiftMonth, aggregateBy,
  deriveBillingPlanState, BILLING_PLAN_STATE_LABEL,
} from '@/lib/contracts/billing/planning/monthly-planning';
import { BillingMonthCockpit } from './BillingMonthCockpit';
import { BillingForecastTimeline } from './BillingForecastTimeline';
import { BillingMonthLedger } from './BillingMonthLedger';
import { MappingProposalsPanel } from './MappingProposalsPanel';
import { money, ABSENT } from './plan-format';

interface Props {
  readonly contractIds: readonly string[];
  readonly canEdit: boolean;
  readonly contractLabel: (contractId: string) => string;
  readonly clientLabel: (contractId: string) => string;
  readonly onOpenContract?: (contractId: string) => void;
  readonly onNotify: (message: string, variant: 'success' | 'error') => void;
  readonly refreshKey?: string | number;
}

export function BillingPlanningWorkspace({
  contractIds, canEdit, contractLabel, clientLabel, onOpenContract, onNotify,
  refreshKey = 0,
}: Props) {
  const [rows, setRows] = useState<BillingMonthPlanRow[] | null>(null);
  const [proposals, setProposals] = useState<readonly MappingProposalRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [dispatching, setDispatching] = useState(false);

  // `asOf` é fixado numa montagem. Recalcular `new Date()` a cada render faria
  // "hoje" mudar no meio de uma interação e o mês corrente piscar.
  const asOf = useMemo(() => new Date(), []);
  const [selectedMonth, setSelectedMonth] = useState(() => monthKey(new Date()));

  const idsKey = contractIds.join(',');

  const load = useCallback(async () => {
    try {
      setError(null);
      const ids = idsKey ? idsKey.split(',') : [];
      const [plan, pending] = await Promise.all([
        listBillingMonthPlan(ids),
        listPendingMappingProposals(ids),
      ]);
      setRows(plan);
      setProposals(pending);
    } catch (e) {
      // Lista vazia aqui se leria como "nada previsto", que é afirmação sobre a
      // carteira. A falha é sobre a LEITURA.
      setError(e instanceof Error ? e.message : 'Falha ao carregar o planejamento de faturamento.');
      setRows([]);
    }
  }, [idsKey]);

  // `refreshKey` diz QUANDO recarregar, não COMO: ele pertence ao efeito.
  useEffect(() => { void load(); }, [load, refreshKey]);

  const portfolio = useMemo(() => {
    if (!rows) return null;
    // A janela garante que o mês anterior, o corrente e os três seguintes
    // apareçam mesmo vazios.
    const current = monthKey(asOf);
    const window = [-1, 0, 1, 2, 3].map((d) => shiftMonth(current, d));
    return buildMonthlyPortfolio(rows, { asOf, window });
  }, [rows, asOf]);

  const monthRows = useMemo(
    () => portfolio?.months.find((m) => m.month === selectedMonth)?.rows ?? [],
    [portfolio, selectedMonth],
  );

  const timelineTitleById = useMemo(() => {
    const map = new Map<string, string>();
    for (const row of rows ?? []) {
      if (row.timelineItemId) {
        map.set(row.timelineItemId,
          row.timelineWbsCode ? `${row.timelineWbsCode} · ${row.timelineTitle ?? ''}` : (row.timelineTitle ?? ''));
      }
    }
    return map;
  }, [rows]);

  const milestoneByRuleId = useMemo(() => {
    const map = new Map<string, string>();
    for (const row of rows ?? []) {
      if (row.requirementId) map.set(row.requirementId, row.title);
    }
    return map;
  }, [rows]);

  const dispatchAlerts = async () => {
    setDispatching(true);
    try {
      const res = await fetch('/api/contracts/billing/alerts/dispatch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const json = await res.json() as {
        ok: boolean; error?: string;
        alerts_created?: number; in_app?: number;
        email?: string; whatsapp?: string;
      };
      if (!json.ok) throw new Error(json.error ?? 'Falha ao processar alertas.');
      // O texto NOMEIA o estado de cada canal. "Alertas enviados" esconderia
      // que o e-mail foi simulado e que o WhatsApp não tem provedor.
      const channels = [
        `${json.in_app ?? 0} no app`,
        json.email === 'sent' ? 'e-mail enviado'
          : json.email === 'simulated' ? 'e-mail simulado (sem provedor configurado)'
            : 'e-mail desativado',
        json.whatsapp === 'not_configured' ? 'WhatsApp sem provedor integrado' : null,
      ].filter(Boolean).join(' · ');
      onNotify(`${json.alerts_created ?? 0} alerta(s) novo(s) · ${channels}`, 'success');
      await load();
    } catch (e) {
      onNotify(e instanceof Error ? e.message : 'Falha ao processar alertas.', 'error');
    } finally {
      setDispatching(false);
    }
  };

  if (rows === null) {
    return (
      <HudPanel>
        <div className="flex items-center gap-2 p-6 text-ig-caption text-ig-fg-muted">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          Carregando o planejamento de faturamento…
        </div>
      </HudPanel>
    );
  }

  if (error) {
    return (
      <HudPanel>
        <div className="flex items-start gap-2 p-4 text-ig-caption text-ig-warning">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>{error}</span>
        </div>
      </HudPanel>
    );
  }

  if (!portfolio) return null;

  return (
    <div className="space-y-5">
      {/* ── A — resumo executivo do mês ───────────────────────────────── */}
      <DossierSection
        title="Planejamento mensal de faturamento"
        hint="Previsto, elegível, faturado e bloqueado — quatro verdades, nunca somadas."
        action={canEdit ? (
          <button
            type="button"
            className="portfolio-action"
            disabled={dispatching}
            onClick={dispatchAlerts}
          >
            {dispatching
              ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              : <BellRing className="h-3.5 w-3.5" aria-hidden />}
            Processar alertas de marco
          </button>
        ) : undefined}
      >
        <BillingMonthCockpit
          portfolio={portfolio}
          selectedMonth={selectedMonth}
          onSelectMonth={setSelectedMonth}
          onStepMonth={(delta) => setSelectedMonth((m) => shiftMonth(m, delta))}
        />
      </DossierSection>

      {/* ── B — linha do tempo e previsão rolante ─────────────────────── */}
      <DossierSection
        title="Previsão de faturamento"
        hint="Mês corrente, próximos 3 e 6 meses e horizonte completo do contrato."
      >
        <BillingForecastTimeline
          portfolio={portfolio}
          rows={rows}
          asOf={asOf}
          selectedMonth={selectedMonth}
          onSelectMonth={setSelectedMonth}
        />
      </DossierSection>

      {/* ── Governança da ponte com o cronograma ──────────────────────── */}
      <DossierSection
        title="Mapeamento cronograma → marco contratual"
        hint="A data prevista só vem do cronograma através de uma ponte aceita por uma pessoa."
        action={(
          <button type="button" className="portfolio-action" onClick={() => void load()}>
            <RefreshCw className="h-3.5 w-3.5" aria-hidden />
            Recarregar
          </button>
        )}
      >
        <MappingProposalsPanel
          proposals={proposals}
          canReview={canEdit}
          milestoneTitle={(ruleId) => milestoneByRuleId.get(ruleId) ?? 'Marco contratual'}
          timelineTitle={(id) => timelineTitleById.get(id) ?? 'Etapa do cronograma'}
          contractLabel={contractLabel}
          onReviewed={() => void load()}
          onNotify={onNotify}
        />
      </DossierSection>

      {/* ── C — ledger do mês ─────────────────────────────────────────── */}
      <DossierSection
        title={`Ledger de ${portfolio.months.find((m) => m.month === selectedMonth)?.label ?? selectedMonth}`}
        hint="Marcos CONTRATUAIS do mês. Evento de faturamento só aparece quando gerado."
      >
        <BillingMonthLedger
          rows={monthRows}
          asOf={asOf}
          contractLabel={contractLabel}
          clientLabel={clientLabel}
          onOpenMilestone={onOpenContract
            ? (row) => onOpenContract(row.contractId)
            : undefined}
        />
      </DossierSection>

      {/* ── Quebras por cliente e por contrato ────────────────────────── */}
      <DossierDisclosure title="Composição por cliente e por contrato">
        <div className="grid gap-4 lg:grid-cols-2">
          <Breakdown
            title="Por cliente"
            buckets={aggregateBy(monthRows, (r) => r.contractId, (id) => clientLabel(id))}
          />
          <Breakdown
            title="Por contrato"
            buckets={aggregateBy(monthRows, (r) => r.contractId, (id) => contractLabel(id))}
          />
        </div>
        <div className="mt-4">
          <Breakdown
            title="Por estado"
            buckets={aggregateBy(
              monthRows,
              (r) => deriveBillingPlanState(r),
              (key) => BILLING_PLAN_STATE_LABEL[key as keyof typeof BILLING_PLAN_STATE_LABEL],
            )}
          />
        </div>
      </DossierDisclosure>
    </div>
  );
}

function Breakdown({
  title, buckets,
}: {
  title: string;
  buckets: readonly { key: string; label: string; totals: { plannedTotal: number | null; billedTotal: number | null; count: number } }[];
}) {
  return (
    <div>
      <p className="text-ig-label font-semibold text-ig-fg-subtle">{title}</p>
      <div className="mt-2 space-y-1">
        {buckets.length === 0 && (
          <p className="dossier-meta">Sem marcos no mês selecionado.</p>
        )}
        {buckets.map((b) => (
          <div key={b.key} className="flex items-baseline justify-between gap-3 border-b border-ig-border-subtle py-1.5">
            <span className="min-w-0 truncate text-ig-caption text-ig-fg-default">{b.label}</span>
            <span className="shrink-0 text-ig-caption tabular-nums text-ig-fg-muted">
              {b.totals.count} · previsto{' '}
              <strong className="text-ig-fg-strong">
                {b.totals.plannedTotal === null ? ABSENT : money(b.totals.plannedTotal)}
              </strong>
              {b.totals.billedTotal !== null && (
                <> · faturado <strong className="text-ig-fg-strong">{money(b.totals.billedTotal)}</strong></>
              )}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
