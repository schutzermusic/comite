'use client';

/**
 * Geofences — cercas por canteiro/projeto (Fase 4, diferencial D5).
 * Globo 3D (Cesium, como o Insight Operations) para visualizar/posicionar,
 * campo de endereço com geocodificação e prefill de coordenada do projeto
 * quando existir. Configura o centro + raio usados pela validação de ponto
 * no app mobile (/api/mobile/punch). Cerca por OBRA, não por empresa.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Crosshair, MapPin, MapPinned, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import {
  HudBadge,
  HudButton,
  HudEmptyState,
  HudHeader,
  HudInput,
  HudModal,
  HudPageLayout,
  HudPanel,
  HudSelect,
  HudStatusPill,
  HudTable,
  useHudToast,
  type HudTableColumn,
} from '@/components/hud';
import { usePermissions } from '@/hooks/use-permissions';
import type { ProjectGeofence } from '@/lib/types/people';
import {
  createGeofence,
  deleteGeofence,
  geocodeAddress,
  listGeofences,
  updateGeofence,
  type GeofenceInput,
} from '@/lib/services/geofence';
import { getProjectsAsync, getProjectV2ByIdAsync } from '@/lib/services/projects';
import { GeofenceGlobe } from '@/components/workforce/GeofenceGlobe';

export default function GeofencesPage() {
  const { hasPermission } = usePermissions();
  const { notify } = useHudToast();
  const canManage = hasPermission('people.geofence_manage');

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [geofences, setGeofences] = useState<ProjectGeofence[]>([]);
  const [projects, setProjects] = useState<Array<{ id: string; label: string }>>([]);
  const [projectFilter, setProjectFilter] = useState('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<ProjectGeofence | null>(null);
  const [pickMode, setPickMode] = useState(false);
  const [pickedCoords, setPickedCoords] = useState<{ lat: number; lng: number } | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [gf, projs] = await Promise.all([listGeofences(), getProjectsAsync().catch(() => [])]);
      setGeofences(gf);
      setProjects(projs.map((p) => ({ id: p.id, label: p.codigo || p.nome || p.id })));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao carregar geofences');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const projectName = useMemo(() => new Map(projects.map((p) => [p.id, p.label])), [projects]);
  const filtered = useMemo(
    () => (projectFilter === 'all' ? geofences : geofences.filter((g) => g.projectId === projectFilter)),
    [geofences, projectFilter],
  );

  function openCreate() {
    setEditing(null);
    setPickedCoords(null);
    setModalOpen(true);
  }

  async function handleDelete(g: ProjectGeofence) {
    if (!window.confirm(`Remover a cerca "${g.name}"?`)) return;
    try {
      await deleteGeofence(g.id);
      notify('Cerca removida', { variant: 'success' });
      await reload();
    } catch (e) {
      notify('Erro ao remover', { description: e instanceof Error ? e.message : undefined, variant: 'error' });
    }
  }

  const columns: HudTableColumn<ProjectGeofence>[] = [
    {
      key: 'name',
      header: 'Cerca',
      cell: (g) => (
        <div className="flex items-center gap-2">
          <MapPin className="h-4 w-4 text-ig-accent" />
          <div>
            <p className="text-sm font-medium text-ig-fg-strong">{g.name}</p>
            <p className="text-xs text-ig-fg-muted">{projectName.get(g.projectId) ?? g.projectId}</p>
          </div>
        </div>
      ),
    },
    {
      key: 'coords',
      header: 'Centro (lat, lng)',
      cell: (g) => (
        <span className="font-mono text-xs tabular-nums text-ig-fg-muted">
          {g.centerLat.toFixed(5)}, {g.centerLng.toFixed(5)}
        </span>
      ),
    },
    {
      key: 'municipality',
      header: 'Município operacional',
      cell: (g) => g.municipalityCode && g.municipalityVerifiedAt ? (
        <div>
          <p className="text-sm text-ig-fg-strong">{g.municipalityName} - {g.stateCode}</p>
          <p className="font-mono text-[11px] text-ig-fg-muted">IBGE {g.municipalityCode} - validado</p>
        </div>
      ) : <HudBadge variant="warning">Município pendente</HudBadge>,
    },
    {
      key: 'radius',
      header: 'Raio',
      align: 'right',
      cell: (g) => <span className="text-sm tabular-nums text-ig-fg-strong">{g.radiusMeters} m</span>,
    },
    {
      key: 'active',
      header: 'Status',
      cell: (g) => (
        <HudStatusPill variant={g.active ? 'active' : 'neutral'} size="sm">
          {g.active ? 'Ativa' : 'Inativa'}
        </HudStatusPill>
      ),
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      cell: (g) =>
        canManage ? (
          <div className="flex items-center justify-end gap-1">
            <button
              type="button"
              title="Editar"
              className="rounded-md p-1.5 text-ig-fg-muted transition-colors hover:bg-ig-panel-hover hover:text-ig-fg-strong"
              onClick={() => {
                setEditing(g);
                setPickedCoords(null);
                setModalOpen(true);
              }}
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              title="Remover"
              className="rounded-md p-1.5 text-ig-fg-muted transition-colors hover:bg-ig-panel-hover hover:text-ig-danger"
              onClick={() => void handleDelete(g)}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : null,
    },
  ];

  return (
    <HudPageLayout>
      <div className="space-y-6">
        <HudHeader
          title="Geofences (cercas por canteiro)"
          subtitle="Áreas autorizadas para registro de ponto no app de campo — por obra, não por empresa"
          icon={<MapPin className="h-5 w-5" />}
          breadcrumbs={[{ label: 'Pessoas & Custos', href: '/workforce-cost' }, { label: 'Geofences' }]}
          actions={
            canManage ? (
              <div className="flex items-center gap-2">
                <HudButton
                  variant={pickMode ? 'primary' : 'secondary'}
                  leftIcon={<MapPinned className="h-4 w-4" />}
                  onClick={() => setPickMode((v) => !v)}
                >
                  {pickMode ? 'Clique no globo…' : 'Marcar no globo'}
                </HudButton>
                <HudButton variant="primary" leftIcon={<Plus className="h-4 w-4" />} onClick={openCreate}>
                  Nova cerca
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

        {/* Globo 3D */}
        <HudPanel title="Mapa das cercas" accentColor="emerald" className="p-0">
          <div className="h-[420px] w-full">
            <GeofenceGlobe
              geofences={filtered}
              selectedId={selectedId}
              pickMode={pickMode && canManage}
              onSelect={(g) => setSelectedId(g.id)}
              onPick={(lat, lng) => {
                setPickMode(false);
                setEditing(null);
                setPickedCoords({ lat, lng });
                setModalOpen(true);
              }}
            />
          </div>
        </HudPanel>

        {/* Tabela */}
        <HudPanel>
          <div className="mb-4 w-72">
            <HudSelect
              label="Projeto"
              value={projectFilter}
              onChange={setProjectFilter}
              options={[
                { value: 'all', label: 'Todos os projetos' },
                ...projects.map((p) => ({ value: p.id, label: p.label })),
              ]}
            />
          </div>
          <HudTable<ProjectGeofence>
            columns={columns}
            data={filtered}
            keyExtractor={(g) => g.id}
            loading={loading}
            onRowClick={(g) => setSelectedId(g.id)}
            selectedRowId={selectedId}
            emptyState={
              <HudEmptyState
                icon="inbox"
                title="Nenhuma cerca cadastrada"
                description="Defina o centro e o raio de cada canteiro para validar o ponto por localização no app."
                action={canManage ? { label: 'Nova cerca', onClick: openCreate } : undefined}
              />
            }
          />
        </HudPanel>
      </div>

      <GeofenceModal
        open={modalOpen}
        editing={editing}
        projects={projects}
        prefillCoords={pickedCoords}
        onClose={() => setModalOpen(false)}
        onSaved={async () => {
          setModalOpen(false);
          await reload();
        }}
      />
    </HudPageLayout>
  );
}

