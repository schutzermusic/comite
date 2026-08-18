/**
 * Portão do módulo Fiscal.
 *
 * Com `fiscal` desligado no registry de módulos, nenhuma página abaixo desta
 * pasta chega a renderizar: o layout devolve um aviso no lugar. Isso cobre o
 * acesso DIRETO por URL — a sidebar já esconde os itens, mas link colado,
 * favorito antigo e histórico do navegador continuam existindo.
 *
 * É um portão de INTERFACE, não de segurança. A proteção real das rotas de API
 * fiscais continua sendo RBAC + RLS no servidor; aqui o objetivo é não mostrar
 * uma tela que consultaria tabelas ainda não criadas em produção.
 *
 * Server Component de propósito: a checagem acontece antes de qualquer código
 * de página ser enviado ao cliente, e um layout resolve as seis rotas sem
 * tocar em nenhum arquivo de página.
 */

import { Hammer } from 'lucide-react';

import { HudEmptyState, HudHeader, HudPageLayout } from '@/components/hud';
import { isModuleEnabled } from '@/lib/modules/registry';

export default function FiscalLayout({ children }: { children: React.ReactNode }) {
  if (isModuleEnabled('fiscal')) return <>{children}</>;

  return (
    <HudPageLayout maxWidth="lg">
      <HudHeader
        title="Fiscal"
        subtitle="Módulo em implantação"
        icon={<Hammer className="h-5 w-5" />}
        breadcrumbs={[{ label: 'Fiscal' }]}
      />
      <HudEmptyState
        title="Módulo em implantação"
        description="A emissão de NFS-e ainda não foi liberada nesta instalação. O módulo será habilitado após a homologação do provedor fiscal e a configuração das credenciais oficiais."
      />
    </HudPageLayout>
  );
}
