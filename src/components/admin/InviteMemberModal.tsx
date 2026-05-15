'use client';

import { useMemo, useState } from 'react';
import { AlertTriangle, ArrowLeft, ArrowRight, Lock, Mail, Send } from 'lucide-react';
import {
  HudBadge,
  HudButton,
  HudInput,
  HudModal,
  HudPanel,
  HudSelect,
  HudStatusPill,
} from '@/components/hud';
import { PERMISSION_GROUPS } from '@/lib/auth/permissions';
import type { Role } from '@/lib/auth/types';
import { AccessCustomizer, type OverrideMap } from '@/components/admin/AccessCustomizer';

const OWNER_ROLE_KEY = 'owner_admin';

type InvitePayload = {
  email: string;
  full_name: string;
  department: string | null;
  job_title: string | null;
  notes: string | null;
  status: 'active' | 'inactive';
  role_ids: string[];
  confirm_owner_admin: boolean;
  overrides: Array<{ permission_key: string; effect: 'grant' | 'deny' }>;
};

type InviteMemberModalProps = {
  isOpen: boolean;
  onClose: () => void;
  roles: Role[];
  permsByRole: Map<string, string[]>;
  onSubmit: (payload: InvitePayload) => Promise<{ ok: boolean; error?: string; code?: string }>;
};

type Step = 1 | 2 | 3 | 4;

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

const STATUS_OPTIONS = [
  { value: 'active', label: 'Ativo' },
  { value: 'inactive', label: 'Inativo' },
];

