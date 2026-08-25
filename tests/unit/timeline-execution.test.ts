/**
 * Read-model de execução — planejado × apontado por atividade do cronograma.
 *
 * O foco destes testes é a DISCIPLINA DE AUSÊNCIA: distinguir "desconhecido"
 * (null, sem fonte ou sem permissão) de "observado como zero". É a regra que
 * separa um indicador honesto de um número inventado.
 */

import { describe, it, expect } from 'vitest';
import {
  buildPersonUserLinks,
  buildProjectExecution,
  rollupExecution,
  formatHours,
  formatVariance,
  type PersonUserLink,
} from '@/lib/projects/timeline-execution';
import { buildTree } from '@/lib/projects/timeline-analytics';
import type { Person, ProjectWorkSession, TimeEntry } from '@/lib/types/people';
import type { OrgMember } from '@/lib/types/agenda';
import { FIXED_NOW, makeItem } from './fixtures/timeline-fixtures';

const TODAY = '2026-08-12';

function person(over: Partial<Person> & { id: string; fullName: string }): Person {
  return {
    organizationId: 'org-1', profileId: null, payrollNameKey: null, cpf: null,
    email: null, jobTitle: null, department: null, contractType: 'clt',
    weeklyHours: 40, costCenterId: null, managerPersonId: null, status: 'active',
    source: 'manual', hiredAt: null, terminatedAt: null, notes: null,
    createdAt: '2026-01-01', updatedAt: '2026-01-01', ...over,
  };
}

function member(over: Partial<OrgMember> & { userId: string }): OrgMember {
  return { fullName: null, jobTitle: null, avatarUrl: null, email: null, ...over };
}

function entry(over: Partial<TimeEntry> & { id: string; personId: string; minutes: number }): TimeEntry {
  return {
    organizationId: 'org-1', projectId: 'proj-1', allocationId: null, timelineItemId: null,
    workDate: TODAY, description: null, sourceSessionId: null, status: 'approved',
    exceptionFlags: [], autoApproved: true, submittedAt: null, approvedBy: null,
    approvedAt: null, rejectionReason: null, hourlyCostCents: null, costCents: null,
    createdAt: '2026-08-12', updatedAt: '2026-08-12', ...over,
  };
}

function session(over: Partial<ProjectWorkSession> & { id: string; personId: string }): ProjectWorkSession {
  return {
    organizationId: 'org-1', projectId: 'proj-1', allocationId: null, timelineItemId: null,
    startedAt: '2026-08-12T09:00:00.000Z', endedAt: null, durationMinutes: null,
    description: null, source: 'web_timer', status: 'running', timeEntryId: null,
    createdAt: '2026-08-12', updatedAt: '2026-08-12', ...over,
  };
}

const NO_LINKS: PersonUserLink[] = [];

const build = (over: Partial<Parameters<typeof buildProjectExecution>[0]> = {}) =>
  buildProjectExecution({
    items: [], entries: [], sessions: [], links: NO_LINKS,
    now: FIXED_NOW, availability: 'available', ...over,
  });

