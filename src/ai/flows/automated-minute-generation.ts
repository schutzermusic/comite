'use server';

/**
 * @fileOverview Generates meeting minutes with executive summaries, structured notes, and action plans using Gemini AI.
 *
 * - generateMeetingMinutes - A function that handles the generation of meeting minutes.
 * - GenerateMeetingMinutesInput - The input type for the generateMeetingMinutes function.
 * - GenerateMeetingMinutesOutput - The return type for the generateMeetingMinutes function.
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';

const GenerateMeetingMinutesInputSchema = z.object({
  transcriptionText: z
    .string()
    .describe('The transcription text of the meeting.'),
  reuniaoId: z.string().describe('The ID of the meeting.'),
  titulo: z.string().describe('The title of the meeting.'),
  descricao: z.string().describe('The description of the meeting.'),
  pautas: z.array(z.object({
    titulo: z.string(),
    descricao: z.string(),
  })).describe('The pautas of the meeting.'),
});

export type GenerateMeetingMinutesInput = z.infer<typeof GenerateMeetingMinutesInputSchema>;

const GenerateMeetingMinutesOutputSchema = z.object({
  resumoExecutivo: z.string().describe('The executive summary of the meeting.'),
  ataEstruturada: z.string().describe('The structured meeting minutes.'),
  planoAcao: z
    .array(
      z.object({
        tarefa: z.string(),
        responsavel: z.string(),
        prazo: z.string(),
      })
    )
    .describe('The action plan with tasks, responsibilities, and deadlines.'),
});

export type GenerateMeetingMinutesOutput = z.infer<typeof GenerateMeetingMinutesOutputSchema>;

export async function generateMeetingMinutes(
  input: GenerateMeetingMinutesInput
): Promise<GenerateMeetingMinutesOutput> {
  return generateMeetingMinutesFlow(input);
}

const prompt = ai.definePrompt({
  name: 'generateMeetingMinutesPrompt',
  input: {schema: GenerateMeetingMinutesInputSchema},
  output: {schema: GenerateMeetingMinutesOutputSchema},
  prompt: `You are an AI assistant specializing in generating meeting minutes.

  Given the following meeting transcription, meeting details, and pautas, generate an executive summary, structured meeting minutes, and an action plan.

  Meeting Title: {{{titulo}}}
  Meeting Description: {{{descricao}}}
  Pautas: {{#each pautas}}\n- {{{this.titulo}}}: {{{this.descricao}}}{{/each}}
  Transcription: {{{transcriptionText}}}

  Executive Summary:
  A concise summary of the meeting's key discussions and decisions.

  Structured Meeting Minutes:
  Detailed notes organized by pauta, including key discussion points and decisions made.

  Action Plan:
  A list of tasks, responsibilities, and deadlines arising from the meeting.
  Tasks: array of strings with task descriptions.
  Responsibilities: array of strings with the person responsible for each task.
  Deadlines: array of strings that represent the deadline for each task.

  Output the executive summary, structured meeting minutes, and action plan in JSON format.
  Ensure the action plan contains the keys: tarefa, responsavel, prazo. Each must be a string.`,
});

const generateMeetingMinutesFlow = ai.defineFlow(
  {
    name: 'generateMeetingMinutesFlow',
    inputSchema: GenerateMeetingMinutesInputSchema,
    outputSchema: GenerateMeetingMinutesOutputSchema,
  },
  async input => {
    const {output} = await prompt(input);
    return output!;
  }
);
