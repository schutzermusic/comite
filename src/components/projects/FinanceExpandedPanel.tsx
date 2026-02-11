'use client';

import React from 'react';
import {
    DollarSign,
    TrendingUp,
    TrendingDown,
    ArrowUpRight,
    ArrowDownRight,
    Clock,
    BarChart3,
    Info,
} from 'lucide-react';
import { HUDCard } from '@/components/ui/hud-card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from '@/components/ui/tooltip';
import type { ProjectFinance } from '@/lib/types/project-v2';
import { formatMoney } from '@/lib/utils/project-utils';

interface FinanceExpandedPanelProps {
    finance: ProjectFinance;
}

function getConfidenceColor(confidence: ProjectFinance['confidence']): string {
    switch (confidence) {
        case 'high': return '#00FFB4';
        case 'medium': return '#FFB84D';
        case 'low': return '#FF4040';
        default: return 'rgba(255,255,255,0.50)';
    }
}

function getConfidenceLabel(confidence: ProjectFinance['confidence']): string {
    switch (confidence) {
        case 'high': return 'Alta';
        case 'medium': return 'Média';
        case 'low': return 'Baixa';
        default: return '—';
    }
}

function getMethodLabel(method: ProjectFinance['forecastMethod']): string {
    switch (method) {
        case 'ac_plus_etc': return 'AC + ETC';
        case 'manual': return 'Manual';
        default: return '—';
    }
}

