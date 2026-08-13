/**
 * Histórico salarial por pessoa, derivado dos lotes de fechamento aprovados.
 *
 * A fonte é `payroll_employee_lines`, uma linha por colaborador por lote, que é
 * o único lugar do produto com valor por pessoa por competência. O casamento
 * com `people` usa `payroll_name_key`, que existe no schema desde a migration
 * 038 exatamente para isto e já é preenchido dos dois lados.
 *
 * O PROBLEMA QUE ESTE MÓDULO EXISTE PARA NÃO COMETER
 *
 * `gross_amount_cents` é o BRUTO DO MÊS, não o salário base: ele absorve horas
 * extras, 13º, férias e rescisão. Comparar mês contra mês, que é o que a
 * palavra "reajuste" sugere, faria todo mundo receber aumento em dezembro e
 * corte em janeiro — e o indicador "sem reajuste há +12 meses" ficaria vazio
 * justamente na empresa onde ninguém foi reajustado.
 *
 * A saída é olhar para PATAMAR, não para variação:
 *
 *   • patamar  = duas ou mais competências CONSECUTIVAS com o mesmo bruto.
 *                Um mês isolado com valor diferente é mês variável, não patamar.
 *   • reajuste = o início de um patamar cujo valor difere do patamar anterior.
 *
 * E, para "há quanto tempo sem reajuste", a âncora é o início do patamar ATUAL,
 * que existe mesmo quando nenhum reajuste foi observado. Quando esse início
 * coincide com a primeira competência do acervo, ele é um LIMITE INFERIOR: o
 * patamar pode ter começado antes da janela importada. Daí os três baldes —
 * `recent`, `stale` e `indeterminate` — em vez de dois. Um limite inferior de
 * 14 meses prova que faz mais de um ano; um de 4 meses não prova nada.
 */

export const APPROVED_BATCH_STATUSES = ['approved', 'sent_to_finance'] as const;

/**
 * Espelha `normalize_person_name()` da migration 038.
 *
 * Definida aqui, e não importada de `src/lib/services/people.ts`, porque aquele
 * módulo carrega o cliente Supabase do browser no topo e este roda em rota
 * `runtime='nodejs'`. O teste de paridade impede que as duas versões divirjam.
 */
export function normalizePayrollName(name: string | null | undefined): string | null {
  if (!name) return null;
  const normalized = name
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .normalize('NFD')
    // remove os diacríticos combinantes (U+0300–U+036F)
    .replace(/[\u0300-\u036f]/g, '');
  return normalized || null;
}

export interface SalaryPoint {
  competence: string;
  batchId: string;
  /** Soma das linhas do mesmo nome no lote; `lineCount > 1` avisa que é soma. */
  grossCents: number;
  netCents: number | null;
  lineCount: number;
  costCenterLabel: string | null;
  contractType: string | null;
}

export interface SalaryLevel {
  grossCents: number;
  startCompetence: string;
  endCompetence: string;
  months: number;
  /** Começou antes da janela observada — `startCompetence` é limite inferior. */
  truncatedStart: boolean;
}

/**
 * `recent` — reajuste observado dentro dos últimos 12 meses.
 * `stale`  — comprovadamente 12 meses ou mais no mesmo patamar.
 * `indeterminate` — a série é curta demais para afirmar qualquer das duas.
 */
export type RaiseStatus = 'recent' | 'stale' | 'indeterminate';

export interface PersonSalaryHistory {
  personId: string;
  fullName: string;
  payrollNameKey: string;
  contractType: string | null;
  costCenterLabel: string | null;
  series: SalaryPoint[];
  levels: SalaryLevel[];
  currentGrossCents: number | null;
  /** Início do patamar atual. `null` quando não há patamar determinável. */
  lastRaiseCompetence: string | null;
  /** `null` no primeiro patamar: não há base anterior contra a qual variar. */
  lastRaisePercent: number | null;
  monthsSinceLastRaise: number | null;
  /** `true` quando `monthsSinceLastRaise` é um piso, não um valor exato. */
  monthsIsLowerBound: boolean;
  raiseStatus: RaiseStatus;
}

