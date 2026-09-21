/**
 * CASAMENTO AUTOMÁTICO marco contratual ↔ etapa de cronograma.
 *
 * O que estes testes protegem não é a qualidade do palpite — é o TETO dele:
 * nenhuma proposta se aprova, nenhuma etapa serve a dois marcos, e ambiguidade
 * derruba a confiança em vez de escolher a primeira da lista.
 */
import { describe, it, expect } from 'vitest';
import {
  titleSimilarity, titleContainment, stripEventPrefix, extractMilestoneSequence,
  profileSchedule, buildMatchContext,
  scoreCandidate, proposeForMilestone, proposeMappings,
  PROPOSAL_MIN_CONFIDENCE, PROPOSAL_HIGH_CONFIDENCE,
  type MilestoneCandidate, type TimelineCandidate,
} from '@/lib/contracts/billing/planning/milestone-timeline-matcher';

const milestone = (over: Partial<MilestoneCandidate> = {}): MilestoneCandidate => ({
  milestoneId: 'm5', ruleId: 'r5', contractId: 'c1',
  title: 'Montagem e fechamento do enrolamento estatórico',
  description: null, sequence: 5,
  ...over,
});

const item = (over: Partial<TimelineCandidate> = {}): TimelineCandidate => ({
  timelineItemId: 't1', projectId: '2774.08/2025',
  title: 'Montagem e fechamento do enrolamento estatórico',
  wbsCode: '4.3.2', outlineLevel: 3,
  isMilestone: true, isSummary: false,
  plannedFinish: '2026-10-15', forecastFinish: null, parentTitle: 'Montagem',
  ...over,
});

describe('similaridade', () => {
  it('reconhece a mesma etapa escrita em outra ordem', () => {
    const a = 'Montagem e fechamento do enrolamento estatórico';
    const b = 'Enrolamento estatórico — fechamento e montagem';
    expect(titleSimilarity(a, b)).toBeGreaterThan(0.8);
  });

  it('ignora acento e caixa', () => {
    expect(titleSimilarity('Enrolamento Estatórico', 'enrolamento estatorico')).toBe(1);
  });

  it('não confunde etapas de assuntos diferentes', () => {
    expect(titleSimilarity(
      'Montagem e fechamento do enrolamento estatórico',
      'Mobilização do canteiro de obras',
    )).toBeLessThan(0.2);
  });

  it('título vazio não casa com nada', () => {
    expect(titleSimilarity('', 'qualquer coisa')).toBe(0);
  });
});

describe('o piso da proposta', () => {
  it('título sem relação NÃO vira proposta, mesmo com data e nível bons', () => {
    const scored = scoreCandidate(milestone(), item({
      title: 'Mobilização do canteiro', wbsCode: '5', outlineLevel: 1,
    }));
    expect(scored.score).toBeLessThan(PROPOSAL_MIN_CONFIDENCE);
    expect(proposeForMilestone(milestone(), [item({ title: 'Mobilização do canteiro' })])).toBeNull();
  });

  it('nenhum candidato devolve null — e não "o menos ruim"', () => {
    expect(proposeForMilestone(milestone(), [])).toBeNull();
  });

  it('etapa SEM data perde ponto e o diz na explicação', () => {
    const withDate = scoreCandidate(milestone(), item());
    const noDate = scoreCandidate(milestone(), item({ plannedFinish: null, forecastFinish: null }));
    expect(noDate.score).toBeLessThan(withDate.score);
    expect(noDate.reasons.join(' ')).toContain('SEM data');
  });
});

