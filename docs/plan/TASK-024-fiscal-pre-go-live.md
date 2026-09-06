# TASK-024 — Fiscal / NFS-e: fundação ativa, emissão real no portão de credencial

## Estado atual (06/09/2026)

| Item | Estado |
|---|---|
| Fundação de banco | **ATIVA** — migrations `112_fiscal_nfse_foundation.sql` e `113_fiscal_perm_seeds.sql` aplicadas em produção |
| Permissões `fiscal.*` | **ATIVAS** — sete chaves cadastradas e atribuídas a `owner_admin`, `financeiro`, `ceo_diretoria`, `juridico_contratos` |
| Abstração de provedor | **PRESERVADA** — registro em `src/lib/fiscal/provider/index.ts`, nenhum município embutido |
| Provedor sandbox | **ATIVO** — caminho de homologação provado de ponta a ponta |
| Provedor real (`nfse_nacional`) | **IMPLEMENTADO** — DPS canônica, assinatura XMLDSig, mTLS, leitura de resposta real |
| Emissão real em homologação | **BLOQUEADA no portão de credencial** — faltam itens externos (abaixo) |
| Emissão em produção | **DESLIGADA e bloqueada estruturalmente** |
| Menu do módulo | desligado por padrão (`NEXT_PUBLIC_FISCAL_MODULE_ENABLED`) |

## O que mudou em relação ao registro anterior

O bloqueio anterior era outro: a migration `090_fiscal_nfse.sql` nunca havia sido
aplicada, e a checagem de banco confirmava que `fiscal_documents`,
`fiscal_jobs` e `fiscal_establishments` respondiam 404.

A 090 **não** foi aplicada. Ela foi arquivada em
`supabase/migrations-superseded/` como rascunho histórico e substituída pelas
112/113, escritas para a arquitetura atual — ver o README daquele diretório para
a tabela ponto a ponto do que ela contradizia (Party canônica, centro de custo
canônico, chaves compostas por inquilino, fronteira com Finanças).

## O portão de credencial

O adaptador real transmite de verdade e **não simula resposta**. Quando falta
qualquer pré-requisito externo, ele lança `FiscalCredentialsRequiredError`, que
o worker trata como terminal — a tarefa vai para `dead_letter` na primeira
tentativa, o documento **não** é marcado como autorizado, e o bloqueio vira
evento auditável. Nenhuma retentativa resolve a falta de um certificado, e fingir
que resolveria só produziria seis tentativas e um estado confuso.

Falta, hoje, o seguinte — tudo fora do código:

1. **Certificado digital ICP-Brasil A1** (`.pfx`/`.p12`) da organização emitente.
2. **Senha do certificado**.
3. **`FISCAL_CERT_KEY`** no ambiente do servidor (mínimo 32 caracteres;
   gere com `openssl rand -base64 48`). É a chave que cifra certificado e senha
   antes de gravá-los. Sem ela, nenhum segredo fiscal pode ser guardado.
4. **Inscrição municipal ativa** do estabelecimento emitente.
5. **Adesão/credenciamento** ao ambiente nacional da NFS-e.
6. **Endereço (`base_url`) do ambiente de homologação**, publicado pela
   administração tributária. Nenhuma URL fica embutida no código de propósito:
   homologação e produção são endereços distintos, e um erro de digitação no
   código viraria transmissão para o lugar errado.

Com esses seis itens, `POST /api/fiscal/provider-config` recebe o certificado em
base64 e a senha, abre o `.pfx` na hora (para a senha errada falhar ali, e não no
meio de uma transmissão), guarda tudo cifrado e registra validade e impressão
digital. A partir daí a emissão em homologação passa a funcionar sem mudança de
código.

## Produção continua bloqueada — e o bloqueio é estrutural

Não é uma flag que alguém liga. `fiscal_production_gates` tem uma coluna por
condição, e o gatilho `fiscal_guard_production` recusa `production_enabled = true`
enquanto faltar qualquer uma:

- `certificate_installed`
- `municipal_registration_active`
- `provider_contract_signed`
- `homologation_pilot_approved`
- `accountant_signoff`
- `legal_signoff`

O gatilho roda para todo mundo, service role incluído — não existe caminho de
aplicação que o contorne. Em cima disso, o banco recusa por CHECK habilitar o
adaptador sandbox em produção, e recusa integração de produção para
estabelecimento sem produção habilitada. As três coisas foram provadas com dado
descartável em `scripts/assert-fiscal-foundation.sql`.

## Para ligar o menu

1. Concluir o portão de credencial acima e emitir uma NFS-e real em homologação.
2. `NEXT_PUBLIC_FISCAL_MODULE_ENABLED=true` no ambiente.
3. Testar com os dois perfis — `owner_admin` e usuário comum sem permissão
   fiscal — confirmando que o menu aparece para quem deve e some para quem não.
4. Decidir cron/worker da fila. Ver `TASK-023`.

## Como reproduzir as provas

```bash
node scripts/prove-migrations-089-111.mjs      # registro x schema
node scripts/apply-fiscal-foundation.mjs       # ensaio da fundação (ROLLBACK)
npx tsx scripts/smoke-fiscal-homologation.ts   # ciclo completo em homologação
npx vitest run tests/unit/fiscal-provider-nacional.test.ts
npx vitest run tests/integration/fiscal-security-contract.test.ts
```

## Relacionados

- `TASK-023` — remoção do cron da fila fiscal e critérios de reativação.
- `supabase/migrations-superseded/README.md` — por que a 090 foi arquivada.
