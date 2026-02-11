'use client';

import dynamic from 'next/dynamic';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { OrionCard } from '@/components/orion';
import { HealthRing } from '@/components/charts';
import { useWebGLSupport } from '@/hooks/useWebGLSupport';
import { Skeleton } from '@/components/orion/skeleton-loader';
import { cn } from '@/lib/utils';

// Dynamic import for the 3D component (client-side only)
const GovernanceEnergyCoreDemo = dynamic(
  () => import('./GovernanceEnergyCoreDemo').then(mod => mod.GovernanceEnergyCoreDemo),
  {
    ssr: false,
    loading: () => (
      <div className="flex items-center justify-center w-[240px] h-[240px]">
        <Skeleton className="w-full h-full rounded-full" />
      </div>
    )
  }
);

interface GovernanceHealthCardProps {
  value: number;
  trend: 'improving' | 'stable' | 'declining';
  force2D?: boolean;
}

export function GovernanceHealthCard({
  value,
  trend,
  force2D = false,
}: GovernanceHealthCardProps) {
  const { isSupported, isLoading } = useWebGLSupport();
  const shouldRender3D = !force2D && isSupported && !isLoading;

  return (
    <OrionCard variant="elevated" className="relative overflow-hidden">
      {/* Subtle gradient background - Futuristic dark green/teal */}
      <div
        className="absolute inset-0"
        style={{
          background: `
            radial-gradient(ellipse at center, rgba(0, 200, 160, 0.06) 0%, transparent 60%),
            radial-gradient(ellipse at 30% 70%, rgba(0, 180, 200, 0.04) 0%, transparent 50%)
          `,
        }}
      />

      {/* Header - Ultra Minimal */}
      <div className="relative z-10 mb-4">
        <h3 className="text-[10px] font-medium text-white/40 uppercase tracking-[0.3em] text-center">
          Saúde da Governança
        </h3>
      </div>

      {/* 3D Visualization - Clean container */}
      <div className="relative z-10 flex justify-center mb-4">
        {isLoading ? (
          <div className="w-[240px] h-[240px] flex items-center justify-center">
            <Skeleton className="w-full h-full rounded-full" variant="circular" />
          </div>
        ) : shouldRender3D ? (
          <GovernanceEnergyCoreDemo value={value} label="Saúde" size="md" />
        ) : (
          <HealthRing value={value} label="Saúde" size="lg" />
        )}
      </div>

      {/* Trend indicator - Futuristic pill with glow */}
      <div className="relative z-10 flex justify-center mb-3">
        <div
          className={cn(
            'flex items-center gap-2.5 px-5 py-2.5 rounded-full',
            'border transition-all duration-300',
            trend === 'improving' && 'bg-emerald-500/5 border-emerald-500/20 text-emerald-400',
            trend === 'declining' && 'bg-red-500/5 border-red-500/20 text-red-400',
            trend === 'stable' && 'bg-white/[0.02] border-white/10 text-white/40',
          )}
          style={{
            boxShadow: trend === 'improving'
              ? '0 0 20px rgba(16, 185, 129, 0.1)'
              : trend === 'declining'
                ? '0 0 20px rgba(239, 68, 68, 0.1)'
                : 'none'
          }}
        >
          {trend === 'improving' && (
            <>
              <TrendingUp className="w-4 h-4" strokeWidth={1.5} />
              <span className="text-xs font-medium tracking-wide">Melhorando</span>
            </>
          )}
          {trend === 'declining' && (
            <>
              <TrendingDown className="w-4 h-4" strokeWidth={1.5} />
              <span className="text-xs font-medium tracking-wide">Declinando</span>
            </>
          )}
          {trend === 'stable' && (
            <>
              <Minus className="w-4 h-4" strokeWidth={1.5} />
              <span className="text-xs font-medium tracking-wide">Estável</span>
            </>
          )}
        </div>
      </div>

      {/* 3D indicator - Minimal futuristic badge */}
      {shouldRender3D && (
        <div className="relative z-10 flex justify-center">
          <div
            className="flex items-center gap-2 px-3 py-1.5 rounded-md"
            style={{
              background: 'rgba(0, 200, 160, 0.05)',
              border: '1px solid rgba(0, 200, 160, 0.15)',
            }}
          >
            <div
              className="w-1.5 h-1.5 rounded-full animate-pulse"
              style={{
                backgroundColor: 'rgba(0, 229, 200, 0.8)',
                boxShadow: '0 0 8px rgba(0, 229, 200, 0.6)'
              }}
            />
            <span
              className="text-[10px] font-semibold uppercase tracking-[0.15em]"
              style={{ color: 'rgba(0, 229, 200, 0.7)' }}
            >
              3D Ativo
            </span>
          </div>
        </div>
      )}
    </OrionCard>
  );
}
