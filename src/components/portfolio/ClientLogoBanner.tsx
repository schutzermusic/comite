'use client';

import { useState } from 'react';
import { getClientLogoUrl } from '@/lib/utils/client-logos';
import { clientLogoSlotSize } from '@/lib/utils/client-logo-frame';

/**
 * Faixa da logo do cliente — o mesmo recorte 1280×337 dos cards de projeto.
 * Só renderiza quando há URL resolvida; falha de carga some o bloco.
 */
export function ClientLogoBanner({
  client,
  logoUrl,
  height = 32,
  align = 'center',
  className,
}: {
  client?: string | null;
  logoUrl?: string | null;
  height?: number;
  /**
   * `center` mantém a faixa editorial dos cards de projeto. `start` encosta a
   * marca à esquerda, na régua do resto do card — onde ela é identidade e não
   * capa.
   */
  align?: 'center' | 'start';
  className?: string;
}) {
  const [errored, setErrored] = useState(false);
  const resolved = getClientLogoUrl(client, logoUrl);
  const slot = clientLogoSlotSize(height);

  if (!resolved || errored) return null;

  return (
    <div
      className={[
        'flex items-center',
        align === 'start' ? 'justify-start' : 'h-12 justify-center',
        className ?? '',
      ].join(' ')}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={resolved}
        alt={client || 'Logo cliente'}
        onError={() => setErrored(true)}
        className="object-contain client-logo-img"
        style={{ width: slot.width, height: slot.height }}
        draggable={false}
      />
    </div>
  );
}
