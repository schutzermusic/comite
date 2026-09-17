import { esc } from '@/lib/reports/report-formatters';

/** Chart values are supplied in cents. Formatting never feeds back into data. */
export function compactChartCurrency(cents: number): string {
  const reais = cents / 100;
  const amount = Math.abs(reais);
  const fmt = (value: number, digits: number) => value.toLocaleString('pt-BR', {
    minimumFractionDigits: digits, maximumFractionDigits: digits,
  });
  const sign = reais < 0 ? '-' : '';
  if (amount >= 1_000_000) return `${sign}R$ ${fmt(amount / 1_000_000, 1)} mi`;
  if (amount >= 1_000) return `${sign}R$ ${fmt(amount / 1_000, amount < 10_000 ? 1 : 0)} mil`;
  return `${sign}R$ ${fmt(amount, Number.isInteger(amount) ? 0 : 2)}`;
}

export interface LabelBox { x: number; y: number; width: number; height: number }
export interface ChartValueLabel {
  x: number; y: number; value: number; color: string;
  title: string;
  /** Bar totals must stay above their column. */
  above?: boolean;
  leader?: boolean;
  /** Preferred horizontal displacement for segment callouts. */
  offsetX?: number;
  client?: string;
  /** Optional upper limit for a callout placed outside a dense stack. */
  ceiling?: number;
  /** Hard boundary: the complete callout must stay to the right of its bar. */
  minX?: number;
  /** Right edge of the monthly lane, before the following column. */
  maxX?: number;
  centerY?: boolean;
}

function labelText(label: ChartValueLabel): string {
  const value = compactChartCurrency(label.value);
  return label.client ? `${label.client} · ${value}` : value;
}

export function boxesOverlap(a: LabelBox, b: LabelBox): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x
    && a.y < b.y + b.height && a.y + a.height > b.y;
}

/**
 * Deterministic, conservative text boxes; no DOM or hover dependency. Nearby
 * positions are tried first, then progressively wider offsets. Dense timelines
 * use vertical values so every month remains present at a readable font size.
 */
export function layoutChartValueLabels(
  labels: ChartValueLabel[], bounds: LabelBox, dense = false, obstacles: LabelBox[] = [],
): Array<ChartValueLabel & { box: LabelBox; rotated: boolean; fontSize: number }> {
  const occupied = [...obstacles];
  return labels.map((label) => {
    const minX = Math.max(bounds.x, label.minX ?? bounds.x);
    const rightEdge = Math.min(bounds.x + bounds.width, label.maxX ?? Infinity);
    const textLength = label.client ? Math.max(label.client.length, compactChartCurrency(label.value).length) : labelText(label).length;
    const textWidth = textLength * (dense ? 5.8 : 6.5) + 6;
    const scale = !dense && label.client ? Math.min(1, (rightEdge - minX) / textWidth) : 1;
    const fontSize = (dense ? 10 : 11.5) * scale;
    const width = dense ? 14 : textWidth * scale;
    const height = dense ? textWidth : (label.client ? 32 : 18) * scale;
    const maxX = rightEdge - width;
    const minY = bounds.y;
    const maxY = Math.min(bounds.y + bounds.height - height,
      label.above ? label.y - height - 5 : Infinity,
      label.ceiling != null ? label.ceiling - height : Infinity);
    const idealX = Math.max(minX, Math.min(maxX, label.x + (label.offsetX ?? 0) - width / 2));
    const idealY = Math.max(minY, Math.min(maxY,
      label.centerY ? label.y - height / 2 : label.y - height - 7));
    const cost = (candidate: LabelBox) => Math.abs(candidate.x - idealX) * 4 + Math.abs(candidate.y - idealY);
    const fits = (candidate: LabelBox) => candidate.y >= minY && candidate.y <= maxY
      && candidate.x >= minX && candidate.x <= maxX
      && occupied.every((other) => !boxesOverlap(candidate, other));
    let box: LabelBox | undefined = { x: idealX, y: idealY, width, height };
    if (!fits(box)) box = undefined;
    let bestCost = box ? 0 : Infinity;
    if (!box) for (let cy = minY; cy <= maxY; cy += 4) {
      for (let cx = minX; cx <= maxX; cx += dense ? 4 : 8) {
        const candidate = { x: cx, y: cy, width, height };
        const candidateCost = cost(candidate);
        if (candidateCost < bestCost && fits(candidate)) {
          box = candidate;
          bestCost = candidateCost;
        }
      }
    }
    // Never silently remove a mandatory value or emit overlapping text.
    if (!box) throw new Error('Área insuficiente para os rótulos do gráfico. Aumente o espaço reservado.');
    occupied.push(box);
    return { ...label, box, rotated: dense, fontSize };
  });
}

export function renderChartValueLabels(
  labels: ChartValueLabel[], bounds: LabelBox, background: string,
  dense = false, obstacles: LabelBox[] = [],
): string {
  const leaders: string[] = [];
  const text = layoutChartValueLabels(labels, bounds, dense, obstacles).map((label) => {
    const { box } = label;
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    const lx = Math.max(box.x, Math.min(box.x + box.width, label.x));
    const ly = Math.max(box.y, Math.min(box.y + box.height, label.y));
    const moved = Math.abs(cx - label.x) > 8 || Math.abs(ly - label.y) > 24;
    const content = label.client
      ? `<tspan x="${cx.toFixed(1)}" dy="${(-(label.fontSize + 2.5) / 2).toFixed(1)}">${esc(label.client)}</tspan><tspan x="${cx.toFixed(1)}" dy="${(label.fontSize + 2.5).toFixed(1)}">${esc(compactChartCurrency(label.value))}</tspan>`
      : esc(labelText(label));
    const leader = label.leader || moved
      ? `<path class="apex-value-leader" d="M ${label.x.toFixed(1)} ${label.y.toFixed(1)} L ${lx.toFixed(1)} ${ly.toFixed(1)}" fill="none" stroke="${label.color}" stroke-width=".7" stroke-opacity=".8"/>` : '';
    leaders.push(leader);
    return `<g class="apex-value-label" data-value-cents="${label.value}" data-label-box="${box.x},${box.y},${box.width},${box.height}">
      <title>${esc(label.title)}</title>
      <text x="${cx.toFixed(1)}" y="${cy.toFixed(1)}"${label.rotated ? ` transform="rotate(-90 ${cx.toFixed(1)} ${cy.toFixed(1)})"` : ''}
        text-anchor="middle" dominant-baseline="central" font-size="${label.fontSize.toFixed(2)}" font-weight="600"
        fill="${label.color}" stroke="${background}" stroke-width="3" stroke-linejoin="round" paint-order="stroke"
        style="font-variant-numeric:tabular-nums">${content}</text>
    </g>`;
  }).join('');
  return `<g aria-hidden="true">${leaders.join('')}</g>${text}`;
}
