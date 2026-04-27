"use client";

import { SidebarTrigger } from "@/components/ui/sidebar";
import { ThemeToggle } from "./ThemeToggle";
import { HeaderBreadcrumb } from "./HeaderBreadcrumb";
import NotificationCenter from "./notification-center";

export function Header() {
  return (
    <header className="app-top-header sticky top-0 z-40 flex h-11 items-center gap-2 px-4">
      <SidebarTrigger className="app-header-icon-button lg:hidden" />
      <HeaderBreadcrumb />
      <div className="flex-1" />
      <div className="app-header-control-cluster">
        <div className="app-header-icon-wrap">
          <NotificationCenter />
        </div>
        <span className="app-header-divider" aria-hidden="true" />
        <ThemeToggle />
      </div>
    </header>
  );
}
