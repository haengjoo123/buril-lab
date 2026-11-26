import {
  useToolData,
  useText,
  Panel,
  Field,
  Result,
  ErrorMessage,
  calculate,
  format,
} from "./ui";
import { cellCount } from "./labMath";
export default function CellCounterTool() {
  const t = useText();
  const [d, set] = useToolData({
    rows: [{ live: 0, dead: 0 }],
    factor: 2,
    volume: 0.0001,
  });
  const r = calculate(() =>
    cellCount(
      d.rows.map((r) => r.live),
      d.rows.map((r) => r.dead),
      d.factor,
      d.volume
    )
  );
  return (
    <Panel>
      <div className="tool-grid">
        <Field
          label={t("희석배수", "Dilution factor")}
          value={d.factor}
          onChange={(v) => set({ ...d, factor: Number(v) })}
        />
        <Field
          label={t("구획당 계수 부피 (mL)", "Counted volume per chamber (mL)")}
          value={d.volume}
          onChange={(v) => set({ ...d, volume: Number(v) })}
        />
      </div>
      {d.rows.map((row, i) => (
        <div className="tool-grid" key={i}>
          {(["live", "dead"] as const).map((k) => (
            <Field
              key={k}
              label={`${i + 1} · ${
                k === "live" ? t("생존", "Live") : t("사멸", "Dead")
              }`}
              value={row[k]}
              onChange={(v) =>
                set({
                  ...d,
                  rows: d.rows.map((r, j) =>
                    j === i ? { ...r, [k]: Number(v) } : r
                  ),
                })
              }
            />
          ))}
          {d.rows.length > 1 && (
            <button
              aria-label={`${t("구획 삭제", "Remove chamber")} ${i + 1}`}
              onClick={() =>
                set({ ...d, rows: d.rows.filter((_, j) => j !== i) })
              }
            >
              ×
            </button>
          )}
        </div>
      ))}
      <button
        onClick={() => set({ ...d, rows: [...d.rows, { live: 0, dead: 0 }] })}
      >
        {t("구획 추가", "Add chamber")}
      </button>
      <ErrorMessage message={r.error} />
      {r.value && (
        <Result>
          {format(r.value.concentration)} cells/mL{"\n"}
          {t("생존율", "Viability")}:{" "}
          {r.value.viability == null
            ? t("계수한 세포가 없습니다", "no cells counted")
            : `${format(r.value.viability)}%`}
        </Result>
      )}
    </Panel>
  );
}
