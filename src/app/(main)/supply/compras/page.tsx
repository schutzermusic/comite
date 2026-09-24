'use client';

import { HudPageLayout } from '@/components/hud';
import { ProcurementWorkspace } from '@/components/supply/procurement/ProcurementWorkspace';

export default function ProcurementPage() {
  return (
    <HudPageLayout>
      <h1 className="sr-only">Supply Chain · Compras</h1>
      <ProcurementWorkspace />
    </HudPageLayout>
  );
}
