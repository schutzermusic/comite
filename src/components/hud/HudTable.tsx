'use client';

import React from 'react';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';

export interface HudTableColumn<T = any> {
  key: string;
  header: string;
  width?: string;
  align?: 'left' | 'center' | 'right';
  cell?: (item: T) => React.ReactNode;
  sortable?: boolean;
}

export interface HudTableProps<T = any> {
  columns: HudTableColumn<T>[];
  data: T[];
  keyExtractor: (item: T) => string;
  onRowClick?: (item: T) => void;
  selectedRowId?: string | null;
  emptyState?: React.ReactNode;
  loading?: boolean;
  className?: string;
  compact?: boolean;
  stickyHeader?: boolean;
}

export function HudTable<T>({
  columns,
  data,
  keyExtractor,
  onRowClick,
  selectedRowId,
  emptyState,
  loading = false,
  className,
  compact = false,
  stickyHeader = true,
}: HudTableProps<T>) {
  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="w-8 h-8 border-2 border-ig-border border-t-ig-accent rounded-full animate-spin" />
      </div>
    );
  }

  if (data.length === 0 && emptyState) {
    return <>{emptyState}</>;
  }

  return (
    <div className={cn('overflow-x-auto', className)}>
      <table className="w-full">
        <thead className={cn(stickyHeader && 'sticky top-0 z-10')}>
          <tr className="border-b border-ig-border">
            {columns.map((column) => (
              <th
                key={column.key}
                className={cn(
                  'text-left text-xs font-medium text-ig-fg-muted uppercase tracking-wider',
                  'py-3 px-4',
                  compact && 'py-2 px-3',
                  column.align === 'center' && 'text-center',
                  column.align === 'right' && 'text-right',
                  column.sortable && 'cursor-pointer hover:text-ig-fg-strong'
                )}
                style={{ width: column.width }}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((item, index) => {
            const itemKey = keyExtractor(item);
            const isSelected = selectedRowId === itemKey;

            return (
              <motion.tr
                key={itemKey}
                initial={{ opacity: 0, y: 5 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.2, delay: index * 0.03 }}
                onClick={() => onRowClick?.(item)}
                className={cn(
                  'border-b border-ig-border-subtle transition-colors',
                  onRowClick && 'cursor-pointer',
                  isSelected
                    ? 'bg-ig-accent-weak ring-1 ring-ig-border-focus'
                    : 'hover:bg-ig-raised'
                )}
              >
                {columns.map((column) => (
                  <td
                    key={column.key}
                    className={cn(
                      'py-3 px-4 text-sm',
                      compact && 'py-2 px-3',
                      column.align === 'center' && 'text-center',
                      column.align === 'right' && 'text-right'
                    )}
                  >
                    {column.cell ? column.cell(item) : (item as any)[column.key]}
                  </td>
                ))}
              </motion.tr>
            );
          })}
        </tbody>
      </table>

      {data.length === 0 && !emptyState && (
        <div className="text-center py-12">
          <p className="text-sm hud-text-muted">Nenhum registro encontrado</p>
        </div>
      )}
    </div>
  );
}
