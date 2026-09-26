/**
 * "Apex busca fornecedores na internet" — o gateway com busca, a triagem do
 * servidor e a rota. Nenhuma chamada viva: o cliente da Anthropic é falso
 * (injetado no adaptador), o banco é falso, e a auditoria é capturada.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ requireCommercialSession: vi.fn(), serviceClient: vi.fn() }));
vi.mock('@/lib/commercial/server-session', () => ({
  requireCommercialSession: mocks.requireCommercialSession,
  isSessionError: (r: object) => 'error' in r,
}));
// A auditoria real usa o cliente de servidor (cookies); aqui ela nunca deve ser alcançada sem injeção.
vi.mock('@/lib/audit/log-audit-event-server', () => ({
  logAuditEventServer: async () => { throw new Error('auditoria real não é usada em teste'); },
}));
// O cliente de serviço (a contagem durável do teto) é falso; só o teste da contagem o configura.
vi.mock('@/lib/ai/server-clients', () => ({ getServiceClient: () => mocks.serviceClient() }));

import type Anthropic from '@anthropic-ai/sdk';
import { ApexAIGateway } from '@/lib/ai/gateway/apex-ai-gateway';
import { AnthropicApexAdapter, extractWebSources, type AnthropicMessagesClient } from '@/lib/ai/gateway/anthropic-adapter';
import { OpenAIApexAdapter } from '@/lib/ai/gateway/openai-adapter';
import { ApexAIError } from '@/lib/ai/gateway/errors';
import { CURRENT_PRODUCTION_TASKS, getApexAITaskPolicy } from '@/lib/ai/gateway/task-registry';
import type {
  ApexAIAdapterRequest, ApexAIAdapterResponse, ApexAIProviderAdapter, ApexAIRequest, ApexAIResponse,
} from '@/lib/ai/gateway/types';
import {
  buildDiscoveryPrompt, discoverSuppliers, discoveryLimits, discoveryQuery, DiscoveryGuard, DISCOVERY_AUDIT_ACTION,
  DISCOVERY_BLOCKED_DOMAINS, DISCOVERY_LIMIT_DEFAULT, DISCOVERY_MAX_CANDIDATES, DISCOVERY_MESSAGE, DISCOVERY_REASON,
  DISCOVERY_REUSE_MS, DISCOVERY_SYSTEM_PROMPT, DISCOVERY_WINDOW_MS, normalizeCnpj, normalizeDiscovery, parseDiscoveryText,
  registrableDomain, supplierDiscoveryAvailability, urlKey, waitText, windowFreeAt, type DiscoveryDeps, type DiscoveryInput,
} from '@/lib/supply/supplier-discovery';
import { POST } from '@/app/api/dashboard/site/[projectId]/supply/discover/route';

const savedEnv = { ...process.env };
beforeEach(() => {
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  process.env = { ...savedEnv };
  mocks.requireCommercialSession.mockReset();
  mocks.serviceClient.mockReset();
});

/* ══════════════════════════════════════════════════════════════════════════
   Falsos
   ══════════════════════════════════════════════════════════════════════════ */

type Content = Array<Record<string, unknown>>;

function message(content: Content, stopReason: string = 'end_turn', searches = 2): Anthropic.Message {
  return {
    id: 'msg_test', type: 'message', role: 'assistant', model: 'claude-sonnet-5', container: null,
    content, stop_reason: stopReason, stop_sequence: null, stop_details: null,
    usage: {
      input_tokens: 5000, output_tokens: 900, cache_read_input_tokens: null, cache_creation_input_tokens: null,
      server_tool_use: { web_search_requests: searches, web_fetch_requests: 0 },
    },
  } as unknown as Anthropic.Message;
}

function fakeMessages(reply: Anthropic.Message) {
  const calls: Anthropic.MessageCreateParamsNonStreaming[] = [];
  const client = {
    create: vi.fn(async (params: Anthropic.MessageCreateParamsNonStreaming) => { calls.push(params); return reply; }),
    stream: vi.fn(() => { throw new Error('stream não é usado nesta tarefa'); }),
  } as unknown as AnthropicMessagesClient;
  return { client, calls };
}

const RESULT_A = 'https://www.cabosnorte.com.br/produtos/cabo-35mm';
const RESULT_B = 'https://distribuidora-eletrica.com.br/catalogo?utm_source=google';
const CITED = 'https://www.cabosnorte.com.br/contato';

const searchResult = (urls: Array<[string, string]>) => ({
  type: 'web_search_tool_result', tool_use_id: 'srvtoolu_1', caller: { type: 'direct' },
  content: urls.map(([url, title]) => ({ type: 'web_search_result', url, title, encrypted_content: 'x', page_age: null })),
});

const answerJson = (candidatos: unknown[]) => JSON.stringify({ candidatos });

const GOOD_ANSWER = answerJson([
  {
    nome: 'Cabos Norte Indústria Ltda', cnpj: '11.222.333/0001-81', site: 'https://www.cabosnorte.com.br',
    email: 'vendas@cabosnorte.com.br', telefone: '(91) 3222-1000', cidade: 'Belém', uf: 'pa', pais: 'Brasil',
    fontes: [RESULT_A, CITED], confianca: 'alta', observacao: 'Fabrica cabos de cobre até 240 mm².',
  },
  {
    nome: 'Distribuidora Elétrica', cnpj: '12.345.678/0001-00', site: null, email: null, telefone: null,
    fontes: ['https://distribuidora-eletrica.com.br/catalogo'], confianca: 'alta', observacao: null,
  },
  { nome: 'Empresa Inventada SA', fontes: ['https://nao-apareceu-na-busca.com.br'], confianca: 'alta' },
  { nome: 'Sem Fonte Nenhuma', site: 'https://semfonte.com.br' },
]);

function searchReply(finalText = GOOD_ANSWER, stopReason = 'end_turn'): Anthropic.Message {
  return message([
    { type: 'text', text: 'Vou procurar fabricantes e distribuidores.', citations: null },
    { type: 'server_tool_use', id: 'srvtoolu_1', name: 'web_search', input: { query: 'cabo 35 mm2 fabricante' }, caller: { type: 'direct' } },
    searchResult([[RESULT_A, 'Cabo 35 mm² — Cabos Norte'], [RESULT_B, 'Catálogo — Distribuidora Elétrica']]),
    { type: 'text', text: '', citations: [
      { type: 'web_search_result_location', url: CITED, title: 'Contato — Cabos Norte', cited_text: 'x', encrypted_index: 'y' },
      { type: 'web_search_result_location', url: RESULT_A, title: 'Cabo 35 mm² — Cabos Norte', cited_text: 'x', encrypted_index: 'y' },
    ] },
    { type: 'text', text: finalText, citations: null },
  ], stopReason);
}

