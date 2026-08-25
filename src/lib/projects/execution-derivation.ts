/**
 * Derivação de ESTADO DE EXECUÇÃO a partir de evidência casada, e as EXCEÇÕES
 * que sobram para decisão humana.
 *
 * ─── A separação que sustenta a confiança ──────────────────────────────────
 *   FATO OBSERVADO   horas medidas, instante da evidência, quem estava lá.
 *   ESTADO DERIVADO  "ativo hoje", "sem atividade recente" — conclusão direta
 *                    e reversível a partir dos fatos.
 *   PROPOSTA         início/término reais sugeridos pela evidência. NÃO são
 *                    aplicados: viram sugestão para o gestor confirmar.
 *   CONFIRMAÇÃO      só o humano move `% progresso` e datas reais.
 *
 * O `% de progresso` NUNCA é inferido. Presença não é avanço físico: alguém
 * pode passar o dia numa etapa e não entregar nada. Converter evidência fraca
 * em percentual autoritativo seria fabricar o número mais sensível do módulo.
 *
 * Puro: sem Supabase, sem React.
 */

import type { TimelineItem } from '@/lib/types/project-timeline';
import type { ExecutionEvidence, EvidenceSource } from '@/lib/projects/execution-evidence';
import type { EvidenceMatch, MatchStatus, ReasonCode } from '@/lib/projects/execution-matching';

const DAY_MS = 24 * 60 * 60 * 1000;
const OPEN_STATUSES = new Set(['not_started', 'in_progress', 'blocked', 'delayed']);

/** Dias sem evidência a partir dos quais uma etapa aberta vira exceção. */
export const SILENT_ITEM_DAYS = 7;

export interface ObservedExecution {
  itemId: string;
  /** Horas medidas por evidência que MEDE tempo. null se nada mede. */
  observedHours: number | null;
  evidenceCount: number;
  sources: EvidenceSource[];
  personIds: string[];
  firstEvidenceAt: string | null;
  lastEvidenceAt: string | null;
  activeToday: boolean;
  /** Melhor confiança entre as evidências casadas nesta etapa. */
  matchConfidence: number | null;
  /** Evidência casada porém abaixo do limiar de aplicação automática. */
  unresolvedEvidence: number;
  /** Sugestões — nunca gravadas sem confirmação humana. */
  proposedActualStart: string | null;
  proposedActualFinish: string | null;
}

