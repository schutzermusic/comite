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
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import React from "react";
import { Avatar, AvatarFallback } from "../ui/avatar";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } from "../ui/dropdown-menu";
import { InsightLogo } from "./insight-logo";

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
  label: string;
  icon: React.ElementType;
  section: 'main' | 'admin';
  subItems?: SubMenuItem[];
};

const navigationItems: MenuItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, section: 'main' },
  { href: "/projetos", label: "Projetos", icon: Briefcase, section: 'main' },
  { href: "/reunioes", label: "Reuniões", icon: Calendar, section: 'main' },
  { href: "/pautas", label: "Deliberações", icon: FileText, section: 'main' },
  { href: "/riscos", label: "Riscos", icon: ShieldAlert, section: 'main' },
  { href: "/contratos", label: "Contratos", icon: FileCheck, section: 'main' },
  { href: "/workforce-cost", label: "Pessoas & Custos", icon: Users, section: 'main' },
  { href: "/organograma", label: "Organograma", icon: Network, section: 'main' },
  { href: "/comites", label: "Gestão de Comitês", icon: Building2, section: 'admin' },
  { href: "/membros", label: "Gerenciar Membros", icon: Users, section: 'admin' },
  { href: "/roles", label: "Funções Globais", icon: Shield, section: 'admin' },
  { href: "/workflows", label: "Automações", icon: Zap, section: 'admin' },
  { href: "/atas", label: "Atas", icon: FileBadge, section: 'admin' },
  { href: "/notificacoes", label: "Admin Notificações", icon: Bell, section: 'admin' },
  { href: "/relatorios", label: "Relatórios", icon: BarChart3, section: 'admin' },
  { href: "/historico", label: "Histórico", icon: History, section: 'admin' },
];

