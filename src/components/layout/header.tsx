"use client";

import { Menu } from "lucide-react";
import { SidebarTrigger } from "../ui/sidebar";
import { usePathname } from "next/navigation";
import { ThemeToggle } from "./ThemeToggle";

export function Header() {
  const pathname = usePathname();
  if (pathname === "/dashboard") return null;

  return (
    <header className="px-4 sm:px-6 py-3 sm:py-4 visionpro-glass-header">
      <div className="flex items-center justify-between relative w-full">
        {/* Botão Menu - Mobile e Tablet (até lg) */}
        <div className="lg:hidden flex-shrink-0 z-10">
          <SidebarTrigger className="p-2 rounded-xl transition-all border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.04)] hover:border-[rgba(0,200,255,0.35)] hover:shadow-[0_0_14px_rgba(0,200,255,0.18)] light:border-[rgba(0,0,0,0.08)] light:bg-[rgba(0,0,0,0.03)]">
            <Menu className="w-5 h-5 md:w-6 md:h-6 text-[rgba(255,255,255,0.85)] light:text-[rgba(0,0,0,0.7)]" />
          </SidebarTrigger>
        </div>

        {/* Desktop (lg+) - Espaço vazio */}
        <div className="hidden lg:block flex-1"></div>

        {/* Theme toggle — always visible */}
        <div className="flex items-center gap-3 flex-shrink-0">
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
