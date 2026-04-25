"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Bell,
  Building2,
  KeyRound,
  Palette,
  Puzzle,
  ScrollText,
  Shield,
  User,
} from "lucide-react";
import { cn } from "@/lib/utils";

const SETTINGS_LINKS = [
  { href: "/configuracoes/conta", label: "Minha Conta", icon: User },
  { href: "/configuracoes/empresa", label: "Empresa", icon: Building2 },
  { href: "/configuracoes/notificacoes", label: "Notificações", icon: Bell },
  { href: "/configuracoes/integracoes", label: "Integrações", icon: Puzzle },
  { href: "/configuracoes/api-tokens", label: "API & Tokens", icon: KeyRound },
  { href: "/configuracoes/aparencia", label: "Aparência", icon: Palette },
  { href: "/configuracoes/seguranca", label: "Segurança", icon: Shield },
  { href: "/configuracoes/auditoria", label: "Auditoria", icon: ScrollText },
];

export function SettingsNav() {
  const pathname = usePathname();

  return (
    <aside className="w-56 flex-shrink-0 border-r border-ig-border px-3 py-8">
      <p className="mb-4 px-3 text-ig-label text-ig-fg-subtle ig-label-upper">
        Configurações
      </p>
      <nav className="flex flex-col gap-0.5">
        {SETTINGS_LINKS.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || pathname.startsWith(`${href}/`);

          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex items-center gap-2.5 rounded-[var(--ig-radius-md)] px-3 py-2 text-ig-body-sm transition-colors",
                active
                  ? "bg-ig-accent-weak font-medium text-ig-fg-strong"
                  : "text-ig-fg-muted hover:bg-ig-panel-hover hover:text-ig-fg",
              )}
            >
              <Icon
                size={14}
                className={cn("shrink-0", active && "text-ig-accent")}
              />
              <span className="truncate">{label}</span>
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