/** Nome na folha sem pessoa correspondente — lacuna declarada, nunca descarte. */
export interface UnmatchedPayrollName {
  employeeName: string;
  normalizedName: string;
  competences: string[];
  lastGrossCents: number;
}

export interface SalaryHistoryResult {
  competencesObserved: string[];
  people: PersonSalaryHistory[];
  unmatched: UnmatchedPayrollName[];
  counts: {
    peopleMatched: number;
    peopleUnmatched: number;
    /** 12 meses ou mais no mesmo patamar — comprovado. */
    withoutRaise12m: number;
    raisedWithin12m: number;
    indeterminate: number;
  };
  notes: string[];
}

export interface SalaryHistoryLine {
  batch_id: string;
  employee_name: string;
  cost_center_label: string | null;
  contract_type: string | null;
  gross_amount_cents: number;
  net_amount_cents: number | null;
}

export interface SalaryHistoryBatch {
  id: string;
  competence_month: string;
}

export interface SalaryHistoryPerson {
  id: string;
  full_name: string;
  payroll_name_key: string | null;
}

export interface SalaryHistoryInput {
  lines: SalaryHistoryLine[];
  batches: SalaryHistoryBatch[];
  people: SalaryHistoryPerson[];
  /** Competência de referência 'AAAA-MM'; padrão é o mês corrente. */
  today?: string;
}

function monthsBetween(from: string, to: string): number {
  const [fy, fm] = from.split('-').map(Number);
  const [ty, tm] = to.split('-').map(Number);
  return (ty - fy) * 12 + (tm - fm);
}

/** Meses estruturalmente contaminados pelo 13º salário. */
const THIRTEENTH_MONTHS = new Set([11, 12]);

function monthOf(competence: string): number {
  return Number(competence.split('-')[1]);
}

/**
 * Agrupa a série em patamares.
 *
 * Duas distorções previsíveis da folha brasileira precisam ser neutralizadas
 * aqui, ou o indicador "sem reajuste há +12 meses" fica vazio todo ano.
 *
 * 1. MÊS VARIÁVEL ISOLADO — férias, rescisão complementar, um mês com bônus.
 *    Uma competência sozinha com valor próprio não abre patamar: é absorvida
 *    pelo patamar corrente.
 *
 * 2. A JANELA DO 13º — novembro e dezembro.
 *    Quando o 13º é pago metade em novembro e metade em dezembro, os DOIS
 *    meses sobem para o mesmo valor. Isso é uma corrida de comprimento 2, que
 *    a regra (1) não pega: sem tratamento, novembro abriria um patamar novo
 *    ("reajuste de 50%") e janeiro abriria outro ("corte de 33%") — e o relógio
 *    de "meses no patamar" de TODA a empresa zeraria em janeiro, todo ano.
 *
 *    Por isso nenhuma corrida contida em nov/dez pode abrir patamar. Para onde
 *    ela vai depende do que vem DEPOIS dela, e é isso que distingue os dois
 *    casos que se parecem:
 *      • janeiro volta ao valor de outubro  → foi só o 13º; a janela é
 *        absorvida pelo patamar anterior, que segue contínuo;
 *      • janeiro fica num valor novo        → houve reajuste em novembro, e o
 *        patamar novo COMEÇA na janela — assim a data do reajuste é novembro,
 *        e não janeiro.
 */
