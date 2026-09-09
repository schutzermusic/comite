'use client';

/**
 * O que o Apex está monitorando na carteira inteira.
 *
 * ─── A pergunta que a Visão Geral precisa responder ────────────────────────
 *
 * Não "quantos contratos existem" — isso a tabela já diz. A pergunta é:
 *
 *     O Apex está de olho em quê, e o que sobrou para uma pessoa?
 *
 * Três faixas, nessa ordem, porque é a ordem da atenção de quem abre a tela:
 *
 *   1. REQUER VOCÊ      — o que não anda sem uma decisão humana.
 *   2. APEX MONITORANDO — o que já tem dono, prazo e acompanhamento.
 *   3. AGUARDANDO AGENDA— o que o Apex entendeu e ainda não pôde datar.
 *
 * ─── Nenhum número é inventado ─────────────────────────────────────────────
 *
 * Toda contagem vem de dado PERSISTIDO — obrigações estruturadas,
 * acompanhamentos, interpretações classificadas. Onde a leitura falhou, a
 * célula diz que falhou em vez de mostrar zero: "0 obrigações em atraso" e
 * "não consegui ler as obrigações" levam a decisões opostas, e um zero
 * tranquilizador sobre uma consulta quebrada é o pior resultado possível.
 *
 * A faixa "resolvido pelo Apex" que o desenho original previa NÃO existe aqui:
 * ela exigiria um contador de eventos que o Event Graph ainda não expõe por
 * carteira, e um número plausível no lugar seria exatamente o tipo de métrica
 * decorativa que este produto recusa.
 */

import { cn } from '@/lib/utils';
import { AlertTriangle, CalendarClock, Radar } from 'lucide-react';
import { HudPanel } from '@/components/hud';

export interface MonitoringCell {
  readonly label: string;
  /** `null` = a leitura falhou. NUNCA zero por omissão. */
  readonly value: number | null;
  readonly hint: string;
  readonly onClick?: () => void;
}

export interface ApexMonitoringBandProps {
  requiresYou: readonly MonitoringCell[];
  monitoring: readonly MonitoringCell[];
  awaitingSchedule: readonly MonitoringCell[];
  className?: string;
}

const TONE = {
  attention: {
    icon: AlertTriangle,
    title: 'Requer você',
    hint: 'Não anda sem uma decisão humana',
    accent: 'text-ig-warning',
    border: 'border-ig-warning/35',
  },
  monitoring: {
    icon: Radar,
    title: 'O Apex está monitorando',
    hint: 'Tem dono, prazo e acompanhamento ativo',
    accent: 'text-ig-accent',
    border: 'border-ig-border-subtle',
  },
  awaiting: {
    icon: CalendarClock,
    title: 'Aguardando agenda',
    hint: 'Regra entendida; o prazo aparece quando Projetos agendar',
    accent: 'text-ig-accent',
    border: 'border-ig-border-subtle',
  },
} as const;

export function ApexMonitoringBand({
  requiresYou, monitoring, awaitingSchedule, className,
}: ApexMonitoringBandProps) {
  const groups = [
    { tone: TONE.attention, cells: requiresYou },
    { tone: TONE.monitoring, cells: monitoring },
    { tone: TONE.awaiting, cells: awaitingSchedule },
    // Uma faixa sem nenhuma célula não vira cabeçalho vazio.
  ].filter((group) => group.cells.length > 0);

  if (groups.length === 0) return null;

  return (
    <HudPanel
      title="Torre de controle contratual"
      subtitle="O que está acontecendo na carteira, e de quem é a bola"
      icon={<Radar className="h-4 w-4" />}
      interactive={false}
      className={className}
      data-testid="apex-monitoring-band"
    >
      <div className="grid gap-4 lg:grid-cols-3">
        {groups.map(({ tone, cells }) => {
          const Icon = tone.icon;
          return (
            <section
              key={tone.title}
              className={cn('rounded-xl border p-3', tone.border)}
              aria-label={tone.title}
            >
              <h3 className={cn('flex items-center gap-1.5 text-ig-body-sm font-semibold', tone.accent)}>
                <Icon className="h-4 w-4" aria-hidden />
                {tone.title}
              </h3>
              <p className="mt-0.5 text-[11px] text-ig-fg-subtle">{tone.hint}</p>

              <dl className="mt-2.5 space-y-1.5">
                {cells.map((cell) => {
                  const body = (
                    <>
                      <dt className="min-w-0 flex-1 truncate text-ig-caption text-ig-fg-default">
                        {cell.label}
                      </dt>
                      <dd className={cn(
                        'shrink-0 text-ig-body-sm font-semibold ig-tabular',
                        cell.value === null ? 'text-ig-fg-muted' : 'text-ig-fg-strong',
                      )}>
                        {/* Leitura que falhou não vira zero. */}
                        {cell.value === null ? '—' : cell.value}
                      </dd>
                    </>
                  );
                  return cell.onClick ? (
                    <button
                      key={cell.label}
                      type="button"
                      onClick={cell.onClick}
                      title={cell.hint}
                      className="flex w-full items-baseline gap-2 rounded-md px-1 py-0.5 text-left transition-colors hover:bg-ig-panel-hover/40"
                    >
                      {body}
                    </button>
                  ) : (
                    <div key={cell.label} title={cell.hint} className="flex items-baseline gap-2 px-1 py-0.5">
                      {body}
                    </div>
                  );
                })}
              </dl>
            </section>
          );
        })}
      </div>
    </HudPanel>
  );
}
