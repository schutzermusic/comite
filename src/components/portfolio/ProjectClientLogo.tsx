'use client';

import { useMemo, useState } from 'react';
import { cn } from '@/lib/utils';
import { getClientLogoUrl } from '@/lib/utils/client-logos';
import { clientLogoSlotSize } from '@/lib/utils/client-logo-frame';

interface ProjectClientLogoProps {
  client?: string | null;
  logoUrl?: string | null;
  size?: 'xs' | 'sm' | 'md' | 'lg';
  className?: string;
}

const SIZE_HEIGHT = {
  xs: 16,
  sm: 20,
  md: 28,
  lg: 36,
} as const;

const SIZE_TEXT = {
  xs: 'text-[9px]',
  sm: 'text-[11px]',
  md: 'text-xs',
  lg: 'text-sm',
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
  const slot = clientLogoSlotSize(SIZE_HEIGHT[size]);
  const name = (client || '').trim();
  const initials = useMemo(() => initialsFor(name || '—'), [name]);
  const tint = useMemo(() => tintFor(name || 'Cliente'), [name]);

  const resolvedUrl = useMemo(() => getClientLogoUrl(name, logoUrl), [name, logoUrl]);
  const showImage = !!resolvedUrl && !errored;

  return (
    <div
      className={cn(
        'relative shrink-0 rounded-md flex items-center justify-center font-semibold overflow-hidden',
        'border ring-1 ring-inset',
        SIZE_TEXT[size],
        className,
      )}
      style={{
        width: slot.width,
        height: slot.height,
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
          className="h-full w-full object-contain client-logo-img"
        />
      ) : (
        <span className="tracking-wide drop-shadow-sm">{initials}</span>
      )}
    </div>
  );
}

export default ProjectClientLogo;
