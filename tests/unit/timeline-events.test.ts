/**
 * Feed de eventos derivado do cronograma.
 *
 * O ponto sensível é a ORDENAÇÃO ESTÁVEL: lançamentos do mesmo dia são todos
 * ancorados ao meio-dia, então empates são a regra, não a exceção. Sem
 * desempate determinístico a lista embaralharia a cada render.
 */

import { describe, it, expect } from 'vitest';
import { composeTimelineEvents, formatEventTime, type TimelineEvent } from '@/lib/projects/timeline-events';
import type { ProjectWorkSession, TimeEntry } from '@/lib/types/people';
import type { DelayLog, TimelineComment } from '@/lib/types/project-timeline';
import { FIXED_NOW, makeItem } from './fixtures/timeline-fixtures';

const ITEMS = () => [makeItem({ id: 'a', title: 'Montagem' }), makeItem({ id: 'b', title: 'Testes' })];

function entry(over: Partial<TimeEntry> & { id: string; minutes: number }): TimeEntry {
  return {
    organizationId: 'org-1', personId: 'p1', projectId: 'proj-1', allocationId: null,
    timelineItemId: 'a', workDate: '2026-08-12', description: null, sourceSessionId: null,
    status: 'approved', exceptionFlags: [], autoApproved: true, submittedAt: null,
    approvedBy: null, approvedAt: null, rejectionReason: null, hourlyCostCents: null,
    costCents: null, createdAt: '2026-08-12', updatedAt: '2026-08-12', ...over,
  };
}

function session(over: Partial<ProjectWorkSession> & { id: string }): ProjectWorkSession {
  return {
    organizationId: 'org-1', personId: 'p1', projectId: 'proj-1', allocationId: null,
    timelineItemId: 'a', startedAt: '2026-08-12T09:00:00.000Z', endedAt: null,
    durationMinutes: null, description: null, source: 'web_timer', status: 'running',
    timeEntryId: null, createdAt: '2026-08-12', updatedAt: '2026-08-12', ...over,
  };
}

function delayLog(over: Partial<DelayLog> & { id: string }): DelayLog {
  return {
    organizationId: 'org-1', projectId: 'proj-1', timelineItemId: 'a', reportedBy: null,
    oldStatus: 'in_progress', newStatus: 'delayed', reasonCategory: 'material_delay',
    reasonText: null, impactText: null, recoveryPlanText: null, supportNeededText: null,
    contractImpact: false, oldForecastFinish: null, newForecastFinish: null,
    createdAt: new Date('2026-08-11T10:00:00.000Z'), ...over,
  };
}

function comment(over: Partial<TimelineComment> & { id: string; body: string }): TimelineComment {
  return {
    organizationId: 'org-1', projectId: 'proj-1', timelineItemId: 'a', authorUserId: 'u1',
    createdAt: new Date('2026-08-10T10:00:00.000Z'), ...over,
  };
}

const compose = (over: Partial<Parameters<typeof composeTimelineEvents>[0]> = {}) =>
  composeTimelineEvents({ items: ITEMS(), ...over });

