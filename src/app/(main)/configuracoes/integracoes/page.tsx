"use client";

import { useState } from "react";
import Link from "next/link";
import { ExternalLink, FileCode2, Puzzle, ShieldCheck } from "lucide-react";
import { HudButton } from "@/components/hud/HudButton";
import { HudHeader } from "@/components/hud/HudHeader";
import { HudPanel } from "@/components/hud/HudPanel";
import { HudStatusPill } from "@/components/hud/HudStatusPill";
import { SettingRow } from "@/components/settings/SettingRow";
import { SettingsFooter } from "@/components/settings/SettingsFooter";
import { Switch } from "@/components/ui/switch";
import { ESOCIAL_GITHUB_URL, ESOCIAL_PROVIDER, getEsocialDashboardData } from "@/lib/esocial";

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
  const esocial = getEsocialDashboardData();

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
        iconTint="#64748B"
      />

      <div className="mt-6 flex flex-col gap-6">
        <HudPanel
          elevation={3}
          title="eSocial"
          subtitle="Camada central de dados da folha para Pessoas & Custos e Financeiro."
          icon={<ShieldCheck size={16} />}
          iconTint="#17C3B2"
          sweep
          headerActions={
            <HudStatusPill variant="warning" size="sm">
              {esocial.config.environment === "production" ? "Producao" : "Homologacao"}
            </HudStatusPill>
          }
        >
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_auto] lg:items-center">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="rounded-lg border border-ig-border-subtle bg-ig-panel/60 px-3 py-3">
                <p className="text-[10px] uppercase tracking-[0.12em] text-ig-fg-subtle">Provider</p>
                <p className="mt-1 truncate font-mono text-xs text-ig-fg-strong">{ESOCIAL_PROVIDER}</p>
              </div>
              <div className="rounded-lg border border-ig-border-subtle bg-ig-panel/60 px-3 py-3">
                <p className="text-[10px] uppercase tracking-[0.12em] text-ig-fg-subtle">Ultima sync</p>
                <p className="mt-1 font-mono text-xs text-ig-fg-strong">05/05/2026 09:30</p>
              </div>
              <div className="rounded-lg border border-[color-mix(in_oklab,var(--ig-warning)_30%,transparent)] bg-ig-panel/60 px-3 py-3">
                <p className="text-[10px] uppercase tracking-[0.12em] text-ig-fg-subtle">Certificado</p>
                <p className="mt-1 font-mono text-xs text-ig-warning">Expira em 2026-06-18</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2 lg:justify-end">
              <Link
                href={ESOCIAL_GITHUB_URL}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-8 items-center justify-center gap-2 rounded-lg border border-ig-border-strong bg-ig-panel-hover px-3 text-xs font-medium text-ig-fg-strong hover:border-ig-border-focus"
              >
                <FileCode2 className="h-4 w-4" />
                GitHub
                <ExternalLink className="h-3.5 w-3.5" />
              </Link>
              <Link href="/configuracoes/integracoes/esocial">
                <HudButton variant="primary" size="sm">
                  Abrir central eSocial
                </HudButton>
              </Link>
            </div>
          </div>
        </HudPanel>

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