function localDateIso(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export interface BuildObservedInput {
  items: TimelineItem[];
  evidence: ExecutionEvidence[];
  matches: EvidenceMatch[];
  now: Date;
  /** Limiar de aplicação automática — marca o que ficou por resolver. */
  autoApplyMin: number;
}

export function buildObservedExecution(input: BuildObservedInput): Map<string, ObservedExecution> {
  const { items, evidence, matches, now } = input;
  const evidenceById = new Map(evidence.map((e) => [e.id, e]));
  const itemById = new Map(items.map((i) => [i.id, i]));
  const todayIso = localDateIso(now);
  const out = new Map<string, ObservedExecution>();

  for (const match of matches) {
    if (match.status !== 'MATCHED' || !match.timelineItemId) continue;
    const item = itemById.get(match.timelineItemId);
    const ev = evidenceById.get(match.evidenceId);
    if (!item || !ev) continue;

    let obs = out.get(item.id);
    if (!obs) {
      obs = {
        itemId: item.id,
        observedHours: null,
        evidenceCount: 0,
        sources: [],
        personIds: [],
        firstEvidenceAt: null,
        lastEvidenceAt: null,
        activeToday: false,
        matchConfidence: null,
        unresolvedEvidence: 0,
        proposedActualStart: null,
        proposedActualFinish: null,
      };
      out.set(item.id, obs);
    }

    obs.evidenceCount += 1;
    if (!obs.sources.includes(ev.source)) obs.sources.push(ev.source);
    if (ev.personId && !obs.personIds.includes(ev.personId)) obs.personIds.push(ev.personId);

    // Só soma o que realmente mede tempo. Batida de ponto não vira hora aqui.
    if (ev.durationMinutes != null) {
      obs.observedHours = round2((obs.observedHours ?? 0) + ev.durationMinutes / 60);
    }

    if (!obs.firstEvidenceAt || ev.occurredAt < obs.firstEvidenceAt) obs.firstEvidenceAt = ev.occurredAt;
    if (!obs.lastEvidenceAt || ev.occurredAt > obs.lastEvidenceAt) obs.lastEvidenceAt = ev.occurredAt;
    if (ev.occurredAt.slice(0, 10) === todayIso) obs.activeToday = true;

    obs.matchConfidence = Math.max(obs.matchConfidence ?? 0, match.confidence);
    if (!match.autoApplied) obs.unresolvedEvidence += 1;
  }

  // Propostas de datas reais — sugestão, não escrita.
  for (const obs of out.values()) {
    const item = itemById.get(obs.itemId)!;
    if (!item.actualStart && obs.firstEvidenceAt) {
      obs.proposedActualStart = obs.firstEvidenceAt.slice(0, 10);
    }
    // Término só é proposto quando a etapa já foi dada como concluída: até lá,
    // "última evidência" não significa "acabou".
    if (!item.actualFinish && item.status === 'completed' && obs.lastEvidenceAt) {
      obs.proposedActualFinish = obs.lastEvidenceAt.slice(0, 10);
    }
  }

  return out;
}

/* ───────────────── P3A — contexto de execução resolvido ───────────────── */

/**
 * O que o Apex conclui que está acontecendo AGORA para uma pessoa.
 *
 * Serve tanto ao gestor (quem está em quê) quanto ao colaborador no Ponto —
 * é o que dispensa o funcionário de escolher a etapa manualmente.
 *
 * A separação entre INTENÇÃO e OBSERVAÇÃO é deliberada:
 *   plannedResponsibleUserId  quem o plano diz que responde pela etapa;
 *   observedParticipants      quem a evidência mostra que trabalhou nela.
 * Os dois divergem o tempo todo em obra — e é justamente essa divergência
 * (o "task claim") que o P3A precisa representar sem apagar nenhum dos lados.
 */
export interface ResolvedExecutionContext {
  personId: string;
  projectId: string | null;
  /** Fase (ancestral resumo) da etapa resolvida. */
  phaseId: string | null;
  phaseTitle: string | null;
  timelineItemId: string | null;
  timelineItemTitle: string | null;
  teamName: string | null;
  confidence: number | null;
  reasonCodes: ReasonCode[];
  /** Ambíguo/indefinido ⇒ a UI não deve afirmar nada. */
  status: MatchStatus | 'NO_EVIDENCE';
  lastEvidenceAt: string | null;
  candidates: { timelineItemId: string; title: string }[];
}

export interface ResolveContextInput {
  personId: string;
  items: TimelineItem[];
  evidence: ExecutionEvidence[];
  matches: EvidenceMatch[];
  now: Date;
  /** Janela para considerar a evidência "corrente". */
  windowHours?: number;
}

export function resolveExecutionContext(input: ResolveContextInput): ResolvedExecutionContext {
  const { personId, items, evidence, matches, now, windowHours = 24 } = input;
  const itemById = new Map(items.map((i) => [i.id, i]));
  const evidenceById = new Map(evidence.map((e) => [e.id, e]));
  const cutoff = now.getTime() - windowHours * 60 * 60 * 1000;

  const empty: ResolvedExecutionContext = {
    personId, projectId: null, phaseId: null, phaseTitle: null,
    timelineItemId: null, timelineItemTitle: null, teamName: null,
    confidence: null, reasonCodes: [], status: 'NO_EVIDENCE',
    lastEvidenceAt: null, candidates: [],
  };

  // Evidência recente desta pessoa, da mais nova para a mais antiga.
  const mine = matches
    .map((m) => ({ match: m, ev: evidenceById.get(m.evidenceId) }))
    .filter(
      (x): x is { match: EvidenceMatch; ev: ExecutionEvidence } =>
        Boolean(x.ev) && x.ev!.personId === personId && x.ev!.isValid &&
        new Date(x.ev!.occurredAt).getTime() >= cutoff,
    )
    .sort((a, b) => (a.ev.occurredAt < b.ev.occurredAt ? 1 : -1));

  if (mine.length === 0) return empty;

  const lastEvidenceAt = mine[0].ev.occurredAt;
  // A mais recente que o motor conseguiu casar manda no contexto corrente.
  const best = mine.find((x) => x.match.status === 'MATCHED');

  if (!best) {
    const ambiguous = mine.find((x) => x.match.status === 'AMBIGUOUS');
    return {
      ...empty,
      status: ambiguous ? 'AMBIGUOUS' : 'UNMATCHED',
      projectId: (ambiguous ?? mine[0]).match.projectId,
      reasonCodes: (ambiguous ?? mine[0]).match.reasonCodes,
      lastEvidenceAt,
      candidates: (ambiguous?.match.candidates ?? []).map((c) => ({
        timelineItemId: c.timelineItemId, title: c.title,
      })),
    };
  }

  const item = best.match.timelineItemId ? itemById.get(best.match.timelineItemId) : undefined;
  // Sobe até a primeira fase (resumo) — é o "onde" que o colaborador reconhece.
  let phase: TimelineItem | undefined;
  let cursor = item?.parentId ? itemById.get(item.parentId) : undefined;
  const seen = new Set<string>();
  while (cursor && !seen.has(cursor.id)) {
    seen.add(cursor.id);
    if (cursor.isSummary) { phase = cursor; break; }
    cursor = cursor.parentId ? itemById.get(cursor.parentId) : undefined;
  }

  return {
    personId,
    projectId: best.match.projectId,
    phaseId: phase?.id ?? null,
    phaseTitle: phase?.title ?? null,
    timelineItemId: item?.id ?? null,
    timelineItemTitle: item?.title ?? null,
    teamName: best.match.matchedTeamName ?? null,
    confidence: best.match.confidence,
    reasonCodes: best.match.reasonCodes,
    status: 'MATCHED',
    lastEvidenceAt,
    candidates: best.match.candidates.map((c) => ({
      timelineItemId: c.timelineItemId, title: c.title,
    })),
  };
}

/* ───────────────────────── P2D — exceções ───────────────────────── */

export type ExceptionType =
  | 'ambiguous_match'
  | 'hours_without_task'
  | 'evidence_outside_window'
  | 'work_before_predecessor'
  | 'evidence_without_progress'
  | 'expected_active_but_silent';

export const EXCEPTION_LABELS: Record<ExceptionType, string> = {
  ambiguous_match: 'Evidência com mais de uma etapa possível',
  hours_without_task: 'Horas sem etapa identificável',
  evidence_outside_window: 'Execução fora da janela planejada',
  work_before_predecessor: 'Execução antes da predecessora concluir',
  evidence_without_progress: 'Trabalho registrado sem atualização de progresso',
  expected_active_but_silent: 'Etapa que deveria estar ativa, sem evidência',
};

export type ExceptionSeverity = 'high' | 'medium' | 'low';

export interface ExecutionException {
  id: string;
  type: ExceptionType;
  severity: ExceptionSeverity;
  title: string;
  detail: string;
  /** Etapa envolvida, quando há uma. */
  itemId: string | null;
  evidenceIds: string[];
  /** Candidatas quando a decisão é "qual etapa?". */
  candidates: { timelineItemId: string; title: string; wbsCode: string | null }[];
}

export interface BuildExceptionsInput {
  items: TimelineItem[];
  evidence: ExecutionEvidence[];
  matches: EvidenceMatch[];
  observed: Map<string, ObservedExecution>;
  predecessorsByItem?: ReadonlyMap<string, string[]>;
  now: Date;
  limit?: number;
}

const SEVERITY_ORDER: Record<ExceptionSeverity, number> = { high: 0, medium: 1, low: 2 };

export function buildExecutionExceptions(input: BuildExceptionsInput): ExecutionException[] {
  const { items, evidence, matches, observed, predecessorsByItem, now, limit = 50 } = input;
  const evidenceById = new Map(evidence.map((e) => [e.id, e]));
  const itemById = new Map(items.map((i) => [i.id, i]));
  const out: ExecutionException[] = [];

  /* 1. Evidência ambígua — o motor se recusou a escolher. */
  for (const match of matches) {
    if (match.status !== 'AMBIGUOUS') continue;
    const ev = evidenceById.get(match.evidenceId);
    if (!ev) continue;
    out.push({
      id: `ambiguous:${match.evidenceId}`,
      type: 'ambiguous_match',
      severity: 'high',
      title: EXCEPTION_LABELS.ambiguous_match,
      detail: `${ev.label} · ${ev.occurredAt.slice(0, 10).split('-').reverse().join('/')} · ${match.candidates.length} candidatas`,
      itemId: null,
      evidenceIds: [ev.id],
      candidates: match.candidates.map((c) => ({
        timelineItemId: c.timelineItemId,
        title: c.title,
        wbsCode: c.wbsCode,
      })),
    });
  }

  /* 2. Evidência que MEDE tempo mas não achou etapa. */
  for (const match of matches) {
    if (match.status !== 'UNMATCHED') continue;
    const ev = evidenceById.get(match.evidenceId);
    if (!ev || !ev.isValid || ev.durationMinutes == null || ev.durationMinutes <= 0) continue;
    out.push({
      id: `hours-no-task:${ev.id}`,
      type: 'hours_without_task',
      severity: 'high',
      title: EXCEPTION_LABELS.hours_without_task,
      detail: `${ev.label} · ${match.reasonCodes.join(', ')}`,
      itemId: null,
      evidenceIds: [ev.id],
      candidates: [],
    });
  }

  /* 3. Execução fora da janela planejada da etapa que casou. */
  for (const match of matches) {
    if (match.status !== 'MATCHED' || !match.timelineItemId) continue;
    const item = itemById.get(match.timelineItemId);
    const ev = evidenceById.get(match.evidenceId);
    if (!item || !ev || !item.plannedStart || !item.plannedFinish) continue;
    const day = ev.occurredAt.slice(0, 10);
    if (day >= item.plannedStart && day <= item.plannedFinish) continue;
    out.push({
      id: `outside-window:${ev.id}`,
      type: 'evidence_outside_window',
      severity: 'medium',
      title: EXCEPTION_LABELS.evidence_outside_window,
      detail: `${item.title} · evidência em ${day.split('-').reverse().join('/')}, plano ${item.plannedStart.split('-').reverse().join('/')} → ${item.plannedFinish.split('-').reverse().join('/')}`,
      itemId: item.id,
      evidenceIds: [ev.id],
      candidates: [],
    });
  }

  /* 4. Execução iniciada antes de a predecessora concluir. */
  if (predecessorsByItem) {
    for (const [itemId, obs] of observed) {
      const item = itemById.get(itemId);
      if (!item || !obs.firstEvidenceAt) continue;
      const open = (predecessorsByItem.get(itemId) ?? [])
        .map((id) => itemById.get(id))
        .filter((p): p is TimelineItem => Boolean(p) && p!.status !== 'completed');
      if (open.length === 0) continue;
      out.push({
        id: `before-pred:${itemId}`,
        type: 'work_before_predecessor',
        severity: 'medium',
        title: EXCEPTION_LABELS.work_before_predecessor,
        detail: `${item.title} · predecessora aberta: ${open.map((p) => p.title).join(', ')}`,
        itemId,
        evidenceIds: [],
        candidates: [],
      });
    }
  }

  /* 5. Trabalho observado sem progresso registrado. */
  for (const [itemId, obs] of observed) {
    const item = itemById.get(itemId);
    if (!item || item.percentComplete > 0) continue;
    if (obs.evidenceCount === 0) continue;
    out.push({
      id: `no-progress:${itemId}`,
      type: 'evidence_without_progress',
      severity: 'medium',
      title: EXCEPTION_LABELS.evidence_without_progress,
      detail: `${item.title} · ${obs.evidenceCount} evidência(s), progresso em 0%`,
      itemId,
      evidenceIds: [],
      candidates: [],
    });
  }

  /* 6. Etapa que o plano diz estar em curso, sem evidência nenhuma. */
  const todayIso = localDateIso(now);
  for (const item of items) {
    if (!item.isActive || item.deletedAt || item.isSummary) continue;
    if (!OPEN_STATUSES.has(item.status)) continue;
    if (!item.plannedStart || !item.plannedFinish) continue;
    // Só cobra silêncio de etapa cuja janela já começou e ainda não fechou.
    if (item.plannedStart > todayIso || item.plannedFinish < todayIso) continue;
    const obs = observed.get(item.id);
    if (obs && obs.lastEvidenceAt) {
      const age = now.getTime() - new Date(obs.lastEvidenceAt).getTime();
      if (age <= SILENT_ITEM_DAYS * DAY_MS) continue;
    }
    out.push({
      id: `silent:${item.id}`,
      type: 'expected_active_but_silent',
      severity: 'low',
      title: EXCEPTION_LABELS.expected_active_but_silent,
      detail: `${item.title} · janela ativa desde ${item.plannedStart.split('-').reverse().join('/')}`,
      itemId: item.id,
      evidenceIds: [],
      candidates: [],
    });
  }

  out.sort((a, b) => {
    if (SEVERITY_ORDER[a.severity] !== SEVERITY_ORDER[b.severity]) {
      return SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
    }
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  return out.slice(0, limit);
}
