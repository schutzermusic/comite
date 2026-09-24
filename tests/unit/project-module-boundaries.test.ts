/**
 * AS FRONTEIRAS DO MÓDULO DE PROJETOS.
 *
 * Estes testes leem o CÓDIGO-FONTE, e não o comportamento, porque o que eles
 * protegem é arquitetural: a fronteira só se rompe quando alguém escreve uma
 * linha nova no lugar errado, e o sintoma aparece meses depois como duas telas
 * discordando sobre o mesmo contrato.
 *
 * O que está sob guarda:
 *
 *   · Projetos não vira um segundo módulo de Contratos;
 *   · o mesmo marco é navegável nas quatro telas, pela identidade canônica;
 *   · o Gantt permanece o Gantt;
 *   · a decisão financeira do projeto continua sendo UMA.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import {
  contractBillingHref, contractContextHref, contractHref, documentsHref,
  measurementHref, timelineHref, MILESTONE_PARAM,
} from '@/lib/projects/cross-module-links';

const read = (p: string) => fs.readFileSync(p, 'utf8');

const CONTRACT_TAB = 'src/components/projects/ProjectContractTab.tsx';
const MEASUREMENTS_TAB = 'src/components/projects/measurements/ProjectMeasurementsTab.tsx';
const DOCUMENTS_TAB = 'src/components/projects/ProjectDocumentsView.tsx';
const PROJECT_PAGE = 'src/app/(main)/projetos/[id]/page.tsx';
const TIMELINE_TAB = 'src/components/projects/timeline/TimelineTab.tsx';

// ───────────────────────────────────────────────────────────────────────────
// AS ABAS, renomeadas
// ───────────────────────────────────────────────────────────────────────────

describe('as abas dizem o que são', () => {
  const page = read(PROJECT_PAGE);

  it('"Contrato" virou "Contexto Contratual"', () => {
    expect(page).toMatch(/Contexto contratual/i);
  });

  it('"Medições" virou "Medições & Evidências"', () => {
    expect(page).toMatch(/Medições (&amp;|&) Evidências/i);
  });

  it('as chaves de aba não mudaram — links antigos continuam funcionando', () => {
    const keys = page.match(/const TABS: TabId\[\] = \[([^\]]+)\]/)?.[1] ?? '';
    for (const key of ['overview', 'timeline', 'contract', 'measurements', 'finance', 'activity', 'risks', 'documents', 'team', 'timesheet', 'supply']) {
      expect(keys).toContain(`'${key}'`);
    }
  });
});

// ───────────────────────────────────────────────────────────────────────────
// PROJETOS NÃO É UM SEGUNDO MÓDULO DE CONTRATOS
// ───────────────────────────────────────────────────────────────────────────

describe('Contexto Contratual é projeção de leitura, não um editor', () => {
  const tab = read(CONTRACT_TAB);

  it('não escreve no contrato', () => {
    for (const forbidden of ['.insert(', '.update(', '.delete(', '.upsert(']) {
      expect(tab).not.toContain(forbidden);
    }
  });

  it('não replica cláusula, aditivo, garantia nem aprovação', () => {
    for (const table of [
      'contract_clauses', 'contract_amendments', 'contract_documents',
      'contract_approvals', 'contract_obligations', 'contract_billing_events',
    ]) {
      expect(tab).not.toContain(table);
    }
  });

  it('manda o leitor ao dono da verdade contratual', () => {
    expect(tab).toContain('Abrir em Contratos');
    expect(tab).toContain('contractHref');
  });
});

describe('Projetos não cria faturamento, medição nem marco', () => {
  /*
    A busca é por ACESSO — `.from('tabela')` e `.rpc('função')` —, e não pelo
    nome da tabela em texto: os comentários destes arquivos citam
    `contract_milestones` justamente para explicar que a identidade é de lá, e
    proibir a menção proibiria a documentação em vez do acoplamento.
  */
  it.each([CONTRACT_TAB, MEASUREMENTS_TAB, DOCUMENTS_TAB])(
    '%s não escreve em tabela de Contratos nem chama RPC de criação', (file) => {
      const source = read(file);
      for (const forbidden of [
        ".from('contract_milestones'", ".from('contract_billing_events'",
        ".rpc('contract_billing", ".rpc('project_measurements_materialize'",
        ".rpc('project_measurement_accept'",
      ]) {
        expect(source).not.toContain(forbidden);
      }
    },
  );
});

