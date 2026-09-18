'use client';

/**
 * A bancada de marcos de um contrato, carregada uma vez por contrato.
 *
 * `refresh` existe para depois de um ato de escrita do dossiê (criar marco,
 * gerar faturamento): o quadro relê a bancada inteira em vez de remendar a
 * linha em memória. Remendar produziria uma tela onde o marco mudou e a esteira
 * acima dele não — dois instantes do mesmo contrato, que é exatamente o que a
 * visão única foi criada para impedir.
 */

import { useCallback, useEffect, useState } from 'react';
import { listMilestoneWorkbench } from '@/lib/contracts/measurement/milestone-workbench-service';
import type { MilestoneWorkbenchRow } from '@/lib/contracts/measurement/milestone-workbench-types';

export interface MilestoneWorkbenchState {
  readonly rows: readonly MilestoneWorkbenchRow[];
  readonly loading: boolean;
  /** Falha de LEITURA. Distinta de "leu e não havia marcos" (`rows` vazio). */
  readonly error: string | null;
  readonly refresh: () => Promise<void>;
}

export function useMilestoneWorkbench(contractId: string): MilestoneWorkbenchState {
  const [rows, setRows] = useState<readonly MilestoneWorkbenchRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      setRows(await listMilestoneWorkbench(contractId));
    } catch (e) {
      // Uma lista vazia aqui se leria como "este contrato não tem marcos", que
      // é uma afirmação sobre o contrato. A falha é sobre a LEITURA.
      setError(e instanceof Error ? e.message : 'Falha ao carregar os marcos do contrato.');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [contractId]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    void (async () => { await load(); if (!active) return; })();
    return () => { active = false; };
  }, [load]);

  return { rows, loading, error, refresh: load };
}
