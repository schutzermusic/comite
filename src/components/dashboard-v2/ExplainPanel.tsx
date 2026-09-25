'use client';

import Link from 'next/link';
import { ArrowUpRight, CircleDashed, CircleDot, Clock3, Lock, Radar, TriangleAlert } from 'lucide-react';
import { EmptyState, KV, Section, SidePanel, dateTime, relativeDue, useResource } from '@/components/ax';
import type { ChainLink, ExplainResponse, LinkState } from '@/lib/dashboard/types';

const STATE_LABEL: Record<LinkState, string> = {
  found: 'registrado',
  none: 'sem vínculo registrado',
  restricted: 'Restrito',
  unconfirmed: 'vínculo a confirmar',
  pending: 'ainda não nasceu',
};

/**
 * ENTENDER — a cadeia causal de uma exceção, com a evidência.
 *
 * Cada elo é um registro que existe (ou a falta dele, dita como falta): o que
 * a pessoa não lê aparece "Restrito"; um vínculo proposto aparece "a
 * confirmar"; um faturamento que só nasce do aceite do cliente aparece
 * "ainda não nasceu". A leitura da cadeia é de CONTENÇÃO ("faz parte da
 * etapa que ancora o marco") — nunca "atrasa".
 */
export function ExplainPanel({ reference, today, onClose }: { reference: string; today: string; onClose: () => void }) {
  const res = useResource<Extract<ExplainResponse, { ok: true }>>(`/api/dashboard/explain?ref=${encodeURIComponent(reference)}`);
  const data = res.data;
  return (
    <SidePanel open onClose={onClose} eyebrow="Entender" title={data?.title ?? 'Por que isto importa'} wide testId="dashboard-explain"
      meta={data?.detected.location ? <span>{data.detected.location}</span> : undefined}
      footer={<>
        <button type="button" className="ax-btn ghost" onClick={onClose}>Voltar</button>
        {data?.nextAction && (
          <Link className="ax-btn primary" href={data.nextAction.href}>{data.nextAction.label}<ArrowUpRight size={14} aria-hidden /></Link>
        )}
      </>}>
      {!data ? (
        res.state === 'loading'
          ? <div className="ax-skel" role="status" aria-label="Carregando…"><i style={{ width: '60%' }} /><i className="block" /><i className="block" style={{ width: '80%' }} /></div>
          : <EmptyState compact title="Não foi possível explicar" icon={<TriangleAlert size={18} />}>{res.message ?? 'Tente de novo em instantes.'}</EmptyState>
      ) : (
        <>
          <Section title="O que foi detectado">
            <KV items={[
              ['O quê', data.detected.object],
              ['Problema', data.detected.problem],
              ...(data.detected.due ? [['Prazo', `${relativeDue(data.detected.due, today).text} (${data.detected.due.split('-').reverse().join('/')})`] as [string, string]] : []),
              // Tipo sem dono (sinal, título, evento de faturamento…): a linha não existe — nunca um "sem responsável" inventado.
              ...(data.detected.ownerApplicable ? [['Responsável', data.detected.owner ?? 'sem responsável'] as [string, string]] : []),
            ]} />
          </Section>

          <Section title="Por que isto importa">
            <ol className="dv2-chain" aria-label="Cadeia causal">
              {data.chain.map((link, i) => <ChainStep key={`${link.stage}-${i}`} link={link} />)}
            </ol>
            {data.relation && <p className="dv2-relation">{data.relation}</p>}
          </Section>

          {(data.evidence.length > 0 || data.apex) && (
            <Section title="Evidência">
              {data.apex && (
                <div className="dv2-apex" data-stale={data.apex.stale ? 'true' : undefined} style={{ marginBottom: 10 }}>
                  <span className="dv2-apex-lead"><Radar size={13} aria-hidden />{data.apex.lead}</span>
                  <span className="dv2-apex-title">{data.apex.title}</span>
                  <p className="ax-muted" style={{ margin: 0 }}>{data.apex.rationale}</p>
                  <span className="dv2-apex-meta">
                    {data.apex.ranAt ? `Leitura de ${dateTime(data.apex.ranAt)}` : 'Achado persistido'}{data.apex.engineVersion ? ` · motor ${data.apex.engineVersion}` : ''}
                    {data.apex.stale ? ' · a situação ao vivo mudou desde a leitura' : ''}
                  </span>
                </div>
              )}
              {data.evidence.length + (data.apex?.evidence.length ?? 0) > 0 && (
                <ul className="dv2-evidence">
                  {[...data.evidence, ...(data.apex?.evidence ?? [])].map((e, i) => (
                    <li key={i}><span>{e.label}</span><strong>{e.value}</strong>{e.source && <em>{e.source}</em>}</li>
                  ))}
                </ul>
              )}
            </Section>
          )}

          {data.rule && (
            <Section title="Por que é uma exceção">
              <p className="ax-muted" style={{ margin: 0 }}>{data.rule}</p>
            </Section>
          )}
          <p className="ax-note">Lido em {dateTime(data.asOf)}. Nada é executado daqui — a ação abre o fluxo governado da área.</p>
        </>
      )}
    </SidePanel>
  );
}

function ChainStep({ link }: { link: ChainLink }) {
  const Icon = link.state === 'found' ? CircleDot : link.state === 'restricted' ? Lock : link.state === 'pending' ? Clock3
    : link.state === 'unconfirmed' ? TriangleAlert : CircleDashed;
  // A etapa (o nome do elo) em cima; o registro — ou a falta dele, dita como falta — como título; depois o detalhe.
  const body = (
    <>
      <span className="dv2-chain-mark"><Icon size={14} aria-hidden /><span className="sr-only-ax">{STATE_LABEL[link.state]}</span></span>
      <span className="dv2-chain-text">
        <span className="dv2-chain-stage">{link.stage}</span>
        <span className="dv2-chain-label">{link.label}</span>
        {link.detail && <span className="dv2-chain-detail">{link.detail}</span>}
        {link.note && <span className="dv2-chain-note">{link.note}</span>}
      </span>
      {link.href && <ArrowUpRight size={13} className="dv2-chain-go" aria-hidden />}
    </>
  );
  return (
    <li className="dv2-chain-step" data-state={link.state} data-tone={link.tone}>
      {link.href ? <Link href={link.href}>{body}</Link> : <div>{body}</div>}
    </li>
  );
}
