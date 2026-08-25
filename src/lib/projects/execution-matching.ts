/**
 * Motor de CASAMENTO de evidência → Projeto → Etapa → Colaborador.
 *
 * Determinístico e auditável. Cada regra tem um código, uma confiança fixa e
 * uma ordem de precedência declarada em `MATCHING_POLICY` — nada de heurística
 * escondida no meio do código, e nada de IA onde evidência explícita resolve.
 *
 * ─── O contrato que evita mentira ──────────────────────────────────────────
 *   MATCHED     uma única etapa/projeto sobreviveu, acima do limiar.
 *   AMBIGUOUS   há candidatos plausíveis, mas mais de um. NÃO se escolhe.
 *   UNMATCHED   não há contexto suficiente. NÃO se inventa.
 *
 * "Não sei" é resposta válida e é a resposta certa na maior parte do dado real
 * hoje. Um motor que sempre casa alguma coisa é um motor que fabrica dado.
 *
 * Puro: sem Supabase, sem React.
 */

import type { TimelineItem } from '@/lib/types/project-timeline';
import type { ExecutionEvidence } from '@/lib/projects/execution-evidence';

export type MatchStatus = 'MATCHED' | 'AMBIGUOUS' | 'UNMATCHED';

/**
 * Códigos de razão. Aparecem na UI e nos testes — são a explicação de POR QUE
 * o motor decidiu o que decidiu.
 */
export type ReasonCode =
  | 'EXPLICIT_TIMELINE_LINK'
  | 'EXPLICIT_PROJECT_LINK'
  | 'GEOFENCE_CONTAINMENT'
  | 'GEOFENCE_OUT_OF_RANGE'
  | 'SINGLE_ACTIVE_ALLOCATION'
  | 'MULTIPLE_ACTIVE_ALLOCATIONS'
  | 'NO_PROJECT_CONTEXT'
  | 'SINGLE_ASSIGNED_OPEN_ITEM'
  | 'MULTIPLE_ASSIGNED_OPEN_ITEMS'
  | 'SINGLE_TEAM_OPEN_ITEM'
  | 'MULTIPLE_TEAM_OPEN_ITEMS'
  | 'ASSIGNMENT_CONTRADICTS_LOCATION'
  | 'SINGLE_ITEM_IN_WINDOW'
  | 'MULTIPLE_ITEMS_IN_WINDOW'
  | 'NO_ITEM_IN_WINDOW'
  | 'NO_PERSON_CONTEXT'
  | 'EVIDENCE_INVALID'
  | 'OUTSIDE_ANY_PLANNED_WINDOW';

export const REASON_LABELS: Record<ReasonCode, string> = {
  EXPLICIT_TIMELINE_LINK: 'Etapa informada no próprio registro',
  EXPLICIT_PROJECT_LINK: 'Projeto informado no próprio registro',
  GEOFENCE_CONTAINMENT: 'Localização dentro da cerca do projeto',
  GEOFENCE_OUT_OF_RANGE: 'Localização fora de qualquer cerca cadastrada',
  SINGLE_ACTIVE_ALLOCATION: 'Pessoa alocada em um único projeto na data',
  MULTIPLE_ACTIVE_ALLOCATIONS: 'Pessoa alocada em mais de um projeto na data',
  NO_PROJECT_CONTEXT: 'Sem contexto de projeto na data',
  SINGLE_ASSIGNED_OPEN_ITEM: 'Uma única etapa aberta atribuída à pessoa',
  MULTIPLE_ASSIGNED_OPEN_ITEMS: 'Mais de uma etapa aberta atribuída à pessoa',
  SINGLE_TEAM_OPEN_ITEM: 'Uma única etapa aberta atribuída à equipe da pessoa',
  MULTIPLE_TEAM_OPEN_ITEMS: 'Mais de uma etapa aberta atribuída à equipe da pessoa',
  ASSIGNMENT_CONTRADICTS_LOCATION: 'Atribuição planejada conflita com a localização observada',
  SINGLE_ITEM_IN_WINDOW: 'Uma única etapa aberta na janela da data',
  MULTIPLE_ITEMS_IN_WINDOW: 'Mais de uma etapa aberta na janela da data',
  NO_ITEM_IN_WINDOW: 'Nenhuma etapa planejada cobre a data',
  NO_PERSON_CONTEXT: 'Registro sem pessoa identificada',
  EVIDENCE_INVALID: 'Registro cancelado ou rejeitado na origem',
  OUTSIDE_ANY_PLANNED_WINDOW: 'Execução fora de qualquer janela planejada',
};

