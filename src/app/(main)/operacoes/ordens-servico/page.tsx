'use client';

import { Suspense } from 'react';
import { HudPageLayout } from '@/components/hud';
import { ServiceOrdersList } from '@/components/operations/service-orders/ServiceOrdersList';

export default function ServiceOrdersPage() {
  return (
    <HudPageLayout>
      <h1 className="sr-only">Operações · Ordens de Serviço</h1>
      <Suspense fallback={null}>
        <ServiceOrdersList />
      </Suspense>
    </HudPageLayout>
  );
}
