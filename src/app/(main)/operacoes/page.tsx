'use client';

import { HudPageLayout } from '@/components/hud';
import { OperationsOverview } from '@/components/operations/OperationsOverview';

export default function OperationsPage() {
  return (
    <HudPageLayout>
      <h1 className="sr-only">Operações · Visão geral</h1>
      <OperationsOverview />
    </HudPageLayout>
  );
}
