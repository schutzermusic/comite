'use client';

/**
 * Cadastros em andamento — a porta de volta para um contrato que começou a
 * entrar e ainda não terminou.
 *
 * POR QUE ISTO EXISTE
 *
 * O documento é preservado e lido antes de o contrato existir. Entre uma coisa
 * e outra há uma etapa humana — confirmar a contraparte, classificar risco,
 * indicar responsável, relacionar o projeto — e essa etapa pode ser
 * interrompida por qualquer motivo trivial: uma reunião, um telefonema, uma
 * aba fechada. Sem esta faixa, o cadastro continuava existindo no banco e
 * desaparecia do produto, e a única saída aparente era enviar o mesmo PDF de
 * novo.
 *
 * O QUE ELA NÃO É
 *
 * Não é um cartão de "processamento". Não aparece quando não há nada em
 * andamento, não ocupa a tela com banner, não anuncia tecnologia e não repete
 * a carteira: é uma lista curta de cadastros SEUS, com o contexto de negócio
 * que já foi lido do documento e uma ação por linha.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ChevronRight, FileClock } from 'lucide-react';
import { HudBadge, HudPanel } from '@/components/hud';
import { listActiveContractIntakes } from '@/lib/contracts/onboarding/client';
import type { ContractIntakeContinuityItem } from '@/lib/contracts/onboarding/resume';

/** Data curta e local; sem hora, porque o que importa é "de quando é este cadastro". */
function formatReceived(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? null
    : date.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });
}

/**
 * Identidade da linha. Preferimos o que o documento já disse com segurança;
 * na ausência disso, o nome do arquivo — que é um fato, não uma suposição.
 */
function itemHeadline(item: ContractIntakeContinuityItem): string {
  const parts = [item.contractNumber, item.title].filter(Boolean) as string[];
  return parts.length > 0 ? parts.join(' · ') : item.fileName;
}

export function ContractOnboardingContinuity({ className }: { className?: string }) {
  const [items, setItems] = useState<ContractIntakeContinuityItem[]>([]);

  /*
    Leitura única na montagem. Um cadastro em andamento é estado durável, não
    um fluxo ao vivo: quem quer acompanhar a leitura abre o próprio cadastro,
    que já acompanha sozinho. Falhar aqui é silencioso de propósito — a faixa
    é um atalho, e perdê-la não pode atrapalhar a leitura da carteira.
  */
  useEffect(() => {
    let alive = true;
    listActiveContractIntakes()
      .then((rows) => { if (alive) setItems(rows); })
      .catch(() => { if (alive) setItems([]); });
    return () => { alive = false; };
  }, []);

  if (items.length === 0) return null;

  return (
    <section className={className} data-testid="contract-onboarding-continuity">
      <header className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 className="text-ig-h3 font-semibold text-ig-fg-strong">Cadastros em andamento</h3>
        <span className="text-ig-caption text-ig-fg-muted">
          contratos que já entraram e ainda não foram concluídos
        </span>
      </header>

      <HudPanel noPadding interactive={false}>
        <ul className="divide-y divide-ig-border-subtle">
          {items.map((item) => {
            const received = formatReceived(item.receivedAt);
            return (
              <li key={item.id}>
                <Link
                  href={item.href}
                  className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-ig-panel-hover/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color-mix(in_oklab,var(--ig-accent)_45%,transparent)]"
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-ig-border-subtle bg-ig-panel">
                    <FileClock className="h-4 w-4 text-ig-accent" />
                  </span>

                  <div className="min-w-0 flex-1">
                    <p className="truncate text-ig-body-sm font-semibold text-ig-fg-strong">{itemHeadline(item)}</p>
                    <p className="mt-0.5 truncate text-ig-caption text-ig-fg-muted">
                      {[item.counterparty, item.fileName, received].filter(Boolean).join(' · ')}
                    </p>
                  </div>

                  <div className="hidden shrink-0 items-center gap-2 md:flex">
                    {item.kind === 'resume' && item.attentionCount > 0 && (
                      <HudBadge variant="warning">{item.attentionCount} pendências</HudBadge>
                    )}
                    <span className="text-ig-caption text-ig-fg-muted">{item.stateLabel}</span>
                  </div>

                  {/*
                    Uma ação por linha, e o rótulo diz o que de fato acontece:
                    continuar um cadastro pronto para decisão não é a mesma
                    coisa que retomar uma leitura que não concluiu.
                  */}
                  <span className="ml-1 inline-flex shrink-0 items-center gap-1 text-ig-caption font-semibold text-ig-accent">
                    {item.actionLabel}
                    <ChevronRight className="h-3.5 w-3.5" />
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </HudPanel>
    </section>
  );
}