export function FinanceExpandedPanel({ finance }: FinanceExpandedPanelProps) {
    const isOverBudget = finance.variancePercent > 0;
    const absVariancePercent = Math.abs(finance.variancePercent);
    const bacValue = finance.bac.amountCents / 100;
    const acValue = finance.ac.amountCents / 100;
    const eacValue = finance.eac.amountCents / 100;
    const etcValue = finance.etc.amountCents / 100;

    // Progress of AC toward BAC
    const spendProgress = bacValue > 0 ? Math.min(100, (acValue / bacValue) * 100) : 0;
    // EAC as % of BAC (can exceed 100)
    const eacRatio = bacValue > 0 ? (eacValue / bacValue) * 100 : 0;

    const updatedDate = finance.updatedAt
        ? new Date(finance.updatedAt).toLocaleDateString('pt-BR', {
            day: '2-digit',
            month: 'short',
            year: 'numeric',
        })
        : '—';

    return (
        <div className="space-y-6">
            {/* Main metrics row */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                {/* BAC */}
                <div className="p-4 rounded-xl border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.02)]">
                    <div className="flex items-center gap-2 mb-2">
                        <div className="p-1.5 rounded-md bg-[rgba(0,200,255,0.12)]">
                            <DollarSign className="w-4 h-4 text-[#00C8FF]" />
                        </div>
                        <TooltipProvider>
                            <Tooltip>
                                <TooltipTrigger>
                                    <span className="text-xs text-[rgba(255,255,255,0.50)] uppercase tracking-wide">BAC (Baseline)</span>
                                </TooltipTrigger>
                                <TooltipContent side="top" className="bg-[#0A1F18] border-[rgba(255,255,255,0.12)] text-xs text-white">
                                    Budget at Completion — orçamento original aprovado
                                </TooltipContent>
                            </Tooltip>
                        </TooltipProvider>
                    </div>
                    <p className="text-lg font-bold text-white tabular-nums">{formatMoney(finance.bac, true)}</p>
                </div>

                {/* AC */}
                <div className="p-4 rounded-xl border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.02)]">
                    <div className="flex items-center gap-2 mb-2">
                        <div className="p-1.5 rounded-md bg-[rgba(0,255,180,0.12)]">
                            <TrendingUp className="w-4 h-4 text-[#00FFB4]" />
                        </div>
                        <TooltipProvider>
                            <Tooltip>
                                <TooltipTrigger>
                                    <span className="text-xs text-[rgba(255,255,255,0.50)] uppercase tracking-wide">AC (Atual)</span>
                                </TooltipTrigger>
                                <TooltipContent side="top" className="bg-[#0A1F18] border-[rgba(255,255,255,0.12)] text-xs text-white">
                                    Actual Cost — custo incorrido até agora
                                </TooltipContent>
                            </Tooltip>
                        </TooltipProvider>
                    </div>
                    <p className="text-lg font-bold text-white tabular-nums">{formatMoney(finance.ac, true)}</p>
                    <div className="mt-2">
                        <div className="flex justify-between text-xs text-[rgba(255,255,255,0.40)] mb-1">
                            <span>Gasto</span>
                            <span className="tabular-nums">{spendProgress.toFixed(0)}%</span>
                        </div>
                        <Progress value={spendProgress} className="h-1.5" />
                    </div>
                </div>

                {/* EAC */}
                <div className="p-4 rounded-xl border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.02)]">
                    <div className="flex items-center gap-2 mb-2">
                        <div className="p-1.5 rounded-md" style={{ background: isOverBudget ? 'rgba(255,64,64,0.12)' : 'rgba(0,255,180,0.12)' }}>
                            {isOverBudget ? (
                                <TrendingDown className="w-4 h-4 text-[#FF4040]" />
                            ) : (
                                <TrendingUp className="w-4 h-4 text-[#00FFB4]" />
                            )}
                        </div>
                        <TooltipProvider>
                            <Tooltip>
                                <TooltipTrigger>
                                    <span className="text-xs text-[rgba(255,255,255,0.50)] uppercase tracking-wide">EAC (Forecast)</span>
                                </TooltipTrigger>
                                <TooltipContent side="top" className="bg-[#0A1F18] border-[rgba(255,255,255,0.12)] text-xs text-white">
                                    Estimate at Completion — previsão total ao fim
                                </TooltipContent>
                            </Tooltip>
                        </TooltipProvider>
                    </div>
                    <p className="text-lg font-bold text-white tabular-nums">{formatMoney(finance.eac, true)}</p>
                    <div className="flex items-center gap-1 mt-1">
                        <Badge
                            className="text-xs font-medium border-0"
                            style={{
                                background: isOverBudget ? 'rgba(255,64,64,0.12)' : 'rgba(0,255,180,0.12)',
                                color: isOverBudget ? '#FF4040' : '#00FFB4',
                            }}
                        >
                            {eacRatio.toFixed(0)}% do BAC
                        </Badge>
                    </div>
                </div>

                {/* ETC */}
                <div className="p-4 rounded-xl border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.02)]">
                    <div className="flex items-center gap-2 mb-2">
                        <div className="p-1.5 rounded-md bg-[rgba(255,184,77,0.12)]">
                            <BarChart3 className="w-4 h-4 text-[#FFB84D]" />
                        </div>
                        <TooltipProvider>
                            <Tooltip>
                                <TooltipTrigger>
                                    <span className="text-xs text-[rgba(255,255,255,0.50)] uppercase tracking-wide">ETC (Restante)</span>
                                </TooltipTrigger>
                                <TooltipContent side="top" className="bg-[#0A1F18] border-[rgba(255,255,255,0.12)] text-xs text-white">
                                    Estimate to Complete — custo estimado restante
                                </TooltipContent>
                            </Tooltip>
                        </TooltipProvider>
                    </div>
                    <p className="text-lg font-bold text-white tabular-nums">{formatMoney(finance.etc, true)}</p>
                </div>
            </div>

            {/* Variance + Forecast Section */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {/* Variance Widget */}
                <div className="p-5 rounded-xl border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.02)]">
                    <div className="flex items-center gap-2 mb-4">
                        <h4 className="text-sm font-semibold text-white">Variação EAC vs BAC</h4>
                        {isOverBudget && (
                            <ArrowUpRight className="w-4 h-4 text-[#FF4040]" />
                        )}
                        {!isOverBudget && finance.variancePercent < 0 && (
                            <ArrowDownRight className="w-4 h-4 text-[#00FFB4]" />
                        )}
                    </div>

                    <div className="flex items-end gap-6">
                        <div>
                            <p className="text-xs text-[rgba(255,255,255,0.40)] mb-1">Em R$</p>
                            <p
                                className="text-2xl font-bold tabular-nums"
                                style={{ color: isOverBudget ? '#FF4040' : '#00FFB4' }}
                            >
                                {isOverBudget ? '+' : ''}{formatMoney(finance.varianceAmount, true)}
                            </p>
                        </div>
                        <div>
                            <p className="text-xs text-[rgba(255,255,255,0.40)] mb-1">Em %</p>
                            <p
                                className="text-2xl font-bold tabular-nums"
                                style={{ color: isOverBudget ? '#FF4040' : '#00FFB4' }}
                            >
                                {isOverBudget ? '+' : ''}{finance.variancePercent.toFixed(1)}%
                            </p>
                        </div>
                    </div>

                    {/* Visual bar comparing BAC vs EAC */}
                    <div className="mt-4 space-y-2">
                        <div className="flex items-center gap-2">
                            <span className="text-xs text-[rgba(255,255,255,0.50)] w-10">BAC</span>
                            <div className="flex-1 h-3 rounded-full bg-[rgba(255,255,255,0.05)] overflow-hidden">
                                <div className="h-full rounded-full bg-[#00C8FF]" style={{ width: '100%' }} />
                            </div>
                        </div>
                        <div className="flex items-center gap-2">
                            <span className="text-xs text-[rgba(255,255,255,0.50)] w-10">EAC</span>
                            <div className="flex-1 h-3 rounded-full bg-[rgba(255,255,255,0.05)] overflow-hidden">
                                <div
                                    className="h-full rounded-full"
                                    style={{
                                        width: `${Math.min(100, eacRatio)}%`,
                                        background: isOverBudget
                                            ? 'linear-gradient(90deg, #FF8C42, #FF4040)'
                                            : 'linear-gradient(90deg, #00C8FF, #00FFB4)',
                                    }}
                                />
                            </div>
                        </div>
                    </div>
                </div>

                {/* Forecast Method + Confidence + Drivers */}
                <div className="p-5 rounded-xl border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.02)]">
                    <h4 className="text-sm font-semibold text-white mb-4">Previsão (Forecast)</h4>

                    <div className="space-y-4">
                        {/* Method + Confidence */}
                        <div className="flex items-center gap-4">
                            <div>
                                <p className="text-xs text-[rgba(255,255,255,0.40)] mb-1">Método</p>
                                <Badge variant="outline" className="text-xs border-[rgba(255,255,255,0.12)] text-[rgba(255,255,255,0.65)]">
                                    {getMethodLabel(finance.forecastMethod)}
                                </Badge>
                            </div>
                            <div>
                                <p className="text-xs text-[rgba(255,255,255,0.40)] mb-1">Confiança</p>
                                <Badge
                                    className="text-xs font-medium border-0"
                                    style={{
                                        background: `${getConfidenceColor(finance.confidence)}20`,
                                        color: getConfidenceColor(finance.confidence),
                                    }}
                                >
                                    ● {getConfidenceLabel(finance.confidence)}
                                </Badge>
                            </div>
                            <div>
                                <p className="text-xs text-[rgba(255,255,255,0.40)] mb-1">Atualizado</p>
                                <div className="flex items-center gap-1">
                                    <Clock className="w-3 h-3 text-[rgba(255,255,255,0.40)]" />
                                    <span className="text-xs text-[rgba(255,255,255,0.65)]">{updatedDate}</span>
                                </div>
                            </div>
                        </div>

                        {/* Drivers */}
                        {finance.drivers && finance.drivers.length > 0 && (
                            <div>
                                <p className="text-xs text-[rgba(255,255,255,0.40)] mb-2">Fatores (drivers)</p>
                                <div className="space-y-1.5">
                                    {finance.drivers.map((driver, i) => (
                                        <div key={i} className="flex items-center gap-2">
                                            <div className="w-1.5 h-1.5 rounded-full bg-[#FFB84D] flex-shrink-0" />
                                            <span className="text-xs text-[rgba(255,255,255,0.65)]">{driver}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}

export default FinanceExpandedPanel;
