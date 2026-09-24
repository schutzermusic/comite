'use client';

import { HudPageLayout } from '@/components/hud';
import { SuppliersDirectory } from '@/components/supply/procurement/SuppliersDirectory';

export default function SuppliersPage() {
  return (
    <HudPageLayout>
      <h1 className="sr-only">Supply Chain · Fornecedores</h1>
      <SuppliersDirectory />
    </HudPageLayout>
  );
}
