'use client';

import { HudPageLayout } from '@/components/hud';
import { MaterialPlanning } from '@/components/supply/MaterialPlanning';

export default function MaterialPlanningPage() {
  return (
    <HudPageLayout>
      <h1 className="sr-only">Supply Chain · Planejamento de Materiais</h1>
      <MaterialPlanning />
    </HudPageLayout>
  );
}
