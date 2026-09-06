/**
 * Regressão das três correções de integridade de dado do módulo Contratos
 * (P0.2, 18/08/2026). Cada bloco existe para travar um comportamento que já
 * causou ou podia causar perda de dado / dado fabricado passando por apurado.
 *
 * Os alvos são funções PURAS extraídas das três correções — o repositório roda
 * vitest em `environment: 'node'` sem jsdom e sem mocks de Supabase, então a
 * lógica de decisão precisa ser testável sem I/O.
 */

import { describe, it, expect } from 'vitest';
import {
  buildContractSoftDeletePatch,
  buildContractUpdatePayload,
  describeRelationErrors,
  failedRelationSections,
  type ContractRelationErrors,
  type ContractRelationsBatch,
  type UpdateContractInput,
} from '@/lib/contracts/contract-service';

// ═══════════════════════════════════════════════════════════════════
// FIX 1 — soft delete de verdade
// ═══════════════════════════════════════════════════════════════════

describe('buildContractSoftDeletePatch', () => {
  it('grava deleted_at em ISO e a autoria — nunca apaga a linha', () => {
    const patch = buildContractSoftDeletePatch('user-1', new Date('2026-08-18T12:34:56.000Z'));
    expect(patch).toStrictEqual({
      deleted_at: '2026-08-18T12:34:56.000Z',
      updated_by: 'user-1',
    });
  });

  it('o patch é um UPDATE: não contém instrução de exclusão física', () => {
    const patch = buildContractSoftDeletePatch('user-1');
    // Existe para impedir a regressão histórica: `softDeleteContract` chamava
    // `.delete()`, levando obrigações/faturamento/documentos em CASCADE.
    expect(Object.keys(patch).sort()).toEqual(['deleted_at', 'updated_by']);
    expect(patch.deleted_at).not.toBeNull();
    expect(Date.parse(patch.deleted_at)).not.toBeNaN();
  });
});

// ═══════════════════════════════════════════════════════════════════
// FIX 2 — PATCH parcial explícito
// ═══════════════════════════════════════════════════════════════════

describe('buildContractUpdatePayload', () => {
  it('envia SOMENTE os campos fornecidos (caso real: enviar ao jurídico)', () => {
    // `useContractActionModals.sendToLegal` passa 2 dos 19 campos. Se os outros
    // 17 fossem enviados como undefined→NULL, isto apagaria title, currency e
    // risk_level (todos NOT NULL) e zeraria valor, datas e contraparte.
    const payload = buildContractUpdatePayload(
      { status: 'legal_review', lifecycleStage: 'legal_review' },
      'user-1',
    );

    // `toStrictEqual` + checagem de chaves porque `toEqual` do vitest IGNORA
    // propriedades com valor `undefined` — com ele, um payload de 19 colunas
    // cheio de undefined passaria como se fossem 3.
    expect(Object.keys(payload).sort()).toEqual(['lifecycle_stage', 'status', 'updated_by']);
    expect(payload).toStrictEqual({
      status: 'legal_review',
      lifecycle_stage: 'legal_review',
      updated_by: 'user-1',
    });
  });

  it('não depende de JSON.stringify para descartar undefined', () => {
    // A correção anterior era acidental: postgrest-js serializa com
    // JSON.stringify, que derruba chaves undefined. Aqui a omissão é explícita,
    // então a chave não existe nem antes da serialização.
    const payload = buildContractUpdatePayload(
      { title: 'Contrato A', totalValue: undefined },
      'user-1',
    );

    expect('total_value' in payload).toBe(false);
    expect(payload).toStrictEqual({ title: 'Contrato A', updated_by: 'user-1' });
  });

  it('preserva null como valor legítimo — é assim que se limpa uma coluna', () => {
    // Desvincular projeto e remover data de renovação são operações válidas.
    const payload = buildContractUpdatePayload(
      { projectId: null, renewalDate: null },
      'user-1',
    );

    expect(payload).toStrictEqual({
      project_id: null,
      renewal_date: null,
      updated_by: 'user-1',
    });
  });

  it('mapeia todos os 20 campos para as colunas snake_case corretas', () => {
    const full: UpdateContractInput = {
      projectId: 'p1', title: 't', contractNumber: 'n', counterpartyName: 'c',
      counterpartyPartyId: 'party-1',
      contractType: 'ct', status: 'active', lifecycleStage: 'ls',
      startDate: '2026-01-01', endDate: '2026-12-31', signedDate: '2026-01-02',
      renewalDate: '2026-11-01', currency: 'BRL', totalValue: 10, monthlyValue: 1,
      paymentTerms: 'pt', scopeSummary: 'ss', riskLevel: 'high', healthScore: 80,
      ownerUserId: 'o1',
    };

    const payload = buildContractUpdatePayload(full, 'user-1');

    expect(Object.keys(payload).sort()).toEqual([
      'contract_number', 'contract_type', 'counterparty_name',
      'counterparty_party_id', 'currency',
      'end_date', 'health_score', 'lifecycle_stage', 'monthly_value',
      'owner_user_id', 'payment_terms', 'project_id', 'renewal_date',
      'risk_level', 'scope_summary', 'signed_date', 'start_date', 'status',
      'title', 'total_value', 'updated_by',
    ]);
  });

  it('grava updated_by mesmo com input vazio', () => {
    expect(buildContractUpdatePayload({}, 'user-1')).toStrictEqual({ updated_by: 'user-1' });
  });

  it('ignora chaves desconhecidas em vez de vazá-las para o banco', () => {
    const payload = buildContractUpdatePayload(
      { title: 't', naoExiste: 'x' } as UpdateContractInput,
      'user-1',
    );
    expect(payload).toStrictEqual({ title: 't', updated_by: 'user-1' });
  });
});

