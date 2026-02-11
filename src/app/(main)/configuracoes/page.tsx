'use client';

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { 
  ArrowLeft, 
  Mail, 
  MessageSquare, 
  Bell, 
  Moon,
  Save,
  Phone,
  AlertCircle
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import {
  Alert,
  AlertDescription,
} from "@/components/ui/alert";

export default function ConfiguracoesNotificacoesPage() {
  const router = useRouter();
  const { toast } = useToast();

  const [formData, setFormData] = useState({
    canal_email_ativo: true,
    canal_whatsapp_ativo: false,
    telefone_whatsapp: "",
    quiet_hours_ativo: false,
    quiet_hours_inicio: "22:00",
    quiet_hours_fim: "07:00",
    
    event_nova_pauta_email: true,
    event_votacao_aberta_email: true,
    event_lembrete_votacao_email: true,
    event_votacao_encerrada_email: true,
    event_resultado_publicado_email: true,
    event_comentario_mencao_email: true,
    event_decisao_atualizada_email: true,
    event_reuniao_proxima_email: true,
    event_reuniao_hoje_email: true,
    event_ata_publicada_email: true,
    event_membro_adicionado_email: true,
    event_role_atualizada_email: true,
    
    event_nova_pauta_whatsapp: false,
    event_votacao_aberta_whatsapp: false,
    event_lembrete_votacao_whatsapp: true,
    event_votacao_encerrada_whatsapp: false,
    event_resultado_publicado_whatsapp: false,
    event_comentario_mencao_whatsapp: true,
    event_decisao_atualizada_whatsapp: false,
    event_reuniao_proxima_whatsapp: false,
    event_reuniao_hoje_whatsapp: true,
    event_ata_publicada_whatsapp: false,
    event_membro_adicionado_whatsapp: false,
    event_role_atualizada_whatsapp: false,
  });
  
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const handleInputChange = (field: keyof typeof formData, value: any) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const handleSave = () => {
    setIsSaving(true);
    if (formData.canal_whatsapp_ativo && formData.telefone_whatsapp) {
      const phoneRegex = /^\+[1-9]\d{1,14}$/;
      if (!phoneRegex.test(formData.telefone_whatsapp)) {
        toast({
          title: "Erro de validação",
          description: 'Telefone deve estar no formato E.164 (ex: +5511999999999)',
          variant: 'destructive',
        });
        setIsSaving(false);
        return;
      }
    }

    // Mock saving
    setTimeout(() => {
        toast({ title: 'Preferências salvas com sucesso!' });
        setIsSaving(false);
    }, 1000);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-orange-500"></div>
      </div>
    );
  }

  const eventGroups = [
    {
      title: "Pautas",
      events: [
        { key: 'nova_pauta', label: 'Nova pauta criada', icon: Bell },
        { key: 'votacao_aberta', label: 'Votação aberta', icon: Bell },
        { key: 'lembrete_votacao', label: 'Lembrete de votação', icon: AlertCircle },
        { key: 'votacao_encerrada', label: 'Votação encerrada', icon: Bell },
        { key: 'resultado_publicado', label: 'Resultado publicado', icon: Bell },
      ]
    },
    {
      title: "Interações",
      events: [
        { key: 'comentario_mencao', label: 'Menções em comentários', icon: MessageSquare },
        { key: 'decisao_atualizada', label: 'Decisão atualizada', icon: Bell },
      ]
    },
    {
      title: "Reuniões",
      events: [
        { key: 'reuniao_proxima', label: 'Reunião agendada', icon: Bell },
        { key: 'reuniao_hoje', label: 'Reunião hoje', icon: AlertCircle },
        { key: 'ata_publicada', label: 'Ata publicada', icon: Bell },
      ]
    },
    {
      title: "Comitês",
      events: [
        { key: 'membro_adicionado', label: 'Adicionado a comitê', icon: Bell },
        { key: 'role_atualizada', label: 'Função atualizada', icon: Bell },
      ]
    }
  ];

  return (
    <div className="p-6 lg:p-8 max-w-4xl mx-auto space-y-6">
      <div className="flex items-center gap-4">
        <Button
          variant="outline"
          size="icon"
          onClick={() => router.push("/dashboard")}
          className="border-orange-300 hover:bg-orange-50"
        >
          <ArrowLeft className="w-4 h-4" style={{ color: '#FF7A3D' }} />
        </Button>
        <div>
          <h1 className="text-3xl font-bold text-slate-900">Preferências de Notificação</h1>
          <p className="text-slate-600">Configure como deseja receber notificações</p>
        </div>
      </div>

      <Alert className="border-blue-200 bg-blue-50">
        <AlertCircle className="h-4 w-4 text-blue-600" />
        <AlertDescription className="text-blue-800">
          Personalize suas notificações por canal e tipo de evento. Você pode ativar horários de silêncio para não ser perturbado.
        </AlertDescription>
      </Alert>

      <Card className="border-orange-100 shadow-lg">
        <CardHeader className="border-b" style={{ background: 'linear-gradient(90deg, #FFF5F0 0%, #F0FFF5 100%)' }}>
          <CardTitle>Canais de Notificação</CardTitle>
        </CardHeader>
        <CardContent className="p-6 space-y-6">
          <div className="flex items-center justify-between p-4 border border-blue-200 rounded-lg bg-blue-50">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-500 rounded-lg">
                <Mail className="w-5 h-5 text-white" />
              </div>
              <div>
                <Label className="text-base font-semibold">Email</Label>
                <p className="text-sm text-slate-600">Receber notificações por email</p>
              </div>
            </div>
            <Switch
              checked={formData.canal_email_ativo}
              onCheckedChange={(checked) => handleInputChange('canal_email_ativo', checked)}
            />
          </div>

          <div className="space-y-4 p-4 border border-green-200 rounded-lg bg-green-50">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-green-500 rounded-lg">
                  <MessageSquare className="w-5 h-5 text-white" />
                </div>
                <div>
                  <Label className="text-base font-semibold">WhatsApp</Label>
                  <p className="text-sm text-slate-600">Receber notificações por WhatsApp</p>
                </div>
              </div>
              <Switch
                checked={formData.canal_whatsapp_ativo}
                onCheckedChange={(checked) => handleInputChange('canal_whatsapp_ativo', checked)}
              />
            </div>

            {formData.canal_whatsapp_ativo && (
              <div className="space-y-2 pt-4 border-t border-green-200">
                <Label htmlFor="telefone">Telefone WhatsApp (formato E.164)</Label>
                <div className="flex gap-2">
                  <Phone className="w-5 h-5 text-green-600 mt-2" />
                  <Input
                    id="telefone"
                    placeholder="+5511999999999"
                    value={formData.telefone_whatsapp}
                    onChange={(e) => handleInputChange('telefone_whatsapp', e.target.value)}
                    className="border-green-300"
                  />
                </div>
                <p className="text-xs text-slate-500">
                  Exemplo: +55 (11) 99999-9999 → +5511999999999
                </p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <Card className="border-purple-100 shadow-lg">
        <CardHeader className="border-b bg-purple-50">
          <CardTitle>Horários de Silêncio</CardTitle>
        </CardHeader>
        <CardContent className="p-6 space-y-4">
          <div className="flex items-center justify-between p-4 border border-purple-200 rounded-lg bg-purple-50">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-purple-500 rounded-lg">
                <Moon className="w-5 h-5 text-white" />
              </div>
              <div>
                <Label className="text-base font-semibold">Ativar Horário de Silêncio</Label>
                <p className="text-sm text-slate-600">Não receber notificações em horários específicos</p>
              </div>
            </div>
            <Switch
              checked={formData.quiet_hours_ativo}
              onCheckedChange={(checked) => handleInputChange('quiet_hours_ativo', checked)}
            />
          </div>

          {formData.quiet_hours_ativo && (
            <div className="grid md:grid-cols-2 gap-4 pt-4">
              <div className="space-y-2">
                <Label htmlFor="inicio">Início</Label>
                <Input
                  id="inicio"
                  type="time"
                  value={formData.quiet_hours_inicio}
                  onChange={(e) => handleInputChange('quiet_hours_inicio', e.target.value)}
                  className="border-purple-300"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="fim">Fim</Label>
                <Input
                  id="fim"
                  type="time"
                  value={formData.quiet_hours_fim}
                  onChange={(e) => handleInputChange('quiet_hours_fim', e.target.value)}
                  className="border-purple-300"
                />
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="border-slate-200 shadow-lg">
        <CardHeader className="border-b bg-slate-50">
          <CardTitle>Preferências por Evento</CardTitle>
        </CardHeader>
        <CardContent className="p-6 space-y-6">
          {eventGroups.map((group) => (
            <div key={group.title} className="space-y-4">
              <h3 className="font-semibold text-slate-900 flex items-center gap-2">
                <Bell className="w-4 h-4" style={{ color: '#FF7A3D' }} />
                {group.title}
              </h3>
              <div className="space-y-3">
                {group.events.map((event) => (
                  <div key={event.key} className="border border-slate-200 rounded-lg p-4 hover:bg-slate-50 transition-colors">
                    <div className="flex items-center justify-between mb-3">
                      <Label className="text-base">{event.label}</Label>
                    </div>
                    <div className="grid md:grid-cols-2 gap-4 pl-4">
                      <div className="flex items-center justify-between p-2 bg-blue-50 rounded border border-blue-200">
                        <div className="flex items-center gap-2">
                          <Mail className="w-4 h-4 text-blue-600" />
                          <span className="text-sm">Email</span>
                        </div>
                        <Switch
                          checked={Boolean(formData[`event_${event.key}_email` as keyof typeof formData])}
                          onCheckedChange={(checked) => handleInputChange(`event_${event.key}_email` as keyof typeof formData, checked)}
                          disabled={!formData.canal_email_ativo}
                        />
                      </div>
                      <div className="flex items-center justify-between p-2 bg-green-50 rounded border border-green-200">
                        <div className="flex items-center gap-2">
                          <MessageSquare className="w-4 h-4 text-green-600" />
                          <span className="text-sm">WhatsApp</span>
                        </div>
                        <Switch
                          checked={Boolean(formData[`event_${event.key}_whatsapp`  as keyof typeof formData])}
                          onCheckedChange={(checked) => handleInputChange(`event_${event.key}_whatsapp` as keyof typeof formData, checked)}
                          disabled={!formData.canal_whatsapp_ativo}
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <div className="flex gap-3 justify-end">
        <Button
          variant="outline"
          onClick={() => router.push("/dashboard")}
          className="border-slate-300"
        >
          Cancelar
        </Button>
        <Button
          onClick={handleSave}
          disabled={isSaving}
          style={{ background: 'linear-gradient(135deg, #FF7A3D 0%, #E6662A 100%)' }}
        >
          <Save className="w-4 h-4 mr-2" />
          Salvar Preferências
        </Button>
      </div>
    </div>
  );
}
