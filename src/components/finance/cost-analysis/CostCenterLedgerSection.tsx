'use client';

import React, { useMemo, useState } from 'react';
import { Building2, CalendarRange } from 'lucide-react';
import {
  HudCard, HudCardHeader, HudCardTitle, HudCardContent,
} from '@/components/hud';
import { FinanceFilterChip, FinanceFilterRange } from '@/components/finance/shared';
import { costCenters as costCenterSeed } from '@/data/finance/seed-categories';
import { generatePeriodOptions } from '@/components/finance/control-room/helpers';
import { LedgerCostBreakdown } from './LedgerCostBreakdown';

const PERIODS = generatePeriodOptions();
const CC_OPTIONS = costCenterSeed.map((c) => ({ value: c.id, label: `${c.code} — ${c.name}` }));

/**
 * Ledger-backed cost analytics for a single cost center, driven by the unified
 * finance ledger. Lives alongside the budget-vs-actual mock view on the Cost
 * Center page; it never duplicates that data source.
 */
export function CostCenterLedgerSection() {
  const [costCenterId, setCostCenterId] = useState(costCenterSeed[0]?.id ?? '');
  const [periodFrom, setPeriodFrom] = useState('2026-01');
  const [periodTo, setPeriodTo] = useState('2026-06');

  const filter = useMemo(
    () => ({ costCenterId, periodFrom, periodTo }),
    [costCenterId, periodFrom, periodTo],
  );

  return (
    <HudCard>
      <HudCardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <HudCardTitle>Custos do CC pelo ledger — categoria, subcategoria e projetos</HudCardTitle>
          <div className="flex flex-wrap items-center gap-2">
            <FinanceFilterChip icon={<Building2 className="h-3.5 w-3.5" />} label="CC" value={costCenterId}
              options={CC_OPTIONS} onChange={setCostCenterId} />
            <FinanceFilterRange
              icon={<CalendarRange className="h-3.5 w-3.5" />}
              label="Período"
              fromValue={periodFrom}
              toValue={periodTo}
              options={PERIODS}
              onChange={(from, to) => {
                setPeriodFrom(from);
                setPeriodTo(to);
              }}
            />
          </div>
        </div>
      </HudCardHeader>
      <HudCardContent className="p-3">
        <LedgerCostBreakdown filter={filter} variant="cost_center" />
      </HudCardContent>
    </HudCard>
  );
}
