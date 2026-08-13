'use client';

import React from 'react';
import Link from 'next/link';
import { Database, FileSpreadsheet, Landmark } from 'lucide-react';
import { HudButton } from '@/components/hud';

/**
 * Nenhuma competência apurada.
 *
 * Este estado existe porque o módulo deixou de ter dados de demonstração. Antes,
 * uma instalação sem nada importado exibia 847 funcionários e R$ 12,85 mi de
 * folha — números de seed, indistinguíveis dos reais depois de formatados. O
 * cockpit vazio é a leitura correta, e o que ele deve fazer é dizer exatamente
 * quais fontes o alimentam.
 */
export function WorkforceEmptyState({ canManageIntegrations }: { canManageIntegrations?: boolean }) {
  return (
    <div className="rounded-xl border border-ig-border-subtle bg-ig-panel p-8">
      <div className="mx-auto max-w-2xl space-y-6 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full border border-ig-border-subtle bg-ig-bg-raised">
          <Database className="h-5 w-5 text-ig-fg-subtle" aria-hidden />
        </div>

        <div className="space-y-2">
          <h2 className="text-lg font-semibold text-ig-fg-strong">Nenhuma competência apurada</h2>
          <p className="text-sm leading-relaxed text-ig-fg-muted">
            O cockpit mostra apenas dado apurado — não há série de demonstração por trás. Assim que
            uma das fontes abaixo alimentar uma competência, os indicadores aparecem sozinhos.
          </p>
        </div>

        <div className="grid gap-3 text-left sm:grid-cols-2">
          <SourceCard
            icon={<FileSpreadsheet className="h-4 w-4" aria-hidden />}
            title="Fechamento da Folha"
            description="Lote aprovado da competência: massa salarial e abertura por centro de custo."
            href="/workforce-cost/fechamento-folha"
            action="Importar folha"
          />
          <SourceCard
            icon={<Landmark className="h-4 w-4" aria-hidden />}
            title="eSocial"
            description="Pacote do eSocial Download: quadro, admissões, desligamentos, afastamentos e guias apuradas."
            href={canManageIntegrations ? '/configuracoes/integracoes' : undefined}
            action="Configurar integração"
          />
        </div>
      </div>
    </div>
  );
}

function SourceCard({
  icon,
  title,
  description,
  href,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  href?: string;
  action: string;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-[10px] border border-ig-border-subtle bg-ig-bg-raised p-4">
      <div className="flex items-center gap-2 text-ig-fg-strong">
        <span className="text-ig-accent">{icon}</span>
        <span className="text-sm font-semibold">{title}</span>
      </div>
      <p className="flex-1 text-xs leading-relaxed text-ig-fg-muted">{description}</p>
      {href && (
        <Link href={href} className="self-start">
          <HudButton variant="secondary" size="sm">
            {action}
          </HudButton>
        </Link>
      )}
    </div>
  );
}
