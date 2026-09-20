'use client';

/**
 * DISTRIBUIÇÃO + FILTRO — a peça que substituiu as grades de KPI internas.
 *
 * ─── O problema ────────────────────────────────────────────────────────────
 *
 * Obrigações e Renovações abriam com a tira executiva da área e, logo abaixo,
 * repetiam os MESMOS números numa grade de cartões grandes. Em Obrigações eram
 * literalmente os seis: em atraso, vence hoje, no prazo, prazo não apurado,
 * encerradas. O leitor lia a mesma coisa duas vezes em dois desenhos
 * diferentes e gastava a segunda leitura conferindo se batiam.
 *
 * As grades não eram só resumo, porém: eram o FILTRO da lista. Apagá-las
 * apagaria a navegação junto.
 *
 * ─── A peça ────────────────────────────────────────────────────────────────
 *
 * Aqui a mesma função é exercida por duas coisas menores:
 *
 *   1. um TRILHO proporcional — a distribuição, que a tira de KPI não dá. Seis
 *      números soltos não dizem se a fila está concentrada no atraso ou no
 *      encerrado; uma barra repartida diz isso sem número nenhum;
 *   2. uma linha de CHIPS de filtro, com a contagem em corpo pequeno ao lado
 *      do rótulo — controle, não indicador.
 *
 * O número continua na tela, e é isso que mantém o filtro utilizável. O que
 * sai é o segundo RESUMO EXECUTIVO: nada aqui tem peso tipográfico de KPI.
 *
 * ─── Ausência ──────────────────────────────────────────────────────────────
 *
 * Faixa com zero registro não some — a ausência é informação e o filtro precisa
 * poder dizer "aqui não há nada". Ela aparece no chip com o contador em zero, e
 * não ganha segmento no trilho, porque não ocupa parcela nenhuma do todo.
 */

import { cn } from '@/lib/utils';

export type DistributionTone = 'critical' | 'warning' | 'accent' | 'success' | 'neutral';

const TONE_FILL: Record<DistributionTone, string> = {
  critical: 'var(--dossier-critical-ink)',
  warning: 'var(--dossier-attention-ink)',
  accent: 'var(--dossier-accent)',
  success: 'var(--dossier-positive-ink)',
  neutral: 'var(--dossier-neutral-ink)',
};

export interface DistributionSegment<K extends string | number> {
  readonly key: K;
  readonly label: string;
  readonly count: number;
  readonly tone: DistributionTone;
  /** O que a faixa significa. Vira `title` no chip e no segmento. */
  readonly hint?: string;
  /** Linha extra no chip — exposição da janela, prazo, o que a área quiser. */
  readonly meta?: string;
}

export interface DistributionRailProps<K extends string | number> {
  readonly segments: readonly DistributionSegment<K>[];
  readonly selected: K | null;
  readonly onSelect: (key: K | null) => void;
  /** Descreve o todo que o trilho reparte, ex.: "ocorrências na fila". */
  readonly totalLabel: string;
  readonly className?: string;
}

export function DistributionRail<K extends string | number>({
  segments, selected, onSelect, totalLabel, className,
}: DistributionRailProps<K>) {
  const total = segments.reduce((sum, s) => sum + s.count, 0);

  return (
    <div className={cn('space-y-2.5', className)}>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-ig-fg-subtle">
          Distribuição
        </span>
        <span className="ig-tabular text-ig-caption text-ig-fg-muted">
          {total} {totalLabel}
        </span>
      </div>

      {total === 0 ? (
        /* Trilho tracejado: não há o que repartir, e isso não é uma barra vazia. */
        <div
          className="h-2 w-full rounded-full border border-dashed border-ig-border-strong"
          role="img"
          aria-label={`Nenhum registro para repartir em ${totalLabel}`}
        />
      ) : (
        <div
          className="flex h-2 w-full gap-[2px] overflow-hidden rounded-full bg-ig-border-subtle"
          role="img"
          aria-label={`Distribuição de ${total} ${totalLabel}`}
        >
          {segments.filter((s) => s.count > 0).map((segment) => {
            const pct = (segment.count / total) * 100;
            const dim = selected !== null && selected !== segment.key;
            return (
              <button
                key={segment.key}
                type="button"
                onClick={() => onSelect(selected === segment.key ? null : segment.key)}
                title={`${segment.label}: ${segment.count} (${Math.round(pct)}%)${segment.hint ? ` — ${segment.hint}` : ''}`}
                aria-label={`Filtrar por ${segment.label}`}
                className={cn(
                  'h-full min-w-0 rounded-full transition-opacity',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color-mix(in_oklab,var(--ig-accent)_50%,transparent)]',
                  dim ? 'opacity-30' : 'opacity-100',
                )}
                style={{ width: `${Math.max(pct, 1.5)}%`, background: TONE_FILL[segment.tone] }}
              />
            );
          })}
        </div>
      )}

      <div className="flex flex-wrap gap-1.5">
        {segments.map((segment) => {
          const active = selected === segment.key;
          return (
            <button
              key={segment.key}
              type="button"
              aria-pressed={active}
              title={segment.hint}
              onClick={() => onSelect(active ? null : segment.key)}
              className={cn(
                /*
                  Raio 7px, e NUNCA cápsula.

                  É a mesma regra do `HudSignal`: a pílula com borda e padding
                  horizontal é a assinatura do SELO DE STATUS, e o módulo tem
                  um teste que a proíbe fora dele (contract-edit-and-signal-
                  chips). Isto aqui é um controle de filtro, não um selo — e a
                  diferença precisa estar na forma, senão o olho conta mais
                  seis status onde há seis botões.
                */
                'inline-flex items-center gap-1.5 rounded-[7px] border px-2.5 py-1 transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color-mix(in_oklab,var(--ig-accent)_45%,transparent)]',
                active
                  ? 'border-ig-accent/55 bg-[color-mix(in_oklab,var(--ig-accent)_10%,transparent)] text-ig-fg-strong'
                  : 'border-ig-border-subtle bg-ig-panel/50 text-ig-fg-muted hover:border-ig-border-strong',
              )}
            >
              <span
                className="h-1.5 w-1.5 shrink-0 rounded-full"
                style={{ background: TONE_FILL[segment.tone] }}
                aria-hidden
              />
              <span className="text-[11px] font-medium">{segment.label}</span>
              {/*
                A contagem é do CONTROLE, não um indicador: corpo pequeno,
                tabular, cor de apoio. Com peso de KPI, o chip voltaria a ser o
                resumo executivo que esta peça existe para não repetir.
              */}
              <span className="ig-tabular text-[11px] font-semibold text-ig-fg-subtle">
                {segment.count}
              </span>
              {segment.meta && (
                <span className="ig-tabular text-[10px] text-ig-fg-subtle">· {segment.meta}</span>
              )}
            </button>
          );
        })}
        {selected !== null && (
          <button
            type="button"
            onClick={() => onSelect(null)}
            className="inline-flex items-center rounded-[7px] border border-ig-border-subtle px-2.5 py-1 text-[11px] text-ig-fg-muted transition-colors hover:border-ig-border-strong hover:text-ig-fg-strong"
          >
            limpar recorte
          </button>
        )}
      </div>
    </div>
  );
}
