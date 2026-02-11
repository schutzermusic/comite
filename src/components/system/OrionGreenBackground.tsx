'use client';

import React from 'react';
import { cn } from '@/lib/utils';

interface OrionGreenBackgroundProps {
  children?: React.ReactNode;
  className?: string;
  /** Intensity of effects (0-1) */
  intensity?: number;
}

/**
 * Premium Metallic Green Cinematic Background
 * Creates a deep, metallic, control-room atmosphere without visible grid patterns
 * 
 * ARCHITECTURE:
 * - Background visual layers use position: fixed (decorative, don't scroll)
 * - Content layer is relative (scrolls normally within parent)
 * - All decorative layers have pointer-events: none
 * 
 * Layer System:
 * A - Base gradient (deep green → near-black green)
 * B - Large radial glow zones (2-3 subtle zones)
 * C - Ultra-fine noise film (2-4% opacity)
 * D - Metallic sheen (diagonal highlight, very subtle)
 */
export function OrionGreenBackground({
  children,
  className,
  intensity = 1,
}: OrionGreenBackgroundProps) {
  return (
    <div className={cn('relative', className)}>
      {/* ============================================
          LAYER A: Base Gradient
          Deep green → near-black green, smooth transition
          ============================================ */}
      <div 
        className="fixed inset-0 pointer-events-none"
        style={{
          background: `
            linear-gradient(180deg, 
              #0a0f0d 0%, 
              #0b110f 15%,
              #0c1311 30%,
              #0d1513 45%,
              #0e1715 60%,
              #0f1917 75%,
              #0a0f0d 100%
            )
          `,
        }}
      />

      {/* ============================================
          LAYER B: Large Radial Glow Zones
          2-3 subtle radial gradients with green/cyan tint
          Very soft edges, no hard boundaries
          ============================================ */}
      
      {/* Primary glow - Top center (ambient) */}
      <div 
        className="fixed inset-0 pointer-events-none"
        style={{
          background: `
            radial-gradient(ellipse 120% 80% at 50% -10%, 
              rgba(16, 185, 129, 0.08) 0%, 
              rgba(16, 185, 129, 0.03) 40%,
              transparent 70%
            )
          `,
          opacity: intensity,
        }}
      />

      {/* Secondary glow - Bottom right (accent) */}
      <div 
        className="fixed inset-0 pointer-events-none"
        style={{
          background: `
            radial-gradient(ellipse 100% 100% at 90% 110%, 
              rgba(6, 182, 212, 0.06) 0%, 
              rgba(6, 182, 212, 0.02) 50%,
              transparent 80%
            )
          `,
          opacity: intensity,
        }}
      />

      {/* Tertiary glow - Center left (depth) */}
      <div 
        className="fixed inset-0 pointer-events-none"
        style={{
          background: `
            radial-gradient(ellipse 80% 120% at -5% 50%, 
              rgba(16, 185, 129, 0.05) 0%, 
              rgba(16, 185, 129, 0.015) 60%,
              transparent 85%
            )
          `,
          opacity: intensity,
        }}
      />

      {/* ============================================
          LAYER C: Ultra-Fine Noise Film
          Prevents flatness, adds texture
          2-4% opacity, very subtle
          ============================================ */}
      <div 
        className="fixed inset-0 pointer-events-none"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 400 400' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)' opacity='0.03'/%3E%3C/svg%3E")`,
          opacity: intensity * 0.75,
          mixBlendMode: 'overlay',
        }}
      />

      {/* Additional fine grain overlay for depth */}
      <div 
        className="fixed inset-0 pointer-events-none"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='grain'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='2'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23grain)' opacity='0.015'/%3E%3C/svg%3E")`,
          opacity: intensity,
          mixBlendMode: 'soft-light',
        }}
      />

      {/* ============================================
          LAYER D: Metallic Sheen
          Extremely subtle diagonal highlight
          Creates "brushed metal" illusion
          Must not look like a repeating pattern
          ============================================ */}
      <div 
        className="fixed inset-0 pointer-events-none"
        style={{
          background: `
            linear-gradient(
              135deg,
              transparent 0%,
              rgba(16, 185, 129, 0.02) 25%,
              transparent 50%,
              rgba(6, 182, 212, 0.015) 75%,
              transparent 100%
            )
          `,
          opacity: intensity * 0.6,
          mixBlendMode: 'overlay',
        }}
      />

      {/* Additional subtle sheen for metallic feel */}
      <div 
        className="fixed inset-0 pointer-events-none"
        style={{
          background: `
            linear-gradient(
              45deg,
              rgba(255, 255, 255, 0.008) 0%,
              transparent 30%,
              transparent 70%,
              rgba(16, 185, 129, 0.006) 100%
            )
          `,
          opacity: intensity,
          mixBlendMode: 'soft-light',
        }}
      />

      {/* ============================================
          OPTIONAL: Ultra-Subtle Grid (1-2% max)
          Only if absolutely necessary for depth
          ============================================ */}
      <div 
        className="fixed inset-0 pointer-events-none"
        style={{
          backgroundImage: `
            linear-gradient(rgba(16, 185, 129, 0.008) 1px, transparent 1px),
            linear-gradient(90deg, rgba(16, 185, 129, 0.008) 1px, transparent 1px)
          `,
          backgroundSize: '120px 120px',
          opacity: intensity * 0.5,
        }}
      />

      {/* ============================================
          Vignette Effect - Reduced top haze (~10% reduction)
          Subtle darkening at edges, less at top for header breathing room
          ============================================ */}
      <div 
        className="fixed inset-0 pointer-events-none"
        style={{
          background: `
            radial-gradient(ellipse 120% 140% at 50% 60%, 
              transparent 0%, 
              transparent 45%, 
              rgba(8, 12, 10, 0.22) 75%,
              rgba(6, 10, 8, 0.36) 100%
            )
          `,
          opacity: intensity,
        }}
      />

      {/* Content layer */}
      <div className="relative z-10">
        {children}
      </div>
    </div>
  );
}

/**
 * Minimal background variant for cards/sections
 */
export function OrionGreenCardBackground({
  children,
  className,
  glow = false,
}: {
  children?: React.ReactNode;
  className?: string;
  glow?: boolean;
}) {
  return (
    <div 
      className={cn(
        'relative overflow-hidden rounded-xl',
        'bg-gradient-to-br from-[#111a17]/90 via-[#0f1815]/80 to-[#0d1412]/90',
        'backdrop-blur-xl',
        'border border-emerald-500/10',
        glow && 'shadow-[0_0_30px_rgba(16,185,129,0.08)]',
        className
      )}
    >
      {/* Inner glow */}
      {glow && (
        <div 
          className="absolute inset-0 pointer-events-none"
          style={{
            background: `
              radial-gradient(ellipse at 50% 0%, 
                rgba(16, 185, 129, 0.08) 0%, 
                transparent 50%
              )
            `,
          }}
        />
      )}
      
      <div className="relative z-10">
        {children}
      </div>
    </div>
  );
}

export default OrionGreenBackground;


