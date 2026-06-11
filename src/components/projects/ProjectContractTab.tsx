'use client';

/**
 * Contract tab — lightweight summary of the contract linked to this project
 * (contracts.project_id). Deep contract management stays in /contratos.
 */

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowUpRight, FileSignature, Loader2 } from 'lucide-react';
import { HudBadge, HudEmptyState, HudPanel } from '@/components/hud';
import { createClient } from '@/utils/supabase/client';

interface ContractRow {
  id: string;
  title: string | null;
  contract_number: string | null;
  counterparty_name: string | null;
  status: string | null;
  lifecycle_stage: string | null;
  start_date: string | null;
  end_date: string | null;
  currency: string | null;
  total_value: number | null;
  risk_level: string | null;
}

const fmtDate = (iso: string | null) => (iso ? iso.split('-').reverse().join('/') : '—');
const fmtMoney = (v: number | null, currency: string | null) =>
  v == null
    ? '—'
    : new Intl.NumberFormat('pt-BR', { style: 'currency', currency: currency || 'BRL' }).format(v);

export function ProjectContractTab({ projectId }: { projectId: string }) {
  const [contracts, setContracts] = useState<ContractRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const supabase = createClient();
        const { data } = await supabase
          .from('contracts')
          .select('id, title, contract_number, counterparty_name, status, lifecycle_stage, start_date, end_date, currency, total_value, risk_level')
          .eq('project_id', projectId)
          .is('deleted_at', null);
        if (active) setContracts((data ?? []) as ContractRow[]);
      } catch (e) {
        console.error('[ProjectContractTab]', e instanceof Error ? e.message : e);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [projectId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-12 text-ig-fg-muted">
        <Loader2 className="h-5 w-5 animate-spin" /> Carregando contrato…
      </div>
    );
  }

  if (contracts.length === 0) {
    return (
      <HudEmptyState
        icon="file"
        title="Nenhum contrato vinculado"
        description="Vincule um contrato a este projeto no módulo Contratos para acompanhar valor, prazos e obrigações aqui."
      />
    );
  }

  return (
    <div className="space-y-4">
      {contracts.map((c) => (
        <HudPanel key={c.id}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <FileSignature className="mt-0.5 h-5 w-5 text-ig-accent" />
              <div>
                <p className="text-sm font-semibold text-ig-fg-strong">{c.title ?? 'Contrato'}</p>
                <p className="text-xs text-ig-fg-muted">
                  {c.contract_number ? `Nº ${c.contract_number} · ` : ''}
                  {c.counterparty_name ?? ''}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {c.status && <HudBadge variant="info" size="sm">{c.status}</HudBadge>}
              {c.risk_level && (
                <HudBadge variant={c.risk_level === 'high' ? 'danger' : c.risk_level === 'medium' ? 'warning' : 'success'} size="sm">
                  Risco {c.risk_level}
                </HudBadge>
              )}
            </div>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-4 md:grid-cols-4">
            <div>
              <p className="text-ig-caption text-ig-fg-muted">Valor total</p>
              <p className="text-sm font-medium text-ig-fg-strong">{fmtMoney(c.total_value, c.currency)}</p>
            </div>
            <div>
              <p className="text-ig-caption text-ig-fg-muted">Início</p>
              <p className="text-sm font-medium text-ig-fg-strong">{fmtDate(c.start_date)}</p>
            </div>
            <div>
              <p className="text-ig-caption text-ig-fg-muted">Término</p>
              <p className="text-sm font-medium text-ig-fg-strong">{fmtDate(c.end_date)}</p>
            </div>
            <div>
              <p className="text-ig-caption text-ig-fg-muted">Estágio</p>
              <p className="text-sm font-medium text-ig-fg-strong">{c.lifecycle_stage ?? '—'}</p>
            </div>
          </div>
          <div className="mt-4">
            <Link href="/contratos" className="inline-flex items-center gap-1 text-xs text-ig-accent hover:underline">
              Abrir no módulo Contratos <ArrowUpRight className="h-3 w-3" />
            </Link>
          </div>
        </HudPanel>
      ))}
    </div>
  );
}
