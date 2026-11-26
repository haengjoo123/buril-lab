import { useContext, useState } from "react";
import { ExternalLink } from "lucide-react";
import {
  ToolContext,
  useText,
  useToolData,
  useUndo,
  useExportName,
  Field,
  Select,
  StoredNumberField,
  download,
  csv,
  format,
  ErrorMessage,
  CheckButton,
} from "./ui";
import {
  type LadderBand,
  autoLabel,
  bandColors,
  defaultBandColor,
  httpUrl,
  ladderDiagram,
  paintLadder,
  parseBandList,
  pngHeader,
  PNG_FOOTER,
  rescaleBands,
  resizeBand,
} from "./ladder";

const shortList = (items: string[], limit: number) =>
  items.slice(0, limit).join(", ") + (items.length > limit ? " …" : "");

export default function LadderTool() {
  const t = useText(),
    ctx = useContext(ToolContext),
    exportName = useExportName(),
    [d, set] = useToolData({
      kind: "DNA",
      vendor: "",
      catalog: "",
      source: "",
      notes: "",
      unit: "bp",
      bands: [
        { size: 1000, label: "1000", color: defaultBandColor },
      ] as LadderBand[],
    });
  const [undoBar, offerUndo] = useUndo();
  const [pasting, setPasting] = useState(false),
    [pasted, setPasted] = useState(""),
    [error, setError] = useState("");
  const valid =
      d.bands.length > 0 &&
      d.bands.every(
        (b) => b.size != null && Number.isFinite(b.size) && b.size > 0
      ),
    sorted = [...d.bands].sort((a, b) => (b.size ?? 0) - (a.size ?? 0)),
    diagram = ladderDiagram(d.bands, d.unit),
    link = httpUrl(d.source),
    product = [d.vendor, d.catalog]
      .map((part) => String(part ?? "").trim())
      .filter(Boolean)
      .join(" · "),
    parsed = parseBandList(pasted, d.unit);
  const update = (index: number, patch: Partial<LadderBand>) =>
    set({
      ...d,
      bands: d.bands.map((band, i) =>
        i === index ? { ...band, ...patch } : band
      ),
    });
  const restore = (bands: LadderBand[]) => () =>
    set((old) => ({ ...old, bands }));
  const importBands = (replace: boolean) => {
    const before = d.bands,
      known = new Set(replace ? [] : before.map((band) => band.size)),
      added = parsed.sizes
        .filter((size) => !known.has(size))
        .map((size) => ({
          size,
          label: autoLabel(size),
          color: defaultBandColor,
        }));
    set({ ...d, bands: replace ? added : [...before, ...added] });
    setPasted("");
    setPasting(false);
    offerUndo(
      [
        t(
          `밴드 ${added.length}개를 가져왔습니다.`,
          `Bands imported: ${added.length}.`
        ),
        parsed.skipped.length
          ? t(
              `해석하지 못한 항목 ${parsed.skipped.length}개.`,
              `Not read: ${parsed.skipped.length}.`
            )
          : "",
      ]
        .filter(Boolean)
        .join(" "),
      restore(before)
    );
  };
  const exportPng = async () => {
    try {
      // Saved work is titled by its name; a draft by the product, if entered.
      const saved =
          ctx && !ctx.draft && ctx.doc.data._workspace !== true
            ? ctx.doc.title
            : "",
        title =
          [saved, product].filter(Boolean).join(" — ") ||
          `${d.kind === "Protein" ? t("단백질", "Protein") : d.kind} ${t(
            "래더",
            "ladder"
          )} (${d.unit})`,
        scale = 2,
        canvas = document.createElement("canvas");
      canvas.width = diagram.width * scale;
      canvas.height = (diagram.height + pngHeader(title) + PNG_FOOTER) * scale;
      const context = canvas.getContext("2d");
      if (!context) throw Error("Could not create the image");
      paintLadder(context, diagram, {
        scale,
        title,
        caption: t(
          "로그 간격 도식 · 실제 이동 거리와 다름",
          "Log-spaced schematic, not actual migration"
        ),
      });
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/png")
      );
      if (!blob) throw Error("Could not create the image");
      await download(blob, exportName("png"), "image/png");
      setError("");
    } catch (e) {
      setError(String(e));
    }
  };
  return (
    <section>
      {undoBar}
      <div className="tool-grid">
        <Select
          label={t("종류", "Type")}
          value={d.kind}
          onChange={(kind) => {
            const unit =
              kind === "Protein" ? "kDa" : kind === "RNA" ? "nt" : "bp";
            // Sizes entered in kb are lengths in thousands: 1 kb is 1000 nt or
            // bp, not 1. Protein sizes are a different quantity and are left
            // for the user to replace.
            const factor = d.unit === "kb" && unit !== "kDa" ? 1000 : 1;
            set({ ...d, kind, unit, bands: rescaleBands(d.bands, factor) });
          }}
          options={["DNA", "RNA", ["Protein", t("단백질", "Protein")]]}
        />
        <Select
          label={t("밴드 크기 단위", "Band size unit")}
          value={d.unit}
          onChange={(unit) => {
            const factor =
              d.unit === "bp" && unit === "kb"
                ? 0.001
                : d.unit === "kb" && unit === "bp"
                ? 1000
                : 1;
            set({ ...d, unit, bands: rescaleBands(d.bands, factor) });
          }}
          options={
            d.kind === "Protein"
              ? ["kDa"]
              : d.kind === "RNA"
              ? ["nt"]
              : ["bp", "kb"]
          }
        />
      </div>
      <details className="tool-guide">
        <summary>
          {t("제조사·제품 정보", "Manufacturer and product details")}
        </summary>
        <div className="tool-grid">
          <Field
            type="text"
            label={t("제조사", "Manufacturer")}
            value={d.vendor}
            onChange={(vendor) => set({ ...d, vendor })}
          />
          <Field
            type="text"
            label={t("제품 번호", "Catalog number")}
            value={d.catalog}
            onChange={(catalog) => set({ ...d, catalog })}
          />
        </div>
        <Field
          type="url"
          label={t("공식 자료 링크", "Official reference URL")}
          value={d.source}
          onChange={(source) => set({ ...d, source })}
        />
        {!link && String(d.source ?? "").trim() !== "" && (
          <p className="tool-muted">
            {t(
              "https:// 또는 http://로 시작하는 전체 주소를 입력하면 링크로 열 수 있습니다.",
              "Enter the full address, starting with https:// or http://, to open it as a link."
            )}
          </p>
        )}
        <Field
          type="text"
          label={t("메모", "Notes")}
          value={d.notes}
          onChange={(notes) => set({ ...d, notes })}
        />
      </details>
      {(product || link) && (
        <p className="tool-ladder-x-source">
          {product && <span>{product}</span>}
          {link && (
            <a href={link} target="_blank" rel="noopener noreferrer">
              <ExternalLink size={15} aria-hidden="true" />
              {t("공식 자료 열기", "Open official reference")}
              <small>
                {new URL(link).hostname} · {t("새 탭", "new tab")}
              </small>
            </a>
          )}
        </p>
      )}
      <div className="tool-ladder-layout">
        <div>
          <div
            className="tool-ladder-x-bands"
            role="group"
            aria-label={t("밴드 목록", "Bands")}
          >
            <div className="tool-ladder-x-head" aria-hidden="true">
              <span>
                {t("크기", "Size")} ({d.unit})
              </span>
              <span>{t("라벨", "Label")}</span>
              <span>{t("색", "Color")}</span>
              <span>{t("기준 밴드", "Reference band")}</span>
            </div>
            {d.bands.map((band, index) => (
              <div className="tool-ladder-x-band" key={index}>
                <StoredNumberField
                  label={`${t("밴드 크기", "Band size")} ${index + 1}`}
                  value={band.size}
                  onChange={(size) =>
                    set({
                      ...d,
                      bands: d.bands.map((other, i) =>
                        i === index ? resizeBand(other, size) : other
                      ),
                    })
                  }
                />
                <Field
                  type="text"
                  label={`${t("밴드 라벨", "Band label")} ${index + 1}`}
                  value={band.label}
                  onChange={(label) => update(index, { label })}
                />
                <label className="tool-field">
                  <span>{`${t("밴드 색", "Band color")} ${index + 1}`}</span>
                  <select
                    value={band.color}
                    style={{ borderLeft: `8px solid ${band.color}` }}
                    onChange={(e) => update(index, { color: e.target.value })}
                  >
                    {bandColors.map((color) => (
                      <option key={color.value} value={color.value}>
                        {t(color.ko, color.en)}
                      </option>
                    ))}
                    {!bandColors.some((color) => color.value === band.color) && (
                      <option value={band.color}>
                        {t("사용자 색", "Custom")}
                      </option>
                    )}
                  </select>
                </label>
                <CheckButton
                  checked={!!band.highlight}
                  label={`${t("강조", "Highlight")} ${index + 1}`}
                  onChange={(highlight) => update(index, { highlight })}
                >
                  {t("강조", "Highlight")}
                </CheckButton>
                <button
                  aria-label={`${t("밴드 삭제", "Remove band")} ${index + 1}`}
                  onClick={() => {
                    const before = d.bands;
                    set({
                      ...d,
                      bands: before.filter((_, i) => i !== index),
                    });
                    offerUndo(
                      t("밴드를 삭제했습니다.", "Band removed."),
                      restore(before)
                    );
                  }}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
          <ErrorMessage
            message={
              valid
                ? ""
                : t(
                    "밴드 크기를 0보다 큰 수로 입력하세요.",
                    "Enter positive band sizes."
                  )
            }
          />
          <div className="tool-actions">
            <button
              onClick={() =>
                set({
                  ...d,
                  bands: [
                    ...d.bands,
                    { size: 100, label: "100", color: defaultBandColor },
                  ],
                })
              }
            >
              {t("밴드 추가", "Add band")}
            </button>
            <button
              aria-expanded={pasting}
              onClick={() => setPasting(!pasting)}
            >
              {t("목록 붙여넣기", "Paste a list")}
            </button>
            <button onClick={() => set({ ...d, bands: sorted })}>
              {t("큰 밴드부터 정렬", "Sort largest first")}
            </button>
            <button
              disabled={!valid}
              onClick={() =>
                download(
                  csv([
                    [
                      t("크기", "Size"),
                      t("라벨", "Label"),
                      t("단위", "Unit"),
                      t("기준 밴드", "Reference band"),
                      t("색", "Color"),
                    ],
                    ...sorted.map((b) => [
                      b.size ?? "",
                      b.label,
                      d.unit,
                      b.highlight ? 1 : 0,
                      b.color,
                    ]),
                  ]),
                  exportName("csv"),
                  "text/csv"
                )
              }
            >
              CSV
            </button>
            <button
              disabled={diagram.bands.length === 0}
              onClick={() => void exportPng()}
            >
              {t("도식 PNG", "Diagram PNG")}
            </button>
          </div>
          <ErrorMessage message={error} />
          {pasting && (
            <div className="tool-ladder-x-paste">
              <label className="tool-field">
                <span>
                  {t("밴드 크기 목록", "Band sizes")} ({d.unit})
                </span>
                <textarea
                  rows={4}
                  value={pasted}
                  placeholder={
                    d.kind === "Protein"
                      ? "250, 150, 100, 75, 50, 37, 25 kDa"
                      : "10,000  8,000  6,000  1.5 kb  500 bp"
                  }
                  onChange={(e) => setPasted(e.target.value)}
                />
              </label>
              <p className="tool-muted">
                {t(
                  "제품 설명서의 크기 목록을 그대로 붙여 넣으세요. 줄바꿈·쉼표·탭·공백으로 나누고, 10,000의 쉼표는 천 단위로 읽습니다. kb·bp·nt·kDa가 붙은 값은 이 래더의 단위로 환산하며, 한 줄에 여러 값을 쓰고 끝에만 단위를 붙이면(0.5, 1, 3 kb) 앞의 값에도 그 단위를 적용합니다. 소수점은 마침표로 쓰세요.",
                  "Paste the size list from the product sheet as it is. Values are split at line breaks, commas, tabs and spaces; the comma in 10,000 groups thousands. Values written with kb, bp, nt or kDa are converted to this ladder's unit, and a unit written once at the end of a line of values (0.5, 1, 3 kb) applies to all of them. Use a point for decimals."
                )}
              </p>
              {pasted.trim() !== "" && (
                <div className="tool-ladder-x-parsed" role="status">
                  <p>
                    {parsed.sizes.length
                      ? t(
                          `읽은 밴드 ${parsed.sizes.length}개: ${shortList(
                            parsed.sizes.map(format),
                            10
                          )} ${d.unit}`,
                          `Bands read: ${parsed.sizes.length} — ${shortList(
                            parsed.sizes.map(format),
                            10
                          )} ${d.unit}`
                        )
                      : t(
                          "읽을 수 있는 크기가 없습니다.",
                          "No sizes could be read."
                        )}
                  </p>
                  {parsed.skipped.length > 0 && (
                    <p className="tool-ladder-x-skipped">
                      {t(
                        `해석하지 못한 항목 ${
                          parsed.skipped.length
                        }개: ${shortList(parsed.skipped, 6)}`,
                        `Not read: ${parsed.skipped.length} — ${shortList(
                          parsed.skipped,
                          6
                        )}`
                      )}
                    </p>
                  )}
                  {parsed.unitMismatch > 0 && (
                    <p className="tool-ladder-x-skipped">
                      {t(
                        "종류가 다른 단위의 값은 가져오지 않습니다. 먼저 래더 종류를 바꾸세요.",
                        "Values in a unit of another kind are not imported. Change the ladder type first."
                      )}
                    </p>
                  )}
                  {parsed.duplicates > 0 && (
                    <p>
                      {t(
                        `같은 크기 ${parsed.duplicates}개는 한 번만 넣습니다.`,
                        `Repeated sizes left out: ${parsed.duplicates}.`
                      )}
                    </p>
                  )}
                </div>
              )}
              <div className="tool-actions">
                <button
                  className="primary"
                  disabled={parsed.sizes.length === 0}
                  onClick={() => importBands(true)}
                >
                  {t("밴드 목록 바꾸기", "Replace bands")}
                </button>
                <button
                  disabled={parsed.sizes.length === 0}
                  onClick={() => importBands(false)}
                >
                  {t("기존 밴드에 추가", "Add to bands")}
                </button>
                <button
                  onClick={() => {
                    setPasted("");
                    setPasting(false);
                  }}
                >
                  {t("취소", "Cancel")}
                </button>
              </div>
            </div>
          )}
        </div>
        <figure className="tool-ladder-preview">
          <svg
            viewBox={`0 0 ${diagram.width} ${diagram.height}`}
            role="img"
            aria-label={t("래더 도식", "Ladder diagram")}
          >
            {diagram.bands.map((band) => (
              <g key={band.index}>
                <line
                  x1={diagram.x1}
                  x2={diagram.x2}
                  y1={band.y}
                  y2={band.y}
                  stroke={band.color}
                  strokeWidth={band.stroke}
                />
                <line
                  x1={diagram.x2 + 3}
                  x2={diagram.labelX - 4}
                  y1={band.y}
                  y2={band.labelY}
                  stroke="currentColor"
                  strokeOpacity="0.35"
                  strokeWidth="1"
                />
                <text
                  x={diagram.labelX}
                  y={band.labelY + 4}
                  fill="currentColor"
                  fontSize="12"
                  fontWeight={band.bold ? 700 : 400}
                >
                  {band.text}
                </text>
              </g>
            ))}
          </svg>
          <figcaption>
            {t(
              "크기의 로그 비율을 사용한 도식입니다. 실제 전기영동 이동 거리와는 다릅니다.",
              "Schematic using logarithmic size spacing; it does not predict actual gel migration."
            )}
          </figcaption>
        </figure>
      </div>
    </section>
  );
}
