import type { ManagementCategory, ManagementGroupKey, BusinessUnit, CostCenter, Supplier, Client, EntryTemplate } from '@/lib/types/finance';

// ============================================================
// Management Categories — 3-level Cost Stack Taxonomy
// ============================================================

export const managementCategories: ManagementCategory[] = [
  // ── A) REVENUE ────────────────────────────────────────────
  { id: 'cat-a',     code: 'A',     name: 'Receita',                         level: 1, group_key: 'revenue',   sign: 1,  requires_project: false, active: true },
  { id: 'cat-a1',    code: 'A.1',   name: 'Receita de Serviços',             level: 2, group_key: 'revenue',   sign: 1,  requires_project: false, active: true, parent_id: 'cat-a' },
  { id: 'cat-a11',   code: 'A.1.1', name: 'Receita de Contratos',            level: 3, group_key: 'revenue',   sign: 1,  requires_project: true,  requires_contract: true, active: true, parent_id: 'cat-a1' },
  { id: 'cat-a12',   code: 'A.1.2', name: 'Receita de Projetos Avulsos',     level: 3, group_key: 'revenue',   sign: 1,  requires_project: true,  active: true, parent_id: 'cat-a1' },
  { id: 'cat-a13',   code: 'A.1.3', name: 'Receita de Mobilização',          level: 3, group_key: 'revenue',   sign: 1,  requires_project: true,  active: true, parent_id: 'cat-a1' },
  { id: 'cat-a2',    code: 'A.2',   name: 'Outras Receitas',                 level: 2, group_key: 'revenue',   sign: 1,  requires_project: false, active: true, parent_id: 'cat-a' },
  { id: 'cat-a21',   code: 'A.2.1', name: 'Receita de Locação de Equipamentos', level: 3, group_key: 'revenue', sign: 1, requires_project: false, active: true, parent_id: 'cat-a2' },
  { id: 'cat-a22',   code: 'A.2.2', name: 'Receita de Reembolsos',           level: 3, group_key: 'revenue',   sign: 1,  requires_project: false, active: true, parent_id: 'cat-a2' },

  // ── B) COGS ───────────────────────────────────────────────
  { id: 'cat-b',     code: 'B',     name: 'Custos Diretos (COGS)',           level: 1, group_key: 'cogs',      sign: -1, requires_project: false, active: true },
  { id: 'cat-b1',    code: 'B.1',   name: 'Folha Direta',                    level: 2, group_key: 'cogs',      sign: -1, requires_project: false, active: true, parent_id: 'cat-b' },
  { id: 'cat-b11',   code: 'B.1.1', name: 'Salários — Equipe de Campo',      level: 3, group_key: 'cogs',      sign: -1, requires_project: true,  active: true, parent_id: 'cat-b1' },
  { id: 'cat-b12',   code: 'B.1.2', name: 'Encargos Trabalhistas',           level: 3, group_key: 'cogs',      sign: -1, requires_project: true,  active: true, parent_id: 'cat-b1' },
  { id: 'cat-b13',   code: 'B.1.3', name: 'Benefícios (VT, VR, Saúde)',      level: 3, group_key: 'cogs',      sign: -1, requires_project: true,  active: true, parent_id: 'cat-b1' },
  { id: 'cat-b14',   code: 'B.1.4', name: 'Horas Extras / Adicionais',       level: 3, group_key: 'cogs',      sign: -1, requires_project: true,  active: true, parent_id: 'cat-b1' },
  { id: 'cat-b2',    code: 'B.2',   name: 'Mobilização e Logística',         level: 2, group_key: 'cogs',      sign: -1, requires_project: true,  active: true, parent_id: 'cat-b' },
  { id: 'cat-b21',   code: 'B.2.1', name: 'Hospedagem',                      level: 3, group_key: 'cogs',      sign: -1, requires_project: true,  active: true, parent_id: 'cat-b2' },
  { id: 'cat-b22',   code: 'B.2.2', name: 'Passagens Aéreas',               level: 3, group_key: 'cogs',      sign: -1, requires_project: true,  active: true, parent_id: 'cat-b2' },
  { id: 'cat-b29',   code: 'B.2.9', name: 'Ônibus',                         level: 3, group_key: 'cogs',      sign: -1, requires_project: true,  active: true, parent_id: 'cat-b2' },
  { id: 'cat-b23',   code: 'B.2.3', name: 'Locação de Veículos',             level: 3, group_key: 'cogs',      sign: -1, requires_project: true,  active: true, parent_id: 'cat-b2' },
  { id: 'cat-b24',   code: 'B.2.4', name: 'Combustível',                     level: 3, group_key: 'cogs',      sign: -1, requires_project: true,  active: true, parent_id: 'cat-b2' },
  { id: 'cat-b2a',   code: 'B.2.10', name: 'Pedágio',                        level: 3, group_key: 'cogs',      sign: -1, requires_project: true,  active: true, parent_id: 'cat-b2' },
  { id: 'cat-b25',   code: 'B.2.5', name: 'Alimentação em Campo',            level: 3, group_key: 'cogs',      sign: -1, requires_project: true,  active: true, parent_id: 'cat-b2' },
  { id: 'cat-b3',    code: 'B.3',   name: 'Materiais e Insumos',             level: 2, group_key: 'cogs',      sign: -1, requires_project: true,  active: true, parent_id: 'cat-b' },
  { id: 'cat-b31',   code: 'B.3.1', name: 'Materiais de Consumo',            level: 3, group_key: 'cogs',      sign: -1, requires_project: true,  active: true, parent_id: 'cat-b3' },
  { id: 'cat-b32',   code: 'B.3.2', name: 'EPIs e Uniformes',                level: 3, group_key: 'cogs',      sign: -1, requires_project: true,  active: true, parent_id: 'cat-b3' },
  { id: 'cat-b33',   code: 'B.3.3', name: 'Ferramentas e Instrumentação',    level: 3, group_key: 'cogs',      sign: -1, requires_project: true,  active: true, parent_id: 'cat-b3' },
  { id: 'cat-b4',    code: 'B.4',   name: 'Subcontratados / Terceiros',      level: 2, group_key: 'cogs',      sign: -1, requires_project: true,  active: true, parent_id: 'cat-b' },
  { id: 'cat-b41',   code: 'B.4.1', name: 'Subcontratação de Serviços',      level: 3, group_key: 'cogs',      sign: -1, requires_project: true,  active: true, parent_id: 'cat-b4' },
  { id: 'cat-b42',   code: 'B.4.2', name: 'Consultoria Técnica',             level: 3, group_key: 'cogs',      sign: -1, requires_project: true,  active: true, parent_id: 'cat-b4' },
  { id: 'cat-b43',   code: 'B.4.3', name: 'Locação de Equipamentos (direto)', level: 3, group_key: 'cogs',     sign: -1, requires_project: true,  active: true, parent_id: 'cat-b4' },
  { id: 'cat-b5',    code: 'B.5',   name: 'Equipamentos e Máquinas',         level: 2, group_key: 'cogs',      sign: -1, requires_project: true,  active: true, parent_id: 'cat-b' },
  { id: 'cat-b51',   code: 'B.5.1', name: 'Locação de Equipamentos Pesados', level: 3, group_key: 'cogs',      sign: -1, requires_project: true,  active: true, parent_id: 'cat-b5' },
  { id: 'cat-b52',   code: 'B.5.2', name: 'Manutenção de Equipamentos',      level: 3, group_key: 'cogs',      sign: -1, requires_project: true,  active: true, parent_id: 'cat-b5' },

  // ── C) OPEX ───────────────────────────────────────────────
  { id: 'cat-c',     code: 'C',     name: 'Despesas Operacionais (OPEX)',    level: 1, group_key: 'opex',      sign: -1, requires_project: false, active: true },
  { id: 'cat-c1',    code: 'C.1',   name: 'Folha Indireta',                  level: 2, group_key: 'opex',      sign: -1, requires_project: false, active: true, parent_id: 'cat-c' },
  { id: 'cat-c11',   code: 'C.1.1', name: 'Salários — Administração',        level: 3, group_key: 'opex',      sign: -1, requires_project: false, active: true, parent_id: 'cat-c1' },
  { id: 'cat-c12',   code: 'C.1.2', name: 'Encargos e Benefícios — Indireto', level: 3, group_key: 'opex',     sign: -1, requires_project: false, active: true, parent_id: 'cat-c1' },
  { id: 'cat-c13',   code: 'C.1.3', name: 'Pró-labore / Diretoria',          level: 3, group_key: 'opex',      sign: -1, requires_project: false, active: true, parent_id: 'cat-c1' },
  { id: 'cat-c2',    code: 'C.2',   name: 'Instalações e Infraestrutura',    level: 2, group_key: 'opex',      sign: -1, requires_project: false, active: true, parent_id: 'cat-c' },
  { id: 'cat-c21',   code: 'C.2.1', name: 'Aluguel de Escritório / Galpão',  level: 3, group_key: 'opex',      sign: -1, requires_project: false, active: true, parent_id: 'cat-c2' },
  { id: 'cat-c22',   code: 'C.2.2', name: 'Energia / Água / Telecom',        level: 3, group_key: 'opex',      sign: -1, requires_project: false, active: true, parent_id: 'cat-c2' },
  { id: 'cat-c23',   code: 'C.2.3', name: 'Manutenção Predial',              level: 3, group_key: 'opex',      sign: -1, requires_project: false, active: true, parent_id: 'cat-c2' },
  { id: 'cat-c3',    code: 'C.3',   name: 'TI e SaaS',                       level: 2, group_key: 'opex',      sign: -1, requires_project: false, active: true, parent_id: 'cat-c' },
  { id: 'cat-c31',   code: 'C.3.1', name: 'Licenças de Software',            level: 3, group_key: 'opex',      sign: -1, requires_project: false, active: true, parent_id: 'cat-c3' },
  { id: 'cat-c32',   code: 'C.3.2', name: 'Infraestrutura Cloud',            level: 3, group_key: 'opex',      sign: -1, requires_project: false, active: true, parent_id: 'cat-c3' },
  { id: 'cat-c33',   code: 'C.3.3', name: 'Suporte Técnico',                 level: 3, group_key: 'opex',      sign: -1, requires_project: false, active: true, parent_id: 'cat-c3' },
  { id: 'cat-c4',    code: 'C.4',   name: 'Jurídico e Contábil',             level: 2, group_key: 'opex',      sign: -1, requires_project: false, active: true, parent_id: 'cat-c' },
  { id: 'cat-c41',   code: 'C.4.1', name: 'Honorários Jurídicos',            level: 3, group_key: 'opex',      sign: -1, requires_project: false, active: true, parent_id: 'cat-c4' },
  { id: 'cat-c42',   code: 'C.4.2', name: 'Contabilidade / Auditoria',       level: 3, group_key: 'opex',      sign: -1, requires_project: false, active: true, parent_id: 'cat-c4' },
  { id: 'cat-c43',   code: 'C.4.3', name: 'Taxas e Licenças / Alvarás',      level: 3, group_key: 'opex',      sign: -1, requires_project: false, active: true, parent_id: 'cat-c4' },
  { id: 'cat-c5',    code: 'C.5',   name: 'Comercial e Marketing',           level: 2, group_key: 'opex',      sign: -1, requires_project: false, active: true, parent_id: 'cat-c' },
  { id: 'cat-c51',   code: 'C.5.1', name: 'Viagens Comerciais',              level: 3, group_key: 'opex',      sign: -1, requires_project: false, active: true, parent_id: 'cat-c5' },
  { id: 'cat-c52',   code: 'C.5.2', name: 'Eventos e Feiras',                level: 3, group_key: 'opex',      sign: -1, requires_project: false, active: true, parent_id: 'cat-c5' },
  { id: 'cat-c53',   code: 'C.5.3', name: 'Material de Divulgação',          level: 3, group_key: 'opex',      sign: -1, requires_project: false, active: true, parent_id: 'cat-c5' },

  // ── D) FINANCIAL ──────────────────────────────────────────
  { id: 'cat-d',     code: 'D',     name: 'Financeiro',                      level: 1, group_key: 'financial', sign: -1, requires_project: false, active: true },
  { id: 'cat-d1',    code: 'D.1',   name: 'Juros e Tarifas Bancárias',       level: 2, group_key: 'financial', sign: -1, requires_project: false, active: true, parent_id: 'cat-d' },
  { id: 'cat-d11',   code: 'D.1.1', name: 'Juros de Empréstimo',             level: 3, group_key: 'financial', sign: -1, requires_project: false, active: true, parent_id: 'cat-d1' },
  { id: 'cat-d12',   code: 'D.1.2', name: 'Tarifas Bancárias',               level: 3, group_key: 'financial', sign: -1, requires_project: false, active: true, parent_id: 'cat-d1' },
  { id: 'cat-d13',   code: 'D.1.3', name: 'IOF',                             level: 3, group_key: 'financial', sign: -1, requires_project: false, active: true, parent_id: 'cat-d1' },
  { id: 'cat-d2',    code: 'D.2',   name: 'Antecipação de Recebíveis',       level: 2, group_key: 'financial', sign: -1, requires_project: false, active: true, parent_id: 'cat-d' },
  { id: 'cat-d21',   code: 'D.2.1', name: 'Deságio de Factoring / FIDC',     level: 3, group_key: 'financial', sign: -1, requires_project: false, active: true, parent_id: 'cat-d2' },
  { id: 'cat-d22',   code: 'D.2.2', name: 'Taxas de Antecipação',            level: 3, group_key: 'financial', sign: -1, requires_project: false, active: true, parent_id: 'cat-d2' },
  { id: 'cat-d3',    code: 'D.3',   name: 'Variação Cambial',                level: 2, group_key: 'financial', sign: -1, requires_project: false, active: true, parent_id: 'cat-d' },
  { id: 'cat-d31',   code: 'D.3.1', name: 'Perda Cambial',                   level: 3, group_key: 'financial', sign: -1, requires_project: false, active: true, parent_id: 'cat-d3' },
  { id: 'cat-d4',    code: 'D.4',   name: 'Receita Financeira',              level: 2, group_key: 'financial', sign: 1,  requires_project: false, active: true, parent_id: 'cat-d' },
  { id: 'cat-d41',   code: 'D.4.1', name: 'Rendimento de Aplicações',        level: 3, group_key: 'financial', sign: 1,  requires_project: false, active: true, parent_id: 'cat-d4' },
  { id: 'cat-d42',   code: 'D.4.2', name: 'Juros Recebidos',                 level: 3, group_key: 'financial', sign: 1,  requires_project: false, active: true, parent_id: 'cat-d4' },

  // ── E) TAXES ──────────────────────────────────────────────
  { id: 'cat-e',     code: 'E',     name: 'Tributos',                        level: 1, group_key: 'taxes',     sign: -1, requires_project: false, active: true },
  { id: 'cat-e1',    code: 'E.1',   name: 'Impostos sobre Receita',          level: 2, group_key: 'taxes',     sign: -1, requires_project: false, active: true, parent_id: 'cat-e' },
  { id: 'cat-e11',   code: 'E.1.1', name: 'ISS',                             level: 3, group_key: 'taxes',     sign: -1, requires_project: false, active: true, parent_id: 'cat-e1' },
  { id: 'cat-e12',   code: 'E.1.2', name: 'PIS / COFINS',                    level: 3, group_key: 'taxes',     sign: -1, requires_project: false, active: true, parent_id: 'cat-e1' },
  { id: 'cat-e13',   code: 'E.1.3', name: 'IRPJ / CSLL (provisão)',          level: 3, group_key: 'taxes',     sign: -1, requires_project: false, active: true, parent_id: 'cat-e1' },
  { id: 'cat-e2',    code: 'E.2',   name: 'Outros Impostos',                 level: 2, group_key: 'taxes',     sign: -1, requires_project: false, active: true, parent_id: 'cat-e' },
  { id: 'cat-e21',   code: 'E.2.1', name: 'ICMS',                            level: 3, group_key: 'taxes',     sign: -1, requires_project: false, active: true, parent_id: 'cat-e2' },
  { id: 'cat-e22',   code: 'E.2.2', name: 'Impostos Retidos na Fonte',       level: 3, group_key: 'taxes',     sign: -1, requires_project: false, active: true, parent_id: 'cat-e2' },
  { id: 'cat-e3',    code: 'E.3',   name: 'Provisões vs Pagos',              level: 2, group_key: 'taxes',     sign: -1, requires_project: false, active: true, parent_id: 'cat-e' },
  { id: 'cat-e31',   code: 'E.3.1', name: 'Provisão Tributária',             level: 3, group_key: 'taxes',     sign: -1, requires_project: false, active: true, parent_id: 'cat-e3' },
  { id: 'cat-e32',   code: 'E.3.2', name: 'Imposto Pago',                    level: 3, group_key: 'taxes',     sign: -1, requires_project: false, active: true, parent_id: 'cat-e3' },

  // ── F) CLEARING / TREASURY (non-P&L) ──────────────────────
  // Balance-sheet / cash movement categories. Excluded from managerial DRE
  // by every P&L selector (group_key='clearing'); used for AP/AR settlement
  // cash legs and cash-flow analysis. Sign reflects cash direction: +1 in, -1 out.
  { id: 'cat-f',     code: 'F',     name: 'Tesouraria / Clearing',           level: 1, group_key: 'clearing',  sign:  1, requires_project: false, active: true },
  { id: 'cat-f1',    code: 'F.1',   name: 'Movimento de Caixa',              level: 2, group_key: 'clearing',  sign:  1, requires_project: false, active: true, parent_id: 'cat-f' },
  { id: 'cat-f11',   code: 'F.1.1', name: 'Recebimento (Cash-in Clearing)',  level: 3, group_key: 'clearing',  sign:  1, requires_project: false, active: true, parent_id: 'cat-f1' },
  { id: 'cat-f12',   code: 'F.1.2', name: 'Pagamento (Cash-out Clearing)',   level: 3, group_key: 'clearing',  sign: -1, requires_project: false, active: true, parent_id: 'cat-f1' },
  { id: 'cat-f2',    code: 'F.2',   name: 'Liquidação AP/AR',                level: 2, group_key: 'clearing',  sign:  1, requires_project: false, active: true, parent_id: 'cat-f' },
  { id: 'cat-f21',   code: 'F.2.1', name: 'Liquidação de Recebível (AR)',    level: 3, group_key: 'clearing',  sign:  1, requires_project: false, active: true, parent_id: 'cat-f2' },
  { id: 'cat-f22',   code: 'F.2.2', name: 'Liquidação de Pagável (AP)',      level: 3, group_key: 'clearing',  sign: -1, requires_project: false, active: true, parent_id: 'cat-f2' },
  { id: 'cat-f3',    code: 'F.3',   name: 'Liquidação Tributária',           level: 2, group_key: 'clearing',  sign: -1, requires_project: false, active: true, parent_id: 'cat-f' },
  { id: 'cat-f31',   code: 'F.3.1', name: 'Pagamento de Tributo (DARF/GPS/Guia)', level: 3, group_key: 'clearing', sign: -1, requires_project: false, active: true, parent_id: 'cat-f3' },

  // ════════════════════════════════════════════════════════════
  // HIERARCHY EXTENSION (additive) — deeper cost analysis.
  // Existing codes/ids above are preserved; the entries below add the
  // granular subcategories and the Frota / Viagens / Administrativo
  // categories requested for drill-down. requires_cost_center marks
  // P&L expense leaves; requires_contract marks revenue leaves.
  // ════════════════════════════════════════════════════════════

  // ── B.2) Mobilização — granular subcategories ─────────────
  { id: 'cat-b27',   code: 'B.2.7', name: 'Diárias',                          level: 3, group_key: 'cogs', sign: -1, requires_project: true, requires_cost_center: true, active: true, parent_id: 'cat-b2', description: 'Diárias de viagem/campo pagas à equipe.' },
  { id: 'cat-b28',   code: 'B.2.8', name: 'Transporte de Material',          level: 3, group_key: 'cogs', sign: -1, requires_project: true, requires_cost_center: true, active: true, parent_id: 'cat-b2', description: 'Frete e transporte de materiais/equipamentos para o campo.' },

  // ── B.3) Materiais — granular subcategories ───────────────
  { id: 'cat-b34',   code: 'B.3.4', name: 'Cabos',                            level: 3, group_key: 'cogs', sign: -1, requires_project: true, requires_cost_center: true, active: true, parent_id: 'cat-b3' },
  { id: 'cat-b35',   code: 'B.3.5', name: 'Peças',                            level: 3, group_key: 'cogs', sign: -1, requires_project: true, requires_cost_center: true, active: true, parent_id: 'cat-b3' },
  { id: 'cat-b36',   code: 'B.3.6', name: 'Equipamentos (consumo)',           level: 3, group_key: 'cogs', sign: -1, requires_project: true, requires_cost_center: true, active: true, parent_id: 'cat-b3' },

  // ── B.4) Serviços Terceiros — granular subcategories ──────
  { id: 'cat-b44',   code: 'B.4.4', name: 'Engenharia',                       level: 3, group_key: 'cogs', sign: -1, requires_project: true, requires_cost_center: true, active: true, parent_id: 'cat-b4' },
  { id: 'cat-b45',   code: 'B.4.5', name: 'Manutenção (terceiros)',           level: 3, group_key: 'cogs', sign: -1, requires_project: true, requires_cost_center: true, active: true, parent_id: 'cat-b4' },

  // ── B.6) Frota (nova categoria L2 sob COGS) ───────────────
  { id: 'cat-b6',    code: 'B.6',   name: 'Frota',                            level: 2, group_key: 'cogs', sign: -1, requires_project: false, active: true, parent_id: 'cat-b', description: 'Custos da frota própria/locada alocados a obra.' },
  { id: 'cat-b61',   code: 'B.6.1', name: 'Locação',                          level: 3, group_key: 'cogs', sign: -1, requires_project: true, requires_cost_center: true, active: true, parent_id: 'cat-b6' },
  { id: 'cat-b62',   code: 'B.6.2', name: 'Combustível',                      level: 3, group_key: 'cogs', sign: -1, requires_project: true, requires_cost_center: true, active: true, parent_id: 'cat-b6' },
  { id: 'cat-b63',   code: 'B.6.3', name: 'Manutenção',                       level: 3, group_key: 'cogs', sign: -1, requires_project: true, requires_cost_center: true, active: true, parent_id: 'cat-b6' },
  { id: 'cat-b64',   code: 'B.6.4', name: 'Seguro',                           level: 3, group_key: 'cogs', sign: -1, requires_project: true, requires_cost_center: true, active: true, parent_id: 'cat-b6' },
  { id: 'cat-b65',   code: 'B.6.5', name: 'Pedágio',                          level: 3, group_key: 'cogs', sign: -1, requires_project: true, requires_cost_center: true, active: true, parent_id: 'cat-b6' },

  // ── C.6) Viagens (nova categoria L2 sob OPEX) ─────────────
  { id: 'cat-c6',    code: 'C.6',   name: 'Viagens',                          level: 2, group_key: 'opex', sign: -1, requires_project: false, active: true, parent_id: 'cat-c', description: 'Viagens corporativas (não-campo).' },
  { id: 'cat-c61',   code: 'C.6.1', name: 'Hospedagem',                       level: 3, group_key: 'opex', sign: -1, requires_project: false, requires_cost_center: true, active: true, parent_id: 'cat-c6' },
  { id: 'cat-c62',   code: 'C.6.2', name: 'Passagem Aérea',                   level: 3, group_key: 'opex', sign: -1, requires_project: false, requires_cost_center: true, active: true, parent_id: 'cat-c6' },
  { id: 'cat-c63',   code: 'C.6.3', name: 'Reembolso',                        level: 3, group_key: 'opex', sign: -1, requires_project: false, requires_cost_center: true, active: true, parent_id: 'cat-c6' },
  { id: 'cat-c64',   code: 'C.6.4', name: 'Alimentação',                      level: 3, group_key: 'opex', sign: -1, requires_project: false, requires_cost_center: true, active: true, parent_id: 'cat-c6' },
  { id: 'cat-c65',   code: 'C.6.5', name: 'Transporte',                       level: 3, group_key: 'opex', sign: -1, requires_project: false, requires_cost_center: true, active: true, parent_id: 'cat-c6' },

  // ── C.7) Administrativo (nova categoria L2 sob OPEX) ──────
  { id: 'cat-c7',    code: 'C.7',   name: 'Administrativo',                   level: 2, group_key: 'opex', sign: -1, requires_project: false, active: true, parent_id: 'cat-c', description: 'Despesas administrativas gerais.' },
  { id: 'cat-c71',   code: 'C.7.1', name: 'Software',                         level: 3, group_key: 'opex', sign: -1, requires_project: false, requires_cost_center: true, active: true, parent_id: 'cat-c7' },
  { id: 'cat-c72',   code: 'C.7.2', name: 'Escritório',                       level: 3, group_key: 'opex', sign: -1, requires_project: false, requires_cost_center: true, active: true, parent_id: 'cat-c7' },
  { id: 'cat-c73',   code: 'C.7.3', name: 'Telefonia',                        level: 3, group_key: 'opex', sign: -1, requires_project: false, requires_cost_center: true, active: true, parent_id: 'cat-c7' },
  { id: 'cat-c74',   code: 'C.7.4', name: 'Internet',                         level: 3, group_key: 'opex', sign: -1, requires_project: false, requires_cost_center: true, active: true, parent_id: 'cat-c7' },
  { id: 'cat-c75',   code: 'C.7.5', name: 'Contabilidade',                    level: 3, group_key: 'opex', sign: -1, requires_project: false, requires_cost_center: true, active: true, parent_id: 'cat-c7' },
  { id: 'cat-c76',   code: 'C.7.6', name: 'Jurídico',                         level: 3, group_key: 'opex', sign: -1, requires_project: false, requires_cost_center: true, active: true, parent_id: 'cat-c7' },

  // ── E) Tributos — granular subcategories ──────────────────
  { id: 'cat-e14',   code: 'E.1.4', name: 'PIS',                              level: 3, group_key: 'taxes', sign: -1, requires_project: false, active: true, parent_id: 'cat-e1' },
  { id: 'cat-e15',   code: 'E.1.5', name: 'COFINS',                           level: 3, group_key: 'taxes', sign: -1, requires_project: false, active: true, parent_id: 'cat-e1' },
  { id: 'cat-e16',   code: 'E.1.6', name: 'CSLL',                             level: 3, group_key: 'taxes', sign: -1, requires_project: false, active: true, parent_id: 'cat-e1' },
  // E.4) Tributos sobre Folha (nova categoria L2 sob TAXES)
  { id: 'cat-e4',    code: 'E.4',   name: 'Tributos sobre Folha',            level: 2, group_key: 'taxes', sign: -1, requires_project: false, active: true, parent_id: 'cat-e', description: 'Encargos e retenções incidentes sobre a folha.' },
  { id: 'cat-e41',   code: 'E.4.1', name: 'INSS',                             level: 3, group_key: 'taxes', sign: -1, requires_project: false, active: true, parent_id: 'cat-e4' },
  { id: 'cat-e42',   code: 'E.4.2', name: 'FGTS',                             level: 3, group_key: 'taxes', sign: -1, requires_project: false, active: true, parent_id: 'cat-e4' },
  { id: 'cat-e43',   code: 'E.4.3', name: 'IRRF',                             level: 3, group_key: 'taxes', sign: -1, requires_project: false, active: true, parent_id: 'cat-e4' },
];

