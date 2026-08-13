/**
 * Parser dos eventos do eSocial.
 *
 * O leiaute é profundo e varia entre versões, então a estratégia aqui é
 * deliberadamente tolerante: procura os nós pelo nome em qualquer profundidade,
 * em vez de fixar caminhos completos. Uma versão nova do leiaute que aprofunde
 * um nó não quebra a ingestão; um campo que suma vira `undefined`, não exceção.
 */
import { XMLParser, XMLBuilder } from 'fast-xml-parser';

export interface ParsedEsocialEvent {
  eventType: string;
  /** Atributo Id do evento — chave natural de deduplicação. */
  eventId?: string;
  receiptNumber?: string;
  /** Período de apuração declarado: 'AAAA-MM' no mensal, 'AAAA' no 13º. */
  competence?: string;
  /** True quando o evento é da apuração anual (13º salário). */
  annualApuracao?: boolean;
  cpf?: string;
  workerName?: string;
  matricula?: string;
  areaCode?: string;
  areaLabel?: string;
  /**
   * Data do fato declarada no evento (acidente, exame, admissão…), quando há.
   * Serve de última âncora de competência para os eventos que ainda não têm
   * payload tipado — sem ela, eles ficariam sem competência no banco e a
   * reapuração nunca os encontraria quando virarem indicador.
   */
  eventDate?: string;
  /**
   * Origem declarada no `ideEvento`, presente em TODO evento do leiaute.
   *
   * `procEmi` diz quem emitiu (1 = software do empregador, 2 = portal, 3 = app)
   * e `verProc` a versão desse software. Não vira indicador de negócio, mas é o
   * que responde "de onde veio este mês" quando duas competências divergem —
   * folha fechada pelo escritório contábil e folha lançada à mão no portal têm
   * qualidade diferente e o número sozinho não conta essa diferença.
   */
  origin?: EventOrigin;
  /**
   * XML só deste evento, reconstruído a partir do nó.
   *
   * O arquivo de origem é um lote com dezenas de eventos; guardar o lote
   * inteiro em cada linha multiplicaria o mesmo documento dezenas de vezes.
   * O fragmento por evento mantém a linha autocontida e a reapuração simples —
   * uma linha, um evento. A integridade do arquivo original fica registrada
   * pelo SHA-256 gravado junto.
   */
  eventXml: string;
  /** Campos já tipados por família de evento. */
  payload: ParsedPayload;
}

/** Procedência do evento, lida do `ideEvento`. */
export interface EventOrigin {
  /** procEmi — 1 empregador, 2 portal, 3 aplicativo governamental. */
  procEmi?: string;
  /** verProc — versão do software emissor. */
  verProc?: string;
  /** tpAmb — 1 produção, 2 produção restrita. */
  tpAmb?: string;
  /** indRetif — 1 original, 2 retificação. */
  indRetif?: string;
}

export type ParsedPayload =
  | RemunerationPayload
  | PaymentPayload
  | AdmissionPayload
  | TerminationPayload
  | AbsencePayload
  | TotalizerPayload
  | RubricTablePayload
  | CatPayload
  | AsoPayload
  | RiskExposurePayload
  | PeriodClosePayload
  | ExclusionPayload
  | { kind: 'unknown' };

/**
 * Verbas do S-1200, deliberadamente SEM classificar.
 *
 * O evento de remuneração não diz se a verba é provento, desconto ou
 * informativa — `vrRubr` vem sempre positivo e a natureza não é declarada aqui.
 * Quem sabe disso é a tabela de rubricas (S-1010), que é um evento separado.
 * Classificar dentro do parser exigiria adivinhar; a classificação acontece no
 * normalizador, que já tem o acervo inteiro em mãos.
 */
export interface RemunerationPayload {
  kind: 'remuneration';
  rubricas: RubricaItem[];
}

export interface RubricaItem {
  code: string;
  /** ideTabRubr — o mesmo código pode existir em tabelas diferentes. */
  tableId?: string;
  amountCents: number;
  /** Quantidade e fator declarados (horas, dias, percentual), quando há. */
  quantity?: number;
  factor?: number;
}

/** Tabela de rubricas do empregador (S-1010) — o dicionário da folha. */
export interface RubricTablePayload {
  kind: 'rubric-table';
  rubricas: {
    code: string;
    tableId: string;
    nature?: string;
    type?: string;
    description?: string;
    validFrom?: string;
  }[];
}

export interface PaymentPayload {
  kind: 'payment';
  netPaidCents: number;
}

export interface AdmissionPayload {
  kind: 'admission';
  admissionDate?: string;
  cboCode?: string;
  jobTitle?: string;
  contractType?: string;
}

export interface TerminationPayload {
  kind: 'termination';
  terminationDate?: string;
  reasonCode?: string;
}

