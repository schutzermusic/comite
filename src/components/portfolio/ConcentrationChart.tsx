'use client';

import { useMemo } from 'react';
import { CompanyData, getCompanyPercentage, formatBRLCompact } from '@/data/portfolioContracts';
import { cn } from '@/lib/utils';

interface ConcentrationChartProps {
  data: CompanyData[];
  maxItems?: number;
  className?: string;
}

/**
 * ConcentrationChart
 * 
 * A compact horizontal bar chart showing top companies by contracted value.
 * Pure CSS implementation for performance.
 */
export function ConcentrationChart({ 
  data, 
  maxItems = 6,
  className 
}: ConcentrationChartProps) {
  const chartData = useMemo(() => {
    const sorted = [...data].sort((a, b) => b.totalContracted - a.totalContracted);
    const topItems = sorted.slice(0, maxItems);
    
    // Calculate "Others" if there are more items
    if (sorted.length > maxItems) {
      const othersTotal = sorted.slice(maxItems).reduce((sum, c) => sum + c.totalContracted, 0);
      const othersBacklog = sorted.slice(maxItems).reduce((sum, c) => sum + c.backlogToInvoice, 0);
      const othersCount = sorted.length - maxItems;
      topItems.push({
        company: `Outros (${othersCount})`,
        totalContracted: othersTotal,
        backlogToInvoice: othersBacklog,
        contractsCount: sorted.slice(maxItems).reduce((sum, c) => sum + c.contractsCount, 0),
      });
    }
    
    return topItems.map(item => ({
      ...item,
      percentage: getCompanyPercentage(item),
    }));
  }, [data, maxItems]);

  const maxPercentage = Math.max(...chartData.map(d => d.percentage));

  return (
    <div className={cn('space-y-2', className)}>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-medium uppercase tracking-wider text-white/50">
          Concentração por Cliente
        </h3>
      </div>
      
      <div className="space-y-2">
        {chartData.map((item, index) => {
          const barWidth = (item.percentage / maxPercentage) * 100;
          const isOthers = item.company.startsWith('Outros');
          
          return (
            <div key={item.company} className="group">
              <div className="flex items-center justify-between mb-1">
                <span 
                  className={cn(
                    'text-xs font-medium truncate max-w-[140px]',
                    isOthers ? 'text-white/40' : 'text-white/80'
                  )}
                  title={item.company}
                >
                  {item.company}
                </span>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-white/40 tabular-nums">
                    {formatBRLCompact(item.totalContracted)}
                  </span>
                  <span className="text-[10px] font-medium text-white/60 tabular-nums w-12 text-right">
                    {item.percentage.toFixed(1)}%
                  </span>
                </div>
              </div>
              
              <div className="h-2 bg-white/[0.04] rounded-full overflow-hidden">
                <div
                  className={cn(
                    'h-full rounded-full transition-all duration-500 ease-out',
                    isOthers 
                      ? 'bg-white/20' 
                      : index === 0 
                        ? 'bg-gradient-to-r from-cyan-500 to-cyan-400'
                        : index === 1
                          ? 'bg-gradient-to-r from-cyan-600 to-cyan-500'
                          : 'bg-gradient-to-r from-cyan-700/80 to-cyan-600/80'
                  )}
                  style={{ 
                    width: `${barWidth}%`,
                    transitionDelay: `${index * 50}ms`
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default ConcentrationChart;
