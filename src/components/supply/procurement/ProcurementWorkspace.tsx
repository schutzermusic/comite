'use client';

import {
  AxPage, CommandHeader, Dot, Resource, StagePipeline, money, plural, useResource, useUrlParam,
} from '@/components/ax';
import { RequisitionsStage } from './RequisitionsStage';
import { QuotationsStage } from './QuotationsStage';
import { ApprovalsStage } from './ApprovalsStage';
import { OrdersStage } from './OrdersStage';
import type { ProcurementModel } from './shared';

export type ProcurementStage = 'solicitacoes' | 'cotacoes' | 'aprovacao' | 'pedidos';

/**
 * COMPRAS — um fluxo, quatro etapas: a falta vira requisição, a requisição
 * vira cotação, a cotação decidida vira pedido, o pedido passa pela regra de
 * aprovação do inquilino e é emitido — e só então conta como "em pedido" na
 * cobertura do projeto. Cada etapa diz quantos esperam e por quê.
 *
 * Endereçável: `?stage=`, `?rq=` (requisição), `?rfq=` (cotação), `?po=` (pedido).
 */
export function ProcurementWorkspace() {
  const resource = useResource<ProcurementModel & { ok: true }>('/api/supply/procurement');
  return (
    <AxPage testId="procurement-workspace">
      <Resource {...resource}>{(data) => <Workspace data={data} refresh={resource.refresh} />}</Resource>
    </AxPage>
  );
}

function Workspace({ data, refresh }: { data: ProcurementModel; refresh: () => void }) {
  const [stage, setStage] = useUrlParam<ProcurementStage>('stage', 'solicitacoes');
  const waiting = data.requisitions.filter((r) => r.status === 'SUBMITTED' || r.status === 'SOURCING');
  const waitingLines = waiting.flatMap((r) => r.lines.filter((l) => !l.inRfq)).length;
  const openRfqs = data.rfqs.filter((r) => r.status === 'OPEN');
  const readyToDecide = openRfqs.filter((r) => r.quotes.some((q) => q.status === 'RECEIVED')).length;
  const approving = data.purchaseOrders.filter((o) => o.status === 'APPROVAL_REQUIRED');
  const drafts = data.purchaseOrders.filter((o) => o.status === 'DRAFT' || o.status === 'APPROVED');
  const live = data.purchaseOrders.filter((o) => o.status === 'ISSUED' || o.status === 'PARTIALLY_RECEIVED');
  const exposure = live.reduce((a, o) => a + o.lines.reduce((s, l) => s + Math.max(0, l.quantity - l.received) * l.unitPrice, 0), 0);
  const stuck = approving.length + drafts.length;

  return (
    <>
      <CommandHeader domain="supply" area="Compras" title="Compras"
        context={<>
          <span><strong>{waitingLines}</strong> {waitingLines === 1 ? 'linha aguardando cotação' : 'linhas aguardando cotação'}</span>
          {readyToDecide > 0 && <span><Dot tone="warning" label="decisão" /><strong>{readyToDecide}</strong> {readyToDecide === 1 ? 'cotação pronta para decidir' : 'cotações prontas para decidir'}</span>}
          {stuck > 0 && <span><strong>{stuck}</strong> {stuck === 1 ? 'pedido antes da emissão' : 'pedidos antes da emissão'}</span>}
          <span>{money(exposure, 'BRL', { compact: true })} a receber</span>
        </>} />

      <StagePipeline<ProcurementStage> label="Etapas de compras" value={stage} onChange={setStage} stages={[
        { id: 'solicitacoes', label: 'Solicitações', count: waiting.length, tone: waitingLines ? 'warning' : undefined,
          sub: waitingLines ? plural(waitingLines, 'linha sem cotação', 'linhas sem cotação') : 'nada esperando cotação' },
        { id: 'cotacoes', label: 'Cotações', count: openRfqs.length, tone: readyToDecide ? 'warning' : undefined,
          sub: readyToDecide ? plural(readyToDecide, 'pronta para decidir', 'prontas para decidir') : 'propostas sendo recebidas' },
        { id: 'aprovacao', label: 'Aprovações', count: approving.length, tone: approving.length ? 'warning' : undefined,
          sub: approving.length ? 'esperando a regra do inquilino' : 'nada esperando decisão' },
        { id: 'pedidos', label: 'Pedidos', count: live.length,
          sub: `${plural(live.length, 'emitido', 'emitidos')} com saldo${drafts.length ? ` · ${plural(drafts.length, 'rascunho/aprovado', 'rascunhos/aprovados')}` : ''}` },
      ]} />

      <div role="tabpanel" aria-labelledby={`ax-stage-${stage}`} className="ax-stack">
        {stage === 'solicitacoes' && <RequisitionsStage data={data} onChanged={refresh} />}
        {stage === 'cotacoes' && <QuotationsStage data={data} onChanged={refresh} />}
        {stage === 'aprovacao' && <ApprovalsStage data={data} onChanged={refresh} />}
        {stage === 'pedidos' && <OrdersStage data={data} onChanged={refresh} />}
      </div>
    </>
  );
}
