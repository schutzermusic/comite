'use client';

import { useMemo, useState } from 'react';
import { cn } from '@/lib/utils';
import { getClientLogoUrl, getClientLogoScale } from '@/lib/utils/client-logos';

interface ProjectClientLogoProps {
  client?: string | null;
  logoUrl?: string | null;
  size?: 'xs' | 'sm' | 'md' | 'lg';
  className?: string;
}

const SIZE_MAP = {
  xs: { box: 'w-6 h-6', text: 'text-[9px]' },
  sm: { box: 'w-8 h-8', text: 'text-[11px]' },
  md: { box: 'w-10 h-10', text: 'text-xs' },
  lg: { box: 'w-14 h-14', text: 'text-sm' },
} as const;

function initialsFor(name: string): string {
  const parts = name
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return '—';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function tintFor(name: string): { from: string; to: string; ring: string } {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
  const a = h;
  const b = (h + 28) % 360;
  return {
    from: `hsl(${a}, 60%, 38%)`,
    to: `hsl(${b}, 70%, 22%)`,
    ring: `hsla(${a}, 70%, 55%, 0.35)`,
  };
}

export function ProjectClientLogo({
  client,
  logoUrl,
  size = 'md',
  className,
}: ProjectClientLogoProps) {
  const [errored, setErrored] = useState(false);
  const sizing = SIZE_MAP[size];
  const name = (client || '').trim();
  const initials = useMemo(() => initialsFor(name || '—'), [name]);
  const tint = useMemo(() => tintFor(name || 'Cliente'), [name]);

  const resolvedUrl = useMemo(() => getClientLogoUrl(name, logoUrl), [name, logoUrl]);
  const logoScale = useMemo(() => getClientLogoScale(name), [name]);
  const showImage = !!resolvedUrl && !errored;

  return (
    <div
      className={cn(
        'relative shrink-0 rounded-xl flex items-center justify-center font-semibold overflow-hidden',
        'border ring-1 ring-inset',
        sizing.box,
        sizing.text,
        className,
      )}
      style={{
        background: showImage
          ? 'rgba(255,255,255,0.04)'
          : `linear-gradient(135deg, ${tint.from} 0%, ${tint.to} 100%)`,
        borderColor: 'rgba(255,255,255,0.10)',
        boxShadow: `inset 0 0 0 1px ${tint.ring}`,
        color: '#fff',
      }}
      aria-label={name ? `Logo ${name}` : 'Cliente'}
      title={name || 'Cliente'}
    >
      {showImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={resolvedUrl}
          alt={name}
          onError={() => setErrored(true)}
          className="w-full h-full object-contain p-0.5"
          style={logoScale !== 1 ? { transform: `scale(${logoScale})` } : undefined}
        />
      ) : (
        <span className="tracking-wide drop-shadow-sm">{initials}</span>
      )}
    </div>
  );
}

export default ProjectClientLogo;
