'use client';

/**
 * Obrigações estruturadas — o modelo canônico da Fase 3 na tela.
 *
 * ─── O que este painel mostra, e por quê nessa ordem ───────────────────────
 *
 * Primeiro o que precisa de atenção: atrasada, vence hoje, e — na mesma
 * altura — o que NÃO SE SABE. "Não sei quando vence" é trabalho tanto quanto
 * "venceu ontem", e esconder o desconhecido atrás do conhecido faz o operador
 * descobrir a lacuna quando o cliente cobra.
 *
 * ─── Três valores, três cores, nenhuma inferência ──────────────────────────
 *
 * Bloqueio de faturamento tem três respostas, e a terceira não é uma falha do
 * sistema: é a resposta correta quando ninguém apurou se aquela obrigação é
 * pré-requisito de faturar. Pintá-la de verde seria liberar dinheiro por
 * ignorância; pintá-la de vermelho seria travar por ignorância. Ela tem cor
 * própria e diz o que é.
 *
 * Nada aqui calcula estado. O resolvedor já respondeu; este arquivo desenha.
 */

import { useState } from 'react';
import { PortfolioSearch, PortfolioEmpty, matchesPortfolioSearch } from '../portfolio/PortfolioControls';
import { DossierDetailDrawer, DossierStatus } from '../shell/DossierPrimitives';
import { cn } from '@/lib/utils';
import { AlertTriangle, CalendarClock, CircleHelp, FileWarning, Landmark, ShieldOff } from 'lucide-react';
import { HudPanel, HudEmptyState, HudSignal, type HudSignalTone } from '@/components/hud';
import type { ObligationAttentionRow, ObligationPortfolio } from '@/lib/contracts/obligations/portfolio';
import type { ObligationResponsibleSide, ObligationUrgency, Tristate } from '@/lib/contracts/obligations/types';

const URGENCY_LABEL: Record<ObligationUrgency, string> = {
  OVERDUE: 'Em atraso',
  DUE: 'Vence hoje',
  AWAITING_SCHEDULE_ANCHOR: 'Aguardando agenda',
  UNKNOWN: 'Prazo não apurado',
  UPCOMING: 'No prazo',
  NOT_APPLICABLE: 'Encerradas',
};

/** O que cada faixa quer dizer — visível na tela, não só no código. */
const URGENCY_HINT: Record<ObligationUrgency, string> = {
  OVERDUE: 'O prazo passou e nada foi registrado como cumprido.',
  DUE: 'Vence na data de referência.',
  AWAITING_SCHEDULE_ANCHOR:
    'O Apex já entendeu a exigência. O prazo aparece quando Projetos agendar o evento.',
  UNKNOWN: 'A regra é conhecida, a data não — falta a âncora ou o calendário.',
  UPCOMING: 'Prazo ainda por vir.',
  NOT_APPLICABLE: 'Cumpridas, dispensadas ou canceladas.',
};

const URGENCY_TONE: Record<ObligationUrgency, { text: string; rail: string; chip: HudSignalTone }> = {
  OVERDUE: { text: 'text-ig-danger', rail: 'bg-ig-danger', chip: 'critical' },
  DUE: { text: 'text-ig-warning', rail: 'bg-ig-warning', chip: 'warning' },
  // Azul de INFORMAÇÃO, não cinza de lacuna: esperar a agenda é o estado
  // correto da exigência, e não uma pendência de quem está lendo a tela.
  AWAITING_SCHEDULE_ANCHOR: { text: 'text-ig-accent', rail: 'bg-ig-accent', chip: 'accent' },
  UNKNOWN: { text: 'text-ig-fg-muted', rail: 'bg-ig-border-strong', chip: 'neutral' },
  UPCOMING: { text: 'text-ig-success', rail: 'bg-ig-success', chip: 'success' },
  NOT_APPLICABLE: { text: 'text-ig-fg-muted', rail: 'bg-ig-border', chip: 'neutral' },
};

const ORDER: ObligationUrgency[] = [
  'OVERDUE', 'DUE', 'AWAITING_SCHEDULE_ANCHOR', 'UNKNOWN', 'UPCOMING', 'NOT_APPLICABLE',
];

const SIDE_LABEL: Record<ObligationResponsibleSide, string> = {
  contracting_organization: 'Nossa responsabilidade',
  counterparty: 'Do cliente',
  supplier: 'Do fornecedor',
  third_party: 'De terceiro',
  shared: 'Compartilhada',
  unknown: 'Lado não apurado',
};