describe('disciplina de ausência', () => {
  it('plannedHours é null (não 0) quando durationMinutes é null', () => {
    const item = makeItem({ id: 'a', durationMinutes: null });
    const exec = build({ items: [item] }).byItem.get('a')!;
    expect(exec.plannedHours).toBeNull();
    // Guarda contra "|| 0" acidental: null é falsy, então a asserção precisa ser estrita.
    expect(exec.plannedHours).not.toBe(0);
  });

  it('variance e variancePct são null sempre que plannedHours é null', () => {
    const item = makeItem({ id: 'a', durationMinutes: null });
    const exec = build({ items: [item], entries: [entry({ id: 'e', personId: 'p1', minutes: 120, timelineItemId: 'a' })] })
      .byItem.get('a')!;
    expect(exec.loggedHours).toBe(2);
    expect(exec.variance).toBeNull();
    expect(exec.variancePct).toBeNull();
  });

  it('sem permissão ⇒ modelo VAZIO com totais null, nunca zeros', () => {
    const model = build({ items: [makeItem({ id: 'a' })], availability: 'unauthorized' });
    expect(model.availability).toBe('unauthorized');
    expect(model.byItem.size).toBe(0);
    expect(model.unlinkedHours).toBeNull();
    expect(model.totals.loggedHours).toBeNull();
    expect(model.totals.activeNowCount).toBeNull();
    expect(model.totals.noApontamentoCount).toBeNull();
    expect(model.totals.hoursWithoutProgressCount).toBeNull();
  });

  it('com permissão e sem lançamentos ⇒ 0 observado + hasNoApontamento', () => {
    const item = makeItem({ id: 'a', durationMinutes: 480 });
    const exec = build({ items: [item] }).byItem.get('a')!;
    expect(exec.loggedHours).toBe(0); // observado, não desconhecido
    expect(exec.plannedHours).toBe(8);
    expect(exec.variance).toBe(-8);
    expect(exec.hasNoApontamento).toBe(true);
  });
});

describe('agregação de lançamentos', () => {
  const item = () => makeItem({ id: 'a', durationMinutes: 600 }); // 10h planejadas

  it('separa aprovado (+locked) / pendente / rascunho', () => {
    const entries = [
      entry({ id: '1', personId: 'p1', minutes: 60, timelineItemId: 'a', status: 'approved' }),
      entry({ id: '2', personId: 'p1', minutes: 120, timelineItemId: 'a', status: 'locked' }),
      entry({ id: '3', personId: 'p1', minutes: 30, timelineItemId: 'a', status: 'submitted' }),
      entry({ id: '4', personId: 'p1', minutes: 90, timelineItemId: 'a', status: 'draft' }),
    ];
    const exec = build({ items: [item()], entries }).byItem.get('a')!;
    expect(exec.approvedHours).toBe(3);
    expect(exec.pendingHours).toBe(0.5);
    expect(exec.draftHours).toBe(1.5);
    expect(exec.loggedHours).toBe(5);
    expect(exec.entriesCount).toBe(4);
  });

  it('ignora lançamentos rejeitados por completo', () => {
    const entries = [entry({ id: '1', personId: 'p1', minutes: 480, timelineItemId: 'a', status: 'rejected' })];
    const exec = build({ items: [item()], entries }).byItem.get('a')!;
    expect(exec.loggedHours).toBe(0);
    expect(exec.entriesCount).toBe(0);
    expect(exec.hasNoApontamento).toBe(true);
  });

  it('horas sem etapa escolhida vão para unlinkedHours e para NENHUM item', () => {
    const entries = [entry({ id: '1', personId: 'p1', minutes: 300, timelineItemId: null })];
    const model = build({ items: [item()], entries });
    expect(model.unlinkedHours).toBe(5);
    expect(model.byItem.get('a')!.loggedHours).toBe(0);
  });

  it('lançamento apontando para item inexistente não cria linha fantasma', () => {
    // Caso real: o import desativou a etapa (is_active=false) e ela sumiu da lista.
    const entries = [entry({ id: '1', personId: 'p1', minutes: 300, timelineItemId: 'sumiu' })];
    const model = build({ items: [item()], entries });
    expect(model.byItem.size).toBe(1);
    expect(model.byItem.has('sumiu')).toBe(false);
    expect(model.unlinkedHours).toBe(0);
  });

  it('calcula variância positiva quando estoura o planejado', () => {
    const entries = [entry({ id: '1', personId: 'p1', minutes: 900, timelineItemId: 'a' })];
    const exec = build({ items: [item()], entries }).byItem.get('a')!;
    expect(exec.loggedHours).toBe(15);
    expect(exec.variance).toBe(5);
    expect(exec.variancePct).toBe(0.5);
  });

  it('hoursWithoutProgress só quando há horas E o progresso é 0', () => {
    const semProgresso = makeItem({ id: 'a', durationMinutes: 600, percentComplete: 0 });
    const comProgresso = makeItem({ id: 'b', durationMinutes: 600, percentComplete: 10 });
    const entries = [
      entry({ id: '1', personId: 'p1', minutes: 60, timelineItemId: 'a' }),
      entry({ id: '2', personId: 'p1', minutes: 60, timelineItemId: 'b' }),
    ];
    const model = build({ items: [semProgresso, comProgresso], entries });
    expect(model.byItem.get('a')!.hoursWithoutProgress).toBe(true);
    expect(model.byItem.get('b')!.hoursWithoutProgress).toBe(false);
  });
});

