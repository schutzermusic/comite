'use client';

/**
 * ── Project Finance HUD chip / card system ──────────────────────────────────
 *
 * Phase-1 design-system primitives, applied **only** inside
 * Projetos › Detalhe › Financeiro (FinanceView / FinanceInvestorCockpit).
 *
 * Visual language: squared glass (small radii, layered backdrop blur, inset
 * highlight, controlled shadow) with an optional animated liquid-metal backdrop
 * (see finance-liquid.tsx) on the focal surfaces — marker chips and alert cards.
 *
 * Families:
 *   • HudLegendChip  → chart-series toggles (line indicator, active/off states)
 *   • HudMarkerChip  → event annotations (CORTE / BREAK-EVEN / PICO) · liquid
 *   • HudMetricChip  → inline metric chips (A Faturar / A Receber …)
 *   • HudStatusChip  → compact status badges (eventograma rows)
 *   • HudAlertChip   → one-line data-quality warnings
 *   • HudAlertCard   → compact executive insight / alert cards · liquid
 *
 * Accents are passed as resolved hex (the caller builds a theme-aware palette),
 * so dark/light is handled upstream while the glass material stays consistent.
 * No business logic lives here.
 */

import React, { useState } from 'react';
import { AlertTriangle, Flag } from 'lucide-react';
import { cn } from '@/lib/utils';
import { LiquidBackdrop } from '@/components/projects/finance-liquid';

// ── Shared squared-glass surface ────────────────────────────────────────────

/** Translucent tinted glass keyed to an accent. `active=false` → quiet neutral. */
function chipSurface(accent: string, active = true): React.CSSProperties {
    if (!active) {
        return {
            background: 'color-mix(in oklab, var(--ig-fg-strong) 3%, transparent)',
            borderColor: 'var(--ig-border-subtle)',
            boxShadow: 'none',
        };
    }
    return {
        background: `linear-gradient(180deg, color-mix(in oklab, ${accent} 12%, transparent), color-mix(in oklab, ${accent} 5%, transparent))`,
        borderColor: `color-mix(in oklab, ${accent} 32%, transparent)`,
        boxShadow:
            'inset 0 1px 0 color-mix(in oklab, #fff 10%, transparent), inset 0 0 0 0.5px color-mix(in oklab, #fff 4%, transparent), 0 1px 2px -1px rgba(0,0,0,0.4)',
    };
}

// ── Legend chip (chart-series toggle) ───────────────────────────────────────

export function HudLegendChip({
    color,
    label,
    value,
    active = true,
    onClick,
    title,
}: {
    color: string;
    label: string;
    value?: string;
    active?: boolean;
    onClick?: () => void;
    title?: string;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            title={title ?? label}
            aria-pressed={active}
            className={cn(
                'group inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-[6px] border px-2 py-1',
                'text-[10.5px] font-medium leading-none backdrop-blur-md transition-all duration-150',
                'hover:-translate-y-px focus-visible:outline-none focus-visible:ring-2',
                'focus-visible:ring-[color-mix(in_oklab,var(--ig-accent)_38%,transparent)]',
                !active && 'opacity-60',
            )}
            style={{
                ...chipSurface(color, active),
                color: active ? 'var(--ig-fg-default)' : 'var(--ig-fg-subtle)',
            }}
        >
            <span
                aria-hidden
                className="h-[3px] w-3 shrink-0 rounded-full transition-all"
                style={
                    active
                        ? { background: color, boxShadow: `0 0 6px -1px color-mix(in oklab, ${color} 70%, transparent)` }
                        : { background: 'transparent', boxShadow: `inset 0 0 0 1.5px color-mix(in oklab, ${color} 55%, transparent)` }
                }
            />
            <span className={cn('truncate', !active && 'line-through decoration-1')}>{label}</span>
            {value && (
                <span
                    className="shrink-0 font-mono text-[10px] font-semibold tabular-nums"
                    style={{ color: active ? color : 'inherit' }}
                >
                    {value}
                </span>
            )}
        </button>
    );
}

// ── Marker chip (chart annotation: CORTE / BREAK-EVEN / PICO) · liquid ───────

export function HudMarkerChip({
    label,
    value,
    color,
    icon,
    liquid = true,
}: {
    label: string;
    value: string;
    color: string;
    icon?: React.ReactNode;
    liquid?: boolean;
}) {
    const [hovered, setHovered] = useState(false);
    return (
        <span
            title={`${label}: ${value}`}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
            className="relative inline-flex min-w-0 max-w-full items-center gap-1.5 overflow-hidden rounded-[6px] border py-1 pl-1 pr-2 backdrop-blur-md transition-transform duration-150 hover:-translate-y-px"
            style={chipSurface(color, true)}
        >
            {liquid && <LiquidBackdrop accent={color} isHovered={hovered} intensity="chip" />}
            <span
                aria-hidden
                className="relative z-[1] inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[5px]"
                style={{
                    background: `color-mix(in oklab, ${color} 22%, transparent)`,
                    color,
                    boxShadow: `inset 0 0 0 1px color-mix(in oklab, ${color} 40%, transparent)`,
                }}
            >
                {icon ?? <Flag className="h-2.5 w-2.5" />}
            </span>
            <span className="relative z-[1] text-[9px] font-semibold uppercase tracking-[0.12em] text-[color:var(--ig-fg-muted)]">
                {label}
            </span>
            <span className="relative z-[1] truncate font-mono text-[10px] font-semibold tabular-nums" style={{ color }}>
                {value}
            </span>
        </span>
    );
}

