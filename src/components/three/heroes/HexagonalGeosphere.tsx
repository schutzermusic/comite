'use client';

import { motion } from 'framer-motion';

interface HexagonalGeosphereProps {
    value: number;
    size?: 'sm' | 'md' | 'lg';
}

/**
 * Structured Hexagonal Wireframe Geosphere
 * A stable, organized "Shield" or "Core" visualization representing good governance
 * Replaces the chaotic particle sphere with a clean, technical design
 */
export function HexagonalGeosphere({ value, size = 'md' }: HexagonalGeosphereProps) {
    const sizeMap = { sm: 180, md: 240, lg: 300 };
    const dimension = sizeMap[size];
    const center = dimension / 2;

    // Hexagon vertices calculation
    const getHexagonPoints = (cx: number, cy: number, radius: number): string => {
        const points: string[] = [];
        for (let i = 0; i < 6; i++) {
            const angle = (i * 60 - 30) * Math.PI / 180;
            const x = cx + radius * Math.cos(angle);
            const y = cy + radius * Math.sin(angle);
            points.push(`${x},${y}`);
        }
        return points.join(' ');
    };

    // Ring radii for concentric hexagons
    const rings = [0.2, 0.4, 0.6, 0.8, 1.0];
    const maxRadius = dimension * 0.38;

    // Node positions for the outer ring
    const getNodePositions = (radius: number): { x: number; y: number }[] => {
        const nodes: { x: number; y: number }[] = [];
        for (let i = 0; i < 6; i++) {
            const angle = (i * 60 - 30) * Math.PI / 180;
            nodes.push({
                x: center + radius * Math.cos(angle),
                y: center + radius * Math.sin(angle),
            });
        }
        return nodes;
    };

    return (
        <div className="relative" style={{ width: dimension, height: dimension }}>
            <svg
                width={dimension}
                height={dimension}
                viewBox={`0 0 ${dimension} ${dimension}`}
                className="absolute inset-0"
            >
                <defs>
                    {/* Glow filter for nodes */}
                    <filter id="nodeGlow" x="-100%" y="-100%" width="300%" height="300%">
                        <feGaussianBlur stdDeviation="3" result="blur" />
                        <feMerge>
                            <feMergeNode in="blur" />
                            <feMergeNode in="SourceGraphic" />
                        </feMerge>
                    </filter>

                    {/* Scan line gradient */}
                    <linearGradient id="scanGradient" x1="0%" y1="0%" x2="0%" y2="100%">
                        <stop offset="0%" stopColor="rgba(0, 255, 255, 0)" />
                        <stop offset="45%" stopColor="rgba(0, 255, 255, 0)" />
                        <stop offset="50%" stopColor="rgba(0, 255, 255, 0.6)" />
                        <stop offset="55%" stopColor="rgba(0, 255, 255, 0)" />
                        <stop offset="100%" stopColor="rgba(0, 255, 255, 0)" />
                    </linearGradient>

                    {/* Center core glow */}
                    <radialGradient id="coreGlow" cx="50%" cy="50%" r="50%">
                        <stop offset="0%" stopColor="rgba(0, 255, 0, 0.3)" />
                        <stop offset="50%" stopColor="rgba(0, 255, 0, 0.1)" />
                        <stop offset="100%" stopColor="transparent" />
                    </radialGradient>
                </defs>

                {/* Background glow */}
                <circle cx={center} cy={center} r={maxRadius + 20} fill="url(#coreGlow)" />

                {/* Concentric hexagonal rings */}
                {rings.map((scale, i) => (
                    <motion.polygon
                        key={i}
                        points={getHexagonPoints(center, center, maxRadius * scale)}
                        fill="none"
                        stroke="#00FFFF"
                        strokeWidth="1"
                        opacity={0.15 + i * 0.1}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 0.15 + i * 0.1 }}
                        transition={{ delay: i * 0.1 }}
                    />
                ))}

                {/* Connection lines between rings */}
                {getNodePositions(maxRadius).map((outerNode, i) => {
                    const innerNode = getNodePositions(maxRadius * 0.4)[i];
                    return (
                        <line
                            key={`conn-${i}`}
                            x1={innerNode.x}
                            y1={innerNode.y}
                            x2={outerNode.x}
                            y2={outerNode.y}
                            stroke="#00FFFF"
                            strokeWidth="0.5"
                            opacity="0.2"
                            strokeDasharray="4 4"
                        />
                    );
                })}

                {/* Outer ring glow nodes */}
                {getNodePositions(maxRadius).map((node, i) => (
                    <g key={`node-${i}`}>
                        <circle
                            cx={node.x}
                            cy={node.y}
                            r="4"
                            fill="#00FF00"
                            filter="url(#nodeGlow)"
                        />
                        <circle
                            cx={node.x}
                            cy={node.y}
                            r="2"
                            fill="white"
                        />
                    </g>
                ))}

                {/* Middle ring nodes */}
                {getNodePositions(maxRadius * 0.6).map((node, i) => (
                    <circle
                        key={`mid-node-${i}`}
                        cx={node.x}
                        cy={node.y}
                        r="2"
                        fill="#00FFFF"
                        opacity="0.6"
                    />
                ))}

                {/* Center core */}
                <circle cx={center} cy={center} r={maxRadius * 0.15} fill="rgba(0, 10, 15, 0.9)" stroke="#00FFFF" strokeWidth="1" opacity="0.4" />
                <circle cx={center} cy={center} r={maxRadius * 0.08} fill="#00FF00" filter="url(#nodeGlow)" />

                {/* Horizontal laser scan line */}
                <motion.rect
                    x={center - maxRadius - 10}
                    width={maxRadius * 2 + 20}
                    height={2}
                    fill="url(#scanGradient)"
                    initial={{ y: center - maxRadius }}
                    animate={{ y: center + maxRadius }}
                    transition={{
                        duration: 3,
                        repeat: Infinity,
                        ease: 'linear',
                    }}
                />

                {/* Value display in center */}
                <text
                    x={center}
                    y={center + 4}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    style={{
                        fill: '#FFFFFF',
                        fontSize: dimension * 0.14,
                        fontWeight: 900,
                        fontFamily: 'system-ui, -apple-system, sans-serif',
                        filter: 'drop-shadow(0 0 6px rgba(0, 255, 255, 0.8))',
                    }}
                >
                    {value}%
                </text>
            </svg>
        </div>
    );
}
