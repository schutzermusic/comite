'use client';

/**
 * Timeline tab container — enterprise schedule cockpit for a project.
 * Loads relational timeline items (migration 032), renders KPIs + the
 * editable Gantt, and hosts the MS Project import wizard and the item
 * detail drawer. Requires Supabase (no demo fallback for these tables).
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { FileUp, Loader2, Plus } from 'lucide-react';
import { HudButton, HudEmptyState, HudKpiStrip, useHudToast } from '@/components/hud';
import { usePermissions } from '@/hooks/use-permissions';
import {
  createTimelineItem,
  isTimelineAvailable,
  listTimelineItems,
} from '@/lib/services/project-timeline';
import { timelineKpis, type GanttZoom } from '@/lib/projects/timeline-analytics';
import type { TimelineItem } from '@/lib/types/project-timeline';
import { GanttView } from './GanttView';
import { ImportWizard } from './ImportWizard';
import { TaskDetailDrawer } from './TaskDetailDrawer';
import { useTimelineStore } from './timeline-store';
import { ExportReportButton } from '@/components/reports/ExportReportButton';
import { openProjectTimelineReport } from '@/lib/reports/modules/project-timeline-report';

const ZOOMS: { value: GanttZoom; label: string }[] = [
  { value: 'day', label: 'Dia' },
  { value: 'week', label: 'Semana' },
  { value: 'month', label: 'Mês' },
];

export interface TimelineTabProps {
  projectId: string;
  projectName: string;
  projectManagerUserId?: string | null;
}

export function TimelineTab({ projectId, projectName, projectManagerUserId }: TimelineTabProps) {
  const { hasPermission } = usePermissions();
  const { notify } = useHudToast();
  const searchParams = useSearchParams();
  const { zoom, setZoom, selectedItemId, selectItem } = useTimelineStore();

  const [items, setItems] = useState<TimelineItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);

  const canImport = hasPermission('projects.timeline.import') || hasPermission('projects.timeline.admin');
  const canEdit = hasPermission('projects.timeline.edit') || hasPermission('projects.timeline.admin');

  const reload = useCallback(async () => {
    if (!isTimelineAvailable()) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setItems(await listTimelineItems(projectId));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao carregar o cronograma.');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // Deep link: /projetos/[id]?tab=timeline&item=<uuid>
  useEffect(() => {
    const itemParam = searchParams?.get('item');
    if (itemParam && items.some((i) => i.id === itemParam)) selectItem(itemParam);
  }, [searchParams, items, selectItem]);

  const kpis = useMemo(() => timelineKpis(items, new Date()), [items]);
  const selectedItem = useMemo(() => items.find((i) => i.id === selectedItemId) ?? null, [items, selectedItemId]);

  // Resolve responsible user ids to names from hydrated assignments (for the PDF report).
  const resolveUserName = useMemo(() => {
    const map = new Map<string, string>();
    items.forEach((i) => (i.assignments ?? []).forEach((a) => { if (a.userId && a.userName) map.set(a.userId, a.userName); }));
    return (userId: string | null) => (userId ? map.get(userId) ?? '—' : '—');
  }, [items]);

  const handleItemChanged = useCallback((updated: TimelineItem) => {
    setItems((prev) => prev.map((i) => (i.id === updated.id ? { ...updated, assignments: updated.assignments ?? i.assignments } : i)));
  }, []);

  const handleAddItem = useCallback(async () => {
    const title = window.prompt('Nome da nova atividade:');
    if (!title?.trim()) return;
    try {
      const created = await createTimelineItem({ projectId, title: title.trim() });
      setItems((prev) => [...prev, created]);
      selectItem(created.id);
    } catch (e) {
      notify('Falha ao criar atividade', { description: e instanceof Error ? e.message : undefined, variant: 'error' });
    }
  }, [projectId, selectItem, notify]);

  if (!isTimelineAvailable()) {
    return (
      <HudEmptyState
        icon="alert"
        title="Cronograma requer conexão Supabase"
        description="O cronograma enterprise usa tabelas relacionais (migrations 032/033). Configure NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_ANON_KEY."
      />
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-16 text-ig-fg-muted">
        <Loader2 className="h-5 w-5 animate-spin" /> Carregando cronograma…
      </div>
    );
  }

  if (error) {
    return <HudEmptyState icon="alert" title="Falha ao carregar o cronograma" description={error} action={{ label: 'Tentar novamente', onClick: () => void reload() }} />;
  }

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1 rounded-lg border border-ig-border p-0.5">
          {ZOOMS.map((z) => (
            <button
              key={z.value}
              type="button"
              onClick={() => setZoom(z.value)}
              className={
                zoom === z.value
                  ? 'rounded-md bg-ig-accent-weak px-2.5 py-1 text-xs font-medium text-ig-accent'
                  : 'rounded-md px-2.5 py-1 text-xs text-ig-fg-muted hover:text-ig-fg'
              }
            >
              {z.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          {items.length > 0 && (
            <ExportReportButton
              size="sm"
              variant="secondary"
              permission="projects.export"
              fallbackPermission="projects.view"
              build={() => openProjectTimelineReport({
                projectName,
                items,
                resolveUserName,
                source: 'Supabase',
              })}
            />
          )}
          {canEdit && (
            <HudButton variant="secondary" size="sm" leftIcon={<Plus className="h-4 w-4" />} onClick={() => void handleAddItem()}>
              Nova atividade
            </HudButton>
          )}
          {canImport && (
            <HudButton variant="primary" size="sm" leftIcon={<FileUp className="h-4 w-4" />} onClick={() => setImportOpen(true)}>
              Importar cronograma MS Project
            </HudButton>
          )}
        </div>
      </div>

      {items.length === 0 ? (
        <HudEmptyState
          icon="file"
          title="Nenhuma atividade no cronograma"
          description="Importe o PDF exportado do MS Project ou crie atividades manualmente."
          action={canImport ? { label: 'Importar cronograma MS Project', onClick: () => setImportOpen(true) } : undefined}
          secondaryAction={canEdit ? { label: 'Nova atividade', onClick: () => void handleAddItem() } : undefined}
        />
      ) : (
        <>
          <HudKpiStrip
            columns={5}
            kpis={[
              { id: 'progress', label: '% geral', value: `${kpis.overallPercent}%` },
              { id: 'delayed', label: 'Atrasadas', value: kpis.delayedCount, variant: kpis.delayedCount > 0 ? 'danger' : 'default', tintValue: kpis.delayedCount > 0 },
              { id: 'blocked', label: 'Bloqueadas', value: kpis.blockedCount, variant: kpis.blockedCount > 0 ? 'warning' : 'default', tintValue: kpis.blockedCount > 0 },
              { id: 'no-resp', label: 'Sem responsável', value: kpis.missingResponsible },
              {
                id: 'milestone',
                label: 'Próximo marco',
                value: kpis.nextMilestone?.plannedFinish
                  ? kpis.nextMilestone.plannedFinish.split('-').reverse().slice(0, 2).join('/')
                  : '—',
              },
            ]}
          />
          <GanttView items={items} />
        </>
      )}

      <TaskDetailDrawer
        item={selectedItem}
        projectName={projectName}
        projectManagerUserId={projectManagerUserId}
        onClose={() => selectItem(null)}
        onChanged={handleItemChanged}
      />

      <ImportWizard
        projectId={projectId}
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onImported={() => void reload()}
      />
    </div>
  );
}
