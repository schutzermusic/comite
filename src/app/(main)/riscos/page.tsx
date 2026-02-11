'use client';

import { useState } from "react";
import { Risk } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { PrimaryCTA } from "@/components/ui/primary-cta";
import { SecondaryButton } from "@/components/ui/secondary-button";
import { HudInput, hudInputBase } from "@/components/ui/hud-input";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { KpiCard } from "@/components/orion";
import { HUDCard } from "@/components/ui/hud-card";
import { OrionGreenBackground } from "@/components/system/OrionGreenBackground";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RiskMatrix } from "@/components/risks/risk-matrix";
import { RiskList } from "@/components/risks/risk-list";
import { 
  ShieldAlert, 
  Plus, 
  Search, 
  Filter,
  TrendingUp,
  AlertCircle,
  CheckCircle,
  BarChart3
} from "lucide-react";

// Mock data
const mockRisks: Risk[] = [
  {
    id: '1',
    title: 'Risco de Atraso em Projeto Crítico',
    description: 'Projeto de infraestrutura com potencial de atraso devido a falta de recursos',
    category: 'Operational',
    probability: 4,
    impact: 5,
    level: 20,
    severity: 'critical',
    origin: 'project',
    referenceId: 'proj-123',
    status: 'open',
    createdAt: new Date('2024-01-10'),
    updatedAt: new Date('2024-01-10')
  },
  {
    id: '2',
    title: 'Exposição Cambial em Contrato Internacional',
    description: 'Variação cambial pode impactar negativamente o valor do contrato',
    category: 'Financial',
    probability: 3,
    impact: 4,
    level: 12,
    severity: 'high',
    origin: 'contract',
    referenceId: 'contract-456',
    status: 'mitigating',
    createdAt: new Date('2024-01-15'),
    updatedAt: new Date('2024-01-25')
  },
  {
    id: '3',
    title: 'Não Conformidade com LGPD',
    description: 'Processos de tratamento de dados pessoais não atendem requisitos da LGPD',
    category: 'Legal',
    probability: 2,
    impact: 5,
    level: 10,
    severity: 'medium',
    origin: 'manual',
    status: 'open',
    createdAt: new Date('2024-01-20'),
    updatedAt: new Date('2024-01-20')
  },
  {
    id: '4',
    title: 'Cláusula Contratual Desfavorável',
    description: 'Contrato com fornecedor contém penalidades elevadas',
    category: 'Contractual',
    probability: 4,
    impact: 4,
    level: 16,
    severity: 'critical',
    origin: 'contract',
    referenceId: 'contract-789',
    status: 'open',
    createdAt: new Date('2024-01-22'),
    updatedAt: new Date('2024-01-22')
  },
  {
    id: '5',
    title: 'Falta de Auditoria Interna',
    description: 'Ausência de controles de auditoria pode gerar problemas de compliance',
    category: 'Compliance',
    probability: 3,
    impact: 3,
    level: 9,
    severity: 'medium',
    origin: 'manual',
    status: 'resolved',
    createdAt: new Date('2024-01-05'),
    updatedAt: new Date('2024-01-28')
  }
];

