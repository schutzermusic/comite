/**
 * Importação do pacote do eSocial Download.
 *
 * Substitui a consulta automática, que o eSocial não oferece: não existe
 * webservice para recuperar eventos já transmitidos por competência — o
 * eSocial Download é exclusivo do portal web. Então o insumo é o ZIP (ou os
 * XMLs) que o empregador baixa lá, e daqui para a frente o caminho é o mesmo
 * de sempre: parsear → normalizar → métricas → indicadores.
 *
 * Idempotente: `esocial_event_id` é único por organização, então reimportar o
 * mesmo pacote não duplica evento nem altera métrica.
 */
import { createHash } from 'node:crypto';
import { unzipSync } from 'fflate';
import {
  parseEsocialEvents,
  parseEsocialReturn,
  EsocialParseError,
  type ParsedEsocialEvent,
} from './parser';
import { effectiveCompetence, normalizeEvents } from './normalizer';
import { hashCpf, maskCpf, hasCertKey } from './secrets';
import { INGESTED_EVENT_TYPES } from './endpoints';
import {
  backfillEventMetadata,
  finishSyncRun,
  findExistingEventIds,
  insertEvents,
  markEventsNormalized,
  pruneMetrics,
  pruneSstEvents,
  readAllEventXml,
  startSyncRun,
  upsertAreaMetrics,
  upsertCompetenceMetrics,
  upsertSstEvents,
  touchConfig,
  upsertEmployments,
  type EventInsert,
} from './store';

if (typeof window !== 'undefined') {
  throw new Error('src/lib/esocial/connector/import.ts não pode ser importado no browser');
}

/** Tipos que hoje viram indicador. Os demais são guardados, não descartados. */
const INDICATOR_TYPES = new Set<string>(INGESTED_EVENT_TYPES.map((e) => e.code));

export interface ImportFile {
  name: string;
  content: Buffer;
}

export interface ImportSummary {
  filesProcessed: number;
  xmlFound: number;
  eventsParsed: number;
  eventsImported: number;
  eventsDuplicated: number;
  /** Guardados para uso futuro, sem indicador hoje. */
  eventsStoredOnly: number;
  /** Retornos de lote guardados (recibos e ocorrências do eSocial). */
  returnsStored: number;
  /** Ocorrências apontadas pelo eSocial nesses retornos. */
  occurrences: number;
  eventsFailed: number;
  competencesUpdated: number;
  competences: string[];
  /** Mensagens já higienizadas — sem XML nem CPF em claro. */
  messages: string[];
  dryRun: boolean;
}

/**
 * Decodifica o XML respeitando o que ele declara.
 *
 * Sistemas de folha brasileiros exportam com frequência em ISO-8859-1, e ler
 * esses bytes como UTF-8 corrompe o conteúdo — às vezes de forma que nem o
 * parser aceita. Também remove o BOM, que antecede o `<?xml` e faz o parser
 * recusar o documento inteiro.
 */
export function decodeXml(bytes: Uint8Array): string {
  const buf = Buffer.from(bytes);

  // BOM UTF-8 / UTF-16: identificam a codificação e precisam sair do texto.
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    return buf.subarray(3).toString('utf8');
  }
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return buf.subarray(2).toString('utf16le');
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    // UTF-16BE: o Node não decodifica direto; troca os bytes de par em par.
    const swapped = Buffer.from(buf.subarray(2));
    swapped.swap16();
    return swapped.toString('utf16le');
  }

  // A declaração fica nos primeiros bytes e é ASCII em qualquer das codificações.
  const head = buf.subarray(0, 200).toString('latin1');
  const declared = head.match(/encoding\s*=\s*["']([^"']+)["']/i)?.[1]?.toLowerCase();
  if (declared && /^(iso-8859-1|latin1|windows-1252|cp1252)$/.test(declared)) {
    return buf.toString('latin1');
  }

  return buf.toString('utf8');
}

/** Profundidade máxima de ZIP dentro de ZIP — o portal às vezes agrupa por competência. */
const MAX_ZIP_DEPTH = 3;

/** Expande ZIPs (inclusive aninhados) em XMLs; XMLs soltos passam direto. */
export function expandToXml(files: ImportFile[]): { name: string; xml: string }[] {
  const out: { name: string; xml: string }[] = [];

  const expandZip = (name: string, bytes: Uint8Array, depth: number) => {
    if (depth > MAX_ZIP_DEPTH) return;
    let entries: Record<string, Uint8Array>;
    try {
      entries = unzipSync(bytes);
    } catch {
      throw new Error(`Não foi possível abrir "${name}" — o arquivo não parece um ZIP válido.`);
    }
    for (const [entryName, data] of Object.entries(entries)) {
      // Diretórios vêm como entradas vazias.
      if (data.length === 0) continue;
      const lower = entryName.toLowerCase();
      if (lower.endsWith('.zip')) expandZip(entryName, data, depth + 1);
      else if (lower.endsWith('.xml')) out.push({ name: entryName, xml: decodeXml(data) });
    }
  };

  for (const file of files) {
    const lower = file.name.toLowerCase();
    if (lower.endsWith('.zip')) expandZip(file.name, new Uint8Array(file.content), 1);
    else if (lower.endsWith('.xml')) out.push({ name: file.name, xml: decodeXml(file.content) });
  }

  return out;
}

