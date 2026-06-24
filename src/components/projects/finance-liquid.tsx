'use client';

/**
 * ── Liquid-glass animated gradient (Phase-1, Projetos › Financeiro only) ─────
 *
 * Animated iridescent "liquid metal" gradient used as a subtle backdrop behind
 * the squared glass chips/cards. Adapted from the provided reference component;
 * import switched to `framer-motion` (the repo convention — same v12 engine as
 * `motion/react`).
 *
 * To stay enterprise/on-brand instead of rainbow, `buildAccentLiquidColors`
 * derives the 17 stops from a single semantic accent (metallic shades + faint
 * cyan/violet/emerald sheen). The caller keeps it subtle via opacity + blur.
 */

import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';

type ColorKey =
    | 'color1' | 'color2' | 'color3' | 'color4' | 'color5' | 'color6'
    | 'color7' | 'color8' | 'color9' | 'color10' | 'color11' | 'color12'
    | 'color13' | 'color14' | 'color15' | 'color16' | 'color17';

export type Colors = Record<ColorKey, string>;

// ── Hex shade helpers ───────────────────────────────────────────────────────

const clampByte = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
function parseHex(hex: string): [number, number, number] {
    const h = hex.replace('#', '');
    return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
}
function toHex([r, g, b]: [number, number, number]): string {
    return '#' + [r, g, b].map(v => clampByte(v).toString(16).padStart(2, '0')).join('');
}
function mix(hex: string, target: string, t: number): string {
    const a = parseHex(hex);
    const b = parseHex(target);
    return toHex([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]);
}
const shade = (hex: string, t: number) => (t >= 0 ? mix(hex, '#ffffff', t) : mix(hex, '#000000', -t));

/** 17-stop metallic liquid keyed to a single accent (kept on-brand, not rainbow). */
export function buildAccentLiquidColors(accent: string): Colors {
    return {
        color1: accent,
        color2: shade(accent, 0.35),
        color3: shade(accent, -0.28),
        color4: shade(accent, 0.55),
        color5: shade(accent, -0.42),
        color6: mix(accent, '#22D3EE', 0.40),
        color7: shade(accent, 0.20),
        color8: shade(accent, -0.16),
        color9: mix(accent, '#A78BFA', 0.34),
        color10: shade(accent, 0.46),
        color11: shade(accent, -0.32),
        color12: shade(accent, 0.30),
        color13: shade(accent, -0.20),
        color14: mix(accent, '#ffffff', 0.66),
        color15: shade(accent, 0.15),
        color16: shade(accent, -0.36),
        color17: mix(accent, '#34D399', 0.30),
    };
}

// ── Animated gradient SVG (verbatim logic from the reference) ────────────────

const svgOrder = ['svg1', 'svg2', 'svg3', 'svg4', 'svg3', 'svg2', 'svg1'] as const;
type SvgKey = (typeof svgOrder)[number];
type Stop = { offset: number; stopColor: string };
type SvgState = { gradientTransform: string; stops: Stop[] };
type SvgStates = Record<SvgKey, SvgState>;

const createStopsArray = (svgStates: SvgStates, order: readonly SvgKey[], maxStops: number): Stop[][] => {
    const stopsArray: Stop[][] = [];
    for (let i = 0; i < maxStops; i++) {
        const stopConfigurations = order.map(svgKey => {
            const svg = svgStates[svgKey];
            return svg.stops[i] || svg.stops[svg.stops.length - 1];
        });
        stopsArray.push(stopConfigurations);
    }
    return stopsArray;
};

type GradientSvgProps = { className: string; isHovered: boolean; colors: Colors; gradientId: string };

