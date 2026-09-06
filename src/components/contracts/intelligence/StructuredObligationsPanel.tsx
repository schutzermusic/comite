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
import { cn } from '@/lib/utils';
import { AlertTriangle, CalendarClock, CircleHelp, FileWarning, Landmark, ShieldOff } from 'lucide-react';
import { HudPanel, HudEmptyState } from '@/components/hud';
import type { ObligationAttentionRow, ObligationPortfolio } from '@/lib/contracts/obligations/portfolio';
import type { ObligationResponsibleSide, ObligationUrgency, Tristate } from '@/lib/contracts/obligations/types';

const URGENCY_LABEL: Record<ObligationUrgency, string> = {
  OVERDUE: 'Em atraso',
  DUE: 'Vence hoje',
  UNKNOWN: 'Prazo não apurado',
  UPCOMING: 'No prazo',
  NOT_APPLICABLE: 'Encerradas',
};

/** O que cada faixa quer dizer — visível na tela, não só no código. */
const URGENCY_HINT: Record<ObligationUrgency, string> = {
  OVERDUE: 'O prazo passou e nada foi registrado como cumprido.',
  DUE: 'Vence na data de referência.',
  UNKNOWN: 'A regra é conhecida, a data não — falta a âncora ou o calendário.',
  UPCOMING: 'Prazo ainda por vir.',
  NOT_APPLICABLE: 'Cumpridas, dispensadas ou canceladas.',
};

const URGENCY_TONE: Record<ObligationUrgency, { text: string; rail: string; chip: string }> = {
  OVERDUE: { text: 'text-ig-danger', rail: 'bg-ig-danger', chip: 'border-ig-danger/45 text-ig-danger' },
  DUE: { text: 'text-ig-warning', rail: 'bg-ig-warning', chip: 'border-ig-warning/45 text-ig-warning' },
  UNKNOWN: { text: 'text-ig-fg-muted', rail: 'bg-ig-border-strong', chip: 'border-ig-border-strong text-ig-fg-muted' },
  UPCOMING: { text: 'text-ig-success', rail: 'bg-ig-success', chip: 'border-ig-success/45 text-ig-success' },
  NOT_APPLICABLE: { text: 'text-ig-fg-muted', rail: 'bg-ig-border', chip: 'border-ig-border text-ig-fg-muted' },
};

const ORDER: ObligationUrgency[] = ['OVERDUE', 'DUE', 'UNKNOWN', 'UPCOMING', 'NOT_APPLICABLE'];

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
    <span className={cn(
      'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium',
      blocking ? 'border-ig-danger/45 text-ig-danger' : 'border-ig-border-strong text-ig-fg-muted',
    )}>
      <Landmark className="h-3 w-3" />
      {blocking ? 'Bloqueia faturamento' : 'Bloqueio não apurado'}
    </span>
  );
}

function EvidenceChip({ state }: { state: Tristate }) {
  if (state === 'TRUE') return null;
  return (
    <span className={cn(
      'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px]',
      state === 'FALSE' ? 'border-ig-warning/45 text-ig-warning' : 'border-ig-border-strong text-ig-fg-muted',
    )}>
      <FileWarning className="h-3 w-3" />
      {state === 'FALSE' ? 'Evidência faltando' : 'Evidência sem aceite'}
    </span>
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
          <button
            type="button"
            onClick={onOpenContract ? () => onOpenContract(row.contractId) : undefined}
            className={cn('mt-0.5 truncate text-xs text-ig-fg-muted', onOpenContract && 'hover:text-ig-accent')}
          >
            {row.contractTitle} · {row.occurrenceKey}
          </button>
        </div>
        <span className={cn('shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium', tone.chip)}>
          {URGENCY_LABEL[row.urgency]}
        </span>
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
          <span className="inline-flex items-center gap-1 rounded-full border border-ig-border-strong px-2 py-0.5 text-[10px] text-ig-fg-muted">
            <ShieldOff className="h-3 w-3" />Dispensa vigente
          </span>
        )}
        {row.escalationSeverity && (
          <span className="inline-flex items-center gap-1 rounded-full border border-ig-warning/45 px-2 py-0.5 text-[10px] text-ig-warning">
            <AlertTriangle className="h-3 w-3" />Escalonamento {row.escalationSeverity}
          </span>
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
  const shown = selected ? portfolio.rows.filter((r) => r.urgency === selected) : portfolio.rows;
  const total = portfolio.rows.length;

  return (
    <HudPanel
      title="Obrigações contratuais"
      subtitle={`Situação em ${portfolio.asOf}`}
      icon={<CalendarClock className="h-4 w-4" />}
      className={className}
    >
      {/* As faixas ficam sempre visíveis, inclusive zeradas. */}
      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
        {ORDER.map((urgency) => {
          const active = selected === urgency;
          return (
            <button
              key={urgency}
              type="button"
              title={URGENCY_HINT[urgency]}
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

      {total === 0 ? (
        <HudEmptyState
          icon="inbox"
          title="Nenhuma obrigação estruturada registrada"
          description={
            portfolio.contractsWithoutObligations.length > 0
              ? `Nenhum dos ${portfolio.contractsWithoutObligations.length} contrato(s) da carteira tem obrigação contratual estruturada. Registrar uma exige apontar a cláusula, o aditivo ou o documento que a origina — é isso que separa uma obrigação de uma anotação.`
              : 'Registrar uma obrigação exige apontar a cláusula, o aditivo ou o documento que a origina.'
          }
        />
      ) : (
        <ul className="space-y-2">
          {shown.map((row) => <Row key={row.instanceId} row={row} onOpenContract={onOpenContract} />)}
        </ul>
      )}

      {portfolio.contractsWithoutObligations.length > 0 && total > 0 && (
        <p className="mt-3 text-[11px] text-ig-fg-muted">
          {portfolio.contractsWithoutObligations.length} contrato(s) ainda sem obrigação estruturada mapeada — lacuna
          de controle, não ausência de obrigação.
        </p>
      )}
    </HudPanel>
  );
}
