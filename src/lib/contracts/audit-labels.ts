/**
 * Rótulos humanos dos eventos de auditoria de contratos.
 *
 * Fonte única. Antes existiam DOIS mapas divergentes — um em
 * `components/contracts/cockpit/RecentActivity.tsx` (51 entradas) e uma cópia
 * privada, mais antiga, dentro da página do dossiê, que parava em
 * `contract.changes_requested`. O mesmo evento aparecia escrito de um jeito na
 * carteira e cru (`contract.reclassified`) no dossiê.
 *
 * O código técnico NÃO desaparece: ele continua disponível como metadado
 * secundário na linha expandida da timeline. O que muda é a hierarquia — o
 * rótulo de negócio é o texto primário, o código é a evidência.
 *
 * Regra de manutenção: toda ação passada a `logAuditEvent` em
 * `contract-service.ts` precisa de uma entrada aqui. `auditActionLabel` cai de
 * volta no próprio código quando não há rótulo, de modo que um evento novo
 * aparece feio, mas nunca some.
 */
export const AUDIT_ACTION_LABELS: Record<string, string> = {
  // Ciclo de vida do contrato
  'contract.created': 'Contrato criado',
  'contract.updated': 'Contrato atualizado',
  'contract.deleted': 'Contrato excluído',
  'contract.changes_requested': 'Ajustes solicitados',
  'contract.reclassified': 'Origem do contrato reclassificada',

  // Documentos
  'contract.file_uploaded': 'Arquivo anexado',
  'contract.document_uploaded': 'Documento enviado',
  'contract.document_approved': 'Documento aprovado',
  'contract.document_rejected': 'Documento rejeitado',
  'contract.document_status_changed': 'Situação de documento alterada',
  'contract.document_superseded': 'Documento substituído por nova versão',

  // Obrigações
  'contract.obligation_created': 'Obrigação criada',
  'contract.obligation_updated': 'Obrigação atualizada',
  'contract.obligation_completed': 'Obrigação concluída',

  // Faturamento e medição
  'contract.billing_event_created': 'Evento de faturamento criado',
  'contract.billing_event_updated': 'Evento de faturamento atualizado',
  'contract.billing_event_realized': 'Faturamento realizado',
  'contract.billing_created_from_milestone': 'Faturamento gerado a partir de marco',
  'contract.milestone_created': 'Marco de medição registrado',
  'contract.milestone_updated': 'Marco de medição atualizado',
  'contract.milestone_deleted': 'Marco de medição excluído',
  'contract.milestone_measured': 'Marco medido',

  // Vínculos
  'contract.linked_project': 'Projeto vinculado',
  'contract.unlinked_project': 'Projeto desvinculado',
  'contract.linked_risk': 'Risco vinculado',
  'contract.unlinked_risk': 'Risco desvinculado',
  'contract.project_created': 'Projeto criado a partir do contrato',
  'contract.agenda_task_created': 'Tarefa de agenda criada',

  // Cláusulas
  'contract.clause_created': 'Cláusula registrada',
  'contract.clause_updated': 'Cláusula atualizada',
  'contract.clause_deleted': 'Cláusula excluída',
  'contract.clause_reviewed': 'Cláusula revisada',
  'contract.clause_superseded': 'Cláusula substituída',
  'contract.clause_linked_risk': 'Cláusula vinculada a risco',
  'contract.clause_validated': 'Cláusula validada',
  'contract.clause_rejected': 'Proposta de cláusula rejeitada',
  'contract.penalty_created': 'Penalidade registrada',

  // Aditivos
  'contract.amendment_created': 'Aditivo registrado',
  'contract.amendment_updated': 'Aditivo atualizado',
  'contract.amendment_deleted': 'Aditivo excluído',
  'contract.amendment_clause_linked': 'Cláusula vinculada a aditivo',

  // Aprovações
  'contract.approval_submitted': 'Etapa de aprovação decidida',

  /*
    Histórico imutável: eventos já gravados no banco continuam existindo e
    continuam nomeados como foram gravados. A IA deixou de ser uma etapa que o
    usuário dispara, mas o registro de que ela foi disparada um dia é auditoria
    — não se reescreve.
  */
  'contract.ai_analysis_requested': 'Análise de IA solicitada',
};

/** Rótulo de negócio do evento; cai no código técnico quando não mapeado. */
export function auditActionLabel(action: string): string {
  return AUDIT_ACTION_LABELS[action] ?? action;
}

/** True quando o evento ainda não tem rótulo de negócio (renderiza cru). */
export function isUnlabeledAuditAction(action: string): boolean {
  return !(action in AUDIT_ACTION_LABELS);
}