/** Um banco falso, encadeável como o PostgREST, que registra o que foi selecionado. */
type TableRow = Record<string, unknown>;
function fakeSupabase(tables: Record<string, { rows: TableRow[]; error?: unknown }>, grants: Record<string, boolean> = {}) {
  const selects: Array<{ table: string; columns: string; filters: Array<[string, unknown]> }> = [];
  const rpc = vi.fn(async (_fn: string, args: { permission_key: string }) => ({ data: grants[args.permission_key] ?? false, error: null }));
  const from = (table: string) => {
    const entry = { table, columns: '', filters: [] as Array<[string, unknown]> };
    selects.push(entry);
    const result = () => {
      const spec = tables[table] ?? { rows: [] };
      if (spec.error) return { data: null, error: spec.error };
      const rows = spec.rows.filter((row) => entry.filters.every(([k, v]) => row[k] === undefined || row[k] === v));
      return { data: rows, error: null };
    };
    const builder = {
      select(columns: string) { entry.columns = columns; return builder; },
      eq(column: string, value: unknown) { entry.filters.push([column, value]); return builder; },
      limit() { return builder; },
      async maybeSingle() { const r = result(); return { data: r.data ? (r.data[0] ?? null) : null, error: r.error }; },
      then(resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) {
        return Promise.resolve(result()).then(resolve, reject);
      },
    };
    return builder;
  };
  return { client: { from, rpc } as never, selects, rpc };
}

const ORG = '5e0c1e4a-0000-4000-8000-000000000001';
const REQ = '7b1d2c3e-1111-4222-8333-444455556666';
const PROJECT = 'qa-scn-tucurui';

// Tudo que NUNCA pode sair da empresa — e está no banco, ao alcance.
const SECRET_PROJECT = 'UHE Tucuruí — Reforma da Casa de Força';
const SECRET_CLIENT = 'Eletronorte Centrais Elétricas';
const SECRET_TITLE = 'Cabo p/ Tucuruí — pedir ao Sr. João Batista';
const SECRET_PERSON = 'João Batista';

function tucurui(overrides: { requirement?: Partial<TableRow>; item?: Partial<TableRow> | null } = {}) {
  return fakeSupabase({
    project_requirements: { rows: [{
      id: REQ, organization_id: ORG, project_id: PROJECT, requirement_type: 'MATERIAL', status: 'CONFIRMED',
      item_id: 'item-1', quantity: '500.0000', unit: 'm', title: SECRET_TITLE, description: `Responsável ${SECRET_PERSON}`,
      ...overrides.requirement,
    }] },
    supply_items: { rows: overrides.item === null ? [] : [{
      id: 'item-1', organization_id: ORG, code: 'CABO-35', description: 'Cabo de cobre 35 mm² 0,6/1 kV',
      category: 'Cabos BT', unit: 'm', manufacturer: 'Fabricante X', ...overrides.item,
    }] },
    projects: { rows: [{
      id: PROJECT, organization_id: ORG,
      project: { nome: SECRET_PROJECT, cliente: SECRET_CLIENT, uf: 'PA', valor_total: 12_500_000, gestor: SECRET_PERSON },
      project_v2: { name: SECRET_PROJECT, client: { name: SECRET_CLIENT } },
    }] },
    project_globe_marker: { rows: [{ project_id: PROJECT, organization_id: ORG, state_code: 'PA' }] },
  });
}

const USER = '9a8b7c6d-2222-4333-8444-555566667777';
const session = (client: unknown, permissions: string[] = ['procurement.source', 'projects.view'], userId = USER) => ({
  supabase: client as never, organizationId: ORG, permissions: new Set(permissions), user: { id: userId } as never,
});

/** O freio isolado por teste: memória nova e contagem durável vazia (ou a dada). */
const brake = (usage: { user?: string[]; org?: string[] } = {}) => ({
  guard: new DiscoveryGuard(),
  usage: vi.fn(async () => ({ user: usage.user ?? [], org: usage.org ?? [] })),
});

const ENABLED = { APEX_AI_WEB_SEARCH_ENABLED: 'true', ANTHROPIC_API_KEY: 'test-key' };

function enableProcessEnv() {
  process.env.APEX_AI_ENABLED = 'true';
  process.env.APEX_AI_WEB_SEARCH_ENABLED = 'true';
  process.env.ANTHROPIC_API_KEY = 'test-key';
}

/* ══════════════════════════════════════════════════════════════════════════
   A · O gateway com busca (adaptador Anthropic de verdade, cliente falso)
   ══════════════════════════════════════════════════════════════════════════ */

const searchRequest = (extra: Partial<ApexAIRequest> = {}): ApexAIRequest => ({
  organizationId: ORG, task: 'SUPPLIER_WEB_DISCOVERY', systemPrompt: 'sistema', userPrompt: 'item',
  webSearch: { maxUses: 5, blockedDomains: ['mercadolivre.com.br'], country: 'br' }, ...extra,
});

