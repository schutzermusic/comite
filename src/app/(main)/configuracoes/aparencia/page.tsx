"use client";

import { useState } from "react";
import { Palette } from "lucide-react";
import { HudHeader } from "@/components/hud/HudHeader";
import { HudPanel } from "@/components/hud/HudPanel";
import { HudSelect } from "@/components/hud/HudSelect";
import { SettingRow } from "@/components/settings/SettingRow";
import { SettingsFooter } from "@/components/settings/SettingsFooter";
import { Switch } from "@/components/ui/switch";

const DEFAULTS = {
  tema: "system",
  densidade: "comfortable",
  movimentoReduzido: false,
  brilhoMetalico: true,
  paineisCompactos: false,
};

export default function AparenciaPage() {
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
        title="Aparência"
        subtitle="Preferências visuais aplicadas ao shell executivo."
        icon={<Palette size={18} />}
        iconTint="#64748B"
      />

      <div className="mt-6 flex flex-col gap-6">
        <HudPanel elevation={2} title="Interface">
          <SettingRow label="Tema">
            <HudSelect
              value={settings.tema}
              onChange={(value) => set("tema", value)}
              options={[
                { value: "system", label: "Sistema" },
                { value: "dark", label: "Dark premium" },
                { value: "light", label: "Light pearl" },
              ]}
              className="w-72"
            />
          </SettingRow>
          <SettingRow label="Densidade">
            <HudSelect
              value={settings.densidade}
              onChange={(value) => set("densidade", value)}
              options={[
                { value: "compact", label: "Compacta" },
                { value: "comfortable", label: "Confortável" },
                { value: "spacious", label: "Espaçada" },
              ]}
              className="w-72"
            />
          </SettingRow>
        </HudPanel>

        <HudPanel elevation={2} title="Movimento e material">
          <SettingRow label="Reduzir movimento" description="Diminui transições e entradas animadas.">
            <Switch
              checked={settings.movimentoReduzido}
              onCheckedChange={(value) => set("movimentoReduzido", value)}
            />
          </SettingRow>
          <SettingRow label="Brilho metálico" description="Realce especular em títulos e superfícies premium.">
            <Switch checked={settings.brilhoMetalico} onCheckedChange={(value) => set("brilhoMetalico", value)} />
          </SettingRow>
          <SettingRow label="Painéis compactos">
            <Switch checked={settings.paineisCompactos} onCheckedChange={(value) => set("paineisCompactos", value)} />
          </SettingRow>
        </HudPanel>
      </div>

      <SettingsFooter dirty={dirty} onSave={() => setDirty(false)} onDiscard={discard} />
    </>
  );
}
