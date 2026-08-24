'use client';

/**
 * Hero da carteira — a superfície executiva do Command Center (MD §11).
 *
 * Uma mensagem primária: quanto está exposto. Execução responde em segunda voz,
 * faturado/backlog em terceira, e a composição da carteira fica declarada no
 * rodapé para que ninguém confunda o recorte com a realidade da empresa.
 *
 * Com um único contrato ao vivo, o hero mostra um contrato — não completa o
 * espaço com demonstração.
 */

import { cn } from '@/lib/utils';
import { Landmark, TrendingUp, Receipt, Activity } from 'lucide-react';
import { HudProgressBar } from '@/components/hud';
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
  /** Dimensões de saúde apuradas na carteira, sobre o total possível. */
  healthCoverage: { assessed: number; total: number };
  className?: string;
}

export function PortfolioHero({ stats, healthCoverage, className }: PortfolioHeroProps) {
  const pct = hasOfficialValue(stats.billedPct) ? Math.round(stats.billedPct.value * 100) : null;
  const single = stats.contractCount === 1;

  return (
    <section
      className={cn(
        'relative overflow-hidden rounded-[24px] border border-ig-border-focus/40',
        'bg-[linear-gradient(150deg,color-mix(in_oklab,var(--ig-bg-panel)_95%,transparent)_0%,color-mix(in_oklab,var(--ig-bg-raised)_55%,transparent)_58%,transparent_100%)]',
        'px-6 py-6 shadow-[var(--ig-shadow-e3)]',
        className,
      )}
      aria-label="Exposição da carteira oficial"
    >
      {/* Trilho de acento e brilho superior — profundidade sem neon (MD §73). */}
      <span
        className="pointer-events-none absolute inset-y-6 left-0 w-px bg-ig-accent shadow-[0_0_18px_color-mix(in_oklab,var(--ig-accent)_75%,transparent)]"
        aria-hidden
      />
      <span
        className="pointer-events-none absolute inset-x-12 top-0 h-px bg-[linear-gradient(90deg,transparent,color-mix(in_oklab,var(--ig-accent)_60%,transparent),transparent)]"
        aria-hidden
      />

      {/* Composição assimétrica: exposição domina, execução acompanha. */}
      <div className="grid items-end gap-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-ig-label uppercase tracking-[0.16em] text-ig-fg-muted">
            <Landmark className="h-3.5 w-3.5 text-ig-accent" aria-hidden />
            Exposição contratada
          </p>
          <div className="mt-2">
            <TrustedValue
              value={stats.totalValue}
              format={(v) => BRL.format(v)}
              size="hero"
              metallic
              missingLabel="Carteira não apurada"
            />
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
            <p className="text-ig-body-sm text-ig-fg-muted">
              {stats.contractCount === 0
                ? 'nenhum contrato operacional'
                : `${stats.contractCount} ${single ? 'contrato operacional' : 'contratos operacionais'}`}
            </p>
            <TrustedCoverage value={stats.totalValue} />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <HeroCell
            icon={<Receipt className="h-3.5 w-3.5" aria-hidden />}
            label="Faturado"
            value={stats.billedValue}
            accent="success"
          />
          <HeroCell
            icon={<TrendingUp className="h-3.5 w-3.5" aria-hidden />}
            label="Backlog"
            value={stats.remainingValue}
            accent="warning"
          />
        </div>
      </div>

      {/* Execução: barra só pinta com apuração — 0% seria lido como "nada executado". */}
      <div className="mt-5">
        <div className="mb-1.5 flex items-baseline justify-between gap-3">
          <span className="text-ig-label uppercase tracking-[0.14em] text-ig-fg-muted">
            Execução financeira
          </span>
          <span className="ig-tabular text-ig-body-sm font-semibold text-ig-fg-strong">
            {pct === null ? (
              <span className="font-medium text-ig-fg-subtle">
                {isError(stats.billedPct) ? 'Dados indisponíveis' : 'Não apurada'}
              </span>
            ) : `${pct}%`}
          </span>
        </div>
        {/*
          Sem apuração, a barra vira um trilho TRACEJADO em vez de uma barra
          vazia: uma barra vazia de borda sólida, à distância, é lida como
          "existe uma medição e ela é baixa". O tracejado diz "não há medição".
        */}
        {pct === null ? (
          <div
            className="h-2 w-full rounded-full border border-dashed border-ig-border-strong"
            role="img"
            aria-label="Execução financeira não apurada"
          />
        ) : (
          <HudProgressBar value={pct} size="md" showLabel={false} variant="success" />
        )}
        {pct === null && (
          <p className="mt-1.5 text-ig-caption text-ig-fg-subtle">
            {officialProvenance(stats.billedValue)}
          </p>
        )}
      </div>

      {/* Rodapé: composição da carteira e cobertura da avaliação. */}
      <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-ig-border-subtle pt-3.5">
        <span className="flex items-center gap-1.5 text-ig-caption text-ig-fg-muted">
          <Activity className="h-3.5 w-3.5 text-ig-fg-subtle" aria-hidden />
          Saúde apurada
          <span className="ig-tabular font-semibold text-ig-fg-strong">
            {healthCoverage.assessed}/{healthCoverage.total}
          </span>
          dimensões
        </span>
        <span className="text-ig-caption text-ig-fg-subtle">
          <span className="ig-tabular font-semibold text-ig-fg-muted">{stats.scope.live}</span> ao vivo
          <span className="mx-1.5" aria-hidden>·</span>
          <span className="ig-tabular font-semibold text-ig-fg-muted">{stats.scope.demo}</span> demonstração
          <span className="mx-1.5" aria-hidden>·</span>
          <span className="ig-tabular font-semibold text-ig-fg-muted">{stats.scope.unclassified}</span> não classificados
        </span>
      </div>
    </section>
  );
}

function HeroCell({
  icon, label, value, accent,
}: {
  icon: React.ReactNode;
  label: string;
  value: Official<number>;
  accent: 'success' | 'warning';
}) {
  const measured = hasOfficialValue(value);
  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-[14px] border px-4 py-3.5',
        measured
          ? 'border-ig-border-subtle bg-[color-mix(in_oklab,var(--ig-bg-raised)_60%,transparent)]'
          : 'border-dashed border-ig-border-subtle',
      )}
    >
      {measured && (
        <span
          className={cn(
            'pointer-events-none absolute inset-x-0 top-0 h-px',
            accent === 'success'
              ? 'bg-[linear-gradient(90deg,transparent,var(--ig-success),transparent)]'
              : 'bg-[linear-gradient(90deg,transparent,var(--ig-warning),transparent)]',
          )}
          aria-hidden
        />
      )}
      <p className="flex items-center gap-1.5 text-ig-label uppercase tracking-[0.12em] text-ig-fg-muted">
        <span className="text-ig-fg-subtle">{icon}</span>
        {label}
      </p>
      <div className="mt-1">
        <TrustedValue value={value} format={(v) => BRL.format(v)} size="lg" />
      </div>
      <TrustedCoverage value={value} className="mt-0.5 block" />
    </div>
  );
}