const GradientSvg: React.FC<GradientSvgProps> = ({ className, isHovered, colors, gradientId }) => {
    const svgStates: SvgStates = {
        svg1: {
            gradientTransform: 'translate(287.5 280) rotate(-29.0546) scale(689.807 1000)',
            stops: [
                { offset: 0, stopColor: colors.color1 },
                { offset: 0.188423, stopColor: colors.color2 },
                { offset: 0.260417, stopColor: colors.color3 },
                { offset: 0.328792, stopColor: colors.color4 },
                { offset: 0.328892, stopColor: colors.color5 },
                { offset: 0.328992, stopColor: colors.color1 },
                { offset: 0.442708, stopColor: colors.color6 },
                { offset: 0.537556, stopColor: colors.color7 },
                { offset: 0.631738, stopColor: colors.color1 },
                { offset: 0.725645, stopColor: colors.color8 },
                { offset: 0.817779, stopColor: colors.color9 },
                { offset: 0.84375, stopColor: colors.color10 },
                { offset: 0.90569, stopColor: colors.color1 },
                { offset: 1, stopColor: colors.color11 },
            ],
        },
        svg2: {
            gradientTransform: 'translate(126.5 418.5) rotate(-64.756) scale(533.444 773.324)',
            stops: [
                { offset: 0, stopColor: colors.color1 },
                { offset: 0.104167, stopColor: colors.color12 },
                { offset: 0.182292, stopColor: colors.color13 },
                { offset: 0.28125, stopColor: colors.color1 },
                { offset: 0.328792, stopColor: colors.color4 },
                { offset: 0.328892, stopColor: colors.color5 },
                { offset: 0.453125, stopColor: colors.color6 },
                { offset: 0.515625, stopColor: colors.color7 },
                { offset: 0.631738, stopColor: colors.color1 },
                { offset: 0.692708, stopColor: colors.color8 },
                { offset: 0.75, stopColor: colors.color14 },
                { offset: 0.817708, stopColor: colors.color9 },
                { offset: 0.869792, stopColor: colors.color10 },
                { offset: 1, stopColor: colors.color1 },
            ],
        },
        svg3: {
            gradientTransform: 'translate(264.5 339.5) rotate(-42.3022) scale(946.451 1372.05)',
            stops: [
                { offset: 0, stopColor: colors.color1 },
                { offset: 0.188423, stopColor: colors.color2 },
                { offset: 0.307292, stopColor: colors.color1 },
                { offset: 0.328792, stopColor: colors.color4 },
                { offset: 0.328892, stopColor: colors.color5 },
                { offset: 0.442708, stopColor: colors.color15 },
                { offset: 0.537556, stopColor: colors.color16 },
                { offset: 0.631738, stopColor: colors.color1 },
                { offset: 0.725645, stopColor: colors.color17 },
                { offset: 0.817779, stopColor: colors.color9 },
                { offset: 0.84375, stopColor: colors.color10 },
                { offset: 0.90569, stopColor: colors.color1 },
                { offset: 1, stopColor: colors.color11 },
            ],
        },
        svg4: {
            gradientTransform: 'translate(860.5 420) rotate(-153.984) scale(957.528 1388.11)',
            stops: [
                { offset: 0.109375, stopColor: colors.color11 },
                { offset: 0.171875, stopColor: colors.color2 },
                { offset: 0.260417, stopColor: colors.color13 },
                { offset: 0.328792, stopColor: colors.color4 },
                { offset: 0.328892, stopColor: colors.color5 },
                { offset: 0.328992, stopColor: colors.color1 },
                { offset: 0.442708, stopColor: colors.color6 },
                { offset: 0.515625, stopColor: colors.color7 },
                { offset: 0.631738, stopColor: colors.color1 },
                { offset: 0.692708, stopColor: colors.color8 },
                { offset: 0.817708, stopColor: colors.color9 },
                { offset: 0.869792, stopColor: colors.color10 },
                { offset: 1, stopColor: colors.color11 },
            ],
        },
    };

    const maxStops = Math.max(...Object.values(svgStates).map(svg => svg.stops.length));
    const stopsAnimationArray = createStopsArray(svgStates, svgOrder, maxStops);
    const gradientTransform = svgOrder.map(svgKey => svgStates[svgKey].gradientTransform);

    const variants = {
        hovered: { gradientTransform, transition: { duration: 18, repeat: Infinity, ease: 'linear' as const } },
        notHovered: { gradientTransform, transition: { duration: 42, repeat: Infinity, ease: 'linear' as const } },
    };

    return (
        <svg className={className} width="1030" height="280" viewBox="0 0 1030 280" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect width="1030" height="280" rx="0" fill={`url(#${gradientId})`} />
            <defs>
                <motion.radialGradient
                    id={gradientId}
                    cx="0"
                    cy="0"
                    r="1"
                    gradientUnits="userSpaceOnUse"
                    animate={isHovered ? variants.hovered : variants.notHovered}
                >
                    {stopsAnimationArray.map((stopConfigs, index) => (
                        <AnimatePresence key={index}>
                            <motion.stop
                                initial={{ offset: stopConfigs[0].offset, stopColor: stopConfigs[0].stopColor }}
                                animate={{
                                    offset: stopConfigs.map(config => config.offset),
                                    stopColor: stopConfigs.map(config => config.stopColor),
                                }}
                                transition={{ duration: 0, ease: 'linear', repeat: Infinity }}
                            />
                        </AnimatePresence>
                    ))}
                </motion.radialGradient>
            </defs>
        </svg>
    );
};

