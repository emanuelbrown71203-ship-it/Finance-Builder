"use client";

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { formatMedium, formatShort, monthName, type ISODate } from "@/lib/dates";
import type { MonthPlan } from "@/lib/finance/plan";
import { dollars, dollarsCompact, dollarsExact } from "@/lib/money";
import { cx } from "./ui";

/*
  Charts are hand-drawn SVG so they follow one set of rules, in the app's
  arcade style: step lines (each value holds until the next, like an old
  game's graph), bars built from blocks, a dotted grid, square markers, a glow
  at night; a crosshair that finds the date for you, values in ink (never in
  the series color), and a legend whenever there are two series.
*/

/** A step line through the points: across to the next one, then up or down to it. */
function stepLine(points: [number, number][]): string {
  return points.map(([px, py], i) => (i === 0 ? `M${px.toFixed(1)},${py.toFixed(1)}` : `H${px.toFixed(1)}V${py.toFixed(1)}`)).join("");
}

/** A square marker, centred on a point. */
function Marker({ x, y, size = 10, fill = "var(--series-1)", stroke = "var(--sheet)" }: { x: number; y: number; size?: number; fill?: string; stroke?: string }) {
  return <rect x={x - size / 2} y={y - size / 2} width={size} height={size} fill={fill} stroke={stroke} strokeWidth="2" />;
}

function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, width];
}

/** Round axis values (0 / 2K / 4K rather than 0 / 1,873 / 3,746), at least three of them. */
export function niceTicks(min: number, max: number): number[] {
  if (!(max > min)) return [Math.round(min)];
  const magnitude = 10 ** Math.floor(Math.log10(max - min));
  const steps = [5, 2.5, 2, 1, 0.5, 0.25, 0.2, 0.1].map((m) => m * magnitude);
  const ticksFor = (step: number) => {
    const out: number[] = [];
    for (let v = Math.ceil(min / step - 1e-9) * step; v <= max + step * 1e-9; v += step) out.push(Math.round(v) + 0); // + 0 turns -0 into 0
    return out;
  };
  // The coarsest step that still gives the eye three reference lines.
  for (const step of steps) {
    const ticks = ticksFor(step);
    if (ticks.length >= 3) return ticks;
  }
  return ticksFor(steps[steps.length - 1]);
}

function Tooltip({ x, width, children }: { x: number; width: number; children: ReactNode }) {
  // Flips to the other side of the crosshair near the right edge.
  const flip = x > width - 190;
  return (
    <div
      role="status"
      className="pointer-events-none absolute top-0 z-10 w-max max-w-[220px] rounded-control border border-line bg-sheet px-3 py-2 text-small shadow-[0_8px_24px_-12px_rgb(22_36_77/0.4)]"
      style={flip ? { right: width - x + 10 } : { left: x + 10 }}
    >
      {children}
    </div>
  );
}

export function LegendKey({ color, label, shape = "line", dashed }: { color: string; label: string; shape?: "line" | "rect" | "dot" | "square" | "ring"; dashed?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-micro text-ink-2">
      <svg width="14" height="10" aria-hidden>
        {shape === "line" && <line x1="1" x2="13" y1="5" y2="5" stroke={color} strokeWidth="2" strokeLinecap="round" strokeDasharray={dashed ? "3 3" : undefined} />}
        {shape === "rect" && <rect x="1" y="1" width="12" height="8" rx="2" fill={color} />}
        {shape === "dot" && <circle cx="7" cy="5" r="4" fill={color} />}
        {shape === "square" && <rect x="3" y="1" width="8" height="8" rx="1.5" fill={color} />}
        {shape === "ring" && <circle cx="7" cy="5" r="3.25" fill="none" stroke={color} strokeWidth="1.5" />}
      </svg>
      {label}
    </span>
  );
}

/* ---------- trend line ---------- */

export type TrendPoint = { date: ISODate; value: number; detail?: { label: string; value: number }[] };

/**
 * `compare` draws a second, quieter dashed line over the same dates (for
 * "what would happen otherwise"), with a legend naming both.
 */
