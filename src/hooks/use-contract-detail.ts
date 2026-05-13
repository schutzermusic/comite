'use client';

import { useCallback, useEffect, useState } from 'react';
import { getContractById, type ContractDetail } from '@/lib/contracts/contract-service';

export function useContractDetail(contractId: string | null | undefined) {
  const [detail, setDetail] = useState<ContractDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!contractId) {
      setDetail(null);
      setLoading(false);
      return null;
    }

    setLoading(true);
    setError(null);
    try {
      const next = await getContractById(contractId);
      setDetail(next);
      return next;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erro ao carregar contrato.';
      setError(message);
      return null;
    } finally {
      setLoading(false);
    }
  }, [contractId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { detail, loading, error, refresh };
}
