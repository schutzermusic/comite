'use client';

import { useState } from 'react';
import { Plus } from 'lucide-react';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { HudButton } from '@/components/hud';
import { CARTEIRA_INTAKE_OPTIONS, type CarteiraIntakeOption } from '@/lib/commercial/navigation';
import { CarteiraManualIntakeModal } from './CarteiraManualIntakeModal';

/**
 * "+ Adicionar" da Carteira — as quatro portas de entrada do §6.
 *
 * O botão antigo dizia "Adicionar contrato", e era o único caminho. Quem
 * tinha uma proposta aceita, um pedido de compra ou uma autorização formal
 * só podia entrar cadastrando um contrato — isto é, inventando um instrumento
 * que ninguém assinou para o trabalho caber na tela. É esse convite à ficção
 * que este menu remove.
 *
 * Cada opção diz, na própria dica, o que vai acontecer: o contrato sobe para
 * leitura e fica EM ANÁLISE; a proposta entra como fonte de autorização sem
 * criar contrato; o pedido entra com o documento anexado; o manual nasce em
 * análise, fora dos KPIs.
 */
export function CarteiraIntakeMenu({ onUploadContract }: { onUploadContract: () => void }) {
  const [manualOpen, setManualOpen] = useState(false);

  const choose = (option: CarteiraIntakeOption) => {
    if (option === 'contract') { onUploadContract(); return; }
    // Proposta, pedido e criação manual entram pelo mesmo formulário: os três
    // criam um trabalho autorizado EM ANÁLISE e diferem apenas na fonte que
    // será anexada em seguida.
    setManualOpen(true);
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <HudButton variant="primary" size="md" leftIcon={<Plus className="h-4 w-4" />}>
            Adicionar
          </HudButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-80">
          {CARTEIRA_INTAKE_OPTIONS.map((option) => (
            <DropdownMenuItem
              key={option.id}
              onSelect={() => choose(option.id)}
              className="flex flex-col items-start gap-1 py-2"
            >
              <span className="text-ig-body-sm font-medium">{option.label}</span>
              <span className="text-ig-caption text-ig-fg-subtle">{option.hint}</span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <CarteiraManualIntakeModal open={manualOpen} onOpenChange={setManualOpen} />
    </>
  );
}
