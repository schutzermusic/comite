"use client";

import { useState } from "react";
import { Puzzle } from "lucide-react";
import { HudButton } from "@/components/hud/HudButton";
import { HudHeader } from "@/components/hud/HudHeader";
import { HudPanel } from "@/components/hud/HudPanel";
import { SettingRow } from "@/components/settings/SettingRow";
import { SettingsFooter } from "@/components/settings/SettingsFooter";
import { Switch } from "@/components/ui/switch";

const DEFAULTS = {
  supabase: true,
  drive: false,
  slack: false,
  teams: true,
  webhook: true,
};

export default function IntegracoesPage() {
  const [settings, setSettings] = useState(DEFAULTS);
  const [dirty, setDirty] = useState(false);

  const set = <K extends keyof typeof DEFAULTS>(key: K, value: boolean) => {
    setSettings((previous) => ({ ...previous, [key]: value }));
    setDirty(true);
  };

  const discard = () => {
    setSettings(DEFAULTS);
    setDirty(false);
  };

  return (
    <>
      <HudHeader
        title="Integrações"
        subtitle="Conectores autorizados para dados, documentos e comunicação."
        icon={<Puzzle size={18} />}
      />

      <div className="mt-6 flex flex-col gap-6">
        <HudPanel elevation={2} title="Plataformas conectadas">
          <SettingRow label="Supabase" description="Sincronização operacional e autenticação.">
            <Switch checked={settings.supabase} onCheckedChange={(value) => set("supabase", value)} />
          </SettingRow>
          <SettingRow label="Google Drive" description="Publicação de atas e anexos em pastas controladas.">
            <Switch checked={settings.drive} onCheckedChange={(value) => set("drive", value)} />
          </SettingRow>
          <SettingRow label="Microsoft Teams" description="Alertas de reuniões e aprovações.">
            <Switch checked={settings.teams} onCheckedChange={(value) => set("teams", value)} />
          </SettingRow>
          <SettingRow label="Slack" description="Notificações para canais executivos.">
            <Switch checked={settings.slack} onCheckedChange={(value) => set("slack", value)} />
          </SettingRow>
        </HudPanel>

        <HudPanel elevation={2} title="Automação">
          <SettingRow label="Webhooks ativos" description="Envio de eventos para sistemas internos.">
            <Switch checked={settings.webhook} onCheckedChange={(value) => set("webhook", value)} />
          </SettingRow>
          <SettingRow label="Catálogo de conectores" description="Gerencie credenciais e permissões fora desta visão.">
            <HudButton variant="secondary" size="sm">
              Abrir catálogo
            </HudButton>
          </SettingRow>
        </HudPanel>
      </div>

      <SettingsFooter dirty={dirty} onSave={() => setDirty(false)} onDiscard={discard} />
    </>
  );
}
