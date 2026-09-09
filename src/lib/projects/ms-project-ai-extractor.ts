/**
 * AI fallback extractor for MS Project PDF schedules (SERVER-ONLY).
 *
 * Used by the import parse route when the deterministic positioned-text
 * parser fails or produces a weak result (>30% rows with issues). Sends
 * the PDF as a document capability request and demands a strict
 * JSON array of schedule rows. The same validateParsedRows() pass runs
 * on the output, and the prompt forbids inventing data (dependencies /
 * resources absent from the PDF stay absent).
 *
 * Never import this from client components — the gateway is server-only.
 */

import { ApexAIError, getApexAIGateway } from '@/lib/ai/gateway';
import type { ParsedScheduleRow } from '@/lib/types/project-timeline';
import {
  inferOutlineLevel,
  parseDurationToMinutes,
  parsePercent,
  parsePtBrDate,
} from '@/lib/projects/ms-project-parser';

const EXTRACTION_PROMPT = `Você é um extrator de cronogramas do Microsoft Project.

O PDF anexado é um cronograma exportado do MS Project em português, com uma tabela
com as colunas: Id, EDT (WBS), Nome da Tarefa, % concluída, Duração, Início, Término.

Extraia TODAS as linhas da tabela, em ordem, e responda APENAS com um objeto JSON
no formato {"rows": [...]} (sem markdown, sem comentários), onde cada elemento
de rows tem exatamente estes campos:

{
  "id": "<coluna Id, ex: \\"42\\">",
  "wbs": "<coluna EDT exatamente como impressa, ex: \\"2.3.11.1\\" (a linha raiz é \\"0\\")>",
  "name": "<Nome da Tarefa completo (junte nomes quebrados em várias linhas)>",
  "percent_raw": "<texto bruto da coluna % concluída, ex: \\"70%\\">",
  "duration_raw": "<texto bruto da coluna Duração, ex: \\"24,17 dias\\", \\"9 hrs\\">",
  "start_raw": "<texto bruto da coluna Início, ex: \\"Ter 19/05/26\\">",
  "finish_raw": "<texto bruto da coluna Término, ex: \\"Qua 20/05/26\\">"
}

Regras OBRIGATÓRIAS:
- Copie os valores brutos exatamente como impressos (incluindo o dia da semana nas datas).
- NÃO invente dados: se uma célula estiver vazia ou ilegível, use "".
- NÃO invente dependências, predecessoras, recursos ou responsáveis.
- NÃO pule linhas; inclua linhas-resumo (fases) e marcos.
- Ignore cabeçalhos repetidos, rodapés e numeração de página.`;

export class AiExtractionUnavailableError extends Error {
  constructor() {
    super('Apex AI Gateway indisponível — fallback de IA não executado.');
    this.name = 'AiExtractionUnavailableError';
  }
}

interface AiRow {
  id?: string;
  wbs?: string;
  name?: string;
  percent_raw?: string;
  duration_raw?: string;
  start_raw?: string;
  finish_raw?: string;
}

const SCHEDULE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    rows: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string' }, wbs: { type: 'string' }, name: { type: 'string' },
          percent_raw: { type: 'string' }, duration_raw: { type: 'string' },
          start_raw: { type: 'string' }, finish_raw: { type: 'string' },
        },
        required: ['id', 'wbs', 'name', 'percent_raw', 'duration_raw', 'start_raw', 'finish_raw'],
      },
    },
  },
  required: ['rows'],
} as const;

export async function extractScheduleWithAi(
  pdfBase64: string,
  organizationId: string,
): Promise<{ rows: ParsedScheduleRow[]; provenance: import('@/lib/ai/gateway/types').ApexAIProvenance }> {
  let rows: AiRow[];
  let provenance: import('@/lib/ai/gateway/types').ApexAIProvenance;
  try {
    const response = await getApexAIGateway().generate<{ rows?: AiRow[] }>({
      organizationId,
      task: 'PROJECT_SCHEDULE_EXTRACTION',
      userPrompt: EXTRACTION_PROMPT,
      document: { mediaType: 'application/pdf', base64: pdfBase64 },
      structuredOutput: { name: 'project_schedule_rows', schema: SCHEDULE_SCHEMA },
    });
    rows = response.output.rows ?? [];
    provenance = response.provenance;
  } catch (err) {
    if (err instanceof ApexAIError && ['AI_DISABLED', 'PROVIDER_NOT_CONFIGURED'].includes(err.code)) {
      throw new AiExtractionUnavailableError();
    }
    throw err;
  }
  if (!Array.isArray(rows)) throw new Error('Resposta da IA não é um array de linhas.');

  return { rows: rows.map((r, index) => {
    const durationMinutes = parseDurationToMinutes(r.duration_raw ?? '');
    return {
      msProjectId: (r.id ?? '').trim(),
      wbsCode: (r.wbs ?? '').trim(),
      title: (r.name ?? '').trim(),
      percentComplete: parsePercent(r.percent_raw ?? ''),
      durationMinutes,
      plannedStart: parsePtBrDate(r.start_raw ?? ''),
      plannedFinish: parsePtBrDate(r.finish_raw ?? ''),
      outlineLevel: inferOutlineLevel(r.wbs ?? ''),
      rowOrder: index,
      isSummary: false,
      isMilestone: durationMinutes === 0,
      raw: {
        original_task_name: r.name ?? '',
        original_start_raw: r.start_raw ?? '',
        original_finish_raw: r.finish_raw ?? '',
        original_duration_raw: r.duration_raw ?? '',
        original_percent_raw: r.percent_raw ?? '',
        original_wbs_code: r.wbs ?? '',
      },
      issues: [],
    };
  }), provenance };
}
