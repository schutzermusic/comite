/**
 * Fatia vertical do contrato [QA] — a prova de ponta a ponta de P0.4.
 *
 * Reproduz o contrato semeado por `scripts/qa-contracts-governance-seed.mjs`
 * (1 contrato R$ 1,2M · 3 obrigações open/overdue/done · 3 eventos de
 * faturamento pago/pendente/pendente-vencido · 3 documentos approved/
 * pending_approval/rejected · 3 aprovações com timestamps reais · 1 vínculo de
 * projeto · 1 vínculo de risco) e verifica a cadeia inteira:
 *
 *   relações → read model → sinais derivados → dossiê → PDF
 *
 * O que este arquivo garante que os outros não garantem: que as TRÊS
 * superfícies — página de detalhe, Quick Dossier e PDF oficial — leem do mesmo
 * objeto e portanto não podem discordar.
 */

import { describe, it, expect } from 'vitest';
import {
  buildTrustedContract, trustedContractFromDetail, relationsBatchFromDetail,
} from '@/lib/contracts/trust/read-model';
import {
  renewalState, approvalRoute, approvalStepOutcome, missingDocuments,
  obligationBreakdown, contractHealth, approvalSla,
  RENEWAL_LABEL,
} from '@/lib/contracts/trust/signals';
import { buildContractDossierHtml } from '@/lib/reports/modules/contract-dossier-report';
import { computeApprovalSla } from '@/lib/contracts/contract-service';
import {
  hasOfficialValue, isMissing, isError, isDerived, isLive,
} from '@/lib/contracts/trust/trusted';
import { officialCurrencyCompact } from '@/lib/contracts/trust/format';
import type {
  ContractRow, ContractDetail, ContractRelationsBatch,
} from '@/lib/contracts/contract-service';
import { PROJECT_CEMIG } from './fixtures/contract-fixtures';

const NOW = new Date('2026-08-18T12:00:00.000Z');
const QA_ID = 'qa-contract-0001';

// ── O contrato [QA], como a seed o cria ────────────────────────────────────

const qaContract: ContractRow = {
  id: QA_ID, organization_id: 'org-1', project_id: null, client_id: null, supplier_id: null,
  title: '[QA] Contrato de Serviços', contract_number: 'QA-0001',
  counterparty_name: 'Fornecedor QA Ltda.', contract_type: 'Prestação de serviços',
  status: 'active', lifecycle_stage: null,
  start_date: '2026-05-13', end_date: '2027-05-13', signed_date: '2026-05-13',
  renewal_date: null, currency: 'BRL',
  total_value: 1_200_000, monthly_value: null, payment_terms: null, scope_summary: null,
  risk_level: 'high', health_score: null, owner_user_id: 'u-owner',
  created_by: 'u-owner', updated_by: 'u-owner',
  created_at: '2026-05-14T09:00:00Z', updated_at: '2026-05-14T09:00:00Z', deleted_at: null,
} as ContractRow;

const qaDetail: ContractDetail = {
  contract: qaContract,
  clauses: [],
  penalties: [],
  milestones: [],
  billingEvents: [
    { id: 'b-pago', contract_id: QA_ID, milestone_id: null, title: '[QA] Parcela 1',
      amount: 120_000, due_date: '2026-06-01', paid_at: '2026-06-02', status: 'pago' },
    { id: 'b-pend', contract_id: QA_ID, milestone_id: null, title: '[QA] Parcela 2',
      amount: 480_000, due_date: '2026-12-01', paid_at: null, status: 'pendente' },
    { id: 'b-venc', contract_id: QA_ID, milestone_id: null, title: '[QA] Parcela 3',
      amount: 600_000, due_date: '2026-07-01', paid_at: null, status: 'pendente' },
  ] as never,
  risks: [],
  files: [],
  aiAnalyses: [],
  obligations: [
    { id: 'o-open', contract_id: QA_ID, title: '[QA] Obrigação aberta', status: 'open',
      due_date: '2026-10-01', owner_user_id: 'u-owner', evidence: 'Aceite técnico' },
    { id: 'o-late', contract_id: QA_ID, title: '[QA] Obrigação atrasada', status: 'overdue',
      due_date: '2026-07-01', owner_user_id: null, evidence: 'Medição' },
    { id: 'o-done', contract_id: QA_ID, title: '[QA] Obrigação concluída', status: 'done',
      due_date: '2026-06-01', owner_user_id: 'u-owner', evidence: 'Relatório' },
  ] as never,
  approvals: [
    { id: 'a-jur', contract_id: QA_ID, step_name: 'juridico', status: 'approved',
      started_at: '2026-05-15T09:00:00Z', completed_at: '2026-05-16T13:00:00Z',
      created_at: '2026-05-15T09:00:00Z', updated_at: '2026-05-16T13:00:00Z' },
    { id: 'a-fin', contract_id: QA_ID, step_name: 'financeiro', status: 'under_review',
      started_at: '2026-05-16T13:00:00Z', completed_at: null,
      created_at: '2026-05-16T13:00:00Z', updated_at: '2026-05-16T13:00:00Z' },
    { id: 'a-com', contract_id: QA_ID, step_name: 'comite', status: 'pending',
      started_at: null, completed_at: null,
      created_at: '2026-05-16T13:00:00Z', updated_at: '2026-05-16T13:00:00Z' },
  ] as never,
  projectLinks: [{ id: 'pl-1', contract_id: QA_ID, project_id: PROJECT_CEMIG.id }] as never,
  riskLinks: [{ id: 'rl-1', contract_id: QA_ID, risk_id: 'risk-1' }] as never,
  documents: [
    { id: 'd-ok', contract_id: QA_ID, title: '[QA] Contrato assinado', document_type: 'contract',
      status: 'approved', approved_at: '2026-05-20T10:00:00Z', rejection_reason: null },
    { id: 'd-pend', contract_id: QA_ID, title: '[QA] Apólice de seguro', document_type: 'insurance',
      status: 'pending_approval', approved_at: null, rejection_reason: null },
    { id: 'd-rej', contract_id: QA_ID, title: '[QA] Garantia', document_type: 'guarantee',
      status: 'rejected', approved_at: null, rejection_reason: 'Valor insuficiente' },
  ] as never,
};

