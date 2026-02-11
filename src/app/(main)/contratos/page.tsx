'use client';

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Contract, Risk, Project } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { PrimaryCTA } from "@/components/ui/primary-cta";
import { Input } from "@/components/ui/input";
import { HUDCard } from "@/components/ui/hud-card";
import { StatusPill } from "@/components/ui/status-pill";
import { Badge } from "@/components/ui/badge";
import { OrionGreenBackground } from "@/components/system/OrionGreenBackground";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ContractUpload } from "@/components/contracts/contract-upload";
import { ContractList } from "@/components/contracts/contract-list";
import { ContractBriefPanel } from "@/components/contracts/ContractBriefPanel";
import { ContractsByCompanyModule } from "@/components/contracts/ContractsByCompanyModule";
import { ProjectDetailDrawer } from "@/components/portfolio/ProjectDetailDrawer";
import { getProjects } from "@/lib/services/projects";
import { portfolioTotals } from "@/data/portfolioContracts";
import { 
  FileCheck, 
  Upload, 
  Search, 
  Filter,
  DollarSign,
  AlertCircle,
  Clock,
  CheckCircle,
  Building2,
  TrendingUp,
  FileText,
  AlertTriangle,
  Briefcase,
} from "lucide-react";
import { addDays, differenceInDays } from "date-fns";

// Mock data
const mockContracts: Contract[] = [
  {
    id: 'contract-1',
    name: 'Contrato de Fornecimento de Energia',
    vendorOrParty: 'Energia Verde LTDA',
    value: 850000,
    currency: 'BRL',
    signingDate: new Date('2023-06-15'),
    expirationDate: addDays(new Date(), 15),
    fileUrl: '/contracts/mock-1.pdf',
    riskClassification: 'high',
    status: 'expiring_soon',
    uploadedAt: new Date('2023-06-15')
  },
  {
    id: 'contract-2',
    name: 'Contrato de Serviços de TI',
    vendorOrParty: 'Tech Solutions Inc',
    value: 320000,
    currency: 'BRL',
    signingDate: new Date('2024-01-10'),
    expirationDate: addDays(new Date(), 200),
    fileUrl: '/contracts/mock-2.pdf',
    riskClassification: 'medium',
    status: 'active',
    uploadedAt: new Date('2024-01-10')
  },
  {
    id: 'contract-3',
    name: 'Contrato de Manutenção Predial',
    vendorOrParty: 'Manutenções Brasil SA',
    value: 125000,
    currency: 'BRL',
    signingDate: new Date('2023-11-01'),
    expirationDate: addDays(new Date(), 90),
    fileUrl: '/contracts/mock-3.pdf',
    riskClassification: 'low',
    status: 'active',
    uploadedAt: new Date('2023-11-01')
  },
  {
    id: 'contract-4',
    name: 'Contrato de Consultoria Ambiental',
    vendorOrParty: 'EcoConsult Ltda',
    value: 275000,
    currency: 'BRL',
    signingDate: new Date('2024-02-15'),
    expirationDate: addDays(new Date(), 45),
    fileUrl: '/contracts/mock-4.pdf',
    riskClassification: 'medium',
    status: 'expiring_soon',
    uploadedAt: new Date('2024-02-15')
  },
  {
    id: 'contract-5',
    name: 'Contrato de Segurança Patrimonial',
    vendorOrParty: 'Segurança Total SA',
    value: 180000,
    currency: 'BRL',
    signingDate: new Date('2023-08-01'),
    expirationDate: addDays(new Date(), 180),
    fileUrl: '/contracts/mock-5.pdf',
    riskClassification: 'low',
    status: 'active',
    uploadedAt: new Date('2023-08-01')
  },
];

// Compact KPI component for the strip
function CompactKPI({ 
  icon: Icon, 
  label, 
  value, 
  variant = 'default' 
}: { 
  icon: React.ElementType; 
  label: string; 
  value: string | number; 
  variant?: 'default' | 'success' | 'warning' | 'danger' | 'info';
}) {
  const variantStyles = {
    default: 'text-white',
    success: 'text-[#00FFB4]',
    warning: 'text-[#FFB04D]',
    danger: 'text-[#FF5860]',
    info: 'text-[#00C8FF]',
  };

  return (
    <div className="flex items-center gap-2 px-3 py-2 bg-[rgba(255,255,255,0.03)] rounded-lg border border-[rgba(255,255,255,0.06)] min-w-0 flex-1">
      <Icon className={`w-4 h-4 ${variantStyles[variant]} shrink-0`} />
      <div className="min-w-0 flex-1">
        <p className="text-[10px] text-[rgba(255,255,255,0.50)] uppercase tracking-wide truncate">{label}</p>
        <p className={`text-sm font-semibold tabular-nums ${variantStyles[variant]}`}>{value}</p>
      </div>
    </div>
  );
}

