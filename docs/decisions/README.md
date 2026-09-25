# Decisões — a caixa de decisões humanas do Apex

> "O que precisa de mim agora?"

Migrations **239** (reparo das guardas do motor), **240** (Decisões), **241**
(endurecimento após revisão adversarial) e **242** (notificações in-app no
inquilino ativo, imutáveis para o destinatário — a camada por onde o aviso
in-app de Decisões chega ao sino).
Este documento diz o que Decisões é, o que ela **não** é, de onde vem cada
número, como ela age e como colocá-la no ar.

---

## 1. O que Decisões é — e o que não é

```text
Fluxo de domínio (Compras, Contratos…)
  → avaliação de política / alçada            (canônica, no domínio)
  → decisão humana exigida                    (etapa do motor | submissão sob alçada)
  → DECISÕES  = LEITURA dessa decisão, na hora, para a pessoa certa
  → a pessoa decide AQUI ou na origem         (o MESMO ato canônico)
  → o fluxo de domínio segue                  (a origem aplica o desfecho)
```

- **Não é um motor de aprovação.** Nenhuma tabela de "decisão", nenhum estado
  de decisão guardado. A decisão mora no Motor de Aprovação (`approval_requests`,
  `approval_request_steps`, `approval_decisions`) ou no pedido de compra sob
  alçada declarada (`purchase_orders`, `procurement_approval_authorities`,
  `purchase_order_history`).
- **Não substitui fluxos de domínio.** Gestão de Contratos → Aprovações (análise
  de medição), Pessoas & Custos → Aprovações de horas e Deliberações ficam onde
  estão. Deliberação é governança colegiada (voto, quórum); Decisões é a
  autoridade de UMA pessoa. Uma não absorve a outra (§9).
- **Não é Alerta.** Alerta informa; Decisão exige um ato humano. Os avisos de
  Decisões chegam pelo sino, mas o número da barra lateral é a contagem das
  decisões, nunca de notificações não lidas.

## 2. De onde vem cada coisa

| Na tela | Fonte canônica | Como |
|---|---|---|
| "Minhas" | etapa ABERTA do motor em que a pessoa é elegível; pedido sob alçada em que a pessoa tem a alçada | `decision_inbox_for_viewer()` — compõe `approval_step_eligibility` e `apex_actor_has_permission` + `procurement_authority_for_order` + SoD de criador/submissor |
| Contador | a mesma função, PRIMARY + ESCALATED | `decision_inbox_count_for_viewer()` |
| "Por que chegou até mim" | registro de alçada declarada (fonte, referência, teto, escopo) ou etapa da política (chave, versão, estágio, base) | `authority` do item; alçadas menores do escopo explicam "valor acima da alçada de …" |
| Prazo ("decidir até") | necessidade mais cedo dos requisitos do pedido (ou início da atividade) − prazo da proposta escolhida; expiração da etapa no motor | `decision_po_timing`; `due_at` do motor. Sem necessidade vinculada, sem prazo — nada é inventado |
| Comparação | as propostas da cotação, avaliadas pela MESMA `evaluateQuotes` de Compras | detalhe de compra |
| Impacto | só frases que as propostas avaliadas sustentam (custo a mais × dias de atraso evitados) | `procurementImpact` — cada frase traz a evidência |
| Cadeia | Fornecedor → Material → Atividade → Marco → Medição → Faturamento, **só por vínculos reais** | nó sem vínculo aparece como "sem vínculo registrado" |
| "Concluídas" | `approval_decisions` e `purchase_order_history` (append-only) | `decision_history_for_viewer()` — história não reescrevível porque não mora aqui |
| "Equipe" | todas as decisões abertas do inquilino (`decisions.team.view`) ou as dos liderados na hierarquia canônica de pessoas (`people.manager_person_id`) | `decision_team_for_viewer()` — valor só para quem lê o domínio de origem; senão "Restrito" |

### Estados normalizados (projeção determinística)

