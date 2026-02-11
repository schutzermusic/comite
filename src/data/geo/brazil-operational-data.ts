/**
 * Brazil Operational Data for Globe Visualization
 * Contains state centroids, project metrics, risk levels, and contracts
 */

export type RiskLevel = 'active' | 'at_risk' | 'critical' | 'completed';
export type ContractStatus = 'active' | 'delayed' | 'on_hold' | 'completed';

/**
 * Individual contract within a state
 */
export interface Contract {
  id: string;
  name: string;
  vendor: string;
  value: number;
  status: ContractStatus;
  slaDate: string;
  nextAction: string;
  completionPercent: number;
}

/**
 * State-level project data with contracts
 */
export interface StateProjectData {
  uf: string;
  state: string;
  lat: number;
  lng: number;
  contractsCount: number;
  totalContracted: number;
  backlogToBill: number;
  sharePct: number;
  backlogRatio: number;
  riskLevel: RiskLevel;
  avgCompletionPercent: number;
  contracts: Contract[];
}


// Precise centroids for Brazilian states
export const STATE_CENTROIDS: Record<string, { lat: number; lng: number; name: string }> = {
  AC: { lat: -9.0238, lng: -70.812, name: 'Acre' },
  AL: { lat: -9.5713, lng: -36.782, name: 'Alagoas' },
  AP: { lat: 1.4102, lng: -51.77, name: 'Amapá' },
  AM: { lat: -3.4168, lng: -65.8561, name: 'Amazonas' },
  BA: { lat: -12.5797, lng: -41.7007, name: 'Bahia' },
  CE: { lat: -5.4984, lng: -39.3206, name: 'Ceará' },
  DF: { lat: -15.7998, lng: -47.8645, name: 'Distrito Federal' },
  ES: { lat: -19.1834, lng: -40.3089, name: 'Espírito Santo' },
  GO: { lat: -15.827, lng: -49.8362, name: 'Goiás' },
  MA: { lat: -4.9609, lng: -45.2744, name: 'Maranhão' },
  MT: { lat: -12.6819, lng: -56.9211, name: 'Mato Grosso' },
  MS: { lat: -20.7722, lng: -54.7852, name: 'Mato Grosso do Sul' },
  MG: { lat: -18.5122, lng: -44.555, name: 'Minas Gerais' },
  PA: { lat: -3.4168, lng: -52.2176, name: 'Pará' },
  PB: { lat: -7.2399, lng: -36.7819, name: 'Paraíba' },
  PR: { lat: -24.8944, lng: -51.5548, name: 'Paraná' },
  PE: { lat: -8.3137, lng: -37.8627, name: 'Pernambuco' },
  PI: { lat: -6.6033, lng: -42.2897, name: 'Piauí' },
  RJ: { lat: -22.2527, lng: -42.6529, name: 'Rio de Janeiro' },
  RN: { lat: -5.4026, lng: -36.9541, name: 'Rio Grande do Norte' },
  RS: { lat: -30.0346, lng: -51.2177, name: 'Rio Grande do Sul' },
  RO: { lat: -10.8253, lng: -63.344, name: 'Rondônia' },
  RR: { lat: 2.7376, lng: -62.0751, name: 'Roraima' },
  SC: { lat: -27.2423, lng: -50.2189, name: 'Santa Catarina' },
  SP: { lat: -22.1945, lng: -48.7943, name: 'São Paulo' },
  SE: { lat: -10.5741, lng: -37.3857, name: 'Sergipe' },
  TO: { lat: -10.1753, lng: -48.2982, name: 'Tocantins' },
};

// Determine risk level based on backlog ratio and completion
function calculateRiskLevel(backlogRatio: number, sharePct: number): RiskLevel {
  if (backlogRatio >= 0.9 && sharePct > 10) return 'active';
  if (backlogRatio >= 0.7 && sharePct > 5) return 'active';
  if (backlogRatio < 0.3) return 'completed';
  if (backlogRatio < 0.5 || sharePct < 1) return 'at_risk';
  return 'active';
}

// Raw operational data with project information
const OPERATIONS_RAW = [
  {
    state: 'MINAS GERAIS',
    uf: 'MG',
    contractsCount: 13,
    totalContracted: 251844926.15,
    backlogToBill: 229418697.6,
    sharePct: 48.53,
    backlogRatio: 0.911,
  },
  {
    state: 'RIO DE JANEIRO',
    uf: 'RJ',
    contractsCount: 6,
    totalContracted: 194510617.35,
    backlogToBill: 175033696.37,
    sharePct: 37.48,
    backlogRatio: 0.9,
  },
  {
    state: 'PARA',
    uf: 'PA',
    contractsCount: 9,
    totalContracted: 39615328.73,
    backlogToBill: 28175671.37,
    sharePct: 7.63,
    backlogRatio: 0.711,
  },
  {
    state: 'MARANHAO',
    uf: 'MA',
    contractsCount: 4,
    totalContracted: 21017204.25,
    backlogToBill: 3552200.0,
    sharePct: 4.05,
    backlogRatio: 0.169,
  },
  {
    state: 'RIO GRANDE DO SUL',
    uf: 'RS',
    contractsCount: 9,
    totalContracted: 4461428.27,
    backlogToBill: 822233.33,
    sharePct: 0.86,
    backlogRatio: 0.184,
  },
  {
    state: 'SANTA CATARINA',
    uf: 'SC',
    contractsCount: 2,
    totalContracted: 3098165.73,
    backlogToBill: 479376.0,
    sharePct: 0.6,
    backlogRatio: 0.155,
  },
  {
    state: 'PARANA',
    uf: 'PR',
    contractsCount: 2,
    totalContracted: 1087944.8,
    backlogToBill: 1087944.8,
    sharePct: 0.21,
    backlogRatio: 1.0,
  },
  {
    state: 'SÃO PAULO',
    uf: 'SP',
    contractsCount: 1,
    totalContracted: 411525.0,
    backlogToBill: 0.0,
    sharePct: 0.08,
    backlogRatio: 0.0,
  },
];

