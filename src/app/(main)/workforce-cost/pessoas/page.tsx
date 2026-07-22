'use client';

/**
 * Pessoas — canonical people registry (migration 038). Shows origin
 * (folha / login / manual), supports CRUD (people.manage) and manual
 * profile linking to resolve payroll-name homonyms.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Ban, CheckCircle2, Copy, Home, KeyRound, Link2, Pencil, Plus, RotateCcw, Send, Trash2, Users, XCircle } from 'lucide-react';
import {
  HudBadge,
  HudButton,
  HudEmptyState,
  HudHeader,
  HudInput,
  HudKpiStrip,
  HudModal,
  HudPageLayout,
  HudPanel,
  HudSelect,
  HudStatusPill,
  HudTable,
  useHudToast,
  type HudTableColumn,
  type KpiItem,
} from '@/components/hud';
import { usePermissions } from '@/hooks/use-permissions';
import type { Person, PersonResidenceMunicipality, ResidenceMunicipalitySource } from '@/lib/types/people';
import { CONTRACT_TYPE_LABELS } from '@/lib/types/people';
import {
  createPerson,
  deletePerson,
  listPeople,
  listUnlinkedProfiles,
  updatePerson,
  type PersonInput,
} from '@/lib/services/people';
import {
  createResidenceMunicipality,
  listResidenceMunicipalities,
} from '@/lib/services/residence-municipalities';
import { listPontoAccess, runPontoAccessAction } from '@/lib/ponto/access-client';
import {
  PONTO_ACCESS_LABELS,
  allowedActions,
  type PontoAccessAction,
  type PontoAccessInfo,
  type PontoAccessStatus,
} from '@/lib/ponto/access-types';

const SOURCE_LABELS: Record<Person['source'], string> = {
  payroll_import: 'Folha',
  profile: 'Login',
  manual: 'Manual',
};

const ACCESS_PILL: Record<PontoAccessStatus, 'neutral' | 'pending' | 'active' | 'warning' | 'error'> = {
  no_access: 'neutral',
  pending: 'pending',
  active: 'active',
  expired: 'warning',
  blocked: 'error',
};

const ACCESS_ACTION_META: Record<PontoAccessAction, { label: string; icon: typeof Send; danger?: boolean }> = {
  invite: { label: 'Enviar convite', icon: Send },
  resend: { label: 'Reenviar convite', icon: RotateCcw },
  copy_link: { label: 'Copiar link de ativação', icon: Copy },
  block: { label: 'Bloquear acesso', icon: Ban, danger: true },
  reactivate: { label: 'Reativar acesso', icon: CheckCircle2 },
  revoke: { label: 'Revogar convite', icon: XCircle, danger: true },
};

export default function PessoasPage() {
  const { hasPermission } = usePermissions();
  const { notify } = useHudToast();
  const canManage = hasPermission('people.manage');
  const canValidateResidence = hasPermission('allowances.residence_validate');

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('active');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Person | null>(null);
  const [residences, setResidences] = useState<PersonResidenceMunicipality[]>([]);
  const [residencePerson, setResidencePerson] = useState<Person | null>(null);
  const [accessMap, setAccessMap] = useState<Map<string, PontoAccessInfo>>(new Map());
  const [accessPerson, setAccessPerson] = useState<Person | null>(null);

  const reloadAccess = useCallback(async () => {
    if (!canManage) return setAccessMap(new Map());
    try {
      setAccessMap(await listPontoAccess());
    } catch {
      setAccessMap(new Map());
    }
  }, [canManage]);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [peopleRows, residenceRows] = await Promise.all([
        listPeople({ status: 'all' }),
        listResidenceMunicipalities().catch(() => []),
        reloadAccess(),
      ]);
      setPeople(peopleRows);
      setResidences(residenceRows);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao carregar pessoas');
    } finally {
      setLoading(false);
    }
  }, [reloadAccess]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const filtered = useMemo(
    () =>
      people.filter((p) => {
        if (statusFilter !== 'all' && p.status !== statusFilter) return false;
        if (search && !p.fullName.toLowerCase().includes(search.toLowerCase())) return false;
        return true;
      }),
    [people, search, statusFilter],
  );

  const kpis: KpiItem[] = useMemo(
    () => [
      { id: 'total', label: 'Pessoas', value: people.length, icon: <Users className="h-4 w-4" /> },
      { id: 'active', label: 'Ativas', value: people.filter((p) => p.status === 'active').length, variant: 'success' },
      { id: 'payroll', label: 'Origem folha', value: people.filter((p) => p.source === 'payroll_import').length },
      {
        id: 'linked',
        label: 'Com login vinculado',
        value: people.filter((p) => p.profileId).length,
        icon: <Link2 className="h-4 w-4" />,
      },
    ],
    [people],
  );

  const columns: HudTableColumn<Person>[] = [
    {
      key: 'name',
      header: 'Colaborador',
      cell: (p) => (
        <div>
          <p className="text-sm font-medium text-ig-fg-strong">{p.fullName}</p>
          <p className="text-xs text-ig-fg-muted">{p.email ?? '—'}</p>
        </div>
      ),
    },
    {
      key: 'job',
      header: 'Cargo / Área',
      cell: (p) => (
        <div>
          <p className="text-sm text-ig-fg-strong">{p.jobTitle ?? '—'}</p>
          <p className="text-xs text-ig-fg-muted">{p.department ?? '—'}</p>
        </div>
      ),
    },
    {
      key: 'contract',
      header: 'Vínculo',
      cell: (p) => (
        <span className="text-sm text-ig-fg-muted">
          {p.contractType ? CONTRACT_TYPE_LABELS[p.contractType] : '—'}
        </span>
      ),
    },
    {
      key: 'hours',
      header: 'Jornada',
      align: 'right',
      cell: (p) => (
        <span className="text-sm tabular-nums text-ig-fg-muted">{p.weeklyHours}h/sem</span>
      ),
    },
    {
      key: 'source',
      header: 'Origem',
      cell: (p) => (
        <div className="flex items-center gap-1.5">
          <HudBadge variant={p.source === 'payroll_import' ? 'info' : 'neutral'}>
            {SOURCE_LABELS[p.source]}
          </HudBadge>
          {p.profileId && (
            <span title="Login vinculado">
              <Link2 className="h-3.5 w-3.5 text-ig-success" />
            </span>
          )}
        </div>
      ),
    },
    {
      key: 'residence',
      header: 'Município residencial',
      cell: (p) => {
        const r = residences.find((item) => item.personId === p.id && item.status === 'validated');
        return r ? (
          <div>
            <p className="text-sm text-ig-fg-strong">{r.municipalityName} - {r.stateCode}</p>
            <p className="font-mono text-[11px] text-ig-fg-muted">IBGE {r.municipalityCode}</p>
          </div>
        ) : <HudBadge variant="warning">Não validado</HudBadge>;
      },
    },
    {
      key: 'status',
      header: 'Status',
      cell: (p) => (
        <HudStatusPill variant={p.status === 'active' ? 'active' : 'neutral'} size="sm">
          {p.status === 'active' ? 'Ativa' : 'Inativa'}
        </HudStatusPill>
      ),
    },
    {
      key: 'ponto_access',
      header: 'Acesso Ponto',
      cell: (p) => {
        const info = accessMap.get(p.id);
        const status = info?.status ?? 'no_access';
        return (
          <HudStatusPill variant={ACCESS_PILL[status]} size="sm">
            {PONTO_ACCESS_LABELS[status]}
          </HudStatusPill>
        );
      },
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      cell: (p) =>
        (canManage || canValidateResidence) ? (
          <div className="flex items-center justify-end gap-1">
            {canValidateResidence && (
              <button
                type="button"
                title="Validar município residencial"
                className="rounded-md p-1.5 text-ig-fg-muted transition-colors hover:bg-ig-panel-hover hover:text-ig-accent"
                onClick={() => setResidencePerson(p)}
              >
                <Home className="h-3.5 w-3.5" />
              </button>
            )}
            {canManage && <>
              <button
                type="button"
                title="Acesso ao Ponto"
                className="rounded-md p-1.5 text-ig-fg-muted transition-colors hover:bg-ig-panel-hover hover:text-ig-accent"
                onClick={() => setAccessPerson(p)}
              >
                <KeyRound className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                title="Editar"
                className="rounded-md p-1.5 text-ig-fg-muted transition-colors hover:bg-ig-panel-hover hover:text-ig-fg-strong"
                onClick={() => {
                  setEditing(p);
                  setModalOpen(true);
                }}
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                title="Excluir"
                className="rounded-md p-1.5 text-ig-fg-muted transition-colors hover:bg-ig-panel-hover hover:text-ig-danger"
                onClick={() => void handleDelete(p)}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </>}
          </div>
        ) : null,
    },
  ];

  async function handleDelete(person: Person) {
    if (
      !window.confirm(
        `Excluir ${person.fullName}? Alocações e apontamentos vinculados serão removidos. Prefira inativar quando houver histórico.`,
      )
    )
      return;
    try {
      await deletePerson(person.id);
      notify('Pessoa removida', { variant: 'success' });
      await reload();
    } catch (e) {
      notify('Erro ao remover pessoa', {
        description: e instanceof Error ? e.message : undefined,
        variant: 'error',
      });
    }
  }

  return (
    <HudPageLayout>
      <div className="space-y-6">
        <HudHeader
          title="Pessoas"
          subtitle="Cadastro canônico de colaboradores — base de alocação, capacidade e apontamento"
          icon={<Users className="h-5 w-5" />}
          breadcrumbs={[{ label: 'Pessoas & Custos', href: '/workforce-cost' }, { label: 'Pessoas' }]}
          actions={
            canManage ? (
              <HudButton
                variant="primary"
                leftIcon={<Plus className="h-4 w-4" />}
                onClick={() => {
                  setEditing(null);
                  setModalOpen(true);
                }}
              >
                Nova pessoa
              </HudButton>
            ) : undefined
          }
        />

        {error && (
          <HudPanel state="critical">
            <p className="text-sm text-ig-danger">{error}</p>
          </HudPanel>
        )}

        <HudKpiStrip kpis={kpis} columns={4} />

        <HudPanel>
          <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <HudInput
              label="Buscar"
              placeholder="Nome…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <HudSelect
              label="Status"
              value={statusFilter}
              onChange={setStatusFilter}
              options={[
                { value: 'active', label: 'Ativas' },
                { value: 'inactive', label: 'Inativas' },
                { value: 'all', label: 'Todas' },
              ]}
            />
          </div>
          <HudTable<Person>
            columns={columns}
            data={filtered}
            keyExtractor={(p) => p.id}
            loading={loading}
            emptyState={
              <HudEmptyState
                icon="inbox"
                title="Nenhuma pessoa cadastrada"
                description="Pessoas são criadas automaticamente pelo fechamento da folha (backfill) ou manualmente aqui."
                action={
                  canManage
                    ? {
                        label: 'Nova pessoa',
                        onClick: () => {
                          setEditing(null);
                          setModalOpen(true);
                        },
                      }
                    : undefined
                }
              />
            }
          />
        </HudPanel>
      </div>

      <PersonModal
        open={modalOpen}
        editing={editing}
        onClose={() => setModalOpen(false)}
        onSaved={async () => {
          setModalOpen(false);
          await reload();
        }}
      />
      <ResidenceMunicipalityModal
        person={residencePerson}
        current={residencePerson
          ? residences.find((r) => r.personId === residencePerson.id && r.status === 'validated') ?? null
          : null}
        onClose={() => setResidencePerson(null)}
        onSaved={async () => {
          setResidencePerson(null);
          await reload();
        }}
      />
      <PontoAccessModal
        person={accessPerson}
        info={accessPerson ? accessMap.get(accessPerson.id) ?? null : null}
        onClose={() => setAccessPerson(null)}
        onChanged={reloadAccess}
      />
    </HudPageLayout>
  );
}

/* ─────────────────────── PontoAccessModal ─────────────────────────── */

