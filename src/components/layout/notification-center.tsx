"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  Bell,
  CheckCheck,
  Trash2,
  Calendar,
  ClipboardList,
  CheckCircle2,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useHudToast } from "@/hooks/useHudToast";
import { format } from "date-fns";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { usePathname } from "next/navigation";
import { useTheme } from "@/contexts/ThemeContext";
import type { AppNotification } from "@/lib/types/agenda";
import {
  listNotifications,
  markAllRead,
  markRead,
  removeNotification,
} from "@/lib/services/notifications";

interface NotificationCenterProps {
  hiddenOnDashboard?: boolean;
}

const TYPE_META: Record<string, { icon: LucideIcon; color: string }> = {
  meeting_invite: { icon: Calendar, color: "#17C3B2" },
  task_assigned: { icon: ClipboardList, color: "#FFB04D" },
  task_status: { icon: CheckCircle2, color: "#00C8FF" },
};

export default function NotificationCenter({ hiddenOnDashboard }: NotificationCenterProps) {
  const pathname = usePathname();
  const { toast } = useHudToast();
  const { theme } = useTheme();
  const isLight = theme === 'light';
  const [filter, setFilter] = useState('todas');
  const [notificacoes, setNotificacoes] = useState<AppNotification[]>([]);

  const load = useCallback(async () => {
    try {
      setNotificacoes(await listNotifications(50));
    } catch {
      setNotificacoes([]);
    }
  }, []);

  // Initial load + lightweight polling so the bell stays fresh.
  useEffect(() => {
    void load();
    const interval = setInterval(() => void load(), 60_000);
    return () => clearInterval(interval);
  }, [load]);

  if (hiddenOnDashboard && pathname === "/dashboard") return null;

  const handleMarkRead = async (id: string) => {
    setNotificacoes((prev) => prev.map((n) => (n.id === id ? { ...n, readAt: new Date() } : n)));
    await markRead(id);
  };

  const handleMarkAllRead = async () => {
    setNotificacoes((prev) => prev.map((n) => ({ ...n, readAt: n.readAt ?? new Date() })));
    await markAllRead();
    toast({ title: 'Todas marcadas como lidas' });
  };

  const handleDelete = async (id: string) => {
    setNotificacoes((prev) => prev.filter((n) => n.id !== id));
    await removeNotification(id);
    toast({ title: 'Notificação excluída' });
  };

  const getMeta = (type: string) => TYPE_META[type] ?? { icon: Bell, color: isLight ? '#65A30D' : '#00C8FF' };

  const notificacoesFiltradas = notificacoes.filter((n) => (filter === 'nao_lidas' ? !n.readAt : true));
  const naoLidasCount = notificacoes.filter((n) => !n.readAt).length;
  const hasUnread = naoLidasCount > 0;

  return (
    <Popover onOpenChange={(open) => open && void load()}>
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
                onClick={handleMarkAllRead}
                title="Marcar todas como lidas"
                className={`h-8 w-8 rounded-full ${isLight ? 'text-[#6B7280] hover:text-[#1C1F24] hover:bg-lime-500/[0.08]' : 'text-[rgba(255,255,255,0.70)] hover:text-white hover:bg-[rgba(0,255,180,0.10)]'}`}
              >
                <CheckCheck className="w-4 h-4" />
              </Button>
            )}
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
                  const meta = getMeta(notificacao.type);
                  const Icon = meta.icon;
                  const lida = Boolean(notificacao.readAt);
                  const inner = (
                    <div
                      className={`p-3 rounded-xl cursor-pointer transition-all ${!lida
                        ? (isLight
                          ? 'bg-lime-500/[0.05] border border-lime-500/15 shadow-[0_0_8px_rgba(132,204,22,0.06)]'
                          : 'bg-[rgba(0,255,180,0.08)] border border-[rgba(0,255,180,0.22)] shadow-[0_0_14px_rgba(0,255,180,0.12)]')
                        : (isLight
                          ? 'bg-black/[0.02] border border-black/[0.04] hover:border-lime-500/20'
                          : 'bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.06)] hover:border-[rgba(0,200,255,0.22)]')
                        }`}
                      onClick={() => !lida && handleMarkRead(notificacao.id)}
                    >
                      <div className="flex gap-3">
                        <div
                          className={`p-2 rounded-xl flex-shrink-0 h-fit ${isLight ? 'shadow-[inset_0_1px_0_rgba(255,255,255,0.6)]' : 'shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]'}`}
                          style={{ backgroundColor: `${meta.color}1a` }}
                        >
                          <Icon className="w-4 h-4" style={{ color: meta.color }} />
                        </div>

                        <div className="flex-1 min-w-0">
                          <div className="flex items-start justify-between gap-2 mb-1">
                            <p className={`font-semibold text-sm ${!lida
                              ? (isLight ? 'text-[#1C1F24]' : 'text-white')
                              : (isLight ? 'text-[#4B5563]' : 'text-[rgba(255,255,255,0.85)]')}`}>
                              {notificacao.title}
                            </p>
                            {!lida && (
                              <div className={`w-2 h-2 bg-[#FFB04D] rounded-full flex-shrink-0 mt-1 ${isLight ? 'shadow-[0_0_4px_rgba(255,176,77,0.3)]' : 'shadow-[0_0_8px_rgba(255,176,77,0.6)]'}`}></div>
                            )}
                          </div>
                          {notificacao.body && (
                            <p className={`text-xs line-clamp-2 mb-2 ${isLight ? 'text-[#5a6e66]' : 'text-[rgba(255,255,255,0.70)]'}`}>
                              {notificacao.body}
                            </p>
                          )}
                          <div className="flex items-center justify-between">
                            <span className={`text-[11px] ${isLight ? 'text-[#8a9a92]' : 'text-[rgba(255,255,255,0.55)]'}`}>
                              {format(new Date(notificacao.createdAt), "dd/MM 'às' HH:mm")}
                            </span>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={(e) => {
                                e.stopPropagation();
                                e.preventDefault();
                                void handleDelete(notificacao.id);
                              }}
                              className={`h-7 w-7 rounded-full ${isLight ? 'text-[#8a9a92] hover:text-[#FF5860] hover:bg-red-500/[0.06]' : 'text-[rgba(255,255,255,0.60)] hover:text-[#FF5860] hover:bg-[rgba(255,88,96,0.12)]'}`}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </Button>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                  return notificacao.linkUrl ? (
                    <Link href={notificacao.linkUrl} key={notificacao.id} passHref>
                      {inner}
                    </Link>
                  ) : (
                    <div key={notificacao.id}>{inner}</div>
                  );
                })}
              </div>
            ) : (
              <div className="text-center py-12">
                <Bell className={`w-12 h-12 mx-auto mb-3 ${isLight ? 'text-black/20' : 'text-[rgba(255,255,255,0.25)]'}`} />
                <p className={`text-sm ${isLight ? 'text-[#6B7280]' : 'text-[rgba(255,255,255,0.65)]'}`}>
                  {filter === 'nao_lidas' ? 'Você está em dia!' : 'Nenhuma notificação'}
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
