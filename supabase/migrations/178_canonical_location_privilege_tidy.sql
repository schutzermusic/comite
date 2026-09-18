-- 178 · REFERENCES e TRIGGER saem da tabela de local canônico
--
-- A 176 revogou o DML (INSERT/UPDATE/DELETE/TRUNCATE) da tabela, mas deixou
-- REFERENCES e TRIGGER com `authenticated` — herança do default do schema, não
-- decisão. Nenhum dos dois é DML, e nenhum dos dois é alcançável pelo
-- navegador hoje; o motivo de tirar é outro. TRIGGER em uma tabela de
-- procedência significa "pode pendurar código no caminho de escrita dela", e
-- REFERENCES significa "pode apontar chave estrangeira para ela e, com isso,
-- travar a supersessão de uma linha". Uma tabela cuja função é guardar a
-- origem documental de uma coordenada não deve oferecer nenhuma das duas
-- superfícies a um papel de leitura.
--
-- Escrita continua sendo exclusividade de service_role, como na 176.
-- Nenhuma política de RLS é tocada. Nenhum dado é tocado.

REVOKE REFERENCES, TRIGGER ON public.project_canonical_location FROM authenticated;

COMMENT ON TABLE public.project_canonical_location IS
  'Local canônico do projeto com procedência contratual e documental. '
  'Papel de leitura tem SELECT e nada mais: sem DML, sem TRIGGER, sem '
  'REFERENCES (178). Escrita só por service_role, via resolvedor idempotente.';
