import type { FiscalDocumentStatus } from './types';

const TRANSITIONS: Record<FiscalDocumentStatus, readonly FiscalDocumentStatus[]> = {
  draft: ['pending_approval', 'archived'],
  pending_approval: ['approved', 'draft', 'archived'],
  approved: ['queued', 'draft'],
  queued: ['processing', 'error'],
  processing: ['authorized', 'rejected', 'error'],
  authorized: ['cancellation_requested', 'replaced'],
  rejected: ['draft', 'archived'],
  error: ['queued', 'draft', 'archived'],
  cancellation_requested: ['cancelled', 'authorized', 'error'],
  cancelled: [],
  replaced: [],
  archived: [],
};

export function canTransitionFiscalDocument(from: FiscalDocumentStatus, to: FiscalDocumentStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function assertFiscalTransition(from: FiscalDocumentStatus, to: FiscalDocumentStatus): void {
  if (!canTransitionFiscalDocument(from, to)) {
    throw new Error(`Transição fiscal inválida: ${from} → ${to}.`);
  }
}

export function isFiscalDocumentImmutable(status: FiscalDocumentStatus): boolean {
  return !['draft', 'pending_approval', 'rejected', 'error'].includes(status);
}

