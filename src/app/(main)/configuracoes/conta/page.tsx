"use client";

import { useState } from "react";
import { Mail, User } from "lucide-react";
import { HudButton } from "@/components/hud/HudButton";
import { HudHeader } from "@/components/hud/HudHeader";
import { HudInput } from "@/components/hud/HudInput";
import { HudPanel } from "@/components/hud/HudPanel";
import { HudSelect } from "@/components/hud/HudSelect";
import { SettingRow } from "@/components/settings/SettingRow";
import { SettingsFooter } from "@/components/settings/SettingsFooter";

const DEFAULTS = {
  nome: "Admin User",
  email: "admin@insightgov.com",
  cargo: "Diretora de Governança",
  idioma: "pt-BR",
  timezone: "America/Sao_Paulo",
};

export default function ContaPage() {
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
        title="Minha Conta"
        subtitle="Dados pessoais e preferências de sessão."
        icon={<User size={18} />}
        iconTint="#64748B"
      />

      <div className="mt-6 flex flex-col gap-6">
        <HudPanel elevation={2} title="Perfil">
          <div className="grid gap-4">
            <SettingRow label="Nome completo" description="Nome exibido em votos, atas e auditoria.">
              <HudInput
                value={settings.nome}
                onChange={(event) => set("nome", event.target.value)}
                className="w-72"
              />
            </SettingRow>
            <SettingRow label="E-mail corporativo" description="Usado para login e comunicações críticas.">
              <HudInput
                type="email"
                value={settings.email}
                leftIcon={<Mail size={14} />}
                onChange={(event) => set("email", event.target.value)}
                className="w-72"
              />
            </SettingRow>
            <SettingRow label="Cargo">
              <HudInput
                value={settings.cargo}
                onChange={(event) => set("cargo", event.target.value)}
                className="w-72"
              />
            </SettingRow>
          </div>
        </HudPanel>

        <HudPanel elevation={2} title="Localização">
          <SettingRow label="Idioma da interface">
            <HudSelect
              value={settings.idioma}
              onChange={(value) => set("idioma", value)}
              options={[
                { value: "pt-BR", label: "Português (Brasil)" },
                { value: "en-US", label: "English (US)" },
                { value: "es-ES", label: "Español" },
              ]}
              className="w-72"
            />
          </SettingRow>
          <SettingRow label="Fuso horário" description="Aplicado a reuniões, prazos e trilhas de auditoria.">
            <HudSelect
              value={settings.timezone}
              onChange={(value) => set("timezone", value)}
              options={[
                { value: "America/Sao_Paulo", label: "São Paulo (BRT)" },
                { value: "America/New_York", label: "New York (ET)" },
                { value: "Europe/Lisbon", label: "Lisboa (WET)" },
              ]}
              className="w-72"
            />
          </SettingRow>
        </HudPanel>

        <HudButton variant="secondary" size="sm">
          Ver sessões ativas
        </HudButton>
      </div>

      <SettingsFooter dirty={dirty} onSave={() => setDirty(false)} onDiscard={discard} />
    </>
  );
}
