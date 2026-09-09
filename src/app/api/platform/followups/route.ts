import { NextResponse } from 'next/server';
import { z } from 'zod';
import { resolveFollowupActor, followupApiError } from '@/lib/platform/followups/server/actor';
import { createFollowup, listFollowups } from '@/lib/platform/followups/server/store';

export const runtime = 'nodejs';

const SOURCE_KINDS = [
  'contract', 'contract_clause', 'contract_obligation_instance',
  'contract_billing_condition', 'contract_risk', 'contract_guarantee',
  'contract_insurance_requirement',
] as const;

const createSchema = z.object({
  sourceKind: z.enum(SOURCE_KINDS),
  sourceId: z.string().uuid(),
  contractId: z.string().uuid().nullish(),
  goal: z.string().trim().min(1).max(500),
  expectedEvidence: z.string().trim().max(1000).nullish(),
  responsibleUserId: z.string().uuid().nullish(),
  responsiblePartyId: z.string().uuid().nullish(),
  responsibleText: z.string().trim().max(200).nullish(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  cadenceDays: z.number().int().positive().max(365).nullish(),
  escalateAfterDays: z.number().int().positive().max(365).nullish(),
  escalationTargetUserId: z.string().uuid().nullish(),
  verificationMode: z.enum(['deterministic_evidence', 'human_confirmation']).optional(),
  verificationRule: z.record(z.string(), z.unknown()).nullish(),
});

export async function GET(req: Request) {
  const auth = await resolveFollowupActor('contracts.view');
  if (!auth.ok) return auth.response;
  const url = new URL(req.url);
  try {
    const rows = await listFollowups(auth.actor, {
      contractId: url.searchParams.get('contractId') ?? undefined,
      sourceId: url.searchParams.get('sourceId') ?? undefined,
      openOnly: url.searchParams.get('open') === '1',
    });
    return NextResponse.json({ ok: true, followups: rows });
  } catch (error) {
    return followupApiError(error, 'Falha ao listar acompanhamentos.');
  }
}

export async function POST(req: Request) {
  const auth = await resolveFollowupActor('contracts.edit');
  if (!auth.ok) return auth.response;
  try {
    const input = createSchema.parse(await req.json());
    const followup = await createFollowup(auth.actor, input);
    return NextResponse.json({ ok: true, followup });
  } catch (error) {
    return followupApiError(error, 'Falha ao abrir acompanhamento.');
  }
}
