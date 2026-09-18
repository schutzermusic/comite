/**
 * DERIVAÇÃO DE ESTÁGIO E SOBREPOSIÇÃO DO MARCO.
 *
 * Os testes que importam aqui não são os felizes — são os que provam as
 * RECUSAS: que progresso de projeto não vira medição, que medição não vira
 * aceite, que aceite não vira faturamento, e que proposta de mapeamento não
 * vira etapa mapeada.
 */
import { describe, it, expect } from 'vitest';
import {
  deriveStage, deriveOverlays, deriveChain, deriveAction,
  assessMilestone, groupMilestones, GROUP_ORDER,
} from '@/lib/contracts/measurement/milestone-stage';
import type { MilestoneWorkbenchRow } from '@/lib/contracts/measurement/milestone-workbench-types';
import { toWorkbenchRow } from '@/lib/contracts/measurement/milestone-workbench-types';

/** Marco cru mínimo: contrato registrado, nada operacional. */
const base = (over: Partial<MilestoneWorkbenchRow> = {}): MilestoneWorkbenchRow => ({
  id: 'm1', organizationId: 'o1', contractId: 'c1', projectId: 'p1',
  title: 'Evento 01', description: null, milestoneType: 'evento_contratual',
  status: 'pending', dueDate: null, completedAt: null,
  billingAmount: 803233.98, measuredAmount: null,
  ownerUserId: null, evidence: null, evidenceDocumentId: null,
  entitlementAmount: 803233.98, entitlementCurrency: 'BRL',
  entitlementSourceDocumentId: 'd1', entitlementSourcePage: 1,
  entitlementSourceReference: 'Parte A, item 4', entitlementRuleCount: 1,
  requirementId: 'r1', requirementCount: 1,
  customerAcceptanceRequired: true, evidenceRequired: true,
  requiredDocumentType: 'boletim_medicao', reportRequired: false, technicalReportRequired: false,
  governedMappingCount: 0, timelineItemId: null, timelineProjectId: null,
  timelineTitle: null, timelineWbsCode: null, timelineStatus: null,
  timelinePercentComplete: null, timelinePlannedFinish: null, timelineActualFinish: null,
  measurementId: null, measurementStatus: null, measurementReadiness: null,
  measurementReadinessReasons: [], measurementExpectedAt: null,
  measurementSubmittedAt: null, measurementAcceptedAt: null,
  acceptedValue: null, acceptedCurrency: null,
  measurementEvidenceCount: null, measurementMissingRequirementCount: null,
  billingEventId: null, billingEligibilityState: null, billingReleaseState: null,
  billingEligibleAmount: null, billingCurrency: null, billingAmountSource: null,
  billingFiscalDocumentStatus: null, billingReceivableStatus: null, billingFinanceLinkState: null,
  ...over,
});

/** Marco com ponte governada até uma etapa real. */
const mapped = (over: Partial<MilestoneWorkbenchRow> = {}) => base({
  governedMappingCount: 1, timelineItemId: 't1', timelineProjectId: 'p1',
  timelineTitle: 'Transporte do estator', timelineWbsCode: '3.2.1',
  timelineStatus: 'in_progress', ...over,
});

/**
 * Marco genuinamente elegível: aceite REGISTRADO e evidência anexada.
 *
 * Existe para que nenhum teste volte a usar `status: 'measured'` como atalho
 * para "pronto para faturar" — foi esse atalho que virou defeito.
 */
const billable = (over: Partial<MilestoneWorkbenchRow> = {}) => base({
  status: 'approved', evidenceDocumentId: 'd1', measuredAmount: 803233.98, ...over,
});

