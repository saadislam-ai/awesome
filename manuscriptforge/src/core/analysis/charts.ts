/** A single-series chart: values in sequence, one per chapter. */
export interface ChartSpec {
  type: 'line' | 'columns';
  /** What is plotted, shown as the chart's title. */
  title: string;
  labels: string[];
  values: (number | null)[];
  /** Fixed top of the scale, for example 10 for a score out of ten. */
  max?: number;
  /** Shown after values in tooltips, for example " words" or "%". */
  unit?: string;
}

export interface ChartLayout {
  width: number;
  height: number;
  plot: { left: number; top: number; right: number; bottom: number };
  ticks: { value: number; y: number; label: string }[];
  /** One entry per value: the centre of its slot on the x axis. */
  slots: { x: number; y: number | null; value: number | null; label: string; width: number }[];
  /** Indexes of the slots whose label is drawn on the x axis. */
  shownLabels: number[];
  barWidth: number;
  baseline: number;
}

/** Tick values that are round numbers: 0, 500, 1,000 rather than 0, 437, 874. */
export function niceTicks(max: number, count = 4): number[] {
  if (max <= 0) return [0, 1];
  const rough = max / count;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= rough) ?? magnitude * 10;
  const ticks: number[] = [];
  for (let v = 0; v <= max + step * 0.999; v += step) ticks.push(Math.round(v * 1000) / 1000);
  return ticks;
}

export function formatTick(value: number): string {
  if (value >= 10000) return `${Math.round(value / 100) / 10}K`;
  return value.toLocaleString('en-US');
}

/** Works out where everything in a chart goes. The same layout is drawn on screen and in the PDF report. */
export function layoutChart(spec: ChartSpec, width: number, height: number): ChartLayout {
  const present = spec.values.filter((v): v is number => v !== null);
  const dataMax = Math.max(spec.max ?? 0, ...present, 0);
  const ticksValues = spec.max ? niceTicks(spec.max, spec.max <= 10 ? 5 : 4).filter((v) => v <= spec.max!) : niceTicks(dataMax);
  const top = ticksValues[ticksValues.length - 1] || 1;
  const widest = Math.max(...ticksValues.map((v) => formatTick(v).length));
  const plot = { left: 14 + widest * 6.5, top: 10, right: width - 12, bottom: height - 26 };
  const plotHeight = plot.bottom - plot.top;
  const n = Math.max(spec.values.length, 1);
  const slot = (plot.right - plot.left) / n;
  const yOf = (v: number) => plot.bottom - (v / top) * plotHeight;
  const slots = spec.values.map((value, i) => ({ x: plot.left + slot * (i + 0.5), y: value === null ? null : yOf(value), value, label: spec.labels[i] ?? '', width: slot }));
  // Bars are capped in width: the rest of the slot is air.
  const barWidth = Math.max(2, Math.min(24, slot - 2));
  // Show as many x labels as fit without touching: every one, every second, every fifth...
  const every = [1, 2, 5, 10, 20, 50, 100].find((k) => slot * k >= 28) ?? 200;
  const shownLabels = slots.map((_, i) => i).filter((i) => i % every === 0);
  return { width, height, plot, ticks: ticksValues.map((value) => ({ value, y: yOf(value), label: formatTick(value) })), slots, shownLabels, barWidth, baseline: plot.bottom };
}

export interface ChartColors {
  series: string;
  surface: string;
  grid: string;
  axis: string;
  text: string;
}

export const PRINT_COLORS: ChartColors = { series: '#257de0', surface: '#ffffff', grid: '#e7e7e7', axis: '#c2c2c2', text: '#666666' };

/** A column with a rounded top and a square foot on the baseline. */
export function columnPath(x: number, y: number, width: number, baseline: number): string {
  const r = Math.min(4, width / 2, Math.max(0, baseline - y));
  const left = x - width / 2;
  const right = x + width / 2;
  return `M${left},${baseline} L${left},${y + r} Q${left},${y} ${left + r},${y} L${right - r},${y} Q${right},${y} ${right},${y + r} L${right},${baseline} Z`;
}

/** The line through the points that have a value. Gaps in the data break the line. */
export function linePath(layout: ChartLayout): string {
  let path = '';
  let pen = false;
  for (const slot of layout.slots) {
    if (slot.y === null) {
      pen = false;
      continue;
    }
    path += `${pen ? 'L' : 'M'}${slot.x.toFixed(1)},${slot.y.toFixed(1)} `;
    pen = true;
  }
  return path.trim();
}

function escapeXml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** The chart as a static SVG image, for the printed report. */
export function chartSvg(spec: ChartSpec, width = 480, height = 170, colors: ChartColors = PRINT_COLORS): string {
  const l = layoutChart(spec, width, height);
  const parts: string[] = [`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`];
  for (const tick of l.ticks) {
    parts.push(`<line x1="${l.plot.left}" y1="${tick.y.toFixed(1)}" x2="${l.plot.right}" y2="${tick.y.toFixed(1)}" stroke="${tick.value === 0 ? colors.axis : colors.grid}" stroke-width="1"/>`);
    parts.push(`<text x="${l.plot.left - 6}" y="${(tick.y + 3).toFixed(1)}" font-size="8" fill="${colors.text}" text-anchor="end">${tick.label}</text>`);
  }
  if (spec.type === 'columns') {
    for (const slot of l.slots) if (slot.y !== null && slot.value) parts.push(`<path d="${columnPath(slot.x, slot.y, l.barWidth, l.baseline)}" fill="${colors.series}"/>`);
  } else {
    parts.push(`<path d="${linePath(l)}" fill="none" stroke="${colors.series}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`);
    if (l.slots.length <= 40) {
      for (const slot of l.slots) if (slot.y !== null) parts.push(`<circle cx="${slot.x.toFixed(1)}" cy="${slot.y.toFixed(1)}" r="3" fill="${colors.series}" stroke="${colors.surface}" stroke-width="1.5"/>`);
    }
  }
  for (const i of l.shownLabels) {
    const slot = l.slots[i];
    parts.push(`<text x="${slot.x.toFixed(1)}" y="${l.baseline + 13}" font-size="8" fill="${colors.text}" text-anchor="middle">${escapeXml(slot.label)}</text>`);
  }
  parts.push('</svg>');
  return parts.join('');
}
