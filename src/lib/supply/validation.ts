import { z } from 'zod';

/** Entrada do cadastro de item — campos ausentes não são tocados. */
export const itemSchema = z.object({
  code: z.string().trim().min(1).max(60).optional(),
  description: z.string().trim().min(1).max(500).optional(),
  category: z.string().trim().max(120).nullable().optional(),
  unit: z.string().trim().min(1).max(20).optional(),
  manufacturer: z.string().trim().max(200).nullable().optional(),
  brand: z.string().trim().max(200).nullable().optional(),
  tracking: z.enum(['NONE', 'LOT', 'SERIAL']).optional(),
  active: z.boolean().optional(),
  technicalAttributes: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
});

export function itemPayload(input: z.infer<typeof itemSchema>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) {
    if (v === undefined) continue;
    out[k === 'technicalAttributes' ? 'technical_attributes' : k] = v;
  }
  return out;
}

// ── Estoque (233) ─────────────────────────────────────────────────────────
const uuid = z.string().uuid();
const qty = z.coerce.number().finite();
const positive = qty.positive();
const reason = z.string().trim().min(3).max(500);
const key = z.string().trim().min(8).max(120).optional();
const lot = z.string().trim().max(120).nullable().optional();

export const locationSchema = z.object({
  code: z.string().trim().min(1).max(40).optional(),
  name: z.string().trim().min(1).max(160).optional(),
  kind: z.enum(['WAREHOUSE', 'PROJECT_SITE', 'VEHICLE', 'QUARANTINE', 'ZONE', 'BIN']).optional(),
  parentId: uuid.nullable().optional(),
  projectId: z.string().trim().min(1).max(200).nullable().optional(),
  addressLabel: z.string().trim().max(300).nullable().optional(),
  latitude: z.coerce.number().min(-90).max(90).nullable().optional(),
  longitude: z.coerce.number().min(-180).max(180).nullable().optional(),
  active: z.boolean().optional(),
});

export const adjustmentSchema = z.object({
  itemId: uuid, locationId: uuid, quantity: qty.refine((v) => v !== 0, 'Quantidade não pode ser zero.'),
  lotCode: lot, reason, idempotencyKey: key,
});

export const reserveSchema = z.object({
  requirementId: uuid, locationId: uuid, quantity: positive, note: z.string().trim().max(500).optional(), idempotencyKey: key,
});

export const reservationActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('release'), quantity: positive.nullable().optional(), reason }),
  z.object({ action: z.literal('issue'), quantity: positive, lotCode: lot, note: z.string().trim().max(500).optional(), idempotencyKey: key }),
  z.object({ action: z.literal('return'), quantity: positive, locationId: uuid.optional(), lotCode: lot, reason, idempotencyKey: key }),
]);

export const transferRequestSchema = z.object({
  fromLocationId: uuid, toLocationId: uuid, projectId: z.string().trim().min(1).max(200).nullable().optional(),
  expectedArrival: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  carrier: z.string().trim().max(200).nullable().optional(), note: z.string().trim().max(1000).nullable().optional(),
  idempotencyKey: key,
  lines: z.array(z.object({
    itemId: uuid, quantity: positive, lotCode: lot, requirementId: uuid.nullable().optional(),
    sourceReservationId: uuid.nullable().optional(),
  })).min(1).max(100),
}).refine((t) => t.fromLocationId !== t.toLocationId, 'Origem e destino precisam ser diferentes.');

export const transferActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('approve') }),
  z.object({ action: z.literal('dispatch'), carrier: z.string().trim().max(200).optional(), trackingRef: z.string().trim().max(200).optional(),
    expectedArrival: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }),
  z.object({ action: z.literal('receive'), idempotencyKey: key,
    lines: z.array(z.object({ lineId: uuid, quantity: positive })).min(1).max(100) }),
  z.object({ action: z.literal('close'), reason: z.string().trim().max(500).optional() }),
  z.object({ action: z.literal('cancel'), reason }),
]);

export const countOpenSchema = z.object({ locationId: uuid, itemIds: z.array(uuid).max(500).optional(), note: z.string().trim().max(500).optional() });

export const countActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('record'), lines: z.array(z.object({
    lineId: uuid.optional(), itemId: uuid.optional(), lotCode: lot, countedQuantity: qty.min(0),
  }).refine((l) => l.lineId || l.itemId, 'Linha ou item obrigatório.')).min(1).max(500) }),
  z.object({ action: z.literal('post'), reason: z.string().trim().max(500).optional() }),
  z.object({ action: z.literal('cancel'), reason }),
]);

