/**
 * PRONTIDÃO PARA PROPOR — determinística, conferível, sem suposição.
 *
 * A pergunta é "já sabemos o bastante para escrever a proposta técnica?". A
 * resposta é montada SÓ com o que está registrado: conta canônica, contato,
 * levantamento, checklist, perguntas em aberto. Nada aqui lê o que a Apex
 * sugeriu — sugestão não confirmada não torna uma oportunidade pronta, nem
 * a torna "não pronta".
 *
 * Três estados:
 *   READY_TO_PROPOSE — nada bloqueia e nada pede revisão;
 *   REVIEW_REQUIRED  — nada bloqueia, mas há lacuna que alguém deve olhar;
 *   NOT_READY        — há lacuna que impede uma proposta honesta.
 *
 * Uma lacuna nunca é inventada: cada item diz o que falta e onde resolver.
 */
import { digestSurvey, type SiteSurveyStatus } from './site-survey';

export type ReadinessState = 'READY_TO_PROPOSE' | 'NOT_READY' | 'REVIEW_REQUIRED';
export type ReadinessCheckState = 'ok' | 'warning' | 'blocking';

export interface ReadinessCheck {
  key: string;
  label: string;
  state: ReadinessCheckState;
  detail: string;
}

export interface ReadinessInput {
  opportunity: {
    party_id: string | null;
    primary_contact_id: string | null;
    estimated_value: string | number | null;
    expected_decision_date: string | null;
  };
  contacts: Array<{ id: string; is_primary: boolean }>;
  surveys: Array<{
    id: string; code: string; status: SiteSurveyStatus;
    findings: unknown; checklist: unknown; open_questions: unknown;
    site_name: string | null; site_address: string | null;
  }>;
}

export interface ReadinessResult {
  state: ReadinessState;
  checks: ReadinessCheck[];
  missing: string[];
}

export const READINESS_LABEL: Record<ReadinessState, string> = {
  READY_TO_PROPOSE: 'Pronta para propor',
  REVIEW_REQUIRED: 'Revisão necessária',
  NOT_READY: 'Não pronta',
};

export function evaluateProposalReadiness(input: ReadinessInput): ReadinessResult {
  const checks: ReadinessCheck[] = [];
  const { opportunity } = input;

  checks.push(opportunity.party_id
    ? { key: 'customer', label: 'Cliente identificado', state: 'ok',
        detail: 'Vinculado ao cadastro único de contrapartes.' }
    : { key: 'customer', label: 'Cliente identificado', state: 'blocking',
        detail: 'A oportunidade não está ligada ao cadastro único — a proposta sairia para um nome, não para uma conta.' });

  const hasPrimary = Boolean(opportunity.primary_contact_id)
    || input.contacts.some((contact) => contact.is_primary);
  checks.push(hasPrimary
    ? { key: 'contact', label: 'Contato principal', state: 'ok', detail: 'Há um destinatário definido para a proposta.' }
    : input.contacts.length
      ? { key: 'contact', label: 'Contato principal', state: 'warning',
          detail: `${input.contacts.length} contato(s) na conta, nenhum marcado como principal.` }
      : { key: 'contact', label: 'Contato principal', state: 'blocking',
          detail: 'Nenhum contato cadastrado na conta.' });

  const live = input.surveys.filter((survey) => survey.status !== 'CANCELLED');
  const completed = live.filter((survey) => survey.status === 'COMPLETED');
  const pending = live.filter((survey) => survey.status !== 'COMPLETED');

  if (!live.length) {
    checks.push({ key: 'survey', label: 'Levantamento técnico', state: 'warning',
      detail: 'Nenhum levantamento registrado. Confirme se a proposta dispensa visita técnica.' });
  } else if (pending.length) {
    checks.push({ key: 'survey', label: 'Levantamento técnico', state: 'blocking',
      detail: `${pending.map((s) => s.code).join(', ')} ainda não concluído(s).` });
  } else {
    checks.push({ key: 'survey', label: 'Levantamento técnico', state: 'ok',
      detail: `${completed.map((s) => s.code).join(', ')} concluído(s).` });
  }

  const digests = live.map((survey) => ({ survey, digest: digestSurvey(survey) }));

  if (live.length) {
    const withSite = digests.some(({ digest }) => digest.hasSite);
    checks.push(withSite
      ? { key: 'site', label: 'Local definido', state: 'ok', detail: 'O levantamento registra o local do serviço.' }
      : { key: 'site', label: 'Local definido', state: 'warning', detail: 'Nenhum levantamento registrou nome ou endereço do local.' });

    const activities = digests.reduce((sum, { digest }) => sum + digest.activityCount, 0);
    checks.push(activities > 0
      ? { key: 'scope', label: 'Escopo suficiente', state: 'ok',
          detail: `${activities} atividade(s) estimada(s) registrada(s) em campo.` }
      : { key: 'scope', label: 'Escopo suficiente', state: 'warning',
          detail: 'Nenhuma atividade estimada registrada — o escopo técnico dependerá de memória.' });

    const questions = digests.flatMap(({ survey, digest }) =>
      digest.openQuestions.map((q) => `${survey.code}: ${q.text}`));
    checks.push(questions.length
      ? { key: 'questions', label: 'Questões técnicas', state: 'blocking',
          detail: `${questions.length} em aberto — ${questions.slice(0, 3).join(' · ')}${questions.length > 3 ? ' …' : ''}` }
      : { key: 'questions', label: 'Questões técnicas', state: 'ok', detail: 'Nenhuma questão em aberto.' });

    const required = digests.flatMap(({ survey, digest }) =>
      digest.requiredPending.map((item) => `${survey.code}: ${item.label}`));
    checks.push(required.length
      ? { key: 'checklist', label: 'Checklist obrigatório', state: 'warning',
          detail: `${required.length} item(ns) obrigatório(s) pendente(s) — ${required.slice(0, 2).join(' · ')}` }
      : { key: 'checklist', label: 'Checklist obrigatório', state: 'ok', detail: 'Itens obrigatórios cumpridos.' });
  }

  checks.push(opportunity.estimated_value !== null && opportunity.estimated_value !== undefined
    ? { key: 'value', label: 'Valor estimado', state: 'ok', detail: 'Informado na oportunidade.' }
    : { key: 'value', label: 'Valor estimado', state: 'warning', detail: 'Sem valor estimado — a proposta nascerá sem referência de preço.' });

  checks.push(opportunity.expected_decision_date
    ? { key: 'decision', label: 'Previsão de decisão', state: 'ok', detail: 'Informada.' }
    : { key: 'decision', label: 'Previsão de decisão', state: 'warning', detail: 'Sem data prevista de decisão do cliente.' });

  const blocking = checks.filter((check) => check.state === 'blocking');
  const warnings = checks.filter((check) => check.state === 'warning');
  return {
    state: blocking.length ? 'NOT_READY' : warnings.length ? 'REVIEW_REQUIRED' : 'READY_TO_PROPOSE',
    checks,
    missing: [...blocking, ...warnings].map((check) => `${check.label}: ${check.detail}`),
  };
}
