/**
 * Guarda das operações do Quick Dossier.
 *
 * P0.4 trocou a camada de DADOS do drawer sem tocar em suas ações. Este arquivo
 * existe para que a próxima refatoração não derrube uma operação por descuido:
 * cada uma é um fluxo que atravessa serviço, RLS e outro módulo, e a perda
 * passaria despercebida numa revisão de diff grande.
 *
 * A verificação é ESTRUTURAL, e deliberadamente: o vitest deste repositório
 * roda em `environment: 'node'`, sem jsdom e sem `@testing-library`, então
 * componentes não podem ser renderizados. Ler o wiring na fonte é a checagem
 * mais forte disponível sem introduzir uma stack de testes nova.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf-8');

const DRAWER = 'src/components/contracts/ContractDossierDrawer.tsx';
const ACTIONS_HOOK = 'src/components/contracts/useContractActionModals.tsx';
const CREATE_HOOK = 'src/components/contracts/useContractCreateModals.tsx';
const LIST_PAGE = 'src/app/(main)/contratos/page.tsx';

/**
 * As treze operações que o Quick Dossier precisa continuar oferecendo, com o
 * ponto do código que as sustenta.
 */
const OPERATIONS: { name: string; file: string; anchors: string[] }[] = [
  { name: 'Vincular projeto', file: DRAWER, anchors: ['onLinkProject'] },
  { name: 'Criar obrigação', file: DRAWER, anchors: ['onCreateObligation'] },
  { name: 'Criar faturamento', file: DRAWER, anchors: ['onCreateBilling'] },
  { name: 'Criar tarefa', file: DRAWER, anchors: ['onCreateTask'] },
  { name: 'Criar risco', file: DRAWER, anchors: ['onCreateRisk'] },
  { name: 'Vincular risco existente', file: DRAWER, anchors: ['onLinkExistingRisk'] },
  { name: 'Anexar documento', file: DRAWER, anchors: ['onAttachDocument'] },
  { name: 'Aprovar / rejeitar', file: DRAWER, anchors: ['onReviewApproval'] },
  { name: 'Enviar ao jurídico', file: DRAWER, anchors: ['onSendToLegal'] },
  { name: 'Abrir Financeiro', file: DRAWER, anchors: ['onOpenFinance'] },
  { name: 'Abrir Faturamento', file: DRAWER, anchors: ['onOpenBilling'] },
  { name: 'Abrir Documentos', file: DRAWER, anchors: ['onViewDocuments'] },
  { name: 'Abrir dossiê completo', file: DRAWER, anchors: ['onView'] },
  { name: 'Gerar PDF', file: DRAWER, anchors: ['onExportPdf'] },
];

describe('operações do Quick Dossier preservadas', () => {
  const drawer = read(DRAWER);

  for (const op of OPERATIONS) {
    it(`"${op.name}" continua ligada`, () => {
      const source = read(op.file);
      for (const anchor of op.anchors) {
        expect(source, `${op.name}: âncora "${anchor}" desapareceu`).toContain(anchor);
      }
    });
  }

  it('todas as operações seguem declaradas nas props do drawer', () => {
    const propsBlock = drawer.slice(0, drawer.indexOf('export function ContractDossierDrawer'));
    for (const op of OPERATIONS) {
      for (const anchor of op.anchors) {
        expect(propsBlock, `${anchor} saiu da interface de props`).toContain(anchor);
      }
    }
  });

  it('as ações por item continuam disponíveis', () => {
    // Concluir obrigação, marcar faturado e aprovar/rejeitar documento.
    expect(drawer).toContain('openCompleteObligation');
    expect(drawer).toContain('openRealizeBilling');
    expect(drawer).toContain('updateContractDocumentStatus');
    expect(drawer).toContain('createTaskFromObligation');
  });

  it('o gating por permissão sobreviveu à migração', () => {
    expect(drawer).toContain('permissions.edit');
    expect(drawer).toContain('permissions.approve');
    expect(drawer).toContain('permissions.uploadDoc');
  });

  it('o refresh pós-mutação continua religando os dados', () => {
    // Sem isto, uma ação bem-sucedida deixaria a tela desatualizada.
    expect(drawer).toContain('refreshAfterMutation');
    expect(drawer).toContain('onDataChanged');
    expect(drawer).toContain('loadDetail');
  });
});

