import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = fs.readFileSync(
  path.join(process.cwd(), 'supabase/migrations/079_investor_report_packs.sql'),
  'utf8',
);

describe('Pack do Investidor — contrato de segurança e persistência', () => {
  it('mantém packs e competências isolados por organização com RLS', () => {
    expect(migration).toContain('ALTER TABLE investor_report_packs ENABLE ROW LEVEL SECURITY');
    expect(migration).toContain('ALTER TABLE investor_report_pack_months ENABLE ROW LEVEL SECURITY');
    expect(migration).toMatch(/organization_id = current_user_organization_id\(\)/);
    expect(migration).toContain("current_user_has_permission('finance.view_executive')");
    expect(migration).toContain("current_user_has_permission('finance.edit_entry')");
    expect(migration).toContain("current_user_has_permission('finance.approve')");
    expect(migration).toContain("status IN ('published','archived') AND current_user_has_permission('finance.approve')");
  });

  it('persiste dinheiro em centavos e bloqueia mutação de versões publicadas', () => {
    expect(migration).toContain('revenue_actual_cents bigint');
    expect(migration).toContain('payroll_forecast_cents bigint');
    expect(migration).toContain('UNIQUE (pack_id, period_key)');
    expect(migration).toContain('guard_published_investor_pack');
    expect(migration).toContain('Pack publicado é imutável');
  });
});
