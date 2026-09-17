'use client';

/**
 * Primitivas do painel lateral compacto.
 *
 * O Quick Dossier era uma coluna única com tudo aberto: nove seções empilhadas
 * mais um muro de vinte botões no rodapé. A leitura custava rolagem, e a
 * rolagem custava decisão — quem abre o drawer quer responder "está tudo bem
 * com este contrato?" em um olhar, e só então agir.
 *
 * Estas primitivas invertem a ordem: VISÃO primeiro (o cartão de resumo), AÇÃO
 * depois (acordeões fechados por padrão, um aberto por vez). Nada foi removido
 * — tudo que estava visível continua a um clique de distância, agrupado pelo
 * domínio a que pertence.
 *
 * A linguagem visual é a mesma dos painéis do módulo (`.ig-lp`): vidro, marca
 * de 28px no cabeçalho, fio de acento. Um acordeão fechado aqui é visualmente
 * o CABEÇALHO de um painel do módulo — a continuidade é deliberada.
 */

import type { ReactNode } from 'react';
import Link from 'next/link';
import { ChevronDown } from 'lucide-react';
import { HudSignal, type HudSignalTone } from '@/components/hud';
import { cn } from '@/lib/utils';

export type AccordionTone = 'neutral' | 'accent' | 'warning' | 'danger';

/** O tom do grupo é o tom do Signal Chip — uma escala só para todo o painel. */
const SIGNAL_TONE: Record<AccordionTone, HudSignalTone> = {
  neutral: 'neutral',
  accent: 'accent',
  warning: 'warning',
  danger: 'danger',
};

export interface DrawerAccordionProps {
  /** Identificador estável; também ancora `aria-controls`. */
  id: string;
  title: string;
  icon: ReactNode;
  /** Uma linha curta de contexto — o que existe dentro, não o que fazer. */
  hint?: string;
  /**
   * Contagem do grupo, impressa à direita quando NÃO há sinal de pendência.
   * `null` significa "não foi possível apurar" e sai como "—": achatar leitura
   * falha em 0 seria mentir sobre o contrato.
   */
  count?: number | null;
  /** Realce do grupo quando há algo pendente (atrasos, rejeições). */
  tone?: AccordionTone;
  /**
   * Estado pendente do grupo, como Signal Chip do sistema — a MESMA peça dos
   * chips do cabeçalho e das linhas de item. Um rótulo colorido solto ao lado
   * do título não é status: é ênfase sem anatomia, e foi o que fazia
   * "jurídico pendente" parecer colado no painel.
   */
  flag?: string;
  /** Dado do chip de estado (ex.: 2 em "ATRASADAS │ 2"). */
  flagValue?: number;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
  className?: string;
}

/**
 * Um grupo de ações/itens, fechado por padrão.
 *
 * Controlado de fora para que o drawer possa manter apenas um aberto por vez —
 * é o que impede o painel de voltar a crescer sem limite conforme o usuário
 * explora.
 */
export function DrawerAccordion({
  id, title, icon, hint, count, tone = 'neutral', flag, flagValue, open, onToggle, children, className,
}: DrawerAccordionProps) {
  const panelId = `${id}-panel`;

  return (
    <div className={cn('ig-lp overflow-hidden', className)}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={panelId}
        className={cn(
          // `pr` maior que `pl`: os cantos em L de `.ig-lp-head` vivem a 8px da
          // borda, e o chevron encostado neles lia como artefato, não assinatura.
          'ig-lp-head group flex w-full items-center gap-3 py-2.5 pl-3 pr-4 text-left transition-colors sm:pl-3.5 sm:pr-5',
          'hover:bg-[color-mix(in_oklab,var(--ig-accent)_5%,transparent)]',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color-mix(in_oklab,var(--ig-accent)_45%,transparent)]',
          !open && 'rounded-2xl',
        )}
      >
        <span className="ig-lp-mark" aria-hidden>
          {icon}
        </span>

        {/* Título e resumo factual: o que o grupo É, e o que há dentro dele. */}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-ig-body-sm font-semibold text-ig-fg-strong">{title}</span>
          {hint && (
            <span className="mt-0.5 block truncate text-ig-caption text-ig-fg-muted">{hint}</span>
          )}
        </span>

        {/* Companhia à direita: o estado, nunca o assunto. Um só objeto — o
            chip quando há pendência, o número quando não há. */}
        {flag ? (
          <HudSignal size="sm" label={flag} value={flagValue} tone={SIGNAL_TONE[tone]} className="shrink-0" />
        ) : count !== undefined ? (
          <span className="ig-tabular shrink-0 text-ig-caption font-semibold text-ig-fg-subtle">
            {count === null ? '—' : count}
          </span>
        ) : null}

        <ChevronDown
          className={cn(
            'h-4 w-4 shrink-0 text-ig-fg-subtle transition-transform duration-200',
            open && 'rotate-180',
          )}
          aria-hidden
        />
      </button>

      {open && (
        <div id={panelId} className="space-y-3 px-3 pb-3 pt-3 sm:px-3.5">
          {children}
        </div>
      )}
    </div>
  );
}

