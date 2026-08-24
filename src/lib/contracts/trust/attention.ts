/**
 * Central de atenção e ação recomendada — determinístico.
 *
 * Cada item nasce de um FATO apurado no `TrustedContract`. Nenhum sinal é
 * emitido a partir de estimativa, e nenhum impacto financeiro é afirmado
 * quando a fonte não o sustenta: a MD §12 pede "problema, impacto, responsável,
 * próxima ação", mas impacto inventado é pior do que impacto ausente.
 *
 * A ação recomendada também é determinística (MD §57 — não usar IA onde regra
 * resolve): a prioridade sai de uma ordem fixa de severidade, não de modelo.
 *
 * Sem React, sem I/O. Roda em Node.
 */

import { hasOfficialValue, isError, isMissing, type Official } from './trusted';
import type { TrustedContract } from './read-model';
import { renewalState, missingDocuments, obligationBreakdown, approvalStepOutcome } from './signals';

/**
 * Quatro níveis, e a distinção entre os dois do meio é a que importa.
 *
 * `warning` é operação: existe controle, e ele está apontando problema.
 * `setup`   é configuração: o controle NÃO EXISTE ainda — sem projeto
 *           vinculado, sem rota de alçada, sem obrigação mapeada. Misturar os
 *           dois faz um contrato recém-cadastrado parecer um contrato em
 *           dificuldade, e some com a fila real de quem opera.
 */
export type AttentionSeverity = 'critical' | 'warning' | 'setup' | 'info';

export const ATTENTION_SEVERITY_LABEL: Record<AttentionSeverity, string> = {
  critical: 'Crítico',
  warning: 'Atenção',
  setup: 'Configuração pendente',
  info: 'Informativo',
};

/** Ação que a interface pode disparar. Mapeia 1:1 com as operações do drawer. */
export type AttentionActionKey =
  | 'linkProject'
  | 'reviewApproval'
  | 'createObligation'
  | 'attachDocument'
  | 'createBilling'
  | 'openDocuments'
  | 'openBilling'
  | 'openObligations'
  | 'reviewClauseProposals';

export type AttentionItem = {
  readonly id: string;
  readonly severity: AttentionSeverity;
  /** O que está acontecendo. */
  readonly title: string;
  /** Por que importa, em linguagem de negócio. */
  readonly reason: string;
  /**
   * Impacto financeiro, SOMENTE quando dedutível do dado. `null` quando a base
   * não sustenta a afirmação — e a interface então omite a linha em vez de
   * escrever "impacto: —", que sugere que alguém tentou medir.
   */
  readonly exposure: Official<number> | null;
  /** Dimensão temporal, quando existe. */
  readonly age: string | null;
  /** Rótulo da próxima ação. */
  readonly actionLabel: string;
  readonly actionKey: AttentionActionKey;
  /** Ordem de desempate dentro da mesma severidade (menor = mais urgente). */
  readonly rank: number;
};

const DAY = 86_400_000;

function daysSince(iso: string | null | undefined, now: Date): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  return Math.floor((now.getTime() - t) / DAY);
}

/**
 * Itens que exigem atenção, do mais grave ao menos.
 *
 * Seções que FALHARAM na leitura geram um item próprio: um contrato cuja
 * governança não pôde ser lida é um problema operacional, não um contrato sem
 * problemas. Era exatamente esse silêncio que o P0.2 fechou na origem.
 */
