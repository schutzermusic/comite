/**
 * P3B — política de automação e reconstrução de sessão.
 *
 * Duas invariantes dominam este arquivo:
 *   1. a automação FALHA FECHADA — dúvida sempre desce na escala;
 *   2. a reconstrução NUNCA inventa um fim de sessão.
 *
 * Os cenários de reconstrução foram desenhados a partir do dado REAL do banco
 * (entrada sem saída, intervalo no mesmo minuto da entrada, dois turnos curtos
 * seguidos, batida cancelada) — não de um dia ideal de 8 h.
 */

import { describe, it, expect } from 'vitest';
import {
  evaluateAutomation,
  describeVerdict,
  AUTOMATION_POLICY,
  NEVER_AUTOMATED,
  computeExecutionAutonomy,
  EMPTY_EXECUTION_AUTONOMY,
  type ApexSessionSummary,
  type PolicyVerdict,
  type WriteKind,
} from '@/lib/projects/execution-policy';
import {
  reconstructSegments,
  observedMinutes,
  automationKeyFor,
} from '@/lib/projects/session-reconstruction';
import { fromAttendancePunch, type ExecutionEvidence } from '@/lib/projects/execution-evidence';
import type { EvidenceMatch, ReasonCode } from '@/lib/projects/execution-matching';
import { buildSessionCandidates, autoApplicable } from '@/lib/projects/execution-automation';

const PERSON = 'person-joao';

function match(over: Partial<EvidenceMatch> = {}): EvidenceMatch {
  return {
    evidenceId: 'ev-1',
    status: 'MATCHED',
    confidence: 0.92,
    projectId: 'proj-1',
    timelineItemId: 'item-1',
    personId: PERSON,
    reasonCodes: ['SINGLE_ASSIGNED_OPEN_ITEM'] as ReasonCode[],
    candidates: [],
    autoApplied: true,
    ...over,
  };
}

const punch = (type: string, iso: string, over: { id?: string; status?: string } = {}): ExecutionEvidence =>
  fromAttendancePunch({
    id: over.id ?? `${type}-${iso}`,
    personId: PERSON,
    type,
    occurredAt: iso,
    status: over.status ?? 'accepted',
    location: null,
  });

/* ─────────────────────────── P3B-1 — política ─────────────────────────── */

