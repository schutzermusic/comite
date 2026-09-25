/**
 * Os módulos do local no Dashboard (Planejar, Supply Chain, Faturamento).
 * Cada um: `(props: ModuleProps) => JSX` — lê o próprio endpoint, desenha os
 * próprios painéis no HUD e devolve a camada do mapa por `onMapLayer`.
 */
export { PlanModule } from './PlanModule';
export { SupplyModule } from './SupplyModule';
export { BillingModule } from './BillingModule';