describe('deriveStage — matriz de estágios', () => {
  it('sem exigência registrada → UNINSTRUMENTED', () => {
    expect(deriveStage(base({ requirementId: null, requirementCount: 0 })).stage)
      .toBe('UNINSTRUMENTED');
  });

  it('com exigência e sem mapeamento governado → UNMAPPED', () => {
    expect(deriveStage(base()).stage).toBe('UNMAPPED');
  });

  it('mapeado com etapa em curso → TRIGGER_PENDING', () => {
    expect(deriveStage(mapped()).stage).toBe('TRIGGER_PENDING');
  });

  it('mapeado com etapa concluída → READY_TO_MEASURE', () => {
    expect(deriveStage(mapped({ timelineStatus: 'completed' })).stage).toBe('READY_TO_MEASURE');
    expect(deriveStage(mapped({ timelineActualFinish: '2026-03-01' })).stage).toBe('READY_TO_MEASURE');
  });

  it('medição submetida → AWAITING_ACCEPTANCE', () => {
    expect(deriveStage(mapped({ measurementId: 'x', measurementStatus: 'SUBMITTED' })).stage)
      .toBe('AWAITING_ACCEPTANCE');
    expect(deriveStage(mapped({ measurementId: 'x', measurementStatus: 'UNDER_REVIEW' })).stage)
      .toBe('AWAITING_ACCEPTANCE');
  });

  it('prontidão INCOMPLETE → AWAITING_EVIDENCE', () => {
    expect(deriveStage(mapped({
      measurementId: 'x', measurementStatus: 'IN_PREPARATION', measurementReadiness: 'INCOMPLETE',
    })).stage).toBe('AWAITING_EVIDENCE');
  });

  it('prontidão BLOCKED vence qualquer outro sinal de medição', () => {
    expect(deriveStage(mapped({
      measurementId: 'x', measurementStatus: 'SUBMITTED', measurementReadiness: 'BLOCKED',
    })).stage).toBe('BLOCKED');
  });

  it('medição ACEITA → READY_TO_BILL', () => {
    expect(deriveStage(mapped({
      measurementId: 'x', measurementStatus: 'ACCEPTED', measurementEvidenceCount: 1,
    })).stage).toBe('READY_TO_BILL');
  });

  it('marco medido com aceite exigido → AWAITING_ACCEPTANCE, não READY_TO_BILL', () => {
    expect(deriveStage(base({ status: 'measured', customerAcceptanceRequired: true })).stage)
      .toBe('AWAITING_ACCEPTANCE');
  });

  it('marco medido SEM aceite exigido e com evidência → READY_TO_BILL', () => {
    expect(deriveStage(base({
      status: 'measured', customerAcceptanceRequired: false, evidenceDocumentId: 'd1',
    })).stage).toBe('READY_TO_BILL');
  });

  it('marco aprovado com condições restantes satisfeitas → READY_TO_BILL', () => {
    expect(deriveStage(base({ status: 'approved', evidenceDocumentId: 'd1' })).stage)
      .toBe('READY_TO_BILL');
  });

  it('marco aprovado sem a evidência exigida → AWAITING_EVIDENCE', () => {
    expect(deriveStage(base({ status: 'approved', evidenceRequired: true })).stage)
      .toBe('AWAITING_EVIDENCE');
  });

  it('evento de faturamento existente → BILLED', () => {
    expect(deriveStage(base({ billingEventId: 'b1' })).stage).toBe('BILLED');
  });

  it('cancelado vence tudo, inclusive faturamento', () => {
    expect(deriveStage(base({ status: 'cancelled', billingEventId: 'b1' })).stage).toBe('CANCELLED');
  });

  it('medição sem prontidão resolvida → UNKNOWN, não um dos lados', () => {
    const s = deriveStage(mapped({ measurementId: 'x', measurementStatus: 'PLANNED' }));
    expect(s.stage).toBe('UNKNOWN');
    expect(s.dashed).toBe(true);
  });
});