export interface TriageResult {
  xmlFound: number;
  parsed: ParsedEsocialEvent[];
  /** XML bruto por id do evento, para persistência e auditoria. */
  rawById: Map<string, string>;
  /**
   * Guardados sem virar indicador hoje (CAT, ASO, agentes nocivos, tabelas…).
   * Ficam no banco justamente para que um indicador futuro seja uma
   * reapuração, e não um novo pedido de arquivo ao escritório.
   */
  storedOnly: number;
  failed: number;
  /** Mesmo evento repetido dentro do próprio pacote. */
  duplicatedInPackage: number;
  /** Retornos de lote (recibos e ocorrências) — guardados, não são falha. */
  returns: { name: string; xml: string; doc: NonNullable<ReturnType<typeof parseEsocialReturn>> }[];
  messages: string[];
}

/**
 * Triagem do pacote: expande, parseia e classifica cada arquivo. Pura — não
 * toca banco nem rede — e por isso é o ponto onde os testes exercitam o
 * comportamento com pacotes de verdade.
 */
export function triagePackage(files: ImportFile[]): TriageResult {
  const documents = expandToXml(files);
  const parsed: ParsedEsocialEvent[] = [];
  const rawById = new Map<string, string>();
  const messages: string[] = [];
  const returns: TriageResult['returns'] = [];
  let storedOnly = 0;
  let failed = 0;
  let duplicatedInPackage = 0;

  for (const doc of documents) {
    try {
      // Um arquivo é um LOTE: traz dezenas de eventos, e os de retorno ainda
      // trazem os totalizadores. Processar só o primeiro descartaria o resto.
      const events = parseEsocialEvents(doc.xml);

      for (const event of events) {
        if (!event.eventId) {
          failed += 1;
          continue;
        }
        // Todo evento é guardado, inclusive o que ainda não vira indicador: a
        // janela de retenção do eSocial não perdoa, e o que não for ingerido
        // agora pode não estar mais disponível quando for útil.
        if (!INDICATOR_TYPES.has(event.eventType)) storedOnly += 1;
        if (rawById.has(event.eventId)) {
          duplicatedInPackage += 1;
          continue;
        }
        parsed.push(event);
        // Guarda o fragmento do evento, não o lote: uma linha, um evento.
        rawById.set(event.eventId, event.eventXml || doc.xml);
      }
    } catch (err) {
      // Sem evento não significa arquivo inválido: boa parte do pacote são
      // retornos de lote, com recibo e ocorrências. Guardar é melhor que
      // descartar — a ocorrência é o próprio eSocial apontando problema no dado.
      const retorno = parseEsocialReturn(doc.xml);
      if (retorno) {
        returns.push({ name: doc.name, xml: doc.xml, doc: retorno });
        continue;
      }
      failed += 1;
      messages.push(`${doc.name}: ${err instanceof Error ? err.message : 'falha ao ler'}`);
    }
  }

  return {
    xmlFound: documents.length,
    parsed,
    rawById,
    storedOnly,
    failed,
    duplicatedInPackage,
    returns,
    messages,
  };
}

/**
 * Reapura TODAS as competências a partir do que já está no banco.
 *
 * Três razões para ser sempre global, e não só das competências recém-chegadas:
 *
 *  • Gravar métrica é SUBSTITUIR a linha da competência. Se o mês chegou em
 *    partes — histórico fatiado, totalizador que só sai depois do fechamento,
 *    reenvio do escritório — apurar só o pacote apagaria o que veio antes.
 *  • A tabela de rubricas (S-1010) não pertence a competência nenhuma e vale
 *    para todas as folhas: uma rubrica mapeada hoje reclassifica o histórico.
 *  • Um afastamento iniciado em setembro lança dias em outubro e novembro, e
 *    seu evento de RETORNO não traz competência alguma. Reapurar por recorte
 *    perderia o fechamento do afastamento e os meses vizinhos.
 *
 * É também o caminho para corrigir apuração sem pedir o arquivo de novo: mudou
 * a regra, roda isto e o acervo inteiro se realinha.
 */
