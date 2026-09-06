/**
 * AQUISIÇÃO AUTOMÁTICA DE EVIDÊNCIA — o que o Apex já sabe, ele não pergunta.
 *
 * ─── O objetivo de produto ─────────────────────────────────────────────────
 *
 * O gestor não deve redigitar o que o Apex já tem. Batida de ponto, diária
 * reconciliada, sessão de trabalho, documento anexado à etapa: tudo isso já
 * está no banco quando chega a hora de montar o pacote de medição. Este módulo
 * decide o que pode ser vinculado sozinho.
 *
 * ─── O que ele NÃO faz, e é a parte que importa ────────────────────────────
 *
 * Não conclui execução, não escreve progresso e não chega perto do aceite. O
 * teto da automação é VINCULAR EVIDÊNCIA — e mesmo isso passa pela política
 * que a operação já usa.
 *
 * ─── Por que reusa em vez de decidir por conta ─────────────────────────────
 *
 * O resolvedor de atribuição projeto/etapa já existe (`execution-matching.ts`)
 * com limiares declarados em UM lugar (`AUTOMATION_POLICY`). O plano da Fase 6
 * é explícito nas duas direções: reusar o resolvedor e NÃO inventar um limiar
 * novo. Um segundo limiar aqui seria uma segunda política de autonomia, e a
 * organização passaria a ter duas respostas para "o que o sistema faz sozinho".
 *
 * A tradução é direta, e é toda a regra deste arquivo:
 *
 *   AUTO_APPLY     → vincula, como DERIVED_EVIDENCE
 *   PROPOSE        → devolve como sugestão; ninguém vincula sozinho
 *   REQUIRE_HUMAN  → sugestão com pendência explícita
 *   REJECT         → não vincula, não sugere
 *
 * Nada aqui produz VALIDATED_EVIDENCE nem ACCEPTANCE_EVIDENCE: a migration 131
 * recusa isso no banco, e o recuso duplicado é de propósito.
 *
 * Puro: sem Supabase, sem React. Quem grava é a rota de servidor.
 */

import { matchEvidence, type EvidenceMatch, type MatchContext } from '@/lib/projects/execution-matching';
import { evaluateAutomation, type AutomationDecision } from '@/lib/projects/execution-policy';
import type { ExecutionEvidence } from '@/lib/projects/execution-evidence';
import type { EvidenceClass, EvidenceLinkSource, EvidenceSourceType } from './types';

/** Um vínculo que o Apex propõe (ou aplica). */
export interface EvidenceLinkPlan {
  readonly sourceType: EvidenceSourceType;
  readonly sourceId: string;
  readonly evidenceClass: EvidenceClass;
  readonly linkSource: EvidenceLinkSource;
  readonly confidence: number | null;
  /** `true` só quando a política autoriza gravar sem humano. */
  readonly autoLink: boolean;
  readonly decision: AutomationDecision;
  /**
   * A trilha. Vai para `provenance` na tabela, e é o que permite responder
   * "por que o Apex vinculou isto" meses depois.
   */
  readonly provenance: {
    readonly resolver: 'execution-matching';
    readonly reasonCodes: readonly string[];
    readonly timelineItemId: string | null;
    readonly matchStatus: string;
    readonly policyReasons: readonly string[];
  };
}

export interface AcquisitionResult {
  /** Vínculos que a política autoriza gravar sozinha. */
  readonly autoLinks: readonly EvidenceLinkPlan[];
  /** Sugestões — visíveis, e inertes até alguém confirmar. */
  readonly proposals: readonly EvidenceLinkPlan[];
  /** Descartados, com a razão. Contá-los é o que impede "sumiu sem dizer". */
  readonly rejected: readonly { sourceId: string; reason: string }[];
}

/**
 * Da fonte normalizada da camada de evidência para o vocabulário da tabela.
 *
 * `time_entry` e `project_document` mudam de nome entre as duas camadas; o mapa
 * existe para que a diferença fique num lugar só.
 */
const SOURCE_TYPE: Record<ExecutionEvidence['source'], EvidenceSourceType> = {
  time_entry: 'time_entry',
  work_session: 'work_session',
  attendance_punch: 'attendance_punch',
  daily_allowance: 'daily_allowance',
  project_document: 'project_file',
};

