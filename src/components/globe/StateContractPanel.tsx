'use client';

import { useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useRouter } from 'next/navigation';
import {
    X,
    TrendingUp,
    TrendingDown,
    ExternalLink,
    Clock,
    Building2,
    AlertCircle,
    CheckCircle2,
    PauseCircle
} from 'lucide-react';
import {
    StateProjectData,
    Contract,
    formatBRL,
    formatCompact,
    RISK_COLORS,
    ContractStatus
} from '@/data/geo/brazil-operational-data';
import { cn } from '@/lib/utils';

interface StateContractPanelProps {
    data: StateProjectData | null;
    onClose: () => void;
    onContractClick?: (contract: Contract) => void;
    className?: string;
}

const riskLabels: Record<string, string> = {
    active: 'Ativo',
    at_risk: 'Em Risco',
    critical: 'Crítico',
    completed: 'Concluído',
};

const statusLabels: Record<ContractStatus, string> = {
    active: 'Em Execução',
    delayed: 'Atrasado',
    on_hold: 'Suspenso',
    completed: 'Concluído',
};

const statusColors: Record<ContractStatus, string> = {
    active: '#10b981',
    delayed: '#f59e0b',
    on_hold: '#6b7280',
    completed: '#06b6d4',
};

const StatusIcon = ({ status }: { status: ContractStatus }) => {
    switch (status) {
        case 'active':
            return <CheckCircle2 className="w-3.5 h-3.5" style={{ color: statusColors.active }} />;
        case 'delayed':
            return <AlertCircle className="w-3.5 h-3.5" style={{ color: statusColors.delayed }} />;
        case 'on_hold':
            return <PauseCircle className="w-3.5 h-3.5" style={{ color: statusColors.on_hold }} />;
        case 'completed':
            return <CheckCircle2 className="w-3.5 h-3.5" style={{ color: statusColors.completed }} />;
    }
};

/**
 * StateContractPanel
 * 
 * A floating glass panel that displays state summary and contract list.
 * Appears when a state is selected on the globe.
 * Clicking a contract navigates to the projetos page with filters applied.
 */
