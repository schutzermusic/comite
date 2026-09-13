import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

/*
  Regressão do cadastro inline de Pessoa dentro do assistente de contrato.

  O defeito em produção: digitar um caractere no formulário de Pessoa
  confirmava/avançava o assistente. A causa não era um handler de teclado — era
  ESTRUTURAL, e é por isso que as asserções abaixo são estruturais:

   1. `Field` era declarado DENTRO de `ContractUpload`. A cada render o React
      via um tipo de componente novo, desmontava a `<label>` e remontava o
      `<input>`; o campo perdia o foco a cada tecla e a tecla seguinte caía no
      `document.body`, onde Enter/Espaço acionavam o botão em foco do assistente.
   2. O bloco de Pessoa não tinha `<form>` próprio, então nem submit nem teclado
      ficavam isolados do assistente, e `<button>` sem `type` é `submit`.
   3. O assistente continuava clicável e editável atrás do cadastro em curso.

  Este arquivo trava as três. A suíte unitária deste repositório roda em
  ambiente `node` e não tem DOM: são asserções sobre o código-fonte, não sobre
  eventos renderizados.
*/

const wizard = readFileSync('src/components/contracts/contract-upload.tsx', 'utf8');

const dialog = wizard.slice(
  wizard.indexOf('function PersonCreatorDialog('),
  wizard.indexOf('export function ContractUpload('),
);

const contractUpload = wizard.slice(wizard.indexOf('export function ContractUpload('));

describe('cadastro de Pessoa — diálogo acima do assistente', () => {
  it('abre como diálogo portado, e não como bloco inline no formulário do contrato', () => {
    expect(wizard).not.toContain('renderPersonCreator');
    expect(wizard).not.toContain("personCreatorOpen && personCreationTarget === 'contract' && ");
    expect(wizard).not.toContain("personCreatorOpen && personCreationTarget === 'project' && ");

    expect(dialog).toContain('createPortal(');
    expect(dialog).toContain('document.body,');
    expect(dialog).toContain('role="dialog"');
    expect(dialog).toContain('aria-modal="true"');
    expect(dialog).toContain('data-testid="person-creator-dialog"');
    expect(dialog).toContain('Cadastrar nova pessoa');
    expect(dialog).toContain('Cria somente uma Pessoa. Nenhum login ou acesso à plataforma será criado.');
  });

  it('é compacto e contido, nunca em tela cheia', () => {
    expect(dialog).toContain('max-w-lg');
    expect(dialog).toContain('flex items-center justify-center');
    expect(dialog).not.toContain('max-w-[90vw]');
    expect(dialog).not.toContain('h-[100dvh]');
  });

  it('escurece, desfoca e bloqueia o assistente enquanto está aberto', () => {
    // `ig-backdrop` já é escurecimento + `backdrop-filter: blur()`.
    expect(dialog).toContain('className="absolute inset-0 ig-backdrop"');
    expect(dialog).toContain('aria-hidden="true"');
    // Acima do HudDrawer (z-80/81) e do HudModal (z-85).
    expect(dialog).toContain('z-[88]');
  });

  it('prende o foco dentro do diálogo, por Tab e por qualquer outro caminho', () => {
    expect(dialog).toContain("if (event.key !== 'Tab') return;");
    expect(dialog).toContain('last.focus();');
    expect(dialog).toContain('first.focus();');
    expect(dialog).toContain("document.addEventListener('focusin', onFocusIn)");
    expect(dialog).toContain('if (target && panel.contains(target)) return;');
  });

  it('devolve o foco ao gatilho "Cadastrar nova pessoa" ao fechar', () => {
    expect(contractUpload).toContain('const personTriggerRef = useRef<HTMLElement | null>(null);');
    expect(contractUpload).toContain('personTriggerRef.current = trigger ?? null;');
    expect(contractUpload).toContain('requestAnimationFrame(() => trigger.focus());');
    expect(contractUpload).toContain("openPersonCreator('contract', event.currentTarget)");
    expect(contractUpload).toContain("openPersonCreator('project', event.currentTarget)");
  });
});

