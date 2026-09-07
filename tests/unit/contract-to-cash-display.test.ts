/**
 * Fase 7 — as regressões PERMANENTES da apresentação da cadeia.
 *
 * Cada teste aqui corresponde a uma mentira específica que o sistema já
 * contou, ou que contaria sem a regra. Não são testes de formatação: são o
 * portão que impede "R$ 0 recebido" de voltar a aparecer para um contrato que
 * Finanças nunca viu, e "faturado pelo previsto" de voltar a se passar por
 * "faturado pelo medido".
 */
import { describe, expect, it } from 'vitest';
import {
  advisoryReasons, blockerLabel, blockingReasons, canRelease, chainStage,
  displayText, eligibleAmount, formatCents, openAmount, receivedAmount,
  reconciliationPending,
} from '@/lib/contracts/billing/contract-to-cash-display';
import type { ContractToCashRow } from '@/lib/contracts/billing/contract-to-cash-service';

const base: ContractToCashRow = {
  billingEventId: 'be-1', organizationId: 'org-1', contractId: 'c-1', milestoneId: 'm-1',
  title: 'Medição 2026-01', legacyRow: false,
  sourceMeasurementId: 'pm-1', entitlementKey: 'ACCEPTED_MEASUREMENT:c-1:pm-1:1',
  eligibleAmount: 455000, currency: 'BRL', amountSource: 'ACCEPTED_MEASUREMENT',
  amountDerivationRule: 'accepted_measurement.v1', amountDerivedAt: '2026-02-01T00:00:00Z',
  eligibilityState: 'ELIGIBLE', blockers: [], eligibilityComputedAt: '2026-02-01T00:00:00Z',
  releaseState: 'ELIGIBLE', releasedAt: null, releasedBy: null,
  releaseApprovalRequestId: null, supersededById: null, cancelledAt: null,
  retentionState: 'NOT_APPLICABLE', glosaState: 'NOT_APPLICABLE', disputeState: 'NOT_APPLICABLE',
  fiscalRequestState: null, fiscalBlockers: [], fiscalDocumentId: null,
  fiscalDocumentStatus: null, fiscalDocumentNumber: null, fiscalEnvironment: null,
  fiscalAuthorizedAt: null, fiscalFinanceStatus: null,
  receivableId: null, receivableAmountBasis: null, receivableAmountCents: null,
  receivableLifecycleState: null, ledgerPostingState: null, ledgerBlockers: [],
  dueDate: null, paidAmountCents: null, openAmountCents: null, receivableStatus: null,
  financeLinkState: 'UNKNOWN', reconciledSettlementCount: null, unreconciledSettlementCount: null,
};

const row = (patch: Partial<ContractToCashRow>): ContractToCashRow => ({ ...base, ...patch });

describe('valor elegível — procedência obrigatória (§11, §108)', () => {
  it('expõe o valor quando a fonte é medição aceita', () => {
    const v = eligibleAmount(base);
    expect(v.known).toBe(true);
    expect(v.known && v.cents).toBe(45500000);
  });

  it('recusa exibir número quando a procedência é UNKNOWN, mesmo com amount preenchido', () => {
    // A coluna `amount` é NOT NULL e nasce em 0: um faturamento sem fonte
    // apurada tem número na linha e NÃO tem valor apurado. Exibir esse 0
    // afirmaria que não há nada a faturar.
    const v = eligibleAmount(row({ amountSource: 'UNKNOWN', eligibleAmount: 0 }));
    expect(v.known).toBe(false);
    expect(v.known === false && v.reason).toBe('AMOUNT_UNKNOWN');
    expect(displayText(v)).toBe('Não apurado');
  });

  it('linha anterior à Fase 7 declara origem não registrada, e não um valor', () => {
    const v = eligibleAmount(row({ legacyRow: true, amountSource: 'LEGACY_UNKNOWN', eligibleAmount: 143000 }));
    expect(v.known).toBe(false);
    expect(v.known === false && v.reason).toBe('LEGACY_NO_PROVENANCE');
  });

  it('nunca apresenta um valor sem moeda declarada', () => {
    expect(eligibleAmount(row({ currency: null })).known).toBe(false);
  });
});

