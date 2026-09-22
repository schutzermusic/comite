/**
 * Sinais determinísticos do funil e política de etapa.
 *
 * Estes testes são o contrato do que o produto promete no §7 do escopo: cada
 * sinal sai de uma regra sobre datas e estados, e não de um modelo. Por isso
 * cada caso aqui fixa o "agora" e descreve o limiar em números — se alguém
 * mudar um limiar sem querer, o teste diz qual.
 *
 * Eles também guardam a paridade com o SQL: a tabela de transições daqui é a
 * mesma que `commercial_opportunity_transition_stage` (migration 212) cobra.
 * Divergir uma sem a outra é o defeito clássico — o botão aparece e a gravação
 * falha.
 */
import { describe, it, expect } from 'vitest';
import {
  buildPipelineSignals, governingRevision, signalsByOpportunity,
  type SignalFollowup, type SignalOpportunity, type SignalProposal, type SignalRevision,
} from '@/lib/commercial/pipeline-signals';
import {
  ALLOWED_STAGE_TRANSITIONS, STAGE_PROBABILITY_BAND, STAGE_STALL_DAYS,
  checkStageTransition, daysBetween, isOpenStage,
} from '@/lib/commercial/stage-policy';
import type { OpportunityStage } from '@/lib/commercial/types';

const NOW = new Date('2026-09-22T12:00:00.000Z');
const daysAgo = (n: number) =>
  new Date(NOW.getTime() - n * 86_400_000).toISOString();
const dateAgo = (n: number) => daysAgo(n).slice(0, 10);
const dateAhead = (n: number) => dateAgo(-n);

function opportunity(overrides: Partial<SignalOpportunity> = {}): SignalOpportunity {
  return {
    id: 'opp-1',
    title: 'Modernização do parque de ativos',
    counterparty_name: 'Contraparte QA Ltda.',
    stage: 'NEGOTIATION',
    probability: 0.6,
    expected_decision_date: dateAhead(20),
    stage_entered_at: daysAgo(2),
    engagement_id: null,
    closed_at: null,
    ...overrides,
  };
}

function followup(overrides: Partial<SignalFollowup> = {}): SignalFollowup {
  return {
    id: 'f-1',
    source_kind: 'commercial_opportunity',
    source_id: 'opp-1',
    state: 'ACTIVE',
    due_date: dateAhead(3),
    next_expected_event: null,
    next_expected_event_at: null,
    goal: 'Obter a resposta do cliente',
    ...overrides,
  };
}

const kinds = (input: Parameters<typeof buildPipelineSignals>[0]) =>
  buildPipelineSignals({ ...input, now: NOW }).map((signal) => signal.kind);

const base = {
  opportunities: [opportunity()],
  followups: [followup()],
  proposals: [] as SignalProposal[],
  revisions: [] as SignalRevision[],
};

