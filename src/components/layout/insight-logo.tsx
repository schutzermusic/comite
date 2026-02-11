'use client';

import Image from 'next/image';
import { cn } from '@/lib/utils';

interface InsightLogoProps {
  width?: number;
  height?: number;
  className?: string;
  variant?: 'default' | 'compact';
  priority?: boolean;
  animated?: boolean;
}

export function InsightLogo({ 
  width = 200, 
  height = 53, 
  className,
  variant = 'default',
  priority = false,
  animated = true
}: InsightLogoProps) {
  const dimensions = variant === 'compact' 
    ? { width: 140, height: 37 }
    : { width, height };

  const logoContent = (
    <Image
      src="/LOGO INSIGHT.png"
      alt="Insight Energy"
      {...dimensions}
      className={cn("h-auto relative z-10", className)}
      priority={priority}
    />
  );

  if (!animated) {
    return logoContent;
  }

  return (
    <div className="relative inline-block">
      {/* Container principal */}
      <div className="relative group">
        
        {/* Efeito de fundo "Ambient Glow" - Cinemático */}
        <div 
          className="absolute -inset-2 bg-gradient-to-r from-insight-gold/0 via-insight-gold/10 to-insight-emerald/0 blur-xl opacity-0 group-hover:opacity-100 transition-opacity duration-1000"
          style={{ zIndex: 0 }}
        />

        {/* Logo */}
        <div className="relative z-10">
          {logoContent}
        </div>
        
        {/* Camada de Efeitos Cinemáticos (Veo Style) */}
        <div className="absolute inset-0 pointer-events-none overflow-visible" style={{ zIndex: 15 }}>
          
          {/* 1. Feixe de Energia Principal (Liquid Plasma) */}
          <svg
            className="absolute w-full"
            style={{ 
              top: '50%', 
              left: '-20%', 
              width: '140%', 
              height: '20px', 
              transform: 'translateY(-50%)',
              overflow: 'visible'
            }}
            viewBox="0 0 300 20"
            preserveAspectRatio="none"
          >
            <defs>
              <linearGradient id={`cinematic-grad-${variant}`} x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#FFD700" stopOpacity="0" />
                <stop offset="20%" stopColor="#FFD700" stopOpacity="0.8" />
                <stop offset="50%" stopColor="#ffffff" stopOpacity="1" />
                <stop offset="80%" stopColor="#10B981" stopOpacity="0.8" />
                <stop offset="100%" stopColor="#10B981" stopOpacity="0" />
              </linearGradient>
              
              {/* Filtro de Distorção de Plasma */}
              <filter id={`plasma-filter-${variant}`} x="-20%" y="-20%" width="140%" height="140%">
                <feTurbulence type="fractalNoise" baseFrequency="0.1 0.01" numOctaves="2" result="warp" >
                  <animate attributeName="baseFrequency" values="0.1 0.01; 0.12 0.02; 0.1 0.01" dur="8s" repeatCount="indefinite" />
                </feTurbulence>
                <feDisplacementMap xChannelSelector="R" yChannelSelector="G" scale="10" in="SourceGraphic" in2="warp" />
                <feGaussianBlur stdDeviation="0.5" />
              </filter>

              {/* Filtro de Glow Intenso */}
              <filter id={`intense-glow-${variant}`}>
                <feGaussianBlur stdDeviation="2" result="coloredBlur"/>
                <feMerge>
                  <feMergeNode in="coloredBlur"/>
                  <feMergeNode in="coloredBlur"/>
                  <feMergeNode in="SourceGraphic"/>
                </feMerge>
              </filter>
            </defs>

            {/* Caminho de Energia - Curva Bezier Suave */}
            <path
              d="M 0,10 C 75,10 75,10 150,10 C 225,10 225,10 300,10"
              stroke={`url(#cinematic-grad-${variant})`}
              strokeWidth="2"
              fill="none"
              filter={`url(#plasma-filter-${variant})`}
              style={{
                opacity: 0.9,
                mixBlendMode: 'screen'
              }}
            />
            
            {/* Core Brilhante */}
            <path
              d="M 0,10 C 75,10 75,10 150,10 C 225,10 225,10 300,10"
              stroke="white"
              strokeWidth="0.5"
              fill="none"
              opacity="0.8"
              filter={`url(#intense-glow-${variant})`}
            />
          </svg>

          {/* 2. Scanner Beam (Feixe de Varredura Rápida) */}
          <div 
            className="absolute top-0 bottom-0 w-20 bg-gradient-to-r from-transparent via-white/20 to-transparent -skew-x-12"
            style={{
              animation: 'beam-scan 6s ease-in-out infinite',
              mixBlendMode: 'overlay',
              filter: 'blur(5px)'
            }}
          />
        </div>
        
        {/* Partículas de Poeira Digital (Sutis) */}
        <div className="absolute inset-0 pointer-events-none opacity-40">
           {[...Array(3)].map((_, i) => (
            <div
              key={i}
              className="absolute rounded-full bg-white"
              style={{
                width: '1px',
                height: '1px',
                top: `${20 + Math.random() * 60}%`,
                left: `${Math.random() * 100}%`,
                animation: `pulse-glow-cinematic ${3 + i}s ease-in-out infinite`,
                boxShadow: '0 0 4px white'
              }}
            />
          ))}
        </div>

      </div>
    </div>
  );
}
