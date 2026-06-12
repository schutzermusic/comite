/**
 * AI fallback extractor for MS Project PDF schedules (SERVER-ONLY).
 *
 * Used by the import parse route when the deterministic positioned-text
 * parser fails or produces a weak result (>30% rows with issues). Sends
 * the PDF as a document content block to Claude and demands a strict
 * JSON array of schedule rows. The same validateParsedRows() pass runs
 * on the output, and the prompt forbids inventing data (dependencies /
 * resources absent from the PDF stay absent).
 *
 * Never import this from client components — it reads ANTHROPIC_API_KEY.
 */

import Anthropic from '@anthropic-ai/sdk';
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

Extraia TODAS as linhas da tabela, em ordem, e responda APENAS com um array JSON
(sem markdown, sem comentários), onde cada elemento tem exatamente estes campos:

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
    super('ANTHROPIC_API_KEY ausente — fallback de IA indisponível.');
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

export async function extractScheduleWithAi(pdfBase64: string): Promise<ParsedScheduleRow[]> {
  if (!process.env.ANTHROPIC_API_KEY) throw new AiExtractionUnavailableError();
  const client = new Anthropic();

  // Long output (~130 rows of JSON) → stream to avoid HTTP timeouts.
  const stream = client.messages.stream({
    model: 'claude-opus-4-8',
    max_tokens: 64000,
    thinking: { type: 'adaptive' },
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'document',
            source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 },
          },
          { type: 'text', text: EXTRACTION_PROMPT },
        ],
      },
    ],
  });
  const message = await stream.finalMessage();

  const text = message.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');

  // Tolerate code fences and preamble/epilogue text: parse from the first
  // "[" to the last "]" (the prompt demands a bare JSON array).
  const firstBracket = text.indexOf('[');
  const lastBracket = text.lastIndexOf(']');
  if (firstBracket === -1 || lastBracket <= firstBracket) {
    throw new Error('Resposta da IA não contém um array JSON — extração abortada.');
  }
  let rows: AiRow[];
  try {
    rows = JSON.parse(text.slice(firstBracket, lastBracket + 1)) as AiRow[];
  } catch {
    throw new Error('Resposta da IA não é um JSON válido — extração abortada.');
  }
  if (!Array.isArray(rows)) throw new Error('Resposta da IA não é um array de linhas.');

  return rows.map((r, index) => {
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
  });
}
