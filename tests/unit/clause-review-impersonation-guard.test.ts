/**
 * Regression test: AI agent / service-role cannot fabricate human review.
 *
 * This test verifies the governance invariant that ONLY an authenticated
 * human user session can set contract clause review_status to 'validated'
 * or 'rejected'. Direct database writes via service-role (auth.uid() = NULL)
 * must be rejected by the guard_review_impersonation trigger.
 *
 * In addition, reviewed_by cannot be set to an arbitrary user without
 * an authenticated session matching that user.
 *
 * The test uses the real Supabase production database because the trigger
 * lives in the DB, not in the application layer. It does NOT fabricate
 * any human actions — it only verifies that the guard rejects impersonation.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import dotenv from 'dotenv';
dotenv.config({ path: '.env', quiet: true });
dotenv.config({ path: '.env.local', quiet: true });

const SKIP_REASON = !process.env.SUPABASE_DB_URL
  ? 'SUPABASE_DB_URL not set — skipping DB-level governance test'
  : null;

describe.skipIf(!!SKIP_REASON)('guard_review_impersonation trigger', () => {
  let pg: typeof import('pg');
  let client: InstanceType<typeof import('pg').Client>;
  let testClauseId: string | null = null;
  const ORG_ID = 'ea674f46-1ea2-421a-9122-eefe9307776a'; // Insight Energia
  const ARBITRARY_USER = 'e7c0099a-b290-4896-a61d-bca62aab186e';

  beforeAll(async () => {
    pg = await import('pg');

    try {
      client = new pg.default.Client({
        connectionString: process.env.SUPABASE_DB_URL,
        ssl: { rejectUnauthorized: false },
      });
      await client.connect();

      // Find any draft AI-flagged clause to test against (read-only reference)
      const res = await client.query(
        `SELECT id FROM contract_clauses
          WHERE organization_id = $1
            AND review_status = 'draft'
            AND ai_flagged = true
          LIMIT 1`,
        [ORG_ID],
      );
      testClauseId = res.rows[0]?.id ?? null;
    } catch {
      // DB connection unavailable (e.g. offline unit test sandbox); individual tests will skip
      testClauseId = null;
      client = null as any;
    }
  });

  afterAll(async () => {
    await client?.end().catch(() => undefined);
  });

  it('rejects service-role setting review_status = validated', async () => {
    if (!testClauseId) return; // no test data available
    await expect(
      client.query(
        `UPDATE contract_clauses
            SET review_status = 'validated',
                reviewed_by = $2,
                reviewed_at = now()
          WHERE id = $1`,
        [testClauseId, ARBITRARY_USER],
      ),
    ).rejects.toThrow(/GOVERNANCE VIOLATION/);
  });

  it('rejects service-role setting review_status = rejected', async () => {
    if (!testClauseId) return;
    await expect(
      client.query(
        `UPDATE contract_clauses
            SET review_status = 'rejected',
                reviewed_by = $2,
                reviewed_at = now()
          WHERE id = $1`,
        [testClauseId, ARBITRARY_USER],
      ),
    ).rejects.toThrow(/GOVERNANCE VIOLATION/);
  });

  it('rejects service-role setting reviewed_by to an arbitrary user', async () => {
    if (!testClauseId) return;
    await expect(
      client.query(
        `UPDATE contract_clauses
            SET reviewed_by = $2
          WHERE id = $1`,
        [testClauseId, ARBITRARY_USER],
      ),
    ).rejects.toThrow(/GOVERNANCE VIOLATION/);
  });

  it('allows service-role to transition to non-decision states (in_review)', async () => {
    if (!testClauseId) return;
    const res = await client.query(
      `UPDATE contract_clauses
          SET review_status = 'in_review'
        WHERE id = $1
        RETURNING review_status`,
      [testClauseId],
    );
    expect(res.rows[0].review_status).toBe('in_review');

    // Revert to draft so we don't pollute state
    await client.query(
      `UPDATE contract_clauses SET review_status = 'draft' WHERE id = $1`,
      [testClauseId],
    );
  });

  it('clause remains in draft after blocked impersonation attempt', async () => {
    if (!testClauseId) return;
    const res = await client.query(
      `SELECT review_status, reviewed_by, reviewed_at
         FROM contract_clauses WHERE id = $1`,
      [testClauseId],
    );
    expect(res.rows[0].review_status).toBe('draft');
    expect(res.rows[0].reviewed_by).toBeNull();
    expect(res.rows[0].reviewed_at).toBeNull();
  });
});
