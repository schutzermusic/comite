'use client';

import { ResponsiveRadar } from '@nivo/radar';
import { cn } from '@/lib/utils';
import { nivoTheme, colors } from '@/lib/design-tokens';

interface RiskDimension {
  dimension: string;
  value: number;
  maxValue?: number;
}

interface RiskRadarProps {
  dimensions: RiskDimension[];
  size?: number;
  showLabels?: boolean;
  className?: string;
}

export function RiskRadar({
  dimensions,
  size = 280,
  showLabels = true,
  className,
}: RiskRadarProps) {
  // Transform data for Nivo radar
  const data = dimensions.map(d => ({
    dimension: d.dimension,
    risk: d.value,
  }));

  const keys = ['risk'];

  return (
    <div 
      className={cn('relative', className)}
      style={{ width: size, height: size }}
    >
      <ResponsiveRadar
        data={data}
        keys={keys}
        indexBy="dimension"
        theme={nivoTheme.dark}
        maxValue={100}
        margin={{ top: 40, right: 60, bottom: 40, left: 60 }}
        borderColor={{ from: 'color' }}
        gridLevels={5}
        gridShape="circular"
        gridLabelOffset={16}
        enableDots={true}
        dotSize={8}
        dotColor={colors.semantic.error.default}
        dotBorderWidth={2}
        dotBorderColor={{ from: 'color' }}
        colors={[colors.semantic.error.default]}
        fillOpacity={0.2}
        blendMode="normal"
        animate={true}
        motionConfig="gentle"
      />

      {/* Animated ring overlay */}
      <svg 
        className="absolute inset-0 pointer-events-none animate-ring-slow"
        style={{ width: size, height: size }}
      >
        <circle
          cx={size / 2}
          cy={size / 2}
          r={size / 2 - 30}
          fill="none"
          stroke={colors.semantic.error.default}
          strokeWidth="1"
          strokeOpacity="0.2"
          strokeDasharray="4 8"
        />
      </svg>
    </div>
  );
}

// Simplified heat ring for risk distribution
interface RiskHeatRingProps {
  categories: Array<{
    name: string;
    count: number;
    severity: 'critical' | 'high' | 'medium' | 'low';
  }>;
  size?: number;
  className?: string;
}

const severityColors = {
  critical: colors.semantic.error.default,
  high: colors.semantic.warning.default,
  medium: colors.accent.orange,
  low: colors.semantic.success.default,
};

export function RiskHeatRing({
  categories,
  size = 200,
  className,
}: RiskHeatRingProps) {
  const data = categories.map(cat => ({
    id: cat.name,
    label: cat.name,
    value: cat.count,
    color: severityColors[cat.severity],
  }));

  const total = categories.reduce((sum, cat) => sum + cat.count, 0);

  return (
    <div 
      className={cn('relative flex items-center justify-center', className)}
      style={{ width: size, height: size }}
    >
      {/* Outer ring segments - simplified SVG representation */}
      <svg 
        className="absolute inset-0"
        style={{ width: size, height: size }}
        viewBox={`0 0 ${size} ${size}`}
      >
        {data.map((segment, index) => {
          const startAngle = data
            .slice(0, index)
            .reduce((sum, d) => sum + (d.value / total) * 360, -90);
          const endAngle = startAngle + (segment.value / total) * 360;
          
          const startRad = (startAngle * Math.PI) / 180;
          const endRad = (endAngle * Math.PI) / 180;
          
          const outerRadius = size / 2 - 10;
          const innerRadius = size / 2 - 35;
          const centerX = size / 2;
          const centerY = size / 2;
          
          const x1 = centerX + outerRadius * Math.cos(startRad);
          const y1 = centerY + outerRadius * Math.sin(startRad);
          const x2 = centerX + outerRadius * Math.cos(endRad);
          const y2 = centerY + outerRadius * Math.sin(endRad);
          const x3 = centerX + innerRadius * Math.cos(endRad);
          const y3 = centerY + innerRadius * Math.sin(endRad);
          const x4 = centerX + innerRadius * Math.cos(startRad);
          const y4 = centerY + innerRadius * Math.sin(startRad);
          
          const largeArcFlag = endAngle - startAngle > 180 ? 1 : 0;
          
          const pathD = `
            M ${x1} ${y1}
            A ${outerRadius} ${outerRadius} 0 ${largeArcFlag} 1 ${x2} ${y2}
            L ${x3} ${y3}
            A ${innerRadius} ${innerRadius} 0 ${largeArcFlag} 0 ${x4} ${y4}
            Z
          `;
          
          return (
            <path
              key={segment.id}
              d={pathD}
              fill={segment.color}
              fillOpacity={0.8}
              stroke={segment.color}
              strokeWidth={1}
              strokeOpacity={0.3}
              className="transition-all duration-300 hover:opacity-100"
              style={{ opacity: 0.7 }}
            />
          );
        })}
        
        {/* Inner glow circle */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={size / 2 - 50}
          fill="transparent"
          stroke="rgba(255,255,255,0.05)"
          strokeWidth="1"
        />
      </svg>

      {/* Center content */}
      <div className="relative z-10 flex flex-col items-center justify-center">
        <span className="text-3xl font-bold text-white">{total}</span>
        <span className="text-xs text-orion-text-muted uppercase tracking-wider">
          Total Risks
        </span>
      </div>
    </div>
  );
}






