/**
 * Um S-2230 declara o INÍCIO ou o FIM de um afastamento, quase nunca os dois.
 *
 * O retorno do trabalhador vem num evento próprio, com `fimAfastamento` e sem
 * `dtIniAfast` — nos dados reais são 249 fins para 243 inícios. Ler cada evento
 * isoladamente faz todo afastamento parecer eternamente aberto; o período é
 * reconstruído no normalizador, emparelhando início e fim do mesmo trabalhador.
 */
export interface AbsencePayload {
  kind: 'absence';
  startDate?: string;
  endDate?: string;
  reasonCode?: string;
  /**
   * Duração total, do início ao fim (ou até hoje, se em aberto).
   *
   * Serve de leitura do evento; NÃO é o que entra no absenteísmo do mês. Um
   * auxílio-doença de seis meses tem 180 dias de duração e nenhum mês com 180
   * dias de falta — a distribuição por competência é feita no normalizador.
   */
  totalDays: number;
}

export interface TotalizerPayload {
  kind: 'totalizer';
  /** INSS total da guia (todos os códigos de receita do contribuinte). */
  inssCents?: number;
  /** Parte retida dos segurados, contida no total acima. */
  inssWithheldCents?: number;
  irrfCents?: number;
  fgtsCents?: number;
  /** Base de cálculo da contribuição previdenciária apurada pelo eSocial. */
  cpBaseCents?: number;
  fgtsBaseCents?: number;
  ratFapRate?: number;
  /**
   * Base por lotação tributária, como o eSocial a apurou.
   *
   * É o recorte por área vindo da fonte autoritativa. O mesmo corte somado a
   * partir das rubricas do S-1200 depende da tabela de rubricas estar completa;
   * este não depende de nada além do próprio totalizador.
   */
  baseByLotacao?: { code: string; baseCents: number }[];
  /**
   * Recibo do fechamento que gerou este totalizador (`nrRecArqBase`).
   *
   * É a identidade da VERSÃO. O eSocial reemite o totalizador inteiro a cada
   * reprocessamento da competência, e as versões antigas continuam no pacote —
   * somá-las multiplicaria a guia pelo número de retificações.
   */
  version?: string;
}

/**
 * Comunicação de Acidente de Trabalho (S-2210).
 *
 * O afastamento NÃO é declarado no corpo da CAT: vem em `atestado > indAfast`,
 * e nas versões mais antigas do leiaute como `houveAfast`. Ler os dois é o que
 * evita classificar como "sem afastamento" um acidente que afastou — o que
 * inverteria justamente o indicador mais grave da seção.
 */
export interface CatPayload {
  kind: 'cat';
  accidentDate?: string;
  accidentTime?: string;
  /** tpCat — 1 inicial, 2 reabertura, 3 comunicação de óbito. */
  catType?: string;
  /** tpAcid — código da tabela 14 (típico, trajeto, doença). */
  accidentKind?: string;
  /** tpLocal — onde o acidente ocorreu. */
  localKind?: string;
  situationCode?: string;
  /** iniciatCAT — 1 empregador, 2 ordem judicial, 3 determinação de órgão. */
  initiator?: string;
  /**
   * `undefined` quando o evento não declarou — e aí o indicador fica ausente,
   * porque "não declarado" e "não afastou" são coisas diferentes.
   */
  causedLeave?: boolean;
  deathDate?: string;
  bodyPartCode?: string;
  causingAgentCode?: string;
}

/**
 * Monitoramento da saúde do trabalhador (S-2220) — o ASO.
 *
 * O leiaute NÃO carrega data de vencimento; ela é derivada mais adiante, e só
 * quando o tipo de exame permite. Ver `sst.ts`.
 */
export interface AsoPayload {
  kind: 'aso';
  asoDate?: string;
  /** tpExameOcup — 0 admissional, 1 periódico, 2 retorno, 3 mudança de risco, 9 demissional. */
  examKind?: string;
  /** resAso — 1 apto, 2 inapto. */
  result?: string;
  /**
   * Exames que compõem o ASO.
   *
   * O código do exame é o próprio `procRealizado` (Tabela 27 — Procedimentos
   * Diagnósticos); não existe um `codExame` no leiaute. `indResult` é o único
   * campo que diz se o exame ACHOU alguma coisa (1 normal, 2 alterado,
   * 5 ocupacional) — sem ele, um ASO alterado é indistinguível de um normal.
   */
  exams: { code?: string; date?: string; result?: string }[];
}

/**
 * Condições ambientais do trabalho (S-2240) — agentes nocivos.
 *
 * O nome do nó do fator de risco mudou entre versões (`fatRisco/codFatRis` no
 * S-1.x, `agNoc/codAgNoc` antes). Os dois são lidos porque o acervo importado
 * costuma atravessar versões de leiaute.
 */
