# TASK-024 — Fiscal / NFS-e permanece pré-go-live

## Estado

O módulo Fiscal está **completo no código** (seis páginas, rotas de API,
engine, provedor sandbox, cinco itens de menu) e **desligado por configuração**.

Decisão de 18/08/2026: liberar Pessoas & Custos sem liberar o Fiscal.

## Por que foi escondido

Ao preparar o merge do PR #33 para produção, a verificação do banco mostrou que
a migration `090_fiscal_nfse.sql` **não está aplicada**: `fiscal_jobs`,
`fiscal_documents` e `fiscal_establishments` respondem 404 no PostgREST.

O agravante estava na sidebar — `canSeeItem` tinha, como segunda linha:

```ts
if (isOwnerAdmin) return true;   // ignora `permission` de propósito
```

E a tabela `permissions` não tem nenhuma chave `fiscal.*`. Ou seja: usuário
comum não veria o menu (por ausência de permissão), mas **owner_admin veria os
cinco itens** e cairia em telas consultando tabelas inexistentes.

## Como foi desligado

- `src/lib/modules/registry.ts` — registry server-safe, sem React. O padrão é
  **desligado**: só `1|true|yes|on` liga; ausente, vazio ou lixo resolve `false`.
- `NEXT_PUBLIC_FISCAL_MODULE_ENABLED` — a variável. **Não defina** para manter
  desligado. Definir como `false` também mantém.
- `app-sidebar.tsx` — `MenuItem.module`, e a checagem entra como **primeira
  regra de `canSeeItem`, antes do bypass de owner_admin**. `filterSubItems`
  herda o módulo do pai.
- `src/app/(main)/fiscal/layout.tsx` — acesso direto por URL mostra "Módulo em
  implantação". Portão de interface; a proteção real das rotas segue RBAC + RLS.

Nenhuma lógica fiscal foi alterada. Nenhuma rota fiscal foi alterada. A
migration 090 **não** foi aplicada.

## Para habilitar

Na ordem — cada item depende do anterior:

1. **Aplicar a migration `090_fiscal_nfse.sql`** em produção e conferir que as
   tabelas `fiscal_*` respondem.
2. **Cadastrar as permissões `fiscal.*`** (`fiscal.view`, `fiscal.create`,
   `fiscal.configure`, `fiscal.transmit`) e atribuí-las aos papéis.
3. **Validar o provedor fiscal** — hoje só existe o adaptador `sandbox`, que
   recusa transmitir em produção. Precisa de um adaptador real homologado.
4. **Validar sandbox e produção** com credenciais oficiais e piloto aprovado.
5. **Ligar a flag** `NEXT_PUBLIC_FISCAL_MODULE_ENABLED=true` no ambiente.
6. **Testar com os dois perfis** — owner_admin e usuário comum sem permissão
   fiscal — confirmando que o menu aparece para quem deve e some para quem não.
7. **Decidir cron/worker** da fila. Ver `TASK-023`: o plano Hobby da Vercel só
   aceita cron diário, e o padrão do repositório é diário no `vercel.json` +
   GitHub Actions para a cadência real.

## Relacionados

- `TASK-023` — remoção do cron da fila fiscal e critérios de reativação.