describe('gateway — busca na internet', () => {
  it('liga SÓ a ferramenta de busca do servidor (nunca web_fetch) e devolve as fontes dos resultados e das citações', async () => {
    enableProcessEnv();
    const { client, calls } = fakeMessages(searchReply());
    const result = await new ApexAIGateway([new AnthropicApexAdapter(client)]).generate(searchRequest());

    const params = calls[0];
    expect(params.tools).toEqual([{
      type: 'web_search_20250305', name: 'web_search', max_uses: 5,
      blocked_domains: ['mercadolivre.com.br'], user_location: { type: 'approximate', country: 'BR' },
    }]);
    expect(JSON.stringify(params)).not.toContain('web_fetch');
    expect(params.output_config).toEqual({ effort: 'low' });
    expect(params.output_config).not.toHaveProperty('format');

    expect(result.sources).toEqual([
      { url: RESULT_A, title: 'Cabo 35 mm² — Cabos Norte' },
      { url: RESULT_B, title: 'Catálogo — Distribuidora Elétrica' },
      { url: CITED, title: 'Contato — Cabos Norte' },
    ]);
    expect(result.searchErrors).toEqual([]);
    expect(result.provenance.usage.webSearchRequests).toBe(2);
    expect(result.text).toContain('"candidatos"');
  });

  it('recusa pause_turn como incompleto (a busca parou no meio; nada vira resposta)', async () => {
    enableProcessEnv();
    const { client } = fakeMessages(searchReply(GOOD_ANSWER, 'pause_turn'));
    const error = await new ApexAIGateway([new AnthropicApexAdapter(client)]).generate(searchRequest())
      .catch((e: unknown) => e as ApexAIError);
    expect(error).toBeInstanceOf(ApexAIError);
    expect(error).toMatchObject({ code: 'INVALID_RESPONSE' });
    expect((error as ApexAIError).message).toContain('interrompida');
    expect((error as ApexAIError).message).toContain('stop_reason=pause_turn');
  });

  it('busca que falhou volta como código de erro (HTTP 200, sem exceção), nunca como fonte', () => {
    const blocks = [
      { type: 'web_search_tool_result', tool_use_id: 's', caller: { type: 'direct' }, content: { type: 'web_search_tool_result_error', error_code: 'max_uses_exceeded' } },
      searchResult([['javascript:alert(1)', 'x'], ['https://ok.com.br/a', ' Título ']]),
    ] as unknown as Anthropic.ContentBlock[];
    expect(extractWebSources(blocks)).toEqual({ sources: [{ url: 'https://ok.com.br/a', title: 'Título' }], errors: ['max_uses_exceeded'] });
  });

  it('as demais tarefas continuam idênticas: sem ferramenta, sem esforço fora do esquema, sem `sources`', async () => {
    enableProcessEnv();
    const { client, calls } = fakeMessages(message([{ type: 'text', text: 'ok', citations: null }]));
    const result = await new ApexAIGateway([new AnthropicApexAdapter(client)]).generate({
      organizationId: ORG, task: 'EXECUTIVE_SYNTHESIS', userPrompt: 'x',
    });
    expect(calls[0]).not.toHaveProperty('tools');
    expect(calls[0]).not.toHaveProperty('output_config');
    expect(result).not.toHaveProperty('sources');
    expect(result).not.toHaveProperty('searchErrors');
    expect(result.provenance.usage).not.toHaveProperty('webSearchRequests');
  });

  it('pedido de busca malformado é recusado antes de qualquer provedor', async () => {
    enableProcessEnv();
    const { client, calls } = fakeMessages(searchReply());
    const gateway = new ApexAIGateway([new AnthropicApexAdapter(client)]);
    for (const bad of [
      searchRequest({ webSearch: { maxUses: 0 } }),
      searchRequest({ webSearch: { maxUses: 3, allowedDomains: ['a.com'], blockedDomains: ['b.com'] } }),
      searchRequest({ structuredOutput: { name: 'x', schema: { type: 'object' } } }),
    ]) {
      await expect(gateway.generate(bad)).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    }
    expect(calls).toHaveLength(0);
  });

  it('adaptador sem a capacidade declarada falha fechado (CAPABILITY_UNSUPPORTED)', async () => {
    const generate = vi.fn();
    const noSearch: ApexAIProviderAdapter = {
      provider: 'anthropic',
      capabilities: { structuredOutput: true, documentPdf: true, reasoningEffort: true, promptCache: true, streaming: true },
      isConfigured: () => true,
      generate: generate as unknown as (r: ApexAIAdapterRequest, s: AbortSignal) => Promise<ApexAIAdapterResponse>,
      normalizeError: (e) => e as ApexAIError,
    };
    await expect(new ApexAIGateway([noSearch]).generate(searchRequest())).rejects.toMatchObject({ code: 'CAPABILITY_UNSUPPORTED' });
    expect(generate).not.toHaveBeenCalled();
  });

  it('o adaptador OpenAI não oferece busca — nem declarada, nem chamada direto', async () => {
    const create = vi.fn();
    const adapter = new OpenAIApexAdapter({ create } as never);
    expect(adapter.capabilities.webSearch).toBe(false);
    process.env.OPENAI_API_KEY = 'test';
    const policy = getApexAITaskPolicy('SUPPLIER_WEB_DISCOVERY');
    await expect(adapter.generate({ ...searchRequest(), policy }, new AbortController().signal))
      .rejects.toMatchObject({ code: 'CAPABILITY_UNSUPPORTED' });
    expect(create).not.toHaveBeenCalled();
  });

  it('a tarefa tem política própria: uma tentativa, sem fallback, teto curto, fora das tarefas de produção', () => {
    const policy = getApexAITaskPolicy('SUPPLIER_WEB_DISCOVERY');
    expect(policy).toMatchObject({ provider: 'anthropic', maxAttempts: 1, maxTokens: 6_000, timeoutMs: 120_000, highRisk: false });
    expect(policy.fallbacks).toEqual([]);
    expect(policy.model).not.toMatch(/opus/);
    expect(CURRENT_PRODUCTION_TASKS as readonly string[]).not.toContain('SUPPLIER_WEB_DISCOVERY');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   B · A triagem do servidor
   ══════════════════════════════════════════════════════════════════════════ */

describe('triagem — só sobrevive candidato com fonte vista na busca', () => {
  const sources = [
    { url: RESULT_A, title: 'a' }, { url: RESULT_B, title: 'b' }, { url: CITED, title: 'c' },
  ];

  it('descarta quem não tem fonte da busca e guarda a URL DA BUSCA, não a digitada', () => {
    const raw = parseDiscoveryText(`Vou procurar.\n${GOOD_ANSWER}`);
    expect(raw).toHaveLength(4);
    const { candidates, dropped } = normalizeDiscovery(raw!, sources);
    expect(candidates.map((c) => c.name)).toEqual(['Cabos Norte Indústria Ltda', 'Distribuidora Elétrica']);
    expect(dropped).toBe(2);
    const [norte, dist] = candidates;
    expect(norte).toEqual({
      name: 'Cabos Norte Indústria Ltda', cnpj: '11.222.333/0001-81', site: 'https://www.cabosnorte.com.br/',
      email: 'vendas@cabosnorte.com.br', phone: '(91) 3222-1000', city: 'Belém', uf: 'PA', country: 'Brasil',
      // Duas páginas do MESMO site: "alta" declarada vira "média", e o contato ganha o aviso de fonte única.
      evidenceUrls: [RESULT_A, CITED], confidence: 'medium',
      note: 'Fabrica cabos de cobre até 240 mm². E-mail e telefone vistos em um único site — confirme por outro canal antes de usar.',
    });
    // Modelo disse "alta"; uma fonte e nenhum canal sustentam só "baixa". CNPJ com dígito errado cai.
    expect(dist.evidenceUrls).toEqual([RESULT_B]);
    expect(dist.confidence).toBe('low');
    expect(dist.cnpj).toBeNull();
  });

  it('sem nenhuma fonte, nenhum candidato — mesmo com resposta bem formada', () => {
    const { candidates, dropped } = normalizeDiscovery(parseDiscoveryText(GOOD_ANSWER)!, []);
    expect(candidates).toEqual([]);
    expect(dropped).toBe(4);
  });

  it('repetidos (mesmo CNPJ ou mesmo nome) entram uma vez; o teto é de 8', () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ nome: `Fornecedor ${i}`, fontes: [RESULT_A] }));
    const dupes = [
      { nome: 'Cabos Norte Ltda', cnpj: '11222333000181', fontes: [RESULT_A] },
      { nome: 'CABOS NORTE', cnpj: '11.222.333/0001-81', fontes: [RESULT_B] },
      { nome: 'Cabos Norte S/A', fontes: [RESULT_A] },
      { nome: 'cabos norte', fontes: [RESULT_A] },
    ];
    expect(normalizeDiscovery(dupes, sources)).toMatchObject({ candidates: [{ name: 'Cabos Norte Ltda' }], dropped: 3 });
    expect(normalizeDiscovery(many, sources).candidates).toHaveLength(DISCOVERY_MAX_CANDIDATES);
  });

  it('a confiança é a MENOR entre a declarada e a sustentada', () => {
    const one = (row: Record<string, unknown>) => normalizeDiscovery([{ nome: 'X', fontes: [RESULT_A], ...row }], sources).candidates[0];
    expect(one({ confianca: 'alta', email: 'a@x.com.br' }).confidence).toBe('medium');
    expect(one({ confianca: 'baixa', fontes: [RESULT_A, RESULT_B] }).confidence).toBe('low');
    expect(one({ confianca: 'média', site: 'cabosnorte.com.br' }).confidence).toBe('medium');
    // O próprio site declarado entre as fontes já não basta: um domínio só nunca é "alta".
    expect(one({ confianca: 'alta', site: 'https://cabosnorte.com.br' }).confidence).toBe('medium');
    expect(one({ confianca: 'alta', fontes: [RESULT_A, CITED] }).confidence).toBe('low');
    expect(one({ confianca: 'alta', fontes: [RESULT_A, RESULT_B] }).confidence).toBe('high');
    expect(one({}).confidence).toBe('low');
  });

  it('página auto-publicada (ou com instrução injetada) não dá "confiança alta" a si mesma', () => {
    const own = [
      { url: 'https://evil-distribuidora.com.br/sobre', title: 'Sobre' },
      { url: 'https://loja.evil-distribuidora.com.br/contato', title: 'Contato' },
    ];
    const [c] = normalizeDiscovery([{
      nome: 'Evil Distribuidora', site: 'https://evil-distribuidora.com.br', email: 'vendas@evil-distribuidora.com.br',
      telefone: '(11) 4000-0000', fontes: own.map((s) => s.url), confianca: 'alta', observacao: 'Distribui cabos.',
    }], own).candidates;
    // Duas páginas, dois hosts — um domínio registrável só.
    expect(c.confidence).toBe('medium');
    expect(c.note).toBe('Distribui cabos. E-mail e telefone vistos em um único site — confirme por outro canal antes de usar.');

    // Só telefone, sem observação do modelo: o aviso vira a observação.
    const [t] = normalizeDiscovery([{ nome: 'T', telefone: '(11) 4000-0000', fontes: [own[0].url] }], own).candidates;
    expect(t.note).toBe('Telefone visto em um único site — confirme por outro canal antes de usar.');
    // Fontes em dois domínios independentes: sem aviso.
    const [m] = normalizeDiscovery([{ nome: 'M', email: 'a@b.com.br', fontes: [RESULT_A, RESULT_B], confianca: 'alta' }], sources).candidates;
    expect(m).toMatchObject({ confidence: 'high', note: null });
  });

  it('domínio registrável: junta subdomínios, respeita categoria de ccTLD (com.br, co.uk)', () => {
    expect(registrableDomain('loja.cabosnorte.com.br')).toBe('cabosnorte.com.br');
    expect(registrableDomain('www.cabosnorte.com.br')).toBe('cabosnorte.com.br');
    expect(registrableDomain('a.b.exemplo.com')).toBe('exemplo.com');
    expect(registrableDomain('shop.acme.co.uk')).toBe('acme.co.uk');
    expect(registrableDomain('x.abc.io')).toBe('abc.io');
    expect(registrableDomain('exemplo.com.br')).toBe('exemplo.com.br');
    expect(registrableDomain('10.0.0.1')).toBe('10.0.0.1');
    expect(registrableDomain(null)).toBeNull();
  });

  it('contatos malformados viram null; nunca texto arbitrário', () => {
    const c = normalizeDiscovery([{
      nome: 'Y\u0000 Ltda\n', fontes: [RESULT_A], email: 'não tem', telefone: 'ligue já!', site: 'javascript:alert(1)', uf: 'Pará',
    }], sources).candidates[0];
    expect(c).toMatchObject({ name: 'Y Ltda', email: null, phone: null, site: null, uf: null });
  });

  it('o texto do modelo: prosa antes, cerca de código, chaves dentro de strings; ilegível = null', () => {
    expect(parseDiscoveryText('Resultado:\n```json\n{"candidatos":[{"nome":"A {x}","fontes":[]}]}\n```')).toEqual([{ nome: 'A {x}', fontes: [] }]);
    expect(parseDiscoveryText('{"candidatos":[]}')).toEqual([]);
    expect(parseDiscoveryText('Não encontrei nada.')).toBeNull();
    expect(parseDiscoveryText('{"candidatos": "nenhum"}')).toBeNull();
    expect(parseDiscoveryText('{"candidatos":[{"nome":"cortado"')).toBeNull();
  });

  it('URL comparada sem www, fragmento, rastreio ou barra final', () => {
    expect(urlKey('https://WWW.Exemplo.com.br/a/?utm_source=x&b=2#topo')).toBe('exemplo.com.br/a?b=2');
    expect(urlKey('http://exemplo.com.br/a')).toBe(urlKey('https://www.exemplo.com.br/a/'));
    expect(urlKey('ftp://exemplo.com.br')).toBeNull();
    expect(urlKey('não é url')).toBeNull();
  });

  it('CNPJ: formato e dígitos (numérico e alfanumérico), nunca cadastro', () => {
    expect(normalizeCnpj('11.222.333/0001-81')).toBe('11.222.333/0001-81');
    expect(normalizeCnpj('11222333000181')).toBe('11.222.333/0001-81');
    expect(normalizeCnpj('12.ABC.345/01DE-35')).toBe('12.ABC.345/01DE-35');
    expect(normalizeCnpj('12abc34501de35')).toBe('12.ABC.345/01DE-35');
    expect(normalizeCnpj('11.222.333/0001-82')).toBeNull();
    expect(normalizeCnpj('00.000.000/0000-00')).toBeNull();
    expect(normalizeCnpj('1122233300018')).toBeNull();
    expect(normalizeCnpj(null)).toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   C · O que sai da empresa
   ══════════════════════════════════════════════════════════════════════════ */

describe('o prompt — só item, quantidade e UF', () => {
  it('a busca de ponta a ponta: nenhum nome de projeto, cliente, organização, preço ou pessoa atravessa', async () => {
    enableProcessEnv();
    const db = tucurui();
    const { client, calls } = fakeMessages(searchReply());
    const audit = vi.fn(async () => ({ ok: true as const }));
    const result = await discoverSuppliers(
      { session: session(db.client), projectId: PROJECT, requirementId: REQ },
      { gateway: new ApexAIGateway([new AnthropicApexAdapter(client)]), audit, env: ENABLED, now: () => new Date('2026-09-25T12:00:00Z'), ...brake() },
    );

    expect(result).toMatchObject({
      ok: true, runAt: '2026-09-25T12:00:00.000Z', provider: 'anthropic', model: 'claude-sonnet-5',
      query: 'Cabo de cobre 35 mm² 0,6/1 kV (CABO-35) · Cabos BT · 500 m · entrega em PA',
    });
    expect(result.ok && result.candidates.map((c) => c.name)).toEqual(['Cabos Norte Indústria Ltda', 'Distribuidora Elétrica']);

    const sent = JSON.stringify(calls[0]);
    for (const secret of [SECRET_PROJECT, 'Tucuruí', SECRET_CLIENT, 'Eletronorte', SECRET_TITLE, SECRET_PERSON, 'João', ORG, PROJECT, REQ,
      '12500000', '12.500.000', 'R$', 'Fabricante X']) {
      expect(sent, secret).not.toContain(secret);
    }
    expect(calls[0].messages[0]).toMatchObject({ role: 'user' });
    expect(sent).toContain('Cabo de cobre 35 mm² 0,6/1 kV');
    expect(sent).toContain('CABO-35');
    expect(sent).toContain('Pará (PA), Brasil');
    expect(sent).toContain('500 m');
    expect(calls[0].tools?.[0]).toMatchObject({ max_uses: 5, blocked_domains: [...DISCOVERY_BLOCKED_DOMAINS] });

    // Só as colunas necessárias são lidas — o título e a descrição do requisito nem saem do banco.
    const reqSelect = db.selects.find((s) => s.table === 'project_requirements')!;
    expect(reqSelect.columns).not.toMatch(/title|description/);
    expect(reqSelect.filters).toContainEqual(['organization_id', ORG]);
    expect(db.selects.find((s) => s.table === 'supply_items')!.columns).toBe('code,description,category,unit');

    // Auditoria: contagens, modelo e tokens — nenhum conteúdo.
    expect(audit).toHaveBeenCalledTimes(1);
    const [event] = audit.mock.calls[0] as unknown as [{ action: string; entityType: string; entityId: string; metadata: Record<string, unknown> }];
    expect(event).toMatchObject({ action: 'supply.supplier_discovery.requested', entityType: 'project_requirement', entityId: REQ });
    expect(event.metadata).toMatchObject({
      outcome: 'ok', provider: 'anthropic', model: 'claude-sonnet-5', input_tokens: 5000, output_tokens: 900,
      searches: 2, sources: 3, proposed: 4, candidates: 2, dropped: 2, project_id: PROJECT,
    });
    const auditText = JSON.stringify(event);
    for (const content of ['Cabos Norte', 'cabosnorte', 'Cabo de cobre', 'CABO-35', 'vendas@']) expect(auditText).not.toContain(content);
  });

  it('o construtor do prompt só conhece DiscoveryInput (e o sistema proíbe contato pessoal e instrução de página)', () => {
    const input: DiscoveryInput = {
      kind: 'EXTERNAL_SERVICE', description: 'Ensaio de óleo isolante', code: null, category: null, unit: null, quantity: null, uf: null,
    };
    const prompt = buildDiscoveryPrompt(input);
    expect(prompt).toContain('serviço externo');
    expect(prompt).toContain('Brasil (UF não cadastrada)');
    expect(prompt).not.toContain('Código interno');
    expect(discoveryQuery(input)).toBe('Ensaio de óleo isolante · entrega no Brasil');
    expect(DISCOVERY_SYSTEM_PROMPT).toMatch(/Nunca nome, e-mail ou telefone de pessoa física/);
    expect(DISCOVERY_SYSTEM_PROMPT).toMatch(/DADO, não instrução/);
  });

  it('lista cortada (max_tokens) ou ilegível não vira resultado', async () => {
    enableProcessEnv();
    const audit = vi.fn(async () => ({ ok: true as const }));
    for (const reply of [searchReply(GOOD_ANSWER, 'max_tokens'), searchReply('Encontrei algumas empresas, veja abaixo.')]) {
      const { client } = fakeMessages(reply);
      const result = await discoverSuppliers(
        { session: session(tucurui().client), projectId: PROJECT, requirementId: REQ },
        { gateway: new ApexAIGateway([new AnthropicApexAdapter(client)]), audit, env: ENABLED, ...brake() },
      );
      expect(result).toEqual({ ok: false, reason: 'error', message: DISCOVERY_MESSAGE.unreadableAnswer, error: DISCOVERY_MESSAGE.unreadableAnswer });
    }
    expect(audit).toHaveBeenCalledTimes(2);
  });

  it('pause_turn e tempo esgotado viram erro dito em português, auditado sem conteúdo', async () => {
    enableProcessEnv();
    const audit = vi.fn(async () => ({ ok: true as const }));
    const { client } = fakeMessages(searchReply(GOOD_ANSWER, 'pause_turn'));
    const paused = await discoverSuppliers(
      { session: session(tucurui().client), projectId: PROJECT, requirementId: REQ },
      { gateway: new ApexAIGateway([new AnthropicApexAdapter(client)]), audit, env: ENABLED, ...brake() },
    );
    expect(paused).toMatchObject({ ok: false, reason: 'error', message: DISCOVERY_MESSAGE.failed });
    const timeout = await discoverSuppliers(
      { session: session(tucurui().client), projectId: PROJECT, requirementId: REQ },
      { gateway: { generate: async () => { throw new ApexAIError('TIMEOUT', 'x', true); } }, audit, env: ENABLED, ...brake() },
    );
    expect(timeout).toMatchObject({ ok: false, reason: 'error', message: DISCOVERY_MESSAGE.timeout });
    expect(audit.mock.calls.map((c) => (c as unknown as [{ metadata: { outcome: string; error_code: string } }])[0].metadata))
      .toEqual([
        expect.objectContaining({ outcome: 'error', error_code: 'INVALID_RESPONSE', input_tokens: 5000 }),
        expect.objectContaining({ outcome: 'error', error_code: 'TIMEOUT' }),
      ]);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   D · Desligada, sem alçada, ou pedido inválido — nada chega ao provedor
   ══════════════════════════════════════════════════════════════════════════ */

describe('interruptores e recusas', () => {
  it('disponibilidade: IA, busca e chave do provedor da tarefa — o motivo da primeira que falha', () => {
    expect(supplierDiscoveryAvailability({})).toEqual({ available: false, reason: DISCOVERY_REASON.searchDisabled });
    expect(supplierDiscoveryAvailability({ APEX_AI_ENABLED: 'FALSE', ...ENABLED }))
      .toEqual({ available: false, reason: 'IA desligada nesta instalação' });
    expect(supplierDiscoveryAvailability({ APEX_AI_WEB_SEARCH_ENABLED: 'yes', ANTHROPIC_API_KEY: 'k' }))
      .toEqual({ available: false, reason: 'Busca externa desligada nesta instalação' });
    expect(supplierDiscoveryAvailability({ APEX_AI_WEB_SEARCH_ENABLED: 'true', OPENAI_API_KEY: 'k' }))
      .toEqual({ available: false, reason: 'Provedor de IA não configurado' });
    expect(supplierDiscoveryAvailability({ APEX_AI_WEB_SEARCH_ENABLED: 'true', ANTHROPIC_API_KEY: '  ' }))
      .toEqual({ available: false, reason: 'Provedor de IA não configurado' });
    expect(supplierDiscoveryAvailability(ENABLED)).toEqual({ available: true, reason: null });
  });

  it('desligada → ai_unavailable sem ler o banco, sem provedor, sem auditoria', async () => {
    const db = tucurui();
    const generate = vi.fn();
    const audit = vi.fn();
    const result = await discoverSuppliers(
      { session: session(db.client), projectId: PROJECT, requirementId: REQ },
      { gateway: { generate }, audit, env: {} },
    );
    expect(result).toEqual({
      ok: false, reason: 'ai_unavailable', message: 'Busca externa desligada nesta instalação', error: 'Busca externa desligada nesta instalação',
    });
    expect(db.selects).toHaveLength(0);
    expect(generate).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
  });

  it('sem alçada de compras → restricted (a sobreposição do banco é consultada)', async () => {
    const db = tucurui();
    const generate = vi.fn();
    const result = await discoverSuppliers(
      { session: session(db.client, ['projects.view', 'procurement.view']), projectId: PROJECT, requirementId: REQ },
      { gateway: { generate }, env: ENABLED },
    );
    expect(result).toMatchObject({ ok: false, reason: 'restricted', message: DISCOVERY_MESSAGE.restricted });
    expect(db.rpc).toHaveBeenCalledWith('current_user_has_permission', { permission_key: 'procurement.source' });
    expect(generate).not.toHaveBeenCalled();
  });

  it('com alçada mas sem ler requisitos → restricted (vazio da RLS não é "não existe")', async () => {
    const result = await discoverSuppliers(
      { session: session(tucurui().client, ['procurement.request']), projectId: PROJECT, requirementId: REQ },
      { gateway: { generate: vi.fn() }, env: ENABLED },
    );
    expect(result).toMatchObject({ ok: false, reason: 'restricted', message: DISCOVERY_MESSAGE.unreadable });
  });

  it('requisito de outro projeto, sem item, cancelado ou inexistente → invalid; leitura que falha → error', async () => {
    const generate = vi.fn();
    const run = (db: ReturnType<typeof fakeSupabase>, projectId = PROJECT) => discoverSuppliers(
      { session: session(db.client), projectId, requirementId: REQ }, { gateway: { generate }, env: ENABLED });
    expect(await run(tucurui(), 'outro-projeto')).toMatchObject({ reason: 'invalid', message: DISCOVERY_MESSAGE.requirementNotFound });
    expect(await run(tucurui({ requirement: { status: 'CANCELLED' } }))).toMatchObject({ reason: 'invalid' });
    expect(await run(tucurui({ requirement: { item_id: null } }))).toMatchObject({ reason: 'invalid', message: DISCOVERY_MESSAGE.noItem });
    expect(await run(tucurui({ requirement: { requirement_type: 'WORKFORCE' } }))).toMatchObject({ reason: 'invalid', message: DISCOVERY_MESSAGE.noItem });
    expect(await run(tucurui({ item: null }))).toMatchObject({ reason: 'invalid', message: DISCOVERY_MESSAGE.noItem });
    expect(await run(fakeSupabase({}))).toMatchObject({ reason: 'invalid', message: DISCOVERY_MESSAGE.requirementNotFound });
    expect(await run(fakeSupabase({ project_requirements: { rows: [], error: { message: 'boom' } } })))
      .toEqual({ ok: false, reason: 'error', message: DISCOVERY_MESSAGE.readError, error: DISCOVERY_MESSAGE.readError });
    expect(generate).not.toHaveBeenCalled();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   F · Freio de custo — reaproveitar, esperar a busca em voo, teto em 24 h
   ══════════════════════════════════════════════════════════════════════════ */

describe('freio de custo: cada busca é paga', () => {
  const T0 = Date.parse('2026-09-25T12:00:00Z');
  const OTHER_USER = '1f2e3d4c-3333-4444-8555-666677778888';
  const iso = (ms: number) => new Date(ms).toISOString();

  const paidResponse = (): ApexAIResponse<unknown> => ({
    text: GOOD_ANSWER, output: null, stopReason: 'end_turn',
    provenance: {
      provider: 'anthropic', model: 'claude-sonnet-5', task: 'SUPPLIER_WEB_DISCOVERY',
      usage: { inputTokens: 5000, outputTokens: 900, webSearchRequests: 2 }, durationMs: 1, attempts: 1,
    },
    sources: [{ url: RESULT_A, title: 'a' }, { url: RESULT_B, title: 'b' }, { url: CITED, title: 'c' }],
    searchErrors: [],
  });

  /** Um provedor falso que conta chamadas e pode segurar a resposta (para simular pedidos simultâneos). */
  function paidGateway() {
    const waiting: Array<() => void> = [];
    let held = false;
    const generate = vi.fn(async () => {
      if (held) await new Promise<void>((resolve) => { waiting.push(resolve); });
      return paidResponse();
    });
    return {
      gateway: { generate } as never, generate,
      hold() { held = true; },
      release() { held = false; waiting.splice(0).forEach((resolve) => resolve()); },
    };
  }

  const item = (description: string) => tucurui({ item: { description } });
  const ask = (deps: DiscoveryDeps, db = tucurui(), userId = USER) => discoverSuppliers(
    { session: session(db.client, undefined, userId), projectId: PROJECT, requirementId: REQ }, deps);

  it('o mesmo material na mesma organização reaproveita a busca por 30 min — sem provedor, sem auditoria', async () => {
    let t = T0;
    const paid = paidGateway();
    const audit = vi.fn(async () => ({ ok: true as const }));
    const b = brake();
    const deps: DiscoveryDeps = { gateway: paid.gateway, audit, env: ENABLED, now: () => new Date(t), ...b };

    const first = await ask(deps);
    expect(first).toMatchObject({ ok: true, runAt: iso(T0) });
    t = T0 + DISCOVERY_REUSE_MS - 1;
    // Outra pessoa da mesma organização: passa pela própria alçada e leitura, e recebe a busca de antes (runAt original).
    expect(await ask(deps, tucurui(), OTHER_USER)).toEqual(first);
    expect(paid.generate).toHaveBeenCalledTimes(1);
    expect(audit).toHaveBeenCalledTimes(1);
    expect(b.usage).toHaveBeenCalledTimes(1);

    // Outra entrada (o item mudou) é outra busca; passada a janela, também.
    await ask(deps, item('Cabo de cobre 50 mm² 0,6/1 kV'));
    expect(paid.generate).toHaveBeenCalledTimes(2);
    t = T0 + DISCOVERY_REUSE_MS;
    expect(await ask(deps)).toMatchObject({ ok: true, runAt: iso(t) });
    expect(paid.generate).toHaveBeenCalledTimes(3);
  });

  it('falha não é reaproveitada: tentar de novo busca de novo', async () => {
    const generate = vi.fn()
      .mockRejectedValueOnce(new ApexAIError('TIMEOUT', 'x', true))
      .mockResolvedValueOnce(paidResponse());
    const deps: DiscoveryDeps = { gateway: { generate } as never, audit: vi.fn(async () => ({ ok: true as const })), env: ENABLED, ...brake() };
    expect(await ask(deps)).toMatchObject({ ok: false, message: DISCOVERY_MESSAGE.timeout });
    expect(await ask(deps)).toMatchObject({ ok: true });
    expect(generate).toHaveBeenCalledTimes(2);
  });

  it('pedidos simultâneos do mesmo material esperam a MESMA busca', async () => {
    const paid = paidGateway();
    paid.hold();
    const audit = vi.fn(async () => ({ ok: true as const }));
    const deps: DiscoveryDeps = { gateway: paid.gateway, audit, env: ENABLED, ...brake() };
    const pending = [ask(deps), ask(deps, tucurui(), OTHER_USER), ask(deps)];
    await vi.waitFor(() => expect(paid.generate).toHaveBeenCalledTimes(1));
    paid.release();
    const results = await Promise.all(pending);
    expect(paid.generate).toHaveBeenCalledTimes(1);
    expect(audit).toHaveBeenCalledTimes(1);
    expect(results.every((r) => r.ok)).toBe(true);
    expect(results[1]).toEqual(results[0]);
  });

  it('teto por pessoa em 24 h, contado na auditoria: acima dele, "Aguarde…" — sem provedor, sem auditoria', async () => {
    const generate = vi.fn();
    const audit = vi.fn();
    // 20 buscas na janela; a mais velha sai dela em 10 min.
    const stamps = [...Array.from({ length: 19 }, (_, i) => iso(T0 - (i + 1) * 60_000)), iso(T0 - DISCOVERY_WINDOW_MS + 10 * 60_000)];
    const b = brake({ user: stamps, org: stamps });
    const res = await ask({ gateway: { generate } as never, audit, env: ENABLED, now: () => new Date(T0), ...b });
    const message = 'Você já fez 20 buscas na internet nas últimas 24 horas — o limite por pessoa. '
      + 'Aguarde cerca de 10 min para buscar de novo; a lista interna segue valendo.';
    expect(res).toEqual({ ok: false, reason: 'error', message, error: message });
    expect(b.usage).toHaveBeenCalledWith({
      organizationId: ORG, userId: USER, since: iso(T0 - DISCOVERY_WINDOW_MS), limits: DISCOVERY_LIMIT_DEFAULT,
    });
    expect(generate).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
  });

  it('teto da organização, e tetos ajustáveis pelo ambiente', async () => {
    const generate = vi.fn(async () => paidResponse());
    const audit = vi.fn(async () => ({ ok: true as const }));
    const org = await ask({
      gateway: { generate } as never, audit, env: ENABLED, now: () => new Date(T0),
      ...brake({ org: Array.from({ length: 100 }, () => iso(T0 - 60 * 60_000)) }),
    });
    expect(org).toMatchObject({ ok: false, reason: 'error' });
    expect(org.ok ? '' : org.message).toMatch(/^A organização já fez 100 buscas na internet nas últimas 24 horas .* Aguarde cerca de 23 h/);

    const env = { ...ENABLED, APEX_AI_WEB_SEARCH_DAILY_USER_LIMIT: '2' };
    const now = () => new Date(T0);
    expect(await ask({ gateway: { generate } as never, audit, env, now, ...brake({ user: [iso(T0 - 1), iso(T0 - 2)] }) }))
      .toMatchObject({ ok: false, message: expect.stringContaining('Você já fez 2 buscas') });
    expect(await ask({ gateway: { generate } as never, audit, env, now, ...brake({ user: [iso(T0 - 1)] }) })).toMatchObject({ ok: true });
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it('rajada no mesmo processo: o teto vale antes de a auditoria alcançar', async () => {
    const paid = paidGateway();
    paid.hold();
    const audit = vi.fn(async () => ({ ok: true as const }));
    const b = brake(); // a auditoria "ainda não viu" nada
    const deps: DiscoveryDeps = { gateway: paid.gateway, audit, env: { ...ENABLED, APEX_AI_WEB_SEARCH_DAILY_USER_LIMIT: '2' }, ...b };
    const burst = [ask(deps, item('Item 1')), ask(deps, item('Item 2')), ask(deps, item('Item 3'))];
    await vi.waitFor(() => expect(paid.generate).toHaveBeenCalledTimes(2));
    paid.release();
    const results = await Promise.all(burst);
    expect(results.filter((r) => r.ok)).toHaveLength(2);
    expect(results.find((r) => !r.ok)).toMatchObject({ reason: 'error', message: expect.stringContaining('Você já fez 2 buscas') });
    // Depois: a memória do processo ainda conta as duas, mesmo com a auditoria vazia.
    expect(await ask(deps, item('Item 4'))).toMatchObject({ ok: false, message: expect.stringContaining('Aguarde') });
    expect(paid.generate).toHaveBeenCalledTimes(2);
  });

  it('auditoria + o que está em curso aqui: uma busca em voo conta antes de ser auditada', async () => {
    const paid = paidGateway();
    paid.hold();
    const deps: DiscoveryDeps = {
      gateway: paid.gateway, audit: vi.fn(async () => ({ ok: true as const })),
      env: { ...ENABLED, APEX_AI_WEB_SEARCH_DAILY_USER_LIMIT: '3' }, guard: new DiscoveryGuard(),
      // Duas buscas de outro processo já auditadas; nenhuma deste.
      usage: vi.fn(async () => ({ user: [iso(Date.now() - 60_000), iso(Date.now() - 120_000)], org: [] })),
    };
    const inFlight = ask(deps, item('Item A'));
    await vi.waitFor(() => expect(paid.generate).toHaveBeenCalledTimes(1));
    expect(await ask(deps, item('Item B'))).toMatchObject({ ok: false, message: expect.stringContaining('Você já fez 3 buscas') });
    paid.release();
    expect(await inFlight).toMatchObject({ ok: true });
    expect(paid.generate).toHaveBeenCalledTimes(1);
  });

  it('quem esperava uma busca que não chegou ao provedor (teto de OUTRA pessoa) segue pelo próprio caminho', async () => {
    let open: () => void = () => {};
    const gate = new Promise<void>((resolve) => { open = resolve; });
    const usage = vi.fn(async ({ userId }: { userId: string }) => {
      await gate;
      return userId === USER ? { user: [iso(Date.now())], org: [] } : { user: [], org: [] };
    });
    const generate = vi.fn(async () => paidResponse());
    const deps: DiscoveryDeps = {
      gateway: { generate } as never, audit: vi.fn(async () => ({ ok: true as const })),
      env: { ...ENABLED, APEX_AI_WEB_SEARCH_DAILY_USER_LIMIT: '1' }, guard: new DiscoveryGuard(), usage,
    };
    const capped = ask(deps);
    await vi.waitFor(() => expect(usage).toHaveBeenCalledTimes(1));
    const other = ask(deps, tucurui(), OTHER_USER);
    open();
    expect(await capped).toMatchObject({ ok: false, message: expect.stringContaining('Você já fez 1 busca na internet') });
    expect(await other).toMatchObject({ ok: true });
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it('sem conseguir contar, não busca — e a reserva é desfeita', async () => {
    const generate = vi.fn(async () => paidResponse());
    const guard = new DiscoveryGuard();
    const base = { gateway: { generate } as never, audit: vi.fn(async () => ({ ok: true as const })), guard };
    const env = { ...ENABLED, APEX_AI_WEB_SEARCH_DAILY_USER_LIMIT: '1' };
    const broken = await ask({ ...base, env, usage: vi.fn(async () => { throw new Error('banco fora'); }) });
    expect(broken).toEqual({ ok: false, reason: 'error', message: DISCOVERY_MESSAGE.usageUnknown, error: DISCOVERY_MESSAGE.usageUnknown });
    expect(generate).not.toHaveBeenCalled();
    // A tentativa recusada não gastou o teto de 1.
    expect(await ask({ ...base, env, usage: vi.fn(async () => ({ user: [], org: [] })) })).toMatchObject({ ok: true });
  });

  it('a contagem durável lê a trilha de auditoria: organização, ação, janela, pessoa, mais novas primeiro', async () => {
    const queries: Array<Array<unknown[]>> = [];
    const rows = (userScoped: boolean) => (userScoped ? Array.from({ length: 20 }, () => ({ created_at: '2026-09-25 11:00:00.123456+00' })) : []);
    const fake = (fail: boolean) => ({
      from(table: string) {
        const ops: unknown[][] = [['from', table]];
        queries.push(ops);
        const builder = {
          select: (...a: unknown[]) => { ops.push(['select', ...a]); return builder; },
          eq: (...a: unknown[]) => { ops.push(['eq', ...a]); return builder; },
          gte: (...a: unknown[]) => { ops.push(['gte', ...a]); return builder; },
          order: (...a: unknown[]) => { ops.push(['order', ...a]); return builder; },
          limit: async (...a: unknown[]) => {
            ops.push(['limit', ...a]);
            return fail ? { data: null, error: { message: 'x' } }
              : { data: rows(ops.some((o) => o[0] === 'eq' && o[1] === 'actor_user_id')), error: null };
          },
        };
        return builder;
      },
    });
    const generate = vi.fn();
    const deps = { gateway: { generate } as never, env: ENABLED, now: () => new Date(T0), guard: new DiscoveryGuard() };

    mocks.serviceClient.mockReturnValue(fake(false));
    expect(await ask(deps)).toMatchObject({ ok: false, message: expect.stringContaining('Você já fez 20 buscas') });
    const since = iso(T0 - DISCOVERY_WINDOW_MS);
    const common = [['from', 'audit_logs'], ['select', 'created_at'], ['eq', 'organization_id', ORG], ['eq', 'action', DISCOVERY_AUDIT_ACTION], ['gte', 'created_at', since]];
    expect(queries).toEqual([
      [...common, ['eq', 'actor_user_id', USER], ['order', 'created_at', { ascending: false }], ['limit', 20]],
      [...common, ['order', 'created_at', { ascending: false }], ['limit', 100]],
    ]);

    mocks.serviceClient.mockReturnValue(fake(true));
    expect(await ask(deps)).toMatchObject({ ok: false, message: DISCOVERY_MESSAGE.usageUnknown });
    expect(generate).not.toHaveBeenCalled();
  });

  it('regras puras: janela móvel, espera em português, tetos do ambiente', () => {
    expect(windowFreeAt([T0 - 1_000, T0 - 2_000], 3, T0)).toBeNull();
    // A que está exatamente a 24 h já saiu da janela.
    expect(windowFreeAt([T0 - 1_000, T0 - 2_000, T0 - DISCOVERY_WINDOW_MS], 2, T0)).toBe(T0 - 2_000 + DISCOVERY_WINDOW_MS);
    expect(waitText(30_000)).toBe('cerca de 1 min');
    expect(waitText(10 * 60_000)).toBe('cerca de 10 min');
    expect(waitText(90 * 60_000)).toBe('cerca de 2 h');
    expect(discoveryLimits({})).toEqual(DISCOVERY_LIMIT_DEFAULT);
    expect(discoveryLimits({ APEX_AI_WEB_SEARCH_DAILY_USER_LIMIT: '5', APEX_AI_WEB_SEARCH_DAILY_ORG_LIMIT: ' 50 ' })).toEqual({ user: 5, org: 50 });
    for (const bad of ['0', '-1', '2.5', 'abc', '', '99999']) {
      expect(discoveryLimits({ APEX_AI_WEB_SEARCH_DAILY_USER_LIMIT: bad }).user, bad).toBe(DISCOVERY_LIMIT_DEFAULT.user);
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   E · A rota
   ══════════════════════════════════════════════════════════════════════════ */

describe('POST /api/dashboard/site/[projectId]/supply/discover', () => {
  const post = (projectId: string, body: unknown) => POST(
    new Request(`http://localhost/api/dashboard/site/${projectId}/supply/discover`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
    { params: Promise.resolve({ projectId }) },
  );

  it('sem sessão: a resposta da fronteira de sessão, intacta', async () => {
    mocks.requireCommercialSession.mockResolvedValue({ error: new Response(JSON.stringify({ ok: false, error: 'Não autenticado.' }), { status: 401 }) });
    const res = await post(PROJECT, { requirementId: REQ });
    expect(res.status).toBe(401);
  });

  it('corpo ou ids inválidos → 200 com invalid (e `error` repetindo a mensagem)', async () => {
    mocks.requireCommercialSession.mockResolvedValue(session(tucurui().client));
    for (const [projectId, body] of [
      [PROJECT, 'não é json'], [PROJECT, {}], [PROJECT, { requirementId: 42 }], [PROJECT, { requirementId: 'abc' }],
      ['proj com espaço', { requirementId: REQ }], ['x'.repeat(129), { requirementId: REQ }],
    ] as Array<[string, unknown]>) {
      const res = await post(projectId, body);
      expect(res.status).toBe(200);
      expect(res.headers.get('cache-control')).toBe('no-store');
      expect(await res.json()).toEqual({ ok: false, reason: 'invalid', message: DISCOVERY_MESSAGE.invalid, error: DISCOVERY_MESSAGE.invalid });
    }
  });

  it('sem alçada → 200 restricted; busca desligada (o QA) → 200 ai_unavailable, sem escrita', async () => {
    delete process.env.APEX_AI_WEB_SEARCH_ENABLED;
    mocks.requireCommercialSession.mockResolvedValue(session(tucurui().client, ['projects.view']));
    const denied = await post(PROJECT, { requirementId: REQ });
    expect(denied.status).toBe(200);
    expect(await denied.json()).toMatchObject({ ok: false, reason: 'restricted' });

    const db = tucurui();
    mocks.requireCommercialSession.mockResolvedValue(session(db.client, ['procurement.source', 'procurement.request', 'projects.view']));
    const off = await post(PROJECT, { requirementId: REQ });
    expect(off.status).toBe(200);
    expect(await off.json()).toEqual({
      ok: false, reason: 'ai_unavailable', message: 'Busca externa desligada nesta instalação', error: 'Busca externa desligada nesta instalação',
    });
    expect(db.selects).toHaveLength(0);
  });
});
