import { z } from 'zod';

export const REQUIREMENT_TYPES = ['MATERIAL', 'EQUIPMENT', 'VEHICLE', 'WORKFORCE', 'EXTERNAL_SERVICE',
  'DOCUMENT', 'CUSTOMER_DEPENDENCY', 'OTHER'] as const;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** Um contrato de entrada para criar e editar — campos ausentes não são tocados. */
export const requirementSchema = z.object({
  projectId: z.string().trim().min(1).max(200).optional(),
  activityId: z.string().uuid().nullable().optional(),
  requirementType: z.enum(REQUIREMENT_TYPES).optional(),
  title: z.string().trim().min(1).max(500).optional(),
  description: z.string().trim().max(4000).nullable().optional(),
  quantity: z.number().positive().nullable().optional(),
  unit: z.string().trim().max(30).nullable().optional(),
  resourceLabel: z.string().trim().max(300).nullable().optional(),
  requiredBy: isoDate.nullable().optional(),
  deliveryLocationLabel: z.string().trim().max(300).nullable().optional(),
  priority: z.enum(['low', 'medium', 'high', 'critical']).optional(),
  constraintsNote: z.string().trim().max(2000).nullable().optional(),
  itemId: z.string().uuid().nullable().optional(),
  reason: z.string().trim().max(2000).optional(),
});

const KEYS: Record<string, string> = {
  projectId: 'project_id', activityId: 'activity_id', requirementType: 'requirement_type', title: 'title',
  description: 'description', quantity: 'quantity', unit: 'unit', resourceLabel: 'resource_label',
  requiredBy: 'required_by', deliveryLocationLabel: 'delivery_location_label', priority: 'priority',
  constraintsNote: 'constraints_note', itemId: 'item_id', reason: 'reason',
};

export function requirementPayload(input: z.infer<typeof requirementSchema>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) if (v !== undefined && KEYS[k]) out[KEYS[k]] = v;
  return out;
}

/* 252 · recusas da edição de requisito com cobertura, em português (a rota passa a `governedFailure`). */
const COVERAGE_PART: Record<string, string> = {
  reserved: 'reservado', consumed: 'consumido', 'pending transfers': 'transferências pendentes', 'in transit': 'em trânsito',
  'on order': 'em pedido', 'in inspection': 'em inspeção', requested: 'requisitado',
};
const qtyBR = (raw: string) => Number(raw).toLocaleString('pt-BR', { maximumFractionDigits: 10 });
/** "reserved 30, requested 70" → "reservado 30, requisitado 70" (números exatos, no formato brasileiro). */
function coverageDetail(detail: string): string {
  return detail.split(', ').filter(Boolean).map((part) => {
    const m = part.match(/^(.+) ([\d.]+)$/);
    return m ? `${COVERAGE_PART[m[1]] ?? m[1]} ${qtyBR(m[2])}` : part;
  }).join(', ');
}
const MOVE_TEXT: Record<string, string> = { CANCELLED: 'cancelar o requisito', PLANNED: 'devolvê-lo ao planejamento', SUPERSEDED: 'substituí-lo' };

export function requirementCoverageErrorMessage(raw: string): string | null {
  let m = raw.match(/Requirement quantity (\S+) is below its committed coverage ([\d.]+) \((.*)\): release or cancel coverage first/);
  if (m) {
    return `A quantidade ${m[1] === 'empty' ? 'vazia' : qtyBR(m[1])} fica abaixo da cobertura já comprometida (${qtyBR(m[2])}: ${coverageDetail(m[3])}). `
      + 'Libere a reserva ou cancele a transferência, a solicitação ou o pedido antes de reduzir.';
  }
  m = raw.match(/Requirement has coverage of its current item \(([\d.]+) committed: (.*)\): the item changes only after/);
  if (m) {
    return `O requisito tem cobertura do item atual (${qtyBR(m[1])}: ${coverageDetail(m[2])}). `
      + 'O item só muda depois de liberar ou cancelar essa cobertura — ou substitua o requisito por um novo.';
  }
  m = raw.match(/Requirement has active coverage ([\d.]+) \((.*)\): release or cancel it before moving the requirement to (\w+)/);
  if (m) {
    return `O requisito tem cobertura ativa (${qtyBR(m[1])}: ${coverageDetail(m[2])}). `
      + `Libere a reserva ou cancele a transferência, a solicitação ou o pedido antes de ${MOVE_TEXT[m[3]] ?? 'mudar o estado'}.`;
  }
  return null;
}