/** Faixa de ações compactas — duas colunas, sem virar muro de botões. */
export function ActionGrid({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('grid grid-cols-2 gap-1.5', className)}>{children}</div>;
}

export interface ActionRowProps {
  icon: ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  /** Ocupa a linha inteira — para a ação principal do grupo. */
  wide?: boolean;
  /** `accent` marca a ação que o grupo espera que seja a mais usada. */
  tone?: 'default' | 'accent';
  title?: string;
}

/** Linha de ação: altura fixa, ícone à esquerda, rótulo em uma linha. */
export function ActionRow({
  icon, label, onClick, disabled, wide, tone = 'default', title,
}: ActionRowProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title ?? label}
      className={cn(
        'flex h-9 min-w-0 items-center gap-2 rounded-[10px] border px-2.5 text-left transition-all duration-150',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color-mix(in_oklab,var(--ig-accent)_45%,transparent)]',
        'disabled:cursor-not-allowed disabled:opacity-50',
        tone === 'accent'
          ? 'border-ig-border-focus/50 bg-[color-mix(in_oklab,var(--ig-accent)_8%,transparent)] hover:bg-[color-mix(in_oklab,var(--ig-accent)_13%,transparent)]'
          : 'border-ig-border-subtle bg-[color-mix(in_oklab,var(--ig-bg-raised)_45%,transparent)] hover:border-ig-border-focus hover:bg-ig-panel-hover',
        wide && 'col-span-2',
      )}
    >
      <span
        className={cn(
          'shrink-0 [&>svg]:h-3.5 [&>svg]:w-3.5',
          tone === 'accent' ? 'text-ig-accent' : 'text-ig-fg-subtle',
        )}
        aria-hidden
      >
        {icon}
      </span>
      <span className="truncate text-ig-caption font-semibold text-ig-fg-strong">{label}</span>
    </button>
  );
}

/** Célula do cartão de resumo: rótulo fino, valor forte, apoio opcional. */
export function SummaryTile({
  label, value, sub, href, onClick, tone = 'default',
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  href?: string;
  onClick?: () => void;
  tone?: 'default' | 'warning';
}) {
  const body = (
    <>
      <p className="truncate text-ig-caption text-ig-fg-muted">{label}</p>
      <p
        className={cn(
          'mt-0.5 truncate text-ig-body-sm font-semibold',
          tone === 'warning' ? 'text-ig-warning' : 'text-ig-fg-strong',
        )}
      >
        {value}
      </p>
      {sub && <p className="mt-0.5 truncate text-ig-caption text-ig-fg-subtle">{sub}</p>}
    </>
  );

  const interactive =
    'block min-w-0 rounded-[10px] px-2 py-1.5 text-left transition-colors hover:bg-[color-mix(in_oklab,var(--ig-accent)_7%,transparent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color-mix(in_oklab,var(--ig-accent)_40%,transparent)]';

  if (href) {
    return (
      <Link href={href} onClick={(event) => event.stopPropagation()} className={interactive}>
        {body}
      </Link>
    );
  }
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={interactive}>
        {body}
      </button>
    );
  }
  return <div className="min-w-0 px-2 py-1.5">{body}</div>;
}
