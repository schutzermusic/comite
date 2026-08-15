import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import { resolvePayrollActor } from '@/lib/payroll/repository/actor';
import { extractPayslipPdf } from '@/lib/esocial/connector/payslip-pdf';
import { importPayslipLines } from '@/lib/esocial/connector/payslip-store';
import { esocialErrorResponse } from '@/lib/esocial/connector/api-errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const MAX_FILE_BYTES = 20 * 1024 * 1024;

export async function POST(req: Request) {
  const actor = await resolvePayrollActor('admin.manage_integrations');
  if (!actor.ok) return actor.response;
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ ok: false, error: 'Envie os PDFs como multipart/form-data.' }, { status: 400 });
  }
  const files = form.getAll('files').filter((file): file is File => file instanceof File && file.size > 0);
  if (files.length === 0) return NextResponse.json({ ok: false, error: 'Nenhum PDF enviado.' }, { status: 400 });

  const results = [];
  try {
    for (const file of files) {
      if (!/\.pdf$/i.test(file.name) || file.size > MAX_FILE_BYTES) {
        throw new Error(`"${file.name}": envie um PDF de até 20 MB.`);
      }
      const bytes = Buffer.from(await file.arrayBuffer());
      const parsed = await extractPayslipPdf(bytes);
      const stored = await importPayslipLines({
        organizationId: actor.actor.organizationId,
        userId: actor.actor.userId,
        fileName: file.name,
        checksum: createHash('sha256').update(bytes).digest('hex'),
        pageCount: parsed.pages,
        lines: parsed.lines,
      });
      results.push({
        fileName: file.name,
        pages: parsed.pages,
        lines: parsed.lines.length,
        duplicated: stored.duplicated,
        competences: stored.competences,
      });
    }
    return NextResponse.json({ ok: true, results });
  } catch (error) {
    return esocialErrorResponse(error, 'Falha ao importar contracheque PDF.');
  }
}
