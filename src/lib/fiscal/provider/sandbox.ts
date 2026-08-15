import { createHash, timingSafeEqual } from 'node:crypto';
import type { FiscalProvider, FiscalProviderContext, FiscalProviderDocument, FiscalProviderResult } from './types';

function numericHash(value: string, size: number): string {
  const hex = createHash('sha256').update(value).digest('hex');
  return Array.from(hex).map((char) => String(parseInt(char, 16) % 10)).join('').slice(0, size);
}

function xmlEscape(value: string): string {
  return value.replace(/[<>&'\"]/g, (char) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[char] ?? char);
}

function sandboxXml(document: FiscalProviderDocument, accessKey: string, number: string): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<NFSe xmlns="http://www.sped.fazenda.gov.br/nfse">',
    `<infNFSe Id="NFS${accessKey}">`,
    `<nNFSe>${number}</nNFSe>`,
    `<dhProc>${new Date().toISOString()}</dhProc>`,
    `<emit>${xmlEscape(String(document.issuer_snapshot.legal_name ?? 'Emitente homologação'))}</emit>`,
    `<toma>${xmlEscape(String(document.recipient_snapshot.legal_name ?? 'Tomador homologação'))}</toma>`,
    `<xServ>${xmlEscape(document.description)}</xServ>`,
    `<vServ>${(document.service_amount_cents / 100).toFixed(2)}</vServ>`,
    '</infNFSe>',
    '</NFSe>',
  ].join('');
}

/**
 * Deterministic homologation adapter. It never calls or impersonates a tax
 * authority and is deliberately forbidden in production.
 */
export class SandboxFiscalProvider implements FiscalProvider {
  readonly key = 'sandbox';

  async issue(document: FiscalProviderDocument, context: FiscalProviderContext): Promise<FiscalProviderResult> {
    if (context.environment === 'production') {
      return {
        status: 'error',
        rejectionCode: 'PRODUCTION_CONNECTOR_REQUIRED',
        rejectionMessage: 'O adaptador sandbox não pode transmitir em produção.',
      };
    }

    if (document.description.toUpperCase().includes('[REJEITAR]')) {
      return {
        status: 'rejected',
        rejectionCode: 'HOM-001',
        rejectionMessage: 'Rejeição controlada de homologação solicitada na descrição.',
        safePayload: { environment: 'homologation', simulated: true },
      };
    }

    const seed = `${document.organization_id}:${document.id}:${document.idempotency_key ?? document.created_at}`;
    const accessKey = numericHash(seed, 50);
    const documentNumber = numericHash(`${seed}:number`, 9).replace(/^0+/, '') || '1';
    const verificationCode = createHash('sha256').update(`${seed}:verify`).digest('hex').slice(0, 8).toUpperCase();
    const authorizedAt = new Date().toISOString();

    return {
      status: 'authorized',
      providerDocumentId: `sandbox-${document.id}`,
      accessKey,
      documentNumber,
      verificationCode,
      authorizedAt,
      safePayload: { environment: 'homologation', simulated: true, requestId: context.requestId },
      artifacts: { xml: sandboxXml(document, accessKey, documentNumber) },
    };
  }

  async consult(document: FiscalProviderDocument, _context: FiscalProviderContext): Promise<FiscalProviderResult> {
    return {
      status: document.status === 'cancelled' ? 'cancelled' : document.status === 'authorized' ? 'authorized' : 'processing',
      providerDocumentId: document.provider_document_id ?? undefined,
      accessKey: document.access_key ?? undefined,
      documentNumber: document.document_number ?? undefined,
      authorizedAt: document.authorized_at ?? undefined,
      cancelledAt: document.cancelled_at ?? undefined,
      safePayload: { environment: 'homologation', simulated: true },
    };
  }

  async cancel(document: FiscalProviderDocument, _reason: string, context: FiscalProviderContext): Promise<FiscalProviderResult> {
    if (context.environment === 'production') {
      return { status: 'error', rejectionCode: 'PRODUCTION_CONNECTOR_REQUIRED', rejectionMessage: 'Sandbox indisponível em produção.' };
    }
    return { status: 'cancelled', cancelledAt: new Date().toISOString(), safePayload: { simulated: true } };
  }

  async replace(_document: FiscalProviderDocument, replacement: FiscalProviderDocument, context: FiscalProviderContext): Promise<FiscalProviderResult> {
    return this.issue(replacement, context);
  }

  verifyWebhook(rawBody: string, signature: string | null, secret?: string): boolean {
    if (!secret || !signature) return false;
    const actual = Buffer.from(createHash('sha256').update(`${secret}:${rawBody}`).digest('hex'));
    const expected = Buffer.from(signature);
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  }

  async health(context: Omit<FiscalProviderContext, 'requestId'>) {
    return context.environment === 'homologation'
      ? { ok: true, safeMessage: 'Adaptador de homologação disponível.' }
      : { ok: false, safeMessage: 'Configure um provedor real antes de ativar produção.' };
  }
}

