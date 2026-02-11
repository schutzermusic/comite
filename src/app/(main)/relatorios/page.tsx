'use client';

import React, { useState } from "react";
import { 
  BarChart3, 
  TrendingUp, 
  PieChart as PieChartIcon, 
  Calendar,
  Filter,
  Settings,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { HUDCard } from "@/components/ui/hud-card";
import { StatusPill } from "@/components/ui/status-pill";
import { OrionGreenBackground } from "@/components/system/OrionGreenBackground";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  PieChart as RechartsPie,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  LineChart,
  Line
} from "recharts";
import { format, startOfMonth, endOfMonth, subMonths } from "date-fns";
import { ptBR } from "date-fns/locale";
import { projects, meetings, votes as pautas } from '@/lib/mock-data';
import ExportMenu from "@/components/reports/ExportMenu";

const comites = projects.map(p => ({id: p.id, nome: p.comiteResponsavel})).filter((v,i,a) => a.findIndex(t => (t.id === v.id)) === i) as {id: string, nome: string}[];

export default function RelatoriosAvancados() {
  const [dataInicio, setDataInicio] = useState(
    format(startOfMonth(subMonths(new Date(), 5)), 'yyyy-MM-dd')
  );
  const [dataFim, setDataFim] = useState(
    format(endOfMonth(new Date()), 'yyyy-MM-dd')
  );
  const [comiteFiltro, setComiteFiltro] = useState("all");
  const [tipoProjetoFiltro, setTipoProjetoFiltro] = useState("all");
  const [tipoReuniaoFiltro, setTipoReuniaoFiltro] = useState("all");

  // Filtrar dados por período
  const filteredProjetos = projects.filter(p => {
    const dataInicioProjeto = new Date(p.created_date || '2024-01-01');
    const matchData = dataInicioProjeto >= new Date(dataInicio) && dataInicioProjeto <= new Date(dataFim);
    const matchComite = comiteFiltro === "all" || p.comite_id === comiteFiltro;
    const matchTipo = tipoProjetoFiltro === "all" || p.tipo === tipoProjetoFiltro;
    return matchData && matchComite && matchTipo;
  });

  const filteredReunioes = meetings.filter(r => {
    const dataReuniao = new Date(r.dataHoraInicio);
    const matchData = dataReuniao >= new Date(dataInicio) && dataReuniao <= new Date(dataFim);
    const comite = comites.find(c => c.nome === r.comite);
    const matchComite = comiteFiltro === "all" || (comite && comite.id === comiteFiltro);
    const matchTipo = tipoReuniaoFiltro === "all" || r.tipoReuniao === tipoReuniaoFiltro;
    return matchData && matchComite && matchTipo;
  });

  const filteredPautas = pautas.filter(p => {
    const dataPauta = new Date(p.prazoFim);
    const matchData = dataPauta >= new Date(dataInicio) && dataPauta <= new Date(dataFim);
    const comite = comites.find(c => c.nome === p.comite);
    const matchComite = comiteFiltro === "all" || (comite && comite.id === comiteFiltro);
    return matchData && matchComite;
  });

  // Calcular KPIs
  const kpis = {
    totalProjetos: filteredProjetos.length,
    projetosAtivos: filteredProjetos.filter(p => p.status === 'em_andamento').length,
    valorTotal: filteredProjetos.reduce((sum, p) => sum + (p.valor_total || 0), 0),
    totalReunioes: filteredReunioes.length,
    reunioesConcluidas: filteredReunioes.filter(r => r.status === 'encerrada').length,
    totalPautas: filteredPautas.length,
    pautasAprovadas: filteredPautas.filter(p => p.resultado === 'aprovado').length,
    taxaAprovacao: filteredPautas.length > 0 
      ? ((filteredPautas.filter(p => p.resultado === 'aprovado').length / filteredPautas.length) * 100).toFixed(1)
      : "0",
  };

  // Dados para gráfico de evolução de projetos
  const projetosPorMes: {[key: string]: number} = {};
  filteredProjetos.forEach(p => {
    const mes = format(new Date(p.created_date || '2024-01-01'), 'MMM/yyyy', { locale: ptBR });
    projetosPorMes[mes] = (projetosPorMes[mes] || 0) + 1;
  });

  const dadosEvolucaoProjetos = Object.keys(projetosPorMes).map(mes => ({
    mes,
    projetos: projetosPorMes[mes]
  }));

  // Dados para gráfico de status de projetos
  const projetosPorStatus = [
    { name: 'Planejamento', value: filteredProjetos.filter(p => p.status === 'planejamento').length },
    { name: 'Em Andamento', value: filteredProjetos.filter(p => p.status === 'em_andamento').length },
    { name: 'Pausado', value: filteredProjetos.filter(p => p.status === 'pausado').length },
    { name: 'Concluído', value: filteredProjetos.filter(p => p.status === 'concluido').length },
    { name: 'Cancelado', value: filteredProjetos.filter(p => p.status === 'cancelado').length },
  ].filter(item => item.value > 0);

  // Dados para gráfico de pautas por categoria
  const pautasPorCategoria: {[key: string]: number} = {};
  filteredPautas.forEach((p) => {
    const cat = p.categoria || 'outra';
    pautasPorCategoria[cat] = (pautasPorCategoria[cat] || 0) + 1;
  });

  const dadosPautasCategoria = Object.keys(pautasPorCategoria).map(cat => ({
    categoria: cat.charAt(0).toUpperCase() + cat.slice(1),
    pautas: pautasPorCategoria[cat]
  }));

  // Dados para gráfico de reuniões
  const reunioesPorMes: {[key: string]: number} = {};
  filteredReunioes.forEach(r => {
    const mes = format(new Date(r.dataHoraInicio), 'MMM/yyyy', { locale: ptBR });
    reunioesPorMes[mes] = (reunioesPorMes[mes] || 0) + 1;
  });

  const dadosReunioesMes = Object.keys(reunioesPorMes).map(mes => ({
    mes,
    reunioes: reunioesPorMes[mes]
  }));

  const COLORS = ['#FF7A3D', '#008751', '#FFB347', '#4CAF7B', '#E6662A', '#006B40'];

  const filtros = {
    dataInicio,
    dataFim,
    comite: comiteFiltro,
    tipoProjeto: tipoProjetoFiltro,
    tipoReuniao: tipoReuniaoFiltro
  };

  return (
    <OrionGreenBackground className="orion-page">
      <div className="orion-page-content max-w-[1800px] mx-auto space-y-6">
        <header className="mb-8">
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
            <div>
              <h1 className="text-2xl font-semibold text-white mb-1 tracking-wide">Relatórios Avançados</h1>
              <p className="text-sm text-[rgba(255,255,255,0.65)]">Dashboards personalizáveis e análises detalhadas</p>
            </div>
            <div className="flex gap-2">
              <ExportMenu 
                data={filteredProjetos}
                fileName="relatorio-avancado"
              />
              <Button variant="outline" className="border-[rgba(0,255,180,0.25)] text-[rgba(255,255,255,0.92)] hover:bg-[rgba(0,255,180,0.12)]">
                <Settings className="w-4 h-4 mr-2" />
                Configurar Dashboard
              </Button>
            </div>
          </div>
        </header>

        {/* Filtros */}
        <HUDCard>
          <div className="grid md:grid-cols-5 gap-4">
            <div className="space-y-2">
              <Label className="text-white text-xs">Data Início</Label>
              <Input
                type="date"
                value={dataInicio}
                onChange={(e) => setDataInicio(e.target.value)}
                className="bg-[rgba(255,255,255,0.05)] border-[rgba(255,255,255,0.08)] text-white focus:border-[rgba(0,255,180,0.25)]"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-white text-xs">Data Fim</Label>
              <Input
                type="date"
                value={dataFim}
                onChange={(e) => setDataFim(e.target.value)}
                className="bg-[rgba(255,255,255,0.05)] border-[rgba(255,255,255,0.08)] text-white focus:border-[rgba(0,255,180,0.25)]"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-white text-xs">Comitê</Label>
              <Select value={comiteFiltro} onValueChange={setComiteFiltro}>
                <SelectTrigger className="bg-[rgba(255,255,255,0.05)] border-[rgba(255,255,255,0.08)] text-white hover:border-[rgba(0,255,180,0.25)] focus:border-[rgba(0,255,180,0.25)]">
                  <SelectValue placeholder="Todos" />
                </SelectTrigger>
                <SelectContent className="bg-gradient-to-br from-[#07130F] to-[#030B09] border-[rgba(255,255,255,0.08)]">
                  <SelectItem value="all" className="text-white focus:bg-[rgba(0,255,180,0.12)] focus:text-[#00FFB4]">Todos</SelectItem>
                  {comites.map(c => (
                    <SelectItem key={c.id} value={c.id} className="text-white focus:bg-[rgba(0,255,180,0.12)] focus:text-[#00FFB4]">{c.nome}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label className="text-white text-xs">Tipo de Projeto</Label>
              <Select value={tipoProjetoFiltro} onValueChange={setTipoProjetoFiltro}>
                <SelectTrigger className="bg-[rgba(255,255,255,0.05)] border-[rgba(255,255,255,0.08)] text-white hover:border-[rgba(0,255,180,0.25)] focus:border-[rgba(0,255,180,0.25)]">
                  <SelectValue placeholder="Todos" />
                </SelectTrigger>
                <SelectContent className="bg-gradient-to-br from-[#07130F] to-[#030B09] border-[rgba(255,255,255,0.08)]">
                  <SelectItem value="all" className="text-white focus:bg-[rgba(0,255,180,0.12)] focus:text-[#00FFB4]">Todos</SelectItem>
                  <SelectItem value="energia_solar" className="text-white focus:bg-[rgba(0,255,180,0.12)] focus:text-[#00FFB4]">Energia Solar</SelectItem>
                  <SelectItem value="eolica" className="text-white focus:bg-[rgba(0,255,180,0.12)] focus:text-[#00FFB4]">Eólica</SelectItem>
                  <SelectItem value="hidreletrica" className="text-white focus:bg-[rgba(0,255,180,0.12)] focus:text-[#00FFB4]">Hidrelétrica</SelectItem>
                  <SelectItem value="biomassa" className="text-white focus:bg-[rgba(0,255,180,0.12)] focus:text-[#00FFB4]">Biomassa</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label className="text-white text-xs">Tipo de Reunião</Label>
              <Select value={tipoReuniaoFiltro} onValueChange={setTipoReuniaoFiltro}>
                <SelectTrigger className="bg-[rgba(255,255,255,0.05)] border-[rgba(255,255,255,0.08)] text-white hover:border-[rgba(0,255,180,0.25)] focus:border-[rgba(0,255,180,0.25)]">
                  <SelectValue placeholder="Todas" />
                </SelectTrigger>
                <SelectContent className="bg-gradient-to-br from-[#07130F] to-[#030B09] border-[rgba(255,255,255,0.08)]">
                  <SelectItem value="all" className="text-white focus:bg-[rgba(0,255,180,0.12)] focus:text-[#00FFB4]">Todas</SelectItem>
                  <SelectItem value="presencial" className="text-white focus:bg-[rgba(0,255,180,0.12)] focus:text-[#00FFB4]">Presencial</SelectItem>
                  <SelectItem value="virtual" className="text-white focus:bg-[rgba(0,255,180,0.12)] focus:text-[#00FFB4]">Virtual</SelectItem>
                  <SelectItem value="hibrida" className="text-white focus:bg-[rgba(0,255,180,0.12)] focus:text-[#00FFB4]">Híbrida</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </HUDCard>

        {/* KPIs */}
        <section className="grid md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <HUDCard glow glowColor="amber">
            <div className="flex items-center justify-between mb-2">
              <TrendingUp className="w-6 h-6 text-[#FFB04D]" />
            </div>
            <p className="text-xs text-[rgba(255,255,255,0.65)] mb-1 uppercase tracking-wide">Projetos Ativos</p>
            <p className="text-3xl font-semibold text-white">{kpis.projetosAtivos}</p>
            <p className="text-xs text-[rgba(255,255,255,0.40)] mt-1">de {kpis.totalProjetos} total</p>
          </HUDCard>

          <HUDCard glow glowColor="green">
            <div className="flex items-center justify-between mb-2">
              <BarChart3 className="w-6 h-6 text-[#00FFB4]" />
            </div>
            <p className="text-xs text-[rgba(255,255,255,0.65)] mb-1 uppercase tracking-wide">Valor Total</p>
            <p className="text-2xl font-semibold text-white">
              R$ {(kpis.valorTotal / 1000000).toFixed(1)}M
            </p>
            <p className="text-xs text-[rgba(255,255,255,0.40)] mt-1">em projetos</p>
          </HUDCard>

          <HUDCard glow glowColor="amber">
            <div className="flex items-center justify-between mb-2">
              <PieChartIcon className="w-6 h-6 text-[#FFB04D]" />
            </div>
            <p className="text-xs text-[rgba(255,255,255,0.65)] mb-1 uppercase tracking-wide">Taxa de Aprovação</p>
            <p className="text-3xl font-semibold text-white">{kpis.taxaAprovacao}%</p>
            <p className="text-xs text-[rgba(255,255,255,0.40)] mt-1">{kpis.pautasAprovadas} de {kpis.totalPautas} pautas</p>
          </HUDCard>

          <HUDCard glow glowColor="cyan">
            <div className="flex items-center justify-between mb-2">
              <Calendar className="w-6 h-6 text-[#00C8FF]" />
            </div>
            <p className="text-xs text-[rgba(255,255,255,0.65)] mb-1 uppercase tracking-wide">Reuniões Realizadas</p>
            <p className="text-3xl font-semibold text-white">{kpis.reunioesConcluidas}</p>
            <p className="text-xs text-[rgba(255,255,255,0.40)] mt-1">de {kpis.totalReunioes} agendadas</p>
          </HUDCard>
        </section>

        {/* Gráficos */}
        <div className="flex justify-end mb-4">
          <div className="inline-flex rounded-lg border border-[rgba(255,255,255,0.08)] p-1 bg-[rgba(255,255,255,0.03)]">
            <Tabs defaultValue="projetos" className="w-full">
              <TabsList className="bg-transparent border-0">
                <TabsTrigger value="projetos" className="data-[state=active]:bg-[#00FFB4] data-[state=active]:text-[#050D0A] text-[rgba(255,255,255,0.65)] hover:text-white">Projetos</TabsTrigger>
                <TabsTrigger value="pautas" className="data-[state=active]:bg-[#00FFB4] data-[state=active]:text-[#050D0A] text-[rgba(255,255,255,0.65)] hover:text-white">Pautas</TabsTrigger>
                <TabsTrigger value="reunioes" className="data-[state=active]:bg-[#00FFB4] data-[state=active]:text-[#050D0A] text-[rgba(255,255,255,0.65)] hover:text-white">Reuniões</TabsTrigger>
                <TabsTrigger value="financeiro" className="data-[state=active]:bg-[#00FFB4] data-[state=active]:text-[#050D0A] text-[rgba(255,255,255,0.65)] hover:text-white">Financeiro</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
        </div>

        <Tabs defaultValue="projetos" className="space-y-6">
          <TabsContent value="projetos" className="space-y-6 mt-0">
            <div className="grid md:grid-cols-2 gap-6">
              <HUDCard>
                <div className="mb-4">
                  <h3 className="text-base font-semibold text-white mb-1">Evolução de Projetos</h3>
                  <p className="text-xs text-[rgba(255,255,255,0.65)]">Criação de projetos ao longo do tempo</p>
                </div>
                <ResponsiveContainer width="100%" height={300}>
                  <AreaChart data={dadosEvolucaoProjetos}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                    <XAxis dataKey="mes" stroke="rgba(255,255,255,0.40)" />
                    <YAxis stroke="rgba(255,255,255,0.40)" />
                    <Tooltip 
                      contentStyle={{ 
                        backgroundColor: 'rgba(7,19,15,0.95)', 
                        border: '1px solid rgba(255,255,255,0.08)',
                        borderRadius: '8px',
                        color: 'white'
                      }} 
                    />
                    <Area type="monotone" dataKey="projetos" stroke="#00FFB4" fill="rgba(0,255,180,0.15)" />
                  </AreaChart>
                </ResponsiveContainer>
              </HUDCard>

              <HUDCard>
                <div className="mb-4">
                  <h3 className="text-base font-semibold text-white mb-1">Status dos Projetos</h3>
                  <p className="text-xs text-[rgba(255,255,255,0.65)]">Distribuição por status</p>
                </div>
                <ResponsiveContainer width="100%" height={300}>
                  <RechartsPie>
                    <Pie
                      data={projetosPorStatus}
                      cx="50%"
                      cy="50%"
                      labelLine={false}
                      label={({ name, value }) => `${name}: ${value}`}
                      outerRadius={80}
                      fill="#8884d8"
                      dataKey="value"
                    >
                      {projetosPorStatus.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip 
                      contentStyle={{ 
                        backgroundColor: 'rgba(7,19,15,0.95)', 
                        border: '1px solid rgba(255,255,255,0.08)',
                        borderRadius: '8px',
                        color: 'white'
                      }} 
                    />
                  </RechartsPie>
                </ResponsiveContainer>
              </HUDCard>
            </div>
          </TabsContent>

          <TabsContent value="pautas" className="space-y-6 mt-0">
            <HUDCard>
              <div className="mb-4">
                <h3 className="text-base font-semibold text-white mb-1">Pautas por Categoria</h3>
                <p className="text-xs text-[rgba(255,255,255,0.65)]">Distribuição de pautas por categoria</p>
              </div>
              <ResponsiveContainer width="100%" height={400}>
                <BarChart data={dadosPautasCategoria}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                  <XAxis dataKey="categoria" stroke="rgba(255,255,255,0.40)" />
                  <YAxis stroke="rgba(255,255,255,0.40)" />
                  <Tooltip 
                    contentStyle={{ 
                      backgroundColor: 'rgba(7,19,15,0.95)', 
                      border: '1px solid rgba(255,255,255,0.08)',
                      borderRadius: '8px',
                      color: 'white'
                    }} 
                  />
                  <Legend wrapperStyle={{ color: 'rgba(255,255,255,0.92)' }} />
                  <Bar dataKey="pautas" fill="#00FFB4" />
                </BarChart>
              </ResponsiveContainer>
            </HUDCard>
          </TabsContent>

          <TabsContent value="reunioes" className="space-y-6 mt-0">
            <HUDCard>
              <div className="mb-4">
                <h3 className="text-base font-semibold text-white mb-1">Frequência de Reuniões</h3>
                <p className="text-xs text-[rgba(255,255,255,0.65)]">Reuniões realizadas por mês</p>
              </div>
              <ResponsiveContainer width="100%" height={400}>
                <LineChart data={dadosReunioesMes}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                  <XAxis dataKey="mes" stroke="rgba(255,255,255,0.40)" />
                  <YAxis stroke="rgba(255,255,255,0.40)" />
                  <Tooltip 
                    contentStyle={{ 
                      backgroundColor: 'rgba(7,19,15,0.95)', 
                      border: '1px solid rgba(255,255,255,0.08)',
                      borderRadius: '8px',
                      color: 'white'
                    }} 
                  />
                  <Legend wrapperStyle={{ color: 'rgba(255,255,255,0.92)' }} />
                  <Line type="monotone" dataKey="reunioes" stroke="#00FFB4" strokeWidth={3} />
                </LineChart>
              </ResponsiveContainer>
            </HUDCard>
          </TabsContent>

          <TabsContent value="financeiro" className="space-y-6 mt-0">
            <HUDCard>
              <div className="p-12 text-center">
                <BarChart3 className="w-16 h-16 text-[rgba(255,255,255,0.20)] mx-auto mb-4" />
                <p className="text-[rgba(255,255,255,0.65)]">Dados financeiros disponíveis apenas para usuários autorizados</p>
              </div>
            </HUDCard>
          </TabsContent>
        </Tabs>
      </div>
    </OrionGreenBackground>
  );
}
