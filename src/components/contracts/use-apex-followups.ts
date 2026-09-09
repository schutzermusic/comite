'use client';

import { useCallback, useEffect, useState } from 'react';
import type { ApexFollowupRow } from '@/lib/platform/followups/types';

/**
 * Acompanhamentos de um contrato.
 *
 * `error` é estado de primeira classe e NÃO cai para a lista vazia — mesma
 * regra do resto do módulo: uma consulta que falhou e um contrato sem
 * acompanhamento nenhum pedem mensagens diferentes.
 */
export function useApexFollowups(contractId: string | null) {
  const [followups, setFollowups] = useState<ApexFollowupRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!contractId) { setFollowups([]); setLoading(false); return; }
    setLoading(true);
    try {
      const response = await fetch(
        `/api/platform/followups?contractId=${encodeURIComponent(contractId)}`, { cache: 'no-store' });
      const body = await response.json();
      if (!response.ok || !body.ok) throw new Error(body.error ?? 'Falha ao carregar acompanhamentos.');
      setFollowups(body.followups as ApexFollowupRow[]);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao carregar acompanhamentos.');
    } finally {
      setLoading(false);
    }
  }, [contractId]);

  useEffect(() => { void refresh(); }, [refresh]);
  return { followups, loading, error, refresh };
}
