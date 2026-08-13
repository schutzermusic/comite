/**
 * Endpoints do eSocial e o que é (e não é) possível automatizar.
 *
 * ATENÇÃO — restrição de plataforma, não de implementação:
 *
 *   O eSocial expõe DOIS webservices ao empregador:
 *     • WsEnviarLoteEventos    — transmite lotes (escrita).
 *     • WsConsultarLoteEventos — devolve o resultado do processamento de um
 *                                lote QUE VOCÊ MESMO ENVIOU, por protocolo.
 *
 *   Não existe webservice para recuperar eventos já transmitidos por
 *   competência. A ferramenta que faz isso é o "eSocial Download", e ela é
 *   exclusiva do portal web — o texto oficial é literal: "Não há opção de
 *   realizar essa consulta via webservice (sistemas próprios das empresas)".
 *   https://www.gov.br/esocial/pt-br/noticias/esocial-download-para-facilitar-a-vida-do-empregador
 *
 * Por isso a ingestão do INSIGHT parte do PACOTE do eSocial Download, e não de
 * uma consulta automática. As URLs abaixo ficam registradas porque são o
 * caminho válido caso um dia o INSIGHT passe a transmitir (aí o
 * WsConsultarLoteEventos devolve os eventos dos próprios lotes).
 */

export type EsocialEnvironmentKey = 'production' | 'restricted';

export interface EsocialEndpoints {
  /** WsConsultarLoteEventos — só serve para lotes enviados pelo próprio sistema. */
  consultarLoteEventos: string;
  /** WsEnviarLoteEventos — não utilizado: o conector é somente leitura. */
  enviarLoteEventos: string;
}

export const DEFAULT_ENDPOINTS: Record<EsocialEnvironmentKey, EsocialEndpoints> = {
  production: {
    consultarLoteEventos:
      'https://webservices.consulta.esocial.gov.br/servicos/empregador/consultarloteeventos/WsConsultarLoteEventos.svc',
    enviarLoteEventos:
      'https://webservices.envio.esocial.gov.br/servicos/empregador/enviarloteeventos/WsEnviarLoteEventos.svc',
  },
  restricted: {
    consultarLoteEventos:
      'https://webservices.producaorestrita.esocial.gov.br/servicos/empregador/consultarloteeventos/WsConsultarLoteEventos.svc',
    enviarLoteEventos:
      'https://webservices.producaorestrita.esocial.gov.br/servicos/empregador/enviarloteeventos/WsEnviarLoteEventos.svc',
  },
};

/** Aplica os overrides gravados na configuração sobre o padrão do ambiente. */
export function resolveEndpoints(
  environment: EsocialEnvironmentKey,
  overrides: Partial<EsocialEndpoints> = {},
): EsocialEndpoints {
  return { ...DEFAULT_ENDPOINTS[environment], ...overrides };
}

/**
 * Eventos que a importação reconhece, e o que cada um alimenta no cockpit.
 * Qualquer outro tipo presente no pacote é ignorado sem erro.
 */
export const INGESTED_EVENT_TYPES = [
  {
    code: 'S-1010',
    label: 'Tabela de rubricas',
    feeds: 'classificação das verbas: folha bruta, descontos, horas extras, benefícios',
  },
  { code: 'S-2200', label: 'Admissão / cadastro inicial', feeds: 'headcount, admissões, tempo de casa, CBO' },
  { code: 'S-2206', label: 'Alteração contratual', feeds: 'função, lotação, salário' },
  { code: 'S-2299', label: 'Desligamento', feeds: 'desligamentos, turnover, motivo' },
  { code: 'S-2230', label: 'Afastamento temporário', feeds: 'absenteísmo (dias e motivo)' },
  { code: 'S-1200', label: 'Remuneração do trabalhador', feeds: 'folha bruta, rubricas, horas extras, por área' },
  { code: 'S-1210', label: 'Pagamentos de rendimentos', feeds: 'líquido pago' },
  { code: 'S-5001', label: 'Totalizador por trabalhador — contribuições', feeds: 'base de contribuição' },
  { code: 'S-5011', label: 'Totalizador consolidado — contribuições sociais', feeds: 'guia INSS (valor apurado), RAT/FAP' },
  { code: 'S-5012', label: 'Totalizador consolidado — IRRF', feeds: 'guia IRRF (valor apurado)' },
  { code: 'S-5013', label: 'Totalizador consolidado — FGTS', feeds: 'guia FGTS (valor apurado)' },
  // SST — deixaram de ser "guardados sem virar indicador" quando ganharam
  // payload tipado e tabela própria (migration 084).
  { code: 'S-2210', label: 'CAT — acidente de trabalho', feeds: 'CATs no mês, acidentes com afastamento, por área' },
  { code: 'S-2220', label: 'Monitoramento da saúde (ASO)', feeds: 'exames por tipo e resultado, ASO vencido / a vencer' },
  { code: 'S-2240', label: 'Condições ambientais — agentes nocivos', feeds: 'exposição a risco, agentes por trabalhador e ambiente' },
] as const;

export type IngestedEventType = (typeof INGESTED_EVENT_TYPES)[number]['code'];

/** Só os totalizadores — são eles que trazem os valores reais das guias. */
export const TOTALIZER_EVENT_TYPES: IngestedEventType[] = ['S-5001', 'S-5011', 'S-5012', 'S-5013'];

/** Limites do eSocial Download, exibidos na tela para orientar o operador. */
export const ESOCIAL_DOWNLOAD_LIMITS = {
  maxRequestsPerDay: 12,
  maxDaysPerRequest: 35,
  fileRetentionDays: 7,
  maxEventsPerRequest: 200_000,
  portalUrl: 'https://www.gov.br/esocial/pt-br',
} as const;
