'use client';

import React, { useState, useMemo, useCallback } from 'react';
import Link from 'next/link';
import {
  Search,
  Building2,
  Eye,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Briefcase,
  Zap,
  MapPin,
  Sparkles,
  Clock,
  FileText,
  Shield,
  DollarSign,
  TrendingUp,
  AlertTriangle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { HUDCard } from '@/components/ui/hud-card';
import { StatusPill } from '@/components/ui/status-pill';
import { HUDProgressBar } from '@/components/ui/hud-progress-bar';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { portfolioTotals, portfolioCompanies, PortfolioCompany } from '@/data/portfolioContracts';
import { Project } from '@/lib/types';
import { cn } from '@/lib/utils';

// ============================================
// TYPES
// ============================================

export interface CompanyWithProjects extends PortfolioCompany {
  linkedProjects: Project[];
  linkedProjectsCount: number;
}

// ============================================
// ADAPTER: Deterministic company-to-projects linking
// ============================================

/**
 * Normalizes company name for stable matching:
 * - Lowercase
 * - Remove diacritics
 * - Trim whitespace
 * - Remove common suffixes (S.A, LTDA, etc.)
 */
function normalizeCompanyName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Remove diacritics
    .replace(/\s+(s\.?a\.?|ltda\.?|inc\.?|corp\.?)$/i, '') // Remove suffixes
    .replace(/[^a-z0-9]/g, '') // Keep only alphanumeric
    .trim();
}

/**
 * Builds an enriched company list with linked projects.
 * Uses deterministic matching by normalized company/client name.
 */
export function buildCompaniesWithProjects(
  companies: PortfolioCompany[],
  projects: Project[]
): CompanyWithProjects[] {
  // Build a map of normalized names to projects
  const projectsByNormalizedClient = new Map<string, Project[]>();
  
  for (const project of projects) {
    if (project.cliente) {
      const normalizedClient = normalizeCompanyName(project.cliente);
      const existing = projectsByNormalizedClient.get(normalizedClient) || [];
      existing.push(project);
      projectsByNormalizedClient.set(normalizedClient, existing);
    }
  }

  return companies.map((company) => {
    const normalizedCompany = normalizeCompanyName(company.company);
    const linkedProjects = projectsByNormalizedClient.get(normalizedCompany) || [];
    
    return {
      ...company,
      linkedProjects,
      linkedProjectsCount: linkedProjects.length,
    };
  });
}

// ============================================
// GENERATE PLACEHOLDER CONTRACTS
// ============================================

function generatePlaceholderContracts(company: PortfolioCompany) {
  const states = ['SP', 'RJ', 'MG', 'BA', 'RS', 'PR', 'SC', 'GO', 'PA', 'CE'];
  const statuses = ['ACTIVE', 'ACTIVE', 'ACTIVE', 'PENDING', 'COMPLETED'] as const;
  return Array.from({ length: company.contractsCount }, (_, i) => ({
    id: `${company.company.substring(0, 3).toUpperCase()}-${String(i + 1).padStart(3, '0')}`,
    name: `Contrato ${i + 1} - ${company.company}`,
    value: company.totalContracted / company.contractsCount,
    state: states[i % states.length],
    startDate: `2025-${String((i % 12) + 1).padStart(2, '0')}-01`,
    endDate: `2026-${String(((i + 6) % 12) + 1).padStart(2, '0')}-30`,
    status: statuses[i % statuses.length],
  }));
}

// ============================================
// COMPONENT PROPS
// ============================================

interface ContractsByCompanyModuleProps {
  projects: Project[];
  onProjectClick?: (project: Project) => void;
  className?: string;
}

// ============================================
// MAIN COMPONENT
// ============================================

