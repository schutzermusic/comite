import type { ExtendedRisk, RiskAction, RiskHistoryEntry } from "./risk-types";

/* ════════════════════════════════════════════════════════════════════
   DEMO / DEMONSTRATION DATASET
   ────────────────────────────────────────────────────────────────────
   Used ONLY for visual validation when there are no real risks in
   Supabase, or when the user explicitly toggles the demo preview.
   It NEVER writes to the database — it is a client-side constant.
   Every consumer surfaces a "dados demonstrativos" badge while active.
   ════════════════════════════════════════════════════════════════════ */

const NOW = Date.now();
const DAY = 86_400_000;
function daysAgo(n: number): Date { return new Date(NOW - n * DAY); }
function daysFromNow(n: number): Date { return new Date(NOW + n * DAY); }

/** Severity mapping aligned with services/risks.computeSeverity. */
function sev(level: number): ExtendedRisk["severity"] {
  if (level >= 16) return "critical";
  if (level >= 12) return "high";
  if (level >= 7) return "medium";
  return "low";
}

type Origin = ExtendedRisk["origin"];
type Status = ExtendedRisk["status"];

/* Seed tuple — compact authoring format, expanded into ExtendedRisk below. */
interface Seed {
  t: string;            // title
  d: string;            // description
  cat: string;          // domain/category (PT canonical)
  area: string;         // owning area
  p: number;            // probability 1-5
  i: number;            // impact 1-5
  st: Status;           // status
  origin: Origin;       // origin
  owner: string;        // responsible
  ref?: string;         // linked project/contract name
  exp: number;          // financial exposure (BRL)
  due: number;          // due date offset in days (+future / -overdue), 0 = none
  age: number;          // days since created
  plan: boolean;        // has mitigation plan
  ai?: { conf: number; rec: string; module: string }; // AI metadata
}

