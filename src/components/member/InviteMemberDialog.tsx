'use client';

import React, { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { Mail, MessageSquare, Loader2, UserPlus } from 'lucide-react';
import { inviteMember, type InviteMemberData, validateEmail, formatPhoneToE164 } from '@/lib/invitations';
import { projects } from '@/lib/mock-data';

interface InviteMemberDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

export function InviteMemberDialog({
  open,
  onOpenChange,
  onSuccess,
}: InviteMemberDialogProps) {
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);
  const [formData, setFormData] = useState<InviteMemberData>({
    nome: '',
    email: '',
    telefone: '',
    cargo: '',
    comite_id: '',
    comite_nome: '',
    role_id: '',
    canais: ['email'],
    mensagem_personalizada: '',
  });

  // Mock de comitês e roles
  const comites = projects
    .map((p) => ({ id: p.comite_id, nome: p.comite_nome }))
    .filter((v, i, a) => a.findIndex((t) => t.id === v.id) === i)
    .filter((c) => c.id && c.nome) as { id: string; nome: string }[];

  const roles = [
    { id: 'role-1', nome: 'Membro' },
    { id: 'role-2', nome: 'Coordenador' },
    { id: 'role-3', nome: 'Presidente' },
  ];

  const handleInputChange = (field: keyof InviteMemberData, value: any) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const toggleCanal = (canal: 'email' | 'whatsapp') => {
    setFormData((prev) => {
      const canais = prev.canais.includes(canal)
        ? prev.canais.filter((c) => c !== canal)
        : [...prev.canais, canal];
      return { ...prev, canais };
    });
  };

  const handleSubmit = async () => {
    // Validações
    if (!formData.nome.trim()) {
      toast({
        title: 'Erro de validação',
        description: 'Nome é obrigatório',
        variant: 'destructive',
      });
      return;
    }

    if (!formData.email.trim()) {
      toast({
        title: 'Erro de validação',
        description: 'Email é obrigatório',
        variant: 'destructive',
      });
      return;
    }

    if (!validateEmail(formData.email)) {
      toast({
        title: 'Erro de validação',
        description: 'Email inválido',
        variant: 'destructive',
      });
      return;
    }

    if (formData.canais.length === 0) {
      toast({
        title: 'Erro de validação',
        description: 'Selecione pelo menos um canal de envio',
        variant: 'destructive',
      });
      return;
    }

    if (formData.canais.includes('whatsapp') && !formData.telefone?.trim()) {
      toast({
        title: 'Erro de validação',
        description: 'Telefone é obrigatório para envio via WhatsApp',
        variant: 'destructive',
      });
      return;
    }

    setIsLoading(true);

    try {
      // Formata telefone se fornecido
      const inviteData = {
        ...formData,
        telefone: formData.telefone
          ? formatPhoneToE164(formData.telefone)
          : undefined,
      };

      const result = await inviteMember(inviteData);

      if (result.success) {
        toast({
          title: 'Convite enviado!',
          description: result.message,
        });

        // Reset form
        setFormData({
          nome: '',
          email: '',
          telefone: '',
          cargo: '',
          comite_id: '',
          comite_nome: '',
          role_id: '',
          canais: ['email'],
          mensagem_personalizada: '',
        });

        onOpenChange(false);
        onSuccess?.();
      } else {
        toast({
          title: 'Erro ao enviar convite',
          description: result.message,
          variant: 'destructive',
        });
      }
    } catch (error) {
      toast({
        title: 'Erro inesperado',
        description:
          error instanceof Error ? error.message : 'Ocorreu um erro ao enviar o convite',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleComiteChange = (comiteId: string) => {
    const comite = comites.find((c) => c.id === comiteId);
    setFormData((prev) => ({
      ...prev,
      comite_id: comiteId === 'none' ? '' : comiteId,
      comite_nome: comite?.nome || '',
    }));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserPlus className="w-5 h-5" />
            Convidar Novo Membro
          </DialogTitle>
          <DialogDescription>
            Envie um convite para um novo membro participar do sistema de
            governança via email ou WhatsApp.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Informações Básicas */}
          <div className="space-y-4">
            <h3 className="font-semibold text-sm text-slate-700">
              Informações do Membro
            </h3>

            <div className="grid md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="nome">
                  Nome Completo <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="nome"
                  placeholder="João Silva"
                  value={formData.nome}
                  onChange={(e) => handleInputChange('nome', e.target.value)}
                  disabled={isLoading}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="email">
                  Email <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="joao.silva@example.com"
                  value={formData.email}
                  onChange={(e) => handleInputChange('email', e.target.value)}
                  disabled={isLoading}
                />
              </div>
            </div>

            <div className="grid md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="telefone">Telefone (WhatsApp)</Label>
                <Input
                  id="telefone"
                  type="tel"
                  placeholder="+55 11 99999-9999"
                  value={formData.telefone}
                  onChange={(e) => handleInputChange('telefone', e.target.value)}
                  disabled={isLoading}
                />
                <p className="text-xs text-slate-500">
                  Formato: +55 11 99999-9999 ou 11999999999
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="cargo">Cargo</Label>
                <Input
                  id="cargo"
                  placeholder="Gerente de Projetos"
                  value={formData.cargo}
                  onChange={(e) => handleInputChange('cargo', e.target.value)}
                  disabled={isLoading}
                />
              </div>
            </div>
          </div>

          {/* Associação ao Comitê */}
          {comites.length > 0 && (
            <div className="space-y-4">
              <h3 className="font-semibold text-sm text-slate-700">
                Associação ao Comitê (Opcional)
              </h3>

              <div className="grid md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="comite">Comitê</Label>
                  <Select
                    value={formData.comite_id || 'none'}
                    onValueChange={handleComiteChange}
                    disabled={isLoading}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione um comitê" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Nenhum comitê específico</SelectItem>
                      {comites.map((comite) => (
                        <SelectItem key={comite.id} value={comite.id}>
                          {comite.nome}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="role">Função no Comitê</Label>
                  <Select
                    value={formData.role_id || ''}
                    onValueChange={(value) =>
                      handleInputChange('role_id', value === 'none' ? '' : value)
                    }
                    disabled={isLoading || !formData.comite_id}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione uma função" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Sem função específica</SelectItem>
                      {roles.map((role) => (
                        <SelectItem key={role.id} value={role.id}>
                          {role.nome}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
          )}

          {/* Canais de Envio */}
          <div className="space-y-4">
            <h3 className="font-semibold text-sm text-slate-700">
              Canais de Envio <span className="text-red-500">*</span>
            </h3>

            <div className="space-y-3">
              <div className="flex items-start space-x-3 p-4 border border-blue-200 rounded-lg bg-blue-50/50">
                <Checkbox
                  id="canal-email"
                  checked={formData.canais.includes('email')}
                  onCheckedChange={() => toggleCanal('email')}
                  disabled={isLoading}
                />
                <div className="flex-1">
                  <Label
                    htmlFor="canal-email"
                    className="flex items-center gap-2 cursor-pointer"
                  >
                    <Mail className="w-4 h-4 text-blue-600" />
                    <span className="font-medium">Email</span>
                  </Label>
                  <p className="text-xs text-slate-600 mt-1">
                    Enviar convite por email
                  </p>
                </div>
              </div>

              <div className="flex items-start space-x-3 p-4 border border-green-200 rounded-lg bg-green-50/50">
                <Checkbox
                  id="canal-whatsapp"
                  checked={formData.canais.includes('whatsapp')}
                  onCheckedChange={() => toggleCanal('whatsapp')}
                  disabled={isLoading}
                />
                <div className="flex-1">
                  <Label
                    htmlFor="canal-whatsapp"
                    className="flex items-center gap-2 cursor-pointer"
                  >
                    <MessageSquare className="w-4 h-4 text-green-600" />
                    <span className="font-medium">WhatsApp</span>
                  </Label>
                  <p className="text-xs text-slate-600 mt-1">
                    Enviar convite por WhatsApp (requer telefone)
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Mensagem Personalizada */}
          <div className="space-y-2">
            <Label htmlFor="mensagem">Mensagem Personalizada (Opcional)</Label>
            <Textarea
              id="mensagem"
              placeholder="Adicione uma mensagem personalizada ao convite..."
              rows={4}
              value={formData.mensagem_personalizada}
              onChange={(e) =>
                handleInputChange('mensagem_personalizada', e.target.value)
              }
              disabled={isLoading}
            />
            <p className="text-xs text-slate-500">
              Esta mensagem será incluída no convite enviado
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isLoading}
          >
            Cancelar
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={isLoading}
            style={{
              background: 'linear-gradient(135deg, #008751 0%, #006B40 100%)',
            }}
          >
            {isLoading ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Enviando...
              </>
            ) : (
              <>
                <UserPlus className="w-4 h-4 mr-2" />
                Enviar Convite
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

