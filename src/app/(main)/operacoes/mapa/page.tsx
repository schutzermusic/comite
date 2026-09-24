'use client';

import { HudPageLayout } from '@/components/hud';
import { OperationsMap } from '@/components/operations/map/OperationsMap';

export default function OperationsMapPage() {
  return (
    <HudPageLayout maxWidth="full">
      <h1 className="sr-only">Operações · Mapa de Operações</h1>
      <OperationsMap />
    </HudPageLayout>
  );
}