describe('recebido e em aberto — ausência não é zero (§62)', () => {
  it('sem título em Finanças, RECEBIDO é desconhecido — nunca R$ 0', () => {
    const v = receivedAmount(base);
    expect(v.known).toBe(false);
    expect(v.known === false && v.reason).toBe('NOT_LINKED');
    expect(displayText(v)).toBe('Sem vínculo com Finanças');
    expect(displayText(v)).not.toContain('0,00');
  });

  it('distingue "sem vínculo" de "pendente de configuração"', () => {
    const v = receivedAmount(row({ financeLinkState: 'PENDING_CONFIGURATION' }));
    expect(v.known === false && v.reason).toBe('PENDING_CONFIGURATION');
  });

  it('com título e nada recebido, ZERO é afirmado — porque é verdade', () => {
    const v = receivedAmount(row({
      receivableId: 'ar-1', paidAmountCents: 0, openAmountCents: 45000000,
      financeLinkState: 'LINKED', receivableStatus: 'OPEN',
    }));
    expect(v.known).toBe(true);
    expect(v.known && v.cents).toBe(0);
  });

  it('pagamento parcial aparece como parcial nos dois valores', () => {
    const r = row({
      receivableId: 'ar-1', paidAmountCents: 18000000, openAmountCents: 27000000,
      financeLinkState: 'LINKED', receivableStatus: 'PARTIAL',
      receivableLifecycleState: 'ACTIVE',
    });
    expect(receivedAmount(r).known && receivedAmount(r).known === true).toBe(true);
    const rec = receivedAmount(r); const op = openAmount(r);
    expect(rec.known && rec.cents).toBe(18000000);
    expect(op.known && op.cents).toBe(27000000);
    expect(chainStage(r)).toBe('Contas a receber');
  });
});

describe('elegibilidade e liberação são dimensões distintas (§14, §60)', () => {
  it('elegível não é liberado, e o botão só aparece antes da liberação', () => {
    expect(canRelease(base)).toBe(true);
    expect(canRelease(row({ releaseState: 'RELEASED', releasedAt: '2026-02-02T00:00:00Z' }))).toBe(false);
    expect(canRelease(row({ releaseState: 'PENDING_RELEASE' }))).toBe(false);
  });

  it('bloqueado nunca é liberável', () => {
    expect(canRelease(row({ eligibilityState: 'BLOCKED', releaseState: 'NOT_ELIGIBLE' }))).toBe(false);
  });

  it('separa o que impede o DIREITO do que trava o passo seguinte', () => {
    const r = row({
      eligibilityState: 'BLOCKED',
      blockers: [
        { code: 'OBLIGATION_BLOCKING', blocking: true, title: 'ART obrigatória' },
        { code: 'FISCAL_PROFILE_INCOMPLETE', blocking: false },
      ],
    });
    expect(blockingReasons(r).map((b) => b.code)).toEqual(['OBLIGATION_BLOCKING']);
    expect(advisoryReasons(r).map((b) => b.code)).toEqual(['FISCAL_PROFILE_INCOMPLETE']);
  });

  it('traduz os códigos da §16 e devolve o código quando não conhece', () => {
    expect(blockerLabel('MEASUREMENT_NOT_ACCEPTED')).toBe('Medição ainda não aceita');
    expect(blockerLabel('CODIGO_INEDITO')).toBe('CODIGO_INEDITO');
  });
});

describe('estágio da cadeia (§60, §119)', () => {
  it('nota cancelada não é apresentada como cobrável', () => {
    const r = row({
      receivableId: 'ar-1', receivableLifecycleState: 'CANCELLED',
      financeLinkState: 'CLOSED', receivableStatus: 'CANCELLED',
      fiscalDocumentStatus: 'cancelled', releaseState: 'RELEASED',
      releasedAt: '2026-02-02T00:00:00Z',
    });
    expect(chainStage(r)).toBe('Título encerrado');
  });

  it('bloqueio fiscal por configuração é dito, não escondido', () => {
    const r = row({
      releaseState: 'RELEASED', releasedAt: '2026-02-02T00:00:00Z',
      fiscalRequestState: 'BLOCKED_BY_CONFIGURATION',
    });
    expect(chainStage(r)).toBe('Fiscal bloqueado por configuração');
  });

  it('recebido só quando o título está pago', () => {
    expect(chainStage(row({
      receivableId: 'ar-1', receivableLifecycleState: 'ACTIVE', receivableStatus: 'PAID',
    }))).toBe('Recebido');
  });
});

describe('conciliação é distinta de pagamento (§49)', () => {
  it('sem título, a pergunta não se aplica', () => {
    expect(reconciliationPending(base)).toBeNull();
  });

  it('pagamento registrado e não conciliado é contado à parte', () => {
    expect(reconciliationPending(row({
      receivableId: 'ar-1', paidAmountCents: 18000000,
      reconciledSettlementCount: 0, unreconciledSettlementCount: 1,
    }))).toBe(1);
  });
});

describe('precisão (§79)', () => {
  it('formata centavos inteiros sem passar por ponto flutuante no valor', () => {
    expect(formatCents(45000000, 'BRL').replace(/ /g, ' ')).toBe('R$ 450.000,00');
    expect(formatCents(1, 'BRL').replace(/ /g, ' ')).toBe('R$ 0,01');
  });
});
