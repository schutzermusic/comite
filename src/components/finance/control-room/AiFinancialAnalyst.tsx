'use client';

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  BrainCircuit,
  Sparkles,
  TrendingDown,
  TrendingUp,
  ArrowRight,
  Activity,
  Zap,
  FileText,
  ChevronRight,
  Clock,
  AlertCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatCompactBRL } from './helpers';
import type { AiInsight, ExecutiveDecisionItem } from './types';

interface AiFinancialAnalystProps {
  insights: AiInsight[];
  approvalQueue: ExecutiveDecisionItem[];
  onSimulate?: () => void;
  onAnalyze?: () => void;
  onReport?: () => void;
}

const KIND_META: Record<AiInsight['kind'], { label: string; color: string; icon: React.ReactNode }> = {
  margin: { label: 'Margem', color: '#A78BFA', icon: <Activity className="h-3 w-3" /> },
  revenue: { label: 'Receita', color: '#14B8A6', icon: <TrendingUp className="h-3 w-3" /> },
  cost: { label: 'Custo', color: '#F59E0B', icon: <Zap className="h-3 w-3" /> },
  forecast: { label: 'Projeção', color: '#22D3EE', icon: <Sparkles className="h-3 w-3" /> },
  operational: { label: 'Operacional', color: '#F43F5E', icon: <AlertCircle className="h-3 w-3" /> },
};

