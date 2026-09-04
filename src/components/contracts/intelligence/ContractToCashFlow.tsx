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
 *
 * ─── Desenho: cadeia, não cinco cartões ───────────────────────────────────
 *
 * Cada estágio tinha moldura própria, ícone, contador "3/5" e um trilho — cinco
 * caixas pesadas para uma coisa que é UMA: uma progressão. A moldura individual
 * competia com a barra pela atenção e ainda sugeria que os estágios eram
 * objetos independentes, quando o ponto inteiro do painel é que um alimenta o
 * outro.
 *
 * Agora é uma linha horizontal com divisórias finas: rótulo, valor, trilho. A
 * ênfase vai para a progressão e o estado, não para a decoração. A semântica
 * NÃO mudou — os mesmos cinco estados, os mesmos textos ("Sem registro",
 * "Indisponível", "Não instrumentado", "Não integrado", "Não apurado"), e
 * ausência continua não virando zero.
 *
 * A marcação segue `<ol>/<li>`: a ordem da cadeia é conteúdo, não estilo, e um
 * leitor de tela precisa dela tanto quanto o olho.
 */

import { cn } from '@/lib/utils';
import { Unplug, AlertTriangle, PlugZap } from 'lucide-react';
import type { CashStage, CashStageState } from '@/lib/contracts/trust/contract-to-cash';
import { TrustedValue } from '../cockpit/TrustedValue';
import { hasOfficialValue } from '@/lib/contracts/trust/trusted';

const BRL = new Intl.NumberFormat('pt-BR', {
  style: 'currency', currency: 'BRL', notation: 'compact',
  minimumFractionDigits: 0, maximumFractionDigits: 1,
});


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
      <ol
        data-testid="contract-to-cash"
        className={cn(
          'grid gap-x-0 gap-y-4 grid-cols-2',
          compact ? 'sm:grid-cols-3 lg:grid-cols-5' : 'sm:grid-cols-3 lg:grid-cols-5',
          // Divisória fina entre estágios, só onde há vizinho à esquerda.
          '[&>li+li]:sm:border-l [&>li+li]:sm:border-ig-border-subtle',
        )}
      >
        {stages.map((stage, index) => (
          <CashStage key={stage.key} stage={stage} index={index} total={stages.length} />
        ))}
      </ol>

      {/*
        As razões vêm agrupadas abaixo, e não dentro de cada estágio: lidas em
        sequência, elas contam onde a cadeia se interrompe e por quê — que é
        uma informação diferente da soma dos avisos isolados.
      */}
      <StageNotes stages={stages} />
    </div>
  );
}

function CashStage({ stage, index, total }: { stage: CashStage; index: number; total: number }) {
  const chip = STATE_CHIP[stage.state];
  const pct = stage.shareOfContracted;

  return (
    <li className="min-w-0 px-0 sm:px-3 sm:first:pl-0">
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
            className="h-full rounded-full bg-ig-accent transition-[width] duration-500"
            style={{ width: `${Math.round(pct * 100)}%` }}
          />
        </div>
      )}

      {hasOfficialValue(stage.count) && (
        <span className="mt-1 block text-ig-caption text-ig-fg-subtle">
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
    <ul className="space-y-1 border-t border-ig-border-subtle pt-2">
      {notes.map((stage) => (
        <li
          key={stage.key}
          className="flex gap-2 text-ig-caption text-ig-fg-muted"
        >
          <span className="shrink-0 font-semibold text-ig-fg-strong">{stage.label}</span>
          <span className="min-w-0">{stage.note}</span>
        </li>
      ))}
    </ul>
  );
}
