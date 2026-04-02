"use client";

import {
  Sidebar,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarFooter,
  SidebarGroupLabel,
  SidebarGroup,
  SidebarContent,
  SidebarMenuSub,
  SidebarMenuSubButton
} from "@/components/ui/sidebar";
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from "@/components/ui/collapsible";
import {
  LayoutDashboard,
  Briefcase,
  Calendar,
  FileText,
  Users,
  Bell,
  History,
  Settings,
  LogOut,
  Building2,
  BarChart3,
  ChevronDown,
  Zap,
  Shield,
  FileBadge,
  ShieldAlert,
  FileCheck,
  Network,
  ChevronRight,
  Banknote,
  Receipt,
  Calculator,
  Landmark,
  FileSpreadsheet,
  Lock,
  Wallet,
  CreditCard,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import React from "react";
import { useTranslations } from "next-intl";
import { Avatar, AvatarFallback } from "../ui/avatar";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "../ui/dropdown-menu";
import { InsightLogo } from "./insight-logo";
import { useTheme } from "@/contexts/ThemeContext";

// Mock user data
const useUser = () => {
  const [user] = React.useState({
    fullName: 'Admin User',
    role: 'admin',
    cargo: 'Administrator'
  });
  return { user };
};

const getUserInitials = (name?: string) => {
  if (!name) return "U";
  return name.split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2);
};

type SubMenuItem = {
  href: string;
  label: string;
  icon: React.ElementType;
};

type MenuItem = {
  href: string;
  labelKey: string;
  icon: React.ElementType;
  section: 'main' | 'admin';
  subItems?: SubMenuItem[];
};

