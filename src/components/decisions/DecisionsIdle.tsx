'use client';

import { Info } from 'lucide-react';
import { Plane } from '@/components/ax';
import type { DecisionsWorkspace } from '@/lib/decisions/types';
import { CompletedRow } from './DecisionRows';

/**
 * A caixa VAZIA — sucesso com zero decisões, que não é erro nem tela pela
 * metade. Diz o que a pessoa precisa saber de uma vez: carregou, não há nada
 * esperando a autoridade dela, o Apex segue observando os fluxos, e o que
 * surgir aparece aqui. Falha de leitura é outra tela (ErrorState), nunca esta.
 */
export function DecisionsIdle({ ws, openKey, onOpen }: {
  ws: DecisionsWorkspace; openKey: string; onOpen: (key: string) => void;
}) {
  const stats = [
    { label: 'pendentes', value: ws.counts.mine },
    { label: 'críticas', value: ws.mine.filter((i) => i.critical).length },
    { label: 'vencidas', value: ws.counts.overdue },
  ];
  const unconfigured = ws.setup !== null && ws.setup.policies === 0 && ws.setup.authorities === 0;
  const recent = ws.recent ?? [];
  return (
    <>
      <section className="dec-idle" data-testid="decisions-zero" aria-labelledby="dec-idle-title">
        <div className="dec-idle-copy">
          <p className="dec-idle-status"><span className="dec-idle-beacon" aria-hidden />Monitorando seus fluxos</p>
          <h2 id="dec-idle-title" className="dec-idle-title">Nenhuma decisão pendente</h2>
          <p className="dec-idle-lead">Tudo que depende da sua autoridade está resolvido.</p>
          <p className="dec-idle-support">
            O Apex continuará acompanhando aprovações, exceções e decisões dos seus fluxos operacionais. Quando algo exigir
            sua autoridade ou julgamento, aparece aqui na hora.
          </p>
          <dl className="dec-idle-stats" data-testid="decisions-zero-stats">
            {stats.map((s) => (
              <div key={s.label}><dt>{s.label}</dt><dd>{s.value.toLocaleString('pt-BR')}</dd></div>
            ))}
          </dl>
          {unconfigured && (
            <p className="dec-idle-setup" data-testid="decisions-zero-setup">
              <Info size={14} aria-hidden />
              <span>
                Nesta organização ainda não há política de aprovação ativa nem alçada de compra declarada — por isso nenhuma
                decisão é encaminhada. É configuração, não falha: quando alguém com autoridade declarar alçadas ou ativar uma
                política, as decisões passam a chegar aqui.
              </span>
            </p>
          )}
        </div>
        <DecisionFlow pending={ws.counts.mine} />
      </section>

      {recent.length > 0 && (
        <Plane title="Últimas decisões" count={recent.length} flush testId="decisions-zero-recent"
          subtitle="O que você decidiu ou solicitou por último — o histórico completo está em Concluídas">
          <ol className="dec-list" aria-label="Últimas decisões">
            {recent.map((item) => <CompletedRow key={item.key} item={item} current={item.key === openKey} onOpen={onOpen} />)}
          </ol>
        </Plane>
      )}
    </>
  );
}

const DOMAINS = ['Compras', 'Financeiro', 'Comercial', 'Contratos', 'Operações', 'Pessoas'] as const;
const NODE = { x: 8, w: 108, h: 28, gap: 40, top: 22 };
const TARGET = { x: 286, y: 122, r: 38 };

/**
 * Os domínios que alimentam a Central de Decisões, convergindo para ela.
 * Geometria fixa (nada calculado de dado): números finitos por construção.
 * Pulsos discretos percorrem as ligações; com "reduzir movimento", param.
 */
function DecisionFlow({ pending }: { pending: number }) {
  const rows = DOMAINS.map((name, i) => ({ name, cy: NODE.top + i * NODE.gap }));
  return (
    <div className="dec-flow">
      <svg viewBox="0 0 360 244" role="img" className="dec-flow-svg" data-testid="decisions-flow"
        aria-label={`${DOMAINS.join(', ')} alimentam Decisões — ${pending} pendente${pending === 1 ? '' : 's'}`}>
        {rows.map(({ name, cy }, i) => {
          const d = `M ${NODE.x + NODE.w} ${cy} C ${NODE.x + NODE.w + 70} ${cy}, ${TARGET.x - TARGET.r - 70} ${TARGET.y}, ${TARGET.x - TARGET.r} ${TARGET.y}`;
          return (
            <g key={name}>
              <path d={d} className="dec-flow-line" pathLength={100} />
              <path d={d} className="dec-flow-pulse" pathLength={100} style={{ animationDelay: `${(i * 0.55).toFixed(2)}s` }} />
              <rect x={NODE.x} y={cy - NODE.h / 2} width={NODE.w} height={NODE.h} rx={NODE.h / 2} className="dec-flow-node" />
              <circle cx={NODE.x + 14} cy={cy} r={3} className="dec-flow-node-dot" />
              <text x={NODE.x + 26} y={cy} className="dec-flow-label" dominantBaseline="central">{name}</text>
            </g>
          );
        })}
        <circle cx={TARGET.x} cy={TARGET.y} r={TARGET.r + 10} className="dec-flow-halo" />
        <circle cx={TARGET.x} cy={TARGET.y} r={TARGET.r} className="dec-flow-core" />
        <text x={TARGET.x} y={TARGET.y - 12} textAnchor="middle" className="dec-flow-core-label">DECISÕES</text>
        <text x={TARGET.x} y={TARGET.y + 12} textAnchor="middle" className="dec-flow-core-value" dominantBaseline="central">
          {pending.toLocaleString('pt-BR')}
        </text>
      </svg>
    </div>
  );
}
