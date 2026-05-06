'use client';

import React from 'react';
import { cn } from '@/lib/utils';

interface CommitteeBadgeProps {
  nome: string;
  cor: string;
  size?: 'sm' | 'md';
}

const SIZE_STYLES = {
  sm: 'text-[10px] px-2 py-0.5 gap-1.5',
  md: 'text-xs px-2.5 py-1 gap-2',
};

const DOT_SIZE = {
  sm: 'h-1.5 w-1.5',
  md: 'h-2 w-2',
};

export function CommitteeBadge({ nome, cor, size = 'sm' }: CommitteeBadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-md border border-ig-border-subtle bg-ig-panel font-medium text-ig-fg-strong',
        SIZE_STYLES[size],
      )}
      title={nome}
    >
      <span
        className={cn('rounded-full flex-shrink-0', DOT_SIZE[size])}
        style={{ backgroundColor: cor }}
      />
      <span className="truncate max-w-[180px]">{nome}</span>
    </span>
  );
}
