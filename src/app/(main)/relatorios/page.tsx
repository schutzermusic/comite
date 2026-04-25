'use client';

import { useMemo, useState } from "react";
import {
  BarChart3,
  Calendar,
  Download,
  FileText,
  PieChart as PieChartIcon,
  Settings,
  TrendingUp,
} from "lucide-react";
import { format, startOfMonth, endOfMonth, subMonths } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart as RechartsPie,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { HudBadge } from "@/components/hud/HudBadge";
import { HudButton } from "@/components/hud/HudButton";
import { HudHeader } from "@/components/hud/HudHeader";
import { HudInput } from "@/components/hud/HudInput";
import { HudPageLayout } from "@/components/hud/HudPageLayout";
import { HudPanel } from "@/components/hud/HudPanel";
import { HudSelect } from "@/components/hud/HudSelect";
import { HudTable } from "@/components/hud/HudTable";
import type { HudTableColumn } from "@/components/hud/HudTable";
import { meetings, projects, votes as pautas } from "@/lib/mock-data";

const comites = projects
  .map((project) => ({ id: project.id, nome: project.comiteResponsavel }))
  .filter((item, index, array) => array.findIndex((candidate) => candidate.nome === item.nome) === index);

const chartColors = [
  "var(--ig-accent)",
  "var(--ig-info)",
  "var(--ig-warning)",
  "var(--ig-success)",
  "var(--ig-danger)",
  "var(--ig-fg-muted)",
];

const chartText = "var(--ig-fg-muted)";
const chartGrid = "var(--ig-border-subtle)";

type ReportTab = "projetos" | "pautas" | "reunioes" | "financeiro";

interface SummaryRow {
  id: string;
  indicador: string;
  valor: string;
  contexto: string;
}

