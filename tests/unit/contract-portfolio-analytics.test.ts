/**
 * INTELIGÊNCIA DA CARTEIRA — as quatro agregações que alimentam os gráficos da
 * Visão Geral, e os indicadores por área.
 *
 * O que esta suíte protege é uma regra só, aplicada em quatro lugares:
 * **ausência não vira zero**. Um gráfico é a superfície em que ninguém confere
 * o número — é onde um zero fabricado sobrevive mais tempo —, então cada
 * agregador é testado explicitamente contra o caso em que o dado não existe.
 */

import { describe, it, expect } from 'vitest';
import { buildTrustedContract } from '@/lib/contracts/trust/read-model';
import { computeTrustedPortfolioStats } from '@/lib/contracts/trust/portfolio';
import { buildRenewalHorizon } from '@/lib/contracts/trust/renewal-horizon';
import { buildPortfolioApprovals } from '@/lib/contracts/trust/approval-intelligence';
import { buildClauseRiskIntelligence } from '@/lib/contracts/trust/clause-risk-intelligence';
import { portfolioToCash } from '@/lib/contracts/trust/contract-to-cash';
import { buildRiskExposureBands } from '@/lib/contracts/analytics/risk-exposure-bands';
import { buildBillingBacklog, backlogStageOf } from '@/lib/contracts/analytics/billing-backlog';
import { buildCashTimeline } from '@/lib/contracts/analytics/cash-timeline';
import { buildSectionKpis, type SectionKpiInput } from '@/lib/contracts/trust/section-kpis';
import { hasOfficialValue, isMissing, isError } from '@/lib/contracts/trust/trusted';
import { SECTION_ORDER } from '@/lib/contracts/portfolio-sections';
import type { ContractRelationsBatch, ContractRow } from '@/lib/contracts/contract-service';
import type { MilestoneWorkbenchRow } from '@/lib/contracts/measurement/milestone-workbench-types';
import { FIXED_NOW } from './fixtures/contract-fixtures';

// ── fixtures ───────────────────────────────────────────────────────────────

const noErrors = () => ({
  obligations: null, billing: null, documents: null,
  approvals: null, projectLinks: null, risks: null, ai: null,
  milestones: null, clauses: null, operationalInterpretations: null,
  penalties: null, obligationDefinitions: null,
});

function emptyBatch(overrides: Partial<ContractRelationsBatch> = {}): ContractRelationsBatch {
  return {
    obligations: new Map(), billingEvents: new Map(), documents: new Map(),
    approvals: new Map(), projectLinks: new Map(), riskLinks: new Map(),
    aiAnalyses: new Map(), milestones: new Map(), clauses: new Map(),
    penalties: new Map(), obligationDefinitions: new Map(), riskDetails: new Map(),
    sectionsWithData: {
      obligations: false, billing: false, documents: false,
      approvals: false, projectLinks: false, risks: false, ai: false,
    },
    sectionErrors: noErrors(),
    ...overrides,
  } as ContractRelationsBatch;
}

const row = (over: Partial<ContractRow> = {}): ContractRow => ({
  id: 'ctr-1', organization_id: 'org-1', project_id: null,
  client_id: null, supplier_id: null,
  title: 'Contrato de Serviços QA', contract_number: 'CTR-1',
  counterparty_name: 'QA Services', contract_type: 'Ordem de serviço',
  status: 'active', lifecycle_stage: null,
  start_date: '2026-05-13', end_date: '2027-05-13',
  signed_date: '2026-05-13', renewal_date: null,
  currency: 'BRL', total_value: 1_000_000, monthly_value: null,
  payment_terms: null, scope_summary: null, risk_level: 'high',
  health_score: null, owner_user_id: 'u-1',
  created_by: 'u-1', updated_by: 'u-1',
  created_at: '2026-05-14T09:00:00Z', updated_at: '2026-05-14T09:00:00Z',
  deleted_at: null, data_class: 'live',
  ...over,
} as ContractRow);

