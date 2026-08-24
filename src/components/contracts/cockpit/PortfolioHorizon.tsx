'use client';

/**
 * Horizonte da carteira — o que acontece nos próximos 90 dias.
 *
 * Só evento REAL entra: marco de faturamento cadastrado, obrigação com prazo,
 * término de vigência. Nenhuma projeção. Se não há marco, o painel diz que não
 * há — um "próximo marco estimado" seria a forma mais convincente de ficção num
 * painel de planejamento.
 */

import { cn } from '@/lib/utils';
import { CalendarClock, Receipt, ClipboardCheck, RefreshCw, ArrowRight } from 'lucide-react';
import type { HorizonEvent } from '@/lib/contracts/trust/command-center';

const BRL = new Intl.NumberFormat('pt-BR', {
  style: 'currency', currency: 'BRL', notation: 'compact',
  minimumFractionDigits: 0, maximumFractionDigits: 1,
});

const KIND: Record<HorizonEvent['kind'], { icon: React.ReactNode; label: string }> = {
  billing: { icon: <Receipt className="h-3.5 w-3.5" aria-hidden />, label: 'Faturamento' },
  obligation: { icon: <ClipboardCheck className="h-3.5 w-3.5" aria-hidden />, label: 'Obrigação' },
  renewal: { icon: <RefreshCw className="h-3.5 w-3.5" aria-hidden />, label: 'Vigência' },
};

/** Faixas temporais do horizonte, na ordem em que importam. */
const BANDS = [
  { key: 'overdue', label: 'Vencidos', test: (d: number) => d < 0 },
  { key: 'd30', label: 'Próximos 30 dias', test: (d: number) => d >= 0 && d <= 30 },
  { key: 'd60', label: '31 a 60 dias', test: (d: number) => d > 30 && d <= 60 },
  { key: 'd90', label: '61 a 90 dias', test: (d: number) => d > 60 && d <= 90 },
] as const;

export interface PortfolioHorizonProps {
  events: readonly HorizonEvent[];
  /** Contratos operacionais na carteira — usado no empty state honesto. */
  liveContractCount: number;
  onOpenContract?: (contractId: string) => void;
  className?: string;
}

export function PortfolioHorizon({
  events, liveContractCount, onOpenContract, className,
}: PortfolioHorizonProps) {
  if (events.length === 0) {
    return (
      <div className={cn('rounded-[16px] border border-dashed border-ig-border-subtle px-4 py-5', className)}>
        <p className="flex items-center gap-2 text-ig-body-sm font-medium text-ig-fg-strong">
          <CalendarClock className="h-4 w-4 text-ig-fg-subtle" aria-hidden />
          Nenhum evento nos próximos 90 dias
        </p>
        <p className="mt-1.5 text-ig-body-sm leading-relaxed text-ig-fg-muted">
          {liveContractCount === 0
            ? 'Não há contrato operacional na carteira.'
            : liveContractCount === 1
              ? 'O único contrato operacional não tem marco de faturamento, obrigação com prazo nem vigência terminando na janela.'
              : `Nenhum dos ${liveContractCount} contratos operacionais tem marco, obrigação ou vigência na janela.`}
        </p>
        <p className="mt-2 text-ig-caption text-ig-fg-subtle">
          O horizonte é montado só a partir de registro real — não há projeção.
        </p>
      </div>
    );
  }

  return (
    <div className={cn('space-y-4', className)}>
      {BANDS.map((band) => {
        const inBand = events.filter((e) => band.test(e.daysAway));
        if (inBand.length === 0) return null;
        const overdue = band.key === 'overdue';

        return (
          <section key={band.key}>
            <header className="mb-2 flex items-baseline gap-2">
              <h4
                className={cn(
                  'text-ig-label uppercase tracking-[0.14em]',
                  overdue ? 'text-ig-danger' : 'text-ig-fg-muted',
                )}
              >
                {band.label}
              </h4>
              <span className="ig-tabular text-ig-caption font-semibold text-ig-fg-muted">
                {inBand.length}
              </span>
              <span className="h-px flex-1 bg-ig-border-subtle" aria-hidden />
            </header>

            <ul className="space-y-1.5">
              {inBand.map((e) => {
                const k = KIND[e.kind];
                const Comp: React.ElementType = onOpenContract ? 'button' : 'div';
                return (
                  <li key={e.id}>
                    <Comp
                      type={onOpenContract ? 'button' : undefined}
                      onClick={onOpenContract ? () => onOpenContract(e.contractId) : undefined}
                      className={cn(
                        'group flex w-full items-center gap-3 rounded-[10px] border px-3 py-2 text-left transition-all',
                        overdue
                          ? 'border-[color-mix(in_oklab,var(--ig-danger)_28%,transparent)] bg-[color-mix(in_oklab,var(--ig-danger)_5%,transparent)]'
                          : 'border-ig-border-subtle',
                        onOpenContract && [
                          'cursor-pointer hover:border-ig-border-focus hover:bg-[color-mix(in_oklab,var(--ig-accent)_5%,transparent)]',
                          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color-mix(in_oklab,var(--ig-accent)_45%,transparent)]',
                        ],
                      )}
                    >
                      <span className={cn('shrink-0', overdue ? 'text-ig-danger' : 'text-ig-fg-subtle')}>
                        {k.icon}
                      </span>

                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-ig-body-sm font-medium text-ig-fg-strong">
                          {e.title}
                        </span>
                        <span className="block truncate text-ig-caption text-ig-fg-muted">
                          <span className="font-mono">{e.contractCode}</span>
                          <span className="mx-1.5" aria-hidden>·</span>
                          {k.label}
                        </span>
                      </span>

                      {e.amount !== null && (
                        <span className="ig-tabular shrink-0 text-ig-body-sm font-semibold text-ig-fg-strong">
                          {BRL.format(e.amount)}
                        </span>
                      )}

                      <span
                        className={cn(
                          'ig-tabular w-[74px] shrink-0 text-right text-ig-caption',
                          overdue ? 'font-semibold text-ig-danger' : 'text-ig-fg-muted',
                        )}
                      >
                        {e.overdue
                          ? `${Math.abs(e.daysAway)}d atrás`
                          : e.daysAway === 0 ? 'hoje' : `em ${e.daysAway}d`}
                      </span>

                      {onOpenContract && (
                        <ArrowRight
                          className="h-3.5 w-3.5 shrink-0 text-ig-fg-subtle opacity-0 transition-opacity group-hover:opacity-100"
                          aria-hidden
                        />
                      )}
                    </Comp>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