export interface RiskExposurePayload {
  kind: 'risk-exposure';
  startDate?: string;
  endDate?: string;
  environmentCode?: string;
  /**
   * EPC/EPI ficam DENTRO de cada agente (`agNoc > epcEpi`), e não no evento.
   * Lê-los da raiz colapsaria vários veredictos num só: um S-2240 com ruído
   * protegido por EPI e calor sem proteção apareceria como "protegido".
   */
  agents: {
    code?: string;
    description?: string;
    /** tpAval — 1 quantitativo, 2 qualitativo. */
    assessment?: string;
    intensity?: string;
    toleranceLimit?: string;
    unit?: string;
    epcEfficient?: boolean;
    epiEfficient?: boolean;
  }[];
}

/**
 * Fechamento dos eventos periódicos (S-1299).
 *
 * É o evento que diz que a competência foi encerrada. Sem ele, os totalizadores
 * podem existir e a competência ainda assim não estar fechada — distinção que a
 * auditoria precisa fazer e que nenhum outro evento responde.
 */
export interface PeriodClosePayload {
  kind: 'period-close';
  /** indApuracao — 1 mensal, 2 anual (13º). */
  apuracaoKind?: string;
  /** Flags `S`/`N` de quais famílias foram declaradas na competência. */
  hasRemuneration?: boolean;
  hasPayments?: boolean;
}

/**
 * Exclusão de evento (S-3000).
 *
 * Carrega o tipo e o recibo do evento ALVO, e é isso que permite ligar a
 * exclusão ao que foi excluído. Sem esse vínculo, um S-3000 é só uma linha a
 * mais no acervo e a contagem de eventos passa a mentir.
 */
export interface ExclusionPayload {
  kind: 'exclusion';
  /** tpEvento — código do evento excluído ('S-1200', 'S-2230'…). */
  targetEventType?: string;
  /** nrRecEvt — recibo do evento excluído. */
  targetReceipt?: string;
}

type XmlNode = Record<string, unknown>;

const builder = new XMLBuilder({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  suppressEmptyNode: true,
});

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  // Namespaces do eSocial variam (eSocial, ns2, tns…). Removê-los deixa a
  // busca por nome de nó estável entre versões e emissores.
  removeNSPrefix: true,
});

// ── Utilitários de navegação ────────────────────────────────────────────────

/** Primeiro nó com o nome dado, em qualquer profundidade. */
function findNode(root: unknown, name: string): XmlNode | undefined {
  return findAllNodes(root, name)[0];
}

/** Todos os nós com o nome dado, em qualquer profundidade (ordem de leitura). */
function findAllNodes(root: unknown, name: string): XmlNode[] {
  const out: XmlNode[] = [];
  const visit = (node: unknown) => {
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (!node || typeof node !== 'object') return;
    for (const [key, value] of Object.entries(node as XmlNode)) {
      if (key === name) {
        if (Array.isArray(value)) value.forEach((v) => { if (v && typeof v === 'object') out.push(v as XmlNode); });
        else if (value && typeof value === 'object') out.push(value as XmlNode);
        else out.push({ '#text': value } as XmlNode);
      }
      visit(value);
    }
  };
  visit(root);
  return out;
}

/** Valor escalar do primeiro nó com o nome dado. */
function findValue(root: unknown, name: string): string | undefined {
  const nodes = findAllNodes(root, name);
  for (const n of nodes) {
    const v = n['#text'] ?? n;
    if (typeof v === 'string' && v.length > 0) return v;
    if (typeof v === 'number') return String(v);
  }
  return undefined;
}

/** Soma de todos os nós escalares com o nome dado, em centavos. */
function sumCents(root: unknown, name: string): number {
  return findAllNodes(root, name).reduce((sum, n) => {
    const v = n['#text'] ?? n;
    return sum + toCents(typeof v === 'string' || typeof v === 'number' ? v : undefined);
  }, 0);
}

/**
 * Soma `field` apenas dentro dos nós `parent`.
 *
 * Necessária porque o S-5011 traz a MESMA lista de códigos de receita duas
 * vezes: `infoCREstab` (por estabelecimento) e `infoCRContrib` (consolidado do
 * contribuinte). Uma varredura global de `vrCR` somaria as duas e dobraria a
 * guia.
 */
function sumCentsIn(root: unknown, parent: string, field: string): number {
  return findAllNodes(root, parent).reduce((sum, node) => sum + sumCents(node, field), 0);
}

function toNumber(value: string | undefined): number | undefined {
  if (value === undefined || value === '') return undefined;
  const n = Number(String(value).replace(',', '.'));
  return Number.isFinite(n) ? n : undefined;
}

