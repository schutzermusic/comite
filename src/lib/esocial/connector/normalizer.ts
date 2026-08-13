/**
 * Normalização: eventos do eSocial → métricas por competência e por área.
 *
 * Regra que atravessa o módulo: um valor de guia só é gravado quando o
 * totalizador correspondente chegou. `null` significa "ainda não apurado pelo
 * eSocial" e é diferente de `0`, que significa "apurado, nada a recolher". Essa
 * distinção é o que substitui as estimativas antigas por dado verificável.
 */
import type { ParsedEsocialEvent } from './parser';
import { hashCpf, maskCpf } from './secrets';
import {
  benefitKind,
  buildRubricaTable,
  isOvertimeRubrica,
  rubricaRole,
  type RubricaTable,
} from './rubricas';
import type { AreaMetricsRow, CompetenceMetricsRow, EmploymentUpsert } from './store';
import { buildSstEvents, type SstEventRow } from './sst';

export interface NormalizationResult {
  competences: CompetenceMetricsRow[];
  areas: AreaMetricsRow[];
  employments: EmploymentUpsert[];
  /** CAT, ASO e exposição a agentes nocivos — uma linha por evento. */
  sstEvents: SstEventRow[];
}

const UNKNOWN_AREA = { code: 'sem-lotacao', label: 'Sem lotação informada' };

function emptyCompetence(organizationId: string, competence: string): CompetenceMetricsRow {
  return {
    organization_id: organizationId,
    competence,
    gross_payroll_cents: 0,
    overtime_cents: 0,
    overtime_hours: 0,
    benefits_cents: 0,
    benefits_by_nature: {},
    deductions_cents: 0,
    net_paid_cents: 0,
    rubric_total_cents: 0,
    rubric_mapped_cents: 0,
    headcount: 0,
    admissions: 0,
    terminations: 0,
    absence_days: 0,
    absence_events: 0,
    inss_cents: null,
    inss_withheld_cents: null,
    irrf_cents: null,
    fgts_cents: null,
    cp_base_cents: null,
    fgts_base_cents: null,
    rat_fap_rate: null,
    totalizers: {},
    source_event_count: 0,
  };
}

/**
 * Ordena recibos de fechamento (`nrRecArqBase`).
 *
 * O recibo é sequencial no eSocial, então o maior é o mais recente. Compara-se
 * só os dígitos, primeiro por comprimento, para que a ordem seja numérica e não
 * alfabética — "9" não pode vencer "10".
 */
function compareVersions(a: string, b: string): number {
  const da = a.replace(/\D/g, '');
  const db = b.replace(/\D/g, '');
  if (da.length !== db.length) return da.length - db.length;
  return da < db ? -1 : da > db ? 1 : 0;
}

/**
 * Versão vencedora de cada totalizador, por competência e tipo.
 *
 * O eSocial reemite o totalizador INTEIRO a cada reprocessamento da
 * competência, e o pacote do Download entrega todas as versões. Somá-las
 * multiplica a guia pelo número de retificações — foi o que fez abril/2026
 * aparecer com INSS, IRRF e FGTS três vezes maiores que os reais.
 */
function selectTotalizerVersions(events: ParsedEsocialEvent[]): Map<string, string> {
  const winners = new Map<string, string>();
  for (const ev of events) {
    if (ev.payload.kind !== 'totalizer') continue;
    const competence = effectiveCompetence(ev);
    if (!competence) continue;
    const key = `${competence}::${ev.eventType}`;
    const version = ev.payload.version ?? '';
    const current = winners.get(key);
    if (current === undefined || compareVersions(version, current) > 0) winners.set(key, version);
  }
  return winners;
}