describe('política de automação', () => {
  it('confiança alta e sem conflito ⇒ AUTO_APPLY', () => {
    const v = evaluateAutomation({ match: match(), writeKind: 'work_session' });
    expect(v.decision).toBe('AUTO_APPLY');
    expect(v.reasons).toContain('CONFIDENCE_ABOVE_AUTO');
  });

  it('confiança intermediária ⇒ PROPOSE, nunca escrita direta', () => {
    const v = evaluateAutomation({
      match: match({ confidence: 0.55, reasonCodes: ['SINGLE_ITEM_IN_WINDOW'] }),
      writeKind: 'work_session',
    });
    expect(v.decision).toBe('PROPOSE');
  });

  it('confiança abaixo do piso ⇒ REJECT', () => {
    const v = evaluateAutomation({ match: match({ confidence: 0.2 }), writeKind: 'work_session' });
    expect(v.decision).toBe('REJECT');
    expect(v.reasons).toContain('CONFIDENCE_BELOW_PROPOSE');
  });

  it('AMBIGUOUS é decisão humana por definição', () => {
    const v = evaluateAutomation({
      match: match({ status: 'AMBIGUOUS', confidence: 0, timelineItemId: null }),
      writeKind: 'work_session',
    });
    expect(v.decision).toBe('REQUIRE_HUMAN');
    expect(v.reasons).toEqual(['STATUS_AMBIGUOUS']);
  });

  it('UNMATCHED não gera nada', () => {
    const v = evaluateAutomation({
      match: match({ status: 'UNMATCHED', confidence: 0, timelineItemId: null }),
      writeKind: 'work_session',
    });
    expect(v.decision).toBe('REJECT');
  });

  it('evidência contraditória REBAIXA mesmo com confiança máxima', () => {
    const v = evaluateAutomation({
      match: match({ confidence: 1, reasonCodes: ['ASSIGNMENT_CONTRADICTS_LOCATION'] }),
      writeKind: 'work_session',
    });
    expect(v.decision).toBe('REQUIRE_HUMAN');
    expect(v.reasons).toContain('CONTRADICTORY_EVIDENCE');
  });

  it('dado humano existente impede escrita automática — no máximo sugere', () => {
    const v = evaluateAutomation({ match: match(), writeKind: 'work_session', hasManualData: true });
    expect(v.decision).toBe('PROPOSE');
    expect(v.reasons).toContain('MANUAL_DATA_PRESENT');
  });

  it('campo fora do perímetro é rejeitado mesmo com confiança 1', () => {
    const v = evaluateAutomation({
      match: match({ confidence: 1 }),
      writeKind: 'percentComplete' as unknown as WriteKind,
    });
    expect(v.decision).toBe('REJECT');
    expect(v.reasons).toEqual(['WRITE_KIND_NOT_AUTOMATABLE']);
  });

  it('a lista de campos jamais automatizados é explícita e verificável', () => {
    expect(NEVER_AUTOMATED).toContain('percentComplete');
    expect(NEVER_AUTOMATED).toContain('plannedStart');
    expect(NEVER_AUTOMATED).toContain('responsibleUserId');
    // Nenhum deles é aceito como destino de escrita.
    for (const field of NEVER_AUTOMATED) {
      expect(
        evaluateAutomation({ match: match({ confidence: 1 }), writeKind: field as unknown as WriteKind }).decision,
      ).toBe('REJECT');
    }
  });

  it('MATCHED sem etapa de destino é rejeitado', () => {
    const v = evaluateAutomation({ match: match({ timelineItemId: null }), writeKind: 'work_session' });
    expect(v.decision).toBe('REJECT');
    expect(v.reasons).toContain('NO_TIMELINE_ITEM');
  });

  it('limiares vivem num único objeto e são coerentes entre si', () => {
    expect(AUTOMATION_POLICY.autoApplyMin).toBeGreaterThan(AUTOMATION_POLICY.proposeMin);
    expect(AUTOMATION_POLICY.rejectBelow).toBeLessThanOrEqual(AUTOMATION_POLICY.proposeMin);
  });

  it('o veredito é explicável em texto', () => {
    expect(describeVerdict(evaluateAutomation({ match: match(), writeKind: 'work_session' })))
      .toContain('Confiança suficiente');
  });
});

/* ──────────────────── P3B-3 — reconstrução de sessão ──────────────────── */

