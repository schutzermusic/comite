'use client';

import { useEffect, useMemo, useState } from 'react';
import { ScrollText } from 'lucide-react';
import {
  HudBadge,
  HudEmptyState,
  HudFilterBar,
  HudHeader,
  HudKpiStrip,
  HudPageLayout,
  HudPanel,
  HudTable,
  type FilterGroup,
  type HudTableColumn,
  type KpiItem,
} from '@/components/hud';
import { AccessRestrictedState } from '@/components/auth/AccessRestrictedState';
import { hasPermission } from '@/lib/auth/permissions';
import { useCurrentUser } from '@/hooks/use-current-user';
import { createClient } from '@/utils/supabase/client';

type AuditLog = {
  id: string;
  organization_id: string | null;
  actor_user_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  metadata: Record<string, unknown>;
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
};

export default function AdminAuditPage() {
  const { organization, permissions, loading: authLoading } = useCurrentUser();
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [search, setSearch] = useState('');
  const [entityFilter, setEntityFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const canViewAudit = hasPermission(permissions, 'audit.view');

  useEffect(() => {
    const load = async () => {
      if (!organization?.id || !canViewAudit) return;
      setLoading(true);
      const { data } = await createClient()
        .from('audit_logs')
        .select('id,organization_id,actor_user_id,action,entity_type,entity_id,metadata,ip_address,user_agent,created_at')
        .eq('organization_id', organization.id)
        .order('created_at', { ascending: false })
        .limit(200)
        .returns<AuditLog[]>();
      setLogs(data ?? []);
      setLoading(false);
    };

    if (!authLoading) void load();
  }, [authLoading, canViewAudit, organization?.id]);

  const entityOptions = useMemo(() => {
    const values = Array.from(new Set(logs.map((log) => log.entity_type))).sort();
    return [{ value: 'all', label: 'Todos' }, ...values.map((value) => ({ value, label: value }))];
  }, [logs]);

  const filteredLogs = useMemo(() => {
    const term = search.toLowerCase();
    return logs.filter((log) => {
      const entityMatch = entityFilter === 'all' || log.entity_type === entityFilter;
      const searchMatch = [log.action, log.entity_type, log.actor_user_id, log.entity_id]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(term));
      return entityMatch && searchMatch;
    });
  }, [entityFilter, logs, search]);

  const filterGroups: FilterGroup[] = [
    { id: 'entity', label: 'Entidade', value: entityFilter, onChange: setEntityFilter, options: entityOptions },
  ];

  const columns: HudTableColumn<AuditLog>[] = [
    {
      key: 'created_at',
      header: 'Data',
      width: '180px',
      cell: (log) => new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(log.created_at)),
    },
    {
      key: 'action',
      header: 'Acao',
      cell: (log) => (
        <div>
          <p className="font-medium text-ig-fg-strong">{log.action}</p>
          <p className="text-xs text-ig-fg-subtle">{log.actor_user_id || 'system'}</p>
        </div>
      ),
    },
    { key: 'entity_type', header: 'Entidade', width: '150px', cell: (log) => <HudBadge variant="outline">{log.entity_type}</HudBadge> },
    {
      key: 'metadata',
      header: 'Metadata',
      cell: (log) => (
        <button type="button" className="text-sm text-ig-accent hover:underline" onClick={() => setExpandedId(expandedId === log.id ? null : log.id)}>
          {expandedId === log.id ? 'Ocultar' : 'Ver metadata'}
        </button>
      ),
    },
  ];

  // KPIs clicáveis (padrão Contratos): "Eventos"/"Atores" limpam o recorte;
  // "Entidades" volta o filtro de entidade para Todos.
  const kpis: KpiItem[] = [
    { id: 'logs', label: 'Eventos', value: logs.length, variant: 'info', icon: <ScrollText className="h-5 w-5" />, onClick: () => { setSearch(''); setEntityFilter('all'); } },
    { id: 'users', label: 'Atores', value: new Set(logs.map((log) => log.actor_user_id).filter(Boolean)).size, variant: 'success', icon: <ScrollText className="h-5 w-5" />, onClick: () => setSearch('') },
    { id: 'entities', label: 'Entidades', value: entityOptions.length - 1, variant: 'warning', icon: <ScrollText className="h-5 w-5" />, onClick: () => setEntityFilter('all') },
  ];

  if (!authLoading && !canViewAudit) {
    return <HudPageLayout><AccessRestrictedState /></HudPageLayout>;
  }

  const expandedLog = logs.find((log) => log.id === expandedId);

  return (
    <HudPageLayout>
      <HudHeader
        title="Admin / Audit"
        subtitle="Trilha de auditoria para acoes criticas de seguranca e governanca."
        icon={<ScrollText size={18} />}
        iconTint="#64748B"
      />
      <HudKpiStrip kpis={kpis} columns={3} />
      <HudFilterBar
        searchPlaceholder="Buscar por acao, ator ou entidade"
        searchValue={search}
        onSearchChange={setSearch}
        filterGroups={filterGroups}
        onClearFilters={() => {
          setSearch('');
          setEntityFilter('all');
        }}
      />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(20rem,0.8fr)]">
        <HudPanel elevation={2}>
          <HudTable
            columns={columns}
            data={filteredLogs}
            keyExtractor={(log) => log.id}
            loading={loading || authLoading}
            emptyState={<HudEmptyState title="Sem eventos de auditoria" description="Acoes administrativas registradas aparecerao aqui." />}
          />
        </HudPanel>
        <HudPanel elevation={2} title="Metadata">
          {expandedLog ? (
            <pre className="max-h-[32rem] overflow-auto rounded-lg border border-ig-border-subtle bg-ig-bg-canvas/60 p-4 text-xs text-ig-fg-strong">
              {JSON.stringify(expandedLog.metadata ?? {}, null, 2)}
            </pre>
          ) : (
            <HudEmptyState title="Selecione um evento" description="Use Ver metadata em uma linha da tabela." />
          )}
        </HudPanel>
      </div>
    </HudPageLayout>
  );
}
