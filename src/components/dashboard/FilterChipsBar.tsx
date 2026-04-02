'use client';

import React from 'react';
import { X } from 'lucide-react';
import type { AppliedFilter } from '@/hooks/useHudLayout';

interface FilterChipsBarProps {
    filters: AppliedFilter[];
    onRemove: (key: string) => void;
}

export function FilterChipsBar({ filters, onRemove }: FilterChipsBarProps) {
    if (filters.length === 0) return null;

    return (
        <div className="cr-filter-chips-bar pointer-events-auto">
            {filters.map((filter) => (
                <span key={filter.key} className="cr-filter-chip">
                    {filter.label}
                    {filter.removable && (
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                onRemove(filter.key);
                            }}
                            className="cr-filter-chip-remove"
                            aria-label={`Remover filtro ${filter.label}`}
                        >
                            <X className="w-2.5 h-2.5" />
                        </button>
                    )}
                </span>
            ))}
        </div>
    );
}
