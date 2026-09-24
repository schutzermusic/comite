'use client';

import { HudPageLayout } from '@/components/hud';
import { PlanningPortfolio } from '@/components/operations/planning/PlanningPortfolio';

export default function PlanningPage() {
  return (
    <HudPageLayout>
      <h1 className="sr-only">Operações · Planejamento</h1>
      <PlanningPortfolio />
    </HudPageLayout>
  );
}
