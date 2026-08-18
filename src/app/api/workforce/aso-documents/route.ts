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
  type AsoExtractionMethod,
  type EsocialAsoFacts,
} from '@/lib/workforce/aso-extractor';
import { AsoAiUnavailableError, extractAsoWithAi } from '@/lib/workforce/aso-ai-extractor';
import {
  buildUploadTrail,
  fieldsFromExtraction,
  type AsoReviewStatus,
} from '@/lib/workforce/aso-review';
import {
  buildAsoReviewSummary,
  siblingsByPerson,
  siblingsFor,
  type AsoReviewSummary,
} from '@/lib/workforce/aso-summary';
import {
  ASO_BUCKET,
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
    // O mesmo portão que o servidor aplica na aprovação viaja para a tela, para
    // que o botão de confirmar nunca apareça onde o POST recusaria.
    const siblings = siblingsByPerson(rows);
    const documents = await Promise.all(
      rows.map(async (row) => ({
        ...row,
        // Assinada na leitura e válida por minutos: o bucket continua privado
        // e nenhum link sobrevive ao fechamento da tela.
        signedUrl: await signAsoFile(row.object_path, 300),
        // O resumo inteiro, e não só o veredito: é ele que a tela reabre para
        // conferência quando o RH decide olhar um documento antigo com calma.
        review: buildAsoReviewSummary(row, siblingsFor(row, siblings)),
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
 *
 * O QUE VOLTA, E POR QUE VOLTA TANTO
 *
 * Cada arquivo devolve um RESUMO DE CONFERÊNCIA completo — colaborador casado,
 * tipo, datas, resultado, médico, clínica, confiança e ressalvas — mais o
 * veredito do portão de aprovação. É o que permite ao RH confirmar o ASO na
 * mesma tela em que o enviou, em vez de guardar para uma fila que ele visitaria
 * dias depois, sem o PDF na cabeça.
 *
 * O que este endpoint NÃO faz, em nenhuma circunstância, é aprovar. Todo
 * documento nasce `pending`. A confirmação é uma segunda chamada, explícita, de
 * um usuário autenticado — ver o PATCH em `[id]/route.ts`.
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

  // Documentos já no acervo: entram para que o portão detecte um ASO enviado
  // agora que conflita com outro que já estava lá.
  const existingRows: AsoDocumentRow[] = await listAsoDocuments(organizationId).catch(() => []);

  const results: {
    fileName: string;
    ok: boolean;
    documentId?: string;
    status?: AsoReviewStatus;
    method?: AsoExtractionMethod;
    message?: string;
    /** Resumo de conferência — a base da confirmação imediata pelo RH. */
    review?: AsoReviewSummary;
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
      //
      // O arquivo já foi lido para memória e NÃO é alterado por nada daqui em
      // diante: a extração produz metadado ao lado, o original sobe intacto.
      let extraction: AsoExtraction;
      let method: AsoExtractionMethod = 'text_layer';
      let aiNote: string | undefined;

      const text = await extractPdfText(bytes).catch(() => '');
      extraction = extractAso(text);

      if (isWeakExtraction(extraction)) {
        // Escaneado ou layout fora do padrão: o PDF vai inteiro para a IA.
        try {
          const aiResult = await extractAsoWithAi(bytes);
          if (aiResult.confidence > extraction.confidence) {
            extraction = aiResult;
            method = 'ocr_ai';
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

      // ── Conferência OPCIONAL com o S-2220 ──
      //
      // Nada abaixo pode impedir o documento de entrar. Sem eventos, sem
      // migration 084 ou sem eSocial nenhum, `reconcileWithEsocial` devolve
      // `not_imported` e o ASO segue seu caminho normalmente.
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
      if (reconciliation.summary) {
        issues.push({ field: 'esocial', reason: reconciliation.summary });
      }

      // Todo documento nasce PENDENTE DE REVISÃO, mesmo quando a leitura sai
      // perfeita e mesmo quando o S-2220 confere. O que entra aqui é a validade
      // legal de um exame de saúde; aceitar automaticamente o que uma regex leu
      // de um PDF seria transformar uma leitura em fato sem ninguém conferir.
      const reviewStatus: AsoReviewStatus = 'pending';

      try {
        const row = await insertAsoDocument({
          organization_id: organizationId,
          person_id: person?.id ?? null,
          worker_cpf_hash: cpfHash,
          worker_name_raw: extraction.workerName ?? null,

          file_name: fileName,
          storage_bucket: ASO_BUCKET,
          object_path: objectPath,
          original_file_url: `${ASO_BUCKET}/${objectPath}`,
          mime_type: 'application/pdf',
          file_size: bytes.length,
          checksum,

          // Colunas planas = leitura vigente. Nascem iguais ao extraído; a
          // revisão as sobrepõe sem apagar `extracted_fields_json`.
          exam_date: extraction.examDate ?? null,
          exam_kind: extraction.examKind ?? null,
          exam_result: extraction.result ?? null,
          validity_date: extraction.validityDate ?? null,
          validity_basis: extraction.validityBasis,
          doctor_name: extraction.doctorName ?? null,
          doctor_crm: extraction.doctorCrm ?? null,
          company_name: extraction.companyName ?? null,
          company_cnpj: extraction.companyCnpj ?? null,
          clinic_name: extraction.clinicName ?? null,
          worker_registration: extraction.workerRegistration ?? null,
          occupational_risks: extraction.occupationalRisks ?? [],

          extracted_fields_json: fieldsFromExtraction(extraction),
          reviewed_fields_json: {},

          extraction_method: method,
          extraction_confidence: extraction.confidence,
          extraction_issues: issues,

          esocial_event_id: reconciliation.eventId,
          esocial_match_status: reconciliation.matchStatus,
          divergences: reconciliation.divergences,
          divergence_summary: reconciliation.summary,

          review_status: reviewStatus,
          // A trilha abre com os DOIS autores do que existe até aqui: quem
          // enviou e a máquina que leu. Sem isso, uma auditoria abriria o
          // histórico de um ASO aprovado e veria só a confirmação humana, como
          // se os campos tivessem surgido do nada.
          review_history: buildUploadTrail(userId, {
            method,
            confidence: extraction.confidence,
            issueCount: issues.length,
          }),
          reviewed_by: null,
          reviewed_at: null,
          notes: null,
          uploaded_by: userId,
        });

        // O acervo cresce dentro do próprio lote: dois PDFs do mesmo exame
        // enviados juntos precisam acusar conflito entre si, e não só contra o
        // que já estava gravado.
        existingRows.push(row);
        const siblings = siblingsByPerson(existingRows);

        results.push({
          fileName,
          ok: true,
          documentId: row.id,
          status: row.review_status,
          method,
          review: buildAsoReviewSummary(row, siblingsFor(row, siblings)),
        });
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
        workerName: r.worker_name ?? null,
      },
    }));
  } catch {
    // Base sem a migration 084, ou organização que nunca importou nada: o
    // documento entra sem conferência, que é o estado honesto e o caso comum.
    // Nunca um erro que impeça o upload.
    return [];
  }
}