export default function RelatoriosPage() {
  const [dataInicio, setDataInicio] = useState(format(startOfMonth(subMonths(new Date(), 5)), "yyyy-MM-dd"));
  const [dataFim, setDataFim] = useState(format(endOfMonth(new Date()), "yyyy-MM-dd"));
  const [comiteFiltro, setComiteFiltro] = useState("all");
  const [tipoProjetoFiltro, setTipoProjetoFiltro] = useState("all");
  const [tipoReuniaoFiltro, setTipoReuniaoFiltro] = useState("all");
  const [activeTab, setActiveTab] = useState<ReportTab>("projetos");

  const filteredProjetos = useMemo(
    () =>
      projects.filter((project) => {
        const dataInicioProjeto = new Date(project.created_date || "2024-01-01");
        const matchData = dataInicioProjeto >= new Date(dataInicio) && dataInicioProjeto <= new Date(dataFim);
        const matchComite = comiteFiltro === "all" || project.comite_id === comiteFiltro;
        const matchTipo = tipoProjetoFiltro === "all" || project.tipo === tipoProjetoFiltro;
        return matchData && matchComite && matchTipo;
      }),
    [comiteFiltro, dataFim, dataInicio, tipoProjetoFiltro],
  );

  const filteredReunioes = useMemo(
    () =>
      meetings.filter((meeting) => {
        const dataReuniao = new Date(meeting.dataHoraInicio);
        const comite = comites.find((item) => item.nome === meeting.comite);
        const matchData = dataReuniao >= new Date(dataInicio) && dataReuniao <= new Date(dataFim);
        const matchComite = comiteFiltro === "all" || comite?.id === comiteFiltro;
        const matchTipo = tipoReuniaoFiltro === "all" || meeting.tipoReuniao === tipoReuniaoFiltro;
        return matchData && matchComite && matchTipo;
      }),
    [comiteFiltro, dataFim, dataInicio, tipoReuniaoFiltro],
  );

  const filteredPautas = useMemo(
    () =>
      pautas.filter((pauta) => {
        const dataPauta = new Date(pauta.prazoFim);
        const comite = comites.find((item) => item.nome === pauta.comite);
        const matchData = dataPauta >= new Date(dataInicio) && dataPauta <= new Date(dataFim);
        const matchComite = comiteFiltro === "all" || comite?.id === comiteFiltro;
        return matchData && matchComite;
      }),
    [comiteFiltro, dataFim, dataInicio],
  );

  const kpis = {
    totalProjetos: filteredProjetos.length,
    projetosAtivos: filteredProjetos.filter((project) => project.status === "em_andamento").length,
    valorTotal: filteredProjetos.reduce((sum, project) => sum + (project.valor_total || 0), 0),
    totalReunioes: filteredReunioes.length,
    reunioesConcluidas: filteredReunioes.filter((meeting) => meeting.status === "encerrada").length,
    totalPautas: filteredPautas.length,
    pautasAprovadas: filteredPautas.filter((pauta) => pauta.resultado === "aprovado").length,
    taxaAprovacao:
      filteredPautas.length > 0
        ? ((filteredPautas.filter((pauta) => pauta.resultado === "aprovado").length / filteredPautas.length) * 100).toFixed(1)
        : "0",
  };

  const dadosEvolucaoProjetos = Object.entries(
    filteredProjetos.reduce<Record<string, number>>((accumulator, project) => {
      const mes = format(new Date(project.created_date || "2024-01-01"), "MMM/yyyy", { locale: ptBR });
      accumulator[mes] = (accumulator[mes] || 0) + 1;
      return accumulator;
    }, {}),
  ).map(([mes, projetos]) => ({ mes, projetos }));

  const projetosPorStatus = [
    { name: "Planejamento", value: filteredProjetos.filter((project) => project.status === "planejamento").length },
    { name: "Em Andamento", value: filteredProjetos.filter((project) => project.status === "em_andamento").length },
    { name: "Pausado", value: filteredProjetos.filter((project) => project.status === "pausado").length },
    { name: "Concluído", value: filteredProjetos.filter((project) => project.status === "concluido").length },
    { name: "Cancelado", value: filteredProjetos.filter((project) => project.status === "cancelado").length },
  ].filter((item) => item.value > 0);

  const dadosPautasCategoria = Object.entries(
    filteredPautas.reduce<Record<string, number>>((accumulator, pauta) => {
      const categoria = pauta.categoria || "outra";
      accumulator[categoria] = (accumulator[categoria] || 0) + 1;
      return accumulator;
    }, {}),
  ).map(([categoria, quantidade]) => ({
    categoria: categoria.charAt(0).toUpperCase() + categoria.slice(1),
    pautas: quantidade,
  }));

  const dadosReunioesMes = Object.entries(
    filteredReunioes.reduce<Record<string, number>>((accumulator, meeting) => {
      const mes = format(new Date(meeting.dataHoraInicio), "MMM/yyyy", { locale: ptBR });
      accumulator[mes] = (accumulator[mes] || 0) + 1;
      return accumulator;
    }, {}),
  ).map(([mes, reunioes]) => ({ mes, reunioes }));

  const summaryRows: SummaryRow[] = [
    { id: "projetos", indicador: "Projetos ativos", valor: String(kpis.projetosAtivos), contexto: `${kpis.totalProjetos} projetos no filtro` },
    { id: "valor", indicador: "Valor total", valor: `R$ ${(kpis.valorTotal / 1000000).toFixed(1)}M`, contexto: "Portfólio filtrado" },
    { id: "aprovacao", indicador: "Taxa de aprovação", valor: `${kpis.taxaAprovacao}%`, contexto: `${kpis.pautasAprovadas} de ${kpis.totalPautas} pautas` },
    { id: "reunioes", indicador: "Reuniões concluídas", valor: String(kpis.reunioesConcluidas), contexto: `${kpis.totalReunioes} agendadas` },
  ];

  const summaryColumns: HudTableColumn<SummaryRow>[] = [
    { key: "indicador", header: "Indicador", cell: (row) => <span className="font-medium text-ig-fg-strong">{row.indicador}</span> },
    { key: "valor", header: "Valor", align: "right", cell: (row) => <span className="font-semibold text-ig-accent">{row.valor}</span> },
    { key: "contexto", header: "Contexto", cell: (row) => <span className="text-ig-fg-muted">{row.contexto}</span> },
  ];

  const tooltipStyle = {
    backgroundColor: "var(--ig-bg-elevated)",
    border: "1px solid var(--ig-border)",
    borderRadius: "8px",
    color: "var(--ig-fg)",
  };

  const tabs: { id: ReportTab; label: string }[] = [
    { id: "projetos", label: "Projetos" },
    { id: "pautas", label: "Pautas" },
    { id: "reunioes", label: "Reuniões" },
    { id: "financeiro", label: "Financeiro" },
  ];

  return (
    <HudPageLayout>
      <HudHeader
        title="Relatórios"
        subtitle="Dashboards personalizáveis e análises detalhadas"
        icon={<BarChart3 size={18} />}
        iconTint="#3B82F6"
        actions={
          <div className="flex flex-wrap gap-2">
            <HudButton variant="secondary" leftIcon={<Download className="h-4 w-4" />}>
              Exportar
            </HudButton>
            <HudButton variant="secondary" leftIcon={<Settings className="h-4 w-4" />}>
              Configurar Dashboard
            </HudButton>
          </div>
        }
      />

      <HudPanel elevation={2} title="Filtros" subtitle="Recorte por período, comitê e tipo">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          <HudInput label="Data Início" type="date" value={dataInicio} onChange={(event) => setDataInicio(event.target.value)} />
          <HudInput label="Data Fim" type="date" value={dataFim} onChange={(event) => setDataFim(event.target.value)} />
          <HudSelect
            label="Comitê"
            value={comiteFiltro}
            onChange={setComiteFiltro}
            options={[{ value: "all", label: "Todos" }, ...comites.map((comite) => ({ value: comite.id, label: comite.nome }))]}
          />
          <HudSelect
            label="Tipo de Projeto"
            value={tipoProjetoFiltro}
            onChange={setTipoProjetoFiltro}
            options={[
              { value: "all", label: "Todos" },
              { value: "energia_solar", label: "Energia Solar" },
              { value: "eolica", label: "Eólica" },
              { value: "hidreletrica", label: "Hidrelétrica" },
              { value: "biomassa", label: "Biomassa" },
            ]}
          />
          <HudSelect
            label="Tipo de Reunião"
            value={tipoReuniaoFiltro}
            onChange={setTipoReuniaoFiltro}
            options={[
              { value: "all", label: "Todas" },
              { value: "presencial", label: "Presencial" },
              { value: "virtual", label: "Virtual" },
              { value: "hibrida", label: "Híbrida" },
            ]}
          />
        </div>
      </HudPanel>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <HudPanel elevation={2} title="Projetos Ativos" icon={<TrendingUp className="h-5 w-5" />} iconTint="#F59E0B">
          <p className="text-3xl font-semibold text-ig-fg-strong">{kpis.projetosAtivos}</p>
          <p className="mt-1 text-xs text-ig-fg-muted">de {kpis.totalProjetos} total</p>
        </HudPanel>
        <HudPanel elevation={2} title="Valor Total" icon={<BarChart3 className="h-5 w-5" />} iconTint="#14B8A6">
          <p className="text-3xl font-semibold text-ig-fg-strong">R$ {(kpis.valorTotal / 1000000).toFixed(1)}M</p>
          <p className="mt-1 text-xs text-ig-fg-muted">em projetos</p>
        </HudPanel>
        <HudPanel elevation={2} title="Taxa de Aprovação" icon={<PieChartIcon className="h-5 w-5" />} iconTint="#F59E0B">
          <p className="text-3xl font-semibold text-ig-fg-strong">{kpis.taxaAprovacao}%</p>
          <p className="mt-1 text-xs text-ig-fg-muted">{kpis.pautasAprovadas} de {kpis.totalPautas} pautas</p>
        </HudPanel>
        <HudPanel elevation={2} title="Reuniões Realizadas" icon={<Calendar className="h-5 w-5" />} iconTint="#3B82F6">
          <p className="text-3xl font-semibold text-ig-fg-strong">{kpis.reunioesConcluidas}</p>
          <p className="mt-1 text-xs text-ig-fg-muted">de {kpis.totalReunioes} agendadas</p>
        </HudPanel>
      </section>

      <div className="flex flex-wrap gap-2">
        {tabs.map((tab) => (
          <HudButton key={tab.id} variant={activeTab === tab.id ? "primary" : "secondary"} size="sm" onClick={() => setActiveTab(tab.id)}>
            {tab.label}
          </HudButton>
        ))}
      </div>

      {activeTab === "projetos" && (
        <div className="grid gap-6 xl:grid-cols-2">
          <HudPanel elevation={2} title="Evolução de Projetos" subtitle="Criação de projetos ao longo do tempo">
            <ResponsiveContainer width="100%" height={300}>
              <AreaChart data={dadosEvolucaoProjetos}>
                <CartesianGrid strokeDasharray="3 3" stroke={chartGrid} />
                <XAxis dataKey="mes" stroke={chartText} />
                <YAxis stroke={chartText} />
                <Tooltip contentStyle={tooltipStyle} />
                <Area type="monotone" dataKey="projetos" stroke="var(--ig-accent)" fill="var(--ig-accent-weak)" />
              </AreaChart>
            </ResponsiveContainer>
          </HudPanel>

          <HudPanel elevation={2} title="Status dos Projetos" subtitle="Distribuição por status">
            <ResponsiveContainer width="100%" height={300}>
              <RechartsPie>
                <Pie data={projetosPorStatus} cx="50%" cy="50%" outerRadius={82} dataKey="value" label={({ name, value }) => `${name}: ${value}`}>
                  {projetosPorStatus.map((entry, index) => (
                    <Cell key={entry.name} fill={chartColors[index % chartColors.length]} />
                  ))}
                </Pie>
                <Tooltip contentStyle={tooltipStyle} />
              </RechartsPie>
            </ResponsiveContainer>
          </HudPanel>
        </div>
      )}

      {activeTab === "pautas" && (
        <HudPanel elevation={2} title="Pautas por Categoria" subtitle="Distribuição de pautas por categoria">
          <ResponsiveContainer width="100%" height={400}>
            <BarChart data={dadosPautasCategoria}>
              <CartesianGrid strokeDasharray="3 3" stroke={chartGrid} />
              <XAxis dataKey="categoria" stroke={chartText} />
              <YAxis stroke={chartText} />
              <Tooltip contentStyle={tooltipStyle} />
              <Legend wrapperStyle={{ color: "var(--ig-fg-muted)" }} />
              <Bar dataKey="pautas" fill="var(--ig-accent)" />
            </BarChart>
          </ResponsiveContainer>
        </HudPanel>
      )}

      {activeTab === "reunioes" && (
        <HudPanel elevation={2} title="Frequência de Reuniões" subtitle="Reuniões realizadas por mês">
          <ResponsiveContainer width="100%" height={400}>
            <LineChart data={dadosReunioesMes}>
              <CartesianGrid strokeDasharray="3 3" stroke={chartGrid} />
              <XAxis dataKey="mes" stroke={chartText} />
              <YAxis stroke={chartText} />
              <Tooltip contentStyle={tooltipStyle} />
              <Legend wrapperStyle={{ color: "var(--ig-fg-muted)" }} />
              <Line type="monotone" dataKey="reunioes" stroke="var(--ig-accent)" strokeWidth={3} />
            </LineChart>
          </ResponsiveContainer>
        </HudPanel>
      )}

      {activeTab === "financeiro" && (
        <HudPanel elevation={2}>
          <div className="flex min-h-64 items-center justify-center">
            <div className="text-center">
              <FileText className="mx-auto mb-4 h-12 w-12 text-ig-fg-subtle" />
              <p className="text-sm text-ig-fg-muted">Dados financeiros disponíveis apenas para usuários autorizados.</p>
            </div>
          </div>
        </HudPanel>
      )}

      <HudPanel elevation={2} title="Resumo Executivo" subtitle="Indicadores principais do recorte atual">
        <HudTable columns={summaryColumns} data={summaryRows} keyExtractor={(row) => row.id} />
      </HudPanel>

      <div className="flex flex-wrap gap-2">
        <HudBadge variant="neutral">Período: {dataInicio} até {dataFim}</HudBadge>
        <HudBadge variant="info">Projetos: {filteredProjetos.length}</HudBadge>
        <HudBadge variant="info">Reuniões: {filteredReunioes.length}</HudBadge>
      </div>
    </HudPageLayout>
  );
}
