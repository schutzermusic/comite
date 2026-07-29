'use client';

/**
 * Solicitações de ajuste (§10): abrir um pedido e acompanhar a resposta
 * do gestor. Quando o pedido é recusado, a justificativa aparece aqui.
 */

import * as React from 'react';
import { CircleAlert, FileClock, Plus } from 'lucide-react';
import { pontoApi, PontoApiError } from '@/lib/ponto/client';
import type { AdjustmentInput, AdjustmentRequest } from '@/lib/ponto/attendance-types';
import {
  AdjustmentRequestCard,
  AdjustmentRequestForm,
} from '@/components/ponto/AdjustmentRequestForm';
import {
  EmptyState,
  PontoButton,
  PontoCard,
  PontoSheet,
  PontoSkeleton,
  SectionLabel,
} from '@/components/ponto';

export default function PontoRequestsPage() {
  const [requests, setRequests] = React.useState<AdjustmentRequest[] | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const [formOpen, setFormOpen] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [submitError, setSubmitError] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await pontoApi.adjustments();
      setRequests(result.requests);
    } catch (e) {
      setRequests(null);
      setError(
        e instanceof PontoApiError && e.isOffline
          ? 'Sem conexão. Conecte-se para ver suas solicitações.'
          : e instanceof Error
            ? e.message
            : 'Não foi possível carregar as solicitações.',
      );
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  async function handleSubmit(input: AdjustmentInput) {
    setSubmitting(true);
    setSubmitError(null);
    try {
      await pontoApi.createAdjustment(input);
      setFormOpen(false);
      await load();
    } catch (e) {
      setSubmitError(
        e instanceof PontoApiError && e.code === 'duplicate'
          ? 'Você já enviou essa solicitação e ela ainda está em análise.'
          : e instanceof Error
            ? e.message
            : 'Não foi possível enviar a solicitação. Tente novamente.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  const openCount = requests?.filter((r) => r.status === 'under_review' || r.status === 'sent').length ?? 0;

  return (
    <div className="space-y-5">
      <PontoButton variant="primary" icon={Plus} onClick={() => setFormOpen(true)} className="md:w-auto">
        Nova solicitação de ajuste
      </PontoButton>

      <section>
        <SectionLabel icon={FileClock}>
          {openCount > 0 ? `Minhas solicitações · ${openCount} em análise` : 'Minhas solicitações'}
        </SectionLabel>

        {loading ? (
          <div className="space-y-3" aria-busy="true">
            <PontoSkeleton className="h-28 w-full rounded-[var(--ig-radius-lg)]" />
            <PontoSkeleton className="h-28 w-full rounded-[var(--ig-radius-lg)]" />
            <p className="sr-only">Carregando suas solicitações</p>
          </div>
        ) : error ? (
          <PontoCard>
            <EmptyState
              icon={CircleAlert}
              title="Não foi possível carregar"
              description={error}
              action={
                <PontoButton variant="secondary" onClick={() => void load()}>
                  Tentar novamente
                </PontoButton>
              }
            />
          </PontoCard>
        ) : !requests || requests.length === 0 ? (
          <PontoCard>
            <EmptyState
              icon={FileClock}
              title="Nenhuma solicitação por aqui"
              description="Se você esqueceu de bater o ponto ou o horário ficou errado, peça um ajuste — seu gestor analisa e responde nesta tela."
              action={
                <PontoButton variant="secondary" icon={Plus} onClick={() => setFormOpen(true)}>
                  Solicitar ajuste
                </PontoButton>
              }
            />
          </PontoCard>
        ) : (
          <div className="grid grid-cols-1 items-start gap-3 md:grid-cols-2 xl:grid-cols-3">
            {requests.map((request) => (
              <AdjustmentRequestCard key={request.id} request={request} />
            ))}
          </div>
        )}
      </section>

      <PontoSheet
        open={formOpen}
        onOpenChange={(open) => {
          setFormOpen(open);
          if (!open) setSubmitError(null);
        }}
        title="Solicitar ajuste"
        description="Explique o que aconteceu e informe o horário correto."
      >
        <AdjustmentRequestForm
          submitting={submitting}
          error={submitError}
          onSubmit={(input) => void handleSubmit(input)}
          onCancel={() => setFormOpen(false)}
        />
      </PontoSheet>
    </div>
  );
}
