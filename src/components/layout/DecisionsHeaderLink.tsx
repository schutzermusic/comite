'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Stamp } from 'lucide-react';
import { useDecisionBadge } from '@/hooks/use-decision-badge';
import { badgeText, headerLinkLabel } from '@/components/decisions/view';
import '@/components/decisions/decisions-nav.css';

/**
 * Atalho leve para Decisões no cabeçalho, ao lado dos Alertas.
 *
 * Alerta avisa; Decisões é onde a autoridade da pessoa é exercida — por isso
 * é um LINK com o número do que espera por ela, e não mais um sino. No
 * celular vira ícone + número (e some quando não há nada pendente); o nome
 * acessível sempre diz o número ("Decisões: 3 pendentes").
 */
export function DecisionsHeaderLink() {
  const count = useDecisionBadge();
  const pathname = usePathname();
  const active = pathname === '/decisoes' || pathname.startsWith('/decisoes/');
  const label = headerLinkLabel(count);
  return (
    <Link href="/decisoes" className="app-header-decisions" aria-label={label} title={label}
      aria-current={active ? 'page' : undefined} data-pending={count > 0 ? 'true' : 'false'} data-testid="header-decisions">
      <Stamp strokeWidth={1.8} aria-hidden="true" />
      <span className="app-header-decisions-label" aria-hidden="true">Decisões</span>
      {count > 0 && (
        <span className="hud-nav-badge hud-nav-badge--pending" aria-hidden="true">
          <span className="hud-nav-badge-count">{badgeText(count)}</span>
        </span>
      )}
    </Link>
  );
}