describe('recusas — o que a derivação NUNCA faz', () => {
  it('não promove mapeamento não-governado a mapeado', () => {
    // A visão já filtra proposta; a checagem dupla garante que trocar a fonte
    // não reabra o caminho.
    const proposedOnly = base({ governedMappingCount: 0, timelineItemId: 't1' });
    expect(deriveStage(proposedOnly).stage).toBe('UNMAPPED');
  });

  it('não lê 100% de avanço como gatilho ocorrido', () => {
    const s = deriveStage(mapped({ timelinePercentComplete: 100, timelineStatus: 'in_progress' }));
    expect(s.stage).toBe('TRIGGER_PENDING');
    expect(s.triggerAssessed).toBe(false);
  });

  it('não deriva aceite de execução concluída', () => {
    const s = deriveStage(mapped({ timelineStatus: 'completed' }));
    expect(s.stage).toBe('READY_TO_MEASURE');
    expect(s.stage).not.toBe('READY_TO_BILL');
  });

  it('não deriva faturamento de medição aceita', () => {
    const row = mapped({
      measurementId: 'x', measurementStatus: 'ACCEPTED', measurementEvidenceCount: 1,
    });
    expect(deriveStage(row).stage).toBe('READY_TO_BILL');
    expect(row.billingEventId).toBeNull();
    expect(deriveChain(row).find((l) => l.key === 'billing')?.fact).toBe(false);
  });

  it('não usa a data de hoje para decidir que um gatilho ocorreu', () => {
    const futuro = new Date('2099-01-01T00:00:00Z');
    expect(deriveStage(base()).stage).toBe('UNMAPPED');
    // Mesmo daqui a 70 anos, sem cronograma o estágio não muda.
    expect(deriveOverlays(base(), futuro)).not.toContain('OVERDUE');
  });

  it('não deriva aceite de medição própria', () => {
    // `measured` é a afirmação de quem EXECUTOU. O nó de aceite pertence à
    // Contratante, e acendê-lo aqui era o mesmo erro que liberava o estágio.
    const row = base({ status: 'measured' });
    expect(deriveChain(row).find((l) => l.key === 'acceptance')?.fact).toBe(false);
    expect(deriveChain(base({ status: 'approved' })).find((l) => l.key === 'acceptance')?.fact)
      .toBe(true);
  });

  it('triggerAssessed é falso em todo estágio anterior a READY_TO_MEASURE', () => {
    for (const row of [
      base({ requirementId: null }), base(), mapped(),
      mapped({ measurementId: 'x', measurementStatus: 'PLANNED' }),
    ]) {
      expect(deriveStage(row).triggerAssessed).toBe(false);
    }
  });
});

describe('autoridade do aceite — medir sozinho NUNCA libera faturamento', () => {
  /*
    A regressão que este bloco existe para impedir.

    Antes, `status IN ('measured','approved')` caía direto em READY_TO_BILL. Num
    contrato que exige aprovação de Boletim de Medição — JA10182283/2025 exige
    nos seis eventos — isso deixava a própria Contratada destravar o botão
    "Gerar faturamento" apurando a si mesma. O aceite é ato da Contratante, e é
    ele, e não a medição, que abre o caminho do dinheiro.
  */

  /** Toda combinação de exigência de aceite, para não testar só o caso feliz. */
  const cases = [
    { label: 'aceite exigido, nada aceito', over: { customerAcceptanceRequired: true } },
    {
      label: 'aceite exigido, medição apenas submetida',
      over: { customerAcceptanceRequired: true, measurementId: 'x', measurementStatus: 'SUBMITTED' as const },
    },
    {
      label: 'aceite exigido, medição em revisão',
      over: { customerAcceptanceRequired: true, measurementId: 'x', measurementStatus: 'UNDER_REVIEW' as const },
    },
    {
      label: 'aceite exigido, evidência anexada e etapa concluída',
      over: {
        customerAcceptanceRequired: true, evidenceDocumentId: 'd1',
        governedMappingCount: 1, timelineItemId: 't1', timelineStatus: 'completed' as const,
      },
    },
    {
      label: 'aceite exigido, valor já apurado',
      over: { customerAcceptanceRequired: true, measuredAmount: 803233.98 },
    },
  ];

  for (const { label, over } of cases) {
    it(`medido + ${label} → AWAITING_ACCEPTANCE`, () => {
      const stage = deriveStage(base({ status: 'measured', ...over }));
      expect(stage.stage).toBe('AWAITING_ACCEPTANCE');
      expect(stage.group).toBe('AWAITING_EVIDENCE_OR_ACCEPTANCE');
      expect(stage.group).not.toBe('READY_TO_BILL');
    });
  }

  it('medido + aceite exigido não oferece a ação de gerar faturamento', () => {
    const action = deriveAction(assessMilestone(base({ status: 'measured' })));
    expect(action.kind).not.toBe('generate_billing');
    expect(action.primary).toBe(false);
  });

  it('a exigência de aceite só cede diante de um ATO de aceite, não do tempo', () => {
    const medido = base({ status: 'measured', customerAcceptanceRequired: true });
    expect(deriveStage(medido).stage).toBe('AWAITING_ACCEPTANCE');

    // Um aceite registrado em Projetos destrava — e só ele.
    expect(deriveStage({
      ...medido, measurementId: 'x', measurementStatus: 'ACCEPTED',
      measurementAcceptedAt: '2026-04-01T00:00:00Z', evidenceDocumentId: 'd1',
    }).stage).toBe('READY_TO_BILL');
  });

  it('aceite dispensado pelo contrato não é o mesmo que aceite não registrado', () => {
    // `false` é dispensa explícita do contrato: medir basta.
    expect(deriveStage(base({
      status: 'measured', customerAcceptanceRequired: false, evidenceRequired: false,
    })).stage).toBe('READY_TO_BILL');

    // `null` é exigência NÃO REGISTRADA — e também não trava o marco, porque a
    // lacuna de instrumentação já aparece em outro lugar da tela.
    expect(deriveStage(base({
      status: 'measured', customerAcceptanceRequired: null, evidenceRequired: false,
    })).stage).toBe('READY_TO_BILL');
  });

  it('bloqueio operacional vence até o aceite registrado', () => {
    expect(deriveStage(base({
      status: 'approved', measurementId: 'x', measurementReadiness: 'BLOCKED',
    })).stage).toBe('BLOCKED');
  });

  it('evento de faturamento existente continua vencendo o aceite pendente', () => {
    expect(deriveStage(base({ status: 'measured', billingEventId: 'b1' })).stage).toBe('BILLED');
  });

  it('JA10182283/2025: nenhum dos 6 eventos pode ser liberado só medindo', () => {
    // A bancada viva traz `customer_acceptance_required = true` e
    // `required_document_type = 'boletim_medicao'` nos seis.
    const eventos = ['e1', 'e2', 'e3', 'e4', 'e5', 'e6'].map((id) => base({
      id, status: 'measured', customerAcceptanceRequired: true,
      evidenceRequired: true, requiredDocumentType: 'boletim_medicao',
    }));
    for (const row of eventos) {
      expect(deriveStage(row).stage).toBe('AWAITING_ACCEPTANCE');
    }
    const buckets = groupMilestones(eventos.map((r) => assessMilestone(r)));
    expect(buckets.find((b) => b.group === 'READY_TO_BILL')?.items).toHaveLength(0);
  });
});

