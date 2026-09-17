/**
 * As provas do redesenho da aba INTELIGÊNCIA CONTRATUAL.
 *
 * O defeito que elas existem para impedir de voltar tem um número: em
 * JA10182283/2025 a aba dizia "21 itens requerem sua atenção" num contrato
 * cuja fila humana real tem 7. Não era erro de contagem — era a tabela errada.
 *
 *     contract_clauses ......................... 38 linhas. O TEXTO do PDF.
 *       (21 com o selo da política de extração, migration 154)
 *     contract_operational_interpretations ..... 29 linhas. O que o Apex OPERA.
 *       (22 `automatic`, 7 `requires_attention`, migration 161)
 *
 * As fixtures abaixo reproduzem a forma exata dos dados desse contrato. Nenhum
 * teste aqui verifica redação de rótulo: todos verificam de ONDE sai o número
 * e o que ele afirma.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

import {
  attentionReasonLabel, buildContractIntelligence, interpretationEffect,
  interpretationFacts, interpretationTitle, readConfidence,
  OPERATIONAL_FAMILY_LABEL,
  type ContractOperationalInterpretationRow,
} from '@/lib/contracts/intelligence/operational-interpretations';
import { FORBIDDEN_UI_TERMS } from '@/lib/contracts/trust/analysis-errors';
import { summarizeActions } from '@/lib/contracts/trust/attention';

const read = (path: string) => readFileSync(path, 'utf8');
const TAB = read('src/components/contracts/intelligence/ContractIntelligenceTab.tsx');
const DOSSIER = read('src/app/(main)/contratos/[id]/page.tsx');

/**
 * O arquivo SEM comentários.
 *
 * Os cabeçalhos desta aba citam, de propósito, o texto da tela que ela
 * substitui — "0 de 10 com cláusula validada", "Riscos: Sem registros". Uma
 * asserção sobre o arquivo cru encontraria a descrição do defeito e a leria
 * como o defeito. O que importa é o que RENDERIZA.
 */
const withoutComments = (source: string) => source
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

const TAB_RENDERED = withoutComments(TAB);

/** O corpo JSX do componente principal — onde a ORDEM da tela é decidida. */
const TAB_BODY = TAB.slice(
  TAB.indexOf('export function ContractIntelligenceTab('),
  TAB.indexOf('// faixa de comando'),
);

let seq = 0;
function interpretation(
  over: Partial<ContractOperationalInterpretationRow> = {},
): ContractOperationalInterpretationRow {
  seq += 1;
  return {
    id: `i-${seq}`,
    organization_id: 'org',
    contract_id: 'ja10182283',
    analysis_id: 'analysis-vigente',
    source_document_id: 'doc',
    family: 'obligations',
    fingerprint: `fp-${seq}`,
    normalized_payload: { title: `Exigência ${seq}`, confidence: 0.9 },
    source_page: 10,
    source_excerpt: 'trecho literal do contrato assinado',
    confidence: 0.9,
    provider: 'provedor',
    model: 'modelo',
    pipeline_version: 'contract-operationalization/1.0.0',
    requesting_user_id: null,
    trust_state: 'automatic',
    trust_reasons: [],
    trust_policy_version: 'contract-operational-trust/1.0.0',
    created_at: `2026-09-14T11:22:${String(28 + (seq % 30)).padStart(2, '0')}.000Z`,
    ...over,
  };
}

/** A leitura vigente de JA10182283: 11+6+0+3+2 automáticas, 3+4 retidas. */
function ja10182283(): ContractOperationalInterpretationRow[] {
  const rows: ContractOperationalInterpretationRow[] = [];
  const add = (
    family: ContractOperationalInterpretationRow['family'],
    count: number,
    over: Partial<ContractOperationalInterpretationRow> = {},
  ) => {
    for (let i = 0; i < count; i += 1) rows.push(interpretation({ family, ...over }));
  };
  add('obligations', 11);
  add('billing_conditions', 6);
  add('insurance_requirements', 3);
  add('indexation_rules', 2);
  add('guarantees', 3, {
    trust_state: 'requires_attention', trust_reasons: ['low_confidence'], confidence: 0,
  });
  add('insurance_requirements', 4, {
    trust_state: 'requires_attention', trust_reasons: ['material_financial_exposure'],
  });
  return rows;
}

// ═══════════════════════════════════════════════════════════════════════════
// 1 · o número que a tela afirma
// ═══════════════════════════════════════════════════════════════════════════

