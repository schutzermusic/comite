'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import {
  Building2,
  Plus,
  Users,
  FileText,
  Search,
  Settings,
  Shield,
  Eye,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { PrimaryCTA } from '@/components/ui/primary-cta';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { HUDCard } from '@/components/ui/hud-card';
import { StatusPill } from '@/components/ui/status-pill';
import { OrionGreenBackground } from '@/components/system/OrionGreenBackground';
import { projects } from '@/lib/mock-data'; // Using projects as mock comites for now

// Mocking comites data structure based on the provided component logic
const comites = projects.map((p, index) => ({
  id: p.id,
  nome: p.comiteResponsavel,
  descricao: `Comitê responsável por projetos ${p.comiteResponsavel.split(' ')[1].toLowerCase()}.`,
  status: index % 3 === 0 ? 'inativo' : 'ativo',
  tipo: ['executivo', 'consultivo', 'fiscal', 'estrategico', 'operacional', 'especial'][index % 6] as any,
  cor: ['#FF7A3D', '#008751', '#4CAF7B', '#FFB347', '#3F51B5', '#9C27B0'][index % 6],
  total_membros: Math.floor(Math.random() * 10) + 5,
  total_pautas: Math.floor(Math.random() * 20) + 1,
  quorum_minimo: 50,
  percentual_aprovacao: 51,
  votacao_anonima: index % 2 === 0,
  presidente_nome: 'Alice Johnson'
}));


