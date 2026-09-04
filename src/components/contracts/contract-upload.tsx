'use client';

/**
 * Entrada de contrato — o fluxo guiado que traz um contrato REAL para dentro
 * do módulo.
 *
 * Este arquivo foi reescrito em P2F. O que ele fazia antes, e por que mudou:
 *
 *  · INVENTAVA VIGÊNCIA. `expirationDate || addDays(new Date(), 365)` gravava
 *    um vencimento de um ano quando o usuário não informava um, e
 *    `addDays(expirationDate, -60)` inventava a data de renovação. Os dois
 *    viravam colunas de um contrato `live`, alimentavam o Horizonte de
 *    Renovação e o PDF oficial, e ninguém conseguia distinguir a data lida do
 *    papel da data que o formulário chutou. `end_date` e `renewal_date` são
 *    nullable exatamente para poderem ficar vazias.
 *
 *  · ENCENAVA UMA ANÁLISE. Uma etapa inteira exibia barra de progresso parada
 *    em 68% e onze selos "mock pendente" sobre capacidades que não existiam.
 *    A extração assistida existe de verdade desde P2D/P2E, roda no servidor e
 *    grava propostas para revisão humana — é ela que aparece aqui agora, como
 *    passo OPCIONAL após a criação, e o contrato se completa sem ela.
 *
 *  · PROMETIA UMA ROTA DE APROVAÇÃO. A revisão anunciava "Jurídico +
 *    Financeiro + Comitê" conforme o risco calculado; nada no salvamento criava
 *    etapa de aprovação alguma.
 *
 *  · REGISTRAVA O RESPONSÁVEL COMO TEXTO. "Gestão de Contratos" era digitado
 *    livremente e terminava concatenado dentro de `scope_summary`, enquanto
 *    `owner_user_id` caía silenciosamente no usuário que criou. Agora é um
 *    membro real da organização, escolhido da lista.
 *
 *  · MANDAVA O PDF PARA O LUGAR ERRADO. O anexo ia para `contract_files`, que
 *    não tem tipo, não tem versão, não tem linhagem e não é lido pelo extrator.
 *    O documento original agora entra em `contract_documents`, onde toda a
 *    maquinaria de versionamento e análise já sabe operar.
 *
 * O componente não decide nada sobre persistência: monta um rascunho tipado e
 * entrega. Quem grava é a página, por `onSubmit`.
 */

import { useEffect, useMemo, useState } from 'react';
import type { Project } from '@/lib/types';
import { HudBadge, HudButton, HudDrawer, HudInput, HudPanel } from '@/components/hud';
import { Input } from '@/components/ui/input';
import {
  AlertTriangle,
  Building2,
  CalendarRange,
  CheckCircle,
  ChevronLeft,
  ChevronRight,
  FileText,
  ShieldCheck,
  Upload,
  UserRound,
  Workflow,
} from 'lucide-react';
import { listOrgMembers } from '@/lib/services/agenda';
import type { OrgMember } from '@/lib/types/agenda';

/** O que o assistente entrega. Campos vazios chegam como `null`, nunca inventados. */
export type ContractOnboardingDraft = {
  readonly title: string;
  readonly contractNumber: string;
  readonly counterpartyName: string;
  readonly contractType: string;
  readonly ownerUserId: string;
  readonly status: string;
  readonly startDate: string | null;
  readonly endDate: string | null;
  readonly signedDate: string | null;
  readonly renewalDate: string | null;
  readonly currency: string;
  readonly totalValue: number | null;
  readonly monthlyValue: number | null;
  readonly paymentTerms: string | null;
  readonly scopeSummary: string | null;
  readonly riskLevel: 'low' | 'medium' | 'high';
  readonly projectId: string | null;
  /** PDF original. Entra em `contract_documents` com o tipo escolhido. */
  readonly document: { readonly file: File; readonly title: string; readonly documentType: string } | null;
  /** Rodar a extração assistida logo após criar. Jamais requisito. */
  readonly runExtraction: boolean;
};

export interface ContractUploadProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (draft: ContractOnboardingDraft) => void | Promise<void>;
  projects?: Project[];
  companies?: string[];
}

const STEPS = ['Identidade', 'Vigência e valor', 'Projeto', 'Documento', 'Revisão'] as const;

const CONTRACT_TYPES = [
  'Prestação de serviços',
  'Fornecimento',
  'Ordem de serviço',
  'Manutenção',
  'Aditivo contratual',
];

