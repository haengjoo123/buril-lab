import {
  useContext,
  useEffect,
  useRef,
  useState,
  type PointerEvent,
} from "react";
import {
  ToolContext,
  useText,
  useToolData,
  Panel,
  Field,
  Select,
  ErrorMessage,
  format,
  plainNumber,
  csv,
  download,
  report,
  ColorField,
  StoredNumberField,
  useExportName,
} from "./ui";
import {
  distance,
  measure,
  ladderPositions,
  colorCoverage,
  summarize,
  type Shape,
  type View,
  type XY,
} from "./geometry";
import { readGel, roundEstimate, splitRegion, type GelBand } from "./gel";
import { GelSizes, MeasureStats, type MeasureGroup } from "./imageParts";
type ImageData = {
  asset: string;
  width: number;
  height: number;
  unit: string;
  calibration: "reference" | "pixel";
  known: number;
  unitsPerPixel: number;
  reference: XY[];
  shapes: Shape[];
  rotation: number;
  flipX: boolean;
  flipY: boolean;
  crop: { x: number; y: number; width: number; height: number } | null;
  bar: number;
  tolerance: number;
  rgb: string;
  // The fields below were added later and are absent from older documents.
  /** Gel: the unit ladder band sizes are in ("bp", "kDa" …). */
  sizeUnit?: string;
  /** Gel: false hides the estimated sizes drawn beside the bands. */
  sizeLabels?: boolean;
};
type Drag = { start: XY; original: Shape | null; handle: number | null };
// A freehand outline and a group of counted points stop growing here, so one
// long session cannot swell the document without limit.
const MAX_POINTS = 2000;
const MAX_LANES = 60;
const DRAFT_COLOR = "#f97316";
const moved = (
  { original, handle, start }: Drag & { original: Shape },
  to: XY
): Shape => ({
  ...original,
  points: original.points.map((p, i) =>
    handle !== null
      ? i === handle
        ? to
        : p
      : { x: p.x + to.x - start.x, y: p.y + to.y - start.y }
  ),
});
/** The small arc between the arms of an angle, as an SVG path. */
function anglePath(points: XY[]) {
  const [first, vertex, last] = points;
  if (!first || !vertex || !last) return "";
  const armA = distance(first, vertex),
    armB = distance(last, vertex);
  if (!armA || !armB) return "";
  const r = Math.min(armA, armB) * 0.3,
    at = (end: XY, arm: number) =>
      `${vertex.x + ((end.x - vertex.x) / arm) * r},${
        vertex.y + ((end.y - vertex.y) / arm) * r
      }`,
    cross =
      (first.x - vertex.x) * (last.y - vertex.y) -
      (first.y - vertex.y) * (last.x - vertex.x);
  return `M${at(first, armA)} A${r},${r} 0 0 ${cross > 0 ? 1 : 0} ${at(
    last,
    armB
  )}`;
}
export default function ImageTool({ gel = false }: { gel?: boolean }) {
  const ctx = useContext(ToolContext)!,
    t = useText(),
    exportName = useExportName();
  const [d, set] = useToolData<ImageData>({
    asset: "",
    width: 1000,
    height: 700,
    unit: "mm",
    calibration: "reference",
    known: 0,
    unitsPerPixel: 0,
    reference: [
      { x: 100, y: 100 },
      { x: 300, y: 100 },
    ],
    shapes: [],
    rotation: 0,
    flipX: false,
    flipY: false,
    crop: null,
    bar: 0,
    tolerance: 20,
    rgb: "#008000",
  });
  const [url, setUrl] = useState(""),
    [error, setError] = useState(""),
    [tool, setTool] = useState("select"),
    [selected, setSelected] = useState(""),
    [draft, setDraft] = useState<XY[]>([]),
    [zoom, setZoom] = useState(1),
    [history, setHistory] = useState<ImageData[]>([]),
    [redo, setRedo] = useState<ImageData[]>([]),
    // The shape being moved or reshaped, so it follows the pointer.
    [moving, setMoving] = useState<(Drag & { original: Shape }) | null>(null),
    // Corners of an angle placed so far; the third one completes it.
    [corners, setCorners] = useState<XY[]>([]),
    [laneCount, setLaneCount] = useState<number | null>(10);
  const svgRef = useRef<SVGSVGElement>(null),
    groupRef = useRef<SVGGElement>(null),
    drag = useRef<Drag | null>(null),
    imageRef = useRef<HTMLImageElement | null>(null),
    // What the last history entry was for: typing in one field adds to that
    // entry instead of making a new one for every character.
    group = useRef("");
  useEffect(() => {
    let alive = true;
    if (!d.asset) return;
    ctx.repo
      .getImage(d.asset, true)
      .then((blob) => {
        const reader = new FileReader();
        reader.onload = () => {
          if (alive) setUrl(String(reader.result));
        };
        reader.readAsDataURL(blob);
      })
      .catch((e) => {
        if (alive) setError(String(e));
      });
    return () => {
      alive = false;
    };
  }, [d.asset, ctx.repo]);
  useEffect(() => {
    if (!d.asset) return;
    let alive = true,
      originalUrl = "";
    imageRef.current = null;
    void ctx.repo
      .getImage(d.asset)
      .then((blob) => {
        if (!alive) return;
        originalUrl = URL.createObjectURL(blob);
        const img = new Image();
        img.onload = () => {
          if (alive) imageRef.current = img;
        };
        img.src = originalUrl;
      })
      .catch((e) => {
        if (alive) setError(String(e));
      });
    return () => {
      alive = false;
      imageRef.current = null;
      if (originalUrl) URL.revokeObjectURL(originalUrl);
    };
  }, [d.asset, ctx.repo]);
  /**
   * Applies a change and records the state before it for undo. Consecutive
   * changes that give the same `entry` (typing a name, a length) share one
   * history entry until another action or leaving the field ends the run.
   */
  const commit = (next: ImageData, entry = "") => {
    if (!entry || entry !== group.current)
      setHistory((h) => [...h, d].slice(-50));
    group.current = entry;
    setRedo([]);
    set(next);
  };
  const undo = () => {
    if (!history.length) return;
    group.current = "";
    setRedo([...redo, d]);
    set(history[history.length - 1]);
    setHistory(history.slice(0, -1));
  };
  const redoStep = () => {
    if (!redo.length) return;
    group.current = "";
    setHistory([...history, d]);
    set(redo[redo.length - 1]);
    setRedo(redo.slice(0, -1));
  };
  const cancelDrawing = () => {
    drag.current = null;
    setMoving(null);
    setDraft([]);
    setCorners([]);
  };
  const pickTool = (next: string) => {
    cancelDrawing();
    setTool(next);
  };
  // Subscribed again after every render, so the handler always sees the
  // current document and history.
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA"].includes(target.tagName)) return;
      if (e.key === "Escape") {
        if (drag.current || corners.length) cancelDrawing();
        return;
      }
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const letter = e.key.toLowerCase();
      if (letter === "z" && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if (
        (letter === "z" && e.shiftKey) ||
        (letter === "y" && e.ctrlKey && !e.metaKey && !e.shiftKey)
      ) {
        e.preventDefault();
        redoStep();
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });
  const scale =
      d.calibration === "pixel"
        ? d.unitsPerPixel
        : d.known > 0 && d.reference.length === 2
        ? d.known / distance(d.reference[0], d.reference[1])
        : 0,
    unit = scale > 0 ? d.unit : "px",
    actualScale = scale > 0 ? scale : 1;
  // The matched share of the whole image as an area. The table, the PDF and
  // the CSV all use this one definition.
  const colorArea = (shape: Shape) =>
    (shape.areaFraction ?? shape.fraction ?? 0) *
    d.width *
    d.height *
    actualScale ** 2;
  const crop = d.crop ?? { x: 0, y: 0, width: d.width, height: d.height },
    sw = d.rotation % 180 ? crop.height : crop.width,
    sh = d.rotation % 180 ? crop.width : crop.height;
  const transform = `translate(${sw / 2} ${sh / 2}) rotate(${
    d.rotation
  }) scale(${d.flipX ? -1 : 1} ${d.flipY ? -1 : 1}) translate(${
    -crop.width / 2 - crop.x
  } ${-crop.height / 2 - crop.y})`;
  // The whole picture as displayed, for lanes that run left to right on screen.
  const fullView: View = {
    rotation: d.rotation,
    flipX: d.flipX,
    flipY: d.flipY,
    crop: { x: 0, y: 0, width: d.width, height: d.height },
  };
  const names: Record<string, string> = {
    select: t("선택", "Select"),
    scale: t("기준선", "Reference"),
    line: gel ? t("밴드", "Band") : t("선", "Line"),
    rectangle: gel ? t("레인", "Lane") : t("사각형", "Rectangle"),
    lanes: t("레인 나누기", "Split lanes"),
    ellipse: t("타원", "Ellipse"),
    freehand: t("자유형", "Freehand"),
    angle: t("각도", "Angle"),
    count: t("점 계수", "Count points"),
    color: t("색상", "Color"),
    text: t("텍스트", "Text"),
    crop: t("자르기", "Crop"),
  };
  const toolKeys = gel
    ? ["select", "line", "rectangle", "lanes", "text", "crop"]
    : [
        "select",
        "scale",
        "line",
        "rectangle",
        "ellipse",
        "freehand",
        "angle",
        "count",
        "color",
        "text",
        "crop",
      ];
  const nextName = (kind: string) =>
    `${names[kind] ?? kind} ${d.shapes.length + 1}`;
  const laneTotal =
    laneCount != null &&
    Number.isInteger(laneCount) &&
    laneCount >= 1 &&
    laneCount <= MAX_LANES
      ? laneCount
      : 0;
  const laneShapes = (regions: [XY, XY][], color: string): Shape[] =>
    regions.map((points, index) => ({
      id: crypto.randomUUID(),
      kind: "rectangle",
      name: String(index + 1),
      color,
      points,
    }));
  const angleText = (angle: number) =>
    `${format(Math.round(angle * 10) / 10)}°`;
  const countText = (count: number) =>
    t(
      `${format(count)}개`,
      count === 1 ? "1 point" : `${format(count)} points`
    );
  const point = (event: PointerEvent<SVGSVGElement>): XY => {
    const matrix = groupRef.current?.getScreenCTM();
    if (!matrix) return { x: 0, y: 0 };
    const p = new DOMPoint(event.clientX, event.clientY).matrixTransform(
      matrix.inverse()
    );
    return {
      x: Math.max(0, Math.min(d.width, p.x)),
      y: Math.max(0, Math.min(d.height, p.y)),
    };
  };
  const addColor = (p: XY) => {
    const img = imageRef.current;
    if (!img) return;
    const ratio = Math.min(1, 512 / Math.max(d.width, d.height)),
      canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(d.width * ratio));
    canvas.height = Math.max(1, Math.round(d.height * ratio));
    const c = canvas.getContext("2d")!;
    c.drawImage(img, 0, 0, canvas.width, canvas.height);
    const rgba = c.getImageData(0, 0, canvas.width, canvas.height),
      sample = c.getImageData(
        Math.min(canvas.width - 1, Math.floor(p.x * ratio)),
        Math.min(canvas.height - 1, Math.floor(p.y * ratio)),
        1,
        1
      ).data,
      rgb = [sample[0], sample[1], sample[2]],
      coverage = colorCoverage(rgba.data, rgb, d.tolerance);
    const shape: Shape = {
      id: crypto.randomUUID(),
      kind: "color",
      name: `${t("색상 영역", "Color region")} ${d.shapes.length + 1}`,
      color: "#" + rgb.map((v) => v.toString(16).padStart(2, "0")).join(""),
      points: [p],
      ...coverage,
      tolerance: d.tolerance,
    };
    commit({ ...d, rgb: shape.color, shapes: [...d.shapes, shape] });
    setSelected(shape.id);
  };
  const down = (event: PointerEvent<SVGSVGElement>) => {
    // Capture keeps a drag alive when the pointer leaves the picture. A
    // pointer the browser no longer tracks cannot be captured; the drag then
    // simply ends at the edge.
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Not capturable.
    }
    const p = point(event),
      target = event.target as SVGElement,
      id = target.getAttribute("data-shape"),
      handle = target.getAttribute("data-handle");
    if (tool === "color") {
      addColor(p);
      return;
    }
    if (tool === "select") {
      const original = id ? d.shapes.find((s) => s.id === id) : undefined;
      setSelected(original ? original.id : "");
      if (!original) return;
      const active = {
        start: p,
        original,
        handle: handle === null ? null : Number(handle),
      };
      drag.current = active;
      setMoving(active);
      setDraft([p]);
      return;
    }
    drag.current = { start: p, original: null, handle: null };
    setDraft(tool === "angle" ? [...corners, p] : [p]);
  };
  const move = (event: PointerEvent<SVGSVGElement>) => {
    if (!drag.current) {
      // Between clicks, the next arm of an angle follows the mouse.
      if (tool === "angle" && corners.length)
        setDraft([...corners, point(event)]);
      return;
    }
    const p = point(event);
    if (tool === "freehand")
      setDraft((points) =>
        points.length < MAX_POINTS ? [...points, p] : points
      );
    else if (tool === "angle") setDraft([...corners, p]);
    else if (tool === "count") setDraft([p]);
    else setDraft([drag.current.start, p]);
  };
  const up = (event: PointerEvent<SVGSVGElement>) => {
    const active = drag.current;
    if (!active) return;
    const end = point(event),
      points = tool === "freehand" ? [...draft, end] : [active.start, end];
    drag.current = null;
    setMoving(null);
    setDraft([]);
    if (tool === "select") {
      const original = active.original;
      // A click that selects without moving is not a change to undo.
      if (original && distance(active.start, end) > 0)
        commit({
          ...d,
          shapes: d.shapes.map((s) =>
            s.id === original.id
              ? { ...s, points: moved({ ...active, original }, end).points }
              : s
          ),
        });
      return;
    }
    if (tool === "scale") {
      if (distance(points[0], end) > 0)
        commit({ ...d, reference: points, calibration: "reference" });
      return;
    }
    if (tool === "crop") {
      const width = Math.abs(end.x - active.start.x),
        height = Math.abs(end.y - active.start.y);
      if (width > 1 && height > 1)
        commit({
          ...d,
          crop: {
            x: Math.min(end.x, active.start.x),
            y: Math.min(end.y, active.start.y),
            width,
            height,
          },
        });
      setTool("select");
      return;
    }
    if (tool === "lanes") {
      const regions =
        Math.abs(end.x - active.start.x) > 1 &&
        Math.abs(end.y - active.start.y) > 1
          ? splitRegion(active.start, end, laneTotal, fullView)
          : [];
      if (regions.length) {
        commit({
          ...d,
          shapes: [...d.shapes, ...laneShapes(regions, "#dc2626")],
        });
        setTool("select");
      }
      return;
    }
    if (tool === "angle") {
      const last = corners[corners.length - 1];
      // A corner on top of the one before it would leave an arm with no
      // length; the click is ignored.
      if (last && distance(last, end) < 1) return;
      const placed = [...corners, end];
      if (placed.length < 3) {
        setCorners(placed);
        return;
      }
      setCorners([]);
      const shape: Shape = {
        id: crypto.randomUUID(),
        kind: "angle",
        name: nextName("angle"),
        color: "#2563eb",
        points: placed,
      };
      commit({ ...d, shapes: [...d.shapes, shape] });
      setSelected(shape.id);
      setTool("select");
      return;
    }
    if (tool === "count") {
      // A counted point needs no sub-pixel position; a tenth keeps a long
      // count small.
      const spot = {
          x: Math.round(end.x * 10) / 10,
          y: Math.round(end.y * 10) / 10,
        },
        current = d.shapes.find(
          (s) => s.id === selected && s.kind === "count"
        );
      if (current) {
        if (current.points.length < MAX_POINTS)
          commit({
            ...d,
            shapes: d.shapes.map((s) =>
              s.id === current.id ? { ...s, points: [...s.points, spot] } : s
            ),
          });
        return;
      }
      const shape: Shape = {
        id: crypto.randomUUID(),
        kind: "count",
        name: nextName("count"),
        color: "#2563eb",
        points: [spot],
      };
      commit({ ...d, shapes: [...d.shapes, shape] });
      setSelected(shape.id);
      return;
    }
    if (distance(active.start, end) < 1 && tool !== "text") return;
    const shape: Shape = {
      id: crypto.randomUUID(),
      kind: tool as Shape["kind"],
      name: nextName(tool),
      color: gel ? "#dc2626" : "#2563eb",
      points,
      text: tool === "text" ? t("라벨", "Label") : undefined,
    };
    commit({ ...d, shapes: [...d.shapes, shape] });
    setSelected(shape.id);
    setTool("select");
  };
  // While a shape is dragged it is drawn where it would land, and everything
  // derived from the shapes (labels, sizes, statistics) follows it.
  const live =
      moving && draft.length > 1 ? moved(moving, draft[draft.length - 1]) : null,
    shown = live
      ? d.shapes.map((s) => (s.id === live.id ? live : s))
      : d.shapes;
  const countTarget = shown.find(
    (s) => s.id === selected && s.kind === "count"
  );
  // What the gesture in progress would create, drawn dashed until released.
  const preview = ((): Shape[] => {
    const base = { id: "draft", name: "", color: DRAFT_COLOR };
    if (tool === "select" || tool === "color") return [];
    if (tool === "angle") {
      const points = draft.length ? draft : corners;
      return points.length ? [{ ...base, kind: "angle", points }] : [];
    }
    if (tool === "count")
      return draft.length ? [{ ...base, kind: "count", points: draft }] : [];
    if (draft.length < 2) return [];
    if (tool === "lanes")
      return splitRegion(draft[0], draft[1], laneTotal, fullView).map(
        (points, index) => ({
          ...base,
          id: `draft-${index}`,
          kind: "rectangle",
          name: String(index + 1),
          points,
        })
      );
    if (tool === "text")
      return [
        {
          ...base,
          kind: "text",
          name: nextName("text"),
          text: t("라벨", "Label"),
          points: draft,
        },
      ];
    return [
      {
        ...base,
        kind:
          tool === "scale"
            ? "line"
            : tool === "crop"
            ? "rectangle"
            : (tool as Shape["kind"]),
        points: draft,
      },
    ];
  })();
  const reading = gel ? readGel(shown, d) : null,
    // A band still being drawn already shows the size it would get.
    labelBands = new Map(
      (preview.length && gel
        ? readGel([...shown, ...preview], d)
        : reading
      )?.bands.map((band) => [band.id, band])
    ),
    bandOf = (shape: Shape) => reading?.bands.find((b) => b.id === shape.id),
    laneName = (id: string) =>
      reading?.lanes.find((lane) => lane.id === id)?.name ?? "",
    sizeUnit = d.sizeUnit ?? "bp";
  /** A band's size as shown everywhere: known as entered, estimated with "≈". */
  const sizeText = (band: GelBand | undefined) =>
    !band
      ? ""
      : band.known !== null
      ? `${format(band.known)} ${sizeUnit}`
      : band.estimate?.ok
      ? `≈ ${format(
          roundEstimate(band.estimate.size, band.estimate.extrapolated)
        )} ${sizeUnit}`
      : "";
  const dot = Math.max(3, d.width / 160),
    font = Math.max(12, d.width / 55);
  const shapeElement = (
    s: Shape,
    { draftShape = false, offset = 0 } = {}
  ) => {
    const a = s.points[0],
      b = s.points[1] ?? a;
    if (!a) return null;
    const props = {
      "data-shape": draftShape ? undefined : s.id,
      stroke: s.color,
      strokeWidth: Math.max(1, d.width / 500),
      strokeDasharray: draftShape ? "6 4" : undefined,
      fill: "none",
      vectorEffect: "non-scaling-stroke" as const,
    };
    const info = measure(s, actualScale),
      band = labelBands.get(s.id);
    const label = gel
      ? `${s.name}${
          d.sizeLabels !== false && band?.estimate?.ok
            ? ` ${sizeText(band)}`
            : ""
        }`.trim()
      : s.kind === "line"
      ? `${format(info.length)} ${unit}`
      : s.kind === "color"
      ? `${format((s.fraction ?? 0) * 100)}% · ${format(
          (s.areaFraction ?? s.fraction ?? 0) *
            d.width *
            d.height *
            actualScale ** 2
        )} ${unit}²`
      : s.kind === "text"
      ? s.text
      : s.kind === "angle"
      ? info.angle == null
        ? ""
        : angleText(info.angle)
      : s.kind === "count"
      ? draftShape
        ? ""
        : `${s.name}: ${s.points.length}`
      : `${format(info.area)} ${unit}²`;
    // An angle is labelled at its vertex, everything else at its first point.
    const anchor = s.kind === "angle" ? b : a,
      arc = s.kind === "angle" ? anglePath(s.points) : "";
    return (
      <g key={s.id} data-preview={draftShape ? "" : undefined}>
        {s.kind === "line" ? (
          <line {...props} x1={a.x} y1={a.y} x2={b.x} y2={b.y} />
        ) : s.kind === "rectangle" ? (
          <rect
            {...props}
            x={Math.min(a.x, b.x)}
            y={Math.min(a.y, b.y)}
            width={Math.abs(b.x - a.x)}
            height={Math.abs(b.y - a.y)}
          />
        ) : s.kind === "ellipse" ? (
          <ellipse
            {...props}
            cx={(a.x + b.x) / 2}
            cy={(a.y + b.y) / 2}
            rx={Math.abs(b.x - a.x) / 2}
            ry={Math.abs(b.y - a.y) / 2}
          />
        ) : s.kind === "freehand" ? (
          <polygon
            {...props}
            points={s.points.map((p) => `${p.x},${p.y}`).join(" ")}
          />
        ) : s.kind === "angle" ? (
          <>
            <polyline
              {...props}
              points={s.points.map((p) => `${p.x},${p.y}`).join(" ")}
            />
            {arc && <path {...props} d={arc} />}
            {/* Corners placed so far, visible before there is a line. */}
            {draftShape &&
              s.points.map((p, i) => (
                <circle key={i} cx={p.x} cy={p.y} r={dot / 2} fill={s.color} />
              ))}
          </>
        ) : s.kind === "count" ? (
          s.points.map((p, i) => (
            <g key={i}>
              <circle
                data-shape={props["data-shape"]}
                cx={p.x}
                cy={p.y}
                r={dot}
                fill={s.color}
                stroke="#ffffff"
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
              />
              <text
                data-shape={props["data-shape"]}
                x={p.x + dot * 1.5}
                y={p.y + dot}
                fill={s.color}
                fontSize={font * 0.8}
              >
                {i + 1 + offset}
              </text>
            </g>
          ))
        ) : null}
        {label && (
          <text
            data-shape={props["data-shape"]}
            x={anchor.x}
            y={anchor.y - 8 - (s.kind === "count" ? dot : 0)}
            fill={s.color}
            fontSize={font}
          >
            {label}
          </text>
        )}
        {selected === s.id &&
          !draftShape &&
          s.kind !== "color" &&
          s.points.map((p, i) => (
            <circle
              key={i}
              data-shape={s.id}
              data-handle={i}
              cx={p.x}
              cy={p.y}
              r={d.width / 120}
              fill="white"
              stroke={s.color}
            />
          ))}
      </g>
    );
  };
  const selectedShape = shown.find((s) => s.id === selected),
    selectedMeasure = selectedShape
      ? measure(selectedShape, actualScale)
      : null;
  const editShape = (patch: Partial<Shape>, entry = "") =>
    commit(
      {
        ...d,
        shapes: d.shapes.map((s) =>
          s.id === selected ? { ...s, ...patch } : s
        ),
      },
      entry && `${entry}:${selected}`
    );
  const updateColor = (color: string, tolerance: number, entry = "") => {
    const image = imageRef.current;
    if (!image || !selectedShape) return;
    const ratio = Math.min(1, 512 / Math.max(d.width, d.height)),
      canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(d.width * ratio));
    canvas.height = Math.max(1, Math.round(d.height * ratio));
    const c = canvas.getContext("2d")!;
    c.drawImage(image, 0, 0, canvas.width, canvas.height);
    const rgb = [1, 3, 5].map((start) =>
        parseInt(color.slice(start, start + 2), 16)
      ),
      coverage = colorCoverage(
        c.getImageData(0, 0, canvas.width, canvas.height).data,
        rgb,
        tolerance
      );
    editShape({ color, tolerance, ...coverage }, entry);
  };
  const splitSelected = () => {
    if (!selectedShape || selectedShape.points.length < 2) return;
    const regions = splitRegion(
      selectedShape.points[0],
      selectedShape.points[1],
      laneTotal,
      fullView
    );
    if (!regions.length) return;
    commit({
      ...d,
      shapes: d.shapes.flatMap((s) =>
        s.id === selectedShape.id ? laneShapes(regions, s.color) : [s]
      ),
    });
    setSelected("");
  };
  /** What a shape measures, for the table and the PDF. */
  const resultText = (shape: Shape, perimeter = false) => {
    const result = measure(shape, actualScale);
    return shape.kind === "text"
      ? shape.text ?? ""
      : shape.kind === "angle"
      ? result.angle == null
        ? "—"
        : angleText(result.angle)
      : shape.kind === "count"
      ? countText(result.count ?? 0)
      : shape.kind === "freehand" && perimeter
      ? `${format(result.area)} ${unit}² · ${t("둘레", "Perimeter")} ${format(
          result.length
        )} ${unit}`
      : result.area != null
      ? `${format(result.area)} ${unit}²`
      : `${format(result.length)} ${unit}`;
  };
  /** A gel shape's place in the reading: what it is, its lane and its size. */
  const gelCells = (shape: Shape) => {
    const band = bandOf(shape),
      extrapolated = !!band?.estimate?.ok && band.estimate.extrapolated;
    return {
      type:
        shape.kind === "line"
          ? band && band.known !== null
            ? t("래더 밴드", "Ladder band")
            : t("밴드", "Band")
          : names[shape.kind] ?? shape.kind,
      lane: band ? laneName(band.lane) : "",
      size: band
        ? `${sizeText(band)}${
            extrapolated ? ` · ${t("외삽", "extrapolated")}` : ""
          }`
        : "",
    };
  };
  /**
   * The gel's annotations as export rows: bands lane by lane from the left and
   * down each lane, then the lanes without bands and the remaining notes.
   * Pixel lengths and areas are left out; they say nothing about a gel.
   */
  const gelRows = () => {
    if (!reading) return [];
    const order = new Map(reading.lanes.map((lane, index) => [lane.id, index])),
      rank = (band: GelBand) => order.get(band.lane) ?? reading.lanes.length,
      used = new Set(reading.bands.map((band) => band.lane));
    return [
      ...[...reading.bands]
        .sort(
          (m, n) =>
            rank(m) - rank(n) || m.left - n.left || m.position - n.position
        )
        .map((band) => ({
          lane: laneName(band.lane),
          name: band.name,
          type:
            band.known !== null
              ? t("래더 밴드", "Ladder band")
              : t("밴드", "Band"),
          position: Math.round(band.position * 10) / 10,
          size:
            band.known ??
            (band.estimate?.ok
              ? roundEstimate(band.estimate.size, band.estimate.extrapolated)
              : null),
          source:
            band.known !== null
              ? t("래더", "Ladder")
              : band.estimate?.ok
              ? t("추정", "Estimated")
              : "",
          extrapolated: band.estimate?.ok ? band.estimate.extrapolated : null,
        })),
      ...d.shapes
        .filter(
          (shape) =>
            shape.kind !== "line" &&
            !(shape.kind === "rectangle" && used.has(shape.id))
        )
        .map((shape) => ({
          lane: shape.kind === "rectangle" ? shape.name : "",
          name: shape.kind === "rectangle" ? "" : shape.name,
          type: names[shape.kind] ?? shape.kind,
          position: null,
          size: null,
          source: "",
          extrapolated: null,
        })),
    ];
  };
  const groups: MeasureGroup[] = gel
    ? []
    : (
        [
          ["line", t("선 길이", "Line length"), "length", ` ${unit}`],
          ["rectangle", t("사각형 면적", "Rectangle area"), "area", ` ${unit}²`],
          ["ellipse", t("타원 면적", "Ellipse area"), "area", ` ${unit}²`],
          ["freehand", t("자유형 면적", "Freehand area"), "area", ` ${unit}²`],
          ["angle", t("각도", "Angle"), "angle", "°"],
          ["count", t("점 계수", "Point count"), "count", ""],
        ] as const
      )
        .map(([kind, label, quantity, suffix]) => ({
          key: kind,
          label,
          text: (value: number) => `${format(value)}${suffix}`,
          total: kind === "count",
          values: shown
            .filter((shape) => shape.kind === kind)
            .map((shape) => ({
              name: shape.name,
              value: measure(shape, actualScale)[quantity] ?? NaN,
            }))
            .filter((entry) => Number.isFinite(entry.value)),
        }))
        .filter((entry) => entry.values.length > 0);
  const exportPNG = async () => {
    try {
      const svg = svgRef.current;
      if (!svg) return;
      const clone = svg.cloneNode(true) as SVGSVGElement;
      if (d.asset) {
        const original = await ctx.repo.getImage(d.asset);
        const data = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(original);
        });
        clone.querySelector("image")?.setAttribute("href", data);
      }
      clone
        .querySelectorAll("[data-handle], [data-preview]")
        .forEach((el) => el.remove());
      const blob = new Blob([new XMLSerializer().serializeToString(clone)], {
          type: "image/svg+xml",
        }),
        u = URL.createObjectURL(blob);
      try {
        const img = new Image();
        img.src = u;
        await img.decode();
        const c = document.createElement("canvas");
        c.width = sw;
        c.height = sh;
        const g = c.getContext("2d")!;
        g.fillStyle = "white";
        g.fillRect(0, 0, sw, sh);
        g.drawImage(img, 0, 0, sw, sh);
        const out = await new Promise<Blob | null>((r) => c.toBlob(r));
        if (out) await download(out, exportName("png"), "image/png");
      } finally {
        URL.revokeObjectURL(u);
      }
    } catch (e) {
      setError(String(e));
    }
  };
  const exportPDF = async () => {
    try {
      // The statistics shown under the table, for kinds measured twice or more.
      const stats = groups.flatMap((entry) => {
        const summary = summarize(entry.values.map((value) => value.value));
        return summary && summary.sd !== null
          ? [
              [
                entry.label,
                summary.n,
                entry.text(Number(summary.mean.toPrecision(4))),
                entry.text(Number(summary.sd.toPrecision(4))),
              ],
            ]
          : [];
      });
      await report({
        title: ctx.doc.title,
        lines: gel
          ? [
              `${t("원본 이미지", "Source image")}: ${d.width} × ${
                d.height
              } px`,
              t(
                "≈ 표시는 이웃한 래더 밴드 사이를 log 크기로 직선 보간한 추정값이며, 외삽은 래더 범위 밖의 값입니다.",
                "≈ marks an estimate read along a straight line in log size between neighbouring ladder bands; extrapolated values lie outside the ladder."
              ),
            ]
          : [
              scale > 0
                ? `${t("스케일", "Scale")}: ${plainNumber(
                    scale,
                    7
                  )} ${unit}/px`
                : t(
                    "미보정: 결과는 픽셀 단위입니다.",
                    "Uncalibrated: results are in pixels."
                  ),
              `${t("원본 이미지", "Source image")}: ${d.width} × ${
                d.height
              } px`,
            ],
        svg: svgRef.current,
        headers: gel
          ? [
              t("레인", "Lane"),
              t("이름", "Name"),
              t("구분", "Type"),
              t("크기", "Size"),
            ]
          : [t("이름", "Name"), t("결과", "Result")],
        rows: gel
          ? gelRows().map((row) => [
              row.lane,
              row.name,
              row.type,
              row.size === null
                ? ""
                : `${row.extrapolated === null ? "" : "≈ "}${format(
                    row.size
                  )} ${sizeUnit}${
                    row.extrapolated ? ` (${t("외삽", "extrapolated")})` : ""
                  }`,
            ])
          : d.shapes.map((shape) => [
              shape.name,
              shape.kind === "color"
                ? `${format(colorArea(shape))} ${unit}² ≈`
                : resultText(shape),
            ]),
        sections: stats.length
          ? [
              {
                title: t("측정 통계", "Measurement statistics"),
                headers: [
                  t("종류", "Kind"),
                  t("개수", "Count"),
                  t("평균", "Mean"),
                  t("표준편차 (n−1)", "SD (n−1)"),
                ],
                rows: stats,
              },
            ]
          : [],
        name: exportName("pdf"),
      });
    } catch (e) {
      setError(String(e));
    }
  };
  const exportCSV = () =>
    download(
      csv(
        gel
          ? [
              [
                t("레인", "Lane"),
                t("이름", "Name"),
                t("구분", "Type"),
                t("이동 거리 (px)", "Migration distance (px)"),
                t("크기", "Size"),
                t("단위", "Unit"),
                t("크기 출처", "Size source"),
                t("외삽", "Extrapolated"),
              ],
              ...gelRows().map((row) => [
                row.lane,
                row.name,
                row.type,
                row.position ?? "",
                row.size ?? "",
                row.size === null ? "" : sizeUnit,
                row.source,
                row.extrapolated === null
                  ? ""
                  : row.extrapolated
                  ? t("예", "Yes")
                  : t("아니오", "No"),
              ]),
            ]
          : [
              [
                t("이름", "Name"),
                t("길이", "Length"),
                t("너비", "Width"),
                t("높이", "Height"),
                t("면적", "Area"),
                t("단위", "Unit"),
                t("각도 (°)", "Angle (°)"),
                t("점 개수", "Points"),
              ],
              ...d.shapes.map((s) => {
                const r = measure(s, actualScale);
                return [
                  s.name,
                  r.length ?? "",
                  r.width ?? "",
                  r.height ?? "",
                  s.kind === "color" ? colorArea(s) : r.area ?? "",
                  unit,
                  r.angle ?? "",
                  r.count ?? "",
                ];
              }),
            ]
      ),
      exportName("csv"),
      "text/csv"
    );
  return (
    // Leaving a field ends its run of edits: the next one is undone on its own.
    <div
      onBlur={() => {
        group.current = "";
      }}
    >
      <Panel>
        {!d.asset && (
          <div className="tool-actions">
            <button
              onClick={async () => {
                try {
                  const canvas = document.createElement("canvas");
                  canvas.width = 1000;
                  canvas.height = 700;
                  const c = canvas.getContext("2d")!;
                  c.fillStyle = "#ffffff";
                  c.fillRect(0, 0, 1000, 700);
                  c.fillStyle = "#0f172a";
                  c.font = "28px sans-serif";
                  c.fillText(
                    t("측정 연습 이미지", "Measurement example"),
                    60,
                    65
                  );
                  c.strokeStyle = "#0f172a";
                  c.lineWidth = 4;
                  c.beginPath();
                  c.moveTo(100, 150);
                  c.lineTo(300, 150);
                  c.stroke();
                  c.fillText("200 px = 10 mm", 100, 125);
                  c.fillStyle = "#bfdbfe";
                  c.fillRect(100, 250, 200, 100);
                  c.fillStyle = "#bbf7d0";
                  c.beginPath();
                  c.arc(550, 300, 100, 0, Math.PI * 2);
                  c.fill();
                  c.fillStyle = "#0f172a";
                  c.fillText("10 × 5 mm = 50 mm²", 80, 410);
                  c.fillText("r = 5 mm", 480, 440);
                  const blob = await new Promise<Blob | null>((resolve) =>
                    canvas.toBlob(resolve)
                  );
                  if (!blob) return;
                  const asset = await ctx.repo.putImage(ctx.doc.id, blob);
                  commit({
                    ...d,
                    asset,
                    width: 1000,
                    height: 700,
                    known: 10,
                    unit: "mm",
                    calibration: "reference",
                    reference: [
                      { x: 100, y: 150 },
                      { x: 300, y: 150 },
                    ],
                    shapes: [],
                    crop: null,
                  });
                  setError("");
                } catch (e) {
                  setError(String(e));
                }
              }}
            >
              {t("예제 이미지로 연습", "Try an example image")}
            </button>
          </div>
        )}
        {url && (
          <details className="tool-guide">
            <summary>
              {t("다른 이미지의 설정 복사", "Copy settings from another image")}
            </summary>
            <Select
              label={t(
                "다른 이미지에서 측정·주석 설정 복사",
                "Copy measurements and annotations from another image"
              )}
              value=""
              options={[
                "",
                ...ctx.documents
                  .filter(
                    (doc) =>
                      ["image-measurer", "gel-blot"].includes(doc.tool_id) &&
                      doc.id !== ctx.doc.id
                  )
                  .map((doc) => [doc.id, doc.title] as const),
              ]}
              onChange={(id) => {
                const source = ctx.documents.find((doc) => doc.id === id)
                  ?.data as Partial<ImageData> | undefined;
                if (!source?.shapes || !source.width || !source.height) return;
                commit({
                  ...d,
                  shapes: source.shapes
                    .filter((s) => s.kind !== "color")
                    .map((s) => ({
                      ...s,
                      id: crypto.randomUUID(),
                      points: s.points.map((p) => ({
                        x: (p.x * d.width) / source.width!,
                        y: (p.y * d.height) / source.height!,
                      })),
                    })),
                  known: 0,
                  unitsPerPixel: 0,
                  bar: 0,
                  // Ladder sizes come along with the bands, so their unit does too.
                  ...(gel && source.sizeUnit
                    ? { sizeUnit: source.sizeUnit }
                    : {}),
                });
                setError(
                  t(
                    "보정값을 재확인한 뒤 측정 단위를 설정하세요.",
                    "Recalibrate this image before using physical units."
                  )
                );
              }}
            />
          </details>
        )}
        <label className={`tool-field ${!url ? "tool-upload-zone" : ""}`}>
          <span>
            {t(
              "PNG / JPEG 이미지 (최대 20 MB)",
              "PNG / JPEG image (up to 20 MB)"
            )}
          </span>
          <input
            type="file"
            accept="image/png,image/jpeg"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              const temp = URL.createObjectURL(file);
              try {
                const img = new Image();
                img.src = temp;
                await img.decode();
                if (img.width * img.height > 40e6)
                  throw Error("Maximum 40 megapixels");
                const asset = await ctx.repo.putImage(ctx.doc.id, file);
                commit({
                  ...d,
                  asset,
                  width: img.width,
                  height: img.height,
                  shapes: [],
                  crop: null,
                  rotation: 0,
                  // A new image starts unmirrored, like it starts unrotated.
                  flipX: false,
                  flipY: false,
                  known: 0,
                  unitsPerPixel: 0,
                  reference: [
                    { x: img.width * 0.1, y: img.height * 0.2 },
                    { x: img.width * 0.4, y: img.height * 0.2 },
                  ],
                });
                setError("");
              } catch (e) {
                setError(String(e));
              } finally {
                URL.revokeObjectURL(temp);
              }
            }}
          />
        </label>
        <ErrorMessage message={error} />
        {url && (
          <>
            {!gel && (
              <div className="tool-grid">
                <Select
                  label={t("보정 방법", "Calibration")}
                  value={d.calibration}
                  onChange={(calibration) =>
                    commit({
                      ...d,
                      calibration: calibration as ImageData["calibration"],
                    })
                  }
                  options={[
                    ["reference", t("기준선", "Reference line")],
                    ["pixel", t("단위 / 픽셀", "Unit / pixel")],
                  ]}
                />
                <Field
                  label={
                    d.calibration === "reference"
                      ? t("기준선의 알려진 길이", "Known reference length")
                      : t("단위 / 픽셀", "Units / pixel")
                  }
                  value={
                    d.calibration === "reference" ? d.known : d.unitsPerPixel
                  }
                  onChange={(v) =>
                    commit(
                      {
                        ...d,
                        [d.calibration === "reference"
                          ? "known"
                          : "unitsPerPixel"]: Number(v),
                      },
                      `scale:${d.calibration}`
                    )
                  }
                />
                <Select
                  label={t("단위", "Unit")}
                  value={d.unit}
                  onChange={(unit) => commit({ ...d, unit })}
                  options={["m", "cm", "mm", "µm", "nm"]}
                />
                <Field
                  label={t("스케일 바 길이", "Scale bar length")}
                  value={d.bar}
                  onChange={(v) => commit({ ...d, bar: Number(v) }, "bar")}
                />
              </div>
            )}
            {!gel && scale <= 0 && (
              <p className="tool-muted">
                {t(
                  "미보정: 픽셀 단위입니다. 기준선 도구로 알려진 길이를 드래그하세요.",
                  "Uncalibrated: pixel units. Draw a known length using the reference tool."
                )}
              </p>
            )}
            <div className="tool-actions">
              {toolKeys.map((k) => (
                <button
                  key={k}
                  className={tool === k ? "primary" : ""}
                  aria-pressed={tool === k}
                  onClick={() => pickTool(k)}
                >
                  {names[k]}
                </button>
              ))}
              <button
                disabled={!history.length}
                aria-keyshortcuts="Control+Z Meta+Z"
                onClick={undo}
              >
                {t("실행 취소", "Undo")}
              </button>
              <button
                disabled={!redo.length}
                aria-keyshortcuts="Control+Shift+Z Meta+Shift+Z Control+Y"
                onClick={redoStep}
              >
                {t("다시 실행", "Redo")}
              </button>
            </div>
            <div className="tool-actions">
              <button
                aria-label={t("축소", "Zoom out")}
                onClick={() => setZoom(Math.max(0.25, zoom - 0.25))}
              >
                −
              </button>
              <span>{Math.round(zoom * 100)}%</span>
              <button
                aria-label={t("확대", "Zoom in")}
                onClick={() => setZoom(Math.min(4, zoom + 0.25))}
              >
                +
              </button>
              <button
                onClick={() =>
                  commit({ ...d, rotation: (d.rotation + 90) % 360 })
                }
              >
                ↻ 90°
              </button>
              <button onClick={() => commit({ ...d, flipX: !d.flipX })}>
                {t("좌우 반전", "Flip X")}
              </button>
              <button onClick={() => commit({ ...d, flipY: !d.flipY })}>
                {t("상하 반전", "Flip Y")}
              </button>
              <button onClick={() => commit({ ...d, crop: null })}>
                {t("자르기 해제", "Reset crop")}
              </button>
            </div>
            {tool === "color" && (
              <Field
                label={t(
                  "색상 허용 오차 (%) · 근사 면적",
                  "Color tolerance (%) · approximate area"
                )}
                value={d.tolerance}
                onChange={(v) =>
                  commit(
                    {
                      ...d,
                      tolerance: Math.max(0, Math.min(100, Number(v))),
                    },
                    "tolerance"
                  )
                }
              />
            )}
            {tool === "lanes" && (
              <div className="tool-image-x-hint">
                <StoredNumberField
                  label={t("레인 수", "Number of lanes")}
                  value={laneCount}
                  onChange={setLaneCount}
                />
                <p className="tool-muted" role="status">
                  {laneTotal
                    ? t(
                        `레인 전체를 감싸도록 이미지 위를 끌면 같은 폭의 레인 ${laneTotal}개가 왼쪽부터 1번으로 만들어집니다.`,
                        `Drag across all the lanes on the image to make ${laneTotal} lanes of equal width, numbered from 1 at the left.`
                      )
                    : t(
                        `레인 수를 1에서 ${MAX_LANES} 사이의 정수로 입력하세요.`,
                        `Enter a whole number of lanes from 1 to ${MAX_LANES}.`
                      )}
                </p>
              </div>
            )}
            {tool === "angle" && (
              <p className="tool-muted" role="status">
                {t(
                  `한쪽 끝, 꼭짓점, 다른 쪽 끝 순서로 세 점을 누르세요. (${corners.length}/3)`,
                  `Click three points: one end, the vertex, then the other end. (${corners.length}/3)`
                )}
              </p>
            )}
            {tool === "count" && (
              <div className="tool-image-x-hint">
                <p className="tool-muted" role="status">
                  {countTarget
                    ? t(
                        `셀 대상을 하나씩 누르세요. "${countTarget.name}"에 더해집니다: ${countTarget.points.length}개`,
                        `Click each object to count it. Adding to "${countTarget.name}": ${countTarget.points.length}`
                      )
                    : t(
                        "셀 대상을 하나씩 누르세요. 누를 때마다 번호가 붙은 점이 생깁니다.",
                        "Click each object to count it. Every click leaves a numbered point."
                      )}
                </p>
                {countTarget && (
                  // A second kind of object is counted in a group of its own.
                  <button onClick={() => setSelected("")}>
                    {t("새 그룹으로 세기", "Start a new group")}
                  </button>
                )}
              </div>
            )}
          </>
        )}
      </Panel>
      {url && (
        <>
          <div
            className="tool-image-stage-toolbar"
            role="toolbar"
            aria-label={t("이미지 위 조작 도구", "Image controls")}
          >
            <Select
              label={t("그리기 도구", "Drawing tool")}
              value={tool}
              onChange={pickTool}
              options={toolKeys.map(
                (k) =>
                  [
                    k,
                    k === "select"
                      ? t("선택 / 이동", "Select / Move")
                      : names[k],
                  ] as const
              )}
            />
            <button
              aria-label={t("이미지 축소", "Zoom out")}
              onClick={() => setZoom(Math.max(0.25, zoom - 0.25))}
            >
              −
            </button>
            <button
              aria-label={t("이미지 확대", "Zoom in")}
              onClick={() => setZoom(Math.min(4, zoom + 0.25))}
            >
              +
            </button>
          </div>
          <div className="tool-image-stage">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              ref={svgRef}
              viewBox={`0 0 ${sw} ${sh}`}
              width={sw * zoom}
              height={sh * zoom}
              style={{
                maxWidth: zoom <= 1 ? "100%" : undefined,
                height: "auto",
              }}
              onPointerDown={down}
              onPointerMove={move}
              onPointerUp={up}
              onPointerCancel={() => {
                drag.current = null;
                setMoving(null);
                setDraft([]);
              }}
              onPointerLeave={() => {
                // The arm that followed the mouse stops at the last corner.
                if (!drag.current) setDraft([]);
              }}
              // A drag is a gesture on the picture, never the browser's own
              // image drag.
              onDragStart={(event) => event.preventDefault()}
              role="img"
              aria-label={t("측정 이미지 편집기", "Measurement image editor")}
            >
              <g ref={groupRef} transform={transform}>
                <image href={url} width={d.width} height={d.height} />
                {shown.map((s) => shapeElement(s))}
                {tool === "scale" && d.reference.length === 2 && (
                  <>
                    <line
                      x1={d.reference[0].x}
                      y1={d.reference[0].y}
                      x2={d.reference[1].x}
                      y2={d.reference[1].y}
                      stroke="#3b82f6"
                      strokeWidth={d.width / 300}
                    />
                    <text
                      x={d.reference[0].x}
                      y={d.reference[0].y - 12}
                      fill="#2563eb"
                      fontSize={d.width / 55}
                    >
                      {d.known} {d.unit}
                    </text>
                  </>
                )}
                {preview.map((s) =>
                  shapeElement(s, {
                    draftShape: true,
                    offset: countTarget?.points.length ?? 0,
                  })
                )}
              </g>
              {d.bar > 0 && scale > 0 && d.bar / scale < sw * 0.9 && (
                <g>
                  <line
                    x1={sw * 0.05}
                    x2={sw * 0.05 + d.bar / scale}
                    y1={sh * 0.92}
                    y2={sh * 0.92}
                    stroke="#0f172a"
                    strokeWidth={sw / 200}
                  />
                  <text
                    x={sw * 0.05}
                    y={sh * 0.89}
                    fontSize={sw / 45}
                    fill="#0f172a"
                  >
                    {d.bar} {d.unit}
                  </text>
                </g>
              )}
            </svg>
          </div>
        </>
      )}
      {d.bar > 0 && scale > 0 && d.bar / scale >= sw * 0.9 && (
        <ErrorMessage
          message={t(
            "스케일 바가 이미지보다 깁니다. 길이를 줄이세요.",
            "Scale bar exceeds image width. Reduce its length."
          )}
        />
      )}
      {selectedShape && (
        <Panel title={t("선택 항목", "Selection")}>
          <div className="tool-grid">
            <Field
              type="text"
              label={t("이름", "Name")}
              value={selectedShape.name}
              onChange={(name) => editShape({ name }, "name")}
            />
            <ColorField
              label={t("색상", "Color")}
              value={selectedShape.color}
              colors={[
                "#2563eb",
                "#16a34a",
                "#dc2626",
                "#ea580c",
                "#7c3aed",
                "#0891b2",
                "#0f172a",
                "#ffffff",
              ]}
              onChange={(color) =>
                selectedShape.kind === "color"
                  ? updateColor(color, selectedShape.tolerance ?? 20)
                  : editShape({ color })
              }
            />
            {selectedShape.kind === "color" && (
              <Field
                label={t(
                  "선택 영역의 허용 오차 (%)",
                  "Selected color tolerance (%)"
                )}
                value={selectedShape.tolerance ?? 20}
                onChange={(value) =>
                  updateColor(
                    selectedShape.color,
                    Math.max(0, Math.min(100, Number(value))),
                    "tolerance"
                  )
                }
              />
            )}
            {selectedShape.kind === "line" && (
              <Field
                label={`${t("길이", "Length")} (${unit})`}
                value={selectedMeasure?.length ?? 0}
                onChange={(value) => {
                  const a = selectedShape.points[0],
                    b = selectedShape.points[1],
                    length = distance(a, b);
                  if (length > 0)
                    editShape(
                      {
                        points: [
                          a,
                          {
                            x:
                              a.x +
                              ((b.x - a.x) * Number(value)) /
                                actualScale /
                                length,
                            y:
                              a.y +
                              ((b.y - a.y) * Number(value)) /
                                actualScale /
                                length,
                          },
                        ],
                      },
                      "length"
                    );
                }}
              />
            )}
            {gel && selectedShape.kind === "line" && (
              <StoredNumberField
                label={t(
                  `래더 밴드 크기 (${sizeUnit})`,
                  `Ladder band size (${sizeUnit})`
                )}
                value={selectedShape.size ?? null}
                onChange={(size) => editShape({ size }, "size")}
              />
            )}
            {selectedShape.kind === "text" && (
              <Field
                type="text"
                label={t("텍스트", "Text")}
                value={selectedShape.text ?? ""}
                onChange={(text) => editShape({ text }, "text")}
              />
            )}{" "}
            {selectedShape.points.length === 2 &&
              !["line", "angle", "count"].includes(selectedShape.kind) &&
              (["width", "height"] as const).map((key, i) => (
                <Field
                  key={key}
                  label={`${
                    key === "width" ? t("너비", "Width") : t("높이", "Height")
                  } (${unit})`}
                  value={selectedMeasure?.[key] ?? 0}
                  onChange={(v) => {
                    const a = selectedShape.points[0],
                      b = { ...selectedShape.points[1] };
                    if (i === 0)
                      b.x = a.x + Math.max(0, Number(v)) / actualScale;
                    else b.y = a.y + Math.max(0, Number(v)) / actualScale;
                    editShape({ points: [a, b] }, key);
                  }}
                />
              ))}
            {gel && selectedShape.kind === "rectangle" && (
              <StoredNumberField
                label={t("나눌 레인 수", "Lanes to split into")}
                value={laneCount}
                onChange={setLaneCount}
              />
            )}
          </div>
          {gel && selectedShape.kind === "line" && (
            <p className="tool-muted">
              {selectedShape.size != null && selectedShape.size > 0
                ? t(
                    "크기를 입력한 밴드는 래더 밴드로, 다른 밴드의 크기를 추정하는 기준이 됩니다.",
                    "A band with a size is a ladder band: the reference other bands are estimated from."
                  )
                : `${t(
                    "래더 밴드라면 알려진 크기를 입력하세요. 비워 두면 시료 밴드로 보고 크기를 추정합니다.",
                    "For a ladder band, enter its known size. Left empty, the band is a sample band and its size is estimated."
                  )}${
                    sizeText(bandOf(selectedShape))
                      ? ` ${t("추정 크기", "Estimated size")}: ${
                          gelCells(selectedShape).size
                        }`
                      : ""
                  }`}
            </p>
          )}
          {selectedShape.kind === "angle" && (
            <p className="tool-muted">
              {t("각도", "Angle")}: {resultText(selectedShape)}
              {" · "}
              {t(
                "가운데 조절점이 꼭짓점입니다.",
                "The middle handle is the vertex."
              )}
            </p>
          )}
          {selectedShape.kind === "count" && (
            <p className="tool-muted">
              {t("점 개수", "Points")}: {resultText(selectedShape)}
              {selectedShape.points.length >= MAX_POINTS &&
                ` · ${t(
                  `한 그룹에는 ${format(MAX_POINTS)}개까지 셀 수 있습니다.`,
                  `One group holds up to ${format(MAX_POINTS)} points.`
                )}`}
            </p>
          )}
          <div className="tool-actions">
            {gel && selectedShape.kind === "rectangle" && (
              <button disabled={!laneTotal} onClick={splitSelected}>
                {t("레인으로 균등 분할", "Split into equal lanes")}
              </button>
            )}
            {selectedShape.kind === "count" && (
              <>
                <button onClick={() => pickTool("count")}>
                  {t("이어서 세기", "Keep counting")}
                </button>
                <button
                  disabled={selectedShape.points.length < 2}
                  onClick={() =>
                    editShape({ points: selectedShape.points.slice(0, -1) })
                  }
                >
                  {t("마지막 점 지우기", "Remove last point")}
                </button>
              </>
            )}
            <button
              onClick={() => {
                commit({
                  ...d,
                  shapes: d.shapes.filter((s) => s.id !== selected),
                });
                setSelected("");
              }}
            >
              {t("측정 삭제", "Delete measurement")}
            </button>
          </div>
        </Panel>
      )}
      {gel && url && (
        <Panel title={t("래더", "Ladder")}>
          <Select
            label={t("사용자 래더 불러오기", "Load custom ladder")}
            value=""
            options={[
              "",
              ...ctx.documents
                .filter((doc) => doc.tool_id === "ladders")
                .map((doc) => [doc.id, doc.title] as const),
            ]}
            onChange={(id) => {
              const ladder = ctx.documents.find((doc) => doc.id === id);
              // Only the fields used here are read; a ladder saved by a newer
              // build may carry more.
              const bands = ladder?.data.bands as
                | { label?: string; size?: number | null; highlight?: boolean }[]
                | undefined;
              if (Array.isArray(bands)) {
                const ladderUnit =
                    typeof ladder?.data.unit === "string"
                      ? ladder.data.unit
                      : "",
                  known = (size: unknown): size is number =>
                    typeof size === "number" &&
                    Number.isFinite(size) &&
                    size > 0;
                // Largest at the top, spaced by log size. Reference bands the
                // ladder marks as emphasised are drawn longer and in red.
                const positions = ladderPositions(
                  bands.map((b) => (known(b.size) ? b.size : null))
                );
                commit({
                  ...d,
                  ...(ladderUnit ? { sizeUnit: ladderUnit } : {}),
                  shapes: [
                    ...d.shapes,
                    ...bands.map((b, i) => {
                      const y = d.height * (0.1 + 0.8 * positions[i]);
                      return {
                        id: crypto.randomUUID(),
                        kind: "line" as const,
                        name: `${b.label ?? b.size ?? ""} ${ladderUnit}`.trim(),
                        color: b.highlight ? "#dc2626" : "#f97316",
                        points: [
                          { x: d.width * (b.highlight ? 0.08 : 0.1), y },
                          { x: d.width * (b.highlight ? 0.22 : 0.2), y },
                        ],
                        // The known size is what other bands are read against.
                        ...(known(b.size) ? { size: b.size } : {}),
                      };
                    }),
                  ],
                });
              }
            }}
          />
          <p className="tool-muted">
            {t(
              "불러온 밴드를 이미지의 실제 래더 밴드 위로 하나씩 옮기세요. 처음 배치는 로그 간격의 출발점일 뿐입니다.",
              "Move each loaded band onto the real ladder band in the image. The first layout is only a log-spaced starting point."
            )}
          </p>
        </Panel>
      )}
      {gel && url && reading && (
        <Panel title={t("밴드 크기 추정", "Band size estimate")}>
          <GelSizes
            reading={reading}
            unit={sizeUnit}
            onUnit={(next) => commit({ ...d, sizeUnit: next })}
            labels={d.sizeLabels !== false}
            onLabels={(sizeLabels) => commit({ ...d, sizeLabels })}
          />
        </Panel>
      )}
      {url && (
        <>
          <Panel title={t("측정과 주석", "Measurements and annotations")}>
            <div className="tool-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>{t("이름", "Name")}</th>
                    {gel ? (
                      <>
                        <th>{t("구분", "Type")}</th>
                        <th>{t("레인", "Lane")}</th>
                        <th>{t("크기", "Size")}</th>
                      </>
                    ) : (
                      <th>{t("결과", "Result")}</th>
                    )}
                    <th>{t("표시", "Visibility")}</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((s) => {
                    const visible = s.points.some(
                        (p) =>
                          p.x >= crop.x &&
                          p.x <= crop.x + crop.width &&
                          p.y >= crop.y &&
                          p.y <= crop.y + crop.height
                      ),
                      cells = gel ? gelCells(s) : null;
                    return (
                      <tr key={s.id}>
                        <td>
                          <button onClick={() => setSelected(s.id)}>
                            {s.name}
                          </button>
                        </td>
                        {cells ? (
                          <>
                            <td>{cells.type}</td>
                            <td>{cells.lane || "—"}</td>
                            <td>{cells.size || "—"}</td>
                          </>
                        ) : (
                          <td>
                            {s.kind === "color"
                              ? `${format(colorArea(s))} ${unit}² · ${format(
                                  (s.fraction ?? 0) * 100
                                )}% ≈`
                              : resultText(s, true)}
                          </td>
                        )}
                        <td>
                          {visible
                            ? t("표시됨", "Visible")
                            : t("자르기 밖", "Outside crop")}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <MeasureStats groups={groups} />
          </Panel>
          <div className="tool-actions">
            <button disabled={!url} onClick={exportPNG}>
              PNG
            </button>
            <button disabled={!url} onClick={exportPDF}>
              PDF
            </button>
            <button onClick={exportCSV}>CSV</button>
          </div>
        </>
      )}
    </div>
  );
}
