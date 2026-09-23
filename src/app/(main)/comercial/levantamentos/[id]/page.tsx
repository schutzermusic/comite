'use client';

import { use } from 'react';
import { SiteSurveyField } from '@/components/commercial/SiteSurveyField';

/**
 * Tela de CAMPO do levantamento técnico. Não é item de menu: chega-se aqui
 * pela oportunidade, pelo aviso de atribuição ou pelo link compartilhado.
 */
export default function SiteSurveyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <SiteSurveyField surveyId={id} />;
}
