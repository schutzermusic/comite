/**
 * Fallback de IA para o ASO em PDF (SERVER-ONLY).
 *
 * Entra quando o extrator determinístico falha ou lê pouco — o caso comum é o
 * ASO ESCANEADO, que não tem camada de texto nenhuma e do qual o pdfjs não
 * extrai um único caractere. Manda o PDF inteiro como documento para o Claude
 * e exige JSON estrito. Mesmo desenho do fallback de cronograma do MS Project.
 *
 * DUAS REGRAS QUE O PROMPT PRECISA CARREGAR, E O CÓDIGO REFORÇA DEPOIS
 *
 * 1. Campo ausente volta vazio, nunca preenchido por plausibilidade. Um ASO com
 *    validade inventada é pior que um sem validade: o segundo pede conferência,
 *    o primeiro passa despercebido até a fiscalização.
 * 2. Validade só é "declarada" se estiver ESCRITA no papel. A IA não deduz
 *    periodicidade — quem faz isso é a regra da NR-7 no extrator, que marca a
 *    origem como inferida. Confundir os dois apagaria a diferença entre fato e
 *    premissa, que é a coisa que este módulo inteiro existe para preservar.
 *
 * Nunca importar de componente cliente: lê ANTHROPIC_API_KEY.
 */

import Anthropic from '@anthropic-ai/sdk';
import { AI_MODEL } from '@/lib/ai/server-clients';
import {
  addMonths,
  parsePtBrDate,
  type AsoExamKind,
  type AsoExtraction,
  type AsoExtractionIssue,
  type AsoValidityBasis,
} from './aso-extractor';

if (typeof window !== 'undefined') {
  throw new Error('src/lib/workforce/aso-ai-extractor.ts não pode ser importado no browser');
}

export class AsoAiUnavailableError extends Error {
  constructor() {
    super('ANTHROPIC_API_KEY ausente — leitura por IA indisponível.');
    this.name = 'AsoAiUnavailableError';
  }
}

const EXTRACTION_PROMPT = `Você extrai dados de um ASO (Atestado de Saúde Ocupacional) brasileiro.

Responda APENAS com um objeto JSON (sem markdown, sem comentários) com exatamente
estes campos:

{
  "worker_name": "<nome do trabalhador, ou \\"\\">",
  "cpf": "<somente dígitos, ou \\"\\">",
  "company_name": "<razão social da empresa, ou \\"\\">",
  "exam_kind": "<um de: admissional | periodico | retorno | mudanca_risco | monitoracao | demissional | \\"\\">",
  "exam_date_raw": "<data do exame exatamente como impressa, ex: \\"10/03/2026\\", ou \\"\\">",
  "result": "<apto | inapto | \\"\\">",
  "valid_until_raw": "<data de validade SE ESTIVER ESCRITA no documento, ou \\"\\">",
  "doctor_name": "<nome do médico examinador, ou \\"\\">",
  "doctor_crm": "<somente os dígitos do CRM, ou \\"\\">"
}

Regras OBRIGATÓRIAS:
- Copie os valores como impressos. Não normalize datas, não traduza, não complete.
- Campo ausente, ilegível ou duvidoso → string vazia "". NUNCA invente.
- "valid_until_raw" SÓ pode ser preenchido se houver no papel uma data explícita de
  validade/vencimento/próximo exame. NÃO calcule validade a partir da data do exame,
  nem a partir do tipo do exame. Se não houver data escrita, devolva "".
- Atenção a "INAPTO": não confunda com "APTO".
- Se o documento não for um ASO, devolva todos os campos vazios.`;

const KIND_MAP: Record<string, AsoExamKind> = {
  admissional: '0',
  periodico: '1',
  retorno: '2',
  mudanca_risco: '3',
  monitoracao: '4',
  demissional: '9',
};

interface AiPayload {
  worker_name?: string;
  cpf?: string;
  company_name?: string;
  exam_kind?: string;
  exam_date_raw?: string;
  result?: string;
  valid_until_raw?: string;
  doctor_name?: string;
  doctor_crm?: string;
}

/** Periodicidade assumida quando o papel não declara — só o periódico. */
const INFERRED_PERIOD_MONTHS: Partial<Record<AsoExamKind, number>> = { '1': 12 };

