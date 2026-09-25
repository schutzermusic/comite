import { NextResponse } from 'next/server';
import { resolvePayrollActor } from '@/lib/payroll/repository/actor';
import { getServerRepository } from '@/lib/payroll/repository';
import { generatePayrollNarrative } from '@/lib/ai/payroll/payroll-narrative';
import { generateBatchArtifacts } from '@/lib/payroll/generated-artifacts-server';
import { factsSignature } from '@/lib/payroll/email-intent';
import type { PayrollParseResult } from '@/lib/types/payroll-closing';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Generates the payroll closing narrative. The model never sees a raw
 * spreadsheet — only parsed numbers — and falls back to a deterministic
 * template when AI is unavailable.
 *
 * With `batch_id` (the closing flow): the numbers come from the batch AS
 * STORED, the narrative is persisted server-side, and the executive report +
 * dashboard attachments are generated here — the e-mail later uses exactly
 * these, never browser-built HTML. Without it: legacy preview from `parse`,
 * nothing persisted.
 */
export async function POST(req: Request) {
  const guard = await resolvePayrollActor('people.payroll_close');
  if (!guard.ok) return guard.response;

  let body: { parse?: PayrollParseResult; batch_id?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: 'JSON inválido.' }, { status: 400 });
  }

  try {
    if (body.batch_id !== undefined) {
      if (typeof body.batch_id !== 'string' || !UUID.test(body.batch_id)) {
        return NextResponse.json({ ok: false, error: 'batch_id inválido.' }, { status: 400 });
      }
      const repo = getServerRepository();
      const facts = await repo.getEmailFacts(guard.actor, body.batch_id);
      if (!facts) return NextResponse.json({ ok: false, error: 'Fechamento não encontrado nesta organização.' }, { status: 404 });
      const narrative = await generatePayrollNarrative(facts.parse, guard.actor.organizationId);
      // A IA leva segundos; se os números mudaram enquanto isso, esta narrativa
      // descreve números que não existem mais — não é guardada.
      const now = await repo.getEmailFacts(guard.actor, body.batch_id);
      if (!now || factsSignature(now.parse) !== factsSignature(facts.parse)) {
        return NextResponse.json({ ok: false, error: 'Os números do fechamento mudaram durante a análise — gere de novo.' }, { status: 409 });
      }
      await repo.saveNarrative(guard.actor, facts.batch.id, narrative);
      const attachments = await generateBatchArtifacts(repo, guard.actor, { ...now, narrative });
      return NextResponse.json({ ok: true, narrative, attachments });
    }

    if (!body?.parse || typeof body.parse.total_amount_cents !== 'number') {
      return NextResponse.json({ ok: false, error: 'Payload inválido: parse ausente.' }, { status: 400 });
    }
    const narrative = await generatePayrollNarrative(body.parse, guard.actor.organizationId);
    return NextResponse.json({ ok: true, narrative });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro inesperado';
    console.error('[api/payroll/ai/analyze] error:', message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
