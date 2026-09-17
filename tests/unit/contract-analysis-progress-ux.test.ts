/**
 * A espera de uma análise contratual, do ponto de vista de quem espera.
 *
 * A operacionalização passou a poder durar minutos legitimamente. O que este
 * arquivo guarda não é a aparência da tela: é o conjunto de afirmações que a
 * tela tem o direito de fazer enquanto espera, e as que ela não tem.
 *
 * A regra que organiza todas as outras: processamento indeterminado e VERDADEIRO
 * é preferível a precisão FALSA. Um "faltam 02:00" que chega a zero com o
 * trabalho ainda em curso não é uma estimativa ruim — é o momento em que o
 * usuário conclui, corretamente, que a tela mente.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  documentAnalysisStates, elapsedSince, formatElapsed,
  LONGER_THAN_USUAL_MS, STAGE_DESCRIPTION, STAGE_STEPS,
} from '@/lib/contracts/trust/clause-operations';
import {
  ANALYSIS_POLL_INTERVAL_MS, ANALYSIS_WATCH_CEILING_MS,
} from '@/components/contracts/use-contract-analysis-watch';
import { APEX_CONFIGURED_HOST_CEILING } from '@/lib/platform/jobs/budget';
import type {
  ContractAiAnalysisRow, ContractClauseRow, ContractDocumentRow,
} from '@/lib/contracts/contract-service';

const source = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf-8');

/**
 * O arquivo SEM os seus comentários.
 *
 * As proibições abaixo são sobre o que o componente FAZ, não sobre o que ele
 * explica. Documentar "esta tela nunca mostra tempo restante" é exatamente o
 * comportamento desejado; casar essa frase com a busca por "restante" puniria
 * a explicação e deixaria passar a implementação.
 */
const code = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const PROGRESS = source('src/components/contracts/intelligence/ContractAnalysisProgress.tsx');
const WATCH = source('src/components/contracts/use-contract-analysis-watch.ts');
const PANEL = source('src/components/contracts/intelligence/ClauseOpsPanel.tsx');
const DOSSIER = source('src/app/(main)/contratos/[id]/page.tsx');

const CONTRACT = 'ctr-1';

const doc = (over: Partial<ContractDocumentRow> = {}): ContractDocumentRow => ({
  id: 'doc-1', organization_id: 'org-1', contract_id: CONTRACT, title: 'Contrato.pdf',
  file_path: 'org/c/doc.pdf', document_type: 'contract', status: 'approved',
  uploaded_by: 'u', approved_at: null, approved_by: null, rejection_reason: null,
  version: 1, supersedes_document_id: null, superseded_by_document_id: null, superseded_at: null,
  created_at: '2026-09-13T00:00:00Z', updated_at: '2026-09-13T00:00:00Z',
  ...over,
} as ContractDocumentRow);

const analysis = (over: Partial<ContractAiAnalysisRow> = {}): ContractAiAnalysisRow => ({
  id: 'an-1', organization_id: 'org-1', contract_id: CONTRACT, status: 'running',
  summary: null, risk_summary: null,
  extracted_data: { kind: 'contract_operationalization' }, findings: [],
  created_by: 'u', created_at: '2026-09-13T21:37:18.428Z', completed_at: null,
  document_id: 'doc-1', started_at: '2026-09-13T21:37:18.353Z', error_message: null,
  model: 'claude-sonnet-5', extractor_version: null, superseded_by_analysis_id: null,
  ...over,
} as ContractAiAnalysisRow);

const noClauses: ContractClauseRow[] = [];
const stateOf = (rows: ContractAiAnalysisRow[]) =>
  documentAnalysisStates([doc()], rows, noClauses)[0];

// ══════════════════════════════════════════════════════════════════════════
describe('o estado de uma análise em curso vem do que está PERSISTIDO', () => {
  it('uma análise viva coloca o documento em "analyzing" e expõe a etapa real', () => {
    const state = stateOf([analysis()]);
    expect(state.lifecycle).toBe('analyzing');
    expect(state.stage).toBe('operationalization');
  });

  it('o início do cronômetro é `started_at`, e não o instante da renderização', () => {
    const state = stateOf([analysis({ started_at: '2026-09-13T21:37:18.353Z' })]);
    expect(state.startedAt).toBe('2026-09-13T21:37:18.353Z');
  });

  it('sem `started_at`, `created_at` responde — nunca o relógio do cliente', () => {
    /*
      A linha nasce antes de a execução começar; nessa janela `started_at` é
      nulo. `created_at` é a melhor verdade persistida disponível, e é sempre
      anterior ao início real — o decorrido erra para MAIS, nunca para menos.
    */
    const state = stateOf([analysis({ started_at: null, created_at: '2026-09-13T21:30:00.000Z' })]);
    expect(state.startedAt).toBe('2026-09-13T21:30:00.000Z');
  });

  it('a etapa só existe enquanto há leitura viva — estado terminal não tem etapa', () => {
    for (const status of ['completed', 'failed'] as const) {
      const state = stateOf([analysis({ status, completed_at: '2026-09-13T21:40:18.569Z' })]);
      expect(state.lifecycle).not.toBe('analyzing');
      expect(state.stage).toBeNull();
    }
  });

  it('cada etapa fala do DOMÍNIO, e nunca do transporte', () => {
    expect(STAGE_DESCRIPTION.operationalization)
      .toBe('Identificando obrigações, condições e garantias...');
    expect(STAGE_DESCRIPTION['clause-extraction']).toContain('cláusulas');
  });
});