describe('ambiguidade', () => {
  const twins = [
    item({ timelineItemId: 'a', wbsCode: '4.3.2' }),
    item({ timelineItemId: 'b', wbsCode: '4.3.3' }),
  ];

  it('duas etapas equivalentes derrubam a confiança abaixo da alta', () => {
    const proposal = proposeForMilestone(milestone(), twins)!;
    expect(proposal.confidence).toBeLessThan(PROPOSAL_HIGH_CONFIDENCE);
    expect(proposal.priority).toBe('requires_attention');
    expect(proposal.ambiguousWith).toContain('b');
  });

  it('explicação nomeia a ambiguidade', () => {
    const proposal = proposeForMilestone(milestone(), twins)!;
    expect(proposal.reasons.join(' ')).toContain('Ambíguo');
  });

  it('etapa única e muito próxima vira conferência rápida', () => {
    const proposal = proposeForMilestone(milestone(), [item()])!;
    expect(proposal.confidence).toBeGreaterThanOrEqual(PROPOSAL_HIGH_CONFIDENCE);
    expect(proposal.priority).toBe('quick_review');
  });
});

describe('uma etapa não serve a dois marcos', () => {
  it('a etapa genérica não vira a data prevista de seis eventos', () => {
    const six = [1, 2, 3, 4, 5, 6].map((n) => milestone({
      milestoneId: `m${n}`, ruleId: `r${n}`, sequence: n,
      title: 'Fabricação do estator',
    }));
    const only = [item({ timelineItemId: 'unica', title: 'Fabricação do estator' })];
    const proposals = proposeMappings(six, only);

    expect(proposals).toHaveLength(1);
    expect(new Set(proposals.map((p) => p.timelineItemId)).size).toBe(proposals.length);
  });

  it('cada marco recebe a sua própria etapa quando elas existem', () => {
    const milestones = [
      milestone({ milestoneId: 'm2', ruleId: 'r2', sequence: 2, title: 'No transporte do equipamento para nossa fábrica' }),
      milestone({ milestoneId: 'm5', ruleId: 'r5', sequence: 5, title: 'Montagem e fechamento do enrolamento estatórico' }),
    ];
    const items = [
      item({ timelineItemId: 't2', title: 'Transporte do equipamento para a fábrica', wbsCode: '2.1' }),
      item({ timelineItemId: 't5', title: 'Montagem e fechamento do enrolamento estatórico', wbsCode: '4.3' }),
    ];
    const proposals = proposeMappings(milestones, items);
    expect(proposals).toHaveLength(2);
    const byMilestone = new Map(proposals.map((p) => [p.milestoneId, p.timelineItemId]));
    expect(byMilestone.get('m2')).toBe('t2');
    expect(byMilestone.get('m5')).toBe('t5');
  });
});

describe('o teto da proposta', () => {
  it('a confiança nunca passa de 1 e nunca é negativa', () => {
    const s = scoreCandidate(milestone(), item({ forecastFinish: '2026-10-15' }));
    expect(s.score).toBeLessThanOrEqual(1);
    expect(s.score).toBeGreaterThanOrEqual(0);
  });

  it('nenhuma proposta carrega estado de aceite — o tipo não tem esse campo', () => {
    const proposal = proposeForMilestone(milestone(), [item()])!;
    expect(Object.keys(proposal)).not.toContain('reviewState');
    expect(Object.keys(proposal)).not.toContain('accepted');
  });
});


// ═══════════════════════════════════════════════════════════════════════════
// O PREFIXO DE NUMERAÇÃO E A CONTINÊNCIA
//
// Os dois sinais existem por um motivo medido no cronograma real de
// JA10182283/2025: sem eles, dois dos seis eventos contratuais não alcançavam
// o piso de proposta — não porque o cronograma não os contivesse, mas porque
// "Evento 06 ·" entrava no vocabulário comparado e "(Databook)" ficava de fora.
// ═══════════════════════════════════════════════════════════════════════════

