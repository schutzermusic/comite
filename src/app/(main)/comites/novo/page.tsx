'use client';
import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Save } from 'lucide-react';
import { HUDCard } from '@/components/ui/hud-card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { OrionGreenBackground } from '@/components/system/OrionGreenBackground';
import SankhyaIntegration from '@/components/features/sankhya-integration-comite';
import Link from 'next/link';

const CORES_PREDEFINIDAS = [
  { nome: 'Laranja Insight', valor: '#FF7A3D' },
  { nome: 'Verde Insight', valor: '#008751' },
  { nome: 'Azul', valor: '#3B82F6' },
  { nome: 'Roxo', valor: '#8B5CF6' },
  { nome: 'Rosa', valor: '#EC4899' },
  { nome: 'Vermelho', valor: '#EF4444' },
  { nome: 'Índigo', valor: '#6366F1' },
  { nome: 'Ciano', valor: '#06B6D4' },
];

export default function NovoComite() {
  const router = useRouter();
  const { toast } = useToast();

  const [formData, setFormData] = useState({
    nome: '',
    descricao: '',
    tipo: 'consultivo',
    status: 'ativo',
    quorum_minimo: 50,
    percentual_aprovacao: 50,
    permite_abstencao: true,
    votacao_anonima: false,
    cor: '#FF7A3D',
    sankhya_integrado: false,
    sankhya_sync_ativo: false,
    sankhya_op: '',
    sankhya_cliente: '',
  });

  const handleInputChange = (field: string, value: any) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const handleSankhyaDataUpdate = (sankhyaData: any) => {
    setFormData((prev) => ({ ...prev, ...sankhyaData }));
  };

  const handleSubmit = () => {
    if (!formData.nome || !formData.descricao) {
      toast({
        title: 'Erro de Validação',
        description: 'Preencha os campos obrigatórios (Nome e Descrição).',
        variant: 'destructive',
      });
      return;
    }

    if (formData.quorum_minimo < 1 || formData.quorum_minimo > 100) {
      toast({
        title: 'Erro de Validação',
        description: 'Quórum mínimo deve estar entre 1 e 100%.',
        variant: 'destructive',
      });
      return;
    }

    if (
      formData.percentual_aprovacao < 1 ||
      formData.percentual_aprovacao > 100
    ) {
      toast({
        title: 'Erro de Validação',
        description: 'Percentual de aprovação deve estar entre 1 e 100%.',
        variant: 'destructive',
      });
      return;
    }
    
    console.log('Creating comite:', formData);
    toast({
      title: 'Comitê criado com sucesso!',
    });
    router.push(`/comites`);
  };

  return (
    <OrionGreenBackground className="orion-page">
      <div className="orion-page-content max-w-7xl mx-auto space-y-6">
        <header className="mb-8">
          <div className="flex items-center gap-4">
            <Button
              variant="outline"
              size="icon"
              onClick={() => router.push('/comites')}
              className="border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.05)] hover:bg-[rgba(255,255,255,0.08)] text-white"
            >
              <ArrowLeft className="w-4 h-4" />
            </Button>
            <div>
              <h1 className="text-2xl font-semibold text-white mb-1 tracking-wide">Novo Comitê</h1>
              <p className="text-sm text-[rgba(255,255,255,0.65)]">
                Configure um novo comitê de governança
              </p>
            </div>
          </div>
        </header>

      <div className="grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <SankhyaIntegration
            formData={formData}
            onDataUpdate={handleSankhyaDataUpdate}
          />

          <HUDCard>
            <div className="mb-6">
              <h2 className="text-lg font-semibold text-white orion-text-heading">Informações Básicas</h2>
            </div>
            <div className="space-y-6">
              <div className="space-y-2">
                <Label htmlFor="nome" className="text-[rgba(255,255,255,0.65)]">
                  Nome do Comitê <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="nome"
                  placeholder="Ex: Comitê Executivo"
                  value={formData.nome}
                  onChange={(e) => handleInputChange('nome', e.target.value)}
                  className="bg-[rgba(255,255,255,0.05)] border-[rgba(255,255,255,0.08)] text-white placeholder:text-[rgba(255,255,255,0.40)] focus:border-[rgba(0,255,180,0.25)]"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="descricao" className="text-[rgba(255,255,255,0.65)]">
                  Descrição <span className="text-red-500">*</span>
                </Label>
                <Textarea
                  id="descricao"
                  placeholder="Descreva o propósito e responsabilidades do comitê..."
                  rows={4}
                  value={formData.descricao}
                  onChange={(e) =>
                    handleInputChange('descricao', e.target.value)
                  }
                  className="bg-[rgba(255,255,255,0.05)] border-[rgba(255,255,255,0.08)] text-white placeholder:text-[rgba(255,255,255,0.40)] focus:border-[rgba(0,255,180,0.25)]"
                />
              </div>

              <div className="grid md:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <Label htmlFor="tipo" className="text-[rgba(255,255,255,0.65)]">Tipo do Comitê</Label>
                  <Select
                    value={formData.tipo}
                    onValueChange={(value) => handleInputChange('tipo', value)}
                  >
                    <SelectTrigger className="bg-[rgba(255,255,255,0.05)] border-[rgba(255,255,255,0.08)] text-white hover:border-[rgba(0,255,180,0.25)] focus:border-[rgba(0,255,180,0.25)]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-gradient-to-br from-[#07130F] to-[#030B09] border-[rgba(255,255,255,0.08)]">
                      <SelectItem value="executivo" className="text-white focus:bg-[rgba(0,255,180,0.12)] focus:text-[#00FFB4]">Executivo</SelectItem>
                      <SelectItem value="consultivo" className="text-white focus:bg-[rgba(0,255,180,0.12)] focus:text-[#00FFB4]">Consultivo</SelectItem>
                      <SelectItem value="fiscal" className="text-white focus:bg-[rgba(0,255,180,0.12)] focus:text-[#00FFB4]">Fiscal</SelectItem>
                      <SelectItem value="estrategico" className="text-white focus:bg-[rgba(0,255,180,0.12)] focus:text-[#00FFB4]">Estratégico</SelectItem>
                      <SelectItem value="operacional" className="text-white focus:bg-[rgba(0,255,180,0.12)] focus:text-[#00FFB4]">Operacional</SelectItem>
                      <SelectItem value="especial" className="text-white focus:bg-[rgba(0,255,180,0.12)] focus:text-[#00FFB4]">Especial</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="status" className="text-[rgba(255,255,255,0.65)]">Status</Label>
                  <Select
                    value={formData.status}
                    onValueChange={(value) => handleInputChange('status', value)}
                  >
                    <SelectTrigger className="bg-[rgba(255,255,255,0.05)] border-[rgba(255,255,255,0.08)] text-white hover:border-[rgba(0,255,180,0.25)] focus:border-[rgba(0,255,180,0.25)]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-gradient-to-br from-[#07130F] to-[#030B09] border-[rgba(255,255,255,0.08)]">
                      <SelectItem value="ativo" className="text-white focus:bg-[rgba(0,255,180,0.12)] focus:text-[#00FFB4]">Ativo</SelectItem>
                      <SelectItem value="inativo" className="text-white focus:bg-[rgba(0,255,180,0.12)] focus:text-[#00FFB4]">Inativo</SelectItem>
                      <SelectItem value="suspenso" className="text-white focus:bg-[rgba(0,255,180,0.12)] focus:text-[#00FFB4]">Suspenso</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <Label className="text-[rgba(255,255,255,0.65)]">Cor de Identificação</Label>
                <div className="grid grid-cols-4 gap-3">
                  {CORES_PREDEFINIDAS.map((cor) => (
                    <button
                      key={cor.valor}
                      type="button"
                      onClick={() => handleInputChange('cor', cor.valor)}
                      className={`p-3 rounded-lg border-2 transition-all ${
                        formData.cor === cor.valor
                          ? 'border-[#00FFB4] scale-105 ring-2 ring-[#00FFB4] ring-offset-2 ring-offset-[#07130F]'
                          : 'border-[rgba(255,255,255,0.2)] hover:border-[rgba(255,255,255,0.4)]'
                      }`}
                      style={{ backgroundColor: cor.valor }}
                      title={cor.nome}
                    >
                      <div className="w-full h-8 rounded"></div>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </HUDCard>

          <HUDCard>
            <div className="mb-6">
              <h2 className="text-lg font-semibold text-white orion-text-heading">Regras de Votação</h2>
            </div>
            <div className="space-y-6">
              <div className="space-y-2">
                <Label htmlFor="quorum" className="text-[rgba(255,255,255,0.65)]">Quórum Mínimo (%)</Label>
                <p className="text-xs text-[rgba(255,255,255,0.50)] mb-2">
                  Percentual mínimo de membros que devem votar para validar a
                  votação
                </p>
                <Input
                  id="quorum"
                  type="number"
                  min="1"
                  max="100"
                  value={formData.quorum_minimo}
                  onChange={(e) =>
                    handleInputChange(
                      'quorum_minimo',
                      parseInt(e.target.value) || 0
                    )
                  }
                  className="bg-[rgba(255,255,255,0.05)] border-[rgba(255,255,255,0.08)] text-white focus:border-[rgba(0,255,180,0.25)]"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="aprovacao" className="text-[rgba(255,255,255,0.65)]">Percentual de Aprovação (%)</Label>
                <p className="text-xs text-[rgba(255,255,255,0.50)] mb-2">
                  Percentual mínimo de votos favoráveis necessários para
                  aprovação
                </p>
                <Input
                  id="aprovacao"
                  type="number"
                  min="1"
                  max="100"
                  value={formData.percentual_aprovacao}
                  onChange={(e) =>
                    handleInputChange(
                      'percentual_aprovacao',
                      parseInt(e.target.value) || 0
                    )
                  }
                  className="bg-[rgba(255,255,255,0.05)] border-[rgba(255,255,255,0.08)] text-white focus:border-[rgba(0,255,180,0.25)]"
                />
              </div>

              <div className="space-y-4 pt-4 border-t border-[rgba(255,255,255,0.08)]">
                <div className="flex items-center justify-between">
                  <div className="space-y-1">
                    <Label className="text-[rgba(255,255,255,0.65)]">Permitir Abstenção</Label>
                    <p className="text-xs text-[rgba(255,255,255,0.50)]">
                      Membros podem se abster nas votações
                    </p>
                  </div>
                  <Switch
                    checked={formData.permite_abstencao}
                    onCheckedChange={(checked) =>
                      handleInputChange('permite_abstencao', checked)
                    }
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div className="space-y-1">
                    <Label className="text-[rgba(255,255,255,0.65)]">Votação Anônima</Label>
                    <p className="text-xs text-[rgba(255,255,255,0.50)]">
                      Votos individuais não serão identificados
                    </p>
                  </div>
                  <Switch
                    checked={formData.votacao_anonima}
                    onCheckedChange={(checked) =>
                      handleInputChange('votacao_anonima', checked)
                    }
                  />
                </div>
              </div>
            </div>
          </HUDCard>
        </div>

        <div className="space-y-6">
          <HUDCard>
            <div className="mb-6">
              <h2 className="text-lg font-semibold text-white orion-text-heading">Pré-visualização</h2>
            </div>
            <div>
              <div
                className="p-4 rounded-xl border-2 mb-4"
                style={{
                  borderColor: formData.cor,
                  backgroundColor: `${formData.cor}20`,
                }}
              >
                <h3 className="font-bold text-lg mb-2 text-white">
                  {formData.nome || 'Nome do Comitê'}
                </h3>
                <p className="text-sm text-[rgba(255,255,255,0.65)] mb-3">
                  {formData.descricao || 'Descrição do comitê aparecerá aqui'}
                </p>
                <div className="flex gap-2 flex-wrap">
                  <span
                    className="text-xs px-2 py-1 rounded"
                    style={{
                      backgroundColor: formData.cor,
                      color: 'white',
                    }}
                  >
                    {formData.tipo}
                  </span>
                  <span className="text-xs px-2 py-1 rounded bg-[rgba(0,255,180,0.12)] text-[#00FFB4] border border-[rgba(0,255,180,0.25)]">
                    {formData.status}
                  </span>
                  {formData.sankhya_integrado && (
                    <span className="text-xs px-2 py-1 rounded bg-[rgba(0,200,255,0.12)] text-[#00C8FF] border border-[rgba(0,200,255,0.25)]">
                      🔗 Sankhya
                    </span>
                  )}
                </div>
              </div>

              {formData.sankhya_integrado && (
                <div className="mb-4 p-3 bg-[rgba(0,200,255,0.08)] border border-[rgba(0,200,255,0.25)] rounded-lg">
                  <p className="text-xs font-semibold text-[#00C8FF] mb-2">
                    Dados Sankhya
                  </p>
                  <div className="space-y-1 text-xs text-[rgba(255,255,255,0.65)]">
                    <p>OP: {formData.sankhya_op || 'Não informado'}</p>
                    <p>
                      Cliente: {formData.sankhya_cliente || 'Não informado'}
                    </p>
                  </div>
                </div>
              )}

              <div className="space-y-3 text-sm">
                <div className="flex justify-between py-2 border-b border-[rgba(255,255,255,0.08)]">
                  <span className="text-[rgba(255,255,255,0.65)]">Quórum</span>
                  <span className="font-semibold text-white">
                    {formData.quorum_minimo}%
                  </span>
                </div>
                <div className="flex justify-between py-2 border-b border-[rgba(255,255,255,0.08)]">
                  <span className="text-[rgba(255,255,255,0.65)]">Aprovação</span>
                  <span className="font-semibold text-white">
                    {formData.percentual_aprovacao}%
                  </span>
                </div>
                <div className="flex justify-between py-2 border-b border-[rgba(255,255,255,0.08)]">
                  <span className="text-[rgba(255,255,255,0.65)]">Abstenção</span>
                  <span className="font-semibold text-white">
                    {formData.permite_abstencao
                      ? 'Permitida'
                      : 'Não permitida'}
                  </span>
                </div>
                <div className="flex justify-between py-2">
                  <span className="text-[rgba(255,255,255,0.65)]">Votação</span>
                  <span className="font-semibold text-white">
                    {formData.votacao_anonima ? 'Anônima' : 'Identificada'}
                  </span>
                </div>
              </div>
            </div>
          </HUDCard>

          <Button
            onClick={handleSubmit}
            className="w-full bg-[#00FFB4] text-[#050D0A] hover:bg-[#00E6A0] font-medium shadow-[0_0_18px_rgba(0,255,180,0.18)]"
          >
            <Save className="w-4 h-4 mr-2" />
            Criar Comitê
          </Button>

          <Button
            variant="outline"
            onClick={() => router.push('/comites')}
            className="w-full border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.05)] text-white hover:bg-[rgba(255,255,255,0.08)]"
          >
            Cancelar
          </Button>
        </div>
      </div>
      </div>
    </OrionGreenBackground>
  );
}
