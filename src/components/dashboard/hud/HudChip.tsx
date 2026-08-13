'use client';

/**
 * Duplicata histórica do chip do dashboard. Hoje reexporta o componente
 * canônico do HUD (Signal Chip) para que exista uma única linguagem de status
 * no produto. Mantido como arquivo para não quebrar os imports de `./hud`.
 */
export { HudChip } from '@/components/hud/HudChip';
export type { HudChipProps, HudChipVariant } from '@/components/hud/HudChip';
