'use client';

/**
 * Pessoas — canonical people registry (migration 038). Shows origin
 * (folha / login / manual), supports CRUD (people.manage) and manual
 * profile linking to resolve payroll-name homonyms.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Ban, CheckCircle2, Copy, Eye, Home, KeyRound, Link2, Pencil, Plus, RotateCcw, Send, Trash2, Users, XCircle } from 'lucide-react';
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
  deletePersonHistory,
  inactivatePerson,
  listPeople,
  listUnlinkedProfiles,
  updatePerson,
  type PersonInput,
} from '@/lib/services/people';
import {
  createResidenceMunicipality,
  listResidenceMunicipalities,
} from '@/lib/services/residence-municipalities';
import { batchInvitePonto, confirmRolloutSend, listPontoAccess, previewProvisioning, runPontoAccessAction } from '@/lib/ponto/access-client';
import { PersonProfileDrawer } from '@/components/workforce/PersonProfileDrawer';
import type { PersonSalaryHistory, SalaryHistoryResult } from '@/lib/workforce/salary-history';
import type { PontoPreviewItem, PontoPreviewTotals } from '@/lib/ponto/access-types';
import {
  PONTO_ACCESS_LABELS,
  PONTO_BUCKET_LABELS,
  allowedActions,
  bucketOf,
  type PontoAccessAction,
  type PontoAccessBucket,
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

const BUCKET_PILL: Record<PontoAccessBucket, 'neutral' | 'pending' | 'active' | 'warning' | 'error' | 'info'> = {
  no_access: 'neutral',
  pending: 'pending',
  expiring: 'info',
  expired: 'warning',
  active: 'active',
  blocked: 'error',
  provision_failed: 'error',
};

const BUCKET_ORDER: PontoAccessBucket[] = [
  'no_access', 'pending', 'expiring', 'expired', 'active', 'blocked', 'provision_failed',
];

const ACCESS_ACTION_META: Record<PontoAccessAction, { label: string; icon: typeof Send; danger?: boolean }> = {
  invite: { label: 'Enviar convite', icon: Send },
  resend: { label: 'Reenviar convite', icon: RotateCcw },
  copy_link: { label: 'Copiar link de ativação', icon: Copy },
  block: { label: 'Bloquear acesso', icon: Ban, danger: true },
  reactivate: { label: 'Reativar acesso', icon: CheckCircle2 },
  revoke: { label: 'Revogar convite', icon: XCircle, danger: true },
};

export default function PessoasPage() {
  const { hasPermission, roles } = usePermissions();
  const { notify } = useHudToast();
  const canManage = hasPermission('people.manage');
  const isOwnerAdmin = roles.some((role) => role.key === 'owner_admin');
  const canValidateResidence = hasPermission('allowances.residence_validate');

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('active');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Person | null>(null);
  /** Ficha do colaborador — leitura, separada do modal de edição. */
  const [profilePerson, setProfilePerson] = useState<Person | null>(null);
  const [salaryByPerson, setSalaryByPerson] = useState<Record<string, PersonSalaryHistory>>({});
  const [salaryBlocked, setSalaryBlocked] = useState<string | undefined>(undefined);
  const [residences, setResidences] = useState<PersonResidenceMunicipality[]>([]);
  const [residencePerson, setResidencePerson] = useState<Person | null>(null);
  const [accessMap, setAccessMap] = useState<Map<string, PontoAccessInfo>>(new Map());
  const [accessPerson, setAccessPerson] = useState<Person | null>(null);
  const [batchOpen, setBatchOpen] = useState(false);
  const [rolloutOpen, setRolloutOpen] = useState(false);
  const [accessFilter, setAccessFilter] = useState<PontoAccessBucket | 'all'>('all');
  const [deletingPerson, setDeletingPerson] = useState<Person | null>(null);

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

  /**
   * Série salarial de todo o cadastro, buscada uma vez e indexada por pessoa.
   *
   * Fica no pai, e não dentro da gaveta, porque a rota tem permissão própria:
   * quem não tem `people.view_salary` precisa abrir a ficha normalmente, só sem
   * o bloco de salário — e não encontrar uma gaveta que falha ao abrir.
   */
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch('/api/workforce/salary-history');
        if (cancelled) return;
        if (res.status === 403) {
          setSalaryBlocked('Histórico salarial exige a permissão people.view_salary.');
          return;
        }
        const json = (await res.json()) as { ok: boolean; history?: SalaryHistoryResult };
        if (!json.ok || !json.history) return;
        const byPerson: Record<string, PersonSalaryHistory> = {};
        for (const p of json.history.people) byPerson[p.personId] = p;
        setSalaryByPerson(byPerson);
      } catch {
        // Silêncio proposital: a ficha continua útil sem o bloco salarial.
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const filtered = useMemo(
    () =>
      people.filter((p) => {
        if (statusFilter !== 'all' && p.status !== statusFilter) return false;
        if (search && !p.fullName.toLowerCase().includes(search.toLowerCase())) return false;
        if (accessFilter !== 'all' && bucketOf(accessMap.get(p.id)) !== accessFilter) return false;
        return true;
      }),
    [people, search, statusFilter, accessFilter, accessMap],
  );

  // contagens por balde de acesso ao Ponto (indicadores/filtros)
  const accessCounts = useMemo(() => {
    const counts = {} as Record<PontoAccessBucket, number>;
    for (const b of BUCKET_ORDER) counts[b] = 0;
    for (const p of people) counts[bucketOf(accessMap.get(p.id))] += 1;
    return counts;
  }, [people, accessMap]);

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
                onClick={() => setDeletingPerson(p)}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </>}
          </div>
        ) : null,
    },
  ];

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
              <div className="flex items-center gap-2">
                <HudButton
                  variant="ghost"
                  leftIcon={<Eye className="h-4 w-4" />}
                  onClick={() => setRolloutOpen(true)}
                >
                  Pré-visualizar provisionamento
                </HudButton>
                <HudButton
                  variant="secondary"
                  leftIcon={<Send className="h-4 w-4" />}
                  onClick={() => setBatchOpen(true)}
                >
                  Convite em lote
                </HudButton>
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
              </div>
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
          {canManage && (
            <div className="mb-4 flex flex-wrap items-center gap-1.5">
              <span className="mr-1 text-[11px] font-semibold uppercase tracking-[0.1em] text-ig-fg-subtle">Acesso Ponto:</span>
              <AccessChip label="Todos" count={people.length} active={accessFilter === 'all'} onClick={() => setAccessFilter('all')} />
              {BUCKET_ORDER.filter((b) => accessCounts[b] > 0).map((b) => (
                <AccessChip
                  key={b}
                  label={PONTO_BUCKET_LABELS[b]}
                  count={accessCounts[b]}
                  variant={BUCKET_PILL[b]}
                  active={accessFilter === b}
                  onClick={() => setAccessFilter(accessFilter === b ? 'all' : b)}
                />
              ))}
            </div>
          )}
          <HudTable<Person>
            columns={columns}
            data={filtered}
            keyExtractor={(p) => p.id}
            loading={loading}
            onRowClick={(p) => setProfilePerson(p)}
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
      <BatchInviteModal
        open={batchOpen}
        people={people}
        accessMap={accessMap}
        onClose={() => setBatchOpen(false)}
        onDone={reloadAccess}
      />
      <RolloutPreviewModal
        open={rolloutOpen}
        onClose={() => setRolloutOpen(false)}
        onDone={reloadAccess}
      />
      <PersonProfileDrawer
        person={profilePerson}
        onClose={() => setProfilePerson(null)}
        salary={profilePerson ? salaryByPerson[profilePerson.id] : undefined}
        salaryUnavailableReason={salaryBlocked}
      />
      <DeletePersonModal
        person={deletingPerson}
        canDeleteHistory={isOwnerAdmin}
        onClose={() => setDeletingPerson(null)}
        onDone={async () => {
          setDeletingPerson(null);
          await reload();
        }}
      />
    </HudPageLayout>
  );
}

