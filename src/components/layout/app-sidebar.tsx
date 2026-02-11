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

// Mock user data, replace with actual auth logic
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
                          text-orion-text-secondary hover:text-white hover:bg-glass-light
                          data-[state=open]:bg-glass-light data-[state=open]:text-white group
                        `}
                        isActive={isParentActive}
                    >
                      <div className="flex items-center gap-3">
                        <item.icon className="w-[18px] h-[18px] stroke-[1.5]" />
                        <span className="text-[13px] font-medium">{item.label}</span>
                      </div>
                      <ChevronDown className="w-3.5 h-3.5 text-orion-text-muted transition-transform duration-200 group-data-[state=open]:rotate-180" />
                    </SidebarMenuButton>
                </CollapsibleTrigger>
                <CollapsibleContent>
                    <SidebarMenuSub className="ml-5 mt-1 border-l border-orion-border-subtle pl-3">
                        {item.subItems.map(subItem => {
                           const isSubActive = pathname === subItem.href;
                           return(
                            <SidebarMenuItem key={subItem.href}>
                                <Link href={subItem.href} passHref>
                                  <SidebarMenuSubButton 
                                    isActive={isSubActive} 
                                    className={`
                                      mt-0.5 text-orion-text-tertiary hover:text-white hover:bg-glass-light 
                                      transition-all duration-200 rounded-md
                                      ${isSubActive ? 'text-white bg-glass-light' : ''}
                                    `}
                                  >
                                    <subItem.icon className="w-[16px] h-[16px] stroke-[1.5]" />
                                    <span className="text-[12px] font-medium">{subItem.label}</span>
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
                  ${isParentActive 
                    ? 'text-white bg-glass-medium border border-orion-border-strong' 
                    : 'text-orion-text-secondary hover:text-white hover:bg-glass-light'
                  }
                `}
                isActive={isParentActive}
              >
                {/* Active indicator glow */}
                {isParentActive && (
                  <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-4 bg-semantic-info-DEFAULT rounded-full shadow-glow-info" />
                )}
                
                <div className="flex items-center gap-3 w-full pl-1">
                  <item.icon 
                    className={`w-[18px] h-[18px] stroke-[1.5] transition-colors ${
                      isParentActive ? 'text-semantic-info-DEFAULT' : ''
                    }`} 
                  />
                  <span className="text-[13px] font-medium">{item.label}</span>
                </div>

                {/* Hover chevron */}
                <ChevronRight className={`
                  w-3.5 h-3.5 text-orion-text-muted transition-all duration-200
                  opacity-0 group-hover:opacity-100 translate-x-0 group-hover:translate-x-1
                  ${isParentActive ? 'opacity-100' : ''}
                `} />
              </SidebarMenuButton>
          </Link>
        </SidebarMenuItem>
      );
    });
  };

  return (
    <Sidebar className="border-r border-orion-border-DEFAULT bg-orion-bg-secondary">
      {/* Brand Area - Orion Dark */}
      <SidebarHeader className="border-b border-orion-border-DEFAULT p-6 pb-8 relative bg-orion-bg-primary">
        <div className="flex items-center justify-center">
          <div className="relative group">
            {/* Logo with subtle glow on hover */}
            <div className="relative z-10">
              <InsightLogo 
                width={200}
                height={53}
                className="h-auto w-auto opacity-90 group-hover:opacity-100 transition-opacity duration-300"
                priority
              />
            </div>
            {/* Subtle ambient glow */}
            <div className="absolute -inset-4 bg-gradient-to-r from-semantic-info-DEFAULT/0 via-semantic-info-DEFAULT/5 to-chart-purple/5 rounded-xl opacity-0 group-hover:opacity-100 transition-opacity duration-500 blur-xl -z-10" />
          </div>
        </div>
      </SidebarHeader>
      
      {/* Navigation - Orion Dark */}
      <SidebarContent className="px-3 py-6 bg-orion-bg-secondary">
        <SidebarGroup>
          {/* Section Label */}
          <SidebarGroupLabel className="px-3 py-2 mb-2">
            <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-orion-text-muted flex items-center gap-2">
              <div className="w-1 h-1 rounded-full bg-semantic-info-DEFAULT" />
              GOVERNANÇA
            </span>
          </SidebarGroupLabel>
          
          <SidebarMenu className="space-y-0.5">
            {renderMenuItems(mainItems)}
          </SidebarMenu>
        </SidebarGroup>

        {user?.role === 'admin' && (
          <SidebarGroup className="mt-6">
            <SidebarGroupLabel className="px-3 py-2 mb-2">
              <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-orion-text-muted flex items-center gap-2">
                <div className="w-1 h-1 rounded-full bg-chart-purple" />
                ADMINISTRAÇÃO
              </span>
            </SidebarGroupLabel>
            
            <SidebarMenu className="space-y-0.5">
              {renderMenuItems(adminItems)}
            </SidebarMenu>
          </SidebarGroup>
        )}
      </SidebarContent>

      {/* Footer - Orion Dark Glass */}
      <SidebarFooter className="border-t border-orion-border-DEFAULT p-3 bg-orion-bg-primary/80 backdrop-blur-xl">
        {user && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="flex items-center gap-3 w-full hover:bg-glass-light rounded-lg p-2.5 transition-all duration-200 group">
                <Avatar className="w-9 h-9 ring-1 ring-orion-border-strong">
                  <AvatarFallback className="font-semibold text-white text-xs bg-gradient-to-br from-semantic-info-DEFAULT to-chart-purple">
                    {getUserInitials(user.fullName)}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 text-left min-w-0">
                  <p className="font-medium text-white text-[13px] truncate">{user.fullName}</p>
                  <p className="text-[11px] truncate text-orion-text-muted">{user.cargo || user.role}</p>
                </div>
                {/* Online indicator */}
                <div className="w-2 h-2 rounded-full bg-semantic-success-DEFAULT shadow-glow-success opacity-60 group-hover:opacity-100 transition-opacity" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52 bg-orion-bg-tertiary/95 backdrop-blur-xl border-orion-border-DEFAULT shadow-orion-xl">
              <DropdownMenuItem asChild className="cursor-pointer text-orion-text-secondary hover:text-white hover:bg-glass-light focus:bg-glass-light">
                <Link href="/configuracoes" className="flex items-center">
                  <Settings className="w-4 h-4 mr-2.5 stroke-[1.5]" />
                  <span className="text-[13px] font-medium">Configurações</span>
                </Link>
              </DropdownMenuItem>
              <DropdownMenuSeparator className="bg-orion-border-DEFAULT" />
              <DropdownMenuItem 
                onClick={() => { /* handleLogout */ }} 
                className="text-semantic-error-DEFAULT cursor-pointer hover:bg-semantic-error-DEFAULT/10 focus:bg-semantic-error-DEFAULT/10"
              >
                <LogOut className="w-4 h-4 mr-2.5 stroke-[1.5]" />
                <span className="text-[13px] font-medium">Sair</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </SidebarFooter>
    </Sidebar>
  );
}