function PontoAccessModal({
  person,
  info,
  onClose,
  onChanged,
}: {
  person: Person | null;
  info: PontoAccessInfo | null;
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const { notify } = useHudToast();
  const [busy, setBusy] = useState<PontoAccessAction | null>(null);
  const [status, setStatus] = useState<PontoAccessStatus>('no_access');
  const [copiedLink, setCopiedLink] = useState<string | null>(null);

  useEffect(() => {
    setStatus(info?.status ?? 'no_access');
    setCopiedLink(null);
  }, [info, person]);

  if (!person) return null;

  const hasEmail = !!person.email?.trim();
  const actions = allowedActions(status);

  async function run(action: PontoAccessAction) {
    if (!person) return;
    if (action === 'revoke' && !window.confirm(`Revogar o convite de ${person.fullName}? A conta pendente será removida.`)) return;
    if (action === 'block' && !window.confirm(`Bloquear o acesso de ${person.fullName} ao Ponto?`)) return;
    setBusy(action);
    setCopiedLink(null);
    try {
      const res = await runPontoAccessAction(person.id, action);
      setStatus(res.status);
      if (action === 'copy_link' && res.activationLink) {
        try {
          await navigator.clipboard.writeText(res.activationLink);
          notify('Link de ativação copiado', { variant: 'success' });
        } catch {
          setCopiedLink(res.activationLink); // clipboard bloqueado — mostra para copiar manualmente
        }
      } else {
        notify(res.message, { variant: 'success' });
      }
      await onChanged();
    } catch (e) {
      notify('Falha na ação de acesso', { description: e instanceof Error ? e.message : undefined, variant: 'error' });
    } finally {
      setBusy(null);
    }
  }

  return (
    <HudModal
      isOpen
      onClose={onClose}
      title="Acesso ao app de Ponto"
      subtitle={person.fullName}
      footer={<div className="flex justify-end"><HudButton variant="ghost" onClick={onClose}>Fechar</HudButton></div>}
    >
      <div className="space-y-4">
        <div className="flex items-center justify-between rounded-lg border border-ig-border-subtle bg-ig-panel/50 px-4 py-3">
          <div>
            <p className="text-xs text-ig-fg-muted">Status atual</p>
            <p className="text-sm text-ig-fg-strong">{person.email ?? 'sem e-mail cadastrado'}</p>
          </div>
          <HudStatusPill variant={ACCESS_PILL[status]} size="md">{PONTO_ACCESS_LABELS[status]}</HudStatusPill>
        </div>

        {!hasEmail && (
          <p className="rounded-lg bg-ig-panel-hover px-4 py-3 text-xs text-ig-warning">
            Cadastre um e-mail para esta pessoa (em Editar) antes de enviar o convite.
          </p>
        )}

        <div className="space-y-2">
          {actions.map((action) => {
            const meta = ACCESS_ACTION_META[action];
            const Icon = meta.icon;
            const disabled = busy !== null || ((action === 'invite' || action === 'resend' || action === 'copy_link') && !hasEmail);
            return (
              <HudButton
                key={action}
                variant={meta.danger ? 'danger' : action === 'invite' || action === 'resend' ? 'primary' : 'secondary'}
                fullWidth
                disabled={disabled}
                isLoading={busy === action}
                leftIcon={<Icon className="h-4 w-4" />}
                onClick={() => void run(action)}
              >
                {meta.label}
              </HudButton>
            );
          })}
        </div>

        {copiedLink && (
          <div className="space-y-1.5 rounded-lg border border-ig-border-subtle bg-ig-panel/50 p-3">
            <p className="text-[11px] text-ig-fg-muted">Copie o link de ativação (uso único, expira):</p>
            <p className="break-all font-mono text-[11px] text-ig-fg-strong">{copiedLink}</p>
          </div>
        )}

        <p className="text-[11px] text-ig-fg-subtle">
          O colaborador recebe um link seguro de uso único para criar a senha. Nenhuma senha é enviada por e-mail.
        </p>
      </div>
    </HudModal>
  );
}

function ResidenceMunicipalityModal({
  person,
  current,
  onClose,
  onSaved,
}: {
  person: Person | null;
  current: PersonResidenceMunicipality | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const { notify } = useHudToast();
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [uf, setUf] = useState('');
  const [validFrom, setValidFrom] = useState(new Date().toISOString().slice(0, 10));
  const [source, setSource] = useState<ResidenceMunicipalitySource>('hr_registration');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!person) return;
    setCode(current?.municipalityCode ?? '');
    setName(current?.municipalityName ?? '');
    setUf(current?.stateCode ?? '');
    setValidFrom(current?.validFrom ?? new Date().toISOString().slice(0, 10));
    setSource(current?.source ?? 'hr_registration');
  }, [person, current]);

  if (!person) return null;

  async function save() {
    if (!/^\d{7}$/.test(code)) return notify('Código IBGE deve ter 7 dígitos', { variant: 'warning' });
    if (!name.trim() || !/^[A-Za-z]{2}$/.test(uf)) return notify('Informe município e UF', { variant: 'warning' });
    setSaving(true);
    try {
      await createResidenceMunicipality({
        personId: person!.id,
        municipalityCode: code,
        municipalityName: name,
        stateCode: uf,
        validFrom,
        source,
        status: 'validated',
        validationMetadata: { method: 'hr_manual_validation' },
      });
      notify('Município residencial validado', { variant: 'success' });
      await onSaved();
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Erro ao validar residência', { variant: 'error' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <HudModal
      isOpen
      onClose={onClose}
      title="Validar município residencial"
      subtitle={`${person.fullName} - somente município, sem endereço completo`}
      footer={<div className="flex justify-end gap-2"><HudButton variant="ghost" onClick={onClose}>Cancelar</HudButton><HudButton variant="primary" disabled={saving} onClick={() => void save()}>{saving ? 'Salvando…' : 'Validar'}</HudButton></div>}
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <HudInput label="Código IBGE" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 7))} placeholder="4113700" />
        <HudInput label="Município" value={name} onChange={(e) => setName(e.target.value)} placeholder="Londrina" />
        <HudInput label="UF" value={uf} onChange={(e) => setUf(e.target.value.toUpperCase().slice(0, 2))} placeholder="PR" />
        <HudInput label="Válido desde" type="date" value={validFrom} onChange={(e) => setValidFrom(e.target.value)} />
        <HudSelect label="Fonte" value={source} onChange={(v) => setSource(v as ResidenceMunicipalitySource)} options={[
          { value: 'hr_registration', label: 'Cadastro de RH' },
          { value: 'employee_declaration', label: 'Declaração do colaborador' },
          { value: 'manual_adjustment', label: 'Ajuste manual' },
          { value: 'migration', label: 'Migração' },
        ]} />
      </div>
    </HudModal>
  );
}