describe('sinais de atividade', () => {
  it('isActiveNow apenas para sessão em "running"', () => {
    const items = [makeItem({ id: 'a' }), makeItem({ id: 'b' })];
    const sessions = [
      session({ id: 's1', personId: 'p1', timelineItemId: 'a', status: 'running' }),
      session({ id: 's2', personId: 'p1', timelineItemId: 'b', status: 'consolidated', endedAt: '2026-08-12T10:00:00.000Z' }),
    ];
    const model = build({ items, sessions });
    expect(model.byItem.get('a')!.isActiveNow).toBe(true);
    expect(model.byItem.get('b')!.isActiveNow).toBe(false);
  });

  it('sessão rodando conta como apontamento (não fica "sem apontamento")', () => {
    const items = [makeItem({ id: 'a' })];
    const sessions = [session({ id: 's1', personId: 'p1', timelineItemId: 'a' })];
    expect(build({ items, sessions }).byItem.get('a')!.hasNoApontamento).toBe(false);
  });

  it('workedToday usa a data LOCAL do lançamento', () => {
    const items = [makeItem({ id: 'a' }), makeItem({ id: 'b' })];
    const entries = [
      entry({ id: '1', personId: 'p1', minutes: 60, timelineItemId: 'a', workDate: TODAY }),
      entry({ id: '2', personId: 'p1', minutes: 60, timelineItemId: 'b', workDate: '2026-08-11' }),
    ];
    const model = build({ items, entries });
    expect(model.byItem.get('a')!.workedToday).toBe(true);
    expect(model.byItem.get('b')!.workedToday).toBe(false);
  });

  it('lastActivityAt ancora lançamentos ao meio-dia e prefere o mais recente', () => {
    const items = [makeItem({ id: 'a' })];
    const entries = [entry({ id: '1', personId: 'p1', minutes: 60, timelineItemId: 'a', workDate: '2026-08-10' })];
    expect(build({ items, entries }).byItem.get('a')!.lastActivityAt).toBe('2026-08-10T12:00:00');
  });

  it('sessão descartada é ignorada', () => {
    const items = [makeItem({ id: 'a' })];
    const sessions = [session({ id: 's1', personId: 'p1', timelineItemId: 'a', status: 'discarded' })];
    expect(build({ items, sessions }).byItem.get('a')!.isActiveNow).toBe(false);
  });
});

describe('colaboradores', () => {
  it('acumula minutos por pessoa e ordena por volume', () => {
    const items = [makeItem({ id: 'a' })];
    const entries = [
      entry({ id: '1', personId: 'p1', minutes: 60, timelineItemId: 'a', person: person({ id: 'p1', fullName: 'Ana' }) }),
      entry({ id: '2', personId: 'p2', minutes: 180, timelineItemId: 'a', person: person({ id: 'p2', fullName: 'Bruno' }) }),
      entry({ id: '3', personId: 'p1', minutes: 30, timelineItemId: 'a', person: person({ id: 'p1', fullName: 'Ana' }) }),
    ];
    const collabs = build({ items, entries }).byItem.get('a')!.collaborators;
    expect(collabs.map((c) => [c.name, c.minutes])).toEqual([['Bruno', 180], ['Ana', 90]]);
  });

  it('marca isAssigned=false para quem apontou sem estar na equipe', () => {
    const items = [makeItem({ id: 'a', responsibleUserId: 'u-ana' })];
    const links: PersonUserLink[] = [
      { personId: 'p1', userId: 'u-ana', fullName: 'Ana', avatarUrl: null },
      { personId: 'p2', userId: 'u-bruno', fullName: 'Bruno', avatarUrl: null },
    ];
    const entries = [
      entry({ id: '1', personId: 'p1', minutes: 60, timelineItemId: 'a' }),
      entry({ id: '2', personId: 'p2', minutes: 60, timelineItemId: 'a' }),
    ];
    const byPerson = new Map(build({ items, entries, links }).byItem.get('a')!.collaborators.map((c) => [c.personId, c]));
    expect(byPerson.get('p1')!.isAssigned).toBe(true);
    expect(byPerson.get('p2')!.isAssigned).toBe(false);
  });
});

