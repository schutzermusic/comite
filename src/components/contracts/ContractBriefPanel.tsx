'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Contract } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { StatusPill } from '@/components/ui/status-pill';
import { HUDCard } from '@/components/ui/hud-card';
import {
  useContractAIStore,
  useContractAnalysis,
  useContractQuestions,
  useIsAnalyzing,
  useIsAsking,
} from '@/lib/stores/contract-ai-store';
import type { 
  RiskSeverity, 
  ActionPriority,
  ComplianceStatus,
  CheckpointStatus,
} from '@/lib/services/contract-ai';
import {
  FileText,
  DollarSign,
  Calendar,
  Clock,
  AlertTriangle,
  Eye,
  Download,
  Plus,
  Building2,
  User,
  Shield,
  TrendingUp,
  ExternalLink,
  Zap,
  Send,
  Loader2,
  ChevronDown,
  ChevronUp,
  Target,
  Scale,
  Activity,
  CheckCircle,
  XCircle,
  AlertCircle,
  CalendarClock,
  MessageSquare,
} from 'lucide-react';
import { format, differenceInDays } from 'date-fns';
import { pt } from 'date-fns/locale';

interface ContractBriefPanelProps {
  contract: Contract | null;
  onViewContract?: (contract: Contract) => void;
  onDownloadContract?: (contract: Contract) => void;
}

/**
 * ContractBriefPanel
 * 
 * Right-side persistent panel showing contract details and AI analysis.
 * Updates when a contract row is selected in the main list.
 */
