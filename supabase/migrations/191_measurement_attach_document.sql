-- ============================================================================
-- 191 — ANEXAR DOCUMENTO À MEDIÇÃO, PELA PORTA CERTA
--
-- ─── O que a verificação de ponta a ponta encontrou ───────────────────────
--
-- `project_measurement_link_evidence` (131) está REVOKEd de `authenticated`, e
-- o comentário dela diz por quê, com todas as letras: "o navegador não
-- alcança". A função valida inquilino, projeto e validade da origem — mas NÃO
-- verifica permissão nenhuma, porque foi desenhada para ser chamada por rota
-- de servidor que já autorizou o pedido.
--
-- A aba Medições & Evidências precisa anexar evidência a partir do navegador.
-- Havia dois caminhos errados e um certo:
--
--   ERRADO  conceder EXECUTE na função de 131. Ela não tem portão de
--           permissão; qualquer pessoa do inquilino passaria a vincular
--           evidência, inclusive quem não pode editar medição.
--   ERRADO  deixar o cliente chamando e falhando com "permission denied" —
--           que é o estado que esta migration corrige.
--   CERTO   uma porta ESTREITA, com portão próprio, que delega à função de
--           131 sem afrouxá-la.
--
-- ─── Por que a porta é estreita ───────────────────────────────────────────
--
-- Ela aceita UM tipo de origem (`project_file`), UMA classe (`RAW_EVIDENCE`) e
-- UMA procedência de vínculo (`manual`). Nenhum dos três é parâmetro.
--
-- Uma função genérica exposta ao navegador devolveria, por outro nome, tudo o
-- que a 131 fechou: vincular `contract_document` de outro contrato, declarar
-- `VALIDATED_EVIDENCE` sem ninguém validar, ou carimbar `deterministic` num
-- palpite. O que o navegador precisa fazer é uma coisa só — "esta pessoa
-- anexou este PDF a esta medição" — e é só isso que esta função permite.
--
-- ─── O que ela NÃO faz ────────────────────────────────────────────────────
--
--   · Não valida a evidência. Entra BRUTA e NÃO VALIDADA; validar é ato de
--     quem revisa, e nenhum upload se autovalida.
--   · Não mede, não aceita, não torna elegível, não fatura.
--   · Não cria documento. O documento já existe em `project_files`, e é o
--     MESMO que a aba Documentos lista.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.project_measurement_attach_document(
  p_measurement_id   uuid,
  p_document_id      uuid,
  p_requirement_kind text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  actor uuid := auth.uid();
  m_org uuid;
  d_org uuid;
BEGIN
  IF actor IS NULL THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: anexar evidência exige uma pessoa autenticada.'
      USING ERRCODE = '42501';
  END IF;

  /*
    O PORTÃO que a função de 131 não tem.

    `projects.measurements.edit` é a mesma chave que governa preparar e
    submeter a medição: quem não pode mexer no pacote não passa a poder por
    ter um arquivo na mão.
  */
  IF NOT (public.current_user_has_permission('projects.measurements.edit')
          OR public.current_user_is_admin()) THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: falta a permissão projects.measurements.edit.'
      USING ERRCODE = '42501';
  END IF;

  SELECT organization_id INTO m_org
    FROM public.project_measurements WHERE id = p_measurement_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'MEASUREMENT_NOT_FOUND: medição inexistente.' USING ERRCODE = 'no_data_found';
  END IF;

  SELECT organization_id INTO d_org
    FROM public.project_files WHERE id = p_document_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'SOURCE_NOT_FOUND: documento inexistente.' USING ERRCODE = 'no_data_found';
  END IF;

  /*
    Três inquilinos precisam ser o MESMO: o da medição, o do documento e o de
    quem chama. `SECURITY DEFINER` suspende a RLS, então a fronteira que a
    política faria sozinha precisa ser escrita aqui — e a mesma mensagem serve
    para "de outro inquilino" e "inexistente", porque duas mensagens
    diferentes responderiam se aquele UUID existe noutra organização.
  */
  IF m_org IS DISTINCT FROM public.current_user_organization_id()
     OR d_org IS DISTINCT FROM m_org THEN
    RAISE EXCEPTION 'MEASUREMENT_NOT_FOUND: medição inexistente.' USING ERRCODE = 'no_data_found';
  END IF;

  -- A delegação. Tipo, classe e procedência são LITERAIS: o chamador não
  -- escolhe nenhum dos três, e por isso esta porta não reabre o que a 131
  -- fechou. `p_linked_by` fica nulo — a 131 lê `auth.uid()` por conta própria.
  RETURN public.project_measurement_link_evidence(
    p_measurement_id,
    'project_file',
    p_document_id,
    'RAW_EVIDENCE',
    'manual',
    NULL,
    p_requirement_kind,
    jsonb_build_object('source', 'project_measurements_evidence_workspace',
                       'document_id', p_document_id),
    NULL,
    NULL);
END $$;

REVOKE ALL ON FUNCTION public.project_measurement_attach_document(uuid, uuid, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.project_measurement_attach_document(uuid, uuid, text)
  TO authenticated;

COMMENT ON FUNCTION public.project_measurement_attach_document(uuid, uuid, text) IS
  'A porta ESTREITA do navegador para anexar evidência: só origem '
  'project_file, só RAW_EVIDENCE, só link_source manual, e só com '
  'projects.measurements.edit. Delega a project_measurement_link_evidence sem '
  'afrouxá-la. Não valida, não mede, não aceita e não fatura.';

COMMIT;
