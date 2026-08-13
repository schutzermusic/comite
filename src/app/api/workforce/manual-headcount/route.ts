import { NextResponse } from 'next/server';
import { resolvePayrollActor } from '@/lib/payroll/repository/actor';
import { requireApiPermission } from '@/lib/auth/api-guard';
import {
  deleteManualHeadcount,
  listManualHeadcount,
  saveManualHeadcount,
  ManualHeadcountValidationError,
} from '@/lib/workforce/manual-headcount';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Ajustes manuais de quadro por competência.
 *
 * Leitura acompanha o cockpit (`people.view`) — o número aparece nos
 * indicadores, então quem vê os indicadores precisa vê-lo. ESCRITA é restrita a
 * administrador: alterar o quadro de uma competência muda custo médio e
 * turnover do período, e o lançamento fica assinado.
 */
export async function GET() {
  const r = await resolvePayrollActor('people.view');
  if (!r.ok) return r.response;

  try {
    const rows = await listManualHeadcount(r.actor.organizationId);
    return NextResponse.json({ ok: true, adjustments: rows });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Falha ao ler ajustes.' },
      { status: 500 },
    );
  }
}

/** Só administrador — sem `allowAdmin` de conveniência, é o próprio requisito. */
async function requireAdmin() {
  return requireApiPermission('admin.manage_users', { allowAdmin: true });
}

export async function PUT(req: Request) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  const r = await resolvePayrollActor('people.view');
  if (!r.ok) return r.response;

  let body: { competence?: string; headcount?: number; sourceNote?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Corpo inválido.' }, { status: 400 });
  }

  try {
    await saveManualHeadcount(r.actor.organizationId, r.actor.userId, {
      competence: String(body.competence ?? ''),
      headcount: Number(body.headcount),
      sourceNote: String(body.sourceNote ?? ''),
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const status = err instanceof ManualHeadcountValidationError ? 400 : 500;
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Falha ao gravar.' },
      { status },
    );
  }
}

export async function DELETE(req: Request) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  const r = await resolvePayrollActor('people.view');
  if (!r.ok) return r.response;

  const competence = new URL(req.url).searchParams.get('competence');
  if (!competence) {
    return NextResponse.json({ ok: false, error: 'Informe a competência.' }, { status: 400 });
  }

  try {
    await deleteManualHeadcount(r.actor.organizationId, competence);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Falha ao remover.' },
      { status: 500 },
    );
  }
}
