"use client";

import React, { useState } from "react";
import Link from "next/link";
import {
  Bell,
  Check,
  CheckCheck,
  Trash2,
  X,
  Settings,
  Filter,
  Calendar,
  FileText,
  Users,
  Building2,
  Clock,
  AlertCircle
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { notifications as mockNotifications } from "@/lib/mock-data";
import { Notification } from "@/lib/types";
import { usePathname } from "next/navigation";
import { useTheme } from "@/contexts/ThemeContext";

interface NotificationCenterProps {
  hiddenOnDashboard?: boolean;
}

export default function NotificationCenter({ hiddenOnDashboard }: NotificationCenterProps) {
  const pathname = usePathname();
  const { toast } = useToast();
  const { theme } = useTheme();
  const isLight = theme === 'light';
  const [filter, setFilter] = useState('todas');
  const [notificacoes, setNotificacoes] = useState<Notification[]>(mockNotifications);

  if (hiddenOnDashboard && pathname === "/dashboard") return null;

  const marcarComoLidaMutation = (notificacaoId: string) => {
    setNotificacoes(prev =>
      prev.map(n => n.id === notificacaoId ? { ...n, lida: true } : n)
    );
  };

  const marcarTodasLidasMutation = () => {
    setNotificacoes(prev => prev.map(n => ({ ...n, lida: true })));
    toast({ title: 'Todas marcadas como lidas' });
  };

  const excluirNotificacaoMutation = (notificacaoId: string) => {
    setNotificacoes(prev => prev.filter(n => n.id !== notificacaoId));
    toast({ title: 'Notificação excluída' });
  };

  const handleNotificationClick = (notificacao: Notification) => {
    if (!notificacao.lida) {
      marcarComoLidaMutation(notificacao.id);
    }
  };

  const getIconByType = (tipo: Notification['tipo']) => {
    const icons = {
      reuniao_proxima: Calendar,
      nova_pauta: FileText,
      votacao_iniciada: AlertCircle,
      votacao_encerrando: Clock,
      votacao_encerrada: CheckCheck,
      reuniao_hoje: Calendar,
      ata_publicada: FileText,
      membro_adicionado: Users,
      role_atualizada: Building2
    };
    return icons[tipo] || Bell;
  };

  const notificacoesFiltradas = notificacoes.filter(n => {
    if (filter === 'nao_lidas') return !n.lida;
    return true;
  });

  const naoLidasCount = notificacoes.filter(n => !n.lida).length;
  const hasUnread = naoLidasCount > 0;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={`relative h-8 w-8 rounded-lg border ${
            isLight
              ? 'border-black/[0.08] bg-black/[0.02] shadow-[inset_0_1px_0_rgba(255,255,255,0.6)] hover:border-lime-500/40 hover:shadow-[0_0_8px_rgba(132,204,22,0.15)]'
              : 'border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)] shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] hover:border-[rgba(0,200,255,0.45)] hover:shadow-[0_0_12px_rgba(0,200,255,0.35)]'
          }`}
        >
          <Bell className="w-4 h-4 transition-all" style={{ color: hasUnread ? (isLight ? '#65A30D' : '#00C8FF') : (isLight ? 'rgba(0,0,0,0.45)' : 'rgba(255,255,255,0.65)') }} />
          {hasUnread && (
            <Badge
              className={`absolute -top-1 -right-1 h-4 w-4 rounded-full flex items-center justify-center p-0 bg-[#FF5860] text-white text-[10px] font-bold leading-none ${isLight ? 'shadow-[0_0_6px_rgba(255,88,96,0.4)]' : 'shadow-[0_0_10px_rgba(255,88,96,0.7)]'}`}
            >
              {naoLidasCount > 9 ? '9+' : naoLidasCount}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className={`w-[420px] p-0 z-[9999] border ${
          isLight
            ? 'bg-white border-black/[0.08] shadow-[0_20px_50px_rgba(0,0,0,0.12)]'
            : 'bg-gradient-to-br from-[#0A1612] to-[#07130F] border-[rgba(255,255,255,0.08)] shadow-[0_20px_50px_rgba(0,0,0,0.45)]'
        }`}
        align="end"
      >
        <div className={`flex items-center justify-between p-4 border-b ${isLight ? 'border-black/[0.06]' : 'border-[rgba(255,255,255,0.06)]'}`}>
          <div>
            <h3 className={`font-semibold text-base ${isLight ? 'text-[#1C1F24]' : 'text-white'}`}>Central de Alertas</h3>
            {hasUnread && (
              <p className={`text-xs ${isLight ? 'text-[#6B7280]' : 'text-[rgba(255,255,255,0.65)]'}`}>{naoLidasCount} não lida(s)</p>
            )}
          </div>
          <div className="flex gap-1">
            {hasUnread && (
              <Button
                variant="ghost"
                size="icon"
                onClick={marcarTodasLidasMutation}
                title="Marcar todas como lidas"
                className={`h-8 w-8 rounded-full ${isLight ? 'text-[#6B7280] hover:text-[#1C1F24] hover:bg-lime-500/[0.08]' : 'text-[rgba(255,255,255,0.70)] hover:text-white hover:bg-[rgba(0,255,180,0.10)]'}`}
              >
                <CheckCheck className="w-4 h-4" />
              </Button>
            )}
            <Link href="/notificacoes">
              <Button
                variant="ghost"
                size="icon"
                title="Ver todas"
                className={`h-8 w-8 rounded-full ${isLight ? 'text-[#6B7280] hover:text-[#1C1F24] hover:bg-lime-500/[0.08]' : 'text-[rgba(255,255,255,0.70)] hover:text-white hover:bg-[rgba(0,255,180,0.10)]'}`}
              >
                <Settings className="w-4 h-4" />
              </Button>
            </Link>
          </div>
        </div>

        <Tabs value={filter} onValueChange={setFilter} className="px-4 pt-3">
          <TabsList className={`w-full border ${isLight ? 'bg-black/[0.03] border-black/[0.06]' : 'bg-[rgba(255,255,255,0.04)] border-[rgba(255,255,255,0.06)]'}`}>
            <TabsTrigger
              value="todas"
              className={`flex-1 ${isLight ? 'data-[state=active]:bg-lime-500/[0.10] data-[state=active]:text-[#1C1F24] text-[#6B7280]' : 'data-[state=active]:bg-[rgba(0,255,180,0.12)] data-[state=active]:text-white text-[rgba(255,255,255,0.70)]'}`}
            >
              Todas ({notificacoes.length})
            </TabsTrigger>
            <TabsTrigger
              value="nao_lidas"
              className={`flex-1 ${isLight ? 'data-[state=active]:bg-lime-500/[0.10] data-[state=active]:text-[#1C1F24] text-[#6B7280]' : 'data-[state=active]:bg-[rgba(0,255,180,0.12)] data-[state=active]:text-white text-[rgba(255,255,255,0.70)]'}`}
            >
              Não lidas ({naoLidasCount})
            </TabsTrigger>
          </TabsList>
        </Tabs>

        <ScrollArea className="h-[400px]">
          <div className="p-3">
            {notificacoesFiltradas.length > 0 ? (
              <div className="space-y-1">
                {notificacoesFiltradas.map((notificacao) => {
                  const Icon = getIconByType(notificacao.tipo);
                  return (
                    <Link href={notificacao.link} key={notificacao.id} passHref>
                      <div
                        className={`p-3 rounded-xl cursor-pointer transition-all ${!notificacao.lida
                          ? (isLight
                            ? 'bg-lime-500/[0.05] border border-lime-500/15 shadow-[0_0_8px_rgba(132,204,22,0.06)]'
                            : 'bg-[rgba(0,255,180,0.08)] border border-[rgba(0,255,180,0.22)] shadow-[0_0_14px_rgba(0,255,180,0.12)]')
                          : (isLight
                            ? 'bg-black/[0.02] border border-black/[0.04] hover:border-lime-500/20'
                            : 'bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.06)] hover:border-[rgba(0,200,255,0.22)]')
                          }`}
                        onClick={() => handleNotificationClick(notificacao)}
                      >
                        <div className="flex gap-3">
                          <div
                            className={`p-2 rounded-xl flex-shrink-0 h-fit ${isLight ? 'shadow-[inset_0_1px_0_rgba(255,255,255,0.6)]' : 'shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]'}`}
                            style={{ backgroundColor: `${notificacao.cor}1a` }}
                          >
                            <Icon className="w-4 h-4" style={{ color: notificacao.cor }} />
                          </div>

                          <div className="flex-1 min-w-0">
                            <div className="flex items-start justify-between gap-2 mb-1">
                              <p className={`font-semibold text-sm ${!notificacao.lida
                                ? (isLight ? 'text-[#1C1F24]' : 'text-white')
                                : (isLight ? 'text-[#4B5563]' : 'text-[rgba(255,255,255,0.85)]')}`}>
                                {notificacao.titulo}
                              </p>
                              {!notificacao.lida && (
                                <div className={`w-2 h-2 bg-[#FFB04D] rounded-full flex-shrink-0 mt-1 ${isLight ? 'shadow-[0_0_4px_rgba(255,176,77,0.3)]' : 'shadow-[0_0_8px_rgba(255,176,77,0.6)]'}`}></div>
                              )}
                            </div>
                            <p className={`text-xs line-clamp-2 mb-2 ${isLight ? 'text-[#5a6e66]' : 'text-[rgba(255,255,255,0.70)]'}`}>
                              {notificacao.mensagem}
                            </p>
                            <div className="flex items-center justify-between">
                              <span className={`text-[11px] ${isLight ? 'text-[#8a9a92]' : 'text-[rgba(255,255,255,0.55)]'}`}>
                                {format(new Date(notificacao.created_date), "dd/MM 'às' HH:mm")}
                              </span>
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  e.preventDefault();
                                  excluirNotificacaoMutation(notificacao.id);
                                }}
                                className={`h-7 w-7 rounded-full ${isLight ? 'text-[#8a9a92] hover:text-[#FF5860] hover:bg-red-500/[0.06]' : 'text-[rgba(255,255,255,0.60)] hover:text-[#FF5860] hover:bg-[rgba(255,88,96,0.12)]'}`}
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </Button>
                            </div>
                          </div>
                        </div>
                      </div>
                    </Link>
                  );
                })}
              </div>
            ) : (
              <div className="text-center py-12">
                <Bell className={`w-12 h-12 mx-auto mb-3 ${isLight ? 'text-black/20' : 'text-[rgba(255,255,255,0.25)]'}`} />
                <p className={`text-sm ${isLight ? 'text-[#6B7280]' : 'text-[rgba(255,255,255,0.65)]'}`}>
                  {filter === 'nao_lidas'
                    ? 'Você está em dia!'
                    : 'Nenhuma notificação'}
                </p>
              </div>
            )}
          </div>
        </ScrollArea>

        <div className={`border-t p-3 ${isLight ? 'border-black/[0.06]' : 'border-[rgba(255,255,255,0.06)]'}`}>
          <Link href="/notificacoes">
            <Button
              variant="ghost"
              className={`w-full text-sm h-10 rounded-xl border ${
                isLight
                  ? 'border-black/[0.08] bg-black/[0.02] text-[#4B5563] hover:border-lime-500/25 hover:bg-lime-500/[0.04]'
                  : 'border-[rgba(255,255,255,0.10)] bg-[rgba(255,255,255,0.03)] text-[rgba(255,255,255,0.85)] hover:border-[rgba(0,200,255,0.35)] hover:bg-[rgba(0,200,255,0.08)]'
              }`}
              size="sm"
            >
              Ver todas as notificações
            </Button>
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}
