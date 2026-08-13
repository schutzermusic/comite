import { NextResponse } from 'next/server';
import { resolvePayrollActor } from '@/lib/payroll/repository/actor';
import { parsePtBrDate } from '@/lib/workforce/aso-extractor';
import {
  AsoSchemaMissingError,
  deleteAsoDocument,
  getAsoDocument,
  removeAsoFile,
  updateAsoDocument,
  type AsoDocumentRow,
} from '@/lib/workforce/aso-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * PATCH — curadoria humana do documento.
 *
 * Confirmar, rejeitar, corrigir um campo mal lido ou vincular a pessoa certa.
 * Toda correção manual marca `extraction_method = 'manual'`: depois que uma
 * pessoa mexeu no valor, ele não é mais leitura de máquina, e a tela precisa
 * dizer isso — inclusive porque uma reanálise não pode sobrescrever o que
 * alguém corrigiu à mão.
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const guard = await resolveSensitiveActor();
  if (!guard.ok) return guard.response;

  let body: {
    status?: AsoDocumentRow['status'];
    person_id?: string | null;
    exam_date?: string | null;
    exam_kind?: string | null;
    exam_result?: string | null;
    valid_until?: string | null;
    notes?: string | null;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'JSON inválido.' }, { status: 400 });
  }

  try {
    const current = await getAsoDocument(guard.organizationId, id);
    if (!current) return NextResponse.json({ ok: false, error: 'Não encontrado.' }, { status: 404 });

    const patch: Partial<AsoDocumentRow> = {};
    let touchedFields = false;

    if (body.status && ['pending_review', 'confirmed', 'rejected'].includes(body.status)) {
      patch.status = body.status;
      patch.reviewed_by = guard.userId;
      patch.reviewed_at = new Date().toISOString();
    }
    if (body.person_id !== undefined) {
      patch.person_id = body.person_id;
      touchedFields = true;
    }
    if (body.exam_date !== undefined) {
      patch.exam_date = normalizeDate(body.exam_date);
      touchedFields = true;
    }
    if (body.exam_kind !== undefined) {
      patch.exam_kind = body.exam_kind;
      touchedFields = true;
    }
    if (body.exam_result !== undefined) {
      patch.exam_result = body.exam_result;
      touchedFields = true;
    }
    if (body.valid_until !== undefined) {
      patch.valid_until = normalizeDate(body.valid_until);
      // Data digitada por uma pessoa a partir do papel é DECLARADA, não
      // inferida — é a mesma natureza da que estava escrita no documento.
      patch.validity_basis = patch.valid_until ? 'declared_document' : 'undetermined';
      touchedFields = true;
    }
    if (body.notes !== undefined) patch.notes = body.notes;

    if (touchedFields) patch.extraction_method = 'manual';

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ ok: false, error: 'Nada para atualizar.' }, { status: 400 });
    }

    const row = await updateAsoDocument(guard.organizationId, id, patch);
    return NextResponse.json({ ok: true, document: row });
  } catch (err) {
    if (err instanceof AsoSchemaMissingError) {
      return NextResponse.json({ ok: false, error: err.message }, { status: 409 });
    }
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Erro ao atualizar' },
      { status: 500 },
    );
  }
}

/** DELETE — remove a linha e o PDF. Exige `people.manage`. */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const r = await resolvePayrollActor('people.manage');
  if (!r.ok) return r.response;

  try {
    const current = await getAsoDocument(r.actor.organizationId, id);
    if (!current) return NextResponse.json({ ok: false, error: 'Não encontrado.' }, { status: 404 });

    await deleteAsoDocument(r.actor.organizationId, id);
    // O arquivo sai junto: um PDF de saúde órfão no bucket é passivo, não histórico.
    await removeAsoFile(current.object_path).catch(() => undefined);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Erro ao excluir' },
      { status: 500 },
    );
  }
}

/** Aceita ISO e dd/mm/aaaa — o RH digita nos dois formatos. */
function normalizeDate(value: string | null): string | null {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  return parsePtBrDate(value) ?? null;
}

async function resolveSensitiveActor(): Promise<
  { ok: true; organizationId: string; userId: string } | { ok: false; response: NextResponse }
> {
  const r = await resolvePayrollActor('people.view_sensitive_data');
  if (r.ok) return { ok: true, organizationId: r.actor.organizationId, userId: r.actor.userId };
  const alt = await resolvePayrollActor('people.payroll_view_sensitive');
  if (alt.ok) return { ok: true, organizationId: alt.actor.organizationId, userId: alt.actor.userId };
  return { ok: false, response: r.response };
}
