'use client';

import React, { useCallback } from 'react';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';
import { GlobeSlot } from './GlobeSlot';
import type { DrawerContext, DrawerItem } from './ContextDrawer';

// Overlay data (mock)
const OVERLAYS = [
    { key: 'projetos', label: 'Projetos' },
    { key: 'riscos', label: 'Riscos' },
    { key: 'decisoes', label: 'Decisões' },
    { key: 'financeiro', label: 'Financeiro' },
    { key: 'contratos', label: 'Contratos' },
] as const;

type OverlayKey = typeof OVERLAYS[number]['key'];

// Mock data per overlay / UF
const MOCK_OVERLAY_DATA: Record<OverlayKey, DrawerItem[]> = {
    projetos: [
        { id: 'p1', title: 'CESP — Implantação SAP', subtitle: 'SP • Em andamento', severity: 'medium', href: '/projetos', module: 'projetos' },
        { id: 'p2', title: 'Energisa — Modernização Grid', subtitle: 'MT • Em andamento', severity: 'low', href: '/projetos', module: 'projetos' },
        { id: 'p3', title: 'CHESF — Compliance ISO', subtitle: 'PE • Atrasado', severity: 'high', href: '/projetos', module: 'projetos' },
    ],
    riscos: [
        { id: 'r1', title: 'Concentração de receita', subtitle: 'Risco financeiro • Crítico', severity: 'critical', href: '/riscos', module: 'riscos' },
        { id: 'r2', title: 'Contrato vencendo', subtitle: 'Compliance • Alto', severity: 'high', href: '/riscos', module: 'riscos' },
        { id: 'r3', title: 'SLA auditoria pendente', subtitle: 'Operacional • Médio', severity: 'medium', href: '/riscos', module: 'riscos' },
    ],
    decisoes: [
        { id: 'd1', title: 'Aprovar Orçamento Q1', subtitle: 'Votação • 72h restantes', severity: 'high', href: '/pautas', module: 'decisoes' },
        { id: 'd2', title: 'Renovação Contrato CHESF', subtitle: 'Aprovação pendente', severity: 'medium', href: '/pautas', module: 'decisoes' },
    ],
    financeiro: [
        { id: 'f1', title: 'Receita R$ 12.4M vs R$ 14M previsto', subtitle: 'Variação -11.4%', severity: 'high', href: '/relatorios', module: 'financeiro' },
        { id: 'f2', title: 'EBITDA Margem 18.2%', subtitle: 'Acima meta 15%', severity: 'low', href: '/relatorios', module: 'financeiro' },
    ],
    contratos: [
        { id: 'c1', title: 'Contrato CESP — Expiração em 30d', subtitle: 'R$ 4.2M valor', severity: 'high', href: '/contratos', module: 'contratos' },
        { id: 'c2', title: 'Contrato Energisa — Ativo', subtitle: 'R$ 8.1M valor', severity: 'low', href: '/contratos', module: 'contratos' },
    ],
};

interface ControlCanvasProps {
    activeOverlay: string | null;
    onOverlayChange: (overlay: string | null) => void;
    onOpenDrawer: (context: DrawerContext) => void;
    className?: string;
}

export function ControlCanvas({
    activeOverlay,
    onOverlayChange,
    onOpenDrawer,
    className,
}: ControlCanvasProps) {
    const handleOverlayClick = useCallback((key: string) => {
        if (activeOverlay === key) {
            onOverlayChange(null);
        } else {
            onOverlayChange(key);
        }
    }, [activeOverlay, onOverlayChange]);

    const handleCanvasClick = useCallback(() => {
        if (activeOverlay) {
            const items = MOCK_OVERLAY_DATA[activeOverlay as OverlayKey] || [];
            onOpenDrawer({
                overlay: activeOverlay,
                items,
            });
        }
    }, [activeOverlay, onOpenDrawer]);

    return (
        <div className={cn('relative overflow-hidden w-full h-full min-h-0', className)}>
            {/* Globe as background canvas — fill parent */}
            <div
                className="absolute inset-0 w-full h-full min-w-0 min-h-0"
                onClick={handleCanvasClick}
                style={{ cursor: activeOverlay ? 'pointer' : 'default' }}
            >
                <GlobeSlot minHeight={0} hideOverlays className="w-full h-full min-h-0 [&>div]:h-full [&>div]:min-h-0" />

                {/* Overlay intensity hint - show when overlay is active */}
                {activeOverlay && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        className="absolute inset-0 pointer-events-none z-20"
                    >
                        {/* Gradient overlay to hint data density */}
                        <div className="absolute inset-0 bg-gradient-to-t from-emerald-500/[0.04] via-transparent to-transparent" />

                        {/* Hotspot hint label */}
                        <div className="absolute bottom-6 left-1/2 -translate-x-1/2">
                            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-orion-bg-primary/70 backdrop-blur-md border border-orion-border-subtle">
                                <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                                <span className="text-[10px] text-orion-text-secondary font-medium">
                                    Clique no mapa para detalhar{' '}
                                    <span className="text-emerald-400 capitalize">{activeOverlay}</span>
                                </span>
                            </div>
                        </div>
                    </motion.div>
                )}
            </div>

            {/* Overlay toggle chips — center-top (between left/right stacks) */}
            <div className="cr-overlay-chips">
                {OVERLAYS.map(({ key, label }) => (
                    <button
                        key={key}
                        onClick={() => handleOverlayClick(key)}
                        className={cn(
                            'hud-canvas-chip',
                            activeOverlay === key && 'hud-canvas-chip-active'
                        )}
                    >
                        <div className={cn(
                            'w-1.5 h-1.5 rounded-full transition-colors',
                            activeOverlay === key ? 'bg-emerald-400' : 'bg-orion-text-muted/40'
                        )} />
                        {label}
                    </button>
                ))}
            </div>
        </div>
    );
}
