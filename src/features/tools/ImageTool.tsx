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
  csv,
  download,
  report,
  ColorField,
} from "./ui";
import {
  distance,
  measure,
  colorCoverage,
  type Shape,
  type XY,
} from "./geometry";
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
};
export default function ImageTool({ gel = false }: { gel?: boolean }) {
  const ctx = useContext(ToolContext)!,
    t = useText();
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
    [redo, setRedo] = useState<ImageData[]>([]);
  const svgRef = useRef<SVGSVGElement>(null),
    groupRef = useRef<SVGGElement>(null),
    drag = useRef<{
      start: XY;
      original: Shape | null;
      handle: number | null;
    } | null>(null),
    imageRef = useRef<HTMLImageElement | null>(null);
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
  const commit = (next: ImageData) => {
    setHistory((h) => [...h, d].slice(-50));
    setRedo([]);
    set(next);
  };
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (
        (e.ctrlKey || e.metaKey) &&
        !["INPUT", "TEXTAREA"].includes((e.target as HTMLElement)?.tagName)
      ) {
        if (e.key === "z") {
          e.preventDefault();
          setHistory((h) => {
            if (!h.length) return h;
            setRedo((r) => [...r, d]);
            set(h[h.length - 1]);
            return h.slice(0, -1);
          });
        }
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [d, set]);
  const scale =
      d.calibration === "pixel"
        ? d.unitsPerPixel
        : d.known > 0 && d.reference.length === 2
        ? d.known / distance(d.reference[0], d.reference[1])
        : 0,
    unit = scale > 0 ? d.unit : "px",
    actualScale = scale > 0 ? scale : 1;
  const crop = d.crop ?? { x: 0, y: 0, width: d.width, height: d.height },
    sw = d.rotation % 180 ? crop.height : crop.width,
    sh = d.rotation % 180 ? crop.width : crop.height;
  const transform = `translate(${sw / 2} ${sh / 2}) rotate(${
    d.rotation
  }) scale(${d.flipX ? -1 : 1} ${d.flipY ? -1 : 1}) translate(${
    -crop.width / 2 - crop.x
  } ${-crop.height / 2 - crop.y})`;
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
    event.currentTarget.setPointerCapture(event.pointerId);
    const p = point(event),
      target = event.target as SVGElement,
      id = target.getAttribute("data-shape"),
      handle = target.getAttribute("data-handle");
    if (tool === "color") {
      addColor(p);
      return;
    }
    if (tool === "select" && id) {
      setSelected(id);
      drag.current = {
        start: p,
        original: d.shapes.find((s) => s.id === id) ?? null,
        handle: handle === null ? null : Number(handle),
      };
      setDraft([p]);
      return;
    }
    if (tool === "select") {
      setSelected("");
      return;
    }
    drag.current = { start: p, original: null, handle: null };
    setDraft([p]);
  };
  const move = (event: PointerEvent<SVGSVGElement>) => {
    if (!drag.current) return;
    const p = point(event);
    if (tool === "freehand")
      setDraft((points) => (points.length < 2000 ? [...points, p] : points));
    else setDraft([drag.current.start, p]);
  };
  const up = (event: PointerEvent<SVGSVGElement>) => {
    const active = drag.current;
    if (!active) return;
    const end = point(event),
      points = tool === "freehand" ? [...draft, end] : [active.start, end];
    drag.current = null;
    setDraft([]);
    if (tool === "select" && active.original) {
      const original = active.original,
        dx = end.x - active.start.x,
        dy = end.y - active.start.y;
      commit({
        ...d,
        shapes: d.shapes.map((s) =>
          s.id === original.id
            ? {
                ...s,
                points: original.points.map((p, i) =>
                  active.handle !== null
                    ? i === active.handle
                      ? end
                      : p
                    : { x: p.x + dx, y: p.y + dy }
                ),
              }
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
    if (distance(active.start, end) < 1 && tool !== "text") return;
    const shape: Shape = {
      id: crypto.randomUUID(),
      kind: (tool === "text" ? "text" : tool) as Shape["kind"],
      name: `${t(
        (
          {
            line: "선",
            rectangle: "사각형",
            ellipse: "타원",
            freehand: "자유형",
            text: "텍스트",
          } as Record<string, string>
        )[tool] ?? tool,
        tool
      )} ${d.shapes.length + 1}`,
      color: gel ? "#dc2626" : "#2563eb",
      points,
      text: tool === "text" ? t("라벨", "Label") : undefined,
    };
    commit({ ...d, shapes: [...d.shapes, shape] });
    setSelected(shape.id);
    setTool("select");
  };
  const shapeElement = (s: Shape, draftShape = false) => {
    const a = s.points[0],
      b = s.points[1] ?? a;
    if (!a) return null;
    const props = {
      "data-shape": draftShape ? undefined : s.id,
      stroke: s.color,
      strokeWidth: Math.max(1, d.width / 500),
      fill: "none",
      vectorEffect: "non-scaling-stroke" as const,
    };
    const info = measure(s, actualScale);
    const label = gel
      ? s.name
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
      : `${format(info.area)} ${unit}²`;
    return (
      <g key={s.id}>
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
        ) : null}
        <text
          data-shape={s.id}
          x={a.x}
          y={a.y - 8}
          fill={s.color}
          fontSize={Math.max(12, d.width / 55)}
        >
          {label}
        </text>
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
  const selectedShape = d.shapes.find((s) => s.id === selected),
    selectedMeasure = selectedShape
      ? measure(selectedShape, actualScale)
      : null;
  const editShape = (patch: Partial<Shape>) =>
    commit({
      ...d,
      shapes: d.shapes.map((s) => (s.id === selected ? { ...s, ...patch } : s)),
    });
  const updateColor = (color: string, tolerance: number) => {
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
    editShape({ color, tolerance, ...coverage });
  };
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
      clone.querySelectorAll("[data-handle]").forEach((el) => el.remove());
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
        if (out) await download(out, "measurement.png", "image/png");
      } finally {
        URL.revokeObjectURL(u);
      }
    } catch (e) {
      setError(String(e));
    }
  };
  return (
    <div>
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
              try {
                const temp = URL.createObjectURL(file),
                  img = new Image();
                img.src = temp;
                await img.decode();
                if (img.width * img.height > 40e6)
                  throw Error("Maximum 40 megapixels");
                const asset = await ctx.repo.putImage(ctx.doc.id, file);
                URL.revokeObjectURL(temp);
                commit({
                  ...d,
                  asset,
                  width: img.width,
                  height: img.height,
                  shapes: [],
                  crop: null,
                  rotation: 0,
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
                    commit({
                      ...d,
                      [d.calibration === "reference"
                        ? "known"
                        : "unitsPerPixel"]: Number(v),
                    })
                  }
                />
                <Select
                  label={t("단위", "Unit")}
                  value={d.unit}
                  onChange={(unit) => commit({ ...d, unit })}
                  options={["m", "cm", "mm", "µm"]}
                />
                <Field
                  label={t("스케일 바 길이", "Scale bar length")}
                  value={d.bar}
                  onChange={(v) => commit({ ...d, bar: Number(v) })}
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
              {(gel
                ? ["select", "line", "rectangle", "text", "crop"]
                : [
                    "select",
                    "scale",
                    "line",
                    "rectangle",
                    "ellipse",
                    "freehand",
                    "color",
                    "text",
                    "crop",
                  ]
              ).map((k) => (
                <button
                  key={k}
                  className={tool === k ? "primary" : ""}
                  aria-pressed={tool === k}
                  onClick={() => setTool(k)}
                >
                  {
                    (
                      {
                        select: t("선택", "Select"),
                        scale: t("기준선", "Reference"),
                        line: gel ? "Band" : t("선", "Line"),
                        rectangle: gel ? "Lane" : t("사각형", "Rectangle"),
                        ellipse: t("타원", "Ellipse"),
                        freehand: t("자유형", "Freehand"),
                        color: t("색상", "Color"),
                        text: t("텍스트", "Text"),
                        crop: t("자르기", "Crop"),
                      } as Record<string, string>
                    )[k]
                  }
                </button>
              ))}
              <button
                disabled={!history.length}
                onClick={() => {
                  setRedo([...redo, d]);
                  set(history[history.length - 1]);
                  setHistory(history.slice(0, -1));
                }}
              >
                {t("실행 취소", "Undo")}
              </button>
              <button
                disabled={!redo.length}
                onClick={() => {
                  setHistory([...history, d]);
                  set(redo[redo.length - 1]);
                  setRedo(redo.slice(0, -1));
                }}
              >
                {t("다시 실행", "Redo")}
              </button>
            </div>
            <div className="tool-actions">
              <button onClick={() => setZoom(Math.max(0.25, zoom - 0.25))}>
                −
              </button>
              <span>{Math.round(zoom * 100)}%</span>
              <button onClick={() => setZoom(Math.min(4, zoom + 0.25))}>
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
                  commit({
                    ...d,
                    tolerance: Math.max(0, Math.min(100, Number(v))),
                  })
                }
              />
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
              onChange={setTool}
              options={[
                ["select", t("선택 / 이동", "Select / Move")],
                ...(!gel
                  ? ([["scale", t("기준선", "Reference")]] as const)
                  : []),
                ["line", gel ? "Band" : t("선", "Line")],
                ["rectangle", gel ? "Lane" : t("사각형", "Rectangle")],
                ...(!gel
                  ? ([
                      ["ellipse", t("타원", "Ellipse")],
                      ["freehand", t("자유형", "Freehand")],
                      ["color", t("색상", "Color")],
                    ] as const)
                  : []),
                ["text", t("텍스트", "Text")],
                ["crop", t("자르기", "Crop")],
              ]}
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
                setDraft([]);
              }}
              role="img"
              aria-label={t("측정 이미지 편집기", "Measurement image editor")}
            >
              <g ref={groupRef} transform={transform}>
                <image href={url} width={d.width} height={d.height} />
                {d.shapes.map((s) => shapeElement(s))}
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
                {draft.length > 1 &&
                  shapeElement(
                    {
                      id: "draft",
                      kind: (["scale", "crop", "select"].includes(tool)
                        ? "line"
                        : tool) as Shape["kind"],
                      name: "",
                      color: "#f97316",
                      points: draft,
                    },
                    true
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
              onChange={(name) => editShape({ name })}
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
                    Math.max(0, Math.min(100, Number(value)))
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
                    editShape({
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
                    });
                }}
              />
            )}
            {selectedShape.kind === "text" && (
              <Field
                type="text"
                label={t("텍스트", "Text")}
                value={selectedShape.text ?? ""}
                onChange={(text) => editShape({ text })}
              />
            )}{" "}
            {selectedShape.points.length === 2 &&
              selectedShape.kind !== "line" &&
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
                    editShape({ points: [a, b] });
                  }}
                />
              ))}
          </div>
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
              const bands = ladder?.data.bands as
                | { label: string; size: number }[]
                | undefined;
              if (bands)
                commit({
                  ...d,
                  shapes: [
                    ...d.shapes,
                    ...bands.map((b, i) => ({
                      id: crypto.randomUUID(),
                      kind: "line" as const,
                      name: `${b.label} ${ladder?.data.unit}`,
                      color: "#dc2626",
                      points: [
                        {
                          x: d.width * 0.1,
                          y:
                            d.height *
                            (0.1 + (0.8 * i) / Math.max(1, bands.length - 1)),
                        },
                        {
                          x: d.width * 0.2,
                          y:
                            d.height *
                            (0.1 + (0.8 * i) / Math.max(1, bands.length - 1)),
                        },
                      ],
                    })),
                  ],
                });
            }}
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
                    <th>{t("결과", "Result")}</th>
                    <th>{t("표시", "Visibility")}</th>
                  </tr>
                </thead>
                <tbody>
                  {d.shapes.map((s) => {
                    const result = measure(s, actualScale),
                      visible = s.points.some(
                        (p) =>
                          p.x >= crop.x &&
                          p.x <= crop.x + crop.width &&
                          p.y >= crop.y &&
                          p.y <= crop.y + crop.height
                      );
                    return (
                      <tr key={s.id}>
                        <td>
                          <button onClick={() => setSelected(s.id)}>
                            {s.name}
                          </button>
                        </td>
                        <td>
                          {s.kind === "color"
                            ? `${format(
                                (s.areaFraction ?? s.fraction ?? 0) *
                                  d.width *
                                  d.height *
                                  actualScale ** 2
                              )} ${unit}² · ${format(
                                (s.fraction ?? 0) * 100
                              )}% ≈`
                            : s.kind === "text"
                            ? s.text
                            : s.kind === "freehand"
                            ? `${format(result.area)} ${unit}² · ${t(
                                "둘레",
                                "Perimeter"
                              )} ${format(result.length)} ${unit}`
                            : result.area != null
                            ? `${format(result.area)} ${unit}²`
                            : `${format(result.length)} ${unit}`}
                        </td>
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
          </Panel>
          <div className="tool-actions">
            <button disabled={!url} onClick={exportPNG}>
              PNG
            </button>
            <button
              disabled={!url}
              onClick={async () => {
                try {
                  await report({
                    title: ctx.doc.title,
                    lines: [
                      actualScale > 0
                        ? `${t("스케일", "Scale")}: ${actualScale} ${unit}/px`
                        : "px",
                      `${t("원본 이미지", "Source image")}: ${d.width} × ${
                        d.height
                      } px`,
                    ],
                    svg: svgRef.current,
                    headers: [t("이름", "Name"), t("결과", "Result")],
                    rows: d.shapes.map((shape) => {
                      const result = measure(shape, actualScale);
                      return [
                        shape.name,
                        shape.kind === "text"
                          ? shape.text ?? ""
                          : shape.kind === "color"
                          ? `${format(
                              (shape.areaFraction ?? 0) *
                                d.width *
                                d.height *
                                actualScale ** 2
                            )} ${unit}² ≈`
                          : result.area != null
                          ? `${format(result.area)} ${unit}²`
                          : `${format(result.length)} ${unit}`,
                      ];
                    }),
                    name: "image-measurement.pdf",
                  });
                } catch (e) {
                  setError(String(e));
                }
              }}
            >
              PDF
            </button>
            <button
              onClick={() =>
                download(
                  csv([
                    ["Name", "Length", "Width", "Height", "Area", "Unit"],
                    ...d.shapes.map((s) => {
                      const r = measure(s, actualScale);
                      return [
                        s.name,
                        r.length ?? "",
                        r.width ?? "",
                        r.height ?? "",
                        s.kind === "color"
                          ? (s.areaFraction ?? s.fraction ?? 0) *
                            d.width *
                            d.height *
                            actualScale ** 2
                          : r.area ?? "",
                        unit,
                      ];
                    }),
                  ]),
                  "measurements.csv",
                  "text/csv"
                )
              }
            >
              CSV
            </button>
          </div>
        </>
      )}
    </div>
  );
}
