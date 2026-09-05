'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

export interface HudTab {
  id: string;
  label: string;
  icon?: React.ReactNode;
  badge?: number;
  content: React.ReactNode;
  disabled?: boolean;
}

export interface HudTabsProps {
  tabs: HudTab[];
  defaultTab?: string;
  activeTab?: string;
  onTabChange?: (tabId: string) => void;
  variant?: 'default' | 'pills' | 'underline';
  size?: 'sm' | 'md';
  className?: string;
  contentClassName?: string;
  /** Accessible name for the tablist (e.g. "Seções do dossiê"). */
  label?: string;
  /** Stable hook for tests. Applied to the tablist element. */
  'data-testid'?: string;
}

export function HudTabs({
  tabs,
  defaultTab,
  activeTab: controlledActiveTab,
  onTabChange,
  variant = 'default',
  size = 'md',
  className,
  contentClassName,
  label,
  'data-testid': testId,
}: HudTabsProps) {
  const baseId = React.useId();
  const [internalActiveTab, setInternalActiveTab] = useState(defaultTab || tabs[0]?.id);
  const activeTab = controlledActiveTab ?? internalActiveTab;

  // Fade-edge hint for the horizontally scrollable tab list. A mask (not a
  // colored overlay) fades the clipped side, so it works over any surface in
  // both themes without layout shift.
  const listRef = useRef<HTMLDivElement>(null);
  const [fade, setFade] = useState({ left: false, right: false });

  const updateFade = useCallback(() => {
    const el = listRef.current;
    if (!el) return;
    const left = el.scrollLeft > 4;
    const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 4;
    setFade((prev) => (prev.left === left && prev.right === right ? prev : { left, right }));
  }, []);

  useEffect(() => {
    updateFade();
    const el = listRef.current;
    if (!el) return;
    el.addEventListener('scroll', updateFade, { passive: true });
    const observer = new ResizeObserver(updateFade);
    observer.observe(el);
    return () => {
      el.removeEventListener('scroll', updateFade);
      observer.disconnect();
    };
  }, [updateFade, tabs.length]);

  // Keep the active tab visible when it changes while the list is scrolled.
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>('[data-tab-active]');
    el?.scrollIntoView({ inline: 'nearest', block: 'nearest' });
  }, [activeTab]);

  const maskImage =
    fade.left && fade.right
      ? 'linear-gradient(to right, transparent, black 28px, black calc(100% - 28px), transparent)'
      : fade.left
        ? 'linear-gradient(to right, transparent, black 28px)'
        : fade.right
          ? 'linear-gradient(to right, black calc(100% - 28px), transparent)'
          : undefined;

  const handleTabChange = (tabId: string) => {
    if (controlledActiveTab === undefined) {
      setInternalActiveTab(tabId);
    }
    onTabChange?.(tabId);
  };

  const activeTabData = tabs.find((t) => t.id === activeTab);

  /*
    Navegação por teclado do padrão ARIA tabs: setas percorrem, Home/End vão às
    pontas, abas desabilitadas são puladas. Antes, as abas eram <button> soltos
    dentro de um <div> — funcionavam no clique, mas um leitor de tela não sabia
    que eram um conjunto, e o Tab percorria as sete uma a uma.
  */
  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    const enabled = tabs.filter((tab) => !tab.disabled);
    if (enabled.length === 0) return;

    let next: HudTab | undefined;
    if (step !== 0) {
      const current = enabled.findIndex((tab) => tab.id === activeTab);
      next = enabled[(current + step + enabled.length) % enabled.length];
    } else if (event.key === 'Home') {
      next = enabled[0];
    } else if (event.key === 'End') {
      next = enabled[enabled.length - 1];
    }
    if (!next) return;

    event.preventDefault();
    handleTabChange(next.id);
    listRef.current
      ?.querySelector<HTMLElement>(`[data-tab-id="${CSS.escape(next.id)}"]`)
      ?.focus();
  };

  const variantStyles = {
    default: {
      list: 'hud-tabs-list-default p-1 rounded-lg',
      tab: 'px-4 py-2 rounded-md text-sm font-medium transition-all duration-200',
      active: 'hud-tab-active',
      inactive: 'hud-tab-inactive',
    },
    pills: {
      list: 'gap-1',
      tab: 'px-4 py-2 rounded-full text-sm font-medium transition-all duration-200 border',
      active: 'hud-tab-pill-active bg-ig-accent-weak text-ig-accent border-ig-border-focus',
      inactive: 'hud-tab-pill-inactive text-ig-fg-muted border-ig-border',
    },
    underline: {
      list: 'hud-tabs-list-underline border-b',
      tab: 'px-4 py-3 text-sm font-medium transition-all duration-200 relative',
      active: 'hud-tab-underline-active text-ig-accent',
      inactive: 'hud-tab-underline-inactive text-ig-fg-muted hover:text-ig-fg',
    },
  };

  const styles = variantStyles[variant];
  const sizeStyles = size === 'sm' ? 'text-xs px-3 py-1.5' : '';

  return (
    <div className={className}>
      {/* Tab List — scrolls horizontally instead of squishing when there are many tabs */}
      <div
        ref={listRef}
        role="tablist"
        aria-label={label}
        aria-orientation="horizontal"
        data-testid={testId}
        onKeyDown={handleKeyDown}
        style={{ maskImage, WebkitMaskImage: maskImage }}
        className={cn(
          'flex items-center overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
          styles.list,
        )}
      >
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            id={`${baseId}-tab-${tab.id}`}
            aria-selected={activeTab === tab.id}
            aria-controls={`${baseId}-panel-${tab.id}`}
            tabIndex={activeTab === tab.id ? 0 : -1}
            data-tab-id={tab.id}
            data-tab-active={activeTab === tab.id || undefined}
            onClick={() => !tab.disabled && handleTabChange(tab.id)}
            disabled={tab.disabled}
            className={cn(
              styles.tab,
              sizeStyles,
              activeTab === tab.id ? styles.active : styles.inactive,
              tab.disabled && 'opacity-50 cursor-not-allowed',
              'flex shrink-0 items-center gap-2 whitespace-nowrap'
            )}
          >
            {tab.icon}
            <span>{tab.label}</span>
            {tab.badge !== undefined && tab.badge > 0 && (
              <span className="hud-tab-badge ml-1 px-1.5 py-0.5 text-[10px] font-semibold rounded-full">
                {tab.badge}
              </span>
            )}
            {/* Underline indicator */}
            {variant === 'underline' && activeTab === tab.id && (
              <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-ig-accent" />
            )}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div
        role="tabpanel"
        id={activeTabData ? `${baseId}-panel-${activeTabData.id}` : undefined}
        aria-labelledby={activeTabData ? `${baseId}-tab-${activeTabData.id}` : undefined}
        tabIndex={0}
        className={cn('mt-4 focus-visible:outline-none', contentClassName)}
      >
        {activeTabData?.content}
      </div>
    </div>
  );
}
