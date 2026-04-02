'use client';

import React from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { AlertTriangle, Vote, FileText } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { GlassPanel } from './GlassPanel';
import type { DashboardPayload } from '@/lib/dashboard-data';

interface TopDriversOverlayProps {
    data: DashboardPayload;
    visible: boolean;
}

interface DriverItem {
    id: string;
    icon: React.ReactNode;
    title: string;
    badge: string;
    badgeColor: string;
    href: string;
}

export function TopDriversOverlay({ data, visible }: TopDriversOverlayProps) {
    const t = useTranslations('dashboard');

    const drivers: DriverItem[] = [
        {
            id: 'risk',
            icon: <AlertTriangle className="w-3.5 h-3.5 text-red-400" />,
            title: data.riskSummary.critical > 0
                ? `${data.riskSummary.critical} riscos críticos ativos`
                : 'Nenhum risco crítico',
            badge: data.riskSummary.critical > 0 ? 'CRÍTICO' : 'OK',
            badgeColor: data.riskSummary.critical > 0
                ? 'bg-red-500/15 border-red-400/25 text-red-300'
                : 'bg-emerald-500/15 border-emerald-400/25 text-emerald-300',
            href: '/riscos?severity=critico',
        },
        {
            id: 'decision',
            icon: <Vote className="w-3.5 h-3.5 text-amber-400" />,
            title: `${data.votingStatus.endingIn72h} decisões vencem em 72h`,
            badge: 'URGENTE',
            badgeColor: 'bg-amber-500/15 border-amber-400/25 text-amber-300',
            href: '/deliberacoes?due=72h',
        },
        {
            id: 'contract',
            icon: <FileText className="w-3.5 h-3.5 text-cyan-400" />,
            title: 'Contrato CESP expira em 30 dias',
            badge: 'ATENÇÃO',
            badgeColor: 'bg-amber-500/10 border-amber-400/20 text-amber-200',
            href: '/contratos',
        },
    ];

    return (
        <AnimatePresence>
            {visible && (
                <motion.div
                    className="cr-top-drivers"
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 20 }}
                    transition={{ duration: 0.35, ease: [0.32, 0.72, 0, 1] }}
                >
                    <GlassPanel className="!rounded-xl" hoverGlow={false}>
                        <div className="px-3 pt-2 pb-1.5">
                            <span className="cr-panel-title text-[11px]">
                                {t('topDrivers')}
                            </span>
                        </div>
                        <div className="mx-3 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />
                        <div className="p-2 flex gap-2">
                            {drivers.map((driver) => (
                                <Link
                                    key={driver.id}
                                    href={driver.href}
                                    className="flex-1 flex items-start gap-2 p-2 rounded-lg hover:bg-white/[0.03] transition-colors group"
                                >
                                    <div className="mt-0.5 flex-shrink-0">{driver.icon}</div>
                                    <div className="min-w-0 flex-1">
                                        <p className="text-[11px] text-white/80 leading-snug line-clamp-2 group-hover:text-white transition-colors">
                                            {driver.title}
                                        </p>
                                        <span className={`inline-block mt-1 text-[8px] font-semibold px-1.5 py-0.5 rounded-full border ${driver.badgeColor}`}>
                                            {driver.badge}
                                        </span>
                                    </div>
                                </Link>
                            ))}
                        </div>
                    </GlassPanel>
                </motion.div>
            )}
        </AnimatePresence>
    );
}
