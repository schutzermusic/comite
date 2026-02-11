'use client';
import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { HUDCard } from "@/components/ui/hud-card";
import { StatusPill } from "@/components/ui/status-pill";
import { TrendingUp, DollarSign, Calendar, Percent } from "lucide-react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend
} from "recharts";
import { ProjetoAnalytics } from "@/lib/types";

interface ROIForecastingProps {
  analytics: ProjetoAnalytics;
}

export default function ROIForecasting({ analytics }: ROIForecastingProps) {
  if (!analytics?.previsao_roi) {
    return (
      <HUDCard>
        <div className="text-center py-12">
          <TrendingUp className="w-12 h-12 text-[rgba(255,255,255,0.20)] mx-auto mb-3" />
          <p className="text-[rgba(255,255,255,0.65)]">Previsão de ROI não disponível</p>
        </div>
      </HUDCard>
    );
  }

  const { 
    roi_estimado_percentual,
    roi_pessimista,
    roi_realista,
    roi_otimista,
    payback_meses,
    valor_presente_liquido,
    taxa_retorno_interna
  } = analytics.previsao_roi;

  // Dados para gráfico de cenários
  const scenarioData = [
    { scenario: 'Pessimista', roi: roi_pessimista || 0 },
    { scenario: 'Realista', roi: roi_realista || roi_estimado_percentual || 0 },
    { scenario: 'Otimista', roi: roi_otimista || 0 }
  ];

  const getROIColor = (roi: number) => {
    if (roi >= 30) return 'text-[#00FFB4]';
    if (roi >= 15) return 'text-[#FFB04D]';
    return 'text-[#FF5860]';
  };

  return (
    <div className="space-y-6">
      {/* Main ROI Card */}
      <HUDCard glow glowColor="green">
        <div className="mb-6">
          <div className="flex items-center gap-3 mb-4">
            <TrendingUp className="w-8 h-8 text-[#00FFB4]" />
            <div>
              <p className="text-xs text-[rgba(255,255,255,0.65)] mb-1 uppercase tracking-wide">Previsão de ROI</p>
              <p className="text-3xl font-semibold text-white">{(roi_estimado_percentual || 0).toFixed(1)}%</p>
            </div>
          </div>
          <p className="text-sm text-[rgba(255,255,255,0.65)] mb-6">Cenário Realista</p>

          <div className="grid md:grid-cols-3 gap-4">
            <div className="p-4 bg-[rgba(255,88,96,0.12)] border border-[rgba(255,88,96,0.25)] rounded-lg text-center">
              <p className="text-xs text-[#FF5860] font-semibold mb-1 uppercase tracking-wide">Cenário Pessimista</p>
              <p className="text-2xl font-bold text-white">
                {(roi_pessimista || 0).toFixed(1)}%
              </p>
            </div>
            <div className="p-4 bg-[rgba(0,200,255,0.12)] border border-[rgba(0,200,255,0.25)] rounded-lg text-center">
              <p className="text-xs text-[#00C8FF] font-semibold mb-1 uppercase tracking-wide">Cenário Realista</p>
              <p className="text-2xl font-bold text-white">
                {(roi_realista || roi_estimado_percentual || 0).toFixed(1)}%
              </p>
            </div>
            <div className="p-4 bg-[rgba(0,255,180,0.12)] border border-[rgba(0,255,180,0.25)] rounded-lg text-center">
              <p className="text-xs text-[#00FFB4] font-semibold mb-1 uppercase tracking-wide">Cenário Otimista</p>
              <p className="text-2xl font-bold text-white">
                {(roi_otimista || 0).toFixed(1)}%
              </p>
            </div>
          </div>
        </div>
      </HUDCard>

      {/* Financial Metrics */}
      <div className="grid md:grid-cols-2 gap-6">
        <HUDCard glow glowColor="amber">
          <div className="flex items-center justify-between mb-2">
            <Calendar className="w-6 h-6 text-[#FFB04D]" />
          </div>
          <p className="text-xs text-[rgba(255,255,255,0.65)] mb-1 uppercase tracking-wide">Período de Payback</p>
          <p className="text-3xl font-semibold text-white">
            {payback_meses || 0}
          </p>
          <p className="text-xs text-[rgba(255,255,255,0.50)] mt-1">meses</p>
          <p className="text-xs text-[rgba(255,255,255,0.40)] mt-3">
            Tempo estimado para recuperar o investimento
          </p>
        </HUDCard>

        <HUDCard glow glowColor="green">
          <div className="flex items-center justify-between mb-2">
            <DollarSign className="w-6 h-6 text-[#00FFB4]" />
          </div>
          <p className="text-xs text-[rgba(255,255,255,0.65)] mb-1 uppercase tracking-wide">Valor Presente Líquido</p>
          <p className="text-2xl font-semibold text-white">
            R$ {((valor_presente_liquido || 0) / 1000000).toFixed(2)}M
          </p>
          <p className="text-xs text-[rgba(255,255,255,0.50)] mt-1">VPL</p>
          <p className="text-xs text-[rgba(255,255,255,0.40)] mt-3">
            Valor presente dos fluxos de caixa futuros
          </p>
        </HUDCard>
      </div>

      {/* TIR */}
      {taxa_retorno_interna && (
        <HUDCard glow glowColor={taxa_retorno_interna > 12 ? 'green' : 'amber'}>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <Percent className="w-8 h-8 text-[#00C8FF]" />
              <div>
                <p className="text-xs text-[rgba(255,255,255,0.65)] mb-1 uppercase tracking-wide">Taxa Interna de Retorno</p>
                <p className="text-3xl font-semibold text-white">
                  {taxa_retorno_interna.toFixed(2)}%
                </p>
              </div>
            </div>
            <StatusPill variant={taxa_retorno_interna > 12 ? 'completed' : 'at_risk'}>
              {taxa_retorno_interna > 12 ? 'Viável' : 'Atenção'}
            </StatusPill>
          </div>
          <p className="text-sm text-[rgba(255,255,255,0.65)]">
            {taxa_retorno_interna > 12 ? '✅ Acima do custo de capital' : '⚠️ Abaixo do custo de capital'}
          </p>
        </HUDCard>
      )}

      {/* Scenario Chart */}
      <HUDCard>
        <div className="mb-6">
          <h2 className="text-lg font-semibold text-white orion-text-heading">Análise de Cenários</h2>
          <p className="text-sm text-[rgba(255,255,255,0.65)] mt-1">Comparação de ROI em diferentes cenários</p>
        </div>
        <div className="bg-[rgba(255,255,255,0.03)] rounded-lg p-4">
          <ResponsiveContainer width="100%" height={300}>
            <AreaChart data={scenarioData}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
              <XAxis dataKey="scenario" stroke="rgba(255,255,255,0.65)" />
              <YAxis stroke="rgba(255,255,255,0.65)" />
              <Tooltip 
                formatter={(value: number) => `${value.toFixed(1)}%`}
                contentStyle={{
                  backgroundColor: 'rgba(10, 22, 18, 0.95)',
                  border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: '8px',
                  color: '#fff'
                }}
              />
              <Legend />
              <Area 
                type="monotone" 
                dataKey="roi" 
                stroke="#00FFB4" 
                fill="rgba(0,255,180,0.2)" 
                name="ROI (%)"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </HUDCard>
    </div>
  );
}