export function AppSidebar() {
  const pathname = usePathname();
  const { user } = useUser();

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
                          transition-all duration-200 ease-out rounded-lg mb-0.5 w-full justify-between
                          hud-sidebar-item group
                          ${isParentActive ? 'hud-sidebar-item-active' : ''}
                        `}
                  isActive={isParentActive}
                >
                  <div className="flex items-center gap-3">
                    <item.icon className="w-4 h-4 stroke-[1.5] opacity-60" />
                    <span className="text-[11px] font-medium tracking-[0.1em] uppercase">{item.label}</span>
                  </div>
                  <ChevronDown className="w-3 h-3 text-white/20 transition-transform duration-200 group-data-[state=open]:rotate-180" />
                </SidebarMenuButton>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <SidebarMenuSub className="ml-5 mt-1 border-l border-white/[0.06] pl-3">
                  {item.subItems.map(subItem => {
                    const isSubActive = pathname === subItem.href;
                    return (
                      <SidebarMenuItem key={subItem.href}>
                        <Link href={subItem.href} passHref>
                          <SidebarMenuSubButton
                            isActive={isSubActive}
                            className={`
                                      mt-0.5 hud-sidebar-item rounded-md
                                      ${isSubActive ? 'hud-sidebar-item-active' : ''}
                                    `}
                          >
                            <subItem.icon className="w-3.5 h-3.5 stroke-[1.5] opacity-50" />
                            <span className="text-[10px] font-medium tracking-[0.1em] uppercase">{subItem.label}</span>
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
                  transition-all duration-200 ease-out rounded-lg mb-0.5 w-full relative group
                  hud-sidebar-item
                  ${isParentActive ? 'hud-sidebar-item-active' : ''}
                `}
              isActive={isParentActive}
            >
              {/* Active indicator */}
              {isParentActive && (
                <div className="absolute left-0 top-1/2 -translate-y-1/2 w-[2px] h-4 rounded-full"
                  style={{ background: 'linear-gradient(180deg, #06b6d4, #10b981)', boxShadow: '0 0 6px rgba(6, 182, 212, 0.5)' }}
                />
              )}

              <div className="flex items-center gap-3 w-full pl-1">
                <item.icon
                  className={`w-4 h-4 stroke-[1.8] transition-colors ${isParentActive ? 'text-cyan-300/90' : 'opacity-60'
                    }`}
                />
                <span className="text-[11px] font-medium tracking-[0.1em] uppercase">{item.label}</span>
              </div>

              {/* Hover chevron */}
              <ChevronRight className={`
                  w-3 h-3 text-white/20 transition-all duration-200
                  opacity-0 group-hover:opacity-100 translate-x-0 group-hover:translate-x-0.5
                  ${isParentActive ? 'opacity-60' : ''}
                `} />
            </SidebarMenuButton>
          </Link>
        </SidebarMenuItem>
      );
    });
  };

  return (
    <Sidebar className="hud-sidebar border-r-0">
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
            {/* Subtle glow on hover */}
            <div className="absolute -inset-3 bg-gradient-to-r from-cyan-500/0 via-cyan-500/5 to-emerald-500/5 rounded-xl opacity-0 group-hover:opacity-100 transition-opacity duration-500 blur-lg -z-10" />
          </div>
        </div>
      </SidebarHeader>

      {/* Navigation */}
      <SidebarContent className="hud-sidebar-content flex-1 overflow-y-auto overflow-x-hidden">
        <SidebarGroup>
          {/* Section Label */}
          <SidebarGroupLabel className="px-2 py-1.5 mb-1">
            <span className="text-[9px] font-semibold uppercase tracking-[0.18em] text-white/30 flex items-center gap-1.5">
              <div className="w-0.5 h-0.5 rounded-full bg-cyan-400/60" />
              GOVERNANÇA
            </span>
          </SidebarGroupLabel>

          <SidebarMenu className="space-y-[2px]">
            {renderMenuItems(mainItems)}
          </SidebarMenu>
        </SidebarGroup>

        {user?.role === 'admin' && (
          <SidebarGroup className="mt-3">
            <SidebarGroupLabel className="px-2 py-1.5 mb-1">
              <span className="text-[9px] font-semibold uppercase tracking-[0.18em] text-white/30 flex items-center gap-1.5">
                <div className="w-0.5 h-0.5 rounded-full bg-purple-400/60" />
                ADMINISTRAÇÃO
              </span>
            </SidebarGroupLabel>

            <SidebarMenu className="space-y-[2px]">
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
              <button className="flex items-center gap-3 w-full hover:bg-white/[0.03] rounded-lg p-2.5 transition-all duration-200 group">
                <Avatar className="w-8 h-8 ring-1 ring-white/10">
                  <AvatarFallback className="font-semibold text-white text-[10px] bg-gradient-to-br from-cyan-600 to-emerald-600">
                    {getUserInitials(user.fullName)}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 text-left min-w-0">
                  <p className="font-medium text-white/80 text-[12px] tracking-wide truncate">{user.fullName}</p>
                  <p className="text-[10px] truncate text-white/30">{user.cargo || user.role}</p>
                </div>
                {/* Online indicator */}
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-400/70 shadow-[0_0_4px_rgba(16,185,129,0.5)]" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52 bg-[#0a0f0d]/95 backdrop-blur-xl border-white/10 shadow-2xl">
              <DropdownMenuItem asChild className="cursor-pointer text-white/50 hover:text-white hover:bg-white/[0.04] focus:bg-white/[0.04]">
                <Link href="/configuracoes" className="flex items-center">
                  <Settings className="w-3.5 h-3.5 mr-2.5 stroke-[1.5]" />
                  <span className="text-[12px] font-medium tracking-wide">Configurações</span>
                </Link>
              </DropdownMenuItem>
              <DropdownMenuSeparator className="bg-white/[0.06]" />
              <DropdownMenuItem
                onClick={() => { /* handleLogout */ }}
                className="text-red-400 cursor-pointer hover:bg-red-500/10 focus:bg-red-500/10"
              >
                <LogOut className="w-3.5 h-3.5 mr-2.5 stroke-[1.5]" />
                <span className="text-[12px] font-medium tracking-wide">Sair</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </SidebarFooter>
    </Sidebar>
  );
}
