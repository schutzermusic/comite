'use client';
import React, { useState } from "react";
import { 
  Database, 
  RefreshCw, 
  CheckCircle2,
  AlertCircle,
  Loader2,
  ExternalLink
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { useToast } from "@/hooks/use-toast";
import {
  Alert,
  AlertDescription,
} from "@/components/ui/alert";

export default function SankhyaIntegration({ formData, onDataUpdate }: { formData: any, onDataUpdate: (data: any) => void }) {
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
        data_inicio: "2024-01-01",
        data_fim: "2025-12-31",
        responsavel: "Gerente de Projetos IA",
        equipe: ["Ana Silva", "Bruno Costa", "Carla Dias"],
        status: "Em Andamento"
      };

      const dadosSankhya = {
        sankhya_integrado: true,
        sankhya_op: opNumber,
        sankhya_projeto_id: response.projeto_id,
        sankhya_projeto_nome: response.projeto_nome,
        sankhya_cliente: response.cliente,
        sankhya_data_inicio: response.data_inicio,
        sankhya_data_fim: response.data_fim,
        sankhya_responsavel: response.responsavel,
        sankhya_dados_completos: response,
        sankhya_ultima_sync: new Date().toISOString(),
        nome: formData.nome || `Comitê - ${response.projeto_nome}`,
        descricao: formData.descricao || `Comitê de governança do projeto ${response.projeto_nome} para o cliente ${response.cliente}`
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
      sankhya_data_inicio: "",
      sankhya_data_fim: "",
      sankhya_responsavel: "",
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
              Importe dados automaticamente da OP do projeto
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
                Conecte com o Sankhya para importar automaticamente informações do projeto, cliente, equipe e prazos.
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
                  Digite o número da OP para importar os dados do projeto
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
                  <span className="font-semibold text-green-900">Conectado à OP: {formData.sankhya_op}</span>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={desconectar}
                  className="text-red-600 border-red-300 hover:bg-red-50"
                >
                  Desconectar
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
                  <p className="text-xs text-green-700 font-medium">Prazo</p>
                  <p className="text-sm text-green-900 font-semibold">
                    {formData.sankhya_data_inicio && new Date(formData.sankhya_data_inicio).toLocaleDateString('pt-BR')} - {formData.sankhya_data_fim && new Date(formData.sankhya_data_fim).toLocaleDateString('pt-BR')}
                  </p>
                </div>
              </div>

              {formData.sankhya_dados_completos?.equipe && (
                <div className="pt-4 border-t border-green-200">
                  <p className="text-xs text-green-700 font-medium mb-2">Equipe do Projeto</p>
                  <div className="flex flex-wrap gap-2">
                    {formData.sankhya_dados_completos.equipe.map((membro:string, index:number) => (
                      <Badge key={index} variant="outline" className="bg-white text-green-700 border-green-300">
                        {membro}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="flex items-center justify-between p-4 rounded-lg border border-blue-200 bg-blue-50">
              <div>
                <Label className="text-blue-900">Sincronização Automática</Label>
                <p className="text-xs text-blue-700 mt-1">
                  Atualizar dados automaticamente do Sankhya
                </p>
              </div>
              <Switch
                checked={formData.sankhya_sync_ativo || false}
                onCheckedChange={(checked) => onDataUpdate({ sankhya_sync_ativo: checked })}
              />
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
