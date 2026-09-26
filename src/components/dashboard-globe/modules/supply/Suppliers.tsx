'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowUpRight, BadgeCheck, ExternalLink, Globe, Mail, Phone, Send, UserPlus } from 'lucide-react';
import { dateTime } from '@/components/ax/format';
import type { ExternalSupplierCandidate, RequisitionView, RfqView, SupplierCandidate, SupplierDiscoveryResponse } from '@/lib/dashboard/types';
import {
  RFQS_URL, SEND_OUTCOME, SUPPLIERS_URL, activeRfq, cnpjText, dayMonth, defaultResponseDue, exactQtyText, flowRequisitionOf, handledBySend, hostOf,
  leadText, liveRequisitions, pctText, preselectSuppliers, prospectBody, registryList, registryMatch, rfqCreateBody, rfqSendBody, rfqSendUrl,
  safeHttpUrl, sendResults, supplierStatusText, unsentInvited, unsentPending, type RegistrySupplier, type SendResult,
} from '../model';
import { SkeletonLines, StateNote } from '../shared';
import { discoverUrl, postDiscovery, postGoverned, useSupplyAct } from './act';
import type { FlowCtx } from './types';
import { ActNotice, Signal, Spin, SupplyConfirm } from './ui';

const BASIS: Record<SupplierCandidate['basis'], string> = {
  category: 'categoria do item', history: 'já cotou ou forneceu este item', both: 'categoria e histórico com o item',
};

/**
 * A solicitação que a etapa usa (`flowRequisitionOf`): a com cotação aberta;
 * senão a que ainda se cota, sem cotação viva; senão a com cotação decidida
 * viva; senão a primeira viva. Viva = com quantidade EM ABERTO para o
 * requisito (248): a encerrada, a cancelada e a toda liberada nunca recebem
 * convite.
 */
export function flowRequisition(ctx: FlowCtx): RequisitionView | null {
  return flowRequisitionOf(liveRequisitions(ctx.data.procurement));
}

/**
 * ETAPA 5 — FORNECEDORES.
 * (a) HOMOLOGADOS (cadastro interno): candidatos pela categoria do item ou
 *     pelo histórico com ele. Sem cotação: "Convidar e enviar cotação" →
 *     POST /rfqs (abre a cotação) → POST /rfqs/[id]/send. Com cotação: os
 *     convidados, quem já recebeu, e "Enviar cotação" para os que faltam —
 *     cada envio com o seu desfecho (enviada / registrado em teste / sem e-mail).
 * (b) INTERNET (Apex): candidatos com site, e-mail, telefone e as FONTES —
 *     marcados "não homologado — verificar"; nunca contatados; "Cadastrar como
 *     prospecto" só com a permissão de fornecedores.
 */
/** O desfecho de um envio de cotação — mora no painel (a releitura troca a lista e pode fechar a etapa; o desfecho fica). */
export type SentNotice = { title: string; results: SendResult[]; error: string | null };

export function SuppliersStep({ ctx, sent = null, onSent = () => undefined }: { ctx: FlowCtx; sent?: SentNotice | null; onSent?: (n: SentNotice) => void }) {
  const req = flowRequisition(ctx);
  const rfq = activeRfq(req);
  return (
    <div className="dgs-sup" data-testid="dg-supply-suppliers">
      <div className="dgs-sub-h"><BadgeCheck size={15} aria-hidden /><span>Homologados e em avaliação</span><small>cadastro interno</small></div>
      {sent && <SendOutcome title={sent.title} results={sent.results} error={sent.error} />}
      {rfq ? <InvitedList ctx={ctx} rfq={rfq} onSent={onSent} /> : <Candidates ctx={ctx} req={req} onSent={onSent} />}
      <div className="dgs-sub-h"><Globe size={15} aria-hidden /><span>Buscar na internet (Apex)</span><small>Brasil e mundo</small></div>
      <Discover ctx={ctx} />
    </div>
  );
}

/* ── (a) homologados, sem cotação ainda ─────────────────────────────────── */

