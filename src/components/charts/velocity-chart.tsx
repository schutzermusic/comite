'use client';

import { ResponsiveLine } from '@nivo/line';
import { cn } from '@/lib/utils';
import { nivoTheme, colors } from '@/lib/design-tokens';

interface DataPoint {
  x: string | number;
  y: number;
}

interface VelocityChartProps {
  data: DataPoint[];
  color?: string;
  height?: number;
  showGrid?: boolean;
  showAxes?: boolean;
  areaFill?: boolean;
  className?: string;
}

export function VelocityChart({
  data,
  color = colors.semantic.info.default,
  height = 200,
  showGrid = false,
  showAxes = true,
  areaFill = true,
  className,
}: VelocityChartProps) {
  const chartData = [
    {
      id: 'velocity',
      data: data,
    },
  ];

  return (
    <div className={cn('w-full', className)} style={{ height }}>
      <ResponsiveLine
        data={chartData}
        theme={nivoTheme.dark}
        colors={[color]}
        margin={{ top: 20, right: 20, bottom: showAxes ? 40 : 20, left: showAxes ? 50 : 20 }}
        xScale={{ type: 'point' }}
        yScale={{ type: 'linear', min: 'auto', max: 'auto' }}
        curve="monotoneX"
        enableArea={areaFill}
        areaOpacity={0.15}
        enableGridX={showGrid}
        enableGridY={showGrid}
        axisTop={null}
        axisRight={null}
        axisBottom={showAxes ? {
          tickSize: 0,
          tickPadding: 12,
          tickRotation: 0,
        } : null}
        axisLeft={showAxes ? {
          tickSize: 0,
          tickPadding: 12,
          tickRotation: 0,
          tickValues: 5,
        } : null}
        pointSize={6}
        pointColor={color}
        pointBorderWidth={2}
        pointBorderColor={{ from: 'serieColor' }}
        enablePointLabel={false}
        useMesh={true}
        animate={true}
        motionConfig="gentle"
        defs={[
          {
            id: 'gradient',
            type: 'linearGradient',
            colors: [
              { offset: 0, color: color, opacity: 0.4 },
              { offset: 100, color: color, opacity: 0 },
            ],
          },
        ]}
        fill={[{ match: '*', id: 'gradient' }]}
      />
    </div>
  );
}

// Mini sparkline version
interface SparklineProps {
  data: number[];
  color?: string;
  height?: number;
  width?: number;
  className?: string;
}

export function Sparkline({
  data,
  color = colors.semantic.info.default,
  height = 32,
  width = 80,
  className,
}: SparklineProps) {
  const chartData = [
    {
      id: 'sparkline',
      data: data.map((value, index) => ({ x: index, y: value })),
    },
  ];

  // Determine trend color
  const trend = data.length > 1 ? data[data.length - 1] - data[0] : 0;
  const trendColor = trend > 0 
    ? colors.semantic.success.default 
    : trend < 0 
    ? colors.semantic.error.default 
    : color;

  return (
    <div className={cn('relative', className)} style={{ width, height }}>
      <ResponsiveLine
        data={chartData}
        theme={nivoTheme.dark}
        colors={[trendColor]}
        margin={{ top: 4, right: 4, bottom: 4, left: 4 }}
        xScale={{ type: 'linear' }}
        yScale={{ type: 'linear', min: 'auto', max: 'auto' }}
        curve="monotoneX"
        enableArea={true}
        areaOpacity={0.2}
        enableGridX={false}
        enableGridY={false}
        axisTop={null}
        axisRight={null}
        axisBottom={null}
        axisLeft={null}
        pointSize={0}
        enableCrosshair={false}
        useMesh={false}
        animate={true}
        motionConfig="gentle"
      />
    </div>
  );
}

// Multi-series comparison chart
interface ComparisonChartProps {
  series: Array<{
    id: string;
    data: DataPoint[];
    color?: string;
  }>;
  height?: number;
  showLegend?: boolean;
  className?: string;
}

export function ComparisonChart({
  series,
  height = 300,
  showLegend = true,
  className,
}: ComparisonChartProps) {
  const defaultColors = [
    colors.semantic.info.default,
    colors.semantic.success.default,
    colors.accent.purple,
    colors.semantic.warning.default,
  ];

  const chartData = series.map((s, i) => ({
    id: s.id,
    data: s.data,
    color: s.color || defaultColors[i % defaultColors.length],
  }));

  return (
    <div className={cn('w-full', className)} style={{ height }}>
      <ResponsiveLine
        data={chartData}
        theme={nivoTheme.dark}
        colors={chartData.map(d => d.color)}
        margin={{ top: 20, right: showLegend ? 120 : 20, bottom: 50, left: 60 }}
        xScale={{ type: 'point' }}
        yScale={{ type: 'linear', min: 'auto', max: 'auto' }}
        curve="monotoneX"
        enableGridX={false}
        enableGridY={true}
        axisTop={null}
        axisRight={null}
        axisBottom={{
          tickSize: 0,
          tickPadding: 12,
          tickRotation: 0,
        }}
        axisLeft={{
          tickSize: 0,
          tickPadding: 12,
          tickRotation: 0,
          tickValues: 5,
        }}
        pointSize={6}
        pointBorderWidth={2}
        pointBorderColor={{ from: 'serieColor' }}
        useMesh={true}
        animate={true}
        motionConfig="gentle"
        legends={showLegend ? [
          {
            anchor: 'bottom-right',
            direction: 'column',
            justify: false,
            translateX: 100,
            translateY: 0,
            itemsSpacing: 8,
            itemDirection: 'left-to-right',
            itemWidth: 80,
            itemHeight: 16,
            itemOpacity: 0.75,
            symbolSize: 10,
            symbolShape: 'circle',
            effects: [
              {
                on: 'hover',
                style: {
                  itemOpacity: 1,
                },
              },
            ],
          },
        ] : []}
      />
    </div>
  );
}






















