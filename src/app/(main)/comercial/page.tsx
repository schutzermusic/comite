'use client';

import { Suspense, useCallback } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { HudPageLayout, HudPanel } from '@/components/hud';
import {
  COMMERCIAL_SECTION_BY_SLUG, COMMERCIAL_SECTION_ORDER,
  commercialSectionHref, commercialSectionLabels, type CommercialSectionId,
} from '@/lib/commercial/navigation';
import { CommercialOverview } from '@/components/commercial/CommercialOverview';
import { CommercialAccounts } from '@/components/commercial/CommercialAccounts';
import { CommercialOpportunities } from '@/components/commercial/CommercialOpportunities';
import { CommercialFollowups } from '@/components/commercial/CommercialFollowups';
import { CommercialProposals } from '@/components/commercial/CommercialProposals';
import { CommercialForecast } from '@/components/commercial/CommercialForecast';

function CommercialPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const active: CommercialSectionId =
    COMMERCIAL_SECTION_BY_SLUG[searchParams.get('view') ?? ''] ?? 'overview';
  const setActive = useCallback(
    (next: CommercialSectionId) => router.push(commercialSectionHref(next), { scroll: false }),
    [router],
  );

  return (
    <HudPageLayout>
      {/*
        Um cabeçalho por tela. O título da área e o estado vivo dela ficam no
        topo de cada área (WorkspaceHeading); aqui só a identidade da página
        para leitores de tela e, em telas estreitas, as áreas — a sidebar
        recolhe e a navegação precisa continuar a um toque.
      */}
      <h1 className="sr-only">{`Comercial · ${commercialSectionLabels[active]}`}</h1>
      <nav className="crm-area-tabs lg:hidden" aria-label="Áreas do comercial">
        {COMMERCIAL_SECTION_ORDER.map((id) => (
          <Link
            key={id}
            href={commercialSectionHref(id)}
            scroll={false}
            aria-current={id === active ? 'page' : undefined}
          >
            {commercialSectionLabels[id]}
          </Link>
        ))}
      </nav>

      <div className="mt-3 lg:mt-0 min-w-0" aria-live="polite">
        {active === 'overview' && <CommercialOverview onNavigate={setActive} />}
        {active === 'accounts' && <CommercialAccounts />}
        {active === 'opportunities' && <CommercialOpportunities />}
        {active === 'followups' && <CommercialFollowups />}
        {active === 'proposals' && <CommercialProposals />}
        {active === 'forecast' && <CommercialForecast />}
      </div>
    </HudPageLayout>
  );
}

export default function CommercialPage() {
  return (
    <Suspense fallback={
      <HudPanel elevation={1} interactive={false}>
        <p className="text-ig-body-sm text-ig-fg-muted">Carregando o comercial…</p>
      </HudPanel>
    }>
      <CommercialPageInner />
    </Suspense>
  );
}