export function AiFinancialAnalyst({ insights, approvalQueue, onSimulate, onAnalyze, onReport }: AiFinancialAnalystProps) {
  const [activeId, setActiveId] = useState<string>(insights[0]?.id ?? '');
  const active = insights.find((i) => i.id === activeId) ?? insights[0];

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.05, ease: [0.22, 1, 0.36, 1] }}
      className="ig-glass relative h-full w-full overflow-hidden"
      data-elev={3}
      data-sweep
      data-state="success"
    >
      <span data-ig-noise="" />
      <span data-ig-specular="" />
      <span data-ig-sweep="" />
      <div data-ig-content="" className="flex h-full flex-col">
        <header className="flex items-center justify-between border-b border-[color:var(--ig-border-subtle)] px-4 py-2.5">
          <div className="flex items-center gap-3">
            <span
              className="relative inline-flex h-8 w-8 items-center justify-center rounded-[10px]"
              style={{
                backgroundColor: 'color-mix(in oklab, #A78BFA 14%, transparent)',
                color: '#A78BFA',
                boxShadow: 'inset 0 0 0 1px color-mix(in oklab, #A78BFA 28%, transparent)',
              }}
            >
              <BrainCircuit className="h-4 w-4" />
              <span className="absolute -right-0.5 -top-0.5 h-2 w-2 animate-pulse rounded-full bg-[#A78BFA]" />
            </span>
            <div>
              <h3 className="text-sm font-semibold tracking-tight text-[color:var(--ig-fg-strong)]">
                Analista Financeiro IA
              </h3>
              <p className="text-[11px] text-[color:var(--ig-fg-muted)]">
                Análise executiva contínua · 5 insights priorizados
              </p>
            </div>
          </div>
          {active && (
            <ConfidenceMeter value={active.confidence} />
          )}
        </header>

        <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_180px] gap-0 overflow-hidden">
          <div className="flex min-h-0 flex-col overflow-hidden px-4 py-2.5">
            <AnimatePresence mode="wait">
              {active && (
                <motion.div
                  key={active.id}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.25 }}
                  className="flex min-h-0 flex-1 flex-col"
                >
                  <div className="flex items-center gap-2">
                    <KindChip kind={active.kind} />
                    <span className={cn('inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-semibold tabular-nums', active.impact >= 0 ? 'text-[#10B981]' : 'text-[#EF4444]')} style={{ background: active.impact >= 0 ? 'color-mix(in oklab, #10B981 12%, transparent)' : 'color-mix(in oklab, #EF4444 12%, transparent)' }}>
                      {active.impact >= 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                      {formatCompactBRL(Math.abs(active.impact))} de impacto
                    </span>
                  </div>
                  <h4 className="mt-1.5 text-sm font-semibold leading-tight tracking-tight text-[color:var(--ig-fg-strong)]">
                    {active.headline}
                  </h4>
                  <p className="mt-1.5 text-[11.5px] leading-snug text-[color:var(--ig-fg-default)]">
                    {active.detail}
                  </p>

                  <div className="mt-auto rounded-lg border border-[color:var(--ig-border-strong)] bg-[color:var(--ig-bg-raised)]/50 p-2">
                    <div className="flex items-center gap-1.5 text-[9px] font-semibold uppercase tracking-[0.18em] text-[#A78BFA]">
                      <Sparkles className="h-3 w-3" /> Ação Sugerida
                    </div>
                    <p className="mt-1 text-[11.5px] leading-snug text-[color:var(--ig-fg-strong)]">
                      {active.suggestion}
                    </p>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <div className="flex min-h-0 flex-col overflow-hidden border-l border-[color:var(--ig-border-subtle)] p-2">
            <div className="mb-1 px-2 text-[9px] font-semibold uppercase tracking-[0.18em] text-[color:var(--ig-fg-subtle)]">Insights</div>
            <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto">
              {insights.map((i) => {
                const meta = KIND_META[i.kind];
                const isActive = i.id === activeId;
                return (
                  <button
                    key={i.id}
                    type="button"
                    onClick={() => setActiveId(i.id)}
                    className={cn(
                      'group flex flex-1 items-start gap-2 rounded-md border px-2 py-1 text-left transition-all',
                      isActive
                        ? 'border-[color:var(--ig-border-focus)] bg-[color:var(--ig-bg-raised)]/80 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]'
                        : 'border-transparent hover:border-[color:var(--ig-border-strong)] hover:bg-[color:var(--ig-bg-raised)]/40',
                    )}
                  >
                    <span
                      className="mt-0.5 inline-flex h-4 w-4 flex-shrink-0 items-center justify-center rounded"
                      style={{ background: `color-mix(in oklab, ${meta.color} 14%, transparent)`, color: meta.color }}
                    >
                      {meta.icon}
                    </span>
                    <span className={cn('flex-1 text-[10.5px] leading-tight', isActive ? 'text-[color:var(--ig-fg-strong)]' : 'text-[color:var(--ig-fg-muted)]')}>
                      {i.headline}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div className="border-t border-[color:var(--ig-border-subtle)] px-4 py-1.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <ActionButton onClick={onSimulate} icon={<Sparkles className="h-3 w-3" />} variant="primary">
              Simular Impacto
            </ActionButton>
            <ActionButton onClick={onAnalyze} icon={<Activity className="h-3 w-3" />}>
              Abrir Análise
            </ActionButton>
            <ActionButton onClick={onReport} icon={<FileText className="h-3 w-3" />}>
              Gerar Relatório
            </ActionButton>
          </div>
        </div>

        <div className="border-t border-[color:var(--ig-border-subtle)] px-4 py-1.5">
          <div className="flex items-center justify-between pb-1.5">
            <h4 className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-[color:var(--ig-fg-subtle)]">
              <Clock className="h-3 w-3" />
              Fila de Aprovação
            </h4>
            <span className="text-[10px] text-[color:var(--ig-fg-muted)]">{approvalQueue.length} pendentes</span>
          </div>
          <div className="flex flex-col divide-y divide-[color:var(--ig-border-subtle)]">
            {approvalQueue.slice(0, 3).map((item) => (
              <ApprovalRow key={item.id} item={item} />
            ))}
          </div>
        </div>
      </div>
    </motion.div>
  );
}

function KindChip({ kind }: { kind: AiInsight['kind'] }) {
  const meta = KIND_META[kind];
  return (
    <span
      className="inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider"
      style={{
        color: meta.color,
        borderColor: `color-mix(in oklab, ${meta.color} 32%, transparent)`,
        backgroundColor: `color-mix(in oklab, ${meta.color} 12%, transparent)`,
      }}
    >
      {meta.icon}
      {meta.label}
    </span>
  );
}

function ConfidenceMeter({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const color = value >= 0.85 ? '#10B981' : value >= 0.7 ? '#F59E0B' : '#EF4444';
  return (
    <div className="flex flex-col items-end gap-1">
      <div className="text-[9px] font-semibold uppercase tracking-[0.18em] text-[color:var(--ig-fg-subtle)]">Confiança</div>
      <div className="flex items-center gap-2">
        <div className="relative h-1.5 w-20 overflow-hidden rounded-full bg-[color:var(--ig-bg-canvas)]/50 ring-1 ring-inset ring-[color:var(--ig-border-strong)]">
          <motion.div
            className="absolute inset-y-0 left-0 rounded-full"
            style={{ background: `linear-gradient(90deg, color-mix(in oklab, ${color} 60%, transparent), ${color})` }}
            initial={{ width: 0 }}
            animate={{ width: `${pct}%` }}
            transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
          />
        </div>
        <span className="text-[11px] font-semibold tabular-nums" style={{ color }}>
          {pct}%
        </span>
      </div>
    </div>
  );
}

function ActionButton({
  children,
  onClick,
  icon,
  variant = 'secondary',
}: {
  children: React.ReactNode;
  onClick?: () => void;
  icon?: React.ReactNode;
  variant?: 'primary' | 'secondary';
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] font-semibold transition-all hover:-translate-y-px',
        variant === 'primary'
          ? 'border border-[color:var(--ig-border-focus)] bg-[linear-gradient(180deg,rgba(167,139,250,0.20),rgba(124,58,237,0.10))] text-[#A78BFA] shadow-[0_4px_12px_-6px_rgba(167,139,250,0.5)]'
          : 'border border-[color:var(--ig-border-strong)] bg-[color:var(--ig-bg-raised)]/40 text-[color:var(--ig-fg-default)] hover:bg-[color:var(--ig-bg-raised)]/80',
      )}
    >
      {icon}
      {children}
    </button>
  );
}

function ApprovalRow({ item }: { item: ExecutiveDecisionItem }) {
  const aging = item.aging_days;
  const overSla = aging * 24 > item.sla_hours;
  const slaColor = overSla ? '#EF4444' : aging >= 3 ? '#F59E0B' : '#10B981';
  return (
    <div className="flex items-center gap-2 py-1.5">
      <div className="flex flex-col items-center gap-0.5">
        <span className="text-[12px] font-semibold tabular-nums text-[color:var(--ig-fg-strong)]">{aging}d</span>
        <span className="h-1 w-1 rounded-full" style={{ background: slaColor }} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[11.5px] font-medium text-[color:var(--ig-fg-strong)]">{item.title}</div>
        <div className="mt-0.5 flex items-center gap-2 text-[10px] text-[color:var(--ig-fg-muted)]">
          <span>{item.category}</span>
          <span>·</span>
          <span className="tabular-nums">{formatCompactBRL(item.impact)}</span>
        </div>
      </div>
      <button
        type="button"
        className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md border border-[color:var(--ig-border-strong)] text-[color:var(--ig-fg-muted)] transition-all hover:border-[color:var(--ig-border-focus)] hover:text-[color:var(--ig-accent)]"
        title="Revisar"
      >
        <ChevronRight className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