function Candidates({ ctx, req, onSent }: { ctx: FlowCtx; req: RequisitionView | null; onSent: (n: SentNotice) => void }) {
  const { data, today } = ctx;
  const [picked, setPicked] = useState<string[] | null>(null);
  const [dialog, setDialog] = useState(false);
  const [due, setDue] = useState<string | null>(null);
  // Depois de abrir a cotação, o convite some até a releitura trocar esta lista pelos convidados.
  const [invited, setInvited] = useState(false);
  const act = useSupplyAct();

  if (data.suppliers.state === 'restricted') return <StateNote kind="restricted" title="Restrito">Seu perfil não lê o cadastro de fornecedores.</StateNote>;
  if (data.suppliers.state === 'error') return <StateNote kind="error" title="Os fornecedores não carregaram">{data.suppliers.message}</StateNote>;
  const list = data.suppliers.data;
  if (list.length === 0) {
    return <StateNote kind="empty" title="Nenhum fornecedor homologado para este item">Busque na internet abaixo, ou cadastre e homologue em Compras.</StateNote>;
  }
  const selected = picked ?? preselectSuppliers(list);
  const canInvite = data.capabilities.source && Boolean(req?.lineId);
  const unit = data.focus?.item?.unit ?? null;
  const dueValue = due ?? defaultResponseDue(today, req?.requiredBy ?? data.focus?.needBy ?? null);
  const toggle = (id: string) => setPicked((p) => {
    const cur = p ?? selected;
    return cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
  });
  const names = list.filter((c) => selected.includes(c.supplierId)).map((c) => c.name);

  const confirm = async () => {
    if (!req?.lineId) return;
    const c = await act.run(RFQS_URL, rfqCreateBody(req.lineId, selected, dueValue));
    if (!c.ok) return;
    const rfqId = typeof c.result.rfq_id === 'string' ? c.result.rfq_id : null;
    const rfqNumber = typeof c.result.rfq_number === 'string' ? c.result.rfq_number : null;
    let results: SendResult[] = [];
    let sendError: string | null = null;
    if (rfqId) {
      act.setBusy(true);
      const s = await postGoverned(rfqSendUrl(rfqId), rfqSendBody(selected));
      act.setBusy(false);
      if (s.ok) results = sendResults(s.result); else sendError = s.message;
    } else {
      sendError = 'A cotação foi aberta, mas o servidor não devolveu o número para o envio — envie pela cotação.';
    }
    setInvited(true);
    onSent({ title: rfqNumber ? `Cotação ${rfqNumber} aberta` : 'Cotação aberta', results, error: sendError });
    setDialog(false);
    ctx.afterAct();
  };

  return (
    <>
      <ul className="dgs-cands" aria-label="Fornecedores homologados candidatos">
        {list.map((c) => {
          const on = selected.includes(c.supplierId);
          const facts = [pctText(c.onTimeRate) ? `${pctText(c.onTimeRate)} no prazo` : null, leadText(c.leadDays) ? `prazo ${leadText(c.leadDays)}` : null].filter(Boolean);
          const row = (
            <>
              <span className="dgs-cand-main">
                <b>{c.name}</b>
                <small>{BASIS[c.basis] ?? 'candidato'}{c.contactName ? ` · ${c.contactName}` : ''}</small>
              </span>
              <span className="dgs-cand-facts num">{facts.length ? facts.join(' · ') : 'sem histórico de entrega'}</span>
              <span className="dgs-cand-contact">
                <Mail size={14} aria-label={c.hasEmail ? 'Com e-mail' : 'Sem e-mail'} data-on={c.hasEmail ? 'true' : undefined} />
                <Phone size={14} aria-label={c.hasPhone ? 'Com telefone' : 'Sem telefone'} data-on={c.hasPhone ? 'true' : undefined} />
                {c.status === 'PROSPECT' && <Signal tone="warning" label="Em avaliação" />}
              </span>
            </>
          );
          return (
            <li key={c.supplierId} className="dgs-tile dgs-cand" data-on={on && canInvite ? 'true' : undefined}>
              {canInvite ? (
                <label className="dgs-cand-pick">
                  <input type="checkbox" checked={on} onChange={() => toggle(c.supplierId)} aria-label={`Convidar ${c.name}`} />
                  {row}
                </label>
              ) : <div className="dgs-cand-pick">{row}</div>}
            </li>
          );
        })}
      </ul>

      {invited ? null : canInvite ? (
        <button type="button" className="dgm-btn dgm-btn-wide" disabled={selected.length === 0}
          onClick={() => { act.reset(); setDialog(true); }} data-testid="dg-supply-invite">
          <Send size={16} aria-hidden />Convidar e enviar cotação{selected.length ? ` (${selected.length})` : ''}
        </button>
      ) : (
        <p className="dgs-hint">
          {!req ? 'Crie a solicitação de compra (etapa 4) para convidar fornecedores.'
            : !req.lineId ? 'A linha da solicitação não foi localizada — convide pela solicitação em Compras.'
              : 'Convidar e enviar a cotação cabe a Compras (quem cota).'}
        </p>
      )}

      {dialog && req && (
        <SupplyConfirm title="Convidar e enviar cotação" kind={`Cotação · solicitação ${req.number}`} amount={exactQtyText(req.qty, req.unit ?? unit)}
          what={names.join(' · ')}
          consequence="A cotação é aberta em Compras para esta solicitação e o pedido de cotação segue por e-mail a cada convidado: item, quantidade, necessidade e prazo de resposta — nunca preços internos nem os outros fornecedores."
          confirmLabel="Convidar e enviar" busy={act.busy} error={act.error} canConfirm={selected.length > 0 && Boolean(dueValue)}
          onConfirm={() => void confirm()} onCancel={() => { if (!act.busy) setDialog(false); }} testId="dg-supply-invite-confirm">
          <label className="ax-field dgs-field">
            <span>Responder até</span>
            <input type="date" value={dueValue ?? ''} min={today} onChange={(e) => setDue(e.target.value || null)} disabled={act.busy} />
          </label>
        </SupplyConfirm>
      )}
    </>
  );
}