export function StateContractPanel({
    data,
    onClose,
    onContractClick,
    className
}: StateContractPanelProps) {
    const panelRef = useRef<HTMLDivElement>(null);
    const router = useRouter();

    // Close on click outside
    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            if (panelRef.current && !panelRef.current.contains(event.target as Node)) {
                onClose();
            }
        }

        if (data) {
            // Delay to prevent immediate close on state click
            const timer = setTimeout(() => {
                document.addEventListener('mousedown', handleClickOutside);
            }, 100);
            return () => {
                clearTimeout(timer);
                document.removeEventListener('mousedown', handleClickOutside);
            };
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

    const handleContractClick = (contract: Contract) => {
        if (onContractClick) {
            onContractClick(contract);
        }
        // Navigate to projetos with filters
        router.push(`/projetos?uf=${data?.uf}&contractId=${contract.id}`);
    };

    return (
        <AnimatePresence>
            {data && (
                <motion.div
                    ref={panelRef}
                    initial={{ opacity: 0, x: 40, scale: 0.95 }}
                    animate={{ opacity: 1, x: 0, scale: 1 }}
                    exit={{ opacity: 0, x: 40, scale: 0.95 }}
                    transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
                    className={cn(
                        'absolute right-6 top-6 w-[360px] max-h-[75vh]',
                        'rounded-2xl overflow-hidden',
                        'backdrop-blur-xl',
                        'border border-white/[0.08]',
                        'flex flex-col',
                        className
                    )}
                    style={{
                        background: 'linear-gradient(135deg, rgba(10, 15, 13, 0.92) 0%, rgba(13, 20, 18, 0.88) 100%)',
                        boxShadow: `
              0 0 40px rgba(6, 182, 212, 0.08),
              0 25px 50px -12px rgba(0, 0, 0, 0.4),
              inset 0 1px 0 rgba(255, 255, 255, 0.04)
            `,
                    }}
                >
                    {/* Glow line on top */}
                    <div
                        className="absolute inset-x-0 top-0 h-px"
                        style={{
                            background: `linear-gradient(90deg, transparent, ${RISK_COLORS[data.riskLevel]}60, transparent)`,
                        }}
                    />

                    {/* Header */}
                    <div className="relative px-5 pt-5 pb-4 border-b border-white/[0.06] flex-shrink-0">
                        <button
                            onClick={onClose}
                            className="absolute right-4 top-4 p-1.5 rounded-lg bg-white/5 hover:bg-white/10 transition-colors"
                        >
                            <X className="w-4 h-4 text-white/60" />
                        </button>

                        <div className="flex items-center gap-3 mb-3">
                            <div
                                className="w-2.5 h-2.5 rounded-full"
                                style={{
                                    backgroundColor: RISK_COLORS[data.riskLevel],
                                    boxShadow: `0 0 10px ${RISK_COLORS[data.riskLevel]}`,
                                }}
                            />
                            <span
                                className="text-[10px] font-medium tracking-wider uppercase"
                                style={{ color: RISK_COLORS[data.riskLevel] }}
                            >
                                {riskLabels[data.riskLevel]}
                            </span>
                        </div>

                        <h2 className="text-lg font-semibold text-white mb-0.5">
                            {data.state}
                        </h2>
                        <p className="text-xs text-white/50">
                            {data.uf} • {data.contractsCount} contrato{data.contractsCount !== 1 ? 's' : ''} ativo{data.contractsCount !== 1 ? 's' : ''}
                        </p>
                    </div>

                    {/* Summary Stats */}
                    <div className="px-5 py-4 border-b border-white/[0.04] flex-shrink-0">
                        <div className="grid grid-cols-2 gap-3">
                            {/* Total Value */}
                            <div className="p-3 rounded-xl bg-white/[0.03] border border-white/[0.04]">
                                <div className="flex items-center justify-between mb-1">
                                    <span className="text-[10px] uppercase tracking-wider text-white/40">Valor Total</span>
                                    <div className="flex items-center gap-0.5 text-emerald-400">
                                        <TrendingUp className="w-2.5 h-2.5" />
                                        <span className="text-[10px]">{data.sharePct.toFixed(1)}%</span>
                                    </div>
                                </div>
                                <div className="text-lg font-bold text-white">
                                    {formatCompact(data.totalContracted)}
                                </div>
                            </div>

                            {/* Backlog */}
                            <div className="p-3 rounded-xl bg-white/[0.03] border border-white/[0.04]">
                                <div className="flex items-center justify-between mb-1">
                                    <span className="text-[10px] uppercase tracking-wider text-white/40">Backlog</span>
                                    {data.backlogRatio > 0.5 ? (
                                        <div className="flex items-center gap-0.5 text-amber-400">
                                            <TrendingUp className="w-2.5 h-2.5" />
                                            <span className="text-[10px]">{(data.backlogRatio * 100).toFixed(0)}%</span>
                                        </div>
                                    ) : (
                                        <div className="flex items-center gap-0.5 text-cyan-400">
                                            <TrendingDown className="w-2.5 h-2.5" />
                                            <span className="text-[10px]">{(data.backlogRatio * 100).toFixed(0)}%</span>
                                        </div>
                                    )}
                                </div>
                                <div className="text-lg font-bold text-white">
                                    {formatCompact(data.backlogToBill)}
                                </div>
                            </div>
                        </div>

                        {/* Progress bar */}
                        <div className="mt-3">
                            <div className="flex items-center justify-between mb-1.5">
                                <span className="text-[10px] text-white/40">Conclusão</span>
                                <span className="text-xs font-medium text-white">{data.avgCompletionPercent}%</span>
                            </div>
                            <div className="h-1.5 rounded-full bg-white/[0.08] overflow-hidden">
                                <motion.div
                                    initial={{ width: 0 }}
                                    animate={{ width: `${data.avgCompletionPercent}%` }}
                                    transition={{ duration: 0.6, ease: 'easeOut' }}
                                    className="h-full rounded-full"
                                    style={{
                                        background: `linear-gradient(90deg, ${RISK_COLORS[data.riskLevel]}, ${RISK_COLORS[data.riskLevel]}80)`,
                                    }}
                                />
                            </div>
                        </div>
                    </div>

                    {/* Contracts List */}
                    <div className="flex-1 overflow-y-auto min-h-0">
                        <div className="px-5 py-3">
                            <h3 className="text-[10px] uppercase tracking-wider text-white/40 mb-3">
                                Contratos ({data.contracts.length})
                            </h3>

                            <div className="space-y-2">
                                {data.contracts.slice(0, 6).map((contract, index) => (
                                    <motion.button
                                        key={contract.id}
                                        initial={{ opacity: 0, y: 10 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        transition={{ delay: index * 0.05 }}
                                        onClick={() => handleContractClick(contract)}
                                        className={cn(
                                            'w-full text-left p-3 rounded-xl',
                                            'bg-white/[0.02] hover:bg-white/[0.05]',
                                            'border border-white/[0.04] hover:border-white/[0.08]',
                                            'transition-all duration-200',
                                            'group'
                                        )}
                                    >
                                        <div className="flex items-start justify-between mb-2">
                                            <div className="flex items-center gap-2">
                                                <StatusIcon status={contract.status} />
                                                <span className="text-sm font-medium text-white group-hover:text-white/90">
                                                    {contract.name}
                                                </span>
                                            </div>
                                            <ExternalLink className="w-3.5 h-3.5 text-white/20 group-hover:text-white/50 transition-colors" />
                                        </div>

                                        <div className="flex items-center gap-2 mb-2">
                                            <Building2 className="w-3 h-3 text-white/30" />
                                            <span className="text-xs text-white/50">{contract.vendor}</span>
                                        </div>

                                        <div className="flex items-center justify-between">
                                            <span className="text-sm font-semibold text-white">
                                                {formatCompact(contract.value)}
                                            </span>
                                            <div className="flex items-center gap-3">
                                                <div className="flex items-center gap-1 text-white/40">
                                                    <Clock className="w-3 h-3" />
                                                    <span className="text-[10px]">{contract.slaDate}</span>
                                                </div>
                                                <span
                                                    className="text-[10px] px-1.5 py-0.5 rounded-full"
                                                    style={{
                                                        backgroundColor: `${statusColors[contract.status]}15`,
                                                        color: statusColors[contract.status],
                                                    }}
                                                >
                                                    {statusLabels[contract.status]}
                                                </span>
                                            </div>
                                        </div>

                                        {/* Progress */}
                                        <div className="mt-2 h-1 rounded-full bg-white/[0.06] overflow-hidden">
                                            <div
                                                className="h-full rounded-full transition-all"
                                                style={{
                                                    width: `${contract.completionPercent}%`,
                                                    backgroundColor: statusColors[contract.status],
                                                }}
                                            />
                                        </div>
                                    </motion.button>
                                ))}
                            </div>
                        </div>
                    </div>

                    {/* Footer */}
                    <div className="px-5 py-3 border-t border-white/[0.04] flex-shrink-0">
                        <div className="flex items-center justify-between text-[10px] text-white/30">
                            <span>Última atualização: Hoje</span>
                            <span>Insight Energy • Globe</span>
                        </div>
                    </div>
                </motion.div>
            )}
        </AnimatePresence>
    );
}

export default StateContractPanel;
