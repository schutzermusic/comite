'use client';

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Zap,
  Plus,
  Edit,
  Trash2,
  Play,
  ArrowLeft,
  Bell,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Activity,
  Filter
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { HUDCard } from "@/components/ui/hud-card";
import { StatusPill } from "@/components/ui/status-pill";
import { OrionGreenBackground } from "@/components/system/OrionGreenBackground";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { workflows as mockWorkflows, workflowLogs as mockWorkflowLogs } from "@/lib/mock-data";
import { Workflow, WorkflowLog } from "@/lib/types";

export default function GerenciarWorkflows() {
  const router = useRouter();
  const { toast } = useToast();

  const [workflows, setWorkflows] = useState<Workflow[]>(mockWorkflows);
  const [logs, setLogs] = useState<WorkflowLog[]>(mockWorkflowLogs);

  const [showDialog, setShowDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showLogsDialog, setShowLogsDialog] = useState(false);
  const [editingWorkflow, setEditingWorkflow] = useState<Workflow | null>(null);
  const [deletingWorkflow, setDeletingWorkflow] = useState<Workflow | null>(null);
  const [selectedWorkflowLogs, setSelectedWorkflowLogs] = useState<WorkflowLog[]>([]);

  const [formData, setFormData] = useState({
    nome: "",
    descricao: "",
    tipo: "notificacao_prazo" as Workflow['tipo'],
    ativa: true,
    prioridade: 5,
    frequencia_execucao: "imediata" as Workflow['frequencia_execucao']
  });

  const resetForm = () => {
    setFormData({
      nome: "",
      descricao: "",
      tipo: "notificacao_prazo",
      ativa: true,
      prioridade: 5,
      frequencia_execucao: "imediata"
    });
    setEditingWorkflow(null);
  };

  const handleEdit = (workflow: Workflow) => {
    setEditingWorkflow(workflow);
    setFormData({
      nome: workflow.nome,
      descricao: workflow.descricao || "",
      tipo: workflow.tipo,
      ativa: workflow.ativa,
      prioridade: workflow.prioridade || 5,
      frequencia_execucao: workflow.frequencia_execucao || "imediata"
    });
    setShowDialog(true);
  };

  const handleSubmit = () => {
    if (!formData.nome) {
      toast({ title: 'Erro', description: 'Preencha o nome da automação', variant: 'destructive' });
      return;
    }

    if (editingWorkflow) {
      setWorkflows(workflows.map(w => w.id === editingWorkflow.id ? { ...w, ...formData } : w));
      toast({ title: 'Automação atualizada com sucesso!' });
    } else {
      const newWorkflow: Workflow = {
        id: `wf-${Date.now()}`,
        total_execucoes: 0,
        created_date: new Date().toISOString(),
        ...formData
      };
      setWorkflows([newWorkflow, ...workflows]);
      toast({ title: 'Automação criada com sucesso!' });
    }
    setShowDialog(false);
    resetForm();
  };

  const handleDelete = () => {
    if (deletingWorkflow) {
      setWorkflows(workflows.filter(w => w.id !== deletingWorkflow.id));
      setShowDeleteDialog(false);
      setDeletingWorkflow(null);
      toast({ title: 'Automação excluída com sucesso!' });
    }
  };

  const toggleWorkflow = (id: string, ativa: boolean) => {
    setWorkflows(workflows.map(w => w.id === id ? { ...w, ativa } : w));
    toast({ title: 'Status atualizado!' });
  };

  const handleViewLogs = (workflow: Workflow) => {
    const workflowLogs = logs.filter(log => log.workflow_id === workflow.id);
    setSelectedWorkflowLogs(workflowLogs);
    setShowLogsDialog(true);
  };

  const getTipoIcon = (tipo: Workflow['tipo']) => {
    const icons = {
      notificacao_prazo: Bell,
      atribuicao_tarefa: CheckCircle2,
      aprovacao_orcamento: Filter,
      mudanca_status: Activity,
      lembrete_votacao: Bell,
      alerta_risco: AlertTriangle,
      custom: Zap
    };
    return icons[tipo] || Zap;
  };

  const getStatusVariant = (status: WorkflowLog['status']): "success" | "error" | "warning" => {
    if (status === 'success') return 'success';
    if (status === 'failed') return 'error';
    return 'warning';
  };

  const stats = {
    total: workflows.length,
    ativas: workflows.filter(w => w.ativa).length,
    execucoes_hoje: logs.filter(l => {
      const today = new Date().toDateString();
      return new Date(l.created_date).toDateString() === today;
    }).length,
    taxa_sucesso: logs.length > 0 
      ? ((logs.filter(l => l.status === 'success').length / logs.length) * 100).toFixed(0)
      : 0
  };

  return (
    <OrionGreenBackground className="orion-page">
      <div className="orion-page-content max-w-[1800px] mx-auto space-y-6">
        <header className="mb-8">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Button
                variant="outline"
                size="icon"
                onClick={() => router.push("/dashboard")}
                className="border-[rgba(0,255,180,0.25)] text-[rgba(255,255,255,0.92)] hover:bg-[rgba(0,255,180,0.12)]"
              >
                <ArrowLeft className="w-4 h-4" />
              </Button>
              <div>
                <h1 className="text-2xl font-semibold text-white tracking-wide">Automações de Workflow</h1>
                <p className="text-sm text-[rgba(255,255,255,0.65)]">Automatize processos e notificações do sistema</p>
              </div>
            </div>
            <Button
              onClick={() => {
                resetForm();
                setShowDialog(true);
              }}
              className="bg-[#00FFB4] text-[#050D0A] hover:bg-[#00E6A0] font-medium shadow-[0_0_18px_rgba(0,255,180,0.18)]"
            >
              <Plus className="w-4 h-4 mr-2" />
              Nova Automação
            </Button>
          </div>
        </header>

        <section className="grid md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <HUDCard glow glowColor="cyan">
            <div className="flex items-center justify-between mb-2">
              <Zap className="w-6 h-6 text-[#00C8FF]" />
            </div>
            <p className="text-xs text-[rgba(255,255,255,0.65)] mb-1 uppercase tracking-wide">Total de Automações</p>
            <p className="text-3xl font-semibold text-white">{stats.total}</p>
          </HUDCard>

          <HUDCard glow glowColor="green">
            <div className="flex items-center justify-between mb-2">
              <Play className="w-6 h-6 text-[#00FFB4]" />
            </div>
            <p className="text-xs text-[rgba(255,255,255,0.65)] mb-1 uppercase tracking-wide">Automações Ativas</p>
            <p className="text-3xl font-semibold text-white">{stats.ativas}</p>
          </HUDCard>

          <HUDCard glow glowColor="amber">
            <div className="flex items-center justify-between mb-2">
              <Activity className="w-6 h-6 text-[#FFB04D]" />
            </div>
            <p className="text-xs text-[rgba(255,255,255,0.65)] mb-1 uppercase tracking-wide">Execuções Hoje</p>
            <p className="text-3xl font-semibold text-white">{stats.execucoes_hoje}</p>
          </HUDCard>

          <HUDCard glow glowColor="green">
            <div className="flex items-center justify-between mb-2">
              <CheckCircle2 className="w-6 h-6 text-[#00FFB4]" />
            </div>
            <p className="text-xs text-[rgba(255,255,255,0.65)] mb-1 uppercase tracking-wide">Taxa de Sucesso</p>
            <p className="text-3xl font-semibold text-white">{stats.taxa_sucesso}%</p>
          </HUDCard>
        </section>

      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
        {workflows.map((workflow) => {
          const TipoIcon = getTipoIcon(workflow.tipo);
          const workflowLogs = logs.filter(l => l.workflow_id === workflow.id);
          const ultimaExecucao = workflowLogs[0];

          return (
            <HUDCard key={workflow.id} className="hover:border-[rgba(0,255,180,0.12)] transition-all">
              <div className="space-y-4">
                <div className="flex justify-between items-start">
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-[rgba(0,255,180,0.12)] border border-[rgba(0,255,180,0.25)]">
                      <TipoIcon className="w-5 h-5 text-[#00FFB4]" />
                    </div>
                    <div>
                      <h3 className="text-base font-semibold text-white">{workflow.nome}</h3>
                      <StatusPill variant="info" className="mt-1 text-xs">
                        {workflow.tipo.replace(/_/g, ' ')}
                      </StatusPill>
                    </div>
                  </div>
                  <Switch
                    checked={workflow.ativa}
                    onCheckedChange={(checked) => toggleWorkflow(workflow.id, checked)}
                  />
                </div>

                {workflow.descricao && (
                  <p className="text-sm text-[rgba(255,255,255,0.65)]">{workflow.descricao}</p>
                )}

                <div className="space-y-2 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-[rgba(255,255,255,0.65)]">Frequência</span>
                    <StatusPill variant="neutral">{workflow.frequencia_execucao}</StatusPill>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[rgba(255,255,255,0.65)]">Prioridade</span>
                    <StatusPill variant="neutral">{workflow.prioridade}/10</StatusPill>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[rgba(255,255,255,0.65)]">Total execuções</span>
                    <span className="font-semibold text-white">{workflow.total_execucoes || 0}</span>
                  </div>
                </div>

                {ultimaExecucao && (
                  <div className="pt-3 border-t border-[rgba(255,255,255,0.05)]">
                    <div className="flex items-center gap-2 text-xs text-[rgba(255,255,255,0.65)]">
                      <Clock className="w-3 h-3 text-[#00FFB4]" />
                      <span>Última execução:</span>
                      <StatusPill variant={ultimaExecucao.status === 'success' ? 'success' : ultimaExecucao.status === 'failed' ? 'error' : 'warning'}>
                        {ultimaExecucao.status}
                      </StatusPill>
                    </div>
                  </div>
                )}

                <div className="flex gap-2 pt-3 border-t border-[rgba(255,255,255,0.05)]">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleEdit(workflow)}
                    className="flex-1 border-[rgba(0,255,180,0.25)] text-[rgba(255,255,255,0.92)] hover:bg-[rgba(0,255,180,0.12)]"
                  >
                    <Edit className="w-3 h-3 mr-1" />
                    Editar
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleViewLogs(workflow)}
                    className="flex-1 border-[rgba(0,200,255,0.25)] text-[rgba(255,255,255,0.92)] hover:bg-[rgba(0,200,255,0.12)]"
                  >
                    <Activity className="w-3 h-3 mr-1" />
                    Logs
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setDeletingWorkflow(workflow);
                      setShowDeleteDialog(true);
                    }}
                    className="border-[rgba(255,88,96,0.25)] text-[#FF5860] hover:bg-[rgba(255,88,96,0.12)]"
                  >
                    <Trash2 className="w-3 h-3" />
                  </Button>
                </div>
              </div>
            </HUDCard>
          );
        })}
      </div>

        {workflows.length === 0 && (
          <HUDCard>
            <div className="p-12 text-center">
              <Zap className="w-16 h-16 text-[rgba(255,255,255,0.20)] mx-auto mb-4" />
              <h3 className="text-lg font-semibold text-white mb-2">
                Nenhuma automação criada
              </h3>
              <p className="text-[rgba(255,255,255,0.65)] mb-6">
                Crie automações para otimizar seus processos
              </p>
              <Button
                onClick={() => {
                  resetForm();
                  setShowDialog(true);
                }}
                className="bg-[#00FFB4] text-[#050D0A] hover:bg-[#00E6A0] font-medium shadow-[0_0_18px_rgba(0,255,180,0.18)]"
              >
                <Plus className="w-4 h-4 mr-2" />
                Criar Primeira Automação
              </Button>
            </div>
          </HUDCard>
        )}

      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="max-w-2xl bg-gradient-to-br from-[#07130F] to-[#030B09] border-[rgba(255,255,255,0.08)]">
          <DialogHeader>
            <DialogTitle className="text-white font-semibold">
              {editingWorkflow ? 'Editar Automação' : 'Nova Automação'}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label className="text-white">Nome</Label>
              <Input
                value={formData.nome}
                onChange={(e) => setFormData(prev => ({ ...prev, nome: e.target.value }))}
                placeholder="Ex: Notificar prazos próximos"
                className="bg-[rgba(255,255,255,0.05)] border-[rgba(255,255,255,0.08)] text-white placeholder:text-[rgba(255,255,255,0.40)] focus:border-[rgba(0,255,180,0.25)]"
              />
            </div>

            <div className="space-y-2">
              <Label className="text-white">Descrição</Label>
              <Textarea
                value={formData.descricao}
                onChange={(e) => setFormData(prev => ({ ...prev, descricao: e.target.value }))}
                placeholder="Descreva o que esta automação faz..."
                rows={3}
                className="bg-[rgba(255,255,255,0.05)] border-[rgba(255,255,255,0.08)] text-white placeholder:text-[rgba(255,255,255,0.40)] focus:border-[rgba(0,255,180,0.25)]"
              />
            </div>

            <div className="grid md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-white">Tipo</Label>
                <Select
                  value={formData.tipo}
                  onValueChange={(value) => setFormData(prev => ({ ...prev, tipo: value as Workflow['tipo'] }))}
                >
                  <SelectTrigger className="bg-[rgba(255,255,255,0.05)] border-[rgba(255,255,255,0.08)] text-white hover:border-[rgba(0,255,180,0.25)] focus:border-[rgba(0,255,180,0.25)]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-gradient-to-br from-[#07130F] to-[#030B09] border-[rgba(255,255,255,0.08)]">
                    <SelectItem value="notificacao_prazo" className="text-white focus:bg-[rgba(0,255,180,0.12)] focus:text-[#00FFB4]">Notificação de Prazo</SelectItem>
                    <SelectItem value="atribuicao_tarefa" className="text-white focus:bg-[rgba(0,255,180,0.12)] focus:text-[#00FFB4]">Atribuição de Tarefa</SelectItem>
                    <SelectItem value="aprovacao_orcamento" className="text-white focus:bg-[rgba(0,255,180,0.12)] focus:text-[#00FFB4]">Aprovação de Orçamento</SelectItem>
                    <SelectItem value="mudanca_status" className="text-white focus:bg-[rgba(0,255,180,0.12)] focus:text-[#00FFB4]">Mudança de Status</SelectItem>
                    <SelectItem value="lembrete_votacao" className="text-white focus:bg-[rgba(0,255,180,0.12)] focus:text-[#00FFB4]">Lembrete de Votação</SelectItem>
                    <SelectItem value="alerta_risco" className="text-white focus:bg-[rgba(0,255,180,0.12)] focus:text-[#00FFB4]">Alerta de Risco</SelectItem>
                    <SelectItem value="custom" className="text-white focus:bg-[rgba(0,255,180,0.12)] focus:text-[#00FFB4]">Personalizada</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label className="text-white">Frequência</Label>
                <Select
                  value={formData.frequencia_execucao}
                  onValueChange={(value) => setFormData(prev => ({ ...prev, frequencia_execucao: value as Workflow['frequencia_execucao'] }))}
                >
                  <SelectTrigger className="bg-[rgba(255,255,255,0.05)] border-[rgba(255,255,255,0.08)] text-white hover:border-[rgba(0,255,180,0.25)] focus:border-[rgba(0,255,180,0.25)]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-gradient-to-br from-[#07130F] to-[#030B09] border-[rgba(255,255,255,0.08)]">
                    <SelectItem value="imediata" className="text-white focus:bg-[rgba(0,255,180,0.12)] focus:text-[#00FFB4]">Imediata</SelectItem>
                    <SelectItem value="diaria" className="text-white focus:bg-[rgba(0,255,180,0.12)] focus:text-[#00FFB4]">Diária</SelectItem>
                    <SelectItem value="semanal" className="text-white focus:bg-[rgba(0,255,180,0.12)] focus:text-[#00FFB4]">Semanal</SelectItem>
                    <SelectItem value="mensal" className="text-white focus:bg-[rgba(0,255,180,0.12)] focus:text-[#00FFB4]">Mensal</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label className="text-white">Prioridade (1-10)</Label>
              <Input
                type="number"
                min="1"
                max="10"
                value={formData.prioridade}
                onChange={(e) => setFormData(prev => ({ ...prev, prioridade: parseInt(e.target.value) }))}
                className="bg-[rgba(255,255,255,0.05)] border-[rgba(255,255,255,0.08)] text-white placeholder:text-[rgba(255,255,255,0.40)] focus:border-[rgba(0,255,180,0.25)]"
              />
            </div>

            <div className="flex items-center justify-between p-3 border border-[rgba(255,255,255,0.08)] rounded-lg bg-[rgba(255,255,255,0.03)]">
              <Label className="text-white">Automação ativa</Label>
              <Switch
                checked={formData.ativa}
                onCheckedChange={(checked) => setFormData(prev => ({ ...prev, ativa: checked }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDialog(false)} className="border-[rgba(255,255,255,0.12)] text-[rgba(255,255,255,0.65)] hover:bg-[rgba(255,255,255,0.05)]">
              Cancelar
            </Button>
            <Button
              onClick={handleSubmit}
              className="bg-[#00FFB4] text-[#050D0A] hover:bg-[#00E6A0] font-medium shadow-[0_0_18px_rgba(0,255,180,0.18)]"
            >
              {editingWorkflow ? 'Atualizar' : 'Criar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showLogsDialog} onOpenChange={setShowLogsDialog}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto bg-gradient-to-br from-[#07130F] to-[#030B09] border-[rgba(255,255,255,0.08)]">
          <DialogHeader>
            <DialogTitle className="text-white font-semibold">Histórico de Execuções</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-4">
            {selectedWorkflowLogs.length > 0 ? (
              selectedWorkflowLogs.map((log) => (
                <HUDCard key={log.id}>
                  <div className="flex justify-between items-start mb-2">
                    <StatusPill variant={log.status === 'success' ? 'success' : log.status === 'failed' ? 'error' : 'warning'}>
                      {log.status}
                    </StatusPill>
                    <span className="text-xs text-[rgba(255,255,255,0.40)]">
                      {format(new Date(log.created_date), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}
                    </span>
                  </div>
                  <p className="text-sm text-[rgba(255,255,255,0.92)] mb-2">
                    <strong>Evento:</strong> {log.trigger_evento}
                  </p>
                  {log.erro_mensagem && (
                    <p className="text-sm text-[#FF5860]">
                      <strong>Erro:</strong> {log.erro_mensagem}
                    </p>
                  )}
                  {log.duracao_ms && (
                    <p className="text-xs text-[rgba(255,255,255,0.40)] mt-2">
                      Duração: {log.duracao_ms}ms
                    </p>
                  )}
                </HUDCard>
              ))
            ) : (
              <p className="text-center text-[rgba(255,255,255,0.65)] py-8">
                Nenhuma execução registrada
              </p>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent className="bg-gradient-to-br from-[#07130F] to-[#030B09] border-[rgba(255,255,255,0.08)]">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-white font-semibold">Excluir Automação</AlertDialogTitle>
            <AlertDialogDescription className="text-[rgba(255,255,255,0.65)]">
              Tem certeza que deseja excluir a automação "{deletingWorkflow?.nome}"?
              Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-[rgba(255,255,255,0.12)] text-[rgba(255,255,255,0.65)] hover:bg-[rgba(255,255,255,0.05)]">Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-[#FF5860] hover:bg-[#FF4040] text-white"
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      </div>
    </OrionGreenBackground>
  );
}
