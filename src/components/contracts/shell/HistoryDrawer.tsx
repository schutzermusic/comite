'use client';

/**
 * Histórico como GAVETA contextual, não como coluna permanente.
 *
 * O dossiê mostrava a mesma auditoria em dois lugares ao mesmo tempo: a aba
 * "Auditoria" e um painel "Timeline auditável" fixo à direita, que consumia
 * 360px de largura em toda sessão — inclusive quando o usuário estava
 * conferindo faturamento e não tinha pedido histórico nenhum.
 *
 * Aqui o histórico é sob demanda: a área de trabalho recupera a largura inteira,
 * e a auditoria continua a um clique, completa (sem `slice(0, 8)`) em vez de
 * espremida.
 *
 * Nada do backend muda: as linhas são as mesmas de `listContractAuditEvents` /
 * `listPortfolioAuditEvents`, lidas como sempre foram.
 */

import { HudDrawer } from '@/components/hud';
import type { ContractAuditEventRow } from '@/lib/contracts/contract-service';
import { AuditTimeline } from './AuditTimeline';

export interface HistoryDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  /** Contrato ou carteira — só muda o subtítulo. */
  subject: string;
  rows: ContractAuditEventRow[];
  error?: string | null;
  codeById?: Map<string, string>;
}

export function HistoryDrawer({
  isOpen,
  onClose,
  subject,
  rows,
  error,
  codeById,
}: HistoryDrawerProps) {
  return (
    <HudDrawer
      isOpen={isOpen}
      onClose={onClose}
      title="Histórico"
      subtitle={error ? subject : `${subject} · ${rows.length} evento(s)`}
      width="480px"
    >
      <div data-testid="contract-history-drawer">
        <AuditTimeline rows={rows} error={error} codeById={codeById} />
      </div>
    </HudDrawer>
  );
}
