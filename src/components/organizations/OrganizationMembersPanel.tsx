"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Users } from "lucide-react";
import { HudPanel } from "@/components/hud/HudPanel";
import { useCurrentUser } from "@/hooks/use-current-user";
import { hasPermission } from "@/lib/auth/permissions";
import { createClient } from "@/utils/supabase/client";

type MembershipRow = {
  user_id: string;
  status: "INVITED" | "ACTIVE" | "SUSPENDED" | "REVOKED";
  joined_at: string | null;
};

const STATUS_LABEL: Record<string, string> = {
  ACTIVE: "Ativo",
  SUSPENDED: "Suspenso",
  REVOKED: "Revogado",
  INVITED: "Convite pendente",
};

const ERROR_MESSAGE: Record<string, string> = {
  ORGANIZATION_NOT_FOUND: "Organização não encontrada ou sem acesso.",
  ORGANIZATION_ACCESS_DENIED: "Você não tem autoridade para administrar vínculos aqui.",
  SELF_MEMBERSHIP_CHANGE_FORBIDDEN: "Você não pode alterar o próprio vínculo.",
  INVALID_MEMBERSHIP_STATUS: "Estado de vínculo inválido.",
};

/**
 * Ciclo de vida de vínculo (§15) — auditado, e nunca auto-aplicado.
 *
 * As ações não escrevem na tabela: chamam `organization_membership_set_status`,
 * que confere autoridade, recusa auto-alteração, derruba o contexto ativo de
 * quem foi suspenso e grava auditoria e evento. Escrever daqui seria dar ao
 * navegador a caneta que a §15 tirou dele.
 */
export function OrganizationMembersPanel() {
  const { organization, permissions, user } = useCurrentUser();
  const organizationId = organization?.id;
  const canManage = hasPermission(permissions, "admin.manage_users");

  const [rows, setRows] = useState<MembershipRow[] | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!organizationId) return;
    const supabase = createClient();
    const [{ data: memberships }, { data: people }] = await Promise.all([
      supabase
        .from("organization_memberships")
        .select("user_id,status,joined_at")
        .eq("organization_id", organizationId)
        .returns<MembershipRow[]>(),
      supabase.rpc("list_organization_members"),
    ]);
    setRows(memberships ?? []);
    const map: Record<string, string> = {};
    for (const person of (people ?? []) as Array<{ user_id: string; full_name: string | null; email: string | null }>) {
      map[person.user_id] = person.full_name ?? person.email ?? person.user_id;
    }
    setNames(map);
  }, [organizationId]);

  useEffect(() => {
    /*
      `queueMicrotask` é o mesmo padrão de `use-current-user`: a busca é
      assíncrona e o compilador do React recusa `setState` síncrono no corpo do
      efeito. Sair do corpo antes de tocar em estado evita a renderização em
      cascata que a regra existe para impedir.
    */
    queueMicrotask(() => {
      void load();
    });
  }, [load]);

  const setStatus = async (userId: string, status: MembershipRow["status"]) => {
    if (!organizationId) return;
    setBusy(userId);
    setError(null);
    const supabase = createClient();
    const { error: rpcError } = await supabase.rpc("organization_membership_set_status", {
      p_organization_id: organizationId,
      p_user_id: userId,
      p_status: status,
      p_reason: null,
    });
    if (rpcError) {
      const code = Object.keys(ERROR_MESSAGE).find((key) => rpcError.message.includes(key));
      setError(code ? ERROR_MESSAGE[code] : rpcError.message);
    } else {
      await load();
    }
    setBusy(null);
  };

  if (!organization) return null;

  return (
    <HudPanel elevation={2} title="Membros da organização" icon={<Users size={15} />}>
      {error && (
        <p className="mb-3 text-ig-body-sm text-ig-danger" role="alert">
          {error}
        </p>
      )}

      {rows === null && (
        <p className="text-ig-body-sm text-ig-fg-muted">
          <Loader2 size={13} className="mr-2 inline animate-spin" />
          Carregando…
        </p>
      )}

      {rows !== null && rows.length === 0 && (
        <p className="text-ig-body-sm text-ig-fg-muted">
          Nenhum vínculo visível. Administrar membros exige a permissão
          <code className="mx-1">admin.manage_users</code>nesta organização.
        </p>
      )}

      <ul className="flex flex-col gap-1" data-testid="membership-list">
        {(rows ?? []).map((row) => {
          const self = row.user_id === user?.id;
          return (
            <li
              key={row.user_id}
              className="flex items-center gap-3 border-b border-ig-border-subtle py-2 last:border-b-0"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-ig-body-sm text-ig-fg-strong">
                  {names[row.user_id] ?? row.user_id}
                  {self && <span className="ml-2 text-ig-label text-ig-fg-subtle">(você)</span>}
                </p>
                <p className="text-ig-label text-ig-fg-subtle">
                  {STATUS_LABEL[row.status] ?? row.status}
                </p>
              </div>

              {canManage && !self && (
                <div className="flex shrink-0 gap-1">
                  {row.status !== "ACTIVE" && (
                    <MemberAction
                      busy={busy === row.user_id}
                      onClick={() => void setStatus(row.user_id, "ACTIVE")}
                      label="Reativar"
                    />
                  )}
                  {row.status === "ACTIVE" && (
                    <MemberAction
                      busy={busy === row.user_id}
                      onClick={() => void setStatus(row.user_id, "SUSPENDED")}
                      label="Suspender"
                    />
                  )}
                  {row.status !== "REVOKED" && (
                    <MemberAction
                      busy={busy === row.user_id}
                      onClick={() => void setStatus(row.user_id, "REVOKED")}
                      label="Revogar"
                    />
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </HudPanel>
  );
}

function MemberAction({
  label,
  busy,
  onClick,
}: {
  label: string;
  busy: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={busy}
      onClick={onClick}
      className="rounded-[var(--ig-radius-md)] border border-ig-border px-2 py-1 text-ig-label text-ig-fg hover:bg-ig-panel-hover disabled:opacity-40"
    >
      {label}
    </button>
  );
}
