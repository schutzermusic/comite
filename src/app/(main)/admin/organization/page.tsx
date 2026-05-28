'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Building2, RotateCcw, Save, Upload } from 'lucide-react';
import {
  HudButton,
  HudHeader,
  HudInput,
  HudPageLayout,
  HudPanel,
  useHudToast,
} from '@/components/hud';
import { SettingRow } from '@/components/settings/SettingRow';
import { AccessRestrictedState } from '@/components/auth/AccessRestrictedState';
import { useCurrentUser } from '@/hooks/use-current-user';
import { hasPermission } from '@/lib/auth/permissions';
import {
  PRODUCT_NAME,
  PRODUCT_SIGNATURE,
  getWorkspaceName,
} from '@/lib/branding';

type BrandingState = {
  name: string;
  workspace_name: string;
  logo_url: string;
  email_from_name: string;
  notification_name: string;
  branding_enabled: boolean;
};

const EMPTY: BrandingState = {
  name: '',
  workspace_name: '',
  logo_url: '',
  email_from_name: '',
  notification_name: '',
  branding_enabled: true,
};

export default function OrganizationBrandingPage() {
  const { organization, permissions, loading: authLoading, refresh } = useCurrentUser();
  const canManage = hasPermission(permissions, 'admin.manage_organization');
  const { success: toastSuccess, error: toastError } = useHudToast();

  const [state, setState] = useState<BrandingState>(EMPTY);
  const [initial, setInitial] = useState<BrandingState>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const onPickFile = () => fileInputRef.current?.click();

  const onUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      toastError('Arquivo excede 2MB.');
      return;
    }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('filename', file.name);
      const res = await fetch('/api/admin/organization/branding/logo', {
        method: 'POST',
        body: fd,
      });
      const json = await res.json();
      if (!res.ok || !json?.ok) {
        toastError(json?.error || 'Falha no upload.');
        return;
      }
      setState((prev) => ({ ...prev, logo_url: json.logo_url }));
      setInitial((prev) => ({ ...prev, logo_url: json.logo_url }));
      toastSuccess('Logo enviado.');
      await refresh();
    } catch (err) {
      toastError(err instanceof Error ? err.message : 'Erro no upload.');
    } finally {
      setUploading(false);
    }
  };

  useEffect(() => {
    if (!organization) return;
    const next: BrandingState = {
      name: organization.name ?? '',
      workspace_name: organization.workspace_name ?? '',
      logo_url: organization.logo_url ?? '',
      email_from_name: organization.email_from_name ?? '',
      notification_name: organization.notification_name ?? '',
      branding_enabled: organization.branding_enabled !== false,
    };
    setState(next);
    setInitial(next);
  }, [organization]);

  const dirty = useMemo(
    () => JSON.stringify(state) !== JSON.stringify(initial),
    [state, initial],
  );

  const previewWorkspace = useMemo(() => {
    return getWorkspaceName({
      name: state.name,
      workspace_name: state.workspace_name,
      branding_enabled: state.branding_enabled,
    });
  }, [state]);

  const update = <K extends keyof BrandingState>(key: K, value: BrandingState[K]) =>
    setState((prev) => ({ ...prev, [key]: value }));

  const resetToDefault = () => {
    setState({
      name: state.name,
      workspace_name: '',
      logo_url: '',
      email_from_name: '',
      notification_name: '',
      branding_enabled: true,
    });
  };

  const onSave = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/admin/organization/branding', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: state.name,
          workspace_name: state.workspace_name || null,
          logo_url: state.logo_url || null,
          email_from_name: state.email_from_name || null,
          notification_name: state.notification_name || null,
          branding_enabled: state.branding_enabled,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json?.ok) {
        toastError(json?.error || 'Falha ao salvar branding.');
        return;
      }
      toastSuccess('Branding atualizado.');
      await refresh();
    } catch (err) {
      toastError(err instanceof Error ? err.message : 'Erro inesperado.');
    } finally {
      setSaving(false);
    }
  };

  if (authLoading) {
    return (
      <HudPageLayout>
        <p className="text-sm text-ig-fg-muted">Carregando…</p>
      </HudPageLayout>
    );
  }

  if (!canManage) {
    return (
      <HudPageLayout>
        <AccessRestrictedState />
      </HudPageLayout>
    );
  }

  return (
    <HudPageLayout>
      <HudHeader
        title="Branding da Organização"
        subtitle="Personalize a identidade do workspace para sua organização."
        icon={<Building2 size={18} />}
        iconTint="#64748B"
      />

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="flex flex-col gap-6">
          <HudPanel elevation={2} title="Identidade do workspace">
            <SettingRow label="Nome da empresa" description="Razão social ou nome comercial.">
              <HudInput
                value={state.name}
                onChange={(e) => update('name', e.target.value)}
                className="w-80"
              />
            </SettingRow>
            <SettingRow
              label="Nome do workspace"
              description={`Vazio = "${state.name || 'Empresa'} Board".`}
            >
              <HudInput
                value={state.workspace_name}
                onChange={(e) => update('workspace_name', e.target.value)}
                placeholder={state.name ? `${state.name} Board` : PRODUCT_NAME}
                className="w-80"
              />
            </SettingRow>
            <SettingRow
              label="Logo"
              description="Faça upload (PNG, JPG, WEBP, SVG até 2MB) ou cole uma URL pública. Qualquer formato é ajustado ao tamanho do topbar."
            >
              <div className="flex w-full max-w-md flex-col gap-2">
                <div className="flex items-center gap-2">
                  <HudInput
                    value={state.logo_url}
                    onChange={(e) => update('logo_url', e.target.value)}
                    placeholder="https://…/logo.png"
                    className="flex-1"
                  />
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/svg+xml"
                    className="hidden"
                    onChange={onUpload}
                  />
                  <HudButton
                    variant="ghost"
                    onClick={onPickFile}
                    isLoading={uploading}
                    leftIcon={<Upload className="h-4 w-4" />}
                  >
                    Upload
                  </HudButton>
                </div>
                {state.logo_url && (
                  <div className="flex items-center gap-3 rounded-md border border-ig-border bg-ig-panel/40 px-3 py-2">
                    <span className="text-[10px] uppercase tracking-[0.18em] text-ig-fg-subtle">
                      Pré-visualização (topbar)
                    </span>
                    {/* Same dimensions as the topbar slot (136x36) so the admin
                        sees exactly how any logo will render. */}
                    <div
                      className="flex items-center justify-start overflow-hidden"
                      style={{ width: 136, height: 36 }}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={state.logo_url}
                        alt="preview"
                        className="h-full w-full object-contain object-left"
                      />
                    </div>
                  </div>
                )}
              </div>
            </SettingRow>
          </HudPanel>

          <HudPanel elevation={2} title="Comunicação">
            <SettingRow
              label="Nome do remetente de e-mail"
              description="Aparece como 'From name' em e-mails do app."
            >
              <HudInput
                value={state.email_from_name}
                onChange={(e) => update('email_from_name', e.target.value)}
                placeholder={previewWorkspace}
                className="w-80"
              />
            </SettingRow>
            <SettingRow
              label="Nome em notificações"
              description="Usado no rótulo de notificações in-app/push."
            >
              <HudInput
                value={state.notification_name}
                onChange={(e) => update('notification_name', e.target.value)}
                placeholder={previewWorkspace}
                className="w-80"
              />
            </SettingRow>
            <SettingRow
              label="Branding habilitado"
              description="Desativar volta tudo para os padrões do produto."
            >
              <input
                type="checkbox"
                checked={state.branding_enabled}
                onChange={(e) => update('branding_enabled', e.target.checked)}
                className="h-4 w-4"
              />
            </SettingRow>
          </HudPanel>

          <div className="flex items-center gap-3">
            <HudButton
              variant="primary"
              onClick={onSave}
              isLoading={saving}
              disabled={!dirty}
              leftIcon={<Save className="h-4 w-4" />}
            >
              Salvar alterações
            </HudButton>
            <HudButton
              variant="ghost"
              onClick={resetToDefault}
              leftIcon={<RotateCcw className="h-4 w-4" />}
            >
              Resetar para o padrão
            </HudButton>
          </div>
        </div>

        <HudPanel elevation={3} title="Pré-visualização">
          <div className="flex flex-col gap-3 p-2">
            <div className="rounded-lg border border-ig-border p-4">
              <div className="text-xs uppercase tracking-[0.18em] text-ig-fg-subtle">
                Workspace
              </div>
              <div className="mt-1 text-lg font-semibold text-ig-fg-strong">
                {previewWorkspace}
              </div>
              <div className="mt-2 text-[11px] uppercase tracking-[0.18em] text-ig-fg-subtle">
                {PRODUCT_SIGNATURE}
              </div>
            </div>
            <div className="text-xs text-ig-fg-muted">
              Remetente: <span className="text-ig-fg-strong">
                {state.email_from_name || previewWorkspace}
              </span>
            </div>
            <div className="text-xs text-ig-fg-muted">
              Notificações: <span className="text-ig-fg-strong">
                {state.notification_name || previewWorkspace}
              </span>
            </div>
            <div className="text-[11px] text-ig-fg-subtle">
              As cores seguem a identidade visual padrão {PRODUCT_NAME}.
            </div>
          </div>
        </HudPanel>
      </div>
    </HudPageLayout>
  );
}
