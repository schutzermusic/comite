-- ============================================================
-- CONTRACTS V2 · FASE 1.1 — PARTY CANÔNICA DE PLATAFORMA
-- Migration: 102_platform_parties
-- ============================================================
--
-- O DEFEITO
--
-- Não existe UM lugar que responda "quem é esta empresa". Existem respostas
-- parciais espalhadas, e nenhuma manda nas outras:
--
--   client                            tabela de cadastro, sem organization_id
--   supplier                          tabela de cadastro, org desde a 099
--   contracts.counterparty_name       TEXTO LIVRE — a única contraparte real
--                                     dos contratos que existem hoje
--   contracts.client_id/.supplier_id  uuid solto, SEM chave estrangeira,
--                                     nunca lido nem escrito pela aplicação
--   projects.project->>'cliente'      texto livre dentro de jsonb
--   ledger_entry / apar_title         client_id e supplier_id próprios
--   business_unit                     as entidades legais da própria casa
--
-- Enquanto identidade for texto repetido em sete lugares, a pergunta "quanto
-- esta empresa nos deve, somando contrato, título e lançamento" só tem resposta
-- por casamento de nome — e casamento de nome não é resposta, é chute.
--
-- O QUE ESTA MIGRATION FAZ
--
-- Cria `parties` e `party_roles` no nível da plataforma. Identidade numa
-- tabela, papel na outra. ACME Energia S.A. que é cliente E fornecedora é UMA
-- linha em `parties` e duas em `party_roles` — nunca duas linhas em `parties`.
-- Papel não é identidade.
--
-- O QUE ESTA MIGRATION NÃO FAZ, E POR QUÊ
--
-- Não insere UMA linha sequer em `parties` nem em `party_roles`.
--
-- Entre os `counterparty_name` de produção estão 'ENEL' e 'ENEL GREEN POWER'.
-- Um humano suspeita que se relacionam. Uma migration não pode PROVAR que são a
-- mesma pessoa jurídica — são CNPJs diferentes, e a diferença é o negócio
-- inteiro. Casar as duas por semelhança de nome seria inventar identidade
-- jurídica dentro de uma transação, sem ninguém assinando embaixo; separá-las
-- por diferença de nome seria igualmente arbitrário. Nenhuma das duas decisões
-- pertence a um script.
--
-- Então `counterparty_name` fica. Intacta. O vínculo com a party canônica é
-- assunto da coluna que o domínio de Contratos vai declarar, preenchida por
-- gente, uma contraparte por vez, com o documento na mão. A verificação no fim
-- desta migration exige exatamente isso: zero parties, zero papéis.
--
-- Esta migration também NÃO toca em `contracts`. O escopo aqui é o cadastro de
-- plataforma; quem referencia party é problema de quem referencia.
--
-- DEDUPLICAÇÃO
--
-- Só determinística. O único índice único de identidade é
-- (organization_id, document_type, document_normalized), e ele é PARCIAL: quem
-- não tem CNPJ/CPF ainda pode existir. Duas empresas sem documento e com o
-- mesmo nome são DUAS linhas, e isso está certo — nome não é identidade.
-- O mesmo CNPJ em duas organizações são duas parties, também certo: inquilino
-- não compartilha cadastro.
--
-- COERÊNCIA DE TENANT
--
-- `party_roles` referencia (organization_id, party_id), não apenas party_id.
-- Verificação de chave estrangeira no PostgreSQL NÃO passa por RLS — só a chave
-- composta torna IMPOSSÍVEL pendurar papel da organização A numa party da B.
-- Política é filtro de leitura e escrita; chave é estrutura.
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 1) parties — identidade, e nada além de identidade
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.parties (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,

  -- Pessoa jurídica ou natural. Não é papel: uma pessoa natural pode ser
  -- fornecedora, e uma empresa pode ser cliente e fornecedora ao mesmo tempo.
  kind                text NOT NULL,

  legal_name          text NOT NULL,   -- razão social / nome civil
  trade_name          text,            -- nome fantasia

  document_type       text,
  document_number     text,
  -- Só dígitos. É sobre ESTA coluna que a unicidade é declarada, para que
  -- '12.345.678/0001-95' e '12345678000195' não virem duas empresas.
  document_normalized text GENERATED ALWAYS AS (
    CASE WHEN document_type IN ('cnpj', 'cpf')
         THEN regexp_replace(coalesce(document_number, ''), '\D', '', 'g')
         ELSE NULL END
  ) STORED,

  country_code        text NOT NULL DEFAULT 'BR',
  active              boolean NOT NULL DEFAULT true,
  notes               text,

  source_system       text NOT NULL DEFAULT 'manual',
  external_key        text,

  created_by          uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by          uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

-- Vocabulários fechados. Escritos por extenso pelo mesmo motivo da 101: uma
-- restrição que depende de função de usuário sobrevive mal a dump/restore.
ALTER TABLE public.parties DROP CONSTRAINT IF EXISTS parties_kind_check;
ALTER TABLE public.parties
  ADD CONSTRAINT parties_kind_check CHECK (kind IN ('organization', 'person'));

ALTER TABLE public.parties DROP CONSTRAINT IF EXISTS parties_document_type_check;
ALTER TABLE public.parties
  ADD CONSTRAINT parties_document_type_check
  CHECK (document_type IS NULL OR document_type IN ('cnpj', 'cpf', 'foreign'));

-- Tipo sem número é meia informação: o índice de identidade não enxergaria a
-- linha, e ninguém saberia que ela deveria ter documento.
ALTER TABLE public.parties DROP CONSTRAINT IF EXISTS parties_document_coherent;
ALTER TABLE public.parties
  ADD CONSTRAINT parties_document_coherent
  CHECK (document_type IS NULL OR document_number IS NOT NULL);

ALTER TABLE public.parties DROP CONSTRAINT IF EXISTS parties_cnpj_len;
ALTER TABLE public.parties
  ADD CONSTRAINT parties_cnpj_len
  CHECK (document_type IS DISTINCT FROM 'cnpj' OR length(document_normalized) = 14);

ALTER TABLE public.parties DROP CONSTRAINT IF EXISTS parties_cpf_len;
ALTER TABLE public.parties
  ADD CONSTRAINT parties_cpf_len
  CHECK (document_type IS DISTINCT FROM 'cpf' OR length(document_normalized) = 11);

-- Pessoa natural não tem CNPJ. O contrário não vale: MEI é 'organization' com
-- CNPJ, e existe empresa estrangeira sem nenhum dos dois.
ALTER TABLE public.parties DROP CONSTRAINT IF EXISTS parties_person_document;
ALTER TABLE public.parties
  ADD CONSTRAINT parties_person_document
  CHECK (kind <> 'person' OR document_type IS DISTINCT FROM 'cnpj');

-- A ÚNICA unicidade de identidade, e ela é parcial de propósito: cadastro
-- incompleto continua representável. Nunca há unicidade sobre legal_name, e
-- nunca há unicidade entre organizações.
CREATE UNIQUE INDEX IF NOT EXISTS uq_parties_org_document
  ON public.parties (organization_id, document_type, document_normalized)
  WHERE document_normalized IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_parties_org        ON public.parties (organization_id);
CREATE INDEX IF NOT EXISTS idx_parties_org_active ON public.parties (organization_id, active);
CREATE INDEX IF NOT EXISTS idx_parties_org_name   ON public.parties (organization_id, lower(legal_name));
CREATE INDEX IF NOT EXISTS idx_parties_external
  ON public.parties (organization_id, source_system, external_key)
  WHERE external_key IS NOT NULL;

-- Alvo da chave composta que dá coerência de inquilino a quem referencia party.
-- Redundante como unicidade (id já é chave primária) e proposital como ALVO:
-- sem ela, nenhuma tabela consegue declarar FK sobre (organization_id, id).
ALTER TABLE public.parties DROP CONSTRAINT IF EXISTS parties_org_id_unique;
ALTER TABLE public.parties ADD CONSTRAINT parties_org_id_unique UNIQUE (organization_id, id);

DROP TRIGGER IF EXISTS trg_parties_updated_at ON public.parties;
CREATE TRIGGER trg_parties_updated_at
  BEFORE UPDATE ON public.parties
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

COMMENT ON TABLE public.parties IS
  'Identidade canônica de contraparte no nível da plataforma. Identidade apenas: papel vive em party_roles, endereço e dados fiscais vivem nas extensões de domínio.';
COMMENT ON COLUMN public.parties.document_normalized IS
  'Documento só com dígitos, derivado. É sobre esta coluna que uq_parties_org_document é declarado — a única deduplicação determinística admitida.';
COMMENT ON COLUMN public.parties.legal_name IS
  'Razão social ou nome civil. NÃO é único e nunca será: duas pessoas jurídicas distintas podem usar o mesmo nome, e nome nunca prova identidade.';

-- ------------------------------------------------------------
-- 2) party_roles — papel, separado da identidade
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.party_roles (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  party_id        uuid NOT NULL,
  role            text NOT NULL,
  active          boolean NOT NULL DEFAULT true,
  created_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- Coerência de inquilino por ESTRUTURA, não por política. Verificação de chave
-- estrangeira no PostgreSQL não passa por RLS: sem a chave composta, uma
-- política bem escrita ainda deixaria gravar papel apontando para party de
-- outro inquilino.
ALTER TABLE public.party_roles DROP CONSTRAINT IF EXISTS party_roles_party_same_org;
ALTER TABLE public.party_roles
  ADD CONSTRAINT party_roles_party_same_org
  FOREIGN KEY (organization_id, party_id)
  REFERENCES public.parties (organization_id, id) ON DELETE CASCADE;

-- O mesmo papel duas vezes na mesma party não significa nada.
CREATE UNIQUE INDEX IF NOT EXISTS uq_party_roles_party_role
  ON public.party_roles (party_id, role);

CREATE INDEX IF NOT EXISTS idx_party_roles_org_role
  ON public.party_roles (organization_id, role) WHERE active;

DROP TRIGGER IF EXISTS trg_party_roles_updated_at ON public.party_roles;
CREATE TRIGGER trg_party_roles_updated_at
  BEFORE UPDATE ON public.party_roles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ------------------------------------------------------------
-- 3) Vocabulário de papéis — DOIS, e só os dois que têm lastro
-- ------------------------------------------------------------
--
-- Cada um se justifica por algo que já está no banco:
--   customer  → tabela `client`, projects.project->>'cliente'
--   supplier  → tabela `supplier`
--
-- Ficam de fora, deliberadamente, 'contractor' e 'contracting_authority'. Não
-- por serem raros: por serem de OUTRA NATUREZA. "Contratada" e "contratante"
-- descrevem a posição de uma party DENTRO DE UM CONTRATO ESPECÍFICO — a mesma
-- empresa é contratada num instrumento e contratante noutro, ao mesmo tempo.
-- Guardar isso aqui obrigaria a tabela a mentir: ela diria "esta empresa é
-- contratada" sem poder dizer de quê. Essa relação pertence à modelagem do
-- domínio de Contratos, numa fase posterior. `party_roles` é cadastro mestre, e
-- cadastro mestre só admite o que é verdade independentemente de contrato.
--
-- Também ficam de fora subcontratada, seguradora, banco e fiscalizadora:
-- nenhum tem hoje linha, tela ou regra que os exija. Ampliar depois é uma linha
-- nesta função, uma no CHECK e uma no TypeScript.

