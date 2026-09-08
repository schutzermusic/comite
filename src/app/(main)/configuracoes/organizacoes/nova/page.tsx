"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Building2, Loader2 } from "lucide-react";
import { HudHeader } from "@/components/hud/HudHeader";
import { HudInput } from "@/components/hud/HudInput";
import { HudPanel } from "@/components/hud/HudPanel";
import { HudSelect } from "@/components/hud/HudSelect";
import { SettingRow } from "@/components/settings/SettingRow";
import { useCurrentUser } from "@/hooks/use-current-user";
import { switchOrganization } from "@/lib/auth/organization-switch";
import { createClient } from "@/utils/supabase/client";

/**
 * Provisionamento governado (§10).
 *
 * O formulário pede o MÍNIMO conservador. Nada aqui que pertença ao Fiscal ou
 * ao Financeiro é pedido — porque nada disso é autoritativo ainda, e um campo
 * preenchido às pressas viraria configuração inventada. A organização nasce
 * VAZIA e diz isso na tela seguinte.
 *
 * A chave de idempotência é gerada uma vez por montagem do formulário: dois
 * cliques no botão, ou uma retentativa de rede, devolvem a MESMA organização em
 * vez de criarem duas (§38).
 */
const ERROR_MESSAGE: Record<string, string> = {
  ENTERPRISE_PROVISIONING_NOT_ALLOWED:
    "Você não tem autoridade de provisionamento neste grupo empresarial.",
  ORGANIZATION_NAME_REQUIRED: "Informe o nome da organização.",
  ORGANIZATION_SLUG_TAKEN: "Já existe uma organização com um identificador equivalente.",
  NOT_AUTHENTICATED: "Sessão expirada. Entre novamente.",
};

const CURRENCIES = [
  { value: "BRL", label: "BRL — Real" },
  { value: "USD", label: "USD — Dólar" },
  { value: "EUR", label: "EUR — Euro" },
];

export default function NovaOrganizacaoPage() {
  const router = useRouter();
  const { canProvisionOrganizations, loading } = useCurrentUser();
  const idempotencyKey = useMemo(() => crypto.randomUUID(), []);

  const [name, setName] = useState("");
  const [legalName, setLegalName] = useState("");
  const [country, setCountry] = useState("BR");
  const [currency, setCurrency] = useState("BRL");
  const [timezone, setTimezone] = useState("America/Sao_Paulo");
  const [legalIdentifier, setLegalIdentifier] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!loading && !canProvisionOrganizations) {
    return (
      <>
        <HudHeader
          title="Nova organização"
          subtitle="Provisionamento é autoridade do grupo empresarial."
          icon={<Building2 size={18} />}
          iconTint="#64748B"
        />
        <div className="mt-6">
          <HudPanel elevation={2} title="Sem autoridade de provisionamento">
            <p className="text-ig-body-sm text-ig-fg-muted" data-testid="provisioning-denied">
              Criar organização exige titularidade ou administração da conta empresarial.
              Ser administrador de uma organização não concede essa autoridade — são coisas
              separadas por desenho.
            </p>
          </HudPanel>
        </div>
      </>
    );
  }

  const submit = async () => {
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { data, error: rpcError } = await supabase.rpc("organization_provision", {
      p_name: name.trim(),
      p_legal_name: legalName.trim() || null,
      p_country_code: country || null,
      p_default_currency: currency || null,
      p_timezone: timezone || null,
      p_legal_identifier: legalIdentifier.trim() || null,
      p_idempotency_key: idempotencyKey,
    });

    if (rpcError) {
      const code = Object.keys(ERROR_MESSAGE).find((key) => rpcError.message.includes(key));
      setError(code ? ERROR_MESSAGE[code] : rpcError.message);
      setBusy(false);
      return;
    }

    const created = data as { organization_id: string };
    // Entrar na organização recém-criada recarrega a página inteira, o que
    // descarta qualquer estado do inquilino anterior.
    const result = await switchOrganization(created.organization_id, "/configuracoes/organizacoes");
    if (!result.ok) {
      setError(result.message);
      setBusy(false);
      router.refresh();
    }
  };

  return (
    <>
      <HudHeader
        title="Nova organização"
        subtitle="A organização nasce vazia. Nenhum contrato, projeto, faturamento ou configuração é copiado."
        icon={<Building2 size={18} />}
        iconTint="#64748B"
      />

      <div className="mt-6 flex flex-col gap-6">
        <HudPanel elevation={2} title="Identificação">
          <SettingRow label="Nome da organização">
            <HudInput
              value={name}
              onChange={(event) => setName(event.target.value)}
              className="w-80"
              placeholder="Insight Energy — Produção"
              data-testid="organization-name"
            />
          </SettingRow>
          <SettingRow label="Razão social">
            <HudInput
              value={legalName}
              onChange={(event) => setLegalName(event.target.value)}
              className="w-80"
            />
          </SettingRow>
          <SettingRow label="País">
            <HudInput
              value={country}
              onChange={(event) => setCountry(event.target.value.toUpperCase().slice(0, 2))}
              className="w-24"
            />
          </SettingRow>
          <SettingRow label="Moeda padrão">
            <HudSelect
              value={currency}
              options={CURRENCIES}
              onChange={setCurrency}
              className="w-56"
            />
          </SettingRow>
          <SettingRow label="Fuso horário">
            <HudInput
              value={timezone}
              onChange={(event) => setTimezone(event.target.value)}
              className="w-72"
            />
          </SettingRow>
          <SettingRow
            label="Identificador legal (CNPJ)"
            description="Opcional. A configuração fiscal é feita depois, no módulo Fiscal — nada é herdado de outra organização."
          >
            <HudInput
              value={legalIdentifier}
              onChange={(event) => setLegalIdentifier(event.target.value)}
              className="w-60"
            />
          </SettingRow>
        </HudPanel>

        <HudPanel elevation={1} title="O que NÃO será criado">
          <ul className="flex flex-col gap-1 text-ig-body-sm text-ig-fg-muted">
            <li>· nenhum contrato, projeto, medição, faturamento ou risco;</li>
            <li>· nenhum documento fiscal, emitente ou credencial;</li>
            <li>· nenhum recebível, liquidação ou conciliação;</li>
            <li>· nenhuma política de aprovação ou alçada de faturamento;</li>
            <li>· nenhum dado da organização atual é copiado.</li>
          </ul>
        </HudPanel>

        {error && (
          <p className="text-ig-body-sm text-ig-danger" role="alert" data-testid="provision-error">
            {error}
          </p>
        )}

        <div>
          <button
            type="button"
            disabled={busy || name.trim().length === 0}
            onClick={() => void submit()}
            data-testid="provision-submit"
            className="flex items-center gap-2 rounded-[var(--ig-radius-md)] bg-ig-accent px-4 py-2 text-ig-body-sm font-medium text-ig-accent-fg disabled:opacity-40"
          >
            {busy && <Loader2 size={13} className="animate-spin" />}
            Criar organização
          </button>
        </div>
      </div>
    </>
  );
}
