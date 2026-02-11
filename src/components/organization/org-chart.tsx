'use client';

import { useState, useMemo } from 'react';
import { User } from '@/lib/types';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { HUDCard } from '@/components/ui/hud-card';
import { Input } from '@/components/ui/input';
import { Search, Users as UsersIcon, Building2, AlertTriangle } from 'lucide-react';
import { users as mockUsers } from '@/lib/mock-data';

interface OrgChartProps {
  users?: User[];
  onSelectMember?: (user: User) => void;
  selectedMemberId?: string;
  showSearch?: boolean;
}

// Mock hierarchical structure - in production this would come from API
const buildOrgStructure = (users: User[]) => {
  // Simulate hierarchy based on papelPrincipal
  const hierarchy: Record<string, User[]> = {
    admin: [],
    gerenteProjeto: [],
    membroComite: [],
    visualizador: [],
  };

  users.forEach((user) => {
    if (user.papelPrincipal in hierarchy) {
      hierarchy[user.papelPrincipal].push(user);
    }
  });

  return hierarchy;
};

export function OrgChart({
  users = mockUsers,
  onSelectMember,
  selectedMemberId,
  showSearch = true,
}: OrgChartProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedDepartment, setSelectedDepartment] = useState<string>('all');

  const hierarchy = useMemo(() => buildOrgStructure(users), [users]);

  const filteredUsers = useMemo(() => {
    let filtered = users;

    if (searchTerm) {
      filtered = filtered.filter(
        (user) =>
          user.nome.toLowerCase().includes(searchTerm.toLowerCase()) ||
          user.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
          user.cargo?.toLowerCase().includes(searchTerm.toLowerCase())
      );
    }

    if (selectedDepartment !== 'all') {
      filtered = filtered.filter((user) => user.papelPrincipal === selectedDepartment);
    }

    return filtered;
  }, [users, searchTerm, selectedDepartment]);

  const getMemberInitials = (name: string) => {
    return name
      .split(' ')
      .map((n) => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  };

  const getRoleLabel = (papel: string) => {
    const labels: Record<string, string> = {
      admin: 'Administrador',
      gerenteProjeto: 'Gerente de Projeto',
      membroComite: 'Membro de Comitê',
      visualizador: 'Visualizador',
    };
    return labels[papel] || papel;
  };

  const getRoleColor = (papel: string) => {
    const colors: Record<string, string> = {
      admin: 'bg-purple-500/20 text-purple-300 border-purple-500/30',
      gerenteProjeto: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
      membroComite: 'bg-green-500/20 text-green-300 border-green-500/30',
      visualizador: 'bg-slate-500/20 text-slate-300 border-slate-500/30',
    };
    return colors[papel] || colors.visualizador;
  };

  // Calculate workload for each user (mock - in production would come from allocations)
  const getUserWorkload = (userId: string) => {
    // Mock workload calculation
    const workloads: Record<string, { percent: number; hours: number }> = {
      'user-1': { percent: 85, hours: 34 },
      'user-2': { percent: 120, hours: 48 },
      'user-3': { percent: 60, hours: 24 },
      'user-4': { percent: 90, hours: 36 },
      'user-5': { percent: 40, hours: 16 },
    };
    return workloads[userId] || { percent: 0, hours: 0 };
  };

  return (
    <div className="space-y-4">
      {showSearch && (
        <div className="space-y-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-[rgba(255,255,255,0.40)]" />
            <Input
              placeholder="Buscar colaborador por nome, email ou cargo..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10 bg-[rgba(255,255,255,0.05)] border-[rgba(255,255,255,0.08)] text-white placeholder:text-[rgba(255,255,255,0.40)] focus:border-[rgba(0,255,180,0.25)]"
            />
          </div>

          <div className="flex gap-2 flex-wrap">
            <Button
              variant={selectedDepartment === 'all' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setSelectedDepartment('all')}
              className={
                selectedDepartment === 'all'
                  ? 'bg-[#00FFB4] text-[#050D0A] hover:bg-[#00E6A0]'
                  : 'border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.05)] text-white hover:bg-[rgba(255,255,255,0.08)]'
              }
            >
              Todos
            </Button>
            {Object.keys(hierarchy).map((dept) => (
              <Button
                key={dept}
                variant={selectedDepartment === dept ? 'default' : 'outline'}
                size="sm"
                onClick={() => setSelectedDepartment(dept)}
                className={
                  selectedDepartment === dept
                    ? 'bg-[#00FFB4] text-[#050D0A] hover:bg-[#00E6A0]'
                    : 'border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.05)] text-white hover:bg-[rgba(255,255,255,0.08)]'
                }
              >
                {getRoleLabel(dept)}
              </Button>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 max-h-[600px] overflow-y-auto">
        {filteredUsers.map((user) => {
          const workload = getUserWorkload(user.id);
          const isSelected = selectedMemberId === user.id;
          const isOverloaded = workload.percent > 100;

          return (
            <HUDCard
              key={user.id}
              className={`cursor-pointer transition-all hover:border-[rgba(0,255,180,0.25)] ${
                isSelected ? 'border-[#00FFB4] border-2' : ''
              } ${isOverloaded ? 'border-[rgba(255,88,96,0.25)]' : ''}`}
              onClick={() => onSelectMember?.(user)}
            >
              <div className="space-y-3">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <Avatar className="w-12 h-12 border-2 border-[rgba(255,255,255,0.12)]">
                      <AvatarFallback className="bg-gradient-to-br from-[#FF7A3D] to-[#008751] text-white font-semibold">
                        {getMemberInitials(user.nome)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1">
                      <h4 className="font-semibold text-white">{user.nome}</h4>
                      <p className="text-xs text-[rgba(255,255,255,0.65)]">{user.email}</p>
                    </div>
                  </div>
                </div>

                {user.cargo && (
                  <div>
                    <p className="text-sm text-[rgba(255,255,255,0.85)]">{user.cargo}</p>
                    <Badge
                      variant="outline"
                      className={`text-xs mt-1 ${getRoleColor(user.papelPrincipal)}`}
                    >
                      {getRoleLabel(user.papelPrincipal)}
                    </Badge>
                  </div>
                )}

                <div className="pt-2 border-t border-[rgba(255,255,255,0.05)]">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs text-[rgba(255,255,255,0.65)]">Ocupação</span>
                    <div className="flex items-center gap-2">
                      {isOverloaded && (
                        <AlertTriangle className="w-3 h-3 text-[#FF5860]" />
                      )}
                      <span
                        className={`text-sm font-bold ${
                          isOverloaded
                            ? 'text-[#FF5860]'
                            : workload.percent > 80
                            ? 'text-[#FFB04D]'
                            : 'text-[#00FFB4]'
                        }`}
                      >
                        {workload.percent}%
                      </span>
                    </div>
                  </div>
                  <div className="w-full bg-[rgba(255,255,255,0.05)] rounded-full h-2">
                    <div
                      className={`h-2 rounded-full ${
                        isOverloaded
                          ? 'bg-[#FF5860]'
                          : workload.percent > 80
                          ? 'bg-[#FFB04D]'
                          : 'bg-[#00FFB4]'
                      }`}
                      style={{ width: `${Math.min(workload.percent, 200)}%` }}
                    />
                  </div>
                  <p className="text-xs text-[rgba(255,255,255,0.50)] mt-1">
                    {workload.hours}h/semana
                  </p>
                </div>
              </div>
            </HUDCard>
          );
        })}
      </div>

      {filteredUsers.length === 0 && (
        <div className="text-center py-12">
          <UsersIcon className="w-12 h-12 mx-auto mb-3 text-[rgba(255,255,255,0.20)]" />
          <p className="text-[rgba(255,255,255,0.65)]">Nenhum colaborador encontrado</p>
        </div>
      )}
    </div>
  );
}