const navigationItems: MenuItem[] = [
  { href: "/dashboard", labelKey: "dashboard", icon: LayoutDashboard, section: 'main' },
  {
    href: "/financeiro",
    labelKey: "finance",
    icon: Banknote,
    section: 'main',
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
  { href: "/projetos", labelKey: "projects", icon: Briefcase, section: 'main' },
  { href: "/reunioes", labelKey: "meetings", icon: Calendar, section: 'main' },
  { href: "/pautas", labelKey: "deliberations", icon: FileText, section: 'main' },
  { href: "/riscos", labelKey: "risks", icon: ShieldAlert, section: 'main' },
  { href: "/contratos", labelKey: "contracts", icon: FileCheck, section: 'main' },
  { href: "/workforce-cost", labelKey: "peopleAndCosts", icon: Users, section: 'main' },
  { href: "/organograma", labelKey: "organogram", icon: Network, section: 'main' },
  { href: "/comites", labelKey: "committeeManagement", icon: Building2, section: 'admin' },
  { href: "/membros", labelKey: "manageMembers", icon: Users, section: 'admin' },
  { href: "/roles", labelKey: "globalRoles", icon: Shield, section: 'admin' },
  { href: "/workflows", labelKey: "automations", icon: Zap, section: 'admin' },
  { href: "/atas", labelKey: "minutes", icon: FileBadge, section: 'admin' },
  { href: "/notificacoes", labelKey: "adminNotifications", icon: Bell, section: 'admin' },
  { href: "/relatorios", labelKey: "reports", icon: BarChart3, section: 'admin' },
  { href: "/historico", labelKey: "history", icon: History, section: 'admin' },
];

export function AppSidebar() {
  const pathname = usePathname();
  const { user } = useUser();
  const t = useTranslations('common');
  const { theme } = useTheme();
  const isLight = theme === 'light';
  const activeIconClass = isLight
    ? 'text-lime-300/90 drop-shadow-[0_0_6px_rgba(186,249,26,0.4)]'
    : 'text-cyan-300/90 drop-shadow-[0_0_6px_rgba(6,182,212,0.4)]';
  const activeChevronClass = isLight ? 'text-lime-300/50' : 'text-cyan-300/50';
  const sectionDotGov = isLight
    ? 'bg-lime-400/70 shadow-[0_0_8px_rgba(186,249,26,0.5),0_0_16px_rgba(186,249,26,0.2)]'
    : 'bg-cyan-400/70 shadow-[0_0_8px_rgba(6,182,212,0.5),0_0_16px_rgba(6,182,212,0.2)]';
  const sectionDividerColor = isLight
    ? 'via-lime-400/15'
    : 'via-cyan-400/15';
  const sectionDividerBlur = isLight
    ? 'via-lime-400/10'
    : 'via-cyan-400/10';

  const mainItems = navigationItems.filter(item => item.section === 'main');
  const adminItems = navigationItems.filter(item => item.section === 'admin');

  const renderMenuItems = (items: MenuItem[]) => {
    return items.map((item) => {
      const isParentActive = pathname.startsWith(item.href);

      if (item.subItems) {
        return (
          <Collapsible key={item.href} defaultOpen={isParentActive}>
            <SidebarMenuItem>
              <CollapsibleTrigger asChild>
                <SidebarMenuButton
                  className={`
                    transition-all duration-200 ease-out rounded-[10px] mb-0.5 w-full justify-between
                    hud-sidebar-item group
                    ${isParentActive ? 'hud-sidebar-item-active' : ''}
                  `}
                  isActive={isParentActive}
                >
                  {isParentActive && <div className="hud-sidebar-active-bar" />}
                  <div className="flex items-center gap-3 relative z-[1]">
                    <item.icon className={`w-4 h-4 stroke-[1.8] transition-colors ${isParentActive ? activeIconClass : 'opacity-50'}`} />
                    <span className="text-[11px] font-medium tracking-[0.1em] uppercase">{t(item.labelKey)}</span>
                  </div>
                  <ChevronDown className="w-3 h-3 text-white/20 transition-transform duration-200 group-data-[state=open]:rotate-180 relative z-[1]" />
                </SidebarMenuButton>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <SidebarMenuSub className={`ml-5 mt-1 border-l ${isLight ? 'border-lime-500/[0.08]' : 'border-cyan-500/[0.08]'} pl-3`}>
                  {item.subItems.map(subItem => {
                    const isSubActive = pathname === subItem.href;
                    return (
                      <SidebarMenuItem key={subItem.href}>
                        <Link href={subItem.href} passHref>
                          <SidebarMenuSubButton
                            isActive={isSubActive}
                            className={`
                              mt-0.5 hud-sidebar-item rounded-lg
                              ${isSubActive ? 'hud-sidebar-item-active' : ''}
                            `}
                          >
                            {isSubActive && <div className="hud-sidebar-active-bar" />}
                            <subItem.icon className={`w-3.5 h-3.5 stroke-[1.8] transition-colors ${isSubActive ? (isLight ? 'text-lime-300/80' : 'text-cyan-300/80') : 'opacity-40'}`} />
                            <span className="text-[10px] font-medium tracking-[0.1em] uppercase relative z-[1]">{subItem.label}</span>
                          </SidebarMenuSubButton>
                        </Link>
                      </SidebarMenuItem>
                    )
                  })}
                </SidebarMenuSub>
              </CollapsibleContent>
            </SidebarMenuItem>
          </Collapsible>
        )
      }

      return (
        <SidebarMenuItem key={item.href}>
          <Link href={item.href}>
            <SidebarMenuButton
              className={`
                transition-all duration-200 ease-out rounded-[10px] mb-0.5 w-full relative group
                hud-sidebar-item
                ${isParentActive ? 'hud-sidebar-item-active' : ''}
              `}
              isActive={isParentActive}
            >
              {isParentActive && <div className="hud-sidebar-active-bar" />}

              <div className="flex items-center gap-3 w-full pl-1 relative z-[1]">
                <item.icon
                  className={`w-4 h-4 stroke-[1.8] transition-colors ${isParentActive
                    ? activeIconClass
                    : 'opacity-50'
                  }`}
                />
                <span className="text-[11px] font-medium tracking-[0.1em] uppercase">{t(item.labelKey)}</span>
              </div>

              <ChevronRight className={`
                w-3 h-3 transition-all duration-200 relative z-[1]
                ${isParentActive
                  ? `${activeChevronClass} opacity-100`
                  : 'text-white/15 opacity-0 group-hover:opacity-100 translate-x-0 group-hover:translate-x-0.5'
                }
              `} />
            </SidebarMenuButton>
          </Link>
        </SidebarMenuItem>
      );
    });
  };

  return (
    <Sidebar className="hud-sidebar border-r-0">
      {/* Inner vignette shadow for depth */}
      <div className="hud-sidebar-inner-vignette" />

      {/* Brand Area */}
      <SidebarHeader className="hud-sidebar-header shrink-0">
        <div className="flex items-center justify-center py-2">
          <div className="relative group">
            <div className="relative z-10">
              <InsightLogo
                width={150}
                height={40}
                className="h-auto w-auto opacity-85 group-hover:opacity-100 transition-opacity duration-300"
                priority
              />
            </div>
            <div className={`absolute -inset-4 bg-gradient-to-r ${isLight ? 'from-lime-500/0 via-lime-500/8 to-emerald-500/6' : 'from-cyan-500/0 via-cyan-500/8 to-emerald-500/6'} rounded-xl opacity-0 group-hover:opacity-100 transition-opacity duration-500 blur-xl -z-10`} />
          </div>
        </div>
      </SidebarHeader>

      {/* Navigation */}
      <SidebarContent className="hud-sidebar-content flex-1 overflow-y-auto overflow-x-hidden">
        {/* Scanline overlay for depth texture */}
        <div className="hud-sidebar-scanline" />

        <SidebarGroup>
          <SidebarGroupLabel className="px-2 py-1.5 mb-1.5">
            <div className="hud-sidebar-section-label">
              <div className={`w-1.5 h-1.5 rounded-full ${sectionDotGov}`} />
              {t('governance')}
            </div>
          </SidebarGroupLabel>

          <SidebarMenu className="space-y-[3px]">
            {renderMenuItems(mainItems)}
          </SidebarMenu>
        </SidebarGroup>

        {user?.role === 'admin' && (
          <SidebarGroup className="mt-4">
            {/* Section divider — neon gradient line */}
            <div className="mx-3 mb-3 relative">
              <div className={`h-px bg-gradient-to-r from-transparent ${sectionDividerColor} to-transparent`} />
              <div className={`absolute inset-0 h-px bg-gradient-to-r from-transparent ${sectionDividerBlur} to-transparent blur-sm`} />
            </div>

            <SidebarGroupLabel className="px-2 py-1.5 mb-1.5">
              <div className="hud-sidebar-section-label">
                <div className="w-1.5 h-1.5 rounded-full bg-purple-400/70 shadow-[0_0_8px_rgba(168,85,247,0.4),0_0_16px_rgba(168,85,247,0.15)]" />
                {t('administration')}
              </div>
            </SidebarGroupLabel>

            <SidebarMenu className="space-y-[3px]">
              {renderMenuItems(adminItems)}
            </SidebarMenu>
          </SidebarGroup>
        )}
      </SidebarContent>

      {/* Footer */}
      <SidebarFooter className="hud-sidebar-footer mt-auto shrink-0">
        {user && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="flex items-center gap-3 w-full hud-sidebar-item rounded-[10px] p-2.5 group !border-transparent">
                <Avatar className={`w-8 h-8 ring-1 ${isLight ? 'ring-lime-500/20 shadow-[0_0_12px_rgba(186,249,26,0.15),0_2px_8px_rgba(0,0,0,0.15)]' : 'ring-cyan-500/20 shadow-[0_0_12px_rgba(6,182,212,0.15),0_2px_8px_rgba(0,0,0,0.3)]'}`}>
                  <AvatarFallback className={`font-semibold text-white text-[10px] ${isLight ? 'bg-gradient-to-br from-lime-600 to-emerald-600' : 'bg-gradient-to-br from-cyan-600 to-emerald-600'}`}>
                    {getUserInitials(user.fullName)}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 text-left min-w-0 relative z-[1]">
                  <p className="font-medium text-white/80 text-[12px] tracking-wide truncate">{user.fullName}</p>
                  <p className="text-[10px] truncate text-white/30 font-medium tracking-wider">{user.cargo || user.role}</p>
                </div>
                <div className={`w-1.5 h-1.5 rounded-full ${isLight ? 'bg-lime-400/80 shadow-[0_0_6px_rgba(186,249,26,0.6),0_0_14px_rgba(186,249,26,0.3)]' : 'bg-emerald-400/80 shadow-[0_0_6px_rgba(16,185,129,0.6),0_0_14px_rgba(16,185,129,0.3)]'} relative z-[1]`} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              sideOffset={8}
              className="w-56 rounded-xl border p-1"
              style={{
                background: isLight
                  ? 'linear-gradient(160deg, rgba(14, 24, 20, 0.97) 0%, rgba(10, 18, 14, 0.98) 100%)'
                  : 'linear-gradient(160deg, rgba(6, 24, 18, 0.97) 0%, rgba(4, 16, 12, 0.98) 100%)',
                borderColor: isLight ? 'rgba(186, 249, 26, 0.14)' : 'rgba(6, 182, 212, 0.14)',
                backdropFilter: 'blur(32px) saturate(160%)',
                WebkitBackdropFilter: 'blur(32px) saturate(160%)',
                boxShadow: isLight
                  ? '0 24px 80px rgba(0, 0, 0, 0.30), 0 8px 32px rgba(0, 0, 0, 0.15), 0 0 1px rgba(186, 249, 26, 0.2), inset 0 1px 0 rgba(255, 255, 255, 0.06)'
                  : '0 24px 80px rgba(0, 0, 0, 0.60), 0 8px 32px rgba(0, 0, 0, 0.30), 0 0 1px rgba(6, 182, 212, 0.25), inset 0 1px 0 rgba(255, 255, 255, 0.06)',
              }}
            >
              <DropdownMenuItem asChild className={`cursor-pointer text-white/50 hover:text-white ${isLight ? 'hover:bg-lime-500/[0.06] focus:bg-lime-500/[0.06]' : 'hover:bg-cyan-500/[0.06] focus:bg-cyan-500/[0.06]'} rounded-lg transition-all duration-150`}>
                <Link href="/configuracoes" className="flex items-center">
                  <Settings className="w-3.5 h-3.5 mr-2.5 stroke-[1.8]" />
                  <span className="text-[12px] font-medium tracking-wide">{t('settings')}</span>
                </Link>
              </DropdownMenuItem>
              <div className="mx-2 my-1 h-px bg-gradient-to-r from-transparent via-white/[0.06] to-transparent" />
              <DropdownMenuItem
                onClick={() => { /* handleLogout */ }}
                className="text-red-400 cursor-pointer hover:bg-red-500/10 focus:bg-red-500/10 rounded-lg transition-all duration-150"
              >
                <LogOut className="w-3.5 h-3.5 mr-2.5 stroke-[1.8]" />
                <span className="text-[12px] font-medium tracking-wide">{t('logout')}</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </SidebarFooter>
    </Sidebar>
  );
}