/**
 * Origens que AFIRMAM o projeto no próprio registro. Para elas o vínculo é
 * determinístico e não carrega confiança; para as demais, o servidor recusaria
 * `deterministic` de qualquer forma (a migration 131 checa a origem de novo).
 */
const DECLARES_PROJECT: ReadonlySet<EvidenceSourceType> =
  new Set<EvidenceSourceType>(['daily_allowance', 'time_entry', 'work_session', 'project_file', 'timeline_item']);

export interface AcquireInput {
  /** Evidência já normalizada pela camada existente. */
  readonly evidence: readonly ExecutionEvidence[];
  readonly context: MatchContext;
  /**
   * Etapa da medição, quando existe. Evidência casada com OUTRA etapa do mesmo
   * projeto não é descartada — ela ainda evidencia execução do projeto —, mas
   * entra como proposta, nunca como vínculo automático: a §24 separa progresso
   * observado de progresso autoritativo, e escolher a etapa por conta seria
   * decidir a segunda coisa.
   */
  readonly timelineItemId: string | null;
}

export function acquireEvidence(input: AcquireInput): AcquisitionResult {
  const autoLinks: EvidenceLinkPlan[] = [];
  const proposals: EvidenceLinkPlan[] = [];
  const rejected: { sourceId: string; reason: string }[] = [];

  for (const ev of input.evidence) {
    if (!ev.isValid) {
      rejected.push({ sourceId: ev.sourceRecordId, reason: 'SOURCE_INVALID' });
      continue;
    }

    const match: EvidenceMatch = matchEvidence(ev, input.context);

    // Evidência de outro projeto não entra de jeito nenhum. Não é rigor
    // decorativo: o servidor recusaria (`WRONG_PROJECT`), e propor um vínculo
    // que será recusado é ruído na fila de alguém.
    if (match.projectId !== null && match.projectId !== input.context.projectId) {
      rejected.push({ sourceId: ev.sourceRecordId, reason: 'WRONG_PROJECT' });
      continue;
    }

    const verdict = evaluateAutomation({ match, writeKind: 'evidence_link' });
    const sourceType = SOURCE_TYPE[ev.source];
    const declares = DECLARES_PROJECT.has(sourceType) && ev.projectId !== null;

    /*
      Origem que declara o projeto entra como vínculo DETERMINÍSTICO e sem
      confiança — não há "85% de certeza" quando o registro afirma o projeto.
      As demais entram como inferidas, carregando a confiança do resolvedor.
    */
    const linkSource: EvidenceLinkSource = declares ? 'deterministic' : 'system_inferred';

    const plan: EvidenceLinkPlan = {
      sourceType,
      sourceId: ev.sourceRecordId,
      // Nunca acima de DERIVED. Subir de classe é ato humano, e o banco recusa.
      evidenceClass: declares ? 'RAW_EVIDENCE' : 'DERIVED_EVIDENCE',
      linkSource,
      confidence: linkSource === 'system_inferred' ? verdict.confidence : null,
      autoLink: verdict.decision === 'AUTO_APPLY'
        // Etapa diferente da etapa da medição vira proposta, nunca vínculo
        // automático — ver o comentário de `timelineItemId` acima.
        && (input.timelineItemId === null || match.timelineItemId === input.timelineItemId),
      decision: verdict.decision,
      provenance: {
        resolver: 'execution-matching',
        reasonCodes: match.reasonCodes,
        timelineItemId: match.timelineItemId,
        matchStatus: match.status,
        policyReasons: verdict.reasons,
      },
    };

    if (verdict.decision === 'REJECT') {
      rejected.push({ sourceId: ev.sourceRecordId, reason: verdict.reasons[0] ?? 'REJECT' });
      continue;
    }

    if (plan.autoLink) autoLinks.push(plan);
    else proposals.push(plan);
  }

  return { autoLinks, proposals, rejected };
}

/**
 * Quantas fontes o Apex conseguiu aproveitar sozinho.
 *
 * Serve à mensagem de produto — "o Apex já juntou X evidências para esta
 * medição" — e serve para que a queda desse número seja notada. Sem medida, uma
 * regressão na aquisição automática aparece como gestor digitando de novo, o
 * que ninguém reporta como defeito.
 */
export function acquisitionRate(result: AcquisitionResult): number | null {
  const total = result.autoLinks.length + result.proposals.length + result.rejected.length;
  if (total === 0) return null;
  return result.autoLinks.length / total;
}