export async function recomputeMetrics(organizationId: string): Promise<number> {
  const rows = await readAllEventXml(organizationId);
  const reparsed: ParsedEsocialEvent[] = [];
  const seen = new Set<string>();
  const metadataPatches: { esocial_event_id: string; metadata: Record<string, unknown> }[] = [];

  for (const row of rows) {
    try {
      for (const ev of parseEsocialEvents(row.raw_xml)) {
        // Defesa contra linhas antigas que guardaram o lote inteiro: um mesmo
        // evento não pode entrar duas vezes no agregado.
        const key = ev.eventId ?? row.esocial_event_id;
        if (seen.has(key)) continue;
        seen.add(key);
        reparsed.push(ev);

        // Eventos ingeridos antes de a auditoria existir não têm procedência
        // gravada. A releitura já está em mãos: aproveitá-la evita uma segunda
        // varredura do acervo só para preencher metadados.
        if (key === row.esocial_event_id) {
          const audit = auditMetadata(ev);
          const stored = row.metadata ?? {};
          const missing = Object.keys(audit).some((field) => stored[field] === undefined);
          if (missing) {
            metadataPatches.push({
              esocial_event_id: row.esocial_event_id,
              metadata: { ...stored, ...audit },
            });
          }
        }
      }
    } catch {
      // Já foi contabilizado como falha quando entrou; aqui só não soma.
    }
  }

  await backfillEventMetadata(organizationId, metadataPatches);

  const {
    competences: compRows,
    areas,
    employments,
    sstEvents,
  } = normalizeEvents(organizationId, reparsed);
  await upsertCompetenceMetrics(compRows);
  await upsertAreaMetrics(areas);
  await upsertEmployments(employments);
  await upsertSstEvents(sstEvents);

  // Depois de gravar, descartar o que a apuração não produziu mais.
  await pruneMetrics(
    organizationId,
    compRows.map((r) => r.competence),
    areas.map((a) => ({ competence: a.competence, area_code: a.area_code })),
  );
  await pruneSstEvents(organizationId, sstEvents.map((s) => s.esocial_event_id));

  return compRows.length;
}

/**
 * Sinais de controle guardados junto do evento, no `metadata`.
 *
 * São perguntas de transmissão, não de negócio: de que software veio o mês, se
 * é original ou retificação, se a competência foi fechada, qual evento uma
 * exclusão apagou. Cabem no jsonb que a linha já tem e não justificariam
 * colunas próprias — mas sem eles a auditoria técnica teria de reabrir o XML de
 * cada evento para responder qualquer uma dessas perguntas.
 */
function auditMetadata(e: ParsedEsocialEvent): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (e.origin) out.origin = e.origin;
  if (e.payload.kind === 'period-close') {
    out.periodClose = {
      apuracaoKind: e.payload.apuracaoKind,
      hasRemuneration: e.payload.hasRemuneration,
      hasPayments: e.payload.hasPayments,
    };
  }
  if (e.payload.kind === 'exclusion') {
    out.exclusion = {
      targetEventType: e.payload.targetEventType,
      targetReceipt: e.payload.targetReceipt,
    };
  }
  return out;
}

export interface ImportOptions {
  organizationId: string;
  files: ImportFile[];
  /** Não grava nada; apenas relata o que seria importado. */
  dryRun?: boolean;
  triggeredBy: string;
}

