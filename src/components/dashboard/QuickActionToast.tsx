'use client';

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';
import Link from 'next/link';

export interface ToastAction {
    id: string;
    message: string;
    detail: string;
    href: string;
    actionLabel?: string;
}

const MOCK_TOASTS: ToastAction[] = [
    {
        id: 't1',
        message: 'Nova deliberação criada',
        detail: 'Aprovação CAPEX',
        href: '/pautas',
        actionLabel: 'Abrir',
    },
    {
        id: 't2',
        message: 'Risco escalado para crítico',
        detail: 'Concentração de Receita',
        href: '/riscos',
        actionLabel: 'Ver risco',
    },
];

export function QuickActionToast() {
    const [visible, setVisible] = useState(false);
    const [currentToast, setCurrentToast] = useState<ToastAction>(MOCK_TOASTS[0]);

    useEffect(() => {
        // Show toast after 2s
        const showTimer = setTimeout(() => setVisible(true), 2000);
        // Auto-dismiss after 10s
        const hideTimer = setTimeout(() => setVisible(false), 10000);
        return () => {
            clearTimeout(showTimer);
            clearTimeout(hideTimer);
        };
    }, []);

    return (
        <AnimatePresence>
            {visible && (
                <motion.div
                    initial={{ opacity: 0, y: 40, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 20, scale: 0.95 }}
                    transition={{ duration: 0.3, ease: 'easeOut' }}
                    className="cr-toast"
                >
                    <div className="flex items-center gap-3">
                        {/* Pulsing dot */}
                        <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse flex-shrink-0" />

                        <div className="flex-1 min-w-0">
                            <p className="text-[11px] text-white font-medium truncate">
                                {currentToast.message}
                            </p>
                            <p className="text-[9px] text-orion-text-muted truncate mt-0.5">
                                {currentToast.detail}
                            </p>
                        </div>

                        <Link
                            href={currentToast.href}
                            className="text-[10px] font-semibold text-emerald-400 hover:text-emerald-300 px-2.5 py-1 rounded-md bg-emerald-500/[0.08] hover:bg-emerald-500/[0.15] transition-colors flex-shrink-0"
                        >
                            {currentToast.actionLabel || 'Abrir'}
                        </Link>

                        <button
                            onClick={() => setVisible(false)}
                            className="p-1 rounded hover:bg-white/5 transition-colors flex-shrink-0"
                        >
                            <X className="w-3 h-3 text-orion-text-muted" />
                        </button>
                    </div>
                </motion.div>
            )}
        </AnimatePresence>
    );
}
