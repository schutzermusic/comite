'use client';

import { useCallback, useEffect, useState } from 'react';
import type { ApexFollowupRow } from '@/lib/platform/followups/types';

/**
 * Os acompanhamentos ABERTOS da carteira inteira.
 *
 * Só os abertos: um acompanhamento concluído é histórico, e contá-lo na torre
 * de controle faria o número crescer para sempre — um contador que nunca baixa
 * deixa de ser sinal em duas semanas.
 *
 * `error` é estado de primeira classe e NÃO cai para lista vazia: a torre
 * mostra "—" quando a leitura falhou, e nunca um zero tranquilizador sobre uma
 * consulta quebrada.
 */
export function usePortfolioFollowups() {
  const [followups, setFollowups] = useState<ApexFollowupRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/platform/followups?open=1', { cache: 'no-store' });
      const body = await response.json();
      if (!response.ok || !body.ok) throw new Error(body.error ?? 'Falha ao carregar acompanhamentos.');
      setFollowups(body.followups as ApexFollowupRow[]);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao carregar acompanhamentos.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);
  return { followups, loading, error, refresh };
}
