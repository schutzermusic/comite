'use client';
import React, { useState } from 'react';
import Link from 'next/link';
import {
  History,
  CheckCircle2,
  AlertCircle,
  MinusCircle,
  Calendar,
  Search,
  Filter,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { HUDCard } from '@/components/ui/hud-card';
import { StatusPill } from '@/components/ui/status-pill';
import { OrionGreenBackground } from '@/components/system/OrionGreenBackground';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { votes } from '@/lib/mock-data';

const pautas = votes
  .filter((v) => v.status === 'encerrada')
  .map((vote) => ({
    ...vote,
    descricao: `Deliberação sobre a pauta: ${vote.titulo}`,
    categoria: 'Estratégica', // Mock data
    resultado: vote.id === 'vote-01' ? 'aprovado' : 'reprovado', // Mock data
    created_date: vote.prazoFim,
  }));

export default function HistoricoPage() {
  const [searchTerm, setSearchTerm] = useState('');
  const [resultadoFilter, setResultadoFilter] = useState('all');
  const [categoriaFilter, setCategoriaFilter] = useState('all');

  const filteredPautas = pautas.filter((pauta) => {
    const matchesSearch = pauta.titulo
      .toLowerCase()
      .includes(searchTerm.toLowerCase());
    const matchesResultado =
      resultadoFilter === 'all' || pauta.resultado === resultadoFilter;
    const matchesCategoria =
      categoriaFilter === 'all' || pauta.categoria === categoriaFilter;
    return matchesSearch && matchesResultado && matchesCategoria;
  });

  const getResultadoVariant = (resultado: string): "success" | "error" | "warning" => {
    if (resultado === 'aprovado') return 'success';
    if (resultado === 'reprovado') return 'error';
    return 'warning';
  };

  const getResultadoIcon = (resultado: string) => {
    const config: {
      [key: string]: {
        icon: React.ElementType;
      };
    } = {
      aprovado: {
        icon: CheckCircle2,
      },
      reprovado: {
        icon: AlertCircle,
      },
      empate: {
        icon: MinusCircle,
      },
    };
    return config[resultado] || config.empate;
  };

  const stats = {
    total: pautas.length,
    aprovadas: pautas.filter((p) => p.resultado === 'aprovado').length,
    reprovadas: pautas.filter((p) => p.resultado === 'reprovado').length,
    empates: pautas.filter((p) => p.resultado === 'empate').length,
  };

  return (
    <OrionGreenBackground className="orion-page">
      <div className="orion-page-content max-w-[1800px] mx-auto space-y-6">
        <header className="mb-8">
          <h1 className="text-2xl font-semibold text-white mb-1 tracking-wide">
            Histórico de Decisões
          </h1>
          <p className="text-sm text-[rgba(255,255,255,0.65)]">
            Consulte todas as votações finalizadas
          </p>
        </header>

        <section className="grid md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <HUDCard glow glowColor="cyan">
            <div className="flex items-center justify-between mb-2">
              <History className="w-6 h-6 text-[#00C8FF]" />
            </div>
            <p className="text-xs text-[rgba(255,255,255,0.65)] mb-1 uppercase tracking-wide">Total</p>
            <p className="text-3xl font-semibold text-white">{stats.total}</p>
          </HUDCard>

          <HUDCard glow glowColor="green">
            <div className="flex items-center justify-between mb-2">
              <CheckCircle2 className="w-6 h-6 text-[#00FFB4]" />
            </div>
            <p className="text-xs text-[rgba(255,255,255,0.65)] mb-1 uppercase tracking-wide">Aprovadas</p>
            <p className="text-3xl font-semibold text-white">{stats.aprovadas}</p>
          </HUDCard>

          <HUDCard glow glowColor="red">
            <div className="flex items-center justify-between mb-2">
              <AlertCircle className="w-6 h-6 text-[#FF5860]" />
            </div>
            <p className="text-xs text-[rgba(255,255,255,0.65)] mb-1 uppercase tracking-wide">Reprovadas</p>
            <p className="text-3xl font-semibold text-white">{stats.reprovadas}</p>
          </HUDCard>

          <HUDCard glow glowColor="amber">
            <div className="flex items-center justify-between mb-2">
              <MinusCircle className="w-6 h-6 text-[#FFB04D]" />
            </div>
            <p className="text-xs text-[rgba(255,255,255,0.65)] mb-1 uppercase tracking-wide">Empates</p>
            <p className="text-3xl font-semibold text-white">{stats.empates}</p>
          </HUDCard>
        </section>

        <HUDCard>
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-xs font-medium text-[rgba(255,255,255,0.65)] uppercase tracking-wide">
              <Filter className="w-4 h-4" />
              Filtros
            </div>
            <div className="flex flex-col lg:flex-row gap-4">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-[rgba(255,255,255,0.40)]" />
                <Input
                  placeholder="Buscar por título..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10 bg-[rgba(255,255,255,0.05)] border-[rgba(255,255,255,0.08)] text-white placeholder:text-[rgba(255,255,255,0.40)] focus:border-[rgba(0,255,180,0.25)]"
                />
              </div>
              <Select value={categoriaFilter} onValueChange={setCategoriaFilter}>
                <SelectTrigger className="w-full lg:w-48 bg-[rgba(255,255,255,0.05)] border-[rgba(255,255,255,0.08)] text-white hover:border-[rgba(0,255,180,0.25)] focus:border-[rgba(0,255,180,0.25)]">
                  <Filter className="w-4 h-4 mr-2 text-[rgba(255,255,255,0.65)]" />
                  <SelectValue placeholder="Categoria" />
                </SelectTrigger>
                <SelectContent className="bg-gradient-to-br from-[#07130F] to-[#030B09] border-[rgba(255,255,255,0.08)]">
                  <SelectItem value="all" className="text-white focus:bg-[rgba(0,255,180,0.12)] focus:text-[#00FFB4]">Todas Categorias</SelectItem>
                  <SelectItem value="estrategica" className="text-white focus:bg-[rgba(0,255,180,0.12)] focus:text-[#00FFB4]">Estratégica</SelectItem>
                  <SelectItem value="financeira" className="text-white focus:bg-[rgba(0,255,180,0.12)] focus:text-[#00FFB4]">Financeira</SelectItem>
                  <SelectItem value="operacional" className="text-white focus:bg-[rgba(0,255,180,0.12)] focus:text-[#00FFB4]">Operacional</SelectItem>
                  <SelectItem value="rh" className="text-white focus:bg-[rgba(0,255,180,0.12)] focus:text-[#00FFB4]">RH</SelectItem>
                  <SelectItem value="juridica" className="text-white focus:bg-[rgba(0,255,180,0.12)] focus:text-[#00FFB4]">Jurídica</SelectItem>
                  <SelectItem value="ti" className="text-white focus:bg-[rgba(0,255,180,0.12)] focus:text-[#00FFB4]">TI</SelectItem>
                  <SelectItem value="outra" className="text-white focus:bg-[rgba(0,255,180,0.12)] focus:text-[#00FFB4]">Outra</SelectItem>
                </SelectContent>
              </Select>
              <Select value={resultadoFilter} onValueChange={setResultadoFilter}>
                <SelectTrigger className="w-full lg:w-48 bg-[rgba(255,255,255,0.05)] border-[rgba(255,255,255,0.08)] text-white hover:border-[rgba(0,255,180,0.25)] focus:border-[rgba(0,255,180,0.25)]">
                  <Filter className="w-4 h-4 mr-2 text-[rgba(255,255,255,0.65)]" />
                  <SelectValue placeholder="Resultado" />
                </SelectTrigger>
                <SelectContent className="bg-gradient-to-br from-[#07130F] to-[#030B09] border-[rgba(255,255,255,0.08)]">
                  <SelectItem value="all" className="text-white focus:bg-[rgba(0,255,180,0.12)] focus:text-[#00FFB4]">Todos Resultados</SelectItem>
                  <SelectItem value="aprovado" className="text-white focus:bg-[rgba(0,255,180,0.12)] focus:text-[#00FFB4]">Aprovado</SelectItem>
                  <SelectItem value="reprovado" className="text-white focus:bg-[rgba(0,255,180,0.12)] focus:text-[#00FFB4]">Reprovado</SelectItem>
                  <SelectItem value="empate" className="text-white focus:bg-[rgba(0,255,180,0.12)] focus:text-[#00FFB4]">Empate</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </HUDCard>

        <div className="space-y-4">
          {filteredPautas.map((pauta) => {
            const resultadoConfig = getResultadoIcon(pauta.resultado);
            const Icon = resultadoConfig.icon;

            return (
              <Link key={pauta.id} href={`/votacoes/${pauta.id}`}>
                <HUDCard className="hover:border-[rgba(0,255,180,0.12)] transition-all cursor-pointer">
                  <div className="flex flex-col lg:flex-row gap-6">
                    <div className="flex items-center justify-center w-16 h-16 rounded-xl bg-[rgba(0,255,180,0.12)] border border-[rgba(0,255,180,0.25)] flex-shrink-0">
                      <Icon className="w-8 h-8 text-[#00FFB4]" />
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-start justify-between gap-4 mb-3">
                        <div className="flex-1 min-w-0">
                          <h3 className="text-lg font-semibold text-white mb-2 tracking-wide">
                            {pauta.titulo}
                          </h3>
                          <p className="text-sm text-[rgba(255,255,255,0.65)] line-clamp-2">
                            {pauta.descricao}
                          </p>
                        </div>
                        <StatusPill variant={getResultadoVariant(pauta.resultado)}>
                          {pauta.resultado.charAt(0).toUpperCase() + pauta.resultado.slice(1)}
                        </StatusPill>
                      </div>

                      <div className="flex flex-wrap gap-2 mb-4">
                        <StatusPill variant="neutral">{pauta.categoria}</StatusPill>
                        <StatusPill variant="info">{pauta.comite}</StatusPill>
                      </div>
                      <div className="flex items-center gap-2 text-xs text-[rgba(255,255,255,0.40)]">
                        <Calendar className="w-3 h-3" />
                        <span>
                          Encerrada em {format(new Date(pauta.created_date), "dd 'de' MMMM, yyyy", { locale: ptBR })}
                        </span>
                      </div>
                    </div>
                  </div>
                </HUDCard>
              </Link>
            );
          })}
        </div>
      </div>
    </OrionGreenBackground>
  );
}
