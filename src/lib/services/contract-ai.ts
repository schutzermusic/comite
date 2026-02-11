/**
 * Contract AI Analysis Service
 * 
 * Service interface for AI-powered contract analysis.
 * Currently uses mock data - replace with actual LLM integration when available.
 * 
 * @example
 * // Analyze a contract
 * const analysis = await analyzeContract('contract-1');
 * 
 * // Ask a question about a contract
 * const answer = await askContract('contract-1', 'What are the payment terms?');
 */

// ============================================
// TYPE DEFINITIONS
// ============================================

export type RiskSeverity = 'critical' | 'high' | 'medium' | 'low';
export type ActionPriority = 'urgent' | 'high' | 'medium' | 'low';
export type ComplianceStatus = 'gap' | 'partial' | 'compliant';
export type CheckpointStatus = 'completed' | 'upcoming' | 'overdue' | 'at_risk';

export interface RiskDriver {
  id: string;
  title: string;
  description: string;
  severity: RiskSeverity;
  category: 'legal' | 'financial' | 'operational' | 'compliance' | 'sla';
  impact: string;
}

export interface RecommendedAction {
  id: string;
  title: string;
  description: string;
  priority: ActionPriority;
  dueDate: Date;
  assignee?: string;
  category: string;
}

export interface ComplianceGap {
  id: string;
  regulation: string;
  requirement: string;
  status: ComplianceStatus;
  gap: string;
  recommendation: string;
}

export interface TimelineCheckpoint {
  id: string;
  title: string;
  date: Date;
  status: CheckpointStatus;
  description: string;
  type: 'milestone' | 'deadline' | 'renewal' | 'review' | 'payment';
}

export interface ContractAnalysisResult {
  contractId: string;
  analyzedAt: Date;
  riskDrivers: RiskDriver[];
  recommendedActions: RecommendedAction[];
  financialExposureNotes: string[];
  complianceGaps: ComplianceGap[];
  timelineCheckpoints: TimelineCheckpoint[];
  summary: string;
  overallRiskScore: number; // 0-100
}

export interface ContractQuestionResult {
  id: string;
  contractId: string;
  question: string;
  answer: string;
  sources: string[];
  answeredAt: Date;
  confidence: number; // 0-100
}

// ============================================
// MOCK DATA GENERATORS
// ============================================

// MOCK: Simulated delay to mimic API call
const simulateDelay = (ms: number = 1500) => 
  new Promise(resolve => setTimeout(resolve, ms));

// MOCK: Generate risk drivers based on contract
function generateMockRiskDrivers(contractId: string): RiskDriver[] {
  return [
    {
      id: `${contractId}-risk-1`,
      title: 'Cláusula de Rescisão Ambígua',
      description: 'A cláusula 12.3 não define claramente as condições de rescisão unilateral, criando potencial exposição legal.',
      severity: 'high',
      category: 'legal',
      impact: 'Pode resultar em litígios custosos em caso de término antecipado.',
    },
    {
      id: `${contractId}-risk-2`,
      title: 'Reajuste Vinculado ao IGPM',
      description: 'Índice de reajuste (IGPM) historicamente mais volátil que IPCA, podendo gerar custos acima do mercado.',
      severity: 'medium',
      category: 'financial',
      impact: 'Exposição estimada de 15-25% acima da inflação em cenários adversos.',
    },
    {
      id: `${contractId}-risk-3`,
      title: 'SLA Sem Penalidades Claras',
      description: 'Níveis de serviço definidos sem métricas de penalidade proporcionais, reduzindo poder de enforcement.',
      severity: 'high',
      category: 'sla',
      impact: 'Fornecedor sem incentivo financeiro para manter qualidade de serviço.',
    },
    {
      id: `${contractId}-risk-4`,
      title: 'Dependência de Fornecedor Único',
      description: 'Contrato não prevê alternativas ou cláusulas de transição, criando lock-in operacional.',
      severity: 'medium',
      category: 'operational',
      impact: 'Custo de troca estimado em 6-12 meses de operação + custos de migração.',
    },
    {
      id: `${contractId}-risk-5`,
      title: 'Conformidade LGPD Parcial',
      description: 'Cláusulas de proteção de dados não contemplam todos os requisitos do Art. 46 da LGPD.',
      severity: 'critical',
      category: 'compliance',
      impact: 'Multas potenciais de até 2% do faturamento + danos reputacionais.',
    },
  ];
}

