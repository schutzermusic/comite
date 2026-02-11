"use client";

import { Menu } from "lucide-react";
import { SidebarTrigger } from "../ui/sidebar";
import { InsightLogo } from "./insight-logo";

export function Header() {
  return (
    <header className="px-4 sm:px-6 py-3 sm:py-4 visionpro-glass-header">
      <div className="flex items-center justify-between relative w-full">
        {/* Botão Menu - Mobile e Tablet (até lg) */}
        <div className="lg:hidden flex-shrink-0 z-10">
          <SidebarTrigger className="p-2 rounded-xl transition-all border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.04)] hover:border-[rgba(0,200,255,0.35)] hover:shadow-[0_0_14px_rgba(0,200,255,0.18)]">
            <Menu className="w-5 h-5 md:w-6 md:h-6 text-[rgba(255,255,255,0.85)]" />
          </SidebarTrigger>
        </div>

        {/* Logo Centralizada - Mobile e Tablet */}
        <div className="lg:hidden absolute left-1/2 top-1/2 transform -translate-x-1/2 -translate-y-1/2">
          <InsightLogo
            variant="compact"
            className="h-12 sm:h-14 md:h-16 w-auto"
            priority
          />
        </div>

        {/* Espaço vazio para balancear o layout (mesmo tamanho do botão menu) */}
        <div className="lg:hidden w-10 sm:w-12 flex-shrink-0"></div>

        {/* Desktop (lg+) - Espaço vazio */}
        <div className="hidden lg:block flex-1"></div>
      </div>
    </header>
  );
}
