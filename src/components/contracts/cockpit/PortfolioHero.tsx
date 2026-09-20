'use client';

/**
 * Cabeçalho financeiro da carteira (MD §11).
 *
 * NÃO é mais um card de dashboard: é a faixa de abertura da página, com a
 * altura de um cabeçalho e o peso tipográfico de um número herói.
 *
 * Uma mensagem primária — quanto está exposto — e três medidas de apoio na
 * mesma régua à direita. A execução financeira, que ocupava uma região
 * secundária inteira com rótulo, barra larga e linha de proveniência, virou
 * UMA linha contextual sob o número: é o qualificador da exposição, não um
 * segundo indicador.
 *
 * ─── Altura, e por que ela importa aqui ────────────────────────────────────
 *
 * A versão anterior gastava ~200px para dizer cinco coisas. Numa tela de
 * 900px isso é um quinto da página antes de qualquer sinal operacional — e a
 * primeira pergunta de quem abre a carteira não é "quanto vale", é "o que
 * precisa de mim". O cabeçalho financeiro responde a sua pergunta em uma
 * dobra curta e devolve a tela para a torre de controle.
 */

import { cn } from '@/lib/utils';
import { Landmark, TrendingUp, Receipt, Activity } from 'lucide-react';
import { HudSignal } from '@/components/hud';
import { TrustedValue, TrustedCoverage } from './TrustedValue';
import { hasOfficialValue, isError, type Official } from '@/lib/contracts/trust/trusted';
import { officialProvenance } from '@/lib/contracts/trust/format';
import type { TrustedPortfolioStats } from '@/lib/contracts/trust/portfolio';

const BRL = new Intl.NumberFormat('pt-BR', {
  style: 'currency', currency: 'BRL', notation: 'compact',
  minimumFractionDigits: 0, maximumFractionDigits: 1,
});

export interface PortfolioHeroProps {
  stats: TrustedPortfolioStats;
  /** Dimensões apuradas na carteira, sobre o total possível (cobertura). */
  healthCoverage: { assessed: number; total: number };
  className?: string;
}

export function PortfolioHero({ stats, healthCoverage, className }: PortfolioHeroProps) {
  const outsideOfficial = stats.scope.demo + stats.scope.unclassified;
  const pct = hasOfficialValue(stats.billedPct) ? Math.round(stats.billedPct.value * 100) : null;
  const single = stats.contractCount === 1;

  return (
    <header
      className={cn(
        'relative overflow-hidden rounded-[18px]',
        /*
          O cabeçalho ficou compacto na passada anterior — e junto com a altura
          foi embora a profundidade: fundo quase transparente, sombra e1 e
          nenhum contorno. Compacto não precisa ser CHATO. A altura continua a
          de um cabeçalho; o material volta a ser o do produto.
        */
        'border border-ig-border-subtle',
        'bg-[linear-gradient(120deg,color-mix(in_oklab,var(--ig-bg-panel)_96%,transparent)_0%,color-mix(in_oklab,var(--ig-bg-raised)_62%,transparent)_52%,color-mix(in_oklab,var(--ig-bg-panel)_70%,transparent)_100%)]',
        'px-5 py-4',
        'shadow-[inset_0_1px_0_color-mix(in_oklab,var(--ig-border-strong)_70%,transparent),var(--ig-shadow-e2)]',
        className,
      )}
      aria-label="Exposição da carteira oficial"
    >
      {/* Trilho de acento + realce superior: profundidade sem neon (MD §73). */}
      <span
        className="pointer-events-none absolute inset-y-4 left-0 w-px bg-ig-accent shadow-[0_0_14px_color-mix(in_oklab,var(--ig-accent)_65%,transparent)]"
        aria-hidden
      />
      <span
        className="pointer-events-none absolute inset-x-10 top-0 h-px bg-[linear-gradient(90deg,transparent,color-mix(in_oklab,var(--ig-accent)_55%,transparent),transparent)]"
        aria-hidden
      />

      <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
        {/* ── Primário: exposição, com a execução como linha contextual ──── */}
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-ig-label uppercase tracking-[0.1em] text-ig-fg-muted">
            <Landmark className="h-3 w-3 text-ig-accent" aria-hidden />
            Exposição contratada
          </p>
          <div className="mt-1">
            <TrustedValue
              value={stats.totalValue}
              format={(v) => BRL.format(v)}
              size="hero"
              metallic
              missingLabel="Carteira não apurada"
            />
          </div>

          {/*
            Uma linha só: quantos contratos, qual a execução, e a barra como
            um traço curto ao lado do número — não como uma faixa de largura
            total sob um rótulo próprio.

            A barra só pinta com apuração: 0% seria lido como "nada executado".
          */}
          <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-ig-caption text-ig-fg-muted">
            <span>
              {stats.contractCount === 0
                ? 'nenhum contrato operacional'
                : `${stats.contractCount} ${single ? 'contrato operacional' : 'contratos operacionais'}`}
            </span>
            <span className="text-ig-fg-subtle" aria-hidden>·</span>
            {pct === null ? (
              <span title={officialProvenance(stats.billedValue)}>
                execução{' '}
                <span className="font-semibold text-ig-fg-muted">
                  {isError(stats.billedPct) ? 'indisponível' : 'não apurada'}
                </span>
              </span>
            ) : (
              <span className="flex items-center gap-2">
                <span>execução</span>
                <span className="h-1 w-16 overflow-hidden rounded-full bg-ig-border-subtle" aria-hidden>
                  <span className="block h-full rounded-full bg-ig-success" style={{ width: `${pct}%` }} />
                </span>
                <span className="ig-tabular font-semibold text-ig-fg-strong">{pct}%</span>
              </span>
            )}
            <TrustedCoverage value={stats.totalValue} />
            {outsideOfficial > 0 && (
              <HudSignal
                size="sm"
                variant="inline"
                tone="warning"
                label="fora da soma"
                value={outsideOfficial}
                title="Registros de outra origem não entram nos valores da carteira oficial."
              />
            )}
          </div>
        </div>

        {/* ── Apoio: três medidas na mesma régua, separadas por fio ──────── */}
        <div className="flex min-w-0 shrink-0 items-start gap-x-6">
          <HeroCell
            icon={<Receipt className="h-3 w-3" aria-hidden />}
            label="Faturado"
            value={stats.billedValue}
            accent="success"
          />
          <HeroCell
            icon={<TrendingUp className="h-3 w-3" aria-hidden />}
            label="Backlog"
            value={stats.remainingValue}
            accent="warning"
            divided
          />
          <CoverageCell assessed={healthCoverage.assessed} total={healthCoverage.total} />
        </div>
      </div>
    </header>
  );
}

