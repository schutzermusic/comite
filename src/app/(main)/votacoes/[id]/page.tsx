
'use client';
import React, { useState, use } from 'react';
import { useRouter } from 'next/navigation';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import {
  ArrowLeft,
  ThumbsUp,
  ThumbsDown,
  MinusCircle,
  Calendar,
  Clock,
  FileText,
  Edit,
  Trash2,
  CheckCircle2,
  EyeOff,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Progress } from '@/components/ui/progress';
import { HUDCard } from '@/components/ui/hud-card';
import { StatusPill } from '@/components/ui/status-pill';
import { HUDProgressBar } from '@/components/ui/hud-progress-bar';
import { OrionGreenBackground } from '@/components/system/OrionGreenBackground';
import { useToast } from '@/hooks/use-toast';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { votes, users } from '@/lib/mock-data';
import Link from 'next/link';

export default function DetalhePautaPage({ params }: { params: Promise<{ id: string }> }) {
  const router = useRouter();
  const { toast } = useToast();
  const { id } = use(params);
  
  const pauta = votes.find((v) => v.id === id) || votes[1];
  
  // Mocking detailed data based on the vote
  const detailedPauta = {
    ...pauta,
    descricao: "Deliberação sobre a aprovação do novo ciclo de investimentos para o projeto de expansão da planta solar, incluindo CAPEX e cronograma.",
    justificativa: "A necessidade de expansão se deve ao aumento da demanda energética na região e à meta de ampliar nossa capacidade de geração de energia limpa em 20%.",
    categoria: "Estratégica",
    prioridade: "Alta",
    data_votacao_inicio: new Date(new Date(pauta.prazoFim).setDate(new Date(pauta.prazoFim).getDate() - 7)),
    created_date: new Date(new Date(pauta.prazoFim).setDate(new Date(pauta.prazoFim).getDate() - 14)),
    arquivo_anexo_url: "https://example.com/document.pdf",
    arquivo_anexo_nome: "Proposta_Investimento_Planta_Solar.pdf",
    votos_sigilosos: id === 'vote-02',
    votos_favor: 12,
    votos_contra: 3,
    abstencoes: 2,
    total_votos: 17,
    resultado: pauta.status === 'encerrada' ? 'aprovado' : 'pendente',
    created_by: 'alice@insight.com',
  };

  const [votoSelecionado, setVotoSelecionado] = useState<string | null>(null);
  const [comentario, setComentario] = useState("");
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

  // Mock user
  const user = users[0];
  const meuVoto = undefined; // Mock: user hasn't voted yet

  const getStatusVariant = (status: string): "neutral" | "warning" | "success" => {
    if (status === 'encerrada') return 'success';
    if (status === 'em_andamento') return 'warning';
    return 'neutral';
  };

  const calcularPercentual = (tipo: 'favor' | 'contra' | 'abstencao') => {
    const total = detailedPauta.total_votos || 0;
    if (total === 0) return 0;
    
    let valor = 0;
    if (tipo === 'favor') valor = detailedPauta.votos_favor || 0;
    if (tipo === 'contra') valor = detailedPauta.votos_contra || 0;
    if (tipo === 'abstencao') valor = detailedPauta.abstencoes || 0;
    
    return Math.round((valor / total) * 100);
  };
  
  const podeVotar = detailedPauta.status === 'em_andamento' && !meuVoto;
  const podeEditar = (detailedPauta.status === 'nao_iniciada') && user?.email === detailedPauta.created_by;

  const handleVote = () => {
    if (!votoSelecionado) {
      toast({ title: "Selecione uma opção de voto.", variant: 'destructive' });
      return;
    }
    toast({ title: "Voto registrado com sucesso!" });
    // Here you would typically handle the mutation
  };

  const handleDelete = () => {
    toast({ title: "Pauta excluída com sucesso!" });
    router.push('/pautas');
  };
  
  const getUserInitials = (name: string) => {
    if (!name) return "U";
    return name.split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2);
  };

  return (
    <OrionGreenBackground className="orion-page">
      <div className="orion-page-content max-w-6xl mx-auto space-y-6">
        <header className="mb-8">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Button
                variant="outline"
                size="icon"
                onClick={() => router.push("/pautas")}
                className="border-[rgba(0,255,180,0.25)] text-[rgba(255,255,255,0.92)] hover:bg-[rgba(0,255,180,0.12)]"
              >
                <ArrowLeft className="w-4 h-4" />
              </Button>
              <div>
                <h1 className="text-2xl font-semibold text-white tracking-wide">Detalhes da Pauta</h1>
              </div>
            </div>
            {podeEditar && (
              <div className="flex gap-2">
                <Button variant="outline" size="icon" className="border-[rgba(0,255,180,0.25)] text-[rgba(255,255,255,0.92)] hover:bg-[rgba(0,255,180,0.12)]">
                  <Edit className="w-4 h-4" />
                </Button>
                <Button 
                  variant="outline" 
                  size="icon"
                  onClick={() => setShowDeleteDialog(true)}
                  className="border-[rgba(255,88,96,0.25)] text-[#FF5860] hover:bg-[rgba(255,88,96,0.12)]"
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            )}
          </div>
        </header>

        <div className="grid lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            <HUDCard>
              <div className="space-y-6">
                <div>
                  <h2 className="text-xl font-semibold text-white mb-3 tracking-wide">{detailedPauta.titulo}</h2>
                  <div className="flex flex-wrap gap-2 mb-4">
                    <StatusPill variant={getStatusVariant(detailedPauta.status)}>
                      {detailedPauta.status.replace('_', ' ')}
                    </StatusPill>
                    <StatusPill variant="neutral">{detailedPauta.categoria}</StatusPill>
                    <StatusPill variant="warning">{detailedPauta.prioridade}</StatusPill>
                    {detailedPauta.comite && (
                      <StatusPill variant="info">{detailedPauta.comite}</StatusPill>
                    )}
                    {detailedPauta.votos_sigilosos && (
                      <StatusPill variant="warning">
                        <EyeOff className="w-3 h-3 mr-1 inline" />
                        Votos Sigilosos
                      </StatusPill>
                    )}
                  </div>
                </div>

                <div>
                  <h3 className="text-sm font-medium text-white mb-2 uppercase tracking-wide">Descrição</h3>
                  <p className="text-[rgba(255,255,255,0.65)] whitespace-pre-wrap">{detailedPauta.descricao}</p>
                </div>

                {detailedPauta.justificativa && (
                  <div>
                    <h3 className="text-sm font-medium text-white mb-2 uppercase tracking-wide">Justificativa</h3>
                    <p className="text-[rgba(255,255,255,0.65)] whitespace-pre-wrap">{detailedPauta.justificativa}</p>
                  </div>
                )}

                {detailedPauta.arquivo_anexo_url && (
                  <div>
                    <h3 className="text-sm font-medium text-white mb-2 uppercase tracking-wide">Arquivo Anexo</h3>
                    <a
                      href={detailedPauta.arquivo_anexo_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-3 p-4 border border-[rgba(0,255,180,0.25)] rounded-lg hover:bg-[rgba(0,255,180,0.12)] transition-colors"
                    >
                      <FileText className="w-5 h-5 text-[#00FFB4]" />
                      <span className="text-sm font-medium text-white">{detailedPauta.arquivo_anexo_nome}</span>
                    </a>
                  </div>
                )}

                <div className="flex gap-6 text-sm text-[rgba(255,255,255,0.65)] pt-4 border-t border-[rgba(255,255,255,0.05)]">
                  <div className="flex items-center gap-2">
                    <Calendar className="w-4 h-4" />
                    <span>Criada em {format(new Date(detailedPauta.created_date), "dd 'de' MMMM, yyyy", { locale: ptBR })}</span>
                  </div>
                  {detailedPauta.data_votacao_inicio && (
                    <div className="flex items-center gap-2">
                      <Clock className="w-4 h-4" />
                      <span>Votação: {format(new Date(detailedPauta.data_votacao_inicio), "dd/MM/yyyy HH:mm")}</span>
                    </div>
                  )}
                </div>
              </div>
            </HUDCard>

            {podeVotar && (
              <HUDCard glow glowColor="green">
                <div className="space-y-4">
                  <div>
                    <h3 className="text-base font-semibold text-white mb-2">Registrar Voto</h3>
                    {detailedPauta.votos_sigilosos && (
                      <p className="text-sm text-[#FFB04D] flex items-center gap-2">
                        <EyeOff className="w-4 h-4" />
                        Seu voto será registrado de forma sigilosa
                      </p>
                    )}
                  </div>
                  <div className="grid grid-cols-3 gap-4">
                    <button
                      onClick={() => setVotoSelecionado('favor')}
                      className={`p-6 border-2 rounded-xl transition-all ${
                        votoSelecionado === 'favor'
                          ? 'border-[#00FFB4] bg-[rgba(0,255,180,0.12)]'
                          : 'border-[rgba(255,255,255,0.08)] hover:border-[rgba(0,255,180,0.25)]'
                      }`}
                    >
                      <ThumbsUp className={`w-8 h-8 mx-auto mb-2 ${
                        votoSelecionado === 'favor' ? 'text-[#00FFB4]' : 'text-[rgba(255,255,255,0.40)]'
                      }`} />
                      <p className="font-semibold text-center text-white">A Favor</p>
                    </button>

                    <button
                      onClick={() => setVotoSelecionado('contra')}
                      className={`p-6 border-2 rounded-xl transition-all ${
                        votoSelecionado === 'contra'
                          ? 'border-[#FF5860] bg-[rgba(255,88,96,0.12)]'
                          : 'border-[rgba(255,255,255,0.08)] hover:border-[rgba(255,88,96,0.25)]'
                      }`}
                    >
                      <ThumbsDown className={`w-8 h-8 mx-auto mb-2 ${
                        votoSelecionado === 'contra' ? 'text-[#FF5860]' : 'text-[rgba(255,255,255,0.40)]'
                      }`} />
                      <p className="font-semibold text-center text-white">Contra</p>
                    </button>

                    <button
                      onClick={() => setVotoSelecionado('abstencao')}
                      className={`p-6 border-2 rounded-xl transition-all ${
                        votoSelecionado === 'abstencao'
                          ? 'border-[rgba(255,255,255,0.25)] bg-[rgba(255,255,255,0.08)]'
                          : 'border-[rgba(255,255,255,0.08)] hover:border-[rgba(255,255,255,0.15)]'
                      }`}
                    >
                      <MinusCircle className={`w-8 h-8 mx-auto mb-2 ${
                        votoSelecionado === 'abstencao' ? 'text-white' : 'text-[rgba(255,255,255,0.40)]'
                      }`} />
                      <p className="font-semibold text-center text-white">Abstenção</p>
                    </button>
                  </div>

                  <div className="space-y-2">
                    <Label className="text-white">Comentário (opcional)</Label>
                    <Textarea
                      placeholder="Adicione um comentário sobre seu voto..."
                      rows={3}
                      value={comentario}
                      onChange={(e) => setComentario(e.target.value)}
                      className="bg-[rgba(255,255,255,0.05)] border-[rgba(255,255,255,0.08)] text-white placeholder:text-[rgba(255,255,255,0.40)] focus:border-[rgba(0,255,180,0.25)]"
                    />
                  </div>

                  <Button
                    onClick={handleVote}
                    disabled={!votoSelecionado}
                    className="w-full bg-[#00FFB4] text-[#050D0A] hover:bg-[#00E6A0] font-medium shadow-[0_0_18px_rgba(0,255,180,0.18)]"
                  >
                    Confirmar Voto
                  </Button>
                </div>
              </HUDCard>
            )}

            {meuVoto && (
              <HUDCard glow glowColor="green">
                <div className="flex items-center gap-3">
                  <CheckCircle2 className="w-6 h-6 text-[#00FFB4]" />
                  <div>
                    <h3 className="font-semibold text-white">Você já votou nesta pauta</h3>
                    <p className="text-sm text-[rgba(255,255,255,0.65)]">
                      Seu voto: <span className="font-medium text-white">{(meuVoto as any).voto || 'Registrado'}</span>
                    </p>
                  </div>
                </div>
              </HUDCard>
            )}

          {!detailedPauta.votos_sigilosos && detailedPauta.status === 'encerrada' && (
            <Card className="border-orange-100 shadow-lg">
              <CardHeader className="border-b" style={{ background: 'linear-gradient(90deg, #FFF5F0 0%, #F0FFF5 100%)' }}>
                <CardTitle>Detalhamento dos Votos</CardTitle>
              </CardHeader>
              <CardContent className="p-6">
                <div className="space-y-3">
                  {users.slice(0,3).map((voter) => (
                    <div key={voter.id} className="flex items-start gap-3 p-4 border border-slate-200 rounded-lg">
                      <Avatar className="w-10 h-10">
                        <AvatarFallback 
                          className="font-semibold text-white"
                          style={{ background: 'linear-gradient(135deg, #FF7A3D 0%, #008751 100%)' }}
                        >
                          {getUserInitials(voter.nome)}
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <p className="font-medium">{voter.nome}</p>
                          <Badge variant="outline" className='bg-green-50 text-green-700'>
                            favor
                          </Badge>
                        </div>
                        <p className="text-sm text-slate-600">Concordo com a proposta, alinhada com as metas de longo prazo.</p>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

        </div>

        <div className="space-y-6">
          <Card className="border-orange-100 shadow-lg">
            <CardHeader className="border-b" style={{ background: 'linear-gradient(90deg, #FFF5F0 0%, #F0FFF5 100%)' }}>
              <CardTitle>Resultado da Votação</CardTitle>
            </CardHeader>
            <CardContent className="p-6 space-y-6">
              <div className="text-center">
                <p className="text-4xl font-bold text-slate-900">{detailedPauta.total_votos || 0}</p>
                <p className="text-sm text-slate-600">Total de votos</p>
              </div>

              <div className="space-y-4">
                <div>
                  <div className="flex justify-between items-center mb-2">
                    <span className="text-sm font-medium flex items-center gap-2">
                      <ThumbsUp className="w-4 h-4 text-green-600" />
                      A Favor
                    </span>
                    <span className="text-sm font-bold">{detailedPauta.votos_favor || 0} ({calcularPercentual('favor')}%)</span>
                  </div>
                  <Progress value={calcularPercentual('favor')} className="h-2 [&>div]:bg-green-500" />
                </div>

                <div>
                  <div className="flex justify-between items-center mb-2">
                    <span className="text-sm font-medium flex items-center gap-2">
                      <ThumbsDown className="w-4 h-4 text-red-600" />
                      Contra
                    </span>
                    <span className="text-sm font-bold">{detailedPauta.votos_contra || 0} ({calcularPercentual('contra')}%)</span>
                  </div>
                  <Progress value={calcularPercentual('contra')} className="h-2 [&>div]:bg-red-500" />
                </div>

                <div>
                  <div className="flex justify-between items-center mb-2">
                    <span className="text-sm font-medium flex items-center gap-2">
                      <MinusCircle className="w-4 h-4 text-slate-500" />
                      Abstenções
                    </span>
                    <span className="text-sm font-bold">{detailedPauta.abstencoes || 0} ({calcularPercentual('abstencao')}%)</span>
                  </div>
                  <Progress value={calcularPercentual('abstencao')} className="h-2 [&>div]:bg-slate-400" />
                </div>
              </div>

              {detailedPauta.resultado !== 'pendente' && (
                <div className={`p-4 rounded-xl text-center ${
                  detailedPauta.resultado === 'aprovado' ? 'bg-green-100 border border-green-300' :
                  'bg-red-100 border border-red-300'
                }`}>
                  <p className="font-bold text-lg">
                    {detailedPauta.resultado === 'aprovado' ? '✓ Aprovado' : '✗ Reprovado'}
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir Pauta</AlertDialogTitle>
            <AlertDialogDescription>
              Tem certeza que deseja excluir esta pauta? Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-red-600 hover:bg-red-700"
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      </div>
    </OrionGreenBackground>
  );
}

    