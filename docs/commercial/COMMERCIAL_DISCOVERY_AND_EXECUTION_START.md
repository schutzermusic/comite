# Descoberta técnica, fechamento governado e início excepcional

Migrations **213**, **214** e **215**. Este documento explica o desenho; o que cada objeto faz está nos comentários das próprias migrations.

## Os três caminhos, um destino

| Caminho | Sequência | Onde converge |
| --- | --- | --- |
| Venda normal | Oportunidade → descoberta → PT/PC → negociação → base do cliente → **Fechar negócio** | trabalho autorizado → OS interna → projeto |
| Fast-track | PT/PC já existem → Apex lê → **Fechar negócio e iniciar execução** | o mesmo |
| Descoberta técnica antes da proposta | Oportunidade → **levantamento técnico** → achados → prontidão → PT → PC → **Fechar negócio** | o mesmo |

Depois do projeto, nada muda: medição, evidência, revisão, aceite do cliente, elegibilidade de faturamento e fiscal são os motores de sempre. Não existe `quick_measurement`, `fasttrack_billing`, `proposal_billing`, `survey_project` nem motor manual de projeto — a prova (`discovery-execution-proof.mjs`) procura por eles.

## Levantamento técnico (`commercial_site_surveys`, 213)

- **Pertence à oportunidade** (`opportunity_id NOT NULL`). Não é módulo nem item de menu: nasce no dossiê ("Solicitar levantamento técnico") e é trabalhado em `/comercial/levantamentos/[id]`, tela feita para o celular.
- **Ciclo:** `PLANNED → SCHEDULED → IN_FIELD → AWAITING_REPORT → COMPLETED`, com `CANCELLED` exigindo motivo. Agendar exige quem e quando. Concluído fecha o registro.
- **Registro de campo** em `findings` (seções), `checklist` e `open_questions`, mesclado por seção: o celular manda só o que mudou.
- **Arquivos de campo** (foto, vídeo, áudio, PDF) em `contract_documents` com um terceiro pai possível (`site_survey_id`). Mesmo bucket, mesmo envio assinado do contrato, deduplicação por hash. Nenhum sistema de arquivos paralelo.
- **Leitura da Apex** (`SITE_SURVEY_UNDERSTANDING`) grava **só** em `apex_candidate`, com provedor, modelo e versão obrigatórios por `CHECK`. Cada item cita a fonte no levantamento; item sem fonte aparece marcado. Nada é copiado para `findings`.
- **História** append-only (`commercial_site_survey_events`): reescrever é proibido a qualquer papel; apagar segue a regra canônica da 210 (a 213 aplicou a mesma correção ao histórico de etapa da 212).

## Prontidão para propor

Determinística (`proposal-readiness.ts`): cliente no cadastro único, contato principal, levantamento concluído, local, escopo estimado, questões técnicas em aberto, checklist obrigatório, valor e previsão. Estados `READY_TO_PROPOSE`, `REVIEW_REQUIRED`, `NOT_READY`. Sem levantamento, a resposta é **revisão**, não bloqueio — nem toda proposta exige visita, e a regra não inventa essa exigência. Sugestão da Apex não entra na conta.

## Fechar negócio e iniciar execução (`commercial_close_and_start_execution`, 213)

Uma função, uma transação, que **orquestra** as funções governadas que já existiam:

1. valida a base comercial (proposta aceita, e-mail, PO, OS do cliente, contrato — aprovação interna não é base);
2. registra o **aceite do cliente** pela função da 200, só quando a revisão está enviada e com a manifestação declarada;
3. acha o trabalho autorizado antes de criar (oportunidade → autorização da revisão → início anterior → contrato);
4. anexa as fontes pela porta da 208 (a PC rege com o valor dela; a PT entra sem valor; PO/e-mail entram como evidência sem disputar regência);
5. autoriza o engajamento, ganha a oportunidade e a liga ao trabalho;
6. reusa, vincula, gera ou registra a **OS interna** carregada — e a confronta com a fonte regente;
7. emite a OS se nada bloqueia; divergência `BLOCKING` **para** o fechamento e diz por quê;
8. reusa o projeto já ligado ao trabalho antes de criar um.

`commercial_execution_starts` guarda o ato (base, data, evidência, quem confirmou) e é a âncora da idempotência: **um por engajamento**. Repetir o fechamento devolve os mesmos objetos. A prova repete e conta: 1 engajamento, 1 OS, 1 projeto, 1 início.

## Início excepcional

Mesmo painel, com a alçada `commercial.execution.start_exceptional` (owner_admin, ceo_diretoria). Exige motivo, autorizador interno, evidência disponível, responsável e prazo de regularização. Estado: engajamento `AUTHORIZED` + início `PENDING` — "autorizado com documentação pendente" — registrado na história como `AUTHORIZED_WITH_PENDING_DOCUMENTATION`.

- **Nenhum aceite é fabricado:** a proposta continua como estava.
- **O projeto pode rodar:** medição e evidência seguem normalmente.
- **O faturamento trava:** `contract_billing_eligibility_resolve` passou a ser um invólucro do resolvedor original (`_core`), que repete a guarda de inquilino e acrescenta o bloqueio `COMMERCIAL_DOCUMENTATION_PENDING`.
- **A pendência não se esconde:** faixa no dossiê da oportunidade, da proposta, na Conta 360 e na cadeia de origem do projeto; acompanhamento aberto no motor canônico para o responsável, com aviso.
- **Regularizar** anexa a evidência, a promove a fonte regente por escrito e reavalia o faturamento na mesma transação.

## Documento da proposta antes do engajamento (215)

`contract_documents.proposal_id` — o PDF da PT/PC entra no acervo canônico sem engajamento. Uma revisão tem **um** documento de registro. A leitura usa a mesma tarefa, prompt e normalização da inteligência documental compartilhada e agora também **classifica** o documento (papel e revisão impressa). Divergência entre o que o documento diz e o que foi declarado vira **aviso**, nunca correção automática. Os fatos alimentam um blueprint de planejamento quando a revisão ainda não tem um.

## Alçadas

| Permissão | Papéis |
| --- | --- |
| `commercial.surveys.manage` | owner_admin, juridico_contratos, gestor_projetos, engenharia_pcp |
| `commercial.execution.start` | owner_admin, ceo_diretoria, juridico_contratos |
| `commercial.execution.start_exceptional` | owner_admin, ceo_diretoria |

`engenharia_pcp` recebe só o levantamento: a leitura do levantamento não expõe valor nem probabilidade. O fechamento não dispensa as alçadas que cada parte já exigia (registrar aceite, operar OS, criar projeto).

## Como verificar

```bash
node scripts/commercial/discovery-execution-proof.mjs   # 49 provas, sempre ROLLBACK
npm run verify:commercial                              # e2e, invariantes, auditoria
npx vitest run tests/unit/commercial-discovery-execution.test.ts tests/unit/commercial-document-classification.test.ts
PONTO_E2E_REUSE=1 npx playwright test tests/commercial-flow.spec.ts --project=chromium
```
