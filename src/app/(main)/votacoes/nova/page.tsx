'use client';

import Link from 'next/link';
import { ArrowLeft, PlusCircle, Vote } from 'lucide-react';
import {
  HudButton,
  HudEmptyState,
  HudHeader,
  HudPageLayout,
  HudPanel,
} from '@/components/hud';
import { usePermissions } from '@/hooks/use-permissions';

export default function NewVotingPage() {
  const { hasPermission, loading } = usePermissions();
  const canCreateDeliberation = !loading && hasPermission('deliberations.create');

  return (
    <HudPageLayout>
      <HudHeader
        title="Criar Votação"
        subtitle="Fluxo seguro enquanto a persistência real de votações ainda não foi migrada."
        icon={<Vote className="h-5 w-5" />}
        breadcrumbs={[{ label: 'Votações', href: '/votacoes' }, { label: 'Criar' }]}
        actions={
          <Link href="/votacoes">
            <HudButton variant="secondary" leftIcon={<ArrowLeft className="h-4 w-4" />}>
              Voltar
            </HudButton>
          </Link>
        }
      />

      <HudPanel elevation={2}>
        <HudEmptyState
          icon="custom"
          customIcon={<PlusCircle className="h-8 w-8" />}
          title={canCreateDeliberation ? 'Criação de votação ainda não conectada' : 'Criação restrita'}
          description={
            canCreateDeliberation
              ? 'As tabelas reais de deliberações/votações ainda não foram migradas para Supabase. Use a Central de Deliberações para preparar uma solicitação sem salvar dados.'
              : loading
                ? 'Validando permissões do usuário.'
                : 'Criar votação requer a permissão deliberations.create.'
          }
          action={
            canCreateDeliberation
              ? {
                  label: 'Abrir Central de Deliberações',
                  variant: 'primary',
                  onClick: () => {
                    window.location.href = '/deliberacoes';
                  },
                }
              : undefined
          }
        />
      </HudPanel>
    </HudPageLayout>
  );
}
