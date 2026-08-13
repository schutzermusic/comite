import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { resolvePayrollActor } from '@/lib/payroll/repository/actor';
import { hashCpf, hasCertKey } from '@/lib/esocial/connector/secrets';
import { readSstEvents } from '@/lib/esocial/connector/store';
import { normalizePayrollName } from '@/lib/workforce/salary-history';
import {
  extractAso,
  isWeakExtraction,
  reconcileWithEsocial,
  type AsoExtraction,
  type EsocialAsoFacts,
} from '@/lib/workforce/aso-extractor';
import { AsoAiUnavailableError, extractAsoWithAi } from '@/lib/workforce/aso-ai-extractor';
import {
  AsoSchemaMissingError,
  findByChecksum,
  insertAsoDocument,
  listAsoDocuments,
  signAsoFile,
  removeAsoFile,
  uploadAsoFile,
  type AsoDocumentRow,
} from '@/lib/workforce/aso-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const MAX_FILE_BYTES = 20 * 1024 * 1024;

/**
 * Texto do PDF via pdfjs (build legacy, import dinâmico — mesmo caminho do
 * importador de cronograma). Um ASO escaneado devolve string vazia, e é
 * exatamente esse caso que aciona a leitura por IA.
 */
async function extractPdfText(buffer: Buffer): Promise<string> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = pdfjs.getDocument({
    data: new Uint8Array(buffer),
    useWorkerFetch: false,
    useSystemFonts: true,
  });
  const doc = await task.promise;
  const parts: string[] = [];
  try {
    for (let p = 1; p <= doc.numPages; p += 1) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      const line = content.items
        .map((item) => ('str' in item && typeof item.str === 'string' ? item.str : ''))
        .join(' ');
      parts.push(line);
    }
  } finally {
    await task.destroy();
  }
  return parts.join('\n');
}

/**
 * GET — documentos da organização, com URL assinada de curta duração.
 *
 * Exige dado sensível: ASO é informação de saúde, e a régua é a mesma da
 * tabela `esocial_sst_events`.
 */
export async function GET() {
  const guard = await resolveSensitiveActor();
  if (!guard.ok) return guard.response;

  try {
    const rows = await listAsoDocuments(guard.organizationId);
    const documents = await Promise.all(
      rows.map(async (row) => ({
        ...row,
        // Assinada na leitura e válida por minutos: o bucket continua privado
        // e nenhum link sobrevive ao fechamento da tela.
        signedUrl: await signAsoFile(row.object_path, 300),
      })),
    );
    return NextResponse.json({ ok: true, available: true, documents });
  } catch (err) {
    if (err instanceof AsoSchemaMissingError) {
      return NextResponse.json({ ok: true, available: false, documents: [], message: err.message });
    }
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Erro ao listar ASOs' },
      { status: 500 },
    );
  }
}

/**
 * POST — envia um ou mais PDFs de ASO.
 *
 * O pipeline por arquivo é: extrair texto → ler determinístico → cair para IA
 * se a leitura for fraca → casar com a pessoa → conferir com o S-2220 →
 * gravar. Uma falha em um arquivo não derruba o lote: o resultado é por
 * arquivo, para que o RH veja exatamente qual não passou e por quê.
 */
