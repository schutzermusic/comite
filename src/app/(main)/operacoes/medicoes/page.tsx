'use client';

import { HudPageLayout } from '@/components/hud';
import { MeasurementsQueue } from '@/components/operations/MeasurementsQueue';

export default function OperationsMeasurementsPage() {
  return (
    <HudPageLayout>
      <h1 className="sr-only">Operações · Medições & Evidências</h1>
      <MeasurementsQueue />
    </HudPageLayout>
  );
}
