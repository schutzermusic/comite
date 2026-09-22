'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { HudBadge, HudButton, HudEmptyState, HudPanel, HudSignal, useHudToast } from '@/components/hud';
import { serviceOrderStatusLabels } from '@/lib/commercial/labels';
import type { ServiceOrderOrigin, ServiceOrderStatus } from '@/lib/commercial/types';
import { ServiceOrderProjectModal } from './ServiceOrderProjectModal';
import { NewServiceOrderModal } from './NewServiceOrderModal';

type ServiceOrderRow = {
  id: string; engagement_id: string; os_number: string; title: string;
  origin: ServiceOrderOrigin; status: ServiceOrderStatus;
  authorized_value: string | null; currency: string | null;
  scope_summary: string | null; planned_start: string | null; planned_finish: string | null;
  project_id: string | null; source_proposal_revision_id: string | null;
  document_id: string | null; issued_at: string | null; created_at: string;
};

const originLabels: Record<ServiceOrderOrigin, string> = {
  from_accepted_proposal: 'Da proposta aceita',
  manual: 'Criada manualmente',
  uploaded_document: 'Documento carregado',
};

const money = (value: string | null, code: string | null) =>
  value === null ? '—'
    : new Intl.NumberFormat('pt-BR', { style: 'currency', currency: code || 'BRL',
        maximumFractionDigits: 0 }).format(Number(value));

/**
 * ORDENS DE SERVIÇO INTERNAS.
 *
 * ─── O que esta tela precisa deixar claro ─────────────────────────────────
 *
 * A OS interna é autorização OPERACIONAL da Insight para a Insight. Não é o
 * pedido de compra do cliente, não é a OS do cliente e não é o contrato — e a
 * tela diz isso em texto, porque as quatro coisas chegam pelo mesmo tipo de
 * PDF e a confusão entre elas é o caminho mais curto para faturar sem direito.
 *
 * ─── Divergência não vira botão de "ignorar" ──────────────────────────────
 *
 * Uma OS em `Aguardando confirmação` tem divergência aberta contra a fonte
 * regente. A tela não oferece "emitir assim mesmo": ela leva à decisão. O
 * portão real é o gatilho `iso_issue_gate`, e esta tela apenas evita que
 * alguém esbarre nele sem entender por quê.
 */
export function ServiceOrdersWorkbench() {
  const [orders, setOrders] = useState<ServiceOrderRow[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [projectTarget, setProjectTarget] = useState<ServiceOrderRow | null>(null);
  const [creating, setCreating] = useState(false);
  const { success, error: notifyError } = useHudToast();

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/commercial/service-orders');
      const payload = await response.json();
      if (!response.ok || !payload.ok) { setState('error'); return; }
      setOrders(payload.serviceOrders ?? []);
      setState('ready');
    } catch { setState('error'); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const issue = useCallback(async (id: string) => {
    const response = await fetch(`/api/commercial/service-orders/${id}/issue`, { method: 'POST' });
    const payload = await response.json();
    if (!response.ok || !payload.ok) {
      // A mensagem do portão é a resposta útil: ela diz quantas divergências
      // seguram a emissão. Trocá-la por "erro ao emitir" esconderia o motivo.
      notifyError('Emissão recusada', payload.error);
      return;
    }
    success('OS emitida');
    await load();
  }, [load, success, notifyError]);

  const counts = useMemo(() => ({
    pending: orders.filter((o) => o.status === 'PENDING_CONFIRMATION').length,
    issuedWithoutProject: orders.filter((o) => o.status === 'ISSUED' && !o.project_id).length,
  }), [orders]);

  if (state === 'loading') {
    return <HudPanel elevation={1} interactive={false}>
      <p className="text-ig-body-sm text-ig-fg-muted">Carregando ordens de serviço…</p>
    </HudPanel>;
  }
  if (state === 'error') {
    return <HudPanel elevation={1} state="critical" interactive={false}>
      <p className="text-ig-body-sm text-ig-fg-strong">
        Não foi possível carregar as ordens de serviço internas.
      </p>
    </HudPanel>;
  }

  return (
    <section className="space-y-3" aria-label="Ordens de Serviço internas">
      <div className="flex justify-end">
        <HudButton variant="primary" size="md" onClick={() => setCreating(true)}>
          Nova Ordem de Serviço
        </HudButton>
      </div>

      <HudPanel elevation={1} interactive={false}>
        <p className="text-ig-caption text-ig-fg-muted">
          A Ordem de Serviço interna é a autorização <strong>operacional da Insight</strong> para
          começar a executar. Ela não substitui, nem representa, o pedido de compra do cliente,
          a OS do cliente ou o contrato — essas são fontes de autorização e vivem no item da carteira.
        </p>
        {(counts.pending > 0 || counts.issuedWithoutProject > 0) && (
          <div className="mt-3 flex flex-wrap gap-3">
            {counts.pending > 0 && (
              <HudSignal size="sm" tone="warning" label="Aguardando confirmação"
                value={String(counts.pending)} />
            )}
            {counts.issuedWithoutProject > 0 && (
              <HudSignal size="sm" tone="info" label="Emitidas sem projeto"
                value={String(counts.issuedWithoutProject)} />
            )}
          </div>
        )}
      </HudPanel>

      {orders.length === 0 ? (
        <HudEmptyState
          icon="file"
          title="Nenhuma Ordem de Serviço interna"
          description="Uma OS nasce de uma proposta aceita, de um cadastro manual ou do upload de uma OS já emitida."
        />
      ) : (
        <ul className="space-y-2">
          {orders.map((order) => (
            <li key={order.id}>
              <HudPanel elevation={1} interactive={false}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-ig-body-sm font-medium text-ig-fg-strong">
                      {order.os_number} · {order.title}
                    </p>
                    <p className="text-ig-caption text-ig-fg-subtle">
                      {originLabels[order.origin]}
                      {order.project_id ? ` · Projeto ${order.project_id}` : ' · sem projeto'}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <HudBadge variant={order.status === 'PENDING_CONFIRMATION' ? 'warning' : 'outline'}>
                      {serviceOrderStatusLabels[order.status]}
                    </HudBadge>
                    <span className="tabular-nums text-ig-body-sm text-ig-fg-strong">
                      {money(order.authorized_value, order.currency)}
                    </span>
                    {order.status === 'DRAFT' && (
                      <HudButton variant="primary" size="sm" onClick={() => issue(order.id)}>
                        Emitir
                      </HudButton>
                    )}
                    {order.status === 'PENDING_CONFIRMATION' && (
                      <HudButton
                        variant="secondary" size="sm"
                        onClick={() => { window.location.href =
                          `/contratos?view=carteira&engajamento=${order.engagement_id}&acao=divergencias`; }}
                      >
                        Decidir divergências
                      </HudButton>
                    )}
                    {(order.status === 'ISSUED' || order.status === 'IN_EXECUTION')
                      && !order.project_id && (
                      <HudButton variant="primary" size="sm" onClick={() => setProjectTarget(order)}>
                        Criar/vincular projeto
                      </HudButton>
                    )}
                  </div>
                </div>
              </HudPanel>
            </li>
          ))}
        </ul>
      )}

      {creating && (
        <NewServiceOrderModal
          onClose={() => setCreating(false)}
          onDone={async () => { setCreating(false); await load(); }}
        />
      )}

      {projectTarget && (
        <ServiceOrderProjectModal
          order={projectTarget}
          onClose={() => setProjectTarget(null)}
          onDone={async () => { setProjectTarget(null); await load(); }}
        />
      )}
    </section>
  );
}

export type { ServiceOrderRow };
