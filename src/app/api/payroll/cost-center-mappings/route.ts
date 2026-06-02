import { NextResponse } from 'next/server';
import { resolvePayrollActor } from '@/lib/payroll/repository/actor';
import { getServerRepository } from '@/lib/payroll/repository';
import { normalizeCostCenterName } from '@/lib/payroll/cost-center-mapping';
import type { UpsertCostCenterMappingInput } from '@/lib/payroll/repository/types';
import type { CostCenterMatchMethod } from '@/lib/types/payroll-closing';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RawMapping {
  imported_name: string;
  cost_center_id: string;
  confidence?: number;
  match_method?: CostCenterMatchMethod;
}

/** Normalize a raw client payload into a repository upsert input. */
function toInput(m: RawMapping): UpsertCostCenterMappingInput {
  return {
    imported_name: m.imported_name,
    normalized_name: normalizeCostCenterName(m.imported_name),
    cost_center_id: m.cost_center_id,
    confidence: m.confidence,
    match_method: m.match_method,
  };
}

/** GET /api/payroll/cost-center-mappings — list saved aliases for the org. */
export async function GET() {
  const r = await resolvePayrollActor('people.payroll_close');
  if (!r.ok) return r.response;
  try {
    const mappings = await getServerRepository().listCostCenterMappings(r.actor);
    return NextResponse.json({ ok: true, mappings });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : 'Erro' }, { status: 500 });
  }
}

/**
 * POST /api/payroll/cost-center-mappings — upsert one alias or many.
 * Body: { mapping: {...} } or { mappings: [{...}, ...] }.
 */
export async function POST(req: Request) {
  const r = await resolvePayrollActor('people.payroll_close');
  if (!r.ok) return r.response;

  let body: { mapping?: RawMapping; mappings?: RawMapping[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'JSON inválido.' }, { status: 400 });
  }

  const raw = body.mappings ?? (body.mapping ? [body.mapping] : []);
  const valid = raw.filter((m) => m.imported_name?.trim() && m.cost_center_id);
  if (valid.length === 0) {
    return NextResponse.json({ ok: false, error: 'Nenhum mapeamento válido informado.' }, { status: 400 });
  }

  try {
    const mappings = await getServerRepository().saveCostCenterMappings(r.actor, valid.map(toInput));
    return NextResponse.json({ ok: true, mappings });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : 'Erro' }, { status: 500 });
  }
}

/** DELETE /api/payroll/cost-center-mappings?id=<uuid> — remove an alias. */
export async function DELETE(req: Request) {
  const r = await resolvePayrollActor('people.payroll_close');
  if (!r.ok) return r.response;
  const id = new URL(req.url).searchParams.get('id');
  if (!id) return NextResponse.json({ ok: false, error: 'id é obrigatório.' }, { status: 400 });
  try {
    await getServerRepository().deleteCostCenterMapping(r.actor, id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : 'Erro' }, { status: 500 });
  }
}