const SEEDS: Seed[] = [
  { t: "Atraso em projeto de infraestrutura crítica", d: "Projeto de modernização do datacenter com risco de atraso por conflito de cronograma com fornecedores-chave.", cat: "Projetos", area: "PMO", p: 4, i: 5, st: "open", origin: "project", owner: "PMO Corporativo", ref: "PROJ-Datacenter 2026", exp: 2_400_000, due: 18, age: 42, plan: true },
  { t: "Exposição cambial em contrato internacional", d: "Variação cambial pode elevar em até 22% o custo do contrato com fornecedor europeu de equipamentos.", cat: "Financeiro", area: "Tesouraria", p: 3, i: 5, st: "mitigating", origin: "contract", owner: "Tesouraria", ref: "CT-2025-EU-118", exp: 1_850_000, due: 9, age: 61, plan: true },
  { t: "Não conformidade com LGPD em CRM", d: "Bases de marketing tratam dados pessoais sem base legal documentada. Risco de sanção da ANPD.", cat: "Compliance", area: "Jurídico", p: 3, i: 5, st: "open", origin: "ai", owner: "DPO", exp: 980_000, due: -4, age: 28, plan: false, ai: { conf: 0.91, rec: "Mapear fluxos de dados e nomear bases legais por finalidade em até 30 dias.", module: "compliance-scan" } },
  { t: "Cláusula de multa rescisória desproporcional", d: "Contrato com fornecedor crítico prevê multa de 20% do valor total em rescisão antecipada.", cat: "Contratual", area: "Suprimentos", p: 4, i: 4, st: "open", origin: "ai", owner: "Suprimentos", ref: "CT-2025-FORN-789", exp: 1_320_000, due: 12, age: 15, plan: false, ai: { conf: 0.87, rec: "Renegociar cláusula 14 limitando multa a 8% e prevendo carência de transição.", module: "contracts-scan" } },
  { t: "Vulnerabilidade crítica em ERP legado", d: "CVE-2026 de severidade alta no ERP on-premise. Janela de exploração ativa sem patch aplicado.", cat: "Segurança", area: "TI / Segurança", p: 5, i: 4, st: "mitigating", origin: "manual", owner: "CISO", exp: 1_500_000, due: 3, age: 11, plan: true },
  { t: "Ruptura na cadeia de fornecimento de insumos", d: "Fornecedor único de componente eletrônico apresenta instabilidade financeira e risco de descontinuidade.", cat: "Operacional", area: "Supply Chain", p: 3, i: 5, st: "mitigating", origin: "manual", owner: "Supply Chain", exp: 760_000, due: 21, age: 34, plan: true },
  { t: "Perda de especialista sênior sem sucessão", d: "Engenheiro com conhecimento único de sistema crítico em risco de saída. Conhecimento não documentado.", cat: "Pessoas", area: "RH Corporativo", p: 3, i: 3, st: "open", origin: "manual", owner: "RH Corporativo", exp: 320_000, due: 45, age: 22, plan: false },
  { t: "Multa ambiental por licença vencida", d: "Unidade do interior opera com licença ambiental em renovação. Risco de auto de infração do órgão estadual.", cat: "Compliance", area: "Meio Ambiente", p: 2, i: 4, st: "open", origin: "project", owner: "Meio Ambiente", ref: "PROJ-Planta Sul", exp: 540_000, due: -2, age: 19, plan: true },
  { t: "Flutuação da SELIC em dívida pós-fixada", d: "Carteira de financiamentos pós-fixados sensível a elevação de juros no próximo trimestre.", cat: "Financeiro", area: "Tesouraria", p: 3, i: 3, st: "open", origin: "ai", owner: "Tesouraria", exp: 690_000, due: 30, age: 13, plan: false, ai: { conf: 0.78, rec: "Avaliar swap parcial para pré-fixado em 40% da exposição.", module: "finance-scan" } },
  { t: "Indisponibilidade de sistema de faturamento", d: "SLA de disponibilidade do sistema de faturamento abaixo do contratado nos últimos 60 dias.", cat: "Tecnologia", area: "TI", p: 4, i: 4, st: "mitigating", origin: "manual", owner: "Diretoria de TI", exp: 880_000, due: 7, age: 26, plan: true },
  { t: "Conflito de interesses em comitê de compras", d: "Membro do comitê de compras com vínculo não declarado a fornecedor habilitado.", cat: "Compliance", area: "Compliance", p: 2, i: 5, st: "open", origin: "manual", owner: "Compliance", exp: 410_000, due: 14, age: 8, plan: false },
  { t: "Reajuste contratual acima do índice de mercado", d: "Fornecedor de TI aplicou reajuste de 14% versus 6% de mercado, sem aceite formal.", cat: "Contratual", area: "Suprimentos", p: 3, i: 3, st: "open", origin: "ai", owner: "Suprimentos", ref: "CT-2024-TI-204", exp: 230_000, due: 11, age: 17, plan: false, ai: { conf: 0.83, rec: "Contestar reajuste e exigir memória de cálculo contratual.", module: "contracts-scan" } },
  { t: "Fraude potencial em reembolsos de despesas", d: "Padrão atípico de reembolsos sequenciais identificado em auditoria de viagens corporativas.", cat: "Financeiro", area: "Auditoria", p: 2, i: 4, st: "mitigating", origin: "ai", owner: "Auditoria Interna", exp: 180_000, due: 6, age: 24, plan: true, ai: { conf: 0.72, rec: "Bloquear adiantamentos do colaborador e abrir apuração formal.", module: "finance-scan" } },
  { t: "Dependência de provedor cloud único", d: "Toda a infraestrutura produtiva concentrada em uma única região de um único provedor cloud.", cat: "Tecnologia", area: "Arquitetura", p: 3, i: 5, st: "open", origin: "manual", owner: "Arquitetura de Soluções", exp: 1_100_000, due: 60, age: 38, plan: true },
  { t: "Greve em operação logística terceirizada", d: "Risco de paralisação no operador logístico principal por dissídio em negociação.", cat: "Operacional", area: "Logística", p: 2, i: 4, st: "open", origin: "manual", owner: "Logística", exp: 470_000, due: 9, age: 6, plan: false },
  { t: "Atraso em entregável regulatório do projeto", d: "Submissão regulatória do projeto farma com risco de perder janela de aprovação anual.", cat: "Projetos", area: "Regulatório", p: 4, i: 4, st: "mitigating", origin: "project", owner: "Regulatório", ref: "PROJ-Registro 2026", exp: 950_000, due: -6, age: 31, plan: true },
  { t: "Capacitação insuficiente em segurança", d: "Baixa adesão ao treinamento anti-phishing aumenta superfície de risco humano.", cat: "Segurança", area: "TI / Segurança", p: 4, i: 2, st: "open", origin: "manual", owner: "Segurança da Informação", exp: 120_000, due: 22, age: 10, plan: false },
  { t: "Inadimplência de cliente estratégico", d: "Cliente responsável por 12% do faturamento apresenta atraso recorrente de pagamentos.", cat: "Financeiro", area: "Crédito e Cobrança", p: 3, i: 4, st: "mitigating", origin: "manual", owner: "Crédito e Cobrança", exp: 1_240_000, due: 5, age: 27, plan: true },
  { t: "Falha de continuidade de negócios (BCP)", d: "Plano de continuidade desatualizado há 18 meses; teste de recuperação não executado.", cat: "Operacional", area: "Riscos Corporativos", p: 3, i: 4, st: "open", origin: "manual", owner: "Gestão de Riscos", exp: 600_000, due: 40, age: 44, plan: false },
  { t: "Exposição trabalhista por terceirização", d: "Modelo de terceirização de equipe de campo com risco de reconhecimento de vínculo.", cat: "Pessoas", area: "Jurídico Trabalhista", p: 3, i: 3, st: "open", origin: "manual", owner: "Jurídico Trabalhista", exp: 540_000, due: 28, age: 20, plan: true },
  { t: "Obsolescência de equipamento de produção", d: "Linha de produção com equipamento sem peças de reposição disponíveis no mercado.", cat: "Operacional", area: "Manutenção", p: 3, i: 4, st: "open", origin: "manual", owner: "Engenharia de Manutenção", exp: 720_000, due: 50, age: 36, plan: true },
  { t: "Vazamento de credenciais em repositório", d: "Token de acesso a API encontrado em commit público de repositório interno.", cat: "Segurança", area: "TI / Segurança", p: 4, i: 4, st: "mitigating", origin: "ai", owner: "Segurança da Informação", exp: 380_000, due: 2, age: 5, plan: true, ai: { conf: 0.95, rec: "Revogar token, rotacionar segredos e habilitar scanner de secrets no CI.", module: "security-scan" } },
  { t: "Sanção por atraso em obrigação acessória", d: "Entrega de obrigação fiscal acessória em risco por integração contábil instável.", cat: "Compliance", area: "Fiscal", p: 2, i: 3, st: "open", origin: "manual", owner: "Fiscal", exp: 95_000, due: -1, age: 12, plan: false },
  { t: "Concentração de receita em poucos clientes", d: "Três clientes concentram 38% da receita, elevando a sensibilidade a churn.", cat: "Financeiro", area: "Comercial", p: 3, i: 4, st: "open", origin: "manual", owner: "Diretoria Comercial", exp: 1_600_000, due: 70, age: 48, plan: true },
  { t: "Dívida técnica em sistema core", d: "Sistema central acumula dívida técnica que eleva tempo de entrega e risco de incidentes.", cat: "Tecnologia", area: "Engenharia", p: 4, i: 3, st: "mitigating", origin: "manual", owner: "Engenharia de Software", exp: 430_000, due: 35, age: 55, plan: true },
  { t: "Descumprimento de SLA em contrato público", d: "Contrato com órgão público com indicadores de SLA próximos ao gatilho de penalidade.", cat: "Contratual", area: "Operações", p: 3, i: 4, st: "mitigating", origin: "contract", owner: "Gerência de Contratos", ref: "CT-2025-GOV-077", exp: 820_000, due: 4, age: 23, plan: true },
  { t: "Risco reputacional em redes sociais", d: "Campanha com repercussão negativa pode impactar marca e relação com investidores.", cat: "Operacional", area: "Comunicação", p: 2, i: 3, st: "resolved", origin: "manual", owner: "Comunicação Corporativa", exp: 150_000, due: 0, age: 70, plan: true },
  { t: "Falta de segregação de funções no ERP", d: "Perfis de acesso permitem lançar e aprovar pagamentos pelo mesmo usuário.", cat: "Compliance", area: "Controles Internos", p: 3, i: 4, st: "mitigating", origin: "ai", owner: "Controles Internos", exp: 290_000, due: 8, age: 18, plan: true, ai: { conf: 0.85, rec: "Redefinir matriz de SoD e revisar perfis de aprovação financeira.", module: "compliance-scan" } },
  { t: "Atraso na integração pós-aquisição", d: "Integração de sistemas da empresa adquirida atrasada, gerando retrabalho operacional.", cat: "Projetos", area: "PMO", p: 3, i: 3, st: "mitigating", origin: "project", owner: "PMO de Integração", ref: "PROJ-M&A Integração", exp: 540_000, due: 25, age: 33, plan: true },
  { t: "Capacidade insuficiente para pico sazonal", d: "Infraestrutura e equipe podem não suportar o pico de demanda do quarto trimestre.", cat: "Operacional", area: "Operações", p: 4, i: 3, st: "open", origin: "manual", owner: "Diretoria de Operações", exp: 610_000, due: 90, age: 9, plan: false },
  { t: "Erro de provisão contábil relevante", d: "Divergência identificada em provisão de contingências pode exigir reapresentação.", cat: "Financeiro", area: "Controladoria", p: 2, i: 5, st: "open", origin: "ai", owner: "Controladoria", exp: 1_050_000, due: 16, age: 14, plan: false, ai: { conf: 0.8, rec: "Revisar memória de cálculo de contingências com auditoria externa.", module: "finance-scan" } },
  { t: "Indenização por acidente de trabalho", d: "Aumento de quase-acidentes em planta indica risco elevado de evento com afastamento.", cat: "Pessoas", area: "SST", p: 3, i: 4, st: "mitigating", origin: "manual", owner: "Segurança do Trabalho", exp: 480_000, due: 13, age: 29, plan: true },
  { t: "Dependência de fornecedor de software único", d: "Sistema de missão crítica sem alternativa de mercado e contrato sem cláusula de escrow.", cat: "Contratual", area: "TI", p: 3, i: 4, st: "open", origin: "contract", owner: "Gerência de Contratos", ref: "CT-2023-SW-009", exp: 700_000, due: 33, age: 41, plan: true },
  { t: "Falta de plano de resposta a incidentes", d: "Organização sem playbook formal de resposta a incidentes cibernéticos testado.", cat: "Segurança", area: "TI / Segurança", p: 3, i: 5, st: "open", origin: "manual", owner: "CISO", exp: 900_000, due: 20, age: 16, plan: false },
  { t: "Risco de turnover em equipe-chave de produto", d: "Time de produto com sinais de esgotamento e propostas externas concorrentes.", cat: "Pessoas", area: "Produto", p: 3, i: 3, st: "open", origin: "manual", owner: "Head de Produto", exp: 260_000, due: 38, age: 11, plan: false },
  { t: "Exposição a sanções internacionais", d: "Transação com contraparte em jurisdição sob revisão de listas de sanções.", cat: "Compliance", area: "Compliance", p: 1, i: 5, st: "open", origin: "ai", owner: "Compliance", exp: 340_000, due: 27, age: 7, plan: false, ai: { conf: 0.69, rec: "Executar due diligence reforçada e screening de listas restritivas.", module: "compliance-scan" } },
  { t: "Degradação de performance em produção", d: "Latência da plataforma crescendo de forma consistente, impactando experiência do cliente.", cat: "Tecnologia", area: "SRE", p: 4, i: 3, st: "mitigating", origin: "manual", owner: "SRE", exp: 220_000, due: 6, age: 21, plan: true },
  { t: "Estouro de orçamento em projeto estratégico", d: "Projeto estratégico com desvio de 18% sobre o orçamento aprovado no comitê.", cat: "Projetos", area: "PMO", p: 4, i: 4, st: "mitigating", origin: "project", owner: "PMO Corporativo", ref: "PROJ-Expansão 2026", exp: 1_400_000, due: 10, age: 37, plan: true },
  { t: "Falha em controle de acesso físico", d: "Auditoria identificou portas críticas sem registro de acesso por mais de 90 dias.", cat: "Segurança", area: "Segurança Patrimonial", p: 2, i: 3, st: "resolved", origin: "manual", owner: "Segurança Patrimonial", exp: 80_000, due: 0, age: 64, plan: true },
  { t: "Risco de descontinuidade de matéria-prima", d: "Insumo importado sujeito a barreira comercial em discussão no comércio exterior.", cat: "Operacional", area: "Suprimentos", p: 2, i: 4, st: "open", origin: "manual", owner: "Suprimentos", exp: 530_000, due: 55, age: 25, plan: false },
  { t: "Pendência trabalhista coletiva", d: "Ação coletiva sobre jornada com probabilidade relevante de provimento parcial.", cat: "Pessoas", area: "Jurídico Trabalhista", p: 3, i: 4, st: "mitigating", origin: "manual", owner: "Jurídico Trabalhista", exp: 970_000, due: 44, age: 52, plan: true },
  { t: "Baixa cobertura de testes automatizados", d: "Cobertura de testes do core abaixo de 35%, elevando risco de regressões em releases.", cat: "Tecnologia", area: "Engenharia", p: 4, i: 2, st: "resolved", origin: "manual", owner: "Engenharia de Software", exp: 90_000, due: 0, age: 58, plan: true },
];