describe('reconstrução de sessão', () => {
  const reconstruct = (evidence: ExecutionEvidence[]) =>
    reconstructSegments({ evidence, personId: PERSON });

  it('turno simples com almoço vira DOIS segmentos, não um', () => {
    const segs = reconstruct([
      punch('clock_in', '2026-08-12T08:03:00.000Z'),
      punch('break_start', '2026-08-12T12:04:00.000Z'),
      punch('break_end', '2026-08-12T13:04:00.000Z'),
      punch('clock_out', '2026-08-12T17:12:00.000Z'),
    ]);
    expect(segs).toHaveLength(2);
    expect(segs[0]).toMatchObject({ durationMinutes: 241, status: 'complete' });
    expect(segs[1]).toMatchObject({ durationMinutes: 248, status: 'complete' });
    // 4h01 + 4h08 = 8h09 — o intervalo NÃO entra.
    expect(observedMinutes(segs)).toBe(489);
  });

  it('entrada sem saída fica INCOMPLETA e sem duração — nunca 8 h presumidas', () => {
    const segs = reconstruct([punch('clock_in', '2026-08-13T12:41:00.000Z')]);
    expect(segs).toHaveLength(1);
    expect(segs[0].status).toBe('incomplete');
    expect(segs[0].durationMinutes).toBeNull();
    expect(segs[0].incompleteReason).toBe('missing_clock_out');
    expect(observedMinutes(segs)).toBe(0);
  });

  it('início de intervalo fecha o trabalho anterior, mesmo sem saída depois', () => {
    // Caso real do banco: clock_in 09:49, break_start 14:42, nada depois.
    // O trabalho ATÉ o intervalo é observável; o que viria depois, não.
    const segs = reconstruct([
      punch('clock_in', '2026-07-29T09:49:00.000Z'),
      punch('break_start', '2026-07-29T14:42:00.000Z'),
    ]);
    expect(segs).toHaveLength(1);
    expect(segs[0].durationMinutes).toBe(293);
    expect(segs[0].status).toBe('complete');
  });

  it('batida cancelada é ignorada por completo', () => {
    const segs = reconstruct([
      punch('clock_in', '2026-08-18T12:35:00.000Z', { status: 'cancelled' }),
    ]);
    expect(segs).toHaveLength(0);
  });

  it('segmento de duração zero (entrada e intervalo no mesmo minuto) é descartado', () => {
    // Caso real: clock_in 15:32 e break_start 15:32.
    const segs = reconstruct([
      punch('clock_in', '2026-07-17T15:32:00.000Z'),
      punch('break_start', '2026-07-17T15:32:00.000Z'),
      punch('break_end', '2026-07-17T15:58:00.000Z'),
    ]);
    // Só sobra o segmento aberto pelo break_end, que nunca fecha.
    expect(segs).toHaveLength(1);
    expect(segs[0].status).toBe('incomplete');
  });

  it('batidas duplicadas por reenvio não geram segmento extra', () => {
    const segs = reconstruct([
      punch('clock_in', '2026-08-12T08:00:00.000Z', { id: 'a' }),
      punch('clock_in', '2026-08-12T08:00:00.500Z', { id: 'b' }),
      punch('clock_out', '2026-08-12T12:00:00.000Z'),
    ]);
    expect(segs).toHaveLength(1);
    expect(segs[0].durationMinutes).toBe(240);
  });

  it('duas entradas legítimas separadas ⇒ a primeira fica incompleta', () => {
    const segs = reconstruct([
      punch('clock_in', '2026-08-12T08:00:00.000Z'),
      punch('clock_in', '2026-08-12T13:00:00.000Z'),
      punch('clock_out', '2026-08-12T17:00:00.000Z'),
    ]);
    expect(segs).toHaveLength(2);
    expect(segs[0].status).toBe('incomplete');
    expect(segs[1]).toMatchObject({ status: 'complete', durationMinutes: 240 });
  });

  it('saída órfã não vira sessão — não há como saber quando começou', () => {
    expect(reconstruct([punch('clock_out', '2026-08-12T17:00:00.000Z')])).toHaveLength(0);
  });

  it('dias diferentes produzem segmentos com workDate próprio', () => {
    const segs = reconstruct([
      punch('clock_in', '2026-08-10T12:00:00.000Z'),
      punch('clock_out', '2026-08-10T15:00:00.000Z'),
      punch('clock_in', '2026-08-11T12:00:00.000Z'),
      punch('clock_out', '2026-08-11T15:00:00.000Z'),
    ]);
    expect(segs).toHaveLength(2);
    expect(new Set(segs.map((s) => s.workDate)).size).toBe(2);
  });

  it('evidência de OUTRA pessoa não entra na reconstrução', () => {
    const outra = fromAttendancePunch({
      id: 'x', personId: 'person-outro', type: 'clock_in',
      occurredAt: '2026-08-12T08:00:00.000Z', status: 'accepted', location: null,
    });
    expect(reconstruct([outra])).toHaveLength(0);
  });

  it('cada segmento carrega os ids das evidências que o sustentam', () => {
    const segs = reconstruct([
      punch('clock_in', '2026-08-12T08:00:00.000Z', { id: 'in-1' }),
      punch('clock_out', '2026-08-12T12:00:00.000Z', { id: 'out-1' }),
    ]);
    expect(segs[0].evidenceIds).toEqual(['attendance_punch:in-1', 'attendance_punch:out-1']);
  });

  it('a ordem de entrada não altera o resultado (evidência chega fora de ordem)', () => {
    const ordenado = reconstruct([
      punch('clock_in', '2026-08-12T08:00:00.000Z'),
      punch('clock_out', '2026-08-12T12:00:00.000Z'),
    ]);
    const invertido = reconstruct([
      punch('clock_out', '2026-08-12T12:00:00.000Z'),
      punch('clock_in', '2026-08-12T08:00:00.000Z'),
    ]);
    expect(invertido).toEqual(ordenado);
  });
});

