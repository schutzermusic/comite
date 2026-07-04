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
}: HudTabsProps) {
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
        style={{ maskImage, WebkitMaskImage: maskImage }}
        className={cn(
          'flex items-center overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
          styles.list,
        )}
      >
        {tabs.map((tab) => (
          <button
            key={tab.id}
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
      <div className={cn('mt-4', contentClassName)}>
        {activeTabData?.content}
      </div>
    </div>
  );
}
