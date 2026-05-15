'use client';

import { useMemo, useState } from 'react';
import { Check, MinusCircle, PlusCircle, RotateCcw, ShieldAlert, X } from 'lucide-react';
import { HudBadge, HudButton, HudInput, HudPanel, HudStatusPill } from '@/components/hud';
import { PERMISSION_GROUPS } from '@/lib/auth/permissions';

export type OverrideMap = Record<string, 'grant' | 'deny'>;

const CRITICAL_KEYS = new Set([
  'admin.manage_users',
  'admin.manage_roles',
  'admin.manage_organization',
  'admin.manage_integrations',
]);

type AccessCustomizerProps = {
  /** Permission keys the user gets from their role assignments (no overrides). */
  inheritedKeys: Set<string>;
  /** Current overrides keyed by permission_key → effect. */
  overrides: OverrideMap;
  /** Called when an override toggle changes. */
  onOverrideChange: (key: string, effect: 'grant' | 'deny' | null) => void;
  /** Called when the admin clicks "Reset to defaults". */
  onReset?: () => void;
  /** Disable interactions when an API call is in flight. */
  disabled?: boolean;
};

type RowState = 'inherited' | 'grant' | 'deny' | 'blocked' | 'none';

function rowState(key: string, inherited: boolean, override?: 'grant' | 'deny'): RowState {
  if (override === 'deny') return inherited ? 'blocked' : 'deny';
  if (override === 'grant') return inherited ? 'inherited' : 'grant';
  return inherited ? 'inherited' : 'none';
}

function effectiveFromState(state: RowState): boolean {
  return state === 'inherited' || state === 'grant';
}

const STATE_LABEL: Record<RowState, string> = {
  inherited: 'Herdada',
  grant: 'Concedida',
  deny: 'Negada (sem efeito)',
  blocked: 'Bloqueada',
  none: 'Sem acesso',
};

const STATE_VARIANT: Record<RowState, 'active' | 'info' | 'neutral' | 'error'> = {
  inherited: 'active',
  grant: 'info',
  deny: 'neutral',
  blocked: 'error',
  none: 'neutral',
};

