/**
 * A RECONCILIAÇÃO marco contratual ↔ cronograma — server-only.
 *
 * Mora numa biblioteca, e não dentro de uma rota, porque tem DOIS chamadores:
 * a rota de proposta (ato deliberado de quem revisa) e a confirmação de
 * importação de cronograma (o momento em que as etapas passam a existir). Uma
 * rota importando o handler da outra funciona e é armadilha: o módulo da rota
 * carrega `runtime`, `dynamic` e o handler HTTP junto, e o dia em que alguém
 * mover um deles quebra o outro caminho sem aviso.
 *
 * Roda no SERVICE ROLE, depois que o chamador já decidiu a autorização — o
 * mesmo contrato de `platform/server-client.ts`.
 *
 * O teto continua sendo o da RPC: `system_proposed` / `proposed`, sempre. Esta
 * biblioteca não tem, e não pode ganhar, um caminho até `accepted`.
 *
 * ─── Por que ela agora CLASSIFICA em vez de só propor ──────────────────────
 *
 * A versão anterior devolvia quantos pares nasceram. Isso responde "o robô
 * trabalhou?", e a pergunta de quem acabou de importar um cronograma é outra:
 * "dos seis eventos contratuais deste projeto, quantos estão de pé?".
 *
 * Um marco que NÃO recebeu proposta é o resultado mais importante do lote —
 * é ele que revela o evento de R$ 803.233,98 sem lugar no cronograma. Contar
 * só o que nasceu esconderia exatamente esse caso, e o silêncio se leria como
 * sucesso. Por isso o relatório tem quatro baldes, e SEM CORRESPONDÊNCIA é um
 * deles.
 */
import { platformServiceClient } from '@/lib/platform/server-client';
import {
  proposeMappings,
  buildMatchContext,
  extractMilestoneSequence,
  type AcceptedAnchor, type MilestoneCandidate, type TimelineCandidate,
} from './milestone-timeline-matcher';
import type {
  EventLinkState, ReconciledMilestone, ProposalRunResult,
} from '@/lib/projects/contract-events';

/*
  O vocabulário do vínculo vem de `projects/contract-events.ts` — o mesmo que a
  visão 181, o cabeçalho do projeto e a linha derivada do Gantt usam. Declará-lo
  de novo aqui seria a primeira linha de um segundo vocabulário, e é assim que
  "sugerido" e "pendente" acabam significando coisas diferentes na mesma tela.
*/
export type {
  EventLinkState, ReconciledMilestone, ProposalRunResult,
} from '@/lib/projects/contract-events';

const EMPTY: ProposalRunResult = {
  evaluatedMilestones: 0, proposed: 0, quickReview: 0,
  requiresAttention: 0, skippedAlreadyGoverned: 0, timelineItems: 0,
  contractEvents: 0, synchronized: 0, suggested: 0, ambiguous: 0, unmatched: 0,
  anchorLost: 0,
  milestones: [],
};

/**
 * O lote, isolado da rota para que a importação de cronograma possa chamá-lo
 * direto — sem um `fetch` do servidor para o próprio servidor, que perderia o
 * contexto de autenticação e exigiria um segundo caminho de autorização.
 */
