'use client';

import { useCallback, useEffect, useState } from 'react';
import type { FiscalDocument, FiscalDocumentListResponse, FiscalEstablishment, FiscalRecipient, FiscalServiceCatalogEntry } from '@/lib/fiscal/types';
import { fiscalFetch } from './fiscal-ui';

export interface FiscalMasterData {
  establishments: FiscalEstablishment[];
  /** Contrapartes canônicas com o perfil fiscal anexado quando existe. */
  recipients: FiscalRecipient[];
  services: FiscalServiceCatalogEntry[];
  providerConfigs: Array<{
    id: string;
    establishment_id: string;
    provider_key: string;
    environment: string;
    enabled: boolean;
    base_url: string | null;
    certificate_subject: string | null;
    certificate_expires_at: string | null;
    certificate_fingerprint: string | null;
    last_health_at: string | null;
    last_health_status: string | null;
    last_health_message: string | null;
  }>;
}

export function useFiscalDocuments() {
  const [data, setData] = useState<FiscalDocumentListResponse>({
    documents: [],
    summary: { authorizedCount: 0, pendingCount: 0, rejectedCount: 0, grossAmountCents: 0, withheldAmountCents: 0, issuerTaxAmountCents: 0, integrationAlerts: 0 },
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fiscalFetch<{ ok: true; documents: FiscalDocument[]; summary: FiscalDocumentListResponse['summary'] }>('/api/fiscal/documents');
      setData({ documents: response.documents, summary: response.summary });
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao carregar notas.');
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  return { ...data, loading, error, refresh };
}

export function useFiscalMasterData() {
  const [data, setData] = useState<FiscalMasterData>({ establishments: [], recipients: [], services: [], providerConfigs: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fiscalFetch<{ ok: true } & FiscalMasterData>('/api/fiscal/master-data');
      setData(response);
      setError(null);
    } catch (err) { setError(err instanceof Error ? err.message : 'Falha ao carregar cadastros.'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  return { ...data, loading, error, refresh };
}

