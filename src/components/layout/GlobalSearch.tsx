"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Command } from "cmdk";
import { Search } from "lucide-react";
import { HudModal } from "@/components/hud/HudModal";

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
    const handler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((value) => !value);
      }
    };

    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="hidden h-8 w-52 items-center gap-2 rounded-[var(--ig-radius-md)] border border-ig-border bg-ig-panel px-3 text-ig-body-sm text-ig-fg-subtle transition-colors hover:border-ig-border-strong hover:text-ig-fg sm:flex"
      >
        <Search size={12} aria-hidden="true" />
        <span className="flex-1 text-left">Buscar...</span>
        <kbd className="font-mono text-[10px] text-ig-fg-disabled">⌘K</kbd>
      </button>

      <HudModal
        isOpen={open}
        onClose={() => setOpen(false)}
        size="lg"
        showCloseButton={false}
        className="max-w-2xl"
      >
        <Command className="w-full">
          <Command.Input
            placeholder="Buscar páginas, ações, documentos..."
            className="w-full border-0 border-b border-ig-border bg-transparent px-4 py-3 text-ig-body text-ig-fg-strong outline-none placeholder:text-ig-fg-subtle"
          />
          <Command.List className="max-h-80 overflow-y-auto py-2">
            <Command.Empty className="px-4 py-6 text-center text-ig-body-sm text-ig-fg-muted">
              Nenhum resultado encontrado.
            </Command.Empty>
            <Command.Group
              heading="Navegar"
              className="[&_[cmdk-group-heading]]:px-4 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:text-ig-label [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:text-ig-fg-subtle"
            >
              {ROUTES.map((route) => (
                <Command.Item
                  key={route.href}
                  value={route.label}
                  onSelect={() => {
                    router.push(route.href);
                    setOpen(false);
                  }}
                  className="mx-2 flex cursor-pointer items-center gap-3 rounded-lg px-4 py-2 text-ig-body-sm text-ig-fg outline-none data-[selected=true]:bg-ig-panel-hover data-[selected=true]:text-ig-fg-strong"
                >
                  {route.label}
                </Command.Item>
              ))}
            </Command.Group>
            <Command.Group
              heading="Ações rápidas"
              className="[&_[cmdk-group-heading]]:px-4 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:text-ig-label [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:text-ig-fg-subtle"
            >
              {ACTIONS.map((action) => (
                <Command.Item
                  key={action.action}
                  value={action.label}
                  onSelect={() => setOpen(false)}
                  className="mx-2 flex cursor-pointer items-center gap-3 rounded-lg px-4 py-2 text-ig-body-sm text-ig-fg outline-none data-[selected=true]:bg-ig-panel-hover data-[selected=true]:text-ig-fg-strong"
                >
                  {action.label}
                </Command.Item>
              ))}
            </Command.Group>
          </Command.List>
        </Command>
      </HudModal>
    </>
  );
}
