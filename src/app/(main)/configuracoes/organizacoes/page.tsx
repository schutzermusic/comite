"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Building2, Check, Loader2, Plus } from "lucide-react";
import { HudHeader } from "@/components/hud/HudHeader";
import { HudPanel } from "@/components/hud/HudPanel";
import { OrganizationMembersPanel } from "@/components/organizations/OrganizationMembersPanel";
import { useCurrentUser } from "@/hooks/use-current-user";
import { switchOrganization } from "@/lib/auth/organization-switch";
import { createClient } from "@/utils/supabase/client";
import { cn } from "@/lib/utils";

type Readiness = {
  operational_facts: Record<string, number>;
  operational_facts_total: number;
  platform_facts: Record<string, number>;
  configuration: {
    company_profile: "READY" | "INCOMPLETE";
    members: number;
    fiscal: "CONFIGURED" | "NOT_CONFIGURED";
    approval_policies: "CONFIGURED" | "NOT_CONFIGURED";
    billing_release_authority: "CONFIGURED" | "NOT_CONFIGURED";
  };
};

const MEMBERSHIP_LABEL: Record<string, string> = {
  ACTIVE: "Ativo",
  SUSPENDED: "Suspenso",
  INVITED: "Convite pendente",
};

const ORG_STATUS_LABEL: Record<string, string> = {
  active: "Ativa",
  suspended: "Suspensa",
  archived: "Arquivada",
};

/**
 * Gestão de organizações (§9).
 *
 * A tela não decide nada: ela mostra o que `my_organizations()` prova e o que
 * `organization_readiness()` conta. Toda ação passa por RPC governada, e uma
 * recusa aparece com o NOME dela — nunca como "algo deu errado" (§32, §46).
 */
