-- ============================================================
-- CONTRACTS V2 · PHASE 0.4 — VOCABULÁRIO CANÔNICO DE contracts.status
-- Migration: 101_contract_status_vocabulary
-- ============================================================
--
-- O DEFEITO
--
-- `contracts.status` nasceu `text NOT NULL DEFAULT 'draft'` sem CHECK (006), e
-- o tipo TypeScript é uma união ABERTA (`... | string`). O resultado é que o
-- banco aceita qualquer palavra e o compilador não recusa nenhuma — status é a
-- coluna que decide o que aparece em cada recorte da carteira, e não havia um
-- só lugar onde o conjunto de valores válidos estivesse escrito.
--
-- DE ONDE VEM O VOCABULÁRIO
--
-- Ele não foi inventado aqui. É a união do que a aplicação já produz e exibe:
--
--   contract-upload.tsx CONTRACT_STATUSES  → negotiation, legal_review,
--                                            commercial_review, signed, active
--   cockpit/ContractIdentity STATUS_LABEL  → + draft, expiring_soon, expired,
--                                            closed, cancelled, archived
--   ContractCard / ContractDossierDrawer   → mesmo conjunto, sem draft/archived
--   type ContractStatus (contract-service)  → draft, active, expiring_soon,
--                                            expired, archived
--
-- E ele CONTÉM o que a produção tem hoje. A verificação abaixo não é decorativa:
-- se aparecer valor fora do conjunto, esta migration FALHA e não grava nada.
-- Descartar ou renomear o valor divergente em silêncio seria reescrever dado de
-- produção para fazer uma restrição passar — que é o oposto do que ela serve.
--
-- Nada é renomeado. `negotiation` continua `negotiation`.
-- ============================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.contract_status_vocabulary()
RETURNS text[]
LANGUAGE sql IMMUTABLE
AS $$ SELECT ARRAY[
  'draft',
  'negotiation',
  'legal_review',
  'commercial_review',
  'signed',
  'active',
  'expiring_soon',
  'expired',
  'closed',
  'cancelled',
  'archived'
]::text[] $$;

COMMENT ON FUNCTION public.contract_status_vocabulary() IS
  'Vocabulário canônico de contracts.status. Espelha o type ContractStatus em lib/contracts/contract-service.ts.';

DO $$
DECLARE
  offenders text;
BEGIN
  SELECT string_agg(DISTINCT format('%s (%s linha[s])', c.status, c.n), '; ')
    INTO offenders
    FROM (
      SELECT status, count(*) AS n
        FROM public.contracts
       WHERE status IS NULL
          OR NOT (status = ANY (public.contract_status_vocabulary()))
       GROUP BY status
    ) c;

  IF offenders IS NOT NULL THEN
    RAISE EXCEPTION
      E'[101] contracts.status contém valor fora do vocabulário canônico: %.\n'
      '       A migration foi interrompida de propósito. Decida explicitamente se o valor é\n'
      '       válido (inclua-o em contract_status_vocabulary() e no type ContractStatus) ou se\n'
      '       a linha precisa de correção auditada. Nenhum dado foi alterado.', offenders;
  END IF;

  RAISE NOTICE '[101] Todos os status de produção pertencem ao vocabulário canônico.';
END $$;

-- O CHECK é escrito por extenso, e não como chamada a
-- `contract_status_vocabulary()`, de propósito: uma restrição que depende de
-- função de usuário sobrevive mal a dump/restore e, pior, mudaria de sentido
-- silenciosamente se alguém redefinisse a função sem revalidar as linhas. A
-- função continua existindo como fonte legível e consultável — e o bloco
-- abaixo garante que as duas dizem a mesma coisa no momento da criação.
ALTER TABLE public.contracts DROP CONSTRAINT IF EXISTS contracts_status_check;
ALTER TABLE public.contracts
  ADD CONSTRAINT contracts_status_check
  CHECK (status IN (
    'draft',
    'negotiation',
    'legal_review',
    'commercial_review',
    'signed',
    'active',
    'expiring_soon',
    'expired',
    'closed',
    'cancelled',
    'archived'
  ));

DO $$
DECLARE
  drift text;
BEGIN
  SELECT string_agg(v, ', ') INTO drift
    FROM (
      SELECT unnest(public.contract_status_vocabulary()) AS v
      EXCEPT
      SELECT regexp_matches[1]
        FROM regexp_matches(
               (SELECT pg_get_constraintdef(oid) FROM pg_constraint
                 WHERE conrelid = 'public.contracts'::regclass AND conname = 'contracts_status_check'),
               '''([a-z_]+)''::text', 'g') AS regexp_matches
    ) missing;

  IF drift IS NOT NULL THEN
    RAISE EXCEPTION '[101] contract_status_vocabulary() e contracts_status_check divergem: % ausente(s) no CHECK.', drift;
  END IF;

  RAISE NOTICE '[101] Vocabulário e CHECK conferem (% valores).', array_length(public.contract_status_vocabulary(), 1);
END $$;

COMMENT ON COLUMN public.contracts.status IS
  'Estado comercial/contratual. Vocabulário fechado por contracts_status_check — ver contract_status_vocabulary().';

COMMIT;