const trusted = (over: Partial<ContractRow> = {}, batch = emptyBatch()) =>
  buildTrustedContract(row(over), batch, [], FIXED_NOW);

const billingEvent = (over: Record<string, unknown> = {}) => ({
  id: 'be-1', contract_id: 'ctr-1', milestone_id: null, title: 'Evento',
  amount: 100_000, due_date: null, paid_at: null, status: 'pendente',
  realized_amount: null, realized_at: null, invoice_reference: null,
  realized_note: null, realized_by: null,
  created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
  ...over,
} as never);

/** Um marco da bancada, com só o que o estágio precisa para ser derivado. */
const milestone = (over: Partial<MilestoneWorkbenchRow> = {}): MilestoneWorkbenchRow => ({
  id: 'ms-1', organizationId: 'org-1', contractId: 'ctr-1', projectId: null,
  title: 'Marco', description: null, milestoneType: null,
  status: 'pending', dueDate: null, completedAt: null,
  billingAmount: null, measuredAmount: null, ownerUserId: null,
  evidence: null, evidenceDocumentId: null,
  entitlementAmount: null, entitlementCurrency: null,
  entitlementSourceDocumentId: null, entitlementSourcePage: null,
  entitlementSourceReference: null, entitlementRuleCount: 0,
  requirementId: null, requirementCount: 0,
  customerAcceptanceRequired: null, evidenceRequired: null,
  requiredDocumentType: null, reportRequired: null, technicalReportRequired: null,
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
  billingFiscalDocumentStatus: null, billingReceivableStatus: null,
  billingFinanceLinkState: null,
  ...over,
} as MilestoneWorkbenchRow);

// ═══════════════════════════════════════════════════════════════════════════
// Exposição por risco
// ═══════════════════════════════════════════════════════════════════════════

