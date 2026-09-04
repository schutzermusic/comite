# Contracts V2 — itens operacionais diferidos

Itens que **não** são débito de código: o código está escrito, revisado e no
repositório. Eles dependem de uma condição externa e precisam ser executados
quando essa condição existir.

---

## DEF-01 · Validar a extração de cláusulas após restaurar o crédito da API Anthropic

**Estado:** aberto · **Origem:** Fase 0, tarefa 0.3 · **Bloqueio:** externo (billing)

### Por que ficou aberto

A rota `/api/ai/clause-extraction/[contractId]` escreve
`contract.clauses_extracted` em `audit_logs` **somente no ramo de sucesso**. No
ambiente atual esse ramo não roda, porque a conta da Anthropic está sem crédito:

```
POST https://api.anthropic.com/v1/messages → HTTP 400
{"type":"invalid_request_error",
 "message":"Your credit balance is too low to access the Anthropic API."}
```

Verificado direto contra a API, fora da aplicação: a chave é válida, a conta não
tem saldo. Não é defeito de produto, e por isso a Fase 0 foi aceita com este
item explicitamente diferido.

O que JÁ foi provado sem crédito: o PDF real é anexado pela interface e chega ao
bucket; a rota é alcançada; a análise é gravada como `running` antes da chamada;
o erro vira estado terminal `failed` com motivo registrado. Falta apenas o
desfecho de sucesso.

### O que fazer quando houver crédito

1. Confirmar que a API responde:

   ```bash
   node -e "require('dotenv').config({path:'.env.local'});
     fetch('https://api.anthropic.com/v1/messages',{method:'POST',headers:{
       'x-api-key':process.env.ANTHROPIC_API_KEY,'anthropic-version':'2023-06-01',
       'content-type':'application/json'},body:JSON.stringify({model:'claude-opus-5',
       max_tokens:8,messages:[{role:'user',content:'ping'}]})})
     .then(r=>console.log(r.status))"
   ```

   `200` significa que a suíte deixa de pular sozinha — o guard em
   `tests/contracts-audit-extraction.spec.ts` refaz essa checagem no `beforeAll`.

2. Rodar a suíte contra um servidor de produção (`next build && next start`), e
   de preferência contra a **Vercel**, onde há proxy real:

   ```bash
   PLAYWRIGHT_BASE_URL=https://<deployment>.vercel.app \
     npx playwright test tests/contracts-audit-extraction.spec.ts
   ```

3. Critérios de aceitação — todos já codificados na suíte:

   | # | Critério |
   |---|---|
   | 1 | A análise termina em `completed`, com `model`, `extractor_version` e `document_id` |
   | 2 | Existe linha em `audit_logs` com `action = 'contract.clauses_extracted'` |
   | 3 | `actor_user_id` é o usuário autenticado; `organization_id` é o da sessão |
   | 4 | `entity_type = 'contract'` e `entity_id` é o contrato analisado |
   | 5 | `metadata` traz `document_id`, `model`, `version` e `proposed > 0` |
   | 6 | **`user_agent` preenchido** — vem do cabeçalho do navegador, existe em qualquer ambiente |
   | 7 | **`ip_address` preenchido SOMENTE quando há proxy confiável** (`x-forwarded-for` / `x-real-ip`). Em servidor local não há proxy e nulo é a resposta correta: **não invente IP para a asserção passar** |
   | 8 | Portão de evidência intacto: toda proposta tem `source_page` e `source_excerpt` |
   | 9 | Proveniência em colunas: `ai_model`, `ai_analysis_id`, `ai_confidence` entre 0 e 1 |
   | 10 | Proposta nasce `review_status = 'draft'` — proposta não é cláusula contratual |
   | 11 | Reanálise do mesmo documento não duplica a fila (índice de fingerprint, migration 094) |
   | 12 | A análise anterior daquele documento fica `superseded` |

### O que NÃO fazer

- **Não** adicionar `maxDuration` à rota para contornar o limite de função
  serverless. A extração síncrona dentro do request é justamente o que a
  arquitetura congelada resolve na **Fase 4**, movendo-a para
  `domain_events → apex_jobs`. Um paliativo agora competiria com esse desenho.
- **Não** remover nem "consertar" o `skip` da suíte. Ele reporta a verdade
  ("não verificável neste ambiente") em vez de pintar de vermelho um problema
  que não é do produto — e volta a rodar sozinho quando a condição mudar.
- **Não** substituir o PDF real por um stub. `scripts/fixtures/make-contract-pdf.mjs`
  existe porque as demais suítes anexam `%PDF-1.4\n% contrato e2e\n`, que não é
  um PDF, e era isso que mantinha o ramo de sucesso sem cobertura.

### Arquivos

- `tests/contracts-audit-extraction.spec.ts` — a suíte
- `scripts/fixtures/make-contract-pdf.mjs` — o PDF de verdade
- `src/lib/audit/log-audit-event-server.ts` — o escritor de servidor
- `src/app/api/ai/clause-extraction/[contractId]/route.ts` — a rota
