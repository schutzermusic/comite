'use client';

/**
 * A CADEIA COMERCIAL do projeto.
 *
 * ─── A pergunta que responde ─────────────────────────────────────────────
 *
 * "Sob o que este projeto está sendo executado?"
 *
 * Enquanto todo projeto vinha de contrato, a resposta era óbvia e a aba
 * contratual bastava. Deixou de bastar: há projeto executado sob proposta
 * aceita, sob pedido de compra, sob autorização formal — e, para esses, a aba
 * contratual fica vazia. Uma tela vazia parece "falta cadastrar o contrato",
 * quando o correto é "não há contrato, e não deveria haver".
 *
 * ─── Ids canônicos, nenhuma cópia ────────────────────────────────────────
 *
 * Cada documento apontado aqui é a MESMA linha de `contract_documents` que a
 * proposta, a OS e o contrato já usam. O projeto não guarda cópia de PDF, não
 * tem um segundo id de documento, e abrir daqui abre o original.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { FileSignature, Link2, ShieldAlert } from 'lucide-react';
import { HudBadge, HudEmptyState, HudPanel } from '@/components/hud';
import { authorizationSourceLabels } from '@/lib/commercial/labels';
import type { AuthorizationSourceKind } from '@/lib/commercial/types';
import { AUTHORIZATION_BASIS_LABEL, type AuthorizationBasis } from '@/lib/commercial/execution-start';

type ExecutionStart = {
  engagement_id: string; mode: 'STANDARD' | 'EXCEPTIONAL'; authorization_type: AuthorizationBasis;
  authorization_date: string; authorization_reference: string | null;
  documentation_state: 'COMPLETE' | 'PENDING' | 'REGULARIZED'; exception_reason: string | null;
  regularization_due_date: string | null; regularized_at: string | null;
};

type Chain = {
  engagement_id: string;
  engagement_title: string;
  engagement_status: string;
  counterparty_name: string;
  currency: string;
  authorized_value: string | null;
  service_order_id: string | null;
  service_order_number: string | null;
  service_order_status: string | null;
  service_order_document_id: string | null;
  governing_source_kind: AuthorizationSourceKind | null;
  governing_contract_id: string | null;
  governing_document_id: string | null;
  governing_external_reference: string | null;
  contract_number: string | null;
  contract_title: string | null;
  technical_proposal_number: string | null;
  technical_proposal_document_id: string | null;
  commercial_proposal_number: string | null;
  commercial_proposal_document_id: string | null;
  open_divergence_count: number;
  blocking_divergence_count: number;
};

function Row({ label, value, hint }: { label: string; value: string | null; hint?: string }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-ig-border-subtle py-2 last:border-0">
      <span className="text-ig-caption uppercase tracking-wide text-ig-fg-subtle">{label}</span>
      <span className="text-ig-body-sm text-ig-fg-strong">
        {value ?? <span className="text-ig-fg-subtle">{hint ?? 'não há'}</span>}
      </span>
    </div>
  );
}

export function ProjectCommercialSourceChain({ projectId }: { projectId: string }) {
  const [chains, setChains] = useState<Chain[]>([]);
  const [starts, setStarts] = useState<ExecutionStart[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch(
          `/api/commercial/projects/${encodeURIComponent(projectId)}/source-chain`);
        const payload = await response.json();
        if (cancelled) return;
        if (!response.ok || !payload.ok) { setState('error'); return; }
        setChains(payload.chains ?? []);
        setStarts(payload.executionStarts ?? []);
        setState('ready');
      } catch { if (!cancelled) setState('error'); }
    })();
    return () => { cancelled = true; };
  }, [projectId]);

  if (state === 'loading') {
    return <HudPanel elevation={1} interactive={false}>
      <p className="text-ig-body-sm text-ig-fg-muted">Carregando a origem comercial…</p>
    </HudPanel>;
  }
  if (state === 'error') {
    return <HudPanel elevation={1} state="critical" interactive={false}>
      <p className="text-ig-body-sm text-ig-fg-strong">
        Não foi possível ler a origem comercial deste projeto.
      </p>
    </HudPanel>;
  }
  if (chains.length === 0) {
    return <HudEmptyState icon="file" title="Projeto sem origem comercial registrada"
      description="Este projeto não está ligado a nenhum trabalho autorizado. Isso é legítimo em projeto interno; se ele executa trabalho vendido, a origem precisa ser registrada na Carteira." />;
  }

  return (
    <section className="space-y-3" aria-label="Origem comercial do projeto">
      {chains.map((chain) => (
        <HudPanel key={chain.engagement_id} elevation={1} interactive={false}>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <p className="text-ig-body-sm font-medium text-ig-fg-strong">
              {chain.engagement_title}
            </p>
            <div className="flex items-center gap-2">
              <HudBadge variant="outline">
                {chain.governing_source_kind
                  ? authorizationSourceLabels[chain.governing_source_kind]
                  : 'sem fonte regente'}
              </HudBadge>
              <Link href={`/contratos?view=carteira&engajamento=${chain.engagement_id}`}
                className="inline-flex items-center gap-1 text-ig-caption text-ig-fg-muted hover:text-ig-fg-strong">
                <Link2 className="h-3 w-3" aria-hidden /> abrir na carteira
              </Link>
            </div>
          </div>

          {(() => {
            const start = starts.find((s) => s.engagement_id === chain.engagement_id);
            if (!start) return null;
            if (start.documentation_state === 'PENDING') {
              return (
                <div role="status" data-testid="project-documentation-pending"
                  className="mb-3 flex gap-2 rounded-lg border border-ig-danger/40 bg-ig-danger/10 p-3 text-ig-body-sm text-ig-fg-strong">
                  <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-ig-danger" aria-hidden />
                  <div>
                    <p className="font-medium">Execução iniciada com documentação comercial pendente</p>
                    <p className="text-ig-fg-muted">
                      Base declarada: {AUTHORIZATION_BASIS_LABEL[start.authorization_type]}
                      {start.authorization_reference ? ` · ${start.authorization_reference}` : ''}.
                      Prazo de regularização: {start.regularization_due_date
                        ? new Date(`${start.regularization_due_date}T12:00:00`).toLocaleDateString('pt-BR') : '—'}.
                      Medição e evidência seguem normalmente; o <strong>faturamento fica bloqueado</strong> até a regularização.
                    </p>
                  </div>
                </div>
              );
            }
            return (
              <Row label="Base do início da execução"
                value={`${AUTHORIZATION_BASIS_LABEL[start.authorization_type]} · ${new Date(`${start.authorization_date}T12:00:00`).toLocaleDateString('pt-BR')}${start.documentation_state === 'REGULARIZED' ? ' · regularizada' : ''}`} />
            );
          })()}
          <Row label="Ordem de Serviço interna"
            value={chain.service_order_number
              ? `${chain.service_order_number} · ${chain.service_order_status}` : null}
            hint="nenhuma OS interna vinculada" />
          <Row label="Proposta técnica" value={chain.technical_proposal_number} />
          <Row label="Proposta comercial" value={chain.commercial_proposal_number} />
          {/*
            "não há" é a resposta CERTA para contrato quando o trabalho foi
            autorizado por proposta ou pedido. Um traço genérico faria parecer
            que falta cadastrar alguma coisa.
          */}
          <Row label="Contrato formal"
            value={chain.contract_number ?? chain.contract_title}
            hint="não há — trabalho autorizado por outra fonte" />
          <Row label="Pedido / autorização do cliente"
            value={chain.governing_source_kind === 'customer_po'
              || chain.governing_source_kind === 'customer_authorization'
              ? chain.governing_external_reference ?? 'documento anexado' : null} />

          {chain.open_divergence_count > 0 && (
            <p className={chain.blocking_divergence_count > 0
              ? 'mt-3 text-ig-body-sm text-ig-danger'
              : 'mt-3 text-ig-body-sm text-ig-fg-strong'}>
              <FileSignature className="mr-1 inline h-3 w-3" aria-hidden />
              {chain.open_divergence_count} divergência(s) em aberto entre as fontes
              {chain.blocking_divergence_count > 0 ? ', sendo bloqueantes para emissão de OS.' : '.'}
            </p>
          )}
        </HudPanel>
      ))}
    </section>
  );
}
