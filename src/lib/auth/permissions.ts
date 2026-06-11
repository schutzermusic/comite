import type { PermissionGroup, PermissionKey } from './types';

export const PERMISSION_GROUPS: PermissionGroup[] = [
  {
    module: 'admin',
    label: 'Admin',
    permissions: [
      { key: 'admin.view', label: 'Visualizar admin' },
      { key: 'admin.manage_users', label: 'Gerenciar usuarios' },
      { key: 'admin.manage_roles', label: 'Gerenciar roles' },
      { key: 'admin.manage_organization', label: 'Gerenciar organizacao' },
      { key: 'admin.manage_integrations', label: 'Gerenciar integracoes' },
    ],
  },
  {
    module: 'dashboard',
    label: 'Dashboard',
    permissions: [
      { key: 'dashboard.view', label: 'Visualizar' },
      { key: 'dashboard.view_executive', label: 'Executivo' },
      { key: 'dashboard.export', label: 'Exportar' },
    ],
  },
  {
    module: 'projects',
    label: 'Projetos',
    permissions: [
      { key: 'projects.view', label: 'Visualizar' },
      { key: 'projects.create', label: 'Criar' },
      { key: 'projects.edit', label: 'Editar' },
      { key: 'projects.delete', label: 'Excluir' },
      { key: 'projects.export', label: 'Exportar' },
      { key: 'projects.upload', label: 'Upload' },
      { key: 'projects.view_costs', label: 'Custos' },
      { key: 'projects.view_margin', label: 'Margem' },
      { key: 'projects.view_all', label: 'Todos' },
      { key: 'projects.view_assigned', label: 'Atribuidos' },
    ],
  },
  {
    module: 'project_gantt',
    label: 'Project Gantt',
    permissions: [
      { key: 'project_gantt.view', label: 'Visualizar' },
      { key: 'project_gantt.create', label: 'Criar' },
      { key: 'project_gantt.edit', label: 'Editar' },
      { key: 'project_gantt.delete', label: 'Excluir' },
      { key: 'project_gantt.update_progress', label: 'Atualizar progresso' },
    ],
  },
  {
    module: 'finance',
    label: 'Financeiro',
    permissions: [
      { key: 'finance.view', label: 'Visualizar' },
      { key: 'finance.view_executive', label: 'Executivo' },
      { key: 'finance.admin', label: 'Administrar modulo' },
      { key: 'finance.edit', label: 'Editar (geral)' },
      { key: 'finance.create_entry', label: 'Criar lancamento' },
      { key: 'finance.edit_entry', label: 'Editar lancamento' },
      { key: 'finance.delete_entry', label: 'Excluir lancamento' },
      { key: 'finance.view_dre', label: 'DRE' },
      { key: 'finance.view_budget_actual', label: 'Orcado x realizado' },
      { key: 'finance.view_forecast', label: 'Forecast' },
      { key: 'finance.view_project_costs', label: 'Custos de projeto' },
      { key: 'finance.view_margin', label: 'Margem' },
      { key: 'finance.export', label: 'Exportar' },
      { key: 'finance.approve', label: 'Aprovar' },
    ],
  },
  {
    module: 'contracts',
    label: 'Contratos',
    permissions: [
      { key: 'contracts.view', label: 'Visualizar' },
      { key: 'contracts.create', label: 'Criar' },
      { key: 'contracts.edit', label: 'Editar' },
      { key: 'contracts.delete', label: 'Excluir' },
      { key: 'contracts.upload_file', label: 'Upload' },
      { key: 'contracts.analyze_with_ai', label: 'Analisar com IA' },
      { key: 'contracts.view_values', label: 'Valores' },
      { key: 'contracts.view_penalties', label: 'Penalidades' },
      { key: 'contracts.approve', label: 'Aprovar' },
      { key: 'contracts.export', label: 'Exportar' },
    ],
  },
  {
    module: 'risks',
    label: 'Riscos',
    permissions: [
      { key: 'risks.view', label: 'Visualizar' },
      { key: 'risks.create', label: 'Criar' },
      { key: 'risks.edit', label: 'Editar' },
      { key: 'risks.delete', label: 'Excluir' },
      { key: 'risks.approve_mitigation', label: 'Aprovar mitigacao' },
      { key: 'risks.view_all', label: 'Todos' },
      { key: 'risks.view_assigned', label: 'Atribuidos' },
      { key: 'risks.export', label: 'Exportar' },
      { key: 'risks.ai_scan', label: 'Analisar com IA' },
      { key: 'risks.ai_dismiss', label: 'Descartar sugestao IA' },
    ],
  },
  {
    module: 'meetings',
    label: 'Reunioes',
    permissions: [
      { key: 'meetings.view', label: 'Visualizar' },
      { key: 'meetings.create', label: 'Criar' },
      { key: 'meetings.edit', label: 'Editar' },
      { key: 'meetings.delete', label: 'Excluir' },
      { key: 'meetings.participate', label: 'Participar' },
    ],
  },
  {
    module: 'tasks',
    label: 'Tarefas',
    permissions: [
      { key: 'tasks.view', label: 'Visualizar' },
      { key: 'tasks.create', label: 'Criar' },
      { key: 'tasks.assign', label: 'Atribuir' },
      { key: 'tasks.edit', label: 'Editar' },
      { key: 'tasks.complete', label: 'Concluir' },
      { key: 'tasks.admin', label: 'Administrar' },
    ],
  },
  {
    module: 'deliberations',
    label: 'Deliberacoes',
    permissions: [
      { key: 'deliberations.view', label: 'Visualizar' },
      { key: 'deliberations.create', label: 'Criar' },
      { key: 'deliberations.view_own', label: 'Proprias' },
      { key: 'deliberations.view_committee', label: 'Comite' },
      { key: 'deliberations.view_all', label: 'Todas' },
      { key: 'deliberations.comment', label: 'Comentar' },
      { key: 'deliberations.vote', label: 'Votar' },
      { key: 'deliberations.approve', label: 'Aprovar' },
      { key: 'deliberations.reject', label: 'Rejeitar' },
      { key: 'deliberations.close', label: 'Encerrar' },
      { key: 'deliberations.export', label: 'Exportar' },
      { key: 'deliberations.view_confidential', label: 'Confidenciais' },
    ],
  },
  {
    module: 'minutes',
    label: 'Atas',
    permissions: [
      { key: 'minutes.view', label: 'Visualizar' },
      { key: 'minutes.create', label: 'Criar' },
      { key: 'minutes.edit', label: 'Editar' },
      { key: 'minutes.approve', label: 'Aprovar' },
      { key: 'minutes.export', label: 'Exportar' },
    ],
  },
  {
    module: 'people',
    label: 'Pessoas',
    permissions: [
      { key: 'people.view', label: 'Visualizar' },
      { key: 'people.create', label: 'Criar' },
      { key: 'people.edit', label: 'Editar' },
      { key: 'people.delete', label: 'Excluir' },
      { key: 'people.view_costs', label: 'Custos' },
      { key: 'people.view_salary', label: 'Salarios' },
      { key: 'people.view_sensitive_data', label: 'Dados sensiveis' },
      { key: 'people.payroll_close', label: 'Fechamento da Folha' },
      { key: 'people.payroll_send', label: 'Enviar Folha por E-mail' },
      { key: 'people.payroll_send_sensitive', label: 'Enviar Anexos Sensiveis' },
      { key: 'people.payroll_view_sensitive', label: 'Ver Dados Sensiveis da Folha' },
      { key: 'people.payroll_bank_file_access', label: 'Acesso a Arquivos Bancarios' },
      { key: 'people.payroll_holerite_access', label: 'Acesso a Holerites' },
    ],
  },
  {
    module: 'org_chart',
    label: 'Organograma',
    permissions: [
      { key: 'org_chart.view', label: 'Visualizar' },
      { key: 'org_chart.edit', label: 'Editar' },
      { key: 'org_chart.export', label: 'Exportar' },
    ],
  },
  {
    module: 'committees',
    label: 'Comites',
    permissions: [
      { key: 'committees.view', label: 'Visualizar' },
      { key: 'committees.create', label: 'Criar' },
      { key: 'committees.edit', label: 'Editar' },
      { key: 'committees.delete', label: 'Excluir' },
      { key: 'committees.manage_members', label: 'Gerenciar membros' },
    ],
  },
  {
    module: 'audit',
    label: 'Auditoria',
    permissions: [
      { key: 'audit.view', label: 'Visualizar' },
      { key: 'audit.export', label: 'Exportar' },
    ],
  },
];

export const MODULE_ACCESS_PERMISSION: Record<string, PermissionKey> = {
  admin: 'admin.view',
  dashboard: 'dashboard.view',
  projects: 'projects.view',
  project_gantt: 'project_gantt.view',
  finance: 'finance.view',
  contracts: 'contracts.view',
  risks: 'risks.view',
  meetings: 'meetings.view',
  deliberations: 'deliberations.view',
  minutes: 'minutes.view',
  people: 'people.view',
  org_chart: 'org_chart.view',
  committees: 'committees.view',
  audit: 'audit.view',
};

export function hasPermission(userPermissions: PermissionKey[] | null | undefined, permissionKey: PermissionKey) {
  return Boolean(userPermissions?.includes(permissionKey));
}

export function hasAnyPermission(userPermissions: PermissionKey[] | null | undefined, permissionKeys: PermissionKey[]) {
  return permissionKeys.some((permissionKey) => hasPermission(userPermissions, permissionKey));
}

export function hasAllPermissions(userPermissions: PermissionKey[] | null | undefined, permissionKeys: PermissionKey[]) {
  return permissionKeys.every((permissionKey) => hasPermission(userPermissions, permissionKey));
}
