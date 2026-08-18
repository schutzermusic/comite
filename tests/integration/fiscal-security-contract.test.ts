import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync('supabase/migrations/090_fiscal_nfse.sql', 'utf8');
const store = readFileSync('src/lib/fiscal/server/store.ts', 'utf8');
const sandbox = readFileSync('src/lib/fiscal/provider/sandbox.ts', 'utf8');

describe('fiscal security contract', () => {
  it('keeps fiscal artifacts private and tenant-scoped', () => {
    expect(migration).toContain("'fiscal-documents', 'fiscal-documents', false");
    expect(migration).toContain('organization_id = current_user_organization_id()');
    expect(migration).toContain('protect_fiscal_document_snapshot');
  });

  it('uses service role only in server-only repository', () => {
    expect(store).toContain("typeof window !== 'undefined'");
    expect(store).toContain('SUPABASE_SERVICE_ROLE_KEY');
    expect(store).not.toContain('credentials_cipher');
  });

  it('cannot authorize production through the sandbox adapter', () => {
    expect(sandbox).toContain("context.environment === 'production'");
    expect(sandbox).toContain('PRODUCTION_CONNECTOR_REQUIRED');
  });
});

