'use client';

import React from 'react';
import { motion } from 'framer-motion';
import Link from 'next/link';
import { ChevronRight, Home } from 'lucide-react';
import { cn } from '@/lib/utils';
import { HudChip } from './HudChip';
import type { HudChipVariant } from './HudChip';

export interface BreadcrumbItem {
  label: string;
  href?: string;
}

export interface StatusChip {
  label: string;
  variant: HudChipVariant;
  count?: number;
}

export interface HudHeaderProps {
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  breadcrumbs?: BreadcrumbItem[];
  statusChips?: StatusChip[];
  actions?: React.ReactNode;
  className?: string;
}

export function HudHeader({
  title,
  subtitle,
  icon,
  breadcrumbs,
  statusChips,
  actions,
  className,
}: HudHeaderProps) {
  return (
    <motion.header
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className={cn('mb-6', className)}
    >
      {/* Breadcrumbs */}
      {breadcrumbs && breadcrumbs.length > 0 && (
        <nav className="flex items-center gap-1.5 mb-3 text-[11px]">
          <Link
            href="/dashboard"
            className="flex items-center gap-1 hud-breadcrumb-link transition-colors"
          >
            <Home className="w-3 h-3" />
          </Link>
          {breadcrumbs.map((item, index) => (
            <React.Fragment key={item.label}>
              <ChevronRight className="w-3 h-3 hud-breadcrumb-chevron" />
              {item.href ? (
                <Link
                  href={item.href}
                  className={cn(
                    'transition-colors',
                    index === breadcrumbs.length - 1
                      ? 'hud-breadcrumb-active font-medium'
                      : 'hud-breadcrumb-link'
                  )}
                >
                  {item.label}
                </Link>
              ) : (
                <span className="hud-breadcrumb-active font-medium">{item.label}</span>
              )}
            </React.Fragment>
          ))}
        </nav>
      )}

      <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
        {/* Left: Title section */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 mb-1">
            {icon && (
              <div className="hud-header-icon-box flex items-center justify-center w-10 h-10 rounded-lg bg-gradient-to-br from-cyan-500/10 to-emerald-500/10 border border-cyan-500/20 text-cyan-300">
                {icon}
              </div>
            )}
            <div>
              <h1 className="hud-header-title text-xl font-semibold text-white tracking-wide flex items-center gap-2">
                {title}
              </h1>
              {subtitle && (
                <p className="hud-header-subtitle text-sm text-white/50 mt-0.5">{subtitle}</p>
              )}
            </div>
          </div>

          {/* Status chips */}
          {statusChips && statusChips.length > 0 && (
            <div className="flex items-center gap-2 mt-3 flex-wrap">
              {statusChips.map((chip, index) => (
                <HudChip
                  key={index}
                  label={chip.label}
                  variant={chip.variant}
                  count={chip.count}
                />
              ))}
            </div>
          )}
        </div>

        {/* Right: Actions */}
        {actions && (
          <div className="flex items-center gap-2 flex-shrink-0">
            {actions}
          </div>
        )}
      </div>
    </motion.header>
  );
}
