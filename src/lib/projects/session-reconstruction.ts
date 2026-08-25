/**
 * RECONSTRUÇÃO DE SESSÃO DE TRABALHO a partir de batidas de ponto.
 *
 * Transforma a sequência bruta de `attendance_punches` em segmentos de trabalho
 * defensáveis — o insumo de "horas reais" que hoje não existe, já que
 * `time_entries` e `project_work_sessions` estão vazias enquanto o ponto tem
 * dado de verdade.
 *
 * ─── O que NÃO se faz aqui ─────────────────────────────────────────────────
 * Nunca se inventa um fim. Batida de entrada sem saída vira segmento
 * `incomplete` sem duração — não um turno de 8 h presumido. Fechar sessão por
 * conveniência estatística seria fabricar hora trabalhada, que é o número mais
 * caro do módulo.
 *
 * Também não se junta segmentos distantes só porque caíram no mesmo dia: dois
 * turnos separados por almoço são DOIS segmentos, e a soma é feita depois.
 *
 * Puro: sem Supabase, sem React.
 */

import type { ExecutionEvidence } from '@/lib/projects/execution-evidence';

/** Tipos de batida relevantes; o resto é ignorado. */
export type PunchType = 'clock_in' | 'clock_out' | 'break_start' | 'break_end';

export interface ReconstructedSegment {
  personId: string;
  /** Data local do início — a chave de agrupamento do dia. */
  workDate: string;
  startedAt: string;
  /** null quando a evidência não fecha o segmento. */
  endedAt: string | null;
  durationMinutes: number | null;
  /** Ids sintéticos das evidências que sustentam o segmento. */
  evidenceIds: string[];
  status: 'complete' | 'incomplete';
  /** Por que ficou incompleto — vira detalhe da exceção. */
  incompleteReason: 'missing_clock_out' | 'break_not_closed' | null;
}

/** Segmentos de duração zero não são trabalho observável. */
const MIN_SEGMENT_MINUTES = 1;

/**
 * Batidas idênticas em tipo e instante são duplicata de sincronização
 * (offline/retry), não dois eventos. A janela é curta de propósito: dois
 * clock_in legítimos com 1 min de diferença são coisa diferente de um
 * reenvio no mesmo segundo.
 */
const DUPLICATE_WINDOW_MS = 1000;

interface PunchLike {
  id: string;
  type: PunchType;
  at: number;
  iso: string;
}

function localDateIso(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Extrai batidas válidas de uma pessoa a partir da evidência normalizada. */
function punchesOf(evidence: ExecutionEvidence[], personId: string): PunchLike[] {
  const raw = evidence
    .filter(
      (e) =>
        e.source === 'attendance_punch' &&
        e.personId === personId &&
        // Batida cancelada/rejeitada não é evidência: `isValid` já reflete isso.
        e.isValid,
    )
    .map((e) => ({
      id: e.id,
      type: punchTypeOf(e),
      at: new Date(e.occurredAt).getTime(),
      iso: e.occurredAt,
    }))
    // Tipo desconhecido não entra na máquina de estados.
    .filter((p): p is PunchLike => p.type !== null)
    .sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : 1));

  // Remove reenvios: mesmo tipo, praticamente o mesmo instante.
  const out: PunchLike[] = [];
  for (const p of raw) {
    const prev = out[out.length - 1];
    if (prev && prev.type === p.type && p.at - prev.at <= DUPLICATE_WINDOW_MS) continue;
    out.push(p);
  }
  return out;
}

/** Tipo da batida, vindo do discriminador da própria fonte. */
function punchTypeOf(e: ExecutionEvidence): PunchType | null {
  const t = e.subtype;
  return t === 'clock_in' || t === 'clock_out' || t === 'break_start' || t === 'break_end'
    ? t
    : null;
}

export interface ReconstructInput {
  evidence: ExecutionEvidence[];
  personId: string;
}

/**
 * Máquina de estados sobre a sequência ordenada:
 *
 *   clock_in     abre segmento
 *   break_start  fecha o segmento corrente (o intervalo não é trabalho)
 *   break_end    abre novo segmento
 *   clock_out    fecha o segmento corrente
 *
 * Qualquer segmento que chegue ao fim da sequência sem fechamento sai como
 * `incomplete`, com duração null.
 */
export function reconstructSegments(input: ReconstructInput): ReconstructedSegment[] {
  const punches = punchesOf(input.evidence, input.personId);
  const segments: ReconstructedSegment[] = [];

  let openAt: PunchLike | null = null;
  let openEvidence: string[] = [];

  const close = (end: PunchLike | null, reason: ReconstructedSegment['incompleteReason']) => {
    if (!openAt) return;
    const startIso = openAt.iso;
    const workDate = localDateIso(new Date(openAt.at));

    if (end) {
      const minutes = Math.round((end.at - openAt.at) / 60000);
      // Segmento de duração zero (entrada e intervalo no mesmo minuto, como
      // acontece no dado real) não é trabalho observável — é ruído de registro.
      if (minutes >= MIN_SEGMENT_MINUTES) {
        segments.push({
          personId: input.personId,
          workDate,
          startedAt: startIso,
          endedAt: end.iso,
          durationMinutes: minutes,
          evidenceIds: [...openEvidence, end.id],
          status: 'complete',
          incompleteReason: null,
        });
      }
    } else {
      segments.push({
        personId: input.personId,
        workDate,
        startedAt: startIso,
        endedAt: null,
        durationMinutes: null,
        evidenceIds: [...openEvidence],
        status: 'incomplete',
        incompleteReason: reason,
      });
    }
    openAt = null;
    openEvidence = [];
  };

  for (const p of punches) {
    switch (p.type) {
      case 'clock_in':
        // Entrada com segmento já aberto = saída que nunca veio.
        if (openAt) close(null, 'missing_clock_out');
        openAt = p;
        openEvidence = [p.id];
        break;

      case 'break_start':
        close(p, null);
        break;

      case 'break_end':
        openAt = p;
        openEvidence = [p.id];
        break;

      case 'clock_out':
        if (openAt) close(p, null);
        // clock_out órfão (sem entrada correspondente) é descartado: não dá
        // para saber quando o trabalho começou, e chutar seria inventar hora.
        break;
    }
  }

  // Sobrou segmento aberto no fim da sequência.
  if (openAt) {
    const last = punches[punches.length - 1];
    close(null, last?.type === 'break_start' ? 'break_not_closed' : 'missing_clock_out');
  }

  return segments;
}

/** Minutos observados de um conjunto de segmentos. Ignora incompletos. */
export function observedMinutes(segments: ReconstructedSegment[]): number {
  return segments.reduce((sum, s) => sum + (s.durationMinutes ?? 0), 0);
}

/**
 * Chave determinística de idempotência.
 *
 * Baseada em pessoa + início + fim + etapa: reprocessar a mesma evidência
 * produz a mesma chave e encontra a linha já gravada em vez de duplicá-la.
 * Não inclui confiança nem método — se a regra mudar, a MESMA sessão deve ser
 * atualizada, não clonada.
 */
export function automationKeyFor(input: {
  personId: string;
  startedAt: string;
  endedAt: string | null;
  timelineItemId: string | null;
}): string {
  return [
    'apex',
    input.personId,
    input.startedAt,
    input.endedAt ?? 'open',
    input.timelineItemId ?? 'noitem',
  ].join('|');
}