describe('deriveOverlays — matriz de sobreposições', () => {
  const hoje = new Date('2026-09-17T12:00:00Z');

  it('OVERDUE só existe quando há prazo registrado', () => {
    expect(deriveOverlays(base({ dueDate: null }), hoje)).not.toContain('OVERDUE');
    expect(deriveOverlays(base({ dueDate: '2026-09-16' }), hoje)).toContain('OVERDUE');
    expect(deriveOverlays(base({ dueDate: '2026-09-18' }), hoje)).not.toContain('OVERDUE');
  });

  it('OVERDUE não se aplica a marco concluído nem cancelado', () => {
    expect(deriveOverlays(base({ dueDate: '2020-01-01', completedAt: '2020-01-01T00:00:00Z' }), hoje))
      .not.toContain('OVERDUE');
    expect(deriveOverlays(base({ dueDate: '2020-01-01', status: 'cancelled' }), hoje))
      .not.toContain('OVERDUE');
  });

  it('NO_OWNER e NO_EVIDENCE acumulam com qualquer estágio', () => {
    const o = deriveOverlays(mapped({ timelineStatus: 'completed', dueDate: '2020-01-01' }), hoje);
    expect(o).toContain('OVERDUE');
    expect(o).toContain('NO_OWNER');
    expect(o).toContain('NO_EVIDENCE');
    expect(deriveStage(mapped({ timelineStatus: 'completed' })).stage).toBe('READY_TO_MEASURE');
  });

  it('evidência satisfeita por documento, texto ou contagem de evidências', () => {
    expect(deriveOverlays(base({ evidenceDocumentId: 'd' }), hoje)).not.toContain('NO_EVIDENCE');
    expect(deriveOverlays(base({ evidence: 'BM 04 aprovado' }), hoje)).not.toContain('NO_EVIDENCE');
    expect(deriveOverlays(base({ measurementEvidenceCount: 2 }), hoje)).not.toContain('NO_EVIDENCE');
    expect(deriveOverlays(base({ evidence: '   ' }), hoje)).toContain('NO_EVIDENCE');
  });

  it('não cobra evidência de marco sem exigência registrada', () => {
    expect(deriveOverlays(base({ requirementId: null, evidenceRequired: null }), hoje))
      .not.toContain('NO_EVIDENCE');
  });

  it('VALUE_UNVERIFIED marca medido sem valor apurado — e o previsto não preenche', () => {
    const row = base({ status: 'measured', measuredAmount: null, acceptedValue: null });
    expect(row.billingAmount).not.toBeNull();       // previsto existe…
    expect(deriveOverlays(row, hoje)).toContain('VALUE_UNVERIFIED'); // …e não conta.
    expect(deriveOverlays(base({ status: 'measured', measuredAmount: 10 }), hoje))
      .not.toContain('VALUE_UNVERIFIED');
  });

  it('VALUE_UNVERIFIED sobrevive ao aceite pendente', () => {
    // Amarrada ao estágio READY_TO_BILL, a sobreposição sumia justamente nos
    // contratos que exigem aceite — que são os que mais precisam dela.
    const row = base({ status: 'measured', customerAcceptanceRequired: true });
    expect(deriveStage(row).stage).toBe('AWAITING_ACCEPTANCE');
    expect(deriveOverlays(row, hoje)).toContain('VALUE_UNVERIFIED');
  });

  it('ENTITLEMENT_MISSING quando não há regra de direito', () => {
    expect(deriveOverlays(base({ entitlementRuleCount: 0 }), hoje)).toContain('ENTITLEMENT_MISSING');
    expect(deriveOverlays(base(), hoje)).not.toContain('ENTITLEMENT_MISSING');
  });
});

