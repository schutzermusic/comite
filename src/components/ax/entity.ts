/**
 * Endereço de cada registro de Operações e Supply — um lugar só.
 *
 * É o que responde "por que compramos isto?" clicando: pedido → decisão →
 * cotação → requisição → requisito → atividade → OS → proposta. Cada elo é um
 * link que cai na aba certa com o registro aberto.
 */
const q = (params: Record<string, string | null | undefined>) => {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) s.set(k, v);
  const out = s.toString();
  return out ? `?${out}` : '';
};

export const href = {
  serviceOrder: (id: string, tab?: string) => `/operacoes/ordens-servico/${id}${q({ tab })}`,
  project: (id: string, tab?: string) => `/projetos/${encodeURIComponent(id)}${q({ tab })}`,
  projectSchedule: (id: string) => `/projetos/${encodeURIComponent(id)}?tab=timeline`,
  proposal: (proposalId: string) => `/comercial?view=propostas&proposal=${encodeURIComponent(proposalId)}`,
  requirement: (id: string) => `/supply/planejamento-materiais${q({ req: id })}`,
  purchaseOrder: (id: string) => `/supply/compras${q({ stage: 'pedidos', po: id })}`,
  requisition: (id: string) => `/supply/compras${q({ stage: 'solicitacoes', rq: id })}`,
  rfq: (id: string) => `/supply/compras${q({ stage: 'cotacoes', rfq: id })}`,
  approval: (poId: string) => `/supply/compras${q({ stage: 'aprovacao', po: poId })}`,
  receipt: (id: string, queue?: string) => `/supply/recebimentos${q({ queue, receipt: id })}`,
  receivePo: (poId: string) => `/supply/recebimentos${q({ receive: poId })}`,
  supplier: (id: string) => `/supply/fornecedores${q({ supplier: id })}`,
  item: (id: string) => `/supply/estoque${q({ view: 'posicao', item: id })}`,
  transfer: (id: string) => `/supply/estoque${q({ view: 'transferencias', transfer: id })}`,
  inventoryView: (view: string) => `/supply/estoque${q({ view })}`,
  materialPlanning: (filter?: string) => `/supply/planejamento-materiais${q({ filter })}`,
  measurements: (lane?: string) => `/operacoes/medicoes${q({ lane })}`,
  planning: (focus?: string) => `/operacoes/planejamento${q({ focus })}`,
  map: (projectId?: string) => `/projetos/operations-3d${q({ project: projectId })}`,
};
