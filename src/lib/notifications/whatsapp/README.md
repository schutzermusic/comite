# WhatsApp — fronteira de provedor

Este diretório é a **única** porta de saída de WhatsApp do Apex. Hoje só existe o
provedor **simulado** (`fake`), disponível apenas em teste (`NODE_ENV=test`) e na
pilha isolada de QA (`APEX_QA_ENVIRONMENT=1`) — nunca em produção da Vercel. Nenhum
provedor real está implementado, e nenhuma linha de código de rede existe aqui.

## Quando o canal sai

`resolveWhatsAppChannel(linha, env)` só devolve `READY` com as **três** condições ao
mesmo tempo:

1. **Decisão governada** — uma linha `notification_channel_integrations`
   (`channel = 'whatsapp'`, `status = 'ENABLED'`) da organização, gravada por
   `notification_channel_set(...)` com autor e **motivo**. Sem linha: `NOT_CONFIGURED`.
   Linha `DISABLED`: `DISABLED`.
2. **Provedor registrado e disponível neste ambiente** — nome reservado (`meta_cloud`,
   `twilio`, `zenvia`, `gupshup`) ou desconhecido dá `PROVIDER_NOT_IMPLEMENTED`;
   registrado mas fora do ambiente permitido dá `PROVIDER_UNAVAILABLE`.
3. **Credenciais presentes** — `provider.configured(env).ok`; senão `CREDENTIALS_MISSING`
   (com os NOMES das variáveis ausentes, nunca os valores).

**Variável de ambiente sozinha nunca liga o canal.** Credencial no servidor sem a linha
governada não envia nada.

Além do canal, cada pessoa precisa de **opt-in**: `user_notification_preferences`
(`channel = 'whatsapp'`, `enabled = true`, `destination` em E.164) gravado pela própria
pessoa via `notification_preference_set`. `profiles.phone` é texto livre não verificado
e **não é usado**. Sem opt-in, a entrega fica `SKIPPED` com código `NO_OPT_IN`.

## Conteúdo

O nível vem da linha governada (`content_level`):

- `MINIMAL` (padrão) — tipo da decisão, projeto, dias até a necessidade e o link. **Sem
  valor, sem fornecedor, sem justificativa, sem e-mail.**
- `STANDARD` — acrescenta valor e fornecedor. Justificativa e motivo **nunca** vão por
  WhatsApp, em nenhum nível.

A mensagem nunca aprova nada: ela leva ao Apex, onde a decisão acontece com a sessão da
pessoa. Não existe link mágico de aprovação.

## Como um provedor real entra

1. **Implementar** `WhatsAppProvider` (`types.ts`) num arquivo próprio
   (ex.: `meta-cloud.ts`):
   - `id` igual ao nome reservado (`meta_cloud`), no formato `^[a-z][a-z0-9_]{1,40}$`;
   - `configured(env)` declara as credenciais **por nome de variável** e devolve
     `{ ok, missing }`;
   - `send({ to, body }, { idempotencyKey })` chama a API oficial, repassa a chave de
     idempotência quando o provedor aceitar, e devolve `{ messageId }` — o id do
     provedor, que é o que o webhook vai citar;
   - falha que repetir não conserta (número inválido, modelo recusado, conta
     bloqueada) sobe como `WhatsAppSendError(code, msg, false)`; o resto sobe como erro
     comum ou `WhatsAppSendError(..., true)` e vira retentativa com recuo exponencial no
     livro `decision_deliveries`.
2. **Registrar** o id em `REGISTRY` (`registry.ts`), com `available(env)` dizendo em que
   ambientes ele roda, e tirá-lo de `RESERVED_WHATSAPP_PROVIDERS`.
3. **Credenciais** só por variável de ambiente do servidor (sem prefixo
   `NEXT_PUBLIC_`), com os NOMES documentados em `.env.example`. Nada secreto em
   `notification_channel_integrations.config` — o CHECK `apex_payload_is_safe` recusa
   chave com cara de segredo; ali só vai configuração pública (id do remetente, nome do
   modelo aprovado).
4. **Ligar** por organização com `notification_channel_set(org, ator, 'whatsapp',
   'ENABLED', '<id>', 'MINIMAL' | 'STANDARD', '<motivo>')`. O ator precisa de
   `notifications.channels.manage`; a mudança emite
   `platform.notification_channel.changed`. O canal ativado vale para avisos **novos**:
   entregas antigas em `NOT_CONFIGURED` não são reenviadas.
5. **Webhook de entrega** — uma rota de servidor que valida a assinatura do provedor e
   chama `decision_delivery_mark_delivered(p_provider, p_message_id, p_delivered_at)`
   com o service role. Ela só promove `SENT` → `DELIVERED` da mensagem citada.
6. **Testes** — unidade para `configured`, classificação de erro e idempotência; o
   simulado continua sendo o provedor dos testes de ponta a ponta.

## Onde é usado

`src/lib/decisions/notify.ts` (entrega de avisos de Decisões): lê a linha do canal,
resolve o provedor, confere o opt-in e registra o resultado em
`decision_delivery_record` — `NOT_CONFIGURED` com o estado como código, `SKIPPED`
(`NO_OPT_IN`), `SENT` com o id da mensagem e o número mascarado, ou retentativa.
