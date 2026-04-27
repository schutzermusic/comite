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
  PanelLeftClose,
  PanelLeftOpen,
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
  useSidebar,
} from "@/components/ui/sidebar";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { Avatar, AvatarFallback } from "../ui/avatar";
import { cn } from "@/lib/utils";

const ADMIN_STORAGE_KEY = "ig-sidebar-admin-open";
const FINANCE_STORAGE_KEY = "ig-sidebar-finance-open";

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
  const { state, toggleSidebar, isMobile } = useSidebar();
  const isCollapsed = state === "collapsed" && !isMobile;
  const [adminOpen, setAdminOpen] = useState(false);
  const [financeOpen, setFinanceOpen] = useState(false);

  useEffect(() => {
    const storedAdmin = localStorage.getItem(ADMIN_STORAGE_KEY);
    if (storedAdmin !== null) setAdminOpen(storedAdmin === "true");
    const storedFinance = localStorage.getItem(FINANCE_STORAGE_KEY);
    if (storedFinance !== null) {
      setFinanceOpen(storedFinance === "true");
    } else if (pathname.startsWith("/financeiro")) {
      setFinanceOpen(true);
    }
  }, [pathname]);

  const toggleAdmin = () => {
    setAdminOpen((previous) => {
      const next = !previous;
      localStorage.setItem(ADMIN_STORAGE_KEY, String(next));
      return next;
    });
  };

  const toggleFinance = () => {
    setFinanceOpen((previous) => {
      const next = !previous;
      localStorage.setItem(FINANCE_STORAGE_KEY, String(next));
      return next;
    });
  };

  const mainItems = navigationItems.filter((item) => item.section === "main");
  const adminItems = navigationItems.filter((item) => item.section === "admin");

  const renderMenuItems = (items: MenuItem[]) => {
    return items.map((item) => {
      const Icon = item.icon;
      const isParentActive = isRouteActive(pathname, item.href);
      const label = t(item.labelKey);

      if (item.subItems && !isCollapsed) {
        const isOpen = financeOpen;
        return (
          <SidebarMenuItem key={item.href}>
            <SidebarMenuButton
              type="button"
              onClick={toggleFinance}
              className="hud-nav-item hud-nav-item-parent"
              data-active={isParentActive}
              data-open={isOpen}
              aria-expanded={isOpen}
              isActive={isParentActive}
            >
              <Icon className="hud-nav-icon" strokeWidth={1.6} />
              <span className="hud-nav-label">{label}</span>
              <ChevronDown
                className={cn("hud-nav-chevron", isOpen && "hud-nav-chevron-open")}
                strokeWidth={1.8}
              />
            </SidebarMenuButton>
            {isOpen && (
              <ul className="hud-nav-submenu" role="group">
                {item.subItems.map((subItem) => {
                  const isSubActive = pathname === subItem.href;
                  return (
                    <li key={subItem.href}>
                      <Link
                        href={subItem.href}
                        className="hud-nav-subitem"
                        data-active={isSubActive}
                      >
                        <span className="hud-nav-subitem-dot" aria-hidden="true" />
                        <span className="hud-nav-sublabel">{subItem.label}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </SidebarMenuItem>
        );
      }

      const linkContent = (
        <Link href={item.href} aria-label={isCollapsed ? label : undefined}>
          <Icon className="hud-nav-icon" strokeWidth={1.6} />
          <span className="hud-nav-label">{label}</span>
        </Link>
      );

      const button = (
        <SidebarMenuButton
          asChild
          className="hud-nav-item"
          data-active={isParentActive}
          isActive={isParentActive}
        >
          {linkContent}
        </SidebarMenuButton>
      );

      return (
        <SidebarMenuItem key={item.href}>
          {isCollapsed ? (
            <Tooltip>
              <TooltipTrigger asChild>{button}</TooltipTrigger>
              <TooltipContent side="right" sideOffset={10} className="hud-sidebar-tooltip">
                {label}
              </TooltipContent>
            </Tooltip>
          ) : (
            button
          )}
        </SidebarMenuItem>
      );
    });
  };

  const collapseControl = (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={toggleSidebar}
          className="hud-sidebar-collapse-btn"
          aria-label={isCollapsed ? t("expandSidebar") : t("collapseSidebar")}
          aria-expanded={!isCollapsed}
        >
          {isCollapsed ? (
            <PanelLeftOpen className="h-3.5 w-3.5" strokeWidth={1.6} />
          ) : (
            <PanelLeftClose className="h-3.5 w-3.5" strokeWidth={1.6} />
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent side="right" sideOffset={10} className="hud-sidebar-tooltip">
        {isCollapsed ? t("expandSidebar") : t("collapseSidebar")}
      </TooltipContent>
    </Tooltip>
  );

  return (
    <Sidebar className="hud-sidebar border-r-0" collapsible="icon">
      <SidebarHeader className="h-11 min-h-11 shrink-0 p-0 gap-0 flex flex-row items-center justify-center hud-sidebar-header hud-sidebar-header--collapse-only">
        <div className="hud-sidebar-collapse-slot">{collapseControl}</div>
      </SidebarHeader>

      <SidebarContent className="hud-sidebar-content flex-1 overflow-y-auto overflow-x-hidden">
        <SidebarGroup className="hud-sidebar-group">
          <SidebarGroupLabel className="p-0">
            <div className="hud-sidebar-section-label">
              <span className="hud-sidebar-section-dot" />
              <span className="hud-sidebar-section-text">{t("governance")}</span>
            </div>
          </SidebarGroupLabel>
          <SidebarMenu className="hud-sidebar-menu">{renderMenuItems(mainItems)}</SidebarMenu>
        </SidebarGroup>

        {user.role === "admin" && (
          <SidebarGroup className="hud-sidebar-group">
            {isCollapsed ? (
              <div className="hud-sidebar-section-label" aria-hidden="true">
                <span className="hud-sidebar-section-divider" />
              </div>
            ) : (
              <button
                type="button"
                className="hud-sidebar-section-label hud-sidebar-section-trigger"
                onClick={toggleAdmin}
                aria-expanded={adminOpen}
                aria-controls="hud-sidebar-admin-menu"
              >
                <span className="hud-sidebar-section-dot" />
                <span className="hud-sidebar-section-text">{t("administration")}</span>
                {!adminOpen && (
                  <span className="hud-sidebar-section-count">{adminItems.length}</span>
                )}
                <ChevronDown
                  className={cn(
                    "hud-sidebar-section-chevron",
                    adminOpen && "hud-sidebar-section-chevron-open"
                  )}
                  strokeWidth={1.8}
                />
              </button>
            )}

            {(isCollapsed || adminOpen) && (
              <SidebarMenu id="hud-sidebar-admin-menu" className="hud-sidebar-menu">
                {renderMenuItems(adminItems)}
              </SidebarMenu>
            )}
          </SidebarGroup>
        )}
      </SidebarContent>

      <SidebarFooter className="hud-sidebar-footer mt-auto shrink-0">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            {isCollapsed ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    className="hud-user-card hud-user-card--collapsed"
                    type="button"
                    aria-label={user.fullName}
                  >
                    <Avatar className="hud-user-avatar">
                      <AvatarFallback className="hud-user-avatar-fallback">
                        {getUserInitials(user.fullName)}
                      </AvatarFallback>
                    </Avatar>
                    <span className="hud-user-status" aria-hidden="true" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right" sideOffset={10} className="hud-sidebar-tooltip">
                  {user.fullName}
                </TooltipContent>
              </Tooltip>
            ) : (
              <button className="hud-user-card" type="button">
                <Avatar className="hud-user-avatar">
                  <AvatarFallback className="hud-user-avatar-fallback">
                    {getUserInitials(user.fullName)}
                  </AvatarFallback>
                </Avatar>
                <span className="hud-user-meta">
                  <span className="hud-user-name">{user.fullName}</span>
                  <span className="hud-user-role">{user.cargo || user.role}</span>
                </span>
                <span className="hud-user-status" aria-hidden="true" />
              </button>
            )}
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" sideOffset={8} className="hud-sidebar-dropdown w-56 p-1">
            <DropdownMenuItem asChild className="hud-sidebar-dropdown-item">
              <Link href="/configuracoes" className="flex items-center">
                <Settings className="mr-2.5 h-3.5 w-3.5" strokeWidth={1.6} />
                <span>{t("settings")}</span>
              </Link>
            </DropdownMenuItem>
            <div className="mx-2 my-1 h-px bg-ig-border-subtle" />
            <DropdownMenuItem className="hud-sidebar-dropdown-item text-ig-danger">
              <LogOut className="mr-2.5 h-3.5 w-3.5" strokeWidth={1.6} />
              <span>{t("logout")}</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