export function buildLevels(series: SalaryPoint[]): SalaryLevel[] {
  if (series.length === 0) return [];

  // Corridas de valor igual e consecutivo.
  const runs: { grossCents: number; start: string; end: string; length: number; seasonal: boolean }[] = [];
  for (const point of series) {
    const last = runs[runs.length - 1];
    if (last && last.grossCents === point.grossCents) {
      last.end = point.competence;
      last.length += 1;
      last.seasonal = last.seasonal && THIRTEENTH_MONTHS.has(monthOf(point.competence));
    } else {
      runs.push({
        grossCents: point.grossCents,
        start: point.competence,
        end: point.competence,
        length: 1,
        seasonal: THIRTEENTH_MONTHS.has(monthOf(point.competence)),
      });
    }
  }

  const levels: SalaryLevel[] = [];
  const extend = (level: SalaryLevel, end: string) => {
    level.endCompetence = end;
    level.months = monthsBetween(level.startCompetence, level.endCompetence) + 1;
  };

  /** Janela de 13º pendente, à espera do mês que decide a quem ela pertence. */
  let pendingSeasonalStart: string | null = null;

  for (let i = 0; i < runs.length; i += 1) {
    const run = runs[i];
    const current = levels[levels.length - 1];
    const next = runs[i + 1];

    // ── Janela do 13º ──
    if (run.seasonal && (current || next)) {
      if (current && (!next || next.grossCents === current.grossCents)) {
        // Volta ao mesmo valor (ou a série acaba aqui): foi só o 13º.
        extend(current, run.end);
      } else {
        // O valor mudou de verdade. A janela pertence ao patamar seguinte, que
        // passa a começar em novembro — a data real do reajuste.
        pendingSeasonalStart = run.start;
      }
      continue;
    }

    // ── Mês variável isolado ──
    if (run.length === 1 && current && !pendingSeasonalStart) {
      extend(current, run.end);
      continue;
    }

    // ── Retomada do mesmo valor ──
    if (current && current.grossCents === run.grossCents && !pendingSeasonalStart) {
      extend(current, run.end);
      continue;
    }

    const startCompetence = pendingSeasonalStart ?? run.start;
    pendingSeasonalStart = null;
    levels.push({
      grossCents: run.grossCents,
      startCompetence,
      endCompetence: run.end,
      months: monthsBetween(startCompetence, run.end) + 1,
      truncatedStart: levels.length === 0,
    });
  }

  return levels;
}