CREATE OR REPLACE FUNCTION public.party_role_vocabulary()
RETURNS text[]
LANGUAGE sql IMMUTABLE
AS $$ SELECT ARRAY[
  'customer',
  'supplier'
]::text[] $$;

COMMENT ON FUNCTION public.party_role_vocabulary() IS
  'Vocabulário canônico de party_roles.role. Espelha PARTY_ROLE_VOCABULARY em lib/parties/types.ts.';

-- Por extenso, e não como chamada à função acima, pelo motivo da 101: CHECK que
-- depende de função de usuário sobrevive mal a dump/restore e mudaria de
-- sentido em silêncio se alguém redefinisse a função sem revalidar as linhas.
ALTER TABLE public.party_roles DROP CONSTRAINT IF EXISTS party_roles_role_check;
ALTER TABLE public.party_roles
  ADD CONSTRAINT party_roles_role_check
  CHECK (role IN (
    'customer',
    'supplier'
  ));

-- Função e CHECK precisam dizer a mesma coisa. A 101 aprendeu isso primeiro.
DO $$
DECLARE
  drift text;
BEGIN
  SELECT string_agg(v, ', ') INTO drift
    FROM (
      SELECT unnest(public.party_role_vocabulary()) AS v
      EXCEPT
      SELECT regexp_matches[1]
        FROM regexp_matches(
               (SELECT pg_get_constraintdef(oid) FROM pg_constraint
                 WHERE conrelid = 'public.party_roles'::regclass
                   AND conname = 'party_roles_role_check'),
               '''([a-z_]+)''::text', 'g') AS regexp_matches
    ) missing;

  IF drift IS NOT NULL THEN
    RAISE EXCEPTION '[102] party_role_vocabulary() e party_roles_role_check divergem: % ausente(s) no CHECK.', drift;
  END IF;

  RAISE NOTICE '[102] Vocabulário de papéis e CHECK conferem (% valores).',
    array_length(public.party_role_vocabulary(), 1);
END $$;

COMMENT ON TABLE public.party_roles IS
  'Papel de uma party DENTRO DA ORGANIZAÇÃO — global ao inquilino, nunca relativo a um contrato. "Esta party é a contratada do contrato X" é relação do domínio de Contratos e NÃO pertence aqui.';
COMMENT ON COLUMN public.party_roles.role IS
  'Vocabulário fechado por party_roles_role_check — ver party_role_vocabulary().';

-- ------------------------------------------------------------
-- 4) RLS — quatro políticas discretas por tabela
-- ------------------------------------------------------------
--
-- Nunca FOR ALL, nunca USING (true). A 100 existe porque a 034 concedeu FOR ALL
-- a `contracts.edit` e com isso deu poder de APROVAÇÃO a quem só devia editar.
-- Política larga é barata de escrever e cara de descobrir.
--
-- A LARGURA DE LEITURA é proposital, e segue o princípio declarado na 099: o
-- defeito histórico foi o INQUILINO, não o público. Quem já enxerga contratos
-- ou finanças enxerga o cadastro de contrapartes — transformar isso numa
-- permissão nova seria mudar o produto com a desculpa de estar corrigindo
-- segurança. `parties.view` existe para um papel futuro que só mexa com
-- cadastro, sem ver contrato nem financeiro.
--
-- Todo WITH CHECK reafirma o inquilino, inclusive nos UPDATEs: sem isso, uma
-- linha visível poderia ser reescrita para dentro de outra organização.

ALTER TABLE public.parties     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.party_roles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS parties_select_scoped ON public.parties;
CREATE POLICY parties_select_scoped ON public.parties
  FOR SELECT TO authenticated
  USING (
    organization_id = public.current_user_organization_id()
    AND (
      public.current_user_is_admin()
      OR public.current_user_has_permission('parties.view')
      OR public.current_user_has_permission('contracts.view')
      OR public.current_user_has_permission('finance.view')
    )
  );

-- created_by = auth.uid() no WITH CHECK: quem cria assume a autoria da linha.
-- Deixar autoria livre no INSERT permitiria criar cadastro em nome de outro.
DROP POLICY IF EXISTS parties_insert_permissioned ON public.parties;
CREATE POLICY parties_insert_permissioned ON public.parties
  FOR INSERT TO authenticated
  WITH CHECK (
    organization_id = public.current_user_organization_id()
    AND created_by = auth.uid()
    AND (
      public.current_user_is_admin()
      OR public.current_user_has_permission('parties.create')
      OR public.current_user_has_permission('contracts.create')
    )
  );

DROP POLICY IF EXISTS parties_update_permissioned ON public.parties;
CREATE POLICY parties_update_permissioned ON public.parties
  FOR UPDATE TO authenticated
  USING (
    organization_id = public.current_user_organization_id()
    AND (public.current_user_is_admin() OR public.current_user_has_permission('parties.edit'))
  )
  WITH CHECK (
    organization_id = public.current_user_organization_id()
    AND (public.current_user_is_admin() OR public.current_user_has_permission('parties.edit'))
  );

DROP POLICY IF EXISTS parties_delete_permissioned ON public.parties;
CREATE POLICY parties_delete_permissioned ON public.parties
  FOR DELETE TO authenticated
  USING (
    organization_id = public.current_user_organization_id()
    AND (public.current_user_is_admin() OR public.current_user_has_permission('parties.delete'))
  );

-- party_roles: enxergar o papel exige enxergar a party. O EXISTS não é
-- redundante com o filtro de organização — ele impede que um papel órfão de
-- leitura (party invisível por qualquer motivo) vaze a existência da identidade.
DROP POLICY IF EXISTS party_roles_select_scoped ON public.party_roles;
CREATE POLICY party_roles_select_scoped ON public.party_roles
  FOR SELECT TO authenticated
  USING (
    organization_id = public.current_user_organization_id()
    AND EXISTS (
      SELECT 1 FROM public.parties p
       WHERE p.id = party_roles.party_id
         AND p.organization_id = public.current_user_organization_id()
    )
    AND (
      public.current_user_is_admin()
      OR public.current_user_has_permission('parties.view')
      OR public.current_user_has_permission('contracts.view')
      OR public.current_user_has_permission('finance.view')
    )
  );

DROP POLICY IF EXISTS party_roles_insert_permissioned ON public.party_roles;
CREATE POLICY party_roles_insert_permissioned ON public.party_roles
  FOR INSERT TO authenticated
  WITH CHECK (
    organization_id = public.current_user_organization_id()
    AND created_by = auth.uid()
    AND (
      public.current_user_is_admin()
      OR public.current_user_has_permission('parties.edit')
      OR public.current_user_has_permission('parties.create')
    )
  );

DROP POLICY IF EXISTS party_roles_update_permissioned ON public.party_roles;
CREATE POLICY party_roles_update_permissioned ON public.party_roles
  FOR UPDATE TO authenticated
  USING (
    organization_id = public.current_user_organization_id()
    AND (public.current_user_is_admin() OR public.current_user_has_permission('parties.edit'))
  )
  WITH CHECK (
    organization_id = public.current_user_organization_id()
    AND (public.current_user_is_admin() OR public.current_user_has_permission('parties.edit'))
  );

-- Apagar um papel é EDITAR a party, não apagá-la: a identidade continua ali,
-- só deixou de ser fornecedora. Por isso DELETE aqui pede `parties.edit` e não
-- `parties.delete` — exigir a permissão de destruição para uma correção de
-- cadastro empurraria o trabalho rotineiro para o owner_admin.
DROP POLICY IF EXISTS party_roles_delete_permissioned ON public.party_roles;
CREATE POLICY party_roles_delete_permissioned ON public.party_roles
  FOR DELETE TO authenticated
  USING (
    organization_id = public.current_user_organization_id()
    AND (public.current_user_is_admin() OR public.current_user_has_permission('parties.edit'))
  );

-- ------------------------------------------------------------
-- 5) Verificação — a Fase 1 não inventa identidade
-- ------------------------------------------------------------
--
-- Não é decoração. Se alguém acrescentar um backfill acima desta linha — por
-- exemplo derivando parties de counterparty_name, que é exatamente a tentação
-- de 'ENEL' e 'ENEL GREEN POWER' — a migration falha inteira e nada é gravado.

DO $$
DECLARE
  n_parties integer;
  n_roles   integer;
BEGIN
  SELECT count(*) INTO n_parties FROM public.parties;
  SELECT count(*) INTO n_roles   FROM public.party_roles;

  IF n_parties <> 0 OR n_roles <> 0 THEN
    RAISE EXCEPTION
      E'[102] Esta migration não pode criar identidade: parties=%, party_roles=%.\n'
      '       Se estes números não são zero, alguém fez backfill — e derivar contraparte a partir\n'
      '       de nome livre é exatamente o que esta fase proíbe. Nada foi gravado.',
      n_parties, n_roles;
  END IF;

  RAISE NOTICE '[102] parties e party_roles criadas vazias, como devem nascer.';
END $$;

COMMIT;
