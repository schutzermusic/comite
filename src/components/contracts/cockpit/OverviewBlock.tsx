'use client';

/**
 * Bloco da Visão Geral — UMA superfície por assunto.
 *
 * A Visão Geral tinha três gramáticas concorrendo na mesma rolagem: `HudPanel`
 * (moldura pesada com ícone em caixa e fio divisor), `SectionHeading` (título
 * solto sobre conteúdo sem superfície) e, dentro de vários deles, caixas com
 * borda por item. O olho contava molduras em vez de ler conteúdo.
 *
 * Aqui existe UM contêiner por assunto e nenhum dentro dele.
 *
 * ─── Profundidade é hierarquia, não decoração ─────────────────────────────
 *
 * A passada anterior levou o achatamento longe demais: todo bloco em elevação
 * 1, cabeçalho sem separação do corpo, ícone solto. Sem tinta, sem blur e sem
 * sombra, `ig-glass` deixa de ser vidro — vira um retângulo de 1px, e uma
 * página inteira desses lê como planilha, não como cockpit.
 *
 * A elevação voltou a trabalhar:
 *
 *   · `primary` (atenção operacional) → elevação 3: mais tinta, mais blur,
 *     sombra projetada maior. É o bloco que o olho encontra primeiro.
 *   · `default` (apoio)               → elevação 2: o material padrão.
 *
 * E o cabeçalho voltou a ser um cabeçalho: ícone em chip tonal, título, e um
 * fio que se dissolve nas pontas separando-o do corpo. São três camadas de
 * profundidade — vidro, chip, fio — nenhuma delas uma borda dura.
 *
 * ─── Régua compartilhada ──────────────────────────────────────────────────
 *
 * Todo bloco desta página tem a MESMA anatomia métrica, e é isso que faz dois
 * blocos lado a lado lerem como um par em vez de dois objetos parecidos:
 *
 *   · cabeçalho de altura fixa (`BLOCK_HEADER_H`), com ou sem ação, com ou sem
 *     contagem — a linha de base do título não se move;
 *   · o mesmo padding lateral no cabeçalho, no fio e no corpo;
 *   · o mesmo raio e a mesma família de elevação.
 *
 * Um cabeçalho que cresce quando ganha um botão desalinha a dupla inteira, e
 * era exatamente o que acontecia entre "Operações conectadas" (sem ação) e
 * "Atividade recente" (com "Trilha completa").
 */

import { useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { HudSignal, type HudSignalTone } from '@/components/hud';

/**
 * Altura da faixa de cabeçalho, em px. Fixa de propósito: é a régua que
 * alinha a linha de base do título entre blocos vizinhos.
 */
const BLOCK_HEADER_H = 'h-[42px]';

export interface OverviewBlockProps {
  title: string;
  /** Contagem do conjunto. Signal inline — nunca uma cápsula no cabeçalho. */
  count?: number;
  countTone?: HudSignalTone;
  /** Uma linha curta. Não explica o modelo de dados — isso é `title` de item. */
  hint?: string;
  icon?: ReactNode;
  /** No máximo uma ação, terciária, à direita do cabeçalho. */
  action?: ReactNode;
  emphasis?: 'default' | 'primary';
  /** Remove o padding do corpo, para listas que sangram até a borda. */
  flush?: boolean;
  /**
   * Cabeçalho vira botão de expandir. Para blocos de LEITURA DE APOIO, cujo
   * conteúdo alguém consulta de vez em quando e não precisa ocupar altura na
   * rolagem principal enquanto isso não acontece.
   */
  collapsible?: boolean;
  /** Estado inicial quando `collapsible`. */
  defaultOpen?: boolean;
  /**
   * Acompanha a altura do vizinho na mesma linha da grade.
   *
   * Recolhido, o bloco NUNCA estica: uma faixa de cabeçalho de 42px esticada
   * até a altura do vizinho seria meia tela de vidro vazio.
   */
  stretch?: boolean;
  className?: string;
  children: ReactNode;
}

/**
 * Régua do cabeçalho: a mesma altura mínima em todo bloco da página.
 *
 * `min-h` e não `h`: um cabeçalho que quebre em duas linhas numa coluna
 * estreita cresce em vez de cortar o texto. A linha de base compartilhada é o
 * caso normal; a quebra é a exceção que a grade absorve.
 */
const HEADER = 'flex min-h-[46px] shrink-0 items-center gap-x-2.5 px-4 pb-2.5 pt-3.5';

/** Régua do corpo: o mesmo respiro em todo bloco. */
const BODY = 'px-4 pb-4 pt-3.5';

export function OverviewBlock({
  title,
  count,
  countTone = 'neutral',
  hint,
  icon,
  action,
  emphasis = 'default',
  flush = false,
  collapsible = false,
  defaultOpen = true,
  stretch = true,
  className,
  children,
}: OverviewBlockProps) {
  const [open, setOpen] = useState(defaultOpen);
  const expanded = !collapsible || open;
  const fills = stretch && expanded;

  const heading = (
    <>
      {icon && (
        /*
          Chip do ícone: uma superfície de 22px com hairline interno. É o que
          dá ao cabeçalho uma terceira camada de profundidade sem gastar cor —
          o ícone solto sobre o vidro não tinha nenhuma.
        */
        <span
          className={cn(
            'inline-flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-[7px]',
            '[box-shadow:inset_0_0_0_1px_var(--ig-border-subtle),inset_0_1px_0_var(--ig-border-strong)]',
            emphasis === 'primary'
              ? 'bg-ig-accent-weak text-ig-accent'
              : 'bg-[color-mix(in_oklab,var(--ig-bg-raised)_70%,transparent)] text-ig-fg-subtle',
            '[&_svg]:h-3 [&_svg]:w-3',
          )}
        >
          {icon}
        </span>
      )}
      <h3 className="text-ig-label font-semibold uppercase tracking-[0.1em] text-ig-fg-muted">
        {title}
      </h3>
      {count !== undefined && count > 0 && (
        <HudSignal variant="inline" size="sm" tone={countTone} label={String(count)} />
      )}
      {hint && <span className="min-w-0 truncate text-ig-caption text-ig-fg-subtle">{hint}</span>}
    </>
  );

  return (
    <section
      data-elev={emphasis === 'primary' ? '3' : '2'}
      className={cn(
        'ig-glass flex flex-col',
        /*
          `h-full` + `items-stretch` na grade: os dois blocos de uma linha
          terminam na MESMA borda de baixo, com a altura saindo do conteúdo
          mais alto. Sem isso, "Operações conectadas" com nove módulos e
          "Atividade recente" vazia terminavam a 350px de distância, e a linha
          lia como dois objetos avulsos em vez de um par.

          A exceção é o bloco RECOLHIDO: esticar um cabeçalho de 46px até a
          altura do vizinho devolveria exatamente o vazio que recolher existe
          para eliminar. Aí ele encosta no topo e encolhe.
        */
        fills ? 'h-full' : 'self-start',
        className,
      )}
      aria-label={title}
    >
      <span data-ig-noise="" />
      <span data-ig-specular="" />
      <div data-ig-content="" className="flex min-h-0 flex-1 flex-col">
        <header className={cn('flex shrink-0 items-center gap-x-2.5 px-4', BLOCK_HEADER_H)}>
          {collapsible ? (
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              aria-expanded={open}
              className="-ml-1 flex h-full min-w-0 flex-1 items-center gap-x-2.5 rounded-md px-1 text-left transition-colors hover:bg-ig-panel-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color-mix(in_oklab,var(--ig-accent)_45%,transparent)]"
            >
              {heading}
              <ChevronDown
                className={cn('ml-auto h-3.5 w-3.5 shrink-0 text-ig-fg-subtle transition-transform', open && 'rotate-180')}
                aria-hidden
              />
            </button>
          ) : (
            <div className="flex min-w-0 flex-1 items-center gap-x-2.5">{heading}</div>
          )}
          {/* A ação fica FORA do botão de colapso: é outro destino. */}
          {action && <span className="shrink-0">{action}</span>}
        </header>

        {/* Fio que se dissolve nas pontas — separação sem moldura. */}
        {expanded && (
          <div className="mx-4 h-px shrink-0 bg-[linear-gradient(90deg,transparent,var(--ig-border),transparent)]" aria-hidden />
        )}

        {expanded && (
          /*
            O conteúdo ancora no TOPO mesmo quando o bloco estica. Centralizar
            ou distribuir faria a primeira linha de cada bloco da dupla começar
            numa altura diferente — o oposto do alinhamento que o estiramento
            existe para dar.
          */
          <div className={cn('min-h-0 flex-1', flush ? 'pb-2 pt-2' : 'px-4 pb-4 pt-3')}>{children}</div>
        )}
      </div>
    </section>
  );
}

/**
 * Ação terciária de cabeçalho. Um único desenho para "ver tudo" / "abrir
 * trilha", em vez de cada bloco inventar o seu.
 */
export function OverviewBlockAction({
  label, onClick, icon,
}: {
  label: string; onClick: () => void; icon?: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1 rounded text-ig-caption font-semibold text-ig-fg-muted transition-colors hover:text-ig-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color-mix(in_oklab,var(--ig-accent)_45%,transparent)]"
    >
      {label}
      {icon}
    </button>
  );
}
