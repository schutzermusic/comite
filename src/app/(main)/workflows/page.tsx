'use client';

import { useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  Bell,
  CheckCircle2,
  Clock,
  Edit,
  GitBranch,
  Play,
  Plus,
  Trash2,
  Zap,
} from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { HudBadge } from "@/components/hud/HudBadge";
import { HudButton } from "@/components/hud/HudButton";
import { HudHeader } from "@/components/hud/HudHeader";
import { HudInput } from "@/components/hud/HudInput";
import { HudPageLayout } from "@/components/hud/HudPageLayout";
import { HudPanel } from "@/components/hud/HudPanel";
import { HudSelect } from "@/components/hud/HudSelect";
import { HudTable } from "@/components/hud/HudTable";
import type { HudTableColumn } from "@/components/hud/HudTable";
import { workflows as mockWorkflows, workflowLogs as mockWorkflowLogs } from "@/lib/mock-data";
import type { Workflow, WorkflowLog } from "@/lib/types";

const workflowTypeLabels: Record<Workflow["tipo"], string> = {
  notificacao_prazo: "Notificação de prazo",
  atribuicao_tarefa: "Atribuição de tarefa",
  aprovacao_orcamento: "Aprovação de orçamento",
  mudanca_status: "Mudança de status",
  lembrete_votacao: "Lembrete de votação",
  alerta_risco: "Alerta de risco",
  custom: "Personalizada",
};

const frequencyLabels: Record<Workflow["frequencia_execucao"], string> = {
  imediata: "Imediata",
  diaria: "Diária",
  semanal: "Semanal",
  mensal: "Mensal",
};

const typeOptions = Object.entries(workflowTypeLabels).map(([value, label]) => ({ value, label }));
const frequencyOptions = Object.entries(frequencyLabels).map(([value, label]) => ({ value, label }));

type WorkflowFormData = Pick<Workflow, "nome" | "descricao" | "tipo" | "ativa" | "prioridade" | "frequencia_execucao">;

const emptyForm: WorkflowFormData = {
  nome: "",
  descricao: "",
  tipo: "notificacao_prazo",
  ativa: true,
  prioridade: 5,
  frequencia_execucao: "imediata",
};

function statusVariant(status: WorkflowLog["status"]): "success" | "danger" | "warning" {
  if (status === "success") return "success";
  if (status === "failed") return "danger";
  return "warning";
}

function typeIcon(tipo: Workflow["tipo"]) {
  const icons = {
    notificacao_prazo: Bell,
    atribuicao_tarefa: CheckCircle2,
    aprovacao_orcamento: GitBranch,
    mudanca_status: Activity,
    lembrete_votacao: Bell,
    alerta_risco: AlertTriangle,
    custom: Zap,
  };
  return icons[tipo];
}

