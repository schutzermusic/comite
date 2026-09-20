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
 *
 * ─── Hierarquia: zero não pesa o mesmo que ocorrência ──────────────────────
 *
 * As três faixas tinham o mesmo peso e listavam TODAS as suas linhas, inclusive
 * as zeradas, na mesma tipografia das que tinham ocorrência. Uma carteira
 * saudável desenhava uma parede de zeros com exatamente o mesmo destaque de
 * uma carteira em chamas, e o olho aprendia a pular a torre inteira.
 *
 * Agora:
 *   · a faixa ganha uma contagem-manchete, que é a leitura de longe;
 *   · no máximo TRÊS linhas com ocorrência aparecem, ordenadas por tamanho;
 *   · o resto — inclusive todo zero — vive atrás de "Ver detalhes";
 *   · "Requer você" ocupa mais largura e acende um trilho quente quando há
 *     algo lá, porque é a única faixa que pede uma pessoa.
 *
 * Falha de leitura NUNCA é silenciada: `null` conta como ocorrência e sobe
 * junto com os números, porque "não consegui ler" é uma pendência humana.
 */

import { useState } from 'react';
import { cn } from '@/lib/utils';
import { AlertTriangle, CalendarClock, ChevronDown, Radar } from 'lucide-react';
import { HudSignal, type HudSignalTone } from '@/components/hud';

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

/** Linhas com ocorrência visíveis por faixa antes do "Ver detalhes". */
const LANE_VISIBLE = 3;

const TONE = {
  attention: {
    icon: AlertTriangle,
    title: 'Requer você',
    hint: 'Não anda sem uma decisão humana',
    chip: 'warning' as HudSignalTone,
    bar: 'var(--ig-warning)',
    text: 'text-ig-warning',
  },
  monitoring: {
    icon: Radar,
    title: 'O Apex está monitorando',
    hint: 'Tem dono, prazo e acompanhamento ativo',
    chip: 'accent' as HudSignalTone,
    bar: 'var(--ig-accent)',
    text: 'text-ig-accent',
  },
  awaiting: {
    icon: CalendarClock,
    title: 'Aguardando agenda',
    hint: 'O prazo aparece quando Projetos agendar',
    chip: 'neutral' as HudSignalTone,
    bar: 'var(--ig-tone-neutral)',
    text: 'text-ig-fg-muted',
  },
} as const;

type LaneTone = (typeof TONE)[keyof typeof TONE];

export function ApexMonitoringBand({
  requiresYou, monitoring, awaitingSchedule, className,
}: ApexMonitoringBandProps) {
  const groups = [
    { key: 'attention', tone: TONE.attention, cells: requiresYou, primary: true },
    { key: 'monitoring', tone: TONE.monitoring, cells: monitoring, primary: false },
    { key: 'awaiting', tone: TONE.awaiting, cells: awaitingSchedule, primary: false },
    // Uma faixa sem nenhuma célula não vira cabeçalho vazio.
  ].filter((group) => group.cells.length > 0);

  if (groups.length === 0) return null;

  /*
    Escala COMUM a toda a torre. Uma barra normalizada por faixa faria "2 de um
    máximo de 2" e "40 de um máximo de 40" desenharem o mesmo traço cheio — a
    barra estaria mentindo sobre a comparação que ela existe para permitir.
  */
  const scale = Math.max(1, ...groups.flatMap((g) => g.cells.map((c) => c.value ?? 0)));

  return (
    <section
      /*
        Elevação 3: a torre é a área de COMANDO da página, e profundidade é
        como esta interface diz hierarquia. Em elevação 2 ela empatava com os
        blocos de apoio logo abaixo.
      */
      data-elev="3"
      className={cn('ig-glass', className)}
      aria-label="Torre de controle contratual"
      data-testid="apex-monitoring-band"
    >
      <span data-ig-noise="" />
      <span data-ig-specular="" />
      <div data-ig-content="">
        <header className="flex flex-wrap items-center gap-x-2.5 gap-y-1 px-4 pb-1.5 pt-3">
          <Radar className="h-3 w-3 shrink-0 text-ig-accent" aria-hidden />
          <h3 className="text-ig-label font-semibold uppercase tracking-[0.1em] text-ig-fg-muted">
            Torre de controle contratual
          </h3>
          <span className="min-w-0 truncate text-ig-caption text-ig-fg-subtle">
            de quem é a bola
          </span>
        </header>

        {/*
          "Requer você" leva mais largura. A assimetria é a própria mensagem:
          três colunas iguais dizem que as três perguntas têm o mesmo peso, e
          elas não têm.
        */}
        <div className="mx-3.5 h-px bg-[linear-gradient(90deg,transparent,var(--ig-border),transparent)]" aria-hidden />

        <div className="grid gap-y-1 px-2 pb-3 pt-2 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)_minmax(0,1fr)] lg:divide-x lg:divide-ig-border-subtle">
          {groups.map((group) => (
            <Lane key={group.key} tone={group.tone} cells={group.cells} scale={scale} primary={group.primary} />
          ))}
        </div>
      </div>
    </section>
  );
}

