"use client";

import { useState } from "react";
import { KeyRound } from "lucide-react";
import { HudButton } from "@/components/hud/HudButton";
import { HudHeader } from "@/components/hud/HudHeader";
import { HudInput } from "@/components/hud/HudInput";
import { HudPanel } from "@/components/hud/HudPanel";
import { HudSelect } from "@/components/hud/HudSelect";
import { SettingRow } from "@/components/settings/SettingRow";
import { SettingsFooter } from "@/components/settings/SettingsFooter";
import { Switch } from "@/components/ui/switch";

const DEFAULTS = {
  tokenName: "Governança API",
  escopo: "read-write",
  expiracao: "90",
  rotacaoAutomatica: true,
  auditoriaObrigatoria: true,
};

export default function ApiTokensPage() {
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
        title="API & Tokens"
        subtitle="Acesso programático com escopo e expiração controlados."
        icon={<KeyRound size={18} />}
      />

      <div className="mt-6 flex flex-col gap-6">
        <HudPanel elevation={2} title="Novo token">
          <SettingRow label="Nome do token">
            <HudInput
              value={settings.tokenName}
              onChange={(event) => set("tokenName", event.target.value)}
              className="w-72"
            />
          </SettingRow>
          <SettingRow label="Escopo">
            <HudSelect
              value={settings.escopo}
              onChange={(value) => set("escopo", value)}
              options={[
                { value: "read", label: "Somente leitura" },
                { value: "read-write", label: "Leitura e escrita" },
                { value: "admin", label: "Administração" },
              ]}
              className="w-72"
            />
          </SettingRow>
          <SettingRow label="Expiração" description="Prazo máximo de validade após emissão.">
            <HudSelect
              value={settings.expiracao}
              onChange={(value) => set("expiracao", value)}
              options={[
                { value: "30", label: "30 dias" },
                { value: "90", label: "90 dias" },
                { value: "180", label: "180 dias" },
              ]}
              className="w-72"
            />
          </SettingRow>
        </HudPanel>

        <HudPanel elevation={2} title="Política">
          <SettingRow label="Rotação automática" description="Solicita renovação antes do vencimento.">
            <Switch
              checked={settings.rotacaoAutomatica}
              onCheckedChange={(value) => set("rotacaoAutomatica", value)}
            />
          </SettingRow>
          <SettingRow label="Auditoria obrigatória" description="Registra cada uso de token em trilha imutável.">
            <Switch
              checked={settings.auditoriaObrigatoria}
              onCheckedChange={(value) => set("auditoriaObrigatoria", value)}
            />
          </SettingRow>
          <SettingRow label="Ação">
            <HudButton variant="primary" size="sm">
              Gerar token
            </HudButton>
          </SettingRow>
        </HudPanel>
      </div>

      <SettingsFooter dirty={dirty} onSave={() => setDirty(false)} onDiscard={discard} />
    </>
  );
}