describe('idempotência', () => {
  it('a mesma sessão produz sempre a mesma chave', () => {
    const key = () => automationKeyFor({
      personId: PERSON, startedAt: '2026-08-12T08:00:00.000Z',
      endedAt: '2026-08-12T12:00:00.000Z', timelineItemId: 'item-1',
    });
    expect(key()).toBe(key());
  });

  it('sessões diferentes produzem chaves diferentes', () => {
    const a = automationKeyFor({ personId: PERSON, startedAt: '2026-08-12T08:00:00.000Z', endedAt: '2026-08-12T12:00:00.000Z', timelineItemId: 'item-1' });
    const b = automationKeyFor({ personId: PERSON, startedAt: '2026-08-12T13:00:00.000Z', endedAt: '2026-08-12T17:00:00.000Z', timelineItemId: 'item-1' });
    const c = automationKeyFor({ personId: PERSON, startedAt: '2026-08-12T08:00:00.000Z', endedAt: '2026-08-12T12:00:00.000Z', timelineItemId: 'item-2' });
    expect(new Set([a, b, c]).size).toBe(3);
  });

  it('sessão aberta tem chave estável e distinta da fechada', () => {
    const aberta = automationKeyFor({ personId: PERSON, startedAt: '2026-08-12T08:00:00.000Z', endedAt: null, timelineItemId: 'item-1' });
    expect(aberta).toContain('open');
    expect(aberta).not.toBe(
      automationKeyFor({ personId: PERSON, startedAt: '2026-08-12T08:00:00.000Z', endedAt: '2026-08-12T12:00:00.000Z', timelineItemId: 'item-1' }),
    );
  });
});

/* ─────────────────── P3B-5 — métricas de autonomia ─────────────────── */

describe('métricas de autonomia de execução', () => {
  const verdict = (decision: 'AUTO_APPLY' | 'PROPOSE' | 'REQUIRE_HUMAN' | 'REJECT') =>
    ({ decision, reasons: [], confidence: null }) as PolicyVerdict;

  const session = (over: Partial<ApexSessionSummary> = {}): ApexSessionSummary => ({
    id: 's', verificationStatus: 'verified', correctedAt: null, durationMinutes: 240, ...over,
  });

  it('sem nada resolvível, a taxa é null — não 0%', () => {
    const m = computeExecutionAutonomy({ verdicts: [], sessions: [] });
    expect(m).toEqual(EMPTY_EXECUTION_AUTONOMY);
    expect(m.executionAutonomyRate).toBeNull();
    expect(m.correctionRate).toBeNull();
  });

  it('rejeitados NÃO entram no denominador — recusar o irresolvível é acerto', () => {
    const m = computeExecutionAutonomy({
      verdicts: [verdict('AUTO_APPLY'), verdict('REQUIRE_HUMAN'), verdict('REJECT'), verdict('REJECT')],
      sessions: [],
    });
    // 1 de 2 resolvíveis, e não 1 de 4.
    expect(m.executionAutonomyRate).toBe(0.5);
    expect(m.rejected).toBe(2);
  });

  it('separa sessões verificadas, com falha e corrigidas', () => {
    const m = computeExecutionAutonomy({
      verdicts: [verdict('AUTO_APPLY')],
      sessions: [
        session({ id: 'a' }),
        session({ id: 'b', verificationStatus: 'failed', durationMinutes: 100 }),
        session({ id: 'c', correctedAt: '2026-08-12T10:00:00Z' }),
      ],
    });
    expect(m.sessionsReconstructed).toBe(1);
    expect(m.sessionsNeedingReview).toBe(1);
    expect(m.sessionsCorrected).toBe(1);
    // Minutos observados só de sessões verificadas.
    expect(m.observedMinutes).toBe(480);
    expect(m.correctionRate).toBeCloseTo(1 / 3, 3);
  });

  it('sessão corrigida não conta como reconstruída com sucesso', () => {
    const m = computeExecutionAutonomy({
      verdicts: [],
      sessions: [session({ correctedAt: '2026-08-12T10:00:00Z' })],
    });
    expect(m.sessionsReconstructed).toBe(0);
    expect(m.correctionRate).toBe(1);
  });
});

/* ────────── P3B-2 — candidatos a escrita (orquestração pura) ────────── */