export async function importEsocialPackage({
  organizationId,
  files,
  dryRun = false,
  triggeredBy,
}: ImportOptions): Promise<ImportSummary> {
  if (!hasCertKey()) {
    // O hash do CPF usa a mesma chave; sem ela a correlação entre eventos do
    // mesmo trabalhador ficaria inconsistente entre importações.
    throw new Error('ESOCIAL_CERT_KEY não configurada — necessária para pseudonimizar o CPF dos eventos.');
  }

  const summary: ImportSummary = {
    filesProcessed: files.length,
    xmlFound: 0,
    eventsParsed: 0,
    eventsImported: 0,
    eventsDuplicated: 0,
    eventsStoredOnly: 0,
    returnsStored: 0,
    occurrences: 0,
    eventsFailed: 0,
    competencesUpdated: 0,
    competences: [],
    messages: [],
    dryRun,
  };

  const triage = triagePackage(files);
  summary.xmlFound = triage.xmlFound;
  summary.eventsParsed = triage.parsed.length;
  summary.eventsStoredOnly = triage.storedOnly;
  summary.occurrences = triage.returns.reduce((n, r) => n + r.doc.occurrences.length, 0);
  summary.eventsFailed = triage.failed;
  summary.eventsDuplicated = triage.duplicatedInPackage;
  summary.messages.push(...triage.messages);

  const { parsed, rawById } = triage;

  /** Retornos viram linhas próprias, com o protocolo como chave natural. */
  const returnInserts: EventInsert[] = triage.returns
    .filter((r) => r.doc.protocol)
    .map((r) => ({
      organization_id: organizationId,
      sync_run_id: null,
      event_type: 'RETORNO-LOTE',
      esocial_event_id: `RET-${r.doc.protocol}`,
      receipt_number: r.doc.receiptNumbers[0],
      raw_xml: r.xml,
      raw_xml_sha256: createHash('sha256').update(r.xml).digest('hex'),
      metadata: {
        source: 'esocial_download_package',
        file: r.name,
        responseCode: r.doc.responseCode,
        // Só contagens: a descrição da ocorrência traz CPF em claro.
        occurrences: r.doc.occurrences.length,
        receipts: r.doc.receiptNumbers.length,
      },
    }));

  if (triage.xmlFound === 0) {
    summary.messages.push('Nenhum XML encontrado no que foi enviado.');
    return summary;
  }
  if (parsed.length === 0 && returnInserts.length === 0) {
    summary.messages.push('Nenhum evento aproveitável no pacote.');
    return summary;
  }

  // Competência EFETIVA: cadastrais não trazem perApur e se situam pela data do
  // fato. Precisa ser a mesma chave gravada no evento, senão a reapuração não o
  // encontra depois.
  const competences = [
    ...new Set(parsed.map(effectiveCompetence).filter((c): c is string => Boolean(c))),
  ].sort();
  summary.competences = competences;

  const runRowId = dryRun
    ? null
    : await startSyncRun({
        run_id: crypto.randomUUID(),
        organization_id: organizationId,
        dry_run: dryRun,
        automation_enabled: false,
        triggered_by: triggeredBy,
        environment: 'import',
        competence_from: competences[0] ?? '',
        competence_to: competences[competences.length - 1] ?? '',
      });

  try {
    // ── 2. Descartar o que já temos ──
    const existing = await findExistingEventIds(organizationId, [...rawById.keys()]);
    summary.eventsDuplicated += existing.size;

    const fresh = parsed.filter((e) => !existing.has(e.eventId!));
    if (fresh.length === 0) {
      summary.messages.push('Todos os eventos do pacote já haviam sido importados.');
      await finishSyncRun(runRowId, {
        status: 'success',
        events_found: summary.eventsParsed,
        events_duplicated: summary.eventsDuplicated,
        safe_message: 'Pacote sem novidades.',
      });
      return summary;
    }

    // ── 3. Persistir bruto + normalizar ──
    const inserts: EventInsert[] = fresh.map((e) => {
      const xml = rawById.get(e.eventId!) ?? '';
      return {
        organization_id: organizationId,
        sync_run_id: runRowId,
        event_type: e.eventType,
        esocial_event_id: e.eventId!,
        receipt_number: e.receiptNumber,
        competence: effectiveCompetence(e),
        worker_cpf_hash: e.cpf ? hashCpf(e.cpf) : undefined,
        worker_cpf_mask: e.cpf ? maskCpf(e.cpf) : undefined,
        raw_xml: xml,
        raw_xml_sha256: createHash('sha256').update(xml).digest('hex'),
        metadata: { source: 'esocial_download_package', ...auditMetadata(e) },
      };
    });

    if (dryRun) {
      summary.eventsImported = inserts.length;
      summary.competencesUpdated = normalizeEvents(organizationId, parsed).competences.length;
      summary.messages.push('Simulação: nada foi gravado.');
      return summary;
    }

    summary.eventsImported = await insertEvents(inserts);
    await markEventsNormalized(organizationId, inserts.map((i) => i.esocial_event_id));

    // Retornos não geram métrica, mas guardá-los preserva recibo e ocorrência.
    if (returnInserts.length > 0) {
      summary.returnsStored = await insertEvents(
        returnInserts.map((r) => ({ ...r, sync_run_id: runRowId })),
      );
    }

    // ── 4. Reapurar todo o acervo a partir do banco ──
    summary.competencesUpdated = await recomputeMetrics(organizationId);

    await touchConfig(organizationId, {
      last_sync_at: new Date().toISOString(),
      last_sync_status: summary.eventsFailed > 0 ? 'partial' : 'success',
    });

    await finishSyncRun(runRowId, {
      status: summary.eventsFailed > 0 ? 'partial' : 'success',
      events_found: summary.eventsParsed,
      events_imported: summary.eventsImported,
      events_duplicated: summary.eventsDuplicated,
      events_failed: summary.eventsFailed,
      safe_message: summary.messages.join(' | ').slice(0, 1000) || undefined,
      metadata: { competences, source: 'esocial_download_package' },
    });

    return summary;
  } catch (err) {
    await finishSyncRun(runRowId, {
      status: 'failed',
      events_found: summary.eventsParsed,
      safe_message: err instanceof Error ? err.message.slice(0, 200) : 'Falha na importação.',
    });
    throw err;
  }
}