describe('composição a partir das fontes', () => {
  it('sessão rodando vira "trabalho em andamento", não "pausado"', () => {
    const events = compose({ sessions: [session({ id: 's1', status: 'running' })] });
    expect(events.map((e) => e.type)).toEqual(['work_in_progress']);
    expect(events[0].tone).toBe('live');
  });

  it('sessão encerrada vira "pausado" com a duração no detalhe', () => {
    const events = compose({
      sessions: [session({ id: 's1', status: 'consolidated', endedAt: '2026-08-12T11:30:00.000Z', durationMinutes: 150 })],
    });
    expect(events[0].type).toBe('work_paused');
    expect(events[0].detail).toContain('2,5 h');
  });

  it('sessão descartada não gera evento', () => {
    expect(compose({ sessions: [session({ id: 's1', status: 'discarded' })] })).toHaveLength(0);
  });

  it('lançamento gera "horas apontadas" com precisão de DIA ancorada ao meio-dia', () => {
    const events = compose({ entries: [entry({ id: 'e1', minutes: 90, workDate: '2026-08-10' })] });
    expect(events[0].type).toBe('hours_logged');
    expect(events[0].at).toBe('2026-08-10T12:00:00');
    expect(events[0].precision).toBe('day');
    expect(events[0].title).toBe('1,5 h apontadas');
  });

  it('lançamento aprovado gera evento ADICIONAL de aprovação', () => {
    const events = compose({
      entries: [entry({ id: 'e1', minutes: 60, approvedAt: '2026-08-13T08:00:00.000Z' })],
    });
    expect(events.map((e) => e.type).sort()).toEqual(['hours_approved', 'hours_logged']);
  });

  it('lançamento rejeitado é ignorado por completo', () => {
    expect(compose({ entries: [entry({ id: 'e1', minutes: 60, status: 'rejected' })] })).toHaveLength(0);
  });

  it('lançamento sem etapa escolhida não entra no feed da atividade', () => {
    expect(compose({ entries: [entry({ id: 'e1', minutes: 60, timelineItemId: null })] })).toHaveLength(0);
  });

  it('atraso vira evento com a categoria traduzida', () => {
    const events = compose({ delayLogs: [delayLog({ id: 'l1', reasonText: 'Chegou tarde' })] });
    expect(events[0].type).toBe('delay_reported');
    expect(events[0].detail).toBe('Atraso de material — Chegou tarde');
    expect(events[0].tone).toBe('danger');
  });

  it('bloqueio recebe título próprio', () => {
    const events = compose({ delayLogs: [delayLog({ id: 'l1', newStatus: 'blocked' })] });
    expect(events[0].title).toBe('Bloqueio reportado');
  });

  it('mudança de previsão gera evento separado com o antes → depois', () => {
    const events = compose({
      delayLogs: [delayLog({ id: 'l1', oldForecastFinish: '2026-08-20', newForecastFinish: '2026-09-01' })],
    });
    const forecast = events.find((e) => e.type === 'forecast_changed')!;
    expect(forecast.detail).toBe('20/08/2026 → 01/09/2026');
  });

  it('previsão inalterada NÃO gera evento de mudança', () => {
    const events = compose({
      delayLogs: [delayLog({ id: 'l1', oldForecastFinish: '2026-08-20', newForecastFinish: '2026-08-20' })],
    });
    expect(events.some((e) => e.type === 'forecast_changed')).toBe(false);
  });

  it('término real de marco vira "marco atingido"; de tarefa, "execução concluída"', () => {
    const items = [
      makeItem({ id: 'a', isMilestone: true, actualFinish: '2026-08-10' }),
      makeItem({ id: 'b', actualFinish: '2026-08-11' }),
    ];
    const types = composeTimelineEvents({ items }).map((e) => e.type);
    expect(types).toContain('milestone_reached');
    expect(types).toContain('work_completed');
  });

  it('início real vira evento; ausência de data real não gera nada', () => {
    const semData = composeTimelineEvents({ items: [makeItem({ id: 'a' })] });
    expect(semData).toHaveLength(0);
    const comData = composeTimelineEvents({ items: [makeItem({ id: 'a', actualStart: '2026-08-05' })] });
    expect(comData.map((e) => e.type)).toEqual(['item_started']);
  });

  it('evento cuja etapa não existe mais é descartado', () => {
    const events = compose({ entries: [entry({ id: 'e1', minutes: 60, timelineItemId: 'sumiu' })] });
    expect(events).toHaveLength(0);
  });

  it('comentário entra no feed', () => {
    const events = compose({ comments: [comment({ id: 'c1', body: 'Revisar', authorName: 'Ana' })] });
    expect(events[0]).toMatchObject({ type: 'comment_added', detail: 'Revisar', actorName: 'Ana' });
  });
});