/** O eSocial usa ponto decimal; guardamos centavos para não arrastar float. */
function toCents(value: string | number | undefined): number {
  if (value === undefined || value === null || value === '') return 0;
  const n = typeof value === 'number' ? value : Number(String(value).replace(',', '.'));
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

/**
 * Indicador S/N do eSocial.
 *
 * Devolve `undefined` quando o campo não veio — e não `false`. Um evento que
 * não declarou afastamento não é um evento que declarou ausência de
 * afastamento; tratá-los igual esconde a lacuna dentro de um número.
 */
function toBoolSN(value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined;
  const v = value.trim().toUpperCase();
  if (v === 'S' || v === '1' || v === 'TRUE') return true;
  if (v === 'N' || v === '0' || v === 'FALSE') return false;
  return undefined;
}

/** Data 'AAAA-MM-DD' válida, ou `undefined`. */
function toDate(value: string | undefined): string | undefined {
  if (!value || !/^\d{4}-\d{2}-\d{2}/.test(value)) return undefined;
  return value.slice(0, 10);
}

function daysBetweenDates(start?: string, end?: string): number {
  if (!start) return 0;
  const s = Date.parse(`${start}T00:00:00Z`);
  // Afastamento em aberto conta até hoje — é assim que ele pesa no mês corrente.
  const e = end ? Date.parse(`${end}T00:00:00Z`) : Date.now();
  if (!Number.isFinite(s) || !Number.isFinite(e) || e < s) return 0;
  return Math.floor((e - s) / 86_400_000) + 1;
}

/**
 * Tag do XML → código do evento.
 *
 * O mapa cobre o leiaute inteiro, não só o que vira indicador hoje: TODO evento
 * do pacote é guardado, e guardar com o código certo é o que permite extrair um
 * indicador novo depois relendo o que já está no banco — sem pedir o arquivo de
 * novo ao escritório, o que a janela de retenção do eSocial nem sempre permite.
 *
 * Cuidado com os totalizadores: os pares "por trabalhador" e "consolidado por
 * contribuinte" têm nomes parecidos e significados diferentes. Quem paga a guia
 * é o consolidado (S-5011/S-5012/S-5013); os per-trabalhador (S-5001/S-5002/
 * S-5003) servem de base e conferência.
 */
const EVENT_TAG_TO_TYPE: Record<string, string> = {
  // Tabelas do empregador
  evtInfoEmpregador: 'S-1000',
  evtTabEstab: 'S-1005',
  evtTabRubrica: 'S-1010',
  evtTabLotacao: 'S-1020',
  evtTabCarreira: 'S-1030',
  evtTabHorContratual: 'S-1050',
  evtTabAmbiente: 'S-1060',
  evtTabProcesso: 'S-1070',
  evtTabOperPort: 'S-1080',

  // Periódicos
  evtRemun: 'S-1200',
  evtPgtos: 'S-1210',
  evtAqProd: 'S-1250',
  evtComProd: 'S-1260',
  evtContratAvNP: 'S-1270',
  evtInfoComplPer: 'S-1280',
  evtReabreEvPer: 'S-1298',
  evtFechaEvPer: 'S-1299',

  // Não periódicos — vínculo
  evtAdmissao: 'S-2200',
  evtAltCadastral: 'S-2205',
  evtAltContratual: 'S-2206',
  evtCAT: 'S-2210',
  evtMonit: 'S-2220',
  evtAfastTemp: 'S-2230',
  evtExpRisco: 'S-2240',
  evtAvPrevio: 'S-2250',
  evtConvInterm: 'S-2260',
  evtDeslig: 'S-2299',

  // Trabalhador sem vínculo
  evtTSVInicio: 'S-2300',
  evtTSVAltContr: 'S-2306',
  evtTSVTermino: 'S-2399',

  // Processo trabalhista
  evtProcTrab: 'S-2500',
  evtContProc: 'S-2501',

  // Exclusões
  evtExclusao: 'S-3000',
  evtExcProcTrab: 'S-3500',

  // Totalizadores por trabalhador
  evtBasesTrab: 'S-5001',
  evtIrrfBenef: 'S-5002',
  evtBasesFGTS: 'S-5003',

  // Totalizadores consolidados por contribuinte — origem dos valores de guia
  evtCS: 'S-5011',
  evtIrrf: 'S-5012',
  evtFGTS: 'S-5013',
};

/**
 * Localiza TODOS os nós de evento do documento.
 *
 * O arquivo entregue não é um evento: é um lote. A forma real é
 *   Envelope > Body > EnviarLoteEventos > loteEventos > eSocial >
 *   envioLoteEventos > eventos > evento > eSocial > evt*
 * com dezenas de eventos irmãos, e os arquivos de retorno ainda trazem os
 * totalizadores em `<tot><eSocial><evt*>`. Pegar só o primeiro descartava o
 * resto do lote — e era o que fazia S-5011 e S-5013 parecerem inexistentes,
 * quando na verdade vinham no mesmo arquivo, depois do primeiro evento.
 */
function findEventNodes(root: XmlNode): { tag: string; node: XmlNode }[] {
  const found: { tag: string; node: XmlNode }[] = [];

  const visit = (node: unknown, depth: number) => {
    if (depth > 14 || !node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      node.forEach((n) => visit(n, depth + 1));
      return;
    }
    for (const [key, value] of Object.entries(node as XmlNode)) {
      if (!value || typeof value !== 'object') continue;

      // Um mesmo tipo pode repetir no lote e vem como array.
      const candidates = Array.isArray(value) ? value : [value];
      const isEventTag =
        key.startsWith('evt') &&
        candidates.some((c) => c && typeof c === 'object' && ((c as XmlNode)['@_Id'] !== undefined));

      if (isEventTag || (key.startsWith('evt') && EVENT_TAG_TO_TYPE[key] !== undefined)) {
        for (const c of candidates) {
          if (c && typeof c === 'object') found.push({ tag: key, node: c as XmlNode });
        }
        // Não descer dentro do evento: seus filhos não são eventos.
        continue;
      }

      visit(value, depth + 1);
    }
  };

  visit(root, 0);
  return found;
}

// ── Parser público ──────────────────────────────────────────────────────────

export class EsocialParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EsocialParseError';
  }
}