describe('candidatos a sessão', () => {
  const item = (id: string) => ({
    id, projectId: 'proj-1', parentId: null, wbsCode: null, title: id,
    status: 'in_progress', isSummary: false, isMilestone: false, isActive: true,
    deletedAt: null, percentComplete: 0, plannedStart: '2026-08-01',
    plannedFinish: '2026-08-31', actualStart: null, actualFinish: null,
    forecastFinish: null, durationMinutes: null, responsibleUserId: null, assignments: [],
  }) as unknown as import('@/lib/types/project-timeline').TimelineItem;

  const build = (evidence: ExecutionEvidence[], matches: EvidenceMatch[]) =>
    buildSessionCandidates({ projectId: 'proj-1', items: [item('a'), item('b')], evidence, matches });

  it('segmento cujas evidências concordam vira candidato AUTO_APPLY', () => {
    const ev = [
      punch('clock_in', '2026-08-12T08:00:00.000Z', { id: 'in' }),
      punch('clock_out', '2026-08-12T12:00:00.000Z', { id: 'out' }),
    ];
    const matches = ev.map((e) => match({ evidenceId: e.id, timelineItemId: 'a' }));
    const cands = build(ev, matches);
    expect(cands).toHaveLength(1);
    expect(cands[0].verdict.decision).toBe('AUTO_APPLY');
    expect(cands[0].match.timelineItemId).toBe('a');
    expect(autoApplicable(cands)).toHaveLength(1);
  });

  it('troca de atividade no meio do turno ⇒ AMBÍGUO, nada é escrito', () => {
    const ev = [
      punch('clock_in', '2026-08-12T08:00:00.000Z', { id: 'in' }),
      punch('clock_out', '2026-08-12T12:00:00.000Z', { id: 'out' }),
    ];
    // As duas evidências do MESMO segmento apontam para etapas diferentes.
    const matches = [
      match({ evidenceId: ev[0].id, timelineItemId: 'a' }),
      match({ evidenceId: ev[1].id, timelineItemId: 'b' }),
    ];
    const cands = build(ev, matches);
    expect(cands[0].match.status).toBe('AMBIGUOUS');
    expect(cands[0].verdict.decision).toBe('REQUIRE_HUMAN');
    expect(autoApplicable(cands)).toHaveLength(0);
  });

  it('segmento incompleto nunca é aplicável, mesmo com etapa resolvida', () => {
    const ev = [punch('clock_in', '2026-08-12T08:00:00.000Z', { id: 'in' })];
    const cands = build(ev, [match({ evidenceId: ev[0].id, timelineItemId: 'a' })]);
    expect(cands[0].segment.status).toBe('incomplete');
    expect(autoApplicable(cands)).toHaveLength(0);
  });

  it('evidência sem casamento ⇒ candidato UNMATCHED e REJECT', () => {
    const ev = [
      punch('clock_in', '2026-08-12T08:00:00.000Z', { id: 'in' }),
      punch('clock_out', '2026-08-12T12:00:00.000Z', { id: 'out' }),
    ];
    const cands = build(ev, []);
    expect(cands[0].match.status).toBe('UNMATCHED');
    expect(cands[0].verdict.decision).toBe('REJECT');
  });

  it('reprocessar a mesma evidência produz os MESMOS candidatos (replay idempotente)', () => {
    const ev = [
      punch('clock_in', '2026-08-12T08:00:00.000Z', { id: 'in' }),
      punch('clock_out', '2026-08-12T12:00:00.000Z', { id: 'out' }),
    ];
    const matches = ev.map((e) => match({ evidenceId: e.id, timelineItemId: 'a' }));
    const a = build(ev, matches);
    const b = build(ev, matches);
    expect(b).toEqual(a);
    expect(
      automationKeyFor({
        personId: a[0].segment.personId, startedAt: a[0].segment.startedAt,
        endedAt: a[0].segment.endedAt, timelineItemId: a[0].match.timelineItemId,
      }),
    ).toBe(
      automationKeyFor({
        personId: b[0].segment.personId, startedAt: b[0].segment.startedAt,
        endedAt: b[0].segment.endedAt, timelineItemId: b[0].match.timelineItemId,
      }),
    );
  });
});
