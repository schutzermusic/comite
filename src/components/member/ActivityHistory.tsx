'use client';

import React from "react";
import { 
  History,
  FileText,
  Calendar,
  ThumbsUp,
  MessageSquare,
  Shield,
  UserPlus,
  UserMinus
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { ScrollArea } from "@/components/ui/scroll-area";
import { atividadesMembro as mockActivities } from "@/lib/mock-data";
import { AtividadeMembro } from "@/lib/types";

export default function ActivityHistory({ userEmail }: { userEmail: string }) {
  const [atividades, setAtividades] = React.useState<AtividadeMembro[]>([]);
  const [isLoading, setIsLoading] = React.useState(true);

  React.useEffect(() => {
    if (userEmail) {
      setIsLoading(true);
      // Simulate fetching data
      setTimeout(() => {
        const userActivities = mockActivities.filter(a => a.usuario_email === userEmail);
        setAtividades(userActivities);
        setIsLoading(false);
      }, 500);
    }
  }, [userEmail]);


  const getActivityIcon = (tipo: AtividadeMembro['tipo_atividade']) => {
    const icons = {
      voto: ThumbsUp,
      pauta_criada: FileText,
      reuniao_participada: Calendar,
      comentario: MessageSquare,
      role_alterada: Shield,
      adicionado_comite: UserPlus,
      removido_comite: UserMinus
    };
    return icons[tipo] || History;
  };

  const getActivityColor = (tipo: AtividadeMembro['tipo_atividade']) => {
    const colors = {
      voto: 'text-green-600 bg-green-100',
      pauta_criada: 'text-orange-600 bg-orange-100',
      reuniao_participada: 'text-blue-600 bg-blue-100',
      comentario: 'text-purple-600 bg-purple-100',
      role_alterada: 'text-amber-600 bg-amber-100',
      adicionado_comite: 'text-emerald-600 bg-emerald-100',
      removido_comite: 'text-red-600 bg-red-100'
    };
    return colors[tipo] || 'text-slate-600 bg-slate-100';
  };

  if (isLoading) {
    return (
      <Card className="border-slate-200 shadow-lg">
        <CardContent className="p-12 text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-orange-500 mx-auto"></div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-slate-200 shadow-lg">
      <CardHeader className="border-b bg-slate-50">
        <div className="flex items-center gap-2">
          <History className="w-5 h-5 text-slate-600" />
          <CardTitle>Histórico de Atividades</CardTitle>
        </div>
      </CardHeader>
      <CardContent className="p-6">
        <ScrollArea className="h-[400px]">
          {atividades.length > 0 ? (
            <div className="space-y-3">
              {atividades.map((atividade) => {
                const Icon = getActivityIcon(atividade.tipo_atividade);
                const colorClass = getActivityColor(atividade.tipo_atividade);
                
                return (
                  <div key={atividade.id} className="flex gap-3 p-3 rounded-lg border border-slate-100 hover:bg-slate-50 transition-colors">
                    <div className={`p-2 rounded-lg ${colorClass} flex-shrink-0 h-fit`}>
                      <Icon className="w-4 h-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm text-slate-900 mb-1">
                        {atividade.descricao}
                      </p>
                      {atividade.comite_nome && (
                        <Badge variant="outline" className="text-xs mb-2">
                          {atividade.comite_nome}
                        </Badge>
                      )}
                      <p className="text-xs text-slate-500">
                        {format(new Date(atividade.created_date), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="text-center py-12">
              <History className="w-12 h-12 text-slate-300 mx-auto mb-3" />
              <p className="text-sm text-slate-500">Nenhuma atividade registrada</p>
            </div>
          )}
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