describe('buildPersonUserLinks', () => {
  it('liga por e-mail, ignorando caixa e espaços', () => {
    const links = buildPersonUserLinks(
      [person({ id: 'p1', fullName: 'Ana Silva', email: '  ANA@x.com ' })],
      [member({ userId: 'u1', email: 'ana@x.com', fullName: 'Ana Silva' })],
    );
    expect(links[0].userId).toBe('u1');
  });

  it('cai para nome normalizado (sem acento) quando não há e-mail', () => {
    const links = buildPersonUserLinks(
      [person({ id: 'p1', fullName: 'João Conceição' })],
      [member({ userId: 'u1', fullName: 'Joao  CONCEICAO' })],
    );
    expect(links[0].userId).toBe('u1');
  });

  it('nome ambíguo do lado dos membros ⇒ userId null, nunca adivinha', () => {
    const links = buildPersonUserLinks(
      [person({ id: 'p1', fullName: 'Ana Silva' })],
      [member({ userId: 'u1', fullName: 'Ana Silva' }), member({ userId: 'u2', fullName: 'ana silva' })],
    );
    expect(links[0].userId).toBeNull();
  });

  it('nome ambíguo do lado das pessoas ⇒ userId null nas duas', () => {
    const links = buildPersonUserLinks(
      [person({ id: 'p1', fullName: 'Ana Silva' }), person({ id: 'p2', fullName: 'Ana Silva' })],
      [member({ userId: 'u1', fullName: 'Ana Silva' })],
    );
    expect(links.map((l) => l.userId)).toEqual([null, null]);
  });

  it('pessoa só-folha (sem usuário auth) fica com userId null mas preserva o nome', () => {
    const links = buildPersonUserLinks([person({ id: 'p1', fullName: 'Campo Um' })], []);
    expect(links[0]).toMatchObject({ personId: 'p1', userId: null, fullName: 'Campo Um' });
  });
});