// MOCK: Generate recommended actions
function generateMockActions(contractId: string): RecommendedAction[] {
  const today = new Date();
  return [
    {
      id: `${contractId}-action-1`,
      title: 'Revisar cláusula de rescisão',
      description: 'Solicitar aditivo com termos claros de rescisão unilateral e respectivas multas.',
      priority: 'urgent',
      dueDate: new Date(today.getTime() + 3 * 24 * 60 * 60 * 1000), // +3 days
      assignee: 'Jurídico',
      category: 'Legal',
    },
    {
      id: `${contractId}-action-2`,
      title: 'Negociar índice de reajuste',
      description: 'Propor alteração de IGPM para IPCA ou índice composto com teto.',
      priority: 'high',
      dueDate: new Date(today.getTime() + 5 * 24 * 60 * 60 * 1000), // +5 days
      assignee: 'Procurement',
      category: 'Financeiro',
    },
    {
      id: `${contractId}-action-3`,
      title: 'Definir penalidades de SLA',
      description: 'Elaborar tabela de penalidades proporcionais ao impacto de cada nível de serviço.',
      priority: 'high',
      dueDate: new Date(today.getTime() + 5 * 24 * 60 * 60 * 1000), // +5 days
      assignee: 'Operações',
      category: 'Operacional',
    },
    {
      id: `${contractId}-action-4`,
      title: 'Atualizar DPA (Data Processing Agreement)',
      description: 'Incluir cláusulas específicas de LGPD conforme checklist regulatório.',
      priority: 'urgent',
      dueDate: new Date(today.getTime() + 2 * 24 * 60 * 60 * 1000), // +2 days
      assignee: 'Compliance',
      category: 'Compliance',
    },
    {
      id: `${contractId}-action-5`,
      title: 'Mapear fornecedores alternativos',
      description: 'Identificar 2-3 alternativas de mercado para reduzir dependência.',
      priority: 'medium',
      dueDate: new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000), // +7 days
      assignee: 'Procurement',
      category: 'Estratégico',
    },
  ];
}

// MOCK: Generate financial exposure notes
function generateMockFinancialNotes(contractId: string): string[] {
  return [
    'Exposição máxima em caso de rescisão antecipada: R$ 127.500 (3 mensalidades)',
    'Reajuste projetado para próximo ciclo: 8.2% (IGPM acumulado)',
    'Multas potenciais por descumprimento de SLA: até R$ 42.500/mês',
    'Custo de não-conformidade LGPD: até R$ 1.7M (2% faturamento estimado)',
    'Economia potencial com renegociação de índice: R$ 85.000/ano',
  ];
}

// MOCK: Generate compliance gaps
function generateMockComplianceGaps(contractId: string): ComplianceGap[] {
  return [
    {
      id: `${contractId}-compliance-1`,
      regulation: 'LGPD - Lei 13.709/2018',
      requirement: 'Cláusula de proteção de dados pessoais (Art. 46)',
      status: 'gap',
      gap: 'Ausência de definição de responsabilidades em caso de incidente de segurança.',
      recommendation: 'Incluir DPA com responsabilidades explícitas e prazos de notificação.',
    },
    {
      id: `${contractId}-compliance-2`,
      regulation: 'SOX - Sarbanes-Oxley',
      requirement: 'Controles de acesso e segregação de funções',
      status: 'partial',
      gap: 'Controles de acesso definidos, mas sem auditoria periódica prevista.',
      recommendation: 'Adicionar cláusula de auditoria anual obrigatória.',
    },
    {
      id: `${contractId}-compliance-3`,
      regulation: 'ISO 27001',
      requirement: 'Gestão de segurança da informação',
      status: 'compliant',
      gap: 'Certificação do fornecedor válida e cláusulas adequadas.',
      recommendation: 'Manter monitoramento de renovação de certificação.',
    },
  ];
}

