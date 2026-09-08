'use client';

import { usePathname } from 'next/navigation';
import { DatabaseZap } from 'lucide-react';
import { HudEmptyState, HudPageLayout, HudPanel } from '@/components/hud';
import { isMockOnlyRoute } from '@/lib/demo/production-truth-routes';

export function ProductionTruthBoundary({
  isDemoOrganization,
  children,
}: {
  isDemoOrganization: boolean;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  if (isDemoOrganization || !isMockOnlyRoute(pathname)) return children;

  return (
    <HudPageLayout>
      <HudPanel data-testid="production-truth-empty-state">
        <HudEmptyState
          icon="custom"
          customIcon={<DatabaseZap className="h-12 w-12" />}
          title="Nenhum dado operacional nesta organização"
          description="Este módulo ainda usa uma experiência demonstrativa no ambiente demo. Em organizações de produção, ele permanece vazio até receber uma fonte canônica do próprio tenant."
        />
      </HudPanel>
    </HudPageLayout>
  );
}