describe('1 · a fila humana é a operacional, e ela é pequena', () => {
  it('JA10182283 lê 29 interpretações, 22 estruturadas e 7 retidas', () => {
    const intelligence = buildContractIntelligence(ja10182283());
    expect(intelligence.total).toBe(29);
    expect(intelligence.structuredCount).toBe(22);
    expect(intelligence.attentionCount).toBe(7);
    // E a soma fecha: não há terceira categoria escondida.
    expect(intelligence.structuredCount + intelligence.attentionCount).toBe(intelligence.total);
  });

  it('a seção de atenção contém só `requires_attention`', () => {
    const { attention } = buildContractIntelligence(ja10182283());
    expect(attention).toHaveLength(7);
    for (const item of attention) {
      expect(item.trustState).toBe('requires_attention');
      expect(item.attentionReasons.length).toBeGreaterThan(0);
    }
  });

  it('a seção estruturada não contém nenhuma exceção', () => {
    const { structured } = buildContractIntelligence(ja10182283());
    const items = structured.flatMap((group) => group.items);
    expect(items).toHaveLength(22);
    for (const item of items) expect(item.trustState).toBe('automatic');
  });

  it('uma releitura SUBSTITUI a anterior — nunca soma as duas gerações', () => {
    /*
      Somar geraria "58 interpretações" e apresentaria o mesmo prazo de
      pagamento duas vezes, como se o contrato tivesse dois.
    */
    const antiga = ja10182283().map((row) => ({
      ...row,
      id: `velho-${row.id}`,
      analysis_id: 'analysis-superseded',
      created_at: '2026-09-13T02:34:55.000Z',
    }));
    const intelligence = buildContractIntelligence([...antiga, ...ja10182283()]);
    expect(intelligence.total).toBe(29);
    expect(intelligence.attentionCount).toBe(7);
    expect(intelligence.analysisId).toBe('analysis-vigente');
  });

  it('sem interpretação nenhuma, a fila é zero — e não uma fila de cláusulas', () => {
    const intelligence = buildContractIntelligence([]);
    expect(intelligence.total).toBe(0);
    expect(intelligence.attentionCount).toBe(0);
    expect(intelligence.analysisId).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2 · o crachá e a aba leem a tabela certa
// ═══════════════════════════════════════════════════════════════════════════

describe('2 · a contagem sai das interpretações, não das cláusulas', () => {
  it('o contador do dossiê deriva de `operationalInterpretations`', () => {
    expect(DOSSIER).toMatch(
      /attentionCount = useMemo\(\s*\(\) => buildContractIntelligence\(detail\?\.operationalInterpretations/,
    );
  });

  it('nenhum contador do dossiê volta a filtrar cláusulas por interpretation_state', () => {
    expect(DOSSIER).not.toMatch(
      /clauses[\s\S]{0,80}filter\([^)]*interpretation_state === 'requires_attention'\)\.length/,
    );
  });

  it('a aba recebe as duas listas SEPARADAS, e não uma no lugar da outra', () => {
    expect(DOSSIER).toContain('interpretations={detail.operationalInterpretations}');
    expect(DOSSIER).toContain('clauses={detail.clauses}');
  });

  it('a falha de leitura das interpretações não vira fila vazia', () => {
    // `null` = leu; string = falhou. A tela precisa distinguir os dois.
    expect(DOSSIER).toContain('interpretationsError={detail.operationalInterpretationsError}');
    expect(TAB).toContain('interpretationsError');
    expect(TAB).toMatch(/permanece desconhecida, e não vazia/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3 · ausência continua ausência
// ═══════════════════════════════════════════════════════════════════════════

describe('3 · nada ausente vira zero, e nada nulo vira "Não"', () => {
  it('sem prazo, valor ou percentual, o efeito é `null` — nunca 0', () => {
    expect(interpretationEffect(interpretation({
      family: 'guarantees',
      normalized_payload: { title: 'Garantia sem valor', required_amount: null, required_percentage: null },
    }))).toBeNull();
    expect(interpretationEffect(interpretation({
      family: 'insurance_requirements',
      normalized_payload: { title: 'Seguro sem cobertura escrita', required_coverage: null },
    }))).toBeNull();
  });

  it('um prazo escrito é lido com a base de calendário que o contrato usa', () => {
    expect(interpretationEffect(interpretation({
      family: 'obligations',
      normalized_payload: {
        title: 'Prazo máximo de execução', due_kind: 'days_after_activation',
        due_offset_days: 240, calendar_basis: 'calendar_days',
      },
    }))).toBe('240 dias corridos');
    expect(interpretationEffect(interpretation({
      family: 'obligations',
      normalized_payload: {
        title: 'Aprovação do BM', due_kind: 'days_after_activation',
        due_offset_days: 5, calendar_basis: 'business_days',
      },
    }))).toBe('5 dias úteis');
  });

  it('`blocks_billing: null` NÃO produz "não bloqueia"', () => {
    const facts = interpretationFacts(interpretation({
      family: 'obligations',
      normalized_payload: { title: 'Obrigação', blocks_billing: null },
    }));
    expect(facts.some((f) => f.label === 'Efeito no faturamento')).toBe(false);
  });

  it('`blocks_billing: true` é afirmado, porque o contrato o afirmou', () => {
    const facts = interpretationFacts(interpretation({
      family: 'obligations',
      normalized_payload: { title: 'Obrigação', blocks_billing: true },
    }));
    expect(facts).toContainEqual({ label: 'Efeito no faturamento', value: 'Bloqueia o faturamento' });
  });

  it('interpretação sem título não inventa um', () => {
    expect(interpretationTitle(interpretation({ normalized_payload: {} })))
      .toBe('Interpretação sem título registrado');
  });

  it('confiança ausente é `null`, e não 0% — que seria uma medição', () => {
    expect(readConfidence(null)).toBeNull();
    expect(readConfidence('')).toBeNull();
    expect(readConfidence('0.85')).toBeCloseTo(0.85);
    // Zero MEDIDO continua zero: foi o que a política de confiança apurou.
    expect(readConfidence(0)).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4 · vocabulário de negócio
// ═══════════════════════════════════════════════════════════════════════════

describe('4 · a tela não fala de banco, provedor nem modelo', () => {
  it('nenhum termo técnico proibido aparece na aba', () => {
    const lower = TAB.toLowerCase();
    for (const term of FORBIDDEN_UI_TERMS) {
      // `model` aparece em `documentById`/`readonly`… a busca é por palavra.
      const asWord = new RegExp(`["'>\\s]${term.replace('.', '\\.')}[\\s<"']`, 'i');
      expect(asWord.test(lower), `termo proibido na interface: ${term}`).toBe(false);
    }
  });

  it('nome de tabela não vaza para o usuário', () => {
    // Só em comentário — nunca dentro de um literal renderizado.
    expect(TAB_RENDERED).not.toMatch(/em contract_clauses|contract_operational_interpretations['"]/);
  });

  it('o motivo da exceção é dito em negócio, não em código de política', () => {
    expect(attentionReasonLabel('low_confidence')).toBe('Baixa confiança documental');
    expect(attentionReasonLabel('material_financial_exposure')).toBe('Exposição financeira material');
    // Um motivo que esta versão não conhece degrada sem vazar o código.
    expect(attentionReasonLabel('motivo_que_ainda_nao_existe')).toBe('Exceção de governança');
  });

  it('as famílias têm nome de negócio, e não de tabela', () => {
    expect(OPERATIONAL_FAMILY_LABEL.billing_conditions).toBe('Condições de pagamento');
    expect(OPERATIONAL_FAMILY_LABEL.indexation_rules).toBe('Reajuste e indexação');
    for (const label of Object.values(OPERATIONAL_FAMILY_LABEL)) {
      expect(label).not.toMatch(/_/);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5 · exceção primeiro, detalhe sob demanda
// ═══════════════════════════════════════════════════════════════════════════

describe('5 · a arquitetura da tela', () => {
  it('a atenção vem antes do que já está estruturado', () => {
    // A ordem que importa é a do JSX, não a das declarações no arquivo.
    expect(TAB_BODY.indexOf('<AttentionZone'))
      .toBeLessThan(TAB_BODY.indexOf('<StructuredZone'));
  });

  it('o resumo executivo vem antes de tudo', () => {
    expect(TAB_BODY.indexOf('<CommandStrip'))
      .toBeLessThan(TAB_BODY.indexOf('<AttentionZone'));
  });

  it('as cláusulas de origem vêm por último, e recolhidas', () => {
    expect(TAB_BODY.indexOf('<StructuredZone'))
      .toBeLessThan(TAB_BODY.indexOf('<AuditZone'));
    expect(TAB).toContain('const [clausesOpen, setClausesOpen] = useState(false);');
  });

  it('a linha estruturada não repete o estado que o cabeçalho já deu', () => {
    const row = TAB.slice(TAB.indexOf('function OperationalRow('), TAB.indexOf('function RecordsZone('));
    for (const noise of ['Registrada', 'Em revisão', 'Estruturado pelo Apex', 'origem documental']) {
      expect(row, `a linha compacta repete "${noise}"`).not.toContain(noise);
    }
  });

  it('o detalhe mora numa gaveta lateral, não na página', () => {
    expect(TAB).toContain('<HudDrawer');
    expect(TAB).toContain('function EvidenceDrawer(');
    // Trecho de origem e confiança são detalhe: só existem dentro da gaveta.
    const página = TAB.slice(0, TAB.indexOf('function EvidenceDrawer('));
    expect(página).not.toContain('source_excerpt');
    expect(página).not.toMatch(/Confiança da leitura/);
  });

  it('a cobertura "N de 10 com cláusula validada" não voltou', () => {
    expect(TAB_RENDERED).not.toMatch(/com cláusula validada/);
    expect(DOSSIER).not.toContain('<ClauseOpsPanel');
    expect(DOSSIER).not.toContain('<ClauseRiskIntelligencePanel');
  });

  it('"Reanalisar" saiu do fluxo primário e ganhou confirmação', () => {
    expect(TAB).not.toContain('Reanalisar');
    expect(DOSSIER).toContain('Reanalisar documento contratual');
    expect(DOSSIER).toMatch(/Reler o documento contratual\?/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 6 · exposição, risco e penalidade são três coisas
// ═══════════════════════════════════════════════════════════════════════════

describe('6 · ausência de registro não é ausência de contrato', () => {
  it('"Sem registros" some; o que fica diz de QUE a ausência é evidência', () => {
    expect(TAB_RENDERED).not.toContain('Sem registros');
    expect(TAB).toContain('Riscos vinculados');
    expect(TAB).toContain('Penalidades registradas');
    // A frase importa; a caixa da primeira letra depende de ela abrir a
    // sentença ou seguir o número, e isso é diagramação, não governança.
    expect(TAB).toMatch(/nenhum risco formal vinculado/i);
    expect(TAB).toMatch(/nenhuma ocorrência de penalidade registrada/i);
  });

  it('a ausência de penalidade registrada não afirma ausência de cláusula de multa', () => {
    expect(TAB).toMatch(/não diz que o contrato não tem\s*\n?\s*cláusula de multa/);
  });

  it('a exposição lida do documento é separada do risco formal', () => {
    expect(TAB).toContain('Exposição contratual identificada');
    expect(TAB).toMatch(/Não é risco formal da empresa/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 7 · o dossiê e a aba contam a MESMA fila
// ═══════════════════════════════════════════════════════════════════════════

describe('7 · uma fonte canônica para "requer atenção"', () => {
  const ATTENTION = read('src/lib/contracts/trust/attention.ts');
  const DECK = read('src/components/contracts/cockpit/ContractCommandDeck.tsx');
  const CENTER = read('src/components/contracts/cockpit/ContractActionCenter.tsx');

  it('a Central de Ação deriva a contagem das INTERPRETAÇÕES, não das cláusulas', () => {
    /*
      Este bloco lia `contract.clauses` filtrando `interpretation_state`, e
      punha "21 interpretações contratuais requerem sua atenção" no topo do
      dossiê enquanto a aba dizia 7. Dois números para a mesma frase, na mesma
      tela, e o maior deles no lugar mais visível.
    */
    expect(ATTENTION).toContain('contract.operationalInterpretations');
    expect(ATTENTION).not.toMatch(
      /contract\.clauses\.value\.filter[\s\S]{0,120}interpretation_state === 'requires_attention'/,
    );
  });

  it('as duas superfícies chamam a MESMA função — não há segunda implementação', () => {
    expect(ATTENTION).toContain('buildContractIntelligence');
    expect(TAB).toContain('buildContractIntelligence');
    expect(DOSSIER).toContain('buildContractIntelligence');
  });

  it('a contagem do dossiê acompanha a da aba sobre a mesma leitura', () => {
    // 29 interpretações, 7 retidas: os dois números que a tela precisa dizer
    // igual em dois lugares.
    const intelligence = buildContractIntelligence(ja10182283());
    expect(intelligence.attentionCount).toBe(7);

    // E a frase do dossiê é construída a partir DESSE número, não de outro.
    expect(ATTENTION).toMatch(
      /intelligence\.attentionCount === 1[\s\S]{0,160}\$\{intelligence\.attentionCount\} interpretações/,
    );
  });

  it('a falha de leitura não vira fila vazia', () => {
    const READ_MODEL = read('src/lib/contracts/trust/read-model.ts');
    expect(READ_MODEL).toContain('operationalInterpretationsError');
    // `hasOfficialValue` é falso num `failed`, então o item simplesmente não é
    // emitido — em vez de ser emitido com zero.
    expect(ATTENTION).toContain('hasOfficialValue(contract.operationalInterpretations)');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 8 · a plataforma de comando
// ═══════════════════════════════════════════════════════════════════════════

describe('8 · o topo do dossiê', () => {
  const DECK = read('src/components/contracts/cockpit/ContractCommandDeck.tsx');
  const CENTER = read('src/components/contracts/cockpit/ContractActionCenter.tsx');

  it('nenhum número do topo passa por um fallback de zero', () => {
    // Todo valor atravessa `TrustedValue`; um `?? 0` aqui reintroduziria o
    // achatamento MISSING → zero que o Trust Layer existe para impedir.
    expect(DECK).toContain('<TrustedValue');
    // Sem comentários: o cabeçalho deste componente CITA "Nenhum `?? 0`", e a
    // asserção encontraria a promessa em vez da violação.
    expect(withoutComments(DECK)).not.toMatch(/\?\?\s*0\b/);
    expect(DECK).toContain('missingLabel="Não apurada"');
  });

  it('execução sem apuração desenha trilho tracejado, nunca barra em zero', () => {
    expect(DECK).toContain("data-unmeasured={pct === null ? 'true' : undefined}");
    expect(DECK).toMatch(/pct !== null && <i style=\{\{ width/);
  });

  it('o compacto não esconde o valor exato do contrato', () => {
    expect(DECK).toContain('officialCurrencyFull(contract.totalValue)');
  });

  it('não há um quarto Intl.NumberFormat compacto no módulo', () => {
    // `compactContractCurrency` é o ponto único; três cópias idênticas destas
    // opções é a distância até duas telas arredondarem o mesmo contrato
    // de formas diferentes.
    expect(DECK).not.toContain('new Intl.NumberFormat');
    expect(DECK).toContain('compactContractCurrency');
  });

  it('a severidade da linha vem do backend, e desenha trilho e rótulo', () => {
    expect(CENTER).toContain('data-severity={item.severity}');
    // Nenhuma prioridade inventada: a ordem sai de `severity` + `rank`, que
    // `attentionItems` já produz.
    expect(CENTER).toContain('ATTENTION_SEVERITY_ORDER[a.severity]');
    expect(CENTER).toContain('|| a.rank - b.rank');
  });

  it('o resumo semântico é derivado, nunca escrito à mão', () => {
    expect(summarizeActions([])).toBeNull();
    const one = summarizeActions([
      { severity: 'warning' } as never,
    ]);
    // Uma categoria só já está dita pelo total — repeti-la é a mesma
    // informação duas vezes.
    expect(one).toBeNull();
    const mixed = summarizeActions([
      { severity: 'warning' } as never,
      { severity: 'setup' } as never,
      { severity: 'setup' } as never,
    ]);
    expect(mixed).toBe('1 decisão · 2 configuração');
  });

  it('o dossiê deixou de empilhar três molduras para a mesma pergunta', () => {
    // Identidade, faixa operacional e central de ação numa folha só.
    expect(DOSSIER).toContain('<ContractCommandDeck');
    expect(DOSSIER).toContain('variant="band"');
    expect(DOSSIER).not.toContain('<HudHeader');
    expect(DOSSIER).not.toContain('<FinancialPulse');
    expect(DOSSIER).not.toContain('<ProjectRelation');
  });

  it('a Central de Ação não corta a fila em três', () => {
    // `max={3}` escondia pendências sem dizer quantas ficaram de fora.
    const call = DOSSIER.slice(DOSSIER.indexOf('<ContractActionCenter'));
    expect(call.slice(0, 400)).not.toMatch(/max=\{\d+\}/);
  });
});
