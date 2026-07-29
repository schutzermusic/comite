'use client';

/**
 * Contexto do Portal de Ponto: carrega a jornada UMA vez para todas as
 * telas (Início, Histórico, Solicitações, Perfil), cuida da expiração de
 * sessão e desenha a casca do app.
 *
 * O botão central "Bater ponto" da navegação vive aqui: em qualquer tela
 * ele leva para o Início já com o fluxo de registro aberto, sem depender
 * de parâmetro de URL.
 */

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { LogOut } from 'lucide-react';
import { createClient } from '@/utils/supabase/client';
import { usePontoSession, type PontoSession } from '@/hooks/use-ponto-session';
import { useGeolocation, type GeolocationController } from '@/hooks/use-ponto-device';
import { EmployeeAppShell, MobileHeader } from './EmployeeAppShell';
import { PontoSkeleton, Spinner } from './primitives';

interface PontoContextValue {
  session: PontoSession;
  geo: GeolocationController;
  signOut: () => Promise<void>;
  /** Pedido de abrir o fluxo de registro vindo da navegação. */
  punchFlowRequested: boolean;
  requestPunchFlow: () => void;
  consumePunchFlowRequest: () => void;
}

const PontoContext = React.createContext<PontoContextValue | null>(null);

export function usePonto(): PontoContextValue {
  const value = React.useContext(PontoContext);
  if (!value) throw new Error('usePonto precisa estar dentro de <PontoSessionProvider>');
  return value;
}

function BootScreen() {
  return (
    <div
      data-ponto-theme
      data-ponto-canvas
      className="flex min-h-[100dvh] flex-col bg-ig-canvas px-5 pt-[max(1.5rem,env(safe-area-inset-top))]"
    >
      <div className="mx-auto w-full max-w-3xl space-y-4">
        <div className="flex items-center gap-3">
          <PontoSkeleton className="h-11 w-11 rounded-full" />
          <div className="flex-1 space-y-2">
            <PontoSkeleton className="h-3 w-24" />
            <PontoSkeleton className="h-5 w-44" />
          </div>
        </div>
        <PontoSkeleton className="h-[340px] w-full rounded-[var(--ig-radius-lg)]" />
        <PontoSkeleton className="h-32 w-full rounded-[var(--ig-radius-lg)]" />
        <p className="flex items-center justify-center gap-2 pt-2 text-ig-caption text-ig-fg-subtle">
          <Spinner className="h-3.5 w-3.5" /> Carregando sua jornada…
        </p>
      </div>
    </div>
  );
}

export function PontoSessionProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();

  const handleExpired = React.useCallback(() => {
    router.replace('/ponto/login');
  }, [router]);

  const session = usePontoSession(handleExpired);
  const geo = useGeolocation();
  const [punchFlowRequested, setPunchFlowRequested] = React.useState(false);

  const signOut = React.useCallback(async () => {
    await createClient().auth.signOut();
    router.replace('/ponto/login');
  }, [router]);

  const requestPunchFlow = React.useCallback(() => {
    setPunchFlowRequested(true);
    router.push('/ponto');
  }, [router]);

  const consumePunchFlowRequest = React.useCallback(() => setPunchFlowRequested(false), []);

  const value = React.useMemo<PontoContextValue>(
    () => ({ session, geo, signOut, punchFlowRequested, requestPunchFlow, consumePunchFlowRequest }),
    [session, geo, signOut, punchFlowRequested, requestPunchFlow, consumePunchFlowRequest],
  );

  if (session.loading) return <BootScreen />;

  const person = session.bootstrap?.person ?? null;
  const runningProject = session.bootstrap?.runningSession?.project_id ?? null;

  return (
    <PontoContext.Provider value={value}>
      <EmployeeAppShell
        online={session.online}
        pendingCount={session.pending.length}
        onPunchAction={requestPunchFlow}
        header={
          <MobileHeader
            fullName={person?.full_name ?? null}
            jobTitle={person?.job_title ?? null}
            worksite={runningProject}
            alerts={session.pending.length}
            right={
              <button
                type="button"
                onClick={() => void signOut()}
                className="flex min-h-[44px] items-center gap-1.5 rounded-[var(--ig-radius-md)] px-2 text-ig-caption text-ig-fg-subtle transition-colors hover:text-ig-fg-strong focus-visible:outline-none focus-visible:shadow-[var(--ig-focus-ring-outer)]"
              >
                <LogOut className="h-4 w-4" aria-hidden="true" />
                Sair
              </button>
            }
          />
        }
      >
        {children}
      </EmployeeAppShell>
    </PontoContext.Provider>
  );
}
