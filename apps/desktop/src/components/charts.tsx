/** Small SVG charts (spec 04 "Grafer"). Every chart carries a text summary in aria-label. */
import { formatMoney } from "../lib/format";

/** Horizontal bar: actual against budget. Over budget is red and also said in text. */
export function HBar({ label, value, max, budget }: { label: string; value: number; max: number; budget: number }) {
  const scale = Math.max(max, 1);
  const w = Math.min(100, (value / scale) * 100);
  const bw = Math.min(100, (budget / scale) * 100);
  const over = budget > 0 && value > budget;
  const summary = `${label}: ${formatMoney(value)} af ${formatMoney(budget)}${over ? ", over budget" : ""}`;
  return (
    <div className="hbar">
      <span>{label}</span>
      <svg viewBox="0 0 100 12" preserveAspectRatio="none" role="img" aria-label={summary}>
        <rect className="track" x="0" y="2" width="100" height="8" rx="4" />
        <rect className={`fill${over ? " over" : ""}`} x="0" y="2" width={w} height="8" rx="4" />
        {budget > 0 && <line className="marker" x1={bw} x2={bw} y1="0" y2="12" vectorEffect="non-scaling-stroke" />}
      </svg>
      <span className={`small num ${over ? "danger" : ""}`}>
        {formatMoney(value)} / {formatMoney(budget)}
        {over && " – over budget"}
      </span>
    </div>
  );
}

const MONTHS = ["jan", "feb", "mar", "apr", "maj", "jun", "jul", "aug", "sep", "okt", "nov", "dec"];
export const monthShort = (ym: string) => MONTHS[Number(ym.slice(5, 7)) - 1] ?? ym;

/** Line chart with month labels (used for 6 months of spending). */
export function LineChart({
  points,
  label,
  width = 320,
  height = 120,
}: {
  points: { x: string; y: number }[];
  label: string;
  width?: number;
  height?: number;
}) {
  const pad = { l: 8, r: 8, t: 10, b: 20 };
  const max = Math.max(1, ...points.map((p) => p.y));
  const step = points.length > 1 ? (width - pad.l - pad.r) / (points.length - 1) : 0;
  const xy = points.map((p, i) => [pad.l + i * step, pad.t + (1 - p.y / max) * (height - pad.t - pad.b)] as const);
  const path = xy.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const summary = `${label}: ${points.map((p) => `${monthShort(p.x)} ${formatMoney(p.y)}`).join(", ")}`;
  return (
    <figure className="chart-line" style={{ margin: 0 }}>
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={summary}>
        <line className="axis" x1={pad.l} x2={width - pad.r} y1={height - pad.b} y2={height - pad.b} />
        <path d={path} fill="none" stroke="currentColor" strokeWidth="2" />
        {xy.map(([x, y], i) => (
          <circle key={points[i]!.x} cx={x} cy={y} r="3" fill="currentColor" />
        ))}
        {xy.map(([x], i) => (
          <text key={`t${points[i]!.x}`} x={x} y={height - 5} textAnchor="middle">
            {monthShort(points[i]!.x)}
          </text>
        ))}
      </svg>
      <figcaption className="small muted">{label}</figcaption>
    </figure>
  );
}

/** Tiny trend line without axes. */
export function Sparkline({ values, label, width = 90, height = 24 }: { values: number[]; label: string; width?: number; height?: number }) {
  const max = Math.max(1, ...values);
  const min = Math.min(0, ...values);
  const step = values.length > 1 ? width / (values.length - 1) : 0;
  const d = values
    .map((v, i) => `${i ? "L" : "M"}${(i * step).toFixed(1)},${(height - 2 - ((v - min) / (max - min || 1)) * (height - 4)).toFixed(1)}`)
    .join(" ");
  return (
    <svg className="chart-line" width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label}>
      <path d={d} fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

export interface Series {
  label: string;
  /** CSS class for the colour: "s-income", "s-expense", "s-budget" (dashed) or "s-main". */
  kind: "s-income" | "s-expense" | "s-budget" | "s-main";
  values: number[];
}

/**
 * Several lines over the same months with a legend. The text summary (aria-label and the
 * legend) says the same as the chart, so colour is never the only carrier of meaning.
 */
export function MultiLineChart({ months, series, label, width = 560, height = 180 }: { months: string[]; series: Series[]; label: string; width?: number; height?: number }) {
  const pad = { l: 52, r: 10, t: 10, b: 22 };
  const max = Math.max(1, ...series.flatMap((s) => s.values));
  const step = months.length > 1 ? (width - pad.l - pad.r) / (months.length - 1) : 0;
  const y = (v: number) => pad.t + (1 - v / max) * (height - pad.t - pad.b);
  const ticks = [0, max / 2, max];
  const summary = `${label}. ${series.map((s) => `${s.label}: ${months.map((m, i) => `${monthShort(m)} ${formatMoney(s.values[i] ?? 0)}`).join(", ")}`).join(". ")}`;
  return (
    <figure className="chart-multi" style={{ margin: 0 }}>
      <svg width="100%" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={summary} preserveAspectRatio="xMinYMin meet">
        {ticks.map((t) => (
          <g key={t}>
            <line className="grid" x1={pad.l} x2={width - pad.r} y1={y(t)} y2={y(t)} />
            <text x={pad.l - 6} y={y(t) + 4} textAnchor="end">
              {Math.round(t / 100).toLocaleString("da-DK")}
            </text>
          </g>
        ))}
        {series.map((s) => (
          <g key={s.label} className={s.kind}>
            <path d={s.values.map((v, i) => `${i ? "L" : "M"}${(pad.l + i * step).toFixed(1)},${y(v).toFixed(1)}`).join(" ")} fill="none" />
            {s.kind !== "s-budget" && s.values.map((v, i) => <circle key={months[i]} cx={pad.l + i * step} cy={y(v)} r="3" />)}
          </g>
        ))}
        {months.map((m, i) => (
          <text key={m} x={pad.l + i * step} y={height - 6} textAnchor="middle">
            {monthShort(m)}
          </text>
        ))}
      </svg>
      <figcaption className="legend small">
        {series.map((s) => (
          <span key={s.label} className={s.kind}>
            <svg width="22" height="10" aria-hidden="true">
              <line x1="1" x2="21" y1="5" y2="5" />
            </svg>
            {s.label}
          </span>
        ))}
        <span className="muted">kr. pr. måned</span>
      </figcaption>
    </figure>
  );
}
