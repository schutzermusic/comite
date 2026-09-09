'use server';

import { z } from 'zod';
import { getApexAIGateway } from '@/lib/ai/gateway';
import { requireActiveOrganizationId } from '@/lib/auth/active-organization';
import { createClient } from '@/utils/supabase/server';

const GenerateMeetingMinutesInputSchema = z.object({
  transcriptionText: z.string(),
  reuniaoId: z.string(),
  titulo: z.string(),
  descricao: z.string(),
  pautas: z.array(z.object({ titulo: z.string(), descricao: z.string() })),
});

export type GenerateMeetingMinutesInput = z.infer<typeof GenerateMeetingMinutesInputSchema>;

const GenerateMeetingMinutesOutputSchema = z.object({
  resumoExecutivo: z.string(),
  ataEstruturada: z.string(),
  planoAcao: z.array(z.object({
    tarefa: z.string(),
    responsavel: z.string(),
    prazo: z.string(),
  })),
});

export type GenerateMeetingMinutesOutput = z.infer<typeof GenerateMeetingMinutesOutputSchema>;

const OUTPUT_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    resumoExecutivo: { type: 'string' },
    ataEstruturada: { type: 'string' },
    planoAcao: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          tarefa: { type: 'string' }, responsavel: { type: 'string' }, prazo: { type: 'string' },
        },
        required: ['tarefa', 'responsavel', 'prazo'],
      },
    },
  },
  required: ['resumoExecutivo', 'ataEstruturada', 'planoAcao'],
} as const;

const SYSTEM_PROMPT = `Você gera atas executivas em português do Brasil. Resuma somente o que aparece na transcrição e nos dados da reunião. Não invente decisões, responsáveis nem prazos. Quando um responsável ou prazo não estiver explícito, registre "A definir".`;

export async function generateMeetingMinutes(
  rawInput: GenerateMeetingMinutesInput,
): Promise<GenerateMeetingMinutesOutput> {
  const input = GenerateMeetingMinutesInputSchema.parse(rawInput);
  const organizationId = await requireActiveOrganizationId(await createClient());
  const response = await getApexAIGateway().generate<GenerateMeetingMinutesOutput>({
    organizationId,
    task: 'MEETING_MINUTES',
    systemPrompt: SYSTEM_PROMPT,
    userPrompt: [
      `Título: ${input.titulo}`,
      `Descrição: ${input.descricao}`,
      `ID da reunião: ${input.reuniaoId}`,
      `Pautas: ${JSON.stringify(input.pautas)}`,
      `Transcrição:\n${input.transcriptionText}`,
    ].join('\n\n'),
    structuredOutput: { name: 'meeting_minutes', schema: OUTPUT_JSON_SCHEMA },
  });
  return GenerateMeetingMinutesOutputSchema.parse(response.output);
}