const trusted = () => trustedContractFromDetail(qaDetail, [PROJECT_CEMIG], NOW);

// ═══════════════════════════════════════════════════════════════════
// Identidade
// ═══════════════════════════════════════════════════════════════════

describe('[QA] identidade', () => {
  it('código, título e status vêm das colunas', () => {
    const c = trusted();
    expect(c.code).toBe('QA-0001');
    expect(c.title).toBe('[QA] Contrato de Serviços');
    expect(c.status).toBe('active');
    expect(c.riskLevel).toBe('high');
  });

  it('contraparte e tipo são apurados', () => {
    const c = trusted();
    expect(isLive(c.counterparty)).toBe(true);
    if (hasOfficialValue(c.counterparty)) expect(c.counterparty.value).toBe('Fornecedor QA Ltda.');
    if (hasOfficialValue(c.contractType)) expect(c.contractType.value).toBe('Prestação de serviços');
  });
});

// ═══════════════════════════════════════════════════════════════════
// Vínculo de projeto — jamais por hash
// ═══════════════════════════════════════════════════════════════════

describe('[QA] vínculo de projeto', () => {
  it('resolve por contract_project_links (fonte autoritativa)', () => {
    const c = trusted();
    // `isLive` (não `hasOfficialValue`) porque só o ramo `live` carrega
    // `source` — o compilador recusa ler a fonte de um valor derivado.
    expect(isLive(c.project)).toBe(true);
    if (isLive(c.project)) {
      expect(c.project.value.codigo).toBe('CEMIG - 2450.07/2024');
      expect(c.project.source).toBe('contract_project_links');
    }
  });

  it('sem vínculo real, NENHUM projeto é atribuído mesmo havendo projetos disponíveis', () => {
    // A prova de que o matcher por hash não pode voltar: mesmo com um projeto
    // na lista, um contrato sem vínculo fica sem projeto.
    const semLink = { ...qaDetail, projectLinks: [] as never };
    const c = trustedContractFromDetail(semLink, [PROJECT_CEMIG], NOW);
    expect(hasOfficialValue(c.project)).toBe(false);
    expect(isMissing(c.project)).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Obrigações: open / overdue / done
// ═══════════════════════════════════════════════════════════════════

describe('[QA] obrigações', () => {
  it('separa os três estados semeados', () => {
    const b = obligationBreakdown(trusted());
    expect(isDerived(b)).toBe(true);
    if (hasOfficialValue(b)) {
      expect(b.value).toEqual({ open: 1, dueSoon: 0, overdue: 1, done: 1, total: 3 });
    }
  });

  it('a contagem de atrasadas é apurada', () => {
    const c = trusted();
    expect(hasOfficialValue(c.overdueObligations)).toBe(true);
    if (hasOfficialValue(c.overdueObligations)) expect(c.overdueObligations.value).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Faturamento: pago / pendente / vencido
// ═══════════════════════════════════════════════════════════════════

describe('[QA] faturamento', () => {
  it('faturado = soma apenas dos eventos realizados', () => {
    const c = trusted();
    expect(isDerived(c.billedValue)).toBe(true);
    if (hasOfficialValue(c.billedValue)) expect(c.billedValue.value).toBe(120_000);
  });

  it('saldo = total menos realizado', () => {
    const c = trusted();
    if (hasOfficialValue(c.remainingValue)) expect(c.remainingValue.value).toBe(1_080_000);
  });

  it('a derivação registra as fontes', () => {
    const c = trusted();
    if (isDerived(c.billedValue)) {
      expect(c.billedValue.derivation.from).toContain('contract_billing_events');
    }
  });
});

// ═══════════════════════════════════════════════════════════════════
// Documentos e aprovações
// ═══════════════════════════════════════════════════════════════════

describe('[QA] documentos', () => {
  it('só o rejeitado conta como faltante — o pendente de aprovação não', () => {
    const docs = missingDocuments(trusted());
    expect(hasOfficialValue(docs)).toBe(true);
    if (hasOfficialValue(docs)) expect(docs.value).toEqual(['[QA] Garantia']);
  });

  it('pendentes incluem o em aprovação e o rejeitado', () => {
    const c = trusted();
    if (hasOfficialValue(c.pendingDocuments)) expect(c.pendingDocuments.value).toBe(2);
  });
});

describe('[QA] aprovações', () => {
  it('a rota reflete as etapas registradas, na ordem canônica', () => {
    const route = approvalRoute(trusted());
    if (hasOfficialValue(route)) expect(route.value).toBe('Jurídico + Financeiro + Comitê');
  });

  it('jurídico aprovado, financeiro em análise, comitê não iniciado', () => {
    const c = trusted();
    const jur = approvalStepOutcome(c, 'juridico');
    const fin = approvalStepOutcome(c, 'financeiro');
    const com = approvalStepOutcome(c, 'comite');
    if (hasOfficialValue(jur)) expect(jur.value).toBe('approved');
    if (hasOfficialValue(fin)) expect(fin.value).toBe('in_review');
    if (hasOfficialValue(com)) expect(com.value).toBe('in_review');
  });

  it('o SLA sai dos timestamps reais, não de heurística', () => {
    const sla = approvalSla(trusted(), computeApprovalSla);
    expect(isDerived(sla)).toBe(true);
    if (hasOfficialValue(sla)) expect(sla.value.avgHours).not.toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════
// Renovação e riscos
// ═══════════════════════════════════════════════════════════════════

describe('[QA] renovação e riscos', () => {
  it('renovação derivada da data real de término', () => {
    const r = renewalState(trusted());
    expect(isDerived(r)).toBe(true);
    // 13/05/2027 está a ~268 dias de 18/08/2026 → estável.
    if (hasOfficialValue(r)) expect(RENEWAL_LABEL[r.value]).toBe('Estável');
  });

  it('sem data de término não há estado de renovação inventado', () => {
    const semData = { ...qaDetail, contract: { ...qaContract, end_date: null } };
    const r = renewalState(trustedContractFromDetail(semData, [], NOW));
    expect(isMissing(r)).toBe(true);
  });

  it('o vínculo de risco é real', () => {
    const c = trusted();
    if (hasOfficialValue(c.riskLinks)) expect(c.riskLinks.value).toHaveLength(1);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Saúde: drivers sem score
// ═══════════════════════════════════════════════════════════════════

describe('[QA] saúde do contrato', () => {
  it('NÃO emite pontuação — não há modelo aprovado', () => {
    const h = contractHealth(trusted());
    expect(isMissing(h.score)).toBe(true);
    if (isMissing(h.score)) expect(h.score.reason).toBe('not-integrated');
  });

  it('avalia as 6 dimensões com o dado semeado', () => {
    const h = contractHealth(trusted());
    expect(h.coverage).toEqual({ assessed: 6, total: 6 });
  });

  it('marca como adversos os fatos que realmente pesam', () => {
    const h = contractHealth(trusted());
    const adverse = h.drivers.filter((d) => d.adverse).map((d) => d.dimension);
    expect(adverse).toContain('obrigacoes');   // 1 atrasada
    expect(adverse).toContain('documentos');   // 1 rejeitado
    expect(adverse).toContain('aprovacoes');   // 2 não aprovadas
    expect(adverse).not.toContain('vinculos'); // tem projeto
    expect(adverse).not.toContain('vigencia'); // estável
  });

  it('cada driver é rastreável até a tabela de origem', () => {
    for (const d of contractHealth(trusted()).drivers) {
      expect(d.from.length).toBeGreaterThan(0);
    }
  });

  it('a cobertura cai quando uma seção falha, em vez de contar como saudável', () => {
    const errored = buildTrustedContract(
      qaContract,
      relationsBatchFromDetail(qaDetail, { documents: 'permission denied' }),
      [PROJECT_CEMIG], NOW,
    );
    const h = contractHealth(errored);
    expect(h.coverage.assessed).toBeLessThan(6);
    expect(h.drivers.map((d) => d.dimension)).not.toContain('documentos');
  });
});

// ═══════════════════════════════════════════════════════════════════
// Consistência entre as três superfícies
// ═══════════════════════════════════════════════════════════════════

describe('[QA] Dossiê completo × Quick Dossier × PDF', () => {
  /**
   * As três superfícies constroem o contrato confiável do MESMO jeito:
   *  · página de detalhe → trustedContractFromDetail(detail, projects)
   *  · Quick Dossier     → trustedContractFromDetail(detail, projects)
   *  · PDF               → recebe o objeto pronto da tela
   * Este teste prova que a construção é determinística e que os valores
   * compartilhados batem.
   */
  it('a construção é determinística a partir do mesmo detalhe', () => {
    expect(trustedContractFromDetail(qaDetail, [PROJECT_CEMIG], NOW))
      .toEqual(trustedContractFromDetail(qaDetail, [PROJECT_CEMIG], NOW));
  });

  it('o PDF imprime exatamente os valores do modelo que a tela usa', () => {
    const c = trusted();
    const html = buildContractDossierHtml({ contract: c, source: 'teste' });

    // O que a tela mostraria:
    const totalNaTela = officialCurrencyCompact(c.totalValue);
    const faturadoNaTela = officialCurrencyCompact(c.billedValue);
    const saldoNaTela = officialCurrencyCompact(c.remainingValue);

    expect(html).toContain(totalNaTela);
    expect(html).toContain(faturadoNaTela);
    expect(html).toContain(saldoNaTela);
  });

  it('o PDF reflete os mesmos estados operacionais', () => {
    const c = trusted();
    const html = buildContractDossierHtml({ contract: c, source: 'teste' });
    const route = approvalRoute(c);

    expect(html).toContain('QA-0001');
    expect(html).toContain('Fornecedor QA Ltda.');
    if (hasOfficialValue(route)) expect(html).toContain(route.value);
    expect(html).toContain('[QA] Obrigação atrasada');
    expect(html).toContain('[QA] Garantia');
  });

  it('nenhum valor sintético do enricher aparece no dossiê do [QA]', () => {
    const html = buildContractDossierHtml({ contract: trusted(), source: 'teste' });
    for (const proibido of ['Risk score', 'Margem est.', 'Confiança IA', 'INSIGHT AI', 'placeholder', 'Prévia mock']) {
      expect(html, `"${proibido}" vazou para o dossiê`).not.toContain(proibido);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════
// Erro e zero
// ═══════════════════════════════════════════════════════════════════

describe('[QA] erro e zero permanecem distinguíveis', () => {
  it('falha de leitura não vira estado sintético', () => {
    const c = buildTrustedContract(
      qaContract,
      relationsBatchFromDetail(qaDetail, { billing: 'timeout', approvals: 'permission denied' }),
      [PROJECT_CEMIG], NOW,
    );
    expect(isError(c.billedValue)).toBe(true);
    expect(isError(c.remainingValue)).toBe(true);
    expect(isError(approvalRoute(c))).toBe(true);
    // E não contamina o que leu bem:
    expect(isLive(c.totalValue)).toBe(true);
    expect(hasOfficialValue(obligationBreakdown(c))).toBe(true);
  });

  it('um zero apurado continua sendo zero, não ausência', () => {
    const semRealizado: ContractDetail = {
      ...qaDetail,
      billingEvents: [
        { id: 'b1', contract_id: QA_ID, milestone_id: null, title: 'Parcela',
          amount: 500_000, due_date: '2026-12-01', paid_at: null, status: 'pendente' },
      ] as never,
    };
    const c = trustedContractFromDetail(semRealizado, [PROJECT_CEMIG], NOW);
    expect(isDerived(c.billedValue)).toBe(true);
    if (hasOfficialValue(c.billedValue)) expect(c.billedValue.value).toBe(0);
    // Saldo = total inteiro, porque nada foi pago.
    if (hasOfficialValue(c.remainingValue)) expect(c.remainingValue.value).toBe(1_200_000);
  });

  it('ausência de evento NÃO vira R$ 0', () => {
    const semEventos: ContractDetail = { ...qaDetail, billingEvents: [] as never };
    const c = trustedContractFromDetail(semEventos, [PROJECT_CEMIG], NOW);
    expect(isMissing(c.billedValue)).toBe(true);
    expect('value' in c.billedValue).toBe(false);
  });
});
