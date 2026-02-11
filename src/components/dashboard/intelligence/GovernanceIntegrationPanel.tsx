'use client';

import React from 'react';
import { Check, X, Clock } from 'lucide-react';

interface GovernanceIntegrationPanelProps {
    integrationPercent: number;
    votingStats: {
        pending: number;
        approved: number;
        rejected: number;
    };
    systemMessage?: string;
    className?: string;
}

export function GovernanceIntegrationPanel({
    integrationPercent,
    votingStats,
    systemMessage = 'Governança acima da média, com 6 decisões com risco crítico fora do padrão.',
    className = '',
}: GovernanceIntegrationPanelProps) {
    // Calculate ring circumference and offset
    const radius = 80;
    const circumference = 2 * Math.PI * radius;
    const offset = circumference - (integrationPercent / 100) * circumference;

    return (
        <div className={`intel-panel p-5 ${className}`}>
            {/* Header */}
            <div className="flex items-center justify-between mb-4">
                <h2 className="intel-text-label">INTEGRAÇÃO DA GOVERNANÇA</h2>

                {/* Voting status micro-panel */}
                <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-intel-bg-elevated border border-intel-border-subtle">
                    <span className="text-xs text-intel-text-muted mr-1">ESTADO DAS</span>
                    <span className="text-xs font-semibold text-intel-accent-teal">VOTAÇÕES</span>
                </div>
            </div>

            {/* Main content */}
            <div className="flex items-center gap-6">
                {/* Ring Gauge */}
                <div className="relative flex-shrink-0">
                    <svg
                        width="200"
                        height="200"
                        viewBox="0 0 200 200"
                        className="transform -rotate-90"
                    >
                        {/* Background ring */}
                        <circle
                            cx="100"
                            cy="100"
                            r={radius}
                            fill="none"
                            stroke="rgba(160, 200, 190, 0.08)"
                            strokeWidth="8"
                        />
                        {/* Progress ring */}
                        <circle
                            cx="100"
                            cy="100"
                            r={radius}
                            fill="none"
                            stroke="url(#tealGradient)"
                            strokeWidth="8"
                            strokeLinecap="round"
                            strokeDasharray={circumference}
                            strokeDashoffset={offset}
                            className="transition-all duration-1000 ease-out"
                            style={{
                                filter: 'drop-shadow(0 0 8px rgba(20, 184, 166, 0.3))'
                            }}
                        />
                        {/* Gradient definition */}
                        <defs>
                            <linearGradient id="tealGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                                <stop offset="0%" stopColor="#14B8A6" />
                                <stop offset="100%" stopColor="rgba(20, 184, 166, 0.5)" />
                            </linearGradient>
                        </defs>
                    </svg>

                    {/* Center content */}
                    <div className="absolute inset-0 flex flex-col items-center justify-center">
                        <span className="intel-text-metric text-4xl">{integrationPercent}%</span>
                        <span className="text-xs text-intel-text-muted mt-1 uppercase tracking-wider">Melhorando</span>
                    </div>
                </div>

                {/* Right side stats */}
                <div className="flex-1 space-y-3">
                    {/* Voting stats row */}
                    <div className="flex items-center gap-3">
                        {/* Pending */}
                        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-intel-bg-elevated">
                            <Clock className="w-4 h-4 text-intel-accent-teal" />
                            <span className="intel-text-metric text-lg">{votingStats.pending}</span>
                            <span className="text-xs text-intel-text-muted uppercase">Pendentes</span>
                        </div>

                        {/* Approved */}
                        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-intel-bg-elevated">
                            <span className="w-5 h-5 rounded-full bg-intel-accent-tealMuted flex items-center justify-center">
                                <Check className="w-3 h-3 text-intel-accent-teal" />
                            </span>
                            <span className="intel-text-metric text-lg">{votingStats.approved}</span>
                        </div>

                        {/* Rejected */}
                        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-intel-bg-elevated">
                            <span className="w-5 h-5 rounded-full bg-intel-accent-redMuted flex items-center justify-center">
                                <X className="w-3 h-3 text-intel-accent-red" />
                            </span>
                            <span className="intel-text-metric text-lg">{votingStats.rejected}</span>
                        </div>
                    </div>

                    {/* System voice message */}
                    <p className="intel-text-system text-sm leading-relaxed max-w-xs">
                        {systemMessage}
                    </p>
                </div>
            </div>
        </div>
    );
}
