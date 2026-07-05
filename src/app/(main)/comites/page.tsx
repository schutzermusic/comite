'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Building2,
  Plus,
  Users,
  Users2,
  FileText,
  Shield,
  Eye,
  Settings,
} from 'lucide-react';
import { projects } from '@/lib/mock-data';

import {
  HudPageLayout,
  HudHeader,
  HudKpiStrip,
  HudFilterBar,
  HudPanel,
  HudButton,
  HudStatusPill,
  HudEmptyState,
  type KpiItem,
} from '@/components/hud';

const comites = projects
  .filter((p, i, arr) => arr.findIndex((o) => o.comiteResponsavel === p.comiteResponsavel) === i)
  .map((p, index) => ({
  id: p.id,
  nome: p.comiteResponsavel,
  descricao: `Comitê responsável por projetos ${p.comiteResponsavel.split(' ')[1].toLowerCase()}.`,
  status: index % 3 === 0 ? 'inativo' : 'ativo',
  tipo: ['executivo', 'consultivo', 'fiscal', 'estrategico', 'operacional', 'especial'][index % 6] as string,
  cor: ['#FF7A3D', '#008751', '#4CAF7B', '#FFB347', '#3F51B5', '#9C27B0'][index % 6],
  total_membros: Math.floor(Math.random() * 10) + 5,
  total_pautas: Math.floor(Math.random() * 20) + 1,
  quorum_minimo: 50,
  percentual_aprovacao: 51,
  votacao_anonima: index % 2 === 0,
  presidente_nome: 'Alice Johnson',
}));

export default function ComitesPage() {
  const router = useRouter();
  const [searchTerm, setSearchTerm] = useState('');
  // Single-select KPI filter (padrão Contratos): clicar filtra, clicar de novo limpa.
  const [onlyActive, setOnlyActive] = useState(false);
  const isAdmin = true;

  const filteredComites = comites.filter(
    (comite) =>
      (comite.nome.toLowerCase().includes(searchTerm.toLowerCase()) ||
        comite.descricao?.toLowerCase().includes(searchTerm.toLowerCase())) &&
      (!onlyActive || comite.status === 'ativo')
  );

  const getStatusVariant = (status: string) => {
    if (status === 'ativo') return 'active' as const;
    if (status === 'suspenso') return 'warning' as const;
    return 'neutral' as const;
  };

  const getTipoIcon = (tipo: string) => {
    const icons: Record<string, React.ElementType> = {
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

  const kpiItems: KpiItem[] = [
    { id: 'total', value: stats.total, label: 'Total de Comitês', variant: 'info', icon: <Building2 className="w-5 h-5" />, onClick: () => { setOnlyActive(false); setSearchTerm(''); } },
    { id: 'ativos', value: stats.ativos, label: 'Comitês Ativos', variant: 'success', icon: <Shield className="w-5 h-5" />, onClick: () => setOnlyActive((v) => !v), active: onlyActive },
    { id: 'membros', value: stats.totalMembros, label: 'Total de Membros', variant: 'info', icon: <Users className="w-5 h-5" />, onClick: () => router.push('/membros') },
    { id: 'pautas', value: stats.totalPautas, label: 'Total de Pautas', variant: 'warning', icon: <FileText className="w-5 h-5" />, onClick: () => router.push('/pautas') },
  ];

  return (
    <HudPageLayout>
      <HudHeader
        title="Comitês"
        subtitle="Administre os comitês e suas configurações"
        icon={<Users2 size={18} />}
        iconTint="#F5A524"
        breadcrumbs={[{ label: 'Comitês' }]}
        actions={
          isAdmin ? (
            <Link href="/comites/novo">
              <HudButton variant="primary" size="md" leftIcon={<Plus className="w-4 h-4" />}>
                Novo Comitê
              </HudButton>
            </Link>
          ) : undefined
        }
      />

      <HudKpiStrip kpis={kpiItems} columns={4} />

      <HudFilterBar
        searchPlaceholder="Buscar comitês..."
        searchValue={searchTerm}
        onSearchChange={setSearchTerm}
      />

      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filteredComites.map((comite, idx) => {
          const TipoIcon = getTipoIcon(comite.tipo);
          return (
            <Link key={comite.id} href={`/comites/${comite.id}`}>
              <HudPanel delay={idx * 0.04} className="h-full cursor-pointer">
                <div className="space-y-4">
                  <div className="flex justify-between items-start">
                    <div className="flex items-center gap-3">
                      <div className="p-2.5 rounded-xl bg-ig-accent-weak border border-ig-border-focus">
                        {React.createElement(TipoIcon, { className: "w-5 h-5 text-ig-accent" })}
                      </div>
                      <div>
                        <h3 className="text-base font-semibold text-ig-fg-strong">{comite.nome}</h3>
                        <HudStatusPill variant="info" size="sm">{comite.tipo}</HudStatusPill>
                      </div>
                    </div>
                    <HudStatusPill variant={getStatusVariant(comite.status)}>
                      {comite.status}
                    </HudStatusPill>
                  </div>

                  <p className="text-sm text-ig-fg-muted line-clamp-3">{comite.descricao}</p>

                  <div className="grid grid-cols-2 gap-4 pt-3 border-t border-ig-border">
                    <div>
                      <p className="text-xs text-ig-fg-subtle mb-1 uppercase tracking-wider">Membros</p>
                      <p className="text-xl font-semibold text-ig-fg-strong tabular-nums">{comite.total_membros || 0}</p>
                    </div>
                    <div>
                      <p className="text-xs text-ig-fg-subtle mb-1 uppercase tracking-wider">Pautas</p>
                      <p className="text-xl font-semibold text-ig-fg-strong tabular-nums">{comite.total_pautas || 0}</p>
                    </div>
                  </div>

                  <div className="space-y-2 pt-3 border-t border-ig-border text-xs text-ig-fg-muted">
                    <div className="flex justify-between">
                      <span>Quórum mínimo:</span>
                      <span className="font-semibold text-ig-fg-strong tabular-nums">{comite.quorum_minimo}%</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Aprovação:</span>
                      <span className="font-semibold text-ig-fg-strong tabular-nums">{comite.percentual_aprovacao}%</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Votação anônima:</span>
                      <span className="font-semibold text-ig-fg-strong">{comite.votacao_anonima ? 'Sim' : 'Não'}</span>
                    </div>
                  </div>

                  {comite.presidente_nome && (
                    <div className="pt-3 border-t border-ig-border">
                      <p className="text-xs text-ig-fg-subtle mb-1 uppercase tracking-wider">Presidente</p>
                      <p className="font-medium text-sm text-ig-fg-strong">{comite.presidente_nome}</p>
                    </div>
                  )}
                </div>
              </HudPanel>
            </Link>
          );
        })}
      </div>

      {filteredComites.length === 0 && (
        <HudPanel>
          <HudEmptyState
            icon="package"
            title="Nenhum comitê encontrado"
            description={searchTerm ? 'Tente ajustar sua busca' : 'Comece criando seu primeiro comitê'}
            action={
              !searchTerm && isAdmin
                ? { label: 'Criar Primeiro Comitê', onClick: () => {}, variant: 'primary' }
                : undefined
            }
          />
        </HudPanel>
      )}
    </HudPageLayout>
  );
}