describe('buildRiskExposureBands', () => {
  it('reparte contratos e BRL pelas três classes registradas', () => {
    const bands = buildRiskExposureBands([
      trusted({ id: 'a', risk_level: 'high', total_value: 600_000 }),
      trusted({ id: 'b', risk_level: 'medium', total_value: 300_000 }),
      trusted({ id: 'c', risk_level: 'low', total_value: 100_000 }),
    ]);

    expect(bands.bands.map((b) => [b.key, b.count, b.exposure])).toEqual([
      ['high', 1, 600_000],
      ['medium', 1, 300_000],
      ['low', 1, 100_000],
    ]);
    expect(bands.total).toBe(1_000_000);
    expect(bands.bands[0].share).toBeCloseTo(0.6, 5);
  });

  it('faixa sem NENHUM valor apurado fica `null` — jamais R$ 0', () => {
    const bands = buildRiskExposureBands([
      trusted({ id: 'a', risk_level: 'high', total_value: null }),
    ]);
    const high = bands.bands.find((b) => b.key === 'high')!;

    expect(high.count).toBe(1);
    // O contrato EXISTE na faixa; o dinheiro dele é que não se sabe.
    expect(high.exposure).toBeNull();
    expect(high.pricedCount).toBe(0);
    // Sem as duas pontas não há proporção — e `null` desenha trilho tracejado.
    expect(high.share).toBeNull();
    expect(bands.total).toBeNull();
  });

  it('contrato sem valor conta na sua faixa e fica FORA da soma dela', () => {
    const bands = buildRiskExposureBands([
      trusted({ id: 'a', risk_level: 'high', total_value: 500_000 }),
      trusted({ id: 'b', risk_level: 'high', total_value: null }),
    ]);
    const high = bands.bands.find((b) => b.key === 'high')!;

    expect(high.count).toBe(2);
    expect(high.pricedCount).toBe(1);
    expect(high.exposure).toBe(500_000);
  });

  it('a lacuna de valor é COBERTURA, não uma quarta faixa de risco', () => {
    const bands = buildRiskExposureBands([
      trusted({ id: 'a', risk_level: 'high', total_value: null }),
      trusted({ id: 'b', risk_level: 'low', total_value: 10 }),
    ]);

    // Três faixas, sempre. `risk_level` é NOT NULL: não existe contrato sem
    // classe, e inventar uma quarta faixa contaria o contrato duas vezes.
    expect(bands.bands).toHaveLength(3);
    expect(bands.unpriced.count).toBe(1);
    expect(bands.unpriced.contractIds).toEqual(['a']);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Backlog de receita
// ═══════════════════════════════════════════════════════════════════════════

describe('buildBillingBacklog', () => {
  it('um marco sem instrumentação cai em "gatilho não apurado"', () => {
    expect(backlogStageOf(milestone())).toBe('trigger_unassessed');
  });

  it('marco cancelado sai da repartição — não há direito a destravar', () => {
    const backlog = buildBillingBacklog([
      milestone({ id: 'x', status: 'cancelled', entitlementAmount: 999 }),
    ]);
    expect(backlog.cancelledCount).toBe(1);
    expect(backlog.segments.every((s) => s.count === 0)).toBe(true);
    expect(backlog.base).toBeNull();
  });

  it('marco sem valor conta no segmento e NÃO entra na soma', () => {
    const backlog = buildBillingBacklog([
      milestone({ id: '1', entitlementAmount: 200_000 }),
      milestone({ id: '2', entitlementAmount: null, billingAmount: null }),
    ]);
    const stage = backlog.segments.find((s) => s.key === 'trigger_unassessed')!;

    expect(stage.count).toBe(2);
    expect(stage.unpricedCount).toBe(1);
    expect(stage.amount).toBe(200_000);
    expect(backlog.coverage).toEqual({ counted: 1, total: 2 });
  });

  it('o DIREITO vence o previsto quando ambos existem', () => {
    const backlog = buildBillingBacklog([
      milestone({ entitlementAmount: 80_000, billingAmount: 100_000 }),
    ]);
    expect(backlog.base).toBe(80_000);
  });

  it('segmento vazio tem `amount` nulo, e a proporção não vira zero', () => {
    const backlog = buildBillingBacklog([milestone({ entitlementAmount: 10 })]);
    const billed = backlog.segments.find((s) => s.key === 'billed')!;

    expect(billed.count).toBe(0);
    expect(billed.amount).toBeNull();
    expect(billed.share).toBeNull();
  });

  it('os seis segmentos existem sempre, na ordem da cadeia', () => {
    expect(buildBillingBacklog([]).segments.map((s) => s.key)).toEqual([
      'trigger_unassessed', 'awaiting_measurement', 'awaiting_evidence',
      'awaiting_acceptance', 'eligible', 'billed',
    ]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Curva acumulada
// ═══════════════════════════════════════════════════════════════════════════

describe('buildCashTimeline', () => {
  const withEvents = (events: unknown[]) => trusted({}, emptyBatch({
    billingEvents: new Map([['ctr-1', events]]),
    sectionsWithData: {
      obligations: false, billing: true, documents: false,
      approvals: false, projectLinks: false, risks: false, ai: false,
    },
  } as never));

  it('sem evento datado NÃO desenha curva — e diz por quê', () => {
    const timeline = buildCashTimeline([withEvents([])]);
    expect(timeline.points).toBeNull();
    expect(timeline.absentReason).toBe('no-dated-events');
  });

  it('um único mês não vira curva: uma linha subindo do zero seria mentira', () => {
    const timeline = buildCashTimeline([withEvents([
      billingEvent({ status: 'pago', realized_at: `${FIXED_NOW.getFullYear()}-${String(FIXED_NOW.getMonth() + 1).padStart(2, '0')}-05` }),
    ])]);
    // Ou não há curva, ou ela tem ao menos dois pontos — nunca um só.
    expect(timeline.points === null || timeline.points.length >= 2).toBe(true);
  });

  it('acumula o faturado mês a mês', () => {
    const timeline = buildCashTimeline([withEvents([
      billingEvent({ id: 'a', amount: 100, status: 'faturado', realized_at: '2026-01-10' }),
      billingEvent({ id: 'b', amount: 50, status: 'faturado', realized_at: '2026-03-10' }),
    ])]);

    expect(timeline.points).not.toBeNull();
    const last = timeline.points![timeline.points!.length - 1];
    expect(last.billed).toBe(150);
    expect(last.billedCount).toBe(2);
  });

  it('`paid_at` NÃO produz uma série de recebimento', () => {
    /*
      A regressão que este teste tranca: a primeira versão derivava "recebido"
      de `paid_at` e a tela passou a exibir duas afirmações contraditórias —
      a curva dizia "recebido R$ 143 mil" e a cadeia, logo abaixo, "não
      integrado". `paid_at` é carimbo deste módulo sobre o evento, não
      confirmação de caixa pelo razão financeiro.
    */
    const timeline = buildCashTimeline([withEvents([
      billingEvent({ id: 'a', amount: 100, status: 'pago', paid_at: '2026-01-10' }),
      billingEvent({ id: 'b', amount: 50, status: 'pago', paid_at: '2026-03-10' }),
    ])]);

    expect(timeline.points).not.toBeNull();
    for (const point of timeline.points!) {
      expect(Object.keys(point)).not.toContain('received');
    }
    // O pagamento carimbado conta como FATURADO — que é o que ele evidencia.
    expect(timeline.points![timeline.points!.length - 1].billed).toBe(150);
  });

  it('a cadeia canônica continua sendo a única a falar de recebimento', () => {
    const received = portfolioToCash([trusted()]).find((s) => s.key === 'received')!;
    expect(received.state).toBe('not-integrated');
    expect(hasOfficialValue(received.amount)).toBe(false);
  });

  it('o contratado é TETO, não série: entra como referência única', () => {
    const timeline = buildCashTimeline([withEvents([
      billingEvent({ amount: 10, status: 'faturado', realized_at: '2026-01-10' }),
      billingEvent({ id: 'b', amount: 10, status: 'faturado', realized_at: '2026-02-10' }),
    ])]);
    expect(timeline.contractedCeiling).toBe(1_000_000);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Indicadores por área
// ═══════════════════════════════════════════════════════════════════════════

function input(contracts = [trusted()]): SectionKpiInput {
  return {
    stats: computeTrustedPortfolioStats(contracts),
    contracts,
    renewal: buildRenewalHorizon(contracts, FIXED_NOW),
    obligations: {
      portfolio: {
        rows: [],
        counts: { OVERDUE: 0, DUE: 0, UPCOMING: 0, AWAITING_SCHEDULE_ANCHOR: 0, UNKNOWN: 0, NOT_APPLICABLE: 0 },
        billingUnknownContracts: [], billingBlockedContracts: [],
        contractsWithoutObligations: [], asOf: '2026-05-14',
      },
      loading: false,
      error: null,
    },
    cash: portfolioToCash(contracts),
    backlog: buildBillingBacklog([]),
    backlogError: null,
    approvals: buildPortfolioApprovals(contracts, FIXED_NOW),
    approvalRequirements: { requirements: [], loading: false, error: null },
    clauseRisk: buildClauseRiskIntelligence(contracts),
    riskBands: buildRiskExposureBands(contracts),
  };
}

describe('buildSectionKpis', () => {
  it('cada área tem o SEU conjunto — nenhum id se repete entre áreas', () => {
    const byArea = SECTION_ORDER.map((section) => buildSectionKpis(section, input()));
    const ids = byArea.flatMap((kpis) => kpis.map((k) => k.id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('nenhuma área passa de seis indicadores, e nenhuma fica abaixo de quatro', () => {
    for (const section of SECTION_ORDER) {
      const kpis = buildSectionKpis(section, input());
      expect(kpis.length).toBeGreaterThanOrEqual(4);
      expect(kpis.length).toBeLessThanOrEqual(6);
    }
  });

  it('a área ativa governa o conjunto: Documentos não mostra faturamento', () => {
    const docs = buildSectionKpis('documents', input()).map((k) => k.label);
    expect(docs).toContain('Documentos válidos');
    expect(docs.join(' ')).not.toMatch(/Faturad|Execução média|Obrigações atrasadas/);
  });

  it('leitura em andamento vira AUSÊNCIA declarada, nunca zero', () => {
    const pending = { ...input() };
    const kpis = buildSectionKpis('obligations', {
      ...pending,
      obligations: { ...pending.obligations, loading: true },
    });
    for (const kpi of kpis) {
      expect(hasOfficialValue(kpi.value)).toBe(false);
      expect(isMissing(kpi.value)).toBe(true);
    }
  });

  it('leitura que FALHOU vira erro — distinto de ausência', () => {
    const base = input();
    const kpis = buildSectionKpis('obligations', {
      ...base,
      obligations: { ...base.obligations, error: 'RLS negou a consulta' },
    });
    expect(kpis.every((k) => isError(k.value))).toBe(true);
  });

  it('contrato sem valor não produz exposição zero em Contratos', () => {
    const semValor = [trusted({ total_value: null })];
    const kpi = buildSectionKpis('contracts', input(semValor))
      .find((k) => k.id === 'contracts-exposure')!;
    expect(hasOfficialValue(kpi.value)).toBe(false);
  });

  it('a Visão Geral NÃO repete a exposição contratada do herói financeiro', () => {
    /*
      O herói abre a página com esse número em tipografia de destaque, a poucos
      pixels da tira. Repeti-lo na primeira célula punha o mesmo fato duas
      vezes na mesma dobra — e o leitor gasta a segunda leitura conferindo se
      os dois batem.
    */
    const labels = buildSectionKpis('overview', input()).map((k) => k.label);
    expect(labels).not.toContain('Exposição contratada');
    // ...e a área segue com um conjunto próprio, não com uma lacuna.
    expect(labels.length).toBeGreaterThanOrEqual(4);
  });

  it('nenhuma célula da Visão Geral se chama apenas "Cobertura"', () => {
    /*
      O herói já tem uma célula "Cobertura" (dimensões de saúde apuradas). Duas
      vizinhas com o mesmo nome medindo denominadores diferentes é pior que
      duplicação: é ambiguidade.
    */
    const labels = buildSectionKpis('overview', input()).map((k) => k.label);
    expect(labels).not.toContain('Cobertura');
    expect(labels).toContain('Cobertura de valor');
  });

  it('Riscos conta o alto risco no MESMO recorte do mapa e da exposição', () => {
    /*
      A contradição que este teste tranca: o indicador lia a carteira oficial
      enquanto o mapa logo abaixo lia o recorte. Num escopo de demonstração a
      tela mostrava "Contratos alto risco: 0" ao lado de um mapa com "Alto: 1".
    */
    const demo = [trusted({ id: 'd1', risk_level: 'high', data_class: 'demo' })];
    const kpi = buildSectionKpis('risks', input(demo))
      .find((k) => k.id === 'risks-high-contracts')!;
    const bands = buildRiskExposureBands(demo);

    expect(hasOfficialValue(kpi.value) && kpi.value.value)
      .toBe(bands.bands.find((b) => b.key === 'high')!.count);
  });

  it('cada área carrega o acento do seu domínio', () => {
    const accentOf = (section: Parameters<typeof buildSectionKpis>[0]) =>
      new Set(buildSectionKpis(section, input()).map((k) => k.accent));
    expect(accentOf('renewals')).toEqual(new Set(['time']));
    expect(accentOf('obligations')).toEqual(new Set(['sla']));
    expect(accentOf('faturamento')).toEqual(new Set(['money']));
    expect(accentOf('aprovacoes')).toEqual(new Set(['governance']));
    expect(accentOf('risks')).toEqual(new Set(['severity']));
    expect(accentOf('documents')).toEqual(new Set(['coverage']));
    expect(accentOf('contracts')).toEqual(new Set(['portfolio']));
  });

  it('a micro-barra some quando o denominador não foi apurado', () => {
    // Nenhum contrato tem valor: a fração de exposição não existe, e uma barra
    // de largura zero seria lida como "0% exposto".
    const semValor = [trusted({ id: 'a', total_value: null })];
    for (const kpi of buildSectionKpis('contracts', input(semValor))) {
      if (kpi.share !== null && kpi.share !== undefined) {
        expect(kpi.share).toBeGreaterThan(0);
        expect(kpi.share).toBeLessThanOrEqual(1);
      }
    }
  });

  it('recorte VAZIO não afirma zero sobre o que não existe', () => {
    /*
      Sem contrato nenhum no recorte, "0 documentos válidos", "0 requisitos
      governados" e "0 riscos vinculados" são afirmações que ninguém apurou —
      e as três soariam tranquilizadoras.
    */
    /*
      A exceção é a ENUMERAÇÃO DO PRÓPRIO SUJEITO: "contratos de alto risco"
      percorre a lista de contratos e conta, e numa lista vazia o resultado
      zero é uma observação. O que não se pode afirmar é o que depende de
      registros LIGADOS a contratos que não existem.
    */
    const SUBJECT_COUNTS = new Set(['risks-high-contracts']);
    for (const section of ['documents', 'aprovacoes', 'risks'] as const) {
      for (const kpi of buildSectionKpis(section, input([]))) {
        if (SUBJECT_COUNTS.has(kpi.id)) continue;
        expect(hasOfficialValue(kpi.value), `${section} · ${kpi.label}`).toBe(false);
        expect(isMissing(kpi.value), `${section} · ${kpi.label}`).toBe(true);
      }
    }
  });

  it('...mas a contagem do PRÓPRIO sujeito segue sendo zero apurado', () => {
    // "Total de contratos: 0" é o resultado de olhar, não a ausência de olhar.
    const total = buildSectionKpis('contracts', input([]))
      .find((k) => k.id === 'contracts-total')!;
    expect(hasOfficialValue(total.value) && total.value.value).toBe(0);

    const highRisk = buildSectionKpis('risks', input([]))
      .find((k) => k.id === 'risks-high-contracts')!;
    expect(hasOfficialValue(highRisk.value) && highRisk.value.value).toBe(0);
  });

  it('Faturamentos não mostra "valor medido R$ 0" sem fonte de medição', () => {
    /*
      A verificação pedida por nome na passada de consistência. Sem marco
      medido, o estágio não tem número — e o indicador herda a ausência em vez
      de um zero que afirmaria "alguém mediu e deu zero".
    */
    const kpi = buildSectionKpis('faturamento', input())
      .find((k) => k.id === 'billing-measured')!;
    expect(hasOfficialValue(kpi.value)).toBe(false);
  });

  it('a cobertura apurada mede quantos contratos têm valor legível', () => {
    const misto = [trusted({ id: 'a', total_value: 100 }), trusted({ id: 'b', total_value: null })];
    const kpi = buildSectionKpis('overview', input(misto))
      .find((k) => k.id === 'overview-coverage')!;
    expect(hasOfficialValue(kpi.value) && kpi.value.value).toBe(0.5);
  });

  it('um indicador ausente não carrega tom de alarme nem de sucesso', () => {
    const base = input();
    const kpis = buildSectionKpis('obligations', {
      ...base,
      obligations: { ...base.obligations, loading: true },
    });
    // A cor é afirmação sobre o número. Sem número, não há o que afirmar.
    expect(kpis.every((k) => k.tone === 'default' || k.tone === undefined)).toBe(true);
  });
});
