'use client';

import { useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, TrendingUp, TrendingDown, FileText, DollarSign, Percent, BarChart3 } from 'lucide-react';
import { StateProjectData, formatBRL, formatCompact, RISK_COLORS } from '@/data/geo/brazil-operational-data';
import { cn } from '@/lib/utils';

// Custom scrollbar styles
const scrollbarStyles = `
  .hud-scrollbar::-webkit-scrollbar {
    width: 4px;
  }
  .hud-scrollbar::-webkit-scrollbar-track {
    background: transparent;
  }
  .hud-scrollbar::-webkit-scrollbar-thumb {
    background: rgba(255, 255, 255, 0.1);
    border-radius: 4px;
  }
  .hud-scrollbar::-webkit-scrollbar-thumb:hover {
    background: rgba(255, 255, 255, 0.2);
  }
`;

interface ProjectHUDPanelProps {
  data: StateProjectData | null;
  onClose: () => void;
  className?: string;
}

const riskLabels: Record<string, string> = {
  active: 'Ativo',
  at_risk: 'Em Risco',
  critical: 'Crítico',
  completed: 'Concluído',
};

export function ProjectHUDPanel({ data, onClose, className }: ProjectHUDPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  // Close on click outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(event.target as Node)) {
        onClose();
      }
    }

    if (data) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [data, onClose]);

  // Close on Escape key
  useEffect(() => {
    function handleEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onClose();
      }
    }

    if (data) {
      document.addEventListener('keydown', handleEscape);
      return () => document.removeEventListener('keydown', handleEscape);
    }
  }, [data, onClose]);

  return (
    <AnimatePresence>
      {data && (
        <>
          <style>{scrollbarStyles}</style>
          <motion.div
          ref={panelRef}
          initial={{ opacity: 0, x: 50, scale: 0.95 }}
          animate={{ opacity: 1, x: 0, scale: 1 }}
          exit={{ opacity: 0, x: 50, scale: 0.95 }}
          transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
          className={cn(
            'absolute right-4 top-4 bottom-4 w-[320px] z-50',
            'rounded-2xl overflow-hidden',
            'border backdrop-blur-xl',
            className
          )}
          style={{
            background: 'linear-gradient(135deg, rgba(10, 15, 13, 0.95) 0%, rgba(13, 20, 18, 0.92) 100%)',
            borderColor: RISK_COLORS[data.riskLevel],
            boxShadow: `
              0 0 40px ${RISK_COLORS[data.riskLevel]}30,
              0 25px 50px -12px rgba(0, 0, 0, 0.5),
              inset 0 1px 0 rgba(255, 255, 255, 0.05)
            `,
          }}
        >
          {/* Glow effect on top */}
          <div 
            className="absolute inset-x-0 top-0 h-px"
            style={{
              background: `linear-gradient(90deg, transparent, ${RISK_COLORS[data.riskLevel]}, transparent)`,
            }}
          />

          {/* Header */}
          <div className="relative px-5 pt-5 pb-4 border-b border-white/10">
            <button
              onClick={onClose}
              className="absolute right-4 top-4 p-1.5 rounded-lg bg-white/5 hover:bg-white/10 transition-colors"
            >
              <X className="w-4 h-4 text-white/60" />
            </button>

            <div className="flex items-center gap-3 mb-3">
              <div
                className="w-3 h-3 rounded-full animate-pulse"
                style={{
                  backgroundColor: RISK_COLORS[data.riskLevel],
                  boxShadow: `0 0 12px ${RISK_COLORS[data.riskLevel]}`,
                }}
              />
              <span
                className="text-xs font-medium tracking-wider uppercase"
                style={{ color: RISK_COLORS[data.riskLevel] }}
              >
                {riskLabels[data.riskLevel]}
              </span>
            </div>

            <h2 className="text-xl font-semibold text-white mb-1">
              {data.state}
            </h2>
            <p className="text-sm text-white/50">
              {data.uf} • {data.contractsCount} contrato{data.contractsCount !== 1 ? 's' : ''} ativo{data.contractsCount !== 1 ? 's' : ''}
            </p>
          </div>

          {/* Main KPIs - Scrollable */}
          <div className="hud-scrollbar px-5 py-4 space-y-4 overflow-y-auto max-h-[calc(100%-180px)]">
            {/* Total Contracted */}
            <div className="p-4 rounded-xl bg-white/[0.03] border border-white/5">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2 text-white/50">
                  <DollarSign className="w-4 h-4" />
                  <span className="text-xs uppercase tracking-wider">Valor Contratado</span>
                </div>
                <div className="flex items-center gap-1 text-emerald-400">
                  <TrendingUp className="w-3 h-3" />
                  <span className="text-xs">{data.sharePct.toFixed(1)}%</span>
                </div>
              </div>
              <div className="text-2xl font-bold text-white">
                {formatCompact(data.totalContracted)}
              </div>
              <div className="text-xs text-white/40 mt-1">
                {formatBRL(data.totalContracted)}
              </div>
            </div>

            {/* Backlog */}
            <div className="p-4 rounded-xl bg-white/[0.03] border border-white/5">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2 text-white/50">
                  <FileText className="w-4 h-4" />
                  <span className="text-xs uppercase tracking-wider">Backlog a Faturar</span>
                </div>
                {data.backlogRatio > 0.5 ? (
                  <div className="flex items-center gap-1 text-amber-400">
                    <TrendingUp className="w-3 h-3" />
                    <span className="text-xs">{(data.backlogRatio * 100).toFixed(0)}%</span>
                  </div>
                ) : (
                  <div className="flex items-center gap-1 text-cyan-400">
                    <TrendingDown className="w-3 h-3" />
                    <span className="text-xs">{(data.backlogRatio * 100).toFixed(0)}%</span>
                  </div>
                )}
              </div>
              <div className="text-2xl font-bold text-white">
                {formatCompact(data.backlogToBill)}
              </div>
              <div className="text-xs text-white/40 mt-1">
                {formatBRL(data.backlogToBill)}
              </div>
            </div>

            {/* Progress & Stats Grid */}
            <div className="grid grid-cols-2 gap-3">
              {/* Completion */}
              <div className="p-3 rounded-xl bg-white/[0.03] border border-white/5">
                <div className="flex items-center gap-2 text-white/50 mb-2">
                  <Percent className="w-3.5 h-3.5" />
                  <span className="text-[10px] uppercase tracking-wider">Conclusão</span>
                </div>
                <div className="text-lg font-bold text-white">
                  {data.avgCompletionPercent}%
                </div>
                {/* Progress bar */}
                <div className="mt-2 h-1.5 rounded-full bg-white/10 overflow-hidden">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${data.avgCompletionPercent}%` }}
                    transition={{ duration: 0.8, ease: 'easeOut' }}
                    className="h-full rounded-full"
                    style={{
                      background: `linear-gradient(90deg, ${RISK_COLORS[data.riskLevel]}, ${RISK_COLORS[data.riskLevel]}80)`,
                    }}
                  />
                </div>
              </div>

              {/* Participation Share */}
              <div className="p-3 rounded-xl bg-white/[0.03] border border-white/5">
                <div className="flex items-center gap-2 text-white/50 mb-2">
                  <BarChart3 className="w-3.5 h-3.5" />
                  <span className="text-[10px] uppercase tracking-wider">Participação</span>
                </div>
                <div className="text-lg font-bold text-white">
                  {data.sharePct.toFixed(2)}%
                </div>
                <div className="text-[10px] text-white/40 mt-1">
                  do portfólio total
                </div>
              </div>
            </div>

            {/* Contracts Count */}
            <div className="flex items-center justify-between p-3 rounded-xl bg-white/[0.03] border border-white/5">
              <div className="flex items-center gap-3">
                <div
                  className="w-10 h-10 rounded-lg flex items-center justify-center"
                  style={{
                    background: `${RISK_COLORS[data.riskLevel]}15`,
                    border: `1px solid ${RISK_COLORS[data.riskLevel]}30`,
                  }}
                >
                  <FileText className="w-5 h-5" style={{ color: RISK_COLORS[data.riskLevel] }} />
                </div>
                <div>
                  <div className="text-sm font-medium text-white">
                    {data.contractsCount} Contrato{data.contractsCount !== 1 ? 's' : ''}
                  </div>
                  <div className="text-xs text-white/40">
                    Em execução
                  </div>
                </div>
              </div>
              <div
                className="px-2.5 py-1 rounded-full text-[10px] font-medium uppercase tracking-wider"
                style={{
                  background: `${RISK_COLORS[data.riskLevel]}15`,
                  color: RISK_COLORS[data.riskLevel],
                }}
              >
                {riskLabels[data.riskLevel]}
              </div>
            </div>
            
            {/* Spacer for fixed footer */}
            <div className="h-12" />
          </div>

          {/* Footer */}
          <div className="absolute bottom-0 inset-x-0 px-5 py-3 border-t border-white/5 bg-black/20">
            <div className="flex items-center justify-between text-[10px] text-white/30">
              <span>Última atualização: Hoje</span>
              <span>Insight Energy • HUD</span>
            </div>
          </div>
        </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

export default ProjectHUDPanel;
