'use client';

import { HudPageLayout } from '@/components/hud';
import { SupplyOverview } from '@/components/supply/SupplyOverview';

export default function SupplyPage() {
  return (
    <HudPageLayout>
      <h1 className="sr-only">Supply Chain · Visão geral</h1>
      <SupplyOverview />
    </HudPageLayout>
  );
}
