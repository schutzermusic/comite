# TASK-008 · Header global premium

**Fase:** F2 — Shell
**PR:** PR-08
**Dependências:** TASK-006
**Pode rodar em paralelo com:** TASK-007, TASK-009
**Owner-profile:** Frontend Engineer
**Estimativa:** 6–8h

---

## Contexto

O header atual é quasi-vazio (só `SidebarTrigger` + `ThemeToggle`) e invisível no Dashboard. Esta tarefa cria um header rico e consistente em todas as rotas, com breadcrumb dinâmico, search global com `Cmd+K`, org switcher, notificações e user menu integrados.

---

## Escopo de arquivos

| Ação | Arquivo |
|---|---|
| **Reescrever** | `src/components/layout/header.tsx` |
| **Criar** | `src/components/layout/HeaderBreadcrumb.tsx` |
| **Criar** | `src/components/layout/GlobalSearch.tsx` |
| **Criar** | `src/components/layout/OrgSwitcher.tsx` |
| **Criar** | `src/components/layout/UserMenu.tsx` |
| **Modificar** | `src/app/(main)/layout.tsx` (mover `NotificationCenter` para dentro do header) |
| **Modificar** | `src/app/(main)/dashboard/page.tsx` (remover título/subtítulo do `DashboardHudBar`) |
| **Instalar dependência** | `cmdk@^1.0.0` (`npm install cmdk`) |

---

## Layout do header

```tsx
// src/components/layout/header.tsx
"use client";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { HeaderBreadcrumb } from "./HeaderBreadcrumb";
import { GlobalSearch } from "./GlobalSearch";
import { OrgSwitcher } from "./OrgSwitcher";
import { NotificationCenter } from "./notification-center";
import { UserMenu } from "./UserMenu";

export function Header() {
  return (
    <header className="
      h-14 flex items-center gap-3 px-4
      border-b border-ig-border-subtle
      bg-ig-base/80 backdrop-blur-md
      sticky top-0 z-40
    ">
      <SidebarTrigger className="lg:hidden" />
      <HeaderBreadcrumb />
      <div className="flex-1" />
      <GlobalSearch />
      <OrgSwitcher />
      <NotificationCenter />
      <ThemeToggle />
      <UserMenu />
    </header>
  );
}
```

> **Remover** o `if (pathname === '/dashboard') return null` que existia no header antigo — o header agora aparece em **todas** as rotas.

---

## HeaderBreadcrumb

```tsx
// src/components/layout/HeaderBreadcrumb.tsx
"use client";
import { usePathname } from "next/navigation";

const ROUTE_LABELS: Record<string, string> = {
  dashboard: "Dashboard",
  financeiro: "Financeiro",
  projetos: "Projetos",
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
  const moduleName = ROUTE_LABELS[segments[1]] ?? segments[1] ?? "—";

  return (
    <div className="flex items-center gap-2 min-w-0">
      <span className="text-ig-body-sm text-ig-fg-subtle hidden sm:block">
        INSIGHT
      </span>
      <span className="text-ig-fg-subtle hidden sm:block">/</span>
      <span className="text-ig-body-sm text-ig-fg-strong font-medium truncate">
        {moduleName}
      </span>
    </div>
  );
}
```

---

## GlobalSearch

