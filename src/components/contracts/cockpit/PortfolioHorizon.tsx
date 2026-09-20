'use client';

/**
 * Horizonte da carteira — o que acontece nos próximos 90 dias.
 *
 * Só evento REAL entra: marco de faturamento cadastrado, obrigação com prazo,
 * término de vigência. Nenhuma projeção. Se não há marco, o painel diz que não
 * há — um "próximo marco estimado" seria a forma mais convincente de ficção num
 * painel de planejamento.
 *
 * ─── Desenho ───────────────────────────────────────────────────────────────
 *
 * Uma TIRA, não mais um painel: quatro faixas temporais, cada uma com um
 * rótulo micro e a sua contagem em Signal inline, e uma linha por evento. Sem
 * moldura por item, sem cápsula de contagem, sem divisor entre cada linha —
 * o que separa eventos é o espaço, e o que separa faixas é um fio só.
 *
 * O vencido continua distinto por trilho tonal e pelo prazo em vermelho.
 */

import { cn } from '@/lib/utils';
import { CalendarClock, Receipt, ClipboardCheck, RefreshCw } from 'lucide-react';
import { HudSignal } from '@/components/hud';
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
  /*
    Vazio COMPACTO. Uma janela sem evento é a informação mais curta que esta
    superfície pode dar, e gastar altura com ela empurra para baixo tudo o que
    tem conteúdo. A ressalva sobre projeção vira `title`: ela importa para quem
    duvida do número, não para quem só constata que não há nada.
  */
  if (events.length === 0) {
    return (
      <p
        className={cn('flex items-start gap-2 py-1', className)}
        title="O horizonte é montado só a partir de registro real — não há projeção."
      >
        <CalendarClock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ig-fg-subtle" aria-hidden />
        <span className="min-w-0">
          <span className="block text-ig-caption font-semibold text-ig-fg-strong">
            Nenhum evento nos próximos 90 dias
          </span>
          <span className="mt-0.5 block text-ig-caption text-ig-fg-subtle">
            {liveContractCount === 0
              ? 'Não há contrato operacional na carteira.'
              : liveContractCount === 1
                ? 'O contrato operacional não tem marco, obrigação com prazo nem vigência na janela.'
                : `Nenhum dos ${liveContractCount} contratos tem marco, obrigação ou vigência na janela.`}
          </span>
        </span>
      </p>
    );
  }

  return (
    <div className={cn('space-y-2.5', className)}>
      {BANDS.map((band) => {
        const inBand = events.filter((e) => band.test(e.daysAway));
        if (inBand.length === 0) return null;
        const overdue = band.key === 'overdue';

        return (
          <section key={band.key}>
            <header className="mb-0.5 flex items-center gap-2">
              <h4
                className={cn(
                  'text-ig-label font-semibold uppercase tracking-[0.1em]',
                  overdue ? 'text-ig-danger' : 'text-ig-fg-subtle',
                )}
              >
                {band.label}
              </h4>
              <HudSignal
                size="sm"
                tone={overdue ? 'critical' : 'neutral'}
                label={String(inBand.length)}
              />
              <span className="h-px flex-1 bg-ig-border-subtle" aria-hidden />
            </header>

            <ul className="divide-y divide-ig-border-subtle">
              {inBand.map((e) => {
                const k = KIND[e.kind];
                const Comp: React.ElementType = onOpenContract ? 'button' : 'div';
                return (
                  <li key={e.id}>
                    <Comp
                      type={onOpenContract ? 'button' : undefined}
                      onClick={onOpenContract ? () => onOpenContract(e.contractId) : undefined}
                      title={`${k.label} · ${e.contractCode}`}
                      className={cn(
                        'relative flex w-full items-center gap-2.5 rounded-md py-1.5 pl-2.5 pr-1.5 text-left',
                        onOpenContract && [
                          'ig-row-hover cursor-pointer',
                          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color-mix(in_oklab,var(--ig-accent)_45%,transparent)]',
                        ],
                      )}
                    >
                      {overdue && (
                        <span className="pointer-events-none absolute inset-y-1 left-0 w-[2px] rounded-full bg-ig-danger" aria-hidden />
                      )}
                      <span className={cn('shrink-0', overdue ? 'text-ig-danger' : 'text-ig-fg-subtle')}>
                        {k.icon}
                      </span>

                      {/*
                        O QUÊ e para QUEM na mesma linha: o código do contrato
                        ocupava uma segunda altura por evento só para imprimir
                        sete caracteres, dobrando a altura da tira inteira.
                      */}
                      <span className="min-w-0 flex-1 truncate text-ig-caption text-ig-fg-strong">
                        {e.title}
                        <span className="ig-code ig-code-quiet ml-1.5">{e.contractCode}</span>
                      </span>

                      {e.amount !== null && (
                        <span className="ig-tabular shrink-0 text-ig-caption font-semibold text-ig-fg-muted">
                          {BRL.format(e.amount)}
                        </span>
                      )}

                      <span
                        className={cn(
                          'ig-tabular w-[66px] shrink-0 text-right text-ig-caption',
                          overdue ? 'font-semibold text-ig-danger' : 'text-ig-fg-muted',
                        )}
                      >
                        {e.overdue
                          ? `${Math.abs(e.daysAway)}d atrás`
                          : e.daysAway === 0 ? 'hoje' : `em ${e.daysAway}d`}
                      </span>
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
