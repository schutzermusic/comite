'use client';

import { use } from 'react';
import { HudPageLayout } from '@/components/hud';
import { ServiceOrderWorkspace } from '@/components/operations/service-orders/ServiceOrderWorkspace';

export default function ServiceOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <HudPageLayout>
      <h1 className="sr-only">Operações · Ordem de Serviço</h1>
      <ServiceOrderWorkspace id={id} />
    </HudPageLayout>
  );
}
