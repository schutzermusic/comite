import { NextResponse } from 'next/server';
import { requireApiPermission } from '@/lib/auth/api-guard';
import { generatePayrollNarrative } from '@/lib/ai/payroll/payroll-narrative';
import type { PayrollParseResult } from '@/lib/types/payroll-closing';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Generates the payroll closing narrative. Receives ONLY the already-parsed
 * numbers (PayrollParseResult) — never a raw spreadsheet — so the model cannot
 * invent values. Falls back to a deterministic template when no API key is set.
 */
export async function POST(req: Request) {
  const guard = await requireApiPermission('people.payroll_close');
  if (!guard.ok) return guard.response;

  let parse: PayrollParseResult;
  try {
    const body = (await req.json()) as { parse?: PayrollParseResult };
    if (!body?.parse || typeof body.parse.total_amount_cents !== 'number') {
      return NextResponse.json({ ok: false, error: 'Payload inválido: parse ausente.' }, { status: 400 });
    }
    parse = body.parse;
  } catch {
    return NextResponse.json({ ok: false, error: 'JSON inválido.' }, { status: 400 });
  }

  try {
    const narrative = await generatePayrollNarrative(parse);
    return NextResponse.json({ ok: true, narrative });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro inesperado';
    console.error('[api/payroll/ai/analyze] error:', message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
