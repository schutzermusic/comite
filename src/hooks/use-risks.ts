'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  listRisks,
  createRisk as createRiskService,
  updateRisk as updateRiskService,
  deleteRisk as deleteRiskService,
  dismissAiRisk as dismissAiRiskService,
  type CreateRiskInput,
  type UpdateRiskInput,
} from '@/lib/services/risks';
import type { ExtendedRisk } from '@/components/risks/risk-types';

export function useRisks() {
  const [risks, setRisks] = useState<ExtendedRisk[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const rows = await listRisks();
      setRisks(rows);
      return rows;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erro ao carregar riscos.';
      setError(message);
      return [];
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const createRisk = useCallback(async (input: CreateRiskInput) => {
    const row = await createRiskService(input);
    setRisks((current) => [row, ...current]);
    return row;
  }, []);

  const updateRisk = useCallback(async (id: string, patch: UpdateRiskInput) => {
    const row = await updateRiskService(id, patch);
    setRisks((current) => current.map((r) => (r.id === id ? row : r)));
    return row;
  }, []);

  const deleteRisk = useCallback(async (id: string) => {
    await deleteRiskService(id);
    setRisks((current) => current.filter((r) => r.id !== id));
  }, []);

  const dismissAiRisk = useCallback(async (id: string, reason?: string) => {
    const row = await dismissAiRiskService(id, reason);
    if (row) {
      setRisks((current) => current.map((r) => (r.id === id ? row : r)));
    } else {
      setRisks((current) =>
        current.map((r) => (r.id === id ? { ...r, aiDismissed: true } : r)),
      );
    }
    return row;
  }, []);

  return {
    risks,
    loading,
    error,
    refresh,
    createRisk,
    updateRisk,
    deleteRisk,
    dismissAiRisk,
  };
}
