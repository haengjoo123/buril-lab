export { default as AminoTool } from "./AminoTool";
export { default as CodonTool } from "./CodonTool";
export { default as PeriodicTool } from "./PeriodicTool";
import {
  useText,
  useToolData,
  Field,
  Select,
  download,
  csv,
  ErrorMessage,
  CheckButton,
} from "./ui";
type Band = { size: number; label: string; color: string; highlight?: boolean };
export function LadderTool() {
  const t = useText(),
    [d, set] = useToolData({
      kind: "DNA",
      vendor: "",
      catalog: "",
      source: "",
      notes: "",
      unit: "bp",
      bands: [{ size: 1000, label: "1000", color: "#2563eb" }] as Band[],
    });
  const valid =
      d.bands.length > 0 &&
      d.bands.every((b) => Number.isFinite(b.size) && b.size > 0),
    sorted = [...d.bands].sort((a, b) => b.size - a.size),
    max = Math.log10(sorted[0]?.size ?? 1),
    min = Math.log10(sorted.at(-1)?.size ?? 1);
  const update = (index: number, patch: Partial<Band>) =>
    set({
      ...d,
      bands: d.bands.map((band, i) =>
        i === index ? { ...band, ...patch } : band
      ),
    });
  return (
    <section>
      <div className="tool-grid">
        <Select
          label={t("종류", "Type")}
          value={d.kind}
          onChange={(kind) =>
            set({
              ...d,
              kind,
              unit: kind === "Protein" ? "kDa" : kind === "RNA" ? "nt" : "bp",
            })
          }
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
            set({
              ...d,
              unit,
              bands: d.bands.map((b) => ({ ...b, size: b.size * factor })),
            });
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
        <Field
          type="text"
          label={t("메모", "Notes")}
          value={d.notes}
          onChange={(notes) => set({ ...d, notes })}
        />
      </details>
      <div className="tool-ladder-layout">
        <div>
          <div className="tool-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>
                    {t("크기", "Size")} ({d.unit})
                  </th>
                  <th>{t("라벨", "Label")}</th>
                  <th>{t("기준 밴드", "Reference band")}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {d.bands.map((band, index) => (
                  <tr key={index}>
                    <td>
                      <input
                        type="number"
                        min="0"
                        aria-label={`${t("밴드 크기", "Band size")} ${
                          index + 1
                        }`}
                        value={band.size}
                        onChange={(e) =>
                          update(index, { size: Number(e.target.value) })
                        }
                      />
                    </td>
                    <td>
                      <input
                        aria-label={`${t("밴드 라벨", "Band label")} ${
                          index + 1
                        }`}
                        value={band.label}
                        onChange={(e) =>
                          update(index, { label: e.target.value })
                        }
                      />
                    </td>
                    <td>
                      <CheckButton
                        checked={!!band.highlight}
                        onChange={(highlight) => update(index, { highlight })}
                      >
                        {t("강조", "Highlight")}
                      </CheckButton>
                    </td>
                    <td>
                      <button
                        aria-label={`${t("밴드 삭제", "Remove band")} ${
                          index + 1
                        }`}
                        onClick={() =>
                          set({
                            ...d,
                            bands: d.bands.filter((_, i) => i !== index),
                          })
                        }
                      >
                        ×
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
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
                    { size: 100, label: "100", color: "#2563eb" },
                  ],
                })
              }
            >
              {t("밴드 추가", "Add band")}
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
                    ],
                    ...sorted.map((b) => [
                      b.size,
                      b.label,
                      d.unit,
                      b.highlight ? 1 : 0,
                    ]),
                  ]),
                  "ladder.csv",
                  "text/csv"
                )
              }
            >
              CSV
            </button>
          </div>
        </div>
        <figure className="tool-ladder-preview">
          <svg
            viewBox="0 0 280 420"
            role="img"
            aria-label={t("래더 도식", "Ladder diagram")}
          >
            {valid &&
              sorted.map((band, index) => {
                const y =
                  35 +
                  (max === min
                    ? 170
                    : ((max - Math.log10(band.size)) / (max - min)) * 340);
                return (
                  <g key={index}>
                    <line
                      x1="20"
                      x2="120"
                      y1={y}
                      y2={y}
                      stroke={band.color}
                      strokeWidth={band.highlight ? 7 : 3}
                    />
                    <text x="135" y={y + 4} fill="currentColor" fontSize="12">
                      {band.label || band.size} {d.unit}
                    </text>
                  </g>
                );
              })}
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
