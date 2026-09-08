"use client";

import { useState } from "react";
import Link from "next/link";
import { Building2, Check, ChevronsUpDown, Loader2, Plus, Settings2 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useCurrentUser } from "@/hooks/use-current-user";
import { switchOrganization } from "@/lib/auth/organization-switch";
import { cn } from "@/lib/utils";

/**
 * O seletor global de organização (§8).
 *
 * Ele mostra apenas o que `my_organizations()` devolve — isto é, apenas o que o
 * vínculo prova. Não há filtragem de lista no cliente: organização de que a
 * pessoa não é membro nunca chega até aqui, e mesmo que chegasse, a troca seria
 * recusada pelo banco.
 *
 * Vínculo suspenso ou convite pendente APARECEM, desabilitados e nomeados. É a
 * §32 aplicada ao seletor: sumir com a linha faria a pessoa achar que perdeu a
 * organização; dizer "suspenso" diz o que houve.
 */
export function OrganizationSwitcher({ collapsed = false }: { collapsed?: boolean }) {
  const { organization, organizations, canProvisionOrganizations, loading } = useCurrentUser();
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (loading) {
    return (
      <div className="flex h-8 items-center gap-2 px-2 text-ig-body-sm text-ig-fg-subtle">
        <Loader2 size={14} className="animate-spin" />
        {!collapsed && <span>Carregando…</span>}
      </div>
    );
  }

  // Sem organização ativa o seletor não some: ele é o caminho de volta.
  const label = organization?.name ?? "Sem organização";
  const groups = new Map<string, typeof organizations>();
  for (const option of organizations) {
    const list = groups.get(option.enterprise_name) ?? [];
    list.push(option);
    groups.set(option.enterprise_name, list);
  }

  const onSelect = async (organizationId: string) => {
    if (organizationId === organization?.id) return;
    setError(null);
    setPending(organizationId);
    const result = await switchOrganization(organizationId);
    if (!result.ok) {
      setError(result.message);
      setPending(null);
    }
    // Em caso de sucesso a página é recarregada; não há estado a restaurar.
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          data-testid="organization-switcher"
          className={cn(
            "flex w-full items-center gap-2 rounded-[var(--ig-radius-md)] px-2 py-1.5",
            "text-ig-body-sm text-ig-fg hover:bg-ig-panel-hover transition-colors",
          )}
          aria-label="Trocar de organização"
        >
          <Building2 size={14} className="shrink-0 text-ig-accent" />
          {!collapsed && (
            <>
              <span className="min-w-0 flex-1 truncate text-left" data-testid="active-organization-name">
                {label}
              </span>
              <ChevronsUpDown size={12} className="shrink-0 text-ig-fg-subtle" />
            </>
          )}
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start" className="w-72">
        {organizations.length === 0 && (
          <DropdownMenuLabel className="text-ig-fg-muted">
            Nenhuma organização disponível
          </DropdownMenuLabel>
        )}

        {[...groups.entries()].map(([enterpriseName, options]) => (
          <div key={enterpriseName}>
            <DropdownMenuLabel className="ig-label-upper text-ig-label text-ig-fg-subtle">
              {enterpriseName}
            </DropdownMenuLabel>
            {options.map((option) => {
              const active = option.organization_id === organization?.id;
              const blocked =
                option.membership_status !== "ACTIVE" || option.status !== "active";
              return (
                <DropdownMenuItem
                  key={option.organization_id}
                  disabled={blocked || pending !== null}
                  onSelect={(event) => {
                    event.preventDefault();
                    if (!blocked) void onSelect(option.organization_id);
                  }}
                  className="flex items-center gap-2"
                >
                  <span className="w-4 shrink-0">
                    {pending === option.organization_id ? (
                      <Loader2 size={12} className="animate-spin" />
                    ) : active ? (
                      <Check size={12} className="text-ig-accent" />
                    ) : null}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{option.name}</span>
                  {blocked && (
                    <span className="shrink-0 text-ig-label text-ig-fg-subtle">
                      {option.membership_status === "SUSPENDED"
                        ? "suspenso"
                        : option.membership_status === "INVITED"
                          ? "convite"
                          : option.status === "archived"
                            ? "arquivada"
                            : "suspensa"}
                    </span>
                  )}
                </DropdownMenuItem>
              );
            })}
          </div>
        ))}

        {error && (
          <p className="px-2 py-1.5 text-ig-label text-ig-danger" role="alert">
            {error}
          </p>
        )}

        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/configuracoes/organizacoes" className="flex items-center gap-2">
            <Settings2 size={12} />
            Gerenciar organizações
          </Link>
        </DropdownMenuItem>
        {canProvisionOrganizations && (
          <DropdownMenuItem asChild>
            <Link href="/configuracoes/organizacoes/nova" className="flex items-center gap-2">
              <Plus size={12} />
              Nova organização
            </Link>
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
