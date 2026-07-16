import { NextResponse } from 'next/server';
import { requireApiPermission } from '@/lib/auth/api-guard';
import { generateWorkforceAdvice } from '@/lib/ai/workforce/workforce-advisor';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Generates an AI executive narrative + recommendations over a
 * deterministic workforce summary computed on the client
 * (workforce-intelligence.buildIntelligenceSummary). The summary is
 * passed in the body so the model never queries the DB directly.
 */
export async function POST(req: Request) {
  try {
    const guard = await requireApiPermission('people.ai_insights', { allowAdmin: true });
    if (!guard.ok) return guard.response;

    let body: { summary?: unknown } = {};
    try {
      body = (await req.json()) as { summary?: unknown };
    } catch {
      return NextResponse.json({ ok: false, error: 'Corpo inválido' }, { status: 400 });
    }
    if (!body.summary) {
      return NextResponse.json({ ok: false, error: 'Resumo ausente' }, { status: 400 });
    }

    const advice = await generateWorkforceAdvice(body.summary);
    return NextResponse.json({ ok: true, advice });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro inesperado';
    console.error('[api/ai/workforce-insights] error:', message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