export function buildSalaryHistory(input: SalaryHistoryInput): SalaryHistoryResult {
  const competenceByBatch = new Map(input.batches.map((b) => [b.id, b.competence_month]));
  const competencesObserved = [...new Set(input.batches.map((b) => b.competence_month))].sort();
  const today = input.today ?? new Date().toISOString().slice(0, 7);

  const peopleByKey = new Map<string, SalaryHistoryPerson>();
  for (const person of input.people) {
    const key = person.payroll_name_key ?? normalizePayrollName(person.full_name);
    if (key) peopleByKey.set(key, person);
  }

  /** Uma entrada por (nome normalizado, competência): o lote pode ter várias linhas. */
  interface Bucket {
    displayName: string;
    byCompetence: Map<string, SalaryPoint>;
  }
  const buckets = new Map<string, Bucket>();

  for (const line of input.lines) {
    const competence = competenceByBatch.get(line.batch_id);
    const key = normalizePayrollName(line.employee_name);
    if (!competence || !key) continue;

    const bucket = buckets.get(key) ?? { displayName: line.employee_name.trim(), byCompetence: new Map() };
    const existing = bucket.byCompetence.get(competence);
    if (existing) {
      // Mesmo nome em mais de uma linha do lote (rateio entre centros de custo,
      // rescisão complementar): soma, e registra que foi soma.
      existing.grossCents += line.gross_amount_cents;
      existing.netCents = (existing.netCents ?? 0) + (line.net_amount_cents ?? 0);
      existing.lineCount += 1;
    } else {
      bucket.byCompetence.set(competence, {
        competence,
        batchId: line.batch_id,
        grossCents: line.gross_amount_cents,
        netCents: line.net_amount_cents,
        lineCount: 1,
        costCenterLabel: line.cost_center_label,
        contractType: line.contract_type,
      });
    }
    buckets.set(key, bucket);
  }

  const people: PersonSalaryHistory[] = [];
  const unmatched: UnmatchedPayrollName[] = [];

  for (const [key, bucket] of buckets) {
    const series = [...bucket.byCompetence.values()].sort((a, b) =>
      a.competence.localeCompare(b.competence),
    );
    const person = peopleByKey.get(key);

    if (!person) {
      // Nome sem pessoa: aparece como lacuna. Descartar em silêncio faria o
      // total da tela divergir do total da folha sem explicação nenhuma.
      unmatched.push({
        employeeName: bucket.displayName,
        normalizedName: key,
        competences: series.map((p) => p.competence),
        lastGrossCents: series[series.length - 1]?.grossCents ?? 0,
      });
      continue;
    }

    const levels = buildLevels(series);
    const currentLevel = levels[levels.length - 1] ?? null;
    const previousLevel = levels.length >= 2 ? levels[levels.length - 2] : null;
    const last = series[series.length - 1] ?? null;

    const monthsSinceLastRaise = currentLevel
      ? monthsBetween(currentLevel.startCompetence, today)
      : null;
    const monthsIsLowerBound = Boolean(currentLevel?.truncatedStart);

    let raiseStatus: RaiseStatus;
    if (monthsSinceLastRaise === null) {
      raiseStatus = 'indeterminate';
    } else if (monthsSinceLastRaise >= 12) {
      // Um piso de 12 meses já PROVA doze meses; a truncagem só esconde tempo
      // a mais, nunca a menos.
      raiseStatus = 'stale';
    } else if (monthsIsLowerBound) {
      // Piso abaixo de 12 não prova nada: o patamar pode ter começado antes.
      raiseStatus = 'indeterminate';
    } else {
      raiseStatus = 'recent';
    }

    people.push({
      personId: person.id,
      fullName: person.full_name,
      payrollNameKey: key,
      contractType: last?.contractType ?? null,
      costCenterLabel: last?.costCenterLabel ?? null,
      series,
      levels,
      currentGrossCents: last?.grossCents ?? null,
      lastRaiseCompetence: currentLevel && !currentLevel.truncatedStart ? currentLevel.startCompetence : null,
      lastRaisePercent:
        currentLevel && previousLevel && previousLevel.grossCents > 0
          ? ((currentLevel.grossCents - previousLevel.grossCents) / previousLevel.grossCents) * 100
          : null,
      monthsSinceLastRaise,
      monthsIsLowerBound,
      raiseStatus,
    });
  }

  people.sort((a, b) => a.fullName.localeCompare(b.fullName, 'pt-BR'));
  unmatched.sort((a, b) => b.lastGrossCents - a.lastGrossCents);

  const notes: string[] = [];
  if (competencesObserved.length > 0 && competencesObserved.length < 12) {
    notes.push(
      `O acervo tem ${competencesObserved.length} competência(s) de folha aprovada. Com menos de doze meses não é possível afirmar quem está sem reajuste há mais de um ano — esses casos ficam em "não determinado".`,
    );
  }
  if (unmatched.length > 0) {
    notes.push(
      `${unmatched.length} nome(s) da folha não têm pessoa correspondente no cadastro e ficam fora dos indicadores por pessoa. O vínculo é feito pelo nome normalizado; cadastre ou corrija a pessoa em Pessoas para incorporá-los.`,
    );
  }

  return {
    competencesObserved,
    people,
    unmatched,
    counts: {
      peopleMatched: people.length,
      peopleUnmatched: unmatched.length,
      withoutRaise12m: people.filter((p) => p.raiseStatus === 'stale').length,
      raisedWithin12m: people.filter((p) => p.raiseStatus === 'recent').length,
      indeterminate: people.filter((p) => p.raiseStatus === 'indeterminate').length,
    },
    notes,
  };
}
