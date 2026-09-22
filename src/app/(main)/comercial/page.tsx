'use client';

import { Suspense, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Handshake } from 'lucide-react';
import { HudHeader, HudPageLayout, HudPanel, HudSignal } from '@/components/hud';
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

const AREA_HINT: Record<CommercialSectionId, string> = {
  overview: 'O funil em uma tela: o que está aberto, o que foi proposto e o que virou trabalho.',
  accounts: 'Quem é a contraparte e com quem se fala — o mesmo cadastro que o resto da plataforma usa.',
  opportunities: 'O que está em discussão, com quem, por quanto e até quando.',
  followups: 'O que foi combinado e ainda não aconteceu — no mesmo motor de cobrança do pós-venda.',
  proposals: 'Técnica e comercial, com revisões. Só a revisão ACEITA alimenta execução.',
  forecast: 'Pipeline ponderado. Não é receita, não é backlog e não vira contabilidade.',
};

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
      <HudHeader
        title={`Comercial · ${commercialSectionLabels[active]}`}
        subtitle={AREA_HINT[active]}
        icon={<Handshake className="h-5 w-5" aria-hidden />}
        breadcrumbs={[{ label: 'Comercial' }, { label: commercialSectionLabels[active] }]}
      />

      {/*
        A navegação canônica é a sidebar; esta tira existe para telas
        estreitas, onde a sidebar recolhe. Duas navegações visíveis ao mesmo
        tempo ensinariam que são coisas diferentes.
      */}
      <nav className="mt-4 flex flex-wrap gap-2 lg:hidden" aria-label="Áreas do comercial">
        {COMMERCIAL_SECTION_ORDER.map((id) => (
          <HudSignal
            key={id}
            size="sm"
            tone={id === active ? 'accent' : 'neutral'}
            active={id === active}
            onClick={() => setActive(id)}
            label={commercialSectionLabels[id]}
          />
        ))}
      </nav>

      <div className="mt-5 min-w-0" aria-live="polite">
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