// ══════════════════════════════════════════════════════════════════════════
describe('o tempo decorrido sobrevive a refresh, remontagem e navegação', () => {
  const STARTED = '2026-09-13T21:37:18.000Z';
  const at = (iso: string) => new Date(iso).getTime();

  it('o decorrido é medido contra o início persistido', () => {
    expect(elapsedSince(STARTED, at('2026-09-13T21:41:00.000Z'))).toBe(222_000);
    expect(formatElapsed(222_000)).toBe('03:42');
  });

  it('recarregar a página NÃO reinicia o relógio', () => {
    /*
      A prova: duas "montagens" diferentes, com o mesmo valor persistido e
      instantes de relógio diferentes, produzem decorridos que continuam
      crescendo. Nada aqui depende de quando o componente passou a existir.
    */
    const primeiraMontagem = elapsedSince(STARTED, at('2026-09-13T21:39:18.000Z'));
    const depoisDoRefresh = elapsedSince(STARTED, at('2026-09-13T21:42:18.000Z'));
    expect(primeiraMontagem).toBe(120_000);
    expect(depoisDoRefresh).toBe(300_000);
    expect(depoisDoRefresh).toBeGreaterThan(primeiraMontagem!);
    expect(formatElapsed(depoisDoRefresh!)).not.toBe('00:00');
  });

  it('relógio de cliente atrasado não produz tempo negativo', () => {
    expect(elapsedSince(STARTED, at('2026-09-13T21:36:00.000Z'))).toBe(0);
  });

  it('sem início persistido não há cronômetro — e não há "00:00" fabricado', () => {
    expect(elapsedSince(null, Date.now())).toBeNull();
    expect(elapsedSince('não é data', Date.now())).toBeNull();
  });

  it('o formato é de duração, e cresce sem teto de hora', () => {
    expect(formatElapsed(0)).toBe('00:00');
    expect(formatElapsed(59_000)).toBe('00:59');
    expect(formatElapsed(600_000)).toBe('10:00');
  });
});

// ══════════════════════════════════════════════════════════════════════════
describe('o que a tela de espera NUNCA afirma', () => {
  it('nenhuma contagem regressiva: o decorrido sobe, nada desce', () => {
    expect(PROGRESS).toContain('Tempo decorrido');
    expect(code(PROGRESS)).not.toMatch(/restante|faltam|countdown|Estimativa:/i);
    // Um regressivo precisa de um ALVO do qual subtrair. Não existe nenhum.
    expect(code(PROGRESS)).not.toMatch(/timeout|deadline|expiresAt|remainingMs/i);
  });

  it('nenhuma porcentagem e nenhuma contagem de páginas', () => {
    expect(code(PROGRESS)).not.toMatch(/%|percent|progresso\s*:|pageCount|páginas processadas/i);
    expect(code(PROGRESS)).not.toContain('<progress');
  });

  it('nenhum vocabulário de provedor, modelo ou fila chega ao usuário', () => {
    for (const proibido of [
      'CONTRACT_OPERATIONALIZATION', 'Anthropic', 'Sonnet', 'Claude',
      'LLM', 'provider', 'job_id', 'jobId', 'token',
    ]) {
      expect(code(PROGRESS)).not.toContain(proibido);
    }
    // "provedor" aparece só na justificativa de por que ele NÃO é exibido.
    expect(PROGRESS).toContain('não mostra provedor, modelo, fila');
  });

  it('nenhuma etapa que o backend não consiga provar', () => {
    // Duas etapas, ambas lastreadas: a anterior concluída e persistida, a atual
    // viva. Não há "consolidando", "revisando" nem "quase lá".
    expect(STAGE_STEPS.operationalization.done).toBe('Documento preparado');
    expect(STAGE_STEPS.operationalization.active).toBe('Inteligência contratual em processamento');
    for (const steps of Object.values(STAGE_STEPS)) {
      expect(`${steps.done} ${steps.active}`).not.toMatch(/consolidando|quase lá|finalizando/i);
    }
    // Exatamente duas por etapa: uma concluída, uma viva.
    expect(Object.keys(STAGE_STEPS.operationalization)).toEqual(['done', 'active']);
  });

  it('o limiar de "mais demorado" fica abaixo do tempo que a etapa pode durar', () => {
    /*
      Ele existe para reconhecer uma espera longa ANTES de o usuário concluir
      que a tela travou. Um limiar acima do próprio tempo limite do provedor
      nunca dispararia, e o texto tranquilizador nunca apareceria.
    */
    expect(LONGER_THAN_USUAL_MS.operationalization).toBeLessThan(450_000);
    expect(LONGER_THAN_USUAL_MS.operationalization).toBeGreaterThanOrEqual(120_000);
  });

  it('diz, em texto, que sair da página não interrompe o processamento', () => {
    expect(PROGRESS).toContain('você pode sair desta página');
    expect(PROGRESS).toContain('continua em segundo plano');
  });

  it('o estado "mais demorado que o habitual" existe, e não é uma falha', () => {
    expect(PROGRESS).toContain('mais tempo que o habitual');
    expect(PROGRESS).toContain('O Apex continua');
    // Não é erro: nada aqui muda para vocabulário de falha.
    expect(PROGRESS).not.toMatch(/text-ig-danger|Não foi possível/);
  });
});

