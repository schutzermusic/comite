/**
 * Dicionário de rubricas da folha (S-1010) e classificação das verbas.
 *
 * POR QUE ISTO EXISTE
 *
 * O S-1200 declara cada verba apenas por `codRubr` + `ideTabRubr`, e o valor em
 * `vrRubr` vem SEMPRE positivo. Não há natureza nem sinal no evento de
 * remuneração: quem diz se a verba é provento, desconto ou mera informação é a
 * tabela de rubricas do empregador, transmitida no S-1010.
 *
 * Sem esse dicionário, qualquer classificação é chute — e o chute anterior
 * ("valor negativo = desconto", "natureza 1 = hora extra") produzia folha bruta
 * inflada por descontos e informativas, e horas extras sempre zeradas.
 *
 * LIMITE CONHECIDO
 *
 * O S-1010 é um evento de TABELA: o empregador o transmite uma vez, quando cria
 * ou altera a rubrica. O pacote do eSocial Download só entrega o que está dentro
 * da janela de retenção, então normalmente vêm apenas as alterações recentes —
 * não a tabela inteira. É por isso que a cobertura é medida e reportada: um
 * indicador calculado sobre 2% das rubricas não é um indicador, é ruído.
 */
import type { ParsedEsocialEvent } from './parser';

export interface RubricaDef {
  code: string;
  /** ideTabRubr — o mesmo código pode existir em tabelas diferentes. */
  tableId: string;
  /** natRubr: código da Tabela 3 do eSocial (natureza da rubrica). */
  nature?: string;
  /** tpRubr: 1 provento, 2 desconto, 3 informativa, 4 informativa dedutora. */
  type?: string;
  description?: string;
  /** iniValid (AAAA-MM) — desempata versões da mesma rubrica. */
  validFrom?: string;
}

/**
 * Papel da verba no fechamento do mês.
 *
 * `informativa` é uma categoria de primeira classe, não um caso de borda: as
 * rubricas de base (FGTS, INSS) aparecem no S-1200 com valor cheio e somá-las à
 * folha bruta duplica a massa salarial.
 */
export type RubricaRole = 'provento' | 'desconto' | 'informativa' | 'desconhecida';

const ROLE_BY_TP_RUBR: Record<string, RubricaRole> = {
  '1': 'provento',
  '2': 'desconto',
  '3': 'informativa',
  '4': 'informativa',
};

/**
 * Naturezas (Tabela 3) de horas extras.
 *
 * 1003 está confirmado pelos dados reais do empregador: as rubricas 263
 * ("HORAS EXTRAS 150 VALOR") e 268 ("HORAS EXTRAS 100 VALOR") declaram ambas
 * natRubr 1003 na própria tabela validada pelo eSocial.
 *
 * O DSR sobre horas extras (natureza 1012) fica DE FORA de propósito: a mesma
 * natureza cobre o DSR de faltas e de outras verbas, então incluí-la contaria
 * como hora extra coisa que não é.
 */
const OVERTIME_NATURES = new Set(['1003']);

/**
 * Naturezas de benefício, agrupadas pelo tipo que o cockpit exibe.
 *
 * 1806 está confirmado nos dados do empregador (rubrica 9382, "VALE
 * ALIMENTACAO"). Os demais seguem a Tabela 3 do eSocial. Uma natureza de
 * benefício fora deste mapa continua contando como benefício, em "outros" —
 * perder o total seria pior que não saber o tipo.
 */
export type BenefitKind = 'va' | 'vr' | 'health' | 'dental' | 'transport' | 'other';

const BENEFIT_KIND_BY_NATURE: Record<string, BenefitKind> = {
  '1806': 'va', // alimentação (vale/cesta/refeição em pecúnia)
  '1807': 'vr',
  '1808': 'transport', // vale-transporte
  '1809': 'health', // assistência médica/odontológica
  '1810': 'dental',
};

const BENEFIT_NATURES = new Set(Object.keys(BENEFIT_KIND_BY_NATURE));

export function benefitKind(def: RubricaDef | undefined): BenefitKind | undefined {
  if (!isBenefitRubrica(def)) return undefined;
  return (def!.nature ? BENEFIT_KIND_BY_NATURE[def!.nature] : undefined) ?? 'other';
}

/**
 * Heurística por descrição — só se aplica a rubricas QUE ESTÃO na tabela.
 *
 * Não inventa dado: serve para a rubrica cuja natureza veio em branco ou fora
 * do previsto, situação comum em tabela antiga migrada de outro sistema.
 */
const OVERTIME_DESCRIPTION = /\bh(?:ora|r)s?\.?\s*extra/i;

export class RubricaTable {
  private readonly byKey = new Map<string, RubricaDef>();

  static key(code: string, tableId?: string): string {
    return `${code}|${tableId ?? ''}`;
  }

  add(def: RubricaDef): void {
    const key = RubricaTable.key(def.code, def.tableId);
    const current = this.byKey.get(key);
    // Mesma rubrica pode chegar em várias vigências; a mais recente é a que
    // vale para as competências que o cockpit exibe.
    if (current && (current.validFrom ?? '') > (def.validFrom ?? '')) return;
    this.byKey.set(key, def);
  }

  get(code: string, tableId?: string): RubricaDef | undefined {
    return this.byKey.get(RubricaTable.key(code, tableId)) ?? this.byKey.get(RubricaTable.key(code));
  }

  get size(): number {
    return this.byKey.size;
  }
}

/** Monta o dicionário a partir dos eventos S-1010 do acervo. */
export function buildRubricaTable(events: ParsedEsocialEvent[]): RubricaTable {
  const table = new RubricaTable();
  for (const ev of events) {
    if (ev.payload.kind !== 'rubric-table') continue;
    for (const def of ev.payload.rubricas) table.add(def);
  }
  return table;
}

export function rubricaRole(def: RubricaDef | undefined): RubricaRole {
  if (!def) return 'desconhecida';
  return (def.type ? ROLE_BY_TP_RUBR[def.type] : undefined) ?? 'desconhecida';
}

export function isOvertimeRubrica(def: RubricaDef | undefined): boolean {
  if (!def) return false;
  if (def.nature && OVERTIME_NATURES.has(def.nature)) return true;
  return OVERTIME_DESCRIPTION.test(def.description ?? '');
}

export function isBenefitRubrica(def: RubricaDef | undefined): boolean {
  return Boolean(def?.nature && BENEFIT_NATURES.has(def.nature));
}

// Quanto da folha foi efetivamente classificado é medido na apuração
// (rubric_total_cents / rubric_mapped_cents) e interpretado do lado da leitura,
// em `src/lib/workforce/esocial-coverage.ts` — é lá que mora a decisão de
// exibir a composição ou cair para a base apurada pelos totalizadores.
