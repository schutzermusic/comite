/**
 * Fase 6 — a leitura da prontidão, e a regra que ela nunca quebra.
 *
 *   INFORMAÇÃO AUSENTE NUNCA VIRA `READY`.
 *
 * O resolvedor mora no banco (migration 132) e é provado pela bateria da
 * aplicação. O que se prova AQUI é a borda: o que acontece quando o jsonb
 * chega truncado, com um estado que o cliente não conhece, ou sem chegar.
 * É a borda que costuma inverter o sinal — um `undefined` que vira "pronto"
 * porque ninguém checou.
 */
import { describe, expect, it } from 'vitest';
import {
  parseReadiness, readinessReasonLabel,
  READINESS_DIMENSION_LABEL, READINESS_REASON_LABEL,
  MEASUREMENT_STATUS_LABEL, EVIDENCE_CLASS_LABEL, REQUIREMENT_KIND_LABEL,
  ACCEPTANCE_SOURCE_LABEL, EXTERNAL_ACCEPTANCE_SOURCES, FINALIZED_STATUSES,
} from '@/lib/projects/measurements/types';

describe('leitura da prontidão', () => {
  it('resposta vazia é UNKNOWN, nunca READY', () => {
    const r = parseReadiness(undefined);
    expect(r.overall).toBe('UNKNOWN');
    for (const d of Object.values(r.dimensions)) expect(d).toBe('UNKNOWN');
  });

  it('estado que o cliente não reconhece cai para UNKNOWN', () => {
    const r = parseReadiness({ overall: 'PRONTINHO', dimensions: { submission: 'TALVEZ' } });
    expect(r.overall).toBe('UNKNOWN');
    expect(r.dimensions.submission).toBe('UNKNOWN');
  });

  it('dimensão ausente no payload é UNKNOWN, e não herda o geral', () => {
    const r = parseReadiness({ overall: 'READY', dimensions: { execution: 'READY' } });
    expect(r.dimensions.execution).toBe('READY');
    expect(r.dimensions.acceptance).toBe('UNKNOWN');
  });

  it('preserva razões, contagens e a marca de cálculo do cache', () => {
    const r = parseReadiness({
      overall: 'BLOCKED',
      dimensions: { billing_prerequisite: 'BLOCKED' },
      reasons: ['OBLIGATION_BLOCKING'],
      missing_requirements: ['TECHNICAL_REPORT'],
      unknown_requirements: [],
      evidence_count: 3, validated_evidence_count: 1, blocking_obligations: 2,
      rule_resolved: true, timeline_mapped: true, occurrence_state: 'resolved',
      as_of: '2026-09-06',
    }, '2026-09-06T10:00:00Z');
    expect(r.overall).toBe('BLOCKED');
    expect(r.reasons).toEqual(['OBLIGATION_BLOCKING']);
    expect(r.missingRequirements).toEqual(['TECHNICAL_REPORT']);
    expect(r.blockingObligations).toBe(2);
    expect(r.computedAt).toBe('2026-09-06T10:00:00Z');
  });

  it('flags só são verdadeiras quando vêm verdadeiras', () => {
    const r = parseReadiness({ rule_resolved: 'sim', timeline_mapped: 1 });
    expect(r.ruleResolved).toBe(false);
    expect(r.timelineMapped).toBe(false);
  });

  it('ocorrência não reconhecida é tratada como resolvida só quando o é', () => {
    expect(parseReadiness({ occurrence_state: 'unresolved' }).occurrenceState).toBe('unresolved');
    expect(parseReadiness({}).occurrenceState).toBe('resolved');
  });
});

describe('vocabulário exibível', () => {
  it('toda razão conhecida tem rótulo, e a desconhecida devolve o código', () => {
    for (const k of Object.keys(READINESS_REASON_LABEL)) {
      expect(readinessReasonLabel(k)).not.toBe('');
    }
    expect(readinessReasonLabel('CODIGO_NOVO')).toBe('CODIGO_NOVO');
  });

  it('todo estado, dimensão, classe e exigência tem rótulo', () => {
    for (const m of [MEASUREMENT_STATUS_LABEL, READINESS_DIMENSION_LABEL,
                     EVIDENCE_CLASS_LABEL, REQUIREMENT_KIND_LABEL, ACCEPTANCE_SOURCE_LABEL]) {
      for (const v of Object.values(m)) expect(String(v).length).toBeGreaterThan(0);
    }
  });

  it('revisor interno NÃO é fonte externa — a distinção é o ator', () => {
    expect(EXTERNAL_ACCEPTANCE_SOURCES).not.toContain('internal_reviewer');
    expect(EXTERNAL_ACCEPTANCE_SOURCES).toContain('customer_portal');
    expect(EXTERNAL_ACCEPTANCE_SOURCES).toContain('signed_bulletin');
  });

  it('SUBMETIDO não é estado final; ACEITO e REJEITADO são', () => {
    expect(FINALIZED_STATUSES).not.toContain('SUBMITTED');
    expect(FINALIZED_STATUSES).toContain('ACCEPTED');
    expect(FINALIZED_STATUSES).toContain('REJECTED');
    // Devolvido para correção NÃO é final: o pacote volta.
    expect(FINALIZED_STATUSES).not.toContain('RETURNED_FOR_CORRECTION');
  });
});