// ══════════════════════════════════════════════════════════════════════════
describe('observar não é agir', () => {
  it('a observação só LÊ: nenhum caminho dela enfileira, repete ou cancela', () => {
    expect(code(WATCH)).not.toMatch(/fetch\(|rpc\(|POST|requestClauseExtraction|enqueue|insert\(/);
    expect(code(WATCH)).not.toMatch(/retry|retentativa|abort|cancel/i);
  });

  it('a releitura do dossiê é leitura, e a criação continua atrás de um clique', () => {
    // `reloadAnalyses` lê; quem enfileira é `runExtraction`, e só via onAnalyze.
    expect(DOSSIER).toContain('const reloadAnalyses = useCallback(');
    expect(DOSSIER).toMatch(/reloadAnalyses = useCallback\(\(\) => \{[\s\S]*?listContractAiAnalyses/);
    expect(DOSSIER).not.toMatch(/reloadAnalyses = useCallback\(\(\) => \{[\s\S]*?requestClauseExtraction/);
    /*
      A montagem NUNCA dispara extração. O clique que enfileira saiu da aba de
      Inteligência Contratual (onde era um botão "Reanalisar" por documento, no
      meio do fluxo primário) e passou a viver em "Mais ações", atrás de uma
      confirmação — a operação consome orçamento de execução e substitui a
      leitura que está na tela. A invariante é a mesma; o ponto de partida é
      um só, e agora é explícito.
    */
    expect(DOSSIER).toMatch(/if \(documentId\) void runExtraction\(documentId\);/);
    expect(DOSSIER).not.toMatch(/useEffect\(\(\) => \{\s*(void )?runExtraction/);
    // E o clique passa por um portão que diz o que vai acontecer, antes.
    expect(DOSSIER).toContain('setReanalysisTarget(');
    expect(DOSSIER).toContain('<AlertDialogAction');
  });

  it('a observação termina no estado terminal, e não por contagem de tentativas', () => {
    /*
      `active` é derivado do estado PERSISTIDO: há linha `running`, ou não há.
      Concluir e falhar encerram a observação pelo mesmo caminho — é isso que
      impede uma falha de virar giro eterno.
    */
    expect(DOSSIER).toContain("analyses.find((row) => row.status === 'running')");
    expect(DOSSIER).toContain('active: liveAnalysis !== null');
    expect(WATCH).toContain('if (!active) return;');
    expect(WATCH).toContain('return () => clearInterval(id);');
  });

  it('a observação é LIMITADA, e o teto cobre o tempo de vida da função', () => {
    expect(ANALYSIS_POLL_INTERVAL_MS).toBeGreaterThanOrEqual(5_000);
    expect(ANALYSIS_WATCH_CEILING_MS).toBeGreaterThan(APEX_CONFIGURED_HOST_CEILING * 1000);
    expect(ANALYSIS_WATCH_CEILING_MS).toBeLessThanOrEqual(900_000);
  });

  it('nenhuma retentativa automática nasce da tela', () => {
    for (const file of [PROGRESS, WATCH]) {
      expect(code(file)).not.toMatch(/requestClauseExtraction|runExtraction/);
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════
describe('o giro para quando o backend para', () => {
  it('o painel de espera aparece SÓ em "analyzing"', () => {
    expect(PANEL).toContain("{state.lifecycle === 'analyzing' && (");
    expect(PANEL).toContain('<ContractAnalysisProgress');
  });

  it('sucesso encerra a espera', () => {
    const state = stateOf([analysis({
      status: 'completed', completed_at: '2026-09-13T21:44:00.000Z',
    })]);
    expect(state.lifecycle).not.toBe('analyzing');
  });

  it('falha encerra a espera e vira mensagem de negócio, não giro', () => {
    const state = stateOf([analysis({
      status: 'failed', completed_at: '2026-09-13T21:44:48.000Z',
      error_message: 'A operacionalização falhou: O provedor de IA excedeu o tempo limite.',
    })]);
    expect(state.lifecycle).toBe('failed');
    expect(state.stage).toBeNull();
    // A tela recebe a versão de negócio; o texto cru fica no diagnóstico.
    expect(state.errorMessage).not.toBeNull();
    expect(state.errorMessage).not.toContain('provedor');
    expect(state.errorDiagnostic).toContain('provedor');
  });

  it('o painel renderiza a mensagem de negócio, e NUNCA o diagnóstico cru', () => {
    expect(PANEL).toContain('{state.errorMessage}');
    expect(PANEL).not.toContain('{state.errorDiagnostic}');
  });
});
