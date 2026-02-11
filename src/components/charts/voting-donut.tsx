'use client';

import { ResponsivePie } from '@nivo/pie';
import { cn } from '@/lib/utils';
import { nivoTheme, colors } from '@/lib/design-tokens';

interface VotingDonutProps {
  approved: number;
  rejected: number;
  pending: number;
  size?: 'sm' | 'md' | 'lg';
  showLegend?: boolean;
  className?: string;
}

export function VotingDonut({
  approved,
  rejected,
  pending,
  size = 'md',
  showLegend = true,
  className,
}: VotingDonutProps) {
  const total = approved + rejected + pending;
  
  const data = [
    { id: 'Approved', label: 'Approved', value: approved, color: colors.semantic.success.default },
    { id: 'Rejected', label: 'Rejected', value: rejected, color: colors.semantic.error.default },
    { id: 'Pending', label: 'Pending', value: pending, color: colors.semantic.warning.default },
  ].filter(d => d.value > 0);

  const sizeConfig = {
    sm: { width: 120, height: 120 },
    md: { width: 180, height: 180 },
    lg: { width: 240, height: 240 },
  };

  const config = sizeConfig[size];

  return (
    <div className={cn('flex items-center gap-6', className)}>
      <div style={{ width: config.width, height: config.height }}>
        <ResponsivePie
          data={data}
          theme={nivoTheme.dark}
          colors={d => d.data.color}
          margin={{ top: 10, right: 10, bottom: 10, left: 10 }}
          innerRadius={0.6}
          padAngle={2}
          cornerRadius={4}
          activeOuterRadiusOffset={4}
          borderWidth={0}
          enableArcLinkLabels={false}
          enableArcLabels={false}
          animate={true}
          motionConfig="gentle"
        />
        
        {/* Center content */}
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <span className="text-2xl font-bold text-white">{total}</span>
          <span className="text-xs text-orion-text-muted">Total</span>
        </div>
      </div>

      {showLegend && (
        <div className="space-y-3">
          {data.map((item) => (
            <div key={item.id} className="flex items-center gap-3">
              <div 
                className="w-3 h-3 rounded-full"
                style={{ backgroundColor: item.color }}
              />
              <div className="flex flex-col">
                <span className="text-sm font-medium text-white">{item.value}</span>
                <span className="text-xs text-orion-text-muted">{item.label}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Compact version for KPI cards
interface MiniVotingDonutProps {
  approved: number;
  rejected: number;
  pending: number;
  className?: string;
}

export function MiniVotingDonut({
  approved,
  rejected,
  pending,
  className,
}: MiniVotingDonutProps) {
  const data = [
    { id: 'Approved', value: approved, color: colors.semantic.success.default },
    { id: 'Rejected', value: rejected, color: colors.semantic.error.default },
    { id: 'Pending', value: pending, color: colors.semantic.warning.default },
  ].filter(d => d.value > 0);

  return (
    <div className={cn('relative w-14 h-14', className)}>
      <ResponsivePie
        data={data}
        theme={nivoTheme.dark}
        colors={d => d.data.color}
        margin={{ top: 0, right: 0, bottom: 0, left: 0 }}
        innerRadius={0.65}
        padAngle={3}
        cornerRadius={2}
        enableArcLinkLabels={false}
        enableArcLabels={false}
        animate={true}
        motionConfig="gentle"
      />
    </div>
  );
}






