describe('ações do hook de contrato preservadas', () => {
  const hook = read(ACTIONS_HOOK);

  for (const action of ['linkProject', 'createTask', 'createRisk', 'attachDocument', 'sendToLegal', 'reviewApproval', 'linkExistingRisk']) {
    it(`ContractActions.${action} continua exportada`, () => {
      expect(hook).toContain(action);
    });
  }

  it('as mutações reais seguem sendo chamadas', () => {
    expect(hook).toContain('updateContract');
    expect(hook).toContain('submitContractApproval');
  });

  it('criação de obrigação e faturamento continua ligada', () => {
    const create = read(CREATE_HOOK);
    // A obrigação passou a gravar a DEFINIÇÃO canônica pela rota da Fase 3;
    // `createContractObligation` escrevia na lista de tarefas legada, que hoje
    // é somente-leitura.
    expect(create).toContain('/obligations');
    expect(create).toContain('sourceClauseId');
    expect(create).toContain('createContractBillingEvent');
  });
});

describe('navegação cross-módulo preservada', () => {
  const page = read(LIST_PAGE);

  it('as rotas de Financeiro, Faturamento e Documentos continuam apontando para o dossiê', () => {
    expect(page).toContain("router.push");
    expect(page).toContain('/contratos/');
  });

  it('o export de PDF do drawer continua ligado ao handler', () => {
    expect(page).toContain('handleExportPdf');
    expect(page).toContain('openContractDossierReport');
  });

  it('o upload de logo do cliente continua no drawer', () => {
    const drawerSrc = read(DRAWER);
    expect(drawerSrc).toContain('onLogoUpload');
    expect(drawerSrc).toContain('ClientLogoUploadSlot');
    expect(page).toContain('handleContractLogoUpload');
    expect(page).toContain('onLogoUpload={handleContractLogoUpload}');
  });
});

describe('o matcher de projeto por hash não pode voltar', () => {
  it('o read model confiável não importa o enricher', () => {
    const readModel = read('src/lib/contracts/trust/read-model.ts');
    expect(readModel).not.toContain('contract-governance-data');
    expect(readModel).not.toContain('enrichContractsForGovernance');
  });

  it('o dossiê PDF não importa o enricher', () => {
    const dossier = read('src/lib/reports/modules/contract-dossier-report.ts');
    expect(dossier).not.toContain('contract-governance-data');
  });

  it('resolveProject segue confinado ao módulo de demonstração', () => {
    const enricher = read('src/components/contracts/contract-governance-data.ts');
    expect(enricher).toContain('resolveProject');
    // E o módulo demo exige intenção explícita para ser usado.
    expect(enricher).toContain('DEMO_PREVIEW_INTENT');
  });
});

// ═══════════════════════════════════════════════════════════════════
// P1A — o redesenho não pode ter perdido nada pelo caminho
// ═══════════════════════════════════════════════════════════════════