export default function WorkflowsPage() {
  const [workflows, setWorkflows] = useState<Workflow[]>(mockWorkflows);
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string | null>(mockWorkflows[0]?.id ?? null);
  const [editingWorkflow, setEditingWorkflow] = useState<Workflow | null>(null);
  const [formData, setFormData] = useState<WorkflowFormData>(emptyForm);

  const selectedWorkflow = workflows.find((workflow) => workflow.id === selectedWorkflowId) ?? null;
  const selectedLogs = useMemo(
    () => mockWorkflowLogs.filter((log) => log.workflow_id === selectedWorkflowId),
    [selectedWorkflowId],
  );

  const stats = useMemo(
    () => ({
      total: workflows.length,
      ativas: workflows.filter((workflow) => workflow.ativa).length,
      execucoesHoje: mockWorkflowLogs.filter((log) => {
        const today = new Date().toDateString();
        return new Date(log.created_date).toDateString() === today;
      }).length,
      taxaSucesso:
        mockWorkflowLogs.length > 0
          ? Math.round((mockWorkflowLogs.filter((log) => log.status === "success").length / mockWorkflowLogs.length) * 100)
          : 0,
    }),
    [workflows],
  );

  const resetForm = () => {
    setFormData(emptyForm);
    setEditingWorkflow(null);
  };

  const startCreate = () => {
    resetForm();
    setSelectedWorkflowId(null);
  };

  const startEdit = (workflow: Workflow) => {
    setEditingWorkflow(workflow);
    setFormData({
      nome: workflow.nome,
      descricao: workflow.descricao ?? "",
      tipo: workflow.tipo,
      ativa: workflow.ativa,
      prioridade: workflow.prioridade,
      frequencia_execucao: workflow.frequencia_execucao,
    });
  };

  const saveWorkflow = () => {
    if (!formData.nome.trim()) return;

    if (editingWorkflow) {
      setWorkflows((current) =>
        current.map((workflow) =>
          workflow.id === editingWorkflow.id ? { ...workflow, ...formData, nome: formData.nome.trim() } : workflow,
        ),
      );
      setSelectedWorkflowId(editingWorkflow.id);
    } else {
      const workflow: Workflow = {
        id: `wf-${Date.now()}`,
        total_execucoes: 0,
        created_date: new Date().toISOString(),
        ...formData,
        nome: formData.nome.trim(),
      };
      setWorkflows((current) => [workflow, ...current]);
      setSelectedWorkflowId(workflow.id);
    }

    resetForm();
  };

  const toggleWorkflow = (workflow: Workflow) => {
    setWorkflows((current) =>
      current.map((item) => (item.id === workflow.id ? { ...item, ativa: !item.ativa } : item)),
    );
  };

  const deleteWorkflow = (workflow: Workflow) => {
    setWorkflows((current) => current.filter((item) => item.id !== workflow.id));
    if (selectedWorkflowId === workflow.id) {
      setSelectedWorkflowId(null);
    }
    if (editingWorkflow?.id === workflow.id) {
      resetForm();
    }
  };

  const logColumns: HudTableColumn<WorkflowLog>[] = [
    {
      key: "status",
      header: "Status",
      cell: (log) => <HudBadge variant={statusVariant(log.status)}>{log.status}</HudBadge>,
    },
    {
      key: "trigger_evento",
      header: "Evento",
      cell: (log) => <span className="text-ig-fg">{log.trigger_evento}</span>,
    },
    {
      key: "duracao_ms",
      header: "Duração",
      align: "right",
      cell: (log) => <span className="text-ig-fg-muted">{log.duracao_ms}ms</span>,
    },
    {
      key: "created_date",
      header: "Data",
      align: "right",
      cell: (log) => (
        <span className="text-ig-fg-muted">
          {format(new Date(log.created_date), "dd/MM/yyyy HH:mm", { locale: ptBR })}
        </span>
      ),
    },
  ];

  return (
    <HudPageLayout>
      <HudHeader
        title="Workflows"
        subtitle="Automatize processos e notificações do sistema"
        icon={<GitBranch size={18} />}
        iconTint="#A855F7"
        actions={
          <HudButton variant="primary" leftIcon={<Plus className="h-4 w-4" />} onClick={startCreate}>
            Nova Automação
          </HudButton>
        }
      />

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <HudPanel elevation={2} icon={<Zap className="h-5 w-5" />} title="Total de Automações" iconTint="#A855F7">
          <p className="text-3xl font-semibold text-ig-fg-strong">{stats.total}</p>
        </HudPanel>
        <HudPanel elevation={2} icon={<Play className="h-5 w-5" />} title="Automações Ativas" iconTint="#14B8A6">
          <p className="text-3xl font-semibold text-ig-fg-strong">{stats.ativas}</p>
        </HudPanel>
        <HudPanel elevation={2} icon={<Activity className="h-5 w-5" />} title="Execuções Hoje" iconTint="#F59E0B">
          <p className="text-3xl font-semibold text-ig-fg-strong">{stats.execucoesHoje}</p>
        </HudPanel>
        <HudPanel elevation={2} icon={<CheckCircle2 className="h-5 w-5" />} title="Taxa de Sucesso" iconTint="#14B8A6">
          <p className="text-3xl font-semibold text-ig-fg-strong">{stats.taxaSucesso}%</p>
        </HudPanel>
      </section>

      <div className="grid gap-6 xl:grid-cols-[1fr_420px]">
        <section className="grid gap-4 lg:grid-cols-2">
          {workflows.map((workflow) => {
            const Icon = typeIcon(workflow.tipo);
            const lastLog = mockWorkflowLogs.find((log) => log.workflow_id === workflow.id);

            return (
              <HudPanel key={workflow.id} elevation={2} interactive>
                <div className="flex h-full flex-col gap-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-ig-border-focus bg-ig-accent-weak text-ig-accent">
                        <Icon className="h-5 w-5" />
                      </span>
                      <div className="min-w-0">
                        <h2 className="truncate text-ig-h3 text-ig-fg-strong">{workflow.nome}</h2>
                        <div className="mt-2">
                          <HudBadge variant="info">{workflowTypeLabels[workflow.tipo]}</HudBadge>
                        </div>
                      </div>
                    </div>
                    <HudBadge variant={workflow.ativa ? "success" : "neutral"} dot>
                      {workflow.ativa ? "Ativa" : "Pausada"}
                    </HudBadge>
                  </div>

                  {workflow.descricao && <p className="text-sm text-ig-fg-muted">{workflow.descricao}</p>}

                  <div className="grid gap-2 text-sm">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-ig-fg-muted">Frequência</span>
                      <HudBadge variant="neutral">{frequencyLabels[workflow.frequencia_execucao]}</HudBadge>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-ig-fg-muted">Prioridade</span>
                      <span className="font-semibold text-ig-fg-strong">{workflow.prioridade}/10</span>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-ig-fg-muted">Total execuções</span>
                      <span className="font-semibold text-ig-fg-strong">{workflow.total_execucoes}</span>
                    </div>
                  </div>

                  {lastLog && (
                    <div className="flex items-center gap-2 border-t border-ig-border-subtle pt-3 text-xs text-ig-fg-muted">
                      <Clock className="h-3.5 w-3.5 text-ig-accent" />
                      <span>Última execução</span>
                      <HudBadge variant={statusVariant(lastLog.status)} size="sm">
                        {lastLog.status}
                      </HudBadge>
                    </div>
                  )}

                  <div className="mt-auto flex flex-wrap gap-2 border-t border-ig-border-subtle pt-3">
                    <HudButton variant="secondary" size="sm" leftIcon={<Edit className="h-3.5 w-3.5" />} onClick={() => startEdit(workflow)}>
                      Editar
                    </HudButton>
                    <HudButton variant="ghost" size="sm" leftIcon={<Activity className="h-3.5 w-3.5" />} onClick={() => setSelectedWorkflowId(workflow.id)}>
                      Logs
                    </HudButton>
                    <HudButton variant="ghost" size="sm" onClick={() => toggleWorkflow(workflow)}>
                      {workflow.ativa ? "Pausar" : "Ativar"}
                    </HudButton>
                    <HudButton variant="danger" size="sm" leftIcon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => deleteWorkflow(workflow)}>
                      Excluir
                    </HudButton>
                  </div>
                </div>
              </HudPanel>
            );
          })}
        </section>

        <aside className="space-y-6">
          <HudPanel elevation={2} title={editingWorkflow ? "Editar Automação" : "Nova Automação"} subtitle="Defina gatilhos, prioridade e frequência">
            <div className="space-y-4">
              <HudInput
                label="Nome"
                value={formData.nome}
                onChange={(event) => setFormData((current) => ({ ...current, nome: event.target.value }))}
                placeholder="Ex: Notificar prazos próximos"
              />
              <div className="flex flex-col gap-1.5">
                <label className="text-[11px] font-medium uppercase tracking-wider text-ig-fg-muted">Descrição</label>
                <textarea
                  value={formData.descricao}
                  onChange={(event) => setFormData((current) => ({ ...current, descricao: event.target.value }))}
                  placeholder="Descreva o que esta automação faz"
                  rows={3}
                  className="min-h-24 rounded-lg border border-ig-border bg-ig-panel px-4 py-3 text-sm text-ig-fg outline-none transition-colors placeholder:text-ig-fg-subtle focus:border-ig-border-focus focus-visible:shadow-[var(--ig-focus-ring-outer)]"
                />
              </div>
              <HudSelect
                label="Tipo"
                value={formData.tipo}
                onChange={(value) => setFormData((current) => ({ ...current, tipo: value as Workflow["tipo"] }))}
                options={typeOptions}
              />
              <HudSelect
                label="Frequência"
                value={formData.frequencia_execucao}
                onChange={(value) => setFormData((current) => ({ ...current, frequencia_execucao: value as Workflow["frequencia_execucao"] }))}
                options={frequencyOptions}
              />
              <HudInput
                label="Prioridade"
                type="number"
                min={1}
                max={10}
                value={formData.prioridade}
                onChange={(event) => setFormData((current) => ({ ...current, prioridade: Number(event.target.value) }))}
              />
              <button
                type="button"
                onClick={() => setFormData((current) => ({ ...current, ativa: !current.ativa }))}
                className="flex w-full items-center justify-between rounded-lg border border-ig-border bg-ig-panel px-4 py-3 text-left transition-colors hover:border-ig-border-focus"
              >
                <span>
                  <span className="block text-sm font-medium text-ig-fg-strong">Automação ativa</span>
                  <span className="block text-xs text-ig-fg-muted">Controla se a regra será executada.</span>
                </span>
                <HudBadge variant={formData.ativa ? "success" : "neutral"}>{formData.ativa ? "Sim" : "Não"}</HudBadge>
              </button>
              <div className="flex gap-2">
                <HudButton variant="primary" fullWidth onClick={saveWorkflow}>
                  {editingWorkflow ? "Atualizar" : "Criar"}
                </HudButton>
                <HudButton variant="secondary" onClick={resetForm}>
                  Limpar
                </HudButton>
              </div>
            </div>
          </HudPanel>

          <HudPanel
            elevation={2}
            title="Histórico de Execuções"
            subtitle={selectedWorkflow ? selectedWorkflow.nome : "Selecione uma automação"}
          >
            <HudTable
              columns={logColumns}
              data={selectedLogs}
              keyExtractor={(log) => log.id}
              compact
              emptyState={<p className="py-8 text-center text-sm text-ig-fg-muted">Nenhuma execução registrada</p>}
            />
          </HudPanel>
        </aside>
      </div>
    </HudPageLayout>
  );
}