export function InviteMemberModal({
  isOpen,
  onClose,
  roles,
  permsByRole,
  onSubmit,
}: InviteMemberModalProps) {
  const [step, setStep] = useState<Step>(1);
  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [department, setDepartment] = useState('');
  const [jobTitle, setJobTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [status, setStatus] = useState<'active' | 'inactive'>('active');
  const [selectedRoleIds, setSelectedRoleIds] = useState<string[]>([]);
  const [confirmOwner, setConfirmOwner] = useState(false);
  const [overrides, setOverrides] = useState<OverrideMap>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Wizard state resets via a `key` on the parent component (each open is a
  // fresh mount), avoiding setState-in-effect for the reset.

  const ownerRole = useMemo(() => roles.find((role) => role.key === OWNER_ROLE_KEY), [roles]);
  const nonOwnerRoles = useMemo(
    () => roles.filter((role) => role.key !== OWNER_ROLE_KEY),
    [roles],
  );

  const ownerSelected = ownerRole ? selectedRoleIds.includes(ownerRole.id) : false;

  const inheritedKeys = useMemo(() => {
    const set = new Set<string>();
    for (const id of selectedRoleIds) {
      for (const key of permsByRole.get(id) ?? []) set.add(key);
    }
    return set;
  }, [selectedRoleIds, permsByRole]);

  const effectivePermissions = useMemo(() => {
    const set = new Set(inheritedKeys);
    for (const [key, effect] of Object.entries(overrides)) {
      if (effect === 'grant') set.add(key);
      else if (effect === 'deny') set.delete(key);
    }
    return set;
  }, [inheritedKeys, overrides]);

  const grantList = useMemo(
    () => Object.entries(overrides).filter(([, effect]) => effect === 'grant').map(([key]) => key),
    [overrides],
  );
  const denyList = useMemo(
    () => Object.entries(overrides).filter(([, effect]) => effect === 'deny').map(([key]) => key),
    [overrides],
  );

  const selectedRoles = useMemo(
    () => roles.filter((role) => selectedRoleIds.includes(role.id)),
    [roles, selectedRoleIds],
  );

  const step1Valid = isValidEmail(email) && fullName.trim().length > 0;
  const step2Valid = selectedRoleIds.length > 0 && (!ownerSelected || confirmOwner);

  const toggleRole = (roleId: string) => {
    setSelectedRoleIds((previous) =>
      previous.includes(roleId)
        ? previous.filter((id) => id !== roleId)
        : [...previous, roleId],
    );
    setError(null);
  };

  const goNext = () => {
    setError(null);
    if (step === 1 && step1Valid) setStep(2);
    else if (step === 2 && step2Valid) setStep(3);
    else if (step === 3) setStep(4);
  };

  const goBack = () => {
    setError(null);
    if (step === 2) setStep(1);
    else if (step === 3) setStep(2);
    else if (step === 4) setStep(3);
  };

  const handleSend = async () => {
    if (!step1Valid || !step2Valid) return;
    setSubmitting(true);
    setError(null);
    const result = await onSubmit({
      email: email.trim().toLowerCase(),
      full_name: fullName.trim(),
      department: department.trim() || null,
      job_title: jobTitle.trim() || null,
      notes: notes.trim() || null,
      status,
      role_ids: selectedRoleIds,
      confirm_owner_admin: ownerSelected && confirmOwner,
      overrides: Object.entries(overrides).map(([permission_key, effect]) => ({ permission_key, effect })),
    });
    setSubmitting(false);
    if (!result.ok) {
      setError(result.error ?? 'Falha ao enviar convite.');
      return;
    }
    onClose();
  };

  const stepLabel =
    step === 1 ? 'Detalhes do membro'
    : step === 2 ? 'Selecionar roles'
    : step === 3 ? 'Personalizar acesso'
    : 'Pré-visualizar & enviar';

  return (
    <HudModal
      isOpen={isOpen}
      onClose={onClose}
      title="Convidar novo membro"
      subtitle={`Etapa ${step} de 4 — ${stepLabel}`}
      size="xl"
      footer={
        <div className="flex w-full items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-xs text-ig-fg-subtle">
            {[1, 2, 3, 4].map((dot) => (
              <span
                key={dot}
                className={`inline-block h-1.5 w-1.5 rounded-full ${step >= dot ? 'bg-ig-accent' : 'bg-ig-border-strong'}`}
              />
            ))}
          </div>
          <div className="flex items-center gap-2">
            <HudButton variant="ghost" size="sm" onClick={onClose} disabled={submitting}>
              Cancelar
            </HudButton>
            {step > 1 && (
              <HudButton variant="secondary" size="sm" onClick={goBack} disabled={submitting} leftIcon={<ArrowLeft className="h-3.5 w-3.5" />}>
                Voltar
              </HudButton>
            )}
            {step < 4 && (
              <HudButton
                variant="primary"
                size="sm"
                onClick={goNext}
                disabled={(step === 1 && !step1Valid) || (step === 2 && !step2Valid)}
                rightIcon={<ArrowRight className="h-3.5 w-3.5" />}
              >
                Avançar
              </HudButton>
            )}
            {step === 4 && (
              <HudButton
                variant="primary"
                size="sm"
                onClick={handleSend}
                disabled={submitting || !step1Valid || !step2Valid}
                leftIcon={<Send className="h-3.5 w-3.5" />}
              >
                {submitting ? 'Enviando…' : 'Enviar convite'}
              </HudButton>
            )}
          </div>
        </div>
      }
    >
      <div className="space-y-4">
        {error && (
          <div className="rounded-md border border-ig-danger/40 p-3 text-sm text-ig-danger">{error}</div>
        )}

        {step === 1 && (
          <div className="grid gap-4 md:grid-cols-2">
            <HudInput
              label="Nome completo"
              value={fullName}
              onChange={(event) => setFullName(event.target.value)}
              placeholder="Maria Silva"
              autoFocus
            />
            <HudInput
              label="E-mail"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="maria@empresa.com"
            />
            <HudInput
              label="Departamento"
              value={department}
              onChange={(event) => setDepartment(event.target.value)}
              placeholder="Financeiro"
            />
            <HudInput
              label="Cargo"
              value={jobTitle}
              onChange={(event) => setJobTitle(event.target.value)}
              placeholder="Gerente Financeiro"
            />
            <HudSelect
              label="Status inicial"
              value={status}
              onChange={(value) => setStatus(value as 'active' | 'inactive')}
              options={STATUS_OPTIONS}
            />
            <div className="md:col-span-2">
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-ig-fg-muted">
                Notas (opcional)
              </label>
              <textarea
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                rows={3}
                className="w-full rounded-md border border-ig-border-strong bg-ig-panel/40 p-2 text-sm text-ig-fg-strong focus:border-ig-border-focus focus:outline-none"
                placeholder="Contexto adicional sobre o convite — visível no audit log."
              />
            </div>
            <p className="md:col-span-2 text-xs text-ig-fg-subtle">
              <Mail className="mr-1 inline h-3 w-3" />
              O convite será enviado pelo provedor de e-mail do Supabase. Verifique a configuração se nada chegar à caixa de entrada.
            </p>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <p className="text-sm text-ig-fg-muted">
              Selecione uma ou mais roles. Cada role concede um conjunto de permissões — você verá o acesso efetivo na próxima etapa.
            </p>

            <div className="grid gap-2 md:grid-cols-2">
              {nonOwnerRoles.map((role) => {
                const selected = selectedRoleIds.includes(role.id);
                const permCount = (permsByRole.get(role.id) ?? []).length;
                return (
                  <button
                    key={role.id}
                    type="button"
                    onClick={() => toggleRole(role.id)}
                    className={`rounded-lg border p-3 text-left transition ${
                      selected
                        ? 'border-ig-accent bg-ig-accent-weak/40'
                        : 'border-ig-border-subtle bg-ig-panel/40 hover:border-ig-border-focus'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-sm font-semibold text-ig-fg-strong">{role.name}</p>
                        <p className="text-[11px] text-ig-fg-subtle">{role.key}</p>
                      </div>
                      <HudBadge variant="outline" size="sm">{permCount} perms</HudBadge>
                    </div>
                    {role.description && (
                      <p className="mt-2 text-xs text-ig-fg-muted">{role.description}</p>
                    )}
                    {role.is_system_role && (
                      <HudStatusPill variant="warning" size="sm" className="mt-2">Sistema</HudStatusPill>
                    )}
                  </button>
                );
              })}
            </div>

            {ownerRole && (
              <div className="rounded-lg border border-ig-danger/40 bg-ig-danger/5 p-3">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-ig-danger" />
                  <div className="flex-1">
                    <p className="text-sm font-semibold text-ig-fg-strong">Role crítica: {ownerRole.name}</p>
                    <p className="mt-1 text-xs text-ig-fg-muted">
                      Concede acesso total à plataforma, incluindo gerenciamento de usuários, roles e integrações.
                      Atribua somente quando estritamente necessário.
                    </p>
                    <label className="mt-3 inline-flex cursor-pointer items-center gap-2 text-xs text-ig-fg-strong">
                      <input
                        type="checkbox"
                        checked={ownerSelected}
                        onChange={() => toggleRole(ownerRole.id)}
                        className="h-3.5 w-3.5 accent-ig-danger"
                      />
                      Atribuir <strong>{ownerRole.key}</strong> a este convite
                    </label>
                    {ownerSelected && (
                      <label className="mt-2 flex cursor-pointer items-center gap-2 text-xs text-ig-danger">
                        <input
                          type="checkbox"
                          checked={confirmOwner}
                          onChange={(event) => setConfirmOwner(event.target.checked)}
                          className="h-3.5 w-3.5 accent-ig-danger"
                        />
                        <Lock className="h-3 w-3" />
                        Confirmo a atribuição de owner_admin (requerido pelo servidor)
                      </label>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {step === 3 && (
          <div className="space-y-3">
            <p className="text-sm text-ig-fg-muted">
              Permissões herdadas das roles selecionadas vêm pré-marcadas. Use <strong>Grant</strong> para
              conceder permissões adicionais ou <strong>Deny</strong> para bloquear permissões específicas.
              Denies sempre vencem grants — incluindo as herdadas das roles.
            </p>
            <AccessCustomizer
              inheritedKeys={inheritedKeys}
              overrides={overrides}
              onOverrideChange={(key, effect) => {
                setError(null);
                setOverrides((previous) => {
                  const next = { ...previous };
                  if (effect === null) delete next[key];
                  else next[key] = effect;
                  return next;
                });
              }}
              onReset={() => {
                setOverrides({});
                setError(null);
              }}
            />
          </div>
        )}

        {step === 4 && (
          <div className="space-y-4">
            <HudPanel elevation={1} title="Resumo do convite">
              <div className="grid gap-2 text-sm md:grid-cols-2">
                <div><span className="text-ig-fg-subtle">Nome:</span> <span className="text-ig-fg-strong">{fullName}</span></div>
                <div><span className="text-ig-fg-subtle">E-mail:</span> <span className="text-ig-fg-strong">{email}</span></div>
                {department && <div><span className="text-ig-fg-subtle">Departamento:</span> <span className="text-ig-fg-strong">{department}</span></div>}
                {jobTitle && <div><span className="text-ig-fg-subtle">Cargo:</span> <span className="text-ig-fg-strong">{jobTitle}</span></div>}
                <div><span className="text-ig-fg-subtle">Status:</span> <span className="text-ig-fg-strong">{status}</span></div>
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {selectedRoles.map((role) => (
                  <HudBadge key={role.id} variant={role.key === OWNER_ROLE_KEY ? 'outline' : 'outline'} size="sm">
                    {role.key === OWNER_ROLE_KEY && <Lock className="mr-1 inline h-3 w-3 text-ig-danger" />}
                    {role.name}
                  </HudBadge>
                ))}
              </div>
              {notes && (
                <div className="mt-3 rounded-md border border-ig-border-subtle bg-ig-panel/40 p-2 text-xs text-ig-fg-muted">
                  <strong className="text-ig-fg-strong">Notas:</strong> {notes}
                </div>
              )}
              {(grantList.length > 0 || denyList.length > 0) && (
                <div className="mt-3 grid gap-2 md:grid-cols-2">
                  {grantList.length > 0 && (
                    <div className="rounded-md border border-ig-info/40 bg-ig-info/5 p-2 text-xs">
                      <p className="font-semibold text-ig-info">Grants manuais ({grantList.length})</p>
                      <p className="mt-1 break-all text-ig-fg-muted">{grantList.join(', ')}</p>
                    </div>
                  )}
                  {denyList.length > 0 && (
                    <div className="rounded-md border border-ig-danger/40 bg-ig-danger/5 p-2 text-xs">
                      <p className="font-semibold text-ig-danger">Denies manuais ({denyList.length})</p>
                      <p className="mt-1 break-all text-ig-fg-muted">{denyList.join(', ')}</p>
                    </div>
                  )}
                </div>
              )}
            </HudPanel>

            <HudPanel
              elevation={1}
              title={`Acesso efetivo (${effectivePermissions.size} permissões)`}
            >
              {effectivePermissions.size === 0 ? (
                <p className="text-xs text-ig-fg-subtle">Sem permissões — selecione ao menos uma role.</p>
              ) : (
                <div className="grid gap-3 md:grid-cols-2">
                  {PERMISSION_GROUPS.map((group) => {
                    const granted = group.permissions.filter((permission) =>
                      effectivePermissions.has(permission.key),
                    );
                    if (granted.length === 0) return null;
                    return (
                      <div
                        key={group.module}
                        className="rounded-md border border-ig-border-subtle bg-ig-panel/40 p-3"
                      >
                        <div className="mb-2 flex items-center justify-between">
                          <p className="text-xs font-semibold text-ig-fg-strong">{group.label}</p>
                          <HudBadge variant="outline" size="sm">
                            {granted.length}/{group.permissions.length}
                          </HudBadge>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {granted.map((permission) => (
                            <HudStatusPill key={permission.key} variant="active" size="sm">
                              {permission.label}
                            </HudStatusPill>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
              <p className="mt-3 text-[11px] leading-snug text-ig-fg-subtle">
                Computado a partir das roles selecionadas. O usuário poderá ter o conjunto de permissões alterado depois pelo painel de Roles.
              </p>
            </HudPanel>
          </div>
        )}
      </div>
    </HudModal>
  );
}
