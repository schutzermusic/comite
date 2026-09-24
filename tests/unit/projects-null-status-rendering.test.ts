/**
 * O projeto REAL que derrubou a carteira inteira.
 *
 * `status === undefined` chegou ao `formatStatus` do ProjectCard, que chamava
 * `.replace()` sem perguntar. O TypeError não derrubou um cartão: derrubou
 * /projetos por completo, levando junto todos os projetos que estavam bem.
 *
 * O que estes testes fixam não é "não quebrar". É a regra de produto que
 * impede a correção fácil e errada: **ausência de fase permanece ausência**.
 * Nenhum caminho aqui pode escolher `planejamento` — nem para satisfazer o
 * TypeScript, nem para deixar a pílula bonita.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

import {
  PROJECT_STATUS_LABELS,
  PROJECT_STATUS_MISSING_LABEL,
  PROJECT_STATUS_NEUTRAL_ACCENT,
  PROJECT_STATUS_VALUES,
  formatProjectStatus,
  hasProjectStatus,
  isProjectInStatus,
  isProjectStatus,
  projectStatusAccent,
  projectStatusVariant,
} from '@/lib/projects/status';
import type { Project } from '@/lib/types';

const source = (path: string) => readFileSync(path, 'utf8');

/** Um projeto como o acervo real o entrega: sem ciclo operacional configurado. */
const projectWithoutStatus = (over: Partial<Project> = {}): Project => ({
  id: 'prj-2774',
  nome: 'Projeto vindo do onboarding de contrato',
  codigo: '2774.08/2025',
  responsavel: { id: 'u-1', nome: '—', email: '', avatarUrl: '', papelPrincipal: 'visualizador' },
  impacto_financeiro: 'baixo',
  valor_total: 0,
  valor_executado: 0,
  progresso_percentual: 0,
  codigoInterno: '2774.08/2025',
  comiteResponsavel: '',
  ...over,
} as Project);

// ═══════════════════════════════════════════════════════════════════════════
// 1 · O formatador nunca lança
// ═══════════════════════════════════════════════════════════════════════════

