'use client';

import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence, useAnimationFrame } from 'framer-motion';
import { AlertTriangle, AlertCircle, AlertOctagon, Info, ShieldCheck } from 'lucide-react';
import { cn } from '@/lib/utils';

// -- Types --
interface RiskItem {
    id: string;
    title: string;
    description: string;
    level: 'critical' | 'high' | 'medium' | 'low';
    angle: number;
    category: string;
}

interface ScannedRisk {
    risk: RiskItem;
    timestamp: number;
}

interface ThreatMonitorProps {
    risks?: RiskItem[];
    className?: string;
}

// -- Default Mock Data --
const defaultRisks: RiskItem[] = [
    { id: '1', title: 'Falha no Compliance', description: 'Política desatualizada', level: 'critical', angle: 45, category: 'Compliance' },
    { id: '2', title: 'Contrato Vencendo', description: 'Expira em 7 dias', level: 'critical', angle: 200, category: 'Contratos' },
    { id: '3', title: 'Auditoria Pendente', description: 'Atrasada 15 dias', level: 'high', angle: 100, category: 'Auditoria' },
    { id: '4', title: 'KPI Abaixo Meta', description: 'Eficiência operacional', level: 'high', angle: 260, category: 'Performance' },
    { id: '5', title: 'Patch Segurança', description: 'Disponível', level: 'medium', angle: 320, category: 'TI' },
    { id: '6', title: 'Certificação Vencida', description: '3 colaboradores', level: 'medium', angle: 150, category: 'RH' },
    { id: '7', title: 'Revisão Orçamento', description: 'Agendada', level: 'low', angle: 280, category: 'Financeiro' },
    { id: '8', title: 'Manutenção Prev.', description: 'Setor B', level: 'low', angle: 30, category: 'Operações' },
];

// -- Risk Config (matching ConsensusEngine style) --
// Removed "critical" to match 3-column symmetry with Voting Status
const riskConfig = {
    high: { 
        ring: 0.33, 
        color: '#f97316', 
        label: 'Alto', 
        borderColor: 'rgba(249, 115, 22, 0.25)',
        glowColor: 'rgba(249, 115, 22, 0.12)',
        Icon: AlertTriangle,
    },
    medium: { 
        ring: 0.66, 
        color: '#eab308', 
        label: 'Médio', 
        borderColor: 'rgba(234, 179, 8, 0.25)',
        glowColor: 'rgba(234, 179, 8, 0.12)',
        Icon: AlertCircle,
    },
    low: { 
        ring: 1.0, 
        color: '#22c55e', 
        label: 'Baixo', 
        borderColor: 'rgba(34, 197, 94, 0.25)',
        glowColor: 'rgba(34, 197, 94, 0.12)',
        Icon: ShieldCheck,
    },
};

// 3 concentric rings for 3 risk levels
const ringRadii = [0.33, 0.66, 1.0];

// Radar scale - increased to fill the space
const RADAR_RADIUS = 155; // Match ConsensusEngine arc radius
const RADAR_CENTER = 200; // Center of 400x400 viewBox

// Collision detection threshold (degrees)
const SCAN_THRESHOLD = 8;
// How long the tooltip stays visible after scan (ms)
const TOOLTIP_DURATION = 2500;
// Rotation speed (degrees per frame at 60fps)
const ROTATION_SPEED = 0.6;