```tsx
// src/components/layout/GlobalSearch.tsx
"use client";
import { useState, useEffect } from "react";
import { Search } from "lucide-react";
import { Command } from "cmdk";
import { HudModal } from "@/components/hud/HudModal";
import { useRouter } from "next/navigation";

const ROUTES = [
  { label: "Dashboard", href: "/dashboard" },
  { label: "Financeiro", href: "/financeiro" },
  { label: "Projetos", href: "/projetos" },
  { label: "Contratos", href: "/contratos" },
  { label: "Riscos", href: "/riscos" },
  { label: "Reuniões", href: "/reunioes" },
  { label: "Deliberações", href: "/pautas" },
  { label: "Pessoas & Custos", href: "/workforce-cost" },
  { label: "Organograma", href: "/organograma" },
  { label: "Configurações", href: "/configuracoes" },
];

const ACTIONS = [
  { label: "Nova pauta", action: "nova-pauta" },
  { label: "Novo contrato", action: "novo-contrato" },
  { label: "Nova reunião", action: "nova-reuniao" },
];

export function GlobalSearch() {
  const [open, setOpen] = useState(false);
  const router = useRouter();

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="
          hidden sm:flex items-center gap-2
          w-52 h-8 px-3 rounded-[var(--ig-radius-md)]
          bg-ig-panel border border-ig-border
          text-ig-fg-subtle text-ig-body-sm
          hover:border-ig-border-strong hover:text-ig-fg
          transition-colors
        "
      >
        <Search size={12} />
        <span className="flex-1 text-left">Buscar…</span>
        <kbd className="text-[10px] font-mono text-ig-fg-disabled">⌘K</kbd>
      </button>

      {open && (
        <HudModal onClose={() => setOpen(false)} elevation={4}>
          <Command className="w-full">
            <Command.Input
              placeholder="Buscar páginas, ações, documentos…"
              className="
                w-full px-4 py-3 bg-transparent border-0 border-b border-ig-border
                text-ig-body text-ig-fg-strong outline-none
                placeholder:text-ig-fg-subtle
              "
            />
            <Command.List className="max-h-80 overflow-y-auto py-2">
              <Command.Group heading="Navegar">
                {ROUTES.map((r) => (
                  <Command.Item
                    key={r.href}
                    onSelect={() => { router.push(r.href); setOpen(false); }}
                    className="
                      flex items-center gap-3 px-4 py-2 cursor-pointer rounded-lg mx-2
                      text-ig-body-sm text-ig-fg
                      data-[selected]:bg-ig-panel-hover data-[selected]:text-ig-fg-strong
                    "
                  >
                    {r.label}
                  </Command.Item>
                ))}
              </Command.Group>
              <Command.Group heading="Ações rápidas">
                {ACTIONS.map((a) => (
                  <Command.Item
                    key={a.action}
                    onSelect={() => setOpen(false)}
                    className="
                      flex items-center gap-3 px-4 py-2 cursor-pointer rounded-lg mx-2
                      text-ig-body-sm text-ig-fg
                      data-[selected]:bg-ig-panel-hover
                    "
                  >
                    {a.label}
                  </Command.Item>
                ))}
              </Command.Group>
            </Command.List>
          </Command>
        </HudModal>
      )}
    </>
  );
}
```

---

## OrgSwitcher (mínimo viável)

```tsx
// src/components/layout/OrgSwitcher.tsx
"use client";
import { Building2, ChevronDown } from "lucide-react";

export function OrgSwitcher() {
  return (
    <button className="
      hidden md:flex items-center gap-1.5 h-8 px-2 rounded-[var(--ig-radius-md)]
      text-ig-body-sm text-ig-fg-muted
      hover:bg-ig-panel-hover hover:text-ig-fg
      transition-colors
    ">
      <Building2 size={13} className="text-ig-accent" />
      <span>INSIGHT Corp</span>
      <ChevronDown size={11} className="text-ig-fg-disabled" />
    </button>
  );
}
```

---

## UserMenu

```tsx
// src/components/layout/UserMenu.tsx
"use client";
import { User } from "lucide-react";

export function UserMenu() {
  return (
    <button className="
      flex items-center justify-center w-8 h-8 rounded-full
      bg-ig-accent-weak text-ig-accent text-ig-body-sm font-semibold
      hover:bg-ig-accent hover:text-white transition-colors
    ">
      <User size={14} />
    </button>
  );
}
```

---

## Modificações no layout

Em `src/app/(main)/layout.tsx`:
- Remover: `<NotificationCenter hiddenOnDashboard />` (que estava fixed top-right).
- O `NotificationCenter` agora é chamado dentro do `<Header>`.

Em `src/app/(main)/dashboard/page.tsx`:
- `DashboardHudBar` não deve mais renderizar título/subtítulo da página (o breadcrumb do header supre isso). Manter apenas filtros de período e mode.

---

## Acceptance criteria

- [ ] Header visível em **todas** as rotas, inclusive `/dashboard`.
- [ ] `Cmd+K` / `Ctrl+K` abre palette de busca de qualquer rota.
- [ ] Navegação via palette funciona (router.push).
- [ ] `NotificationCenter` aparece dentro do header, não mais flutuante.
- [ ] Dashboard sem título duplicado (HudBar + breadcrumb).
- [ ] `OrgSwitcher` exibe "INSIGHT Corp" com dropdown abrindo (pode ser vazio por ora).
- [ ] `npm install cmdk` foi executado e `package.json` atualizado.
- [ ] `npm run build` passa.
