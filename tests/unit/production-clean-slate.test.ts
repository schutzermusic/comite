import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Project } from '@/lib/types';
import { migrateProjectsToV2Live } from '@/lib/services/project-migration';
import { clearTenantLocalPersistence } from '@/lib/auth/organization-switch';
import { isMockOnlyRoute } from '@/lib/demo/production-truth-routes';

const source = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

describe('production clean-slate gate', () => {
  it('keeps an empty Supabase projects table empty and never upserts defaults', () => {
    const projectsService = source('src/lib/services/projects.ts');
    const emptyBranch = projectsService.match(
      /if \(!data \|\| data\.length === 0\) \{([\s\S]*?)\n  \}/,
    )?.[1] ?? '';

    expect(emptyBranch).toContain('return [];');
    expect(emptyBranch).not.toContain('defaultProjects');
    expect(emptyBranch).not.toContain('upsertProjectsToSupabase');
  });

  it('does not apply the demo catalog or fabricated receipts in a live v2 migration', () => {
    const project: Project = {
      id: 'proj-001',
      nome: 'Projeto real com id legado',
      codigo: 'REAL-001',
      cliente: 'Cliente real',
      status: 'planejamento',
      responsavel: {
        id: 'real-user', nome: 'Pessoa real', email: 'real@example.invalid', avatarUrl: '', papelPrincipal: 'admin',
      },
      impacto_financeiro: 'baixo',
      valor_total: 1_000,
      valor_executado: 200,
      progresso_percentual: 20,
      codigoInterno: 'REAL-001',
      comiteResponsavel: '',
    };

    const [migrated] = migrateProjectsToV2Live([project]);
    expect(migrated.nome).toBe(project.nome);
    expect(migrated.valor_total).toBe(1_000);
    expect(migrated.valor_executado).toBe(200);
    expect(migrated.revenue?.received.amountCents).toBe(0);
    expect(migrated.tasks).toEqual([]);
    expect(migrated.risks).toEqual([]);
    expect(migrated.documents).toEqual([]);
  });

  it('clears operational local persistence but preserves UI preferences on organization switch', () => {
    const data = new Map<string, string>([
      ['insight_projects', '[{"id":"tenant-a"}]'],
      ['insight_projects:tenant-a', '[{"id":"tenant-a"}]'],
      ['insight-ponto-fila-v1', '[{"personId":"tenant-a"}]'],
      ['insight-theme-preference', 'dark'],
      ['sidebar_state', 'true'],
    ]);
    const localStorage = {
      get length() { return data.size; },
      key(index: number) { return [...data.keys()][index] ?? null; },
      getItem(key: string) { return data.get(key) ?? null; },
      setItem(key: string, value: string) { data.set(key, value); },
      removeItem(key: string) { data.delete(key); },
      clear() { data.clear(); },
    };
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { localStorage },
    });

    clearTenantLocalPersistence();
    expect([...data.keys()]).toEqual(['insight-theme-preference', 'sidebar_state']);
    Reflect.deleteProperty(globalThis, 'window');
  });

  it('blocks legacy mock-only modules only for production organizations', () => {
    expect(isMockOnlyRoute('/financeiro')).toBe(true);
    expect(isMockOnlyRoute('/financeiro/contratos-receita')).toBe(true);
    expect(isMockOnlyRoute('/financeiro/contas-pagar-receber')).toBe(true);
    expect(isMockOnlyRoute('/financeiro/folha-alocacao')).toBe(true);
    expect(isMockOnlyRoute('/organograma')).toBe(true);
    expect(isMockOnlyRoute('/projetos/demo-id/analytics')).toBe(true);
    expect(isMockOnlyRoute('/contratos')).toBe(false);
    expect(isMockOnlyRoute('/projetos')).toBe(false);
    expect(isMockOnlyRoute('/fiscal')).toBe(false);
    expect(isMockOnlyRoute('/workforce-cost/pessoas')).toBe(false);
  });

  it('requires payroll mock repositories to be selected explicitly', () => {
    const client = source('src/lib/payroll/closing-client.ts');
    const server = source('src/lib/payroll/repository/index.ts');
    expect(client).toContain("=== 'mock' ? 'mock' : 'supabase'");
    expect(server).toContain("=== 'mock' ? 'mock' : 'supabase'");
  });

  it('hydrates the fixed investor portfolio only for a demo organization', () => {
    const projection = source('src/app/(main)/financeiro/projecao-financeira/page.tsx');
    expect(projection).toContain('isDemoOrganization ? hydratePortfolioProjection(baseDraft) : baseDraft');
  });
});