describe('sinais do funil', () => {
  it('não acusa nada quando prazo, próxima ação e probabilidade estão coerentes', () => {
    expect(kinds(base)).toEqual([]);
  });

  it('acusa ausência de próxima ação quando nenhum acompanhamento está aberto', () => {
    expect(kinds({ ...base, followups: [] })).toContain('NO_NEXT_ACTION');
  });

  it('não acusa ausência de próxima ação quando o acompanhamento é da PROPOSTA ligada', () => {
    const result = kinds({
      ...base,
      followups: [followup({ id: 'f-2', source_kind: 'commercial_proposal', source_id: 'prop-1' })],
      proposals: [{ id: 'prop-1', proposal_number: 'PC-1', opportunity_id: 'opp-1', title: 'PC' }],
    });
    expect(result).not.toContain('NO_NEXT_ACTION');
  });

  it('ignora acompanhamento encerrado ao procurar a próxima ação', () => {
    expect(kinds({ ...base, followups: [followup({ state: 'COMPLETED' })] }))
      .toContain('NO_NEXT_ACTION');
    expect(kinds({ ...base, followups: [followup({ state: 'CANCELLED' })] }))
      .toContain('NO_NEXT_ACTION');
  });

  it('acusa retorno do cliente atrasado só depois da data esperada', () => {
    const waitingUntil = (date: string) =>
      kinds({
        ...base,
        followups: [followup({ state: 'WAITING_EXTERNAL_PARTY', next_expected_event_at: date })],
      });
    expect(waitingUntil(dateAhead(2))).not.toContain('CUSTOMER_RESPONSE_OVERDUE');
    expect(waitingUntil(dateAgo(0))).not.toContain('CUSTOMER_RESPONSE_OVERDUE');
    expect(waitingUntil(dateAgo(4))).toContain('CUSTOMER_RESPONSE_OVERDUE');
  });

  it('marca o atraso do cliente como bloqueante e traz os dias no título', () => {
    const [signal] = buildPipelineSignals({
      ...base,
      followups: [followup({ state: 'WAITING_EXTERNAL_PARTY', next_expected_event_at: dateAgo(5) })],
      now: NOW,
    });
    expect(signal.severity).toBe('blocking');
    expect(signal.title).toContain('5 dia');
  });

  it('acusa oportunidade parada apenas ACIMA do limiar da etapa', () => {
    const limit = STAGE_STALL_DAYS.NEGOTIATION;
    const atLimit = kinds({
      ...base,
      opportunities: [opportunity({ stage_entered_at: daysAgo(limit) })],
    });
    const past = kinds({
      ...base,
      opportunities: [opportunity({ stage_entered_at: daysAgo(limit + 1) })],
    });
    expect(atLimit).not.toContain('OPPORTUNITY_STALLED');
    expect(past).toContain('OPPORTUNITY_STALLED');
  });

  it('usa o limiar de CADA etapa, e não um número único', () => {
    expect(STAGE_STALL_DAYS.QUALIFICATION).toBeGreaterThan(STAGE_STALL_DAYS.NEGOTIATION);
    const parado = kinds({
      ...base,
      opportunities: [opportunity({ stage: 'QUALIFICATION', probability: null, stage_entered_at: daysAgo(12) })],
    });
    expect(parado).not.toContain('OPPORTUNITY_STALLED');
  });

  it('acusa oportunidade aberta sem previsão de decisão', () => {
    expect(kinds({
      ...base,
      opportunities: [opportunity({ expected_decision_date: null })],
    })).toContain('MISSING_EXPECTED_CLOSE');
  });

  it('acusa probabilidade incompatível com a etapa, nas duas pontas', () => {
    const band = STAGE_PROBABILITY_BAND.NEGOTIATION;
    expect(kinds({ ...base, opportunities: [opportunity({ probability: band.max + 0.02 })] }))
      .toContain('STAGE_PROBABILITY_INCONSISTENT');
    expect(kinds({ ...base, opportunities: [opportunity({ probability: band.min - 0.02 })] }))
      .toContain('STAGE_PROBABILITY_INCONSISTENT');
    expect(kinds({ ...base, opportunities: [opportunity({ probability: band.max })] }))
      .not.toContain('STAGE_PROBABILITY_INCONSISTENT');
  });

  it('não opina sobre probabilidade quando ela não foi informada', () => {
    expect(kinds({ ...base, opportunities: [opportunity({ probability: null })] }))
      .not.toContain('STAGE_PROBABILITY_INCONSISTENT');
  });

  const proposal: SignalProposal = {
    id: 'prop-1', proposal_number: 'PC-2026-004', opportunity_id: 'opp-1', title: 'Proposta',
  };
  const revision = (overrides: Partial<SignalRevision> = {}): SignalRevision => ({
    id: 'rev-2', proposal_id: 'prop-1', revision: 2, status: 'SENT',
    validity_until: dateAhead(3), ...overrides,
  });

  it('avisa da validade a vencer somente dentro da janela de sete dias', () => {
    expect(kinds({ ...base, proposals: [proposal], revisions: [revision({ validity_until: dateAhead(3) })] }))
      .toContain('PROPOSAL_EXPIRING');
    expect(kinds({ ...base, proposals: [proposal], revisions: [revision({ validity_until: dateAhead(30) })] }))
      .not.toContain('PROPOSAL_EXPIRING');
  });

  it('trata validade já vencida como bloqueante, e não como aviso', () => {
    const signals = buildPipelineSignals({
      ...base, proposals: [proposal],
      revisions: [revision({ validity_until: dateAgo(2) })], now: NOW,
    });
    const lapsed = signals.find((s) => s.kind === 'PROPOSAL_VALIDITY_LAPSED');
    expect(lapsed?.severity).toBe('blocking');
    expect(signals.map((s) => s.kind)).not.toContain('PROPOSAL_EXPIRING');
  });

  it('não cobra validade de revisão que não está com o cliente', () => {
    for (const status of ['DRAFT', 'INTERNAL_REVIEW', 'ACCEPTED', 'REJECTED'] as const) {
      expect(kinds({
        ...base, proposals: [proposal],
        revisions: [revision({ status, validity_until: dateAgo(2) })],
      })).not.toContain('PROPOSAL_VALIDITY_LAPSED');
    }
  });

  it('acusa ganha sem trabalho autorizado, e só enquanto não houver engajamento', () => {
    const won = opportunity({ stage: 'WON', closed_at: daysAgo(1), probability: null });
    expect(kinds({ ...base, opportunities: [won], followups: [] }))
      .toEqual(['WON_WITHOUT_AUTHORIZED_WORK']);
    expect(kinds({
      ...base,
      opportunities: [{ ...won, engagement_id: 'eng-1' }],
      followups: [],
    })).toEqual([]);
  });

  it('não emite sinais de funil para oportunidade encerrada', () => {
    for (const stage of ['LOST', 'ABANDONED'] as OpportunityStage[]) {
      expect(kinds({
        ...base,
        opportunities: [opportunity({ stage, closed_at: daysAgo(1), expected_decision_date: null })],
        followups: [],
      })).toEqual([]);
    }
  });

  it('ordena bloqueantes antes de atenção e de informativo', () => {
    const signals = buildPipelineSignals({
      opportunities: [opportunity({ expected_decision_date: null, stage_entered_at: daysAgo(40) })],
      followups: [followup({ state: 'WAITING_EXTERNAL_PARTY', next_expected_event_at: dateAgo(3) })],
      proposals: [], revisions: [], now: NOW,
    });
    expect(signals[0].severity).toBe('blocking');
    expect(signals.at(-1)?.severity).toBe('info');
  });

  it('indexa os sinais pela oportunidade a que pertencem', () => {
    const signals = buildPipelineSignals({
      ...base, opportunities: [opportunity(), opportunity({ id: 'opp-2' })],
      followups: [], now: NOW,
    });
    const index = signalsByOpportunity(signals);
    expect(index.get('opp-1')?.length).toBeGreaterThan(0);
    expect(index.get('opp-2')?.length).toBeGreaterThan(0);
  });
});

