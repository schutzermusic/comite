'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  listDeliberations,
  createDeliberation as createDeliberationService,
  updateDeliberation as updateDeliberationService,
  castVote as castVoteService,
  startVoting as startVotingService,
  closeVoting as closeVotingService,
  approveDeliberation as approveDeliberationService,
  rejectDeliberation as rejectDeliberationService,
  closeDeliberation as closeDeliberationService,
  withdrawDeliberation as withdrawDeliberationService,
  deleteDeliberation as deleteDeliberationService,
  type CreateDeliberationInput,
  type UpdateDeliberationInput,
  type CastVoteInput,
  type CloseVotingOutcome,
} from '@/lib/services/deliberations';
import type { DeliberationItem } from '@/lib/types';

export function useDeliberations() {
  const [deliberations, setDeliberations] = useState<DeliberationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const rows = await listDeliberations();
      setDeliberations(rows);
      return rows;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erro ao carregar deliberações.';
      setError(message);
      return [];
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const createDeliberation = useCallback(
    async (input: CreateDeliberationInput) => {
      const row = await createDeliberationService(input);
      await refresh();
      return row;
    },
    [refresh],
  );

  const updateDeliberation = useCallback(
    async (id: string, patch: UpdateDeliberationInput) => {
      const row = await updateDeliberationService(id, patch);
      await refresh();
      return row;
    },
    [refresh],
  );

  const castVote = useCallback(
    async (id: string, input: CastVoteInput) => {
      const record = await castVoteService(id, input);
      await refresh();
      return record;
    },
    [refresh],
  );

  const startVoting = useCallback(
    async (id: string) => {
      const row = await startVotingService(id);
      await refresh();
      return row;
    },
    [refresh],
  );

  const closeVoting = useCallback(
    async (id: string, outcome: CloseVotingOutcome) => {
      const row = await closeVotingService(id, outcome);
      await refresh();
      return row;
    },
    [refresh],
  );

  const approveDeliberation = useCallback(
    async (id: string, justification?: string) => {
      const row = await approveDeliberationService(id, justification);
      await refresh();
      return row;
    },
    [refresh],
  );

  const rejectDeliberation = useCallback(
    async (id: string, justification?: string) => {
      const row = await rejectDeliberationService(id, justification);
      await refresh();
      return row;
    },
    [refresh],
  );

  const closeDeliberation = useCallback(
    async (id: string, justification?: string) => {
      const row = await closeDeliberationService(id, justification);
      await refresh();
      return row;
    },
    [refresh],
  );

  const withdrawDeliberation = useCallback(
    async (id: string, justification?: string) => {
      const row = await withdrawDeliberationService(id, justification);
      await refresh();
      return row;
    },
    [refresh],
  );

  const deleteDeliberation = useCallback(
    async (id: string) => {
      await deleteDeliberationService(id);
      await refresh();
    },
    [refresh],
  );

  return {
    deliberations,
    loading,
    error,
    refresh,
    createDeliberation,
    updateDeliberation,
    castVote,
    startVoting,
    closeVoting,
    approveDeliberation,
    rejectDeliberation,
    closeDeliberation,
    withdrawDeliberation,
    deleteDeliberation,
  };
}
