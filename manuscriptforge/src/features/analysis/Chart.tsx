import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { columnPath, layoutChart, linePath, type ChartSpec } from '../../core/analysis/charts';

const HEIGHT = 190;

/**
 * One measure across the chapters of a book, as a line or as columns.
 *
 * A single series, so there is no legend: the title says what is plotted.
 * Pointing at the chart (or focusing it and using the arrow keys) shows the
 * exact value for a chapter. `names` gives the chapter titles for that.
 */
export function Chart({ spec, names }: { spec: ChartSpec; names: string[] }) {
  const frame = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(480);
  const [active, setActive] = useState<number | null>(null);
  const titleId = useId();

  useEffect(() => {
    const el = frame.current;
    if (!el) return;
    const measure = () => setWidth(Math.max(260, Math.round(el.clientWidth)));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const layout = useMemo(() => layoutChart(spec, width, HEIGHT), [spec, width]);
  const count = layout.slots.length;

  const nearest = (clientX: number): number | null => {
    const box = frame.current?.getBoundingClientRect();
    if (!box || !count) return null;
    const x = clientX - box.left;
    const index = Math.floor((x - layout.plot.left) / ((layout.plot.right - layout.plot.left) / count));
    return Math.max(0, Math.min(count - 1, index));
  };

  const onMove = (e: PointerEvent) => setActive(nearest(e.clientX));
  const onKey = (e: KeyboardEvent) => {
    if (!count) return;
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      const step = e.key === 'ArrowRight' ? 1 : -1;
      setActive((current) => Math.max(0, Math.min(count - 1, (current ?? (step > 0 ? -1 : count)) + step)));
    } else if (e.key === 'Home') {
      e.preventDefault();
      setActive(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      setActive(count - 1);
    } else if (e.key === 'Escape') setActive(null);
  };

  const slot = active !== null ? layout.slots[active] : null;
  const valueText = slot ? (slot.value === null ? 'No value' : `${slot.value.toLocaleString('en-US')}${spec.unit ?? ''}`) : '';
  // Keep the tooltip inside the chart: flip it to the left of the pointer near the right edge.
  const flip = slot ? slot.x > width * 0.6 : false;

  return (
    <figure className="chart" data-testid="chart">
      <figcaption id={titleId}>{spec.title}</figcaption>
      <div
        className="chart-frame"
        ref={frame}
        tabIndex={0}
        role="img"
        aria-labelledby={titleId}
        aria-describedby={`${titleId}-hint`}
        onPointerMove={onMove}
        onPointerLeave={() => setActive(null)}
        onBlur={() => setActive(null)}
        onKeyDown={onKey}
      >
        <svg width={width} height={HEIGHT} viewBox={`0 0 ${width} ${HEIGHT}`} aria-hidden="true">
          {layout.ticks.map((tick) => (
            <g key={tick.value}>
              <line x1={layout.plot.left} x2={layout.plot.right} y1={tick.y} y2={tick.y} className={tick.value === 0 ? 'chart-axis' : 'chart-gridline'} />
              <text x={layout.plot.left - 8} y={tick.y + 4} textAnchor="end" className="chart-tick">{tick.label}</text>
            </g>
          ))}
          {spec.type === 'line' && slot && <line x1={slot.x} x2={slot.x} y1={layout.plot.top} y2={layout.baseline} className="chart-crosshair" />}
          {spec.type === 'columns'
            ? layout.slots.map((s, i) =>
                s.y !== null && s.value ? <path key={i} d={columnPath(s.x, s.y, layout.barWidth, layout.baseline)} className={`chart-mark ${active !== null && active !== i ? 'is-dim' : ''}`} /> : null,
              )
            : (
              <>
                <path d={linePath(layout)} className="chart-line" />
                {count <= 40 && layout.slots.map((s, i) => (s.y !== null ? <circle key={i} cx={s.x} cy={s.y} r={active === i ? 5 : 4} className="chart-dot" /> : null))}
                {count > 40 && slot && slot.y !== null && <circle cx={slot.x} cy={slot.y} r={5} className="chart-dot" />}
              </>
            )}
          {layout.shownLabels.map((i) => (
            <text key={i} x={layout.slots[i].x} y={layout.baseline + 16} textAnchor="middle" className="chart-tick">{layout.slots[i].label}</text>
          ))}
          <text x={layout.plot.right} y={HEIGHT - 2} textAnchor="end" className="chart-tick">Chapter</text>
        </svg>
        {slot && (
          <div className={`chart-tip ${flip ? 'is-flipped' : ''}`} style={{ left: slot.x, top: Math.max(4, (slot.y ?? layout.baseline) - 12) }} data-testid="chart-tip">
            <strong>{valueText}</strong>
            <span>{names[active!] ? `${slot.label}. ${names[active!]}` : `Chapter ${slot.label}`}</span>
          </div>
        )}
      </div>
      <span id={`${titleId}-hint`} className="sr-only">Use the left and right arrow keys to read the value for each chapter. The Chapters tab has every value in a table.</span>
    </figure>
  );
}

/** A score out of ten shown as a filled track. */
export function Meter({ label, score, reason }: { label: string; score: number; reason?: string }) {
  return (
    <li className="meter">
      <span className="meter-label">{label}</span>
      <span className="meter-track" role="meter" aria-valuenow={score} aria-valuemin={0} aria-valuemax={10} aria-label={label}>
        <span style={{ width: `${Math.max(0, Math.min(10, score)) * 10}%` }} />
      </span>
      <span className="meter-value">{score} / 10</span>
      {reason && <span className="meter-reason">{reason}</span>}
    </li>
  );
}