// ============================================================
// P&L group helpers — keep the managerial DRE free of clearing/cash entries
// ============================================================

/** The five managerial-DRE groups. Excludes 'clearing' (treasury/cash). */
export const PNL_GROUP_KEYS: ManagementGroupKey[] = ['revenue', 'cogs', 'opex', 'financial', 'taxes'];

export function isPnlGroup(groupKey: ManagementGroupKey): boolean {
  return PNL_GROUP_KEYS.includes(groupKey);
}

export function isClearingGroup(groupKey: ManagementGroupKey): boolean {
  return groupKey === 'clearing';
}

/** True when the category (by id) belongs to the clearing/treasury group. */
export function isClearingCategory(categoryId: string | undefined): boolean {
  if (!categoryId) return false;
  const cat = managementCategories.find(c => c.id === categoryId);
  return cat ? cat.group_key === 'clearing' : false;
}

// ============================================================
// Business Units seed
// ============================================================

export const businessUnits: BusinessUnit[] = [
  { id: 'bu-sp', code: 'INSIGHT-SP', name: 'Insight SP — Matriz',     cnpj: '12.345.678/0001-00', uf: 'SP', city: 'São Paulo',    active: true, created_at: '2025-01-01T00:00:00Z', updated_at: '2025-01-01T00:00:00Z' },
  { id: 'bu-rj', code: 'INSIGHT-RJ', name: 'Insight RJ — Macaé',     cnpj: '12.345.678/0002-81', uf: 'RJ', city: 'Macaé',         active: true, created_at: '2025-01-01T00:00:00Z', updated_at: '2025-01-01T00:00:00Z' },
  { id: 'bu-ba', code: 'INSIGHT-BA', name: 'Insight BA — Salvador',   cnpj: '12.345.678/0003-62', uf: 'BA', city: 'Salvador',      active: true, created_at: '2025-01-01T00:00:00Z', updated_at: '2025-01-01T00:00:00Z' },
  { id: 'bu-es', code: 'INSIGHT-ES', name: 'Insight ES — Vitória',   cnpj: '12.345.678/0004-43', uf: 'ES', city: 'Vitória',       active: true, created_at: '2025-01-01T00:00:00Z', updated_at: '2025-01-01T00:00:00Z' },
];