export function TrendChart({ points, label, height = 230, compare, formatDate = formatMedium }: { points: TrendPoint[]; label: string; height?: number; compare?: { values: number[]; label: string; mainLabel: string }; formatDate?: (date: ISODate) => string }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);
  const gradient = useId();
  const m = { top: 10, right: 14, bottom: 24, left: 46 };
  const plotW = Math.max(0, width - m.left - m.right);
  const plotH = height - m.top - m.bottom;

  const scale = useMemo(() => {
    const values = [...points.map((p) => p.value), ...(compare?.values ?? [])];
    const lo = Math.min(...values);
    const hi = Math.max(...values);
    const pad = (hi - lo || Math.abs(hi) || 100) * 0.12;
    // Trend lines don’t need to start at zero, but never dip below it for nothing.
    const min = lo >= 0 ? Math.max(0, lo - pad) : lo - pad;
    const max = hi + pad;
    return { min, max, ticks: niceTicks(min, max) };
  }, [points, compare]);

  if (points.length < 2) return <div ref={ref} className="grid place-items-center text-small text-ink-3" style={{ height }}>Not enough history yet. This fills in as days go by.</div>;

  const x = (i: number) => m.left + (i / (points.length - 1)) * plotW;
  const y = (v: number) => m.top + (1 - (v - scale.min) / (scale.max - scale.min)) * plotH;
  const line = stepLine(points.map((p, i) => [x(i), y(p.value)]));
  const area = `${line}L${x(points.length - 1).toFixed(1)},${m.top + plotH}L${m.left},${m.top + plotH}Z`;
  const xTicks = [0, 1, 2, 3].map((k) => Math.round((k / 3) * (points.length - 1)));
  // The comparison runs over the same dates; if it is longer, it just runs off the right edge.
  const compareLine = compare ? compare.values.slice(0, points.length).map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("") : null;
  const shown = active ?? points.length - 1;
  const first = points[0];
  const last = points[points.length - 1];

  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = (e.clientX - rect.left - m.left) / plotW;
    setActive(Math.min(points.length - 1, Math.max(0, Math.round(ratio * (points.length - 1)))));
  };
  const onKey = (e: KeyboardEvent<SVGSVGElement>) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const step = (e.shiftKey ? 7 : 1) * (e.key === "ArrowLeft" ? -1 : 1);
    setActive(Math.min(points.length - 1, Math.max(0, (active ?? points.length - 1) + step)));
  };

  return (
    <div ref={ref} className="relative" style={{ height }}>
      {width > 0 && (
        <svg
          width={width}
          height={height}
          role="img"
          tabIndex={0}
          aria-label={`${label}: ${dollars(first.value)} on ${formatDate(first.date)}, ${dollars(last.value)} on ${formatDate(last.date)}. Use the arrow keys to read each point.`}
          onPointerMove={onMove}
          onPointerLeave={() => setActive(null)}
          onKeyDown={onKey}
          onBlur={() => setActive(null)}
          className="block touch-pan-y select-none rounded-control"
        >
          <defs>
            <linearGradient id={gradient} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" stopColor="var(--series-1)" stopOpacity="0.28" />
              <stop offset="1" stopColor="var(--series-1)" stopOpacity="0.02" />
            </linearGradient>
          </defs>
          {scale.ticks.map((t) => (
            <g key={t}>
              <line x1={m.left} x2={width - m.right} y1={y(t)} y2={y(t)} stroke="var(--grid)" strokeDasharray="2 4" />
              <text x={m.left - 8} y={y(t) + 4} textAnchor="end" className="tabular fill-ink-3 text-[11px]">
                {dollarsCompact(t)}
              </text>
            </g>
          ))}
          {xTicks.map((i, k) => (
            <text key={i} x={x(i)} y={height - 6} textAnchor={k === 0 ? "start" : k === xTicks.length - 1 ? "end" : "middle"} className="fill-ink-3 text-[11px]">
              {formatDate === formatMedium ? formatShort(points[i].date) : formatDate(points[i].date)}
            </text>
          ))}
          <path d={area} fill={`url(#${gradient})`} />
          {compareLine && <path d={compareLine} fill="none" stroke="var(--series-muted)" strokeWidth="1.75" strokeDasharray="4 4" strokeLinejoin="round" />}
          <path d={line} fill="none" stroke="var(--series-1)" strokeWidth="3" strokeLinejoin="miter" strokeLinecap="square" className="glow-line" />
          {active !== null && <line x1={x(shown)} x2={x(shown)} y1={m.top} y2={m.top + plotH} stroke="var(--axis)" />}
          <Marker x={x(shown)} y={y(points[shown].value)} />
        </svg>
      )}
      {active !== null && width > 0 && (
        <Tooltip x={x(active)} width={width}>
          <p className="tabular font-semibold">{dollars(points[active].value)}</p>
          <p className="text-micro text-ink-3">{formatDate(points[active].date)}</p>
          {compare && compare.values[active] !== undefined && (
            <p className="mt-1 flex justify-between gap-4 text-micro">
              <span className="text-ink-3">{compare.label}</span>
              <span className="tabular">{dollars(compare.values[active])}</span>
            </p>
          )}
          {points[active].detail?.map((d) => (
            <p key={d.label} className="mt-1 flex justify-between gap-4 text-micro">
              <span className="text-ink-3">{d.label}</span>
              <span className="tabular">{dollars(d.value)}</span>
            </p>
          ))}
        </Tooltip>
      )}
      {compare && (
        <div className="absolute inset-x-0 -bottom-7 flex flex-wrap gap-x-4 pl-[46px]">
          <LegendKey color="var(--series-1)" label={compare.mainLabel} />
          <LegendKey color="var(--series-muted)" label={compare.label} dashed />
        </div>
      )}
    </div>
  );
}

