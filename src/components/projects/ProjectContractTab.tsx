'use client';

/**
 * Aba Contrato do projeto — lê a projeção governada (migration 175).
 *
 * Valor, direito, divergência e marcos vêm das visões; não do JSONB
 * `project_v2.revenue`, que neste projeto permanece zerado de propósito
 * (não é segunda verdade contratual editável).
 */

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowUpRight, FileSignature, Loader2 } from 'lucide-react';
import { HudBadge, HudEmptyState, HudPanel } from '@/components/hud';
import {
  getProjectContractProjection,
  type ProjectContractProjection,
} from '@/lib/projects/contract/project-contract-service';
import { deriveExecutionFeedback } from '@/lib/projects/contract/execution-feedback';
import type { ProjectContractMilestone } from '@/lib/projects/contract/project-contract-types';

const fmtDate = (iso: string | null) => (iso ? iso.split('-').reverse().join('/') : '—');
const fmtMoney = (v: number | null, currency: string | null = 'BRL') =>
  v == null
    ? '—'
    : new Intl.NumberFormat('pt-BR', { style: 'currency', currency: currency || 'BRL' }).format(v);

const TRIGGER_LABEL: Record<string, string> = {
  NOT_ASSESSED: 'Não apurado',
  NOT_OCCURRED: 'Gatilho não ocorrido',
  OCCURRED: 'Gatilho ocorrido',
};

function MilestoneRow({ m }: { m: ProjectContractMilestone }) {
  const feedback = deriveExecutionFeedback(m);
  return (
    <div className="grid grid-cols-1 gap-2 border-t border-ig-border-subtle py-3 md:grid-cols-12 md:items-center">
      <div className="md:col-span-5">
        <p className="text-sm font-medium text-ig-fg-strong">{m.title}</p>
        <p className="text-[11px] text-ig-fg-muted">
          {m.entitlementSourcePage != null ? `Contrato p.${m.entitlementSourcePage}` : 'Sem página'}
          {m.requiredDocumentType ? ` · ${m.requiredDocumentType}` : ''}
        </p>
      </div>
      <div className="md:col-span-2">
        <p className="text-[10px] uppercase tracking-wide text-ig-fg-muted">Direito</p>
        <p className="text-sm tabular-nums text-ig-fg-strong">
          {fmtMoney(m.entitlementAmount, m.entitlementCurrency)}
        </p>
      </div>
      <div className="md:col-span-1">
        <p className="text-[10px] uppercase tracking-wide text-ig-fg-muted">%</p>
        <p className="text-sm tabular-nums text-ig-fg-strong">
          {m.entitlementSharePercent == null ? '—' : `${m.entitlementSharePercent.toFixed(1)}%`}
        </p>
      </div>
      <div className="md:col-span-2">
        <HudBadge variant={m.triggerAssessment === 'NOT_ASSESSED' ? 'neutral' : 'info'} size="sm">
          {TRIGGER_LABEL[m.triggerAssessment] ?? m.triggerAssessment}
        </HudBadge>
      </div>
      <div className="md:col-span-2">
        <HudBadge variant={feedback.dashed ? 'neutral' : 'warning'} size="sm">
          {feedback.label}
        </HudBadge>
      </div>
    </div>
  );
}

export function ProjectContractTab({ projectId }: { projectId: string }) {
  const [projection, setProjection] = useState<ProjectContractProjection | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const data = await getProjectContractProjection(projectId);
        if (active) setProjection(data);
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : 'Falha ao carregar projeção');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [projectId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-12 text-ig-fg-muted">
        <Loader2 className="h-5 w-5 animate-spin" /> Carregando contrato…
      </div>
    );
  }

  if (error) {
    return (
      <HudEmptyState
        icon="file"
        title="Não foi possível carregar o contrato"
        description={error}
      />
    );
  }

  const fin = projection?.financial ?? null;
  if (!fin) {
    return (
      <HudEmptyState
        icon="file"
        title="Nenhum contrato vinculado"
        description="Vincule um contrato a este projeto no módulo Contratos para acompanhar valor, direitos e marcos aqui."
      />
    );
  }

  const milestones = projection?.milestones ?? [];

  return (
    <div className="space-y-4">
      <HudPanel>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <FileSignature className="mt-0.5 h-5 w-5 text-ig-accent" />
            <div>
              <p className="text-sm font-semibold text-ig-fg-strong">{fin.contractTitle ?? 'Contrato'}</p>
              <p className="text-xs text-ig-fg-muted">
                Nº {fin.contractNumber}
                {fin.counterpartyName ? ` · ${fin.counterpartyName}` : ''}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {fin.contractStatus && <HudBadge variant="info" size="sm">{fin.contractStatus}</HudBadge>}
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-4 md:grid-cols-4">
          <div>
            <p className="text-ig-caption text-ig-fg-muted">Valor do contrato</p>
            <p className="text-sm font-medium text-ig-fg-strong tabular-nums">
              {fmtMoney(fin.contractValue, fin.currency)}
            </p>
          </div>
          <div>
            <p className="text-ig-caption text-ig-fg-muted">Total de direitos</p>
            <p className="text-sm font-medium text-ig-fg-strong tabular-nums">
              {fmtMoney(fin.entitlementTotal, fin.currency)}
            </p>
          </div>
          <div>
            <p className="text-ig-caption text-ig-fg-muted">Divergência</p>
            <p className="text-sm font-medium text-ig-fg-strong tabular-nums">
              {fmtMoney(fin.reconciliationDelta, fin.currency)}
            </p>
          </div>
          <div>
            <p className="text-ig-caption text-ig-fg-muted">Marcos</p>
            <p className="text-sm font-medium text-ig-fg-strong">{fin.milestoneCount}</p>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-4 md:grid-cols-4">
          <div>
            <p className="text-ig-caption text-ig-fg-muted">Início</p>
            <p className="text-sm font-medium text-ig-fg-strong">{fmtDate(fin.startDate)}</p>
          </div>
          <div>
            <p className="text-ig-caption text-ig-fg-muted">Término</p>
            <p className="text-sm font-medium text-ig-fg-strong">{fmtDate(fin.endDate)}</p>
          </div>
          <div>
            <p className="text-ig-caption text-ig-fg-muted">Assinatura</p>
            <p className="text-sm font-medium text-ig-fg-strong">{fmtDate(fin.signedDate)}</p>
          </div>
          <div>
            <p className="text-ig-caption text-ig-fg-muted">Eventos faturados</p>
            <p className="text-sm font-medium text-ig-fg-strong">{fin.billedEventCount}</p>
          </div>
        </div>

        <div className="mt-4">
          <Link
            href={`/contratos/${fin.contractId}`}
            className="inline-flex items-center gap-1 text-xs text-ig-accent hover:underline"
          >
            Abrir no módulo Contratos <ArrowUpRight className="h-3 w-3" />
          </Link>
        </div>
      </HudPanel>

      <HudPanel>
        <p className="mb-1 text-sm font-semibold text-ig-fg-strong">Marcos contratuais</p>
        <p className="mb-2 text-[11px] text-ig-fg-muted">
          Direito, percentual e apuração do gatilho — sem fabricar execução ou faturamento.
        </p>
        {milestones.length === 0 ? (
          <p className="py-4 text-sm text-ig-fg-muted">Nenhum marco registrado neste contrato.</p>
        ) : (
          milestones.map((m) => <MilestoneRow key={m.milestoneId} m={m} />)
        )}
      </HudPanel>
    </div>
  );
}
