'use client';

/**
 * Retomada de um cadastro de contrato em andamento.
 *
 * URL DURÁVEL. O cadastro é identificado pela rota, não pela memória de um
 * componente: atualizar, voltar, avançar ou colar o link em outro dia abre o
 * mesmo cadastro, no mesmo ponto. A fonte da verdade é a entrada persistida
 * (`contract_onboarding_intakes`), lida a cada abertura.
 *
 * RETOMAR É LER. Esta página faz um GET autorizado e reconstrói a tela. Não
 * autoriza envio, não envia arquivo, não enfileira leitura e não reescreve o
 * resultado estruturado — abrir o cadastro quantas vezes for não muda nada no
 * banco. A única escrita possível parte de um ato humano explícito: finalizar.
 *
 * A FINALIZAÇÃO É A CANÔNICA. Quando a pessoa conclui, a página chama o MESMO
 * `finalizeContractIntake` da carteira, que chama a MESMA RPC
 * `contract_onboarding_finalize` — contrato + documento original no mesmo
 * commit, `final_values` gravado ao lado da leitura original, e a
 * operacionalização contratual seguindo pela fila de sempre. Não existe aqui
 * nenhum caminho alternativo de criação de contrato.
 *
 * AUTORIZAÇÃO. O GET por id é protegido no servidor pela sessão, pela
 * permissão de contratos e pela política `coni_read_own` da migration 166 —
 * organização ativa e entrada do próprio usuário. Adivinhar um id de outra
 * organização devolve "não encontrado", que é o que esta tela mostra.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, FileClock } from 'lucide-react';
import { HudButton, HudHeader, HudPageLayout, HudPanel } from '@/components/hud';
import { ContractUpload, type ContractOnboardingDraft } from '@/components/contracts/contract-upload';
import { finalizeContractIntake, getContractIntake, type ContractIntakeView } from '@/lib/contracts/onboarding/client';
import { intakeContinuityKind } from '@/lib/contracts/onboarding/resume';
import { buildIntakeFinalValues } from '@/lib/contracts/onboarding/finalize-values';
import { getProjectsAsync } from '@/lib/services/projects';
import type { Project } from '@/lib/types';

export default function ContratoOnboardingRetomadaPage() {
  const router = useRouter();
  const params = useParams<{ intakeId: string }>();
  const intakeId = typeof params?.intakeId === 'string' ? params.intakeId : '';

  const [intake, setIntake] = useState<ContractIntakeView | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Começa carregando: a página só existe para abrir um cadastro, e o estado
  // inicial é sempre "buscando" — não há um passo anterior a sincronizar.
  const [loading, setLoading] = useState(true);
  const [projects, setProjects] = useState<Project[]>([]);

  useEffect(() => {
    if (!intakeId) return;
    let alive = true;
    getContractIntake(intakeId)
      .then((row) => { if (alive) { setIntake(row); setError(null); } })
      .catch((err: unknown) => {
        if (alive) setError(err instanceof Error ? err.message : 'Cadastro não encontrado.');
      })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [intakeId]);

  useEffect(() => {
    let alive = true;
    getProjectsAsync().then((rows) => { if (alive) setProjects(rows); }).catch(() => { if (alive) setProjects([]); });
    return () => { alive = false; };
  }, []);

  /*
    Para onde o assistente devolve o usuário ao se fechar.

    O assistente fecha sozinho depois de salvar, e é ele quem dá a última
    palavra sobre a navegação — por isso o destino é decidido aqui, e não
    dentro do `onSubmit`: um `push` feito na finalização seria sobrescrito
    pelo fechamento e o contrato recém-criado nunca apareceria. Fechar sem
    finalizar devolve a carteira, e o cadastro continua exatamente onde está.
  */
  const createdContractId = useRef<string | null>(null);
  const leave = useCallback(() => {
    router.push(createdContractId.current ? `/contratos/${createdContractId.current}` : '/contratos');
  }, [router]);

  const finalize = useCallback(async (draft: ContractOnboardingDraft) => {
    if (!draft.onboardingIntakeId) return;
    const result = await finalizeContractIntake(draft.onboardingIntakeId, buildIntakeFinalValues(draft));
    createdContractId.current = result.contractId;
  }, []);

  const kind = intake ? intakeContinuityKind(intake) : null;

  return (
    <HudPageLayout maxWidth="lg">
      <HudHeader
        title="Cadastro em andamento"
        subtitle="O documento original já está preservado. Continue de onde parou."
        icon={<FileClock className="h-5 w-5" />}
        breadcrumbs={[{ label: 'Contratos', href: '/contratos' }, { label: 'Cadastro em andamento' }]}
        actions={
          <HudButton variant="secondary" leftIcon={<ArrowLeft className="h-4 w-4" />} onClick={leave}>
            Voltar à carteira
          </HudButton>
        }
      />

      {loading && (
        <HudPanel interactive={false}>
          <p className="text-ig-body-sm text-ig-fg-muted">Abrindo o cadastro…</p>
        </HudPanel>
      )}

      {!loading && error && (
        <HudPanel title="Cadastro indisponível" interactive={false}>
          <p className="text-ig-body-sm text-ig-fg-muted">{error}</p>
          <p className="mt-2 text-ig-caption text-ig-fg-subtle">
            Cadastros em andamento são visíveis apenas para quem os iniciou, dentro da organização ativa.
          </p>
          <div className="mt-4">
            <Link href="/contratos" className="text-ig-body-sm font-semibold text-ig-accent">Voltar à carteira</Link>
          </div>
        </HudPanel>
      )}

      {/*
        Um cadastro que JÁ VIROU CONTRATO não volta a ser rascunho. A página
        continua acessível — o link permanece válido para histórico — mas o que
        ela oferece é o contrato, não um segundo cadastro do mesmo documento.
      */}
      {!loading && !error && intake && kind === 'closed' && (
        <HudPanel title="Este cadastro já foi concluído" interactive={false}>
          <p className="text-ig-body-sm text-ig-fg-muted">
            O contrato foi criado a partir de {intake.file_name} e o cadastro não está mais em andamento.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            {intake.contract_id && (
              <Link href={`/contratos/${intake.contract_id}`}>
                <HudButton variant="primary">Abrir contrato</HudButton>
              </Link>
            )}
            <Link href="/contratos"><HudButton variant="secondary">Voltar à carteira</HudButton></Link>
          </div>
        </HudPanel>
      )}

      {!loading && !error && intake && kind !== 'closed' && (
        <ContractUpload
          open
          onOpenChange={(next) => { if (!next) leave(); }}
          onSubmit={finalize}
          projects={projects}
          resumeIntake={intake}
        />
      )}
    </HudPageLayout>
  );
}
