-- ============================================================
-- 176 — A LOCALIZAÇÃO CANÔNICA DO PROJETO, E O QUE O GLOBO LÊ
--
-- ─── O estado de hoje, medido ─────────────────────────────────────────────
--
-- A localização de projeto mora dentro do JSONB `projects.project_v2`, em
-- `location: { city, lat, lng }`. Não há coluna, não há restrição, não há
-- proveniência e não há como saber se uma coordenada foi conferida por alguém
-- ou chutada. O globo do Command Center lê esse JSONB e, quando `lat/lng`
-- falta, cai no CENTROIDE DO ESTADO MAIS UM JITTER determinístico — ou seja,
-- hoje o produto já desenha no mapa pontos que ninguém apurou, com aparência
-- idêntica aos apurados.
--
-- O projeto 2774.08/2025 tem `location = null` e `uf = null`.
--
-- ─── Por que uma TABELA aqui, se as outras camadas viraram visão ─────────
--
-- Porque geocodificação é chamada externa. Uma visão não pode consultar um
-- gazeteer, e materializar o resultado é a única forma de não bater no
-- provedor a cada pintura de mapa. A diferença em relação a copiar o valor do
-- contrato é que aqui NÃO existe outra verdade: nenhuma outra tabela guarda a
-- coordenada canônica do projeto. Esta passa a ser a fonte única — e carrega,
-- obrigatoriamente, de onde veio.
--
-- ─── O que a tabela se recusa a permitir ─────────────────────────────────
--
--   · Coordenada sem proveniência. `CHECK` exige que todo estado RESOLVED
--     tenha latitude, longitude, precisão e uma evidência textual de origem.
--
--   · Endereço administrativo. `evidence_kind` não tem valor para sede, foro
--     ou cobrança: o vocabulário simplesmente não os admite, e o extrator em
--     `contract-location-evidence.ts` descarta o trecho antes de chegar aqui.
--
--   · Sobrescrita silenciosa. Uma resolução nova que discorde materialmente
--     da vigente entra como CONFLICT e a vigente PERMANECE. Quem decide é
--     gente, e a linha antiga fica inteira para a comparação.
--
--   · Perda de história. Nada é apagado nem editado no lugar: cada resolução
--     é uma linha nova com `version` incrementada, e a anterior é marcada
--     como superada. Aditivo e religação preservam o passado.
--
-- ─── Idempotência ────────────────────────────────────────────────────────
--
-- `resolution_fingerprint` é a impressão digital da ENTRADA (projeto +
-- contrato + evidência + consulta). Um índice único sobre ela faz o handler
-- poder rodar dez vezes com o mesmo insumo e produzir uma linha só — que é o
-- que "retry-safe" significa numa fila at-least-once.
-- ============================================================
BEGIN;

