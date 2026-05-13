'use client';

import { LockKeyhole } from 'lucide-react';
import { HudEmptyState, HudPanel } from '@/components/hud';

type AccessRestrictedStateProps = {
  title?: string;
  description?: string;
};

export function AccessRestrictedState({
  title = 'Access restricted',
  description = 'Seu perfil nao possui permissao para acessar esta area.',
}: AccessRestrictedStateProps) {
  return (
    <HudPanel elevation={3} className="mx-auto max-w-3xl">
      <HudEmptyState
        icon="custom"
        customIcon={<LockKeyhole className="h-8 w-8" />}
        title={title}
        description={description}
        action={{
          label: 'Voltar ao dashboard',
          variant: 'secondary',
          onClick: () => {
            window.location.href = '/dashboard';
          },
        }}
      />
    </HudPanel>
  );
}
