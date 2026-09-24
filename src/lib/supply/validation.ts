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
