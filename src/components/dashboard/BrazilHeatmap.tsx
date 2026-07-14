'use client';

import { FONT_FAMILY_SANS } from '@/lib/fonts';
import React, { useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { STATE_PROJECT_DATA, STATE_CENTROIDS, formatCompact } from '@/data/geo/brazil-operational-data';

/* ───────────────────────────────────────────────────────
   Brazil HUD Heatmap – hero center of the Control Room
   ─────────────────────────────────────────────────────── */

/* Geo projection bounds */
const GEO = {
    latMin: -34,
    latMax: 6,
    lngMin: -74,
    lngMax: -34,
};
const SVG_W = 600;
const SVG_H = 720;

function proj(lat: number, lng: number) {
    const x = ((lng - GEO.lngMin) / (GEO.lngMax - GEO.lngMin)) * SVG_W;
    const y = ((GEO.latMax - lat) / (GEO.latMax - GEO.latMin)) * SVG_H;
    return { x, y };
}

/* Simplified Brazil boundary polygon (27 key coastline + border points) */
const BRAZIL_BOUNDARY_COORDS: [number, number][] = [
    /* North coast */
    [4.4, -51.1],   // Oiapoque AP
    [2.5, -50.5],
    [1.0, -50.0],   // Macapá area
    [0.0, -51.1],
    [-1.0, -48.5],  // Belém
    [-2.5, -44.3],  // São Luís
    [-3.7, -38.5],  // Fortaleza
    [-5.8, -35.2],  // Natal
    [-7.1, -34.8],  // João Pessoa
    [-8.1, -34.9],  // Recife
    [-9.7, -35.7],  // Maceió
    [-10.9, -37.1], // Aracaju
    [-12.9, -38.5], // Salvador
    [-15.8, -39.0],
    [-18.5, -39.7],
    [-20.3, -40.3], // Vitória
    [-22.9, -43.2], // Rio
    [-24.0, -46.3], // Santos
    [-25.5, -48.5], // Curitiba coast
    [-27.6, -48.5], // Florianópolis
    [-29.3, -49.7],
    [-33.7, -53.4], // Chuí RS
    /* West border */
    [-30.0, -57.6],
    [-23.0, -57.6], // MS border
    [-16.0, -57.8], // MT border
    [-12.0, -60.0],
    [-10.0, -65.0], // RO
    [-7.5, -73.0],  // AC
    [-4.0, -70.0],  // AM west
    [-1.0, -69.0],
    [2.0, -64.0],
    [5.3, -60.5],   // RR north
    [4.0, -52.0],
];

function getOutlinePath() {
    return BRAZIL_BOUNDARY_COORDS.map(([lat, lng], i) => {
        const { x, y } = proj(lat, lng);
        return `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
    }).join(' ') + ' Z';
}

/* Heat config per state */
function heatCfg(sharePct: number) {
    if (sharePct > 30) return { r: 85, color: '#ef4444', opacity: 0.75, pulse: 22 };
    if (sharePct > 10) return { r: 65, color: '#f97316', opacity: 0.6, pulse: 18 };
    if (sharePct > 5) return { r: 50, color: '#f59e0b', opacity: 0.5, pulse: 16 };
    if (sharePct > 1) return { r: 40, color: '#10b981', opacity: 0.45, pulse: 14 };
    return { r: 32, color: '#06b6d4', opacity: 0.35, pulse: 12 };
}

interface Tip {
    uf: string;
    name: string;
    contracts: number;
    value: string;
    x: number;
    y: number;
}

export function BrazilHeatmap() {
    const [tip, setTip] = useState<Tip | null>(null);
    const [drift, setDrift] = useState({ x: 0, y: 0 });

    useEffect(() => {
        let raf: number;
        let t = 0;
        const tick = () => {
            t += 0.0015;
            setDrift({ x: Math.sin(t * 0.7) * 3, y: Math.cos(t * 0.45) * 2.5 });
            raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(raf);
    }, []);

    const states = STATE_PROJECT_DATA.map(s => {
        const pos = proj(s.lat, s.lng);
        const h = heatCfg(s.sharePct);
        return { ...s, ...pos, ...h };
    });

    const labels = Object.entries(STATE_CENTROIDS).map(([uf, d]) => {
        const pos = proj(d.lat, d.lng);
        const active = states.find(s => s.uf === uf);
        return { uf, ...pos, active: !!active };
    });

    /* Connector arcs from significant states to L/R panel edges */
    const connectors = states
        .filter(s => s.sharePct > 3)
        .map(s => {
            const toLeft = s.x < SVG_W * 0.42;
            const ex = toLeft ? -60 : SVG_W + 60;
            const cp = toLeft ? s.x - 120 : s.x + 120;
            return { ...s, ex, cp, toLeft };
        });

    const outlinePath = getOutlinePath();

    return (
        <div className="absolute inset-0 flex items-center justify-center" style={{ zIndex: 1 }}>
            {/* Ambient glow behind map */}
            <div
                className="absolute pointer-events-none"
                style={{
                    width: '70%',
                    height: '80%',
                    background: 'radial-gradient(ellipse 60% 65% at 52% 48%, rgba(16, 185, 129, 0.06) 0%, rgba(6, 182, 212, 0.03) 40%, transparent 70%)',
                    filter: 'blur(60px)',
                }}
            />

            <motion.svg
                viewBox={`-80 -30 ${SVG_W + 160} ${SVG_H + 60}`}
                className="w-full h-full pointer-events-auto"
                style={{ maxWidth: '580px', maxHeight: '86vh', overflow: 'visible' }}
                animate={{ x: drift.x, y: drift.y }}
                transition={{ duration: 0 }}
            >
                <defs>
                    {/* Per-state heatmap radial gradient */}
                    {states.map(s => (
                        <radialGradient key={`hg-${s.uf}`} id={`heat-${s.uf}`} cx="50%" cy="50%" r="50%">
                            <stop offset="0%" stopColor={s.color} stopOpacity={s.opacity} />
                            <stop offset="30%" stopColor={s.color} stopOpacity={s.opacity * 0.55} />
                            <stop offset="65%" stopColor={s.color} stopOpacity={s.opacity * 0.15} />
                            <stop offset="100%" stopColor={s.color} stopOpacity={0} />
                        </radialGradient>
                    ))}

                    <linearGradient id="br-stroke" x1="0" y1="0" x2="1" y2="1">
                        <stop offset="0%" stopColor="#06b6d4" stopOpacity="0.35" />
                        <stop offset="50%" stopColor="#10b981" stopOpacity="0.25" />
                        <stop offset="100%" stopColor="#06b6d4" stopOpacity="0.35" />
                    </linearGradient>

                    <filter id="hs-glow">
                        <feGaussianBlur stdDeviation="4.5" result="b" />
                        <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
                    </filter>
                    <filter id="blob-glow">
                        <feGaussianBlur stdDeviation="16" />
                    </filter>
                    <filter id="outline-glow">
                        <feGaussianBlur stdDeviation="2" result="b" />
                        <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
                    </filter>
                </defs>

                {/* ── Faint lat/lon grid ── */}
                <g opacity="0.04" stroke="#06b6d4" strokeWidth="0.4">
                    {Array.from({ length: 9 }, (_, i) => {
                        const y = ((i + 1) / 10) * SVG_H;
                        return <line key={`h${i}`} x1={-80} y1={y} x2={SVG_W + 80} y2={y} />;
                    })}
                    {Array.from({ length: 6 }, (_, i) => {
                        const x = ((i + 1) / 7) * SVG_W;
                        return <line key={`v${i}`} x1={x} y1={-30} x2={x} y2={SVG_H + 30} />;
                    })}
                </g>

                {/* ── Brazil outline (filled region + border) ── */}
                <path
                    d={outlinePath}
                    fill="rgba(10, 22, 18, 0.5)"
                    stroke="url(#br-stroke)"
                    strokeWidth="1.5"
                    strokeLinejoin="round"
                    filter="url(#outline-glow)"
                />

                {/* ── Inner state divisions (subtle) ── */}
                {states.map(s => (
                    <circle
                        key={`zone-${s.uf}`}
                        cx={s.x}
                        cy={s.y}
                        r={s.r * 0.6}
                        fill="none"
                        stroke="rgba(16, 185, 129, 0.04)"
                        strokeWidth="0.5"
                        strokeDasharray="2 4"
                    />
                ))}

                {/* ── Heatmap radiant blobs (screen blend) ── */}
                <g style={{ mixBlendMode: 'screen' }}>
                    {states.map(s => (
                        <React.Fragment key={`blobs-${s.uf}`}>
                            {/* Outer glow — very soft, very big */}
                            <circle
                                cx={s.x} cy={s.y}
                                r={s.r * 1.8}
                                fill={`url(#heat-${s.uf})`}
                                opacity={0.35}
                                filter="url(#blob-glow)"
                            />
                            {/* Core blob */}
                            <circle
                                cx={s.x} cy={s.y}
                                r={s.r}
                                fill={`url(#heat-${s.uf})`}
                            />
                        </React.Fragment>
                    ))}
                </g>

                {/* ── Connector arcs to panel edges (animated pulse) ── */}
                <g>
                    {connectors.map((c, i) => (
                        <path
                            key={`conn-${i}`}
                            d={`M ${c.x} ${c.y} Q ${c.cp} ${c.y} ${c.ex} ${c.y}`}
                            fill="none"
                            stroke={c.color}
                            strokeWidth="1"
                            strokeDasharray="5 7"
                            opacity="0.30"
                            className="cr-connector-pulse"
                            style={{ animationDuration: '5s' }}
                        />
                    ))}
                </g>

                {/* ── State labels ── */}
                {labels.map(({ uf, x, y, active }) => (
                    <text
                        key={`lbl-${uf}`}
                        x={x}
                        y={y - (active ? 18 : 12)}
                        textAnchor="middle"
                        style={{
                            fontSize: active ? '11px' : '8px',
                            fontWeight: active ? 700 : 400,
                            fill: active ? 'rgba(255,255,255,0.6)' : 'rgba(255,255,255,0.1)',
                            letterSpacing: '0.1em',
                            fontFamily: FONT_FAMILY_SANS,
                        }}
                    >
                        {uf}
                    </text>
                ))}

                {/* ── Pulsing hotspot dots ── */}
                {states.map(s => (
                    <g key={`hs-${s.uf}`}>
                        {/* Outer pulse ring — slower for premium feel */}
                        <circle cx={s.x} cy={s.y} r="7" fill="none" stroke={s.color} strokeWidth="0.7" opacity="0.45">
                            <animate attributeName="r" values={`5;${s.pulse};5`} dur={`${3 + s.sharePct * 0.05}s`} repeatCount="indefinite" />
                            <animate attributeName="opacity" values="0.45;0;0.45" dur={`${3 + s.sharePct * 0.05}s`} repeatCount="indefinite" />
                        </circle>
                        {/* Core dot */}
                        <circle
                            cx={s.x} cy={s.y}
                            r="4.5"
                            fill={s.color}
                            filter="url(#hs-glow)"
                            className="cursor-pointer"
                            onMouseEnter={() => setTip({
                                uf: s.uf,
                                name: STATE_CENTROIDS[s.uf]?.name || s.uf,
                                contracts: s.contractsCount,
                                value: formatCompact(s.totalContracted),
                                x: s.x, y: s.y,
                            })}
                            onMouseLeave={() => setTip(null)}
                        />
                    </g>
                ))}

                {/* ── Callout labels for top-3 states ── */}
                {states
                    .sort((a, b) => b.sharePct - a.sharePct)
                    .slice(0, 3)
                    .map((s, i) => (
                        <g key={`callout-${s.uf}`}>
                            {/* Connector line */}
                            <line
                                x1={s.x}
                                y1={s.y}
                                x2={s.x + (i % 2 === 0 ? 35 : -35)}
                                y2={s.y - 25}
                                stroke={s.color}
                                strokeWidth="0.5"
                                opacity="0.3"
                            />
                            <foreignObject
                                x={s.x + (i % 2 === 0 ? 30 : -95)}
                                y={s.y - 42}
                                width={65}
                                height={20}
                                style={{ overflow: 'visible', pointerEvents: 'none' }}
                            >
                                <div className="px-1.5 py-0.5 rounded bg-[#030604]/85 backdrop-blur-sm border border-white/[0.08] text-center shadow-lg">
                                    <span className="text-[7px] font-bold text-white/75 tracking-wider">
                                        {s.contractsCount} contratos
                                    </span>
                                </div>
                            </foreignObject>
                        </g>
                    ))}

                {/* ── Tooltip ── */}
                {tip && (
                    <foreignObject
                        x={tip.x - 75}
                        y={tip.y - 62}
                        width={150}
                        height={50}
                        style={{ overflow: 'visible', pointerEvents: 'none' }}
                    >
                        <div className="px-3 py-1.5 rounded-lg bg-[#030604]/95 backdrop-blur-xl border border-white/10 shadow-2xl text-center">
                            <p className="text-[10px] font-bold text-white/90 tracking-wider">{tip.uf} — {tip.name}</p>
                            <div className="flex justify-center gap-3 mt-0.5">
                                <span className="text-[8px] text-white/40">{tip.contracts} contratos</span>
                                <span className="text-[8px] text-emerald-400 font-semibold">{tip.value}</span>
                            </div>
                        </div>
                    </foreignObject>
                )}
            </motion.svg>
        </div>
    );
}
