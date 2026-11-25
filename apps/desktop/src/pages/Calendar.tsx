import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ChevronLeft, ChevronRight, Minus, Plus } from "lucide-react";
import { addDays, DEFAULT_TIMELINE_KINDS, getSetting, setSetting, timelineEvents, TIMELINE_KINDS, type TimelineEvent, type TimelineKind } from "@ppm/core";
import { useSession } from "../app/session";
import { Tabs } from "../components/ui";
import { IconButton, PageHeader } from "../components/visual";
import { moduleDef, type ModuleId } from "../lib/modules";
import { routeFor } from "../lib/routes";
import { formatDate } from "../lib/format";

const KIND = Object.fromEntries(TIMELINE_KINDS.map((k) => [k.id, k])) as Record<TimelineKind, (typeof TIMELINE_KINDS)[number]>;
const color = (k: TimelineKind) => `var(${moduleDef(KIND[k].module as ModuleId).token})`;
const MONTHS = ["januar", "februar", "marts", "april", "maj", "juni", "juli", "august", "september", "oktober", "november", "december"];
const MONTHS_SHORT = ["jan", "feb", "mar", "apr", "maj", "jun", "jul", "aug", "sep", "okt", "nov", "dec"];
const WEEKDAYS = ["man", "tir", "ons", "tor", "fre", "lør", "søn"];
const DAY = 86_400_000;

const toMs = (d: string) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10));
const toIso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
function isoWeek(ms: number): number {
  const d = new Date(ms);
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day + 3);
  const firstThursday = Date.UTC(d.getUTCFullYear(), 0, 4);
  return 1 + Math.round((d.getTime() - firstThursday) / DAY / 7 - ((new Date(firstThursday).getUTCDay() + 6) % 7 - 3) / 7);
}
const dateLabel = (e: TimelineEvent) => (e.end && e.end !== e.start ? `${formatDate(e.start)} – ${formatDate(e.end)}` : formatDate(e.start));
const statusText = (e: TimelineEvent) => (e.status === "overdue" ? "Forfalden" : e.status === "done" ? "Udført" : "");

/** Which kinds are shown; remembered per user in the archive. */
function useKinds() {
  const session = useSession();
  const qc = useQueryClient();
  const key = `calendar.kinds:${session.user.id}`;
  const q = useQuery({ queryKey: ["setting", key], queryFn: async () => (await getSetting<TimelineKind[]>(session.archive.db, key)) ?? DEFAULT_TIMELINE_KINDS });
  const save = useMutation({
    mutationFn: (kinds: TimelineKind[]) => setSetting(session.ctx(), key, kinds),
    onMutate: (kinds) => qc.setQueryData(["setting", key], kinds),
  });
  const kinds = q.data ?? DEFAULT_TIMELINE_KINDS;
  const toggle = (k: TimelineKind) => {
    const next = kinds.includes(k) ? kinds.filter((x) => x !== k) : [...kinds, k];
    if (session.archive.readOnly) qc.setQueryData(["setting", key], next);
    else save.mutate(next);
  };
  return { kinds, toggle };
}

function useEvents(from: string, to: string, kinds: TimelineKind[]) {
  const session = useSession();
  const today = session.env.clock.today();
  return useQuery({
    queryKey: ["calendar", from, to, [...kinds].sort().join(","), session.user.id, today],
    queryFn: () => timelineEvents(session.archive.db, { from, to, kinds, today, userId: session.user.id }),
    placeholderData: (prev) => prev,
  });
}

function KindChips({ kinds, toggle }: { kinds: TimelineKind[]; toggle(k: TimelineKind): void }) {
  return (
    <div className="kind-chips" role="group" aria-label="Vis på kalender og tidslinje">
      {TIMELINE_KINDS.map((k) => (
        <button key={k.id} className="kind-chip" aria-pressed={kinds.includes(k.id)} onClick={() => toggle(k.id)} style={{ ["--kc" as string]: color(k.id) } as CSSProperties}>
          <span className="dot" aria-hidden="true" />
          {k.label}
        </button>
      ))}
    </div>
  );
}