/* ─────────────────────── PersonModal ─────────────────────────── */

function PersonModal({
  open,
  editing,
  onClose,
  onSaved,
}: {
  open: boolean;
  editing: Person | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const { notify } = useHudToast();
  const [fullName, setFullName] = useState('');
  const [cpf, setCpf] = useState('');
  const [email, setEmail] = useState('');
  const [jobTitle, setJobTitle] = useState('');
  const [department, setDepartment] = useState('');
  const [contractType, setContractType] = useState('clt');
  const [weeklyHours, setWeeklyHours] = useState('40');
  const [status, setStatus] = useState('active');
  const [profileId, setProfileId] = useState('');
  const [profiles, setProfiles] = useState<Array<{ id: string; fullName: string | null }>>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setFullName(editing?.fullName ?? '');
    setCpf(editing?.cpf ?? '');
    setEmail(editing?.email ?? '');
    setJobTitle(editing?.jobTitle ?? '');
    setDepartment(editing?.department ?? '');
    setContractType(editing?.contractType ?? 'clt');
    setWeeklyHours(String(editing?.weeklyHours ?? 40));
    setStatus(editing?.status ?? 'active');
    setProfileId(editing?.profileId ?? '');
    void listUnlinkedProfiles()
      .then(setProfiles)
      .catch(() => setProfiles([]));
  }, [open, editing]);

  async function handleSave() {
    if (!fullName.trim()) {
      notify('Informe o nome completo', { variant: 'warning' });
      return;
    }
    const hours = Number(weeklyHours);
    if (!Number.isFinite(hours) || hours <= 0 || hours > 84) {
      notify('Jornada semanal deve estar entre 1 e 84 horas', { variant: 'warning' });
      return;
    }
    setSaving(true);
    try {
      const input: PersonInput = {
        fullName: fullName.trim(),
        cpf: cpf.trim() || null,
        email: email.trim() || null,
        jobTitle: jobTitle.trim() || null,
        department: department.trim() || null,
        contractType: contractType as PersonInput['contractType'],
        weeklyHours: hours,
        status: status as PersonInput['status'],
        profileId: profileId || null,
      };
      if (editing) await updatePerson(editing.id, input);
      else await createPerson(input);
      notify(editing ? 'Pessoa atualizada' : 'Pessoa criada', { variant: 'success' });
      await onSaved();
    } catch (e) {
      notify('Erro ao salvar pessoa', {
        description: e instanceof Error ? e.message : undefined,
        variant: 'error',
      });
    } finally {
      setSaving(false);
    }
  }

  const profileOptions = [
    { value: '', label: 'Sem vínculo de login' },
    ...(editing?.profileId
      ? [{ value: editing.profileId, label: 'Vínculo atual (manter)' }]
      : []),
    ...profiles.map((p) => ({ value: p.id, label: p.fullName ?? p.id })),
  ];

  return (
    <HudModal
      isOpen={open}
      onClose={onClose}
      title={editing ? 'Editar pessoa' : 'Nova pessoa'}
      subtitle="Identidade organizacional canônica"
      size="lg"
      footer={
        <div className="flex justify-end gap-2">
          <HudButton variant="ghost" onClick={onClose}>
            Cancelar
          </HudButton>
          <HudButton variant="primary" onClick={() => void handleSave()} disabled={saving}>
            {saving ? 'Salvando…' : 'Salvar'}
          </HudButton>
        </div>
      }
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <HudInput label="Nome completo" value={fullName} onChange={(e) => setFullName(e.target.value)} />
        <HudInput label="CPF (só dígitos)" value={cpf} onChange={(e) => setCpf(e.target.value)} placeholder="00000000000" />
        <HudInput label="E-mail" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <HudInput label="Cargo" value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} />
        <HudInput label="Área / Departamento" value={department} onChange={(e) => setDepartment(e.target.value)} />
        <HudSelect
          label="Vínculo"
          value={contractType}
          onChange={setContractType}
          options={Object.entries(CONTRACT_TYPE_LABELS).map(([value, label]) => ({ value, label }))}
        />
        <HudInput
          label="Jornada semanal (h)"
          type="number"
          min={1}
          max={84}
          value={weeklyHours}
          onChange={(e) => setWeeklyHours(e.target.value)}
        />
        <HudSelect
          label="Status"
          value={status}
          onChange={setStatus}
          options={[
            { value: 'active', label: 'Ativa' },
            { value: 'inactive', label: 'Inativa' },
          ]}
        />
        <HudSelect
          label="Login vinculado"
          value={profileId}
          onChange={setProfileId}
          options={profileOptions}
        />
      </div>
      <p className="mt-3 text-[11px] text-ig-fg-muted">
        O vínculo de login permite que a pessoa aponte as próprias horas e veja suas alocações.
      </p>
    </HudModal>
  );
}
