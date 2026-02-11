'use client';

import React, { useState, use } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  Users,
  FileText,
  Settings,
  UserPlus,
  Trash2,
  Shield,
  Eye,
  Building2,
  Edit,
  Calendar,
  Clock,
  Download,
  Users as UsersIcon,
  List,
  Sparkles
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { meetings, users, agendaItems, votes as pautas } from '@/lib/mock-data';
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
import { AiMinutesGenerator } from "@/components/features/ai-minutes-generator";
import AddToCalendarButton from "@/components/calendar/AddToCalendarButton";
import Link from 'next/link';

export default function DetalheReuniaoPage({ params }: { params: Promise<{ id: string }> }) {
  const router = useRouter();
  const { toast } = useToast();
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const { id } = use(params);

  const meeting = meetings.find((m) => m.id === id) || meetings[0];

  if (!meeting) {
    return (
      <div className="p-6 lg:p-8">
        <Card className="border-orange-100 shadow-lg">
          <CardContent className="p-12 text-center">
            <Calendar className="w-16 h-16 text-slate-300 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-slate-900 mb-2">Reunião não encontrada</h3>
            <Button onClick={() => router.push("/reunioes")}>
              Voltar para Reuniões
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const handleDelete = () => {
    toast({ title: "Reunião excluída com sucesso!" });
    router.push('/reunioes');
  };

  // Mock user
  const isAdmin = true;
  const isCreator = true;

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
       <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button
            variant="outline"
            size="icon"
            onClick={() => router.push("/reunioes")}
            className="border-orange-300 hover:bg-orange-50"
          >
            <ArrowLeft className="w-4 h-4" style={{ color: '#FF7A3D' }} />
          </Button>
          <div>
            <h1 className="text-3xl font-bold text-slate-900">Detalhes da Reunião</h1>
          </div>
        </div>
        {(isAdmin || isCreator) && meeting.status !== 'encerrada' && (
          <div className="flex gap-2">
            <Button variant="outline" size="icon" className="border-orange-300 hover:bg-orange-50">
              <Edit className="w-4 h-4" style={{ color: '#FF7A3D' }} />
            </Button>
            <Button 
              variant="outline" 
              size="icon"
              onClick={() => setShowDeleteDialog(true)}
              className="text-red-600 hover:text-red-700 border-red-300"
            >
              <Trash2 className="w-4 h-4" />
            </Button>
          </div>
        )}
      </div>

      <Tabs defaultValue="details">
        <div className="flex justify-between items-center">
            <TabsList>
                <TabsTrigger value="details"><List className="w-4 h-4 mr-2"/>Pauta</TabsTrigger>
                <TabsTrigger value="participants"><UsersIcon className="w-4 h-4 mr-2"/>Participantes</TabsTrigger>
                <TabsTrigger value="ai-minutes"><Sparkles className="w-4 h-4 mr-2"/>Ata com IA</TabsTrigger>
            </TabsList>
            <AddToCalendarButton reuniao={meeting} variant="outline" />
        </div>
        <Separator className="my-4"/>

        <TabsContent value="details">
          <Card>
            <CardHeader>
              <CardTitle>Pauta da Reunião</CardTitle>
              <CardDescription>Itens a serem discutidos e deliberados.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {agendaItems.map((item, index) => (
                <div key={item.id} className="p-4 rounded-lg border">
                  <div className="flex justify-between items-start">
                    <div>
                      <p className="font-semibold">{`${index + 1}. ${item.titulo}`}</p>
                      <p className="text-sm text-muted-foreground">{item.descricao}</p>
                    </div>
                    <Badge variant={item.status === 'deliberada' ? 'default' : item.status === 'em_discussao' ? 'secondary' : 'outline'}>{item.status}</Badge>
                  </div>
                  <Separator className="my-3"/>
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <span>Responsável:</span>
                    <Avatar className="h-6 w-6">
                        <AvatarImage src={item.responsavel.avatarUrl} alt={item.responsavel.nome} data-ai-hint="person portrait"/>
                        <AvatarFallback>{item.responsavel.nome.charAt(0)}</AvatarFallback>
                    </Avatar>
                    <span>{item.responsavel.nome}</span>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="participants">
            <Card>
                <CardHeader>
                <CardTitle>Participantes</CardTitle>
                <CardDescription>Membros convidados e confirmados para a reunião.</CardDescription>
                </CardHeader>
                <CardContent className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {users.map(user => (
                        <div key={user.id} className="flex items-center gap-4 p-3 bg-secondary/50 rounded-lg">
                            <Avatar>
                                <AvatarImage src={user.avatarUrl} alt={user.nome} data-ai-hint="person portrait" />
                                <AvatarFallback>{user.nome.charAt(0)}</AvatarFallback>
                            </Avatar>
                            <div>
                                <p className="font-medium">{user.nome}</p>
                                <p className="text-sm text-muted-foreground">{user.papelPrincipal}</p>
                            </div>
                            <Badge variant="outline" className="ml-auto">Confirmado</Badge>
                        </div>
                    ))}
                </CardContent>
            </Card>
        </TabsContent>
        <TabsContent value="ai-minutes">
          <AiMinutesGenerator meeting={meeting} agendaItems={agendaItems} />
        </TabsContent>
      </Tabs>
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir Reunião</AlertDialogTitle>
            <AlertDialogDescription>
              Tem certeza que deseja excluir esta reunião? Esta ação não pode ser desfeita.
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
  );
}
