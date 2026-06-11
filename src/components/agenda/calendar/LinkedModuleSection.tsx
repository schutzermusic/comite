'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { ExternalLink, Link2 } from 'lucide-react';
import type { CalendarEvent, RelatedModule, Task } from '@/lib/types/agenda';
import { RELATED_MODULE_LABELS } from '@/lib/types/agenda';
import { extractLinks, fetchLinkLabel, moduleHref } from './module-links';

/** Read-only chips of cross-module links with deep links (detail drawers). */
export function LinkedModuleSection({ entity }: { entity: Task | CalendarEvent }) {
  const links = extractLinks(entity);
  const [labels, setLabels] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const resolved: Record<string, string> = {};
      await Promise.all(
        links.map(async ({ module, id }) => {
          const label = await fetchLinkLabel(module, id);
          if (label) resolved[`${module}:${id}`] = label;
        }),
      );
      if (!cancelled) setLabels(resolved);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entity.id]);

  if (links.length === 0) return null;

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[11px] font-medium uppercase tracking-wider text-ig-fg-muted">Vinculado a</span>
      <div className="flex flex-wrap gap-1.5">
        {links.map(({ module, id }) => (
          <LinkChip key={`${module}:${id}`} module={module} id={id} label={labels[`${module}:${id}`]} />
        ))}
      </div>
    </div>
  );
}

function LinkChip({ module, id, label }: { module: RelatedModule; id: string; label?: string }) {
  return (
    <Link
      href={moduleHref(module, id)}
      className="group inline-flex max-w-full items-center gap-1.5 rounded-md border border-ig-border bg-ig-panel px-2 py-1 text-xs text-ig-fg-strong transition-colors hover:border-ig-border-focus hover:bg-ig-panel-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ig-border-focus"
    >
      <Link2 className="h-3 w-3 shrink-0 text-ig-accent" />
      <span className="font-medium text-ig-fg-muted">{RELATED_MODULE_LABELS[module]}:</span>
      <span className="truncate">{label ?? '…'}</span>
      <ExternalLink className="h-3 w-3 shrink-0 text-ig-fg-subtle opacity-0 transition-opacity group-hover:opacity-100" />
    </Link>
  );
}
