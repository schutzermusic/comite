
'use client';
import React, { useState, useEffect, useRef, useMemo, useCallback, Suspense } from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import {
  Briefcase,
  Search,
  TrendingUp,
  DollarSign,
  AlertTriangle,
  Building2,
  Eye,
  Download,
  Trash2,
  Heart,
  Clock,
  ShieldAlert,
  BarChart3,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PrimaryCTA } from "@/components/ui/primary-cta";
import { SecondaryButton } from "@/components/ui/secondary-button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { HUDCard } from "@/components/ui/hud-card";
import { StatusPill } from "@/components/ui/status-pill";
import { HUDProgressBar } from "@/components/ui/hud-progress-bar";
import { OrionGreenBackground } from "@/components/system/OrionGreenBackground";
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
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { votes as mockPautas } from "@/lib/mock-data";
import { getProjects, getProjectsV2, deleteProject } from "@/lib/services/projects";
import { useToast } from "@/hooks/use-toast";
import { Project } from "@/lib/types";
import type { ProjectV2 } from "@/lib/types/project-v2";
import { ProjectDetailDrawer } from "@/components/portfolio/ProjectDetailDrawer";
import { cn } from "@/lib/utils";
import { getHealthScoreColor, getHealthScoreLabel, formatMoney } from "@/lib/utils/project-utils";

function PortfolioProjetosInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const highlightedRowRef = useRef<HTMLTableRowElement>(null);

  // Read deep-link params from URL
  const ufParam = searchParams.get('uf');
  const contractIdParam = searchParams.get('contractId');
  const viewParam = searchParams.get('view');
  const statusParam = searchParams.get('status');
  const clientParam = searchParams.get('client');
  const healthParam = searchParams.get('health');

  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState(statusParam || "all");
  const [comiteFilter, setComiteFilter] = useState("all");
  const [impactoFilter, setImpactoFilter] = useState("all");
  const [clientFilter, setClientFilter] = useState(clientParam || "all");
  const [healthFilter, setHealthFilter] = useState(healthParam || "all");
  const [contractFilter, setContractFilter] = useState("all"); // yes / no / all
  const [ufFilter, setUfFilter] = useState<string | null>(null);
  const [highlightedContractId, setHighlightedContractId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState(viewParam || "cards");
  const [projects, setProjects] = useState(() => getProjects());
  const [projectsV2, setProjectsV2] = useState<ProjectV2[]>([]);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [projectToDelete, setProjectToDelete] = useState<string | null>(null);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [projectDrawerOpen, setProjectDrawerOpen] = useState(false);

  // Apply deep-link filters from URL params
  useEffect(() => {
    if (ufParam) {
      setUfFilter(ufParam);
      // Show notification about filter
      toast({
        title: `Filtrado por ${ufParam}`,
        description: contractIdParam
          ? `Mostrando contrato ${contractIdParam}`
          : `Mostrando projetos do estado ${ufParam}`,
      });
    }
    if (contractIdParam) {
      setHighlightedContractId(contractIdParam);
      // Switch to table view for better visibility
      setViewMode('table');
    }
  }, [ufParam, contractIdParam, toast]);

  // Scroll to highlighted row
  useEffect(() => {
    if (highlightedRowRef.current && highlightedContractId) {
      highlightedRowRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [highlightedContractId, viewMode]);

  // Recarregar projetos quando a página for montada ou quando voltar de criar
  useEffect(() => {
    setProjects(getProjects());
    try {
      setProjectsV2(getProjectsV2());
    } catch { /* v2 not available yet */ }
  }, []);

  // Persist filters in URL (shareable)
  const updateURL = useCallback((overrides: Record<string, string>) => {
    const params = new URLSearchParams(window.location.search);
    for (const [key, value] of Object.entries(overrides)) {
      if (value === 'all' || !value) params.delete(key);
      else params.set(key, value);
    }
    const newURL = params.toString() ? `?${params.toString()}` : window.location.pathname;
    window.history.replaceState(null, '', newURL);
  }, []);

  // Sync filter changes to URL
  useEffect(() => {
    updateURL({
      status: statusFilter,
      client: clientFilter,
      health: healthFilter,
      view: viewMode,
    });
  }, [statusFilter, clientFilter, healthFilter, viewMode, updateURL]);


  const comites = projects.map(p => ({ id: p.comite_id, nome: p.comite_nome })).filter((v, i, a) => a.findIndex(t => (t.id === v.id)) === i).filter((c) => c.id && c.nome) as { id: string, nome: string }[];

  const handleDeleteClick = (projectId: string) => {
    setProjectToDelete(projectId);
    setDeleteDialogOpen(true);
  };

  const handleDeleteConfirm = async () => {
    if (!projectToDelete) return;

    try {
      await deleteProject(projectToDelete);
      setProjects(getProjects());
      toast({
        title: 'Projeto excluído',
        description: 'O projeto foi removido com sucesso.',
      });
      setDeleteDialogOpen(false);
      setProjectToDelete(null);
    } catch (error) {
      toast({
        title: 'Erro ao excluir',
        description: error instanceof Error ? error.message : 'Ocorreu um erro ao excluir o projeto',
        variant: 'destructive',
      });
    }
  };

  // Unique clients for filter
  const uniqueClients = useMemo(
    () => [...new Set(projects.map(p => p.cliente).filter(Boolean))] as string[],
    [projects]
  );

  // V2 lookup map
  const v2Map = useMemo(() => {
    const m = new Map<string, ProjectV2>();
    projectsV2.forEach(p => m.set(p.id, p));
    return m;
  }, [projectsV2]);

  // Filter projects (including new v2 filters)
  const filteredProjetos = projects.filter(projeto => {
    const searchMatch =
      projeto.nome?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      projeto.codigo?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      projeto.cliente?.toLowerCase().includes(searchTerm.toLowerCase());

    const statusMatch = statusFilter === 'all' || projeto.status === statusFilter;
    const comiteMatch = comiteFilter === 'all' ||
      (comiteFilter === 'sem_comite' && !projeto.comite_id) ||
      projeto.comite_id === comiteFilter;
    const impactoMatch = impactoFilter === 'all' || projeto.impacto_financeiro === impactoFilter;
    const clientMatch = clientFilter === 'all' || projeto.cliente === clientFilter;

    // Health score filter (v2)
    let healthMatch = true;
    if (healthFilter !== 'all') {
      const v2 = v2Map.get(projeto.id);
      const score = v2?.health_score ?? 100;
      if (healthFilter === 'critical') healthMatch = score < 40;
      else if (healthFilter === 'attention') healthMatch = score >= 40 && score < 60;
      else if (healthFilter === 'good') healthMatch = score >= 60 && score < 80;
      else if (healthFilter === 'excellent') healthMatch = score >= 80;
    }

    // Contract filter (v2)
    let contractMatch = true;
    if (contractFilter !== 'all') {
      const v2 = v2Map.get(projeto.id);
      if (contractFilter === 'yes') contractMatch = !!v2?.contract_id;
      else if (contractFilter === 'no') contractMatch = !v2?.contract_id;
    }

    return searchMatch && statusMatch && comiteMatch && impactoMatch && clientMatch && healthMatch && contractMatch;
  });

  // Calculate statistics
  const stats = {
    total: projects.length,
    emAndamento: projects.filter(p => p.status === 'em_andamento').length,
    concluidos: projects.filter(p => p.status === 'concluido').length,
    valorTotal: projects.reduce((sum, p) => sum + (p.valor_total || 0), 0),
    valorExecutado: projects.reduce((sum, p) => sum + (p.valor_executado || 0), 0),
    altoImpacto: projects.filter(p => p.impacto_financeiro === 'alto' || p.impacto_financeiro === 'critico').length,
    comSupevisao: projects.filter(p => p.comite_id).length
  };

  // V2 KPIs
  const v2Stats = useMemo(() => {
    if (projectsV2.length === 0) return null;
    const now = new Date().toISOString();
    const overdueTasks = projectsV2.reduce(
      (sum, p) => sum + (p.tasks || []).filter(t => t.status !== 'completed' && t.endDate < now).length, 0
    );
    const openHighRisks = projectsV2.reduce(
      (sum, p) => sum + (p.risks || []).filter(r => r.status !== 'resolved' && (r.severity === 'high' || r.severity === 'critical') && !r.mitigation).length, 0
    );
    const budgetVarianceProjects = projectsV2.filter(
      p => p.finance && p.finance.variancePercent > 5
    ).length;
    const avgHealth = Math.round(
      projectsV2.reduce((sum, p) => sum + (p.health_score || 0), 0) / projectsV2.length
    );
    return { overdueTasks, openHighRisks, budgetVarianceProjects, avgHealth };
  }, [projectsV2]);


  const getStatusColor = (status: string) => {
    const colors: Record<string, string> = {
      planejamento: 'bg-blue-100 text-blue-700 border-blue-300',
      em_andamento: 'bg-green-100 text-green-700 border-green-300',
      pausado: 'bg-amber-100 text-amber-700 border-amber-300',
      concluido: 'bg-slate-100 text-slate-700 border-slate-300',
      cancelado: 'bg-red-100 text-red-700 border-red-300'
    };
    return colors[status] || colors.planejamento;
  };

  const getImpactoColor = (impacto: string) => {
    const colors: Record<string, string> = {
      baixo: 'text-green-600',
      medio: 'text-amber-600',
      alto: 'text-orange-600',
      critico: 'text-red-600'
    };
    return colors[impacto] || colors.medio;
  };

  const getComiteStatusColor = (status?: string) => {
    const colors: Record<string, string> = {
      sem_supervisao: 'bg-slate-100 text-slate-700',
      ativo: 'bg-green-100 text-green-700',
      atencao_necessaria: 'bg-amber-100 text-amber-700',
      revisao_pendente: 'bg-orange-100 text-orange-700'
    };
    return colors[status || 'sem_supervisao'] || colors.sem_supervisao;
  };

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(value || 0);
  };

  const exportToCSV = () => {
    const headers = ['Código', 'Nome', 'Cliente', 'Status', 'Valor Total', 'Valor Executado', 'Progresso', 'Comitê', 'Impacto'];
    const rows = filteredProjetos.map(p => [
      p.codigo,
      p.nome,
      p.cliente,
      p.status,
      p.valor_total,
      p.valor_executado,
      `${p.progresso_percentual}%`,
      p.comite_nome || 'Sem supervisão',
      p.impacto_financeiro
    ]);

    const csv = [headers, ...rows].map(row => row.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `portfolio-projetos-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
  };

  return (
    <OrionGreenBackground className="orion-page">
      <div className="orion-page-content max-w-[1800px] mx-auto space-y-6">
        {/* Page Header */}
        <header className="mb-6">
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
            <div>
              <h1 className="text-2xl font-semibold text-white mb-1 tracking-wide">Projetos</h1>
              <p className="text-sm text-[rgba(255,255,255,0.65)]">Gestão de Projetos Ativos</p>
            </div>
            <div className="flex gap-2">
              <SecondaryButton onClick={exportToCSV} className="px-5">
                <Download className="w-4 h-4 mr-2" />
                Exportar CSV
              </SecondaryButton>
              <Link href="/projetos/novo">
                <PrimaryCTA className="px-5">
                  <Briefcase className="w-4 h-4 mr-2" />
                  Novo Projeto
                </PrimaryCTA>
              </Link>
            </div>
          </div>
        </header>

        {/* Projects KPI Band - Compact Kanban Style */}
        <section className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
          <div className="flex items-center gap-3 px-4 py-3 rounded-lg border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.02)]">
            <Briefcase className="w-5 h-5 text-[#00C8FF] flex-shrink-0" />
            <div>
              <p className="text-xs text-[rgba(255,255,255,0.50)] uppercase tracking-wide">Projetos</p>
              <p className="text-xl font-semibold text-white tabular-nums">{stats.total}</p>
            </div>
          </div>
          <div className="flex items-center gap-3 px-4 py-3 rounded-lg border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.02)]">
            <TrendingUp className="w-5 h-5 text-[#00FFB4] flex-shrink-0" />
            <div>
              <p className="text-xs text-[rgba(255,255,255,0.50)] uppercase tracking-wide">Em Andamento</p>
              <p className="text-xl font-semibold text-white tabular-nums">{stats.emAndamento}</p>
            </div>
          </div>
          <div className="flex items-center gap-3 px-4 py-3 rounded-lg border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.02)]">
            <DollarSign className="w-5 h-5 text-[#00C8FF] flex-shrink-0" />
            <div>
              <p className="text-xs text-[rgba(255,255,255,0.50)] uppercase tracking-wide">Valor Total</p>
              <p className="text-lg font-semibold text-white tabular-nums">{formatCurrency(stats.valorTotal)}</p>
            </div>
          </div>
          <div className="flex items-center gap-3 px-4 py-3 rounded-lg border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.02)]">
            <AlertTriangle className="w-5 h-5 text-[#FFB04D] flex-shrink-0" />
            <div>
              <p className="text-xs text-[rgba(255,255,255,0.50)] uppercase tracking-wide">Alto Impacto</p>
              <p className="text-xl font-semibold text-white tabular-nums">{stats.altoImpacto}</p>
            </div>
          </div>
        </section>

        {/* V2 Governance KPIs */}
        {v2Stats && (
          <section className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            <div className="flex items-center gap-3 px-4 py-3 rounded-lg border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.02)]">
              <Clock className="w-5 h-5 text-[#FF8C42] flex-shrink-0" />
              <div>
                <p className="text-xs text-[rgba(255,255,255,0.50)] uppercase tracking-wide">Tarefas Atrasadas</p>
                <p className="text-xl font-semibold text-white tabular-nums">{v2Stats.overdueTasks}</p>
              </div>
            </div>
            <div className="flex items-center gap-3 px-4 py-3 rounded-lg border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.02)]">
              <ShieldAlert className="w-5 h-5 text-[#FF4040] flex-shrink-0" />
              <div>
                <p className="text-xs text-[rgba(255,255,255,0.50)] uppercase tracking-wide">Riscos Sem Mitigação</p>
                <p className="text-xl font-semibold text-white tabular-nums">{v2Stats.openHighRisks}</p>
              </div>
            </div>
            <div className="flex items-center gap-3 px-4 py-3 rounded-lg border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.02)]">
              <BarChart3 className="w-5 h-5 text-[#FFB84D] flex-shrink-0" />
              <div>
                <p className="text-xs text-[rgba(255,255,255,0.50)] uppercase tracking-wide">Acima do Orçamento</p>
                <p className="text-xl font-semibold text-white tabular-nums">{v2Stats.budgetVarianceProjects}</p>
              </div>
            </div>
            <div className="flex items-center gap-3 px-4 py-3 rounded-lg border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.02)]">
              <Heart className="w-5 h-5 flex-shrink-0" style={{ color: getHealthScoreColor(v2Stats.avgHealth) }} />
              <div>
                <p className="text-xs text-[rgba(255,255,255,0.50)] uppercase tracking-wide">Saúde Média</p>
                <p className="text-xl font-semibold tabular-nums" style={{ color: getHealthScoreColor(v2Stats.avgHealth) }}>
                  {v2Stats.avgHealth}
                </p>
              </div>
            </div>
          </section>
        )}

        {/* Filter Bar - Inline Kanban Style */}
        <div className="flex flex-col md:flex-row items-stretch md:items-center gap-3 mb-4">
          <div className="relative flex-1 md:max-w-sm">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-[rgba(255,255,255,0.40)]" />
            <Input
              placeholder="Buscar por nome, código ou cliente..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10 h-9 bg-[rgba(255,255,255,0.05)] border-[rgba(255,255,255,0.08)] text-white text-sm placeholder:text-[rgba(255,255,255,0.40)] focus:border-[rgba(0,255,180,0.25)]"
            />
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[130px] h-9 bg-[rgba(255,255,255,0.05)] border-[rgba(255,255,255,0.08)] text-white text-sm hover:border-[rgba(0,255,180,0.25)]">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent className="bg-gradient-to-br from-[#07130F] to-[#030B09] border-[rgba(255,255,255,0.08)]">
                <SelectItem value="all" className="text-white text-sm focus:bg-[rgba(0,255,180,0.12)] focus:text-[#00FFB4]">Todos Status</SelectItem>
                <SelectItem value="planejamento" className="text-white text-sm focus:bg-[rgba(0,255,180,0.12)] focus:text-[#00FFB4]">Planejamento</SelectItem>
                <SelectItem value="em_andamento" className="text-white text-sm focus:bg-[rgba(0,255,180,0.12)] focus:text-[#00FFB4]">Em Andamento</SelectItem>
                <SelectItem value="pausado" className="text-white text-sm focus:bg-[rgba(0,255,180,0.12)] focus:text-[#00FFB4]">Pausado</SelectItem>
                <SelectItem value="concluido" className="text-white text-sm focus:bg-[rgba(0,255,180,0.12)] focus:text-[#00FFB4]">Concluído</SelectItem>
                <SelectItem value="cancelado" className="text-white text-sm focus:bg-[rgba(0,255,180,0.12)] focus:text-[#00FFB4]">Cancelado</SelectItem>
              </SelectContent>
            </Select>
            <Select value={comiteFilter} onValueChange={setComiteFilter}>
              <SelectTrigger className="w-[140px] h-9 bg-[rgba(255,255,255,0.05)] border-[rgba(255,255,255,0.08)] text-white text-sm hover:border-[rgba(0,255,180,0.25)]">
                <SelectValue placeholder="Comitê" />
              </SelectTrigger>
              <SelectContent className="bg-gradient-to-br from-[#07130F] to-[#030B09] border-[rgba(255,255,255,0.08)]">
                <SelectItem value="all" className="text-white text-sm focus:bg-[rgba(0,255,180,0.12)] focus:text-[#00FFB4]">Todos Comitês</SelectItem>
                {comites.map(c => (
                  <SelectItem key={c.id} value={c.id || ''} className="text-white text-sm focus:bg-[rgba(0,255,180,0.12)] focus:text-[#00FFB4]">{c.nome}</SelectItem>
                ))}
                <SelectItem value="sem_comite" className="text-white text-sm focus:bg-[rgba(0,255,180,0.12)] focus:text-[#00FFB4]">Sem Supervisão</SelectItem>
              </SelectContent>
            </Select>
            <Select value={impactoFilter} onValueChange={setImpactoFilter}>
              <SelectTrigger className="w-[130px] h-9 bg-[rgba(255,255,255,0.05)] border-[rgba(255,255,255,0.08)] text-white text-sm hover:border-[rgba(0,255,180,0.25)]">
                <SelectValue placeholder="Impacto" />
              </SelectTrigger>
              <SelectContent className="bg-gradient-to-br from-[#07130F] to-[#030B09] border-[rgba(255,255,255,0.08)]">
                <SelectItem value="all" className="text-white text-sm focus:bg-[rgba(0,255,180,0.12)] focus:text-[#00FFB4]">Todos Impactos</SelectItem>
                <SelectItem value="baixo" className="text-white text-sm focus:bg-[rgba(0,255,180,0.12)] focus:text-[#00FFB4]">Baixo</SelectItem>
                <SelectItem value="medio" className="text-white text-sm focus:bg-[rgba(0,255,180,0.12)] focus:text-[#00FFB4]">Médio</SelectItem>
                <SelectItem value="alto" className="text-white text-sm focus:bg-[rgba(0,255,180,0.12)] focus:text-[#00FFB4]">Alto</SelectItem>
                <SelectItem value="critico" className="text-white text-sm focus:bg-[rgba(0,255,180,0.12)] focus:text-[#00FFB4]">Crítico</SelectItem>
              </SelectContent>
            </Select>
            <Select value={clientFilter} onValueChange={setClientFilter}>
              <SelectTrigger className="w-[140px] h-9 bg-[rgba(255,255,255,0.05)] border-[rgba(255,255,255,0.08)] text-white text-sm hover:border-[rgba(0,255,180,0.25)]">
                <SelectValue placeholder="Cliente" />
              </SelectTrigger>
              <SelectContent className="bg-gradient-to-br from-[#07130F] to-[#030B09] border-[rgba(255,255,255,0.08)]">
                <SelectItem value="all" className="text-white text-sm focus:bg-[rgba(0,255,180,0.12)] focus:text-[#00FFB4]">Todos Clientes</SelectItem>
                {uniqueClients.map(c => (
                  <SelectItem key={c} value={c} className="text-white text-sm focus:bg-[rgba(0,255,180,0.12)] focus:text-[#00FFB4]">{c}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={healthFilter} onValueChange={setHealthFilter}>
              <SelectTrigger className="w-[130px] h-9 bg-[rgba(255,255,255,0.05)] border-[rgba(255,255,255,0.08)] text-white text-sm hover:border-[rgba(0,255,180,0.25)]">
                <SelectValue placeholder="Saúde" />
              </SelectTrigger>
              <SelectContent className="bg-gradient-to-br from-[#07130F] to-[#030B09] border-[rgba(255,255,255,0.08)]">
                <SelectItem value="all" className="text-white text-sm focus:bg-[rgba(0,255,180,0.12)] focus:text-[#00FFB4]">Todas Saúdes</SelectItem>
                <SelectItem value="excellent" className="text-white text-sm focus:bg-[rgba(0,255,180,0.12)] focus:text-[#00FFB4]">Excelente (80+)</SelectItem>
                <SelectItem value="good" className="text-white text-sm focus:bg-[rgba(0,255,180,0.12)] focus:text-[#00FFB4]">Bom (60-79)</SelectItem>
                <SelectItem value="attention" className="text-white text-sm focus:bg-[rgba(0,255,180,0.12)] focus:text-[#00FFB4]">Atenção (40-59)</SelectItem>
                <SelectItem value="critical" className="text-white text-sm focus:bg-[rgba(0,255,180,0.12)] focus:text-[#00FFB4]">Crítico (&lt;40)</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* View Toggle */}
        <div className="flex justify-end">
          <div className="inline-flex rounded-lg border border-[rgba(255,255,255,0.08)] p-1 bg-[rgba(255,255,255,0.03)]">
            <Button
              variant={viewMode === 'cards' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => setViewMode('cards')}
              className={viewMode === 'cards' ? 'bg-[#00FFB4] text-[#050D0A] hover:bg-[#00E6A0]' : 'text-[rgba(255,255,255,0.65)] hover:text-white'}
            >
              Cards
            </Button>
            <Button
              variant={viewMode === 'table' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => setViewMode('table')}
              className={viewMode === 'table' ? 'bg-[#00FFB4] text-[#050D0A] hover:bg-[#00E6A0]' : 'text-[rgba(255,255,255,0.65)] hover:text-white'}
            >
              Tabela
            </Button>
          </div>
        </div>

        {/* Projects Display */}
        {viewMode === 'cards' ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredProjetos.map((projeto) => {
              const comite = comites.find(c => c.id === projeto.comite_id);

              return (
                <div
                  key={projeto.id}
                  className="rounded-lg border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.02)] p-4 hover:border-[rgba(0,255,180,0.20)] transition-all flex flex-col"
                >
                  {/* Tags Row */}
                  <div className="flex items-center gap-2 mb-3">
                    <Badge variant="outline" className="text-xs bg-[rgba(255,255,255,0.05)] text-[rgba(255,255,255,0.65)] border-[rgba(255,255,255,0.12)]">
                      {projeto.codigo || '—'}
                    </Badge>
                    {projeto.sankhya_integrado && (
                      <StatusPill variant="info">Sankhya</StatusPill>
                    )}
                  </div>

                  {/* Title + Client */}
                  <h3 className="text-sm font-semibold text-white mb-1 line-clamp-2">{projeto.nome || '—'}</h3>
                  <p className="text-xs text-[rgba(255,255,255,0.55)] mb-3">{projeto.cliente || '—'}</p>

                  {/* Status + Impact Pills */}
                  <div className="flex items-center gap-2 mb-3">
                    <StatusPill variant={
                      projeto.status === 'em_andamento' ? 'active' :
                        projeto.status === 'concluido' ? 'completed' :
                          projeto.status === 'cancelado' ? 'error' :
                            'neutral'
                    }>
                      {projeto.status?.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()) || '—'}
                    </StatusPill>
                    <StatusPill variant={projeto.impacto_financeiro === 'critico' ? 'critical' : projeto.impacto_financeiro === 'alto' ? ('at_risk' as const) : 'active'}>
                      {projeto.impacto_financeiro?.charAt(0).toUpperCase() + projeto.impacto_financeiro?.slice(1) || '—'}
                    </StatusPill>
                  </div>

                  {/* Progress Bar with % */}
                  <div className="flex items-center gap-2 mb-3">
                    <div className="flex-1">
                      <HUDProgressBar
                        value={projeto.progresso_percentual || 0}
                        showLabel={false}
                        variant={projeto.progresso_percentual >= 80 ? 'completed' : projeto.progresso_percentual >= 50 ? 'active' : projeto.progresso_percentual >= 25 ? 'medium' : 'critical'}
                      />
                    </div>
                    <span className="text-xs text-[rgba(255,255,255,0.65)] tabular-nums w-10 text-right">
                      {projeto.progresso_percentual ?? 0}%
                    </span>
                  </div>

                  {/* Metrics: Valor Total / Executado */}
                  <div className="grid grid-cols-2 gap-3 py-3 border-t border-b border-[rgba(255,255,255,0.05)] mb-3">
                    <div>
                      <p className="text-xs text-[rgba(255,255,255,0.40)] mb-0.5">Valor Total</p>
                      <p className="font-medium text-sm text-white tabular-nums">{projeto.valor_total ? formatCurrency(projeto.valor_total) : '—'}</p>
                    </div>
                    <div>
                      <p className="text-xs text-[rgba(255,255,255,0.40)] mb-0.5">Executado</p>
                      <p className="font-medium text-sm text-white tabular-nums">{projeto.valor_executado ? formatCurrency(projeto.valor_executado) : '—'}</p>
                    </div>
                  </div>

                  {/* Comitê Supervisor (always visible) */}
                  <div className="mb-3">
                    <p className="text-xs text-[rgba(255,255,255,0.40)] mb-1">Comitê Supervisor</p>
                    {comite ? (
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-xs bg-[rgba(255,255,255,0.05)] text-[rgba(255,255,255,0.65)] border-[rgba(255,255,255,0.12)]">
                          <Building2 className="w-3 h-3 mr-1" />
                          {projeto.comite_nome || '—'}
                        </Badge>
                        <StatusPill variant={projeto.comite_status === 'ativo' ? 'active' : projeto.comite_status === 'atencao_necessaria' ? 'at_risk' : 'neutral'}>
                          {projeto.comite_status?.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()) || 'Ativo'}
                        </StatusPill>
                      </div>
                    ) : (
                      <span className="text-xs text-[rgba(255,255,255,0.40)]">—</span>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex gap-2 mt-auto">
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1 h-8 border-[rgba(0,255,180,0.25)] text-[rgba(255,255,255,0.92)] hover:bg-[rgba(0,255,180,0.12)] text-xs focus:outline-none focus:ring-2 focus:ring-[#00FFB4]/40"
                      onClick={() => { setSelectedProject(projeto); setProjectDrawerOpen(true); }}
                    >
                      <Eye className="w-3.5 h-3.5 mr-1.5" />
                      Ver Detalhes
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 w-8 p-0 border-[rgba(255,88,96,0.25)] text-[#FF5860] hover:bg-[rgba(255,88,96,0.12)]"
                      onClick={() => handleDeleteClick(projeto.id)}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <HUDCard>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="border-[rgba(255,255,255,0.05)]">
                    <TableHead className="text-[rgba(255,255,255,0.65)] font-medium">Código</TableHead>
                    <TableHead className="text-[rgba(255,255,255,0.65)] font-medium">Projeto</TableHead>
                    <TableHead className="text-[rgba(255,255,255,0.65)] font-medium">Cliente</TableHead>
                    <TableHead className="text-[rgba(255,255,255,0.65)] font-medium">Status</TableHead>
                    <TableHead className="text-[rgba(255,255,255,0.65)] font-medium">Saúde</TableHead>
                    <TableHead className="text-[rgba(255,255,255,0.65)] font-medium">Progresso</TableHead>
                    <TableHead className="text-[rgba(255,255,255,0.65)] font-medium">Valor</TableHead>
                    <TableHead className="text-[rgba(255,255,255,0.65)] font-medium">Comitê</TableHead>
                    <TableHead className="text-[rgba(255,255,255,0.65)] font-medium">Impacto</TableHead>
                    <TableHead className="text-right text-[rgba(255,255,255,0.65)] font-medium">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredProjetos.map((projeto) => {
                    const pV2 = v2Map.get(projeto.id);
                    const pHealth = pV2?.health_score ?? 100;
                    const pHealthColor = getHealthScoreColor(pHealth);
                    return (
                      <TableRow key={projeto.id} className="hover:bg-[rgba(255,255,255,0.03)] border-[rgba(255,255,255,0.05)]">
                        <TableCell className="text-[rgba(255,255,255,0.92)]">
                          <Badge variant="outline" className="bg-[rgba(255,255,255,0.05)] text-[rgba(255,255,255,0.65)] border-[rgba(255,255,255,0.12)]">{projeto.codigo}</Badge>
                        </TableCell>
                        <TableCell className="text-[rgba(255,255,255,0.92)]">
                          <div>
                            <p className="font-medium">{projeto.nome}</p>
                            {projeto.sankhya_integrado && (
                              <StatusPill variant="info" className="text-xs mt-1">Sankhya</StatusPill>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-[rgba(255,255,255,0.65)]">{projeto.cliente}</TableCell>
                        <TableCell>
                          <StatusPill variant={
                            projeto.status === 'em_andamento' ? 'active' :
                              projeto.status === 'concluido' ? 'completed' :
                                projeto.status === 'cancelado' ? 'error' :
                                  'neutral'
                          }>
                            {projeto.status.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
                          </StatusPill>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1.5">
                            <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: pHealthColor }} />
                            <span className="text-sm font-medium tabular-nums" style={{ color: pHealthColor }}>{pHealth}</span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="w-24">
                            <HUDProgressBar
                              value={projeto.progresso_percentual || 0}
                              showLabel={false}
                              variant={projeto.progresso_percentual >= 80 ? 'completed' : projeto.progresso_percentual >= 50 ? 'active' : projeto.progresso_percentual >= 25 ? 'medium' : 'critical'}
                            />
                            <p className="text-xs text-[rgba(255,255,255,0.40)] mt-1">{projeto.progresso_percentual || 0}%</p>
                          </div>
                        </TableCell>
                        <TableCell className="text-[rgba(255,255,255,0.92)]">
                          <div>
                            <p className="font-medium text-sm">{formatCurrency(projeto.valor_total)}</p>
                            <p className="text-xs text-[rgba(255,255,255,0.40)]">{formatCurrency(projeto.valor_executado)} exec.</p>
                          </div>
                        </TableCell>
                        <TableCell>
                          {projeto.comite_nome ? (
                            <div className="space-y-1">
                              <Badge variant="outline" className="text-xs bg-[rgba(255,255,255,0.05)] text-[rgba(255,255,255,0.65)] border-[rgba(255,255,255,0.12)]">
                                {projeto.comite_nome}
                              </Badge>
                              <StatusPill variant={projeto.comite_status === 'ativo' ? 'active' : projeto.comite_status === 'atencao_necessaria' ? ('at_risk' as const) : 'neutral'} className="text-xs">
                                {projeto.comite_status?.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()) || 'Ativo'}
                              </StatusPill>
                            </div>
                          ) : (
                            <span className="text-xs text-[rgba(255,255,255,0.40)]">Sem supervisão</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <StatusPill variant={projeto.impacto_financeiro === 'critico' ? 'critical' : projeto.impacto_financeiro === 'alto' ? ('at_risk' as const) : 'active'}>
                            {projeto.impacto_financeiro.charAt(0).toUpperCase() + projeto.impacto_financeiro.slice(1)}
                          </StatusPill>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-2">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="text-[#00C8FF] hover:bg-[rgba(0,200,255,0.12)] focus:outline-none focus:ring-2 focus:ring-[#00C8FF]/40"
                              onClick={() => { setSelectedProject(projeto); setProjectDrawerOpen(true); }}
                            >
                              <Eye className="w-4 h-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="text-[#FF5860] hover:bg-[rgba(255,88,96,0.12)]"
                              onClick={() => handleDeleteClick(projeto.id)}
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>

              {filteredProjetos.length === 0 && (
                <div className="text-center py-12">
                  <Briefcase className="w-16 h-16 text-[rgba(255,255,255,0.20)] mx-auto mb-4" />
                  <p className="text-[rgba(255,255,255,0.65)]">Nenhum projeto encontrado</p>
                </div>
              )}
            </div>
          </HUDCard>
        )}

        {/* Project Detail Drawer */}
        <ProjectDetailDrawer
          project={selectedProject}
          open={projectDrawerOpen}
          onOpenChange={setProjectDrawerOpen}
        />

        {/* Delete Confirmation Dialog */}
        <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
          <AlertDialogContent className="bg-gradient-to-br from-[#07130F] to-[#030B09] border-[rgba(255,255,255,0.08)]">
            <AlertDialogHeader>
              <AlertDialogTitle className="text-white font-semibold">Confirmar Exclusão</AlertDialogTitle>
              <AlertDialogDescription className="text-[rgba(255,255,255,0.65)]">
                Tem certeza que deseja excluir este projeto? Esta ação não pode ser desfeita.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel onClick={() => setProjectToDelete(null)} className="border-[rgba(255,255,255,0.12)] text-[rgba(255,255,255,0.65)] hover:bg-[rgba(255,255,255,0.05)]">
                Cancelar
              </AlertDialogCancel>
              <AlertDialogAction
                onClick={handleDeleteConfirm}
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

export default function PortfolioProjetos() {
  return (
    <Suspense fallback={
      <OrionGreenBackground className="orion-page">
        <div className="orion-page-content flex items-center justify-center min-h-[60vh]">
          <div className="text-center">
            <Briefcase className="w-12 h-12 text-[rgba(255,255,255,0.30)] mx-auto mb-3 animate-pulse" />
            <p className="text-sm text-[rgba(255,255,255,0.50)]">Carregando portfólio...</p>
          </div>
        </div>
      </OrionGreenBackground>
    }>
      <PortfolioProjetosInner />
    </Suspense>
  );
}