function Lane({
  tone, cells, scale, primary,
}: {
  tone: LaneTone; cells: readonly MonitoringCell[]; scale: number; primary: boolean;
}) {
  const [open, setOpen] = useState(false);
  const Icon = tone.icon;

  /*
    Ocorrência é valor > 0 OU leitura falha. Zero é ausência de ocorrência e
    desce para o detalhe — mas continua acessível, porque "zero obrigações em
    atraso" é uma resposta que alguém pode querer conferir.
  */
  const occurring = cells
    .filter((c) => c.value === null || c.value > 0)
    .sort((a, b) => (b.value ?? Number.MAX_SAFE_INTEGER) - (a.value ?? Number.MAX_SAFE_INTEGER));
  const quiet = cells.filter((c) => c.value === 0);

  const visible = occurring.slice(0, LANE_VISIBLE);
  const rest = [...occurring.slice(LANE_VISIBLE), ...quiet];

  const known = cells.filter((c) => c.value !== null);
  const headline = known.length === 0 ? null : known.reduce((sum, c) => sum + (c.value ?? 0), 0);
  const hot = primary && (headline === null || headline > 0 || occurring.length > 0);

  return (
    <section
      className={cn('relative min-w-0 px-2.5 py-2', hot && 'rounded-[10px] bg-[color-mix(in_oklab,var(--ig-warning)_4%,transparent)]')}
      aria-label={tone.title}
    >
      {hot && (
        <span className="pointer-events-none absolute inset-y-2 left-0 w-[2px] rounded-full bg-ig-warning" aria-hidden />
      )}

      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h4 className="flex min-w-0 items-center gap-1.5 text-ig-caption font-semibold text-ig-fg-strong">
            <Icon className={cn('h-3.5 w-3.5 shrink-0', tone.text)} aria-hidden />
            <span className="truncate">{tone.title}</span>
          </h4>
          <p className="mt-0.5 truncate text-ig-caption text-ig-fg-subtle" title={tone.hint}>
            {tone.hint}
          </p>
        </div>
        {/* Manchete: a leitura de longe da faixa. */}
        <span
          className={cn(
            'ig-tabular shrink-0 leading-none',
            primary ? 'text-ig-kpi-md' : 'text-ig-h2',
            headline === null ? 'text-ig-fg-subtle' : headline > 0 ? tone.text : 'text-ig-fg-subtle',
          )}
        >
          {headline === null ? '—' : headline}
        </span>
      </header>

      {visible.length > 0 ? (
        <dl className="mt-1.5">
          {visible.map((cell) => (
            <CellRow key={cell.label} cell={cell} scale={scale} bar={tone.bar} />
          ))}
        </dl>
      ) : (
        /* Estado limpo: uma linha calada, sem moldura e sem tom de alerta. */
        <p className="mt-1.5 px-1.5 text-ig-caption text-ig-fg-subtle">Nada nesta faixa agora.</p>
      )}

      {rest.length > 0 && (
        <>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            className="mt-1 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-ig-caption text-ig-fg-subtle transition-colors hover:text-ig-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color-mix(in_oklab,var(--ig-accent)_45%,transparent)]"
          >
            {open ? 'Ocultar detalhes' : `Ver detalhes · ${rest.length}`}
            <ChevronDown className={cn('h-3 w-3 transition-transform', open && 'rotate-180')} aria-hidden />
          </button>
          {open && (
            <dl className="mt-0.5">
              {rest.map((cell) => (
                <CellRow key={cell.label} cell={cell} scale={scale} bar={tone.bar} quiet />
              ))}
            </dl>
          )}
        </>
      )}
    </section>
  );
}

/** Uma medida da torre: rótulo à esquerda, número à direita, régua embaixo. */
function CellRow({
  cell, scale, bar, quiet = false,
}: {
  cell: MonitoringCell; scale: number; bar: string; quiet?: boolean;
}) {
  /*
    A régua só existe quando HÁ o que comparar.

    Com uma única ocorrência na torre inteira, `scale` vale 1 e a barra desenha
    100% — um traço cheio da largura da coluna dizendo "1 de no máximo 1". Não
    é falso, é inútil: ocupa o peso visual de uma medição sem carregar nenhuma
    comparação, e numa faixa de alerta ainda pinta um sublinhado grosso de tom
    quente sob a única linha que importa.
  */
  const width = scale <= 1 || cell.value === null || cell.value <= 0
    ? 0
    : Math.max(6, Math.round((cell.value / scale) * 100));

  const body = (
    <>
      <dt className={cn('col-start-1 row-start-1 min-w-0 truncate text-ig-caption', quiet ? 'text-ig-fg-subtle' : 'text-ig-fg-default')}>
        {cell.label}
      </dt>
      <dd
        className={cn(
          'ig-tabular col-start-2 row-start-1 shrink-0 text-right text-ig-caption font-semibold',
          cell.value === null || quiet ? 'text-ig-fg-subtle' : 'text-ig-fg-strong',
        )}
      >
        {/* Leitura que falhou não vira zero. */}
        {cell.value === null ? '—' : cell.value}
      </dd>
      {/*
        Régua proporcional, na mesma escala em toda a torre — é o que torna os
        números comparáveis sem obrigar ninguém a fazer a conta de cabeça. Sem
        ocorrência, não há traço: um trilho vazio é moldura, não medida.
      */}
      {width > 0 && (
        <span aria-hidden className="col-span-2 col-start-1 row-start-2 mt-[3px] h-[2px] w-full overflow-hidden rounded-full bg-ig-border-subtle">
          <span className="block h-full rounded-full transition-[width] duration-500" style={{ width: `${width}%`, backgroundColor: bar }} />
        </span>
      )}
    </>
  );

  const layout = 'grid w-full grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-2 rounded-md px-1.5 py-1 text-left';

  return cell.onClick ? (
    <button
      type="button"
      onClick={cell.onClick}
      title={cell.hint}
      className={cn(layout, 'ig-row-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color-mix(in_oklab,var(--ig-accent)_45%,transparent)]')}
    >
      {body}
    </button>
  ) : (
    <div title={cell.hint} className={layout}>{body}</div>
  );
}
