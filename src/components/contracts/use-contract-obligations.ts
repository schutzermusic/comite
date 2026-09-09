'use client';

import { useCallback, useEffect, useState } from 'react';
import type { ContractObligationsAsOf } from '@/lib/contracts/obligations/types';

/**
 * As obrigações estruturadas de UM contrato.
 *
 * Extraído de `ContractStructuredObligations`, que já fazia esta busca dentro
 * do próprio componente. Duas superfícies passaram a precisar do mesmo dado —
 * Operação e Documentos, esta última para saber que exigência cada papel
 * satisfaz — e duplicar o fetch faria as duas divergirem na data de referência
 * e no tratamento de erro.
 *
 * `error` é estado de primeira classe e NÃO cai para a lista vazia: consulta
 * que falhou e contrato sem obrigação pedem mensagens diferentes.
 */
export function useContractObligations(contractId: string | null) {
  const [data, setData] = useState<ContractObligationsAsOf | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!contractId) { setData(null); setLoading(false); return; }
    setLoading(true);
    try {
      const response = await fetch(`/api/contracts/${contractId}/obligations`, { cache: 'no-store' });
      const body = await response.json();
      if (!response.ok || !body.ok) throw new Error(body.error ?? 'Falha ao carregar obrigações.');
      setData(body as ContractObligationsAsOf);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao carregar obrigações.');
    } finally {
      setLoading(false);
    }
  }, [contractId]);

  useEffect(() => { void refresh(); }, [refresh]);
  return { obligations: data, loading, error, refresh };
}
