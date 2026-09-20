'use client';

/**
 * A bancada de marcos da carteira, repartida por estágio operacional.
 *
 * Mesma leitura que `PortfolioBillingMilestones` já faz na área de
 * Faturamentos (`contract_milestone_workbench`) — e de propósito a mesma: o
 * gráfico da Visão Geral e a lista de Faturamentos não podem discordar sobre
 * em que estágio um marco está. O que muda é só a agregação.
 *
 * `error` é estado de primeira classe e NÃO cai para uma carteira vazia: um
 * backlog que não pôde ser lido e um backlog sem nenhum marco pedem mensagens
 * diferentes, e o gráfico desenha coisas diferentes para cada um.
 *
 * ─── Por que o resultado é CARIMBADO com o recorte que o produziu ──────────
 *
 * O estado guarda a chave do recorte junto com a resposta, e a leitura só é
 * devolvida quando a chave confere. Sem isso, trocar de recorte deixaria o
 * gráfico exibindo o backlog do recorte anterior como se fosse do novo — um
 * número verdadeiro sobre a carteira errada, que é pior que nenhum número. E
 * como a comparação acontece na renderização, nenhuma escrita de estado
 * precisa acontecer de forma síncrona dentro do efeito.
 */

import { useEffect, useState } from 'react';
import { listMilestoneWorkbenchForContracts } from '@/lib/contracts/measurement/milestone-workbench-service';
import { buildBillingBacklog, type BillingBacklog } from '@/lib/contracts/analytics/billing-backlog';

export type PortfolioBacklogState = {
  readonly backlog: BillingBacklog | null;
  readonly loading: boolean;
  readonly error: string | null;
};

const PENDING: PortfolioBacklogState = { backlog: null, loading: true, error: null };

/** Recorte vazio é um FATO apurado — zero marcos —, não uma leitura pendente. */
const EMPTY: PortfolioBacklogState = {
  backlog: buildBillingBacklog([]), loading: false, error: null,
};

type Stamped = { readonly key: string; readonly state: PortfolioBacklogState };

export function usePortfolioBacklog(
  contractIds: readonly string[],
  refreshKey: string | number = 0,
): PortfolioBacklogState {
  const idsKey = contractIds.join(',');
  const key = `${refreshKey}|${idsKey}`;
  const [result, setResult] = useState<Stamped | null>(null);

  useEffect(() => {
    if (!idsKey) return;
    let alive = true;
    listMilestoneWorkbenchForContracts(idsKey.split(','))
      .then((rows) => {
        if (alive) setResult({ key, state: { backlog: buildBillingBacklog(rows), loading: false, error: null } });
      })
      .catch((err: unknown) => {
        if (alive) {
          setResult({
            key,
            state: {
              backlog: null,
              loading: false,
              error: err instanceof Error ? err.message : 'Falha ao ler os marcos contratuais.',
            },
          });
        }
      });
    return () => { alive = false; };
  }, [idsKey, key]);

  if (!idsKey) return EMPTY;
  return result?.key === key ? result.state : PENDING;
}
