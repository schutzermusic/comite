import React from "react";
import {
  AlertTriangle,
  Boxes,
  Building2,
  Clock3,
  ClipboardCheck,
  Cuboid,
  MapPinned,
  Route,
  ScanLine,
} from "lucide-react";
import {
  HudHeader,
  HudKpiStrip,
  HudPageLayout,
  type KpiItem,
} from "@/components/hud";
import { CesiumOperationsMap } from "@/components/operations-3d/CesiumOperationsMap";

const kpis: KpiItem[] = [
  {
    id: "mapped-assets",
    label: "Ativos mapeados",
    value: "128",
    variant: "info",
    icon: <Boxes className="h-5 w-5" />,
  },
  {
    id: "projects-3d",
    label: "Projetos com visão 3D",
    value: "16",
    variant: "success",
    icon: <Cuboid className="h-5 w-5" />,
  },
  {
    id: "critical-points",
    label: "Pontos críticos",
    value: "7",
    variant: "warning",
    icon: <AlertTriangle className="h-5 w-5" />,
  },
  {
    id: "last-update",
    label: "Última atualização",
    value: "Hoje 09:40",
    variant: "default",
    icon: <Clock3 className="h-5 w-5" />,
  },
];

const useCases = [
  { label: "Service hotspots", description: "Focos de mobilização por região e frente.", icon: MapPinned },
  { label: "Project / asset focus", description: "Camada dedicada a ativos, contratos e projetos.", icon: Building2 },
  { label: "Field inspections", description: "Visão operacional para inspeções e evidências.", icon: ClipboardCheck },
  { label: "Physical progress", description: "Leitura visual de avanço físico por área.", icon: Route },
  { label: "Critical points", description: "Sinalização de gargalos, riscos e desvios.", icon: AlertTriangle },
];

export default function Operations3DPage() {
  return (
    <HudPageLayout>
      <HudHeader
        title="Insight Operations 3D"
        subtitle="Digital twin operacional para projetos, ativos e frentes de serviço."
        icon={<Cuboid className="h-5 w-5" />}
        iconTint="var(--ig-accent)"
        breadcrumbs={[
          { label: "Projetos", href: "/projetos" },
          { label: "Insight Operations 3D" },
        ]}
        statusChips={[
          { label: "Módulo isolado", variant: "info" },
          { label: "Globo realista", variant: "success" },
        ]}
      />

      <HudKpiStrip kpis={kpis} columns={4} className="mb-6" />

      {/* Immersive operational canvas — Cesium fills the section, glass panels float on top. */}
      <section
        className="relative overflow-hidden rounded-2xl border border-ig-border-subtle/60"
        style={{
          height: "78vh",
          minHeight: 640,
          background:
            "radial-gradient(circle at 30% 60%, color-mix(in oklab, var(--ig-accent) 8%, transparent), transparent 60%), var(--ig-bg-canvas)",
        }}
      >
        <div className="absolute inset-0">
          <CesiumOperationsMap />
        </div>

        {/* Floating glass panels — right column, hidden below lg to avoid blocking the globe */}
        <aside className="pointer-events-none absolute right-3 top-3 bottom-3 z-30 hidden w-[320px] flex-col gap-3 lg:flex xl:right-4 xl:top-4 xl:bottom-4 xl:w-[340px]">
          <GlassCard
            title="Casos de uso"
            subtitle="Direção funcional do digital twin"
            icon={<ScanLine className="h-4 w-4" />}
          >
            <div className="space-y-2">
              {useCases.map((item) => {
                const Icon = item.icon;
                return (
                  <div
                    key={item.label}
                    className="flex items-start gap-2.5 rounded-lg border border-ig-border-subtle/40 bg-ig-panel/25 p-2.5 backdrop-blur-sm"
                  >
                    <span
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-ig-border-subtle/50"
                      style={{
                        background: "color-mix(in oklab, var(--ig-accent) 18%, transparent)",
                        color: "var(--ig-accent)",
                      }}
                    >
                      <Icon className="h-3.5 w-3.5" />
                    </span>
                    <div className="min-w-0">
                      <h3 className="text-ig-label text-ig-fg-strong">{item.label}</h3>
                      <p className="mt-0.5 text-ig-caption text-ig-fg-muted">{item.description}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </GlassCard>

          <GlassCard
            title="Foco inicial"
            subtitle="Validação visual e de navegação"
            icon={<MapPinned className="h-4 w-4" />}
          >
            <div className="space-y-2.5">
              <div>
                <p className="text-ig-label text-ig-fg-strong">Brasil e América do Sul</p>
                <p className="mt-0.5 text-ig-caption text-ig-fg-muted">
                  Base visual concentrada na operação nacional, com leitura regional simples e estável.
                </p>
              </div>
              <div className="h-px bg-gradient-to-r from-transparent via-ig-border-subtle to-transparent" />
              <div>
                <p className="text-ig-label text-ig-fg-strong">Sem dados produtivos</p>
                <p className="mt-0.5 text-ig-caption text-ig-fg-muted">
                  Hotspots e indicadores são placeholders controlados para evoluir o módulo sem alterar fontes de dados.
                </p>
              </div>
            </div>
          </GlassCard>
        </aside>
      </section>
    </HudPageLayout>
  );
}

function GlassCard({
  title,
  subtitle,
  icon,
  children,
}: {
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div
      className="pointer-events-auto overflow-hidden rounded-xl border border-ig-border-subtle/50 shadow-xl"
      style={{
        background: "color-mix(in oklab, var(--ig-panel) 55%, transparent)",
        backdropFilter: "blur(14px) saturate(140%)",
        WebkitBackdropFilter: "blur(14px) saturate(140%)",
      }}
    >
      <div className="flex items-start gap-2.5 border-b border-ig-border-subtle/40 px-3 py-2.5">
        {icon && (
          <span
            className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-ig-border-subtle/50"
            style={{
              background: "color-mix(in oklab, var(--ig-accent) 16%, transparent)",
              color: "var(--ig-accent)",
            }}
          >
            {icon}
          </span>
        )}
        <div className="min-w-0">
          <h2 className="text-ig-label text-ig-fg-strong">{title}</h2>
          {subtitle && <p className="mt-0.5 text-ig-caption text-ig-fg-muted">{subtitle}</p>}
        </div>
      </div>
      <div className="px-3 py-3">{children}</div>
    </div>
  );
}
