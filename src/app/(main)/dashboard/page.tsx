import { Suspense } from 'react';
import type { Metadata } from 'next';
import { DashboardGlobe } from '@/components/dashboard-globe/DashboardGlobe';

export const metadata: Metadata = { title: 'Operação ao vivo — Insight Apex' };

/**
 * DASHBOARD — a operação da empresa sobre o globo (estilo do protótipo APEX
 * FILM, com a base do V1: globo em tela cheia e colunas de HUD).
 *
 * O globo é o palco; cada vista é uma câmera e um conjunto de painéis:
 * portfólio (operações localizadas, atenção, decisões, fluxo do negócio,
 * próximos 30 dias), o local em foco (Visão geral) e os módulos Planejar,
 * Supply Chain e Faturamento. Tudo vem de `/api/dashboard/*`, que compõe os
 * modelos de leitura canônicos com as mesmas travas da RLS: o que a pessoa
 * não lê aparece "Restrito", nunca zero; o que não carregou diz que não
 * carregou. A posição no globo é a oficial ou a do canteiro cadastrado —
 * nunca um ponto estimado.
 *
 * O estado mora na URL (`?site=&m=&x=`); o limite de Suspense isola a leitura
 * dos parâmetros no cliente.
 */
export default function DashboardPage() {
  return (
    <Suspense fallback={<div className="dg dg-boot" aria-busy="true" />}>
      <DashboardGlobe />
    </Suspense>
  );
}
