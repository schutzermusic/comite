'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  createContract,
  listContracts,
  softDeleteContract,
  type ContractRow,
  type CreateContractInput,
} from '@/lib/contracts/contract-service';

export function useContracts() {
  const [contracts, setContracts] = useState<ContractRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const rows = await listContracts();
      setContracts(rows);
      return rows;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erro ao carregar contratos.';
      setError(message);
      return [];
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const create = useCallback(async (input: CreateContractInput) => {
    const row = await createContract(input);
    setContracts((current) => [row, ...current]);
    return row;
  }, []);

  const remove = useCallback(async (contractId: string) => {
    await softDeleteContract(contractId);
    setContracts((current) => current.filter((contract) => contract.id !== contractId));
  }, []);

  return { contracts, loading, error, refresh, createContract: create, deleteContract: remove };
}
