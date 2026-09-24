'use client';

import { HudPageLayout } from '@/components/hud';
import { InventoryWorkspace } from '@/components/supply/inventory/InventoryWorkspace';

export default function InventoryPage() {
  return (
    <HudPageLayout>
      <h1 className="sr-only">Supply Chain · Estoque</h1>
      <InventoryWorkspace />
    </HudPageLayout>
  );
}
