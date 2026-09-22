'use client';

import { useEffect, useMemo, useState } from 'react';
import { HudBadge, HudEmptyState, HudPanel, HudSignal } from '@/components/hud';
import { cn } from '@/lib/utils';
import {
  authorizationSourceLabels, engagementStatusLabels, ENGAGEMENT_LABEL_PLURAL,
} from '@/lib/commercial/labels';
import type {
  AuthorizationSourceKind, CommercialEngagement, EngagementStatus,
} from '@/lib/commercial/types';

type EngagementRow = {
  id: string; engagement_number: string | null; title: string;
  counterparty_name: string; currency: string; authorized_value: string | null;
  status: EngagementStatus; origin: string; authorized_at: string | null; created_at: string;
};

type AuthorizationRow = {
  id: string; engagement_id: string; source_kind: AuthorizationSourceKind;
  contract_id: string | null; proposal_revision_id: string | null;
  external_reference: string | null; authorized_value: string | null;
  currency: string | null; governing: boolean;
};

const currency = (value: string | null, code: string) =>
  value === null ? '—'
    : new Intl.NumberFormat('pt-BR', { style: 'currency', currency: code || 'BRL',
        maximumFractionDigits: 0 }).format(Number(value));

const STATUS_TONE: Record<EngagementStatus, 'neutral' | 'success' | 'warning' | 'info'> = {
  UNDER_ANALYSIS: 'warning',
  AUTHORIZED: 'success',
  SUSPENDED: 'warning',
  CLOSED: 'neutral',
  CANCELLED: 'neutral',
};

/**
 * A CARTEIRA CONSOLIDADA.
 *
 * ─── O que ela responde que a lista de contratos não respondia ────────────
 *
 * "Quanto trabalho autorizado a Insight tem?" — e a resposta inclui o que foi
 * vendido por proposta aceita e o que veio por pedido de compra. Enquanto a
 * carteira era uma lista de CONTRATOS, esse trabalho existia, era executado,
 * medido e faturado, e não aparecia em lugar nenhum da visão de carteira.
 *
 * ─── O que o KPI soma, e o que ele se recusa a somar ──────────────────────
 *
 * Só `AUTHORIZED` entra no valor autorizado. Uma entrada `Em análise` aparece
 * na lista — ela existe, alguém precisa olhar — e fica FORA do total. É a
 * regra do §6, e ela é visível aqui: o cabeçalho diz quantas entradas estão
 * em análise justamente para que a diferença entre "a lista tem 14" e "o
 * total soma 9" nunca pareça um erro de conta.
 */
export function CarteiraConsolidated({ className }: { className?: string }) {
  const [engagements, setEngagements] = useState<EngagementRow[]>([]);
  const [authorizations, setAuthorizations] = useState<AuthorizationRow[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch('/api/commercial/engagements');
        const payload = await response.json();
        if (cancelled) return;
        if (!response.ok || !payload.ok) { setState('error'); return; }
        setEngagements(payload.engagements ?? []);
        setAuthorizations(payload.authorizations ?? []);
        setState('ready');
      } catch {
        if (!cancelled) setState('error');
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const governingBy = useMemo(() => {
    const map = new Map<string, AuthorizationRow>();
    for (const row of authorizations) if (row.governing) map.set(row.engagement_id, row);
    return map;
  }, [authorizations]);

  const stats = useMemo(() => {
    const authorized = engagements.filter((e) => e.status === 'AUTHORIZED');
    const total = authorized.reduce((sum, e) => sum + Number(e.authorized_value ?? 0), 0);
    const byKind = new Map<string, number>();
    for (const e of authorized) {
      const kind = governingBy.get(e.id)?.source_kind ?? 'unknown';
      byKind.set(kind, (byKind.get(kind) ?? 0) + 1);
    }
    return {
      total,
      authorizedCount: authorized.length,
      underAnalysis: engagements.filter((e) => e.status === 'UNDER_ANALYSIS').length,
      withoutContract: authorized.filter(
        (e) => governingBy.get(e.id)?.source_kind !== 'formal_contract').length,
      byKind,
    };
  }, [engagements, governingBy]);

  if (state === 'loading') {
    return (
      <HudPanel elevation={1} interactive={false} className={className}>
        <p className="text-ig-body-sm text-ig-fg-muted">Carregando a carteira consolidada…</p>
      </HudPanel>
    );
  }
  if (state === 'error') {
    return (
      <HudPanel elevation={1} state="critical" interactive={false} className={className}>
        <p className="text-ig-body-sm text-ig-fg-strong">
          Não foi possível carregar a carteira consolidada.
        </p>
      </HudPanel>
    );
  }
  if (engagements.length === 0) {
    return (
      <HudEmptyState
        className={className}
        icon="inbox"
        title={`Nenhum ${ENGAGEMENT_LABEL_PLURAL.toLowerCase()} registrado`}
        description="Use + Adicionar para trazer um contrato, importar uma proposta aprovada, registrar um pedido ou criar manualmente."
      />
    );
  }

  return (
    <section className={cn('space-y-3', className)} aria-label="Carteira consolidada">
      <HudPanel elevation={1} interactive={false}>
        <div className="flex flex-wrap items-center gap-4">
          <div>
            <p className="text-ig-caption uppercase tracking-wide text-ig-fg-subtle">
              Valor autorizado
            </p>
            <p className="text-ig-h4 tabular-nums text-ig-fg-strong">
              {currency(String(stats.total), 'BRL')}
            </p>
            <p className="text-ig-caption text-ig-fg-subtle">
              {stats.authorizedCount} autorizado(s) · {stats.withoutContract} sem contrato formal
            </p>
          </div>
          {stats.underAnalysis > 0 && (
            <HudSignal
              size="sm"
              tone="warning"
              label="Em análise"
              value={String(stats.underAnalysis)}
              title="Entradas registradas que ainda não entram em valor autorizado nem em backlog."
            />
          )}
          {[...stats.byKind.entries()].map(([kind, count]) => (
            <HudSignal
              key={kind}
              size="sm"
              tone="neutral"
              label={authorizationSourceLabels[kind as AuthorizationSourceKind] ?? kind}
              value={String(count)}
            />
          ))}
        </div>
      </HudPanel>

      <ul className="space-y-2">
        {engagements.map((row) => {
          const governing = governingBy.get(row.id);
          return (
            <li key={row.id}>
              <HudPanel elevation={1} interactive={false}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-ig-body-sm font-medium text-ig-fg-strong">
                      {row.title}
                    </p>
                    <p className="text-ig-caption text-ig-fg-subtle">
                      {row.counterparty_name}
                      {row.engagement_number ? ` · ${row.engagement_number}` : ''}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {/*
                      A FONTE que autoriza vem antes do valor. É ela que
                      explica por que existe direito de executar — e, quando
                      não é um contrato, dizê-la é o que evita a pergunta
                      "cadê o contrato deste projeto?".
                    */}
                    <HudBadge variant="outline">
                      {governing
                        ? authorizationSourceLabels[governing.source_kind]
                        : 'Sem fonte de autorização'}
                    </HudBadge>
                    <HudBadge variant={STATUS_TONE[row.status] === 'success' ? 'success' : 'outline'}>
                      {engagementStatusLabels[row.status]}
                    </HudBadge>
                    <span className="tabular-nums text-ig-body-sm text-ig-fg-strong">
                      {row.status === 'UNDER_ANALYSIS'
                        ? 'valor pendente de revisão'
                        : currency(row.authorized_value, row.currency)}
                    </span>
                  </div>
                </div>
              </HudPanel>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export type { CommercialEngagement };
