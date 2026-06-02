import { NextResponse } from 'next/server';
import { resolvePayrollActor } from '@/lib/payroll/repository/actor';
import { getServerRepository } from '@/lib/payroll/repository';
import type { PayrollImportFileType } from '@/lib/types/payroll-closing';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const VALID_TYPES: PayrollImportFileType[] = [
  'payroll_spreadsheet', 'bank_payment_spreadsheet', 'holerite', 'external_holerite', 'supporting_document',
];
const MAX_BYTES = 50 * 1024 * 1024;

/**
 * POST /api/payroll/batches/[id]/files — multipart upload.
 * Fields: file (Blob), file_type. Persists to the right secure bucket and
 * creates the import-file + attachment rows. Service role only on the server.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const r = await resolvePayrollActor('people.payroll_close');
  if (!r.ok) return r.response;

  let form: FormData;
  try {
    form = await req.formData();
  } catch (err) {
    // Surface the real reason. In `next dev --turbopack` the request body is
    // capped (~10MB), so a single very large file fails here — the message makes
    // that diagnosable instead of a generic "Form inválido".
    const detail = err instanceof Error ? err.message : 'corpo inválido';
    console.error('[batches/files] formData parse failed:', detail);
    return NextResponse.json(
      { ok: false, error: 'Form inválido.', message: `Falha ao ler o upload: ${detail}` },
      { status: 400 },
    );
  }
  const file = form.get('file');
  const fileType = String(form.get('file_type') ?? '') as PayrollImportFileType;
  if (!(file instanceof Blob)) return NextResponse.json({ ok: false, error: 'Arquivo ausente.' }, { status: 400 });
  if (!VALID_TYPES.includes(fileType)) return NextResponse.json({ ok: false, error: 'file_type inválido.' }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ ok: false, error: 'Arquivo excede 50MB.' }, { status: 413 });

  const fileName = (form.get('file_name') as string | null) || (file as File).name || 'arquivo';
  try {
    const bytes = Buffer.from(await file.arrayBuffer());
    const result = await getServerRepository().addImportFile(r.actor, id, {
      bytes, file_name: fileName, file_type: fileType, mime_type: file.type || 'application/octet-stream',
    });
    return NextResponse.json({ ok: true, importFile: result.importFile, attachment: result.attachment });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : 'Erro' }, { status: 500 });
  }
}

/**
 * DELETE /api/payroll/batches/[id]/files?attachment_id=... — remove one uploaded
 * attachment (Storage object + row + email-package references). Requires
 * people.payroll_close. The client invalidates the parse when the removed file
 * was the main payroll spreadsheet.
 */
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const r = await resolvePayrollActor('people.payroll_close');
  if (!r.ok) return r.response;
  const attachmentId = new URL(req.url).searchParams.get('attachment_id');
  if (!attachmentId) return NextResponse.json({ ok: false, error: 'attachment_id é obrigatório.' }, { status: 400 });
  try {
    const result = await getServerRepository().removeAttachment(r.actor, id, attachmentId);
    return NextResponse.json(result, { status: result.ok ? 200 : 404 });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : 'Erro' }, { status: 500 });
  }
}