export function ThreatMonitor({ risks = defaultRisks, className }: ThreatMonitorProps) {
    const [hoveredRisk, setHoveredRisk] = useState<RiskItem | null>(null);
    const [scanAngle, setScanAngle] = useState(0);
    const [scannedRisks, setScannedRisks] = useState<Map<string, ScannedRisk>>(new Map());
    const containerRef = useRef<HTMLDivElement>(null);
    const lastScanRef = useRef<Set<string>>(new Set());

    // Group risks by level for counting (3 levels only - no critical)
    // Critical risks are merged into "high" for display
    const risksByLevel = useMemo(() => ({
        high: risks.filter(r => r.level === 'high' || r.level === 'critical'),
        medium: risks.filter(r => r.level === 'medium'),
        low: risks.filter(r => r.level === 'low'),
    }), [risks]);

    // Calculate dot position in SVG coordinates (400x400 viewBox)
    // Critical risks are mapped to the "high" ring
    const getDotPosition = useCallback((risk: RiskItem) => {
        const effectiveLevel = risk.level === 'critical' ? 'high' : risk.level;
        const config = riskConfig[effectiveLevel as keyof typeof riskConfig];
        const angleRad = (risk.angle - 90) * (Math.PI / 180);
        return {
            x: RADAR_CENTER + config.ring * RADAR_RADIUS * Math.cos(angleRad),
            y: RADAR_CENTER + config.ring * RADAR_RADIUS * Math.sin(angleRad),
        };
    }, []);

    // Calculate tooltip position (percentage-based for HTML overlay)
    // Critical risks are mapped to the "high" ring
    const getTooltipPosition = useCallback((risk: RiskItem) => {
        const effectiveLevel = risk.level === 'critical' ? 'high' : risk.level;
        const config = riskConfig[effectiveLevel as keyof typeof riskConfig];
        const angleRad = (risk.angle - 90) * (Math.PI / 180);
        // Position slightly outside the dot
        const tooltipRadius = config.ring * RADAR_RADIUS + 20;
        const x = RADAR_CENTER + tooltipRadius * Math.cos(angleRad);
        const y = RADAR_CENTER + tooltipRadius * Math.sin(angleRad);
        
        // Convert to percentage of viewBox (400x400)
        const xPercent = (x / 400) * 100;
        const yPercent = (y / 400) * 100;
        
        const isRight = x > RADAR_CENTER;
        const isBottom = y > RADAR_CENTER;
        
        return {
            x: xPercent,
            y: yPercent,
            transform: `translate(${isRight ? '0%' : '-100%'}, ${isBottom ? '0%' : '-100%'})`,
            origin: `${isRight ? 'left' : 'right'} ${isBottom ? 'top' : 'bottom'}`,
            effectiveLevel,
        };
    }, []);

    // Check collision between scanner and risk dots
    const checkCollision = useCallback((currentAngle: number, riskAngle: number) => {
        const normalizedScan = ((currentAngle % 360) + 360) % 360;
        const normalizedRisk = ((riskAngle % 360) + 360) % 360;
        
        let diff = Math.abs(normalizedScan - normalizedRisk);
        if (diff > 180) diff = 360 - diff;
        
        return diff < SCAN_THRESHOLD;
    }, []);

    // Animation frame for smooth rotation and collision detection
    useAnimationFrame(() => {
        setScanAngle(prev => {
            const newAngle = (prev + ROTATION_SPEED) % 360;
            
            risks.forEach(risk => {
                const isColliding = checkCollision(newAngle, risk.angle);
                const wasColliding = lastScanRef.current.has(risk.id);
                
                if (isColliding && !wasColliding) {
                    lastScanRef.current.add(risk.id);
                    setScannedRisks(prev => {
                        const next = new Map(prev);
                        next.set(risk.id, { risk, timestamp: Date.now() });
                        return next;
                    });
                }
                
                if (!isColliding && wasColliding) {
                    lastScanRef.current.delete(risk.id);
                }
            });
            
            return newAngle;
        });
    });

    // Cleanup expired tooltips
    useEffect(() => {
        const interval = setInterval(() => {
            const now = Date.now();
            setScannedRisks(prev => {
                const next = new Map(prev);
                let changed = false;
                
                prev.forEach((scanned, id) => {
                    if (hoveredRisk?.id === id) return;
                    
                    if (now - scanned.timestamp > TOOLTIP_DURATION) {
                        next.delete(id);
                        changed = true;
                    }
                });
                
                return changed ? next : prev;
            });
        }, 100);
        
        return () => clearInterval(interval);
    }, [hoveredRisk]);

    // Get all visible tooltips (scanned + hovered)
    const visibleTooltips = useMemo(() => {
        const tooltips = new Map(scannedRisks);
        
        if (hoveredRisk && !tooltips.has(hoveredRisk.id)) {
            tooltips.set(hoveredRisk.id, { risk: hoveredRisk, timestamp: Date.now() });
        }
        
        return tooltips;
    }, [scannedRisks, hoveredRisk]);

    return (
        <div 
            ref={containerRef}
            className={cn(
                "relative w-full aspect-square max-w-[500px] mx-auto",
                "bg-orion-bg-secondary rounded-2xl",
                "border border-orion-border-DEFAULT",
                "shadow-orion-card overflow-hidden",
                className
            )}
        >
            {/* Background Grid - Match ConsensusEngine */}
            <div className="absolute inset-0 opacity-20">
                <svg className="w-full h-full">
                    <defs>
                        <pattern id="threat-grid" width="25" height="25" patternUnits="userSpaceOnUse">
                            <path d="M 25 0 L 0 0 0 25" fill="none" stroke="rgba(16,185,129,0.15)" strokeWidth="0.4" />
                        </pattern>
                    </defs>
                    <rect width="100%" height="100%" fill="url(#threat-grid)" />
                </svg>
            </div>

            {/* Header - Match ConsensusEngine Style */}
            <div className="absolute top-4 left-4 right-4 z-20 flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <div className="p-2 rounded-xl bg-cyan-500/20 border border-cyan-500/30">
                        <AlertTriangle className="w-5 h-5 text-cyan-400" />
                    </div>
                    <div>
                        <h3 className="text-base font-semibold text-white">Radar de Riscos</h3>
                        <p className="text-xs text-orion-text-muted">Monitoramento ativo</p>
                    </div>
                </div>
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-cyan-500/10 border border-cyan-500/30">
                    <span className="relative flex h-2 w-2">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-cyan-500"></span>
                    </span>
                    <span className="text-cyan-400 text-xs font-semibold">{risks.length} ativos</span>
                </div>
            </div>

            {/* SVG Radar - 400x400 viewBox matching ConsensusEngine scale */}
            <svg className="absolute inset-0 w-full h-full pt-14 pb-20" viewBox="0 0 400 400" preserveAspectRatio="xMidYMid meet">
                <defs>
                    <filter id="dotGlowMinimal" x="-100%" y="-100%" width="300%" height="300%">
                        <feGaussianBlur stdDeviation="2" result="blur" />
                        <feMerge>
                            <feMergeNode in="blur" />
                            <feMergeNode in="SourceGraphic" />
                        </feMerge>
                    </filter>
                    <filter id="beamGlow" x="-50%" y="-50%" width="200%" height="200%">
                        <feGaussianBlur stdDeviation="3" result="blur" />
                        <feMerge>
                            <feMergeNode in="blur" />
                            <feMergeNode in="SourceGraphic" />
                        </feMerge>
                    </filter>
                    <linearGradient id="scanBeamGradient" x1="0%" y1="0%" x2="0%" y2="100%">
                        <stop offset="0%" stopColor="rgba(6, 182, 212, 0)" />
                        <stop offset="100%" stopColor="rgba(6, 182, 212, 0.9)" />
                    </linearGradient>
                    <radialGradient id="centerGlowThreat" cx="50%" cy="50%" r="50%">
                        <stop offset="0%" stopColor="rgba(6, 182, 212, 0.12)" />
                        <stop offset="100%" stopColor="transparent" />
                    </radialGradient>
                </defs>

                {/* Center glow */}
                <circle cx={RADAR_CENTER} cy={RADAR_CENTER} r={RADAR_RADIUS * 0.5} fill="url(#centerGlowThreat)" />

                {/* Decorative outer ring */}
                <circle 
                    cx={RADAR_CENTER} 
                    cy={RADAR_CENTER} 
                    r={RADAR_RADIUS + 20} 
                    fill="none" 
                    stroke="rgba(6,182,212,0.08)" 
                    strokeWidth="1" 
                    strokeDasharray="4 4" 
                />

                {/* Concentric Rings */}
                {ringRadii.map((radius, index) => (
                    <circle
                        key={index}
                        cx={RADAR_CENTER}
                        cy={RADAR_CENTER}
                        r={radius * RADAR_RADIUS}
                        fill="none"
                        strokeWidth="1"
                        stroke="rgba(255,255,255,0.08)"
                    />
                ))}

                {/* Cross Lines */}
                <line 
                    x1={RADAR_CENTER} 
                    y1={RADAR_CENTER - RADAR_RADIUS - 10} 
                    x2={RADAR_CENTER} 
                    y2={RADAR_CENTER + RADAR_RADIUS + 10} 
                    stroke="rgba(255,255,255,0.05)" 
                    strokeWidth="1" 
                />
                <line 
                    x1={RADAR_CENTER - RADAR_RADIUS - 10} 
                    y1={RADAR_CENTER} 
                    x2={RADAR_CENTER + RADAR_RADIUS + 10} 
                    y2={RADAR_CENTER} 
                    stroke="rgba(255,255,255,0.05)" 
                    strokeWidth="1" 
                />

                {/* Rotating Scanner Beam */}
                <g style={{ transform: `rotate(${scanAngle}deg)`, transformOrigin: `${RADAR_CENTER}px ${RADAR_CENTER}px` }}>
                    {/* Scan cone trail */}
                    <path
                        d={`M ${RADAR_CENTER} ${RADAR_CENTER} L ${RADAR_CENTER} ${RADAR_CENTER - RADAR_RADIUS} A ${RADAR_RADIUS} ${RADAR_RADIUS} 0 0 1 ${RADAR_CENTER + RADAR_RADIUS * Math.sin(0.15)} ${RADAR_CENTER - RADAR_RADIUS * Math.cos(0.15)} Z`}
                        fill="rgba(6, 182, 212, 0.05)"
                    />
                    {/* Main beam line */}
                    <line
                        x1={RADAR_CENTER}
                        y1={RADAR_CENTER}
                        x2={RADAR_CENTER}
                        y2={RADAR_CENTER - RADAR_RADIUS}
                        stroke="url(#scanBeamGradient)"
                        strokeWidth="3"
                        filter="url(#beamGlow)"
                    />
                    {/* Beam tip glow */}
                    <circle
                        cx={RADAR_CENTER}
                        cy={RADAR_CENTER - RADAR_RADIUS + 5}
                        r="4"
                        fill="rgba(6, 182, 212, 0.9)"
                    />
                </g>

                {/* Center dot */}
                <circle cx={RADAR_CENTER} cy={RADAR_CENTER} r="8" fill="rgba(255,255,255,0.15)" />
                <circle cx={RADAR_CENTER} cy={RADAR_CENTER} r="4" fill="rgba(6, 182, 212, 0.6)" />

                {/* Risk Dots */}
                {risks.map((risk) => {
                    // Map critical to high
                    const effectiveLevel = risk.level === 'critical' ? 'high' : risk.level;
                    const config = riskConfig[effectiveLevel as keyof typeof riskConfig];
                    const pos = getDotPosition(risk);
                    const isActive = visibleTooltips.has(risk.id);
                    const isHovered = hoveredRisk?.id === risk.id;

                    return (
                        <g key={risk.id}>
                            {isActive && (
                                <motion.circle
                                    cx={pos.x}
                                    cy={pos.y}
                                    fill="none"
                                    stroke={config.color}
                                    strokeWidth="2"
                                    initial={{ r: 8, opacity: 0.8 }}
                                    animate={{ r: 20, opacity: 0 }}
                                    transition={{ duration: 0.8, repeat: Infinity }}
                                />
                            )}
                            <circle
                                cx={pos.x}
                                cy={pos.y}
                                r={isHovered ? 10 : isActive ? 9 : 8}
                                fill={config.color}
                                opacity={isActive ? 1 : 0.8}
                                filter="url(#dotGlowMinimal)"
                                onMouseEnter={() => setHoveredRisk(risk)}
                                onMouseLeave={() => setHoveredRisk(null)}
                                className="cursor-pointer transition-all duration-200"
                            />
                        </g>
                    );
                })}
            </svg>

            {/* Floating HUD Tooltips - Lightweight Glassmorphism */}
            <AnimatePresence>
                {Array.from(visibleTooltips.values()).map(({ risk }) => {
                    // Map critical to high for display
                    const effectiveLevel = risk.level === 'critical' ? 'high' : risk.level;
                    const config = riskConfig[effectiveLevel as keyof typeof riskConfig];
                    const tooltipPos = getTooltipPosition(risk);
                    
                    return (
                        <motion.div
                            key={risk.id}
                            className="absolute z-30 pointer-events-none"
                            style={{
                                left: `${tooltipPos.x}%`,
                                top: `${tooltipPos.y}%`,
                                transform: tooltipPos.transform,
                                transformOrigin: tooltipPos.origin,
                            }}
                            initial={{ opacity: 0, scale: 0.85 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.9 }}
                            transition={{ duration: 0.15, ease: 'easeOut' }}
                        >
                            <div
                                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded backdrop-blur-md"
                                style={{
                                    background: 'rgba(15, 23, 42, 0.8)',
                                    border: `1px solid ${config.color}50`,
                                    boxShadow: `0 0 16px ${config.color}20`,
                                }}
                            >
                                <div
                                    className="w-1.5 h-1.5 rounded-full"
                                    style={{ backgroundColor: config.color }}
                                />
                                <span 
                                    className="text-[11px] font-medium"
                                    style={{ color: config.color }}
                                >
                                    {config.label}
                                </span>
                                <span className="text-[11px] font-bold text-white">
                                    {risksByLevel[effectiveLevel as keyof typeof risksByLevel].length}
                                </span>
                            </div>
                        </motion.div>
                    );
                })}
            </AnimatePresence>

            {/* Stats Footer - 3 Columns matching Voting Status symmetry */}
            <div className="absolute bottom-5 left-4 right-4 z-20">
                <div className="grid grid-cols-3 gap-3">
                    {(['high', 'medium', 'low'] as const).map((level, idx) => {
                        const config = riskConfig[level];
                        const count = risksByLevel[level].length;
                        const IconComponent = config.Icon;
                        const hasActive = count > 0;
                        
                        return (
                            <motion.div
                                key={level}
                                className="relative p-3 rounded-lg bg-orion-bg-elevated/90 text-center"
                                style={{ 
                                    borderWidth: 1,
                                    borderStyle: 'solid',
                                    borderColor: config.borderColor,
                                    boxShadow: hasActive ? `0 0 12px ${config.glowColor}` : 'none',
                                }}
                                initial={{ opacity: 0, y: 15 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ delay: 0.5 + idx * 0.1 }}
                            >
                                {/* Top indicator dot */}
                                <div 
                                    className="absolute -top-1 left-1/2 -translate-x-1/2 w-2 h-2 rounded-full"
                                    style={{ 
                                        backgroundColor: config.color,
                                        boxShadow: `0 0 6px ${config.color}`,
                                        opacity: hasActive ? 1 : 0.4,
                                    }}
                                />
                                
                                {/* Icon + Number */}
                                <div className="flex items-center justify-center gap-2 mb-1">
                                    <IconComponent 
                                        className="w-4 h-4" 
                                        style={{ color: config.color }}
                                    />
                                    <span 
                                        className="text-xl font-bold"
                                        style={{ color: config.color }}
                                    >
                                        {count}
                                    </span>
                                </div>
                                
                                {/* Label */}
                                <span className="text-xs text-orion-text-muted">
                                    {config.label}
                                </span>
                            </motion.div>
                        );
                    })}
                </div>
            </div>

            {/* Corner Brackets - Match ConsensusEngine */}
            <div className="absolute top-2 left-2 w-4 h-4 border-l border-t border-cyan-500/25" />
            <div className="absolute top-2 right-2 w-4 h-4 border-r border-t border-cyan-500/25" />
            <div className="absolute bottom-2 left-2 w-4 h-4 border-l border-b border-cyan-500/25" />
            <div className="absolute bottom-2 right-2 w-4 h-4 border-r border-b border-cyan-500/25" />
        </div>
    );
}

export default ThreatMonitor;
