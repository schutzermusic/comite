/**
 * A PRÓXIMA AÇÃO de uma OS — derivada do estado canônico, nunca gravada.
 *
 * A ordem das perguntas é a ordem dos portões do banco
 * (`internal_service_order_issue_gate`): primeiro a revisão humana do
 * conteúdo, depois a divergência bloqueante, depois a emissão, depois o
 * projeto. Uma tela que sugerisse "Emitir" com linha pendente levaria a
 * pessoa a esbarrar num portão que ela não entendeu.
 */
import type { ServiceOrderStatus } from '@/lib/commercial/types';
import type { ServiceOrderCounts } from './types';

export type NextActionCode =
  | 'REVIEW_CONTENT' | 'RESOLVE_BLOCKING' | 'REVIEW_WARNINGS' | 'ISSUE'
  | 'LINK_PROJECT' | 'IN_EXECUTION' | 'SUSPENDED' | 'NONE';

export type NextActionTone = 'danger' | 'warning' | 'accent' | 'success' | 'neutral';

export interface NextAction {
  code: NextActionCode;
  label: string;
  tone: NextActionTone;
  /** Entra na fila "O que precisa de decisão" da Visão Geral. */
  needsDecision: boolean;
}

export function serviceOrderNextAction(
  status: ServiceOrderStatus, projectId: string | null, counts: ServiceOrderCounts,
): NextAction {
  if (status === 'CANCELLED' || status === 'CLOSED') {
    return { code: 'NONE', label: 'Sem ação pendente', tone: 'neutral', needsDecision: false };
  }
  if (status === 'SUSPENDED') {
    return { code: 'SUSPENDED', label: 'Execução suspensa', tone: 'warning', needsDecision: true };
  }
  if (status === 'DRAFT' || status === 'PENDING_CONFIRMATION') {
    if (counts.unreviewedItems > 0) {
      return { code: 'REVIEW_CONTENT', tone: 'warning', needsDecision: true,
        label: `Revisar ${counts.unreviewedItems} linha${counts.unreviewedItems === 1 ? '' : 's'} lida${counts.unreviewedItems === 1 ? '' : 's'}` };
    }
    if (counts.blockingOpen > 0) {
      return { code: 'RESOLVE_BLOCKING', tone: 'danger', needsDecision: true,
        label: `Decidir ${counts.blockingOpen} divergência${counts.blockingOpen === 1 ? '' : 's'} bloqueante${counts.blockingOpen === 1 ? '' : 's'}` };
    }
    if (counts.openDivergences > 0) {
      return { code: 'REVIEW_WARNINGS', tone: 'warning', needsDecision: true,
        label: `Conferir ${counts.openDivergences} aviso${counts.openDivergences === 1 ? '' : 's'} e emitir` };
    }
    return { code: 'ISSUE', label: 'Emitir OS', tone: 'accent', needsDecision: true };
  }
  if (!projectId) {
    return { code: 'LINK_PROJECT', label: 'Criar ou vincular projeto', tone: 'accent', needsDecision: true };
  }
  return { code: 'IN_EXECUTION', label: 'Em execução no projeto', tone: 'success', needsDecision: false };
}

/** Pode emitir AGORA pelo caminho normal? (espelho do portão; o banco decide) */
export function canIssueNormally(status: ServiceOrderStatus, counts: ServiceOrderCounts): boolean {
  return (status === 'DRAFT' || status === 'PENDING_CONFIRMATION')
    && counts.unreviewedItems === 0 && counts.blockingOpen === 0;
}

/** A exceção só existe quando há bloqueio E o conteúdo já foi revisado. */
export function canIssueWithException(status: ServiceOrderStatus, counts: ServiceOrderCounts): boolean {
  return (status === 'DRAFT' || status === 'PENDING_CONFIRMATION')
    && counts.unreviewedItems === 0 && counts.blockingOpen > 0;
}