export function ContractBriefPanel({
  contract,
  onViewContract,
  onDownloadContract,
}: ContractBriefPanelProps) {
  const router = useRouter();
  
  // AI Analysis state
  const [askInput, setAskInput] = useState('');
  const [showAnalysis, setShowAnalysis] = useState(true);
  const [showQuestions, setShowQuestions] = useState(true);
  
  // Store hooks
  const { runAnalysis, askQuestion } = useContractAIStore();
  const analysis = useContractAnalysis(contract?.id || null);
  const questions = useContractQuestions(contract?.id || null);
  const isAnalyzing = useIsAnalyzing(contract?.id || null);
  const isAsking = useIsAsking(contract?.id || null);

  const handleOpenDetails = () => {
    if (contract) {
      router.push(`/contratos/${contract.id}`);
    }
  };

  const handleRunAnalysis = async () => {
    if (contract) {
      await runAnalysis(contract.id);
    }
  };

  const handleAskQuestion = async () => {
    if (contract && askInput.trim()) {
      await askQuestion(contract.id, askInput.trim());
      setAskInput('');
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleAskQuestion();
    }
  };

  if (!contract) {
    return (
      <HUDCard className="h-full min-h-[500px] flex flex-col items-center justify-center">
        <div className="text-center p-6">
          <div className="p-4 bg-[rgba(255,255,255,0.03)] rounded-full w-16 h-16 mx-auto mb-4 flex items-center justify-center">
            <FileText className="w-8 h-8 text-[rgba(255,255,255,0.25)]" />
          </div>
          <h3 className="text-sm font-medium text-[rgba(255,255,255,0.75)] mb-1">
            Nenhum contrato selecionado
          </h3>
          <p className="text-xs text-[rgba(255,255,255,0.45)]">
            Selecione um contrato na lista para ver os detalhes
          </p>
        </div>
      </HUDCard>
    );
  }

  const formatCurrency = (value: number) =>
    new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value || 0);

  const getDaysUntilExpiration = (expirationDate?: Date) => {
    if (!expirationDate) return null;
    return differenceInDays(new Date(expirationDate), new Date());
  };

  const daysUntilExpiration = getDaysUntilExpiration(contract.expirationDate);

  const getRiskVariant = (classification: Contract['riskClassification']) => {
    const variants: Record<string, 'critical' | 'warning' | 'active'> = {
      'high': 'critical',
      'medium': 'warning',
      'low': 'active',
    };
    return variants[classification] || 'neutral';
  };

  const getStatusVariant = (status: Contract['status']) => {
    const variants: Record<string, 'critical' | 'warning' | 'active'> = {
      'expired': 'critical',
      'expiring_soon': 'warning',
      'active': 'active',
    };
    return variants[status] || 'neutral';
  };

  const formatStatusLabel = (status: string) => {
    const labels: Record<string, string> = {
      'expired': 'Expirado',
      'expiring_soon': 'Expirando',
      'active': 'Ativo',
    };
    return labels[status] || status;
  };

  const formatRiskLabel = (risk: string) => {
    const labels: Record<string, string> = {
      'high': 'Alto',
      'medium': 'Médio',
      'low': 'Baixo',
    };
    return labels[risk] || risk;
  };

  const getSeverityColor = (severity: RiskSeverity) => {
    const colors: Record<RiskSeverity, string> = {
      'critical': 'text-[#FF5860] bg-[rgba(255,88,96,0.15)]',
      'high': 'text-[#FF5860] bg-[rgba(255,88,96,0.15)]',
      'medium': 'text-[#FFB04D] bg-[rgba(255,176,77,0.15)]',
      'low': 'text-[#00FFB4] bg-[rgba(0,255,180,0.15)]',
    };
    return colors[severity];
  };

  const getPriorityColor = (priority: ActionPriority) => {
    const colors: Record<ActionPriority, string> = {
      'urgent': 'text-[#FF5860] border-[#FF5860]',
      'high': 'text-[#FFB04D] border-[#FFB04D]',
      'medium': 'text-[#00C8FF] border-[#00C8FF]',
      'low': 'text-[rgba(255,255,255,0.65)] border-[rgba(255,255,255,0.25)]',
    };
    return colors[priority];
  };

  const getComplianceColor = (status: ComplianceStatus) => {
    const colors: Record<ComplianceStatus, string> = {
      'gap': 'text-[#FF5860] bg-[rgba(255,88,96,0.15)]',
      'partial': 'text-[#FFB04D] bg-[rgba(255,176,77,0.15)]',
      'compliant': 'text-[#00FFB4] bg-[rgba(0,255,180,0.15)]',
    };
    return colors[status];
  };

  const getCategoryIcon = (category: string) => {
    const icons: Record<string, typeof AlertTriangle> = {
      'legal': Scale,
      'financial': DollarSign,
      'operational': Activity,
      'compliance': Shield,
      'sla': Target,
    };
    return icons[category] || AlertTriangle;
  };

  return (
    <HUDCard className="h-full flex flex-col">
      {/* Header */}
      <div className="pb-4 border-b border-[rgba(255,255,255,0.06)]">
        <div className="flex items-start gap-3 mb-3">
          <div className="p-2 bg-[rgba(0,200,255,0.12)] rounded-lg shrink-0">
            <FileText className="w-5 h-5 text-[#00C8FF]" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-semibold text-white leading-tight mb-1 line-clamp-2">
              {contract.name}
            </h3>
            <p className="text-xs text-[rgba(255,255,255,0.55)] truncate">
              {contract.vendorOrParty}
            </p>
          </div>
        </div>
        
        {/* Status Badges */}
        <div className="flex items-center gap-2 flex-wrap">
          <StatusPill variant={getStatusVariant(contract.status)} className="text-[10px]">
            {formatStatusLabel(contract.status)}
          </StatusPill>
          <StatusPill variant={getRiskVariant(contract.riskClassification)} className="text-[10px]">
            Risco {formatRiskLabel(contract.riskClassification)}
          </StatusPill>
          {contract.autoExtracted && (
            <Badge variant="outline" className="text-[10px] bg-[rgba(0,200,255,0.08)] text-[#00C8FF] border-[rgba(0,200,255,0.2)]">
              AI Extracted
            </Badge>
          )}
        </div>
      </div>

      {/* Content Sections */}
      <div className="flex-1 overflow-y-auto py-4 space-y-5">
        {/* Value Section */}
        <section>
          <h4 className="text-[11px] font-medium uppercase tracking-wider text-[rgba(255,255,255,0.40)] mb-2 flex items-center gap-2">
            <DollarSign className="w-3.5 h-3.5" />
            Valor
          </h4>
          <div className="bg-[rgba(255,255,255,0.03)] rounded-lg p-3 border border-[rgba(255,255,255,0.05)]">
            <p className="text-2xl font-semibold text-white tabular-nums">
              {formatCurrency(contract.value)}
            </p>
            <p className="text-xs text-[rgba(255,255,255,0.50)] mt-1">
              {contract.currency}
            </p>
          </div>
        </section>

        {/* Timeline Section */}
        <section>
          <h4 className="text-[11px] font-medium uppercase tracking-wider text-[rgba(255,255,255,0.40)] mb-2 flex items-center gap-2">
            <Calendar className="w-3.5 h-3.5" />
            Timeline
          </h4>
          <div className="space-y-2">
            <div className="flex justify-between items-center py-2 border-b border-[rgba(255,255,255,0.04)]">
              <span className="text-xs text-[rgba(255,255,255,0.50)]">Assinatura</span>
              <span className="text-xs text-[rgba(255,255,255,0.90)] tabular-nums">
                {contract.signingDate 
                  ? format(new Date(contract.signingDate), 'dd/MM/yyyy', { locale: pt })
                  : '—'}
              </span>
            </div>
            <div className="flex justify-between items-center py-2 border-b border-[rgba(255,255,255,0.04)]">
              <span className="text-xs text-[rgba(255,255,255,0.50)]">Expiração</span>
              <span className="text-xs text-[rgba(255,255,255,0.90)] tabular-nums">
                {contract.expirationDate 
                  ? format(new Date(contract.expirationDate), 'dd/MM/yyyy', { locale: pt })
                  : '—'}
              </span>
            </div>
            {daysUntilExpiration !== null && (
              <div className="flex justify-between items-center py-2">
                <span className="text-xs text-[rgba(255,255,255,0.50)]">Dias Restantes</span>
                <span className={`text-xs font-medium tabular-nums ${
                  daysUntilExpiration < 0 ? 'text-[#FF5860]' :
                  daysUntilExpiration < 30 ? 'text-[#FFB04D]' :
                  daysUntilExpiration < 90 ? 'text-[#00C8FF]' :
                  'text-[#00FFB4]'
                }`}>
                  {daysUntilExpiration < 0 
                    ? `Expirado há ${Math.abs(daysUntilExpiration)}d`
                    : `${daysUntilExpiration}d`
                  }
                </span>
              </div>
            )}
          </div>
        </section>

        {/* Risk Assessment */}
        <section>
          <h4 className="text-[11px] font-medium uppercase tracking-wider text-[rgba(255,255,255,0.40)] mb-2 flex items-center gap-2">
            <Shield className="w-3.5 h-3.5" />
            Avaliação de Risco
          </h4>
          <div className="grid grid-cols-2 gap-2">
            <div className="bg-[rgba(255,255,255,0.03)] rounded-lg p-3 border border-[rgba(255,255,255,0.05)]">
              <p className="text-[10px] text-[rgba(255,255,255,0.50)] mb-1">Classificação</p>
              <StatusPill 
                variant={getRiskVariant(contract.riskClassification)} 
                className="text-[10px]"
              >
                {formatRiskLabel(contract.riskClassification)}
              </StatusPill>
            </div>
            <div className="bg-[rgba(255,255,255,0.03)] rounded-lg p-3 border border-[rgba(255,255,255,0.05)]">
              <p className="text-[10px] text-[rgba(255,255,255,0.50)] mb-1">Riscos Vinculados</p>
              <p className="text-sm font-semibold text-white tabular-nums">
                {contract.linkedRisks?.length || 0}
              </p>
            </div>
          </div>
        </section>

        {/* Details Section */}
        <section>
          <h4 className="text-[11px] font-medium uppercase tracking-wider text-[rgba(255,255,255,0.40)] mb-2 flex items-center gap-2">
            <Building2 className="w-3.5 h-3.5" />
            Detalhes
          </h4>
          <div className="space-y-2">
            <div className="flex justify-between items-center py-2 border-b border-[rgba(255,255,255,0.04)]">
              <span className="text-xs text-[rgba(255,255,255,0.50)]">Fornecedor</span>
              <span className="text-xs text-[rgba(255,255,255,0.90)] truncate max-w-[150px]">
                {contract.vendorOrParty}
              </span>
            </div>
            {contract.responsibleName && (
              <div className="flex justify-between items-center py-2 border-b border-[rgba(255,255,255,0.04)]">
                <span className="text-xs text-[rgba(255,255,255,0.50)]">Responsável</span>
                <span className="text-xs text-[rgba(255,255,255,0.90)]">
                  {contract.responsibleName}
                </span>
              </div>
            )}
            <div className="flex justify-between items-center py-2">
              <span className="text-xs text-[rgba(255,255,255,0.50)]">Upload</span>
              <span className="text-xs text-[rgba(255,255,255,0.90)] tabular-nums">
                {format(new Date(contract.uploadedAt), 'dd/MM/yyyy', { locale: pt })}
              </span>
            </div>
          </div>
        </section>

        {/* Notes Section */}
        {contract.notes && (
          <section>
            <h4 className="text-[11px] font-medium uppercase tracking-wider text-[rgba(255,255,255,0.40)] mb-2">
              Observações
            </h4>
            <p className="text-xs text-[rgba(255,255,255,0.70)] leading-relaxed bg-[rgba(255,255,255,0.02)] p-3 rounded-lg border border-[rgba(255,255,255,0.04)]">
              {contract.notes}
            </p>
          </section>
        )}

        {/* ============================================ */}
        {/* AI ANALYSIS SECTION */}
        {/* ============================================ */}
        <section className="border-t border-[rgba(255,255,255,0.06)] pt-4">
          <h4 className="text-[11px] font-medium uppercase tracking-wider text-[rgba(255,255,255,0.40)] mb-3 flex items-center gap-2">
            <Zap className="w-3.5 h-3.5 text-[#00FFB4]" />
            AI Analysis
            {analysis && (
              <Badge variant="outline" className="ml-auto text-[9px] bg-[rgba(0,255,180,0.08)] text-[#00FFB4] border-[rgba(0,255,180,0.2)]">
                Analisado
              </Badge>
            )}
          </h4>

          {/* Run Analysis Button */}
          <Button
            onClick={handleRunAnalysis}
            disabled={isAnalyzing}
            className="w-full h-9 mb-3 bg-gradient-to-r from-[#00FFB4] to-[#00C8FF] text-[#050D0A] hover:opacity-90 font-medium text-xs disabled:opacity-50"
          >
            {isAnalyzing ? (
              <>
                <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                Analisando...
              </>
            ) : (
              <>
                <Zap className="w-3.5 h-3.5 mr-1.5" />
                {analysis ? 'Reanalisar Contrato' : 'Run AI Analysis'}
              </>
            )}
          </Button>

          {/* Ask Input */}
          <div className="flex gap-2 mb-4">
            <Input
              value={askInput}
              onChange={(e) => setAskInput(e.target.value)}
              onKeyDown={handleKeyPress}
              placeholder="Pergunte sobre este contrato..."
              disabled={isAsking}
              className="flex-1 h-9 text-xs bg-[rgba(255,255,255,0.03)] border-[rgba(255,255,255,0.08)] text-white placeholder:text-[rgba(255,255,255,0.35)] focus:border-[#00C8FF]"
            />
            <Button
              onClick={handleAskQuestion}
              disabled={isAsking || !askInput.trim()}
              size="sm"
              className="h-9 w-9 p-0 bg-[rgba(0,200,255,0.15)] hover:bg-[rgba(0,200,255,0.25)] border border-[rgba(0,200,255,0.25)] disabled:opacity-50"
            >
              {isAsking ? (
                <Loader2 className="w-4 h-4 text-[#00C8FF] animate-spin" />
              ) : (
                <Send className="w-4 h-4 text-[#00C8FF]" />
              )}
            </Button>
          </div>

          {/* Analysis Results */}
          {analysis && (
            <div className="space-y-3">
              {/* Collapsible Header */}
              <button
                onClick={() => setShowAnalysis(!showAnalysis)}
                className="w-full flex items-center justify-between py-2 text-xs text-[rgba(255,255,255,0.65)] hover:text-white transition-colors"
              >
                <span className="font-medium">Resultados da Análise</span>
                {showAnalysis ? (
                  <ChevronUp className="w-4 h-4" />
                ) : (
                  <ChevronDown className="w-4 h-4" />
                )}
              </button>

              {showAnalysis && (
                <div className="space-y-4">
                  {/* Risk Score */}
                  <div className="flex items-center gap-3 p-3 bg-[rgba(255,255,255,0.02)] rounded-lg border border-[rgba(255,255,255,0.05)]">
                    <div className={`w-12 h-12 rounded-full flex items-center justify-center border-2 ${
                      analysis.overallRiskScore >= 70 ? 'border-[#FF5860] bg-[rgba(255,88,96,0.1)]' :
                      analysis.overallRiskScore >= 40 ? 'border-[#FFB04D] bg-[rgba(255,176,77,0.1)]' :
                      'border-[#00FFB4] bg-[rgba(0,255,180,0.1)]'
                    }`}>
                      <span className={`text-lg font-bold ${
                        analysis.overallRiskScore >= 70 ? 'text-[#FF5860]' :
                        analysis.overallRiskScore >= 40 ? 'text-[#FFB04D]' :
                        'text-[#00FFB4]'
                      }`}>
                        {analysis.overallRiskScore}
                      </span>
                    </div>
                    <div>
                      <p className="text-xs font-medium text-white">Risk Score</p>
                      <p className="text-[10px] text-[rgba(255,255,255,0.50)]">
                        {analysis.overallRiskScore >= 70 ? 'Alto Risco' :
                         analysis.overallRiskScore >= 40 ? 'Risco Moderado' :
                         'Baixo Risco'}
                      </p>
                    </div>
                  </div>

                  {/* Risk Drivers (Top 5) */}
                  <div>
                    <p className="text-[10px] font-medium text-[rgba(255,255,255,0.50)] uppercase tracking-wide mb-2">
                      Risk Drivers (Top 5)
                    </p>
                    <div className="space-y-1.5">
                      {analysis.riskDrivers.slice(0, 5).map((risk, idx) => {
                        const CategoryIcon = getCategoryIcon(risk.category);
                        return (
                          <div key={risk.id} className="flex items-start gap-2 p-2 bg-[rgba(255,255,255,0.02)] rounded border border-[rgba(255,255,255,0.04)]">
                            <span className="text-[10px] text-[rgba(255,255,255,0.40)] tabular-nums w-4">{idx + 1}.</span>
                            <CategoryIcon className="w-3 h-3 text-[rgba(255,255,255,0.40)] mt-0.5 shrink-0" />
                            <div className="flex-1 min-w-0">
                              <p className="text-[11px] text-white leading-tight">{risk.title}</p>
                              <span className={`inline-block text-[9px] px-1.5 py-0.5 rounded mt-1 ${getSeverityColor(risk.severity)}`}>
                                {risk.severity === 'critical' ? 'Crítico' : 
                                 risk.severity === 'high' ? 'Alto' : 
                                 risk.severity === 'medium' ? 'Médio' : 'Baixo'}
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Recommended Actions */}
                  <div>
                    <p className="text-[10px] font-medium text-[rgba(255,255,255,0.50)] uppercase tracking-wide mb-2">
                      Ações Recomendadas (7 dias)
                    </p>
                    <div className="space-y-1.5">
                      {analysis.recommendedActions.slice(0, 3).map((action) => (
                        <div key={action.id} className="p-2 bg-[rgba(255,255,255,0.02)] rounded border border-[rgba(255,255,255,0.04)]">
                          <div className="flex items-start justify-between gap-2">
                            <p className="text-[11px] text-white leading-tight flex-1">{action.title}</p>
                            <span className={`text-[9px] px-1.5 py-0.5 rounded border shrink-0 ${getPriorityColor(action.priority)}`}>
                              {action.priority === 'urgent' ? 'Urgente' : 
                               action.priority === 'high' ? 'Alta' : 
                               action.priority === 'medium' ? 'Média' : 'Baixa'}
                            </span>
                          </div>
                          <div className="flex items-center gap-2 mt-1">
                            <CalendarClock className="w-3 h-3 text-[rgba(255,255,255,0.40)]" />
                            <span className="text-[10px] text-[rgba(255,255,255,0.50)]">
                              {format(new Date(action.dueDate), 'dd/MM', { locale: pt })}
                            </span>
                            {action.assignee && (
                              <>
                                <span className="text-[rgba(255,255,255,0.20)]">•</span>
                                <span className="text-[10px] text-[rgba(255,255,255,0.50)]">{action.assignee}</span>
                              </>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Financial Exposure */}
                  <div>
                    <p className="text-[10px] font-medium text-[rgba(255,255,255,0.50)] uppercase tracking-wide mb-2">
                      Exposição Financeira
                    </p>
                    <div className="p-2 bg-[rgba(255,255,255,0.02)] rounded border border-[rgba(255,255,255,0.04)] space-y-1">
                      {analysis.financialExposureNotes.slice(0, 3).map((note, idx) => (
                        <div key={idx} className="flex items-start gap-2">
                          <span className="text-[#FFB04D] mt-0.5">•</span>
                          <p className="text-[10px] text-[rgba(255,255,255,0.70)] leading-relaxed">{note}</p>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Compliance Gaps */}
                  <div>
                    <p className="text-[10px] font-medium text-[rgba(255,255,255,0.50)] uppercase tracking-wide mb-2">
                      Compliance Gaps
                    </p>
                    <div className="space-y-1.5">
                      {analysis.complianceGaps.slice(0, 3).map((gap) => (
                        <div key={gap.id} className="flex items-center gap-2 p-2 bg-[rgba(255,255,255,0.02)] rounded border border-[rgba(255,255,255,0.04)]">
                          {gap.status === 'compliant' ? (
                            <CheckCircle className="w-3 h-3 text-[#00FFB4] shrink-0" />
                          ) : gap.status === 'partial' ? (
                            <AlertCircle className="w-3 h-3 text-[#FFB04D] shrink-0" />
                          ) : (
                            <XCircle className="w-3 h-3 text-[#FF5860] shrink-0" />
                          )}
                          <div className="flex-1 min-w-0">
                            <p className="text-[10px] text-white truncate">{gap.regulation}</p>
                            <span className={`inline-block text-[9px] px-1.5 py-0.5 rounded mt-0.5 ${getComplianceColor(gap.status)}`}>
                              {gap.status === 'compliant' ? 'Conforme' : 
                               gap.status === 'partial' ? 'Parcial' : 'Gap'}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Timeline Checkpoints */}
                  <div>
                    <p className="text-[10px] font-medium text-[rgba(255,255,255,0.50)] uppercase tracking-wide mb-2">
                      Checkpoints
                    </p>
                    <div className="space-y-1">
                      {analysis.timelineCheckpoints.slice(0, 3).map((checkpoint) => (
                        <div key={checkpoint.id} className="flex items-center gap-2 py-1.5 border-b border-[rgba(255,255,255,0.04)] last:border-0">
                          <div className={`w-1.5 h-1.5 rounded-full ${
                            checkpoint.status === 'completed' ? 'bg-[#00FFB4]' :
                            checkpoint.status === 'at_risk' ? 'bg-[#FF5860]' :
                            checkpoint.status === 'overdue' ? 'bg-[#FF5860]' :
                            'bg-[#00C8FF]'
                          }`} />
                          <span className="text-[10px] text-white flex-1 truncate">{checkpoint.title}</span>
                          <span className="text-[10px] text-[rgba(255,255,255,0.50)] tabular-nums">
                            {format(new Date(checkpoint.date), 'dd/MM', { locale: pt })}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Analysis Timestamp */}
                  <p className="text-[9px] text-[rgba(255,255,255,0.35)] text-center pt-2">
                    Análise realizada em {format(new Date(analysis.analyzedAt), "dd/MM/yyyy 'às' HH:mm", { locale: pt })}
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Q&A History */}
          {questions.length > 0 && (
            <div className="mt-4">
              <button
                onClick={() => setShowQuestions(!showQuestions)}
                className="w-full flex items-center justify-between py-2 text-xs text-[rgba(255,255,255,0.65)] hover:text-white transition-colors"
              >
                <span className="font-medium flex items-center gap-2">
                  <MessageSquare className="w-3.5 h-3.5" />
                  Perguntas ({questions.length})
                </span>
                {showQuestions ? (
                  <ChevronUp className="w-4 h-4" />
                ) : (
                  <ChevronDown className="w-4 h-4" />
                )}
              </button>

              {showQuestions && (
                <div className="space-y-3 mt-2">
                  {questions.slice(-3).reverse().map((qa) => (
                    <div key={qa.id} className="p-3 bg-[rgba(255,255,255,0.02)] rounded-lg border border-[rgba(255,255,255,0.04)]">
                      <p className="text-[11px] text-[#00C8FF] font-medium mb-2">{qa.question}</p>
                      <p className="text-[10px] text-[rgba(255,255,255,0.75)] leading-relaxed">{qa.answer}</p>
                      {qa.sources.length > 0 && (
                        <div className="mt-2 pt-2 border-t border-[rgba(255,255,255,0.04)]">
                          <p className="text-[9px] text-[rgba(255,255,255,0.40)]">
                            Fontes: {qa.sources.join(', ')}
                          </p>
                        </div>
                      )}
                      <div className="flex items-center justify-between mt-2">
                        <span className="text-[9px] text-[rgba(255,255,255,0.35)]">
                          {format(new Date(qa.answeredAt), 'HH:mm', { locale: pt })}
                        </span>
                        <span className={`text-[9px] px-1.5 py-0.5 rounded ${
                          qa.confidence >= 80 ? 'bg-[rgba(0,255,180,0.15)] text-[#00FFB4]' :
                          qa.confidence >= 50 ? 'bg-[rgba(255,176,77,0.15)] text-[#FFB04D]' :
                          'bg-[rgba(255,255,255,0.08)] text-[rgba(255,255,255,0.50)]'
                        }`}>
                          {qa.confidence}% confiança
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </section>
      </div>

      {/* Actions */}
      <div className="pt-4 border-t border-[rgba(255,255,255,0.06)] space-y-2">
        {/* Primary CTA - Open Details */}
        <Button 
          onClick={handleOpenDetails}
          className="w-full h-10 bg-[#00FFB4] text-[#050D0A] hover:bg-[#00E6A0] font-medium"
        >
          <ExternalLink className="w-4 h-4 mr-1.5" />
          Open Details
        </Button>
        
        <div className="grid grid-cols-2 gap-2">
          <Button 
            variant="outline" 
            size="sm"
            onClick={() => onViewContract?.(contract)}
            className="h-9 border-[rgba(255,255,255,0.08)] text-[rgba(255,255,255,0.85)] hover:bg-[rgba(0,200,255,0.08)] hover:border-[rgba(0,200,255,0.25)] hover:text-[#00C8FF]"
          >
            <Eye className="w-4 h-4 mr-1.5" />
            Preview
          </Button>
          <Button 
            variant="outline" 
            size="sm"
            onClick={() => onDownloadContract?.(contract)}
            className="h-9 border-[rgba(255,255,255,0.08)] text-[rgba(255,255,255,0.85)] hover:bg-[rgba(0,255,180,0.08)] hover:border-[rgba(0,255,180,0.25)] hover:text-[#00FFB4]"
          >
            <Download className="w-4 h-4 mr-1.5" />
            Download
          </Button>
        </div>
        {contract.riskClassification === 'high' && (
          <Button 
            variant="outline" 
            size="sm"
            onClick={handleOpenDetails}
            className="w-full h-9 border-[rgba(255,88,96,0.25)] text-[#FF5860] hover:bg-[rgba(255,88,96,0.08)] hover:border-[rgba(255,88,96,0.4)]"
          >
            <AlertTriangle className="w-4 h-4 mr-1.5" />
            Ver Riscos Associados
          </Button>
        )}
      </div>
    </HUDCard>
  );
}

export default ContractBriefPanel;