// ============================================================
// Cost Centers seed
// ============================================================

export const costCenters: CostCenter[] = [
  { id: 'cc-eng-campo',  code: 'ENG-CAMPO',  name: 'Engenharia de Campo',     business_unit_id: 'bu-rj', type: 'direct',   active: true, created_at: '2025-01-01T00:00:00Z', updated_at: '2025-01-01T00:00:00Z' },
  { id: 'cc-manut',      code: 'MANUT',      name: 'Manutenção Industrial',   business_unit_id: 'bu-rj', type: 'direct',   active: true, created_at: '2025-01-01T00:00:00Z', updated_at: '2025-01-01T00:00:00Z' },
  { id: 'cc-mob',        code: 'MOB',        name: 'Mobilização',             business_unit_id: 'bu-rj', type: 'direct',   active: true, created_at: '2025-01-01T00:00:00Z', updated_at: '2025-01-01T00:00:00Z' },
  { id: 'cc-admin-sp',   code: 'ADM-SP',     name: 'Administrativo SP',       business_unit_id: 'bu-sp', type: 'admin',    active: true, created_at: '2025-01-01T00:00:00Z', updated_at: '2025-01-01T00:00:00Z' },
  { id: 'cc-ti',         code: 'TI',         name: 'Tecnologia da Informação', business_unit_id: 'bu-sp', type: 'indirect', active: true, created_at: '2025-01-01T00:00:00Z', updated_at: '2025-01-01T00:00:00Z' },
  { id: 'cc-rh',         code: 'RH',         name: 'Recursos Humanos',        business_unit_id: 'bu-sp', type: 'indirect', active: true, created_at: '2025-01-01T00:00:00Z', updated_at: '2025-01-01T00:00:00Z' },
  { id: 'cc-comercial',  code: 'COMERC',     name: 'Comercial',               business_unit_id: 'bu-sp', type: 'indirect', active: true, created_at: '2025-01-01T00:00:00Z', updated_at: '2025-01-01T00:00:00Z' },
  { id: 'cc-financeiro', code: 'FIN',        name: 'Financeiro',              business_unit_id: 'bu-sp', type: 'admin',    active: true, created_at: '2025-01-01T00:00:00Z', updated_at: '2025-01-01T00:00:00Z' },
];