export async function extractAsoWithAi(pdf: Buffer, today: Date = new Date()): Promise<AsoExtraction> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new AsoAiUnavailableError();

  const anthropic = new Anthropic({ apiKey });
  const response = await anthropic.messages.create({
    model: AI_MODEL,
    max_tokens: 1500,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'document',
            source: { type: 'base64', media_type: 'application/pdf', data: pdf.toString('base64') },
          },
          { type: 'text', text: EXTRACTION_PROMPT },
        ],
      },
    ],
  });

  let raw = '';
  for (const block of response.content) {
    if (block.type === 'text') raw += block.text;
  }
  // O modelo às vezes embrulha em cerca de markdown mesmo quando proibido.
  const json = raw.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();

  let payload: AiPayload;
  try {
    payload = JSON.parse(json) as AiPayload;
  } catch (err) {
    throw new Error(
      `A leitura por IA não devolveu JSON válido: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  return normalizeAiPayload(payload, today);
}

/**
 * Converte a resposta da IA no mesmo formato do extrator determinístico.
 *
 * Exportada para teste: é aqui que as garantias vivem, e elas não podem
 * depender de uma chamada de rede para serem verificadas.
 */
export function normalizeAiPayload(payload: AiPayload, today: Date = new Date()): AsoExtraction {
  const issues: AsoExtractionIssue[] = [];
  const clean = (v: string | undefined) => (v && v.trim() ? v.trim() : undefined);

  const examDate = parsePtBrDate(clean(payload.exam_date_raw));
  if (!examDate) issues.push({ field: 'examDate', reason: 'Data do exame não lida pela IA.' });

  const kindKey = clean(payload.exam_kind)?.toLowerCase();
  const examKind = kindKey ? KIND_MAP[kindKey] : undefined;
  if (!examKind) issues.push({ field: 'examKind', reason: 'Tipo de exame não lido pela IA.' });

  const resultRaw = clean(payload.result)?.toLowerCase();
  const result = resultRaw === 'apto' ? '1' : resultRaw === 'inapto' ? '2' : undefined;
  if (!result) issues.push({ field: 'result', reason: 'Resultado não lido pela IA.' });

  // Só é "declarada" se a IA copiou uma data do papel.
  let validUntil = parsePtBrDate(clean(payload.valid_until_raw));
  let validityBasis: AsoValidityBasis = validUntil ? 'declared_document' : 'undetermined';

  if (validUntil && examDate && validUntil < examDate) {
    issues.push({
      field: 'validUntil',
      reason: `Validade lida (${validUntil}) é anterior à data do exame (${examDate}) — descartada.`,
    });
    validUntil = undefined;
    validityBasis = 'undetermined';
  }

  // A inferência acontece AQUI, no nosso código, e não no prompt — para que a
  // origem da data fique registrada como premissa e não como fato do papel.
  if (!validUntil && examDate && examKind) {
    const months = INFERRED_PERIOD_MONTHS[examKind];
    if (months) {
      validUntil = addMonths(examDate, months);
      validityBasis = 'inferred_periodicity';
      issues.push({
        field: 'validUntil',
        reason: 'Validade não declarada no documento; inferida pela periodicidade anual da NR-7.',
      });
    } else {
      issues.push({ field: 'validUntil', reason: 'Validade não declarada e não inferível para este tipo de exame.' });
    }
  }

  const cpf = clean(payload.cpf)?.replace(/\D/g, '');
  const workerName = clean(payload.worker_name);
  if (!cpf && !workerName) {
    issues.push({ field: 'worker', reason: 'Nem nome nem CPF do trabalhador foram lidos.' });
  }

  if (examDate && examDate > today.toISOString().slice(0, 10)) {
    issues.push({ field: 'examDate', reason: `Data do exame (${examDate}) está no futuro.` });
  }

  const weights: [boolean, number][] = [
    [Boolean(examDate), 0.35],
    [Boolean(examKind), 0.2],
    [Boolean(result), 0.15],
    [validityBasis === 'declared_document', 0.15],
    [Boolean(workerName || cpf), 0.15],
  ];
  // A leitura por IA nunca sai com confiança máxima: ela é sempre uma leitura
  // de segunda linha, sobre um documento que o determinístico já não conseguiu
  // ler, e entra na fila de revisão com essa marca.
  const confidence = Number(
    (weights.reduce((sum, [ok, w]) => sum + (ok ? w : 0), 0) * 0.9).toFixed(3),
  );

  return {
    examDate,
    examKind,
    result,
    validUntil,
    validityBasis,
    doctorName: clean(payload.doctor_name),
    doctorCrm: clean(payload.doctor_crm)?.replace(/\D/g, ''),
    workerName,
    cpf,
    companyName: clean(payload.company_name),
    confidence,
    issues,
  };
}
