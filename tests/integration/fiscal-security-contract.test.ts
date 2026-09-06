import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const foundation = readFileSync('supabase/migrations/112_fiscal_nfse_foundation.sql', 'utf8');
const perms = readFileSync('supabase/migrations/113_fiscal_perm_seeds.sql', 'utf8');
const store = readFileSync('src/lib/fiscal/server/store.ts', 'utf8');
const sandbox = readFileSync('src/lib/fiscal/provider/sandbox.ts', 'utf8');
const providerConfigRoute = readFileSync('src/app/api/fiscal/provider-config/route.ts', 'utf8');
const truncateHardening = readFileSync('supabase/migrations/118_platform_truncate_privilege_hardening.sql', 'utf8');
const engine = readFileSync('src/lib/fiscal/server/engine.ts', 'utf8');

describe('fiscal storage and tenancy contract', () => {
  it('keeps fiscal artifacts in a private bucket with no browser policy', () => {
    expect(foundation).toContain("'fiscal-documents','fiscal-documents', false");
    expect(foundation).toContain('SET public = false');
    // Uma política de storage voltada ao navegador entregaria XML de NFS-e sem
    // passar pela rota que confere organização e permissão.
    expect(foundation).not.toMatch(/CREATE POLICY[^;]*ON storage\.objects/);
  });

  it('scopes every tenant table by organization and denies browser writes', () => {
    expect(foundation).toContain('organization_id = public.current_user_organization_id()');
    expect(foundation).toContain('REVOKE INSERT, UPDATE, DELETE ON public.%I FROM authenticated, anon');
  });

  it('TRUNCATE das tabelas fiscais é coberto pelo endurecimento de plataforma', () => {
    /*
      A 112 revoga INSERT/UPDATE/DELETE e NÃO revoga TRUNCATE — o que deixava as
      onze tabelas fiscais herdando TRUNCATE do DEFAULT ACL do schema. A correção
      não foi editar a 112 (migration aplicada é registro, não rascunho): foi a
      118, que revoga em TODA tabela de `public` e corrige o default para que
      nenhuma tabela futura o herde. `platform-truncate-privilege.test.ts` prova
      o efeito contra o banco; aqui fica registrado que a cobertura existe e de
      onde ela vem.
    */
    expect(truncateHardening).toContain('REVOKE TRUNCATE ON ALL TABLES IN SCHEMA public FROM anon, authenticated');
    expect(truncateHardening).toContain('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE TRUNCATE ON TABLES FROM anon, authenticated');
    // E não pode ter encostado no DML que a RLS governa.
    expect(truncateHardening).not.toMatch(/REVOKE\s+(SELECT|INSERT|UPDATE|DELETE)\b/);
    expect(truncateHardening).not.toMatch(/FROM\s+service_role|FROM\s+postgres\b/);
  });

  it('never exposes the credentials table to the browser at all', () => {
    expect(foundation).toContain('REVOKE ALL ON public.fiscal_provider_configs FROM authenticated, anon');
    expect(foundation).not.toMatch(/GRANT[^;]*fiscal_provider_configs[^;]*authenticated/);
  });
});

describe('canonical ownership', () => {
  it('uses the canonical Party as the recipient, not a rival fiscal registry', () => {
    expect(foundation).toContain('REFERENCES public.parties (organization_id, id)');
    expect(foundation).not.toMatch(/CREATE TABLE public\.fiscal_parties\b/);
    // A extensão fiscal não pode carregar identidade jurídica.
    const profileBlock = foundation.slice(
      foundation.indexOf('CREATE TABLE public.fiscal_party_profiles'),
      foundation.indexOf('CREATE TABLE public.fiscal_service_catalog'),
    );
    expect(profileBlock).not.toContain('legal_name');
    expect(profileBlock).not.toContain('document_number');
  });

  it('uses the canonical cost center, never the legacy one', () => {
    expect(foundation).toContain('REFERENCES public.finance_cost_centers (organization_id, id)');
    expect(foundation).not.toContain('REFERENCES public.cost_center');
  });

  it('does not make Fiscal a shadow ledger', () => {
    expect(foundation).not.toContain('REFERENCES public.ledger_entry');
    expect(foundation).not.toContain('REFERENCES public.apar_title');
    expect(foundation).not.toMatch(/CREATE TABLE public\.tax_obligation\b/);
    // O motor não escreve no Financeiro: a Fase 7 é que fará isso.
    expect(engine).not.toContain("from('ledger_entry')");
    expect(engine).not.toContain("from('apar_title')");
  });
});

