'use client';

/**
 * Renewal Horizon — a carteira distribuída nas janelas de decisão.
 *
 * O painel NÃO recomenda renovar ou renegociar. Ele diz quando a decisão vence,
 * de qual coluna a data saiu, e o que já se sabe do contrato. Recomendação
 * exigiria histórico de performance e política comercial, e nenhum dos dois
 * existe nesta base — inventá-la seria o tipo de inteligência que parece útil
 * até alguém agir sobre ela.
 *
 * Faixa vazia continua desenhada: é ela que responde "nada vence nos próximos
 * 30 dias", que é diferente de "não olhei os próximos 30 dias".
 */

import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { pt } from 'date-fns/locale';
import { CalendarClock, AlertTriangle, CalendarX2 } from 'lucide-react';
import { HudPanel } from '@/components/hud';
import {
  HORIZON_LABEL, type HorizonBand, type RenewalHorizon,
} from '@/lib/contracts/trust/renewal-horizon';

const BRL = new Intl.NumberFormat('pt-BR', {
  style: 'currency', currency: 'BRL', notation: 'compact',
  minimumFractionDigits: 0, maximumFractionDigits: 1,
});

const BAND_TONE: Record<HorizonBand, { text: string; rail: string }> = {
  expired: { text: 'text-ig-danger', rail: 'bg-ig-danger' },
  30: { text: 'text-ig-danger', rail: 'bg-ig-danger/80' },
  60: { text: 'text-ig-warning', rail: 'bg-ig-warning' },
  90: { text: 'text-ig-warning', rail: 'bg-ig-warning/70' },
  120: { text: 'text-ig-fg-strong', rail: 'bg-ig-accent/60' },
  180: { text: 'text-ig-fg-strong', rail: 'bg-ig-accent/40' },
  beyond: { text: 'text-ig-fg-muted', rail: 'bg-ig-border-strong' },
};

export interface RenewalHorizonPanelProps {
  horizon: RenewalHorizon;
  onSelectContract?: (contractId: string) => void;
  className?: string;
}