// ============================================================
// Suppliers seed
// ============================================================

export const suppliers: Supplier[] = [
  { id: 'sup-1', name: 'Comfort Hotel Macaé',         cpf_cnpj: '33.000.111/0001-01', category: 'hotel',         uf: 'RJ', active: true, source_system: 'manual', created_at: '2025-01-01T00:00:00Z', updated_at: '2025-01-01T00:00:00Z' },
  { id: 'sup-2', name: 'LATAM Airlines',               cpf_cnpj: '33.000.222/0001-02', category: 'airline',       uf: 'SP', active: true, source_system: 'manual', created_at: '2025-01-01T00:00:00Z', updated_at: '2025-01-01T00:00:00Z' },
  { id: 'sup-3', name: 'Localiza Rent a Car',          cpf_cnpj: '33.000.333/0001-03', category: 'vehicle',       uf: 'MG', active: true, source_system: 'manual', created_at: '2025-01-01T00:00:00Z', updated_at: '2025-01-01T00:00:00Z' },
  { id: 'sup-4', name: 'TechServ Soluções Industriais', cpf_cnpj: '33.000.444/0001-04', category: 'subcontractor', uf: 'RJ', active: true, source_system: 'manual', created_at: '2025-01-01T00:00:00Z', updated_at: '2025-01-01T00:00:00Z' },
  { id: 'sup-5', name: 'Ipiranga Combustíveis',        cpf_cnpj: '33.000.555/0001-05', category: 'fuel',          uf: 'RJ', active: true, source_system: 'manual', created_at: '2025-01-01T00:00:00Z', updated_at: '2025-01-01T00:00:00Z' },
  { id: 'sup-6', name: 'SafetyPro EPIs',               cpf_cnpj: '33.000.666/0001-06', category: 'materials',     uf: 'SP', active: true, source_system: 'manual', created_at: '2025-01-01T00:00:00Z', updated_at: '2025-01-01T00:00:00Z' },
  { id: 'sup-7', name: 'Viação 1001',                  cpf_cnpj: '33.000.777/0001-07', category: 'bus',           uf: 'RJ', active: true, source_system: 'manual', created_at: '2025-01-01T00:00:00Z', updated_at: '2025-01-01T00:00:00Z' },
  { id: 'sup-8', name: 'ConectCar Pedágios',           cpf_cnpj: '33.000.888/0001-08', category: 'toll',          uf: 'SP', active: true, source_system: 'manual', created_at: '2025-01-01T00:00:00Z', updated_at: '2025-01-01T00:00:00Z' },
  { id: 'sup-9', name: 'Sabor de Campo Refeições',     cpf_cnpj: '33.000.999/0001-09', category: 'catering',      uf: 'RJ', active: true, source_system: 'manual', created_at: '2025-01-01T00:00:00Z', updated_at: '2025-01-01T00:00:00Z' },
  { id: 'sup-10', name: 'TransCarga Logística',        cpf_cnpj: '33.000.101/0001-10', category: 'freight',       uf: 'RJ', active: true, source_system: 'manual', created_at: '2025-01-01T00:00:00Z', updated_at: '2025-01-01T00:00:00Z' },
];

