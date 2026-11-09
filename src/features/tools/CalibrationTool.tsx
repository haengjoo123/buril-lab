import { useId, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  Check,
  ChevronDown,
  Download,
  Plus,
  Trash2,
  Upload,
} from "lucide-react";
import { useIsDesktop } from "../../hooks/useIsDesktop";
import { fitCalibration, type Model } from "./calibration";
import { parseCsvText } from "../../utils/csvFiles";
import {
  useToolData,
  useText,
  Field,
  Select,
  CheckButton,
  ErrorMessage,
  calculate,
  format,
  download,
  csv,
  report,
} from "./ui";

type Standard = { x: string; y: string; excluded: boolean };
type View = "standards" | "analysis";

export default function CalibrationTool() {
  const t = useText();
  const id = useId();
  const plotRef = useRef<SVGSVGElement>(null);
  const tabsRef = useRef<HTMLDivElement>(null);
  const wide = useIsDesktop("(min-width: 1100px)");
  const [view, setView] = useState<View>("standards");
  const [d, set] = useToolData({
    model: "linear" as Model,
    standards: [
      { x: "0", y: "1", excluded: false },
      { x: "1", y: "3", excluded: false },
      { x: "2", y: "5", excluded: false },
    ] as Standard[],
    samples: [
      { name: t("시료 1", "Sample 1"), direction: "inverse", input: "6" },
    ],
    xLabel: t("농도", "Concentration"),
    yLabel: t("신호", "Signal"),
    xUnit: "",
    yUnit: "",
    logX: false,
    logY: false,
  });
  const [pasted, setPasted] = useState("");
  const [error, setError] = useState("");
  const [hasHeader, setHasHeader] = useState(false);
  const fit = useMemo(
    () =>
      calculate(() =>
        fitCalibration(
          d.standards.map((row) => ({
            x: row.x.trim() === "" ? NaN : Number(row.x),
            y: row.y.trim() === "" ? NaN : Number(row.y),
            excluded: row.excluded,
          })),
          d.model
        )
      ),
    [d.standards, d.model]
  );
  const f = fit.value;
  const usedRows = d.standards
    .map((row, index) => ({ ...row, index }))
    .filter((row) => !row.excluded);
  const points = usedRows
    .filter((p) => p.x.trim() && p.y.trim())
    .map((p) => ({ x: Number(p.x), y: Number(p.y) }))
    .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  const positive = points.filter(
    (p) => (!d.logX || p.x > 0) && (!d.logY || p.y > 0)
  );
  const logWarning = positive.length !== points.length;
  const tx = (x: number) => (d.logX ? Math.log10(x) : x);
  const ty = (y: number) => (d.logY ? Math.log10(y) : y);
  const rawMin = positive.length
    ? Math.min(...positive.map((p) => tx(p.x)))
    : 0;
  const rawMax = positive.length
    ? Math.max(...positive.map((p) => tx(p.x)))
    : 1;
  const predictions =
    f && positive.length
      ? Array.from({ length: 150 }, (_, i) => {
          const a = rawMin + ((rawMax - rawMin) * i) / 149;
          const x = d.logX ? 10 ** a : a;
          return { x, y: f.predict(x) };
        }).filter((p) => Number.isFinite(p.y) && (!d.logY || p.y > 0))
      : [];
  const ys = [...positive, ...predictions].map((p) => ty(p.y));
  const rawYMin = ys.length ? Math.min(...ys) : 0;
  const rawYMax = ys.length ? Math.max(...ys) : 1;
  const xPad = (rawMax - rawMin || 1) * 0.05;
  const yPad = (rawYMax - rawYMin || 1) * 0.1;
  const xmin = rawMin - xPad,
    xmax = rawMax + xPad;
  const ymin = rawYMin - yPad,
    ymax = rawYMax + yPad;
  const px = (x: number) => 64 + ((tx(x) - xmin) / (xmax - xmin)) * 394;
  const py = (y: number) => 260 - ((ty(y) - ymin) / (ymax - ymin)) * 220;
  const curve = predictions.map((p) => `${px(p.x)},${py(p.y)}`).join(" ");
  const samplePoints = f
    ? d.samples.flatMap((sample) => {
        if (!sample.input.trim() || !Number.isFinite(Number(sample.input)))
          return [];
        const input = Number(sample.input);
        const x = sample.direction === "inverse" ? f.inverse(input) : input;
        const y = sample.direction === "inverse" ? input : f.predict(input);
        return Number.isFinite(x) &&
          Number.isFinite(y) &&
          x >= f.min &&
          x <= f.max &&
          (!d.logX || x > 0) &&
          (!d.logY || y > 0)
          ? [{ x, y, name: sample.name }]
          : [];
      })
    : [];
  const axis = (label: string, unit: string) =>
    unit ? `${label} (${unit})` : label;
  const tick = (value: number) =>
    Math.abs(value) < 1e-12 ? "0" : String(Number(value.toPrecision(3)));
  const selectView = (next: View) => {
    setView(next);
    tabsRef.current?.scrollIntoView?.({ block: "start" });
  };
  const importRows = (text: string) => {
    try {
      const rows = parseCsvText(
        text.trim(),
        text.includes("\t") ? "\t" : text.includes(";") ? ";" : ","
      ).map((row) => row.map((value) => value.trim()));
      if (!rows.length || rows.some((row) => row.length !== 2))
        throw Error("Exactly two columns required");
      if (hasHeader) {
        set({
          ...d,
          xLabel: rows[0][0],
          yLabel: rows[0][1],
          standards: rows.slice(1).map(([x, y]) => ({ x, y, excluded: false })),
        });
      } else
        set({
          ...d,
          standards: rows.map(([x, y]) => ({ x, y, excluded: false })),
        });
      setError("");
    } catch (e) {
      setError(String(e));
    }
  };
  const svgImage = async () => {
    const svg = plotRef.current;
    if (!svg) return;
    const blob = new Blob([new XMLSerializer().serializeToString(svg)], {
      type: "image/svg+xml",
    });
    const url = URL.createObjectURL(blob);
    try {
      const image = new Image();
      image.src = url;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = 1440;
      canvas.height = 1050;
      const c = canvas.getContext("2d")!;
      c.fillStyle = "white";
      c.fillRect(0, 0, canvas.width, canvas.height);
      c.drawImage(image, 0, 0, canvas.width, canvas.height);
      const out = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve)
      );
      if (out) await download(out, "calibration.png", "image/png");
    } catch (e) {
      setError(String(e));
    } finally {
      URL.revokeObjectURL(url);
    }
  };

  return (
    <div className="tool-calibration">
      <div className="tool-calibration-model">
        <Select
          label={t("적합 모델", "Fit model")}
          value={d.model}
          onChange={(model) => set({ ...d, model: model as Model })}
          options={["linear", "origin", "exponential", "hill"]}
        />
        <span className="tool-muted">
          {d.model === "hill"
            ? "y = bottom + (top − bottom) / (1 + (K/x)ⁿ)"
            : d.model === "exponential"
            ? "y = a · exp(bx)"
            : d.model === "origin"
            ? "y = ax"
            : "y = ax + b"}
        </span>
      </div>
      {!wide && (
        <div
          className="tool-calibration-tabs"
          role="tablist"
          aria-label={t("검량선 작업", "Calibration workspace")}
          ref={tabsRef}
          onKeyDown={(event) => {
            if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key))
              return;
            event.preventDefault();
            const next =
              event.key === "Home"
                ? "standards"
                : event.key === "End"
                ? "analysis"
                : view === "standards"
                ? "analysis"
                : "standards";
            setView(next);
            event.currentTarget
              .querySelector<HTMLButtonElement>(`[id="${id}-${next}-tab"]`)
              ?.focus();
          }}
        >
          {(["standards", "analysis"] as const).map((key) => (
            <button
              key={key}
              type="button"
              role="tab"
              id={`${id}-${key}-tab`}
              aria-selected={view === key}
              aria-controls={`${id}-${key}`}
              tabIndex={view === key ? 0 : -1}
              onClick={() => selectView(key)}
            >
              {key === "standards"
                ? t("표준값 입력", "Standards")
                : t("그래프·시료", "Curve & samples")}
            </button>
          ))}
        </div>
      )}
      <div className="tool-calibration-layout">
        <section
          className="tool-calibration-standards"
          id={`${id}-standards`}
          role={wide ? undefined : "tabpanel"}
          aria-labelledby={wide ? undefined : `${id}-standards-tab`}
          hidden={!wide && view !== "standards"}
        >
          <div className="tool-calibration-section-heading">
            <h2>{t("표준값", "Standards")}</h2>
            <span className="tool-muted">
              {usedRows.length}
              {t("개 사용", " included")}
            </span>
          </div>
          <table className="tool-calibration-table">
            <colgroup>
              <col className="calibration-row-number" />
              <col />
              <col />
              <col className="calibration-row-action" />
              <col className="calibration-row-action" />
            </colgroup>
            <thead>
              <tr>
                <th scope="col">#</th>
                <th scope="col" title={axis(d.xLabel, d.xUnit)}>
                  <span>X · {axis(d.xLabel, d.xUnit)}</span>
                </th>
                <th scope="col" title={axis(d.yLabel, d.yUnit)}>
                  <span>Y · {axis(d.yLabel, d.yUnit)}</span>
                </th>
                <th scope="col">{t("사용", "Use")}</th>
                <th scope="col">
                  <span className="tool-calibration-sr-only">
                    {t("삭제", "Delete")}
                  </span>
                </th>
              </tr>
            </thead>
            <tbody>
              {d.standards.map((row, i) => {
                const invalid =
                  !row.excluded &&
                  ([row.x, row.y].some(
                    (v) => !v.trim() || !Number.isFinite(Number(v))
                  ) ||
                    usedRows.some(
                      (r) =>
                        r.index !== i &&
                        r.x.trim() &&
                        row.x.trim() &&
                        Number(r.x) === Number(row.x)
                    ) ||
                    (d.model === "exponential" && Number(row.y) <= 0) ||
                    (d.model === "hill" && Number(row.x) <= 0));
                return (
                  <tr
                    key={i}
                    className={`${row.excluded ? "is-excluded" : ""} ${
                      invalid ? "is-invalid" : ""
                    }`}
                  >
                    <th scope="row">{i + 1}</th>
                    {(["x", "y"] as const).map((k) => (
                      <td key={k}>
                        <input
                          type="text"
                          inputMode="decimal"
                          autoComplete="off"
                          enterKeyHint="next"
                          aria-label={`${t("표준", "Standard")} ${i + 1} ${k}`}
                          aria-invalid={invalid || undefined}
                          value={row[k]}
                          onChange={(event) =>
                            set({
                              ...d,
                              standards: d.standards.map((r, j) =>
                                j === i ? { ...r, [k]: event.target.value } : r
                              ),
                            })
                          }
                        />
                      </td>
                    ))}
                    <td>
                      <button
                        type="button"
                        role="checkbox"
                        aria-checked={!row.excluded}
                        aria-label={`${t("표준", "Standard")} ${i + 1} ${t(
                          "적합에 포함",
                          "included in fit"
                        )}`}
                        className="tool-calibration-include"
                        onClick={() =>
                          set({
                            ...d,
                            standards: d.standards.map((r, j) =>
                              j === i ? { ...r, excluded: !r.excluded } : r
                            ),
                          })
                        }
                      >
                        <span>
                          {!row.excluded && <Check size={15} strokeWidth={3} />}
                        </span>
                      </button>
                    </td>
                    <td>
                      <button
                        type="button"
                        className="tool-calibration-icon"
                        aria-label={`${t("표준 삭제", "Delete standard")} ${
                          i + 1
                        }`}
                        onClick={() =>
                          set({
                            ...d,
                            standards: d.standards.filter((_, j) => j !== i),
                          })
                        }
                      >
                        <Trash2 size={16} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <button
            className="tool-calibration-add"
            onClick={() =>
              set({
                ...d,
                standards: [...d.standards, { x: "", y: "", excluded: false }],
              })
            }
          >
            <Plus size={17} />
            {t("표준 추가", "Add standard")}
          </button>
          <ErrorMessage message={fit.error} />
          <details className="tool-calibration-disclosure">
            <summary>
              <Upload size={17} />
              <span>{t("붙여넣기·CSV 가져오기", "Paste or import CSV")}</span>
              <ChevronDown size={16} />
            </summary>
            <div className="tool-calibration-detail-body">
              <label className="tool-field">
                <span>{t("두 열 붙여넣기", "Paste two columns")}</span>
                <textarea
                  value={pasted}
                  onChange={(event) => setPasted(event.target.value)}
                  placeholder={"0\t1\n1\t3\n2\t5"}
                />
              </label>
              <CheckButton checked={hasHeader} onChange={setHasHeader}>
                {t("첫 행은 열 이름", "First row contains column names")}
              </CheckButton>
              <div className="tool-actions">
                <button onClick={() => importRows(pasted)}>
                  {t("표준값 적용", "Apply standards")}
                </button>
                <label className="tool-button tool-calibration-file">
                  <Upload size={16} />
                  {t("CSV 파일 선택", "Choose CSV")}
                  <input
                    type="file"
                    aria-label={t("CSV 가져오기", "Import CSV")}
                    accept=".csv,text/csv"
                    onChange={async (event) => {
                      try {
                        const file = event.target.files?.[0];
                        if (file) importRows(await file.text());
                      } catch (e) {
                        setError(String(e));
                      }
                      event.target.value = "";
                    }}
                  />
                </label>
              </div>
              <p className="tool-muted">
                {t(
                  "X, Y 순서로 입력하세요. 가져온 값으로 현재 표준값을 바꿉니다.",
                  "Enter X, then Y. Imported values replace the current standards."
                )}
              </p>
            </div>
          </details>
          <details className="tool-calibration-disclosure">
            <summary>
              <span>{t("축 이름·단위 설정", "Axis names & units")}</span>
              <ChevronDown size={16} />
            </summary>
            <div className="tool-calibration-detail-body tool-calibration-axis-fields">
              <Field
                type="text"
                label={t("X축 이름", "X axis")}
                value={d.xLabel}
                onChange={(xLabel) => set({ ...d, xLabel })}
              />
              <Field
                type="text"
                label={t("X 단위", "X unit")}
                value={d.xUnit}
                onChange={(xUnit) => set({ ...d, xUnit })}
              />
              <Field
                type="text"
                label={t("Y축 이름", "Y axis")}
                value={d.yLabel}
                onChange={(yLabel) => set({ ...d, yLabel })}
              />
              <Field
                type="text"
                label={t("Y 단위", "Y unit")}
                value={d.yUnit}
                onChange={(yUnit) => set({ ...d, yUnit })}
              />
            </div>
          </details>
          {!wide && (
            <button
              className="primary tool-calibration-next"
              onClick={() => selectView("analysis")}
            >
              {t("그래프·시료 계산", "View curve & calculate samples")}
              <ArrowRight size={18} />
            </button>
          )}
        </section>
        <section
          className="tool-calibration-analysis"
          id={`${id}-analysis`}
          role={wide ? undefined : "tabpanel"}
          aria-labelledby={wide ? undefined : `${id}-analysis-tab`}
          hidden={!wide && view !== "analysis"}
        >
          <div className="tool-calibration-section-heading">
            <h2>{t("검량선", "Calibration curve")}</h2>
            <div className="tool-calibration-scale">
              <button
                type="button"
                aria-pressed={d.logX}
                onClick={() => set({ ...d, logX: !d.logX })}
              >
                log X
              </button>
              <button
                type="button"
                aria-pressed={d.logY}
                onClick={() => set({ ...d, logY: !d.logY })}
              >
                log Y
              </button>
            </div>
          </div>
          {!f && (
            <div className="tool-calibration-empty">
              <ErrorMessage message={fit.error} />
              <p className="tool-muted">
                {t(
                  "표준값을 수정하면 그래프와 시료 결과가 표시됩니다.",
                  "Correct the standards to see the curve and sample results."
                )}
              </p>
              {!wide && (
                <button onClick={() => selectView("standards")}>
                  {t("표준값 수정", "Edit standards")}
                </button>
              )}
            </div>
          )}
          <div hidden={!f || !positive.length}>
            <svg
              ref={plotRef}
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 480 350"
              className="tool-plot tool-calibration-plot"
              role="img"
              aria-label={t("검량선 그래프", "Calibration graph")}
            >
              <rect width="480" height="350" fill="white" />
              <defs>
                <clipPath id={`${id}-plot-clip`}>
                  <rect x="64" y="40" width="394" height="220" />
                </clipPath>
              </defs>
              {Array.from({ length: 5 }, (_, i) => {
                const fraction = i / 4,
                  x = 64 + 394 * fraction,
                  y = 260 - 220 * fraction;
                const xv = xmin + (xmax - xmin) * fraction,
                  yv = ymin + (ymax - ymin) * fraction;
                return (
                  <g key={i}>
                    <path
                      d={`M64 ${y} H458 M${x} 40 V260`}
                      fill="none"
                      stroke="#e2e8f0"
                      className="tool-calibration-gridline"
                    />
                    <text
                      x={x}
                      y="284"
                      textAnchor="middle"
                      fill="#475569"
                      fontSize="16"
                    >
                      {tick(d.logX ? 10 ** xv : xv)}
                    </text>
                    <text
                      x="54"
                      y={y + 5}
                      textAnchor="end"
                      fill="#475569"
                      fontSize="16"
                    >
                      {tick(d.logY ? 10 ** yv : yv)}
                    </text>
                  </g>
                );
              })}
              <path d="M64 40 V260 H458" fill="none" stroke="#94a3b8" />
              <g clipPath={`url(#${id}-plot-clip)`}>
                {curve && (
                  <polyline
                    points={curve}
                    fill="none"
                    stroke="#2563eb"
                    strokeWidth="3"
                  />
                )}
                {positive.map((p, i) => (
                  <circle
                    key={i}
                    cx={px(p.x)}
                    cy={py(p.y)}
                    r="5"
                    fill="#0f766e"
                    stroke="white"
                    strokeWidth="1.5"
                  />
                ))}
                {samplePoints.map((p, i) => (
                  <rect
                    key={i}
                    x={px(p.x) - 5}
                    y={py(p.y) - 5}
                    width="10"
                    height="10"
                    fill="#d97706"
                    stroke="white"
                    strokeWidth="1.5"
                    transform={`rotate(45 ${px(p.x)} ${py(p.y)})`}
                  >
                    <title>
                      {p.name}: X = {format(p.x)}, Y = {format(p.y)}
                    </title>
                  </rect>
                ))}
              </g>
              <text
                x="261"
                y="313"
                textAnchor="middle"
                fill="#0f172a"
                fontSize="16"
              >
                {axis(d.xLabel, d.xUnit)}
              </text>
              <text x="64" y="22" fill="#0f172a" fontSize="16">
                {axis(d.yLabel, d.yUnit)}
              </text>
              <g fontSize="14" fill="#475569">
                <circle cx="128" cy="338" r="4" fill="#0f766e" />
                <text x="138" y="343">
                  {t("표준값", "Standards")}
                </text>
                <rect
                  x="243"
                  y="334"
                  width="8"
                  height="8"
                  fill="#d97706"
                  transform="rotate(45 247 338)"
                />
                <text x="259" y="343">
                  {t("시료 계산값", "Calculated samples")}
                </text>
              </g>
            </svg>
          </div>
          {logWarning && (
            <p role="status" className="tool-error">
              {t(
                "로그 축에서 0 이하 점은 표시할 수 없습니다. 원자료와 적합에는 유지됩니다.",
                "Non-positive points cannot be displayed on log axes. Original data and fitting are unchanged."
              )}
            </p>
          )}
          {f && (
            <>
              <div className="tool-calibration-fit">
                <p className="tool-calibration-equation">{f.equation}</p>
                <dl>
                  {f.r2 !== null && (
                    <div>
                      <dt>R²</dt>
                      <dd>{format(f.r2)}</dd>
                    </div>
                  )}
                  <div>
                    <dt>RMSE</dt>
                    <dd>{format(f.rmse)}</dd>
                  </div>
                </dl>
              </div>
              {f.r2 !== null && f.r2 < 0.9 && (
                <p role="status" className="tool-error">
                  {t(
                    "적합도가 낮습니다. 표준값과 모델을 확인한 뒤 결과를 사용하세요.",
                    "Low fit quality. Review standards and model before using results."
                  )}
                </p>
              )}
              <details className="tool-calibration-disclosure">
                <summary>
                  <span>{t("잔차·적합 방법", "Residuals & fit method")}</span>
                  <ChevronDown size={16} />
                </summary>
                <div className="tool-calibration-detail-body">
                  <p className="tool-muted">
                    {d.model === "exponential"
                      ? t(
                          "로그 변환 회귀 · 적합도는 원래 Y 공간 기준",
                          "Log-transformed regression; fit quality in original Y space"
                        )
                      : d.model === "hill"
                      ? t(
                          "증가형 Hill · 다중 초기값 비선형 최소제곱",
                          "Increasing Hill; multistart nonlinear least squares"
                        )
                      : t(
                          "선형 최소제곱 · 잔차 = 측정 Y − 예측 Y",
                          "Linear least squares; residual = measured Y − predicted Y"
                        )}
                  </p>
                  <table>
                    <thead>
                      <tr>
                        <th scope="col">{t("표준", "Standard")}</th>
                        <th scope="col">{t("잔차", "Residual")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {f.residuals.map((r, i) => (
                        <tr key={i}>
                          <td>{(usedRows[i]?.index ?? i) + 1}</td>
                          <td>{format(r)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            </>
          )}
          <section className="tool-calibration-samples">
            <div className="tool-calibration-section-heading">
              <h2>{t("시료 계산", "Samples")}</h2>
              <span className="tool-muted">
                {t("입력 즉시 계산", "Live results")}
              </span>
            </div>
            {d.samples.map((sample, i) => {
              const inverse = sample.direction === "inverse";
              const hasInput = sample.input.trim() !== "";
              const input = Number(sample.input);
              const value =
                f && hasInput && Number.isFinite(input)
                  ? inverse
                    ? f.inverse(input)
                    : f.predict(input)
                  : undefined;
              const x = inverse ? value : input;
              const invalid =
                hasInput &&
                (!Number.isFinite(input) ||
                  (value !== undefined && !Number.isFinite(value)));
              const extrapolated =
                hasInput &&
                x != null &&
                Number.isFinite(x) &&
                f &&
                (x < f.min || x > f.max);
              return (
                <div className="tool-calibration-sample" key={i}>
                  <div className="tool-calibration-sample-heading">
                    <input
                      type="text"
                      aria-label={`${t("시료명", "Sample name")} ${i + 1}`}
                      value={sample.name}
                      onChange={(event) =>
                        set({
                          ...d,
                          samples: d.samples.map((r, j) =>
                            j === i ? { ...r, name: event.target.value } : r
                          ),
                        })
                      }
                    />
                    <button
                      className="tool-calibration-icon"
                      aria-label={`${t("시료 삭제", "Delete sample")} ${i + 1}`}
                      onClick={() =>
                        set({
                          ...d,
                          samples: d.samples.filter((_, j) => j !== i),
                        })
                      }
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                  <Select
                    label={t("계산 방향", "Direction")}
                    value={sample.direction}
                    onChange={(direction) =>
                      set({
                        ...d,
                        samples: d.samples.map((r, j) =>
                          j === i ? { ...r, direction } : r
                        ),
                      })
                    }
                    options={[
                      ["inverse", t("Y → X · 농도 역산", "Y → X · Inverse")],
                      ["forward", t("X → Y · 신호 예측", "X → Y · Predict")],
                    ]}
                  />
                  <div className="tool-calibration-conversion">
                    <Field
                      label={axis(
                        inverse ? d.yLabel : d.xLabel,
                        inverse ? d.yUnit : d.xUnit
                      )}
                      value={sample.input}
                      onChange={(input) =>
                        set({
                          ...d,
                          samples: d.samples.map((r, j) =>
                            j === i ? { ...r, input } : r
                          ),
                        })
                      }
                    />
                    <ArrowRight size={18} aria-hidden="true" />
                    <div className="tool-calibration-sample-result">
                      <span>{inverse ? d.xLabel : d.yLabel}</span>
                      <output
                        aria-label={`${sample.name} ${t("결과", "result")}`}
                      >
                        {value !== undefined && Number.isFinite(value)
                          ? format(value)
                          : "—"}
                        {value !== undefined && Number.isFinite(value) && (
                          <small>{inverse ? d.xUnit : d.yUnit}</small>
                        )}
                      </output>
                    </div>
                  </div>
                  {invalid && (
                    <ErrorMessage
                      message={t(
                        "이 범위에서 계산 또는 역산할 수 없습니다.",
                        "Cannot calculate or invert in this range."
                      )}
                    />
                  )}
                  {extrapolated && (
                    <p className="tool-calibration-extrapolation" role="status">
                      {t(
                        "표준 범위 밖 (외삽)",
                        "Outside standard range (extrapolation)"
                      )}
                    </p>
                  )}
                </div>
              );
            })}
            <button
              className="tool-calibration-add"
              onClick={() =>
                set({
                  ...d,
                  samples: [
                    ...d.samples,
                    {
                      name: `${t("시료", "Sample")} ${d.samples.length + 1}`,
                      direction: "inverse",
                      input: "",
                    },
                  ],
                })
              }
            >
              <Plus size={17} />
              {t("시료 추가", "Add sample")}
            </button>
          </section>
          <details className="tool-calibration-disclosure">
            <summary>
              <Download size={17} />
              <span>{t("결과 내보내기", "Export results")}</span>
              <ChevronDown size={16} />
            </summary>
            <div className="tool-actions tool-calibration-exports">
              <button
                onClick={() =>
                  download(
                    csv([
                      [d.xLabel, d.yLabel, "Excluded"],
                      ...d.standards.map((p) => [p.x, p.y, String(p.excluded)]),
                    ]),
                    "calibration.csv",
                    "text/csv"
                  )
                }
              >
                {t("표준 CSV", "Standards CSV")}
              </button>
              <button
                disabled={!f}
                onClick={() =>
                  download(
                    csv([
                      [
                        t("시료", "Sample"),
                        t("방향", "Direction"),
                        t("입력", "Input"),
                        t("결과", "Result"),
                      ],
                      ...d.samples.map((sample) => [
                        sample.name,
                        sample.direction,
                        sample.input,
                        sample.input.trim()
                          ? String(
                              sample.direction === "inverse"
                                ? f!.inverse(Number(sample.input))
                                : f!.predict(Number(sample.input))
                            )
                          : "",
                      ]),
                    ]),
                    "calibration-samples.csv",
                    "text/csv"
                  )
                }
              >
                {t("시료 CSV", "Samples CSV")}
              </button>
              <button disabled={!f || !positive.length} onClick={svgImage}>
                {t("그래프 PNG", "Graph PNG")}
              </button>
              <button
                disabled={!f}
                onClick={async () => {
                  try {
                    await report({
                      title: t("검량선 보고서", "Calibration report"),
                      lines: [
                        f?.equation ?? "",
                        `RMSE: ${format(f?.rmse)}`,
                        `${axis(d.xLabel, d.xUnit)} · ${axis(
                          d.yLabel,
                          d.yUnit
                        )}`,
                      ],
                      svg: positive.length ? plotRef.current : null,
                      headers: [d.xLabel, d.yLabel, t("제외", "Excluded")],
                      rows: d.standards.map((row) => [
                        row.x,
                        row.y,
                        row.excluded ? t("예", "Yes") : t("아니오", "No"),
                      ]),
                      name: "calibration.pdf",
                    });
                  } catch (e) {
                    setError(String(e));
                  }
                }}
              >
                {t("보고서 PDF", "Report PDF")}
              </button>
            </div>
          </details>
        </section>
      </div>
      <ErrorMessage message={error} />
    </div>
  );
}