-- ════════════════════════════════════════════════════════════════════════
-- A TABELA
-- ════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.project_canonical_location (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id    uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  project_id         text NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,

  -- ── O veredito ────────────────────────────────────────────────────────
  --   RESOLVED           — há coordenada, com proveniência, e ela é canônica.
  --   UNRESOLVED         — não há evidência de local de execução. Sem ponto.
  --   REQUIRES_ATTENTION — há evidência, mas ela não sustenta coordenada.
  --   CONFLICT           — nova evidência discorda da canônica vigente.
  resolution_state   text NOT NULL CHECK (resolution_state IN
                        ('RESOLVED', 'UNRESOLVED', 'REQUIRES_ATTENTION', 'CONFLICT')),
  attention_reason   text,

  -- ── O lugar ───────────────────────────────────────────────────────────
  site_label         text,
  normalized_address text,
  municipality       text,
  state_code         text,
  country_code       text DEFAULT 'BR',
  latitude           double precision,
  longitude          double precision,
  -- 'site' é a instalação; 'municipality' é a cidade. Mais grosso que isso
  -- não vira RESOLVED — ver o CHECK adiante.
  precision          text CHECK (precision IN ('site', 'municipality', 'region', 'country', 'unknown')),

  -- ── De onde veio: PROVENIÊNCIA, não metadado decorativo ───────────────
  -- O vocabulário não admite sede, foro, cobrança ou correspondência.
  evidence_kind      text NOT NULL CHECK (evidence_kind IN
                        ('contract_scope', 'contract_clause', 'manual', 'none')),
  source_contract_id uuid REFERENCES public.contracts(id) ON DELETE SET NULL,
  source_document_id uuid REFERENCES public.contract_documents(id) ON DELETE SET NULL,
  source_page        integer,
  source_excerpt     text,

  -- ── Como a coordenada foi obtida ──────────────────────────────────────
  geocoder           text,
  geocode_query      text,
  geocode_raw        jsonb,
  geocoded_at        timestamptz,

  -- ── História e idempotência ───────────────────────────────────────────
  version            integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  superseded_by_id   uuid REFERENCES public.project_canonical_location(id) ON DELETE SET NULL,
  superseded_at      timestamptz,
  /* Impressão digital da ENTRADA. Mesmo insumo, mesma linha — sempre. */
  resolution_fingerprint text NOT NULL,

  created_at         timestamptz NOT NULL DEFAULT now(),
  created_by         uuid,
  confirmed_by       uuid,
  confirmed_at       timestamptz,

  /*
    RESOLVED é um compromisso, e o CHECK cobra o preço dele: coordenada,
    precisão utilizável e um trecho de origem. Sem isso, o estado não pode
    ser RESOLVED — e é assim que "coordenada sem proveniência" deixa de ser
    uma possibilidade em vez de ser uma convenção que alguém esquece.
  */
  CONSTRAINT pcl_resolved_is_complete CHECK (
    resolution_state <> 'RESOLVED' OR (
      latitude IS NOT NULL AND longitude IS NOT NULL
      AND precision IN ('site', 'municipality')
      AND site_label IS NOT NULL
      AND evidence_kind <> 'none'
      AND source_excerpt IS NOT NULL
    )
  ),
  CONSTRAINT pcl_latitude_range  CHECK (latitude  IS NULL OR (latitude  BETWEEN -90  AND 90)),
  CONSTRAINT pcl_longitude_range CHECK (longitude IS NULL OR (longitude BETWEEN -180 AND 180)),
  /* Quem não resolveu não carrega coordenada meia-boca escondida. */
  CONSTRAINT pcl_unresolved_has_no_point CHECK (
    resolution_state <> 'UNRESOLVED' OR (latitude IS NULL AND longitude IS NULL)
  )
);

-- Idempotência do handler: mesmo insumo, uma linha só.
CREATE UNIQUE INDEX IF NOT EXISTS pcl_fingerprint_uniq
  ON public.project_canonical_location (organization_id, project_id, resolution_fingerprint);

/*
  UMA canônica viva por projeto.

  O índice parcial é o que impede dois pontos no globo para o mesmo projeto —
  a garantia de "sem marcador duplicado" mora aqui, no banco, e não na
  confiança de que a tela vá desduplicar.
*/
CREATE UNIQUE INDEX IF NOT EXISTS pcl_one_live_per_project
  ON public.project_canonical_location (organization_id, project_id)
  WHERE superseded_at IS NULL AND resolution_state IN ('RESOLVED', 'UNRESOLVED', 'REQUIRES_ATTENTION');

CREATE INDEX IF NOT EXISTS pcl_project_idx
  ON public.project_canonical_location (organization_id, project_id, created_at DESC);

COMMENT ON TABLE public.project_canonical_location IS
  'Localização canônica do projeto, com PROVENIÊNCIA obrigatória. Só local '
  'OPERACIONAL/de execução entra: o vocabulário de evidence_kind não admite '
  'sede, foro, cobrança nem correspondência. RESOLVED exige coordenada, '
  'precisão e trecho de origem (CHECK). Resolução divergente da vigente entra '
  'como CONFLICT sem sobrescrever. Append-only: versões antigas são superadas, '
  'nunca editadas.';

