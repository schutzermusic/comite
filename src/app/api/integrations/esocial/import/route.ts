import { NextResponse } from 'next/server';
import { resolvePayrollActor } from '@/lib/payroll/repository/actor';
import { importEsocialPackage, type ImportFile } from '@/lib/esocial/connector/import';
import { esocialErrorResponse } from '@/lib/esocial/connector/api-errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * Teto por REQUISIÇÃO, não por importação: o navegador fatia a seleção em lotes
 * pequenos, então o histórico completo entra em várias chamadas. Este limite é
 * só a rede de segurança contra um corpo absurdo numa chamada avulsa.
 */
const MAX_TOTAL_BYTES = 25 * 1024 * 1024;

/**
 * Importa o pacote do eSocial Download (ZIP do portal, ou XMLs soltos).
 *
 * É o caminho de entrada dos dados do eSocial: não existe webservice para
 * recuperar eventos já transmitidos por competência, então o insumo é o arquivo
 * que o empregador baixa no portal.
 */
export async function POST(req: Request) {
  const r = await resolvePayrollActor('admin.manage_integrations');
  if (!r.ok) return r.response;

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ ok: false, error: 'Envie os arquivos como multipart/form-data.' }, { status: 400 });
  }

  const uploads = form.getAll('files').filter((f): f is File => f instanceof File && f.size > 0);
  if (uploads.length === 0) {
    return NextResponse.json({ ok: false, error: 'Nenhum arquivo enviado.' }, { status: 400 });
  }

  const totalBytes = uploads.reduce((s, f) => s + f.size, 0);
  if (totalBytes > MAX_TOTAL_BYTES) {
    return NextResponse.json(
      {
        ok: false,
        error:
          'Requisição acima de 25 MB. A tela envia em lotes automaticamente — ' +
          'se você chegou aqui por outro caminho, envie menos arquivos por chamada.',
      },
      { status: 413 },
    );
  }

  const invalid = uploads.find((f) => !/\.(zip|xml)$/i.test(f.name));
  if (invalid) {
    return NextResponse.json({ ok: false, error: `"${invalid.name}" não é .zip nem .xml.` }, { status: 400 });
  }

  const files: ImportFile[] = await Promise.all(
    uploads.map(async (f) => ({ name: f.name, content: Buffer.from(await f.arrayBuffer()) })),
  );

  try {
    const summary = await importEsocialPackage({
      organizationId: r.actor.organizationId,
      files,
      dryRun: form.get('dryRun') === 'true',
      triggeredBy: r.actor.userId,
    });
    return NextResponse.json({ ok: true, summary });
  } catch (err) {
    return esocialErrorResponse(err, 'Falha ao importar o pacote.');
  }
}