// ───────────────────────────────────────────────────────────────────────────
// A IDENTIDADE CANÔNICA ATRAVESSA AS QUATRO TELAS
// ───────────────────────────────────────────────────────────────────────────

describe('o mesmo marco é navegável em todas as direções', () => {
  it('os links carregam a identidade do marco, não um índice de lista', () => {
    expect(MILESTONE_PARAM).toBe('milestone');
    expect(timelineHref('p1', 'm2')).toBe('/projetos/p1?tab=timeline&milestone=m2');
    expect(measurementHref('p1', 'm2')).toBe('/projetos/p1?tab=measurements&milestone=m2');
    expect(contractContextHref('p1', 'm2')).toBe('/projetos/p1?tab=contract&milestone=m2');
    expect(documentsHref('p1', 'm2')).toBe('/projetos/p1?tab=documents&milestone=m2');
  });

  it('sem marco, o link leva à aba — e não a uma seleção vazia', () => {
    expect(timelineHref('p1')).toBe('/projetos/p1?tab=timeline');
  });

  it('faturamento e contrato apontam para o módulo Contratos', () => {
    expect(contractHref('c1')).toBe('/contratos/c1');
    expect(contractBillingHref('c1')).toBe('/contratos/c1?tab=finance');
  });

  it('de Contexto Contratual saem as três saídas do pedido', () => {
    const tab = read(CONTRACT_TAB);
    expect(tab).toContain('Ver no cronograma');
    expect(tab).toContain('Ver medição');
    expect(tab).toContain('Abrir em Contratos');
  });

  it('de Medições & Evidências saem cronograma, contrato, documentos e faturamento', () => {
    const tab = read(MEASUREMENTS_TAB);
    expect(tab).toContain('Ver no cronograma');
    expect(tab).toContain('Ver contexto contratual');
    expect(tab).toContain('Ver documentos');
    expect(tab).toContain('Ver faturamento');
  });

  it('do cronograma sai a medição do marco', () => {
    const drawer = read('src/components/projects/timeline/contract/MeasurementEventDrawer.tsx');
    expect(drawer).toContain('Ver medição');
    expect(drawer).toContain('measurementHref');
  });

  it('do acervo, a evidência volta para a medição do marco', () => {
    const tab = read(DOCUMENTS_TAB);
    expect(tab).toContain('Abrir medição');
    expect(tab).toContain('Abrir em Contratos');
  });

  it('as abas aceitam o marco em foco vindo de outra tela', () => {
    for (const file of [CONTRACT_TAB, MEASUREMENTS_TAB, DOCUMENTS_TAB]) {
      expect(read(file)).toContain('focusMilestoneId');
    }
    expect(read(PROJECT_PAGE)).toContain('MILESTONE_PARAM');
  });
});

// ───────────────────────────────────────────────────────────────────────────
// O GANTT PERMANECE O GANTT
// ───────────────────────────────────────────────────────────────────────────

describe('o cronograma não foi substituído', () => {
  const timeline = read(TIMELINE_TAB);

  it('continua montando o Gantt e a importação de MS Project', () => {
    expect(timeline).toContain('GanttView');
    expect(timeline).toContain('ImportWizard');
  });

  it('o evento de medição continua sendo sobreposição derivada', () => {
    expect(timeline).toContain('listProjectContractEvents');
    // Nada em Projetos escreve atividade sintética para representar o marco.
    expect(timeline).not.toContain('project_timeline_items');
  });

  it('a aba do cronograma continua existindo na página', () => {
    expect(read(PROJECT_PAGE)).toContain('<TimelineTab');
  });
});

// ───────────────────────────────────────────────────────────────────────────
// A DECISÃO FINANCEIRA CONTINUA SENDO UMA
// ───────────────────────────────────────────────────────────────────────────

describe('nenhum modelo de permissão financeira novo', () => {
  it('as telas não inventam chave de permissão financeira', () => {
    for (const file of [CONTRACT_TAB, MEASUREMENTS_TAB, DOCUMENTS_TAB]) {
      const source = read(file);
      expect(source).not.toContain('view_values');
      expect(source).not.toContain('PROJECT_FINANCIAL_PERMISSIONS');
    }
  });

  it('a quantia restrita é dita RESTRITO, e nunca cai no traço de não apurado', () => {
    expect(read(CONTRACT_TAB)).toContain("'Restrito'");
    expect(read(MEASUREMENTS_TAB)).toContain("'Restrito'");
  });

  it('a página continua fechando a aba Financeiro pela função canônica', () => {
    expect(read(PROJECT_PAGE)).toContain('canViewProjectFinancials');
  });
});
