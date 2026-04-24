'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Save, Briefcase, FolderPlus } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { projects, users } from '@/lib/mock-data';
import { createProject } from '@/lib/services/projects';
import { Project } from '@/lib/types';

// HUD-based components — theme-aware
import {
  HudPageLayout,
  HudHeader,
  HudPanel,
  HudButton,
} from '@/components/hud';

const comites = projects
  .map((p) => ({ id: p.comite_id, nome: p.comite_nome }))
  .filter((v, i, a) => a.findIndex((t) => t.id === v.id) === i)
  .filter((c) => c.id && c.nome) as { id: string; nome: string }[];

export default function NovoProjetoPage() {
  const router = useRouter();
  const { toast } = useToast();

  const [formData, setFormData] = useState({
    nome: '',
    codigo: '',
    cliente: '',
    descricao: '',
    status: 'planejamento' as const,
    comite_id: '',
    comite_nome: '',
    responsavel_id: '',
    impacto_financeiro: 'medio' as const,
    valor_total: '',
    valor_executado: '',
    data_inicio: '',
    tipo: '',
    risco_geral: 'medio' as const,
    roi_estimado: '',
  });

  const handleInputChange = (field: string, value: any) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const handleComiteChange = (comiteId: string) => {
    const comite = comites && Array.isArray(comites) ? comites.find((c) => c.id === comiteId) : undefined;
    setFormData((prev) => ({
      ...prev,
      comite_id: comiteId === 'none' ? '' : comiteId,
      comite_nome: comite?.nome || '',
    }));
  };

  const handleSubmit = async () => {
    // Validações
    if (!formData.nome || !formData.codigo) {
      toast({
        title: 'Erro de Validação',
        description: 'Preencha os campos obrigatórios (Nome e OP do Projeto).',
        variant: 'destructive',
      });
      return;
    }

    if (formData.valor_total && isNaN(Number(formData.valor_total))) {
      toast({
        title: 'Erro de Validação',
        description: 'Valor total deve ser um número válido.',
        variant: 'destructive',
      });
      return;
    }

    if (formData.valor_executado && isNaN(Number(formData.valor_executado))) {
      toast({
        title: 'Erro de Validação',
        description: 'Valor executado deve ser um número válido.',
        variant: 'destructive',
      });
      return;
    }

    try {
      // Buscar responsável
      const responsavel = users.find(u => u.id === formData.responsavel_id) || users[0];

      // Calcular progresso se houver valores
      const valorTotal = Number(formData.valor_total) || 0;
      const valorExecutado = Number(formData.valor_executado) || 0;
      const progresso = valorTotal > 0 
        ? Math.round((valorExecutado / valorTotal) * 100) 
        : 0;

      // Criar objeto do projeto
      const projetoData: Omit<Project, 'id'> = {
        nome: formData.nome,
        codigo: formData.codigo,
        cliente: formData.cliente || undefined,
        descricao: formData.descricao || undefined,
        status: formData.status,
        comite_id: formData.comite_id || undefined,
        comite_nome: formData.comite_nome || undefined,
        comite_status: 'ativo',
        responsavel,
        impacto_financeiro: formData.impacto_financeiro,
        valor_total: valorTotal,
        valor_executado: valorExecutado,
        progresso_percentual: progresso,
        data_inicio: formData.data_inicio || undefined,
        tipo: formData.tipo || undefined,
        risco_geral: formData.risco_geral,
        roi_estimado: formData.roi_estimado ? Number(formData.roi_estimado) : undefined,
        codigoInterno: formData.codigo,
        comiteResponsavel: formData.comite_nome || '',
      };

      // Salvar projeto
      await createProject(projetoData);

      toast({
        title: 'Projeto criado com sucesso!',
        description: `O projeto "${formData.nome}" foi criado.`,
      });
      
      router.push('/projetos');
    } catch (error) {
      toast({
        title: 'Erro ao criar projeto',
        description: error instanceof Error ? error.message : 'Ocorreu um erro inesperado',
        variant: 'destructive',
      });
    }
  };

  return (
    <HudPageLayout maxWidth="xl">
      {/* Header */}
      <HudHeader
        title="Novo Projeto"
        subtitle="Crie um novo projeto no portfólio de governança"
        icon={<FolderPlus className="w-5 h-5" />}
        breadcrumbs={[
          { label: 'Projetos', href: '/projetos' },
          { label: 'Novo Projeto' },
        ]}
        actions={
          <HudButton
            variant="ghost"
            size="md"
            leftIcon={<ArrowLeft className="w-4 h-4" />}
            onClick={() => router.push('/projetos')}
          >
            Voltar
          </HudButton>
        }
      />

      <div className="grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          {/* ── Informações Básicas ── */}
          <HudPanel title="Informações Básicas" accentColor="emerald">
            <div className="space-y-5">
              <div className="grid md:grid-cols-2 gap-5">
                <div className="novo-projeto-field">
                  <label htmlFor="nome" className="novo-projeto-label">
                    Nome do Projeto <span className="novo-projeto-required">*</span>
                  </label>
                  <input
                    id="nome"
                    type="text"
                    placeholder="Ex: Expansão da Planta Solar"
                    value={formData.nome}
                    onChange={(e) => handleInputChange('nome', e.target.value)}
                    className="novo-projeto-input"
                  />
                </div>

                <div className="novo-projeto-field">
                  <label htmlFor="codigo" className="novo-projeto-label">
                    OP do Projeto <span className="novo-projeto-required">*</span>
                  </label>
                  <input
                    id="codigo"
                    type="text"
                    placeholder="Ex: OP-12345"
                    value={formData.codigo}
                    onChange={(e) => handleInputChange('codigo', e.target.value)}
                    className="novo-projeto-input"
                  />
                </div>
              </div>

              <div className="novo-projeto-field">
                <label htmlFor="cliente" className="novo-projeto-label">Cliente</label>
                <input
                  id="cliente"
                  type="text"
                  placeholder="Nome do cliente ou 'Interno'"
                  value={formData.cliente}
                  onChange={(e) => handleInputChange('cliente', e.target.value)}
                  className="novo-projeto-input"
                />
              </div>

              <div className="novo-projeto-field">
                <label htmlFor="descricao" className="novo-projeto-label">Descrição</label>
                <textarea
                  id="descricao"
                  placeholder="Descreva o projeto em detalhes..."
                  rows={4}
                  value={formData.descricao}
                  onChange={(e) => handleInputChange('descricao', e.target.value)}
                  className="novo-projeto-input novo-projeto-textarea"
                />
              </div>

              <div className="grid md:grid-cols-2 gap-5">
                <div className="novo-projeto-field">
                  <label htmlFor="tipo" className="novo-projeto-label">Tipo de Projeto</label>
                  <select
                    id="tipo"
                    value={formData.tipo}
                    onChange={(e) => handleInputChange('tipo', e.target.value)}
                    className="novo-projeto-input novo-projeto-select"
                  >
                    <option value="">Selecione o tipo</option>
                    <option value="energia_solar">Energia Solar</option>
                    <option value="eolica">Eólica</option>
                    <option value="hidreletrica">Hidrelétrica</option>
                    <option value="biomassa">Biomassa</option>
                    <option value="outro">Outro</option>
                  </select>
                </div>

                <div className="novo-projeto-field">
                  <label htmlFor="data_inicio" className="novo-projeto-label">Data de Início</label>
                  <input
                    id="data_inicio"
                    type="date"
                    value={formData.data_inicio}
                    onChange={(e) => handleInputChange('data_inicio', e.target.value)}
                    className="novo-projeto-input"
                  />
                </div>
              </div>
            </div>
          </HudPanel>

          {/* ── Status e Supervisão ── */}
          <HudPanel title="Status e Supervisão" accentColor="cyan">
            <div className="space-y-5">
              <div className="grid md:grid-cols-2 gap-5">
                <div className="novo-projeto-field">
                  <label htmlFor="status" className="novo-projeto-label">Status</label>
                  <select
                    id="status"
                    value={formData.status}
                    onChange={(e) => handleInputChange('status', e.target.value)}
                    className="novo-projeto-input novo-projeto-select"
                  >
                    <option value="planejamento">Planejamento</option>
                    <option value="em_andamento">Em Andamento</option>
                    <option value="pausado">Pausado</option>
                    <option value="concluido">Concluído</option>
                    <option value="cancelado">Cancelado</option>
                  </select>
                </div>

                {comites.length > 0 && (
                  <div className="novo-projeto-field">
                    <label htmlFor="comite" className="novo-projeto-label">Comitê Supervisor (Opcional)</label>
                    <select
                      id="comite"
                      value={formData.comite_id || 'none'}
                      onChange={(e) => handleComiteChange(e.target.value)}
                      className="novo-projeto-input novo-projeto-select"
                    >
                      <option value="none">Sem supervisão</option>
                      {comites && Array.isArray(comites) && comites.map((comite) => (
                        <option key={comite.id} value={comite.id}>
                          {comite.nome}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>

              <div className="novo-projeto-field">
                <label htmlFor="responsavel" className="novo-projeto-label">Responsável</label>
                <select
                  id="responsavel"
                  value={formData.responsavel_id}
                  onChange={(e) => handleInputChange('responsavel_id', e.target.value)}
                  className="novo-projeto-input novo-projeto-select"
                >
                  <option value="">Selecione o responsável</option>
                  {users && Array.isArray(users) && users.map((user) => (
                    <option key={user.id} value={user.id}>
                      {user.nome} ({user.email})
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </HudPanel>

          {/* ── Informações Financeiras ── */}
          <HudPanel title="Informações Financeiras" accentColor="amber">
            <div className="space-y-5">
              <div className="grid md:grid-cols-2 gap-5">
                <div className="novo-projeto-field">
                  <label htmlFor="valor_total" className="novo-projeto-label">Valor Total (R$)</label>
                  <input
                    id="valor_total"
                    type="number"
                    placeholder="0"
                    value={formData.valor_total}
                    onChange={(e) => handleInputChange('valor_total', e.target.value)}
                    className="novo-projeto-input"
                  />
                </div>

                <div className="novo-projeto-field">
                  <label htmlFor="valor_executado" className="novo-projeto-label">Valor Executado (R$)</label>
                  <input
                    id="valor_executado"
                    type="number"
                    placeholder="0"
                    value={formData.valor_executado}
                    onChange={(e) => handleInputChange('valor_executado', e.target.value)}
                    className="novo-projeto-input"
                  />
                </div>
              </div>

              <div className="grid md:grid-cols-2 gap-5">
                <div className="novo-projeto-field">
                  <label htmlFor="impacto_financeiro" className="novo-projeto-label">Impacto Financeiro</label>
                  <select
                    id="impacto_financeiro"
                    value={formData.impacto_financeiro}
                    onChange={(e) => handleInputChange('impacto_financeiro', e.target.value)}
                    className="novo-projeto-input novo-projeto-select"
                  >
                    <option value="baixo">Baixo</option>
                    <option value="medio">Médio</option>
                    <option value="alto">Alto</option>
                    <option value="critico">Crítico</option>
                  </select>
                </div>

                <div className="novo-projeto-field">
                  <label htmlFor="roi_estimado" className="novo-projeto-label">ROI Estimado (%)</label>
                  <input
                    id="roi_estimado"
                    type="number"
                    placeholder="0"
                    value={formData.roi_estimado}
                    onChange={(e) => handleInputChange('roi_estimado', e.target.value)}
                    className="novo-projeto-input"
                  />
                </div>
              </div>

              <div className="novo-projeto-field">
                <label htmlFor="risco_geral" className="novo-projeto-label">Risco Geral</label>
                <select
                  id="risco_geral"
                  value={formData.risco_geral}
                  onChange={(e) => handleInputChange('risco_geral', e.target.value)}
                  className="novo-projeto-input novo-projeto-select"
                >
                  <option value="baixo">Baixo</option>
                  <option value="medio">Médio</option>
                  <option value="alto">Alto</option>
                  <option value="critico">Crítico</option>
                </select>
              </div>
            </div>
          </HudPanel>
        </div>

        {/* ── Sidebar — Resumo ── */}
        <div className="space-y-6">
          <HudPanel title="Resumo" accentColor="emerald">
            <div className="space-y-4">
              <div className="novo-projeto-summary-item">
                <span className="novo-projeto-summary-label">Nome</span>
                <span className="novo-projeto-summary-value">{formData.nome || 'Não informado'}</span>
              </div>

              <div className="novo-projeto-summary-item">
                <span className="novo-projeto-summary-label">OP</span>
                <span className="novo-projeto-summary-value">{formData.codigo || 'Não informado'}</span>
              </div>

              <div className="novo-projeto-summary-item">
                <span className="novo-projeto-summary-label">Status</span>
                <span className="novo-projeto-summary-value capitalize">{formData.status.replace(/_/g, ' ')}</span>
              </div>

              {formData.comite_nome && (
                <div className="novo-projeto-summary-item">
                  <span className="novo-projeto-summary-label">Comitê Supervisor</span>
                  <span className="novo-projeto-summary-value">{formData.comite_nome}</span>
                </div>
              )}

              {formData.valor_total && (
                <div className="novo-projeto-summary-item">
                  <span className="novo-projeto-summary-label">Valor Total</span>
                  <span className="novo-projeto-summary-value">
                    {new Intl.NumberFormat('pt-BR', {
                      style: 'currency',
                      currency: 'BRL',
                    }).format(Number(formData.valor_total))}
                  </span>
                </div>
              )}

              <div className="novo-projeto-summary-item">
                <span className="novo-projeto-summary-label">Impacto</span>
                <span className="novo-projeto-summary-value capitalize">{formData.impacto_financeiro}</span>
              </div>
            </div>
          </HudPanel>

          <div className="space-y-3">
            <HudButton
              variant="primary"
              size="lg"
              fullWidth
              leftIcon={<Save className="w-4 h-4" />}
              onClick={handleSubmit}
            >
              Criar Projeto
            </HudButton>

            <HudButton
              variant="secondary"
              size="lg"
              fullWidth
              onClick={() => router.push('/projetos')}
            >
              Cancelar
            </HudButton>
          </div>
        </div>
      </div>
    </HudPageLayout>
  );
}
