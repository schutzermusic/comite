'use client';

/**
 * Casca do app do colaborador: cabeçalho, aviso de conectividade,
 * conteúdo e navegação.
 *
 * No celular a navegação é uma barra inferior de cinco destinos com
 * rótulo sempre visível; a partir de `md` a mesma marcação vira uma
 * pílula flutuante centralizada, para bater ponto pelo computador.
 */

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { motion, useReducedMotion } from 'motion/react';
import {
  CalendarClock,
  CircleUserRound,
  Clock,
  FileClock,
  Fingerprint,
  History,
  House,
  MapPin,
  WifiOff,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { InsightLogo } from '@/components/layout/insight-logo';
import { StatusBadge } from './primitives';
import { ThemeToggle } from './ThemeToggle';

/* ───────────────────── cabeçalho ───────────────────── */

export interface MobileHeaderProps {
  fullName: string | null;
  jobTitle?: string | null;
  /** Obra/projeto corrente, quando houver. */
  worksite?: string | null;
  /** Quantidade de itens que pedem atenção (pendências, recusas). */
  alerts?: number;
  right?: React.ReactNode;
}

function initials(name: string | null): string {
  if (!name) return '—';
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? parts[parts.length - 1][0] : '';
  return (first + last).toUpperCase() || '—';
}

export function MobileHeader({ fullName, jobTitle, worksite, alerts = 0, right }: MobileHeaderProps) {
  const today = React.useMemo(
    () => new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' }),
    [],
  );

  return (
    <header className="border-b border-ig-border bg-ig-base px-5 pb-4 pt-[max(0.75rem,env(safe-area-inset-top))]">
      {/* Faixa da marca: o logo Insight Energy assina o produto; "Ponto"
          identifica o módulo sem competir com ele. */}
      <div className="mx-auto mb-3 flex w-full max-w-6xl items-center gap-2.5">
        <InsightLogo width={124} height={16} animated={false} priority alt="Insight Energy" />
        <span className="flex items-center gap-1 rounded-full bg-ig-accent-weak px-2 py-0.5 text-ig-label uppercase text-ig-accent">
          <Clock className="h-3 w-3" aria-hidden="true" />
          Ponto
        </span>
        {/* No celular o toggle mora no Perfil: a faixa da marca não comporta
            logo + módulo + tema + sair em 320px. */}
        <ThemeToggle className="ml-auto hidden md:inline-flex" />
        <span className="ml-auto shrink-0 md:ml-0">{right}</span>
      </div>

      <div className="mx-auto flex w-full max-w-6xl items-start gap-3">
        <span
          aria-hidden="true"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-ig-border bg-ig-panel text-ig-h3 text-ig-fg-strong"
        >
          {initials(fullName)}
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-ig-h1 text-ig-fg-strong">{fullName ?? 'Colaborador'}</h1>
          {/* `capitalize` deixaria "Quarta-Feira, 29 De Julho"; em português
              só a primeira letra sobe. */}
          <p className="truncate text-ig-caption text-ig-fg-muted first-letter:uppercase">{today}</p>
          {worksite ? (
            <p className="mt-1 flex items-center gap-1 truncate text-ig-caption text-ig-fg-subtle">
              <MapPin className="h-3 w-3 shrink-0" aria-hidden="true" />
              {worksite}
            </p>
          ) : jobTitle ? (
            <p className="mt-1 truncate text-ig-caption text-ig-fg-subtle">{jobTitle}</p>
          ) : null}
        </div>
        {alerts > 0 ? (
          <Link
            href="/ponto/solicitacoes"
            className="shrink-0 rounded-full focus-visible:outline-none focus-visible:shadow-[var(--ig-focus-ring-outer)]"
            aria-label={`${alerts} ${alerts === 1 ? 'item precisa' : 'itens precisam'} da sua atenção`}
          >
            <StatusBadge label={String(alerts)} tone="warning" icon={FileClock} />
          </Link>
        ) : null}
      </div>
    </header>
  );
}

/* ───────────────────── aviso de conectividade ───────────────────── */

export function OfflineBanner({ online, pendingCount }: { online: boolean; pendingCount: number }) {
  if (online && pendingCount === 0) return null;
  const offline = !online;
  return (
    <div
      role="status"
      className={cn(
        'border-b px-5 py-2.5 text-ig-caption',
        offline
          ? 'border-[color-mix(in_oklab,var(--ig-warning)_30%,transparent)] bg-[color-mix(in_oklab,var(--ig-warning)_12%,transparent)] text-ig-warning'
          : 'border-[color-mix(in_oklab,var(--ig-info)_30%,transparent)] bg-[color-mix(in_oklab,var(--ig-info)_12%,transparent)] text-ig-info',
      )}
    >
      <p className="mx-auto flex w-full max-w-6xl items-center gap-2">
        {offline ? <WifiOff className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /> : <CalendarClock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
        {offline
          ? pendingCount > 0
            ? `Sem internet. ${pendingCount} ${pendingCount === 1 ? 'marcação salva' : 'marcações salvas'} no aparelho.`
            : 'Sem internet. Você ainda pode registrar o ponto — salvamos no aparelho.'
          : `${pendingCount} ${pendingCount === 1 ? 'marcação aguarda' : 'marcações aguardam'} envio ao servidor.`}
      </p>
    </div>
  );
}

/* ───────────────────── navegação ───────────────────── */

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  emphasis: boolean;
}

const NAV_ITEMS: readonly NavItem[] = [
  { href: '/ponto', label: 'Início', icon: House, emphasis: false },
  { href: '/ponto/historico', label: 'Histórico', icon: History, emphasis: false },
  { href: '/ponto', label: 'Bater ponto', icon: Fingerprint, emphasis: true },
  { href: '/ponto/solicitacoes', label: 'Solicitações', icon: FileClock, emphasis: false },
  { href: '/ponto/perfil', label: 'Perfil', icon: CircleUserRound, emphasis: false },
];

const NAV_ITEM_CLASS = cn(
  'relative flex min-h-[52px] w-full flex-col items-center justify-center gap-0.5 px-1 py-1.5',
  'rounded-[var(--ig-radius-md)] text-[10px] font-semibold leading-tight transition-colors',
  'focus-visible:outline-none focus-visible:shadow-[var(--ig-focus-ring-outer)]',
  // No desktop cada item vira uma cápsula da pílula: ícone + rótulo em linha.
  'md:min-h-[40px] md:w-auto md:flex-row md:gap-2 md:rounded-full md:px-5 md:py-2 md:text-ig-body-sm',
);

/** Lâmpada do item ativo — o indicador desliza entre as cápsulas. */
function ActiveLamp({ reduceMotion }: { reduceMotion: boolean }) {
  return (
    <motion.span
      layoutId="ponto-nav-lamp"
      aria-hidden="true"
      initial={false}
      transition={reduceMotion ? { duration: 0 } : { type: 'spring', stiffness: 300, damping: 30 }}
      className={cn(
        'absolute inset-0 -z-10 rounded-[var(--ig-radius-md)] bg-ig-accent-weak md:rounded-full',
      )}
    >
      {/* O facho só existe onde há espaço acima da cápsula (desktop). */}
      <span className="absolute -top-[7px] left-1/2 hidden h-1 w-8 -translate-x-1/2 rounded-t-full bg-ig-accent md:block">
        <span className="absolute -left-2 -top-2 h-6 w-12 rounded-full bg-[color-mix(in_oklab,var(--ig-accent)_22%,transparent)] blur-md" />
        <span className="absolute -top-1 h-6 w-8 rounded-full bg-[color-mix(in_oklab,var(--ig-accent)_22%,transparent)] blur-md" />
        <span className="absolute left-2 top-0 h-4 w-4 rounded-full bg-[color-mix(in_oklab,var(--ig-accent)_22%,transparent)] blur-sm" />
      </span>
    </motion.span>
  );
}

/**
 * Cinco destinos, rótulo SEMPRE visível (§11 — nada de navegação só de
 * ícone em destino essencial).
 *
 * Duas formas na mesma marcação: no celular é a barra inferior de largura
 * total, alcançável com o polegar; no computador vira uma pílula flutuante
 * centralizada, com o indicador deslizante. A ação central é um botão (e
 * não um link) porque abre o fluxo de registro na tela de Início —
 * inclusive quando o colaborador já está nela.
 */
export function BottomNavigation({ onPunchAction }: { onPunchAction?: () => void }) {
  const pathname = usePathname();
  const reduceMotion = useReducedMotion() ?? false;

  return (
    <nav
      aria-label="Navegação principal"
      className={cn(
        'fixed inset-x-0 bottom-0 z-40 border-t border-ig-border bg-ig-base',
        'pb-[env(safe-area-inset-bottom)] shadow-[0_-8px_24px_rgba(0,0,0,0.18)]',
        // `sticky` em vez de `fixed` para a pílula não cobrir a marca do
        // cabeçalho na primeira dobra — ela gruda no topo ao rolar.
        'md:sticky md:inset-x-auto md:bottom-auto md:top-4 md:mx-auto md:mt-4 md:w-fit',
        'md:border-0 md:bg-transparent md:pb-0 md:shadow-none',
      )}
    >
      <ul
        className={cn(
          'mx-auto flex w-full max-w-3xl items-stretch justify-between gap-1 px-2 py-1.5',
          'md:w-auto md:items-center md:justify-center md:gap-1 md:rounded-full md:px-1.5',
          'md:border md:border-ig-border-strong md:bg-ig-panel md:shadow-[var(--ig-shadow-e2)]',
          'md:backdrop-blur-lg md:backdrop-saturate-150',
        )}
      >
        {NAV_ITEMS.map((item) => {
          const active = item.emphasis ? false : pathname === item.href;
          const Icon = item.icon;
          const tone = item.emphasis
            ? 'bg-ig-accent text-[var(--ig-accent-fg,#fff)] hover:bg-ig-accent-strong'
            : active
              ? 'text-ig-accent'
              : 'text-ig-fg-subtle hover:bg-ig-panel-hover hover:text-ig-fg-strong';
          const content = (
            <>
              <Icon className="h-5 w-5 shrink-0 md:h-4 md:w-4" aria-hidden="true" />
              <span className="w-full truncate text-center md:w-auto">{item.label}</span>
              {active ? <ActiveLamp reduceMotion={reduceMotion} /> : null}
            </>
          );
          return (
            <li key={item.label} className="min-w-0 flex-1 md:flex-none">
              {item.emphasis && onPunchAction ? (
                <button type="button" onClick={onPunchAction} className={cn(NAV_ITEM_CLASS, tone)}>
                  {content}
                </button>
              ) : (
                <Link
                  href={item.href}
                  aria-current={active ? 'page' : undefined}
                  className={cn(NAV_ITEM_CLASS, tone)}
                >
                  {content}
                </Link>
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/* ───────────────────── casca ───────────────────── */

export function EmployeeAppShell({
  header,
  online,
  pendingCount,
  onPunchAction,
  children,
}: {
  header: React.ReactNode;
  online: boolean;
  pendingCount: number;
  onPunchAction?: () => void;
  children: React.ReactNode;
}) {
  return (
    <div data-ponto-theme data-ponto-canvas className="flex min-h-[100dvh] flex-col bg-ig-canvas text-ig-fg">
      {header}
      {/* O aviso vem antes da navegação: no desktop a pílula fica logo
          acima do conteúdo; no celular ela é fixa embaixo e a ordem do DOM
          só importa para o leitor de tela. */}
      <OfflineBanner online={online} pendingCount={pendingCount} />
      <BottomNavigation onPunchAction={onPunchAction} />
      <main className="mx-auto w-full max-w-6xl flex-1 px-5 pb-[calc(88px+env(safe-area-inset-bottom))] pt-5 md:pb-10">
        {children}
      </main>
    </div>
  );
}
