/** Explicit manual test: uploads one safe fixture to staging, analyzes, then removes both staging objects. */
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

const { org, user } = vi.hoisted(() => ({
  org: 'd5a4d8f6-506f-4d90-a532-a311034e0926',
  user: '8a9c771f-90f6-46ee-9e87-61036ed1ca46',
}));
vi.mock('@/lib/commercial/server-session', () => ({
  requireCommercialSession: async () => ({ organizationId: org, user: { id: user } }),
  isSessionError: () => false, hasOptionalPermission: async () => true,
}));
vi.mock('@/lib/audit/log-audit-event-server', () => ({
  logAuditEventServer: async () => ({ ok: true }),
}));

import { POST } from '@/app/api/commercial/proposals/analyze/route';
import { platformServiceClient } from '@/lib/platform/server-client';
import { ONBOARDING_STORAGE_BUCKET } from '@/lib/contracts/onboarding/upload-paths';

describe('real staging and analyze only', () => {
  it('uploads safe PT, returns HTTP 200 Review facts, and cleans staging', async () => {
    const storage = platformServiceClient().storage.from(ONBOARDING_STORAGE_BUCKET);
    const path = `${org}/proposals/_staging/${user}/${randomUUID()}-safe-pt.pdf`;
    const bytes = readFileSync(resolve(process.cwd(), 'tests/fixtures/commercial-v3/PT-2026-118 R02.pdf'));
    try {
      const uploaded = await storage.upload(path, bytes, { contentType: 'application/pdf', upsert: false });
      expect(uploaded.error).toBeNull();
      const response = await POST(new Request('http://localhost/api/commercial/proposals/analyze', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'analyze', path, fileName: 'PT-2026-118 R02.pdf', kind: 'TECHNICAL' }),
      }));
      const body = await response.json();
      expect(response.status, JSON.stringify({ code: body.code, detail: body.detail })).toBe(200);
      expect(body.facts.length).toBeGreaterThan(0);
      expect(body.facts.every((fact: { documentContext: string }) =>
        fact.documentContext === 'TECHNICAL_PROPOSAL')).toBe(true);
      const staged = await storage.download(`${path}.apex.json`);
      expect(staged.error).toBeNull();
      console.info('[live-staging-analyze]', JSON.stringify({ status: response.status,
        provider: 'openai', model: body.model, facts: body.facts.length, discarded: body.discarded }));
    } finally {
      await storage.remove([path, `${path}.apex.json`]);
    }
  }, 200_000);
});
