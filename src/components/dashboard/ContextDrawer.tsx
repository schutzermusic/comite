'use client';

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, ExternalLink, ChevronRight, AlertTriangle, CheckCircle, FileText, Briefcase, Shield } from 'lucide-react';
import Link from 'next/link';

export type DrawerContext = {
    uf?: string;
    overlay: string;
    items: DrawerItem[];
} | null;

export interface DrawerItem {
    id: string;
    title: string;
    subtitle?: string;
    severity?: 'critical' | 'high' | 'medium' | 'low';
    href: string;
    module: string;
}

interface ContextDrawerProps {
    context: DrawerContext;
    onClose: () => void;
}

const MODULE_ICONS: Record<string, React.ElementType> = {
    projetos: Briefcase,
    riscos: AlertTriangle,
    decisoes: CheckCircle,
    financeiro: FileText,
    contratos: Shield,
};

const SEVERITY_DOT: Record<string, string> = {
    critical: 'hud-dot hud-dot-critical',
    high: 'hud-dot hud-dot-warning',
    medium: 'hud-dot hud-dot-info',
    low: 'hud-dot hud-dot-success',
};

export function ContextDrawer({ context, onClose }: ContextDrawerProps) {
    if (!context) return null;

    const Icon = MODULE_ICONS[context.overlay] || Briefcase;

    return (
        <AnimatePresence>
            {context && (
                <>
                    {/* Overlay */}
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.2 }}
                        className="hud-drawer-overlay"
                        onClick={onClose}
                    />

                    {/* Drawer */}
                    <motion.div
                        initial={{ x: '100%' }}
                        animate={{ x: 0 }}
                        exit={{ x: '100%' }}
                        transition={{ type: 'spring', damping: 30, stiffness: 300 }}
                        className="hud-drawer"
                    >
                        {/* Header */}
                        <div className="sticky top-0 z-10 p-4 border-b border-orion-border-subtle bg-orion-bg-primary/80 backdrop-blur-xl">
                            <div className="flex items-center justify-between mb-2">
                                <div className="flex items-center gap-2">
                                    <Icon className="w-4 h-4 text-emerald-400" />
                                    <h2 className="text-sm font-semibold text-white capitalize">
                                        {context.overlay}
                                    </h2>
                                </div>
                                <button
                                    onClick={onClose}
                                    className="p-1 rounded-md hover:bg-glass-light transition-colors"
                                >
                                    <X className="w-4 h-4 text-orion-text-muted" />
                                </button>
                            </div>
                            {context.uf && (
                                <p className="text-xs text-orion-text-tertiary">
                                    Filtrado por: <span className="text-white font-medium">{context.uf}</span>
                                </p>
                            )}
                            <p className="text-[10px] text-orion-text-muted mt-1">
                                {context.items.length} {context.items.length === 1 ? 'item' : 'itens'}
                            </p>
                        </div>

                        {/* Items */}
                        <div className="p-3 space-y-1.5">
                            {context.items.map((item) => (
                                <Link
                                    key={item.id}
                                    href={item.href}
                                    className="flex items-center gap-3 p-3 rounded-lg bg-orion-bg-elevated/30 hover:bg-orion-bg-elevated/60 border border-transparent hover:border-orion-border-subtle transition-all duration-150 group"
                                >
                                    {item.severity && (
                                        <div className={SEVERITY_DOT[item.severity] || 'hud-dot hud-dot-info'} />
                                    )}
                                    <div className="flex-1 min-w-0">
                                        <p className="text-[13px] font-medium text-white truncate">{item.title}</p>
                                        {item.subtitle && (
                                            <p className="text-[11px] text-orion-text-muted truncate mt-0.5">{item.subtitle}</p>
                                        )}
                                    </div>
                                    <ChevronRight className="w-3.5 h-3.5 text-orion-text-muted opacity-0 group-hover:opacity-100 transition-opacity" />
                                </Link>
                            ))}

                            {context.items.length === 0 && (
                                <div className="text-center py-10">
                                    <p className="text-sm text-orion-text-muted">Nenhum item encontrado</p>
                                </div>
                            )}
                        </div>
                    </motion.div>
                </>
            )}
        </AnimatePresence>
    );
}
