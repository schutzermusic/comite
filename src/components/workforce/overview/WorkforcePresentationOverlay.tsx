'use client';

/**
 * A apresentação, em tela cheia, sobre a própria página.
 *
 * `createPortal` + `<iframe srcDoc>` em vez de uma rota dedicada: o deck é um
 * documento autocontido com CSS global próprio (reset, `html,body{overflow:hidden}`,
 * grade de fundo). Renderizá-lo dentro da árvore da aplicação vazaria esse CSS
 * para o cockpit; o iframe é a fronteira que já existe para isso — e evita uma
 * rota que só serviria para hospedar uma string.
 *
 * Mesmo padrão da Projeção Financeira.
 */

import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Download, X } from 'lucide-react';
import { HudButton } from '@/components/hud';

interface WorkforcePresentationOverlayProps {
  html: string;
  onClose: () => void;
  onDownload: () => void;
}

export function WorkforcePresentationOverlay({
  html,
  onClose,
  onDownload,
}: WorkforcePresentationOverlayProps) {
  // Esc fecha a sobreposição. O deck também escuta Esc, mas dentro do iframe:
  // os dois não competem porque o foco pertence a um documento por vez.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    // Trava o scroll do cockpit enquanto a apresentação está aberta.
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [onClose]);

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div className="fixed inset-0 z-[9999] bg-black">
      <iframe
        srcDoc={html}
        title="Apresentação — Pessoas & Custos"
        className="h-full w-full border-0"
      />
      <div className="absolute right-4 top-4 flex items-center gap-2">
        <HudButton
          variant="glass"
          size="sm"
          leftIcon={<Download className="h-4 w-4" />}
          onClick={onDownload}
        >
          Baixar HTML
        </HudButton>
        <HudButton variant="glass" size="sm" leftIcon={<X className="h-4 w-4" />} onClick={onClose}>
          Fechar
        </HudButton>
      </div>
    </div>,
    document.body,
  );
}