| Estado | Origem canônica |
|---|---|
| Pendente | etapa OPEN de pedido PENDING, não vencida, âncora viva; ou pedido `APPROVAL_REQUIRED` sob alçada na submissão corrente |
| Em análise | pedido do motor com decisão já registrada em outro estágio/etapa |
| Escalada | pedido sob alçada que passou do "decidir até" e tem faixa de alçada superior |
| Ajuste solicitado | `RETURNED_FOR_CORRECTION` (motor) ou devolução ao rascunho (alçada) |
| Aprovada / Rejeitada / Cancelada / Expirada | estado final do motor ou transição do histórico do pedido |

### Faixa de alçada (roteamento, não autoridade)

Entre as pessoas elegíveis para um pedido sob alçada declarada, a faixa
**PRIMÁRIA** é a do MENOR teto declarado que cobre o pedido — a decisão chega à
alçada mais próxima do valor. Quem tem teto maior continua podendo decidir
("Sob sua alçada") e recebe a decisão se ela **vencer** (Escalada). Nenhum
limite é inventado: todos vêm do registro declarado com evidência.

## 3. O ato

| Fonte | Ato canônico | Como Decisões chama |
|---|---|---|
| Motor de Aprovação | `approval_decide(etapa, APPROVED \| REJECTED \| RETURNED_FOR_CORRECTION, chave, justificativa, NULL, impressão digital)` | com o **JWT da pessoa** (ator = `auth.uid()`), chave `dec:<etapa>:<ator>:<ato>:<intenção>`; desfecho final aplicado na hora por `purchase_order_apply_approval` / `contract_billing_apply_approval` (idempotentes; a rota de evento e a reconciliação continuam sendo a garantia) |
| Alçada de compra | `purchase_order_decide(org, ator, pedido, APPROVE \| REJECT, nota)` | por `decision_purchase_order_act`, que só acrescenta a pré-condição de tela velha (submissão + impressão digital) e a resposta idempotente |

Atos oferecidos = os que o domínio executa: compra por alçada → Aprovar /
Solicitar ajuste (REJECT devolve ao rascunho); compra por política → Aprovar /
Rejeitar / Solicitar ajuste; liberação de faturamento → Aprovar / Rejeitar
("ajuste" deixaria o evento preso em `PENDING_RELEASE` e por isso não é
oferecido).