describe('prefixo de numeração do marco', () => {
  it('remove a numeração contratual do texto comparado', () => {
    expect(stripEventPrefix('Evento 02 · No transporte do equipamento'))
      .toBe('No transporte do equipamento');
    expect(stripEventPrefix('Parcela 3 - Montagem')).toBe('Montagem');
    expect(stripEventPrefix('Etapa 10: Comissionamento')).toBe('Comissionamento');
  });

  it('não toca em título que não começa por numeração', () => {
    expect(stripEventPrefix('Transporte do equipamento'))
      .toBe('Transporte do equipamento');
    // "Evento" no meio da frase não é prefixo de parcela.
    expect(stripEventPrefix('Relatório do Evento 02'))
      .toBe('Relatório do Evento 02');
  });

  it('a numeração não se perde — ela volta como sequência', () => {
    expect(extractMilestoneSequence('Evento 02 · No transporte')).toBe(2);
    expect(extractMilestoneSequence('Transporte do equipamento')).toBeNull();
  });
});

describe('continência', () => {
  it('reconhece o título do contrato contido no do cronograma', () => {
    // O cronograma acrescenta o artefato; o contrato não o nomeia.
    expect(titleContainment('Relatório final', 'Relatório final (Databook)'))
      .toBeGreaterThan(titleSimilarity('Relatório final', 'Relatório final (Databook)'));
  });

  it('nunca afirma igualdade: o sinal é amortecido', () => {
    expect(titleContainment('Enrolamento estatórico', 'Enrolamento estatórico'))
      .toBeLessThan(1);
  });

  it('recusa casar por uma palavra só', () => {
    // "Montagem" cabe em metade de um cronograma de obra. Continência aqui
    // seria um falso positivo com cara de certeza.
    expect(titleContainment('Montagem', 'Montagem do Gerador')).toBe(0);
  });
});

