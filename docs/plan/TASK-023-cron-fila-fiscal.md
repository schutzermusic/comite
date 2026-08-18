# TASK-023 — Reagendar a fila fiscal quando houver provedor de produção

## O que foi removido, e por quê

O `vercel.json` tinha um cron para `/api/fiscal/jobs` a cada 5 minutos
(`*/5 * * * *`). Ele quebrava **todo build** na Vercel:

> Hobby accounts are limited to daily cron jobs.
> This cron expression (*/5 * * * *) would run more than daily.

Foi removido — e não apenas afrouxado para diário — porque hoje ele não teria o
que fazer:

- o único provedor registrado é o **sandbox**
  (`src/lib/fiscal/provider/index.ts` só resolve `'sandbox'`);
- o sandbox responde *"O adaptador sandbox não pode transmitir em produção"*,
  e `processFiscalJob` trata isso como falha **terminal**;
- a própria tela `Fiscal › Configuração` declara *"Produção permanece bloqueada
  sem conector fiscal homologado"*, com o item de go-live "Credenciais oficiais
  e piloto aprovados" fixo em não-atendido.

Um agendamento de 5 em 5 minutos para uma fila que só pode falhar em produção
é ruído, não funcionalidade.

## Nada ficou inacessível

A rota continua existindo e drenável:

- `POST /api/fiscal/jobs` — botão **"Processar fila"** em `Fiscal › Configuração`
  (`src/components/fiscal/FiscalSettings.tsx`), com permissão `fiscal.transmit`;
- `GET /api/fiscal/jobs` — `Authorization: Bearer <CRON_SECRET>`, pronto para
  qualquer agendador externo.

## Critérios para reavaliar

Decisão registrada em 18/08/2026: o módulo fiscal **segue pré-go-live** e a
ausência de cron está aprovada. A fila só volta a precisar de agendamento
quando a emissão real de NFS-e em produção entrar na mesa — e aí a reavaliação
cobre os cinco pontos, nesta ordem:

1. provedor fiscal homologado;
2. credenciais oficiais;
3. piloto fiscal aprovado;
4. rotina automática da fila;
5. cron/worker adequado ao plano da Vercel em vigor.

Os três primeiros são pré-requisito de negócio; os dois últimos são a parte de
infraestrutura descrita abaixo.

## Quando religar

Ao habilitar o primeiro adaptador de provedor real, a fila precisa de cadência
de minutos — e o plano Hobby continuará não permitindo. O repositório já tem o
padrão para isso, criado quando `/api/ponto/cron` esbarrou no mesmo limite:

- `vercel.json` mantém uma execução **diária** como rede de segurança;
- um workflow do GitHub Actions dá a cadência real
  (ver `.github/workflows/ponto-cron.yml`, que documenta a decisão no topo).

Para o fiscal, isso exige:

- secret `FISCAL_CRON_SECRET` no repositório, igual ao `CRON_SECRET` da Vercel;
- variável `FISCAL_SITE_URL`;
- o workflow chamando `GET` (a rota de cron é GET; a do Ponto é POST).

A alternativa é subir o projeto para o plano Pro, onde `*/5 * * * *` é aceito
direto no `vercel.json` e nada disso é necessário.

## Procedência

O cron entrou no commit `020c850`, vindo da branch `feat/aso-documento-primario`
— não do trabalho de Pessoas & Custos. Como `020c850` ainda não estava em `main`,
ele caiu dentro do diff do PR `feat/people-costs-overview-reports`, que foi onde
o erro apareceu.