function GeofenceModal({
  open,
  editing,
  projects,
  prefillCoords,
  onClose,
  onSaved,
}: {
  open: boolean;
  editing: ProjectGeofence | null;
  projects: Array<{ id: string; label: string }>;
  prefillCoords: { lat: number; lng: number } | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const { notify } = useHudToast();
  const [projectId, setProjectId] = useState('');
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [lat, setLat] = useState('');
  const [lng, setLng] = useState('');
  const [radius, setRadius] = useState('200');
  const [tolerance, setTolerance] = useState('50');
  const [active, setActive] = useState(true);
  const [municipalityCode, setMunicipalityCode] = useState('');
  const [municipalityName, setMunicipalityName] = useState('');
  const [stateCode, setStateCode] = useState('');
  const [verifyMunicipality, setVerifyMunicipality] = useState(false);
  const [saving, setSaving] = useState(false);
  const [locating, setLocating] = useState(false);
  const [geocoding, setGeocoding] = useState(false);
  const [resolvedLabel, setResolvedLabel] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setProjectId(editing?.projectId ?? projects[0]?.id ?? '');
    setName(editing?.name ?? '');
    setAddress('');
    setResolvedLabel(null);
    setLat(editing ? String(editing.centerLat) : prefillCoords ? prefillCoords.lat.toFixed(6) : '');
    setLng(editing ? String(editing.centerLng) : prefillCoords ? prefillCoords.lng.toFixed(6) : '');
    setRadius(String(editing?.radiusMeters ?? 200));
    setTolerance(String(editing?.accuracyToleranceMeters ?? 50));
    setActive(editing?.active ?? true);
    setMunicipalityCode(editing?.municipalityCode ?? '');
    setMunicipalityName(editing?.municipalityName ?? '');
    setStateCode(editing?.stateCode ?? '');
    setVerifyMunicipality(Boolean(editing?.municipalityVerifiedAt));
  }, [open, editing, projects, prefillCoords]);

  /** Prefill center from the project's stored coordinate, when it has one. */
  async function prefillFromProject(pid: string) {
    setProjectId(pid);
    if (editing) return; // don't override an existing fence
    try {
      const v2 = await getProjectV2ByIdAsync(pid);
      const loc = v2?.location;
      if (loc && typeof loc.lat === 'number' && typeof loc.lng === 'number') {
        setLat(loc.lat.toFixed(6));
        setLng(loc.lng.toFixed(6));
        setResolvedLabel(`Coordenada do projeto${loc.city ? ` · ${loc.city}` : ''}`);
        notify('Centro pré-preenchido pela coordenada do projeto', { variant: 'success' });
      }
    } catch {
      /* projeto sem coordenada — segue manual/endereço */
    }
  }

  async function handleGeocode() {
    if (!address.trim()) return notify('Digite um endereço', { variant: 'warning' });
    setGeocoding(true);
    try {
      const r = await geocodeAddress(address);
      if (!r) {
        notify('Endereço não encontrado', { variant: 'warning' });
        return;
      }
      setLat(r.lat.toFixed(6));
      setLng(r.lng.toFixed(6));
      setResolvedLabel(r.label);
      notify('Endereço localizado', { variant: 'success' });
    } catch (e) {
      notify('Erro ao buscar endereço', { description: e instanceof Error ? e.message : undefined, variant: 'error' });
    } finally {
      setGeocoding(false);
    }
  }

  function useCurrentLocation() {
    if (!('geolocation' in navigator)) return notify('Geolocalização indisponível', { variant: 'warning' });
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLat(pos.coords.latitude.toFixed(6));
        setLng(pos.coords.longitude.toFixed(6));
        setResolvedLabel('Localização atual do dispositivo');
        setLocating(false);
        notify('Localização capturada', { variant: 'success' });
      },
      (err) => {
        setLocating(false);
        notify('Não foi possível obter a localização', { description: err.message, variant: 'error' });
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }

  async function handleSave() {
    const latN = Number(lat);
    const lngN = Number(lng);
    const radiusN = Number(radius);
    if (!projectId) return notify('Selecione o projeto', { variant: 'warning' });
    if (!name.trim()) return notify('Informe o nome da cerca', { variant: 'warning' });
    if (!Number.isFinite(latN) || latN < -90 || latN > 90) return notify('Latitude inválida — use endereço, globo ou localização', { variant: 'warning' });
    if (!Number.isFinite(lngN) || lngN < -180 || lngN > 180) return notify('Longitude inválida', { variant: 'warning' });
    if (!Number.isFinite(radiusN) || radiusN <= 0) return notify('Raio inválido', { variant: 'warning' });
    if (municipalityCode && !/^\d{7}$/.test(municipalityCode)) return notify('Código IBGE deve ter 7 dígitos', { variant: 'warning' });
    if (verifyMunicipality && (!municipalityCode || !municipalityName.trim() || !/^[A-Za-z]{2}$/.test(stateCode))) {
      return notify('Preencha código IBGE, município e UF para validar', { variant: 'warning' });
    }

    setSaving(true);
    try {
      const input: GeofenceInput = {
        projectId,
        name: name.trim(),
        centerLat: latN,
        centerLng: lngN,
        radiusMeters: Math.round(radiusN),
        accuracyToleranceMeters: Math.round(Number(tolerance) || 50),
        active,
        municipalityCode: municipalityCode || null,
        municipalityName: municipalityName.trim() || null,
        stateCode: stateCode.toUpperCase() || null,
        municipalitySource: municipalityCode ? 'manual' : null,
        verifyMunicipality,
      };
      if (editing) await updateGeofence(editing.id, input);
      else await createGeofence(input);
      notify(editing ? 'Cerca atualizada' : 'Cerca criada', { variant: 'success' });
      await onSaved();
    } catch (e) {
      notify('Erro ao salvar cerca', { description: e instanceof Error ? e.message : undefined, variant: 'error' });
    } finally {
      setSaving(false);
    }
  }

  const hasCenter = Boolean(lat && lng);

  return (
    <HudModal
      isOpen={open}
      onClose={onClose}
      title={editing ? 'Editar cerca' : 'Nova cerca'}
      subtitle="Endereço ou coordenada + raio da área autorizada"
      size="lg"
      footer={
        <div className="flex justify-end gap-2">
          <HudButton variant="ghost" onClick={onClose}>Cancelar</HudButton>
          <HudButton variant="primary" onClick={() => void handleSave()} disabled={saving}>
            {saving ? 'Salvando…' : 'Salvar'}
          </HudButton>
        </div>
      }
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <HudSelect
          label="Projeto / canteiro"
          value={projectId}
          onChange={(v) => void prefillFromProject(v)}
          options={projects.map((p) => ({ value: p.id, label: p.label }))}
        />
        <HudInput label="Nome da cerca" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Canteiro UHE X" />
      </div>

      {/* Endereço → geocodificação */}
      <div className="mt-4 rounded-lg border border-ig-border-subtle bg-ig-panel/50 p-3">
        <p className="mb-2 text-xs font-medium uppercase tracking-wider text-ig-fg-muted">Definir centro por endereço</p>
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <HudInput
              label="Endereço"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="Ex.: Rodovia BR-040 km 20, Belo Horizonte MG"
            />
          </div>
          <HudButton variant="secondary" leftIcon={<Search className="h-4 w-4" />} onClick={() => void handleGeocode()} disabled={geocoding}>
            {geocoding ? 'Buscando…' : 'Buscar'}
          </HudButton>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <HudButton variant="ghost" size="sm" leftIcon={<Crosshair className="h-4 w-4" />} onClick={useCurrentLocation} disabled={locating}>
            {locating ? 'Localizando…' : 'Usar minha localização'}
          </HudButton>
          <span className="text-[11px] text-ig-fg-muted">
            ou selecione o projeto (se tiver coordenada) ou clique no globo.
          </span>
        </div>
        {resolvedLabel && (
          <p className="mt-2 line-clamp-1 text-xs text-ig-accent" title={resolvedLabel}>
            📍 {resolvedLabel}
          </p>
        )}
      </div>

      {/* Coordenada + raio */}
      <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <HudInput label="Latitude" value={lat} onChange={(e) => setLat(e.target.value)} placeholder="-19.92450" />
        <HudInput label="Longitude" value={lng} onChange={(e) => setLng(e.target.value)} placeholder="-43.93520" />
        <HudInput label="Raio (m)" type="number" min={1} value={radius} onChange={(e) => setRadius(e.target.value)} />
        <HudInput label="Tolerância (m)" type="number" min={0} value={tolerance} onChange={(e) => setTolerance(e.target.value)} />
      </div>

      <div className="mt-4 rounded-lg border border-ig-border-subtle bg-ig-panel/50 p-3">
        <p className="mb-3 text-xs font-medium uppercase tracking-wider text-ig-fg-muted">Município do local operacional</p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <HudInput label="Código IBGE" value={municipalityCode} onChange={(e) => setMunicipalityCode(e.target.value.replace(/\D/g, '').slice(0, 7))} placeholder="4113700" />
          <HudInput label="Município" value={municipalityName} onChange={(e) => setMunicipalityName(e.target.value)} placeholder="Londrina" />
          <HudInput label="UF" value={stateCode} onChange={(e) => setStateCode(e.target.value.toUpperCase().slice(0, 2))} placeholder="PR" />
        </div>
        <label className="mt-3 flex items-center gap-2 text-sm text-ig-fg-muted">
          <input type="checkbox" checked={verifyMunicipality} onChange={(e) => setVerifyMunicipality(e.target.checked)} className="h-4 w-4 accent-[var(--ig-accent)]" />
          Dados municipais conferidos para elegibilidade automática
        </label>
      </div>

      <div className="mt-4 flex items-center justify-between">
        <label className="flex items-center gap-2 text-sm text-ig-fg-muted">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className="h-4 w-4 accent-[var(--ig-accent)]" />
          Cerca ativa
        </label>
        {hasCenter ? (
          <HudBadge variant="info">ponto validado por raio + tolerância + GPS do aparelho</HudBadge>
        ) : (
          <HudBadge variant="warning">defina o centro (endereço, projeto, localização ou globo)</HudBadge>
        )}
      </div>
    </HudModal>
  );
}
