import type { Metadata } from 'next';
import { DecisionsWorkspace } from '@/components/decisions/DecisionsWorkspace';

export const metadata: Metadata = { title: 'Decisões — Insight Apex' };

/**
 * DECISÕES — "o que precisa de mim agora?". Rota de produção para toda
 * pessoa autenticada (não é tela de demonstração): a caixa, a equipe e as
 * concluídas vêm de /api/decisions, que lê a decisão canônica na hora.
 */
export default function DecisionsPage() {
  return <DecisionsWorkspace />;
}