// ── Metric chip (inline value chip) ─────────────────────────────────────────

export function HudMetricChip({
    icon,
    label,
    value,
    sub,
    color,
    title,
}: {
    icon?: React.ReactNode;
    label: string;
    value: string;
    sub?: string;
    color: string;
    title?: string;
}) {
    return (
        <span
            title={title}
            className="inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-[6px] border px-2.5 py-1.5 backdrop-blur-md"
            style={chipSurface(color, true)}
        >
            {icon && (
                <span aria-hidden className="shrink-0" style={{ color }}>
                    {icon}
                </span>
            )}
            <span className="truncate text-[11px] font-medium text-[color:var(--ig-fg-muted)]">{label}</span>
            <span className="shrink-0 font-mono text-[11px] font-semibold tabular-nums" style={{ color }}>
                {value}
            </span>
            {sub && (
                <span className="shrink-0 font-mono text-[10px] tabular-nums text-[color:var(--ig-fg-subtle)]">
                    {sub}
                </span>
            )}
        </span>
    );
}

// ── Status chip (compact badge) ─────────────────────────────────────────────

export function HudStatusChip({
    label,
    color,
    size = 'sm',
    className,
}: {
    label: string;
    color: string;
    size?: 'sm' | 'md';
    className?: string;
}) {
    return (
        <span
            className={cn(
                'inline-flex items-center gap-1 rounded-[4px] border font-semibold uppercase tracking-wide backdrop-blur-md',
                size === 'sm' ? 'px-1.5 py-0.5 text-[9px]' : 'px-2 py-0.5 text-[10px]',
                className,
            )}
            style={{ ...chipSurface(color, true), color }}
        >
            <span aria-hidden className="h-1 w-1 shrink-0 rounded-[1px]" style={{ background: color }} />
            {label}
        </span>
    );
}

// ── Alert chip (one-line data-quality warning) ──────────────────────────────

export function HudAlertChip({
    children,
    color,
    icon,
    title,
}: {
    children: React.ReactNode;
    color: string;
    icon?: React.ReactNode;
    title?: string;
}) {
    return (
        <span
            title={title}
            className="inline-flex max-w-full items-center gap-1.5 rounded-[6px] border px-2.5 py-1.5 text-[10.5px] leading-snug backdrop-blur-md"
            style={chipSurface(color, true)}
        >
            <span aria-hidden className="shrink-0" style={{ color }}>
                {icon ?? <AlertTriangle className="h-3 w-3" />}
            </span>
            <span className="min-w-0 text-[color:var(--ig-fg-default)]">{children}</span>
        </span>
    );
}

// ── Alert / insight card (compact executive) · liquid ───────────────────────

export function HudAlertCard({
    accent,
    icon,
    title,
    message,
    action,
    children,
    className,
    liquid = true,
}: {
    accent: string;
    icon: React.ReactNode;
    title: React.ReactNode;
    message?: React.ReactNode;
    action?: React.ReactNode;
    children?: React.ReactNode;
    className?: string;
    liquid?: boolean;
}) {
    const [hovered, setHovered] = useState(false);
    return (
        <div
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
            className={cn('relative overflow-hidden rounded-[14px] border backdrop-blur-xl', className)}
            style={{
                borderColor: `color-mix(in oklab, ${accent} 28%, transparent)`,
                background: `linear-gradient(180deg, color-mix(in oklab, ${accent} 9%, transparent), color-mix(in oklab, ${accent} 3.5%, transparent))`,
                boxShadow:
                    'inset 0 1px 0 color-mix(in oklab, #fff 9%, transparent), inset 0 0 0 0.5px color-mix(in oklab, #fff 3%, transparent), 0 8px 24px -16px rgba(0,0,0,0.5)',
            }}
        >
            {liquid && <LiquidBackdrop accent={accent} isHovered={hovered} intensity="card" />}
            <span
                aria-hidden
                className="absolute inset-x-0 top-0 z-[1] h-px"
                style={{ background: `linear-gradient(90deg, transparent, ${accent}, transparent)` }}
            />
            <div className="relative z-[1] flex items-start gap-3 p-3.5">
                <span
                    aria-hidden
                    className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px]"
                    style={{
                        background: `color-mix(in oklab, ${accent} 16%, transparent)`,
                        color: accent,
                        boxShadow: `inset 0 0 0 1px color-mix(in oklab, ${accent} 30%, transparent)`,
                    }}
                >
                    {icon}
                </span>
                <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                            <p className="text-[13px] font-semibold tracking-tight" style={{ color: accent }}>
                                {title}
                            </p>
                            {message && (
                                <p className="mt-0.5 text-[11.5px] leading-relaxed text-[color:var(--ig-fg-muted)]">
                                    {message}
                                </p>
                            )}
                        </div>
                        {action && <div className="shrink-0">{action}</div>}
                    </div>
                    {children}
                </div>
            </div>
        </div>
    );
}
