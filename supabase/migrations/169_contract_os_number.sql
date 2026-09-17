-- ============================================================================
-- 169 — Número da OS, separado do número do contrato
--
-- `contract_number` é o número OFICIAL do contrato — o que o Apex já extrai
-- do PDF assinado, quando há um. A Ordem de Serviço é outra coisa: um número
-- interno, atribuído DEPOIS, pela operação, para acompanhar a execução — e os
-- dois frequentemente divergem (o mesmo contrato pode abrir mais de uma OS ao
-- longo da vigência; a numeração de OS é da empresa, não da contraparte).
--
-- Confundir os dois num campo só, como a tela de edição fazia até aqui,
-- forçava a escolha de qual dos dois sobrescrever. Esta migration dá à OS sua
-- própria coluna, e a tela de edição passa a ter dois campos independentes.
--
-- Estritamente aditiva: uma coluna nova, nullable, sem default e sem
-- constraint — nenhuma política de RLS muda (a de 006 já governa UPDATE em
-- `contracts` por `contracts.edit`).
-- ============================================================================

ALTER TABLE public.contracts
  ADD COLUMN IF NOT EXISTS os_number text;

COMMENT ON COLUMN public.contracts.os_number IS
  'Número interno da Ordem de Serviço, atribuído pela operação após a criação do contrato. Independente de contract_number (o número oficial do contrato, geralmente extraído do PDF).';