// ============================================================
// Clients seed
// ============================================================

export const clients: Client[] = [
  { id: 'cli-1', name: 'Petrobras',       cnpj: '33.000.167/0001-01', segment: 'O&G Upstream',     active: true, source_system: 'manual', created_at: '2025-01-01T00:00:00Z', updated_at: '2025-01-01T00:00:00Z' },
  { id: 'cli-2', name: 'Shell Brasil',    cnpj: '33.000.168/0001-02', segment: 'O&G Upstream',     active: true, source_system: 'manual', created_at: '2025-01-01T00:00:00Z', updated_at: '2025-01-01T00:00:00Z' },
  { id: 'cli-3', name: 'Equinor Brasil',  cnpj: '33.000.169/0001-03', segment: 'O&G Upstream',     active: true, source_system: 'manual', created_at: '2025-01-01T00:00:00Z', updated_at: '2025-01-01T00:00:00Z' },
  { id: 'cli-4', name: 'Eneva',           cnpj: '33.000.170/0001-04', segment: 'Geração Energia',  active: true, source_system: 'manual', created_at: '2025-01-01T00:00:00Z', updated_at: '2025-01-01T00:00:00Z' },
];

// ============================================================
// Entry Templates
// ============================================================

export const entryTemplates: EntryTemplate[] = [
  {
    key: 'hotel_per_diem',
    label: 'Hotel / Diária',
    category_code: 'B.2.1',
    default_fields: { source_system: 'manual', entry_type: 'actual' },
    extra_fields: [
      { key: 'city', label: 'Cidade', type: 'text', required: true },
      { key: 'nights', label: 'Nº de Noites', type: 'number', required: true },
      { key: 'rate_per_night', label: 'Valor/Noite (R$)', type: 'number', required: false },
    ],
  },
  {
    key: 'flight',
    label: 'Passagem Aérea',
    category_code: 'B.2.2',
    default_fields: { source_system: 'manual', entry_type: 'actual' },
    extra_fields: [
      { key: 'route', label: 'Trecho', type: 'text', required: true },
      { key: 'passenger', label: 'Colaborador', type: 'text', required: true },
    ],
  },
  {
    key: 'fuel',
    label: 'Combustível',
    category_code: 'B.2.4',
    default_fields: { source_system: 'manual', entry_type: 'actual' },
    extra_fields: [
      { key: 'plate', label: 'Placa do Veículo', type: 'text', required: true },
      { key: 'km', label: 'KM Rodados', type: 'number', required: false },
    ],
  },
  {
    key: 'vehicle_rental',
    label: 'Locação de Veículo',
    category_code: 'B.2.3',
    default_fields: { source_system: 'manual', entry_type: 'actual' },
    extra_fields: [
      { key: 'plate', label: 'Placa', type: 'text', required: true },
      { key: 'rental_period', label: 'Período', type: 'text', required: true },
    ],
  },
  {
    key: 'material',
    label: 'Material',
    category_code: 'B.3.1',
    default_fields: { source_system: 'manual', entry_type: 'actual' },
    extra_fields: [
      { key: 'material_type', label: 'Tipo de Material', type: 'text', required: true },
      { key: 'quantity', label: 'Quantidade', type: 'number', required: true },
    ],
  },
  {
    key: 'subcontractor_invoice',
    label: 'NF Subcontratado',
    category_code: 'B.4.1',
    default_fields: { source_system: 'manual', entry_type: 'actual' },
    extra_fields: [
      { key: 'nf_number', label: 'Nº da NF', type: 'text', required: true },
    ],
  },
  {
    key: 'bank_fee',
    label: 'Tarifa Bancária',
    category_code: 'D.1.2',
    default_fields: { source_system: 'manual', entry_type: 'actual' },
    extra_fields: [
      { key: 'bank', label: 'Banco', type: 'text', required: true },
      { key: 'fee_type', label: 'Tipo de Tarifa', type: 'text', required: false },
    ],
  },
  {
    key: 'bank_interest',
    label: 'Juros Bancários',
    category_code: 'D.1.1',
    default_fields: { source_system: 'manual', entry_type: 'actual' },
    extra_fields: [
      { key: 'bank', label: 'Banco', type: 'text', required: true },
      { key: 'loan_contract', label: 'Contrato de Empréstimo', type: 'text', required: false },
    ],
  },
  {
    key: 'tax_payment',
    label: 'Pagamento de Imposto',
    category_code: 'E.1.1',
    default_fields: { source_system: 'manual', entry_type: 'actual' },
    extra_fields: [
      { key: 'tax_type', label: 'Tipo de Imposto', type: 'select', required: true, options: ['ISS', 'PIS', 'COFINS', 'IRPJ', 'CSLL', 'ICMS', 'Outros'] },
      { key: 'reference_period', label: 'Competência Referência', type: 'text', required: true },
      { key: 'guide_number', label: 'Nº da Guia', type: 'text', required: false },
    ],
  },
  {
    key: 'receivables_anticipation',
    label: 'Antecipação de Recebíveis',
    category_code: 'D.2.1',
    default_fields: { source_system: 'manual', entry_type: 'actual' },
    extra_fields: [
      { key: 'institution', label: 'Instituição', type: 'text', required: true },
      { key: 'rate_pct', label: 'Taxa (%)', type: 'number', required: true },
      { key: 'face_value', label: 'Valor de Face (R$)', type: 'number', required: true },
    ],
  },
];