describe('cockpit P1A: composição e integridade', () => {
  const drawer = read(DRAWER);

  it('as nove seções do cockpit estão montadas, na ordem especificada', () => {
    const ordem = [
      'ContractIdentity',
      'ProjectRelation',
      'FinancialPulse',
      'RequiresAttention',
      'RecommendedActionPanel',
      'ConnectedOperations',
      'ContractHealthDrivers',
      'Detalhes do contrato',
      'RecentActivity',
    ];
    let cursor = -1;
    for (const secao of ordem) {
      const at = drawer.indexOf(secao, cursor + 1);
      expect(at, `seção "${secao}" ausente ou fora de ordem`).toBeGreaterThan(cursor);
      cursor = at;
    }
  });

  it('as seções operacionais F–I sobreviveram ao redesenho', () => {
    // Elas carregam as ações POR ITEM (concluir obrigação, faturar, aprovar
    // documento) — perdê-las seria perder função, não só layout.
    for (const secao of ['F · Obrigações', 'G · Faturamento', 'H · Documentos', 'I · Tarefas']) {
      expect(drawer, `seção "${secao}" sumiu`).toContain(secao);
    }
  });

  it('toda ação de atenção despacha para uma operação existente do drawer', () => {
    // O switch precisa cobrir as oito chaves; uma chave sem caso viraria um
    // botão que não faz nada.
    for (const key of [
      'linkProject', 'reviewApproval', 'createObligation', 'createBilling',
      'attachDocument', 'openDocuments', 'openBilling', 'openObligations',
    ]) {
      expect(drawer, `runAttentionAction não trata "${key}"`).toContain(`case '${key}'`);
    }
  });

  it('Connected Operations navega para as seis relações', () => {
    for (const key of ['project', 'billing', 'documents', 'obligations', 'risks', 'approvals']) {
      expect(drawer).toContain(`case '${key}'`);
    }
  });

  it('a auditoria real alimenta a atividade recente', () => {
    expect(drawer).toContain('listContractAuditEvents');
    expect(drawer).toContain('RecentActivity');
  });

  it('o cockpit não renderiza nada antes de o modelo confiável existir', () => {
    // Sem esta guarda, o drawer voltaria a pintar valores do record sintético
    // no instante inicial.
    expect(drawer).toContain('trusted ? (');
    expect(drawer).toContain('{trusted &&');
  });
});

describe('nenhum componente do cockpit achata estado de confiança', () => {
  const COCKPIT = [
    'src/components/contracts/cockpit/TrustedValue.tsx',
    'src/components/contracts/cockpit/FinancialPulse.tsx',
    'src/components/contracts/cockpit/ProjectRelation.tsx',
    'src/components/contracts/cockpit/ConnectedOperations.tsx',
    'src/components/contracts/cockpit/ContractHealthDrivers.tsx',
    'src/components/contracts/cockpit/RequiresAttention.tsx',
  ];

  it('nenhum usa `?? 0` para preencher indicador ausente', () => {
    for (const file of COCKPIT) {
      const src = read(file);
      // `?? 0` só é aceitável como argumento de barra de progresso, e lá vem
      // sempre acompanhado de showLabel={false} (testado abaixo).
      const suspeitos = src.split('\n').filter((l) => {
        const code = l.trim();
        if (code.startsWith('*') || code.startsWith('//')) return false;  // prosa
        return code.includes('?? 0') && !code.includes('value={pct ?? 0}');
      });
      expect(suspeitos, `${file}: "?? 0" fora da barra de progresso`).toEqual([]);
    }
  });

  it('a barra de progresso nunca imprime o próprio 0% sobre valor não apurado', () => {
    // `HudProgressBar` tem showLabel=true por padrão; um "0%" ao lado de
    // "Não apurada" é exatamente o achatamento MISSING → zero.
    for (const file of [
      'src/components/contracts/cockpit/FinancialPulse.tsx',
      'src/components/contracts/ContractCard.tsx',
      'src/components/contracts/contract-list.tsx',
    ]) {
      const src = read(file);
      if (!src.includes('HudProgressBar')) continue;
      expect(src, `${file}: barra sem showLabel={false}`).toContain('showLabel={false}');
    }
  });

  it('nenhum componente do cockpit importa o enricher de demonstração', () => {
    for (const file of COCKPIT) {
      expect(read(file)).not.toContain('contract-governance-data');
    }
  });

  it('as fontes novas respeitam o piso de 11px do design system', () => {
    for (const file of COCKPIT) {
      const src = read(file);
      for (const proibido of ['text-[10px]', 'text-[9px]', 'text-[9.5px]', 'text-[8px]']) {
        expect(src, `${file} usa ${proibido}`).not.toContain(proibido);
      }
    }
  });
});

// ═══════════════════════════════════════════════════════════════════
// P1C — Contratos como camada de orquestração
// ═══════════════════════════════════════════════════════════════════

