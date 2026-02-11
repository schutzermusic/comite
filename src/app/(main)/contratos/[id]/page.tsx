'use client';

import { useState, useMemo } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { Contract } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { HUDCard } from '@/components/ui/hud-card';
import { StatusPill } from '@/components/ui/status-pill';
import { HUDProgressBar } from '@/components/ui/hud-progress-bar';
import { OrionGreenBackground } from '@/components/system/OrionGreenBackground';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  ArrowLeft,
  FileText,
  DollarSign,
  Calendar,
  AlertTriangle,
  Shield,
  Clock,
  TrendingUp,
  TrendingDown,
  CheckCircle,
  XCircle,
  AlertCircle,
  Download,
  Eye,
  Building2,
  User,
  Zap,
  BarChart3,
  Activity,
  Target,
  Scale,
  Gavel,
  FileWarning,
  CalendarClock,
  Receipt,
  ClipboardCheck,
} from 'lucide-react';
import { format, addDays, differenceInDays } from 'date-fns';
import { pt } from 'date-fns/locale';

// ============================================
// MOCK DATA - Replace with real data later
// ============================================

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
    uploadedAt: new Date('2023-06-15'),
    responsibleName: 'Carlos Silva',
    linkedRisks: ['risk-1', 'risk-2', 'risk-3'],
    notes: 'Contrato crítico para operação. Renovação em negociação.',
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
    uploadedAt: new Date('2024-01-10'),
    responsibleName: 'Ana Oliveira',
    linkedRisks: ['risk-4'],
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
    uploadedAt: new Date('2023-11-01'),
    responsibleName: 'Roberto Santos',
  },
];

// MOCK: Risk categories for Risk Map
const mockRiskCategories = [
  { id: 'legal', name: 'Legal', icon: Scale, count: 3, severity: 'high', items: [
    { id: 'r1', title: 'Cláusula de rescisão ambígua', impact: 'high', probability: 'medium', status: 'open' },
    { id: 'r2', title: 'Jurisdição contratual indefinida', impact: 'medium', probability: 'low', status: 'mitigated' },
    { id: 'r3', title: 'Responsabilidade solidária não delimitada', impact: 'high', probability: 'high', status: 'open' },
  ]},
  { id: 'financial', name: 'Financeiro', icon: DollarSign, count: 2, severity: 'medium', items: [
    { id: 'r4', title: 'Reajuste vinculado ao IGPM', impact: 'medium', probability: 'high', status: 'monitoring' },
    { id: 'r5', title: 'Multa por atraso desproporcional', impact: 'high', probability: 'medium', status: 'open' },
  ]},
  { id: 'operational', name: 'Operacional', icon: Activity, count: 2, severity: 'medium', items: [
    { id: 'r6', title: 'SLA de atendimento sem penalidade', impact: 'medium', probability: 'high', status: 'open' },
    { id: 'r7', title: 'Dependência de fornecedor único', impact: 'high', probability: 'medium', status: 'monitoring' },
  ]},
  { id: 'compliance', name: 'Compliance', icon: Shield, count: 1, severity: 'low', items: [
    { id: 'r8', title: 'LGPD - cláusula de proteção de dados', impact: 'medium', probability: 'low', status: 'mitigated' },
  ]},
  { id: 'sla', name: 'SLA', icon: Target, count: 2, severity: 'high', items: [
    { id: 'r9', title: 'Tempo de resposta não definido', impact: 'high', probability: 'high', status: 'open' },
    { id: 'r10', title: 'Métricas de performance ausentes', impact: 'medium', probability: 'high', status: 'open' },
  ]},
];

// MOCK: Timeline events
const mockTimelineEvents = [
  { id: 't1', date: '2023-06-15', type: 'milestone', title: 'Assinatura do Contrato', status: 'completed', icon: FileText },
  { id: 't2', date: '2023-07-01', type: 'milestone', title: 'Início da Vigência', status: 'completed', icon: CheckCircle },
  { id: 't3', date: '2023-12-15', type: 'adjustment', title: 'Primeiro Aditivo - Reajuste 5%', status: 'completed', icon: TrendingUp },
  { id: 't4', date: '2024-06-15', type: 'renewal', title: 'Primeira Renovação Automática', status: 'completed', icon: Calendar },
  { id: 't5', date: '2024-12-01', type: 'deadline', title: 'Prazo para Notificação de Não-Renovação', status: 'upcoming', icon: AlertCircle },
  { id: 't6', date: '2025-01-15', type: 'penalty', title: 'Gatilho de Multa por Descumprimento SLA', status: 'at_risk', icon: AlertTriangle },
  { id: 't7', date: '2025-02-15', type: 'renewal', title: 'Data de Expiração / Renovação', status: 'upcoming', icon: CalendarClock },
];

// MOCK: Billing data
const mockBillingData = {
  planned: [
    { month: 'Jul/24', value: 70833 },
    { month: 'Aug/24', value: 70833 },
    { month: 'Sep/24', value: 70833 },
    { month: 'Oct/24', value: 70833 },
    { month: 'Nov/24', value: 70833 },
    { month: 'Dec/24', value: 70833 },
  ],
  actual: [
    { month: 'Jul/24', value: 70833 },
    { month: 'Aug/24', value: 68500 },
    { month: 'Sep/24', value: 72100 },
    { month: 'Oct/24', value: 70833 },
    { month: 'Nov/24', value: 65000 },
    { month: 'Dec/24', value: null }, // Not yet billed
  ],
  totalPlanned: 425000,
  totalActual: 347266,
  backlog: 502734,
  backlogTrend: [
    { month: 'Jul/24', value: 779167 },
    { month: 'Aug/24', value: 710667 },
    { month: 'Sep/24', value: 638567 },
    { month: 'Oct/24', value: 567734 },
    { month: 'Nov/24', value: 502734 },
  ],
};