// Helper: build category tree from flat list
export function buildCategoryTree(categories: ManagementCategory[]): ManagementCategory[] {
  const map = new Map<string, ManagementCategory>();
  categories.forEach(c => map.set(c.id, { ...c, children: [] }));

  const roots: ManagementCategory[] = [];
  map.forEach(c => {
    if (c.parent_id && map.has(c.parent_id)) {
      map.get(c.parent_id)!.children!.push(c);
    } else if (!c.parent_id) {
      roots.push(c);
    }
  });
  return roots;
}

// Helper: find category by code
export function findCategoryByCode(code: string): ManagementCategory | undefined {
  return managementCategories.find(c => c.code === code);
}

// Helper: get L3 categories for a group
export function getL3CategoriesByGroup(groupKey: string): ManagementCategory[] {
  return managementCategories.filter(c => c.group_key === groupKey && c.level === 3);
}

// Helper: find category by id
export function findCategoryById(id: string | undefined): ManagementCategory | undefined {
  if (!id) return undefined;
  return managementCategories.find(c => c.id === id);
}

/** Direct children (one level down) of a category id — drives cascading selects. */
export function getSubcategories(parentId: string | undefined): ManagementCategory[] {
  if (!parentId) return [];
  return managementCategories.filter(c => c.parent_id === parentId && c.active);
}

/**
 * Resolve a category to its (L2 category, L3 subcategory) display pair.
 * For an L3 entry, parent is the L2 categoria; for an L2 entry, it is the
 * categoria with no subcategory. Used by analysis selectors and drill-downs.
 */
export function resolveCategoryPath(category: ManagementCategory): {
  groupKey: ManagementCategory['group_key'];
  categoryId: string;
  categoryName: string;
  subcategoryId?: string;
  subcategoryName?: string;
} {
  if (category.level === 3) {
    const l2 = category.parent_id ? findCategoryById(category.parent_id) : undefined;
    return {
      groupKey: category.group_key,
      categoryId: l2?.id ?? category.id,
      categoryName: l2?.name ?? category.name,
      subcategoryId: category.id,
      subcategoryName: category.name,
    };
  }
  if (category.level === 2) {
    return { groupKey: category.group_key, categoryId: category.id, categoryName: category.name };
  }
  // L1 group root
  return { groupKey: category.group_key, categoryId: category.id, categoryName: category.name };
}
