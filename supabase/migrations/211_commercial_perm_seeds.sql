-- ============================================================================
-- 211 — O MÓDULO COMERCIAL GANHA ALÇADA
--
-- ─── O defeito ───────────────────────────────────────────────────────────
--
-- As onze permissões `commercial.*` foram cadastradas (198/199/200) e NENHUMA
-- foi concedida a papel nenhum. Resultado: `/comercial` respondia
-- "Esta ação exige: commercial.view" para todo mundo — inclusive para
-- `owner_admin`, que é o administrador do inquilino e já detém os outros
-- dezenove módulos por inteiro.
--
-- ─── Por que o erro foi cometido ─────────────────────────────────────────
--
-- A 192 estabeleceu, com razão, que "conceder permissão a papel é ato de quem
-- administra o inquilino" e não semeou grants. Aquilo valia para o caso dela:
-- uma chave NOVA dentro de um módulo que JÁ era alcançável
-- (`contracts.measurements.review`). A chave nova estreita autoridade; o
-- módulo continua abrindo sem ela.
--
-- Um MÓDULO novo é o caso oposto. Sem grant, ele não abre para ninguém, e
-- não existe caminho para conceder: a tela `/roles` desta base ainda é
-- mock (`src/lib/mock-data`), sem ligação com `permissions` /
-- `role_permissions`. A regra da 192, aplicada aqui, produziu uma porta sem
-- maçaneta dos dois lados.
--
-- ─── O critério das concessões ───────────────────────────────────────────
--
-- Não é "todo mundo para a tela abrir" (§7 do escopo). É a alçada que cada
-- papel JÁ exerce, espelhada:
--
--   owner_admin        administra o inquilino e é o único com
--                      `contracts.create` + `projects.create` → tudo.
--   ceo_diretoria      dirige e decide preço → ver + manter funil.
--   juridico_contratos já cria contrato e responde pelo instrumento →
--                      proposta, engajamento, documento, divergência, OS.
--                      NÃO recebe `bind_project`: abrir projeto é autoridade
--                      de quem executa.
--   gestor_projetos    já tem `projects.create` → ver + OS + vincular projeto.
--                      É exatamente a passagem OS → Projeto.
--
-- `financeiro`, `engenharia_pcp`, `rh` e `ponto_field_worker` NÃO recebem
-- nada. Ver contrato assinado não é o mesmo que ver funil de vendas com preço
-- e probabilidade, e conceder por conveniência é como o módulo vira público.
-- Quem precisar depois é decisão de quem administra o inquilino.
--
-- Data-only e idempotente, no padrão da 046.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- owner_admin → o módulo inteiro
-- ---------------------------------------------------------------------------
WITH r AS (
  SELECT id FROM public.roles WHERE organization_id IS NULL AND key = 'owner_admin'
), p AS (
  SELECT id FROM public.permissions WHERE module = 'commercial'
)
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM r, p
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- ceo_diretoria → ver e manter o funil; não opera OS nem projeto
-- ---------------------------------------------------------------------------
WITH r AS (
  SELECT id FROM public.roles WHERE organization_id IS NULL AND key = 'ceo_diretoria'
), p AS (
  SELECT id FROM public.permissions WHERE key IN (
    'commercial.view',
    'commercial.manage',
    'commercial.proposals.manage',
    'commercial.proposals.approve_internal'
  )
)
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM r, p
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- juridico_contratos → governa proposta, autorização, documento e OS
--
-- `record_acceptance` entra aqui de propósito: registrar o que o cliente
-- respondeu é ato de quem responde pelo instrumento. Continua sendo REGISTRO,
-- nunca aceite — a função governada exige ator humano nomeado.
-- ---------------------------------------------------------------------------
WITH r AS (
  SELECT id FROM public.roles WHERE organization_id IS NULL AND key = 'juridico_contratos'
), p AS (
  SELECT id FROM public.permissions WHERE key IN (
    'commercial.view',
    'commercial.manage',
    'commercial.proposals.manage',
    'commercial.proposals.approve_internal',
    'commercial.proposals.record_acceptance',
    'commercial.engagements.manage',
    'commercial.divergences.resolve',
    'commercial.documents.ingest',
    'commercial.facts.confirm',
    'commercial.service_orders.manage'
  )
)
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM r, p
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- gestor_projetos → a passagem OS → Projeto
-- ---------------------------------------------------------------------------
WITH r AS (
  SELECT id FROM public.roles WHERE organization_id IS NULL AND key = 'gestor_projetos'
), p AS (
  SELECT id FROM public.permissions WHERE key IN (
    'commercial.view',
    'commercial.service_orders.manage',
    'commercial.service_orders.bind_project'
  )
)
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM r, p
ON CONFLICT DO NOTHING;

COMMIT;
