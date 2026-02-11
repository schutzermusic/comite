'use client';

import React from 'react';
import { ThreatMonitor } from '@/components/dashboard/futuristic/ThreatMonitor';
import { ConsensusEngine } from '@/components/dashboard/futuristic/ConsensusEngine';

export default function SciFiWidgetsDemo() {
    return (
        <div className="min-h-screen bg-slate-950 p-8">
            {/* Header */}
            <div className="max-w-7xl mx-auto mb-12">
                <h1 className="text-4xl font-bold text-white mb-2">
                    Sci-Fi Dashboard Widgets
                </h1>
                <p className="text-slate-400">
                    Futuristic cyberpunk-inspired visualizations for governance monitoring
                </p>
            </div>

            {/* Widgets Grid */}
            <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-8">
                {/* Threat Monitor */}
                <div>
                    <h2 className="text-xl font-semibold text-white mb-4 flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                        Threat Monitor
                    </h2>
                    <ThreatMonitor />
                </div>

                {/* Consensus Engine */}
                <div>
                    <h2 className="text-xl font-semibold text-white mb-4 flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-emerald-500" />
                        Consensus Engine
                    </h2>
                    <ConsensusEngine />
                </div>
            </div>

            {/* Custom Data Example */}
            <div className="max-w-7xl mx-auto mt-16">
                <h2 className="text-2xl font-bold text-white mb-6">
                    Customized Examples
                </h2>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                    {/* Different Risk Data */}
                    <ThreatMonitor
                        risks={[
                            { id: '1', title: 'Vazamento de Dados', description: 'Potencial exposição de dados sensíveis', level: 'critical', angle: 60, category: 'Segurança' },
                            { id: '2', title: 'Servidor Instável', description: 'Alta latência detectada', level: 'high', angle: 150, category: 'Infraestrutura' },
                            { id: '3', title: 'Backup Pendente', description: 'Backup semanal atrasado', level: 'medium', angle: 240, category: 'TI' },
                            { id: '4', title: 'Licença Expirando', description: 'Software CAD expira em 30 dias', level: 'low', angle: 330, category: 'Software' },
                        ]}
                    />

                    {/* Different Voting Data */}
                    <ConsensusEngine
                        title="Deliberações Q4"
                        data={{
                            total: 48,
                            approved: 38,
                            rejected: 5,
                            pending: 5,
                        }}
                    />
                </div>
            </div>
        </div>
    );
}
