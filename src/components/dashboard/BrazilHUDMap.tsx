'use client';

import { OrionCard } from '@/components/orion';
import { BrazilProjectsMap as BrazilProjectsMapType } from '@/lib/dashboard-data';
import { useState } from 'react';
import { MapPin } from 'lucide-react';

interface BrazilHUDMapProps {
  data: BrazilProjectsMapType;
  className?: string;
  onNodeClick?: (nodeId: string) => void;
}

export function BrazilHUDMap({ data, className, onNodeClick }: BrazilHUDMapProps) {
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);

  const statusColors = {
    active: '#10b981', // emerald
    at_risk: '#f59e0b', // amber
    completed: '#6b7280', // gray
  };

  const statusGlow = {
    active: 'rgba(16, 185, 129, 0.4)',
    at_risk: 'rgba(245, 158, 11, 0.4)',
    completed: 'rgba(107, 114, 128, 0.3)',
  };

  return (
    <OrionCard variant="default" className={className}>
      <div className="space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-white orion-section-title">Presença Operacional</h3>
            <p className="text-xs text-orion-text-muted mt-0.5">Projetos por região</p>
          </div>
        </div>

        {/* Map Container */}
        <div className="relative w-full h-[280px] bg-gradient-to-br from-emerald-950/20 to-emerald-950/5 rounded-lg overflow-hidden border border-emerald-500/10">
          {/* Simplified Brazil SVG Outline */}
          <svg
            viewBox="0 0 400 500"
            className="w-full h-full"
            style={{ filter: 'drop-shadow(0 0 8px rgba(16, 185, 129, 0.2))' }}
          >
            {/* Brazil outline - more realistic simplified path */}
            <path
              d="M 100 40 L 130 50 L 160 65 L 190 85 L 220 110 L 250 135 L 280 160 L 310 185 L 340 210 L 360 235 L 375 260 L 385 285 L 390 310 L 388 335 L 380 360 L 365 385 L 345 405 L 320 420 L 290 430 L 260 435 L 230 430 L 200 420 L 170 405 L 140 385 L 115 360 L 95 330 L 80 300 L 70 270 L 65 240 L 65 210 L 70 180 L 80 150 L 95 120 L 115 95 L 140 75 L 170 60 L 200 50 L 230 45 L 260 45 L 290 50 L 320 60 L 350 75 L 375 95 L 390 120 L 395 145 L 390 170 L 380 195 L 365 220 L 345 240 L 320 255 L 290 265 L 260 270 L 230 270 L 200 265 L 170 255 L 145 240 L 125 220 L 110 195 L 100 170 L 95 145 L 95 120 L 100 95 L 110 70 L 125 50 L 145 35 L 170 25 L 200 20 L 230 20 L 260 25 L 290 35 L 320 50 L 350 70 L 375 95 L 390 125 L 395 155 L 390 185 L 380 215 L 365 240 L 345 260 L 320 275 L 290 285 L 260 290 L 230 290 L 200 285 L 170 275 L 145 260 L 125 240 L 110 215 L 100 185 L 95 155 L 95 125 L 100 95 Z"
              fill="none"
              stroke="rgba(16, 185, 129, 0.15)"
              strokeWidth="1.5"
              className="animate-pulse"
              style={{ animationDuration: '4s' }}
            />

            {/* Project Nodes */}
            {data.nodes.map((node) => {
              const isHovered = hoveredNode === node.id;
              const color = statusColors[node.status];
              const glow = statusGlow[node.status];

              return (
                <g key={node.id}>
                  {/* Glow effect */}
                  <circle
                    cx={`${node.coordinates.x}%`}
                    cy={`${node.coordinates.y}%`}
                    r={isHovered ? 12 : 8}
                    fill={glow}
                    opacity={isHovered ? 0.6 : 0.4}
                    className="transition-all duration-300"
                    style={{
                      filter: 'blur(4px)',
                      animation: 'pulse 3s ease-in-out infinite',
                    }}
                  />
                  
                  {/* Node circle */}
                  <circle
                    cx={`${node.coordinates.x}%`}
                    cy={`${node.coordinates.y}%`}
                    r={isHovered ? 6 : 4}
                    fill={color}
                    stroke="rgba(255, 255, 255, 0.3)"
                    strokeWidth="1"
                    className="cursor-pointer transition-all duration-300"
                    style={{
                      filter: `drop-shadow(0 0 ${isHovered ? 8 : 4}px ${glow})`,
                    }}
                    onMouseEnter={() => setHoveredNode(node.id)}
                    onMouseLeave={() => setHoveredNode(null)}
                    onClick={() => onNodeClick?.(node.id)}
                  />

                  {/* City label on hover */}
                  {isHovered && (
                    <g>
                      <rect
                        x={`${node.coordinates.x}%`}
                        y={`${node.coordinates.y - 8}%`}
                        width="60"
                        height="20"
                        rx="4"
                        fill="rgba(10, 15, 13, 0.95)"
                        stroke={color}
                        strokeWidth="1"
                        className="transform -translate-x-1/2"
                      />
                      <text
                        x={`${node.coordinates.x}%`}
                        y={`${node.coordinates.y - 4}%`}
                        fill={color}
                        fontSize="10"
                        fontWeight="600"
                        textAnchor="middle"
                        className="transform -translate-x-1/2"
                      >
                        {node.city}
                      </text>
                    </g>
                  )}
                </g>
              );
            })}
          </svg>
        </div>

        {/* Legend */}
        <div className="flex items-center justify-center gap-6 pt-2 border-t border-white/5">
          <div className="flex items-center gap-2">
            <div 
              className="w-2 h-2 rounded-full"
              style={{ 
                backgroundColor: statusColors.active,
                boxShadow: `0 0 6px ${statusGlow.active}`,
              }}
            />
            <span className="text-xs text-orion-text-muted">
              Ativo ({data.summary.active})
            </span>
          </div>
          <div className="flex items-center gap-2">
            <div 
              className="w-2 h-2 rounded-full"
              style={{ 
                backgroundColor: statusColors.at_risk,
                boxShadow: `0 0 6px ${statusGlow.at_risk}`,
              }}
            />
            <span className="text-xs text-orion-text-muted">
              Em Risco ({data.summary.atRisk})
            </span>
          </div>
          <div className="flex items-center gap-2">
            <div 
              className="w-2 h-2 rounded-full"
              style={{ 
                backgroundColor: statusColors.completed,
                boxShadow: `0 0 6px ${statusGlow.completed}`,
              }}
            />
            <span className="text-xs text-orion-text-muted">
              Concluído ({data.summary.completed})
            </span>
          </div>
        </div>
      </div>

      <style jsx>{`
        @keyframes pulse {
          0%, 100% {
            opacity: 0.4;
          }
          50% {
            opacity: 0.7;
          }
        }
      `}</style>
    </OrionCard>
  );
}