describe('ordenação e limite', () => {
  it('ordena do mais recente para o mais antigo', () => {
    const events = compose({
      entries: [
        entry({ id: 'e1', minutes: 60, workDate: '2026-08-01' }),
        entry({ id: 'e2', minutes: 60, workDate: '2026-08-12' }),
        entry({ id: 'e3', minutes: 60, workDate: '2026-08-07' }),
      ],
    });
    expect(events.map((e) => e.at.slice(0, 10))).toEqual(['2026-08-12', '2026-08-07', '2026-08-01']);
  });

  it('empate no mesmo instante é resolvido por prioridade de tipo, não por acaso', () => {
    const events = compose({
      entries: [entry({ id: 'e1', minutes: 60, workDate: '2026-08-10' })],
      items: [makeItem({ id: 'a', actualStart: '2026-08-10' })],
    });
    // Ambos às 12:00 do dia 10. item_started (5) precede hours_logged (7).
    expect(events.map((e) => e.type)).toEqual(['item_started', 'hours_logged']);
  });

  it('é determinístico: a mesma entrada produz exatamente a mesma ordem', () => {
    const input = {
      items: ITEMS(),
      entries: [
        entry({ id: 'e1', minutes: 60, workDate: '2026-08-10' }),
        entry({ id: 'e2', minutes: 30, workDate: '2026-08-10' }),
        entry({ id: 'e3', minutes: 45, workDate: '2026-08-10' }),
      ],
    };
    const ids = () => composeTimelineEvents(input).map((e) => e.id);
    expect(ids()).toEqual(ids());
    expect(ids()).toEqual(['hours_logged:e1', 'hours_logged:e2', 'hours_logged:e3']);
  });

  it('o limite é aplicado DEPOIS da ordenação (fica com os mais recentes)', () => {
    const entries = Array.from({ length: 10 }, (_, i) =>
      entry({ id: `e${i}`, minutes: 60, workDate: `2026-08-${String(i + 1).padStart(2, '0')}` }),
    );
    const events = compose({ entries, limit: 3 });
    expect(events.map((e) => e.at.slice(0, 10))).toEqual(['2026-08-10', '2026-08-09', '2026-08-08']);
  });

  it('itemId restringe o feed a uma única atividade', () => {
    const entries = [
      entry({ id: 'e1', minutes: 60, timelineItemId: 'a' }),
      entry({ id: 'e2', minutes: 60, timelineItemId: 'b' }),
    ];
    const events = compose({ entries, itemId: 'b' });
    expect(events).toHaveLength(1);
    expect(events[0].itemId).toBe('b');
  });

  it('ids são estáveis e prefixados pelo tipo', () => {
    const events = compose({ entries: [entry({ id: 'e1', minutes: 60, approvedAt: '2026-08-13T08:00:00.000Z' })] });
    expect(events.map((e) => e.id).sort()).toEqual(['hours_approved:e1', 'hours_logged:e1']);
  });
});

describe('formatEventTime', () => {
  const ev = (over: Partial<TimelineEvent>): TimelineEvent =>
    ({
      id: 'x', type: 'hours_logged', at: FIXED_NOW.toISOString(), itemId: 'a', itemTitle: 'A',
      actorName: null, actorAvatarUrl: null, title: '', detail: null, tone: 'info',
      precision: 'timestamp', ...over,
    }) as TimelineEvent;

  it('precisão de dia sempre mostra a data, nunca "há X min"', () => {
    expect(formatEventTime(ev({ at: '2026-08-12T12:00:00', precision: 'day' }), FIXED_NOW)).toBe('12/08/2026');
  });

  it('usa relativo para timestamps recentes', () => {
    const min30 = new Date(FIXED_NOW.getTime() - 30 * 60000).toISOString();
    expect(formatEventTime(ev({ at: min30 }), FIXED_NOW)).toBe('há 30 min');
    const h3 = new Date(FIXED_NOW.getTime() - 3 * 3600000).toISOString();
    expect(formatEventTime(ev({ at: h3 }), FIXED_NOW)).toBe('há 3 h');
  });

  it('"agora" para menos de um minuto', () => {
    expect(formatEventTime(ev({ at: FIXED_NOW.toISOString() }), FIXED_NOW)).toBe('agora');
  });

  it('cai para data absoluta a partir de uma semana', () => {
    const d10 = new Date(FIXED_NOW.getTime() - 10 * 86400000).toISOString();
    expect(formatEventTime(ev({ at: d10 }), FIXED_NOW)).toBe('02/08/2026');
  });
});
