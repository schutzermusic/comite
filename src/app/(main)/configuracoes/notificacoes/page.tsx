"use client";

import { useState } from "react";
import { Bell } from "lucide-react";
import { HudHeader } from "@/components/hud/HudHeader";
import { HudPanel } from "@/components/hud/HudPanel";
import { SettingRow } from "@/components/settings/SettingRow";
import { SettingsFooter } from "@/components/settings/SettingsFooter";
import { Switch } from "@/components/ui/switch";

const DEFAULTS = {
  emailResumo: true,
  emailAlertas: true,
  pushPautas: false,
  pushRiscos: true,
  pushReunioesProximas: true,
  digestSemanal: false,
};

export default function NotificacoesPage() {
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
        title="Notificações"
        subtitle="Controle como e quando você recebe alertas."
        icon={<Bell size={18} />}
        iconTint="#64748B"
      />

      <div className="mt-6 flex flex-col gap-6">
        <HudPanel elevation={2} title="E-mail">
          <SettingRow label="Resumo diário" description="Receba um resumo das atividades a cada manhã.">
            <Switch checked={settings.emailResumo} onCheckedChange={(value) => set("emailResumo", value)} />
          </SettingRow>
          <SettingRow label="Alertas críticos" description="Notificações imediatas para riscos e vencimentos.">
            <Switch checked={settings.emailAlertas} onCheckedChange={(value) => set("emailAlertas", value)} />
          </SettingRow>
          <SettingRow label="Digest semanal" description="Panorama consolidado enviado toda segunda-feira.">
            <Switch checked={settings.digestSemanal} onCheckedChange={(value) => set("digestSemanal", value)} />
          </SettingRow>
        </HudPanel>

        <HudPanel elevation={2} title="Push">
          <SettingRow label="Novas pautas" description="Quando uma deliberação for criada para você.">
            <Switch checked={settings.pushPautas} onCheckedChange={(value) => set("pushPautas", value)} />
          </SettingRow>
          <SettingRow label="Riscos elevados">
            <Switch checked={settings.pushRiscos} onCheckedChange={(value) => set("pushRiscos", value)} />
          </SettingRow>
          <SettingRow label="Reuniões próximas" description="30 minutos antes do início.">
            <Switch checked={settings.pushReunioesProximas} onCheckedChange={(value) => set("pushReunioesProximas", value)} />
          </SettingRow>
        </HudPanel>
      </div>

      <SettingsFooter dirty={dirty} onSave={() => setDirty(false)} onDiscard={discard} />
    </>
  );
}
