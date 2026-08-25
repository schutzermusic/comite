/**
 * Sinais do cockpit — atenção determinística, ação recomendada e operações
 * conectadas.
 *
 * Toda a lógica de decisão do Quick Dossier vive em módulos JSX-free
 * justamente para poder ser testada aqui: o vitest deste repositório roda em
 * `node`, sem DOM. O que os componentes fazem é desenhar o que estas funções
 * decidem.
 */

import { describe, it, expect } from 'vitest';
import { attentionItems, recommendedAction } from '@/lib/contracts/trust/attention';
import { buildConnectedRows } from '@/lib/contracts/trust/connected';
import { contractHealth } from '@/lib/contracts/trust/signals';
import { buildTrustedContract, relationsBatchFromDetail } from '@/lib/contracts/trust/read-model';
import { hasOfficialValue, isMissing } from '@/lib/contracts/trust/trusted';
import type { ContractDetail, ContractRow } from '@/lib/contracts/contract-service';
import { PROJECT_CEMIG } from './fixtures/contract-fixtures';

const NOW = new Date('2026-08-18T12:00:00.000Z');
const ID = 'qa-contract-0001';

const row: ContractRow = {
  id: ID, organization_id: 'org-1', project_id: null, client_id: null, supplier_id: null,
  title: '[QA] Contrato de Serviços', contract_number: 'QA-0001',
  counterparty_name: 'Fornecedor QA Ltda.', contract_type: 'Prestação de serviços',
  status: 'active', lifecycle_stage: null,
  start_date: '2026-05-13', end_date: '2027-05-13', signed_date: '2026-05-13',
  renewal_date: null, currency: 'BRL', total_value: 1_200_000, monthly_value: null,
  payment_terms: null, scope_summary: null, risk_level: 'high', health_score: null,
  owner_user_id: 'u-owner', created_by: 'u-owner', updated_by: 'u-owner',
  created_at: '2026-05-14T09:00:00Z', updated_at: '2026-05-14T09:00:00Z', deleted_at: null,
} as ContractRow;

const base: ContractDetail = {
  contract: row, clauses: [], penalties: [], milestones: [], risks: [], files: [], aiAnalyses: [],
  billingEvents: [] as never, obligations: [] as never, approvals: [] as never,
  projectLinks: [] as never, riskLinks: [] as never, documents: [] as never,
};

const full: ContractDetail = {
  ...base,
  billingEvents: [
    { id: 'b1', contract_id: ID, milestone_id: null, title: 'Parcela 1', amount: 120_000, due_date: '2026-06-01', paid_at: '2026-06-02', status: 'pago' },
    { id: 'b2', contract_id: ID, milestone_id: null, title: 'Parcela 2', amount: 480_000, due_date: '2026-12-01', paid_at: null, status: 'pendente' },
    { id: 'b3', contract_id: ID, milestone_id: null, title: 'Parcela 3', amount: 600_000, due_date: '2026-07-01', paid_at: null, status: 'pendente' },
  ] as never,
  obligations: [
    { id: 'o1', contract_id: ID, title: 'Aberta', status: 'open', due_date: '2026-10-01', owner_user_id: 'u', evidence: null },
    { id: 'o2', contract_id: ID, title: 'Atrasada', status: 'overdue', due_date: '2026-07-01', owner_user_id: null, evidence: null },
    { id: 'o3', contract_id: ID, title: 'Concluída', status: 'done', due_date: '2026-06-01', owner_user_id: 'u', evidence: null },
  ] as never,
  approvals: [
    { id: 'a1', contract_id: ID, step_name: 'juridico', status: 'approved', started_at: '2026-05-15T09:00:00Z', completed_at: '2026-05-16T13:00:00Z', created_at: '2026-05-15T09:00:00Z', updated_at: '2026-05-16T13:00:00Z' },
    { id: 'a2', contract_id: ID, step_name: 'financeiro', status: 'under_review', started_at: '2026-05-16T13:00:00Z', completed_at: null, created_at: '2026-05-16T13:00:00Z', updated_at: '2026-05-16T13:00:00Z' },
  ] as never,
  projectLinks: [{ id: 'pl', contract_id: ID, project_id: PROJECT_CEMIG.id }] as never,
  riskLinks: [{ id: 'rl', contract_id: ID, risk_id: 'r1' }] as never,
  documents: [
    { id: 'd1', contract_id: ID, title: 'Assinado', document_type: 'contract', status: 'approved', approved_at: null, rejection_reason: null },
    { id: 'd2', contract_id: ID, title: 'Garantia', document_type: 'guarantee', status: 'rejected', approved_at: null, rejection_reason: 'Insuficiente' },
  ] as never,
};

