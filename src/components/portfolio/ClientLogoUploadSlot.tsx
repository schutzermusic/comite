'use client';

import { useRef } from 'react';
import { ImageOff, Upload } from 'lucide-react';
import { cn } from '@/lib/utils';
import { clientLogoSlotSize } from '@/lib/utils/client-logo-frame';

/**
 * Slot de upload da logo do cliente (frame 1280×337).
 * Igual ao do drawer de projetos: vazio pede arquivo; preenchido remove no hover.
 */
export function ClientLogoUploadSlot({
  logoUrl,
  alt,
  disabled,
  onSelect,
}: {
  logoUrl: string | null;
  alt: string;
  disabled?: boolean;
  onSelect: (file: File | null) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const slot = clientLogoSlotSize(32);

  if (!logoUrl && disabled) return null;

  return (
    <div className="relative shrink-0 group/logo">
      {logoUrl ? (
        <div
          className="relative flex items-center justify-center overflow-hidden rounded-md border border-ig-border-subtle bg-ig-panel"
          style={slot}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={logoUrl} alt={alt} className="h-full w-full object-contain client-logo-img" />
          {!disabled && (
            <button
              type="button"
              onClick={() => onSelect(null)}
              className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 transition-opacity group-hover/logo:opacity-100"
              aria-label="Remover logo"
            >
              <ImageOff className="h-3.5 w-3.5 text-white" />
            </button>
          )}
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className={cn(
            'flex flex-col items-center justify-center gap-1 rounded-md',
            'border border-dashed border-ig-border-strong text-ig-fg-muted',
            'opacity-70 transition-opacity hover:opacity-100',
          )}
          style={slot}
          title="Upload logo do cliente (padronizada em 1280×337)"
          aria-label="Fazer upload do logo do cliente"
        >
          <Upload className="h-3.5 w-3.5" />
          <span className="text-ig-label font-semibold uppercase leading-none tracking-wide">Logo</span>
        </button>
      )}
      {!disabled && (
        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/svg+xml"
          className="sr-only"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (file) onSelect(file);
          }}
        />
      )}
    </div>
  );
}
