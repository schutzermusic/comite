'use client';

import { useRef } from 'react';
import { ImageOff, Upload } from 'lucide-react';
import { cn } from '@/lib/utils';
import { clientLogoSlotSize } from '@/lib/utils/client-logo-frame';

/**
 * Slot de upload da logo do cliente (frame 1280×337).
 * Igual ao do drawer de projetos: vazio pede arquivo; preenchido remove no hover.
 *
 * `size="sm"` (padrão) é a pastilha de 32px do cabeçalho do drawer. `size="lg"`
 * é a faixa larga de formulário — usada no topo de "Editar contrato", ACIMA do
 * campo de título, porque é ali que a logo do cliente pertence visualmente: a
 * identidade do contrato é, antes do nome, de quem ele é.
 */
export function ClientLogoUploadSlot({
  logoUrl,
  alt,
  disabled,
  onSelect,
  size = 'sm',
}: {
  logoUrl: string | null;
  alt: string;
  disabled?: boolean;
  onSelect: (file: File | null) => void;
  size?: 'sm' | 'lg';
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  if (!logoUrl && disabled) return null;

  if (size === 'lg') {
    return (
      <div className="group/logo relative w-full">
        {logoUrl ? (
          <div className="relative flex h-20 w-full items-center justify-center overflow-hidden rounded-xl border border-ig-border-subtle bg-ig-panel">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={logoUrl} alt={alt} className="h-full max-h-full w-auto max-w-full object-contain p-3 client-logo-img" />
            {!disabled && (
              <button
                type="button"
                onClick={() => onSelect(null)}
                className="absolute inset-0 flex items-center justify-center gap-1.5 bg-black/55 text-white opacity-0 transition-opacity group-hover/logo:opacity-100"
                aria-label="Remover logo do cliente"
              >
                <ImageOff className="h-4 w-4" />
                <span className="text-ig-caption font-semibold">Remover</span>
              </button>
            )}
          </div>
        ) : (
          <button
            type="button"
            onClick={() => (disabled ? undefined : inputRef.current?.click())}
            disabled={disabled}
            className={cn(
              'flex h-20 w-full flex-col items-center justify-center gap-1.5 rounded-xl',
              'border border-dashed border-ig-border-strong text-ig-fg-muted transition-colors',
              disabled ? 'cursor-not-allowed opacity-50' : 'hover:border-ig-border-focus hover:text-ig-fg-strong',
            )}
            title={disabled ? undefined : 'Upload da logo do cliente (recorte padronizado 1280×337)'}
            aria-label="Fazer upload da logo do cliente"
          >
            <Upload className="h-4 w-4" />
            <span className="text-ig-caption font-semibold">Logo do cliente</span>
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

  const slot = clientLogoSlotSize(32);

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
