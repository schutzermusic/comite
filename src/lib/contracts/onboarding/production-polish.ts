export const CONTRACT_STATUS_LABELS: Readonly<Record<string, string>> = {
  draft: 'Rascunho',
  negotiation: 'Em negociação',
  legal_review: 'Revisão jurídica',
  commercial_review: 'Revisão comercial',
  signed: 'Assinado',
  active: 'Ativo / em execução',
  cancelled: 'Cancelado',
  expired: 'Expirado',
  unknown: 'Não identificado',
};

export const CONTRACT_RISK_LABELS: Readonly<Record<string, string>> = {
  low: 'Baixo',
  medium: 'Médio',
  high: 'Alto',
};

export function contractStatusLabel(value: unknown): string {
  return typeof value === 'string' ? (CONTRACT_STATUS_LABELS[value] ?? value) : String(value ?? '');
}

export function contractRiskLabel(value: unknown): string {
  return typeof value === 'string' ? (CONTRACT_RISK_LABELS[value] ?? value) : String(value ?? '');
}

export function formatContractMoney(value: unknown): string {
  if (value === null || value === undefined || value === '') return '';
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(number)) return String(value);
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(number);
}

export function formatContractDate(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return String(value ?? '');
  const [year, month, day] = value.split('-');
  return `${day}/${month}/${year}`;
}

export function formatDocumentaryField(key: string, value: unknown): string {
  if (value === null || value === undefined) return '';
  if (key === 'documentary_state' || key === 'status') return contractStatusLabel(value);
  if (key === 'risk' || key === 'risk_level') return contractRiskLabel(value);
  if (key === 'total_value' || key === 'monthly_value') return formatContractMoney(value);
  if (key.endsWith('_date')) return formatContractDate(value);
  return String(value);
}

export function normalizeBusinessText(value: string | null | undefined): string {
  return (value ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase('pt-BR')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

export interface ResponsiblePersonOption {
  id: string;
  fullName: string;
  email?: string | null;
  phone?: string | null;
  jobTitle?: string | null;
  department?: string | null;
}

export function likelyDuplicatePeople<T extends ResponsiblePersonOption>(
  people: readonly T[],
  input: { fullName: string; email?: string | null },
): T[] {
  const name = normalizeBusinessText(input.fullName);
  const email = normalizeBusinessText(input.email);
  return people.filter((person) => {
    const sameName = Boolean(name) && normalizeBusinessText(person.fullName) === name;
    const sameEmail = Boolean(email) && normalizeBusinessText(person.email) === email;
    return sameName || sameEmail;
  });
}

export interface OnboardingProjectOption {
  id: string;
  name: string;
  code: string;
  counterparty?: string | null;
  scopeSummary?: string | null;
  responsiblePersonId?: string | null;
}

function significantTokens(value: string | null | undefined): Set<string> {
  return new Set(normalizeBusinessText(value).split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 4 && !['para', 'com', 'contrato', 'servicos', 'prestacao'].includes(token)));
}

export function likelyDuplicateProjects(
  projects: readonly OnboardingProjectOption[],
  input: { name: string; contractNumber?: string | null; counterparty?: string | null; scopeSummary?: string | null },
): OnboardingProjectOption[] {
  const name = normalizeBusinessText(input.name);
  const contractNumber = normalizeBusinessText(input.contractNumber);
  const counterparty = normalizeBusinessText(input.counterparty);
  const wantedTokens = significantTokens(input.scopeSummary || input.name);
  return projects.filter((project) => {
    if (name && normalizeBusinessText(project.name) === name) return true;
    if (contractNumber && normalizeBusinessText(project.code) === contractNumber) return true;
    const sameCounterparty = Boolean(counterparty)
      && normalizeBusinessText(project.counterparty) === counterparty;
    const projectTokens = significantTokens(project.scopeSummary || project.name);
    const shared = [...wantedTokens].filter((token) => projectTokens.has(token)).length;
    return sameCounterparty && shared >= 2;
  });
}

function readableCase(value: string): string {
  if (value !== value.toLocaleUpperCase('pt-BR')) return value;
  return value.toLocaleLowerCase('pt-BR').replace(/(^|[\s—-])([a-záàâãéêíóôõúç])/g,
    (_, prefix: string, letter: string) => `${prefix}${letter.toLocaleUpperCase('pt-BR')}`)
    .replace(/\b(uhe|ug\d+|op\d+)\b/gi, (token) => token.toLocaleUpperCase('pt-BR'));
}

/** Editable suggestion only; callers must never persist it without Create. */
export function suggestOperationalProjectName(context: {
  title?: string | null;
  scopeSummary?: string | null;
  counterparty?: string | null;
}): string {
  const generic = /^(contrato|instrumento)\s+(de\s+)?(prestacao\s+de\s+servicos|fornecimento)/i;
  const scope = (context.scopeSummary ?? '').trim();
  const title = (context.title ?? '').trim();
  let candidate = scope || (generic.test(normalizeBusinessText(title)) ? '' : title);
  candidate = candidate.replace(/^(objeto|escopo)\s*[:\-–—]\s*/i, '').split(/[.;\n]/)[0].trim();
  if (!candidate) candidate = title || 'Novo projeto';

  candidate = readableCase(candidate).replace(/\s+/g, ' ').slice(0, 90).trim();
  const siteMatch = candidate.match(/\b(UHE|UTE|PCH|UFV|SE)\s+[\p{L}\d][\p{L}\d\s-]{2,35}/iu);
  const leading = candidate.split(/\s+(?:na|no|para|em)\s+/i)[0].trim();
  if (siteMatch && !normalizeBusinessText(leading).includes(normalizeBusinessText(siteMatch[0]))) {
    candidate = `${leading} — ${siteMatch[0].trim()}`;
  }
  return candidate;
}