export default function ContratosPage() {
  const router = useRouter();
  
  // Existing state preserved
  const [contracts, setContracts] = useState<Contract[]>(mockContracts);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [riskFilter, setRiskFilter] = useState('all');
  
  // Projects state for linking with ContractsByCompanyModule
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [projectDrawerOpen, setProjectDrawerOpen] = useState(false);

  // NEW: View switching and contract selection
  const [activeView, setActiveView] = useState<'contracts' | 'companies' | 'projects'>('contracts');
  const [selectedContractId, setSelectedContractId] = useState<string | null>(null);

  // Load projects on mount
  useEffect(() => {
    setProjects(getProjects());
  }, []);

  // Handle project click from ContractsByCompanyModule
  const handleProjectClick = (project: Project) => {
    setSelectedProject(project);
    setProjectDrawerOpen(true);
  };

  // Calculate KPIs
  const stats = useMemo(() => {
    const now = new Date();
    const renewals90d = contracts.filter(c => {
      if (!c.expirationDate) return false;
      const days = differenceInDays(new Date(c.expirationDate), now);
      return days >= 0 && days <= 90;
    }).length;
    
    const missingDocs = contracts.filter(c => !c.fileUrl || c.fileUrl === '').length;

    return {
      total: contracts.length,
      active: contracts.filter(c => c.status === 'active').length,
      expiring: contracts.filter(c => c.status === 'expiring_soon').length,
      highRisk: contracts.filter(c => c.riskClassification === 'high').length,
      totalValue: contracts.reduce((sum, c) => sum + c.value, 0),
      renewals90d,
      missingDocs,
    };
  }, [contracts]);

  // Filter contracts
  const filteredContracts = useMemo(() => {
    return contracts.filter((contract) => {
      const matchesSearch =
        contract.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        contract.vendorOrParty.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesStatus = statusFilter === 'all' || contract.status === statusFilter;
      const matchesRisk = riskFilter === 'all' || contract.riskClassification === riskFilter;
      
      return matchesSearch && matchesStatus && matchesRisk;
    });
  }, [contracts, searchTerm, statusFilter, riskFilter]);

  // Get selected contract
  const selectedContract = useMemo(() => {
    if (!selectedContractId) return null;
    return contracts.find(c => c.id === selectedContractId) || null;
  }, [contracts, selectedContractId]);

  // Handle contract upload with auto-risk creation
  const handleContractCreated = (contract: Contract, autoGeneratedRisk?: Risk) => {
    setContracts(prev => [contract, ...prev]);
    
    if (autoGeneratedRisk) {
      console.log('Auto-generated risk:', autoGeneratedRisk);
      alert(`✅ Contrato salvo!\n⚠️ Risco crítico detectado e registrado automaticamente:\n"${autoGeneratedRisk.title}"`);
    }
  };

  const handleSelectContract = (contract: Contract) => {
    setSelectedContractId(contract.id);
  };

  const handleViewContract = (contract: Contract) => {
    // Navigate to Contract Intelligence View
    router.push(`/contratos/${contract.id}`);
  };

  const handleDownloadContract = (contract: Contract) => {
    console.log('Download contract:', contract);
  };

  const formatCurrency = (value: number) =>
    new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
      notation: 'compact',
      minimumFractionDigits: 0,
      maximumFractionDigits: 1,
    }).format(value);

  return (
    <OrionGreenBackground className="orion-page">
      <div className="orion-page-content max-w-[1800px] mx-auto space-y-4">
        {/* Header */}
        <header className="mb-2">
          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-2xl font-semibold text-white mb-1 tracking-wide flex items-center gap-3">
                <FileCheck className="w-6 h-6 text-[#00C8FF]" />
                Gestão de Contratos
              </h1>
              <p className="text-sm text-[rgba(255,255,255,0.65)]">
                Controle contratos com análise inteligente e monitoramento de riscos
              </p>
            </div>
            <PrimaryCTA onClick={() => setUploadOpen(true)}>
              <Upload className="w-4 h-4 mr-2" />
              Novo Contrato
            </PrimaryCTA>
          </div>
        </header>

        {/* Compact KPI Strip */}
        <div className="flex gap-2 overflow-x-auto pb-1">
          <CompactKPI 
            icon={DollarSign} 
            label="Exposure" 
            value={formatCurrency(portfolioTotals.totalContracted)} 
            variant="info"
          />
          <CompactKPI 
            icon={Clock} 
            label="Backlog" 
            value={formatCurrency(portfolioTotals.backlogToInvoice)} 
            variant="warning"
          />
          <CompactKPI 
            icon={TrendingUp} 
            label="Billed" 
            value={formatCurrency(portfolioTotals.totalInvoiced)} 
            variant="success"
          />
          <CompactKPI 
            icon={Clock} 
            label="Renewals 90d" 
            value={stats.renewals90d} 
            variant={stats.renewals90d > 0 ? 'warning' : 'default'}
          />
          <CompactKPI 
            icon={AlertTriangle} 
            label="High Risk" 
            value={stats.highRisk} 
            variant={stats.highRisk > 0 ? 'danger' : 'default'}
          />
          <CompactKPI 
            icon={FileText} 
            label="Missing Docs" 
            value={stats.missingDocs} 
            variant={stats.missingDocs > 0 ? 'warning' : 'default'}
          />
        </div>

        {/* View Switcher Tabs */}
        <Tabs value={activeView} onValueChange={(v) => setActiveView(v as typeof activeView)} className="w-full">
          <TabsList className="bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.06)] p-1 h-auto">
            <TabsTrigger 
              value="contracts" 
              className="data-[state=active]:bg-[#00FFB4] data-[state=active]:text-[#050D0A] text-[rgba(255,255,255,0.65)] px-4 py-2"
            >
              <FileText className="w-4 h-4 mr-2" />
              Contratos
              <Badge variant="outline" className="ml-2 text-[10px] bg-transparent border-current">
                {contracts.length}
              </Badge>
            </TabsTrigger>
            <TabsTrigger 
              value="companies" 
              className="data-[state=active]:bg-[#00FFB4] data-[state=active]:text-[#050D0A] text-[rgba(255,255,255,0.65)] px-4 py-2"
            >
              <Building2 className="w-4 h-4 mr-2" />
              Empresas
              <Badge variant="outline" className="ml-2 text-[10px] bg-transparent border-current">
                {portfolioTotals.totalContracts}
              </Badge>
            </TabsTrigger>
            <TabsTrigger 
              value="projects" 
              className="data-[state=active]:bg-[#00FFB4] data-[state=active]:text-[#050D0A] text-[rgba(255,255,255,0.65)] px-4 py-2"
            >
              <Briefcase className="w-4 h-4 mr-2" />
              Projetos
              <Badge variant="outline" className="ml-2 text-[10px] bg-transparent border-current">
                {projects.length}
              </Badge>
            </TabsTrigger>
          </TabsList>

          {/* 2-Column Layout */}
          <div className="flex gap-4 mt-4">
            {/* Left Column: 70% */}
            <div className="flex-[7] min-w-0">
              {/* Contracts Tab */}
              <TabsContent value="contracts" className="mt-0 space-y-4">
                {/* Filters */}
                <HUDCard>
                  <div className="space-y-3">
                    <div className="flex items-center gap-2 text-xs font-medium text-[rgba(255,255,255,0.65)] uppercase tracking-wide">
                      <Filter className="w-4 h-4" />
                      Filtros
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      {/* Search */}
                      <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[rgba(255,255,255,0.40)]" />
                        <Input
                          placeholder="Buscar contratos..."
                          value={searchTerm}
                          onChange={(e) => setSearchTerm(e.target.value)}
                          className="pl-9 bg-[rgba(255,255,255,0.05)] border-[rgba(255,255,255,0.08)] text-white placeholder:text-[rgba(255,255,255,0.40)] focus:border-[rgba(0,255,180,0.25)]"
                        />
                      </div>

                      {/* Status Filter */}
                      <Select value={statusFilter} onValueChange={setStatusFilter}>
                        <SelectTrigger className="bg-[rgba(255,255,255,0.05)] border-[rgba(255,255,255,0.08)] text-white hover:border-[rgba(0,255,180,0.25)] focus:border-[rgba(0,255,180,0.25)]">
                          <SelectValue placeholder="Status" />
                        </SelectTrigger>
                        <SelectContent className="bg-gradient-to-br from-[#07130F] to-[#030B09] border-[rgba(255,255,255,0.08)]">
                          <SelectItem value="all" className="text-white focus:bg-[rgba(0,255,180,0.12)] focus:text-[#00FFB4]">Todos Status</SelectItem>
                          <SelectItem value="active" className="text-white focus:bg-[rgba(0,255,180,0.12)] focus:text-[#00FFB4]">Ativo</SelectItem>
                          <SelectItem value="expiring_soon" className="text-white focus:bg-[rgba(0,255,180,0.12)] focus:text-[#00FFB4]">Expirando</SelectItem>
                          <SelectItem value="expired" className="text-white focus:bg-[rgba(0,255,180,0.12)] focus:text-[#00FFB4]">Expirado</SelectItem>
                        </SelectContent>
                      </Select>

                      {/* Risk Filter */}
                      <Select value={riskFilter} onValueChange={setRiskFilter}>
                        <SelectTrigger className="bg-[rgba(255,255,255,0.05)] border-[rgba(255,255,255,0.08)] text-white hover:border-[rgba(0,255,180,0.25)] focus:border-[rgba(0,255,180,0.25)]">
                          <SelectValue placeholder="Classificação de Risco" />
                        </SelectTrigger>
                        <SelectContent className="bg-gradient-to-br from-[#07130F] to-[#030B09] border-[rgba(255,255,255,0.08)]">
                          <SelectItem value="all" className="text-white focus:bg-[rgba(0,255,180,0.12)] focus:text-[#00FFB4]">Todos Riscos</SelectItem>
                          <SelectItem value="low" className="text-white focus:bg-[rgba(0,255,180,0.12)] focus:text-[#00FFB4]">Baixo</SelectItem>
                          <SelectItem value="medium" className="text-white focus:bg-[rgba(0,255,180,0.12)] focus:text-[#00FFB4]">Médio</SelectItem>
                          <SelectItem value="high" className="text-white focus:bg-[rgba(0,255,180,0.12)] focus:text-[#00FFB4]">Alto</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </HUDCard>

                {/* Contract List */}
                <HUDCard className="p-0">
                  <ContractList
                    contracts={filteredContracts}
                    selectedContractId={selectedContractId}
                    onSelectContract={handleSelectContract}
                    onViewContract={handleViewContract}
                    onDownloadContract={handleDownloadContract}
                  />
                </HUDCard>
              </TabsContent>

              {/* Companies Tab */}
              <TabsContent value="companies" className="mt-0">
                <ContractsByCompanyModule
                  projects={projects}
                  onProjectClick={handleProjectClick}
                />
              </TabsContent>

              {/* Projects Tab */}
              <TabsContent value="projects" className="mt-0">
                <HUDCard>
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-medium text-[rgba(255,255,255,0.85)]">
                        Projetos Vinculados a Contratos
                      </h3>
                      <Badge variant="outline" className="text-xs bg-[rgba(0,200,255,0.08)] text-[#00C8FF] border-[rgba(0,200,255,0.2)]">
                        {projects.length} projetos
                      </Badge>
                    </div>
                    
                    <div className="grid gap-3 max-h-[600px] overflow-y-auto">
                      {projects.slice(0, 20).map((project) => (
                        <div
                          key={project.id}
                          onClick={() => handleProjectClick(project)}
                          className="p-4 bg-[rgba(255,255,255,0.02)] rounded-lg border border-[rgba(255,255,255,0.06)] hover:border-[rgba(0,255,180,0.20)] transition-colors cursor-pointer"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-1">
                                <Badge variant="outline" className="text-[10px] bg-[rgba(255,255,255,0.05)] text-[rgba(255,255,255,0.65)] border-[rgba(255,255,255,0.12)]">
                                  {project.codigo}
                                </Badge>
                                <StatusPill 
                                  variant={
                                    project.status === 'em_andamento' ? 'active' :
                                    project.status === 'concluido' ? 'completed' :
                                    project.status === 'cancelado' ? 'error' :
                                    project.status === 'pausado' ? 'warning' :
                                    'neutral'
                                  }
                                  className="text-[10px]"
                                >
                                  {project.status?.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
                                </StatusPill>
                              </div>
                              <p className="text-sm font-medium text-white truncate">{project.nome}</p>
                              <p className="text-xs text-[rgba(255,255,255,0.50)] mt-1">{project.cliente}</p>
                            </div>
                            <div className="text-right shrink-0">
                              <p className="text-sm font-semibold text-white tabular-nums">
                                {formatCurrency(project.valor_total)}
                              </p>
                              <p className="text-xs text-[rgba(255,255,255,0.50)]">
                                {project.progresso_percentual || 0}% completo
                              </p>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </HUDCard>
              </TabsContent>
            </div>

            {/* Right Column: 30% - Contract Brief Panel */}
            <div className="flex-[3] min-w-[320px] max-w-[400px]">
              <div className="sticky top-4">
                <ContractBriefPanel
                  contract={selectedContract}
                  onViewContract={handleViewContract}
                  onDownloadContract={handleDownloadContract}
                />
              </div>
            </div>
          </div>
        </Tabs>

        {/* Project Detail Drawer */}
        <ProjectDetailDrawer
          project={selectedProject}
          open={projectDrawerOpen}
          onOpenChange={setProjectDrawerOpen}
        />

        {/* Upload Dialog */}
        <ContractUpload
          open={uploadOpen}
          onOpenChange={setUploadOpen}
          onContractCreated={handleContractCreated}
        />
      </div>
    </OrionGreenBackground>
  );
}