describe('rollupExecution', () => {
  const tree = () => [
    makeItem({ id: 'f1', rowOrder: 1, isSummary: true }),
    makeItem({ id: 't1', rowOrder: 2, parentId: 'f1', durationMinutes: 480 }),
    makeItem({ id: 't2', rowOrder: 3, parentId: 'f1', durationMinutes: 120 }),
  ];

  it('a fase soma as horas da subárvore', () => {
    const items = tree();
    const entries = [
      entry({ id: '1', personId: 'p1', minutes: 60, timelineItemId: 't1' }),
      entry({ id: '2', personId: 'p2', minutes: 120, timelineItemId: 't2' }),
    ];
    const model = build({ items, entries });
    rollupExecution(buildTree(items), model.byItem);
    const fase = model.byItem.get('f1')!;
    expect(fase.loggedHours).toBe(3);
    expect(fase.plannedHours).toBe(10); // 8h + 2h
    expect(fase.variance).toBe(-7);
    expect(fase.collaborators).toHaveLength(2);
  });

  it('plannedHours da fase soma só os não-nulos', () => {
    const items = [
      makeItem({ id: 'f1', rowOrder: 1, isSummary: true }),
      makeItem({ id: 't1', rowOrder: 2, parentId: 'f1', durationMinutes: 480 }),
      makeItem({ id: 't2', rowOrder: 3, parentId: 'f1', durationMinutes: null }),
    ];
    const model = build({ items });
    rollupExecution(buildTree(items), model.byItem);
    expect(model.byItem.get('f1')!.plannedHours).toBe(8);
  });

  it('plannedHours da fase é null só quando TODOS os descendentes são null', () => {
    const items = [
      makeItem({ id: 'f1', rowOrder: 1, isSummary: true }),
      makeItem({ id: 't1', rowOrder: 2, parentId: 'f1', durationMinutes: null }),
    ];
    const model = build({ items });
    rollupExecution(buildTree(items), model.byItem);
    expect(model.byItem.get('f1')!.plannedHours).toBeNull();
    expect(model.byItem.get('f1')!.variance).toBeNull();
  });

  it('propaga isActiveNow da folha para a fase (fase recolhida ainda mostra o sinal)', () => {
    const items = tree();
    const sessions = [session({ id: 's1', personId: 'p1', timelineItemId: 't2' })];
    const model = build({ items, sessions });
    rollupExecution(buildTree(items), model.byItem);
    expect(model.byItem.get('f1')!.isActiveNow).toBe(true);
    expect(model.byItem.get('f1')!.hasNoApontamento).toBe(false);
  });

  it('totais contam SÓ folhas, sem duplicar a fase', () => {
    const items = tree();
    const entries = [entry({ id: '1', personId: 'p1', minutes: 60, timelineItemId: 't1' })];
    const model = build({ items, entries });
    rollupExecution(buildTree(items), model.byItem);
    // totals é calculado antes do rollup e ignora summary — a fase não entra duas vezes.
    expect(model.totals.loggedHours).toBe(1);
  });
});