export async function POST(req: Request) {
  const guard = await resolveSensitiveActor();
  if (!guard.ok) return guard.response;
  const { organizationId, userId } = guard;

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ ok: false, error: 'Envio inválido (esperado multipart).' }, { status: 400 });
  }

  const files = form.getAll('files').filter((f): f is File => f instanceof File);
  if (files.length === 0) {
    return NextResponse.json({ ok: false, error: 'Nenhum arquivo enviado.' }, { status: 400 });
  }

  // Uma vez por lote, e não por arquivo: as duas listas são as mesmas para
  // todos e relê-las por arquivo multiplicaria a consulta à toa.
  const [people, sstEvents] = await Promise.all([
    loadPeople(organizationId),
    loadEsocialExams(organizationId),
  ]);

  const results: {
    fileName: string;
    ok: boolean;
    documentId?: string;
    status?: AsoDocumentRow['status'];
    method?: string;
    message?: string;
  }[] = [];

  for (const file of files) {
    const fileName = file.name;
    try {
      if (file.size > MAX_FILE_BYTES) {
        results.push({ fileName, ok: false, message: 'Arquivo acima de 20 MB.' });
        continue;
      }
      if (!/\.pdf$/i.test(fileName) && file.type !== 'application/pdf') {
        results.push({ fileName, ok: false, message: 'Somente PDF é aceito.' });
        continue;
      }

      const bytes = Buffer.from(await file.arrayBuffer());
      const checksum = createHash('sha256').update(bytes).digest('hex');

      const existing = await findByChecksum(organizationId, checksum);
      if (existing) {
        results.push({
          fileName,
          ok: false,
          documentId: existing.id,
          message: 'Este arquivo já havia sido enviado — nada foi duplicado.',
        });
        continue;
      }

      // ── Leitura ──
      let extraction: AsoExtraction;
      let method: AsoDocumentRow['extraction_method'] = 'deterministic';
      let aiNote: string | undefined;

      const text = await extractPdfText(bytes).catch(() => '');
      extraction = extractAso(text);

      if (isWeakExtraction(extraction)) {
        // Escaneado ou layout fora do padrão: o PDF vai inteiro para a IA.
        try {
          const aiResult = await extractAsoWithAi(bytes);
          if (aiResult.confidence > extraction.confidence) {
            extraction = aiResult;
            method = 'ai';
          }
        } catch (err) {
          aiNote =
            err instanceof AsoAiUnavailableError
              ? 'Leitura por IA indisponível (ANTHROPIC_API_KEY ausente); ficou o que o extrator conseguiu ler.'
              : `Leitura por IA falhou: ${err instanceof Error ? err.message : 'erro'}`;
        }
      }

      // ── Vínculo com a pessoa ──
      const cpfHash = extraction.cpf && hasCertKey() ? hashCpf(extraction.cpf) : null;
      const nameKey = normalizePayrollName(extraction.workerName);
      const person =
        (nameKey ? people.find((p) => p.payroll_name_key === nameKey) : undefined) ?? null;

      // ── Conferência com o S-2220 ──
      const candidates = sstEvents.filter(
        (e) => (cpfHash && e.workerKey === cpfHash) || (person && e.personKey === person.id),
      );
      const reconciliation = reconcileWithEsocial(extraction, candidates.map((c) => c.facts));

      const objectPath = await uploadAsoFile(organizationId, fileName, bytes, 'application/pdf');

      const issues = [...extraction.issues];
      if (aiNote) issues.push({ field: 'extraction', reason: aiNote });
      if (!person) {
        issues.push({
          field: 'person',
          reason: 'Documento não vinculado a nenhuma pessoa do cadastro — vincule manualmente para que ele entre nos indicadores.',
        });
      }

      // Todo documento nasce PENDENTE DE REVISÃO, mesmo quando a leitura sai
      // perfeita. O que entra aqui é a validade legal de um exame de saúde;
      // aceitar automaticamente o que uma regex leu de um PDF seria transformar
      // uma leitura em fato sem ninguém ter conferido.
      const status: AsoDocumentRow['status'] = 'pending_review';

      try {
        const row = await insertAsoDocument({
          organization_id: organizationId,
          person_id: person?.id ?? null,
          worker_cpf_hash: cpfHash,
          worker_name_raw: extraction.workerName ?? null,
          file_name: fileName,
          storage_bucket: 'aso-documents',
          object_path: objectPath,
          mime_type: 'application/pdf',
          file_size: bytes.length,
          checksum,
          exam_date: extraction.examDate ?? null,
          exam_kind: extraction.examKind ?? null,
          exam_result: extraction.result ?? null,
          valid_until: extraction.validUntil ?? null,
          validity_basis: extraction.validityBasis,
          doctor_name: extraction.doctorName ?? null,
          doctor_crm: extraction.doctorCrm ?? null,
          company_name: extraction.companyName ?? null,
          extraction_method: method,
          extraction_confidence: extraction.confidence,
          extraction_issues: issues,
          esocial_event_id: reconciliation.eventId,
          match_status: reconciliation.matchStatus,
          divergences: reconciliation.divergences,
          status,
          reviewed_by: null,
          reviewed_at: null,
          notes: null,
          uploaded_by: userId,
        });

        results.push({ fileName, ok: true, documentId: row.id, status: row.status, method });
      } catch (err) {
        // O arquivo já subiu; sem linha ele viraria lixo órfão no bucket.
        await removeAsoFile(objectPath).catch(() => undefined);
        throw err;
      }
    } catch (err) {
      if (err instanceof AsoSchemaMissingError) {
        return NextResponse.json({ ok: false, available: false, error: err.message }, { status: 409 });
      }
      results.push({
        fileName,
        ok: false,
        message: err instanceof Error ? err.message : 'Falha ao processar o arquivo.',
      });
    }
  }

  return NextResponse.json({ ok: true, results });
}

/** ASO é dado de saúde: exige permissão de dado sensível, não `people.view`. */
async function resolveSensitiveActor(): Promise<
  { ok: true; organizationId: string; userId: string } | { ok: false; response: NextResponse }
> {
  const r = await resolvePayrollActor('people.view_sensitive_data');
  if (r.ok) return { ok: true, organizationId: r.actor.organizationId, userId: r.actor.userId };

  const alt = await resolvePayrollActor('people.payroll_view_sensitive');
  if (alt.ok) return { ok: true, organizationId: alt.actor.organizationId, userId: alt.actor.userId };

  return { ok: false, response: r.response };
}

async function loadPeople(organizationId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from('people')
    .select('id, full_name, payroll_name_key')
    .eq('organization_id', organizationId);
  return (data ?? []).map((p) => ({
    id: String(p.id),
    full_name: String(p.full_name),
    payroll_name_key: p.payroll_name_key ? String(p.payroll_name_key) : null,
  }));
}

/** Exames do eSocial, no formato que a conferência consome. */
async function loadEsocialExams(
  organizationId: string,
): Promise<{ workerKey: string | null; personKey: string | null; facts: EsocialAsoFacts }[]> {
  try {
    const rows = await readSstEvents(organizationId, { eventType: 'S-2220' });
    return rows.map((r) => ({
      workerKey: r.worker_cpf_hash,
      personKey: null,
      facts: {
        eventId: r.esocial_event_id,
        examDate: r.event_date,
        examKind: r.exam_kind,
        result: r.exam_result,
      },
    }));
  } catch {
    // Base sem a migration 084: o documento entra sem conferência, que é o
    // estado honesto — e não um erro que impede o upload.
    return [];
  }
}