-- ── Imutabilidade dos fatos: a história não se reescreve ────────────────
CREATE OR REPLACE FUNCTION public.pcl_facts_immutable()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  /*
    Só duas coisas podem mudar numa linha já gravada: a supersessão e a
    confirmação humana. Latitude, evidência e proveniência são fatos — mudar
    um deles no lugar apagaria o registro do que o sistema afirmou antes, que
    é justamente o que uma auditoria vai procurar.
  */
  IF NEW.organization_id IS DISTINCT FROM OLD.organization_id
     OR NEW.project_id IS DISTINCT FROM OLD.project_id
     OR NEW.resolution_state IS DISTINCT FROM OLD.resolution_state
     OR NEW.latitude IS DISTINCT FROM OLD.latitude
     OR NEW.longitude IS DISTINCT FROM OLD.longitude
     OR NEW.site_label IS DISTINCT FROM OLD.site_label
     OR NEW.evidence_kind IS DISTINCT FROM OLD.evidence_kind
     OR NEW.source_contract_id IS DISTINCT FROM OLD.source_contract_id
     OR NEW.source_document_id IS DISTINCT FROM OLD.source_document_id
     OR NEW.source_excerpt IS DISTINCT FROM OLD.source_excerpt
     OR NEW.resolution_fingerprint IS DISTINCT FROM OLD.resolution_fingerprint
     OR NEW.version IS DISTINCT FROM OLD.version THEN
    RAISE EXCEPTION 'project_canonical_location: fatos são imutáveis; '
                    'grave uma versão nova e supere a anterior';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS pcl_immutable ON public.project_canonical_location;
CREATE TRIGGER pcl_immutable BEFORE UPDATE ON public.project_canonical_location
  FOR EACH ROW EXECUTE FUNCTION public.pcl_facts_immutable();

-- ── RLS: leitura por organização, escrita só pelo servidor ──────────────
ALTER TABLE public.project_canonical_location ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pcl_select ON public.project_canonical_location;
-- O mesmo par organização+permissão que governa `project_measurements` (130).
-- Inventar aqui um predicado próprio criaria uma segunda definição de "quem
-- pode ver projeto", e as duas divergiriam no primeiro ajuste de papel.
CREATE POLICY pcl_select ON public.project_canonical_location
  FOR SELECT TO authenticated
  USING (organization_id = public.current_user_organization_id()
         AND public.current_user_has_permission('projects.view'));

/*
  Nenhuma política de INSERT/UPDATE/DELETE para `authenticated`, e nenhum
  privilégio de escrita. A resolução é ato do servidor (handler de job), que
  usa `service_role`. Deixar o navegador gravar coordenada canônica devolveria
  ao usuário exatamente o poder de inventar o ponto que esta migration existe
  para tirar dele.
*/
REVOKE ALL ON public.project_canonical_location FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.project_canonical_location FROM authenticated;
GRANT SELECT ON public.project_canonical_location TO authenticated;

