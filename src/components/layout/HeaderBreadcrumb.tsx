"use client";

import { usePathname } from "next/navigation";

const ROUTE_LABELS: Record<string, string> = {
  dashboard: "Dashboard",
  financeiro: "Financeiro",
  projetos: "Projetos",
  contracts: "Contratos",
  contratos: "Contratos",
  riscos: "Riscos",
  reunioes: "Reuniões",
  pautas: "Deliberações",
  "workforce-cost": "Pessoas & Custos",
  organograma: "Organograma",
  configuracoes: "Configurações",
  workflows: "Workflows",
  relatorios: "Relatórios",
  historico: "Histórico",
  atas: "Atas",
  comites: "Comitês",
  membros: "Membros",
  roles: "Permissões",
};

export function HeaderBreadcrumb() {
  const pathname = usePathname();
  const segments = pathname.split("/").filter(Boolean);
  const moduleName = ROUTE_LABELS[segments[0]] ?? segments[0] ?? "Dashboard";

  return (
    <div className="app-header-breadcrumb">
      <span className="app-header-breadcrumb-eyebrow">INSIGHT</span>
      <span className="app-header-breadcrumb-sep" aria-hidden="true">/</span>
      <span className="app-header-breadcrumb-title">{moduleName}</span>
    </div>
  );
}
