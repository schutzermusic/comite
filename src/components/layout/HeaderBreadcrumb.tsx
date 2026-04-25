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
    <div className="flex min-w-0 items-center gap-2">
      <span className="hidden text-ig-body-sm text-ig-fg-subtle sm:block">
        INSIGHT
      </span>
      <span className="hidden text-ig-fg-subtle sm:block">/</span>
      <span className="truncate text-ig-body-sm font-medium text-ig-fg-strong">
        {moduleName}
      </span>
    </div>
  );
}