/* ─────────────────────── Exclusão / inativação ─────────────────────── */

function DeletePersonModal({
  person,
  canDeleteHistory,
  onClose,
  onDone,
}: {
  person: Person | null;
  canDeleteHistory: boolean;
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const { notify } = useHudToast();
  const [confirmation, setConfirmation] = useState('');
  const [submitting, setSubmitting] = useState<'inactivate' | 'delete' | null>(null);

  useEffect(() => {
    if (!person) {
      setConfirmation('');
      setSubmitting(null);
    }
  }, [person]);

  if (!person) return null;
  const targetPerson = person;

  async function inactivate() {
    setSubmitting('inactivate');
    try {
      await inactivatePerson(targetPerson.id);
      notify('Colaborador inativado', {
        description: 'Todo o histórico foi preservado e o colaborador saiu dos fluxos ativos.',
        variant: 'success',
      });
      await onDone();
    } catch (e) {
      notify('Erro ao inativar colaborador', {
        description: e instanceof Error ? e.message : undefined,
        variant: 'error',
      });
    } finally {
      setSubmitting(null);
    }
  }

  async function permanentlyDelete() {
    if (!canDeleteHistory || confirmation !== targetPerson.fullName) return;
    setSubmitting('delete');
    try {
      await deletePersonHistory(targetPerson.id);
      notify('Colaborador e histórico excluídos', {
        description: 'Os registros operacionais vinculados foram removidos definitivamente.',
        variant: 'success',
      });
      await onDone();
    } catch (e) {
      notify('Erro ao excluir colaborador e histórico', {
        description: e instanceof Error ? e.message : undefined,
        variant: 'error',
      });
    } finally {
      setSubmitting(null);
    }
  }

  return (
    <HudModal
      isOpen
      onClose={submitting ? () => undefined : onClose}
      title={`Remover ${person.fullName}`}
      subtitle="Escolha como o cadastro deve ser tratado."
      size="md"
    >
      <div className="space-y-4">
        <div className="rounded-lg border border-ig-border-subtle bg-ig-panel/40 p-4">
          <div className="flex items-start gap-3">
            <Ban className="mt-0.5 h-5 w-5 shrink-0 text-ig-warning" />
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-ig-fg-strong">Apenas inativar</h3>
              <p className="mt-1 text-xs leading-relaxed text-ig-fg-muted">
                Preserva diárias, alocações, apontamentos e custos. O colaborador deixa de aparecer
                nos fluxos ativos e pode ser reativado depois.
              </p>
              <HudButton
                className="mt-3"
                variant="secondary"
                isLoading={submitting === 'inactivate'}
                disabled={submitting !== null}
                onClick={() => void inactivate()}
              >
                Inativar colaborador
              </HudButton>
            </div>
          </div>
        </div>

        {canDeleteHistory ? (
          <div className="rounded-lg border border-[color-mix(in_oklab,var(--ig-danger)_38%,transparent)] bg-[color-mix(in_oklab,var(--ig-danger)_8%,transparent)] p-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-ig-danger" />
              <div className="min-w-0 flex-1">
                <h3 className="text-sm font-semibold text-ig-danger">Excluir todo o histórico</h3>
                <p className="mt-1 text-xs leading-relaxed text-ig-fg-muted">
                  Remove definitivamente o cadastro e o histórico operacional vinculado. Registros
                  fiscais e de auditoria obrigatórios permanecem preservados e desvinculados.
                </p>
                <p className="mt-3 text-xs text-ig-fg-strong">
                  Digite <strong>{person.fullName}</strong> para confirmar:
                </p>
                <HudInput
                  className="mt-2"
                  value={confirmation}
                  onChange={(event) => setConfirmation(event.target.value)}
                  placeholder={person.fullName}
                  autoComplete="off"
                />
                <HudButton
                  className="mt-3"
                  variant="danger"
                  leftIcon={<Trash2 className="h-4 w-4" />}
                  isLoading={submitting === 'delete'}
                  disabled={submitting !== null || confirmation !== person.fullName}
                  onClick={() => void permanentlyDelete()}
                >
                  Excluir colaborador e histórico
                </HudButton>
              </div>
            </div>
          </div>
        ) : (
          <p className="text-xs text-ig-fg-muted">
            A exclusão permanente é exclusiva do perfil Owner / Admin.
          </p>
        )}

        <div className="flex justify-end">
          <HudButton variant="ghost" disabled={submitting !== null} onClick={onClose}>
            Cancelar
          </HudButton>
        </div>
      </div>
    </HudModal>
  );
}

/* ─────────────────────── BatchInviteModal ─────────────────────────── */

function BatchInviteModal({
  open,
  people,
  accessMap,
  onClose,
  onDone,
}: {
  open: boolean;
  people: Person[];
  accessMap: Map<string, PontoAccessInfo>;
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const { notify } = useHudToast();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sending, setSending] = useState(false);

  // Elegíveis: sem acesso / pendente / expirado E com e-mail cadastrado.
  const eligible = useMemo(
    () =>
      people.filter((p) => {
        if (!p.email?.trim()) return false;
        const s = accessMap.get(p.id)?.status ?? 'no_access';
        return s === 'no_access' || s === 'pending' || s === 'expired';
      }),
    [people, accessMap],
  );

  useEffect(() => {
    if (open) setSelected(new Set(eligible.map((p) => p.id)));
  }, [open, eligible]);

  if (!open) return null;

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function send() {
    if (selected.size === 0) return notify('Selecione ao menos uma pessoa', { variant: 'warning' });
    setSending(true);
    try {
      const { summary } = await batchInvitePonto(Array.from(selected));
      notify(`${summary.sent} convite(s) enviado(s)` + (summary.failed ? `, ${summary.failed} falha(s)` : ''), {
        variant: summary.failed ? 'warning' : 'success',
      });
      await onDone();
      onClose();
    } catch (e) {
      notify('Falha no convite em lote', { description: e instanceof Error ? e.message : undefined, variant: 'error' });
    } finally {
      setSending(false);
    }
  }

  return (
    <HudModal
      isOpen={open}
      onClose={onClose}
      title="Convite em lote ao Ponto"
      subtitle="Colaboradores sem acesso, com convite pendente ou expirado (e com e-mail)"
      size="lg"
      footer={
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-ig-fg-muted">{selected.size} de {eligible.length} selecionados</span>
          <div className="flex gap-2">
            <HudButton variant="ghost" onClick={onClose}>Cancelar</HudButton>
            <HudButton variant="primary" isLoading={sending} disabled={selected.size === 0} leftIcon={<Send className="h-4 w-4" />} onClick={() => void send()}>
              Enviar convites
            </HudButton>
          </div>
        </div>
      }
    >
      {eligible.length === 0 ? (
        <p className="py-6 text-center text-sm text-ig-fg-muted">
          Nenhum colaborador elegível. Cadastre e-mail nas pessoas ou verifique se já têm acesso ativo.
        </p>
      ) : (
        <div className="max-h-[52vh] space-y-1 overflow-y-auto">
          {eligible.map((p) => {
            const status = accessMap.get(p.id)?.status ?? 'no_access';
            return (
              <label key={p.id} className="flex cursor-pointer items-center gap-3 rounded-lg border border-ig-border-subtle bg-ig-panel/40 px-3 py-2.5 hover:bg-ig-panel-hover">
                <input type="checkbox" checked={selected.has(p.id)} onChange={() => toggle(p.id)} className="h-4 w-4 accent-ig-accent" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-ig-fg-strong">{p.fullName}</span>
                  <span className="block truncate text-xs text-ig-fg-muted">{p.email}</span>
                </span>
                <HudStatusPill variant={ACCESS_PILL[status]} size="sm">{PONTO_ACCESS_LABELS[status]}</HudStatusPill>
              </label>
            );
          })}
        </div>
      )}
    </HudModal>
  );
}

/* ─────────────────────── Acesso Ponto — helpers ─────────────────────────── */

const PROVISION_SOURCE_LABELS: Record<string, string> = {
  manual: 'Manual',
  allocation: 'Alocação',
  batch: 'Lote',
};
const ACCESS_ERROR_LABELS: Record<string, string> = {
  missing_email: 'E-mail ausente no cadastro',
};

function fmtAccessDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function AccessField({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-[0.08em] text-ig-fg-subtle">{label}</p>
      <p className={`text-xs ${highlight ? 'font-semibold text-ig-warning' : 'text-ig-fg-strong'}`}>{value}</p>
    </div>
  );
}

function AccessChip({
  label,
  count,
  active,
  variant = 'neutral',
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  variant?: 'neutral' | 'pending' | 'active' | 'warning' | 'error' | 'info';
  onClick: () => void;
}) {
  const tone =
    variant === 'error' ? 'text-ig-danger' : variant === 'warning' ? 'text-ig-warning' : variant === 'active' ? 'text-ig-success' : variant === 'info' ? 'text-ig-info' : 'text-ig-fg-muted';
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition-colors ${active ? 'border-ig-border-focus bg-ig-accent-weak text-ig-fg-strong' : 'border-ig-border-subtle bg-ig-panel/40 hover:bg-ig-panel-hover'}`}
    >
      <span className={active ? 'text-ig-fg-strong' : tone}>{label}</span>
      <span className="tabular-nums text-ig-fg-subtle">{count}</span>
    </button>
  );
}

/* ─────────────────────── RolloutPreviewModal ─────────────────────────── */

const PROPOSED_LABELS: Record<string, string> = {
  invite: 'Convidar',
  remind: 'Lembrar',
  skip: 'Ignorar',
  fail: 'Bloqueado',
};

function RolloutPreviewModal({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => Promise<void> }) {
  const { notify } = useHudToast();
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<PontoPreviewItem[]>([]);
  const [totals, setTotals] = useState<PontoPreviewTotals | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { items: rows, totals: t } = await previewProvisioning();
      setItems(rows);
      setTotals(t);
      // pré-seleciona só quem seria efetivamente convidado
      setSelected(new Set(rows.filter((r) => r.proposedAction === 'invite').map((r) => r.personId)));
    } catch (e) {
      notify('Falha ao pré-visualizar', { description: e instanceof Error ? e.message : undefined, variant: 'error' });
    } finally {
      setLoading(false);
    }
  }, [notify]);

  useEffect(() => {
    if (open) void load();
    else {
      setItems([]);
      setTotals(null);
      setSelected(new Set());
    }
  }, [open, load]);

  if (!open) return null;

  const invitable = items.filter((r) => r.proposedAction === 'invite');

  function toggle(id: string) {
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  }

  async function confirmSend() {
    const ids = Array.from(selected);
    if (ids.length === 0) return notify('Selecione ao menos uma pessoa', { variant: 'warning' });
    if (!window.confirm(`Enviar convite de acesso ao Ponto para ${ids.length} colaborador(es)? Cada pessoa é revalidada no servidor antes do envio.`)) return;
    setSending(true);
    try {
      // Caminho de rollout: o servidor REVALIDA cada pessoa antes de enviar.
      const { summary } = await confirmRolloutSend(ids);
      notify(
        `${summary.sent} convite(s) enviado(s)` + (summary.skipped ? `, ${summary.skipped} pulado(s)/revalidado(s)` : ''),
        { variant: summary.skipped ? 'warning' : 'success' },
      );
      await onDone();
      onClose();
    } catch (e) {
      notify('Falha no envio', { description: e instanceof Error ? e.message : undefined, variant: 'error' });
    } finally {
      setSending(false);
    }
  }

  return (
    <HudModal
      isOpen={open}
      onClose={onClose}
      title="Pré-visualizar provisionamento do Ponto"
      subtitle="Dry-run: nada é enviado ao abrir. Revise e confirme para enviar."
      size="lg"
      footer={
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-ig-fg-muted">
            {selected.size} selecionado(s) de {invitable.length} elegível(is)
          </span>
          <div className="flex gap-2">
            <HudButton variant="ghost" onClick={onClose}>Fechar</HudButton>
            <HudButton variant="primary" isLoading={sending} disabled={selected.size === 0} leftIcon={<Send className="h-4 w-4" />} onClick={() => void confirmSend()}>
              Enviar aos selecionados
            </HudButton>
          </div>
        </div>
      }
    >
      {totals && (
        <div className="mb-4 flex flex-wrap gap-2 text-xs">
          <span className="rounded-full bg-ig-panel-hover px-3 py-1">Convidaria: <b className="text-ig-fg-strong">{totals.wouldInvite}</b></span>
          <span className="rounded-full bg-ig-panel-hover px-3 py-1">Lembraria: <b className="text-ig-fg-strong">{totals.wouldRemind}</b></span>
          <span className="rounded-full bg-ig-panel-hover px-3 py-1">Ignoraria: <b className="text-ig-fg-strong">{totals.wouldSkip}</b></span>
          <span className="rounded-full bg-ig-panel-hover px-3 py-1 text-ig-danger">Bloqueado: <b>{totals.wouldFail}</b></span>
        </div>
      )}
      {loading ? (
        <p className="py-6 text-center text-sm text-ig-fg-muted">Calculando prévia…</p>
      ) : items.length === 0 ? (
        <p className="py-6 text-center text-sm text-ig-fg-muted">
          Nenhuma ação prevista. Marque alocações com “Exige registro de ponto” para provisionar.
        </p>
      ) : (
        <div className="max-h-[52vh] space-y-1 overflow-y-auto">
          {items.map((r) => {
            const canSelect = r.proposedAction === 'invite';
            return (
              <div key={r.personId + r.proposedAction} className="flex items-center gap-3 rounded-lg border border-ig-border-subtle bg-ig-panel/40 px-3 py-2.5">
                <input
                  type="checkbox"
                  disabled={!canSelect}
                  checked={selected.has(r.personId)}
                  onChange={() => toggle(r.personId)}
                  className="h-4 w-4 shrink-0 accent-ig-accent disabled:opacity-40"
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-ig-fg-strong">{r.personName}</span>
                  <span className="block truncate text-xs text-ig-fg-muted">
                    {r.email ?? 'sem e-mail'}{r.project ? ` · ${r.project}` : ''} · {r.reason}
                  </span>
                </span>
                <HudBadge variant={r.proposedAction === 'invite' ? 'success' : r.proposedAction === 'remind' ? 'info' : r.proposedAction === 'fail' ? 'danger' : 'neutral'}>
                  {PROPOSED_LABELS[r.proposedAction]}
                </HudBadge>
              </div>
            );
          })}
        </div>
      )}
    </HudModal>
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

        {info?.lastError && (
          <p className="rounded-lg border border-ig-border-subtle bg-[color-mix(in_oklab,var(--ig-danger)_10%,transparent)] px-4 py-3 text-xs text-ig-danger">
            Falha no provisionamento: {ACCESS_ERROR_LABELS[info.lastError] ?? info.lastError}
            {info.lastErrorAt ? ` · ${fmtAccessDate(info.lastErrorAt)}` : ''}
          </p>
        )}

        {info && (info.invitedAt || info.activatedAt || info.reminderCount > 0 || info.provisionSource) && (
          <div className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-lg border border-ig-border-subtle bg-ig-panel/40 px-4 py-3 text-xs">
            <AccessField label="Convite enviado" value={fmtAccessDate(info.invitedAt)} />
            <AccessField label="Expira em" value={info.status === 'pending' ? fmtAccessDate(info.expiresAt) : '—'} highlight={info.expiringSoon} />
            <AccessField label="Último lembrete" value={info.lastReminderAt ? `${fmtAccessDate(info.lastReminderAt)} (${info.reminderCount})` : '—'} />
            <AccessField label="Ativado em" value={fmtAccessDate(info.activatedAt)} />
            <AccessField label="Origem" value={info.provisionSource ? PROVISION_SOURCE_LABELS[info.provisionSource] ?? info.provisionSource : '—'} />
            <AccessField label="Convites enviados" value={String(info.inviteCount)} />
          </div>
        )}

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
