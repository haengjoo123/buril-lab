import {
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
} from "react";
import { ClipboardPaste, Copy, Redo2, Undo2 } from "lucide-react";
import {
  useText,
  useToolData,
  Panel,
  Select,
  ErrorMessage,
  download,
  csv,
  ColorField,
  NumberField,
  StoredNumberField,
  ToolContext,
  calculate,
  format,
  need,
  report,
  useExportName,
  useUndo,
} from "./ui";
import { parseNumber } from "./format";
import { ScaleLegend } from "./charts";
import {
  applyChange,
  applyToWells,
  calibrationRows,
  clearWells,
  commonFields,
  compactNumber,
  concentrationScale,
  diffWells,
  dilutionSeries,
  fieldKeys,
  invertChange,
  lineWells,
  moveCell,
  numberedSamples,
  patchWells,
  plateShape,
  rangeWells,
  readFields,
  rowLetter,
  sortWells,
  toggleWells,
  wellName,
  wellNames,
  wellPosition,
  wellRoles,
  type Cell,
  type ConcentrationScale,
  type FieldKey,
  type FillDirection,
  type WellChange,
  type WellFields,
  type WellRole,
  type Wells,
} from "./plate";

type View = "color" | "concentration";
/** Short role marks printed in a well. The same in every language; the key beside the plate spells them out. */
const roleCodes: Record<WellRole, string> = {
  standard: "STD",
  sample: "SMP",
  blank: "BLK",
};
const historyLimit = 100;
const emptyFill = "#f1f5f9";
/**
 * The light one-hue ramp of charts.css (--chart-seq-0 … 6). Exported files are
 * always on white, so they do not follow the dark screen's reversed ramp.
 */
