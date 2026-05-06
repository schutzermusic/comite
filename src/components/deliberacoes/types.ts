export type DeliberacaoStatus =
  | 'rascunho'
  | 'em_revisao'
  | 'em_votacao'
  | 'aguardando_ata'
  | 'em_execucao'
  | 'concluida';

export type DeliberacaoPrioridade = 'critica' | 'alta' | 'media' | 'baixa';

export type DeliberacaoRisco = 'critico' | 'alto' | 'medio' | 'baixo';

export type SlaStatus = 'on_track' | 'at_risk' | 'overdue';

export type ParecerTipo = 'juridico' | 'financeiro' | 'tecnico';
export type ParecerStatus = 'favoravel' | 'contrario' | 'com_ressalvas';

export interface Parecer {
  id: string;
  autor_nome: string;
  tipo: ParecerTipo;
  conteudo: string;
  status: ParecerStatus;
  created_at: string;
}

export type EvidenciaTipo = 'documento' | 'link' | 'relatorio';

export interface Evidencia {
  id: string;
  nome: string;
  url: string;
  tipo: EvidenciaTipo;
  uploaded_by: string;
  created_at: string;
}

export type AcaoExecucaoStatus = 'pendente' | 'em_andamento' | 'concluida';

export interface AcaoExecucao {
  id: string;
  titulo: string;
  responsavel_nome: string;
  prazo: string;
  status: AcaoExecucaoStatus;
  linked_entity_id?: string;
  linked_entity_tipo?: string;
}

export interface AuditEvent {
  id: string;
  acao: string;
  descricao: string;
  usuario_nome: string;
  timestamp: string;
}

export type ItemRelacionadoTipo = 'projeto' | 'contrato' | 'risco' | 'reuniao';

export interface ItemRelacionado {
  id: string;
  label: string;
  tipo: ItemRelacionadoTipo;
  href?: string;
}

export interface PipelineStage {
  status: DeliberacaoStatus;
  label: string;
  count: number;
  sla_state: SlaStatus | null;
}

export interface Deliberacao {
  id: string;
  titulo: string;
  descricao: string;
  contexto: string;
  decisao_solicitada: string;
  comite_id: string;
  comite_nome: string;
  comite_cor: string;
  responsavel_nome: string;
  responsavel_email: string;
  status: DeliberacaoStatus;
  prioridade: DeliberacaoPrioridade;
  risco: DeliberacaoRisco;
  sla_status: SlaStatus;
  sla_deadline: string;
  quorum_necessario: number;
  quorum_atual: number;
  votos_favor: number;
  votos_contra: number;
  votos_abstencao: number;
  proxima_acao: string;
  pareceres: Parecer[];
  evidencias: Evidencia[];
  acoes_execucao: AcaoExecucao[];
  audit_trail: AuditEvent[];
  itens_relacionados: ItemRelacionado[];
  created_at: string;
  updated_at: string;
}
