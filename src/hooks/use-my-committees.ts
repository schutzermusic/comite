'use client';

import { useEffect, useState } from 'react';
import { getMyCommitteeKeys } from '@/lib/services/committees';
import { mapDbCommitteeKeysToPolicyIds } from '@/lib/deliberations-policy';

/** Supabase configurado quando ambas as env vars públicas existem. */
const SUPABASE_CONFIGURED = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
);

type MyCommittees = {
  /** Keys da tabela `committees` (ex.: 'rh', 'financeiro'). */
  committeeKeys: string[];
  /** Ids de comitês de governança usados pelo módulo de deliberações. */
  policyCommitteeIds: string[];
  /** Usuário pertence a pelo menos um comitê. */
  hasAny: boolean;
  loading: boolean;
};

/**
 * Comitês do usuário autenticado, derivados de `committee_members`. Em modo
 * demonstração (sem Supabase) devolve vazio e `loading=false` — o gating de
 * acesso fica a cargo de quem consome.
 */
export function useMyCommittees(): MyCommittees {
  const [committeeKeys, setCommitteeKeys] = useState<string[]>([]);
  const [loading, setLoading] = useState(SUPABASE_CONFIGURED);

  useEffect(() => {
    // `loading` já inicia como SUPABASE_CONFIGURED, então não é preciso ajustá-lo
    // sincronamente aqui (evita setState no corpo do efeito).
    if (!SUPABASE_CONFIGURED) return;
    let cancelled = false;
    void getMyCommitteeKeys()
      .then((keys) => {
        if (!cancelled) setCommitteeKeys(keys);
      })
      .catch(() => {
        if (!cancelled) setCommitteeKeys([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return {
    committeeKeys,
    policyCommitteeIds: mapDbCommitteeKeysToPolicyIds(committeeKeys),
    hasAny: committeeKeys.length > 0,
    loading,
  };
}
