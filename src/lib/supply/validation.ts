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