/**
 * Política de casamento — ÚNICO lugar onde limiares vivem.
 *
 * Confianças são fixas por regra (não aprendidas): é o que torna o resultado
 * reproduzível e explicável. Para aumentar a autonomia, sobe-se `autoApplyMin`
 * ou adiciona-se regra nova — sempre de forma visível.
 */
export interface MatchingPolicy {
  /** Confiança de cada regra que resolve a ETAPA. */
  timelineConfidence: {
    explicitLink: number;
    /** Pessoa atribuída nominalmente à etapa. */
    singleAssignedOpenItem: number;
    /** Equipe da pessoa atribuída à etapa (P3A). */
    singleTeamOpenItem: number;
    singleItemInWindow: number;
  };
  /** Confiança de cada regra que resolve o PROJETO. */
  projectConfidence: {
    explicitLink: number;
    geofence: number;
    singleAllocation: number;
  };
  /** A partir daqui o casamento pode ser aplicado sem humano. */
  autoApplyMin: number;
  /** Abaixo daqui nem candidato se oferece. */
  candidateMin: number;
  /** Folga somada ao raio da cerca, além da precisão do GPS. */
  geofenceSlackMeters: number;
  /** Dias de tolerância em torno da janela planejada da etapa. */
  windowSlackDays: number;
}

export const MATCHING_POLICY: MatchingPolicy = {
  timelineConfidence: {
    explicitLink: 1,
    // Atribuição nominal é a intenção mais forte que o gestor pode declarar.
    singleAssignedOpenItem: 0.92,
    // Equipe é intenção real, porém coletiva: qualquer membro pode ser quem
    // executa. Ainda acima do limiar automático, mas abaixo do nominal.
    singleTeamOpenItem: 0.85,
    singleItemInWindow: 0.55,
  },
  projectConfidence: {
    explicitLink: 0.95,
    geofence: 0.85,
    singleAllocation: 0.7,
  },
  autoApplyMin: 0.8,
  candidateMin: 0.5,
  geofenceSlackMeters: 0,
  windowSlackDays: 0,
};

export interface MatchCandidate {
  timelineItemId: string;
  title: string;
  wbsCode: string | null;
  confidence: number;
}

export interface EvidenceMatch {
  evidenceId: string;
  status: MatchStatus;
  /** 0..1. Sempre presente; 0 em UNMATCHED. */
  confidence: number;
  projectId: string | null;
  timelineItemId: string | null;
  personId: string | null;
  reasonCodes: ReasonCode[];
  candidates: MatchCandidate[];
  /** Equipe que sustentou o casamento, quando veio por atribuição coletiva. */
  matchedTeamName?: string | null;
  /** true quando confidence ≥ autoApplyMin e o status é MATCHED. */
  autoApplied: boolean;
}

/* ───────────────────────── Contexto de casamento ───────────────────────── */

export interface AllocationWindow {
  personId: string;
  projectId: string;
  startDate: string;
  /** null = em aberto. */
  endDate: string | null;
  status: string;
}

export interface GeofenceArea {
  id: string;
  projectId: string;
  centerLat: number;
  centerLng: number;
  radiusMeters: number;
  accuracyToleranceMeters: number;
  active: boolean;
}

