'use client';

import React, { useMemo } from 'react';
import { motion } from 'framer-motion';
import { Vote, CheckCircle2, XCircle, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';

// -- Types --
interface ConsensusData {
    total: number;
    approved: number;
    rejected: number;
    pending: number;
    approvalPercentage?: number;
}

interface ConsensusEngineProps {
    data?: ConsensusData;
    className?: string;
    title?: string;
}

// -- Default Mock Data --
const defaultData: ConsensusData = {
    total: 35,
    approved: 24,
    rejected: 3,
    pending: 8,
};

// -- Component --
export function ConsensusEngine({
    data = defaultData,
    className,
    title = "Status das Votações"
}: ConsensusEngineProps) {
    const { total, approved, rejected, pending } = data;
    const approvalPercentage = data.approvalPercentage ?? Math.round((approved / total) * 100);

    // Generate arc segments
    const segments = useMemo(() => {
        const totalSegments = 48;
        const arcSpan = 260;
        const startAngle = 140;
        const segmentAngle = arcSpan / totalSegments;
        const gap = 2;

        const result = [];
        const approvedSegments = Math.round((approved / total) * totalSegments);
        const rejectedSegments = Math.round((rejected / total) * totalSegments);

        for (let i = 0; i < totalSegments; i++) {
            let type: 'approved' | 'rejected' | 'pending';
            if (i < approvedSegments) {
                type = 'approved';
            } else if (i < approvedSegments + rejectedSegments) {
                type = 'rejected';
            } else {
                type = 'pending';
            }

            const angle = startAngle + i * segmentAngle;
            result.push({ id: i, type, angle, length: segmentAngle - gap });
        }

        return result;
    }, [total, approved, rejected]);

    // SVG Arc segment generator
    const createArcPath = (startAngle: number, length: number, radius: number, thickness: number) => {
        const startRad = (startAngle * Math.PI) / 180;
        const endRad = ((startAngle + length) * Math.PI) / 180;
        const cx = 200, cy = 200;

        const innerR = radius - thickness / 2;
        const outerR = radius + thickness / 2;

        const x1 = cx + innerR * Math.cos(startRad);
        const y1 = cy + innerR * Math.sin(startRad);
        const x2 = cx + outerR * Math.cos(startRad);
        const y2 = cy + outerR * Math.sin(startRad);
        const x3 = cx + outerR * Math.cos(endRad);
        const y3 = cy + outerR * Math.sin(endRad);
        const x4 = cx + innerR * Math.cos(endRad);
        const y4 = cy + innerR * Math.sin(endRad);

        return `M ${x1} ${y1} L ${x2} ${y2} A ${outerR} ${outerR} 0 0 1 ${x3} ${y3} L ${x4} ${y4} A ${innerR} ${innerR} 0 0 0 ${x1} ${y1}`;
    };

    // Get midpoint on arc for connection lines
    const getArcMidpoint = (type: 'approved' | 'rejected' | 'pending') => {
        const approvedCount = Math.round((approved / total) * 48);
        const rejectedCount = Math.round((rejected / total) * 48);
        const arcSpan = 260, startAngle = 140;
        const segmentAngle = arcSpan / 48;

        let midIndex = 0;
        if (type === 'approved') midIndex = approvedCount / 2;
        else if (type === 'rejected') midIndex = approvedCount + rejectedCount / 2;
        else midIndex = approvedCount + rejectedCount + (48 - approvedCount - rejectedCount) / 2;

        const angle = startAngle + midIndex * segmentAngle;
        const rad = (angle * Math.PI) / 180;
        return { x: 200 + 155 * Math.cos(rad), y: 200 + 155 * Math.sin(rad) };
    };

    return (
        <div className={cn(
            "relative w-full aspect-square max-w-[500px] mx-auto",
            "bg-orion-bg-secondary rounded-2xl",
            "border border-orion-border-DEFAULT",
            "shadow-orion-card overflow-hidden",
            className
        )}>
            {/* Background Grid */}
            <div className="absolute inset-0 opacity-20">
                <svg className="w-full h-full">
                    <defs>
                        <pattern id="voting-grid" width="25" height="25" patternUnits="userSpaceOnUse">
                            <path d="M 25 0 L 0 0 0 25" fill="none" stroke="rgba(16,185,129,0.15)" strokeWidth="0.4" />
                        </pattern>
                    </defs>
                    <rect width="100%" height="100%" fill="url(#voting-grid)" />
                </svg>
            </div>

            {/* Header */}
            <div className="absolute top-4 left-4 right-4 z-20 flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <div className="p-2 rounded-xl bg-emerald-500/20 border border-emerald-500/30">
                        <Vote className="w-5 h-5 text-emerald-400" />
                    </div>
                    <div>
                        <h3 className="text-base font-semibold text-white">{title}</h3>
                        <p className="text-xs text-orion-text-muted">Decisões do conselho</p>
                    </div>
                </div>
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/30">
                    <span className="relative flex h-2 w-2">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                    </span>
                    <span className="text-emerald-400 text-xs font-semibold">{approvalPercentage}%</span>
                </div>
            </div>

            {/* Main SVG Visualization - Added pb-8 for breathing room above footer */}
            <svg className="absolute inset-0 w-full h-full pt-14 pb-24" viewBox="0 0 400 420" preserveAspectRatio="xMidYMid meet">
                <defs>
                    <filter id="greenGlow" x="-50%" y="-50%" width="200%" height="200%">
                        <feGaussianBlur stdDeviation="2" result="blur" />
                        <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
                    </filter>
                    <filter id="redGlow" x="-50%" y="-50%" width="200%" height="200%">
                        <feGaussianBlur stdDeviation="2" result="blur" />
                        <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
                    </filter>
                    <filter id="amberGlow" x="-50%" y="-50%" width="200%" height="200%">
                        <feGaussianBlur stdDeviation="1.5" result="blur" />
                        <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
                    </filter>
                    <filter id="lineGlow" x="-50%" y="-50%" width="200%" height="200%">
                        <feGaussianBlur stdDeviation="1" result="blur" />
                        <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
                    </filter>
                    <radialGradient id="centerGlowVote" cx="50%" cy="50%" r="50%">
                        <stop offset="0%" stopColor="rgba(16,185,129,0.12)" />
                        <stop offset="100%" stopColor="transparent" />
                    </radialGradient>
                </defs>

                {/* Decorative outer ring */}
                <circle cx="200" cy="200" r="178" fill="none" stroke="rgba(16,185,129,0.08)" strokeWidth="1" strokeDasharray="4 4" />

                {/* Arc Segments */}
                {segments.map((segment, index) => {
                    const isPending = segment.type === 'pending';
                    const isRejected = segment.type === 'rejected';
                    const isApproved = segment.type === 'approved';

                    if (isPending) {
                        // Hollow wireframe pending segments with dashed border
                        return (
                            <motion.path
                                key={segment.id}
                                d={createArcPath(segment.angle, segment.length, 155, 18)}
                                fill="transparent"
                                stroke="rgba(255, 190, 0, 0.6)"
                                strokeWidth="2"
                                strokeDasharray="4 2"
                                initial={{ opacity: 0 }}
                                animate={{ opacity: [0.25, 0.7, 0.25] }}
                                transition={{ duration: 3, repeat: Infinity, delay: index * 0.04, ease: "easeInOut" }}
                            />
                        );
                    }
                    return (
                        <motion.path
                            key={segment.id}
                            d={createArcPath(segment.angle, segment.length, 155, 18)}
                            fill={isApproved ? '#10b981' : '#ef4444'}
                            filter={isApproved ? 'url(#greenGlow)' : 'url(#redGlow)'}
                            initial={{ opacity: 0, scale: 0.9 }}
                            animate={{
                                opacity: 1, scale: 1,
                                ...(isRejected && { x: [0, -1, 1, 0], opacity: [1, 0.6, 1] })
                            }}
                            transition={{
                                delay: index * 0.02, duration: 0.25,
                                ...(isRejected && { x: { repeat: Infinity, duration: 0.2, repeatDelay: 2.5 } })
                            }}
                        />
                    );
                })}

                {/* Inner rings */}
                <circle cx="200" cy="200" r="125" fill="none" stroke="rgba(16,185,129,0.1)" strokeWidth="1" />
                <circle cx="200" cy="200" r="95" fill="none" stroke="rgba(16,185,129,0.06)" strokeWidth="1" strokeDasharray="3 5" />

                {/* Center glow */}
                <circle cx="200" cy="200" r="75" fill="url(#centerGlowVote)" />

                {/* Center text */}
                <text x="200" y="195" textAnchor="middle" dominantBaseline="middle" fill="white" fontWeight="700" fontSize="52">
                    {total}
                </text>
                <text x="200" y="235" textAnchor="middle" fill="rgba(148,163,184,0.7)" fontSize="13">
                    Total
                </text>

                {/* Connection Lines - Orthogonal Tech Style (90° turns) */}
                {(['approved', 'rejected', 'pending'] as const).map((type, idx) => {
                    const arcPoint = getArcMidpoint(type);
                    // Card center X positions
                    const cardX = type === 'approved' ? 100 : type === 'rejected' ? 200 : 300;
                    const cardY = 355; // Bottom of stat cards
                    const strokeColor = type === 'approved' ? '#10b981' : type === 'rejected' ? '#ef4444' : 'rgba(255, 190, 0, 0.5)';

                    // Orthogonal path: Up from card → 90° turn → Horizontal/Diagonal to arc
                    const turnY = type === 'rejected' ? 290 : 310; // Height where line turns

                    // Create precise orthogonal path
                    const pathD = `M ${cardX} ${cardY} V ${turnY} L ${arcPoint.x} ${arcPoint.y}`;

                    return (
                        <motion.path
                            key={type}
                            d={pathD}
                            fill="none"
                            stroke={strokeColor}
                            strokeWidth="1.2"
                            strokeDasharray="4 2"
                            filter="url(#lineGlow)"
                            initial={{ pathLength: 0, opacity: 0 }}
                            animate={{ pathLength: 1, opacity: type === 'pending' ? 0.45 : 0.6 }}
                            transition={{ duration: 0.9, delay: 0.6 + idx * 0.12 }}
                        />
                    );
                })}
            </svg>

            {/* Stats at Bottom */}
            <div className="absolute bottom-5 left-4 right-4 z-20">
                <div className="grid grid-cols-3 gap-3">
                    {/* Approved */}
                    <motion.div
                        className="relative p-3 rounded-lg bg-orion-bg-elevated/90 border border-emerald-500/25 text-center"
                        style={{ boxShadow: '0 0 12px rgba(16,185,129,0.12)' }}
                        initial={{ opacity: 0, y: 15 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.5 }}
                    >
                        <div className="absolute -top-1 left-1/2 -translate-x-1/2 w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.7)]" />
                        <div className="flex items-center justify-center gap-2 mb-1">
                            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                            <span className="text-emerald-400 text-xl font-bold">{approved}</span>
                        </div>
                        <span className="text-xs text-orion-text-muted">Aprovadas</span>
                    </motion.div>

                    {/* Rejected */}
                    <motion.div
                        className="relative p-3 rounded-lg bg-orion-bg-elevated/90 border border-red-500/25 text-center"
                        style={{ boxShadow: '0 0 12px rgba(239,68,68,0.12)' }}
                        initial={{ opacity: 0, y: 15 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.6 }}
                    >
                        <div className="absolute -top-1 left-1/2 -translate-x-1/2 w-2 h-2 rounded-full bg-red-500 shadow-[0_0_6px_rgba(239,68,68,0.7)]" />
                        <div className="flex items-center justify-center gap-2 mb-1">
                            <XCircle className="w-4 h-4 text-red-400" />
                            <motion.span
                                className="text-red-400 text-xl font-bold"
                                animate={{ opacity: [1, 0.5, 1] }}
                                transition={{ duration: 0.4, repeat: Infinity, repeatDelay: 2.5 }}
                            >
                                {rejected}
                            </motion.span>
                        </div>
                        <span className="text-xs text-orion-text-muted">Rejeitadas</span>
                    </motion.div>

                    {/* Pending */}
                    <motion.div
                        className="relative p-3 rounded-lg bg-orion-bg-elevated/90 border border-slate-500/20 text-center"
                        initial={{ opacity: 0, y: 15 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.7 }}
                    >
                        <motion.div
                            className="absolute -top-1 left-1/2 -translate-x-1/2 w-2 h-2 rounded-full bg-slate-400"
                            animate={{ opacity: [0.35, 0.7, 0.35] }}
                            transition={{ duration: 2.5, repeat: Infinity }}
                        />
                        <div className="flex items-center justify-center gap-2 mb-1">
                            <Clock className="w-4 h-4 text-amber-400" />
                            <motion.span
                                className="text-amber-400 text-xl font-bold"
                                animate={{ opacity: [0.6, 1, 0.6] }}
                                transition={{ duration: 2.5, repeat: Infinity }}
                            >
                                {pending}
                            </motion.span>
                        </div>
                        <span className="text-xs text-orion-text-muted">Pendentes</span>
                    </motion.div>
                </div>
            </div>

            {/* Corner Brackets */}
            <div className="absolute top-2 left-2 w-4 h-4 border-l border-t border-emerald-500/25" />
            <div className="absolute top-2 right-2 w-4 h-4 border-r border-t border-emerald-500/25" />
            <div className="absolute bottom-2 left-2 w-4 h-4 border-l border-b border-emerald-500/25" />
            <div className="absolute bottom-2 right-2 w-4 h-4 border-r border-b border-emerald-500/25" />
        </div>
    );
}

export default ConsensusEngine;