// MOCK: Generate timeline checkpoints
function generateMockCheckpoints(contractId: string): TimelineCheckpoint[] {
  const today = new Date();
  return [
    {
      id: `${contractId}-checkpoint-1`,
      title: 'Revisão de Performance Q1',
      date: new Date(today.getTime() + 15 * 24 * 60 * 60 * 1000), // +15 days
      status: 'upcoming',
      description: 'Avaliação trimestral de KPIs e SLAs acordados.',
      type: 'review',
    },
    {
      id: `${contractId}-checkpoint-2`,
      title: 'Vencimento de Garantia Bancária',
      date: new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000), // +30 days
      status: 'upcoming',
      description: 'Renovar garantia bancária antes do vencimento.',
      type: 'deadline',
    },
    {
      id: `${contractId}-checkpoint-3`,
      title: 'Data de Reajuste Anual',
      date: new Date(today.getTime() + 45 * 24 * 60 * 60 * 1000), // +45 days
      status: 'at_risk',
      description: 'Aplicação automática de reajuste pelo IGPM se não renegociado.',
      type: 'milestone',
    },
    {
      id: `${contractId}-checkpoint-4`,
      title: 'Prazo para Notificação de Não-Renovação',
      date: new Date(today.getTime() + 60 * 24 * 60 * 60 * 1000), // +60 days
      status: 'upcoming',
      description: 'Último dia para notificar intenção de não renovar (90 dias antes).',
      type: 'deadline',
    },
    {
      id: `${contractId}-checkpoint-5`,
      title: 'Pagamento Trimestral',
      date: new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000), // +7 days
      status: 'upcoming',
      description: 'Vencimento da próxima parcela trimestral.',
      type: 'payment',
    },
  ];
}

// MOCK: Generate Q&A responses
function generateMockAnswer(contractId: string, question: string): { answer: string; sources: string[]; confidence: number } {
  const questionLower = question.toLowerCase();
  
  // MOCK: Simple keyword matching for demo purposes
  if (questionLower.includes('pagamento') || questionLower.includes('payment')) {
    return {
      answer: 'O contrato prevê pagamentos trimestrais, com vencimento no dia 15 de cada trimestre. O valor base é de R$ 70.833,33/mês, totalizando R$ 212.500,00 por trimestre. Multa por atraso: 2% + juros de 1% ao mês.',
      sources: ['Cláusula 5.1 - Condições de Pagamento', 'Cláusula 5.3 - Penalidades por Atraso'],
      confidence: 92,
    };
  }
  
  if (questionLower.includes('rescisão') || questionLower.includes('cancelamento') || questionLower.includes('termination')) {
    return {
      answer: 'A rescisão pode ocorrer: (1) Por acordo mútuo, sem multa; (2) Unilateralmente com 90 dias de aviso prévio e multa de 3 mensalidades; (3) Por justa causa, mediante comprovação de descumprimento material, sem multa. Nota: A cláusula 12.3 apresenta ambiguidade sobre o que constitui "descumprimento material".',
      sources: ['Cláusula 12 - Rescisão Contratual', 'Cláusula 12.3 - Rescisão por Justa Causa'],
      confidence: 85,
    };
  }
  
  if (questionLower.includes('reajuste') || questionLower.includes('adjustment')) {
    return {
      answer: 'O reajuste é anual, aplicado na data de aniversário do contrato, pelo índice IGPM acumulado nos 12 meses anteriores. Não há teto de reajuste definido. Recomendação: Negociar alteração para IPCA ou estabelecer teto de 10% ao ano.',
      sources: ['Cláusula 6 - Reajuste', 'Anexo II - Índices Econômicos'],
      confidence: 95,
    };
  }
  
  if (questionLower.includes('sla') || questionLower.includes('nível de serviço')) {
    return {
      answer: 'SLAs definidos: (1) Disponibilidade: 99.5% mensal; (2) Tempo de resposta: 4h para incidentes críticos, 24h para médios; (3) Resolução: 8h críticos, 48h médios. Penalidades: Não há penalidades financeiras explícitas definidas, apenas "créditos de serviço" de valor não especificado.',
      sources: ['Anexo I - SLA', 'Cláusula 8 - Níveis de Serviço'],
      confidence: 88,
    };
  }
  
  // Default response for other questions
  return {
    answer: 'Com base na análise do contrato, não foi possível encontrar informações específicas sobre esta questão. Recomendo revisar as cláusulas principais ou consultar o departamento jurídico para esclarecimentos adicionais.',
    sources: ['Análise geral do contrato'],
    confidence: 45,
  };
}

