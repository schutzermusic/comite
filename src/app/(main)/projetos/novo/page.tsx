'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Save, Briefcase, DollarSign, Calendar, AlertTriangle } from 'lucide-react';
import { HUDCard } from '@/components/ui/hud-card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { OrionGreenBackground } from '@/components/system/OrionGreenBackground';
import { projects, users } from '@/lib/mock-data';
import { createProject } from '@/lib/services/projects';
import { Project } from '@/lib/types';
import Link from 'next/link';

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
    <OrionGreenBackground className="orion-page">
      <div className="orion-page-content max-w-5xl mx-auto space-y-6">
        <header className="mb-8">
          <div className="flex items-center gap-4">
            <Button
              variant="outline"
              size="icon"
              onClick={() => router.push('/projetos')}
              className="border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.05)] hover:bg-[rgba(255,255,255,0.08)] text-white"
            >
              <ArrowLeft className="w-4 h-4" />
            </Button>
            <div>
              <h1 className="text-2xl font-semibold text-white mb-1 tracking-wide">Novo Projeto</h1>
              <p className="text-sm text-[rgba(255,255,255,0.65)]">
                Crie um novo projeto no portfólio
              </p>
            </div>
          </div>
        </header>

      <div className="grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          {/* Informações Básicas */}
          <HUDCard>
            <div className="mb-6">
              <h2 className="text-lg font-semibold text-white orion-text-heading">Informações Básicas</h2>
            </div>
            <div className="space-y-6">
              <div className="grid md:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <Label htmlFor="nome" className="text-[rgba(255,255,255,0.65)]">
                    Nome do Projeto <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    id="nome"
                    placeholder="Ex: Expansão da Planta Solar"
                    value={formData.nome}
                    onChange={(e) => handleInputChange('nome', e.target.value)}
                    className="bg-[rgba(255,255,255,0.05)] border-[rgba(255,255,255,0.08)] text-white placeholder:text-[rgba(255,255,255,0.40)] focus:border-[rgba(0,255,180,0.25)]"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="codigo" className="text-[rgba(255,255,255,0.65)]">
                    OP do Projeto <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    id="codigo"
                    placeholder="Ex: OP-12345"
                    value={formData.codigo}
                    onChange={(e) => handleInputChange('codigo', e.target.value)}
                    className="bg-[rgba(255,255,255,0.05)] border-[rgba(255,255,255,0.08)] text-white placeholder:text-[rgba(255,255,255,0.40)] focus:border-[rgba(0,255,180,0.25)]"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="cliente" className="text-[rgba(255,255,255,0.65)]">Cliente</Label>
                <Input
                  id="cliente"
                  placeholder="Nome do cliente ou 'Interno'"
                  value={formData.cliente}
                  onChange={(e) => handleInputChange('cliente', e.target.value)}
                  className="bg-[rgba(255,255,255,0.05)] border-[rgba(255,255,255,0.08)] text-white placeholder:text-[rgba(255,255,255,0.40)] focus:border-[rgba(0,255,180,0.25)]"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="descricao" className="text-[rgba(255,255,255,0.65)]">Descrição</Label>
                <Textarea
                  id="descricao"
                  placeholder="Descreva o projeto em detalhes..."
                  rows={4}
                  value={formData.descricao}
                  onChange={(e) => handleInputChange('descricao', e.target.value)}
                  className="bg-[rgba(255,255,255,0.05)] border-[rgba(255,255,255,0.08)] text-white placeholder:text-[rgba(255,255,255,0.40)] focus:border-[rgba(0,255,180,0.25)]"
                />
              </div>

              <div className="grid md:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <Label htmlFor="tipo" className="text-[rgba(255,255,255,0.65)]">Tipo de Projeto</Label>
                  <Select
                    value={formData.tipo}
                    onValueChange={(value) => handleInputChange('tipo', value)}
                  >
                    <SelectTrigger className="bg-[rgba(255,255,255,0.05)] border-[rgba(255,255,255,0.08)] text-white hover:border-[rgba(0,255,180,0.25)] focus:border-[rgba(0,255,180,0.25)]">
                      <SelectValue placeholder="Selecione o tipo" />
                    </SelectTrigger>
                    <SelectContent className="bg-gradient-to-br from-[#07130F] to-[#030B09] border-[rgba(255,255,255,0.08)]">
                      <SelectItem value="energia_solar" className="text-white focus:bg-[rgba(0,255,180,0.12)] focus:text-[#00FFB4]">Energia Solar</SelectItem>
                      <SelectItem value="eolica" className="text-white focus:bg-[rgba(0,255,180,0.12)] focus:text-[#00FFB4]">Eólica</SelectItem>
                      <SelectItem value="hidreletrica" className="text-white focus:bg-[rgba(0,255,180,0.12)] focus:text-[#00FFB4]">Hidrelétrica</SelectItem>
                      <SelectItem value="biomassa" className="text-white focus:bg-[rgba(0,255,180,0.12)] focus:text-[#00FFB4]">Biomassa</SelectItem>
                      <SelectItem value="outro" className="text-white focus:bg-[rgba(0,255,180,0.12)] focus:text-[#00FFB4]">Outro</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="data_inicio" className="text-[rgba(255,255,255,0.65)]">Data de Início</Label>
                  <Input
                    id="data_inicio"
                    type="date"
                    value={formData.data_inicio}
                    onChange={(e) => handleInputChange('data_inicio', e.target.value)}
                    className="bg-[rgba(255,255,255,0.05)] border-[rgba(255,255,255,0.08)] text-white focus:border-[rgba(0,255,180,0.25)]"
                  />
                </div>
              </div>
            </div>
          </HUDCard>

          {/* Status e Supervisão */}
          <HUDCard>
            <div className="mb-6">
              <h2 className="text-lg font-semibold text-white orion-text-heading">Status e Supervisão</h2>
            </div>
            <div className="space-y-6">
              <div className="grid md:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <Label htmlFor="status" className="text-[rgba(255,255,255,0.65)]">Status</Label>
                  <Select
                    value={formData.status}
                    onValueChange={(value: any) => handleInputChange('status', value)}
                  >
                    <SelectTrigger className="bg-[rgba(255,255,255,0.05)] border-[rgba(255,255,255,0.08)] text-white hover:border-[rgba(0,255,180,0.25)] focus:border-[rgba(0,255,180,0.25)]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-gradient-to-br from-[#07130F] to-[#030B09] border-[rgba(255,255,255,0.08)]">
                      <SelectItem value="planejamento" className="text-white focus:bg-[rgba(0,255,180,0.12)] focus:text-[#00FFB4]">Planejamento</SelectItem>
                      <SelectItem value="em_andamento" className="text-white focus:bg-[rgba(0,255,180,0.12)] focus:text-[#00FFB4]">Em Andamento</SelectItem>
                      <SelectItem value="pausado" className="text-white focus:bg-[rgba(0,255,180,0.12)] focus:text-[#00FFB4]">Pausado</SelectItem>
                      <SelectItem value="concluido" className="text-white focus:bg-[rgba(0,255,180,0.12)] focus:text-[#00FFB4]">Concluído</SelectItem>
                      <SelectItem value="cancelado" className="text-white focus:bg-[rgba(0,255,180,0.12)] focus:text-[#00FFB4]">Cancelado</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {comites.length > 0 && (
                  <div className="space-y-2">
                    <Label htmlFor="comite" className="text-[rgba(255,255,255,0.65)]">Comitê Supervisor (Opcional)</Label>
                    <Select
                      value={formData.comite_id || 'none'}
                      onValueChange={handleComiteChange}
                    >
                      <SelectTrigger className="bg-[rgba(255,255,255,0.05)] border-[rgba(255,255,255,0.08)] text-white hover:border-[rgba(0,255,180,0.25)] focus:border-[rgba(0,255,180,0.25)]">
                        <SelectValue placeholder="Selecione um comitê" />
                      </SelectTrigger>
                      <SelectContent className="bg-gradient-to-br from-[#07130F] to-[#030B09] border-[rgba(255,255,255,0.08)]">
                        <SelectItem value="none" className="text-white focus:bg-[rgba(0,255,180,0.12)] focus:text-[#00FFB4]">Sem supervisão</SelectItem>
                        {comites && Array.isArray(comites) && comites.map((comite) => (
                          <SelectItem key={comite.id} value={comite.id} className="text-white focus:bg-[rgba(0,255,180,0.12)] focus:text-[#00FFB4]">
                            {comite.nome}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="responsavel" className="text-[rgba(255,255,255,0.65)]">Responsável</Label>
                <Select
                  value={formData.responsavel_id}
                  onValueChange={(value) => handleInputChange('responsavel_id', value)}
                >
                  <SelectTrigger className="bg-[rgba(255,255,255,0.05)] border-[rgba(255,255,255,0.08)] text-white hover:border-[rgba(0,255,180,0.25)] focus:border-[rgba(0,255,180,0.25)]">
                    <SelectValue placeholder="Selecione o responsável" />
                  </SelectTrigger>
                  <SelectContent className="bg-gradient-to-br from-[#07130F] to-[#030B09] border-[rgba(255,255,255,0.08)]">
                    {users && Array.isArray(users) && users.map((user) => (
                      <SelectItem key={user.id} value={user.id} className="text-white focus:bg-[rgba(0,255,180,0.12)] focus:text-[#00FFB4]">
                        {user.nome} ({user.email})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </HUDCard>

          {/* Informações Financeiras */}
          <HUDCard>
            <div className="mb-6">
              <h2 className="text-lg font-semibold text-white orion-text-heading">Informações Financeiras</h2>
            </div>
            <div className="space-y-6">
              <div className="grid md:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <Label htmlFor="valor_total" className="text-[rgba(255,255,255,0.65)]">Valor Total (R$)</Label>
                  <Input
                    id="valor_total"
                    type="number"
                    placeholder="0"
                    value={formData.valor_total}
                    onChange={(e) => handleInputChange('valor_total', e.target.value)}
                    className="bg-[rgba(255,255,255,0.05)] border-[rgba(255,255,255,0.08)] text-white hover:border-[rgba(0,255,180,0.25)] focus:border-[rgba(0,255,180,0.25)]"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="valor_executado" className="text-[rgba(255,255,255,0.65)]">Valor Executado (R$)</Label>
                  <Input
                    id="valor_executado"
                    type="number"
                    placeholder="0"
                    value={formData.valor_executado}
                    onChange={(e) => handleInputChange('valor_executado', e.target.value)}
                    className="bg-[rgba(255,255,255,0.05)] border-[rgba(255,255,255,0.08)] text-white hover:border-[rgba(0,255,180,0.25)] focus:border-[rgba(0,255,180,0.25)]"
                  />
                </div>
              </div>

              <div className="grid md:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <Label htmlFor="impacto_financeiro" className="text-[rgba(255,255,255,0.65)]">Impacto Financeiro</Label>
                  <Select
                    value={formData.impacto_financeiro}
                    onValueChange={(value: any) => handleInputChange('impacto_financeiro', value)}
                  >
                    <SelectTrigger className="bg-[rgba(255,255,255,0.05)] border-[rgba(255,255,255,0.08)] text-white hover:border-[rgba(0,255,180,0.25)] focus:border-[rgba(0,255,180,0.25)]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-gradient-to-br from-[#07130F] to-[#030B09] border-[rgba(255,255,255,0.08)]">
                      <SelectItem value="baixo" className="text-white focus:bg-[rgba(0,255,180,0.12)] focus:text-[#00FFB4]">Baixo</SelectItem>
                      <SelectItem value="medio" className="text-white focus:bg-[rgba(0,255,180,0.12)] focus:text-[#00FFB4]">Médio</SelectItem>
                      <SelectItem value="alto" className="text-white focus:bg-[rgba(0,255,180,0.12)] focus:text-[#00FFB4]">Alto</SelectItem>
                      <SelectItem value="critico" className="text-white focus:bg-[rgba(0,255,180,0.12)] focus:text-[#00FFB4]">Crítico</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="roi_estimado" className="text-[rgba(255,255,255,0.65)]">ROI Estimado (%)</Label>
                  <Input
                    id="roi_estimado"
                    type="number"
                    placeholder="0"
                    value={formData.roi_estimado}
                    onChange={(e) => handleInputChange('roi_estimado', e.target.value)}
                    className="bg-[rgba(255,255,255,0.05)] border-[rgba(255,255,255,0.08)] text-white hover:border-[rgba(0,255,180,0.25)] focus:border-[rgba(0,255,180,0.25)]"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="risco_geral" className="text-[rgba(255,255,255,0.65)]">Risco Geral</Label>
                <Select
                  value={formData.risco_geral}
                  onValueChange={(value: any) => handleInputChange('risco_geral', value)}
                >
                  <SelectTrigger className="bg-[rgba(255,255,255,0.05)] border-[rgba(255,255,255,0.08)] text-white hover:border-[rgba(0,255,180,0.25)] focus:border-[rgba(0,255,180,0.25)]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="baixo">Baixo</SelectItem>
                    <SelectItem value="medio">Médio</SelectItem>
                    <SelectItem value="alto">Alto</SelectItem>
                    <SelectItem value="critico">Crítico</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </HUDCard>
        </div>

        {/* Sidebar - Resumo */}
        <div className="space-y-6">
          <HUDCard>
            <div className="mb-6">
              <h2 className="text-lg font-semibold text-white orion-text-heading">Resumo</h2>
            </div>
            <div>
              <div className="space-y-4">
                <div>
                  <p className="text-sm text-[rgba(255,255,255,0.65)] mb-1">Nome</p>
                  <p className="font-medium text-white">{formData.nome || 'Não informado'}</p>
                </div>

                <div>
                  <p className="text-sm text-[rgba(255,255,255,0.65)] mb-1">OP</p>
                  <p className="font-medium text-white">{formData.codigo || 'Não informado'}</p>
                </div>

                <div>
                  <p className="text-sm text-[rgba(255,255,255,0.65)] mb-1">Status</p>
                  <p className="font-medium text-white capitalize">{formData.status}</p>
                </div>

                {formData.comite_nome && (
                  <div>
                    <p className="text-sm text-[rgba(255,255,255,0.65)] mb-1">Comitê Supervisor</p>
                    <p className="font-medium text-white">{formData.comite_nome}</p>
                  </div>
                )}

                {formData.valor_total && (
                  <div>
                    <p className="text-sm text-[rgba(255,255,255,0.65)] mb-1">Valor Total</p>
                    <p className="font-medium text-white">
                      {new Intl.NumberFormat('pt-BR', {
                        style: 'currency',
                        currency: 'BRL',
                      }).format(Number(formData.valor_total))}
                    </p>
                  </div>
                )}

                <div>
                  <p className="text-sm text-[rgba(255,255,255,0.65)] mb-1">Impacto</p>
                  <p className="font-medium text-white capitalize">{formData.impacto_financeiro}</p>
                </div>
              </div>
            </div>
          </HUDCard>

          <div className="space-y-3">
            <Button
              onClick={handleSubmit}
              className="w-full bg-[#00FFB4] text-[#050D0A] hover:bg-[#00E6A0] font-medium shadow-[0_0_18px_rgba(0,255,180,0.18)]"
            >
              <Save className="w-4 h-4 mr-2" />
              Criar Projeto
            </Button>

            <Button
              variant="outline"
              onClick={() => router.push('/projetos')}
              className="w-full border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.05)] text-white hover:bg-[rgba(255,255,255,0.08)]"
            >
              Cancelar
            </Button>
          </div>
        </div>
        </div>
      </div>
    </OrionGreenBackground>
  );
}

