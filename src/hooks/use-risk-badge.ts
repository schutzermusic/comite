'use client';

import { useEffect, useState } from 'react';
import { getRiskBadgeCounts, type RiskBadgeCounts } from '@/lib/services/risks';

const EMPTY: RiskBadgeCounts = { critical: 0, aiAlerts: 0 };

/**
 * Lightweight risk counts for the sidebar badge. Fetches count-only queries so
 * it can run globally without pulling the full risk dataset. Pass `enabled`
 * false to skip the fetch entirely (e.g. when the user lacks `risks.view`).
 */
export function useRiskBadge(enabled = true): RiskBadgeCounts {
  const [counts, setCounts] = useState<RiskBadgeCounts>(EMPTY);

  useEffect(() => {
    if (!enabled) {
      setCounts(EMPTY);
      return;
    }
    let active = true;
    getRiskBadgeCounts()
      .then((next) => {
        if (active) setCounts(next);
      })
      .catch(() => {
        if (active) setCounts(EMPTY);
      });
    return () => {
      active = false;
    };
  }, [enabled]);

  return counts;
}
