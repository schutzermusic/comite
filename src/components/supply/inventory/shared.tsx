import type { InventoryWorkspaceModel } from '@/lib/supply/inventory-read';

/** A leitura do estoque (livro, posição, reservas, transferências, contagens, locais) com as alçadas de quem vê. */
export type InventoryModel = InventoryWorkspaceModel & { capabilities: { manage: boolean; reserve: boolean; receive: boolean } };
