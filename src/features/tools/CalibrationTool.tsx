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
import {
  AmbiguousNumber,
  fitCalibration,
  parseSampleRows,
  parseStandardRows,
  replicateGroups,
  type DecimalMark,
  type Model,
} from "./calibration";
import { parseNumber } from "./format";
import type { Handoff } from "./handoff";
import { ChartFrame, Plot } from "./charts";
import { logTicks, niceTicks } from "./chartMath";
import {
  useToolData,
  useText,
  useUndo,
  useExportName,
  Field,
  NumberField,
  Select,
  CheckButton,
  CopyButton,
  ErrorMessage,
  HandoffBanner,
  IncompleteInput,
  calculate,
  format,
  download,
  csv,
  tsv,
  report,
} from "./ui";

type Standard = {
  x: string;
  y: string;
  excluded: boolean;
  /** Where the row came from, such as the plate well "A1". */
  label?: string;
};
type Sample = { name: string; direction: string; input: string };
type View = "standards" | "analysis";
type PasteTarget = "standards" | "samples";
interface Data {
  /**
   * Never "hill-decreasing": an app released before that model would fit such
   * a document as a straight line without saying so. The falling curve is
   * saved as "hill" with `hillDecreasing`, which those apps refuse with a
   * message instead.
   */
  model: Exclude<Model, "hill-decreasing">;
  hillDecreasing: boolean;
  standards: Standard[];
  samples: Sample[];
  xLabel: string;
  yLabel: string;
  xUnit: string;
  yUnit: string;
  logX: boolean;
  logY: boolean;
}
// Outside the component so a new document's standards keep one identity
// between renders and the fit is not recomputed on every keystroke elsewhere.
const defaultStandards: Standard[] = [
  { x: "0", y: "1", excluded: false },
  { x: "1", y: "3", excluded: false },
  { x: "2", y: "5", excluded: false },
];
const finite = (value: number | null | undefined): value is number =>
  value != null && Number.isFinite(value);
// The example a new document opens with. It is not the user's data: rows that
// arrive in bulk (a plate layout, pasted samples) take its place instead of
// joining it, so three made-up standards never end up in a real fit.
const isExample = {
  standards: (rows: Standard[]) =>
    rows.length === defaultStandards.length &&
    rows.every(
      (row, i) =>
        row.x === defaultStandards[i].x &&
        row.y === defaultStandards[i].y &&
        !row.excluded &&
        !row.label
    ),
  samples: (rows: Sample[]) =>
    rows.length === 1 &&
    rows[0].direction === "inverse" &&
    rows[0].input === "6" &&
    (rows[0].name === "시료 1" || rows[0].name === "Sample 1"),
};

