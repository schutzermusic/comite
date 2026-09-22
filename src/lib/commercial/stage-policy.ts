/**
 * A POLÍTICA DE ETAPA do funil comercial.
 *
 * ─── Por que existe um arquivo só para isto ──────────────────────────────
 *
 * Antes, "mudar a etapa" era um campo do formulário de oportunidade: a tela
 * mandava `stage` no upsert e o banco aceitava qualquer valor da lista. O
 * efeito prático é que ganhar, perder e voltar para descoberta eram a MESMA
 * operação — indistinguíveis no histórico, sem motivo declarado e sem marco de
 * tempo. Quem perguntasse "há quanto tempo esta oportunidade está parada em
 * negociação?" não tinha onde olhar.
 *
 * Agora a transição é um ATO governado (`commercial_opportunity_transition_stage`,
 * migration 212) e este módulo é a cópia de leitura dessa regra: a tela usa
 * para saber o que oferecer, e a rota usa para recusar cedo, com uma mensagem
 * que a pessoa entende, antes do erro de banco.
 *
 * ⚠️ As regras aqui ESPELHAM o SQL. Mudar uma sem a outra cria a divergência
 * clássica: o botão aparece e a gravação falha. Os testes de unidade cobrem os
 * dois lados da mesma tabela de transições.
 */
import type { OpportunityStage } from './types';
import { OPEN_OPPORTUNITY_STAGES } from './types';

export const CLOSED_OPPORTUNITY_STAGES: OpportunityStage[] = ['WON', 'LOST', 'ABANDONED'];

export function isOpenStage(stage: OpportunityStage): boolean {
  return (OPEN_OPPORTUNITY_STAGES as string[]).includes(stage);
}

/**
 * Para onde cada etapa pode ir.
 *
 * Avanço e RECUO são ambos legítimos — negociação que volta para descoberta
 * acontece toda semana, e proibir o recuo só ensinaria o time a mentir sobre a
 * etapa. O que não existe é saída de etapa ENCERRADA: ganhar, perder e
 * abandonar são resultados, e "desganhar" seria reescrever o passado. Uma
 * oportunidade encerrada por engano se resolve abrindo outra, que é o que de
 * fato aconteceu.
 */
export const ALLOWED_STAGE_TRANSITIONS: Record<OpportunityStage, OpportunityStage[]> = {
  QUALIFICATION: ['DISCOVERY', 'PROPOSAL', 'NEGOTIATION', 'WON', 'LOST', 'ABANDONED'],
  DISCOVERY: ['QUALIFICATION', 'PROPOSAL', 'NEGOTIATION', 'WON', 'LOST', 'ABANDONED'],
  PROPOSAL: ['QUALIFICATION', 'DISCOVERY', 'NEGOTIATION', 'WON', 'LOST', 'ABANDONED'],
  NEGOTIATION: ['QUALIFICATION', 'DISCOVERY', 'PROPOSAL', 'WON', 'LOST', 'ABANDONED'],
  WON: [],
  LOST: [],
  ABANDONED: [],
};

/** Encerrar sem dizer por quê transforma o funil em um cemitério anônimo. */
export const STAGES_REQUIRING_REASON: OpportunityStage[] = ['LOST', 'ABANDONED'];

export type StageTransitionRefusal =
  | { ok: true }
  | { ok: false; reason: string };

export function checkStageTransition(
  from: OpportunityStage,
  to: OpportunityStage,
  note: string | null | undefined,
): StageTransitionRefusal {
  if (from === to) {
    return { ok: false, reason: 'A oportunidade já está nesta etapa.' };
  }
  if (!ALLOWED_STAGE_TRANSITIONS[from]?.includes(to)) {
    return {
      ok: false,
      reason: CLOSED_OPPORTUNITY_STAGES.includes(from)
        ? 'Uma oportunidade encerrada não volta ao funil. Registre uma nova oportunidade.'
        : 'Transição de etapa não permitida.',
    };
  }
  if (STAGES_REQUIRING_REASON.includes(to) && !String(note ?? '').trim()) {
    return { ok: false, reason: 'Perder ou abandonar exige o motivo declarado.' };
  }
  return { ok: true };
}

/**
 * Quantos dias uma etapa aguenta antes de o funil admitir que parou.
 *
 * São LIMIARES DECLARADOS, não previsão: quanto mais perto da decisão, menos
 * silêncio é aceitável. O número aparece na tela junto do sinal justamente
 * para que ninguém o confunda com um julgamento do sistema sobre o negócio.
 */
export const STAGE_STALL_DAYS: Record<string, number> = {
  QUALIFICATION: 21,
  DISCOVERY: 21,
  PROPOSAL: 14,
  NEGOTIATION: 10,
};

/**
 * A faixa de probabilidade que cada etapa comporta.
 *
 * O padrão do estágio (0,10 / 0,25 / 0,45 / 0,70) mora na visão
 * `commercial_forecast_read_model`. Estas faixas são mais largas de propósito:
 * o juízo de quem vende manda, e o sinal só aparece quando a probabilidade
 * informada e a etapa contam histórias incompatíveis — 95% em qualificação, ou
 * 5% em negociação. Fora disso, o sistema não opina.
 */
export const STAGE_PROBABILITY_BAND: Record<string, { min: number; max: number }> = {
  QUALIFICATION: { min: 0, max: 0.35 },
  DISCOVERY: { min: 0.05, max: 0.55 },
  PROPOSAL: { min: 0.2, max: 0.8 },
  NEGOTIATION: { min: 0.35, max: 0.95 },
};

export const DAY_MS = 86_400_000;

/**
 * Dias inteiros entre duas marcas. Negativo quando a referência é futura.
 *
 * ─── Por que DATA e CARIMBO são contados de formas diferentes ────────────
 *
 * `due_date`, `validity_until` e `expected_decision_date` são DATAS puras: o
 * que se pergunta delas é "quantos dias de calendário se passaram", e a
 * resposta não pode mudar porque o servidor está em outro fuso ou porque a
 * consulta rodou às 23h. Por isso a comparação é feita entre dias de
 * calendário, e não entre instantes — converter "2026-09-12" para um horário e
 * subtrair produz 9,875 dias, que o arredondamento transforma em 9 ou 10
 * conforme o fuso de quem roda. Um "vencido há 4 dias" que vira 5 do outro lado
 * do país é exatamente o tipo de erro que faz alguém parar de confiar no aviso.
 *
 * `stage_entered_at`, `created_at` e afins são INSTANTES, e aí o que importa é
 * o tempo decorrido — a idade de uma etapa muda ao longo do dia.
 */
export function daysBetween(from: string | null | undefined, now: Date): number | null {
  if (!from) return null;

  if (/^\d{4}-\d{2}-\d{2}$/.test(from)) {
    const [year, month, dayOfMonth] = from.split('-').map(Number);
    const reference = Date.UTC(year, month - 1, dayOfMonth);
    if (!Number.isFinite(reference)) return null;
    const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
    return Math.round((today - reference) / DAY_MS);
  }

  const start = new Date(from).getTime();
  if (!Number.isFinite(start)) return null;
  return Math.floor((now.getTime() - start) / DAY_MS);
}
