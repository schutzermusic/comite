/**
 * Duas garantias do redesenho de status + edição do contrato.
 *
 * 1. O PATCH de "Editar contrato" é PARCIAL. Um formulário que reenvia as
 *    dezenove colunas atropela, em silêncio, a alteração que outra pessoa fez
 *    enquanto a tela estava aberta — e `updateContract` grava exatamente o que
 *    recebe.
 *
 * 2. Nenhuma cápsula outline volta ao módulo de Contratos. Status é
 *    `HudSignal`; a cápsula de raio 999px com ponto colorido foi aposentada e
 *    reintroduzi-la é o tipo de regressão que passa despercebida numa revisão
 *    de diff grande, porque cada ocorrência isolada parece inofensiva.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { diffContractEdit, type EditForm } from '@/lib/contracts/contract-edit-form';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf-8');

/**
 * Só o CÓDIGO. As proibições abaixo são sobre o que a tela FAZ, não sobre o
 * que os comentários explicam — e eles citam, de propósito, exatamente as
 * peças aposentadas e os fluxos vizinhos.
 */
const code = (p: string) =>
  read(p)
    .split('\n')
    .filter((line) => {
      const t = line.trim();
      return !t.startsWith('*') && !t.startsWith('//') && !t.startsWith('/*');
    })
    .join('\n');

const BASE: EditForm = {
  title: 'Contrato de prestação de serviços',
  contractNumber: 'JA10182283/2025',
  osNumber: '',
  counterpartyName: 'ENEL GREEN POWER CACHOEIRA DOURADA S.A.',
  contractType: 'Prestação de serviços',
  status: 'signed',
  riskLevel: 'medium',
  startDate: '2025-01-01',
  endDate: '2026-01-01',
  signedDate: '2024-12-20',
  renewalDate: '',
  totalValue: '8000000',
  monthlyValue: '',
  paymentTerms: '30 dias',
  scopeSummary: 'Operação e manutenção.',
};

describe('edição do contrato grava só o que mudou', () => {
  it('formulário intocado não produz PATCH', () => {
    expect(diffContractEdit(BASE, BASE)).toEqual({});
  });

  it('um campo alterado vira um PATCH de um campo', () => {
    const patch = diffContractEdit(BASE, { ...BASE, title: 'Novo título' });
    expect(patch).toEqual({ title: 'Novo título' });
  });

  it('as demais colunas NÃO viajam no PATCH', () => {
    // A regressão que este teste existe para impedir: reenviar `totalValue`,
    // `status` e `endDate` com o valor que estava na tela quando ela abriu.
    const patch = diffContractEdit(BASE, { ...BASE, riskLevel: 'high' });
    expect(Object.keys(patch)).toEqual(['riskLevel']);
  });

  it('número do contrato e número da OS são campos independentes', () => {
    // Editar um não pode arrastar o outro para o PATCH, e os dois podem ser
    // gravados juntos sem que um pise no valor do outro.
    const onlyOs = diffContractEdit(BASE, { ...BASE, osNumber: 'OS-2026-0031' });
    expect(onlyOs).toEqual({ osNumber: 'OS-2026-0031' });

    const onlyContract = diffContractEdit(BASE, { ...BASE, contractNumber: 'NOVO-123' });
    expect(onlyContract).toEqual({ contractNumber: 'NOVO-123' });

    const both = diffContractEdit(BASE, {
      ...BASE,
      contractNumber: 'NOVO-123',
      osNumber: 'OS-2026-0031',
    });
    expect(both).toEqual({ contractNumber: 'NOVO-123', osNumber: 'OS-2026-0031' });
  });

  it('a tela tem dois campos de texto separados — não um só compartilhado', () => {
    const src = read('src/components/contracts/useContractEditModal.tsx');
    expect(src).toContain('label="Número do contrato"');
    expect(src).toContain('label="Número da OS"');
    expect(src).toContain("set('osNumber')");
    expect(src).toContain("set('contractNumber')");
  });

  it('o código do dossiê prioriza a OS, depois o número do contrato', () => {
    const src = code('src/lib/contracts/trust/read-model.ts');
    const fn = src.slice(src.indexOf('function contractCode'), src.indexOf('function contractCode') + 400);
    const osAt = fn.indexOf('row.os_number');
    const contractAt = fn.indexOf('row.contract_number');
    expect(osAt).toBeGreaterThan(-1);
    expect(contractAt).toBeGreaterThan(-1);
    expect(osAt).toBeLessThan(contractAt);
  });

  it('campo de texto esvaziado grava NULL, não string vazia', () => {
    const patch = diffContractEdit(BASE, { ...BASE, paymentTerms: '   ' });
    expect(patch.paymentTerms).toBeNull();
  });

  it('valor aceita 1.234,56 e 1234.56', () => {
    expect(diffContractEdit(BASE, { ...BASE, totalValue: '1.234,56' }).totalValue).toBe(1234.56);
    expect(diffContractEdit(BASE, { ...BASE, totalValue: '1234.56' }).totalValue).toBe(1234.56);
  });

  it('valor ilegível vira `undefined` — nunca zero nem null', () => {
    // `null` apagaria o valor contratado; `0` seria pior ainda, porque parece
    // apurado. O guarda de envio da tela bloqueia antes disso importar.
    expect(diffContractEdit(BASE, { ...BASE, totalValue: 'oito milhões' }).totalValue).toBeUndefined();
  });

  it('a origem do contrato não tem como sair por esta tela', () => {
    const src = code('src/components/contracts/useContractEditModal.tsx')
      + code('src/lib/contracts/contract-edit-form.ts');
    // `dataClass` é ato de governança, com justificativa e trilha próprias.
    expect(src).not.toContain('dataClass:');
    expect(src).not.toContain('reclassifyContract');
  });

  it('a ação está no menu do dossiê, atrás da permissão de edição', () => {
    const page = read('src/app/(main)/contratos/[id]/page.tsx');
    expect(page).toContain('Editar contrato');
    expect(page).toContain('openEditContract');
    expect(page).toContain('editContractModal');
    const item = page.slice(page.indexOf('Editar contrato') - 400, page.indexOf('Editar contrato'));
    expect(item, 'o item não está atrás de canEditContract').toContain('canEditContract');
  });
});

