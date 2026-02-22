'use client';

import React, { useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';
import { GlobeCanvas } from '@/components/globe/GlobeCanvas';
import type { StateAggregate } from '@/data/geo/globe-kpi-data';
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

export type ScopeMode = 'global' | 'state';

interface ControlCanvasProps {
  mode: 'executivo' | 'operacional';
  activeOverlay: string | null;
  onOverlayChange: (overlay: string | null) => void;
  onOpenDrawer: (context: DrawerContext) => void;
  scopeMode: ScopeMode;
  onScopeModeChange: (mode: ScopeMode) => void;
  onStateContextChange: (state: StateAggregate | null) => void;
  onProjectFocusChange?: (active: boolean) => void;
  className?: string;
}

export function ControlCanvas({
  mode,
  activeOverlay,
  onOverlayChange,
  onOpenDrawer,
  scopeMode,
  onScopeModeChange,
  onStateContextChange,
  onProjectFocusChange,
  className,
}: ControlCanvasProps) {
  const router = useRouter();

  const handleOverlayClick = useCallback((key: string) => {
    if (activeOverlay === key) {
      onOverlayChange(null);
    } else {
      onOverlayChange(key);
    }
  }, [activeOverlay, onOverlayChange]);

  const handleStateSelect = useCallback((state: StateAggregate | null) => {
    onStateContextChange(state);
  }, [onStateContextChange]);

  const handleProjectOpen = useCallback((projectId: string, uf: string) => {
    router.push(`/projects?projectId=${projectId}&state=${uf}`);
  }, [router]);

  return (
    <div className={cn('relative overflow-hidden w-full h-full min-h-0', className)}>
      <div className="absolute inset-0 w-full h-full min-w-0 min-h-0">
        <GlobeCanvas
          className="w-full h-full"
          mode={mode}
          onStateSelect={handleStateSelect}
          onProjectOpen={handleProjectOpen}
          onProjectFocusChange={onProjectFocusChange}
        />

        {activeOverlay && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="absolute inset-0 pointer-events-none z-20"
          >
            <div className="absolute inset-0 bg-gradient-to-t from-emerald-500/[0.04] via-transparent to-transparent" />

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

    </div>
  );
}