describe('regressão de digitação — uma tecla só digita', () => {
  it('não redeclara `Field` a cada render (a causa da perda de foco por tecla)', () => {
    // Vive no módulo: um único tipo de componente, estável entre renders.
    expect(wizard).toMatch(/^function Field\(\{ label, required, hint, children, span \}/m);
    expect(wizard).not.toContain('const Field = ({ label, required, hint, children, span }');
    expect(contractUpload).not.toContain('const Field =');
  });

  it('não devolve o foco ao primeiro campo a cada caractere digitado', () => {
    const focusEffect = dialog.slice(
      dialog.indexOf("panelRef.current?.querySelector<HTMLInputElement>('input')?.focus();"),
    ).slice(0, 200);
    // O efeito de foco inicial depende SOMENTE de `open` — nunca do rascunho.
    expect(focusEffect).toContain('}, [open]);');
    expect(dialog).not.toMatch(/\}, \[open, draft\]\);/);
  });

  it('não dispara verificação de duplicata a cada caractere digitado', () => {
    // `onChange` só atualiza o campo e LIMPA duplicatas; nunca as calcula.
    expect(dialog).toContain("onDraftChange({ fullName: event.target.value }); onClearDuplicates();");
    expect(dialog).not.toContain('likelyDuplicatePeople');
    // O cálculo mora exclusivamente no envio explícito.
    const createBody = contractUpload.slice(
      contractUpload.indexOf('const createAndLinkPerson = async ()'),
      contractUpload.indexOf('const openProjectCreator ='),
    );
    expect(createBody).toContain('const duplicates = likelyDuplicatePeople(people, personDraft);');
    expect(createBody).toContain('setPersonDuplicates(duplicates);');
    // Encontrar duplicata PARA e mostra; não escolhe nada sozinho.
    expect(createBody).toContain('if (duplicates.length > 0) {\n      setPersonDuplicates(duplicates);\n      return;\n    }');
    expect(createBody).not.toContain('selectCreatedOrExistingPerson(duplicates[0])');
  });
});

describe('isolamento de formulário e de teclado', () => {
  it('tem formulário próprio cujo submit não sobe para o assistente', () => {
    expect(dialog).toContain('<form');
    expect(dialog).toContain('onSubmit={(event) => {\n              event.preventDefault();\n              event.stopPropagation();\n              onSubmit();\n            }}');
    // O assistente de contrato não é um <form>: nada do cadastro pode enviá-lo.
    expect(contractUpload).not.toMatch(/<form[\s>]/);
  });

  it('impede o submit implícito do navegador ao digitar Enter num campo', () => {
    expect(dialog).toContain("if (event.key !== 'Enter') return;");
    expect(dialog).toContain("if (tag === 'INPUT' || tag === 'SELECT') {");
    expect(dialog).toContain('onKeyDown={blockImplicitSubmit}');
    // Enter sobre um botão em foco segue acionando o botão: nada de
    // `preventDefault` indiscriminado em toda tecla.
    expect(dialog).not.toMatch(/onKeyDown=\{\(event\) => event\.preventDefault\(\)\}/);
  });

  it('só deixa "Cadastrar e vincular" enviar; todo o resto é type="button"', () => {
    expect(dialog).toContain('<HudButton type="submit" size="sm" variant="primary" isLoading={creating}');
    expect(dialog).toContain('Cadastrar e vincular');

    // Cancelar, fechar (X) e cada botão de duplicata são explicitamente button.
    expect(dialog).toContain('<HudButton type="button" size="sm" variant="secondary" onClick={onClose}>Cancelar</HudButton>');
    expect(dialog).toContain('aria-label="Fechar cadastro de pessoa"');
    expect(dialog).toContain('<HudButton key={person.id} type="button" size="sm" variant="secondary"');

    // Nenhum <button> ou <HudButton> do diálogo fica sem `type`.
    const buttons = dialog.match(/<(?:HudButton|button)\b[\s\S]*?>/g) ?? [];
    expect(buttons.length).toBeGreaterThan(0);
    for (const button of buttons) expect(button).toMatch(/type="(button|submit)"/);
    // Exatamente um botão do diálogo envia o formulário.
    expect(buttons.filter((button) => button.includes('type="submit"'))).toHaveLength(1);
  });

  it('fecha apenas o diálogo com Esc, sem fechar o assistente atrás', () => {
    // HudDrawer escuta keydown no window em bolha; só um ouvinte de CAPTURA
    // no window chega antes dele e encerra o evento.
    expect(dialog).toContain("window.addEventListener('keydown', onKeyDownCapture, true);");
    expect(dialog).toContain('event.stopImmediatePropagation();');
    const escapeHandler = dialog.slice(dialog.indexOf('const onKeyDownCapture ='), dialog.indexOf('window.addEventListener'));
    expect(escapeHandler).toContain("if (event.key !== 'Escape') return;");
    expect(escapeHandler).toContain('onClose();');
    expect(escapeHandler).not.toContain('onOpenChange');
  });
});

