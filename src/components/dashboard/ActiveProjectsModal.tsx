'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { X, MapPin, DollarSign, Clock, AlertTriangle } from 'lucide-react';
import { STATE_PROJECT_DATA, formatCompact, RISK_COLORS } from '@/data/geo/brazil-operational-data';

interface ActiveProjectsModalProps {
    isOpen: boolean;
    onClose: () => void;
}

export function ActiveProjectsModal({ isOpen, onClose }: ActiveProjectsModalProps) {
    // Calculate totals
    const totalProjects = STATE_PROJECT_DATA.reduce((sum, s) => sum + s.contractsCount, 0);
    const totalValue = STATE_PROJECT_DATA.reduce((sum, s) => sum + s.totalContracted, 0);
    const criticalStates = STATE_PROJECT_DATA.filter(s => s.riskLevel === 'critical').length;

    return (
        <AnimatePresence>
            {isOpen && (
                <>
                    {/* Backdrop */}
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        onClick={onClose}
                        className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100]"
                    />

                    {/* Modal */}
                    <motion.div
                        initial={{ opacity: 0, scale: 0.95, y: 20 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.95, y: 20 }}
                        transition={{ type: 'spring', damping: 25, stiffness: 300 }}
                        className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-[101]
                       w-[90vw] max-w-4xl max-h-[80vh] overflow-hidden
                       rounded-2xl border border-emerald-500/20
                       bg-gradient-to-br from-[#0a1512]/95 via-[#0d1a16]/95 to-[#0a1512]/95
                       backdrop-blur-xl shadow-[0_0_80px_rgba(16,185,129,0.15)]"
                    >
                        {/* Header */}
                        <div className="flex items-center justify-between p-6 border-b border-emerald-500/10">
                            <div>
                                <h2 className="text-xl font-bold text-white flex items-center gap-2">
                                    <MapPin className="w-5 h-5 text-emerald-400" />
                                    Projetos Ativos no Brasil
                                </h2>
                                <p className="text-sm text-white/50 mt-1">
                                    Visão geral dos contratos por estado
                                </p>
                            </div>
                            <button
                                onClick={onClose}
                                className="p-2 rounded-lg hover:bg-white/5 transition-colors"
                            >
                                <X className="w-5 h-5 text-white/60" />
                            </button>
                        </div>

                        {/* Summary Stats */}
                        <div className="grid grid-cols-3 gap-4 p-6 border-b border-emerald-500/10">
                            <div className="flex items-center gap-3 p-4 rounded-xl bg-emerald-500/5 border border-emerald-500/10">
                                <div className="p-2 rounded-lg bg-emerald-500/10">
                                    <DollarSign className="w-5 h-5 text-emerald-400" />
                                </div>
                                <div>
                                    <p className="text-xs text-white/50 uppercase tracking-wider">Valor Total</p>
                                    <p className="text-xl font-bold text-emerald-400">{formatCompact(totalValue)}</p>
                                </div>
                            </div>

                            <div className="flex items-center gap-3 p-4 rounded-xl bg-cyan-500/5 border border-cyan-500/10">
                                <div className="p-2 rounded-lg bg-cyan-500/10">
                                    <Clock className="w-5 h-5 text-cyan-400" />
                                </div>
                                <div>
                                    <p className="text-xs text-white/50 uppercase tracking-wider">Contratos</p>
                                    <p className="text-xl font-bold text-cyan-400">{totalProjects}</p>
                                </div>
                            </div>

                            <div className="flex items-center gap-3 p-4 rounded-xl bg-amber-500/5 border border-amber-500/10">
                                <div className="p-2 rounded-lg bg-amber-500/10">
                                    <AlertTriangle className="w-5 h-5 text-amber-400" />
                                </div>
                                <div>
                                    <p className="text-xs text-white/50 uppercase tracking-wider">Atenção Crítica</p>
                                    <p className="text-xl font-bold text-amber-400">{criticalStates} estados</p>
                                </div>
                            </div>
                        </div>

                        {/* Project Grid */}
                        <div className="p-6 overflow-y-auto max-h-[45vh]">
                            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                                {STATE_PROJECT_DATA.sort((a, b) => b.totalContracted - a.totalContracted).map((state) => (
                                    <div
                                        key={state.uf}
                                        className="p-4 rounded-xl bg-white/[0.02] border border-white/5
                               hover:border-emerald-500/20 hover:bg-white/[0.04]
                               transition-all duration-200 cursor-pointer group"
                                    >
                                        <div className="flex items-center justify-between mb-2">
                                            <span className="text-sm font-semibold text-white group-hover:text-emerald-400 transition-colors">
                                                {state.state}
                                            </span>
                                            <span
                                                className="px-2 py-0.5 rounded-full text-[10px] font-medium uppercase"
                                                style={{
                                                    backgroundColor: `${RISK_COLORS[state.riskLevel]}15`,
                                                    color: RISK_COLORS[state.riskLevel],
                                                    border: `1px solid ${RISK_COLORS[state.riskLevel]}30`,
                                                }}
                                            >
                                                {state.riskLevel}
                                            </span>
                                        </div>
                                        <p
                                            className="text-lg font-bold"
                                            style={{ color: RISK_COLORS[state.riskLevel] }}
                                        >
                                            {formatCompact(state.totalContracted)}
                                        </p>
                                        <p className="text-xs text-white/40 mt-1">
                                            {state.contractsCount} contrato{state.contractsCount !== 1 ? 's' : ''}
                                        </p>
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* Footer */}
                        <div className="p-4 border-t border-emerald-500/10 bg-black/20">
                            <p className="text-xs text-white/40 text-center">
                                Clique em um estado para ver detalhes do projeto
                            </p>
                        </div>
                    </motion.div>
                </>
            )}
        </AnimatePresence>
    );
}