describe('orquestração cross-módulo (P1C)', () => {
  it('as tarefas vinculadas distinguem erro de ausência na leitura', () => {
    const service = read('src/lib/contracts/contract-service.ts');
    const fn = service.slice(service.indexOf('export async function listContractRelatedTasks'));
    const body = fn.slice(0, fn.indexOf('\n}\n') + 2);
    // A regressão histórica: `if (error) return [];` fazia falha de leitura
    // virar "nenhuma tarefa vinculada" na linha de operações conectadas.
    expect(body).not.toMatch(/if \(error\) return \[\];/);
    expect(body).toContain('error: error.message');
  });

  it('nenhuma superfície consome as tarefas como array cru', () => {
    for (const file of [
      'src/components/contracts/ContractDossierDrawer.tsx',
      'src/app/(main)/contratos/[id]/page.tsx',
    ]) {
      const src = read(file);
      if (!src.includes('listContractRelatedTasks')) continue;
      // O resultado tem de ser lido como `{ rows, error }`.
      expect(src, `${file}: erro de leitura de tarefas ignorado`).toMatch(/tasks\.rows|tasksResult/);
    }
  });

  it('Quick e Full Dossier alimentam as operações conectadas com o contexto cross-módulo', () => {
    for (const file of [
      'src/components/contracts/ContractDossierDrawer.tsx',
      'src/app/(main)/contratos/[id]/page.tsx',
    ]) {
      const src = read(file);
      expect(src, `${file}: sem contexto de tarefas`).toContain('tasks: { count:');
      expect(src, `${file}: sem contexto de auditoria`).toContain('auditEvents: { count:');
    }
  });

  it('Contratos não redefine a verdade do Financeiro — declara a ausência de integração', () => {
    const connected = read('src/lib/contracts/trust/connected.ts');
    expect(connected).toContain('notIntegrated: true');
    // Nenhum valor monetário é montado aqui: quem soma dinheiro é o read model.
    expect(connected).not.toContain('Intl.NumberFormat');
  });

  it('a Executive Band de Contratos não usa fonte abaixo do mínimo do design system', () => {
    const band = read('src/components/contracts/ContractExecutiveBand.tsx');
    expect(band).not.toMatch(/text-\[(?:[0-9]|10)px\]/);
  });
});

// ═══════════════════════════════════════════════════════════════════
// P2A — inteligência operacional
// ═══════════════════════════════════════════════════════════════════