/* ── (a) homologados, com cotação aberta: convidados e envio ────────────── */

function InvitedList({ ctx, rfq, onSent }: { ctx: FlowCtx; rfq: RfqView; onSent: (n: SentNotice) => void }) {
  const { data } = ctx;
  const [dialog, setDialog] = useState(false);
  // Quem o último envio JÁ atendeu (enviada, registrada em teste, já enviada, sem contato) sai do botão até a releitura;
  // quem FALHOU continua nele — "tente de novo" tem onde clicar.
  const [handled, setHandled] = useState<string[]>([]);
  const act = useSupplyAct();
  const unsent = unsentPending(unsentInvited(rfq), handled);
  const canSend = data.capabilities.source && rfq.status === 'OPEN' && unsent.length > 0;
  const names = rfq.invited.filter((i) => unsent.includes(i.supplierId)).map((i) => i.name);

  const confirm = async () => {
    const r = await act.run(rfqSendUrl(rfq.id), rfqSendBody(unsent));
    if (r.ok) {
      const results = sendResults(r.result);
      setHandled((h) => [...new Set([...h, ...handledBySend(results)])]);
      onSent({ title: `Envio da cotação ${rfq.number}`, results, error: null });
      setDialog(false);
      ctx.afterAct();
    }
  };

  return (
    <>
      <p className="dgs-lead">
        Cotação <b className="num">{rfq.number}</b> · {rfq.statusLabel}{rfq.responseDue ? ` · resposta até ${dayMonth(rfq.responseDue)}` : ''}
      </p>
      {rfq.invited.length === 0 ? (
        <StateNote kind="empty" title="Nenhum fornecedor convidado nesta cotação." />
      ) : (
        <ul className="dgs-cands" aria-label="Fornecedores convidados">
          {rfq.invited.map((i) => {
            const quoted = rfq.quotes.some((q) => q.supplier.id === i.supplierId);
            return (
              <li key={i.supplierId} className="dgs-tile dgs-cand">
                <div className="dgs-cand-pick">
                  <span className="dgs-cand-main"><b>{i.name}</b>
                    <small>{i.sentAt ? `Cotação enviada ${dateTime(i.sentAt)}` : quoted ? 'Proposta registrada em Compras'
                      : i.hasContact ? 'Cotação ainda não enviada' : 'Sem e-mail cadastrado'}</small>
                  </span>
                  <span className="dgs-cand-contact">
                    {quoted ? <Signal tone="success" label="Proposta recebida" />
                      : i.sentAt ? <Signal tone="info" label="Aguardando proposta" />
                        : <Signal tone={i.hasContact ? 'warning' : 'neutral'} label={i.hasContact ? 'Não enviada' : 'Sem contato'} />}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {canSend && (
        <button type="button" className="dgm-btn dgm-btn-wide" onClick={() => { act.reset(); setDialog(true); }} data-testid="dg-supply-send">
          <Send size={16} aria-hidden />Enviar cotação ({unsent.length})
        </button>
      )}
      <Link className="dgm-textbtn" href={rfq.href}>Abrir a cotação em Compras<ArrowUpRight size={13} aria-hidden /></Link>
      {dialog && (
        <SupplyConfirm title="Enviar cotação" kind={`Cotação ${rfq.number}`} what={names.join(' · ')}
          consequence="O pedido de cotação segue por e-mail a cada convidado ainda sem envio: item, quantidade, necessidade e prazo de resposta — nunca preços internos nem os outros fornecedores."
          confirmLabel="Enviar" busy={act.busy} error={act.error}
          onConfirm={() => void confirm()} onCancel={() => { if (!act.busy) setDialog(false); }} testId="dg-supply-send-confirm" />
      )}
    </>
  );
}

function SendOutcome({ title, results, error }: { title: string; results: SendResult[]; error: string | null }) {
  return (
    <div className="dgm-live" role="status" aria-live="polite">
      <ActNotice tone={error ? 'warning' : 'success'} title={title}>
        {error ? `O envio não foi confirmado: ${error}` : results.length === 0 ? 'Nenhum envio a registrar.' : null}
      </ActNotice>
      {results.length > 0 && (
        <ul className="dgs-sent" data-testid="dg-supply-send-results">
          {results.map((r) => {
            const o = SEND_OUTCOME[r.outcome];
            return <li key={r.supplierId}><span>{r.name}</span><Signal tone={o.tone} label={o.label} title={r.message || undefined} /></li>;
          })}
        </ul>
      )}
    </div>
  );
}

/* ── (b) internet: a Apex sugere, a pessoa verifica ─────────────────────── */

type DiscoverState = { kind: 'idle' } | { kind: 'loading' } | { kind: 'done'; res: SupplierDiscoveryResponse };
/** O cadastro interno, lido para conferir os candidatos antes de oferecer "Cadastrar como prospecto". */
type RegistryState = { state: 'ok'; list: RegistrySupplier[] } | { state: 'restricted' | 'error' } | null;

const CONFIDENCE: Record<ExternalSupplierCandidate['confidence'], string> = { high: 'confiança alta', medium: 'confiança média', low: 'confiança baixa' };
const PROVIDER_NAME: Record<string, string> = { anthropic: 'Anthropic', openai: 'OpenAI' };

/** GET /api/supply/suppliers — só leitura; falha e forma inesperada nunca viram "ninguém no cadastro". */
async function readRegistry(fetcher: typeof fetch = fetch): Promise<Exclude<RegistryState, null>> {
  try {
    const r = await fetcher(SUPPLIERS_URL, { method: 'GET', headers: { accept: 'application/json' } });
    if (r.status === 401 || r.status === 403) return { state: 'restricted' };
    const list = r.ok ? registryList(await r.json().catch(() => null)) : null;
    return list ? { state: 'ok', list } : { state: 'error' };
  } catch {
    return { state: 'error' };
  }
}

function Discover({ ctx }: { ctx: FlowCtx }) {
  const { data, projectId, today } = ctx;
  const [st, setSt] = useState<DiscoverState>({ kind: 'idle' });
  const [registry, setRegistry] = useState<RegistryState>(null);
  const [prospect, setProspect] = useState<ExternalSupplierCandidate | null>(null);
  const [registered, setRegistered] = useState<Record<string, string>>({});
  const act = useSupplyAct();
  const caps = data.capabilities;
  const focus = data.focus;

  if (!caps.aiSearch.available) {
    return (
      <p className="dgs-calm" data-testid="dg-supply-discover-off">
        <Globe size={15} aria-hidden /><span>{caps.aiSearch.reason ?? 'Busca externa desligada nesta instalação'}. A lista interna acima segue valendo.</span>
      </p>
    );
  }
  if (!caps.source && !caps.request) return <p className="dgs-calm"><Globe size={15} aria-hidden /><span>Pedir a busca externa cabe a Compras ou a quem requisita compras.</span></p>;
  if (!focus) return null;

  const loadRegistry = async () => { setRegistry(await readRegistry()); };
  const run = async () => {
    setSt({ kind: 'loading' });
    // Quem pode cadastrar confere o cadastro JUNTO com a busca: candidato que já existe não vira "cadastrar".
    const [res] = await Promise.all([postDiscovery(discoverUrl(projectId), focus.requirementId), caps.suppliersManage ? loadRegistry() : Promise.resolve()]);
    setSt({ kind: 'done', res });
  };
  const register = async () => {
    if (!prospect) return;
    const r = await act.run(SUPPLIERS_URL, prospectBody(prospect, today));
    if (r.ok) {
      // O cadastro reusa a parte pelo documento: `party_created:false` = a empresa já existia (confira em Compras).
      const existed = r.replayed || r.result.party_created === false;
      setRegistered((m) => ({ ...m, [prospect.name]: existed ? 'Já existia no cadastro — confira em Compras' : 'Cadastrado como prospecto' }));
      setProspect(null);
      ctx.afterAct();
      void loadRegistry();
    }
  };
  const itemLine = [focus.item?.description ?? focus.title, focus.item?.code].filter(Boolean).join(' · ');

  if (st.kind === 'idle') {
    return (
      <div className="dgs-disc">
        <p className="dgs-hint">A Apex procura fornecedores deste item no Brasil e no mundo e traz os contatos com as fontes.</p>
        <p className="dgs-disc-out" data-testid="dg-supply-discover-out">
          <b>O que sai da empresa:</b>{` a busca envia ao provedor de IA e à busca na web a descrição e o código do item (${itemLine}), a categoria, a quantidade e a UF de entrega. Nenhum fornecedor é contatado.`}
        </p>
        <button type="button" className="dgm-link" onClick={() => void run()} data-testid="dg-supply-discover"><Globe size={15} aria-hidden />Buscar na internet (Apex)</button>
      </div>
    );
  }
  if (st.kind === 'loading') {
    return (
      <div className="dgs-disc" role="status">
        <p className="dgs-hint"><Spin />Apex buscando fornecedores deste item na internet…</p>
        <SkeletonLines lines={3} label="Buscando fornecedores…" />
      </div>
    );
  }
  const res = st.res;
  if (!res.ok) {
    if (res.reason === 'ai_unavailable') return <p className="dgs-calm"><Globe size={15} aria-hidden /><span>{res.message}. A lista interna acima segue valendo.</span></p>;
    if (res.reason === 'restricted') return <StateNote kind="restricted" title="Restrito">{res.message}</StateNote>;
    return <StateNote kind="error" title="A busca externa não foi feita" onRetry={() => void run()}>{res.message}</StateNote>;
  }
  const provider = PROVIDER_NAME[(res.provider ?? '').toLowerCase()] ?? null;
  const at = res.runAt ? dateTime(res.runAt) : null;
  // Cadastrar só depois de conferir o cadastro interno: sem essa leitura, o botão não aparece (nunca um "cadastrar" às cegas).
  const regList = registry?.state === 'ok' ? registry.list : null;
  return (
    <div className="dgs-disc" data-testid="dg-supply-discover-results">
      {res.query && (
        <p className="dgs-disc-out" data-testid="dg-supply-discover-query">
          <b>{`Enviado ao provedor de IA${provider ? ` (${provider})` : ''} e à busca na web${at ? ` em ${at}` : ''}:`}</b>{` ${res.query}. Nenhum fornecedor foi contatado.`}
        </p>
      )}
      <p className="dgs-lead">
        <Signal tone="warning" label="Não homologados — verificar" />
        <span>{res.candidates.length === 0 ? 'A busca não encontrou fornecedor com fonte verificável.' : `${res.candidates.length} ${res.candidates.length === 1 ? 'candidato' : 'candidatos'} com fonte. A Apex sugere — a pessoa verifica.`}</span>
      </p>
      {caps.suppliersManage && res.candidates.length > 0 && registry && registry.state !== 'ok' && (
        <StateNote kind={registry.state === 'restricted' ? 'restricted' : 'error'} title={registry.state === 'restricted' ? 'Restrito' : 'O cadastro de fornecedores não carregou'}
          onRetry={registry.state === 'error' ? () => void loadRegistry() : undefined} testId="dg-supply-registry-note">
          {registry.state === 'restricted'
            ? 'Seu perfil não lê o cadastro de fornecedores: cadastre o prospecto pela tela de Fornecedores em Compras.'
            : 'Sem conferir o cadastro, "Cadastrar como prospecto" fica fora — um fornecedor que já existe seria sobrescrito.'}
        </StateNote>
      )}
      <ul className="dgs-exts">
        {res.candidates.map((c, i) => {
          const site = safeHttpUrl(c.site);
          const sources = c.evidenceUrls.map(safeHttpUrl).filter((u): u is string => Boolean(u)).slice(0, 4);
          const where = [c.city, c.uf, c.country].filter(Boolean).join(' · ');
          const cnpj = cnpjText(c.cnpj);
          const known = regList ? registryMatch(c, regList) : null;
          const done = registered[c.name];
          return (
            <li key={`${c.name}:${i}`} className="dgs-tile dgs-ext">
              <div className="dgs-ext-top">
                <b>{c.name}</b>
                <Signal tone="warning" label="Não homologado — verificar" />
              </div>
              {(where || cnpj) && <p className="dgs-ext-where">{[where, cnpj ? `CNPJ ${cnpj}` : null].filter(Boolean).join(' · ')}</p>}
              <ul className="dgs-ext-contact">
                {site && <li><a href={site} target="_blank" rel="noopener noreferrer"><ExternalLink size={13} aria-hidden />{hostOf(site)}</a></li>}
                {c.email && <li><Mail size={13} aria-hidden /><span>{c.email}</span></li>}
                {c.phone && <li><Phone size={13} aria-hidden /><span className="num">{c.phone}</span></li>}
              </ul>
              {c.note && <p className="dgs-ext-note">{c.note}</p>}
              <p className="dgs-ext-src">
                <span>{CONFIDENCE[c.confidence] ?? 'confiança não informada'} · fontes:</span>
                {sources.map((u) => <a key={u} href={u} target="_blank" rel="noopener noreferrer">{hostOf(u)}</a>)}
              </p>
              {done ? <Signal tone="success" label={done} />
                : known ? (
                  <p className="dgs-ext-known" data-testid="dg-supply-ext-known">
                    <Signal tone={known.status === 'HOMOLOGATED' ? 'success' : known.status === 'PROSPECT' ? 'info' : 'warning'}
                      label={`Já no cadastro · ${supplierStatusText(known.status)}`} />
                    <span>{known.name || known.legalName}</span>
                  </p>
                ) : caps.suppliersManage && regList ? (
                  <button type="button" className="dgm-btn-quiet dgs-ext-act" onClick={() => { act.reset(); setProspect(c); }}>
                    <UserPlus size={15} aria-hidden />Cadastrar como prospecto
                  </button>
                ) : null}
            </li>
          );
        })}
      </ul>
      {prospect && (
        <SupplyConfirm title="Cadastrar como prospecto" kind="Fornecedor · não homologado" what={prospect.name}
          consequence="O fornecedor entra no cadastro como PROSPECTO (em avaliação), com a origem e as fontes nas notas — conferido antes: não está no cadastro interno pelo CNPJ, e-mail ou nome. Nada é enviado a ele; para convidá-lo a uma cotação, verifique e homologue em Compras antes."
          confirmLabel="Cadastrar prospecto" busy={act.busy} error={act.error}
          onConfirm={() => void register()} onCancel={() => { if (!act.busy) setProspect(null); }} testId="dg-supply-prospect-confirm" />
      )}
    </div>
  );
}