export function AccessCustomizer({
  inheritedKeys,
  overrides,
  onOverrideChange,
  onReset,
  disabled,
}: AccessCustomizerProps) {
  const [search, setSearch] = useState('');
  const [moduleFilter, setModuleFilter] = useState<string>('all');

  const filteredGroups = useMemo(() => {
    const term = search.trim().toLowerCase();
    return PERMISSION_GROUPS.filter((group) => moduleFilter === 'all' || group.module === moduleFilter)
      .map((group) => ({
        ...group,
        permissions: group.permissions.filter((permission) => {
          if (!term) return true;
          return (
            permission.key.toLowerCase().includes(term)
            || permission.label.toLowerCase().includes(term)
            || group.label.toLowerCase().includes(term)
          );
        }),
      }))
      .filter((group) => group.permissions.length > 0);
  }, [search, moduleFilter]);

  const overrideCount = Object.keys(overrides).length;
  const grantCount = Object.values(overrides).filter((effect) => effect === 'grant').length;
  const denyCount = Object.values(overrides).filter((effect) => effect === 'deny').length;

  const effectiveCount = useMemo(() => {
    let count = 0;
    for (const group of PERMISSION_GROUPS) {
      for (const permission of group.permissions) {
        const inherited = inheritedKeys.has(permission.key);
        const override = overrides[permission.key];
        if (effectiveFromState(rowState(permission.key, inherited, override))) count += 1;
      }
    }
    return count;
  }, [inheritedKeys, overrides]);

  return (
    <div className="space-y-3">
      <HudPanel elevation={1}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <HudBadge variant="outline" size="sm">{effectiveCount} efetivas</HudBadge>
            <HudStatusPill variant="active" size="sm">Herdadas: {inheritedKeys.size}</HudStatusPill>
            {grantCount > 0 && <HudStatusPill variant="info" size="sm">Grants: {grantCount}</HudStatusPill>}
            {denyCount > 0 && <HudStatusPill variant="error" size="sm">Denies: {denyCount}</HudStatusPill>}
            {overrideCount === 0 && <span className="text-ig-fg-subtle">Sem overrides — usando defaults da role.</span>}
          </div>
          {onReset && overrideCount > 0 && (
            <HudButton
              variant="ghost"
              size="sm"
              onClick={onReset}
              disabled={disabled}
              leftIcon={<RotateCcw className="h-3.5 w-3.5" />}
            >
              Resetar para defaults
            </HudButton>
          )}
        </div>
      </HudPanel>

      <div className="grid gap-2 md:grid-cols-[1fr_220px]">
        <HudInput
          placeholder="Buscar permissão (ex: finance, projects.create, dre)…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <select
          value={moduleFilter}
          onChange={(event) => setModuleFilter(event.target.value)}
          className="rounded-md border border-ig-border-strong bg-ig-panel/60 px-2 py-1.5 text-sm text-ig-fg-strong focus:border-ig-border-focus focus:outline-none"
        >
          <option value="all">Todos os módulos</option>
          {PERMISSION_GROUPS.map((group) => (
            <option key={group.module} value={group.module}>{group.label}</option>
          ))}
        </select>
      </div>

      {filteredGroups.length === 0 && (
        <p className="rounded-md border border-ig-border-subtle bg-ig-panel/40 p-3 text-xs text-ig-fg-subtle">
          Nenhuma permissão corresponde à busca.
        </p>
      )}

      <div className="space-y-3">
        {filteredGroups.map((group) => (
          <div key={group.module} className="rounded-lg border border-ig-border-subtle bg-ig-panel/40">
            <div className="flex items-center justify-between border-b border-ig-border-subtle px-3 py-2">
              <p className="text-xs font-semibold uppercase tracking-wider text-ig-fg-strong">{group.label}</p>
              <HudBadge variant="outline" size="sm">{group.permissions.length}</HudBadge>
            </div>
            <ul className="divide-y divide-ig-border-subtle">
              {group.permissions.map((permission) => {
                const inherited = inheritedKeys.has(permission.key);
                const override = overrides[permission.key];
                const state = rowState(permission.key, inherited, override);
                const isCritical = CRITICAL_KEYS.has(permission.key);
                return (
                  <li key={permission.key} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-sm text-ig-fg-strong">{permission.label}</span>
                        {isCritical && (
                          <HudStatusPill variant="critical" size="sm">
                            <span className="inline-flex items-center gap-1">
                              <ShieldAlert className="h-3 w-3" /> Crítica
                            </span>
                          </HudStatusPill>
                        )}
                      </div>
                      <p className="text-[11px] font-mono text-ig-fg-subtle">{permission.key}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <HudStatusPill variant={STATE_VARIANT[state]} size="sm">{STATE_LABEL[state]}</HudStatusPill>
                      <button
                        type="button"
                        onClick={() => onOverrideChange(permission.key, override === 'grant' ? null : 'grant')}
                        disabled={disabled || (inherited && override !== 'grant' && override !== 'deny')}
                        title={inherited ? 'Já herdada da role' : 'Conceder manualmente'}
                        className={`rounded-md border px-2 py-1 text-xs transition ${
                          override === 'grant'
                            ? 'border-ig-info bg-ig-info/15 text-ig-info'
                            : inherited
                              ? 'cursor-not-allowed border-ig-border-subtle text-ig-fg-subtle opacity-50'
                              : 'border-ig-border-subtle text-ig-fg-muted hover:border-ig-info hover:text-ig-info'
                        } ${disabled ? 'cursor-not-allowed opacity-50' : ''}`}
                      >
                        <PlusCircle className="inline h-3 w-3" /> Grant
                      </button>
                      <button
                        type="button"
                        onClick={() => onOverrideChange(permission.key, override === 'deny' ? null : 'deny')}
                        disabled={disabled}
                        title={inherited ? 'Negar (anula a role)' : 'Bloquear explicitamente'}
                        className={`rounded-md border px-2 py-1 text-xs transition ${
                          override === 'deny'
                            ? 'border-ig-danger bg-ig-danger/10 text-ig-danger'
                            : 'border-ig-border-subtle text-ig-fg-muted hover:border-ig-danger hover:text-ig-danger'
                        } ${disabled ? 'cursor-not-allowed opacity-50' : ''}`}
                      >
                        <MinusCircle className="inline h-3 w-3" /> Deny
                      </button>
                      {override && (
                        <button
                          type="button"
                          onClick={() => onOverrideChange(permission.key, null)}
                          disabled={disabled}
                          title="Limpar override (voltar ao default da role)"
                          className="rounded-md border border-ig-border-subtle px-2 py-1 text-xs text-ig-fg-muted transition hover:border-ig-fg-strong hover:text-ig-fg-strong disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      )}
                      {!override && state === 'inherited' && (
                        <span className="rounded-md border border-ig-success/40 bg-ig-success/10 px-1.5 py-1 text-[10px] text-ig-success">
                          <Check className="inline h-3 w-3" />
                        </span>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}