// ============================================
// SERVICE FUNCTIONS
// ============================================

/**
 * Analyze a contract and return structured insights.
 * 
 * @param contractId - The ID of the contract to analyze
 * @returns Promise<ContractAnalysisResult> - Structured analysis results
 * 
 * @example
 * const analysis = await analyzeContract('contract-1');
 * console.log(analysis.riskDrivers); // Top 5 risk drivers
 */
export async function analyzeContract(contractId: string): Promise<ContractAnalysisResult> {
  // MOCK: Simulate API delay
  await simulateDelay(2000);
  
  // MOCK: Generate analysis result
  // TODO: Replace with actual LLM API call
  // Example integration point:
  // const response = await fetch('/api/ai/analyze', {
  //   method: 'POST',
  //   body: JSON.stringify({ contractId }),
  // });
  // return response.json();
  
  const result: ContractAnalysisResult = {
    contractId,
    analyzedAt: new Date(),
    riskDrivers: generateMockRiskDrivers(contractId),
    recommendedActions: generateMockActions(contractId),
    financialExposureNotes: generateMockFinancialNotes(contractId),
    complianceGaps: generateMockComplianceGaps(contractId),
    timelineCheckpoints: generateMockCheckpoints(contractId),
    summary: 'Este contrato apresenta riscos moderados a altos, principalmente nas áreas de compliance (LGPD) e termos de rescisão. Recomenda-se ação imediata nos itens de conformidade regulatória e renegociação de cláusulas críticas antes do próximo ciclo de reajuste.',
    overallRiskScore: 72,
  };
  
  return result;
}

/**
 * Ask a question about a specific contract.
 * 
 * @param contractId - The ID of the contract
 * @param question - The question to ask
 * @returns Promise<ContractQuestionResult> - The AI-generated answer
 * 
 * @example
 * const answer = await askContract('contract-1', 'What are the payment terms?');
 * console.log(answer.answer);
 */
export async function askContract(
  contractId: string, 
  question: string
): Promise<ContractQuestionResult> {
  // MOCK: Simulate API delay
  await simulateDelay(1200);
  
  // MOCK: Generate answer
  // TODO: Replace with actual LLM API call
  // Example integration point:
  // const response = await fetch('/api/ai/ask', {
  //   method: 'POST',
  //   body: JSON.stringify({ contractId, question }),
  // });
  // return response.json();
  
  const mockResponse = generateMockAnswer(contractId, question);
  
  const result: ContractQuestionResult = {
    id: `qa-${Date.now()}`,
    contractId,
    question,
    answer: mockResponse.answer,
    sources: mockResponse.sources,
    answeredAt: new Date(),
    confidence: mockResponse.confidence,
  };
  
  return result;
}
