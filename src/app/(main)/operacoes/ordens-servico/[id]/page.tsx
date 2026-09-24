'use client';

import { use } from 'react';
import { ServiceOrderWorkspace } from '@/components/operations/service-orders/ServiceOrderWorkspace';

export default function ServiceOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <ServiceOrderWorkspace id={id} />;
}