export function RenewalHorizonPanel({ horizon, onSelectContract, className }: RenewalHorizonPanelProps) {
  const inWindow = horizon.entries.filter((e) => e.band !== 'beyond');

  return (
    <div className={cn('space-y-4', className)}>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
        {horizon.bands.map((band) => {
          const tone = BAND_TONE[band.band];
          return (
            <div
              key={String(band.band)}
              className={cn(
                'relative overflow-hidden rounded-[14px] border px-3 py-2.5',
                band.count > 0 ? 'border-ig-border-subtle bg-ig-panel/45' : 'border-dashed border-ig-border-strong',
              )}
            >
              <span className={cn('absolute inset-y-0 left-0 w-[2px]', band.count > 0 ? tone.rail : 'bg-transparent')} aria-hidden />
              <p className="truncate text-ig-label font-semibold uppercase tracking-[0.1em] text-ig-fg-muted">
                {HORIZON_LABEL[band.band]}
              </p>
              <p className={cn('mt-0.5 text-ig-kpi-md leading-none ig-tabular', band.count > 0 ? tone.text : 'text-ig-fg-subtle')}>
                {band.count}
              </p>
              {/*
                Exposição só aparece quando ALGUM contrato da faixa tem valor
                apurado; somar os que têm e apresentar como total da faixa
                inventaria um número que ninguém pode conferir.
              */}
              <p className="mt-0.5 truncate text-ig-label text-ig-fg-subtle">
                {band.count === 0 ? '—' : band.exposure === null ? 'valor não apurado' : BRL.format(band.exposure)}
              </p>
            </div>
          );
        })}
      </div>

      <HorizonNotes horizon={horizon} />

      <HudPanel
        title="Janelas de decisão"
        subtitle="Ordenadas pelo prazo — a origem da data fica declarada em cada linha"
        icon={<CalendarClock className="h-4 w-4" />}
        interactive={false}
      >
        {inWindow.length === 0 ? (
          <p className="py-6 text-center text-ig-caption text-ig-fg-muted">
            Nenhum contrato dentro de 180 dias.
            {horizon.entries.length > 0 && ` ${horizon.entries.length} contrato(s) com vigência além dessa janela.`}
          </p>
        ) : (
          <div className="divide-y divide-ig-border-subtle border-y border-ig-border-subtle">
            {inWindow.slice(0, 40).map((entry) => {
              const tone = BAND_TONE[entry.band];
              const interactive = Boolean(onSelectContract);
              const Comp: React.ElementType = interactive ? 'button' : 'div';
              return (
                <Comp
                  key={entry.contractId}
                  type={interactive ? 'button' : undefined}
                  onClick={interactive ? () => onSelectContract?.(entry.contractId) : undefined}
                  className={cn(
                    // Linha operacional, não cartão — ver ObligationsControlTower.
                    'relative grid w-full gap-3 py-2.5 pl-3 pr-1 text-left md:grid-cols-[1fr_130px_130px_150px] md:items-center',
                    interactive && 'transition-colors hover:bg-ig-bg-raised/40 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ig-border-focus',
                  )}
                >
                  <span className={cn('absolute inset-y-0 left-0 w-[2px]', tone.rail)} aria-hidden />

                  <div className="min-w-0 pl-1.5">
                    <p className="truncate text-ig-body-sm font-semibold text-ig-fg-strong">{entry.title}</p>
                    <p className="truncate text-ig-caption text-ig-fg-muted">
                      {entry.code}{entry.counterparty ? ` · ${entry.counterparty}` : ''}
                    </p>
                  </div>

                  <span className={cn('truncate text-ig-body-sm font-semibold', tone.text)}>
                    {entry.days < 0 ? `${Math.abs(entry.days)} dia(s) vencido` : `${entry.days} dia(s)`}
                  </span>

                  <div className="min-w-0">
                    <p className="truncate text-ig-caption text-ig-fg-muted">
                      {format(entry.date, 'dd/MM/yyyy', { locale: pt })}
                    </p>
                    {/* Proveniência da data: renovação registrada ≠ fim de vigência. */}
                    <p className="truncate text-ig-label text-ig-fg-subtle">
                      {entry.dateSource === 'renewal_date' ? 'data de renovação' : 'fim de vigência'}
                    </p>
                  </div>

                  <div className="min-w-0 text-right md:text-left">
                    <p className="truncate text-ig-body-sm font-semibold ig-tabular text-ig-fg-strong">
                      {entry.exposure === null ? 'Valor não apurado' : BRL.format(entry.exposure)}
                    </p>
                    {!entry.hasProject && (
                      <p className="truncate text-ig-label text-ig-warning">sem projeto vinculado</p>
                    )}
                  </div>
                </Comp>
              );
            })}
          </div>
        )}
      </HudPanel>
    </div>
  );
}

function HorizonNotes({ horizon }: { horizon: RenewalHorizon }) {
  const hasUndated = horizon.undatedContracts.length > 0;
  const hasErrors = horizon.erroredContracts.length > 0;
  if (!hasUndated && !hasErrors) return null;

  return (
    <div className="space-y-1.5">
      {hasErrors && (
        <p className="flex items-start gap-2 rounded-[12px] border border-ig-danger/30 bg-ig-danger/5 px-3 py-2 text-ig-caption text-ig-danger">
          <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
          <span>Vigência indisponível em {horizon.erroredContracts.length} contrato(s): {horizon.erroredContracts.join(', ')}.</span>
        </p>
      )}
      {hasUndated && (
        <p className="flex items-start gap-2 rounded-[12px] border border-ig-warning/35 bg-[color-mix(in_oklab,var(--ig-warning)_5%,transparent)] px-3 py-2 text-ig-caption text-ig-fg-muted">
          <CalendarX2 className="mt-px h-3.5 w-3.5 shrink-0 text-ig-warning" aria-hidden />
          <span>
            <span className="font-semibold text-ig-fg-strong">{horizon.undatedContracts.length} contrato(s)</span>{' '}
            sem data de término nem de renovação ({horizon.undatedContracts.map((c) => c.code).join(', ')}).
            Não entram em nenhuma janela — e por isso não aparecem acima.
          </span>
        </p>
      )}
    </div>
  );
}
