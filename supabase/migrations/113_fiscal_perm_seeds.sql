-- ============================================================
-- INSIGHT FISCAL — permissões do módulo
-- Migration: 113_fiscal_perm_seeds
--
-- As rotas em `src/app/api/fiscal/**` já pedem estas chaves por nome. Nenhuma
-- delas existia na tabela `permissions`, e a sidebar tem um atalho que ignora
-- permissão para owner_admin — resultado: administrador via os itens de menu,
-- usuário comum não, e nenhum dos dois tinha uma decisão de acesso de verdade
-- por trás. Semear as chaves é o que transforma o RBAC fiscal em decisão real.
--
-- Quem recebe o quê segue a separação que o próprio módulo já assume:
--   ver / exportar      → quem acompanha (diretoria, financeiro, contratos)
--   criar               → quem fatura (financeiro)
--   aprovar / transmitir→ ato fiscal, restrito
--   cancelar            → desfaz ato fiscal, restrito
--   configurar          → mexe em certificado e credencial, só owner_admin
-- ============================================================
BEGIN;

INSERT INTO public.permissions (key, module, action, description) VALUES
  ('fiscal.view',      'fiscal', 'view',      'Visualizar notas fiscais de serviço e seus eventos'),
  ('fiscal.create',    'fiscal', 'create',    'Criar rascunho de NFS-e e cadastros fiscais'),
  ('fiscal.approve',   'fiscal', 'approve',   'Aprovar rascunho de NFS-e para transmissão'),
  ('fiscal.transmit',  'fiscal', 'transmit',  'Transmitir NFS-e ao provedor fiscal'),
  ('fiscal.cancel',    'fiscal', 'cancel',    'Cancelar ou substituir NFS-e autorizada'),
  ('fiscal.export',    'fiscal', 'export',    'Baixar XML e DANFSe da NFS-e'),
  ('fiscal.configure', 'fiscal', 'configure', 'Configurar estabelecimento, provedor, certificado e credenciais')
ON CONFLICT (key) DO NOTHING;

-- owner_admin: todas.
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM public.roles r, public.permissions p
 WHERE r.key = 'owner_admin' AND r.organization_id IS NULL AND p.module = 'fiscal'
ON CONFLICT DO NOTHING;

-- financeiro: opera o ciclo, menos configurar certificado.
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM public.roles r, public.permissions p
 WHERE r.key = 'financeiro' AND r.organization_id IS NULL
   AND p.key IN ('fiscal.view','fiscal.create','fiscal.approve','fiscal.transmit','fiscal.cancel','fiscal.export')
ON CONFLICT DO NOTHING;

-- ceo_diretoria e juridico_contratos: acompanham, não emitem.
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM public.roles r, public.permissions p
 WHERE r.key IN ('ceo_diretoria','juridico_contratos') AND r.organization_id IS NULL
   AND p.key IN ('fiscal.view','fiscal.export')
ON CONFLICT DO NOTHING;

COMMIT;
