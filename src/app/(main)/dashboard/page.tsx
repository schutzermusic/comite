import type { Metadata } from 'next';
import { DashboardV2 } from '@/components/dashboard-v2/DashboardV2';

export const metadata: Metadata = { title: 'O que está acontecendo — Insight Apex' };

/**
 * DASHBOARD — "o que está acontecendo na empresa?".
 *
 * A visão da empresa inteira, da proposta ao caixa: onde o trabalho está
 * parado (fluxo do negócio), o que exige atenção agora e por quê (fila única
 * entre áreas, com a cadeia causal sob "Entender"), as decisões que aguardam
 * a pessoa (só a superfície — a caixa é Decisões), a saúde dos projetos e o
 * calendário dos próximos 30 dias. Tudo vem de /api/dashboard/overview, que
 * compõe os modelos de leitura canônicos dos domínios; o que a pessoa não lê
 * aparece "Restrito", nunca zero.
 */
export default function DashboardPage() {
  return <DashboardV2 />;
}
