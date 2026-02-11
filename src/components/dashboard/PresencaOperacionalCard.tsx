'use client';

import dynamic from 'next/dynamic';
import { OrionCard } from '@/components/orion';
import { RISK_COLORS } from '@/data/geo/brazil-operational-data';

// Dynamic import to avoid SSR issues with WebGL
const BrazilOperationalGlobe = dynamic(
  () => import('@/components/maps/BrazilOperationalGlobe').then((mod) => mod.BrazilOperationalGlobe),
  {
    ssr: false,
    loading: () => (
      <div className="h-[320px] flex items-center justify-center bg-gradient-to-br from-[#050d0a] to-[#07130e] rounded-2xl">
        <div className="relative w-12 h-12">
          <div className="absolute inset-0 border-2 border-emerald-500/30 rounded-full" />
          <div className="absolute inset-0 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
        </div>
      </div>
    ),
  }
);

export function PresencaOperacionalCard() {
  return (
    <OrionCard variant="default" className="space-y-4">
      <div className="flex items-start justify-between">
        <div>
          <h3 className="text-sm font-semibold text-white orion-section-title">Presença Operacional</h3>
          <p className="text-xs text-orion-text-muted mt-0.5">Clique no globo para explorar projetos por estado</p>
        </div>
      </div>
      
      <div className="h-[320px] rounded-2xl overflow-hidden">
        <BrazilOperationalGlobe />
      </div>
      
      <div className="flex items-center justify-center gap-4 pt-2 border-t border-white/5 flex-wrap">
        <span className="flex items-center gap-2 text-xs text-orion-text-muted">
          <i 
            className="inline-block w-2 h-2 rounded-full" 
            style={{ 
              backgroundColor: RISK_COLORS.active, 
              boxShadow: `0 0 10px ${RISK_COLORS.active}50` 
            }} 
          />
          Ativo
        </span>
        <span className="flex items-center gap-2 text-xs text-orion-text-muted">
          <i 
            className="inline-block w-2 h-2 rounded-full" 
            style={{ 
              backgroundColor: RISK_COLORS.at_risk, 
              boxShadow: `0 0 10px ${RISK_COLORS.at_risk}50` 
            }} 
          />
          Em Risco
        </span>
        <span className="flex items-center gap-2 text-xs text-orion-text-muted">
          <i 
            className="inline-block w-2 h-2 rounded-full" 
            style={{ 
              backgroundColor: RISK_COLORS.critical, 
              boxShadow: `0 0 10px ${RISK_COLORS.critical}50` 
            }} 
          />
          Crítico
        </span>
        <span className="flex items-center gap-2 text-xs text-orion-text-muted">
          <i 
            className="inline-block w-2 h-2 rounded-full" 
            style={{ 
              backgroundColor: RISK_COLORS.completed, 
              boxShadow: `0 0 10px ${RISK_COLORS.completed}50` 
            }} 
          />
          Concluído
        </span>
      </div>
    </OrionCard>
  );
}
