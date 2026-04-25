"use client";

import { useState } from "react";
import { ScrollText } from "lucide-react";
import { HudButton } from "@/components/hud/HudButton";
import { HudHeader } from "@/components/hud/HudHeader";
import { HudPanel } from "@/components/hud/HudPanel";
import { HudSelect } from "@/components/hud/HudSelect";
import { SettingRow } from "@/components/settings/SettingRow";
import { SettingsFooter } from "@/components/settings/SettingsFooter";
import { Switch } from "@/components/ui/switch";

const DEFAULTS = {
  retencao: "365",
  exportacao: "monthly",
  registrarLogin: true,
  registrarAlteracoes: true,
  registrarLeituras: false,
  alertaPrivilegio: true,
};

export default function AuditoriaPage() {
  const [settings, setSettings] = useState(DEFAULTS);
  const [dirty, setDirty] = useState(false);

  const set = <K extends keyof typeof DEFAULTS>(key: K, value: (typeof DEFAULTS)[K]) => {
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
        title="Auditoria"
        subtitle="Retenção, exportação e granularidade da trilha de governança."
        icon={<ScrollText size={18} />}
        iconTint="#64748B"
      />

      <div className="mt-6 flex flex-col gap-6">
        <HudPanel elevation={2} title="Retenção">
          <SettingRow label="Prazo de retenção" description="Tempo mínimo para manter eventos auditáveis.">
            <HudSelect
              value={settings.retencao}
              onChange={(value) => set("retencao", value)}
              options={[
                { value: "180", label: "180 dias" },
                { value: "365", label: "1 ano" },
                { value: "1825", label: "5 anos" },
              ]}
              className="w-72"
            />
          </SettingRow>
          <SettingRow label="Exportação programada">
            <HudSelect
              value={settings.exportacao}
              onChange={(value) => set("exportacao", value)}
              options={[
                { value: "weekly", label: "Semanal" },
                { value: "monthly", label: "Mensal" },
                { value: "quarterly", label: "Trimestral" },
              ]}
              className="w-72"
            />
          </SettingRow>
        </HudPanel>

        <HudPanel elevation={2} title="Eventos rastreados">
          <SettingRow label="Logins e sessões">
            <Switch checked={settings.registrarLogin} onCheckedChange={(value) => set("registrarLogin", value)} />
          </SettingRow>
          <SettingRow label="Alterações de dados" description="Inclui pautas, contratos, riscos e permissões.">
            <Switch
              checked={settings.registrarAlteracoes}
              onCheckedChange={(value) => set("registrarAlteracoes", value)}
            />
          </SettingRow>
          <SettingRow label="Leitura de documentos">
            <Switch checked={settings.registrarLeituras} onCheckedChange={(value) => set("registrarLeituras", value)} />
          </SettingRow>
          <SettingRow label="Alertas de privilégio" description="Notifica elevação ou uso incomum de permissão.">
            <Switch
              checked={settings.alertaPrivilegio}
              onCheckedChange={(value) => set("alertaPrivilegio", value)}
            />
          </SettingRow>
          <SettingRow label="Exportação imediata">
            <HudButton variant="secondary" size="sm">
              Baixar trilha
            </HudButton>
          </SettingRow>
        </HudPanel>
      </div>

      <SettingsFooter dirty={dirty} onSave={() => setDirty(false)} onDiscard={discard} />
    </>
  );
}
