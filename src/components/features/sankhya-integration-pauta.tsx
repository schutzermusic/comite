'use client';
import React, { useState } from "react";
import { 
  Database, 
  RefreshCw, 
  CheckCircle2,
  AlertCircle,
  Loader2,
  ExternalLink,
  DollarSign
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { useToast } from "@/hooks/use-toast";
import {
  Alert,
  AlertDescription,
} from "@/components/ui/alert";

export default function SankhyaIntegrationPauta({ formData, onDataUpdate }: { formData: any, onDataUpdate: (data: any) => void }) {
    const { toast } = useToast();
    const [loading, setLoading] = useState(false);
    const [connected, setConnected] = useState(formData.sankhya_integrado || false);
    const [opNumber, setOpNumber] = useState(formData.sankhya_op || "");

  const buscarDadosSankhya = async () => {
    if (!opNumber) {
      toast({ title: 'Erro', description: 'Digite o número da OP', variant: 'destructive' });
      return;
    }

    setLoading(true);
    try {
      // Usando um timeout para simular a busca de dados do Sankhya
      await new Promise(resolve => setTimeout(resolve, 1500));

      const response = {
        projeto_id: `proj-${Date.now()}`,
        projeto_nome: "Projeto de Energia Renovável Exemplo",
        cliente: "Cliente Exemplo Ltda.",
        responsavel: "Gerente de Projetos IA",
        valor_projeto: 250000,
        status: "Em andamento",
        descricao_escopo: "Este projeto visa a implementação de uma nova fase da usina fotovoltaica, aumentando a capacidade em 25MW.",
        principais_entregas: ["Instalação de 5.000 painéis", "Construção de nova subestação", "Integração com a rede elétrica nacional"]
      };

      const descricaoAuto = `${response.descricao_escopo}

**Projeto:** ${response.projeto_nome}
**Cliente:** ${response.cliente}
**Valor:** R$ ${response.valor_projeto.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}

**Principais Entregas:**
${response.principais_entregas.map((e:string, i:number) => `${i + 1}. ${e}`).join('\n')}`;


      const dadosSankhya = {
        sankhya_integrado: true,
        sankhya_op: opNumber,
        sankhya_projeto_id: response.projeto_id,
        sankhya_projeto_nome: response.projeto_nome,
        sankhya_cliente: response.cliente,
        sankhya_responsavel: response.responsavel,
        sankhya_valor_projeto: response.valor_projeto,
        sankhya_status: response.status,
        sankhya_dados_completos: response,
        titulo: formData.titulo || `Aprovação de Projeto - ${response.projeto_nome}`,
        descricao: formData.descricao || descricaoAuto,
        justificativa: formData.justificativa || `Solicitação de aprovação para execução do projeto ${response.projeto_nome} para o cliente ${response.cliente}, com valor total de R$ ${response.valor_projeto.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}.`
      };

      onDataUpdate(dadosSankhya);
      setConnected(true);
      toast({ title: 'Dados importados do Sankhya com sucesso!' });

    } catch (error) {
      console.error('Erro ao buscar dados do Sankhya:', error);
      toast({ title: 'Erro ao conectar com Sankhya', description: 'Verifique os dados e tente novamente.', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const desconectar = () => {
    onDataUpdate({
      sankhya_integrado: false,
      sankhya_op: "",
      sankhya_projeto_id: "",
      sankhya_projeto_nome: "",
      sankhya_cliente: "",
      sankhya_responsavel: "",
      sankhya_valor_projeto: null,
      sankhya_status: "",
      sankhya_dados_completos: null,
    });
    setConnected(false);
    setOpNumber("");
    toast({ title: 'Desconectado do Sankhya' });
  };

  return (
    <Card className="border-2 border-blue-200 shadow-lg">
      <CardHeader className="border-b bg-gradient-to-r from-blue-50 to-cyan-50">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-blue-500 rounded-xl">
            <Database className="w-5 h-5 text-white" />
          </div>
          <div className="flex-1">
            <CardTitle className="flex items-center gap-2">
              Integração Sankhya ERP
              {connected && (
                <Badge className="bg-green-500 text-white border-0">
                  <CheckCircle2 className="w-3 h-3 mr-1" />
                  Conectado
                </Badge>
              )}
            </CardTitle>
            <p className="text-sm text-slate-600 mt-1">
              Vincule esta pauta a uma OP do Sankhya para importar dados do projeto
            </p>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-6 space-y-6">
        {!connected ? (
          <>
            <Alert className="border-blue-200 bg-blue-50">
              <AlertCircle className="h-4 w-4 text-blue-600" />
              <AlertDescription className="text-blue-800">
                Conecte com o Sankhya para preencher automaticamente os dados da pauta com informações do projeto, cliente e valores.
              </AlertDescription>
            </Alert>

            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="op">Número da OP (Ordem de Produção)</Label>
                <div className="flex gap-2">
                  <Input
                    id="op"
                    placeholder="Ex: OP-2024-001"
                    value={opNumber}
                    onChange={(e) => setOpNumber(e.target.value)}
                    className="border-blue-200"
                    disabled={loading}
                  />
                  <Button
                    onClick={buscarDadosSankhya}
                    disabled={loading || !opNumber}
                    className="bg-blue-600 hover:bg-blue-700"
                  >
                    {loading ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <>
                        <RefreshCw className="w-4 h-4 mr-2" />
                        Buscar
                      </>
                    )}
                  </Button>
                </div>
                <p className="text-xs text-slate-500">
                  Os dados do projeto serão importados e preencherão automaticamente a pauta
                </p>
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="space-y-4 p-4 bg-green-50 rounded-lg border border-green-200">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-5 h-5 text-green-600" />
                  <span className="font-semibold text-green-900">Vinculado à OP: {formData.sankhya_op}</span>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={desconectar}
                  className="text-red-600 border-red-300 hover:bg-red-50"
                >
                  Desvincular
                </Button>
              </div>

              <div className="grid md:grid-cols-2 gap-4 pt-4 border-t border-green-200">
                <div>
                  <p className="text-xs text-green-700 font-medium">Projeto</p>
                  <p className="text-sm text-green-900 font-semibold">{formData.sankhya_projeto_nome}</p>
                </div>
                <div>
                  <p className="text-xs text-green-700 font-medium">Cliente</p>
                  <p className="text-sm text-green-900 font-semibold">{formData.sankhya_cliente}</p>
                </div>
                <div>
                  <p className="text-xs text-green-700 font-medium">Responsável</p>
                  <p className="text-sm text-green-900 font-semibold">{formData.sankhya_responsavel}</p>
                </div>
                <div>
                  <p className="text-xs text-green-700 font-medium">Status</p>
                  <Badge variant="outline" className="bg-white text-green-700 border-green-300">
                    {formData.sankhya_status}
                  </Badge>
                </div>
              </div>

              <div className="pt-4 border-t border-green-200">
                <div className="flex items-center gap-3 p-3 bg-white rounded-lg border border-green-200">
                  <div className="p-2 bg-green-100 rounded-lg">
                    <DollarSign className="w-5 h-5 text-green-600" />
                  </div>
                  <div>
                    <p className="text-xs text-green-700 font-medium">Valor do Projeto</p>
                    <p className="text-lg font-bold text-green-900">
                      R$ {formData.sankhya_valor_projeto?.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                    </p>
                  </div>
                </div>
              </div>

              {formData.sankhya_dados_completos?.principais_entregas && (
                <div className="pt-4 border-t border-green-200">
                  <p className="text-xs text-green-700 font-medium mb-2">Principais Entregas</p>
                  <div className="space-y-1">
                    {formData.sankhya_dados_completos.principais_entregas.map((entrega: string, index: number) => (
                      <div key={index} className="flex items-start gap-2 text-sm text-green-800">
                        <CheckCircle2 className="w-4 h-4 text-green-600 mt-0.5 flex-shrink-0" />
                        <span>{entrega}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <Button
              variant="outline"
              onClick={buscarDadosSankhya}
              disabled={loading}
              className="w-full border-blue-300 hover:bg-blue-50"
            >
              {loading ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <RefreshCw className="w-4 h-4 mr-2" />
              )}
              Atualizar Dados do Sankhya
            </Button>
          </>
        )}

        <div className="pt-4 border-t">
          <a 
            href="https://sankhya.com.br" 
            target="_blank" 
            rel="noopener noreferrer"
            className="text-xs text-blue-600 hover:text-blue-700 flex items-center gap-1"
          >
            <ExternalLink className="w-3 h-3" />
            Acessar Sankhya ERP
          </a>
        </div>
      </CardContent>
    </Card>
  );
}