describe('revisão regente', () => {
  const rows: SignalRevision[] = [
    { id: 'r1', proposal_id: 'p', revision: 1, status: 'SUPERSEDED', validity_until: null },
    { id: 'r2', proposal_id: 'p', revision: 2, status: 'ACCEPTED', validity_until: null },
    { id: 'r3', proposal_id: 'p', revision: 3, status: 'DRAFT', validity_until: null },
  ];

  it('mantém a ACEITA regendo mesmo com rascunho mais novo em cima', () => {
    expect(governingRevision(rows).get('p')?.id).toBe('r2');
  });

  it('cai para a revisão mais recente quando nenhuma foi aceita', () => {
    const semAceite = rows.map((row) =>
      row.status === 'ACCEPTED' ? { ...row, status: 'SENT' as const } : row);
    expect(governingRevision(semAceite).get('p')?.id).toBe('r3');
  });

  it('independe da ordem em que as revisões chegam', () => {
    expect(governingRevision([...rows].reverse()).get('p')?.id).toBe('r2');
  });
});

describe('política de etapa', () => {
  it('permite avanço e recuo entre etapas abertas', () => {
    expect(checkStageTransition('NEGOTIATION', 'DISCOVERY', null)).toEqual({ ok: true });
    expect(checkStageTransition('QUALIFICATION', 'NEGOTIATION', null)).toEqual({ ok: true });
  });

  it('recusa sair de etapa encerrada — não existe "desganhar"', () => {
    for (const stage of ['WON', 'LOST', 'ABANDONED'] as OpportunityStage[]) {
      const verdict = checkStageTransition(stage, 'NEGOTIATION', 'tentativa');
      expect(verdict.ok).toBe(false);
      expect(ALLOWED_STAGE_TRANSITIONS[stage]).toEqual([]);
    }
  });

  it('recusa transição para a própria etapa', () => {
    expect(checkStageTransition('PROPOSAL', 'PROPOSAL', null).ok).toBe(false);
  });

  it('exige motivo para perder e abandonar, e não para ganhar', () => {
    expect(checkStageTransition('NEGOTIATION', 'LOST', null).ok).toBe(false);
    expect(checkStageTransition('NEGOTIATION', 'LOST', '   ').ok).toBe(false);
    expect(checkStageTransition('NEGOTIATION', 'ABANDONED', 'cliente sumiu')).toEqual({ ok: true });
    expect(checkStageTransition('NEGOTIATION', 'WON', null)).toEqual({ ok: true });
  });

  it('classifica etapa aberta e encerrada da mesma forma que o forecast', () => {
    expect(['QUALIFICATION', 'DISCOVERY', 'PROPOSAL', 'NEGOTIATION'].every(
      (stage) => isOpenStage(stage as OpportunityStage))).toBe(true);
    expect(['WON', 'LOST', 'ABANDONED'].some(
      (stage) => isOpenStage(stage as OpportunityStage))).toBe(false);
  });

  it('conta dias inteiros, aceitando data pura e carimbo completo', () => {
    expect(daysBetween('2026-09-12', NOW)).toBe(10);
    expect(daysBetween('2026-09-12T12:00:00.000Z', NOW)).toBe(10);
    expect(daysBetween(null, NOW)).toBeNull();
    expect(daysBetween('2026-09-30', NOW)).toBeLessThan(0);
  });
});
