'use client';

/**
 * As peças comuns dos gráficos da Inteligência da Carteira.
 *
 * Quatro gráficos com quatro gramáticas visuais diferentes seriam quatro
 * objetos parecidos, não um painel. Aqui ficam as decisões que os quatro
 * compartilham: como um valor ausente se desenha, como um número em BRL se
 * escreve, e o que um rótulo de faixa mostra sem hover.
 *
 * ─── A regra visual que atravessa os quatro ────────────────────────────────
 *
 * SÓLIDO = apurado. TRACEJADO = não apurado. Nunca uma barra cinza de largura
 * mínima para "não sei": depois de desenhada, ela é indistinguível de um valor
 * pequeno, e o olho lê "quase zero" onde o dado diz "não perguntei".
 *
 * Cores saem dos tokens do dossiê (`--dossier-*`), que já têm paridade
 * claro/escuro. Nenhuma paleta nova, nenhum verde de biblioteca.
 */

import { cn } from '@/lib/utils';

/** O tom semântico de uma série. Os mesmos cinco do sistema do dossiê. */
export type ChartTone = 'accent' | 'positive' | 'attention' | 'critical' | 'neutral';

export const TONE_FILL: Record<ChartTone, string> = {
  accent: 'var(--dossier-accent)',
  positive: 'var(--dossier-positive-ink)',
  attention: 'var(--dossier-attention-ink)',
  critical: 'var(--dossier-critical-ink)',
  neutral: 'var(--dossier-neutral-ink)',
};

const BRL_COMPACT = new Intl.NumberFormat('pt-BR', {
  style: 'currency', currency: 'BRL', notation: 'compact',
  minimumFractionDigits: 0, maximumFractionDigits: 1,
});

const BRL_FULL = new Intl.NumberFormat('pt-BR', {
  style: 'currency', currency: 'BRL', maximumFractionDigits: 2,
});

/** BRL compacto para eixo e rótulo; ausência tem texto próprio, nunca "R$ 0". */
export const money = (v: number | null, absent = 'Não apurado'): string =>
  v === null ? absent : BRL_COMPACT.format(v);

/** BRL por extenso — para o tooltip, onde o número exato importa. */
export const moneyFull = (v: number | null, absent = 'Não apurado'): string =>
  v === null ? absent : BRL_FULL.format(v);

export const pct = (v: number | null): string =>
  v === null ? '—' : `${(v * 100).toFixed(v * 100 % 1 === 0 ? 0 : 1)}%`;

/**
 * Uma barra horizontal de uma faixa.
 *
 * `value === null` desenha o trilho tracejado de largura total — a faixa
 * existe, o valor dela não foi apurado, e as duas coisas precisam ser
 * visíveis ao mesmo tempo.
 */
export function ChartBar({
  value, max, tone, absentLabel, className,
}: {
  value: number | null;
  max: number | null;
  tone: ChartTone;
  absentLabel?: string;
  className?: string;
}) {
  if (value === null || max === null || max <= 0) {
    return (
      <div
        className={cn('ig-chart-bar is-absent', className)}
        role="img"
        aria-label={absentLabel ?? 'não apurado'}
      />
    );
  }
  const width = Math.max(Math.min((value / max) * 100, 100), value > 0 ? 1.5 : 0);
  return (
    <div className={cn('ig-chart-bar', className)}>
      <span style={{ width: `${width}%`, background: TONE_FILL[tone] }} />
    </div>
  );
}

/**
 * Cabeçalho de um gráfico: o que ele responde, e de onde vem.
 *
 * A pergunta em linguagem natural fica no subtítulo de propósito. Um título
 * como "Contract → Cash" diz o nome do gráfico; "quanto do valor contratado
 * virou caixa" diz para que ele serve, e é o que faz alguém parar nele.
 */
export function ChartHead({
  question, source, aside,
}: {
  question: string;
  source: string;
  aside?: React.ReactNode;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
      <div className="min-w-0">
        <p className="text-ig-body-sm font-medium text-ig-fg-strong">{question}</p>
        <p className="mt-0.5 text-ig-caption text-ig-fg-subtle">{source}</p>
      </div>
      {aside}
    </div>
  );
}

/** A nota de cobertura: quantos registros sustentam o desenho, e quantos não. */
export function ChartCoverage({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-3 border-t border-ig-border-subtle pt-2.5 text-ig-caption leading-relaxed text-ig-fg-subtle">
      {children}
    </p>
  );
}

/** Estado vazio de um gráfico — diz POR QUE não há desenho, nunca um zero. */
export function ChartAbsent({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="ig-chart-absent">
      <p className="text-ig-body-sm font-medium text-ig-fg-muted">{title}</p>
      <p className="mt-1 max-w-[44ch] text-ig-caption leading-relaxed text-ig-fg-subtle">{detail}</p>
    </div>
  );
}
