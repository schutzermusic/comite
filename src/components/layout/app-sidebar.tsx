"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  BarChart3,
  Banknote,
  Bell,
  Briefcase,
  Building2,
  Calculator,
  Calendar,
  ChevronDown,
  ChevronRight,
  CreditCard,
  FileBadge,
  FileCheck,
  FileSpreadsheet,
  FileText,
  History,
  Landmark,
  LayoutDashboard,
  Lock,
  LogOut,
  Network,
  Receipt,
  Settings,
  Shield,
  ShieldAlert,
  Users,
  Wallet,
  Zap,
  type LucideIcon,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
} from "@/components/ui/sidebar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { Avatar, AvatarFallback } from "../ui/avatar";
import { InsightLogo } from "./insight-logo";
import { cn } from "@/lib/utils";

const ADMIN_STORAGE_KEY = "ig-sidebar-admin-open";

type User = {
  fullName: string;
  role: "admin";
  cargo: string;
};

const useUser = () => {
  const [user] = useState<User>({
    fullName: "Admin User",
    role: "admin",
    cargo: "Administrator",
  });

  return { user };
};

const getUserInitials = (name?: string) => {
  if (!name) return "U";
  return name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
};

type SubMenuItem = {
  href: string;
  label: string;
  icon: LucideIcon;
};

type MenuItem = {
  href: string;
  labelKey: string;
  icon: LucideIcon;
  section: "main" | "admin";
  subItems?: SubMenuItem[];
};

const navigationItems: MenuItem[] = [
  { href: "/dashboard", labelKey: "dashboard", icon: LayoutDashboard, section: "main" },
  {
    href: "/financeiro",
    labelKey: "finance",
    icon: Banknote,
    section: "main",
    subItems: [
      { href: "/financeiro", label: "Visão Geral", icon: LayoutDashboard },
      { href: "/financeiro/lancamentos", label: "Lançamentos", icon: Receipt },
      { href: "/financeiro/contas", label: "Contas a Pagar/Receber", icon: CreditCard },
      { href: "/financeiro/folha", label: "Folha Mensal", icon: FileSpreadsheet },
      { href: "/financeiro/alocacao", label: "Alocação", icon: Calculator },
      { href: "/financeiro/bancos", label: "Bancos e Juros", icon: Landmark },
      { href: "/financeiro/tributos", label: "Impostos", icon: Wallet },
      { href: "/financeiro/fechamento", label: "Fechamento", icon: Lock },
    ],
  },
  { href: "/projetos", labelKey: "projects", icon: Briefcase, section: "main" },
  { href: "/reunioes", labelKey: "meetings", icon: Calendar, section: "main" },
  { href: "/pautas", labelKey: "deliberations", icon: FileText, section: "main" },
  { href: "/riscos", labelKey: "risks", icon: ShieldAlert, section: "main" },
  { href: "/contratos", labelKey: "contracts", icon: FileCheck, section: "main" },
  { href: "/workforce-cost", labelKey: "peopleAndCosts", icon: Users, section: "main" },
  { href: "/organograma", labelKey: "organogram", icon: Network, section: "main" },
  { href: "/comites", labelKey: "committeeManagement", icon: Building2, section: "admin" },
  { href: "/membros", labelKey: "manageMembers", icon: Users, section: "admin" },
  { href: "/roles", labelKey: "globalRoles", icon: Shield, section: "admin" },
  { href: "/workflows", labelKey: "automations", icon: Zap, section: "admin" },
  { href: "/atas", labelKey: "minutes", icon: FileBadge, section: "admin" },
  { href: "/notificacoes", labelKey: "adminNotifications", icon: Bell, section: "admin" },
  { href: "/relatorios", labelKey: "reports", icon: BarChart3, section: "admin" },
  { href: "/historico", labelKey: "history", icon: History, section: "admin" },
];

const isRouteActive = (pathname: string, href: string) => {
  if (href === "/financeiro") {
    return pathname === href || pathname.startsWith(`${href}/`);
  }

  return pathname === href || pathname.startsWith(`${href}/`);
};