/** camelCase da rota → snake_case do contrato das funções do banco. */
export function snakePayload(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) {
    if (v === undefined) continue;
    const sk = k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
    out[sk] = Array.isArray(v) ? v.map((x) => (x && typeof x === 'object' ? snakePayload(x as Record<string, unknown>) : x))
      : v;
  }
  return out;
}

// ── Compras e fornecedores (234) ──────────────────────────────────────────
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const money = z.coerce.number().finite().min(0);

export const supplierSchema = z.object({
  partyId: uuid.optional(),
  legalName: z.string().trim().min(2).max(300).optional(),
  tradeName: z.string().trim().max(300).nullable().optional(),
  kind: z.enum(['organization', 'person']).optional(),
  documentType: z.enum(['cnpj', 'cpf', 'foreign']).nullable().optional(),
  documentNumber: z.string().trim().max(40).nullable().optional(),
  categories: z.array(z.string().trim().min(1).max(80)).max(30).optional(),
  defaultPaymentTerms: z.string().trim().max(200).nullable().optional(),
  defaultLeadTimeDays: z.coerce.number().int().min(0).max(3650).nullable().optional(),
  contactName: z.string().trim().max(200).nullable().optional(),
  contactEmail: z.string().trim().email().max(200).nullable().optional().or(z.literal('')),
  contactPhone: z.string().trim().max(60).nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
}).refine((s) => s.partyId || s.legalName, 'Informe a razão social (ou uma parte existente).');

export const supplierStatusSchema = z.object({
  status: z.enum(['PROSPECT', 'HOMOLOGATED', 'SUSPENDED', 'BLOCKED']), reason: z.string().trim().max(500).nullable().optional(),
}).refine((s) => !['SUSPENDED', 'BLOCKED'].includes(s.status) || (s.reason ?? '').length >= 3, 'Suspender ou bloquear exige motivo.');

export const authoritySchema = z.object({
  granteeKind: z.enum(['ROLE', 'USER']), granteeRoleId: uuid.nullable().optional(), granteeUserId: uuid.nullable().optional(),
  maxAmount: money.positive().nullable().optional(), currency: z.string().regex(/^[A-Z]{3}$/).default('BRL'),
  projectId: z.string().trim().min(1).max(200).nullable().optional(), category: z.string().trim().max(120).nullable().optional(),
  sourceKind: z.enum(['BOARD_RESOLUTION', 'POWER_OF_ATTORNEY', 'DELEGATION_LETTER', 'CONTRACT_CLAUSE', 'INTERNAL_POLICY_DOCUMENT', 'BYLAWS']),
  sourceReference: z.string().trim().min(2).max(300), justification: z.string().trim().min(3).max(1000),
  effectiveFrom: date.nullable().optional(), effectiveUntil: date.nullable().optional(),
}).refine((a) => (a.granteeKind === 'ROLE' ? Boolean(a.granteeRoleId) : Boolean(a.granteeUserId)), 'Indique o papel ou a pessoa.');

export const requisitionSchema = z.discriminatedUnion('source', [
  z.object({ source: z.literal('SHORTAGE'), requirementIds: z.array(uuid).min(1).max(200),
    deliveryLocationId: uuid.nullable().optional(), priority: z.enum(['low', 'medium', 'high', 'critical']).optional(),
    justification: z.string().trim().max(1000).nullable().optional(), idempotencyKey: key }),
  z.object({ source: z.literal('MANUAL'), justification: z.string().trim().min(10).max(1000),
    projectId: z.string().trim().min(1).max(200).nullable().optional(), requiredBy: date.nullable().optional(),
    deliveryLocationId: uuid.nullable().optional(), priority: z.enum(['low', 'medium', 'high', 'critical']).optional(),
    idempotencyKey: key,
    lines: z.array(z.object({ itemId: uuid, quantity: positive, estimatedUnitPrice: money.nullable().optional(),
      note: z.string().trim().max(500).nullable().optional() })).min(1).max(100) }),
]);

export const rfqSchema = z.object({
  requisitionLineIds: z.array(uuid).min(1).max(200), supplierIds: z.array(uuid).min(1).max(30),
  responseDue: date.nullable().optional(), note: z.string().trim().max(1000).nullable().optional(),
});

