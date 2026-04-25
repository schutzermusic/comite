"use client";

import { useState } from "react";
import { Building2 } from "lucide-react";
import { HudHeader } from "@/components/hud/HudHeader";
import { HudInput } from "@/components/hud/HudInput";
import { HudPanel } from "@/components/hud/HudPanel";
import { HudSelect } from "@/components/hud/HudSelect";
import { SettingRow } from "@/components/settings/SettingRow";
import { SettingsFooter } from "@/components/settings/SettingsFooter";

const DEFAULTS = {
  razaoSocial: "INSIGHT Governança Corporativa",
  cnpj: "12.345.678/0001-90",
  setor: "energia",
  porte: "enterprise",
  moeda: "BRL",
};

export default function EmpresaPage() {
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
        title="Empresa"
        subtitle="Identidade institucional usada em relatórios e documentos."
        icon={<Building2 size={18} />}
      />

      <div className="mt-6 flex flex-col gap-6">
        <HudPanel elevation={2} title="Dados corporativos">
          <SettingRow label="Razão social">
            <HudInput
              value={settings.razaoSocial}
              onChange={(event) => set("razaoSocial", event.target.value)}
              className="w-80"
            />
          </SettingRow>
          <SettingRow label="CNPJ">
            <HudInput
              value={settings.cnpj}
              onChange={(event) => set("cnpj", event.target.value)}
              className="w-60"
            />
          </SettingRow>
          <SettingRow label="Setor operacional">
            <HudSelect
              value={settings.setor}
              onChange={(value) => set("setor", value)}
              options={[
                { value: "energia", label: "Energia" },
                { value: "infraestrutura", label: "Infraestrutura" },
                { value: "servicos", label: "Serviços corporativos" },
              ]}
              className="w-72"
            />
          </SettingRow>
        </HudPanel>

        <HudPanel elevation={2} title="Parâmetros executivos">
          <SettingRow label="Porte da organização">
            <HudSelect
              value={settings.porte}
              onChange={(value) => set("porte", value)}
              options={[
                { value: "midmarket", label: "Middle market" },
                { value: "enterprise", label: "Enterprise" },
                { value: "holding", label: "Holding" },
              ]}
              className="w-72"
            />
          </SettingRow>
          <SettingRow label="Moeda padrão" description="Base para painéis financeiros e contratos.">
            <HudSelect
              value={settings.moeda}
              onChange={(value) => set("moeda", value)}
              options={[
                { value: "BRL", label: "Real brasileiro" },
                { value: "USD", label: "Dólar americano" },
                { value: "EUR", label: "Euro" },
              ]}
              className="w-72"
            />
          </SettingRow>
        </HudPanel>
      </div>

      <SettingsFooter dirty={dirty} onSave={() => setDirty(false)} onDiscard={discard} />
    </>
  );
}
