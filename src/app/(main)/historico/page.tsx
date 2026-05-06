'use client';

import Link from "next/link";
import { useMemo, useState } from "react";
import { AlertCircle, Calendar, CheckCircle2, Filter, History, MinusCircle, Search } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { HudBadge } from "@/components/hud/HudBadge";
import { HudButton } from "@/components/hud/HudButton";
import { HudHeader } from "@/components/hud/HudHeader";
import { HudInput } from "@/components/hud/HudInput";
import { HudPageLayout } from "@/components/hud/HudPageLayout";
import { HudPanel } from "@/components/hud/HudPanel";
import { HudSelect } from "@/components/hud/HudSelect";
import { HudTable } from "@/components/hud/HudTable";
import type { HudTableColumn } from "@/components/hud/HudTable";
import { votes } from "@/lib/mock-data";

type Resultado = "aprovado" | "reprovado" | "empate";

interface HistoricoPauta {
  id: string;
  titulo: string;
  descricao: string;
  categoria: string;
  comite: string;
  resultado: Resultado;
  created_date: string;
}

const pautas: HistoricoPauta[] = votes
  .filter((vote) => vote.status === "encerrada")
  .map((vote, index) => ({
    id: vote.id,
    titulo: vote.titulo,
    descricao: `Decisão de comitê sobre: ${vote.titulo}`,
    categoria: vote.categoria || "estrategica",
    comite: vote.comite,
    resultado: index === 0 ? "aprovado" : "reprovado",
    created_date: vote.prazoFim,
  }));

function resultadoVariant(resultado: Resultado): "success" | "danger" | "warning" {
  if (resultado === "aprovado") return "success";
  if (resultado === "reprovado") return "danger";
  return "warning";
}

function resultadoIcon(resultado: Resultado) {
  if (resultado === "aprovado") return CheckCircle2;
  if (resultado === "reprovado") return AlertCircle;
  return MinusCircle;
}