const heatFills = [
  "#cde2fb",
  "#9ec5f4",
  "#6da7ec",
  "#3987e5",
  "#256abf",
  "#184f95",
  "#0d366b",
];
function wellTextColor(color: string) {
  const rgb = /^#[0-9a-f]{6}$/i.test(color) ? color.slice(1).match(/../g)!.map((v) => parseInt(v, 16) / 255) : [1, 1, 1];
  const [r, g, b] = rgb.map((v) => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.179 ? "#000000" : "#ffffff";
}
/** Fill and text colour of a well in an exported picture. */
function paint(fields: WellFields | null, view: View, scale: ConcentrationScale | null) {
  if (view === "concentration") {
    const step = scale?.step(fields?.concentration) ?? null;
    return step == null
      ? { fill: emptyFill, ink: "#475569" }
      : { fill: heatFills[step], ink: step >= 3 ? "#ffffff" : "#0b0b0b" };
  }
  return fields
    ? { fill: fields.color, ink: wellTextColor(fields.color) }
    : { fill: emptyFill, ink: "#475569" };
}
/** Rough width of a character in a picture: a Korean or other wide character is a full square. */
const advance = (char: string, size: number) => (/[\u1100-\uffdc]/.test(char) ? size : size * 0.6);
/** The start of `text` that fits a width, and what is left of it. */
function fitStart(text: string, width: number, size: number): [string, string] {
  let used = 0,
    end = 0;
  for (const char of text) {
    if (used + advance(char, size) > width) break;
    used += advance(char, size);
    end += char.length;
  }
  return [text.slice(0, end), text.slice(end)];
}
/** Cuts text to a width and marks the cut. */
function clip(text: string, width: number, size: number) {
  const [whole, rest] = fitStart(text, width, size);
  return rest ? `${fitStart(text, width - size * 0.6, size)[0].trimEnd()}…` : whole;
}
type Diagram = {
  rows: number;
  cols: number;
  fields: Record<string, WellFields | null>;
  view: View;
  scale: ConcentrationScale | null;
  /** The roles in use, for the key under the plate. */
  roles: { role: WellRole; label: string }[];
  /** The ends and title of the concentration scale, when it is shown. */
  scaleText: { title: string; min: string; max: string } | null;
};
/**
 * The plate as a picture for the PDF: every well with its name, role mark,
 * sample and concentration, and under it the key to the role marks and either
 * the colours in use or the concentration scale.
 */
function plateDiagram({ rows, cols, fields, view, scale, roles, scaleText }: Diagram) {
  const namespace = "http://www.w3.org/2000/svg";
  const node = (tag: string, attributes: Record<string, string | number>, text?: string) => {
    const element = document.createElementNS(namespace, tag);
    for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, String(value));
    if (text != null) element.textContent = text;
    return element;
  };
  const cell = Math.max(34, Math.min(110, Math.floor(720 / cols))),
    large = cell >= 56,
    width = Math.max(760, cols * cell + 44),
    x0 = 30 + (width - 44 - cols * cell) / 2,
    y0 = 28,
    // Text grows with the wells of a small plate, up to half as large again.
    grow = large ? Math.min(1.5, cell / 60) : 1,
    ink = "#172238";
  const svg = node("svg", { "font-family": "Arial, sans-serif" }) as SVGSVGElement,
    background = node("rect", { x: 0, y: 0, width, fill: "#ffffff" });
  svg.append(background);
  // The role is also in the line around a well, for wells too small to print its mark.
  const stroke = (role: WellRole | ""): Record<string, string | number> =>
    role === "standard"
      ? { stroke: ink, "stroke-width": 2.5 }
      : role === "sample"
      ? { stroke: ink, "stroke-width": 1.2 }
      : role === "blank"
      ? { stroke: ink, "stroke-width": 1.5, "stroke-dasharray": "4 3" }
      : { stroke: "#94a3b8", "stroke-width": 1 };
  for (let col = 0; col < cols; col++)
    svg.append(node("text", { x: x0 + col * cell + cell / 2, y: y0 - 9, "text-anchor": "middle", "font-size": 11, "font-weight": 700, fill: "#475569" }, String(col + 1)));
  for (let row = 0; row < rows; row++) {
    const cy = y0 + row * cell + cell / 2;
    svg.append(node("text", { x: x0 - 13, y: cy + 4, "text-anchor": "middle", "font-size": 11, "font-weight": 700, fill: "#475569" }, rowLetter(row)));
    for (let col = 0; col < cols; col++) {
      const name = wellName(row, col),
        well = fields[name],
        cx = x0 + col * cell + cell / 2,
        colors = paint(well, view, scale),
        amount = well?.concentration != null ? compactNumber(well.concentration) : "",
        line = (text: string, dy: number, size: number, weight = 400) =>
          svg.append(node("text", { x: cx, y: cy + dy, "text-anchor": "middle", "font-size": size, "font-weight": weight, fill: colors.ink }, text));
      svg.append(node("circle", { cx, cy, r: cell / 2 - 3, fill: colors.fill, ...stroke(well?.role ?? "") }));
      const sample = well?.sample.trim() ?? "";
      if (!large) {
        // Room for the name and one value: the one the view is about.
        const main = view === "concentration" ? amount : clip(sample, cell - 8, 7.5);
        line(name, -3, 7);
        if (main) line(main, 7, 7.5, 700);
        continue;
      }
      const size = 10.5 * grow,
        middle = 3 * grow,
        lower = cell * 0.24;
      line(well?.role ? `${name} ${roleCodes[well.role]}` : name, -cell * 0.2, 8.5 * grow);
      // A name with no number under it may run onto the second line, broken at a space when it has one.
      const twoLines = (text: string, textSize: number, weight: number) => {
        let [first, rest] = fitStart(text, cell - 12, textSize);
        const space = first.lastIndexOf(" ");
        if (rest && space > 0) [first, rest] = [first.slice(0, space), first.slice(space + 1) + rest];
        if (first) line(first.trimEnd(), middle, textSize, weight);
        if (rest.trim()) line(clip(rest.trim(), cell - 16, textSize), lower, textSize, weight);
      };
      // The bold line is what the view is about; the other value goes under it.
      if (!amount) twoLines(sample, view === "concentration" ? 9.5 * grow : size, view === "concentration" ? 400 : 700);
      else if (view === "concentration") {
        line(amount, middle, size, 700);
        if (sample) line(clip(sample, cell - 16, 9 * grow), lower, 9 * grow);
      } else {
        if (sample) line(clip(sample, cell - 12, size), middle, size, 700);
        line(amount, lower, 9 * grow);
      }
    }
  }
  let y = y0 + rows * cell + 24;
  if (roles.length) {
    roles.forEach(({ role, label }, index) => {
      const x = 30 + index * 190;
      svg.append(node("circle", { cx: x + 8, cy: y, r: 8, fill: "#ffffff", ...stroke(role) }));
      svg.append(node("text", { x: x + 24, y: y + 4, "font-size": 11, fill: ink }, `${roleCodes[role]} ${label}`));
    });
    y += 28;
  }
  if (view === "concentration" && scaleText) {
    svg.append(node("text", { x: 30, y: y + 4, "font-size": 11, "font-weight": 700, fill: ink }, scaleText.title));
    heatFills.forEach((fill, step) =>
      svg.append(node("rect", { x: 30 + step * 36, y: y + 12, width: 34, height: 12, rx: 2, fill }))
    );
    svg.append(node("text", { x: 30, y: y + 38, "font-size": 10, fill: ink }, scaleText.min));
    svg.append(node("text", { x: 30 + 7 * 36 - 2, y: y + 38, "text-anchor": "end", "font-size": 10, fill: ink }, scaleText.max));
    y += 48;
  } else if (view === "color") {
    // Which samples each colour stands for, in the order they appear on the plate.
    const colors = new Map<string, Set<string>>();
    for (const name of wellNames(rows, cols)) {
      const well = fields[name];
      if (!well) continue;
      const samples = colors.get(well.color) ?? new Set<string>();
      if (well.sample.trim()) samples.add(well.sample.trim());
      colors.set(well.color, samples);
    }
    const entries = [...colors].slice(0, 12),
      column = (width - 60) / 3;
    entries.forEach(([color, samples], index) => {
      const x = 30 + (index % 3) * column,
        top = y + Math.floor(index / 3) * 20;
      svg.append(node("rect", { x, y: top - 9, width: 12, height: 12, rx: 2, fill: color, stroke: "#94a3b8", "stroke-width": 0.75 }));
      svg.append(node("text", { x: x + 18, y: top + 1, "font-size": 10, fill: ink }, clip([...samples].join(", ") || "—", column - 30, 10)));
    });
    y += Math.ceil(entries.length / 3) * 20;
    if (colors.size > entries.length) {
      svg.append(node("text", { x: 30, y: y + 1, "font-size": 10, fill: "#475569" }, `+${colors.size - entries.length}`));
      y += 20;
    }
  }
  const height = Math.ceil(y + 6);
  background.setAttribute("height", String(height));
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  return svg;
}
function TextField({ label, value, onChange, placeholder }: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="tool-field">
      <span>{label}</span>
      <input type="text" value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}
const wellOf = (target: EventTarget | null) =>
  target instanceof Element ? target.closest("[data-well]")?.getAttribute("data-well") ?? null : null;