const build = (d: ContractDetail, errors = {}) =>
  buildTrustedContract(row, relationsBatchFromDetail(d, errors), [PROJECT_CEMIG], NOW);

// ═══════════════════════════════════════════════════════════════════
// Central de atenção
// ═══════════════════════════════════════════════════════════════════

describe('attentionItems', () => {
  it('é determinístico', () => {
    const c = build(full);
    expect(attentionItems(c, NOW)).toEqual(attentionItems(c, NOW));
  });

  it('ordena por severidade: crítico antes de atenção, atenção antes de info', () => {
    const items = attentionItems(build(full), NOW);
    const sev = items.map((i) => i.severity);
    const rank = { critical: 0, warning: 1, setup: 2, info: 3 } as const;
    for (let i = 1; i < sev.length; i += 1) {
      expect(rank[sev[i]]).toBeGreaterThanOrEqual(rank[sev[i - 1]]);
    }
  });

  it('todo item traz razão e próxima ação — nunca só uma contagem', () => {
    for (const item of attentionItems(build(full), NOW)) {
      expect(item.reason.length).toBeGreaterThan(20);
      expect(item.actionLabel).toBeTruthy();
      expect(item.actionKey).toBeTruthy();
      expect(item.title).toBeTruthy();
    }
  });

  it('detecta obrigação atrasada com a idade real', () => {
    const item = attentionItems(build(full), NOW).find((i) => i.id === 'obligations-overdue');
    expect(item).toBeDefined();
    expect(item?.severity).toBe('critical');
    expect(item?.age).toMatch(/dia\(s\) em atraso/);
  });

  it('afirma exposição SOMENTE no faturamento vencido, onde o dado a sustenta', () => {
    const items = attentionItems(build(full), NOW);
    const billing = items.find((i) => i.id === 'billing-overdue');
    expect(billing?.exposure).not.toBeNull();
    if (billing?.exposure && hasOfficialValue(billing.exposure)) {
      // Só a parcela 3, vencida em 01/07 e não realizada.
      expect(billing.exposure.value).toBe(600_000);
    }
    // Nenhum outro item inventa impacto financeiro.
    for (const item of items.filter((i) => i.id !== 'billing-overdue')) {
      expect(item.exposure, `${item.id} não deveria afirmar exposição`).toBeNull();
    }
  });

  it('projeto ausente é CONFIGURAÇÃO pendente, não falha operacional', () => {
    const item = attentionItems(build(base), NOW).find((i) => i.id === 'project-missing');
    expect(item?.actionKey).toBe('linkProject');
    // `setup` e não `warning`: nada está falhando — o controle ainda não existe.
    expect(item?.severity).toBe('setup');
  });

  it('não sinaliza projeto quando o vínculo existe', () => {
    const ids = attentionItems(build(full), NOW).map((i) => i.id);
    expect(ids).not.toContain('project-missing');
  });

  it('falha de leitura vira item CRÍTICO — silêncio seria pior', () => {
    const items = attentionItems(build(base, { billing: 'permission denied' }), NOW);
    const err = items.find((i) => i.id === 'error-billing');
    expect(err?.severity).toBe('critical');
    expect(items[0].severity).toBe('critical');
  });

  it('ausência de evento de faturamento é CONFIGURAÇÃO, jamais crítico', () => {
    const item = attentionItems(build(base), NOW).find((i) => i.id === 'billing-unmeasured');
    expect(item?.severity).toBe('setup');
  });

  it('separa falha de operação de ausência de controle', () => {
    const items = attentionItems(build(base), NOW);
    const setup = items.filter((i) => i.severity === 'setup').map((i) => i.id);
    // Um contrato recém-cadastrado é feito de lacunas de configuração...
    expect(setup).toEqual(expect.arrayContaining([
      'project-missing', 'obligations-unmapped', 'documents-none', 'approvals-no-route',
    ]));
    // ...e de nenhuma falha operacional, porque não há operação ainda.
    expect(items.filter((i) => i.severity === 'critical')).toEqual([]);
  });

  it('contrato com controle instalado e falhando é ATENÇÃO, não configuração', () => {
    const items = attentionItems(build(full), NOW);
    const setupIds = items.filter((i) => i.severity === 'setup').map((i) => i.id);
    expect(setupIds).not.toContain('obligations-unmapped');
    expect(setupIds).not.toContain('approvals-no-route');
    expect(items.some((i) => i.severity === 'critical')).toBe(true);
  });

  it('contrato sem pendência alguma não gera item', () => {
    const clean: ContractDetail = {
      ...full,
      obligations: [{ id: 'o', contract_id: ID, title: 'ok', status: 'done', due_date: '2026-06-01', owner_user_id: 'u', evidence: null }] as never,
      documents: [{ id: 'd', contract_id: ID, title: 'ok', document_type: 'contract', status: 'approved', approved_at: null, rejection_reason: null }] as never,
      approvals: [{ id: 'a', contract_id: ID, step_name: 'juridico', status: 'approved', started_at: null, completed_at: null, created_at: '2026-05-15T09:00:00Z', updated_at: '2026-05-15T09:00:00Z' }] as never,
      billingEvents: [{ id: 'b', contract_id: ID, milestone_id: null, title: 'p', amount: 1000, due_date: '2027-01-01', paid_at: '2026-06-01', status: 'pago' }] as never,
    };
    expect(attentionItems(build(clean), NOW)).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Ação recomendada
// ═══════════════════════════════════════════════════════════════════

describe('recommendedAction', () => {
  it('é o item mais grave — determinística, sem modelo', () => {
    const c = build(full);
    const items = attentionItems(c, NOW);
    const action = recommendedAction(c, NOW);
    expect(action?.key).toBe(items[0].actionKey);
    expect(action?.title).toBe(items[0].title);
  });

  it('sem projeto, "Vincular projeto" vira a ação primária', () => {
    // Contrato sem nada além da ausência de projeto e de faturamento.
    const action = recommendedAction(build(base), NOW);
    expect(action?.key).toBe('linkProject');
  });

  it('com obrigação atrasada, a prioridade migra para a obrigação', () => {
    const action = recommendedAction(build(full), NOW);
    expect(action?.severity).toBe('critical');
    expect(['openObligations', 'openBilling', 'reviewApproval']).toContain(action?.key);
  });

  it('contrato sem pendência não inventa tarefa', () => {
    const clean: ContractDetail = {
      ...full,
      obligations: [{ id: 'o', contract_id: ID, title: 'ok', status: 'done', due_date: '2026-06-01', owner_user_id: 'u', evidence: null }] as never,
      documents: [{ id: 'd', contract_id: ID, title: 'ok', document_type: 'contract', status: 'approved', approved_at: null, rejection_reason: null }] as never,
      approvals: [{ id: 'a', contract_id: ID, step_name: 'juridico', status: 'approved', started_at: null, completed_at: null, created_at: '2026-05-15T09:00:00Z', updated_at: '2026-05-15T09:00:00Z' }] as never,
      billingEvents: [{ id: 'b', contract_id: ID, milestone_id: null, title: 'p', amount: 1000, due_date: '2027-01-01', paid_at: '2026-06-01', status: 'pago' }] as never,
    };
    expect(recommendedAction(build(clean), NOW)).toBeNull();
  });

  it('mas um contrato SEM controle instalado recebe a ação de configuração', () => {
    // O oposto do teste acima: aqui não há nada montado, e o cockpit tem de
    // dizer por onde começar em vez de fingir que está tudo certo.
    const action = recommendedAction(build(base), NOW);
    expect(action?.severity).toBe('setup');
    expect(action?.key).toBe('linkProject');
  });
});

// ═══════════════════════════════════════════════════════════════════
// Connected Operations
// ═══════════════════════════════════════════════════════════════════

describe('buildConnectedRows', () => {
  it('cobre a cadeia operacional inteira, na ordem em que ela acontece', () => {
    // P2B inseriu `measurement` entre obrigação e faturamento — que é onde a
    // medição acontece — e `clauses` junto de riscos.
    expect(buildConnectedRows(build(full)).map((r) => r.key)).toEqual([
      'project', 'tasks', 'obligations', 'measurement', 'billing',
      'documents', 'risks', 'clauses', 'approvals', 'audit', 'finance',
    ]);
  });

  it('medição e cláusulas relatam estado apurado, não ausência de instrumentação', () => {
    const rows = buildConnectedRows(build(full));
    expect(rows.find((r) => r.key === 'measurement')?.state).toBe('Nenhum marco');
    expect(rows.find((r) => r.key === 'measurement')?.notIntegrated).toBe(false);
    expect(rows.find((r) => r.key === 'clauses')?.state).toBe('Nenhuma registrada');
    expect(rows.find((r) => r.key === 'clauses')?.notIntegrated).toBe(false);
  });

  it('mostra o código do projeto quando vinculado', () => {
    const row0 = buildConnectedRows(build(full))[0];
    expect(row0.state).toBe('CEMIG - 2450.07/2024');
    expect(row0.tone).toBe('success');
  });

  it('mostra "Não vinculado" com tom de atenção quando falta', () => {
    const row0 = buildConnectedRows(build(base))[0];
    expect(row0.state).toBe('Não vinculado');
    expect(row0.tone).toBe('warning');
  });

  it('marca a linha como errored — não como vazia — quando a leitura falha', () => {
    const rows = buildConnectedRows(build(full, { billing: 'timeout', documents: 'denied' }));
    expect(rows.find((r) => r.key === 'billing')?.errored).toBe(true);
    expect(rows.find((r) => r.key === 'documents')?.errored).toBe(true);
    // As demais seguem apuradas.
    expect(rows.find((r) => r.key === 'obligations')?.errored).toBe(false);
  });

  it('obrigação atrasada leva a linha ao tom de perigo', () => {
    expect(buildConnectedRows(build(full)).find((r) => r.key === 'obligations')?.tone).toBe('danger');
  });

  it('zero apurado é estado, não ausência: "Nenhum evento" ≠ "Não apurado"', () => {
    const rows = buildConnectedRows(build(base));
    expect(rows.find((r) => r.key === 'billing')?.state).toBe('Nenhum evento');
    expect(rows.find((r) => r.key === 'billing')?.errored).toBe(false);
  });

  // ── Orquestração cross-módulo (P1C) ──────────────────────────────

  it('Financeiro é declarado NÃO INTEGRADO — nunca zero, nunca "não apurado"', () => {
    const finance = buildConnectedRows(build(full)).find((r) => r.key === 'finance')!;
    expect(finance.notIntegrated).toBe(true);
    expect(finance.state).toBeNull();
    expect(finance.errored).toBe(false);
    // O motivo tem de estar disponível: "não integrado" sem explicação é ruído.
    expect(finance.note).toMatch(/conciliação/i);
    // E nenhum outro módulo pode se declarar não integrado por engano.
    expect(buildConnectedRows(build(full)).filter((r) => r.notIntegrated).map((r) => r.key))
      .toEqual(['finance']);
  });

  it('cada linha declara o módulo DONO do domínio', () => {
    const owners = Object.fromEntries(buildConnectedRows(build(full)).map((r) => [r.key, r.owner]));
    expect(owners.project).toBe('Projetos');
    expect(owners.tasks).toBe('Agenda & Tarefas');
    expect(owners.risks).toBe('Riscos');
    expect(owners.audit).toBe('Auditoria');
    expect(owners.finance).toBe('Financeiro');
  });

  it('sem contexto cross-módulo, tarefas e auditoria ficam NÃO APURADAS — não zeradas', () => {
    const rows = buildConnectedRows(build(full));
    for (const key of ['tasks', 'audit'] as const) {
      const r = rows.find((x) => x.key === key)!;
      expect(r.state).toBeNull();
      expect(r.errored).toBe(false);
    }
  });

  it('contagem zero vinda do módulo dono é apurada, e diferente de erro', () => {
    const zeroed = buildConnectedRows(build(full), {
      tasks: { count: 0, errored: false },
      auditEvents: { count: 0, errored: false },
    });
    expect(zeroed.find((r) => r.key === 'tasks')?.state).toBe('Nenhuma vinculada');
    expect(zeroed.find((r) => r.key === 'audit')?.state).toBe('Nenhum evento');

    const failed = buildConnectedRows(build(full), {
      tasks: { count: null, errored: true },
      auditEvents: { count: null, errored: true },
    });
    expect(failed.find((r) => r.key === 'tasks')?.errored).toBe(true);
    expect(failed.find((r) => r.key === 'tasks')?.state).toBeNull();
    expect(failed.find((r) => r.key === 'audit')?.errored).toBe(true);
  });

  it('pluraliza a contagem cross-módulo', () => {
    const one = buildConnectedRows(build(full), { tasks: { count: 1, errored: false } });
    expect(one.find((r) => r.key === 'tasks')?.state).toBe('1 tarefa');
    const many = buildConnectedRows(build(full), { tasks: { count: 4, errored: false } });
    expect(many.find((r) => r.key === 'tasks')?.state).toBe('4 tarefas');
  });

  it('contrato sem NENHUMA etapa de aprovação não é pintado como saudável', () => {
    // Ausência de rota de alçada é falta de controle, não aprovação concluída.
    const semRota = buildConnectedRows(build(base)).find((r) => r.key === 'approvals')!;
    expect(semRota.state).toBe('Nenhuma etapa');
    expect(semRota.tone).toBe('neutral');

    // Já uma rota existente e integralmente aprovada, sim.
    const aprovado: ContractDetail = {
      ...base,
      approvals: [
        { id: 'a1', contract_id: ID, step_name: 'juridico', status: 'approved', started_at: '2026-05-15T09:00:00Z', completed_at: '2026-05-16T13:00:00Z', created_at: '2026-05-15T09:00:00Z', updated_at: '2026-05-16T13:00:00Z' },
      ] as never,
    };
    const concluido = buildConnectedRows(build(aprovado)).find((r) => r.key === 'approvals')!;
    expect(concluido.state).toBe('Concluídas');
    expect(concluido.tone).toBe('success');
  });

  it('nenhuma linha inventa número: estado só existe quando há apuração ou integração', () => {
    for (const r of buildConnectedRows(build(base))) {
      if (r.notIntegrated || r.errored) expect(r.state).toBeNull();
      if (r.state !== null) expect(r.notIntegrated).toBe(false);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════
// Saúde: cobertura reflete o que pôde ser avaliado
// ═══════════════════════════════════════════════════════════════════

describe('cobertura de saúde na interface', () => {
  it('seis dimensões com dado completo', () => {
    expect(contractHealth(build(full)).coverage).toEqual({ assessed: 6, total: 6 });
  });

  it('a cobertura CAI quando uma seção falha — não conta como saudável', () => {
    const h = contractHealth(build(full, { documents: 'denied', billing: 'timeout' }));
    expect(h.coverage.assessed).toBe(4);
    expect(h.drivers.map((d) => d.dimension)).not.toContain('documentos');
    expect(h.drivers.map((d) => d.dimension)).not.toContain('financeiro');
  });

  it('nunca emite pontuação numérica', () => {
    for (const detail of [full, base]) {
      const h = contractHealth(build(detail));
      expect(isMissing(h.score)).toBe(true);
    }
  });
});
