'use client';

/**
 * Contract-to-Cash — a cadeia do contrato até o caixa, com as lacunas à vista.
 *
 * A decisão de desenho principal: os estágios SEM fonte não são escondidos nem
 * empurrados para uma nota de rodapé. Eles ocupam a mesma largura dos demais e
 * mostram a razão, porque a pergunta que o painel responde não é só "quanto já
 * foi faturado?" — é "até onde este sistema consegue enxergar?".
 *
 * Um estágio apurado tem barra sólida. Um estágio sem fonte tem trilho
 * tracejado e nenhum número: a mesma gramática que o resto do cockpit usa para
 * separar "medimos e deu zero" de "não medimos".
 */

import { cn } from '@/lib/utils';
import { FileSignature, Ruler, ShieldCheck, Receipt, Wallet, Unplug, AlertTriangle, PlugZap } from 'lucide-react';
import type { CashStage, CashStageKey, CashStageState } from '@/lib/contracts/trust/contract-to-cash';
import { TrustedValue } from '../cockpit/TrustedValue';
import { hasOfficialValue } from '@/lib/contracts/trust/trusted';

const BRL = new Intl.NumberFormat('pt-BR', {
  style: 'currency', currency: 'BRL', notation: 'compact',
  minimumFractionDigits: 0, maximumFractionDigits: 1,
});

const ICON: Record<CashStageKey, React.ReactNode> = {
  contracted: <FileSignature className="h-4 w-4" aria-hidden />,
  measured: <Ruler className="h-4 w-4" aria-hidden />,
  approved: <ShieldCheck className="h-4 w-4" aria-hidden />,
  billed: <Receipt className="h-4 w-4" aria-hidden />,
  received: <Wallet className="h-4 w-4" aria-hidden />,
};

/** Rótulo curto do estado, exibido no lugar do número quando não há número. */
const STATE_CHIP: Record<CashStageState, { label: string; icon: React.ReactNode; tone: string } | null> = {
  measured: null,
  unmeasured: { label: 'Sem registro', icon: null, tone: 'text-ig-fg-subtle' },
  error: { label: 'Indisponível', icon: <AlertTriangle className="h-3 w-3" aria-hidden />, tone: 'text-ig-danger' },
  'not-instrumented': { label: 'Não instrumentado', icon: <PlugZap className="h-3 w-3" aria-hidden />, tone: 'text-ig-warning' },
  'not-integrated': { label: 'Não integrado', icon: <Unplug className="h-3 w-3" aria-hidden />, tone: 'text-ig-fg-subtle' },
};

export interface ContractToCashFlowProps {
  stages: readonly CashStage[];
  /** Densidade reduzida para o dossiê lateral. */
  compact?: boolean;
  className?: string;
}

export function ContractToCashFlow({ stages, compact = false, className }: ContractToCashFlowProps) {
  return (
    <div className={cn('space-y-3', className)}>
      <ol className={cn('grid gap-2', compact ? 'sm:grid-cols-2' : 'lg:grid-cols-5 sm:grid-cols-2')}>
        {stages.map((stage, index) => (
          <CashStageCard key={stage.key} stage={stage} index={index} total={stages.length} />
        ))}
      </ol>

      {/*
        As razões vêm agrupadas abaixo, e não dentro de cada card: lidas em
        sequência, elas contam onde a cadeia se interrompe e por quê — que é
        uma informação diferente da soma dos avisos isolados.
      */}
      <StageNotes stages={stages} />
    </div>
  );
}

function CashStageCard({ stage, index, total }: { stage: CashStage; index: number; total: number }) {
  const chip = STATE_CHIP[stage.state];
  const pct = stage.shareOfContracted;
  const dimmed = stage.state === 'not-integrated' || stage.state === 'not-instrumented';

  return (
    <li
      className={cn(
        'relative flex flex-col gap-2 rounded-[14px] border px-3.5 py-3 transition-colors',
        dimmed
          ? 'border-dashed border-ig-border-strong bg-transparent'
          : 'border-ig-border-subtle bg-ig-panel/45',
      )}
    >
      <div className="flex items-center gap-2">
        <span className={cn('shrink-0', dimmed ? 'text-ig-fg-subtle/70' : 'text-ig-fg-subtle')}>
          {ICON[stage.key]}
        </span>
        <span className="min-w-0 flex-1 truncate text-ig-label font-semibold uppercase tracking-[0.12em] text-ig-fg-muted">
          {stage.label}
        </span>
        {/* A posição na cadeia, para que a ordem sobreviva à quebra de linha. */}
        <span className="shrink-0 text-ig-label ig-tabular text-ig-fg-subtle">{index + 1}/{total}</span>
      </div>

      {hasOfficialValue(stage.amount) ? (
        <TrustedValue value={stage.amount} format={(v) => BRL.format(v)} size="md" metallic showProvenance />
      ) : (
        <span className={cn('flex items-center gap-1.5 text-ig-body-sm font-medium', chip?.tone)}>
          {chip?.icon}
          {chip?.label ?? 'Não apurado'}
        </span>
      )}

      {/* Trilho: sólido quando há proporção apurada, tracejado quando não. */}
      {pct === null ? (
        <div
          className="h-1 w-full rounded-full border border-dashed border-ig-border-strong"
          role="img"
          aria-label={`${stage.label} não apurado`}
        />
      ) : (
        <div className="h-1 w-full overflow-hidden rounded-full bg-ig-border-subtle">
          <div
            className="h-full rounded-full bg-ig-accent transition-[width] duration-500"
            style={{ width: `${Math.round(pct * 100)}%` }}
          />
        </div>
      )}

      {hasOfficialValue(stage.count) && (
        <span className="text-ig-label text-ig-fg-subtle">
          {stage.count.value} registro(s)
        </span>
      )}
    </li>
  );
}

function StageNotes({ stages }: { stages: readonly CashStage[] }) {
  const notes = stages.filter((s) => s.note);
  if (notes.length === 0) return null;

  return (
    <ul className="space-y-1.5">
      {notes.map((stage) => (
        <li
          key={stage.key}
          className="flex gap-2 rounded-[12px] border border-ig-border-subtle px-3 py-2 text-ig-caption text-ig-fg-muted"
        >
          <span className="shrink-0 font-semibold text-ig-fg-strong">{stage.label}</span>
          <span className="min-w-0">{stage.note}</span>
        </li>
      ))}
    </ul>
  );
}
