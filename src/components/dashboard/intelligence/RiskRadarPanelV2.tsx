'use client';

import React, { useMemo } from 'react';

type RiskLevel = 'critical' | 'high' | 'medium' | 'low';

interface RiskPoint {
    id: string;
    title: string;
    description?: string;
    level: RiskLevel;
    angle: number; // 0-360 degrees
    distance?: number; // 0-1, distance from center
    category?: string;
}

interface RiskRadarPanelV2Props {
    risks: RiskPoint[];
    className?: string;
}

const levelConfig: Record<RiskLevel, { color: string; bgColor: string; glowColor: string }> = {
    critical: {
        color: '#EF4444',
        bgColor: 'rgba(239, 68, 68, 0.15)',
        glowColor: 'rgba(239, 68, 68, 0.4)'
    },
    high: {
        color: '#F59E0B',
        bgColor: 'rgba(245, 158, 11, 0.12)',
        glowColor: 'rgba(245, 158, 11, 0.35)'
    },
    medium: {
        color: '#14B8A6',
        bgColor: 'rgba(20, 184, 166, 0.10)',
        glowColor: 'rgba(20, 184, 166, 0.3)'
    },
    low: {
        color: 'rgba(160, 200, 190, 0.6)',
        bgColor: 'rgba(160, 200, 190, 0.08)',
        glowColor: 'rgba(160, 200, 190, 0.2)'
    },
};

export function RiskRadarPanelV2({
    risks,
    className = '',
}: RiskRadarPanelV2Props) {
    const [hoveredRisk, setHoveredRisk] = React.useState<string | null>(null);

    // Count by severity
    const counts = useMemo(() => {
        return risks.reduce((acc, risk) => {
            acc[risk.level] = (acc[risk.level] || 0) + 1;
            return acc;
        }, {} as Record<RiskLevel, number>);
    }, [risks]);

    // Calculate positions for risk dots
    const getPointPosition = (angle: number, distance = 0.7) => {
        const rad = (angle - 90) * (Math.PI / 180);
        const radius = 85 * distance;
        return {
            x: 100 + radius * Math.cos(rad),
            y: 100 + radius * Math.sin(rad),
        };
    };

    return (
        <div className={`intel-panel p-5 ${className}`}>
            {/* Header */}
            <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                    <h2 className="intel-text-label">RADAR DE RISCOS</h2>
                    <span className="text-xs text-intel-text-muted">• 3.6 Mile</span>
                </div>

                {/* Toggle buttons */}
                <div className="flex items-center gap-2 text-xs">
                    <button className="px-2 py-0.5 rounded bg-intel-bg-elevated text-intel-text-secondary">
                        Registro
                    </button>
                    <button className="px-2 py-0.5 rounded text-intel-text-muted hover:text-intel-text-secondary transition-colors">
                        RSOFICO
                    </button>
                    <button className="px-2 py-0.5 rounded text-intel-text-muted hover:text-intel-text-secondary transition-colors">
                        O 9.15
                    </button>
                    <button className="px-2 py-0.5 rounded text-intel-text-muted hover:text-intel-text-secondary transition-colors">
                        Cicler
                    </button>
                </div>
            </div>

            {/* Radar visualization */}
            <div className="relative flex justify-center items-center py-4">
                <svg width="200" height="200" viewBox="0 0 200 200" className="opacity-90">
                    {/* Orbital rings */}
                    {[0.33, 0.66, 1].map((scale, i) => (
                        <circle
                            key={i}
                            cx="100"
                            cy="100"
                            r={85 * scale}
                            fill="none"
                            stroke="rgba(160, 200, 190, 0.08)"
                            strokeWidth="1"
                            strokeDasharray={i === 2 ? "none" : "2 4"}
                        />
                    ))}

                    {/* Cross lines */}
                    <line x1="100" y1="15" x2="100" y2="185" stroke="rgba(160, 200, 190, 0.06)" strokeWidth="1" />
                    <line x1="15" y1="100" x2="185" y2="100" stroke="rgba(160, 200, 190, 0.06)" strokeWidth="1" />

                    {/* Risk points */}
                    {risks.map((risk) => {
                        const pos = getPointPosition(risk.angle, risk.distance || 0.7);
                        const config = levelConfig[risk.level];
                        const isHovered = hoveredRisk === risk.id;

                        return (
                            <g
                                key={risk.id}
                                onMouseEnter={() => setHoveredRisk(risk.id)}
                                onMouseLeave={() => setHoveredRisk(null)}
                                className="cursor-pointer"
                            >
                                {/* Glow effect */}
                                <circle
                                    cx={pos.x}
                                    cy={pos.y}
                                    r={isHovered ? 12 : 8}
                                    fill={config.glowColor}
                                    className="transition-all duration-200"
                                />
                                {/* Main dot */}
                                <circle
                                    cx={pos.x}
                                    cy={pos.y}
                                    r={isHovered ? 6 : 4}
                                    fill={config.color}
                                    className="transition-all duration-200"
                                />
                            </g>
                        );
                    })}

                    {/* Center point */}
                    <circle cx="100" cy="100" r="3" fill="#14B8A6" />
                </svg>

                {/* Hover tooltip */}
                {hoveredRisk && (
                    <div className="absolute bottom-4 left-1/2 -translate-x-1/2 px-3 py-2 rounded-lg bg-intel-bg-elevated border border-intel-border-DEFAULT shadow-lg">
                        {(() => {
                            const risk = risks.find(r => r.id === hoveredRisk);
                            if (!risk) return null;
                            return (
                                <div className="text-center">
                                    <div className="flex items-center gap-2 mb-1">
                                        <span className={`w-2 h-2 rounded-full`} style={{ background: levelConfig[risk.level].color }} />
                                        <span className="text-xs font-medium text-intel-text-primary">{risk.title}</span>
                                    </div>
                                    {risk.description && (
                                        <p className="text-xs text-intel-text-muted">{risk.description}</p>
                                    )}
                                </div>
                            );
                        })()}
                    </div>
                )}

                {/* Legend overlay */}
                <div className="absolute top-2 left-2 flex flex-col gap-1">
                    <div className="flex items-center gap-1.5 text-xs">
                        <span className="w-2.5 h-2.5 rounded-full border border-intel-accent-amber" style={{ background: levelConfig.high.bgColor }} />
                        <span className="text-intel-text-muted">11 médio</span>
                    </div>
                    <div className="flex items-center gap-1.5 text-xs">
                        <span className="w-2.5 h-2.5 rounded-full bg-intel-accent-amber" />
                        <span className="text-intel-text-muted">Ionpoi Ã, S</span>
                    </div>
                </div>
            </div>

            {/* Footer severity chips */}
            <div className="flex items-center justify-center gap-4 pt-3 border-t border-intel-border-subtle">
                <div className="intel-chip intel-severity-high">
                    <span className="font-bold">{counts.high || 0}</span>
                    <span>Alto</span>
                </div>
                <div className="intel-chip intel-severity-medium">
                    <span className="font-bold">{counts.medium || 0}</span>
                    <span>Médio</span>
                </div>
                <div className="intel-chip intel-severity-low">
                    <span className="font-bold">{counts.low || 0}</span>
                    <span>Baixo</span>
                </div>
            </div>
        </div>
    );
}