function emptyArea(
  organizationId: string,
  competence: string,
  code: string,
  label: string,
): AreaMetricsRow {
  return {
    organization_id: organizationId,
    competence,
    area_code: code,
    // A lotação tributária não tem nome no leiaute atual do S-1020: ela é
    // identificada por tipo e pelo CNPJ do tomador. Sem nome declarado, o
    // rótulo é o próprio código, prefixado para não virar um "6" solto no eixo
    // do gráfico.
    area_label: label && label !== code ? label : `Lotação ${code}`,
    headcount: 0,
    admissions: 0,
    terminations: 0,
    absence_days: 0,
    gross_cents: 0,
    overtime_cents: 0,
    base_cents: 0,
  };
}

/** Competência de um evento cadastral, que não traz perApur: usa a data do fato. */
function competenceFromDate(date?: string): string | undefined {
  return date?.slice(0, 7);
}

/**
 * Competência EFETIVA do evento.
 *
 * Só os periódicos trazem `perApur`; admissão, desligamento e afastamento se
 * situam pela data do fato. Esta função é a fonte única dessa regra porque duas
 * coisas precisam concordar: a coluna `competence` gravada no evento e a chave
 * usada para reapurar. Se divergirem, um S-2200 gravado sem competência nunca
 * seria relido — e a admissão sumiria do agregado na importação seguinte.
 */
export function effectiveCompetence(ev: ParsedEsocialEvent): string | undefined {
  if (ev.competence) {
    // Apuração anual (13º) declara só o ano. Marcá-la como 'AAAA-13' preserva o
    // dado e a mantém fora da série mensal: somada a dezembro, inflaria o mês e
    // faria a folha "crescer 80%" sem que nada tivesse crescido.
    if (ev.annualApuracao) return `${ev.competence}-13`;
    return ev.competence;
  }
  switch (ev.payload.kind) {
    case 'admission':
      return competenceFromDate(ev.payload.admissionDate);
    case 'termination':
      return competenceFromDate(ev.payload.terminationDate);
    case 'absence':
      return competenceFromDate(ev.payload.startDate);
    case 'cat':
      return competenceFromDate(ev.payload.accidentDate ?? ev.eventDate);
    case 'aso':
      return competenceFromDate(ev.payload.asoDate ?? ev.eventDate);
    case 'risk-exposure':
      return competenceFromDate(ev.payload.startDate ?? ev.eventDate);
    default:
      // Eventos ainda sem payload tipado: situar pela data do fato os mantém
      // encontráveis quando virarem indicador.
      return competenceFromDate(ev.eventDate);
  }
}

/** Último dia do mês da competência 'AAAA-MM'. */
function lastDayOfCompetence(competence: string): string {
  const [year, month] = competence.split('-').map(Number);
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
}

