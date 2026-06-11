'use client';

/**
 * Risks tab — project-scoped list of risks from the relational risks table
 * (origin/reference_id = this project), with deep links to /riscos.
 * The executive matrix card (RiskCardV2, from project_v2) stays on Overview.
 */

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowUpRight, Loader2, ShieldAlert } from 'lucide-react';
import { HudBadge, HudEmptyState } from '@/components/hud';
import { listRisks } from '@/lib/services/risks';
import type { ExtendedRisk } from '@/components/risks/risk-types';

const SEVERITY_BADGE: Record<string, 'success' | 'warning' | 'danger'> = {
  low: 'success',
  medium: 'warning',
  high: 'danger',
  critical: 'danger',
};

export function ProjectRisksTab({ projectId }: { projectId: string }) {
  const [risks, setRisks] = useState<ExtendedRisk[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    listRisks()
      .then((all) => {
        if (!active) return;
        setRisks(
          all.filter(
            (r) => r.referenceId === projectId || r.sourceEntityId === projectId,
          ),
        );
      })
      .catch((e) => console.error('[ProjectRisksTab]', e instanceof Error ? e.message : e))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [projectId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-12 text-ig-fg-muted">
        <Loader2 className="h-5 w-5 animate-spin" /> Carregando riscos…
      </div>
    );
  }

  if (risks.length === 0) {
    return (
      <HudEmptyState
        icon="alert"
        title="Nenhum risco vinculado a este projeto"
        description="Crie riscos manualmente em /riscos ou dispare a análise de IA do projeto."
        action={{ label: 'Abrir módulo de Riscos', onClick: () => (window.location.href = '/riscos') }}
      />
    );
  }

  return (
    <div className="space-y-2">
      {risks.map((risk) => (
        <Link
          key={risk.id}
          href="/riscos"
          className="flex items-start justify-between gap-3 rounded-xl border border-ig-border p-4 transition-colors hover:bg-ig-panel-hover"
        >
          <div className="flex items-start gap-3 min-w-0">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-ig-fg-muted" />
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-ig-fg-strong">{risk.title}</p>
              <p className="truncate text-xs text-ig-fg-muted">
                {risk.category ?? '—'} · P{risk.probability} × I{risk.impact} = {risk.level}
                {risk.responsibleName ? ` · ${risk.responsibleName}` : ''}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <HudBadge variant={SEVERITY_BADGE[risk.severity] ?? 'warning'} size="sm">
              {risk.severity}
            </HudBadge>
            <HudBadge variant={risk.status === 'open' ? 'danger' : risk.status === 'mitigating' ? 'warning' : 'success'} size="sm">
              {risk.status}
            </HudBadge>
            <ArrowUpRight className="h-3.5 w-3.5 text-ig-fg-muted" />
          </div>
        </Link>
      ))}
    </div>
  );
}