describe('inteligência de esforço', () => {
  const planned = (h: number, over: Partial<Parameters<typeof makeItem>[0]> = {}) =>
    makeItem({ id: 'a', durationMinutes: h * 60, ...over });

  it('overPlannedEffort só quando ultrapassa o planejado', () => {
    const under = build({
      items: [planned(10)],
      entries: [entry({ id: '1', personId: 'p1', minutes: 540, timelineItemId: 'a' })],
    }).byItem.get('a')!;
    expect(under.overPlannedEffort).toBe(false);

    const over = build({
      items: [planned(10)],
      entries: [entry({ id: '1', personId: 'p1', minutes: 660, timelineItemId: 'a' })],
    }).byItem.get('a')!;
    expect(over.overPlannedEffort).toBe(true);
  });

  it('sem planejado, nunca afirma estouro de esforço', () => {
    const exec = build({
      items: [makeItem({ id: 'a', durationMinutes: null })],
      entries: [entry({ id: '1', personId: 'p1', minutes: 6000, timelineItemId: 'a' })],
    }).byItem.get('a')!;
    expect(exec.overPlannedEffort).toBe(false);
    expect(exec.variance).toBeNull();
  });

  it('projeta o esforço total pelo ritmo atual', () => {
    // 4 h gastas em 25% ⇒ projeção de 16 h; planejado 10 h ⇒ estouro de 6 h.
    const exec = build({
      items: [planned(10, { percentComplete: 25, status: 'in_progress' })],
      entries: [entry({ id: '1', personId: 'p1', minutes: 240, timelineItemId: 'a' })],
    }).byItem.get('a')!;
    expect(exec.projectedEffortHours).toBe(16);
    expect(exec.projectedOverrunHours).toBe(6);
  });

  it('sem progresso não há ritmo a extrapolar ⇒ projeção null', () => {
    const exec = build({
      items: [planned(10, { percentComplete: 0 })],
      entries: [entry({ id: '1', personId: 'p1', minutes: 240, timelineItemId: 'a' })],
    }).byItem.get('a')!;
    expect(exec.projectedEffortHours).toBeNull();
    expect(exec.projectedOverrunHours).toBeNull();
  });

  it('projeta sem planejado, mas o estouro fica null (não há contra o quê)', () => {
    const exec = build({
      items: [makeItem({ id: 'a', durationMinutes: null, percentComplete: 50, status: 'in_progress' })],
      entries: [entry({ id: '1', personId: 'p1', minutes: 120, timelineItemId: 'a' })],
    }).byItem.get('a')!;
    expect(exec.projectedEffortHours).toBe(4);
    expect(exec.projectedOverrunHours).toBeNull();
  });

  it('item concluído não recebe projeção — o esforço já é o real', () => {
    const exec = build({
      items: [planned(10, { percentComplete: 100, status: 'completed' })],
      entries: [entry({ id: '1', personId: 'p1', minutes: 240, timelineItemId: 'a' })],
    }).byItem.get('a')!;
    expect(exec.projectedEffortHours).toBeNull();
  });

  it('noRecentActivity: apontou, parou há mais de uma semana e segue aberto', () => {
    const exec = build({
      items: [makeItem({ id: 'a', status: 'in_progress' })],
      entries: [entry({ id: '1', personId: 'p1', minutes: 60, timelineItemId: 'a', workDate: '2026-07-20' })],
    }).byItem.get('a')!;
    expect(exec.noRecentActivity).toBe(true);
    expect(exec.hasNoApontamento).toBe(false);
  });

  it('atividade recente não é alerta', () => {
    const exec = build({
      items: [makeItem({ id: 'a', status: 'in_progress' })],
      entries: [entry({ id: '1', personId: 'p1', minutes: 60, timelineItemId: 'a', workDate: '2026-08-10' })],
    }).byItem.get('a')!;
    expect(exec.noRecentActivity).toBe(false);
  });

  it('quem nunca apontou é "sem apontamento", não "parado"', () => {
    const exec = build({ items: [makeItem({ id: 'a', status: 'in_progress' })] }).byItem.get('a')!;
    expect(exec.hasNoApontamento).toBe(true);
    expect(exec.noRecentActivity).toBe(false);
  });

  it('item concluído há tempos não vira alerta de parado', () => {
    const exec = build({
      items: [makeItem({ id: 'a', status: 'completed' })],
      entries: [entry({ id: '1', personId: 'p1', minutes: 60, timelineItemId: 'a', workDate: '2026-06-01' })],
    }).byItem.get('a')!;
    expect(exec.noRecentActivity).toBe(false);
  });

  it('sessão rodando agora nunca é "parado"', () => {
    const exec = build({
      items: [makeItem({ id: 'a', status: 'in_progress' })],
      entries: [entry({ id: '1', personId: 'p1', minutes: 60, timelineItemId: 'a', workDate: '2026-06-01' })],
      sessions: [session({ id: 's', personId: 'p1', timelineItemId: 'a' })],
    }).byItem.get('a')!;
    expect(exec.noRecentActivity).toBe(false);
  });
});