// ═══════════════════════════════════════════════════════════════════
// FIX 3 — falha de consulta ≠ ausência de dado
// ═══════════════════════════════════════════════════════════════════

const noErrors = (): ContractRelationErrors => ({
  obligations: null, billing: null, documents: null,
  approvals: null, projectLinks: null, risks: null, ai: null,
  milestones: null, clauses: null, penalties: null, obligationDefinitions: null,
});

const batchWith = (errors: ContractRelationErrors): ContractRelationsBatch =>
  ({ sectionErrors: errors } as ContractRelationsBatch);

describe('failedRelationSections', () => {
  it('não acusa falha quando todas as consultas tiveram sucesso', () => {
    expect(failedRelationSections(noErrors())).toEqual([]);
  });

  it('lista apenas as seções que realmente falharam', () => {
    const errors = { ...noErrors(), documents: 'permission denied', risks: 'timeout' };
    expect(failedRelationSections(errors)).toEqual(['documents', 'risks']);
  });
});

describe('describeRelationErrors', () => {
  it('devolve null quando tudo leu bem — sucesso com zero linhas NÃO é erro', () => {
    // A distinção central da correção: um contrato legitimamente sem
    // obrigações não pode ser confundido com uma consulta que falhou.
    expect(describeRelationErrors(batchWith(noErrors()))).toBeNull();
  });

  it('descreve a falha de uma única seção e nega que ela seja apurada', () => {
    const msg = describeRelationErrors(
      batchWith({ ...noErrors(), billing: 'permission denied for table' }),
    );
    expect(msg).toContain('faturamento');
    expect(msg).toContain('não pode ser considerada apurada');
  });

  it('agrega múltiplas falhas com contagem', () => {
    const msg = describeRelationErrors(
      batchWith({ ...noErrors(), obligations: 'x', documents: 'y', ai: 'z' }),
    );
    expect(msg).toContain('3 seções');
    expect(msg).toContain('obrigações');
    expect(msg).toContain('documentos');
    expect(msg).toContain('análises de IA');
  });

  it('uma seção com erro nunca é silenciosamente tratada como vazia', () => {
    // Este é o teste que o bug original teria falhado: antes, o erro virava []
    // e a página caía no enricher sintético sem qualquer sinal ao usuário.
    for (const key of ['obligations', 'billing', 'documents', 'approvals', 'projectLinks', 'risks', 'ai'] as const) {
      const msg = describeRelationErrors(batchWith({ ...noErrors(), [key]: 'falhou' }));
      expect(msg, `seção ${key} deveria reportar erro`).not.toBeNull();
    }
  });
});
