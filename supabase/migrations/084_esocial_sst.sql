-- ============================================================
-- INSIGHT eSOCIAL — SST (Saúde e Segurança do Trabalho)
-- Migration: 084_esocial_sst
--
-- Três eventos que já chegavam no pacote do eSocial Download e eram guardados
-- apenas como XML bruto, sem virar indicador em lugar nenhum:
--
--   S-2210  CAT — Comunicação de Acidente de Trabalho
--   S-2220  Monitoramento da saúde do trabalhador (ASO)
--   S-2240  Condições ambientais — agentes nocivos
--
-- Uma linha por evento, e não um agregado por competência: ao contrário da
-- folha, o que se pergunta aqui é sobre o INDIVÍDUO ("quem está sem ASO
-- válido", "quais acidentes afastaram") e sobre o evento ("qual agente, em que
-- ambiente"). Agregar destruiria exatamente a pergunta.
--
-- VALIDADE DO ASO — a coluna que exige leitura atenta:
--   O leiaute do S-2220 NÃO declara vencimento. `aso_valid_until` só é
--   preenchida quando o tipo de exame permite apurar periodicidade (hoje,
--   apenas o periódico, pela NR-7 anual). NULL aqui significa "não apurável",
--   e NÃO "sem vencimento" nem "em dia" — a interface é obrigada a mostrar
--   esses casos num balde próprio. A regra vive em
--   src/lib/esocial/connector/sst.ts, exportada e comentada.
--
-- Segurança: CPF nunca em claro (hash + máscara, como no resto do módulo).
-- Escrita exclusiva pelo service role (reapuração); leitura por permissão.
-- ============================================================
BEGIN;

CREATE TABLE IF NOT EXISTS public.esocial_sst_events (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id    uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  -- Casa com esocial_events.esocial_event_id — o XML de origem continua lá.
  esocial_event_id   text NOT NULL,
  event_type         text NOT NULL CHECK (event_type IN ('S-2210', 'S-2220', 'S-2240')),
  -- Competência do FATO (acidente, exame, início da exposição), não de apuração:
  -- estes eventos não têm perApur.
  competence         text,                    -- YYYY-MM
  event_date         date,

  -- Trabalhador
  worker_cpf_hash    text,
  worker_cpf_mask    text,
  worker_name        text,
  matricula          text,
  -- Lotação herdada do S-1200 do próprio trabalhador: o evento de SST não
  -- declara codLotacao, e sem a herança todo acidente cairia em "sem lotação".
  area_code          text,
  area_label         text,

  -- ── CAT (S-2210) ──
  cat_type           text,                    -- tpCat: 1 inicial, 2 reabertura, 3 óbito
  accident_kind      text,                    -- tpAcid
  local_kind         text,                    -- tpLocal
  situation_code     text,                    -- codSitGeradora
  initiator          text,                    -- iniciatCAT: espontânea x imposta
  -- NULL = o evento não declarou. Distinto de false, que é "não afastou".
  caused_leave       boolean,
  death_date         date,
  body_part_code     text,                    -- codParteAting
  causing_agent_code text,                    -- codAgntCausador

  -- ── ASO (S-2220) ──
  exam_kind          text,                    -- tpExameOcup
  exam_result        text,                    -- resAso: 1 apto, 2 inapto
  -- NULL = periodicidade não apurável para este tipo de exame. Ver cabeçalho.
  aso_valid_until    date,
  aso_period_months  smallint,
  exams              jsonb NOT NULL DEFAULT '[]'::jsonb,

  -- ── Exposição a agentes nocivos (S-2240) ──
  exposure_start     date,
  exposure_end       date,
  environment_code   text,                    -- codAmb
  -- EPC/EPI ficam DENTRO de cada agente, e não no evento: o grupo epcEpi é
  -- filho de agNoc no leiaute. Um S-2240 com ruído protegido por EPI e calor
  -- sem proteção precisa dizer as duas coisas, e não uma média delas.
  agents             jsonb NOT NULL DEFAULT '[]'::jsonb,

  metadata           jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at         timestamptz NOT NULL DEFAULT now(),

  -- A retificação reenvia o mesmo Id de evento: a linha é substituída, não
  -- duplicada. É o que mantém a contagem de CATs igual à realidade depois de
  -- uma correção.
  UNIQUE (organization_id, esocial_event_id)
);

CREATE INDEX IF NOT EXISTS esocial_sst_events_type_comp_idx
  ON public.esocial_sst_events (organization_id, event_type, competence);

CREATE INDEX IF NOT EXISTS esocial_sst_events_worker_idx
  ON public.esocial_sst_events (organization_id, worker_cpf_hash);

-- Índice parcial: a consulta de vencimento só interessa onde há vencimento
-- apurado, e os NULL são justamente o balde que se conta à parte.
CREATE INDEX IF NOT EXISTS esocial_sst_events_aso_due_idx
  ON public.esocial_sst_events (organization_id, aso_valid_until)
  WHERE aso_valid_until IS NOT NULL;

ALTER TABLE public.esocial_sst_events ENABLE ROW LEVEL SECURITY;

-- Leitura restrita a DADO SENSÍVEL, e não a `people.view`.
--
-- Esta tabela guarda saúde ocupacional por trabalhador — resultado de exame,
-- parte do corpo atingida, agente causador do acidente. É a mesma natureza de
-- dado que faz `esocial_events` exigir `people.payroll_view_sensitive` em 080,
-- e não a das tabelas de agregado, que são anônimas por construção.
--
-- A seção SST não perde nada com isso: quem a serve é a rota, com service
-- role, atrás de `people.view` — e é lá que os nomes são suprimidos para quem
-- não tem `people.view_sensitive_data`. Nenhuma tela lê esta tabela direto.
DROP POLICY IF EXISTS esocial_sst_events_read ON public.esocial_sst_events;
CREATE POLICY esocial_sst_events_read ON public.esocial_sst_events
FOR SELECT TO authenticated
USING (
  organization_id = current_user_organization_id()
  AND (
    current_user_is_admin()
    OR current_user_has_permission('people.payroll_view_sensitive')
    OR current_user_has_permission('people.view_sensitive_data')
  )
);

COMMENT ON TABLE public.esocial_sst_events IS
  'Eventos de SST do eSocial (S-2210 CAT, S-2220 ASO, S-2240 agentes nocivos), uma linha por evento. Reconstruída inteiramente a cada reapuração.';
COMMENT ON COLUMN public.esocial_sst_events.aso_valid_until IS
  'Vencimento apurado do ASO. NULL = periodicidade não apurável para o tipo de exame — nunca interpretar como "em dia" nem como "vencido".';
COMMENT ON COLUMN public.esocial_sst_events.caused_leave IS
  'indAfast do atestado da CAT. NULL = não declarado, distinto de false (não afastou).';

COMMIT;
