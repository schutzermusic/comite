import { NextResponse } from 'next/server';
import { requireApiPermission } from '@/lib/auth/api-guard';
import { createClient } from '@/utils/supabase/server';
import { dispatchMeasurementHandoff } from '@/lib/projects/measurements/handoff-server';
import { HANDOFFS, type HandoffEvent } from '@/lib/projects/measurements/handoff';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/projects/measurements/[id]/handoff
 *
 * ─── O que esta rota é ────────────────────────────────────────────────────
 *
 * A entrega do aviso de um handoff que JÁ ACONTECEU. Ela não pratica o ato: a
 * transição é da RPC governada, e esta rota só conta a quem precisa saber.
 *
 * A separação é deliberada. Emitir o aviso dentro da transação da transição
 * faria uma falha do provedor de e-mail derrubar um aceite registrado — e um
 * aceite que sumiu porque o e-mail caiu é o pior desfecho possível. O fato é
 * durável; o aviso é reentregável, e o registro de entrega diz quem já recebeu.
 *
 * ─── Por que a rota confere o ESTADO antes de avisar ──────────────────────
 *
 * Porque um aviso é uma afirmação. "Aceite da contratante registrado" enviado
 * sobre uma medição que não está aceita é exatamente a fabricação que o plano
 * proíbe — e seria fácil de produzir com uma chamada solta.
 */

/**
 * O estado que cada handoff EXIGE da medição para poder ser afirmado.
 *
 * `null` = o aviso não afirma estado (pendência de evidência, lembrete de SLA),
 * e aí não há o que conferir.
 */
const REQUIRED_STATUS: Record<HandoffEvent, readonly string[] | null> = {
  'evidence.pending_detected': null,
  'measurement.submitted_for_review': ['SUBMITTED'],
  'measurement.correction_requested': ['RETURNED_FOR_CORRECTION'],
  'measurement.resubmitted': ['SUBMITTED'],
  'measurement.approved_for_customer': ['APPROVED_FOR_CUSTOMER'],
  'measurement.sent_to_customer': ['AWAITING_CUSTOMER_ACCEPTANCE'],
  'measurement.customer_correction_requested': ['CUSTOMER_CORRECTION_REQUESTED'],
  'measurement.accepted': ['ACCEPTED'],
  'measurement.billing_eligible': ['ACCEPTED'],
  'measurement.invoice_due': ['ACCEPTED'],
  'sla.reminder': null,
};

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  /*
    O portão é o de LEITURA de medição, e não o de edição, porque avisar não é
    mudar nada. Quem pode ver a medição pode contar a quem responde por ela que
    ela mudou — e quem não pode vê-la não descobre por aqui que ela existe: a
    leitura abaixo passa pela RLS.
  */
  const guard = await requireApiPermission('projects.measurements.view', { allowAdmin: true });
  if (!guard.ok) return guard.response;

  const { id: measurementId } = await ctx.params;
  let body: { event?: string; reason?: string | null; round?: number | string | null; test?: boolean } = {};
  try { body = (await req.json()) as typeof body; } catch { /* corpo vazio */ }

  const event = body.event as HandoffEvent | undefined;
  if (!event || !(event in HANDOFFS)) {
    return NextResponse.json(
      { ok: false, error: 'Handoff desconhecido.', known: Object.keys(HANDOFFS) },
      { status: 400 });
  }

  const supabase = await createClient();
  const { data: m, error } = await supabase
    .from('project_measurements')
    .select('id, status')
    .eq('id', measurementId)
    .maybeSingle();
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  // Mesma resposta para "de outra organização" e "não existe": duas respostas
  // diferentes contariam a quem tem um UUID se aquela medição existe alhures.
  if (!m) return NextResponse.json({ ok: false, error: 'Medição não encontrada.' }, { status: 404 });

  const required = REQUIRED_STATUS[event];
  if (required && !required.includes(m.status as string)) {
    return NextResponse.json({
      ok: false,
      error: `Este aviso afirma um estado que a medição não tem (atual: ${m.status}).`,
      code: 'STATE_MISMATCH',
    }, { status: 409 });
  }

  try {
    const summary = await dispatchMeasurementHandoff(measurementId, event, {
      reason: body.reason ?? null,
      round: body.round ?? null,
      test: body.test,
    });
    return NextResponse.json({
      ok: true,
      event: summary.event,
      handoff_key: summary.handoffKey,
      in_app: summary.inApp,
      emails_sent: summary.emailsSent,
      emails_simulated: summary.emailsSimulated,
      skipped_already_notified: summary.skippedAlreadyNotified,
      failures: summary.failures,
      // A resposta DIZ quem não tinha responsável. Relatar sucesso sobre um
      // aviso sem destinatário é como um handoff se perde em silêncio.
      undefined_responsible: summary.undefinedRoles,
      fallback_queue: summary.fallbackQueue,
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : 'Erro inesperado.' },
      { status: 500 });
  }
}
