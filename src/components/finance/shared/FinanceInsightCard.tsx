'use client';

import React from 'react';
import { Sparkles, AlertTriangle, TrendingUp, TrendingDown, Lightbulb } from 'lucide-react';
import { cn } from '@/lib/utils';

export type FinanceInsightTone = 'positive' | 'negative' | 'neutral' | 'warning';

export interface FinanceInsight {
  id: string;
  tone: FinanceInsightTone;
  title: string;
  detail: string;
  action?: { label: string; onClick?: () => void };
}

const TONE: Record<FinanceInsightTone, { dot: string; text: string; icon: React.ReactNode }> = {
  positive: { dot: 'bg-ig-success', text: 'text-ig-success', icon: <TrendingUp className="w-3.5 h-3.5" /> },
  negative: { dot: 'bg-ig-danger', text: 'text-ig-danger', icon: <TrendingDown className="w-3.5 h-3.5" /> },
  neutral:  { dot: 'bg-ig-info', text: 'text-ig-info', icon: <Lightbulb className="w-3.5 h-3.5" /> },
  warning:  { dot: 'bg-ig-warning', text: 'text-ig-warning', icon: <AlertTriangle className="w-3.5 h-3.5" /> },
};

export interface FinanceInsightCardProps {
  title?: string;
  subtitle?: string;
  insights: FinanceInsight[];
  className?: string;
}

export function FinanceInsightCard({
  title = 'AI Financial Analyst',
  subtitle = 'Insights contextuais sobre o período selecionado',
  insights,
  className,
}: FinanceInsightCardProps) {
  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-xl border border-ig-border-subtle bg-ig-panel/85 backdrop-blur-xl',
        'shadow-[0_10px_30px_-15px_rgba(0,0,0,0.45)]',
        className,
      )}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.6] [background:radial-gradient(60%_120%_at_0%_0%,color-mix(in_oklab,var(--ig-accent)_18%,transparent),transparent)]"
      />
      <div className="relative px-5 py-4 border-b border-ig-border-subtle flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-ig-accent-weak border border-ig-border-focus text-ig-accent">
          <Sparkles className="w-4 h-4" strokeWidth={1.7} />
        </div>
        <div className="min-w-0">
          <div className="text-[13.5px] font-semibold text-ig-text-primary">{title}</div>
          <div className="text-[11px] text-ig-text-tertiary">{subtitle}</div>
        </div>
      </div>
      <ul className="relative divide-y divide-ig-border-subtle/60">
        {insights.map((i) => {
          const tone = TONE[i.tone];
          return (
            <li key={i.id} className="px-5 py-3 flex items-start gap-3">
              <span className={cn('mt-1.5 w-1.5 h-1.5 rounded-full shrink-0', tone.dot)} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className={cn('shrink-0', tone.text)}>{tone.icon}</span>
                  <div className="text-[13px] font-medium text-ig-text-primary">{i.title}</div>
                </div>
                <div className="mt-0.5 text-[12px] leading-snug text-ig-text-secondary">{i.detail}</div>
                {i.action && (
                  <button
                    type="button"
                    onClick={i.action.onClick}
                    className="mt-1.5 text-[11px] font-medium text-ig-accent hover:underline"
                  >
                    {i.action.label} →
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