export default function HistoricoPage() {
  const [searchTerm, setSearchTerm] = useState("");
  const [resultadoFilter, setResultadoFilter] = useState("all");
  const [categoriaFilter, setCategoriaFilter] = useState("all");

  const categorias = useMemo(
    () => Array.from(new Set(pautas.map((pauta) => pauta.categoria))).map((categoria) => ({ value: categoria, label: categoria })),
    [],
  );

  const filteredPautas = useMemo(() => {
    const normalizedSearch = searchTerm.trim().toLowerCase();

    return pautas.filter((pauta) => {
      const matchesSearch =
        !normalizedSearch ||
        pauta.titulo.toLowerCase().includes(normalizedSearch) ||
        pauta.descricao.toLowerCase().includes(normalizedSearch);
      const matchesResultado = resultadoFilter === "all" || pauta.resultado === resultadoFilter;
      const matchesCategoria = categoriaFilter === "all" || pauta.categoria === categoriaFilter;
      return matchesSearch && matchesResultado && matchesCategoria;
    });
  }, [categoriaFilter, resultadoFilter, searchTerm]);

  const stats = {
    total: pautas.length,
    aprovadas: pautas.filter((pauta) => pauta.resultado === "aprovado").length,
    reprovadas: pautas.filter((pauta) => pauta.resultado === "reprovado").length,
    empates: pautas.filter((pauta) => pauta.resultado === "empate").length,
  };

  const columns: HudTableColumn<HistoricoPauta>[] = [
    {
      key: "titulo",
      header: "Pauta",
      cell: (pauta) => {
        const Icon = resultadoIcon(pauta.resultado);

        return (
          <Link href={`/votacoes/${pauta.id}`} className="flex items-start gap-3">
            <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-ig-border-focus bg-ig-accent-weak text-ig-accent">
              <Icon className="h-4 w-4" />
            </span>
            <span className="min-w-0">
              <span className="block font-medium text-ig-fg-strong">{pauta.titulo}</span>
              <span className="mt-1 block text-xs text-ig-fg-muted">{pauta.descricao}</span>
            </span>
          </Link>
        );
      },
    },
    {
      key: "resultado",
      header: "Resultado",
      cell: (pauta) => (
        <HudBadge variant={resultadoVariant(pauta.resultado)} dot>
          {pauta.resultado.charAt(0).toUpperCase() + pauta.resultado.slice(1)}
        </HudBadge>
      ),
    },
    {
      key: "categoria",
      header: "Categoria",
      cell: (pauta) => <HudBadge variant="neutral">{pauta.categoria}</HudBadge>,
    },
    {
      key: "comite",
      header: "Comitê",
      cell: (pauta) => <span className="text-ig-fg-muted">{pauta.comite}</span>,
    },
    {
      key: "created_date",
      header: "Encerrada em",
      align: "right",
      cell: (pauta) => (
        <span className="inline-flex items-center justify-end gap-2 text-ig-fg-muted">
          <Calendar className="h-3.5 w-3.5" />
          {format(new Date(pauta.created_date), "dd MMM yyyy", { locale: ptBR })}
        </span>
      ),
    },
  ];

  return (
    <HudPageLayout>
      <HudHeader
        title="Histórico de Atividades"
        subtitle="Consulte todas as votações finalizadas"
        icon={<History size={18} />}
        iconTint="#64748B"
      />

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <HudPanel elevation={2} title="Total" icon={<History className="h-5 w-5" />} iconTint="#64748B">
          <p className="text-3xl font-semibold text-ig-fg-strong">{stats.total}</p>
        </HudPanel>
        <HudPanel elevation={2} title="Aprovadas" icon={<CheckCircle2 className="h-5 w-5" />} iconTint="#14B8A6">
          <p className="text-3xl font-semibold text-ig-fg-strong">{stats.aprovadas}</p>
        </HudPanel>
        <HudPanel elevation={2} title="Reprovadas" icon={<AlertCircle className="h-5 w-5" />} iconTint="#EF4444">
          <p className="text-3xl font-semibold text-ig-fg-strong">{stats.reprovadas}</p>
        </HudPanel>
        <HudPanel elevation={2} title="Empates" icon={<MinusCircle className="h-5 w-5" />} iconTint="#F59E0B">
          <p className="text-3xl font-semibold text-ig-fg-strong">{stats.empates}</p>
        </HudPanel>
      </section>

      <HudPanel elevation={2} title="Filtros" icon={<Filter className="h-5 w-5" />}>
        <div className="grid gap-4 lg:grid-cols-[1fr_220px_220px_auto]">
          <HudInput
            placeholder="Buscar por título..."
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            leftIcon={<Search className="h-4 w-4" />}
          />
          <HudSelect
            value={categoriaFilter}
            onChange={setCategoriaFilter}
            options={[{ value: "all", label: "Todas Categorias" }, ...categorias]}
          />
          <HudSelect
            value={resultadoFilter}
            onChange={setResultadoFilter}
            options={[
              { value: "all", label: "Todos Resultados" },
              { value: "aprovado", label: "Aprovado" },
              { value: "reprovado", label: "Reprovado" },
              { value: "empate", label: "Empate" },
            ]}
          />
          <HudButton
            variant="secondary"
            onClick={() => {
              setSearchTerm("");
              setResultadoFilter("all");
              setCategoriaFilter("all");
            }}
          >
            Limpar
          </HudButton>
        </div>
      </HudPanel>

      <HudPanel elevation={2} title="Votações Finalizadas" subtitle={`${filteredPautas.length} registro(s) no recorte atual`}>
        <HudTable
          columns={columns}
          data={filteredPautas}
          keyExtractor={(pauta) => pauta.id}
          emptyState={<p className="py-8 text-center text-sm text-ig-fg-muted">Nenhuma votação finalizada encontrada.</p>}
        />
      </HudPanel>
    </HudPageLayout>
  );
}