describe('cronograma real de JA10182283/2025', () => {
  const schedule: TimelineCandidate[] = [
    ['1.1.1', 'Assinatura do contrato e liberação para início', '2025-11-03'],
    ['1.1.2', 'Transporte do equipamento para fábrica', '2025-11-20'],
    ['1.1.3', 'Sacar Bobinas e Pedido de materiais', '2025-11-21'],
    ['1.1.4', 'Apresentação dos materiais em fábrica e projetos/desenhos', '2025-12-15'],
    ['1.1.5', 'Relatório final (Databook)', '2026-08-14'],
  ].map(([wbsCode, title, plannedFinish]) => item({
    timelineItemId: `t-${wbsCode}`, title, wbsCode, outlineLevel: 3,
    isMilestone: false, isSummary: false, plannedFinish,
    parentTitle: 'Marcos gerais',
  }));

  const contractMilestone = (seq: number, title: string): MilestoneCandidate =>
    milestone({ milestoneId: `m${seq}`, ruleId: `r${seq}`, title, sequence: seq });

  it('casa o Evento 02 com a EDT 1.1.2 — o exemplo do escopo', () => {
    const p = proposeForMilestone(
      contractMilestone(2, 'Evento 02 · No transporte do equipamento para nossa fábrica (CIF)'),
      schedule,
    );
    expect(p?.timelineItemId).toBe('t-1.1.2');
    expect(p!.confidence).toBeGreaterThan(PROPOSAL_MIN_CONFIDENCE);
  });

  it('casa o Evento 06 com o Relatório final, que o prefixo antes escondia', () => {
    const p = proposeForMilestone(
      contractMilestone(6, 'Evento 06 · Na entrega do relatório final'),
      schedule,
    );
    expect(p?.timelineItemId).toBe('t-1.1.5');
  });

  it('não casa o Evento 05: nenhuma etapa destas o sustenta', () => {
    const p = proposeForMilestone(
      contractMilestone(5, 'Evento 05 · Montagem e fechamento do enrolamento estatórico'),
      schedule,
    );
    expect(p).toBeNull();
  });

  it('nenhuma proposta nasce aceita, por mais alta que seja a confiança', () => {
    const proposals = proposeMappings(
      [contractMilestone(1, 'Evento 01 · Na assinatura do contrato e liberação para início')],
      schedule,
    );
    expect(proposals).toHaveLength(1);
    expect(proposals[0].confidence).toBeGreaterThan(PROPOSAL_HIGH_CONFIDENCE);
    // O tipo da proposta não tem, e não pode ganhar, um campo de aceite.
    expect(Object.keys(proposals[0])).not.toContain('reviewState');
    expect(Object.keys(proposals[0])).not.toContain('accepted');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// CRONOGRAMA SEM RAMO DE MARCOS
//
// Alguns planejadores criam "Marcos / Marcos gerais"; outros não criam nada
// disso. O casamento não pode depender dessa escolha — e a forma de provar
// isso é um cronograma que não tem marco nenhum, só obra.
// ═══════════════════════════════════════════════════════════════════════════

const OPERATIONAL: readonly [string, string, number, boolean, string | null, string][] = [
  ['5',     'Serviços em campo (MONTAGEM)', 1, true,  null,  '2026-08-14'],
  ['5.2',   'Bobinagem do estator',         2, true,  '5',   '2026-07-31'],
  ['5.2.1', 'Montagem de bobinas',          3, false, '5.2', '2026-06-26'],
  ['5.2.2', 'Cunhagem e amarrações',        3, false, '5.2', '2026-07-03'],
  ['5.2.3', 'Fechamento do enrolamento',    3, false, '5.2', '2026-07-20'],
  ['5.3',   'Ensaios elétricos',            2, false, '5',   '2026-07-31'],
];

const operationalSchedule = (): TimelineCandidate[] =>
  OPERATIONAL.map(([wbsCode, title, outlineLevel, isSummary, parent, plannedFinish]) => item({
    timelineItemId: `t-${wbsCode}`, title, wbsCode, outlineLevel,
    isMilestone: false, isSummary, plannedFinish, forecastFinish: null,
    parentTitle: parent ? OPERATIONAL.find((r) => r[0] === parent)![1] : null,
  }));

describe('cronograma sem marcos formais', () => {
  const schedule = operationalSchedule();
  const evento05 = milestone({
    milestoneId: 'm5', ruleId: 'r5',
    title: 'Evento 05 · Montagem e fechamento do enrolamento estatórico',
    sequence: 5,
  });

  it('o perfil reconhece a ausência de marcos', () => {
    expect(profileSchedule(schedule).hasMilestones).toBe(false);
    expect(profileSchedule([item({ isMilestone: true })]).hasMilestones).toBe(true);
  });

  it('ancora na tarefa operacional que representa o gatilho', () => {
    const p = proposeForMilestone(evento05, schedule, buildMatchContext(schedule));
    expect(p?.timelineItemId).toBe('t-5.2.3');
  });

  it('a tarefa-folha profunda não é punida por profundidade', () => {
    // "5.2.3 Fechamento do enrolamento" (nível 3) tem de vencer
    // "5.3 Ensaios elétricos" (nível 2) — significado, não profundidade.
    const ctx = buildMatchContext(schedule);
    const fechamento = scoreCandidate(evento05, schedule.find((i) => i.wbsCode === '5.2.3')!, ctx);
    const ensaios = scoreCandidate(evento05, schedule.find((i) => i.wbsCode === '5.3')!, ctx);
    expect(fechamento.score).toBeGreaterThan(ensaios.score);
  });

  it('a tarefa-folha vence a fase que a contém', () => {
    const ctx = buildMatchContext(schedule);
    const folha = scoreCandidate(evento05, schedule.find((i) => i.wbsCode === '5.2.3')!, ctx);
    const fase = scoreCandidate(evento05, schedule.find((i) => i.wbsCode === '5.2')!, ctx);
    expect(folha.score).toBeGreaterThan(fase.score);
  });

  it('a EDT não é mais confundida com a numeração do contrato', () => {
    /*
      Antes, qualquer linha sob o ramo "5" casava com o "Evento 05" — a fase,
      as tarefas, os ensaios. O sinal ficava uniforme dentro do ramo e
      enviesado contra todos os outros, sem ninguém ter afirmado relação.
    */
    const ctx = buildMatchContext(schedule);
    for (const candidate of schedule) {
      const { reasons } = scoreCandidate(evento05, candidate, ctx);
      expect(reasons.join(' ')).not.toMatch(/Numeração compatível/);
    }
  });

  it('numeração só conta quando a ETAPA a cita no título', () => {
    const explicit = item({
      timelineItemId: 't-x', title: 'Evento 05 — fechamento', wbsCode: '9.9',
    });
    const { reasons } = scoreCandidate(evento05, explicit, buildMatchContext([explicit]));
    expect(reasons.join(' ')).toMatch(/cita o evento 5 no título/);
  });
});

describe('ordem: os eventos já ancorados estreitam a janela dos vizinhos', () => {
  const schedule = operationalSchedule();
  const evento05 = milestone({
    milestoneId: 'm5', ruleId: 'r5', title: 'Evento 05 · Fechamento', sequence: 5,
  });
  // Evento 04 ancorado em junho, Evento 06 em agosto: o 05 cai entre os dois.
  const anchors = [
    { sequence: 4, date: '2026-06-30' },
    { sequence: 6, date: '2026-08-01' },
  ];

  it('premia o candidato dentro da janela dos vizinhos', () => {
    const ctx = buildMatchContext(schedule, anchors);
    const dentro = scoreCandidate(evento05, schedule.find((i) => i.wbsCode === '5.2.3')!, ctx);
    expect(dentro.reasons.join(' ')).toMatch(/Posição na linha do tempo compatível/);
  });

  it('penaliza o candidato FORA da ordem contratual', () => {
    const fora = item({
      timelineItemId: 't-cedo', title: 'Fechamento do enrolamento',
      wbsCode: '2.1', plannedFinish: '2026-01-10',
      isMilestone: false, isSummary: false, outlineLevel: 3,
    });
    const ctx = buildMatchContext([...schedule, fora], anchors);
    const antes = scoreCandidate(evento05, fora, ctx);
    const dentro = scoreCandidate(evento05, schedule.find((i) => i.wbsCode === '5.2.3')!, ctx);
    // Mesmo título, datas diferentes: a ordem é o que separa os dois.
    expect(antes.score).toBeLessThan(dentro.score);
    expect(antes.reasons.join(' ')).toMatch(/FORA da ordem/);
  });

  it('sem âncoras o sinal é neutro — não pune quem não tem vizinho', () => {
    // O primeiro evento de um contrato novo não pode ser penalizado por ser
    // o primeiro.
    const semAncora = scoreCandidate(evento05, schedule[4], buildMatchContext(schedule));
    const comAncora = scoreCandidate(evento05, schedule[4], buildMatchContext(schedule, anchors));
    expect(comAncora.score).toBeGreaterThan(semAncora.score);
    expect(semAncora.score).toBeGreaterThan(0.5);
  });
});

describe('recusa humana vale para o PAR, não para o marco', () => {
  const schedule = operationalSchedule();
  const evento05 = milestone({
    milestoneId: 'm5', ruleId: 'r5',
    title: 'Evento 05 · Montagem e fechamento do enrolamento estatórico', sequence: 5,
  });

  it('não repropõe a etapa recusada', () => {
    const ctx = buildMatchContext(schedule, [], new Set(['r5::t-5.2.3']));
    expect(proposeForMilestone(evento05, schedule, ctx)?.timelineItemId).not.toBe('t-5.2.3');
  });

  it('mas continua procurando outra etapa para o mesmo marco', () => {
    /*
      Recusar "Evento 05 ↔ Fechamento" diz que AQUELA etapa não é o marco —
      não que nenhuma seja. A versão anterior tirava o marco inteiro do lote e
      ele caía em SEM VÍNCULO para sempre.
    */
    const ctx = buildMatchContext(schedule, [], new Set(['r5::t-5.2.3']));
    const p = proposeForMilestone(evento05, schedule, ctx);
    expect(p).not.toBeNull();
    expect(p!.timelineItemId).toBe('t-5.2.1');
  });
});
