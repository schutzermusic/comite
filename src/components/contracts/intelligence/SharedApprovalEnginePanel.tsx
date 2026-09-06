'use client';

/**
 * Motor de Aprovação da Plataforma — a visão do piloto de Contratos.
 *
 * ─── A decisão de desenho que governa este arquivo ─────────────────────────
 *
 * Enquanto a organização NÃO foi cortada para o motor compartilhado, ele não
 * tem pedido nenhum — e zero pedidos aqui NÃO é "nada pendente". É "esta
 * organização ainda não migrou". Mostrar um contador vazio, ou um "tudo em
 * dia", transformaria a ausência de integração numa afirmação positiva sobre
 * governança, que é o que a arquitetura chama de tratar ausência como
 * conformidade.
 *
 * Por isso o estado LEGACY_ONLY é declarado com todas as letras, e a história
 * antiga aparece rotulada como LEGADO — com os campos que o motor novo tem e o
 * antigo nunca teve exibidos como "não registrado", nunca preenchidos.
 *
 * Nenhum KPI é inventado aqui. Nenhum card de IA. A navegação do módulo não
 * muda: isto é uma visão dentro da aba Aprovações que já existia.
 */

import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { pt } from 'date-fns/locale';
import { ShieldCheck, Info, History, AlertTriangle } from 'lucide-react';
import { HudPanel } from '@/components/hud';
import {
  listApprovalRequestsForSubject, listLegacyContractApprovals,
  getContractApprovalEngineMode,
} from '@/lib/platform/approvals/approval-service';
import {
  REQUEST_STATUS_LABEL, STEP_STATUS_LABEL, DECISION_PURPOSE_LABEL,
  type ApprovalRequestView, type LegacyApprovalRow, type ApprovalEngineMode,
} from '@/lib/platform/approvals/types';

const LEGACY_STATUS_LABEL: Record<LegacyApprovalRow['legacy_status'], string> = {
  pending: 'Aguardando', under_review: 'Em análise',
  approved: 'Aprovada', rejected: 'Rejeitada',
};

const LEGACY_STEP_LABEL: Record<string, string> = {
  juridico: 'Jurídico', financeiro: 'Financeiro',
  comite: 'Comitê', diretoria: 'Diretoria',
};

const when = (iso: string | null): string =>
  iso ? format(new Date(iso), "dd/MM/yy HH:mm", { locale: pt }) : '—';

type State = {
  mode: ApprovalEngineMode | null;
  requests: ApprovalRequestView[];
  legacy: LegacyApprovalRow[];
  error: string | null;
  loading: boolean;
};

