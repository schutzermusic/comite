/**
 * Fase 6 — a aquisição automática de evidência, e seus limites.
 *
 * O que estes testes protegem é o TETO da automação. O Apex pode vincular
 * evidência que já existe; não pode concluir execução, não pode subir a classe
 * da evidência e não pode chegar perto do aceite. Cada uma dessas fronteiras
 * tem um teste, porque cada uma delas é a que alguém afrouxaria primeiro sob
 * pressão de "o gestor está digitando demais".
 */
import { describe, expect, it } from 'vitest';
import { acquireEvidence, acquisitionRate } from '@/lib/projects/measurements/evidence-acquisition';
import type { ExecutionEvidence } from '@/lib/projects/execution-evidence';
import type { MatchContext } from '@/lib/projects/execution-matching';

const PROJECT = 'proj-1';
const ITEM = '11111111-1111-4111-8111-111111111111';

/*
  `isActive` e `deletedAt` não são enfeite do fixture: o casamento por vínculo
  explícito exige os dois (`item.isActive && !item.deletedAt`). Omiti-los faria
  o teste exercitar o caminho de fallback sem dizer, que é a pior forma de um
  teste passar.
*/
const item = (over: Record<string, unknown> = {}) => ({
  id: ITEM, projectId: PROJECT, title: 'Etapa', wbsCode: '1.1',
  plannedStart: '2026-03-01', plannedFinish: '2026-03-31',
  status: 'in_progress', responsibleUserId: null, isSummary: false,
  isActive: true, deletedAt: null, assignments: [], ...over,
}) as never;

const ctx = (over: Partial<MatchContext> = {}): MatchContext => ({
  projectId: PROJECT,
  items: [item()],
  allocations: [],
  geofences: [],
  ...over,
});

const evidence = (over: Partial<ExecutionEvidence> = {}): ExecutionEvidence => ({
  id: 'work_session:s1', source: 'work_session', sourceRecordId: 's1', kind: 'work_session',
  projectId: PROJECT, timelineItemId: ITEM, personId: 'p1',
  occurredAt: '2026-03-10T12:00:00Z', durationMinutes: 480, location: null,
  isValid: true, subtype: null, label: 'Sessão', provenance: [],
  ...over,
});

describe('aquisição automática de evidência', () => {
  it('vínculo EXPLÍCITO da origem é determinístico e não carrega confiança', () => {
    const r = acquireEvidence({ evidence: [evidence()], context: ctx(), timelineItemId: ITEM });
    expect(r.autoLinks).toHaveLength(1);
    expect(r.autoLinks[0].linkSource).toBe('deterministic');
    expect(r.autoLinks[0].confidence).toBeNull();
    expect(r.autoLinks[0].evidenceClass).toBe('RAW_EVIDENCE');
  });

  it('registro inválido na origem nunca vira evidência', () => {
    const r = acquireEvidence({
      evidence: [evidence({ isValid: false })], context: ctx(), timelineItemId: ITEM,
    });
    expect(r.autoLinks).toHaveLength(0);
    expect(r.rejected[0].reason).toBe('SOURCE_INVALID');
  });

  it('evidência de OUTRO projeto é descartada, não proposta', () => {
    const r = acquireEvidence({
      evidence: [evidence({ projectId: 'proj-outro', timelineItemId: null })],
      context: ctx(), timelineItemId: ITEM,
    });
    expect(r.autoLinks).toHaveLength(0);
    expect(r.proposals).toHaveLength(0);
    expect(r.rejected[0].reason).toBe('WRONG_PROJECT');
  });

  /*
    A fronteira que mais importa. Uma batida de ponto não declara projeto; ela
    depende do resolvedor. Ela pode entrar — e é isso que poupa digitação —,
    mas SEMPRE como inferida, e nunca como validada ou de aceite.
  */
  it('batida de ponto entra como INFERIDA e nunca sobe de classe', () => {
    const punch = evidence({
      id: 'attendance_punch:a1', source: 'attendance_punch', sourceRecordId: 'a1',
      kind: 'presence', projectId: null, timelineItemId: null, durationMinutes: null,
    });
    const r = acquireEvidence({
      evidence: [punch],
      context: ctx({
        allocations: [{ personId: 'p1', projectId: PROJECT, startDate: '2026-03-01', endDate: null, status: 'active' }],
      }),
      timelineItemId: ITEM,
    });
    const all = [...r.autoLinks, ...r.proposals];
    for (const p of all) {
      expect(p.linkSource).toBe('system_inferred');
      expect(['RAW_EVIDENCE', 'DERIVED_EVIDENCE']).toContain(p.evidenceClass);
      expect(p.evidenceClass).not.toBe('ACCEPTANCE_EVIDENCE');
      expect(p.evidenceClass).not.toBe('VALIDATED_EVIDENCE');
    }
  });

  it('nenhum plano produz evidência de ACEITE, em nenhuma combinação', () => {
    const varios = [
      evidence(),
      evidence({ id: 'daily_allowance:d1', source: 'daily_allowance', sourceRecordId: 'd1', kind: 'field_presence' }),
      evidence({ id: 'project_document:f1', source: 'project_document', sourceRecordId: 'f1', kind: 'deliverable' }),
    ];
    const r = acquireEvidence({ evidence: varios, context: ctx(), timelineItemId: ITEM });
    for (const p of [...r.autoLinks, ...r.proposals]) {
      expect(p.evidenceClass).not.toBe('ACCEPTANCE_EVIDENCE');
    }
  });

  it('evidência casada com OUTRA etapa vira proposta, não vínculo automático', () => {
    const outra = '22222222-2222-4222-8222-222222222222';
    const r = acquireEvidence({
      evidence: [evidence({ timelineItemId: outra })],
      context: ctx({ items: [item(), item({ id: outra, title: 'Outra etapa' })] }),
      timelineItemId: ITEM,
    });
    expect(r.autoLinks).toHaveLength(0);
    expect(r.proposals).toHaveLength(1);
  });

  it('a taxa de aproveitamento é null quando não houve nada a avaliar', () => {
    expect(acquisitionRate({ autoLinks: [], proposals: [], rejected: [] })).toBeNull();
  });

  it('a proveniência guarda o resolvedor e os códigos de razão', () => {
    const r = acquireEvidence({ evidence: [evidence()], context: ctx(), timelineItemId: ITEM });
    expect(r.autoLinks[0].provenance.resolver).toBe('execution-matching');
    expect(Array.isArray(r.autoLinks[0].provenance.reasonCodes)).toBe(true);
  });
});