// MOCK: Penalties and clauses
const mockPenaltiesClauses = [
  { 
    id: 'p1', 
    type: 'penalty',
    title: 'Multa por Atraso na Entrega', 
    trigger: 'Atraso > 5 dias úteis',
    impact: 'high',
    value: '2% do valor mensal por dia',
    status: 'active',
    mitigations: [
      { id: 'm1', text: 'Monitorar prazos semanalmente', done: true },
      { id: 'm2', text: 'Estabelecer buffer de 3 dias', done: true },
      { id: 'm3', text: 'Notificar fornecedor com 48h antecedência', done: false },
    ]
  },
  { 
    id: 'p2', 
    type: 'penalty',
    title: 'Multa por Descumprimento de SLA', 
    trigger: 'Disponibilidade < 99.5%',
    impact: 'high',
    value: 'R$ 5.000 por 0.1% abaixo',
    status: 'at_risk',
    mitigations: [
      { id: 'm4', text: 'Dashboard de monitoramento em tempo real', done: true },
      { id: 'm5', text: 'Alertas automáticos em 99.7%', done: false },
      { id: 'm6', text: 'Plano de contingência documentado', done: false },
    ]
  },
  { 
    id: 'p3', 
    type: 'clause',
    title: 'Cláusula de Rescisão Sem Justa Causa', 
    trigger: 'Notificação com 90 dias',
    impact: 'medium',
    value: 'Multa de 3 mensalidades',
    status: 'info',
    mitigations: []
  },
  { 
    id: 'p4', 
    type: 'clause',
    title: 'Cláusula de Reajuste Anual', 
    trigger: 'Aniversário do contrato',
    impact: 'medium',
    value: 'IGPM + 2%',
    status: 'upcoming',
    mitigations: [
      { id: 'm7', text: 'Negociar teto de reajuste', done: false },
      { id: 'm8', text: 'Provisionar orçamento', done: true },
    ]
  },
  { 
    id: 'p5', 
    type: 'penalty',
    title: 'Multa por Vazamento de Dados', 
    trigger: 'Incidente de segurança comprovado',
    impact: 'critical',
    value: 'Até R$ 50.000 + responsabilidade solidária',
    status: 'active',
    mitigations: [
      { id: 'm9', text: 'Auditoria de segurança trimestral', done: true },
      { id: 'm10', text: 'Certificação ISO 27001 do fornecedor', done: true },
      { id: 'm11', text: 'Cláusula de DPA assinada', done: true },
    ]
  },
];

// ============================================
// HELPER FUNCTIONS
// ============================================

function formatCurrency(value: number) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

function formatCurrencyCompact(value: number) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    notation: 'compact',
    minimumFractionDigits: 0,
    maximumFractionDigits: 1,
  }).format(value);
}

function getSeverityColor(severity: string) {
  switch (severity) {
    case 'critical': return 'text-[#FF5860] bg-[rgba(255,88,96,0.15)]';
    case 'high': return 'text-[#FF5860] bg-[rgba(255,88,96,0.15)]';
    case 'medium': return 'text-[#FFB04D] bg-[rgba(255,176,77,0.15)]';
    case 'low': return 'text-[#00FFB4] bg-[rgba(0,255,180,0.15)]';
    default: return 'text-[rgba(255,255,255,0.65)] bg-[rgba(255,255,255,0.08)]';
  }
}

function getStatusColor(status: string) {
  switch (status) {
    case 'completed': return 'text-[#00FFB4] border-[#00FFB4]';
    case 'upcoming': return 'text-[#00C8FF] border-[#00C8FF]';
    case 'at_risk': return 'text-[#FF5860] border-[#FF5860]';
    case 'open': return 'text-[#FFB04D] border-[#FFB04D]';
    case 'mitigated': return 'text-[#00FFB4] border-[#00FFB4]';
    case 'monitoring': return 'text-[#00C8FF] border-[#00C8FF]';
    case 'active': return 'text-[rgba(255,255,255,0.65)] border-[rgba(255,255,255,0.25)]';
    case 'info': return 'text-[#00C8FF] border-[#00C8FF]';
    default: return 'text-[rgba(255,255,255,0.65)] border-[rgba(255,255,255,0.25)]';
  }
}

// ============================================
// MAIN COMPONENT
// ============================================