function buildActions(seed: Seed, idx: number): RiskAction[] {
  if (!seed.plan) return [];
  const allDone = seed.st === "mitigating" && (idx % 7 === 0); // a few reach "validating"
  const base = daysAgo(Math.max(2, Math.floor(seed.age / 2)));
  const acts: RiskAction[] = [
    {
      id: `dmo-a-${idx}-1`, riskId: `DEMO-${idx + 1}`,
      title: "Definir e validar plano de ação",
      assignee: seed.owner,
      dueDate: daysFromNow(seed.due > 0 ? Math.max(1, seed.due - 5) : 7),
      status: allDone ? "done" : seed.st === "resolved" ? "done" : "in_progress",
      createdAt: base,
    },
    {
      id: `dmo-a-${idx}-2`, riskId: `DEMO-${idx + 1}`,
      title: "Executar mitigação e reportar ao comitê",
      assignee: seed.owner,
      dueDate: daysFromNow(seed.due > 0 ? seed.due : 14),
      status: allDone || seed.st === "resolved" ? "done" : "pending",
      createdAt: base,
    },
  ];
  return acts;
}

function buildHistory(seed: Seed, idx: number): RiskHistoryEntry[] {
  const created = daysAgo(seed.age);
  const hist: RiskHistoryEntry[] = [
    { id: `dmo-h-${idx}-1`, riskId: `DEMO-${idx + 1}`, action: "Risco identificado", user: seed.origin === "ai" ? "Motor de IA" : "Gestão de Riscos", timestamp: created },
  ];
  if (seed.plan) {
    hist.push({ id: `dmo-h-${idx}-2`, riskId: `DEMO-${idx + 1}`, action: "Plano de mitigação definido", user: seed.owner, timestamp: daysAgo(Math.max(1, Math.floor(seed.age / 2))) });
  }
  if (seed.st === "mitigating") {
    hist.push({ id: `dmo-h-${idx}-3`, riskId: `DEMO-${idx + 1}`, action: "Mitigação em andamento", user: seed.owner, timestamp: daysAgo(Math.max(1, Math.floor(seed.age / 3))) });
  }
  if (seed.st === "resolved") {
    hist.push({ id: `dmo-h-${idx}-3`, riskId: `DEMO-${idx + 1}`, action: "Risco resolvido", user: seed.owner, timestamp: daysAgo(Math.max(1, Math.floor(seed.age / 4))) });
  }
  return hist;
}

