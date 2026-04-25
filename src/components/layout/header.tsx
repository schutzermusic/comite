"use client";

import { SidebarTrigger } from "@/components/ui/sidebar";
import { ThemeToggle } from "./ThemeToggle";
import { HeaderBreadcrumb } from "./HeaderBreadcrumb";
import { GlobalSearch } from "./GlobalSearch";
import { OrgSwitcher } from "./OrgSwitcher";
import NotificationCenter from "./notification-center";
import { UserMenu } from "./UserMenu";

export function Header() {
  return (
    <header className="sticky top-0 z-40 flex h-14 items-center gap-3 border-b border-ig-border-subtle bg-ig-base/80 px-4 backdrop-blur-md">
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
