'use client';

/**
 * O estado do Motor de Aprovação, no nível da carteira.
 *
 * Existe por uma razão só, e ela é a §43: enquanto a organização não foi
 * cortada para o motor compartilhado, ele não tem pedido nenhum — e a tela
 * precisa dizer POR QUÊ. Uma fila vazia sem explicação é lida como "nada
 * pendente", e essa leitura transforma a ausência de integração numa
 * afirmação sobre governança.
 *
 * Falha de leitura também não vira silêncio: ela aparece como indisponível,
 * porque "não consegui ler" e "não há nada" não são a mesma frase.
 */

import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { Info, AlertTriangle, ShieldCheck } from 'lucide-react';
import {
  getContractApprovalEngineMode, listOpenApprovalRequests,
} from '@/lib/platform/approvals/approval-service';
import type { ApprovalEngineMode, ApprovalRequestView } from '@/lib/platform/approvals/types';

export function ApprovalEngineStatusBanner({ className }: { className?: string }) {
  const [mode, setMode] = useState<ApprovalEngineMode | null>(null);
  const [open, setOpen] = useState<ApprovalRequestView[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const m = await getContractApprovalEngineMode();
        if (!alive) return;
        setMode(m);
        // A fila só é consultada quando ela pode ter algo. Consultá-la antes do
        // corte devolveria zero e convidaria a exibir "0 pendentes".
        if (m === 'SHARED_ENGINE') {
          const rows = await listOpenApprovalRequests();
          if (alive) setOpen(rows);
        }
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : 'Falha ao ler o motor de aprovação.');
      }
    })();
    return () => { alive = false; };
  }, []);

  if (error) {
    return (
      <p className={cn(
        'flex items-start gap-2 rounded-[12px] border border-ig-danger/30 bg-ig-danger/5 px-3 py-2 text-ig-caption text-ig-danger',
        className,
      )}>
        <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
        <span>Motor de Aprovação indisponível: {error}. Nada nesta tela deve ser lido como
          ausência de pedidos.</span>
      </p>
    );
  }

  if (mode === null) return null;

  if (mode === 'LEGACY_ONLY') {
    return (
      <p className={cn(
        'flex items-start gap-2 rounded-[12px] border border-ig-border-strong bg-ig-surface-raised px-3 py-2 text-ig-caption text-ig-fg-muted',
        className,
      )}>
        <Info className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
        <span>
          O Motor de Aprovação da Plataforma está instalado, mas a aprovação de contrato desta
          organização <strong>ainda não foi migrada</strong> para ele. As rotas abaixo são o
          fluxo anterior, e continuam sendo a governança em vigor.
        </span>
      </p>
    );
  }

  return (
    <p className={cn(
      'flex items-start gap-2 rounded-[12px] border border-ig-border-strong bg-ig-surface-raised px-3 py-2 text-ig-caption text-ig-fg-muted',
      className,
    )}>
      <ShieldCheck className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
      <span>
        Aprovação de contrato governada pelo Motor de Aprovação da Plataforma.
        {open.length === 0
          ? ' Nenhum pedido em aberto no momento.'
          : ` ${open.length} pedido(s) em aberto.`}
      </span>
    </p>
  );
}