export const DEMO_RISKS: ExtendedRisk[] = SEEDS.map((seed, idx) => {
  const level = seed.p * seed.i;
  const created = daysAgo(seed.age);
  const resolved = seed.st === "resolved" ? daysAgo(Math.max(1, Math.floor(seed.age / 4))) : undefined;
  const nextAction = seed.st !== "resolved"
    ? seed.plan
      ? "Acompanhar execução do plano com o responsável"
      : "Elaborar e aprovar plano de mitigação"
    : undefined;

  return {
    id: `DEMO-${String(idx + 1).padStart(3, "0")}`,
    title: seed.t,
    description: seed.d,
    category: seed.cat,
    area: seed.area,
    probability: seed.p,
    impact: seed.i,
    level,
    severity: sev(level),
    origin: seed.origin,
    referenceId: seed.ref ? `ref-${idx + 1}` : undefined,
    referenceName: seed.ref,
    responsibleId: undefined,
    responsibleName: seed.owner,
    status: seed.st,
    mitigationPlan: seed.plan
      ? `Plano estruturado de mitigação conduzido por ${seed.owner}, com marcos de acompanhamento e reporte ao comitê de riscos.`
      : undefined,
    nextAction,
    dueDate: seed.due !== 0 ? daysFromNow(seed.due) : undefined,
    financialExposure: seed.exp,
    actions: buildActions(seed, idx),
    history: buildHistory(seed, idx),
    evidences: idx % 4 === 0
      ? [{ id: `dmo-e-${idx}`, riskId: `DEMO-${idx + 1}`, name: `Evidência ${seed.cat} ${idx + 1}.pdf`, type: "document", uploadedAt: daysAgo(Math.max(1, seed.age - 3)), uploadedBy: seed.owner }]
      : [],
    createdAt: created,
    updatedAt: daysAgo(Math.max(0, Math.floor(seed.age / 5))),
    resolvedAt: resolved,
    sourceModule: seed.ai?.module,
    aiConfidence: seed.ai?.conf,
    aiRationale: seed.ai ? seed.d : undefined,
    aiRecommendation: seed.ai?.rec,
    aiModel: seed.ai ? "claude-opus-4-8" : undefined,
    aiAnalyzedAt: seed.ai ? daysAgo(Math.max(1, seed.age - 1)) : undefined,
    aiDismissed: false,
  } satisfies ExtendedRisk;
});