export default function PlateTool() {
  const t = useText(),
    ctx = useContext(ToolContext),
    exportName = useExportName(),
    unitListId = useId();
  const [d, set] = useToolData({
    size: "96",
    wells: {} as Wells,
    // Added with well roles: the unit every well's concentration is in.
    concentrationUnit: "",
  });
  const wells: Wells = d.wells && typeof d.wells === "object" ? d.wells : {},
    unit = typeof d.concentrationUnit === "string" ? d.concentrationUnit.trim() : "";
  const [picked, setSelected] = useState<string[]>([]);
  const [multi, setMulti] = useState(false);
  // The cell the arrow keys move from, and the corner a range is stretched from.
  const [cursor, setCursor] = useState<Cell>({ row: 0, col: 0 });
  const [anchor, setAnchor] = useState<string | null>(null);
  // The fields changed in the editor and not applied yet. Only these are written.
  const [edits, setEdits] = useState<Partial<WellFields>>({});
  const [copied, setCopied] = useState<WellFields | null>(null);
  const [view, setView] = useState<View>("color");
  // Undo history is this screen's state, not part of the saved document.
  const [history, setHistory] = useState<{ past: WellChange[]; future: WellChange[] }>({ past: [], future: [] });
  const [fill, setFill] = useState({
    direction: "row" as FillDirection,
    start: "",
    factor: "2",
    prefix: "S",
    first: "1",
    replicates: "1",
  });
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [undoBar, offerUndo] = useUndo();
  const rootRef = useRef<HTMLDivElement>(null),
    gridRef = useRef<HTMLDivElement>(null),
    editorRef = useRef<HTMLDivElement>(null),
    drag = useRef<{ anchor: string; base: string[]; additive: boolean; last: string } | null>(null),
    // True when the pointer handlers dealt with the latest press, so the click it ends in is not a second pick.
    handledPress = useRef(false);

  const { rows, cols } = plateShape(d.size),
    names = wellNames(rows, cols),
    onPlate = new Set(names),
    // A size that changed on another device can leave picked wells off the plate.
    selected = picked.filter((name) => onPlate.has(name));
  const fields: Record<string, WellFields | null> = Object.fromEntries(
    names.map((name) => [name, wells[name] ? readFields(wells[name]) : null])
  );
  const used = names.filter((name) => fields[name]);
  // Labels on wells outside the current size are kept, not shown: switching to
  // a smaller plate and back must not lose them. Say so, because the list and
  // the exports below leave them out.
  const hidden = Object.keys(wells).filter((name) => !onPlate.has(name)).length;
  const scale = concentrationScale(
    used.flatMap((name) => {
      const value = fields[name]?.concentration;
      return value == null ? [] : [value];
    })
  );
  const rolesUsed = wellRoles.filter((role) => used.some((name) => fields[name]?.role === role));
  const chosen = new Set(selected),
    common = commonFields(wells, selected),
    shown: WellFields = { ...common.values, ...edits },
    pending = fieldKeys.filter((key) => key in edits),
    // A field the selected wells disagree on and the user has not set: it has no single value to show.
    undecided = (key: FieldKey) => common.mixed.includes(key) && !(key in edits);
  const withUnit = (text: string) => (unit ? `${text} ${unit}` : text);
  const roleName = (role: WellRole) =>
    role === "standard" ? t("표준", "Standard") : role === "sample" ? t("시료", "Sample") : t("블랭크", "Blank");
  const fieldName: Record<FieldKey, string> = {
    sample: t("시료", "Sample"),
    condition: t("조건", "Condition"),
    replicate: t("반복", "Replicate"),
    role: t("역할", "Role"),
    concentration: t("농도", "Concentration"),
    color: t("색상", "Color"),
  };
  const concentrationLabel = unit ? `${fieldName.concentration} (${unit})` : fieldName.concentration;
  const describe = (name: string) => {
    const well = fields[name];
    return well
      ? [name, well.sample, well.condition, well.replicate, well.role && roleName(well.role), well.concentration != null && withUnit(format(well.concentration))]
          .filter(Boolean)
          .join(" · ")
      : name;
  };
  const scaleText = scale && {
    // The unit is on the values at both ends, so the title only names the scale.
    title: `${fieldName.concentration}${scale.log ? " (log)" : ""}`,
    min: `${scale.belowMin ? "≤ " : ""}${withUnit(format(scale.min))}`,
    max: withUnit(format(scale.max)),
  };

  const select = (next: string[]) => {
    setSelected(next);
    setEdits({});
    setMessage("");
  };
  /** Writes a change to the wells and records it for undo. Returns the record, or null when nothing changed. */
  const commit = (change: (current: Wells) => Wells) => {
    const diff = diffWells(wells, change(wells));
    if (!Object.keys(diff).length) return null;
    set((current) => ({ ...current, wells: applyChange(current.wells, diff, "after") }));
    setHistory((current) => ({ past: [...current.past, diff].slice(-historyLimit), future: [] }));
    return diff;
  };
  const undo = () => {
    const change = history.past[history.past.length - 1];
    if (!change) return;
    set((current) => ({ ...current, wells: applyChange(current.wells, change, "before") }));
    setHistory({ past: history.past.slice(0, -1), future: [...history.future, change] });
    setMessage(t("마지막 변경을 취소했습니다.", "Undid the last change."));
  };
  const redo = () => {
    const change = history.future[history.future.length - 1];
    if (!change) return;
    set((current) => ({ ...current, wells: applyChange(current.wells, change, "after") }));
    setHistory({ past: [...history.past, change], future: history.future.slice(0, -1) });
    setMessage(t("취소한 변경을 다시 적용했습니다.", "Redid the change."));
  };
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      const key = event.key.toLowerCase();
      if (key !== "z" && key !== "y") return;
      const target = event.target instanceof Element ? event.target : null;
      // A text field keeps its own undo, and so does the rest of the app.
      if (target?.closest("input, textarea, select, [contenteditable]")) return;
      if (target && target !== document.body && target !== document.documentElement && !rootRef.current?.contains(target)) return;
      event.preventDefault();
      if (key === "y" || event.shiftKey) redo();
      else undo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  /** Stretches the selection from the anchor (or, without one, from `origin`) to `name`, on top of `base`. */
  const extend = (name: string, base: readonly string[], origin = name) => {
    const from = anchor && onPlate.has(anchor) ? anchor : origin;
    setAnchor(from);
    select(sortWells([...base, ...rangeWells(from, name)]));
  };
  const pointerDown = (event: PointerEvent<HTMLDivElement>) => {
    handledPress.current = false;
    const name = wellOf(event.target);
    // Only the main button, and only the first finger of several.
    if (!name || event.button !== 0 || event.isPrimary === false) return;
    // A finger dragged over the plate scrolls it unless multi-select is on.
    // The tap itself then arrives as a click.
    if (event.pointerType === "touch" && !multi) return;
    handledPress.current = true;
    const end = () => {
      drag.current = null;
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
    };
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
    const additive = multi || event.ctrlKey || event.metaKey;
    setCursor(wellPosition(name) ?? cursor);
    if (event.shiftKey) {
      extend(name, additive ? selected : []);
      return;
    }
    drag.current = { anchor: name, base: additive ? selected : [], additive, last: name };
    setAnchor(name);
    select(additive ? toggleWells(selected, [name]) : [name]);
  };
  const pointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const state = drag.current;
    if (!state) return;
    // The button was let go where no event reached this window.
    if (!event.buttons) {
      drag.current = null;
      return;
    }
    // A touch keeps reporting the well it started on, so look under the pointer.
    const under = typeof document.elementFromPoint === "function" ? document.elementFromPoint(event.clientX, event.clientY) : event.target;
    const name = under instanceof Node && gridRef.current?.contains(under) ? wellOf(under) : null;
    if (!name || name === state.last) return;
    state.last = name;
    const range = rangeWells(state.anchor, name);
    setCursor(wellPosition(name) ?? cursor);
    select(state.additive ? sortWells([...state.base, ...range]) : range);
  };
  const click = (event: MouseEvent<HTMLDivElement>) => {
    const name = wellOf(event.target);
    if (!name) return;
    // A click made with a pointer (it counts presses in `detail`) follows a
    // press. When that press was handled above, the pick is already made.
    if (event.detail > 0 && handledPress.current) {
      handledPress.current = false;
      return;
    }
    // A tap on a touch screen, or a click from assistive technology.
    setCursor(wellPosition(name) ?? cursor);
    if (event.shiftKey) extend(name, multi ? selected : []);
    else {
      setAnchor(name);
      select(multi || event.ctrlKey || event.metaKey ? toggleWells(selected, [name]) : [name]);
    }
  };
  const pickLine = (axis: "row" | "column", index: number, event: MouseEvent) => {
    const line = lineWells(axis, index, rows, cols);
    // With multi-select already on, lines add up (and a selected line comes off again).
    select(multi || event.ctrlKey || event.metaKey ? toggleWells(selected, line) : line);
    setMulti(true);
    setAnchor(line[0]);
    setCursor(axis === "row" ? { row: index, col: -1 } : { row: -1, col: index });
  };
  const keyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const at = event.target instanceof Element ? event.target.closest("[data-cell]")?.getAttribute("data-cell") : null;
    if (!at) return;
    const [row, col] = at.split(",").map(Number),
      name = row >= 0 && col >= 0 ? wellName(row, col) : null;
    if (name && (event.key === "Enter" || event.key === " ")) {
      event.preventDefault();
      setCursor({ row, col });
      setAnchor(name);
      select(toggleWells(selected, [name]));
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a") {
      event.preventDefault();
      select(names);
      return;
    }
    const next = moveCell({ row, col }, event.key, rows, cols, event.ctrlKey || event.metaKey);
    if (!next) return;
    event.preventDefault();
    setCursor(next);
    gridRef.current?.querySelector<HTMLElement>(`[data-cell="${next.row},${next.col}"]`)?.focus();
    const target = next.row >= 0 && next.col >= 0 ? wellName(next.row, next.col) : null;
    if (!target) return;
    if (event.shiftKey && name) extend(target, [], name);
    // Without Shift the keys only move; the next range starts from here.
    else setAnchor(target);
  };
  const keyUp = (event: KeyboardEvent<HTMLDivElement>) => {
    // Space already toggled the well when it went down; some browsers would click it again on release.
    if (event.key === " " && wellOf(event.target)) event.preventDefault();
  };
  const active = cursor.row < rows && cursor.col < cols ? cursor : { row: 0, col: 0 };
  const tabIndex = (row: number, col: number) => (active.row === row && active.col === col ? 0 : -1);

  const edit = <K extends FieldKey>(key: K, value: WellFields[K]) =>
    setEdits((current) => ({ ...current, [key]: value } as Partial<WellFields>));
  const wellCount = (count: number) => t(`${count}개 웰`, `${count} ${count === 1 ? "well" : "wells"}`);
  // A concentration below zero is not applied; the editor says so beside the field.
  const negative = edits.concentration != null && edits.concentration < 0;
  const apply = () => {
    if (!selected.length || !pending.length || negative) return;
    commit((current) => applyToWells(current, selected, edits));
    setEdits({});
    const list = pending.map((key) => fieldName[key]).join(", ");
    setMessage(t(`${wellCount(selected.length)}에 적용했습니다: ${list}`, `Applied to ${wellCount(selected.length)}: ${list}`));
  };
  const clear = () => {
    const change = commit((current) => clearWells(current, selected));
    if (!change) return;
    setEdits({});
    setMessage("");
    const count = Object.keys(change).length;
    offerUndo(t(`${wellCount(count)}을 비웠습니다.`, `Cleared ${wellCount(count)}.`), () => {
      set((current) => ({ ...current, wells: applyChange(current.wells, change, "before") }));
      // Still the latest change: this is an undo. Otherwise putting the wells back is a change of its own.
      setHistory((current) =>
        current.past[current.past.length - 1] === change
          ? { past: current.past.slice(0, -1), future: [...current.future, change] }
          : { past: [...current.past, invertChange(change)].slice(-historyLimit), future: [] }
      );
    });
  };
  const series = calculate(() => dilutionSeries(selected, need(fill.start), need(fill.factor), fill.direction)),
    levels = series.value ? [...new Set(Object.values(series.value))].sort((a, b) => b - a) : [];
  const numbers = calculate(() =>
      numberedSamples(selected, { prefix: fill.prefix, first: need(fill.first), replicates: need(fill.replicates), direction: fill.direction })
    ),
    numbered = numbers.value ? [...new Set(Object.values(numbers.value).map((well) => well.sample))] : [],
    perSample = parseNumber(fill.replicates) ?? 1;
  const fillConcentrations = () => {
    const values = series.value;
    if (!values) return;
    commit((current) =>
      patchWells(current, Object.fromEntries(Object.entries(values).map(([name, concentration]) => [name, { concentration }])))
    );
    setMessage(t(`${wellCount(selected.length)}에 농도를 채웠습니다.`, `Filled concentrations in ${wellCount(selected.length)}.`));
  };
  const fillNumbers = () => {
    const values = numbers.value;
    if (!values) return;
    commit((current) => patchWells(current, values));
    setMessage(t(`${wellCount(selected.length)}에 시료 번호를 채웠습니다.`, `Filled sample numbers in ${wellCount(selected.length)}.`));
  };

  const listHeaders = [t("웰", "Well"), fieldName.sample, fieldName.condition, fieldName.replicate, fieldName.role, concentrationLabel];
  const listRows = () =>
    used.map((name) => {
      const well = fields[name]!;
      return [name, well.sample, well.condition, well.replicate, well.role ? roleName(well.role) : "", well.concentration ?? ""];
    });
  const exportImage = async () => {
    try {
      const canvas = document.createElement("canvas");
      canvas.width = cols * 100 + 80;
      canvas.height = rows * 90 + 80;
      const c = canvas.getContext("2d")!;
      c.fillStyle = "white";
      c.fillRect(0, 0, canvas.width, canvas.height);
      c.fillStyle = "#475569";
      c.font = "bold 16px sans-serif";
      c.textAlign = "center";
      for (let col = 0; col < cols; col++) c.fillText(String(col + 1), 80 + col * 100, 28);
      for (let row = 0; row < rows; row++) c.fillText(rowLetter(row), 25, 85 + row * 90);
      names.forEach((name, i) => {
        const w = fields[name],
          x = 80 + (i % cols) * 100,
          y = 80 + Math.floor(i / cols) * 90,
          colors = paint(w, view, scale),
          amount = w?.concentration != null ? withUnit(compactNumber(w.concentration)) : "";
        c.fillStyle = colors.fill;
        c.beginPath();
        c.arc(x, y, 35, 0, 2 * Math.PI);
        c.fill();
        c.fillStyle = colors.ink;
        c.textAlign = "center";
        c.font = "13px sans-serif";
        c.fillText(w?.role ? `${name} ${roleCodes[w.role]}` : name, x, y - 6);
        c.fillText(w?.sample ?? "", x, y + 12, 64);
        c.font = "10px sans-serif";
        c.fillText(
          [w?.condition, amount, w?.replicate].filter(Boolean).join(" · "),
          x,
          y + 26,
          60
        );
      });
      const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r));
      if (!blob) throw Error("Could not create the image");
      await download(blob, exportName("png"), "image/png");
      setError("");
    } catch (e) {
      setError(String(e));
    }
  };
  const exportPdf = async () => {
    try {
      const roles = rolesUsed.map((role) => ({ role, label: roleName(role) }));
      await report({
        title: ctx && !ctx.draft ? `${t("플레이트 배치도", "Plate layout")} · ${ctx.doc.title}` : t("플레이트 배치도", "Plate layout"),
        lines: [
          t(`${d.size}-well 플레이트 · 사용 웰 ${used.length}개`, `${d.size}-well plate · ${used.length} ${used.length === 1 ? "well" : "wells"} in use`),
          ...(roles.length ? [`${t("역할 표시", "Role marks")}: ${roles.map(({ role, label }) => `${roleCodes[role]} = ${label}`).join(", ")}`] : []),
          ...(unit ? [`${t("농도 단위", "Concentration unit")}: ${unit}`] : []),
          ...(view === "concentration" && scaleText ? [`${t("색 농담", "Shading")}: ${scaleText.title}, ${scaleText.min} – ${scaleText.max}`] : []),
        ],
        svg: plateDiagram({ rows, cols, fields, view, scale, roles, scaleText }),
        headers: listHeaders,
        rows: listRows(),
        name: exportName("pdf"),
      });
      setError("");
    } catch (e) {
      setError(String(e));
    }
  };
  const tableRows = calibrationRows(wells, names);

  return (
    <div ref={rootRef} className="tool-plate-x">
      <Panel>
        <div className="plate-controls">
          <Select label={t("플레이트 크기", "Plate size")} value={d.size}
            onChange={(size) => {
              set((current) => ({ ...current, size }));
              select([]);
              setAnchor(null);
              setCursor({ row: 0, col: 0 });
            }}
            options={["6", "12", "24", "48", "96", "384"]} />
          <label className="tool-field tool-plate-x-unit">
            <span>{t("농도 단위", "Concentration unit")}</span>
            <input type="text" list={unitListId} maxLength={16} autoComplete="off" value={typeof d.concentrationUnit === "string" ? d.concentrationUnit : ""}
              placeholder={t("예: µM", "e.g. µM")}
              onChange={(event) => { const concentrationUnit = event.target.value; set((current) => ({ ...current, concentrationUnit })); }} />
            <datalist id={unitListId}>
              {["nM", "µM", "mM", "M", "ng/mL", "µg/mL", "mg/mL", "ng/µL", "%", "×"].map((option) => <option key={option} value={option} />)}
            </datalist>
          </label>
          <button type="button" role="switch" aria-checked={multi} onClick={() => setMulti(!multi)}>
            {t("다중 선택", "Multi-select")} · {multi ? t("켜짐", "On") : t("꺼짐", "Off")}
          </button>
          <div className="tool-plate-x-seg" role="group" aria-label={t("웰 표시", "Well display")}>
            <button type="button" aria-pressed={view === "color"} onClick={() => setView("color")}>{t("색 보기", "Colors")}</button>
            <button type="button" aria-pressed={view === "concentration"} onClick={() => setView("concentration")}>{t("농도 보기", "Concentrations")}</button>
          </div>
        </div>
        {hidden > 0 && (
          <p className="tool-muted" role="status">
            {t(
              `이 크기에 없는 웰 ${hidden}개의 내용은 보관 중이며, 목록과 CSV·PNG·PDF에는 포함되지 않습니다. 더 큰 플레이트를 선택하면 다시 나타납니다.`,
              `${hidden} labelled ${hidden === 1 ? "well is" : "wells are"} outside this plate size. They are kept but left out of the list, CSV, PNG and PDF, and reappear on a larger plate.`
            )}
          </p>
        )}
        <div className="tool-actions">
          <button type="button" onClick={() => { setMulti(true); select(names); }}>{t("전체 선택", "Select all")}</button>
          <button type="button" disabled={!selected.length} onClick={() => select([])}>{t("선택 해제", "Clear selection")}</button>
          <span className="tool-muted" role="status">{selected.length} {t("개 선택", "selected")}</span>
          <span className="tool-plate-x-history">
            <button type="button" disabled={!history.past.length} title="Ctrl+Z" aria-keyshortcuts="Control+Z Meta+Z" onClick={undo}>
              <Undo2 size={16} aria-hidden="true" />{t("실행 취소", "Undo")}
            </button>
            <button type="button" disabled={!history.future.length} title="Ctrl+Shift+Z" aria-keyshortcuts="Control+Shift+Z Meta+Shift+Z Control+Y" onClick={redo}>
              <Redo2 size={16} aria-hidden="true" />{t("다시 실행", "Redo")}
            </button>
          </span>
        </div>
        <p className="tool-muted">
          {t(
            "끌거나 Shift+클릭하면 범위가 선택되고, 행·열 머리글을 누르면 한 줄이 선택됩니다. 키보드에서는 방향키로 옮기고 Shift+방향키로 범위를 넓히며 Enter나 Space로 선택합니다. 터치 화면에서는 다중 선택을 켜면 끌어서 범위를 선택하고, 끄면 끌 때 플레이트가 움직입니다.",
            "Drag or Shift+click to select a range; a row or column header selects its line. On a keyboard, the arrow keys move, Shift+arrow extends the range, and Enter or Space selects. On a touch screen, dragging selects a range while Multi-select is on and scrolls the plate while it is off."
          )}
        </p>
        <div className="plate-scroll">
          <div ref={gridRef} role="grid" aria-multiselectable="true" aria-label={t("플레이트 배치", "Plate layout")}
            aria-rowcount={rows + 1} aria-colcount={cols + 1}
            className="tool-plate plate-labelled tool-plate-x-grid" data-multi={multi ? "" : undefined}
            style={{ "--tool-plate-x-cols": cols, minWidth: cols * 50 + 40, maxWidth: cols * 78 + 40, marginInline: "auto" } as CSSProperties}
            onPointerDown={pointerDown} onPointerMove={pointerMove} onClick={click} onKeyDown={keyDown} onKeyUp={keyUp}>
            <div role="row" className="tool-plate-x-row">
              <span role="presentation" />
              {Array.from({ length: cols }, (_, col) => (
                <div role="columnheader" className="tool-plate-x-head" key={col}>
                  <button type="button" className="plate-axis" data-cell={`-1,${col}`} tabIndex={tabIndex(-1, col)}
                    aria-label={t(`${col + 1}열 선택`, `Select column ${col + 1}`)}
                    onClick={(event) => pickLine("column", col, event)}>{col + 1}</button>
                </div>
              ))}
            </div>
            {Array.from({ length: rows }, (_, row) => (
              <div role="row" className="tool-plate-x-row" key={row}>
                <div role="rowheader" className="tool-plate-x-head">
                  <button type="button" className="plate-axis" data-cell={`${row},-1`} tabIndex={tabIndex(row, -1)}
                    aria-label={t(`${rowLetter(row)}행 선택`, `Select row ${rowLetter(row)}`)}
                    onClick={(event) => pickLine("row", row, event)}>{rowLetter(row)}</button>
                </div>
                {Array.from({ length: cols }, (_, col) => {
                  const name = wellName(row, col),
                    well = fields[name],
                    step = view === "concentration" ? scale?.step(well?.concentration) ?? null : null,
                    label = describe(name);
                  return (
                    <button type="button" role="gridcell" key={name} data-well={name} data-cell={`${row},${col}`}
                      data-role={well?.role || undefined} aria-selected={chosen.has(name)} tabIndex={tabIndex(row, col)}
                      aria-label={label} title={label}
                      className={step == null ? "tool-plate-x-well" : `tool-plate-x-well tool-chart-heat-${step}`}
                      style={view === "color" && well
                        ? { background: well.color, color: wellTextColor(well.color) }
                        : step == null
                        ? { background: "var(--tool-well-bg,#f1f5f9)", color: "var(--tool-fg,#0f172a)" }
                        : undefined}>
                      <span className="plate-well-id">{name}</span>
                      <span className="plate-well-label">
                        {view === "color" ? well?.sample || "—" : well?.concentration != null ? compactNumber(well.concentration) : ""}
                      </span>
                      {well?.role && <span className="tool-plate-x-code" aria-hidden="true">{roleCodes[well.role]}</span>}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
        {rolesUsed.length > 0 && (
          <p className="tool-muted tool-plate-x-key">
            {rolesUsed.map((role) => `${roleCodes[role]} ${roleName(role)}`).join(" · ")}
          </p>
        )}
        {view === "concentration" && (scaleText
          ? <div className="tool-plate-x-scale"><ScaleLegend title={scaleText.title} min={scaleText.min} max={scaleText.max} /></div>
          : <p className="tool-muted tool-plate-x-key">{t("농도를 넣은 웰이 없습니다. 웰을 선택해 농도를 적용하거나 연속 채우기를 쓰세요.", "No well has a concentration yet. Select wells and apply one, or fill a series.")}</p>)}
      </Panel>
      <div ref={editorRef} tabIndex={-1} className="plate-editor">
      <Panel>
        <div className="plate-editor-heading">
          <h2>{selected.length === 1 ? selected[0] : t("선택한 웰 편집", "Edit selected wells")}</h2>
          {selected.length > 0 && (
            <div className="plate-editor-clipboard">
              <button type="button" aria-label={t("내용 복사", "Copy content")} title={t("내용 복사", "Copy content")} disabled={selected.length !== 1} onClick={() => { setCopied({ ...shown }); setMessage(t("편집 중인 웰 내용을 복사했습니다.", "Copied the current well draft.")); }}><Copy size={18} aria-hidden="true" /></button>
              <button type="button" aria-label={t("붙여넣기", "Paste")} title={t("붙여넣기", "Paste")} disabled={!copied} onClick={() => { if (copied) { setEdits({ ...copied }); setMessage(t("붙여넣었습니다. 적용 버튼을 눌러 저장하세요.", "Pasted. Apply to save.")); } }}><ClipboardPaste size={18} aria-hidden="true" /></button>
            </div>
          )}
        </div>
        {!selected.length ? <p className="tool-muted">{t("위 플레이트에서 편집할 웰을 선택하세요.", "Select a well on the plate above to edit.")}</p> : <>
          {selected.length > 1 && <p className="plate-selection">{selected.join(", ")}</p>}
          {common.mixed.some(undecided) && (
            <p className="tool-muted tool-plate-x-note">
              {t("선택한 웰마다 값이 다른 항목", "These differ between the selected wells")}: {common.mixed.filter(undecided).map((key) => fieldName[key]).join(", ")}
            </p>
          )}
          <div className="plate-editor-fields">
            <TextField label={fieldName.sample} value={shown.sample} placeholder={undecided("sample") ? t("여러 값", "Mixed") : undefined} onChange={(sample) => edit("sample", sample)} />
            <TextField label={fieldName.condition} value={shown.condition} placeholder={undecided("condition") ? t("여러 값", "Mixed") : undefined} onChange={(condition) => edit("condition", condition)} />
            <TextField label={fieldName.replicate} value={shown.replicate} placeholder={undecided("replicate") ? t("여러 값", "Mixed") : undefined} onChange={(replicate) => edit("replicate", replicate)} />
            <fieldset className="tool-plate-x-fieldset">
              <legend>{fieldName.role}</legend>
              <div className="tool-plate-x-seg">
                {(["", ...wellRoles] as const).map((role) => (
                  <button type="button" key={role || "none"} aria-pressed={!undecided("role") && shown.role === role} onClick={() => edit("role", role)}>
                    {role ? roleName(role) : t("없음", "None")}
                  </button>
                ))}
              </div>
            </fieldset>
            <div className="tool-plate-x-conc">
              <StoredNumberField key={`${selected.length}:${selected[0]}:${selected[selected.length - 1]}`}
                label={concentrationLabel} value={shown.concentration} onChange={(concentration) => edit("concentration", concentration)} />
            </div>
            <ColorField label={fieldName.color} value={undecided("color") ? "#ffffff" : shown.color} onChange={(color) => edit("color", color)} />
          </div>
          <ErrorMessage message={negative ? "Enter non-negative values" : ""} />
          <fieldset className="tool-plate-x-fieldset tool-plate-x-apply">
            <legend>{t("적용할 항목", "Fields to apply")}</legend>
            <div className="tool-plate-x-seg">
              {fieldKeys.map((key) => (
                <button type="button" key={key} aria-pressed={key in edits}
                  onClick={() => setEdits((current) => {
                    if (!(key in current)) return { ...current, [key]: common.values[key] } as Partial<WellFields>;
                    const next = { ...current };
                    delete next[key];
                    return next;
                  })}>
                  {fieldName[key]}
                </button>
              ))}
            </div>
            <p className="tool-muted">
              {t(
                "고친 항목이 자동으로 켜집니다. 켜진 항목만 선택한 웰에 적용되고, 나머지 항목은 웰마다 그대로 남습니다.",
                "A field you change is switched on. Only the fields that are on are applied to the selected wells; the others stay as they are in each well."
              )}
            </p>
          </fieldset>
          <div className="tool-actions">
            <button type="button" className="primary" disabled={!pending.length || negative} onClick={apply}>{t("선택 웰에 적용", "Apply to selected wells")}</button>
            <button type="button" disabled={!selected.some((name) => wells[name])} onClick={clear}>{t("선택 웰 비우기", "Clear selected wells")}</button>
          </div>
          <details className="tool-plate-x-fill">
            <summary>{t("연속 채우기", "Fill a series")}</summary>
            <fieldset className="tool-plate-x-fieldset">
              <legend>{t("채우는 방향", "Fill direction")}</legend>
              <div className="tool-plate-x-seg">
                <button type="button" aria-pressed={fill.direction === "row"} onClick={() => setFill({ ...fill, direction: "row" })}>{t("행 방향 →", "Along rows →")}</button>
                <button type="button" aria-pressed={fill.direction === "column"} onClick={() => setFill({ ...fill, direction: "column" })}>{t("열 방향 ↓", "Down columns ↓")}</button>
              </div>
            </fieldset>
            <div className="tool-plate-x-fill-grid">
              <section>
                <h3>{t("희석 계열", "Dilution series")}</h3>
                <NumberField label={unit ? `${t("시작 농도", "Starting concentration")} (${unit})` : t("시작 농도", "Starting concentration")} value={fill.start} onChange={(start) => setFill({ ...fill, start })} />
                <NumberField label={t("희석배수", "Dilution factor")} value={fill.factor} onChange={(factor) => setFill({ ...fill, factor })} />
                <p className="tool-muted">
                  {fill.direction === "row"
                    ? t("선택한 범위의 왼쪽 열이 시작 농도이고, 오른쪽으로 한 열마다 배수만큼 묽어집니다. 행마다 같은 계열이 들어갑니다.", "The left-most selected column holds the starting concentration and each column to the right is diluted by the factor. Every row gets the same series.")
                    : t("선택한 범위의 위쪽 행이 시작 농도이고, 아래로 한 행마다 배수만큼 묽어집니다. 열마다 같은 계열이 들어갑니다.", "The top selected row holds the starting concentration and each row below is diluted by the factor. Every column gets the same series.")}
                </p>
                {levels.length > 0 && (
                  <p className="tool-plate-x-preview">
                    {t(`${levels.length}단계`, `${levels.length} ${levels.length === 1 ? "step" : "steps"}`)}: {withUnit(format(levels[0]))} → {withUnit(format(levels[levels.length - 1]))}
                  </p>
                )}
                <ErrorMessage message={series.error} />
                <button type="button" disabled={!levels.length} onClick={fillConcentrations}>{t("농도 채우기", "Fill concentrations")}</button>
              </section>
              <section>
                <h3>{t("반복 번호", "Sample numbers")}</h3>
                <TextField label={t("접두어", "Prefix")} value={fill.prefix} onChange={(prefix) => setFill({ ...fill, prefix })} />
                <NumberField label={t("시작 번호", "First number")} value={fill.first} onChange={(first) => setFill({ ...fill, first })} />
                <NumberField label={t("시료당 반복 수", "Replicates per sample")} value={fill.replicates} onChange={(replicates) => setFill({ ...fill, replicates })} />
                <p className="tool-muted">
                  {fill.direction === "row"
                    ? t("왼쪽에서 오른쪽으로, 위 행부터 번호를 매깁니다. 반복은 옆으로 나란히 놓입니다.", "Wells are numbered left to right, row by row. Replicates sit side by side.")
                    : t("위에서 아래로, 왼쪽 열부터 번호를 매깁니다. 반복은 아래로 나란히 놓입니다.", "Wells are numbered top to bottom, column by column. Replicates sit one below another.")}
                </p>
                {numbered.length > 0 && (
                  <p className="tool-plate-x-preview">
                    {t(`시료 ${numbered.length}개`, `${numbered.length} ${numbered.length === 1 ? "sample" : "samples"}`)}: {numbered.length === 1 ? numbered[0] : `${numbered[0]} – ${numbered[numbered.length - 1]}`}
                    {selected.length % perSample > 0 &&
                      ` · ${t("선택한 웰 수가 반복 수로 나누어지지 않아 마지막 시료는 반복이 모자랍니다.", "The selection does not divide by the replicate count, so the last sample has fewer replicates.")}`}
                  </p>
                )}
                <ErrorMessage message={numbers.error} />
                <button type="button" disabled={!numbered.length} onClick={fillNumbers}>{t("번호 채우기", "Fill numbers")}</button>
              </section>
            </div>
          </details>
        </>}
        {undoBar && <div className="tool-plate-x-undo">{undoBar}</div>}
        <p className="plate-editor-status" role="status">{message}</p>
      </Panel>
      </div>
      <Panel title={t("웰 목록", "Well list")}>
        {used.length ? <div className="tool-table-wrap"><table>
          <thead><tr>{listHeaders.map((header) => <th key={header}>{header}</th>)}</tr></thead>
          <tbody>{used.map((name) => {
            const well = fields[name]!;
            return <tr key={name} className={chosen.has(name) ? "plate-selected-row" : undefined}>
              <td><button type="button" className="plate-list-well" aria-label={t(`${name} 편집`, `Edit ${name}`)} aria-pressed={chosen.has(name)} onClick={() => { setMulti(false); setAnchor(name); setCursor(wellPosition(name) ?? cursor); select([name]); editorRef.current?.scrollIntoView({ block: "start" }); editorRef.current?.focus({ preventScroll: true }); }}><span className="plate-color-dot" style={{ background: well.color }} />{name}</button></td>
              <td>{well.sample || "—"}</td><td>{well.condition || "—"}</td><td>{well.replicate || "—"}</td>
              <td>{well.role ? roleName(well.role) : "—"}</td><td>{well.concentration != null ? format(well.concentration) : "—"}</td>
            </tr>;
          })}</tbody>
        </table></div> : <p className="tool-muted">{t("웰에 내용을 적용하면 이곳에 표시됩니다.", "Apply labels to wells to see them here.")}</p>}
      </Panel>
      <ErrorMessage message={error} />
      <div className="tool-actions">
        <button
          type="button"
          onClick={() =>
            download(
              csv([
                [...listHeaders, fieldName.color],
                ...names.map((name) => {
                  const well = fields[name];
                  return [
                    name,
                    well?.sample ?? "",
                    well?.condition ?? "",
                    well?.replicate ?? "",
                    well?.role ? roleName(well.role) : "",
                    well?.concentration ?? "",
                    well?.color ?? "",
                  ];
                }),
              ]),
              exportName("csv"),
              "text/csv"
            )
          }
        >
          CSV
        </button>
        <button type="button" onClick={exportImage}>PNG</button>
        <button type="button" onClick={exportPdf}>PDF</button>
      </div>
      {ctx?.sendTo && (
        <div className="tool-actions">
          <button type="button" disabled={!used.length}
            onClick={() => ctx.sendTo?.("master-mix", { kind: "count", value: used.length, unit: "", label: t("사용 웰 수", "Wells in use"), source: "plate-labelling" })}>
            {t("마스터 믹스로 웰 수 보내기", "Send well count to Master Mix")}
          </button>
          <button type="button" disabled={!tableRows.length}
            onClick={() => ctx.sendTo?.("calibration-curve", { kind: "table", value: tableRows.length, unit, label: t("플레이트 표준·시료", "Plate standards and samples"), source: "plate-labelling", rows: tableRows })}>
            {t("검량선으로 표준·시료 보내기", "Send standards and samples to Calibration")}
          </button>
        </div>
      )}
    </div>
  );
}
