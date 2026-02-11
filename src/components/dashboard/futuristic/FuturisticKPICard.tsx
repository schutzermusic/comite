'use client';

import React from 'react';
import { LucideIcon } from 'lucide-react';
import { GlassCard } from '@/components/ui/glass-card';
import { cn } from '@/lib/utils';

interface FuturisticKPICardProps {
  title: string;
  value: string | number;
  icon: LucideIcon;
  trend?: {
    value: string;
    positive: boolean;
  };
  subtitle?: string;
  gradient: string;
  neonColor?: 'gold' | 'emerald' | 'electric' | 'lime' | 'orange';
}

export function FuturisticKPICard({
  title,
  value,
  icon: Icon,
  trend,
  subtitle,
  gradient,
      neonColor = 'gold',
}: FuturisticKPICardProps) {
  return (
    <GlassCard 
      variant="medium" 
      neonBorder 
      neonColor={neonColor}
      className="group relative overflow-hidden animate-breathe"
    >
      {/* Background Gradient Layer */}
      <div 
        className={cn(
          "absolute inset-0 opacity-5 group-hover:opacity-10 transition-opacity duration-700",
          gradient
        )}
      />

      {/* Holographic Orb - Gradiente Laranja → Verde → Amarelo */}
      <div className="absolute -top-10 -right-10 w-32 h-32 bg-gradient-to-br from-orange-400/20 via-emerald-400/20 to-yellow-400/20 rounded-full blur-3xl group-hover:scale-150 transition-transform duration-700" />

      {/* Content */}
      <div className="relative p-6 space-y-4">
        {/* Icon Container */}
        <div className="flex items-start justify-between">
          <div className="p-3 rounded-xl bg-gradient-to-br from-slate-900/10 to-slate-800/5 backdrop-blur-sm border border-slate-300/20 group-hover:scale-110 transition-transform duration-300">
            <Icon className="w-6 h-6 text-slate-800" />
          </div>
          
          {trend && (
            <div className={cn(
              "px-3 py-1 rounded-full text-xs font-semibold backdrop-blur-md flex items-center gap-1",
              trend.positive 
                ? "bg-emerald-100 text-emerald-700 border border-emerald-300" 
                : "bg-red-100 text-red-700 border border-red-300"
            )}>
              <span>{trend.positive ? '↑' : '↓'}</span>
              <span>{trend.value}</span>
            </div>
          )}
        </div>

        {/* Title */}
        <div>
          <p className="text-sm font-medium text-slate-600 mb-2">{title}</p>
          <p className="text-5xl font-bold text-slate-900 tracking-tight">
            {value}
          </p>
        </div>

        {/* Subtitle */}
        {subtitle && (
          <p className="text-xs text-slate-600 flex items-center gap-2">
            <span className={cn(
              "w-1 h-1 rounded-full animate-pulse",
              neonColor === 'gold' && "bg-yellow-500",
              neonColor === 'emerald' && "bg-emerald-500",
              neonColor === 'electric' && "bg-blue-500",
              neonColor === 'lime' && "bg-lime-500",
              neonColor === 'orange' && "bg-orange-500",
            )} />
            {subtitle}
          </p>
        )}
      </div>

      {/* Bottom Glow Line - Gradiente Laranja → Verde → Amarelo */}
      <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-orange-400/50 via-emerald-400/50 via-yellow-400/50 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
    </GlassCard>
  );
}