export function Calendar() {
  const [params, setParams] = useSearchParams();
  const { kinds, toggle } = useKinds();
  return (
    <section>
      <PageHeader module="calendar" />
      <KindChips kinds={kinds} toggle={toggle} />
      <Tabs
        active={params.get("visning") ?? "month"}
        onChange={(id) => setParams({ visning: id })}
        tabs={[
          { id: "month", label: "Månedsvisning", content: () => <MonthView kinds={kinds} /> },
          { id: "timeline", label: "Tidslinje", content: () => <TimelineView kinds={kinds} /> },
        ]}
      />
    </section>
  );
}

// ---------------------------------------------------------------- Month

function MonthView({ kinds }: { kinds: TimelineKind[] }) {
  const session = useSession();
  const navigate = useNavigate();
  const today = session.env.clock.today();
  const [month, setMonth] = useState(today.slice(0, 7));
  const [selected, setSelected] = useState<string>(today);
  const first = `${month}-01`;
  const gridStart = toIso(toMs(first) - ((new Date(toMs(first)).getUTCDay() + 6) % 7) * DAY);
  const days = Array.from({ length: 42 }, (_, i) => toIso(toMs(gridStart) + i * DAY));
  const q = useEvents(days[0]!, days[41]!, kinds);
  const byDay = useMemo(() => {
    const m = new Map<string, TimelineEvent[]>();
    const add = (d: string, e: TimelineEvent) => m.set(d, [...(m.get(d) ?? []), e]);
    for (const e of q.data ?? []) {
      // Periods are shown on their first and last day, so long loans do not fill every day.
      add(e.start, e);
      if (e.end && e.end !== e.start && !e.ongoing) add(e.end, e);
    }
    return m;
  }, [q.data]);
  const shift = (n: number) => {
    const [y, mo] = month.split("-").map(Number) as [number, number];
    const d = new Date(Date.UTC(y, mo - 1 + n, 1));
    setMonth(toIso(d.getTime()).slice(0, 7));
  };
  const selectedEvents = byDay.get(selected) ?? [];
  const onCellKey = (e: KeyboardEvent, d: string) => {
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
    if (step) {
      e.preventDefault();
      const next = addDays(d, step);
      setSelected(next);
      if (next.slice(0, 7) !== month) setMonth(next.slice(0, 7));
      requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-day="${next}"]`)?.focus());
    }
  };
  return (
    <div className="month-layout">
      <div>
        <div className="month-head">
          <IconButton icon={ChevronLeft} label="Forrige måned" onClick={() => shift(-1)} />
          <h2 aria-live="polite">
            {MONTHS[+month.slice(5, 7) - 1]} {month.slice(0, 4)}
          </h2>
          <IconButton icon={ChevronRight} label="Næste måned" onClick={() => shift(1)} />
          <button
            onClick={() => {
              setMonth(today.slice(0, 7));
              setSelected(today);
            }}
          >
            I dag
          </button>
        </div>
        <div className="month-grid" role="grid" aria-label={`${MONTHS[+month.slice(5, 7) - 1]} ${month.slice(0, 4)}`}>
          <div className="mg-week mg-headcell" aria-hidden="true">
            uge
          </div>
          {WEEKDAYS.map((w) => (
            <div key={w} className="mg-headcell" role="columnheader">
              {w}
            </div>
          ))}
          {days.map((d, i) => {
            const evs = byDay.get(d) ?? [];
            const other = d.slice(0, 7) !== month;
            return [
              i % 7 === 0 && (
                <div key={`w${d}`} className="mg-week" aria-hidden="true">
                  {isoWeek(toMs(d))}
                </div>
              ),
              <div
                key={d}
                data-day={d}
                role="gridcell"
                tabIndex={d === selected ? 0 : -1}
                aria-selected={d === selected}
                aria-label={`${formatDate(d)}${evs.length ? `, ${evs.length} ${evs.length === 1 ? "begivenhed" : "begivenheder"}` : ""}`}
                className={`mg-day${other ? " other" : ""}${d === today ? " today" : ""}${d === selected ? " selected" : ""}`}
                onClick={() => setSelected(d)}
                onKeyDown={(e) => onCellKey(e, d)}
              >
                <span className="mg-num">{+d.slice(8, 10)}</span>
                <div className="mg-events">
                  {evs.slice(0, 3).map((e) => (
                    <span key={e.id + d} className={`mg-ev ${e.status ?? ""}`} style={{ ["--kc" as string]: color(e.kind) } as CSSProperties} title={`${e.title} · ${dateLabel(e)}`}>
                      {e.end && e.end !== e.start && d === e.end ? "Slut: " : ""}
                      {e.title}
                    </span>
                  ))}
                  {evs.length > 3 && <span className="mg-more">+{evs.length - 3} flere</span>}
                </div>
              </div>,
            ];
          })}
        </div>
      </div>
      <aside className="panel day-panel" aria-label={`Begivenheder ${formatDate(selected)}`}>
        <h3>{formatDate(selected)}</h3>
        {selectedEvents.length === 0 && <p className="small muted">Ingen begivenheder.</p>}
        <ul className="plain">
          {selectedEvents.map((e) => (
            <li key={e.id}>
              <button className="day-ev" onClick={() => navigate(routeFor(e.ref.type, e.ref.id, e.start))} style={{ ["--kc" as string]: color(e.kind) } as CSSProperties}>
                <span className="dot" aria-hidden="true" />
                <span>
                  <strong>{e.title}</strong>
                  <span className="small muted">
                    {" "}
                    {KIND[e.kind].label} · {dateLabel(e)}
                    {e.detail ? ` · ${e.detail}` : ""}
                    {statusText(e) ? ` · ${statusText(e)}` : ""}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </aside>
    </div>
  );
}

// ---------------------------------------------------------------- Timeline

const PRESETS: { id: string; label: string; days: number }[] = [
  { id: "w", label: "Uge", days: 14 },
  { id: "m", label: "Måned", days: 45 },
  { id: "q", label: "Kvartal", days: 120 },
  { id: "y", label: "År", days: 400 },
  { id: "5y", label: "5 år", days: 365 * 5 + 60 },
];
const LANE_LABEL_W = 196;
const ROW_H = 26;
const LANE_PAD = 10;
const AXIS_H = 58;
const MIN_SPAN = 7 * DAY;
const MAX_SPAN = 30 * 365 * DAY;

interface Placed {
  e: TimelineEvent;
  x1: number;
  x2: number;
  row: number;
  /** Where the label goes: inside a wide bar, after the mark, or hidden when there is no room. */
  label: "inside" | "after" | null;
  labelX: number;
}

const labelWidth = (t: string) => Math.min(250, Math.min(t.length, 34) * 6.7 + 10);

/**
 * Greedy packing into rows per lane, so marks do not overlap. Labels go inside wide bars, otherwise
 * after the mark; a label that another mark would cover is hidden (the tooltip and list still show it).
 */
function pack(events: TimelineEvent[], x: (ms: number) => number, left: number, maxRows = 6): { placed: Placed[]; rows: number } {
  const ends: number[] = [];
  const placed: Placed[] = [];
  for (const e of events) {
    const x1 = x(toMs(e.start));
    const x2 = e.end && e.end !== e.start ? Math.max(x(toMs(e.end) + DAY), x1 + 8) : x1;
    const w = labelWidth(e.title);
    const visibleStart = Math.max(x1, left + 10);
    const inside = x2 > x1 && x2 - visibleStart > w + 14;
    const labelX = inside ? visibleStart + 9 : (x2 > x1 ? x2 : x1) + 11;
    const right = inside ? x2 : labelX + w;
    let row = ends.findIndex((end) => end < x1 - 6);
    if (row < 0) row = ends.length < maxRows ? ends.length : ends.indexOf(Math.min(...ends));
    const fits = ends[row] === undefined || ends[row]! < x1 - 6;
    ends[row] = fits ? right : Math.max(ends[row]!, x2 + 10);
    placed.push({ e, x1, x2, row, label: fits ? (inside ? "inside" : "after") : null, labelX });
  }
  // Hide labels that a later mark in the same row would cover.
  for (const p of placed) {
    if (p.label !== "after") continue;
    const end = p.labelX + labelWidth(p.e.title);
    if (placed.some((q) => q !== p && q.row === p.row && q.x1 > p.x1 && q.x1 - 8 < end)) p.label = null;
  }
  return { placed, rows: Math.max(1, ends.length) };
}

type Unit = "day" | "week" | "month" | "quarter" | "year";
function ticks(start: number, end: number, pxPerDay: number): { major: { ms: number; label: string }[]; minor: { ms: number; label: string }[]; unit: Unit } {
  const unit: Unit = pxPerDay >= 26 ? "day" : pxPerDay >= 5 ? "week" : pxPerDay >= 1.1 ? "month" : pxPerDay >= 0.35 ? "quarter" : "year";
  const minor: { ms: number; label: string }[] = [];
  const major: { ms: number; label: string }[] = [];
  const s = new Date(start);
  if (unit === "day" || unit === "week") {
    let d = Date.UTC(s.getUTCFullYear(), s.getUTCMonth(), s.getUTCDate());
    if (unit === "week") d -= ((new Date(d).getUTCDay() + 6) % 7) * DAY;
    for (; d <= end; d += unit === "day" ? DAY : 7 * DAY) {
      const dd = new Date(d);
      minor.push({ ms: d, label: unit === "day" ? `${dd.getUTCDate()}` : `uge ${isoWeek(d)}` });
    }
    for (let m = Date.UTC(s.getUTCFullYear(), s.getUTCMonth(), 1); m <= end; m = Date.UTC(new Date(m).getUTCFullYear(), new Date(m).getUTCMonth() + 1, 1)) {
      const dm = new Date(m);
      major.push({ ms: m, label: `${MONTHS[dm.getUTCMonth()]} ${dm.getUTCFullYear()}` });
    }
  } else {
    const step = unit === "month" ? 1 : unit === "quarter" ? 3 : 12;
    let m = Date.UTC(s.getUTCFullYear(), unit === "year" ? 0 : Math.floor(s.getUTCMonth() / step) * step, 1);
    for (; m <= end; m = Date.UTC(new Date(m).getUTCFullYear(), new Date(m).getUTCMonth() + step, 1)) {
      const dm = new Date(m);
      minor.push({ ms: m, label: unit === "year" ? `${dm.getUTCFullYear()}` : unit === "quarter" ? `K${dm.getUTCMonth() / 3 + 1}` : MONTHS_SHORT[dm.getUTCMonth()]! });
    }
    if (unit !== "year")
      for (let y = Date.UTC(s.getUTCFullYear(), 0, 1); y <= end; y = Date.UTC(new Date(y).getUTCFullYear() + 1, 0, 1)) major.push({ ms: y, label: `${new Date(y).getUTCFullYear()}` });
  }
  return { major, minor, unit };
}

function TimelineView({ kinds }: { kinds: TimelineKind[] }) {
  const session = useSession();
  const navigate = useNavigate();
  const today = session.env.clock.today();
  const todayMs = toMs(today);
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(900);
  const [view, setView] = useState<[number, number]>([todayMs - 120 * DAY, todayMs + 245 * DAY]);
  const [hover, setHover] = useState<{ e: TimelineEvent; x: number; y: number } | null>(null);
  const [asList, setAsList] = useState(false);
  const anim = useRef<number | null>(null);

  useEffect(() => {
    const el = wrap.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.max(480, Math.round(entry!.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Fetch a padded window rounded to months, so panning does not refetch on every pixel.
  const span = view[1] - view[0];
  const pad = span * 0.6;
  const monthFloor = (ms: number) => toIso(Date.UTC(new Date(ms).getUTCFullYear(), new Date(ms).getUTCMonth(), 1));
  const from = monthFloor(view[0] - pad);
  const to = toIso(Date.UTC(new Date(view[1] + pad).getUTCFullYear(), new Date(view[1] + pad).getUTCMonth() + 1, 0));
  const q = useEvents(from, to, kinds);

  const plotW = width - LANE_LABEL_W;
  const pxPerDay = plotW / (span / DAY);
  const x = (ms: number) => LANE_LABEL_W + ((ms - view[0]) / span) * plotW;
  const visible = (q.data ?? []).filter((e) => toMs(e.start) <= view[1] && toMs(e.end ?? e.start) + DAY >= view[0]);
  const lanes = kinds
    .filter((k) => TIMELINE_KINDS.some((t) => t.id === k))
    .sort((a, b) => TIMELINE_KINDS.findIndex((t) => t.id === a) - TIMELINE_KINDS.findIndex((t) => t.id === b))
    .map((k) => ({ kind: k, ...pack(visible.filter((e) => e.kind === k), x, LANE_LABEL_W) }));
  let y = AXIS_H;
  const laneY = lanes.map((l) => {
    const top = y;
    y += l.rows * ROW_H + LANE_PAD * 2;
    return top;
  });
  const height = Math.max(y + 8, AXIS_H + 60);
  const t = ticks(view[0], view[1], pxPerDay);

  const animateTo = (target: [number, number]) => {
    if (anim.current) cancelAnimationFrame(anim.current);
    const startView = view;
    const t0 = performance.now();
    const step = (now: number) => {
      const p = Math.min(1, (now - t0) / 260);
      const ease = 1 - Math.pow(1 - p, 3);
      setView([startView[0] + (target[0] - startView[0]) * ease, startView[1] + (target[1] - startView[1]) * ease]);
      if (p < 1) anim.current = requestAnimationFrame(step);
    };
    anim.current = requestAnimationFrame(step);
  };
  const clampSpan = (s: number) => Math.min(MAX_SPAN, Math.max(MIN_SPAN, s));
  const zoom = (factor: number, centerMs = (view[0] + view[1]) / 2, animate = true) => {
    const s = clampSpan(span * factor);
    const ratio = (centerMs - view[0]) / span;
    const next: [number, number] = [centerMs - s * ratio, centerMs + s * (1 - ratio)];
    if (animate) animateTo(next);
    else setView(next);
  };
  const preset = (days: number) => animateTo([todayMs - days * DAY * 0.3, todayMs + days * DAY * 0.7]);
  const pan = (fraction: number) => animateTo([view[0] + span * fraction, view[1] + span * fraction]);

  // Wheel: zoom around the pointer; shift+wheel or horizontal wheel pans.
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const onWheel = (ev: WheelEvent) => {
      ev.preventDefault();
      const rect = el.getBoundingClientRect();
      const px = ev.clientX - rect.left;
      if (ev.shiftKey || Math.abs(ev.deltaX) > Math.abs(ev.deltaY)) {
        const d = (ev.shiftKey ? ev.deltaY : ev.deltaX) / plotW;
        setView(([a, b]) => [a + (b - a) * d, b + (b - a) * d]);
      } else if (px > LANE_LABEL_W) {
        setView(([a, b]) => {
          const s = b - a;
          const c = a + ((px - LANE_LABEL_W) / plotW) * s;
          const ns = clampSpan(s * Math.exp(ev.deltaY * 0.0015));
          const r = (c - a) / s;
          return [c - ns * r, c + ns * (1 - r)];
        });
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [plotW]);

  // Drag to pan.
  const drag = useRef<{ x: number; view: [number, number] } | null>(null);
  const onDown = (ev: ReactPointerEvent<SVGSVGElement>) => {
    if ((ev.target as Element).closest(".tl-ev")) return;
    drag.current = { x: ev.clientX, view };
    (ev.currentTarget as Element).setPointerCapture(ev.pointerId);
  };
  const onMove = (ev: ReactPointerEvent<SVGSVGElement>) => {
    if (!drag.current) return;
    const dms = ((ev.clientX - drag.current.x) / plotW) * (drag.current.view[1] - drag.current.view[0]);
    setView([drag.current.view[0] - dms, drag.current.view[1] - dms]);
  };
  const onUp = () => {
    drag.current = null;
  };
  const onKey = (ev: KeyboardEvent) => {
    if (ev.key === "+" || ev.key === "=") zoom(0.6);
    else if (ev.key === "-") zoom(1 / 0.6);
    else if (ev.key === "ArrowLeft" && ev.target === ev.currentTarget) pan(-0.25);
    else if (ev.key === "ArrowRight" && ev.target === ev.currentTarget) pan(0.25);
  };
  const open = (e: TimelineEvent) => navigate(routeFor(e.ref.type, e.ref.id, e.start));
  const activePreset = PRESETS.reduce((best, p) => (Math.abs(p.days * DAY - span) < Math.abs(best.days * DAY - span) ? p : best), PRESETS[0]!);

  return (
    <div className="timeline">
      <div className="tl-toolbar">
        <div className="segmented" role="group" aria-label="Tidsrum">
          {PRESETS.map((p) => (
            <button key={p.id} aria-pressed={Math.abs(p.days * DAY - span) / span < 0.15 && p.id === activePreset.id} onClick={() => preset(p.days)}>
              {p.label}
            </button>
          ))}
        </div>
        <div className="row">
          <IconButton icon={ChevronLeft} label="Tilbage i tid" onClick={() => pan(-0.4)} />
          <IconButton icon={Minus} label="Zoom ud" onClick={() => zoom(1 / 0.6)} />
          <IconButton icon={Plus} label="Zoom ind" onClick={() => zoom(0.6)} />
          <IconButton icon={ChevronRight} label="Frem i tid" onClick={() => pan(0.4)} />
          <button onClick={() => animateTo([todayMs - span * 0.3, todayMs + span * 0.7])}>I dag</button>
        </div>
        <span className="small muted tl-range" aria-live="polite">
          {formatDate(toIso(view[0]))} – {formatDate(toIso(view[1]))}
        </span>
      </div>
      <div
        ref={wrap}
        className="tl-wrap"
        tabIndex={0}
        role="region"
        aria-label="Tidslinje. Rul eller brug plus og minus for at zoome, træk eller brug piletasterne for at flytte."
        onKeyDown={onKey}
      >
        <svg width={width} height={height} className="tl-svg" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} role="presentation">
          <defs>
            <linearGradient id="tl-fade" x1="0" x2="1">
              <stop offset="0" stopColor="var(--surface)" stopOpacity="1" />
              <stop offset="1" stopColor="var(--surface)" stopOpacity="0" />
            </linearGradient>
          </defs>
          {lanes.map((l, i) => (
            <rect key={l.kind} x={0} y={laneY[i]} width={width} height={l.rows * ROW_H + LANE_PAD * 2} className={i % 2 ? "tl-lane alt" : "tl-lane"} />
          ))}
          {t.minor.map((m) => (
            <line key={`g${m.ms}`} x1={x(m.ms)} x2={x(m.ms)} y1={AXIS_H - 6} y2={height} className="tl-grid" />
          ))}
          {t.major.map((m) => (
            <line key={`G${m.ms}`} x1={x(m.ms)} x2={x(m.ms)} y1={4} y2={height} className="tl-grid major" />
          ))}
          <g className="tl-axis" aria-hidden="true">
            {t.major.map((m) => (
              <text key={`M${m.ms}`} x={Math.max(LANE_LABEL_W + 22, x(m.ms) + 6)} y={18} className="major">
                {m.label}
              </text>
            ))}
            {t.minor.map((m) =>
              pxPerDay * (t.unit === "day" ? 1 : t.unit === "week" ? 7 : t.unit === "month" ? 30 : t.unit === "quarter" ? 91 : 365) > 22 ? (
                <text key={`m${m.ms}`} x={x(m.ms) + 4} y={35}>
                  {m.label}
                </text>
              ) : null,
            )}
          </g>
          {todayMs >= view[0] && todayMs <= view[1] && (
            <g className="tl-today" aria-hidden="true">
              <line x1={x(todayMs + DAY / 2)} x2={x(todayMs + DAY / 2)} y1={AXIS_H - 2} y2={height} />
              <rect x={x(todayMs + DAY / 2) - 20} y={AXIS_H - 15} width={40} height={16} rx={8} />
              <text x={x(todayMs + DAY / 2)} y={AXIS_H - 3.5} textAnchor="middle">
                I dag
              </text>
            </g>
          )}
          {lanes.map((l, i) =>
            l.placed.map((p) => {
              const cy = laneY[i]! + LANE_PAD + p.row * ROW_H + ROW_H / 2;
              const isRange = p.x2 > p.x1;
              const label = `${p.e.title}, ${dateLabel(p.e)}${statusText(p.e) ? `, ${statusText(p.e).toLowerCase()}` : ""}`;
              return (
                <g
                  key={p.e.id}
                  className={`tl-ev ${p.e.status ?? ""}`}
                  style={{ ["--kc" as string]: color(p.e.kind) } as CSSProperties}
                  tabIndex={0}
                  role="button"
                  aria-label={label}
                  onClick={() => open(p.e)}
                  onKeyDown={(ev) => {
                    if (ev.key === "Enter" || ev.key === " ") {
                      ev.preventDefault();
                      open(p.e);
                    }
                  }}
                  onPointerEnter={() => setHover({ e: p.e, x: p.x1, y: cy })}
                  onPointerLeave={() => setHover(null)}
                  onFocus={() => setHover({ e: p.e, x: p.x1, y: cy })}
                  onBlur={() => setHover(null)}
                >
                  {isRange ? (
                    <rect className="tl-bar" x={p.x1} y={cy - 7} width={p.x2 - p.x1} height={14} rx={7} />
                  ) : (
                    <circle className="tl-dot" cx={p.x1} cy={cy} r={6} />
                  )}
                  {isRange && p.e.ongoing && <circle className="tl-ongoing" cx={p.x2} cy={cy} r={3} />}
                  {p.label && (
                    <text className={`tl-label${p.label === "inside" ? " inside" : ""}`} x={p.labelX} y={cy + 4}>
                      {p.e.title.length > 34 ? `${p.e.title.slice(0, 33)}…` : p.e.title}
                    </text>
                  )}
                </g>
              );
            }),
          )}
          <rect x={0} y={0} width={LANE_LABEL_W} height={height} className="tl-labelbg" />
          <rect x={LANE_LABEL_W} y={0} width={18} height={height} fill="url(#tl-fade)" />
          {lanes.map((l, i) => (
            <g key={`L${l.kind}`} className="tl-lane-label">
              <circle cx={16} cy={laneY[i]! + LANE_PAD + ROW_H / 2} r={5} style={{ fill: color(l.kind) }} />
              <text x={28} y={laneY[i]! + LANE_PAD + ROW_H / 2 + 4}>
                {KIND[l.kind].label.length > 24 ? `${KIND[l.kind].label.slice(0, 23)}…` : KIND[l.kind].label}
              </text>
              <text x={28} y={laneY[i]! + LANE_PAD + ROW_H / 2 + 19} className="count">
                {l.placed.length} i visningen
              </text>
            </g>
          ))}
        </svg>
        {hover && (
          <div className="tl-tip" style={{ left: Math.min(width - 260, Math.max(LANE_LABEL_W, hover.x - 20)), top: hover.y + 14 }} role="status">
            <div className="tl-tip-kind" style={{ ["--kc" as string]: color(hover.e.kind) } as CSSProperties}>
              <span className="dot" aria-hidden="true" /> {KIND[hover.e.kind].label}
            </div>
            <strong>{hover.e.title}</strong>
            <div className="small">{dateLabel(hover.e)}</div>
            {(hover.e.detail || statusText(hover.e)) && <div className="small muted">{[hover.e.detail, statusText(hover.e)].filter(Boolean).join(" · ")}</div>}
          </div>
        )}
        {lanes.length === 0 && <p className="tl-empty muted">Vælg mindst én type ovenfor.</p>}
      </div>
      <div className="row tl-foot">
        <span className="small muted">Rul for at zoome omkring markøren, træk for at flytte. Klik på en begivenhed for at åbne den.</span>
        <button className="link" onClick={() => setAsList(!asList)} aria-expanded={asList}>
          {asList ? "Skjul liste" : `Vis som liste (${visible.length})`}
        </button>
      </div>
      {asList && (
        <ul className="plain tl-list">
          {visible.map((e) => (
            <li key={e.id}>
              <button className="day-ev" onClick={() => open(e)} style={{ ["--kc" as string]: color(e.kind) } as CSSProperties}>
                <span className="dot" aria-hidden="true" />
                <span>
                  <strong>{e.title}</strong>
                  <span className="small muted">
                    {" "}
                    {KIND[e.kind].label} · {dateLabel(e)}
                    {statusText(e) ? ` · ${statusText(e)}` : ""}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
