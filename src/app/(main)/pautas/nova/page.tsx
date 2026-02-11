'use client';
import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Upload, X, Save, Send, FileText, Eye, EyeOff } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
import { projects as comites } from '@/lib/mock-data'; // Using projects as mock comites
import Link from 'next/link';
import SankhyaIntegrationPauta from '@/components/features/sankhya-integration-pauta';

export default function NovaPautaPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [isUploading, setIsUploading] = useState(false);

  const [formData, setFormData] = useState({
    titulo: '',
    descricao: '',
    justificativa: '',
    categoria: 'outra',
    prioridade: 'media',
    data_votacao_inicio: '',
    data_votacao_fim: '',
    arquivo_anexo_url: '',
    arquivo_anexo_nome: '',
    status: 'rascunho',
    votos_sigilosos: false,
    comite_id: '',
    comite_nome: '',
    sankhya_integrado: false,
    sankhya_op: '',
  });

  const handleInputChange = (field: string, value: any) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };
  
  const handleSankhyaDataUpdate = (sankhyaData: any) => {
    setFormData((prev) => ({ ...prev, ...sankhyaData }));
  };

  const handleComiteChange = (comiteId: string) => {
    const comite = comites.find((c) => c.id === comiteId);
    setFormData((prev) => ({
      ...prev,
      comite_id: comiteId === 'none' ? '' : comiteId,
      comite_nome: comite?.nome || '',
    }));
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    // Mock upload
    setTimeout(() => {
      handleInputChange('arquivo_anexo_url', 'https://example.com/mock.pdf');
      handleInputChange('arquivo_anexo_nome', file.name);
      toast({ title: 'Arquivo anexado com sucesso!' });
      setIsUploading(false);
    }, 1500);
  };

  const removeFile = () => {
    handleInputChange('arquivo_anexo_url', '');
    handleInputChange('arquivo_anexo_nome', '');
  };

  const handleSubmit = (status: 'rascunho' | 'aberta') => {
    if (!formData.titulo || !formData.descricao) {
      toast({
        title: 'Erro de Validação',
        description: 'Preencha os campos obrigatórios (Título e Descrição).',
        variant: 'destructive',
      });
      return;
    }

    // Mock mutation
    console.log('Submitting pauta:', { ...formData, status });
    toast({
      title: 'Pauta enviada com sucesso!',
      description: `A pauta "${formData.titulo}" foi salva como ${status}.`,
    });
    router.push('/pautas');
  };

  return (
    <div className="p-6 lg:p-8 max-w-4xl mx-auto space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/pautas" passHref>
          <Button
            variant="outline"
            size="icon"
            className="border-orange-300 hover:bg-orange-50"
          >
            <ArrowLeft className="w-4 h-4" style={{ color: '#FF7A3D' }} />
          </Button>
        </Link>
        <div>
          <h1 className="text-3xl font-bold text-slate-900">Nova Pauta</h1>
          <p className="text-slate-600">
            Crie uma nova pauta para votação do comitê
          </p>
        </div>
      </div>
      
      <SankhyaIntegrationPauta formData={formData} onDataUpdate={handleSankhyaDataUpdate} />

      <Card className="border-orange-100 shadow-lg">
        <CardHeader
          className="border-b"
          style={{
            background: 'linear-gradient(90deg, #FFF5F0 0%, #F0FFF5 100%)',
          }}
        >
          <CardTitle>Informações da Pauta</CardTitle>
        </CardHeader>
        <CardContent className="p-6 space-y-6">
          {comites.length > 0 && (
            <div className="space-y-2">
              <Label htmlFor="comite">Comitê (opcional)</Label>
              <Select
                value={formData.comite_id}
                onValueChange={handleComiteChange}
              >
                <SelectTrigger className="border-orange-200">
                  <SelectValue placeholder="Selecione um comitê" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Nenhum comitê</SelectItem>
                  {comites.map((comite) => (
                    <SelectItem key={comite.id} value={comite.id}>
                      {comite.nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-slate-500">
                Se não selecionar um comitê, a pauta será geral para todos os
                membros
              </p>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="titulo">
              Título da Pauta <span className="text-red-500">*</span>
            </Label>
            <Input
              id="titulo"
              placeholder="Digite o título da pauta"
              value={formData.titulo}
              onChange={(e) => handleInputChange('titulo', e.target.value)}
              className="border-orange-200"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="descricao">
              Descrição <span className="text-red-500">*</span>
            </Label>
            <Textarea
              id="descricao"
              placeholder="Descreva a pauta em detalhes..."
              rows={8}
              value={formData.descricao}
              onChange={(e) => handleInputChange('descricao', e.target.value)}
              className="border-orange-200"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="justificativa">Justificativa</Label>
            <Textarea
              id="justificativa"
              placeholder="Justifique a necessidade desta pauta..."
              rows={3}
              value={formData.justificativa}
              onChange={(e) =>
                handleInputChange('justificativa', e.target.value)
              }
              className="border-orange-200"
            />
          </div>

          <div className="grid md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <Label htmlFor="categoria">Categoria</Label>
              <Select
                value={formData.categoria}
                onValueChange={(value) => handleInputChange('categoria', value)}
              >
                <SelectTrigger className="border-orange-200">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="estrategica">Estratégica</SelectItem>
                  <SelectItem value="financeira">Financeira</SelectItem>
                  <SelectItem value="operacional">Operacional</SelectItem>
                  <SelectItem value="rh">RH</SelectItem>
                  <SelectItem value="juridica">Jurídica</SelectItem>
                  <SelectItem value="ti">TI</SelectItem>
                  <SelectItem value="outra">Outra</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="prioridade">Prioridade</Label>
              <Select
                value={formData.prioridade}
                onValueChange={(value) =>
                  handleInputChange('prioridade', value)
                }
              >
                <SelectTrigger className="border-orange-200">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="baixa">Baixa</SelectItem>
                  <SelectItem value="media">Média</SelectItem>
                  <SelectItem value="alta">Alta</SelectItem>
                  <SelectItem value="urgente">Urgente</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <Label htmlFor="data_inicio">Data de Início da Votação</Label>
              <Input
                id="data_inicio"
                type="datetime-local"
                value={formData.data_votacao_inicio}
                onChange={(e) =>
                  handleInputChange('data_votacao_inicio', e.target.value)
                }
                className="border-orange-200"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="data_fim">Data de Fim da Votação</Label>
              <Input
                id="data_fim"
                type="datetime-local"
                value={formData.data_votacao_fim}
                onChange={(e) =>
                  handleInputChange('data_votacao_fim', e.target.value)
                }
                className="border-orange-200"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Arquivo Anexo</Label>
            {!formData.arquivo_anexo_url ? (
              <div className="border-2 border-dashed border-orange-200 rounded-lg p-6 text-center hover:border-orange-400 transition-colors">
                <input
                  type="file"
                  onChange={handleFileUpload}
                  className="hidden"
                  id="file-upload"
                  accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx"
                  disabled={isUploading}
                />
                <label
                  htmlFor="file-upload"
                  className={isUploading ? 'cursor-wait' : 'cursor-pointer'}
                >
                  <Upload className="w-8 h-8 mx-auto mb-2 text-orange-500" />
                  <p className="text-sm text-slate-600">
                    {isUploading ? 'Enviando...' : 'Clique para anexar um arquivo'}
                  </p>
                  <p className="text-xs text-slate-500 mt-1">
                    PDF, DOC, XLS, PPT
                  </p>
                </label>
              </div>
            ) : (
              <div className="flex items-center justify-between p-4 border border-orange-200 rounded-lg bg-orange-50">
                <div className="flex items-center gap-3">
                  <FileText className="w-5 h-5 text-orange-600" />
                  <div>
                    <p className="text-sm font-medium">
                      {formData.arquivo_anexo_nome}
                    </p>
                    <a
                      href={formData.arquivo_anexo_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-orange-600 hover:underline"
                    >
                      Visualizar arquivo
                    </a>
                  </div>
                </div>
                <Button variant="ghost" size="icon" onClick={removeFile}>
                  <X className="w-4 h-4" />
                </Button>
              </div>
            )}
          </div>

          <div className="pt-6 border-t">
            <div className="flex items-center justify-between p-4 rounded-lg border border-orange-200 bg-gradient-to-r from-orange-50 to-amber-50">
              <div className="flex items-center gap-3">
                {formData.votos_sigilosos ? (
                  <EyeOff className="w-5 h-5 text-amber-600" />
                ) : (
                  <Eye className="w-5 h-5 text-slate-500" />
                )}
                <div>
                  <Label htmlFor="votos-sigilosos" className="cursor-pointer">
                    Votos Sigilosos
                  </Label>
                  <p className="text-xs text-slate-600">
                    {formData.votos_sigilosos
                      ? 'Os nomes dos votantes não serão exibidos publicamente'
                      : 'Os nomes dos votantes serão visíveis para todos'}
                  </p>
                </div>
              </div>
              <Switch
                id="votos-sigilosos"
                checked={formData.votos_sigilosos}
                onCheckedChange={(checked) =>
                  handleInputChange('votos_sigilosos', checked)
                }
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="flex gap-3 justify-end">
        <Link href="/pautas" passHref>
          <Button
            variant="outline"
            className="border-orange-300 hover:bg-orange-50"
          >
            Cancelar
          </Button>
        </Link>
        <Button
          variant="outline"
          onClick={() => handleSubmit('rascunho')}
          className="border-orange-300 hover:bg-orange-50"
        >
          <Save className="w-4 h-4 mr-2" />
          Salvar Rascunho
        </Button>
        <Button
          onClick={() => handleSubmit('aberta')}
          style={{
            background: 'linear-gradient(135deg, #FF7A3D 0%, #E6662A 100%)',
          }}
        >
          <Send className="w-4 h-4 mr-2" />
          Publicar Pauta
        </Button>
      </div>
    </div>
  );
}
