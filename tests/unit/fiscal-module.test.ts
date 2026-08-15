import { describe, expect, it } from 'vitest';
import { createFiscalDocumentSchema, isValidCnpj } from '@/lib/fiscal/schemas';
import { assertFiscalTransition, canTransitionFiscalDocument, isFiscalDocumentImmutable } from '@/lib/fiscal/state-machine';
import { calculateTaxPreview } from '@/lib/fiscal/tax-preview';
import { SandboxFiscalProvider } from '@/lib/fiscal/provider/sandbox';
import type { FiscalProviderDocument } from '@/lib/fiscal/provider';

describe('fiscal state machine', () => {
  it('accepts the controlled approval and authorization path', () => {
    expect(canTransitionFiscalDocument('draft', 'pending_approval')).toBe(true);
    expect(canTransitionFiscalDocument('pending_approval', 'approved')).toBe(true);
    expect(canTransitionFiscalDocument('approved', 'queued')).toBe(true);
    expect(canTransitionFiscalDocument('processing', 'authorized')).toBe(true);
    expect(isFiscalDocumentImmutable('authorized')).toBe(true);
  });

  it('blocks direct draft authorization and edits after authorization', () => {
    expect(canTransitionFiscalDocument('draft', 'authorized')).toBe(false);
    expect(() => assertFiscalTransition('authorized', 'draft')).toThrow(/Transição fiscal inválida/);
    expect(isFiscalDocumentImmutable('draft')).toBe(false);
  });
});

describe('fiscal tax preview', () => {
  const service = {
    iss_rate: 5,
    pis_rate: 0.65,
    cofins_rate: 3,
    inss_rate: 0,
    ir_rate: 1.5,
    csll_rate: 1,
    ibs_rate: 0,
    cbs_rate: 0,
    iss_withheld_default: true,
  };

  it('keeps issuer taxes separate from recipient withholdings', () => {
    const preview = calculateTaxPreview({ amountCents: 100_000, service });
    expect(preview.taxBaseCents).toBe(100_000);
    expect(preview.withheldTotalCents).toBe(11_150);
    expect(preview.issuerTaxTotalCents).toBe(0);
    expect(preview.netAmountCents).toBe(88_850);
    expect(preview.lines.every((line) => line.responsibility === 'recipient')).toBe(true);
  });

  it('does not reduce net receivable by issuer-responsibility ISS', () => {
    const preview = calculateTaxPreview({ amountCents: 100_000, service: { ...service, pis_rate: 0, cofins_rate: 0, ir_rate: 0, csll_rate: 0 }, issWithheld: false });
    expect(preview.withheldTotalCents).toBe(0);
    expect(preview.issuerTaxTotalCents).toBe(5_000);
    expect(preview.netAmountCents).toBe(100_000);
  });
});

describe('fiscal validation', () => {
  it('validates CNPJ check digits', () => {
    expect(isValidCnpj('11.222.333/0001-81')).toBe(true);
    expect(isValidCnpj('11.111.111/1111-11')).toBe(false);
  });

  it('rejects deductions that consume the service amount', () => {
    const result = createFiscalDocumentSchema.safeParse({
      establishmentId: '11111111-1111-4111-8111-111111111111',
      partyId: '22222222-2222-4222-8222-222222222222',
      serviceCatalogId: '33333333-3333-4333-8333-333333333333',
      competenceDate: '2026-08-14',
      serviceLocationIbge: '3550308',
      description: 'Serviço técnico mensal',
      amountCents: 10_000,
      deductionsCents: 10_000,
      idempotencyKey: 'invoice-unique-001',
    });
    expect(result.success).toBe(false);
  });
});

describe('sandbox provider', () => {
  const document = {
    id: '11111111-1111-4111-8111-111111111111',
    organization_id: '22222222-2222-4222-8222-222222222222',
    establishment_id: '33333333-3333-4333-8333-333333333333',
    status: 'processing',
    description: 'Consultoria de engenharia',
    service_amount_cents: 100_000,
    issuer_snapshot: { legal_name: 'Insight Engenharia' },
    recipient_snapshot: { legal_name: 'Cliente Teste' },
    idempotency_key: 'sandbox-test-001',
    created_at: '2026-08-14T00:00:00Z',
  } as unknown as FiscalProviderDocument;

  it('authorizes deterministically in homologation and produces XML', async () => {
    const provider = new SandboxFiscalProvider();
    const context = { organizationId: document.organization_id, establishmentId: document.establishment_id, environment: 'homologation' as const, requestId: 'request-1' };
    const first = await provider.issue(document, context);
    const second = await provider.issue(document, context);
    expect(first.status).toBe('authorized');
    expect(first.accessKey).toBe(second.accessKey);
    expect(first.artifacts?.xml).toContain('<NFSe');
  });

  it('fails closed in production', async () => {
    const provider = new SandboxFiscalProvider();
    const result = await provider.issue(document, { organizationId: document.organization_id, establishmentId: document.establishment_id, environment: 'production', requestId: 'request-2' });
    expect(result.status).toBe('error');
    expect(result.rejectionCode).toBe('PRODUCTION_CONNECTOR_REQUIRED');
  });
});