export function attentionItems(contract: TrustedContract, now: Date = new Date()): AttentionItem[] {
  const items: AttentionItem[] = [];

  // ── Falhas de leitura vêm primeiro ───────────────────────────────────────
  const sections: { key: string; label: string; value: Official<unknown> }[] = [
    { key: 'billing', label: 'faturamento', value: contract.billingEvents },
    { key: 'obligations', label: 'obrigações', value: contract.obligations },
    { key: 'documents', label: 'documentos', value: contract.documents },
    { key: 'approvals', label: 'aprovações', value: contract.approvals },
  ];
  for (const section of sections) {
    if (isError(section.value)) {
      items.push({
        id: `error-${section.key}`,
        severity: 'critical',
        title: `Falha ao ler ${section.label}`,
        reason: 'A governança deste contrato não pôde ser verificada nesta seção.',
        exposure: null,
        age: null,
        actionLabel: 'Tentar novamente',
        actionKey: 'openObligations',
        rank: 0,
      });
    }
  }

  // ── Obrigações atrasadas ────────────────────────────────────────────────
  const obligations = obligationBreakdown(contract);
  if (hasOfficialValue(obligations) && obligations.value.overdue > 0) {
    const overdueRows = hasOfficialValue(contract.obligations)
      ? contract.obligations.value.filter((o) => o.status === 'overdue')
      : [];
    const oldest = overdueRows
      .map((o) => daysSince(o.due_date, now))
      .filter((d): d is number => d !== null)
      .sort((a, b) => b - a)[0];

    items.push({
      id: 'obligations-overdue',
      severity: 'critical',
      title: `${obligations.value.overdue} obrigação(ões) contratual(is) em atraso`,
      reason: 'Obrigação vencida sem evidência registrada bloqueia medição e aceite.',
      exposure: null,
      age: oldest != null ? `${oldest} dia(s) em atraso` : null,
      actionLabel: 'Ver obrigações',
      actionKey: 'openObligations',
      rank: 1,
    });
  }

  // ── Faturamento vencido ─────────────────────────────────────────────────
  if (hasOfficialValue(contract.billingEvents)) {
    const overdueBilling = contract.billingEvents.value.filter((event) => {
      const paid = Boolean(event.paid_at) || ['pago', 'paid', 'billed', 'realizado', 'realized', 'faturado'].includes((event.status ?? '').toLowerCase());
      if (paid || !event.due_date) return false;
      return new Date(event.due_date).getTime() < now.getTime();
    });

    if (overdueBilling.length > 0) {
      const total = overdueBilling.reduce((sum, e) => sum + Number(e.amount ?? 0), 0);
      const oldest = overdueBilling
        .map((e) => daysSince(e.due_date, now))
        .filter((d): d is number => d !== null)
        .sort((a, b) => b - a)[0];

      items.push({
        id: 'billing-overdue',
        severity: 'critical',
        title: `${overdueBilling.length} evento(s) de faturamento vencido(s)`,
        reason: 'Marco de faturamento vencido sem realização represa a conversão em caixa.',
        // Aqui o impacto É dedutível: é a soma dos eventos vencidos registrados.
        exposure: {
          trust: 'derived',
          value: total,
          derivation: {
            rule: 'soma dos eventos de faturamento vencidos e não realizados',
            from: ['contract_billing_events'],
          },
        },
        age: oldest != null ? `${oldest} dia(s) vencido` : null,
        actionLabel: 'Abrir faturamento',
        actionKey: 'openBilling',
        rank: 2,
      });
    }
  }

  // ── Documentos bloqueantes ──────────────────────────────────────────────
  const docs = missingDocuments(contract);
  if (hasOfficialValue(docs) && docs.value.length > 0) {
    items.push({
      id: 'documents-blocking',
      severity: 'warning',
      title: `${docs.value.length} documento(s) faltante(s), vencido(s) ou rejeitado(s)`,
      reason: `Pendências: ${docs.value.slice(0, 3).join(', ')}${docs.value.length > 3 ? '…' : ''}.`,
      exposure: null,
      age: null,
      actionLabel: 'Abrir documentos',
      actionKey: 'openDocuments',
      rank: 3,
    });
  }

  // ── Aprovações pendentes ────────────────────────────────────────────────
  if (hasOfficialValue(contract.approvals) && contract.approvals.value.length > 0) {
    const pending = contract.approvals.value.filter((a) => a.status !== 'approved');
    const rejected = pending.filter((a) => a.status === 'rejected');

    if (rejected.length > 0) {
      items.push({
        id: 'approvals-rejected',
        severity: 'critical',
        title: `${rejected.length} etapa(s) de aprovação rejeitada(s)`,
        reason: 'Etapa rejeitada interrompe o fluxo até que os ajustes sejam tratados.',
        exposure: null,
        age: null,
        actionLabel: 'Revisar aprovação',
        actionKey: 'reviewApproval',
        rank: 1,
      });
    } else if (pending.length > 0) {
      const oldest = pending
        .map((a) => daysSince(a.started_at ?? a.created_at, now))
        .filter((d): d is number => d !== null)
        .sort((a, b) => b - a)[0];

      items.push({
        id: 'approvals-pending',
        severity: 'warning',
        title: `${pending.length} etapa(s) de aprovação em aberto`,
        reason: 'O contrato não avança enquanto a alçada não decidir.',
        exposure: null,
        age: oldest != null ? `há ${oldest} dia(s)` : null,
        actionLabel: 'Revisar aprovação',
        actionKey: 'reviewApproval',
        rank: 4,
      });
    }
  }

  // ── Vínculo de projeto ──────────────────────────────────────────────────
  if (!hasOfficialValue(contract.project) && !isError(contract.project)) {
    items.push({
      id: 'project-missing',
      severity: 'setup',
      title: 'Contrato sem projeto vinculado',
      reason: 'Sem vínculo operacional, o contrato fica fora da visão consolidada de portfólio e da rastreabilidade financeira.',
      exposure: null,
      age: null,
      actionLabel: 'Vincular projeto',
      actionKey: 'linkProject',
      rank: 5,
    });
  }

  // ── Renovação ───────────────────────────────────────────────────────────
  const renewal = renewalState(contract);
  if (hasOfficialValue(renewal) && (renewal.value === 'expired' || renewal.value === 'critical')) {
    const days = hasOfficialValue(contract.daysUntilExpiration) ? contract.daysUntilExpiration.value : null;
    items.push({
      id: 'renewal-window',
      severity: renewal.value === 'expired' ? 'critical' : 'warning',
      title: renewal.value === 'expired' ? 'Contrato vencido' : 'Vencimento em até 30 dias',
      reason: 'A janela de decisão de renovação exige tratativa antes do término da vigência.',
      exposure: null,
      age: days != null ? (days < 0 ? `${Math.abs(days)} dia(s) vencido` : `${days} dia(s) restantes`) : null,
      actionLabel: 'Abrir dossiê',
      actionKey: 'openObligations',
      rank: 2,
    });
  }

  // ── Exposição não apurável ──────────────────────────────────────────────
  if (isMissing(contract.billedValue) && contract.billedValue.reason === 'no-rows') {
    items.push({
      id: 'billing-unmeasured',
      severity: 'setup',
      title: 'Exposição faturada não apurada',
      reason: 'Não há evento de faturamento registrado, então o quanto já foi faturado não pode ser afirmado.',
      exposure: null,
      age: null,
      actionLabel: 'Criar evento',
      actionKey: 'createBilling',
      rank: 6,
    });
  }

  // ── Propostas de IA aguardando decisão ──────────────────────────────────
  //
  // `info`, não `warning`: nada está falhando. Mas precisa aparecer, porque
  // uma proposta parada é uma leitura que ninguém conferiu — e ela não vale
  // nada enquanto isso.
  if (hasOfficialValue(contract.clauses)) {
    const pending = contract.clauses.value.filter(
      (c) => c.ai_flagged && (c.review_status === 'draft' || c.review_status === 'in_review'),
    );
    if (pending.length > 0) {
      items.push({
        id: 'clauses-ai-pending',
        severity: 'info',
        title: `${pending.length} cláusula(s) propostas por análise documental`,
        reason: 'Proposta de IA não é cláusula: só passa a valer depois que uma pessoa valida o que foi lido no documento.',
        exposure: null,
        age: null,
        actionLabel: 'Revisar propostas',
        actionKey: 'reviewClauseProposals',
        rank: 11,
      });
    }
  }

  // ── Análise documental que falhou ───────────────────────────────────────
  //
  // `warning`: não é a operação do contrato que está mal, é a leitura que não
  // aconteceu — e um documento que parece analisado sem ter sido é pior do
  // que um documento não analisado.
  if (hasOfficialValue(contract.aiAnalyses)) {
    const failed = contract.aiAnalyses.value.filter((a) => a.status === 'failed');
    if (failed.length > 0) {
      items.push({
        id: 'clause-analysis-failed',
        severity: 'warning',
        title: `${failed.length} análise(s) documental(is) falharam`,
        reason: failed[0].error_message
          ? `Último erro: ${failed[0].error_message}`
          : 'A leitura do documento não pôde ser concluída. Nenhuma cláusula foi proposta a partir dele.',
        exposure: null,
        age: null,
        actionLabel: 'Revisar propostas',
        actionKey: 'reviewClauseProposals',
        rank: 6,
      });
    }

    // Documentos vigentes que nunca foram lidos: lacuna de cobertura, não falha.
    if (hasOfficialValue(contract.documents)) {
      const analyzed = new Set(
        contract.aiAnalyses.value
          .filter((a) => a.status === 'completed' && a.document_id)
          .map((a) => a.document_id as string),
      );
      const pendingDocs = contract.documents.value.filter(
        (d) => d.superseded_by_document_id === null && !analyzed.has(d.id),
      );
      if (pendingDocs.length > 0 && contract.documents.value.length > 0) {
        items.push({
          id: 'documents-not-analyzed',
          severity: 'setup',
          title: `${pendingDocs.length} documento(s) sem análise de cláusulas`,
          reason: 'Sem leitura do documento, a ausência de cláusula registrada não significa ausência de cláusula no contrato.',
          exposure: null,
          age: null,
          actionLabel: 'Analisar documentos',
          actionKey: 'reviewClauseProposals',
          rank: 12,
        });
      }
    }
  }

  // ── Controles que ainda não existem ─────────────────────────────────────
  //
  // Todos abaixo são `setup`: nada está falhando, falta instalar o controle.

  if (hasOfficialValue(contract.approvals) && contract.approvals.value.length === 0) {
    items.push({
      id: 'approvals-no-route',
      severity: 'setup',
      title: 'Sem rota de alçada',
      reason: 'Nenhuma etapa de aprovação registrada: não há como afirmar que este contrato passou por aprovação.',
      exposure: null,
      age: null,
      actionLabel: 'Revisar aprovação',
      actionKey: 'reviewApproval',
      rank: 7,
    });
  }

  if (hasOfficialValue(obligations) && obligations.value.total === 0) {
    items.push({
      id: 'obligations-unmapped',
      severity: 'setup',
      title: 'Nenhuma obrigação mapeada',
      reason: 'Sem obrigação registrada, não há o que acompanhar — e a ausência de atraso não significa cumprimento.',
      exposure: null,
      age: null,
      actionLabel: 'Criar obrigação',
      actionKey: 'createObligation',
      rank: 8,
    });
  }

  if (hasOfficialValue(contract.documents) && contract.documents.value.length === 0) {
    items.push({
      id: 'documents-none',
      severity: 'setup',
      title: 'Nenhum documento registrado',
      reason: 'O repositório documental do contrato está vazio: não há evidência de assinatura, garantia ou aditivo.',
      exposure: null,
      age: null,
      actionLabel: 'Anexar documento',
      actionKey: 'attachDocument',
      rank: 9,
    });
  }

  // Vigência é a base de toda janela de renovação; sem ela o contrato some do
  // horizonte em vez de aparecer como pendência.
  if (isMissing(contract.endDate) && isMissing(contract.daysUntilExpiration)) {
    items.push({
      id: 'term-missing',
      severity: 'setup',
      title: 'Vigência não registrada',
      reason: 'Sem data de término nem data de renovação, o contrato não entra em nenhuma janela de decisão.',
      exposure: null,
      age: null,
      actionLabel: 'Abrir dossiê',
      actionKey: 'openObligations',
      rank: 10,
    });
  }

  const order: Record<AttentionSeverity, number> = { critical: 0, warning: 1, setup: 2, info: 3 };
  return items.sort((a, b) => order[a.severity] - order[b.severity] || a.rank - b.rank);
}

// ═══════════════════════════════════════════════════════════════════════════
// Ação recomendada
// ═══════════════════════════════════════════════════════════════════════════

export type RecommendedAction = {
  readonly key: AttentionActionKey;
  readonly label: string;
  readonly title: string;
  readonly reason: string;
  readonly severity: AttentionSeverity;
};

/**
 * A ação primária do contrato, derivada do item mais grave.
 *
 * É deliberadamente uma REGRA e não um modelo: a MD §12 pede que o sistema diga
 * "o que fazer a seguir", e para as situações que o dado sustenta — sem
 * projeto, aprovação parada, faturamento vencido — a resposta é determinística
 * e auditável. Nada aqui precisa de IA.
 *
 * `null` quando não há nada exigindo atenção: um contrato saudável não deve
 * inventar uma tarefa para o usuário.
 */
export function recommendedAction(
  contract: TrustedContract,
  now: Date = new Date(),
): RecommendedAction | null {
  const [first] = attentionItems(contract, now);
  if (!first) return null;
  return {
    key: first.actionKey,
    label: first.actionLabel,
    title: first.title,
    reason: first.reason,
    severity: first.severity,
  };
}
