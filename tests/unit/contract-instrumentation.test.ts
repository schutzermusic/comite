/**
 * P2B — instrumentação operacional de marcos, cláusulas e penalidades.
 *
 * As funções testadas aqui são as PURAS extraídas dos caminhos de escrita: o
 * vitest deste repositório roda em `node` sem mock de Supabase, então a regra
 * de negócio precisa ser testável sem I/O. É o mesmo motivo pelo qual
 * `buildContractUpdatePayload` foi extraída em P0.2.
 */

import { describe, it, expect } from 'vitest';
import {
  buildMilestoneCreatePayload,
  buildMilestoneUpdatePayload,
  buildClauseCreatePayload,
  MEASURED_STATUSES,
  MILESTONE_STATUS_LABEL,
  CLAUSE_REVIEW_LABEL,
} from '@/lib/contracts/contract-service';

const NOW = new Date('2026-08-19T12:00:00.000Z');

// ═══════════════════════════════════════════════════════════════════
// Marcos
// ═══════════════════════════════════════════════════════════════════

describe('buildMilestoneCreatePayload', () => {
  it('um marco nasce previsto e SEM valor medido', () => {
    const payload = buildMilestoneCreatePayload(
      { contractId: 'c1', title: '  Medição fase 1  ', billingAmount: 480_000 },
      'org-1', 'u-1',
    );
    expect(payload.status).toBe('pending');
    // `null`, não `0`: ninguém mediu ainda. Zero afirmaria medição com resultado.
    expect(payload.measured_amount).toBeNull();
    expect(payload.completed_at).toBeNull();
    expect(payload.title).toBe('Medição fase 1');
    expect(payload.billing_amount).toBe(480_000);
  });

  it('carimba autoria nas duas pontas', () => {
    const payload = buildMilestoneCreatePayload({ contractId: 'c1', title: 'X' }, 'org-1', 'u-1');
    expect(payload.created_by).toBe('u-1');
    expect(payload.updated_by).toBe('u-1');
    expect(payload.organization_id).toBe('org-1');
  });

  it('campo vazio vira null, nunca string vazia', () => {
    const payload = buildMilestoneCreatePayload(
      { contractId: 'c1', title: 'X', description: '   ', evidence: '', milestoneType: '  ' },
      'org-1', 'u-1',
    );
    expect(payload.description).toBeNull();
    expect(payload.evidence).toBeNull();
    expect(payload.milestone_type).toBeNull();
  });
});

describe('buildMilestoneUpdatePayload', () => {
  it('é patch parcial: só o que foi informado entra', () => {
    const payload = buildMilestoneUpdatePayload({ title: 'Novo título' }, 'u-2', NOW);
    expect(Object.keys(payload).sort()).toEqual(['title', 'updated_by']);
  });

  it('entrar em medido carimba a data de conclusão', () => {
    const payload = buildMilestoneUpdatePayload({ status: 'measured' }, 'u-2', NOW);
    expect(payload.status).toBe('measured');
    expect(payload.completed_at).toBe('2026-08-19T12:00:00.000Z');
  });

  it('sair de medido LIMPA a data — senão o marco fica "medido em" uma data que não vale', () => {
    const payload = buildMilestoneUpdatePayload({ status: 'in_progress' }, 'u-2', NOW);
    expect(payload.status).toBe('in_progress');
    expect(payload.completed_at).toBeNull();
  });

  it('aprovado também conta como medido para efeito de carimbo', () => {
    expect(buildMilestoneUpdatePayload({ status: 'approved' }, 'u', NOW).completed_at).not.toBeNull();
    expect(buildMilestoneUpdatePayload({ status: 'cancelled' }, 'u', NOW).completed_at).toBeNull();
  });

  it('valor medido pode ser zerado explicitamente, mas não por omissão', () => {
    // Informar 0 é uma AFIRMAÇÃO: mediu e deu zero.
    expect(buildMilestoneUpdatePayload({ measuredAmount: 0 }, 'u', NOW).measured_amount).toBe(0);
    // Não informar não mexe no campo.
    expect('measured_amount' in buildMilestoneUpdatePayload({ title: 'x' }, 'u', NOW)).toBe(false);
  });

  it('o vocabulário de status é fechado e rotulado', () => {
    expect(Object.keys(MILESTONE_STATUS_LABEL).sort())
      .toEqual(['approved', 'cancelled', 'in_progress', 'measured', 'pending']);
    expect([...MEASURED_STATUSES]).toEqual(['measured', 'approved']);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Cláusulas
// ═══════════════════════════════════════════════════════════════════

describe('buildClauseCreatePayload', () => {
  it('registro manual NUNCA se apresenta como extração automática', () => {
    const payload = buildClauseCreatePayload(
      { contractId: 'c1', title: 'Multa por atraso' }, 'org-1', 'u-1',
    );
    expect(payload.ai_flagged).toBe(false);
  });

  it('registrar não é validar', () => {
    const payload = buildClauseCreatePayload({ contractId: 'c1', title: 'X' }, 'org-1', 'u-1');
    expect(payload.review_status).toBe('draft');
    expect(CLAUSE_REVIEW_LABEL.draft).toBe('Registrada');
    expect(CLAUSE_REVIEW_LABEL.validated).toBe('Validada');
  });

  it('preserva a proveniência documental quando informada', () => {
    const payload = buildClauseCreatePayload(
      {
        contractId: 'c1', title: 'SLA', clauseType: 'sla',
        sourceDocumentId: 'doc-1', sourcePage: 12, sourceExcerpt: '  trecho  ',
        percentage: 2, termDays: 30,
      },
      'org-1', 'u-1',
    );
    expect(payload.source_document_id).toBe('doc-1');
    expect(payload.source_page).toBe(12);
    expect(payload.source_excerpt).toBe('trecho');
    expect(payload.percentage).toBe(2);
    expect(payload.term_days).toBe(30);
  });

  it('efeito contratual ausente fica null — não zero', () => {
    const payload = buildClauseCreatePayload({ contractId: 'c1', title: 'X' }, 'org-1', 'u-1');
    expect(payload.amount).toBeNull();
    expect(payload.percentage).toBeNull();
    expect(payload.term_days).toBeNull();
    // Um percentual 0 seria uma multa de 0% — afirmação diferente de "não tem".
  });

  it('risco padrão é médio, não baixo: registrar sem avaliar não vira "sem risco"', () => {
    expect(buildClauseCreatePayload({ contractId: 'c1', title: 'X' }, 'o', 'u').risk_level).toBe('medium');
  });
});