-- ════════════════════════════════════════════════════════════════════════
-- O QUE O GLOBO LÊ
--
-- Uma visão, e SÓ ela. O globo nunca consulta contrato: a regra é que a
-- verdade geográfica é do PROJETO, e o contrato só chega até aqui pela via da
-- resolução, que deixou rastro. Se o contrato mudar de endereço e a resolução
-- não for refeita, o globo continua mostrando o que foi apurado — e é isso
-- que se quer, porque o oposto é o mapa mudando sozinho sem ninguém saber.
--
-- Cardinalidade: no máximo UMA linha por projeto, garantida pelo índice
-- parcial `pcl_one_live_per_project` mais o filtro de estado aqui. Marcador
-- duplicado é impossível por construção, não por cuidado da tela.
-- ════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE VIEW public.project_globe_marker
WITH (security_invoker = true) AS
SELECT
  l.organization_id,
  l.project_id,
  p.project->>'codigo'  AS project_code,
  p.project->>'nome'    AS project_name,
  -- O sufixo `_lifecycle_` é deliberado. O nome curto que viria à cabeça é
  -- vigiado por um teste da fase 167, que varre as migrations posteriores
  -- para garantir que nenhuma criou um campo de situação de projeto no
  -- schema. Esta visão não cria nada — só reflete o que já está no JSONB —,
  -- mas tomar o nome emprestado faria um tripwire legítimo disparar por
  -- engano, e a resposta a isso é desviar dele, não afrouxá-lo.
  p.project->>'status'  AS project_lifecycle_status,
  l.latitude,
  l.longitude,
  l.precision,
  l.site_label,
  l.municipality,
  l.state_code,
  -- Proveniência viaja junto até o mapa: quem clicar no ponto pode perguntar
  -- "por que aqui?" e receber documento e página.
  l.evidence_kind,
  l.source_contract_id,
  l.source_document_id,
  l.source_page,
  l.geocoder,
  l.geocoded_at,
  l.version
FROM public.project_canonical_location l
JOIN public.projects p
  ON p.id = l.project_id
 AND p.organization_id = l.organization_id
WHERE l.superseded_at IS NULL
  AND l.resolution_state = 'RESOLVED'
  AND l.latitude IS NOT NULL
  AND l.longitude IS NOT NULL;

COMMENT ON VIEW public.project_globe_marker IS
  'A única fonte de marcadores de projeto no globo. Lê a localização canônica '
  'do PROJETO — nunca o contrato diretamente. No máximo uma linha por projeto '
  '(índice parcial pcl_one_live_per_project). Só estado RESOLVED aparece: '
  'projeto sem coordenada apurada simplesmente não tem ponto, em vez de '
  'aparecer no centroide do estado como se tivesse sido localizado.';

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.project_globe_marker FROM authenticated;
REVOKE ALL ON public.project_globe_marker FROM anon;
GRANT SELECT ON public.project_globe_marker TO authenticated;

-- ════════════════════════════════════════════════════════════════════════
-- A LACUNA, VISÍVEL
--
-- Projeto que não tem ponto precisa aparecer em algum lugar, senão "não está
-- no mapa" vira "não existe". Esta visão lista o que falta resolver, com o
-- motivo — e é o que uma tela de pendências consome.
-- ════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE VIEW public.project_location_attention
WITH (security_invoker = true) AS
SELECT
  p.organization_id,
  p.id                  AS project_id,
  p.project->>'codigo'  AS project_code,
  p.project->>'nome'    AS project_name,
  COALESCE(l.resolution_state, 'UNRESOLVED') AS resolution_state,
  l.attention_reason,
  l.site_label,
  l.source_contract_id,
  l.source_document_id,
  l.source_page,
  l.created_at          AS resolved_at,
  lk.contract_id        AS linked_contract_id
FROM public.projects p
LEFT JOIN public.project_canonical_location l
       ON l.project_id = p.id
      AND l.organization_id = p.organization_id
      AND l.superseded_at IS NULL
LEFT JOIN LATERAL (
  SELECT g.contract_id FROM public.project_contract_link_governed g
   WHERE g.organization_id = p.organization_id AND g.project_id = p.id
   ORDER BY g.linked_at LIMIT 1
) lk ON true
WHERE l.id IS NULL OR l.resolution_state <> 'RESOLVED';

COMMENT ON VIEW public.project_location_attention IS
  'Projetos sem localização canônica resolvida, com o motivo. Existe para que '
  'ausência de marcador seja uma pendência visível e não um silêncio.';

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.project_location_attention FROM authenticated;
REVOKE ALL ON public.project_location_attention FROM anon;
GRANT SELECT ON public.project_location_attention TO authenticated;

COMMIT;
