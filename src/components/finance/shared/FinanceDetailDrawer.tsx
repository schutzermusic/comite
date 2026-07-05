'use client';

import React from 'react';
import { HudDrawer } from '@/components/hud';
import { cn } from '@/lib/utils';

export interface FinanceDetailDrawerProps {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  metaPills?: { label: string; tone?: 'pos' | 'neg' | 'neutral' | 'info' | 'warn' }[];
  primaryActions?: React.ReactNode;
  width?: string;
  children: React.ReactNode;
}

const PILL_TONE: Record<NonNullable<FinanceDetailDrawerProps['metaPills']>[number]['tone'] & string, string> = {
  pos: 'border-[color-mix(in_oklab,var(--ig-success)_28%,transparent)] text-ig-success bg-[color-mix(in_oklab,var(--ig-success)_10%,transparent)]',
  neg: 'border-[color-mix(in_oklab,var(--ig-danger)_28%,transparent)] text-ig-danger bg-[color-mix(in_oklab,var(--ig-danger)_10%,transparent)]',
  neutral: 'border-ig-border-subtle text-ig-text-secondary bg-ig-surface-subtle/40',
  info: 'border-ig-border-focus text-ig-accent bg-ig-accent-weak',
  warn: 'border-[color-mix(in_oklab,var(--ig-warning)_28%,transparent)] text-ig-warning bg-[color-mix(in_oklab,var(--ig-warning)_10%,transparent)]',
};

export function FinanceDetailDrawer({
  open, onClose, title, subtitle,
  metaPills, primaryActions,
  width = '540px',
  children,
}: FinanceDetailDrawerProps) {
  return (
    <HudDrawer isOpen={open} onClose={onClose} title={title} subtitle={subtitle} width={width}>
      <div className="flex flex-col gap-5">
        {(metaPills?.length || primaryActions) && (
          <div className="flex flex-wrap items-center justify-between gap-3 -mt-1">
            {metaPills && metaPills.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {metaPills.map((p, idx) => (
                  <span
                    key={idx}
                    className={cn(
                      'inline-flex items-center px-2 py-0.5 rounded-md border text-[11px] font-medium',
                      PILL_TONE[p.tone || 'neutral'],
                    )}
                  >
                    {p.label}
                  </span>
                ))}
              </div>
            )}
            {primaryActions && <div className="flex items-center gap-2">{primaryActions}</div>}
          </div>
        )}
        {children}
      </div>
    </HudDrawer>
  );
}

export function FinanceDrawerSection({
  title, children, action,
}: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-ig-border-subtle bg-ig-surface-subtle/40">
      <header className="flex items-center justify-between px-4 py-2.5 border-b border-ig-border-subtle/60">
        <h4 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ig-text-tertiary">{title}</h4>
        {action}
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}

export function FinanceDrawerKeyValue({
  rows,
}: {
  rows: { label: string; value: React.ReactNode; tone?: 'pos' | 'neg' | 'neutral' }[];
}) {
  return (
    <dl className="grid grid-cols-2 gap-x-6 gap-y-2.5">
      {rows.map((r, i) => (
        <div key={i} className="flex flex-col gap-0.5 min-w-0">
          <dt className="text-[10px] uppercase tracking-[0.12em] text-ig-text-tertiary">{r.label}</dt>
          <dd
            className={cn(
              'text-[13px] tabular-nums truncate',
              r.tone === 'pos' && 'text-ig-success',
              r.tone === 'neg' && 'text-ig-danger',
              !r.tone && 'text-ig-text-primary',
            )}
          >
            {r.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
