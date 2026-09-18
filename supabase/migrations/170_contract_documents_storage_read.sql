-- 170 — O PDF original volta a ser legível pelo navegador
--
-- O DEFEITO
--
-- "Abrir contrato" / "Abrir arquivo original" falhava com
-- `Erro ao abrir o documento: Object not found`. O objeto EXISTE: o que não
-- existia era permissão de leitura sobre ele.
--
-- `contract_files_storage_read` (migration 006) autoriza SELECT em
-- `storage.objects` do bucket `contract-files` apenas quando o caminho aparece
-- em `public.contract_files` — a tabela LEGADA de anexos. Desde a migration
-- 034 o repositório documental do contrato é `public.contract_documents`, e
-- desde a 166 é lá que o PDF ORIGINAL do fluxo documento-primeiro é gravado
-- (`document_type='contract'`, o mesmo `file_path` e o mesmo `content_sha256`
-- do intake). Nenhuma migration jamais ensinou a política de leitura sobre
-- essa tabela.
--
-- O Storage do Supabase responde 404 — e não 403 — a um objeto que a RLS
-- esconde. Por isso o sintoma se disfarçava de arquivo ausente, e por isso
-- TODO documento gravado em `contract_documents` — o contrato original, os
-- aditivos, as notas, as garantias — estava inalcançável a partir da
-- interface, ainda que a análise assistida (que roda com service_role, sem
-- passar pela política) o lesse sem dificuldade.
--
-- O QUE MUDA
--
-- A política de leitura ganha um segundo braço para `contract_documents`, com
-- EXATAMENTE o mesmo predicado de autorização do braço legado: mesma
-- organização e `current_user_can_read_contract(contract_id)`. Nada é
-- afrouxado — quem não pode ler o contrato continua não podendo ler o papel
-- dele; quem pode, passa a poder. A escrita e a exclusão não são tocadas.
--
-- Nenhum arquivo é movido, copiado ou reenviado: a proveniência (caminho,
-- SHA256, versão, linhagem de substituição) permanece exatamente como está.
BEGIN;

-- A política avalia `file_path = storage.objects.name` a cada objeto lido.
-- Sem índice isso é varredura sequencial no repositório documental inteiro.
CREATE INDEX IF NOT EXISTS idx_contract_documents_org_file_path
  ON public.contract_documents(organization_id, file_path);

DROP POLICY IF EXISTS contract_files_storage_read ON storage.objects;
CREATE POLICY contract_files_storage_read
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'contract-files'
  AND (
    -- Anexos legados (`contract_files`) — o braço original da 006, intacto.
    EXISTS (
      SELECT 1
      FROM public.contract_files cf
      WHERE cf.file_path = storage.objects.name
        AND cf.organization_id = current_user_organization_id()
        AND current_user_can_read_contract(cf.contract_id)
    )
    -- Repositório documental (`contract_documents`) — o contrato original
    -- entre eles. Mesmo predicado, mesma fronteira de tenant.
    OR EXISTS (
      SELECT 1
      FROM public.contract_documents cd
      WHERE cd.file_path = storage.objects.name
        AND cd.organization_id = current_user_organization_id()
        AND current_user_can_read_contract(cd.contract_id)
    )
  )
);

COMMIT;

-- ============================================================
-- VERIFICAÇÃO MANUAL (não roda automaticamente)
-- ============================================================
-- Como o usuário dono do contrato, no navegador:
--   1. Contratos → Acervo documental → escolher o PDF do contrato →
--      "Abrir contrato" deve abrir o PDF em nova aba.
--   2. Contratos → dossiê → Documentos → "Ver documento e proveniência" →
--      "Abrir arquivo original" deve abrir o MESMO arquivo.
--
-- Como um usuário de OUTRA organização, com o mesmo `file_path`:
--   SELECT storage.filename(name) FROM storage.objects
--    WHERE bucket_id='contract-files' AND name='<caminho>';
--   -- deve devolver 0 linhas, e a URL assinada deve continuar falhando.