**Tela velha / concorrência.** Duas sessões abrem a mesma decisão; a primeira
aprova; a segunda tenta outro ato → `409 STALE` com o que mudou ("já foi
aprovada por X. Nada foi alterado."), o detalhe recarrega o desfecho real e os
atos somem. A trava é a do domínio (`FOR UPDATE` na linha do pedido de compra
ou do pedido de aprovação); a prova força a sobreposição com um terceiro
cliente segurando a trava.

## 4. Avisos

```text
fato de domínio (approval.stage.opened, approval.request.*, supply.purchase_order.*)
  → apex_event_routes → platform.decisions.notify ─┐
varredura a cada 15 min → platform.decisions.sweep ├→ decision_notices_plan (chave determinística)
ato em tela / submissão → after() da resposta     ─┘        → decision_deliveries (livro)
                                                              → in-app | e-mail | WhatsApp
```

| Aviso | Para quem | Canais |
|---|---|---|
| NEW | faixa primária / etapa | in-app, e-mail, WhatsApp |
| DUE_SOON | faixa primária | in-app, e-mail |
| OVERDUE | faixa primária | in-app, e-mail, WhatsApp |
| ESCALATED | faixa superior | in-app, e-mail, WhatsApp |
| RESOLVED | quem pediu | in-app |
| ADJUSTMENT_REQUESTED | quem submeteu (dono do fluxo) | in-app, e-mail |

- **Uma vez só**: chave determinística por (decisão, aviso, desfecho, pessoa,
  canal); in-app na mesma transação do registro; e-mail com `idempotencyKey`
  do Resend = chave do livro.
- **Confiabilidade**: arrendamento com expiração, recuo exponencial (30 s → 1 h)
  até `max_attempts`, `DEAD` com motivo; uma falha não para as outras; aviso de
  ação de decisão já encerrada é CANCELADO, não enviado. A decisão existe mesmo
  que o e-mail ou o WhatsApp falhem — nada roda na transação do negócio.
- **E-mail** pela infraestrutura existente (Resend + `APP_EMAIL_FROM` +
  `email_dispatches`), agora por um módulo compartilhado
  (`src/lib/notifications/email.ts`). Sem chave: `SIMULATED`. No QA: captura
  local (Mailpit), recusando qualquer host que não seja da máquina.
- **WhatsApp**: fronteira de provedor em `src/lib/notifications/whatsapp`
  (ver o README de lá). `NOT_CONFIGURED` até existir linha `ENABLED` em
  `notification_channel_integrations` + provedor implementado + credenciais.
  Variável de ambiente sozinha **não** liga o canal. Conteúdo `MINIMAL` por
  padrão; justificativa nunca vai por WhatsApp; não existe "aprovar pelo
  WhatsApp".

## 5. Segurança

- Núcleo SQL só servidor (recebe usuário/organização por parâmetro). O
  navegador alcança apenas as portas `*_for_viewer`, sem parâmetro de ator.
- Leituras do servidor com service role só depois do portão
  `decision_access_for_viewer`, e sempre filtradas pela organização da sessão.
- Tabelas novas: RLS ligada, nenhuma escrita do navegador; o livro de entrega
  é legível só pelo destinatário (e por quem administra canais).
- **239**: três RPCs do motor usavam `current_user` como guarda dentro de
  SECURITY DEFINER — a guarda nunca disparava. Provado no QA antes do reparo:
  sessão de OUTRO inquilino cancelava pedido de aprovação pendente. Agora a
  guarda lê a reivindicação JWT (`apex_caller_is_browser`, 140).
- **241**: o portão "lê a origem" (`decision_viewer_reads_subject`) espelha a
  RLS de cada domínio objeto a objeto (Equipe mostra valor só a quem lê a
  origem); todo fato `approval.*` vira aviso sem erro; aviso de desfecho não vai
  a quem saiu da organização; o desfecho do motor diz qual submissão decidiu.
- **242** (plataforma): o sino lê só a organização ATIVA; o destinatário não
  reescreve, não move e não apaga aviso — ler e arquivar são RPCs governadas
  (`notification_mark_read`, `notification_mark_all_read`,
  `notification_dismiss`); link de aviso só como caminho do app; as duas portas
  de criação exigem vínculo ATIVO. O aviso in-app de Decisões já usava a porta
  de servidor (`create_notification_for`) com caminho relativo — nada muda
  para ele.

## 6. Provas

| Onde | O quê |
|---|---|
| `scripts/operations/apply-239.mjs` | 18 provas do reparo das guardas |
| `npm run decisions:prove` (`scripts/decisions/proofs.mjs` + `proofs-241.mjs`) | 133 provas no banco: projeção, faixas, inquilino, concordância caixa × destinatários, ato canônico, tela velha, paridade com Compras, motor, avisos, canal explícito, Equipe, varredura, portão de leitura da origem |
| `npm run notifications:prove` (`scripts/notifications/proofs-242.mjs`) | 31 provas (35 no `apply-242`, com a normalização de links legados) |
| `node scripts/operations/security-audit.mjs --target=qa` | auditoria de RLS/grants/FKs/permissões até a 242 (344 verificações) |
| `tests/unit/decisions-*.test.ts`, `notifications-email`, `whatsapp-provider` | regras puras, conteúdo, orquestrador com cliente falso, adaptadores |
| `tests/qa-live/decisions-api.spec.ts` | 10 provas vivas pela API (inclui a segunda fonte: liberação de faturamento) |
| `tests/qa-live/decisions-ui.spec.ts` | 4 provas no navegador a 1440 px (do painel ao ato, tela velha, claro/escuro) |
| `tests/qa-live/decisions-mobile.spec.ts` | 3 provas no celular a 390 px |

## 7. Colocar no ar (ordem)

1. **Pré-requisito**: 237 e 238 aplicadas no banco hospedado (ver
   `docs/operations-supply/IMPLEMENTATION-LOG.md` → Runbook de deploy). Sem a
   237, a submissão não registra o solicitante (a SoD do motor não teria quem
   excluir) e a alçada ignora categoria.
2. `node scripts/operations/apply-239.mjs` (ensaio) → `--apply`. É um reparo de
   segurança do motor já em produção: vale aplicar mesmo antes do resto.
3. `node scripts/operations/apply-240.mjs` (ensaio, 120 provas) → `--apply`.
4. `node scripts/operations/apply-241.mjs` (ensaio) → `--apply`.
5. `node scripts/operations/apply-242.mjs` (ensaio, 35 provas) → `--apply` e
   `node scripts/operations/apply-243.mjs` (ensaio, 34 provas) → `--apply` e
   `node scripts/operations/apply-244.mjs` (ensaio, 52 provas) → `--apply`
   **imediatamente antes** de publicar a aplicação: a 242 tira do navegador a
   escrita direta em `notifications`, e o sino novo marca como lida pelas RPCs
   que ela cria. Entre as duas, "marcar como lida" do sino antigo falha em
   silêncio (nada se perde).
6. `node scripts/operations/security-audit.mjs` (somente leitura).
7. **Worker/app**: publicar a aplicação. A primeira drenagem com o novo
   vocabulário de trabalho liga as 8 rotas `platform.decisions.notify`
   (ativação unidirecional) e o produtor passa a agendar a varredura.
8. **Nada de configuração inventada**: em produção não há política de compra
   ativa nem alçada declarada. Até alguém com autoridade declarar alçadas
   (`procurement.authorities.manage`, com evidência) ou ativar política, a
   caixa fica vazia — e o estado vazio diz isso ("Nenhuma decisão pendente.").
9. **WhatsApp**: continua `NOT_CONFIGURED`. Para ligar, ver
   `src/lib/notifications/whatsapp/README.md` (implementar o provedor oficial,
   credenciais no ambiente, `notification_channel_set` com motivo, webhook).

## 8. Futuro: Decisão → Deliberação

Quando uma política exigir governança formal, a decisão deve **escalar** para
uma Deliberação existente — não duplicá-la:

```text
Decisão (etapa do motor)
  → política declara que exige deliberação
  → Deliberação criada no domínio de Deliberações, com referência à etapa
    (approval_request_id + step_id + subject + impressão digital)
  → desfecho formal registrado na Deliberação
  → a pessoa nomeada decide a etapa citando a Deliberação na justificativa
```

A Deliberação nunca aciona `approval_decide` sozinha: o ato do motor é sempre
de uma pessoa autenticada. Falta ao domínio de Deliberações uma referência
tipada ao pedido de aprovação — é o primeiro passo quando houver regra real.

## 9. Dívidas conhecidas

Ver a seção "Dívida" no relatório de entrega (e as tarefas abertas a partir
dele). Principais: delegação de alçada não suportada na caixa (o motor não
aplica delegação sozinho e não há tela para criá-la); expiração de ETAPA não é
materializada pelo motor; liberação de faturamento fica presa em
`PENDING_RELEASE` se o pedido do motor for devolvido/expirar/cancelar (por
isso "ajuste" não é oferecido nessa fonte); quatro pontos de envio de e-mail
antigos ainda não usam o módulo compartilhado (ASO, faturamento, medições,
ponto — Agenda e folha passaram a usá-lo ao deixarem de aceitar conteúdo do
navegador; a folha com destinatários governados pela 243). Ainda com
destinatário escolhido pelo navegador: o resumo de ASO (`/api/workforce/
aso-alerts`) manda dados de saúde ocupacional a qualquer endereço digitado —
próxima correção da mesma classe.
