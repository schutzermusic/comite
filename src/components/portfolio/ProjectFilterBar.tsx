'use client';

import { HudFilterBar } from '@/components/hud';

export interface FilterOption {
  value: string;
  label: string;
}

export interface ProjectFilterGroup {
  id: string;
  label: string;
  value: string;
  options: FilterOption[];
  onChange: (value: string) => void;
}

interface ProjectFilterBarProps {
  searchValue: string;
  onSearchChange: (v: string) => void;
  searchPlaceholder?: string;
  groups: ProjectFilterGroup[];
  viewMode: 'cards' | 'table';
  onViewModeChange: (m: 'cards' | 'table') => void;
  onClearFilters: () => void;
  className?: string;
}

export function ProjectFilterBar({
  searchValue,
  onSearchChange,
  searchPlaceholder = 'Buscar por nome, código ou cliente…',
  groups,
  viewMode,
  onViewModeChange,
  onClearFilters,
  className,
}: ProjectFilterBarProps) {
  const activeFiltersCount =
    (searchValue ? 1 : 0) + groups.filter((g) => g.value && g.value !== 'all').length;

  return (
    <HudFilterBar
      className={className}
      searchPlaceholder={searchPlaceholder}
      searchValue={searchValue}
      onSearchChange={onSearchChange}
      filterGroups={groups}
      activeFiltersCount={activeFiltersCount}
      onClearFilters={onClearFilters}
      viewMode={viewMode}
      onViewModeChange={(mode) => {
        if (mode === 'cards' || mode === 'table') onViewModeChange(mode);
      }}
      viewModes={['cards', 'table']}
    />
  );
}

export default ProjectFilterBar;
