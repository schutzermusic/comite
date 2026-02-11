'use client';

import React, { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Save, Send, Clock, MapPin, Video, Users as UsersIcon } from "lucide-react";
import { HUDCard } from "@/components/ui/hud-card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { OrionGreenBackground } from "@/components/system/OrionGreenBackground";
import { projects as comites, votes as pautas, users } from "@/lib/mock-data";

export default function NovaReuniaoPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [sendingEmails, setSendingEmails] = useState(false);
  const [isClient, setIsClient] = useState(false);

  useEffect(() => {
    setIsClient(true);
  }, []);

  const [formData, setFormData] = useState({
    titulo: "",
    descricao: "",
    comite_id: "",
    comite_nome: "",
    data_hora: "",
    duracao_minutos: 60,
    local: "",
    tipo_reuniao: "virtual",
    status: "agendada",
    pautas_ids: [] as string[],
    participantes_emails: [] as string[],
    participantes_nomes: [] as string[]
  });

  const handleInputChange = (field: string, value: any) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const handleComiteChange = (comiteId: string) => {
    const comite = comites && Array.isArray(comites) ? comites.find(c => c.id === comiteId) : undefined;
    setFormData(prev => ({
      ...prev,
      comite_id: comiteId === 'none' ? '' : comiteId,
      comite_nome: comite?.nome || "",
      participantes_emails: [],
      participantes_nomes: []
    }));
  };

  const toggleParticipante = (email: string, nome: string) => {
    setFormData(prev => {
      const isSelected = prev.participantes_emails.includes(email);
      if (isSelected) {
        return {
          ...prev,
          participantes_emails: prev.participantes_emails.filter(e => e !== email),
          participantes_nomes: prev.participantes_nomes.filter(n => n !== nome)
        };
      } else {
        return {
          ...prev,
          participantes_emails: [...prev.participantes_emails, email],
          participantes_nomes: [...prev.participantes_nomes, nome]
        };
      }
    });
  };

  const togglePauta = (pautaId: string) => {
    setFormData(prev => {
      const isSelected = prev.pautas_ids.includes(pautaId);
      if (isSelected) {
        return {
          ...prev,
          pautas_ids: prev.pautas_ids.filter(id => id !== pautaId)
        };
      } else {
        return {
          ...prev,
          pautas_ids: [...prev.pautas_ids, pautaId]
        };
      }
    });
  };

  const handleSubmit = (enviarConvites = false) => {
    if (!formData.titulo || !formData.data_hora) {
      toast({title: "Erro", description: "Preencha os campos obrigatórios (Título, Data e Hora).", variant: "destructive"});
      return;
    }

    if (formData.participantes_emails.length === 0) {
      toast({title: "Erro", description: "Adicione pelo menos um participante.", variant: "destructive"});
      return;
    }

    if (enviarConvites) {
        setSendingEmails(true);
        setTimeout(() => {
            setSendingEmails(false);
            toast({ title: "Reunião agendada e convites enviados!"});
            router.push("/reunioes");
        }, 1500)
    } else {
        toast({ title: "Reunião salva com sucesso!"});
        router.push("/reunioes");
    }
  };
  
  const availableParticipants = useMemo(() => {
    if (!users || !Array.isArray(users)) return [];
    if(formData.comite_id) {
        return users.filter(u => u.papelPrincipal === 'membroComite' || u.papelPrincipal === 'gerenteProjeto').map(m => ({ email: m.email || '', nome: m.nome || '' }))
    }
    return users.map(u => ({ email: u.email || '', nome: u.nome || '' }));
  }, [formData.comite_id]);

  return (
    <OrionGreenBackground className="orion-page">
      <div className="orion-page-content max-w-5xl mx-auto space-y-6">
        <header className="mb-8">
          <div className="flex items-center gap-4">
            <Button
              variant="outline"
              size="icon"
              onClick={() => router.push("/reunioes")}
              className="border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.05)] hover:bg-[rgba(255,255,255,0.08)] text-white"
            >
              <ArrowLeft className="w-4 h-4" />
            </Button>
            <div>
              <h1 className="text-2xl font-semibold text-white mb-1 tracking-wide">Nova Reunião</h1>
              <p className="text-sm text-[rgba(255,255,255,0.65)]">Agende uma reunião do comitê</p>
            </div>
          </div>
        </header>

      <div className="grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <HUDCard>
            <div className="mb-6">
              <h2 className="text-lg font-semibold text-white orion-text-heading">Informações da Reunião</h2>
            </div>
            <div className="space-y-6">
              {comites && comites.length > 0 && (
                <div className="space-y-2">
                  <Label htmlFor="comite" className="text-[rgba(255,255,255,0.65)]">Comitê (opcional)</Label>
                  <Select value={formData.comite_id || 'none'} onValueChange={handleComiteChange}>
                    <SelectTrigger className="bg-[rgba(255,255,255,0.05)] border-[rgba(255,255,255,0.08)] text-white hover:border-[rgba(0,255,180,0.25)] focus:border-[rgba(0,255,180,0.25)]">
                      <SelectValue placeholder="Selecione um comitê" />
                    </SelectTrigger>
                    <SelectContent className="bg-gradient-to-br from-[#07130F] to-[#030B09] border-[rgba(255,255,255,0.08)]">
                      <SelectItem value="none" className="text-white focus:bg-[rgba(0,255,180,0.12)] focus:text-[#00FFB4]">Nenhum comitê específico</SelectItem>
                      {comites && Array.isArray(comites) && comites.map((comite) => (
                        <SelectItem key={comite.id} value={comite.id} className="text-white focus:bg-[rgba(0,255,180,0.12)] focus:text-[#00FFB4]">
                          {comite.nome}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="titulo" className="text-[rgba(255,255,255,0.65)]">
                  Título da Reunião <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="titulo"
                  placeholder="Ex: Reunião Mensal do Comitê"
                  value={formData.titulo}
                  onChange={(e) => handleInputChange('titulo', e.target.value)}
                  className="bg-[rgba(255,255,255,0.05)] border-[rgba(255,255,255,0.08)] text-white placeholder:text-[rgba(255,255,255,0.40)] focus:border-[rgba(0,255,180,0.25)]"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="descricao" className="text-[rgba(255,255,255,0.65)]">Descrição e Objetivos</Label>
                <Textarea
                  id="descricao"
                  placeholder="Descreva os objetivos e tópicos da reunião..."
                  rows={3}
                  value={formData.descricao}
                  onChange={(e) => handleInputChange('descricao', e.target.value)}
                  className="bg-[rgba(255,255,255,0.05)] border-[rgba(255,255,255,0.08)] text-white placeholder:text-[rgba(255,255,255,0.40)] focus:border-[rgba(0,255,180,0.25)]"
                />
              </div>

              <div className="grid md:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <Label htmlFor="data_hora" className="text-[rgba(255,255,255,0.65)]">
                    Data e Hora <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    id="data_hora"
                    type="datetime-local"
                    value={formData.data_hora}
                    onChange={(e) => handleInputChange('data_hora', e.target.value)}
                    className="bg-[rgba(255,255,255,0.05)] border-[rgba(255,255,255,0.08)] text-white focus:border-[rgba(0,255,180,0.25)]"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="duracao" className="text-[rgba(255,255,255,0.65)]">Duração (minutos)</Label>
                  <Input
                    id="duracao"
                    type="number"
                    min="15"
                    step="15"
                    value={formData.duracao_minutos}
                    onChange={(e) => handleInputChange('duracao_minutos', parseInt(e.target.value) || 60)}
                    className="bg-[rgba(255,255,255,0.05)] border-[rgba(255,255,255,0.08)] text-white focus:border-[rgba(0,255,180,0.25)]"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="tipo" className="text-[rgba(255,255,255,0.65)]">Tipo de Reunião</Label>
                <Select
                  value={formData.tipo_reuniao}
                  onValueChange={(value) => handleInputChange('tipo_reuniao', value)}
                >
                  <SelectTrigger className="bg-[rgba(255,255,255,0.05)] border-[rgba(255,255,255,0.08)] text-white hover:border-[rgba(0,255,180,0.25)] focus:border-[rgba(0,255,180,0.25)]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-gradient-to-br from-[#07130F] to-[#030B09] border-[rgba(255,255,255,0.08)]">
                    <SelectItem value="presencial" className="text-white focus:bg-[rgba(0,255,180,0.12)] focus:text-[#00FFB4]">
                      <div className="flex items-center gap-2">
                        <MapPin className="w-4 h-4" />
                        <span>Presencial</span>
                      </div>
                    </SelectItem>
                    <SelectItem value="virtual" className="text-white focus:bg-[rgba(0,255,180,0.12)] focus:text-[#00FFB4]">
                      <div className="flex items-center gap-2">
                        <Video className="w-4 h-4" />
                        <span>Virtual</span>
                      </div>
                    </SelectItem>
                    <SelectItem value="hibrida" className="text-white focus:bg-[rgba(0,255,180,0.12)] focus:text-[#00FFB4]">
                      <div className="flex items-center gap-2">
                        <UsersIcon className="w-4 h-4" />
                        <span>Híbrida</span>
                      </div>
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="local" className="text-[rgba(255,255,255,0.65)]">Local / Link da Reunião</Label>
                <Input
                  id="local"
                  placeholder={
                    formData.tipo_reuniao === 'virtual'
                      ? 'Cole o link da videoconferência...'
                      : 'Sala de reuniões, endereço...'
                  }
                  value={formData.local}
                  onChange={(e) => handleInputChange('local', e.target.value)}
                  className="bg-[rgba(255,255,255,0.05)] border-[rgba(255,255,255,0.08)] text-white placeholder:text-[rgba(255,255,255,0.40)] focus:border-[rgba(0,255,180,0.25)]"
                />
              </div>
            </div>
          </HUDCard>

          <HUDCard>
            <div className="mb-6">
              <h2 className="text-lg font-semibold text-white orion-text-heading">Participantes</h2>
            </div>
            <div>
              <div className="space-y-3 max-h-64 overflow-y-auto">
                {isClient && availableParticipants.map((participant) => (
                  <div
                    key={participant.email}
                    className="flex items-center space-x-3 p-3 rounded-lg hover:bg-[rgba(255,255,255,0.05)] transition-colors border border-[rgba(255,255,255,0.05)] mb-2"
                  >
                    <Checkbox
                      checked={formData.participantes_emails.includes(participant.email)}
                      onCheckedChange={() => toggleParticipante(participant.email, participant.nome)}
                      id={`participant-${participant.email}`}
                      className="border-[rgba(255,255,255,0.2)] data-[state=checked]:bg-[#00FFB4] data-[state=checked]:border-[#00FFB4]"
                    />
                    <Label htmlFor={`participant-${participant.email}`} className="flex-1 cursor-pointer text-white">
                      <p className="font-medium text-sm">{participant.nome}</p>
                      <p className="text-xs text-[rgba(255,255,255,0.50)]">{participant.email}</p>
                    </Label>
                  </div>
                ))}
              </div>
              <p className="text-sm text-[rgba(255,255,255,0.65)] mt-4">
                {formData.participantes_emails.length} participante(s) selecionado(s)
              </p>
            </div>
          </HUDCard>
        </div>

        <div className="space-y-6">
          <HUDCard>
            <div className="mb-6">
              <h2 className="text-lg font-semibold text-white orion-text-heading">Pautas da Reunião</h2>
            </div>
            <div>
                  {pautas && Array.isArray(pautas) && pautas.length > 0 ? (
                <div className="space-y-3 max-h-80 overflow-y-auto">
                  {pautas.map((pauta) => (
                    <div
                      key={pauta.id}
                      className="flex items-start space-x-3 p-3 rounded-lg hover:bg-[rgba(255,255,255,0.05)] transition-colors border border-[rgba(255,255,255,0.05)] mb-2"
                    >
                      <Checkbox
                        checked={formData.pautas_ids.includes(pauta.id)}
                        onCheckedChange={() => togglePauta(pauta.id)}
                        id={`pauta-${pauta.id}`}
                        className="border-[rgba(255,255,255,0.2)] data-[state=checked]:bg-[#00FFB4] data-[state=checked]:border-[#00FFB4]"
                      />
                      <Label htmlFor={`pauta-${pauta.id}`} className="flex-1 cursor-pointer text-white">
                        <p className="font-medium text-sm line-clamp-2">{pauta.titulo}</p>
                        <Badge variant="outline" className="mt-1 text-xs bg-[rgba(255,255,255,0.05)] text-[rgba(255,255,255,0.65)] border-[rgba(255,255,255,0.12)]">
                          {pauta.comite}
                        </Badge>
                      </Label>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8">
                  <p className="text-sm text-[rgba(255,255,255,0.50)]">Nenhuma pauta disponível</p>
                </div>
              )}
            </div>
          </HUDCard>

          <HUDCard>
            <div className="mb-6">
              <h2 className="text-lg font-semibold text-white orion-text-heading">Resumo</h2>
            </div>
            <div className="space-y-3 text-sm">
              <div className="flex justify-between py-2 border-b border-[rgba(255,255,255,0.08)]">
                <span className="text-[rgba(255,255,255,0.65)]">Participantes</span>
                <span className="font-semibold text-white">{formData.participantes_emails.length}</span>
              </div>
              <div className="flex justify-between py-2 border-b border-[rgba(255,255,255,0.08)]">
                <span className="text-[rgba(255,255,255,0.65)]">Pautas</span>
                <span className="font-semibold text-white">{formData.pautas_ids.length}</span>
              </div>
              <div className="flex justify-between py-2">
                <span className="text-[rgba(255,255,255,0.65)]">Duração</span>
                <span className="font-semibold text-white">{formData.duracao_minutos} min</span>
              </div>
            </div>
          </HUDCard>

          <div className="space-y-3">
            <Button
              onClick={() => handleSubmit(true)}
              disabled={sendingEmails}
              className="w-full bg-[#00FFB4] text-[#050D0A] hover:bg-[#00E6A0] font-medium shadow-[0_0_18px_rgba(0,255,180,0.18)]"
            >
              {sendingEmails ? (
                <>
                  <Clock className="w-4 h-4 mr-2 animate-spin" />
                  Enviando Convites...
                </>
              ) : (
                <>
                  <Send className="w-4 h-4 mr-2" />
                  Agendar e Enviar Convites
                </>
              )}
            </Button>

            <Button
              variant="outline"
              onClick={() => handleSubmit(false)}
              disabled={sendingEmails}
              className="w-full border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.05)] text-white hover:bg-[rgba(255,255,255,0.08)]"
            >
              <Save className="w-4 h-4 mr-2" />
              Salvar sem Enviar
            </Button>

            <Button
              variant="outline"
              onClick={() => router.push("/reunioes")}
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