describe('cancelar, sucesso e ausência de login', () => {
  it('cancelar fecha só o diálogo, não cria Pessoa e não mexe no assistente', () => {
    const closeBody = contractUpload.slice(
      contractUpload.indexOf('const closePersonCreator = useCallback('),
      contractUpload.indexOf('const selectCreatedOrExistingPerson ='),
    );
    expect(closeBody).toContain('setPersonCreatorOpen(false);');
    expect(closeBody).toContain('setPersonDuplicates([]);');
    expect(closeBody).toContain('setPersonCreateError(null);');
    // Nada de criar, avançar etapa, resetar o contrato ou fechar o drawer.
    expect(closeBody).not.toContain('createPerson');
    expect(closeBody).not.toContain('setStep');
    expect(closeBody).not.toContain('setForm');
    expect(closeBody).not.toContain('onOpenChange');
    expect(closeBody).not.toContain('handleClose');
  });

  it('o envio bem-sucedido seleciona a Pessoa e mantém o assistente na mesma etapa', () => {
    const selectBody = contractUpload.slice(
      contractUpload.indexOf('const selectCreatedOrExistingPerson ='),
      contractUpload.indexOf('const createAndLinkPerson ='),
    );
    expect(selectBody).toContain("if (personCreationTarget === 'contract') setField('ownerPersonId', person.id);");
    expect(selectBody).toContain('closePersonCreator();');
    // Sem avanço de etapa, sem troca de visão, sem recarregar, sem fechar o drawer.
    expect(selectBody).not.toContain('setStep');
    expect(selectBody).not.toContain('setView');
    expect(selectBody).not.toContain('onOpenChange');
    expect(selectBody).not.toContain('location.reload');

    const createBody = contractUpload.slice(
      contractUpload.indexOf('const createAndLinkPerson = async ()'),
      contractUpload.indexOf('const openProjectCreator ='),
    );
    expect(createBody).toContain('selectCreatedOrExistingPerson(option);');
    expect(createBody).not.toContain('setStep');
    expect(createBody).not.toContain('onSubmit(');
  });

  it('continua criando somente uma Pessoa, jamais um usuário de login', () => {
    expect(contractUpload).toContain('profileId: null');
    expect(wizard).not.toMatch(/signUp|auth\.admin|inviteUser/i);
    const service = readFileSync('src/lib/services/people.ts', 'utf8');
    const createPerson = service.slice(
      service.indexOf('export async function createPerson'),
      service.indexOf('export async function updatePerson'),
    );
    expect(createPerson).not.toMatch(/signUp|auth\.admin|organization_memberships|user_roles|credentials/i);
  });
});
