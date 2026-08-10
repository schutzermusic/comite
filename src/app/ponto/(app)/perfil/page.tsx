'use client';

/**
 * Perfil: identificação, estado das permissões do aparelho, explicação de
 * privacidade e saída da conta. É aqui que quem bloqueou a câmera ou a
 * localização encontra o caminho de volta.
 */

import * as React from 'react';
import { LogOut, Palette, RefreshCw, ShieldCheck, Smartphone } from 'lucide-react';
import { createClient } from '@/utils/supabase/client';
import { usePonto } from '@/components/ponto/PontoSessionProvider';
import {
  DataRow,
  EmployeeProfileCard,
  PontoButton,
  PontoCard,
  SectionLabel,
  SyncStatus,
  ThemeToggle,
  type PermissionLabel,
} from '@/components/ponto';

function toPermissionLabel(state: PermissionState | 'unknown'): PermissionLabel {
  switch (state) {
    case 'granted':
      return 'granted';
    case 'denied':
      return 'denied';
    case 'prompt':
      return 'prompt';
    default:
      return 'unknown';
  }
}

export default function PontoProfilePage() {
  const { session, geo, signOut } = usePonto();
  const [email, setEmail] = React.useState<string | null>(null);
  const [cameraPermission, setCameraPermission] = React.useState<PermissionLabel>('unknown');
  const [syncMessage, setSyncMessage] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    void createClient()
      .auth.getUser()
      .then(({ data }) => {
        if (!cancelled) setEmail(data.user?.email ?? null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  React.useEffect(() => {
    let cancelled = false;
    if (typeof navigator === 'undefined' || !navigator.permissions?.query) return;
    navigator.permissions
      .query({ name: 'camera' as PermissionName })
      .then((status) => {
        if (!cancelled) setCameraPermission(toPermissionLabel(status.state));
      })
      .catch(() => {
        // Safari não expõe o estado da câmera — seguimos com "não informado".
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const person = session.bootstrap?.person ?? null;
  const devices = session.bootstrap?.devices ?? [];

  return (
    <div className="lg:grid lg:grid-cols-2 lg:items-start lg:gap-6">
      <div className="space-y-5">
      <EmployeeProfileCard
        fullName={person?.full_name ?? null}
        jobTitle={person?.job_title ?? null}
        email={email}
        locationPermission={toPermissionLabel(geo.permission)}
        cameraPermission={cameraPermission}
        footer={
          <div className="space-y-2">
            <PontoButton variant="secondary" icon={RefreshCw} onClick={() => void session.reload()}>
              Atualizar meus dados
            </PontoButton>
            <PontoButton variant="danger" icon={LogOut} onClick={() => void signOut()}>
              Sair da conta
            </PontoButton>
          </div>
        }
      />

      <section>
        <SectionLabel icon={Palette}>Aparência</SectionLabel>
        <PontoCard className="p-4">
          <ThemeToggle variant="full" />
          <p className="mt-2.5 text-ig-caption text-ig-fg-muted">
            O tema claro é mais legível sob sol forte; o escuro poupa bateria e cansa menos a vista
            em ambientes fechados.
          </p>
        </PontoCard>
      </section>
      </div>

      <div className="mt-5 space-y-5 lg:mt-0">
      <section>
        <SectionLabel icon={ShieldCheck}>Envio das marcações</SectionLabel>
        <PontoCard>
          <SyncStatus
            online={session.online}
            syncing={session.syncing}
            pending={session.pending}
            lastSyncMessage={syncMessage}
            onSyncNow={() => {
              void session.syncNow().then((report) => setSyncMessage(report.message));
            }}
          />
        </PontoCard>
      </section>

      {devices.length > 0 ? (
        <section>
          <SectionLabel icon={Smartphone}>Aparelhos registrados</SectionLabel>
          <PontoCard className="px-4 py-2">
            {devices.map((device) => (
              <DataRow
                key={device.id}
                label={device.device_public_id}
                value={device.status === 'active' ? 'Ativo' : device.status}
                tone={device.status === 'active' ? 'success' : 'warning'}
              />
            ))}
          </PontoCard>
        </section>
      ) : null}

      <p className="px-1 text-center text-ig-caption text-ig-fg-subtle">
        Insight Ponto · parte da plataforma Insight Apex. Dúvidas sobre sua jornada? Fale com seu
        gestor ou com o RH.
      </p>
      </div>
    </div>
  );
}
