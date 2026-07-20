import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config({ path: '.env' });
dotenv.config({ path: '.env.local' });

const enabled = process.env.RUN_DB_INTEGRATION === '1' && Boolean(process.env.SUPABASE_DB_URL);
const suite = enabled ? describe : describe.skip;

suite('allowance municipality database integration', () => {
  let client: pg.Client;
  beforeAll(async () => {
    client = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
    await client.connect();
  });
  afterAll(async () => { await client?.end(); });

  it('has the new tables, RLS, and private report bucket', async () => {
    const tables = await client.query(`select tablename as table_name, rowsecurity as row_security from pg_tables
      where schemaname='public' and tablename in
      ('person_residence_municipalities','allowance_eligibility_overrides','allowance_report_exports')`);
    expect(tables.rows).toHaveLength(3);
    expect(tables.rows.every((row) => row.row_security)).toBe(true);
    const bucket = await client.query(`select public from storage.buckets where id='allowance-reports'`);
    expect(bucket.rows[0]?.public).toBe(false);
  });

  it('has tenant and permission policies for sensitive data', async () => {
    const policies = await client.query(`select tablename, policyname from pg_policies
      where schemaname='public' and tablename in
      ('person_residence_municipalities','allowance_eligibility_overrides','allowance_report_exports')`);
    expect(policies.rows.some((row) => row.policyname === 'person_residence_municipalities_select')).toBe(true);
    expect(policies.rows.some((row) => row.policyname === 'allowance_report_exports_select')).toBe(true);
  });
});