export default function OrganizacoesPage() {
  const { organization, organizations, canProvisionOrganizations, accessState, loading } =
    useCurrentUser();
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const [readinessError, setReadinessError] = useState<string | null>(null);
  const [switchError, setSwitchError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);

  const loadReadiness = useCallback(async (organizationId: string) => {
    const supabase = createClient();
    const { data, error } = await supabase.rpc("organization_readiness", {
      p_organization_id: organizationId,
    });
    if (error) {
      setReadiness(null);
      setReadinessError(error.message);
      return;
    }
    setReadinessError(null);
    setReadiness(data as Readiness);
  }, []);

  useEffect(() => {
    const organizationId = organization?.id;
    if (!organizationId) return;
    queueMicrotask(() => {
      void loadReadiness(organizationId);
    });
  }, [organization?.id, loadReadiness]);

  const onSwitch = async (organizationId: string) => {
    setSwitchError(null);
    setPending(organizationId);
    const result = await switchOrganization(organizationId, "/configuracoes/organizacoes");
    if (!result.ok) {
      setSwitchError(result.message);
      setPending(null);
    }
  };

  return (
    <>
      <HudHeader
        title="Organizações"
        subtitle="Empresas do grupo em que você tem vínculo. Trocar de organização troca todo o contexto de dados."
        icon={<Building2 size={18} />}
        iconTint="#64748B"
      />

      <div className="mt-6 flex flex-col gap-6">
        {loading && (
          <p className="text-ig-body-sm text-ig-fg-muted">
            <Loader2 size={13} className="mr-2 inline animate-spin" />
            Carregando vínculos…
          </p>
        )}

        {!loading && accessState !== "ACTIVE" && (
          <HudPanel elevation={2} title="Sem organização ativa">
            <p className="text-ig-body-sm text-ig-fg-muted" data-testid="access-state">
              {accessState === "NO_ORGANIZATION" &&
                "Você não tem vínculo com nenhuma organização. Peça um convite ao administrador do grupo."}
              {accessState === "NO_MEMBERSHIP" &&
                "Nenhum vínculo ativo. Peça ao administrador do grupo para reativar seu acesso."}
              {accessState === "MEMBERSHIP_SUSPENDED" &&
                "Seu vínculo está suspenso. Peça ao administrador do grupo para reativá-lo."}
              {accessState === "ORGANIZATION_SUSPENDED" &&
                "A organização está suspensa. Nenhuma operação é permitida enquanto durar a suspensão."}
              {accessState === "ORGANIZATION_ARCHIVED" &&
                "A organização está arquivada. A história permanece auditável, mas não há operação."}
            </p>
          </HudPanel>
        )}

        <HudPanel
          elevation={2}
          title="Suas organizações"
          headerActions={
            canProvisionOrganizations ? (
              <Link
                href="/configuracoes/organizacoes/nova"
                className="flex items-center gap-1.5 text-ig-body-sm text-ig-accent hover:underline"
              >
                <Plus size={13} />
                Nova organização
              </Link>
            ) : undefined
          }
        >
          {switchError && (
            <p className="mb-3 text-ig-body-sm text-ig-danger" role="alert">
              {switchError}
            </p>
          )}

          {organizations.length === 0 && !loading && (
            <p className="text-ig-body-sm text-ig-fg-muted">Nenhuma organização vinculada.</p>
          )}

          <ul className="flex flex-col gap-1" data-testid="organization-list">
            {organizations.map((option) => {
              const active = option.organization_id === organization?.id;
              const blocked = option.membership_status !== "ACTIVE" || option.status !== "active";
              return (
                <li
                  key={option.organization_id}
                  className={cn(
                    "flex items-center gap-3 rounded-[var(--ig-radius-md)] border border-ig-border px-3 py-2.5",
                    active && "border-ig-accent bg-ig-accent-weak",
                  )}
                >
                  <span className="w-4 shrink-0">
                    {active && <Check size={13} className="text-ig-accent" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-ig-body-sm text-ig-fg-strong">{option.name}</p>
                    <p className="truncate text-ig-label text-ig-fg-subtle">
                      {option.enterprise_name} · {ORG_STATUS_LABEL[option.status] ?? option.status} ·
                      vínculo {MEMBERSHIP_LABEL[option.membership_status] ?? option.membership_status}
                    </p>
                  </div>
                  {!active && (
                    <button
                      type="button"
                      disabled={blocked || pending !== null}
                      onClick={() => void onSwitch(option.organization_id)}
                      className="shrink-0 rounded-[var(--ig-radius-md)] border border-ig-border px-2.5 py-1 text-ig-label text-ig-fg hover:bg-ig-panel-hover disabled:opacity-40"
                    >
                      {pending === option.organization_id ? "Trocando…" : "Entrar"}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </HudPanel>

        {organization && <OrganizationMembersPanel />}

        {organization && (
          <HudPanel elevation={2} title={`Prontidão — ${organization.name}`}>
            {readinessError && (
              <p className="text-ig-body-sm text-ig-danger" role="alert">
                {readinessError}
              </p>
            )}
            {!readiness && !readinessError && (
              <p className="text-ig-body-sm text-ig-fg-muted">Consultando…</p>
            )}
            {readiness && (
              <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2" data-testid="readiness">
                <ReadinessRow
                  label="Perfil da empresa"
                  value={readiness.configuration.company_profile === "READY" ? "COMPLETO" : "INCOMPLETO"}
                />
                <ReadinessRow label="Membros ativos" value={String(readiness.configuration.members)} />
                <ReadinessRow
                  label="Fatos operacionais"
                  value={
                    readiness.operational_facts_total === 0
                      ? "VAZIO"
                      : String(readiness.operational_facts_total)
                  }
                />
                <ReadinessRow
                  label="Configuração fiscal"
                  value={readiness.configuration.fiscal === "CONFIGURED" ? "CONFIGURADA" : "NÃO CONFIGURADA"}
                />
                <ReadinessRow
                  label="Política de aprovação"
                  value={
                    readiness.configuration.approval_policies === "CONFIGURED"
                      ? "CONFIGURADA"
                      : "NÃO CONFIGURADA"
                  }
                />
                <ReadinessRow
                  label="Alçada de faturamento"
                  value={
                    readiness.configuration.billing_release_authority === "CONFIGURED"
                      ? "CONFIGURADA"
                      : "NÃO CONFIGURADA"
                  }
                />
              </dl>
            )}
          </HudPanel>
        )}
      </div>
    </>
  );
}

function ReadinessRow({ label, value }: { label: string; value: string }) {
  const absent = value === "VAZIO" || value === "NÃO CONFIGURADA" || value === "INCOMPLETO";
  return (
    <div className="flex items-center justify-between gap-3 border-b border-ig-border py-1.5">
      <dt className="text-ig-body-sm text-ig-fg-muted">{label}</dt>
      <dd className={cn("text-ig-label ig-label-upper", absent ? "text-ig-fg-subtle" : "text-ig-fg-strong")}>
        {value}
      </dd>
    </div>
  );
}