/* ── Monthly exposure trend (12 months, demo) ──
   `score` is the corporate exposure index (0-10) for that month. */
export interface TrendPoint {
  month: string;
  critical: number;
  high: number;
  medium: number;
  score: number;
}

export const DEMO_TREND: TrendPoint[] = [
  { month: "Jul", critical: 4, high: 6, medium: 8, score: 5.1 },
  { month: "Ago", critical: 5, high: 6, medium: 7, score: 5.4 },
  { month: "Set", critical: 5, high: 7, medium: 9, score: 5.8 },
  { month: "Out", critical: 6, high: 7, medium: 8, score: 6.0 },
  { month: "Nov", critical: 6, high: 8, medium: 10, score: 6.4 },
  { month: "Dez", critical: 7, high: 8, medium: 9, score: 6.7 },
  { month: "Jan", critical: 7, high: 9, medium: 11, score: 7.0 },
  { month: "Fev", critical: 8, high: 9, medium: 10, score: 7.2 },
  { month: "Mar", critical: 8, high: 10, medium: 12, score: 7.5 },
  { month: "Abr", critical: 9, high: 10, medium: 11, score: 7.3 },
  { month: "Mai", critical: 9, high: 11, medium: 12, score: 7.6 },
  { month: "Jun", critical: 10, high: 11, medium: 13, score: 7.8 },
];