export interface MatchContext {
  /** Projeto em foco. Evidência de outro projeto é ignorada. */
  projectId: string;
  items: TimelineItem[];
  allocations: AllocationWindow[];
  geofences: GeofenceArea[];
  /**
   * Ponte people.id → auth.users.id. Necessária porque a evidência é chaveada
   * por PESSOA e as atribuições do cronograma por USUÁRIO (032). Sem a ponte,
   * a regra de "etapa atribuída" simplesmente não se aplica — e o motor cai
   * para a janela do plano em vez de adivinhar.
   */
  userIdByPerson?: ReadonlyMap<string, string>;
  /**
   * Intenção de atribuição por EQUIPE (migration 096):
   * pessoa → etapas atribuídas à(s) equipe(s) de que ela participa.
   *
   * Vem já resolvido em `people` — é o que permite atribuir uma turma a uma
   * fase inteira sem duplicar cada membro em cada linha do Gantt, e sem
   * depender da ponte people↔auth.users.
   */
  teamItemsByPerson?: ReadonlyMap<string, ReadonlySet<string>>;
  /** Nome da equipe por etapa, só para provenance legível. */
  teamNameByItem?: ReadonlyMap<string, string>;
  policy?: MatchingPolicy;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const OPEN_STATUSES = new Set(['not_started', 'in_progress', 'blocked', 'delayed']);

function dayOf(iso: string): string {
  return iso.slice(0, 10);
}

/** Distância em metros pela fórmula de haversine. */
export function haversineMeters(
  aLat: number, aLng: number, bLat: number, bLng: number,
): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** A data cai dentro da janela planejada da etapa (com folga da política)? */
function coversDate(item: TimelineItem, day: string, slackDays: number): boolean {
  const start = item.plannedStart ?? item.plannedFinish;
  const finish = item.plannedFinish ?? item.plannedStart;
  if (!start || !finish) return false;
  const slack = slackDays * DAY_MS;
  const t = new Date(`${day}T00:00:00`).getTime();
  return (
    t >= new Date(`${start}T00:00:00`).getTime() - slack &&
    // Término é inclusivo, coerente com o resto do módulo.
    t <= new Date(`${finish}T00:00:00`).getTime() + DAY_MS + slack
  );
}

function allocationCovers(alloc: AllocationWindow, day: string): boolean {
  if (alloc.status !== 'active' && alloc.status !== 'pending_approval') return false;
  if (day < alloc.startDate) return false;
  return alloc.endDate == null || day <= alloc.endDate;
}

/* ───────────────────────── Resolução do projeto ───────────────────────── */

interface ProjectResolution {
  projectId: string | null;
  confidence: number;
  reasons: ReasonCode[];
}

function resolveProject(
  evidence: ExecutionEvidence,
  ctx: MatchContext,
  policy: MatchingPolicy,
): ProjectResolution {
  // 1. O registro afirma o projeto. Nada supera isso.
  if (evidence.projectId) {
    return {
      projectId: evidence.projectId,
      confidence: policy.projectConfidence.explicitLink,
      reasons: ['EXPLICIT_PROJECT_LINK'],
    };
  }

  const reasons: ReasonCode[] = [];

  // 2. Contenção geométrica: a coordenada cai dentro de uma cerca do projeto.
  //    `location_evidence.geofence_id` está nulo em todo o dado real, mas as
  //    coordenadas existem — então a resolução é calculada, não presumida.
  if (evidence.location) {
    const active = ctx.geofences.filter((g) => g.active);
    const within = active.filter((g) => {
      const d = haversineMeters(
        evidence.location!.latitude, evidence.location!.longitude, g.centerLat, g.centerLng,
      );
      const tolerance =
        g.radiusMeters +
        (evidence.location!.accuracyMeters ?? 0) +
        g.accuracyToleranceMeters +
        policy.geofenceSlackMeters;
      return d <= tolerance;
    });
    const projects = new Set(within.map((g) => g.projectId));
    if (projects.size === 1) {
      return {
        projectId: [...projects][0],
        confidence: policy.projectConfidence.geofence,
        reasons: ['GEOFENCE_CONTAINMENT'],
      };
    }
    if (active.length > 0 && within.length === 0) reasons.push('GEOFENCE_OUT_OF_RANGE');
  }

  // 3. Alocação vigente na data. Só resolve quando é UMA.
  if (evidence.personId) {
    const day = dayOf(evidence.occurredAt);
    const covering = ctx.allocations.filter(
      (a) => a.personId === evidence.personId && allocationCovers(a, day),
    );
    const projects = new Set(covering.map((a) => a.projectId));
    if (projects.size === 1) {
      return {
        projectId: [...projects][0],
        confidence: policy.projectConfidence.singleAllocation,
        reasons: [...reasons, 'SINGLE_ACTIVE_ALLOCATION'],
      };
    }
    if (projects.size > 1) {
      return { projectId: null, confidence: 0, reasons: [...reasons, 'MULTIPLE_ACTIVE_ALLOCATIONS'] };
    }
  }

  return { projectId: null, confidence: 0, reasons: [...reasons, 'NO_PROJECT_CONTEXT'] };
}

/* ───────────────────────── Casamento de uma evidência ───────────────────────── */

export function matchEvidence(evidence: ExecutionEvidence, ctx: MatchContext): EvidenceMatch {
  const policy = ctx.policy ?? MATCHING_POLICY;
  const base = {
    evidenceId: evidence.id,
    personId: evidence.personId,
    candidates: [] as MatchCandidate[],
    autoApplied: false,
  };

  // Registro inválido na origem não evidencia nada.
  if (!evidence.isValid) {
    return {
      ...base, status: 'UNMATCHED', confidence: 0,
      projectId: null, timelineItemId: null, reasonCodes: ['EVIDENCE_INVALID'],
    };
  }

  // 1. Vínculo explícito com a etapa: caminho de maior confiança que existe.
  if (evidence.timelineItemId) {
    const item = ctx.items.find((i) => i.id === evidence.timelineItemId);
    if (item && item.isActive && !item.deletedAt) {
      const confidence = policy.timelineConfidence.explicitLink;
      return {
        ...base,
        status: 'MATCHED',
        confidence,
        projectId: item.projectId,
        timelineItemId: item.id,
        reasonCodes: ['EXPLICIT_TIMELINE_LINK'],
        autoApplied: confidence >= policy.autoApplyMin,
      };
    }
  }

  const project = resolveProject(evidence, ctx, policy);
  const reasonCodes: ReasonCode[] = [...project.reasons];

  if (!project.projectId) {
    return { ...base, status: 'UNMATCHED', confidence: 0, projectId: null, timelineItemId: null, reasonCodes };
  }
  // Evidência de outro projeto não é problema deste cronograma.
  if (project.projectId !== ctx.projectId) {
    // A intenção de atribuição NÃO apaga evidência contrária: se a pessoa está
    // planejada aqui mas a localização a coloca em outro projeto, o conflito é
    // declarado em vez de resolvido a favor do plano.
    const hasIntentHere =
      Boolean(evidence.personId) &&
      ((ctx.teamItemsByPerson?.get(evidence.personId!)?.size ?? 0) > 0 ||
        Boolean(
          ctx.userIdByPerson?.get(evidence.personId!) &&
            ctx.items.some(
              (i) => i.responsibleUserId === ctx.userIdByPerson!.get(evidence.personId!),
            ),
        ));
    return {
      ...base,
      status: 'UNMATCHED',
      confidence: 0,
      projectId: project.projectId,
      timelineItemId: null,
      reasonCodes: hasIntentHere ? [...reasonCodes, 'ASSIGNMENT_CONTRADICTS_LOCATION'] : reasonCodes,
    };
  }

  if (!evidence.personId) {
    return {
      ...base, status: 'UNMATCHED', confidence: 0,
      projectId: project.projectId, timelineItemId: null,
      reasonCodes: [...reasonCodes, 'NO_PERSON_CONTEXT'],
    };
  }

  const day = dayOf(evidence.occurredAt);
  const leaves = ctx.items.filter(
    (i) => i.isActive && !i.deletedAt && !i.isSummary && OPEN_STATUSES.has(i.status),
  );

  // 2. Etapas ABERTAS atribuídas à pessoa e cuja janela cobre a data.
  //    Sem ponte pessoa→usuário a regra não se aplica (assigned fica vazio) e
  //    o motor cai para a janela do plano, com confiança menor. Nunca chuta.
  const userId = ctx.userIdByPerson?.get(evidence.personId) ?? null;
  const assigned = userId
    ? leaves.filter(
        (i) =>
          (i.responsibleUserId === userId ||
            (i.assignments ?? []).some((a) => !a.removedAt && a.userId === userId)) &&
          coversDate(i, day, policy.windowSlackDays),
      )
    : [];

  const toCandidate = (i: TimelineItem, confidence: number): MatchCandidate => ({
    timelineItemId: i.id,
    title: i.title,
    wbsCode: i.wbsCode,
    confidence,
  });

  if (assigned.length === 1) {
    // A confiança da ATRIBUIÇÃO não é limitada pela do projeto: uma etapa
    // pertence a exatamente um projeto, então atribuir a pessoa à etapa já
    // afirma o projeto. A alocação é um caminho redundante e mais fraco para a
    // mesma conclusão — deixar o min() atuar aqui rebaixaria intenção nominal
    // (0.92) ao patamar da alocação (0.7) e nada jamais casaria sozinho.
    const confidence = policy.timelineConfidence.singleAssignedOpenItem;
    return {
      ...base,
      status: 'MATCHED',
      confidence,
      projectId: project.projectId,
      timelineItemId: assigned[0].id,
      reasonCodes: [...reasonCodes, 'SINGLE_ASSIGNED_OPEN_ITEM'],
      candidates: [toCandidate(assigned[0], confidence)],
      autoApplied: confidence >= policy.autoApplyMin,
    };
  }
  if (assigned.length > 1) {
    const confidence = policy.timelineConfidence.singleAssignedOpenItem;
    return {
      ...base,
      status: 'AMBIGUOUS',
      confidence: 0,
      projectId: project.projectId,
      timelineItemId: null,
      reasonCodes: [...reasonCodes, 'MULTIPLE_ASSIGNED_OPEN_ITEMS'],
      candidates: assigned.map((i) => toCandidate(i, confidence)),
    };
  }

  // 3. Atribuição por EQUIPE. Operação de campo atribui turma, não pessoa —
  //    então este caminho é tão legítimo quanto o nominal, só que coletivo.
  const teamItems = ctx.teamItemsByPerson?.get(evidence.personId);
  if (teamItems && teamItems.size > 0) {
    const assignedToTeam = leaves.filter(
      (i) => teamItems.has(i.id) && coversDate(i, day, policy.windowSlackDays),
    );
    // Mesma lógica da atribuição nominal: a etapa atribuída já afirma o
    // projeto, então a confiança da equipe não é limitada pela da alocação.
    const teamConfidence = policy.timelineConfidence.singleTeamOpenItem;

    if (assignedToTeam.length === 1) {
      const item = assignedToTeam[0];
      const teamName = ctx.teamNameByItem?.get(item.id);
      return {
        ...base,
        status: 'MATCHED',
        confidence: teamConfidence,
        projectId: project.projectId,
        timelineItemId: item.id,
        reasonCodes: [...reasonCodes, 'SINGLE_TEAM_OPEN_ITEM'],
        candidates: [toCandidate(item, teamConfidence)],
        matchedTeamName: teamName ?? null,
        autoApplied: teamConfidence >= policy.autoApplyMin,
      };
    }
    if (assignedToTeam.length > 1) {
      // A turma cobre várias frentes: o motor não elege qual delas.
      return {
        ...base,
        status: 'AMBIGUOUS',
        confidence: 0,
        projectId: project.projectId,
        timelineItemId: null,
        reasonCodes: [...reasonCodes, 'MULTIPLE_TEAM_OPEN_ITEMS'],
        candidates: assignedToTeam.slice(0, 8).map((i) => toCandidate(i, teamConfidence)),
      };
    }
  }

  // 4. Sem atribuição: só a janela do plano. Confiança baixa de propósito —
  //    "estava planejado para hoje" é contexto fraco, não prova de execução.
  const inWindow = leaves.filter((i) => coversDate(i, day, policy.windowSlackDays));

  if (inWindow.length === 0) {
    return {
      ...base, status: 'UNMATCHED', confidence: 0,
      projectId: project.projectId, timelineItemId: null,
      reasonCodes: [...reasonCodes, 'NO_ITEM_IN_WINDOW', 'OUTSIDE_ANY_PLANNED_WINDOW'],
    };
  }

  const windowConfidence = Math.min(project.confidence, policy.timelineConfidence.singleItemInWindow);

  if (inWindow.length === 1 && windowConfidence >= policy.candidateMin) {
    return {
      ...base,
      status: 'MATCHED',
      confidence: windowConfidence,
      projectId: project.projectId,
      timelineItemId: inWindow[0].id,
      reasonCodes: [...reasonCodes, 'SINGLE_ITEM_IN_WINDOW'],
      candidates: [toCandidate(inWindow[0], windowConfidence)],
      // Abaixo de autoApplyMin ⇒ fica para decisão humana, não se aplica.
      autoApplied: windowConfidence >= policy.autoApplyMin,
    };
  }

  return {
    ...base,
    status: 'AMBIGUOUS',
    confidence: 0,
    projectId: project.projectId,
    timelineItemId: null,
    reasonCodes: [...reasonCodes, 'MULTIPLE_ITEMS_IN_WINDOW'],
    candidates: inWindow
      .slice(0, 8)
      .map((i) => toCandidate(i, windowConfidence)),
  };
}

export function matchAll(evidence: ExecutionEvidence[], ctx: MatchContext): EvidenceMatch[] {
  return evidence.map((e) => matchEvidence(e, ctx));
}

/* ───────────────────────── P2E — métricas de autonomia ───────────────────────── */

export interface AutonomyMetrics {
  /** Total de evidências consideradas. 0 é observado, não desconhecido. */
  totalEvidence: number;
  /** Nulos quando não há evidência: taxa sobre denominador zero é ficção. */
  matchRate: number | null;
  autoMatchRate: number | null;
  ambiguousRate: number | null;
  unmatchedRate: number | null;
  /** Etapas com ao menos uma evidência casada. */
  itemsWithEvidence: number;
  /** Evidências que exigem decisão humana (ambíguas + casadas abaixo do limiar). */
  needingHuman: number;
  /**
   * Fração de evidências resolvidas sem humano. É a métrica-síntese do P2:
   * sobe conforme as fontes ganham vínculo explícito e as etapas ganham
   * responsáveis. null sem evidência.
   */
  autonomyRate: number | null;
  /**
   * P3A — de onde veio a autonomia. Separar isso mostra se o ganho vem de
   * INTENÇÃO declarada (atribuição nominal/equipe) ou de CONTEXTO inferido
   * (alocação, cerca, janela): são alavancas de gestão diferentes.
   */
  assignmentMatchRate: number | null;
  contextualMatchRate: number | null;
}

/** Regras que representam intenção declarada pelo gestor. */
const ASSIGNMENT_REASONS = new Set<ReasonCode>([
  'EXPLICIT_TIMELINE_LINK',
  'SINGLE_ASSIGNED_OPEN_ITEM',
  'SINGLE_TEAM_OPEN_ITEM',
]);

/** Cobertura de intenção no cronograma — o que o gestor já declarou. */
export interface AssignmentCoverage {
  /** Folhas abertas: o denominador do que precisaria de intenção. */
  openLeaves: number;
  withExplicitWorker: number;
  withTeam: number;
  /** Sem responsável nominal E sem equipe. */
  withoutAnyAssignment: number;
  /** Pessoas com contexto de projeto resolvível (alocação vigente). */
  workersWithProjectContext: number;
}

export const EMPTY_AUTONOMY: AutonomyMetrics = {
  totalEvidence: 0,
  matchRate: null,
  autoMatchRate: null,
  ambiguousRate: null,
  unmatchedRate: null,
  itemsWithEvidence: 0,
  needingHuman: 0,
  autonomyRate: null,
  assignmentMatchRate: null,
  contextualMatchRate: null,
};

export function computeAutonomyMetrics(matches: EvidenceMatch[]): AutonomyMetrics {
  const total = matches.length;
  if (total === 0) return EMPTY_AUTONOMY;

  const matched = matches.filter((m) => m.status === 'MATCHED');
  const auto = matched.filter((m) => m.autoApplied);
  const ambiguous = matches.filter((m) => m.status === 'AMBIGUOUS');
  const unmatched = matches.filter((m) => m.status === 'UNMATCHED');
  const needingHuman = ambiguous.length + (matched.length - auto.length);

  const rate = (n: number) => Math.round((n / total) * 1000) / 1000;

  return {
    totalEvidence: total,
    matchRate: rate(matched.length),
    autoMatchRate: rate(auto.length),
    ambiguousRate: rate(ambiguous.length),
    unmatchedRate: rate(unmatched.length),
    itemsWithEvidence: new Set(matched.map((m) => m.timelineItemId).filter(Boolean)).size,
    needingHuman,
    autonomyRate: rate(auto.length),
    assignmentMatchRate: rate(
      matched.filter((m) => m.reasonCodes.some((r) => ASSIGNMENT_REASONS.has(r))).length,
    ),
    contextualMatchRate: rate(
      matched.filter((m) => !m.reasonCodes.some((r) => ASSIGNMENT_REASONS.has(r))).length,
    ),
  };
}

/**
 * Quanto do cronograma já tem intenção declarada. Usa `people` para equipes e
 * auth.users para o responsável nominal — os dois espaços de identidade que o
 * módulo realmente tem.
 */
export function computeAssignmentCoverage(input: {
  items: TimelineItem[];
  teamItemIds: ReadonlySet<string>;
  allocations: AllocationWindow[];
  now: Date;
}): AssignmentCoverage {
  const today = input.now.toISOString().slice(0, 10);
  let openLeaves = 0;
  let withExplicitWorker = 0;
  let withTeam = 0;
  let withoutAnyAssignment = 0;

  for (const item of input.items) {
    if (!item.isActive || item.deletedAt || item.isSummary) continue;
    if (!OPEN_STATUSES.has(item.status)) continue;
    openLeaves += 1;

    const explicit =
      item.responsibleUserId != null ||
      (item.assignments ?? []).some((a) => !a.removedAt);
    const team = input.teamItemIds.has(item.id);
    if (explicit) withExplicitWorker += 1;
    if (team) withTeam += 1;
    if (!explicit && !team) withoutAnyAssignment += 1;
  }

  const workersWithProjectContext = new Set(
    input.allocations.filter((a) => allocationCovers(a, today)).map((a) => a.personId),
  ).size;

  return { openLeaves, withExplicitWorker, withTeam, withoutAnyAssignment, workersWithProjectContext };
}

/** Percentual em pt-BR. null ⇒ travessão. */
export function formatRate(rate: number | null): string {
  if (rate == null) return '—';
  return `${Math.round(rate * 100)}%`;
}
