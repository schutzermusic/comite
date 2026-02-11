'use client';

import { ResponsiveRadialBar } from '@nivo/radial-bar';
import { cn } from '@/lib/utils';
import { nivoTheme, colors } from '@/lib/design-tokens';

interface HealthRingProps {
  value: number; // 0-100
  label?: string;
  size?: 'sm' | 'md' | 'lg';
  showValue?: boolean;
  status?: 'healthy' | 'warning' | 'critical';
  className?: string;
}

const statusColors = {
  healthy: colors.semantic.success.default,
  warning: colors.semantic.warning.default,
  critical: colors.semantic.error.default,
};

export function HealthRing({
  value,
  label = 'Health',
  size = 'md',
  showValue = true,
  status,
  className,
}: HealthRingProps) {
  // Auto-determine status if not provided
  const computedStatus = status || (
    value >= 70 ? 'healthy' :
    value >= 40 ? 'warning' :
    'critical'
  );

  const color = statusColors[computedStatus];

  const sizeConfig = {
    sm: { width: 100, height: 100, fontSize: '18px' },
    md: { width: 160, height: 160, fontSize: '28px' },
    lg: { width: 220, height: 220, fontSize: '36px' },
  };

  const config = sizeConfig[size];

  const data = [
    {
      id: label,
      data: [{ x: label, y: value }],
    },
  ];

  return (
    <div 
      className={cn('relative', className)}
      style={{ width: config.width, height: config.height }}
    >
      <ResponsiveRadialBar
        data={data}
        theme={nivoTheme.dark}
        maxValue={100}
        startAngle={-135}
        endAngle={135}
        innerRadius={0.65}
        padding={0}
        cornerRadius={4}
        colors={[color]}
        tracksColor="rgba(255,255,255,0.05)"
        enableRadialGrid={false}
        enableCircularGrid={false}
        radialAxisStart={null}
        circularAxisOuter={null}
        animate={true}
        motionConfig="gentle"
      />
      
      {/* Center content */}
      {showValue && (
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span 
            className="font-bold text-white"
            style={{ fontSize: config.fontSize }}
          >
            {Math.round(value)}%
          </span>
          <span className="text-xs text-orion-text-muted uppercase tracking-wider mt-1">
            {label}
          </span>
        </div>
      )}

      {/* Glow effect */}
      <div 
        className="absolute inset-0 rounded-full pointer-events-none"
        style={{
          boxShadow: `inset 0 0 30px ${color}20`,
        }}
      />
    </div>
  );
}

// Multiple rings variant for composite health
interface CompositeHealthRingProps {
  metrics: Array<{
    id: string;
    value: number;
    color?: string;
  }>;
  centerValue?: number;
  centerLabel?: string;
  size?: number;
  className?: string;
}

export function CompositeHealthRing({
  metrics,
  centerValue,
  centerLabel = 'Overall',
  size = 200,
  className,
}: CompositeHealthRingProps) {
  const data = metrics.map((metric, index) => ({
    id: metric.id,
    data: [{ x: metric.id, y: metric.value }],
  }));

  const defaultColors = [
    colors.semantic.success.default,
    colors.semantic.info.default,
    colors.accent.purple,
    colors.semantic.warning.default,
  ];

  return (
    <div 
      className={cn('relative', className)}
      style={{ width: size, height: size }}
    >
      <ResponsiveRadialBar
        data={data}
        theme={nivoTheme.dark}
        maxValue={100}
        startAngle={-90}
        endAngle={270}
        innerRadius={0.3}
        padding={0.3}
        cornerRadius={3}
        colors={metrics.map((m, i) => m.color || defaultColors[i % defaultColors.length])}
        tracksColor="rgba(255,255,255,0.03)"
        enableRadialGrid={false}
        enableCircularGrid={false}
        radialAxisStart={null}
        circularAxisOuter={null}
        animate={true}
        motionConfig="gentle"
        legends={[]}
      />
      
      {/* Center content */}
      {centerValue !== undefined && (
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-3xl font-bold text-white">
            {Math.round(centerValue)}%
          </span>
          <span className="text-xs text-orion-text-muted uppercase tracking-wider">
            {centerLabel}
          </span>
        </div>
      )}
    </div>
  );
}






















