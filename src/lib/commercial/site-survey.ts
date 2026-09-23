/**
 * LEVANTAMENTO TÉCNICO — o modelo de leitura e a cópia da regra de estado.
 *
 * O levantamento pertence à oportunidade (migration 213). Não é módulo, não é
 * projeto e não é OS: é descoberta antes da proposta. Este arquivo é puro —
 * sem banco, sem rede — e existe para que a tela de campo, o espaço da
 * oportunidade e a prontidão para propor leiam o levantamento do MESMO jeito.
 *
 * ⚠️ `SURVEY_TRANSITIONS` ESPELHA `commercial_site_survey_transition`. Mudar
 * uma sem a outra faz o botão aparecer e a gravação falhar; o teste de
 * unidade trava as duas na mesma tabela.
 */

export type SiteSurveyStatus =
  | 'PLANNED' | 'SCHEDULED' | 'IN_FIELD' | 'AWAITING_REPORT' | 'COMPLETED' | 'CANCELLED';

export const SURVEY_STATUS_LABEL: Record<SiteSurveyStatus, string> = {
  PLANNED: 'Planejado',
  SCHEDULED: 'Agendado',
  IN_FIELD: 'Em campo',
  AWAITING_REPORT: 'Aguardando relatório',
  COMPLETED: 'Concluído',
  CANCELLED: 'Cancelado',
};

/** A ordem de avanço, para a régua de progresso. Cancelado fica fora dela. */
export const SURVEY_LIFECYCLE: SiteSurveyStatus[] = [
  'PLANNED', 'SCHEDULED', 'IN_FIELD', 'AWAITING_REPORT', 'COMPLETED',
];

export const SURVEY_TRANSITIONS: Record<SiteSurveyStatus, SiteSurveyStatus[]> = {
  PLANNED: ['SCHEDULED', 'IN_FIELD', 'CANCELLED'],
  SCHEDULED: ['PLANNED', 'IN_FIELD', 'CANCELLED'],
  IN_FIELD: ['AWAITING_REPORT', 'COMPLETED', 'CANCELLED'],
  AWAITING_REPORT: ['IN_FIELD', 'COMPLETED', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
};

export const SURVEY_TRANSITION_LABEL: Partial<Record<SiteSurveyStatus, string>> = {
  SCHEDULED: 'Agendar visita',
  IN_FIELD: 'Iniciar visita',
  AWAITING_REPORT: 'Encerrar campo',
  COMPLETED: 'Concluir levantamento',
  CANCELLED: 'Cancelar',
  PLANNED: 'Voltar a planejado',
};

export function isSurveyOpen(status: SiteSurveyStatus): boolean {
  return status !== 'COMPLETED' && status !== 'CANCELLED';
}

/** Registro de campo aceita escrita enquanto não concluído nem cancelado. */
export function isSurveyRecordable(status: SiteSurveyStatus): boolean {
  return isSurveyOpen(status);
}

export interface SurveyListItem { id: string; text: string; detail?: string | null }
export interface SurveyEquipment {
  id: string; tag: string; description: string;
  nameplate?: string | null; condition?: string | null;
}
export interface SurveyMeasurement { id: string; label: string; value: string; unit?: string | null }
export interface SurveyRisk { id: string; text: string; severity?: 'low' | 'medium' | 'high' | null }

/**
 * O que o engenheiro registra em campo. Toda seção é opcional: o celular
 * manda só o que mudou, e o servidor mescla por seção.
 */
export interface SurveyFindings {
  technical_conditions?: string | null;
  existing_infrastructure?: string | null;
  access_constraints?: string | null;
  notes?: string | null;
  equipment?: SurveyEquipment[];
  measurements?: SurveyMeasurement[];
  risks?: SurveyRisk[];
  required_materials?: SurveyListItem[];
  estimated_activities?: SurveyListItem[];
  customer_dependencies?: SurveyListItem[];
}

export interface SurveyChecklistItem {
  key: string; label: string; done: boolean; required?: boolean;
}

export interface SurveyQuestion {
  id: string; text: string; resolved: boolean; answer?: string | null;
}

/**
 * Checklist inicial. É um ponto de partida editável — não uma norma — e por
 * isso só os itens sem os quais uma proposta técnica não se sustenta nascem
 * obrigatórios.
 */
export const DEFAULT_SURVEY_CHECKLIST: SurveyChecklistItem[] = [
  { key: 'site_access', label: 'Acesso e logística do local confirmados', done: false, required: true },
  { key: 'nameplate', label: 'Dados de placa dos equipamentos registrados', done: false, required: true },
  { key: 'photos', label: 'Fotos gerais e de detalhe capturadas', done: false, required: true },
  { key: 'infrastructure', label: 'Infraestrutura existente avaliada', done: false },
  { key: 'safety', label: 'Riscos e condições de segurança identificados', done: false, required: true },
  { key: 'customer_contact', label: 'Responsável do cliente no local identificado', done: false },
  { key: 'documents', label: 'Documentos do cliente recebidos (diagramas, manuais)', done: false },
];

export const FINDING_SECTIONS: Array<{
  key: keyof SurveyFindings; label: string; kind: 'text' | 'list'; hint: string;
}> = [
  { key: 'technical_conditions', label: 'Condições técnicas', kind: 'text', hint: 'Estado geral, anomalias, tensões, temperaturas.' },
  { key: 'existing_infrastructure', label: 'Infraestrutura existente', kind: 'text', hint: 'O que já existe e será reaproveitado ou afetado.' },
  { key: 'access_constraints', label: 'Acesso e logística', kind: 'text', hint: 'Janelas, permissões, içamento, horários.' },
  { key: 'estimated_activities', label: 'Atividades estimadas', kind: 'list', hint: 'O que precisará ser feito.' },
  { key: 'required_materials', label: 'Materiais e equipamentos necessários', kind: 'list', hint: 'Instrumentos, EPIs, peças.' },
  { key: 'customer_dependencies', label: 'Dependências do cliente', kind: 'list', hint: 'O que o cliente precisa providenciar.' },
  { key: 'notes', label: 'Notas', kind: 'text', hint: 'Tudo o que não coube acima.' },
];

export interface SurveyDigest {
  checklistDone: number;
  checklistTotal: number;
  requiredPending: SurveyChecklistItem[];
  openQuestions: SurveyQuestion[];
  equipmentCount: number;
  riskCount: number;
  activityCount: number;
  hasSite: boolean;
}

const asArray = <T,>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : []);