export function Sparkline({ values, width = 120, height = 36, label }: { values: number[]; width?: number; height?: number; label: string }) {
  if (values.length < 2) return <svg width={width} height={height} aria-hidden />;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const x = (i: number) => 3 + (i / (values.length - 1)) * (width - 8);
  const y = (v: number) => 4 + (1 - (v - min) / (max - min || 1)) * (height - 8);
  const d = stepLine(values.map((v, i) => [x(i), y(v)]));
  return (
    <svg width={width} height={height} role="img" aria-label={label} className="shrink-0">
      <path d={d} fill="none" stroke="var(--series-muted)" strokeWidth="2.5" strokeLinejoin="miter" strokeLinecap="square" />
      <Marker x={x(values.length - 1)} y={y(values[values.length - 1])} size={8} />
    </svg>
  );
}

/* ---------- the month runway ---------- */

/**
 * The month at a glance. The line is what’s left to spend, falling as you
 * spend; the dashed guide is spending it evenly. Above the guide means you’re
 * ahead. Underneath, each payday and bill sits on its date: filled once it
 * has happened, hollow while it’s still expected.
 */
export function Runway({ plan, height = 250 }: { plan: MonthPlan; height?: number }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [activeDay, setActiveDay] = useState<number | null>(null);
  const n = plan.days.length;
  const todayIndex = plan.days.findIndex((d) => d.date === plan.today) + 1 || n;
  const stripH = 44;
  const m = { top: 18, right: 14, bottom: 22 + stripH, left: 46 };
  const plotW = Math.max(0, width - m.left - m.right);
  const plotH = height - m.top - m.bottom;

  const budget = plan.incomeExpected - plan.billsExpected - plan.savingsPlanned;
  const left = useMemo(() => {
    const out = [budget];
    for (let d = 1; d <= todayIndex; d++) out.push(out[d - 1] - plan.days[d - 1].everyday);
    return out;
  }, [budget, plan.days, todayIndex]);

  const lo = Math.min(0, ...left);
  const hi = Math.max(budget, ...left, 100);
  const pad = (hi - lo) * 0.06;
  const ticks = niceTicks(lo, hi);
  const x = (d: number) => m.left + (d / n) * plotW;
  const y = (v: number) => m.top + (1 - (v - (lo - (lo < 0 ? pad : 0))) / (hi + pad - (lo - (lo < 0 ? pad : 0)))) * plotH;
  const line = stepLine(left.map((v, d) => [x(d), y(v)]));
  const stripTop = height - stripH + 2;
  const day = activeDay ? plan.days[activeDay - 1] : null;

  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setActiveDay(Math.min(n, Math.max(1, Math.ceil(((e.clientX - rect.left - m.left) / plotW) * n))));
  };
  const onKey = (e: KeyboardEvent<SVGSVGElement>) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    setActiveDay(Math.min(n, Math.max(1, (activeDay ?? todayIndex) + (e.key === "ArrowLeft" ? -1 : 1))));
  };

  return (
    <div>
      <div ref={ref} className="relative" style={{ height }}>
        {width > 0 && (
          <svg
            width={width}
            height={height}
            role="img"
            tabIndex={0}
            aria-label={`${monthName(plan.month)} so far: ${dollars(budget)} to spend after bills and savings, ${dollars(plan.leftToSpend)} left on day ${todayIndex} of ${n}. Use the arrow keys to read each day.`}
            onPointerMove={onMove}
            onPointerLeave={() => setActiveDay(null)}
            onKeyDown={onKey}
            onBlur={() => setActiveDay(null)}
            className="block touch-pan-y select-none rounded-control"
          >
            {ticks.map((t) => (
              <g key={t}>
                <line x1={m.left} x2={width - m.right} y1={y(t)} y2={y(t)} stroke={t === 0 ? "var(--axis)" : "var(--grid)"} strokeDasharray={t === 0 ? undefined : "2 4"} />
                <text x={m.left - 8} y={y(t) + 4} textAnchor="end" className="tabular fill-ink-3 text-[11px]">
                  {dollarsCompact(t)}
                </text>
              </g>
            ))}
            {[1, 8, 15, 22, n].map((d) => (
              <text key={d} x={x(d - 0.5)} y={m.top + plotH + 16} textAnchor="middle" className="tabular fill-ink-3 text-[11px]">
                {d}
              </text>
            ))}

            {/* Even pace: a guide, not data, so it’s dashed and quiet. */}
            <line x1={x(0)} y1={y(budget)} x2={x(n)} y2={y(0)} stroke="var(--series-muted)" strokeWidth="1.5" strokeDasharray="4 4" />

            <line x1={x(todayIndex)} x2={x(todayIndex)} y1={m.top - 4} y2={m.top + plotH} stroke="var(--axis)" />
            <text x={x(todayIndex)} y={m.top - 8} textAnchor={todayIndex > n - 3 ? "end" : "middle"} className="fill-ink-2 text-[11px] font-medium">
              Today
            </text>

            <path d={line} fill="none" stroke="var(--series-1)" strokeWidth="3" strokeLinejoin="miter" strokeLinecap="square" className="glow-line" />
            {activeDay !== null && activeDay <= todayIndex && <Marker x={x(activeDay)} y={y(left[activeDay])} size={8} fill="var(--sheet)" stroke="var(--series-1)" />}
            <Marker x={x(todayIndex)} y={y(left[todayIndex])} />

            {/* What lands on each date. */}
            <text x={m.left - 8} y={stripTop + 12} textAnchor="end" className="fill-ink-3 text-[11px]">In</text>
            <text x={m.left - 8} y={stripTop + 32} textAnchor="end" className="fill-ink-3 text-[11px]">Bills</text>
            <line x1={m.left} x2={width - m.right} y1={stripTop + 18} y2={stripTop + 18} stroke="var(--grid)" strokeDasharray="2 4" />
            {plan.days.map((d, i) => {
              const cx_ = x(i + 0.5);
              const settledIncome = d.events.some((e) => e.type === "income" && e.settled);
              const settledBill = d.events.some((e) => e.type === "bill" && e.settled);
              return (
                <g key={d.date}>
                  {d.income > 0 &&
                    (settledIncome ? <circle cx={cx_} cy={stripTop + 8} r="4" fill="var(--series-3)" /> : <circle cx={cx_} cy={stripTop + 8} r="3.25" fill="var(--sheet)" stroke="var(--series-3)" strokeWidth="1.5" />)}
                  {d.bills > 0 &&
                    (settledBill ? (
                      <rect x={cx_ - 4} y={stripTop + 24} width="8" height="8" rx="1.5" fill="var(--series-5)" />
                    ) : (
                      <rect x={cx_ - 3.25} y={stripTop + 24.75} width="6.5" height="6.5" rx="1.5" fill="var(--sheet)" stroke="var(--series-5)" strokeWidth="1.5" />
                    ))}
                </g>
              );
            })}
            {activeDay !== null && <rect x={x(activeDay - 1)} y={m.top} width={plotW / n} height={height - m.top} fill="var(--ink)" opacity="0.05" rx="3" />}
          </svg>
        )}
        {day && activeDay !== null && width > 0 && (
          <Tooltip x={x(activeDay)} width={width}>
            <p className="font-semibold">{formatShort(day.date)}</p>
            {activeDay <= todayIndex && <p className="tabular text-micro text-ink-3">{dollars(left[activeDay])} left to spend</p>}
            {day.events.length === 0 && <p className="mt-1 text-micro text-ink-3">{day.projected ? "Nothing expected" : "No activity"}</p>}
            {[...day.events]
              .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))
              .slice(0, 5)
              .map((e, i) => (
                <p key={i} className="mt-1 flex justify-between gap-4 text-micro">
                  <span className="truncate text-ink-2">
                    {e.name}
                    {!e.settled && " (expected)"}
                  </span>
                  <span className="tabular shrink-0">{e.amount > 0 ? `+${dollarsExact(e.amount)}` : dollarsExact(-e.amount)}</span>
                </p>
              ))}
            {day.events.length > 5 && <p className="mt-1 text-micro text-ink-3">and {day.events.length - 5} more</p>}
          </Tooltip>
        )}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 pl-[46px]">
        <LegendKey color="var(--series-1)" label="Left to spend" />
        <LegendKey color="var(--series-muted)" label="Even pace" dashed />
        <LegendKey color="var(--series-3)" label="Money in" shape="dot" />
        <LegendKey color="var(--series-5)" label="Bill" shape="square" />
        <LegendKey color="var(--ink-3)" label="Hollow means expected" shape="ring" />
      </div>
    </div>
  );
}

