import { NextResponse } from 'next/server';
import { z } from 'zod';
import { resolveObligationActor, obligationApiError } from '@/lib/contracts/obligations/server/actor';
import { createObligationDefinition, loadContractObligationsAsOf } from '@/lib/contracts/obligations/server/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Obrigações de um contrato NA DATA pedida.
 *
 * `asOf` é parâmetro e não "hoje" implícito: a mesma pergunta feita para
 * ontem e para hoje tem respostas diferentes, e é essa a graça de um modelo
 * temporal. Sem o parâmetro, usamos a data de hoje do servidor e a devolvemos
 * na resposta, para que quem lê saiba a data que foi usada.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await resolveObligationActor('contracts.view');
  if (!auth.ok) return auth.response;
  const { id } = await params;
  try {
    const asOf = new URL(req.url).searchParams.get('asOf') ?? new Date().toISOString().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) {
      return NextResponse.json({ ok: false, error: 'asOf deve ser uma data YYYY-MM-DD.' }, { status: 400 });
    }
    return NextResponse.json({ ok: true, ...(await loadContractObligationsAsOf(auth.actor.organizationId, id, asOf)) });
  } catch (error) {
    return obligationApiError(error, 'Falha ao resolver obrigações do contrato.');
  }
}

const partySchema = z.object({
  role: z.enum(['obligor', 'beneficiary', 'recipient', 'verifier', 'guarantor', 'insurer', 'other']),
  // Identidade canônica OU texto. Nunca casamento por semelhança de nome.
  partyId: z.string().uuid().optional(),
  partyText: z.string().trim().min(2).max(300).optional(),
}).refine((v) => v.partyId || v.partyText, 'Informe a Party canônica ou o texto do contrato.');

const schema = z.object({
  title: z.string().trim().min(3).max(300),
  requirementText: z.string().trim().max(4000).optional(),
  category: z.string().trim().max(100).optional(),
  responsibleSide: z.enum(['contracting_organization', 'counterparty', 'supplier', 'third_party', 'shared', 'unknown']).optional(),
  sourceClauseId: z.string().uuid().optional(),
  sourceAmendmentId: z.string().uuid().optional(),
  sourceDocumentId: z.string().uuid().optional(),
  sourcePage: z.number().int().positive().optional(),
  sourceExcerpt: z.string().trim().max(2000).optional(),
  effectiveFrom: z.iso.date().optional(),
  effectiveTo: z.iso.date().optional(),
  predecessorId: z.string().uuid().optional(),
  changeEffect: z.enum(['added', 'altered', 'removed']).optional(),
  activationKind: z.enum(['contract_start', 'days_after_contract_start', 'days_before_contract_end',
    'fixed_date', 'manual', 'external_event', 'unspecified']).optional(),
  activationOffsetDays: z.number().int().optional(),
  activationFixedDate: z.iso.date().optional(),
  activationEventText: z.string().trim().max(500).optional(),
  dueKind: z.enum(['fixed_date', 'days_after_activation', 'days_before_contract_end',
    'same_day_as_activation', 'recurring', 'unspecified']).optional(),
  dueOffsetDays: z.number().int().optional(),
  dueFixedDate: z.iso.date().optional(),
  calendarBasis: z.enum(['calendar_days', 'business_days', 'unspecified']).optional(),
  recurrenceKind: z.enum(['one_time', 'daily', 'weekly', 'monthly', 'quarterly', 'yearly', 'fixed_interval', 'custom']).optional(),
  recurrenceInterval: z.number().int().positive().optional(),
  recurrenceUntil: z.iso.date().optional(),
  // `null` explícito é DESCONHECIDO; ausente também. Só `false` afirma que não bloqueia.
  blocksBilling: z.boolean().nullable().optional(),
  parties: z.array(partySchema).max(20).optional(),
}).refine((v) => v.sourceClauseId || v.sourceAmendmentId || v.sourceDocumentId,
  'Toda obrigação precisa de pelo menos uma origem: cláusula, aditivo ou documento.');

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await resolveObligationActor('contracts.edit');
  if (!auth.ok) return auth.response;
  const { id } = await params;
  try {
    const input = schema.parse(await req.json());
    const definition = await createObligationDefinition(auth.actor, { ...input, contractId: id });
    return NextResponse.json({ ok: true, definition }, { status: 201 });
  } catch (error) {
    return obligationApiError(error, 'Falha ao registrar obrigação.');
  }
}
