'use client';

import React from 'react';
import { ThreeCanvasShell } from '../ThreeCanvasShell';
import { RiskOrbitalRadar } from './RiskOrbitalRadar';
import { useWebGLSupport } from '@/hooks/useWebGLSupport';

interface RiskOrbitalCardProps {
  critical?: number;
  high?: number;
  medium?: number;
  low?: number;
  className?: string;
}

/**
 * Risk Orbital Card
 * Wrapper component with 3D fallback
 */
export function RiskOrbitalCard({
  critical = 0,
  high = 0,
  medium = 0,
  low = 0,
  className,
}: RiskOrbitalCardProps) {
  const { hasWebGL, isLoading } = useWebGLSupport();

  if (isLoading) {
    return (
      <div className={`flex items-center justify-center ${className}`} style={{ height: 120, width: 120 }}>
        <div className="w-8 h-8 border-2 border-orion-accent-emerald border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!hasWebGL) {
    // 2D fallback - simple radial indicator
    return (
      <div className={`flex items-center justify-center ${className}`} style={{ height: 120, width: 120 }}>
        <div className="relative w-20 h-20">
          <svg className="w-full h-full transform -rotate-90" viewBox="0 0 100 100">
            {/* Background circle */}
            <circle
              cx="50"
              cy="50"
              r="40"
              fill="none"
              stroke="rgba(30, 255, 180, 0.1)"
              strokeWidth="4"
            />
            {/* Risk indicator arc */}
            <circle
              cx="50"
              cy="50"
              r="40"
              fill="none"
              stroke={critical > 0 ? '#ef4444' : '#10b981'}
              strokeWidth="4"
              strokeDasharray={`${((critical + high) / (critical + high + medium + low || 1)) * 251.2} 251.2`}
              strokeLinecap="round"
            />
          </svg>
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="text-center">
              <p className="text-lg font-bold text-white">{critical + high + medium + low}</p>
              <p className="text-[8px] text-orion-text-muted uppercase">Riscos</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={className} style={{ height: 120, width: 120 }}>
      <ThreeCanvasShell
        camera={{ position: [0, 0, 3.5], fov: 45 }}
        className="w-full h-full"
      >
        <RiskOrbitalRadar
          critical={critical}
          high={high}
          medium={medium}
          low={low}
          size={0.8}
        />
      </ThreeCanvasShell>
    </div>
  );
}

export default RiskOrbitalCard;





