export function ContractsByCompanyModule({
  projects,
  onProjectClick,
  className,
}: ContractsByCompanyModuleProps) {
  // State
  const [contractsSearch, setContractsSearch] = useState('');
  const [contractsViewMode, setContractsViewMode] = useState<'cards' | 'table'>('cards');
  const [activeChip, setActiveChip] = useState<string | null>(null);
  const [sortCol, setSortCol] = useState<'contracted' | 'backlog'>('contracted');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [selectedCompany, setSelectedCompany] = useState<CompanyWithProjects | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Memoized: Build companies with linked projects
  const companiesWithProjects = useMemo(
    () => buildCompaniesWithProjects(portfolioCompanies, projects),
    [projects]
  );

  // Memoized: Filter and sort data
  const filteredData = useMemo(() => {
    let data = [...companiesWithProjects].filter((c) =>
      c.company.toLowerCase().includes(contractsSearch.toLowerCase())
    );

    // Apply chip filter
    if (activeChip === 'top5') {
      data = data.sort((a, b) => b.totalContracted - a.totalContracted).slice(0, 5);
    }
    if (activeChip === 'backlog_gt0') {
      data = data.filter((c) => c.backlogToInvoice > 0);
    }
    if (activeChip === 'backlog_eq0') {
      data = data.filter((c) => c.backlogToInvoice === 0);
    }
    if (activeChip === 'contracts_gte3') {
      data = data.filter((c) => c.contractsCount >= 3);
    }

    // Apply sort
    data.sort((a, b) => {
      const valA = sortCol === 'contracted' ? a.totalContracted : a.backlogToInvoice;
      const valB = sortCol === 'contracted' ? b.totalContracted : b.backlogToInvoice;
      return sortDir === 'desc' ? valB - valA : valA - valB;
    });

    return data;
  }, [companiesWithProjects, contractsSearch, activeChip, sortCol, sortDir]);

  // Handlers
  const handleCompanyClick = useCallback((company: CompanyWithProjects) => {
    setSelectedCompany(company);
    setDrawerOpen(true);
  }, []);

  const handleSortClick = useCallback((col: 'contracted' | 'backlog') => {
    setSortCol(col);
    setSortDir(sortCol === col && sortDir === 'desc' ? 'asc' : 'desc');
  }, [sortCol, sortDir]);

  const formatCurrency = (value: number) =>
    new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value || 0);

  return (
    <>
      <HUDCard className={className}>
        {/* Header */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-4">
          <h2 className="text-lg font-semibold text-white">Contratos por Empresa</h2>
          <div className="flex items-center gap-3">
            {/* View Toggle */}
            <div className="inline-flex rounded-lg border border-[rgba(255,255,255,0.08)] p-1 bg-[rgba(255,255,255,0.03)]">
              <Button
                variant={contractsViewMode === 'cards' ? 'default' : 'ghost'}
                size="sm"
                onClick={() => setContractsViewMode('cards')}
                className={
                  contractsViewMode === 'cards'
                    ? 'bg-[#00FFB4] text-[#050D0A] hover:bg-[#00E6A0]'
                    : 'text-[rgba(255,255,255,0.65)] hover:text-white'
                }
              >
                Cards
              </Button>
              <Button
                variant={contractsViewMode === 'table' ? 'default' : 'ghost'}
                size="sm"
                onClick={() => setContractsViewMode('table')}
                className={
                  contractsViewMode === 'table'
                    ? 'bg-[#00FFB4] text-[#050D0A] hover:bg-[#00E6A0]'
                    : 'text-[rgba(255,255,255,0.65)] hover:text-white'
                }
              >
                Tabela
              </Button>
            </div>
            {/* Search */}
            <div className="relative w-full md:w-64">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-[rgba(255,255,255,0.40)]" />
              <Input
                placeholder="Buscar empresa..."
                value={contractsSearch}
                onChange={(e) => setContractsSearch(e.target.value)}
                className="pl-10 bg-[rgba(255,255,255,0.05)] border-[rgba(255,255,255,0.08)] text-white placeholder:text-[rgba(255,255,255,0.40)] focus:border-[rgba(0,255,180,0.25)]"
              />
            </div>
          </div>
        </div>

        {/* Filter Chips */}
        <div className="flex flex-wrap gap-2 mb-4">
          {[
            { key: 'top5', label: 'Top 5' },
            { key: 'backlog_gt0', label: 'Backlog > 0' },
            { key: 'backlog_eq0', label: 'Backlog = 0' },
            { key: 'contracts_gte3', label: 'Contratos ≥ 3' },
          ].map((chip) => (
            <button
              key={chip.key}
              onClick={() => setActiveChip(activeChip === chip.key ? null : chip.key)}
              className={`px-3 py-1 text-xs rounded border transition-colors ${
                activeChip === chip.key
                  ? 'bg-[rgba(0,255,180,0.15)] border-[rgba(0,255,180,0.4)] text-[#00FFB4]'
                  : 'bg-[rgba(255,255,255,0.03)] border-[rgba(255,255,255,0.08)] text-[rgba(255,255,255,0.65)] hover:border-[rgba(255,255,255,0.15)]'
              }`}
            >
              {chip.label}
            </button>
          ))}
        </div>

        {/* Content: Cards or Table */}
        {contractsViewMode === 'cards' ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {filteredData.map((company) => {
              const percentage = (company.totalContracted / portfolioTotals.totalContracted) * 100;
              const progress =
                company.totalContracted > 0
                  ? Math.round(
                      ((company.totalContracted - company.backlogToInvoice) /
                        company.totalContracted) *
                        100
                    )
                  : 0;

              return (
                <div
                  key={company.company}
                  onClick={() => handleCompanyClick(company)}
                  className={cn(
                    'rounded-lg border p-4 transition-all flex flex-col cursor-pointer',
                    selectedCompany?.company === company.company
                      ? 'bg-[rgba(0,255,180,0.08)] border-[rgba(0,255,180,0.3)] shadow-[0_0_20px_rgba(0,255,180,0.05)]'
                      : 'bg-[rgba(255,255,255,0.02)] border-[rgba(255,255,255,0.06)] hover:border-[rgba(0,255,180,0.20)]'
                  )}
                >
                  {/* Tags Row */}
                  <div className="flex items-center gap-2 mb-3">
                    <Badge
                      variant="outline"
                      className="text-xs bg-[rgba(255,255,255,0.05)] text-[rgba(255,255,255,0.65)] border-[rgba(255,255,255,0.12)]"
                    >
                      {company.contractsCount} {company.contractsCount === 1 ? 'Contrato' : 'Contratos'}
                    </Badge>
                    {company.linkedProjectsCount > 0 && (
                      <StatusPill variant="info" className="text-[10px]">
                        {company.linkedProjectsCount} Projeto{company.linkedProjectsCount > 1 ? 's' : ''}
                      </StatusPill>
                    )}
                  </div>

                  {/* Title + Subtitle */}
                  <h3 className="text-sm font-semibold text-white mb-1 line-clamp-1">
                    {company.company}
                  </h3>
                  <p className="text-xs text-[rgba(255,255,255,0.55)] mb-3">Visão Consolidada</p>

                  {/* Status + Impact Pills */}
                  <div className="flex items-center gap-2 mb-3">
                    <StatusPill variant="active">Ativo</StatusPill>
                    <StatusPill
                      variant={
                        company.totalContracted > 100000000
                          ? 'critical'
                          : company.totalContracted > 50000000
                          ? 'at_risk'
                          : 'active'
                      }
                    >
                      Impacto{' '}
                      {company.totalContracted > 100000000
                        ? 'Crítico'
                        : company.totalContracted > 50000000
                        ? 'Alto'
                        : 'Médio'}
                    </StatusPill>
                  </div>

                  {/* Progress Bar with % */}
                  <div className="flex items-center gap-2 mb-3">
                    <div className="flex-1">
                      <HUDProgressBar
                        value={progress}
                        showLabel={false}
                        variant={
                          progress >= 80
                            ? 'completed'
                            : progress >= 50
                            ? 'active'
                            : progress >= 25
                            ? 'medium'
                            : 'critical'
                        }
                      />
                    </div>
                    <span className="text-xs text-[rgba(255,255,255,0.65)] tabular-nums w-10 text-right">
                      {progress}%
                    </span>
                  </div>

                  {/* Metrics: Contratado / Backlog */}
                  <div className="grid grid-cols-2 gap-3 py-3 border-t border-b border-[rgba(255,255,255,0.05)] mb-3">
                    <div>
                      <p className="text-xs text-[rgba(255,255,255,0.40)] mb-0.5">Contratado</p>
                      <p className="font-medium text-sm text-white tabular-nums">
                        {new Intl.NumberFormat('pt-BR', {
                          style: 'currency',
                          currency: 'BRL',
                          notation: 'compact',
                        }).format(company.totalContracted)}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-[rgba(255,255,255,0.40)] mb-0.5">Backlog</p>
                      <p className="font-medium text-sm text-white tabular-nums">
                        {new Intl.NumberFormat('pt-BR', {
                          style: 'currency',
                          currency: 'BRL',
                          notation: 'compact',
                        }).format(company.backlogToInvoice)}
                      </p>
                    </div>
                  </div>

                  {/* Comitê / Governança Row */}
                  <div className="mb-4">
                    <p className="text-xs text-[rgba(255,255,255,0.40)] mb-1">Responsabilidade</p>
                    <div className="flex items-center gap-2">
                      <Badge
                        variant="outline"
                        className="text-xs bg-[rgba(255,255,255,0.05)] text-[rgba(255,255,255,0.65)] border-[rgba(255,255,255,0.12)]"
                      >
                        <Building2 className="w-3 h-3 mr-1" />
                        Diretoria Executiva
                      </Badge>
                      <span className="text-[10px] text-cyan-400/60 font-medium">
                        {percentage.toFixed(1)}% do total
                      </span>
                    </div>
                  </div>

                  {/* Action */}
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full h-8 border-[rgba(0,255,180,0.25)] text-[rgba(255,255,255,0.92)] hover:bg-[rgba(0,255,180,0.12)] text-xs mt-auto"
                  >
                    <Eye className="w-3.5 h-3.5 mr-1.5" />
                    Ver Detalhes
                  </Button>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-[rgba(255,255,255,0.05)]">
                  <TableHead className="text-[rgba(255,255,255,0.65)] font-medium">Empresa</TableHead>
                  <TableHead
                    className="text-[rgba(255,255,255,0.65)] font-medium text-right cursor-pointer select-none hover:text-white"
                    onClick={() => handleSortClick('contracted')}
                  >
                    <span className="inline-flex items-center gap-1 justify-end">
                      Contratado (R$)
                      {sortCol === 'contracted' ? (
                        sortDir === 'desc' ? (
                          <ArrowDown className="w-3 h-3" />
                        ) : (
                          <ArrowUp className="w-3 h-3" />
                        )
                      ) : (
                        <ArrowUpDown className="w-3 h-3 opacity-40" />
                      )}
                    </span>
                  </TableHead>
                  <TableHead
                    className="text-[rgba(255,255,255,0.65)] font-medium text-right cursor-pointer select-none hover:text-white"
                    onClick={() => handleSortClick('backlog')}
                  >
                    <span className="inline-flex items-center gap-1 justify-end">
                      Backlog (R$)
                      {sortCol === 'backlog' ? (
                        sortDir === 'desc' ? (
                          <ArrowDown className="w-3 h-3" />
                        ) : (
                          <ArrowUp className="w-3 h-3" />
                        )
                      ) : (
                        <ArrowUpDown className="w-3 h-3 opacity-40" />
                      )}
                    </span>
                  </TableHead>
                  <TableHead className="text-[rgba(255,255,255,0.65)] font-medium text-right">
                    Qtde Contratos
                  </TableHead>
                  <TableHead className="text-[rgba(255,255,255,0.65)] font-medium text-right">
                    Projetos
                  </TableHead>
                  <TableHead className="text-[rgba(255,255,255,0.65)] font-medium text-right">
                    % do Total
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredData.map((company) => (
                  <TableRow
                    key={company.company}
                    className={cn(
                      'cursor-pointer border-[rgba(255,255,255,0.05)] transition-colors',
                      selectedCompany?.company === company.company
                        ? 'bg-[rgba(0,255,180,0.08)] hover:bg-[rgba(0,255,180,0.12)]'
                        : 'hover:bg-[rgba(255,255,255,0.03)]'
                    )}
                    onClick={() => handleCompanyClick(company)}
                  >
                    <TableCell className="text-[rgba(255,255,255,0.92)] font-medium">
                      {company.company}
                    </TableCell>
                    <TableCell className="text-[rgba(255,255,255,0.92)] text-right tabular-nums">
                      {formatCurrency(company.totalContracted)}
                    </TableCell>
                    <TableCell className="text-[rgba(255,255,255,0.92)] text-right tabular-nums">
                      {formatCurrency(company.backlogToInvoice)}
                    </TableCell>
                    <TableCell className="text-[rgba(255,255,255,0.92)] text-right tabular-nums">
                      {company.contractsCount}
                    </TableCell>
                    <TableCell className="text-[rgba(255,255,255,0.92)] text-right tabular-nums">
                      {company.linkedProjectsCount}
                    </TableCell>
                    <TableCell className="text-[rgba(255,255,255,0.92)] text-right tabular-nums">
                      {((company.totalContracted / portfolioTotals.totalContracted) * 100).toFixed(1)}%
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </HUDCard>

      {/* Company Detail Drawer */}
      <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
        <SheetContent
          side="right"
          className="w-full sm:max-w-xl bg-gradient-to-br from-[#07130F] to-[#030B09] border-l border-[rgba(255,255,255,0.08)] overflow-y-auto"
        >
          {selectedCompany && (
            <>
              <SheetHeader className="mb-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-[rgba(0,200,255,0.12)] rounded-lg">
                    <Building2 className="w-5 h-5 text-[#00C8FF]" />
                  </div>
                  <div>
                    <SheetTitle className="text-xl font-semibold text-white">
                      {selectedCompany.company}
                    </SheetTitle>
                    <p className="text-xs text-[rgba(255,255,255,0.50)]">
                      {selectedCompany.contractsCount} contratos • {selectedCompany.linkedProjectsCount} projetos
                    </p>
                  </div>
                </div>
              </SheetHeader>

              {/* Company KPIs - 3x2 Grid */}
              <div className="grid grid-cols-3 gap-3 mb-5">
                <div className="bg-[rgba(255,255,255,0.03)] rounded-lg p-3 border border-[rgba(255,255,255,0.05)]">
                  <div className="flex items-center gap-1.5 mb-1">
                    <DollarSign className="w-3 h-3 text-[#00C8FF]" />
                    <p className="text-[10px] text-[rgba(255,255,255,0.50)] uppercase tracking-wide">Contratado</p>
                  </div>
                  <p className="text-sm font-semibold text-white tabular-nums">
                    {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', notation: 'compact' }).format(selectedCompany.totalContracted)}
                  </p>
                </div>
                <div className="bg-[rgba(255,255,255,0.03)] rounded-lg p-3 border border-[rgba(255,255,255,0.05)]">
                  <div className="flex items-center gap-1.5 mb-1">
                    <Clock className="w-3 h-3 text-amber-400" />
                    <p className="text-[10px] text-[rgba(255,255,255,0.50)] uppercase tracking-wide">Backlog</p>
                  </div>
                  <p className="text-sm font-semibold text-amber-400 tabular-nums">
                    {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', notation: 'compact' }).format(selectedCompany.backlogToInvoice)}
                  </p>
                </div>
                <div className="bg-[rgba(255,255,255,0.03)] rounded-lg p-3 border border-[rgba(255,255,255,0.05)]">
                  <div className="flex items-center gap-1.5 mb-1">
                    <TrendingUp className="w-3 h-3 text-emerald-400" />
                    <p className="text-[10px] text-[rgba(255,255,255,0.50)] uppercase tracking-wide">Faturado</p>
                  </div>
                  <p className="text-sm font-semibold text-emerald-400 tabular-nums">
                    {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', notation: 'compact' }).format(selectedCompany.totalContracted - selectedCompany.backlogToInvoice)}
                  </p>
                </div>
                <div className="bg-[rgba(255,255,255,0.03)] rounded-lg p-3 border border-[rgba(255,255,255,0.05)]">
                  <div className="flex items-center gap-1.5 mb-1">
                    <FileText className="w-3 h-3 text-[rgba(255,255,255,0.50)]" />
                    <p className="text-[10px] text-[rgba(255,255,255,0.50)] uppercase tracking-wide">Contratos</p>
                  </div>
                  <p className="text-sm font-semibold text-white tabular-nums">
                    {selectedCompany.contractsCount}
                  </p>
                </div>
                <div className="bg-[rgba(255,255,255,0.03)] rounded-lg p-3 border border-[rgba(255,255,255,0.05)]">
                  <div className="flex items-center gap-1.5 mb-1">
                    <Building2 className="w-3 h-3 text-[rgba(255,255,255,0.50)]" />
                    <p className="text-[10px] text-[rgba(255,255,255,0.50)] uppercase tracking-wide">% Total</p>
                  </div>
                  <p className="text-sm font-semibold text-white tabular-nums">
                    {((selectedCompany.totalContracted / portfolioTotals.totalContracted) * 100).toFixed(1)}%
                  </p>
                </div>
                <div className="bg-[rgba(255,255,255,0.03)] rounded-lg p-3 border border-[rgba(255,255,255,0.05)]">
                  <div className="flex items-center gap-1.5 mb-1">
                    <Shield className="w-3 h-3 text-[rgba(255,255,255,0.50)]" />
                    <p className="text-[10px] text-[rgba(255,255,255,0.50)] uppercase tracking-wide">Risco</p>
                  </div>
                  {(() => {
                    const highRisk = selectedCompany.linkedProjects.filter(p => p.risco_geral === 'alto').length;
                    const mediumRisk = selectedCompany.linkedProjects.filter(p => p.risco_geral === 'medio').length;
                    const riskLevel = highRisk > 0 ? 'high' : mediumRisk > 0 ? 'medium' : 'low';
                    return (
                      <StatusPill
                        variant={riskLevel === 'high' ? 'critical' : riskLevel === 'medium' ? 'warning' : 'active'}
                        className="text-[10px]"
                      >
                        {riskLevel === 'high' ? 'Alto' : riskLevel === 'medium' ? 'Médio' : 'Baixo'}
                      </StatusPill>
                    );
                  })()}
                </div>
              </div>

              {/* Linked Projects as Chips */}
              {selectedCompany.linkedProjectsCount > 0 && (
                <div className="mb-5">
                  <h3 className="text-[11px] font-medium text-[rgba(255,255,255,0.40)] mb-2.5 uppercase tracking-wider flex items-center gap-2">
                    <Briefcase className="w-3.5 h-3.5" />
                    Projetos Vinculados ({selectedCompany.linkedProjectsCount})
                  </h3>
                  <div className="flex flex-wrap gap-2">
                    {selectedCompany.linkedProjects.map((project) => (
                      <button
                        key={project.id}
                        onClick={() => onProjectClick?.(project)}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg 
                                   bg-[rgba(0,200,255,0.06)] border border-[rgba(0,200,255,0.15)]
                                   hover:bg-[rgba(0,200,255,0.12)] hover:border-[rgba(0,200,255,0.25)] 
                                   transition-all cursor-pointer group"
                      >
                        <span className="text-xs font-medium text-[#00C8FF] group-hover:text-white">
                          {project.codigo}
                        </span>
                        <span className={cn(
                          "text-[10px] px-1.5 py-0.5 rounded",
                          project.status === 'em_andamento' ? 'bg-[rgba(0,255,180,0.15)] text-[#00FFB4]' :
                          project.status === 'concluido' ? 'bg-[rgba(100,200,255,0.15)] text-[#64C8FF]' :
                          project.status === 'cancelado' ? 'bg-[rgba(255,88,96,0.15)] text-[#FF5860]' :
                          'bg-[rgba(255,255,255,0.08)] text-[rgba(255,255,255,0.65)]'
                        )}>
                          {project.progresso_percentual || 0}%
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Contracts Table */}
              <div className="mb-5">
                <h3 className="text-[11px] font-medium text-[rgba(255,255,255,0.40)] mb-2.5 uppercase tracking-wider flex items-center gap-2">
                  <FileText className="w-3.5 h-3.5" />
                  Contratos ({selectedCompany.contractsCount})
                </h3>
                <div className="rounded-lg border border-[rgba(255,255,255,0.06)] overflow-hidden">
                  <div className="max-h-[200px] overflow-y-auto">
                    <Table>
                      <TableHeader className="sticky top-0 bg-[rgba(7,19,15,0.95)]">
                        <TableRow className="border-[rgba(255,255,255,0.05)] hover:bg-transparent">
                          <TableHead className="text-[10px] text-[rgba(255,255,255,0.50)] font-medium py-2 px-3">ID</TableHead>
                          <TableHead className="text-[10px] text-[rgba(255,255,255,0.50)] font-medium py-2 px-3">UF</TableHead>
                          <TableHead className="text-[10px] text-[rgba(255,255,255,0.50)] font-medium py-2 px-3 text-right">Valor</TableHead>
                          <TableHead className="text-[10px] text-[rgba(255,255,255,0.50)] font-medium py-2 px-3 text-right">Status</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {generatePlaceholderContracts(selectedCompany).map((contract) => (
                          <TableRow 
                            key={contract.id} 
                            className="border-[rgba(255,255,255,0.03)] hover:bg-[rgba(255,255,255,0.02)]"
                          >
                            <TableCell className="text-xs text-white py-2 px-3 font-medium">{contract.id}</TableCell>
                            <TableCell className="text-xs text-[rgba(255,255,255,0.65)] py-2 px-3">{contract.state}</TableCell>
                            <TableCell className="text-xs text-[rgba(255,255,255,0.85)] py-2 px-3 text-right tabular-nums">
                              {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', notation: 'compact' }).format(contract.value)}
                            </TableCell>
                            <TableCell className="text-right py-2 px-3">
                              <span
                                className={`text-[10px] px-1.5 py-0.5 rounded ${
                                  contract.status === 'ACTIVE'
                                    ? 'bg-[rgba(0,255,180,0.15)] text-[#00FFB4]'
                                    : contract.status === 'PENDING'
                                    ? 'bg-[rgba(255,176,77,0.15)] text-[#FFB04D]'
                                    : 'bg-[rgba(255,255,255,0.08)] text-[rgba(255,255,255,0.65)]'
                                }`}
                              >
                                {contract.status}
                              </span>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              </div>

              {/* Enterprise Actions */}
              <div className="mb-5">
                <h3 className="text-[11px] font-medium text-[rgba(255,255,255,0.40)] mb-2.5 uppercase tracking-wider flex items-center gap-2">
                  <Zap className="w-3.5 h-3.5" />
                  Ações
                </h3>
                <div className="grid grid-cols-1 gap-2">
                  <Button 
                    variant="outline" 
                    size="sm"
                    className="w-full justify-start h-9 border-[rgba(255,255,255,0.08)] text-[rgba(255,255,255,0.85)] hover:bg-[rgba(255,176,77,0.08)] hover:border-[rgba(255,176,77,0.25)] hover:text-amber-400"
                  >
                    <MapPin className="w-4 h-4 mr-2 text-amber-400" />
                    Open Risk Map
                  </Button>
                  <Button 
                    variant="outline" 
                    size="sm"
                    className="w-full justify-start h-9 border-[rgba(255,255,255,0.08)] text-[rgba(255,255,255,0.85)] hover:bg-[rgba(0,200,255,0.08)] hover:border-[rgba(0,200,255,0.25)] hover:text-[#00C8FF]"
                  >
                    <Sparkles className="w-4 h-4 mr-2 text-[#00C8FF]" />
                    Run AI Analysis
                  </Button>
                  <Button 
                    variant="outline" 
                    size="sm"
                    className="w-full justify-start h-9 border-[rgba(255,255,255,0.08)] text-[rgba(255,255,255,0.85)] hover:bg-[rgba(0,255,180,0.08)] hover:border-[rgba(0,255,180,0.25)] hover:text-emerald-400"
                  >
                    <Clock className="w-4 h-4 mr-2 text-emerald-400" />
                    View Event Timeline
                  </Button>
                </div>
              </div>

              {/* Primary CTA */}
              <Link href={`/projetos?company=${encodeURIComponent(selectedCompany.company)}`}>
                <Button className="w-full bg-[#00FFB4] text-[#050D0A] hover:bg-[#00E6A0] font-medium">
                  <Eye className="w-4 h-4 mr-2" />
                  Ver no Portfólio de Projetos
                </Button>
              </Link>
            </>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}

export default ContractsByCompanyModule;
