# Migrations substituídas — nunca aplicar

O que está aqui **não foi aplicado** em nenhum banco e **não deve ser**. Os
arquivos ficam com a extensão `.superseded` e fora de `supabase/migrations/`
de propósito: nenhuma ferramenta guiada pelo diretório de migrations os enxerga,
então não existe caminho pelo qual `supabase db push` ou um runner os execute
por engano.

Eles permanecem no repositório porque apagar história é pior que arquivá-la:
quem for ler um commit antigo, ou entender por que uma numeração pulou, precisa
encontrar o arquivo.

## `090_fiscal_nfse.sql.superseded`

Rascunho da fundação Fiscal / NFS-e, escrito antes das fases 1 e 2 do
Contracts V2. **Nunca foi aplicado**: em produção nenhuma das suas onze tabelas
existe, `ledger_entry` e `apar_title` nunca receberam `organization_id`, o bucket
`fiscal-documents` nunca foi criado e nenhuma permissão `fiscal.*` foi semeada.
Isso foi provado objeto por objeto por `scripts/prove-migrations-089-111.mjs`.

Foi substituído por:

- `supabase/migrations/112_fiscal_nfse_foundation.sql`
- `supabase/migrations/113_fiscal_perm_seeds.sql`

Não é uma cópia renumerada. A 090 contradizia três decisões hoje congeladas, e
aplicá-la teria criado exatamente os problemas que as fases 1 e 2 resolveram:

| A 090 fazia | Por que não pode | O que a 112 faz |
|---|---|---|
| `fiscal_parties` com razão social e documento próprios | D1 — identidade de contraparte é `parties` + `party_roles`; um segundo cadastro é um segundo lugar para o nome divergir | tomador é Party canônica; `fiscal_party_profiles` guarda só o que a NFS-e exige e a Party não tem |
| `cost_center_id → cost_center` (legado) | D4 — o centro de custo canônico é `finance_cost_centers` | FK composta para `finance_cost_centers` |
| chave estrangeira simples em toda referência | coerência de inquilino é estrutural, não só RLS | toda FK entre tabelas de inquilino é `(organization_id, id)` |
| `organization_id` em `ledger_entry`/`apar_title` e contabilização automática | Finanças é dona do razão e do contas a receber; a integração é a Fase 7 | nada é escrito no Financeiro; `finance_status` fica em `not_posted` |
| `tax_obligation` | obrigação tributária é de Finanças (ver `src/lib/finance/finance-store.ts`) | fora de escopo, deferido para a Fase 7 |

O registro canônico de migrations **não** contém a versão 090, e é assim que
deve permanecer: marcá-la como aplicada seria afirmar sobre o banco algo que o
banco desmente.