function BillingChip({ state }: { state: Tristate }) {
  if (state === 'FALSE') return null;
  const blocking = state === 'TRUE';
  return (
    <HudSignal
      size="sm"
      tone={blocking ? 'danger' : 'neutral'}
      icon={<Landmark aria-hidden />}
      label={blocking ? 'Bloqueia faturamento' : 'Bloqueio não apurado'}
    />
  );
}

function EvidenceChip({ state }: { state: Tristate }) {
  if (state === 'TRUE') return null;
  return (
    <HudSignal
      size="sm"
      tone={state === 'FALSE' ? 'warning' : 'neutral'}
      icon={<FileWarning aria-hidden />}
      label={state === 'FALSE' ? 'Evidência faltando' : 'Evidência sem aceite'}
    />
  );
}

function Row({ row, onOpenContract }: { row: ObligationAttentionRow; onOpenContract?: (id: string) => void }) {
  const tone = URGENCY_TONE[row.urgency];
  return (
    <li className="relative flex flex-col gap-2 rounded-xl border border-ig-border bg-ig-panel p-3 pl-4">
      <span className={cn('absolute inset-y-2 left-0 w-1 rounded-full', tone.rail)} aria-hidden />
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-ig-fg-strong">{row.title}</p>
          {onOpenContract ? <button type="button" onClick={() => onOpenContract(row.contractId)} className="mt-0.5 text-xs text-ig-fg-muted hover:text-ig-accent">{row.contractTitle} · {row.occurrenceKey}</button> : <p className="mt-0.5 text-xs text-ig-fg-muted">{row.contractTitle} · {row.occurrenceKey}</p>}
        </div>
        <HudSignal size="sm" className="shrink-0" label={URGENCY_LABEL[row.urgency]} tone={tone.chip} />
      </div>

      <div className="flex flex-wrap items-center gap-2 text-[11px] text-ig-fg-muted">
        <span className="inline-flex items-center gap-1">
          <CalendarClock className="h-3 w-3" />
          {/* Sem data, o painel diz POR QUE não há data — o motivo é a informação. */}
          {row.dueDate ?? (row.dueBasis ? `sem prazo: ${row.dueBasis}` : 'sem prazo apurado')}
        </span>
        <span>·</span>
        <span>{SIDE_LABEL[row.responsibleSide]}</span>
        {row.obligor && <><span>·</span><span className="truncate">{row.obligor}</span></>}
        {row.provenance.clauseId && (
          <><span>·</span><span>Cláusula{row.provenance.page ? `, p. ${row.provenance.page}` : ''}</span></>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <BillingChip state={row.blocksBilling} />
        <EvidenceChip state={row.evidenceComplete} />
        {row.hasEffectiveException && (
          <HudSignal size="sm" tone="neutral" icon={<ShieldOff aria-hidden />} label="Dispensa vigente" />
        )}
        {row.escalationSeverity && (
          <HudSignal
            size="sm"
            tone="warning"
            icon={<AlertTriangle aria-hidden />}
            label={`Escalonamento ${row.escalationSeverity}`}
          />
        )}
      </div>
    </li>
  );
}

export interface StructuredObligationsPanelProps {
  portfolio: ObligationPortfolio;
  onOpenContract?: (contractId: string) => void;
  className?: string;
}

export function StructuredObligationsPanel({
  portfolio, onOpenContract, className,
}: StructuredObligationsPanelProps) {
  const [selected, setSelected] = useState<ObligationUrgency | null>(null);
  const [query, setQuery] = useState('');
  const [detailId, setDetailId] = useState<string | null>(null);
  const detail = portfolio.rows.find((row) => row.instanceId === detailId);
  const shown = portfolio.rows.filter((r) => (!selected || r.urgency === selected) && matchesPortfolioSearch(query, r.title, r.contractTitle, r.obligor));
  const total = portfolio.rows.length;

  return (
    <HudPanel
      title="Obrigações contratuais"
      subtitle={`Situação em ${portfolio.asOf}`}
      icon={<CalendarClock className="h-4 w-4" />}
      className={className}
    >
      {/* As faixas ficam sempre visíveis, inclusive zeradas. */}
      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
        {ORDER.map((urgency) => {
          const active = selected === urgency;
          return (
            <button
              key={urgency}
              type="button"
              title={URGENCY_HINT[urgency]}
              aria-pressed={active}
              onClick={() => setSelected(active ? null : urgency)}
              className={cn(
                'rounded-xl border p-3 text-left transition-colors',
                active ? 'border-ig-accent bg-ig-accent/5' : 'border-ig-border hover:border-ig-border-strong',
              )}
            >
              <p className={cn('text-xl font-semibold tabular-nums', URGENCY_TONE[urgency].text)}>
                {portfolio.counts[urgency]}
              </p>
              <p className="mt-0.5 text-[11px] leading-tight text-ig-fg-muted">{URGENCY_LABEL[urgency]}</p>
            </button>
          );
        })}
      </div>

      {portfolio.billingBlockedContracts.length > 0 && (
        <p className="mb-3 flex items-start gap-2 rounded-lg border border-ig-danger/35 bg-ig-danger/5 p-3 text-xs text-ig-danger">
          <Landmark className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            Faturamento contratualmente bloqueado em {portfolio.billingBlockedContracts.length} contrato(s):{' '}
            {portfolio.billingBlockedContracts.join(', ')}.
          </span>
        </p>
      )}
      {portfolio.billingUnknownContracts.length > 0 && (
        <p className="mb-3 flex items-start gap-2 rounded-lg border border-ig-border-strong p-3 text-xs text-ig-fg-muted">
          <CircleHelp className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            Em {portfolio.billingUnknownContracts.length} contrato(s) não é possível afirmar se o faturamento está
            liberado — falta apurar se a obrigação é pré-requisito ou quando ela passa a valer:{' '}
            {portfolio.billingUnknownContracts.join(', ')}.
          </span>
        </p>
      )}

      <PortfolioSearch value={query} onChange={setQuery} label="Buscar obrigação, contrato ou responsável" count={shown.length}>
        {selected && <button className="portfolio-action" type="button" onClick={() => setSelected(null)}>Todas as situações</button>}
      </PortfolioSearch>
      {selected === 'NOT_APPLICABLE' ? (
        <PortfolioEmpty title={`${portfolio.counts.NOT_APPLICABLE} ocorrência(s) encerrada(s)`} description="Ocorrências encerradas não integram a fila de atenção. Consulte o histórico no dossiê do contrato." onReset={() => setSelected(null)} />
      ) : total === 0 ? (
        <HudEmptyState
          icon="inbox"
          title="Nenhuma ocorrência na fila de atenção"
          description={
            portfolio.contractsWithoutObligations.length > 0
              ? `Há ${portfolio.contractsWithoutObligations.length} contrato(s) sem obrigação estruturada. O registro deve indicar a cláusula, o aditivo ou o documento de origem.`
              : 'Ocorrências encerradas ficam fora desta fila. Consulte o contrato para verificar obrigações, vigência e histórico.'
          }
        />
      ) : (
        <div>
          {shown.length === 0 && <PortfolioEmpty onReset={() => { setQuery(''); setSelected(null); }} />}
          {shown.map((row) => <button type="button" className="dossier-row" key={row.instanceId} aria-haspopup="dialog" onClick={() => setDetailId(row.instanceId)}>
            <div className="min-w-0 flex-1"><p className="dossier-row-title">{row.title}</p><p className="dossier-meta">{row.contractTitle} · {row.obligor ?? SIDE_LABEL[row.responsibleSide]}</p>
              <div className="mt-2 flex flex-wrap gap-2"><BillingChip state={row.blocksBilling} /><EvidenceChip state={row.evidenceComplete} /></div>
            </div>
            <div className="space-y-1"><DossierStatus tone={row.urgency === 'OVERDUE' ? 'critical' : row.urgency === 'DUE' ? 'attention' : row.urgency === 'UPCOMING' ? 'positive' : 'unknown'}>{URGENCY_LABEL[row.urgency]}</DossierStatus><p className="dossier-meta">{row.dueDate ?? 'Prazo não definido'}</p></div>
          </button>)}
        </div>
      )}

      {portfolio.contractsWithoutObligations.length > 0 && total > 0 && (
        <p className="mt-3 text-[11px] text-ig-fg-muted">
          {portfolio.contractsWithoutObligations.length} contrato(s) ainda sem obrigação estruturada mapeada — lacuna
          de controle, não ausência de obrigação.
        </p>
      )}
      <DossierDetailDrawer isOpen={Boolean(detail)} onClose={() => setDetailId(null)} title={detail?.title ?? 'Obrigação'} subtitle={detail?.contractTitle} footer={detail && onOpenContract ? <button type="button" className="portfolio-action" onClick={() => { setDetailId(null); onOpenContract(detail.contractId); }}>Abrir contrato</button> : undefined}>
        {detail && <ul><Row row={detail} /></ul>}
      </DossierDetailDrawer>
    </HudPanel>
  );
}
