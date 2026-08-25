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
}: {
  client?: string | null;
  logoUrl?: string | null;
  height?: number;
}) {
  const [errored, setErrored] = useState(false);
  const resolved = getClientLogoUrl(client, logoUrl);
  const slot = clientLogoSlotSize(height);

  if (!resolved || errored) return null;

  return (
    <div className="flex h-12 items-center justify-center">
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
