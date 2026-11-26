import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from "react";
import "./charts.css";
import { format, useText } from "./ui";
import {
  HEAT_STEPS,
  nearestIndex,
  niceTicks,
  scale,
  shares,
} from "./chartMath";

/**
 * Charts for the lab tools. They share one palette (charts.css), thin marks,
 * solid hairline grids and a table view, so a value is never reachable by
 * hover or by colour alone.
 *
 * - SegmentedBar: one whole split into at most six parts (stock + diluent).
 * - Meter: one ratio against a limit (time left, steps done).
 * - BarList: a named bar and figure per row (counts per chamber, properties).
 * - Plot: values along an axis, as lines and/or points (growth, residuals).
 * - ScaleLegend + heat classes: magnitude as one hue on a grid (plate, table).
 */

/** A categorical palette slot. Order is fixed: it is what keeps neighbours distinct. */
export type Slot = 1 | 2 | 3 | 4 | 5 | 6 | "other";

export function ChartFrame({
  title,
  note,
  legend,
  table,
  children,
}: {
  title: string;
  /** One line beside the title: what is plotted, or how to read it. */
  note?: string;
  legend?: { label: string; slot: Slot; shape?: "rect" | "line" | "dot" }[];
  /** The same values as a table, for screen readers and for exact reading. */
  table?: { headers: string[]; rows: (string | number)[][] };
  children: ReactNode;
}) {
  const t = useText();
  return (
    <figure className="tool-chart">
      <figcaption>
        <strong>{title}</strong>
        {note && <span>{note}</span>}
      </figcaption>
      {children}
      {legend && legend.length >= 2 && (
        <ul className="tool-chart-legend">
          {legend.map((item) => (
            <li key={item.label}>
              <i
                className={`tool-chart-fill-${item.slot}`}
                data-shape={item.shape ?? "rect"}
              />
              {item.label}
            </li>
          ))}
        </ul>
      )}
      {table && table.rows.length > 0 && (
        <details className="tool-chart-table">
          <summary>{t("표로 보기", "View as table")}</summary>
          <div className="tool-table-wrap">
            <table>
              <thead>
                <tr>
                  {table.headers.map((header) => (
                    <th key={header}>{header}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {table.rows.map((row, index) => (
                  <tr key={index}>
                    {row.map((cell, column) => (
                      <td key={column}>
                        {typeof cell === "number" ? format(cell) : cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </figure>
  );
}

export type Part = { label: string; value: number; slot?: Slot };
const slots: Slot[] = [1, 2, 3, 4, 5, 6];
const percent = (share: number) =>
  `${share >= 0.0995 || share === 0 ? Math.round(share * 100) : (share * 100).toFixed(1)}%`;

/**
 * One whole split into parts, widths in proportion. The tall form prints each
 * part's share on its block where it fits and names the parts in a legend with
 * their amounts; the thin form carries no text and sits beside a list that
 * already gives the figures. More than six parts should be folded by the
 * caller (`foldParts`).
 */
export function SegmentedBar({
  parts,
  text = format,
  thin = false,
  label,
}: {
  parts: Part[];
  /** Formats an amount for the legend and tooltip, including its unit. */
  text?: (value: number) => string;
  thin?: boolean;
  /** What the whole is, for assistive technology. */
  label: string;
}) {
  // The slot is fixed by a part's place in the list it was given, before the
  // empty ones are dropped: a part reaching zero must not repaint the others.
  const shown = parts
      .map((part, index) => ({
        ...part,
        slot: part.slot ?? slots[index % slots.length],
      }))
      .filter((part) => Number.isFinite(part.value) && part.value > 0),
    share = shares(shown.map((part) => part.value));
  if (!shown.length) return null;
  const slotOf = (part: Part & { slot: Slot }) => part.slot;
  return (
    <>
      <div
        className="tool-chart-segments"
        data-thin={thin ? "" : undefined}
        role="list"
        aria-label={label}
      >
        {shown.map((part, index) => (
          <span
            key={`${part.label}-${index}`}
            role="listitem"
            tabIndex={0}
            className={`tool-chart-seg tool-chart-fill-${slotOf(part)}`}
            style={{ flex: `${share[index]} 1 0` }}
            aria-label={`${part.label} ${text(part.value)}, ${percent(
              share[index]
            )}`}
            data-chart-tip={`${text(part.value)} · ${percent(share[index])}\n${
              part.label
            }`}
            data-tip-edge={
              index === 0 && share[index] < 0.3
                ? "start"
                : index === shown.length - 1 && share[index] < 0.3
                ? "end"
                : undefined
            }
          >
            {/* Printed only where a short figure fits with room to spare. */}
            {!thin && share[index] >= 0.14 && percent(share[index])}
          </span>
        ))}
      </div>
      {!thin && (
        <ul className="tool-chart-legend">
          {shown.map((part, index) => (
            <li key={`${part.label}-${index}`}>
              <i className={`tool-chart-fill-${slotOf(part)}`} />
              {part.label} <b>{text(part.value)}</b>
              {share[index] < 0.14 && ` (${percent(share[index])})`}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

/** One ratio against a limit. `marks` draw reference points on the track. */
export function Meter({
  label,
  value,
  max,
  min = 0,
  text,
  tone = "accent",
  marks = [],
}: {
  label: string;
  value: number;
  max: number;
  min?: number;
  /** The figure shown beside the label ("3 / 5", "02:15 left"). */
  text: string;
  tone?: "accent" | "good" | "warning" | "critical";
  marks?: number[];
}) {
  const position = (v: number) =>
    max > min ? Math.min(100, Math.max(0, ((v - min) / (max - min)) * 100)) : 0;
  return (
    <div className="tool-chart-meter" data-tone={tone}>
      <div className="tool-chart-meter-head">
        <span>{label}</span>
        <strong>{text}</strong>
      </div>
      <div
        className="tool-chart-meter-track"
        role="meter"
        aria-label={label}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={Number.isFinite(value) ? value : min}
        aria-valuetext={text}
      >
        <span style={{ width: `${position(value)}%` }} />
        {marks.map((mark) => (
          <i key={mark} style={{ left: `${position(mark)}%` }} />
        ))}
      </div>
    </div>
  );
}

/**
 * A name, a bar and a figure per row, with the bars on one baseline so rows
 * compare exactly. Negative values turn it into a diverging list around zero.
 */
export function BarList({
  rows,
  text = format,
  max,
  label,
}: {
  rows: { label: string; value: number; muted?: boolean; figure?: string }[];
  text?: (value: number) => string;
  /** Scale end; defaults to the largest magnitude in the rows. */
  max?: number;
  label: string;
}) {
  const finite = rows.filter((row) => Number.isFinite(row.value));
  if (!finite.length) return null;
  const diverging = finite.some((row) => row.value < 0),
    limit =
      max ?? Math.max(...finite.map((row) => Math.abs(row.value)), 1e-12);
  return (
    <div
      className="tool-chart-bars"
      role="list"
      aria-label={label}
      data-rows={finite.length}
    >
      {finite.map((row, index) => {
        const width = Math.min(1, Math.abs(row.value) / limit) * 100,
          figure = row.figure ?? text(row.value);
        return [
          <span key={`name-${index}`}>{row.label}</span>,
          <span
            key={`bar-${index}`}
            role="listitem"
            tabIndex={0}
            className="tool-chart-bar-track"
            data-muted={row.muted ? "" : undefined}
            data-negative={row.value < 0 ? "" : undefined}
            aria-label={`${row.label} ${figure}`}
            data-chart-tip={`${figure}\n${row.label}`}
          >
            {diverging && <b style={{ left: "50%" }} />}
            <i
              style={
                diverging
                  ? row.value < 0
                    ? { right: "50%", width: `${width / 2}%` }
                    : { left: "50%", width: `${width / 2}%` }
                  : { left: 0, width: `${width}%` }
              }
            />
          </span>,
          <span key={`figure-${index}`}>{figure}</span>,
        ];
      })}
    </div>
  );
}

export type Series = {
  name: string;
  slot?: Slot;
  /**
   * A point whose y is not a finite number is a gap: the line stops there and
   * starts again at the next point that has a value.
   */
  points: { x: number; y: number }[];
  /** "line" (default), "dots", or "both". */
  mark?: "line" | "dots" | "both";
  /** A light wash under a single line. */
  area?: boolean;
};
function useWidth(fallback: number) {
  const ref = useRef<HTMLDivElement>(null),
    [width, setWidth] = useState(fallback);
  useEffect(() => {
    const element = ref.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      const next = Math.round(entry.contentRect.width);
      if (next > 0) setWidth(next);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

/**
 * Values along one x and one y axis. Hovering (or the arrow keys) reads every
 * series at the nearest x; `rules` draw reference lines (a target, zero) and
 * `marks` name single points (now, the result). There is one y axis: two
 * measures of different scale belong in two plots.
 */
export function Plot({
  series,
  label,
  xTitle,
  yTitle,
  xText = format,
  yText = format,
  height = 220,
  rules = [],
  marks = [],
  yDomain,
  xDomain,
  zeroBased = false,
}: {
  series: Series[];
  /** What the plot shows, for assistive technology. */
  label: string;
  xTitle?: string;
  yTitle?: string;
  xText?: (value: number) => string;
  yText?: (value: number) => string;
  height?: number;
  rules?: { axis: "x" | "y"; at: number; label?: string }[];
  marks?: { x: number; y: number; label: string; slot?: Slot }[];
  yDomain?: [number, number];
  xDomain?: [number, number];
  /** Start the y axis at zero (magnitudes); off for values far from zero. */
  zeroBased?: boolean;
}) {
  const [ref, width] = useWidth(560),
    [hover, setHover] = useState<number | null>(null);
  const all = series.flatMap((s) => s.points).filter(
    (p) => Number.isFinite(p.x) && Number.isFinite(p.y)
  );
  if (!all.length) return null;
  const xs = [
      ...all.map((p) => p.x),
      ...marks.map((m) => m.x),
      ...rules.filter((r) => r.axis === "x").map((r) => r.at),
    ],
    ys = [
      ...all.map((p) => p.y),
      ...marks.map((m) => m.y),
      ...rules.filter((r) => r.axis === "y").map((r) => r.at),
      ...(zeroBased ? [0] : []),
    ];
  const yTicks = niceTicks(
      yDomain?.[0] ?? Math.min(...ys),
      yDomain?.[1] ?? Math.max(...ys)
    ),
    xTicks = niceTicks(
      xDomain?.[0] ?? Math.min(...xs),
      xDomain?.[1] ?? Math.max(...xs),
      width < 420 ? 4 : 6
    );
  const x0 = xDomain?.[0] ?? Math.min(...xs, xTicks[0]),
    x1 = xDomain?.[1] ?? Math.max(...xs, xTicks[xTicks.length - 1]),
    y0 = yTicks[0],
    y1 = yTicks[yTicks.length - 1];
  const margin = {
      left: 12 + Math.max(...yTicks.map((tick) => yText(tick).length)) * 6.5,
      right: 16,
      top: 14,
      bottom: xTitle ? 42 : 26,
    },
    px = scale(x0, x1, margin.left, width - margin.right),
    py = scale(y0, y1, height - margin.bottom, margin.top);
  const visibleX = xTicks.filter((tick) => tick >= x0 && tick <= x1);
  // Every distinct x that has data, for the crosshair and the arrow keys.
  const stops = [...new Set(all.map((p) => p.x))].sort((a, b) => a - b);
  const readout =
    hover == null
      ? null
      : series
          .map((s, index) => {
            const points = s.points.filter(
                (p) => Number.isFinite(p.x) && Number.isFinite(p.y)
              ),
              at = nearestIndex(
                points.map((p) => p.x),
                stops[hover]
              );
            return at < 0 ? null : { s, index, point: points[at] };
          })
          .filter((row): row is NonNullable<typeof row> => !!row);
  const slotOf = (s: { slot?: Slot }, index: number) =>
    s.slot ?? slots[index % slots.length];
  const move = (event: PointerEvent<SVGSVGElement>) => {
    const box = event.currentTarget.getBoundingClientRect(),
      at = ((event.clientX - box.left) / box.width) * width,
      value = x0 + ((at - margin.left) / (width - margin.left - margin.right)) * (x1 - x0);
    setHover(nearestIndex(stops, value));
  };
  const key = (event: KeyboardEvent<SVGSVGElement>) => {
    if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      event.preventDefault();
      setHover((current) =>
        Math.min(
          stops.length - 1,
          Math.max(
            0,
            (current ?? (event.key === "ArrowRight" ? -1 : stops.length)) +
              (event.key === "ArrowRight" ? 1 : -1)
          )
        )
      );
    } else if (event.key === "Escape") setHover(null);
  };
  const hoverX = hover == null ? 0 : px(stops[hover]);
  return (
    <div className="tool-chart-plot" ref={ref}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={label}
        tabIndex={0}
        onPointerMove={move}
        onPointerLeave={() => setHover(null)}
        onKeyDown={key}
        onBlur={() => setHover(null)}
      >
        {yTicks.map((tick) => (
          <g key={`y-${tick}`}>
            <line
              className={tick === y0 ? "tool-chart-baseline" : "tool-chart-grid"}
              x1={margin.left}
              x2={width - margin.right}
              y1={py(tick)}
              y2={py(tick)}
            />
            <text x={margin.left - 8} y={py(tick) + 4} textAnchor="end">
              {yText(tick)}
            </text>
          </g>
        ))}
        {visibleX.map((tick) => (
          <text
            key={`x-${tick}`}
            x={px(tick)}
            y={height - margin.bottom + 16}
            textAnchor="middle"
          >
            {xText(tick)}
          </text>
        ))}
        {xTitle && (
          <text
            className="tool-chart-axis-title"
            x={(margin.left + width - margin.right) / 2}
            y={height - 6}
            textAnchor="middle"
          >
            {xTitle}
          </text>
        )}
        {yTitle && (
          <text className="tool-chart-axis-title" x={0} y={10}>
            {yTitle}
          </text>
        )}
        {rules.map((rule, index) =>
          rule.axis === "y" ? (
            <g key={`rule-${index}`}>
              <line
                className="tool-chart-rule"
                x1={margin.left}
                x2={width - margin.right}
                y1={py(rule.at)}
                y2={py(rule.at)}
              />
              {rule.label && (
                <text
                  className="tool-chart-label"
                  x={width - margin.right}
                  y={py(rule.at) - 5}
                  textAnchor="end"
                >
                  {rule.label}
                </text>
              )}
            </g>
          ) : (
            <g key={`rule-${index}`}>
              <line
                className="tool-chart-rule"
                x1={px(rule.at)}
                x2={px(rule.at)}
                y1={margin.top}
                y2={height - margin.bottom}
              />
              {rule.label && (
                <text
                  className="tool-chart-label"
                  x={px(rule.at) + (px(rule.at) > width * 0.7 ? -5 : 5)}
                  y={margin.top + 10}
                  textAnchor={px(rule.at) > width * 0.7 ? "end" : "start"}
                >
                  {rule.label}
                </text>
              )}
            </g>
          )
        )}
        {series.map((s, index) => {
          const slot = slotOf(s, index),
            points = s.points.filter(
              (p) => Number.isFinite(p.x) && Number.isFinite(p.y)
            ),
            outline = points
              .map((p, i) => `${i ? "L" : "M"}${px(p.x)},${py(p.y)}`)
              .join(" "),
            // The drawn line lifts its pen over points that have no value,
            // so a gap in the data is a gap in the line.
            path = s.points
              .map((p, i) => {
                if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return "";
                const before = s.points[i - 1],
                  joined =
                    !!before &&
                    Number.isFinite(before.x) &&
                    Number.isFinite(before.y);
                return `${joined ? "L" : "M"}${px(p.x)},${py(p.y)}`;
              })
              .filter(Boolean)
              .join(" ");
          return (
            <g key={s.name}>
              {s.area && points.length > 1 && (
                <path
                  className={`tool-chart-area tool-chart-fill-${slot}`}
                  d={`${outline} L${px(points[points.length - 1].x)},${py(
                    y0
                  )} L${px(points[0].x)},${py(y0)} Z`}
                />
              )}
              {s.mark !== "dots" && points.length > 1 && (
                <path
                  className={`tool-chart-line tool-chart-stroke-${slot}`}
                  d={path}
                />
              )}
              {(s.mark === "dots" || s.mark === "both") &&
                points.map((p, i) => (
                  <circle
                    key={i}
                    className={`tool-chart-dot tool-chart-fill-${slot}`}
                    cx={px(p.x)}
                    cy={py(p.y)}
                    r={4}
                  />
                ))}
            </g>
          );
        })}
        {hover != null && (
          <line
            className="tool-chart-crosshair"
            x1={hoverX}
            x2={hoverX}
            y1={margin.top}
            y2={height - margin.bottom}
          />
        )}
        {readout?.map(({ s, index, point }) => (
          <circle
            key={`hover-${s.name}`}
            className={`tool-chart-dot tool-chart-fill-${slotOf(s, index)}`}
            cx={px(point.x)}
            cy={py(point.y)}
            r={5}
          />
        ))}
        {marks.map((mark, index) => {
          const cx = px(mark.x),
            cy = py(mark.y),
            end = cx > width * 0.7;
          return (
            <g key={`mark-${index}`}>
              <circle
                className={`tool-chart-dot tool-chart-fill-${mark.slot ?? 1}`}
                cx={cx}
                cy={cy}
                r={5}
              />
              <text
                className="tool-chart-label"
                x={cx + (end ? -9 : 9)}
                y={cy + (cy < margin.top + 18 ? 16 : -8)}
                textAnchor={end ? "end" : "start"}
              >
                {mark.label}
              </text>
            </g>
          );
        })}
      </svg>
      {readout && hover != null && (
        <div
          className="tool-chart-tooltip"
          style={
            hoverX > width / 2
              ? { right: `${((width - hoverX) / width) * 100 + 2}%` }
              : { left: `${(hoverX / width) * 100 + 2}%` }
          }
        >
          <em>
            {xTitle ? `${xTitle} ` : ""}
            {xText(stops[hover])}
          </em>
          {readout.map(({ s, index, point }) => (
            <span key={s.name}>
              <i className={`tool-chart-fill-${slotOf(s, index)}`} />
              <b>{yText(point.y)}</b>
              {series.length > 1 && s.name}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/** The scale of a heat-coloured grid: its steps with the values at both ends. */
export function ScaleLegend({
  min,
  max,
  title,
}: {
  min: string;
  max: string;
  title?: string;
}) {
  return (
    <div className="tool-chart tool-chart-scale">
      {title && <span>{title}</span>}
      <span>{min}</span>
      <div aria-hidden="true">
        {Array.from({ length: HEAT_STEPS }, (_, step) => (
          <i key={step} className={`tool-chart-heat-${step}`} />
        ))}
      </div>
      <span>{max}</span>
    </div>
  );
}

/**
 * Vessels in a row with what moves from each into the next: a serial
 * dilution. A vessel's tint places it on a magnitude scale (`step`, from
 * `heatStep`); the figures under it carry the values, so the tint is never
 * the only way to read them.
 */
export function TransferChain({
  label,
  source,
  steps,
}: {
  /** What the chain shows, for assistive technology. */
  label: string;
  source: { title: string; value?: string; step?: number | null };
  steps: {
    title: string;
    /** What this vessel ends up holding, e.g. "10 mM". */
    value: string;
    /** What is carried into it from the vessel before, e.g. "1 mL". */
    moved: string;
    /** What is added to make it up, e.g. "+ 9 mL". */
    added?: string;
    step?: number | null;
    /** The whole step in words, read in place of the parts. */
    description: string;
  }[];
}) {
  const tint = (step: number | null | undefined) =>
    step == null ? "" : ` tool-chart-heat-${step}`;
  return (
    <ol className="tool-chart-chain" aria-label={label}>
      <li>
        <span className="tool-chart-chain-node">
          <span className={`tool-chart-chain-vessel${tint(source.step)}`}>
            {source.title}
          </span>
          {source.value && <b>{source.value}</b>}
        </span>
      </li>
      {steps.map((item, index) => (
        <li key={index} aria-label={item.description}>
          <span className="tool-chart-chain-move" aria-hidden="true">
            <em>{item.moved}</em>
            <i>→</i>
          </span>
          <span className="tool-chart-chain-node" aria-hidden="true">
            <span className={`tool-chart-chain-vessel${tint(item.step)}`}>
              {item.title}
            </span>
            <b>{item.value}</b>
            {item.added && <small>{item.added}</small>}
          </span>
        </li>
      ))}
    </ol>
  );
}