export default function ContractIntelligencePage() {
  const params = useParams();
  const router = useRouter();
  const contractId = params.id as string;
  
  const [activeTab, setActiveTab] = useState('overview');

  // Find contract by ID (in real app, fetch from API)
  const contract = useMemo(() => {
    return mockContracts.find(c => c.id === contractId) || mockContracts[0];
  }, [contractId]);

  const daysUntilExpiration = contract.expirationDate 
    ? differenceInDays(new Date(contract.expirationDate), new Date())
    : null;

  // Calculate key metrics
  const keyMetrics = useMemo(() => ({
    totalRisks: mockRiskCategories.reduce((sum, cat) => sum + cat.count, 0),
    highRisks: mockRiskCategories.filter(c => c.severity === 'high').reduce((sum, cat) => sum + cat.count, 0),
    openPenalties: mockPenaltiesClauses.filter(p => p.status === 'at_risk' || p.status === 'active').length,
    upcomingEvents: mockTimelineEvents.filter(e => e.status === 'upcoming' || e.status === 'at_risk').length,
    billingVariance: ((mockBillingData.totalActual - mockBillingData.totalPlanned) / mockBillingData.totalPlanned * 100).toFixed(1),
  }), []);

  return (
    <OrionGreenBackground className="orion-page">
      <div className="orion-page-content max-w-[1800px] mx-auto space-y-4">
        {/* Header with Back Navigation */}
        <header className="mb-2">
          <div className="flex items-start justify-between">
            <div className="flex items-start gap-4">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => router.back()}
                className="text-[rgba(255,255,255,0.65)] hover:text-white hover:bg-[rgba(255,255,255,0.08)] -ml-2"
              >
                <ArrowLeft className="w-4 h-4 mr-1" />
                Voltar
              </Button>
              <div>
                <div className="flex items-center gap-3 mb-1">
                  <h1 className="text-2xl font-semibold text-white tracking-wide flex items-center gap-3">
                    <FileText className="w-6 h-6 text-[#00C8FF]" />
                    {contract.name}
                  </h1>
                </div>
                <div className="flex items-center gap-3">
                  <Badge variant="outline" className="text-xs bg-[rgba(255,255,255,0.05)] text-[rgba(255,255,255,0.65)] border-[rgba(255,255,255,0.12)]">
                    {contract.vendorOrParty}
                  </Badge>
                  <StatusPill 
                    variant={contract.riskClassification === 'high' ? 'critical' : contract.riskClassification === 'medium' ? 'warning' : 'active'}
                    className="text-[10px]"
                  >
                    Risco {contract.riskClassification === 'high' ? 'Alto' : contract.riskClassification === 'medium' ? 'Médio' : 'Baixo'}
                  </StatusPill>
                  <StatusPill 
                    variant={contract.status === 'expired' ? 'critical' : contract.status === 'expiring_soon' ? 'warning' : 'active'}
                    className="text-[10px]"
                  >
                    {contract.status === 'expired' ? 'Expirado' : contract.status === 'expiring_soon' ? 'Expirando' : 'Ativo'}
                  </StatusPill>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="border-[rgba(255,255,255,0.08)] text-[rgba(255,255,255,0.85)] hover:bg-[rgba(0,200,255,0.08)]"
              >
                <Download className="w-4 h-4 mr-1.5" />
                Download
              </Button>
              <Button
                className="bg-[#00FFB4] text-[#050D0A] hover:bg-[#00E6A0]"
              >
                <Zap className="w-4 h-4 mr-1.5" />
                AI Analysis
              </Button>
            </div>
          </div>
        </header>

        {/* Quick Stats Strip */}
        <div className="grid grid-cols-6 gap-3">
          <HUDCard className="p-3">
            <div className="flex items-center gap-2">
              <DollarSign className="w-4 h-4 text-[#00C8FF]" />
              <div>
                <p className="text-[10px] text-[rgba(255,255,255,0.50)] uppercase">Valor</p>
                <p className="text-sm font-semibold text-white">{formatCurrencyCompact(contract.value)}</p>
              </div>
            </div>
          </HUDCard>
          <HUDCard className="p-3">
            <div className="flex items-center gap-2">
              <Calendar className="w-4 h-4 text-amber-400" />
              <div>
                <p className="text-[10px] text-[rgba(255,255,255,0.50)] uppercase">Expira em</p>
                <p className={`text-sm font-semibold ${daysUntilExpiration && daysUntilExpiration < 30 ? 'text-amber-400' : 'text-white'}`}>
                  {daysUntilExpiration}d
                </p>
              </div>
            </div>
          </HUDCard>
          <HUDCard className="p-3">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-[#FF5860]" />
              <div>
                <p className="text-[10px] text-[rgba(255,255,255,0.50)] uppercase">Riscos</p>
                <p className="text-sm font-semibold text-white">{keyMetrics.totalRisks} ({keyMetrics.highRisks} altos)</p>
              </div>
            </div>
          </HUDCard>
          <HUDCard className="p-3">
            <div className="flex items-center gap-2">
              <Gavel className="w-4 h-4 text-amber-400" />
              <div>
                <p className="text-[10px] text-[rgba(255,255,255,0.50)] uppercase">Penalidades</p>
                <p className="text-sm font-semibold text-white">{keyMetrics.openPenalties} ativas</p>
              </div>
            </div>
          </HUDCard>
          <HUDCard className="p-3">
            <div className="flex items-center gap-2">
              <CalendarClock className="w-4 h-4 text-[#00C8FF]" />
              <div>
                <p className="text-[10px] text-[rgba(255,255,255,0.50)] uppercase">Eventos</p>
                <p className="text-sm font-semibold text-white">{keyMetrics.upcomingEvents} próximos</p>
              </div>
            </div>
          </HUDCard>
          <HUDCard className="p-3">
            <div className="flex items-center gap-2">
              <Receipt className="w-4 h-4 text-emerald-400" />
              <div>
                <p className="text-[10px] text-[rgba(255,255,255,0.50)] uppercase">Faturamento</p>
                <p className={`text-sm font-semibold ${parseFloat(keyMetrics.billingVariance) < 0 ? 'text-amber-400' : 'text-emerald-400'}`}>
                  {keyMetrics.billingVariance}%
                </p>
              </div>
            </div>
          </HUDCard>
        </div>

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.06)] p-1 h-auto">
            <TabsTrigger 
              value="overview" 
              className="data-[state=active]:bg-[#00FFB4] data-[state=active]:text-[#050D0A] text-[rgba(255,255,255,0.65)] px-4 py-2"
            >
              <Eye className="w-4 h-4 mr-2" />
              Overview
            </TabsTrigger>
            <TabsTrigger 
              value="riskmap" 
              className="data-[state=active]:bg-[#00FFB4] data-[state=active]:text-[#050D0A] text-[rgba(255,255,255,0.65)] px-4 py-2"
            >
              <Shield className="w-4 h-4 mr-2" />
              Risk Map
            </TabsTrigger>
            <TabsTrigger 
              value="timeline" 
              className="data-[state=active]:bg-[#00FFB4] data-[state=active]:text-[#050D0A] text-[rgba(255,255,255,0.65)] px-4 py-2"
            >
              <CalendarClock className="w-4 h-4 mr-2" />
              Timeline
            </TabsTrigger>
            <TabsTrigger 
              value="billing" 
              className="data-[state=active]:bg-[#00FFB4] data-[state=active]:text-[#050D0A] text-[rgba(255,255,255,0.65)] px-4 py-2"
            >
              <Receipt className="w-4 h-4 mr-2" />
              Billing
            </TabsTrigger>
            <TabsTrigger 
              value="penalties" 
              className="data-[state=active]:bg-[#00FFB4] data-[state=active]:text-[#050D0A] text-[rgba(255,255,255,0.65)] px-4 py-2"
            >
              <Gavel className="w-4 h-4 mr-2" />
              Penalties & Clauses
            </TabsTrigger>
          </TabsList>

          {/* Overview Tab */}
          <TabsContent value="overview" className="mt-4">
            <div className="grid grid-cols-3 gap-4">
              {/* Left: Contract Brief */}
              <div className="col-span-2 space-y-4">
                <HUDCard>
                  <h3 className="text-sm font-medium text-[rgba(255,255,255,0.85)] mb-4 flex items-center gap-2">
                    <FileText className="w-4 h-4 text-[#00C8FF]" />
                    Contract Brief
                  </h3>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-3">
                      <div>
                        <p className="text-[10px] text-[rgba(255,255,255,0.50)] uppercase mb-1">Fornecedor</p>
                        <p className="text-sm text-white">{contract.vendorOrParty}</p>
                      </div>
                      <div>
                        <p className="text-[10px] text-[rgba(255,255,255,0.50)] uppercase mb-1">Valor do Contrato</p>
                        <p className="text-lg font-semibold text-white">{formatCurrency(contract.value)}</p>
                      </div>
                      <div>
                        <p className="text-[10px] text-[rgba(255,255,255,0.50)] uppercase mb-1">Responsável</p>
                        <p className="text-sm text-white">{contract.responsibleName || 'Não definido'}</p>
                      </div>
                    </div>
                    <div className="space-y-3">
                      <div>
                        <p className="text-[10px] text-[rgba(255,255,255,0.50)] uppercase mb-1">Data de Assinatura</p>
                        <p className="text-sm text-white">
                          {contract.signingDate ? format(new Date(contract.signingDate), 'dd/MM/yyyy', { locale: pt }) : '—'}
                        </p>
                      </div>
                      <div>
                        <p className="text-[10px] text-[rgba(255,255,255,0.50)] uppercase mb-1">Data de Expiração</p>
                        <p className="text-sm text-white">
                          {contract.expirationDate ? format(new Date(contract.expirationDate), 'dd/MM/yyyy', { locale: pt }) : '—'}
                        </p>
                      </div>
                      <div>
                        <p className="text-[10px] text-[rgba(255,255,255,0.50)] uppercase mb-1">Dias Restantes</p>
                        <p className={`text-lg font-semibold ${
                          daysUntilExpiration && daysUntilExpiration < 0 ? 'text-[#FF5860]' :
                          daysUntilExpiration && daysUntilExpiration < 30 ? 'text-amber-400' :
                          'text-[#00FFB4]'
                        }`}>
                          {daysUntilExpiration}
                        </p>
                      </div>
                    </div>
                  </div>
                  {contract.notes && (
                    <div className="mt-4 pt-4 border-t border-[rgba(255,255,255,0.06)]">
                      <p className="text-[10px] text-[rgba(255,255,255,0.50)] uppercase mb-1">Observações</p>
                      <p className="text-sm text-[rgba(255,255,255,0.75)]">{contract.notes}</p>
                    </div>
                  )}
                </HUDCard>

                {/* Key Numbers */}
                <HUDCard>
                  <h3 className="text-sm font-medium text-[rgba(255,255,255,0.85)] mb-4 flex items-center gap-2">
                    <BarChart3 className="w-4 h-4 text-[#00C8FF]" />
                    Key Numbers
                    <Badge variant="outline" className="ml-2 text-[9px] bg-[rgba(255,176,77,0.15)] text-amber-400 border-amber-400/30">
                      MOCK DATA
                    </Badge>
                  </h3>
                  <div className="grid grid-cols-4 gap-4">
                    <div className="p-3 bg-[rgba(255,255,255,0.02)] rounded-lg border border-[rgba(255,255,255,0.05)]">
                      <p className="text-[10px] text-[rgba(255,255,255,0.50)] uppercase mb-1">Faturado YTD</p>
                      <p className="text-lg font-semibold text-emerald-400">{formatCurrencyCompact(mockBillingData.totalActual)}</p>
                    </div>
                    <div className="p-3 bg-[rgba(255,255,255,0.02)] rounded-lg border border-[rgba(255,255,255,0.05)]">
                      <p className="text-[10px] text-[rgba(255,255,255,0.50)] uppercase mb-1">Backlog</p>
                      <p className="text-lg font-semibold text-amber-400">{formatCurrencyCompact(mockBillingData.backlog)}</p>
                    </div>
                    <div className="p-3 bg-[rgba(255,255,255,0.02)] rounded-lg border border-[rgba(255,255,255,0.05)]">
                      <p className="text-[10px] text-[rgba(255,255,255,0.50)] uppercase mb-1">Variação</p>
                      <p className={`text-lg font-semibold ${parseFloat(keyMetrics.billingVariance) < 0 ? 'text-amber-400' : 'text-emerald-400'}`}>
                        {keyMetrics.billingVariance}%
                      </p>
                    </div>
                    <div className="p-3 bg-[rgba(255,255,255,0.02)] rounded-lg border border-[rgba(255,255,255,0.05)]">
                      <p className="text-[10px] text-[rgba(255,255,255,0.50)] uppercase mb-1">Execução</p>
                      <p className="text-lg font-semibold text-[#00C8FF]">
                        {Math.round((mockBillingData.totalActual / contract.value) * 100)}%
                      </p>
                    </div>
                  </div>
                </HUDCard>
              </div>

              {/* Right: Key Risks */}
              <div className="space-y-4">
                <HUDCard>
                  <h3 className="text-sm font-medium text-[rgba(255,255,255,0.85)] mb-4 flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-[#FF5860]" />
                    Key Risks
                    <Badge variant="outline" className="ml-2 text-[9px] bg-[rgba(255,176,77,0.15)] text-amber-400 border-amber-400/30">
                      MOCK DATA
                    </Badge>
                  </h3>
                  <div className="space-y-3">
                    {mockRiskCategories.slice(0, 3).flatMap(cat => 
                      cat.items.filter(item => item.impact === 'high').slice(0, 1)
                    ).map((risk, idx) => (
                      <div key={risk.id} className="p-3 bg-[rgba(255,255,255,0.02)] rounded-lg border border-[rgba(255,255,255,0.05)]">
                        <div className="flex items-start justify-between gap-2 mb-2">
                          <p className="text-sm text-white">{risk.title}</p>
                          <StatusPill 
                            variant={risk.status === 'open' ? 'warning' : risk.status === 'mitigated' ? 'active' : 'info'}
                            className="text-[9px] shrink-0"
                          >
                            {risk.status === 'open' ? 'Aberto' : risk.status === 'mitigated' ? 'Mitigado' : 'Monitorando'}
                          </StatusPill>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className={`text-[10px] px-1.5 py-0.5 rounded ${getSeverityColor(risk.impact)}`}>
                            Impacto {risk.impact === 'high' ? 'Alto' : risk.impact === 'medium' ? 'Médio' : 'Baixo'}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full mt-4 border-[rgba(255,255,255,0.08)] text-[rgba(255,255,255,0.65)]"
                    onClick={() => setActiveTab('riskmap')}
                  >
                    Ver todos os riscos
                  </Button>
                </HUDCard>

                {/* Upcoming Events */}
                <HUDCard>
                  <h3 className="text-sm font-medium text-[rgba(255,255,255,0.85)] mb-4 flex items-center gap-2">
                    <CalendarClock className="w-4 h-4 text-[#00C8FF]" />
                    Próximos Eventos
                  </h3>
                  <div className="space-y-2">
                    {mockTimelineEvents.filter(e => e.status === 'upcoming' || e.status === 'at_risk').slice(0, 3).map(event => (
                      <div key={event.id} className="flex items-center gap-3 p-2 bg-[rgba(255,255,255,0.02)] rounded-lg">
                        <div className={`p-1.5 rounded ${getStatusColor(event.status).replace('text-', 'bg-').replace('border-', '').split(' ')[0]}/20`}>
                          <event.icon className={`w-3.5 h-3.5 ${getStatusColor(event.status).split(' ')[0]}`} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs text-white truncate">{event.title}</p>
                          <p className="text-[10px] text-[rgba(255,255,255,0.50)]">{event.date}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </HUDCard>
              </div>
            </div>
          </TabsContent>

          {/* Risk Map Tab */}
          <TabsContent value="riskmap" className="mt-4">
            <div className="grid grid-cols-3 gap-4">
              {/* Risk Categories Heatmap */}
              <div className="col-span-2">
                <HUDCard>
                  <h3 className="text-sm font-medium text-[rgba(255,255,255,0.85)] mb-4 flex items-center gap-2">
                    <Shield className="w-4 h-4 text-[#00C8FF]" />
                    Risk Heatmap by Category
                    <Badge variant="outline" className="ml-2 text-[9px] bg-[rgba(255,176,77,0.15)] text-amber-400 border-amber-400/30">
                      MOCK DATA
                    </Badge>
                  </h3>
                  <div className="grid grid-cols-5 gap-3">
                    {mockRiskCategories.map(category => {
                      const CategoryIcon = category.icon;
                      return (
                        <div 
                          key={category.id}
                          className={`p-4 rounded-lg border cursor-pointer transition-all hover:scale-[1.02] ${
                            category.severity === 'high' 
                              ? 'bg-[rgba(255,88,96,0.08)] border-[rgba(255,88,96,0.25)]' 
                              : category.severity === 'medium'
                              ? 'bg-[rgba(255,176,77,0.08)] border-[rgba(255,176,77,0.25)]'
                              : 'bg-[rgba(0,255,180,0.08)] border-[rgba(0,255,180,0.25)]'
                          }`}
                        >
                          <div className="flex items-center gap-2 mb-2">
                            <CategoryIcon className={`w-5 h-5 ${
                              category.severity === 'high' ? 'text-[#FF5860]' :
                              category.severity === 'medium' ? 'text-amber-400' :
                              'text-[#00FFB4]'
                            }`} />
                            <span className="text-xs font-medium text-white">{category.name}</span>
                          </div>
                          <p className={`text-2xl font-bold ${
                            category.severity === 'high' ? 'text-[#FF5860]' :
                            category.severity === 'medium' ? 'text-amber-400' :
                            'text-[#00FFB4]'
                          }`}>
                            {category.count}
                          </p>
                          <p className="text-[10px] text-[rgba(255,255,255,0.50)]">
                            {category.severity === 'high' ? 'Crítico' : category.severity === 'medium' ? 'Moderado' : 'Baixo'}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                </HUDCard>

                {/* Risk Details */}
                <HUDCard className="mt-4">
                  <h3 className="text-sm font-medium text-[rgba(255,255,255,0.85)] mb-4">Risk Details</h3>
                  <div className="space-y-2 max-h-[400px] overflow-y-auto">
                    {mockRiskCategories.flatMap(cat => 
                      cat.items.map(item => ({
                        ...item,
                        category: cat.name,
                        categoryIcon: cat.icon,
                      }))
                    ).map(risk => (
                      <div key={risk.id} className="p-3 bg-[rgba(255,255,255,0.02)] rounded-lg border border-[rgba(255,255,255,0.05)] hover:border-[rgba(255,255,255,0.10)] transition-colors">
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex items-start gap-3">
                            <risk.categoryIcon className="w-4 h-4 text-[rgba(255,255,255,0.50)] mt-0.5 shrink-0" />
                            <div>
                              <p className="text-sm text-white mb-1">{risk.title}</p>
                              <div className="flex items-center gap-2">
                                <Badge variant="outline" className="text-[9px] bg-transparent">{risk.category}</Badge>
                                <span className={`text-[9px] px-1.5 py-0.5 rounded ${getSeverityColor(risk.impact)}`}>
                                  {risk.impact === 'high' ? 'Alto' : risk.impact === 'medium' ? 'Médio' : 'Baixo'}
                                </span>
                                <span className={`text-[9px] px-1.5 py-0.5 rounded border ${getStatusColor(risk.status)}`}>
                                  {risk.status === 'open' ? 'Aberto' : risk.status === 'mitigated' ? 'Mitigado' : 'Monitorando'}
                                </span>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </HUDCard>
              </div>

              {/* Risk Summary */}
              <div className="space-y-4">
                <HUDCard>
                  <h3 className="text-sm font-medium text-[rgba(255,255,255,0.85)] mb-4">Risk Summary</h3>
                  <div className="space-y-3">
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-[rgba(255,255,255,0.65)]">Total Risks</span>
                      <span className="text-sm font-semibold text-white">{keyMetrics.totalRisks}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-[rgba(255,255,255,0.65)]">High Impact</span>
                      <span className="text-sm font-semibold text-[#FF5860]">{keyMetrics.highRisks}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-[rgba(255,255,255,0.65)]">Open</span>
                      <span className="text-sm font-semibold text-amber-400">
                        {mockRiskCategories.flatMap(c => c.items).filter(r => r.status === 'open').length}
                      </span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-[rgba(255,255,255,0.65)]">Mitigated</span>
                      <span className="text-sm font-semibold text-[#00FFB4]">
                        {mockRiskCategories.flatMap(c => c.items).filter(r => r.status === 'mitigated').length}
                      </span>
                    </div>
                  </div>
                </HUDCard>

                <HUDCard>
                  <h3 className="text-sm font-medium text-[rgba(255,255,255,0.85)] mb-4">Risk Score</h3>
                  <div className="text-center py-4">
                    <div className="inline-flex items-center justify-center w-24 h-24 rounded-full bg-[rgba(255,88,96,0.15)] border-4 border-[#FF5860]">
                      <span className="text-3xl font-bold text-[#FF5860]">72</span>
                    </div>
                    <p className="text-sm text-[rgba(255,255,255,0.65)] mt-3">High Risk</p>
                    <p className="text-xs text-[rgba(255,255,255,0.40)]">Score 0-100</p>
                  </div>
                </HUDCard>
              </div>
            </div>
          </TabsContent>

          {/* Timeline Tab */}
          <TabsContent value="timeline" className="mt-4">
            <HUDCard>
              <h3 className="text-sm font-medium text-[rgba(255,255,255,0.85)] mb-4 flex items-center gap-2">
                <CalendarClock className="w-4 h-4 text-[#00C8FF]" />
                Contract Timeline / Eventogram
                <Badge variant="outline" className="ml-2 text-[9px] bg-[rgba(255,176,77,0.15)] text-amber-400 border-amber-400/30">
                  MOCK DATA
                </Badge>
              </h3>
              <div className="relative">
                {/* Timeline Line */}
                <div className="absolute left-6 top-0 bottom-0 w-0.5 bg-[rgba(255,255,255,0.08)]" />
                
                <div className="space-y-4">
                  {mockTimelineEvents.map((event, idx) => {
                    const EventIcon = event.icon;
                    return (
                      <div key={event.id} className="relative flex items-start gap-4 pl-2">
                        {/* Timeline Node */}
                        <div className={`relative z-10 p-2 rounded-full border-2 ${getStatusColor(event.status)} bg-[#07130F]`}>
                          <EventIcon className={`w-4 h-4 ${getStatusColor(event.status).split(' ')[0]}`} />
                        </div>
                        
                        {/* Event Content */}
                        <div className={`flex-1 p-4 rounded-lg border transition-all ${
                          event.status === 'completed' 
                            ? 'bg-[rgba(255,255,255,0.02)] border-[rgba(255,255,255,0.05)]'
                            : event.status === 'at_risk'
                            ? 'bg-[rgba(255,88,96,0.05)] border-[rgba(255,88,96,0.20)]'
                            : 'bg-[rgba(0,200,255,0.05)] border-[rgba(0,200,255,0.20)]'
                        }`}>
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="text-sm font-medium text-white mb-1">{event.title}</p>
                              <div className="flex items-center gap-2">
                                <Badge variant="outline" className={`text-[9px] border ${getStatusColor(event.status)}`}>
                                  {event.type === 'milestone' ? 'Milestone' :
                                   event.type === 'renewal' ? 'Renewal' :
                                   event.type === 'deadline' ? 'Deadline' :
                                   event.type === 'adjustment' ? 'Adjustment' :
                                   'Penalty Trigger'}
                                </Badge>
                                <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                                  event.status === 'completed' ? 'bg-[rgba(0,255,180,0.15)] text-[#00FFB4]' :
                                  event.status === 'at_risk' ? 'bg-[rgba(255,88,96,0.15)] text-[#FF5860]' :
                                  'bg-[rgba(0,200,255,0.15)] text-[#00C8FF]'
                                }`}>
                                  {event.status === 'completed' ? 'Concluído' :
                                   event.status === 'at_risk' ? 'Em Risco' : 'Próximo'}
                                </span>
                              </div>
                            </div>
                            <span className="text-xs text-[rgba(255,255,255,0.50)] tabular-nums shrink-0">
                              {event.date}
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </HUDCard>
          </TabsContent>

          {/* Billing Tab */}
          <TabsContent value="billing" className="mt-4">
            <div className="grid grid-cols-3 gap-4">
              <div className="col-span-2 space-y-4">
                {/* Planned vs Actual */}
                <HUDCard>
                  <h3 className="text-sm font-medium text-[rgba(255,255,255,0.85)] mb-4 flex items-center gap-2">
                    <Receipt className="w-4 h-4 text-[#00C8FF]" />
                    Planned vs Actual Billing
                    <Badge variant="outline" className="ml-2 text-[9px] bg-[rgba(255,176,77,0.15)] text-amber-400 border-amber-400/30">
                      MOCK DATA
                    </Badge>
                  </h3>
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow className="border-[rgba(255,255,255,0.05)]">
                          <TableHead className="text-[rgba(255,255,255,0.65)]">Mês</TableHead>
                          <TableHead className="text-[rgba(255,255,255,0.65)] text-right">Planejado</TableHead>
                          <TableHead className="text-[rgba(255,255,255,0.65)] text-right">Realizado</TableHead>
                          <TableHead className="text-[rgba(255,255,255,0.65)] text-right">Variação</TableHead>
                          <TableHead className="text-[rgba(255,255,255,0.65)] text-right">Status</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {mockBillingData.planned.map((planned, idx) => {
                          const actual = mockBillingData.actual[idx];
                          const variance = actual.value !== null 
                            ? ((actual.value - planned.value) / planned.value * 100).toFixed(1)
                            : null;
                          return (
                            <TableRow key={planned.month} className="border-[rgba(255,255,255,0.05)]">
                              <TableCell className="text-white">{planned.month}</TableCell>
                              <TableCell className="text-[rgba(255,255,255,0.85)] text-right tabular-nums">
                                {formatCurrency(planned.value)}
                              </TableCell>
                              <TableCell className="text-right tabular-nums">
                                {actual.value !== null ? (
                                  <span className="text-white">{formatCurrency(actual.value)}</span>
                                ) : (
                                  <span className="text-[rgba(255,255,255,0.40)]">—</span>
                                )}
                              </TableCell>
                              <TableCell className="text-right tabular-nums">
                                {variance !== null ? (
                                  <span className={parseFloat(variance) >= 0 ? 'text-emerald-400' : 'text-amber-400'}>
                                    {parseFloat(variance) >= 0 ? '+' : ''}{variance}%
                                  </span>
                                ) : (
                                  <span className="text-[rgba(255,255,255,0.40)]">—</span>
                                )}
                              </TableCell>
                              <TableCell className="text-right">
                                {actual.value !== null ? (
                                  <CheckCircle className="w-4 h-4 text-[#00FFB4] inline" />
                                ) : (
                                  <Clock className="w-4 h-4 text-[rgba(255,255,255,0.40)] inline" />
                                )}
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                </HUDCard>

                {/* Backlog Trend */}
                <HUDCard>
                  <h3 className="text-sm font-medium text-[rgba(255,255,255,0.85)] mb-4 flex items-center gap-2">
                    <TrendingDown className="w-4 h-4 text-amber-400" />
                    Backlog Trend
                  </h3>
                  <div className="flex items-end gap-2 h-32">
                    {mockBillingData.backlogTrend.map((item, idx) => {
                      const maxValue = Math.max(...mockBillingData.backlogTrend.map(i => i.value));
                      const height = (item.value / maxValue) * 100;
                      return (
                        <div key={item.month} className="flex-1 flex flex-col items-center gap-1">
                          <div 
                            className="w-full bg-gradient-to-t from-amber-500/30 to-amber-500/10 rounded-t border-t-2 border-amber-400"
                            style={{ height: `${height}%` }}
                          />
                          <span className="text-[10px] text-[rgba(255,255,255,0.50)]">{item.month.split('/')[0]}</span>
                        </div>
                      );
                    })}
                  </div>
                </HUDCard>
              </div>

              {/* Billing Summary */}
              <div className="space-y-4">
                <HUDCard>
                  <h3 className="text-sm font-medium text-[rgba(255,255,255,0.85)] mb-4">Billing Summary</h3>
                  <div className="space-y-4">
                    <div className="p-3 bg-[rgba(255,255,255,0.02)] rounded-lg border border-[rgba(255,255,255,0.05)]">
                      <p className="text-[10px] text-[rgba(255,255,255,0.50)] uppercase mb-1">Total Planejado YTD</p>
                      <p className="text-lg font-semibold text-white">{formatCurrency(mockBillingData.totalPlanned)}</p>
                    </div>
                    <div className="p-3 bg-[rgba(255,255,255,0.02)] rounded-lg border border-[rgba(255,255,255,0.05)]">
                      <p className="text-[10px] text-[rgba(255,255,255,0.50)] uppercase mb-1">Total Realizado YTD</p>
                      <p className="text-lg font-semibold text-emerald-400">{formatCurrency(mockBillingData.totalActual)}</p>
                    </div>
                    <div className="p-3 bg-[rgba(255,255,255,0.02)] rounded-lg border border-[rgba(255,255,255,0.05)]">
                      <p className="text-[10px] text-[rgba(255,255,255,0.50)] uppercase mb-1">Backlog Atual</p>
                      <p className="text-lg font-semibold text-amber-400">{formatCurrency(mockBillingData.backlog)}</p>
                    </div>
                    <div className="p-3 bg-[rgba(255,255,255,0.02)] rounded-lg border border-[rgba(255,255,255,0.05)]">
                      <p className="text-[10px] text-[rgba(255,255,255,0.50)] uppercase mb-1">% Execução</p>
                      <HUDProgressBar 
                        value={Math.round((mockBillingData.totalActual / contract.value) * 100)} 
                        variant="active"
                        className="mt-2"
                      />
                    </div>
                  </div>
                </HUDCard>
              </div>
            </div>
          </TabsContent>

          {/* Penalties & Clauses Tab */}
          <TabsContent value="penalties" className="mt-4">
            <div className="grid grid-cols-3 gap-4">
              <div className="col-span-2">
                <HUDCard>
                  <h3 className="text-sm font-medium text-[rgba(255,255,255,0.85)] mb-4 flex items-center gap-2">
                    <Gavel className="w-4 h-4 text-[#00C8FF]" />
                    Penalties & High Impact Clauses
                    <Badge variant="outline" className="ml-2 text-[9px] bg-[rgba(255,176,77,0.15)] text-amber-400 border-amber-400/30">
                      MOCK DATA
                    </Badge>
                  </h3>
                  <div className="space-y-4">
                    {mockPenaltiesClauses.map(item => (
                      <div 
                        key={item.id} 
                        className={`p-4 rounded-lg border ${
                          item.status === 'at_risk' 
                            ? 'bg-[rgba(255,88,96,0.05)] border-[rgba(255,88,96,0.20)]'
                            : item.status === 'upcoming'
                            ? 'bg-[rgba(255,176,77,0.05)] border-[rgba(255,176,77,0.20)]'
                            : 'bg-[rgba(255,255,255,0.02)] border-[rgba(255,255,255,0.05)]'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-3 mb-3">
                          <div className="flex items-start gap-3">
                            {item.type === 'penalty' ? (
                              <AlertTriangle className={`w-5 h-5 shrink-0 ${
                                item.impact === 'critical' ? 'text-[#FF5860]' :
                                item.impact === 'high' ? 'text-amber-400' :
                                'text-[rgba(255,255,255,0.50)]'
                              }`} />
                            ) : (
                              <FileWarning className="w-5 h-5 text-[#00C8FF] shrink-0" />
                            )}
                            <div>
                              <p className="text-sm font-medium text-white mb-1">{item.title}</p>
                              <div className="flex items-center gap-2 flex-wrap">
                                <Badge variant="outline" className={`text-[9px] ${
                                  item.type === 'penalty' ? 'text-[#FF5860] border-[#FF5860]/30' : 'text-[#00C8FF] border-[#00C8FF]/30'
                                }`}>
                                  {item.type === 'penalty' ? 'Penalidade' : 'Cláusula'}
                                </Badge>
                                <span className={`text-[9px] px-1.5 py-0.5 rounded ${getSeverityColor(item.impact)}`}>
                                  {item.impact === 'critical' ? 'Crítico' : item.impact === 'high' ? 'Alto' : 'Médio'}
                                </span>
                                <span className={`text-[9px] px-1.5 py-0.5 rounded border ${getStatusColor(item.status)}`}>
                                  {item.status === 'at_risk' ? 'Em Risco' : 
                                   item.status === 'active' ? 'Ativo' :
                                   item.status === 'upcoming' ? 'Próximo' : 'Info'}
                                </span>
                              </div>
                            </div>
                          </div>
                        </div>
                        
                        <div className="grid grid-cols-2 gap-4 text-xs mb-3 pl-8">
                          <div>
                            <span className="text-[rgba(255,255,255,0.50)]">Gatilho: </span>
                            <span className="text-white">{item.trigger}</span>
                          </div>
                          <div>
                            <span className="text-[rgba(255,255,255,0.50)]">Valor: </span>
                            <span className="text-white">{item.value}</span>
                          </div>
                        </div>

                        {/* Mitigation Checklist */}
                        {item.mitigations.length > 0 && (
                          <div className="pl-8 pt-3 border-t border-[rgba(255,255,255,0.05)]">
                            <p className="text-[10px] text-[rgba(255,255,255,0.50)] uppercase mb-2 flex items-center gap-1">
                              <ClipboardCheck className="w-3 h-3" />
                              Checklist de Mitigação
                            </p>
                            <div className="space-y-1.5">
                              {item.mitigations.map(m => (
                                <div key={m.id} className="flex items-center gap-2">
                                  {m.done ? (
                                    <CheckCircle className="w-3.5 h-3.5 text-[#00FFB4]" />
                                  ) : (
                                    <div className="w-3.5 h-3.5 rounded-full border border-[rgba(255,255,255,0.25)]" />
                                  )}
                                  <span className={`text-xs ${m.done ? 'text-[rgba(255,255,255,0.50)] line-through' : 'text-white'}`}>
                                    {m.text}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </HUDCard>
              </div>

              {/* Penalties Summary */}
              <div className="space-y-4">
                <HUDCard>
                  <h3 className="text-sm font-medium text-[rgba(255,255,255,0.85)] mb-4">Summary</h3>
                  <div className="space-y-3">
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-[rgba(255,255,255,0.65)]">Total Items</span>
                      <span className="text-sm font-semibold text-white">{mockPenaltiesClauses.length}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-[rgba(255,255,255,0.65)]">Penalties</span>
                      <span className="text-sm font-semibold text-[#FF5860]">
                        {mockPenaltiesClauses.filter(p => p.type === 'penalty').length}
                      </span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-[rgba(255,255,255,0.65)]">Clauses</span>
                      <span className="text-sm font-semibold text-[#00C8FF]">
                        {mockPenaltiesClauses.filter(p => p.type === 'clause').length}
                      </span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-[rgba(255,255,255,0.65)]">At Risk</span>
                      <span className="text-sm font-semibold text-amber-400">
                        {mockPenaltiesClauses.filter(p => p.status === 'at_risk').length}
                      </span>
                    </div>
                  </div>
                </HUDCard>

                <HUDCard>
                  <h3 className="text-sm font-medium text-[rgba(255,255,255,0.85)] mb-4">Mitigation Progress</h3>
                  <div className="space-y-3">
                    {(() => {
                      const totalMitigations = mockPenaltiesClauses.flatMap(p => p.mitigations).length;
                      const completedMitigations = mockPenaltiesClauses.flatMap(p => p.mitigations).filter(m => m.done).length;
                      const percentage = totalMitigations > 0 ? Math.round((completedMitigations / totalMitigations) * 100) : 0;
                      return (
                        <>
                          <div className="flex justify-between items-center">
                            <span className="text-sm text-[rgba(255,255,255,0.65)]">Completed</span>
                            <span className="text-sm font-semibold text-white">{completedMitigations}/{totalMitigations}</span>
                          </div>
                          <HUDProgressBar value={percentage} variant={percentage >= 70 ? 'completed' : percentage >= 40 ? 'active' : 'critical'} />
                        </>
                      );
                    })()}
                  </div>
                </HUDCard>
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </OrionGreenBackground>
  );
}