let liquidInstanceId = 0;

type LiquidProps = { isHovered: boolean; colors: Colors };

export const Liquid: React.FC<LiquidProps> = ({ isHovered, colors }) => {
    // Stable per-instance id so multiple liquid surfaces don't collide on the
    // shared SVG gradient id.
    const baseId = React.useMemo(() => `fin-liquid-${++liquidInstanceId}`, []);
    return (
        <>
            {Array.from({ length: 7 }).map((_, index) => (
                <div
                    key={index}
                    className={`absolute ${index < 3 ? 'w-[443px] h-[121px]' : 'w-[756px] h-[207px]'} ${
                        index === 0
                            ? 'top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 mix-blend-difference'
                            : index === 1
                                ? 'top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rotate-[164.971deg] mix-blend-difference'
                                : index === 2
                                    ? 'top-1/2 left-1/2 -translate-x-[53%] -translate-y-[53%] rotate-[-11.61deg] mix-blend-difference'
                                    : index === 3
                                        ? 'top-1/2 left-1/2 -translate-x-1/2 -translate-y-[57%] rotate-[-179.012deg] mix-blend-difference'
                                        : index === 4
                                            ? 'top-1/2 left-1/2 -translate-x-[57%] -translate-y-1/2 rotate-[-29.722deg] mix-blend-difference'
                                            : index === 5
                                                ? 'top-1/2 left-1/2 -translate-x-[62%] -translate-y-[24%] rotate-[160.227deg] mix-blend-difference'
                                                : 'top-1/2 left-1/2 -translate-x-[67%] -translate-y-[29%] rotate-180 mix-blend-hard-light'
                    }`}
                >
                    <GradientSvg className="w-full h-full" isHovered={isHovered} colors={colors} gradientId={`${baseId}-${index}`} />
                </div>
            ))}
        </>
    );
};

// ── Convenience backdrop wrapper ─────────────────────────────────────────────

/**
 * Drop-in liquid backdrop: absolutely fills a `relative` + `overflow-hidden`
 * parent, tinted from `accent`, kept subtle via opacity/blur so content stays
 * readable. `intensity` scales the visible strength.
 */
export function LiquidBackdrop({
    accent,
    isHovered = false,
    intensity = 'card',
}: {
    accent: string;
    isHovered?: boolean;
    intensity?: 'chip' | 'card';
}) {
    const colors = React.useMemo(() => buildAccentLiquidColors(accent), [accent]);
    const opacity = intensity === 'chip' ? 0.16 : 0.24;
    const blur = intensity === 'chip' ? 'blur-[10px]' : 'blur-[16px]';
    return (
        <span aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden rounded-[inherit]">
            <span className={`absolute inset-0 ${blur} saturate-150`} style={{ opacity }}>
                <span className="absolute left-1/2 top-1/2 block h-[300%] w-[300%] -translate-x-1/2 -translate-y-1/2">
                    <Liquid isHovered={isHovered} colors={colors} />
                </span>
            </span>
        </span>
    );
}
