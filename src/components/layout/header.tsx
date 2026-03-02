"use client";

import { Menu } from "lucide-react";
import { SidebarTrigger } from "../ui/sidebar";
import { usePathname } from "next/navigation";

export function Header() {
  const pathname = usePathname();
  if (pathname === "/dashboard") return null;

  return (
    <header className="px-4 sm:px-6 py-3 sm:py-4 visionpro-glass-header">
      <div className="flex items-center justify-between relative w-full">
        {/* Botão Menu - Mobile e Tablet (até lg) */}
        <div className="lg:hidden flex-shrink-0 z-10">
          <SidebarTrigger className="p-2 rounded-xl transition-all border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.04)] hover:border-[rgba(0,200,255,0.35)] hover:shadow-[0_0_14px_rgba(0,200,255,0.18)]">
            <Menu className="w-5 h-5 md:w-6 md:h-6 text-[rgba(255,255,255,0.85)]" />
          </SidebarTrigger>
        </div>

        {/* Desktop (lg+) - Espaço vazio */}
        <div className="hidden lg:block flex-1"></div>
      </div>
    </header>
  );
}