/** Resumo determinístico — o mesmo número na tela de campo e na prontidão. */
export function digestSurvey(survey: {
  findings: unknown; checklist: unknown; open_questions: unknown;
  site_name?: string | null; site_address?: string | null;
}): SurveyDigest {
  const findings = (survey.findings && typeof survey.findings === 'object'
    ? survey.findings : {}) as SurveyFindings;
  const checklist = asArray<SurveyChecklistItem>(survey.checklist);
  const questions = asArray<SurveyQuestion>(survey.open_questions);
  return {
    checklistDone: checklist.filter((item) => item.done).length,
    checklistTotal: checklist.length,
    requiredPending: checklist.filter((item) => item.required && !item.done),
    openQuestions: questions.filter((q) => !q.resolved),
    equipmentCount: asArray(findings.equipment).length,
    riskCount: asArray(findings.risks).length,
    activityCount: asArray(findings.estimated_activities).length,
    hasSite: Boolean((survey.site_name ?? '').trim() || (survey.site_address ?? '').trim()),
  };
}

/** Identificador local para itens de lista criados no campo, sem rede. */
export function localId(prefix = 'i'): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

/** Grupos do candidato da Apex — o rótulo mora aqui porque a tela o usa. */
export const CANDIDATE_GROUPS = [
  'likely_scope', 'activities', 'deliverables', 'technical_requirements', 'materials_equipment',
  'tests_inspections', 'risks', 'customer_dependencies', 'missing_information', 'proposal_prerequisites',
] as const;
export type CandidateGroup = (typeof CANDIDATE_GROUPS)[number];

export const CANDIDATE_GROUP_LABEL: Record<CandidateGroup, string> = {
  likely_scope: 'Escopo provável',
  activities: 'Atividades',
  deliverables: 'Entregáveis',
  technical_requirements: 'Requisitos técnicos',
  materials_equipment: 'Materiais e equipamentos',
  tests_inspections: 'Ensaios e inspeções',
  risks: 'Riscos',
  customer_dependencies: 'Dependências do cliente',
  missing_information: 'Informação faltante',
  proposal_prerequisites: 'Pré-requisitos da proposta',
};

