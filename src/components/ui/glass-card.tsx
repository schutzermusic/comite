import React from 'react';
import { cn } from '@/lib/utils';

interface GlassCardProps {
  children: React.ReactNode;
  className?: string;
  variant?: 'light' | 'medium' | 'dark';
  hover?: boolean;
  neonBorder?: boolean;
  neonColor?: 'gold' | 'emerald' | 'electric' | 'lime' | 'orange';
}

export function GlassCard({ 
  children, 
  className, 
  variant = 'medium',
  hover = true,
  neonBorder = false,
  neonColor = 'gold'
}: GlassCardProps) {
  
  const variants = {
    light: 'bg-white/90 backdrop-blur-md',
    medium: 'bg-white/95 backdrop-blur-lg',
    dark: 'bg-slate-900/95 backdrop-blur-xl',
  };

  const neonColors = {
    gold: 'hover:shadow-[0_0_20px_rgba(251,191,36,0.3)] border-yellow-400/30',
    emerald: 'hover:shadow-[0_0_20px_rgba(16,185,129,0.3)] border-emerald-400/30',
    electric: 'hover:shadow-[0_0_20px_rgba(59,130,246,0.3)] border-blue-400/30',
    lime: 'hover:shadow-[0_0_20px_rgba(132,204,22,0.3)] border-lime-400/30',
    orange: 'hover:shadow-[0_0_20px_rgba(249,115,22,0.3)] border-orange-400/30',
  };

  return (
    <div
      className={cn(
        'rounded-2xl border border-slate-200/50 shadow-sm',
        variants[variant],
        hover && 'transition-all duration-500 hover:scale-[1.02] hover:border-slate-300/60 hover:shadow-md',
        neonBorder && neonColors[neonColor],
        className
      )}
    >
      {children}
    </div>
  );
}