export default function RiscosPage() {
  const [risks, setRisks] = useState<Risk[]>(mockRisks);
  const [view, setView] = useState<'list' | 'matrix'>('list');
  const [searchTerm, setSearchTerm] = useState('');
  const [severityFilter, setSeverityFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [createOpen, setCreateOpen] = useState(false);
  const [newRisk, setNewRisk] = useState({
    title: '',
    description: '',
    category: 'Operational',
    probability: 3,
    impact: 3,
    severity: 'medium' as Risk['severity'],
    origin: 'manual' as Risk['origin'],
  });

  // Calculate KPIs
  const stats = {
    total: risks.length,
    open: risks.filter(r => r.status === 'open').length,
    critical: risks.filter(r => r.severity === 'critical').length,
    resolved: risks.filter(r => r.status === 'resolved').length,
  };

  // Filter risks
  const filteredRisks = risks.filter((risk) => {
    const matchesSearch =
      risk.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
      risk.description.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesSeverity = severityFilter === 'all' || risk.severity === severityFilter;
    const matchesStatus = statusFilter === 'all' || risk.status === statusFilter;
    const matchesCategory = categoryFilter === 'all' || risk.category === categoryFilter;
    
    return matchesSearch && matchesSeverity && matchesStatus && matchesCategory;
  });

  // Handlers
  const handleResolveRisk = (riskId: string) => {
    setRisks(prev => prev.map(risk =>
      risk.id === riskId 
        ? { ...risk, status: 'resolved' as const, updatedAt: new Date() }
        : risk
    ));
  };

  const handleCreateRisk = () => {
    if (!newRisk.title || !newRisk.description) {
      return;
    }

    const probability = Number(newRisk.probability) || 0;
    const impact = Number(newRisk.impact) || 0;
    const level = probability * impact;

    const payload: Risk = {
      id: `new-${Date.now()}`,
      title: newRisk.title,
      description: newRisk.description,
      category: newRisk.category as Risk['category'],
      probability,
      impact,
      level,
      severity: newRisk.severity,
      origin: newRisk.origin,
      status: 'open',
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    setRisks(prev => [payload, ...prev]);
    setCreateOpen(false);
    setNewRisk({
      title: '',
      description: '',
      category: 'Operational',
      probability: 3,
      impact: 3,
      severity: 'medium',
      origin: 'manual',
    });
  };

  return (
    <OrionGreenBackground className="orion-page">
      <div className="orion-page-content max-w-[1800px] mx-auto space-y-6">
        <header className="mb-8">
          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-2xl font-semibold text-white mb-1 tracking-wide flex items-center gap-3">
                <ShieldAlert className="w-6 h-6 text-[#FF5860]" />
                Riscos
              </h1>
              <p className="text-sm text-[rgba(255,255,255,0.65)]">
                Monitor e controle riscos operacionais, financeiros e contratuais
              </p>
            </div>
            <PrimaryCTA onClick={() => setCreateOpen(true)}>
              <Plus className="w-4 h-4 mr-2" />
              Novo Risco
            </PrimaryCTA>
          </div>
        </header>

        {/* KPI Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <KpiCard
            label="Total de Riscos"
            value={stats.total}
            icon={ShieldAlert}
            subtitle="registrados no sistema"
            status="neutral"
            size="sm"
          />
          <KpiCard
            label="Riscos Abertos"
            value={stats.open}
            icon={AlertCircle}
            subtitle="requerem atenção"
            status="warning"
            size="sm"
          />
          <KpiCard
            label="Críticos"
            value={stats.critical}
            icon={TrendingUp}
            subtitle="nível de severidade máximo"
            status="error"
            size="sm"
          />
          <KpiCard
            label="Resolvidos"
            value={stats.resolved}
            icon={CheckCircle}
            subtitle="riscos mitigados"
            status="success"
            size="sm"
          />
        </div>

        {/* Filters */}
        <HUDCard>
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-xs font-medium text-[rgba(255,255,255,0.65)] uppercase tracking-wide">
              <Filter className="w-4 h-4" />
              Filtros
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
              {/* Search */}
              <div className="relative md:col-span-2">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[rgba(255,255,255,0.40)]" />
                <HudInput
                  placeholder="Buscar riscos..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-9"
                />
              </div>

              {/* Severity Filter */}
              <Select value={severityFilter} onValueChange={setSeverityFilter}>
                <SelectTrigger className="bg-[rgba(255,255,255,0.05)] border-[rgba(255,255,255,0.08)] text-white hover:border-[rgba(0,255,180,0.25)] focus:border-[rgba(0,255,180,0.25)]">
                  <SelectValue placeholder="Severidade" />
                </SelectTrigger>
                <SelectContent className="bg-gradient-to-br from-[#07130F] to-[#030B09] border-[rgba(255,255,255,0.08)]">
                  <SelectItem value="all" className="text-white focus:bg-[rgba(0,255,180,0.12)] focus:text-[#00FFB4]">Todas Severidades</SelectItem>
                  <SelectItem value="low" className="text-white focus:bg-[rgba(0,255,180,0.12)] focus:text-[#00FFB4]">Baixa</SelectItem>
                  <SelectItem value="medium" className="text-white focus:bg-[rgba(0,255,180,0.12)] focus:text-[#00FFB4]">Média</SelectItem>
                  <SelectItem value="high" className="text-white focus:bg-[rgba(0,255,180,0.12)] focus:text-[#00FFB4]">Alta</SelectItem>
                  <SelectItem value="critical" className="text-white focus:bg-[rgba(0,255,180,0.12)] focus:text-[#00FFB4]">Crítica</SelectItem>
                </SelectContent>
              </Select>

              {/* Status Filter */}
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="bg-[rgba(255,255,255,0.05)] border-[rgba(255,255,255,0.08)] text-white hover:border-[rgba(0,255,180,0.25)] focus:border-[rgba(0,255,180,0.25)]">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent className="bg-gradient-to-br from-[#07130F] to-[#030B09] border-[rgba(255,255,255,0.08)]">
                  <SelectItem value="all" className="text-white focus:bg-[rgba(0,255,180,0.12)] focus:text-[#00FFB4]">Todos Status</SelectItem>
                  <SelectItem value="open" className="text-white focus:bg-[rgba(0,255,180,0.12)] focus:text-[#00FFB4]">Aberto</SelectItem>
                  <SelectItem value="mitigating" className="text-white focus:bg-[rgba(0,255,180,0.12)] focus:text-[#00FFB4]">Mitigando</SelectItem>
                  <SelectItem value="resolved" className="text-white focus:bg-[rgba(0,255,180,0.12)] focus:text-[#00FFB4]">Resolvido</SelectItem>
                </SelectContent>
              </Select>

              {/* Category Filter */}
              <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                <SelectTrigger className="bg-[rgba(255,255,255,0.05)] border-[rgba(255,255,255,0.08)] text-white hover:border-[rgba(0,255,180,0.25)] focus:border-[rgba(0,255,180,0.25)]">
                  <SelectValue placeholder="Categoria" />
                </SelectTrigger>
                <SelectContent className="bg-gradient-to-br from-[#07130F] to-[#030B09] border-[rgba(255,255,255,0.08)]">
                  <SelectItem value="all" className="text-white focus:bg-[rgba(0,255,180,0.12)] focus:text-[#00FFB4]">Todas Categorias</SelectItem>
                  <SelectItem value="Operational" className="text-white focus:bg-[rgba(0,255,180,0.12)] focus:text-[#00FFB4]">Operacional</SelectItem>
                  <SelectItem value="Financial" className="text-white focus:bg-[rgba(0,255,180,0.12)] focus:text-[#00FFB4]">Financeiro</SelectItem>
                  <SelectItem value="Legal" className="text-white focus:bg-[rgba(0,255,180,0.12)] focus:text-[#00FFB4]">Legal</SelectItem>
                  <SelectItem value="Contractual" className="text-white focus:bg-[rgba(0,255,180,0.12)] focus:text-[#00FFB4]">Contratual</SelectItem>
                  <SelectItem value="Compliance" className="text-white focus:bg-[rgba(0,255,180,0.12)] focus:text-[#00FFB4]">Conformidade</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </HUDCard>

        {/* View Toggle */}
        <Tabs value={view} onValueChange={(v) => setView(v as 'list' | 'matrix')}>
          <div className="flex justify-end mb-4">
            <div className="inline-flex rounded-lg border border-[rgba(255,255,255,0.08)] p-1 bg-[rgba(255,255,255,0.03)]">
              <TabsList className="bg-transparent border-0">
                <TabsTrigger 
                  value="list"
                  className="data-[state=active]:bg-[#00FFB4] data-[state=active]:text-[#050D0A] text-[rgba(255,255,255,0.65)] hover:text-white"
                >
                  <BarChart3 className="w-4 h-4 mr-2" />
                  Lista
                </TabsTrigger>
                <TabsTrigger 
                  value="matrix"
                  className="data-[state=active]:bg-[#00FFB4] data-[state=active]:text-[#050D0A] text-[rgba(255,255,255,0.65)] hover:text-white"
                >
                  <ShieldAlert className="w-4 h-4 mr-2" />
                  Matriz 5×5
                </TabsTrigger>
              </TabsList>
            </div>
          </div>

          <TabsContent value="list" className="mt-0">
            <HUDCard className="p-0">
              <RiskList
                risks={filteredRisks}
                onViewRisk={(risk) => console.log('View:', risk)}
                onEditRisk={(risk) => console.log('Edit:', risk)}
                onResolveRisk={handleResolveRisk}
              />
            </HUDCard>
          </TabsContent>

          <TabsContent value="matrix" className="mt-0">
            <HUDCard>
              <RiskMatrix
                risks={filteredRisks}
                onRiskClick={(risk) => console.log('Click:', risk)}
              />
            </HUDCard>
          </TabsContent>
        </Tabs>

        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogContent className="max-w-2xl bg-gradient-to-br from-[#0A1612] to-[#07130F] border-[rgba(255,255,255,0.12)]">
            <DialogHeader>
              <DialogTitle className="text-white">Novo Risco</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="grid md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-[rgba(255,255,255,0.85)] text-sm">Título</label>
                  <HudInput
                    value={newRisk.title}
                    onChange={(e) => setNewRisk(prev => ({ ...prev, title: e.target.value }))}
                    placeholder="Risco identificado..."
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-[rgba(255,255,255,0.85)] text-sm">Categoria</label>
                  <Select
                    value={newRisk.category}
                    onValueChange={(value) => setNewRisk(prev => ({ ...prev, category: value as Risk['category'] }))}
                  >
                    <SelectTrigger className="bg-[rgba(255,255,255,0.04)] border-[rgba(255,255,255,0.10)] text-white">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-gradient-to-br from-[#0A1612] to-[#07130F] border-[rgba(255,255,255,0.08)] text-white">
                      <SelectItem value="Operational">Operacional</SelectItem>
                      <SelectItem value="Financial">Financeiro</SelectItem>
                      <SelectItem value="Legal">Legal</SelectItem>
                      <SelectItem value="Contractual">Contratual</SelectItem>
                      <SelectItem value="Compliance">Conformidade</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-[rgba(255,255,255,0.85)] text-sm">Descrição</label>
                <Textarea
                  value={newRisk.description}
                  onChange={(e) => setNewRisk(prev => ({ ...prev, description: e.target.value }))}
                  placeholder="Contextualize o risco, impacto e origem..."
                  rows={4}
                  className={`${hudInputBase} min-h-[120px]`}
                />
              </div>

              <div className="grid md:grid-cols-3 gap-3">
                <div className="space-y-2">
                  <label className="text-[rgba(255,255,255,0.85)] text-sm">Probabilidade</label>
                  <HudInput
                    type="number"
                    min={1}
                    max={5}
                    value={newRisk.probability}
                    onChange={(e) => setNewRisk(prev => ({ ...prev, probability: Number(e.target.value) }))}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-[rgba(255,255,255,0.85)] text-sm">Impacto</label>
                  <HudInput
                    type="number"
                    min={1}
                    max={5}
                    value={newRisk.impact}
                    onChange={(e) => setNewRisk(prev => ({ ...prev, impact: Number(e.target.value) }))}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-[rgba(255,255,255,0.85)] text-sm">Severidade</label>
                  <Select
                    value={newRisk.severity}
                    onValueChange={(value) => setNewRisk(prev => ({ ...prev, severity: value as Risk['severity'] }))}
                  >
                    <SelectTrigger className="bg-[rgba(255,255,255,0.04)] border-[rgba(255,255,255,0.10)] text-white">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-gradient-to-br from-[#0A1612] to-[#07130F] border-[rgba(255,255,255,0.08)] text-white">
                      <SelectItem value="low">Baixa</SelectItem>
                      <SelectItem value="medium">Média</SelectItem>
                      <SelectItem value="high">Alta</SelectItem>
                      <SelectItem value="critical">Crítica</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-[rgba(255,255,255,0.85)] text-sm">Origem</label>
                <Select
                  value={newRisk.origin}
                  onValueChange={(value) => setNewRisk(prev => ({ ...prev, origin: value as Risk['origin'] }))}
                >
                  <SelectTrigger className="bg-[rgba(255,255,255,0.04)] border-[rgba(255,255,255,0.10)] text-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-gradient-to-br from-[#0A1612] to-[#07130F] border-[rgba(255,255,255,0.08)] text-white">
                    <SelectItem value="manual">Manual</SelectItem>
                    <SelectItem value="project">Projeto</SelectItem>
                    <SelectItem value="contract">Contrato</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter className="flex justify-end gap-3 pt-2">
              <SecondaryButton type="button" onClick={() => setCreateOpen(false)}>
                Cancelar
              </SecondaryButton>
              <PrimaryCTA type="button" onClick={handleCreateRisk} disabled={!newRisk.title || !newRisk.description}>
                Salvar
              </PrimaryCTA>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </OrionGreenBackground>
  );
}