export async function proposeForProject(
  organizationId: string,
  projectId: string,
): Promise<ProposalRunResult> {
  const service = platformServiceClient();

  // Contratos ligados ao projeto, pela visão de vínculo GOVERNADO (175) —
  // nunca por semelhança de nome ou código.
  const { data: links } = await service
    .from('project_contract_link_governed')
    .select('contract_id')
    .eq('organization_id', organizationId)
    .eq('project_id', projectId);

  const contractIds = [...new Set((links ?? []).map((l) => l.contract_id as string))];
  if (contractIds.length === 0) return EMPTY;

  // As exigências de medição com marco — é a REGRA que se mapeia, e o marco
  // é quem carrega o direito em dinheiro.
  const { data: rules } = await service
    .from('contract_measurement_requirements')
    .select('id, contract_id, milestone_id')
    .eq('organization_id', organizationId)
    .in('contract_id', contractIds)
    .neq('effect', 'removed')
    .not('milestone_id', 'is', null);

  const ruleRows = (rules ?? []) as { id: string; contract_id: string; milestone_id: string }[];
  if (ruleRows.length === 0) return EMPTY;

  // Regras que já têm ponte ACEITA ficam de fora do lote — e entram no
  // relatório como SINCRONIZADAS, que é o que elas de fato são: a data nova
  // do cronograma já flui por elas sem ninguém tocar em nada.
  const { data: governed } = await service
    .from('contract_measurement_rule_timeline_governed')
    .select('rule_id, timeline_item_id')
    .eq('organization_id', organizationId)
    .in('rule_id', ruleRows.map((r) => r.id));
  const governedByRule = new Map(
    (governed ?? []).map((g) => [g.rule_id as string, g.timeline_item_id as string]),
  );

  /*
    ─── O QUE UM HUMANO JÁ RECUSOU ──────────────────────────────────────────

    A recusa vale para o PAR (regra, etapa) — não para a regra inteira.

    A versão anterior tirava do lote qualquer regra que tivesse uma rejeição, e
    com isso o marco caía em SEM VÍNCULO para sempre: rejeitar uma sugestão
    ruim apagava a chance de o sistema encontrar a boa na importação seguinte.
    Recusar "Evento 05 ↔ Montagem do Gerador" é dizer que AQUELA etapa não é o
    marco — não que nenhuma etapa seja.
  */
  const { data: rejected } = await service
    .from('contract_measurement_rule_timeline_mappings')
    .select('rule_id, timeline_item_id')
    .eq('organization_id', organizationId)
    .eq('project_id', projectId)
    .eq('review_state', 'rejected')
    .in('rule_id', ruleRows.map((r) => r.id));
  const rejectedPairs = new Set(
    (rejected ?? []).map((r) => `${r.rule_id as string}::${r.timeline_item_id as string}`),
  );

  const openRules = ruleRows.filter((r) => !governedByRule.has(r.id));

  const { data: milestones } = await service
    .from('contract_milestones')
    .select('id, title, description')
    .eq('organization_id', organizationId)
    .in('id', ruleRows.map((r) => r.milestone_id));
  const milestoneById = new Map(
    (milestones ?? []).map((m) => [m.id as string, m as { id: string; title: string; description: string | null }]),
  );

  const { data: items } = await service
    .from('project_timeline_items')
    .select('id, project_id, parent_id, title, wbs_code, outline_level, is_milestone, is_summary, planned_finish, forecast_finish')
    .eq('organization_id', organizationId)
    .eq('project_id', projectId)
    .eq('is_active', true)
    .is('deleted_at', null);

  const itemRows = (items ?? []) as {
    id: string; project_id: string; parent_id: string | null; title: string;
    wbs_code: string | null; outline_level: number; is_milestone: boolean;
    is_summary: boolean; planned_finish: string | null; forecast_finish: string | null;
  }[];
  const titleById = new Map(itemRows.map((i) => [i.id, i.title]));
  const activeItemIds = new Set(itemRows.map((i) => i.id));

  const candidates: TimelineCandidate[] = itemRows.map((i) => ({
    timelineItemId: i.id,
    projectId: i.project_id,
    title: i.title,
    wbsCode: i.wbs_code,
    outlineLevel: i.outline_level,
    isMilestone: i.is_milestone,
    isSummary: i.is_summary,
    plannedFinish: i.planned_finish,
    forecastFinish: i.forecast_finish,
    parentTitle: i.parent_id ? (titleById.get(i.parent_id) ?? null) : null,
  }));

  const milestoneCandidates: MilestoneCandidate[] = openRules.flatMap((rule) => {
    const m = milestoneById.get(rule.milestone_id);
    if (!m) return [];
    return [{
      milestoneId: m.id,
      ruleId: rule.id,
      contractId: rule.contract_id,
      title: m.title,
      description: m.description,
      // "Evento 03 — ..." é como os marcos de JA10182283/2025 nascem. A
      // numeração é indício fraco e o matcher a pondera como tal.
      sequence: extractMilestoneSequence(m.title),
    }];
  });

  /*
    ─── AS ÂNCORAS QUE JÁ EXISTEM ───────────────────────────────────────────

    Cada mapeamento ACEITO deste contrato prende um evento a uma data real do
    cronograma. Juntas, essas datas dizem onde os eventos vizinhos podem cair —
    e é por isso que o sistema fica mais preciso a cada aceite, em vez de
    recomeçar do zero a cada importação.

    Só entram âncoras com sequência E data: um evento sem número no título não
    tem posição na ordem contratual, e uma etapa sem data não delimita janela
    nenhuma.
  */
  const itemDateById = new Map(
    itemRows.map((i) => [i.id, i.forecast_finish ?? i.planned_finish]),
  );
  const anchors: AcceptedAnchor[] = ruleRows.flatMap((rule) => {
    const itemId = governedByRule.get(rule.id);
    const m = milestoneById.get(rule.milestone_id);
    if (!itemId || !m) return [];
    const sequence = extractMilestoneSequence(m.title);
    const date = itemDateById.get(itemId) ?? null;
    if (sequence === null || !date) return [];
    return [{ sequence, date }];
  });

  const context = buildMatchContext(candidates, anchors, rejectedPairs);
  const proposals = proposeMappings(milestoneCandidates, candidates, context);
  const proposalByRule = new Map(proposals.map((p) => [p.ruleId, p]));

  let persisted = 0;
  const keptMappingIds: string[] = [];
  for (const p of proposals) {
    const { data: mappingId, error } = await service.rpc('contract_billing_propose_timeline_mapping', {
      p_organization_id: organizationId,
      p_contract_id: p.contractId,
      p_rule_id: p.ruleId,
      p_project_id: p.projectId,
      p_timeline_item_id: p.timelineItemId,
      p_confidence: p.confidence,
      p_note: p.reasons.join(' · '),
      // O empate viaja junto: é ele que faz a tela pedir ESCOLHA em vez de
      // oferecer "aceitar". Sem esta linha, o ambíguo chega à revisão com a
      // mesma cara de um casamento solitário.
      p_ambiguous_with: p.ambiguousWith as string[],
    });
    if (error) {
      console.error('[billing/propose] proposta recusada:', error.message);
      continue;
    }
    if (typeof mappingId === 'string') keptMappingIds.push(mappingId);
    persisted += 1;
  }

  /*
    ─── O PALPITE VELHO SAI ─────────────────────────────────────────────────

    O matcher muda (melhora, ou o cronograma muda) e o mesmo marco passa a
    apontar para outra etapa. Sem esta faxina, a sugestão anterior fica na
    fila ao lado da nova, e a tela mostra o sistema discordando de si mesmo.

    A função só alcança `system_proposed` + `proposed` + sem revisor. Aceito,
    rejeitado e explícito carregam decisão humana e não têm WHERE que os
    alcance — é a própria assinatura da faxina que garante isso, não a boa
    intenção de quem a chama.
  */
  if (openRules.length > 0) {
    const { error } = await service.rpc('contract_billing_retire_superseded_proposals', {
      p_organization_id: organizationId,
      p_project_id: projectId,
      p_rule_ids: openRules.map((r) => r.id),
      p_keep_mapping_ids: keptMappingIds,
    });
    if (error) {
      // Faxina que falha não derruba a reconciliação: o pior caso é uma
      // sugestão velha visível a mais, não um dado perdido.
      console.error('[billing/propose] faxina de propostas superadas falhou:', error.message);
    }
  }

  /*
    O RELATÓRIO, montado sobre TODAS as regras — não só sobre as que entraram
    no lote. É a diferença entre "o robô propôs 4" e "dos 6 eventos deste
    contrato, 4 têm ponte e 2 não têm".
  */
  const reconciled: ReconciledMilestone[] = ruleRows.flatMap((rule) => {
    const m = milestoneById.get(rule.milestone_id);
    if (!m) return [];
    const accepted = governedByRule.get(rule.id) ?? null;
    const proposal = proposalByRule.get(rule.id);

    /*
      A etapa aceita ainda EXISTE no cronograma que acabou de chegar?

      `activeItemIds` vem da mesma consulta que alimenta o matcher, e ela só
      traz etapa viva. Um aceite que aponta para fora desse conjunto perdeu a
      âncora — e o relatório diz isso em vez de contá-lo como sincronizado.
      Nenhuma substituta é procurada: quem decidiu foi um humano, e é a ele
      que a pergunta volta.
    */
    const linkState: EventLinkState = accepted
      ? (activeItemIds.has(accepted) ? 'ACCEPTED' : 'ANCHOR_LOST')
      : proposal
        ? (proposal.ambiguousWith.length > 0 ? 'AMBIGUOUS' : 'PROPOSED')
        : 'UNMATCHED';

    return [{
      milestoneId: m.id,
      ruleId: rule.id,
      contractId: rule.contract_id,
      title: m.title,
      linkState,
      timelineItemId: accepted ?? proposal?.timelineItemId ?? null,
      confidence: proposal?.confidence ?? null,
      reasons: proposal?.reasons ?? [],
      ambiguousWith: proposal?.ambiguousWith ?? [],
    }];
  });

  const count = (state: EventLinkState) =>
    reconciled.filter((r) => r.linkState === state).length;

  return {
    evaluatedMilestones: milestoneCandidates.length,
    proposed: persisted,
    quickReview: proposals.filter((p) => p.priority === 'quick_review').length,
    requiresAttention: proposals.filter((p) => p.priority === 'requires_attention').length,
    skippedAlreadyGoverned: governedByRule.size,
    timelineItems: candidates.length,

    contractEvents: reconciled.length,
    synchronized: count('ACCEPTED'),
    suggested: count('PROPOSED'),
    ambiguous: count('AMBIGUOUS'),
    unmatched: count('UNMATCHED'),
    anchorLost: count('ANCHOR_LOST'),
    milestones: reconciled,
  };
}
