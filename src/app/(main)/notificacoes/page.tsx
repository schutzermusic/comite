'use client';
import React, { useState } from "react";
import {
  Bell,
  Send,
  RefreshCw,
  Filter,
  CheckCircle2,
  XCircle,
  Clock,
  Mail,
  MessageSquare,
  AlertCircle,
  Settings,
  Eye
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { HudInput } from "@/components/ui/hud-input";
import { HUDCard } from "@/components/ui/hud-card";
import { StatusPill } from "@/components/ui/status-pill";
import { PrimaryCTA } from "@/components/ui/primary-cta";
import { SecondaryButton } from "@/components/ui/secondary-button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { notifications, users } from "@/lib/mock-data";
import { OrionGreenBackground } from "@/components/system/OrionGreenBackground";

const logs = notifications.map(n => ({
    id: n.id,
    created_date: n.created_date,
    usuario_nome: n.usuario_email.split('@')[0],
    usuario_email: n.usuario_email,
    event_type: n.tipo,
    canais: ['email'],
    status: n.lida ? 'sent' : 'queued',
    retry_count: 0,
}));

const mockConfig = {
    email_provider: 'twilio',
    whatsapp_provider: 'sendgrid',
    quiet_hours_default_inicio: '22:00',
    quiet_hours_default_fim: '08:00',
    max_retry_attempts: 3,
    retry_delay_minutes: 5,
    notificacoes_ativas: true,
};

export default function AdminNotificacoes() {
  const { toast } = useToast();
  const [statusFilter, setStatusFilter] = useState("all");
  const [eventFilter, setEventFilter] = useState("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [showTestDialog, setShowTestDialog] = useState(false);
  const [showLogDialog, setShowLogDialog] = useState(false);
  const [selectedLog, setSelectedLog] = useState<any>(null);
  const [testEmail, setTestEmail] = useState("");
  const [testEvent, setTestEvent] = useState("nova_pauta");
  const [notificationLogs, setNotificationLogs] = useState(logs);

  const resendMutation = (logId: string) => {
    const log = notificationLogs.find(l => l.id === logId);
    if (!log) {
        toast({ title: 'Log não encontrado', variant: 'destructive' });
        return;
    }
    setNotificationLogs(prev => prev.map(l => l.id === logId ? {...l, status: 'sent' as 'sent', retry_count: (l.retry_count || 0) + 1} : l));
    toast({ title: 'Notificação reenviada com sucesso!' });
  };

  const sendTestMutation = () => {
    toast({ title: 'Email de teste enviado!' });
    setShowTestDialog(false);
    setTestEmail("");
  };

  const filteredLogs = notificationLogs.filter(log => {
    const statusMatch = statusFilter === 'all' || log.status === statusFilter;
    const eventMatch = eventFilter === 'all' || log.event_type === eventFilter;
    const searchMatch = log.usuario_email?.toLowerCase().includes(searchTerm.toLowerCase()) ||
                       log.usuario_nome?.toLowerCase().includes(searchTerm.toLowerCase());
    return statusMatch && eventMatch && searchMatch;
  });

  const getStatusIcon = (status: string) => {
    const icons: {[key: string]: React.ElementType} = {
      queued: Clock,
      sent: CheckCircle2,
      failed: XCircle,
      skipped: AlertCircle
    };
    const Icon = icons[status] || Clock;
    return <Icon className="w-4 h-4" />;
  };

  const getStatusVariant = (status: string) => {
    if (status === 'sent') return 'active';
    if (status === 'failed') return 'critical';
    if (status === 'queued') return 'warning';
    if (status === 'skipped') return 'neutral';
    return 'info';
  };

  const formatLabel = (text: string) => {
    return text
      .split('_')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  };

  const stats = {
    total: notificationLogs.length,
    sent: notificationLogs.filter(l => l.status === 'sent').length,
    failed: notificationLogs.filter(l => l.status === 'failed').length,
    queued: notificationLogs.filter(l => l.status === 'queued').length,
    emailRate: notificationLogs.length > 0 
      ? ((notificationLogs.filter(l => l.status === 'sent').length / notificationLogs.length) * 100).toFixed(1)
      : 0
  };

  return (
    <OrionGreenBackground className="orion-page">
      <div className="orion-page-content max-w-[1800px] mx-auto space-y-6">
        <div className="flex justify-between items-start">
          <div>
            <h1 className="text-2xl font-semibold text-white mb-1">Central de Notificações</h1>
            <p className="text-sm text-[rgba(255,255,255,0.65)]">Monitore e gerencie o sistema de alertas e comunicações</p>
          </div>
          <div className="flex gap-2">
            <PrimaryCTA onClick={() => setShowTestDialog(true)}>
              <Send className="w-4 h-4 mr-2" />
              Enviar Teste
            </PrimaryCTA>
            <SecondaryButton onClick={() => setNotificationLogs(logs)}>
              <RefreshCw className="w-4 h-4 mr-2" />
              Atualizar
            </SecondaryButton>
          </div>
        </div>

        <div className="grid md:grid-cols-5 gap-4">
          <HUDCard glow glowColor="cyan">
            <div className="flex items-center justify-between mb-2">
              <Bell className="w-6 h-6 text-[#00C8FF]" />
            </div>
            <p className="text-xs text-[rgba(255,255,255,0.65)] uppercase tracking-wide mb-1">Total Enviadas</p>
            <p className="text-3xl font-semibold text-white">{stats.total}</p>
          </HUDCard>

          <HUDCard glow glowColor="green">
            <div className="flex items-center justify-between mb-2">
              <CheckCircle2 className="w-6 h-6 text-[#00FFB4]" />
            </div>
            <p className="text-xs text-[rgba(255,255,255,0.65)] uppercase tracking-wide mb-1">Entregues</p>
            <p className="text-3xl font-semibold text-white">{stats.sent}</p>
          </HUDCard>

          <HUDCard glow glowColor="red">
            <div className="flex items-center justify-between mb-2">
              <XCircle className="w-6 h-6 text-[#FF5860]" />
            </div>
            <p className="text-xs text-[rgba(255,255,255,0.65)] uppercase tracking-wide mb-1">Falhas</p>
            <p className="text-3xl font-semibold text-white">{stats.failed}</p>
          </HUDCard>

          <HUDCard glow glowColor="amber">
            <div className="flex items-center justify-between mb-2">
              <Clock className="w-6 h-6 text-[#FFB04D]" />
            </div>
            <p className="text-xs text-[rgba(255,255,255,0.65)] uppercase tracking-wide mb-1">Na Fila</p>
            <p className="text-3xl font-semibold text-white">{stats.queued}</p>
          </HUDCard>

          <HUDCard glow glowColor="cyan">
            <div className="flex items-center justify-between mb-2">
              <Mail className="w-6 h-6 text-[#00C8FF]" />
            </div>
            <p className="text-xs text-[rgba(255,255,255,0.65)] uppercase tracking-wide mb-1">Taxa Email</p>
            <p className="text-3xl font-semibold text-white">{stats.emailRate}%</p>
          </HUDCard>
        </div>

        <HUDCard>
          <div className="flex items-center gap-2 text-sm font-semibold text-white mb-4">
            <Settings className="w-4 h-4 text-[#00C8FF]" />
            Configuração Atual
          </div>
          <div className="grid md:grid-cols-3 gap-4 text-sm text-[rgba(255,255,255,0.78)]">
            <div>
              <p className="text-[rgba(255,255,255,0.55)] mb-1">Provedor Email</p>
              <StatusPill variant="info" className="text-[11px]">{mockConfig.email_provider}</StatusPill>
            </div>
            <div>
              <p className="text-[rgba(255,255,255,0.55)] mb-1">Provedor WhatsApp</p>
              <StatusPill variant="info" className="text-[11px]">{mockConfig.whatsapp_provider}</StatusPill>
            </div>
            <div>
              <p className="text-[rgba(255,255,255,0.55)] mb-1">Quiet Hours Padrão</p>
              <StatusPill variant="neutral">{mockConfig.quiet_hours_default_inicio} - {mockConfig.quiet_hours_default_fim}</StatusPill>
            </div>
            <div>
              <p className="text-[rgba(255,255,255,0.55)] mb-1">Max Tentativas</p>
              <StatusPill variant="warning">{mockConfig.max_retry_attempts}</StatusPill>
            </div>
            <div>
              <p className="text-[rgba(255,255,255,0.55)] mb-1">Delay Retry</p>
              <StatusPill variant="neutral">{mockConfig.retry_delay_minutes} min</StatusPill>
            </div>
            <div>
              <p className="text-[rgba(255,255,255,0.55)] mb-1">Status</p>
              <StatusPill variant={mockConfig.notificacoes_ativas ? 'active' : 'critical'}>
                {mockConfig.notificacoes_ativas ? 'Ativo' : 'Inativo'}
              </StatusPill>
            </div>
          </div>
        </HUDCard>

        <HUDCard>
          <div className="grid md:grid-cols-3 gap-4">
            <HudInput
              placeholder="Buscar por email ou nome..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />

            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="bg-[rgba(255,255,255,0.04)] border-[rgba(255,255,255,0.10)] text-white hover:border-[rgba(0,200,255,0.35)]">
                <Filter className="w-4 h-4 mr-2" />
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent className="bg-gradient-to-br from-[#0A1612] to-[#07130F] border-[rgba(255,255,255,0.08)] text-white">
                <SelectItem value="all">Todos Status</SelectItem>
                <SelectItem value="sent">Enviadas</SelectItem>
                <SelectItem value="failed">Falhas</SelectItem>
                <SelectItem value="queued">Na Fila</SelectItem>
                <SelectItem value="skipped">Ignoradas</SelectItem>
              </SelectContent>
            </Select>

            <Select value={eventFilter} onValueChange={setEventFilter}>
              <SelectTrigger className="bg-[rgba(255,255,255,0.04)] border-[rgba(255,255,255,0.10)] text-white hover:border-[rgba(0,200,255,0.35)]">
                <Filter className="w-4 h-4 mr-2" />
                <SelectValue placeholder="Evento" />
              </SelectTrigger>
              <SelectContent className="bg-gradient-to-br from-[#0A1612] to-[#07130F] border-[rgba(255,255,255,0.08)] text-white">
                <SelectItem value="all">Todos Eventos</SelectItem>
                <SelectItem value="nova_pauta">Nova Pauta</SelectItem>
                <SelectItem value="votacao_aberta">Votação Aberta</SelectItem>
                <SelectItem value="lembrete_votacao">Lembrete Votação</SelectItem>
                <SelectItem value="votacao_encerrada">Votação Encerrada</SelectItem>
                <SelectItem value="resultado_publicado">Resultado Publicado</SelectItem>
                <SelectItem value="reuniao_proxima">Reunião Próxima</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </HUDCard>

        <HUDCard className="p-0">
          <div className="p-5 pb-2 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-white">Logs de Notificações</h2>
          </div>
          <div className="overflow-x-auto px-2 pb-4">
            <Table>
              <TableHeader className="bg-[rgba(255,255,255,0.02)]">
                <TableRow className="hover:bg-transparent">
                  <TableHead className="text-[rgba(255,255,255,0.75)] uppercase text-[11px] tracking-wide">Data/Hora</TableHead>
                  <TableHead className="text-[rgba(255,255,255,0.75)] uppercase text-[11px] tracking-wide">Usuário</TableHead>
                  <TableHead className="text-[rgba(255,255,255,0.75)] uppercase text-[11px] tracking-wide">Evento</TableHead>
                  <TableHead className="text-[rgba(255,255,255,0.75)] uppercase text-[11px] tracking-wide">Canais</TableHead>
                  <TableHead className="text-[rgba(255,255,255,0.75)] uppercase text-[11px] tracking-wide">Status</TableHead>
                  <TableHead className="text-[rgba(255,255,255,0.75)] uppercase text-[11px] tracking-wide">Tentativas</TableHead>
                  <TableHead className="text-right text-[rgba(255,255,255,0.75)] uppercase text-[11px] tracking-wide">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredLogs.map((log) => (
                  <TableRow key={log.id} className="hover:bg-[rgba(0,200,255,0.04)] border-b border-[rgba(255,255,255,0.04)]">
                    <TableCell className="text-sm text-[rgba(255,255,255,0.85)]">
                      {format(new Date(log.created_date), "dd/MM/yy HH:mm", { locale: ptBR })}
                    </TableCell>
                    <TableCell>
                      <div>
                        <p className="font-medium text-white text-sm">{log.usuario_nome}</p>
                        <p className="text-xs text-[rgba(255,255,255,0.60)]">{log.usuario_email}</p>
                      </div>
                    </TableCell>
                    <TableCell>
                      <StatusPill variant="info" className="text-[11px]">{formatLabel(log.event_type)}</StatusPill>
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-2">
                        {log.canais?.includes('email') && (
                          <StatusPill variant="info" className="text-[10px] px-2 py-1 flex items-center gap-1">
                            <Mail className="w-3 h-3" />
                            Email
                          </StatusPill>
                        )}
                        {log.canais?.includes('whatsapp') && (
                          <StatusPill variant="active" className="text-[10px] px-2 py-1 flex items-center gap-1">
                            <MessageSquare className="w-3 h-3" />
                            WhatsApp
                          </StatusPill>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <StatusPill variant={getStatusVariant(log.status)}>
                        <span className="flex items-center gap-1 capitalize">
                          {getStatusIcon(log.status)}
                          {log.status}
                        </span>
                      </StatusPill>
                    </TableCell>
                    <TableCell>
                      <StatusPill variant="neutral" className="text-[11px]">{log.retry_count || 0}</StatusPill>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex gap-1 justify-end">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="text-[rgba(255,255,255,0.75)] hover:text-white hover:bg-[rgba(0,200,255,0.12)] rounded-full"
                          onClick={() => {
                            setSelectedLog(log);
                            setShowLogDialog(true);
                          }}
                        >
                          <Eye className="w-4 h-4" />
                        </Button>
                        {log.status === 'failed' && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="text-[#FFB04D] hover:bg-[rgba(255,176,77,0.12)] rounded-full"
                            onClick={() => resendMutation(log.id)}
                          >
                            <RefreshCw className="w-4 h-4" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {filteredLogs.length === 0 && (
            <div className="text-center py-12">
              <Bell className="w-16 h-16 text-[rgba(255,255,255,0.25)] mx-auto mb-4" />
              <p className="text-[rgba(255,255,255,0.65)]">Nenhum log encontrado</p>
            </div>
          )}
        </HUDCard>

        <Dialog open={showTestDialog} onOpenChange={setShowTestDialog}>
          <DialogContent className="bg-gradient-to-br from-[#0A1612] to-[#07130F] border-[rgba(255,255,255,0.10)]">
            <DialogHeader>
              <DialogTitle className="text-white">Enviar Notificação de Teste</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-4">
              <div className="space-y-2">
                <Label className="text-[rgba(255,255,255,0.85)]">Email de Destino</Label>
                <Select value={testEmail} onValueChange={setTestEmail}>
                  <SelectTrigger className="bg-[rgba(255,255,255,0.04)] border-[rgba(255,255,255,0.10)] text-white">
                    <SelectValue placeholder="Selecione um usuário" />
                  </SelectTrigger>
                  <SelectContent className="bg-gradient-to-br from-[#0A1612] to-[#07130F] border-[rgba(255,255,255,0.08)] text-white">
                    {users.map(user => (
                      <SelectItem key={user.id} value={user.email}>
                        {user.nome} ({user.email})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label className="text-[rgba(255,255,255,0.85)]">Tipo de Evento</Label>
                <Select value={testEvent} onValueChange={setTestEvent}>
                  <SelectTrigger className="bg-[rgba(255,255,255,0.04)] border-[rgba(255,255,255,0.10)] text-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-gradient-to-br from-[#0A1612] to-[#07130F] border-[rgba(255,255,255,0.08)] text-white">
                    <SelectItem value="nova_pauta">Nova Pauta</SelectItem>
                    <SelectItem value="votacao_aberta">Votação Aberta</SelectItem>
                    <SelectItem value="lembrete_votacao">Lembrete Votação</SelectItem>
                    <SelectItem value="resultado_publicado">Resultado Publicado</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <PrimaryCTA
                onClick={sendTestMutation}
                disabled={!testEmail}
                className="w-full justify-center"
              >
                <Send className="w-4 h-4 mr-2" />
                Enviar Teste
              </PrimaryCTA>
            </div>
          </DialogContent>
        </Dialog>

        <Dialog open={showLogDialog} onOpenChange={setShowLogDialog}>
          <DialogContent className="max-w-2xl bg-gradient-to-br from-[#0A1612] to-[#07130F] border-[rgba(255,255,255,0.10)]">
            <DialogHeader>
              <DialogTitle className="text-white">Detalhes da Notificação</DialogTitle>
            </DialogHeader>
            {selectedLog && (
              <div className="space-y-4 pt-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm text-[rgba(255,255,255,0.60)]">Usuário</p>
                    <p className="font-medium text-white">{selectedLog.usuario_nome}</p>
                    <p className="text-xs text-[rgba(255,255,255,0.55)]">{selectedLog.usuario_email}</p>
                  </div>
                  <div>
                    <p className="text-sm text-[rgba(255,255,255,0.60)]">Evento</p>
                    <StatusPill variant="info">{formatLabel(selectedLog.event_type)}</StatusPill>
                  </div>
                  <div>
                    <p className="text-sm text-[rgba(255,255,255,0.60)]">Status</p>
                    <StatusPill variant={getStatusVariant(selectedLog.status)}>
                      {selectedLog.status}
                    </StatusPill>
                  </div>
                  <div>
                    <p className="text-sm text-[rgba(255,255,255,0.60)]">Tentativas</p>
                    <StatusPill variant="neutral">{selectedLog.retry_count || 0}</StatusPill>
                  </div>
                </div>

                {selectedLog.error_message && (
                  <div className="p-4 bg-[rgba(255,88,96,0.08)] border border-[rgba(255,88,96,0.25)] rounded-lg">
                    <p className="text-sm font-medium text-[#FF5860] mb-1">Erro:</p>
                    <p className="text-sm text-[rgba(255,255,255,0.85)]">{selectedLog.error_message}</p>
                  </div>
                )}
              </div>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </OrionGreenBackground>
  );
}