export const rfqActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('quote'), supplierId: uuid, currency: z.string().regex(/^[A-Z]{3}$/).default('BRL'),
    freightAmount: money.optional(), taxAmount: money.optional(), paymentTerms: z.string().trim().max(200).nullable().optional(),
    validityDate: date.nullable().optional(), leadTimeDays: z.coerce.number().int().min(0).max(3650).nullable().optional(),
    deviations: z.string().trim().max(2000).nullable().optional(),
    lines: z.array(z.object({ rfqLineId: uuid, unitPrice: money, quantity: positive.optional(),
      leadTimeDays: z.coerce.number().int().min(0).max(3650).nullable().optional(), compliant: z.boolean().optional(),
      note: z.string().trim().max(500).nullable().optional() })).min(1).max(200) }),
  z.object({ action: z.literal('decide'), quoteId: uuid, recommendedQuoteId: uuid.nullable().optional(),
    rationale: z.string().trim().min(10).max(2000), comparison: z.record(z.string(), z.unknown()).optional() }),
]);

export const purchaseOrderActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('update'), deliveryLocationId: uuid.nullable().optional(), expectedDelivery: date.nullable().optional(),
    paymentTerms: z.string().trim().max(200).nullable().optional() }),
  z.object({ action: z.literal('submit'), note: z.string().trim().max(1000).nullable().optional() }),
  z.object({ action: z.literal('approve'), note: z.string().trim().max(1000).nullable().optional() }),
  z.object({ action: z.literal('reject'), note: z.string().trim().min(3).max(1000) }),
  z.object({ action: z.literal('sync') }),
  z.object({ action: z.literal('issue') }),
  z.object({ action: z.literal('cancel'), reason }),
  z.object({ action: z.literal('close'), reason: z.string().trim().max(500).optional() }),
]);

// ── Recebimento & logística (235) ─────────────────────────────────────────
export const receiptSchema = z.object({
  purchaseOrderId: uuid, locationId: uuid.nullable().optional(), shipmentId: uuid.nullable().optional(),
  note: z.string().trim().max(1000).nullable().optional(), discrepancyReason: z.string().trim().max(1000).nullable().optional(),
  idempotencyKey: key,
  lines: z.array(z.object({
    poLineId: uuid, acceptedQuantity: z.coerce.number().finite().min(0).default(0),
    rejectedQuantity: z.coerce.number().finite().min(0).default(0),
    rejectionReason: z.string().trim().max(500).nullable().optional(), lotCode: lot,
    serials: z.array(z.string().trim().min(1).max(120)).max(1000).optional(),
  }).refine((l) => l.acceptedQuantity + l.rejectedQuantity > 0, 'Informe o recebido ou o rejeitado da linha.')
    .refine((l) => l.rejectedQuantity === 0 || (l.rejectionReason ?? '').length >= 3, 'Quantidade rejeitada exige motivo.'))
    .min(1).max(200),
});

export const inspectionSchema = z.object({
  destinationLocationId: uuid.nullable().optional(), reason: z.string().trim().max(1000).nullable().optional(),
  lines: z.array(z.object({
    lineId: uuid, approvedQuantity: z.coerce.number().finite().min(0).optional(), rejectedQuantity: z.coerce.number().finite().min(0).optional(),
    approvedSerials: z.array(z.string().trim().min(1)).optional(), rejectedSerials: z.array(z.string().trim().min(1)).optional(),
  })).min(1).max(200),
});

export const shipmentSchema = z.object({
  id: uuid.optional(), purchaseOrderId: uuid.optional(),
  status: z.enum(['EXPECTED', 'IN_TRANSIT', 'ARRIVED', 'CANCELLED']).optional(),
  destinationLocationId: uuid.nullable().optional(), carrier: z.string().trim().max(200).nullable().optional(),
  vehicle: z.string().trim().max(60).nullable().optional(), trackingRef: z.string().trim().max(200).nullable().optional(),
  eta: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(), note: z.string().trim().max(1000).nullable().optional(),
  reason: z.string().trim().max(500).optional(),
}).refine((s) => s.id || s.purchaseOrderId, 'Informe o embarque ou o pedido.')
  .refine((s) => s.status !== 'CANCELLED' || (s.reason ?? '').length >= 3, 'Cancelar embarque exige motivo.');

export const EVIDENCE_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf'] as const;
export const MAX_EVIDENCE_BYTES = 15 * 1024 * 1024;
export const evidenceSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('authorize'), fileName: z.string().trim().min(1).max(200), mimeType: z.enum(EVIDENCE_MIME),
    fileSize: z.number().int().positive().max(MAX_EVIDENCE_BYTES) }),
  z.object({ action: z.literal('register'), path: z.string().min(10).max(500), fileName: z.string().trim().min(1).max(200),
    mimeType: z.enum(EVIDENCE_MIME) }),
]);