function addMonth(competence: string): string {
  const [year, month] = competence.split('-').map(Number);
  const next = new Date(Date.UTC(year, month, 1));
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}`;
}

function inclusiveDays(start: string, end: string): number {
  const s = Date.parse(`${start}T00:00:00Z`);
  const e = Date.parse(`${end}T00:00:00Z`);
  if (!Number.isFinite(s) || !Number.isFinite(e) || e < s) return 0;
  return Math.floor((e - s) / 86_400_000) + 1;
}

/**
 * Dias de afastamento POR COMPETÊNCIA.
 *
 * Um afastamento não pertence a um mês: ele atravessa meses. Jogar a duração
 * inteira na competência de início produzia absurdos como 6.536 dias de falta
 * em fevereiro/2026 com 268 pessoas — 24 dias por pessoa, um mês inteiro parado.
 *
 * Duas regras compõem a correção:
 *   • cada mês recebe apenas os dias que caem DENTRO dele;
 *   • afastamento sem data de término é contado só até hoje, nunca projetado
 *     para o futuro. O S-2230 de retorno é que fecha o período, e enquanto ele
 *     não chega o afastamento segue realmente em aberto.
 */
export function absenceDaysByCompetence(
  startDate: string | undefined,
  endDate: string | undefined,
  today: Date = new Date(),
): Map<string, number> {
  const out = new Map<string, number>();
  if (!startDate || !/^\d{4}-\d{2}-\d{2}/.test(startDate)) return out;

  const start = startDate.slice(0, 10);
  const todayIso = today.toISOString().slice(0, 10);
  // Em aberto: até hoje. Fechado: até a data declarada, mesmo se futura —
  // afastamento programado é informação legítima do empregador.
  const end = endDate && /^\d{4}-\d{2}-\d{2}/.test(endDate) ? endDate.slice(0, 10) : todayIso;
  if (end < start) return out;

  for (let competence = start.slice(0, 7); competence <= end.slice(0, 7); ) {
    const monthStart = `${competence}-01`;
    const monthEnd = lastDayOfCompetence(competence);
    const from = start > monthStart ? start : monthStart;
    const to = end < monthEnd ? end : monthEnd;
    const days = inclusiveDays(from, to);
    if (days > 0) out.set(competence, days);
    const next = addMonth(competence);
    if (next === competence) break;
    competence = next;
  }
  return out;
}

export interface AbsencePeriod {
  worker: string;
  start: string;
  /** Ausente só quando o trabalhador realmente não voltou. */
  end?: string;
  reasonCode?: string;
  areaCode: string;
  areaLabel: string;
}

/**
 * Reconstrói os períodos de afastamento a partir dos eventos soltos.
 *
 * O S-2230 declara o início OU o fim, em eventos separados: o retorno vem com
 * `fimAfastamento` e sem `dtIniAfast`. Tratados isoladamente, todo afastamento
 * fica aberto para sempre e passa a acumular dias até hoje — foi o que fez o
 * absenteísmo crescer mês a mês sem que ninguém tivesse se afastado a mais.
 *
 * O emparelhamento é por trabalhador e em ordem cronológica: cada fim fecha o
 * início aberto mais antigo. Retificações reenviam o mesmo início, então datas
 * repetidas contam uma vez só. Um fim sem início correspondente é descartado —
 * é afastamento que começou antes da janela de retenção, e inventar-lhe uma
 * data de início seria fabricar dias de falta.
 */
export function buildAbsencePeriods(
  events: ParsedEsocialEvent[],
  workerKeyOf: (ev: ParsedEsocialEvent) => string | undefined,
): AbsencePeriod[] {
  interface Opening { date: string; reasonCode?: string; areaCode: string; areaLabel: string }
  const starts = new Map<string, Map<string, Opening>>();
  const ends = new Map<string, Set<string>>();

  for (const ev of events) {
    if (ev.payload.kind !== 'absence') continue;
    const worker = workerKeyOf(ev);
    if (!worker) continue;
    const { startDate, endDate, reasonCode } = ev.payload;

    if (startDate) {
      if (!starts.has(worker)) starts.set(worker, new Map());
      // Chave pela data: a retificação reenvia o mesmo início e não é um novo
      // afastamento. A última versão vence, que é a corrigida.
      starts.get(worker)!.set(startDate, {
        date: startDate,
        reasonCode,
        areaCode: ev.areaCode ?? UNKNOWN_AREA.code,
        areaLabel: ev.areaLabel ?? UNKNOWN_AREA.label,
      });
      // Evento que já traz início e fim: fecha na hora.
      if (endDate) {
        if (!ends.has(worker)) ends.set(worker, new Set());
        ends.get(worker)!.add(endDate);
      }
    } else if (endDate) {
      if (!ends.has(worker)) ends.set(worker, new Set());
      ends.get(worker)!.add(endDate);
    }
  }

  const periods: AbsencePeriod[] = [];
  for (const [worker, openings] of starts) {
    const ordered = [...openings.values()].sort((a, b) => a.date.localeCompare(b.date));
    const available = [...(ends.get(worker) ?? [])].sort();
    const used = new Set<number>();

    for (const opening of ordered) {
      // Primeiro fim ainda não usado que não antecede este início.
      const index = available.findIndex((d, i) => !used.has(i) && d >= opening.date);
      if (index >= 0) used.add(index);
      periods.push({
        worker,
        start: opening.date,
        end: index >= 0 ? available[index] : undefined,
        reasonCode: opening.reasonCode,
        areaCode: opening.areaCode,
        areaLabel: opening.areaLabel,
      });
    }
  }

  return periods;
}

export function normalizeEvents(
  organizationId: string,
  events: ParsedEsocialEvent[],
): NormalizationResult {
  // Passe 1 — o dicionário da folha. Sem ele nenhuma verba do S-1200 pode ser
  // classificada, porque o evento de remuneração não declara natureza nem sinal.
  const rubricas: RubricaTable = buildRubricaTable(events);
  const winningTotalizer = selectTotalizerVersions(events);

  const competences = new Map<string, CompetenceMetricsRow>();
  const areas = new Map<string, AreaMetricsRow>();
  const employments = new Map<string, EmploymentUpsert>();
  /** Trabalhadores distintos com remuneração no mês = headcount efetivo. */
  const workersByCompetence = new Map<string, Set<string>>();
  const workersByArea = new Map<string, Set<string>>();

  const comp = (c: string) => {
    if (!competences.has(c)) competences.set(c, emptyCompetence(organizationId, c));
    return competences.get(c)!;
  };
  const area = (c: string, code: string, label: string) => {
    const key = `${c}::${code}`;
    if (!areas.has(key)) areas.set(key, emptyArea(organizationId, c, code, label));
    return areas.get(key)!;
  };
  /** Lotação de cada trabalhador, por competência, vinda do S-1200. */
  const areaByWorker = new Map<string, Map<string, { code: string; label: string }>>();

  /**
   * Onde o trabalhador estava lotado na competência.
   *
   * Cai para a lotação conhecida mais próxima quando o mês do afastamento não
   * tem folha dele — quem está afastado o mês inteiro pode não aparecer no
   * S-1200 daquele mês, e ainda assim pertence a uma área.
   */
  const workerArea = (worker: string, competence: string) => {
    const byCompetence = areaByWorker.get(worker);
    if (!byCompetence) return undefined;
    const exact = byCompetence.get(competence);
    if (exact) return exact;
    const known = [...byCompetence.keys()].sort();
    const previous = known.filter((c) => c <= competence).pop();
    return byCompetence.get(previous ?? known[known.length - 1]);
  };

  const countWorker = (map: Map<string, Set<string>>, key: string, worker?: string) => {
    if (!worker) return;
    if (!map.has(key)) map.set(key, new Set());
    map.get(key)!.add(worker);
  };

  for (const ev of events) {
    const workerKey = ev.cpf ? hashCpf(ev.cpf) : ev.matricula;
    const areaCode = ev.areaCode ?? UNKNOWN_AREA.code;
    const areaLabel = ev.areaLabel ?? UNKNOWN_AREA.label;

    switch (ev.payload.kind) {
      case 'remuneration': {
        const c = effectiveCompetence(ev);
        if (!c) break;
        const row = comp(c);
        const a = area(c, areaCode, areaLabel);
        // A remuneração é o único evento que liga trabalhador a lotação no mês.
        // Registrar esse vínculo aqui é o que permite atribuir o afastamento
        // dele à área certa depois.
        if (workerKey) {
          if (!areaByWorker.has(workerKey)) areaByWorker.set(workerKey, new Map());
          areaByWorker.get(workerKey)!.set(c, { code: areaCode, label: areaLabel });
        }

        for (const item of ev.payload.rubricas) {
          const def = rubricas.get(item.code, item.tableId);
          row.rubric_total_cents += item.amountCents;
          if (def) row.rubric_mapped_cents += item.amountCents;

          // `vrRubr` vem sempre positivo: quem separa provento de desconto é o
          // `tpRubr` da tabela. Verba sem definição fica FORA da massa — contá-la
          // como provento inflava a folha com descontos e rubricas de base.
          switch (rubricaRole(def)) {
            case 'provento':
              row.gross_payroll_cents += item.amountCents;
              a.gross_cents += item.amountCents;
              if (isOvertimeRubrica(def)) {
                row.overtime_cents += item.amountCents;
                // qtdRubr traz a quantidade de horas; é o que o indicador de
                // "horas extras" pede, e não dá para inferir do valor.
                row.overtime_hours += item.quantity ?? 0;
                a.overtime_cents += item.amountCents;
              }
              const kind = benefitKind(def);
              if (kind) {
                row.benefits_cents += item.amountCents;
                // Guardar por tipo aqui é o que permite abrir "Benefícios por
                // tipo" sem reler o XML depois — o agregado é gravado uma vez.
                row.benefits_by_nature = {
                  ...row.benefits_by_nature,
                  [kind]: (row.benefits_by_nature[kind] ?? 0) + item.amountCents,
                };
              }
              break;
            case 'desconto':
              row.deductions_cents += item.amountCents;
              break;
            case 'informativa':
            case 'desconhecida':
              break;
          }
        }

        row.source_event_count += 1;
        countWorker(workersByCompetence, c, workerKey);
        countWorker(workersByArea, `${c}::${areaCode}`, workerKey);
        break;
      }

      case 'payment': {
        const c = effectiveCompetence(ev);
        if (!c) break;
        const row = comp(c);
        row.net_paid_cents += ev.payload.netPaidCents;
        row.source_event_count += 1;
        break;
      }

      case 'admission': {
        const c = effectiveCompetence(ev);
        if (c) {
          comp(c).admissions += 1;
          comp(c).source_event_count += 1;
          area(c, areaCode, areaLabel).admissions += 1;
        }
        if (ev.matricula && workerKey) {
          employments.set(ev.matricula, {
            organization_id: organizationId,
            matricula: ev.matricula,
            worker_cpf_hash: workerKey,
            worker_cpf_mask: ev.cpf ? maskCpf(ev.cpf) : undefined,
            worker_name: ev.workerName,
            admission_date: ev.payload.admissionDate,
            cbo_code: ev.payload.cboCode,
            job_title: ev.payload.jobTitle,
            area_code: ev.areaCode,
            area_label: ev.areaLabel,
            contract_type: ev.payload.contractType,
            status: 'active',
          });
        }
        break;
      }

      case 'termination': {
        const c = effectiveCompetence(ev);
        if (c) {
          comp(c).terminations += 1;
          comp(c).source_event_count += 1;
          area(c, areaCode, areaLabel).terminations += 1;
        }
        if (ev.matricula && workerKey) {
          const existing = employments.get(ev.matricula);
          employments.set(ev.matricula, {
            ...(existing ?? {
              organization_id: organizationId,
              matricula: ev.matricula,
              worker_cpf_hash: workerKey,
              worker_cpf_mask: ev.cpf ? maskCpf(ev.cpf) : undefined,
              worker_name: ev.workerName,
              area_code: ev.areaCode,
              area_label: ev.areaLabel,
            }),
            termination_date: ev.payload.terminationDate,
            termination_code: ev.payload.reasonCode,
            status: 'terminated',
          });
        }
        break;
      }

      case 'absence': {
        // Contado no passe de períodos: um evento isolado é meio afastamento
        // (só o início ou só o fim), e agregá-lo aqui contaria pela metade.
        const c = effectiveCompetence(ev);
        if (c) comp(c).source_event_count += 1;
        break;
      }

      case 'totalizer': {
        const c = effectiveCompetence(ev);
        if (!c) break;
        const p = ev.payload;

        // Só a versão mais recente do fechamento entra. As anteriores continuam
        // no pacote depois de cada retificação, e somá-las multiplicava a guia.
        if (winningTotalizer.get(`${c}::${ev.eventType}`) !== (p.version ?? '')) break;

        const row = comp(c);
        // Dentro de UMA versão a soma é legítima: o totalizador vem
        // particionado por estabelecimento e lotação.
        if (p.inssCents !== undefined) {
          row.inss_cents = (row.inss_cents ?? 0) + p.inssCents;
          row.totalizers = { ...row.totalizers, 'S-5011': true };
        }
        if (p.inssWithheldCents !== undefined) {
          row.inss_withheld_cents = (row.inss_withheld_cents ?? 0) + p.inssWithheldCents;
        }
        if (p.irrfCents !== undefined) {
          row.irrf_cents = (row.irrf_cents ?? 0) + p.irrfCents;
          row.totalizers = { ...row.totalizers, 'S-5012': true };
        }
        if (p.fgtsCents !== undefined) {
          row.fgts_cents = (row.fgts_cents ?? 0) + p.fgtsCents;
          row.totalizers = { ...row.totalizers, 'S-5013': true };
        }
        if (p.cpBaseCents !== undefined) row.cp_base_cents = (row.cp_base_cents ?? 0) + p.cpBaseCents;
        if (p.fgtsBaseCents !== undefined) {
          row.fgts_base_cents = (row.fgts_base_cents ?? 0) + p.fgtsBaseCents;
        }
        if (p.ratFapRate !== undefined) row.rat_fap_rate = p.ratFapRate;

        // Base por lotação apurada pelo governo: é o corte por área que não
        // depende da tabela de rubricas estar completa.
        for (const lot of p.baseByLotacao ?? []) {
          // O totalizador não nomeia a lotação; o nome vem do S-1020, quando o
          // pacote o traz. Até lá o código é o próprio rótulo.
          area(c, lot.code, lot.code).base_cents += lot.baseCents;
        }

        row.source_event_count += 1;
        break;
      }

      case 'rubric-table':
        // Consumido no passe 1, ao montar o dicionário.
        break;

      case 'cat':
      case 'aso':
      case 'risk-exposure':
        // SST tem linha própria (esocial_sst_events) e não entra em nenhum
        // agregado de folha: acidente e exame não são custo nem headcount.
        // Montados no passe final, quando a lotação de cada trabalhador já é
        // conhecida.
        break;

      case 'period-close':
      case 'exclusion':
        // Sinais de auditoria técnica. Vivem no `metadata` do próprio evento e
        // são lidos pela rota de auditoria — agregá-los aqui misturaria
        // controle de transmissão com indicador de negócio.
        break;

      case 'unknown':
        break;
    }
  }

  // Afastamentos: períodos reconstruídos, não eventos soltos. O evento conta
  // uma vez no mês em que o afastamento começou; os DIAS se distribuem pelos
  // meses que o afastamento realmente atravessa.
  //
  // A ÁREA vem do trabalhador, não do evento: o S-2230 identifica quem se
  // afastou (CPF e matrícula) e não declara `codLotacao`. Usar a lotação do
  // próprio evento jogava 100% das faltas em "sem lotação informada" — o
  // gráfico de absenteísmo por área ficava zerado em todas as áreas reais,
  // enquanto o total da competência estava certo.
  for (const period of buildAbsencePeriods(events, (ev) => (ev.cpf ? hashCpf(ev.cpf) : ev.matricula))) {
    const startCompetence = period.start.slice(0, 7);
    comp(startCompetence).absence_events += 1;
    for (const [competence, days] of absenceDaysByCompetence(period.start, period.end)) {
      comp(competence).absence_days += days;
      const where = workerArea(period.worker, competence) ?? {
        code: period.areaCode,
        label: period.areaLabel,
      };
      area(competence, where.code, where.label).absence_days += days;
    }
  }

  for (const [c, workers] of workersByCompetence) comp(c).headcount = workers.size;
  for (const [key, workers] of workersByArea) {
    const row = areas.get(key);
    if (row) row.headcount = workers.size;
  }

  // SST por último: a lotação de cada trabalhador só está completa depois de
  // varrer todos os S-1200, e é dela que o CAT herda a área.
  const sstEvents = buildSstEvents(
    organizationId,
    events,
    (worker, competence) => (worker && competence ? workerArea(worker, competence) : undefined),
    (ev) => (ev.cpf ? hashCpf(ev.cpf) : ev.matricula),
    (ev) => (ev.cpf ? maskCpf(ev.cpf) : undefined),
    effectiveCompetence,
  );

  return {
    competences: [...competences.values()],
    areas: [...areas.values()],
    employments: [...employments.values()],
    sstEvents,
  };
}