describe('production is structurally blocked', () => {
  it('gates production behind recorded, complete conditions', () => {
    expect(foundation).toContain('CREATE TABLE public.fiscal_production_gates');
    expect(foundation).toContain('fiscal_guard_production');
    expect(foundation).toContain('production_enabled      boolean NOT NULL DEFAULT false');
    for (const gate of ['certificate_installed', 'municipal_registration_active', 'provider_contract_signed',
      'homologation_pilot_approved', 'accountant_signoff', 'legal_signoff']) {
      expect(foundation).toContain(gate);
    }
  });

  it('refuses the sandbox adapter in production at the database level', () => {
    expect(foundation).toContain('fiscal_provider_configs_no_sandbox_prod');
    expect(sandbox).toContain("context.environment === 'production'");
    expect(sandbox).toContain('PRODUCTION_CONNECTOR_REQUIRED');
  });

  it('refuses the sandbox adapter in production at the API level too', () => {
    expect(providerConfigRoute).toContain('não pode ser habilitado em produção');
  });
});

describe('secret handling', () => {
  it('uses the service role only inside a server-only repository', () => {
    expect(store).toContain("typeof window !== 'undefined'");
    expect(store).toContain('SUPABASE_SERVICE_ROLE_KEY');
  });

  it('never projects a cipher column back to a caller', () => {
    for (const source of [store, providerConfigRoute]) {
      const projections = source.match(/\.select\('[^']*'\)/g) ?? [];
      for (const projection of projections) {
        expect(projection).not.toContain('_cipher');
      }
    }
  });

  it('scrubs credentials out of persisted error messages', () => {
    expect(engine).toContain('[REDACTED]');
    expect(engine).toContain('CHAVE REMOVIDA');
  });
});

describe('legacy migration 090', () => {
  it('is fenced where no migration tool can reach it', () => {
    expect(existsSync('supabase/migrations/090_fiscal_nfse.sql')).toBe(false);
    expect(existsSync('supabase/migrations-superseded/090_fiscal_nfse.sql.superseded')).toBe(true);
    // Nenhum arquivo `.sql` no diretório arquivado: a extensão é o que impede
    // que uma ferramenta guiada por glob o execute.
    expect(readdirSync('supabase/migrations-superseded').filter((f) => f.endsWith('.sql'))).toEqual([]);
  });

  it('left no gap that a tool would try to fill', () => {
    const versions = readdirSync('supabase/migrations').filter((f) => f.endsWith('.sql')).map((f) => f.slice(0, 3)).sort();
    expect(versions).not.toContain('090');
    // A fundação fiscal ocupa 112 e 113; a ponta cresce com as fases seguintes,
    // e prendê-la a um número faria toda fase nova quebrar este teste.
    expect(versions).toEqual(expect.arrayContaining(['112', '113']));
    expect(Number(versions.at(-1))).toBeGreaterThanOrEqual(113);
    expect(new Set(versions).size).toBe(versions.length);
  });
});

describe('permission seeds', () => {
  it('seeds every permission the fiscal routes already require', () => {
    for (const key of ['fiscal.view', 'fiscal.create', 'fiscal.approve', 'fiscal.transmit',
      'fiscal.cancel', 'fiscal.export', 'fiscal.configure']) {
      expect(perms).toContain(`'${key}'`);
    }
  });
});