describe('formatProjectStatus — total, para qualquer entrada', () => {
  it('ausência vira "Status não informado"', () => {
    expect(formatProjectStatus(undefined)).toBe('Status não informado');
    expect(formatProjectStatus(null)).toBe('Status não informado');
    expect(formatProjectStatus('')).toBe('Status não informado');
    expect(formatProjectStatus('   ')).toBe('Status não informado');
    expect(PROJECT_STATUS_MISSING_LABEL).toBe('Status não informado');
  });

  it('as cinco fases canônicas têm rótulo PT-BR', () => {
    expect(formatProjectStatus('planejamento')).toBe('Planejamento');
    expect(formatProjectStatus('em_andamento')).toBe('Em andamento');
    expect(formatProjectStatus('pausado')).toBe('Pausado');
    expect(formatProjectStatus('concluido')).toBe('Concluído');
    expect(formatProjectStatus('cancelado')).toBe('Cancelado');
    expect(Object.keys(PROJECT_STATUS_LABELS).sort())
      .toEqual([...PROJECT_STATUS_VALUES].sort());
  });

  it('valor futuro desconhecido é exibido, não apagado nem inventado', () => {
    // Ele EXISTE: dizer "Status não informado" sobre um projeto que declarou
    // uma fase seria a mesma mentira que inventar a fase.
    expect(formatProjectStatus('aguardando_assinatura')).toBe('Aguardando Assinatura');
    expect(formatProjectStatus('foo')).toBe('Foo');
  });

  it('não lança para nenhum tipo, inclusive os que nunca deveriam chegar', () => {
    for (const value of [undefined, null, '', 0, 1, NaN, true, false, {}, [], Symbol('s')]) {
      expect(() => formatProjectStatus(value)).not.toThrow();
      expect(typeof formatProjectStatus(value)).toBe('string');
    }
  });

  it('não fabrica fase nenhuma a partir da ausência', () => {
    for (const absent of [undefined, null, '']) {
      const label = formatProjectStatus(absent);
      for (const phase of Object.values(PROJECT_STATUS_LABELS)) {
        expect(label, `${String(absent)} virou ${phase}`).not.toBe(phase);
      }
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2 · Tom e cor: ausente é neutro
// ═══════════════════════════════════════════════════════════════════════════

describe('apresentação neutra para status ausente', () => {
  it('a pílula é neutra, nunca "ativo" nem "concluído"', () => {
    for (const absent of [undefined, null, '']) {
      expect(projectStatusVariant(absent)).toBe('neutral');
    }
    expect(projectStatusVariant('em_andamento')).toBe('active');
    expect(projectStatusVariant('concluido')).toBe('completed');
    expect(projectStatusVariant('pausado')).toBe('warning');
    expect(projectStatusVariant('cancelado')).toBe('error');
    expect(projectStatusVariant('planejamento')).toBe('neutral');
  });

  it('valor desconhecido também é neutro', () => {
    expect(projectStatusVariant('fase_nova')).toBe('neutral');
  });

  it('o accent ausente é o neutro que já existia, não uma cor nova', () => {
    for (const absent of [undefined, null, '']) {
      expect(projectStatusAccent(absent)).toBe(PROJECT_STATUS_NEUTRAL_ACCENT);
    }
    // Mesmo cinza de `planejamento`: nenhuma cor foi inventada para a ausência.
    expect(PROJECT_STATUS_NEUTRAL_ACCENT).toBe('#94A3B8');
    expect(projectStatusAccent('planejamento')).toBe(PROJECT_STATUS_NEUTRAL_ACCENT);
    expect(projectStatusAccent('em_andamento')).toBe('#10B981');
  });

  it('variant e accent também não lançam para entrada arbitrária', () => {
    for (const value of [undefined, null, '', 0, {}, [], true]) {
      expect(() => projectStatusVariant(value)).not.toThrow();
      expect(() => projectStatusAccent(value)).not.toThrow();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3 · Guardas de tipo
// ═══════════════════════════════════════════════════════════════════════════

describe('guardas', () => {
  it('isProjectStatus só aceita as fases canônicas', () => {
    for (const v of PROJECT_STATUS_VALUES) expect(isProjectStatus(v)).toBe(true);
    for (const v of [undefined, null, '', 'planejando', 42, {}]) {
      expect(isProjectStatus(v)).toBe(false);
    }
  });

  it('hasProjectStatus trata string vazia como ausência', () => {
    expect(hasProjectStatus('em_andamento')).toBe(true);
    expect(hasProjectStatus('qualquer_coisa')).toBe(true);
    expect(hasProjectStatus('')).toBe(false);
    expect(hasProjectStatus('  ')).toBe(false);
    expect(hasProjectStatus(null)).toBe(false);
    expect(hasProjectStatus(undefined)).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4 · O cartão que quebrou
// ═══════════════════════════════════════════════════════════════════════════

describe('ProjectCard — os três acessos que crasharam', () => {
  const card = source('src/components/portfolio/ProjectCard.tsx');

  it('não existe mais chamada de método de string sobre o status', () => {
    expect(card).not.toContain('function formatStatus');
    expect(card).not.toMatch(/status\.(replace|toLowerCase|toUpperCase|trim|split|charAt)/);
  });

  it('rótulo, pílula e accent passam todos pelo helper seguro', () => {
    expect(card).toContain("from '@/lib/projects/status'");
    expect(card).toContain('projectStatusAccent(project.status)');
    expect(card).toContain('projectStatusVariant(project.status)');
    expect(card).toContain('formatProjectStatus(project.status)');
  });

  it('as tabelas indexadas por status sumiram — eram a fonte do `undefined`', () => {
    expect(card).not.toContain('STATUS_VARIANT[');
    expect(card).not.toContain('ACCENT[project.status]');
  });

  it('as três funções que o cartão chama são totais sobre um projeto sem fase', () => {
    const project = projectWithoutStatus();
    expect(project.status).toBeUndefined();
    expect(formatProjectStatus(project.status)).toBe('Status não informado');
    expect(projectStatusVariant(project.status)).toBe('neutral');
    expect(projectStatusAccent(project.status)).toBe(PROJECT_STATUS_NEUTRAL_ACCENT);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5 · As demais superfícies de Projetos
// ═══════════════════════════════════════════════════════════════════════════

describe('tabela, gaveta, resumo, detalhe e PDF', () => {
  const files = {
    'ProjectTable': 'src/components/portfolio/ProjectTable.tsx',
    'ProjectDetailDrawer': 'src/components/portfolio/ProjectDetailDrawer.tsx',
    'ProjectSummaryCard': 'src/components/portfolio/ProjectSummaryCard.tsx',
    'ProjectPdfExportTemplate': 'src/components/portfolio/ProjectPdfExportTemplate.ts',
  };

  it('nenhuma delas mantém um formatStatus próprio e inseguro', () => {
    for (const [name, path] of Object.entries(files)) {
      const text = source(path);
      expect(text, name).not.toContain('function formatStatus');
      expect(text, name).not.toMatch(/status\.(replace|toLowerCase|toUpperCase|trim|split|charAt)/);
      expect(text, name).toContain("from '@/lib/projects/status'");
    }
  });

  it('não há mais nenhuma cópia de formatStatus no repositório', () => {
    // Eram QUATRO implementações idênticas e todas quebradas do mesmo jeito.
    for (const path of Object.values(files)) {
      expect(source(path)).not.toContain('function formatStatus');
    }
    expect(source('src/components/portfolio/ProjectCard.tsx')).not.toContain('function formatStatus');
  });

  it('a página do projeto — onde o dossiê do contrato aterrissa — é segura', () => {
    const page = source('src/app/(main)/projetos/[id]/page.tsx');
    expect(page).not.toMatch(/status\.replace/);
    expect(page).toContain('isProjectStatus(status)');
    // O fallback de cor deixou de ser `planejamento`: ausente é neutro.
    expect(page).not.toContain('return colors[status] || colors.planejamento;');
    expect(page).toMatch(/isProjectStatus\(status\) \? STATUS_TONE\[status\] : 'neutral'/);
  });

  it('o PDF imprime o rótulo honesto e não a string "undefined"', () => {
    const pdf = source('src/components/portfolio/ProjectPdfExportTemplate.ts');
    expect(pdf).toContain('formatProjectStatus(p.status)');
    expect(pdf).not.toContain('STATUS_LABEL[p.status] || p.status');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 6 · Filtros e KPIs
// ═══════════════════════════════════════════════════════════════════════════

describe('filtros e contadores com um projeto sem fase', () => {
  /* A mesma lógica da carteira, exercida sobre a lista real. */
  const portfolio: Project[] = [
    projectWithoutStatus({ id: 'sem-status' }),
    projectWithoutStatus({ id: 'andamento', status: 'em_andamento' }),
    projectWithoutStatus({ id: 'concluido', status: 'concluido' }),
  ];

  const applyStatusFilter = (list: Project[], statusFilter: string) =>
    list.filter((p) => statusFilter === 'all' || p.status === statusFilter);

  it('permanece VISÍVEL em "todos"', () => {
    const visible = applyStatusFilter(portfolio, 'all');
    expect(visible).toHaveLength(3);
    expect(visible.map((p) => p.id)).toContain('sem-status');
  });

  it('não entra em nenhum bucket de fase', () => {
    for (const status of PROJECT_STATUS_VALUES) {
      const bucket = applyStatusFilter(portfolio, status).map((p) => p.id);
      expect(bucket, status).not.toContain('sem-status');
    }
  });

  it('não conta como "Em andamento" nem como "Concluído"', () => {
    const inProgress = portfolio.filter((p) => p.status === 'em_andamento');
    const completed = portfolio.filter((p) => p.status === 'concluido');
    expect(inProgress.map((p) => p.id)).toEqual(['andamento']);
    expect(completed.map((p) => p.id)).toEqual(['concluido']);
  });

  it('isProjectInStatus responde falso sem confundir ausência com fase', () => {
    for (const status of PROJECT_STATUS_VALUES) {
      expect(isProjectInStatus(undefined, status)).toBe(false);
      expect(isProjectInStatus(null, status)).toBe(false);
      expect(isProjectInStatus('', status)).toBe(false);
    }
    expect(isProjectInStatus('em_andamento', 'em_andamento')).toBe(true);
    expect(isProjectInStatus('em_andamento', 'concluido')).toBe(false);
  });

  it('os KPIs não lançam sobre uma carteira com status ausente', () => {
    expect(() => {
      const total = portfolio.length;
      const inProgress = portfolio.filter((p) => p.status === 'em_andamento').length;
      const completed = portfolio.filter((p) => p.status === 'concluido').length;
      const totalValue = portfolio.reduce((s, p) => s + (p.valor_total || 0), 0);
      return { total, inProgress, completed, totalValue };
    }).not.toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 7 · A fronteira que este patch não cruza
// ═══════════════════════════════════════════════════════════════════════════

describe('nada de verdade operacional inventada', () => {
  it('normalizeProject continua sem atribuir status', () => {
    const service = source('src/lib/services/projects.ts');
    const start = service.indexOf('function normalizeProject');
    const body = service.slice(start, service.indexOf('\n}', start));
    expect(body).not.toMatch(/project\.status\s*=/);
    expect(body).not.toContain("'planejamento'");
    expect(body).not.toContain("'em_andamento'");
  });

  it('o helper não grava nem normaliza — só apresenta', () => {
    const helper = source('src/lib/projects/status.ts');
    expect(helper).not.toMatch(/\.insert\(|\.update\(|\.upsert\(|INSERT INTO/);
    // Nenhum caminho devolve uma fase canônica para entrada ausente.
    for (const absent of [undefined, null, '']) {
      expect(isProjectStatus(formatProjectStatus(absent))).toBe(false);
    }
  });

  it('o tipo Project declara a ausência em vez de escondê-la', () => {
    const types = source('src/lib/types.ts');
    expect(types).toContain('status?: ProjectStatus | null;');
    // Sem enum falso só para calar o compilador.
    expect(types).not.toContain("'nao_configurado'");
    expect(types).not.toContain("'unknown'");
  });

  it('nenhuma migration foi criada', () => {
    const { readdirSync, readFileSync: read } = require('node:fs') as typeof import('node:fs');
    /*
      A intenção aqui é "ESTA fase não criou migration", e fixar a PONTA global
      só exprimia isso enquanto esta fase fosse a mais nova — qualquer migration
      posterior, de qualquer outro assunto, quebrava um teste que não fala sobre
      ela. O que se afirma agora é o que de fato importa: nenhuma migration
      acima da 167 toca as tabelas desta fase.
    */
    const later = readdirSync('supabase/migrations')
      .filter((f) => /^\d{3}_.*\.sql$/.test(f) && Number(f.slice(0, 3)) > 167);
    for (const file of later) {
      const sql = read(`supabase/migrations/${file}`, 'utf8');
      expect(sql).not.toMatch(/ALTER TABLE\s+(public\.)?projects\b/i);
      expect(sql).not.toContain('project_status');
    }
  });
});
