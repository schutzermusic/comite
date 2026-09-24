'use client';

import { HudPageLayout } from '@/components/hud';
import { ReceivingWorkspace } from '@/components/supply/receiving/ReceivingWorkspace';

export default function ReceivingPage() {
  return (
    <HudPageLayout>
      <h1 className="sr-only">Supply Chain · Recebimentos & Logística</h1>
      <ReceivingWorkspace />
    </HudPageLayout>
  );
}
