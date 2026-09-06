import { NextResponse } from 'next/server';
import { z } from 'zod';
import { resolveObligationActor, obligationApiError } from '@/lib/contracts/obligations/server/actor';
import { recordObligationException } from '@/lib/contracts/obligations/server/store';

export const runtime = 'nodejs';

const schema = z.object({
  contractId: z.string().uuid(),
  definitionId: z.string().uuid().optional(),
  instanceId: z.string().uuid().optional(),
  kind: z.enum(['waiver', 'exception']),
  reason: z.string().trim().min(10).max(2000),
  scope: z.enum(['definition', 'instance']),
  effectiveFrom: z.iso.date().optional(),
  effectiveTo: z.iso.date().optional(),
  // Sem autoridade PROVADA a dispensa é registrada, mas não produz efeito.
  authorityReference: z.string().trim().max(500).optional(),
  sourceDocumentId: z.string().uuid().optional(),
  sourceAmendmentId: z.string().uuid().optional(),
  approvalState: z.enum(['not_required', 'pending']).optional(),
}).refine((v) => (v.scope === 'definition' ? Boolean(v.definitionId) : Boolean(v.instanceId)),
  'O alvo precisa corresponder ao escopo da dispensa.');

/** Dispensar exige aprovar contratos, não apenas editá-los. */
export async function POST(req: Request) {
  const auth = await resolveObligationActor('contracts.approve');
  if (!auth.ok) return auth.response;
  try {
    const input = schema.parse(await req.json());
    const exception = await recordObligationException(auth.actor, input);
    return NextResponse.json({ ok: true, exception }, { status: 201 });
  } catch (error) {
    return obligationApiError(error, 'Falha ao registrar dispensa.');
  }
}