/** Coluna do cabeçalho: rótulo micro, valor médio, sem caixa. */
function HeroCell({
  icon, label, value, accent, divided = false,
}: {
  icon: React.ReactNode;
  label: string;
  value: Official<number>;
  accent: 'success' | 'warning';
  divided?: boolean;
}) {
  const measured = hasOfficialValue(value);
  return (
    <div className={cn('relative min-w-0', divided && 'border-l border-ig-border-subtle pl-6')}>
      <p className="flex items-center gap-1.5 text-ig-label uppercase tracking-[0.1em] text-ig-fg-muted">
        <span className={cn(measured ? (accent === 'success' ? 'text-ig-success' : 'text-ig-warning') : 'text-ig-fg-subtle')}>
          {icon}
        </span>
        <span className="truncate">{label}</span>
      </p>
      <div className="mt-0.5">
        <TrustedValue value={value} format={(v) => BRL.format(v)} size="md" />
      </div>
      <TrustedCoverage value={value} className="mt-0.5 block" />
    </div>
  );
}

/**
 * Cobertura de apuração — quantas dimensões dão para avaliar.
 *
 * NÃO é uma nota de saúde: 5/6 significa que cinco dimensões têm dado, não que
 * o contrato vai bem em cinco frentes. Por isso segue como CONTAGEM, nunca
 * como porcentagem — "83%" seria lido como nota.
 */
function CoverageCell({ assessed, total }: { assessed: number; total: number }) {
  const missing = Math.max(0, total - assessed);
  return (
    <div className="min-w-0 border-l border-ig-border-subtle pl-6">
      <p className="flex items-center gap-1.5 text-ig-label uppercase tracking-[0.1em] text-ig-fg-muted">
        <Activity className="h-3 w-3 text-ig-fg-subtle" aria-hidden />
        <span className="truncate">Cobertura</span>
      </p>
      <p
        className="ig-tabular mt-0.5 text-ig-kpi-md leading-none text-ig-fg-strong"
        title={`${assessed} de ${total} dimensões apuradas`}
      >
        {assessed}
        <span className="text-ig-body-sm font-medium text-ig-fg-subtle">/{total}</span>
      </p>
      <span className="mt-0.5 block text-ig-caption text-ig-fg-subtle">
        {missing === 0 ? 'todas apuradas' : `${missing} sem dado`}
      </span>
    </div>
  );
}
