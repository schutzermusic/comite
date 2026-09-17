'use client';

/**
 * Ordered contract-to-cash stages. Unknown amounts have no numeric fallback;
 * dashed tracks distinguish absent measurements from a measured zero.
 * Each stage retains its source, prerequisite details and existing action.
 */

import { cn } from '@/lib/utils';
import { ArrowRight, Unplug, AlertTriangle, PlugZap } from 'lucide-react';
import type { CashStage, CashStageState, CashStageKey } from '@/lib/contracts/trust/contract-to-cash';
import { TrustedValue } from '../cockpit/TrustedValue';
import { hasOfficialValue } from '@/lib/contracts/trust/trusted';

const BRL = new Intl.NumberFormat('pt-BR', {
  style: 'currency', currency: 'BRL', notation: 'compact',
  minimumFractionDigits: 0, maximumFractionDigits: 1,
});


/** Rótulo curto do estado, exibido no lugar do número quando não há número. */
const STATE_CHIP: Record<CashStageState, { label: string; icon: React.ReactNode; tone: string } | null> = {
  measured: null,
  unmeasured: { label: 'Não apurado', icon: null, tone: 'text-ig-fg-subtle' },
  error: { label: 'Indisponível', icon: <AlertTriangle className="h-3 w-3" aria-hidden />, tone: 'text-ig-danger' },
  'not-instrumented': { label: 'Não instrumentado', icon: <PlugZap className="h-3 w-3" aria-hidden />, tone: 'text-ig-warning' },
  'not-integrated': { label: 'Não integrado', icon: <Unplug className="h-3 w-3" aria-hidden />, tone: 'text-ig-fg-subtle' },
};

export interface ContractToCashFlowProps {
  stages: readonly CashStage[];
  actions?: Partial<Record<CashStageKey, { label: string; onClick: () => void }>>;
  /** Densidade reduzida para o dossiê lateral. */
  compact?: boolean;
  className?: string;
}

export function ContractToCashFlow({ stages, compact = false, className, actions }: ContractToCashFlowProps) {
  return (
    <div className={cn('space-y-3', className)}>
      <ol
        data-testid="contract-to-cash"
        className={cn(
          'grid grid-cols-1 gap-5 lg:grid-cols-5',
          compact ? 'sm:grid-cols-2' : 'sm:grid-cols-3',
        )}
      >
        {stages.map((stage, index) => (
          <CashStage key={stage.key} stage={stage} index={index} total={stages.length} action={actions?.[stage.key]} />
        ))}
      </ol>
    </div>
  );
}

function CashStage({ stage, index, total, action }: { stage: CashStage; index: number; total: number; action?: { label: string; onClick: () => void } }) {
  const chip = STATE_CHIP[stage.state];
  const pct = stage.shareOfContracted;

  return (
    <li className="dossier-cash-stage" data-state={stage.state}>
      {index < total - 1 && <ArrowRight className="dossier-cash-arrow h-3 w-3" aria-hidden />}
      <p className="flex items-baseline gap-1.5">
        <span className="min-w-0 truncate text-ig-caption text-ig-fg-muted">{stage.label}</span>
        {/* A posição sobrevive à quebra de linha, sem virar um "3/5" grande. */}
        <span className="ig-tabular shrink-0 text-ig-caption text-ig-fg-subtle" aria-hidden>
          {index + 1}/{total}
        </span>
      </p>

      <div className="mt-1">
        {hasOfficialValue(stage.amount) ? (
          <TrustedValue value={stage.amount} format={(v) => BRL.format(v)} size="md" metallic showProvenance />
        ) : (
          <span className={cn('flex items-center gap-1.5 text-ig-body-sm font-medium', chip?.tone)}>
            {chip?.icon}
            {chip?.label ?? 'Não apurado'}
          </span>
        )}
      </div>

      {/* Trilho: sólido quando há proporção apurada, tracejado quando não. */}
      {pct === null ? (
        <div
          className="mt-2 h-1 w-full rounded-full border border-dashed border-ig-border-strong"
          role="img"
          aria-label={`${stage.label} não apurado`}
        />
      ) : (
        <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-ig-border-subtle">
          <div
            className="h-full rounded-full bg-ig-accent transition-[width] duration-150"
            style={{ width: `${Math.round(pct * 100)}%` }}
          />
        </div>
      )}

      {hasOfficialValue(stage.count) && (
        <span className="mt-1 block text-ig-caption text-ig-fg-subtle">
          {stage.count.value} registro(s)
        </span>
      )}
      <p className="mt-3 text-[11px] leading-relaxed text-ig-fg-muted">{SOURCE_LABEL[stage.key]}</p>
      {stage.note && stage.state !== 'not-integrated' && <details className="mt-2 text-xs text-ig-fg-muted"><summary className="cursor-pointer font-medium">{stage.state === 'error' ? 'Falha na consulta' : 'O que falta apurar'}</summary><p className="mt-2 leading-relaxed">{stage.note}</p></details>}
      {action && stage.state !== 'measured' && <button type="button" className="mt-3 text-xs font-semibold text-ig-accent" onClick={action.onClick}>{action.label} →</button>}
      {stage.state === 'not-integrated' && <details className="mt-3 text-xs text-ig-fg-muted"><summary className="cursor-pointer font-semibold">Estado da integração</summary><p className="mt-2">{stage.note ?? 'Recebimentos dependem do vínculo com o razão financeiro.'}</p></details>}
    </li>
  );
}

const SOURCE_LABEL: Record<CashStageKey, string> = {
  contracted: 'Fonte: valor registrado do contrato.',
  measured: 'Fonte: medição operacional ou marcos contratuais.',
  approved: 'Fonte: rota de aprovação do contrato.',
  billed: 'Fonte: eventos de faturamento realizados.',
  received: 'Fonte: razão financeiro.',
};