describe('totais e cobertura do projeto', () => {
  it('horas planejadas totais são null quando NENHUMA folha tem duração', () => {
    const model = build({ items: [makeItem({ id: 'a' }), makeItem({ id: 'b', rowOrder: 2 })] });
    expect(model.totals.plannedHours).toBeNull();
    expect(model.totals.effortVariance).toBeNull();
    expect(model.coverage).toMatchObject({ leaves: 2, withPlannedHours: 0 });
  });

  it('soma apenas as folhas que têm duração e reporta a cobertura', () => {
    const items = [
      makeItem({ id: 'a', rowOrder: 1, durationMinutes: 480 }),
      makeItem({ id: 'b', rowOrder: 2, durationMinutes: null }),
      makeItem({ id: 'c', rowOrder: 3, durationMinutes: 120 }),
    ];
    const model = build({ items, entries: [entry({ id: '1', personId: 'p1', minutes: 60, timelineItemId: 'a' })] });
    expect(model.totals.plannedHours).toBe(10);
    expect(model.totals.loggedHours).toBe(1);
    expect(model.totals.effortVariance).toBe(-9);
    expect(model.coverage).toMatchObject({ leaves: 3, withPlannedHours: 2, withLoggedHours: 1 });
  });

  it('conta trabalhadores distintos hoje, inclusive sem etapa escolhida', () => {
    const items = [makeItem({ id: 'a' })];
    const entries = [
      entry({ id: '1', personId: 'p1', minutes: 60, timelineItemId: 'a', workDate: TODAY }),
      entry({ id: '2', personId: 'p1', minutes: 60, timelineItemId: 'a', workDate: TODAY }),
      // Sem etapa: a pessoa trabalhou no projeto de qualquer forma.
      entry({ id: '3', personId: 'p2', minutes: 60, timelineItemId: null, workDate: TODAY }),
      entry({ id: '4', personId: 'p3', minutes: 60, timelineItemId: 'a', workDate: '2026-08-01' }),
    ];
    expect(build({ items, entries }).totals.activeWorkersToday).toBe(2);
  });

  it('cobertura de responsável conta responsável direto e equipe', () => {
    const items = [
      makeItem({ id: 'a', rowOrder: 1, responsibleUserId: 'u1' }),
      makeItem({
        id: 'b', rowOrder: 2,
        assignments: [{ id: 'x', organizationId: 'o', projectId: 'p', timelineItemId: 'b', userId: 'u2', role: 'executor', assignedBy: null, assignedAt: FIXED_NOW, removedAt: null }],
      }),
      makeItem({ id: 'c', rowOrder: 3 }),
    ];
    expect(build({ items }).coverage.withResponsible).toBe(2);
  });

  it('sem permissão, cobertura e totais ficam zerados/nulos sem afirmar nada', () => {
    const model = build({ items: [makeItem({ id: 'a' })], availability: 'unauthorized' });
    expect(model.totals.plannedHours).toBeNull();
    expect(model.totals.activeWorkersToday).toBeNull();
    expect(model.totals.noRecentActivityCount).toBeNull();
    expect(model.coverage.leaves).toBe(0);
  });
});

describe('rollup de fase — regra do MS Project', () => {
  it('a fase NÃO soma a própria duração à dos filhos', () => {
    // Duração de resumo no MS Project é SPAN de calendário, não esforço:
    // somá-la contaria a mesma fase duas vezes.
    const items = [
      makeItem({ id: 'f1', rowOrder: 1, isSummary: true, durationMinutes: 9999 }),
      makeItem({ id: 't1', rowOrder: 2, parentId: 'f1', durationMinutes: 480 }),
      makeItem({ id: 't2', rowOrder: 3, parentId: 'f1', durationMinutes: 120 }),
    ];
    const model = build({ items });
    rollupExecution(buildTree(items), model.byItem);
    expect(model.byItem.get('f1')!.plannedHours).toBe(10);
  });

  it('propaga estouro de esforço e parada da folha para a fase', () => {
    const items = [
      makeItem({ id: 'f1', rowOrder: 1, isSummary: true }),
      makeItem({ id: 't1', rowOrder: 2, parentId: 'f1', status: 'in_progress', durationMinutes: 60 }),
    ];
    const model = build({
      items,
      entries: [entry({ id: '1', personId: 'p1', minutes: 300, timelineItemId: 't1', workDate: '2026-07-01' })],
    });
    rollupExecution(buildTree(items), model.byItem);
    const fase = model.byItem.get('f1')!;
    expect(fase.overPlannedEffort).toBe(true);
    expect(fase.noRecentActivity).toBe(true);
  });
});

describe('formatação', () => {
  it('null vira travessão, nunca "0 h"', () => {
    expect(formatHours(null)).toBe('—');
    expect(formatVariance(null)).toBe('—');
  });

  it('zero observado é exibido como zero', () => {
    expect(formatHours(0)).toBe('0 h');
  });

  it('variância positiva ganha sinal explícito', () => {
    expect(formatVariance(3.5)).toBe('+3,5 h');
    expect(formatVariance(-2)).toBe('-2 h');
  });
});
