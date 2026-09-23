/**
 * LEITURA ASSISTIDA DO LEVANTAMENTO TÉCNICO.
 *
 * O que a Apex recebe: o que o engenheiro REGISTROU (seções, checklist,
 * perguntas) e a LISTA de arquivos de campo — nome, tipo e legenda, não o
 * conteúdo da foto. O que ela devolve: um candidato estruturado — escopo
 * provável, atividades, entregáveis, requisitos, materiais, ensaios, riscos,
 * dependências do cliente, informação faltante e pré-requisitos da proposta.
 *
 * ─── O que a torna honesta ───────────────────────────────────────────────
 *
 * Todo item cita DE ONDE saiu (`source`: uma seção registrada, o checklist,
 * uma pergunta ou um arquivo pelo nome). Item que cita fonte que não existe
 * no levantamento é mantido e marcado `unsupported` — some da conta de
 * confiança, mas não é escondido de quem revisa. Nada daqui é gravado em
 * `findings`: vai para `apex_candidate`, e virar escopo é ato de gente.
 */
if (typeof window !== 'undefined') {
  throw new Error('site-survey-understanding.ts não pode ser importado no navegador');
}

export const SITE_SURVEY_PIPELINE_VERSION = 'site-survey-understanding.v1';

import { CANDIDATE_GROUPS, type CandidateGroup } from './site-survey';

export { CANDIDATE_GROUPS, CANDIDATE_GROUP_LABEL, type CandidateGroup } from './site-survey';

export interface CandidateItem {
  text: string;
  confidence: number | null;
  source: string;
  supported: boolean;
}
export type SurveyCandidate = Record<CandidateGroup, CandidateItem[]>;

export const SITE_SURVEY_SYSTEM_PROMPT = [
  'You are Apex, reviewing a technical site survey recorded by an engineer of an electrical/industrial',
  'services company, before a technical proposal is written. Work ONLY from the survey content given.',
  'Every item you return MUST cite its source using one of the source keys listed in the input',
  '(e.g. "findings.equipment", "checklist", "open_questions", "attachment:<file name>").',
  'Never invent measurements, quantities, equipment or customer commitments that are not in the survey.',
  'When something needed for a proposal is not in the survey, put it under missing_information —',
  'do not guess it. Confidence is your probability that the item is correct given the survey (0..1).',
  'Write every text in Brazilian Portuguese.',
].join(' ');

const itemSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['text', 'confidence', 'source'],
  properties: {
    text: { type: 'string' },
    confidence: { type: 'number' },
    source: { type: 'string' },
  },
} as const;

export const SITE_SURVEY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [...CANDIDATE_GROUPS],
  properties: Object.fromEntries(CANDIDATE_GROUPS.map((group) => [group, { type: 'array', items: itemSchema }])),
} as const;

export interface SurveyForUnderstanding {
  code: string;
  purpose: string;
  site_name: string | null;
  site_address: string | null;
  opportunity_title: string;
  findings: Record<string, unknown>;
  checklist: unknown[];
  open_questions: unknown[];
  attachments: Array<{ title: string; document_type: string; caption?: string | null }>;
}

/** As chaves de fonte que existem DE FATO neste levantamento. */
export function availableSources(survey: SurveyForUnderstanding): string[] {
  const sources = Object.entries(survey.findings)
    .filter(([, value]) => (Array.isArray(value) ? value.length > 0 : Boolean(value)))
    .map(([key]) => `findings.${key}`);
  if (survey.checklist.length) sources.push('checklist');
  if (survey.open_questions.length) sources.push('open_questions');
  if (survey.purpose) sources.push('purpose');
  for (const attachment of survey.attachments) sources.push(`attachment:${attachment.title}`);
  return sources;
}

export function buildSiteSurveyPrompt(survey: SurveyForUnderstanding): string {
  return [
    `Survey ${survey.code} for opportunity "${survey.opportunity_title}".`,
    `Purpose: ${survey.purpose}`,
    `Site: ${[survey.site_name, survey.site_address].filter(Boolean).join(' — ') || 'not recorded'}`,
    `Valid source keys: ${availableSources(survey).join(', ') || 'none'}`,
    'Recorded findings (JSON):',
    JSON.stringify(survey.findings),
    'Checklist (JSON):',
    JSON.stringify(survey.checklist),
    'Open questions (JSON):',
    JSON.stringify(survey.open_questions),
    'Field files (metadata only; you cannot see their content):',
    JSON.stringify(survey.attachments),
  ].join('\n');
}

export function normalizeSurveyCandidate(raw: unknown, survey: SurveyForUnderstanding): SurveyCandidate {
  const valid = new Set(availableSources(survey));
  const out = {} as SurveyCandidate;
  for (const group of CANDIDATE_GROUPS) {
    const list = Array.isArray((raw as Record<string, unknown>)?.[group])
      ? ((raw as Record<string, unknown[]>)[group]) : [];
    out[group] = list
      .map((item) => item as { text?: unknown; confidence?: unknown; source?: unknown })
      .filter((item) => typeof item.text === 'string' && item.text.trim())
      .slice(0, 25)
      .map((item) => {
        const source = typeof item.source === 'string' ? item.source.trim() : '';
        const supported = valid.has(source) || source.startsWith('findings.') && valid.has(source.split('[')[0]);
        const confidence = typeof item.confidence === 'number' && item.confidence >= 0 && item.confidence <= 1
          ? item.confidence : null;
        return { text: (item.text as string).trim(), confidence, source: source || 'não informada', supported };
      });
  }
  return out;
}