/**
 * Situação do contrato ao ser cadastrado.
 *
 * Alimenta `status`. `lifecycle_stage` NÃO recebe este valor: são vocabulários
 * diferentes, e copiar um no outro — como se fazia — deixava o estágio de ciclo
 * de vida dizendo "negotiation", que não é um estágio.
 */
const CONTRACT_STATUSES = [
  { value: 'negotiation', label: 'Em negociação' },
  { value: 'legal_review', label: 'Revisão jurídica' },
  { value: 'commercial_review', label: 'Revisão comercial' },
  { value: 'signed', label: 'Assinado' },
  { value: 'active', label: 'Ativo / em execução' },
];

const DOCUMENT_TYPES = [
  { value: 'contract', label: 'Contrato' },
  { value: 'amendment', label: 'Aditivo' },
  { value: 'annex', label: 'Anexo' },
  { value: 'purchase_order', label: 'Ordem de compra' },
];

const RISK_LEVELS = [
  { value: 'low', label: 'Baixo' },
  { value: 'medium', label: 'Médio' },
  { value: 'high', label: 'Alto' },
];

/** Converte texto monetário em número. String vazia é AUSÊNCIA, não zero. */
function parseAmount(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const normalized = trimmed.replace(/\./g, '').replace(',', '.').replace(/[^\d.-]/g, '');
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

const blank = () => ({
  title: '',
  contractNumber: '',
  counterparty: '',
  type: CONTRACT_TYPES[0],
  ownerUserId: '',
  status: 'negotiation',
  startDate: '',
  endDate: '',
  signedDate: '',
  renewalDate: '',
  totalValue: '',
  monthlyValue: '',
  paymentTerms: '',
  scopeSummary: '',
  riskLevel: 'medium',
  projectId: '',
  documentType: 'contract',
  runExtraction: false,
});

const selectClass =
  'h-10 w-full rounded-lg border border-ig-border-strong bg-ig-panel px-3 text-sm text-ig-fg-strong outline-none transition-colors focus:border-ig-border-focus';
const textareaClass =
  'w-full rounded-lg border border-ig-border-strong bg-ig-panel p-3 text-sm leading-relaxed text-ig-fg-strong outline-none transition-colors focus:border-ig-border-focus';

export function ContractUpload({
  open,
  onOpenChange,
  onSubmit,
  projects = [],
  companies = [],
}: ContractUploadProps) {
  const [step, setStep] = useState(0);
  const [file, setFile] = useState<File | null>(null);
  const [form, setForm] = useState(blank);
  const [members, setMembers] = useState<OrgMember[]>([]);
  const [membersError, setMembersError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  /*
    Membros reais da organização, via `list_organization_members` — a mesma
    ponte SECURITY DEFINER que Agenda e Timeline usam. Falhar aqui não impede
    o cadastro de prosseguir: impede apenas de atribuir responsável, e a tela
    diz isso em vez de oferecer uma lista vazia sem explicação.
  */
  useEffect(() => {
    if (!open) return;
    let alive = true;
    listOrgMembers()
      .then((rows) => { if (alive) { setMembers(rows); setMembersError(null); } })
      .catch((err: unknown) => {
        if (alive) setMembersError(err instanceof Error ? err.message : 'Falha ao listar responsáveis.');
      });
    return () => { alive = false; };
  }, [open]);

  const selectedProject = projects.find((p) => p.id === form.projectId) || null;
  const selectedOwner = members.find((m) => m.userId === form.ownerUserId) || null;
  const totalValue = parseAmount(form.totalValue);

  /**
   * O que falta para o contrato poder ser criado.
   *
   * É a identidade mínima que torna o contrato identificável e auditável —
   * nada além. Documento e projeto NÃO estão aqui de propósito: um contrato em
   * negociação legitimamente ainda não tem papel assinado nem projeto aberto, e
   * exigi-los na porta empurraria a equipe a cadastrar depois, fora do sistema.
   * O que falta depois da criação é assunto da lista de prontidão do dossiê.
   */
  const missing = useMemo(() => {
    const out: string[] = [];
    if (!form.title.trim()) out.push('Nome do contrato');
    if (!form.contractNumber.trim()) out.push('Nº do contrato');
    if (!form.counterparty.trim()) out.push('Contraparte');
    if (!form.type.trim()) out.push('Tipo de contrato');
    if (!form.ownerUserId) out.push('Responsável interno');
    if (totalValue === null) out.push('Valor contratual');
    return out;
  }, [form.title, form.contractNumber, form.counterparty, form.type, form.ownerUserId, totalValue]);

  /**
   * Incoerências de data. São BLOQUEIOS, não avisos: gravar um fim de vigência
   * anterior ao início produz um contrato que o Horizonte de Renovação lê como
   * já vencido no instante em que nasce.
   */
  const dateConflicts = useMemo(() => {
    const out: string[] = [];
    if (form.startDate && form.endDate && form.endDate < form.startDate) {
      out.push('O fim da vigência é anterior ao início.');
    }
    if (form.renewalDate && form.endDate && form.renewalDate > form.endDate) {
      out.push('A data de renovação é posterior ao fim da vigência.');
    }
    return out;
  }, [form.startDate, form.endDate, form.renewalDate]);

  const blocked = missing.length > 0 || dateConflicts.length > 0;

  const setField = (key: keyof ReturnType<typeof blank>, value: string | boolean) =>
    setForm((current) => ({ ...current, [key]: value }));

  const handleClose = () => {
    if (submitting) return;
    setStep(0);
    setFile(null);
    setForm(blank());
    onOpenChange(false);
  };

  const handleSave = async () => {
    if (blocked) return;
    setSubmitting(true);
    try {
      await onSubmit({
        title: form.title.trim(),
        contractNumber: form.contractNumber.trim(),
        counterpartyName: form.counterparty.trim(),
        contractType: form.type,
        ownerUserId: form.ownerUserId,
        status: form.status,
        // Datas em branco permanecem em branco. O banco aceita nulo em todas.
        startDate: form.startDate || null,
        endDate: form.endDate || null,
        signedDate: form.signedDate || null,
        renewalDate: form.renewalDate || null,
        currency: 'BRL',
        totalValue,
        monthlyValue: parseAmount(form.monthlyValue),
        paymentTerms: form.paymentTerms.trim() || null,
        scopeSummary: form.scopeSummary.trim() || null,
        riskLevel: form.riskLevel as 'low' | 'medium' | 'high',
        projectId: form.projectId || null,
        document: file
          ? { file, title: file.name, documentType: form.documentType }
          : null,
        runExtraction: Boolean(file) && form.runExtraction,
      });
      handleClose();
    } finally {
      setSubmitting(false);
    }
  };

  const Field = ({ label, required, hint, children, span }: {
    label: string; required?: boolean; hint?: string; children: React.ReactNode; span?: boolean;
  }) => (
    <label className={span ? 'md:col-span-2' : undefined}>
      <span className="mb-1.5 block text-ig-label text-ig-fg-muted">
        {label}
        {required && <span className="ml-1 text-ig-accent">*</span>}
      </span>
      {children}
      {hint && <p className="mt-1.5 text-ig-caption text-ig-fg-muted">{hint}</p>}
    </label>
  );

  return (
    <HudDrawer
      isOpen={open}
      onClose={handleClose}
      title="Novo contrato"
      subtitle="Cadastro operacional — o contrato nasce oficial na carteira"
      width="760px"
    >
      <div className="space-y-5">
        <HudPanel elevation={1} noPadding interactive={false}>
          <div className="grid grid-cols-5 divide-x divide-ig-border-subtle">
            {STEPS.map((label, index) => (
              <button
                key={label}
                type="button"
                onClick={() => setStep(index)}
                className={`min-w-0 px-3 py-3 text-left transition-colors ${step === index ? 'bg-ig-accent-weak/50' : 'hover:bg-ig-panel-hover/50'}`}
              >
                <span className="block text-ig-label font-semibold text-ig-fg-subtle">
                  Etapa {index + 1}
                </span>
                <span className={`mt-1 block truncate text-xs font-semibold ${step === index ? 'text-ig-accent' : 'text-ig-fg-strong'}`}>
                  {label}
                </span>
              </button>
            ))}
          </div>
        </HudPanel>

        {step === 0 && (
          <HudPanel title="Identidade do contrato" icon={<FileText className="h-4 w-4" />} interactive={false}>
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Nº do contrato" required hint="Número interno da sua sequência (OS, CT, etc.).">
                <HudInput value={form.contractNumber} onChange={(e) => setField('contractNumber', e.target.value)} placeholder="Ex.: CT-2026-014" />
              </Field>
              <Field label="Nome do contrato" required>
                <HudInput value={form.title} onChange={(e) => setField('title', e.target.value)} placeholder="Ex.: Manutenção de subestações — Lote 2" />
              </Field>
              <Field label="Contraparte" required hint="Cliente ou fornecedor da outra ponta.">
                <HudInput
                  list="contract-company-options"
                  value={form.counterparty}
                  onChange={(e) => setField('counterparty', e.target.value)}
                  placeholder="Digite a empresa"
                />
                <datalist id="contract-company-options">
                  {companies.map((c) => <option key={c} value={c} />)}
                </datalist>
              </Field>
              <Field label="Tipo de contrato" required>
                <select value={form.type} onChange={(e) => setField('type', e.target.value)} className={selectClass}>
                  {CONTRACT_TYPES.map((t) => <option key={t}>{t}</option>)}
                </select>
              </Field>
              <Field
                label="Responsável interno"
                required
                hint={membersError ?? 'Quem responde pelo contrato dentro da organização.'}
              >
                <select value={form.ownerUserId} onChange={(e) => setField('ownerUserId', e.target.value)} className={selectClass}>
                  <option value="">Selecione o responsável</option>
                  {members.map((m) => (
                    <option key={m.userId} value={m.userId}>
                      {m.fullName || m.email || m.userId}{m.jobTitle ? ` · ${m.jobTitle}` : ''}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Situação" required hint="Situação atual do contrato. Não exige documento anexado.">
                <select value={form.status} onChange={(e) => setField('status', e.target.value)} className={selectClass}>
                  {CONTRACT_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                </select>
              </Field>
              <Field label="Classificação de risco" required hint="Declarada por quem cadastra — não é calculada a partir do valor.">
                <select value={form.riskLevel} onChange={(e) => setField('riskLevel', e.target.value)} className={selectClass}>
                  {RISK_LEVELS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                </select>
              </Field>
              <Field label="Objeto do contrato" span hint="Texto livre. Fica no dossiê e no PDF oficial.">
                <textarea
                  className={textareaClass}
                  rows={3}
                  value={form.scopeSummary}
                  onChange={(e) => setField('scopeSummary', e.target.value)}
                  placeholder="Resumo do escopo contratado"
                />
              </Field>
            </div>
          </HudPanel>
        )}

        {step === 1 && (
          <HudPanel
            title="Vigência e valor"
            subtitle="Campos em branco ficam em branco — nada é preenchido por suposição."
            icon={<CalendarRange className="h-4 w-4" />}
            interactive={false}
          >
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Início da vigência"><HudInput type="date" value={form.startDate} onChange={(e) => setField('startDate', e.target.value)} /></Field>
              <Field label="Fim da vigência"><HudInput type="date" value={form.endDate} onChange={(e) => setField('endDate', e.target.value)} /></Field>
              <Field label="Data de assinatura"><HudInput type="date" value={form.signedDate} onChange={(e) => setField('signedDate', e.target.value)} /></Field>
              <Field label="Decisão de renovação" hint="Quando a renovação precisa ser decidida, se houver.">
                <HudInput type="date" value={form.renewalDate} onChange={(e) => setField('renewalDate', e.target.value)} />
              </Field>
              <Field label="Valor contratual (R$)" required>
                <HudInput value={form.totalValue} onChange={(e) => setField('totalValue', e.target.value)} placeholder="0,00" inputMode="decimal" />
              </Field>
              <Field label="Valor mensal (R$)" hint="Apenas para contratos de recorrência.">
                <HudInput value={form.monthlyValue} onChange={(e) => setField('monthlyValue', e.target.value)} placeholder="0,00" inputMode="decimal" />
              </Field>
              <Field label="Condições de pagamento" span>
                <HudInput value={form.paymentTerms} onChange={(e) => setField('paymentTerms', e.target.value)} placeholder="Ex.: 30 dias após medição aprovada" />
              </Field>
            </div>

            {dateConflicts.length > 0 && (
              <div className="mt-4 rounded-lg border border-[color-mix(in_oklab,var(--ig-danger)_34%,transparent)] bg-[color-mix(in_oklab,var(--ig-danger)_10%,transparent)] p-3">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-ig-danger" />
                  <div>
                    <p className="text-ig-body-sm font-semibold text-ig-fg-strong">Datas incoerentes</p>
                    <ul className="mt-1 space-y-0.5 text-ig-caption text-ig-fg-muted">
                      {dateConflicts.map((c) => <li key={c}>{c}</li>)}
                    </ul>
                  </div>
                </div>
              </div>
            )}
          </HudPanel>
        )}

        {step === 2 && (
          <HudPanel
            title="Projeto vinculado"
            subtitle="Projetos é o dono do domínio — aqui apenas se registra a relação."
            icon={<Workflow className="h-4 w-4" />}
            interactive={false}
          >
            <div className="grid gap-4">
              <Field label="Projeto" hint="Pode ficar sem projeto agora e ser vinculado depois pelo dossiê.">
                <select value={form.projectId} onChange={(e) => setField('projectId', e.target.value)} className={selectClass}>
                  <option value="">Sem projeto vinculado</option>
                  {projects.slice(0, 200).map((p) => (
                    <option key={p.id} value={p.id}>{p.codigo} · {p.nome}</option>
                  ))}
                </select>
              </Field>
              <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded-lg border border-ig-border-subtle bg-ig-panel/55 p-3">
                  <div className="flex items-center gap-2 text-ig-body-sm font-semibold text-ig-fg-strong">
                    <Building2 className="h-4 w-4 text-ig-accent" />
                    {form.counterparty.trim() || 'Contraparte não informada'}
                  </div>
                  <p className="mt-1 text-ig-caption text-ig-fg-muted">Contraparte registrada no próprio contrato.</p>
                </div>
                <div className="rounded-lg border border-ig-border-subtle bg-ig-panel/55 p-3">
                  <div className="flex items-center gap-2 text-ig-body-sm font-semibold text-ig-fg-strong">
                    <Workflow className="h-4 w-4 text-ig-accent" />
                    {selectedProject ? `${selectedProject.codigo} · ${selectedProject.nome}` : 'Projeto não vinculado'}
                  </div>
                  <p className="mt-1 text-ig-caption text-ig-fg-muted">O detalhe do projeto abre no módulo Projetos.</p>
                </div>
              </div>
            </div>
          </HudPanel>
        )}

        {step === 3 && (
          <HudPanel
            title="Documento original"
            subtitle="Entra em contract_documents, com tipo e versão — pronto para análise e substituição."
            icon={<Upload className="h-4 w-4" />}
            interactive={false}
          >
            <div className="rounded-xl border border-dashed border-ig-border-focus bg-ig-accent-weak/20 p-5">
              <Input
                type="file"
                accept=".pdf,.doc,.docx"
                onChange={(e) => setFile(e.target.files?.[0] || null)}
                className="border-ig-border-strong bg-ig-panel text-ig-fg-strong file:text-ig-fg-strong"
              />
              <p className="mt-2 text-ig-caption text-ig-fg-muted">
                Enviado ao bucket privado ao salvar. O anexo é opcional e pode vir depois.
              </p>
            </div>

            {file && (
              <div className="mt-4 space-y-4">
                <div className="flex items-center justify-between gap-3 rounded-lg border border-ig-border-subtle bg-ig-panel/55 p-3">
                  <div className="min-w-0">
                    <p className="truncate text-ig-body-sm font-semibold text-ig-fg-strong">{file.name}</p>
                    <p className="text-ig-caption text-ig-fg-muted">{Math.round(file.size / 1024)} KB · versão 1</p>
                  </div>
                  <HudBadge variant="info">Pronto para envio</HudBadge>
                </div>

                <Field label="Tipo do documento" required>
                  <select value={form.documentType} onChange={(e) => setField('documentType', e.target.value)} className={selectClass}>
                    {DOCUMENT_TYPES.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
                  </select>
                </Field>

                <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-ig-border-subtle bg-ig-panel/45 p-3">
                  <input
                    type="checkbox"
                    checked={form.runExtraction}
                    onChange={(e) => setField('runExtraction', e.target.checked)}
                    className="mt-0.5 h-4 w-4 accent-[var(--ig-accent)]"
                  />
                  <span className="min-w-0">
                    <span className="block text-ig-body-sm font-semibold text-ig-fg-strong">
                      Analisar o documento após salvar
                    </span>
                    <span className="mt-1 block text-ig-caption text-ig-fg-muted">
                      A leitura assistida propõe cláusulas com o trecho de origem à vista. Toda proposta
                      aguarda revisão humana e nenhuma vira cláusula do contrato sem validação. O cadastro
                      se completa normalmente sem esta etapa.
                    </span>
                  </span>
                </label>
              </div>
            )}
          </HudPanel>
        )}

        {step === 4 && (
          <HudPanel title="Revisão" icon={<ShieldCheck className="h-4 w-4" />} interactive={false}>
            <div className="grid gap-3 md:grid-cols-3">
              {[
                { label: 'Nº do contrato', value: form.contractNumber.trim() },
                { label: 'Contraparte', value: form.counterparty.trim() },
                { label: 'Responsável', value: selectedOwner?.fullName || selectedOwner?.email || '' },
                {
                  label: 'Valor contratual',
                  value: totalValue === null ? '' : totalValue.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }),
                },
                { label: 'Vigência', value: form.startDate && form.endDate ? `${form.startDate} → ${form.endDate}` : '' },
                { label: 'Projeto', value: selectedProject ? selectedProject.codigo : '' },
                { label: 'Documento', value: file ? file.name : '' },
                {
                  label: 'Análise do documento',
                  value: file ? (form.runExtraction ? 'Será executada após salvar' : 'Não solicitada') : '',
                },
                { label: 'Origem', value: 'Contrato oficial (live)' },
              ].map((item) => (
                <div key={item.label} className="rounded-lg border border-ig-border-subtle bg-ig-panel/55 p-3">
                  <p className="text-ig-label text-ig-fg-muted">{item.label}</p>
                  <p className="mt-2 truncate text-ig-body-sm font-semibold text-ig-fg-strong">
                    {item.value || <span className="font-normal text-ig-fg-muted">Não informado</span>}
                  </p>
                </div>
              ))}
            </div>

            {/*
              O que falta NÃO é acusação: só o que ainda não foi registrado, e a
              lista de prontidão do dossiê continua a conversa depois de salvar.
            */}
            <div className="mt-4 flex items-start gap-2 rounded-lg border border-ig-border-subtle bg-ig-panel/45 p-3">
              <UserRound className="mt-0.5 h-4 w-4 shrink-0 text-ig-fg-muted" />
              <p className="text-ig-caption text-ig-fg-muted">
                Obrigações, marcos, aprovações e riscos são registrados depois, pelo dossiê do contrato.
                A lista de prontidão mostra o que já existe e o que falta, sem tratar ausência como irregularidade.
              </p>
            </div>

            {missing.length > 0 && (
              <div className="mt-4 rounded-lg border border-[color-mix(in_oklab,var(--ig-warning)_34%,transparent)] bg-[color-mix(in_oklab,var(--ig-warning)_10%,transparent)] p-3">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-ig-warning" />
                  <div>
                    <p className="text-ig-body-sm font-semibold text-ig-fg-strong">Campos obrigatórios pendentes</p>
                    <p className="mt-1 text-ig-caption text-ig-fg-muted">{missing.join(', ')}</p>
                  </div>
                </div>
              </div>
            )}

            {dateConflicts.length > 0 && (
              <div className="mt-3 rounded-lg border border-[color-mix(in_oklab,var(--ig-danger)_34%,transparent)] bg-[color-mix(in_oklab,var(--ig-danger)_10%,transparent)] p-3">
                <p className="text-ig-body-sm font-semibold text-ig-fg-strong">Datas incoerentes</p>
                <p className="mt-1 text-ig-caption text-ig-fg-muted">{dateConflicts.join(' ')}</p>
              </div>
            )}
          </HudPanel>
        )}

        <div className="flex items-center justify-between border-t border-ig-border-subtle pt-4">
          <HudButton
            variant="ghost"
            leftIcon={<ChevronLeft className="h-4 w-4" />}
            disabled={step === 0 || submitting}
            onClick={() => setStep((c) => Math.max(0, c - 1))}
          >
            Voltar
          </HudButton>
          <div className="flex items-center gap-2">
            <HudButton variant="secondary" onClick={handleClose} disabled={submitting}>Cancelar</HudButton>
            {step < STEPS.length - 1 ? (
              <HudButton
                variant="primary"
                rightIcon={<ChevronRight className="h-4 w-4" />}
                onClick={() => setStep((c) => Math.min(STEPS.length - 1, c + 1))}
              >
                Avançar
              </HudButton>
            ) : (
              <HudButton
                variant="primary"
                leftIcon={<CheckCircle className="h-4 w-4" />}
                disabled={blocked}
                isLoading={submitting}
                onClick={handleSave}
              >
                Salvar contrato
              </HudButton>
            )}
          </div>
        </div>
      </div>
    </HudDrawer>
  );
}