describe('deriveChain — quatro autoridades, quatro nós', () => {
  it('só o elo contratual acende num marco sem operação', () => {
    const chain = deriveChain(base());
    expect(chain.map((l) => l.fact)).toEqual([true, false, false, false]);
    expect(chain[0].source).toBe('Contrato p.1');
    expect(chain[1].source).toBeNull();
  });

  it('elo de execução só acende com etapa concluída, não com etapa mapeada', () => {
    expect(deriveChain(mapped())[1].fact).toBe(false);
    expect(deriveChain(mapped({ timelineStatus: 'completed' }))[1].fact).toBe(true);
    expect(deriveChain(mapped({ timelineStatus: 'completed' }))[1].source).toBe('WBS 3.2.1');
  });

  it('elo de faturamento só acende com evento existente', () => {
    expect(deriveChain(base({ status: 'approved' }))[3].fact).toBe(false);
    expect(deriveChain(base({ billingEventId: 'b' }))[3].fact).toBe(true);
  });
});

describe('deriveAction — uma ação por marco, primária só quando move dinheiro', () => {
  const kind = (row: MilestoneWorkbenchRow) => deriveAction(assessMilestone(row)).kind;

  it('aponta para o gargalo de cada estágio', () => {
    expect(kind(base({ requirementId: null }))).toBe('configure_requirement');
    expect(kind(base())).toBe('map_timeline');
    expect(kind(mapped())).toBe('view_timeline');
    expect(kind(mapped({ timelineStatus: 'completed' }))).toBe('open_measurement');
    expect(kind(base({ status: 'measured' }))).toBe('open_measurement');   // aceite pendente
    expect(kind(billable())).toBe('generate_billing');
    expect(kind(base({ billingEventId: 'b' }))).toBe('view_billing');
  });

  it('só READY_TO_BILL é primária', () => {
    expect(deriveAction(assessMilestone(billable())).primary).toBe(true);
    for (const row of [base(), mapped(), base({ status: 'measured' }), base({ billingEventId: 'b' })]) {
      expect(deriveAction(assessMilestone(row)).primary).toBe(false);
    }
  });
});

describe('groupMilestones', () => {
  it('devolve todos os grupos, inclusive vazios — ver o funil é o diagnóstico', () => {
    const buckets = groupMilestones([assessMilestone(base())]);
    expect(buckets.map((b) => b.group)).toEqual([...GROUP_ORDER]);
    expect(buckets.find((b) => b.group === 'REQUIRES_SETUP')?.items).toHaveLength(1);
    expect(buckets.find((b) => b.group === 'SETTLED')?.items).toHaveLength(0);
  });

  it('soma o DIREITO do grupo, e devolve null quando nenhum marco tem direito', () => {
    const comDireito = groupMilestones([assessMilestone(base()), assessMilestone(base({ id: 'm2' }))]);
    expect(comDireito.find((b) => b.group === 'REQUIRES_SETUP')?.entitlementTotal)
      .toBeCloseTo(1606467.96, 2);

    const semDireito = groupMilestones([
      assessMilestone(base({ entitlementAmount: null, entitlementRuleCount: 0 })),
    ]);
    // Cair para `billing_amount` aqui apresentaria previsão como direito.
    expect(semDireito.find((b) => b.group === 'REQUIRES_SETUP')?.entitlementTotal).toBeNull();
  });
});

