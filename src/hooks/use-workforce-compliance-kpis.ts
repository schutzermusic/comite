'use client';

import { useEffect, useMemo, useState } from 'react';
import { summarizeSst, type SstEvent, type SstWorker } from '@/lib/workforce/sst';
import type { SalaryHistoryResult } from '@/lib/workforce/salary-history';

/**
 * Os poucos indicadores de conformidade que o cockpit precisa mostrar sem
 * virar a tela de detalhe.
 *
 * Existe como hook próprio, e não dentro de `useEsocialOverview`, porque as
 * duas fontes têm permissões diferentes: SST responde a `people.view` e a série
 * salarial exige `people.view_salary`. Um usuário pode legitimamente ver uma e
 * não a outra, e nesse caso o indicador correspondente precisa ficar AUSENTE —
 * não zerado, e sem derrubar o resto do cockpit.
 */
export interface WorkforceComplianceKpis {
  /** CATs na competência corrente. `undefined` = sem fonte. */
  catsInMonth?: number;
  asoExpired?: number;
  asoExpiring?: number;
  workersWithoutAso?: number;
  /** Colaboradores comprovadamente há 12 meses ou mais no mesmo patamar. */
  withoutRaise12m?: number;
  loading: boolean;
}

/**
 * @param competence Competência corrente do cockpit ('AAAA-MM'), para recortar
 *   os CATs. A situação do ASO é sempre sobre hoje, e não sobre o mês.
 */
export function useWorkforceComplianceKpis(competence?: string): WorkforceComplianceKpis {
  const [sst, setSst] = useState<{ events: SstEvent[]; workers: SstWorker[] } | null>(null);
  const [salary, setSalary] = useState<SalaryHistoryResult | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    // `loading` já nasce true e nenhum estado é marcado antes do primeiro
    // await: setState síncrono no corpo do efeito dispara render em cascata.
    void (async () => {
      // As duas buscas falham em silêncio e por conta própria — sem permissão
      // de salário, os indicadores de SST continuam aparecendo, e vice-versa.
      const [sstRes, salaryRes] = await Promise.all([
        fetch('/api/workforce/esocial-sst', { cache: 'no-store' }).catch(() => null),
        fetch('/api/workforce/salary-history', { cache: 'no-store' }).catch(() => null),
      ]);
      if (cancelled) return;

      if (sstRes?.ok) {
        try {
          const json = (await sstRes.json()) as { ok: boolean; events?: SstEvent[]; workers?: SstWorker[] };
          if (json.ok && !cancelled) setSst({ events: json.events ?? [], workers: json.workers ?? [] });
        } catch { /* mantém ausente */ }
      }
      if (salaryRes?.ok) {
        try {
          const json = (await salaryRes.json()) as { ok: boolean; history?: SalaryHistoryResult };
          if (json.ok && json.history && !cancelled) setSalary(json.history);
        } catch { /* mantém ausente */ }
      }
      if (!cancelled) setLoading(false);
    })();

    return () => { cancelled = true; };
  }, []);

  return useMemo(() => {
    if (!sst) {
      return {
        withoutRaise12m: salary?.counts.withoutRaise12m,
        loading,
      };
    }

    const inPeriod = competence
      ? sst.events.filter((e) => e.competence === competence)
      : sst.events;
    const summary = summarizeSst(inPeriod, sst.events, sst.workers);

    return {
      catsInMonth: summary.catsInPeriod ?? undefined,
      asoExpired: summary.asoExpired ?? undefined,
      asoExpiring: summary.asoExpiring ?? undefined,
      workersWithoutAso: summary.workersWithoutAso ?? undefined,
      withoutRaise12m: salary?.counts.withoutRaise12m,
      loading,
    };
  }, [sst, salary, competence, loading]);
}