export default function CalibrationTool() {
  const t = useText();
  const id = useId();
  const plotRef = useRef<SVGSVGElement>(null);
  const tabsRef = useRef<HTMLDivElement>(null);
  const wide = useIsDesktop("(min-width: 1100px)");
  const exportName = useExportName();
  const [undoBar, offerUndo] = useUndo();
  const [view, setView] = useState<View>("standards");
  const [d, set] = useToolData<Data>({
    model: "linear",
    hillDecreasing: false,
    standards: defaultStandards,
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
  const [pastedSamples, setPastedSamples] = useState("");
  const [error, setError] = useState("");
  const [pasteError, setPasteError] = useState<{
    target: PasteTarget;
    message: string;
  } | null>(null);
  // A pasted figure that reads two ways, waiting for the user to say which.
  const [ask, setAsk] = useState<{
    target: PasteTarget;
    text: string;
    example: string;
  } | null>(null);
  const [hasHeader, setHasHeader] = useState(false);
  const model: Model =
    d.model === "hill" && d.hillDecreasing ? "hill-decreasing" : d.model;
  const hill = model === "hill" || model === "hill-decreasing";
  const rows = useMemo(
    () =>
      d.standards.map((row, index) => {
        const x = String(row.x ?? ""),
          y = String(row.y ?? "");
        return {
          index,
          label: row.label,
          excluded: !!row.excluded,
          x,
          y,
          // "0,5" is read as 0.5; "1,000" is not guessed and stays invalid.
          xv: parseNumber(x),
          yv: parseNumber(y),
          blank: !x.trim() || !y.trim(),
        };
      }),
    [d.standards]
  );
  const fit = useMemo(
    () =>
      calculate(() => {
        const used = rows.filter((row) => !row.excluded);
        // An empty cell is a value still to come (a plate layout arrives with
        // every Y empty), not an error. It is not left out of the fit either:
        // nothing is fitted until the row is filled, switched off or deleted.
        if (used.some((row) => row.blank)) throw new IncompleteInput();
        return fitCalibration(
          used.map((row) => ({ x: row.xv ?? NaN, y: row.yv ?? NaN })),
          model
        );
      }),
    [rows, model]
  );
  const f = fit.value;
  const usedRows = rows.filter((row) => !row.excluded);
  const blankRows = usedRows.filter((row) => row.blank).length;
  // Every included row that is a pair of numbers. When there is a fit these
  // are exactly the fitted points, in the order of `f.residuals`.
  const points = usedRows.flatMap((row) =>
    row.xv != null && row.yv != null
      ? [{ x: row.xv, y: row.yv, index: row.index, label: row.label }]
      : []
  );
  const levels = replicateGroups(points);
  const replicated = levels.filter((group) => group.n > 1);
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
  const axis = (label: string, unit: string) =>
    unit ? `${label} (${unit})` : label;
  // One place decides what a sample's result is, so the screen, the graph, the
  // CSV and the report cannot disagree about what could be calculated or
  // extrapolated.
  const sampleResult = (sample: Sample) => {
    const inverse = sample.direction === "inverse";
    const text = String(sample.input ?? "");
    const hasInput = text.trim() !== "";
    const input = parseNumber(text);
    const value =
      f && input != null
        ? inverse
          ? f.inverse(input)
          : f.predict(input)
        : undefined;
    const x = inverse ? value : input ?? undefined,
      y = inverse ? input ?? undefined : value;
    const notNumber = hasInput && input == null;
    const invalid =
      notNumber || (value !== undefined && !Number.isFinite(value));
    const extrapolated = !!(f && finite(x) && (x < f.min || x > f.max));
    return { inverse, value, x, y, invalid, notNumber, extrapolated };
  };
  const sampleNote = (result: ReturnType<typeof sampleResult>) =>
    result.invalid
      ? t("계산 불가", "Cannot calculate")
      : result.extrapolated
      ? t("표준 범위 밖 (외삽)", "Outside standard range (extrapolation)")
      : "";
  const sampleMarks = f
    ? d.samples.flatMap((sample) => {
        const result = sampleResult(sample);
        return finite(result.x) &&
          finite(result.y) &&
          (!d.logX || result.x > 0) &&
          (!d.logY || result.y > 0)
          ? [
              {
                x: result.x,
                y: result.y,
                name: sample.name,
                extrapolated: result.extrapolated,
              },
            ]
          : [];
      })
    : [];
  // A sample far beyond the standards would squeeze them into a corner, so
  // the graph reaches at most one range-width past either end.
  const reach = rawMax - rawMin || 1;
  const drawnSamples = positive.length
    ? sampleMarks.filter(
        (p) => tx(p.x) >= rawMin - reach && tx(p.x) <= rawMax + reach
      )
    : [];
  const farSamples = sampleMarks.length - drawnSamples.length;
  const drawnExtrapolated = drawnSamples.filter((p) => p.extrapolated);
  const plotMin = Math.min(rawMin, ...drawnSamples.map((p) => tx(p.x))),
    plotMax = Math.max(rawMax, ...drawnSamples.map((p) => tx(p.x)));
  const trace = (from: number, to: number, steps: number) =>
    f && positive.length && to >= from
      ? Array.from({ length: steps }, (_, i) => {
          const a = from + ((to - from) * i) / (steps - 1);
          const x = d.logX ? 10 ** a : a;
          return { x, y: f.predict(x) };
        }).filter((p) => Number.isFinite(p.y) && (!d.logY || p.y > 0))
      : [];
  // The curve over the standards, and its continuation out to samples that
  // lie beyond them. The continuation is drawn dashed: nothing was measured
  // there.
  const predictions = trace(rawMin, rawMax, 150),
    before = plotMin < rawMin ? trace(plotMin, rawMin, 40) : [],
    after = plotMax > rawMax ? trace(rawMax, plotMax, 40) : [];
  const ys = [
    ...positive,
    ...predictions,
    ...before,
    ...after,
    ...drawnSamples,
  ].map((p) => ty(p.y));
  const rawYMin = ys.length ? Math.min(...ys) : 0;
  const rawYMax = ys.length ? Math.max(...ys) : 1;
  const xPad = (plotMax - plotMin || 1) * 0.05;
  const yPad = (rawYMax - rawYMin || 1) * 0.1;
  const xmin = plotMin - xPad,
    xmax = plotMax + xPad;
  const ymin = rawYMin - yPad,
    ymax = rawYMax + yPad;
  const px = (x: number) => 64 + ((tx(x) - xmin) / (xmax - xmin)) * 394;
  const py = (y: number) => 260 - ((ty(y) - ymin) / (ymax - ymin)) * 220;
  const line = (curve: { x: number; y: number }[]) =>
    curve.map((p) => `${px(p.x)},${py(p.y)}`).join(" ");
  // Residuals for the plot and the tables. Floating-point residue of an exact
  // fit (4e-16) is shown as the zero it is.
  const yScale = Math.max(...points.map((p) => Math.abs(p.y)), 0);
  const residuals = f
    ? points.map((p, i) => {
        const residual = f.residuals[i] ?? NaN;
        return {
          ...p,
          fitted: Number(f.predict(p.x).toPrecision(12)),
          residual: Math.abs(residual) <= 1e-12 * yScale ? 0 : residual,
        };
      })
    : [];
  const residualLimit =
    Math.max(...residuals.map((row) => Math.abs(row.residual)), 0) || 1;
  const residualHeaders = [
    t("표준", "Standard"),
    axis(d.xLabel, d.xUnit),
    t("측정 Y", "Measured Y"),
    t("적합 Y", "Fitted Y"),
    t("잔차", "Residual"),
  ];
  const residualRows = residuals.map((row) => [
    row.label ? `${row.index + 1} · ${row.label}` : String(row.index + 1),
    row.x,
    row.y,
    row.fitted,
    row.residual,
  ]);
  const replicateHeaders = [
    axis(d.xLabel, d.xUnit),
    "n",
    t("평균 Y", "Mean Y"),
    "SD",
    "CV (%)",
  ];
  const replicateRows = replicated.map((group) => [
    group.x,
    group.n,
    group.mean,
    group.sd ?? "",
    group.sd != null && group.mean !== 0
      ? Number(((group.sd / Math.abs(group.mean)) * 100).toPrecision(3))
      : "",
  ]);
  const sampleHeaders = [
    t("시료", "Sample"),
    t("방향", "Direction"),
    t("입력", "Input"),
    t("결과", "Result"),
    t("비고", "Note"),
  ];
  const sampleRows = () =>
    d.samples.map((sample) => {
      const result = sampleResult(sample);
      return [
        sample.name,
        result.inverse ? "Y → X" : "X → Y",
        parseNumber(String(sample.input ?? "")) ?? sample.input,
        finite(result.value) ? result.value : "",
        sampleNote(result),
      ];
    });
  const modelNames: Record<Model, string> = {
    linear: t("선형", "Linear"),
    origin: t("원점 고정 선형", "Linear through origin"),
    exponential: t("지수", "Exponential"),
    hill: t("증가형 Hill (4PL)", "Increasing Hill (4PL)"),
    "hill-decreasing": t("감소형 Hill (4PL)", "Decreasing Hill (4PL)"),
  };
  const modelName = modelNames[model] ?? String(model);
  const tick = (value: number) =>
    Math.abs(value) < 1e-12 ? "0" : String(Number(value.toPrecision(3)));
  // Where the main graph draws its grid: round values inside the axis range.
  // `log` axes hold log10 of the value. Falls back to even fractions when
  // fewer than two round values fit.
  const gridTicks = (min: number, max: number, log: boolean) => {
    const span = max - min,
      round = (
        log
          ? logTicks(10 ** min, 10 ** max).map(Math.log10)
          : niceTicks(min, max)
      ).filter((value) => value >= min - span * 1e-9 && value <= max + span * 1e-9);
    return round.length >= 2 || !(span > 0)
      ? round
      : Array.from({ length: 5 }, (_, i) => min + (span * i) / 4);
  };
  const selectView = (next: View) => {
    setView(next);
    tabsRef.current?.scrollIntoView?.({ block: "start" });
  };
  const editStandard = (index: number, patch: Partial<Standard>) =>
    set((old) => ({
      ...old,
      standards: old.standards.map((row, j) =>
        j === index ? { ...row, ...patch } : row
      ),
    }));
  const editSample = (index: number, patch: Partial<Sample>) =>
    set((old) => ({
      ...old,
      samples: old.samples.map((row, j) =>
        j === index ? { ...row, ...patch } : row
      ),
    }));
  const failPaste = (target: PasteTarget, text: string, e: unknown) => {
    if (e instanceof AmbiguousNumber) {
      setPasteError(null);
      setAsk({ target, text, example: e.example });
    } else {
      setAsk(null);
      setPasteError({ target, message: String(e) });
    }
  };
  const importStandards = (text: string, decimal: DecimalMark = "auto") => {
    try {
      const table = parseStandardRows(text, decimal);
      const body = hasHeader ? table.slice(1) : table;
      const old = {
        standards: d.standards,
        xLabel: d.xLabel,
        yLabel: d.yLabel,
      };
      set((current) => ({
        ...current,
        ...(hasHeader ? { xLabel: table[0][0], yLabel: table[0][1] } : {}),
        standards: body.map(([x, y]) => ({ x, y, excluded: false })),
      }));
      setPasteError(null);
      setAsk(null);
      offerUndo(
        t(
          `표준값을 가져온 ${body.length}개로 바꿨습니다.`,
          `Replaced the standards with the ${body.length} imported.`
        ),
        () => set((current) => ({ ...current, ...old }))
      );
    } catch (e) {
      failPaste("standards", text, e);
    }
  };
  const addSamples = (text: string, decimal: DecimalMark = "auto") => {
    try {
      const pastedRows = parseSampleRows(text, decimal);
      const old = d.samples;
      set((current) => {
        const kept = isExample.samples(current.samples) ? [] : current.samples;
        return {
          ...current,
          samples: [
            ...kept,
            ...pastedRows.map((row, i) => ({
              name: row.name || `${t("시료", "Sample")} ${kept.length + i + 1}`,
              direction: "inverse",
              input: row.input,
            })),
          ],
        };
      });
      setPasteError(null);
      setAsk(null);
      setPastedSamples("");
      offerUndo(
        t(
          `시료 ${pastedRows.length}개를 추가했습니다.`,
          pastedRows.length === 1
            ? "Added 1 sample."
            : `Added ${pastedRows.length} samples.`
        ) +
          (isExample.samples(old)
            ? t(" 예시 시료는 뺐습니다.", " The example sample was removed.")
            : ""),
        () => set((current) => ({ ...current, samples: old }))
      );
    } catch (e) {
      failPaste("samples", text, e);
    }
  };
  // A plate layout: one row per well as [role, name, concentration]. The
  // rows are added after what the user has entered, with Y left to be
  // measured; only the untouched example makes way for them.
  const applyTable = (handoff: Handoff) => {
    const standards: Standard[] = [],
      samples: Sample[] = [];
    for (const [role, name = "", concentration = ""] of handoff.rows ?? []) {
      const label = name.trim() || undefined;
      if (role === "standard")
        standards.push({
          x: concentration.trim(),
          y: "",
          excluded: false,
          label,
        });
      else if (role === "blank")
        standards.push({ x: "0", y: "", excluded: false, label });
      else if (role === "sample")
        samples.push({ name: name.trim(), direction: "inverse", input: "" });
    }
    const old = {
      standards: d.standards,
      samples: d.samples,
      xUnit: d.xUnit,
    };
    // The example goes only where rows of that kind arrive to replace it.
    const example = {
      standards: standards.length > 0 && isExample.standards(old.standards),
      samples: samples.length > 0 && isExample.samples(old.samples),
    };
    set((current) => {
      const keptStandards =
          standards.length && isExample.standards(current.standards)
            ? []
            : current.standards,
        keptSamples =
          samples.length && isExample.samples(current.samples)
            ? []
            : current.samples;
      return {
        ...current,
        standards: [...keptStandards, ...standards],
        samples: [
          ...keptSamples,
          ...samples.map((sample, i) => ({
            ...sample,
            name:
              sample.name ||
              `${t("시료", "Sample")} ${keptSamples.length + i + 1}`,
          })),
        ],
        // The layout's unit names the X axis only where none was set.
        xUnit: current.xUnit || handoff.unit,
      };
    });
    const plural = (count: number, noun: string) =>
      `${count} ${noun} ${count === 1 ? "row" : "rows"}`;
    offerUndo(
      t(
        `표준 ${standards.length}개와 시료 ${samples.length}개를 추가했습니다.`,
        `Added ${plural(standards.length, "standard")} and ${plural(
          samples.length,
          "sample"
        )}.`
      ) +
        (example.standards || example.samples
          ? t(" 예시 값은 뺐습니다.", " The example values were removed.")
          : "") +
        t(" Y값을 입력하세요.", " Enter their Y values."),
      () => set((current) => ({ ...current, ...old }))
    );
  };
  const askBox = (target: PasteTarget) => {
    if (ask?.target !== target) return null;
    const comma = ask.example.includes(","),
      asDecimal = ask.example.replace(",", "."),
      asThousands = ask.example.replace(/[.,]/, "");
    const read = (decimal: DecimalMark) =>
      target === "standards"
        ? importStandards(ask.text, decimal)
        : addSamples(ask.text, decimal);
    return (
      <div className="tool-calibration-x-ask" role="alert">
        <p>
          {t(
            `“${ask.example}”은(는) 소수일 수도, 천 단위로 끊어 쓴 수일 수도 있습니다. 어떻게 읽을지 고르세요.`,
            `“${ask.example}” could be a decimal or a number with a thousands separator. Choose how to read it.`
          )}
        </p>
        <div className="tool-actions">
          <button onClick={() => read(comma ? "," : ".")}>
            {t(`소수: ${asDecimal}`, `Decimal: ${asDecimal}`)}
          </button>
          <button onClick={() => read(comma ? "." : ",")}>
            {t(`천 단위: ${asThousands}`, `Thousands: ${asThousands}`)}
          </button>
        </div>
      </div>
    );
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
      if (out) await download(out, exportName("png"), "image/png");
    } catch (e) {
      setError(String(e));
    } finally {
      URL.revokeObjectURL(url);
    }
  };
  const standardsCsv = () => {
    const labelled = d.standards.some((row) => row.label);
    // Fitted values and residuals belong to the rows that were fitted.
    const fitted = new Map(residuals.map((row) => [row.index, row]));
    return csv([
      [
        ...(labelled ? [t("라벨", "Label")] : []),
        d.xLabel,
        d.yLabel,
        t("제외", "Excluded"),
        ...(f ? [t("적합 Y", "Fitted Y"), t("잔차", "Residual")] : []),
      ],
      ...rows.map((row) => [
        ...(labelled ? [row.label ?? ""] : []),
        row.xv ?? row.x,
        row.yv ?? row.y,
        row.excluded ? t("예", "Yes") : t("아니오", "No"),
        ...(f
          ? [
              fitted.get(row.index)?.fitted ?? "",
              fitted.get(row.index)?.residual ?? "",
            ]
          : []),
      ]),
      ...(f
        ? [
            [],
            [t("모델", "Model"), modelName],
            [t("식", "Equation"), f.equation],
            ...(f.r2 !== null ? [["R²", f.r2]] : []),
            ...(f.rmse !== null ? [["RMSE", f.rmse]] : []),
            [t("적합에 쓴 점 (n)", "Points fitted (n)"), f.n],
            [t("매개변수 (p)", "Parameters (p)"), f.parameters],
          ]
        : []),
    ]);
  };

  return (
    <div className="tool-calibration">
      <div className="tool-calibration-model">
        <Select
          label={t("적합 모델", "Fit model")}
          value={model}
          onChange={(next) =>
            set((old) => ({
              ...old,
              model: (next === "hill-decreasing"
                ? "hill"
                : next) as Data["model"],
              hillDecreasing: next === "hill-decreasing",
            }))
          }
          options={(
            [
              "linear",
              "origin",
              "exponential",
              "hill",
              "hill-decreasing",
            ] as const
          ).map((key) => [key, modelNames[key]] as const)}
        />
        <span className="tool-muted">
          {model === "hill"
            ? "y = bottom + (top − bottom) / (1 + (K/x)ⁿ)"
            : model === "hill-decreasing"
            ? "y = bottom + (top − bottom) / (1 + (x/K)ⁿ)"
            : model === "exponential"
            ? "y = a · exp(bx)"
            : model === "origin"
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
          <HandoffBanner accepts={["table"]} onApply={applyTable} />
          <div className="tool-calibration-section-heading">
            <h2>{t("표준값", "Standards")}</h2>
            <span className="tool-muted">
              {usedRows.length}
              {t("개 사용", " included")}
              {replicated.length > 0 &&
                t(
                  ` · X ${levels.length}수준`,
                  ` · ${levels.length} X levels`
                )}
            </span>
          </div>
          <table
            className={`tool-calibration-table ${
              rows.some((row) => row.label) ? "tool-calibration-x-labelled" : ""
            }`}
          >
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
              {rows.map((row, i) => {
                // An empty cell is not marked: it is waiting, not wrong. The
                // same X on several rows is a replicate, not an error.
                const invalid =
                  !row.excluded &&
                  ((row.x.trim() !== "" && row.xv == null) ||
                    (row.y.trim() !== "" && row.yv == null) ||
                    (model === "exponential" &&
                      row.yv != null &&
                      row.yv <= 0) ||
                    (hill && row.xv != null && row.xv <= 0));
                return (
                  <tr
                    key={i}
                    className={`${row.excluded ? "is-excluded" : ""} ${
                      invalid ? "is-invalid" : ""
                    }`}
                  >
                    <th scope="row">
                      {i + 1}
                      {row.label && (
                        <small
                          className="tool-calibration-x-well"
                          title={row.label}
                        >
                          {row.label}
                        </small>
                      )}
                    </th>
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
                            editStandard(
                              i,
                              k === "x"
                                ? { x: event.target.value }
                                : { y: event.target.value }
                            )
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
                          editStandard(i, { excluded: !row.excluded })
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
                        onClick={() => {
                          const old = d.standards;
                          set((current) => ({
                            ...current,
                            standards: current.standards.filter(
                              (_, j) => j !== i
                            ),
                          }));
                          offerUndo(
                            t("표준을 삭제했습니다.", "Standard deleted."),
                            () =>
                              set((current) => ({
                                ...current,
                                standards: old,
                              }))
                          );
                        }}
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
              set((old) => ({
                ...old,
                standards: [...old.standards, { x: "", y: "", excluded: false }],
              }))
            }
          >
            <Plus size={17} />
            {t("표준 추가", "Add standard")}
          </button>
          <ErrorMessage message={fit.error} />
          {fit.incomplete && (
            <p role="status" className="tool-muted">
              {t(
                `값이 비어 있는 표준 ${blankRows}개를 채우면 적합합니다. 쓰지 않을 행은 ‘사용’을 끄거나 삭제하세요.`,
                blankRows === 1
                  ? "1 standard has an empty value. Fill it in to fit the curve, or turn off Use for a row you do not need."
                  : `${blankRows} standards have an empty value. Fill them in to fit the curve, or turn off Use for rows you do not need.`
              )}
            </p>
          )}
          {replicated.length > 0 && (
            <div className="tool-calibration-x-replicates">
              <p>
                <strong>{t("반복 측정", "Replicates")}</strong>
              </p>
              <div className="tool-table-wrap">
                <table>
                  <thead>
                    <tr>
                      {replicateHeaders.map((header) => (
                        <th key={header} scope="col">
                          {header}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {replicateRows.map((row, index) => (
                      <tr key={index}>
                        {row.map((cell, column) => (
                          <td key={column}>
                            {typeof cell === "number" ? format(cell) : "—"}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="tool-muted">
                {t(
                  "적합에는 평균이 아니라 측정값을 하나씩 모두 사용합니다. 평균과 SD(표본 표준편차, n − 1)는 확인용입니다.",
                  "The fit uses every measurement, not the means. Mean and SD (sample standard deviation, n − 1) are for checking."
                )}
              </p>
            </div>
          )}
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
                <button onClick={() => importStandards(pasted)}>
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
                      const input = event.target;
                      try {
                        const file = input.files?.[0];
                        if (file) importStandards(await file.text());
                      } catch (e) {
                        setPasteError({
                          target: "standards",
                          message: String(e),
                        });
                      }
                      input.value = "";
                    }}
                  />
                </label>
              </div>
              {askBox("standards")}
              {pasteError?.target === "standards" && (
                <ErrorMessage message={pasteError.message} />
              )}
              <p className="tool-muted">
                {t(
                  "X, Y 순서의 두 열을 탭·쉼표·공백으로 구분해 넣으세요. 스프레드시트에서 복사한 값은 0,5처럼 쉼표 소수점도 읽습니다. 같은 X를 여러 줄 넣으면 반복 측정입니다. 가져온 값으로 현재 표준값을 바꿉니다.",
                  "Enter X then Y, separated by a tab, comma or space. Values copied from a spreadsheet may use a decimal comma, as in 0,5. Lines that repeat an X are replicates. Imported values replace the current standards."
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
                onChange={(xLabel) => set((old) => ({ ...old, xLabel }))}
              />
              <Field
                type="text"
                label={t("X 단위", "X unit")}
                value={d.xUnit}
                onChange={(xUnit) => set((old) => ({ ...old, xUnit }))}
              />
              <Field
                type="text"
                label={t("Y축 이름", "Y axis")}
                value={d.yLabel}
                onChange={(yLabel) => set((old) => ({ ...old, yLabel }))}
              />
              <Field
                type="text"
                label={t("Y 단위", "Y unit")}
                value={d.yUnit}
                onChange={(yUnit) => set((old) => ({ ...old, yUnit }))}
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
                onClick={() => set((old) => ({ ...old, logX: !old.logX }))}
              >
                log X
              </button>
              <button
                type="button"
                aria-pressed={d.logY}
                onClick={() => set((old) => ({ ...old, logY: !old.logY }))}
              >
                log Y
              </button>
            </div>
          </div>
          {!f && (
            <div className="tool-calibration-empty">
              <ErrorMessage message={fit.error} />
              <p className="tool-muted">
                {fit.incomplete
                  ? t(
                      "표준값의 빈칸을 채우면 그래프와 시료 결과가 표시됩니다.",
                      "Fill in the empty standard values to see the curve and sample results."
                    )
                  : t(
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
            <ChartFrame
              title={t("표준·적합선·시료", "Standards, fit and samples")}
              note={
                f
                  ? t(
                      `${modelName} · 측정값 ${f.n}개로 적합`,
                      `${modelName} · fitted to ${f.n} measurements`
                    )
                  : undefined
              }
              table={{
                headers: [
                  t("구분", "Kind"),
                  t("이름", "Name"),
                  axis(d.xLabel, d.xUnit),
                  axis(d.yLabel, d.yUnit),
                  t("비고", "Note"),
                ],
                rows: f
                  ? [
                      ...points.map((p) => [
                        t("표준", "Standard"),
                        p.label ? `${p.index + 1} · ${p.label}` : `${p.index + 1}`,
                        p.x,
                        p.y,
                        "",
                      ]),
                      ...d.samples.flatMap((sample) => {
                        const result = sampleResult(sample);
                        return finite(result.x) && finite(result.y)
                          ? [
                              [
                                t("시료", "Sample"),
                                sample.name,
                                result.x,
                                result.y,
                                result.extrapolated
                                  ? t("외삽", "Extrapolated")
                                  : "",
                              ],
                            ]
                          : [];
                      }),
                    ]
                  : [],
              }}
            >
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
                {/* Grid lines sit on round values (1-2-5 steps; round
                    concentrations on a log axis), not at even fractions of
                    the padded range. */}
                {gridTicks(xmin, xmax, d.logX).map((xv) => {
                  const x = 64 + (394 * (xv - xmin)) / (xmax - xmin);
                  return (
                    <g key={`x-${xv}`}>
                      <path
                        d={`M${x} 40 V260`}
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
                    </g>
                  );
                })}
                {gridTicks(ymin, ymax, d.logY).map((yv) => {
                  const y = 260 - (220 * (yv - ymin)) / (ymax - ymin);
                  return (
                    <g key={`y-${yv}`}>
                      <path
                        d={`M64 ${y} H458`}
                        fill="none"
                        stroke="#e2e8f0"
                        className="tool-calibration-gridline"
                      />
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
                  {[before, after].map(
                    (curve, i) =>
                      curve.length > 1 && (
                        <polyline
                          key={i}
                          points={line(curve)}
                          fill="none"
                          stroke="#2563eb"
                          strokeWidth="2"
                          strokeDasharray="6 5"
                        />
                      )
                  )}
                  {predictions.length > 0 && (
                    <polyline
                      points={line(predictions)}
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
                  {drawnSamples.map((p, i) => (
                    // Filled inside the standards, hollow beyond them.
                    <rect
                      key={i}
                      x={px(p.x) - 5}
                      y={py(p.y) - 5}
                      width="10"
                      height="10"
                      fill={p.extrapolated ? "white" : "#d97706"}
                      stroke={p.extrapolated ? "#d97706" : "white"}
                      strokeWidth={p.extrapolated ? 2 : 1.5}
                      className={
                        p.extrapolated ? "tool-calibration-x-hollow" : undefined
                      }
                      data-extrapolated={p.extrapolated ? "" : undefined}
                      transform={`rotate(45 ${px(p.x)} ${py(p.y)})`}
                    >
                      <title>
                        {p.name}: X = {format(p.x)}, Y = {format(p.y)}
                        {p.extrapolated
                          ? ` · ${t("외삽", "Extrapolated")}`
                          : ""}
                      </title>
                    </rect>
                  ))}
                </g>
                {
                  // Named on the graph while the names have room.
                  drawnExtrapolated.length <= 4 &&
                    drawnExtrapolated.map((p, i) => {
                      const cx = px(p.x),
                        cy = py(p.y),
                        end = cx > 261;
                      return (
                        <text
                          key={i}
                          x={cx + (end ? -10 : 10)}
                          y={cy < 70 ? cy + 20 : cy - 10}
                          textAnchor={end ? "end" : "start"}
                          fill="#92400e"
                          fontSize="14"
                        >
                          {t("외삽", "Extrapolated")}
                        </text>
                      );
                    })
                }
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
                  <circle cx="70" cy="338" r="4" fill="#0f766e" />
                  <text x="80" y="343">
                    {t("표준값", "Standards")}
                  </text>
                  <rect
                    x="164"
                    y="334"
                    width="8"
                    height="8"
                    fill="#d97706"
                    transform="rotate(45 168 338)"
                  />
                  <text x="180" y="343">
                    {t("시료 계산값", "Calculated samples")}
                  </text>
                  {drawnExtrapolated.length > 0 && (
                    <>
                      <rect
                        x="325"
                        y="334"
                        width="8"
                        height="8"
                        fill="white"
                        stroke="#d97706"
                        strokeWidth="2"
                        className="tool-calibration-x-hollow"
                        transform="rotate(45 329 338)"
                      />
                      <text x="341" y="343">
                        {t("외삽 시료", "Extrapolated")}
                      </text>
                    </>
                  )}
                </g>
              </svg>
            </ChartFrame>
          </div>
          {logWarning && (
            <p role="status" className="tool-error">
              {t(
                "로그 축에서 0 이하 점은 표시할 수 없습니다. 원자료와 적합에는 유지됩니다.",
                "Non-positive points cannot be displayed on log axes. Original data and fitting are unchanged."
              )}
            </p>
          )}
          {f && farSamples > 0 && (
            <p role="status" className="tool-muted">
              {t(
                `표준 범위에서 멀리 벗어난 시료 ${farSamples}개는 그래프에 그리지 않았습니다. 결과와 외삽 표시는 아래에 있습니다.`,
                farSamples === 1
                  ? "1 sample far outside the standard range is not drawn. Its result and extrapolation note are below."
                  : `${farSamples} samples far outside the standard range are not drawn. Their results and extrapolation notes are below.`
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
                  {f.rmse !== null && (
                    <div>
                      <dt>RMSE</dt>
                      <dd>{format(f.rmse)}</dd>
                    </div>
                  )}
                  <div>
                    <dt>n</dt>
                    <dd>{f.n}</dd>
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
              <ChartFrame
                title={t("잔차", "Residuals")}
                note={t(
                  "측정 Y − 적합 Y. 0의 한쪽에 몰려 있거나 휘어 있으면 모델이 자료에 맞지 않는 것입니다.",
                  "Measured Y − fitted Y. Points gathered on one side of zero, or in a bend, mean the model does not suit the data."
                )}
                table={{ headers: residualHeaders, rows: residualRows }}
              >
                {/* X follows the graph above: on a log axis a dilution series
                    is evenly spread instead of piled up at the left. */}
                <Plot
                  label={t(
                    "X에 따른 잔차 (측정 Y − 적합 Y)",
                    "Residuals (measured Y − fitted Y) against X"
                  )}
                  height={190}
                  xTitle={`${axis(d.xLabel, d.xUnit)}${d.logX ? " · log" : ""}`}
                  yTitle={t("잔차", "Residual")}
                  xText={
                    d.logX
                      ? (value) => format(Number((10 ** value).toPrecision(4)))
                      : format
                  }
                  // On a log axis the ticks are round concentrations, not
                  // round logarithms.
                  xTicks={
                    d.logX && residuals.some((row) => row.x > 0)
                      ? logTicks(
                          Math.min(
                            ...residuals
                              .filter((row) => row.x > 0)
                              .map((row) => row.x)
                          ),
                          Math.max(...residuals.map((row) => row.x))
                        ).map(Math.log10)
                      : undefined
                  }
                  yDomain={[-residualLimit, residualLimit]}
                  rules={[{ axis: "y", at: 0 }]}
                  series={[
                    {
                      name: t("잔차", "Residual"),
                      mark: "dots",
                      points: residuals
                        .filter((row) => !d.logX || row.x > 0)
                        .map((row) => ({ x: tx(row.x), y: row.residual })),
                    },
                  ]}
                />
              </ChartFrame>
              <details className="tool-calibration-disclosure">
                <summary>
                  <span>{t("적합 방법", "Fit method")}</span>
                  <ChevronDown size={16} />
                </summary>
                <div className="tool-calibration-detail-body">
                  <p className="tool-muted">
                    {model === "exponential"
                      ? t(
                          "로그 변환 회귀 · 적합도는 원래 Y 공간 기준",
                          "Log-transformed regression; fit quality in original Y space"
                        )
                      : model === "hill"
                      ? t(
                          "증가형 Hill(4PL) · 다중 초기값 비선형 최소제곱",
                          "Increasing Hill (4PL); multistart nonlinear least squares"
                        )
                      : model === "hill-decreasing"
                      ? t(
                          "감소형 Hill(4PL) · 다중 초기값 비선형 최소제곱 · 4PL 표기 y = d + (a − d) / (1 + (x/c)ᵇ)에서 a = top, d = bottom, c = K, b = n",
                          "Decreasing Hill (4PL); multistart nonlinear least squares. In the 4PL form y = d + (a − d) / (1 + (x/c)ᵇ): a = top, d = bottom, c = K, b = n"
                        )
                      : t(
                          "선형 최소제곱 · 잔차 = 측정 Y − 예측 Y",
                          "Linear least squares; residual = measured Y − predicted Y"
                        )}
                  </p>
                  <p className="tool-muted">
                    {t(
                      `측정값 ${f.n}개(n), 매개변수 ${f.parameters}개(p). 같은 X의 반복 측정은 평균하지 않고 하나씩 모두 적합에 사용합니다.`,
                      `${f.n} measurements (n), ${f.parameters} parameters (p). Replicates at one X enter the fit one by one, not as their mean.`
                    )}
                  </p>
                  <p className="tool-muted">
                    {f.rmse !== null
                      ? t(
                          `RMSE = √(잔차 제곱합 ÷ (n − p)), 자유도 n − p = ${
                            f.n - f.parameters
                          }`,
                          `RMSE = √(sum of squared residuals ÷ (n − p)), with n − p = ${
                            f.n - f.parameters
                          } degrees of freedom`
                        )
                      : t(
                          "측정값 수가 매개변수 수보다 많지 않아 RMSE는 표시하지 않습니다.",
                          "RMSE is not shown: it needs more measurements than parameters."
                        )}
                  </p>
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
              const result = sampleResult(sample);
              const { inverse, value } = result;
              return (
                <div className="tool-calibration-sample" key={i}>
                  <div className="tool-calibration-sample-heading">
                    <input
                      type="text"
                      aria-label={`${t("시료명", "Sample name")} ${i + 1}`}
                      value={sample.name}
                      onChange={(event) =>
                        editSample(i, { name: event.target.value })
                      }
                    />
                    <button
                      className="tool-calibration-icon"
                      aria-label={`${t("시료 삭제", "Delete sample")} ${i + 1}`}
                      onClick={() => {
                        const old = d.samples;
                        set((current) => ({
                          ...current,
                          samples: current.samples.filter((_, j) => j !== i),
                        }));
                        offerUndo(
                          t("시료를 삭제했습니다.", "Sample deleted."),
                          () =>
                            set((current) => ({ ...current, samples: old }))
                        );
                      }}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                  <Select
                    label={t("계산 방향", "Direction")}
                    value={sample.direction}
                    onChange={(direction) => editSample(i, { direction })}
                    options={[
                      ["inverse", t("Y → X · 농도 역산", "Y → X · Inverse")],
                      ["forward", t("X → Y · 신호 예측", "X → Y · Predict")],
                    ]}
                  />
                  <div className="tool-calibration-conversion">
                    <NumberField
                      label={axis(
                        inverse ? d.yLabel : d.xLabel,
                        inverse ? d.yUnit : d.xUnit
                      )}
                      value={String(sample.input ?? "")}
                      onChange={(input) => editSample(i, { input })}
                    />
                    <ArrowRight size={18} aria-hidden="true" />
                    <div className="tool-calibration-sample-result">
                      <span>{inverse ? d.xLabel : d.yLabel}</span>
                      <output
                        aria-label={`${sample.name} ${t("결과", "result")}`}
                      >
                        {finite(value) ? format(value) : "—"}
                        {finite(value) && (
                          <small>{inverse ? d.xUnit : d.yUnit}</small>
                        )}
                      </output>
                    </div>
                  </div>
                  {result.notNumber ? (
                    <ErrorMessage message="Invalid number" />
                  ) : (
                    result.invalid && (
                      <ErrorMessage
                        message={t(
                          "이 범위에서 계산 또는 역산할 수 없습니다.",
                          "Cannot calculate or invert in this range."
                        )}
                      />
                    )
                  )}
                  {result.extrapolated && (
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
                set((old) => ({
                  ...old,
                  samples: [
                    ...old.samples,
                    {
                      name: `${t("시료", "Sample")} ${old.samples.length + 1}`,
                      direction: "inverse",
                      input: "",
                    },
                  ],
                }))
              }
            >
              <Plus size={17} />
              {t("시료 추가", "Add sample")}
            </button>
            <details className="tool-calibration-disclosure">
              <summary>
                <span>{t("여러 시료 붙여넣기", "Paste several samples")}</span>
                <ChevronDown size={16} />
              </summary>
              <div className="tool-calibration-detail-body">
                <label className="tool-field">
                  <span>
                    {t(
                      "한 줄에 시료 하나 (Y값, 또는 이름과 Y값)",
                      "One sample per line (Y, or name and Y)"
                    )}
                  </span>
                  <textarea
                    value={pastedSamples}
                    onChange={(event) => setPastedSamples(event.target.value)}
                    placeholder={`${t("시료", "Sample")} A\t0.52\n${t(
                      "시료",
                      "Sample"
                    )} B\t0.61`}
                  />
                </label>
                <div className="tool-actions">
                  <button
                    disabled={!pastedSamples.trim()}
                    onClick={() => addSamples(pastedSamples)}
                  >
                    {t("붙여 넣은 시료 추가", "Add pasted samples")}
                  </button>
                </div>
                {askBox("samples")}
                {pasteError?.target === "samples" && (
                  <ErrorMessage message={pasteError.message} />
                )}
                <p className="tool-muted">
                  {t(
                    "스프레드시트에서 Y값 열만, 또는 이름과 Y값 두 열을 복사해 붙여 넣으세요. 이름이 없으면 번호를 붙입니다. 기존 시료 뒤에 Y → X 계산으로 추가됩니다.",
                    "Copy a column of Y values, or a name column and a Y column, from a spreadsheet. Lines without a name are numbered. They are added after the current samples as Y → X calculations."
                  )}
                </p>
              </div>
            </details>
            {f && d.samples.length > 1 && (
              <div className="tool-calibration-x-results">
                <div className="tool-table-wrap">
                  <table>
                    <thead>
                      <tr>
                        {sampleHeaders.map((header) => (
                          <th key={header} scope="col">
                            {header}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {d.samples.map((sample, i) => {
                        const result = sampleResult(sample);
                        return (
                          <tr key={i}>
                            <td>{sample.name}</td>
                            <td>{result.inverse ? "Y → X" : "X → Y"}</td>
                            <td>{sample.input}</td>
                            <td>
                              {finite(result.value)
                                ? format(result.value)
                                : "—"}
                            </td>
                            <td
                              className={
                                result.extrapolated || result.invalid
                                  ? "tool-calibration-x-flag"
                                  : undefined
                              }
                            >
                              {sampleNote(result)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="tool-actions">
                  <CopyButton
                    text={() => tsv([sampleHeaders, ...sampleRows()])}
                  >
                    {t("결과 표 복사", "Copy results table")}
                  </CopyButton>
                </div>
              </div>
            )}
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
                    standardsCsv(),
                    exportName("csv", "standards"),
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
                    csv([sampleHeaders, ...sampleRows()]),
                    exportName("csv", "samples"),
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
                  if (!f) return;
                  try {
                    await report({
                      title: t("검량선 보고서", "Calibration report"),
                      lines: [
                        `${t("모델", "Model")}: ${modelName}`,
                        f.equation,
                        ...(f.r2 !== null ? [`R²: ${format(f.r2)}`] : []),
                        ...(f.rmse !== null
                          ? [
                              `RMSE: ${format(f.rmse)} (n − p = ${
                                f.n - f.parameters
                              })`,
                            ]
                          : []),
                        t(
                          `적합에 쓴 측정값: ${f.n}개 (반복 측정은 평균하지 않고 하나씩 사용)`,
                          `Measurements fitted: ${f.n} (replicates one by one, not as means)`
                        ),
                        `${axis(d.xLabel, d.xUnit)} · ${axis(
                          d.yLabel,
                          d.yUnit
                        )}`,
                      ],
                      sections: [
                        ...(d.samples.some((sample) =>
                          String(sample.input ?? "").trim()
                        )
                          ? [
                              {
                                title: t("시료 결과", "Sample results"),
                                headers: sampleHeaders,
                                rows: sampleRows(),
                              },
                            ]
                          : []),
                        ...(replicateRows.length
                          ? [
                              {
                                title: t("반복 측정", "Replicates"),
                                headers: replicateHeaders,
                                rows: replicateRows,
                              },
                            ]
                          : []),
                        {
                          title: t("잔차", "Residuals"),
                          headers: residualHeaders,
                          rows: residualRows,
                        },
                      ],
                      svg: positive.length ? plotRef.current : null,
                      headers: [d.xLabel, d.yLabel, t("제외", "Excluded")],
                      rows: rows.map((row) => [
                        row.xv ?? row.x,
                        row.yv ?? row.y,
                        row.excluded ? t("예", "Yes") : t("아니오", "No"),
                      ]),
                      name: exportName("pdf"),
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
      {undoBar && <div className="tool-calibration-x-undo">{undoBar}</div>}
    </div>
  );
}
