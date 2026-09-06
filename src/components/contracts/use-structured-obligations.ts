'use client';

import { useCallback, useEffect, useState } from 'react';
import type { ObligationPortfolio } from '@/lib/contracts/obligations/portfolio';

const EMPTY: ObligationPortfolio = {
  rows: [],
  counts: { OVERDUE: 0, DUE: 0, UPCOMING: 0, UNKNOWN: 0, NOT_APPLICABLE: 0 },
  billingUnknownContracts: [],
  billingBlockedContracts: [],
  contractsWithoutObligations: [],
  asOf: '',
};

/**
 * A carteira de obrigações estruturadas.
 *
 * `error` é estado de primeira classe e NÃO cai para a carteira vazia: uma
 * consulta que falhou e uma carteira sem obrigação nenhuma pedem mensagens
 * diferentes, e confundi-las já custou caro neste módulo.
 */
export function useStructuredObligations(asOf?: string) {
  const [portfolio, setPortfolio] = useState<ObligationPortfolio>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const query = asOf ? `?asOf=${encodeURIComponent(asOf)}` : '';
      const response = await fetch(`/api/contracts/obligations/portfolio${query}`, { cache: 'no-store' });
      const body = await response.json();
      if (!response.ok || !body.ok) throw new Error(body.error ?? 'Falha ao carregar obrigações.');
      setPortfolio(body.portfolio as ObligationPortfolio);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao carregar obrigações.');
    } finally {
      setLoading(false);
    }
  }, [asOf]);

  useEffect(() => { void refresh(); }, [refresh]);
  return { portfolio, loading, error, refresh };
}
