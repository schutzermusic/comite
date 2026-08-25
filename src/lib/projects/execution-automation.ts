/**
 * Orquestração pura da automação: evidência → segmentos → candidatos a escrita.
 *
 * Fica separada do serviço de writeback porque decidir O QUE seria escrito é
 * testável sem banco; só o ato de gravar precisa de Supabase. Essa divisão é o
 * que permite provar, em teste puro, que a automação não escreveria nada
 * indevido — sem depender de uma transação real.
 */

import type { TimelineItem } from '@/lib/types/project-timeline';
import type { ExecutionEvidence } from '@/lib/projects/execution-evidence';
import type { EvidenceMatch } from '@/lib/projects/execution-matching';
import {
  reconstructSegments,
  type ReconstructedSegment,
} from '@/lib/projects/session-reconstruction';
import {
  evaluateAutomation,
  type PolicyVerdict,
} from '@/lib/projects/execution-policy';

export interface SessionCandidate {
  segment: ReconstructedSegment;
  /** Casamento que sustenta a etapa do segmento. */
  match: EvidenceMatch;
  verdict: PolicyVerdict;
  projectId: string;
}

export interface BuildCandidatesInput {
  projectId: string;
  items: TimelineItem[];
  evidence: ExecutionEvidence[];
  matches: EvidenceMatch[];
}

/**
 * Monta os candidatos a sessão.
 *
 * A etapa de um segmento vem do casamento das batidas que o compõem — não de
 * uma média do dia. Se as batidas do segmento apontam para etapas diferentes
 * (troca de atividade no meio do turno), o segmento fica SEM etapa resolvida e
 * a política o rebaixa: melhor uma sessão sem etapa do que uma sessão atribuída
 * à etapa errada.
 */
export function buildSessionCandidates(input: BuildCandidatesInput): SessionCandidate[] {
  const { projectId, evidence, matches } = input;
  const matchByEvidence = new Map(matches.map((m) => [m.evidenceId, m]));
  const people = [...new Set(evidence.map((e) => e.personId).filter(Boolean))] as string[];
  const out: SessionCandidate[] = [];

  for (const personId of people) {
    for (const segment of reconstructSegments({ evidence, personId })) {
      // Casamentos das evidências que sustentam ESTE segmento.
      const segMatches = segment.evidenceIds
        .map((id) => matchByEvidence.get(id))
        .filter((m): m is EvidenceMatch => Boolean(m));

      const matched = segMatches.filter((m) => m.status === 'MATCHED' && m.timelineItemId);
      const distinctItems = new Set(matched.map((m) => m.timelineItemId));

      let effective: EvidenceMatch;
      if (matched.length > 0 && distinctItems.size === 1) {
        // Consenso: todas as evidências do segmento apontam para a mesma etapa.
        // Fica com a de MAIOR confiança para representar o segmento.
        effective = matched.reduce((a, b) => (b.confidence > a.confidence ? b : a));
      } else if (distinctItems.size > 1) {
        // Troca de atividade dentro do segmento: ambíguo por construção.
        effective = {
          evidenceId: segment.evidenceIds[0] ?? 'segment',
          status: 'AMBIGUOUS',
          confidence: 0,
          projectId,
          timelineItemId: null,
          personId,
          reasonCodes: ['MULTIPLE_ITEMS_IN_WINDOW'],
          candidates: matched.map((m) => ({
            timelineItemId: m.timelineItemId!,
            title: m.candidates[0]?.title ?? '',
            wbsCode: m.candidates[0]?.wbsCode ?? null,
            confidence: m.confidence,
          })),
          autoApplied: false,
        };
      } else {
        // Nenhuma evidência do segmento casou com etapa.
        const first = segMatches[0];
        effective = {
          evidenceId: segment.evidenceIds[0] ?? 'segment',
          status: 'UNMATCHED',
          confidence: 0,
          projectId: first?.projectId ?? null,
          timelineItemId: null,
          personId,
          reasonCodes: first?.reasonCodes ?? ['NO_PROJECT_CONTEXT'],
          candidates: [],
          autoApplied: false,
        };
      }

      out.push({
        segment,
        match: effective,
        verdict: evaluateAutomation({ match: effective, writeKind: 'work_session' }),
        projectId,
      });
    }
  }

  return out;
}

/** Só o que a política liberou para escrita automática. */
export function autoApplicable(candidates: SessionCandidate[]): SessionCandidate[] {
  return candidates.filter(
    (c) => c.verdict.decision === 'AUTO_APPLY' && c.segment.status === 'complete',
  );
}