/**
 * Amostra ASCII do início do documento, para diagnóstico.
 *
 * Só nomes de elemento e a declaração — nunca conteúdo. É o que permite dizer
 * "o arquivo é um retorno de lote, não um evento" em vez de "falha ao ler",
 * que não ajuda ninguém a resolver.
 */
function describeDocument(xml: string): string {
  const tags = [...xml.slice(0, 2000).matchAll(/<([A-Za-z_][\w.:-]*)/g)]
    .map((m) => m[1])
    .filter((t) => t !== '?xml')
    .slice(0, 4);
  return tags.length > 0 ? `raiz: ${tags.join(' > ')}` : 'sem elementos reconhecíveis';
}

/**
 * Campos de data usados como âncora, do mais específico para o mais genérico.
 * A ordem importa: um S-2210 traz `dtAcid` e também datas de atendimento; a
 * primeira da lista é a que situa o fato.
 */
const EVENT_DATE_FIELDS = [
  'dtAcid', 'dtAso', 'dtAdm', 'dtDeslig', 'dtIniAfast', 'dtTermAfast', 'dtAvPrv',
  'dtIniCondicao', 'dtAlteracao', 'dtInicio', 'dtEmis', 'dtTrans',
];

function findEventDate(node: XmlNode): string | undefined {
  for (const field of EVENT_DATE_FIELDS) {
    const value = findValue(node, field);
    // O eSocial usa AAAA-MM-DD; qualquer outra coisa não serve de âncora.
    if (value && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
  }
  return undefined;
}

/**
 * Todos os eventos de um documento.
 *
 * Cada evento é interpretado a partir do PRÓPRIO nó, nunca do documento
 * inteiro: num lote com dezenas de eventos, varrer a raiz faria todos herdarem
 * os valores do primeiro — CPF, competência e verbas trocados entre pessoas.
 */
export function parseEsocialEvents(xml: string): ParsedEsocialEvent[] {
  let root: XmlNode;
  try {
    root = parser.parse(xml) as XmlNode;
  } catch {
    throw new EsocialParseError(`XML inválido (${describeDocument(xml)})`);
  }

  const nodes = findEventNodes(root);
  if (nodes.length === 0) {
    throw new EsocialParseError(`nenhum nó de evento (evt*) encontrado — ${describeDocument(xml)}`);
  }

  // O recibo do lote vive fora dos eventos, no envelope de retorno, e vale para
  // todos eles. Serve de fallback quando o evento não carrega o próprio.
  const loteReceipt = findValue(root, 'nrRecibo');

  return nodes.map(({ tag, node }) => {
    const eventType = EVENT_TAG_TO_TYPE[tag] ?? tag;
    const perApur = findValue(node, 'perApur');
    const cpf = findValue(node, 'cpfTrab') ?? findValue(node, 'cpfBenef') ?? findValue(node, 'cpfExtNoInf');
    const areaCode = findValue(node, 'codLotacao');
    const areaLabel = findValue(node, 'nmLotacao') ?? findValue(node, 'descLotacao');

    return {
      eventType,
      eventId: (node['@_Id'] as string | undefined) ?? findValue(node, 'nrRecArqBase'),
      eventDate: findEventDate(node),
      receiptNumber: findValue(node, 'nrRecibo') ?? loteReceipt ?? findValue(node, 'nrRecArqBase'),
      // Apuração anual (13º) vem como 'AAAA'; mensal como 'AAAA-MM'.
      competence: perApur,
      annualApuracao: perApur !== undefined && /^\d{4}$/.test(perApur),
      cpf,
      workerName: findValue(node, 'nmTrab'),
      matricula: findValue(node, 'matricula'),
      areaCode,
      areaLabel: areaLabel ?? areaCode,
      origin: parseOrigin(node),
      eventXml: buildEventXml(tag, node),
      payload: parsePayload(eventType, node),
    };
  });
}

/**
 * Procedência declarada no `ideEvento`.
 *
 * Lê a partir do nó `ideEvento` quando ele existe, e não da raiz do evento: o
 * S-3000 embute o `ideEvento` do evento excluído, e uma busca solta pegaria a
 * versão do software que emitiu o evento apagado, não a do que apagou.
 */
function parseOrigin(node: XmlNode): EventOrigin | undefined {
  const ide = findNode(node, 'ideEvento') ?? node;
  const origin: EventOrigin = {
    procEmi: findValue(ide, 'procEmi'),
    verProc: findValue(ide, 'verProc'),
    tpAmb: findValue(ide, 'tpAmb'),
    indRetif: findValue(ide, 'indRetif'),
  };
  return Object.values(origin).some((v) => v !== undefined) ? origin : undefined;
}

/** Reconstrói o XML de um único evento, embrulhado no `<eSocial>` de praxe. */
function buildEventXml(tag: string, node: XmlNode): string {
  try {
    return builder.build({ eSocial: { [tag]: node } }) as string;
  } catch {
    return '';
  }
}

/**
 * Retorno de processamento de lote — recibos e ocorrências, sem evento.
 *
 * O pacote traz muitos `ConsultarLoteEventosResponse`: são a resposta do eSocial
 * ao lote transmitido. Não têm evento nenhum, então contá-los como falha é
 * ruído que esconde erro de verdade. E o conteúdo importa: as ocorrências são o
 * próprio governo apontando problema no dado enviado.
 */
export interface EsocialReturnDocument {
  /** Protocolo do lote — chave natural do retorno. */
  protocol?: string;
  responseCode?: string;
  responseDescription?: string;
  receiptNumbers: string[];
  /** Contagem por tipo; a descrição traz CPF e não sobe para a interface. */
  occurrences: { tipo?: string; codigo?: string }[];
}

const RETURN_ROOT_HINTS = [
  'ConsultarLoteEventosResult',
  'EnviarLoteEventosResult',
  'retornoProcessamentoLoteEventos',
  'retornoEnvioLoteEventos',
];

/**
 * Interpreta o documento como retorno de lote. Devolve `null` quando não for um
 * — assim quem chama distingue "retorno sem evento" de "arquivo ilegível".
 */
export function parseEsocialReturn(xml: string): EsocialReturnDocument | null {
  let root: XmlNode;
  try {
    root = parser.parse(xml) as XmlNode;
  } catch {
    return null;
  }

  const protocol = findValue(root, 'protocoloEnvioLote') ?? findValue(root, 'protocoloEnvio');
  const looksLikeReturn =
    protocol !== undefined ||
    RETURN_ROOT_HINTS.some((hint) => findNode(root, hint) !== undefined) ||
    findValue(root, 'cdResposta') !== undefined;

  if (!looksLikeReturn) return null;

  return {
    protocol,
    responseCode: findValue(root, 'cdResposta'),
    responseDescription: findValue(root, 'descResposta'),
    receiptNumbers: findAllNodes(root, 'nrRecibo')
      .map((n) => (typeof n['#text'] === 'string' ? n['#text'] : undefined))
      .filter((v): v is string => Boolean(v)),
    occurrences: findAllNodes(root, 'ocorrencia').map((o) => ({
      tipo: findValue(o, 'tipo'),
      codigo: findValue(o, 'codigo'),
    })),
  };
}

/** Primeiro evento do documento. Mantido para chamadas que tratam um evento só. */
export function parseEsocialEventXml(xml: string): ParsedEsocialEvent {
  return parseEsocialEvents(xml)[0];
}

function parsePayload(eventType: string, root: XmlNode): ParsedPayload {
  switch (eventType) {
    case 'S-1200':
      return {
        kind: 'remuneration',
        rubricas: findAllNodes(root, 'itensRemun').map((item) => ({
          code: String(findValue(item, 'codRubr') ?? ''),
          tableId: findValue(item, 'ideTabRubr'),
          amountCents: toCents(findValue(item, 'vrRubr')),
          quantity: toNumber(findValue(item, 'qtdRubr')),
          factor: toNumber(findValue(item, 'fatorRubr')),
        })),
      };

    case 'S-1010':
      // Um S-1010 descreve UMA rubrica, sob `inclusao`, `alteracao` ou
      // `exclusao`. Ler pelo nó `ideRubrica`/`dadosRubrica` cobre os três sem
      // depender de qual operação veio.
      return {
        kind: 'rubric-table',
        rubricas: findAllNodes(root, 'ideRubrica').map((ide, i) => {
          const dados = findAllNodes(root, 'dadosRubrica')[i];
          return {
            code: String(findValue(ide, 'codRubr') ?? ''),
            tableId: String(findValue(ide, 'ideTabRubr') ?? ''),
            validFrom: findValue(ide, 'iniValid'),
            nature: dados ? findValue(dados, 'natRubr') : undefined,
            type: dados ? findValue(dados, 'tpRubr') : undefined,
            description: dados ? findValue(dados, 'dscRubr') : undefined,
          };
        }),
      };

    case 'S-1210':
      return { kind: 'payment', netPaidCents: sumCents(root, 'vrLiq') || sumCents(root, 'vrPgto') };

    case 'S-2200':
      return {
        kind: 'admission',
        admissionDate: findValue(root, 'dtAdm'),
        cboCode: findValue(root, 'codCBO'),
        jobTitle: findValue(root, 'nmCargo') ?? findValue(root, 'dscCargo'),
        contractType: findValue(root, 'tpRegTrab'),
      };

    case 'S-2299':
      return {
        kind: 'termination',
        terminationDate: findValue(root, 'dtDeslig'),
        reasonCode: findValue(root, 'mtvDeslig'),
      };

    case 'S-2230': {
      const startDate = findValue(root, 'dtIniAfast');
      const endDate = findValue(root, 'dtTermAfast');
      return {
        kind: 'absence',
        startDate,
        endDate,
        reasonCode: findValue(root, 'codMotAfast'),
        totalDays: daysBetweenDates(startDate, endDate),
      };
    }

    // ── SST: acidente, saúde ocupacional e exposição a risco ──
    case 'S-2210': {
      const atestado = findNode(root, 'atestado');
      return {
        kind: 'cat',
        accidentDate: toDate(findValue(root, 'dtAcid')),
        accidentTime: findValue(root, 'hrAcid'),
        catType: findValue(root, 'tpCat'),
        accidentKind: findValue(root, 'tpAcid'),
        localKind: findValue(root, 'tpLocal'),
        situationCode: findValue(root, 'codSitGeradora'),
        initiator: findValue(root, 'iniciatCAT'),
        // `indAfast` vive no atestado; `houveAfast` é a forma antiga na raiz.
        causedLeave: toBoolSN(
          (atestado ? findValue(atestado, 'indAfast') : undefined) ??
            findValue(root, 'houveAfast') ??
            findValue(root, 'indAfast'),
        ),
        deathDate: toDate(findValue(root, 'dtObito')),
        bodyPartCode: findValue(root, 'codParteAting'),
        causingAgentCode: findValue(root, 'codAgntCausador'),
      };
    }

    case 'S-2220': {
      const exams = findAllNodes(root, 'exame').map((e) => ({
        code: findValue(e, 'procRealizado'),
        date: toDate(findValue(e, 'dtExm')),
        result: findValue(e, 'indResult'),
      }));
      return {
        kind: 'aso',
        asoDate: toDate(findValue(root, 'dtAso')),
        examKind: findValue(root, 'tpExameOcup'),
        result: findValue(root, 'resAso'),
        exams,
      };
    }

    case 'S-2240': {
      // Fator de risco: `fatRisco/codFatRis` no S-1.x, `agNoc/codAgNoc` antes.
      const agentNodes = [...findAllNodes(root, 'fatRisco'), ...findAllNodes(root, 'agNoc')];
      return {
        kind: 'risk-exposure',
        startDate: toDate(findValue(root, 'dtIniCondicao')),
        endDate: toDate(findValue(root, 'dtFimCondicao')),
        environmentCode: findValue(root, 'codAmb'),
        agents: agentNodes
          .map((a) => ({
            code: findValue(a, 'codFatRis') ?? findValue(a, 'codAgNoc'),
            description: findValue(a, 'dscFatRis') ?? findValue(a, 'dscAgNoc'),
            assessment: findValue(a, 'tpAval'),
            intensity: findValue(a, 'intConc'),
            toleranceLimit: findValue(a, 'limTol'),
            unit: findValue(a, 'unMed'),
            // `epcEpi` é filho do agente: lido a partir do nó do agente, e não
            // da raiz, para que cada fator de risco tenha o próprio veredicto.
            epcEfficient: toBoolSN(findValue(a, 'eficEpc')),
            epiEfficient: toBoolSN(findValue(a, 'eficEpi')),
          }))
          .filter((a) => a.code !== undefined),
      };
    }

    // ── Fechamento e exclusão: o que a auditoria técnica precisa saber ──
    case 'S-1299': {
      const fech = findNode(root, 'infoFech') ?? root;
      return {
        kind: 'period-close',
        apuracaoKind: findValue(root, 'indApuracao'),
        hasRemuneration: toBoolSN(findValue(fech, 'evtRemun')),
        hasPayments: toBoolSN(findValue(fech, 'evtPgtos')),
      };
    }

    case 'S-3000': {
      const info = findNode(root, 'infoExclusao') ?? root;
      return {
        kind: 'exclusion',
        targetEventType: findValue(info, 'tpEvento'),
        targetReceipt: findValue(info, 'nrRecEvt'),
      };
    }

    // ── Totalizadores por trabalhador: base e conferência ──
    //
    // Deliberadamente sem valor: o S-5001 chega em duas formas no pacote (com
    // bases e como simples identificação do trabalhador), e as bases dele são
    // por pessoa. Quem responde pela base da empresa é o S-5011, consolidado.
    case 'S-5001':
    case 'S-5002':
    case 'S-5003':
      return { kind: 'totalizer', version: findValue(root, 'nrRecArqBase') };

    // ── Consolidados por contribuinte: origem dos valores de guia ──
    case 'S-5011': {
      // aliqRatAjust já é RAT × FAP; as outras duas são os fatores separados.
      const rate =
        findValue(root, 'aliqRatAjust') ?? findValue(root, 'aliqRat') ?? findValue(root, 'fap');
      return {
        kind: 'totalizer',
        version: findValue(root, 'nrRecArqBase'),
        // A guia é a soma dos códigos de receita do CONTRIBUINTE: patronal,
        // RAT, terceiros e a parte retida dos segurados. `infoCREstab` traz a
        // mesma lista por estabelecimento — usar as duas dobraria o valor.
        inssCents:
          sumCentsIn(root, 'infoCRContrib', 'vrCR') ||
          sumCentsIn(root, 'infoCREstab', 'vrCR') ||
          sumCents(root, 'vrCpApur'),
        inssWithheldCents: sumCentsIn(root, 'infoCPSeg', 'vrCpSeg') || undefined,
        cpBaseCents: sumCentsIn(root, 'basesCp', 'vrBcCp00') || undefined,
        baseByLotacao: findAllNodes(root, 'ideLotacao')
          .map((node) => ({
            code: String(findValue(node, 'codLotacao') ?? ''),
            baseCents: sumCentsIn(node, 'basesCp', 'vrBcCp00'),
          }))
          .filter((l) => l.code !== ''),
        ratFapRate: toNumber(rate),
      };
    }

    case 'S-5012':
      return {
        kind: 'totalizer',
        version: findValue(root, 'nrRecArqBase'),
        // O consolidado traz infoCRMen > CRMen + vrCRMen, um por código de receita.
        irrfCents: sumCents(root, 'vrCRMen') || sumCents(root, 'vrCR') || sumCents(root, 'vrIrrfDesc'),
      };

    case 'S-5013':
      return {
        kind: 'totalizer',
        version: findValue(root, 'nrRecArqBase'),
        fgtsCents:
          sumCents(root, 'vrFGTS') || sumCents(root, 'vlrDpsFGTS') || sumCents(root, 'vrDpsFGTS'),
        fgtsBaseCents: sumCents(root, 'baseFGTS') || undefined,
      };

    default:
      return { kind: 'unknown' };
  }
}

/**
 * Resposta das consultas: uma lista de eventos com id e recibo. O formato varia
 * (XML ou JSON conforme o serviço), então normalizamos os dois.
 */
export interface EventListItem {
  eventId: string;
  receiptNumber?: string;
}

export function parseEventList(body: string, contentType?: string): EventListItem[] {
  if (contentType?.includes('json')) {
    try {
      const json = JSON.parse(body) as unknown;
      return collectListItems(json);
    } catch {
      return [];
    }
  }
  try {
    return collectListItems(parser.parse(body));
  } catch {
    return [];
  }
}

function collectListItems(root: unknown): EventListItem[] {
  const out: EventListItem[] = [];
  const seen = new Set<string>();
  const visit = (node: unknown) => {
    if (Array.isArray(node)) return node.forEach(visit);
    if (!node || typeof node !== 'object') return;
    const n = node as XmlNode;
    const id =
      (n['@_Id'] as string) ?? (n.id as string) ?? (n.idEvento as string) ?? (n.nrRecArqBase as string);
    const receipt = (n.nrRecibo as string) ?? (n.nrRecArqBase as string) ?? (n.recibo as string);
    if (typeof id === 'string' && id.length > 0 && !seen.has(id)) {
      seen.add(id);
      out.push({ eventId: id, receiptNumber: typeof receipt === 'string' ? receipt : undefined });
    }
    Object.values(n).forEach(visit);
  };
  visit(root);
  return out;
}
