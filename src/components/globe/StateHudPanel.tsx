'use client';

import { useMemo, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'motion/react';
import { ArrowLeft, ExternalLink, AlertTriangle, Landmark, Wallet, CircleDot } from 'lucide-react';
import type { GlobeProjectRecord, StateAggregate } from '@/data/geo/globe-kpi-data';
import { cn } from '@/lib/utils';

interface StateHudPanelProps {
  stateData: StateAggregate | null;
  onBackToBrazil: () => void;
  onProjectSelect: (project: GlobeProjectRecord, uf: string) => void;
  /** Se informado, ao clicar em um projeto navega direto para a página do projeto e fecha o painel */
  onProjectOpen?: (projectId: string, uf: string) => void;
  className?: string;
}

function formatCompactMoney(value: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    notation: 'compact',
    compactDisplay: 'short',
    maximumFractionDigits: 1,
  }).format(value);
}

function trendPath(values: number[], width: number, height: number): string {
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const range = Math.max(max - min, 1);

  return values
    .map((value, index) => {
      const x = (index / Math.max(values.length - 1, 1)) * width;
      const y = height - ((value - min) / range) * height;
      return `${index === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(' ');
}

const STATUS_BADGE = {
  healthy: 'text-emerald-300 border-emerald-400/30 bg-emerald-400/10',
  attention: 'text-amber-300 border-amber-400/30 bg-amber-400/10',
  critical: 'text-red-300 border-red-400/30 bg-red-400/10',
} as const;

const STATUS_LABEL: Record<string, string> = {
  healthy: 'Saudável',
  attention: 'Atenção',
  critical: 'Crítico',
};

export function StateHudPanel({ stateData, onBackToBrazil, onProjectSelect, onProjectOpen, className }: StateHudPanelProps) {
  useEffect(() => {
    if (!stateData) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [stateData]);

  const monthlyPlanned = useMemo(
    () => stateData?.monthlyInvoicing.map((entry) => entry.planned) || [],
    [stateData],
  );
  const monthlyActual = useMemo(
    () => stateData?.monthlyInvoicing.map((entry) => entry.actual) || [],
    [stateData],
  );

  const modalContent = (
    <AnimatePresence>
      {stateData && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
            onClick={onBackToBrazil}
            className="fixed inset-0 z-[100] bg-black/32 cursor-pointer"
            aria-hidden="true"
          />
          <div className="fixed right-3 top-[72px] bottom-3 z-[101] pointer-events-none">
            <motion.aside
              initial={{ opacity: 0, x: 24 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 28 }}
              transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
              onClick={(e) => e.stopPropagation()}
              className={cn(
                'pointer-events-auto h-full w-[min(430px,calc(100vw-1.5rem))] overflow-hidden',
                'ig-glass rounded-2xl',
                'border border-white/10',
                'shadow-[0_30px_70px_-24px_rgba(0,0,0,0.9)]',
                className,
              )}
              data-elev="4"
            >
          <span data-ig-noise="" />
          <span data-ig-specular="" />
          <div data-ig-content="" className="h-full">
          <div className="px-5 py-4 border-b border-white/10">
            <div className="flex items-center justify-between gap-3">
              <div className="space-y-1">
                <div className="text-[10px] uppercase tracking-[0.14em] text-white/55">Brasil &gt; {stateData.uf}</div>
                <h3 className="text-lg font-semibold text-white">{stateData.stateName}</h3>
              </div>
              <button
                onClick={onBackToBrazil}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-white/15 bg-white/5 text-[11px] font-medium text-white/80 hover:text-white hover:bg-white/10 transition-colors"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                Voltar ao Brasil
              </button>
            </div>

            <div className="mt-3 flex items-center gap-2">
              <span
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] uppercase tracking-[0.08em] font-semibold',
                  STATUS_BADGE[stateData.status],
                )}
              >
                <CircleDot className="w-3 h-3" />
                {STATUS_LABEL[stateData.status] ?? stateData.status}
              </span>
              <span className="text-[11px] text-white/60">Última atualização: {new Date(stateData.lastUpdate).toLocaleString('pt-BR')}</span>
            </div>
          </div>

          <div className="p-5 space-y-4 overflow-y-auto h-[calc(100%-98px)]">
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                <div className="text-[10px] uppercase tracking-[0.12em] text-white/50">Total do Contrato</div>
                <div className="text-lg font-semibold text-white mt-1">{formatCompactMoney(stateData.contractTotal)}</div>
              </div>
              <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                <div className="text-[10px] uppercase tracking-[0.12em] text-white/50">Faturado</div>
                <div className="text-lg font-semibold text-emerald-300 mt-1">{formatCompactMoney(stateData.invoiced)}</div>
              </div>
              <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                <div className="text-[10px] uppercase tracking-[0.12em] text-white/50">A Faturar</div>
                <div className="text-lg font-semibold text-cyan-300 mt-1">{formatCompactMoney(stateData.toInvoice)}</div>
              </div>
              <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                <div className="text-[10px] uppercase tracking-[0.12em] text-white/50">Riscos Abertos</div>
                <div className="text-lg font-semibold text-amber-300 mt-1 inline-flex items-center gap-1.5">
                  <AlertTriangle className="w-4 h-4" />
                  {stateData.riskCount}
                </div>
              </div>
              <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                <div className="text-[10px] uppercase tracking-[0.12em] text-white/50">Decisões Abertas</div>
                <div className="text-lg font-semibold text-indigo-200 mt-1 inline-flex items-center gap-1.5">
                  <Landmark className="w-4 h-4" />
                  {stateData.decisionCount}
                </div>
              </div>
              <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                <div className="text-[10px] uppercase tracking-[0.12em] text-white/50">Equipe (HH)</div>
                <div className="text-lg font-semibold text-cyan-100 mt-1">{stateData.headcount}</div>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3">
              <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                <div className="text-[10px] uppercase tracking-[0.1em] text-white/55 mb-2">Faturamento Mensal (planejado vs real)</div>
                <svg viewBox="0 0 220 56" className="w-full h-16">
                  <path d={trendPath(monthlyPlanned, 220, 56)} fill="none" stroke="rgba(123, 212, 255, 0.7)" strokeWidth="2" />
                  <path d={trendPath(monthlyActual, 220, 56)} fill="none" stroke="rgba(23, 230, 170, 0.9)" strokeWidth="2.2" />
                </svg>
                <div className="mt-2 flex items-center gap-4 text-[10px] text-white/55">
                  <span className="inline-flex items-center gap-1"><span className="w-2.5 h-0.5 bg-cyan-300 inline-block" />Planejado</span>
                  <span className="inline-flex items-center gap-1"><span className="w-2.5 h-0.5 bg-emerald-300 inline-block" />Real</span>
                </div>
              </div>

              <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                <div className="text-[10px] uppercase tracking-[0.1em] text-white/55 mb-2">Tendência de Riscos (7/30 dias)</div>
                <svg viewBox="0 0 220 56" className="w-full h-16">
                  <path d={trendPath(stateData.riskTrend.thirtyDays, 220, 56)} fill="none" stroke="rgba(255, 176, 77, 0.7)" strokeWidth="2" />
                  <path d={trendPath(stateData.riskTrend.sevenDays, 220, 56)} fill="none" stroke="rgba(255, 88, 96, 0.92)" strokeWidth="2.2" />
                </svg>
                <div className="mt-2 flex items-center gap-4 text-[10px] text-white/55">
                  <span className="inline-flex items-center gap-1"><span className="w-2.5 h-0.5 bg-amber-300 inline-block" />30 dias</span>
                  <span className="inline-flex items-center gap-1"><span className="w-2.5 h-0.5 bg-red-300 inline-block" />7 dias</span>
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
              <div className="text-[10px] uppercase tracking-[0.1em] text-white/55 mb-2">Projetos em andamento</div>
              <div className="space-y-2.5">
                {stateData.projects.map((project) => {
                  const revenuePct = stateData.contractTotal > 0
                    ? Math.round((project.contractTotal / stateData.contractTotal) * 100)
                    : 0;
                  const riskVariant = project.riskCount >= 4 ? 'text-red-300 border-red-400/30 bg-red-500/10' : project.riskCount >= 2 ? 'text-amber-300 border-amber-400/30 bg-amber-500/10' : 'text-emerald-300 border-emerald-400/30 bg-emerald-500/10';

                  return (
                    <button
                      key={project.id}
                      onClick={() => {
                        if (onProjectOpen) {
                          onProjectOpen(project.id, stateData.uf);
                          onBackToBrazil();
                        } else {
                          onProjectSelect(project, stateData.uf);
                        }
                      }}
                      className="w-full text-left rounded-lg border border-white/10 bg-black/20 p-2.5 hover:border-cyan-300/45 hover:bg-cyan-500/5 transition-colors"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-sm text-white font-medium truncate">{project.name}</div>
                          <div className="text-[11px] text-white/55 mt-0.5">{project.status.replace(/_/g, ' ')}</div>
                        </div>
                        <ExternalLink className="w-4 h-4 text-white/40 flex-shrink-0" />
                      </div>
                      <div className="mt-2 flex items-center justify-between gap-2">
                        <span className="inline-flex items-center gap-1 text-[11px] text-cyan-200"><Wallet className="w-3.5 h-3.5" />{revenuePct}% receita</span>
                        <span className={cn('text-[10px] px-2 py-0.5 rounded-full border uppercase tracking-[0.08em] font-semibold', riskVariant)}>
                          {project.riskCount} riscos
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>

            </div>
          </div>
          </div>
            </motion.aside>
          </div>
        </>
      )}
    </AnimatePresence>
  );

  if (typeof document === 'undefined') return null;
  return createPortal(modalContent, document.body);
}