describe('normalização — ausência nunca vira zero', () => {
  it('numeric ausente permanece null; string numérica vira número', () => {
    const row = toWorkbenchRow({
      id: 'm', organization_id: 'o', contract_id: 'c', project_id: null,
      title: 't', description: null, milestone_type: null, status: 'pending',
      due_date: null, completed_at: null,
      billing_amount: '803233.98', measured_amount: null,
      owner_user_id: null, evidence: null, evidence_document_id: null,
      entitlement_amount: null, entitlement_currency: null,
      entitlement_source_document_id: null, entitlement_source_page: null,
      entitlement_source_reference: null, entitlement_rule_count: null,
      requirement_id: null, requirement_count: null,
      customer_acceptance_required: null, evidence_required: null,
      required_document_type: null, report_required: null, technical_report_required: null,
      governed_mapping_count: null, timeline_item_id: null, timeline_project_id: null,
      timeline_title: null, timeline_wbs_code: null, timeline_status: null,
      timeline_percent_complete: null, timeline_planned_finish: null, timeline_actual_finish: null,
      measurement_id: null, measurement_status: null, measurement_readiness: null,
      measurement_readiness_reasons: null, measurement_expected_at: null,
      measurement_submitted_at: null, measurement_accepted_at: null,
      measurement_accepted_value: null, measurement_accepted_currency: null,
      measurement_evidence_count: null, measurement_missing_requirement_count: null,
      billing_event_id: null, billing_eligibility_state: null, billing_release_state: null,
      billing_eligible_amount: null, billing_currency: null, billing_amount_source: null,
      billing_fiscal_document_status: null, billing_receivable_status: null,
      billing_finance_link_state: null,
    });
    expect(row.billingAmount).toBe(803233.98);
    expect(row.measuredAmount).toBeNull();
    expect(row.entitlementAmount).toBeNull();   // e NÃO 0
    expect(row.acceptedValue).toBeNull();       // e NÃO 0
    expect(row.governedMappingCount).toBe(0);   // contagem: aqui zero É a verdade
    expect(row.measurementReadinessReasons).toEqual([]);
  });
});

describe('JA10182283/2025 — os 6 eventos como estão hoje', () => {
  /** Reproduz a bancada real: direito e exigência sim, cronograma não. */
  const eventos = [
    { id: 'e1', title: 'Evento 01 · Na assinatura do contrato e liberação para início', amount: 803233.98 },
    { id: 'e2', title: 'Evento 02 · No transporte do equipamento para nossa fábrica (CIF)', amount: 1606467.95 },
    { id: 'e3', title: 'Evento 03 · Sacar bobinas | Pedido de materiais', amount: 2008084.94 },
    { id: 'e4', title: 'Evento 04 · Apresentação dos materiais em fábrica e projetos/ desenhos', amount: 2008084.94 },
    { id: 'e5', title: 'Evento 05 · Montagem e fechamento do enrolamento estatórico', amount: 803233.98 },
    { id: 'e6', title: 'Evento 06 · Na entrega do relatório final', amount: 803233.98 },
  ].map((e) => base({ id: e.id, title: e.title, billingAmount: e.amount, entitlementAmount: e.amount }));

  it('os 6 permanecem NÃO APURADOS enquanto não houver mapeamento governado', () => {
    for (const row of eventos) {
      const s = deriveStage(row);
      expect(s.stage).toBe('UNMAPPED');
      expect(s.triggerAssessed).toBe(false);
      expect(s.dashed).toBe(true);
    }
  });

  it('nenhum evento de faturamento, aceite ou recebimento é afirmado', () => {
    for (const row of eventos) {
      const chain = deriveChain(row);
      expect(chain.find((l) => l.key === 'acceptance')?.fact).toBe(false);
      expect(chain.find((l) => l.key === 'billing')?.fact).toBe(false);
      expect(row.billingEventId).toBeNull();
      expect(row.acceptedValue).toBeNull();
      expect(row.measuredAmount).toBeNull();
    }
  });

  it('o direito soma 8.032.339,77 e cai inteiro em "Requer configuração"', () => {
    const buckets = groupMilestones(eventos.map((r) => assessMilestone(r)));
    const setup = buckets.find((b) => b.group === 'REQUIRES_SETUP');
    expect(setup?.items).toHaveLength(6);
    expect(setup?.entitlementTotal).toBeCloseTo(8032339.77, 2);
    for (const b of buckets.filter((x) => x.group !== 'REQUIRES_SETUP')) {
      expect(b.items).toHaveLength(0);
    }
  });
});