// Mock contract generators for realistic data
const VENDORS = [
  'Engie Brasil', 'EDP Energias', 'Neoenergia', 'CPFL Energia',
  'Equatorial', 'Cemig', 'Light S.A.', 'Enel Brasil', 'AES Brasil'
];

const CONTRACT_NAMES_BY_TYPE = [
  'Projeto Solar', 'Linha de Transmissão', 'Subestação', 'Parque Eólico',
  'Modernização Rede', 'Smart Grid', 'Eficiência Energética', 'Infraestrutura Elétrica'
];

const NEXT_ACTIONS = [
  'Aprovação técnica pendente', 'Aguardando materiais', 'Em fase de testes',
  'Revisão contratual', 'Liberação ambiental', 'Mobilização equipe'
];

function generateMockContracts(uf: string, count: number, totalValue: number): Contract[] {
  const contracts: Contract[] = [];
  let remainingValue = totalValue;

  for (let i = 0; i < count; i++) {
    const isLast = i === count - 1;
    const value = isLast ? remainingValue : Math.round(remainingValue * (0.2 + Math.random() * 0.4));
    remainingValue -= value;

    const statusOptions: ContractStatus[] = ['active', 'active', 'active', 'delayed', 'completed'];
    const status = statusOptions[Math.floor(Math.random() * statusOptions.length)];

    const monthOffset = Math.floor(Math.random() * 12) + 1;
    const slaDate = new Date(2024, monthOffset, Math.floor(Math.random() * 28) + 1);

    contracts.push({
      id: `${uf}-${String(i + 1).padStart(3, '0')}`,
      name: `${CONTRACT_NAMES_BY_TYPE[i % CONTRACT_NAMES_BY_TYPE.length]} ${['Norte', 'Sul', 'Leste', 'Oeste', 'Centro'][i % 5]}`,
      vendor: VENDORS[Math.floor(Math.random() * VENDORS.length)],
      value,
      status,
      slaDate: slaDate.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' }),
      nextAction: NEXT_ACTIONS[Math.floor(Math.random() * NEXT_ACTIONS.length)],
      completionPercent: status === 'completed' ? 100 : Math.floor(Math.random() * 85) + 10,
    });
  }

  return contracts.sort((a, b) => b.value - a.value);
}

// Build complete state project data with centroids, risk levels, and contracts
export const STATE_PROJECT_DATA: StateProjectData[] = OPERATIONS_RAW.map((raw) => {
  const centroid = STATE_CENTROIDS[raw.uf];
  const riskLevel = calculateRiskLevel(raw.backlogRatio, raw.sharePct);
  const avgCompletionPercent = Math.round((1 - raw.backlogRatio) * 100);
  const contracts = generateMockContracts(raw.uf, Math.min(raw.contractsCount, 6), raw.totalContracted);

  return {
    ...raw,
    lat: centroid?.lat ?? 0,
    lng: centroid?.lng ?? 0,
    riskLevel,
    avgCompletionPercent,
    contracts,
  };
});

// Brazil center coordinates for globe focus
export const BRAZIL_CENTER = {
  lat: -14.235,
  lng: -51.9253,
  altitude: 2.5, // Globe.gl altitude multiplier for zoom
};

// Globe view states
export const GLOBE_VIEWS = {
  global: {
    lat: 0,
    lng: -40,
    altitude: 2.8,
  },
  brazil: {
    lat: BRAZIL_CENTER.lat,
    lng: BRAZIL_CENTER.lng,
    altitude: 0.8,
  },
};

// Color palette for risk levels (aligned with Orion theme)
export const RISK_COLORS: Record<RiskLevel, string> = {
  active: '#00FFB4',      // NeoGreen
  at_risk: '#FFB04D',     // NeoAmber
  critical: '#FF5860',    // NeoRed
  completed: '#00C8FF',   // NeoCyan
};

// Utility functions
export function formatBRL(value: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    maximumFractionDigits: 0,
  }).format(value);
}

export function formatCompact(value: number): string {
  if (value >= 1_000_000_000) {
    return `R$ ${(value / 1_000_000_000).toFixed(1)}bi`;
  }
  if (value >= 1_000_000) {
    return `R$ ${(value / 1_000_000).toFixed(1)}mi`;
  }
  if (value >= 1_000) {
    return `R$ ${(value / 1_000).toFixed(0)}k`;
  }
  return `R$ ${value.toFixed(0)}`;
}

export function getMaxContractValue(): number {
  return Math.max(...STATE_PROJECT_DATA.map((d) => d.totalContracted));
}

export function getStateByUF(uf: string): StateProjectData | undefined {
  return STATE_PROJECT_DATA.find((s) => s.uf === uf);
}