export default function ComitesPage() {
  const [searchTerm, setSearchTerm] = useState('');

  // Mocking isAdmin for now
  const isAdmin = true;

  const filteredComites = comites.filter(
    (comite) =>
      comite.nome.toLowerCase().includes(searchTerm.toLowerCase()) ||
      comite.descricao?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const getStatusVariant = (status: string): "active" | "neutral" | "warning" => {
    if (status === 'ativo') return 'active';
    if (status === 'suspenso') return 'warning';
    return 'neutral';
  };

  const getTipoIcon = (tipo: string) => {
    const icons: { [key: string]: React.ElementType } = {
      executivo: Shield,
      consultivo: Users,
      fiscal: Eye,
      estrategico: Building2,
      operacional: Settings,
      especial: FileText,
    };
    return icons[tipo] || Building2;
  };

  const stats = {
    total: comites.length,
    ativos: comites.filter((c) => c.status === 'ativo').length,
    totalMembros: comites.reduce((sum, c) => sum + (c.total_membros || 0), 0),
    totalPautas: comites.reduce((sum, c) => sum + (c.total_pautas || 0), 0),
  };

  return (
    <OrionGreenBackground className="orion-page">
      <div className="orion-page-content max-w-[1800px] mx-auto space-y-6">
        <header className="mb-8">
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
            <div>
              <h1 className="text-2xl font-semibold text-white mb-1 tracking-wide">
                Gerenciamento de Comitês
              </h1>
              <p className="text-sm text-[rgba(255,255,255,0.65)]">
                Administre os comitês e suas configurações
              </p>
            </div>
            {isAdmin && (
              <Link href="/comites/novo">
                <PrimaryCTA>
                  <Plus className="w-4 h-4 mr-2" />
                  Novo Comitê
                </PrimaryCTA>
              </Link>
            )}
          </div>
        </header>

        <section className="grid md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <HUDCard glow glowColor="cyan">
            <div className="flex items-center justify-between mb-2">
              <Building2 className="w-6 h-6 text-[#00C8FF]" />
            </div>
            <p className="text-xs text-[rgba(255,255,255,0.65)] mb-1 uppercase tracking-wide">Total de Comitês</p>
            <p className="text-3xl font-semibold text-white">{stats.total}</p>
          </HUDCard>

          <HUDCard glow glowColor="green">
            <div className="flex items-center justify-between mb-2">
              <Shield className="w-6 h-6 text-[#00FFB4]" />
            </div>
            <p className="text-xs text-[rgba(255,255,255,0.65)] mb-1 uppercase tracking-wide">Comitês Ativos</p>
            <p className="text-3xl font-semibold text-white">{stats.ativos}</p>
          </HUDCard>

          <HUDCard glow glowColor="cyan">
            <div className="flex items-center justify-between mb-2">
              <Users className="w-6 h-6 text-[#00C8FF]" />
            </div>
            <p className="text-xs text-[rgba(255,255,255,0.65)] mb-1 uppercase tracking-wide">Total de Membros</p>
            <p className="text-3xl font-semibold text-white">{stats.totalMembros}</p>
          </HUDCard>

          <HUDCard glow glowColor="amber">
            <div className="flex items-center justify-between mb-2">
              <FileText className="w-6 h-6 text-[#FFB04D]" />
            </div>
            <p className="text-xs text-[rgba(255,255,255,0.65)] mb-1 uppercase tracking-wide">Total de Pautas</p>
            <p className="text-3xl font-semibold text-white">{stats.totalPautas}</p>
          </HUDCard>
        </section>

        <HUDCard>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-[rgba(255,255,255,0.40)]" />
            <Input
              placeholder="Buscar comitês..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10 bg-[rgba(255,255,255,0.05)] border-[rgba(255,255,255,0.08)] text-white placeholder:text-[rgba(255,255,255,0.40)] focus:border-[rgba(0,255,180,0.25)]"
            />
          </div>
        </HUDCard>

      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filteredComites.map((comite) => {
          const TipoIcon = getTipoIcon(comite.tipo);
          return (
            <Link key={comite.id} href={`/comites/${comite.id}`}>
              <HUDCard className="h-full hover:border-[rgba(0,255,180,0.12)] transition-all cursor-pointer">
                <div className="space-y-4">
                  <div className="flex justify-between items-start">
                    <div className="flex items-center gap-3">
                      <div className="p-3 rounded-xl bg-[rgba(0,255,180,0.12)] border border-[rgba(0,255,180,0.25)]">
                        <TipoIcon className="w-6 h-6 text-[#00FFB4]" />
                      </div>
                      <div>
                        <h3 className="text-base font-semibold text-white">{comite.nome}</h3>
                        <StatusPill variant="info" className="mt-1 text-xs">
                          {comite.tipo}
                        </StatusPill>
                      </div>
                    </div>
                    <StatusPill variant={getStatusVariant(comite.status)}>
                      {comite.status}
                    </StatusPill>
                  </div>

                  <p className="text-sm text-[rgba(255,255,255,0.65)] line-clamp-3">
                    {comite.descricao}
                  </p>

                  <div className="grid grid-cols-2 gap-4 pt-4 border-t border-[rgba(255,255,255,0.05)]">
                    <div>
                      <p className="text-xs text-[rgba(255,255,255,0.40)] mb-1">Membros</p>
                      <p className="text-2xl font-semibold text-white">
                        {comite.total_membros || 0}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-[rgba(255,255,255,0.40)] mb-1">Pautas</p>
                      <p className="text-2xl font-semibold text-white">
                        {comite.total_pautas || 0}
                      </p>
                    </div>
                  </div>

                  <div className="space-y-2 pt-4 border-t border-[rgba(255,255,255,0.05)] text-xs text-[rgba(255,255,255,0.65)]">
                    <div className="flex justify-between">
                      <span>Quórum mínimo:</span>
                      <span className="font-semibold text-white">
                        {comite.quorum_minimo}%
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span>Aprovação:</span>
                      <span className="font-semibold text-white">
                        {comite.percentual_aprovacao}%
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span>Votação anônima:</span>
                      <span className="font-semibold text-white">
                        {comite.votacao_anonima ? 'Sim' : 'Não'}
                      </span>
                    </div>
                  </div>

                  {comite.presidente_nome && (
                    <div className="pt-4 border-t border-[rgba(255,255,255,0.05)]">
                      <p className="text-xs text-[rgba(255,255,255,0.40)] mb-1">Presidente</p>
                      <p className="font-medium text-sm text-white">
                        {comite.presidente_nome}
                      </p>
                    </div>
                  )}
                </div>
              </HUDCard>
            </Link>
          );
        })}
      </div>

        {filteredComites.length === 0 && (
          <HUDCard>
            <div className="p-12 text-center">
              <Building2 className="w-16 h-16 text-[rgba(255,255,255,0.20)] mx-auto mb-4" />
              <h3 className="text-lg font-semibold text-white mb-2">
                Nenhum comitê encontrado
              </h3>
              <p className="text-[rgba(255,255,255,0.65)] mb-6">
                {searchTerm
                  ? 'Tente ajustar sua busca'
                  : 'Comece criando seu primeiro comitê'}
              </p>
              {!searchTerm && isAdmin && (
                <Link href="/comites/novo">
                  <Button className="bg-[#00FFB4] text-[#050D0A] hover:bg-[#00E6A0] font-medium shadow-[0_0_18px_rgba(0,255,180,0.18)]">
                    <Plus className="w-4 h-4 mr-2" />
                    Criar Primeiro Comitê
                  </Button>
                </Link>
              )}
            </div>
          </HUDCard>
        )}
      </div>
    </OrionGreenBackground>
  );
}