/* ---------- columns ---------- */

export type ColumnGroup = { key: string; label: string; values: number[] };

/** Side-by-side columns per period, for one or two series. */
const BLOCK = 7;
const BLOCK_GAP = 2;

export function Columns({ groups, series, height = 210, label }: { groups: ColumnGroup[]; series: { name: string; color: string }[]; height?: number; label: string }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);
  const m = { top: 10, right: 8, bottom: 24, left: 46 };
  const plotW = Math.max(0, width - m.left - m.right);
  const plotH = height - m.top - m.bottom;
  const max = Math.max(1, ...groups.flatMap((g) => g.values));
  const ticks = niceTicks(0, max * 1.05);
  const top = Math.max(ticks[ticks.length - 1], max);
  const band = plotW / Math.max(1, groups.length);
  const barW = Math.min(24, Math.max(6, (band - 14) / series.length - 2));
  const y = (v: number) => m.top + (1 - v / top) * plotH;
  const base = m.top + plotH;

  return (
    <div>
      <div ref={ref} className="relative" style={{ height }}>
        {width > 0 && (
          <svg width={width} height={height} role="img" aria-label={label} className="block">
            {ticks.map((t) => (
              <g key={t}>
                <line x1={m.left} x2={width - m.right} y1={y(t)} y2={y(t)} stroke={t === 0 ? "var(--axis)" : "var(--grid)"} strokeDasharray={t === 0 ? undefined : "2 4"} />
                <text x={m.left - 8} y={y(t) + 4} textAnchor="end" className="tabular fill-ink-3 text-[11px]">
                  {dollarsCompact(t)}
                </text>
              </g>
            ))}
            {groups.map((g, i) => {
              const center = m.left + band * (i + 0.5);
              const total = series.length * barW + (series.length - 1) * 2;
              return (
                <g key={g.key} tabIndex={0} onPointerEnter={() => setActive(i)} onPointerLeave={() => setActive(null)} onFocus={() => setActive(i)} onBlur={() => setActive(null)} aria-label={`${g.label}: ${series.map((s, k) => `${s.name} ${dollars(g.values[k])}`).join(", ")}`} className="outline-none">
                  <rect x={m.left + band * i} y={m.top} width={band} height={plotH + m.bottom} fill={active === i ? "var(--ink)" : "transparent"} opacity="0.05" rx="4" />
                  {g.values.map((v, k) => {
                    const h = Math.max(v > 0 ? 2 : 0, base - y(v));
                    const bx = center - total / 2 + k * (barW + 2);
                    // Built from blocks stacked up from the baseline, the top one cut to the value.
                    const blocks: { y: number; h: number }[] = [];
                    for (let at = 0; at < h; at += BLOCK + BLOCK_GAP) blocks.push({ y: base - Math.min(h, at + BLOCK), h: Math.min(BLOCK, h - at) });
                    return (
                      <g key={k} fill={series[k].color} className="glow-line">
                        {blocks.map((b, j) => (
                          <rect key={j} x={bx} y={b.y} width={barW} height={b.h} />
                        ))}
                      </g>
                    );
                  })}
                  <text x={center} y={height - 6} textAnchor="middle" className="fill-ink-3 text-[11px]">
                    {g.label}
                  </text>
                </g>
              );
            })}
          </svg>
        )}
        {active !== null && width > 0 && (
          <Tooltip x={m.left + band * (active + 0.5)} width={width}>
            <p className="text-micro text-ink-3">{groups[active].label}</p>
            {series.map((s, k) => (
              <p key={s.name} className="mt-1 flex items-center justify-between gap-4">
                <span className="tabular font-semibold">{dollars(groups[active].values[k])}</span>
                <LegendKey color={s.color} label={s.name} />
              </p>
            ))}
          </Tooltip>
        )}
      </div>
      {series.length > 1 && (
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 pl-[46px]">
          {series.map((s) => (
            <LegendKey key={s.name} color={s.color} label={s.name} shape="rect" />
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------- one whole, split into parts ---------- */

export const SERIES_COLORS = ["var(--series-1)", "var(--series-2)", "var(--series-3)", "var(--series-4)", "var(--series-5)", "var(--series-6)"];
/** Label color inside each series fill, chosen per colour and mode so it stays readable (see --series-N-ink). */
const INSIDE_LABEL = ["var(--series-1-ink)", "var(--series-2-ink)", "var(--series-3-ink)", "var(--series-4-ink)", "var(--series-5-ink)", "var(--series-6-ink)"];

export function SegmentedBar({ parts, label }: { parts: { name: string; value: number }[]; label: string }) {
  const total = parts.reduce((s, p) => s + p.value, 0);
  const [active, setActive] = useState<number | null>(null);
  if (total <= 0) return null;
  return (
    <div>
      <div role="img" aria-label={`${label}: ${parts.map((p) => `${p.name} ${Math.round((p.value / total) * 100)}%`).join(", ")}`} className="flex h-7 w-full gap-0.5">
        {parts.map((p, i) => {
          const share = p.value / total;
          if (share <= 0) return null;
          return (
            <div
              key={p.name}
              tabIndex={0}
              title={`${p.name}: ${dollars(p.value)} (${Math.round(share * 100)}%)`}
              onPointerEnter={() => setActive(i)}
              onPointerLeave={() => setActive(null)}
              onFocus={() => setActive(i)}
              onBlur={() => setActive(null)}
              className={cx("flex min-w-1 items-center rounded-[4px] px-1.5 text-micro font-semibold transition-opacity", active !== null && active !== i && "opacity-60")}
              style={{ width: `${share * 100}%`, background: SERIES_COLORS[i % SERIES_COLORS.length], color: INSIDE_LABEL[i % INSIDE_LABEL.length] }}
            >
              {/* Only print the share when the block is wide enough to hold it. */}
              {share >= 0.09 && <span className="tabular">{Math.round(share * 100)}%</span>}
            </div>
          );
        })}
      </div>
      <ul className="mt-3 grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
        {parts.map((p, i) => (
          <li key={p.name} className={cx("flex items-center justify-between gap-3 text-small transition-opacity", active !== null && active !== i && "opacity-60")}>
            <span className="flex items-center gap-2">
              <span aria-hidden className="size-2.5 rounded-[3px]" style={{ background: SERIES_COLORS[i % SERIES_COLORS.length] }} />
              {p.name}
            </span>
            <span className="tabular text-ink-2">{dollars(p.value)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}


/* ---------- goal track ---------- */

/**
 * The track to a savings goal: a dashed straight line from what was saved at
 * the start to the target on its date (the plan), the saved amount so far as
 * a solid stepped line (what really happened), and a marker for today.
 */
export function GoalTrack({ start, end, startSaved, target, history, today, plan = true, height = 220 }: { start: ISODate; end: ISODate; startSaved: number; target: number; history: { date: ISODate; amount: number }[]; today: ISODate; plan?: boolean; height?: number }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);
  const m = { top: 30, right: 16, bottom: 24, left: 46 };
  const plotW = Math.max(0, width - m.left - m.right);
  const plotH = height - m.top - m.bottom;

  const days = useMemo(() => {
    const out: ISODate[] = [];
    const total = Math.max(1, Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000));
    // One point a day, or fewer for long goals so the line stays light.
    const step = Math.max(1, Math.ceil(total / 400));
    for (let i = 0; i <= total; i += step) out.push(new Date(Date.parse(`${start}T00:00:00Z`) + i * 86_400_000).toISOString().slice(0, 10));
    if (out[out.length - 1] !== end) out.push(end);
    return out;
  }, [start, end]);

  const totalDays = Math.max(1, days.length - 1);
  const planAt = (i: number) => Math.round(startSaved + (target - startSaved) * (i / totalDays));
  const savedAt = (date: ISODate) => {
    let v = startSaved;
    for (const p of history) if (p.date <= date) v = p.amount;
    return v;
  };
  const todayIndex = Math.max(0, days.findLastIndex((d) => d <= today));
  const maxValue = Math.max(target, ...history.map((h) => h.amount));
  const ticks = niceTicks(0, maxValue * 1.05);
  const top = ticks[ticks.length - 1] || 1;

  const x = (i: number) => m.left + (i / totalDays) * plotW;
  const y = (v: number) => m.top + (1 - v / top) * plotH;

  const planLine = `M${x(0).toFixed(1)},${y(startSaved).toFixed(1)}L${x(totalDays).toFixed(1)},${y(target).toFixed(1)}`;
  let savedLine = "";
  let prev = startSaved;
  for (let i = 0; i <= todayIndex; i++) {
    const v = savedAt(days[i]);
    savedLine += i === 0 ? `M${x(0).toFixed(1)},${y(v).toFixed(1)}` : `${v !== prev ? `L${x(i).toFixed(1)},${y(prev).toFixed(1)}` : ""}L${x(i).toFixed(1)},${y(v).toFixed(1)}`;
    prev = v;
  }
  const shown = active ?? todayIndex;
  const xTicks = [0, Math.round(totalDays / 2), totalDays];

  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = (e.clientX - rect.left - m.left) / plotW;
    setActive(Math.min(totalDays, Math.max(0, Math.round(ratio * totalDays))));
  };
  const onKey = (e: KeyboardEvent<SVGSVGElement>) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const step = (e.shiftKey ? 30 : 7) * (e.key === "ArrowLeft" ? -1 : 1);
    setActive(Math.min(totalDays, Math.max(0, (active ?? todayIndex) + step)));
  };

  return (
    <div ref={ref} className="relative pb-7" style={{ height: height + 28 }}>
      {width > 0 && (
        <svg
          width={width}
          height={height}
          role="img"
          tabIndex={0}
          aria-label={`Track to ${dollars(target)}${plan ? ` by ${formatMedium(end)}` : ""}. Saved ${dollars(savedAt(today))} by today${plan ? `; the plan has ${dollars(planAt(todayIndex))}` : ""}. Use the arrow keys to read along the track.`}
          onPointerMove={onMove}
          onPointerLeave={() => setActive(null)}
          onKeyDown={onKey}
          onBlur={() => setActive(null)}
          className="block touch-pan-y select-none rounded-control"
        >
          {ticks.map((t) => (
            <g key={t}>
              <line x1={m.left} x2={width - m.right} y1={y(t)} y2={y(t)} stroke="var(--grid)" strokeDasharray="2 4" />
              <text x={m.left - 8} y={y(t) + 4} textAnchor="end" className="tabular fill-ink-3 text-[11px]">
                {dollarsCompact(t)}
              </text>
            </g>
          ))}
          {xTicks.map((i, k) => (
            <text key={k} x={x(i)} y={height - 6} textAnchor={k === 0 ? "start" : k === 2 ? "end" : "middle"} className="fill-ink-3 text-[11px]">
              {formatShort(days[i])}
            </text>
          ))}
          {/* Today */}
          <line x1={x(todayIndex)} x2={x(todayIndex)} y1={m.top} y2={m.top + plotH} stroke="var(--axis)" strokeDasharray="2 3" />
          <text x={x(todayIndex)} y={m.top - 16} textAnchor={todayIndex > totalDays * 0.85 ? "end" : "middle"} className="fill-ink-3 text-[10px] font-bold">
            Today
          </text>
          {plan && <path d={planLine} fill="none" stroke="var(--series-muted)" strokeWidth="1.75" strokeDasharray="5 4" strokeLinecap="round" />}
          <path d={savedLine} fill="none" stroke="var(--series-1)" strokeWidth="3" strokeLinejoin="miter" strokeLinecap="square" className="glow-line" />
          {/* The goal itself, at the end of the plan */}
          <Marker x={x(totalDays)} y={y(target)} fill="var(--sheet)" stroke="var(--series-1)" />
          <text x={x(totalDays) - 8} y={y(target) - 9} textAnchor="end" className="tabular fill-ink-2 text-[11px] font-bold">
            Goal {dollarsCompact(target)}
          </text>
          {active !== null && <line x1={x(shown)} x2={x(shown)} y1={m.top} y2={m.top + plotH} stroke="var(--axis)" />}
          {shown <= todayIndex && <Marker x={x(shown)} y={y(savedAt(days[shown]))} />}
          {plan && active !== null && <Marker x={x(shown)} y={y(planAt(shown))} size={8} fill="var(--series-muted)" />}
        </svg>
      )}
      {active !== null && width > 0 && (
        <Tooltip x={x(active)} width={width}>
          <p className="text-micro text-ink-3">{formatMedium(days[active])}</p>
          {active <= todayIndex && (
            <p className="mt-1 flex justify-between gap-4 text-small">
              <span className="text-ink-2">Saved</span>
              <span className="tabular font-semibold">{dollars(savedAt(days[active]))}</span>
            </p>
          )}
          {plan && (
            <p className="flex justify-between gap-4 text-small">
              <span className="text-ink-2">Plan</span>
              <span className="tabular">{dollars(planAt(active))}</span>
            </p>
          )}
        </Tooltip>
      )}
      <div className="absolute inset-x-0 bottom-0 flex flex-wrap gap-x-4 pl-[46px]">
        <LegendKey color="var(--series-1)" label="Saved" />
        {plan && <LegendKey color="var(--series-muted)" label="Plan" dashed />}
      </div>
    </div>
  );
}
