import { PontoSessionProvider } from '@/components/ponto/PontoSessionProvider';

/**
 * Área autenticada do Portal de Ponto. O estado da jornada é carregado
 * uma única vez aqui e compartilhado por Início, Histórico, Solicitações
 * e Perfil — nenhuma tela repete a chamada de bootstrap.
 *
 * Renderização dinâmica: tudo depende da sessão do colaborador.
 */
export const dynamic = 'force-dynamic';

export default function PontoAppLayout({ children }: { children: React.ReactNode }) {
  return <PontoSessionProvider>{children}</PontoSessionProvider>;
}
