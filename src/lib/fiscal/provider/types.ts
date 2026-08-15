import type { FiscalDocument, FiscalDocumentStatus } from '../types';

export interface FiscalProviderDocument extends FiscalDocument {
  provider_payload_sanitized?: Record<string, unknown> | null;
}

export interface FiscalProviderResult {
  status: Extract<FiscalDocumentStatus, 'authorized' | 'rejected' | 'processing' | 'cancelled' | 'error'>;
  providerDocumentId?: string;
  accessKey?: string;
  documentNumber?: string;
  verificationCode?: string;
  authorizedAt?: string;
  cancelledAt?: string;
  rejectionCode?: string;
  rejectionMessage?: string;
  safePayload?: Record<string, unknown>;
  artifacts?: {
    xml?: string;
    danfsePdf?: Buffer;
  };
}

export interface FiscalProviderContext {
  organizationId: string;
  establishmentId: string;
  environment: 'homologation' | 'production';
  requestId: string;
}

export interface FiscalProvider {
  readonly key: string;
  issue(document: FiscalProviderDocument, context: FiscalProviderContext): Promise<FiscalProviderResult>;
  consult(document: FiscalProviderDocument, context: FiscalProviderContext): Promise<FiscalProviderResult>;
  cancel(document: FiscalProviderDocument, reason: string, context: FiscalProviderContext): Promise<FiscalProviderResult>;
  replace(document: FiscalProviderDocument, replacement: FiscalProviderDocument, context: FiscalProviderContext): Promise<FiscalProviderResult>;
  verifyWebhook(rawBody: string, signature: string | null, secret?: string): boolean;
  health(context: Omit<FiscalProviderContext, 'requestId'>): Promise<{ ok: boolean; safeMessage: string }>;
}

