'use client';

import React from 'react';
import { cn } from '@/lib/utils';

export type Finance3DTone = 'accent' | 'success' | 'danger' | 'warning' | 'info' | 'neutral';

export interface Finance3DMetricCardProps {
  label: string;
  value: string;
  delta?: { value: string; tone?: 'pos' | 'neg' | 'neutral' };
  caption?: string;
  tone?: Finance3DTone;
  icon?: React.ReactNode;
  intensity?: 'soft' | 'strong';
  className?: string;
  onClick?: () => void;
}

const TONE_RGB: Record<Finance3DTone, string> = {
  accent:  'var(--ig-accent)',
  success: 'var(--ig-success)',
  danger:  'var(--ig-danger)',
  warning: 'var(--ig-warning)',
  info:    'var(--ig-info)',
  neutral: 'var(--ig-fg-muted)',
};

/**
 * Glass + perspective metric panel. Pure CSS depth — no WebGL.
 * Used for executive metric tiles where extra visual weight is desired.
 */
export function Finance3DMetricCard({
  label, value, delta, caption,
  tone = 'accent', icon, intensity = 'soft',
  className, onClick,
}: Finance3DMetricCardProps) {
  const Tag = onClick ? 'button' : 'div';
  const toneVar = TONE_RGB[tone];
  const haloOpacity = intensity === 'strong' ? '0.45' : '0.30';

  return (
    <Tag
      onClick={onClick}
      type={onClick ? 'button' : undefined}
      className={cn(
        'group relative w-full text-left overflow-hidden',
        'rounded-2xl border border-ig-border-subtle',
        'bg-ig-panel/85 backdrop-blur-xl',
        'shadow-[0_30px_60px_-30px_rgba(0,0,0,0.55),0_4px_12px_-4px_rgba(0,0,0,0.30)]',
        '[transform:perspective(900px)_rotateX(2.5deg)]',
        'hover:[transform:perspective(900px)_rotateX(0deg)_translateZ(2px)]',
        'transition-[transform,box-shadow,border-color] duration-300 ease-out',
        'hover:border-ig-border-focus',
        className,
      )}
      style={{
        // Inner depth layers via inset shadow + halo + sweeping highlight
        backgroundImage: `
          radial-gradient(140% 110% at 0% 0%, color-mix(in oklab, ${toneVar} ${intensity === 'strong' ? '14%' : '9%'}, transparent), transparent 55%),
          radial-gradient(80% 60% at 100% 100%, color-mix(in oklab, ${toneVar} 6%, transparent), transparent 60%)
        `,
      }}
    >
      {/* halo glow behind the panel */}
      <span
        aria-hidden
        className="pointer-events-none absolute -inset-px rounded-2xl"
        style={{
          background: `radial-gradient(60% 90% at 0% 0%, color-mix(in oklab, ${toneVar} ${haloOpacity}%, transparent), transparent 60%)`,
          filter: 'blur(18px)', opacity: 0.55,
        }}
      />
      {/* top edge highlight */}
      <span aria-hidden className="pointer-events-none absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-white/25 to-transparent" />

      <div className="relative px-5 py-4 flex flex-col gap-1.5">
        <div className="flex items-center justify-between gap-3">
          <span className="text-[10.5px] uppercase tracking-[0.14em] text-ig-text-tertiary font-medium">{label}</span>
          {icon && (
            <span
              className="w-7 h-7 rounded-lg border flex items-center justify-center shadow-[inset_0_1px_0_rgba(255,255,255,0.12),0_8px_18px_-12px_rgba(0,0,0,0.55)]"
              style={{
                borderColor: `color-mix(in oklab, ${toneVar} 28%, transparent)`,
                background: `color-mix(in oklab, ${toneVar} 12%, transparent)`,
                color: toneVar,
              }}
            >
              {icon}
            </span>
          )}
        </div>

        <div
          className="text-[22px] leading-none font-semibold tabular-nums tracking-tight"
          style={{
            color: 'var(--ig-text-primary)',
            textShadow: `0 1px 0 rgba(255,255,255,0.08), 0 8px 28px color-mix(in oklab, ${toneVar} 28%, transparent)`,
          }}
        >
          {value}
        </div>

        <div className="flex items-baseline gap-2 mt-0.5">
          {delta && (
            <span
              className={cn(
                'text-[11.5px] tabular-nums',
                delta.tone === 'pos' && 'text-ig-success',
                delta.tone === 'neg' && 'text-ig-danger',
                (!delta.tone || delta.tone === 'neutral') && 'text-ig-text-secondary',
              )}
            >
              {delta.value}
            </span>
          )}
          {caption && <span className="text-[11px] text-ig-text-tertiary">{caption}</span>}
        </div>
      </div>

      {/* inner depth grid */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-x-3 bottom-2 h-[3px] rounded-full"
        style={{
          background: `linear-gradient(90deg, transparent, color-mix(in oklab, ${toneVar} 55%, transparent), transparent)`,
          filter: 'blur(1px)', opacity: 0.7,
        }}
      />
    </Tag>
  );
}