export function SharedApprovalEnginePanel({
  contractId, className,
}: { contractId: string; className?: string }) {
  const [state, setState] = useState<State>({
    mode: null, requests: [], legacy: [], error: null, loading: true,
  });

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [mode, requests, legacy] = await Promise.all([
          getContractApprovalEngineMode(),
          listApprovalRequestsForSubject('contract', contractId),
          listLegacyContractApprovals(contractId),
        ]);
        if (alive) setState({ mode, requests, legacy, error: null, loading: false });
      } catch (e) {
        /*
          Falha de leitura NÃO vira lista vazia. Uma tela que mostra "nenhuma
          aprovação" quando na verdade não conseguiu ler afirma conformidade
          que ninguém verificou.
        */
        if (alive) {
          setState({
            mode: null, requests: [], legacy: [],
            error: e instanceof Error ? e.message : 'Falha ao ler as aprovações.',
            loading: false,
          });
        }
      }
    })();
    return () => { alive = false; };
  }, [contractId]);

  if (state.loading) {
    return (
      <div className={cn('rounded-[14px] border border-ig-border-subtle px-4 py-3.5', className)}>
        <p className="text-ig-caption text-ig-fg-muted">Carregando governança de aprovação…</p>
      </div>
    );
  }

  if (state.error) {
    return (
      <p className={cn(
        'flex items-start gap-2 rounded-[12px] border border-ig-danger/30 bg-ig-danger/5 px-3 py-2 text-ig-caption text-ig-danger',
        className,
      )}>
        <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
        <span>
          Governança de aprovação indisponível: {state.error}. A ausência de etapas nesta tela
          não significa que não existam.
        </span>
      </p>
    );
  }

  return (
    <div className={cn('space-y-4', className)}>
      {/*
        O estado do motor vem PRIMEIRO. Sem ele, tudo abaixo pode ser lido como
        "não há nada a aprovar", que é a leitura errada.
      */}
      {state.mode === 'LEGACY_ONLY' && (
        <p className="flex items-start gap-2 rounded-[12px] border border-ig-border-strong bg-ig-surface-raised px-3 py-2 text-ig-caption text-ig-fg-muted">
          <Info className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
          <span>
            A aprovação de contrato desta organização ainda é governada pelo fluxo anterior.
            O Motor de Aprovação da Plataforma está disponível, mas não recebeu esta ação —
            por isso ele não tem pedidos aqui. <strong>Isto não quer dizer que não haja
            aprovações pendentes:</strong> quer dizer que elas estão no histórico abaixo.
          </span>
        </p>
      )}

      {state.mode === 'SHARED_ENGINE' && (
        <HudPanel
          title="Pedidos de aprovação"
          subtitle="Política, versão, estágio e decisões — motor compartilhado"
          icon={<ShieldCheck className="h-4 w-4" />}
          interactive={false}
        >
          {state.requests.length === 0 ? (
            <p className="py-6 text-center text-ig-caption text-ig-fg-muted">
              Nenhum pedido de aprovação aberto para este contrato.
            </p>
          ) : (
            <div className="space-y-4">
              {state.requests.map((r) => <RequestCard key={r.request_id} request={r} />)}
            </div>
          )}
        </HudPanel>
      )}

      {state.legacy.length > 0 && (
        <HudPanel
          title="Histórico anterior de aprovação"
          subtitle="Registro legado — preservado como foi gravado"
          icon={<History className="h-4 w-4" />}
          interactive={false}
        >
          {/*
            O aviso não é decoração. Estas linhas não têm política, versão,
            requerente nem base de autoridade porque essas colunas nunca
            existiram — e não porque se perderam. Dizer isso é a diferença
            entre um histórico honesto e um que aparenta governança.
          */}
          <p className="mb-3 text-ig-caption text-ig-fg-muted">
            Etapas registradas antes do Motor de Aprovação da Plataforma. Não têm política,
            versão, alçada nem requerente registrados — esses campos não existiam no modelo
            anterior. Nada foi preenchido para preencher.
          </p>
          <ul className="space-y-2">
            {state.legacy.map((row) => (
              <li
                key={row.legacy_id}
                className="flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded-[12px] border border-ig-border-subtle px-3 py-2"
              >
                <span className="text-ig-body-sm font-semibold text-ig-fg-strong">
                  {LEGACY_STEP_LABEL[row.step_key] ?? row.step_key}
                </span>
                <span className="text-ig-caption text-ig-fg-muted">
                  {LEGACY_STATUS_LABEL[row.legacy_status] ?? row.legacy_status}
                </span>
                <span className="text-ig-caption text-ig-fg-muted">
                  {row.approval_timestamp ? `decidida em ${when(row.approval_timestamp)}`
                    : row.completed_at ? `encerrada em ${when(row.completed_at)}`
                    : 'sem decisão registrada'}
                </span>
                <span className="ml-auto rounded border border-ig-border-subtle px-1.5 py-px text-ig-label uppercase tracking-wide text-ig-fg-muted">
                  legado
                </span>
                {row.rejection_reason && (
                  <p className="w-full text-ig-caption text-ig-danger">{row.rejection_reason}</p>
                )}
                {row.requested_changes_note && (
                  <p className="w-full text-ig-caption text-ig-warning">{row.requested_changes_note}</p>
                )}
              </li>
            ))}
          </ul>
        </HudPanel>
      )}
    </div>
  );
}

function RequestCard({ request }: { request: ApprovalRequestView }) {
  const steps = request.steps ?? [];
  const decisions = request.decisions ?? [];
  return (
    <div className="space-y-2 rounded-[14px] border border-ig-border-subtle px-4 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <div className="min-w-0">
          <p className="truncate text-ig-body-sm font-semibold text-ig-fg-strong">
            {request.subject_label ?? 'Contrato'}
          </p>
          {/*
            Política E VERSÃO, sempre juntas. A versão é o que responde "sob que
            regra isto foi decidido" — e ela nunca muda depois, mesmo que a
            política ganhe versões novas.
          */}
          <p className="truncate text-ig-caption text-ig-fg-muted">
            {DECISION_PURPOSE_LABEL[request.decision_purpose]} · {request.policy_key} v{request.policy_version_no}
          </p>
        </div>
        <span className="text-ig-caption font-semibold text-ig-fg-strong">
          {REQUEST_STATUS_LABEL[request.status]}
          {request.status === 'PENDING' && request.open_hours !== null
            && ` · há ${request.open_hours < 48 ? `${Math.round(request.open_hours)}h` : `${Math.round(request.open_hours / 24)}d`}`}
        </span>
      </div>

      {request.outcome_reason && (
        <p className="text-ig-caption text-ig-fg-muted">{request.outcome_reason}</p>
      )}

      <ul className="space-y-1">
        {steps.map((s) => {
          const decision = decisions.find((d) => d.step_key === s.step_key);
          return (
            <li key={s.step_id} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-ig-caption">
              <span className="font-semibold text-ig-fg-strong">{s.name}</span>
              <span className="text-ig-fg-muted">estágio {s.stage_no}</span>
              <span className="text-ig-fg-muted">{STEP_STATUS_LABEL[s.status]}</span>
              {s.authority_required && (
                <span className="text-ig-fg-muted">
                  alçada {s.authority_max_amount
                    ? `${s.authority_currency} ${s.authority_max_amount}`
                    : 'ilimitada'}
                </span>
              )}
              {/*
                Delegação aparece com o DELEGANTE nomeado. Uma decisão delegada
                exibida como se fosse do próprio delegado esconderia de quem a
                autoridade realmente veio.
              */}
              {decision?.on_behalf_of_user_id && (
                <span className="text-ig-warning">por delegação</span>
              )}
              {decision?.reason && (
                <span className="w-full text-ig-fg-muted">{decision.reason}</span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