describe('inteligência operacional (P2A)', () => {
  const PANELS = [
    'src/components/contracts/intelligence/ContractToCashFlow.tsx',
    'src/components/contracts/intelligence/ObligationsControlTower.tsx',
    'src/components/contracts/intelligence/RenewalHorizonPanel.tsx',
    'src/components/contracts/intelligence/ApprovalIntelligencePanel.tsx',
    'src/components/contracts/intelligence/ClauseRiskIntelligencePanel.tsx',
  ];

  it('nenhum painel preenche indicador ausente com zero', () => {
    for (const file of PANELS) {
      const suspeitos = read(file).split('\n').filter((l) => {
        const code = l.trim();
        if (code.startsWith('*') || code.startsWith('//')) return false;
        return code.includes('?? 0');
      });
      expect(suspeitos, `${file}: "?? 0" em indicador`).toEqual([]);
    }
  });

  it('nenhum painel usa fonte abaixo do mínimo do design system', () => {
    for (const file of PANELS) {
      expect(read(file), file).not.toMatch(/text-\[(?:[0-9]|10)px\]/);
    }
  });

  it('nenhum painel importa o enricher sintético', () => {
    for (const file of PANELS) {
      expect(read(file), file).not.toContain('contract-governance-data');
    }
  });

  it('as abas operacionais deixaram de ler o preview sintético', () => {
    const page = read(LIST_PAGE);
    // Renovações, obrigações e aprovações passaram a consumir a carteira
    // confiável; as três seções antigas, que liam `record.obligations` e
    // companhia do enricher, não existem mais.
    expect(page).not.toContain('function RenewalsSection');
    expect(page).not.toContain('function ObligationsSection');
    expect(page).not.toContain('function AprovacoesSection');
    expect(page).toContain('filteredTrusted');
    expect(page).toContain('buildObligationsTower(filteredTrusted)');
    expect(page).toContain('buildRenewalHorizon(filteredTrusted');
    expect(page).toContain('buildPortfolioApprovals(filteredTrusted');
  });

  it('as cláusulas fabricadas do enricher saíram da aba de riscos', () => {
    const page = read(LIST_PAGE);
    // O painel "Cláusulas monitoradas" da listagem exibia `record.clauses`, que
    // o enricher inventava — e contradizia, na mesma tela, a declaração de que
    // `contract_clauses` não é instrumentada.
    expect(page).not.toContain('record.clauses');
    expect(page).not.toContain('clause.record.code');
  });

  it('o estágio RECEBIDO não tem caminho de código que lhe atribua valor', () => {
    const src = read('src/lib/contracts/trust/contract-to-cash.ts');
    const block = src.slice(src.indexOf('const RECEIVED_STAGE'));
    const decl = block.slice(0, block.indexOf('};') + 2);
    expect(decl).toContain("missing<number>('not-integrated')");
    // Nenhuma soma, nenhum acumulador, nenhuma leitura de linha.
    expect(decl).not.toMatch(/reduce|\+=|derived\(/);
  });

  it('Contract-to-Cash não consulta fonte alguma — RECEBIDO não tem como ser lido', () => {
    const src = read('src/lib/contracts/trust/contract-to-cash.ts');
    // As tabelas do razão são CITADAS no comentário que explica a lacuna; o que
    // não pode existir é qualquer caminho de leitura.
    const code = src.split('\n').filter((l) => {
      const t = l.trim();
      return !t.startsWith('*') && !t.startsWith('/*') && !t.startsWith('//');
    }).join('\n');
    for (const forbidden of ['supabase', 'fetch(', 'await ', 'ledger_entry', 'apar_title']) {
      expect(code, `contract-to-cash tocando ${forbidden}`).not.toContain(forbidden);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════
// P2B — instrumentação operacional
// ═══════════════════════════════════════════════════════════════════

describe('instrumentação operacional (P2B)', () => {
  it('a migration 092 é estritamente aditiva', () => {
    const sql = read('supabase/migrations/092_contract_operational_instrumentation.sql');
    // Nenhuma destruição: só ADD COLUMN, CHECK e índice.
    for (const forbidden of ['DROP COLUMN', 'DROP TABLE', 'RENAME', 'DELETE FROM', 'TRUNCATE', 'ALTER COLUMN']) {
      expect(sql.toUpperCase(), `092 contém ${forbidden}`).not.toContain(forbidden);
    }
    // E nenhuma política de RLS foi tocada: a de 006 já travava contracts.edit.
    expect(sql.toUpperCase()).not.toContain('CREATE POLICY');
    expect(sql.toUpperCase()).not.toContain('DROP POLICY');
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS');
  });

  it('nenhum domínio de medição paralelo foi criado', () => {
    const sql = read('supabase/migrations/092_contract_operational_instrumentation.sql');
    expect(sql.toUpperCase()).not.toContain('CREATE TABLE');
  });

  it('toda escrita da instrumentação deixa trilha de auditoria', () => {
    const service = read('src/lib/contracts/contract-service.ts');
    for (const action of [
      'contract.milestone_created', 'contract.milestone_updated', 'contract.milestone_deleted',
      'contract.billing_created_from_milestone',
      'contract.clause_created', 'contract.clause_updated', 'contract.clause_reviewed',
      'contract.clause_deleted', 'contract.penalty_created', 'contract.clause_linked_risk',
    ]) {
      expect(service, `sem auditoria de ${action}`).toContain(action);
    }
  });

  it('o registro manual de cláusula não se apresenta como extração automática', () => {
    const service = read('src/lib/contracts/contract-service.ts');
    const fn = service.slice(service.indexOf('export function buildClauseCreatePayload'));
    const body = fn.slice(0, fn.indexOf('\n}\n') + 2);
    expect(body).toContain('ai_flagged: false');
    expect(body).toContain("review_status: 'draft'");
  });

  it('Contract-to-Cash segue sem qualquer leitura do razão financeiro', () => {
    // A instrumentação de P2B não pode ter aberto uma porta lateral para o
    // estágio RECEBIDO: ele continua sendo constante.
    const src = read('src/lib/contracts/trust/contract-to-cash.ts');
    const block = src.slice(src.indexOf('const RECEIVED_STAGE'));
    const decl = block.slice(0, block.indexOf('};') + 2);
    expect(decl).toContain("missing<number>('not-integrated')");
    expect(decl).not.toMatch(/reduce|\+=|derived\(/);
  });

  it('nenhum painel de instrumentação achata ausência em zero', () => {
    for (const file of [
      'src/components/contracts/intelligence/MeasurementPanel.tsx',
      'src/components/contracts/useContractInstrumentationModals.tsx',
    ]) {
      const suspeitos = read(file).split('\n').filter((l) => {
        const code = l.trim();
        if (code.startsWith('*') || code.startsWith('//')) return false;
        return code.includes('?? 0');
      });
      // `?? 0` só é aceitável dentro de acumulador de soma.
      expect(suspeitos.filter((l) => !l.includes('sum')), file).toEqual([]);
    }
  });

  it('o E2E não fixa contagem que a fixture pode mudar', () => {
    // O cenário 14 quebrou quando o seed passou a semear um marco medido: a
    // asserção dizia "1 registro(s)" e a tela, corretamente, passou a dizer 2.
    // A verificação tem de sair da fonte, não de um número escrito à mão.
    const spec = read('tests/contracts-module.spec.ts');
    expect(spec).not.toContain("toContainText('1 registro(s)')");
    expect(spec).toContain('${esperado} registro(s)');
  });

  it('o marco deixou de ser exibido como obrigação no dossiê', () => {
    const dossier = read('src/app/(main)/contratos/[id]/page.tsx');
    // O mapeamento comparava contra 'completed'/'overdue', que nunca
    // existiram no vocabulário de marco — o CHECK da 092 provou isso.
    expect(dossier).not.toContain("milestone.status === 'completed'");
    expect(dossier).not.toContain("milestone.status === 'overdue'");
  });
});

// ═══════════════════════════════════════════════════════════════════
// Determinismo dos testes de caracterização
// ═══════════════════════════════════════════════════════════════════

describe('o PDF de carteira não depende do calendário para ser testável', () => {
  it('o instante da timeline é injetável', () => {
    // O documento embute os rótulos dos 12 meses seguintes. Com `new Date()`
    // fixo no builder, o hash de estrutura mudava sozinho na virada do dia e o
    // teste de caracterização acusava regressão que não existia.
    const builder = read('src/lib/reports/modules/contract-report.ts');
    expect(builder).toContain('payload.now ?? new Date()');
    const spec = read('tests/unit/contract-pdf-builders.characterization.test.ts');
    expect(spec).toContain('now: FIXED_NOW');
  });
});

// ═══════════════════════════════════════════════════════════════════
// P2D — fronteira servidor/cliente da análise documental
// ═══════════════════════════════════════════════════════════════════

describe('extração de cláusulas (P2D)', () => {
  it('o extrator é server-only e nenhum componente o importa', () => {
    const extractor = read('src/lib/ai/contract-clause-extractor.ts');
    // A guarda de runtime derruba a página se o módulo for parar no browser.
    expect(extractor).toContain("typeof window !== 'undefined'");

    for (const file of [
      'src/components/contracts/intelligence/ClauseProposalsPanel.tsx',
      'src/components/contracts/intelligence/ClauseRiskIntelligencePanel.tsx',
      'src/components/contracts/useContractInstrumentationModals.tsx',
    ]) {
      expect(read(file), `${file} importa o extrator server-only`)
        .not.toContain('@/lib/ai/contract-clause-extractor');
    }
  });

  it('a chave da Anthropic nunca sai do servidor', () => {
    const service = read('src/lib/contracts/contract-service.ts');
    expect(service).not.toContain('ANTHROPIC_API_KEY');
    // O cliente chama a rota; a rota chama o modelo.
    expect(service).toContain('/api/ai/clause-extraction/');
  });

  it('a rota exige permissão e documento de origem', () => {
    const route = read('src/app/api/ai/clause-extraction/[contractId]/route.ts');
    expect(route).toContain('contracts.analyze_with_ai');
    expect(route).toContain('documentId ausente');
  });
});