// ═══════════════════════════════════════════════════════════════════
// Logo do cliente dentro de "Editar contrato"
// ═══════════════════════════════════════════════════════════════════

describe('logo do cliente na edição do contrato', () => {
  it('a faixa de logo vem ANTES do campo de título no JSX', () => {
    // A ordem no markup é a ordem na tela: a identidade visual do cliente
    // precede o nome do contrato, não o contrário.
    const src = read('src/components/contracts/useContractEditModal.tsx');
    const logoAt = src.indexOf('ClientLogoUploadSlot');
    const titleAt = src.indexOf('label="Título do contrato"');
    expect(logoAt).toBeGreaterThan(-1);
    expect(titleAt).toBeGreaterThan(-1);
    expect(logoAt).toBeLessThan(titleAt);
  });

  it('usa a variante grande do slot, não a pastilha de 32px do cabeçalho', () => {
    const src = read('src/components/contracts/useContractEditModal.tsx');
    expect(src).toContain('size="lg"');
  });

  it('a logo grava no PROJETO, nunca numa coluna de `contracts`', () => {
    // `updateContract` só recebe o que `diffContractEdit` monta a partir de
    // `EditForm` — nenhum campo de logo existe ali. Se um dia um campo
    // `clientLogoUrl`/`logoUrl` aparecer em `EditForm` ou em `diffContractEdit`,
    // a logo passaria a viajar (errado) dentro do PATCH de "Salvar alterações".
    const form = code('src/lib/contracts/contract-edit-form.ts');
    expect(form).not.toMatch(/logo/i);

    const page = code('src/app/(main)/contratos/[id]/page.tsx');
    expect(page).toContain('uploadProjectFile');
    expect(page).toContain('updateProjectV2');
    expect(page).toContain('clientLogoUrl');
  });

  it('sem projeto vinculado, o upload fica desabilitado — não escondido', () => {
    // Esconder o controle deixaria a ausência de vínculo invisível; desabilitar
    // com uma explicação é o padrão do resto do módulo (MD: estado operacional
    // acionável, não campo vazio).
    const src = read('src/components/contracts/useContractEditModal.tsx');
    expect(src).toContain('disabled={!logo.projectId}');
    expect(src).toMatch(/Vincule um projeto/);
  });

  it('o upload é imediato — não entra no PATCH de "Salvar alterações"', () => {
    const src = code('src/components/contracts/useContractEditModal.tsx');
    // `submit()` só chama `updateContract`; a logo tem seu próprio caminho
    // (`handleLogoSelect` → `logo.onUpload`), disparado pelo próprio slot.
    const submitFn = src.slice(src.indexOf('const submit = async'), src.indexOf('const modal ='));
    expect(submitFn).not.toContain('logo.onUpload');
    expect(submitFn).toContain('updateContract(contract.id, patch)');
  });
});

// ═══════════════════════════════════════════════════════════════════
// Cápsulas outline aposentadas
// ═══════════════════════════════════════════════════════════════════

function tsxFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(resolve(process.cwd(), dir))) {
    const full = join(dir, entry);
    if (statSync(resolve(process.cwd(), full)).isDirectory()) out.push(...tsxFiles(full));
    else if (entry.endsWith('.tsx')) out.push(full);
  }
  return out;
}

const CONTRACT_SURFACES = [
  ...tsxFiles('src/components/contracts'),
  ...tsxFiles('src/app/(main)/contratos'),
];

describe('status em Contratos é sempre Signal Chip', () => {
  it('há superfícies para verificar', () => {
    expect(CONTRACT_SURFACES.length).toBeGreaterThan(20);
  });

  it('nenhuma superfície reintroduz a cápsula `.ig-chip`', () => {
    const offenders = CONTRACT_SURFACES.filter((f) => code(f).includes('ig-chip'));
    expect(offenders, 'use HudSignal em vez de .ig-chip').toEqual([]);
  });

  it('nenhuma superfície desenha um selo de status com `rounded-full border px-`', () => {
    /*
      A assinatura da cápsula: pílula com borda e padding horizontal. Trilhos
      de progresso (`h-1`, `h-1.5`, `h-2`), marcadores de nó e caixas de
      seleção também usam `rounded-full border`, e são legítimos — o que os
      separa é não terem padding de texto.
    */
    const CAPSULE = /rounded-full border[^'"`]*\spx-[\d.]+/;
    const offenders: string[] = [];
    for (const file of CONTRACT_SURFACES) {
      for (const line of code(file).split('\n')) {
        if (!CAPSULE.test(line)) continue;
        if (line.includes('dashed')) continue;           // trilho não apurado
        offenders.push(`${file}: ${line.trim().slice(0, 90)}`);
      }
    }
    expect(offenders, 'selo de status fora do HudSignal').toEqual([]);
  });
});
