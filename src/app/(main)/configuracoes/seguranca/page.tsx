"use client";

import { useState } from "react";
import { Shield } from "lucide-react";
import { HudButton } from "@/components/hud/HudButton";
import { HudHeader } from "@/components/hud/HudHeader";
import { HudPanel } from "@/components/hud/HudPanel";
import { HudSelect } from "@/components/hud/HudSelect";
import { SettingRow } from "@/components/settings/SettingRow";
import { SettingsFooter } from "@/components/settings/SettingsFooter";
import { Switch } from "@/components/ui/switch";

const DEFAULTS = {
  mfa: true,
  sso: false,
  duracaoSessao: "8",
  ipRestrito: false,
  aprovacaoDispositivo: true,
};

export default function SegurancaPage() {
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
        title="Segurança"
        subtitle="Políticas de acesso, sessão e dispositivos confiáveis."
        icon={<Shield size={18} />}
        iconTint="#64748B"
      />

      <div className="mt-6 flex flex-col gap-6">
        <HudPanel elevation={2} title="Autenticação">
          <SettingRow label="MFA obrigatório" description="Exige segundo fator para usuários administrativos.">
            <Switch checked={settings.mfa} onCheckedChange={(value) => set("mfa", value)} />
          </SettingRow>
          <SettingRow label="SSO corporativo" description="Permite autenticação por provedor de identidade externo.">
            <Switch checked={settings.sso} onCheckedChange={(value) => set("sso", value)} />
          </SettingRow>
          <SettingRow label="Duração da sessão">
            <HudSelect
              value={settings.duracaoSessao}
              onChange={(value) => set("duracaoSessao", value)}
              options={[
                { value: "4", label: "4 horas" },
                { value: "8", label: "8 horas" },
                { value: "12", label: "12 horas" },
              ]}
              className="w-72"
            />
          </SettingRow>
        </HudPanel>

        <HudPanel elevation={2} title="Controles de acesso">
          <SettingRow label="Restrição por IP" description="Limita acesso a redes corporativas autorizadas.">
            <Switch checked={settings.ipRestrito} onCheckedChange={(value) => set("ipRestrito", value)} />
          </SettingRow>
          <SettingRow label="Aprovação de dispositivo" description="Novo dispositivo exige confirmação administrativa.">
            <Switch
              checked={settings.aprovacaoDispositivo}
              onCheckedChange={(value) => set("aprovacaoDispositivo", value)}
            />
          </SettingRow>
          <SettingRow label="Credenciais">
            <HudButton variant="secondary" size="sm">
              Redefinir senha
            </HudButton>
          </SettingRow>
        </HudPanel>
      </div>

      <SettingsFooter dirty={dirty} onSave={() => setDirty(false)} onDiscard={discard} />
    </>
  );
}
