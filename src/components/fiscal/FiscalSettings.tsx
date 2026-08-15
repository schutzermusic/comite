'use client';

import { useState } from 'react';
import { CheckCircle2, PlugZap, RefreshCw, Settings2, ShieldAlert } from 'lucide-react';
import { HudButton, HudHeader, HudPageLayout, HudPanel } from '@/components/hud';
import { fiscalFetch } from './fiscal-ui';
import { useFiscalMasterData } from './use-fiscal-data';

export function FiscalSettings() {
  const master = useFiscalMasterData();
  const [message, setMessage] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const enableSandbox = async (establishmentId: string) => {
    setProcessing(true); setMessage(null);
    try {
      await fiscalFetch('/api/fiscal/provider-config', { method: 'POST', body: JSON.stringify({ establishmentId, providerKey: 'sandbox', environment: 'homologation', enabled: true }) });
      setMessage('Integração de homologação habilitada.');
      await master.refresh();
    } catch (err) { setMessage(err instanceof Error ? err.message : 'Falha ao configurar integração.'); }
    finally { setProcessing(false); }
  };
  const processQueue = async () => {
    setProcessing(true); setMessage(null);
    try { const response = await fiscalFetch<{ ok: true; processed: number }>('/api/fiscal/jobs', { method: 'POST' }); setMessage(`${response.processed} tarefa(s) fiscal(is) processada(s).`); }
    catch (err) { setMessage(err instanceof Error ? err.message : 'Falha ao processar fila.'); }
    finally { setProcessing(false); }
  };
  return (
    <HudPageLayout maxWidth="xl">
      <HudHeader title="Configuração e Integração" subtitle="Ambientes, provedores, certificados e prontidão operacional" icon={<Settings2 className="h-5 w-5" />} iconTint="#17C3B2" breadcrumbs={[{ label: 'Fiscal', href: '/fiscal' }, { label: 'Configuração' }]} actions={<HudButton variant="secondary" leftIcon={<RefreshCw className="h-4 w-4" />} isLoading={processing} onClick={processQueue}>Processar fila</HudButton>} />
      {message && <HudPanel state={/habilitada|processada/i.test(message) ? 'success' : 'warning'}><p className="text-sm">{message}</p></HudPanel>}
      <HudPanel title="Estabelecimentos e conectores" subtitle="Produção permanece bloqueada sem conector fiscal homologado" icon={<PlugZap className="h-4 w-4" />}>
        {master.establishments.length === 0 ? <p className="py-8 text-center text-sm text-ig-fg-muted">Cadastre um estabelecimento antes de configurar a integração.</p> : <div className="space-y-3">{master.establishments.map((establishment) => {
          const config = master.providerConfigs.find((entry) => entry.establishment_id === establishment.id && entry.enabled);
          const sandboxAvailable = establishment.environment === 'homologation';
          return <div key={establishment.id} className="flex flex-col gap-4 rounded-xl border border-ig-border p-4 lg:flex-row lg:items-center lg:justify-between"><div><div className="flex items-center gap-2"><p className="font-semibold text-ig-fg-strong">{establishment.legal_name}</p><span className={`rounded-full border px-2 py-0.5 text-[10px] ${establishment.environment === 'production' ? 'border-ig-warning text-ig-warning' : 'border-ig-info text-ig-info'}`}>{establishment.environment}</span></div><p className="mt-1 text-xs text-ig-fg-muted">{config ? `${config.provider_key} · ${config.last_health_status ?? 'sem health check'}` : 'Nenhum provedor habilitado'}</p></div><div>{config ? <span className="inline-flex items-center gap-2 text-xs font-semibold text-ig-success"><CheckCircle2 className="h-4 w-4" />Conector ativo</span> : sandboxAvailable ? <HudButton size="sm" variant="primary" isLoading={processing} onClick={() => enableSandbox(establishment.id)}>Habilitar sandbox</HudButton> : <span className="inline-flex items-center gap-2 text-xs text-ig-warning"><ShieldAlert className="h-4 w-4" />Credenciais de produção necessárias</span>}</div></div>;
        })}</div>}
      </HudPanel>
      <div className="grid gap-6 md:grid-cols-2">
        <HudPanel title="Checklist de go-live" icon={<ShieldAlert className="h-4 w-4" />}>
          <Checklist ok={master.establishments.some((entry) => entry.environment === 'homologation')} label="Estabelecimento testado em homologação" />
          <Checklist ok={master.services.some((entry) => entry.approved_by_accountant)} label="Serviço e alíquotas aprovados pelo contador" />
          <Checklist ok={master.parties.length > 0} label="Tomadores com dados fiscais" />
          <Checklist ok={master.providerConfigs.some((entry) => entry.enabled)} label="Conector habilitado" />
          <Checklist ok={false} label="Credenciais oficiais e piloto aprovados" />
        </HudPanel>
        <HudPanel title="Política de segurança" icon={<CheckCircle2 className="h-4 w-4" />}>
          <ul className="space-y-3 text-xs text-ig-fg-muted"><li>• Credenciais e certificado nunca são devolvidos ao navegador.</li><li>• XML e DANFSe permanecem em bucket privado.</li><li>• Produção exige conector real; sandbox falha de forma fechada.</li><li>• Toda transição gera evento fiscal imutável.</li><li>• Retentativas usam fila e chave idempotente.</li></ul>
        </HudPanel>
      </div>
    </HudPageLayout>
  );
}

function Checklist({ ok, label }: { ok: boolean; label: string }) {
  return <div className="flex items-center gap-3 border-b border-ig-border-subtle py-3 last:border-0"><span className={`flex h-6 w-6 items-center justify-center rounded-full ${ok ? 'bg-[color-mix(in_oklab,var(--ig-success)_15%,transparent)] text-ig-success' : 'bg-ig-panel text-ig-fg-subtle'}`}>{ok ? <CheckCircle2 className="h-4 w-4" /> : '·'}</span><span className={ok ? 'text-sm text-ig-fg-strong' : 'text-sm text-ig-fg-muted'}>{label}</span></div>;
}