export function AppSidebar() {
  const pathname = usePathname();
  const { user } = useUser();
  const t = useTranslations("common");
  const [adminOpen, setAdminOpen] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem(ADMIN_STORAGE_KEY);
    if (stored !== null) setAdminOpen(stored === "true");
  }, []);

  const toggleAdmin = () => {
    setAdminOpen((previous) => {
      const next = !previous;
      localStorage.setItem(ADMIN_STORAGE_KEY, String(next));
      return next;
    });
  };

  const mainItems = navigationItems.filter((item) => item.section === "main");
  const adminItems = navigationItems.filter((item) => item.section === "admin");

  const renderMenuItems = (items: MenuItem[]) => {
    return items.map((item) => {
      const Icon = item.icon;
      const isParentActive = isRouteActive(pathname, item.href);

      if (item.subItems) {
        return (
          <SidebarMenuItem key={item.href}>
            <SidebarMenuButton
              className="hud-sidebar-item"
              data-active={isParentActive}
              isActive={isParentActive}
            >
              <Icon className="sidebar-icon h-4 w-4 stroke-[1.8]" />
              <span>{t(item.labelKey)}</span>
              <ChevronDown className="ml-auto h-3.5 w-3.5 text-ig-fg-subtle transition-transform duration-150 group-data-[state=open]/collapsible:rotate-180" />
            </SidebarMenuButton>
            <SidebarMenu className="hud-sidebar-submenu">
              {item.subItems.map((subItem) => {
                const SubIcon = subItem.icon;
                const isSubActive = pathname === subItem.href;

                return (
                  <SidebarMenuItem key={subItem.href}>
                    <Link
                      href={subItem.href}
                      className="hud-sidebar-item hud-sidebar-subitem"
                      data-active={isSubActive}
                    >
                      <SubIcon className="sidebar-icon h-3.5 w-3.5 stroke-[1.8]" />
                      <span>{subItem.label}</span>
                    </Link>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarMenuItem>
        );
      }

      return (
        <SidebarMenuItem key={item.href}>
          <SidebarMenuButton
            asChild
            className="hud-sidebar-item"
            data-active={isParentActive}
            isActive={isParentActive}
          >
            <Link href={item.href}>
              <Icon className="sidebar-icon h-4 w-4 stroke-[1.8]" />
              <span>{t(item.labelKey)}</span>
              <ChevronRight className="ml-auto h-3.5 w-3.5 text-ig-fg-subtle opacity-0 transition-all duration-150 group-hover/menu-item:translate-x-0.5 group-hover/menu-item:opacity-100" />
            </Link>
          </SidebarMenuButton>
        </SidebarMenuItem>
      );
    });
  };

  return (
    <Sidebar className="hud-sidebar border-r-0">
      <SidebarHeader className="hud-sidebar-header shrink-0">
        <div className="flex items-center justify-center py-2">
          <InsightLogo
            width={150}
            height={40}
            className="h-auto w-auto opacity-90 transition-opacity duration-150 hover:opacity-100"
            priority
          />
        </div>
      </SidebarHeader>

      <SidebarContent className="hud-sidebar-content flex-1 overflow-y-auto overflow-x-hidden">
        <SidebarGroup>
          <SidebarGroupLabel className="p-0">
            <div className="hud-sidebar-section-label">
              <span className="hud-sidebar-section-dot" />
              {t("governance")}
            </div>
          </SidebarGroupLabel>

          <SidebarMenu className="gap-1">{renderMenuItems(mainItems)}</SidebarMenu>
        </SidebarGroup>

        {user.role === "admin" && (
          <SidebarGroup className="mt-3">
            <button
              type="button"
              className="hud-sidebar-section-label hud-sidebar-admin-trigger"
              onClick={toggleAdmin}
              aria-expanded={adminOpen}
              aria-controls="hud-sidebar-admin-menu"
            >
              <span className="hud-sidebar-section-dot" />
              <span>
                {t("administration")}
                {!adminOpen && <span className="ml-1"> ({adminItems.length})</span>}
              </span>
              <ChevronDown
                className={cn(
                  "ml-auto h-3.5 w-3.5 transition-transform duration-150",
                  adminOpen && "rotate-180",
                )}
              />
            </button>

            {adminOpen && (
              <SidebarMenu id="hud-sidebar-admin-menu" className="mt-1 gap-1">
                {renderMenuItems(adminItems)}
              </SidebarMenu>
            )}
          </SidebarGroup>
        )}
      </SidebarContent>

      <SidebarFooter className="hud-sidebar-footer mt-auto shrink-0">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="hud-sidebar-item w-full">
              <Avatar className="h-8 w-8 ring-1 ring-ig-border-focus">
                <AvatarFallback className="bg-ig-accent-weak text-[10px] font-semibold text-ig-accent">
                  {getUserInitials(user.fullName)}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1 text-left">
                <p className="truncate text-[13px] font-medium text-ig-fg-strong">{user.fullName}</p>
                <p className="truncate text-xs text-ig-fg-muted">{user.cargo || user.role}</p>
              </div>
              <span className="h-1.5 w-1.5 rounded-full bg-ig-accent" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" sideOffset={8} className="hud-sidebar-dropdown w-56 p-1">
            <DropdownMenuItem asChild className="hud-sidebar-dropdown-item">
              <Link href="/configuracoes" className="flex items-center">
                <Settings className="mr-2.5 h-3.5 w-3.5 stroke-[1.8]" />
                <span>{t("settings")}</span>
              </Link>
            </DropdownMenuItem>
            <div className="mx-2 my-1 h-px bg-ig-border-subtle" />
            <DropdownMenuItem className="hud-sidebar-dropdown-item text-ig-danger">
              <LogOut className="mr-2.5 h-3.5 w-3.5 stroke-[1.8]" />
              <span>{t("logout")}</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
